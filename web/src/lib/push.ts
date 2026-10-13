import { rpc, run, supabase } from './db'

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'default' | 'enabled'

// Bildirimleri imzalayan anahtarın açık yarısı (gizli yarısı Edge Function'da durur; bkz. KURULUM.md).
const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? ''

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export async function getPushState(): Promise<PushState> {
  if (!VAPID_PUBLIC_KEY) return 'unsupported'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    // iPhone'da bildirim sadece ana ekrana eklenmiş uygulamada çalışır.
    return isIos() && !isStandalone() ? 'needs-install' : 'unsupported'
  }
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub && Notification.permission === 'granted' ? 'enabled' : 'default'
}

/** Bildirim izni ister, aboneliği oluşturur ve sunucuya kaydeder. */
export async function enablePush(): Promise<PushState> {
  if (!VAPID_PUBLIC_KEY) return 'unsupported'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'default'

  const reg = await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) }))

  await saveSubscription(sub)
  return 'enabled'
}

async function saveSubscription(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON()
  if (!json.endpoint || !json.keys) return
  // Veritabanı adresi doğrular; ortak cihazda abonelik yeni kullanıcıya devredilir.
  await rpc('save_push_subscription', {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys.p256dh,
    p_auth: json.keys.auth,
    p_user_agent: navigator.userAgent.slice(0, 300),
  })
}

/** Oturum açıldığında mevcut aboneliği sessizce sunucuyla eşitler. */
export async function syncPushSubscription(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('Notification' in window) || Notification.permission !== 'granted') return
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) await saveSubscription(sub).catch(() => undefined)
}

/** Çıkışta bu cihazın aboneliğini kaldırır ki başkasına bildirim gitmesin. */
export async function removePushSubscription(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await run(supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)).catch(() => undefined)
  await sub.unsubscribe().catch(() => undefined)
}
