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
  const TFrepo = req("./noterepo.js", root.TF && root.TF.noterepo);
  const TFquery = req("./notequery.js", root.TF && root.TF.notequery);

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
  function notFound() { return Promise.reject(new Error("Note not found")); }

  function registerNoteRoutes(router) {
    router.register("GET", "/api/scratchpad", ({ query }) => TFquery.getNotes(query || {}));
    router.register("GET", "/api/scratchpad/recent", () => TFquery.getRecent());
    router.register("GET", "/api/scratchpad/titles", () => TFquery.getTitles());
    router.register("GET", "/api/scratchpad/:id/backlinks", ({ params }) =>
      resolveNoteCid(params.id).then((cid) => (cid ? TFquery.getBacklinks(cid) : notFound())));
    router.register("GET", "/api/scratchpad/:id", ({ params }) =>
      resolveNoteCid(params.id).then((cid) => (cid ? TFquery.getNote(cid) : notFound())));
    router.register("POST", "/api/scratchpad", ({ body }) =>
      TFrepo.createNote(body || {}, {}).then((rec) => TFquery.getNote(rec.cid)));
    router.register("PUT", "/api/scratchpad/:id", ({ params, body }) =>
      resolveNoteCid(params.id).then((cid) => (cid ? TFrepo.updateNote(cid, body || {}, {}).then(() => TFquery.getNote(cid)) : notFound())));
    router.register("DELETE", "/api/scratchpad/:id", ({ params }) =>
      resolveNoteCid(params.id).then((cid) => (cid ? TFrepo.deleteNote(cid, {}) : notFound())));
    router.register("PATCH", "/api/scratchpad/:id/pin", ({ params }) =>
      resolveNoteCid(params.id).then((cid) => (cid ? TFrepo.togglePin(cid, {}).then(() => TFquery.getNote(cid)) : notFound())));
  }

  const exported = { registerNoteRoutes };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.noteroutes = exported; }
  return exported;
});
