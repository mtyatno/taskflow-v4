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
  const TFoutbox = req("./outbox.js", root.TF && root.TF.outbox);
  const TFidmap = req("./idmap.js", root.TF && root.TF.idmap);
  const TFtag = req("./tagrepo.js", root.TF && root.TF.tagrepo);

  function titleWithTags(record, tagNames) {
    const base = String(record.title == null ? "" : record.title).replace(/\s+$/, "");
    return base + (tagNames || []).map((t) => " #" + t).join("");
  }

  function taskToCreatePayload(record, tagNames, parentServerId) {
    return {
      title: titleWithTags(record, tagNames),
      description: record.description != null ? record.description : "",
      priority: record.priority || "P3",
      project: record.project != null ? record.project : "",
      context: record.context != null ? record.context : "",
      deadline: record.deadline != null ? record.deadline : null,
      gtd_status: record.gtd_status || "inbox",
      waiting_for: record.waiting_for != null ? record.waiting_for : "",
      list_id: record.list_id != null ? record.list_id : null,
      assigned_to: record.assigned_to != null ? record.assigned_to : null,
      parent_id: parentServerId != null ? parentServerId : null,
      recurrence_type: record.recurrence_type != null ? record.recurrence_type : null,
      recurrence_days: record.recurrence_days ? JSON.parse(record.recurrence_days) : null,
    };
  }

  function taskToUpdatePayload(record, tagNames) {
    return {
      title: titleWithTags(record, tagNames),
      description: record.description != null ? record.description : "",
      priority: record.priority || "P3",
      project: record.project != null ? record.project : "",
      context: record.context != null ? record.context : "",
      deadline: record.deadline != null ? record.deadline : null,
      gtd_status: record.gtd_status || "inbox",
      waiting_for: record.waiting_for != null ? record.waiting_for : "",
      assigned_to: record.assigned_to != null ? record.assigned_to : null,
      progress: record.progress != null ? record.progress : 0,
      recurrence_type: record.recurrence_type != null ? record.recurrence_type : null,
      recurrence_days: record.recurrence_days ? JSON.parse(record.recurrence_days) : null,
    };
  }

  function markPayload(record) {
    return { status: record.status };
  }

  function habitToCreatePayload(record, tagNames) {
    return {
      title: titleWithTags(record, tagNames),
      phase: record.phase || "pagi",
      micro_target: record.micro_target != null ? record.micro_target : "",
      frequency: record.frequency ? JSON.parse(record.frequency) : [],
      identity_pillar: record.identity_pillar != null ? record.identity_pillar : "",
    };
  }
  function habitToUpdatePayload(record, tagNames) {
    return habitToCreatePayload(record, tagNames);
  }
  function checkinPayload(record) {
    return {
      date: record.date,
      status: record.status,
      skip_reason: record.skip_reason != null ? record.skip_reason : "",
    };
  }

  function noteToCreatePayload(record, tagNames, taskServerIds) {
    return {
      title: record.title != null ? record.title : "",
      content: record.content != null ? record.content : "",
      tags: tagNames || [],
      linked_task_ids: taskServerIds || [],
      list_id: null,
    };
  }
  function noteToUpdatePayload(record, tagNames, taskServerIds) {
    return noteToCreatePayload(record, tagNames, taskServerIds);
  }

  function getTaskRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("tasks", "readonly").objectStore("tasks").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function putTaskRaw(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      tx.objectStore("tasks").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function deleteTaskRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      tx.objectStore("tasks").delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function getHabitRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("habits", "readonly").objectStore("habits").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function putHabitRaw(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("habits", "readwrite");
      tx.objectStore("habits").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function deleteHabitRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("habits", "readwrite");
      tx.objectStore("habits").delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  // Removed from the shared list (HTTP 403): drop access — delete local task + idmap + op.
  function lostAccess(rec, op) {
    return (rec.server_id != null ? TFidmap.mapDelete("task", rec.server_id) : Promise.resolve())
      .then(() => deleteTaskRaw(rec.cid))
      .then(() => TFoutbox.outboxRemove(op.qid));
  }

  function send(transport, method, path, body) {
    return transport.request(method, path, body).then(
      (res) => res,
      () => { const e = new Error("network"); e.__network = true; throw e; }
    );
  }
  function ok(res) { return res && res.status >= 200 && res.status < 300; }
  function tagsOf(cid, tagsFor) { return tagsFor(cid); }

  function opCreate(op, transport, tagsFor, result) {
    return getTaskRaw(op.cid).then((rec) => {
      if (!rec) return TFoutbox.outboxRemove(op.qid);
      if (rec.conflict) return; // held until user resolves the conflict
      if (rec.server_id != null) return TFoutbox.outboxRemove(op.qid);
      const parentP = rec.parent_cid ? TFidmap.serverIdOf(rec.parent_cid) : Promise.resolve(null);
      return Promise.all([parentP, tagsOf(op.cid, tagsFor)]).then(([parentSid, tags]) =>
        send(transport, "POST", "/api/tasks", taskToCreatePayload(rec, tags, parentSid != null ? parentSid : null)).then((res) => {
          if (ok(res)) {
            const sid = res.data.id;
            return TFidmap.mapPut("task", sid, op.cid)
              .then(() => putTaskRaw(Object.assign({}, rec, { server_id: sid, dirty: 0, base_rev: res.data && res.data.updated_at != null ? res.data.updated_at : rec.base_rev })))
              .then(() => TFoutbox.outboxRemove(op.qid))
              .then(() => { result.pushed++; });
          }
          if (res.status === 403) { return lostAccess(rec, op); }
          result.failed++;
          return TFoutbox.outboxRemove(op.qid);
        })
      );
    });
  }

  function opUpdate(op, transport, tagsFor, result) {
    return Promise.all([getTaskRaw(op.cid), TFidmap.serverIdOf(op.cid)]).then(([rec, sid]) => {
      if (!rec || sid == null) return TFoutbox.outboxRemove(op.qid);
      if (rec.conflict) return; // held until user resolves the conflict
      return tagsOf(op.cid, tagsFor).then((tags) =>
        send(transport, "PUT", "/api/tasks/" + sid, taskToUpdatePayload(rec, tags)).then((res) => {
          if (ok(res)) { return putTaskRaw(Object.assign({}, rec, { dirty: 0, base_rev: res.data && res.data.updated_at != null ? res.data.updated_at : rec.base_rev })).then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; }); }
          if (res.status === 404) { return putTaskRaw(Object.assign({}, rec, { conflict: "remote_deleted" })); } // safety net: flag, keep op
          if (res.status === 403) { return lostAccess(rec, op); }
          result.failed++;
          return TFoutbox.outboxRemove(op.qid);
        })
      );
    });
  }

  function opDelete(op, transport, result) {
    return TFidmap.serverIdOf(op.cid).then((sid) => {
      if (sid == null) return TFoutbox.outboxRemove(op.qid);
      return send(transport, "DELETE", "/api/tasks/" + sid, undefined).then((res) => {
        if (ok(res) || res.status === 404) { result.pushed++; return TFoutbox.outboxRemove(op.qid); }
        result.failed++;
        return TFoutbox.outboxRemove(op.qid);
      });
    });
  }

  function opMark(op, transport, result) {
    const p = op.payload || {};
    return TFidmap.serverIdOf(p.task_cid).then((sid) => {
      if (sid == null) return TFoutbox.outboxRemove(op.qid);
      return send(transport, "POST", "/api/tasks/" + sid + "/occurrences/" + p.occurrence_date + "/mark", markPayload(p)).then((res) => {
        if (ok(res)) { result.pushed++; return TFoutbox.outboxRemove(op.qid); }
        result.failed++;
        return TFoutbox.outboxRemove(op.qid);
      });
    });
  }

  function opHabitCreate(op, transport, habitTagsFor, result) {
    return getHabitRaw(op.cid).then((rec) => {
      if (!rec) return TFoutbox.outboxRemove(op.qid);
      if (rec.server_id != null) return TFoutbox.outboxRemove(op.qid);
      return habitTagsFor(op.cid).then((tags) =>
        send(transport, "POST", "/api/habits", habitToCreatePayload(rec, tags)).then((res) => {
          if (ok(res)) {
            const sid = res.data.id;
            return TFidmap.mapPut("habit", sid, op.cid)
              .then(() => putHabitRaw(Object.assign({}, rec, { server_id: sid, dirty: 0 })))
              .then(() => TFoutbox.outboxRemove(op.qid))
              .then(() => { result.pushed++; });
          }
          result.failed++;
          return TFoutbox.outboxRemove(op.qid);
        })
      );
    });
  }

  function opHabitUpdate(op, transport, habitTagsFor, result) {
    return Promise.all([getHabitRaw(op.cid), TFidmap.serverIdOf(op.cid)]).then(([rec, sid]) => {
      if (!rec || sid == null) return TFoutbox.outboxRemove(op.qid);
      return habitTagsFor(op.cid).then((tags) =>
        send(transport, "POST", "/api/habits/" + sid + "/update", habitToUpdatePayload(rec, tags)).then((res) => {
          if (ok(res)) {
            return putHabitRaw(Object.assign({}, rec, { dirty: 0 }))
              .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; });
          }
          if (res.status === 404) {
            // habit deleted on server → local-wins: re-create, then remap idmap
            return send(transport, "POST", "/api/habits", habitToCreatePayload(rec, tags)).then((res2) => {
              if (ok(res2)) {
                const nid = res2.data.id;
                return TFidmap.mapDelete("habit", sid)
                  .then(() => TFidmap.mapPut("habit", nid, op.cid))
                  .then(() => putHabitRaw(Object.assign({}, rec, { server_id: nid, dirty: 0 })))
                  .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; });
              }
              result.failed++;
              return TFoutbox.outboxRemove(op.qid);
            });
          }
          result.failed++;
          return TFoutbox.outboxRemove(op.qid);
        })
      );
    });
  }

  function getLogRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("habit_logs", "readonly").objectStore("habit_logs").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function putLogRaw(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("habit_logs", "readwrite");
      tx.objectStore("habit_logs").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function opHabitCheckin(op, transport, result) {
    return getLogRaw(op.cid).then((log) => {
      if (!log) return TFoutbox.outboxRemove(op.qid);
      return TFidmap.serverIdOf(log.habit_cid).then((sid) => {
        if (sid == null) return TFoutbox.outboxRemove(op.qid);
        return send(transport, "POST", "/api/habits/" + sid + "/checkin", checkinPayload(log)).then((res) => {
          if (ok(res)) {
            return putLogRaw(Object.assign({}, log, { dirty: 0 }))
              .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; });
          }
          result.failed++;
          return TFoutbox.outboxRemove(op.qid);
        });
      });
    });
  }

  function getNoteRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("scratchpad_notes", "readonly").objectStore("scratchpad_notes").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function putNoteRaw(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("scratchpad_notes", "readwrite");
      tx.objectStore("scratchpad_notes").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function deleteNoteRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("scratchpad_notes", "readwrite");
      tx.objectStore("scratchpad_notes").delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function noteTagNames(cid) {
    return TFtag.getEntityTags("note", cid).then((ts) => ts.map((t) => t.name));
  }
  function linkedTaskServerIds(rec) {
    let cids; try { cids = JSON.parse(rec.linked_task_cids || "[]"); } catch (_) { cids = []; }
    return cids.reduce((p, c) => p.then((acc) => TFidmap.serverIdOf(c).then((sid) => { if (sid != null) acc.push(sid); return acc; })), Promise.resolve([]));
  }

  function opNoteCreate(op, transport, result) {
    return getNoteRaw(op.cid).then((rec) => {
      if (!rec) return TFoutbox.outboxRemove(op.qid);
      if (rec.server_id != null) return TFoutbox.outboxRemove(op.qid);
      return Promise.all([noteTagNames(op.cid), linkedTaskServerIds(rec)]).then(([tags, taskSids]) =>
        send(transport, "POST", "/api/scratchpad", noteToCreatePayload(rec, tags, taskSids)).then((res) => {
          if (ok(res)) {
            const sid = res.data.id;
            return TFidmap.mapPut("note", sid, op.cid)
              .then(() => putNoteRaw(Object.assign({}, rec, { server_id: sid, dirty: 0, base_rev: res.data && res.data.updated_at != null ? res.data.updated_at : rec.base_rev })))
              .then(() => TFoutbox.outboxRemove(op.qid))
              .then(() => { result.pushed++; });
          }
          result.failed++;
          return TFoutbox.outboxRemove(op.qid);
        })
      );
    });
  }

  function opNoteUpdate(op, transport, result) {
    return Promise.all([getNoteRaw(op.cid), TFidmap.serverIdOf(op.cid)]).then(([rec, sid]) => {
      if (!rec || sid == null) return TFoutbox.outboxRemove(op.qid);
      return Promise.all([noteTagNames(op.cid), linkedTaskServerIds(rec)]).then(([tags, taskSids]) =>
        send(transport, "PUT", "/api/scratchpad/" + sid, noteToUpdatePayload(rec, tags, taskSids)).then((res) => {
          if (ok(res)) {
            return putNoteRaw(Object.assign({}, rec, { dirty: 0, base_rev: res.data && res.data.updated_at != null ? res.data.updated_at : rec.base_rev }))
              .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; });
          }
          if (res.status === 404) {
            return send(transport, "POST", "/api/scratchpad", noteToCreatePayload(rec, tags, taskSids)).then((res2) => {
              if (ok(res2)) {
                const nid = res2.data.id;
                return TFidmap.mapDelete("note", sid)
                  .then(() => TFidmap.mapPut("note", nid, op.cid))
                  .then(() => putNoteRaw(Object.assign({}, rec, { server_id: nid, dirty: 0, base_rev: res2.data && res2.data.updated_at != null ? res2.data.updated_at : rec.base_rev })))
                  .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; });
              }
              result.failed++;
              return TFoutbox.outboxRemove(op.qid);
            });
          }
          result.failed++;
          return TFoutbox.outboxRemove(op.qid);
        })
      );
    });
  }

  function opHabitDelete(op, transport, result) {
    return TFidmap.serverIdOf(op.cid).then((sid) => {
      if (sid == null) {
        return deleteHabitRaw(op.cid).then(() => TFoutbox.outboxRemove(op.qid));
      }
      return send(transport, "DELETE", "/api/habits/" + sid, undefined).then((res) => {
        if (ok(res) || res.status === 404) {
          return TFidmap.mapDelete("habit", sid)
            .then(() => deleteHabitRaw(op.cid))
            .then(() => TFoutbox.outboxRemove(op.qid))
            .then(() => { result.pushed++; });
        }
        result.failed++;
        return TFoutbox.outboxRemove(op.qid);
      });
    });
  }

  function processOp(op, transport, tagsFor, habitTagsFor, result) {
    if (op.entity_type === "task" && op.op === "create") return opCreate(op, transport, tagsFor, result);
    if (op.entity_type === "task" && op.op === "update") return opUpdate(op, transport, tagsFor, result);
    if (op.entity_type === "task" && op.op === "delete") return opDelete(op, transport, result);
    if (op.entity_type === "recurring_exception" && op.op === "mark_occurrence") return opMark(op, transport, result);
    if (op.entity_type === "habit" && op.op === "create") return opHabitCreate(op, transport, habitTagsFor, result);
    if (op.entity_type === "habit" && op.op === "update") return opHabitUpdate(op, transport, habitTagsFor, result);
    if (op.entity_type === "habit" && op.op === "delete") return opHabitDelete(op, transport, result);
    if (op.entity_type === "habit_log" && op.op === "checkin") return opHabitCheckin(op, transport, result);
    if (op.entity_type === "note" && op.op === "create") return opNoteCreate(op, transport, result);
    if (op.entity_type === "note" && op.op === "update") return opNoteUpdate(op, transport, result);
    if (op.entity_type === "note") return Promise.resolve(); // held (Opsi B): note push handlers arrive in #2f-2 — do NOT drop
    return TFoutbox.outboxRemove(op.qid);
  }

  let _running = false;
  function pushOutbox(transport, opts) {
    if (_running) return Promise.resolve({ pushed: 0, failed: 0, remaining: -1, busy: true });
    _running = true;
    opts = opts || {};
    const tagsFor = opts.tagsFor || ((cid) => TFtag.getEntityTags("task", cid).then((ts) => ts.map((t) => t.name)));
    const habitTagsFor = opts.habitTagsFor || ((cid) => TFtag.getEntityTags("habit", cid).then((ts) => ts.map((t) => t.name)));
    const result = { pushed: 0, failed: 0, remaining: 0 };
    let stopped = false;
    return TFoutbox.outboxAll()
      .then((ops) => ops.slice().sort((a, b) => a.qid - b.qid))
      .then((ops) => ops.reduce((chain, op) => chain.then(() => {
        if (stopped) return;
        return processOp(op, transport, tagsFor, habitTagsFor, result).catch((err) => { stopped = true; if (!(err && err.__network)) result.failed++; });
      }), Promise.resolve()))
      .then(() => TFoutbox.outboxAll())
      .then((rem) => { result.remaining = rem.length; return result; })
      .then((r) => { _running = false; return r; }, (e) => { _running = false; throw e; });
  }

  const exported = { taskToCreatePayload, taskToUpdatePayload, markPayload, habitToCreatePayload, habitToUpdatePayload, checkinPayload, noteToCreatePayload, noteToUpdatePayload, pushOutbox };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.syncpush = exported; }
  return exported;
});
