const CACHE = "taskflow-v1";
const STATIC = [
  "/",
  "/static/index.html",
  "/static/vendor/react.production.min.js",
  "/static/vendor/react-dom.production.min.js",
  "/static/vendor/babel.min.js",
  "/static/vendor/chart.umd.min.js",
  "/static/vendor/tailwind.min.css",
  "/static/manifest.json",
  "/static/logo.png",
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // API calls: network-first, fallback to nothing (let app handle error)
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(
      fetch(e.request).catch(() => new Response(
        JSON.stringify({ detail: "Offline — tidak ada koneksi" }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      ))
    );
    return;
  }

  // Static assets: cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
