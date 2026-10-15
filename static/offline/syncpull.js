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
  const TFrepo = req("./drawingrepo.js", root.TF && root.TF.drawingrepo);
  const TFpush = req("./syncpush.js", root.TF && root.TF.syncpush);
  const TFhabitrepo = req("./habitrepo.js", root.TF && root.TF.habitrepo);
  const TFhabitlogic = req("./habitlogic.js", root.TF && root.TF.habitlogic);

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
  // S9: format SQLite "YYYY-MM-DD HH:MM:SS(.fff)" (spasi) dinormalkan ke "T" dulu — Safari/iOS mengembalikan NaN
  // untuk bentuk berspasi, yang dulu membuat sisi server selalu kalah (0).
  function tsEpoch(ts) {
    if (ts == null) return 0;
    let s = String(ts).trim();
    const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(.*)$/.exec(s);
    if (m) s = m[1] + "T" + m[2] + m[3];
    const hasTz = /[zZ]|[+-]\d\d:?\d\d$/.test(s);
    const v = Date.parse(hasTz ? s : s + "Z");
    return isNaN(v) ? 0 : v;
  }
  function dropOutbox(entityType, cid) {
    return TFoutbox.outboxByEntity(entityType, cid).then((ops) =>
      ops.reduce((p, o) => p.then(() => TFoutbox.outboxRemove(o.qid)), Promise.resolve()));
  }
  // Prinsip 2: record dirty tanpa op outbox adalah bug → antre ulang op (create bila belum punya server_id,
  // else update) alih-alih menimpanya dari server. Record ber-sync_error dilewati (ditampilkan ke pengguna).
  function requeueOp(entityType, rec) {
    const appendOp = TFoutbox.outboxAppend || TFoutbox.outboxAdd;
    return appendOp({ entity_type: entityType, op: rec.server_id == null ? "create" : "update", cid: rec.cid, payload: {} });
  }
  function needsRequeue(rec, pendingSet) {
    return !!(rec && rec.dirty && !rec.deleted && !rec.conflict && !rec.sync_error && !pendingSet.has(rec.cid));
  }
  // Antre ulang semua record dirty tanpa op (sebelum pass pull) dan masukkan cid-nya ke pendingSet.
  function requeueDirtyWithoutOps(entityType, localAll, pendingSet, result) {
    let chain = Promise.resolve();
    for (const r of localAll) {
      if (!needsRequeue(r, pendingSet)) continue;
      pendingSet.add(r.cid);
      chain = chain.then(() => requeueOp(entityType, r)).then(() => { result.requeued++; });
    }
    return chain;
  }
  // Konfirmasi per item sebelum hapus lokal (prinsip 5): hanya 404 eksplisit (terhapus) atau 403 (akses hilang)
  // yang dianggap bukti; null (OFFLINE/401/5xx/jaringan) atau body berisi id → record dipertahankan.
  function confirmedGone(answer) {
    return !!(answer && answer.id == null && (answer.status === 404 || answer.status === 403));
  }
  function confirmGone(fetchOne, serverId) {
    return fetchOne
      ? Promise.resolve().then(() => fetchOne(serverId)).then((a) => confirmedGone(a), () => false)
      : Promise.resolve(true); // tanpa fetchOne (tes lama) → perilaku lama: daftar ok sudah cukup
  }

  // fetchOne(serverId) opsional: GET /api/tasks/:id → body | {status:404|403} | null — hanya untuk konfirmasi
  // sebelum hapus lokal (daftar bisa parsial / diambil saat POST in-flight). Tanpa fetchOne → perilaku lama.
  function pullTasks(serverList, fetchOne) {
    const list = serverList || [];
    const cache = {}; // serverId -> cid
    return list.reduce((p, s) => p.then(() => ensureCid(s.id, cache)), Promise.resolve())
      .then(() => Promise.all([getAllTasks(), TFoutbox.outboxAll()]))
      .then(([localAll, outboxOps]) => {
        const pendingTaskOps = new Set(outboxOps.filter((o) => o.entity_type === "task").map((o) => o.cid));
        const localByCid = {};
        for (const r of localAll) localByCid[r.cid] = r;
        const getCid = (sid) => cache[sid] || null;
        // rev (prinsip 4) ikut naik saat pull menimpa record: push in-flight yang membaca rev lama tidak akan
        // menandai hasil pull ini "bersih" dengan sentRev-nya.
        const fromServer = (s, localRec) => Object.assign(TFhydrate.taskFromServer(s, getCid), { rev: localRec ? (localRec.rev || 0) + 1 : 0 });
        const result = { created: 0, updated: 0, deleted: 0, skipped: 0, lwwResolved: 0, conflicts: 0, requeued: 0 };
        let chain = requeueDirtyWithoutOps("task", localAll, pendingTaskOps, result);
        for (const s of list) {
          const cid = cache[s.id];
          const localRec = localByCid[cid];
          chain = chain.then(() => {
            if (!localRec || (localRec.deleted && !pendingTaskOps.has(cid))) { result.created++; return putTask(fromServer(s, localRec)); }
            if (localRec.conflict || localRec.sync_error) { result.skipped++; return; } // sync_error: tunggu "Coba lagi"/"Buang"
            if (localRec.dirty && pendingTaskOps.has(cid)) {
              if (s.updated_at !== localRec.base_rev) {
                // edit-vs-edit conflict → last-write-wins
                result.lwwResolved++;
                if (tsEpoch(s.updated_at) > tsEpoch(localRec.updated_at)) {
                  return dropOutbox("task", cid).then(() => putTask(fromServer(s, localRec))); // server wins
                }
                return; // local wins — keep dirty, push will send
              }
              result.skipped++; return; // local pending, server unchanged
            }
            // dirty tanpa op sudah diantre ulang di atas (ada di pendingTaskOps) → tidak pernah sampai sini
            if (s.updated_at !== localRec.base_rev || localRec.deleted) { result.updated++; return putTask(fromServer(s, localRec)); }
            return; // unchanged
          });
        }
        const serverIds = new Set(list.map((s) => String(s.id)));
        for (const r of localAll) {
          if (r.server_id == null) continue;
          if (serverIds.has(String(r.server_id))) continue;
          chain = chain.then(() => {
            if (r.conflict || r.sync_error) { result.skipped++; return; }
            if (r.dirty && pendingTaskOps.has(r.cid)) { result.conflicts++; return putTask(Object.assign({}, r, { conflict: "remote_deleted" })); }
            return confirmGone(fetchOne, r.server_id).then((gone) => {
              if (!gone) { result.skipped++; return; }
              result.deleted++;
              return deleteTask(r.cid);
            });
          });
        }
        return chain.then(() => result);
      });
  }

  function pullAndReconcile(rawFetch) {
    const fetchOne = (sid) => Promise.resolve(rawFetch("/api/tasks/" + sid)).then(goneOrJson).catch(() => null);
    return Promise.resolve(rawFetch("/api/tasks?include_done=true"))
      .then(listJsonOrThrow)
      .then((list) => pullTasks(list || [], fetchOne));
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
  // Habit hilang di server → hapus record + semua log-nya (+ op checkin/uncheck-nya). S13: log yatim tidak
  // boleh tinggal (ikut dihitung statistik; server menghapusnya lewat ON DELETE).
  function deleteHabitRec(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("habits", "readwrite");
      tx.objectStore("habits").delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    })).then(() => (TFhabitrepo && TFhabitrepo.deleteLogsOfHabit ? TFhabitrepo.deleteLogsOfHabit(cid) : 0));
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
      .then(() => Promise.all([getAllHabits(), TFoutbox.outboxAll()]))
      .then(([localAll, outboxOps]) => {
        const pendingHabitOps = new Set(outboxOps.filter((o) => o.entity_type === "habit").map((o) => o.cid));
        const localByCid = {};
        for (const r of localAll) localByCid[r.cid] = r;
        const result = { created: 0, updated: 0, deleted: 0, skipped: 0, requeued: 0 };
        // dirty tanpa op → antre ulang (create/update), jangan timpa; sync_error/conflict → lewati
        let chain = requeueDirtyWithoutOps("habit", localAll, pendingHabitOps, result);
        for (const h of list) {
          const cid = cache[h.id];
          const localRec = localByCid[cid];
          chain = chain.then(() => {
            if (!localRec) { result.created++; return putHabit(Object.assign(habitFromServer(h, cid), { rev: 0 })); }
            if (localRec.dirty || localRec.sync_error || localRec.conflict) { result.skipped++; return; }
            if (habitChanged(localRec, h)) { result.updated++; return putHabit(Object.assign(habitFromServer(h, cid), { rev: (localRec.rev || 0) + 1 })); }
            return;
          });
        }
        const serverIds = new Set(list.map((h) => String(h.id)));
        for (const r of localAll) {
          if (r.server_id == null) continue;
          if (serverIds.has(String(r.server_id))) continue;
          chain = chain.then(() => {
            if (r.dirty || r.sync_error || r.conflict) { result.skipped++; return; }
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
  function getAllLogs() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("habit_logs", "readonly").objectStore("habit_logs").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  function deleteLogRec(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("habit_logs", "readwrite");
      tx.objectStore("habit_logs").delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  // Jendela daftar log server (/api/habits/logs tanpa `since` = 90 hari terakhir, hari Jakarta, tanpa batas atas).
  const LOG_WINDOW_DAYS = 90;
  function logWindowFrom(opts) {
    if (opts && opts.from) return String(opts.from).slice(0, 10);
    const today = (opts && opts.today) || (TFhabitlogic ? TFhabitlogic.todayJkt() : new Date().toISOString().slice(0, 10));
    const [y, m, d] = String(today).slice(0, 10).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d) - LOG_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  }
  // T9 + S13: rekonsiliasi log habit terhadap daftar server (jendela `from`..∞):
  //   - log server tanpa padanan lokal → dibuat (dirty 0);
  //   - log lokal dirty yang status+skip_reason-nya sudah sama dengan server → dirty 0 + op checkin-nya dibuang
  //     (op dibuang dulu oleh error sementara, atau check-in yang sama dari perangkat lain);
  //   - log lokal dirty lain → tetap (local-wins; tanpa op & tanpa sync_error → antre ulang);
  //   - log lokal bersih (dirty 0) di dalam jendela yang ABSEN di server → dihapus ("uncheck" dari perangkat
  //     lain menghapus barisnya di server; dulu tak pernah menyebar).
  // opts.from (YYYY-MM-DD) = awal jendela bila daftar diambil dengan `since` lain; default hari ini − 90.
  function pullHabitLogs(serverLogs, opts) {
    const list = serverLogs || [];
    const cache = {};
    const result = { created: 0, updated: 0, deleted: 0, skipped: 0, requeued: 0, confirmed: 0 };
    const appendOp = TFoutbox.outboxAppend || TFoutbox.outboxAdd;
    const from = logWindowFrom(opts);
    return TFoutbox.outboxAll().then((outboxOps) => {
      const logOps = outboxOps.filter((o) => o.entity_type === "habit_log");
      const pendingLogOps = new Set(logOps.map((o) => o.cid));
      // uncheck lokal yang belum terkirim: jangan hidupkan lagi log server yang akan dihapus push berikutnya
      const pendingUncheck = new Set(logOps.filter((o) => o.op === "uncheck" && o.payload).map((o) => o.payload.habit_cid + "|" + o.payload.date));
      const seen = new Set(); // "habit_cid|date" yang ada di server
      return list.reduce((p, l) => p.then(() =>
        ensureHabitCid(l.habit_id, cache).then((hcid) => {
          seen.add(hcid + "|" + l.date);
          return getLogByHabitDate(hcid, l.date).then((local) => {
            const skip = l.skip_reason != null ? l.skip_reason : "";
            if (!local) {
              if (pendingUncheck.has(hcid + "|" + l.date)) { result.skipped++; return; }
              result.created++;
              return putLog({ cid: TFids.newCid(), habit_cid: hcid, date: l.date, status: l.status, skip_reason: skip, dirty: 0, rev: 0 });
            }
            const same = local.status === l.status && (local.skip_reason || "") === skip;
            if (local.dirty) {
              if (same) {
                // server sudah memegang status yang sama → tidak perlu dikirim lagi
                result.confirmed++;
                const next = Object.assign({}, local, { dirty: 0 });
                delete next.sync_error;
                return putLog(next).then(() => logOps.filter((o) => o.cid === local.cid && o.op === "checkin")
                  .reduce((q, o) => q.then(() => TFoutbox.outboxRemove(o.qid)), Promise.resolve()));
              }
              result.skipped++;
              // log dirty tanpa op checkin (op dibuang dulu / bug) → antre ulang; sync_error → tunggu pengguna
              if (!local.sync_error && !pendingLogOps.has(local.cid)) {
                pendingLogOps.add(local.cid);
                result.requeued++;
                return appendOp({ op: "checkin", entity_type: "habit_log", cid: local.cid, payload: local });
              }
              return;
            }
            if (!same) {
              result.updated++;
              return putLog(Object.assign({}, local, { status: l.status, skip_reason: skip, dirty: 0, rev: (local.rev || 0) + 1 }));
            }
            return;
          });
        })
      ), Promise.resolve())
        // pass 2: log lokal bersih di jendela yang tidak ada di server → dihapus (uncheck dari perangkat lain)
        .then(() => getAllLogs())
        .then((allLogs) => allLogs.reduce((p, lg) => p.then(() => {
          if (lg.dirty || lg.sync_error) return;
          if (String(lg.date) < from) return; // di luar jendela daftar server → tidak ada bukti
          if (seen.has(lg.habit_cid + "|" + lg.date)) return;
          // habit yang belum pernah di-push (tanpa server_id) tidak mungkin punya log di server → biarkan
          return TFidmap.serverIdOf(lg.habit_cid).then((sid) => {
            if (sid == null) return;
            result.deleted++;
            return deleteLogRec(lg.cid);
          });
        }), Promise.resolve()))
        .then(() => result);
    });
  }
  function pullHabitsAndLogs(rawFetch) {
    // Jendela log dikirim eksplisit (`since`) supaya batas jendela klien = server persis (tidak bergantung
    // selisih jam/hari antara perangkat dan server) — pass hapus T9 hanya berlaku di dalam jendela ini.
    const from = logWindowFrom(null);
    // Kedua respons dicek statusnya (T1): 503 OFFLINE / 401 / 5xx → throw, tidak ada yang ditimpa/dihapus.
    return Promise.all([
      Promise.resolve(rawFetch("/api/habits")).then(listJsonOrThrow),
      Promise.resolve(rawFetch("/api/habits/logs?since=" + encodeURIComponent(from))).then(listJsonOrThrow),
    ]).then(([habits, logs]) =>
      pullHabits(habits || []).then((hb) =>
        pullHabitLogs(logs || [], { from: from }).then((lg) => ({ habits: hb, logs: lg }))));
  }

  // ── T8: penanda occurrence task berulang (recurring_exceptions) ─────────────────────────────────
  function getAllExceptions() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("recurring_exceptions", "readonly").objectStore("recurring_exceptions").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  function putException(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("recurring_exceptions", "readwrite");
      tx.objectStore("recurring_exceptions").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  // CAS: tulis/hapus hanya bila record masih seperti saat dibaca (pengguna bisa menandai occurrence saat pull).
  function sameExceptionState(cur, expect) {
    return !!cur && cur.status === expect.status && !!cur.dirty === !!expect.dirty;
  }
  function updateExceptionIfUnchanged(expect, patch) {
    return TFdb.mutate("recurring_exceptions", expect.cid, (cur) =>
      (sameExceptionState(cur, expect) ? Object.assign({}, cur, patch) : undefined));
  }
  function deleteExceptionIfUnchanged(expect) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      let done = false;
      const tx = db.transaction("recurring_exceptions", "readwrite");
      const os = tx.objectStore("recurring_exceptions");
      const r = os.get(expect.cid);
      r.onsuccess = () => {
        if (!sameExceptionState(r.result, expect)) return;
        os.delete(expect.cid);
        done = true;
      };
      tx.oncomplete = () => resolve(done);
      tx.onerror = () => reject(tx.error);
    }));
  }
  const EXC_WINDOW_DAYS = 60;
  function todayJktStr() {
    return TFhabitlogic ? TFhabitlogic.todayJkt() : new Date().toISOString().slice(0, 10);
  }
  function addDaysStr(dateStr, n) {
    const [y, m, d] = String(dateStr).slice(0, 10).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
  }
  // Rekonsiliasi per (task_cid, occurrence_date) terhadap peta server { "<task_id>": [{occurrence_date, status}] }
  // untuk jendela opts.from..opts.to:
  //   - task id server yang tidak dikenal idmap → dilewati (task-nya belum di-pull);
  //   - entri lokal dengan op mark_occurrence tertunda MENANG (status sama dengan server → op dibuang, dirty 0);
  //   - selain itu status server diadopsi (dibuat / diperbarui, dirty 0) — termasuk record `dirty` legacy tanpa
  //     op (dulu push tidak pernah membersihkan dirty), karena server adalah sumber kebenaran setelah terkirim;
  //   - entri lokal bersih di dalam jendela yang absen di server (dan task-nya punya server id) → dihapus.
  function reconcileRecurringExceptions(serverMap, opts) {
    const map = (serverMap && typeof serverMap === "object" && !Array.isArray(serverMap)) ? serverMap : {};
    const from = opts && opts.from ? String(opts.from) : null;
    const to = opts && opts.to ? String(opts.to) : null;
    const now = (opts && opts.now) || new Date().toISOString();
    const result = { created: 0, updated: 0, deleted: 0, skipped: 0, confirmed: 0, unknownTasks: 0 };
    return Promise.all([getAllExceptions(), TFoutbox.outboxAll()]).then(([localAll, ops]) => {
      const markOps = ops.filter((o) => o.entity_type === "recurring_exception" && o.op === "mark_occurrence");
      const pendingByCid = new Set(markOps.map((o) => o.cid));
      const localByKey = {};
      for (const r of localAll) localByKey[r.task_cid + "|" + r.occurrence_date] = r;
      const serverKeys = new Set();
      const sidByTaskCid = {}; // task_cid → server id (dari peta server)
      let chain = Promise.resolve();
      for (const sidStr of Object.keys(map)) {
        const entries = Array.isArray(map[sidStr]) ? map[sidStr] : [];
        chain = chain.then(() => TFidmap.cidOf("task", /^\d+$/.test(sidStr) ? Number(sidStr) : sidStr)).then((taskCid) => {
          if (!taskCid) { result.unknownTasks++; return; }
          sidByTaskCid[taskCid] = sidStr;
          let c2 = Promise.resolve();
          for (const e of entries) {
            if (!e || !e.occurrence_date) continue;
            const key = taskCid + "|" + e.occurrence_date;
            serverKeys.add(key);
            const local = localByKey[key];
            c2 = c2.then(() => {
              if (!local) {
                result.created++;
                return putException({ cid: TFids.newCid(), task_cid: taskCid, occurrence_date: e.occurrence_date, status: e.status, created_at: now, dirty: 0 });
              }
              if (pendingByCid.has(local.cid)) {
                if (local.status !== e.status) { result.skipped++; return; } // op lokal tertunda menang
                return updateExceptionIfUnchanged(local, { dirty: 0 }).then((saved) => {
                  if (!saved) { result.skipped++; return; } // berubah selama pull → biarkan push yang mengirim
                  result.confirmed++;
                  return markOps.filter((o) => o.cid === local.cid).reduce((q, o) => q.then(() => TFoutbox.outboxRemove(o.qid)), Promise.resolve());
                });
              }
              if (local.status !== e.status || local.dirty) {
                return updateExceptionIfUnchanged(local, { status: e.status, dirty: 0 })
                  .then((saved) => { if (saved) result.updated++; else result.skipped++; });
              }
            });
          }
          return c2;
        });
      }
      // pass 2: entri lokal di jendela yang absen di server → hapus (hanya bila task-nya sudah punya server id)
      chain = chain.then(() => localAll.reduce((p, r) => p.then(() => {
        const key = r.task_cid + "|" + r.occurrence_date;
        if (serverKeys.has(key)) return;
        if (pendingByCid.has(r.cid)) return; // belum terkirim → bukan bukti absen
        const d = String(r.occurrence_date);
        if ((from && d < from) || (to && d > to)) return; // di luar jendela
        const sidP = sidByTaskCid[r.task_cid] != null ? Promise.resolve(sidByTaskCid[r.task_cid]) : TFidmap.serverIdOf(r.task_cid);
        return sidP.then((sid) => {
          if (sid == null) return; // task belum pernah di-push
          return deleteExceptionIfUnchanged(r).then((done) => { if (done) result.deleted++; else result.skipped++; });
        });
      }), Promise.resolve()));
      return chain.then(() => result);
    });
  }
  function pullRecurringExceptions(rawFetch, opts) {
    const today = (opts && opts.today) || todayJktStr();
    const from = addDaysStr(today, -EXC_WINDOW_DAYS);
    const to = addDaysStr(today, EXC_WINDOW_DAYS);
    return Promise.resolve(rawFetch("/api/recurring/exceptions?from=" + from + "&to=" + to))
      .then(listJsonOrThrow)
      .then((body) => reconcileRecurringExceptions(body || {}, { from: from, to: to }));
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
  // S17: tanpa idmap & tanpa server_id lokal, cocokkan client_id server dengan cid lokal (note yang dibuat
  // di perangkat ini tapi respons create-nya hilang) — seperti ensureDrawingCid; client_id dipakai sebagai cid baru.
  function ensureNoteCid(serverId, cache, serverObj) {
    if (cache[serverId]) return Promise.resolve(cache[serverId]);
    return TFidmap.cidOf("note", serverId).then((cid) => {
      if (cid) { cache[serverId] = cid; return cid; }
      return getAllNotes().then((allNotes) => {
        const clientId = serverObj && serverObj.client_id ? String(serverObj.client_id) : null;
        // salinan "simpan sebagai baru/pribadi" memakai client_id terpisah dari cid → cocokkan keduanya
        const existing = allNotes.find((n) => n.server_id != null && String(n.server_id) === String(serverId))
          || (clientId ? allNotes.find((n) => n.cid === clientId || (n.client_id != null && String(n.client_id) === clientId)) : undefined);
        if (existing && existing.cid) {
          cache[serverId] = existing.cid;
          return TFidmap.mapPut("note", serverId, existing.cid).then(() => existing.cid);
        }
        const fresh = clientId || TFids.newCid();
        cache[serverId] = fresh;
        return TFidmap.mapPut("note", serverId, fresh).then(() => fresh);
      });
    });
  }
  function getNoteRec(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("scratchpad_notes", "readonly").objectStore("scratchpad_notes").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function serverLinkCids(s, noteCidCache) {
    return (s.linked_to || []).map((sid) => noteCidCache[sid]).filter(Boolean);
  }
  // Server menautkan note yang dikenal lokal, tapi cid-nya tidak ada di linked_to_cids lokal.
  function linksStale(s, local, noteCidCache) {
    let cur = [];
    try { cur = JSON.parse(local.linked_to_cids || "[]") || []; } catch (_) { cur = []; }
    return serverLinkCids(s, noteCidCache).some((c) => cur.indexOf(c) === -1);
  }
  function noteFromServer(s, cid, noteCidCache) {
    const toCids = serverLinkCids(s, noteCidCache);
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

  // fetchOne(serverId) opsional: GET /api/scratchpad/:id → body | {status:404|403} | null — konfirmasi sebelum hapus lokal.
  function pullNotes(serverNotes, fetchOne) {
    const list = (serverNotes || []);
    const cache = {};
    return list.reduce((p, s) => p.then(() => ensureNoteCid(s.id, cache, s)), Promise.resolve())
      .then(() => Promise.all([getAllNotes(), TFoutbox.outboxAll()]))
      .then(([localAll, outboxOps]) => {
        const pendingNoteOps = new Set(outboxOps.filter((o) => o.entity_type === "note").map((o) => o.cid));
        const byCid = {}; for (const r of localAll) byCid[r.cid] = r;
        const result = { created: 0, updated: 0, deleted: 0, skipped: 0, lwwResolved: 0, pinned: 0, relinked: 0, requeued: 0 };
        let chain = requeueDirtyWithoutOps("note", localAll, pendingNoteOps, result);
        for (const s of list) {
          const cid = cache[s.id];
          const local = byCid[cid];
          chain = chain.then(() => {
            if (!local || (local.deleted && !pendingNoteOps.has(cid))) { result.created++; return writeNote(s, cid, cache); }
            if (local.conflict || local.sync_error) { result.skipped++; return; }
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
            // dirty tanpa op sudah diantre ulang di atas (ada di pendingNoteOps) → tidak pernah sampai sini
            if (s.updated_at !== local.base_rev || local.deleted) {
              result.updated++; return writeNote(s, cid, cache, local.notice ? { notice: local.notice } : undefined);
            }
            // updated_at sama, tapi server menautkan note yang kini punya cid lain secara lokal (mis. note dipulihkan
            // dari Sampah → dibuat ulang dengan cid baru): perbarui linked_to_cids saja (rekaman bersih saja).
            if (!local.dirty && linksStale(s, local, cache)) {
              return getNoteRec(cid).then((cur) => {
                if (!cur || cur.dirty || cur.deleted || !linksStale(s, cur, cache)) return;
                result.relinked++;
                return putNote(Object.assign({}, cur, { linked_to_cids: JSON.stringify(serverLinkCids(s, cache)) }));
              });
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
            if (r.conflict || r.sync_error) { result.skipped++; return; }
            if (r.dirty && pendingNoteOps.has(r.cid)) {
              if (r.list_id != null) { result.skipped++; return putNote(Object.assign({}, r, { conflict: "remote_deleted" })); }
              result.skipped++; return; // personal local-wins; push update→404→re-create
            }
            return confirmGone(fetchOne, r.server_id).then((gone) => {
              if (!gone) { result.skipped++; return; }
              result.deleted++;
              return deleteNoteRec(r.cid).then(() => TFidmap.mapDelete("note", r.server_id));
            });
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
    const fetchOne = (sid) => Promise.resolve(rawFetch("/api/scratchpad/" + sid)).then(goneOrJson).catch(() => null);
    return Promise.resolve(rawFetch("/api/scratchpad"))
      .then(listJsonOrThrow)
      .then((list) => pullNotes(list || [], fetchOne));
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
    // body tanpa id (null / {status:404|403} / body error) → bukan peta: jangan tulis apa pun
    return Promise.resolve(fetchOne(serverId)).then((fullRow) => ((fullRow && fullRow.id != null) ? putMindmap(Object.assign(mindmapFromServer(fullRow, cid), extra || {})) : null));
  }

  // serverList = GET /api/mindmaps (metadata, no data_json). fetchOne(serverId) = GET /api/mindmaps/:id (full).
  // confirmOne(serverId) opsional: body | {status:404|403} | null — konfirmasi per item sebelum hapus lokal
  // (tanpa confirmOne → perilaku lama: hilang dari daftar = hapus).
  function pullMindmaps(serverList, fetchOne, confirmOne) {
    const list = (serverList || []);
    const cache = {};
    return list.reduce((p, s) => p.then(() => ensureMindmapCid(s.id, cache)), Promise.resolve())
      .then(() => Promise.all([getAllMindmaps(), TFoutbox.outboxAll()]))
      .then(([localAll, outboxOps]) => {
        const pendingMindmapOps = new Set(outboxOps.filter((o) => o.entity_type === "mindmap").map((o) => o.cid));
        const byCid = {}; for (const r of localAll) byCid[r.cid] = r;
        const result = { created: 0, updated: 0, deleted: 0, skipped: 0, lwwResolved: 0, pinned: 0, requeued: 0 };
        let chain = requeueDirtyWithoutOps("mindmap", localAll, pendingMindmapOps, result);
        for (const s of list) {
          const cid = cache[s.id];
          const local = byCid[cid];
          chain = chain.then(() => {
            if (!local || (local.deleted && !pendingMindmapOps.has(cid))) { result.created++; return writeMindmapFull(s.id, cid, fetchOne); }
            if (local.conflict || local.sync_error) { result.skipped++; return; }
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
            // dirty tanpa op sudah diantre ulang di atas (ada di pendingMindmapOps) → tidak pernah sampai sini
            if (s.updated_at !== local.base_rev || local.deleted) {
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
            if (r.conflict || r.sync_error) { result.skipped++; return; }
            if (r.dirty && pendingMindmapOps.has(r.cid)) {
              if (r.list_id != null) { result.skipped++; return putMindmap(Object.assign({}, r, { conflict: "remote_deleted" })); }
              result.skipped++; return; // personal local-wins; push update→404→re-create
            }
            return confirmGone(confirmOne, r.server_id).then((gone) => {
              if (!gone) { result.skipped++; return; }
              result.deleted++;
              return deleteMindmapRec(r.cid).then(() => TFidmap.mapDelete("mindmap", r.server_id));
            });
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
    // Detail gagal (503 OFFLINE/401/5xx) → null, BUKAN body error (body error dulu ditulis sebagai mindmap kosong)
    const fetchOne = (sid) => Promise.resolve(rawFetch("/api/mindmaps/" + sid))
      .then((res) => {
        const body = jsonIfOk(res);
        return body && body.status === 404 && body.id == null ? null : body;
      })
      .catch(() => null);
    // Konfirmasi hapus: 404/403 eksplisit → {status}; gagal lain → null (dipertahankan)
    const confirmOne = (sid) => Promise.resolve(rawFetch("/api/mindmaps/" + sid)).then(goneOrJson).catch(() => null);
    return Promise.resolve(rawFetch("/api/mindmaps"))
      .then(listJsonOrThrow)
      .then((listRows) => pullMindmaps(listRows || [], fetchOne, confirmOne));
  }

  function getAllDrawings() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("drawings", "readonly").objectStore("drawings").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
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
            (serverObj && serverObj.client_id && (d.cid === serverObj.client_id || (d.client_id != null && String(d.client_id) === String(serverObj.client_id))))
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

  // Tulis data server ke record lewat CAS: hanya bila record masih sama seperti saat dibaca
  // (rev/dirty/deleted sama; atau tetap belum ada). Berubah selama pull → lewati (pull berikutnya).
  function sameDrawingState(cur, local) {
    if (!local) return !cur;
    return !!cur && (cur.rev || 0) === (local.rev || 0) && !!cur.dirty === !!local.dirty && !!cur.deleted === !!local.deleted;
  }
  function dropBlob(ref) {
    return (ref && BlobStore) ? Promise.resolve(BlobStore.delete(ref)).catch(() => {}) : Promise.resolve();
  }
  // Hapus record hanya bila tidak berubah sejak dibaca (CAS); blob ikut dibuang. Resolve true bila terhapus.
  function deleteDrawingIfUnchanged(cid, expect) {
    let ref = null;
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      let done = false;
      const tx = db.transaction("drawings", "readwrite");
      const os = tx.objectStore("drawings");
      const r = os.get(cid);
      r.onsuccess = () => {
        const cur = r.result;
        if (!cur || !sameDrawingState(cur, expect)) return;
        ref = cur.blob_ref || null;
        os.delete(cid);
        done = true;
      };
      tx.oncomplete = () => resolve(done);
      tx.onerror = () => reject(tx.error);
    })).then((done) => (done ? dropBlob(ref).then(() => true) : false));
  }
  function writeDrawing(s, cid, localRec) {
    const dataJson = s.data_json;
    // Detail server gagal diambil & tidak ada data lokal → record data_missing (tanpa placeholder "{}",
    // base_rev null supaya pull/getDrawing berikutnya mengambil ulang). Placeholder dulu terbuka sebagai
    // kanvas kosong yang bisa diedit lalu menimpa gambar server.
    const missing = dataJson == null && !(localRec && localRec.blob_ref);
    const blobP = (dataJson != null && BlobStore) ? BlobStore.put(dataJson, { mime: "application/json" }) : Promise.resolve(null);
    return blobP.then((newRef) => {
      let oldRef = null;
      return TFrepo.mutateDrawing(cid, (cur) => {
        if (!sameDrawingState(cur, localRec)) return undefined;
        const keepRef = cur ? cur.blob_ref : null;
        if (newRef) oldRef = keepRef;
        const rec = Object.assign(drawingFromServer(s, cid), {
          blob_ref: newRef || keepRef,
          rev: cur ? (cur.rev || 0) + 1 : 0,
          svg_stale: 0,
          data_missing: missing ? 1 : 0,
        });
        if (missing) rec.base_rev = null;
        // pin lokal dipertahankan (bisa ada op pin tertunda); adopsi pin server dilakukan Pass 5 yang mengecek op
        if (cur) rec.is_pinned = cur.is_pinned ? 1 : 0;
        // client_id server (cid mesin pembuat = id di direktif note) → getRaw bisa menemukan record ini
        const clientId = s.client_id || (cur && cur.client_id);
        if (clientId && clientId !== cid) rec.client_id = clientId;
        return rec;
      }).then((saved) => {
        if (!saved) return dropBlob(newRef).then(() => false);
        return Promise.all([
          oldRef && oldRef !== newRef ? dropBlob(oldRef) : null,
          (s.tags && TFtag && TFtag.setEntityTags) ? TFtag.setEntityTags("drawing", cid, s.tags) : null,
        ]).then(() => true);
      });
    });
  }

  function writeDrawingFull(s, cid, fetchOne, localRec) {
    if (!fetchOne) {
      return writeDrawing(s, cid, localRec);
    }
    return Promise.resolve(fetchOne(s.id)).catch(() => null).then((full) => {
      const merged = Object.assign({}, s, (full && full.id != null) ? full : {});
      // Record lokal sudah ada tapi data server gagal diambil → jangan klaim base_rev baru tanpa datanya.
      if (localRec && merged.data_json == null) return false;
      // Record bersih hanya mengadopsi revisi server yang LEBIH BARU (detail basi/cache diabaikan).
      if (localRec && !localRec.deleted && !TFrepo.tsNewer(merged.updated_at, localRec.base_rev)) return false;
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

  // Setelah merge: perbarui metadata op create/update tertunda (push membaca data dari blob,
  // jadi salinan data_json di payload — bila ada dari versi lama — dibuang).
  function updateDrawingOutboxMeta(cid, title, svgPreview) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("_outbox", "readwrite");
      const os = tx.objectStore("_outbox");
      const r = os.getAll();
      r.onsuccess = () => {
        const ops = r.result || [];
        for (const op of ops) {
          if (op.entity_type === "drawing" && op.cid === cid && (op.op === "update" || op.op === "create")) {
            const payload = Object.assign({}, op.payload || {});
            delete payload.data_json;
            if (title) payload.title = title;
            if (svgPreview != null) payload.svg_preview = svgPreview;
            op.payload = payload;
            os.put(op);
          }
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  // Record dirty + server berubah sejak base_rev → gabung (union) data lokal & server lewat CAS rev.
  function mergeDirtyDrawing(s, cid, local, fetchOne, result) {
    const fetchP = fetchOne ? Promise.resolve(fetchOne(s.id)).catch(() => null) : Promise.resolve(null);
    const localDataJsonP = (local.blob_ref && BlobStore)
      ? Promise.resolve(BlobStore.getBytes(local.blob_ref)).then((b) => b || "{}").catch(() => "{}")
      : Promise.resolve("{}");
    return Promise.all([fetchP, localDataJsonP]).then(([remoteFullRow, localDataJson]) => {
      const remoteFull = (remoteFullRow && remoteFullRow.id != null) ? remoteFullRow : s;
      const remoteDataJson = remoteFull.data_json != null ? remoteFull.data_json : s.data_json;
      // Data server gagal diambil → jangan klaim sudah menggabung (base_rev tetap; coba pull berikutnya).
      if (remoteDataJson == null) { result.skipped++; return; }
      // Revisi server tidak lebih baru dari base_rev (respons basi) → jangan gabung data lama.
      if (!TFrepo.tsNewer(remoteFull.updated_at || s.updated_at, local.base_rev)) { result.skipped++; return; }
      // Gema push kita sendiri yang masih in-flight (server sudah menerima, record belum ditandai) → bukan perubahan remote.
      const inflight = (TFpush && TFpush.inflightDrawingData) ? TFpush.inflightDrawingData(cid) : undefined;
      if (inflight !== undefined && inflight === remoteDataJson) { result.skipped++; return; }
      const preferRemote = tsEpoch(s.updated_at) > tsEpoch(local.updated_at);
      const mergedJson = mergeDrawingSnapshots(localDataJson, remoteDataJson, { preferRemote });
      const mergedTitle = (remoteFull && remoteFull.title) || s.title || local.title || "Untitled Drawing";
      const mergedSvg = (remoteFull && remoteFull.svg_preview) || s.svg_preview || local.svg_preview || "";
      const readRev = local.rev || 0;
      const sameData = TFrepo.sameContent(mergedJson, localDataJson);
      if (sameData && mergedTitle === local.title) {
        // Server tidak menambah apa pun (mis. gema push kita sendiri) → cukup catat base_rev.
        return TFrepo.mutateDrawing(cid, (cur) => {
          if (!cur || cur.deleted || (cur.rev || 0) !== readRev || cur.base_rev !== local.base_rev) return undefined;
          return Object.assign({}, cur, { base_rev: s.updated_at, server_id: cur.server_id != null ? cur.server_id : s.id });
        }).then((saved) => { if (saved) result.merged++; else result.skipped++; });
      }
      const blobP = BlobStore ? BlobStore.put(mergedJson, { mime: "application/json" }) : Promise.resolve(null);
      return blobP.then((newBlobRef) => {
        let oldRef = null;
        return TFrepo.mutateDrawing(cid, (cur) => {
          // CAS: rev (edit lokal) DAN base_rev (push selesai selama pull) harus sama dengan saat dibaca
          if (!cur || cur.deleted || (cur.rev || 0) !== readRev || cur.base_rev !== local.base_rev) return undefined;
          oldRef = cur.blob_ref;
          return Object.assign({}, cur, {
            server_id: cur.server_id != null ? cur.server_id : s.id,
            blob_ref: newBlobRef,
            title: mergedTitle,
            svg_preview: mergedSvg,
            svg_stale: 1,
            base_rev: s.updated_at,
            dirty: 1,
            rev: readRev + 1,
          });
        }).then((saved) => {
          if (!saved) { result.skipped++; return dropBlob(newBlobRef); }
          return Promise.all([
            oldRef && oldRef !== newBlobRef ? dropBlob(oldRef) : null,
            updateDrawingOutboxMeta(cid, mergedTitle, mergedSvg),
          ]).then(() => { result.merged = (result.merged || 0) + 1; });
        });
      });
    });
  }

  // Adopsi pin server dalam SATU transaksi (drawings + _outbox): lewati bila ada op pin tertunda untuk gambar
  // ini SAAT INI (bukan snapshot outbox awal pull) atau record berubah sejak dibaca. togglePin juga atomik.
  function adoptServerPin(cid, expectRev, localPinned, serverPinned) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      let done = false;
      const tx = db.transaction(["drawings", "_outbox"], "readwrite");
      const ds = tx.objectStore("drawings");
      const r = ds.get(cid);
      r.onsuccess = () => {
        const cur = r.result;
        if (!cur || (cur.rev || 0) !== expectRev || (cur.is_pinned ? 1 : 0) !== localPinned) return;
        const ops = tx.objectStore("_outbox").getAll();
        ops.onsuccess = () => {
          const pending = (ops.result || []).some((o) => o.entity_type === "drawing" && o.op === "pin" && o.cid === cid);
          if (pending) return;
          ds.put(Object.assign({}, cur, { is_pinned: serverPinned }));
          done = true;
        };
      };
      tx.oncomplete = () => resolve(done);
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
              return writeDrawingFull(s, cid, fetchOne, local).then((wrote) => {
                if (wrote) result.created++; else result.skipped++;
              });
            }
            if (local.conflict || local.deleted || local.sync_error) {
              result.skipped++; // konflik / hapus lokal tertunda / sync_error (4xx permanen, T13) → biarkan push / pengguna
              return;
            }
            // Dirty tanpa op tertunda (mis. op gagal & dibuang) → antre op update, JANGAN timpa data lokal.
            const queueP = (local.dirty && !pendingDrawingOps.has(cid))
              ? TFrepo.ensureDrawingUpdateOp(cid, { title: local.title, svg_preview: local.svg_preview || "", is_pinned: local.is_pinned ? 1 : 0 })
                .then(() => { pendingDrawingOps.add(cid); })
              : Promise.resolve();
            return queueP.then(() => {
              // Hanya revisi server yang LEBIH BARU dari base_rev yang diproses (daftar basi diabaikan).
              const serverNewer = TFrepo.tsNewer(s.updated_at, local.base_rev);
              if (local.dirty) {
                if (serverNewer) return mergeDirtyDrawing(s, cid, local, fetchOne, result);
                result.skipped++;
                return;
              }
              if (serverNewer) {
                return writeDrawingFull(s, cid, fetchOne, local).then((wrote) => {
                  if (wrote) result.updated++; else result.skipped++;
                });
              }
            });
          });
        }

        // Pass 3 & 4: Clean phantom duplicate rows and remote deletions
        const serverIds = new Set(list.map((s) => String(s.id)));
        for (const r of localAll) {
          if (r.note_cid !== undefined) continue;
          if (r.server_id == null) continue;
          const expectedCid = cache[r.server_id];
          if (expectedCid && r.cid !== expectedCid) {
            if (r.dirty && !r.deleted) {
              // Duplikat yang punya edit belum terkirim: kirim dulu (op update), hapus di pull berikutnya.
              // sync_error → jangan antre ulang (T13); biarkan sampai pengguna memutuskan.
              chain = chain.then(() => (r.sync_error ? null : TFrepo.ensureDrawingUpdateOp(r.cid, { title: r.title, svg_preview: r.svg_preview || "", is_pinned: r.is_pinned ? 1 : 0 })))
                .then(() => { result.skipped++; });
              continue;
            }
            chain = chain.then(() => deleteDrawingIfUnchanged(r.cid, r));
            continue;
          }
          if (serverIds.has(String(r.server_id))) continue;
          chain = chain.then(() => {
            if (r.sync_error || r.conflict || (r.dirty && pendingDrawingOps.has(r.cid))) {
              result.skipped++;
              return;
            }
            // Hapus lokal HANYA bila server menjawab 404 secara eksplisit (daftar bisa diambil sebelum POST/PUT
            // in-flight selesai; null/OFFLINE/401/5xx bukan bukti terhapus). Tanpa fetchOne → perilaku lama.
            const confirmP = fetchOne
              ? Promise.resolve(fetchOne(r.server_id)).catch(() => null)
              : Promise.resolve({ status: 404 });
            return confirmP.then((answer) => {
              if (!(answer && answer.status === 404 && answer.id == null)) { result.skipped++; return; }
              return deleteDrawingIfUnchanged(r.cid, r).then((gone) => {
                if (!gone) { result.skipped++; return; }
                result.deleted++;
                return TFidmap.mapDelete("drawing", r.server_id);
              });
            });
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
                c2 = c2.then(() => adoptServerPin(cid, local.rev || 0, localPinned, serverPinned)
                  .then((saved) => { if (saved) result.pinned++; }));
              }
            }
            return c2;
          });
        });

        return chain.then(() => result);
      });
  }

  // Respons Response-like → body JSON hanya untuk 2xx. 404 → {status:404} (bukti eksplisit terhapus);
  // status gagal lain (503 OFFLINE, 401, 5xx) → null. Objek biasa (tes) diteruskan apa adanya.
  function jsonIfOk(res) {
    if (!res || typeof res.json !== "function") return res || null;
    if (res.status === 404) return { status: 404 };
    if (res.ok === false || (typeof res.status === "number" && res.status >= 400)) return null;
    return res.json();
  }
  // Konfirmasi hapus per item: 404 (terhapus) / 403 (akses hilang) → {status}; 2xx → body; gagal lain → null.
  function goneOrJson(res) {
    if (!res || typeof res.json !== "function") return res || null;
    if (res.status === 404 || res.status === 403) return { status: res.status };
    if (res.ok === false || (typeof res.status === "number" && res.status >= 400)) return null;
    return res.json();
  }
  // T1 / prinsip 5: respons daftar yang gagal (503 OFFLINE dari SW, 401, 5xx, atau objek {ok:false}) → throw,
  // jangan pernah mengurai body error sebagai daftar (daftar kosong = hapus lokal massal).
  function listJsonOrThrow(res) {
    if (res && (res.ok === false || (typeof res.status === "number" && res.status >= 400))) {
      const e = new Error("http " + res.status);
      e.status = res.status;
      throw e;
    }
    return res && typeof res.json === "function" ? res.json() : res;
  }

  function pullDrawingsAndReconcile(rawFetch) {
    const fetchOne = (sid) => Promise.resolve(rawFetch("/api/drawings/" + sid))
      .then(jsonIfOk)
      .catch(() => null);
    return Promise.resolve(rawFetch("/api/drawings"))
      .then(listJsonOrThrow)
      .then((list) => pullDrawings(list || [], fetchOne));
  }

  const exported = {
    pullTasks, pullAndReconcile,
    reconcileRecurringExceptions, pullRecurringExceptions,
    pullHabits, pullHabitLogs, pullHabitsAndLogs,
    pullNotes, pullNotesAndReconcile,
    pullMindmaps, pullMindmapsAndReconcile,
    pullDrawings, pullDrawingsAndReconcile,
    mergeDrawingSnapshots,
    tsEpoch, ensureNoteCid, listJsonOrThrow, goneOrJson,
  };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.syncpull = exported; }
  return exported;
});
