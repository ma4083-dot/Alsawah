// ═══════════════════════════════════════════════════
//  Service Worker — Alsawah Lab
//  نظام كاش بسيط وموثوق — بدون reload تلقائي
// ═══════════════════════════════════════════════════

// CACHE_NAME ثابت — يتغير فقط لما تريد إجبار تحديث كامل
const CACHE_NAME = 'alsawah-v1';

const CDN_URLS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com'
];

const API_URLS = [
  'script.google.com',
  'googleapis.com'
];

// ─── INSTALL: كاش الملفات الأساسية فقط ─────────────
self.addEventListener('install', e => {
  console.log('[SW] Installing...');
  // skipWaiting فوري — لا انتظار
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll([
        './',
        './index.html',
        'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js'
      ]).catch(err => console.warn('[SW] cache.addAll جزئياً فشل:', err))
    )
  );
});

// ─── ACTIVATE: احذف الكاشات القديمة فقط ─────────────
self.addEventListener('activate', e => {
  console.log('[SW] Activating...');
  e.waitUntil(
    caches.keys()
      .then(keys => {
        const toDelete = keys.filter(k => k !== CACHE_NAME);
        if (toDelete.length) console.log('[SW] حذف كاش قديم:', toDelete);
        return Promise.all(toDelete.map(k => caches.delete(k)));
      })
      .then(() => self.clients.claim())
  );
});

// ─── رسائل من الصفحة ─────────────────────────────────
self.addEventListener('message', e => {
  // SKIP_WAITING: تفعيل فوري لو كان الـ SW في انتظار
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ─── FETCH ───────────────────────────────────────────
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = req.url;

  // 1. APIs — Network Only (لا كاش أبداً)
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

  // 2. CDN / Fonts — Cache First (ثابتة لا تتغير)
  if (CDN_URLS.some(u => url.includes(u))) {
    e.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(res => {
          if (res && res.status === 200)
            caches.open(CACHE_NAME).then(c => c.put(req, res.clone()));
          return res;
        }).catch(() => new Response('', { status: 503 }));
      })
    );
    return;
  }

  // 3. التطبيق — Network First + Cache Fallback
  //    يجرب الشبكة أولاً، لو فشل يرجع من الكاش
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.status === 200)
          caches.open(CACHE_NAME).then(c => c.put(req, res.clone()));
        return res;
      })
      .catch(() => {
        console.log('[SW] أوف لاين — من الكاش:', url);
        return caches.match(req)
          .then(cached => cached || caches.match('./index.html'));
      })
  );
});
