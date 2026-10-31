;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // TF.pluginsync — record plugin lokal (spec plugin Fase 1 §5/§7.3; rencana PR 1a-2 Task 4, R8/R10/R11/R17).
  // Penyimpanan di IndexedDB `plugin_records` (+ `plugin_kv` untuk pembukuan sinkron). Setiap tulis lokal =
  // SATU transaksi ["plugin_records", "_outbox"] yang menggantikan op lama record itu (coalescing lewat
  // `op_qid`, O(1)) sehingga selalu ada tepat satu op per record. Push (Task 5) dan pull (Task 6) ditambahkan
  // ke berkas ini; helper `runTx`/`emit`/`toPublic` sengaja dipakai bersama lewat `_internals`.
  const isNode = (typeof module !== "undefined" && module.exports);
  const TFdb = isNode ? require("./db.js") : (root.TF && root.TF.db);
  const TE = isNode ? require("./taskext.js") : (root.TF && root.TF.taskext);
  const TFids = isNode ? require("./ids.js") : (root.TF && root.TF.ids);

  const ENTITY = "plugin";
  const RECORDS = "plugin_records";
  const KV = "plugin_kv";
  const MAX_BYTES = 65536;
  const LIST_DEFAULT = 200;
  const LIST_MAX = 1000;
  const ID_RE = /^[A-Za-z0-9:@._-]{1,80}$/;
  const ENTITY_RE = /^[a-z][a-z0-9_]{0,31}$/;
  const SCOPE_RE = /^(user|list:[1-9][0-9]{0,17})$/;

  function db() { return (TFdb || (root.TF && root.TF.db)).openDB(); }
  const taskext = () => TE || (root.TF && root.TF.taskext);

  function err(code, detail, msg) {
    const e = new Error(msg || (code + (detail ? ": " + detail : "")));
    e.code = code;
    if (detail !== undefined) e.detail = detail;
    return e;
  }

  function opCid(pid, entity, id) { return pid + "/" + entity + "/" + id; }
  function copy(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }

  function newId() {
    try {
      if (root.crypto && typeof root.crypto.randomUUID === "function") return root.crypto.randomUUID();
    } catch (_) {}
    const ids = TFids || (root.TF && root.TF.ids);
    return ids.newCid();
  }

  // ── Validasi (R8/R17, vektor bersama) ──────────────────────────────────────
  function checkKey(pid, entity, id) {
    if (typeof pid !== "string" || !pid) throw err("INVALID", "plugin_id");
    if (typeof entity !== "string" || !ENTITY_RE.test(entity)) throw err("INVALID", "entity");
    if (typeof id !== "string" || !ID_RE.test(id)) throw err("INVALID", "id");
  }
  function checkScope(scope) {
    if (typeof scope !== "string" || !SCOPE_RE.test(scope)) throw err("INVALID", "scope");
  }
  function checkData(data, maxBytes) {
    const T = taskext();
    if (!T.isPlainObject(data)) throw err("INVALID", "data");
    const code = T.checkValue(data);
    if (code === "EXT_TASK_REF") throw err("INVALID", "task_ref");
    if (code) throw err("INVALID", "data");
    const limit = Math.min(MAX_BYTES, Number.isInteger(maxBytes) && maxBytes > 0 ? maxBytes : MAX_BYTES);
    if (T.utf8Bytes(JSON.stringify(data)) > limit) throw err("TOO_LARGE", "size", "TOO_LARGE: data > " + limit + " byte");
  }

  // ── Notifikasi ─────────────────────────────────────────────────────────────
  const listeners = new Set();
  function dispatch(name, detail) {
    try {
      if (root && typeof root.dispatchEvent === "function" && typeof CustomEvent === "function") {
        root.dispatchEvent(new CustomEvent(name, { detail }));
      }
    } catch (_) {}
  }
  // detail: {pluginId, entity, ids, source: "local" | "sync", lost?}
  function emit(detail) {
    const d = Object.assign({}, detail, { ids: (detail.ids || []).slice() });
    if (Array.isArray(detail.lost)) d.lost = detail.lost.slice(); else delete d.lost;
    const each = () => {
      const x = Object.assign({}, d, { ids: d.ids.slice() });
      if (d.lost) x.lost = d.lost.slice();
      return x;
    };
    for (const fn of Array.from(listeners)) {
      try {
        const r = fn(each());
        if (r && typeof r.then === "function") r.then(null, (e) => warn(e));
      } catch (e) { warn(e); }
    }
    dispatch("tf:plugin-records", each());
  }
  function warn(e) { try { console.warn("[pluginsync] pendengar error:", e); } catch (_) {} }
  function subscribe(fn) {
    if (typeof fn !== "function") throw new TypeError("pendengar harus fungsi");
    listeners.add(fn);
    return function off() { listeners.delete(fn); };
  }

  // Transaksi tunggal: body(tx, out, guard) mengisi out.value; resolve setelah oncomplete. Galat sinkron di body
  // atau di callback yang dibungkus guard() membatalkan transaksi dan menolak promise dengan galat itu.
  function runTx(stores, mode, body) {
    return db().then((d) => new Promise((resolve, reject) => {
      let tx;
      try { tx = d.transaction(stores, mode); } catch (e) { reject(e); return; }
      const out = { value: undefined, failed: null };
      const fail = (e) => { if (!out.failed) out.failed = e; try { tx.abort(); } catch (_) {} };
      const guard = (fn) => function () {
        try { return fn.apply(this, arguments); } catch (e) { fail(e); }
      };
      tx.oncomplete = () => resolve(out.value);
      tx.onerror = () => reject(out.failed || tx.error);
      tx.onabort = () => reject(out.failed || tx.error || new Error("pluginsync: transaksi dibatalkan"));
      try { body(tx, out, guard); } catch (e) { fail(e); }
    }));
  }

  // ── Bentuk publik ──────────────────────────────────────────────────────────
  function toPublic(rec) {
    const out = {
      entity: rec.entity,
      id: rec.id,
      scope: rec.scope,
      data: copy(rec.data === undefined ? {} : rec.data),
      updated_at: rec.updated_at,
      version: rec.version == null ? null : rec.version,
      pending: rec.dirty === 1 || rec.dirty === true,
    };
    if (rec.sync_error && rec.sync_error.code) out.error = rec.sync_error.code;
    return out;
  }
  const isLive = (r) => !!r && !r.deleted;

  // ── Tulis lokal + coalescing (R10/R11) ─────────────────────────────────────
  // build(existing | undefined) → record baru + jenis op, atau null (tidak ada perubahan; out.value = false).
  // Satu transaksi: baca record → hapus op lama (op_qid) → tambah op baru → record.op_qid = qid → put.
  function writeLocal(pid, entity, id, build) {
    return runTx([RECORDS, "_outbox"], "readwrite", (tx, out, guard) => {
      const store = tx.objectStore(RECORDS);
      const ob = tx.objectStore("_outbox");
      const g = store.get([pid, entity, id]);
      g.onsuccess = guard(() => {
        const existing = g.result || undefined;
        const built = build(existing);
        if (!built) { out.value = { changed: false }; return; }
        const rec = built.record;
        if (existing && existing.op_qid != null) ob.delete(existing.op_qid);
        const payload = copy(rec);
        delete payload.op_qid;
        const a = ob.add({
          entity_type: ENTITY, op: built.op, cid: opCid(pid, entity, id),
          payload, ts: Date.now(), retries: 0,
        });
        a.onsuccess = guard(() => {
          rec.op_qid = a.result;
          store.put(rec);
          out.value = { changed: true, record: rec };
        });
      });
    }).then((res) => {
      if (res && res.changed) {
        emit({ pluginId: pid, entity, ids: [id], source: "local" });
        dispatch("tf:outbox-queued", { entity: ENTITY, cid: opCid(pid, entity, id) });
      }
      return res;
    });
  }

  function put(pid, entity, id, data, opts) {
    const o = opts || {};
    let rid = id;
    let sc;
    try {
      if (rid === null || rid === undefined) rid = newId();
      checkKey(pid, entity, rid);
      const scope = o.scope === undefined ? "user" : o.scope;
      checkScope(scope);
      checkData(data, o.decl && o.decl.maxBytes);
      sc = scope;
    } catch (e) { return Promise.reject(e); }
    const snap = copy(data);
    return writeLocal(pid, entity, rid, (existing) => {
      if (existing && existing.scope !== sc) throw err("SCOPE_IMMUTABLE", undefined, "scope tidak bisa diubah");
      const rec = {
        plugin_id: pid, entity, id: rid, scope: sc, data: snap,
        updated_at: new Date().toISOString(),
        version: existing && existing.version != null ? existing.version : null,
        deleted: 0, dirty: 1, op_qid: null,
      };
      if (existing && existing.sync_gen !== undefined) rec.sync_gen = existing.sync_gen;
      return { record: rec, op: "upsert" };
    }).then((res) => Object.assign({}, res.record));
  }

  function remove(pid, entity, id) {
    try { checkKey(pid, entity, id); } catch (e) { return Promise.reject(e); }
    return writeLocal(pid, entity, id, (existing) => {
      if (!existing || existing.deleted) return null;
      const rec = Object.assign({}, existing, {
        data: {}, updated_at: new Date().toISOString(), deleted: 1, dirty: 1, op_qid: null,
      });
      delete rec.sync_error;
      return { record: rec, op: "delete" };
    }).then((res) => !!(res && res.changed));
  }

  // ── Baca ───────────────────────────────────────────────────────────────────
  function get(pid, entity, id) {
    try { checkKey(pid, entity, id); } catch (e) { return Promise.reject(e); }
    return runTx([RECORDS], "readonly", (tx, out) => {
      const r = tx.objectStore(RECORDS).get([pid, entity, id]);
      r.onsuccess = () => { out.value = isLive(r.result) ? toPublic(r.result) : null; };
    });
  }

  // list(pid, entity, {scope, limit = 200 (1–1000), after}) → {items, next}. `next` = id terakhir bila masih ada
  // sisa (dipakai sebagai `after`), selain itu null. Tanpa scope: rentang kunci primer; dengan scope: indeks
  // entity_scope + continuePrimaryKey (fallback lewati-maju bila tidak didukung).
  function list(pid, entity, opts) {
    const o = opts || {};
    const limit = o.limit === undefined ? LIST_DEFAULT : o.limit;
    const after = o.after === undefined || o.after === null ? null : o.after;
    try {
      checkKey(pid, entity, "x");
      if (o.scope !== undefined && o.scope !== null) checkScope(o.scope);
      if (!Number.isInteger(limit) || limit < 1 || limit > LIST_MAX) throw err("INVALID", "limit");
      if (after !== null && typeof after !== "string") throw err("INVALID", "after");
    } catch (e) { return Promise.reject(e); }
    const scope = o.scope === undefined ? null : o.scope;
    return runTx([RECORDS], "readonly", (tx, out, guard) => {
      const store = tx.objectStore(RECORDS);
      const items = [];
      let more = false;
      const finish = () => {
        out.value = { items: items.map(toPublic), next: more && items.length ? items[items.length - 1].id : null };
      };
      let req;
      let jumped = false;
      if (scope === null) {
        const lower = after === null ? [pid, entity] : [pid, entity, after];
        req = store.openCursor(IDBKeyRange.bound(lower, [pid, entity, []], after !== null, true));
      } else {
        req = store.index("entity_scope").openCursor(IDBKeyRange.only([pid, entity, scope]));
      }
      req.onsuccess = guard((e) => {
        const c = e.target.result;
        if (!c) { finish(); return; }
        if (scope !== null && after !== null && !jumped) {
          jumped = true;
          if (typeof c.continuePrimaryKey === "function") {
            try { c.continuePrimaryKey([pid, entity, scope], [pid, entity, after]); return; } catch (_) { /* fallback */ }
          }
        }
        const rec = c.value;
        if (after !== null && rec.id <= after) { c.continue(); return; }
        if (isLive(rec)) {
          if (items.length >= limit) { more = true; finish(); return; }
          items.push(rec);
        }
        c.continue();
      });
    });
  }

  // ── Push (Task 5; R12, R13, R16) ───────────────────────────────────────────
  // Kunci record dari op: payload (salinan record) bila lengkap, selain itu cid "<pid>/<entity>/<id>".
  function keyOf(op) {
    const p = op && op.payload;
    if (p && typeof p.plugin_id === "string" && typeof p.entity === "string" && typeof p.id === "string") {
      return [p.plugin_id, p.entity, p.id];
    }
    const s = String((op && op.cid) || "");
    const a = s.indexOf("/");
    const b = a < 0 ? -1 : s.indexOf("/", a + 1);
    if (a <= 0 || b <= a + 1 || b === s.length - 1) return null;
    return [s.slice(0, a), s.slice(a + 1, b), s.slice(b + 1)];
  }
  function newOp(rec, kind) {
    const payload = copy(rec);
    delete payload.op_qid;
    return { entity_type: ENTITY, op: kind, cid: opCid(rec.plugin_id, rec.entity, rec.id), payload, ts: Date.now(), retries: 0 };
  }
  // JSON kanonik (kunci terurut) untuk membandingkan data lokal vs server.
  function canon(v) {
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    if (v && typeof v === "object") {
      return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
    }
    return JSON.stringify(v === undefined ? null : v);
  }
  function adopt(cur, srv) {
    const rec = {
      plugin_id: cur.plugin_id, entity: cur.entity, id: cur.id,
      scope: typeof srv.scope === "string" ? srv.scope : cur.scope,
      data: copy(srv.data && typeof srv.data === "object" ? srv.data : {}),
      updated_at: srv.updated_at != null ? srv.updated_at : cur.updated_at,
      version: srv.version != null ? srv.version : cur.version,
      deleted: 0, dirty: 0, op_qid: null,
    };
    if (cur.sync_gen !== undefined) rec.sync_gen = cur.sync_gen;
    return rec;
  }

  // Satu transaksi ["plugin_records", "_outbox"]: fn(cur | undefined, store, ob, out) setelah membaca record.
  function withRecord(key, fn) {
    return runTx([RECORDS, "_outbox"], "readwrite", (tx, out, guard) => {
      const store = tx.objectStore(RECORDS);
      const ob = tx.objectStore("_outbox");
      const g = store.get(key);
      g.onsuccess = guard(() => fn(g.result || undefined, store, ob, out));
    });
  }
  const emitSync = (key, extra) => emit(Object.assign({ pluginId: key[0], entity: key[1], ids: [key[2]], source: "sync" }, extra || {}));

  // 2xx applied:true. CAS op_qid: record masih milik op ini → adopsi baris server (tombstone/null → hapus keras);
  // diedit selama terbang → hanya version server (edit baru berbasis versi yang baru diterima).
  function ackApplied(key, qid, srv) {
    return withRecord(key, (cur, store, ob, out) => {
      ob.delete(qid);
      if (!cur) return;
      if (cur.op_qid === qid) {
        if (!srv || srv.deleted) { store.delete(key); out.value = cur.deleted ? null : "changed"; return; }
        store.put(adopt(cur, srv));
        out.value = "changed";
      } else if (srv && srv.version != null) {
        cur.version = srv.version;
        store.put(cur);
      }
    }).then((v) => { if (v) emitSync(key); });
  }
  // 2xx applied:false (LWW server menang). Record masih milik op ini → adopsi baris server + lost bila berbeda;
  // diedit selama terbang → biarkan (kiriman berikutnya diputuskan LWW waktu).
  function ackRejected(key, qid, srv) {
    return withRecord(key, (cur, store, ob, out) => {
      ob.delete(qid);
      if (!cur || cur.op_qid !== qid) return;
      const srvDeleted = !!srv.deleted;
      const same = !!cur.deleted === srvDeleted && (srvDeleted || canon(cur.data || {}) === canon(srv.data || {}));
      if (srvDeleted) store.delete(key); else store.put(adopt(cur, srv));
      out.value = { lost: !same };
    }).then((v) => { if (v) emitSync(key, v.lost ? { lost: [key[2]] } : null); });
  }
  // FORBIDDEN_SCOPE: akses ke scope hilang (mis. dikeluarkan dari workspace) → record + op dihapus.
  function forbid(key, qid) {
    return withRecord(key, (cur, store, ob, out) => {
      ob.delete(qid);
      if (!cur) return;
      if (cur.op_qid != null && cur.op_qid !== qid) ob.delete(cur.op_qid);
      store.delete(key);
      out.value = !cur.deleted;
    }).then((v) => { if (v) emitSync(key, { lost: [key[2]] }); });
  }
  // Galat permanen: op dibuang; record tetap dirty 1 + sync_error (hanya bila belum diedit selama terbang —
  // edit baru punya op sendiri). `put` berikutnya menghapus sync_error.
  function markError(key, qid, code, detail) {
    return withRecord(key, (cur, store, ob, out) => {
      ob.delete(qid);
      if (!cur || cur.op_qid !== qid) return;
      cur.op_qid = null;
      cur.sync_error = { code: String(code), at: new Date().toISOString() };
      if (detail !== undefined && detail !== null) cur.sync_error.detail = typeof detail === "string" ? detail : canon(detail);
      store.put(cur);
      out.value = true;
    }).then((v) => { if (v) emitSync(key); });
  }
  function dropOp(qid) {
    return runTx(["_outbox"], "readwrite", (tx) => { tx.objectStore("_outbox").delete(qid); }).then(() => null);
  }

  // pushOp(op, {send, pending, resolveRefs, result}) — R12/R13. Membaca record TERKINI (payload hanya cadangan)
  // sehingga base_version = version terbaru. send(method, path, body) melempar untuk 401/429/5xx/jaringan (op tetap).
  function pushOp(op, opts) {
    const o = opts || {};
    const result = o.result || { pushed: 0, failed: 0 };
    const qid = op && op.qid;
    const key = keyOf(op);
    return runTx([RECORDS, "_outbox"], "readonly", (tx, out) => {
      out.value = { hasOp: false, rec: undefined };
      const g = tx.objectStore("_outbox").get(qid);
      g.onsuccess = () => { out.value.hasOp = !!g.result; };
      if (key) {
        const r = tx.objectStore(RECORDS).get(key);
        r.onsuccess = () => { out.value.rec = r.result || undefined; };
      }
    }).then(({ hasOp, rec }) => {
      if (!hasOp) return null; // sudah di-coalesce/diproses (drain memakai snapshot)
      if (!key || !rec || rec.op_qid !== qid) return dropOp(qid); // record hilang / op yatim
      const data = rec.deleted ? {} : (rec.data || {});
      const refP = !rec.deleted && typeof o.resolveRefs === "function"
        ? o.resolveRefs({ d: data }, o.pending)
        : Promise.resolve({ value: { d: data }, held: [] });
      return Promise.resolve(refP).then((ref) => {
        if (ref && ref.held && ref.held.length) return null; // R13: create task antre → tahan utuh
        const item = {
          entity: rec.entity, id: rec.id, scope: rec.scope,
          data: ref && ref.value && "d" in ref.value ? ref.value.d : data,
          deleted: !!rec.deleted, updated_at: rec.updated_at,
          base_version: rec.version == null ? null : rec.version,
        };
        const path = "/api/plugins/" + encodeURIComponent(rec.plugin_id) + "/records";
        return o.send("POST", path, { items: [item] }).then((res) => onResponse(key, qid, res, result));
      });
    });
  }
  function onResponse(key, qid, res, result) {
    const st = res && res.status;
    if (st >= 200 && st < 300) {
      const results = res.data && Array.isArray(res.data.results) ? res.data.results : [];
      const r = results.find((x) => x && x.entity === key[1] && x.id === key[2]) || null;
      if (!r) { result.failed++; return null; } // respons tak terbaca → op tetap
      if (r.applied === true) return ackApplied(key, qid, r.record || null).then(() => { result.pushed++; });
      if (r.applied === false && r.record && typeof r.record === "object") return ackRejected(key, qid, r.record);
      if (r.error === "FORBIDDEN_SCOPE") return forbid(key, qid);
      result.failed++;
      return markError(key, qid, r.error || "INVALID", r.detail);
    }
    const d = res && res.data && res.data.detail;
    const code = d && typeof d === "object" && typeof d.code === "string" ? d.code : null;
    if (st === 404) return code === "PLUGIN_UNKNOWN" ? markError(key, qid, code) : null; // tanpa kode: jendela deploy
    result.failed++;
    return markError(key, qid, code || ("HTTP_" + st), d && typeof d === "object" ? d.detail : undefined);
  }

  // R16: record dirty tanpa sync_error yang op-nya hilang (crash, outbox dibersihkan) → op baru. knownIds = id
  // plugin di indeks (null = tidak diketahui → semua plugin). Pindai rentang kunci primer per plugin.
  function healStranded(knownIds) {
    const ids = knownIds == null ? null : Array.from(new Set(Array.from(knownIds).filter((s) => typeof s === "string" && s)));
    return runTx([RECORDS, "_outbox"], "readwrite", (tx, out, guard) => {
      out.value = 0;
      const store = tx.objectStore(RECORDS);
      const ob = tx.objectStore("_outbox");
      const enqueue = (rec) => {
        const a = ob.add(newOp(rec, rec.deleted ? "delete" : "upsert"));
        a.onsuccess = guard(() => { rec.op_qid = a.result; store.put(rec); out.value++; });
      };
      const visit = (recs) => {
        for (const rec of recs) {
          if (!(rec.dirty === 1 || rec.dirty === true) || rec.sync_error) continue;
          if (rec.op_qid == null) { enqueue(rec); continue; }
          const g = ob.get(rec.op_qid);
          g.onsuccess = guard(() => {
            const o = g.result;
            if (!o || o.entity_type !== ENTITY || o.cid !== opCid(rec.plugin_id, rec.entity, rec.id)) enqueue(rec);
          });
        }
      };
      const ranges = ids === null ? [undefined] : ids.map((pid) => IDBKeyRange.bound([pid], [pid, []]));
      for (const range of ranges) {
        const r = range === undefined ? store.getAll() : store.getAll(range);
        r.onsuccess = guard(() => visit(r.result || []));
      }
    });
  }

  // R13: setelah POST task `cid` sukses → {"$task": cid} di data record menjadi id server; dirty 1, op di-coalesce,
  // updated_at TIDAK diubah (penulisan teknis tidak boleh memenangkan LWW). Record ber-sync_error dilewati.
  // Gagal di sini tidak boleh menggagalkan op create task → 0.
  function rewriteTaskRefs(cid, sid) {
    const T = taskext();
    const n = Number(sid);
    if (!T || typeof cid !== "string" || !cid || sid == null || !Number.isInteger(n)) return Promise.resolve(0);
    const changed = [];
    return runTx([RECORDS, "_outbox"], "readwrite", (tx, out, guard) => {
      out.value = 0;
      const store = tx.objectStore(RECORDS);
      const ob = tx.objectStore("_outbox");
      const r = store.getAll();
      r.onsuccess = guard(() => {
        for (const rec of r.result || []) {
          if (rec.deleted || rec.sync_error || !T.refsIn(rec.data).some((id) => id === cid)) continue;
          const next = Object.assign({}, rec, {
            data: T.mapRefs(rec.data, (id) => (id === cid ? { $task: n } : { $task: id })),
            dirty: 1, op_qid: null,
          });
          if (rec.op_qid != null) ob.delete(rec.op_qid);
          const a = ob.add(newOp(next, "upsert"));
          a.onsuccess = guard(() => { next.op_qid = a.result; store.put(next); out.value++; changed.push(next); });
        }
      });
    }).then((count) => {
      const groups = new Map();
      for (const rec of changed) {
        const k = rec.plugin_id + "\u0000" + rec.entity;
        if (!groups.has(k)) groups.set(k, { pluginId: rec.plugin_id, entity: rec.entity, ids: [], source: "sync" });
        groups.get(k).ids.push(rec.id);
      }
      for (const g of groups.values()) emit(g);
      if (count) dispatch("tf:outbox-queued", { entity: ENTITY, cids: changed.map((x) => opCid(x.plugin_id, x.entity, x.id)) });
      return count;
    }).catch(() => 0);
  }

  // ── plugin_kv (pembukuan sinkron: kursor, gen, owner) ──────────────────────
  function kvGet(pid, scope, key) {
    return runTx([KV], "readonly", (tx, out) => {
      const r = tx.objectStore(KV).get([pid, scope, key]);
      r.onsuccess = () => { out.value = r.result ? r.result.value : undefined; };
    });
  }
  function kvSet(pid, scope, key, value) {
    return runTx([KV], "readwrite", (tx) => {
      tx.objectStore(KV).put({ plugin_id: pid, scope, key, value });
    }).then(() => undefined);
  }

  const exported = {
    ENTITY, opCid, put, get, list, remove, subscribe, newId, toPublic, kvGet, kvSet,
    pushOp, healStranded, rewriteTaskRefs,
    _internals: { runTx, writeLocal, emit, dispatch, checkKey, checkScope, checkData, copy, isLive, listeners, RECORDS, KV, canon, keyOf },
  };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.pluginsync = exported; }
  return exported;
});
