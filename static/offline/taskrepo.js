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
  // dimuat malas (siklus: projectcache → taskquery → taskrepo)
  // pomologic dimuat setelah taskrepo di index.html → akses malas (seperti TFprojects).
  const TFpomo = () => (isNode ? require("./pomologic.js") : (root.TF && root.TF.pomologic));
  const TFprojects = () => (isNode ? require("./projectcache.js") : (root.TF && root.TF.projectcache));
  // Kanban tahap: contextcache juga dimuat malas (sama seperti projectcache).
  const TFcontexts = () => (isNode ? require("./contextcache.js") : (root.TF && root.TF.contextcache));

  // ASCII-only lowercase (SQLite NOCASE), sama dengan projectcache.nocaseKey (tanpa require: siklus).
  function nocaseKey(s) {
    return String(s == null ? "" : s).replace(/[A-Z]/g, (c) => c.toLowerCase());
  }

  // PR 5: project_id eksplisit menang; selain itu id project bernama sama (NOCASE) di scope task dari cache,
  // atau null. Cache yang tidak tersedia/gagal dibaca → null (server mencocokkan lewat teks).
  function resolveProjectId(listId, project, explicit) {
    if (explicit !== undefined) return Promise.resolve(explicit != null ? explicit : null);
    if (project == null || project === "") return Promise.resolve(null);
    const pc = TFprojects();
    if (!pc || !pc.idFor) return Promise.resolve(null);
    return pc.idFor(listId, project).catch(() => null);
  }

  // Kanban tahap: context_id eksplisit (termasuk null / cid pending) menang; selain itu id tahap bernama sama
  // (NOCASE) di scope task dari cache (server + pending), atau null. Cache tak tersedia/gagal dibaca → null.
  function resolveContextId(listId, context, explicit) {
    if (explicit !== undefined) return Promise.resolve(explicit != null ? explicit : null);
    if (context == null || context === "") return Promise.resolve(null);
    const cc = TFcontexts();
    if (!cc || !cc.allItems || !cc.findId) return Promise.resolve(null);
    return cc.allItems().then((items) => cc.findId(items, listId, context)).catch(() => null);
  }

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
    const priority = String(input.priority || "P2").toUpperCase();
    const deadline = input.deadline || null;
    const rc = normRecurrence(input.recurrence_type, input.recurrence_days);
    const listId = input.list_id != null ? input.list_id : null;
    return Promise.all([
      resolveProjectId(listId, input.project, input.project_id),
      resolveContextId(listId, input.context, input.context_id),
    ]).then(([projectId, contextId]) => {
      const rec = {
        cid: TFids.newCid(),
        server_id: null,
        title: cleanTitle,
        description: input.description != null ? input.description : "",
        gtd_status: input.gtd_status != null ? input.gtd_status : "inbox",
        priority: priority,
        quadrant: TFlogic.calculateQuadrant({ priority: priority, deadline: deadline }, opts && opts.today),
        project: input.project != null ? input.project : "",
        project_id: projectId,
        project_ref_name: projectId != null ? (input.project != null ? input.project : "") : null,
        context: input.context != null ? input.context : "",
        context_id: contextId,
        context_ref_name: contextId != null ? (input.context != null ? input.context : "") : null,
        deadline: deadline,
        waiting_for: input.waiting_for != null ? input.waiting_for : "",
        list_cid: input.list_cid != null ? input.list_cid : null,
        list_id: input.list_id != null ? input.list_id : null,
        assigned_to: input.assigned_to != null ? input.assigned_to : null,
        parent_cid: input.parent_cid != null ? input.parent_cid : null,
        progress: 0,
        estimated_pomodoros: TFpomo().clampEstimate(input.estimated_pomodoros != null ? input.estimated_pomodoros : 1),
        pomodoros_done: 0,
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
        // rev = penghitung versi lokal (naik di setiap tulis lokal); push memakainya sebagai CAS (prinsip 4)
        rev: 1,
      };
      return putRaw(rec)
        .then(() => TFoutbox.outboxAdd({ op: "create", entity_type: "task", cid: rec.cid, payload: rec }))
        .then(() => TFtagrepo.setEntityTags("task", rec.cid, ex.tags))
        .then(() => assemble(rec, opts && opts.today));
    });
  }

  function updateTask(cid, patch, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    // PR 5: patch `project` tanpa `project_id` → id dari cache (scope task) bila cocok, selain itu null.
    // F1: teks yang sama (NOCASE) dengan `project` record → id + nama ikatan dipertahankan (form yang menyimpan
    // teks tak berubah setelah rename di cache tidak boleh memutus id).
    const needLookup = patch.project != null && !("project_id" in patch);
    const pc = needLookup ? TFprojects() : null;
    const itemsP = (pc && pc.allItems) ? pc.allItems().catch(() => []) : Promise.resolve([]);
    // Kanban tahap: sama untuk `context` (tanpa `context_id`) → id dari cache context (server + pending).
    const needCtxLookup = patch.context != null && !("context_id" in patch);
    const cc = needCtxLookup ? TFcontexts() : null;
    const ctxItemsP = (cc && cc.allItems) ? cc.allItems().catch(() => []) : Promise.resolve([]);
    return Promise.all([getRaw(cid), itemsP, ctxItemsP]).then(([rec, projectItems, contextItems]) => {
      if (!rec || rec.deleted) {
        return Promise.reject(new Error("Task not found"));
      }
      const next = Object.assign({}, rec);

      // Judul tersimpan tanpa #tag (tag di store entity_tags), jadi judul dari form tidak memuat tag task: #tag di
      // judul MENAMBAH tag (tanpa duplikat), judul tanpa #tag tidak menyentuh tag. Dulu tag diganti dengan #tag di
      // judul → setiap simpan form menghapus semua tag, dan push (himpunan tag lokal lengkap) ikut menghapusnya di
      // server. Hapus tag tetap lewat chip × (removeEntityTag).
      let newTags = null;
      if (patch.title != null) {
        const ex = TFtagrepo.extractTags(patch.title);
        if (!ex.clean) return Promise.reject(new Error("Judul tidak boleh kosong setelah strip tag"));
        next.title = ex.clean;
        newTags = ex.tags;
      }
      if (patch.description != null) next.description = patch.description;
      if (patch.priority != null) next.priority = String(patch.priority).toUpperCase();
      const sameProjectText = patch.project != null && rec.project_id != null
        && nocaseKey(patch.project) === nocaseKey(rec.project);
      if (patch.project != null) next.project = patch.project;
      if ("project_id" in patch) {
        next.project_id = patch.project_id != null ? patch.project_id : null;
        next.project_ref_name = next.project_id != null ? (next.project != null ? next.project : "") : null;
      } else if (needLookup && !sameProjectText) {
        next.project_id = pc ? pc.findId(projectItems, next.list_id, patch.project) : null;
        next.project_ref_name = next.project_id != null ? next.project : null;
      }
      const sameContextText = patch.context != null && rec.context_id != null
        && nocaseKey(patch.context) === nocaseKey(rec.context);
      if (patch.context != null) next.context = patch.context;
      if ("context_id" in patch) {
        next.context_id = patch.context_id != null ? patch.context_id : null;
        next.context_ref_name = next.context_id != null ? (next.context != null ? next.context : "") : null;
      } else if (needCtxLookup && !sameContextText) {
        const found = cc && cc.findId ? cc.findId(contextItems, next.list_id, patch.context) : null;
        next.context_id = found != null ? found : null;
        next.context_ref_name = next.context_id != null ? next.context : null;
      }
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
      if (patch.estimated_pomodoros != null) next.estimated_pomodoros = TFpomo().clampEstimate(patch.estimated_pomodoros);
      if (patch.progress != null) {
        next.progress = Math.max(0, Math.min(100, patch.progress));
      }
      if (patch.is_focused != null) {
        next.is_focused = patch.is_focused ? 1 : 0;
      }

      if (patch.recurrence_renew) {
        // T12: perpanjangan baru berlaku di server lewat flag `recurrence_renew` di PUT (server tidak membaca
        // recurrence_end_date). Simpan flag sampai PUT sukses (syncpush membersihkannya lewat CAS) — tanggal
        // akhir lokal hanya perkiraan tampilan, nilai server diadopsi dari respons PUT.
        next.recurrence_end_date = plus90(opts && opts.today);
        next.recurrence_notif_level = null;
        next.recurrence_renew_pending = 1;
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
      next.rev = (rec.rev || 0) + 1;
      next.quadrant = TFlogic.calculateQuadrant(
        { priority: next.priority, deadline: next.deadline },
        opts && opts.today
      );

      return putRaw(next)
        .then(() => TFoutbox.outboxAdd({ op: "update", entity_type: "task", cid: cid, payload: next }))
        .then(() => (newTags != null && newTags.length ? TFtagrepo.addEntityTags("task", cid, newTags) : null))
        .then(() => assemble(next, opts && opts.today));
    });
  }

  function deleteTask(cid, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    return getRaw(cid).then((rec) => {
      if (!rec || rec.deleted) {
        return Promise.reject(new Error("Task not found"));
      }
      const next = Object.assign({}, rec, { deleted: true, dirty: 1, updated_at: now, rev: (rec.rev || 0) + 1 });
      return putRaw(next)
        .then(() => TFoutbox.outboxAdd({ op: "delete", entity_type: "task", cid: cid, payload: { cid: cid } }))
        .then(() => ({ ok: true }));
    });
  }

  const exported = { getTask, createTask, updateTask, deleteTask, displayFrom, getRaw };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.taskrepo = exported; }
  return exported;
});
