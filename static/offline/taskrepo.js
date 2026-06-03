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
  const TFids = isNode ? require("./ids.js") : root.TF.ids;
  const TFoutbox = isNode ? require("./outbox.js") : root.TF.outbox;
  const TFlogic = isNode ? require("./tasklogic.js") : root.TF.tasklogic;

  const TAG_RE = /#([a-zA-Z0-9_À-ɏ]+)/g;

  function getRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("tasks", "readonly").objectStore("tasks").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }

  // Build the frontend-facing display object from a stored record.
  function assemble(rec, todayISO) {
    const derived = TFlogic.deriveTaskFields(rec, todayISO);
    return getParentTitle(rec.parent_cid).then((parentTitle) =>
      Object.assign({}, rec, {
        is_focused: !!rec.is_focused,
        days_until_deadline: derived.days_until_deadline,
        is_overdue: derived.is_overdue,
        assigned_to_name: null, // resolution deferred (no local users store yet)
        parent_title: parentTitle,
      })
    );
  }

  function getParentTitle(parentCid) {
    if (!parentCid) return Promise.resolve(null);
    return getRaw(parentCid).then((p) => (p && !p.deleted ? p.title : null));
  }

  function getTask(cid, todayISO) {
    return getRaw(cid).then((rec) => {
      if (!rec || rec.deleted) return undefined;
      return assemble(rec, todayISO);
    });
  }

  function putRaw(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      tx.objectStore("tasks").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function stripTags(title) {
    return String(title).replace(TAG_RE, "").trim();
  }

  function createTask(input, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    const cleanTitle = stripTags(input.title);
    if (!cleanTitle) {
      return Promise.reject(new Error("Judul tidak boleh kosong setelah strip tag"));
    }
    const priority = String(input.priority || "P3").toUpperCase();
    const deadline = input.deadline || null;
    const rec = {
      cid: TFids.newCid(),
      server_id: null,
      title: cleanTitle,
      description: input.description != null ? input.description : "",
      gtd_status: input.gtd_status != null ? input.gtd_status : "inbox",
      priority: priority,
      quadrant: TFlogic.calculateQuadrant({ priority: priority, deadline: deadline }, opts && opts.today),
      project: input.project != null ? input.project : "",
      context: input.context != null ? input.context : "",
      deadline: deadline,
      waiting_for: input.waiting_for != null ? input.waiting_for : "",
      list_cid: input.list_cid != null ? input.list_cid : null,
      assigned_to: input.assigned_to != null ? input.assigned_to : null,
      parent_cid: input.parent_cid != null ? input.parent_cid : null,
      progress: 0,
      is_focused: 0,
      completed_at: null,
      created_at: now,
      updated_at: now,
      deleted: false,
      dirty: 1,
      base_rev: null,
    };
    return putRaw(rec)
      .then(() => TFoutbox.outboxAdd({ op: "create", entity_type: "task", cid: rec.cid, payload: rec }))
      .then(() => assemble(rec, opts && opts.today));
  }

  const exported = { getTask, createTask };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.taskrepo = exported; }
  return exported;
});
