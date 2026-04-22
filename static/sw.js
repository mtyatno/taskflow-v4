const CACHE = "taskflow-v5-final-fix";
const STATIC = [
  // "/" sengaja tidak di-cache — selalu fetch dari network agar update langsung terlihat
  "/static/vendor/react.production.min.js",
  "/static/vendor/react-dom.production.min.js",
  "/static/vendor/babel.min.js",
  "/static/vendor/chart.umd.min.js",
  "/static/vendor/tailwind.min.css",
  "/manifest.json",
  "/static/icon-192.png",
  "/static/icon-512.png",
];

self.addEventListener("message", e => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(STATIC.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const { request } = e;
  const url = new URL(request.url);

  // Hanya proses skema http/https untuk menghindari error pada ekstensi browser
  if (!url.protocol.startsWith("http")) return;

  // HTML root ("/") — network-first + update cache
  // Saat online: selalu fetch terbaru dari server dan simpan ke cache
  // Saat offline: serve dari cache yang tersimpan terakhir kali online
  if (url.pathname === "/" && request.method === "GET") {
    e.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(request, clone));
          }
          return res;
        })
        .catch(() =>
          caches.match(request).then(cached =>
            cached || new Response("Offline — buka kembali saat terhubung ke internet", { status: 503 })
          )
        )
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
