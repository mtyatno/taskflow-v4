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
  const TFids = req("./ids.js", root.TF && root.TF.ids);
  const TFidmap = req("./idmap.js", root.TF && root.TF.idmap);
  const TFhydrate = req("./hydrate.js", root.TF && root.TF.hydrate);
  const TFoutbox = req("./outbox.js", root.TF && root.TF.outbox);
  const TFtag = req("./tagrepo.js", root.TF && root.TF.tagrepo);

  function getAllTasks() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("tasks", "readonly").objectStore("tasks").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  function putTask(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      tx.objectStore("tasks").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function deleteTask(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      tx.objectStore("tasks").delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function ensureCid(serverId, cache) {
    if (cache[serverId]) return Promise.resolve(cache[serverId]);
    return TFidmap.cidOf("task", serverId).then((cid) => {
      if (cid) { cache[serverId] = cid; return cid; }
      const fresh = TFids.newCid();
      cache[serverId] = fresh;
      return TFidmap.mapPut("task", serverId, fresh).then(() => fresh);
    });
  }

  // Normalize a timestamp to epoch ms; treat a tz-less string (server naive) as UTC.
  function tsEpoch(ts) {
    if (ts == null) return 0;
    const s = String(ts);
    const hasTz = /[zZ]|[+-]\d\d:?\d\d$/.test(s);
    const v = Date.parse(hasTz ? s : s + "Z");
    return isNaN(v) ? 0 : v;
  }
  function dropOutbox(entityType, cid) {
    return TFoutbox.outboxByEntity(entityType, cid).then((ops) =>
      ops.reduce((p, o) => p.then(() => TFoutbox.outboxRemove(o.qid)), Promise.resolve()));
  }

  function pullTasks(serverList) {
    const list = serverList || [];
    const cache = {}; // serverId -> cid
    return list.reduce((p, s) => p.then(() => ensureCid(s.id, cache)), Promise.resolve())
      .then(() => getAllTasks())
      .then((localAll) => {
        const localByCid = {};
        for (const r of localAll) localByCid[r.cid] = r;
        const getCid = (sid) => cache[sid] || null;
        const result = { created: 0, updated: 0, deleted: 0, skipped: 0, lwwResolved: 0, conflicts: 0 };
        let chain = Promise.resolve();
        for (const s of list) {
          const cid = cache[s.id];
          const localRec = localByCid[cid];
          chain = chain.then(() => {
            if (!localRec) { result.created++; return putTask(TFhydrate.taskFromServer(s, getCid)); }
            if (localRec.conflict) { result.skipped++; return; }
            if (localRec.dirty) {
              if (s.updated_at !== localRec.base_rev) {
                // edit-vs-edit conflict → last-write-wins
                result.lwwResolved++;
                if (tsEpoch(s.updated_at) > tsEpoch(localRec.updated_at)) {
                  return dropOutbox("task", cid).then(() => putTask(TFhydrate.taskFromServer(s, getCid))); // server wins
                }
                return; // local wins — keep dirty, push will send
              }
              result.skipped++; return; // local pending, server unchanged
            }
            if (s.updated_at !== localRec.base_rev) { result.updated++; return putTask(TFhydrate.taskFromServer(s, getCid)); }
            return; // unchanged
          });
        }
        const serverIds = new Set(list.map((s) => String(s.id)));
        for (const r of localAll) {
          if (r.server_id == null) continue;
          if (serverIds.has(String(r.server_id))) continue;
          chain = chain.then(() => {
            if (r.conflict) { result.skipped++; return; }
            if (r.dirty) { result.conflicts++; return putTask(Object.assign({}, r, { conflict: "remote_deleted" })); }
            result.deleted++;
            return deleteTask(r.cid);
          });
        }
        return chain.then(() => result);
      });
  }

  function pullAndReconcile(rawFetch) {
    return Promise.resolve(rawFetch("/api/tasks?include_done=true"))
      .then((res) => (res && typeof res.json === "function" ? res.json() : res))
      .then((list) => pullTasks(list || []));
  }

  const DEFAULT_FREQ = JSON.stringify(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

  function habitFromServer(h, cid) {
    return {
      cid: cid, server_id: h.id, title: h.title,
      phase: h.phase || "pagi",
      micro_target: h.micro_target != null ? h.micro_target : "",
      frequency: h.frequency != null ? h.frequency : DEFAULT_FREQ,
      identity_pillar: h.identity_pillar != null ? h.identity_pillar : "",
      created_at: h.created_at != null ? h.created_at : null,
      deleted: false, dirty: 0,
    };
  }
  // Compare two frequency JSON strings by value (server uses json.dumps → spaces;
  // local uses JSON.stringify → no spaces), so whitespace alone is not a change.
  function freqEq(a, b) {
    try { return JSON.stringify(JSON.parse(a || "[]")) === JSON.stringify(JSON.parse(b || "[]")); }
    catch (_) { return a === b; }
  }
  function habitChanged(local, h) {
    return local.title !== h.title
      || (local.phase || "pagi") !== (h.phase || "pagi")
      || (local.micro_target || "") !== (h.micro_target || "")
      || !freqEq(local.frequency, h.frequency != null ? h.frequency : DEFAULT_FREQ)
      || (local.identity_pillar || "") !== (h.identity_pillar || "");
  }
  function getAllHabits() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("habits", "readonly").objectStore("habits").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  function putHabit(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("habits", "readwrite");
      tx.objectStore("habits").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function deleteHabitRec(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("habits", "readwrite");
      tx.objectStore("habits").delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function ensureHabitCid(serverId, cache) {
    if (cache[serverId]) return Promise.resolve(cache[serverId]);
    return TFidmap.cidOf("habit", serverId).then((cid) => {
      if (cid) { cache[serverId] = cid; return cid; }
      const fresh = TFids.newCid();
      cache[serverId] = fresh;
      return TFidmap.mapPut("habit", serverId, fresh).then(() => fresh);
    });
  }

  function pullHabits(serverHabits) {
    const list = serverHabits || [];
    const cache = {};
    return list.reduce((p, h) => p.then(() => ensureHabitCid(h.id, cache)), Promise.resolve())
      .then(() => getAllHabits())
      .then((localAll) => {
        const localByCid = {};
        for (const r of localAll) localByCid[r.cid] = r;
        const result = { created: 0, updated: 0, deleted: 0, skipped: 0 };
        let chain = Promise.resolve();
        for (const h of list) {
          const cid = cache[h.id];
          const localRec = localByCid[cid];
          chain = chain.then(() => {
            if (!localRec) { result.created++; return putHabit(habitFromServer(h, cid)); }
            if (localRec.dirty) { result.skipped++; return; }
            if (habitChanged(localRec, h)) { result.updated++; return putHabit(habitFromServer(h, cid)); }
            return;
          });
        }
        const serverIds = new Set(list.map((h) => String(h.id)));
        for (const r of localAll) {
          if (r.server_id == null) continue;
          if (serverIds.has(String(r.server_id))) continue;
          chain = chain.then(() => {
            if (r.dirty) { result.skipped++; return; }
            result.deleted++;
            return deleteHabitRec(r.cid).then(() => TFidmap.mapDelete("habit", r.server_id));
          });
        }
        return chain.then(() => result);
      });
  }

  function getLogByHabitDate(habitCid, date) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("habit_logs", "readonly").objectStore("habit_logs").index("habit_date").get([habitCid, date]);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function putLog(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("habit_logs", "readwrite");
      tx.objectStore("habit_logs").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function pullHabitLogs(serverLogs) {
    const list = serverLogs || [];
    const cache = {};
    const result = { created: 0, updated: 0, skipped: 0 };
    return list.reduce((p, l) => p.then(() =>
      ensureHabitCid(l.habit_id, cache).then((hcid) =>
        getLogByHabitDate(hcid, l.date).then((local) => {
          const skip = l.skip_reason != null ? l.skip_reason : "";
          if (!local) {
            result.created++;
            return putLog({ cid: TFids.newCid(), habit_cid: hcid, date: l.date, status: l.status, skip_reason: skip, dirty: 0 });
          }
          if (local.dirty) { result.skipped++; return; }
          if (local.status !== l.status || (local.skip_reason || "") !== skip) {
            result.updated++;
            return putLog(Object.assign({}, local, { status: l.status, skip_reason: skip, dirty: 0 }));
          }
          return;
        })
      )
    ), Promise.resolve()).then(() => result);
  }
  function pullHabitsAndLogs(rawFetch) {
    return Promise.all([
      Promise.resolve(rawFetch("/api/habits")).then((r) => (r && typeof r.json === "function" ? r.json() : r)),
      Promise.resolve(rawFetch("/api/habits/logs")).then((r) => (r && typeof r.json === "function" ? r.json() : r)),
    ]).then(([habits, logs]) =>
      pullHabits(habits || []).then((hb) =>
        pullHabitLogs(logs || []).then((lg) => ({ habits: hb, logs: lg }))));
  }

  function getAllNotes() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("scratchpad_notes", "readonly").objectStore("scratchpad_notes").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  function putNote(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("scratchpad_notes", "readwrite");
      tx.objectStore("scratchpad_notes").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function deleteNoteRec(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("scratchpad_notes", "readwrite");
      tx.objectStore("scratchpad_notes").delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function ensureNoteCid(serverId, cache) {
    if (cache[serverId]) return Promise.resolve(cache[serverId]);
    return TFidmap.cidOf("note", serverId).then((cid) => {
      if (cid) { cache[serverId] = cid; return cid; }
      const fresh = TFids.newCid();
      cache[serverId] = fresh;
      return TFidmap.mapPut("note", serverId, fresh).then(() => fresh);
    });
  }
  function noteFromServer(s, cid, noteCidCache) {
    const toCids = (s.linked_to || []).map((sid) => noteCidCache[sid]).filter(Boolean);
    const taskIds = s.linked_task_ids || [];
    return taskIds.reduce((p, tid) => p.then((acc) => TFidmap.cidOf("task", tid).then((c) => { if (c) acc.push(c); return acc; })), Promise.resolve([]))
      .then((taskCids) => ({
        cid: cid, server_id: s.id, title: s.title != null ? s.title : "", content: s.content != null ? s.content : "",
        linked_to_cids: JSON.stringify(toCids), linked_task_cids: JSON.stringify(taskCids),
        pinned: !!s.pinned,
        list_id: s.list_id != null ? s.list_id : null,
        user_id: s.user_id != null ? s.user_id : null,
        last_edited_by: s.last_edited_by != null ? s.last_edited_by : null,
        last_editor_username: s.last_editor_username != null ? s.last_editor_username : null,
        last_editor_display_name: s.last_editor_display_name != null ? s.last_editor_display_name : null,
        created_at: s.created_at != null ? s.created_at : null, updated_at: s.updated_at != null ? s.updated_at : null,
        deleted: false, dirty: 0, base_rev: s.updated_at != null ? s.updated_at : null,
      }));
  }
  function writeNote(s, cid, cache, extra) {
    return noteFromServer(s, cid, cache).then((rec) => putNote(Object.assign(rec, extra || {}))).then(() => TFtag.setEntityTags("note", cid, s.tags || []));
  }

  function pullNotes(serverNotes) {
    const list = (serverNotes || []);
    const cache = {};
    return list.reduce((p, s) => p.then(() => ensureNoteCid(s.id, cache)), Promise.resolve())
      .then(() => getAllNotes())
      .then((localAll) => {
        const byCid = {}; for (const r of localAll) byCid[r.cid] = r;
        const result = { created: 0, updated: 0, deleted: 0, skipped: 0, lwwResolved: 0, pinned: 0 };
        let chain = Promise.resolve();
        for (const s of list) {
          const cid = cache[s.id];
          const local = byCid[cid];
          chain = chain.then(() => {
            if (!local) { result.created++; return writeNote(s, cid, cache); }
            if (local.conflict) { result.skipped++; return; }
            if (local.dirty) {
              if (s.updated_at !== local.base_rev) {
                result.lwwResolved++;
                if (tsEpoch(s.updated_at) > tsEpoch(local.updated_at)) {
                  return dropOutbox("note", cid).then(() => writeNote(s, cid, cache, {
                    notice: { kind: "overwritten", title: s.title, editor: s.last_editor_display_name || s.last_editor_username || "Pengguna lain" },
                  })); // server wins (LWW) — leave a notice
                }
                return; // local wins
              }
              result.skipped++; return;
            }
            if (s.updated_at !== local.base_rev) { result.updated++; return writeNote(s, cid, cache, local.notice ? { notice: local.notice } : undefined); }
            return;
          });
        }
        const serverIds = new Set(list.map((s) => String(s.id)));
        for (const r of localAll) {
          if (r.server_id == null) continue;
          if (serverIds.has(String(r.server_id))) continue;
          chain = chain.then(() => {
            if (r.dirty) {
              if (r.list_id != null) { result.skipped++; return putNote(Object.assign({}, r, { conflict: "remote_deleted" })); }
              result.skipped++; return; // personal local-wins; push update→404→re-create
            }
            result.deleted++;
            return deleteNoteRec(r.cid).then(() => TFidmap.mapDelete("note", r.server_id));
          });
        }
        // pass 4: adopt server pinned for notes with no pending pin op (pin is orthogonal to updated_at).
        chain = chain.then(() => TFoutbox.outboxAll().then((ops) => {
          const pendingPin = new Set(ops.filter((o) => o.entity_type === "note" && o.op === "pin").map((o) => o.cid));
          return getAllNotes().then((fresh) => {
            const freshByCid = {}; for (const r of fresh) freshByCid[r.cid] = r;
            let c2 = Promise.resolve();
            for (const s of list) {
              const cid = cache[s.id];
              const local = freshByCid[cid];
              if (!local || pendingPin.has(cid)) continue;
              if (!!local.pinned !== !!s.pinned) {
                c2 = c2.then(() => { result.pinned++; return putNote(Object.assign({}, local, { pinned: !!s.pinned })); });
              }
            }
            return c2;
          });
        }));
        return chain.then(() => result);
      });
  }

  function pullNotesAndReconcile(rawFetch) {
    return Promise.resolve(rawFetch("/api/scratchpad"))
      .then((res) => (res && typeof res.json === "function" ? res.json() : res))
      .then((list) => pullNotes(list || []));
  }

  function getAllMindmaps() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("mindmaps", "readonly").objectStore("mindmaps").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  function putMindmap(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("mindmaps", "readwrite");
      tx.objectStore("mindmaps").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function deleteMindmapRec(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("mindmaps", "readwrite");
      tx.objectStore("mindmaps").delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function ensureMindmapCid(serverId, cache) {
    if (cache[serverId]) return Promise.resolve(cache[serverId]);
    return TFidmap.cidOf("mindmap", serverId).then((cid) => {
      if (cid) { cache[serverId] = cid; return cid; }
      const fresh = TFids.newCid();
      cache[serverId] = fresh;
      return TFidmap.mapPut("mindmap", serverId, fresh).then(() => fresh);
    });
  }
  const MM_DEFAULT_DATA = '{"nodeData":{"id":"root","topic":"Untitled","root":true,"children":[]}}';
  function mindmapFromServer(s, cid) {
    return {
      cid: cid, server_id: s.id,
      title: s.title != null ? s.title : "Untitled",
      data_json: s.data_json != null ? s.data_json : MM_DEFAULT_DATA,
      pinned: !!s.is_pinned,
      list_id: s.list_id != null ? s.list_id : null,
      user_id: s.user_id != null ? s.user_id : null,
      last_edited_by: s.last_edited_by != null ? s.last_edited_by : null,
      last_editor_username: s.last_editor_username != null ? s.last_editor_username : null,
      last_editor_display_name: s.last_editor_display_name != null ? s.last_editor_display_name : null,
      created_at: s.created_at != null ? s.created_at : null,
      updated_at: s.updated_at != null ? s.updated_at : null,
      deleted: false, dirty: 0, base_rev: s.updated_at != null ? s.updated_at : null,
    };
  }
  function writeMindmapFull(serverId, cid, fetchOne, extra) {
    return Promise.resolve(fetchOne(serverId)).then((fullRow) => (fullRow ? putMindmap(Object.assign(mindmapFromServer(fullRow, cid), extra || {})) : null));
  }

  // serverList = GET /api/mindmaps (metadata, no data_json). fetchOne(serverId) = GET /api/mindmaps/:id (full).
  function pullMindmaps(serverList, fetchOne) {
    const list = (serverList || []);
    const cache = {};
    return list.reduce((p, s) => p.then(() => ensureMindmapCid(s.id, cache)), Promise.resolve())
      .then(() => getAllMindmaps())
      .then((localAll) => {
        const byCid = {}; for (const r of localAll) byCid[r.cid] = r;
        const result = { created: 0, updated: 0, deleted: 0, skipped: 0, lwwResolved: 0, pinned: 0 };
        let chain = Promise.resolve();
        for (const s of list) {
          const cid = cache[s.id];
          const local = byCid[cid];
          chain = chain.then(() => {
            if (!local) { result.created++; return writeMindmapFull(s.id, cid, fetchOne); }
            if (local.conflict) { result.skipped++; return; }
            if (local.dirty) {
              if (s.updated_at !== local.base_rev) {
                result.lwwResolved++;
                if (tsEpoch(s.updated_at) > tsEpoch(local.updated_at)) {
                  return dropOutbox("mindmap", cid).then(() => writeMindmapFull(s.id, cid, fetchOne, {
                    notice: { kind: "overwritten", title: s.title, editor: s.last_editor_display_name || s.last_editor_username || "Pengguna lain" },
                  })); // server wins (LWW) — leave a notice
                }
                return; // local wins
              }
              result.skipped++; return;
            }
            if (s.updated_at !== local.base_rev) { result.updated++; return writeMindmapFull(s.id, cid, fetchOne, local.notice ? { notice: local.notice } : undefined); }
            return;
          });
        }
        const serverIds = new Set(list.map((s) => String(s.id)));
        for (const r of localAll) {
          if (r.server_id == null) continue;
          if (serverIds.has(String(r.server_id))) continue;
          chain = chain.then(() => {
            if (r.dirty) {
              if (r.list_id != null) { result.skipped++; return putMindmap(Object.assign({}, r, { conflict: "remote_deleted" })); }
              result.skipped++; return; // personal local-wins; push update→404→re-create
            }
            result.deleted++;
            return deleteMindmapRec(r.cid).then(() => TFidmap.mapDelete("mindmap", r.server_id));
          });
        }
        // pin-adopt: list metadata carries is_pinned; respect a pending pin op.
        chain = chain.then(() => TFoutbox.outboxAll().then((ops) => {
          const pendingPin = new Set(ops.filter((o) => o.entity_type === "mindmap" && o.op === "pin").map((o) => o.cid));
          return getAllMindmaps().then((fresh) => {
            const freshByCid = {}; for (const r of fresh) freshByCid[r.cid] = r;
            let c2 = Promise.resolve();
            for (const s of list) {
              const cid = cache[s.id];
              const local = freshByCid[cid];
              if (!local || pendingPin.has(cid)) continue;
              if (!!local.pinned !== !!s.is_pinned) {
                c2 = c2.then(() => { result.pinned++; return putMindmap(Object.assign({}, local, { pinned: !!s.is_pinned })); });
              }
            }
            return c2;
          });
        }));
        return chain.then(() => result);
      });
  }

  function pullMindmapsAndReconcile(rawFetch) {
    const fetchOne = (sid) => Promise.resolve(rawFetch("/api/mindmaps/" + sid))
      .then((res) => (res && typeof res.json === "function" ? res.json() : res))
      .catch(() => null);
    return Promise.resolve(rawFetch("/api/mindmaps"))
      .then((res) => (res && typeof res.json === "function" ? res.json() : res))
      .then((listRows) => pullMindmaps(listRows || [], fetchOne));
  }

  const exported = { pullTasks, pullAndReconcile, pullHabits, pullHabitLogs, pullHabitsAndLogs, pullNotes, pullNotesAndReconcile, pullMindmaps, pullMindmapsAndReconcile };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.syncpull = exported; }
  return exported;
});
