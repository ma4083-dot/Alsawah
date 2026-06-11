// ═══════════════════════════════════════════════════
//  Service Worker — Alsawah Lab
//  v3 — Stale-While-Revalidate + GitHub Pages آمن
// ═══════════════════════════════════════════════════

// ← غيّر الرقم هنا فقط لما تريد إجبار تحديث كامل للكاش
const CACHE_NAME = 'alsawah-v3';

const CDN_URLS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com'
];

const API_URLS = [
  'script.google.com',
  'googleapis.com'
];

// ─── الـ URL الكامل الصحيح — يعمل على أي مسار GitHub Pages ───
const SW_BASE   = self.location.href.replace(/\/sw\.js(\?.*)?$/, '/');
const INDEX_URL = SW_BASE + 'index.html';

// ─── INSTALL: كاش index.html فوراً ──────────────────
self.addEventListener('install', e => {
  console.log('[SW] v3 Installing... base:', SW_BASE);
  self.skipWaiting();

  e.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // الخطوة 1: index.html (الأهم) — لازم ينجح
      try {
        await cache.add(INDEX_URL);
        console.log('[SW] ✅ index.html محفوظ في الكاش');
      } catch (err) {
        console.warn('[SW] ⚠️ فشل تكييش index.html:', err.message);
      }

      // الخطوة 2: ROOT URL أيضاً (لو المستخدم فتح بدون index.html)
      try {
        const rootRes = await fetch(SW_BASE);
        if (rootRes.ok) await cache.put(SW_BASE, rootRes);
      } catch (_) {}

      // الخطوة 3: CDN (اختياري — لو مش في نت يتخطى)
      try {
        await cache.add('https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js');
      } catch (_) {
        console.warn('[SW] CDN offline أثناء التثبيت — سيُحمَّل لاحقاً');
      }
    })
  );
});

// ─── ACTIVATE: احذف الكاشات القديمة ────────────────
self.addEventListener('activate', e => {
  console.log('[SW] v3 Activating...');
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] حذف كاش قديم:', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim())
  );
});

// ─── رسائل من الصفحة ─────────────────────────────────
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// ─── FETCH ───────────────────────────────────────────
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = req.url;

  // ── 1. APIs — Network Only (لا كاش أبداً) ───────────
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

  // ── 2. CDN / Fonts — Cache First ────────────────────
  if (CDN_URLS.some(u => url.includes(u))) {
    e.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(res => {
          if (res?.ok)
            caches.open(CACHE_NAME).then(c => c.put(req, res.clone()));
          return res;
        }).catch(() => new Response('', { status: 503 }));
      })
    );
    return;
  }

  // ── 3. التطبيق — Stale-While-Revalidate ─────────────
  //    يرجع من الكاش فوراً (سريع + يعمل أوف لاين)
  //    ويحدّث الكاش في الخلفية لو في نت
  e.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(req);

      // تحديث في الخلفية (بدون انتظار)
      const fetchPromise = fetch(req).then(res => {
        if (res?.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);

      if (cached) {
        // ← يرجع من الكاش فوراً، الشبكة تشتغل في الخلفية
        return cached;
      }

      // مش في الكاش — ننتظر الشبكة
      const netRes = await fetchPromise;
      if (netRes) return netRes;

      // لا كاش ولا شبكة — نرجع index.html كـ fallback
      console.log('[SW] أوف لاين ومش في الكاش — fallback لـ index.html:', url);
      return (
        await cache.match(INDEX_URL) ||
        await cache.match(SW_BASE)   ||
        new Response('التطبيق غير متاح أوف لاين — يرجى فتحه مرة واحدة أونلاين أولاً', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        })
      );
    })
  );
});
