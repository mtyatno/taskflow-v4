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
  const TFids = req("./ids.js", root.TF && root.TF.ids);
  const TFoutbox = req("./outbox.js", root.TF && root.TF.outbox);

  let _currentUser = null;
  function setCurrentUser(u) { _currentUser = u; }
  function getCurrentUser() { return _currentUser; }
  function curUid() { return (_currentUser && _currentUser.user_id != null) ? _currentUser.user_id : null; }

  const DEFAULT_DATA = '{"nodeData":{"id":"root","topic":"Untitled","root":true,"children":[]}}';

  function getRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("mindmaps", "readonly").objectStore("mindmaps").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function putRaw(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("mindmaps", "readwrite");
      tx.objectStore("mindmaps").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  // Remove any pending 'update' ops for this cid (autosave fires frequently; keep outbox lean).
  function dedupeUpdates(cid) {
    return TFoutbox.outboxByEntity("mindmap", cid).then((ops) =>
      ops.filter((o) => o.op === "update").reduce((p, o) => p.then(() => TFoutbox.outboxRemove(o.qid)), Promise.resolve()));
  }

  function createMindmap(input, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    const rec = {
      cid: TFids.newCid(), server_id: null,
      title: input.title != null ? input.title : "Untitled",
      data_json: input.data_json != null ? input.data_json : DEFAULT_DATA,
      pinned: false,
      list_id: input.list_id != null ? input.list_id : null,
      user_id: curUid(),
      last_edited_by: curUid(),
      last_editor_username: null, last_editor_display_name: null,
      created_at: now, updated_at: now, deleted: false, dirty: 1, base_rev: null,
    };
    return putRaw(rec)
      .then(() => TFoutbox.outboxAdd({ op: "create", entity_type: "mindmap", cid: rec.cid, payload: { cid: rec.cid } }))
      .then(() => rec);
  }

  function updateMindmap(cid, patch, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    return getRaw(cid).then((rec) => {
      if (!rec || rec.deleted) return Promise.reject(new Error("Mindmap not found"));
      const next = Object.assign({}, rec, {
        title: patch.title != null ? patch.title : rec.title,
        data_json: patch.data_json != null ? patch.data_json : rec.data_json,
        last_edited_by: curUid(),
        last_editor_username: null, last_editor_display_name: null,
        updated_at: now, dirty: 1,
      });
      return putRaw(next)
        .then(() => dedupeUpdates(cid))
        .then(() => TFoutbox.outboxAdd({ op: "update", entity_type: "mindmap", cid: cid, payload: { cid: cid } }))
        .then(() => next);
    });
  }

  function deleteMindmap(cid) {
    return getRaw(cid).then((rec) => {
      if (!rec || rec.deleted) return Promise.reject(new Error("Mindmap not found"));
      const next = Object.assign({}, rec, { deleted: true, dirty: 1 });
      return putRaw(next)
        .then(() => TFoutbox.outboxAdd({ op: "delete", entity_type: "mindmap", cid: cid, payload: { cid: cid } }))
        .then(() => ({ ok: true }));
    });
  }

  function togglePin(cid) {
    return getRaw(cid).then((rec) => {
      if (!rec || rec.deleted) return Promise.reject(new Error("Mindmap not found"));
      const next = Object.assign({}, rec, { pinned: !rec.pinned }); // NOT dirty — pin orthogonal to LWW
      return putRaw(next)
        .then(() => TFoutbox.outboxAdd({ op: "pin", entity_type: "mindmap", cid: cid, payload: { pinned: next.pinned } }))
        .then(() => next);
    });
  }

  const exported = { createMindmap, updateMindmap, deleteMindmap, togglePin, getRaw, putRaw, setCurrentUser, getCurrentUser };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.mindmaprepo = exported; }
  return exported;
});
