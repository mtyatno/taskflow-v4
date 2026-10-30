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

  // ── Event bus ──────────────────────────────────────────────────────────────
  function createBus() {
    let listeners = new Map(); // name → [{fn, pluginId}]
    function add(name, fn, pluginId) {
      if (typeof fn !== "function") throw new TypeError("pendengar harus fungsi");
      const entry = { fn, pluginId: pluginId || null };
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(entry);
      return function off() { remove(name, entry); };
    }
    function remove(name, entry) {
      const arr = listeners.get(name);
      if (!arr) return;
      const i = arr.indexOf(entry);
      if (i >= 0) arr.splice(i, 1);
      if (!arr.length) listeners.delete(name);
    }
    function on(name, fn) { return add(name, fn, null); }
    function emit(name, payload) {
      const arr = listeners.get(name);
      if (!arr || !arr.length) return;
      const frozen = Object.freeze(Object.assign({}, payload || {}));
      for (const entry of arr.slice()) {
        try { entry.fn(frozen); } catch (err) { warn("pendengar", name, "error:", err); }
      }
    }
    function _clear() { listeners = new Map(); }
    return { on, emit, _add: add, _clear };
  }

  const events = createBus();

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
    if (!recs.has(id)) recs.set(id, { manifest: null, factory: null, instance: null, loaded: false, failed: null });
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
      warn("factory", id, "error:", err);
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
    if (typeof inst.onDisable === "function") {
      try { inst.onDisable(); } catch (err) { warn("onDisable", id, "error:", err); }
    }
  }

  function setEnabled(id, on) {
    if (!inIndex(id)) return Promise.reject(new Error("plugin tidak dikenal: " + id));
    const enabled = !!on;
    enabledState[id] = { enabled, updatedAt: new Date().toISOString() };
    if (enabled) activate(id);
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
    const v = validateManifest(manifest, index);
    if (!v.ok) {
      warn("manifest", id, "tidak valid:", v.reason);
      return false;
    }
    if (typeof factory !== "function") {
      warn("register", id, ": factory bukan fungsi");
      return false;
    }
    const r = rec(id);
    r.manifest = Object.freeze(Object.assign({}, manifest, { slots: manifest.slots.slice(), permissions: manifest.permissions.slice() }));
    r.factory = factory;
    activate(id);
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

  function load(id) {
    if (!inIndex(id) || !isEnabled(id)) return Promise.resolve(false);
    const r = rec(id);
    if (r.factory) { activate(id); return Promise.resolve(!!r.instance); }
    return Promise.resolve(false);
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
  }

  // ── Fasad TF.api (diperluas di Task 4) ─────────────────────────────────────
  let apiCache = new Map();
  const api = {
    apiVersion: API_VERSION,
    for(id) {
      if (!apiCache.has(id)) apiCache.set(id, Object.freeze({ id }));
      return apiCache.get(id);
    },
  };

  const plugins = {
    KNOWN_SLOTS, KNOWN_PERMISSIONS, RESERVED_PERMISSIONS, API_VERSION,
    init, list, isEnabled, setEnabled, register, validateManifest, contributions, load,
    isReady: () => ready,
    _reset,
  };

  const exported = { plugins, events, api };
  if (root && typeof root === "object") {
    root.TF = root.TF || {};
    root.TF.plugins = plugins;
    root.TF.events = events;
    root.TF.api = api;
  }
  return exported;
});
