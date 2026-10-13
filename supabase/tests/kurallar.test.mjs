import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import fs from 'node:fs'

// Veritabanı kurallarını (RLS, tetikleyiciler, fonksiyonlar) bellekte çalışan bir Postgres'te (PGlite) dener.
// Supabase'e özgü parçalar (auth, storage, pg_net) stub.sql ile taklit edilir. Çalıştırma: npm test
const MIG = new URL('../migrations/001_baslangic.sql', import.meta.url)
const db = new PGlite({ extensions: { pgcrypto } })
await db.exec(fs.readFileSync(new URL('./stub.sql', import.meta.url), 'utf8'))
const sql = fs.readFileSync(MIG, 'utf8').replace(/^create extension if not exists pg_net.*$/m, '')
const sql2 = fs.readFileSync(new URL('../migrations/002_kullanici_silme.sql', import.meta.url), 'utf8')
await db.exec(sql)
await db.exec(sql2)
await db.exec(sql) // tekrar çalıştırılabilir olmalı
await db.exec(sql2)
console.log('migration x2 OK')

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond ? '' : ' ' + extra))
}
async function as(uid, fn) {
  await db.exec('begin')
  try {
    await db.exec(`set local role authenticated; select set_config('request.jwt.claims', '${JSON.stringify({ sub: uid })}', true);`)
    const r = await fn((q, p) => db.query(q, p))
    await db.exec('commit')
    return r
  } catch (e) {
    await db.exec('rollback')
    throw e
  }
}
const rows = async (uid, q, p) => (await as(uid, (x) => x(q, p))).rows
const fails = async (name, uid, q, p, re) => {
  try {
    const r = await as(uid, (x) => x(q, p))
    ok(name, false, 'beklenen hata gelmedi, etkilenen: ' + r.affectedRows)
  } catch (e) {
    ok(name, !re || re.test(e.message), e.message)
  }
}
const rejects = (name, promise, re) =>
  promise.then(
    () => ok(name, false, 'beklenen hata gelmedi'),
    (e) => ok(name, re.test(e.message), e.message),
  )
const mk = async (u, n, role, dept = null) =>
  (await db.query('select private.create_user($1,$2,$3,$4,$5) id', [u, 'GucluSifre!2026', n, role, dept])).rows[0].id
const one = async (q, p) => (await db.query(q, p)).rows[0]

const D1 = (await one("insert into departments(name) values ('Üretim') returning id")).id
const D2 = (await one("insert into departments(name) values ('Satış') returning id")).id
const A = await mk('aykut', 'Aykut Koyuncu', 'admin')
const M = await mk('mudur', 'Müdür Bey', 'manager', D1)
const S1 = await mk('ayse.kaya', 'Ayşe Kaya', 'staff', D1)
const S2 = await mk('ali.can', 'Ali Can', 'staff', D2)
const S3 = await mk('veli', 'Veli Öz', 'staff')
await db.exec("update private.settings set push_url='https://x.supabase.co/functions/v1/bildirim', push_secret='gizli'")
const calls = async () => (await db.query('select body from net.calls order by id')).rows.map((r) => r.body)
const lastCall = async () => (await calls()).at(-1)
const sorted = (a) => JSON.stringify([...a].sort())

console.log('kullanıcılar')
ok('giriş e-postası', (await one('select email from auth.users where id=$1', [S1])).email === 'ayse.kaya@portal.artucikolata.com.tr')
ok('şifre bcrypt', (await one("select encrypted_password = extensions.crypt('GucluSifre!2026', encrypted_password) ok from auth.users where id=$1", [S1])).ok)
ok('personel rehberi görür', (await rows(S1, 'select * from profiles')).length === 5)
await db.exec('begin; set local role anon;')
await rejects('anon hiçbir şey göremez', db.query('select count(*) from profiles'), /permission denied/)
await db.exec('rollback')
ok('kendi adını değiştirir', (await as(S1, (x) => x("update profiles set name='Ayşe K.', phone='555' where id=$1", [S1]))).affectedRows === 1)
await fails('kendi rolünü değiştiremez', S1, "update profiles set role='admin' where id=$1", [S1], /sadece admin/)
ok('başkasını değiştiremez', (await as(S1, (x) => x("update profiles set name='x' where id=$1", [S2]))).affectedRows === 0)
await fails('personel kullanıcı açamaz', S1, "select admin_create_user('yeni','GucluSifre!2026','Yeni')", [], /yetkiniz yok/)
const N = (await rows(A, "select admin_create_user('Yeni.Kisi','GucluSifre!2026','  Yeni   Kişi ','staff',$1) id", [D2]))[0].id
const n = await one('select username,name from profiles where id=$1', [N])
ok('admin kullanıcı açar', n.username === 'yeni.kisi' && n.name === 'Yeni Kişi', JSON.stringify(n))
await fails('aynı kullanıcı adı', A, "select admin_create_user('yeni.kisi','GucluSifre!2026','Y')", [], /zaten kullan/)
await fails('kısa şifre', A, "select admin_create_user('baska','kisa','Y')", [], /Şifre/)
await fails('admin kendini pasifleştiremez', A, 'update profiles set active=false where id=$1', [A], /Kendi hesab/)
await as(A, (x) => x("update profiles set username='yeni.k', role='manager' where id=$1", [N]))
const em = await one("select u.email, i.identity_data->>'email' e2 from auth.users u join auth.identities i on i.user_id=u.id where u.id=$1", [N])
ok('kullanıcı adı değişince giriş adresi değişir', em.email === 'yeni.k@portal.artucikolata.com.tr' && em.e2 === em.email, JSON.stringify(em))
await as(A, (x) => x('select admin_reset_password($1,$2)', [N, 'YepyeniSifre!99']))
ok('şifre sıfırlama', (await one("select encrypted_password = extensions.crypt('YepyeniSifre!99', encrypted_password) ok from auth.users where id=$1", [N])).ok)
await fails('personel şifre sıfırlayamaz', S1, 'select admin_reset_password($1,$2)', [S2, 'YepyeniSifre!99'], /yetkiniz yok/)

console.log('bildirim aboneliği')
for (const u of [S1, S2, S3, M, A]) await as(u, (x) => x('select save_push_subscription($1,$2,$3,$4)', ['https://fcm.googleapis.com/fcm/send/' + u, 'p', 'a', 'ua']))
await fails('iç ağ adresi reddedilir', S1, 'select save_push_subscription($1,$2,$3)', ['https://192.168.2.116/x', 'p', 'a'], /Desteklenmeyen/)
await fails('sahte host reddedilir', S1, 'select save_push_subscription($1,$2,$3)', ['https://fcm.googleapis.com@evil.com/x', 'p', 'a'], /Desteklenmeyen/)
await as(S2, (x) => x('select save_push_subscription($1,$2,$3)', ['https://web.push.apple.com/ortak', 'p', 'a']))
await as(S3, (x) => x('select save_push_subscription($1,$2,$3)', ['https://web.push.apple.com/ortak', 'p2', 'a2']))
ok('ortak cihaz yeni kullanıcıya geçer', (await one('select "user" u from push_subscriptions where endpoint like \'%ortak\'')).u === S3)
ok('kişi sadece kendi aboneliğini görür', (await rows(S1, 'select * from push_subscriptions')).length === 1)

console.log('duyurular')
await fails('personel duyuru yayınlayamaz', S1, "insert into announcements(title,author) values ('x',$1)", [S1], /row-level security/)
await fails('başkası adına duyuru olmaz', M, "insert into announcements(title,author) values ('x',$1)", [A], /row-level security/)
const AN = (await rows(M, "insert into announcements(title,body,author,departments,priority) values ('Toplantı','<p>Yarın <b>10:00</b></p>',$1,$2,'urgent') returning id", [M, [D1]]))[0].id
let c = await lastCall()
ok('duyuru bildirimi: hedef birim + admin, yazar hariç', sorted(c.user_ids) === sorted([S1, A]), JSON.stringify(c))
ok('duyuru bildirimi metni', c.title === '🚨 ACİL: Toplantı' && c.body === 'Yarın 10:00' && c.url === '/duyurular/' + AN, JSON.stringify(c))
ok('hedef birim görür', (await rows(S1, 'select * from announcements')).length === 1)
ok('diğer birim görmez', (await rows(S2, 'select * from announcements')).length === 0)
ok('admin görür', (await rows(A, 'select * from announcements')).length === 1)
await fails('görmediği duyuruyu okundu işaretleyemez', S2, 'insert into announcement_reads(announcement,"user") values ($1,$2)', [AN, S2], /row-level security/)
await as(S1, (x) => x('insert into announcement_reads(announcement,"user") values ($1,$2)', [AN, S1]))
ok('yazar okuyanları görür', (await rows(M, 'select * from announcement_reads')).length === 1)
ok('okunmamış duyuru sayısı', (await rows(A, 'select unread_counts() u'))[0].u.announcements === 1 && (await rows(S1, 'select unread_counts() u'))[0].u.announcements === 0)
await as(M, (x) => x("update announcements set title='Toplantı 2', author=$2 where id=$1", [AN, A]))
const an = await one('select author, title from announcements')
ok('yazar değiştirilemez', an.author === M && an.title === 'Toplantı 2', JSON.stringify(an))
ok('başka yönetici düzenleyemez', (await as(N, (x) => x("update announcements set title='h' where id=$1", [AN]))).affectedRows === 0)

console.log('mesajlar')
const DC = (await rows(S1, 'select (direct_conversation($1)).id', [S2]))[0].id
ok('aynı sohbet döner', (await rows(S2, 'select (direct_conversation($1)).id', [S1]))[0].id === DC && DC)
await fails('kendinle sohbet olmaz', S1, 'select direct_conversation($1)', [S1], /Kendinizle/)
await fails('API ile birebir sohbet açılamaz', S1, "insert into conversations(type,members,created_by) values ('direct',$1,$2)", [[S1, S3], S1], /row-level security/)
await as(S1, (x) => x("insert into messages(conversation,sender,text,created) values ($1,$2,'  Merhaba  ','2001-01-01')", [DC, S1]))
c = await lastCall()
ok('mesaj bildirimi', c.title === 'Ayşe K.' && c.body === 'Merhaba' && c.user_ids.length === 1 && c.user_ids[0] === S2 && c.tag === 'conv-' + DC, JSON.stringify(c))
const m1 = await one('select * from messages')
ok('mesaj kırpılır, tarih sunucudan', m1.text === 'Merhaba' && new Date(m1.created).getFullYear() > 2020)
ok('sohbet özeti güncellenir', (await one('select last_message_text t from conversations where id=$1', [DC])).t === 'Merhaba')
await fails('boş mesaj olmaz', S1, "insert into messages(conversation,sender,text) values ($1,$2,'   ')", [DC, S1], /Boş mesaj/)
await fails('üye olmayan yazamaz', S3, "insert into messages(conversation,sender,text) values ($1,$2,'x')", [DC, S3], /row-level security/)
await fails('başkası adına yazılamaz', S2, "insert into messages(conversation,sender,text) values ($1,$2,'x')", [DC, S1], /row-level security/)
ok('üye olmayan okuyamaz', (await rows(S3, 'select * from messages')).length === 0 && (await rows(S3, 'select * from conversations')).length === 0)
ok('admin de okuyamaz', (await rows(A, 'select * from messages')).length === 0)
ok('okunmamış 1', (await rows(S2, 'select unread_counts() u'))[0].u.conversations[DC] === 1)
ok('gönderende okunmamış yok', Object.keys((await rows(S1, 'select unread_counts() u'))[0].u.conversations).length === 0)
await as(S2, (x) => x('select mark_conversation_read($1)', [DC]))
ok('okundu sonrası 0', Object.keys((await rows(S2, 'select unread_counts() u'))[0].u.conversations).length === 0)
await fails('üye olmayan okundu işaretleyemez', S3, 'select mark_conversation_read($1)', [DC], /bulunamadı/)
ok('başkasının mesajını silemez', (await as(S2, (x) => x('delete from messages where id=$1', [m1.id]))).affectedRows === 0)
await fails('birebirden ayrılınamaz', S1, 'select leave_conversation($1)', [DC], /Sadece grup/)
const G = (await rows(S1, "insert into conversations(type,name,members,created_by) values ('group','Ekip',$1,$2) returning id", [[S1, S2, S3, S2], S1]))[0].id
ok('tekrarlı üye temizlenir', (await one('select members from conversations where id=$1', [G])).members.length === 3)
await fails('adsız grup olmaz', S1, "insert into conversations(type,name,members,created_by) values ('group',' ',$1,$2)", [[S1, S2], S1], /Grup adı/)
await fails('olmayan üye', S1, "insert into conversations(type,name,members,created_by) values ('group','g',$1,$2)", [[S1, '00000000-0000-0000-0000-000000000001'], S1], /bulunamadı/)
ok('üye grubu düzenleyemez', (await as(S2, (x) => x("update conversations set name='h' where id=$1", [G]))).affectedRows === 0)
ok('kurucu grubu düzenler', (await as(S1, (x) => x("update conversations set name='Ekip 2' where id=$1", [G]))).affectedRows === 1)
await as(S2, (x) => x('insert into messages(conversation,sender,attachments) values ($1,$2,$3)', [G, S2, ['messages/' + G + '/a.jpg']]))
c = await lastCall()
ok('grup bildirimi', c.title === 'Ali Can · Ekip 2' && c.body === '📎 Dosya' && c.user_ids.length === 2, JSON.stringify(c))
await as(S1, (x) => x('select leave_conversation($1)', [G]))
const g = await one('select * from conversations where id=$1', [G])
ok('kurucu ayrılınca yönetim devredilir', g.members.length === 2 && g.created_by === S2 && !g.members.includes(S1), JSON.stringify(g))
await as(S3, (x) => x('select leave_conversation($1)', [G]))
ok('2 kişiden az kalınca grup kapanır', (await db.query('select 1 from conversations where id=$1', [G])).rows.length === 0 && (await db.query('select 1 from messages where conversation=$1', [G])).rows.length === 0)

console.log('görevler')
const T = (await rows(M, "insert into tasks(title,assignees,created_by,due_date) values ('Kazan temizliği',$1,$2,'2026-10-20T09:00:00Z') returning id", [[S1], M]))[0].id
c = await lastCall()
ok('görev bildirimi', c.title === '📋 Yeni görev: Müdür Bey' && c.body === 'Kazan temizliği · Son tarih: 20.10.2026' && c.user_ids[0] === S1, JSON.stringify(c))
ok('atanan görür, başkası görmez', (await rows(S1, 'select * from tasks')).length === 1 && (await rows(S2, 'select * from tasks')).length === 0)
await fails('atanan başlığı değiştiremez', S1, "update tasks set title='x' where id=$1", [T], /sadece durumu/)
await as(S1, (x) => x("update tasks set status='done' where id=$1", [T]))
c = await lastCall()
ok('tamamlandı: zaman + bildirim', (await one('select completed_at from tasks')).completed_at !== null && c.title === '✅ Görev tamamlandı' && c.user_ids[0] === M && c.body === 'Ayşe K.: Kazan temizliği', JSON.stringify(c))
await as(S1, (x) => x("update tasks set status='todo' where id=$1", [T]))
ok('geri alınınca zaman silinir', (await one('select completed_at from tasks')).completed_at === null)
await fails('göremediği göreve yorum yazamaz', S2, "insert into task_comments(task,author,text) values ($1,$2,'x')", [T, S2], /row-level security/)
await as(S1, (x) => x("insert into task_comments(task,author,text) values ($1,$2,'Bitti')", [T, S1]))
c = await lastCall()
ok('yorum bildirimi', c.title === '💬 Kazan temizliği' && c.user_ids.length === 1 && c.user_ids[0] === M, JSON.stringify(c))
await as(M, (x) => x('update tasks set assignees=$2 where id=$1', [T, [S1, S2]]))
c = await lastCall()
ok('sonradan atanan bildirim alır', c.user_ids.length === 1 && c.user_ids[0] === S2, JSON.stringify(c))
ok('atanan görevi silemez', (await as(S1, (x) => x('delete from tasks where id=$1', [T]))).affectedRows === 0)
const T2 = (await rows(S1, "insert into tasks(title,assignees,created_by) values ('Kendi işim',$1,$2) returning id", [[S1], S1]))[0].id
ok('kendi görevini düzenler', (await as(S1, (x) => x("update tasks set title='Kendi işim 2' where id=$1", [T2]))).affectedRows === 1)

console.log('takvim, vardiya, üretim')
const E = (await rows(S1, "insert into events(title,start,location,participants,created_by) values ('Eğitim','2026-10-21T06:30:00Z','Salon',$1,$2) returning id", [[S1, S2], S1]))[0].id
c = await lastCall()
ok('etkinlik bildirimi (İstanbul saati)', c.body === '21.10.2026 09:30 · Salon' && c.user_ids[0] === S2, JSON.stringify(c))
ok('başkası etkinliği değiştiremez', (await as(S2, (x) => x("update events set title='h' where id=$1", [E]))).affectedRows === 0)
ok('yönetici değiştirir', (await as(M, (x) => x("update events set title='Eğitim 2' where id=$1", [E]))).affectedRows === 1)
await fails('personel vardiya giremez', S1, 'insert into shifts("user",date,kind) values ($1,\'2026-10-14\',\'morning\')', [S1], /row-level security/)
await as(M, (x) => x('insert into shifts("user",date,kind,start_time) values ($1,\'2026-10-14\',\'morning\',\'08:00\')', [S1]))
await fails('aynı gün iki vardiya olmaz', M, 'insert into shifts("user",date,kind) values ($1,\'2026-10-14\',\'night\')', [S1], /duplicate/)
await fails('geçersiz saat', M, 'insert into shifts("user",date,kind,start_time) values ($1,\'2026-10-15\',\'night\',\'25:00\')', [S1], /check/)
ok('vardiya tarihi metin', (await rows(S1, 'select date::text d from shifts'))[0].d === '2026-10-14')
await fails('personel üretim planı giremez', S1, "insert into production_plans(date,product,created_by) values ('2026-10-14','Bitter',$1)", [S1], /row-level security/)
await as(M, (x) => x("insert into production_plans(date,product,quantity,unit,created_by) values ('2026-10-14','Bitter',500,'kg',$1)", [M]))
await fails('personel birim ekleyemez', S1, "insert into departments(name) values ('x')", [], /row-level security/)

console.log('dosyalar')
const put = (uid, bucket, name) => as(uid, (x) => x('insert into storage.objects(bucket_id,name,owner_id) values ($1,$2,$3)', [bucket, name, uid]))
const ekler = (uid, like = '%') => rows(uid, "select * from storage.objects where bucket_id='ekler' and name like $1", [like])
await put(S1, 'ekler', `messages/${DC}/foto.jpg`)
ok('sohbet üyesi eki görür', (await ekler(S2)).length === 1)
ok('üye olmayan eki göremez', (await ekler(S3)).length === 0 && (await ekler(A)).length === 0)
await rejects('üye olmayan sohbete dosya yükleyemez', put(S3, 'ekler', `messages/${DC}/x.jpg`), /row-level/)
await rejects('personel duyuru eki yükleyemez', put(S1, 'ekler', `announcements/${AN}/a.pdf`), /row-level/)
await put(M, 'ekler', `announcements/${AN}/a.pdf`)
ok('duyuru eki: hedef birim görür, diğeri görmez', (await ekler(S1, 'announcements/%')).length === 1 && (await ekler(S2, 'announcements/%')).length === 0)
await rejects('bilinmeyen klasör reddedilir', put(S1, 'ekler', `baska/${AN}/a.pdf`), /row-level/)
await put(S1, 'ekler', `tasks/${T}/a.pdf`)
ok('görev eki: görevi gören görür', (await ekler(M, 'tasks/%')).length === 1 && (await ekler(S3, 'tasks/%')).length === 0)
await put(S1, 'avatars', `${S1}/a.jpg`)
await rejects('başkasının avatarı yüklenemez', put(S1, 'avatars', `${S2}/a.jpg`), /row-level/)

console.log('kullanıcı silme')
const X = await mk('silinecek', 'Silinecek Kişi', 'staff')
const G2 = (await rows(S1, "insert into conversations(type,name,members,created_by) values ('group','Üçlü',$1,$2) returning id", [[S1, S2, X], S1]))[0].id
const G3 = (await rows(X, "insert into conversations(type,name,members,created_by) values ('group','İkili',$1,$2) returning id", [[X, S3], X]))[0].id
const DX = (await rows(X, 'select (direct_conversation($1)).id', [S3]))[0].id
await as(M, (x) => x('update tasks set assignees=$2 where id=$1', [T, [S1, X]]))
await as(M, (x) => x('update events set participants=$2 where id=$1', [E, [S2, X]]))
await as(M, (x) => x('insert into shifts("user",date,kind) values ($1,\'2026-10-16\',\'off\')', [X]))
await fails('personel kullanıcı silemez', S1, 'select admin_delete_user($1)', [X], /yetkiniz yok/)
await fails('admin kendini silemez', A, 'select admin_delete_user($1)', [A], /Kendi hesabınızı/)
await fails('kayıt bırakmış kullanıcı silinemez', A, 'select admin_delete_user($1)', [S1], /pasifleştirin/)
await fails('olmayan kullanıcı', A, 'select admin_delete_user($1)', ['00000000-0000-0000-0000-000000000009'], /bulunamadı/)
await as(A, (x) => x('select admin_delete_user($1)', [X]))
ok('hesap ve profil silinir', (await db.query('select 1 from auth.users where id=$1', [X])).rows.length === 0 && (await db.query('select 1 from profiles where id=$1', [X])).rows.length === 0)
ok('gruptan çıkarılır', JSON.stringify((await one('select members from conversations where id=$1', [G2])).members) === JSON.stringify([S1, S2]))
ok('boş sohbetleri kapanır', (await db.query('select 1 from conversations where id = any($1)', [[G3, DX]])).rows.length === 0)
ok('görev ve etkinlikten çıkarılır', !(await one('select assignees from tasks where id=$1', [T])).assignees.includes(X) && !(await one('select participants from events where id=$1', [E])).participants.includes(X))
ok('vardiyası silinir', (await db.query('select 1 from shifts where "user"=$1', [X])).rows.length === 0)
await as(S1, (x) => x('select leave_conversation($1)', [G2]))

console.log('pasif kullanıcı ve birim silme')
await as(A, (x) => x('update profiles set active=false where id=$1', [S2]))
ok('pasif hesap engellenir', (await one('select banned_until from auth.users where id=$1', [S2])).banned_until !== null)
ok('pasif hesap hiçbir şey görmez', (await rows(S2, 'select * from profiles')).length === 0 && (await rows(S2, 'select * from conversations')).length === 0 && (await rows(S2, 'select * from events')).length === 0 && (await ekler(S2)).length === 0)
await fails('pasif hesap sayaç alamaz', S2, 'select unread_counts()', [], /Oturum/)
await fails('pasif hesap mesaj yazamaz', S2, "insert into messages(conversation,sender,text) values ($1,$2,'x')", [DC, S2], /row-level security/)
ok('pasif hesabın aboneliği silinir', (await db.query('select 1 from push_subscriptions where "user"=$1', [S2])).rows.length === 0)
await as(A, (x) => x('update profiles set active=true where id=$1', [S2]))
ok('yeniden açılır', (await one('select banned_until from auth.users where id=$1', [S2])).banned_until === null && (await rows(S2, 'select * from profiles')).length === 6)
await as(A, (x) => x('delete from departments where id=$1', [D1]))
ok('silinen birim listelerden çıkar', (await one('select departments from announcements')).departments.length === 0 && (await one('select department from profiles where id=$1', [S1])).department === null)
await db.exec("update private.settings set push_url=''")
const before = (await calls()).length
await as(S1, (x) => x("insert into messages(conversation,sender,text) values ($1,$2,'ayar yokken')", [DC, S1]))
ok('bildirim ayarı boşken mesaj yine gider', (await calls()).length === before)
await rejects('private şema API kullanıcısına kapalı', as(S1, (x) => x('select * from private.settings')), /permission denied/)
await rejects('private fonksiyon API kullanıcısına kapalı', as(S1, (x) => x("select private.create_user('hack','GucluSifre!2026','H','admin')")), /permission denied/)

console.log(`\n${pass} geçti, ${fail} kaldı`)
process.exit(fail ? 1 : 0)
