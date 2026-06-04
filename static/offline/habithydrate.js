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

  function put(store, rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function ensureCid(serverId, cache) {
    if (cache[serverId]) return Promise.resolve(cache[serverId]);
    return TFidmap.cidOf("habit", serverId).then((cid) => {
      if (cid) { cache[serverId] = cid; return cid; }
      const fresh = TFids.newCid();
      cache[serverId] = fresh;
      return TFidmap.mapPut("habit", serverId, fresh).then(() => fresh);
    });
  }

  function hydrateHabits(serverHabits) {
    const list = serverHabits || [];
    const cache = {};
    return list.reduce((p, h) => p.then(() => ensureCid(h.id, cache)).then((cid) => put("habits", {
      cid: cid, server_id: h.id, title: h.title,
      phase: h.phase || "pagi", micro_target: h.micro_target != null ? h.micro_target : "",
      frequency: h.frequency != null ? h.frequency : JSON.stringify(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
      identity_pillar: h.identity_pillar != null ? h.identity_pillar : "",
      created_at: h.created_at != null ? h.created_at : null, deleted: false, dirty: 0,
    })), Promise.resolve());
  }

  function hydrateLogs(serverLogs) {
    const list = serverLogs || [];
    const cache = {};
    return list.reduce((p, l) => p.then(() => ensureCid(l.habit_id, cache)).then((hcid) => put("habit_logs", {
      cid: "srv-log-" + l.habit_id + "-" + l.date, habit_cid: hcid, date: l.date,
      status: l.status, skip_reason: l.skip_reason != null ? l.skip_reason : "", dirty: 0,
    })), Promise.resolve());
  }

  let _ensured = null;
  function ensureHabits(rawFetch) {
    if (_ensured) return _ensured;
    _ensured = Promise.all([
      Promise.resolve(rawFetch("/api/habits")).then((r) => (r && typeof r.json === "function" ? r.json() : r)),
      Promise.resolve(rawFetch("/api/habits/logs")).then((r) => (r && typeof r.json === "function" ? r.json() : r)),
    ]).then(([habits, logs]) => hydrateHabits(habits || []).then(() => hydrateLogs(logs || [])))
      .catch((e) => { _ensured = null; throw e; });
    return _ensured;
  }

  const exported = { hydrateHabits, hydrateLogs, ensureHabits };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.habithydrate = exported; }
  return exported;
});
