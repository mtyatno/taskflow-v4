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
  function notFound() { return Promise.reject(new Error("Drawing not found")); }
  const onlineNow = () => (typeof navigator !== "undefined" ? navigator.onLine : true);

  function registerDrawingRoutes(router) {
    router.register("GET", "/api/drawings/:id", ({ params }) =>
      resolveNoteCid(params.id).then((cid) => (cid ? TFrepo.getDrawing(cid, { online: onlineNow() }) : null))
        .then((d) => (d ? d : notFound())));
    router.register("PUT", "/api/drawings/:id", ({ params, body }) =>
      resolveNoteCid(params.id).then((cid) => (cid ? TFrepo.putDrawing(cid, (body || {}).data_json, {}).then((rec) => ({ updated_at: rec.updated_at })) : notFound())));
  }

  const exported = { registerDrawingRoutes };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.drawingroutes = exported; }
  return exported;
});
