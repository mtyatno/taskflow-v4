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
  // Jangan pernah diturunkan: membuka DB yang sudah lebih tinggi memakai versi lebih rendah = VersionError
  // → semua rute offline mati. Rollback fitur = revert kode, versi dan store tetap (spec plugin Fase 1 §4).
  const DB_VERSION = 6;
  // K2 / R12: tab lain menaikkan versi DB → koneksi tab ini ditutup dan openDB berikutnya ditolak dengan kode ini.
  const UPGRADED_ELSEWHERE = "DB_UPGRADED_ELSEWHERE";

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
    drawings: [
      ["server_id", "server_id"], ["note_cid", "note_cid"],
      ["updated_at", "updated_at"], ["is_pinned", "is_pinned"], ["dirty", "dirty"],
    ],
    note_attachments: [["note_cid", "note_cid"]],
    note_pins: [["note_cid", "note_cid"]],
    mindmaps: [["server_id", "server_id"], ["updated_at", "updated_at"], ["dirty", "dirty"]],
    chat_messages: [
      ["list_id", "list_id"], ["created_at", "created_at"],
      ["server_id", "server_id"], ["client_id", "cid"],
    ],
    lists: [["server_id", "server_id"], ["dirty", "dirty"]],
    tags: [["server_id", "server_id"], ["name", "name"], ["dirty", "dirty"]],
    entity_tags: [
      ["tag_cid", "tag_cid"],
      ["entity", ["entity_type", "entity_cid"]],
      ["dirty", "dirty"],
    ],
    recurring_exceptions: [["task_cid", "task_cid"], ["dirty", "dirty"]],
    note_templates: [["server_id", "server_id"], ["dirty", "dirty"]],
    habit_templates: [["server_id", "server_id"], ["dirty", "dirty"]],
    note_comments: [["server_id", "server_id"], ["note_cid", "note_cid"], ["note_id", "note_id"], ["list_id", "list_id"]],
  };

  const ENTITY_STORE_NAMES = Object.keys(ENTITY_STORES);

  let _dbPromise = null;
  let _db = null;

  // Status pembaruan untuk banner (dbupgrade.js). Event: subscribe(fn) + window "tf:db-<type>".
  let _upgrade = { blocked: false, upgradedElsewhere: false };
  const _subs = new Set();

  function upgradeState() { return { blocked: _upgrade.blocked, upgradedElsewhere: _upgrade.upgradedElsewhere }; }

  function subscribe(fn) {
    if (typeof fn !== "function") return () => {};
    _subs.add(fn);
    return () => { _subs.delete(fn); };
  }

  function emit(type) {
    for (const fn of Array.from(_subs)) { try { fn({ type }); } catch (_) {} }
    try {
      if (root && typeof root.dispatchEvent === "function" && typeof CustomEvent === "function") {
        root.dispatchEvent(new CustomEvent("tf:db-" + type));
      }
    } catch (_) {}
  }

  // Tab lain membuka versi lebih tinggi (atau menghapus DB). Transaksi yang berjalan selesai dulu; koneksi
  // ditutup agar upgrade di tab lain tidak tertahan. Hapus DB (newVersion null) → boleh buka ulang tanpa banner.
  function onVersionChange(db, e) {
    try { db.close(); } catch (_) {}
    if (_db === db) _db = null;
    if (e && e.newVersion === null) { _dbPromise = null; return; }
    const err = new Error(UPGRADED_ELSEWHERE);
    err.code = UPGRADED_ELSEWHERE;
    const rejected = Promise.reject(err);
    rejected.catch(() => {});
    _dbPromise = rejected;
    if (!_upgrade.upgradedElsewhere) {
      _upgrade = { blocked: _upgrade.blocked, upgradedElsewhere: true };
      emit("upgraded-elsewhere");
    }
  }

  function setBlocked(on) {
    if (_upgrade.blocked === on) return;
    _upgrade = { blocked: on, upgradedElsewhere: _upgrade.upgradedElsewhere };
    emit(on ? "blocked" : "unblocked");
  }

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
      req.onsuccess = (e) => {
        const db = e.target.result;
        _db = db;
        db.onversionchange = (ev) => onVersionChange(db, ev);
        setBlocked(false);
        resolve(db);
      };
      req.onerror = () => { _dbPromise = null; setBlocked(false); reject(req.error); };
      req.onblocked = () => {
        try { console.warn("taskflow-offline: openDB blocked by another open connection"); } catch (_) {}
        setBlocked(true);
      };
    });
    return _dbPromise;
  }

  function clearAll() {
    return openDB().then((db) => {
      const storeNames = Array.from(db.objectStoreNames);
      if (!storeNames.length) return Promise.resolve();
      return new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(storeNames, "readwrite");
          for (const name of storeNames) {
            tx.objectStore(name).clear();
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error("clearAll aborted"));
        } catch (err) {
          reject(err);
        }
      });
    }).catch((err) => {
      try { console.warn("taskflow-offline clearAll failed:", err); } catch (_) {}
      return null;
    });
  }

  // ── Mutasi atomik (prinsip 4 rencana audit 2026-10-15: CAS/rev) ─────────────────────────────
  // Satu transaksi readwrite: get(key) → next = fn(current|null) (sinkron; undefined/null = batal, tidak
  // menulis) → put(next). Resolve record yang ditulis, atau null bila batal. Semua penulisan record setelah
  // jeda async (push setelah respons server, pull, resolusi konflik) WAJIB lewat sini supaya tidak pernah
  // menulis objek basi yang dibaca sebelum request — pola yang sama dengan drawingrepo.mutateDrawing.
  function mutate(storeName, key, fn) {
    return openDB().then((db) => new Promise((resolve, reject) => {
      let out = null;
      let failed = null;
      let tx;
      try { tx = db.transaction(storeName, "readwrite"); } catch (err) { reject(err); return; }
      const os = tx.objectStore(storeName);
      const r = os.get(key);
      r.onsuccess = () => {
        let next;
        try { next = fn(r.result || null); } catch (err) { failed = err; try { tx.abort(); } catch (_) {} return; }
        if (next == null) return;
        os.put(next);
        out = next;
      };
      r.onerror = () => { failed = r.error; };
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(failed || tx.error);
      tx.onabort = () => reject(failed || tx.error || new Error(storeName + " mutation aborted"));
    }));
  }

  function _reset() {
    if (_db) { try { _db.close(); } catch (_) {} _db = null; }
    _dbPromise = null;
    _upgrade = { blocked: false, upgradedElsewhere: false };
  }

  const publicApi = {
    DB_NAME, DB_VERSION, UPGRADED_ELSEWHERE, ENTITY_STORES, ENTITY_STORE_NAMES,
    openDB, clearAll, mutate, subscribe, upgradeState,
  };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.db = publicApi; }
  return Object.assign({ _reset }, publicApi);
});
