// ═══════════════════════════════════════════════════
//  Service Worker — نظام التحديث التلقائي
//  ⚠️ لا تعدّل هذا الملف يدوياً — النسخة تأتي تلقائياً من الـ HTML
// ═══════════════════════════════════════════════════

let CACHE = 'alsawah-init';

const CDN_URLS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com'
];

const API_URLS = [
  'script.google.com',
  'googleapis.com'
];

// ─── استقبال الـ version من الـ HTML ────────────────
self.addEventListener('message', async e => {
  if (e.data && e.data.type === 'APP_VERSION') {
    const newCache = 'alsawah-' + e.data.version;
    if (newCache !== CACHE) {
      console.log('[SW] نسخة جديدة:', newCache, '← كانت:', CACHE);
      const oldCache = CACHE;
      CACHE = newCache;
      await caches.delete(oldCache);
      const cache = await caches.open(CACHE);
      await cache.addAll(['./','./index.html']).catch(() => {});
      console.log('[SW] كاش جديد جاهز:', CACHE);
    }
  }
});

// ─── INSTALL ─────────────────────────────────────────
self.addEventListener('install', e => {
  console.log('[SW] Installing...');
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.allSettled([
        './',
        './index.html',
        'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js'
      ].map(url => fetch(url).then(r => { if (r.ok) c.put(url, r); }).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE: احذف كل الكاشات القديمة ──────────────
self.addEventListener('activate', e => {
  console.log('[SW] Activating...');
  e.waitUntil(
    caches.keys()
      .then(keys => {
        const old = keys.filter(k => k !== CACHE);
        if (old.length) console.log('[SW] حذف كاش قديم:', old);
        return Promise.all(old.map(k => caches.delete(k)));
      })
      .then(() => self.clients.claim())
  );
});

// ─── FETCH ───────────────────────────────────────────
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = req.url;

  // 1. APIs — Network Only
  if (API_URLS.some(u => url.includes(u))) {
    e.respondWith(
      fetch(req).catch(() =>
        new Response(JSON.stringify({ status: 'offline' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // 2. CDN / Fonts — Cache First
  if (CDN_URLS.some(u => url.includes(u))) {
    e.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(res => {
          if (res && res.status === 200)
            caches.open(CACHE).then(c => c.put(req, res.clone()));
          return res;
        }).catch(() => cached);
      })
    );
    return;
  }

  // 3. التطبيق — Network First + Cache Fallback
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.status === 200)
          caches.open(CACHE).then(c => c.put(req, res.clone()));
        return res;
      })
      .catch(() => {
        console.log('[SW] أوف لاين — من الكاش:', url);
        return caches.match(req).then(cached => cached || caches.match('./index.html'));
      })
  );
});
