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
  const TFtagrepo = isNode ? require("./tagrepo.js") : root.TF.tagrepo;

  // today (YYYY-MM-DD) + 90 days, UTC-stable.
  function plus90(todayISO) {
    const base = todayISO || new Date().toISOString().slice(0, 10);
    const [y, m, d] = String(base).slice(0, 10).split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d) + 90 * 86400000);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }

  // Normalize recurrence type + days → { type, daysJson } matching the server.
  function normRecurrence(type, days) {
    const t = (type === "daily" || type === "weekly" || type === "monthly" || type === "weekdays") ? type : null;
    let daysJson = null;
    if (t === "weekly" && Array.isArray(days)) {
      daysJson = JSON.stringify(days.map(Number).filter((n) => n >= 0 && n <= 6));
    } else if (t === "monthly" && Array.isArray(days) && days.length) {
      daysJson = JSON.stringify([Math.max(1, Math.min(28, Number(days[0])))]);
    }
    return { type: t, daysJson: daysJson };
  }

  function getRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("tasks", "readonly").objectStore("tasks").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }

  // Pure: build the frontend-facing display object from a record + resolved parent title.
  function displayFrom(rec, todayISO, parentTitle) {
    const derived = TFlogic.deriveTaskFields(rec, todayISO);
    return Object.assign({}, rec, {
      is_focused: !!rec.is_focused,
      days_until_deadline: derived.days_until_deadline,
      is_overdue: derived.is_overdue,
      assigned_to_name: null, // resolution deferred (no local users store yet)
      parent_title: parentTitle != null ? parentTitle : null,
    });
  }

  // Async: resolve parent title from the store, then assemble.
  function assemble(rec, todayISO) {
    return getParentTitle(rec.parent_cid).then((parentTitle) => displayFrom(rec, todayISO, parentTitle));
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

  function createTask(input, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    const ex = TFtagrepo.extractTags(input.title);
    const cleanTitle = ex.clean;
    if (!cleanTitle) {
      return Promise.reject(new Error("Judul tidak boleh kosong setelah strip tag"));
    }
    const priority = String(input.priority || "P3").toUpperCase();
    const deadline = input.deadline || null;
    const rc = normRecurrence(input.recurrence_type, input.recurrence_days);
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
      list_id: input.list_id != null ? input.list_id : null,
      assigned_to: input.assigned_to != null ? input.assigned_to : null,
      parent_cid: input.parent_cid != null ? input.parent_cid : null,
      progress: 0,
      is_focused: 0,
      completed_at: null,
      recurrence_type: rc.type,
      recurrence_days: rc.daysJson,
      recurrence_end_date: rc.type ? plus90(opts && opts.today) : null,
      recurrence_notif_level: null,
      created_at: now,
      updated_at: now,
      deleted: false,
      dirty: 1,
      base_rev: null,
    };
    return putRaw(rec)
      .then(() => TFoutbox.outboxAdd({ op: "create", entity_type: "task", cid: rec.cid, payload: rec }))
      .then(() => TFtagrepo.setEntityTags("task", rec.cid, ex.tags))
      .then(() => assemble(rec, opts && opts.today));
  }

  function updateTask(cid, patch, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    return getRaw(cid).then((rec) => {
      if (!rec || rec.deleted) {
        return Promise.reject(new Error("Task not found"));
      }
      const next = Object.assign({}, rec);

      let newTags = null;
      if (patch.title != null) {
        const ex = TFtagrepo.extractTags(patch.title);
        if (!ex.clean) return Promise.reject(new Error("Judul tidak boleh kosong setelah strip tag"));
        next.title = ex.clean;
        newTags = ex.tags;
      }
      if (patch.description != null) next.description = patch.description;
      if (patch.priority != null) next.priority = String(patch.priority).toUpperCase();
      if (patch.project != null) next.project = patch.project;
      if (patch.context != null) next.context = patch.context;
      if (patch.waiting_for != null) next.waiting_for = patch.waiting_for;
      if (patch.gtd_status != null) {
        next.gtd_status = patch.gtd_status;
        if (patch.gtd_status === "done") next.completed_at = now;
      }
      if (patch.deadline != null) {
        next.deadline = (patch.deadline === "" || patch.deadline === "-") ? null : patch.deadline;
      }
      if (patch.assigned_to != null) {
        next.assigned_to = patch.assigned_to === 0 ? null : patch.assigned_to;
      }
      if (patch.progress != null) {
        next.progress = Math.max(0, Math.min(100, patch.progress));
      }

      if (patch.recurrence_renew) {
        next.recurrence_end_date = plus90(opts && opts.today);
        next.recurrence_notif_level = null;
      } else if ("recurrence_type" in patch) {
        const rc = normRecurrence(patch.recurrence_type, patch.recurrence_days);
        if (rc.type) {
          next.recurrence_type = rc.type;
          next.recurrence_days = rc.daysJson;
          if (!next.recurrence_end_date) next.recurrence_end_date = plus90(opts && opts.today);
        } else {
          next.recurrence_type = null;
          next.recurrence_days = null;
          next.recurrence_end_date = null;
          next.recurrence_notif_level = null;
        }
      }

      next.updated_at = now;
      next.dirty = 1;
      next.quadrant = TFlogic.calculateQuadrant(
        { priority: next.priority, deadline: next.deadline },
        opts && opts.today
      );

      return putRaw(next)
        .then(() => TFoutbox.outboxAdd({ op: "update", entity_type: "task", cid: cid, payload: next }))
        .then(() => (newTags != null ? TFtagrepo.setEntityTags("task", cid, newTags) : null))
        .then(() => assemble(next, opts && opts.today));
    });
  }

  function deleteTask(cid, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    return getRaw(cid).then((rec) => {
      if (!rec || rec.deleted) {
        return Promise.reject(new Error("Task not found"));
      }
      const next = Object.assign({}, rec, { deleted: true, dirty: 1, updated_at: now });
      return putRaw(next)
        .then(() => TFoutbox.outboxAdd({ op: "delete", entity_type: "task", cid: cid, payload: { cid: cid } }))
        .then(() => ({ ok: true }));
    });
  }

  const exported = { getTask, createTask, updateTask, deleteTask, displayFrom };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.taskrepo = exported; }
  return exported;
});
