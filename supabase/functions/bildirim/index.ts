// Bildirim: veritabanı tetikleyicilerinin (private.notify) istediği bildirimi kullanıcıların
// telefonlarına / tarayıcılarına Web Push ile gönderir. Mesaj, duyuru, görev ve etkinlik bildirimleri buradan geçer.
//
// Neden sunucuda: bildirimi imzalayan VAPID özel anahtarı gizlidir, tarayıcıya konamaz.
// Kim çağırabilir: sadece veritabanı; istek "x-portal-secret" başlığındaki ortak anahtarla doğrulanır.
// Dışa bağımlılığı yoktur (şifreleme tarayıcı standardı WebCrypto ile yapılır: RFC 8291 + RFC 8292).
//
// Kurulum (Supabase paneli) — ayrıntısı KURULUM.md'de:
//   1) Edge Functions > Deploy a new function > Via Editor > ad: bildirim > bu dosyanın tamamını yapıştır
//      > "Verify JWT" KAPALI olmalı (istek veritabanından gelir, kullanıcı oturumu taşımaz) > Deploy
//   2) Edge Functions > Secrets: PUSH_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (node web/scripts/vapid.mjs üretir)
//      İsteğe bağlı: VAPID_SUBJECT (varsayılan mailto:it@artucikolata.com.tr)
// Veritabanındaki karşılığı: supabase/migrations/001_baslangic.sql (private.notify, private.settings)

const PUSH_SECRET = Deno.env.get('PUSH_SECRET') ?? ''
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:it@artucikolata.com.tr'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const SEND_TIMEOUT_MS = 15_000
const MESSAGE_TTL_SECONDS = 60 * 60 * 24 // 1 gün
const MAX_USERS = 500

// Tarayıcıların gerçek bildirim servisleri. Başka adrese istek atılmaz.
const ALLOWED_PUSH_HOSTS = [
  'fcm.googleapis.com', // Chrome, Edge (Android / masaüstü)
  'updates.push.services.mozilla.com', // Firefox
  '.notify.windows.com', // Edge (Windows)
  '.push.apple.com', // Safari / iOS
]

interface Subscription {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

interface Payload {
  title: string
  body: string
  url: string
  tag?: string
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0))
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

const utf8 = (value: string) => new TextEncoder().encode(value)

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function isAllowedEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint)
    if (u.protocol !== 'https:' || u.username || u.password) return false
    const host = u.hostname.toLowerCase()
    return ALLOWED_PUSH_HOSTS.some((allowed) => (allowed.startsWith('.') ? host.endsWith(allowed) : host === allowed))
  } catch {
    return false
  }
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8))
}

/** İçeriği alıcının anahtarlarıyla şifreler (RFC 8291, "aes128gcm"). */
export async function encrypt(plaintext: Uint8Array, p256dh: string, auth: string): Promise<Uint8Array> {
  const clientPublic = fromBase64Url(p256dh)
  const authSecret = fromBase64Url(auth)
  const clientKey = await crypto.subtle.importKey('raw', clientPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const serverKeys = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const serverPublic = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey))
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, serverKeys.privateKey, 256))

  const ikm = await hkdf(authSecret, shared, concat(utf8('WebPush: info\0'), clientPublic, serverPublic), 32)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const contentKey = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12)

  const aesKey = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['encrypt'])
  // Tek kayıt: içerik + 0x02 (son kayıt işareti)
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, concat(plaintext, new Uint8Array([2]))),
  )

  const recordSize = new Uint8Array([0, 0, 0x10, 0]) // 4096
  return concat(salt, recordSize, new Uint8Array([serverPublic.length]), serverPublic, ciphertext)
}

let vapidKey: Promise<CryptoKey> | null = null
function getVapidKey(): Promise<CryptoKey> {
  vapidKey ??= (() => {
    const pub = fromBase64Url(VAPID_PUBLIC_KEY)
    return crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', d: VAPID_PRIVATE_KEY, x: toBase64Url(pub.slice(1, 33)), y: toBase64Url(pub.slice(33, 65)), ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    )
  })()
  return vapidKey
}

/** Gönderenin kimliğini kanıtlayan imzalı başlık (RFC 8292, VAPID). */
export async function vapidAuthorization(endpoint: string): Promise<string> {
  const header = toBase64Url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = toBase64Url(
    utf8(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: VAPID_SUBJECT })),
  )
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await getVapidKey(), utf8(`${header}.${claims}`))
  return `vapid t=${header}.${claims}.${toBase64Url(new Uint8Array(signature))}, k=${VAPID_PUBLIC_KEY}`
}

function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...(init.headers ?? {}) },
  })
}

/** 'gone': abonelik artık geçersiz (uygulama kaldırılmış / izin geri alınmış), silinmeli. */
async function sendOne(sub: Subscription, message: Uint8Array): Promise<'sent' | 'gone' | 'failed'> {
  if (!isAllowedEndpoint(sub.endpoint)) return 'gone'
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuthorization(sub.endpoint),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(MESSAGE_TTL_SECONDS),
        Urgency: 'high',
      },
      body: await encrypt(message, sub.p256dh, sub.auth),
      redirect: 'error',
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })
    await res.body?.cancel()
    if (res.status === 404 || res.status === 410) return 'gone'
    if (!res.ok) console.warn(`bildirim reddedildi (${res.status}): ${new URL(sub.endpoint).hostname}`)
    return res.ok ? 'sent' : 'failed'
  } catch (err) {
    console.warn(`bildirim gönderilemedi: ${err instanceof Error ? err.message : err}`)
    return 'failed'
  }
}

export async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Geçersiz istek.' }, 405)
  if (!PUSH_SECRET || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return json({ error: 'Bildirim anahtarları (secrets) eksik.' }, 500)
  if (!sameSecret(req.headers.get('x-portal-secret') ?? '', PUSH_SECRET)) return json({ error: 'Yetkisiz.' }, 401)

  let input: { user_ids?: unknown; title?: unknown; body?: unknown; url?: unknown; tag?: unknown }
  try {
    input = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek.' }, 400)
  }
  const userIds = (Array.isArray(input.user_ids) ? input.user_ids : [])
    .filter((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id))
    .slice(0, MAX_USERS)
  if (userIds.length === 0) return json({ sent: 0, removed: 0, failed: 0 })

  const payload: Payload = {
    title: typeof input.title === 'string' && input.title ? input.title : 'Artu Portal',
    body: typeof input.body === 'string' ? input.body : '',
    url: typeof input.url === 'string' && input.url.startsWith('/') ? input.url : '/',
    ...(typeof input.tag === 'string' && input.tag ? { tag: input.tag } : {}),
  }
  const message = utf8(JSON.stringify(payload))

  const res = await rest(`push_subscriptions?select=id,endpoint,p256dh,auth&user=in.(${userIds.join(',')})`)
  if (!res.ok) return json({ error: 'Abonelikler okunamadı.', detail: await res.text() }, 500)
  const subs = (await res.json()) as Subscription[]

  const results = await Promise.all(subs.map((sub) => sendOne(sub, message)))
  const gone = subs.filter((_, i) => results[i] === 'gone').map((s) => s.id)
  if (gone.length > 0) await rest(`push_subscriptions?id=in.(${gone.join(',')})`, { method: 'DELETE' }).then((r) => r.body?.cancel())

  return json({
    sent: results.filter((r) => r === 'sent').length,
    removed: gone.length,
    failed: results.filter((r) => r === 'failed').length,
  })
}

Deno.serve(handle)
