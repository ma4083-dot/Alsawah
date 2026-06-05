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

// هذه النطاقات تمر للشبكة مباشرة بدون أي تدخل
const NO_CACHE_URLS = [
    'script.google.com',
    'sheets.googleapis.com',
    'script.googleusercontent.com',
    'firebaseio.com',
    'firebase.googleapis.com'
];

// ─── INSTALL: كاش الملفات الأساسية ───────────────────────
self.addEventListener('install', e => {
    console.log('[SW] 🔧 تثبيت...');
    e.waitUntil(
        caches.open(CACHE).then(async cache => {
            // كاش index.html بـ clone عشان الـ body ميتستهلكش
            try {
                var r1 = await fetch('./index.html');
                if (r1.ok) {
                    await cache.put('./index.html', r1.clone());
                    await cache.put('./', r1.clone());
                }
            } catch(err) {
                console.warn('[SW] install: فشل كاش index.html', err);
            }
            // كاش Chart.js
            try {
                var r2 = await fetch('https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js');
                if (r2.ok) await cache.put('https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js', r2);
            } catch(err) {
                console.warn('[SW] install: فشل كاش Chart.js', err);
            }
        }).then(() => {
            console.log('[SW] ✅ كاش جاهز:', CACHE);
            return self.skipWaiting();
        })
    );
});

// ─── ACTIVATE ─────────────────────────────────────────────
self.addEventListener('activate', e => {
    console.log('[SW] ✅ تفعيل...');
    e.waitUntil(
        caches.keys()
            .then(keys => {
                var old = keys.filter(k => k !== CACHE);
                if (old.length) console.log('[SW] 🗑️ حذف كاش قديم:', old);
                return Promise.all(old.map(k => caches.delete(k)));
            })
            .then(() => self.clients.claim())
            .then(async () => {
                var clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
                clients.forEach(function(client) { client.postMessage({ type: 'SW_UPDATED' }); });
            })
    );
});

// ─── استقبال رسائل من الـ HTML ────────────────────────────
self.addEventListener('message', async e => {
    if (!e.data) return;

    // تحديث تلقائي بالـ hash
    if (e.data.type === 'APP_VERSION') {
        var newCache = 'alsawah-' + e.data.version;
        if (newCache !== CACHE) {
            console.log('[SW] 🔄 نسخة جديدة:', newCache, '← كانت:', CACHE);
            var oldCache = CACHE;
            CACHE = newCache;
            // كاش index.html بالنسخة الجديدة
            try {
                var cache = await caches.open(CACHE);
                var r = await fetch('./index.html');
                if (r.ok) {
                    await cache.put('./index.html', r.clone());
                    await cache.put('./', r.clone());
                }
                await caches.delete(oldCache);
                console.log('[SW] ✅ كاش جديد جاهز:', CACHE);
            } catch(err) {
                console.warn('[SW] فشل تحديث الكاش:', err);
            }
        }
    }

    if (e.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    if (e.data.type === 'CLEAR_CACHE') {
        var keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
        if (e.source) e.source.postMessage({ type: 'CACHE_CLEARED' });
    }
});

// ─── FETCH ────────────────────────────────────────────────
self.addEventListener('fetch', e => {
    var req = e.request;
    if (req.method !== 'GET') return;

    var url = req.url;

    // 1. APIs & Firebase — لا تدخل، تمر للشبكة مباشرة
    if (NO_CACHE_URLS.some(function(u) { return url.includes(u); })) {
        return;
    }

    // 2. CDN / Fonts — Cache First
    if (CDN_URLS.some(function(u) { return url.includes(u); })) {
        e.respondWith(
            caches.match(req).then(function(cached) {
                if (cached) return cached;
                return fetch(req).then(function(res) {
                    if (res && res.status === 200)
                        caches.open(CACHE).then(function(c) { c.put(req, res.clone()); });
                    return res;
                }).catch(function() { return new Response('', { status: 503 }); });
            })
        );
        return;
    }

    // 3. التطبيق — Network First, Cache Fallback
    e.respondWith(
        fetch(req)
            .then(function(res) {
                // كاش النسخة الجديدة لو نجح
                if (res && res.status === 200) {
                    caches.open(CACHE).then(function(c) { c.put(req, res.clone()); });
                }
                return res;
            })
            .catch(function() {
                // أوف لاين — ارجع من الكاش
                console.log('[SW] 📦 أوف لاين — من الكاش:', url);
                return caches.match(req)
                    .then(function(cached) {
                        if (cached) return cached;
                        // fallback لـ index.html لأي URL مش موجود
                        return caches.match('./index.html');
                    });
            })
    );
});

// ─── BACKGROUND SYNC ──────────────────────────────────────
self.addEventListener('sync', e => {
    if (e.tag === 'alsawah-sync-queue') {
        console.log('[SW] 🔄 Background Sync تفعّل');
        e.waitUntil(
            self.clients.matchAll({ type: 'window', includeUncontrolled: true })
                .then(function(clients) {
                    clients.forEach(function(c) { c.postMessage({ type: 'SW_FLUSH_QUEUE' }); });
                })
        );
    }
});

console.log('[SW] 📦 Alsawah Lab Service Worker جاهز ✅');
