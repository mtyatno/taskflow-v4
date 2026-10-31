// Runtime sistem plugin Alurik Fase 0a (spec docs/superpowers/specs/2026-10-29-plugin-fase0a-design.md §4).
// Browser: window.TF.plugins / TF.events / TF.api / TF.Slot. Node: module.exports (tes).
// Aturan: tanpa JSX (React.createElement), tanpa localStorage; modul TF.* host di-resolve malas saat dipanggil
// agar urutan <script> aman dan file ini bisa di-require di Node.
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
  const API_VERSION = 1;
  const KNOWN_SLOTS = ["dashboard.widgets"];
  const KNOWN_PERMISSIONS = ["storage"];
  const RESERVED_PERMISSIONS = ["network", "task.ext", "records", "settings.project", "notifications", "location", "secrets", "noteBlocks", "bot", "timerHooks"];
  const STATE_KEY = "plugins:state:v1";
  const INDEX_KEY = "plugins:index:v1";
  const INDEX_URL = "/static/plugins/index.json";
  const ID_RE = /^[a-z][a-z0-9-]{2,31}$/;
  const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

  // ── Resolusi malas modul host ──────────────────────────────────────────────
  const NODE_PATHS = {
    meta: "./offline/meta.js",
    habitquery: "./offline/habitquery.js",
    taskroutes: "./offline/taskroutes.js",
    themes: "./offline/themes.js",
    safehtml: "./offline/safehtml.js",
    introgate: "./offline/introgate.js",
  };
  function host(name) {
    const tf = root.TF;
    if (tf && tf[name]) return tf[name];
    if (isNode && NODE_PATHS[name]) return require(NODE_PATHS[name]);
    return null;
  }
  function meta() {
    const m = host("meta");
    if (!m) throw new Error("TF.meta belum dimuat");
    return m;
  }
  function warn() {
    try { console.warn.apply(console, ["[plugins]"].concat(Array.prototype.slice.call(arguments))); } catch (_) {}
  }

  // ── Event bus (spec §4.6, K10) ────────────────────────────────────────────
  // Pendengar dipanggil sinkron, masing-masing dalam try/catch; payload = salinan beku.
  // Pendengar milik plugin membawa pluginId sehingga error-nya bisa dihitung (§8).
  function createBus(opts) {
    const onListenerError = (opts && opts.onListenerError) || null;
    let listeners = new Map(); // name → [{fn, pluginId, orig}]
    function add(name, fn, pluginId, orig) {
      if (typeof name !== "string" || !name) throw new TypeError("nama event wajib string");
      if (typeof fn !== "function") throw new TypeError("pendengar harus fungsi");
      const entry = { fn, pluginId: pluginId || null, orig: orig || fn };
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(entry);
      return function off() { removeEntry(name, entry); };
    }
    function removeEntry(name, entry) {
      const arr = listeners.get(name);
      if (!arr) return;
      const i = arr.indexOf(entry);
      if (i >= 0) arr.splice(i, 1);
      if (!arr.length) listeners.delete(name);
    }
    function removeFn(name, fn, pluginId) {
      const arr = listeners.get(name);
      if (!arr) return;
      const entry = arr.find((e) => e.orig === fn && e.pluginId === (pluginId || null));
      if (entry) removeEntry(name, entry);
    }
    function addOnce(name, fn, pluginId) {
      let off = null;
      const wrapped = function (p) { off(); return fn(p); };
      off = add(name, wrapped, pluginId, fn);
      return off;
    }
    function on(name, fn) { return add(name, fn, null); }
    function once(name, fn) { return addOnce(name, fn, null); }
    function off(name, fn) { removeFn(name, fn, null); }
    function emit(name, payload) {
      const arr = listeners.get(name);
      if (!arr || !arr.length) return;
      const frozen = Object.freeze(Object.assign({}, payload || {}));
      for (const entry of arr.slice()) {
        try {
          entry.fn(frozen);
        } catch (err) {
          if (entry.pluginId) {
            const handler = onListenerError || defaultListenerError;
            try { handler(entry.pluginId, err); } catch (e2) { warn("onListenerError gagal:", e2); }
          } else {
            warn("pendengar host", name, "error:", err);
          }
        }
      }
    }
    // Pandangan per plugin: emit hanya `<id>.*`; offAll melepas semua pendengar milik plugin itu.
    function scoped(pluginId) {
      const prefix = pluginId + ".";
      const offs = new Set();
      function track(off) {
        const wrapped = function () { offs.delete(wrapped); off(); };
        offs.add(wrapped);
        return wrapped;
      }
      return Object.freeze({
        on: (name, fn) => track(add(name, fn, pluginId)),
        once: (name, fn) => track(addOnce(name, fn, pluginId)),
        off: (name, fn) => removeFn(name, fn, pluginId),
        emit(name, payload) {
          if (typeof name !== "string" || name.indexOf(prefix) !== 0 || name.length <= prefix.length) {
            throw new Error("plugin " + pluginId + " hanya boleh memancarkan event berawalan " + prefix);
          }
          emit(name, payload);
        },
        offAll() {
          for (const name of Array.from(listeners.keys())) {
            const arr = listeners.get(name).filter((e) => e.pluginId !== pluginId);
            if (arr.length) listeners.set(name, arr); else listeners.delete(name);
          }
          offs.clear();
        },
      });
    }
    function _clear() { listeners = new Map(); }
    return { on, once, off, emit, scoped, _clear };
  }

  function defaultListenerError(pluginId, err) {
    plugins.markFailed(pluginId, "listener", err);
  }

  // Tanggal Asia/Jakarta (UTC+7, tanpa DST) dalam YYYY-MM-DD.
  function jktDate(ms) {
    return new Date((ms == null ? Date.now() : ms) + 7 * 3600 * 1000).toISOString().slice(0, 10);
  }

  // Jembatan event window host → bus (R1). Event tf:* tidak diteruskan apa adanya ke plugin.
  function installBridge(target, opts) {
    const o = opts || {};
    const now = o.now || (() => Date.now());
    const setI = o.setInterval || ((fn, ms) => setInterval(fn, ms));
    const clearI = o.clearInterval || ((h) => clearInterval(h));
    let syncRunning = false;
    const handlers = {
      habitSaved: () => events.emit("habit.changed", {}),
      "tf:initial-sync": () => events.emit("sync.done", { initial: true }),
      "tf:sync-state": (e) => {
        const d = (e && e.detail) || {};
        const running = !!d.running;
        if (syncRunning && !running) events.emit("sync.done", { initial: false });
        syncRunning = running;
      },
      online: () => events.emit("app.online", {}),
      offline: () => events.emit("app.offline", {}),
    };
    for (const name of Object.keys(handlers)) target.addEventListener(name, handlers[name]);
    let lastDate = jktDate(now());
    const timer = setI(() => {
      const d = jktDate(now());
      if (d !== lastDate) {
        lastDate = d;
        events.emit("app.dayChanged", { date: d });
      }
    }, 60000);
    return function uninstall() {
      for (const name of Object.keys(handlers)) target.removeEventListener(name, handlers[name]);
      clearI(timer);
    };
  }

  const events = createBus();
  events.installBridge = installBridge;

  // ── Registry dan status ────────────────────────────────────────────────────
  let index = null;        // Map id → entri index.json
  let enabledState = {};   // {[id]: {enabled, updatedAt}}
  let recs = new Map();    // id → {manifest, factory, instance, loaded, failed}
  let initPromise = null;
  let ready = false;

  function indexEntries(idx) {
    if (!idx) return [];
    if (idx instanceof Map) return Array.from(idx.values());
    if (Array.isArray(idx)) return idx;
    if (Array.isArray(idx.plugins)) return idx.plugins;
    return [];
  }
  function inIndex(id) { return !!(index && index.has(id)); }
  function rec(id) {
    if (!recs.has(id)) {
      recs.set(id, {
        manifest: null, factory: null, instance: null, loaded: false, failed: null,
        errorCount: 0, loadToastShown: false, loadPromise: null, pendingLoad: null,
        debugThrow: false, gen: 0, events: events.scoped(id),
      });
    }
    return recs.get(id);
  }

  function validateManifest(m, idx) {
    const fail = (reason) => ({ ok: false, reason });
    if (!m || typeof m !== "object") return fail("manifest bukan objek");
    if (typeof m.id !== "string" || !ID_RE.test(m.id)) return fail("id tidak valid (pola [a-z][a-z0-9-]{2,31})");
    if (typeof m.name !== "string" || !m.name.trim()) return fail("name wajib diisi");
    if (typeof m.version !== "string" || !SEMVER_RE.test(m.version)) return fail("version bukan semver");
    if (!Number.isInteger(m.minApi) || m.minApi < 1) return fail("minApi harus bilangan bulat ≥ 1");
    if (m.minApi > API_VERSION) return fail("minApi " + m.minApi + " lebih tinggi dari apiVersion " + API_VERSION);
    if (!Array.isArray(m.slots)) return fail("slots harus array");
    for (const s of m.slots) if (!KNOWN_SLOTS.includes(s)) return fail("slot tidak dikenal: " + s);
    if (!Array.isArray(m.permissions)) return fail("permissions harus array");
    for (const p of m.permissions) {
      if (RESERVED_PERMISSIONS.includes(p)) return fail("izin dicadangkan untuk fase berikutnya: " + p);
      if (!KNOWN_PERMISSIONS.includes(p)) return fail("izin tidak dikenal: " + p);
    }
    if (idx !== undefined && idx !== null) {
      const listed = indexEntries(idx).some((e) => e && e.id === m.id);
      if (!listed) return fail("plugin tidak terdaftar di index.json: " + m.id);
    }
    return { ok: true, reason: null };
  }

  function isEnabled(id) {
    if (!inIndex(id)) return false;
    const st = enabledState[id];
    if (st && typeof st.enabled === "boolean") return st.enabled;
    return !!index.get(id).defaultEnabled;
  }

  function list() {
    if (!index) return [];
    return Array.from(index.values()).map((e) => {
      const r = recs.get(e.id);
      const m = (r && r.manifest) || e;
      return {
        id: e.id,
        name: m.name || e.id,
        description: m.description || "",
        version: m.version || e.version || "",
        permissions: (m.permissions || e.permissions || []).slice(),
        enabled: isEnabled(e.id),
        loaded: !!(r && r.loaded),
        failed: (r && r.failed) || null,
      };
    });
  }

  function persistState() {
    const snapshot = JSON.parse(JSON.stringify(enabledState));
    return Promise.resolve().then(() => meta().metaSet(STATE_KEY, snapshot));
  }

  function activate(id) {
    const r = rec(id);
    if (r.instance || !r.factory || !isEnabled(id)) return;
    let inst;
    try {
      inst = r.factory(api.for(id)) || {};
    } catch (err) {
      r.events.offAll();
      markFailed(id, "factory", err);
      return;
    }
    r.instance = inst;
    r.loaded = true;
    if (typeof inst.onEnable === "function") {
      try { inst.onEnable(); } catch (err) { warn("onEnable", id, "error:", err); }
    }
  }

  function deactivate(id) {
    const r = recs.get(id);
    if (!r || !r.instance) return;
    const inst = r.instance;
    r.instance = null;
    r.events.offAll();
    if (typeof inst.onDisable === "function") {
      try { inst.onDisable(); } catch (err) { warn("onDisable", id, "error:", err); }
    }
  }

  function setEnabled(id, on) {
    if (!inIndex(id)) return Promise.reject(new Error("plugin tidak dikenal: " + id));
    const enabled = !!on;
    enabledState[id] = { enabled, updatedAt: new Date().toISOString() };
    if (enabled) {
      // "Aktifkan lagi": kesempatan baru untuk error render/pendengar (gagal load tetap per sesi).
      const r = rec(id);
      r.errorCount = 0;
      r.debugThrow = false;
      if (r.failed && r.failed !== "load") r.failed = null;
      activate(id);
    }
    else deactivate(id);
    events.emit("plugins.changed", { id, enabled });
    return persistState();
  }

  function register(manifest, factory) {
    const id = manifest && manifest.id;
    if (!inIndex(id)) {
      warn("register diabaikan: id tidak ada di index.json:", id);
      return false;
    }
    const r = rec(id);
    let v = validateManifest(manifest, index);
    if (v.ok && typeof factory !== "function") v = { ok: false, reason: "factory bukan fungsi" };
    if (!v.ok) {
      // Plugin OFF: tidak ada yang perlu dimatikan, jadi cukup peringatan (tanpa toast ke pengguna).
      if (isEnabled(id)) markFailed(id, "manifest", new Error(v.reason));
      else warn("register", id, "ditolak (plugin OFF):", v.reason);
      settleLoad(r, false);
      return false;
    }
    r.manifest = Object.freeze(Object.assign({}, manifest, { slots: manifest.slots.slice(), permissions: manifest.permissions.slice() }));
    r.factory = factory;
    activate(id);
    // register yang terlambat (setelah timeout load) tetap sah: hapus penanda gagal load agar Pengaturan bersih.
    if (r.instance && r.failed === "load") r.failed = null;
    settleLoad(r, !!r.instance);
    if (r.instance) events.emit("plugins.loaded", { id });
    return true;
  }

  function contributions(slot) {
    if (!KNOWN_SLOTS.includes(slot)) return [];
    const out = [];
    for (const [pluginId, r] of recs) {
      if (!r.instance || !isEnabled(pluginId)) continue;
      if (!r.manifest.slots.includes(slot)) continue;
      const items = r.instance.slots && r.instance.slots[slot];
      if (!Array.isArray(items)) continue;
      for (const it of items) {
        if (!it || typeof it.id !== "string" || typeof it.component !== "function") {
          warn("kontribusi", pluginId, "di", slot, "tidak valid");
          continue;
        }
        out.push({ pluginId, id: it.id, order: typeof it.order === "number" ? it.order : 0, component: it.component });
      }
    }
    out.sort((a, b) => (a.order - b.order) || (a.pluginId < b.pluginId ? -1 : a.pluginId > b.pluginId ? 1 : 0));
    return out;
  }

  function settleLoad(r, ok) {
    if (r.pendingLoad) r.pendingLoad(ok);
  }

  // Penyuntik bawaan: <script> klasik (K12) dan <link rel=stylesheet>.
  function defaultInject(url, kind) {
    return new Promise((resolve, reject) => {
      const doc = root.document;
      if (!doc) { reject(new Error("tidak ada document")); return; }
      const el = kind === "style" ? doc.createElement("link") : doc.createElement("script");
      if (kind === "style") { el.rel = "stylesheet"; el.href = url; } else { el.src = url; el.async = true; }
      el.onload = () => resolve();
      el.onerror = () => reject(new Error("gagal memuat " + url));
      (doc.head || doc.documentElement).appendChild(el);
    });
  }

  // Lazy-execute (§4.2 langkah 4–5): idempoten per sesi; gagal load tidak dicoba ulang sampai sesi berikutnya.
  function load(id, opts) {
    if (!inIndex(id) || !isEnabled(id)) return Promise.resolve(false);
    const r = rec(id);
    if (r.factory) { activate(id); return Promise.resolve(!!r.instance); }
    if (r.loadPromise) return r.loadPromise;
    const o = opts || {};
    const inject = o.inject || defaultInject;
    const timeoutMs = typeof o.timeoutMs === "number" ? o.timeoutMs : 10000;
    const entry = index.get(id);
    const v = encodeURIComponent(String(entry.hash || ""));
    const base = "/static/plugins/" + id + "/";
    const files = Array.isArray(entry.files) ? entry.files : ["plugin.js"];
    r.loadPromise = new Promise((resolve) => {
      let done = false;
      let timer = null;
      const finish = (ok) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        r.pendingLoad = null;
        resolve(ok);
      };
      r.pendingLoad = finish;
      timer = setTimeout(() => {
        if (done) return;
        markFailed(id, "load", new Error("register tidak terpanggil dalam " + timeoutMs + " ms"));
        finish(false);
      }, timeoutMs);
      if (files.indexOf("style.css") >= 0) {
        Promise.resolve().then(() => inject(base + "style.css?v=" + v, "style"))
          .catch((err) => warn("style.css", id, "gagal dimuat:", err));
      }
      Promise.resolve().then(() => inject(base + "plugin.js?v=" + v, "script")).catch((err) => {
        if (done) return;
        markFailed(id, "load", err);
        finish(false);
      });
    });
    return r.loadPromise;
  }

  // ── Kegagalan (§8) ─────────────────────────────────────────────────────────
  const COUNTED_KINDS = ["render", "listener", "permission"];
  let failureLog = new Map(); // id → [{id, kind, message, stack, at}] (plugins:failed:v1, hanya memori sesi)
  let hostBinding = {};

  function bindHost(b) { hostBinding = Object.assign({}, b || {}); }

  function hostToast(message, type) {
    if (typeof hostBinding.toast === "function") {
      try { hostBinding.toast(message, type); return; } catch (e) { warn("toast host gagal:", e); }
    }
    warn(message);
  }

  function displayName(id) {
    const r = recs.get(id);
    if (r && r.manifest && r.manifest.name) return r.manifest.name;
    const e = index && index.get(id);
    return (e && e.name) || id;
  }

  function markFailed(id, kind, err) {
    const e = err instanceof Error ? err : new Error(String(err == null ? "error" : err));
    if (e.__tfPluginCounted) return;
    try { Object.defineProperty(e, "__tfPluginCounted", { value: true }); } catch (_) {}
    if (!failureLog.has(id)) failureLog.set(id, []);
    const log = failureLog.get(id);
    log.push({ id, kind, message: String(e.message || e), stack: String(e.stack || ""), at: new Date().toISOString() });
    if (log.length > 10) log.shift();
    warn("plugin", id, "gagal (" + kind + "):", e);
    if (!inIndex(id)) return;
    const r = rec(id);
    const name = displayName(id);
    if (kind === "load") {
      r.failed = "load";
      if (!r.loadToastShown) {
        r.loadToastShown = true;
        hostToast("Plugin " + name + " gagal dimuat", "error");
      }
      return;
    }
    if (kind === "manifest") {
      r.failed = "manifest";
      deactivate(id);
      hostToast("Plugin " + name + " dimatikan: " + e.message, "error");
      if (isEnabled(id)) setEnabledInternal(id, false);
      return;
    }
    // Error factory deterministik (akan terulang tiap muat) → langsung OFF, tanpa menunggu error ke-2.
    if (kind === "factory") {
      r.failed = "factory";
      deactivate(id);
      if (isEnabled(id)) {
        hostToast("Plugin " + name + " dimatikan karena error", "error");
        setEnabledInternal(id, false);
      }
      return;
    }
    if (COUNTED_KINDS.indexOf(kind) < 0) return;
    if (!isEnabled(id)) return;
    r.errorCount += 1;
    r.failed = kind;
    r.debugThrow = false;
    if (r.errorCount >= 2) {
      hostToast("Plugin " + name + " dimatikan karena error", "error");
      setEnabledInternal(id, false);
    } else {
      hostToast("Plugin " + name + " mengalami error", "error");
    }
  }

  // OFF otomatis; penanda `failed` dibiarkan agar kartu Pengaturan menampilkan "Aktifkan lagi".
  function setEnabledInternal(id, on) {
    setEnabled(id, on).catch((err) => warn("simpan status gagal:", err));
  }

  function failures(id) {
    return (failureLog.get(id) || []).map((f) => Object.assign({}, f));
  }

  function defaultFetchIndex() {
    return fetch(INDEX_URL).then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  function setIndex(idx) {
    const m = new Map();
    for (const e of indexEntries(idx)) {
      if (e && typeof e.id === "string" && ID_RE.test(e.id)) m.set(e.id, e);
    }
    index = m;
  }

  function init(opts) {
    if (initPromise) return initPromise;
    const fetchIndex = (opts && opts.fetchIndex) || defaultFetchIndex;
    failureLog = new Map();
    initPromise = Promise.resolve()
      .then(() => fetchIndex())
      .then((idx) => {
        if (!idx || !Array.isArray(idx.plugins)) throw new Error("index.json tidak valid");
        return Promise.resolve(meta().metaSet(INDEX_KEY, idx)).catch((e) => warn("simpan index gagal:", e)).then(() => idx);
      })
      .catch((err) => {
        warn("index.json tidak bisa diambil, pakai salinan _meta:", err && err.message);
        return Promise.resolve().then(() => meta().metaGet(INDEX_KEY)).catch(() => null);
      })
      .then((idx) => {
        setIndex(idx || { plugins: [] });
        return Promise.resolve().then(() => meta().metaGet(STATE_KEY)).catch(() => null);
      })
      .then((st) => {
        enabledState = (st && typeof st === "object") ? Object.assign({}, st) : {};
        ready = true;
        events.emit("plugins.ready", {});
      });
    return initPromise;
  }

  function _reset() {
    index = null;
    enabledState = {};
    recs = new Map();
    initPromise = null;
    ready = false;
    events._clear();
    apiCache = new Map();
    failureLog = new Map();
    hostBinding = {};
    taskRouter = null;
    injectOverride = null;
  }

  // ── Fasad TF.api v1 (spec §4.7) ────────────────────────────────────────────
  const STORAGE_MAX_BYTES = 64 * 1024;
  const NAV_PAGES = ["dashboard", "focus", "inbox", "settings"];

  class PluginStorageError extends Error {
    constructor(message) { super(message); this.name = "PluginStorageError"; }
  }
  class PluginPermissionError extends Error {
    constructor(message) { super(message); this.name = "PluginPermissionError"; }
  }

  function utf8Bytes(str) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str).length;
    return unescape(encodeURIComponent(str)).length;
  }

  function permissionsOf(id) {
    const r = recs.get(id);
    if (r && r.manifest) return r.manifest.permissions;
    const e = index && index.get(id);
    return (e && Array.isArray(e.permissions)) ? e.permissions : [];
  }

  function denied(id, message) {
    const err = new PluginPermissionError(message);
    markFailed(id, "permission", err);
    return err;
  }

  function makeStorage(id) {
    const prefix = "plugin:" + id + ":";
    function guard(key) {
      if (permissionsOf(id).indexOf("storage") < 0) {
        throw denied(id, "plugin " + id + " tidak punya izin storage");
      }
      if (key !== undefined && (typeof key !== "string" || !key || key.length > 128)) {
        throw new TypeError("kunci storage harus string 1–128 karakter");
      }
    }
    return Object.freeze({
      get(key) {
        return Promise.resolve().then(() => { guard(key); return meta().metaGet(prefix + key); })
          .then((v) => (v === undefined ? null : v));
      },
      set(key, value) {
        return Promise.resolve().then(() => {
          guard(key);
          let json;
          try { json = JSON.stringify(value); } catch (e) { throw new PluginStorageError("nilai tidak bisa diserialisasi JSON: " + e.message); }
          if (json === undefined) throw new PluginStorageError("nilai tidak bisa diserialisasi JSON");
          if (utf8Bytes(json) > STORAGE_MAX_BYTES) throw new PluginStorageError("nilai melebihi 64 KB");
          return meta().metaSet(prefix + key, JSON.parse(json));
        });
      },
      remove(key) {
        return Promise.resolve().then(() => { guard(key); return meta().metaDel(prefix + key); });
      },
      keys() {
        return Promise.resolve().then(() => { guard(); return meta().metaKeys(prefix); })
          .then((keys) => keys.map((k) => k.slice(prefix.length)).sort());
      },
    });
  }

  let taskRouter = null;
  function localTaskRouter() {
    if (!taskRouter) {
      const tr = host("taskroutes");
      if (!tr) throw new Error("TF.taskroutes belum dimuat");
      taskRouter = tr.buildTaskRouter();
    }
    return taskRouter;
  }

  function timeOf(v) {
    const t = v ? Date.parse(v) : NaN;
    return isNaN(t) ? null : t;
  }

  const data = Object.freeze({
    habits: Object.freeze({
      list() {
        return Promise.resolve().then(() => host("habitquery").getHabits({}));
      },
      // Log habit (semua status) dari habit yang masih hidup; log `deleted` dibuang; from/to inklusif (YYYY-MM-DD).
      logs(q) {
        const from = (q && q.from) || null;
        const to = (q && q.to) || null;
        return Promise.resolve().then(() => host("habitquery").liveLogs()).then((res) => {
          const idOf = {};
          for (const h of res.habits) idOf[h.cid] = h.server_id != null ? h.server_id : h.cid;
          return res.logs
            .filter((l) => !l.deleted && (!from || l.date >= from) && (!to || l.date <= to))
            .map((l) => ({ cid: l.cid, habitId: idOf[l.habit_cid], habit_cid: l.habit_cid, date: l.date, status: l.status, skip_reason: l.skip_reason || "" }));
        });
      },
    }),
    tasks: Object.freeze({
      // Bentuk sama seperti GET /api/tasks lokal (id = server_id ?? cid). since = ISO; dibandingkan dengan
      // updated_at (fallback completed_at, created_at).
      list(q) {
        const includeDone = !!(q && q.includeDone);
        const since = q && q.since ? timeOf(q.since) : null;
        return Promise.resolve()
          .then(() => localTaskRouter().dispatch("GET", includeDone ? "/api/tasks?include_done=1" : "/api/tasks"))
          .then((rows) => {
            const list = Array.isArray(rows) ? rows : [];
            if (since == null) return list;
            return list.filter((t) => {
              const ts = timeOf(t.updated_at) || timeOf(t.completed_at) || timeOf(t.created_at);
              return ts != null && ts >= since;
            });
          });
      },
    }),
  });

  function makeUi(id) {
    return Object.freeze({
      toast(message, type) {
        if (typeof hostBinding.toast === "function") hostBinding.toast(String(message), type || "info");
        else warn("[plugin:" + id + "] toast:", message);
      },
      openTask(taskId) {
        if (typeof hostBinding.openTask === "function") hostBinding.openTask(taskId);
        else warn("[plugin:" + id + "] openTask tanpa binding host");
      },
      navigate(page) {
        if (NAV_PAGES.indexOf(page) < 0) throw denied(id, "navigate hanya ke " + NAV_PAGES.join("/") + ", bukan " + page);
        if (typeof hostBinding.navigate === "function") hostBinding.navigate(page);
        else warn("[plugin:" + id + "] navigate tanpa binding host");
      },
      sanitize(html) {
        const sh = host("safehtml");
        if (!sh) throw new Error("TF.safehtml belum dimuat");
        return sh.restoreAllowedTags(sh.escapeHtml(html));
      },
    });
  }

  const env = Object.freeze({
    get online() {
      const nav = root.navigator;
      return !(nav && nav.onLine === false);
    },
    get platform() { return root.__TAURI__ ? "tauri" : "web"; },
    get theme() {
      const th = host("themes");
      const def = (th && th.DEFAULT_PREFS) || { palette: "default", mode: "light" };
      const el = root.document && root.document.documentElement;
      const get = (n) => (el && typeof el.getAttribute === "function" ? el.getAttribute(n) : null);
      return { palette: get("data-palette") || def.palette, mode: get("data-theme") || "light" };
    },
    today() { return jktDate(Date.now()); },
    get userId() {
      const u = hostBinding.userId;
      if (typeof u === "function") { try { return u(); } catch (_) { return null; } }
      if (u != null) return u;
      const ig = host("introgate");
      try { return ig ? ig.currentUserId() : null; } catch (_) { return null; }
    },
  });

  function makeLog(id) {
    const tag = "[plugin:" + id + "]";
    const out = (level) => function () {
      try { console[level].apply(console, [tag].concat(Array.prototype.slice.call(arguments))); } catch (_) {}
    };
    return Object.freeze({ info: out("info"), warn: out("warn"), error: out("error") });
  }

  let apiCache = new Map();
  const api = {
    apiVersion: API_VERSION,
    PluginStorageError,
    PluginPermissionError,
    for(id) {
      if (!apiCache.has(id)) {
        apiCache.set(id, Object.freeze({
          id,
          apiVersion: API_VERSION,
          events: rec(id).events,
          storage: makeStorage(id),
          data,
          ui: makeUi(id),
          env,
          log: makeLog(id),
        }));
      }
      return apiCache.get(id);
    },
  };

  // ── Slot dan PluginBoundary (spec §4.5, K13) ───────────────────────────────
  let Boundary = null;
  let BoundaryReact = null;
  function getBoundary() {
    const React = root.React;
    if (!React) throw new Error("React belum dimuat");
    if (Boundary && BoundaryReact === React) return Boundary;
    class PluginBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { failed: false };
      }
      static getDerivedStateFromError() { return { failed: true }; }
      componentDidCatch(err) { plugins.markFailed(this.props.pluginId, "render", err); }
      render() { return this.state.failed ? null : (this.props.children === undefined ? null : this.props.children); }
    }
    Boundary = PluginBoundary;
    BoundaryReact = React;
    return Boundary;
  }

  function PluginDebugThrow() { throw new Error("TF.plugins._debugThrow"); }

  const SLOT_CLASS = { "dashboard.widgets": "dash-grid-2 dash-plugins" };

  function renderSlot(name, context, className) {
    const React = root.React;
    if (!ready || !React) return null;
    const list = contributions(name);
    if (!list.length) return null;
    const ctx = Object.freeze(Object.assign({}, context || {}));
    const B = getBoundary();
    const children = list.map((c) => {
      const r = recs.get(c.pluginId);
      const Comp = r.debugThrow ? PluginDebugThrow : c.component;
      return React.createElement(B, { key: c.pluginId + ":" + c.id + ":" + r.gen, pluginId: c.pluginId },
        React.createElement(Comp, { context: ctx, api: api.for(c.pluginId) }));
    });
    return React.createElement("div", { className: className || SLOT_CLASS[name] || "tf-plugin-slot", "data-plugin-slot": name }, children);
  }

  let injectOverride = null;
  function loadForSlot(name) {
    if (!index) return;
    for (const e of index.values()) {
      if (!isEnabled(e.id)) continue;
      if (Array.isArray(e.slots) && e.slots.indexOf(name) < 0) continue;
      const r = rec(e.id);
      if (r.instance || r.loadPromise) continue;
      load(e.id, injectOverride ? { inject: injectOverride } : undefined).catch((err) => warn("load", e.id, err));
    }
  }

  // <TF.Slot name context className?/>: kosong sampai init selesai; tanpa wadah bila tak ada kontribusi.
  function Slot(props) {
    const React = root.React;
    const name = props && props.name;
    const readyAtRender = ready;
    const force = React.useReducer((x) => x + 1, 0)[1];
    React.useEffect(() => {
      const bump = () => force();
      const offs = ["plugins.ready", "plugins.changed", "plugins.loaded"].map((n) => events.on(n, bump));
      if (ready !== readyAtRender) bump();
      return () => offs.forEach((off) => off());
    }, []);
    React.useEffect(() => { if (ready) loadForSlot(name); });
    return renderSlot(name, props && props.context, props && props.className);
  }

  function _debugThrow(id) {
    if (!inIndex(id)) return false;
    const r = rec(id);
    r.debugThrow = true;
    r.gen += 1;
    events.emit("plugins.changed", { id, enabled: isEnabled(id) });
    return true;
  }

  const plugins = {
    KNOWN_SLOTS, KNOWN_PERMISSIONS, RESERVED_PERMISSIONS, API_VERSION,
    init, list, isEnabled, setEnabled, register, validateManifest, contributions, load, markFailed, failures, bindHost,
    isReady: () => ready,
    get PluginBoundary() { return getBoundary(); },
    _renderSlot: renderSlot,
    _debugThrow,
    _setDefaultInject(fn) { injectOverride = typeof fn === "function" ? fn : null; },
    _reset,
  };

  // Browser: pasang jembatan event window sekali saat file dimuat.
  let bridgeUninstall = null;
  if (!isNode && typeof root.addEventListener === "function") {
    try { bridgeUninstall = installBridge(root); } catch (e) { warn("jembatan event gagal:", e); }
  }

  const exported = { plugins, events, api, Slot, createBus, jktDate };
  if (root && typeof root === "object") {
    root.TF = root.TF || {};
    root.TF.plugins = plugins;
    root.TF.events = events;
    root.TF.api = api;
    root.TF.Slot = Slot;
  }
  return exported;
});
