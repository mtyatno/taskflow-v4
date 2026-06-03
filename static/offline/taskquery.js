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
  const TFtagrepo = isNode ? require("./tagrepo.js") : root.TF.tagrepo;

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
    // q.tag is applied separately in listTasks (async tag→cid resolution via tagrepo).
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
    const q = query || {};
    const tagPromise = (q.tag != null && q.tag !== "")
      ? TFtagrepo.cidsForTag("task", q.tag)
      : Promise.resolve(null);
    return Promise.all([getAllRaw(), tagPromise]).then(([all, tagSet]) => {
      const live = all.filter((r) => !r.deleted);
      const titleByCid = {};
      for (const r of live) titleByCid[r.cid] = r.title;
      let rows = live.filter((r) => matchesQuery(r, q));
      if (tagSet) rows = rows.filter((r) => tagSet.has(r.cid));
      rows.sort(compareTasks);
      return rows.map((r) => {
        const parentTitle = r.parent_cid ? (titleByCid[r.parent_cid] != null ? titleByCid[r.parent_cid] : null) : null;
        return TFrepo.displayFrom(r, today, parentTitle);
      });
    });
  }

  function distinctActiveField(field) {
    return getAllRaw().then((all) => {
      const set = new Set();
      for (const r of all) {
        if (r.deleted || !isActive(r)) continue;
        const v = r[field];
        if (v != null && v !== "") set.add(v);
      }
      return Array.from(set).sort();
    });
  }

  function getProjects() { return distinctActiveField("project"); }
  function getContexts() { return distinctActiveField("context"); }

  function todayLocalISO() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function minusDaysISO(iso, n) {
    const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
    const t = Date.UTC(y, m - 1, d) - n * 86400000;
    const dt = new Date(t);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }

  function getSummary(opts) {
    const today = (opts && opts.today) || todayLocalISO();
    const cutoff7 = minusDaysISO(today, 7);
    return getAllRaw().then((all) => {
      const live = all.filter((r) => !r.deleted);
      const by_status = {};
      const by_quadrant = {};
      let overdue = 0;
      let done_last_7_days = 0;
      for (const r of live) {
        by_status[r.gtd_status] = (by_status[r.gtd_status] || 0) + 1;
        if (isActive(r)) {
          if (r.quadrant) by_quadrant[r.quadrant] = (by_quadrant[r.quadrant] || 0) + 1;
          if (r.deadline && r.deadline < today) overdue += 1;
        }
        if (r.gtd_status === "done" && r.completed_at && r.completed_at >= cutoff7) {
          done_last_7_days += 1;
        }
      }
      let total_active = 0;
      for (const k in by_status) {
        if (k !== "done" && k !== "archived") total_active += by_status[k];
      }
      return {
        by_status: by_status,
        by_quadrant: by_quadrant,
        overdue: overdue,
        total_active: total_active,
        total_done: by_status["done"] || 0,
        done_last_7_days: done_last_7_days,
        date: today,
      };
    });
  }

  const exported = { listTasks, getProjects, getContexts, getSummary };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.taskquery = exported; }
  return exported;
});
