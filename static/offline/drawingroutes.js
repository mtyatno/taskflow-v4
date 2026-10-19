;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  const isNode = (typeof module !== "undefined" && module.exports);
  const req = (m, g) => (isNode ? require(m) : g);
  const TFrepo = req("./drawingrepo.js", root.TF && root.TF.drawingrepo);

  function notFound() { return Promise.reject(new Error("Drawing not found")); }
  const onlineNow = () => (typeof navigator !== "undefined" ? navigator.onLine : true);

  // S6: hanya drawing standalone. Jalur legacy "gambar di dalam note" (PUT /api/drawings/{noteId} → record
  // ber-note_cid + op upsert ke id note di server) dihapus; record lama dikonversi saat push
  // (drawingrepo.upgradeLegacyNoteDrawings).
  function registerDrawingRoutes(router) {
    // List drawings (standalone)
    router.register("GET", "/api/drawings", ({ query }) => {
      return TFrepo.listDrawings(query || {});
    });

    // Create drawing (standalone)
    router.register("POST", "/api/drawings", ({ body }) => {
      return TFrepo.createDrawing(body || {});
    });

    // Get single drawing (by cid / server_id / client_id)
    router.register("GET", "/api/drawings/:id", ({ params }) => {
      return TFrepo.getDrawing(params.id, { online: onlineNow() }).then((d) => (d ? d : notFound()));
    });

    // Drawing milik workspace (daftar ringan, terbaru dulu; baris terhapus tidak ikut)
    router.register("GET", "/api/lists/:id/drawings", ({ params }) => {
      return TFrepo.listDrawings({ list_id: params.id }).then((rows) => rows
        .filter((d) => d.list_id != null && String(d.list_id) === String(params.id))
        .sort((a, b) => (String(b.updated_at) < String(a.updated_at) ? -1 : String(b.updated_at) > String(a.updated_at) ? 1 : 0))
        .map((d) => ({
          id: d.id, client_id: d.cid, title: d.title, svg_preview: d.svg_preview,
          list_id: d.list_id, user_id: d.user_id, updated_at: d.updated_at,
        })));
    });

    // Update drawing
    router.register("PUT", "/api/drawings/:id", ({ params, body }) => {
      return TFrepo.updateDrawing(params.id, body || {});
    });

    // Toggle pin
    router.register("PATCH", "/api/drawings/:id/pin", ({ params }) => {
      return TFrepo.togglePin(params.id);
    });

    // Delete drawing
    router.register("DELETE", "/api/drawings/:id", ({ params }) => {
      return TFrepo.deleteDrawing(params.id);
    });
  }

  const exported = { registerDrawingRoutes };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.drawingroutes = exported; }
  return exported;
});
