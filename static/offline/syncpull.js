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
  const TFblob = req("./blobstore.js", root.TF && root.TF.blobstore);
  const BlobStore = TFblob ? TFblob.makeBlobStore() : null;

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
      .then(() => Promise.all([getAllTasks(), TFoutbox.outboxAll()]))
      .then(([localAll, outboxOps]) => {
        const pendingTaskOps = new Set(outboxOps.filter((o) => o.entity_type === "task").map((o) => o.cid));
        const localByCid = {};
        for (const r of localAll) localByCid[r.cid] = r;
        const getCid = (sid) => cache[sid] || null;
        const result = { created: 0, updated: 0, deleted: 0, skipped: 0, lwwResolved: 0, conflicts: 0 };
        let chain = Promise.resolve();
        for (const s of list) {
          const cid = cache[s.id];
          const localRec = localByCid[cid];
          chain = chain.then(() => {
            if (!localRec || (localRec.deleted && !pendingTaskOps.has(cid))) { result.created++; return putTask(TFhydrate.taskFromServer(s, getCid)); }
            if (localRec.conflict) { result.skipped++; return; }
            if (localRec.dirty && pendingTaskOps.has(cid)) {
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
            if (s.updated_at !== localRec.base_rev || localRec.deleted || (localRec.dirty && !pendingTaskOps.has(cid))) { result.updated++; return putTask(TFhydrate.taskFromServer(s, getCid)); }
            return; // unchanged
          });
        }
        const serverIds = new Set(list.map((s) => String(s.id)));
        for (const r of localAll) {
          if (r.server_id == null) continue;
          if (serverIds.has(String(r.server_id))) continue;
          chain = chain.then(() => {
            if (r.conflict) { result.skipped++; return; }
            if (r.dirty && pendingTaskOps.has(r.cid)) { result.conflicts++; return putTask(Object.assign({}, r, { conflict: "remote_deleted" })); }
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
      return getAllNotes().then((allNotes) => {
        const existing = allNotes.find((n) => n.server_id === serverId);
        if (existing && existing.cid) {
          cache[serverId] = existing.cid;
          return TFidmap.mapPut("note", serverId, existing.cid).then(() => existing.cid);
        }
        const fresh = TFids.newCid();
        cache[serverId] = fresh;
        return TFidmap.mapPut("note", serverId, fresh).then(() => fresh);
      });
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
        meta_json: s.meta_json != null ? s.meta_json : '{}',
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
      .then(() => Promise.all([getAllNotes(), TFoutbox.outboxAll()]))
      .then(([localAll, outboxOps]) => {
        const pendingNoteOps = new Set(outboxOps.filter((o) => o.entity_type === "note").map((o) => o.cid));
        const byCid = {}; for (const r of localAll) byCid[r.cid] = r;
        const result = { created: 0, updated: 0, deleted: 0, skipped: 0, lwwResolved: 0, pinned: 0 };
        let chain = Promise.resolve();
        for (const s of list) {
          const cid = cache[s.id];
          const local = byCid[cid];
          chain = chain.then(() => {
            if (!local || (local.deleted && !pendingNoteOps.has(cid))) { result.created++; return writeNote(s, cid, cache); }
            if (local.conflict) { result.skipped++; return; }
            if (local.dirty && pendingNoteOps.has(cid)) {
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
            if (s.updated_at !== local.base_rev || local.deleted || (local.dirty && !pendingNoteOps.has(cid))) {
              result.updated++; return writeNote(s, cid, cache, local.notice ? { notice: local.notice } : undefined);
            }
            return;
          });
        }
        const serverIds = new Set(list.map((s) => String(s.id)));
        for (const r of localAll) {
          if (r.server_id == null) continue;
          const expectedCid = cache[r.server_id];
          if (expectedCid && r.cid !== expectedCid) {
            chain = chain.then(() => deleteNoteRec(r.cid));
            continue;
          }
          if (serverIds.has(String(r.server_id))) continue;
          chain = chain.then(() => {
            if (r.dirty && pendingNoteOps.has(r.cid)) {
              if (r.list_id != null) { result.skipped++; return putNote(Object.assign({}, r, { conflict: "remote_deleted" })); }
              result.skipped++; return; // personal local-wins; push update→404→re-create
            }
            result.deleted++;
            return deleteNoteRec(r.cid).then(() => TFidmap.mapDelete("note", r.server_id));
          });
        }
        // pass 4: adopt server pinned for notes with no pending pin op (pin is orthogonal to updated_at).
        chain = chain.then(() => {
          const pendingPin = new Set(outboxOps.filter((o) => o.entity_type === "note" && o.op === "pin").map((o) => o.cid));
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
        });
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
      .then(() => Promise.all([getAllMindmaps(), TFoutbox.outboxAll()]))
      .then(([localAll, outboxOps]) => {
        const pendingMindmapOps = new Set(outboxOps.filter((o) => o.entity_type === "mindmap").map((o) => o.cid));
        const byCid = {}; for (const r of localAll) byCid[r.cid] = r;
        const result = { created: 0, updated: 0, deleted: 0, skipped: 0, lwwResolved: 0, pinned: 0 };
        let chain = Promise.resolve();
        for (const s of list) {
          const cid = cache[s.id];
          const local = byCid[cid];
          chain = chain.then(() => {
            if (!local || (local.deleted && !pendingMindmapOps.has(cid))) { result.created++; return writeMindmapFull(s.id, cid, fetchOne); }
            if (local.conflict) { result.skipped++; return; }
            if (local.dirty && pendingMindmapOps.has(cid)) {
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
            if (s.updated_at !== local.base_rev || local.deleted || (local.dirty && !pendingMindmapOps.has(cid))) {
              result.updated++; return writeMindmapFull(s.id, cid, fetchOne, local.notice ? { notice: local.notice } : undefined);
            }
            return;
          });
        }
        const serverIds = new Set(list.map((s) => String(s.id)));
        for (const r of localAll) {
          if (r.server_id == null) continue;
          if (serverIds.has(String(r.server_id))) continue;
          chain = chain.then(() => {
            if (r.dirty && pendingMindmapOps.has(r.cid)) {
              if (r.list_id != null) { result.skipped++; return putMindmap(Object.assign({}, r, { conflict: "remote_deleted" })); }
              result.skipped++; return; // personal local-wins; push update→404→re-create
            }
            result.deleted++;
            return deleteMindmapRec(r.cid).then(() => TFidmap.mapDelete("mindmap", r.server_id));
          });
        }
        // pin-adopt: list metadata carries is_pinned; respect a pending pin op.
        chain = chain.then(() => {
          const pendingPin = new Set(outboxOps.filter((o) => o.entity_type === "mindmap" && o.op === "pin").map((o) => o.cid));
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
        });
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

  function getAllDrawings() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("drawings", "readonly").objectStore("drawings").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  function putDrawingRec(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("drawings", "readwrite");
      tx.objectStore("drawings").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function deleteDrawingRec(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("drawings", "readwrite");
      tx.objectStore("drawings").delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function ensureDrawingCid(serverId, cache, serverObj) {
    if (cache[serverId]) return Promise.resolve(cache[serverId]);
    return TFidmap.cidOf("drawing", serverId).then((cid) => {
      if (cid) { cache[serverId] = cid; return cid; }
      return getAllDrawings().then((allDrawings) => {
        const existing = allDrawings.find((d) =>
          d.note_cid === undefined && (
            (d.server_id != null && String(d.server_id) === String(serverId)) ||
            (serverObj && serverObj.client_id && d.cid === serverObj.client_id)
          )
        );
        if (existing && existing.cid) {
          cache[serverId] = existing.cid;
          return TFidmap.mapPut("drawing", serverId, existing.cid).then(() => existing.cid);
        }
        const fresh = (serverObj && serverObj.client_id) ? serverObj.client_id : TFids.newCid();
        cache[serverId] = fresh;
        return TFidmap.mapPut("drawing", serverId, fresh).then(() => fresh);
      });
    });
  }

  function drawingFromServer(s, cid) {
    return {
      cid: cid,
      server_id: s.id,
      title: s.title != null ? s.title : "Untitled Drawing",
      svg_preview: s.svg_preview != null ? s.svg_preview : "",
      is_pinned: s.is_pinned ? 1 : 0,
      created_at: s.created_at != null ? s.created_at : null,
      updated_at: s.updated_at != null ? s.updated_at : null,
      deleted: false,
      dirty: 0,
      base_rev: s.updated_at != null ? s.updated_at : null,
    };
  }

  function writeDrawing(s, cid, localRec) {
    const dataJson = s.data_json;
    let blobP;
    if (dataJson != null) {
      blobP = BlobStore ? BlobStore.put(dataJson, { mime: "application/json" }) : Promise.resolve(null);
    } else if (localRec && localRec.blob_ref) {
      blobP = Promise.resolve(localRec.blob_ref);
    } else {
      blobP = BlobStore ? BlobStore.put("{}", { mime: "application/json" }) : Promise.resolve(null);
    }
    return blobP.then((ref) => {
      const rec = Object.assign(drawingFromServer(s, cid), { blob_ref: ref });
      return putDrawingRec(rec).then(() => {
        if (s.tags && TFtag && TFtag.setEntityTags) {
          return TFtag.setEntityTags("drawing", cid, s.tags);
        }
      });
    });
  }

  function writeDrawingFull(s, cid, fetchOne, localRec) {
    if (!fetchOne) {
      return writeDrawing(s, cid, localRec);
    }
    return Promise.resolve(fetchOne(s.id)).then((full) => {
      const merged = Object.assign({}, s, full || {});
      return writeDrawing(merged, cid, localRec);
    });
  }

  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  function deepMerge(localVal, remoteVal, opts) {
    const preferRemote = !!(opts && opts.preferRemote);

    if (localVal === undefined) return remoteVal;
    if (remoteVal === undefined) return localVal;
    if (localVal === remoteVal) return localVal;

    if (isPlainObject(localVal) && isPlainObject(remoteVal)) {
      const merged = {};
      const keys = new Set([...Object.keys(localVal), ...Object.keys(remoteVal)]);
      for (const k of keys) {
        if (k in localVal && !(k in remoteVal)) {
          merged[k] = localVal[k];
        } else if (k in remoteVal && !(k in localVal)) {
          merged[k] = remoteVal[k];
        } else {
          merged[k] = deepMerge(localVal[k], remoteVal[k], opts);
        }
      }
      return merged;
    }

    // Primitive or array collision
    return preferRemote ? remoteVal : localVal;
  }

  function parseSnapshot(snap) {
    if (snap == null) return {};
    if (typeof snap === "object") return snap;
    if (typeof snap === "string") {
      const trimmed = snap.trim();
      if (!trimmed) return {};
      try {
        const parsed = JSON.parse(trimmed);
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch (_) {
        return {};
      }
    }
    return {};
  }

  function extractOtherFields(obj, excludeKeys) {
    const ex = new Set(excludeKeys);
    const other = {};
    for (const k of Object.keys(obj)) {
      if (!ex.has(k)) {
        other[k] = obj[k];
      }
    }
    return other;
  }

  function extractSnapshotData(snapObj) {
    if (!snapObj || typeof snapObj !== "object" || Array.isArray(snapObj)) {
      return { format: null, records: {}, schema: null, otherFields: {} };
    }

    const schema = snapObj.schema || null;

    if (snapObj.store && typeof snapObj.store === "object" && !Array.isArray(snapObj.store)) {
      return {
        format: "store",
        records: Object.assign({}, snapObj.store),
        schema,
        otherFields: extractOtherFields(snapObj, ["store", "schema"]),
      };
    }

    if (Array.isArray(snapObj.records)) {
      const records = {};
      for (let i = 0; i < snapObj.records.length; i++) {
        const item = snapObj.records[i];
        if (item && typeof item === "object") {
          const id = item.id || (item.typeName ? `${item.typeName}:${i}` : `rec_${i}`);
          records[id] = item;
        }
      }
      return {
        format: "records",
        records,
        schema,
        otherFields: extractOtherFields(snapObj, ["records", "schema"]),
      };
    }

    if (snapObj.shapes && typeof snapObj.shapes === "object" && !Array.isArray(snapObj.shapes)) {
      return {
        format: "shapes",
        records: Object.assign({}, snapObj.shapes),
        schema,
        otherFields: extractOtherFields(snapObj, ["shapes", "schema"]),
      };
    }

    // Direct map / dictionary
    const records = {};
    const keys = Object.keys(snapObj);
    for (const k of keys) {
      if (k !== "schema") {
        records[k] = snapObj[k];
      }
    }
    return {
      format: keys.length > 0 ? "direct" : null,
      records,
      schema,
      otherFields: {},
    };
  }

  function mergeDrawingSnapshots(localSnap, remoteSnap, opts) {
    const localObj = parseSnapshot(localSnap);
    const remoteObj = parseSnapshot(remoteSnap);

    const localData = extractSnapshotData(localObj);
    const remoteData = extractSnapshotData(remoteObj);

    const format = remoteData.format || localData.format || "direct";
    const schema = remoteData.schema || localData.schema || undefined;
    const otherFields = Object.assign({}, localData.otherFields, remoteData.otherFields);

    const mergedRecords = deepMerge(localData.records, remoteData.records, opts);

    let outputObj;
    if (format === "store") {
      outputObj = Object.assign({}, otherFields);
      if (schema) outputObj.schema = schema;
      outputObj.store = mergedRecords;
    } else if (format === "records") {
      outputObj = Object.assign({}, otherFields);
      if (schema) outputObj.schema = schema;
      outputObj.records = Object.values(mergedRecords);
    } else if (format === "shapes") {
      outputObj = Object.assign({}, otherFields);
      if (schema) outputObj.schema = schema;
      outputObj.shapes = mergedRecords;
    } else {
      outputObj = Object.assign({}, otherFields);
      if (schema) outputObj.schema = schema;
      Object.assign(outputObj, mergedRecords);
    }

    return JSON.stringify(outputObj);
  }

  function updateDrawingOutboxMerged(cid, mergedJson, title, svgPreview) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("_outbox", "readwrite");
      const os = tx.objectStore("_outbox");
      const r = os.getAll();
      r.onsuccess = () => {
        const ops = r.result || [];
        for (const op of ops) {
          if (op.entity_type === "drawing" && op.cid === cid) {
            if (op.payload) {
              op.payload.data_json = mergedJson;
              if (title) op.payload.title = title;
              if (svgPreview != null) op.payload.svg_preview = svgPreview;
              os.put(op);
            }
          }
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function pullDrawings(serverDrawings, fetchOne) {
    const list = serverDrawings || [];
    const cache = {};
    return list.reduce((p, s) => p.then(() => ensureDrawingCid(s.id, cache, s)), Promise.resolve())
      .then(() => Promise.all([getAllDrawings(), TFoutbox.outboxAll()]))
      .then(([localAll, outboxOps]) => {
        const pendingDrawingOps = new Set(
          outboxOps.filter((o) => o.entity_type === "drawing").map((o) => o.cid)
        );
        const byCid = {};
        for (const r of localAll) {
          if (r.note_cid === undefined) byCid[r.cid] = r;
        }
        const result = { created: 0, updated: 0, deleted: 0, skipped: 0, lwwResolved: 0, pinned: 0, merged: 0 };
        let chain = Promise.resolve();

        // Pass 2: Upsert server records
        for (const s of list) {
          const cid = cache[s.id];
          const local = byCid[cid];
          chain = chain.then(() => {
            if (!local || (local.deleted && !pendingDrawingOps.has(cid))) {
              result.created++;
              return writeDrawingFull(s, cid, fetchOne, local);
            }
            if (local.conflict) {
              result.skipped++;
              return;
            }
            if (local.dirty && pendingDrawingOps.has(cid)) {
              if (s.updated_at !== local.base_rev) {
                const fetchP = fetchOne ? Promise.resolve(fetchOne(s.id)) : Promise.resolve(null);
                const localDataJsonP = (local.blob_ref && BlobStore)
                  ? BlobStore.getBytes(local.blob_ref).then((b) => b || "{}").catch(() => "{}")
                  : Promise.resolve("{}");

                return Promise.all([fetchP, localDataJsonP]).then(([remoteFullRow, localDataJson]) => {
                  const remoteFull = remoteFullRow || s;
                  const remoteDataJson = remoteFull.data_json || s.data_json || "{}";
                  const preferRemote = tsEpoch(s.updated_at) > tsEpoch(local.updated_at);
                  const mergedJson = mergeDrawingSnapshots(localDataJson, remoteDataJson, { preferRemote });

                  const blobP = BlobStore ? BlobStore.put(mergedJson, { mime: "application/json" }) : Promise.resolve(null);
                  return blobP.then((newBlobRef) => {
                    const mergedTitle = (remoteFull && remoteFull.title) || s.title || local.title || "Untitled Drawing";
                    const mergedSvg = (remoteFull && remoteFull.svg_preview) || s.svg_preview || local.svg_preview || "";
                    const updatedLocal = Object.assign({}, local, {
                      blob_ref: newBlobRef,
                      title: mergedTitle,
                      svg_preview: mergedSvg,
                      base_rev: s.updated_at,
                      dirty: 1,
                    });

                    return putDrawingRec(updatedLocal).then(() => {
                      return updateDrawingOutboxMerged(cid, mergedJson, mergedTitle, mergedSvg).then(() => {
                        result.merged = (result.merged || 0) + 1;
                      });
                    });
                  });
                });
              }
              result.skipped++;
              return;
            }
            if (s.updated_at !== local.base_rev || local.deleted || (local.dirty && !pendingDrawingOps.has(cid))) {
              result.updated++;
              return writeDrawingFull(s, cid, fetchOne, local);
            }
            return;
          });
        }

        // Pass 3 & 4: Clean phantom duplicate rows and remote deletions
        const serverIds = new Set(list.map((s) => String(s.id)));
        for (const r of localAll) {
          if (r.note_cid !== undefined) continue;
          if (r.server_id == null) continue;
          const expectedCid = cache[r.server_id];
          if (expectedCid && r.cid !== expectedCid) {
            chain = chain.then(() => deleteDrawingRec(r.cid));
            continue;
          }
          if (serverIds.has(String(r.server_id))) continue;
          chain = chain.then(() => {
            if (r.dirty && pendingDrawingOps.has(r.cid)) {
              result.skipped++;
              return;
            }
            result.deleted++;
            return deleteDrawingRec(r.cid).then(() => TFidmap.mapDelete("drawing", r.server_id));
          });
        }

        // Pass 5: Adopt server pinned status if no pending pin op
        chain = chain.then(() => {
          const pendingPin = new Set(
            outboxOps.filter((o) => o.entity_type === "drawing" && o.op === "pin").map((o) => o.cid)
          );
          return getAllDrawings().then((fresh) => {
            const freshByCid = {};
            for (const r of fresh) {
              if (r.note_cid === undefined) freshByCid[r.cid] = r;
            }
            let c2 = Promise.resolve();
            for (const s of list) {
              const cid = cache[s.id];
              const local = freshByCid[cid];
              if (!local || pendingPin.has(cid)) continue;
              const serverPinned = s.is_pinned ? 1 : 0;
              const localPinned = local.is_pinned ? 1 : 0;
              if (localPinned !== serverPinned) {
                c2 = c2.then(() => {
                  result.pinned++;
                  return putDrawingRec(Object.assign({}, local, { is_pinned: serverPinned }));
                });
              }
            }
            return c2;
          });
        });

        return chain.then(() => result);
      });
  }

  function pullDrawingsAndReconcile(rawFetch) {
    const fetchOne = (sid) => Promise.resolve(rawFetch("/api/drawings/" + sid))
      .then((res) => (res && typeof res.json === "function" ? res.json() : res))
      .catch(() => null);
    return Promise.resolve(rawFetch("/api/drawings"))
      .then((res) => (res && typeof res.json === "function" ? res.json() : res))
      .then((list) => pullDrawings(list || [], fetchOne));
  }

  const exported = {
    pullTasks, pullAndReconcile,
    pullHabits, pullHabitLogs, pullHabitsAndLogs,
    pullNotes, pullNotesAndReconcile,
    pullMindmaps, pullMindmapsAndReconcile,
    pullDrawings, pullDrawingsAndReconcile,
    mergeDrawingSnapshots,
  };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.syncpull = exported; }
  return exported;
});
