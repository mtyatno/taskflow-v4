// Runtime sistem plugin Alurik Fase 0a (spec docs/superpowers/specs/2026-10-29-plugin-fase0a-design.md §4) +
// Fase 0b (spec 2026-10-31-plugin-fase0b-design.md §6.3–§6.4): status ON/OFF ikut AKUN lewat TF.pluginstate,
// OFF otomatis karena error = peredaman lokal (hanya perangkat ini), izin `network` + api.fetch.
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
  const KNOWN_SLOTS = ["dashboard.widgets", "taskList.views", "taskDetail.sections"];
  const KNOWN_PERMISSIONS = ["storage", "network", "task.ext"];
  const RESERVED_PERMISSIONS = ["records", "settings.project", "notifications", "location", "secrets", "noteBlocks", "bot", "timerHooks"];
  const STATE_KEY = "plugins:state:v1";
  const INDEX_KEY = "plugins:index:v1";
  const INDEX_URL = "/static/plugins/index.json";
  const ID_RE = /^[a-z][a-z0-9-]{2,31}$/;
  const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
  // Fase 1 (spec 2026-10-31-plugin-fase1-timeline-design.md K19): manifest.contributes / taskExt — aturan sama
  // dengan compile.js (validateContributes/validateTaskExt).
  const CONTRIB_SLOTS = ["taskList.views", "taskDetail.sections"];
  const CONTRIB_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
  const VIEW_PAGES = ["project", "workspace"];
  const ICON_PATH_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\- ]+$/;
  const ICON_PATH_MAX_BYTES = 2048;
  const LABEL_MAX = 40;
  const EXT_FIELD_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;

  // ── Resolusi malas modul host ──────────────────────────────────────────────
  const NODE_PATHS = {
    meta: "./offline/meta.js",
    habitquery: "./offline/habitquery.js",
    taskroutes: "./offline/taskroutes.js",
    themes: "./offline/themes.js",
    safehtml: "./offline/safehtml.js",
    introgate: "./offline/introgate.js",
    pluginstate: "./offline/pluginstate.js",
    taskext: "./offline/taskext.js",
  };
  function host(name) {
    const tf = root.TF;
    if (tf && tf[name]) return tf[name];
    if (isNode && NODE_PATHS[name]) { try { return require(NODE_PATHS[name]); } catch (_) { return null; } }
    return null;
  }
  function meta() {
    const m = host("meta");
    if (!m) throw new Error("TF.meta belum dimuat");
    return m;
  }
  // TF.pluginstate (0b). Tidak ada (modul lama dari cache SW / tes fallback) → perilaku 0a (persistState, R13).
  let psOverride; // undefined = resolusi normal; null = dipaksa tidak ada (tes)
  function ps() { return psOverride === undefined ? host("pluginstate") : psOverride; }
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
  let enabledState = {};   // status akun (salinan sinkron cache TF.pluginstate, R13): {[id]: {enabled, updatedAt, …}}
  let pendingIds = new Set(); // id dengan op plugin_state di outbox ("Menunggu sinkron")
  let suppressedState = {};   // peredaman lokal {[id]: {reason, hash, at}} — hanya perangkat ini (K16)
  let unsubscribeState = null;
  let localWrites = 0;        // tulisan lokal yang sedang berjalan; notifikasi store ditunda sampai selesai
  let reloadWanted = false;
  let reloadChain = Promise.resolve();
  let localGen = 0;           // naik setiap salinan memori diubah lokal (setEnabled/peredaman)
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

  const isPlainObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

  function labelError(where, label) {
    if (typeof label !== "string" || !label.trim()) return where + ": label wajib diisi";
    if (Array.from(label).length > LABEL_MAX) return where + ": label maksimal " + LABEL_MAX + " karakter";
    return null;
  }

  function iconPathOk(p) {
    return typeof p === "string" && !!p && ICON_PATH_RE.test(p) && utf8Bytes(p) <= ICON_PATH_MAX_BYTES;
  }

  // Satu item contributes (tanpa cek id ganda) → alasan | null.
  function contribItemError(slot, it) {
    if (!isPlainObj(it)) return "contributes: item " + slot + " harus objek";
    if (typeof it.id !== "string" || !CONTRIB_ID_RE.test(it.id)) return "contributes: id " + slot + " tidak valid: " + it.id;
    const where = "contributes: " + slot + " " + it.id;
    const le = labelError(where, it.label);
    if (le) return le;
    if (slot === "taskList.views") {
      if (!iconPathOk(isPlainObj(it.icon) ? it.icon.path : undefined)) return where + ": icon.path tidak valid";
      if (!Array.isArray(it.pages) || !it.pages.length) return where + ": pages wajib array tak kosong";
      if (new Set(it.pages).size !== it.pages.length) return where + ": pages ganda";
      for (const pg of it.pages) if (VIEW_PAGES.indexOf(pg) < 0) return where + ": pages tidak dikenal: " + pg;
    } else if (it.order !== undefined && (typeof it.order !== "number" || !Number.isFinite(it.order))) {
      return where + ": order harus angka";
    }
    return null;
  }

  function contributesError(m) {
    if (!m || m.contributes === undefined) return null;
    const c = m.contributes;
    if (!isPlainObj(c)) return "contributes harus objek";
    const slots = Array.isArray(m.slots) ? m.slots : [];
    for (const slot of Object.keys(c)) {
      if (CONTRIB_SLOTS.indexOf(slot) < 0) return "contributes: slot tidak didukung: " + slot;
      if (slots.indexOf(slot) < 0) return "contributes: slot " + slot + " tidak ada di slots";
      if (!Array.isArray(c[slot])) return "contributes: " + slot + " harus array";
      const seen = new Set();
      for (const it of c[slot]) {
        const e = contribItemError(slot, it);
        if (e) return e;
        if (seen.has(it.id)) return "contributes: id " + slot + " ganda: " + it.id;
        seen.add(it.id);
      }
    }
    return null;
  }

  // Izin task.ext ⇔ taskExt.keys (array field unik, tak kosong).
  function taskExtError(m) {
    const perms = (m && Array.isArray(m.permissions)) ? m.permissions : [];
    const has = !!m && m.taskExt !== undefined;
    const perm = perms.indexOf("task.ext") >= 0;
    if (perm && !has) return "izin task.ext butuh taskExt.keys";
    if (!has) return null;
    if (!perm) return "taskExt butuh izin task.ext";
    const keys = isPlainObj(m.taskExt) ? m.taskExt.keys : undefined;
    if (!Array.isArray(keys) || !keys.length) return "taskExt.keys wajib array tak kosong";
    if (new Set(keys).size !== keys.length) return "taskExt.keys ganda";
    for (const k of keys) if (typeof k !== "string" || !EXT_FIELD_RE.test(k)) return "taskExt.keys tidak valid: " + k;
    return null;
  }

  // Halaman host → jenis halaman untuk taskList.views (spec Fase 1 §6): proj_* project, slist_* workspace.
  function pageKindOf(page) {
    if (typeof page !== "string") return null;
    if (page.indexOf("proj_") === 0 && page.length > 5) return "project";
    if (page.indexOf("slist_") === 0 && page.length > 6) return "workspace";
    return null;
  }

  // Tombol view dari index.json (tanpa memuat kode plugin): plugin ON, item sah, pages memuat kind.
  function viewsFor(kind) {
    if (!kind || VIEW_PAGES.indexOf(kind) < 0 || !index) return [];
    const out = [];
    const ids = Array.from(index.keys()).sort();
    for (const id of ids) {
      if (!isEnabled(id)) continue;
      const e = index.get(id);
      if (!Array.isArray(e.slots) || e.slots.indexOf("taskList.views") < 0) continue;
      const items = isPlainObj(e.contributes) ? e.contributes["taskList.views"] : null;
      if (!Array.isArray(items)) continue;
      const seen = new Set();
      for (const it of items) {
        if (contribItemError("taskList.views", it) || seen.has(it.id)) continue;
        seen.add(it.id);
        if (it.pages.indexOf(kind) < 0) continue;
        out.push({ pluginId: id, id: it.id, label: it.label, icon: { path: it.icon.path } });
      }
    }
    return out;
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
    const ce = contributesError(m);
    if (ce) return fail(ce);
    const te = taskExtError(m);
    if (te) return fail(te);
    if (idx !== undefined && idx !== null) {
      const listed = indexEntries(idx).some((e) => e && e.id === m.id);
      if (!listed) return fail("plugin tidak terdaftar di index.json: " + m.id);
    }
    return { ok: true, reason: null };
  }

  // Status akun: nilai cache bila boolean, selain itu defaultEnabled dari index.json.
  function accountEnabled(id) {
    if (!inIndex(id)) return false;
    const st = enabledState[id];
    if (st && typeof st.enabled === "boolean") return st.enabled;
    return !!index.get(id).defaultEnabled;
  }

  // Status efektif di perangkat ini = status akun ∧ tidak diredam.
  function isEnabled(id) {
    return accountEnabled(id) && !suppressedState[id];
  }

  function list() {
    if (!index) return [];
    return Array.from(index.values()).map((e) => {
      const r = recs.get(e.id);
      const m = (r && r.manifest) || e;
      const item = {
        id: e.id,
        name: m.name || e.id,
        description: m.description || "",
        version: m.version || e.version || "",
        permissions: (m.permissions || e.permissions || []).slice(),
        enabled: isEnabled(e.id),
        loaded: !!(r && r.loaded),
        failed: (r && r.failed) || null,
      };
      // Kunci 0b hanya bila relevan (bentuk 0a tetap untuk plugin biasa).
      if (pendingIds.has(e.id)) item.pending = true;
      if (suppressedState[e.id]) {
        item.suppressed = String(suppressedState[e.id].reason || "error");
        item.accountEnabled = accountEnabled(e.id);
      }
      return item;
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

  // Tulisan lokal ke TF.pluginstate: notifikasi store selama tulisan berjalan ditunda, lalu satu reloadState
  // menyelaraskan (mencegah salinan memori sempat membaca keadaan setengah jadi, mis. unsuppress sebelum setLocal).
  function localWrite(fn) {
    localWrites += 1;
    const done = () => {
      localWrites -= 1;
      if (localWrites === 0 && reloadWanted) {
        reloadWanted = false;
        return reloadState().catch((e) => warn("reloadState gagal:", e));
      }
      return null;
    };
    return Promise.resolve().then(fn).then(
      (v) => Promise.resolve(done()).then(() => v),
      (err) => Promise.resolve(done()).then(() => { throw err; }));
  }

  function onStoreChange() {
    if (localWrites > 0) { reloadWanted = true; return; }
    reloadState().catch((e) => warn("reloadState gagal:", e));
  }

  function setEnabled(id, on) {
    if (!inIndex(id)) return Promise.reject(new Error("plugin tidak dikenal: " + id));
    const enabled = !!on;
    const m = ps();
    localGen += 1;
    enabledState[id] = Object.assign({}, enabledState[id], { enabled, updatedAt: new Date().toISOString() });
    if (m) pendingIds.add(id);
    if (enabled) {
      // "Aktifkan lagi" (R14): kesempatan baru untuk error render/pendengar dan peredaman lokal dihapus
      // (gagal load tetap per sesi).
      delete suppressedState[id];
      const r = rec(id);
      r.errorCount = 0;
      r.debugThrow = false;
      if (r.failed && r.failed !== "load") r.failed = null;
      activate(id);
    }
    else deactivate(id);
    events.emit("plugins.changed", { id, enabled });
    if (!m) return persistState();
    return localWrite(() => Promise.resolve(enabled ? m.unsuppress(id) : null).then(() => m.setLocal(id, { enabled })))
      .then(() => undefined);
  }

  // Baca ulang cache TF.pluginstate; plugin yang status efektifnya berubah di-activate/deactivate. plugins.changed
  // dipancarkan juga bila hanya pending/peredaman yang berubah (kartu Pengaturan render ulang). Hasil: id yang
  // status efektifnya berubah.
  function reloadState() {
    const run = () => {
      const m = ps();
      if (!m || !index) return Promise.resolve([]);
      const gen = localGen;
      return Promise.resolve(m.snapshot()).then((snap) => {
        // Snapshot diambil sebelum perubahan lokal yang lebih baru → basi; jangan timpa salinan optimistis.
        if (gen !== localGen) {
          if (localWrites > 0) { reloadWanted = true; return []; }
          return run();
        }
        return applySnapshot(snap);
      });
    };
    const p = reloadChain.then(run, run);
    reloadChain = p.catch(() => null);
    return p;
  }

  // Cache milik akun lain (owner ada dan ≠ userId ter-bind, mis. clearAll gagal saat ganti akun): statusnya
  // diabaikan (default index.json) dan op-nya tidak ditampilkan sampai pull berikutnya menulis owner yang benar
  // (review akhir PR B). Owner tidak ada (cache 0a) atau userId belum di-bind → cache dipakai (lebur pertama).
  function snapshotForUser(snap) {
    const s = snap || {};
    const uid = bindingUserId(hostBinding);
    if (s.owner == null || uid == null || String(s.owner) === String(uid)) return s;
    return { state: {}, pending: [], suppressed: s.suppressed, owner: s.owner };
  }

  function applySnapshot(snap) {
    const s = snapshotForUser(snap);
    const ids = index ? Array.from(index.keys()) : [];
    const before = {};
    for (const id of ids) {
      before[id] = { on: isEnabled(id), pending: pendingIds.has(id), sup: suppressedState[id] ? suppressedState[id].reason : null };
    }
    enabledState = (s.state && typeof s.state === "object") ? Object.assign({}, s.state) : {};
    pendingIds = new Set(Array.isArray(s.pending) ? s.pending : []);
    suppressedState = (s.suppressed && typeof s.suppressed === "object") ? Object.assign({}, s.suppressed) : {};
    const changed = [];
    for (const id of ids) {
      const on = isEnabled(id);
      const b = before[id];
      const sup = suppressedState[id] ? suppressedState[id].reason : null;
      if (on !== b.on) {
        changed.push(id);
        if (on) activate(id); else deactivate(id);
      }
      if (on !== b.on || pendingIds.has(id) !== b.pending || sup !== b.sup) {
        events.emit("plugins.changed", { id, enabled: on });
      }
    }
    return changed;
  }

  function knownIds() { return index ? Array.from(index.keys()) : null; }

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
        out.push({ pluginId, id: it.id, order: typeof it.order === "number" ? it.order : manifestOrder(r.manifest, slot, it.id), component: it.component });
      }
    }
    out.sort((a, b) => (a.order - b.order) || (a.pluginId < b.pluginId ? -1 : a.pluginId > b.pluginId ? 1 : 0));
    return out;
  }

  // Urutan dari manifest.contributes bila komponen tidak menyebut order.
  function manifestOrder(m, slot, itemId) {
    const items = m && isPlainObj(m.contributes) ? m.contributes[slot] : null;
    const it = Array.isArray(items) ? items.find((x) => x && x.id === itemId) : null;
    return it && typeof it.order === "number" && Number.isFinite(it.order) ? it.order : 0;
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

  function bindingUserId(b) {
    const u = b && b.userId;
    if (typeof u === "function") { try { return u(); } catch (_) { return null; } }
    return u == null ? null : u;
  }

  // Host menyuntik toast/openTask/navigate/userId (0a) + fetch/isOfflineErr/pushNow (0b). userId berubah
  // (login/ganti akun) → baca ulang status akun.
  function bindHost(b) {
    const prev = bindingUserId(hostBinding);
    hostBinding = Object.assign({}, b || {});
    const next = bindingUserId(hostBinding);
    if (ready && String(prev) !== String(next)) reloadState().catch((e) => warn("reloadState gagal:", e));
  }

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
      if (isEnabled(id)) suppressLocal(id, "manifest");
      return;
    }
    // Error factory deterministik (akan terulang tiap muat) → langsung OFF, tanpa menunggu error ke-2.
    if (kind === "factory") {
      r.failed = "factory";
      deactivate(id);
      if (isEnabled(id)) {
        hostToast("Plugin " + name + " dimatikan karena error", "error");
        suppressLocal(id, "factory");
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
      suppressLocal(id, kind);
    } else {
      hostToast("Plugin " + name + " mengalami error", "error");
    }
  }

  // OFF otomatis (0a, fallback tanpa TF.pluginstate); penanda `failed` dibiarkan agar kartu Pengaturan
  // menampilkan "Aktifkan lagi".
  function setEnabledInternal(id, on) {
    setEnabled(id, on).catch((err) => warn("simpan status gagal:", err));
  }

  // OFF otomatis 0b (K16): peredaman hanya di perangkat ini — salinan memori seketika + TF.pluginstate.suppress
  // dengan hash indeks; status akun tidak disentuh (tanpa setLocal), perangkat lain tetap ON.
  function suppressLocal(id, kind) {
    const m = ps();
    if (!m) { setEnabledInternal(id, false); return; }
    const entry = index && index.get(id);
    const hash = entry && entry.hash != null ? String(entry.hash) : null;
    localGen += 1;
    suppressedState[id] = { reason: kind, hash, at: new Date().toISOString() };
    deactivate(id);
    events.emit("plugins.changed", { id, enabled: false });
    localWrite(() => m.suppress(id, kind, hash)).catch((err) => warn("simpan peredaman gagal:", err));
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
        const m = ps();
        if (!m) {
          return Promise.resolve().then(() => meta().metaGet(STATE_KEY)).catch(() => null)
            .then((st) => ({ state: st }));
        }
        // 0b: peredaman dengan hash berbeda (versi plugin baru) dihapus, lalu satu bacaan snapshot.
        const hashById = {};
        for (const e of index.values()) hashById[e.id] = e.hash == null ? null : String(e.hash);
        return Promise.resolve()
          .then(() => m.pruneSuppressed(hashById)).catch((e) => warn("pruneSuppressed gagal:", e))
          .then(() => m.snapshot())
          .catch((e) => { warn("status plugin tidak terbaca:", e); return null; })
          .then((snap) => {
            if (!unsubscribeState && typeof m.subscribe === "function") unsubscribeState = m.subscribe(onStoreChange);
            return snap;
          });
      })
      .then((snap) => {
        const s = snapshotForUser(snap);
        enabledState = (s.state && typeof s.state === "object") ? Object.assign({}, s.state) : {};
        pendingIds = new Set(Array.isArray(s.pending) ? s.pending : []);
        suppressedState = (s.suppressed && typeof s.suppressed === "object") ? Object.assign({}, s.suppressed) : {};
        ready = true;
        events.emit("plugins.ready", {});
      });
    return initPromise;
  }

  function _reset() {
    if (unsubscribeState) { try { unsubscribeState(); } catch (_) {} }
    unsubscribeState = null;
    psOverride = undefined;
    pendingIds = new Set();
    suppressedState = {};
    localWrites = 0;
    reloadWanted = false;
    reloadChain = Promise.resolve();
    localGen = 0;
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
    pushWaitMs = PUSH_WAIT_MS;
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
  // Kegagalan jaringan/server api.fetch (spec Fase 0b §6.4): bukan bug plugin → tidak dihitung markFailed.
  // code ∈ offline | timeout | auth | disabled | unavailable | http.
  const NETWORK_MESSAGES = {
    offline: "Butuh koneksi internet",
    timeout: "Waktu habis — coba lagi",
    auth: "Sesi berakhir — masuk lagi",
    disabled: "Plugin dimatikan",
    unavailable: "Fitur plugin sedang tidak tersedia",
    http: "Permintaan gagal",
  };
  class PluginNetworkError extends Error {
    constructor(code, message, extra) {
      super(message || NETWORK_MESSAGES[code] || NETWORK_MESSAGES.http);
      this.name = "PluginNetworkError";
      this.code = code;
      const x = extra || {};
      if (x.status != null) this.status = x.status;
      if (x.detail !== undefined) this.detail = x.detail;
    }
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

  // ── api.fetch (izin network, spec Fase 0b §6.4) ───────────────────────────
  const FETCH_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  const FETCH_BODY_MAX_BYTES = 256 * 1024;
  const FETCH_TIMEOUT_MS = 15000;
  const PUSH_WAIT_MS = 5000;
  const HOST_TIMEOUT_MESSAGE = "Request timeout — coba lagi";
  let pushWaitMs = PUSH_WAIT_MS;

  // Hanya /api/plugins/<id> atau /api/plugins/<id>/…; tanpa karakter kontrol, segmen ./.. (juga ter-encode), //, \,
  // #, skema/host. Terakhir dinormalkan URL parser (yang membuang \t \n \r dan melipat ./..): pathname hasilnya wajib
  // sama persis dengan path asli dan tetap di bawah /api/plugins/<id> (review akhir PR B).
  const CONTROL_RE = /[\u0000-\u001F\u007F]/;
  function underBase(base, path) { return path === base || path.indexOf(base + "/") === 0; }
  function pluginPathOk(id, p) {
    if (typeof p !== "string" || CONTROL_RE.test(p)) return false;
    const base = "/api/plugins/" + id;
    if (!(p === base || p.indexOf(base + "/") === 0 || p.indexOf(base + "?") === 0)) return false;
    if (p.indexOf("//") >= 0 || p.indexOf("\\") >= 0 || p.indexOf("#") >= 0 || p.indexOf("://") >= 0) return false;
    const pathOnly = p.split("?")[0];
    for (const seg of pathOnly.split("/")) {
      let dec = seg;
      try { dec = decodeURIComponent(seg); } catch (_) { return false; }
      if (dec === "." || dec === ".." || dec.indexOf("/") >= 0 || dec.indexOf("\\") >= 0) return false;
    }
    if (typeof URL !== "function") return false;
    let u;
    try { u = new URL(p, "http://x"); } catch (_) { return false; }
    if (u.origin !== "http://x" || u.pathname !== pathOnly) return false;
    return underBase(base, u.pathname);
  }

  function hostIsOffline(err) {
    if (typeof hostBinding.isOfflineErr === "function") {
      try { if (hostBinding.isOfflineErr(err)) return true; } catch (_) {}
    } else if (err instanceof TypeError) {
      return true;
    }
    return !!err && err.status === 503 && err.message === "OFFLINE";
  }

  function mapFetchError(err) {
    if (err instanceof PluginNetworkError) return err;
    const e = err || {};
    const detail = e.body && typeof e.body === "object" ? e.body.detail : undefined;
    const code = detail && typeof detail === "object" ? detail.code : null;
    if (hostIsOffline(e)) return new PluginNetworkError("offline");
    if (e.status === 401) return new PluginNetworkError("auth", null, { status: 401 });
    if (e.message === HOST_TIMEOUT_MESSAGE) return new PluginNetworkError("timeout");
    if (e.status === 403 && code === "PLUGIN_DISABLED") return new PluginNetworkError("disabled", null, { status: 403, detail });
    if (e.status === 503 && code === "PLUGIN_UNAVAILABLE") return new PluginNetworkError("unavailable", null, { status: 503, detail });
    return new PluginNetworkError("http", typeof e.message === "string" && e.message ? e.message : null,
      { status: e.status == null ? null : e.status, detail });
  }

  function waitForPush(id) {
    const m = ps();
    if (!m || typeof m.hasPending !== "function" || typeof hostBinding.pushNow !== "function") return Promise.resolve();
    return Promise.resolve().then(() => m.hasPending(id)).catch(() => false).then((pending) => {
      if (!pending) return null;
      let timer = null;
      const sleep = new Promise((resolve) => { timer = setTimeout(resolve, pushWaitMs); });
      const push = Promise.resolve().then(() => hostBinding.pushNow()).catch((e) => warn("pushNow gagal:", e));
      return Promise.race([push, sleep]).then(() => { clearTimeout(timer); });
    });
  }

  function makeFetch(id) {
    return function pluginFetch(path, opts) {
      return Promise.resolve().then(() => {
        if (permissionsOf(id).indexOf("network") < 0) throw denied(id, "plugin " + id + " tidak punya izin network");
        if (!pluginPathOk(id, path)) throw denied(id, "api.fetch hanya ke /api/plugins/" + id + "/…, bukan " + String(path));
        const o = opts || {};
        const method = String(o.method || "GET").toUpperCase();
        if (FETCH_METHODS.indexOf(method) < 0) throw new TypeError("method tidak didukung: " + o.method);
        const init = { method };
        if (o.body !== undefined) {
          let json;
          try { json = JSON.stringify(o.body); } catch (e) { throw new TypeError("body tidak bisa diserialisasi JSON: " + e.message); }
          if (json === undefined) throw new TypeError("body tidak bisa diserialisasi JSON");
          if (utf8Bytes(json) > FETCH_BODY_MAX_BYTES) throw new TypeError("body melebihi 256 KB");
          init.body = json;
        }
        const timeoutMs = (typeof o.timeoutMs === "number" && o.timeoutMs > 0) ? o.timeoutMs : FETCH_TIMEOUT_MS;
        if (!env.online) throw new PluginNetworkError("offline");
        if (typeof hostBinding.fetch !== "function") throw new PluginNetworkError("unavailable");
        // Toggle ON yang baru dibuat sampai ke server lebih dulu (maks pushWaitMs).
        return waitForPush(id).then(() => {
          let timer = null;
          const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new PluginNetworkError("timeout")), timeoutMs);
          });
          return Promise.race([Promise.resolve().then(() => hostBinding.fetch(path, init)), timeout]).then(
            (v) => { clearTimeout(timer); return v; },
            (err) => { clearTimeout(timer); throw mapFetchError(err); });
        });
      });
    };
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

  // ── api.taskExt (izin task.ext, spec Fase 1 K4–K7; rencana 1a-1 R14) ─────────
  // Field plugin di task (`tasks.ext`, kunci "<pluginId>.<field>"), patch per kunci (null menghapus). Tulis lewat
  // binding host: patchTaskExt (optimistis di state React) → updateTaskExt (PUT {ext_patch} lewat rute lokal +
  // sinkron) → refreshTasks + event window taskUpdated.
  function taskext() {
    const m = host("taskext");
    if (!m) throw new Error("TF.taskext belum dimuat");
    return m;
  }

  function extFieldsOf(id) {
    const r = recs.get(id);
    const src = (r && r.manifest) || (index && index.get(id)) || null;
    const keys = src && isPlainObj(src.taskExt) && Array.isArray(src.taskExt.keys) ? src.taskExt.keys : [];
    return keys.filter((k) => typeof k === "string" && EXT_FIELD_RE.test(k));
  }

  function storageError(message, code, key) {
    const e = new PluginStorageError(message);
    if (code) e.code = code;
    if (key !== undefined) e.key = key;
    return e;
  }

  // Error host → error plugin: 422 EXT_* (rute lokal: message; jaringan: body.detail.code) → PluginStorageError;
  // 404 / "Task not found" → Error("Task not found"); selain itu diteruskan apa adanya.
  function mapExtError(err) {
    const e = err || {};
    const detail = e.body && typeof e.body === "object" && e.body.detail && typeof e.body.detail === "object" ? e.body.detail : null;
    const code = (typeof e.code === "string" && e.code) || (detail && typeof detail.code === "string" && detail.code) || String(e.message || "");
    if (e.status === 422 && /^EXT_[A-Z_]+$/.test(code)) {
      const key = e.key !== undefined ? e.key : (detail ? detail.key : undefined);
      return storageError(code, code, key === undefined ? null : key);
    }
    if (e.status === 404 || e.message === "Task not found") return new Error("Task not found");
    return err;
  }

  function makeTaskExt(id) {
    const prefix = id + ".";
    function guard() {
      if (permissionsOf(id).indexOf("task.ext") < 0) throw denied(id, "plugin " + id + " tidak punya izin task.ext");
    }
    function taskIdOk(taskId) {
      return (typeof taskId === "number" && Number.isInteger(taskId)) || (typeof taskId === "string" && taskId.length > 0);
    }
    // Patch tanpa prefiks → patch berprefiks yang sudah lolos aturan TF.taskext (ukuran diperiksa host).
    function prefixed(patch) {
      const tx = taskext();
      if (!tx.isPlainObject(patch)) throw storageError("patch taskExt harus objek");
      const fields = Object.keys(patch);
      if (!fields.length) throw storageError("patch taskExt kosong");
      const allowed = extFieldsOf(id);
      const out = {};
      for (const f of fields) {
        if (!EXT_FIELD_RE.test(f) || allowed.indexOf(f) < 0) {
          throw storageError("field " + f + " tidak terdaftar di manifest taskExt.keys", "EXT_INVALID", prefix + f);
        }
        out[prefix + f] = patch[f];
      }
      const bad = tx.checkPatch(out);
      if (bad) throw storageError(bad.code, bad.code, bad.key);
      return out;
    }
    function write(taskId, p) {
      if (typeof hostBinding.patchTaskExt === "function") {
        try { hostBinding.patchTaskExt(taskId, p); } catch (e) { warn("patchTaskExt gagal:", e); }
      }
      if (typeof hostBinding.updateTaskExt === "function") return Promise.resolve().then(() => hostBinding.updateTaskExt(taskId, p));
      return Promise.resolve().then(() => localTaskRouter().dispatch("PUT", "/api/tasks/" + encodeURIComponent(taskId), { ext_patch: p }));
    }
    function refresh() {
      if (typeof hostBinding.refreshTasks !== "function") return;
      try { Promise.resolve(hostBinding.refreshTasks()).catch((e) => warn("refreshTasks gagal:", e)); } catch (e) { warn("refreshTasks gagal:", e); }
    }
    function announce(detail) {
      try {
        if (typeof root.dispatchEvent === "function" && typeof CustomEvent === "function") {
          root.dispatchEvent(new CustomEvent("taskUpdated", { detail }));
        }
      } catch (e) { warn("taskUpdated gagal:", e); }
    }
    return Object.freeze({
      read(task) {
        guard();
        const ext = task && typeof task === "object" ? task.ext : null;
        const out = {};
        if (!taskext().isPlainObject(ext)) return out;
        for (const k of Object.keys(ext)) {
          if (k.indexOf(prefix) === 0 && k.length > prefix.length) out[k.slice(prefix.length)] = JSON.parse(JSON.stringify(ext[k]));
        }
        return out;
      },
      ref(task) {
        guard();
        const tid = task && typeof task === "object" ? task.id : task;
        if (!taskIdOk(tid)) throw new TypeError("ref butuh task dengan id");
        return { $task: tid };
      },
      set(taskId, patch) {
        let p;
        return Promise.resolve().then(() => {
          guard();
          if (!taskIdOk(taskId)) throw new TypeError("taskId tidak valid");
          p = prefixed(patch);
        }).then(() => write(taskId, p).then(
          (row) => { refresh(); announce({ taskId }); return row; },
          (err) => { refresh(); throw mapExtError(err); }));
      },
      // Untuk seret massal: berurutan, berhenti pada kegagalan pertama (yang sebelumnya tetap tersimpan);
      // satu refreshTasks + satu taskUpdated di akhir.
      setMany(items) {
        let prepared;
        return Promise.resolve().then(() => {
          guard();
          if (!Array.isArray(items)) throw storageError("setMany butuh array {taskId, patch}");
          prepared = items.map((it) => {
            if (!it || typeof it !== "object" || !taskIdOk(it.taskId)) throw storageError("item setMany butuh taskId");
            return { taskId: it.taskId, patch: prefixed(it.patch) };
          });
        }).then(() => {
          if (!prepared.length) return [];
          const rows = [];
          const done = [];
          const finish = () => { refresh(); if (done.length) announce({ taskIds: done.slice() }); };
          return prepared.reduce((chain, it) => chain.then(() => write(it.taskId, it.patch).then((row) => {
            rows.push(row);
            done.push(it.taskId);
          })), Promise.resolve()).then(
            () => { finish(); return rows; },
            (err) => { finish(); throw mapExtError(err); });
        });
      },
    });
  }

  let apiCache = new Map();
  const api = {
    apiVersion: API_VERSION,
    PluginStorageError,
    PluginPermissionError,
    PluginNetworkError,
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
          fetch: makeFetch(id),
          taskExt: makeTaskExt(id),
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

  const SLOT_CLASS = { "dashboard.widgets": "dash-grid-2 dash-plugins", "taskDetail.sections": "td-plugin-sections" };

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

  const SUBSCRIBE_EVENTS = ["plugins.ready", "plugins.changed", "plugins.loaded"];
  function useRuntimeVersion(React) {
    const pair = React.useReducer((x) => x + 1, 0);
    const force = pair[1];
    React.useEffect(() => {
      const bump = () => force();
      const offs = SUBSCRIBE_EVENTS.map((n) => events.on(n, bump));
      return () => offs.forEach((off) => off());
    }, []);
    return [pair[0], force];
  }

  // Hook host: tombol view untuk jenis halaman (identitas tetap sampai ada event plugins.*).
  function useViews(kind) {
    const React = root.React;
    const version = useRuntimeVersion(React)[0];
    return React.useMemo(() => viewsFor(kind), [kind, version, ready]);
  }

  function findContribution(r, name, itemId) {
    if (!r || !r.instance || !r.manifest || r.manifest.slots.indexOf(name) < 0) return null;
    const items = r.instance.slots && r.instance.slots[name];
    if (!Array.isArray(items)) return null;
    return items.find((it) => it && it.id === itemId && typeof it.component === "function") || null;
  }

  // <TF.SlotView name pluginId viewId label context onFallback/>: satu view plugin (taskList.views) yang dipilih
  // pengguna. Memuat kode plugin saat tampil; gagal → pesan + "Kembali ke Normal"; plugin OFF → null.
  function SlotView(props) {
    const React = root.React;
    const p = props || {};
    const name = p.name || "taskList.views";
    const pluginId = p.pluginId;
    const viewId = p.viewId;
    const label = typeof p.label === "string" && p.label ? p.label : String(pluginId || "Plugin");
    const context = p.context;
    const ctx = React.useMemo(() => Object.freeze(Object.assign({}, context || {})), [context]);
    const force = useRuntimeVersion(React)[1];
    const readyNow = ready;
    React.useEffect(() => {
      if (!readyNow || !isEnabled(pluginId)) return;
      load(pluginId, injectOverride ? { inject: injectOverride } : undefined).then(() => force(), () => force());
    }, [pluginId, readyNow]);
    if (!ready || !isEnabled(pluginId)) return null;
    const r = recs.get(pluginId);
    const item = findContribution(r, name, viewId);
    if (item) {
      const B = getBoundary();
      const Comp = r.debugThrow ? PluginDebugThrow : item.component;
      return React.createElement("div", { className: "tf-plugin-view", "data-plugin-view": pluginId + ":" + viewId },
        React.createElement(B, { key: pluginId + ":" + viewId + ":" + r.gen, pluginId },
          React.createElement(Comp, { context: ctx, api: api.for(pluginId) })));
    }
    if (r && (r.instance || r.failed)) {
      return React.createElement("div", { className: "tf-plugin-view tf-plugin-view-failed", role: "alert" },
        React.createElement("p", null, label + " tidak bisa dimuat"),
        React.createElement("button", {
          type: "button", className: "tf-plugin-view-back",
          onClick: () => { if (typeof p.onFallback === "function") p.onFallback(); },
        }, "Kembali ke Normal"));
    }
    return React.createElement("div", { className: "tf-plugin-view tf-plugin-view-loading", role: "status" }, "Memuat " + label + "…");
  }

  // Ikon tombol view dari manifest (path SVG 16×16, garis currentColor).
  function PluginIcon(props) {
    const React = root.React;
    const p = props || {};
    if (!iconPathOk(p.path)) return null;
    const size = typeof p.size === "number" && p.size > 0 ? p.size : 16;
    return React.createElement("svg", {
      viewBox: "0 0 16 16", width: size, height: size, fill: "none", stroke: "currentColor",
      strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false",
    }, React.createElement("path", { d: p.path }));
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
    init, list, isEnabled, accountEnabled, setEnabled, reloadState, knownIds, register, validateManifest, contributions, load, markFailed, failures, bindHost,
    pageKindOf, viewsFor, useViews, SlotView, PluginIcon,
    isReady: () => ready,
    get PluginBoundary() { return getBoundary(); },
    _renderSlot: renderSlot,
    _debugThrow,
    _setDefaultInject(fn) { injectOverride = typeof fn === "function" ? fn : null; },
    _reset,
    // Tes: modul TF.pluginstate pengganti (null = paksa tidak ada → perilaku 0a).
    _setPluginStateModule(m) { psOverride = m; },
    // Tes: batas tunggu pushNow api.fetch (bawaan 5000 ms).
    _setPushWaitMs(ms) { pushWaitMs = typeof ms === "number" && ms >= 0 ? ms : PUSH_WAIT_MS; },
  };

  // Browser: pasang jembatan event window sekali saat file dimuat.
  let bridgeUninstall = null;
  if (!isNode && typeof root.addEventListener === "function") {
    try { bridgeUninstall = installBridge(root); } catch (e) { warn("jembatan event gagal:", e); }
  }

  const exported = { plugins, events, api, Slot, SlotView, PluginIcon, createBus, jktDate };
  if (root && typeof root === "object") {
    root.TF = root.TF || {};
    root.TF.plugins = plugins;
    root.TF.events = events;
    root.TF.api = api;
    root.TF.Slot = Slot;
    root.TF.SlotView = SlotView;
    root.TF.PluginIcon = PluginIcon;
  }
  return exported;
});
