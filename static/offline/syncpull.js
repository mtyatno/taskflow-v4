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
  // noterepo dibaca malas (prinsip 7: salinan konflik note); modul lama dari cache SW tanpa helper → jalur LWW lama
  function noteRepo() {
    try { return isNode ? require("./noterepo.js") : (root.TF && root.TF.noterepo); } catch (_) { return null; }
  }
  const TFmm = req("./mindmaprepo.js", root.TF && root.TF.mindmaprepo);
  const TFprojects = req("./projectcache.js", root.TF && root.TF.projectcache);
  function dispatchMindmapEvent(name, detail) {
    try {
      const w = (typeof window !== "undefined") ? window : root;
      if (w && typeof w.dispatchEvent === "function" && typeof CustomEvent === "function") {
        w.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
      }
    } catch (_) {}
  }

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
  // T11 (klien): baris server yang dibuat oleh POST kita sendiri (client_id = cid / client_id lokal) tetapi
  // responsnya hilang (timeout) harus dikenali sebagai record lokal yang sama — bukan dibuatkan cid baru
  // (duplikat hantu yang bertahan setelah retry POST mengembalikan baris yang sama).
  // Hanya record yang belum terpetakan (server_id null) atau terpetakan ke baris yang sama yang boleh cocok —
  // record yang sudah milik baris server LAIN (mis. cid X yang kemudian dibuat ulang jadi baris baru) tidak boleh
  // ikut dipetakan ke baris ini (dua baris server → satu cid). Pengecualian: record yang sedang dibuat ulang setelah
  // PUT 404 (recreate_of_sid, client_id segar) dikenali lewat client_id-nya walau server_id-nya masih baris lama —
  // HANYA selama record masih menunjuk baris yang terhapus itu (server_id == recreate_of_sid) DAN baris itu tidak
  // muncul lagi di daftar pull ini (`liveSids`). Baris asli kembali (dipulihkan) → penanda basi: baris hasil POST
  // yang responsnya hilang adalah baris yatim terpisah, bukan record ini.
  function matchesClientId(r, serverObj, clientId, liveSids) {
    const sameRow = r.server_id == null || (serverObj && String(r.server_id) === String(serverObj.id));
    if (r.cid === clientId && sameRow) return true;
    if (!(r.client_id != null && String(r.client_id) === clientId)) return false;
    if (sameRow) return true;
    return r.recreate_of_sid != null && String(r.server_id) === String(r.recreate_of_sid)
      && !(liveSids && liveSids.has(String(r.recreate_of_sid)));
  }
  function findByClientId(rows, serverObj, liveSids) {
    const clientId = serverObj && serverObj.client_id != null ? String(serverObj.client_id) : null;
    if (!clientId) return undefined;
    return rows.find((r) => matchesClientId(r, serverObj, clientId, liveSids));
  }
  function liveSidsOf(list) { return new Set((list || []).map((s) => String(s.id))); }
  // cid untuk baris server yang belum dikenal perangkat ini: client_id server (= cid perangkat pembuat, dipakai
  // sebagai id link node mindmap) supaya id yang sama berlaku di semua perangkat; tanpa client_id → cid baru.
  // Record lokal ber-cid/client_id sama sudah ditangkap findByClientId (diperlakukan sebagai record yang sama).
  // Pengaman bentrok: client_id yang sudah menjadi cid record lokal / baris lain di pass ini (`used`) atau sudah
  // dipetakan idmap ke server id lain → cid baru (resolver tetap menemukan record lewat fallback client_id).
  function freshCidFor(serverObj, used) {
    const clientId = serverObj && serverObj.client_id != null && serverObj.client_id !== "" ? String(serverObj.client_id) : null;
    if (!clientId || (used && used.has(clientId))) return Promise.resolve(TFids.newCid());
    return Promise.resolve(TFidmap.serverIdOf(clientId)).catch(() => null)
      .then((sid) => (sid != null && String(sid) !== String(serverObj.id) ? TFids.newCid() : clientId));
  }
  // client_id record yang ditulis pull dari baris server `s` (cur = record lokal sebelumnya): client_id lokal yang
  // sudah ada TIDAK ditimpa (bisa client_id segar "simpan sebagai baru" / buat ulang setelah 404 — dipakai payload
  // create untuk idempotensi); kosong → client_id server.
  function clientIdForWrite(s, cur) {
    if (cur && cur.client_id != null && cur.client_id !== "") return cur.client_id;
    return s && s.client_id != null && s.client_id !== "" ? String(s.client_id) : null;
  }
  // Backfill client_id (pola rememberClientId drawings): record lokal lama (cid acak, dibuat pull sebelum client_id
  // disimpan, client_id kosong) yang terpetakan ke baris server ber-client_id → setel client_id, TANPA mengubah dirty/rev (bukan edit;
  // push in-flight tetap valid). Termasuk record yang dilewati pull karena updated_at tidak berubah.
  function backfillClientIds(storeName, list, cache, getAll) {
    return getAll().then((fresh) => {
      const byCid = {}; for (const r of fresh) byCid[r.cid] = r;
      let chain = Promise.resolve();
      let n = 0;
      for (const s of list) {
        if (!s || s.client_id == null || s.client_id === "") continue;
        const want = String(s.client_id);
        const rec = byCid[cache[s.id]];
        if (!rec || rec.server_id == null || String(rec.server_id) !== String(s.id)) continue;
        if (rec.client_id != null && rec.client_id !== "") continue; // hanya mengisi yang kosong (lihat clientIdForWrite)
        chain = chain.then(() => TFdb.mutate(storeName, rec.cid, (cur) => {
          if (!cur || cur.server_id == null || String(cur.server_id) !== String(s.id)) return undefined;
          if (cur.client_id != null && cur.client_id !== "") return undefined;
          return Object.assign({}, cur, { client_id: want });
        })).then((saved) => { if (saved) n++; }, () => {});
      }
      return chain.then(() => n);
    });
  }
  function ensureCid(serverId, cache, serverObj, localAll, used, liveSids) {
    if (cache[serverId]) return Promise.resolve(cache[serverId]);
    return TFidmap.cidOf("task", serverId).then((cid) => {
      if (cid) { cache[serverId] = cid; if (used) used.add(cid); return cid; }
      const existing = findByClientId(localAll || [], serverObj, liveSids);
      return (existing ? Promise.resolve(existing.cid) : freshCidFor(serverObj, used)).then((fresh) => {
        cache[serverId] = fresh;
        if (used) used.add(fresh);
        return TFidmap.mapPut("task", serverId, fresh).then(() => fresh);
      });
    });
  }
  // Tulis record dari server lewat CAS (prinsip 4): hanya bila record masih seperti saat pull membacanya
  // (rev/dirty/deleted sama; atau tetap belum ada). Berubah selama pull (autosave/edit pengguna) → lewati,
  // pull berikutnya yang merekonsiliasi. Resolve true bila ditulis.
  function sameRecState(cur, local) {
    if (!local) return !cur;
    return !!cur && (cur.rev || 0) === (local.rev || 0) && !!cur.dirty === !!local.dirty && !!cur.deleted === !!local.deleted;
  }
  function putIfUnchanged(storeName, rec, local) {
    return TFdb.mutate(storeName, rec.cid, (cur) => (sameRecState(cur, local) ? rec : undefined)).then((saved) => !!saved);
  }
  // Field turunan server (kuadran dari cron Eisenhower, tanggal akhir/level notif recurring, completed_at) tidak
  // lagi mem-bump updated_at (K2) → diadopsi terpisah pada record bersih yang "tidak berubah" menurut base_rev.
  // PR 5: project/project_id ikut — backfill server menautkan project_id (dan mengkanonkan nama) tanpa
  // menaikkan updated_at.
  const TASK_DERIVED = ["quadrant", "recurrence_end_date", "recurrence_notif_level", "completed_at", "project", "project_id"];
  function adoptTaskDerived(s, local) {
    // project/project_id hanya bila server mengirimnya (dict lama/parsial tidak mengosongkan nilai lokal)
    const keys = TASK_DERIVED.filter((k) => (k !== "project" && k !== "project_id") || k in s);
    const diff = keys.some((k) => (s[k] != null ? s[k] : null) !== (local[k] != null ? local[k] : null));
    if (!diff) return Promise.resolve(false);
    return TFdb.mutate("tasks", local.cid, (cur) => {
      if (!sameRecState(cur, local)) return undefined;
      const next = Object.assign({}, cur);
      for (const k of keys) next[k] = s[k] != null ? s[k] : null;
      if (keys.indexOf("project_id") >= 0 || keys.indexOf("project") >= 0) {
        next.project_ref_name = next.project_id != null ? (next.project != null ? next.project : "") : null;
      }
      return next;
    }).then((saved) => !!saved);
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
    return getAllTasks()
      .then((pre) => {
        const used = new Set(pre.map((r) => r.cid)); // cid yang sudah terpakai (record lokal + baris di pass ini)
        const live = liveSidsOf(list);
        return list.reduce((p, s) => p.then(() => ensureCid(s.id, cache, s, pre, used, live)), Promise.resolve());
      })
      .then(() => Promise.all([getAllTasks(), TFoutbox.outboxAll()]))
      .then(([localAll, outboxOps]) => {
        const pendingTaskOps = new Set(outboxOps.filter((o) => o.entity_type === "task").map((o) => o.cid));
        const localByCid = {};
        for (const r of localAll) localByCid[r.cid] = r;
        const getCid = (sid) => cache[sid] || null;
        // rev (prinsip 4) ikut naik saat pull menimpa record: push in-flight yang membaca rev lama tidak akan
        // menandai hasil pull ini "bersih" dengan sentRev-nya. Penulisan lewat CAS (putIfUnchanged): record yang
        // berubah selama pull (edit pengguna) tidak ditimpa.
        const fromServer = (s, localRec) => {
          const rec = Object.assign(TFhydrate.taskFromServer(s, getCid), { rev: localRec ? (localRec.rev || 0) + 1 : 0 });
          const clientId = clientIdForWrite(s, localRec);
          if (clientId != null) rec.client_id = clientId; else delete rec.client_id;
          return rec;
        };
        const write = (s, localRec, counter) => putIfUnchanged("tasks", fromServer(s, localRec), localRec)
          .then((wrote) => { if (wrote) result[counter]++; else result.skipped++; });
        const result = { created: 0, updated: 0, deleted: 0, skipped: 0, lwwResolved: 0, conflicts: 0, requeued: 0, derived: 0, clientIds: 0 };
        let chain = requeueDirtyWithoutOps("task", localAll, pendingTaskOps, result);
        for (const s of list) {
          const cid = cache[s.id];
          const localRec = localByCid[cid];
          chain = chain.then(() => {
            if (!localRec || (localRec.deleted && !pendingTaskOps.has(cid))) { return write(s, localRec, "created"); }
            if (localRec.conflict || localRec.sync_error) { result.skipped++; return; } // sync_error: tunggu "Coba lagi"/"Buang"
            if (localRec.dirty && pendingTaskOps.has(cid)) {
              // base_rev null = belum pernah sinkron: baris server berasal dari POST kita sendiri yang responsnya
              // hilang (dikenali lewat client_id) → bukan edit-vs-edit; lokal menang, op create (upsert idempoten
              // di server) mengirim isi lokal dan memetakan server_id.
              if (localRec.base_rev != null && s.updated_at !== localRec.base_rev) {
                // edit-vs-edit conflict → last-write-wins
                result.lwwResolved++;
                if (tsEpoch(s.updated_at) > tsEpoch(localRec.updated_at)) {
                  return dropOutbox("task", cid).then(() => write(s, localRec, "updated")); // server wins
                }
                return; // local wins — keep dirty, push will send
              }
              result.skipped++; return; // local pending, server unchanged
            }
            // dirty tanpa op sudah diantre ulang di atas (ada di pendingTaskOps) → tidak pernah sampai sini
            if (s.updated_at !== localRec.base_rev || localRec.deleted) { return write(s, localRec, "updated"); }
            // updated_at sama → hanya field turunan (kuadran cron, dsb.) yang mungkin berubah (K2)
            return adoptTaskDerived(s, localRec).then((adopted) => { if (adopted) result.derived++; });
          });
        }
        const serverIds = new Set(list.map((s) => String(s.id)));
        for (const r of localAll) {
          if (r.server_id == null) continue;
          // duplikat hantu: server id yang sama kini dipetakan ke cid lain (baris dikenali lewat client_id) →
          // buang salinan yang bersih; yang punya edit tertunda dibiarkan (sudah diantre ulang) sampai terkirim
          const expectedCid = cache[r.server_id];
          if (expectedCid && r.cid !== expectedCid) {
            if (!(r.dirty && !r.deleted)) chain = chain.then(() => deleteTask(r.cid));
            else chain = chain.then(() => { result.skipped++; });
            continue;
          }
          if (serverIds.has(String(r.server_id))) continue;
          chain = chain.then(() => {
            if (r.conflict || r.sync_error) { result.skipped++; return; }
            if (r.dirty && pendingTaskOps.has(r.cid)) {
              result.conflicts++;
              return TFdb.mutate("tasks", r.cid, (cur) => (cur ? Object.assign({}, cur, { conflict: "remote_deleted" }) : undefined));
            }
            return confirmGone(fetchOne, r.server_id).then((gone) => {
              if (!gone) { result.skipped++; return; }
              result.deleted++;
              return deleteTask(r.cid);
            });
          });
        }
        chain = chain.then(() => backfillClientIds("tasks", list, cache, getAllTasks)).then((n) => { result.clientIds += n; });
        return chain.then(() => result);
      });
  }

  function pullAndReconcile(rawFetch) {
    const fetchOne = (sid) => Promise.resolve(rawFetch("/api/tasks/" + sid)).then(goneOrJson).catch(() => null);
    return Promise.resolve(rawFetch("/api/tasks?include_done=true"))
      .then(listJsonOrThrow)
      .then((list) => pullTasks(list || [], fetchOne))
      // PR 5: segarkan cache project setelah pull task berhasil; gagal (offline/5xx) tidak menggagalkan pull
      .then((result) => (TFprojects && TFprojects.refresh
        ? Promise.resolve().then(() => TFprojects.refresh(rawFetch)).then(() => result, () => result)
        : result));
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
  function ensureHabitCid(serverId, cache, serverObj, localAll) {
    if (cache[serverId]) return Promise.resolve(cache[serverId]);
    return TFidmap.cidOf("habit", serverId).then((cid) => {
      if (cid) { cache[serverId] = cid; return cid; }
      // T11: baris hasil POST kita yang responsnya hilang dikenali lewat client_id → bukan duplikat hantu
      const existing = findByClientId(localAll || [], serverObj);
      const fresh = existing ? existing.cid : TFids.newCid();
      cache[serverId] = fresh;
      return TFidmap.mapPut("habit", serverId, fresh).then(() => fresh);
    });
  }

  function pullHabits(serverHabits) {
    const list = serverHabits || [];
    const cache = {};
    return getAllHabits()
      .then((pre) => list.reduce((p, h) => p.then(() => ensureHabitCid(h.id, cache, h, pre)), Promise.resolve()))
      .then(() => Promise.all([getAllHabits(), TFoutbox.outboxAll()]))
      .then(([localAll, outboxOps]) => {
        const pendingHabitOps = new Set(outboxOps.filter((o) => o.entity_type === "habit").map((o) => o.cid));
        const localByCid = {};
        for (const r of localAll) localByCid[r.cid] = r;
        const result = { created: 0, updated: 0, deleted: 0, skipped: 0, requeued: 0 };
        // dirty tanpa op → antre ulang (create/update), jangan timpa; sync_error/conflict → lewati
        let chain = requeueDirtyWithoutOps("habit", localAll, pendingHabitOps, result);
        const write = (h, cid, localRec, counter) => putIfUnchanged("habits",
            Object.assign(habitFromServer(h, cid), { rev: localRec ? (localRec.rev || 0) + 1 : 0 }), localRec)
          .then((wrote) => { if (wrote) result[counter]++; else result.skipped++; });
        for (const h of list) {
          const cid = cache[h.id];
          const localRec = localByCid[cid];
          chain = chain.then(() => {
            // tombstone tanpa op delete (DELETE ditolak permanen / op dibuang) → server masih punya habit-nya →
            // pulihkan dari server (log-nya kembali lewat pullHabitLogs); dulu record ini dilewati selamanya
            if (!localRec || (localRec.deleted && !pendingHabitOps.has(cid))) { return write(h, cid, localRec, "created"); }
            if (localRec.dirty || localRec.sync_error || localRec.conflict) { result.skipped++; return; }
            if (habitChanged(localRec, h)) { return write(h, cid, localRec, "updated"); }
            return;
          });
        }
        const serverIds = new Set(list.map((h) => String(h.id)));
        for (const r of localAll) {
          if (r.server_id == null) continue;
          const expectedCid = cache[r.server_id];
          if (expectedCid && r.cid !== expectedCid) { // duplikat hantu (lihat pullTasks)
            if (!(r.dirty && !r.deleted)) chain = chain.then(() => deleteHabitRec(r.cid));
            else chain = chain.then(() => { result.skipped++; });
            continue;
          }
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
              if (local.sync_error) { result.skipped++; return; } // ditolak server → tunggu penandaan ulang
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
        if (pendingByCid.has(r.cid) || r.sync_error) return; // belum terkirim / ditolak → bukan bukti absen
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
  function ensureNoteCid(serverId, cache, serverObj, liveSids) {
    if (cache[serverId]) return Promise.resolve(cache[serverId]);
    return TFidmap.cidOf("note", serverId).then((cid) => {
      if (cid) { cache[serverId] = cid; return cid; }
      return getAllNotes().then((allNotes) => {
        const clientId = serverObj && serverObj.client_id ? String(serverObj.client_id) : null;
        // salinan "simpan sebagai baru/pribadi" memakai client_id terpisah dari cid → cocokkan keduanya
        const existing = allNotes.find((n) => n.server_id != null && String(n.server_id) === String(serverId))
          || (clientId ? allNotes.find((n) => matchesClientId(n, serverObj, clientId, liveSids)) : undefined);
        if (existing && existing.cid) {
          cache[serverId] = existing.cid;
          return TFidmap.mapPut("note", serverId, existing.cid).then(() => existing.cid);
        }
        // cid client_id sudah dipakai note lain (terpetakan ke baris lain) → cid baru, jangan menimpa note itu
        const fresh = (clientId && !allNotes.some((n) => n.cid === clientId)) ? clientId : TFids.newCid();
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
  // Tulis versi server ke record lokal lewat TFdb.mutate (prinsip 4): rev lokal ikut naik supaya push in-flight
  // yang membaca rev lama tidak menandai hasil pull ini "bersih" dengan sentRev-nya (dulu rev hilang → 0).
  // CAS (prinsip 4): `local` = record saat pull membacanya (undefined = belum ada). Record yang berubah selama
  // pull (autosave editor: dirty + op) TIDAK ditimpa — pull berikutnya merekonsiliasi (sebagai edit-vs-edit).
  // Resolve true bila ditulis.
  function writeNote(s, cid, cache, extra, local) {
    return noteFromServer(s, cid, cache)
      .then((rec) => TFdb.mutate("scratchpad_notes", cid, (cur) => {
        if (local !== undefined && !sameRecState(cur, local)) return undefined;
        if (local === undefined && cur && (cur.dirty || (cur.rev || 0) > 0)) return undefined; // dibuat/diedit lokal selama pull
        return Object.assign(rec, extra || {}, { rev: cur ? (cur.rev || 0) + 1 : 0 });
      }))
      .then((saved) => (saved ? TFtag.setEntityTags("note", cid, s.tags || []).then(() => true) : false));
  }
  // Prinsip 7 (edit-vs-edit note): versi lokal yang dirty + punya op tertunda TIDAK dibuang/ditimpa — selalu
  // disimpan sebagai salinan konflik "(konflik) <judul>" dan record asli mengadopsi versi server + notice
  // conflict_copy (noterepo.keepLocalAsConflictCopy, satu transaksi; op asli dibuang di dalamnya).
  // Fallback (noterepo lama tanpa helper): LWW lama — server menang hanya bila lebih baru (+ notice overwritten).
  function noteEditConflict(s, cid, local, cache, result) {
    const editor = s.last_editor_display_name || s.last_editor_username || "Pengguna lain";
    const nr = noteRepo();
    if (nr && typeof nr.keepLocalAsConflictCopy === "function") {
      return nr.keepLocalAsConflictCopy(cid, s, { noteCidCache: cache, editor: editor }).then((r) => {
        if (!r) { result.skipped++; return; }
        if (r.copy) { result.conflictCopies++; result.changedCids.push(cid, r.copy.cid); }
        else { result.updated++; result.changedCids.push(cid); } // isi sama (gema PUT sendiri) → hanya base_rev maju
      });
    }
    if (tsEpoch(s.updated_at) > tsEpoch(local.updated_at)) {
      result.changedCids.push(cid);
      return dropOutbox("note", cid).then(() => writeNote(s, cid, cache, { notice: { kind: "overwritten", title: s.title, editor: editor } }, local));
    }
  }

  // fetchOne(serverId) opsional: GET /api/scratchpad/:id → body | {status:404|403} | null — konfirmasi sebelum hapus lokal.
  function pullNotes(serverNotes, fetchOne) {
    const list = (serverNotes || []);
    const cache = {};
    const live = liveSidsOf(list);
    return list.reduce((p, s) => p.then(() => ensureNoteCid(s.id, cache, s, live)), Promise.resolve())
      .then(() => Promise.all([getAllNotes(), TFoutbox.outboxAll()]))
      .then(([localAll, outboxOps]) => {
        const pendingNoteOps = new Set(outboxOps.filter((o) => o.entity_type === "note").map((o) => o.cid));
        const byCid = {}; for (const r of localAll) byCid[r.cid] = r;
        // changedCids: cid yang record lokalnya ditulis/dihapus pull ini (+ salinan konflik) → sync() mengirim
        // noteSaved {cids} supaya editor yang terbuka memuat ulang / menampilkan banner (T5).
        const result = { created: 0, updated: 0, deleted: 0, skipped: 0, lwwResolved: 0, conflictCopies: 0, pinned: 0, relinked: 0, listAdopted: 0, requeued: 0, changedCids: [] };
        let chain = requeueDirtyWithoutOps("note", localAll, pendingNoteOps, result);
        for (const s of list) {
          const cid = cache[s.id];
          const local = byCid[cid];
          chain = chain.then(() => {
            if (!local || (local.deleted && !pendingNoteOps.has(cid))) {
              return writeNote(s, cid, cache, undefined, local).then((wrote) => { if (wrote) { result.created++; result.changedCids.push(cid); } else result.skipped++; });
            }
            if (local.conflict || local.sync_error) { result.skipped++; return; }
            if (local.dirty && pendingNoteOps.has(cid)) {
              // base_rev null = belum pernah sinkron: baris server berasal dari POST kita sendiri yang responsnya
              // hilang (cocok lewat client_id) → bukan edit-vs-edit; lokal menang, op create (POST idempoten =
              // upsert di server) mengirim isi lokal.
              if (local.base_rev != null && s.updated_at !== local.base_rev) {
                // edit-vs-edit (prinsip 7): versi lokal → salinan konflik, record asli ← versi server (bukan LWW)
                result.lwwResolved++;
                return noteEditConflict(s, cid, local, cache, result);
              }
              result.skipped++; return;
            }
            // dirty tanpa op sudah diantre ulang di atas (ada di pendingNoteOps) → tidak pernah sampai sini
            if (s.updated_at !== local.base_rev || local.deleted) {
              return writeNote(s, cid, cache, local.notice ? { notice: local.notice } : undefined, local)
                .then((wrote) => { if (wrote) { result.updated++; result.changedCids.push(cid); } else result.skipped++; });
            }
            // updated_at sama, tapi server menautkan note yang kini punya cid lain secara lokal (mis. note dipulihkan
            // dari Sampah → dibuat ulang dengan cid baru): perbarui linked_to_cids saja (rekaman bersih saja).
            if (!local.dirty && linksStale(s, local, cache)) {
              return getNoteRec(cid).then((cur) => {
                if (!cur || cur.dirty || cur.deleted || !linksStale(s, cur, cache)) return;
                result.relinked++; result.changedCids.push(cid);
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
            // duplikat hantu: salinan bersih dibuang; yang punya edit tertunda dibiarkan sampai terkirim
            if (!(r.dirty && !r.deleted)) chain = chain.then(() => deleteNoteRec(r.cid));
            else chain = chain.then(() => { result.skipped++; });
            continue;
          }
          if (serverIds.has(String(r.server_id))) continue;
          chain = chain.then(() => {
            if (r.conflict || r.sync_error) { result.skipped++; return; }
            if (r.dirty && pendingNoteOps.has(r.cid)) {
              if (r.list_id != null) {
                result.skipped++;
                return TFdb.mutate("scratchpad_notes", r.cid, (cur) => (cur ? Object.assign({}, cur, { conflict: "remote_deleted" }) : undefined));
              }
              result.skipped++; return; // personal local-wins; push update→404→re-create
            }
            return confirmGone(fetchOne, r.server_id).then((gone) => {
              if (!gone) { result.skipped++; return; }
              result.deleted++; result.changedCids.push(r.cid);
              return deleteNoteRec(r.cid).then(() => TFidmap.mapDelete("note", r.server_id));
            });
          });
        }
        // pass 4: adopt server pinned for notes with no pending pin op (pin is orthogonal to updated_at), dan
        // K4: list_id server diadopsi walau updated_at sama (share/unshare hanya lewat PATCH /share; PUT tidak
        // mengirim list_id → nilai server selalu otoritatif, juga untuk record dirty). Lewat TFdb.mutate.
        chain = chain.then(() => {
          const pendingPin = new Set(outboxOps.filter((o) => o.entity_type === "note" && o.op === "pin").map((o) => o.cid));
          return getAllNotes().then((fresh) => {
            const freshByCid = {}; for (const r of fresh) freshByCid[r.cid] = r;
            let c2 = Promise.resolve();
            for (const s of list) {
              const cid = cache[s.id];
              const local = freshByCid[cid];
              if (!local || local.conflict || local.sync_error) continue;
              const adoptPin = !pendingPin.has(cid) && !!local.pinned !== !!s.pinned;
              const srvList = s.list_id != null ? s.list_id : null;
              const adoptList = !local.deleted && (local.list_id != null ? local.list_id : null) !== srvList;
              if (!adoptPin && !adoptList) continue;
              c2 = c2.then(() => TFdb.mutate("scratchpad_notes", cid, (cur) => {
                if (!cur) return undefined;
                const next = Object.assign({}, cur);
                if (adoptPin) { result.pinned++; next.pinned = !!s.pinned; }
                if (adoptList) { result.listAdopted++; next.list_id = srvList; }
                return next;
              }));
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
  function getMindmapRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("mindmaps", "readonly").objectStore("mindmaps").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
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
  // Hapus record mindmap hanya bila rev-nya masih `expectRev` dan tidak ada penanda then_restore_sid untuk cid-nya
  // (satu transaksi mindmaps + _outbox). Resolve true bila dihapus.
  function deleteMindmapRecIfUnchanged(cid, expectRev) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      let removed = false;
      const tx = db.transaction(["mindmaps", "_outbox"], "readwrite");
      const ms = tx.objectStore("mindmaps");
      const r = ms.get(cid);
      r.onsuccess = () => {
        const cur = r.result;
        if (!cur || (cur.rev || 0) !== expectRev) return;
        const all = tx.objectStore("_outbox").getAll();
        all.onsuccess = () => {
          const marker = (all.result || []).some((o) => o.entity_type === "mindmap" && o.cid === cid && o.op === "delete"
            && o.payload && o.payload.then_restore_sid != null);
          if (marker) return;
          ms.delete(cid);
          removed = true;
        };
      };
      tx.oncomplete = () => resolve(removed);
      tx.onerror = () => reject(tx.error);
    }));
  }
  function ensureMindmapCid(serverId, cache, serverObj, localAll, used, liveSids) {
    if (cache[serverId]) return Promise.resolve(cache[serverId]);
    return TFidmap.cidOf("mindmap", serverId).then((cid) => {
      if (cid) { cache[serverId] = cid; if (used) used.add(cid); return cid; }
      // T11: baris hasil POST kita yang responsnya hilang dikenali lewat client_id → bukan duplikat hantu
      const existing = findByClientId(localAll || [], serverObj, liveSids);
      return (existing ? Promise.resolve(existing.cid) : freshCidFor(serverObj, used)).then((fresh) => {
        cache[serverId] = fresh;
        if (used) used.add(fresh);
        return TFidmap.mapPut("mindmap", serverId, fresh).then(() => fresh);
      });
    });
  }
  // Record masih seperti saat dibaca pull (CAS rev/dirty/deleted; tanpa localRec → harus masih belum ada).
  function sameMindmapState(cur, local) {
    if (!local) return !cur;
    return !!cur && (cur.rev || 0) === (local.rev || 0) && !!cur.dirty === !!local.dirty && !!cur.deleted === !!local.deleted;
  }
  // Tulis baris server lengkap lewat TFdb.mutate (prinsip 4): rev naik (push in-flight yang membaca rev lama
  // tidak menandai hasil pull ini "bersih"); batal bila record berubah selama fetchOne (edit lokal selamat).
  // body tanpa id (null / {status:404|403} / body error) → bukan peta: jangan tulis apa pun. Resolve true bila ditulis.
  function writeMindmapFull(serverId, cid, fetchOne, extra, localRec) {
    return Promise.resolve(fetchOne(serverId)).then((fullRow) => {
      if (!(fullRow && fullRow.id != null)) return false;
      // peta tertaut: cid catatan lokal dari idmap (null bila catatan belum ter-pull → diisi pull berikutnya)
      const noteCidP = fullRow.source_note_id != null ? TFidmap.cidOf("note", fullRow.source_note_id) : Promise.resolve(null);
      return noteCidP.then((noteCid) => TFdb.mutate("mindmaps", cid, (cur) => {
        if (!sameMindmapState(cur, localRec)) return undefined;
        const rec = Object.assign(TFmm.recordFromServer(fullRow, cid), { rev: cur ? (cur.rev || 0) + 1 : 0 }, extra || {});
        if (noteCid != null) rec.source_note_cid = noteCid;
        const clientId = clientIdForWrite(fullRow, cur);
        if (clientId != null) rec.client_id = clientId; else delete rec.client_id;
        if (cur) {
          rec.pinned = !!cur.pinned; // pin lokal dipertahankan (op pin bisa tertunda); adopsi pin server di pass pin
          if (cur.source_note_cid != null) rec.source_note_cid = cur.source_note_cid; // peta tertaut: jangan putus dari catatan
        }
        return rec;
      })).then((saved) => !!saved);
    });
  }

  // serverList = GET /api/mindmaps (metadata, no data_json). fetchOne(serverId) = GET /api/mindmaps/:id (full).
  // confirmOne(serverId) opsional: body | {status:404|403} | null — konfirmasi per item sebelum hapus lokal
  // (tanpa confirmOne → perilaku lama: hilang dari daftar = hapus).
  // result.changed = [{cid, server_id}] record yang dibuat/diganti → sync() mengirim event mindmapSynced (T3).
  // opts.partial (pullMindmapOne / SSE): serverList BUKAN daftar lengkap → lewati pass "hilang dari daftar" dan
  // duplikat hantu untuk record di luar serverList (tidak ada hapus/konfirmasi).
  function pullMindmaps(serverList, fetchOne, confirmOne, opts) {
    const partial = !!(opts && opts.partial);
    const list = (serverList || []);
    const cache = {};
    return getAllMindmaps()
      .then((pre) => {
        const used = new Set(pre.map((r) => r.cid)); // cid yang sudah terpakai (record lokal + baris di pass ini)
        const live = liveSidsOf(list);
        return list.reduce((p, s) => p.then(() => ensureMindmapCid(s.id, cache, s, pre, used, live)), Promise.resolve());
      })
      .then(() => Promise.all([getAllMindmaps(), TFoutbox.outboxAll()]))
      .then(([localAll, outboxOps]) => {
        const pendingMindmapOps = new Set(outboxOps.filter((o) => o.entity_type === "mindmap").map((o) => o.cid));
        // Penanda then_restore_sid (syncpush): peta dipulihkan lokal, baris server masih di Sampah sampai POST restore
        // berhasil → tidak ada di daftar & GET satuan 404. Lokal menang (dirty atau tidak) — jangan konfirmasi/hapus.
        const restoreMarkerCids = new Set(outboxOps.filter((o) => o.entity_type === "mindmap" && o.op === "delete"
          && o.payload && o.payload.then_restore_sid != null).map((o) => o.cid));
        const byCid = {}; for (const r of localAll) byCid[r.cid] = r;
        const result = { created: 0, updated: 0, deleted: 0, skipped: 0, lwwResolved: 0, conflictCopies: 0, merged: 0, pinned: 0, requeued: 0, clientIds: 0, changed: [] };
        const changed = (cid, sid) => { result.changed.push({ cid: cid, server_id: sid != null ? sid : null }); };
        let chain = requeueDirtyWithoutOps("mindmap", localAll, pendingMindmapOps, result);
        for (const s of list) {
          const cid = cache[s.id];
          const local = byCid[cid];
          chain = chain.then(() => {
            if (!local || (local.deleted && !pendingMindmapOps.has(cid))) {
              return writeMindmapFull(s.id, cid, fetchOne, undefined, local).then((wrote) => { if (wrote) { result.created++; changed(cid, s.id); } else result.skipped++; });
            }
            if (local.conflict || local.sync_error) { result.skipped++; return; }
            if (local.dirty && pendingMindmapOps.has(cid)) {
              // base_rev null = baris server hasil POST kita sendiri (respons hilang, dikenali lewat client_id) →
              // bukan edit-vs-edit; lokal menang, op create (upsert idempoten) yang mengirim isi lokal.
              if (local.base_rev != null && s.updated_at !== local.base_rev) {
                // Peta tertaut: data_json hanya view-state → last write wins, TANPA salinan konflik. Lewati;
                // push berikutnya mengirim view-state lokal (push peta tertaut tidak memakai REV_MISMATCH).
                if (TFmm.isLinked(local)) { result.skipped++; return; }
                // Penanda then_restore_sid (Sampah, PR A): push yang memulihkan baris server dulu; jangan sentuh.
                if (restoreMarkerCids.has(cid)) { result.skipped++; return; }
                // Edit-vs-edit (T3 / prinsip 7, #4): BUKAN LWW — merge tiga arah per node (basis sah) → record =
                // hasil merge + op update; bentrok node yang sama / tanpa basis sah → salinan konflik versi lokal
                // "(konflik) <judul>" (op create), record asli memegang nilai server.
                return Promise.resolve(fetchOne(s.id)).then((fullRow) => {
                  if (!(fullRow && fullRow.id != null)) { result.skipped++; return; }
                  return TFmm.mergeServerIntoLocal(cid, fullRow, { expectRev: local.rev || 0 }).then((out) => {
                    if (!out) { result.skipped++; return; } // berubah selama fetch → pull berikutnya
                    if (out.merged) result.merged++;
                    if (out.copy) {
                      result.conflictCopies++; changed(out.copy.cid, null);
                      // #4: salinan konflik dari pull → UI memberi toast (lihat index.html "mindmapConflictCopy")
                      const ev = TFmm.conflictCopyDetail ? TFmm.conflictCopyDetail(out, fullRow, "pull") : null;
                      if (ev) dispatchMindmapEvent("mindmapConflictCopy", ev);
                    }
                    changed(cid, s.id);
                  });
                });
              }
              result.skipped++; return; // local pending, server unchanged
            }
            // dirty tanpa op sudah diantre ulang di atas (ada di pendingMindmapOps) → tidak pernah sampai sini
            if (s.updated_at !== local.base_rev || local.deleted) {
              return writeMindmapFull(s.id, cid, fetchOne, local.notice ? { notice: local.notice } : undefined, local)
                .then((wrote) => { if (wrote) { result.updated++; changed(cid, s.id); } else result.skipped++; });
            }
            return;
          });
        }
        const serverIds = new Set(list.map((s) => String(s.id)));
        for (const r of (partial ? [] : localAll)) {
          if (r.server_id == null) continue;
          const expectedCid = cache[r.server_id];
          if (expectedCid && r.cid !== expectedCid) { // duplikat hantu (lihat pullTasks)
            if (!(r.dirty && !r.deleted)) chain = chain.then(() => deleteMindmapRec(r.cid));
            else chain = chain.then(() => { result.skipped++; });
            continue;
          }
          if (serverIds.has(String(r.server_id))) continue;
          chain = chain.then(() => {
            if (r.conflict || r.sync_error) { result.skipped++; return; }
            if (restoreMarkerCids.has(r.cid)) { result.skipped++; return; }
            if (r.dirty && pendingMindmapOps.has(r.cid)) {
              if (r.list_id != null && !TFmm.isLinked(r)) { // peta tertaut (bisa ber-list_id di workspace bersama): push yang memutuskan (recreateLinked / drop)
                result.skipped++;
                return TFdb.mutate("mindmaps", r.cid, (cur) => (cur ? Object.assign({}, cur, { conflict: "remote_deleted" }) : undefined));
              }
              result.skipped++; return; // personal local-wins; push update→404→re-create
            }
            return confirmGone(confirmOne, r.server_id).then((gone) => {
              if (!gone) { result.skipped++; return; }
              // bersyarat: record tidak berubah selama konfirmasi (rev sama) & tidak ada penanda restore baru
              return deleteMindmapRecIfUnchanged(r.cid, r.rev || 0).then((removed) => {
                if (!removed) { result.skipped++; return; }
                result.deleted++;
                changed(r.cid, r.server_id);
                return TFidmap.mapDelete("mindmap", r.server_id);
              });
            });
          });
        }
        // peta tertaut yang ditarik sebelum catatannya: isi source_note_cid begitu idmap catatan mengenalnya.
        chain = chain.then(() => getAllMindmaps()).then((fresh) => {
          const freshByCid = {}; for (const r of fresh) freshByCid[r.cid] = r;
          let c3 = Promise.resolve();
          for (const s of list) {
            if (s.source_note_id == null) continue;
            const cid = cache[s.id];
            const rec = freshByCid[cid];
            if (!rec || rec.deleted || rec.source_note_cid != null) continue;
            c3 = c3.then(() => TFidmap.cidOf("note", s.source_note_id)).then((noteCid) => {
              if (noteCid == null) return null;
              return TFdb.mutate("mindmaps", cid, (cur) => ((cur && cur.source_note_cid == null && !cur.deleted)
                ? Object.assign({}, cur, { source_note_cid: noteCid, rev: (cur.rev || 0) + 1 })
                : undefined)).then((saved) => { if (saved) changed(cid, s.id); });
            });
          }
          return c3;
        });
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
                c2 = c2.then(() => TFdb.mutate("mindmaps", cid, (cur) => ((cur && (cur.rev || 0) === (local.rev || 0))
                  ? Object.assign({}, cur, { pinned: !!s.is_pinned, rev: (cur.rev || 0) + 1 })
                  : undefined)).then((saved) => { if (saved) result.pinned++; }));
              }
            }
            return c2;
          });
        });
        chain = chain.then(() => backfillClientIds("mindmaps", list, cache, getAllMindmaps)).then((n) => { result.clientIds += n; });
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
    return Promise.resolve(rawFetch("/api/mindmaps?linked=1"))
      .then(listJsonOrThrow)
      .then((listRows) => pullMindmaps(listRows || [], fetchOne, confirmOne))
      .then((res) => pullMindmapTrash(rawFetch).catch(() => null).then(() => res));
  }

  // Tarik SATU peta (sinyal SSE / live update, #4): GET /api/mindmaps/{sid}.
  //   404/403 → record lokal bersih dihapus (+ idmap) kecuali ditahan penanda then_restore_sid; dirty/konflik dibiarkan
  //   (push yang memutuskan). Gagal lain (offline/5xx/throw) → tidak ada perubahan.
  //   body → pullMindmaps([body], …, {partial:true}): merge/adopsi seperti pull penuh, tanpa menghapus peta lain.
  // Resolve {changed:[{cid, server_id}], merged, deleted, dirty} — dirty = record lokal masih punya edit tertunda.
  function pullMindmapOne(rawFetch, sid) {
    const empty = () => ({ changed: [], merged: 0, deleted: 0, dirty: false });
    return Promise.resolve()
      .then(() => rawFetch("/api/mindmaps/" + sid))
      .then(goneOrJson)
      .catch(() => null)
      .then((body) => {
        if (!body || typeof body !== "object") return empty();
        if (body.id == null && (body.status === 404 || body.status === 403)) {
          return TFidmap.cidOf("mindmap", sid).then((cid) => {
            if (cid == null) return empty();
            return getMindmapRaw(cid).then((rec) => {
              if (!rec) return TFidmap.mapDelete("mindmap", sid).then(empty);
              if (rec.dirty || rec.conflict || rec.sync_error) return Object.assign(empty(), { dirty: !!rec.dirty });
              // bersyarat (rev sama, tanpa penanda then_restore_sid) — sama seperti pass "hilang dari daftar"
              return deleteMindmapRecIfUnchanged(cid, rec.rev || 0).then((removed) => {
                if (!removed) return empty();
                return TFidmap.mapDelete("mindmap", sid)
                  .then(() => ({ changed: [{ cid: cid, server_id: sid }], merged: 0, deleted: 1, dirty: false }));
              });
            });
          });
        }
        if (body.id == null) return empty();
        const meta = Object.assign({}, body);
        return pullMindmaps([meta], () => Promise.resolve(body), null, { partial: true }).then((res) =>
          TFidmap.cidOf("mindmap", body.id).then((cid) => (cid == null ? null : getMindmapRaw(cid))).then((rec) => ({
            changed: res.changed, merged: res.merged || 0, deleted: 0, dirty: !!(rec && rec.dirty),
          })));
      });
  }

  // Sampah mindmap (A4/A5): GET /api/mindmaps/trash → cermin di _meta (TF.mindmaptrash). Gagal (offline/401/5xx/
  // body bukan daftar valid) → {mirrored:false}, cermin lama dipertahankan.
  function mindmapTrash() {
    try { return isNode ? require("./mindmaptrash.js") : (root.TF && root.TF.mindmaptrash); } catch (_) { return null; }
  }
  function pullMindmapTrash(rawFetch) {
    return Promise.resolve()
      .then(() => rawFetch("/api/mindmaps/trash"))
      .then(listJsonOrThrow)
      .then((rows) => {
        const T = mindmapTrash();
        if (!T || !T.writeMirror) return { mirrored: false };
        return T.writeMirror(Array.isArray(rows) ? rows : []).then(() => ({ mirrored: true }));
      })
      .catch(() => ({ mirrored: false }));
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
  // Buang blob lama yang tidak lagi dirujuk record (blob_ref / base_blob_ref bisa berbagi id — T2).
  function releaseBlobs(refs, keep) {
    if (TFrepo && TFrepo.releaseBlobs) return TFrepo.releaseBlobs(refs, keep);
    const keepSet = new Set((keep || []).filter(Boolean));
    return (refs || []).filter((r) => r && !keepSet.has(r)).reduce((p, r) => p.then(() => dropBlob(r)), Promise.resolve());
  }
  const refsOf = (rec) => (rec ? [rec.blob_ref, rec.base_blob_ref] : []);
  // Hapus record hanya bila tidak berubah sejak dibaca (CAS); blob (+ blob dasar) ikut dibuang. Resolve true bila terhapus.
  function deleteDrawingIfUnchanged(cid, expect) {
    let refs = [];
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      let done = false;
      const tx = db.transaction("drawings", "readwrite");
      const os = tx.objectStore("drawings");
      const r = os.get(cid);
      r.onsuccess = () => {
        const cur = r.result;
        if (!cur || !sameDrawingState(cur, expect)) return;
        refs = refsOf(cur);
        os.delete(cid);
        done = true;
      };
      tx.oncomplete = () => resolve(done);
      tx.onerror = () => reject(tx.error);
    })).then((done) => (done ? releaseBlobs(refs, []).then(() => true) : false));
  }
  function writeDrawing(s, cid, localRec) {
    const dataJson = s.data_json;
    // Detail server gagal diambil & tidak ada data lokal → record data_missing (tanpa placeholder "{}",
    // base_rev null supaya pull/getDrawing berikutnya mengambil ulang). Placeholder dulu terbuka sebagai
    // kanvas kosong yang bisa diedit lalu menimpa gambar server.
    const missing = dataJson == null && !(localRec && localRec.blob_ref);
    const blobP = (dataJson != null && BlobStore) ? BlobStore.put(dataJson, { mime: "application/json" }) : Promise.resolve(null);
    return blobP.then((newRef) => {
      let oldRefs = [];
      return TFrepo.mutateDrawing(cid, (cur) => {
        if (!sameDrawingState(cur, localRec)) return undefined;
        const keepRef = cur ? cur.blob_ref : null;
        oldRefs = refsOf(cur);
        const rec = Object.assign(drawingFromServer(s, cid), {
          blob_ref: newRef || keepRef,
          rev: cur ? (cur.rev || 0) + 1 : 0,
          svg_stale: 0,
          data_missing: missing ? 1 : 0,
        });
        if (missing) rec.base_rev = null;
        // T2: data server yang diadopsi = snapshot dasar (berbagi blob dengan blob_ref; tanpa data → dasar kosong)
        rec.base_blob_ref = missing ? null : rec.blob_ref;
        rec.base_title = rec.title;
        // pin lokal dipertahankan (bisa ada op pin tertunda); adopsi pin server dilakukan Pass 5 yang mengecek op
        if (cur) rec.is_pinned = cur.is_pinned ? 1 : 0;
        // client_id server (cid mesin pembuat = id di direktif note) → getRaw bisa menemukan record ini
        const clientId = s.client_id || (cur && cur.client_id);
        if (clientId && clientId !== cid) rec.client_id = clientId;
        return rec;
      }).then((saved) => {
        if (!saved) return dropBlob(newRef).then(() => false);
        return Promise.all([
          releaseBlobs(oldRefs, refsOf(saved)),
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

  // Serialisasi kanonik (kunci terurut) → kesetaraan isi tanpa peduli urutan kunci.
  function canon(v) {
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    if (v && typeof v === "object") {
      return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
    }
    return JSON.stringify(v === undefined ? null : v);
  }
  function deepEqual(a, b) { return a === b || canon(a) === canon(b); }

  // Gabung dua nilai; `baseVal` (opsional, T2) = nilai pada snapshot dasar → merge 3-arah per field:
  //   sisi yang SAMA dengan dasar kalah dari sisi yang berubah; keduanya berubah → preferRemote menentukan;
  //   field ada di dasar tapi hilang di satu sisi dan tidak berubah di sisi lain → dihapus.
  // Tanpa dasar (undefined) → perilaku union lama (kunci di salah satu sisi selalu bertahan).
  function deepMerge(localVal, remoteVal, opts, baseVal) {
    const preferRemote = !!(opts && opts.preferRemote);

    if (localVal === undefined) return remoteVal;
    if (remoteVal === undefined) return localVal;
    if (localVal === remoteVal) return localVal;

    if (isPlainObject(localVal) && isPlainObject(remoteVal)) {
      const base = isPlainObject(baseVal) ? baseVal : null;
      const merged = {};
      const keys = new Set([...Object.keys(localVal), ...Object.keys(remoteVal)]);
      for (const k of keys) {
        const inL = k in localVal, inR = k in remoteVal;
        if (inL && inR) {
          merged[k] = deepMerge(localVal[k], remoteVal[k], opts, base ? base[k] : undefined);
        } else if (base && k in base) {
          // ada di dasar, hilang di satu sisi: sisi lain tidak mengubahnya → hapus menang; mengubahnya → perubahan menang
          const other = inL ? localVal[k] : remoteVal[k];
          if (!deepEqual(other, base[k])) merged[k] = other;
        } else {
          merged[k] = inL ? localVal[k] : remoteVal[k];
        }
      }
      return merged;
    }

    // Primitive or array collision
    if (deepEqual(localVal, remoteVal)) return localVal;
    if (baseVal !== undefined) {
      if (deepEqual(localVal, baseVal)) return remoteVal; // hanya remote yang berubah
      if (deepEqual(remoteVal, baseVal)) return localVal; // hanya lokal yang berubah
    }
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

  // Gabung snapshot tldraw lokal & remote. opts.base (T2, opsional) = snapshot dasar (versi pada base_rev):
  // record ada di dasar tapi hilang di satu sisi & tidak berubah di sisi lain → dihapus (coretan yang dihapus
  // tidak hidup lagi); hilang di satu sisi tapi BERUBAH di sisi lain → dipertahankan; ada di keduanya → merge
  // per field; tidak ada di dasar → tambahan (dipertahankan). Tanpa opts.base → union lama.
  function mergeDrawingSnapshots(localSnap, remoteSnap, opts) {
    const localObj = parseSnapshot(localSnap);
    const remoteObj = parseSnapshot(remoteSnap);

    const localData = extractSnapshotData(localObj);
    const remoteData = extractSnapshotData(remoteObj);
    const baseRaw = opts && opts.base != null ? opts.base : undefined;
    const baseData = baseRaw !== undefined ? extractSnapshotData(parseSnapshot(baseRaw)) : null;

    const format = remoteData.format || localData.format || "direct";
    const schema = remoteData.schema || localData.schema || undefined;
    const otherFields = Object.assign({}, localData.otherFields, remoteData.otherFields);

    const mergedRecords = deepMerge(localData.records, remoteData.records, opts, baseData && baseData.format ? baseData.records : undefined);

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

  // Record dirty + server berubah sejak base_rev → gabung data lokal & server lewat CAS rev.
  // T2: merge 3-arah terhadap snapshot dasar (base_blob_ref = versi pada base_rev) — coretan yang dihapus di satu
  // sisi tidak hidup lagi; tanpa dasar → union lama. Setelah merge, data REMOTE menjadi dasar baru (base_rev =
  // updated_at server). S3: judul — sisi yang berbeda dari dasar menang (rename lokal tidak hilang bila remote
  // hanya menambah coretan). S4: blob nyata ditulis → data_missing dibersihkan.
  function mergeDirtyDrawing(s, cid, local, fetchOne, result) {
    const fetchP = fetchOne ? Promise.resolve(fetchOne(s.id)).catch(() => null) : Promise.resolve(null);
    const readBlob = (ref) => ((ref && BlobStore) ? Promise.resolve(BlobStore.getBytes(ref)).catch(() => undefined) : Promise.resolve(undefined));
    const localDataJsonP = readBlob(local.blob_ref).then((b) => b || "{}");
    const baseJsonP = readBlob(local.base_blob_ref);
    return Promise.all([fetchP, localDataJsonP, baseJsonP]).then(([remoteFullRow, localDataJson, baseJson]) => {
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
      const hasBase = TFrepo.isTldrawSnapshot(baseJson);
      const mergedJson = mergeDrawingSnapshots(localDataJson, remoteDataJson, hasBase ? { preferRemote, base: baseJson } : { preferRemote });
      const remoteTitle = (remoteFull && remoteFull.title) || s.title || null;
      const localRenamed = local.base_title != null && local.title != null && local.title !== local.base_title;
      const remoteRenamed = local.base_title != null && remoteTitle != null && remoteTitle !== local.base_title;
      const mergedTitle = (localRenamed && !remoteRenamed) ? local.title : (remoteTitle || local.title || "Untitled Drawing");
      const mergedSvg = (remoteFull && remoteFull.svg_preview) || s.svg_preview || local.svg_preview || "";
      const readRev = local.rev || 0;
      const sameData = TFrepo.sameContent(mergedJson, localDataJson);
      // Dasar baru = data remote: berbagi blob lokal bila isinya sama (gema push yang responsnya hilang), else blob baru.
      const remoteIsLocal = TFrepo.sameContent(remoteDataJson, localDataJson);
      const baseBlobP = (!remoteIsLocal && BlobStore) ? BlobStore.put(remoteDataJson, { mime: "application/json" }) : Promise.resolve(null);
      if (sameData && mergedTitle === local.title) {
        // Server tidak menambah apa pun (mis. gema push kita sendiri) → cukup catat base_rev (+ dasar baru).
        return baseBlobP.then((newBaseRef) => {
          let oldRefs = [];
          return TFrepo.mutateDrawing(cid, (cur) => {
            if (!cur || cur.deleted || (cur.rev || 0) !== readRev || cur.base_rev !== local.base_rev) return undefined;
            oldRefs = [cur.base_blob_ref];
            return Object.assign({}, cur, {
              base_rev: s.updated_at, server_id: cur.server_id != null ? cur.server_id : s.id,
              base_blob_ref: newBaseRef || cur.blob_ref, base_title: remoteTitle != null ? remoteTitle : cur.base_title,
            });
          }).then((saved) => {
            if (!saved) { result.skipped++; return dropBlob(newBaseRef); }
            result.merged++;
            return releaseBlobs(oldRefs, refsOf(saved));
          });
        });
      }
      const blobP = BlobStore ? BlobStore.put(mergedJson, { mime: "application/json" }) : Promise.resolve(null);
      return Promise.all([blobP, baseBlobP]).then(([newBlobRef, newBaseRef]) => {
        let oldRefs = [];
        return TFrepo.mutateDrawing(cid, (cur) => {
          // CAS: rev (edit lokal) DAN base_rev (push selesai selama pull) harus sama dengan saat dibaca
          if (!cur || cur.deleted || (cur.rev || 0) !== readRev || cur.base_rev !== local.base_rev) return undefined;
          oldRefs = refsOf(cur);
          return Object.assign({}, cur, {
            server_id: cur.server_id != null ? cur.server_id : s.id,
            blob_ref: newBlobRef,
            title: mergedTitle,
            svg_preview: mergedSvg,
            svg_stale: 1,
            data_missing: 0,
            base_rev: s.updated_at,
            base_blob_ref: newBaseRef || cur.blob_ref,
            base_title: remoteTitle != null ? remoteTitle : cur.base_title,
            dirty: 1,
            rev: readRev + 1,
          });
        }).then((saved) => {
          if (!saved) { result.skipped++; return releaseBlobs([newBlobRef, newBaseRef], []); }
          return Promise.all([
            releaseBlobs(oldRefs, refsOf(saved)),
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
              // sync_error (T13) / conflict (S2) → jangan antre ulang; biarkan sampai pengguna memutuskan.
              chain = chain.then(() => ((r.sync_error || r.conflict) ? null : TFrepo.ensureDrawingUpdateOp(r.cid, { title: r.title, svg_preview: r.svg_preview || "", is_pinned: r.is_pinned ? 1 : 0 })))
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
    pullMindmaps, pullMindmapsAndReconcile, pullMindmapOne, pullMindmapTrash,
    pullDrawings, pullDrawingsAndReconcile,
    mergeDrawingSnapshots,
    tsEpoch, ensureNoteCid, listJsonOrThrow, goneOrJson,
  };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.syncpull = exported; }
  return exported;
});
