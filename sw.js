/* 家庭点餐 Service Worker：缓存优先 + 版本号，发布新版本时递增 VERSION 强制更新 */

const VERSION = '2';
const CACHE_NAME = 'family-order-v' + VERSION;
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
];

/* 安装：预缓存全部静态资源 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .catch((err) => console.warn('部分资源预缓存失败', err))
  );
  self.skipWaiting();
});

/* 激活：清掉旧版本缓存 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

/* 请求拦截：缓存优先，未命中走网络并回填缓存；离线时导航回退首页 */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: true })
      .then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        });
      })
      .catch(() => {
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('离线状态', { status: 503 });
      })
  );
});
