;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  const DB_NAME = "taskflow-offline";
  const DB_VERSION = 2;

  // Each entity store keyed by `cid`. Indexes: [name, keyPath, options].
  const ENTITY_STORES = {
    tasks: [
      ["server_id", "server_id"], ["gtd_status", "gtd_status"], ["list_cid", "list_cid"],
      ["parent_cid", "parent_cid"], ["updated_at", "updated_at"], ["dirty", "dirty"],
    ],
    subtasks: [["task_cid", "task_cid"], ["server_id", "server_id"], ["dirty", "dirty"]],
    task_notes: [["task_cid", "task_cid"], ["server_id", "server_id"], ["dirty", "dirty"]],
    task_attachments: [["task_cid", "task_cid"]],
    habits: [["server_id", "server_id"], ["dirty", "dirty"]],
    habit_logs: [
      ["habit_date", ["habit_cid", "date"], { unique: true }],
      ["date", "date"], ["dirty", "dirty"],
    ],
    scratchpad_notes: [
      ["server_id", "server_id"], ["updated_at", "updated_at"],
      ["linked_task_cids", "linked_task_cids", { multiEntry: true }], ["dirty", "dirty"],
    ],
    drawings: [["note_cid", "note_cid"]],
    note_attachments: [["note_cid", "note_cid"]],
    note_pins: [["note_cid", "note_cid"]],
    mindmaps: [["server_id", "server_id"], ["updated_at", "updated_at"], ["dirty", "dirty"]],
    tags: [["server_id", "server_id"], ["name", "name"], ["dirty", "dirty"]],
    entity_tags: [
      ["tag_cid", "tag_cid"],
      ["entity", ["entity_type", "entity_cid"]],
      ["dirty", "dirty"],
    ],
    recurring_exceptions: [["task_cid", "task_cid"], ["dirty", "dirty"]],
    note_templates: [["server_id", "server_id"], ["dirty", "dirty"]],
    habit_templates: [["server_id", "server_id"], ["dirty", "dirty"]],
  };

  const ENTITY_STORE_NAMES = Object.keys(ENTITY_STORES);

  let _dbPromise = null;

  function createSchema(db, tx) {
    for (const [name, indexes] of Object.entries(ENTITY_STORES)) {
      const store = db.objectStoreNames.contains(name)
        ? tx.objectStore(name)
        : db.createObjectStore(name, { keyPath: "cid" });
      for (const [idxName, keyPath, options] of indexes) {
        if (!store.indexNames.contains(idxName)) store.createIndex(idxName, keyPath, options || {});
      }
    }
    if (!db.objectStoreNames.contains("_meta")) db.createObjectStore("_meta");
    if (!db.objectStoreNames.contains("_idmap")) {
      const m = db.createObjectStore("_idmap", { keyPath: "key" });
      m.createIndex("cid", "cid");
    }
    if (!db.objectStoreNames.contains("_outbox")) {
      db.createObjectStore("_outbox", { keyPath: "qid", autoIncrement: true });
    }
    if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs", { keyPath: "id" });
  }

  function migrateLegacy(db, tx, onErr) {
    if (!db.objectStoreNames.contains("queue")) return;
    const src = tx.objectStore("queue");
    const dst = tx.objectStore("_outbox");
    const cur = src.openCursor();
    cur.onerror = () => { if (onErr) onErr(cur.error); };
    cur.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const { qid, ...rest } = cursor.value;
        const addReq = dst.add(rest);
        addReq.onerror = () => { if (onErr) onErr(addReq.error); };
        cursor.continue();
      } else {
        db.deleteObjectStore("queue");
        if (db.objectStoreNames.contains("cache")) db.deleteObjectStore("cache");
      }
    };
  }

  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        _dbPromise = null;
        reject(err);
        return;
      }
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const tx = e.target.transaction; // versionchange transaction
        tx.onabort = () => { _dbPromise = null; reject(tx.error || new Error("offline DB upgrade aborted")); };
        createSchema(db, tx);
        migrateLegacy(db, tx, (err) => { _dbPromise = null; reject(err); });
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => { _dbPromise = null; reject(req.error); };
      req.onblocked = () => {
        try { console.warn("taskflow-offline: openDB blocked by another open connection"); } catch (_) {}
      };
    });
    return _dbPromise;
  }

  function _reset() { _dbPromise = null; }

  const publicApi = { DB_NAME, DB_VERSION, ENTITY_STORES, ENTITY_STORE_NAMES, openDB };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.db = publicApi; }
  return Object.assign({ _reset }, publicApi);
});
