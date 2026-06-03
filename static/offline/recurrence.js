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

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function getAll(store) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction(store, "readonly").objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }

  function getTaskRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("tasks", "readonly").objectStore("tasks").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }

  function markOccurrence(taskCid, occurrenceDate, status, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    if (status !== "done" && status !== "skipped") {
      return Promise.reject(new Error("status harus 'done' atau 'skipped'"));
    }
    if (!DATE_RE.test(String(occurrenceDate))) {
      return Promise.reject(new Error("Format tanggal tidak valid (YYYY-MM-DD)"));
    }
    return getTaskRaw(taskCid).then((task) => {
      if (!task || task.deleted) return Promise.reject(new Error("Task not found"));
      if (!task.recurrence_type) return Promise.reject(new Error("Task ini bukan recurring task"));
      const created = String(task.created_at).slice(0, 10);
      const end = task.recurrence_end_date;
      if (occurrenceDate < created || (end && occurrenceDate > end)) {
        return Promise.reject(new Error("Tanggal di luar range recurring task"));
      }
      return upsertException(taskCid, occurrenceDate, status, now);
    });
  }

  function upsertException(taskCid, occurrenceDate, status, now) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("recurring_exceptions", "readwrite");
      const store = tx.objectStore("recurring_exceptions");
      const idx = store.index("task_cid");
      let record = null;
      const cur = idx.openCursor(IDBKeyRange.only(taskCid));
      cur.onsuccess = (e) => {
        const c = e.target.result;
        if (c) {
          if (c.value.occurrence_date === occurrenceDate) {
            record = Object.assign({}, c.value, { status: status });
            c.update(record);
            return; // matched — stop
          }
          c.continue();
        } else if (!record) {
          record = {
            cid: TFids.newCid(), task_cid: taskCid,
            occurrence_date: occurrenceDate, status: status, created_at: now, dirty: 1,
          };
          store.add(record);
        }
      };
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
    })).then((record) =>
      TFoutbox.outboxAdd({
        op: "mark_occurrence", entity_type: "recurring_exception", cid: record.cid, payload: record,
      }).then(() => record)
    );
  }

  function getExceptions(fromDate, toDate) {
    return Promise.all([getAll("recurring_exceptions"), getAll("tasks")]).then(([excs, tasks]) => {
      const live = {};
      for (const t of tasks) if (!t.deleted) live[t.cid] = true;
      const out = {};
      for (const ex of excs) {
        if (!live[ex.task_cid]) continue;
        if (ex.occurrence_date < fromDate || ex.occurrence_date > toDate) continue;
        if (!out[ex.task_cid]) out[ex.task_cid] = [];
        out[ex.task_cid].push({ occurrence_date: ex.occurrence_date, status: ex.status });
      }
      return out;
    });
  }

  const exported = { markOccurrence, getExceptions };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.recurrence = exported; }
  return exported;
});
