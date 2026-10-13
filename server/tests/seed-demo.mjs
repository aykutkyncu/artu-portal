// Tanıtım/deneme verisi yükler. SADECE test ortamında kullanın.
// Kullanım: node tests/seed-demo.mjs   (ADMIN_USER / ADMIN_PASS ortam değişkenleri)
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8090'
const PASS = 'Deneme12345'

async function api(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`)
  return data
}
const login = async (identity, password) => (await api(null, 'POST', '/api/collections/users/auth-with-password', { identity, password })).token
const col = (n) => `/api/collections/${n}/records`
const day = (offset) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}
const at = (offset, hour) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString().replace('T', ' ')
}

const admin = await login(process.env.ADMIN_USER ?? 'aykut', process.env.ADMIN_PASS ?? 'Test123456')
const me = (await api(admin, 'POST', '/api/collections/users/auth-refresh')).record

const deps = {}
for (const name of ['Yönetim', 'Üretim', 'Satış', 'Lojistik', 'Kalite', 'Muhasebe']) {
  deps[name] = (await api(admin, 'POST', col('departments'), { name })).id
}
await api(admin, 'PATCH', `${col('users')}/${me.id}`, { department: deps['Yönetim'], title: 'Genel Müdür' })

const people = [
  ['Mehmet Demir', 'mehmet.demir', 'manager', 'Üretim', 'Üretim Şefi'],
  ['Ayşe Kaya', 'ayse.kaya', 'manager', 'Satış', 'Satış Müdürü'],
  ['Ali Yıldız', 'ali.yildiz', 'staff', 'Üretim', 'Operatör'],
  ['Fatma Şahin', 'fatma.sahin', 'staff', 'Üretim', 'Operatör'],
  ['Emre Çelik', 'emre.celik', 'staff', 'Lojistik', 'Sevkiyat Sorumlusu'],
  ['Zeynep Arslan', 'zeynep.arslan', 'staff', 'Kalite', 'Kalite Kontrol'],
  ['Burak Öztürk', 'burak.ozturk', 'staff', 'Satış', 'Satış Temsilcisi'],
  ['Elif Aydın', 'elif.aydin', 'staff', 'Muhasebe', 'Muhasebe Uzmanı'],
]
const users = {}
for (const [name, username, role, dep, title] of people) {
  users[username] = await api(admin, 'POST', col('users'), {
    name, username, role, title, department: deps[dep], active: true, password: PASS, passwordConfirm: PASS, phone: '0532 000 00 00',
  })
}
const mehmet = await login('mehmet.demir', PASS)
const ali = await login('ali.yildiz', PASS)

await api(admin, 'POST', col('announcements'), {
  title: 'Artu Portal yayında! WhatsApp grupları yerine artık burayı kullanıyoruz',
  body: '<p>Değerli çalışma arkadaşlarımız,</p><p>Bugünden itibaren şirket içi duyurular, planlamalar ve yazışmalar <b>Artu Portal</b> üzerinden yapılacaktır.</p><ul><li>Duyurular → Duyurular sekmesi</li><li>Birebir ve grup yazışmalar → Mesajlar</li><li>Toplantılar ve izinler → Takvim</li></ul><p>Telefonunuza uygulama olarak eklemeyi ve bildirimleri açmayı unutmayın.</p>',
  author: me.id, departments: [], priority: 'important', pinned: true, requireAck: true,
})
await api(mehmet, 'POST', col('announcements'), {
  title: 'Cumartesi Hat 2 bakım çalışması',
  body: '<p>Cumartesi 08:00–14:00 arası Hat 2 temperleme makinesinde planlı bakım yapılacaktır. Üretim Hat 1 üzerinden devam edecek.</p>',
  author: users['mehmet.demir'].id, departments: [deps['Üretim']], priority: 'normal', pinned: false, requireAck: false,
})

const dm = await api(ali, 'POST', '/api/artu/conversations/direct', { userId: users['mehmet.demir'].id })
await api(ali, 'POST', col('messages'), { conversation: dm.id, sender: users['ali.yildiz'].id, text: 'Mehmet Bey günaydın, kakao yağı stoğu yarın akşama kadar yetecek gibi görünüyor.' })
await api(mehmet, 'POST', col('messages'), { conversation: dm.id, sender: users['mehmet.demir'].id, text: 'Tamam Ali, satın almaya bilgi veriyorum. Teşekkürler 👍' })

const group = await api(mehmet, 'POST', col('conversations'), {
  type: 'group', name: 'Üretim Ekibi', createdBy: users['mehmet.demir'].id,
  members: [users['mehmet.demir'].id, users['ali.yildiz'].id, users['fatma.sahin'].id, me.id],
})
await api(mehmet, 'POST', col('messages'), { conversation: group.id, sender: users['mehmet.demir'].id, text: 'Arkadaşlar bugünkü hedef 500 kg bitter tablet. Kolay gelsin!' })

await api(mehmet, 'POST', col('tasks'), {
  title: 'Hat 1 temperleme makinesi kalibrasyonu', description: 'Sıcaklık sensörlerini kontrol edip kalibrasyon formunu doldur.',
  assignees: [users['ali.yildiz'].id], createdBy: users['mehmet.demir'].id, priority: 'high', status: 'todo', dueDate: at(2, 18), department: deps['Üretim'],
})
await api(mehmet, 'POST', col('tasks'), {
  title: 'Haftalık hijyen kontrol listesi', assignees: [users['fatma.sahin'].id, users['ali.yildiz'].id],
  createdBy: users['mehmet.demir'].id, priority: 'normal', status: 'in_progress', dueDate: at(4, 18), department: deps['Üretim'],
})

await api(admin, 'POST', col('events'), { title: 'Haftalık koordinasyon toplantısı', start: at(1, 9), end: at(1, 10), category: 'meeting', location: 'Toplantı odası', createdBy: me.id, participants: [users['mehmet.demir'].id, users['ayse.kaya'].id] })
await api(admin, 'POST', col('events'), { title: 'Migros sevkiyatı', start: at(2, 14), end: at(2, 16), category: 'shipment', location: 'Rampa 2', createdBy: me.id, participants: [users['emre.celik'].id] })
await api(admin, 'POST', col('events'), { title: 'Gıda güvenliği eğitimi', start: at(3, 13), end: at(3, 15), category: 'training', createdBy: me.id, participants: [] })

for (const [u, kind, s, e] of [['ali.yildiz', 'morning', '08:00', '16:00'], ['fatma.sahin', 'evening', '16:00', '00:00'], ['mehmet.demir', 'office', '08:30', '18:00']]) {
  for (let i = -1; i < 5; i++) {
    await api(mehmet, 'POST', col('shifts'), { user: users[u].id, date: day(i), kind, startTime: s, endTime: e, department: deps['Üretim'] })
  }
}

for (const [p, q, done, line, status] of [['Bitter Tablet 80g', 500, 320, 'Hat 1', 'in_progress'], ['Sütlü Fındıklı 100g', 300, 0, 'Hat 2', 'planned'], ['Pralin Kutu 250g', 120, 120, 'El işçiliği', 'done']]) {
  await api(mehmet, 'POST', col('production_plans'), {
    date: day(0), product: p, quantity: q, producedQuantity: done, unit: p.includes('Kutu') ? 'koli' : 'kg', line, status, createdBy: users['mehmet.demir'].id, responsible: users['mehmet.demir'].id,
  })
}

console.log(`Demo verisi yüklendi. Kullanıcı şifreleri: ${PASS}`)
