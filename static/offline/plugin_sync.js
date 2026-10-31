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
    for (const fn of Array.from(listeners)) {
      try {
        const r = fn(Object.assign({}, d, { ids: d.ids.slice() }));
        if (r && typeof r.then === "function") r.then(null, (e) => warn(e));
      } catch (e) { warn(e); }
    }
    dispatch("tf:plugin-records", d);
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
    _internals: { runTx, writeLocal, emit, dispatch, checkKey, checkScope, checkData, copy, isLive, listeners, RECORDS, KV },
  };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.pluginsync = exported; }
  return exported;
});
