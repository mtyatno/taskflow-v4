;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  const isNode = typeof module !== "undefined" && module.exports;
  const TFdb = isNode ? require("./db.js") : root.TF.db;
  const TFmeta = isNode ? require("./meta.js") : root.TF.meta;

  const MARKER_KEY = "initial_sync:v1";

  // Keputusan tampilan dashboard (murni). Urutan pengecekan = prioritas (spec §4.5).
  function decideIntro({ hasData, initialSyncDone, online, syncRunning, lastSyncFailed }) {
    if (hasData) return "dashboard";
    if (initialSyncDone) return "welcome";
    if (!online) return "offline_empty";
    if (syncRunning) return "syncing";
    if (lastSyncFailed) return "sync_error";
    return "syncing";
  }

  // Ada record !deleted di store `store`? Cursor berhenti di yang pertama (tanpa getAll).
  function storeHasLive(db, store) {
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, "readonly").objectStore(store).openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve(false);
        if (!cur.value.deleted) return resolve(true);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  // Punya data lokal = ada task atau note yang belum dihapus (spec §4.4).
  function hasLocalData() {
    return TFdb.openDB().then(async (db) => {
      if (await storeHasLive(db, "tasks")) return true;
      return storeHasLive(db, "scratchpad_notes");
    });
  }

  function readInitialSync(userId) {
    if (userId == null) return Promise.resolve(false);
    return TFmeta.metaGet(MARKER_KEY)
      .then((m) => !!m && String(m.user_id) === String(userId))
      .catch(() => false);
  }

  function markInitialSync(userId, nowIso) {
    if (userId == null) return Promise.resolve();
    return TFmeta.metaSet(MARKER_KEY, {
      user_id: String(userId),
      at: nowIso || new Date().toISOString(),
    });
  }

  function currentUserId() {
    try {
      const v = root.localStorage && root.localStorage.getItem("tf_user_id");
      return v == null || v === "" ? null : String(v);
    } catch (e) { return null; }
  }

  const exported = { MARKER_KEY, decideIntro, hasLocalData, readInitialSync, markInitialSync, currentUserId };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.introgate = exported; }
  return exported;
});
