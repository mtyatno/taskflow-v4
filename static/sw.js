const CACHE = "taskflow-v123-shared-lists";
const STATIC = [
  "/",  // app shell — di-cache saat install agar offline-first dari kunjungan pertama
  "/static/offline/ids.js",
  "/static/offline/db.js",
  "/static/offline/meta.js",
  "/static/offline/idmap.js",
  "/static/offline/outbox.js",
  "/static/offline/blobstore.js",
  "/static/offline/router.js",
  "/static/offline/tasklogic.js",
  "/static/offline/tagrepo.js",
  "/static/offline/taskrepo.js",
  "/static/offline/taskquery.js",
  "/static/offline/recurrence.js",
  "/static/offline/taskroutes.js",
  "/static/offline/hydrate.js",
  "/static/offline/syncpush.js",
  "/static/offline/syncpull.js",
  "/static/offline/syncconflict.js",
  "/static/offline/listsync.js",
  "/static/vendor/react.production.min.js",
  "/static/vendor/react-dom.production.min.js",
  "/static/vendor/chart.umd.min.js",
  "/static/vendor/marked.min.js",
  "/static/vendor/driver.iife.js",
  "/static/vendor/driver.css",
  "/static/vendor/milkdown.bundle.js",
  "/static/vendor/tailwind.min.css",
  "/static/vendor/katex/katex.min.js",
  "/static/vendor/katex/katex.min.css",
  "/static/vendor/katex/fonts/KaTeX_AMS-Regular.woff2",
  "/static/vendor/katex/fonts/KaTeX_Caligraphic-Bold.woff2",
  "/static/vendor/katex/fonts/KaTeX_Caligraphic-Regular.woff2",
  "/static/vendor/katex/fonts/KaTeX_Fraktur-Bold.woff2",
  "/static/vendor/katex/fonts/KaTeX_Fraktur-Regular.woff2",
  "/static/vendor/katex/fonts/KaTeX_Main-Bold.woff2",
  "/static/vendor/katex/fonts/KaTeX_Main-BoldItalic.woff2",
  "/static/vendor/katex/fonts/KaTeX_Main-Italic.woff2",
  "/static/vendor/katex/fonts/KaTeX_Main-Regular.woff2",
  "/static/vendor/katex/fonts/KaTeX_Math-BoldItalic.woff2",
  "/static/vendor/katex/fonts/KaTeX_Math-Italic.woff2",
  "/static/vendor/katex/fonts/KaTeX_SansSerif-Bold.woff2",
  "/static/vendor/katex/fonts/KaTeX_SansSerif-Italic.woff2",
  "/static/vendor/katex/fonts/KaTeX_SansSerif-Regular.woff2",
  "/static/vendor/katex/fonts/KaTeX_Script-Regular.woff2",
  "/static/vendor/katex/fonts/KaTeX_Size1-Regular.woff2",
  "/static/vendor/katex/fonts/KaTeX_Size2-Regular.woff2",
  "/static/vendor/katex/fonts/KaTeX_Size3-Regular.woff2",
  "/static/vendor/katex/fonts/KaTeX_Size4-Regular.woff2",
  "/static/vendor/katex/fonts/KaTeX_Typewriter-Regular.woff2",
  "/manifest.json",
  "/static/icon-192.png",
  "/static/icon-512.png",
  "/static/icon-new-task.svg",
];

self.addEventListener("message", e => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(STATIC.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .catch(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const { request } = e;
  const url = new URL(request.url);

  // Hanya proses skema http/https untuk menghindari error pada ekstensi browser
  if (!url.protocol.startsWith("http")) return;

  // /api/habit-templates — network-first + cache fallback for offline
  if (url.pathname === '/api/habit-templates' && request.method === 'GET') {
    e.respondWith(
      fetch(request).then(res => {
        if (res.ok) {
          caches.open(CACHE).then(c => c.put(request, res.clone()))
        }
        return res
      }).catch(() =>
        caches.match(request).then(cached =>
          cached || new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
        )
      )
    )
    return
  }

  // tldraw static files — cache-first
  if (url.pathname.startsWith('/static/vendor/tldraw/')) {
    e.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached
        return fetch(request).then(res => {
          if (res.ok) {
            caches.open(CACHE).then(c => c.put(request, res.clone()))
          }
          return res
        }).catch(() => cached || new Response('Offline', { status: 503 }))
      })
    )
    return
  }

  // HTML root ("/") — network-first jika ada query params (share target, ext-auth, dll)
  // Stale-while-revalidate hanya untuk "/" tanpa params
  if (url.pathname === "/" && request.method === "GET") {
    // URL dengan params: selalu ambil dari network (share target, ext-auth, dll)
    if (url.search) {
      e.respondWith(
        fetch(request).catch(() =>
          caches.match("/").then(cached =>
            cached || new Response("Offline — buka kembali saat terhubung ke internet", { status: 503 })
          ).catch(() => new Response("Offline", { status: 503 }))
        )
      );
      return;
    }
    // "/" tanpa params: stale-while-revalidate, fallback ke network jika cache error
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(request).then(cached => {
          const networkFetch = fetch(request).then(res => {
            if (res.ok) cache.put(request, res.clone()).catch(() => {});
            return res;
          }).catch(() =>
            cached || new Response("Offline — buka kembali saat terhubung ke internet", { status: 503 })
          );
          return cached || networkFetch;
        })
      ).catch(() => fetch(request))
    );
    return;
  }

  // GET /api/*: network-first, cache fallback (untuk offline reading)
  if (request.method === "GET" && url.pathname.startsWith("/api/")) {
    e.respondWith(
      fetch(request.clone())
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(request, clone));
          }
          return res;
        })
        .catch(() =>
          caches.match(request).then(cached =>
            cached || new Response(
              JSON.stringify({ detail: "OFFLINE" }),
              { status: 503, headers: { "Content-Type": "application/json" } }
            )
          )
        )
    );
    return;
  }

  // Mutasi API (POST/PUT/DELETE): network only, return 503 saat offline
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(
      fetch(request).catch(() => new Response(
        JSON.stringify({ detail: "OFFLINE" }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      ))
    );
    return;
  }

  // Static assets: cache-first
  e.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(request, clone));
        }
        return res;
      }).catch(() => cached || new Response("Offline", { status: 503 }));
    })
  );
});
