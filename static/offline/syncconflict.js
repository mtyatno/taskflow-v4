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
  const TFoutbox = req("./outbox.js", root.TF && root.TF.outbox);
  const TFidmap = req("./idmap.js", root.TF && root.TF.idmap);

  const STORE = { task: "tasks", note: "scratchpad_notes", mindmap: "mindmaps" };

  function getAll(store) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction(store, "readonly").objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  function getRaw(store, cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction(store, "readonly").objectStore(store).get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function putRaw(store, rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function deleteRaw(store, cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function dropOutbox(entity, cid) {
    return TFoutbox.outboxByEntity(entity, cid).then((ops) =>
      ops.reduce((p, o) => p.then(() => TFoutbox.outboxRemove(o.qid)), Promise.resolve()));
  }

  function listConflicts() {
    return Promise.all([getAll("tasks"), getAll("scratchpad_notes"), getAll("mindmaps")]).then(([tasks, notes, mindmaps]) => {
      const out = [];
      const add = (entity, rows) => { for (const r of rows) if (r.conflict) out.push({ entity: entity, cid: r.cid, title: r.title, conflict: r.conflict, list_id: r.list_id != null ? r.list_id : null }); };
      add("task", tasks); add("note", notes); add("mindmap", mindmaps);
      return out;
    });
  }

  function resolveConflict(entity, cid, choice) {
    const store = STORE[entity];
    if (!store) return Promise.reject(new Error("unknown entity: " + entity));
    return getRaw(store, cid).then((rec) => {
      if (!rec) return { ok: false };
      const cleanup = dropOutbox(entity, cid)
        .then(() => (rec.server_id != null ? TFidmap.mapDelete(entity, rec.server_id) : null));
      if (choice === "discard") {
        return cleanup.then(() => deleteRaw(store, cid)).then(() => ({ ok: true }));
      }
      if (choice === "keep_as_new") {
        const next = Object.assign({}, rec, { server_id: null, dirty: 1 });
        delete next.conflict;
        return cleanup
          .then(() => putRaw(store, next))
          .then(() => TFoutbox.outboxAdd({ op: "create", entity_type: entity, cid: cid, payload: {} }))
          .then(() => ({ ok: true }));
      }
      return Promise.reject(new Error("unknown choice: " + choice));
    });
  }

  function listNotices() {
    return Promise.all([getAll("scratchpad_notes"), getAll("mindmaps")]).then(([notes, mindmaps]) => {
      const out = [];
      const add = (entity, rows) => { for (const r of rows) if (r.notice) out.push({ entity: entity, cid: r.cid, kind: r.notice.kind, title: r.notice.title, editor: r.notice.editor != null ? r.notice.editor : null }); };
      add("note", notes); add("mindmap", mindmaps);
      return out;
    });
  }

  function dismissNotice(entity, cid) {
    const store = STORE[entity];
    if (!store) return Promise.reject(new Error("unknown entity: " + entity));
    return getRaw(store, cid).then((rec) => {
      if (!rec) return { ok: false };
      const next = Object.assign({}, rec);
      delete next.notice;
      return putRaw(store, next).then(() => ({ ok: true }));
    });
  }

  const exported = { listConflicts, resolveConflict, listNotices, dismissNotice };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.syncconflict = exported; }
  return exported;
});
