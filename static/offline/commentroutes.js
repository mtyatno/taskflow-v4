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
  const TFchat = req("./chatrepo.js", root.TF && root.TF.chatrepo);
  const TFcomment = req("./commentrepo.js", root.TF && root.TF.commentrepo);
  const TFnoteroutes = req("./noteroutes.js", root.TF && root.TF.noteroutes);

  const onlineNow = () => (typeof navigator !== "undefined" ? navigator.onLine !== false : true);

  function noteNotFound() { return Promise.reject(new Error("Note not found")); }
  function commentNotFound() {
    return Promise.reject(Object.assign(new Error("Komentar tidak ditemukan"), { status: 404 }));
  }
  function getNote(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("scratchpad_notes", "readonly").objectStore("scratchpad_notes").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function withNote(idOrCid, fn) {
    return TFnoteroutes.resolveNoteCid(idOrCid).then((cid) => (cid ? fn(cid) : noteNotFound()));
  }
  function withComment(id, fn) {
    return TFcomment.findComment(id).then((rec) => (rec ? fn(rec.cid) : commentNotFound()));
  }

  function registerCommentRoutes(router) {
    router.register("GET", "/api/scratchpad/:id/comments", ({ params }) =>
      withNote(params.id, (cid) => {
        const local = () => TFcomment.listForNote(cid);
        const fetcher = TFchat.getFetcher();
        if (!(onlineNow() && fetcher)) return local();
        return getNote(cid).then((note) => {
          if (!note || note.server_id == null) return local();
          return Promise.resolve(fetcher("/api/scratchpad/" + note.server_id + "/comments"))
            .then((items) => TFcomment.mergePulled(Array.isArray(items) ? items : [], { replaceForNoteId: note.server_id }))
            .then(local, local);
        });
      }));
    router.register("POST", "/api/scratchpad/:id/comments", ({ params, body }) =>
      withNote(params.id, (cid) => TFcomment.create(cid, body || {})));
    router.register("POST", "/api/scratchpad/:id/comments/read", ({ params }) =>
      withNote(params.id, (cid) => TFcomment.markRead(cid).then(() => ({ ok: true }))));
    router.register("PATCH", "/api/note-comments/:cid", ({ params, body }) =>
      withComment(params.cid, (cid) => {
        const b = body || {};
        let p = Promise.resolve();
        if (b.body !== undefined) p = p.then(() => TFcomment.edit(cid, b.body));
        if (b.resolved !== undefined) p = p.then(() => TFcomment.resolve(cid, !!b.resolved));
        return p.then(() => TFcomment.getRaw(cid)).then((rec) => TFcomment.shape(rec));
      }));
    router.register("DELETE", "/api/note-comments/:cid", ({ params }) =>
      withComment(params.cid, (cid) => TFcomment.remove(cid).then(() => ({ ok: true }))));
  }

  const exported = { registerCommentRoutes };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.commentroutes = exported; }
  return exported;
});
