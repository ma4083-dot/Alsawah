// ═══════════════════════════════════════════════════
//  Service Worker — Alsawah Lab
//  نظام كاش موثوق — يعمل على GitHub Pages وأوف لاين
// ═══════════════════════════════════════════════════

// CACHE_NAME ثابت — يتغير فقط لما تريد إجبار تحديث كامل
const CACHE_NAME = 'alsawah-v2';

const CDN_URLS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com'
];

const API_URLS = [
  'script.google.com',
  'googleapis.com'
];

// ─── الـ URL الكامل لـ index.html (يُحسب من موقع الـ SW) ─────
// هذا يضمن أن الكاش يعمل صح سواء على localhost أو GitHub Pages
const SW_BASE = self.location.href.replace(/sw\.js.*$/, '');
const INDEX_URL = SW_BASE + 'index.html';
const ROOT_URL  = SW_BASE;

// ─── INSTALL: كاش الملفات الأساسية فقط ─────────────
self.addEventListener('install', e => {
  console.log('[SW] Installing... base:', SW_BASE);
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // نكاش index.html أولاً (الأهم) — منفصلين عشان لو CDN فشل ما يوقف الكل
      return cache.addAll([ROOT_URL, INDEX_URL])
        .then(() => {
          // CDN بشكل منفصل — لو فشل (مثلاً مش في نت) لا يوقف التثبيت
          return cache.add('https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js')
            .catch(err => console.warn('[SW] CDN cache فشل (عادي لو أوف لاين):', err));
        })
        .catch(err => console.warn('[SW] index.html cache فشل:', err));
    })
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
  //    يجرب الشبكة أولاً (مع timeout 4 ثواني)، لو فشل يرجع من الكاش
  e.respondWith(
    Promise.race([
      fetch(req).then(res => {
        // نحفظ في الكاش لو الرد صحيح
        if (res && res.status === 200) {
          caches.open(CACHE_NAME).then(c => c.put(req, res.clone()));
        }
        return res;
      }),
      // timeout: لو الشبكة بطيئة — بعد 4 ثواني نرجع من الكاش
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 4000)
      )
    ]).catch(() => {
      console.log('[SW] أوف لاين أو بطيء — من الكاش:', url);
      return caches.match(req).then(cached => {
        if (cached) return cached;
        // Fallback: أي طلب للتطبيق نرجع index.html (SPA navigation)
        // نستخدم URL الكامل المحسوب مسبقاً — لا relative URL
        return caches.match(INDEX_URL)
          || caches.match(ROOT_URL);
      });
    })
  );
});
