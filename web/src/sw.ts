/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { clientsClaim } from 'workbox-core'

declare let self: ServiceWorkerGlobalScope

self.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// SPA: sayfa gezintileri index.html'e düşsün.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')))

interface PushPayload {
  title: string
  body: string
  url: string
  tag?: string
}

self.addEventListener('push', (event) => {
  let data: PushPayload = { title: 'Artu Portal', body: '', url: '/' }
  try {
    data = { ...data, ...(event.data?.json() as Partial<PushPayload>) }
  } catch {
    data.body = event.data?.text() ?? ''
  }

  event.waitUntil(
    (async () => {
      // Kullanıcı ilgili sayfayı zaten açık ve odaklı tutuyorsa bildirim gösterme.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const focusedOnTarget = windows.some((c) => c.focused && new URL(c.url).pathname === data.url)
      if (focusedOnTarget) return

      // renotify: aynı sohbetten gelen her mesajda tekrar ses/titreşim (TS tiplerinde henüz yok).
      const options: NotificationOptions & { renotify?: boolean } = {
        body: data.body,
        tag: data.tag,
        renotify: Boolean(data.tag),
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: { url: data.url },
      }
      await self.registration.showNotification(data.title, options)
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? '/'

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        if ('focus' in client) {
          await client.focus()
          client.postMessage({ type: 'navigate', url })
          return
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})
