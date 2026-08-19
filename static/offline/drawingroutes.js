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
  const TFdb = req("./db.js", root.TF && root.TF.db);
  const TFrepo = req("./drawingrepo.js", root.TF && root.TF.drawingrepo);

  function notFound() { return Promise.reject(new Error("Drawing not found")); }
  const onlineNow = () => (typeof navigator !== "undefined" ? navigator.onLine : true);

  function allNotes() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("scratchpad_notes", "readonly").objectStore("scratchpad_notes").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }

  function resolveNoteCid(idOrCid) {
    return allNotes().then((all) => {
      for (const n of all) if (n.cid === idOrCid) return n.cid;
      for (const n of all) if (n.server_id != null && String(n.server_id) === String(idOrCid)) return n.cid;
      return null;
    });
  }

  function registerDrawingRoutes(router) {
    // List drawings (standalone)
    router.register("GET", "/api/drawings", ({ query }) => {
      return TFrepo.listDrawings(query || {});
    });

    // Create drawing (standalone)
    router.register("POST", "/api/drawings", ({ body }) => {
      return TFrepo.createDrawing(body || {});
    });

    // Get single drawing (standalone or note drawing)
    router.register("GET", "/api/drawings/:id", ({ params }) => {
      return TFrepo.getDrawing(params.id, { online: onlineNow() }).then((d) => {
        if (d) return d;
        return resolveNoteCid(params.id).then((noteCid) => {
          if (!noteCid) return notFound();
          return TFrepo.getDrawing(noteCid, { online: onlineNow() }).then((nd) => (nd ? nd : notFound()));
        });
      });
    });

    // Update drawing (standalone or note drawing)
    router.register("PUT", "/api/drawings/:id", ({ params, body }) => {
      return TFrepo.getRaw(params.id).then((raw) => {
        if (raw && raw.note_cid === undefined) {
          return TFrepo.updateDrawing(params.id, body || {});
        }
        return resolveNoteCid(params.id).then((noteCid) => {
          if (noteCid) {
            return TFrepo.putDrawing(noteCid, (body || {}).data_json, {}).then((rec) => ({ updated_at: rec.updated_at }));
          }
          return TFrepo.updateDrawing(params.id, body || {});
        });
      });
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
