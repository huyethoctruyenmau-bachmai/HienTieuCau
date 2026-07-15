/* Hiến tiểu cầu Bạch Mai - Service Worker 11.7
 * Nhận Web Push trực tiếp ở top-level để không bỏ lỡ sự kiện khi thiết bị
 * đánh thức service worker từ trạng thái nền/khóa màn hình.
 */
const CACHE_NAME = 'hien-tieu-cau-bm-v11-7';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192-v5.3.png',
  './icon-512-v5.3.png',
  './apple-touch-icon-v5.3.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .catch(() => null)
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
  );
});

function readPushPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json() || {};
  } catch (error) {
    try {
      return { data: { body: event.data.text() } };
    } catch (ignored) {
      return {};
    }
  }
}

function normalisePushPayload(payload) {
  const notification = payload && payload.notification || {};
  const data = payload && payload.data || {};
  const fcmOptions = payload && (payload.fcmOptions || payload.fcm_options) || {};

  return {
    title: notification.title || data.title || 'Hiến tiểu cầu Bạch Mai',
    body: notification.body || data.body || 'Có thông tin đăng ký mới.',
    icon: notification.icon || data.icon || new URL('./icon-192-v5.3.png', self.registration.scope).href,
    badge: notification.badge || data.badge || new URL('./icon-192-v5.3.png', self.registration.scope).href,
    tag: notification.tag || data.appointmentId || 'new-registration',
    url: data.url || fcmOptions.link || './?admin=1&section=appointments',
    rawData: data
  };
}

self.addEventListener('push', event => {
  const payload = readPushPayload(event);
  const message = normalisePushPayload(payload);

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const visibleWindows = windows.filter(client => client.visibilityState === 'visible');

    if (visibleWindows.length) {
      visibleWindows.forEach(client => client.postMessage({
        type: 'BM_PUSH_MESSAGE',
        payload: {
          notification: { title: message.title, body: message.body },
          data: Object.assign({}, message.rawData, { url: message.url })
        }
      }));
      return;
    }

    await self.registration.showNotification(message.title, {
      body: message.body,
      icon: message.icon,
      badge: message.badge,
      tag: message.tag,
      renotify: true,
      data: { url: message.url }
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(
    event.notification.data && event.notification.data.url || './?admin=1&section=appointments',
    self.registration.scope
  ).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : null;
    })
  );
});
