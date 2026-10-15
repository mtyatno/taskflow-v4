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
  const TFblob = req("./blobstore.js", root.TF && root.TF.blobstore);
  const TFrepo = req("./drawingrepo.js", root.TF && root.TF.drawingrepo);
  // noterepo: salinan konflik (prinsip 7) & rewrite [tasklink:cid] (S15). Dibaca malas: di browser modul lama
  // dari cache SW bisa tanpa fungsi itu → jalur lama tetap dipakai.
  function noteRepo() {
    try { return isNode ? require("./noterepo.js") : (root.TF && root.TF.noterepo); } catch (_) { return null; }
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
      client_id: clientIdOf(record),
    };
  }

  function taskToUpdatePayload(record, tagNames) {
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
    return p;
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
  function mindmapToCreatePayload(record) {
    return {
      title: record.title != null ? record.title : "Untitled",
      data_json: record.data_json != null ? record.data_json : MM_DEFAULT_DATA,
      list_id: record.list_id != null ? record.list_id : null,
      client_id: clientIdOf(record),
    };
  }
  function mindmapToUpdatePayload(record) {
    const p = mindmapToCreatePayload(record);
    delete p.client_id;
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
      return Promise.all([parentP, tagsOf(op.cid, tagsFor)]).then(([parentSid, tags]) => {
        // T10: induk belum punya server id tapi create-nya masih antre → tahan (jangan kirim parent_id null)
        if (rec.parent_cid && parentSid == null && parentCreatePending(pending, rec.parent_cid)) return;
        const sentRev = rec.rev || 0;
        return send(transport, "POST", "/api/tasks", taskToCreatePayload(rec, tags, parentSid != null ? parentSid : null)).then((res) => {
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

  function opUpdate(op, transport, tagsFor, result) {
    return Promise.all([getTaskRaw(op.cid), TFidmap.serverIdOf(op.cid)]).then(([rec, sid]) => {
      if (!rec || sid == null) return TFoutbox.outboxRemove(op.qid);
      if (rec.conflict) return; // held until user resolves the conflict
      return tagsOf(op.cid, tagsFor).then((tags) => {
        const sentRev = rec.rev || 0;
        return send(transport, "PUT", "/api/tasks/" + sid, taskToUpdatePayload(rec, tags)).then((res) => {
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
        return failPermanent(null, null, res, op, result);
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
        result.conflictCopies = (result.conflictCopies || 0) + 1;
        if (r && r.copy) dispatchWindowEvent("noteSaved", { source: "syncpush", cids: [op.cid, r.copy.cid] });
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
            return send(transport, "POST", "/api/scratchpad", noteToCreatePayload(rec, tags, taskSids)).then((res2) => {
              if (ok(res2)) {
                const nid = res2.data.id;
                return TFidmap.mapDelete("note", sid)
                  .then(() => TFidmap.mapPut("note", nid, op.cid))
                  .then(() => TFdb.mutate("scratchpad_notes", op.cid, (cur) => {
                    if (!cur) return undefined;
                    const next = Object.assign({}, cur, { server_id: nid });
                    const ua = updatedAtOf(res2);
                    if (ua != null) next.base_rev = ua; // baris server baru → base_rev-nya
                    next.dirty = ((cur.rev || 0) === sentRev && !cur.deleted) ? 0 : 1;
                    return next;
                  }))
                  .then(() => TFoutbox.outboxRemove(op.qid))
                  .then(() => requeueIfDirty("scratchpad_notes", "note", op.cid))
                  .then(() => { result.pushed++; });
              }
              if (classify(res2) === "forbidden") { return accessLost("scratchpad_notes", op.cid, op, result); }
              return failPermanent("scratchpad_notes", op.cid, res2, op, result);
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
          return (rec
              ? putNoteRaw(Object.assign({}, rec, { deleted: false, dirty: 0, notice: { kind: "delete_refused", title: rec.title } }))
              : Promise.resolve())
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
  function putDrawingRaw(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("drawings", "readwrite");
      tx.objectStore("drawings").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  // Data drawing yang sedang dikirim (cid → data_json). Pull memakai ini untuk mengenali gema push sendiri
  // (server sudah menerima PUT tapi record lokal belum ditandai) agar tidak di-merge sebagai perubahan remote.
  const _inflightDrawing = new Map();
  function inflightDrawingData(cid) {
    return _inflightDrawing.has(cid) ? _inflightDrawing.get(cid) : undefined;
  }
  // Data terkini drawing: record + blob dibaca konsisten (sumber kebenaran). Fallback salinan payload op lama.
  function drawingStateOf(cid, payload) {
    return TFrepo.readDrawingState(cid).then(({ rec, bytes }) => {
      // Record data_missing (detail server belum terambil): JANGAN pernah mengirim datanya (server yang benar)
      if (rec && rec.data_missing) return { rec, data: undefined };
      let data = bytes;
      if (data == null && payload && typeof payload.data_json === "string") data = payload.data_json;
      return { rec, data };
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
  function markDrawingPushed(cid, sentRev, updatedAt, sid) {
    return TFrepo.mutateDrawing(cid, (cur) => {
      if (!cur) return undefined;
      const next = Object.assign({}, cur);
      if (sid != null && next.server_id == null) next.server_id = sid;
      // base_rev hanya boleh MAJU (pull bisa sudah menggabung revisi server yang lebih baru selama request)
      if (updatedAt != null && TFrepo.tsNewer(updatedAt, cur.base_rev)) next.base_rev = updatedAt;
      next.dirty = ((cur.rev || 0) === sentRev && !cur.deleted) ? 0 : 1;
      return next;
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
      return drawingTagsOf(rec0.cid, payload.tags).then((tagNames) => drawingStateOf(rec0.cid, payload).then(({ rec, data }) => {
        if (!rec) return TFoutbox.outboxRemove(op.qid);
        if (rec.server_id != null) return TFoutbox.outboxRemove(op.qid);
        if (rec.deleted) return TFoutbox.outboxRemove(op.qid);
        const sentRev = rec.rev || 0;
        const dataJson = data != null ? data : "{}";
        _inflightDrawing.set(rec.cid, dataJson);
        return send(transport, "POST", "/api/drawings", {
          title: rec.title || payload.title || "Untitled Drawing",
          data_json: dataJson,
          svg_preview: rec.svg_preview || "",
          is_pinned: rec.is_pinned ? 1 : 0,
          tags: tagNames || [],
          client_id: clientIdOf(rec), // salinan "simpan sebagai baru" punya client_id segar (bukan cid lama)
        }).then((res) => {
          if (ok(res) && res.data && res.data.id != null) {
            const sid = res.data.id;
            return TFidmap.mapPut("drawing", sid, rec.cid)
              .then(() => markDrawingPushed(rec.cid, sentRev, res.data.updated_at, sid))
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
        return tagsP.then((tags) => drawingStateOf(rec0.cid, payload).then(({ rec, data }) => {
          if (!rec) return TFoutbox.outboxRemove(op.qid);
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
              return markDrawingPushed(rec.cid, sentRev, res.data && res.data.updated_at != null ? res.data.updated_at : null, null)
                .then(() => TFoutbox.outboxRemove(op.qid))
                .then(() => requeueDrawingIfDirty(rec.cid))
                .then(() => { result.pushed++; });
            }
            const kind = classify(res);
            if (kind === "forbidden") { return accessLost("drawings", op.cid, op, result); }
            // 404 = dihapus di server → buang op; record tetap dirty, pull yang merekonsiliasi (S2: workstream D).
            if (kind === "gone") { result.failed++; return TFoutbox.outboxRemove(op.qid); }
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
      if (sid == null) return TFoutbox.outboxRemove(op.qid);
      return send(transport, "DELETE", "/api/drawings/" + sid, undefined).then((res) => {
        if (ok(res)) { return TFoutbox.outboxRemove(op.qid).then(() => { result.pushed++; }); }
        return failPermanent(null, null, res, op, result);
      });
    });
  }

  function opDrawingUpsert(op, transport, result) {
    return getDrawingRaw(op.cid).then((rec) => {
      if (!rec) return TFoutbox.outboxRemove(op.qid);
      return TFidmap.serverIdOf(rec.note_cid).then((noteSid) => {
        if (noteSid == null) return; // hold: note not pushed yet (FIFO → note create runs first; retry next drain)
        return Promise.resolve(_BlobStore.getBytes(rec.blob_ref)).then((dataJson) =>
          send(transport, "PUT", "/api/drawings/" + noteSid, { data_json: dataJson, svg_preview: rec.svg_preview || "" }).then((res) => {
            if (ok(res)) {
              return putDrawingRaw(Object.assign({}, rec, { dirty: 0, base_rev: res.data && res.data.updated_at != null ? res.data.updated_at : rec.base_rev }))
                .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; });
            }
            return failPermanent("drawings", op.cid, res, op, result);
          }));
      });
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
  function putMindmapRaw(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("mindmaps", "readwrite");
      tx.objectStore("mindmaps").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
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

  function opMindmapCreate(op, transport, result) {
    return getMindmapRaw(op.cid).then((rec) => {
      if (!rec) return TFoutbox.outboxRemove(op.qid);
      if (rec.server_id != null) return TFoutbox.outboxRemove(op.qid);
      if (rec.conflict) return TFoutbox.outboxRemove(op.qid); // held until user resolves (access_lost)
      return send(transport, "POST", "/api/mindmaps", mindmapToCreatePayload(rec)).then((res) => {
        if (ok(res)) {
          const sid = res.data.id;
          return TFidmap.mapPut("mindmap", sid, op.cid)
            .then(() => putMindmapRaw(Object.assign({}, rec, { server_id: sid, dirty: 0, base_rev: res.data && res.data.updated_at != null ? res.data.updated_at : rec.base_rev })))
            .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; });
        }
        if (classify(res) === "forbidden") { return accessLost("mindmaps", op.cid, op, result); }
        return failPermanent("mindmaps", op.cid, res, op, result);
      });
    });
  }

  function opMindmapUpdate(op, transport, result) {
    return Promise.all([getMindmapRaw(op.cid), TFidmap.serverIdOf(op.cid)]).then(([rec, sid]) => {
      if (!rec || sid == null) return TFoutbox.outboxRemove(op.qid);
      if (rec.conflict) return TFoutbox.outboxRemove(op.qid); // held until user resolves
      return send(transport, "PUT", "/api/mindmaps/" + sid, mindmapToUpdatePayload(rec)).then((res) => {
        if (ok(res)) {
          return putMindmapRaw(Object.assign({}, rec, { dirty: 0, base_rev: res.data && res.data.updated_at != null ? res.data.updated_at : rec.base_rev }))
            .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; });
        }
        const kind = classify(res);
        if (kind === "gone") {
          if (rec.list_id != null) {
            return putMindmapRaw(Object.assign({}, rec, { conflict: "remote_deleted" }))
              .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.failed++; });
          }
          return send(transport, "POST", "/api/mindmaps", mindmapToCreatePayload(rec)).then((res2) => {
            if (ok(res2)) {
              const nid = res2.data.id;
              return TFidmap.mapDelete("mindmap", sid)
                .then(() => TFidmap.mapPut("mindmap", nid, op.cid))
                .then(() => putMindmapRaw(Object.assign({}, rec, { server_id: nid, dirty: 0, base_rev: res2.data && res2.data.updated_at != null ? res2.data.updated_at : rec.base_rev })))
                .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; });
            }
            if (classify(res2) === "forbidden") { return accessLost("mindmaps", op.cid, op, result); }
            return failPermanent("mindmaps", op.cid, res2, op, result);
          });
        }
        if (kind === "forbidden") { return accessLost("mindmaps", op.cid, op, result); }
        return failPermanent("mindmaps", op.cid, res, op, result);
      });
    });
  }

  function opMindmapDelete(op, transport, result) {
    return TFidmap.serverIdOf(op.cid).then((sid) => {
      if (sid == null) {
        return deleteMindmapRaw(op.cid).then(() => TFoutbox.outboxRemove(op.qid));
      }
      return send(transport, "DELETE", "/api/mindmaps/" + sid, undefined).then((res) => {
        if (ok(res) || res.status === 404) {
          return TFidmap.mapDelete("mindmap", sid)
            .then(() => deleteMindmapRaw(op.cid))
            .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; });
        }
        if (classify(res) === "forbidden") {
          return getMindmapRaw(op.cid).then((rec) =>
            (rec
              ? putMindmapRaw(Object.assign({}, rec, { deleted: false, dirty: 0, notice: { kind: "delete_refused", title: rec.title } }))
              : Promise.resolve()))
            .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.failed++; });
        }
        return failPermanent(null, null, res, op, result);
      });
    });
  }

  function opMindmapPin(op, transport, result) {
    return Promise.all([getMindmapRaw(op.cid), TFidmap.serverIdOf(op.cid)]).then(([rec, sid]) => {
      if (!rec || sid == null) return TFoutbox.outboxRemove(op.qid);
      return send(transport, "GET", "/api/mindmaps/" + sid, undefined).then((res) => {
        if (!ok(res)) { return failPermanent(null, null, res, op, result); }
        const serverPinned = !!(res.data && res.data.is_pinned);
        if (serverPinned === !!rec.pinned) {
          return TFoutbox.outboxRemove(op.qid).then(() => { result.pushed++; }); // already in sync
        }
        return send(transport, "PATCH", "/api/mindmaps/" + sid + "/pin", undefined).then((res2) => {
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
    if (op.entity_type === "task" && op.op === "update") return opUpdate(op, transport, tagsFor, result);
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
    if (op.entity_type === "mindmap" && op.op === "create") return opMindmapCreate(op, transport, result);
    if (op.entity_type === "mindmap" && op.op === "update") return opMindmapUpdate(op, transport, result);
    if (op.entity_type === "mindmap" && op.op === "delete") return opMindmapDelete(op, transport, result);
    if (op.entity_type === "mindmap" && op.op === "pin") return opMindmapPin(op, transport, result);
    if (op.entity_type === "message" && op.op === "send") return opChatSend(op, transport, result, pending);
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

  let _running = false;
  function pushOutbox(transport, opts) {
    if (_running) return Promise.resolve({ pushed: 0, failed: 0, remaining: -1, busy: true });
    _running = true;
    opts = opts || {};
    const tagsFor = opts.tagsFor || ((cid) => TFtag.getEntityTags("task", cid).then((ts) => ts.map((t) => t.name)));
    const habitTagsFor = opts.habitTagsFor || ((cid) => TFtag.getEntityTags("habit", cid).then((ts) => ts.map((t) => t.name)));
    const result = { pushed: 0, failed: 0, remaining: 0 };
    let stopped = false;
    let timeouts = 0;
    let pending = null; // T10: Set cid dengan op create/send saat drain dimulai
    return Promise.resolve()
      .then(() => (TFrepo && TFrepo.upgradeLegacyDrawingOps ? TFrepo.upgradeLegacyDrawingOps().catch(() => 0) : 0))
      .then(() => healStrandedNotes())
      .then(() => healStrandedDrawings())
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
    healStrandedNotes, healStrandedDrawings, pushOutbox, inflightDrawingData, classify, markSyncError,
    // CAS/rev helper bersama (prinsip 4) — dipakai juga workstream D (mindmap)
    tsEpoch, tsNewer, markPushed, requeueIfDirty, ensureEntityOp, pendingCreateCids,
  };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.syncpush = exported; }
  return exported;
});
