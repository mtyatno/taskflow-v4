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
  const TFhq = req("./habitquery.js", root.TF && root.TF.habitquery);
  const TFhr = req("./habitrepo.js", root.TF && root.TF.habitrepo);
  const TFtag = req("./tagrepo.js", root.TF && root.TF.tagrepo);
  const TFlogic = req("./habitlogic.js", root.TF && root.TF.habitlogic);

  function allHabits() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("habits", "readonly").objectStore("habits").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  function resolveHabitCid(idOrCid) {
    return allHabits().then((all) => {
      for (const h of all) if (h.cid === idOrCid) return h.cid;
      for (const h of all) if (h.server_id != null && String(h.server_id) === String(idOrCid)) return h.cid;
      return null;
    });
  }
  function notFound() { return Promise.reject(new Error("Habit not found")); }

  function registerHabitRoutes(router) {
    router.register("GET", "/api/habits", ({ query }) => TFhq.getHabits(query));
    router.register("GET", "/api/habits/today", () => TFhq.getHabitsToday({}));
    router.register("GET", "/api/habits/monthly", () => TFhq.getHabitsMonthly({}));
    router.register("POST", "/api/habits", ({ body }) => TFhr.createHabit(body || {}, {}));
    router.register("POST", "/api/habits/:id/update", ({ params, body }) =>
      resolveHabitCid(params.id).then((cid) => (cid ? TFhr.updateHabit(cid, body || {}, {}) : notFound())));
    router.register("POST", "/api/habits/:id/checkin", ({ params, body }) =>
      resolveHabitCid(params.id).then((cid) => {
        if (!cid) return notFound();
        const b = body || {};
        return TFhr.checkin(cid, b.date || TFlogic.todayJkt(), b.status, b.skip_reason || "", {});
      }));
    router.register("DELETE", "/api/habits/:id", ({ params }) =>
      resolveHabitCid(params.id).then((cid) => (cid ? TFhr.deleteHabit(cid, {}) : notFound())));
    router.register("GET", "/api/habits/:id/tags", ({ params }) =>
      resolveHabitCid(params.id).then((cid) => (cid ? TFtag.getEntityTags("habit", cid) : notFound())));
    router.register("DELETE", "/api/habits/:id/tags/:name", ({ params }) =>
      resolveHabitCid(params.id).then((cid) => (cid ? TFtag.removeEntityTag("habit", cid, params.name) : notFound())));
  }

  const exported = { registerHabitRoutes };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.habitroutes = exported; }
  return exported;
});
