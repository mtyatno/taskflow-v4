;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Status plugin per akun (spec docs/superpowers/specs/2026-10-31-plugin-fase0b-design.md §6.1; rencana PR B
  // Task 7, R9–R12). Satu-satunya penulis cache _meta `plugins:state:v1` (bentuk 0a kompatibel:
  // {[id]: {enabled, updatedAt, settings?, dirty?}}). Toggle = satu transaksi _meta + _outbox dengan satu op
  // `plugin_state/set` per plugin (coalescing). "Menunggu sinkron" = ada op untuk plugin itu (sumber kebenaran);
  // `dirty` hanya penanda informatif. Peredaman lokal (`plugins:suppressed:v1`) hanya milik perangkat ini.
  const isNode = (typeof module !== "undefined" && module.exports);
  const TFdb = isNode ? require("./db.js") : (root.TF && root.TF.db);

  const STATE_KEY = "plugins:state:v1";
  const OWNER_KEY = "plugins:state:owner:v1";
  const SUPPRESSED_KEY = "plugins:suppressed:v1";
  const ENTITY = "plugin_state";
  const EPOCH = "1970-01-01T00:00:00.000Z";
  const FIELDS = ["enabled", "settings"];

  function db() { return (TFdb || (root.TF && root.TF.db)).openDB(); }
  function isOp(o, id) {
    return !!o && o.entity_type === ENTITY && o.op === "set" && (id == null || o.cid === id);
  }
  function asObj(v) { return (v && typeof v === "object" && !Array.isArray(v)) ? Object.assign({}, v) : {}; }
  function pickFields(src) {
    const out = {};
    const s = src || {};
    for (const k of FIELDS) if (Object.prototype.hasOwnProperty.call(s, k) && s[k] !== undefined) out[k] = s[k];
    return out;
  }
  function validIso(v) { return typeof v === "string" && !isNaN(Date.parse(v)); }
  function fromServer(s) {
    const o = s || {};
    return {
      enabled: (o.enabled === true || o.enabled === false) ? o.enabled : null,
      updatedAt: o.updated_at,
      settings: asObj(o.settings),
    };
  }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  // ── Notifikasi (R12) ───────────────────────────────────────────────────────
  const listeners = new Set();
  function dispatch(name, detail) {
    try {
      if (root && typeof root.dispatchEvent === "function" && typeof CustomEvent === "function") {
        root.dispatchEvent(new CustomEvent(name, { detail }));
      }
    } catch (_) {}
  }
  function notify(ids) {
    if (!ids || !ids.length) return;
    const payload = { ids: ids.slice() };
    for (const fn of Array.from(listeners)) {
      try { fn({ ids: payload.ids.slice() }); } catch (e) {
        try { console.warn("[pluginstate] pendengar error:", e); } catch (_) {}
      }
    }
    dispatch("tf:plugin-state", { ids: payload.ids.slice() });
  }
  function subscribe(fn) {
    if (typeof fn !== "function") throw new TypeError("pendengar harus fungsi");
    listeners.add(fn);
    return function off() { listeners.delete(fn); };
  }

  // Transaksi tunggal: body(tx, out) mengisi out.value; resolve setelah oncomplete.
  function runTx(stores, mode, body) {
    return db().then((d) => new Promise((resolve, reject) => {
      let tx;
      try { tx = d.transaction(stores, mode); } catch (err) { reject(err); return; }
      const out = { value: undefined, failed: null };
      tx.oncomplete = () => resolve(out.value);
      tx.onerror = () => reject(out.failed || tx.error);
      tx.onabort = () => reject(out.failed || tx.error || new Error("pluginstate: transaksi dibatalkan"));
      try { body(tx, out); } catch (err) { out.failed = err; try { tx.abort(); } catch (_) {} }
    }));
  }

  // ── setLocal (R11) ─────────────────────────────────────────────────────────
  function setLocal(id, fields, opts) {
    const f = pickFields(fields);
    if (typeof id !== "string" || !id) return Promise.reject(new TypeError("id plugin wajib string"));
    if (!Object.keys(f).length) return Promise.reject(new TypeError("setLocal butuh enabled atau settings"));
    if ("enabled" in f && f.enabled !== true && f.enabled !== false && f.enabled !== null) {
      return Promise.reject(new TypeError("enabled harus boolean atau null"));
    }
    if ("settings" in f && (!f.settings || typeof f.settings !== "object" || Array.isArray(f.settings))) {
      return Promise.reject(new TypeError("settings harus objek"));
    }
    const now = (opts && typeof opts.now === "function") ? opts.now() : new Date().toISOString();
    return runTx(["_meta", "_outbox"], "readwrite", (tx, out) => {
      const meta = tx.objectStore("_meta");
      const ob = tx.objectStore("_outbox");
      const r = meta.get(STATE_KEY);
      r.onsuccess = () => {
        const st = asObj(r.result);
        st[id] = Object.assign({}, asObj(st[id]), f, { updatedAt: now, dirty: true });
        meta.put(st, STATE_KEY);
        let merged = {};
        const cur = ob.openCursor();
        cur.onsuccess = (e) => {
          const c = e.target.result;
          if (c) {
            if (isOp(c.value, id)) {
              merged = Object.assign(merged, pickFields(c.value.payload));
              c.delete();
            }
            c.continue();
            return;
          }
          const payload = Object.assign({ plugin_id: id }, merged, f, { updated_at: now });
          const a = ob.add({ entity_type: ENTITY, op: "set", cid: id, payload, ts: Date.now(), retries: 0 });
          if (a) a.onsuccess = () => { out.value = a.result; };
        };
      };
    }).then((qid) => {
      notify([id]);
      dispatch("tf:outbox-queued", { entity: ENTITY, cid: id });
      return qid;
    });
  }

  // ── snapshot (R13) ─────────────────────────────────────────────────────────
  function snapshot() {
    return runTx(["_meta", "_outbox"], "readonly", (tx, out) => {
      const meta = tx.objectStore("_meta");
      const res = { state: {}, pending: [], suppressed: {}, owner: null };
      const a = meta.get(STATE_KEY);
      a.onsuccess = () => { res.state = asObj(a.result); };
      const b = meta.get(SUPPRESSED_KEY);
      b.onsuccess = () => { res.suppressed = asObj(b.result); };
      const c = meta.get(OWNER_KEY);
      c.onsuccess = () => { res.owner = c.result == null ? null : String(c.result); };
      const d = tx.objectStore("_outbox").getAll();
      d.onsuccess = () => {
        const ids = [];
        for (const o of d.result || []) if (isOp(o) && ids.indexOf(o.cid) < 0) ids.push(o.cid);
        res.pending = ids;
        out.value = res;
      };
    });
  }

  // ── pull (K15, R10, Q1a) ───────────────────────────────────────────────────
  function pull(rawFetch, opts) {
    const o = opts || {};
    if (o.userId == null) return Promise.resolve({ changed: [], mode: "normal" });
    const userId = String(o.userId);
    const known = Array.isArray(o.known) ? o.known : null;
    const isKnown = (id) => !known || known.indexOf(id) >= 0;
    return Promise.resolve()
      .then(() => rawFetch("/api/plugins/state"))
      .then((res) => {
        if (!res || !res.ok) {
          const err = new Error("http " + (res ? res.status : 0));
          err.status = res ? res.status : 0;
          throw err;
        }
        return res.json();
      })
      .then((body) => {
        const server = asObj(body && body.plugins);
        let queued = false;
        return runTx(["_meta", "_outbox"], "readwrite", (tx, out) => {
          const meta = tx.objectStore("_meta");
          const ob = tx.objectStore("_outbox");
          let local = {};
          let owner;
          const a = meta.get(STATE_KEY);
          a.onsuccess = () => { local = asObj(a.result); };
          const b = meta.get(OWNER_KEY);
          b.onsuccess = () => { owner = b.result; };
          const c = ob.getAll();
          c.onsuccess = () => {
            const ops = (c.result || []).filter((x) => isOp(x));
            const mode = owner == null ? "merge" : (String(owner) !== userId ? "foreign" : "normal");
            const next = mode === "foreign" ? {} : Object.assign({}, local);
            const pending = new Set();
            if (mode === "foreign") {
              for (const op of ops) ob.delete(op.qid);
            } else {
              for (const op of ops) pending.add(op.cid);
            }
            const ids = new Set(Object.keys(server).concat(Object.keys(local)));
            for (const id of ids) {
              if (!isKnown(id)) continue;
              if (pending.has(id)) continue;
              const loc = local[id];
              const s = server[id];
              if (mode === "merge" && loc && loc.enabled === true && !(s && s.enabled === true)) {
                // Lebur pertama: ON dari perangkat 0a naik ke akun dengan waktu aslinya (LWW server memutuskan).
                const at = validIso(loc.updatedAt) ? loc.updatedAt : EPOCH;
                next[id] = Object.assign({}, loc, { dirty: true });
                ob.add({
                  entity_type: ENTITY, op: "set", cid: id,
                  payload: { plugin_id: id, enabled: true, updated_at: at },
                  ts: Date.now(), retries: 0,
                });
                queued = true;
                continue;
              }
              if (s && typeof s === "object") next[id] = fromServer(s);
              else delete next[id];
            }
            const changed = [];
            const all = new Set(Object.keys(local).concat(Object.keys(next)));
            for (const id of all) if (!same(local[id], next[id])) changed.push(id);
            meta.put(next, STATE_KEY);
            meta.put(userId, OWNER_KEY);
            out.value = { changed, mode };
          };
        }).then((res) => {
          notify(res.changed);
          if (queued) dispatch("tf:outbox-queued", { entity: ENTITY });
          return res;
        });
      });
  }

  // Hapus op qid; bila tak ada op lain untuk id → update(entry) menentukan entri baru (undefined = hapus).
  function settleOp(qid, id, update) {
    return runTx(["_meta", "_outbox"], "readwrite", (tx, out) => {
      const meta = tx.objectStore("_meta");
      const ob = tx.objectStore("_outbox");
      if (qid != null) ob.delete(qid);
      const c = ob.getAll();
      c.onsuccess = () => {
        if ((c.result || []).some((o) => isOp(o, id))) { out.value = false; return; }
        const r = meta.get(STATE_KEY);
        r.onsuccess = () => {
          const st = asObj(r.result);
          const prev = st[id];
          const nextEntry = update(prev);
          if (nextEntry === undefined) delete st[id]; else st[id] = nextEntry;
          if (same(prev, st[id])) { out.value = false; return; }
          meta.put(st, STATE_KEY);
          out.value = true;
        };
      };
    }).then((changed) => { if (changed) notify([id]); });
  }

  function ackPushed(qid, id, serverState) {
    return settleOp(qid, id, (prev) => {
      if (serverState && typeof serverState === "object") return fromServer(serverState);
      if (!prev) return prev;
      const e = Object.assign({}, prev);
      delete e.dirty;
      return e;
    });
  }

  function dropOp(qid, id) {
    return settleOp(qid, id, (prev) => {
      if (!prev) return prev;
      const e = Object.assign({}, prev);
      delete e.dirty;
      return e;
    });
  }

  function hasPending(id) {
    return runTx(["_outbox"], "readonly", (tx, out) => {
      const c = tx.objectStore("_outbox").getAll();
      c.onsuccess = () => { out.value = (c.result || []).some((o) => isOp(o, id)); };
    });
  }

  // ── Peredaman lokal (K16, R14) ─────────────────────────────────────────────
  function mutateSuppressed(fn) {
    return runTx(["_meta"], "readwrite", (tx, out) => {
      const meta = tx.objectStore("_meta");
      const r = meta.get(SUPPRESSED_KEY);
      r.onsuccess = () => {
        const cur = asObj(r.result);
        const changed = fn(cur) || [];
        if (changed.length) meta.put(cur, SUPPRESSED_KEY);
        out.value = changed;
      };
    }).then((changed) => { notify(changed); return changed; });
  }

  function suppress(id, reason, hash) {
    return mutateSuppressed((cur) => {
      cur[id] = { reason: String(reason || "error"), hash: hash == null ? null : String(hash), at: new Date().toISOString() };
      return [id];
    }).then(() => undefined);
  }

  function unsuppress(id) {
    return mutateSuppressed((cur) => {
      if (!(id in cur)) return [];
      delete cur[id];
      return [id];
    }).then(() => undefined);
  }

  function suppressed() {
    return runTx(["_meta"], "readonly", (tx, out) => {
      const r = tx.objectStore("_meta").get(SUPPRESSED_KEY);
      r.onsuccess = () => { out.value = asObj(r.result); };
    });
  }

  function pruneSuppressed(hashById) {
    const h = hashById || {};
    return mutateSuppressed((cur) => {
      const removed = [];
      for (const id of Object.keys(cur)) {
        const want = h[id] == null ? null : String(h[id]);
        if (cur[id].hash !== want) { delete cur[id]; removed.push(id); }
      }
      return removed;
    });
  }

  const exported = {
    STATE_KEY, OWNER_KEY, SUPPRESSED_KEY, ENTITY,
    setLocal, snapshot, pull, ackPushed, dropOp, hasPending,
    suppress, unsuppress, suppressed, pruneSuppressed, subscribe,
  };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.pluginstate = exported; }
  return exported;
});
