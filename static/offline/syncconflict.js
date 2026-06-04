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

  function getAllTasks() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("tasks", "readonly").objectStore("tasks").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  function getTaskRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("tasks", "readonly").objectStore("tasks").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function putTask(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      tx.objectStore("tasks").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function deleteTask(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      tx.objectStore("tasks").delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function dropOutbox(cid) {
    return TFoutbox.outboxByEntity("task", cid).then((ops) =>
      ops.reduce((p, o) => p.then(() => TFoutbox.outboxRemove(o.qid)), Promise.resolve()));
  }

  function listConflicts() {
    return getAllTasks().then((all) =>
      all.filter((r) => r.conflict).map((r) => ({ cid: r.cid, title: r.title, conflict: r.conflict, list_id: r.list_id != null ? r.list_id : null })));
  }

  function resolveConflict(cid, choice) {
    return getTaskRaw(cid).then((rec) => {
      if (!rec) return { ok: false };
      const cleanup = dropOutbox(cid)
        .then(() => (rec.server_id != null ? TFidmap.mapDelete("task", rec.server_id) : null));
      if (choice === "discard") {
        return cleanup.then(() => deleteTask(cid)).then(() => ({ ok: true }));
      }
      if (choice === "keep_as_new") {
        const next = Object.assign({}, rec, { server_id: null, dirty: 1 });
        delete next.conflict;
        return cleanup
          .then(() => putTask(next))
          .then(() => TFoutbox.outboxAdd({ op: "create", entity_type: "task", cid: cid, payload: {} }))
          .then(() => ({ ok: true }));
      }
      return Promise.reject(new Error("unknown choice: " + choice));
    });
  }

  const exported = { listConflicts, resolveConflict };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.syncconflict = exported; }
  return exported;
});
