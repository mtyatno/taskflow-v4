const CACHE = "taskflow-v450-android-notif-fix";
// Cache suara latar terpisah: TIDAK ikut dihapus saat versi SW naik (file besar, tidak pernah berubah per nama-versi).
const AMBIENT_CACHE = "alurik-ambient-v1";
const STATIC = [
  "/",  // app shell — di-cache saat install agar offline-first dari kunjungan pertama
  "/static/ui-components.js",
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
  "/static/offline/projectcache.js",
  "/static/offline/contextcache.js",
  "/static/offline/kanbanboard.js",
  "/static/offline/recurrence.js",
  "/static/offline/taskroutes.js",
  "/static/offline/hydrate.js",
  "/static/offline/syncpush.js",
  "/static/offline/syncpull.js",
  "/static/offline/syncconflict.js",
  "/static/offline/listsync.js",
  "/static/offline/workspacepins.js",
  "/static/offline/wsmanage.js",
  "/static/offline/introgate.js",
  "/static/offline/accountbanner.js",
  "/static/offline/focuspage.js",
  "/static/offline/pomologic.js",
  "/static/offline/pomolog.js",
  "/static/offline/ambient.js",
  "/static/review/digest.js",
  "/static/offline/voicedictate.js",
  "/static/offline/drawdirective.js",
  "/static/offline/mediadirective.js",
  "/static/offline/mediaupload.js",
  "/static/offline/mediacard.js",
  "/static/offline/safehtml.js",
  "/static/offline/habitlogic.js",
  "/static/offline/habitrepo.js",
  "/static/offline/habitquery.js",
  "/static/offline/habithydrate.js",
  "/static/offline/habitroutes.js",
  "/static/offline/notelogic.js",
  "/static/offline/noterepo.js",
  "/static/offline/notequery.js",
  "/static/offline/notehydrate.js",
  "/static/offline/commentanchor.js",
  "/static/offline/commentrepo.js",
  "/static/offline/noteroutes.js",
  "/static/offline/notetrash.js",
  "/static/offline/drawingtabs.js",
  "/static/offline/drawingrepo.js",
  "/static/offline/drawingshare.js",
  "/static/offline/drawingroutes.js",
  "/static/offline/mindmapoutline.js",
  "/static/offline/mindmaplinks.js",
  "/static/offline/mindmaptrash.js",
  "/static/offline/mindmaplive.js",
  "/static/offline/mindmapops.js",
  "/static/offline/notemap.js",
  "/static/offline/notemapsession.js",
  "/static/offline/mindmaptabs.js",
  "/static/offline/mindmapjustify.js",
  "/static/offline/mindmapmerge.js",
  "/static/offline/mindmaprepo.js",
  "/static/offline/mindmaproutes.js",
  "/static/offline/chatrepo.js",
  "/static/offline/chatroutes.js",
  "/static/offline/commentroutes.js",
  "/static/vendor/tldraw/index.html",
  "/static/vendor/tldraw/assets/index.js",
  "/static/vendor/tldraw/assets/index.css",
  "/static/vendor/react.production.min.js",
  "/static/vendor/react-dom.production.min.js",
  "/static/vendor/chart.umd.min.js",
  "/static/vendor/marked.min.js",
  "/static/vendor/prism.min.css",
  "/static/vendor/prism.min.js",
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
  "/manifest.json?v=2",
  "/config.js",
  "/static/icon-192.png?v=2",
  "/static/icon-512.png?v=2",
  "/static/icon-maskable-192.png?v=2",
  "/static/icon-maskable-512.png?v=2",
  "/static/icon-new-task.svg",
];

// tldraw runtime assets (ikon toolbar, font, translations) di-vendor lokal dari
// cdn.tldraw.com/2.4.6 (bundle dipatch ke base /static/vendor/tldraw/cdn) supaya
// canvas jalan offline TANPA warmup. Di-precache saat install.
const TLD = "/static/vendor/tldraw/cdn/2.4.6";
const TLD_ICONS = ["align-bottom","align-center-horizontal","align-center-vertical","align-left","align-right","align-top","arrow-left","arrowhead-arrow","arrowhead-bar","arrowhead-diamond","arrowhead-dot","arrowhead-none","arrowhead-square","arrowhead-triangle","arrowhead-triangle-inverted","blob","bring-forward","bring-to-front","broken","check","check-circle","chevron-down","chevron-left","chevron-right","chevron-up","chevrons-ne","chevrons-sw","clipboard-copied","clipboard-copy","color","cross-2","cross-circle","dash-dashed","dash-dotted","dash-draw","dash-solid","disconnected","discord","distribute-horizontal","distribute-vertical","dot","dots-horizontal","dots-vertical","drag-handle-dots","duplicate","edit","external-link","fill-fill","fill-none","fill-pattern","fill-semi","fill-solid","follow","following","font-draw","font-mono","font-sans","font-serif","geo-arrow-down","geo-arrow-left","geo-arrow-right","geo-arrow-up","geo-check-box","geo-cloud","geo-diamond","geo-ellipse","geo-heart","geo-hexagon","geo-octagon","geo-oval","geo-pentagon","geo-rectangle","geo-rhombus","geo-rhombus-2","geo-star","geo-trapezoid","geo-triangle","geo-x-box","github","group","horizontal-align-end","horizontal-align-middle","horizontal-align-start","info-circle","leading","link","lock","menu","minus","mixed","pack","plus","question-mark","question-mark-circle","redo","reset-zoom","rotate-ccw","rotate-cw","send-backward","send-to-back","share-1","size-extra-large","size-large","size-medium","size-small","spline-cubic","spline-line","stack-horizontal","stack-vertical","status-offline","stretch-horizontal","stretch-vertical","text-align-center","text-align-left","text-align-right","toggle-off","toggle-on","tool-arrow","tool-eraser","tool-frame","tool-hand","tool-highlight","tool-laser","tool-line","tool-media","tool-note","tool-pencil","tool-pointer","tool-screenshot","tool-text","trash","twitter","undo","ungroup","unlock","vertical-align-end","vertical-align-middle","vertical-align-start","warning-triangle","zoom-in","zoom-out"];
const TLD_LOCALES = ["ar","ca","cs","da","de","en","es","fa","fi","fr","gl","he","hi-in","hr","hu","id","it","ja","ko-kr","ku","my","ne","no","pl","pt-br","pt-pt","ro","ru","sl","sv","te","th","tr","uk","vi","zh-cn","zh-tw"];
const TLD_FONTS = ["IBMPlexMono-Medium.woff2","IBMPlexSans-Medium.woff2","IBMPlexSerif-Medium.woff2","Shantell_Sans-Tldrawish.woff2"];
const TLD_EMBEDS = ["codepen","codesandbox","excalidraw","felt","figma","github_gist","google_calendar","google_maps","google_slides","observable","replit","scratch","spotify","tldraw","val_town","vimeo","youtube"];
const TLDRAW_ASSETS = [].concat(
  TLD_ICONS.map(n => TLD + "/icons/icon/" + n + ".svg"),
  TLD_FONTS.map(f => TLD + "/fonts/" + f),
  TLD_LOCALES.map(l => TLD + "/translations/" + l + ".json"),
  TLD_EMBEDS.map(t => TLD + "/embed-icons/" + t + ".png"),
  [TLD + "/watermarks/watermark-desktop.svg"]
);
STATIC.push.apply(STATIC, TLDRAW_ASSETS);

self.addEventListener("message", e => {
  if (e.data === "SKIP_WAITING" || (e.data && e.data.type === "SKIP_WAITING")) {
    self.skipWaiting();
  }
});

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(STATIC.map(url => cache.add(new Request(url, { cache: "reload" })))))
      .then(() => {
        if (!self.registration.active) {
          self.skipWaiting();
        }
      })
      .catch(() => {
        if (!self.registration.active) {
          self.skipWaiting();
        }
      })
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && !k.startsWith("alurik-ambient-")).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .catch(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const { request } = e;
  const url = new URL(request.url);

  // Hanya proses skema http/https untuk menghindari error pada ekstensi browser
  if (!url.protocol.startsWith("http")) return;

  // AI endpoints are dynamic — never cache, always network.
  if (url.pathname.startsWith("/api/ai/")) return;

  // File media bertoken (/media/<token>, audio/video note): TIDAK di-intercept sama sekali. Browser menangani
  // Range/206 langsung dengan jaringan; SW tidak boleh menyimpan respons bertanda tangan atau memecah seek.
  if (url.pathname.startsWith("/media/")) return;

  // Meta & unggah media (/api/media/... dan /api/scratchpad/<id>/media...): NETWORK-ONLY, semua method.
  // Meta memuat URL bertoken yang kedaluwarsa → tidak pernah di-cache/dilayani dari cache; offline → 503 OFFLINE.
  if (url.pathname.startsWith("/api/media/") || /^\/api\/scratchpad\/[^/]+\/media(\/|$)/.test(url.pathname)) {
    e.respondWith(
      fetch(request).catch(() => new Response(
        JSON.stringify({ detail: "OFFLINE" }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      ))
    );
    return;
  }

  // Suara latar (/static/sounds/): cache-first dari AMBIENT_CACHE. Pemutar memakai fetch biasa (tanpa Range),
  // jadi hanya respons 200 penuh yang disimpan; 206/lainnya diteruskan tanpa disimpan.
  // Cache Storage yang gagal (open/match) tidak boleh memblokir jaringan: lanjut ke fetch, 503 hanya bila
  // jaringan juga gagal. put dijaga lewat waitUntil dan kegagalannya (mis. kuota) diabaikan.
  if (request.method === "GET" && url.pathname.startsWith("/static/sounds/")) {
    const cacheP = caches.open(AMBIENT_CACHE).catch(() => null)
    e.respondWith(
      cacheP
        .then(cache => (cache ? cache.match(request) : undefined))
        .catch(() => undefined)
        .then(cached => {
          if (cached) return cached
          return fetch(request).then(res => {
            if (res.ok && res.status === 200) {
              const copy = res.clone()
              e.waitUntil(cacheP.then(cache => cache && cache.put(request, copy)).catch(() => {}))
            }
            return res
          })
        })
        .catch(() => new Response("Offline", { status: 503 }))
    )
    return
  }

  // /api/habit-templates — network-first + cache fallback for offline
  if (url.pathname === '/api/habit-templates' && request.method === 'GET') {
    e.respondWith(
      fetch(request).then(res => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE).then(c => c.put(request, clone))
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

  // Manifest & ikon aplikasi — network-first, supaya launcher/instalasi PWA selalu
  // mendapat ikon terbaru (cache-first dulu membuat ikon lama terus terpakai).
  if (request.method === "GET" && (url.pathname === "/manifest.json" || /^\/static\/icon-[\w-]+\.png$/.test(url.pathname))) {
    e.respondWith(
      fetch(request, { cache: "no-cache" }).then(res => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE).then(c => c.put(request, clone))
        }
        return res
      }).catch(() => caches.match(request, { ignoreSearch: true }).then(cached =>
        cached || new Response("Offline", { status: 503 })
      ))
    )
    return
  }

  // tldraw static files — cache-first
  // ignoreSearch: iframe dimuat sebagai index.html?noteId=N — query harus diabaikan
  // agar cocok dengan index.html yang di-precache (tanpa query).
  if (url.pathname.startsWith('/static/vendor/tldraw/')) {
    e.respondWith(
      caches.match(request, { ignoreSearch: true }).then(cached => {
        if (cached) return cached
        return fetch(request).then(res => {
          if (res.ok) {
            const clone = res.clone()
            caches.open(CACHE).then(c => c.put(request, clone))
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
    // "/" tanpa params: stale-while-revalidate, fallback ke network jika cache error.
    // S11 (audit sinkron 2026-10-15): index.html hasil revalidasi hanya disimpan ke cache SW ini bila versinya
    // SAMA dengan SW ini (`window.__SW_VERSION = "<CACHE>"`). Dulu index.html versi baru menimpa cache versi
    // lama sementara modul static/offline/*.js lama tetap cache-first → app jalan dengan campuran versi
    // (index.html baru + syncpush/syncpull lama). Versi baru dipakai setelah SW baru aktif (precache lengkap).
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(request).then(cached => {
          const networkFetch = fetch(request).then(res => {
            if (!res.ok) return res;
            return res.clone().text().then(html => {
              const sameVersion = html.indexOf('__SW_VERSION = "' + CACHE + '"') !== -1;
              if (sameVersion) cache.put(request, res.clone()).catch(() => {});
              // versi berbeda & ada salinan cache yang konsisten dengan modul → pakai salinan cache
              return (!sameVersion && cached) ? cached : res;
            }).catch(() => res);
          }).catch(() =>
            cached || new Response("Offline — buka kembali saat terhubung ke internet", { status: 503 })
          );
          return cached || networkFetch;
        })
      ).catch(() => fetch(request))
    );
    return;
  }

  // Stream langsung mindmap (/api/mindmaps/<id>/stream, SSE #4): NETWORK-ONLY, tidak pernah di-cache.
  // Offline → 503 OFFLINE (EventSource menyambung ulang sendiri setelah online).
  if (/^\/api\/mindmaps\/[^/]+\/stream$/.test(url.pathname)) {
    e.respondWith(
      fetch(request).catch(() => new Response(
        JSON.stringify({ detail: "OFFLINE" }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      ))
    );
    return;
  }

  // Request sinkronisasi (pull/push/fetcher drawing ditandai header X-TF-Sync): NETWORK-ONLY — tidak membaca
  // dan tidak menulis cache. Respons cache basi (200) saat jaringan gagal bisa membalikkan data lokal yang
  // lebih baru; klien sinkron punya data lokal sendiri, jadi gagal → 503 OFFLINE saja.
  if (url.pathname.startsWith("/api/") && request.headers.get("X-TF-Sync") === "1") {
    e.respondWith(
      fetch(request).catch(() => new Response(
        JSON.stringify({ detail: "OFFLINE" }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      ))
    );
    return;
  }

  // Sampah note (/api/scratchpad/trash...): NETWORK-ONLY, semua method. Daftar sampah dari cache basi
  // bisa menampilkan item yang sudah dipulihkan/dihapus; offline → 503 OFFLINE (gagal jelas, tidak diantre).
  if (url.pathname === "/api/scratchpad/trash" || url.pathname.startsWith("/api/scratchpad/trash/")) {
    e.respondWith(
      fetch(request).catch(() => new Response(
        JSON.stringify({ detail: "OFFLINE" }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      ))
    );
    return;
  }

  // Sampah mindmap (/api/mindmaps/trash...): NETWORK-ONLY, semua method (sama dengan Sampah note).
  // Saat offline router lokal (TF.mindmaptrash) yang melayani daftar/pulihkan; SW tidak menyajikan cache basi.
  if (url.pathname === "/api/mindmaps/trash" || url.pathname.startsWith("/api/mindmaps/trash/")) {
    e.respondWith(
      fetch(request).catch(() => new Response(
        JSON.stringify({ detail: "OFFLINE" }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      ))
    );
    return;
  }

  // Pesan Pribadi (/api/dm/...): NETWORK-ONLY, semua method (termasuk SSE stream). Pesan pribadi tidak
  // disimpan di Cache Storage; offline → 503 OFFLINE (gagal jelas, tidak diantre).
  if (url.pathname.startsWith("/api/dm/")) {
    e.respondWith(
      fetch(request).catch(() => new Response(
        JSON.stringify({ detail: "OFFLINE" }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      ))
    );
    return;
  }

  // Versi aplikasi (/api/version): NETWORK-ONLY agar selalu mendapatkan versi terbaru dari server
  if (url.pathname === "/api/version") {
    e.respondWith(
      fetch(request).catch(() => new Response(
        JSON.stringify({ detail: "OFFLINE" }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      ))
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
