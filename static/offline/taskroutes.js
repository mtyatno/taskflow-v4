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
  const TFdrawingroutes = req("./drawingroutes.js", root.TF && root.TF.drawingroutes);
  const TFmindmaproutes = req("./mindmaproutes.js", root.TF && root.TF.mindmaproutes);
  const TFchatroutes = req("./chatroutes.js", root.TF && root.TF.chatroutes);
  const TFprojects = req("./projectcache.js", root.TF && root.TF.projectcache);

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

  // Resolve a path id (string) to a local cid: direct cid match, else by server_id, else by client_id.
  function resolveCid(idOrCid) {
    return getAllTasks().then((all) => {
      for (const r of all) if (r.cid === idOrCid) return r.cid;
      for (const r of all) if (r.server_id != null && String(r.server_id) === String(idOrCid)) return r.cid;
      // id dari perangkat lain (link node mindmap = cid pembuat = client_id server; cid lokal bisa berbeda)
      for (const r of all) if (r.client_id != null && String(r.client_id) === String(idOrCid)) return r.cid;
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

  // /api/scratchpad/trash... (Sampah note, semua method) hanya ada di server. Tanpa ini rute lokal
  // GET/DELETE /api/scratchpad/:id menelan /api/scratchpad/trash → "Note not found".
  function isNoteTrashCall(method, path) {
    const q = path.indexOf("?");
    const base = (q === -1 ? path : path.slice(0, q)).replace(/\/+$/, "");
    return base === "/api/scratchpad/trash" || base.startsWith("/api/scratchpad/trash/");
  }

  // Sampah mindmap: hapus permanen & kosongkan (destruktif) hanya online. Tanpa ini DELETE /api/mindmaps/trash
  // ditelan rute lokal DELETE /api/mindmaps/:id. GET/POST restore tetap lokal (mindmaptrash.js).
  function isMindmapTrashDelete(method, path) {
    if (String(method || "GET").toUpperCase() !== "DELETE") return false;
    const q = path.indexOf("?");
    const base = (q === -1 ? path : path.slice(0, q)).replace(/\/+$/, "");
    return base === "/api/mindmaps/trash" || base.startsWith("/api/mindmaps/trash/");
  }

  // K6: GET /api/tasks/:id/subtasks|notes|attachments — store lokalnya tidak pernah diisi (tidak ada pull),
  // jadi rute lokal hanya dipakai untuk task yang belum tersinkron (id = cid → `[]`); id numerik (task sudah
  // ada di server) diteruskan ke jaringan supaya subtask/catatan/lampiran dari server tampil lagi.
  function isTaskChildListCall(method, path) {
    if (String(method || "GET").toUpperCase() !== "GET") return false;
    const q = path.indexOf("?");
    const base = (q === -1 ? path : path.slice(0, q)).replace(/\/+$/, "");
    const m = /^\/api\/tasks\/([^/]+)\/(subtasks|notes|attachments)$/.exec(base);
    return m ? { id: m[1], kind: m[2], numeric: /^\d+$/.test(m[1]) } : null;
  }

  // Keputusan api wrapper (index.html): layani dari router lokal, atau teruskan ke jaringan.
  function shouldRouteLocally(router, method, path) {
    if (!router) return false;
    const m = String(method || "GET").toUpperCase();
    if (isNoteTagsCall(m, path) || isNoteTrashCall(m, path) || isMindmapTrashDelete(m, path)) return false;
    const child = isTaskChildListCall(m, path);
    if (child && child.numeric) return false; // K6: data ada di server, bukan di store lokal
    return router.hasRoute(m, path);
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

    router.register("POST", "/api/tasks/:id/done", ({ params }) =>
      resolveCid(params.id)
        .then((cid) => (cid ? TFrepo.updateTask(cid, { gtd_status: "done" }, opts()) : notFound()))
        .then(withId));

    router.register("POST", "/api/tasks/:id/focus", ({ params }) =>
      resolveCid(params.id)
        .then((cid) => {
          if (!cid) return notFound();
          return TFrepo.getRaw(cid).then((rec) => {
            if (!rec || rec.deleted) return notFound();
            const nextVal = rec.is_focused ? 0 : 1;
            return TFrepo.updateTask(cid, { is_focused: nextVal }, opts());
          });
        })
        .then(withId));

    router.register("GET", "/api/tasks/:id/child-tasks", ({ params }) =>
      resolveCid(params.id).then((cid) => {
        if (!cid) return [];
        return getAllTasks().then((all) =>
          all.filter((r) => !r.deleted && r.parent_cid === cid).map(withId)
        );
      }));

    router.register("GET", "/api/tasks/:id/subtasks", ({ params }) =>
      resolveCid(params.id).then((cid) => {
        if (!cid) return [];
        return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
          const tx = db.transaction("subtasks", "readonly");
          const idx = tx.objectStore("subtasks").index("task_cid");
          const r = idx.getAll(cid);
          r.onsuccess = () => resolve((r.result || []).filter((s) => !s.deleted));
          r.onerror = () => reject(r.error);
        }));
      }));

    router.register("GET", "/api/tasks/:id/notes", ({ params }) =>
      resolveCid(params.id).then((cid) => {
        if (!cid) return [];
        return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
          const tx = db.transaction("task_notes", "readonly");
          const idx = tx.objectStore("task_notes").index("task_cid");
          const r = idx.getAll(cid);
          r.onsuccess = () => resolve((r.result || []).filter((n) => !n.deleted));
          r.onerror = () => reject(r.error);
        }));
      }));

    router.register("GET", "/api/tasks/:id/attachments", ({ params }) =>
      resolveCid(params.id).then((cid) => {
        if (!cid) return [];
        return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
          const tx = db.transaction("task_attachments", "readonly");
          const idx = tx.objectStore("task_attachments").index("task_cid");
          const r = idx.getAll(cid);
          r.onsuccess = () => resolve(r.result || []);
          r.onerror = () => reject(r.error);
        }));
      }));

    router.register("GET", "/api/summary", () => TFquery.getSummary(opts()));
    // PR 5: tanpa query → string[] pribadi (pemanggil lama); ?list_id=W → nama di W; ?format=full → item cache
    // (tanpa list_id = pribadi). POST/PATCH/DELETE /api/projects sengaja tidak lokal (butuh jaringan).
    router.register("GET", "/api/projects", ({ query }) => {
      const q = query || {};
      const listId = (q.list_id != null && q.list_id !== "") ? q.list_id : null;
      if (q.format === "full") {
        const ia = q.include_archived;
        return TFprojects.list(listId, { includeArchived: ia === "1" || ia === "true" });
      }
      return TFprojects.names(listId);
    });
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
    TFdrawingroutes.registerDrawingRoutes(router);
    TFmindmaproutes.registerMindmapRoutes(router);
    TFchatroutes.registerChatRoutes(router);

    return router;
  }

  const exported = { buildTaskRouter, isNoteTagsCall, isNoteTrashCall, isMindmapTrashDelete, isTaskChildListCall, shouldRouteLocally };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.taskroutes = exported; }
  return exported;
});
