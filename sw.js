// ═══════════════════════════════════════════════════════════
//  sw.js — Alsawah Lab Service Worker
//  ⚠️ لا تعدّل هذا الملف يدوياً — النسخة تأتي تلقائياً من الـ HTML
//  يرفع مع index.html في نفس المجلد على GitHub Pages — مرة واحدة فقط
// ═══════════════════════════════════════════════════════════

let CACHE = 'alsawah-init';

const CDN_URLS = [
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdnjs.cloudflare.com'
];

// هذه النطاقات لا تُخزَّن — تمر للشبكة مباشرة بدون أي تدخل
const NO_CACHE_URLS = [
    'script.google.com',
    'sheets.googleapis.com',
    'script.googleusercontent.com',
    'firebaseio.com',
    'firebase.googleapis.com'
];

// ─── استقبال الـ version hash من الـ HTML ────────────────
self.addEventListener('message', async e => {
    if (e.data && e.data.type === 'APP_VERSION') {
        const newCache = 'alsawah-' + e.data.version;
        if (newCache !== CACHE) {
            console.log('[SW] 🔄 نسخة جديدة:', newCache, '← كانت:', CACHE);
            const oldCache = CACHE;
            CACHE = newCache;
            await caches.delete(oldCache);
            const cache = await caches.open(CACHE);
            await cache.addAll(['./', './index.html']).catch(() => {});
            console.log('[SW] ✅ كاش جديد جاهز:', CACHE);
        }
    }

    if (e.data && e.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    if (e.data && e.data.type === 'CLEAR_CACHE') {
        caches.keys().then(keys =>
            Promise.all(keys.map(k => caches.delete(k)))
        ).then(() => {
            if (e.source) e.source.postMessage({ type: 'CACHE_CLEARED' });
        });
    }
});

// ─── INSTALL ──────────────────────────────────────────────
self.addEventListener('install', e => {
    console.log('[SW] 🔧 تثبيت...');
    e.waitUntil(
        caches.open(CACHE).then(cache =>
            Promise.allSettled([
                './',
                './index.html',
                'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js'
            ].map(url =>
                fetch(url).then(r => { if (r.ok) cache.put(url, r); }).catch(() => {})
            ))
        ).then(() => self.skipWaiting())
    );
});

// ─── ACTIVATE ─────────────────────────────────────────────
self.addEventListener('activate', e => {
    console.log('[SW] ✅ تفعيل...');
    e.waitUntil(
        caches.keys()
            .then(keys => {
                const old = keys.filter(k => k !== CACHE);
                if (old.length) console.log('[SW] 🗑️ حذف كاش قديم:', old);
                return Promise.all(old.map(k => caches.delete(k)));
            })
            .then(() => self.clients.claim())
            .then(async () => {
                const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
                clients.forEach(client => client.postMessage({ type: 'SW_UPDATED' }));
            })
    );
});

// ─── FETCH ────────────────────────────────────────────────
self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET') return;

    const url = req.url;

    // 1. APIs & Firebase — لا تدخل أبداً، تمر للشبكة مباشرة
    if (NO_CACHE_URLS.some(u => url.includes(u))) {
        return; // بدون e.respondWith — يمر للشبكة طبيعي
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
                }).catch(() => new Response('', { status: 503 }));
            })
        );
        return;
    }

    // 3. التطبيق نفسه — Network First + Cache Fallback
    e.respondWith(
        fetch(req)
            .then(res => {
                if (res && res.status === 200)
                    caches.open(CACHE).then(c => c.put(req, res.clone()));
                return res;
            })
            .catch(() => {
                console.log('[SW] 📦 أوف لاين — من الكاش:', url);
                return caches.match(req).then(cached => cached || caches.match('./index.html'));
            })
    );
});

// ─── BACKGROUND SYNC ──────────────────────────────────────
self.addEventListener('sync', e => {
    if (e.tag === 'alsawah-sync-queue') {
        console.log('[SW] 🔄 Background Sync تفعّل');
        e.waitUntil(
            self.clients.matchAll({ type: 'window', includeUncontrolled: true })
                .then(clients => clients.forEach(c => c.postMessage({ type: 'SW_FLUSH_QUEUE' })))
        );
    }
});

console.log('[SW] 📦 Alsawah Lab Service Worker جاهز — auto-hash system ✅');
