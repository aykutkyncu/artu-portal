import { pb } from './pb'

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'default' | 'enabled'

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
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'default'

  const reg = await navigator.serviceWorker.ready
  const { publicKey } = await pb.send<{ publicKey: string }>('/api/artu/push/key', {})
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }))

  await saveSubscription(sub)
  return 'enabled'
}

async function saveSubscription(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON()
  if (!pb.authStore.isValid || !json.endpoint || !json.keys) return
  // Sunucu adresi doğrular; ortak cihazda abonelik yeni kullanıcıya devredilir.
  await pb.send('/api/artu/push/subscribe', {
    method: 'POST',
    body: { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth, userAgent: navigator.userAgent.slice(0, 300) },
  })
}

/** Oturum açıldığında mevcut aboneliği sessizce sunucuyla eşitler. */
export async function syncPushSubscription(): Promise<void> {
  if (!('serviceWorker' in navigator) || Notification?.permission !== 'granted') return
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
  const record = await pb
    .collection('push_subscriptions')
    .getFirstListItem(pb.filter('endpoint = {:e}', { e: sub.endpoint }))
    .catch(() => null)
  if (record) await pb.collection('push_subscriptions').delete(record.id).catch(() => undefined)
  await sub.unsubscribe().catch(() => undefined)
}
