// Edge Function'ı Node'da çalıştırır: şifrelemeyi bağımsız bir kütüphaneyle (http_ece) çözer, VAPID imzasını doğrular.
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
const ece = createRequire(import.meta.url)('http_ece')

const vapid = crypto.createECDH('prime256v1')
vapid.generateKeys()
const env = {
  PUSH_SECRET: 'ortak-anahtar',
  VAPID_PUBLIC_KEY: vapid.getPublicKey().toString('base64url'),
  VAPID_PRIVATE_KEY: Buffer.concat([Buffer.alloc(32), vapid.getPrivateKey()]).subarray(-32).toString('base64url'),
  SUPABASE_URL: 'https://proje.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
}
globalThis.Deno = { env: { get: (k) => env[k] }, serve: () => {} }

// Alıcı (telefon) tarafı
const phone = crypto.createECDH('prime256v1')
phone.generateKeys()
const authSecret = crypto.randomBytes(16)
const sub = (id, endpoint) => ({ id, endpoint, p256dh: phone.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') })
const subs = [
  sub('s-ok', 'https://fcm.googleapis.com/fcm/send/abc'),
  sub('s-gone', 'https://web.push.apple.com/gitmis'),
  sub('s-evil', 'https://192.168.2.116/logo'),
  sub('s-fail', 'https://updates.push.services.mozilla.com/wpush/v2/x'),
]

const seen = []
globalThis.fetch = async (url, init = {}) => {
  url = String(url)
  seen.push({ url, init })
  if (url.startsWith(env.SUPABASE_URL)) {
    if (init.headers.apikey !== 'service-key') return new Response('no', { status: 401 })
    return init.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json(subs)
  }
  if (url.includes('gitmis')) return new Response('gone', { status: 410 })
  if (url.includes('mozilla')) return new Response('err', { status: 500 })
  return new Response(null, { status: 201 })
}

const { handle, isAllowedEndpoint } = await import(new URL('../functions/bildirim/index.ts', import.meta.url).href)
let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond ? '' : ' ' + extra))
}
const call = (body, secret = 'ortak-anahtar', method = 'POST') =>
  handle(new Request('https://proje.supabase.co/functions/v1/bildirim', { method, headers: { 'x-portal-secret': secret }, body: method === 'POST' ? JSON.stringify(body) : undefined }))

ok('yanlış anahtar reddedilir', (await call({}, 'yanlis')).status === 401)
ok('GET reddedilir', (await call({}, 'ortak-anahtar', 'GET')).status === 405)
ok('adres denetimi', isAllowedEndpoint('https://fcm.googleapis.com/x') && isAllowedEndpoint('https://db5p.notify.windows.com/w') && !isAllowedEndpoint('http://fcm.googleapis.com/x') && !isAllowedEndpoint('https://fcm.googleapis.com.evil.com/x') && !isAllowedEndpoint('https://evilpush.apple.com.tr/x') && !isAllowedEndpoint('https://fcm.googleapis.com@10.0.0.1/x'))
const empty = await call({ user_ids: ['bozuk'], title: 'x' })
ok('geçersiz kullanıcı listesi', empty.status === 200 && (await empty.json()).sent === 0 && seen.length === 0)

const payload = { user_ids: ['11111111-1111-1111-1111-111111111111'], title: '🚨 ACİL: Toplantı', body: 'Yarın 10:00 – çikolata şöleni', url: '/duyurular/1', tag: 'ann-1' }
const res = await call(payload)
const out = await res.json()
ok('sonuç sayıları', res.status === 200 && out.sent === 1 && out.removed === 2 && out.failed === 1, JSON.stringify(out))
ok('abonelik sorgusu', seen[0].url === `${env.SUPABASE_URL}/rest/v1/push_subscriptions?select=id,endpoint,p256dh,auth&user=in.(${payload.user_ids[0]})`, seen[0].url)
ok('iç ağ adresine istek atılmadı', !seen.some((s) => s.url.includes('192.168')))
const del = seen.find((s) => s.init.method === 'DELETE')
ok('geçersiz abonelikler silinir', del?.url.endsWith('push_subscriptions?id=in.(s-gone,s-evil)'), del?.url)

const push = seen.find((s) => s.url.includes('fcm.googleapis.com'))
const h = push.init.headers
ok('başlıklar', h['Content-Encoding'] === 'aes128gcm' && h.TTL === '86400' && h.Authorization.startsWith('vapid t='), JSON.stringify(h))

// Şifre çözme: telefonun özel anahtarıyla, bağımsız kütüphane
const plain = ece.decrypt(Buffer.from(push.init.body), { version: 'aes128gcm', privateKey: phone, authSecret })
const got = JSON.parse(plain.toString('utf8'))
ok('telefon içeriği çözebiliyor', got.title === payload.title && got.body === payload.body && got.url === payload.url && got.tag === payload.tag, plain.toString('utf8'))

// VAPID imzası: açık anahtarla doğrulama
const [, token, key] = /^vapid t=([^,]+), k=(.+)$/.exec(h.Authorization)
const [hd, cl, sig] = token.split('.')
const claims = JSON.parse(Buffer.from(cl, 'base64url'))
ok('VAPID bilgileri', key === env.VAPID_PUBLIC_KEY && claims.aud === 'https://fcm.googleapis.com' && claims.sub.startsWith('mailto:') && claims.exp > Date.now() / 1000 && claims.exp < Date.now() / 1000 + 24 * 3600, JSON.stringify(claims))
const pub = vapid.getPublicKey()
const publicKey = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' })
ok('VAPID imzası geçerli', crypto.verify('sha256', Buffer.from(`${hd}.${cl}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')))

console.log(`\n${pass} geçti, ${fail} kaldı`)
process.exit(fail ? 1 : 0)
