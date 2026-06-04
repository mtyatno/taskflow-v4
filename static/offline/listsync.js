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

  function getAllLists() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("lists", "readonly").objectStore("lists").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  function putList(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("lists", "readwrite");
      tx.objectStore("lists").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function deleteList(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("lists", "readwrite");
      tx.objectStore("lists").delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function ensureCid(serverId, cache) {
    if (cache[serverId]) return Promise.resolve(cache[serverId]);
    return TFidmap.cidOf("list", serverId).then((cid) => {
      if (cid) { cache[serverId] = cid; return cid; }
      const fresh = TFids.newCid();
      cache[serverId] = fresh;
      return TFidmap.mapPut("list", serverId, fresh).then(() => fresh);
    });
  }
  function listFromServer(s, cid) {
    return {
      cid: cid, server_id: s.id, name: s.name,
      owner_id: s.owner_id != null ? s.owner_id : null,
      role: s.role, member_count: s.member_count != null ? s.member_count : 0, dirty: 0,
    };
  }

  function pullLists(serverLists) {
    const list = serverLists || [];
    const cache = {};
    return list.reduce((p, s) => p.then(() => ensureCid(s.id, cache)), Promise.resolve())
      .then(() => getAllLists())
      .then((localAll) => {
        const byCid = {};
        for (const r of localAll) byCid[r.cid] = r;
        const result = { created: 0, updated: 0, deleted: 0 };
        let chain = Promise.resolve();
        for (const s of list) {
          const cid = cache[s.id];
          const existing = byCid[cid];
          chain = chain.then(() => { if (existing) result.updated++; else result.created++; return putList(listFromServer(s, cid)); });
        }
        const serverIds = new Set(list.map((s) => String(s.id)));
        for (const r of localAll) {
          if (r.server_id == null) continue;
          if (serverIds.has(String(r.server_id))) continue;
          chain = chain.then(() => { result.deleted++; return deleteList(r.cid); });
        }
        return chain.then(() => result);
      });
  }

  function getLocalLists() {
    return getAllLists().then((rows) => rows.map((r) => ({
      id: r.server_id != null ? r.server_id : r.cid,
      name: r.name, owner_id: r.owner_id, role: r.role, member_count: r.member_count,
    })));
  }

  function pullAndReconcileLists(rawFetch) {
    return Promise.resolve(rawFetch("/api/lists"))
      .then((res) => (res && typeof res.json === "function" ? res.json() : res))
      .then((l) => pullLists(l || []));
  }

  const exported = { pullLists, getLocalLists, pullAndReconcileLists, listFromServer };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.listsync = exported; }
  return exported;
});
