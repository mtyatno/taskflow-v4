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
  const TFhydrate = req("./hydrate.js", root.TF && root.TF.hydrate);

  function getAllTasks() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("tasks", "readonly").objectStore("tasks").getAll();
      r.onsuccess = () => resolve(r.result || []);
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
  function ensureCid(serverId, cache) {
    if (cache[serverId]) return Promise.resolve(cache[serverId]);
    return TFidmap.cidOf("task", serverId).then((cid) => {
      if (cid) { cache[serverId] = cid; return cid; }
      const fresh = TFids.newCid();
      cache[serverId] = fresh;
      return TFidmap.mapPut("task", serverId, fresh).then(() => fresh);
    });
  }

  function pullTasks(serverList) {
    const list = serverList || [];
    const cache = {}; // serverId -> cid
    return list.reduce((p, s) => p.then(() => ensureCid(s.id, cache)), Promise.resolve())
      .then(() => getAllTasks())
      .then((localAll) => {
        const localByCid = {};
        for (const r of localAll) localByCid[r.cid] = r;
        const getCid = (sid) => cache[sid] || null;
        const result = { created: 0, updated: 0, deleted: 0, skipped: 0 };
        let chain = Promise.resolve();
        for (const s of list) {
          const cid = cache[s.id];
          const localRec = localByCid[cid];
          chain = chain.then(() => {
            if (!localRec) { result.created++; return putTask(TFhydrate.taskFromServer(s, getCid)); }
            if (localRec.dirty) { result.skipped++; return; }
            if (s.updated_at !== localRec.base_rev) { result.updated++; return putTask(TFhydrate.taskFromServer(s, getCid)); }
            return;
          });
        }
        const serverIds = new Set(list.map((s) => String(s.id)));
        for (const r of localAll) {
          if (r.server_id == null) continue;
          if (serverIds.has(String(r.server_id))) continue;
          chain = chain.then(() => {
            if (r.dirty) { result.skipped++; return; }
            result.deleted++;
            return deleteTask(r.cid);
          });
        }
        return chain.then(() => result);
      });
  }

  function pullAndReconcile(rawFetch) {
    return Promise.resolve(rawFetch("/api/tasks?include_done=true"))
      .then((res) => (res && typeof res.json === "function" ? res.json() : res))
      .then((list) => pullTasks(list || []));
  }

  const exported = { pullTasks, pullAndReconcile };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.syncpull = exported; }
  return exported;
});
