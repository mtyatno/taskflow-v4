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
  const TFids = req("./ids.js", root.TF && root.TF.ids);
  const TFtag = req("./tagrepo.js", root.TF && root.TF.tagrepo);
  const TFblob = req("./blobstore.js", root.TF && root.TF.blobstore);
  const TFrepo = req("./drawingrepo.js", root.TF && root.TF.drawingrepo);
  // noterepo: salinan konflik (prinsip 7) & rewrite [tasklink:cid] (S15). Dibaca malas: di browser modul lama
  // dari cache SW bisa tanpa fungsi itu → jalur lama tetap dipakai.
  function noteRepo() {
    try { return isNode ? require("./noterepo.js") : (root.TF && root.TF.noterepo); } catch (_) { return null; }
  }
  const TFmm = req("./mindmaprepo.js", root.TF && root.TF.mindmaprepo);
  const TFprojects = req("./projectcache.js", root.TF && root.TF.projectcache);
  // Kanban tahap: cache context (dimuat sebelum syncpush di index.html; dicek per fungsi karena modul lama dari
  // cache SW bisa belum memilikinya).
  const TFcontexts = req("./contextcache.js", root.TF && root.TF.contextcache);
  // Sampah mindmap (A4) dibaca malas: modul lama dari cache SW bisa belum memuatnya.
  function mindmapTrash() {
    try { return isNode ? require("./mindmaptrash.js") : (root.TF && root.TF.mindmaptrash); } catch (_) { return null; }
  }

  function titleWithTags(record, tagNames) {
    const base = String(record.title == null ? "" : record.title).replace(/\s+$/, "");
    return base + (tagNames || []).map((t) => " #" + t).join("");
  }

  // T11 (prinsip 6): client_id untuk idempotensi create — server mengembalikan baris yang sudah ada bila
  // (user_id, client_id) cocok (retry setelah respons hilang tidak menduplikasi). Salinan "simpan sebagai
  // baru/pribadi" (syncconflict) memakai `client_id` terpisah yang segar supaya server tidak mengembalikan
  // baris LAMA; cid tetap kunci lokal.
  function clientIdOf(record) {
    return record.client_id || record.cid || null;
  }

  // PR 5: `projects` = item cache project (opsional; tanpa cache → teks saja). Aturan project_id ada di
  // projectcache.payloadProjectId (F1: id yang masih terikat ke teks record dikirim walau cache sudah
  // menunjukkan rename/hapus, supaya server tidak membuat ulang project bernama lama).
  function withProjectId(payload, record, projects) {
    const pid = TFprojects && projects ? TFprojects.payloadProjectId(record, projects) : null;
    if (pid != null) payload.project_id = pid;
    return payload;
  }
  function projectItems() {
    return TFprojects && TFprojects.allItems ? TFprojects.allItems().catch(() => []) : Promise.resolve([]);
  }
  // Kanban tahap: `context_id` SELALU ada di payload (null = server me-resolve dari teks `context`). Aturan
  // ada di contextcache.payloadContextId (F1; cid pending tidak pernah dikirim). Op yang context_id-nya cid
  // tahap yang create-nya masih antre DITAHAN oleh pemanggil (contextHeld), bukan dikirim dengan null.
  function withContextId(payload, record, contexts) {
    const cid = TFcontexts && TFcontexts.payloadContextId && contexts ? TFcontexts.payloadContextId(record, contexts) : null;
    payload.context_id = cid != null ? cid : null;
    return payload;
  }
  function contextItems() {
    return TFcontexts && TFcontexts.allItems ? TFcontexts.allItems().catch(() => []) : Promise.resolve([]);
  }
  function isServerIdLike(id) {
    return id != null && /^\d+$/.test(String(id));
  }
  // T10 untuk tahap: context_id = cid lokal yang op create-nya masih di outbox saat drain dimulai → tahan.
  function contextHeld(rec, pending) {
    return !!(rec && rec.context_id != null && !isServerIdLike(rec.context_id) && parentCreatePending(pending, String(rec.context_id)));
  }

  // Buat ulang setelah PUT 404 (baris server sid sudah dihapus): JANGAN memakai client_id asli — perangkat lain yang
  // membuat ulang baris yang sama memakai client_id itu juga, sehingga server (idempoten per client_id) akan
  // mengembalikan baris perangkat lain dan edit lokal teradopsi ke sana lalu hilang. client_id segar dicatat sekali
  // per sid (recreate_of_sid) supaya retry setelah respons hilang tetap idempoten. dirty/rev tidak diubah.
  // Resolve record terkini (dengan client_id segar) atau null bila record hilang.
  function freshRecreateClientId(storeName, cid, sid) {
    let kept = null;
    return TFdb.mutate(storeName, cid, (cur) => {
      if (!cur) return undefined;
      if (cur.recreate_of_sid != null && String(cur.recreate_of_sid) === String(sid) && cur.client_id) { kept = cur; return undefined; }
      return Object.assign({}, cur, { client_id: TFids.newCid(), recreate_of_sid: sid });
    }).then((saved) => saved || kept);
  }

  function taskToCreatePayload(record, tagNames, parentServerId, projects, contexts) {
    return withContextId(withProjectId({
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
      client_id: clientIdOf(record),
    }, record, projects), record, contexts);
  }

  function taskToUpdatePayload(record, tagNames, projects, contexts) {
    const p = {
      title: titleWithTags(record, tagNames),
      description: record.description != null ? record.description : "",
      priority: record.priority || "P3",
      project: record.project != null ? record.project : "",
      context: record.context != null ? record.context : "",
      // PUT ignores a null deadline; "" is how the server clears it.
      deadline: record.deadline != null ? record.deadline : "",
      gtd_status: record.gtd_status || "inbox",
      waiting_for: record.waiting_for != null ? record.waiting_for : "",
      assigned_to: record.assigned_to != null ? record.assigned_to : null,
      progress: record.progress != null ? record.progress : 0,
      // K6: status fokus (POST /focus dilayani lokal) harus sampai ke server
      is_focused: record.is_focused ? true : false,
      recurrence_type: record.recurrence_type != null ? record.recurrence_type : null,
      recurrence_days: record.recurrence_days ? JSON.parse(record.recurrence_days) : null,
    };
    // T12: "Perpanjang" hanya berlaku di server lewat flag; flag dibersihkan setelah PUT sukses (CAS)
    if (record.recurrence_renew_pending) p.recurrence_renew = true;
    return withContextId(withProjectId(p, record, projects), record, contexts);
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
      client_id: clientIdOf(record),
    };
  }
  function habitToUpdatePayload(record, tagNames) {
    const p = habitToCreatePayload(record, tagNames);
    delete p.client_id;
    return p;
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
      list_id: record.list_id != null ? record.list_id : null,
      meta_json: record.meta_json != null ? record.meta_json : '{}',
      client_id: clientIdOf(record),
    };
  }
  // PUT note: TANPA list_id (K4 — absen = server tidak mengubahnya; share/unshare hanya lewat PATCH /share,
  // jadi list_id lokal yang basi tidak pernah meng-unshare / me-re-share catatan) dan TANPA client_id.
  // base_rev (revisi server yang diketahui) disertakan bila ada → server menjawab 409 REV_MISMATCH bila baris
  // sudah berubah (prinsip 7), bukan menimpa versi orang lain.
  function noteToUpdatePayload(record, tagNames, taskServerIds) {
    const p = noteToCreatePayload(record, tagNames, taskServerIds);
    delete p.list_id;
    delete p.client_id;
    if (record.base_rev != null && record.base_rev !== "") p.base_rev = record.base_rev;
    return p;
  }

  const MM_DEFAULT_DATA = '{"nodeData":{"id":"root","topic":"Untitled","root":true,"children":[]}}';
  // Peta tertaut (Petakan): judul tidak boleh kosong (R15); create membawa `source_note_id` = id server catatan
  // (`noteSid`, di-resolve saat push; fallback record.source_note_id). Update tertaut TANPA base_rev (server
  // mengabaikannya; data_json hanya view-state, tidak ada konflik).
  // Create tertaut tanpa id server catatan TIDAK PERNAH dikirim (R15): pemanggil wajib menahan op lebih dulu;
  // builder melempar sebagai pengaman (op tetap antre, drain lanjut).
  function mindmapBasePayload(record) {
    return {
      title: TFmm.isLinked(record) ? (record.title || "Tanpa judul") : (record.title != null ? record.title : "Untitled"),
      data_json: record.data_json != null ? record.data_json : MM_DEFAULT_DATA,
      list_id: record.list_id != null ? record.list_id : null,
    };
  }
  function mindmapToCreatePayload(record, noteSid) {
    const p = mindmapBasePayload(record);
    p.client_id = clientIdOf(record);
    if (TFmm.isLinked(record)) {
      const nsid = noteSid != null ? noteSid : record.source_note_id;
      if (nsid == null) throw new Error("linked mindmap create without source_note_id");
      p.source_note_id = nsid;
    }
    return p;
  }
  function mindmapToUpdatePayload(record) {
    const p = mindmapBasePayload(record);
    if (TFmm.isLinked(record)) return p;
    // T3 / prinsip 7: revisi server yang diketahui klien → server menjawab 409 REV_MISMATCH bila sudah berubah
    if (record.base_rev != null) p.base_rev = record.base_rev;
    return p;
  }

  function getTaskRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("tasks", "readonly").objectStore("tasks").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }

  function getHabitRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("habits", "readonly").objectStore("habits").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
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

  // ── Klasifikasi respons push (prinsip 3 rencana audit 2026-10-15) ──────────────────────────────
  //   "ok"        2xx
  //   "auth"      401 → drain berhenti, op tetap, event tf:auth-expired (sesi berakhir ≠ ganti pengguna)
  //   "retry"     429 / 5xx / timeout → op tetap antre, op lain tetap dikirim
  //   "forbidden" 403 → conflict "access_lost" (bukan hapus lokal)
  //   "gone"      404 → remote_deleted / re-create (per entitas)
  //   "permanent" 400 / 409 / 413 / 422 / 4xx lain → op dibuang, record tetap dirty + sync_error
  function classify(res) {
    if (!res || typeof res.status !== "number") return "retry";
    const st = res.status;
    if (st >= 200 && st < 300) return "ok";
    if (st === 401) return "auth";
    if (st === 429 || st >= 500) return "retry";
    if (st === 403) return "forbidden";
    if (st === 404) return "gone";
    return "permanent";
  }
  function errDetail(res) {
    const d = res && res.data && res.data.detail;
    let s = "";
    if (typeof d === "string") s = d;
    else if (Array.isArray(d)) s = d.map((e) => (e && e.msg) || (typeof e === "string" ? e : JSON.stringify(e))).join(", ");
    else if (d != null) { try { s = JSON.stringify(d); } catch (_) { s = String(d); } }
    return s.length > 200 ? s.slice(0, 200) + "…" : s;
  }
  // Tandai sync_error pada record (satu transaksi baca-ubah-tulis; dirty TIDAK diubah) → muncul di conflict bar
  // ("Coba lagi" / "Buang perubahan lokal"). Pull melewati record ber-sync_error (tidak ditimpa, tidak dihapus).
  function markSyncError(storeName, cid, res) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const os = tx.objectStore(storeName);
      const r = os.get(cid);
      r.onsuccess = () => {
        const cur = r.result;
        if (!cur) return;
        os.put(Object.assign({}, cur, {
          sync_error: { status: res && res.status != null ? res.status : null, detail: errDetail(res), at: new Date().toISOString() },
        }));
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  // Error permanen: buang op (mengulang hanya akan gagal lagi), record tetap dirty + sync_error.
  // storeName null (op tanpa record, mis. mark_occurrence/uncheck/pin) → op dibuang + dihitung gagal.
  function failPermanent(storeName, cid, res, op, result) {
    result.failed++;
    const markP = (storeName && cid != null) ? markSyncError(storeName, cid, res) : Promise.resolve();
    return markP.then(() => TFoutbox.outboxRemove(op.qid));
  }
  // 403: akses ke list hilang → conflict "access_lost" (konten lokal TIDAK dihapus), op dibuang.
  // Conflict bar menawarkan "Simpan sebagai baru" (keep_as_new) / "Buang" (discard).
  function accessLost(storeName, cid, op, result) {
    result.failed++;
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const os = tx.objectStore(storeName);
      const r = os.get(cid);
      r.onsuccess = () => {
        const cur = r.result;
        if (!cur) return;
        os.put(Object.assign({}, cur, { conflict: "access_lost" }));
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    })).then(() => TFoutbox.outboxRemove(op.qid));
  }
  function dispatchWindowEvent(name, detail) {
    try {
      const w = (typeof window !== "undefined") ? window : root;
      if (w && typeof w.dispatchEvent === "function" && typeof CustomEvent === "function") {
        w.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
      }
    } catch (_) {}
  }
  function dispatchAuthExpired() { dispatchWindowEvent("tf:auth-expired", { source: "syncpush" }); }
  // S15: task baru punya server id → [tasklink:<cid>] di note lokal diganti [tasklink:<sid>] (note jadi dirty +
  // op update). Gagal di sini tidak boleh menggagalkan op create-nya.
  function rewriteNoteTaskLinks(taskCid, sid) {
    const nr = noteRepo();
    if (!nr || typeof nr.rewriteTaskLinks !== "function") return Promise.resolve([]);
    return Promise.resolve().then(() => nr.rewriteTaskLinks(taskCid, sid)).catch(() => []);
  }

  // ── CAS/rev (prinsip 4) — helper bersama task / note / habit / habit_log (mindmap: workstream D) ────────
  // Epoch ms dari timestamp server; format SQLite "YYYY-MM-DD HH:MM:SS" dinormalkan ke "T" (S9), tanpa zona = UTC.
  function tsEpoch(ts) {
    if (ts == null) return 0;
    let s = String(ts).trim();
    const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(.*)$/.exec(s);
    if (m) s = m[1] + "T" + m[2] + m[3];
    const hasTz = /[zZ]|[+-]\d\d:?\d\d$/.test(s);
    const v = Date.parse(hasTz ? s : s + "Z");
    return isNaN(v) ? 0 : v;
  }
  // Timestamp server bisa bermikrodetik; Date.parse memotong ke milidetik → tambahkan digit sisanya.
  function tsPrecise(ts) {
    if (ts == null) return 0;
    const str = String(ts);
    const m = str.match(/T\d\d:\d\d:\d\d\.(\d+)/);
    const sub = (m && m[1].length > 3) ? Number("0." + m[1].slice(3)) : 0;
    return tsEpoch(str) + sub;
  }
  // true bila revisi server a LEBIH BARU dari b (b kosong = belum pernah sinkron → a dianggap lebih baru).
  function tsNewer(a, b) {
    if (a == null || a === "") return false;
    if (b == null || b === "") return true;
    return tsPrecise(a) > tsPrecise(b);
  }
  // Tandai record terkirim lewat CAS (satu transaksi baca-ubah-tulis, TIDAK pernah menulis objek yang dibaca
  // sebelum request):
  //   dirty      = 0 hanya bila rev masih sama dengan saat payload dibaca (`sentRev`) dan record belum dihapus;
  //                ada edit selama in-flight → tetap dirty (versi lokal yang lebih baru dikirim ulang).
  //   base_rev   hanya MAJU (pull bisa sudah mengadopsi revisi server yang lebih baru selama request).
  //   server_id  diisi bila masih kosong.
  //   adopt(next) (opsional) → menerapkan field turunan server (kuadran, tanggal akhir recurring, …) pada
  //                record baru, hanya bila rev tidak berubah — jangan menimpa field yang baru diedit pengguna.
  function markPushed(storeName, cid, sentRev, updatedAt, sid, adopt) {
    return TFdb.mutate(storeName, cid, (cur) => {
      if (!cur) return undefined;
      const next = Object.assign({}, cur);
      if (sid != null && next.server_id == null) next.server_id = sid;
      // base_rev maju ke revisi respons; dipertahankan hanya bila pull sudah mengadopsi revisi server yang
      // terbukti LEBIH BARU selama request. Timestamp yang tak terbaca (epoch 0) tidak bisa dibandingkan →
      // respons PUT/POST (otoritatif untuk record ini) yang dipakai.
      if (updatedAt != null && (tsNewer(updatedAt, cur.base_rev) || !tsPrecise(updatedAt) || !tsPrecise(cur.base_rev))) {
        next.base_rev = updatedAt;
      }
      const unchanged = (cur.rev || 0) === (sentRev || 0);
      next.dirty = (unchanged && !cur.deleted) ? 0 : 1;
      // request sukses = error permanen sebelumnya (mis. 422) sudah teratasi oleh edit terbaru → hapus tanda
      // sync_error supaya pull tidak lagi melewati record ini dan conflict bar tidak basi
      delete next.sync_error;
      // push ke baris server sukses = record tidak lagi sedang dibuat ulang (mis. PUT berhasil setelah baris asli
      // dipulihkan dari Sampah, sementara POST buat ulang yang responsnya hilang sempat membuat baris yatim)
      delete next.recreate_of_sid;
      if (unchanged && typeof adopt === "function") adopt(next);
      return next;
    });
  }
  function getRawOf(storeName, cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction(storeName, "readonly").objectStore(storeName).get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  // Pastikan ada op create/update untuk record (satu transaksi _outbox; tidak menggandakan bila sudah ada).
  function ensureEntityOp(entityType, rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      let added = false;
      const tx = db.transaction("_outbox", "readwrite");
      const os = tx.objectStore("_outbox");
      const r = os.getAll();
      r.onsuccess = () => {
        const ops = (r.result || []).filter((o) => o.entity_type === entityType && o.cid === rec.cid && (o.op === "create" || o.op === "update"));
        if (ops.length) return;
        os.add({ ts: Date.now(), retries: 0, entity_type: entityType, op: rec.server_id == null ? "create" : "update", cid: rec.cid, payload: {} });
        added = true;
      };
      tx.oncomplete = () => resolve(added);
      tx.onerror = () => reject(tx.error);
    }));
  }
  // Masih dirty setelah request sukses (ada edit selama in-flight) → pastikan ada op susulan agar versi
  // lokal yang lebih baru tetap terkirim (repo biasanya sudah mengantre op; ini jaring pengaman).
  function requeueIfDirty(storeName, entityType, cid) {
    return getRawOf(storeName, cid).then((cur) => (cur && cur.dirty && !cur.deleted && !cur.conflict && !cur.sync_error
      ? ensureEntityOp(entityType, cur)
      : false));
  }
  // Field turunan server yang diadopsi setelah POST/PUT task sukses (hanya bila rev tidak berubah, lihat markPushed).
  function taskAdopt(data) {
    return (next) => {
      const d = (data && typeof data === "object") ? data : {};
      delete next.recurrence_renew_pending; // T12: perpanjangan sudah diterima server
      if (d.quadrant != null) next.quadrant = d.quadrant;
      if ("recurrence_end_date" in d) next.recurrence_end_date = d.recurrence_end_date != null ? d.recurrence_end_date : null;
      if ("completed_at" in d) next.completed_at = d.completed_at != null ? d.completed_at : null;
      if ("recurrence_notif_level" in d) next.recurrence_notif_level = d.recurrence_notif_level != null ? d.recurrence_notif_level : null;
      // PR 5: server mengkanonkan nama project dan menautkan/mengabaikan project_id
      if ("project" in d) next.project = d.project != null ? d.project : "";
      if ("project_id" in d) next.project_id = d.project_id != null ? d.project_id : null;
      if ("project" in d || "project_id" in d) {
        next.project_ref_name = next.project_id != null ? (next.project != null ? next.project : "") : null;
      }
      // Kanban tahap: server me-resolve/mengkanonkan context → adopsi teks + id, nama ikatan mengikuti
      if ("context" in d) next.context = d.context != null ? d.context : "";
      if ("context_id" in d) next.context_id = d.context_id != null ? d.context_id : null;
      if ("context" in d || "context_id" in d) {
        next.context_ref_name = next.context_id != null ? (next.context != null ? next.context : "") : null;
      }
    };
  }
  function updatedAtOf(res) {
    return res && res.data && res.data.updated_at != null ? res.data.updated_at : null;
  }

  function send(transport, method, path, body) {
    return transport.request(method, path, body).then(
      (res) => {
        const kind = classify(res);
        if (kind === "auth") {
          // Token kedaluwarsa: hentikan drain (op tetap), minta login ulang — JANGAN buang data lokal.
          dispatchAuthExpired();
          const e = new Error("auth_expired");
          e.__auth = true;
          e.__network = false;
          e.status = res.status;
          throw e;
        }
        if (kind === "retry") {
          const e = new Error((res.status === 429 ? "rate_limited_" : "server_error_") + res.status);
          e.__network = false; // reached server, but 429/5xx: op tetap antre, lanjut op lain
          e.__retry = true;
          e.status = res.status;
          throw e;
        }
        return res;
      },
      (err) => {
        const e = new Error("network");
        e.__network = true;
        // batas waktu syncFetch habis (AbortError): satu request lambat, belum tentu jaringan putus
        if (err && err.name === "AbortError") e.__timeout = true;
        throw e;
      }
    );
  }
  function ok(res) { return res && res.status >= 200 && res.status < 300; }
  function tagsOf(cid, tagsFor) { return tagsFor(cid); }

  // T10: op yang bergantung pada create induk yang masih antre (server id belum ada) DITAHAN, bukan dibuang.
  // `pending` = Set cid yang punya op create/send di outbox saat drain dimulai (dihitung sekali di pushOutbox).
  // Induk selalu lebih dulu di FIFO (qid lebih kecil) → sukses: drain ini juga mengirim anaknya; 429/5xx/
  // timeout: anak ikut menunggu drain berikutnya. Create induk yang gagal permanen (sync_error) sudah tidak
  // punya op → set berikutnya tidak memuatnya → op anak dibuang (checkin/mark) atau dikirim tanpa induk
  // (task: parent_id null; chat: reply_to_id null) — tidak bisa deadlock.
  function parentCreatePending(pending, parentCid) {
    return !!(pending && parentCid && pending.has(parentCid));
  }

  function opCreate(op, transport, tagsFor, result, pending) {
    return getTaskRaw(op.cid).then((rec) => {
      if (!rec) return TFoutbox.outboxRemove(op.qid);
      if (rec.conflict) return; // held until user resolves the conflict
      if (rec.server_id != null) return TFoutbox.outboxRemove(op.qid);
      // dibuat lalu dihapus offline (belum pernah di-push): tidak perlu POST+DELETE; op delete-nya juga
      // berhenti sendiri (server_id null)
      if (rec.deleted) return TFoutbox.outboxRemove(op.qid);
      const parentP = rec.parent_cid ? TFidmap.serverIdOf(rec.parent_cid) : Promise.resolve(null);
      // Kanban tahap: tahap tujuan masih menunggu dibuat di server → tahan (id server-nya belum ada)
      if (contextHeld(rec, pending)) return;
      return Promise.all([parentP, tagsOf(op.cid, tagsFor), projectItems(), contextItems()]).then(([parentSid, tags, projects, contexts]) => {
        // T10: induk belum punya server id tapi create-nya masih antre → tahan (jangan kirim parent_id null)
        if (rec.parent_cid && parentSid == null && parentCreatePending(pending, rec.parent_cid)) return;
        const sentRev = rec.rev || 0;
        return send(transport, "POST", "/api/tasks", taskToCreatePayload(rec, tags, parentSid != null ? parentSid : null, projects, contexts)).then((res) => {
          if (ok(res)) {
            const sid = res.data.id;
            return TFidmap.mapPut("task", sid, op.cid)
              .then(() => markPushed("tasks", op.cid, sentRev, updatedAtOf(res), sid, taskAdopt(res.data)))
              .then(() => TFoutbox.outboxRemove(op.qid))
              .then(() => requeueIfDirty("tasks", "task", op.cid))
              .then(() => rewriteNoteTaskLinks(op.cid, sid)) // S15
              .then(() => { result.pushed++; });
          }
          if (classify(res) === "forbidden") { return accessLost("tasks", op.cid, op, result); }
          return failPermanent("tasks", op.cid, res, op, result);
        });
      });
    });
  }

  function opUpdate(op, transport, tagsFor, result, pending) {
    return Promise.all([getTaskRaw(op.cid), TFidmap.serverIdOf(op.cid)]).then(([rec, sid]) => {
      if (!rec || sid == null) return TFoutbox.outboxRemove(op.qid);
      if (rec.conflict) return; // held until user resolves the conflict
      if (contextHeld(rec, pending)) return; // Kanban tahap: tunggu create tahap terkirim
      return Promise.all([tagsOf(op.cid, tagsFor), projectItems(), contextItems()]).then(([tags, projects, contexts]) => {
        const sentRev = rec.rev || 0;
        return send(transport, "PUT", "/api/tasks/" + sid, taskToUpdatePayload(rec, tags, projects, contexts)).then((res) => {
          if (ok(res)) {
            return markPushed("tasks", op.cid, sentRev, updatedAtOf(res), null, taskAdopt(res.data))
              .then(() => TFoutbox.outboxRemove(op.qid))
              .then(() => requeueIfDirty("tasks", "task", op.cid))
              .then(() => { result.pushed++; });
          }
          const kind = classify(res);
          if (kind === "gone") { // safety net: flag, keep op (CAS: jangan menulis objek pra-request)
            return TFdb.mutate("tasks", op.cid, (cur) => (cur ? Object.assign({}, cur, { conflict: "remote_deleted" }) : undefined));
          }
          if (kind === "forbidden") { return accessLost("tasks", op.cid, op, result); }
          return failPermanent("tasks", op.cid, res, op, result);
        });
      });
    });
  }

  // ── Kanban tahap: op create tahap (entity_type "context") ──────────────────────────────────────
  function getAllTasksRaw() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("tasks", "readonly").objectStore("tasks").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  // Ubah setiap task lokal yang context_id-nya `cid` lewat CAS per record (`fn(cur)` → objek baru / undefined).
  // Daftar awal hanya kandidat; predikat dicek ulang di dalam transaksi. Resolve daftar cid yang diubah.
  function rewriteTasksWithContextCid(cid, fn) {
    const linked = (r) => r && r.context_id != null && String(r.context_id) === String(cid);
    return getAllTasksRaw().then((all) => {
      const done = [];
      return all.filter(linked).reduce((p, t) => p.then(() =>
        TFdb.mutate("tasks", t.cid, (cur) => (linked(cur) ? fn(cur) : undefined))
          .then((next) => { if (next) done.push(t.cid); })
      ), Promise.resolve()).then(() => done);
    });
  }
  // POST /api/contexts untuk tahap pending. Server idempoten lewat nama (resolve-or-create NOCASE per scope),
  // client_id diterima tetapi tidak disimpan.
  //   entri pending tidak ada → op dibuang (baca GAGAL → reject: op tetap, dicoba lagi; bukan "sudah hilang")
  //   2xx → idmap, cache server + buang pending, task lokal ber-cid → id server (dirty + op susulan), event
  //   403/404/4xx permanen → buang pending, task lokal melepas id (teks tetap) → dikirim nama saja
  //   401/429/5xx/jaringan → `send` melempar: op dan pending tetap
  function opContextCreate(op, transport, result) {
    if (!TFcontexts || typeof TFcontexts.pendingByCidStrict !== "function") return Promise.resolve(); // modul lama: tunggu
    const cid = op.cid;
    return TFcontexts.pendingByCidStrict(cid).then((entry) => {
      if (!entry) return TFoutbox.outboxRemove(op.qid);
      const body = { name: entry.name, list_id: entry.list_id != null ? entry.list_id : null, client_id: cid };
      return send(transport, "POST", "/api/contexts", body).then((res) => {
        if (ok(res) && res.data && res.data.id != null) {
          const data = res.data;
          const changed = [];
          return TFidmap.mapPut("context", data.id, cid)
            // cache dulu: createTask/updateTask yang berjalan sesudahnya menemukan id server lewat nama
            .then(() => TFcontexts.resolvePending(cid, data))
            .then(() => rewriteTasksWithContextCid(cid, (cur) => {
              if (cur.deleted) return undefined; // tombstone: tidak perlu dikirim ulang
              const next = Object.assign({}, cur, {
                context_id: data.id,
                context_ref_name: data.name != null ? data.name : (cur.context != null ? cur.context : ""),
                dirty: 1, rev: (cur.rev || 0) + 1,
              });
              if (data.name != null && TFprojects.nocaseEq(cur.context, data.name)) next.context = data.name;
              return next;
            }))
            .then((cids) => cids.reduce((p, tc) => p.then(() => {
              changed.push(tc);
              return requeueIfDirty("tasks", "task", tc);
            }), Promise.resolve()))
            .then(() => TFoutbox.outboxRemove(op.qid))
            .then(() => {
              result.pushed++;
              dispatchWindowEvent("tf:contexts-changed", { source: "syncpush", cid: cid, id: data.id });
              if (changed.length) dispatchWindowEvent("tf:outbox-queued", { entity: "task", cids: changed.slice() });
            });
        }
        // 2xx tanpa id / 403 / 404 / 4xx permanen: tahap tidak bisa dibuat → lepaskan tautan lokal
        result.failed++;
        return TFcontexts.dropPending(cid)
          .then(() => rewriteTasksWithContextCid(cid, (cur) =>
            Object.assign({}, cur, { context_id: null, context_ref_name: null })))
          .then(() => TFoutbox.outboxRemove(op.qid))
          .then(() => { dispatchWindowEvent("tf:contexts-changed", { source: "syncpush", cid: cid, failed: true }); });
      });
    });
  }

  function opDelete(op, transport, result) {
    return TFidmap.serverIdOf(op.cid).then((sid) => {
      if (sid == null) return TFoutbox.outboxRemove(op.qid);
      return send(transport, "DELETE", "/api/tasks/" + sid, undefined).then((res) => {
        if (ok(res) || res.status === 404) { result.pushed++; return TFoutbox.outboxRemove(op.qid); }
        // 403/4xx: op dibuang; tombstone lokal (deleted, dirty, tanpa op) dipulihkan oleh pull berikutnya (server menang).
        return failPermanent(null, op.cid, res, op, result);
      });
    });
  }

  function opMark(op, transport, result, pending) {
    const p = op.payload || {};
    return TFidmap.serverIdOf(p.task_cid).then((sid) => {
      if (sid == null) {
        if (parentCreatePending(pending, p.task_cid)) return; // T10: tahan sampai create task terkirim
        return TFoutbox.outboxRemove(op.qid);
      }
      return send(transport, "POST", "/api/tasks/" + sid + "/occurrences/" + p.occurrence_date + "/mark", markPayload(p)).then((res) => {
        if (ok(res)) {
          result.pushed++;
          // T8: tandai entri lokal bersih supaya pull jendela bisa merekonsiliasinya (op-nya sudah terkirim)
          return TFdb.mutate("recurring_exceptions", op.cid, (cur) => (cur ? Object.assign({}, cur, { dirty: 0 }) : undefined))
            .then(() => TFoutbox.outboxRemove(op.qid));
        }
        // 4xx permanen (mis. 400 tanggal di luar masa recurring): record tetap dirty + sync_error → pull tidak
        // menghapusnya diam-diam (prinsip 1); ditandai ulang saat pengguna menandai lagi (markOccurrence)
        return failPermanent("recurring_exceptions", op.cid, res, op, result);
      });
    });
  }

  function opHabitCreate(op, transport, habitTagsFor, result) {
    return getHabitRaw(op.cid).then((rec) => {
      if (!rec) return TFoutbox.outboxRemove(op.qid);
      if (rec.server_id != null) return TFoutbox.outboxRemove(op.qid);
      if (rec.conflict) return; // held until user resolves
      if (rec.deleted) return TFoutbox.outboxRemove(op.qid); // dibuat lalu dihapus offline
      return habitTagsFor(op.cid).then((tags) => {
        const sentRev = rec.rev || 0;
        return send(transport, "POST", "/api/habits", habitToCreatePayload(rec, tags)).then((res) => {
          if (ok(res)) {
            const sid = res.data.id;
            return TFidmap.mapPut("habit", sid, op.cid)
              .then(() => markPushed("habits", op.cid, sentRev, null, sid, null))
              .then(() => TFoutbox.outboxRemove(op.qid))
              .then(() => requeueIfDirty("habits", "habit", op.cid))
              .then(() => { result.pushed++; });
          }
          if (classify(res) === "forbidden") { return accessLost("habits", op.cid, op, result); }
          return failPermanent("habits", op.cid, res, op, result);
        });
      });
    });
  }

  function opHabitUpdate(op, transport, habitTagsFor, result) {
    return Promise.all([getHabitRaw(op.cid), TFidmap.serverIdOf(op.cid)]).then(([rec, sid]) => {
      if (!rec || sid == null) return TFoutbox.outboxRemove(op.qid);
      if (rec.conflict) return; // held until user resolves
      return habitTagsFor(op.cid).then((tags) => {
        const sentRev = rec.rev || 0;
        return send(transport, "POST", "/api/habits/" + sid + "/update", habitToUpdatePayload(rec, tags)).then((res) => {
          if (ok(res)) {
            return markPushed("habits", op.cid, sentRev, null, null, null)
              .then(() => TFoutbox.outboxRemove(op.qid))
              .then(() => requeueIfDirty("habits", "habit", op.cid))
              .then(() => { result.pushed++; });
          }
          const kind = classify(res);
          if (kind === "gone") {
            // habit deleted on server → local-wins: re-create (baris lama sudah terhapus, jadi client_id = cid
            // tidak mengembalikan baris lama), lalu remap idmap
            const payload = habitToCreatePayload(rec, tags);
            return send(transport, "POST", "/api/habits", payload).then((res2) => {
              if (ok(res2)) {
                const nid = res2.data.id;
                return TFidmap.mapDelete("habit", sid)
                  .then(() => TFidmap.mapPut("habit", nid, op.cid))
                  .then(() => TFdb.mutate("habits", op.cid, (cur) => {
                    if (!cur) return undefined;
                    const next = Object.assign({}, cur, { server_id: nid });
                    next.dirty = ((cur.rev || 0) === sentRev && !cur.deleted) ? 0 : 1;
                    delete next.sync_error;
                    return next;
                  }))
                  .then(() => TFoutbox.outboxRemove(op.qid))
                  .then(() => requeueIfDirty("habits", "habit", op.cid))
                  .then(() => { result.pushed++; });
              }
              if (classify(res2) === "forbidden") { return accessLost("habits", op.cid, op, result); }
              return failPermanent("habits", op.cid, res2, op, result);
            });
          }
          if (kind === "forbidden") { return accessLost("habits", op.cid, op, result); }
          return failPermanent("habits", op.cid, res, op, result);
        });
      });
    });
  }

  function getLogRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("habit_logs", "readonly").objectStore("habit_logs").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function opHabitCheckin(op, transport, result, pending) {
    return getLogRaw(op.cid).then((log) => {
      if (!log) return TFoutbox.outboxRemove(op.qid);
      return TFidmap.serverIdOf(log.habit_cid).then((sid) => {
        if (sid == null) {
          if (parentCreatePending(pending, log.habit_cid)) return; // T10: tahan sampai create habit terkirim
          return TFoutbox.outboxRemove(op.qid);
        }
        const sentRev = log.rev || 0;
        return send(transport, "POST", "/api/habits/" + sid + "/checkin", checkinPayload(log)).then((res) => {
          if (ok(res)) {
            // CAS: check-in ulang selama in-flight (rev naik) → tetap dirty, op barunya mengirim status terkini
            return markPushed("habit_logs", op.cid, sentRev, null, null, null)
              .then(() => TFoutbox.outboxRemove(op.qid))
              .then(() => getLogRaw(op.cid))
              .then((cur) => (cur && cur.dirty && !cur.sync_error
                ? ensureLogCheckinOp(cur)
                : null))
              .then(() => { result.pushed++; });
          }
          // 403/404/4xx: log tetap dirty + sync_error (pull melewatinya; T9: rekonsiliasi saat status sama dengan server)
          return failPermanent("habit_logs", op.cid, res, op, result);
        });
      });
    });
  }
  // Jaring pengaman: log masih dirty setelah push sukses tapi tidak punya op checkin → antre satu.
  function ensureLogCheckinOp(log) {
    return TFoutbox.outboxByEntity("habit_log", log.cid).then((ops) =>
      (ops.some((o) => o.op === "checkin") ? null
        : (TFoutbox.outboxAppend || TFoutbox.outboxAdd)({ op: "checkin", entity_type: "habit_log", cid: log.cid, payload: log })));
  }

  function opHabitUncheck(op, transport, result, pending) {
    const payload = op.payload || {};
    const habitCid = payload.habit_cid;
    if (!habitCid) return TFoutbox.outboxRemove(op.qid);
    return TFidmap.serverIdOf(habitCid).then((sid) => {
      if (sid == null) {
        if (parentCreatePending(pending, habitCid)) return; // T10: tahan sampai create habit terkirim
        return TFoutbox.outboxRemove(op.qid);
      }
      return send(transport, "POST", "/api/habits/" + sid + "/checkin", {
        date: payload.date,
        status: "uncheck",
      }).then((res) => {
        if (ok(res)) {
          return TFoutbox.outboxRemove(op.qid).then(() => { result.pushed++; });
        }
        return failPermanent(null, null, res, op, result);
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

  // Respons simpan/share note membawa moved_drawings: terapkan ke record drawing lokal. Tidak pernah
  // menggagalkan hasil push (error dicatat saja); modul lama dari cache SW tanpa drawingshare → lewati.
  function applyMovedFrom(res) {
    try {
      const moved = res && res.data && res.data.moved_drawings;
      if (!moved || !moved.length) return Promise.resolve();
      const ds = isNode ? require("./drawingshare.js") : (root.TF && root.TF.drawingshare);
      if (!ds || typeof ds.applyMovedDrawings !== "function") return Promise.resolve();
      return Promise.resolve(ds.applyMovedDrawings(moved)).catch((err) => {
        try { console.warn("[syncpush] moved_drawings gagal diterapkan", err); } catch (_) {}
      });
    } catch (err) {
      try { console.warn("[syncpush] moved_drawings gagal diterapkan", err); } catch (_) {}
      return Promise.resolve();
    }
  }

  function opNoteCreate(op, transport, result) {
    return getNoteRaw(op.cid).then((rec) => {
      if (!rec) return TFoutbox.outboxRemove(op.qid);
      if (rec.server_id != null) return TFoutbox.outboxRemove(op.qid);
      if (rec.conflict) return TFoutbox.outboxRemove(op.qid); // held until user resolves (access_lost → keep_as_new mengantre ulang)
      return Promise.all([noteTagNames(op.cid), linkedTaskServerIds(rec)]).then(([tags, taskSids]) => {
        const sentRev = rec.rev || 0;
        return send(transport, "POST", "/api/scratchpad", noteToCreatePayload(rec, tags, taskSids)).then((res) => {
          if (ok(res)) {
            const sid = res.data.id;
            return TFidmap.mapPut("note", sid, op.cid)
              .then(() => markPushed("scratchpad_notes", op.cid, sentRev, updatedAtOf(res), sid, null))
              .then(() => applyMovedFrom(res))
              .then(() => TFoutbox.outboxRemove(op.qid))
              .then(() => requeueIfDirty("scratchpad_notes", "note", op.cid))
              .then(() => { result.pushed++; });
          }
          if (classify(res) === "forbidden") { return accessLost("scratchpad_notes", op.cid, op, result); }
          return failPermanent("scratchpad_notes", op.cid, res, op, result);
        });
      });
    });
  }

  // 409 REV_MISMATCH (prinsip 7): server sudah punya revisi lain → versi lokal jadi salinan konflik pribadi,
  // record asli mengadopsi baris server (`detail.current`), op tertunda dibuang. Bukan 409 rev (atau noterepo
  // lama tanpa helper) → false, pemanggil memperlakukannya sebagai error permanen.
  function noteRevMismatch(res) {
    const d = res && res.status === 409 && res.data && res.data.detail;
    return !!(d && typeof d === "object" && d.code === "REV_MISMATCH" && d.current && typeof d.current === "object");
  }
  function noteConflictCopy(op, res, result) {
    const nr = noteRepo();
    if (!nr || typeof nr.keepLocalAsConflictCopy !== "function") return Promise.resolve(false);
    const cur = res.data.detail.current;
    return nr.keepLocalAsConflictCopy(op.cid, cur, { editor: cur.last_editor_display_name || cur.last_editor_username || null })
      .then((r) => TFoutbox.outboxRemove(op.qid).then(() => {
        if (r && r.copy) {
          result.conflictCopies = (result.conflictCopies || 0) + 1;
          dispatchWindowEvent("noteSaved", { source: "syncpush", cids: [op.cid, r.copy.cid] });
        } else if (r) {
          result.pushed++; // isi sama dengan server (gema PUT sendiri) → base_rev maju tanpa salinan
          dispatchWindowEvent("noteSaved", { source: "syncpush", cids: [op.cid] });
        }
        return true;
      }));
  }

  function opNoteUpdate(op, transport, result) {
    return Promise.all([getNoteRaw(op.cid), TFidmap.serverIdOf(op.cid)]).then(([rec, sid]) => {
      if (!rec || sid == null) return TFoutbox.outboxRemove(op.qid);
      if (rec.conflict) return TFoutbox.outboxRemove(op.qid); // held until user resolves; don't re-push against an unreachable note
      // T4: record bersih (dirty 0 → server sudah memuat versi ini; mis. op update sisa setelah create sukses)
      // → tidak ada yang dikirim; PUT kosong hanya mem-bump updated_at & "diedit oleh" di server.
      if (!rec.dirty && !rec.deleted) return TFoutbox.outboxRemove(op.qid);
      return Promise.all([noteTagNames(op.cid), linkedTaskServerIds(rec)]).then(([tags, taskSids]) => {
        const sentRev = rec.rev || 0;
        return send(transport, "PUT", "/api/scratchpad/" + sid, noteToUpdatePayload(rec, tags, taskSids)).then((res) => {
          if (ok(res)) {
            // CAS (K5 untuk note): edit selama in-flight (rev naik) → tetap dirty, versi terbaru dikirim ulang
            return markPushed("scratchpad_notes", op.cid, sentRev, updatedAtOf(res), null, null)
              .then(() => applyMovedFrom(res))
              .then(() => TFoutbox.outboxRemove(op.qid))
              .then(() => requeueIfDirty("scratchpad_notes", "note", op.cid))
              .then(() => { result.pushed++; });
          }
          if (noteRevMismatch(res)) {
            return noteConflictCopy(op, res, result).then((done) => (done ? null : failPermanent("scratchpad_notes", op.cid, res, op, result)));
          }
          const kind = classify(res);
          if (kind === "gone") {
            if (rec.list_id != null) {
              // shared note deleted by owner (or access lost): do not re-create — surface edit-vs-delete.
              return TFdb.mutate("scratchpad_notes", op.cid, (cur) => (cur ? Object.assign({}, cur, { conflict: "remote_deleted" }) : undefined))
                .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.failed++; });
            }
            return freshRecreateClientId("scratchpad_notes", op.cid, sid).then((rec2) => {
             if (!rec2) return TFoutbox.outboxRemove(op.qid);
             return send(transport, "POST", "/api/scratchpad", noteToCreatePayload(rec2, tags, taskSids)).then((res2) => {
              if (ok(res2)) {
                const nid = res2.data.id;
                return TFidmap.mapDelete("note", sid)
                  .then(() => TFidmap.mapPut("note", nid, op.cid))
                  .then(() => TFdb.mutate("scratchpad_notes", op.cid, (cur) => {
                    if (!cur) return undefined;
                    const next = Object.assign({}, cur, { server_id: nid });
                    delete next.recreate_of_sid;
                    const ua = updatedAtOf(res2);
                    if (ua != null) next.base_rev = ua; // baris server baru → base_rev-nya
                    next.dirty = ((cur.rev || 0) === sentRev && !cur.deleted) ? 0 : 1;
                    delete next.sync_error;
                    return next;
                  }))
                  .then(() => TFoutbox.outboxRemove(op.qid))
                  .then(() => requeueIfDirty("scratchpad_notes", "note", op.cid))
                  .then(() => { result.pushed++; });
              }
              if (classify(res2) === "forbidden") { return accessLost("scratchpad_notes", op.cid, op, result); }
              return failPermanent("scratchpad_notes", op.cid, res2, op, result);
             });
            });
          }
          if (kind === "forbidden") { return accessLost("scratchpad_notes", op.cid, op, result); }
          return failPermanent("scratchpad_notes", op.cid, res, op, result);
        });
      });
    });
  }

  function opNoteDelete(op, transport, result) {
    return Promise.all([getNoteRaw(op.cid), TFidmap.serverIdOf(op.cid)]).then(([rec, sidFromMap]) => {
      const sid = sidFromMap != null ? sidFromMap : (rec && rec.server_id != null ? rec.server_id : null);
      if (sid == null) {
        return deleteNoteRaw(op.cid).then(() => TFoutbox.outboxRemove(op.qid));
      }
      return send(transport, "DELETE", "/api/scratchpad/" + sid, undefined).then((res) => {
        if (ok(res) || res.status === 404) {
          return TFidmap.mapDelete("note", sid)
            .then(() => deleteNoteRaw(op.cid))
            .then(() => TFoutbox.outboxRemove(op.qid))
            .then(() => { result.pushed++; });
        }
        if (classify(res) === "forbidden") {
          // hapus ditolak (hanya pemilik): batalkan tombstone pada record TERKINI (prinsip 4), beri notice
          return TFdb.mutate("scratchpad_notes", op.cid, (cur) => (cur
              ? Object.assign({}, cur, { deleted: false, dirty: 0, rev: (cur.rev || 0) + 1, notice: { kind: "delete_refused", title: cur.title } })
              : undefined))
            .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.failed++; });
        }
        return failPermanent(null, null, res, op, result);
      });
    });
  }

  const _BlobStore = TFblob.makeBlobStore();
  function getDrawingRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("drawings", "readonly").objectStore("drawings").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  // Data drawing yang sedang dikirim (cid → data_json). Pull memakai ini untuk mengenali gema push sendiri
  // (server sudah menerima PUT tapi record lokal belum ditandai) agar tidak di-merge sebagai perubahan remote.
  const _inflightDrawing = new Map();
  function inflightDrawingData(cid) {
    return _inflightDrawing.has(cid) ? _inflightDrawing.get(cid) : undefined;
  }
  // Data terkini drawing: record + blob dibaca konsisten (sumber kebenaran). Fallback salinan payload op lama.
  // `ref` = id blob yang isinya = data (null bila data dari payload / tidak ada) — dipakai sebagai blob dasar (T2).
  function drawingStateOf(cid, payload) {
    return TFrepo.readDrawingState(cid).then(({ rec, bytes }) => {
      // Record data_missing (detail server belum terambil): JANGAN pernah mengirim datanya (server yang benar)
      if (rec && rec.data_missing) return { rec, data: undefined, ref: null };
      let data = bytes;
      let ref = (bytes != null && rec) ? rec.blob_ref : null;
      if (data == null && payload && typeof payload.data_json === "string") data = payload.data_json;
      return { rec, data, ref };
    });
  }
  function drawingTagsOf(cid, fallback) {
    if (!(TFtag && TFtag.getEntityTags)) return Promise.resolve(fallback || []);
    return TFtag.getEntityTags("drawing", cid)
      .then((ts) => {
        const names = ts.map((t) => t.name);
        return names.length ? names : (fallback || []);
      })
      .catch(() => fallback || []);
  }
  function drawingMeta(rec) {
    return { title: rec.title, svg_preview: rec.svg_preview || "", is_pinned: rec.is_pinned ? 1 : 0 };
  }
  // Tandai terkirim lewat CAS: bersih hanya bila tidak ada edit (rev) sejak data dibaca untuk dikirim.
  // Tidak pernah menulis objek basi — selalu menerapkan perubahan ke record terkini.
  // T2: data yang TERKIRIM menjadi snapshot dasar (base_blob_ref/base_title) bila base_rev maju ke revisi respons:
  // blob_ref masih blob yang dikirim → dibagi; sudah diganti edit in-flight (atau data dari payload) → data terkirim
  // disimpan ke blob baru. sent = { ref, data, title } (ref/data null = PUT tanpa data → base dikosongkan, union).
  function markDrawingPushed(cid, sentRev, updatedAt, sid, sent) {
    sent = sent || {};
    let advanced = false;
    let needBase = false;
    let oldRefs = [];
    return TFrepo.mutateDrawing(cid, (cur) => {
      if (!cur) return undefined;
      const next = Object.assign({}, cur);
      if (sid != null && next.server_id == null) next.server_id = sid;
      // Respons create membawa pemilik & workspace otoritatif → adopsi (seperti server_id).
      if (sent.srv && sent.srv.user_id != null) next.user_id = sent.srv.user_id;
      if (sent.srv && sent.srv.list_id !== undefined) next.list_id = sent.srv.list_id;
      // base_rev hanya boleh MAJU (pull bisa sudah menggabung revisi server yang lebih baru selama request)
      advanced = updatedAt != null && TFrepo.tsNewer(updatedAt, cur.base_rev);
      if (advanced) {
        next.base_rev = updatedAt;
        oldRefs = [cur.base_blob_ref];
        next.base_title = sent.title != null ? sent.title : cur.title;
        if (sent.data == null) { next.base_blob_ref = null; needBase = false; }
        else if (sent.ref && cur.blob_ref === sent.ref) { next.base_blob_ref = sent.ref; needBase = false; }
        else { next.base_blob_ref = null; needBase = true; } // dasar basi tidak boleh tersisa (jendela: union)
      }
      next.dirty = ((cur.rev || 0) === sentRev && !cur.deleted) ? 0 : 1;
      delete next.sync_error; // request sukses → error permanen sebelumnya sudah teratasi
      return next;
    }).then((saved) => {
      if (!saved || !advanced) return saved;
      if (!needBase) return TFrepo.releaseBlobs(oldRefs, [saved.blob_ref, saved.base_blob_ref]).then(() => saved);
      return _BlobStore.put(sent.data, { mime: "application/json" }).then((ref) =>
        TFrepo.mutateDrawing(cid, (cur) => ((cur && cur.base_rev === updatedAt) ? Object.assign({}, cur, { base_blob_ref: ref }) : undefined))
          .then((saved2) => (saved2
            ? TFrepo.releaseBlobs(oldRefs, [saved2.blob_ref, saved2.base_blob_ref]).then(() => saved2)
            : TFrepo.releaseBlobs([ref], []).then(() => saved))));
    });
  }
  // Masih dirty setelah request (ada edit selama in-flight) → pastikan ada op update susulan.
  function requeueDrawingIfDirty(cid) {
    return getDrawingRaw(cid).then((cur) => (cur && cur.dirty && !cur.deleted && cur.note_cid === undefined
      ? TFrepo.ensureDrawingUpdateOp(cid, drawingMeta(cur))
      : null));
  }

  function opDrawingCreate(op, transport, result) {
    return getDrawingRaw(op.cid).then((rec0) => {
      if (!rec0) return TFoutbox.outboxRemove(op.qid);
      if (rec0.server_id != null) return TFoutbox.outboxRemove(op.qid);
      if (rec0.conflict) return TFoutbox.outboxRemove(op.qid); // held until user resolves (access_lost)
      // dibuat lalu dihapus offline (belum pernah di-push): jangan POST lalu DELETE; op delete-nya berhenti sendiri
      if (rec0.deleted) return TFoutbox.outboxRemove(op.qid);
      const payload = op.payload || {};
      // tag dulu, lalu record+blob terkini dibaca berurutan (tanpa jeda async lain sebelum dikirim)
      return drawingTagsOf(rec0.cid, payload.tags).then((tagNames) => drawingStateOf(rec0.cid, payload).then(({ rec, data, ref }) => {
        if (!rec) return TFoutbox.outboxRemove(op.qid);
        if (rec.server_id != null) return TFoutbox.outboxRemove(op.qid);
        if (rec.deleted) return TFoutbox.outboxRemove(op.qid);
        const sentRev = rec.rev || 0;
        const dataJson = data != null ? data : "{}";
        const sentTitle = rec.title || payload.title || "Untitled Drawing";
        _inflightDrawing.set(rec.cid, dataJson);
        return send(transport, "POST", "/api/drawings", {
          title: sentTitle,
          data_json: dataJson,
          svg_preview: rec.svg_preview || "",
          is_pinned: rec.is_pinned ? 1 : 0,
          tags: tagNames || [],
          list_id: rec.list_id != null ? rec.list_id : (payload.list_id != null ? payload.list_id : null),
          client_id: clientIdOf(rec), // salinan "simpan sebagai baru" punya client_id segar (bukan cid lama)
        }).then((res) => {
          if (ok(res) && res.data && res.data.id != null) {
            const sid = res.data.id;
            return TFidmap.mapPut("drawing", sid, rec.cid)
              .then(() => markDrawingPushed(rec.cid, sentRev, res.data.updated_at, sid, { ref: data != null ? ref : null, data: dataJson, title: sentTitle, srv: res.data }))
              .then(() => TFoutbox.outboxRemove(op.qid))
              .then(() => requeueDrawingIfDirty(rec.cid))
              .then(() => { result.pushed++; });
          }
          if (classify(res) === "forbidden") { return accessLost("drawings", op.cid, op, result); }
          // 4xx permanen (mis. 422 data_json terlalu besar): sync_error → heal/pull tidak mengantre ulang (T13)
          return failPermanent("drawings", op.cid, res, op, result);
        }).finally(() => { _inflightDrawing.delete(rec.cid); });
      }));
    });
  }

  function opDrawingUpdate(op, transport, result) {
    return getDrawingRaw(op.cid).then((rec0) => {
      if (!rec0) return TFoutbox.outboxRemove(op.qid);
      if (rec0.conflict) return TFoutbox.outboxRemove(op.qid); // held until user resolves (access_lost)
      return TFidmap.serverIdOf(rec0.cid).then((mapped) => {
        // Record dari getDrawing versi lama bisa punya server_id tanpa entri idmap → jangan ditahan selamanya.
        const sid = mapped != null ? mapped : rec0.server_id;
        if (sid == null) return; // hold: create not pushed yet
        const payload = op.payload || {};
        // Tag hanya dikirim bila ada perubahan tag lokal tertunda (payload.tags) agar tidak menimpa tag dari mesin lain.
        const tagsP = Array.isArray(payload.tags) ? drawingTagsOf(rec0.cid, payload.tags) : Promise.resolve(undefined);
        return tagsP.then((tags) => drawingStateOf(rec0.cid, payload).then(({ rec, data, ref }) => {
          if (!rec) return TFoutbox.outboxRemove(op.qid);
          if (rec.deleted) return TFoutbox.outboxRemove(op.qid); // op delete yang menyusul yang mengurus server
          const sentRev = rec.rev || 0;
          const body = {
            title: rec.title || payload.title || "Untitled Drawing",
            svg_preview: rec.svg_preview || "",
            is_pinned: rec.is_pinned ? 1 : 0,
          };
          if (data != null) body.data_json = data; // tanpa data lokal → server mempertahankan datanya
          if (tags !== undefined) body.tags = tags;
          if (data != null) _inflightDrawing.set(rec.cid, data);
          return send(transport, "PUT", "/api/drawings/" + sid, body).then((res) => {
            if (ok(res)) {
              return markDrawingPushed(rec.cid, sentRev, res.data && res.data.updated_at != null ? res.data.updated_at : null, null,
                { ref: data != null ? ref : null, data: data != null ? data : null, title: body.title })
                .then(() => TFoutbox.outboxRemove(op.qid))
                .then(() => requeueDrawingIfDirty(rec.cid))
                .then(() => { result.pushed++; });
            }
            const kind = classify(res);
            if (kind === "forbidden") { return accessLost("drawings", op.cid, op, result); }
            // S2: 404 = dihapus di server saat ada edit lokal → conflict "remote_deleted" (record + blob DIPERTAHANKAN,
            // pull melewatinya); conflict bar: "Buang perubahan" / "Simpan sebagai gambar baru" (keep_as_new).
            if (kind === "gone") {
              result.failed++;
              return TFrepo.mutateDrawing(rec.cid, (cur) => (cur ? Object.assign({}, cur, { conflict: "remote_deleted" }) : undefined))
                .then(() => TFoutbox.outboxRemove(op.qid));
            }
            // 4xx permanen (mis. 422 data_json terlalu besar): sync_error → heal/pull tidak mengantre ulang (T13)
            return failPermanent("drawings", op.cid, res, op, result);
          }).finally(() => { _inflightDrawing.delete(rec.cid); });
        }));
      });
    });
  }

  // Pin drawing (sebelumnya op 'pin' dibuang tanpa dikirim): cek status server dulu, PATCH (toggle) hanya bila berbeda.
  function opDrawingPin(op, transport, result) {
    return Promise.all([getDrawingRaw(op.cid), TFidmap.serverIdOf(op.cid)]).then(([rec, mapped]) => {
      if (!rec || rec.deleted) return TFoutbox.outboxRemove(op.qid);
      const sid = mapped != null ? mapped : rec.server_id;
      if (sid == null) return; // hold: create belum terkirim (op create diproses lebih dulu, FIFO)
      return send(transport, "GET", "/api/drawings/" + sid, undefined).then((res) => {
        // pin tidak punya record sync_error: server dipulihkan oleh pass adopsi pin pada pull berikutnya
        if (!ok(res)) { return failPermanent(null, null, res, op, result); }
        const want = !!rec.is_pinned; // status lokal TERKINI (toggle beruntun tetap benar)
        if (!!(res.data && res.data.is_pinned) === want) {
          return TFoutbox.outboxRemove(op.qid).then(() => { result.pushed++; }); // sudah sama
        }
        return send(transport, "PATCH", "/api/drawings/" + sid + "/pin", undefined).then((res2) => {
          if (ok(res2)) { return TFoutbox.outboxRemove(op.qid).then(() => { result.pushed++; }); }
          return failPermanent(null, null, res2, op, result);
        });
      });
    });
  }

  function opDrawingDelete(op, transport, result) {
    return Promise.all([TFidmap.serverIdOf(op.cid), getDrawingRaw(op.cid)]).then(([mapped, rec]) => {
      const sid = mapped != null ? mapped : (rec && rec.server_id != null ? rec.server_id : null);
      if (sid == null) {
        // Belum pernah di-push: tidak ada yang perlu dihapus di server → buang tombstone + blob-nya (tanpa sisa)
        return (rec && rec.deleted ? TFrepo.purgeDrawing(rec.cid) : Promise.resolve())
          .then(() => TFoutbox.outboxRemove(op.qid));
      }
      return send(transport, "DELETE", "/api/drawings/" + sid, undefined).then((res) => {
        if (ok(res) || res.status === 404) {
          // record tombstone + blob dibuang setelah server mengonfirmasi (404 = sudah tidak ada)
          return (rec && rec.deleted ? TFrepo.purgeDrawing(rec.cid) : Promise.resolve())
            .then(() => TFidmap.mapDelete("drawing", sid))
            .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; });
        }
        return failPermanent(null, null, res, op, result);
      });
    });
  }

  // S6: op `upsert` legacy (gambar di dalam note → PUT /api/drawings/{noteSid}, id note dianggap id drawing!)
  // tidak pernah dikirim lagi: record dikonversi menjadi drawing standalone (op create), op upsert dibuang.
  function opDrawingUpsert(op, transport, result) {
    return getDrawingRaw(op.cid).then((rec) => {
      if (!rec) return TFoutbox.outboxRemove(op.qid);
      return (rec.note_cid !== undefined ? TFrepo.convertLegacyNoteDrawing(rec.cid) : Promise.resolve(null))
        .then(() => TFoutbox.outboxRemove(op.qid));
    });
  }

  function opNotePin(op, transport, result) {
    return Promise.all([getNoteRaw(op.cid), TFidmap.serverIdOf(op.cid)]).then(([rec, sid]) => {
      if (!rec || sid == null) return TFoutbox.outboxRemove(op.qid);
      return send(transport, "GET", "/api/scratchpad/" + sid, undefined).then((res) => {
        if (!ok(res)) { return failPermanent(null, null, res, op, result); }
        if (!!(res.data && res.data.pinned) === !!rec.pinned) {
          return TFoutbox.outboxRemove(op.qid).then(() => { result.pushed++; }); // already in sync
        }
        return send(transport, "PATCH", "/api/scratchpad/" + sid + "/pin", undefined).then((res2) => {
          if (ok(res2)) { return TFoutbox.outboxRemove(op.qid).then(() => { result.pushed++; }); }
          return failPermanent(null, null, res2, op, result);
        });
      });
    });
  }

  function getMindmapRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("mindmaps", "readonly").objectStore("mindmaps").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function deleteMindmapRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("mindmaps", "readwrite");
      tx.objectStore("mindmaps").delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  // Beri tahu UI bahwa record mindmap diganti di luar jalur editor (adopsi 409): tab yang tidak punya edit
  // tertunda memuat ulang data_json; sidebar memuat ulang daftar (salinan konflik baru).
  function notifyMindmapSynced(cids, ids) {
    try {
      const w = (typeof window !== "undefined") ? window : root;
      if (w && typeof w.dispatchEvent === "function" && typeof CustomEvent === "function") {
        w.dispatchEvent(new CustomEvent("mindmapSynced", { detail: { source: "push", cids: cids || [], ids: ids || [] } }));
      }
    } catch (_) {}
  }
  // 409 dengan body {detail:{code:"REV_MISMATCH", current:<baris server>}} (prinsip 7) — 409 lain = permanen.
  function revMismatchRow(res) {
    const d = res && res.status === 409 && res.data && res.data.detail;
    return (d && typeof d === "object" && d.code === "REV_MISMATCH" && d.current && d.current.id != null) ? d.current : null;
  }
  // T3 / prinsip 7 + #4: PUT ditolak karena peta sudah diubah di perangkat lain → merge tiga arah per node
  // (TFmm.mergeServerIntoLocal, satu transaksi): basis sah → record = hasil merge (base maju ke `current`; masih
  // beda dari server → dirty + op update BARU sudah diantre repo → result.requeued, drain ini tidak melihatnya);
  // bentrok node yang sama / tanpa basis sah → salinan konflik versi lokal (pribadi, op create).
  // Record berubah selama request (rev ≠ sentRev) → biarkan op: push berikutnya mengirim versi terkini.
  // Pengaman loop: server menolak padahal `current.updated_at` = base_rev yang kami kirim → basis tidak bisa
  // dipercaya (merge akan mengantre ulang PUT yang sama tanpa akhir) → adopsi + salinan konflik, tanpa requeue.
  function mindmapRevMismatch(op, current, sentRev, sentBaseRev, result) {
    const sameBase = sentBaseRev != null && current.updated_at != null && String(current.updated_at) === String(sentBaseRev);
    const run = sameBase
      ? TFmm.adoptServerWithConflictCopy(op.cid, current, { expectRev: sentRev }).then((o) => (o ? Object.assign(o, { merged: false }) : o))
      : TFmm.mergeServerIntoLocal(op.cid, current, { expectRev: sentRev });
    return run.then((out) => {
      if (!out) return;
      if (out.merged) result.merged = (result.merged || 0) + 1;
      if (out.copy) result.conflicts = (result.conflicts || 0) + 1;
      if (!sameBase && out.original && out.original.dirty) result.requeued = (result.requeued || 0) + 1;
      const copyEv = TFmm.conflictCopyDetail ? TFmm.conflictCopyDetail(out, current, "push") : null;
      return TFoutbox.outboxRemove(op.qid)
        .then(() => notifyMindmapSynced([op.cid].concat(out.copy ? [out.copy.cid] : []), [current.id]))
        .then(() => { if (copyEv) dispatchWindowEvent("mindmapConflictCopy", copyEv); });
    });
  }
  // Basis merge (#4) maju bersama base_rev setelah PUT/POST sukses (peta biasa; respons = baris lengkap dengan
  // data_json). Tanpa ini merge berikutnya memakai basis basi (base_data_rev ≠ base_rev → salinan konflik).
  function advanceMindmapBase(cid, row, rec) {
    if (rec && TFmm.isLinked(rec)) return Promise.resolve();
    return TFmm.setBaseFromServer(cid, row);
  }

  // ── Peta tertaut (Petakan) ──────────────────────────────────────────────────────────────────────────────
  // Id server catatan sumber: { gone: true } catatan hilang/terhapus di perangkat ini; { sid: null } catatan
  // belum ter-push; { sid }. Record tanpa source_note_cid (hasil pull) → source_note_id sudah id server.
  function linkedNoteSid(rec) {
    if (rec.source_note_cid == null) return Promise.resolve({ sid: rec.source_note_id != null ? rec.source_note_id : null });
    return getRawOf("scratchpad_notes", rec.source_note_cid).then((note) => {
      if (!note || note.deleted) return { gone: true };
      if (note.server_id != null) return { sid: note.server_id };
      return TFidmap.serverIdOf(note.cid).then((sid) => ({ sid: sid != null ? sid : null }));
    });
  }
  // Catatan tidak ada lagi untuk pengguna ini → peta tertaut lokal tidak berarti: hapus record (+ idmap) & op.
  function dropLinkedLocal(op, sid) {
    return (sid != null ? TFidmap.mapDelete("mindmap", sid) : Promise.resolve())
      .then(() => deleteMindmapRaw(op.cid))
      .then(() => TFoutbox.outboxRemove(op.qid))
      .then(() => notifyMindmapSynced([op.cid], []));
  }
  // Dua perangkat memetakan catatan yang sama offline: server mengembalikan baris yang SUDAH dipetakan ke
  // record lokal lain (`keepCid`, hasil pull). Satu transaksi: record `keepCid` dipertahankan, data_json
  // (view-state) diambil dari record yang `updated_at`-nya lebih baru (dirty + rev naik bila berubah),
  // record `dupCid` dihapus. false bila `keepCid` tidak ada (idmap basi) → pemanggil memetakan seperti biasa.
  function mergeLinkedDuplicate(dupCid, keepCid) {
    let merged = false;
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("mindmaps", "readwrite");
      const os = tx.objectStore("mindmaps");
      const rk = os.get(keepCid);
      rk.onsuccess = () => {
        const keep = rk.result;
        if (!keep) return;
        const rd = os.get(dupCid);
        rd.onsuccess = () => {
          const dup = rd.result;
          merged = true;
          const next = Object.assign({}, keep);
          if (dup) {
            if (tsEpoch(dup.updated_at) > tsEpoch(keep.updated_at) && dup.data_json !== keep.data_json) {
              next.data_json = dup.data_json;
              next.updated_at = dup.updated_at;
              next.dirty = 1;
              next.rev = (keep.rev || 0) + 1;
            }
            if (next.source_note_cid == null && dup.source_note_cid != null) next.source_note_cid = dup.source_note_cid;
            os.put(next);
            os.delete(dupCid);
          }
        };
      };
      tx.oncomplete = () => resolve(merged);
      tx.onerror = () => reject(tx.error);
    }));
  }
  // POST sukses untuk peta tertaut: id sudah milik record lain → gabung; selain itu idmap + markPushed.
  function adoptLinkedCreate(op, sid, result) {
    return TFidmap.cidOf("mindmap", sid).then((other) => {
      if (other == null || other === op.cid) return false;
      return mergeLinkedDuplicate(op.cid, other).then((merged) => {
        if (!merged) return false;
        return TFoutbox.outboxRemove(op.qid)
          .then(() => requeueIfDirty("mindmaps", "mindmap", other))
          .then(() => { result.pushed++; notifyMindmapSynced([op.cid, other], [sid]); return true; });
      });
    });
  }
  // Server menolak pohon pada peta tertaut (data_json lokal mestinya hanya view-state) → buang op, catat sekali.
  const linkedTreeWarned = new Set();
  function hasNodeData(dataJson) {
    try { const d = JSON.parse(dataJson); return !!(d && typeof d === "object" && "nodeData" in d); } catch (_) { return false; }
  }
  function linkedDefaultView() {
    const nm = isNode ? require("./notemap.js") : (root.TF && root.TF.notemap);
    return JSON.stringify(nm.LINKED_VIEW_STATE_DEFAULT);
  }
  function linkedTreeRejected(res) {
    const d = res && res.status === 400 && res.data && res.data.detail;
    return !!(d && typeof d === "object" && d.code === "LINKED_TREE_REJECTED");
  }

  // `pending` (T10) diterima demi keseragaman, tetapi create tertaut SELALU ditahan selama catatan belum punya
  // id server: tanpa catatan di server peta tertaut tidak bisa dibuat (op lain tetap jalan).
  function opMindmapCreate(op, transport, result, pending) {
    return getMindmapRaw(op.cid).then((rec) => {
      if (!rec) return TFoutbox.outboxRemove(op.qid);
      if (rec.server_id != null) return TFoutbox.outboxRemove(op.qid);
      if (rec.conflict) return TFoutbox.outboxRemove(op.qid); // held until user resolves (access_lost)
      if (rec.deleted) return TFoutbox.outboxRemove(op.qid); // dibuat lalu dihapus offline: jangan POST lalu DELETE
      if (!TFmm.isLinked(rec)) return postMindmapCreate(op, transport, result, rec, null);
      return linkedNoteSid(rec).then((n) => {
        if (n.gone) return dropLinkedLocal(op, null);
        if (n.sid == null) return; // tahan: create catatan belum ter-push
        return postMindmapCreate(op, transport, result, rec, n.sid);
      });
    });
  }
  function postMindmapCreate(op, transport, result, rec, noteSid) {
    const linked = TFmm.isLinked(rec);
    const sentRev = rec.rev || 0;
    return send(transport, "POST", "/api/mindmaps", mindmapToCreatePayload(rec, noteSid)).then((res) => {
      if (ok(res)) {
        const sid = res.data.id;
        return (linked ? adoptLinkedCreate(op, sid, result) : Promise.resolve(false)).then((done) => {
          if (done) return;
          // K5: CAS — bersih hanya bila tidak ada edit selama in-flight; JANGAN menulis `rec` pra-request
          return TFidmap.mapPut("mindmap", sid, op.cid)
            .then(() => markPushed("mindmaps", op.cid, sentRev, updatedAtOf(res), sid, null))
            .then(() => advanceMindmapBase(op.cid, res.data, rec))
            .then(() => (linked && noteSid != null
              ? TFdb.mutate("mindmaps", op.cid, (cur) => (cur && cur.source_note_id == null ? Object.assign({}, cur, { source_note_id: noteSid }) : undefined))
              : null))
            .then(() => TFoutbox.outboxRemove(op.qid))
            .then(() => requeueIfDirty("mindmaps", "mindmap", op.cid))
            .then(() => { result.pushed++; });
        });
      }
      if (linked && res.status === 404) return dropLinkedLocal(op, null); // catatan tidak tersedia untukmu / di Sampah
      if (classify(res) === "forbidden") { return accessLost("mindmaps", op.cid, op, result); }
      return failPermanent("mindmaps", op.cid, res, op, result);
    });
  }

  // POST ulang setelah PUT 404 sukses: record mengadopsi baris server baru (idmap lama sudah dihapus pemanggil).
  function adoptRecreated(op, res2, sentRev, result) {
    const nid = res2.data.id;
    return TFidmap.mapPut("mindmap", nid, op.cid)
      .then(() => TFdb.mutate("mindmaps", op.cid, (cur) => {
        if (!cur) return undefined;
        const next = Object.assign({}, cur, { server_id: nid });
        delete next.recreate_of_sid;
        const ua = updatedAtOf(res2);
        if (ua != null) next.base_rev = ua; // baris server baru → base_rev-nya
        next.dirty = ((cur.rev || 0) === sentRev && !cur.deleted) ? 0 : 1;
        return next;
      }))
      .then((cur) => advanceMindmapBase(op.cid, res2.data, cur))
      .then(() => TFoutbox.outboxRemove(op.qid))
      .then(() => requeueIfDirty("mindmaps", "mindmap", op.cid))
      .then(() => { result.pushed++; });
  }
  // PUT peta tertaut 404: POST ulang SELALU dengan source_note_id (R15) — server mengembalikan peta tertaut
  // catatan itu (yang ada / baru); bila sudah dipetakan ke record lokal lain → gabung. Catatan hilang di
  // perangkat ini atau POST 404 (catatan tidak tersedia / di Sampah) → peta lokal dihapus.
  function recreateLinked(op, transport, result, rec, sid, sentRev) {
    return linkedNoteSid(rec).then((n) => {
      if (n.gone) return dropLinkedLocal(op, sid);
      if (n.sid == null) return; // tahan (R15): catatan belum punya id server → jangan POST tanpa source_note_id
      return send(transport, "POST", "/api/mindmaps", mindmapToCreatePayload(rec, n.sid)).then((res2) => {
        if (ok(res2)) {
          return TFidmap.mapDelete("mindmap", sid)
            .then(() => adoptLinkedCreate(op, res2.data.id, result))
            .then((done) => (done ? null : adoptRecreated(op, res2, sentRev, result)));
        }
        if (res2.status === 404) return dropLinkedLocal(op, sid);
        if (classify(res2) === "forbidden") { return accessLost("mindmaps", op.cid, op, result); }
        return failPermanent("mindmaps", op.cid, res2, op, result);
      });
    });
  }

  function opMindmapUpdate(op, transport, result) {
    return Promise.all([getMindmapRaw(op.cid), TFidmap.serverIdOf(op.cid), heldByMindmapRestore(op.cid)]).then(([rec, sid, held]) => {
      if (held) return; // tahan: baris server sedang dipulihkan dari Sampah (penanda then_restore_sid)
      if (!rec || sid == null) return TFoutbox.outboxRemove(op.qid);
      if (rec.conflict) return TFoutbox.outboxRemove(op.qid); // held until user resolves
      const sentRev = rec.rev || 0;
      return send(transport, "PUT", "/api/mindmaps/" + sid, mindmapToUpdatePayload(rec)).then((res) => {
        if (ok(res)) {
          // K5: CAS — edit selama in-flight (rev naik) → tetap dirty, versi terbaru dikirim ulang
          return markPushed("mindmaps", op.cid, sentRev, updatedAtOf(res), null, null)
            .then(() => advanceMindmapBase(op.cid, res.data, rec))
            .then(() => TFoutbox.outboxRemove(op.qid))
            .then(() => requeueIfDirty("mindmaps", "mindmap", op.cid))
            .then(() => { result.pushed++; });
        }
        const linked = TFmm.isLinked(rec);
        if (linked && linkedTreeRejected(res)) {
          // tidak pernah salinan konflik untuk peta tertaut; record dibiarkan apa adanya
          if (!linkedTreeWarned.has(op.cid)) {
            linkedTreeWarned.add(op.cid);
            try { console.warn("[syncpush] LINKED_TREE_REJECTED: op update peta tertaut dibuang", op.cid); } catch (_) {}
          }
          // Bersihkan dirty (CAS rev) supaya pull tidak mengantre ulang 400 yang sama tiap siklus; pohon di
          // data_json peta tertaut pasti tidak sah → kembali ke view-state default.
          return TFdb.mutate("mindmaps", op.cid, (cur) => {
            if (!cur || (cur.rev || 0) !== sentRev) return undefined;
            const next = Object.assign({}, cur, { dirty: 0 });
            if (hasNodeData(cur.data_json)) next.data_json = linkedDefaultView();
            return next;
          }).then(() => TFoutbox.outboxRemove(op.qid));
        }
        const current = linked ? null : revMismatchRow(res);
        if (current) return mindmapRevMismatch(op, current, sentRev, rec.base_rev, result);
        const kind = classify(res);
        if (kind === "gone" && linked) return recreateLinked(op, transport, result, rec, sid, sentRev);
        if (kind === "gone") {
          if (rec.list_id != null) {
            return TFdb.mutate("mindmaps", op.cid, (cur) => (cur ? Object.assign({}, cur, { conflict: "remote_deleted" }) : undefined))
              .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.failed++; });
          }
          return freshRecreateClientId("mindmaps", op.cid, sid).then((rec2) => {
            if (!rec2) return TFoutbox.outboxRemove(op.qid);
            return send(transport, "POST", "/api/mindmaps", mindmapToCreatePayload(rec2)).then((res2) => {
              if (ok(res2)) {
                return TFidmap.mapDelete("mindmap", sid).then(() => adoptRecreated(op, res2, sentRev, result));
              }
              if (classify(res2) === "forbidden") { return accessLost("mindmaps", op.cid, op, result); }
              return failPermanent("mindmaps", op.cid, res2, op, result);
            });
          });
        }
        if (kind === "forbidden") { return accessLost("mindmaps", op.cid, op, result); }
        return failPermanent("mindmaps", op.cid, res, op, result);
      });
    });
  }

  // Op delete mindmap (Sampah, spec #5). Pengguna bisa memulihkan peta (mindmaptrash → restoreLocal) SEBELUM atau
  // SELAMA DELETE terkirim: record lokal hanya dihapus bila masih `deleted` (cek di dalam transaksi). Bila sudah
  // dipulihkan saat DELETE in-flight dan server sudah memindahkannya ke Sampah, op ini diubah di tempat (qid sama →
  // tetap mendahului op update susulan) menjadi penanda `then_restore_sid`: POST /api/mindmaps/trash/{sid}/restore
  // mengembalikan baris dengan id & client_id yang SAMA (desain A4), lalu edit lokal ter-push lewat op update biasa.
  // Pulihkan gagal permanen (404 / SOURCE_NOTE_MISSING / 4xx lain) → record jadi lokal baru (op create, client_id sama).
  function opMindmapDelete(op, transport, result) {
    if (op.payload && op.payload.then_restore_sid != null) {
      return mindmapRestoreAfterDelete(op, Number(op.payload.then_restore_sid), transport, result);
    }
    return Promise.all([getMindmapRaw(op.cid), TFidmap.serverIdOf(op.cid)]).then(([rec, sid]) => {
      if (rec && !rec.deleted) return TFoutbox.outboxRemove(op.qid); // dipulihkan sebelum terkirim → op basi
      if (sid == null) {
        return removeMindmapIfDeleted(op, null).then(() => {});
      }
      return send(transport, "DELETE", "/api/mindmaps/" + sid, undefined).then((res) => {
        if (ok(res) || res.status === 404) {
          return removeMindmapIfDeleted(op, ok(res) ? sid : null).then((outcome) => {
            if (outcome === "removed") {
              return TFidmap.mapDelete("mindmap", sid).then(() => { result.pushed++; });
            }
            if (outcome === "marked") return mindmapRestoreAfterDelete(Object.assign({}, op, { payload: Object.assign({}, op.payload, { then_restore_sid: sid }) }), sid, transport, result);
            // dipulihkan selama in-flight tetapi server tidak punya salinannya (404) → buat ulang
            return recreateMindmapLocal(op.cid, sid).then(() => { result.pushed++; });
          });
        }
        if (classify(res) === "forbidden") {
          return TFdb.mutate("mindmaps", op.cid, (cur) => {
            if (!cur) return undefined;
            const next = Object.assign({}, cur, { deleted: false, rev: (cur.rev || 0) + 1, notice: { kind: "delete_refused", title: cur.title } });
            if (cur.deleted) next.dirty = cur.dirty_before_delete != null ? cur.dirty_before_delete : 0;
            delete next.trashed_at;
            delete next.dirty_before_delete;
            return next;
          })
            .then(() => TFoutbox.outboxRemove(op.qid))
            .then(() => requeueIfDirty("mindmaps", "mindmap", op.cid))
            .then(() => { result.failed++; });
        }
        return failPermanent(null, null, res, op, result);
      });
    });
  }
  // Satu transaksi (mindmaps + _outbox) setelah DELETE sukses/404:
  //   record hilang / masih deleted → hapus record + op → "removed";
  //   dipulihkan & server memindahkan ke Sampah (markSid) → op ditulis ulang jadi penanda then_restore_sid → "marked";
  //   dipulihkan & server tidak punya salinan → op dibuang → "restored".
  function removeMindmapIfDeleted(op, markSid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      let outcome = "removed";
      const tx = db.transaction(["mindmaps", "_outbox"], "readwrite");
      const ms = tx.objectStore("mindmaps");
      const ob = tx.objectStore("_outbox");
      const r = ms.get(op.cid);
      r.onsuccess = () => {
        const cur = r.result;
        if (!cur || cur.deleted) {
          if (cur) ms.delete(op.cid);
          ob.delete(op.qid);
          return;
        }
        if (markSid != null) {
          outcome = "marked";
          ob.put(Object.assign({}, op, { payload: Object.assign({}, op.payload, { then_restore_sid: markSid }) }));
        } else {
          outcome = "restored";
          ob.delete(op.qid);
        }
      };
      tx.oncomplete = () => resolve(outcome);
      tx.onerror = () => reject(tx.error);
    }));
  }
  // Penanda then_restore_sid: kembalikan baris server dari Sampah untuk record lokal yang dipulihkan.
  function mindmapRestoreAfterDelete(op, sid, transport, result) {
    return getMindmapRaw(op.cid).then((rec) => {
      // dihapus lagi (op delete baru di belakang penanda yang menanganinya) / record hilang → penanda selesai
      if (!rec || rec.deleted) return TFoutbox.outboxRemove(op.qid);
      return send(transport, "POST", "/api/mindmaps/trash/" + sid + "/restore", {}).then((res) => {
        const detail = res && res.data && res.data.detail;
        const code = detail && typeof detail === "object" ? detail.code : null;
        if (ok(res) || (res.status === 409 && code !== "SOURCE_NOTE_MISSING")) {
          // ok → baris kembali dengan id sama; 409 lain = "id ini sudah ada" (sudah dipulihkan di tempat lain)
          const newSid = ok(res) && res.data && res.data.id != null ? res.data.id : sid;
          const remap = newSid !== sid
            ? TFidmap.mapDelete("mindmap", sid).then(() => TFidmap.mapPut("mindmap", newSid, op.cid))
              .then(() => TFdb.mutate("mindmaps", op.cid, (cur) => (cur ? Object.assign({}, cur, { server_id: newSid }) : undefined)))
            : TFidmap.mapPut("mindmap", sid, op.cid);
          return remap
            .then(() => TFoutbox.outboxRemove(op.qid))
            .then(() => requeueIfDirty("mindmaps", "mindmap", op.cid))
            .then(() => { result.pushed++; });
        }
        // 404 (purge) / SOURCE_NOTE_MISSING / 4xx lain → tidak bisa dipulihkan dengan id sama → buat ulang lokal
        return recreateMindmapLocal(op.cid, sid)
          .then(() => TFoutbox.outboxRemove(op.qid))
          .then(() => { result.failed++; });
      });
    });
  }
  // Record lokal tanpa baris server: server_id/base_rev dibuang, dirty, op update/pin dibuang, op create diantre
  // (client_id tetap = client_id/cid record → link node mindmap tetap hidup). Peta tertaut: create menunggu
  // catatan / dibuang bila catatan hilang (opMindmapCreate).
  function recreateMindmapLocal(cid, sid) {
    return (sid != null ? TFidmap.mapDelete("mindmap", sid) : Promise.resolve()).then(() => TFdb.openDB()).then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(["mindmaps", "_outbox"], "readwrite");
      const ms = tx.objectStore("mindmaps");
      const ob = tx.objectStore("_outbox");
      const r = ms.get(cid);
      r.onsuccess = () => {
        const cur = r.result;
        if (!cur || cur.deleted) return;
        const next = Object.assign({}, cur, { server_id: null, base_rev: null, dirty: 1, rev: (cur.rev || 0) + 1 });
        if (next.client_id == null || next.client_id === "") next.client_id = cur.cid;
        ms.put(next);
        const all = ob.getAll();
        all.onsuccess = () => {
          const mine = (all.result || []).filter((o) => o.entity_type === "mindmap" && o.cid === cid);
          for (const o of mine) if (o.op === "update" || o.op === "pin") ob.delete(o.qid);
          if (!mine.some((o) => o.op === "create")) ob.add({ ts: Date.now(), retries: 0, op: "create", entity_type: "mindmap", cid: cid, payload: { cid: cid } });
        };
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  // Op update/pin ditahan selama penanda then_restore_sid untuk cid ini masih antre (baris server masih di Sampah).
  function heldByMindmapRestore(cid) {
    return TFoutbox.outboxByEntity("mindmap", cid).then((ops) =>
      ops.some((o) => o.op === "delete" && o.payload && o.payload.then_restore_sid != null));
  }

  // Op `restore` (cid `trash:<sid>`, payload.server_id) dari Sampah (mindmaptrash.restore, item cermin server).
  // 401/429/5xx/jaringan → send melempar → op tetap antre. Penanda delete `then_restore_sid` BUKAN op ini
  // (ditangani opMindmapDelete). Prinsip offline (ADR-006, tanpa kehilangan diam-diam): restore peta tertaut bisa
  // mengembalikan peta LAIN yang sudah ada (catatan sudah punya peta) dan sering sudah ada di lokal → cid dicari
  // seperti pull (idmap → record dengan server_id / client_id sama → client_id bila bebas → cid baru). Record yang
  // ada dan dirty/deleted TIDAK ditimpa (pull yang merekonsiliasi); record bersih diperbarui dengan pin lokal,
  // client_id lokal dan source_note_cid dipertahankan.
  function markTrashResult(sid, outcome) {
    const T = mindmapTrash();
    return T && T.markRestoreResult ? T.markRestoreResult(sid, outcome) : Promise.resolve();
  }
  function getAllMindmapsRaw() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("mindmaps", "readonly").objectStore("mindmaps").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  // → {cid, mapped} ; mapped = idmap sudah menunjuk row.id → cid.
  function resolveRestoreCid(row) {
    const rowSid = String(row.id);
    const clientId = row.client_id != null && row.client_id !== "" ? String(row.client_id) : null;
    return TFidmap.cidOf("mindmap", row.id).then((mapped) => {
      if (mapped) return { cid: mapped, mapped: true };
      return getAllMindmapsRaw().then((all) => {
        const sameRow = (r) => r.server_id == null || String(r.server_id) === rowSid;
        const existing = all.find((r) => r.server_id != null && String(r.server_id) === rowSid)
          || (clientId ? all.find((r) => sameRow(r) && (r.cid === clientId || (r.client_id != null && String(r.client_id) === clientId))) : null);
        if (existing) return { cid: existing.cid, mapped: false };
        if (!clientId || all.some((r) => r.cid === clientId)) return { cid: TFids.newCid(), mapped: false };
        return Promise.resolve(TFidmap.serverIdOf(clientId)).catch(() => null)
          .then((other) => ({ cid: (other != null && String(other) !== rowSid) ? TFids.newCid() : clientId, mapped: false }));
      });
    });
  }
  function applyRestoredRow(row) {
    return resolveRestoreCid(row).then(({ cid, mapped }) => {
      const noteCidP = row.source_note_id != null ? TFidmap.cidOf("note", row.source_note_id) : Promise.resolve(null);
      return noteCidP.then((noteCid) => {
        let written = false;
        let bound = mapped; // record ini milik row.id (boleh dipetakan)
        return TFdb.mutate("mindmaps", cid, (cur) => {
          if (cur && cur.server_id != null && String(cur.server_id) !== String(row.id)) return undefined; // bentrok: jangan sentuh
          if (cur && cur.server_id != null) bound = true;
          if (cur && (cur.dirty || cur.deleted)) return undefined; // edit / hapus lokal tertunda → pull merekonsiliasi
          const rec = Object.assign(TFmm.recordFromServer(row, cid), { rev: cur ? (cur.rev || 0) + 1 : 1 });
          if (noteCid != null) rec.source_note_cid = noteCid;
          if (cur) {
            rec.pinned = !!cur.pinned;
            if (cur.source_note_cid != null) rec.source_note_cid = cur.source_note_cid;
            if (cur.client_id != null && cur.client_id !== "") rec.client_id = cur.client_id;
          }
          written = true;
          bound = true;
          return rec;
        }).then(() => ((bound && !mapped) ? TFidmap.mapPut("mindmap", row.id, cid) : null))
          .then(() => (written ? { cid } : null));
      });
    });
  }
  function opMindmapRestore(op, transport, result) {
    const sid = op.payload && op.payload.server_id;
    if (sid == null) return TFoutbox.outboxRemove(op.qid);
    return send(transport, "POST", "/api/mindmaps/trash/" + sid + "/restore", {}).then((res) => {
      if (ok(res) && res.data && res.data.id != null) {
        const row = res.data;
        return applyRestoredRow(row)
          .then((written) => markTrashResult(sid, "ok")
            .then(() => TFoutbox.outboxRemove(op.qid))
            .then(() => { if (written) notifyMindmapSynced([written.cid], [row.id]); result.pushed++; }));
      }
      const detail = res && res.data && res.data.detail;
      const code = detail && typeof detail === "object" ? detail.code : null;
      // 409 tanpa kode = "id ini sudah ada": retry setelah respons POST hilang → sudah dipulihkan; pull membawa barisnya
      if (res.status === 409 && !code) {
        return markTrashResult(sid, "ok").then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; });
      }
      let outcome = "failed";
      if (res.status === 404) outcome = "gone";
      else if (res.status === 409 && code === "SOURCE_NOTE_MISSING") outcome = "source_note_missing";
      return markTrashResult(sid, outcome)
        .then(() => TFoutbox.outboxRemove(op.qid))
        .then(() => { result.failed++; });
    });
  }

  function opMindmapPin(op, transport, result) {
    return Promise.all([getMindmapRaw(op.cid), TFidmap.serverIdOf(op.cid), heldByMindmapRestore(op.cid)]).then(([rec, sid, held]) => {
      if (held) return; // tahan: lihat opMindmapUpdate
      if (!rec || sid == null) return TFoutbox.outboxRemove(op.qid);
      return send(transport, "GET", "/api/mindmaps/" + sid, undefined).then((res) => {
        if (!ok(res)) { return failPermanent(null, null, res, op, result); }
        const serverPinned = !!(res.data && res.data.is_pinned);
        if (serverPinned === !!rec.pinned) {
          return TFoutbox.outboxRemove(op.qid).then(() => { result.pushed++; }); // already in sync
        }
        return send(transport, "PATCH", "/api/mindmaps/" + sid + "/pin", { pinned: !!rec.pinned }).then((res2) => {
          if (ok(res2)) { return TFoutbox.outboxRemove(op.qid).then(() => { result.pushed++; }); }
          return failPermanent(null, null, res2, op, result);
        });
      });
    });
  }

  function getChatRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("chat_messages", "readonly").objectStore("chat_messages").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function putChatRaw(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("chat_messages", "readwrite");
      tx.objectStore("chat_messages").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function deleteChatRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("chat_messages", "readwrite");
      tx.objectStore("chat_messages").delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function chatSendPayload(rec, replyServerId) {
    return {
      content: rec.content != null ? rec.content : "",
      task_id: (rec.task_id != null && /^\d+$/.test(String(rec.task_id))) ? Number(rec.task_id) : null,
      note_id: (rec.note_id != null && /^\d+$/.test(String(rec.note_id))) ? Number(rec.note_id) : null,
      file_id: (rec.file_id != null && /^\d+$/.test(String(rec.file_id))) ? Number(rec.file_id) : null,
      msg_type: rec.msg_type || "text",
      reply_to_id: replyServerId != null ? replyServerId : null,
      client_id: rec.cid,
    };
  }
  // reply_to_id is a server int for confirmed targets, or a cid for a still-local target.
  function resolveReplyServerId(rec) {
    const rt = rec.reply_to_id;
    if (rt == null) return Promise.resolve({ serverId: null, hold: false });
    if (typeof rt === "number" || /^\d+$/.test(String(rt))) return Promise.resolve({ serverId: Number(rt), hold: false });
    return TFidmap.serverIdOf(rt).then((sid) => (sid != null ? { serverId: sid, hold: false } : { hold: true }));
  }

  function opChatSend(op, transport, result, pending) {
    return getChatRaw(op.cid).then((rec) => {
      if (!rec) return TFoutbox.outboxRemove(op.qid);
      if (rec.server_id != null) return TFoutbox.outboxRemove(op.qid);
      return resolveReplyServerId(rec).then((rep) => {
        // T10: target balasan belum di server → tahan hanya selama op send-nya masih antre (FIFO: dikirim lebih
        // dulu); target yang tidak punya op lagi (gagal permanen) → kirim tanpa reply_to_id, pesan tidak hilang.
        if (rep.hold && parentCreatePending(pending, rec.reply_to_id)) return;
        const replySid = rep.hold ? null : rep.serverId;
        return send(transport, "POST", "/api/lists/" + rec.list_id + "/messages", chatSendPayload(rec, replySid)).then((res) => {
          if (ok(res)) {
            const sid = res.data.id;
            return TFidmap.mapPut("message", sid, op.cid)
              .then(() => putChatRaw(Object.assign({}, rec, {
                server_id: sid,
                created_at: res.data.created_at != null ? res.data.created_at : rec.created_at,
                file_id: res.data.file_id != null ? res.data.file_id : rec.file_id,
                file_original_name: res.data.file_original_name != null ? res.data.file_original_name : rec.file_original_name,
                file_size: res.data.file_size != null ? res.data.file_size : rec.file_size,
                file_mime_type: res.data.file_mime_type != null ? res.data.file_mime_type : rec.file_mime_type,
                file_is_deleted: res.data.file_is_deleted != null ? res.data.file_is_deleted : (rec.file_is_deleted || 0),
                pending: 0
              })))
              .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; });
          }
          if (classify(res) === "forbidden") {
            // pesan optimistis ke list yang aksesnya hilang: tidak ada versi server untuk diadopsi → hapus lokal
            return deleteChatRaw(op.cid).then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.failed++; });
          }
          // 4xx permanen: pesan tetap pending + sync_error (tidak dikirim ulang otomatis)
          return failPermanent("chat_messages", op.cid, res, op, result);
        });
      });
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
        return failPermanent(null, null, res, op, result);
      });
    });
  }

  // cid yang masih punya op create (task/habit/note/mindmap/drawing) atau send (pesan) → induk yang "sedang
  // menunggu dikirim"; op anak yang bergantung padanya ditahan (T10), bukan dibuang.
  function pendingCreateCids(ops) {
    return new Set((ops || []).filter((o) => o.op === "create" || o.op === "send").map((o) => o.cid));
  }

  function processOp(op, transport, tagsFor, habitTagsFor, result, pending) {
    if (op.entity_type === "task" && op.op === "create") return opCreate(op, transport, tagsFor, result, pending);
    if (op.entity_type === "task" && op.op === "update") return opUpdate(op, transport, tagsFor, result, pending);
    if (op.entity_type === "task" && op.op === "delete") return opDelete(op, transport, result);
    if (op.entity_type === "recurring_exception" && op.op === "mark_occurrence") return opMark(op, transport, result, pending);
    if (op.entity_type === "habit" && op.op === "create") return opHabitCreate(op, transport, habitTagsFor, result);
    if (op.entity_type === "habit" && op.op === "update") return opHabitUpdate(op, transport, habitTagsFor, result);
    if (op.entity_type === "habit" && op.op === "delete") return opHabitDelete(op, transport, result);
    if (op.entity_type === "habit_log" && op.op === "checkin") return opHabitCheckin(op, transport, result, pending);
    if (op.entity_type === "habit_log" && op.op === "uncheck") return opHabitUncheck(op, transport, result, pending);
    if (op.entity_type === "note" && op.op === "create") return opNoteCreate(op, transport, result);
    if (op.entity_type === "note" && op.op === "update") return opNoteUpdate(op, transport, result);
    if (op.entity_type === "note" && op.op === "delete") return opNoteDelete(op, transport, result);
    if (op.entity_type === "note" && op.op === "pin") return opNotePin(op, transport, result);
    if (op.entity_type === "drawing" && op.op === "create") return opDrawingCreate(op, transport, result);
    if (op.entity_type === "drawing" && op.op === "update") return opDrawingUpdate(op, transport, result);
    if (op.entity_type === "drawing" && op.op === "delete") return opDrawingDelete(op, transport, result);
    if (op.entity_type === "drawing" && op.op === "upsert") return opDrawingUpsert(op, transport, result);
    if (op.entity_type === "drawing" && op.op === "pin") return opDrawingPin(op, transport, result);
    if (op.entity_type === "mindmap" && op.op === "create") return opMindmapCreate(op, transport, result, pending);
    if (op.entity_type === "mindmap" && op.op === "update") return opMindmapUpdate(op, transport, result);
    if (op.entity_type === "mindmap" && op.op === "delete") return opMindmapDelete(op, transport, result);
    if (op.entity_type === "mindmap" && op.op === "pin") return opMindmapPin(op, transport, result);
    if (op.entity_type === "mindmap" && op.op === "restore") return opMindmapRestore(op, transport, result);
    if (op.entity_type === "message" && op.op === "send") return opChatSend(op, transport, result, pending);
    if (op.entity_type === "context" && op.op === "create") return opContextCreate(op, transport, result);
    return TFoutbox.outboxRemove(op.qid);
  }

  function getAllNotesRaw() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("scratchpad_notes", "readonly").objectStore("scratchpad_notes").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }

  function healStrandedNotes() {
    const appendOp = TFoutbox.outboxAppend || TFoutbox.outboxAdd;
    return TFoutbox.outboxAll().then((ops) => {
      const noteCreateCids = new Set(
        ops.filter((o) => o.entity_type === "note" && o.op === "create").map((o) => o.cid)
      );
      return getAllNotesRaw().then((allNotes) => {
        let chain = Promise.resolve(0);
        for (const r of allNotes) {
          // sync_error (4xx permanen) / conflict (access_lost): JANGAN antre ulang — tunggu keputusan pengguna
          if (r.server_id == null && !r.deleted && !r.sync_error && !r.conflict && !noteCreateCids.has(r.cid)) {
            chain = chain.then((count) =>
              appendOp({
                entity_type: "note",
                op: "create",
                cid: r.cid,
              }).then(() => count + 1)
            );
          }
        }
        return chain;
      });
    });
  }

  function getAllDrawingsRaw() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("drawings", "readonly").objectStore("drawings").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }

  function healStrandedDrawings() {
    const appendOp = TFoutbox.outboxAppend || TFoutbox.outboxAdd;
    return TFoutbox.outboxAll().then((ops) => {
      const drawingCreateCids = new Set(
        ops.filter((o) => o.entity_type === "drawing" && o.op === "create").map((o) => o.cid)
      );
      return getAllDrawingsRaw().then((allDrawings) => {
        let chain = Promise.resolve(0);
        for (const r of allDrawings) {
          // sync_error (mis. 422 data terlalu besar) / conflict: JANGAN antre ulang tiap sync (T13)
          if (r.server_id == null && !r.deleted && !r.sync_error && !r.conflict && r.note_cid === undefined && !drawingCreateCids.has(r.cid)) {
            chain = chain.then((count) => {
              const tagP = (TFtag && TFtag.getEntityTags) ? TFtag.getEntityTags("drawing", r.cid).then((ts) => ts.map((t) => t.name)) : Promise.resolve([]);
              // Payload metadata saja: push create membaca data terkini dari blob record.
              return tagP.then((tagNames) =>
                appendOp({
                  entity_type: "drawing",
                  op: "create",
                  cid: r.cid,
                  payload: {
                    title: r.title,
                    svg_preview: r.svg_preview,
                    is_pinned: r.is_pinned,
                    tags: tagNames || [],
                  },
                }).then(() => count + 1)
              );
            });
          }
        }
        return chain;
      });
    });
  }

  // Kanban tahap: entri pending yang kehilangan op create-nya (mis. outbox dibersihkan) diantre ulang.
  // Baca pending gagal → tidak ada yang diantre kali ini (bukan error push).
  function healStrandedContexts() {
    if (!TFcontexts || typeof TFcontexts.pendingList !== "function") return Promise.resolve(0);
    const appendOp = TFoutbox.outboxAppend || TFoutbox.outboxAdd;
    return Promise.all([TFoutbox.outboxAll(), TFcontexts.pendingList().catch(() => [])]).then(([ops, pending]) => {
      const queued = new Set(ops.filter((o) => o.entity_type === "context" && o.op === "create").map((o) => String(o.cid)));
      let chain = Promise.resolve(0);
      for (const c of pending) {
        if (!c || c.cid == null || queued.has(String(c.cid))) continue;
        queued.add(String(c.cid));
        chain = chain.then((count) =>
          appendOp({ entity_type: "context", op: "create", cid: c.cid, payload: { cid: c.cid } }).then(() => count + 1));
      }
      return chain;
    });
  }

  let _running = false;
  function pushOutbox(transport, opts) {
    if (_running) return Promise.resolve({ pushed: 0, failed: 0, remaining: -1, busy: true });
    _running = true;
    opts = opts || {};
    const tagsFor = opts.tagsFor || ((cid) => TFtag.getEntityTags("task", cid).then((ts) => ts.map((t) => t.name)));
    const habitTagsFor = opts.habitTagsFor || ((cid) => TFtag.getEntityTags("habit", cid).then((ts) => ts.map((t) => t.name)));
    const result = { pushed: 0, failed: 0, remaining: 0, requeued: 0, merged: 0 };
    let stopped = false;
    let timeouts = 0;
    let pending = null; // T10: Set cid dengan op create/send saat drain dimulai
    return Promise.resolve()
      .then(() => (TFrepo && TFrepo.upgradeLegacyDrawingOps ? TFrepo.upgradeLegacyDrawingOps().catch(() => 0) : 0))
      .then(() => healStrandedNotes())
      .then(() => healStrandedDrawings())
      .then(() => healStrandedContexts())
      .then(() => TFoutbox.outboxAll())
      .then((ops) => { pending = pendingCreateCids(ops); return ops.slice().sort((a, b) => a.qid - b.qid); })
      .then((ops) => ops.reduce((chain, op) => chain.then(() => {
        if (stopped) return;
        return processOp(op, transport, tagsFor, habitTagsFor, result, pending).catch((err) => {
          if (err && err.__auth) {
            stopped = true; // 401: sesi berakhir → hentikan drain, op tetap antre (dikirim setelah login ulang)
            result.authExpired = true;
          } else if (err && err.__timeout && ++timeouts < 2) {
            result.failed++; // satu request lambat (mis. upload besar) → op tetap antre, op lain tetap dikirim
          } else if (err && err.__network) {
            stopped = true; // Actual network loss / offline (atau timeout berulang), stop remaining queue
          } else {
            result.failed++; // 429/5xx/error tak terduga pada op ini: op tetap antre, op lain tetap dikirim
          }
        });
      }), Promise.resolve()))
      .then(() => TFoutbox.outboxAll())
      .then((rem) => { result.remaining = rem.length; return result; })
      .then((r) => { _running = false; return r; }, (e) => { _running = false; throw e; });
  }

  const exported = {
    taskToCreatePayload, taskToUpdatePayload, markPayload, habitToCreatePayload, habitToUpdatePayload, checkinPayload,
    noteToCreatePayload, noteToUpdatePayload, mindmapToCreatePayload, mindmapToUpdatePayload,
    healStrandedNotes, healStrandedDrawings, healStrandedContexts, pushOutbox, inflightDrawingData, classify, markSyncError,
    // CAS/rev helper bersama (prinsip 4) — dipakai juga workstream D (mindmap)
    tsEpoch, tsNewer, markPushed, requeueIfDirty, ensureEntityOp, pendingCreateCids,
  };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.syncpush = exported; }
  return exported;
});
