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
  const TFidmap = req("./idmap.js", root.TF && root.TF.idmap);

  const COPY = [
    "title", "description", "gtd_status", "priority", "quadrant", "project", "context",
    "deadline", "waiting_for", "completed_at", "progress", "is_focused", "assigned_to",
    "recurrence_type", "recurrence_days", "recurrence_end_date", "recurrence_notif_level",
    "created_at", "updated_at",
  ];

  // Pure: server task dict → local record. `getCid(serverId)` returns the cid for any server id.
  function taskFromServer(dict, getCid) {
    const rec = { cid: getCid(dict.id), server_id: dict.id };
    for (const k of COPY) rec[k] = dict[k] != null ? dict[k] : (k === "is_focused" || k === "progress" ? 0 : null);
    rec.title = dict.title;
    rec.parent_cid = dict.parent_id != null ? getCid(dict.parent_id) : null;
    rec.list_cid = null;
    rec.list_id = dict.list_id != null ? dict.list_id : null;
    rec.deleted = false;
    rec.dirty = 0;
    rec.base_rev = dict.updated_at != null ? dict.updated_at : null;
    return rec;
  }

  // Ensure a stable cid for a server id via _idmap; create + persist if missing.
  function ensureCid(serverId, cache) {
    if (cache[serverId]) return Promise.resolve(cache[serverId]);
    return TFidmap.cidOf("task", serverId).then((cid) => {
      if (cid) { cache[serverId] = cid; return cid; }
      const fresh = TFids.newCid();
      cache[serverId] = fresh;
      return TFidmap.mapPut("task", serverId, fresh).then(() => fresh);
    });
  }

  function putTask(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      tx.objectStore("tasks").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function hydrateTasks(serverTasks) {
    const list = serverTasks || [];
    const cache = {};
    // Pass 1: assign a cid to every server id (so parents resolve in pass 2).
    return list.reduce((p, d) => p.then(() => ensureCid(d.id, cache)), Promise.resolve())
      .then(() => {
        const getCid = (sid) => cache[sid] || null;
        // Pass 2: upsert each record.
        return list.reduce((p, d) => p.then(() => putTask(taskFromServer(d, getCid))), Promise.resolve());
      });
  }

  const exported = { taskFromServer, hydrateTasks };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.hydrate = exported; }
  return exported;
});
