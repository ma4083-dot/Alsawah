// ═══════════════════════════════════════════════════
//  Service Worker — Alsawah Lab
//  v5 — أونلاين: أحدث نسخة دايماً | أوفلاين: من الكاش
// ═══════════════════════════════════════════════════
//
//  الفكرة:
//   • index.html (صفحة التطبيق)  → Network-First مع مهلة 4 ثواني، ولو الشبكة
//     ضعيفة أو مقطوعة يرجع من الكاش فوراً. كده التحديث يوصل من أول فتحة (مش
//     بعد فتحتين زي Stale-While-Revalidate) والتطبيق يفتح أوفلاين عادي.
//   • الخطوط والمكتبات (Google Fonts / cdnjs) → Cache-First، ويتم تخزينها وقت
//     التثبيت عشان الخطوط العربية والرسوم البيانية تشتغل أوفلاين.
//   • Firebase و GitHub و أي موقع تاني → الـ SW مايتدخلش خالص (نفس سلوك
//     المتصفح العادي)، عشان مزامنة الأرشيف وفحص التحديث ياخدوا بيانات حقيقية.
//   • Google Apps Script → شبكة فقط، ولو أوفلاين يرجّع {status:'offline'}.
//
//  ← مش لازم تغيّر رقم الكاش مع كل تحديث للتطبيق (index.html بيتحدث لوحده).
//    غيّره فقط لو عايز تمسح كل الكاش القديم إجبارياً.
const CACHE_NAME  = 'alsawah-v6';
const NAV_TIMEOUT = 4000; // مللي ثانية قبل ما نرجع للكاش لو الشبكة بطيئة

const CDN_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com'
];

// مكتبات لازم تتخزن حتى لو مش مكتوبة في index.html بشكل مباشر
const EXTRA_PRECACHE = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js'
];

// ─── المسارات: تعمل على أي مسار GitHub Pages ───
const SW_BASE   = self.location.href.replace(/\/sw\.js(\?.*)?$/, '/');
const SW_PATH   = new URL(SW_BASE).pathname;
const INDEX_URL = SW_BASE + 'index.html';

// ─── أدوات مساعدة ───
const keep = (e, p) => { try { e.waitUntil(p); } catch (_) {} };

function isGoogleApi(host) {
  if (host === 'fonts.googleapis.com') return false;
  return host === 'script.google.com' ||
         host === 'script.googleusercontent.com' ||
         host === 'googleapis.com' ||
         host.endsWith('.googleapis.com');
}

function isAppShell(url) {
  return url.pathname === SW_PATH || url.pathname === SW_PATH + 'index.html';
}

// نسخة نظيفة من الرد (المتصفح يرفض ردود Redirect في طلبات التنقل)
async function clean(res) {
  if (!res.redirected) return res;
  const body = await res.clone().blob();
  return new Response(body, { status: 200, statusText: 'OK', headers: res.headers });
}

async function cachePut(cache, url) {
  try {
    const res = await fetch(new Request(url, { mode: 'cors', credentials: 'omit' }));
    if (res.ok) { await cache.put(url, res.clone()); return res; }
  } catch (_) {}
  return null;
}

// خطوط جوجل: نخزّن ملفات العربي واللاتيني فقط وقت التثبيت (الباقي يتخزن عند أول استخدام)
async function cacheFontFiles(cache, css) {
  const want = new Set(['arabic', 'latin', 'latin-ext']);
  const re = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{[^}]*?url\(['"]?(https:[^)'"]+)/g;
  const files = new Set();
  let m;
  while ((m = re.exec(css))) if (want.has(m[1])) files.add(m[2]);
  await Promise.allSettled([...files].slice(0, 80).map(u => cachePut(cache, u)));
}

// ─── INSTALL ─────────────────────────────────────
async function precache() {
  const cache = await caches.open(CACHE_NAME);
  let html = '';

  // 1) index.html — نتخطى كاش المتصفح (GitHub Pages بيحفظه 10 دقائق) لضمان أحدث نسخة
  try {
    const res = await fetch(INDEX_URL, { cache: 'reload' });
    if (res.ok) { html = await res.clone().text(); await cache.put(INDEX_URL, res); }
  } catch (_) {
    console.warn('[SW] تعذّر جلب index.html وقت التثبيت');
  }

  // 2) الخطوط والمكتبات الخارجية المذكورة في الصفحة (اختياري — لو مفيش نت يتخطى)
  const found = new Set(EXTRA_PRECACHE);
  const re = /https:\/\/(?:fonts\.googleapis\.com|cdnjs\.cloudflare\.com)[^"'\s<>)`\\]+/g;
  (html.match(re) || []).forEach(u => {
    u = u.replace(/&amp;/g, '&');
    if (!u.includes('${')) found.add(u);
  });

  await Promise.allSettled([...found].slice(0, 12).map(async u => {
    const res = await cachePut(cache, u);
    if (res && u.startsWith('https://fonts.googleapis.com/')) {
      await cacheFontFiles(cache, await res.clone().text());
    }
  }));
}

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(precache());
});

// ─── ACTIVATE: احذف الكاشات القديمة (بعد نقل نسخة التطبيق لو لزم) ───
async function cleanup() {
  const keys   = await caches.keys();
  const olds   = keys.filter(k => k !== CACHE_NAME);
  const cache  = await caches.open(CACHE_NAME);

  // أمان: لو التثبيت اتم بدون index.html (مفيش نت وقتها) ننقل النسخة القديمة بدل ما نسيب التطبيق بدون أوفلاين
  if (!(await cache.match(INDEX_URL))) {
    for (const k of olds) {
      const old = await caches.open(k);
      const hit = await old.match(INDEX_URL);
      if (hit) { await cache.put(INDEX_URL, hit); break; }
    }
  }
  await Promise.all(olds.map(k => caches.delete(k)));
  await self.clients.claim();
}

self.addEventListener('activate', e => e.waitUntil(cleanup()));

// ─── رسائل من الصفحة ─────────────────────────────
self.addEventListener('message', e => {
  const t = e.data && e.data.type;
  if (t === 'SKIP_WAITING') self.skipWaiting();
  if (t === 'GET_VERSION' && e.source) e.source.postMessage({ type: 'SW_VERSION', cache: CACHE_NAME });
});

// ─── FETCH ───────────────────────────────────────
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.headers.has('range')) return;

  const url  = new URL(req.url);
  const host = url.hostname;

  // 1) Google Apps Script / APIs — شبكة فقط (لا كاش أبداً)
  if (isGoogleApi(host)) {
    e.respondWith(
      fetch(req).catch(() =>
        new Response(JSON.stringify({ status: 'offline' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // 2) الخطوط والمكتبات — Cache First
  if (CDN_HOSTS.includes(host)) {
    e.respondWith(cdnCacheFirst(e, req));
    return;
  }

  // 3) أي موقع خارجي تاني (Firebase, GitHub …) — مفيش تدخل
  if (url.origin !== self.location.origin) return;

  // 4) صفحات التطبيق — Network First بمهلة
  if (req.mode === 'navigate') {
    e.respondWith(handleNavigation(e, req, url));
    return;
  }

  // 5) باقي ملفات نفس الموقع — Stale While Revalidate
  e.respondWith(staleWhileRevalidate(e, req));
});

async function cdnCacheFirst(e, req) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(req.url, { ignoreVary: true });
  if (hit) return hit;
  try {
    const res = await fetch(new Request(req.url, { mode: 'cors', credentials: 'omit' }));
    if (res.ok) keep(e, cache.put(req.url, res.clone()));
    return res;
  } catch (_) {
    try { return await fetch(req); }
    catch (__) { return new Response('', { status: 503 }); }
  }
}

async function handleNavigation(e, req, url) {
  const cache = await caches.open(CACHE_NAME);
  const shell = isAppShell(url);
  const key   = shell ? INDEX_URL : req.url;

  // دايماً نسأل الشبكة (no-cache = تحقق سريع من السيرفر، مش من كاش المتصفح)
  const net = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
    .then(async res => {
      if (res && res.ok) {
        const fresh = await clean(res);
        keep(e, cache.put(key, fresh.clone()));
        return fresh;
      }
      return null;
    })
    .catch(() => null);
  keep(e, net);

  // لو الشبكة ردت بسرعة نستخدمها، غير كده نرجع للكاش والشبكة تكمل تحدّث في الخلفية
  const timer = new Promise(r => setTimeout(() => r(null), NAV_TIMEOUT));
  const first = await Promise.race([net, timer]);
  if (first) return first;

  const cached = await cache.match(key) || await cache.match(INDEX_URL);
  if (cached) return cached;

  // مفيش كاش: نستنى الشبكة لو لسه شغالة
  const late = await net;
  if (late) return late;

  return new Response(
    '<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<body dir="rtl" style="font-family:sans-serif;text-align:center;padding:48px 16px">' +
    '<h3>التطبيق غير متاح أوفلاين</h3><p>افتحه مرة واحدة أونلاين أولاً ليتم تخزينه على الجهاز.</p></body>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

async function staleWhileRevalidate(e, req) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);

  const net = fetch(req)
    .then(res => {
      if (res && res.ok && res.type === 'basic') keep(e, cache.put(req, res.clone()));
      return res;
    })
    .catch(() => null);
  keep(e, net);

  if (cached) return cached;
  const res = await net;
  return res || new Response('', { status: 504, statusText: 'offline' });
}
