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
      markFailed(id, "manifest", new Error(v.reason));
      settleLoad(r, false);
      return false;
    }
    r.manifest = Object.freeze(Object.assign({}, manifest, { slots: manifest.slots.slice(), permissions: manifest.permissions.slice() }));
    r.factory = factory;
    activate(id);
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
  const COUNTED_KINDS = ["render", "listener", "factory", "permission"];
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
  }

  // ── Fasad TF.api (diperluas di Task 4) ─────────────────────────────────────
  let apiCache = new Map();
  const api = {
    apiVersion: API_VERSION,
    for(id) {
      if (!apiCache.has(id)) apiCache.set(id, Object.freeze({ id, events: rec(id).events }));
      return apiCache.get(id);
    },
  };

  const plugins = {
    KNOWN_SLOTS, KNOWN_PERMISSIONS, RESERVED_PERMISSIONS, API_VERSION,
    init, list, isEnabled, setEnabled, register, validateManifest, contributions, load, markFailed, failures, bindHost,
    isReady: () => ready,
    _reset,
  };

  // Browser: pasang jembatan event window sekali saat file dimuat.
  let bridgeUninstall = null;
  if (!isNode && typeof root.addEventListener === "function") {
    try { bridgeUninstall = installBridge(root); } catch (e) { warn("jembatan event gagal:", e); }
  }

  const exported = { plugins, events, api, createBus, jktDate };
  if (root && typeof root === "object") {
    root.TF = root.TF || {};
    root.TF.plugins = plugins;
    root.TF.events = events;
    root.TF.api = api;
  }
  return exported;
});
