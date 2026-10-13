// API yetki ve iş kuralı entegrasyon testleri.
// Kullanım: sunucu çalışırken  node --test tests/api.test.mjs
// Ortam: BASE_URL (varsayılan http://127.0.0.1:8090), ADMIN_USER, ADMIN_PASS
import { test, before } from 'node:test'
import assert from 'node:assert/strict'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8090'
const ADMIN_USER = process.env.ADMIN_USER ?? 'aykut'
const ADMIN_PASS = process.env.ADMIN_PASS ?? 'Test123456'
const RUN = Date.now().toString(36)
const PASS = 'Parola12345'

async function api(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, data: text ? JSON.parse(text) : null }
}

async function login(username, password = PASS) {
  const r = await api(null, 'POST', '/api/collections/users/auth-with-password', { identity: username, password })
  return r.status === 200 ? r.data.token : null
}

const ctx = {}
const col = (name) => `/api/collections/${name}/records`

before(async () => {
  ctx.admin = await login(ADMIN_USER, ADMIN_PASS)
  assert.ok(ctx.admin, 'admin girişi yapılamadı')

  const dep = async (name) => (await api(ctx.admin, 'POST', col('departments'), { name: `${name}-${RUN}` })).data.id
  ctx.uretim = await dep('Üretim')
  ctx.satis = await dep('Satış')

  const user = async (username, role, department, active = true) => {
    const r = await api(ctx.admin, 'POST', col('users'), {
      username: `${username}${RUN}`, name: username, role, department, active,
      password: PASS, passwordConfirm: PASS,
    })
    assert.equal(r.status, 200, JSON.stringify(r.data))
    return r.data
  }
  ctx.mudurU = await user('mudur', 'manager', ctx.uretim)
  ctx.aliU = await user('ali', 'staff', ctx.uretim)
  ctx.ayseU = await user('ayse', 'staff', ctx.satis)
  await user('pasif', 'staff', ctx.satis, false)

  ctx.mudur = await login(`mudur${RUN}`)
  ctx.ali = await login(`ali${RUN}`)
  ctx.ayse = await login(`ayse${RUN}`)
})

test('pasif kullanıcı giriş yapamaz', async () => {
  assert.equal(await login(`pasif${RUN}`), null)
})

test('personel kullanıcı oluşturamaz ve kendi rolünü değiştiremez', async () => {
  const c = await api(ctx.ali, 'POST', col('users'), { username: `x${RUN}`, name: 'x', role: 'admin', password: PASS, passwordConfirm: PASS })
  assert.notEqual(c.status, 200)
  const u = await api(ctx.ali, 'PATCH', `${col('users')}/${ctx.aliU.id}`, { role: 'admin' })
  assert.notEqual(u.status, 200)
  const ok = await api(ctx.ali, 'PATCH', `${col('users')}/${ctx.aliU.id}`, { title: 'Operatör' })
  assert.equal(ok.status, 200)
})

test('duyurular birime göre görünür, okunma takibi çalışır', async () => {
  const denied = await api(ctx.ali, 'POST', col('announcements'), { title: 'x', author: ctx.aliU.id, priority: 'normal' })
  assert.notEqual(denied.status, 200, 'personel duyuru yapamamalı')

  const ann = await api(ctx.mudur, 'POST', col('announcements'), {
    title: `Üretim duyurusu ${RUN}`, body: '<p>Yarın 08:00</p>', author: ctx.mudurU.id,
    departments: [ctx.uretim], priority: 'important', requireAck: true,
  })
  assert.equal(ann.status, 200, JSON.stringify(ann.data))

  assert.equal((await api(ctx.ali, 'GET', `${col('announcements')}/${ann.data.id}`)).status, 200)
  assert.equal((await api(ctx.ayse, 'GET', `${col('announcements')}/${ann.data.id}`)).status, 404)

  const before = await api(ctx.ali, 'GET', '/api/artu/unread')
  assert.equal(before.data.announcements, 1)

  const foreign = await api(ctx.ayse, 'POST', col('announcement_reads'), { announcement: ann.data.id, user: ctx.ayseU.id })
  assert.notEqual(foreign.status, 200, 'görmediği duyuruyu okundu işaretleyememeli')

  const read = await api(ctx.ali, 'POST', col('announcement_reads'), { announcement: ann.data.id, user: ctx.aliU.id })
  assert.equal(read.status, 200)
  assert.equal((await api(ctx.ali, 'GET', '/api/artu/unread')).data.announcements, 0)

  const reads = await api(ctx.mudur, 'GET', `${col('announcement_reads')}?filter=${encodeURIComponent(`announcement="${ann.data.id}"`)}`)
  assert.equal(reads.data.totalItems, 1, 'duyuru sahibi okuyanları görebilmeli')
})

test('birebir sohbet: tekil, gizli ve okunmamış sayısı doğru', async () => {
  const a = await api(ctx.ali, 'POST', '/api/artu/conversations/direct', { userId: ctx.ayseU.id })
  const b = await api(ctx.ayse, 'POST', '/api/artu/conversations/direct', { userId: ctx.aliU.id })
  assert.equal(a.status, 200)
  assert.equal(a.data.id, b.data.id, 'aynı iki kişi için tek sohbet olmalı')
  const conv = a.data.id

  const msg = await api(ctx.ali, 'POST', col('messages'), { conversation: conv, sender: ctx.aliU.id, text: 'Merhaba' })
  assert.equal(msg.status, 200, JSON.stringify(msg.data))

  assert.equal((await api(ctx.ali, 'POST', col('messages'), { conversation: conv, sender: ctx.aliU.id, text: '   ' })).status, 400)
  assert.notEqual((await api(ctx.mudur, 'POST', col('messages'), { conversation: conv, sender: ctx.mudurU.id, text: 'sızma' })).status, 200)
  assert.notEqual((await api(ctx.mudur, 'POST', col('messages'), { conversation: conv, sender: ctx.aliU.id, text: 'taklit' })).status, 200)

  const list = await api(ctx.mudur, 'GET', `${col('messages')}?filter=${encodeURIComponent(`conversation="${conv}"`)}`)
  assert.equal(list.data.totalItems, 0, 'üye olmayan mesajları görmemeli')

  assert.equal((await api(ctx.ayse, 'GET', '/api/artu/unread')).data.conversations[conv], 1)
  assert.equal((await api(ctx.ayse, 'POST', `/api/artu/conversations/${conv}/read`)).status, 204)
  assert.equal((await api(ctx.ayse, 'GET', '/api/artu/unread')).data.conversations[conv], undefined)

  const c = await api(ctx.ayse, 'GET', `${col('conversations')}/${conv}`)
  assert.equal(c.data.lastMessageText, 'Merhaba')
})

test('grup sohbeti: oluşturma, üye olmayanın eklenememesi, ayrılma', async () => {
  const bad = await api(ctx.ali, 'POST', col('conversations'), { type: 'group', name: 'X', members: [ctx.ayseU.id, ctx.mudurU.id], createdBy: ctx.aliU.id })
  assert.notEqual(bad.status, 200, 'kendini eklemeden grup açamamalı')

  const g = await api(ctx.mudur, 'POST', col('conversations'), { type: 'group', name: 'Vardiya', members: [ctx.mudurU.id, ctx.aliU.id, ctx.ayseU.id], createdBy: ctx.mudurU.id })
  assert.equal(g.status, 200, JSON.stringify(g.data))
  assert.equal((await api(ctx.ali, 'POST', `/api/artu/conversations/${g.data.id}/leave`)).status, 204)
  assert.equal((await api(ctx.ali, 'GET', `${col('conversations')}/${g.data.id}`)).status, 404)
})

test('görevler: atanan sadece durumu değiştirir, yabancı göremez', async () => {
  const t = await api(ctx.mudur, 'POST', col('tasks'), {
    title: 'Kalıp temizliği', assignees: [ctx.aliU.id], createdBy: ctx.mudurU.id, priority: 'high',
  })
  assert.equal(t.status, 200, JSON.stringify(t.data))
  assert.equal(t.data.status, 'todo')

  assert.equal((await api(ctx.ayse, 'GET', `${col('tasks')}/${t.data.id}`)).status, 404)
  assert.equal((await api(ctx.ali, 'PATCH', `${col('tasks')}/${t.data.id}`, { title: 'değişti' })).status, 403)

  const done = await api(ctx.ali, 'PATCH', `${col('tasks')}/${t.data.id}`, { status: 'done' })
  assert.equal(done.status, 200, JSON.stringify(done.data))
  assert.ok(done.data.completedAt, 'tamamlanma zamanı dolmalı')

  assert.notEqual((await api(ctx.ayse, 'POST', col('task_comments'), { task: t.data.id, author: ctx.ayseU.id, text: 'x' })).status, 200)
  assert.equal((await api(ctx.ali, 'POST', col('task_comments'), { task: t.data.id, author: ctx.aliU.id, text: 'Bitti' })).status, 200)
})

test('vardiya ve üretim planını sadece yönetici yazar', async () => {
  const shift = { user: ctx.aliU.id, date: '2026-10-12', kind: 'morning', startTime: '08:00', endTime: '16:00' }
  assert.notEqual((await api(ctx.ali, 'POST', col('shifts'), shift)).status, 200)
  assert.equal((await api(ctx.mudur, 'POST', col('shifts'), shift)).status, 200)
  assert.notEqual((await api(ctx.mudur, 'POST', col('shifts'), shift)).status, 200, 'aynı gün iki vardiya olmamalı')

  const plan = { date: '2026-10-12', product: 'Bitter Tablet 80g', quantity: 500, unit: 'kg', status: 'planned', createdBy: ctx.mudurU.id }
  assert.notEqual((await api(ctx.ali, 'POST', col('production_plans'), { ...plan, createdBy: ctx.aliU.id })).status, 200)
  assert.equal((await api(ctx.mudur, 'POST', col('production_plans'), plan)).status, 200)
})

test('takvim: herkes etkinlik ekler, başkasınınkini düzenleyemez', async () => {
  const ev = await api(ctx.ali, 'POST', col('events'), {
    title: 'Tedarikçi ziyareti', start: '2026-10-13 07:00:00.000Z', category: 'visit', createdBy: ctx.aliU.id, participants: [ctx.ayseU.id],
  })
  assert.equal(ev.status, 200, JSON.stringify(ev.data))
  assert.equal((await api(ctx.ayse, 'PATCH', `${col('events')}/${ev.data.id}`, { title: 'x' })).status, 404)
  assert.equal((await api(ctx.mudur, 'PATCH', `${col('events')}/${ev.data.id}`, { title: 'Ziyaret (güncellendi)' })).status, 200)
})

test('push anahtarı sadece giriş yapana verilir', async () => {
  assert.equal((await api(null, 'GET', '/api/artu/push/key')).status, 401)
  const r = await api(ctx.ali, 'GET', '/api/artu/push/key')
  assert.equal(r.status, 200)
  assert.ok(r.data.publicKey.length > 40)
})

test('ekler korumalı: giriş yapmadan ve yabancı tarafından indirilemez', async () => {
  const conv = (await api(ctx.ali, 'POST', '/api/artu/conversations/direct', { userId: ctx.mudurU.id })).data.id
  const fd = new FormData()
  fd.append('conversation', conv)
  fd.append('sender', ctx.aliU.id)
  fd.append('attachments', new Blob(['gizli rapor'], { type: 'text/plain' }), 'rapor.txt')
  const res = await fetch(`${BASE}${col('messages')}`, { method: 'POST', headers: { Authorization: ctx.ali }, body: fd })
  const msg = await res.json()
  assert.equal(res.status, 200, JSON.stringify(msg))
  const url = `${BASE}/api/files/messages/${msg.id}/${msg.attachments[0]}`

  assert.notEqual((await fetch(url)).status, 200, 'anonim indirme engellenmeli')
  const tokenFor = async (t) => (await api(t, 'POST', '/api/files/token')).data.token
  assert.notEqual((await fetch(`${url}?token=${await tokenFor(ctx.ayse)}`)).status, 200, 'sohbet dışı kişi indirememeli')
  assert.equal((await fetch(`${url}?token=${await tokenFor(ctx.mudur)}`)).status, 200, 'üye indirebilmeli')

  const exe = new FormData()
  exe.append('conversation', conv)
  exe.append('sender', ctx.aliU.id)
  exe.append('attachments', new Blob(['MZ'], { type: 'application/x-msdownload' }), 'virus.exe')
  assert.notEqual((await fetch(`${BASE}${col('messages')}`, { method: 'POST', headers: { Authorization: ctx.ali }, body: exe })).status, 200, 'exe yüklenememeli')
})

test('push aboneliği sadece gerçek push servislerine yapılabilir (SSRF koruması)', async () => {
  const bad = { endpoint: 'http://127.0.0.1:9/x', p256dh: 'a'.repeat(60), auth: 'b'.repeat(20) }
  assert.equal((await api(ctx.ali, 'POST', '/api/artu/push/subscribe', bad)).status, 400)
  assert.equal((await api(ctx.ali, 'POST', '/api/artu/push/subscribe', { ...bad, endpoint: 'https://fcm.googleapis.com.evil.example/x' })).status, 400)
  assert.notEqual((await api(ctx.ali, 'POST', col('push_subscriptions'), { ...bad, user: ctx.aliU.id })).status, 200, 'doğrudan kayıt kapalı olmalı')
  const ok = { ...bad, endpoint: `https://fcm.googleapis.com/fcm/send/test-${RUN}` }
  assert.equal((await api(ctx.ali, 'POST', '/api/artu/push/subscribe', ok)).status, 204)
  // Aynı cihaz başka kullanıcıya geçince abonelik devredilir
  assert.equal((await api(ctx.ayse, 'POST', '/api/artu/push/subscribe', ok)).status, 204)
  assert.equal((await api(ctx.ali, 'GET', col('push_subscriptions'))).data.totalItems, 0)
})

test('gruptan çıkarılan kişi eski mesajını değiştiremez', async () => {
  const g = (await api(ctx.mudur, 'POST', col('conversations'), { type: 'group', name: 'Geçici', members: [ctx.mudurU.id, ctx.aliU.id, ctx.ayseU.id], createdBy: ctx.mudurU.id })).data
  const m = (await api(ctx.ali, 'POST', col('messages'), { conversation: g.id, sender: ctx.aliU.id, text: 'ilk' })).data
  await api(ctx.mudur, 'PATCH', `${col('conversations')}/${g.id}`, { members: [ctx.mudurU.id, ctx.ayseU.id] })
  assert.notEqual((await api(ctx.ali, 'PATCH', `${col('messages')}/${m.id}`, { text: 'değişti' })).status, 200)
})

test('pasifleştirilen kullanıcının mevcut oturumu anında geçersiz olur', async () => {
  const u = (await api(ctx.admin, 'POST', col('users'), { username: `gecici${RUN}`, name: 'Geçici', role: 'staff', active: true, password: PASS, passwordConfirm: PASS })).data
  const token = await login(`gecici${RUN}`)
  assert.equal((await api(token, 'GET', '/api/artu/unread')).status, 200)
  await api(ctx.admin, 'PATCH', `${col('users')}/${u.id}`, { active: false })
  assert.equal((await api(token, 'GET', '/api/artu/unread')).status, 401)
})

// Giriş deneme hakkını tükettiği için EN SONDA çalışmalı.
// Dışarıdan gelen isteğin engellenmesi Go birim testinde (main_test.go) doğrulanır;
// burada yerel erişimin çalıştığı ve sahte IP başlıklarının hız sınırını etkilemediği kontrol edilir.
test('teknik panel yerelden açılır; sahte IP başlığı hız sınırını aşamaz', async () => {
  assert.equal((await fetch(`${BASE}/_/`)).status, 200, 'sunucunun kendisinden erişilebilmeli')

  let limited = false
  for (let i = 0; i < 40 && !limited; i++) {
    const res = await fetch(`${BASE}/api/collections/users/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `203.0.113.${i}`, 'CF-Connecting-IP': `198.51.100.${i}` },
      body: JSON.stringify({ identity: `yok${RUN}`, password: 'yanlis-sifre' }),
    })
    limited = res.status === 429
  }
  assert.ok(limited, 'başlık değiştirerek giriş deneme sınırı aşılmamalı')
})
