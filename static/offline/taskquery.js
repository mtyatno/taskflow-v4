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
  const TFdb = isNode ? require("./db.js") : root.TF.db;
  const TFrepo = isNode ? require("./taskrepo.js") : root.TF.taskrepo;

  function getAllRaw() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("tasks", "readonly").objectStore("tasks").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }

  function isActive(rec) {
    return rec.gtd_status !== "done" && rec.gtd_status !== "archived";
  }

  function truthy(v) {
    return v === true || v === "true" || v === 1 || v === "1";
  }

  function matchesQuery(rec, q) {
    q = q || {};
    if (q.status) {
      if (rec.gtd_status !== q.status) return false;
    } else if (!truthy(q.include_done)) {
      if (!isActive(rec)) return false;
    }
    if (q.priority && rec.priority !== String(q.priority).toUpperCase()) return false;
    if (q.quadrant && rec.quadrant !== String(q.quadrant).toUpperCase()) return false;
    if (q.project != null && q.project !== "" && rec.project !== q.project) return false;
    if (q.context != null && q.context !== "" && rec.context !== q.context) return false;
    // q.tag is intentionally ignored (tags not persisted locally yet — see plan non-goals).
    return true;
  }

  // priority asc (P1<P2<P3<P4), then deadline asc with NULL first (SQLite parity).
  function compareTasks(a, b) {
    if (a.priority !== b.priority) return a.priority < b.priority ? -1 : 1;
    const ad = a.deadline, bd = b.deadline;
    if (ad === bd) return 0;
    if (ad == null) return -1;
    if (bd == null) return 1;
    return ad < bd ? -1 : 1;
  }

  function listTasks(query, opts) {
    const today = opts && opts.today;
    return getAllRaw().then((all) => {
      const live = all.filter((r) => !r.deleted);
      const titleByCid = {};
      for (const r of live) titleByCid[r.cid] = r.title;
      const rows = live.filter((r) => matchesQuery(r, query)).sort(compareTasks);
      return rows.map((r) => {
        const parentTitle = r.parent_cid ? (titleByCid[r.parent_cid] != null ? titleByCid[r.parent_cid] : null) : null;
        return TFrepo.displayFrom(r, today, parentTitle);
      });
    });
  }

  const exported = { listTasks };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.taskquery = exported; }
  return exported;
});
