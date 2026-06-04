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
  const TFtag = req("./tagrepo.js", root.TF && root.TF.tagrepo);
  const TFlogic = req("./habitlogic.js", root.TF && root.TF.habitlogic);

  function getAll(store) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction(store, "readonly").objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  function withId(rec) { return Object.assign({}, rec, { id: rec.server_id != null ? rec.server_id : rec.cid }); }
  const PHASE_ORDER = { pagi: 0, siang: 1, malam: 2 };
  function byPhase(a, b) {
    const pa = PHASE_ORDER[a.phase] != null ? PHASE_ORDER[a.phase] : 9;
    const pb = PHASE_ORDER[b.phase] != null ? PHASE_ORDER[b.phase] : 9;
    if (pa !== pb) return pa - pb;
    const sa = a.server_id != null ? a.server_id : 0, sb = b.server_id != null ? b.server_id : 0;
    return sa - sb;
  }

  function liveHabits() {
    return getAll("habits").then((all) => all.filter((h) => !h.deleted).sort(byPhase));
  }

  function getHabits(query) {
    const q = query || {};
    const tagP = (q.tag != null && q.tag !== "") ? TFtag.cidsForTag("habit", q.tag) : Promise.resolve(null);
    return Promise.all([liveHabits(), tagP]).then(([habits, set]) => {
      let rows = habits;
      if (set) rows = rows.filter((h) => set.has(h.cid));
      return rows.map(withId);
    });
  }

  function logsByHabit() {
    return getAll("habit_logs").then((all) => {
      const map = {};
      for (const l of all) {
        if (!map[l.habit_cid]) map[l.habit_cid] = {};
        map[l.habit_cid][l.date] = { status: l.status, skip_reason: l.skip_reason || "" };
      }
      return map;
    });
  }

  function getHabitsToday(opts) {
    const today = (opts && opts.today) || TFlogic.todayJkt();
    return Promise.all([liveHabits(), logsByHabit()]).then(([habits, logmap]) =>
      habits.map((h) => {
        const d = TFlogic.deriveToday(h, logmap[h.cid] || {}, today);
        return Object.assign(withId(h), {
          frequency: h.frequency ? JSON.parse(h.frequency) : [],
          today_status: d.today_status, skip_reason: d.skip_reason, streak: d.streak, week_log: d.week_log,
        });
      }));
  }

  function getHabitsMonthly(opts) {
    const today = (opts && opts.today) || TFlogic.todayJkt();
    const [y, m, dd] = today.split("-").map(Number);
    return getAll("habit_logs").then((all) => TFlogic.monthly(all, y, m, dd));
  }

  const exported = { getHabits, getHabitsToday, getHabitsMonthly };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.habitquery = exported; }
  return exported;
});
