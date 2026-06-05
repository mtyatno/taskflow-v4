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
  const TFrouter = req("./router.js", root.TF && root.TF.router);
  const TFrepo = req("./taskrepo.js", root.TF && root.TF.taskrepo);
  const TFquery = req("./taskquery.js", root.TF && root.TF.taskquery);
  const TFtag = req("./tagrepo.js", root.TF && root.TF.tagrepo);
  const TFrec = req("./recurrence.js", root.TF && root.TF.recurrence);
  const TFlistsync = req("./listsync.js", root.TF && root.TF.listsync);
  const TFhabitroutes = req("./habitroutes.js", root.TF && root.TF.habitroutes);
  const TFnoteroutes = req("./noteroutes.js", root.TF && root.TF.noteroutes);

  function todayISO() {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  }

  function getAllTasks() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("tasks", "readonly").objectStore("tasks").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }

  function displayIdOf(rec) {
    return rec.server_id != null ? rec.server_id : rec.cid;
  }

  function withId(row) {
    if (!row) return row;
    row.id = displayIdOf(row);
    return row;
  }

  // Resolve a path id (string) to a local cid: direct cid match, else by server_id.
  function resolveCid(idOrCid) {
    return getAllTasks().then((all) => {
      for (const r of all) if (r.cid === idOrCid) return r.cid;
      for (const r of all) if (r.server_id != null && String(r.server_id) === String(idOrCid)) return r.cid;
      return null;
    });
  }

  function notFound() { return Promise.reject(new Error("Task not found")); }

  // GET /api/tags?entity_type=note must stay on the network (note tags not local yet).
  function isNoteTagsCall(method, path) {
    if (method.toUpperCase() !== "GET") return false;
    const q = path.indexOf("?");
    if (q === -1) return false;
    const base = path.slice(0, q).replace(/\/+$/, "");
    if (base !== "/api/tags") return false;
    return /(^|&)entity_type=note(&|$)/.test(path.slice(q + 1));
  }

  function buildTaskRouter() {
    const router = TFrouter.makeRouter();
    const opts = () => ({ today: todayISO() });

    router.register("GET", "/api/tasks", ({ query }) =>
      TFquery.listTasks(query, opts()).then((rows) => rows.map(withId)));

    router.register("GET", "/api/tasks/:id", ({ params }) =>
      resolveCid(params.id).then((cid) => (cid ? TFrepo.getTask(cid, todayISO()) : null))
        .then((row) => (row ? withId(row) : notFound())));

    router.register("POST", "/api/tasks", ({ body }) =>
      TFrepo.createTask(body || {}, opts()).then(withId));

    router.register("PUT", "/api/tasks/:id", ({ params, body }) =>
      resolveCid(params.id).then((cid) => (cid ? TFrepo.updateTask(cid, body || {}, opts()) : notFound())).then(withId));

    router.register("DELETE", "/api/tasks/:id", ({ params }) =>
      resolveCid(params.id).then((cid) => (cid ? TFrepo.deleteTask(cid, opts()) : notFound())));

    router.register("GET", "/api/summary", () => TFquery.getSummary(opts()));
    router.register("GET", "/api/projects", () => TFquery.getProjects());
    router.register("GET", "/api/contexts", () => TFquery.getContexts());

    router.register("GET", "/api/tasks/:id/tags", ({ params }) =>
      resolveCid(params.id).then((cid) => (cid ? TFtag.getEntityTags("task", cid) : notFound())));

    router.register("GET", "/api/tags", () => TFtag.getAllTags());

    router.register("DELETE", "/api/tasks/:id/tags/:name", ({ params }) =>
      resolveCid(params.id).then((cid) => (cid ? TFtag.removeEntityTag("task", cid, params.name) : notFound())));

    router.register("GET", "/api/recurring/exceptions", ({ query }) =>
      Promise.all([TFrec.getExceptions(query.from, query.to), getAllTasks()]).then(([byCid, all]) => {
        const disp = {};
        for (const r of all) disp[r.cid] = displayIdOf(r);
        const out = {};
        for (const cid in byCid) out[String(disp[cid] != null ? disp[cid] : cid)] = byCid[cid];
        return out;
      }));

    router.register("POST", "/api/tasks/:id/occurrences/:date/mark", ({ params, body }) =>
      resolveCid(params.id).then((cid) => (cid ? TFrec.markOccurrence(cid, params.date, (body || {}).status, {}) : notFound())));

    router.register("GET", "/api/lists", () => TFlistsync.getLocalLists());

    router.register("GET", "/api/lists/:id/tasks", ({ params }) =>
      TFquery.listTasks({}, opts()).then((rows) =>
        rows.filter((r) => String(r.list_id) === String(params.id)).map(withId)));

    TFhabitroutes.registerHabitRoutes(router);
    TFnoteroutes.registerNoteRoutes(router);

    return router;
  }

  const exported = { buildTaskRouter, isNoteTagsCall };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.taskroutes = exported; }
  return exported;
});
