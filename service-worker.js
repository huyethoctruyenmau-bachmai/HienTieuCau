/* Hiến tiểu cầu Bạch Mai - Service Worker 10.7 */
const CACHE_NAME = 'hien-tieu-cau-bm-v10-7';
const APP_SHELL = ['./', './index.html', './manifest.json', './icon-192-v5.3.png', './icon-512-v5.3.png', './apple-touch-icon-v5.3.png'];
const API_URL = 'https://script.google.com/macros/s/AKfycbw8uT0HvqtK3cv8hLVgqJv21VOaP5fY0Rno_lzDP0RYSqEZwS9zMIRV0LxmksTn9sRe/exec';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).catch(() => null));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    const clone = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
    return response;
  }).catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html'))));
});

let messagingReadyPromise;
async function ensureMessaging() {
  if (messagingReadyPromise) return messagingReadyPromise;
  messagingReadyPromise = (async () => {
    importScripts('https://www.gstatic.com/firebasejs/12.15.0/firebase-app-compat.js');
    importScripts('https://www.gstatic.com/firebasejs/12.15.0/firebase-messaging-compat.js');
    const response = await fetch(API_URL, {method:'POST', body:JSON.stringify({action:'public_bootstrap',data:{}})});
    const result = await response.json();
    const push = result && result.ok && result.data ? result.data.push : null;
    if (!push || !push.enabled) return null;
    if (!firebase.apps.length) firebase.initializeApp(push.firebaseConfig);
    const messaging = firebase.messaging();
    messaging.onBackgroundMessage(payload => {
      if (payload && payload.notification) return;
      const data = payload && payload.data || {};
      return self.registration.showNotification(data.title || 'Hiến tiểu cầu Bạch Mai', {
        body: data.body || 'Có thông tin đăng ký mới.',
        icon: './icon-192-v5.3.png',
        badge: './icon-192-v5.3.png',
        tag: data.appointmentId || 'new-registration',
        renotify: true,
        data: {url: data.url || './?admin=1&section=appointments'}
      });
    });
    return messaging;
  })().catch(error => { console.error('Firebase messaging init failed', error); return null; });
  return messagingReadyPromise;
}
ensureMessaging();

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data && event.notification.data.url || './?admin=1&section=appointments', self.registration.scope).href;
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list => {
    for (const client of list) {
      if ('focus' in client) { client.navigate(target); return client.focus(); }
    }
    return clients.openWindow ? clients.openWindow(target) : null;
  }));
});
