// ══════════════════════════════════════════════════════════
// sw.js — Alsawah Lab Service Worker
// الإصدار: 5-6-sw-1
// يرفع مع index.html في نفس المجلد على GitHub Pages
// ══════════════════════════════════════════════════════════

const CACHE_NAME   = 'alsawah-v5-6';
const FONT_CACHE   = 'alsawah-fonts-v2';
const STATIC_CACHE = 'alsawah-static-v5-6';

// ──────────────────────────────────────────────
// الأصول الأساسية — تُحمَّل عند التثبيت
// ──────────────────────────────────────────────
const CORE_ASSETS = [
    './',
    './index.html',
    'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js'
];

// الأصول الخارجية (CDN) — تُخزَّن عند أول طلب
const EXTERNAL_ORIGINS = [
    'cdnjs.cloudflare.com'
];

// هذه النطاقات لا تُخزَّن مطلقاً (Google Apps Script)
const NO_CACHE_ORIGINS = [
    'script.google.com',
    'sheets.googleapis.com',
    'script.googleusercontent.com'
];

// ══════════════════════════════════════════════
// INSTALL — تثبيت وتخزين الأصول الأساسية
// ══════════════════════════════════════════════
self.addEventListener('install', event => {
    console.log('[SW] 🔧 تثبيت الإصدار:', CACHE_NAME);
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(CORE_ASSETS))
            .then(() => self.skipWaiting())
            .catch(err => {
                console.warn('[SW] تعذّر تخزين بعض الأصول:', err.message);
                return self.skipWaiting();
            })
    );
});

// ══════════════════════════════════════════════
// ACTIVATE — حذف الكاشات القديمة
// ══════════════════════════════════════════════
self.addEventListener('activate', event => {
    console.log('[SW] ✅ تفعيل الإصدار:', CACHE_NAME);
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME && key !== FONT_CACHE && key !== STATIC_CACHE)
                    .map(key => {
                        console.log('[SW] 🗑️ حذف كاش قديم:', key);
                        return caches.delete(key);
                    })
            )
        ).then(() => self.clients.claim())
    );
});

// ══════════════════════════════════════════════
// FETCH — استراتيجية الطلبات
// ══════════════════════════════════════════════
self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // ── 1. طلبات Google Apps Script — لا نتدخل أبداً ──
    if (NO_CACHE_ORIGINS.some(o => url.hostname.includes(o))) {
        return; // يمر مباشرة للشبكة بدون تدخل
    }

    // ── 2. Chart.js و CDN — Cache First ──
    if (url.hostname.includes('cdnjs.cloudflare.com')) {
        event.respondWith(
            caches.open(STATIC_CACHE).then(cache =>
                cache.match(req).then(cached => {
                    if (cached) return cached;
                    return fetch(req).then(resp => {
                        if (resp && resp.status === 200) {
                            cache.put(req, resp.clone());
                        }
                        return resp;
                    }).catch(() => cached || new Response('', { status: 503 }));
                })
            )
        );
        return;
    }

    // ── 3. الملف الرئيسي index.html — Network First مع Fallback ──
    // (يضمن دايماً آخر إصدار لما في نت، وأوف لاين يرجع المخزون)
    if (url.pathname === '/' ||
        url.pathname.endsWith('index.html') ||
        url.pathname.endsWith('/')) {
        event.respondWith(
            fetch(req)
                .then(resp => {
                    if (resp && resp.status === 200) {
                        caches.open(CACHE_NAME).then(c => c.put(req, resp.clone()));
                    }
                    return resp;
                })
                .catch(() => caches.match(req).then(cached => cached || caches.match('./index.html')))
        );
        return;
    }

    // ── 4. باقي الطلبات من نفس الأصل — Cache First ──
    if (url.origin === self.location.origin) {
        event.respondWith(
            caches.match(req).then(cached => {
                if (cached) return cached;
                return fetch(req).then(resp => {
                    if (resp && resp.status === 200 && resp.type !== 'opaque') {
                        caches.open(CACHE_NAME).then(c => c.put(req, resp.clone()));
                    }
                    return resp;
                }).catch(() => cached || new Response('', { status: 503 }));
            })
        );
        return;
    }
});

// ══════════════════════════════════════════════
// BACKGROUND SYNC — إرسال الطابور عند عودة النت
// ══════════════════════════════════════════════
self.addEventListener('sync', event => {
    if (event.tag === 'alsawah-sync-queue') {
        console.log('[SW] 🔄 Background Sync تفعّل');
        event.waitUntil(flushSyncQueue());
    }
});

async function flushSyncQueue() {
    // نرسل رسالة للصفحة الحالية لتقوم بالمزامنة
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
        client.postMessage({ type: 'SW_FLUSH_QUEUE' });
    }
}

// ══════════════════════════════════════════════
// رسائل من الصفحة
// ══════════════════════════════════════════════
self.addEventListener('message', event => {
    const msg = event.data;
    if (!msg) return;

    // تخطي الانتظار وتفعيل فوري
    if (msg.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    // حذف الكاش وإعادة التحميل (للتحديثات)
    if (msg.type === 'CLEAR_CACHE') {
        caches.keys().then(keys =>
            Promise.all(keys.map(k => caches.delete(k)))
        ).then(() => {
            if (event.source) event.source.postMessage({ type: 'CACHE_CLEARED' });
        });
    }
});

console.log('[SW] 📦 Alsawah Lab Service Worker v5-6 جاهز —', CACHE_NAME);
