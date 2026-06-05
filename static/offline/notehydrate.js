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

  function putNote(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("scratchpad_notes", "readwrite");
      tx.objectStore("scratchpad_notes").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function ensureNoteCid(serverId, cache) {
    if (cache[serverId]) return Promise.resolve(cache[serverId]);
    return TFidmap.cidOf("note", serverId).then((cid) => {
      if (cid) { cache[serverId] = cid; return cid; }
      const fresh = TFids.newCid();
      cache[serverId] = fresh;
      return TFidmap.mapPut("note", serverId, fresh).then(() => fresh);
    });
  }

  function hydrateNotes(serverNotes) {
    const personal = (serverNotes || []).filter((n) => n.list_id == null);
    const cache = {};
    // Pass 1: mint a cid for every personal note so linked_to can resolve in pass 2.
    return personal.reduce((p, n) => p.then(() => ensureNoteCid(n.id, cache)), Promise.resolve())
      .then(() => personal.reduce((p, n) => p.then(() => {
        const cid = cache[n.id];
        const toCids = (n.linked_to || []).map((sid) => cache[sid]).filter(Boolean);
        const taskIds = n.linked_task_ids || [];
        return taskIds.reduce((q, tid) => q.then((acc) => TFidmap.cidOf("task", tid).then((c) => { if (c) acc.push(c); return acc; })), Promise.resolve([]))
          .then((taskCids) => putNote({
            cid: cid, server_id: n.id, title: n.title, content: n.content != null ? n.content : "",
            linked_task_cids: JSON.stringify(taskCids), linked_to_cids: JSON.stringify(toCids),
            pinned: !!n.pinned, list_id: null, last_edited_by: n.last_edited_by != null ? n.last_edited_by : null,
            created_at: n.created_at != null ? n.created_at : null, updated_at: n.updated_at != null ? n.updated_at : null,
            deleted: false, dirty: 0, base_rev: n.updated_at != null ? n.updated_at : null,
          }));
      }), Promise.resolve()));
  }

  let _ensured = null;
  function ensureNotes(rawFetch) {
    if (_ensured) return _ensured;
    _ensured = Promise.resolve(rawFetch("/api/scratchpad"))
      .then((r) => (r && typeof r.json === "function" ? r.json() : r))
      .then((notes) => hydrateNotes(notes || []))
      .catch((e) => { _ensured = null; throw e; });
    return _ensured;
  }

  const exported = { hydrateNotes, ensureNotes };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.notehydrate = exported; }
  return exported;
});
