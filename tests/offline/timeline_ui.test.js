// Plugin Timeline (Fase 1, PR 1b) — Task 6: manifest + kerangka plugin + adaptor calendarStore
// (spec docs/superpowers/specs/2026-10-31-plugin-fase1-timeline-design.md §8.1; rencana R2, R4, R5, R14, R19, R24).
// calendarStore diuji dengan fakeRecords() berbentuk api.records 1a-2 (Task 11 mengintegrasikan yang nyata).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dir = path.join(__dirname, "../../static/plugins/timeline");
const jsx = fs.readFileSync(path.join(dir, "plugin.jsx"), "utf8");
const css = fs.readFileSync(path.join(dir, "style.css"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
const T = require(path.join(dir, "plugin.js"));
// Dedupe toast "kalah LWW" (final review #7): 1500 ms di aplikasi; 0 di tes = hanya dalam satu dispatch sinkron.
if (T.LOST_TIMING) T.LOST_TIMING.dedupeMs = 0;

test("manifest persis", () => {
  assert.deepEqual(manifest, {
    id: "timeline",
    name: "Timeline",
    description: "Gantt untuk project dan workspace: jadwal hari kerja, dependensi, milestone.",
    version: "1.4.0",
    minApi: 1,
    defaultEnabled: false,
    slots: ["taskList.views", "taskDetail.sections"],
    permissions: ["storage", "task.ext", "records"],
    contributes: {
      "taskList.views": [{ id: "gantt", label: "Timeline", icon: { path: "M2 4h7M5 8h8M3 12h5" }, pages: ["project", "workspace"] }],
      "taskDetail.sections": [{ id: "schedule", label: "Jadwal", order: 10 }],
    },
    records: { calendar: { conflict: "lww", maxBytes: 16384 }, project: { conflict: "lww", maxBytes: 1024 }, baseline: { conflict: "lww", maxBytes: 65536 }, resource: { conflict: "lww", maxBytes: 4096 } },
    taskExt: { keys: ["start", "duration", "deps", "mode", "constraint", "actual"] },
    // 1d-2 Task 4: mspdi.js (TLMspdi memakai TLLayout) SETELAH layout.js — di depannya bundel melempar TDZ saat dimuat
    parts: ["holidays-id.js", "calendar.js", "schedule.js", "cpm.js", "plan.js", "load.js", "layout.js", "mspdi.js", "drag.js"],
  });
});

// Bentuk api.records (README §5): put mengembalikan record publik, get → record atau null, onChange → off,
// list(entity, {scope, limit = 200, after}) → {items, next} urut id (1c-1 Task 6: entitas `project` per scope;
// 1c-2 Task 4: entitas `baseline` per scope yang sama), remove(entity, id) → tombstone (record hilang dari get/list).
function fakeRecords() {
  const store = new Map();
  const listeners = new Set();
  const calls = { get: [], put: [], list: [], remove: [], onChange: 0 };
  let ver = 0;
  return {
    calls,
    store,
    emit(ev) { for (const fn of [...listeners]) fn(ev); },
    listenerCount: () => listeners.size,
    api: {
      get(entity, id) {
        calls.get.push([entity, id]);
        const r = store.get(entity + "/" + id);
        return Promise.resolve(r ? JSON.parse(JSON.stringify(r)) : null);
      },
      list(entity, opts) {
        const o = opts || {};
        calls.list.push([entity, JSON.parse(JSON.stringify(o))]);
        const limit = Math.max(1, Math.min(1000, o.limit === undefined ? 200 : o.limit));
        const all = [...store.values()]
          .filter((r) => r.entity === entity && (o.scope === undefined || r.scope === o.scope) && (o.after === undefined || o.after === null || r.id > o.after))
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const items = all.slice(0, limit);
        return Promise.resolve({ items: JSON.parse(JSON.stringify(items)), next: all.length > limit && items.length ? items[items.length - 1].id : null });
      },
      put(entity, id, data, opts) {
        calls.put.push([entity, id, data, opts]);
        const rec = { entity, id, scope: opts.scope, data: JSON.parse(JSON.stringify(data)), updated_at: "2026-11-01T00:00:00Z", version: ++ver, pending: true };
        store.set(entity + "/" + id, rec);
        return Promise.resolve(JSON.parse(JSON.stringify(rec)));
      },
      remove(entity, id) {
        calls.remove.push([entity, id]);
        store.delete(entity + "/" + id);
        return Promise.resolve();
      },
      onChange(fn) {
        calls.onChange += 1;
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
  };
}

test("calendarStore: load tanpa record → DEFAULT_CAL pending false; load record → normalisasi + pending", async () => {
  const fr = fakeRecords();
  const store = T.calendarStore({ records: fr.api });
  const r = await store.load("cal@user");
  assert.deepEqual(r, { data: T.TLCal.DEFAULT_CAL, pending: false, exists: false });
  assert.deepEqual(fr.calls.get, [["calendar", "cal@user"]]);
  // data anggota lain dinormalisasi (weekdays kosong → bawaan, kunci asing dibuang)
  fr.store.set("calendar/cal@list:7", { entity: "calendar", id: "cal@list:7", scope: "list:7", pending: true, data: { v: 1, weekdays: [], national: false, extra: 1, off: [{ d: "2026-12-24", n: "Libur kantor" }, { d: "bukan", n: "x" }], work: [] } });
  const r2 = await store.load("cal@list:7");
  assert.equal(r2.pending, true);
  assert.equal(r2.exists, true, "record ada di perangkat ini");
  assert.deepEqual(r2.data, { v: 1, weekdays: [1, 2, 3, 4, 5], national: false, cutiBersama: true, off: [{ d: "2026-12-24", n: "Libur kantor" }], work: [] });
});

test("calendarStore: save menulis hasil normalisasi + v:1 dengan scope, mengembalikan data dan pending", async () => {
  const fr = fakeRecords();
  const store = T.calendarStore({ records: fr.api });
  const res = await store.save("cal@list:7", "list:7", { weekdays: [6, 1, 1, 9], national: true, cutiBersama: false, off: [{ d: "2026-12-24", n: "Libur kantor" }], work: [], asing: true });
  assert.equal(fr.calls.put.length, 1);
  const [entity, id, data, opts] = fr.calls.put[0];
  assert.equal(entity, "calendar");
  assert.equal(id, "cal@list:7");
  assert.deepEqual(opts, { scope: "list:7" });
  assert.deepEqual(data, { v: 1, weekdays: [1, 6], national: true, cutiBersama: false, off: [{ d: "2026-12-24", n: "Libur kantor" }], work: [] });
  assert.deepEqual(res, { data, pending: true, exists: true });
});

test("calendarStore: save > 16384 byte → reject pesan persis tanpa memanggil put", async () => {
  const fr = fakeRecords();
  const store = T.calendarStore({ records: fr.api });
  const off = [];
  for (let i = 0; i < 366; i++) off.push({ d: T.TLCal.iso(T.TLCal.dn("2026-01-01") + i), n: "é".repeat(30) });
  const big = { weekdays: [1, 2, 3, 4, 5], off };
  assert.ok(T.TLCal.byteSize(T.TLCal.normalize(big)) > 16384);
  await assert.rejects(store.save("cal@user", "user", big), (e) => e instanceof Error && e.message === "Kalender terlalu besar — hapus sebagian libur tambahan");
  assert.equal(fr.calls.put.length, 0);
  // tepat di batas (≤ 16384) masih boleh
  const ok = { weekdays: [1, 2, 3, 4, 5], off: off.slice(0, 20) };
  await store.save("cal@user", "user", ok);
  assert.equal(fr.calls.put.length, 1);
});

test("calendarStore: subscribe meneruskan entitas calendar dengan ids, source, lost; off berhenti; entitas lain diabaikan", () => {
  const fr = fakeRecords();
  const store = T.calendarStore({ records: fr.api });
  const got = [];
  const off = store.subscribe((ev) => got.push(ev));
  assert.equal(fr.listenerCount(), 1);
  fr.emit({ entity: "calendar", ids: ["cal@list:7"], source: "sync", lost: ["cal@list:7"] });
  fr.emit({ entity: "calendar", ids: ["cal@user"], source: "local" });
  fr.emit({ entity: "lain", ids: ["x"], source: "local" });
  assert.deepEqual(got, [
    { ids: ["cal@list:7"], source: "sync", lost: ["cal@list:7"] },
    { ids: ["cal@user"], source: "local", lost: [] },
  ]);
  off();
  assert.equal(fr.listenerCount(), 0);
  fr.emit({ entity: "calendar", ids: ["cal@user"], source: "sync" });
  assert.equal(got.length, 2);
});

test("calendarStore: calIdFor/scopeFor — task workspace → cal@list:<id>, tanpa list_id → cal@user (R4)", () => {
  assert.deepEqual(T.calTarget(12), { id: "cal@list:12", scope: "list:12" });
  assert.deepEqual(T.calTarget("12"), { id: "cal@list:12", scope: "list:12" });
  assert.deepEqual(T.calTarget(null), { id: "cal@user", scope: "user" });
  assert.deepEqual(T.calTarget(undefined), { id: "cal@user", scope: "user" });
  assert.deepEqual(T.calTarget(""), { id: "cal@user", scope: "user" });
  assert.deepEqual(T.calTarget(0), { id: "cal@user", scope: "user" });
});

test("calendarStore, projectStore, baselineStore, dan resourceStore satu-satunya yang menyentuh api.records; tiap entitas hanya di adaptornya (R5, R6, 1c-2 K41, 1d-1 K48)", () => {
  const hits = jsx.match(/\.records\b/g) || [];
  assert.ok(hits.length > 0);
  const body = (name) => {
    const start = jsx.indexOf("function " + name + "(");
    const end = jsx.indexOf("\n}\n", start);
    assert.ok(start > 0 && end > start, name);
    return [start, end];
  };
  const [cs, ce] = body("calendarStore");
  const [ps, pe] = body("projectStore");
  const [bs, be] = body("baselineStore");
  const [rs, re] = body("resourceStore");
  const strip = (s) => s.replace(/\/\/[^\n]*/g, "");
  const cuts = [[cs, ce], [ps, pe], [bs, be], [rs, re]].sort((a, b) => a[0] - b[0]);
  let outside = "";
  let at = 0;
  for (const [s0, e0] of cuts) { outside += jsx.slice(at, s0); at = e0; }
  outside += jsx.slice(at);
  assert.doesNotMatch(strip(outside), /api\.records|\.records\./);
  // calendarStore hanya entitas calendar (CAL_ENTITY), projectStore hanya entitas project (PRJ_ENTITY)
  assert.doesNotMatch(strip(jsx.slice(cs, ce)), /PRJ_ENTITY|"project"/);
  assert.doesNotMatch(strip(jsx.slice(ps, pe)), /CAL_ENTITY|"calendar"/);
  assert.match(jsx, /const PRJ_ENTITY = "project";/);
  // baselineStore hanya entitas baseline (BL_ENTITY); adaptor lain tidak menyentuhnya
  assert.doesNotMatch(strip(jsx.slice(bs, be)), /CAL_ENTITY|PRJ_ENTITY|"calendar"|"project"/);
  assert.match(strip(jsx.slice(bs, be)), /BL_ENTITY/);
  assert.doesNotMatch(strip(jsx.slice(cs, ce)) + strip(jsx.slice(ps, pe)), /BL_ENTITY|"baseline"/);
  assert.match(jsx, /const BL_ENTITY = "baseline";/);
  // 1d-1 Task 2: resourceStore hanya entitas resource (RES_ENTITY); adaptor lain tidak menyentuhnya
  assert.doesNotMatch(strip(jsx.slice(rs, re)), /CAL_ENTITY|PRJ_ENTITY|BL_ENTITY|"calendar"|"project"|"baseline"/);
  assert.match(strip(jsx.slice(rs, re)), /RES_ENTITY/);
  assert.doesNotMatch(strip(jsx.slice(cs, ce)) + strip(jsx.slice(ps, pe)) + strip(jsx.slice(bs, be)), /RES_ENTITY|"resource"/);
  assert.match(jsx, /const RES_ENTITY = "resource";/);
});

test("registrasi: view gantt (taskList.views) dan seksi schedule order 10 (taskDetail.sections), komponen fungsi, sesuai contributes", () => {
  let reg = null;
  const prevWindow = global.window;
  const calls = [];
  // plugin.js sudah dievaluasi tanpa window; jalankan ulang di vm dengan window.TF.plugins palsu
  const vm = require("node:vm");
  const code = fs.readFileSync(path.join(dir, "plugin.js"), "utf8");
  const sandbox = { window: { TF: { plugins: { register: (m, f) => calls.push([m, f]) } } }, React: { createElement: () => null, memo: (c) => c } };
  sandbox.self = sandbox.window;
  vm.runInNewContext(code, sandbox);
  assert.equal(calls.length, 1);
  reg = calls[0];
  assert.equal(reg[0].id, "timeline");
  assert.deepEqual(JSON.parse(JSON.stringify(reg[0].taskExt)), manifest.taskExt);
  const inst = reg[1]({ records: {}, storage: {}, taskExt: {}, log: {}, ui: {} });
  assert.deepEqual(Object.keys(inst.slots).sort(), ["taskDetail.sections", "taskList.views"]);
  const views = inst.slots["taskList.views"];
  const secs = inst.slots["taskDetail.sections"];
  assert.equal(views.length, 1);
  assert.equal(views[0].id, "gantt");
  assert.equal(typeof views[0].component, "function");
  assert.equal(secs.length, 1);
  assert.equal(secs[0].id, "schedule");
  assert.equal(secs[0].order, 10);
  assert.equal(typeof secs[0].component, "function");
  assert.equal(global.window, prevWindow);
});

test("kerangka: tanpa hex/rgb tetap di plugin.jsx/style.css; kelas hanya .plg-timeline-*; tanpa modul host", () => {
  for (const [name, src] of [["plugin.jsx", jsx], ["style.css", css]]) {
    assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/, name + " tanpa hex");
    assert.doesNotMatch(src, /rgba?\(|hsla?\(/, name + " tanpa rgb/hsl tetap");
  }
  // Kelas CSS: .plg-timeline-*; pengubah .is-* hanya boleh menempel pada pemilih .plg-timeline-* (mis. .plg-timeline-bar.is-late).
  const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of cssCode.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
    if (m[1].startsWith("is-")) {
      const before = cssCode.slice(0, m.index).match(/[^\s,>+~{}]*$/)[0]; // :not(.is-x) tetap satu pemilih majemuk
      assert.match(before, /\.plg-timeline[\w-]*/, "pengubah " + m[1] + " tanpa .plg-timeline-*");
    } else assert.ok(m[1].startsWith("plg-timeline"), "kelas CSS " + m[1]);
  }
  assert.doesNotMatch(jsx, /fetch\(|localStorage|indexedDB|innerHTML|tokenStore|API_BASE|window\.TF\.(?!plugins\.register)/);
});

test("preferensi per perangkat (R19): kunci storage zoom/sort/cols/mode per halaman + section:open, bawaan aman", () => {
  assert.equal(T.prefKey("zoom", "proj_3"), "zoom:proj_3");
  assert.equal(T.prefKey("section"), "section:open");
  assert.equal(T.PREF_DEFAULTS.zoom, "week");
  assert.equal(T.PREF_DEFAULTS.sort, "wbs");
  assert.equal(T.PREF_DEFAULTS.cols, false);
  assert.equal(T.PREF_DEFAULTS.mode, "gantt");
  assert.equal(T.PREF_DEFAULTS.section, false);
  assert.equal(T.cleanPref("zoom", "day"), "day");
  assert.equal(T.cleanPref("zoom", "tahun"), "week");
  assert.equal(T.cleanPref("sort", "start"), "start");
  assert.equal(T.cleanPref("sort", 1), "wbs");
  assert.equal(T.cleanPref("mode", "list"), "list");
  assert.equal(T.cleanPref("mode", undefined), "gantt");
  assert.equal(T.cleanPref("cols", true), true);
  assert.equal(T.cleanPref("cols", "ya"), false);
  assert.equal(T.cleanPref("section", true), true);
});

test("calendarStore: PluginStorageError TOO_LARGE dari put (pengaman kedua) dipetakan ke pesan yang sama; galat lain diteruskan", async () => {
  const fr = fakeRecords();
  const codes = ["TOO_LARGE", "INVALID"];
  fr.api.put = () => { const e = new Error("x"); e.code = codes.shift(); return Promise.reject(e); };
  const store = T.calendarStore({ records: fr.api });
  await assert.rejects(store.save("cal@user", "user", {}), (e) => e.message === "Kalender terlalu besar — hapus sebagian libur tambahan");
  await assert.rejects(store.save("cal@user", "user", {}), (e) => e.code === "INVALID" && e.message === "x");
});

// ════════════════════════════════════════════════════════════════════════════
// Task 7 — TimelineView: tabel + grafik (render). React palsu + dispatcher hooks palsu yang menyimpan state antar
// render (useState/useRef/useMemo/useEffect/useLayoutEffect berdasarkan urutan panggilan) sehingga memo, efek, dan
// preferensi bisa diuji tanpa DOM. Pohon = {type, props, children}; elemen DOM = node dengan type string.
// ════════════════════════════════════════════════════════════════════════════

const TODAY = "2026-11-04"; // Rabu

function sameDeps(a, b) {
  return !!a && !!b && a.length === b.length && a.every((d, i) => Object.is(d, b[i]));
}

// Satu "instance" komponen: render(props) memanggil Comp dengan hooks palsu; flush() menjalankan efek tertunda.
function mount(Comp) {
  const slots = [];
  const pending = [];
  const setCalls = [];
  let i = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    Fragment: "#fragment",
    memo: (c) => c,
    useState(init) {
      const k = i++;
      if (!slots[k]) slots[k] = { v: typeof init === "function" ? init() : init };
      const s = slots[k];
      // Seperti React: nilai identik (Object.is) = bail out, tidak dihitung sebagai setState.
      if (!s.set) s.set = (nv) => { const v = typeof nv === "function" ? nv(s.v) : nv; if (Object.is(v, s.v)) return; setCalls.push(k); s.v = v; };
      return [s.v, s.set];
    },
    useReducer(red, init) {
      const k = i++;
      if (!slots[k]) slots[k] = { v: init };
      const s = slots[k];
      if (!s.set) s.set = (a) => { setCalls.push(k); s.v = red(s.v, a); };
      return [s.v, s.set];
    },
    useRef(v) {
      const k = i++;
      if (!slots[k]) slots[k] = { current: v };
      return slots[k];
    },
    useMemo(fn, deps) {
      const k = i++;
      const s = slots[k];
      if (s && sameDeps(s.deps, deps)) return s.v;
      slots[k] = { v: fn(), deps };
      return slots[k].v;
    },
    useCallback(fn, deps) { return React.useMemo(() => fn, deps); },
    useEffect(fn, deps) { effect(fn, deps); },
    useLayoutEffect(fn, deps) { effect(fn, deps); },
  };
  function effect(fn, deps) {
    const k = i++;
    const s = slots[k];
    if (s && deps && sameDeps(s.deps, deps)) return;
    const prev = s && s.cleanup;
    slots[k] = { deps, cleanup: null };
    pending.push(() => {
      if (typeof prev === "function") prev();
      const c = fn();
      slots[k].cleanup = c;
    });
  }
  let last = null;
  const api = {
    setCalls,
    render(props) {
      const prevR = global.React;
      global.React = React;
      i = 0;
      try { last = Comp(props); } finally { global.React = prevR; }
      return last;
    },
    flush() {
      const prevR = global.React;
      global.React = React;
      try { while (pending.length) pending.shift()(); } finally { global.React = prevR; }
    },
    unmount() {
      for (const s of slots) if (s && typeof s.cleanup === "function") s.cleanup();
    },
  };
  return api;
}

function nodes(node, pred, out = []) {
  if (Array.isArray(node)) { for (const n of node) nodes(n, pred, out); return out; }
  if (!node || typeof node !== "object") return out;
  if (pred(node)) out.push(node);
  for (const c of node.children || []) nodes(c, pred, out);
  return out;
}
const txt = (n) => (Array.isArray(n) ? n.map(txt).join("") : n && typeof n === "object" ? (n.children || []).map(txt).join("") : n == null || n === false || n === true ? "" : String(n));
const hasCls = (n, c) => typeof n.props.className === "string" && n.props.className.split(/\s+/).indexOf(c) >= 0;
const byCls = (tree, c) => nodes(tree, (n) => hasCls(n, c));
const domCount = (tree) => nodes(tree, (n) => typeof n.type === "string").length;
const buttonByText = (tree, t) => nodes(tree, (n) => n.type === "button" && txt(n).trim() === t)[0];
const tick = () => new Promise((r) => setTimeout(r, 0));

function ext(o) {
  const out = {};
  for (const k of Object.keys(o || {})) out["timeline." + k] = o[k];
  return out;
}
function mk(id, title, sched, extra) {
  return Object.assign({ id, title, created_at: "2026-10-01T00:00:" + String(id % 60).padStart(2, "0") + "Z", gtd_status: "next", ext: ext(sched) }, extra || {});
}

function fakeApi(opts) {
  const o = opts || {};
  const fr = o.records || fakeRecords();
  const calls = { storageGet: [], storageSet: [], toast: [], warn: [], handlers: {} };
  const api = {
    id: "timeline",
    records: fr.api,
    events: {
      on(name, fn) { (calls.handlers[name] = calls.handlers[name] || []).push(fn); return () => { calls.handlers[name] = calls.handlers[name].filter((f) => f !== fn); }; },
    },
    taskExt: {
      read(t) {
        const out = {};
        for (const k of Object.keys((t && t.ext) || {})) if (k.indexOf("timeline.") === 0) out[k.slice(9)] = t.ext[k];
        return out;
      },
      ref: (t) => ({ $task: t.id }),
      set: () => Promise.resolve(),
      setMany: () => Promise.resolve(),
    },
    env: { today: () => o.today || TODAY, online: true },
    // Daftar task lengkap (useEngine, 1c-1 Task 6); bawaan kosong — ixSetup/tes mesin menggantinya.
    data: { tasks: { list: () => Promise.resolve(o.list || []) } },
    storage: {
      get(k) { calls.storageGet.push(k); return o.storageGet ? o.storageGet(k) : Promise.resolve(null); },
      set(k, v) { calls.storageSet.push([k, v]); return Promise.resolve(); },
    },
    ui: { toast: (...a) => calls.toast.push(a) },
    log: { info() {}, warn: (...a) => calls.warn.push(a), error: (...a) => calls.warn.push(a) },
  };
  return { api, calls, fr };
}

function ctxOf(tasks, extra) {
  const clicked = [];
  const ctx = Object.assign({
    page: "proj_Alpha", pageKind: "project", listId: null, projectName: "Alpha",
    tasks, scopeTasks: tasks, liveEdit: false,
    onTaskClick: (t) => clicked.push(t), isSelected: () => false, showToast: () => {},
  }, extra || {});
  return { ctx, clicked };
}

const rowOf = (tree, key) => nodes(tree, (n) => n.props.role === "row" && n.props["data-key"] === key)[0];
const cellsOf = (row) => nodes(row, (n) => n.props.role === "gridcell");

test("render 3 task (satu milestone, satu ringkasan + anak, satu tanpa jadwal): baris, WBS, Mulai '—' untuk tanpa jadwal, bar/milestone/ringkasan sesuai kind", () => {
  const tasks = [
    mk(1, "Rilis", { start: "2026-11-06", duration: 0 }),
    mk(2, "Desain", {}),
    mk(3, "Wireframe", { start: "2026-11-02", duration: 3 }, { parent_id: 2, pomodoros_done: 2, estimated_pomodoros: 4, progress: 40 }),
    mk(4, "Rencana", {}),
  ];
  const { api } = fakeApi();
  const { ctx, clicked } = ctxOf(tasks, { isSelected: (t) => t.id === 3 });
  const m = mount(T.TimelineViewBody);
  const tree = m.render({ context: ctx, api });
  const grid = nodes(tree, (n) => n.props.role === "grid")[0];
  assert.ok(grid, "wadah role=grid");
  assert.equal(grid.props["aria-rowcount"], 5);
  assert.ok(hasCls(grid, "plg-timeline-scroll"));
  // tabel: WBS + Mulai
  const wbs = (k) => txt(cellsOf(rowOf(tree, k))[0]).trim();
  assert.deepEqual(["1", "2", "3", "4"].map(wbs), ["1", "2", "2.1", "3"]);
  const cells3 = cellsOf(rowOf(tree, "3")).map((c) => txt(c).trim());
  assert.deepEqual(cells3, ["2.1", "Wireframe", "Sen 2 Nov", "3 hk", "2/4", "40%", "—"]); // Slack "—" sampai mesin siap (1c-1 R18)
  assert.equal(txt(cellsOf(rowOf(tree, "4"))[2]).trim(), "—");
  assert.equal(txt(cellsOf(rowOf(tree, "1"))[2]).trim(), "Jum 6 Nov");
  assert.equal(rowOf(tree, "3").props["aria-rowindex"], 4);
  assert.ok(hasCls(rowOf(tree, "3"), "is-selected"));
  assert.ok(!hasCls(rowOf(tree, "1"), "is-selected"));
  // grafik: kind
  const ms = byCls(tree, "plg-timeline-milestone");
  const sum = byCls(tree, "plg-timeline-summary");
  const bars = byCls(tree, "plg-timeline-bar");
  assert.deepEqual(ms.map((n) => n.props["data-key"]), ["1"]);
  assert.deepEqual(sum.map((n) => n.props["data-key"]), ["2"]);
  assert.deepEqual(bars.map((n) => n.props["data-key"]), ["3"]);
  for (const b of [...ms, ...sum, ...bars]) {
    assert.equal(b.props.role, "button");
    assert.equal(b.props.tabIndex, 0);
  }
  assert.equal(ms[0].props["aria-label"], "Rilis, milestone Jum 6 Nov");
  assert.equal(sum[0].props["aria-label"], "Desain, Sen 2 Nov sampai Rab 4 Nov, 3 hari kerja, 0%");
  assert.equal(bars[0].props["aria-label"], "Wireframe, Sen 2 Nov sampai Rab 4 Nov, 3 hari kerja, 40%");
  assert.ok(hasCls(bars[0], "is-selected"));
  // lapisan % = progress
  const fill = byCls(bars[0], "plg-timeline-fill")[0];
  assert.equal(fill.props.style.width, "40%");
  // tanpa jadwal: tanpa bar, ada petunjuk "Klik untuk menjadwalkan"
  const slots = byCls(tree, "plg-timeline-slot");
  assert.deepEqual(slots.map((n) => n.props["data-key"]), ["4"]);
  assert.equal(txt(slots[0]).trim(), "Klik untuk menjadwalkan");
  const hint = byCls(slots[0], "plg-timeline-hint")[0];
  assert.equal(hint.props.style.lineHeight, "32px", "petunjuk setinggi baris (bukan konstanta CSS)");
  assert.doesNotMatch(css, /\.plg-timeline-hint\s*\{[^}]*line-height/);
  // garis hari ini, header sticky, klik bar/baris → onTaskClick
  assert.equal(byCls(tree, "plg-timeline-today").length, 1);
  bars[0].props.onClick({});
  rowOf(tree, "4").props.onClick({});
  assert.deepEqual(clicked.map((t) => t.id), [3, 4]);
  // Enter pada bar = buka task (R23)
  bars[0].props.onKeyDown({ key: "Enter", preventDefault() {} });
  assert.deepEqual(clicked.map((t) => t.id), [3, 4, 3]);
});

test("bendera tenggat: merah (kelas is-late) bila finish > deadline; tetap tampil tanpa jadwal; di luar rentang dilewati; baris outOfRange tanpa bar", () => {
  const tasks = [
    mk(1, "Telat", { start: "2026-11-02", duration: 5 }, { deadline: "2026-11-04" }),
    mk(2, "Belum", {}, { deadline: "2026-11-10T00:00:00" }),
    mk(3, "Jauh", { start: "2026-11-02", duration: 1 }, { deadline: "2045-01-01" }),
    mk(4, "Salah ketik", { start: "2045-05-01", duration: 2 }),
  ];
  const { api } = fakeApi();
  const { ctx } = ctxOf(tasks);
  const tree = mount(T.TimelineViewBody).render({ context: ctx, api });
  const flags = byCls(tree, "plg-timeline-flag");
  assert.deepEqual(flags.map((f) => f.props["data-key"]), ["1", "2"]);
  assert.ok(hasCls(flags[0], "is-late"));
  assert.ok(!hasCls(flags[1], "is-late"));
  assert.equal(flags[0].props.title, "Tenggat Rab 4 Nov");
  const bar1 = byCls(tree, "plg-timeline-bar").find((b) => b.props["data-key"] === "1");
  assert.ok(hasCls(bar1, "is-late"), "bar selesai setelah tenggat = --danger");
  assert.equal(byCls(tree, "plg-timeline-bar").filter((b) => b.props["data-key"] === "4").length, 0, "outOfRange → tanpa bar");
});

test("panah: pelanggaran → kelas is-violation + ⚠ baris dengan aria-label persis", () => {
  const tasks = [
    mk(1, "A", { start: "2026-11-02", duration: 3 }),
    mk(2, "B", { start: "2026-11-03", duration: 2, deps: [{ t: { $task: 1 }, type: "FS", lag: 0 }] }),
    mk(3, "C", { start: "2026-11-09", duration: 1, deps: [{ t: { $task: 1 }, type: "FS", lag: 0 }] }),
  ];
  const { api } = fakeApi();
  const { ctx } = ctxOf(tasks);
  const tree = mount(T.TimelineViewBody).render({ context: ctx, api });
  const svgs = nodes(tree, (n) => n.type === "svg" && hasCls(n, "plg-timeline-arrows"));
  assert.equal(svgs.length, 1, "satu svg overlay");
  assert.equal(svgs[0].props["aria-hidden"], "true");
  const arrows = byCls(tree, "plg-timeline-arrow");
  assert.equal(arrows.length, 2);
  assert.equal(arrows.filter((a) => hasCls(a, "is-violation")).length, 1);
  for (const a of arrows) assert.match(a.props.d, /^M[\d.\- ]+H/);
  const warn = (k) => nodes(rowOf(tree, k), (n) => n.props["aria-label"] === "Mulai sebelum dependensi selesai");
  assert.equal(warn("2").length, 1);
  assert.equal(txt(warn("2")[0]).trim(), "⚠");
  assert.equal(warn("1").length, 0);
  assert.equal(warn("3").length, 0);
});

function bigTasks(n, deps) {
  const tasks = [];
  const base = T.TLCal.dn("2026-08-01");
  for (let i = 0; i < n; i++) {
    const sched = i % 7 === 6 ? {} : { start: T.TLCal.iso(base + (i * 3) % 240), duration: 1 + (i % 9) };
    if (i > 0 && i <= deps) sched.deps = [{ t: { $task: i }, type: "FS", lag: i % 3 }];
    const extra = { project: "P" + (i % 5), project_id: 100 + (i % 5), progress: i % 100 };
    if (i % 10 > 0 && i % 10 < 4) extra.parent_id = i - (i % 10) + 1; // anak dari task kelipatan 10 (+1 → id)
    if (i % 4 === 0) extra.deadline = T.TLCal.iso(base + (i * 3) % 240 + 5);
    tasks.push(mk(i + 1, "Task " + (i + 1), sched, extra));
  }
  return tasks;
}

test("500 task + 400 dep, viewH 600, viewW 1000: jumlah elemen pohon ≤ 1.500 (Minggu dan Hari)", async () => {
  const tasks = bigTasks(500, 400);
  const zoom = { v: null };
  const { api } = fakeApi({ storageGet: (k) => Promise.resolve(k.indexOf("zoom:") === 0 ? zoom.v : null) });
  const { ctx } = ctxOf(tasks, { page: "slist_12", pageKind: "workspace", listId: 12, projectName: null });
  const m = mount(T.TimelineViewBody);
  const tree = m.render({ context: ctx, api });
  const nWeek = domCount(tree);
  const taskRows = nodes(tree, (n) => n.props.role === "row" && n.props["aria-rowindex"] > 1);
  assert.ok(taskRows.length > 20 && taskRows.length <= 60, "baris tervirtualisasi: " + taskRows.length);
  assert.ok(byCls(tree, "plg-timeline-arrow").length > 0, "ada panah");
  assert.ok(nWeek <= 1500, "Minggu: " + nWeek + " elemen");
  // semua kelas di pohon: plg-timeline-* atau pengubah is-*
  for (const n of nodes(tree, (x) => typeof x.props.className === "string")) {
    for (const c of n.props.className.split(/\s+/).filter(Boolean)) assert.match(c, /^(plg-timeline(-[\w-]+)?|is-[\w-]+)$/, c);
  }
  zoom.v = "day";
  m.render({ context: ctx, api });
  m.flush();
  await tick();
  const treeDay = m.render({ context: ctx, api });
  assert.equal(buttonByText(treeDay, "Hari").props["aria-checked"], true);
  const nDay = domCount(treeDay);
  assert.ok(nDay <= 1500, "Hari: " + nDay + " elemen");
  console.log("# DOM elemen 500 task/400 dep: Minggu " + nWeek + ", Hari " + nDay);
  m.unmount();
});

test("context baru dengan scopeTasks identik → layout tidak dihitung ulang (R24)", () => {
  const tasks = [mk(1, "A", { start: "2026-11-02", duration: 3 }), mk(2, "B", {})];
  const { api } = fakeApi();
  const { ctx } = ctxOf(tasks);
  const orig = T.engine.layout;
  let n = 0;
  T.engine.layout = (a) => { n++; return orig(a); };
  try {
    const m = mount(T.TimelineViewBody);
    m.render({ context: ctx, api });
    m.render({ context: Object.assign({}, ctx), api });
    m.render({ context: Object.assign({}, ctx, { liveEdit: false, isSelected: () => true }), api });
    assert.equal(n, 1);
    m.render({ context: Object.assign({}, ctx, { scopeTasks: tasks.slice() }), api });
    assert.equal(n, 2);
  } finally {
    T.engine.layout = orig;
  }
  assert.match(jsx, /React\.memo\(TimelineViewBody\)/);
});

test("1c-2: layout menerima resolver jangkar (anchorInfo) dari sumber mesin — modeOf lewat TLSched.modeOf + useUnits, inCycle false sebelum mesin siap", () => {
  const tasks = [mk(1, "A", { start: "2026-11-02", duration: 3, actual: { start: "2026-10-30" } })];
  const { api } = fakeApi();
  const { ctx } = ctxOf(tasks);
  const orig = T.engine.layout;
  const seen = [];
  T.engine.layout = (a) => { seen.push(a); return orig(a); };
  try {
    mount(T.TimelineViewBody).render({ context: ctx, api });
  } finally {
    T.engine.layout = orig;
  }
  const ai = seen[0].anchorInfo;
  assert.equal(typeof ai.modeOf, "function");
  assert.equal(ai.modeOf(tasks[0]), "manual", "unit belum dimuat/tanpa record → manual (sama dengan mesin)");
  assert.equal(ai.inCycle("1"), false, "mesin belum siap → bukan anggota lingkaran");
  assert.match(jsx, /modeOf: \(t\) => TLSched\.modeOf\(readSchedOf\(t\), units, t\)/);
  assert.match(jsx, /const units = un\.units;/);
});

const headerCells = (tree) => nodes(tree, (n) => n.props.role === "columnheader").map((n) => txt(n).trim());

test("≤ 640 px / liveEdit: hanya WBS + Nama + tombol Kolom", async () => {
  const tasks = [mk(1, "A", { start: "2026-11-02", duration: 3 })];
  // lebar, tanpa Live Edit: semua kolom, tanpa tombol Kolom / Gantt|Daftar
  {
    const { api } = fakeApi();
    const tree = mount(T.TimelineViewBody).render({ context: ctxOf(tasks).ctx, api });
    assert.deepEqual(headerCells(tree), ["WBS", "Nama", "Mulai", "Dur", "🍅", "%", "Slack"]);
    assert.equal(buttonByText(tree, "Kolom"), undefined);
    assert.equal(buttonByText(tree, "Gantt"), undefined);
  }
  // Live Edit: WBS + Nama + Kolom; Kolom → cols:<page> true → semua kolom
  {
    const { api, calls } = fakeApi();
    const m = mount(T.TimelineViewBody);
    const ctx = ctxOf(tasks, { liveEdit: true }).ctx;
    let tree = m.render({ context: ctx, api });
    assert.deepEqual(headerCells(tree), ["WBS", "Nama"]);
    assert.deepEqual(cellsOf(rowOf(tree, "1")).map((c) => txt(c).trim()), ["1", "A"]);
    const kol = buttonByText(tree, "Kolom");
    assert.ok(kol);
    assert.equal(kol.props["aria-pressed"], false);
    assert.equal(buttonByText(tree, "Gantt"), undefined, "Gantt|Daftar hanya ≤ 640 px");
    kol.props.onClick({});
    tree = m.render({ context: ctx, api });
    assert.deepEqual(headerCells(tree), ["WBS", "Nama", "Mulai", "Dur", "🍅", "%", "Slack"]);
    await tick();
    assert.deepEqual(calls.storageSet, [["cols:proj_Alpha", true]]);
  }
  // ≤ 640 px (matchMedia): WBS + Nama + Kolom + sakelar Gantt | Daftar
  const prevWin = global.window;
  global.window = { matchMedia: (q) => ({ matches: q === "(max-width: 640px)", addEventListener() {}, removeEventListener() {} }), innerHeight: 800 };
  try {
    const { api } = fakeApi();
    const tree = mount(T.TimelineViewBody).render({ context: ctxOf(tasks).ctx, api });
    assert.deepEqual(headerCells(tree), ["WBS", "Nama"]);
    assert.ok(buttonByText(tree, "Kolom"));
    assert.ok(buttonByText(tree, "Gantt"));
    assert.ok(buttonByText(tree, "Daftar"));
  } finally {
    global.window = prevWin;
  }
});

test("zoom dibaca/ditulis api.storage zoom:<page>; gagal baca → week", async () => {
  const tasks = [mk(1, "A", { start: "2026-11-02", duration: 3 })];
  const zoomBtn = (tree) => ["Hari", "Minggu", "Bulan"].map((l) => buttonByText(tree, l).props["aria-checked"]);
  {
    const { api, calls } = fakeApi({ storageGet: (k) => Promise.resolve(k === "zoom:proj_Alpha" ? "day" : null) });
    const m = mount(T.TimelineViewBody);
    const ctx = ctxOf(tasks).ctx;
    let tree = m.render({ context: ctx, api });
    assert.deepEqual(zoomBtn(tree), [false, true, false], "bawaan Minggu sebelum storage terbaca");
    assert.equal(nodes(tree, (n) => n.props.role === "radiogroup").length, 1);
    m.flush();
    await tick();
    assert.ok(calls.storageGet.indexOf("zoom:proj_Alpha") >= 0);
    tree = m.render({ context: ctx, api });
    assert.deepEqual(zoomBtn(tree), [true, false, false]);
    // header Hari: sel tanggal dengan nama hari
    assert.ok(byCls(tree, "plg-timeline-tick").some((n) => n.props["data-sub"] === "Rab" && txt(n).trim() === "4"));
    buttonByText(tree, "Bulan").props.onClick({});
    tree = m.render({ context: ctx, api });
    assert.deepEqual(zoomBtn(tree), [false, false, true]);
    await tick();
    assert.deepEqual(calls.storageSet.filter((s) => s[0].indexOf("zoom:") === 0), [["zoom:proj_Alpha", "month"]]);
  }
  {
    const { api, calls } = fakeApi({ storageGet: () => Promise.reject(new Error("rusak")) });
    const m = mount(T.TimelineViewBody);
    const ctx = ctxOf(tasks).ctx;
    m.render({ context: ctx, api });
    m.flush();
    await tick();
    await tick();
    const tree = m.render({ context: ctx, api });
    assert.deepEqual(zoomBtn(tree), [false, true, false]);
    assert.ok(calls.warn.length >= 1, "gagal baca dicatat api.log.warn");
  }
});

test("catatan tahun tanpa data persis", () => {
  const tasks = [mk(1, "Jauh", { start: "2028-03-01", duration: 2 })];
  const { api } = fakeApi();
  const tree = mount(T.TimelineViewBody).render({ context: ctxOf(tasks).ctx, api });
  const notes = byCls(tree, "plg-timeline-note").map((n) => txt(n).trim());
  assert.deepEqual(notes, ["Libur nasional 2028 belum ada di Alurik versi ini."]);
  const none = mount(T.TimelineViewBody).render({ context: ctxOf([mk(1, "A", { start: "2026-11-02", duration: 1 })]).ctx, api });
  assert.equal(byCls(none, "plg-timeline-note").length, 0);
});

test("legenda memuat delapan label persis", () => {
  const { api } = fakeApi();
  const tree = mount(T.TimelineViewBody).render({ context: ctxOf([mk(1, "A", { start: "2026-11-02", duration: 1 })]).ctx, api });
  const legend = byCls(tree, "plg-timeline-legend");
  assert.equal(legend.length, 1);
  assert.deepEqual(byCls(legend[0], "plg-timeline-legend-item").map((n) => txt(n).trim()), ["Task", "Selesai", "Lewat tenggat", "Ringkasan", "Milestone", "Tenggat", "Libur", "Dependensi"]);
});

test("keadaan kosong: 'Belum ada task di halaman ini' (task berulang/arsip tidak dihitung)", () => {
  const { api } = fakeApi();
  const tasks = [mk(1, "Ulang", {}, { recurrence_type: "daily" }), mk(2, "Arsip", {}, { gtd_status: "archived" })];
  const tree = mount(T.TimelineViewBody).render({ context: ctxOf(tasks).ctx, api });
  assert.ok(byCls(tree, "plg-timeline-empty").some((n) => txt(n).trim() === "Belum ada task di halaman ini"));
  assert.equal(nodes(tree, (n) => n.props.role === "grid").length, 0);
});

test("toolbar: segmented Hari/Minggu/Bulan, Hari ini, Kalender kerja, Urutkan menurut Mulai", () => {
  const { api } = fakeApi();
  const tree = mount(T.TimelineViewBody).render({ context: ctxOf([mk(1, "A", { start: "2026-11-02", duration: 1 })]).ctx, api });
  for (const l of ["Hari", "Minggu", "Bulan", "Hari ini", "Kalender kerja", "Urutkan menurut Mulai"]) assert.ok(buttonByText(tree, l), l);
  assert.equal(buttonByText(tree, "Urutkan menurut Mulai").props["aria-pressed"], false);
});

test("kalender: workspace memuat cal@list:<id>; arsir akhir pekan + libur dari kalender terkompilasi; lost → toast persis; sync → muat ulang", async () => {
  const fr = fakeRecords();
  // workspace 12: Sabtu hari kerja, cuti bersama OFF
  fr.store.set("calendar/cal@list:12", { entity: "calendar", id: "cal@list:12", scope: "list:12", pending: false, data: { v: 1, weekdays: [1, 2, 3, 4, 5, 6], national: true, cutiBersama: false, off: [], work: [] } });
  const { api, calls } = fakeApi({ records: fr });
  const tasks = [mk(1, "A", { start: "2026-11-02", duration: 3 }, { list_id: 12, project: "P", project_id: 5 })];
  const { ctx } = ctxOf(tasks, { page: "slist_12", pageKind: "workspace", listId: 12, projectName: null });
  const m = mount(T.TimelineViewBody);
  let tree = m.render({ context: ctx, api });
  const L = T.TLLayout;
  const readOf = (t) => T.TLSched.readSched(api.taskExt.read(t));
  const lay0 = L.layout({ tasks, pageKind: "workspace", cal: T.TLCal.DEFAULT_CAL, today: TODAY, zoom: "week", readSchedOf: readOf });
  const chart0 = byCls(tree, "plg-timeline-chart")[0];
  assert.equal(chart0.props.style.backgroundImage, L.weekendGradient(lay0.cal, lay0.range, lay0.px), "sebelum muat: kalender bawaan");
  m.flush();
  await tick();
  assert.deepEqual(fr.calls.get[0], ["calendar", "cal@list:12"]);
  tree = m.render({ context: ctx, api });
  const chart = byCls(tree, "plg-timeline-chart")[0];
  const lay = L.layout({ tasks, pageKind: "workspace", cal: { v: 1, weekdays: [1, 2, 3, 4, 5, 6], national: true, cutiBersama: false, off: [], work: [] }, today: TODAY, zoom: "week", readSchedOf: readOf });
  assert.equal(chart.props.style.backgroundImage, L.weekendGradient(lay.cal, lay.range, lay.px));
  assert.notEqual(chart.props.style.backgroundImage, chart0.props.style.backgroundImage, "Sabtu kerja → arsir berubah");
  // libur nasional 25 Des 2026 (Jumat) diarsir, berjudul nama libur
  const hol = byCls(tree, "plg-timeline-holiday").filter((n) => n.props["data-dn"] === T.TLCal.dn("2026-12-25"));
  assert.equal(hol.length, 1);
  assert.equal(hol[0].props.title, "Kelahiran Yesus Kristus");
  // lost untuk kalender aktif → toast persis + muat ulang; kalender lain → tanpa toast
  const getsBefore = fr.calls.get.length;
  fr.emit({ entity: "calendar", ids: ["cal@list:99"], source: "sync", lost: ["cal@list:99"] });
  assert.equal(calls.toast.length, 0);
  fr.emit({ entity: "calendar", ids: ["cal@list:12"], source: "sync", lost: ["cal@list:12"] });
  assert.deepEqual(calls.toast.map((t) => t[0]), ["Perubahan kalender di perangkat ini kalah oleh perubahan yang lebih baru"]);
  await tick();
  assert.ok(fr.calls.get.length > getsBefore, "sync → kalender dimuat ulang");
  m.unmount();
  assert.equal(fr.listenerCount(), 0, "unmount melepas pendengar onChange");
});

test("sumber: tanpa hex/rgb/hsl di plugin.jsx dan style.css; kelas hanya .plg-timeline-*; tanpa localStorage/innerHTML/fetch(/window.TF. selain plugins.register", () => {
  for (const [name, src] of [["plugin.jsx", jsx], ["style.css", css]]) {
    assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/, name + " tanpa hex");
    assert.doesNotMatch(src, /rgba?\(|hsla?\(/, name + " tanpa rgb/hsl tetap");
  }
  assert.doesNotMatch(jsx, /fetch\(|localStorage|sessionStorage|indexedDB|innerHTML|dangerouslySetInnerHTML|window\.TF\.(?!plugins\.register)/);
  // className literal di plugin.jsx: hanya plg-timeline-* dan pengubah is-*
  for (const m of jsx.matchAll(/className[=:]\s*"([^"]*)"/g)) {
    for (const c of m[1].split(/\s+/).filter(Boolean)) assert.match(c, /^(plg-timeline(-[\w-]+)?|is-[\w-]+)$/, c);
  }
  for (const t of ['"Hari"', '"Minggu"', '"Bulan"', '"Hari ini"', '"Kalender kerja"', '"Urutkan menurut Mulai"', '"Kolom"', '"Gantt"', '"Daftar"', '"Klik untuk menjadwalkan"', '"Mulai sebelum dependensi selesai"', '"Belum ada task di halaman ini"']) assert.ok(jsx.includes(t), t);
  // token tema yang dipakai R12
  for (const tok of ["var(--accent)", "var(--success)", "var(--text-secondary)", "var(--text-primary)", "var(--bg-subtle)"]) assert.ok(css.includes(tok), tok);
  // --danger belum didefinisikan app.css (host memakai var(--danger, <hex>)): plugin memakai token lokal dengan
  // cadangan token host --pomodoro (tanpa hex).
  assert.match(css, /--plg-timeline-danger:\s*var\(--danger, var\(--pomodoro\)\)/);
  assert.match(css, /color-mix\(in srgb, var\(--accent\) 55%, var\(--bg-card\)\)/);
  assert.match(css, /color-mix\(in srgb, var\(--plg-timeline-danger\) 8%, transparent\)/);
  assert.match(css, /position:\s*sticky/);
});

// ── Fix round 1: jalur gulir dengan elemen palsu (ref) + rAF sinkron (requestAnimationFrame tidak ada di Node → raf
// menjalankan callback langsung). window palsu agar useLayoutEffect mengukur wadah.
const TABLE_W_FULL = 56 + 220 + 92 + 56 + 52 + 56 + 56; // COLS_FULL (+ Slack 1c-1)

function fakeEl() {
  return { scrollTop: 0, scrollLeft: 0, clientWidth: TABLE_W_FULL + 1000, offsetHeight: 0, getBoundingClientRect: () => ({ top: 100 }) };
}
function withWindow(fn) {
  const prev = global.window;
  global.window = { innerHeight: 100 + 16 + 600 + 48, addEventListener() {}, removeEventListener() {} };
  return Promise.resolve().then(fn).finally(() => { global.window = prev; });
}
const gridOf = (tree) => nodes(tree, (n) => n.props.role === "grid")[0];
const renderedRowKeys = (tree) => nodes(tree, (n) => n.props.role === "row" && n.props["aria-rowindex"] > 1).map((n) => n.props["data-key"]);
const layOf = (tasks, zoom, api) => T.TLLayout.layout({ tasks, pageKind: "project", cal: T.TLCal.DEFAULT_CAL, today: TODAY, zoom, readSchedOf: (t) => T.TLSched.readSched(api.taskExt.read(t)) });

// Pasang elemen ke ref wadah (seperti React) lalu jalankan efek dan render ulang sampai stabil.
function attach(m, props, tree, el) {
  const g = gridOf(tree);
  if (g) g.props.ref.current = el;
  m.flush();
  return m.render(props);
}

// Task 13 (perf): panah memakai koordinat grafik absolut di dalam <g transform> — saat jendela baris bergeser hanya
// transform <g> (dan posisi svg) yang berubah; atribut `d` panah yang tetap tampak tidak ditulis ulang (tiap `d` baru =
// rekalkulasi gaya per path di Chromium).
test("gulir vertikal: d panah yang tetap tampak tidak berubah saat jendela baris bergeser; hanya transform <g> panah", () => withWindow(async () => {
  const tasks = bigTasks(300, 200);
  const { api } = fakeApi();
  const props = { context: ctxOf(tasks).ctx, api };
  const m = mount(T.TimelineViewBody);
  const el = fakeEl();
  let tree = attach(m, props, m.render(props), el);
  await tick();
  tree = attach(m, props, m.render(props), el);
  const snap = (t) => {
    const svg = nodes(t, (n) => n.type === "svg" && hasCls(n, "plg-timeline-arrows"))[0];
    const g = nodes(svg, (n) => n.type === "g")[0];
    const d = new Map(byCls(t, "plg-timeline-arrow").map((a) => [a.props.key, a.props.d]));
    return { g, d };
  };
  const onScroll = gridOf(tree).props.onScroll;
  el.scrollTop = 32 * 64; onScroll();
  tree = m.render(props);
  const s1 = snap(tree);
  el.scrollTop = 32 * 72; onScroll(); // kuantum jendela berikutnya (ROW_STEP 8)
  tree = m.render(props);
  const s2 = snap(tree);
  assert.ok(s1.g && s2.g, "panah dibungkus <g>");
  const common = [...s1.d.keys()].filter((k) => s2.d.has(k));
  assert.ok(common.length >= 3, "panah yang tetap tampak: " + common.length);
  for (const k of common) assert.equal(s2.d.get(k), s1.d.get(k), "d panah " + k + " tidak berubah");
  assert.notEqual(s2.g.props.transform, s1.g.props.transform, "transform <g> mengikuti jendela");
  m.unmount();
}));

test("gulir: pertama dibuka → hari ini di 1/3 lebar grafik; setState hanya saat kuantum baris (8) / kolom pertama berubah", () => withWindow(async () => {
  const tasks = bigTasks(300, 0);
  const { api } = fakeApi();
  const props = { context: ctxOf(tasks).ctx, api };
  const m = mount(T.TimelineViewBody);
  const el = fakeEl();
  let tree = attach(m, props, m.render(props), el);
  await tick();
  tree = attach(m, props, m.render(props), el);
  const lay = layOf(tasks, "week", api);
  const todayX = T.TLLayout.xOf(T.TLCal.dn(TODAY), lay.range, lay.px);
  assert.ok(Math.abs(el.scrollLeft + 1000 / 3 - todayX) <= 1, "hari ini di 1/3: scrollLeft " + el.scrollLeft + ", x hari ini " + todayX);
  const onScroll = gridOf(tree).props.onScroll;
  const n0 = m.setCalls.length;
  el.scrollTop = 5; onScroll(); // masih baris 0
  el.scrollTop = 31; onScroll();
  el.scrollTop = 33; onScroll(); // baris 1: masih kuantum 0 (Task 13: jendela per 8 baris)
  el.scrollTop = 32 * 8 - 1; onScroll();
  assert.equal(m.setCalls.length, n0, "gulir dalam kuantum 8 baris yang sama → tanpa setState");
  el.scrollTop = 32 * 8 + 1; onScroll(); // kuantum 0 → 1
  assert.equal(m.setCalls.length, n0 + 1);
  el.scrollTop = 32 * 9; onScroll();
  assert.equal(m.setCalls.length, n0 + 1);
  const left0 = el.scrollLeft;
  el.scrollLeft = left0 + 3; onScroll(); // jangkar kolom (½ layar) belum berubah… kecuali melewati batas kuantum
  const q = 500;
  const sameQuant = Math.floor((left0 + 3) / q) === Math.floor(left0 / q);
  assert.equal(m.setCalls.length, n0 + 1 + (sameQuant ? 0 : 1));
  const n1 = m.setCalls.length;
  el.scrollLeft = left0 + 3 + q; onScroll(); // pindah satu kuantum kolom
  assert.equal(m.setCalls.length, n1 + 1);
  tree = m.render(props);
  const firstKey = lay.rows[0].key;
  assert.equal(renderedRowKeys(tree)[0], firstKey, "baris pertama (first − 10 dijepit ke 0) masih dirender");
  el.scrollTop = 32 * 100; onScroll();
  tree = m.render(props);
  assert.ok(renderedRowKeys(tree).indexOf(firstKey) < 0, "setelah gulir jauh, baris awal tidak dirender");
  assert.equal(renderedRowKeys(tree)[0], lay.rows[86].key, "jendela mulai di kuantum baris 96 (100 dibulatkan ke bawah per 8) − 10");
  const keys = renderedRowKeys(tree);
  const lastIdx = lay.rows.findIndex((r) => r.key === keys[keys.length - 1]);
  assert.ok(lastIdx >= Math.ceil((32 * 100 + 600) / 32) - 1, "jendela tetap menutup layar sampai baris terbawah tampak: " + lastIdx);
  m.unmount();
}));

test("zoom mempertahankan tanggal di tengah layar", () => withWindow(async () => {
  const tasks = bigTasks(60, 0).concat([mk(900, "Jauh", { start: "2027-12-01", duration: 5 })]); // rentang lebar → Bulan tidak terjepit di tepi
  const { api } = fakeApi();
  const props = { context: ctxOf(tasks).ctx, api };
  const m = mount(T.TimelineViewBody);
  const el = fakeEl();
  let tree = attach(m, props, m.render(props), el);
  await tick();
  tree = attach(m, props, m.render(props), el);
  const lw = layOf(tasks, "week", api);
  el.scrollLeft = 3000; // gulir pengguna
  gridOf(tree).props.onScroll();
  tree = m.render(props);
  const center = T.TLLayout.dnAt(3000 + 500, lw.range, lw.px);
  buttonByText(tree, "Hari").props.onClick({});
  tree = attach(m, props, m.render(props), el);
  const ld = layOf(tasks, "day", api);
  assert.equal(T.TLLayout.dnAt(el.scrollLeft + 500, ld.range, ld.px), center, "tanggal tengah tetap setelah Minggu → Hari");
  buttonByText(tree, "Bulan").props.onClick({});
  tree = attach(m, props, m.render(props), el);
  const lm = layOf(tasks, "month", api);
  assert.equal(T.TLLayout.dnAt(el.scrollLeft + 500, lm.range, lm.px), center, "tanggal tengah tetap setelah Hari → Bulan");
  m.unmount();
}));

test("wadah gulir dipasang ulang (kosong → ada task) → jendela direset: baris 1 dirender, hari ini di 1/3", () => withWindow(async () => {
  const tasks = bigTasks(300, 0);
  const { api } = fakeApi();
  const ctx = ctxOf(tasks).ctx;
  const props = { context: ctx, api };
  const m = mount(T.TimelineViewBody);
  const el1 = fakeEl();
  let tree = attach(m, props, m.render(props), el1);
  await tick();
  tree = attach(m, props, m.render(props), el1);
  const ref = gridOf(tree).props.ref;
  // pengguna menggulir jauh ke bawah dan ke kanan
  el1.scrollTop = 32 * 200;
  el1.scrollLeft += 2000;
  gridOf(tree).props.onScroll();
  tree = m.render(props);
  assert.ok(renderedRowKeys(tree).indexOf(layOf(tasks, "week", api).rows[0].key) < 0);
  // pencarian host tanpa hasil → keadaan kosong (wadah dilepas: ref null)
  const emptyProps = { context: Object.assign({}, ctx, { scopeTasks: [] }), api };
  tree = m.render(emptyProps);
  assert.equal(gridOf(tree), undefined);
  ref.current = null;
  m.flush();
  // pencarian dihapus → wadah baru (scrollTop/Left 0, tanpa event scroll)
  const el2 = fakeEl();
  tree = m.render(props);
  tree = attach(m, props, tree, el2);
  const lay0 = layOf(tasks, "week", api);
  assert.equal(renderedRowKeys(tree)[0], lay0.rows[0].key, "baris pertama dirender lagi");
  assert.equal(el2.scrollTop, 0);
  const lay = layOf(tasks, "week", api);
  const todayX = T.TLLayout.xOf(T.TLCal.dn(TODAY), lay.range, lay.px);
  assert.ok(Math.abs(el2.scrollLeft + 1000 / 3 - todayX) <= 1, "wadah baru: hari ini di 1/3 lagi");
  const ticks = byCls(tree, "plg-timeline-tick");
  assert.ok(ticks.length > 0, "header skala ada");
  // sel header mencakup kolom yang terlihat di wadah baru
  const dnLeft = T.TLLayout.dnAt(el2.scrollLeft, lay.range, lay.px);
  assert.ok(ticks.some((t) => t.props.style.left <= T.TLLayout.xOf(dnLeft, lay.range, lay.px) && t.props.style.left + t.props.style.width > T.TLLayout.xOf(dnLeft, lay.range, lay.px)));
  m.unmount();
}));

test("CSS: tanpa aturan ringkasan is-late yang tidak berpengaruh (border pada elemen tanpa border)", () => {
  assert.doesNotMatch(css, /\.plg-timeline-summary\.is-late,\s*\n?\s*\.plg-timeline-summary\.is-late::before/);
});

// ════════════════════════════════════════════════════════════════════════════
// Task 8 — interaksi: seret (geser/durasi/dependensi), klik-jadwalkan, keyboard, Urungkan (R13–R15, R21, R23).
// window palsu mencatat pendengar (pointermove/up/cancel, keydown Esc) agar peristiwa bisa ditembakkan; elemen bar
// palsu = currentTarget (transform ditulis lewat style, tanpa setState); grafik palsu memberi koordinat klien.
// ════════════════════════════════════════════════════════════════════════════
const HEAD = 48;
const SCROLL_TOP = 100;
const capOf = (o) => (typeof o === "boolean" ? o : !!(o && o.capture));
const GESTURE = ["pointermove", "pointerup", "pointercancel", "keydown", "blur", "touchmove", "contextmenu"];

function fakeWin() {
  const ls = [];
  return {
    innerHeight: SCROLL_TOP + 16 + 600 + HEAD,
    ls,
    addEventListener(type, fn, opt) { ls.push({ type, fn, cap: capOf(opt) }); },
    removeEventListener(type, fn, opt) {
      const i = ls.findIndex((l) => l.type === type && l.fn === fn && l.cap === capOf(opt));
      if (i >= 0) ls.splice(i, 1);
    },
    fire(type, ev) { for (const l of ls.filter((x) => x.type === type)) l.fn(ev); },
    gesture() { return ls.filter((l) => GESTURE.indexOf(l.type) >= 0).length; },
  };
}
function withIx(fn) {
  const prev = global.window;
  const w = fakeWin();
  global.window = w;
  return Promise.resolve().then(() => fn(w)).finally(() => { global.window = prev; });
}
const pev = (x, y, o) => Object.assign({ clientX: x, clientY: y, pointerType: "mouse", button: 0, pointerId: 1, preventDefault() {}, stopPropagation() {} }, o || {});
// Seperti peramban: style.transform dinormalisasi saat dibaca ("translate(1px,2px)" → "translate(1px, 2px)").
function fakeNode() {
  const cls = new Set();
  const attrs = {};
  let tf;
  const style = {};
  Object.defineProperty(style, "transform", { get: () => tf, set: (v) => { tf = String(v).replace(/,\s*/g, ", "); }, enumerable: true });
  return { style, textContent: "", classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) }, setAttribute: (k, v) => { attrs[k] = v; }, attrs };
}

// Elemen dengan addEventListener/removeEventListener tercatat (opsi passive disimpan).
function fakeListenerEl(base) {
  const ls = [];
  return Object.assign(base || {}, {
    ls,
    addEventListener(type, fn, opt) { ls.push({ type, fn, cap: capOf(opt), passive: opt && typeof opt === "object" ? opt.passive : undefined }); },
    removeEventListener(type, fn, opt) {
      const i = ls.findIndex((l) => l.type === type && l.fn === fn && l.cap === capOf(opt));
      if (i >= 0) ls.splice(i, 1);
    },
    fire(type, ev) { for (const l of ls.filter((x) => x.type === type)) l.fn(ev); },
  });
}

// Pemasangan lengkap: wadah gulir + grafik + tooltip/garis karet palsu; o.set / o.setMany mengganti hasil tulis.
async function ixSetup(tasks, o) {
  const opts = o || {};
  const { api, calls } = fakeApi(opts.records ? { records: opts.records } : undefined);
  calls.set = [];
  calls.setMany = [];
  api.taskExt.set = (id, p) => { calls.set.push([id, p]); return opts.set ? opts.set(id, p) : Promise.resolve(); };
  api.taskExt.setMany = (items) => { calls.setMany.push(items); return opts.setMany ? opts.setMany(items) : Promise.resolve(); };
  // Daftar task LENGKAP (api.data.tasks.list) — bawaan = task yang dirender; o.all = daftar tanpa filter panel host.
  calls.list = [];
  api.data = { tasks: { list: (q) => { calls.list.push(q); return opts.listImpl ? opts.listImpl(q) : Promise.resolve(opts.all || tasks); } } };
  const { ctx, clicked } = ctxOf(tasks);
  const props = { context: ctx, api };
  const m = mount(T.TimelineViewBody);
  const el = {
    scrollTop: 0, scrollLeft: 0, clientWidth: TABLE_W_FULL + 1000, offsetHeight: 0,
    getBoundingClientRect: () => ({ left: 0, top: SCROLL_TOP, right: TABLE_W_FULL + 1000, bottom: SCROLL_TOP + HEAD + 600 }),
  };
  const chartEl = fakeListenerEl({ getBoundingClientRect: () => ({ left: TABLE_W_FULL - el.scrollLeft, top: SCROLL_TOP + HEAD - el.scrollTop }) });
  const tip = fakeNode();
  const rubber = fakeNode();
  const line = fakeNode();
  const wire = (tree) => {
    const g = gridOf(tree);
    if (g) g.props.ref.current = el;
    const ch = byCls(tree, "plg-timeline-chart")[0];
    if (ch && typeof ch.props.ref === "function") ch.props.ref(chartEl);
    else if (ch && ch.props.ref) ch.props.ref.current = chartEl;
    const tp = byCls(tree, "plg-timeline-tip")[0];
    if (tp && tp.props.ref) tp.props.ref.current = tip;
    const rb = byCls(tree, "plg-timeline-rubber")[0];
    if (rb && rb.props.ref) rb.props.ref.current = rubber;
    const ln = byCls(tree, "plg-timeline-rubber-line")[0];
    if (ln && ln.props.ref) ln.props.ref.current = line;
  };
  let tree = m.render(props);
  wire(tree);
  m.flush();
  if (opts.clock) {
    // 1c-1 Task 9: jam mesin palsu (withEngineClock) — useUnits/useEngine selesai; opts.noEngine = raf tidak dijalankan
    // (mesin tetap "loading").
    for (let i = 0; i < 4; i++) {
      await settle();
      if (!opts.noEngine) opts.clock.frames();
      opts.clock.tick(300);
      await settle();
      tree = m.render(props);
      wire(tree);
      m.flush();
    }
  } else {
    await tick();
    tree = m.render(props);
    wire(tree);
    m.flush();
  }
  tree = m.render(props);
  const lay = layOf(tasks, "week", api);
  const row = (k) => lay.rows.find((r) => r.key === k);
  const h = {
    m, api, calls, clicked, el, chartEl, tip, rubber, line, lay, props, wire,
    get tree() { return tree; },
    rerender() { tree = m.render(props); return tree; },
    row,
    box: (k) => { const r = row(k); return T.TLLayout.barBox(r.span, r.sched, lay.range, lay.px, r.kind); },
    cx: (x) => x + TABLE_W_FULL - el.scrollLeft,
    cy: (y) => y + SCROLL_TOP + HEAD - el.scrollTop,
    midY: (k) => row(k).index * 32 + 16,
    bar: (k) => nodes(tree, (n) => n.props["data-key"] === k && (hasCls(n, "plg-timeline-bar") || hasCls(n, "plg-timeline-milestone") || hasCls(n, "plg-timeline-summary")))[0],
    slot: (k) => byCls(tree, "plg-timeline-slot").find((n) => n.props["data-key"] === k),
    tableRow: (k) => rowOf(tree, k),
    xOfIso: (iso) => T.TLLayout.xOf(T.TLCal.dn(iso), lay.range, lay.px),
  };
  return h;
}

test("seret selesai → tepat satu api.taskExt.set {start}; toast 'Jadwal diubah' dengan action 'Urungkan' → setMany [{taskId, patch: prev}]; selama gerak tidak ada setState", () => withIx(async (w) => {
  const tasks = [mk(1, "A", { start: "2026-11-02", duration: 3 }), mk(2, "B", { start: "2026-11-02" })];
  const h = await ixSetup(tasks);
  const b1 = h.box("1");
  const y = h.cy(h.midY("1"));
  const x0 = h.cx(b1.x + 10);
  const barEl = fakeNode();
  const n0 = h.m.setCalls.length;
  h.bar("1").props.onPointerDown(pev(x0, y, { currentTarget: barEl }));
  assert.ok(w.gesture() >= 4, "pendengar seret dipasang");
  w.fire("pointermove", pev(x0 + 2, y));
  assert.equal(barEl.style.transform, undefined, "di bawah ambang 4 px belum menyeret");
  w.fire("pointermove", pev(x0 + 30, y));
  w.fire("pointermove", pev(x0 + 84, y)); // +7 hari × 12 px → Sen 9 Nov
  const top = h.row("1").index * 32 + 8;
  assert.equal(barEl.style.transform, "translate(" + (b1.x + 84) + "px, " + top + "px)");
  assert.equal(h.tip.textContent, "Sen 9 Nov → Rab 11 Nov · 3 hk");
  assert.notEqual(h.tip.style.display, "none");
  w.fire("pointerup", pev(x0 + 84, y));
  assert.equal(h.m.setCalls.length, n0, "tanpa setState antara pointerdown dan pointerup");
  assert.equal(w.gesture(), 0, "pendengar dilepas setelah lepas");
  assert.equal(h.tip.style.display, "none");
  h.bar("1").props.onClick({}); // klik sesudah seret tidak membuka task
  assert.deepEqual(h.clicked, []);
  await tick(); // tulis setelah pemeriksaan daftar lengkap (final review #1)
  assert.deepEqual(h.calls.set, [[1, { start: "2026-11-09" }]]);
  const t = h.calls.toast[h.calls.toast.length - 1];
  assert.equal(t[0], "Jadwal diubah");
  assert.equal(t[2].label, "Urungkan");
  assert.equal(h.calls.setMany.length, 0);
  t[2].onClick();
  await tick();
  assert.deepEqual(h.calls.setMany, [[{ taskId: 1, patch: { start: "2026-11-02" } }]]);
  assert.equal(h.calls.set.length, 1, "Urungkan lewat setMany, bukan set");
  // klik biasa (tanpa gerak) tetap membuka task
  h.bar("1").props.onPointerDown(pev(x0, y, { currentTarget: fakeNode() }));
  w.fire("pointerup", pev(x0, y));
  h.bar("1").props.onClick({});
  assert.deepEqual(h.clicked.map((x) => x.id), [1]);
  assert.equal(h.calls.set.length, 1);
  // ubah durasi lewat tepi kanan pada task tanpa kunci duration → Urungkan menulis duration: null (kunci tidak ada)
  const b2 = h.box("2");
  const y2 = h.cy(h.midY("2"));
  const xe = h.cx(b2.x + b2.w - 2);
  const bar2El = fakeNode();
  h.bar("2").props.onPointerDown(pev(xe, y2, { currentTarget: bar2El }));
  w.fire("pointermove", pev(xe + 24, y2));
  assert.equal(bar2El.style.width, (3 * 12) + "px");
  assert.equal(h.tip.textContent, "Sen 2 Nov → Rab 4 Nov · 3 hk");
  w.fire("pointerup", pev(xe + 24, y2));
  await tick();
  assert.deepEqual(h.calls.set[1], [2, { duration: 3 }]);
  h.calls.toast[h.calls.toast.length - 1][2].onClick();
  await tick();
  assert.deepEqual(h.calls.setMany[1], [{ taskId: 2, patch: { duration: null } }]);
  h.m.unmount();
}));

test("Esc saat seret → tanpa set; listener keydown dilepas; lepas di luar grafik → tanpa set", () => withIx(async (w) => {
  const tasks = [mk(1, "A", { start: "2026-11-02", duration: 3 })];
  const h = await ixSetup(tasks);
  const b1 = h.box("1");
  const y = h.cy(h.midY("1"));
  const x0 = h.cx(b1.x + 10);
  const barEl = fakeNode();
  const base = "translate(" + b1.x + "px, " + (h.row("1").index * 32 + 8) + "px)";
  h.bar("1").props.onPointerDown(pev(x0, y, { currentTarget: barEl }));
  w.fire("pointermove", pev(x0 + 60, y));
  assert.notEqual(barEl.style.transform, base);
  assert.equal(w.ls.filter((l) => l.type === "keydown").length, 1);
  let stopped = false;
  w.fire("keydown", { key: "Escape", preventDefault() {}, stopPropagation() { stopped = true; } });
  assert.ok(stopped, "Esc tidak diteruskan ke host (mis. menutup Live Edit)");
  assert.equal(w.ls.filter((l) => l.type === "keydown").length, 0, "keydown dilepas");
  assert.equal(w.gesture(), 0);
  assert.equal(barEl.style.transform, base, "bar kembali ke posisi semula");
  w.fire("pointerup", pev(x0 + 60, y));
  await tick();
  assert.deepEqual(h.calls.set, []);
  assert.equal(h.calls.toast.length, 0);
  // lepas di luar grafik (di bawah wadah) = batal
  h.bar("1").props.onPointerDown(pev(x0, y, { currentTarget: barEl }));
  w.fire("pointermove", pev(x0 + 60, y));
  w.fire("pointerup", pev(x0 + 60, SCROLL_TOP + HEAD + 600 + 40));
  // pointercancel = batal
  h.bar("1").props.onPointerDown(pev(x0, y, { currentTarget: barEl }));
  w.fire("pointermove", pev(x0 + 60, y));
  w.fire("pointercancel", pev(x0 + 60, y));
  w.fire("pointerup", pev(x0 + 60, y));
  // sentuh bergerak > 8 px sebelum 350 ms = gulir, bukan seret
  h.bar("1").props.onPointerDown(pev(x0, y, { currentTarget: barEl, pointerType: "touch" }));
  w.fire("pointermove", pev(x0 + 40, y + 2, { pointerType: "touch" }));
  assert.equal(w.gesture(), 0, "gulir sentuh: pendengar dilepas, peramban menggulir");
  w.fire("pointerup", pev(x0 + 40, y + 2, { pointerType: "touch" }));
  await tick();
  assert.deepEqual(h.calls.set, []);
  assert.equal(barEl.style.transform, base);
  h.m.unmount();
}));

test("link ke bar lain → set penerus {deps: [...lama, {t: ref(pred), type: 'FS', lag: 0}]}; siklus → toast persis, tanpa set; ke ringkasan → toast persis", () => withIx(async (w) => {
  const old = { t: { $task: 3 }, type: "FS", lag: 1 };
  const many = [];
  for (let i = 0; i < 20; i++) many.push({ t: { $task: 500 + i }, type: "FS", lag: 0 });
  const tasks = [
    mk(1, "A", { start: "2026-11-02", duration: 2 }),
    mk(2, "B", { start: "2026-11-09", duration: 2, deps: [old] }),
    mk(3, "C", { start: "2026-11-02", duration: 1 }),
    mk(10, "Induk", {}),
    mk(11, "Anak", { start: "2026-11-03", duration: 1 }, { parent_id: 10 }),
    mk(12, "Penuh", { start: "2026-11-12", duration: 1, deps: many }),
  ];
  const h = await ixSetup(tasks);
  const linkDrag = (from, to) => {
    const b = h.box(from);
    const x = h.cx(b.x + b.w + 5); // titik di kanan ujung bar
    const y = h.cy(h.midY(from));
    h.bar(from).props.onPointerDown(pev(x, y, { currentTarget: fakeNode() }));
    w.fire("pointermove", pev(x + 20, h.cy(h.midY(to))));
    w.fire("pointermove", pev(x + 40, h.cy(h.midY(to))));
    w.fire("pointerup", pev(x + 40, h.cy(h.midY(to))));
  };
  const n0 = h.m.setCalls.length;
  linkDrag("1", "2");
  assert.equal(h.m.setCalls.length, n0);
  assert.equal(h.rubber.style.display, "none", "garis karet disembunyikan setelah lepas");
  await tick(); // tulis setelah checkLink atas daftar lengkap (final review #1)
  assert.deepEqual(h.calls.set, [[2, { deps: [old, { t: { $task: 1 }, type: "FS", lag: 0 }] }]]);
  const t = h.calls.toast[h.calls.toast.length - 1];
  assert.equal(t[0], "Jadwal diubah");
  t[2].onClick();
  await tick();
  assert.deepEqual(h.calls.setMany, [[{ taskId: 2, patch: { deps: [old] } }]]);
  // siklus: C → B sudah ada (B bergantung pada C); B → C membuat lingkaran
  h.calls.toast.length = 0;
  linkDrag("2", "3");
  await tick();
  assert.deepEqual(h.calls.toast, [["Dependensi ini membuat lingkaran", "error"]]);
  // ke ringkasan
  h.calls.toast.length = 0;
  linkDrag("1", "10");
  await tick();
  assert.deepEqual(h.calls.toast, [["Ringkasan tidak bisa diberi dependensi di versi ini", "error"]]);
  // 20 dependensi
  h.calls.toast.length = 0;
  linkDrag("1", "12");
  await tick();
  assert.deepEqual(h.calls.toast, [["Maksimal 20 dependensi per task", "error"]]);
  // ke diri sendiri / sudah ada → tanpa tulis
  linkDrag("1", "1");
  linkDrag("3", "2");
  await tick();
  assert.equal(h.calls.set.length, 1, "hanya dependensi sah yang ditulis");
  assert.equal(w.gesture(), 0);
  h.m.unmount();
}));

test("klik area kosong baris tanpa jadwal di tanggal Sabtu → set {start: Senin, duration: 1}; Urungkan → null", () => withIx(async (w) => {
  const tasks = [mk(1, "A", { start: "2026-11-02", duration: 1 }), mk(4, "Belum", {})];
  const h = await ixSetup(tasks);
  const slot = h.slot("4");
  assert.equal(typeof slot.props.onPointerDown, "function");
  const x = h.cx(h.xOfIso("2026-11-07") + 5); // Sabtu
  const y = h.cy(h.midY("4"));
  // gerak lebih dari ambang = bukan klik
  slot.props.onPointerDown(pev(x, y));
  w.fire("pointerup", pev(x + 30, y));
  await tick();
  assert.deepEqual(h.calls.set, []);
  slot.props.onPointerDown(pev(x, y));
  w.fire("pointerup", pev(x + 1, y));
  assert.equal(w.gesture(), 0);
  await tick();
  assert.deepEqual(h.calls.set, [[4, { start: "2026-11-09", duration: 1 }]]);
  const t = h.calls.toast[h.calls.toast.length - 1];
  assert.equal(t[0], "Jadwal diubah");
  t[2].onClick();
  await tick();
  assert.deepEqual(h.calls.setMany, [[{ taskId: 4, patch: { start: null, duration: null } }]]);
  // sentuh: satu ketukan tidak menjadwalkan, ketuk ganda menjadwalkan
  const tasks2 = [mk(5, "Sentuh", {})];
  const h2 = await ixSetup(tasks2);
  const s2 = h2.slot("5");
  const x2 = h2.cx(h2.xOfIso("2026-11-10") + 5);
  const y2 = h2.cy(h2.midY("5"));
  const touch = { pointerType: "touch" };
  s2.props.onPointerDown(pev(x2, y2, touch));
  w.fire("pointerup", pev(x2, y2, touch));
  await tick();
  assert.deepEqual(h2.calls.set, []);
  s2.props.onPointerDown(pev(x2, y2, touch));
  w.fire("pointerup", pev(x2, y2, touch));
  await tick();
  assert.deepEqual(h2.calls.set, [[5, { start: "2026-11-10", duration: 1 }]]);
  h.m.unmount();
  h2.m.unmount();
}));

test("Alt+→ pada baris fokus → set {start: hari kerja berikutnya}; tahan tombol tidak menulis dari props basi; Alt+Shift+← durasi", () => withIx(async () => {
  const tasks = [mk(1, "K", { start: "2026-11-06", duration: 2 })]; // Jumat
  let release = null;
  const h = await ixSetup(tasks, { set: () => new Promise((r) => { release = r; }) });
  let prevented = 0;
  const kev = (key, o) => Object.assign({ key, altKey: true, shiftKey: false, preventDefault() { prevented++; } }, o || {});
  h.tableRow("1").props.onKeyDown(kev("ArrowRight"));
  assert.equal(prevented, 1, "Alt+← / Alt+→ tidak menjadi navigasi peramban");
  // tombol ditahan (repeat) selama pemeriksaan daftar lengkap (final review #1) → sudah sibuk, diabaikan
  h.bar("1").props.onKeyDown(kev("ArrowRight", { repeat: true }));
  await tick();
  assert.deepEqual(h.calls.set, [[1, { start: "2026-11-09" }]]);
  // tombol ditahan (repeat) saat tulis masih berjalan → diabaikan
  h.bar("1").props.onKeyDown(kev("ArrowRight", { repeat: true }));
  assert.equal(h.calls.set.length, 1);
  release();
  await tick();
  // props belum mengikuti (task di context masih Jumat) → dihitung dari nilai optimistis Senin
  h.bar("1").props.onKeyDown(kev("ArrowRight", { repeat: true }));
  await tick();
  assert.deepEqual(h.calls.set[1], [1, { start: "2026-11-10" }]);
  release();
  await tick();
  const t = h.calls.toast[h.calls.toast.length - 1];
  t[2].onClick();
  await tick();
  assert.deepEqual(h.calls.setMany[0], [{ taskId: 1, patch: { start: "2026-11-09" } }], "Urungkan = nilai sebelum tekan ini");
  h.bar("1").props.onKeyDown(kev("ArrowLeft", { shiftKey: true }));
  await tick();
  assert.deepEqual(h.calls.set[2], [1, { duration: 1 }]);
  release();
  await tick();
  // tanpa Alt → tidak ada tulis; Enter tetap membuka task
  h.bar("1").props.onKeyDown({ key: "ArrowRight", altKey: false, preventDefault() {} });
  h.bar("1").props.onKeyDown({ key: "Enter", preventDefault() {} });
  assert.equal(h.calls.set.length, 3);
  assert.deepEqual(h.clicked.map((x) => x.id), [1]);
  h.m.unmount();
}));

test("set reject → toast 'Jadwal gagal disimpan' (type error); bar kembali; Urungkan gagal tidak melempar", () => withIx(async (w) => {
  const tasks = [mk(1, "A", { start: "2026-11-02", duration: 3 })];
  let fail = true;
  const h = await ixSetup(tasks, {
    set: () => (fail ? Promise.reject(new Error("offline")) : Promise.resolve()),
    setMany: () => Promise.reject(new Error("ditolak")),
  });
  const b1 = h.box("1");
  const y = h.cy(h.midY("1"));
  const x0 = h.cx(b1.x + 10);
  const barEl = fakeNode();
  const base = "translate(" + b1.x + "px, " + (h.row("1").index * 32 + 8) + "px)";
  h.bar("1").props.onPointerDown(pev(x0, y, { currentTarget: barEl }));
  w.fire("pointermove", pev(x0 + 84, y));
  w.fire("pointerup", pev(x0 + 84, y));
  await tick();
  assert.equal(h.calls.set.length, 1);
  await tick();
  assert.deepEqual(h.calls.toast, [["Jadwal gagal disimpan", "error"]]);
  assert.equal(barEl.style.transform, base);
  // Urungkan yang gagal: penolakan ditangani di handler (tanpa unhandled rejection)
  fail = false;
  h.bar("1").props.onPointerDown(pev(x0, y, { currentTarget: barEl }));
  w.fire("pointermove", pev(x0 + 84, y));
  w.fire("pointerup", pev(x0 + 84, y));
  await tick();
  const t = h.calls.toast[h.calls.toast.length - 1];
  assert.equal(t[0], "Jadwal diubah");
  assert.doesNotThrow(() => t[2].onClick());
  await tick();
  await tick();
  assert.deepEqual(h.calls.toast[h.calls.toast.length - 1], ["Jadwal gagal disimpan", "error"]);
  h.m.unmount();
}));

test("bar tugas punya pegangan tepi + titik dependensi (aria-hidden); ringkasan tanpa; sumber memuat teks persis", () => withIx(async () => {
  const tasks = [mk(1, "A", { start: "2026-11-02", duration: 2 }), mk(2, "M", { start: "2026-11-04", duration: 0 }), mk(10, "Induk", {}), mk(11, "Anak", { start: "2026-11-03", duration: 1 }, { parent_id: 10 })];
  const h = await ixSetup(tasks);
  const kids = (n, c) => byCls(n, c).length;
  assert.equal(kids(h.bar("1"), "plg-timeline-edge"), 1);
  assert.equal(kids(h.bar("1"), "plg-timeline-dot"), 1);
  assert.equal(kids(h.bar("2"), "plg-timeline-edge"), 0, "milestone tanpa ubah durasi");
  assert.equal(kids(h.bar("2"), "plg-timeline-dot"), 1);
  assert.equal(kids(h.bar("10"), "plg-timeline-dot"), 0);
  assert.equal(h.bar("10").props.onPointerDown, undefined, "ringkasan tidak bisa diseret");
  for (const t of ['"Jadwal diubah"', '"Urungkan"', '"Jadwal gagal disimpan"', '"Dependensi ini membuat lingkaran"', '"Maksimal 20 dependensi per task"', '"Ringkasan tidak bisa diberi dependensi di versi ini"']) assert.ok(jsx.includes(t), t);
  h.m.unmount();
}));

// ── Fix round 1 (review Task 8) ─────────────────────────────────────────────
test("sentuh: SATU pendengar touchmove non-pasif tetap di elemen grafik; preventDefault hanya saat tekan lama/seret; dilepas saat elemen berganti/unmount", () => withIx(async (w) => {
  const tasks = [mk(1, "A", { start: "2026-11-02", duration: 3 })];
  const h = await ixSetup(tasks);
  const tm = () => h.chartEl.ls.filter((l) => l.type === "touchmove");
  assert.equal(tm().length, 1, "dipasang saat elemen grafik dipasang");
  assert.equal(tm()[0].passive, false, "non-pasif agar preventDefault berlaku");
  h.rerender();
  h.wire(h.tree);
  assert.equal(tm().length, 1, "render ulang tidak memasang ganda");
  let prevented = 0;
  const tev = () => ({ cancelable: true, preventDefault() { prevented++; } });
  h.chartEl.fire("touchmove", tev());
  assert.equal(prevented, 0, "tanpa gestur: peramban bebas menggulir");
  const b1 = h.box("1");
  const y = h.cy(h.midY("1"));
  const x0 = h.cx(b1.x + 10);
  const barEl = fakeNode();
  const touch = { pointerType: "touch" };
  const realNow = performance.now.bind(performance);
  let fakeT = realNow();
  performance.now = () => fakeT;
  try {
    h.bar("1").props.onPointerDown(pev(x0, y, Object.assign({ currentTarget: barEl }, touch)));
    h.chartEl.fire("touchmove", tev());
    assert.equal(prevented, 0, "sebelum 350 ms belum dicegah");
    fakeT += 400; // tekan lama (gerak setelah 350 ms mempersenjatai walau timer hold belum jalan)
    w.fire("pointermove", pev(x0 + 1, y, touch));
    h.chartEl.fire("touchmove", tev());
    assert.equal(prevented, 1, "tekan lama → gerak jari menyeret, bukan menggulir");
    w.fire("pointermove", pev(x0 + 84, y, touch));
    h.chartEl.fire("touchmove", tev());
    assert.equal(prevented, 2);
    assert.equal(w.ls.filter((l) => l.type === "touchmove").length, 0, "tidak ada pendengar touchmove di window (terlambat untuk peramban)");
    w.fire("pointerup", pev(x0 + 84, y, touch));
  } finally {
    performance.now = realNow;
  }
  await tick();
  assert.deepEqual(h.calls.set, [[1, { start: "2026-11-09" }]]);
  h.chartEl.fire("touchmove", tev());
  assert.equal(prevented, 2, "setelah lepas tidak lagi dicegah");
  // elemen grafik diganti (mis. keadaan kosong → ada task): pendengar pindah
  const grid = gridOf(h.tree);
  const ch = byCls(h.tree, "plg-timeline-chart")[0];
  assert.equal(typeof ch.props.ref, "function", "callback ref");
  const other = fakeListenerEl({ getBoundingClientRect: () => ({ left: 0, top: 0 }) });
  ch.props.ref(null);
  assert.equal(tm().length, 0, "dilepas saat elemen dilepas");
  ch.props.ref(other);
  assert.equal(other.ls.filter((l) => l.type === "touchmove").length, 1);
  assert.ok(grid);
  h.m.unmount();
  assert.equal(other.ls.filter((l) => l.type === "touchmove").length, 0, "dilepas saat unmount");
}));

test("CSS: bar tanpa callout/seleksi sentuh; area kosong touch-action manipulation", () => {
  const rule = (sel) => { const m = css.match(new RegExp(sel.replace(/[.]/g, "\\.") + "\\s*\\{([^}]*)\\}")); return m ? m[1] : ""; };
  const bars = css.match(/\.plg-timeline-bar,\s*\.plg-timeline-summary,\s*\.plg-timeline-milestone\s*\{([^}]*)\}/);
  assert.ok(bars, "aturan bersama bar");
  assert.match(bars[1], /-webkit-touch-callout:\s*none/);
  assert.match(bars[1], /user-select:\s*none/);
  assert.match(rule(".plg-timeline-slot"), /touch-action:\s*manipulation/);
});

test("dependensi ganda → toast 'Dependensi ini sudah ada'; dep tersimpan jenis apa pun ke pendahulu yang sama = ganda", () => withIx(async (w) => {
  const tasks = [
    mk(1, "A", { start: "2026-11-02", duration: 2 }),
    mk(2, "B", { start: "2026-11-09", duration: 2, deps: [{ t: { $task: 1 }, type: "FS", lag: 0 }] }),
    mk(3, "C", { start: "2026-11-09", duration: 2, deps: [{ t: { $task: 1 }, type: "SS", lag: 0 }] }), // jenis versi mendatang
    mk(4, "D", { start: "2026-11-12", duration: 1 }),
  ];
  const h = await ixSetup(tasks);
  const linkDrag = (from, to) => {
    const b = h.box(from);
    const x = h.cx(b.x + b.w + 5);
    const y = h.cy(h.midY(from));
    h.bar(from).props.onPointerDown(pev(x, y, { currentTarget: fakeNode() }));
    w.fire("pointermove", pev(x + 40, h.cy(h.midY(to))));
    w.fire("pointerup", pev(x + 40, h.cy(h.midY(to))));
  };
  linkDrag("1", "2");
  await tick();
  assert.deepEqual(h.calls.toast, [["Dependensi ini sudah ada", "error"]]);
  h.calls.toast.length = 0;
  linkDrag("1", "3");
  await tick();
  assert.deepEqual(h.calls.toast, [["Dependensi ini sudah ada", "error"]]);
  assert.deepEqual(h.calls.set, []);
  // ke diri sendiri tetap senyap
  h.calls.toast.length = 0;
  linkDrag("1", "1");
  await tick();
  assert.deepEqual(h.calls.toast, []);
  // C ← D tetap boleh; item SS lama ditulis ulang apa adanya
  linkDrag("4", "3");
  await tick();
  assert.deepEqual(h.calls.set, [[3, { deps: [{ t: { $task: 1 }, type: "SS", lag: 0 }, { t: { $task: 4 }, type: "FS", lag: 0 }] }]]);
  assert.ok(jsx.includes('"Dependensi ini sudah ada"'));
  h.m.unmount();
}));

test("Urungkan menunggu tulis yang sedang berjalan pada task yang sama (tidak tumpang tindih)", () => withIx(async () => {
  const tasks = [mk(1, "K", { start: "2026-11-06", duration: 2 })];
  const pending = [];
  const h = await ixSetup(tasks, { set: () => new Promise((r) => pending.push(r)) });
  const kev = (key, o) => Object.assign({ key, altKey: true, shiftKey: false, preventDefault() {} }, o || {});
  h.bar("1").props.onKeyDown(kev("ArrowRight"));
  await tick(); // pemeriksaan daftar lengkap (final review #1)
  pending.shift()();
  await tick();
  const undo1 = h.calls.toast[h.calls.toast.length - 1][2].onClick;
  h.bar("1").props.onKeyDown(kev("ArrowLeft", { shiftKey: true })); // tulis kedua: pemeriksaan + set berjalan
  undo1(); // diklik saat tulis kedua masih diperiksa → antre
  await tick();
  assert.equal(h.calls.set.length, 2);
  await tick();
  assert.equal(h.calls.setMany.length, 0, "Urungkan antre selama tulis berjalan");
  pending.shift()();
  await tick();
  await tick();
  assert.deepEqual(h.calls.setMany, [[{ taskId: 1, patch: { start: "2026-11-06" } }]]);
  h.m.unmount();
}));

test("blur dan dispose (unmount) di tengah seret → tanpa tulis, pendengar dilepas", () => withIx(async (w) => {
  const tasks = [mk(1, "A", { start: "2026-11-02", duration: 3 })];
  const h = await ixSetup(tasks);
  const b1 = h.box("1");
  const y = h.cy(h.midY("1"));
  const x0 = h.cx(b1.x + 10);
  const barEl = fakeNode();
  const base = "translate(" + b1.x + "px, " + (h.row("1").index * 32 + 8) + "px)";
  h.bar("1").props.onPointerDown(pev(x0, y, { currentTarget: barEl }));
  w.fire("pointermove", pev(x0 + 84, y));
  w.fire("blur", {});
  assert.equal(w.gesture(), 0);
  assert.equal(barEl.style.transform, base);
  w.fire("pointerup", pev(x0 + 84, y));
  h.bar("1").props.onPointerDown(pev(x0, y, { currentTarget: barEl }));
  w.fire("pointermove", pev(x0 + 84, y));
  assert.ok(w.gesture() > 0);
  h.m.unmount();
  assert.equal(w.gesture(), 0, "unmount membatalkan seret");
  w.fire("pointerup", pev(x0 + 84, y));
  // klik-jadwalkan yang belum dilepas juga dibersihkan
  await tick();
  assert.deepEqual(h.calls.set, []);
}));

test("tulis lewat keyboard: fokus dikembalikan ke bar yang sama bila hilang", () => withIx(async () => {
  const tasks = [mk(1, "K", { start: "2026-11-06", duration: 2 })];
  const h = await ixSetup(tasks);
  let focused = 0;
  const newBar = { getAttribute: (k) => (k === "data-key" ? "1" : k === "role" ? "button" : null), focus: () => { focused++; } };
  h.el.querySelectorAll = () => [newBar];
  const prevDoc = global.document;
  const body = {};
  global.document = { body, activeElement: body };
  try {
    const orig = { isConnected: false, getAttribute: (k) => (k === "role" ? "button" : null) };
    h.bar("1").props.onKeyDown({ key: "ArrowRight", altKey: true, shiftKey: false, currentTarget: orig, preventDefault() {} });
    await tick();
    await tick();
    assert.equal(focused, 1);
    // fokus masih di tempat lain yang sah → tidak dipindah
    global.document.activeElement = { isConnected: true };
    h.bar("1").props.onKeyDown({ key: "ArrowRight", altKey: true, shiftKey: false, currentTarget: { isConnected: true, getAttribute: () => "button" }, preventDefault() {} });
    await tick();
    await tick();
    assert.equal(focused, 1);
  } finally {
    global.document = prevDoc;
  }
  h.m.unmount();
}));

// ════════════════════════════════════════════════════════════════════════════
// Task 9 — Kalender kerja (popover, R18/U1), Daftar HP (R20/U3), urut + kolom + mode (R19).
// CalendarPopover memakai hooks → dirender sebagai elemen (React.createElement) oleh view; tes memasangnya sendiri
// dengan mount() dari props yang dibawa node-nya. window palsu mencatat pendengar (Esc, klik luar).
// ════════════════════════════════════════════════════════════════════════════
const CAL_TITLE = "Kalender kerja";
const WS_NOTE = "Dipakai semua anggota workspace";

function popWin() {
  const w = fakeWin();
  w.matchMedia = (q) => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  return w;
}
function withPop(fn) {
  const prev = global.window;
  const w = popWin();
  global.window = w;
  return Promise.resolve().then(() => fn(w)).finally(() => { global.window = prev; });
}
const popNode = (tree) => nodes(tree, (n) => n.type === T.CalendarPopover)[0];
const input = (tree, label) => nodes(tree, (n) => n.type === "input" && n.props["aria-label"] === label)[0];
const checkbox = (tree, text) => {
  const lab = nodes(tree, (n) => n.type === "label" && txt(n).trim() === text)[0];
  return lab && nodes(lab, (n) => n.type === "input")[0];
};
const section = (tree, label) => nodes(tree, (n) => n.type === "section" && n.props["aria-label"] === label)[0];
const formOf = (tree, label) => nodes(tree, (n) => n.type === "form" && n.props["aria-label"] === label)[0];
const alerts = (tree) => nodes(tree, (n) => n.props.role === "alert").map((n) => txt(n).trim()).filter(Boolean);
const dayBtns = (tree) => ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"].map((d) => buttonByText(tree, d));
const pressed = (tree) => dayBtns(tree).map((b) => b.props["aria-pressed"]);

// Pasang popover sendiri (props standar) lalu muat kalender.
async function popSetup(o) {
  const opts = o || {};
  const fr = opts.records || fakeRecords();
  const closes = [];
  const store = T.calendarStore({ records: fr.api });
  // pulled: true = tarik record sukses sudah terjadi sejak view dipasang (final review #2); tes jendela sinkron mengubahnya.
  const props = Object.assign({ calId: "cal@list:12", scope: "list:12", pageKind: "workspace", store, pulled: true, onClose: (a) => closes.push(a === undefined ? null : a) }, opts.props || {});
  const m = mount(T.CalendarPopover);
  let tree = m.render(props);
  const rootEl = { focused: 0, focus() { this.focused++; }, contains(t) { return t === this || (this.kids || []).indexOf(t) >= 0; } };
  const attach = (t) => { const d = nodes(t, (n) => n.props.role === "dialog")[0]; if (d && d.props.ref) d.props.ref.current = rootEl; };
  attach(tree);
  m.flush();
  await tick();
  await tick();
  tree = m.render(props);
  attach(tree);
  m.flush();
  const h = {
    m, fr, closes, rootEl, props, store,
    get tree() { return tree; },
    async step() { await tick(); await tick(); tree = m.render(props); attach(tree); m.flush(); return tree; },
    rerender() { tree = m.render(props); attach(tree); return tree; },
  };
  return h;
}

test("CalendarPopover workspace: judul + 'Dipakai semua anggota workspace'; tujuh sakelar hari; nyalakan Sabtu → save cal@list:12 scope list:12 dengan data ternormalisasi", () => withPop(async () => {
  const h = await popSetup();
  const dlg = nodes(h.tree, (n) => n.props.role === "dialog")[0];
  assert.ok(dlg, "role=dialog");
  assert.equal(dlg.props["aria-label"], CAL_TITLE);
  assert.ok(nodes(h.tree, (n) => /^h\d$/.test(String(n.type)) && txt(n).trim() === CAL_TITLE).length === 1, "judul");
  assert.ok(nodes(h.tree, (n) => txt(n).trim() === WS_NOTE && !(n.children || []).some((c) => c && typeof c === "object")).length >= 1, "keterangan workspace");
  assert.deepEqual(pressed(h.tree), [true, true, true, true, true, false, false]);
  assert.deepEqual(dayBtns(h.tree).map((b) => b.props["aria-label"]), ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]);
  assert.equal(checkbox(h.tree, "Ikuti libur nasional").props.checked, true);
  assert.equal(checkbox(h.tree, "Ikuti cuti bersama").props.checked, true);
  assert.ok(section(h.tree, "Libur tambahan") && section(h.tree, "Hari kerja pengganti"));
  assert.equal(h.fr.calls.put.length, 0);
  dayBtns(h.tree)[5].props.onClick({});
  let tree = await h.step();
  assert.equal(h.fr.calls.put.length, 1);
  const [entity, id, data, opts] = h.fr.calls.put[0];
  assert.equal(entity, "calendar");
  assert.equal(id, "cal@list:12");
  assert.deepEqual(opts, { scope: "list:12" });
  assert.deepEqual(data, { v: 1, weekdays: [1, 2, 3, 4, 5, 6], national: true, cutiBersama: true, off: [], work: [] });
  assert.deepEqual(pressed(tree), [true, true, true, true, true, true, false], "sakelar mengikuti simpanan");
  // matikan Sabtu lagi → satu simpan lagi; hari terakhir tidak bisa dimatikan
  dayBtns(tree)[5].props.onClick({});
  tree = await h.step();
  assert.deepEqual(h.fr.calls.put[1][2].weekdays, [1, 2, 3, 4, 5]);
  for (const i of [1, 2, 3, 4]) { dayBtns(tree)[i].props.onClick({}); tree = await h.step(); }
  assert.deepEqual(h.fr.calls.put[5][2].weekdays, [1]);
  const before = h.fr.calls.put.length;
  assert.equal(dayBtns(tree)[0].props.disabled, true, "hari kerja terakhir tidak bisa dimatikan");
  dayBtns(tree)[0].props.onClick({});
  await h.step();
  assert.equal(h.fr.calls.put.length, before);
  h.m.unmount();
}));

test("CalendarPopover: halaman project → cal@user scope user; tanpa 'Dipakai semua anggota workspace'", () => withPop(async () => {
  const h = await popSetup({ props: { calId: "cal@user", scope: "user", pageKind: "project" } });
  assert.ok(!txt(h.tree).includes(WS_NOTE));
  assert.deepEqual(h.fr.calls.get[0], ["calendar", "cal@user"]);
  dayBtns(h.tree)[6].props.onClick({});
  await h.step();
  const [, id, , opts] = h.fr.calls.put[0];
  assert.equal(id, "cal@user");
  assert.deepEqual(opts, { scope: "user" });
  h.m.unmount();
}));

test("CalendarPopover: cuti bersama OFF → save {cutiBersama:false}; view memuat ulang (onChange local) dan arsir 18 Mar 2026 hilang", () => withPop(async () => {
  const fr = fakeRecords();
  const { api, calls } = fakeApi({ records: fr, today: "2026-03-16" });
  const tasks = [mk(1, "A", { start: "2026-03-16", duration: 3 }, { list_id: 12, project: "P", project_id: 5 })];
  const { ctx } = ctxOf(tasks, { page: "slist_12", pageKind: "workspace", listId: 12, projectName: null });
  const vm = mount(T.TimelineViewBody);
  const props = { context: ctx, api };
  let vt = vm.render(props);
  vm.flush();
  await tick();
  // sinkron pertama selesai tanpa record workspace (workspace belum pernah punya kalender) → popover boleh mengubah
  fr.emit({ entity: null, ids: [], source: "sync", pulled: true });
  await tick();
  vt = vm.render(props);
  const holAt = (t, iso) => byCls(t, "plg-timeline-holiday").filter((n) => n.props["data-dn"] === T.TLCal.dn(iso)).length;
  assert.equal(holAt(vt, "2026-03-18"), 1, "cuti bersama Nyepi 18 Mar diarsir");
  // buka popover dari tombol toolbar
  const btn = buttonByText(vt, CAL_TITLE);
  assert.equal(btn.props["aria-expanded"], false);
  btn.props.onClick({});
  vt = vm.render(props);
  assert.equal(buttonByText(vt, CAL_TITLE).props["aria-expanded"], true);
  const node = popNode(vt);
  assert.ok(node, "popover dirender sebagai elemen (hooks sendiri)");
  assert.equal(node.props.calId, "cal@list:12");
  assert.equal(node.props.scope, "list:12");
  assert.equal(node.props.pageKind, "workspace");
  assert.equal(node.props.pulled, true);
  const pm = mount(T.CalendarPopover);
  let pt = pm.render(node.props);
  pm.flush();
  await tick();
  await tick();
  pt = pm.render(node.props);
  assert.equal(checkbox(pt, "Ikuti cuti bersama").props.checked, true);
  checkbox(pt, "Ikuti cuti bersama").props.onChange({ target: { checked: false } });
  await tick();
  await tick();
  assert.equal(fr.calls.put.length, 1);
  assert.equal(fr.calls.put[0][2].cutiBersama, false);
  assert.equal(fr.calls.put[0][2].national, true);
  // put asli memancarkan onChange {source:"local", ids:[id]} → view memuat ulang
  fr.emit({ entity: "calendar", ids: ["cal@list:12"], source: "local", lost: [] });
  await tick();
  await tick();
  vt = vm.render(props);
  assert.equal(holAt(vt, "2026-03-18"), 0, "cuti bersama OFF → arsir 18 Mar hilang");
  assert.equal(holAt(vt, "2026-03-19"), 1, "libur nasional 19 Mar tetap");
  pt = pm.render(node.props);
  assert.equal(checkbox(pt, "Ikuti cuti bersama").props.checked, false);
  // libur nasional OFF → 19 Mar hilang juga
  checkbox(pt, "Ikuti libur nasional").props.onChange({ target: { checked: false } });
  await tick();
  await tick();
  assert.equal(fr.calls.put[1][2].national, false);
  assert.equal(fr.calls.put[1][2].cutiBersama, false);
  // tutup lewat onClose view
  node.props.onClose();
  vt = vm.render(props);
  assert.equal(popNode(vt), undefined);
  assert.equal(buttonByText(vt, CAL_TITLE).props["aria-expanded"], false);
  pm.unmount();
  vm.unmount();
}));

test("CalendarPopover: tambah libur tambahan (nama > 60 dipotong, nama kosong tampil wajar, tanggal ganda ditolak), hapus, hari kerja pengganti", () => withPop(async () => {
  const h = await popSetup();
  const fOff = "Tambah libur tambahan";
  const set = (tree, label, v) => input(tree, label).props.onChange({ target: { value: v } });
  set(h.tree, "Tanggal libur tambahan", "2026-12-24");
  set(h.tree, "Nama libur tambahan", "  " + "x".repeat(70) + "  ");
  let tree = h.rerender();
  assert.equal(input(tree, "Tanggal libur tambahan").props.value, "2026-12-24");
  assert.equal(input(tree, "Nama libur tambahan").props.maxLength, 60);
  formOf(tree, fOff).props.onSubmit({ preventDefault() {} });
  tree = await h.step();
  assert.equal(h.fr.calls.put.length, 1);
  assert.deepEqual(h.fr.calls.put[0][2].off, [{ d: "2026-12-24", n: "x".repeat(60) }]);
  assert.equal(input(tree, "Tanggal libur tambahan").props.value, "", "formulir dikosongkan setelah tambah");
  assert.deepEqual(alerts(tree), []);
  assert.ok(txt(section(tree, "Libur tambahan")).includes("Kam 24 Des 2026"));
  // tanggal ganda → ditolak, tanpa simpan
  set(tree, "Tanggal libur tambahan", "2026-12-24");
  set(tree, "Nama libur tambahan", "lain");
  tree = h.rerender();
  formOf(tree, fOff).props.onSubmit({ preventDefault() {} });
  tree = await h.step();
  assert.equal(h.fr.calls.put.length, 1);
  assert.deepEqual(alerts(tree), ["Tanggal ini sudah ada"]);
  // tanggal kosong → ditolak
  set(tree, "Tanggal libur tambahan", "");
  tree = h.rerender();
  formOf(tree, fOff).props.onSubmit({ preventDefault() {} });
  tree = await h.step();
  assert.equal(h.fr.calls.put.length, 1);
  assert.deepEqual(alerts(tree), ["Pilih tanggal dulu"]);
  // nama kosong diterima dan tampil "(tanpa nama)"
  set(tree, "Tanggal libur tambahan", "2026-12-31");
  set(tree, "Nama libur tambahan", "");
  tree = h.rerender();
  formOf(tree, fOff).props.onSubmit({ preventDefault() {} });
  tree = await h.step();
  assert.deepEqual(h.fr.calls.put[1][2].off, [{ d: "2026-12-24", n: "x".repeat(60) }, { d: "2026-12-31", n: "" }]);
  assert.ok(txt(section(tree, "Libur tambahan")).includes("(tanpa nama)"));
  // hari kerja pengganti: daftar sendiri; tanggal yang sudah ada di Libur tambahan juga ditolak
  const fWork = "Tambah hari kerja pengganti";
  set(tree, "Tanggal hari kerja pengganti", "2026-12-24");
  tree = h.rerender();
  formOf(tree, fWork).props.onSubmit({ preventDefault() {} });
  tree = await h.step();
  assert.equal(h.fr.calls.put.length, 2);
  assert.deepEqual(alerts(tree), ["Tanggal ini sudah ada"]);
  set(tree, "Tanggal hari kerja pengganti", "2026-12-26");
  set(tree, "Nama hari kerja pengganti", "Lembur");
  tree = h.rerender();
  formOf(tree, fWork).props.onSubmit({ preventDefault() {} });
  tree = await h.step();
  assert.deepEqual(h.fr.calls.put[2][2].work, [{ d: "2026-12-26", n: "Lembur" }]);
  assert.deepEqual(alerts(tree), [], "galat hilang setelah tambah berhasil");
  // hapus
  const del = nodes(section(tree, "Libur tambahan"), (n) => n.type === "button" && /^Hapus /.test(n.props["aria-label"] || ""));
  assert.deepEqual(del.map((b) => b.props["aria-label"]), ["Hapus Kam 24 Des 2026", "Hapus Kam 31 Des 2026"]);
  del[0].props.onClick({});
  tree = await h.step();
  assert.deepEqual(h.fr.calls.put[3][2].off, [{ d: "2026-12-31", n: "" }]);
  assert.deepEqual(h.fr.calls.put[3][2].work, [{ d: "2026-12-26", n: "Lembur" }]);
  h.m.unmount();
}));

test("CalendarPopover: simpan > 16 KB → pesan persis, tanpa put; daftar tidak berubah", () => withPop(async () => {
  const fr = fakeRecords();
  const off = [];
  const base = T.TLCal.dn("2026-01-01");
  for (let i = 0; i < 366; i++) {
    const cand = off.concat([{ d: T.TLCal.iso(base + i), n: "n".repeat(60) }]);
    if (T.TLCal.byteSize(T.TLCal.normalize({ off: cand })) > 16384) break; // entri berikutnya (~86 byte) pasti melewati batas
    off.push(cand[cand.length - 1]);
  }
  const used = T.TLCal.byteSize(T.TLCal.normalize({ off }));
  assert.ok(used <= 16384 && used > 16384 - 200 && off.length < 366, "seed: " + used + " byte, " + off.length + " entri");
  fr.store.set("calendar/cal@list:12", { entity: "calendar", id: "cal@list:12", scope: "list:12", pending: false, data: { v: 1, weekdays: [1, 2, 3, 4, 5], national: true, cutiBersama: true, off, work: [] } });
  const h = await popSetup({ records: fr });
  const set = (tree, label, v) => input(tree, label).props.onChange({ target: { value: v } });
  set(h.tree, "Tanggal hari kerja pengganti", "2027-06-01");
  set(h.tree, "Nama hari kerja pengganti", "n".repeat(60));
  formOf(h.rerender(), "Tambah hari kerja pengganti").props.onSubmit({ preventDefault() {} });
  let tree = await h.step();
  assert.equal(fr.calls.put.length, 0, "tanpa put");
  assert.deepEqual(alerts(tree), ["Kalender terlalu besar — hapus sebagian libur tambahan"]);
  assert.equal(nodes(section(tree, "Hari kerja pengganti"), (n) => n.type === "li").length, 0, "entri tidak ditambahkan");
  assert.equal(nodes(section(tree, "Libur tambahan"), (n) => n.type === "li").length, off.length);
  // hapus satu entri → muat lagi; galat hilang
  nodes(section(tree, "Libur tambahan"), (n) => n.type === "button" && /^Hapus /.test(n.props["aria-label"] || ""))[0].props.onClick({});
  tree = await h.step();
  assert.equal(fr.calls.put.length, 1);
  assert.deepEqual(alerts(tree), []);
  h.m.unmount();
}));

test("CalendarPopover: put ditolak TOO_LARGE (pengaman kedua) / galat lain → pesan inline dan keadaan dimuat ulang dari simpanan", () => withPop(async () => {
  const fr = fakeRecords();
  const codes = ["TOO_LARGE", "BOOM"];
  fr.api.put = () => { const e = new Error("rusak"); e.code = codes.shift(); return Promise.reject(e); };
  const h = await popSetup({ records: fr });
  dayBtns(h.tree)[5].props.onClick({});
  let tree = h.rerender();
  assert.equal(pressed(tree)[5], true, "optimis");
  tree = await h.step();
  assert.deepEqual(alerts(tree), ["Kalender terlalu besar — hapus sebagian libur tambahan"]);
  assert.equal(pressed(tree)[5], false, "kembali ke simpanan");
  dayBtns(tree)[5].props.onClick({});
  tree = await h.step();
  assert.deepEqual(alerts(tree), ["Kalender gagal disimpan"]);
  assert.equal(pressed(tree)[5], false);
  h.m.unmount();
}));

test("CalendarPopover: pending → 'Menunggu sinkron' (dari record dan setelah simpan); kalender bersih tanpa label", () => withPop(async () => {
  const fr = fakeRecords();
  fr.store.set("calendar/cal@list:12", { entity: "calendar", id: "cal@list:12", scope: "list:12", pending: true, data: { v: 1, weekdays: [1, 2, 3, 4, 5], national: true, cutiBersama: true, off: [], work: [] } });
  const h = await popSetup({ records: fr });
  assert.ok(txt(h.tree).includes("Menunggu sinkron"));
  h.m.unmount();
  const fr2 = fakeRecords();
  fr2.store.set("calendar/cal@list:12", { entity: "calendar", id: "cal@list:12", scope: "list:12", pending: false, data: { v: 1, weekdays: [1, 2, 3, 4, 5], national: true, cutiBersama: true, off: [], work: [] } });
  const h2 = await popSetup({ records: fr2 });
  assert.ok(!txt(h2.tree).includes("Menunggu sinkron"));
  dayBtns(h2.tree)[5].props.onClick({});
  const tree = await h2.step();
  assert.ok(txt(tree).includes("Menunggu sinkron"), "put mengembalikan pending:true");
  h2.m.unmount();
}));

test("CalendarPopover: dimuat ulang saat sinkron mengubah kalender ini; peristiwa lokal sendiri tidak menimpa", () => withPop(async () => {
  const h = await popSetup();
  assert.deepEqual(pressed(h.tree), [true, true, true, true, true, false, false]);
  h.fr.store.set("calendar/cal@list:12", { entity: "calendar", id: "cal@list:12", scope: "list:12", pending: false, data: { v: 1, weekdays: [1, 2, 3, 4, 5, 6, 7], national: true, cutiBersama: true, off: [], work: [] } });
  h.fr.emit({ entity: "calendar", ids: ["cal@list:99"], source: "sync", lost: [] });
  let tree = await h.step();
  assert.deepEqual(pressed(tree), [true, true, true, true, true, false, false], "kalender lain diabaikan");
  h.fr.emit({ entity: "calendar", ids: ["cal@list:12"], source: "sync", lost: [] });
  tree = await h.step();
  assert.deepEqual(pressed(tree), [true, true, true, true, true, true, true]);
  // peristiwa lokal (simpanan kita sendiri / tab ini) tidak memuat ulang
  h.fr.store.set("calendar/cal@list:12", { entity: "calendar", id: "cal@list:12", scope: "list:12", pending: false, data: { v: 1, weekdays: [1], national: true, cutiBersama: true, off: [], work: [] } });
  const gets = h.fr.calls.get.length;
  h.fr.emit({ entity: "calendar", ids: ["cal@list:12"], source: "local", lost: [] });
  tree = await h.step();
  assert.equal(h.fr.calls.get.length, gets);
  assert.deepEqual(pressed(tree), [true, true, true, true, true, true, true]);
  h.m.unmount();
  assert.equal(h.fr.listenerCount(), 0, "unmount melepas pendengar onChange");
}));

test("CalendarPopover: fokus ke dialog saat dibuka; Esc menutup (propagasi dihentikan, fokus kembali); klik di luar menutup tanpa mengembalikan fokus; klik di dalam / tombol Kalender kerja tidak", () => withPop(async (w) => {
  const h = await popSetup();
  assert.equal(h.rootEl.focused, 1, "fokus dipindah ke dialog saat dipasang");
  assert.equal(nodes(h.tree, (n) => n.props.role === "dialog")[0].props.tabIndex, -1);
  assert.ok(w.ls.some((l) => l.type === "keydown" && l.cap), "Esc didengar fase tangkap");
  assert.ok(w.ls.some((l) => l.type === "pointerdown" && l.cap), "klik luar didengar fase tangkap");
  // tombol lain tidak menutup
  let stopped = 0;
  w.fire("keydown", { key: "Enter", preventDefault() {}, stopPropagation() { stopped++; } });
  assert.deepEqual(h.closes, []);
  w.fire("keydown", { key: "Escape", preventDefault() {}, stopPropagation() { stopped++; } });
  assert.deepEqual(h.closes, [{ restoreFocus: true }]);
  assert.equal(stopped, 1, "Esc tidak menutup modal host di belakangnya");
  // klik
  const inside = { closest: () => null };
  h.rootEl.kids = [inside];
  w.fire("pointerdown", { target: inside });
  assert.equal(h.closes.length, 1, "klik di dalam");
  w.fire("pointerdown", { target: { closest: (sel) => (sel === ".plg-timeline-calbtn" ? {} : null) } });
  assert.equal(h.closes.length, 1, "klik tombol Kalender kerja ditangani tombolnya sendiri (tidak ditutup-lalu-dibuka)");
  w.fire("pointerdown", { target: { closest: () => null } });
  assert.deepEqual(h.closes, [{ restoreFocus: true }, { restoreFocus: false }]);
  // tombol tutup
  const close = nodes(h.tree, (n) => n.type === "button" && n.props["aria-label"] === "Tutup")[0];
  assert.ok(close);
  close.props.onClick({});
  assert.deepEqual(h.closes[2], { restoreFocus: true });
  h.m.unmount();
  assert.equal(w.ls.filter((l) => l.type === "keydown" || l.type === "pointerdown").length, 0, "pendengar window dilepas");
}));

test("view: tutup popover dengan Esc mengembalikan fokus ke tombol 'Kalender kerja'; klik luar tidak", () => withPop(async () => {
  const { api } = fakeApi();
  const { ctx } = ctxOf([mk(1, "A", { start: "2026-11-02", duration: 3 })]);
  const vm = mount(T.TimelineViewBody);
  const props = { context: ctx, api };
  let vt = vm.render(props);
  let focused = 0;
  const calBtn = () => buttonByText(vt, CAL_TITLE);
  assert.ok(hasCls(calBtn(), "plg-timeline-calbtn"));
  calBtn().props.ref.current = { focus: () => { focused++; } };
  calBtn().props.onClick({});
  vt = vm.render(props);
  const node = popNode(vt);
  assert.equal(node.props.calId, "cal@user");
  assert.equal(node.props.scope, "user");
  assert.equal(node.props.pageKind, "project");
  node.props.onClose({ restoreFocus: false });
  vt = vm.render(props);
  assert.equal(popNode(vt), undefined);
  assert.equal(focused, 0);
  calBtn().props.onClick({});
  vt = vm.render(props);
  popNode(vt).props.onClose({ restoreFocus: true });
  assert.equal(focused, 1);
  vm.unmount();
}));

// ── Daftar (HP) ──────────────────────────────────────────────────────────────
function listTree(tasks, extra) {
  const { api } = fakeApi(extra);
  const lay = layOf(tasks, "week", api);
  const taps = [];
  const tree = mount(T.ListFallback).render({ rows: lay.rows, cal: lay.cal, onTaskClick: (t) => taps.push(t) });
  return { tree, taps, lay };
}
const weekHeads = (tree) => nodes(tree, (n) => /^h\d$/.test(String(n.type))).map((n) => txt(n).trim());
const liRows = (tree) => byCls(tree, "plg-timeline-li");

test("ListFallback: urut Mulai, kelompok minggu 'Mg 45 · 2–8 Nov', baris 'Sen 9 Nov → Kam 12 Nov · 4 hk', 🏁 bila lewat tenggat, 'Belum dijadwalkan', ketuk → onTaskClick", () => {
  const tasks = [
    mk(1, "Desain", { start: "2026-11-09", duration: 4 }),
    mk(2, "Riset", { start: "2026-11-02", duration: 3 }, { deadline: "2026-11-03" }),
    mk(3, "Rencana", {}),
    mk(4, "Rilis", { start: "2026-11-11", duration: 0 }),
    mk(5, "Satu hari", { start: "2026-11-10", duration: 1 }),
    mk(6, "Akhir Okt", { start: "2026-10-28", duration: 2 }),
  ];
  const { tree, taps } = listTree(tasks);
  assert.deepEqual(weekHeads(tree), ["Mg 44 · 26 Okt–1 Nov", "Mg 45 · 2–8 Nov", "Mg 46 · 9–15 Nov", "Belum dijadwalkan"]);
  const rows = liRows(tree);
  assert.deepEqual(rows.map((r) => byCls(r, "plg-timeline-li-title").map((n) => txt(n).trim())[0]), ["Akhir Okt", "Riset", "Desain", "Satu hari", "Rilis", "Rencana"]);
  const meta = (r) => byCls(r, "plg-timeline-li-meta").map((n) => txt(n).trim())[0];
  assert.equal(meta(rows[2]), "Sen 9 Nov → Kam 12 Nov · 4 hk");
  assert.equal(meta(rows[1]), "Sen 2 Nov → Rab 4 Nov · 3 hk");
  assert.equal(meta(rows[0]), "Rab 28 Okt → Kam 29 Okt · 2 hk");
  assert.equal(meta(rows[3]), "Sel 10 Nov · 1 hk", "satu hari: tanpa panah");
  assert.equal(meta(rows[4]), "Rab 11 Nov · Milestone");
  assert.equal(byCls(rows[5], "plg-timeline-li-meta").length, 0, "tanpa jadwal: hanya judul");
  // 🏁 hanya pada yang lewat tenggat (Riset selesai Rab 4 Nov > tenggat Sel 3 Nov)
  const flags = (r) => byCls(r, "plg-timeline-li-late");
  assert.deepEqual(rows.map((r) => flags(r).length), [0, 1, 0, 0, 0, 0]);
  assert.equal(txt(flags(rows[1])[0]).trim(), "🏁");
  assert.equal(flags(rows[1])[0].props.role, "img");
  assert.equal(flags(rows[1])[0].props["aria-label"], "Lewat tenggat");
  // ketuk → onTaskClick(task); baris = tombol
  for (const r of rows) assert.equal(r.type, "button");
  rows[1].props.onClick({});
  rows[5].props.onClick({});
  assert.deepEqual(taps.map((t) => t.id), [2, 3]);
});

test("ListFallback: tahun berbeda → label minggu memuat tahun; daftar kosong tanpa jadwal tetap menampilkan 'Belum dijadwalkan'; kelompok workspace dilewati", () => {
  const tasks = [mk(1, "A", { start: "2026-12-30", duration: 2 }), mk(2, "B", { start: "2027-01-05", duration: 1 })];
  const { tree } = listTree(tasks);
  assert.deepEqual(weekHeads(tree), ["Mg 53 · 28 Des 2026–3 Jan 2027", "Mg 1 · 4–10 Jan 2027"]);
  const onlyUnsched = listTree([mk(1, "A", {})]).tree;
  assert.deepEqual(weekHeads(onlyUnsched), ["Belum dijadwalkan"]);
  // baris group (halaman workspace) tidak muncul sebagai task
  const { api } = fakeApi();
  const wsTasks = [mk(1, "A", { start: "2026-11-02", duration: 2 }, { list_id: 12, project: "P", project_id: 5 })];
  const lay = T.TLLayout.layout({ tasks: wsTasks, pageKind: "workspace", cal: T.TLCal.DEFAULT_CAL, today: TODAY, zoom: "week", readSchedOf: (t) => T.TLSched.readSched(api.taskExt.read(t)) });
  assert.ok(lay.rows.some((r) => r.kind === "group"));
  const t = mount(T.ListFallback).render({ rows: lay.rows, cal: lay.cal, onTaskClick() {} });
  assert.equal(liRows(t).length, 1);
});

test("ListFallback: judul kosong → 'Tanpa judul'", () => {
  const { tree } = listTree([mk(1, "  ", { start: "2026-11-02", duration: 1 })]);
  assert.equal(txt(byCls(liRows(tree)[0], "plg-timeline-li-title")[0]).trim(), "Tanpa judul");
});

function narrowWin() {
  const w = popWin();
  w.matchMedia = (q) => ({ matches: q === "(max-width: 640px)", addEventListener() {}, removeEventListener() {} });
  return w;
}
function withNarrow(fn) {
  const prev = global.window;
  global.window = narrowWin();
  return Promise.resolve().then(fn).finally(() => { global.window = prev; });
}

test("HP (≤ 640 px): sakelar 'Gantt | Daftar' bawaan Gantt; Daftar → ListFallback (tanpa tabel/grafik) dan tersimpan mode:<page>; terbaca lagi dari storage", () => withNarrow(async () => {
  const tasks = [mk(1, "A", { start: "2026-11-09", duration: 4 }), mk(2, "B", {})];
  const { api, calls } = fakeApi();
  const { ctx, clicked } = ctxOf(tasks);
  const m = mount(T.TimelineViewBody);
  const props = { context: ctx, api };
  let tree = m.render(props);
  const radio = (t, l) => buttonByText(t, l).props["aria-checked"];
  assert.deepEqual([radio(tree, "Gantt"), radio(tree, "Daftar")], [true, false]);
  assert.equal(nodes(tree, (n) => n.props.role === "grid").length, 0 + 1, "Gantt: wadah grid ada");
  buttonByText(tree, "Daftar").props.onClick({});
  tree = m.render(props);
  assert.deepEqual([radio(tree, "Gantt"), radio(tree, "Daftar")], [false, true]);
  assert.equal(nodes(tree, (n) => n.props.role === "grid").length, 0);
  assert.equal(liRows(tree).length, 2);
  assert.deepEqual(weekHeads(tree), ["Mg 46 · 9–15 Nov", "Belum dijadwalkan"]);
  // alat Gantt tidak berarti di Daftar: hanya Kalender kerja + sakelar
  for (const l of ["Hari", "Minggu", "Bulan", "Hari ini", "Urutkan menurut Mulai", "Kolom"]) assert.equal(buttonByText(tree, l), undefined, l + " tersembunyi di Daftar");
  assert.ok(buttonByText(tree, "Kalender kerja"));
  liRows(tree)[0].props.onClick({});
  assert.deepEqual(clicked.map((t) => t.id), [1]);
  await tick();
  assert.deepEqual(calls.storageSet.filter((s) => s[0].indexOf("mode:") === 0), [["mode:proj_Alpha", "list"]]);
  // diingat per halaman: storage "list" → Daftar setelah dibaca; halaman lain tetap Gantt
  const { api: api2, calls: calls2 } = fakeApi({ storageGet: (k) => Promise.resolve(k === "mode:proj_Alpha" ? "list" : null) });
  const m2 = mount(T.TimelineViewBody);
  let t2 = m2.render({ context: ctx, api: api2 });
  assert.equal(radio(t2, "Gantt"), true, "bawaan Gantt sebelum storage terbaca");
  m2.flush();
  await tick();
  t2 = m2.render({ context: ctx, api: api2 });
  assert.equal(radio(t2, "Daftar"), true);
  assert.ok(calls2.storageGet.indexOf("mode:proj_Alpha") >= 0);
  const other = Object.assign({}, ctx, { page: "proj_Beta" });
  const m3 = mount(T.TimelineViewBody);
  m3.render({ context: other, api: api2 });
  m3.flush();
  await tick();
  const t3 = m3.render({ context: other, api: api2 });
  assert.equal(radio(t3, "Gantt"), true);
  assert.ok(calls2.storageGet.indexOf("mode:proj_Beta") >= 0);
}));

test("Daftar hanya ≤ 640 px: lebar → mode 'list' tersimpan diabaikan (Gantt penuh); Live Edit lebar tanpa sakelar", async () => {
  const tasks = [mk(1, "A", { start: "2026-11-09", duration: 4 })];
  const { api } = fakeApi({ storageGet: (k) => Promise.resolve(k.indexOf("mode:") === 0 ? "list" : null) });
  const { ctx } = ctxOf(tasks);
  const m = mount(T.TimelineViewBody);
  m.render({ context: ctx, api });
  m.flush();
  await tick();
  const tree = m.render({ context: ctx, api });
  assert.equal(nodes(tree, (n) => n.props.role === "grid").length, 1);
  assert.equal(liRows(tree).length, 0);
  assert.equal(buttonByText(tree, "Daftar"), undefined);
});

test("Kalender kerja di Daftar (HP): popover tetap tersedia; onChange lost → toast persis", () => withNarrow(async () => {
  const fr = fakeRecords();
  const { api, calls } = fakeApi({ records: fr });
  const { ctx } = ctxOf([mk(1, "A", { start: "2026-11-09", duration: 4 })], { page: "slist_12", pageKind: "workspace", listId: 12, projectName: null });
  const m = mount(T.TimelineViewBody);
  const props = { context: ctx, api };
  m.render(props);
  let tree = m.render(props);
  buttonByText(tree, "Daftar").props.onClick({});
  tree = m.render(props);
  buttonByText(tree, "Kalender kerja").props.onClick({});
  tree = m.render(props);
  assert.ok(popNode(tree));
  assert.equal(liRows(tree).length, 1, "Daftar tetap tampil di bawah popover");
  m.flush();
  await tick();
  fr.emit({ entity: "calendar", ids: ["cal@list:12"], source: "sync", lost: ["cal@list:12"] });
  assert.deepEqual(calls.toast.map((t) => t[0]), ["Perubahan kalender di perangkat ini kalah oleh perubahan yang lebih baru"]);
  m.unmount();
}));

// ── Urut dan kolom ───────────────────────────────────────────────────────────
test("Urutkan menurut Mulai mengubah urutan baris, WBS tetap; tersimpan sort:<page>; terbaca lagi", async () => {
  const tasks = [
    mk(1, "Pertama", { start: "2026-11-16", duration: 2 }),
    mk(2, "Kedua", {}),
    mk(3, "Ketiga", { start: "2026-11-02", duration: 2 }),
  ];
  const { api, calls } = fakeApi();
  const { ctx } = ctxOf(tasks);
  const m = mount(T.TimelineViewBody);
  const props = { context: ctx, api };
  let tree = m.render(props);
  const order = (t) => renderedRowKeys(t);
  const wbsOf = (t, k) => txt(cellsOf(rowOf(t, k))[0]).trim();
  assert.deepEqual(order(tree), ["1", "2", "3"]);
  const btn = buttonByText(tree, "Urutkan menurut Mulai");
  assert.equal(btn.props["aria-pressed"], false);
  btn.props.onClick({});
  tree = m.render(props);
  assert.deepEqual(order(tree), ["3", "1", "2"], "Mulai naik, tanpa jadwal terakhir");
  assert.deepEqual(["1", "2", "3"].map((k) => wbsOf(tree, k)), ["1", "2", "3"], "WBS tetap");
  assert.equal(buttonByText(tree, "Urutkan menurut Mulai").props["aria-pressed"], true);
  await tick();
  assert.deepEqual(calls.storageSet, [["sort:proj_Alpha", "start"]]);
  buttonByText(tree, "Urutkan menurut Mulai").props.onClick({});
  tree = m.render(props);
  assert.deepEqual(order(tree), ["1", "2", "3"]);
  await tick();
  assert.deepEqual(calls.storageSet[1], ["sort:proj_Alpha", "wbs"]);
  // dibaca lagi dari storage
  const { api: api2 } = fakeApi({ storageGet: (k) => Promise.resolve(k === "sort:proj_Alpha" ? "start" : null) });
  const m2 = mount(T.TimelineViewBody);
  m2.render({ context: ctx, api: api2 });
  m2.flush();
  await tick();
  assert.deepEqual(order(m2.render({ context: ctx, api: api2 })), ["3", "1", "2"]);
});

test("sumber Task 9: teks UI persis ada; CalendarPopover dirender sebagai elemen, bukan dipanggil sebagai fungsi di dalam view", () => {
  for (const t of ['"Kalender kerja"', '"Dipakai semua anggota workspace"', '"Menunggu sinkron"', '"Ikuti libur nasional"', '"Ikuti cuti bersama"', '"Libur tambahan"', '"Hari kerja pengganti"', '"Belum dijadwalkan"', '"Kalender terlalu besar — hapus sebagian libur tambahan"']) assert.ok(jsx.includes(t) || jsx.includes(t.slice(1, -1)), t);
  assert.doesNotMatch(jsx, /[^<\w.]CalendarPopover\(\{/);
  assert.match(jsx, /<CalendarPopover\b/);
});

test("final: CSS — input popover Kalender kerja (tanggal, teks, centang) ikut color-scheme gelap seperti input seksi", () => {
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let m;
  while ((m = re.exec(src))) rules.push({ sel: m[1].trim(), body: m[2] });
  const dark = rules.filter((r) => /color-scheme:\s*dark/.test(r.body)).flatMap((r) => r.sel.split(",").map((x) => x.trim()));
  for (const sel of ['[data-theme="dark"] .plg-timeline-input', '[data-theme="dark"] .plg-timeline-pop-input', '[data-theme="dark"] .plg-timeline-pop-check input']) {
    assert.ok(dark.indexOf(sel) >= 0, sel + " ada di aturan color-scheme: dark (" + dark.join(" | ") + ")");
  }
  // input tanggal popover memakai kelas yang tercakup
  assert.match(jsx, /<input type="date" className="plg-timeline-pop-input"/);
});

// ── Final review #1: Gantt memvalidasi tulis terhadap daftar task LENGKAP (scopeTasks host sudah difilter panel) ──
const linkDragOf = (h, w) => (from, to) => {
  const b = h.box(from);
  const x = h.cx(b.x + b.w + 5);
  const y = h.cy(h.midY(from));
  h.bar(from).props.onPointerDown(pev(x, y, { currentTarget: fakeNode() }));
  w.fire("pointermove", pev(x + 20, h.cy(h.midY(to))));
  w.fire("pointermove", pev(x + 40, h.cy(h.midY(to))));
  w.fire("pointerup", pev(x + 40, h.cy(h.midY(to))));
};

test("final #1: siklus lewat task yang disembunyikan filter panel → toast siklus, tanpa set (B dep A, C dep B, B tersembunyi, tautkan C→A)", () => withIx(async (w) => {
  const A = mk(1, "A", { start: "2026-11-02", duration: 1 });
  const B = mk(2, "B", { start: "2026-11-03", duration: 1, deps: [{ t: { $task: 1 }, type: "FS", lag: 0 }] }, { priority: "low" });
  const C = mk(3, "C", { start: "2026-11-04", duration: 1, deps: [{ t: { $task: 2 }, type: "FS", lag: 0 }] });
  const h = await ixSetup([A, C], { all: [A, B, C] }); // filter panel menyembunyikan B
  linkDragOf(h, w)("3", "1"); // A bergantung pada C → A→B→C→A
  await tick();
  assert.deepEqual(h.calls.set, [], "tidak ada tulis");
  assert.deepEqual(h.calls.toast, [["Dependensi ini membuat lingkaran", "error"]]);
  assert.ok(h.calls.list.length >= 1 && h.calls.list.every((q) => q && q.includeDone === true), "daftar lengkap dibaca (includeDone)");
  // tautan sah tetap ditulis (setelah pemeriksaan async)
  h.calls.toast.length = 0;
  linkDragOf(h, w)("1", "3");
  assert.deepEqual(h.calls.set, [], "belum menulis sebelum daftar lengkap diperiksa");
  await tick();
  assert.deepEqual(h.calls.set, [[3, { deps: [{ t: { $task: 2 }, type: "FS", lag: 0 }, { t: { $task: 1 }, type: "FS", lag: 0 }] }]]);
  assert.equal(h.calls.toast[0][0], "Jadwal diubah");
  h.m.unmount();
}));

test("final #1: induk yang anaknya disembunyikan filter = ringkasan — tidak bisa jadi ujung dependensi, diseret, Alt+panah, atau dijadwalkan", () => withIx(async (w) => {
  const P = mk(10, "Induk", { start: "2026-11-02", duration: 2 });
  const K = mk(11, "Anak", { start: "2026-11-03", duration: 1 }, { parent_id: 10, priority: "low" });
  const X1 = mk(1, "Lain", { start: "2026-11-05", duration: 3 });
  const Q = mk(20, "Induk belum dijadwal", {});
  const QK = mk(21, "Anak Q", {}, { parent_id: 20, priority: "low" });
  const h = await ixSetup([P, X1, Q], { all: [P, K, X1, Q, QK] });
  assert.equal(h.row("10").kind, "task", "di Gantt yang difilter induk tampak seperti task biasa");
  const SUM_DEP = [["Ringkasan tidak bisa diberi dependensi di versi ini", "error"]];
  // ujung dependensi (penerus dan pendahulu)
  linkDragOf(h, w)("1", "10");
  await tick();
  assert.deepEqual(h.calls.toast, SUM_DEP, "penerus ringkasan");
  h.calls.toast.length = 0;
  linkDragOf(h, w)("10", "1");
  await tick();
  assert.deepEqual(h.calls.toast, SUM_DEP, "pendahulu ringkasan");
  assert.deepEqual(h.calls.set, []);
  // seret geser → tanpa tulis, bar kembali, toast teks seksi ringkasan
  h.calls.toast.length = 0;
  const b = h.box("10");
  const y = h.cy(h.midY("10"));
  const x0 = h.cx(b.x + 10);
  const barEl = fakeNode();
  h.bar("10").props.onPointerDown(pev(x0, y, { currentTarget: barEl }));
  w.fire("pointermove", pev(x0 + 30, y));
  w.fire("pointermove", pev(x0 + 84, y));
  w.fire("pointerup", pev(x0 + 84, y));
  await tick();
  assert.deepEqual(h.calls.set, []);
  assert.deepEqual(h.calls.toast, [["Jadwal task ini mengikuti subtask-nya", "error"]]);
  assert.equal(barEl.style.transform, "translate(" + b.x + "px, " + (h.row("10").index * 32 + 8) + "px)", "bar kembali ke posisi semula");
  // Alt+→ → tanpa tulis; task bisa dicoba lagi (tidak tersangkut sibuk)
  h.calls.toast.length = 0;
  const kev = { key: "ArrowRight", altKey: true, shiftKey: false, preventDefault() {}, currentTarget: null };
  h.bar("10").props.onKeyDown(kev);
  await tick();
  h.bar("10").props.onKeyDown(kev);
  await tick();
  assert.deepEqual(h.calls.set, []);
  assert.equal(h.calls.toast.length, 2);
  // klik-jadwalkan pada induk belum terjadwal → tanpa tulis
  const slot = h.slot("20");
  const sx = h.cx(h.xOfIso("2026-11-09") + 6);
  const sy = h.cy(h.midY("20"));
  slot.props.onPointerDown(pev(sx, sy));
  w.fire("pointerup", pev(sx, sy));
  await tick();
  assert.deepEqual(h.calls.set, []);
  // task biasa tetap bisa diseret (tulis setelah pemeriksaan)
  const b1 = h.box("1");
  const y1 = h.cy(h.midY("1"));
  const x1 = h.cx(b1.x + 10);
  h.bar("1").props.onPointerDown(pev(x1, y1, { currentTarget: fakeNode() }));
  w.fire("pointermove", pev(x1 + 30, y1));
  w.fire("pointermove", pev(x1 + 84, y1));
  w.fire("pointerup", pev(x1 + 84, y1));
  await tick();
  assert.deepEqual(h.calls.set, [[1, { start: "2026-11-12" }]]);
  h.m.unmount();
}));

test("final #1: daftar lengkap gagal dimuat → tanpa tulis, toast 'Jadwal gagal disimpan'", () => withIx(async (w) => {
  const A = mk(1, "A", { start: "2026-11-02", duration: 1 });
  const C = mk(3, "C", { start: "2026-11-04", duration: 1 });
  const h = await ixSetup([A, C], { listImpl: () => Promise.reject(new Error("idb")) });
  linkDragOf(h, w)("1", "3");
  await tick();
  const b = h.box("1");
  const y = h.cy(h.midY("1"));
  const x0 = h.cx(b.x + 6);
  h.bar("1").props.onPointerDown(pev(x0, y, { currentTarget: fakeNode() }));
  w.fire("pointermove", pev(x0 + 30, y));
  w.fire("pointermove", pev(x0 + 84, y));
  w.fire("pointerup", pev(x0 + 84, y));
  await tick();
  assert.deepEqual(h.calls.set, []);
  assert.deepEqual(h.calls.toast, [["Jadwal gagal disimpan", "error"], ["Jadwal gagal disimpan", "error"]]);
  h.m.unmount();
}));

test("final #1: checkLink satu untuk Gantt dan seksi (sumber)", () => {
  assert.equal((jsx.match(/TLSched\.canLink\(/g) || []).length, 1, "canLink hanya dipanggil dari checkLink");
  assert.match(jsx, /const chk = checkLink\(api, list, pred, succ,/);
  assert.match(jsx, /const chk = checkLink\(api, pickIndex\.list, pred, task,/);
});

// ── Final review #2: kalender workspace tidak ditimpa sebelum sinkron pertama (jendela D5) ──
const WAIT_NOTE = "Menunggu data kalender workspace…";
const popControls = (tree) => nodes(tree, (n) => (n.type === "button" && !hasCls(n, "plg-timeline-pop-close") && !hasCls(n, "plg-timeline-pop-del")) || n.type === "input");

const PULLED = { entity: null, ids: [], source: "sync", pulled: true };
const WS_REC = (weekdays) => ({ entity: "calendar", id: "cal@list:12", scope: "list:12", pending: false, data: { v: 1, weekdays, national: true, cutiBersama: true, off: [], work: [] } });

test("final #2: popover workspace tanpa record lokal, belum ada tarik sukses → semua kontrol nonaktif + catatan persis; tidak ada put", () => withPop(async () => {
  const h = await popSetup({ props: { pulled: false } });
  const tree = h.tree;
  assert.ok(nodes(tree, (n) => txt(n).trim() === WAIT_NOTE && n.props.role === "status").length === 1, "catatan menunggu");
  const ctl = popControls(tree);
  assert.ok(ctl.length >= 13, "hari + centang + input + tombol Tambah");
  assert.ok(ctl.every((n) => n.props.disabled === true), "semua kontrol nonaktif");
  assert.equal(buttonByText(tree, "×") && buttonByText(tree, "×").props.disabled, undefined, "tombol Tutup tetap aktif");
  // klik paksa (mis. kejadian tertunda) tetap tidak menulis
  dayBtns(tree)[5].props.onClick({});
  checkbox(tree, "Ikuti cuti bersama").props.onChange({ target: { checked: false } });
  await h.step();
  assert.equal(h.fr.calls.put.length, 0, "tanpa put sebelum tarik sukses");
  h.m.unmount();
}));

test("final #2 (pulled): sinkron gagal (sync.done tanpa pulled) dan ack kirim source 'sync' TIDAK membuka kunci", () => withPop(async () => {
  const h = await popSetup({ props: { pulled: false } });
  // ack kirim / rewriteTaskRefs: source "sync" tanpa pulled, untuk kalender lain dan kalender ini (tanpa record lokal)
  h.fr.emit({ entity: "calendar", ids: ["cal@user"], source: "sync", lost: [] });
  h.fr.emit({ entity: "calendar", ids: ["cal@list:12"], source: "sync", lost: [] });
  let tree = await h.step();
  assert.ok(txt(tree).includes(WAIT_NOTE), "ack kirim tidak membuka kunci");
  assert.equal(dayBtns(tree)[5].props.disabled, true);
  // entitas lain + peristiwa tak dikenal → tetap terkunci
  h.fr.emit({ entity: "lain", ids: ["x"], source: "sync" });
  tree = await h.step();
  assert.ok(txt(tree).includes(WAIT_NOTE));
  dayBtns(tree)[5].props.onClick({});
  await h.step();
  assert.equal(h.fr.calls.put.length, 0);
  h.m.unmount();
}));

test("final #2 (pulled): tarik sukses tanpa record (workspace belum punya kalender) → terbuka setelah muat ulang; put berikutnya", () => withPop(async () => {
  const h = await popSetup({ props: { pulled: false } });
  h.fr.emit(PULLED);
  let tree = h.rerender();
  assert.ok(txt(tree).includes(WAIT_NOTE), "belum terbuka sebelum muat ulang selesai");
  tree = await h.step();
  assert.ok(!txt(tree).includes(WAIT_NOTE));
  assert.equal(dayBtns(tree)[5].props.disabled, false);
  dayBtns(tree)[5].props.onClick({});
  await h.step();
  assert.equal(h.fr.calls.put.length, 1, "workspace tanpa kalender: boleh diubah setelah tarik sukses");
  h.m.unmount();
}));

test("final #2 (pulled): record tiba lewat tarik → kontrol aktif hanya bersama data asli (tanpa jendela di atas bawaan)", () => withPop(async () => {
  // (a) peristiwa record + pulled dalam satu dispatch
  const h = await popSetup({ props: { pulled: false } });
  h.fr.store.set("calendar/cal@list:12", WS_REC([1, 2, 3, 4, 5, 6]));
  h.fr.emit({ entity: "calendar", ids: ["cal@list:12"], source: "sync", lost: [] });
  h.fr.emit(PULLED);
  let tree = h.rerender();
  assert.ok(txt(tree).includes(WAIT_NOTE), "sebelum muat ulang selesai: masih terkunci");
  assert.deepEqual(pressed(tree), [true, true, true, true, true, false, false], "masih data bawaan → harus terkunci");
  tree = await h.step();
  assert.ok(!txt(tree).includes(WAIT_NOTE));
  assert.deepEqual(pressed(tree), [true, true, true, true, true, true, false], "kalender bersama tampil saat terbuka");
  dayBtns(tree)[6].props.onClick({});
  await h.step();
  assert.deepEqual(h.fr.calls.put[0][2].weekdays, [1, 2, 3, 4, 5, 6, 7], "perubahan di atas kalender bersama, bukan bawaan");
  h.m.unmount();
  // (b) view menyalakan prop pulled (tarik sukses terjadi) saat popover terbuka → muat ulang dulu, baru terbuka
  const h2 = await popSetup({ props: { pulled: false } });
  h2.fr.store.set("calendar/cal@list:12", WS_REC([1, 2, 3, 4, 5, 6, 7]));
  h2.props.pulled = true;
  tree = h2.rerender();
  h2.m.flush();
  tree = h2.rerender();
  assert.ok(txt(tree).includes(WAIT_NOTE), "prop pulled tidak membuka kunci di atas data bawaan");
  tree = await h2.step();
  assert.ok(!txt(tree).includes(WAIT_NOTE));
  assert.deepEqual(pressed(tree), [true, true, true, true, true, true, true]);
  h2.m.unmount();
  // (c) popover dibuka setelah view sudah menerima pulled → terbuka setelah muat awal
  const h3 = await popSetup({ props: { pulled: true } });
  assert.ok(!txt(h3.tree).includes(WAIT_NOTE));
  assert.equal(dayBtns(h3.tree)[5].props.disabled, false);
  h3.m.unmount();
}));

test("final #2: record workspace sudah ada di perangkat → langsung bisa diubah; kalender pribadi (cal@user) tidak pernah terkunci", () => withPop(async () => {
  const fr = fakeRecords();
  fr.store.set("calendar/cal@list:12", WS_REC([1, 2, 3, 4, 5]));
  const h = await popSetup({ records: fr, props: { pulled: false } });
  assert.ok(!txt(h.tree).includes(WAIT_NOTE));
  dayBtns(h.tree)[5].props.onClick({});
  await h.step();
  assert.equal(fr.calls.put.length, 1);
  h.m.unmount();
  const h2 = await popSetup({ props: { calId: "cal@user", scope: "user", pageKind: "project", pulled: false } });
  assert.ok(!txt(h2.tree).includes(WAIT_NOTE));
  dayBtns(h2.tree)[5].props.onClick({});
  await h2.step();
  assert.equal(h2.fr.calls.put.length, 1);
  h2.m.unmount();
}));

test("final #2 (pulled): view memberi popover pulled=false sampai peristiwa pulled; sync.done (juga saat gagal) dan ack 'sync' tidak cukup", () => withPop(async () => {
  const fr = fakeRecords();
  const { api, calls } = fakeApi({ records: fr });
  const { ctx } = ctxOf([mk(1, "A", { start: "2026-11-09", duration: 4 })], { page: "slist_12", pageKind: "workspace", listId: 12, projectName: null });
  const m = mount(T.TimelineViewBody);
  const props = { context: ctx, api };
  let tree = m.render(props);
  m.flush();
  await tick();
  tree = m.render(props);
  buttonByText(tree, "Kalender kerja").props.onClick({});
  tree = m.render(props);
  assert.equal(popNode(tree).props.pulled, false, "belum ada tarik sukses");
  for (const f of calls.handlers["sync.done"] || []) f({ initial: false }); // sinkron gagal juga memancarkan ini
  fr.emit({ entity: "calendar", ids: ["cal@user"], source: "sync", lost: [] }); // ack kirim
  m.flush();
  await tick();
  tree = m.render(props);
  assert.equal(popNode(tree).props.pulled, false, "sync.done / ack bukan tanda tarik sukses");
  fr.emit(PULLED);
  tree = m.render(props);
  assert.equal(popNode(tree).props.pulled, false, "latch view dinyalakan setelah muat ulang selesai");
  m.flush();
  await tick();
  tree = m.render(props);
  assert.equal(popNode(tree).props.pulled, true);
  m.unmount();
}));


test("final #2 (pulled): calendarStore.subscribe meneruskan peristiwa pulled host (entity null) — ack biasa tanpa pulled", () => {
  const fr = fakeRecords();
  const store = T.calendarStore({ records: fr.api });
  const got = [];
  const off = store.subscribe((ev) => got.push(ev));
  fr.emit({ entity: null, ids: [], source: "sync", pulled: true });
  fr.emit({ entity: "calendar", ids: ["cal@user"], source: "sync" });
  fr.emit({ entity: null, ids: [], source: "sync" }); // entity null tanpa pulled → diabaikan
  assert.deepEqual(got, [{ ids: [], source: "sync", lost: [], pulled: true }, { ids: ["cal@user"], source: "sync", lost: [] }]);
  off();
});

// ════════════════════════════════════════════════════════════════════════════
// Fase 1 PR 1c-1 — Task 6: projectStore (R6), useUnits, useEngine (R7), nol tulisan latar (R25)
// ════════════════════════════════════════════════════════════════════════════
const { mock } = test;
const settle = () => new Promise((r) => setImmediate(r)); // setImmediate tidak dipalsukan mock.timers
const NO_UNIT = { auto: false, by: null, updatedAt: null, pending: false, exists: false, fold: null };

// Record `project` yang sah untuk nama project di workspace lid (null = pribadi); data/extra menimpa bawaan.
function unitRec(lid, name, data, extra) {
  const u = T.TLSched.unitOf(lid ? { pageKind: "workspace", listId: lid, projectName: name } : { pageKind: "project", listId: null, projectName: name });
  return Object.assign({
    entity: "project", id: u.recId, scope: u.scope,
    data: Object.assign({ v: 1, auto: true, name, by: 7 }, data || {}),
    updated_at: "2026-11-03T02:00:00Z", version: 3, pending: false,
  }, extra || {});
}
const putRec = (fr, r) => fr.store.set(r.entity + "/" + r.id, r);

// raf palsu (antre) + setTimeout palsu (mock.timers); dipulihkan setelah fn selesai.
function withEngineClock(fn) {
  const prevRaf = global.requestAnimationFrame;
  const prevCaf = global.cancelAnimationFrame;
  const q = new Map();
  let n = 0;
  global.requestAnimationFrame = (f) => { q.set(++n, f); return n; };
  global.cancelAnimationFrame = (id) => { q.delete(id); };
  mock.timers.enable({ apis: ["setTimeout"] });
  const clock = {
    frames() {
      const fs = [...q.values()];
      q.clear();
      for (const f of fs) f();
      return fs.length;
    },
    tick(ms) { mock.timers.tick(ms); },
  };
  return Promise.resolve().then(() => fn(clock)).finally(() => {
    mock.timers.reset();
    if (prevRaf === undefined) delete global.requestAnimationFrame; else global.requestAnimationFrame = prevRaf;
    if (prevCaf === undefined) delete global.cancelAnimationFrame; else global.cancelAnimationFrame = prevCaf;
  });
}

// Spy mesin: T.engine.run (satu pintu TLCpm.run di plugin) → daftar {ctx, result}.
function spyRun() {
  const orig = T.engine.run;
  const runs = [];
  T.engine.run = (ctx) => {
    const result = orig(ctx);
    runs.push({ ctx, result });
    return result;
  };
  return { runs, restore: () => { T.engine.run = orig; } };
}

// Spy tulis: taskExt.set/setMany + records.put (fakeRecords mencatat put di fr.calls.put).
function spyWrites(api) {
  const writes = [];
  api.taskExt.set = (...a) => { writes.push(["set", a]); return Promise.resolve(); };
  api.taskExt.setMany = (...a) => { writes.push(["setMany", a]); return Promise.resolve(); };
  return writes;
}

test("projectStore.loadUnits workspace: list scope list:12 (dua halaman next) → Map per recId; data name fold beda → exists false; v 2 → diabaikan", async () => {
  const fr = fakeRecords();
  for (let i = 0; i < 1003; i++) putRec(fr, unitRec(12, "Proyek " + i, { auto: i % 2 === 0, by: i % 3 ? i : null }));
  // scope lain tidak ikut termuat
  const other = unitRec(13, "Proyek 1");
  const mine = unitRec(null, "Proyek 1");
  putRec(fr, other);
  putRec(fr, mine);
  const alpha = unitRec(12, "Alpha", {}, { pending: true });
  const none = unitRec(12, ""); // "(Tanpa project)" = unit "-"
  const caseOnly = unitRec(12, "Delta");
  caseOnly.data.name = "DELTA"; // projectFold hanya A–Z → lipatan sama → sah
  const bad = unitRec(12, "Beta");
  bad.data.name = "Gamma"; // id dari "Beta", nama "Gamma" → fold beda (penjaga tabrakan hash)
  const v2 = unitRec(12, "Epsilon", { v: 2 });
  const autoStr = unitRec(12, "Zeta", { auto: "true" });
  const byStr = unitRec(12, "Eta", { by: "7" });
  const noBy = unitRec(12, "Theta");
  delete noBy.data.by;
  for (const r of [alpha, none, caseOnly, bad, v2, autoStr, byStr, noBy]) putRec(fr, r);
  const store = T.projectStore({ records: fr.api });
  const units = await store.loadUnits({ pageKind: "workspace", listId: 12, projectName: null });
  // dua halaman: limit 1000, halaman kedua dengan after = next halaman pertama
  const ids12 = [...fr.store.values()].filter((r) => r.scope === "list:12").map((r) => r.id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  assert.equal(fr.calls.list.length, 2);
  assert.deepEqual(fr.calls.list[0], ["project", { scope: "list:12", limit: 1000 }]);
  assert.deepEqual(fr.calls.list[1], ["project", { scope: "list:12", limit: 1000, after: ids12[999] }]);
  assert.ok(units instanceof Map);
  assert.equal(units.size, ids12.length);
  assert.deepEqual(units.get(alpha.id), { auto: true, by: 7, updatedAt: "2026-11-03T02:00:00Z", pending: true, exists: true, fold: "alpha" });
  assert.deepEqual(units.get(none.id), { auto: true, by: 7, updatedAt: "2026-11-03T02:00:00Z", pending: false, exists: true, fold: "" });
  assert.equal(none.id, "prj@list:12:-");
  assert.equal(units.get(caseOnly.id).exists, true);
  assert.equal(units.get(caseOnly.id).fold, "delta");
  for (const r of [bad, v2, autoStr, byStr, noBy]) assert.deepEqual(units.get(r.id), NO_UNIT, r.data.name + " dianggap tidak ada");
  const p4 = units.get(unitRec(12, "Proyek 4").id);
  assert.deepEqual(p4, { auto: true, by: 4, updatedAt: "2026-11-03T02:00:00Z", pending: false, exists: true, fold: "proyek 4" });
  for (const id of ids12.slice(1000)) assert.ok(units.has(id), "halaman kedua ikut: " + id);
  assert.deepEqual(units.get(unitRec(12, "Proyek 1000").id), { auto: true, by: 1000, updatedAt: "2026-11-03T02:00:00Z", pending: false, exists: true, fold: "proyek 1000" });
  assert.equal(units.get(unitRec(12, "Proyek 3").id).by, null);
  assert.equal(units.has(other.id), false);
  assert.equal(units.has(mine.id), false);
  assert.equal(fr.calls.get.length, 0);
  assert.equal(fr.calls.put.length, 0, "memuat tidak pernah menulis (record rusak tidak dinormalisasi ulang)");

  // halaman project → get satu recId (unitOf halaman); tanpa record → tidak ada
  const u1 = await store.loadUnits({ pageKind: "project", listId: null, projectName: "Proyek 1" });
  assert.deepEqual(fr.calls.get, [["project", mine.id]]);
  assert.deepEqual([...u1.keys()], [mine.id]);
  assert.equal(u1.get(mine.id).exists, true);
  const u2 = await store.loadUnits({ pageKind: "project", listId: null, projectName: "Belum Ada" });
  assert.deepEqual([...u2.entries()], [[T.TLSched.unitOf({ list_id: null, project: "Belum Ada" }).recId, NO_UNIT]]);
  // halaman project dengan record ber-nama lain (tabrakan) → tidak ada
  const clash = unitRec(null, "Kappa");
  clash.data.name = "Lambda";
  putRec(fr, clash);
  const u3 = await store.loadUnits({ pageKind: "project", listId: null, projectName: "Kappa" });
  assert.deepEqual(u3.get(clash.id), NO_UNIT);
  assert.equal(fr.calls.put.length, 0);
});

test("setAuto menulis {v:1, auto, name, by} scope unit", async () => {
  const fr = fakeRecords();
  const store = T.projectStore({ records: fr.api });
  const u = T.TLSched.unitOf({ list_id: 12, project: "Alpha" });
  const rec = await store.setAuto(u, true, 7);
  assert.deepEqual(fr.calls.put, [["project", u.recId, { v: 1, auto: true, name: "Alpha", by: 7 }, { scope: "list:12" }]]);
  assert.equal(rec.id, u.recId);
  assert.equal(rec.pending, true);
  // bulat-pergi: loadUnits melihat record yang baru ditulis
  const units = await store.loadUnits({ pageKind: "workspace", listId: 12 });
  assert.deepEqual(units.get(u.recId), { auto: true, by: 7, updatedAt: "2026-11-01T00:00:00Z", pending: true, exists: true, fold: "alpha" });
  // pribadi, OFF, userId bukan bilangan bulat → by null
  const p = T.TLSched.unitOf({ list_id: null, project: "Rumah" });
  await store.setAuto(p, false, "7");
  assert.deepEqual(fr.calls.put[1], ["project", p.recId, { v: 1, auto: false, name: "Rumah", by: null }, { scope: "user" }]);
  // nama asli (bukan lipatan) dipotong 120; record terbaca kembali sebagai unit yang sama
  const longName = "Proyek Besar " + "Abc".repeat(50);
  const lu = T.TLSched.unitOf({ list_id: 12, project: longName });
  await store.setAuto(lu, true, 7);
  assert.deepEqual(fr.calls.put[2], ["project", lu.recId, { v: 1, auto: true, name: longName.slice(0, 120), by: 7 }, { scope: "list:12" }]);
  assert.equal((await store.loadUnits({ pageKind: "workspace", listId: 12 })).get(lu.recId).auto, true, "nama > 120 tetap terbaca (workspace)");
  const lp = T.TLSched.unitOf({ list_id: null, project: longName });
  await store.setAuto(lp, true, 7);
  assert.equal((await store.loadUnits({ pageKind: "project", listId: null, projectName: longName })).get(lp.recId).auto, true, "nama > 120 tetap terbaca (project)");
  // subscribe: entitas project + peristiwa pulled diteruskan; calendar diabaikan; off berhenti
  const got = [];
  const off = store.subscribe((ev) => got.push(ev));
  fr.emit({ entity: "project", ids: [u.recId], source: "sync", lost: [u.recId] });
  fr.emit({ entity: "calendar", ids: ["cal@user"], source: "local" });
  fr.emit({ entity: null, ids: [], source: "sync", pulled: true });
  fr.emit({ entity: "project", ids: [p.recId], source: "local" });
  assert.deepEqual(got, [
    { ids: [u.recId], source: "sync", lost: [u.recId] },
    { ids: [], source: "sync", lost: [], pulled: true },
    { ids: [p.recId], source: "local", lost: [] },
  ]);
  off();
  assert.equal(fr.listenerCount(), 0);
});

test("useUnits: muat unit halaman; latch pulled menyala hanya setelah peristiwa pulled + muat ulang (P3 a: kunci sakelar T8)", () => withEngineClock(async (clock) => {
  const fr = fakeRecords();
  const { api } = fakeApi({ records: fr });
  const Hook = (p) => T.useUnits(p.api, p.page);
  const m = mount(Hook);
  const page = { pageKind: "workspace", listId: 12, projectName: null };
  let r = m.render({ api, page });
  assert.equal(r.loaded, false);
  assert.equal(r.pulled, false);
  assert.equal(r.units.size, 0);
  m.flush();
  await settle();
  assert.equal(fr.calls.list.length, 1, "muat pertama saat pasang tanpa debounce (tanpa memajukan timer)");
  r = m.render({ api, page });
  assert.equal(r.loaded, true);
  assert.equal(r.pulled, false, "muat lokal bukan tanda tarik sukses");
  // record tiba lewat sinkron (bukan pulled) → dimuat ulang (debounce), latch tetap mati
  putRec(fr, unitRec(12, "Alpha"));
  fr.emit({ entity: "project", ids: [unitRec(12, "Alpha").id], source: "sync" });
  clock.tick(300);
  await settle();
  r = m.render({ api, page });
  assert.equal(r.units.get(unitRec(12, "Alpha").id).auto, true);
  assert.equal(r.pulled, false);
  fr.emit(PULLED);
  await settle();
  r = m.render({ api, page });
  assert.equal(r.pulled, true);
  assert.equal(fr.calls.put.length, 0);
  m.unmount();
  assert.equal(fr.listenerCount(), 0);
}));

test("useUnits: peristiwa record project beruntun → satu muat ulang 300 ms (konstanta bersama useEngine)", () => withEngineClock(async (clock) => {
  const fr = fakeRecords();
  const { api } = fakeApi({ records: fr });
  const m = mount((p) => T.useUnits(p.api, p.page));
  const page = { pageKind: "workspace", listId: 12, projectName: null };
  m.render({ api, page });
  m.flush();
  await settle();
  assert.equal(fr.calls.list.length, 1);
  assert.equal(T.RELOAD_TIMING.debounceMs, 300);
  const ev = { entity: "project", ids: ["prj@list:12:-"], source: "sync" };
  fr.emit(ev);
  clock.tick(200);
  fr.emit(ev);
  clock.tick(299);
  await settle();
  assert.equal(fr.calls.list.length, 1);
  clock.tick(1);
  await settle();
  assert.equal(fr.calls.list.length, 2, "dua kejadian beruntun = satu muat");
  clock.tick(1000);
  await settle();
  assert.equal(fr.calls.list.length, 2);
  fr.emit(ev);
  m.unmount();
  clock.tick(1000);
  await settle();
  assert.equal(fr.calls.list.length, 2, "timer tertunda dibatalkan saat dilepas");
}));

// ════════════════════════════════════════════════════════════════════════════
// Fase 1 PR 1c-2 — Task 4: baselineStore (K41) — muat per unit, simpan/hapus terpagar, kunci workspace, CAS snap
// ════════════════════════════════════════════════════════════════════════════
// Record `baseline` sah untuk slot n unit (lid null = pribadi). Id ditulis tangan DI TES (bentuk yang diharapkan
// `bl<n>` + ekor recId unitOf); kode plugin hanya membangunnya dari keluaran TLSched.unitOf.
const BL_T = [[{ $task: 1 }, "2026-11-02", "2026-11-04", 3, 2], [{ $task: 2 }, "2026-11-05", "2026-11-05", 1, 0]];
function blUnit(lid, name) {
  return T.TLSched.unitOf(lid ? { pageKind: "workspace", listId: lid, projectName: name } : { pageKind: "project", listId: null, projectName: name });
}
function blRec(lid, name, n, data, extra) {
  const u = blUnit(lid, name);
  return Object.assign({
    entity: "baseline", id: "bl" + n + u.recId.slice(3), scope: u.scope,
    data: Object.assign({ v: 1, n, name: "Baseline " + n, savedAt: "2026-11-04T03:00:00Z", by: 7, t: BL_T }, data || {}),
    updated_at: "2026-11-04T03:00:00Z", version: 2, pending: false,
  }, extra || {});
}
const BL_DATA = { v: 1, n: 1, name: "dari encode", savedAt: "2026-11-05T01:00:00Z", by: 7, t: BL_T };
const blCode = (code) => (e) => e && e.code === code;

test("baselineStore.loadAll dua halaman next; v2 / n asing = slot TERISI foreign (bukan kosong); hanya slot unit ini, tanpa tulis", async () => {
  const fr = fakeRecords();
  // 1003 baseline unit lain di scope list:12 → dua halaman (limit 1000)
  for (let i = 0; i < 1003; i++) putRec(fr, blRec(12, "Proyek " + i, 1));
  const a1 = blRec(12, "Alpha", 1, { name: "Rencana awal" }, { pending: true });
  const a2 = blRec(12, "Alpha", 2, { v: 2 }, { updated_at: "2026-11-04T05:00:00Z" }); // versi lebih baru → terisi, asing
  const a3 = blRec(12, "Alpha", 3, { name: "Sesudah revisi", by: null });
  const beta3 = blRec(12, "Beta", 3, { n: 1 }, { pending: true }); // n data ≠ n id → asing (tetap terisi)
  const alphaOther = blRec(13, "Alpha", 1); // workspace lain
  const alphaMine = blRec(null, "Alpha", 1); // pribadi
  for (const r of [a1, a2, a3, beta3, alphaOther, alphaMine]) putRec(fr, r);
  putRec(fr, unitRec(12, "Alpha")); // entitas project di scope sama tidak ikut
  assert.match(a1.id, /^bl1@list:12:[0-9a-f]{8}$/);
  assert.match(alphaMine.id, /^bl1@user:[0-9a-f]{8}$/);
  const store = T.baselineStore({ records: fr.api });
  const map = await store.loadAll(blUnit(12, "Alpha"));
  const ids12 = [...fr.store.values()].filter((r) => r.entity === "baseline" && r.scope === "list:12").map((r) => r.id).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  assert.equal(fr.calls.list.length, 2, "dua halaman");
  assert.deepEqual(fr.calls.list[0], ["baseline", { scope: "list:12", limit: 1000 }]);
  assert.deepEqual(fr.calls.list[1], ["baseline", { scope: "list:12", limit: 1000, after: ids12[999] }]);
  assert.ok(ids12.indexOf(a3.id) >= 1000, "slot 3 Alpha ada di halaman kedua");
  assert.ok(map instanceof Map);
  assert.deepEqual([...map.keys()].sort(), [1, 2, 3], "v2 di slot 2 tetap mengisi slot");
  const e2 = map.get(2);
  assert.equal(e2.foreign, true);
  assert.equal(e2.n, 2);
  assert.equal(e2.name, null);
  assert.equal(e2.savedAt, null);
  assert.equal(e2.by, null);
  assert.ok(e2.rows instanceof Map && e2.rows.size === 0, "isi asing tidak dibaca");
  assert.deepEqual(e2.snap, { exists: true, updatedAt: "2026-11-04T05:00:00Z", by: null }, "by data asing tidak dipercaya");
  assert.equal(e2.pending, false);
  const e1 = map.get(1);
  assert.equal(e1.foreign, false);
  assert.equal(e1.n, 1);
  assert.equal(e1.name, "Rencana awal");
  assert.equal(e1.savedAt, "2026-11-04T03:00:00Z");
  assert.equal(e1.by, 7);
  assert.deepEqual([...e1.rows.keys()], ["1", "2"], "baris lewat TLPlan.baselineDecode");
  assert.deepEqual(e1.snap, { exists: true, updatedAt: "2026-11-04T03:00:00Z", by: 7 });
  assert.equal(e1.pending, true);
  assert.deepEqual(map.get(3).snap, { exists: true, updatedAt: "2026-11-04T03:00:00Z", by: null });
  assert.equal(fr.calls.get.length, 0);
  assert.equal(fr.calls.put.length + fr.calls.remove.length, 0, "memuat tidak pernah menulis");
  // Beta: slot 3 berdata n 1 → asing tetapi terisi; halaman project pribadi → scope user (satu halaman)
  const beta = await store.loadAll(blUnit(12, "Beta"));
  assert.deepEqual([...beta.keys()], [3]);
  assert.equal(beta.get(3).foreign, true);
  assert.equal(beta.get(3).pending, true);
  const mine = await store.loadAll(blUnit(null, "Alpha"));
  assert.deepEqual([...mine.keys()], [1]);
  assert.deepEqual(fr.calls.list[fr.calls.list.length - 1], ["baseline", { scope: "user", limit: 1000 }]);
  assert.equal((await store.loadAll(blUnit(null, "Belum Ada"))).size, 0);
  // unit tidak sah → ditolak (bukan list scope sembarang)
  await assert.rejects(store.loadAll({ recId: "bl1@user:x", scope: "user" }), blCode("INVALID"));
  await assert.rejects(store.loadAll(null), blCode("INVALID"));
  assert.equal(fr.calls.put.length + fr.calls.remove.length, 0);
});

test("baselineStore: save menulis {v:1,n,name,savedAt,by,t} scope unit (id dari unitOf), CAS baca dulu; remove = records.remove; slot/unit tidak sah ditolak tanpa tulis", async () => {
  const fr = fakeRecords();
  const store = T.baselineStore({ records: fr.api });
  const u = blUnit(12, "Alpha");
  const id2 = "bl2" + u.recId.slice(3);
  const rec = await store.save(u, 2, "Rencana awal", BL_DATA, T.BL_NO_SNAP);
  assert.deepEqual(fr.calls.get, [["baseline", id2]], "CAS: baca record slot saat simpan");
  assert.deepEqual(fr.calls.put, [["baseline", id2, { v: 1, n: 2, name: "Rencana awal", savedAt: "2026-11-05T01:00:00Z", by: 7, t: BL_T }, { scope: "list:12" }]]);
  assert.equal(rec.id, id2);
  assert.equal(rec.pending, true);
  assert.equal(T.blRecId(u, 2), id2);
  // bulat-pergi: loadAll melihat record yang baru ditulis
  const map = await store.loadAll(u);
  assert.equal(map.get(2).name, "Rencana awal");
  assert.deepEqual(map.get(2).snap, { exists: true, updatedAt: "2026-11-01T00:00:00Z", by: 7 });
  // pribadi: scope user, id bl1@user:<h>; savedAt/by bukan string/bilangan bulat → null
  const p = blUnit(null, "Rumah");
  await store.save(p, 1, "Baseline 1", Object.assign({}, BL_DATA, { savedAt: 5, by: "7" }), T.BL_NO_SNAP);
  assert.deepEqual(fr.calls.put[1], ["baseline", "bl1" + p.recId.slice(3), { v: 1, n: 1, name: "Baseline 1", savedAt: null, by: null, t: BL_T }, { scope: "user" }]);
  assert.match(fr.calls.put[1][1], /^bl1@user:[0-9a-f]{8}$/);
  // remove (fungsi tulis yang sama): satu records.remove, tanpa put
  await store.remove(u, 2);
  assert.deepEqual(fr.calls.remove, [["baseline", id2]]);
  assert.equal(fr.calls.put.length, 2);
  assert.equal((await store.loadAll(u)).has(2), false);
  // slot / unit / data tidak sah → INVALID, tanpa baca maupun tulis
  const gets = fr.calls.get.length;
  for (const n of [0, 4, "1", 1.5, null]) {
    await assert.rejects(store.save(u, n, "x", BL_DATA, T.BL_NO_SNAP), blCode("INVALID"), "slot " + n);
    await assert.rejects(store.remove(u, n), blCode("INVALID"), "hapus slot " + n);
  }
  const forged = [null, {}, { recId: "bl1@user:abc", scope: "user" }, { recId: u.recId, scope: "user" }, { recId: u.recId, scope: "list:13" }, { recId: "prj@user:abc" }];
  for (const bad of forged) {
    await assert.rejects(store.save(bad, 1, "x", BL_DATA, T.BL_NO_SNAP), blCode("INVALID"), JSON.stringify(bad));
    await assert.rejects(store.remove(bad, 1), blCode("INVALID"), "hapus " + JSON.stringify(bad));
  }
  for (const d of [null, "x", { v: 1, t: "bukan larik" }]) await assert.rejects(store.save(u, 1, "x", d, T.BL_NO_SNAP), blCode("INVALID"));
  await assert.rejects(store.save(u, 1, 5, BL_DATA, T.BL_NO_SNAP), blCode("INVALID"), "nama bukan string");
  assert.equal(fr.calls.get.length, gets);
  assert.equal(fr.calls.put.length, 2);
  assert.equal(fr.calls.remove.length, 1);
  // TOO_LARGE dari host (pemeriksaan maxBytes pluginsync) → galat yang sama dengan penolakan klien
  fr.api.put = () => Promise.reject(Object.assign(new Error("TOO_LARGE: data > 65536 byte"), { code: "TOO_LARGE", detail: "size" }));
  await assert.rejects(store.save(u, 3, "x", BL_DATA, T.BL_NO_SNAP), (e) => e.code === "TOO_LARGE" && e.message === T.MSG_BL_TOO_LARGE);
  // galat lain diteruskan apa adanya
  fr.api.put = () => Promise.reject(Object.assign(new Error("SCOPE_IMMUTABLE"), { code: "SCOPE_IMMUTABLE" }));
  await assert.rejects(store.save(u, 3, "x", BL_DATA, T.BL_NO_SNAP), blCode("SCOPE_IMMUTABLE"));
});

test("baselineStore: batas BL_MAX eksak — 65536 byte boleh, 65537 ditolak 'Baseline terlalu besar' sebelum baca/tulis", async () => {
  assert.equal(T.TLPlan.BL_MAX, 65536);
  assert.equal(T.MSG_BL_TOO_LARGE, "Baseline terlalu besar");
  const fr = fakeRecords();
  const store = T.baselineStore({ records: fr.api });
  const u = blUnit(12, "Alpha");
  const base = T.TLPlan.baselineByteSize({ v: 1, n: 1, name: "", savedAt: BL_DATA.savedAt, by: 7, t: BL_T });
  const fit = "x".repeat(T.TLPlan.BL_MAX - base);
  assert.equal(T.TLPlan.baselineByteSize({ v: 1, n: 1, name: fit, savedAt: BL_DATA.savedAt, by: 7, t: BL_T }), 65536);
  // tepat 65536 (ukuran data YANG DITULIS, termasuk nama dari argumen) → boleh
  await store.save(u, 1, fit, BL_DATA, T.BL_NO_SNAP);
  assert.equal(fr.calls.put.length, 1);
  assert.equal(T.TLPlan.baselineByteSize(fr.calls.put[0][2]), 65536);
  // 65537 → ditolak sebelum get/put
  const gets = fr.calls.get.length;
  await assert.rejects(store.save(u, 2, fit + "x", BL_DATA, T.BL_NO_SNAP), (e) => e.code === "TOO_LARGE" && e.message === "Baseline terlalu besar");
  // multibyte: 2 byte UTF-8 per "é" — ukuran byte, bukan panjang string
  const k = Math.floor((T.TLPlan.BL_MAX - base) / 2);
  const mb = "é".repeat(k) + "x".repeat(T.TLPlan.BL_MAX - base - 2 * k + 1);
  assert.equal(T.TLPlan.baselineByteSize({ v: 1, n: 1, name: mb, savedAt: BL_DATA.savedAt, by: 7, t: BL_T }), 65537);
  await assert.rejects(store.save(u, 2, mb, BL_DATA, T.BL_NO_SNAP), blCode("TOO_LARGE"));
  assert.equal(fr.calls.get.length, gets);
  assert.equal(fr.calls.put.length, 1);
});

test("baselineStore: snap beda → tolak STALE tanpa put (anggota lain menimpa / slot terisi sejak dialog dibuka); snap sama → satu put; snap rusak → INVALID", async () => {
  const fr = fakeRecords();
  const store = T.baselineStore({ records: fr.api });
  const u = blUnit(12, "Alpha");
  putRec(fr, blRec(12, "Alpha", 1));
  const snap1 = (await store.loadAll(u)).get(1).snap; // potret saat dialog dibuka
  assert.deepEqual(snap1, { exists: true, updatedAt: "2026-11-04T03:00:00Z", by: 7 });
  // anggota lain menimpa slot 1 (updated_at baru, by lain) sebelum Simpan ditekan
  putRec(fr, blRec(12, "Alpha", 1, { by: 9 }, { updated_at: "2026-11-05T02:00:00Z" }));
  await assert.rejects(store.save(u, 1, "Timpa", BL_DATA, snap1), (e) => e.code === "STALE");
  // hanya updated_at berubah (by sama) → tetap beda
  putRec(fr, blRec(12, "Alpha", 1, {}, { updated_at: "2026-11-05T03:00:00Z" }));
  await assert.rejects(store.save(u, 1, "Timpa", BL_DATA, snap1), blCode("STALE"));
  // slot kosong saat dialog dibuka, terisi sebelum simpan → STALE (tidak menimpa diam-diam)
  putRec(fr, blRec(12, "Alpha", 2));
  await assert.rejects(store.save(u, 2, "Baru", BL_DATA, T.BL_NO_SNAP), blCode("STALE"));
  // slot terisi saat dialog dibuka, dihapus anggota lain → STALE
  await assert.rejects(store.save(u, 3, "Baru", BL_DATA, snap1), blCode("STALE"));
  assert.equal(fr.calls.put.length, 0, "tidak ada put pada penolakan");
  // potret terbaru (muat ulang) → satu put
  const fresh = (await store.loadAll(u)).get(1).snap;
  await store.save(u, 1, "Timpa", BL_DATA, fresh);
  assert.equal(fr.calls.put.length, 1);
  assert.equal(fr.calls.put[0][2].name, "Timpa");
  // record slot asing (v 2, klien lebih baru) = slot TERISI (fix review T4): potret kosong → STALE (tidak pernah
  // ditimpa diam-diam); potret dari loadAll (dialog menampilkannya terisi + konfirmasi Timpa) → boleh
  putRec(fr, blRec(12, "Alpha", 3, { v: 2 }, { updated_at: "2026-11-04T06:00:00Z" }));
  await assert.rejects(store.save(u, 3, "Baru", BL_DATA, T.BL_NO_SNAP), blCode("STALE"));
  assert.equal(fr.calls.put.length, 1);
  const foreignSnap = (await store.loadAll(u)).get(3).snap;
  assert.deepEqual(foreignSnap, { exists: true, updatedAt: "2026-11-04T06:00:00Z", by: null });
  await store.save(u, 3, "Baru", BL_DATA, foreignSnap);
  assert.equal(fr.calls.put.length, 2);
  assert.equal(fr.calls.put[1][2].v, 1);
  // snap wajib: tidak ada / bukan objek → INVALID tanpa put
  for (const s of [undefined, null, "x"]) await assert.rejects(store.save(u, 2, "x", BL_DATA, s), blCode("INVALID"));
  assert.equal(fr.calls.put.length, 2);
  assert.deepEqual(T.BL_NO_SNAP, { exists: false, updatedAt: null, by: null });
  assert.ok(Object.isFrozen(T.BL_NO_SNAP));
});

test("baselineStore.remove(unit, n, snap): snap beda → STALE tanpa remove; snap sama (termasuk slot asing) → satu remove; tanpa snap → langsung; snap rusak → INVALID", async () => {
  const fr = fakeRecords();
  const store = T.baselineStore({ records: fr.api });
  const u = blUnit(12, "Alpha");
  putRec(fr, blRec(12, "Alpha", 1));
  putRec(fr, blRec(12, "Alpha", 2, { v: 2 }));
  const map = await store.loadAll(u);
  const snap1 = map.get(1).snap;
  // anggota lain menimpa slot 1 sejak dialog dibuka → STALE, record tetap
  putRec(fr, blRec(12, "Alpha", 1, { by: 9 }, { updated_at: "2026-11-05T02:00:00Z" }));
  const gets = fr.calls.get.length;
  await assert.rejects(store.remove(u, 1, snap1), blCode("STALE"));
  assert.equal(fr.calls.get.length, gets + 1, "CAS membaca record slot");
  assert.equal(fr.calls.remove.length, 0);
  assert.ok(fr.store.has("baseline/" + blRec(12, "Alpha", 1).id));
  // slot sudah kosong saat dialog dibuka tetapi kini terisi → STALE
  putRec(fr, blRec(12, "Alpha", 3));
  await assert.rejects(store.remove(u, 3, T.BL_NO_SNAP), blCode("STALE"));
  assert.equal(fr.calls.remove.length, 0);
  // potret terbaru → satu remove
  const fresh = (await store.loadAll(u)).get(1).snap;
  await store.remove(u, 1, fresh);
  assert.deepEqual(fr.calls.remove, [["baseline", blRec(12, "Alpha", 1).id]]);
  // slot asing: potret loadAll → boleh dihapus
  await store.remove(u, 2, map.get(2).snap);
  assert.equal(fr.calls.remove.length, 2);
  // snap tidak diberikan → hapus langsung (tanpa baca)
  const g2 = fr.calls.get.length;
  await store.remove(u, 3);
  assert.equal(fr.calls.remove.length, 3);
  assert.equal(fr.calls.get.length, g2);
  // snap rusak → INVALID tanpa baca/hapus
  for (const s of [null, "x", 5]) await assert.rejects(store.remove(u, 1, s), blCode("INVALID"));
  assert.equal(fr.calls.get.length, g2);
  assert.equal(fr.calls.remove.length, 3);
  assert.equal(fr.calls.put.length, 0);
});

test("useBaselines kunci workspace: belum loaded/pulled → terkunci + teks 'Menunggu data baseline workspace…'; record lokal ada → slot itu terbuka; pulled → semua terbuka; project pribadi tidak", () => withEngineClock(async (clock) => {
  assert.equal(T.MSG_BL_WAIT, "Menunggu data baseline workspace…");
  const fr = fakeRecords();
  putRec(fr, blRec(12, "Alpha", 1));
  putRec(fr, blRec(12, "Alpha", 3, { v: 2 })); // record asing = ada secara lokal → slot 3 tidak menunggu
  const { api } = fakeApi({ records: fr });
  const m = mount((p) => T.useBaselines(p.api, p.unit));
  const unit = blUnit(12, "Alpha");
  let r = m.render({ api, unit });
  // memuat: semua slot terkunci TANPA teks tunggu (pola P3 a)
  assert.equal(r.loaded, false);
  for (const n of [1, 2, 3]) { assert.equal(r.lockedOf(n), true); assert.equal(r.waitingOf(n), false); }
  assert.equal(r.waiting, false);
  m.flush();
  await settle();
  assert.equal(fr.calls.list.length, 1, "muat pertama saat pasang tanpa debounce");
  r = m.render({ api, unit });
  assert.equal(r.loaded, true);
  assert.equal(r.pulled, false);
  assert.deepEqual([...r.bases.keys()].sort(), [1, 3]);
  assert.equal(r.lockedOf(1), false, "record lokal ada → base_version terkirim, boleh timpa (dengan konfirmasi T5)");
  assert.deepEqual(r.snapOf(1), { exists: true, updatedAt: "2026-11-04T03:00:00Z", by: 7 });
  assert.equal(r.lockedOf(3), false, "record asing lokal = terisi");
  assert.equal(r.bases.get(3).foreign, true);
  assert.deepEqual(r.snapOf(3), { exists: true, updatedAt: "2026-11-04T03:00:00Z", by: null });
  for (const n of [2]) { assert.equal(r.lockedOf(n), true); assert.equal(r.waitingOf(n), true); assert.deepEqual(r.snapOf(n), T.BL_NO_SNAP); }
  assert.equal(r.waiting, true);
  // record tiba lewat sinkron biasa (bukan pulled) → muat ulang setelah 300 ms; slot 2 terbuka karena kini ada
  putRec(fr, blRec(12, "Alpha", 2));
  fr.emit({ entity: "baseline", ids: [blRec(12, "Alpha", 2).id], source: "sync" });
  clock.tick(299);
  await settle();
  assert.equal(fr.calls.list.length, 1);
  clock.tick(1);
  await settle();
  r = m.render({ api, unit });
  assert.equal(fr.calls.list.length, 2);
  assert.equal(r.lockedOf(2), false);
  assert.equal(r.waiting, false, "semua slot kini ada secara lokal");
  assert.equal(r.pulled, false, "sync biasa bukan tanda tarik sukses");
  // slot 2 dihapus anggota lain (sync) → kembali menunggu
  fr.store.delete("baseline/" + blRec(12, "Alpha", 2).id);
  fr.emit({ entity: "baseline", ids: [blRec(12, "Alpha", 2).id], source: "sync" });
  clock.tick(300);
  await settle();
  r = m.render({ api, unit });
  assert.equal(r.lockedOf(2), true);
  assert.equal(r.waitingOf(2), true);
  // entitas lain tidak memuat ulang baseline
  fr.emit({ entity: "project", ids: ["prj@list:12:-"], source: "sync" });
  clock.tick(300);
  await settle();
  assert.equal(fr.calls.list.length, 3);
  // tarik sukses → muat ulang SEGERA, lalu latch menyala → semua slot terbuka, teks hilang
  fr.emit(PULLED);
  await settle();
  r = m.render({ api, unit });
  assert.equal(fr.calls.list.length, 4);
  assert.equal(r.pulled, true);
  for (const n of [1, 2, 3]) { assert.equal(r.lockedOf(n), false); assert.equal(r.waitingOf(n), false); }
  assert.equal(r.waiting, false);
  m.unmount();
  assert.equal(fr.listenerCount(), 0);

  // halaman project pribadi: setelah muat tidak pernah terkunci, meski tanpa record dan tanpa pulled
  const m2 = mount((p) => T.useBaselines(p.api, p.unit));
  const pu = blUnit(null, "Rumah");
  m2.render({ api, unit: pu });
  m2.flush();
  await settle();
  r = m2.render({ api, unit: pu });
  assert.equal(r.loaded, true);
  assert.equal(r.pulled, false);
  for (const n of [1, 2, 3]) { assert.equal(r.lockedOf(n), false); assert.equal(r.waitingOf(n), false); }
  m2.unmount();

  // muat gagal (ruling review T4): workspace sebelum pulled → TETAP terkunci + teks tunggu; pulled lalu muat ulang
  // gagal lagi → latch tetap menyala → terbuka (tidak terkunci selamanya); pribadi gagal → terbuka.
  const fr3 = fakeRecords();
  fr3.api.list = () => Promise.reject(new Error("idb"));
  const h3 = fakeApi({ records: fr3 });
  const m3 = mount((p) => T.useBaselines(p.api, p.unit));
  m3.render({ api: h3.api, unit });
  m3.flush();
  await settle();
  r = m3.render({ api: h3.api, unit });
  assert.equal(r.failed, true);
  assert.equal(r.loaded, false);
  for (const n of [1, 2, 3]) { assert.equal(r.lockedOf(n), true, "workspace gagal sebelum pulled"); assert.equal(r.waitingOf(n), true); }
  assert.equal(r.waiting, true);
  assert.equal(h3.calls.warn.length, 1);
  fr3.emit(PULLED);
  await settle();
  r = m3.render({ api: h3.api, unit });
  assert.equal(h3.calls.warn.length, 2, "muat ulang sesudah pulled juga gagal");
  assert.equal(r.failed, true);
  assert.equal(r.pulled, true, "latch menyala walau muat ulang gagal");
  for (const n of [1, 2, 3]) { assert.equal(r.lockedOf(n), false); assert.equal(r.waitingOf(n), false); }
  m3.unmount();
  const fr5 = fakeRecords();
  fr5.api.list = () => Promise.reject(new Error("idb"));
  const h5 = fakeApi({ records: fr5 });
  const m5 = mount((p) => T.useBaselines(p.api, p.unit));
  m5.render({ api: h5.api, unit: pu });
  m5.flush();
  await settle();
  r = m5.render({ api: h5.api, unit: pu });
  assert.equal(r.failed, true);
  assert.equal(r.pulled, false);
  for (const n of [1, 2, 3]) { assert.equal(r.lockedOf(n), false, "pribadi gagal → terbuka"); assert.equal(r.waitingOf(n), false); }
  m5.unmount();
  const m4 = mount((p) => T.useBaselines(p.api, p.unit));
  r = m4.render({ api, unit: null });
  m4.flush();
  await settle();
  r = m4.render({ api, unit: null });
  for (const n of [1, 2, 3]) assert.equal(r.lockedOf(n), true);
  assert.equal(r.bases.size, 0);
  m4.unmount();
  assert.equal(fr.calls.put.length + fr.calls.remove.length + fr3.calls.put.length + fr3.calls.remove.length + fr5.calls.put.length, 0, "hook tidak pernah menulis");
}));

test("useEngine: render pertama status loading tanpa memanggil TLCpm.run (spy); setelah raf + setTimeout palsu → ready; scopeTasks identitas sama → tidak muat ulang; berubah / sync.done → satu muat ulang setelah 300 ms (dua kejadian beruntun = satu)", () => withEngineClock(async (clock) => {
  const a = mk(1, "A", { start: "2026-11-02", duration: 2 });
  const b = mk(2, "B", { duration: 1, deps: [{ t: { $task: 1 }, type: "FS", lag: 0 }] });
  const outside = mk(3, "Luar", { start: "2026-11-02", duration: 1 }, { project: "Lain" }); // scope lain → disaring
  let list = [a, b, outside];
  const { api, calls } = fakeApi();
  let listCalls = 0;
  api.data = { tasks: { list: (q) => { listCalls += 1; assert.deepEqual(q, { includeDone: true }); return Promise.resolve(list); } } };
  const units = new Map([[T.TLSched.unitOf(a).recId, { auto: true, by: 7, updatedAt: null, pending: false, exists: true }]]);
  const scope = [a, b];
  const opts = { scopeTasks: scope, calData: T.TLCal.normalize(T.TLCal.DEFAULT_CAL), units };
  const spy = spyRun();
  const writes = spyWrites(api);
  try {
    const Hook = (p) => T.useEngine(p.api, p.opts);
    const m = mount(Hook);
    let r = m.render({ api, opts });
    assert.equal(r.status, "loading");
    assert.equal(r.result, null);
    assert.equal(spy.runs.length, 0, "render pertama tanpa mesin");
    m.flush();
    assert.equal(listCalls, 1, "daftar lengkap dimuat saat pasang (tanpa debounce)");
    await settle();
    r = m.render({ api, opts });
    assert.equal(r.status, "loading");
    m.flush();
    assert.equal(spy.runs.length, 0, "mesin belum jalan sebelum gambar pertama (raf)");
    assert.equal(clock.frames(), 1);
    assert.equal(spy.runs.length, 0, "raf hanya menjadwalkan setTimeout 0");
    clock.tick(0);
    assert.equal(spy.runs.length, 1);
    r = m.render({ api, opts });
    assert.equal(r.status, "ready");
    assert.deepEqual(r.tasks.map((t) => t.id), [1, 2], "hanya task se-scope (scopeKeyOf) dari daftar lengkap");
    assert.ok(r.result.drift.has("2"), "B otomatis tanpa Mulai → drift");
    assert.equal(T.TLCal.iso(r.result.nodes.get("2").es), "2026-11-04");
    // masukan mesin diteruskan untuk explain/TLPlan: readExt + kalender terkompilasi yang sama
    assert.equal(r.ctx.readExt, r.rawOf);
    assert.equal(r.ctx.units, units);
    assert.equal(spy.runs[0].ctx.cal, r.ctx.cal);
    assert.deepEqual(r.rawOf(b), { duration: 1, deps: [{ t: { $task: 1 }, type: "FS", lag: 0 }] });
    // rerun(patches) → hasil baru tanpa menulis
    const moved = r.rerun([{ task: a, patch: { start: "2026-11-09" } }]);
    assert.equal(T.TLCal.iso(moved.nodes.get("2").es), "2026-11-11");
    const runsAfterRerun = spy.runs.length;

    // identitas scopeTasks sama (context baru) → tidak memuat ulang
    m.render({ api, opts: Object.assign({}, opts) });
    m.flush();
    clock.tick(1000);
    await settle();
    assert.equal(listCalls, 1);

    // identitas berubah (isi sama) → satu muat ulang setelah 300 ms; data identik → memo, mesin tidak jalan ulang
    const opts2 = Object.assign({}, opts, { scopeTasks: scope.slice() });
    m.render({ api, opts: opts2 });
    m.flush();
    clock.tick(299);
    assert.equal(listCalls, 1);
    clock.tick(1);
    assert.equal(listCalls, 2);
    await settle();
    m.render({ api, opts: opts2 });
    m.flush();
    clock.frames();
    clock.tick(0);
    assert.equal(spy.runs.length, runsAfterRerun, "engineKey sama → tidak dihitung ulang");

    // sync.done dua kali beruntun → satu muat ulang 300 ms setelah yang terakhir
    list = [a, mk(2, "B", { duration: 3, deps: [{ t: { $task: 1 }, type: "FS", lag: 0 }] }), outside];
    const fire = () => { for (const f of calls.handlers["sync.done"] || []) f({ initial: false }); };
    assert.equal((calls.handlers["sync.done"] || []).length, 1);
    fire();
    clock.tick(200);
    fire();
    clock.tick(299);
    assert.equal(listCalls, 2);
    clock.tick(1);
    assert.equal(listCalls, 3);
    await settle();
    r = m.render({ api, opts: opts2 });
    assert.equal(r.status, "ready", "hasil lama tetap dipakai sampai hasil baru siap");
    m.flush();
    clock.frames();
    clock.tick(0);
    r = m.render({ api, opts: opts2 });
    assert.equal(r.result.nodes.get("2").d, 3, "data baru → mesin jalan ulang");

    // scopeTasks berubah + sync.done beruntun = satu muat ulang
    const opts3 = Object.assign({}, opts, { scopeTasks: scope.slice() });
    m.render({ api, opts: opts3 });
    m.flush();
    clock.tick(100);
    fire();
    clock.tick(300);
    assert.equal(listCalls, 4);
    clock.tick(1000);
    assert.equal(listCalls, 4);
    await settle();

    // hanya jawaban terbaru yang dipakai
    let release = null;
    api.data.tasks.list = () => { listCalls += 1; return listCalls === 5 ? new Promise((res) => { release = res; }) : Promise.resolve([a, b]); };
    fire();
    clock.tick(300);
    fire();
    clock.tick(300);
    await settle();
    release([a]);
    await settle();
    m.render({ api, opts: opts3 });
    m.flush();
    clock.frames();
    clock.tick(0);
    r = m.render({ api, opts: opts3 });
    assert.deepEqual(r.tasks.map((t) => t.id), [1, 2], "jawaban lama yang datang belakangan dibuang");

    m.unmount();
    assert.equal((calls.handlers["sync.done"] || []).length, 0, "pendengar dilepas");
    fire();
    clock.tick(1000);
    assert.equal(listCalls, 6, "tanpa muat ulang setelah dilepas");
    assert.deepEqual(writes, [], "hook tidak pernah menulis");
  } finally {
    spy.restore();
  }
}));

test("1c-2: useEngine — suntingan HANYA actual ({actual:{start}}) → engineKey berubah, mesin jalan ulang sekali (debounce)", () => withEngineClock(async (clock) => {
  const a = mk(1, "A", { start: "2026-11-09", duration: 2 });
  const b = mk(2, "B", { duration: 1, deps: [{ t: { $task: 1 }, type: "FS", lag: 0 }] });
  const rd = (t) => { const o = {}; for (const k of Object.keys(t.ext)) o[k.slice(9)] = t.ext[k]; return o; };
  const a2 = mk(1, "A", { start: "2026-11-09", duration: 2, actual: { start: "2026-11-02" } });
  assert.notEqual(T.engineKeyOf([a2, b], rd), T.engineKeyOf([a, b], rd), "kunci memuat actual");
  let list = [a, b];
  const { api, calls } = fakeApi();
  api.data = { tasks: { list: () => Promise.resolve(list) } };
  const units = new Map([[T.TLSched.unitOf(a).recId, { auto: true, by: 7, updatedAt: null, pending: false, exists: true }]]);
  const opts = { scopeTasks: [a, b], calData: T.TLCal.normalize(T.TLCal.DEFAULT_CAL), units };
  const spy = spyRun();
  try {
    const m = mount((p) => T.useEngine(p.api, p.opts));
    m.render({ api, opts });
    m.flush();
    await settle();
    m.render({ api, opts });
    m.flush();
    clock.frames();
    clock.tick(0);
    let r = m.render({ api, opts });
    assert.equal(r.status, "ready");
    assert.equal(spy.runs.length, 1);
    assert.equal(T.TLCal.iso(r.result.nodes.get("2").es), "2026-11-11");
    list = [a2, b];
    for (const f of calls.handlers["sync.done"] || []) f({ initial: false });
    clock.tick(300);
    await settle();
    m.render({ api, opts });
    m.flush();
    clock.frames();
    clock.tick(0);
    r = m.render({ api, opts });
    assert.equal(spy.runs.length, 2, "satu kali jalan ulang");
    assert.equal(r.result.nodes.get("1").fixed, "started");
    assert.equal(T.TLCal.iso(r.result.nodes.get("2").es), "2026-11-04", "penerus mengikuti jangkar actual.start");
    m.unmount();
  } finally {
    spy.restore();
  }
}));

test("useEngine: daftar gagal dimuat sebelum ada hasil → status error, tanpa mesin dan tanpa tulis", () => withEngineClock(async (clock) => {
  const { api, calls } = fakeApi();
  api.data = { tasks: { list: () => Promise.reject(new Error("offline")) } };
  const writes = spyWrites(api);
  const spy = spyRun();
  try {
    const m = mount((p) => T.useEngine(p.api, p.opts));
    const opts = { scopeTasks: [mk(1, "A", {})], calData: T.TLCal.normalize(T.TLCal.DEFAULT_CAL), units: new Map() };
    m.render({ api, opts });
    m.flush();
    await settle();
    m.render({ api, opts });
    m.flush();
    clock.frames();
    clock.tick(0);
    const r = m.render({ api, opts });
    assert.equal(r.status, "error");
    assert.equal(r.result, null);
    assert.equal(spy.runs.length, 0);
    assert.ok(calls.warn.length >= 1);
    assert.deepEqual(writes, []);
    m.unmount();
  } finally {
    spy.restore();
  }
}));

test("muat list: satu commit (spy pola 8c) — setList + setFailed dalam SATU unstable_batchedUpdates; gagal muat juga satu batch", () => withEngineClock(async (clock) => {
  const prev = Object.prototype.hasOwnProperty.call(globalThis, "ReactDOM") ? globalThis.ReactDOM : undefined;
  const had = Object.prototype.hasOwnProperty.call(globalThis, "ReactDOM");
  const log = [];
  let depth = 0;
  globalThis.ReactDOM = { unstable_batchedUpdates: (f) => { log.push("mulai"); depth++; try { f(); } finally { depth--; log.push("selesai"); } } };
  try {
    for (const gagal of [false, true]) {
      log.length = 0;
      const { api } = fakeApi();
      api.data = { tasks: { list: () => (gagal ? Promise.reject(new Error("offline")) : Promise.resolve([mk(1, "A", { start: "2026-11-02", duration: 1 })])) } };
      const m = mount((p) => T.useEngine(p.api, p.opts));
      const opts = { scopeTasks: [mk(1, "A", { start: "2026-11-02", duration: 1 })], calData: T.TLCal.normalize(T.TLCal.DEFAULT_CAL), units: new Map() };
      m.render({ api, opts });
      const n0 = m.setCalls.length;
      let dalamBatch = 0;
      const base = m.setCalls;
      // setState selama muat harus terjadi di dalam batch: periksa lewat kedalaman saat setCalls bertambah
      const push = base.push.bind(base);
      base.push = (k) => { if (depth > 0) dalamBatch++; return push(k); };
      m.flush();
      await settle();
      assert.deepEqual(log, ["mulai", "selesai"], (gagal ? "gagal" : "sukses") + ": tepat satu batch");
      assert.ok(m.setCalls.length > n0 && dalamBatch === m.setCalls.length - n0, "semua setState muat berada di dalam batch");
      m.unmount();
    }
  } finally {
    if (had) globalThis.ReactDOM = prev; else delete globalThis.ReactDOM;
  }
}));

// 1c-2 T9: panah kritis hanya sisi PENGARAH. P dan Q sama-sama mendahului B (tenggat menjadikan semuanya slack 0);
// urutan deps [P, Q] → driver B = P (seri → urutan deps tersimpan). Panah Q→B antar dua kritis tetapi non-pengarah.
test("panah antara dua kritis non-pengarah → tanpa is-critical; pengarah → is-critical", () => withEngineClock(async (clock) => {
  const al = { project: "Alpha" };
  const tasks = [
    mk(1, "P", { start: "2026-11-02", duration: 2 }, al),
    mk(2, "Q", { start: "2026-11-02", duration: 2 }, al),
    mk(3, "B", { start: "2026-11-04", duration: 2, deps: [{ t: { $task: 1 }, type: "FS", lag: 0 }, { t: { $task: 2 }, type: "FS", lag: 0 }] }, Object.assign({ deadline: "2026-11-05" }, al)),
  ];
  const { m, tree } = await critView(clock, { tasks, storageGet: (k) => Promise.resolve(k === "crit:proj_Alpha" ? true : null) });
  try {
    for (const k of ["1", "2", "3"]) assert.ok(hasCls(barOf(tree, k), "is-critical"), "simpul " + k + " kritis");
    assert.ok(arrowOf(tree, "1", "3"), "panah P→B ada");
    assert.ok(arrowOf(tree, "2", "3"), "panah Q→B ada");
    assert.ok(hasCls(arrowOf(tree, "1", "3"), "is-critical"), "pengarah (P→B) is-critical");
    assert.equal(hasCls(arrowOf(tree, "2", "3"), "is-critical"), false, "non-pengarah (Q→B) antar dua kritis → tanpa is-critical");
  } finally {
    m.unmount();
  }
}));

// Satu putaran penuh view: render → efek → janji → raf → timer (debounce 300 ms + setTimeout 0), beberapa kali.
async function settleView(m, getProps, clock) {
  for (let i = 0; i < 4; i++) {
    m.render(getProps());
    m.flush();
    await settle();
    clock.frames();
    clock.tick(300);
    await settle();
  }
  return m.render(getProps());
}

test("task pindah ke project lain / project diganti nama → unitOf baru tanpa record → mode efektif manual, 0 tulis", () => withEngineClock(async (clock) => {
  const fr = fakeRecords();
  putRec(fr, unitRec(12, "Alpha"));
  const a = mk(1, "A", { start: "2026-11-02", duration: 2 }, { list_id: 12, project: "Alpha" });
  const b = mk(2, "B", { start: "2026-11-02", duration: 1, deps: [{ t: { $task: 1 }, type: "FS", lag: 0 }] }, { list_id: 12, project: "Alpha" });
  let list = [a, b];
  const { api } = fakeApi({ records: fr });
  api.data = { tasks: { list: () => Promise.resolve(list) } };
  const writes = spyWrites(api);
  const spy = spyRun();
  try {
    const base = ctxOf(list, { page: "slist_12", pageKind: "workspace", listId: 12, projectName: null }).ctx;
    let props = { context: base, api };
    const m = mount(T.TimelineViewBody);
    await settleView(m, () => props, clock);
    const last = () => spy.runs[spy.runs.length - 1].result;
    assert.equal(last().nodes.get("2").mode, "auto");
    assert.ok(last().drift.has("2"), "B otomatis → hasil hitung Rab 4 Nov ≠ Mulai tersimpan");
    const as = (project) => {
      list = [Object.assign({}, a, { project }), Object.assign({}, b, { project })];
      props = { context: Object.assign({}, base, { tasks: list, scopeTasks: list }), api };
    };
    // pindah ke project lain tanpa record
    as("Beta");
    await settleView(m, () => props, clock);
    assert.equal(last().nodes.get("2").mode, "manual");
    assert.equal(last().drift.size, 0);
    // hanya huruf besar A–Z → lipatan sama (projectFold) → unit sama, tetap otomatis
    as("ALPHA");
    await settleView(m, () => props, clock);
    assert.equal(last().nodes.get("2").mode, "auto");
    // diganti nama → unit baru tanpa record → Manual
    as("Alpha 2");
    await settleView(m, () => props, clock);
    assert.equal(last().nodes.get("2").mode, "manual");
    assert.deepEqual(writes, []);
    assert.equal(fr.calls.put.length, 0, "unit hilang tidak 'diperbaiki' dengan menulis record");
    m.unmount();
    // langsung: unitOf baru tidak ada di Map → modeOf manual
    const units = await T.projectStore({ records: fr.api }).loadUnits({ pageKind: "workspace", listId: 12 });
    const moved = Object.assign({}, a, { project: "Beta" });
    assert.equal(units.has(T.TLSched.unitOf(moved).recId), false);
    assert.equal(T.TLSched.modeOf({}, units, moved), "manual");
    assert.equal(T.TLSched.modeOf({}, units, a), "auto");
  } finally {
    spy.restore();
  }
}));

test("spy taskExt.set/setMany + records.put/remove = 0 (view + useBaselines terpasang, record baseline ada) setelah: mount view workspace 500 task dengan drift > 0, sync.done, onChange project dari sync, onChange baseline, pulled, env.today berubah + rerender, kalender berubah, scopeTasks baru", () => withEngineClock(async (clock) => {
  const tasks = bigTasks(500, 400).map((t) => Object.assign({}, t, { list_id: 12 }));
  const fr = fakeRecords();
  for (let i = 0; i < 5; i++) putRec(fr, unitRec(12, "P" + i)); // semua project otomatis
  // 1c-2 Task 4: baseline unit P0 ada (slot 1, 2) + baselineStore terpasang (useBaselines) bersama view
  putRec(fr, blRec(12, "P0", 1));
  putRec(fr, blRec(12, "P0", 2, { name: "Revisi" }));
  const blU = blUnit(12, "P0");
  let blState = null;
  const ViewBl = (p) => { blState = T.useBaselines(p.api, blU); return T.TimelineViewBody(p); };
  const { api, calls } = fakeApi({ records: fr });
  let listCalls = 0;
  api.data = { tasks: { list: () => { listCalls += 1; return Promise.resolve(tasks); } } };
  const writes = spyWrites(api);
  const spy = spyRun();
  try {
    const base = ctxOf(tasks, { page: "slist_12", pageKind: "workspace", listId: 12, projectName: null }).ctx;
    let props = { context: base, api };
    const m = mount(ViewBl);
    const tree0 = m.render(props);
    assert.equal(spy.runs.length, 0, "render awal view tidak menunggu mesin");
    assert.ok(nodes(tree0, (n) => n.props.role === "grid").length === 1);
    await settleView(m, () => props, clock);
    assert.equal(spy.runs.length, 1);
    const res = spy.runs[0].result;
    assert.ok(res.drift.size > 0, "drift: " + res.drift.size);
    assert.ok([...res.nodes.values()].some((n) => n.mode === "auto"));
    const ok = (step) => {
      assert.deepEqual(writes, [], step + ": taskExt");
      assert.equal(fr.calls.put.length, 0, step + ": records.put");
      assert.equal(fr.calls.remove.length, 0, step + ": records.remove");
    };
    assert.deepEqual([...blState.bases.keys()].sort(), [1, 2], "baseline termuat");
    ok("mount");
    // sinkron selesai
    for (const f of calls.handlers["sync.done"] || []) f({ initial: false });
    await settleView(m, () => props, clock);
    assert.ok(listCalls >= 2, "sync.done memuat ulang daftar");
    ok("sync.done");
    // anggota lain mematikan satu unit (onChange project dari sinkron)
    putRec(fr, unitRec(12, "P0", { auto: false }));
    fr.emit({ entity: "project", ids: [unitRec(12, "P0").id], source: "sync" });
    const before = spy.runs.length;
    await settleView(m, () => props, clock);
    assert.equal(spy.runs.length, before + 1, "unit berubah → mesin jalan ulang");
    ok("onChange project");
    // baseline berubah dari sinkron (anggota lain menimpa slot 2, menghapus slot 1)
    putRec(fr, blRec(12, "P0", 2, { name: "Revisi 2", by: 9 }, { updated_at: "2026-11-05T02:00:00Z" }));
    fr.store.delete("baseline/" + blRec(12, "P0", 1).id);
    fr.emit({ entity: "baseline", ids: [blRec(12, "P0", 1).id, blRec(12, "P0", 2).id], source: "sync", lost: [blRec(12, "P0", 2).id] });
    await settleView(m, () => props, clock);
    assert.deepEqual([...blState.bases.keys()], [2]);
    assert.equal(blState.bases.get(2).name, "Revisi 2");
    ok("onChange baseline");
    fr.emit(PULLED);
    await settleView(m, () => props, clock);
    assert.equal(blState.pulled, true);
    ok("pulled");
    // env.today berubah + rerender (plugin tidak berlangganan app.dayChanged: hari dibaca dari api.env.today tiap render)
    api.env.today = () => "2026-11-05";
    assert.equal((calls.handlers["app.dayChanged"] || []).length, 0, "tidak ada pendengar app.dayChanged");
    await settleView(m, () => props, clock);
    ok("env.today berubah + rerender");
    // kalender workspace berubah (sinkron)
    fr.store.set("calendar/cal@list:12", WS_REC([1, 2, 3, 4, 5, 6]));
    const beforeCal = spy.runs.length;
    fr.emit({ entity: "calendar", ids: ["cal@list:12"], source: "sync" });
    await settleView(m, () => props, clock);
    assert.equal(spy.runs.length, beforeCal + 1, "kalender berubah → mesin jalan ulang");
    assert.ok(spy.runs[spy.runs.length - 1].result.drift.size > 0);
    ok("kalender berubah");
    // scopeTasks baru (host memperbarui allTasks)
    const beforeList = listCalls;
    props = { context: Object.assign({}, base, { scopeTasks: tasks.slice() }), api };
    await settleView(m, () => props, clock);
    assert.equal(listCalls, beforeList + 1);
    ok("scopeTasks baru");
    m.unmount();
    clock.tick(5000);
    await settle();
    ok("lepas");
  } finally {
    spy.restore();
  }
}));

// Pagar sumber R25: AST plugin.js (build) — setiap akses taskExt.set / taskExt.setMany / records.put / records.remove
// berada di dalam badan fungsi bernama issue|issueMany|write|writeMany|setAuto|save|saveBaseline (1c-2 Task 4: +saveBaseline,
// dan records.remove ikut dipagari sejak ada pemanggilnya); tanpa alias (`const te = api.taskExt`), akses
// terhitung (`api["taskExt"]`), atau destrukturisasi yang bisa melewati pagar.
// 1c-2 Task 8: +recordActual — satu-satunya penulis OTOMATIS (dipicu event host gestur lokal pomodoro.ended/task.completed,
// "isi bila kosong" {actual:{start}}); spy perilaku memastikan sync.done/pulled/onChange/refresh tetap 0 tulis.
// 1d-1 Task 2: +saveResource — satu-satunya records.put record `resource` (tombol Simpan editor kapasitas/cuti, K27/R25);
// spy perilaku Beban Tim (panel terbuka, sync.done/pulled/onChange resource/app.dayChanged) tetap 0 tulis.
const FENCE_ALLOW = new Set(["issue", "issueMany", "write", "writeMany", "setAuto", "save", "saveBaseline", "recordActual", "saveResource"]);
function fenceScan(code) {
  const parser = require("@babel/parser");
  const ast = parser.parse(code, { sourceType: "script" });
  const hits = [];
  const bad = [];
  const keyName = (k) => (k && k.type === "Identifier" ? k.name : k && k.type === "StringLiteral" ? k.value : null);
  const fnName = (node, parent) => {
    if (node.id && node.id.name) return node.id.name;
    if (node.type === "ObjectMethod" || node.type === "ClassMethod") return keyName(node.key);
    if (parent && parent.type === "VariableDeclarator" && parent.init === node) return keyName(parent.id);
    if (parent && parent.type === "ObjectProperty" && parent.value === node) return keyName(parent.key);
    if (parent && parent.type === "AssignmentExpression" && parent.right === node) {
      return parent.left.type === "MemberExpression" ? keyName(parent.left.property) : keyName(parent.left);
    }
    return "(anonim)";
  };
  const GUARDED = new Set(["taskExt", "records"]);
  const line = (n) => (n.loc ? n.loc.start.line : 0);
  function walk(node, parent, names) {
    if (!node || typeof node.type !== "string") return;
    let inner = names;
    if (/Function|Method/.test(node.type) && node.body) inner = names.concat([fnName(node, parent)]);
    if (node.type === "MemberExpression") {
      const prop = node.computed ? (node.property.type === "StringLiteral" ? node.property.value : null) : keyName(node.property);
      if (GUARDED.has(prop)) {
        const used = parent && parent.type === "MemberExpression" && parent.object === node && !parent.computed;
        if (node.computed || !used) bad.push("alias/terhitung " + prop + " baris " + line(node));
      }
      const obj = node.object;
      const owner = obj.type === "MemberExpression" && !obj.computed ? keyName(obj.property) : obj.type === "Identifier" ? obj.name : null;
      if (GUARDED.has(owner) && node.computed) bad.push("akses terhitung pada " + owner + " baris " + line(node));
      if (!node.computed && ((owner === "taskExt" && (prop === "set" || prop === "setMany")) || (owner === "records" && (prop === "put" || prop === "remove")))) {
        const fn = names.filter((n) => FENCE_ALLOW.has(n));
        hits.push({ call: owner + "." + prop, fn: fn.length ? fn[fn.length - 1] : null, line: line(node) });
        if (!fn.length) bad.push(owner + "." + prop + " di luar daftar-izin (" + names.join(" > ") + ") baris " + line(node));
      }
    }
    if (node.type === "ObjectPattern") {
      for (const p of node.properties) if (p.type === "ObjectProperty" && GUARDED.has(keyName(p.key))) bad.push("destrukturisasi " + keyName(p.key) + " baris " + line(node));
    }
    for (const k of Object.keys(node)) {
      if (k === "loc" || k === "start" || k === "end" || k === "extra" || k === "leadingComments" || k === "trailingComments") continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const c of v) walk(c, node, inner); } else if (v && typeof v.type === "string") walk(v, node, inner);
    }
  }
  walk(ast, null, []);
  return { hits, bad };
}

test("sumber plugin.js: setiap 'taskExt.set(' / 'taskExt.setMany(' / 'records.put(' / 'records.remove(' berada di dalam fungsi issue|issueMany|write|writeMany|setAuto|save|saveBaseline|recordActual|saveResource", () => {
  // pagar memeriksa dirinya sendiri: pelanggaran sintetis harus tertangkap, pola sah tidak
  const caught = (src) => fenceScan(src).bad.length > 0;
  assert.ok(caught("function useX(api) { api.records.put('project', 'x', {}, {}); }"), "fungsi lain");
  assert.ok(caught("function useX(api) { React.useEffect(() => { api.taskExt.setMany([]); }); }"), "efek");
  assert.ok(caught("const s = { load(api) { return api.taskExt.set(1, {}); } };"), "metode lain");
  assert.ok(caught("function f(api) { const te = api.taskExt; te.set(1, {}); }"), "alias");
  assert.ok(caught("function f(api) { api['taskExt'].set(1, {}); }"), "terhitung");
  assert.ok(caught("function f(api) { const { records } = api; records.put('a'); }"), "destrukturisasi");
  assert.ok(caught("function f(api) { api.records['put']('a'); }"), "metode terhitung");
  assert.ok(caught("const s = { remove(api) { return api.records.remove('baseline', 'b'); } };"), "records.remove di luar daftar-izin");
  assert.ok(caught("function useBaselines(api) { React.useEffect(() => { api.records.remove('baseline', 'b'); }); }"), "records.remove di efek");
  assert.ok(caught("function install(api) { api.events.on('sync.done', () => api.taskExt.set(1, {actual: {}})); }"), "pendengar event di luar recordActual");
  assert.ok(caught("function recordActuals(api) { api.taskExt.set(1, {}); }"), "nama mirip bukan daftar-izin");
  // 1d-1 Task 2: tulis record resource dari efek hook pemuat → tertangkap; nama mirip saveResource juga
  assert.ok(caught("function useResources(api) { React.useEffect(() => { api.records.put('resource', 'r', {}, {}); }); }"), "records.put resource di efek useResources");
  assert.ok(caught("function saveResources(api) { return api.records.put('resource', 'r', {}, {}); }"), "nama mirip saveResource bukan daftar-izin");
  assert.equal(fenceScan("function saveResource(api) { return api.records.put('resource','r',{}, {}); }").bad.length, 0, "pola sah saveResource");
  assert.deepEqual(fenceScan("function saveResource(api) { return api.records.put('resource','r',{}, {}); }").hits.map((h) => h.fn + ":" + h.call), ["saveResource:records.put"]);
  const okSrc = "function issue(api) { const send = () => api.taskExt.setMany([]); return send() || api.taskExt.set(1, {}); }" +
    "const o = { save(api) { return api.records.put('calendar', 'c', {}, {}); }, setAuto(api) { return api.records.put('project', 'p', {}, {}); } };" +
    "function S(api) { const write = (p) => api.taskExt.set(1, p); return write; }" +
    "function B(api) { function saveBaseline(op) { return op ? api.records.remove('baseline', 'b') : Promise.resolve().then(() => api.records.put('baseline', 'b', {}, {})); } return { save: () => saveBaseline(0) }; }";
  const okScan = fenceScan(okSrc);
  assert.deepEqual(okScan.bad, []);
  assert.equal(okScan.hits.length, 7);
  assert.deepEqual(okScan.hits.slice(5).map((h) => h.fn + ":" + h.call), ["saveBaseline:records.remove", "saveBaseline:records.put"]);

  const code = fs.readFileSync(path.join(dir, "plugin.js"), "utf8");
  const { hits, bad } = fenceScan(code);
  assert.deepEqual(bad, []);
  // setiap titik tulis yang ada sekarang (tambahan baru harus melewati daftar-izin dan memperbarui tes ini)
  const per = {};
  for (const h of hits) per[h.fn + ":" + h.call] = (per[h.fn + ":" + h.call] || 0) + 1;
  assert.deepEqual(per, {
    "issue:taskExt.setMany": 1, "issue:taskExt.set": 1, "write:taskExt.set": 1, "issueMany:taskExt.setMany": 1,
    "writeMany:taskExt.setMany": 1, // 1c-1 Task 11: tulis massal seksi Jadwal (Mode, Perbarui, Urungkan)
    "save:records.put": 1, "setAuto:records.put": 1,
    "saveBaseline:records.put": 1, "saveBaseline:records.remove": 1, // 1c-2 Task 4: simpan/hapus baseline (K41)
    "recordActual:taskExt.set": 1, // 1c-2 Task 8: catat mulai aktual dari pomodoro.ended/task.completed (K42 diamandemen)
    "saveResource:records.put": 1, // 1d-1 Task 2: simpan kapasitas/cuti (record resource, tombol Simpan)
  });
  // regex mentah tetap cocok dengan jumlah hit AST (tidak ada pemanggilan yang luput dari parser)
  const raw = (code.match(/taskExt\.set\(|taskExt\.setMany\(|records\.put\(|records\.remove\(/g) || []).length;
  assert.equal(raw, hits.length);
});

// ── Fix review Task 6: pagar fold unit di jalur lookup, potong nama simetris sadar surrogate ─────────────────────
test("pagar fold unit: entri Map dengan fold beda dari project task (tabrakan fnv1a32) → mode efektif manual / unitFor null, 0 tulis", () => withEngineClock(async (clock) => {
  const S = T.TLSched;
  const p = mk(1, "P", { start: "2026-11-02", duration: 2 }, { list_id: 12, project: "Proyek P" });
  const q = mk(2, "Q", { duration: 1, deps: [{ t: { $task: 1 }, type: "FS", lag: 0 }] }, { list_id: 12, project: "Proyek P" });
  const rec = S.unitOf(p).recId;
  const unit = (fold) => ({ auto: true, by: 7, updatedAt: "2026-11-03T02:00:00Z", pending: false, exists: true, fold });
  // fold cocok → otomatis; fold milik project lain (hash sama) → tidak ada / Manual
  const okUnits = new Map([[rec, unit("proyek p")]]);
  const clash = new Map([[rec, unit("proyek q")]]);
  assert.equal(S.unitFor(okUnits, p), okUnits.get(rec));
  assert.equal(S.modeOf({}, okUnits, p), "auto");
  assert.equal(S.unitFor(clash, p), null);
  assert.equal(S.modeOf({}, clash, p), "manual");
  assert.equal(S.modeOf({ mode: "auto" }, clash, p), "auto", "mode tersimpan tetap menang");
  assert.deepEqual(T.TLPlan.modePatch(p, clash, "manual"), { mode: null }, "unit tabrakan = Manual → pilihan Manual ikut project");
  assert.deepEqual(T.TLPlan.modePatch(p, okUnits, "manual"), { mode: "manual" });
  // mesin lewat useEngine: Q tidak terjadwal otomatis, tanpa drift, tanpa tulis
  const { api } = fakeApi();
  api.data = { tasks: { list: () => Promise.resolve([p, q]) } };
  const writes = spyWrites(api);
  const spy = spyRun();
  try {
    const m = mount((x) => T.useEngine(x.api, x.opts));
    const opts = { scopeTasks: [p, q], calData: T.TLCal.normalize(T.TLCal.DEFAULT_CAL), units: clash };
    for (let i = 0; i < 3; i++) { m.render({ api, opts }); m.flush(); await settle(); clock.frames(); clock.tick(0); }
    const r = m.render({ api, opts });
    assert.equal(r.status, "ready");
    assert.equal(r.result.nodes.get("1").mode, "manual");
    assert.equal(r.result.drift.size, 0);
    assert.deepEqual(writes, []);
    m.unmount();
  } finally {
    spy.restore();
  }
}));

test("cutName: potong 120 unit UTF-16 simetris (tulis = baca); tidak memisah pasangan surrogate di batas → setAuto lalu baca → tetap otomatis", async () => {
  const S = T.TLSched;
  assert.equal(S.NAME_MAX, 120);
  assert.equal(S.cutName("Alpha"), "Alpha");
  assert.equal(S.cutName(null), "");
  assert.equal(S.cutName("x".repeat(130)).length, 120);
  const emoji = "\u{1F600}"; // pasangan surrogate (2 unit)
  const straddle = "a".repeat(119) + emoji + " akhir"; // unit 119 = surrogate tinggi
  assert.equal(S.cutName(straddle), "a".repeat(119), "potong di 119, tidak memisah pasangan");
  assert.equal(S.cutName("a".repeat(118) + emoji + "z"), "a".repeat(118) + emoji, "pasangan utuh di 118–119 tetap");
  for (const [lid, page] of [[12, { pageKind: "workspace", listId: 12 }], [null, { pageKind: "project", listId: null, projectName: straddle }]]) {
    const fr = fakeRecords();
    const store = T.projectStore({ records: fr.api });
    const task = { id: 1, list_id: lid, project: straddle };
    const u = S.unitOf(task);
    await store.setAuto(u, true, 7);
    const name = fr.calls.put[0][2].name;
    assert.equal(name, "a".repeat(119));
    assert.doesNotMatch(name, /[\uD800-\uDFFF]/, "tanpa surrogate tunggal");
    const units = await store.loadUnits(page);
    assert.equal(units.get(u.recId).exists, true);
    assert.equal(units.get(u.recId).fold, S.projectFold(S.cutName(straddle)));
    assert.equal(S.modeOf({}, units, task), "auto", "baca kembali → tetap otomatis (" + (lid ? "workspace" : "project") + ")");
  }
  // nama panjang biasa (> 120, tanpa surrogate) juga bulat-pergi; dua project berawalan 120 sama tetapi hash beda tidak saling memakai
  const long = "Proyek " + "Abc".repeat(50);
  const fr = fakeRecords();
  const store = T.projectStore({ records: fr.api });
  const lt = { id: 2, list_id: 12, project: long };
  await store.setAuto(S.unitOf(lt), true, 7);
  const units = await store.loadUnits({ pageKind: "workspace", listId: 12 });
  assert.equal(S.modeOf({}, units, lt), "auto");
  assert.equal(S.modeOf({}, units, { id: 3, list_id: 12, project: long + " lain" }), "manual");
});

// ── 1c-1 Task 7 (R18, R19): kolom Slack, Jalur kritis, panah per tipe, pin Manual, konflik jangkar ─────────────────
// Project "Alpha" (halaman project pribadi, unit otomatis):
//   A 1  Sen 2 Nov, 2 hk                       → kritis (tenggat B menarik ke belakang), slack −1
//   S 10 ringkasan anak C dan B                → min anak = −1
//   C 3  Sen 2 Nov, 6 hk (selesai Sen 9)       → slack 6 (akhir project Sel 17)
//   B 2  FS A, 10 hk, tenggat Sen 16 Nov        → selesai Sel 17, slack −1
//   D 4  selesai                                → "—"
//   E 5  Sel 10 Nov, 6 hk (selesai Sel 17)      → slack 0
//   F 6  tanpa jadwal                           → "—"
//   P 7  FS A, 1 hk, Mulai tersimpan Sen 2 (basi; hasil hitung Rab 4)
//   H 8  Manual (mode tersimpan) Sel 3 Nov, FS P → 1b: tidak melanggar (P tersimpan Sen 2); mesin: konflik jangkar
const critTasks = () => {
  const al = { project: "Alpha" };
  return [
    mk(1, "A", { start: "2026-11-02", duration: 2 }, al),
    mk(10, "S", {}, al),
    mk(3, "C", { start: "2026-11-02", duration: 6 }, Object.assign({ parent_id: 10 }, al)),
    mk(2, "B", { start: "2026-11-04", duration: 10, deps: [{ t: { $task: 1 }, type: "FS", lag: 0 }] }, Object.assign({ parent_id: 10, deadline: "2026-11-16" }, al)),
    mk(4, "D", { start: "2026-11-02", duration: 1 }, Object.assign({ gtd_status: "done", completed_at: "2026-11-02T03:00:00Z" }, al)),
    mk(5, "E", { start: "2026-11-10", duration: 6 }, al),
    mk(6, "F", {}, al),
    mk(7, "P", { start: "2026-11-02", duration: 1, deps: [{ t: { $task: 1 }, type: "FS", lag: 0 }] }, al),
    mk(8, "H", { start: "2026-11-03", duration: 1, mode: "manual", deps: [{ t: { $task: 7 }, type: "FS", lag: 0 }] }, al),
  ];
};
const slackOf = (tree, key) => {
  const head = headerCells(tree);
  const i = head.indexOf("Slack");
  return i < 0 ? undefined : txt(cellsOf(rowOf(tree, key))[i]).trim();
};
const barOf = (tree, key) => nodes(tree, (n) => n.props["data-key"] === key && (hasCls(n, "plg-timeline-bar") || hasCls(n, "plg-timeline-milestone") || hasCls(n, "plg-timeline-summary")))[0];
const arrowOf = (tree, from, to) => nodes(tree, (n) => n.type === "path" && hasCls(n, "plg-timeline-arrow") && n.props.key === from + ">" + to)[0];
const legendTexts = (tree) => byCls(tree, "plg-timeline-legend-item").map((n) => txt(n).trim());

// View halaman project "Alpha" dengan unit otomatis (record project pribadi) + mesin siap; storageGet opsional.
async function critView(clock, o) {
  const opt = o || {};
  const tasks = opt.tasks || critTasks();
  const fr = fakeRecords();
  if (opt.auto !== false) putRec(fr, unitRec(null, "Alpha"));
  const { api, calls } = fakeApi({ records: fr, storageGet: opt.storageGet });
  api.data = { tasks: { list: () => Promise.resolve(tasks) } };
  const writes = spyWrites(api);
  const { ctx } = ctxOf(tasks);
  const props = { context: ctx, api };
  const m = mount(T.TimelineViewBody);
  const tree = await settleView(m, () => props, clock);
  return { m, tree, props, api, calls, writes, fr };
}

test("kolom Slack setelah %, teks 0 / '6 hk' / '−1 hk' / '—'; ringkasan min anak; tidak ada di COLS_COMPACT", () => withEngineClock(async (clock) => {
  // teks murni (R18): minus U+2212, −0 = "0"
  assert.equal(T.slackText(0), "0");
  assert.equal(T.slackText(-0), "0");
  assert.equal(T.slackText(6), "6 hk");
  assert.equal(T.slackText(-1), "−1 hk");
  assert.equal(T.slackText(-12), "−12 hk");
  for (const v of [null, undefined, NaN, Infinity, "3"]) assert.equal(T.slackText(v), "—", String(v));
  // kolom
  const ids = T.COLS_FULL.map((c) => c.id);
  assert.deepEqual(ids.slice(ids.indexOf("pct")), ["pct", "slack"]);
  assert.deepEqual(T.COLS_FULL.find((c) => c.id === "slack"), { id: "slack", label: "Slack", w: 56 });
  assert.equal(T.COLS_COMPACT.some((c) => c.id === "slack"), false);
  // view dengan mesin siap
  const { m, tree } = await critView(clock);
  assert.deepEqual(headerCells(tree), ["WBS", "Nama", "Mulai", "Dur", "🍅", "%", "Slack"]);
  const got = Object.fromEntries(["1", "10", "3", "2", "4", "5", "6"].map((k) => [k, slackOf(tree, k)]));
  assert.deepEqual(got, { 1: "−1 hk", 10: "−1 hk", 3: "6 hk", 2: "−1 hk", 4: "—", 5: "0", 6: "—" });
  m.unmount();
  // Live Edit (ringkas): tanpa kolom Slack
  const { api } = fakeApi();
  const le = mount(T.TimelineViewBody).render({ context: ctxOf(critTasks(), { liveEdit: true }).ctx, api });
  assert.deepEqual(headerCells(le), ["WBS", "Nama"]);
}));

test("sebelum mesin siap: sel Slack '—' dan tanpa is-critical", () => withEngineClock(async (clock) => {
  const tasks = critTasks();
  const fr = fakeRecords();
  putRec(fr, unitRec(null, "Alpha"));
  // pref Jalur kritis sudah ON dari storage — tetap tidak ada is-critical sebelum mesin siap
  const { api } = fakeApi({ records: fr, storageGet: (k) => Promise.resolve(k === "crit:proj_Alpha" ? true : null) });
  api.data = { tasks: { list: () => Promise.resolve(tasks) } };
  const spy = spyRun();
  try {
    const m = mount(T.TimelineViewBody);
    const props = { context: ctxOf(tasks).ctx, api };
    m.render(props);
    m.flush();
    await settle();
    const tree = m.render(props); // pref terbaca, daftar termuat, mesin belum jalan (raf/setTimeout belum)
    assert.equal(spy.runs.length, 0);
    assert.equal(headerCells(tree).indexOf("Slack"), 6, "kolom tetap ada (tanpa geser tata letak)");
    for (const k of ["1", "10", "3", "2", "4", "5", "6", "7", "8"]) assert.equal(slackOf(tree, k), "—", k);
    assert.equal(nodes(tree, (n) => hasCls(n, "is-critical")).length, 0);
    assert.equal(buttonByText(tree, "Jalur kritis"), undefined, "sakelar disembunyikan sampai mesin siap (R7)");
    assert.equal(legendTexts(tree).indexOf("Jalur kritis"), -1);
    assert.equal(nodes(tree, (n) => n.props["aria-label"] === "Manual").length, 0, "pin Manual menunggu mesin");
    assert.equal(hasCls(arrowOf(tree, "7", "8"), "is-violation"), false, "konflik jangkar menunggu mesin");
    m.unmount();
  } finally {
    spy.restore();
  }
}));

test("1c-2: task berjalan via actual.start di unit Otomatis → ⚠ view setuju dengan mesin (tata letak ulang setelah unit dimuat)", () => withEngineClock(async (clock) => {
  const al = { project: "Alpha" };
  const dep = [{ t: { $task: 1 }, type: "FS", lag: 0 }];
  const tasks = [
    mk(1, "X", { start: "2026-11-11", duration: 2, actual: { start: "2026-11-04" } }, al), // mesin: Rab 4–Kam 5
    mk(2, "Y", { start: "2026-11-06", duration: 1, mode: "manual", deps: dep }, al), // Jum 6 = setelah jangkar aktual
  ];
  const orig = T.engine.layout;
  let last = null;
  T.engine.layout = (a) => (last = orig(a));
  try {
    const { m } = await critView(clock, { tasks });
    assert.equal(last.rows.find((r) => r.key === "2").violation, false, "tanpa ⚠ palsu (rentang tersimpan Rab 11 tidak dipakai)");
    m.unmount();
    const manual = await critView(clock, { tasks, auto: false });
    assert.equal(last.rows.find((r) => r.key === "2").violation, true, "unit Manual → mesin berjangkar di tersimpan → ⚠");
    manual.m.unmount();
  } finally {
    T.engine.layout = orig;
  }
}));

test("1c-2: task berjalan TANPA Mulai (simpul mesin) → rentang pelanggaran dari actual.start + durasi mesin setelah mesin siap", () => withEngineClock(async (clock) => {
  const al = { project: "Alpha" };
  const fs9 = [{ t: { $task: 9 }, type: "FS", lag: 0 }];
  const fs1 = [{ t: { $task: 1 }, type: "FS", lag: 0 }];
  const mkT = (y) => [
    mk(9, "P", { start: "2026-10-26", duration: 1 }, al),
    mk(1, "X", { duration: 3, deps: fs9, actual: { start: "2026-11-02" } }, al), // mesin: Sen 2–Rab 4
    mk(2, "Y", { start: y, duration: 1, mode: "manual", deps: fs1 }, al),
  ];
  const orig = T.engine.layout;
  let last = null;
  T.engine.layout = (a) => (last = orig(a));
  try {
    for (const [y, v] of [["2026-11-04", true], ["2026-11-05", false]]) {
      const { m } = await critView(clock, { tasks: mkT(y) });
      assert.equal(last.rows.find((r) => r.key === "2").violation, v, "Y " + y);
      m.unmount();
    }
  } finally {
    T.engine.layout = orig;
  }
}));

test("Jalur kritis OFF bawaan; ON → bar slack ≤ 0 is-critical, panah antar kritis is-critical, legenda + 'Jalur kritis'; pref crit:<page> ditulis lewat storage", () => withEngineClock(async (clock) => {
  assert.equal(T.PREF_DEFAULTS.crit, false);
  assert.equal(T.prefKey("crit", "proj_Alpha"), "crit:proj_Alpha");
  assert.equal(T.cleanPref("crit", true), true);
  assert.equal(T.cleanPref("crit", "ya"), false);
  const orig = T.engine.layout;
  let nLay = 0;
  T.engine.layout = (a) => { nLay++; return orig(a); };
  try {
    const { m, tree, props, calls, writes } = await critView(clock);
    assert.equal(nLay, 1, "mesin siap tidak menghitung ulang tata letak (overlay terpisah)");
    const btn = buttonByText(tree, "Jalur kritis");
    assert.ok(btn, "sakelar tampil setelah mesin siap");
    assert.equal(btn.props["aria-pressed"], false);
    assert.equal(nodes(tree, (n) => hasCls(n, "is-critical")).length, 0, "OFF bawaan");
    assert.equal(legendTexts(tree).indexOf("Jalur kritis"), -1);
    btn.props.onClick({});
    await settle(); // setTimeout dipalsukan withEngineClock
    assert.deepEqual(calls.storageSet, [["crit:proj_Alpha", true]]);
    const on = m.render(props);
    assert.equal(nLay, 1, "sakelar tidak menghitung ulang tata letak");
    assert.equal(buttonByText(on, "Jalur kritis").props["aria-pressed"], true);
    const crit = nodes(on, (n) => hasCls(n, "is-critical") && n.props["data-key"] !== undefined).map((n) => n.props["data-key"]).sort();
    assert.deepEqual(crit, ["1", "2", "5"], "A, B (slack −1), E (0); C (6), D selesai, ringkasan bukan");
    assert.ok(hasCls(barOf(on, "1"), "is-critical"));
    assert.equal(hasCls(barOf(on, "3"), "is-critical"), false);
    assert.ok(hasCls(arrowOf(on, "1", "2"), "is-critical"), "A→B antar kritis");
    assert.equal(hasCls(arrowOf(on, "1", "7"), "is-critical"), false, "P tidak kritis");
    assert.deepEqual(legendTexts(on), ["Task", "Selesai", "Lewat tenggat", "Ringkasan", "Milestone", "Tenggat", "Libur", "Dependensi", "Jalur kritis"]);
    // OFF lagi
    buttonByText(on, "Jalur kritis").props.onClick({});
    await settle(); // setTimeout dipalsukan withEngineClock
    const off = m.render(props);
    assert.deepEqual(calls.storageSet, [["crit:proj_Alpha", true], ["crit:proj_Alpha", false]]);
    assert.equal(nodes(off, (n) => hasCls(n, "is-critical")).length, 0);
    assert.deepEqual(writes, [], "pref bukan tulisan task/record (R25)");
    m.unmount();
    // pulang-pergi: pref tersimpan true → ON saat dipasang lagi
    const again = await critView(clock, { storageGet: (k) => Promise.resolve(k === "crit:proj_Alpha" ? true : null) });
    assert.ok(again.calls.storageGet.indexOf("crit:proj_Alpha") >= 0);
    assert.equal(buttonByText(again.tree, "Jalur kritis").props["aria-pressed"], true);
    assert.ok(hasCls(barOf(again.tree, "2"), "is-critical"));
    again.m.unmount();
  } finally {
    T.engine.layout = orig;
  }
  // CSS: garis tepi 2 px merah (bukan isi), panah tebal 2 px; token saja
  assert.match(css, /\.plg-timeline-bar\.is-critical[^{]*\{[^}]*2px[^}]*var\(--plg-timeline-danger\)/);
  assert.match(css, /\.plg-timeline-arrow\.is-critical\s*\{[^}]*stroke-width:\s*2;/);
  assert.match(css, /\.plg-timeline-swatch\.is-critical/);
}));

test("task Manual di unit otomatis → pin aria-label 'Manual'", () => withEngineClock(async (clock) => {
  const { m, tree } = await critView(clock);
  const pins = nodes(tree, (n) => n.props["aria-label"] === "Manual");
  assert.equal(pins.length, 1);
  assert.equal(pins[0].props.role, "img");
  assert.ok(hasCls(pins[0], "plg-timeline-pin"));
  assert.equal(nodes(rowOf(tree, "8"), (n) => n.props["aria-label"] === "Manual").length, 1, "di sel Nama baris H");
  m.unmount();
  // unit Manual (tanpa record): semua task Manual → tanpa pin
  const man = await critView(clock, { auto: false });
  assert.equal(nodes(man.tree, (n) => n.props["aria-label"] === "Manual").length, 0);
  man.m.unmount();
  assert.match(css, /\.plg-timeline-pin\s*\{[^}]*width:\s*10px/);
}));

test("konflik jangkar → panah merah putus-putus", () => withEngineClock(async (clock) => {
  const { m, tree } = await critView(clock);
  // 1b (rentang tersimpan) tidak melanggar: P tersimpan Sen 2 → H Sel 3 sah; mesin: P Rab 4 → H (Manual) konflik
  const pv = arrowOf(tree, "7", "8");
  assert.ok(pv);
  assert.ok(hasCls(pv, "is-violation"));
  assert.equal(pv.props.markerEnd, "url(#plg-timeline-ah-v)");
  assert.equal(hasCls(arrowOf(tree, "1", "2"), "is-violation"), false);
  // overlay murni: hanya sisi P→H yang konflik jangkar (A→P merah karena pelanggaran 1b atas Mulai P tersimpan, bukan mesin)
  const tasks = critTasks();
  const api = fakeApi().api;
  const lay = T.TLLayout.layout({ tasks, pageKind: "project", cal: T.TLCal.DEFAULT_CAL, today: TODAY, readSchedOf: (t) => T.TLSched.readSched(api.taskExt.read(t)) });
  const units = new Map([[T.TLSched.unitOf(tasks[0]).recId, { auto: true }]]);
  const ctx = { tasks, cal: T.TLCal.compile(T.TLCal.DEFAULT_CAL), units, readExt: (t) => api.taskExt.read(t) };
  const ov = T.engineOverlay(lay, T.TLCpm.run(ctx), ctx);
  assert.deepEqual([...ov.conflictEdge], ["7>8"]);
  assert.deepEqual([...ov.manual], ["8"]);
  assert.equal(T.engineOverlay(lay, null, null), T.NO_OVERLAY);
  assert.equal(T.NO_OVERLAY.ready, false);
  m.unmount();
}));

test("panah view memakai tipe dependensi (SS/FF/SF) lewat TLLayout.arrowPath", () => {
  const tasks = [
    mk(1, "A", { start: "2026-11-02", duration: 3 }),
    mk(2, "B", { start: "2026-11-03", duration: 2, deps: [{ t: { $task: 1 }, type: "SS", lag: 1 }] }),
    mk(3, "C", { start: "2026-11-04", duration: 2, deps: [{ t: { $task: 1 }, type: "FF", lag: 0 }] }),
    mk(4, "D", { start: "2026-11-02", duration: 1, deps: [{ t: { $task: 1 }, type: "SF", lag: 0 }] }),
  ];
  const { api } = fakeApi();
  const tree = mount(T.TimelineViewBody).render({ context: ctxOf(tasks).ctx, api });
  const lay = layOf(tasks, "week", api);
  const R = T.TLLayout;
  for (const [to, type] of [["2", "SS"], ["3", "FF"], ["4", "SF"]]) {
    const d = arrowOf(tree, "1", to).props.d;
    const e = lay.edges.find((x) => x.to === to);
    assert.equal(e.type, type);
    // titik awal: SS/SF dari awal bar A (x), FF dari ujung
    const x0 = +/^M(-?[\d.]+)/.exec(d)[1];
    const a = lay.rows.find((r) => r.key === "1");
    const box = R.barBox(a.span, a.sched, lay.range, lay.px, a.kind);
    assert.equal(x0, type === "FF" ? box.x + box.w : box.x, type);
  }
});

// ── 1c-1 Task 8 (R14, R15, R23): toolbar, sakelar Jadwal otomatis, dialog pratinjau, applyPlan ─────────────────────
// Project pribadi "Alpha" tanpa record (Manual): A akar Sen 2 Nov 2 hk; B FS A, C FS B, D FS C (1 hk, tersimpan Sen 2).
// Menyalakan otomatis → B Rab 4, C Kam 5, D Jum 6 (3 item; A akar tetap).
const MSG_ON0 = "Jadwal otomatis menyala — tidak ada task yang bergeser";
const MSG_OFF = "Jadwal otomatis dimatikan — tanggal tetap seperti sekarang";
const MSG_STALE = "Data berubah sejak pratinjau dibuka — hitung ulang";
const MSG_WAIT_UNITS = "Menunggu data jadwal workspace…";
const MSG_OFFLINE = "Kamu sedang offline — jadwal dihitung dari data di perangkat ini";
const chainTasks = (extra) => {
  const al = Object.assign({ project: "Alpha" }, extra || {});
  const dep = (id) => [{ t: { $task: id }, type: "FS", lag: 0 }];
  return [
    mk(1, "A", { start: "2026-11-02", duration: 2 }, al),
    mk(2, "B", { start: "2026-11-02", duration: 1, deps: dep(1) }, al),
    mk(3, "C", { start: "2026-11-02", duration: 1, deps: dep(2) }, al),
    mk(4, "D", { start: "2026-11-02", duration: 1, deps: dep(3) }, al),
  ];
};
const toolbarTexts = (tree) => {
  const bar = byCls(tree, "plg-timeline-toolbar")[0];
  return nodes(bar, (n) => n.type === "button" || n.type === T.MoreMenu).map((n) => (n.type === T.MoreMenu ? "[Lainnya]" : txt(n).trim()));
};
const switchOf = (tree) => nodes(tree, (n) => n.type === "button" && n.props.role === "switch" && txt(n).trim() === "Jadwal otomatis")[0];
const dialogOf = (tree) => nodes(tree, (n) => n.type === T.PreviewDialog)[0];
const unitPopOf = (tree) => nodes(tree, (n) => n.type === T.UnitPopover)[0];
const moreOf = (tree) => nodes(tree, (n) => n.type === T.MoreMenu)[0];
const child = (node) => mount(node.type).render(node.props); // satu tingkat komponen anak (props apa adanya)

// View dengan mesin siap; log tulis berurutan (setMany + put) untuk memeriksa urutan.
async function swView(clock, o) {
  const opt = o || {};
  const fr = opt.records || fakeRecords();
  let list = opt.tasks || chainTasks();
  const { api, calls } = fakeApi({ records: fr, today: opt.today });
  api.env.userId = 7;
  api.data = { tasks: { list: () => Promise.resolve(opt.listOf ? opt.listOf() : list) } };
  const log = [];
  api.taskExt.setMany = (items) => { log.push(["setMany", JSON.parse(JSON.stringify(items))]); return opt.setMany ? opt.setMany(items) : Promise.resolve([]); };
  api.taskExt.set = (...a) => { log.push(["set", a]); return Promise.resolve(); };
  const put0 = fr.api.put;
  fr.api.put = (...a) => { log.push(["put", a[1], JSON.parse(JSON.stringify(a[2])), a[3]]); return put0(...a); };
  const ctx = ctxOf(list, opt.ctx).ctx;
  const props = { context: ctx, api };
  const m = mount(T.TimelineViewBody);
  const tree = await settleView(m, () => props, clock);
  const h = {
    m, fr, api, calls, log, props,
    tree,
    setList(l) { list = l; },
    async again() { h.tree = await settleView(m, () => props, clock); return h.tree; },
    render() { h.tree = m.render(props); return h.tree; },
    writes: () => log.filter((l) => l[0] === "setMany" || l[0] === "set" || l[0] === "put"),
  };
  return h;
}

test("toolbar urutan R23; ≤ 640 px / liveEdit → tiga tombol di menu 'Lainnya'; mesin belum siap → tombol Jadwal otomatis/Jalur kritis/Jadwalkan ulang tidak tampil", () => withEngineClock(async (clock) => {
  // mesin belum siap: tidak ada tiga tombol baru. 1d-2 T5 (R6): 'Lainnya' kini selalu ada (layar lebar setelah extras,
  // Live Edit di posisi extras) dengan item Ekspor nonaktif sampai mesin siap.
  {
    const { api } = fakeApi();
    api.data = { tasks: { list: () => Promise.resolve(chainTasks()) } };
    const m = mount(T.TimelineViewBody);
    const props = { context: ctxOf(chainTasks()).ctx, api };
    m.render(props);
    m.flush();
    await settle();
    const tree = m.render(props);
    assert.deepEqual(toolbarTexts(tree), ["Hari", "Minggu", "Bulan", "Hari ini", "[Lainnya]", "Kalender kerja", "Urutkan menurut Mulai"]);
    assert.deepEqual(moreOf(tree).props.items.map((it) => [it.text, !!it.disabled]), [["Ekspor ke Microsoft Project (.xml)", true]]);
    const le = mount(T.TimelineViewBody).render({ context: ctxOf(chainTasks(), { liveEdit: true }).ctx, api });
    assert.deepEqual(moreOf(le).props.items.map((it) => [it.text, !!it.disabled]), [["Ekspor ke Microsoft Project (.xml)", true]], "Live Edit: hanya Ekspor (nonaktif)");
    m.unmount();
  }
  // lebar, mesin siap: urutan R23
  const h = await swView(clock);
  assert.deepEqual(toolbarTexts(h.tree), ["Hari", "Minggu", "Bulan", "Hari ini", "Jadwal otomatis", "Jalur kritis", "Beban Tim", "Baseline", "Simpan baseline", "Jadwalkan ulang", "[Lainnya]", "Kalender kerja", "Urutkan menurut Mulai"]); // 1c-2 T5: §7.1; 1d-1 T4: Beban Tim; 1d-2 T5: Lainnya (Ekspor)
  assert.deepEqual(moreOf(h.tree).props.items.map((it) => it.text), ["Ekspor ke Microsoft Project (.xml)"], "layar lebar: Lainnya hanya aksi menu");
  h.m.unmount();
  // Live Edit: tiga tombol pindah ke 'Lainnya' (posisi sama di urutan), Kolom tetap di toolbar
  const le = await swView(clock, { ctx: { liveEdit: true } });
  assert.deepEqual(toolbarTexts(le.tree), ["Hari", "Minggu", "Bulan", "Hari ini", "[Lainnya]", "Kalender kerja", "Urutkan menurut Mulai", "Kolom"]);
  const mm = moreOf(le.tree);
  assert.deepEqual(mm.props.items.map((it) => it.text), ["Jadwal otomatis", "Jalur kritis", "Beban Tim", "Baseline", "Simpan baseline", "Jadwalkan ulang", "Ekspor ke Microsoft Project (.xml)"]); // 1d-2 T5: Ekspor di akhir
  // MoreMenu: tombol 'Lainnya' aria-haspopup="menu"; dibuka → role menu dengan item menuitemcheckbox/menuitem
  const mt = mount(T.MoreMenu);
  let t = mt.render(mm.props);
  const btn = buttonByText(t, "Lainnya");
  assert.equal(btn.props["aria-haspopup"], "menu");
  assert.equal(btn.props["aria-expanded"], false);
  btn.props.onClick({});
  t = mt.render(mm.props);
  const menu = nodes(t, (n) => n.props.role === "menu")[0];
  assert.ok(menu);
  const its = nodes(menu, (n) => n.type === "button");
  assert.deepEqual(its.map((n) => [txt(n).trim(), n.props.role, n.props["aria-checked"]]), [
    ["Jadwal otomatis", "menuitemcheckbox", false], ["Jalur kritis", "menuitemcheckbox", false], ["Beban Tim", "menuitemcheckbox", false],
    ["Baseline", "menuitem", undefined], ["Simpan baseline", "menuitem", undefined], ["Jadwalkan ulang", "menuitem", undefined],
    ["Ekspor ke Microsoft Project (.xml)", "menuitem", undefined],
  ]);
  // pilih Jalur kritis → pref crit ditulis, menu tertutup
  its[1].props.onClick({});
  t = mt.render(mm.props);
  assert.equal(nodes(t, (n) => n.props.role === "menu").length, 0);
  await settle();
  assert.deepEqual(le.calls.storageSet.filter((s) => s[0].indexOf("crit:") === 0), [["crit:proj_Alpha", true]]);
  mt.unmount();
  le.m.unmount();
  // ≤ 640 px: sama; mode Daftar → 'Lainnya' tanpa Jalur kritis (Slack/kritis tidak di Daftar)
  const prevWin = global.window;
  global.window = { matchMedia: (q) => ({ matches: q === "(max-width: 640px)", addEventListener() {}, removeEventListener() {} }), innerHeight: 800, addEventListener() {}, removeEventListener() {} };
  try {
    const n = await swView(clock);
    assert.deepEqual(moreOf(n.tree).props.items.map((it) => it.text), ["Jadwal otomatis", "Jalur kritis", "Beban Tim", "Baseline", "Simpan baseline", "Jadwalkan ulang", "Ekspor ke Microsoft Project (.xml)"]);
    assert.equal(switchOf(n.tree), undefined, "sakelar tidak di toolbar HP");
    buttonByText(n.tree, "Daftar").props.onClick({});
    const lt = n.render();
    // 1c-2 T5: pilihan Baseline hanya untuk Gantt (seperti Jalur kritis); Simpan baseline tetap (aksi data). 1d-1 T4: Beban
    // Tim tetap di Daftar HP (R10: daftar "Hari kelebihan beban" menggantikan histogram ≤ 640 px).
    assert.deepEqual(moreOf(lt).props.items.map((it) => it.text), ["Jadwal otomatis", "Beban Tim", "Simpan baseline", "Jadwalkan ulang", "Ekspor ke Microsoft Project (.xml)"]);
    n.m.unmount();
  } finally {
    global.window = prevWin;
  }
}));

test("kanan toolbar 'Selesai {tgl}' + chip '{n} lewat tenggat'", () => withEngineClock(async (clock) => {
  const { m, tree } = await critView(clock);
  const end = byCls(tree, "plg-timeline-toolbar-end")[0];
  assert.ok(end, "ringkasan kanan toolbar");
  assert.equal(txt(byCls(end, "plg-timeline-finish")[0]).trim(), "Selesai Sel 17 Nov");
  assert.equal(txt(byCls(end, "plg-timeline-latechip")[0]).trim(), "1 lewat tenggat");
  m.unmount();
  // tanpa task lewat tenggat → tanpa chip
  const h = await swView(clock);
  const e2 = byCls(h.tree, "plg-timeline-toolbar-end")[0];
  assert.equal(txt(byCls(e2, "plg-timeline-finish")[0]).trim(), "Selesai Sel 3 Nov");
  assert.equal(byCls(e2, "plg-timeline-latechip").length, 0);
  h.m.unmount();
}));

test("halaman project: sakelar ON, 0 item → records.put auto true + toast 'Jadwal otomatis menyala — tidak ada task yang bergeser', tanpa setMany", () => withEngineClock(async (clock) => {
  const h = await swView(clock, { tasks: [mk(1, "A", { start: "2026-11-02", duration: 2 }, { project: "Alpha" })] });
  const sw = switchOf(h.tree);
  assert.ok(sw);
  assert.equal(sw.props["aria-checked"], false);
  assert.equal(sw.props.disabled, false, "halaman project pribadi tidak pernah terkunci (P3)");
  sw.props.onClick({});
  await settle();
  assert.deepEqual(h.writes(), [["put", "prj@user:" + T.TLSched.fnv1a32("alpha"), { v: 1, auto: true, name: "Alpha", by: 7 }, { scope: "user" }]]);
  assert.deepEqual(h.calls.toast, [[MSG_ON0, "success"]]);
  assert.equal(dialogOf(h.render()), undefined, "tanpa dialog");
  h.fr.emit({ entity: "project", ids: [], source: "local" });
  await h.again();
  assert.equal(switchOf(h.tree).props["aria-checked"], true);
  h.m.unmount();
}));

test("ON dengan 3 item → dialog 'Nyalakan jadwal otomatis — {project}', Batal/Esc → 0 tulis; Terapkan → satu setMany lalu satu put; setMany reject → put tidak dipanggil, toast 'Sebagian jadwal gagal disimpan (k dari n)'", () => withEngineClock(async (clock) => {
  const h = await swView(clock);
  switchOf(h.tree).props.onClick({});
  await settle();
  let dlg = dialogOf(h.render());
  assert.ok(dlg, "pratinjau terbuka");
  assert.equal(dlg.props.title, "Nyalakan jadwal otomatis — Alpha");
  assert.deepEqual(dlg.props.model.rows.map((r) => r.key), ["2", "3", "4"]);
  const dt = child(dlg);
  assert.deepEqual(byCls(dt, "plg-timeline-pv-main").map((n) => txt(n).trim()), [
    "2 · B · Sen 2 Nov → Rab 4 Nov · +2 hk", "3 · C · Sen 2 Nov → Kam 5 Nov · +3 hk", "4 · D · Sen 2 Nov → Jum 6 Nov · +4 hk",
  ]);
  assert.equal(txt(byCls(dt, "plg-timeline-pv-summary")[0]).trim(), "3 task bergeser · Selesai project Sel 3 Nov → Jum 6 Nov (+3 hk)");
  assert.equal(dlg.props.offline, false);
  assert.deepEqual(h.writes(), [], "0 tulis saat dibuka");
  // Batal (Esc di dialog memanggil onCancel yang sama) → tertutup, 0 tulis
  dlg.props.onCancel();
  assert.equal(dialogOf(h.render()), undefined);
  assert.deepEqual(h.writes(), []);
  // buka lagi → Terapkan: satu setMany (3 item, nilai hasil hitung) LALU satu put
  switchOf(h.tree).props.onClick({});
  await settle();
  dlg = dialogOf(h.render());
  dlg.props.onApply();
  await settle();
  await settle();
  assert.deepEqual(h.writes().map((w) => w[0]), ["setMany", "put"]);
  assert.deepEqual(h.log[0][1], [
    { taskId: 2, patch: { start: "2026-11-04" } }, { taskId: 3, patch: { start: "2026-11-05" } }, { taskId: 4, patch: { start: "2026-11-06" } },
  ]);
  assert.deepEqual(h.writes()[1].slice(2), [{ v: 1, auto: true, name: "Alpha", by: 7 }, { scope: "user" }]);
  assert.equal(dialogOf(h.render()), undefined, "dialog ditutup setelah Terapkan");
  const ok = h.calls.toast.find((t) => t[0] === "Jadwal diterapkan · 3 task");
  assert.ok(ok, "toast sukses persis");
  assert.equal(ok[1], "success");
  assert.equal(ok[2].label, "Urungkan");
  h.m.unmount();
  // setMany ditolak dengan err.applied [2] → put tidak dipanggil; toast gagal sebagian (2 dari 3) + Urungkan hanya applied
  const f = await swView(clock, { setMany: () => { const e = new Error("Task not found"); e.applied = [2]; return Promise.reject(e); } });
  switchOf(f.tree).props.onClick({});
  await settle();
  dialogOf(f.render()).props.onApply();
  await settle();
  await settle();
  assert.deepEqual(f.writes().map((w) => w[0]), ["setMany"], "put tidak dipanggil");
  const part = f.calls.toast.find((t) => t[0] === "Sebagian jadwal gagal disimpan (2 dari 3)");
  assert.ok(part, JSON.stringify(f.calls.toast));
  assert.equal(part[1], "error");
  part[2].onClick();
  await settle();
  assert.deepEqual(f.log[1], ["setMany", [{ taskId: 2, patch: { start: "2026-11-02", duration: 1, constraint: null, mode: null } }]]);
  f.m.unmount();
}));

test("OFF → put auto false + toast 'dimatikan — tanggal tetap…', 0 setMany", () => withEngineClock(async (clock) => {
  const fr = fakeRecords();
  putRec(fr, unitRec(null, "Alpha"));
  const h = await swView(clock, { records: fr });
  const sw = switchOf(h.tree);
  assert.equal(sw.props["aria-checked"], true);
  sw.props.onClick({});
  await settle();
  assert.deepEqual(h.writes(), [["put", unitRec(null, "Alpha").id, { v: 1, auto: false, name: "Alpha", by: 7 }, { scope: "user" }]]);
  assert.deepEqual(h.calls.toast, [[MSG_OFF, "success"]]);
  assert.equal(dialogOf(h.render()), undefined);
  h.m.unmount();
}));

// Workspace 12: Alpha (Sari, 9), Beta (by tak dikenal), Gamma (saya, 7), tanpa project (tanpa record).
function wsSetup(o) {
  const opt = o || {};
  const fr = fakeRecords();
  const late = { updated_at: "2026-11-04T18:00:00Z" }; // 01.00 WIB Kam 5 Nov (Jakarta, bukan UTC)
  if (opt.alpha !== false) putRec(fr, unitRec(12, "Alpha", { by: 9 }, late));
  if (opt.all !== false) {
    putRec(fr, unitRec(12, "Beta", { by: 99 }, late));
    putRec(fr, unitRec(12, "Gamma", { by: 7 }, late));
  }
  const w = { list_id: 12 };
  const tasks = [
    mk(1, "A1", { start: "2026-11-02", duration: 1 }, Object.assign({ project: "Alpha" }, w)),
    mk(2, "B1", { start: "2026-11-02", duration: 1 }, Object.assign({ project: "Beta" }, w)),
    mk(3, "G1", { start: "2026-11-02", duration: 1 }, Object.assign({ project: "Gamma" }, w)),
    mk(4, "N1", { start: "2026-11-02", duration: 1 }, w),
  ];
  const ctx = {
    page: "slist_12", pageKind: "workspace", listId: 12, projectName: null,
    collaborators: [{ id: 9, display_name: "Sari" }, { id: 11, username: "budi" }],
    currentUser: { id: 7, display_name: "Saya", username: "saya" },
  };
  return { fr, tasks, ctx };
}

test("halaman workspace: popover per kelompok project + '(Tanpa project)'; 'Dinyalakan oleh Sari · Kam 5 Nov' dari collaborators; by tak dikenal → 'Dinyalakan oleh anggota lain'", () => withEngineClock(async (clock) => {
  const { fr, tasks, ctx } = wsSetup();
  const h = await swView(clock, { records: fr, tasks, ctx });
  fr.emit(PULLED);
  await h.again();
  assert.equal(switchOf(h.tree), undefined, "workspace: tombol pembuka popover, bukan sakelar");
  const open = buttonByText(h.tree, "Jadwal otomatis");
  assert.equal(open.props["aria-haspopup"], "dialog");
  assert.equal(open.props["aria-expanded"], false);
  open.props.onClick({});
  const pop = unitPopOf(h.render());
  assert.ok(pop);
  assert.deepEqual(pop.props.entries.map((e) => [e.label, e.on, e.locked, e.caption]), [
    ["Alpha", true, false, "Dinyalakan oleh Sari · Kam 5 Nov"],
    ["Beta", true, false, "Dinyalakan oleh anggota lain · Kam 5 Nov"],
    ["Gamma", true, false, "Dinyalakan oleh Saya · Kam 5 Nov"],
    ["(Tanpa project)", false, false, null],
  ]);
  assert.equal(pop.props.waiting, false);
  // render popover: dialog berlabel, satu sakelar per kelompok, keterangan
  const pt = child(pop);
  const dlg = nodes(pt, (n) => n.props.role === "dialog")[0];
  assert.equal(dlg.props["aria-label"], "Jadwal otomatis");
  const sws = nodes(pt, (n) => n.props.role === "switch");
  assert.deepEqual(sws.map((n) => [n.props["aria-label"], n.props["aria-checked"], n.props.disabled]), [
    ["Alpha", true, false], ["Beta", true, false], ["Gamma", true, false], ["(Tanpa project)", false, false],
  ]);
  assert.ok(txt(pt).indexOf("Dinyalakan oleh Sari · Kam 5 Nov") >= 0);
  // nyalakan "(Tanpa project)" (satu akar → 0 item) → put unit "-" scope list:12
  pop.props.entries[3].onToggle();
  await settle();
  assert.deepEqual(h.writes(), [["put", "prj@list:12:-", { v: 1, auto: true, name: "", by: 7 }, { scope: "list:12" }]]);
  assert.deepEqual(h.calls.toast, [[MSG_ON0, "success"]]);
  h.m.unmount();
}));

test("P3 (a): workspace, record unit tidak ada lokal dan belum ada peristiwa pulled sejak pasang → sakelar disabled + 'Menunggu data jadwal workspace…'; setelah pulled + muat ulang selesai → aktif; halaman project pribadi tidak pernah terkunci", () => withEngineClock(async (clock) => {
  const { fr, tasks, ctx } = wsSetup({ all: false });
  const h = await swView(clock, { records: fr, tasks, ctx });
  buttonByText(h.tree, "Jadwal otomatis").props.onClick({});
  let pop = unitPopOf(h.render());
  assert.deepEqual(pop.props.entries.map((e) => [e.label, e.locked]), [["Alpha", false], ["Beta", true], ["Gamma", true], ["(Tanpa project)", true]]);
  assert.equal(pop.props.waiting, true);
  const pt = child(pop);
  assert.ok(nodes(pt, (n) => n.props.role === "status" && txt(n).trim() === MSG_WAIT_UNITS).length === 1, "catatan persis");
  assert.deepEqual(nodes(pt, (n) => n.props.role === "switch").map((n) => n.props.disabled), [false, true, true, true]);
  // sakelar terkunci tidak menulis walau dipanggil
  pop.props.entries[1].onToggle();
  await settle();
  assert.deepEqual(h.writes(), []);
  // sync.done / onChange sync bukan tanda tarik sukses
  for (const fn of h.calls.handlers["sync.done"] || []) fn({ initial: true });
  h.fr.emit({ entity: "project", ids: [], source: "sync" });
  await h.again();
  assert.equal(unitPopOf(h.render()).props.waiting, true);
  // tarik sukses → muat ulang → aktif
  h.fr.emit(PULLED);
  await h.again();
  pop = unitPopOf(h.tree);
  assert.equal(pop.props.waiting, false);
  assert.deepEqual(pop.props.entries.map((e) => e.locked), [false, false, false, false]);
  assert.equal(nodes(child(pop), (n) => n.props.role === "status" && txt(n).trim() === MSG_WAIT_UNITS).length, 0);
  h.m.unmount();
  // halaman project pribadi tanpa record, tanpa pulled → tidak terkunci
  const p = await swView(clock);
  assert.equal(switchOf(p.tree).props.disabled, false);
  p.m.unmount();
}));

// Model dialog sintetis (bentuk TLPlan.preview + wbs/judul dari view).
function pvModel(n, o) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({ key: String(i + 10), task: { id: i + 10, title: "Task " + i }, wbs: "1." + (i + 1), kind: "move", from: "2026-11-02", to: "2026-11-04", deltaHk: 2, durFrom: 1, durTo: 1, isNew: false, durChanged: false, durGuess: false, late: 0 });
  }
  return Object.assign({ rows, moved: n, endBefore: T.TLCal.dn("2026-11-09"), endAfter: T.TLCal.dn("2026-11-11"), endDelta: 2, late: 1, notMoved: [], brokenDeps: 0 }, o || {});
}
function dlgSetup(model, extra) {
  const ev = { apply: 0, cancel: 0 };
  const props = Object.assign({ title: "Tinjau jadwal otomatis", model, offline: false, onApply: () => { ev.apply++; }, onCancel: () => { ev.cancel++; } }, extra || {});
  const m = mount(T.PreviewDialog);
  let tree = m.render(props);
  return { m, ev, props, get tree() { return tree; }, rerender() { tree = m.render(props); return tree; } };
}

test("dialog: baris 'WBS · Task · Mulai lama → baru · Δ hk', 'baru dijadwalkan', 'durasi berubah', ringkasan '{n} task bergeser · Selesai project … ({±k} hk) · {m} lewat tenggat', 'Tidak dipindah'; 60 item → 50 baris + 'Tampilkan semua'; fokus terjebak, Esc", () => withPop(async (w) => {
  const model = pvModel(3);
  model.rows[1] = Object.assign({}, model.rows[1], { kind: "new", from: null, to: "2026-11-05", deltaHk: null, isNew: true, durFrom: null, durTo: 1 });
  model.rows[2] = Object.assign({}, model.rows[2], { kind: "duration", to: "2026-11-02", deltaHk: -1, durFrom: 3, durTo: 5, durChanged: true });
  model.notMoved = [{ key: "99", why: "cycle", task: { id: 99, title: "Siklus" }, wbs: "2" }];
  const d = dlgSetup(model);
  const tree = d.tree;
  const dlg = nodes(tree, (n) => n.props.role === "dialog")[0];
  assert.equal(dlg.props["aria-modal"], "true");
  assert.equal(dlg.props["aria-label"], "Tinjau jadwal otomatis");
  const rowTexts = byCls(tree, "plg-timeline-pv-main").map((n) => txt(n).trim());
  assert.deepEqual(rowTexts, ["1.1 · Task 0 · Sen 2 Nov → Rab 4 Nov · +2 hk", "1.2 · Task 1 · — → Kam 5 Nov", "1.3 · Task 2 · Sen 2 Nov → Sen 2 Nov · −1 hk"]);
  const chips = byCls(tree, "plg-timeline-pv-tag").map((n) => txt(n).trim());
  assert.deepEqual(chips, ["baru dijadwalkan", "durasi berubah"]);
  assert.equal(txt(byCls(tree, "plg-timeline-pv-summary")[0]).trim(), "3 task bergeser · Selesai project Sen 9 Nov → Rab 11 Nov (+2 hk) · 1 lewat tenggat");
  const nm = byCls(tree, "plg-timeline-pv-notmoved")[0];
  assert.ok(nm);
  assert.ok(txt(nm).indexOf("Tidak dipindah") >= 0);
  assert.ok(txt(nm).indexOf("2 · Siklus") >= 0);
  assert.equal(byCls(tree, "plg-timeline-pv-offline").length, 0);
  assert.equal(buttonByText(tree, "Terapkan").props.disabled, false);
  buttonByText(tree, "Batal").props.onClick({});
  assert.equal(d.ev.cancel, 1);
  buttonByText(tree, "Terapkan").props.onClick({});
  assert.equal(d.ev.apply, 1);
  // tanpa ringkasan lewat tenggat / Selesai project tidak diketahui
  const d0 = dlgSetup(pvModel(2, { late: 0, endBefore: null, endAfter: null, endDelta: null }));
  assert.equal(txt(byCls(d0.tree, "plg-timeline-pv-summary")[0]).trim(), "2 task bergeser");
  // 0 item → Terapkan nonaktif
  assert.equal(buttonByText(dlgSetup(pvModel(0)).tree, "Terapkan").props.disabled, true);
  // 60 item → 50 baris + "Tampilkan semua" → 60
  const big = dlgSetup(pvModel(60));
  assert.equal(byCls(big.tree, "plg-timeline-pv-main").length, 50);
  const all = buttonByText(big.tree, "Tampilkan semua");
  assert.ok(all);
  all.props.onClick({});
  assert.equal(byCls(big.rerender(), "plg-timeline-pv-main").length, 60);
  assert.equal(buttonByText(big.tree, "Tampilkan semua"), undefined);
  // fokus: elemen fokus pertama saat dibuka; Tab di ujung kembali ke awal, Shift+Tab di awal ke akhir; Esc = Batal
  const doc = { activeElement: null };
  const mkf = (name) => ({ name, focus() { doc.activeElement = this; } });
  const f1 = mkf("pertama");
  const f2 = mkf("tengah");
  const f3 = mkf("terakhir");
  const root = { ownerDocument: doc, focus() { doc.activeElement = this; }, contains: (t) => [f1, f2, f3].indexOf(t) >= 0, querySelectorAll: () => [f1, f2, f3] };
  const t = dlgSetup(pvModel(2));
  nodes(t.tree, (n) => n.props.role === "dialog")[0].props.ref.current = root;
  t.m.flush();
  assert.equal(doc.activeElement, f1, "fokus ke elemen pertama saat dibuka");
  assert.equal(nodes(t.tree, (n) => n.props.role === "dialog")[0].props.onKeyDown, undefined, "perangkap di window (fase tangkap), bukan di elemen dialog");
  const keyDlg = (ev) => w.fire("keydown", ev);
  let prevented = 0;
  doc.activeElement = f3;
  keyDlg({ key: "Tab", shiftKey: false, preventDefault() { prevented++; } });
  assert.equal(doc.activeElement, f1, "Tab dari akhir → awal");
  keyDlg({ key: "Tab", shiftKey: true, preventDefault() { prevented++; } });
  assert.equal(doc.activeElement, f3, "Shift+Tab dari awal → akhir");
  doc.activeElement = f2;
  keyDlg({ key: "Tab", shiftKey: false, preventDefault() { prevented++; } });
  assert.equal(doc.activeElement, f2, "di tengah: peramban yang memindah");
  assert.equal(prevented, 2);
  // klik backdrop memindah fokus ke body (di luar dialog): Tab tetap tertangkap di window
  doc.activeElement = { name: "body" };
  keyDlg({ key: "Tab", shiftKey: false, preventDefault() { prevented++; } });
  assert.equal(doc.activeElement, f1, "fokus di luar dialog → ditarik kembali");
  doc.activeElement = { name: "body" };
  keyDlg({ key: "Tab", shiftKey: true, preventDefault() { prevented++; } });
  assert.equal(doc.activeElement, f3, "Shift+Tab dari luar → elemen terakhir");
  assert.equal(prevented, 4);
  let stopped = 0;
  w.fire("keydown", { key: "Escape", preventDefault() {}, stopPropagation() { stopped++; } });
  assert.equal(t.ev.cancel, 1, "Esc = Batal");
  assert.equal(stopped, 1, "Esc tidak menutup modal host di belakangnya");
  assert.equal(t.ev.apply, 0);
  t.m.unmount();
  assert.equal(w.ls.filter((l) => l.type === "keydown").length, 0, "pendengar Esc dilepas");
}));

test("item durGuess → catatan 'durasi belum diisi, dianggap 1 hari kerja'", () => {
  const model = pvModel(2);
  model.rows[1] = Object.assign({}, model.rows[1], { kind: "new", from: null, isNew: true, durGuess: true });
  const d = dlgSetup(model);
  const notes = byCls(d.tree, "plg-timeline-pv-note").map((n) => txt(n).trim());
  assert.deepEqual(notes, ["durasi belum diisi, dianggap 1 hari kerja"]);
  // catatan berada di baris item itu
  const rows = byCls(d.tree, "plg-timeline-pv-row");
  assert.equal(byCls(rows[0], "plg-timeline-pv-note").length, 0);
  assert.equal(byCls(rows[1], "plg-timeline-pv-note").length, 1);
});

test("offline → catatan offline", () => withEngineClock(async (clock) => {
  const d = dlgSetup(pvModel(1), { offline: true, todayLabel: "Sab 7 Nov" });
  assert.equal(txt(byCls(d.tree, "plg-timeline-pv-offline")[0]).trim(), MSG_OFFLINE);
  assert.equal(txt(byCls(d.tree, "plg-timeline-pv-today")[0]).trim(), "Hari ini: Sab 7 Nov");
  // view: api.env.online === false → dialog sakelar membawa offline true
  const h = await swView(clock);
  h.api.env.online = false;
  switchOf(h.render()).props.onClick({});
  await settle();
  assert.equal(dialogOf(h.render()).props.offline, true);
  h.m.unmount();
}));

test("CAS: daftar lengkap berubah (start item 2) sebelum Terapkan → toast 'Data berubah sejak pratinjau dibuka — hitung ulang', 0 setMany, dialog menghitung ulang", () => withEngineClock(async (clock) => {
  const h = await swView(clock);
  switchOf(h.tree).props.onClick({});
  await settle();
  const dlg = dialogOf(h.render());
  assert.equal(dlg.props.model.rows[1].from, "2026-11-02");
  // sinkron menimpa Mulai C (item ke-2) saat dialog terbuka
  const changed = chainTasks();
  changed[2] = mk(3, "C", { start: "2026-11-03", duration: 1, deps: [{ t: { $task: 2 }, type: "FS", lag: 0 }] }, { project: "Alpha" });
  h.setList(changed);
  dlg.props.onApply();
  await settle();
  await settle();
  assert.deepEqual(h.writes(), [], "0 tulis");
  assert.deepEqual(h.calls.toast.map((t) => t.slice(0, 2)), [[MSG_STALE, "error"]]);
  const again = dialogOf(h.render());
  assert.ok(again, "dialog tetap terbuka");
  assert.equal(again.props.model.rows[1].from, "2026-11-03", "dihitung ulang dari data terbaru");
  // Terapkan lagi (data tidak berubah) → satu setMany lalu put
  again.props.onApply();
  await settle();
  await settle();
  assert.deepEqual(h.writes().map((w) => w[0]), ["setMany", "put"]);
  h.m.unmount();
}));

test("fix final 2 (K32): hitung ulang pratinjau sakelar ON setelah CAS memakai 'sebelum' dari ctx SEGAR (Selesai project lama = data terbaru)", () => withEngineClock(async (clock) => {
  const h = await swView(clock);
  switchOf(h.tree).props.onClick({});
  await settle();
  const dlg = dialogOf(h.render());
  assert.equal(dlg.props.model.endBefore, T.TLCal.dn("2026-11-03"), "Manual: Selesai project Sel 3");
  // sinkron: D (Manual) dipindah ke Sen 9 → Selesai project sebelum = Sen 9
  const changed = chainTasks();
  changed[3] = mk(4, "D", { start: "2026-11-09", duration: 1, deps: [{ t: { $task: 3 }, type: "FS", lag: 0 }] }, { project: "Alpha" });
  h.setList(changed);
  dlg.props.onApply();
  await settle();
  await settle();
  assert.deepEqual(h.writes(), [], "0 tulis");
  const again = dialogOf(h.render());
  assert.ok(again);
  assert.equal(again.props.model.endBefore, T.TLCal.dn("2026-11-09"), "sebelum dari data terbaru, bukan hasil mesin lama");
  assert.equal(again.props.model.rows.find((r) => r.key === "4").from, "2026-11-09");
  h.m.unmount();
}));

test("anggota lain mematikan unit (onChange project, updatedAt baru) saat pratinjau ON terbuka → Terapkan ditolak dengan toast yang sama, 0 tulis", () => withEngineClock(async (clock) => {
  const h = await swView(clock);
  switchOf(h.tree).props.onClick({});
  await settle();
  const dlg = dialogOf(h.render());
  const rec = unitRec(null, "Alpha", { auto: false, by: 9 }, { updated_at: "2026-11-04T05:00:00Z" });
  putRec(h.fr, rec);
  h.fr.emit({ entity: "project", ids: [rec.id], source: "sync" });
  dlg.props.onApply();
  await settle();
  await settle();
  assert.deepEqual(h.writes(), []);
  assert.deepEqual(h.calls.toast.map((t) => t.slice(0, 2)), [[MSG_STALE, "error"]]);
  assert.ok(dialogOf(h.render()), "dialog menghitung ulang (tetap terbuka)");
  h.m.unmount();
}));

test("Urungkan → setMany undoItems persis (constraint null)", () => withEngineClock(async (clock) => {
  const tasks = chainTasks();
  // C punya constraint tersimpan rusak (tipe tak dikenal) → Urungkan menulis null (undoItems), bukan nilai rusak
  tasks[2] = mk(3, "C", { start: "2026-11-02", duration: 1, deps: [{ t: { $task: 2 }, type: "FS", lag: 0 }], constraint: { type: "XX" } }, { project: "Alpha" });
  const h = await swView(clock, { tasks });
  switchOf(h.tree).props.onClick({});
  await settle();
  const dlg = dialogOf(h.render());
  dlg.props.onApply();
  await settle();
  await settle();
  const toast = h.calls.toast.find((t) => t[0] === "Jadwal diterapkan · 3 task");
  toast[2].onClick();
  await settle();
  const undo = h.log.filter((l) => l[0] === "setMany")[1][1];
  assert.deepEqual(undo, [
    { taskId: 2, patch: { start: "2026-11-02", duration: 1, constraint: null, mode: null } },
    { taskId: 3, patch: { start: "2026-11-02", duration: 1, constraint: null, mode: null } },
    { taskId: 4, patch: { start: "2026-11-02", duration: 1, constraint: null, mode: null } },
  ]);
  assert.equal(h.log.filter((l) => l[0] === "put").length, 1, "Urungkan tidak menulis record project");
  h.m.unmount();
}));

test("sumber Task 8: teks persis (R14, R15, R23, R28) dan applyPlan satu pintu setMany", () => {
  for (const s of ["Nyalakan jadwal otomatis — ", "Jadwal diterapkan · ", "Sebagian jadwal gagal disimpan (", MSG_ON0, MSG_OFF, MSG_STALE, MSG_WAIT_UNITS, MSG_OFFLINE,
    "Tampilkan semua", "Lainnya", "Dinyalakan oleh anggota lain", "Tidak dipindah", "baru dijadwalkan", "durasi berubah", "durasi belum diisi, dianggap 1 hari kerja", "Jadwalkan ulang"]) {
    assert.ok(jsx.indexOf(s) >= 0, s);
  }
  assert.match(css, /\.plg-timeline-pv\b/);
  assert.match(css, /\.plg-timeline-more-menu\b/);
});

test("pratinjau sakelar memberi seedKeys unit: lingkaran Y↔Z di luar hilir item tercantum di 'Tidak dipindah' (K34); 'sebelum' = hasil useEngine tanpa run tambahan", () => withEngineClock(async (clock) => {
  const al = { project: "Alpha" };
  const tasks = chainTasks().concat([
    mk(8, "Y", { start: "2026-11-02", duration: 1, deps: [{ t: { $task: 9 }, type: "FS", lag: 0 }] }, al),
    mk(9, "Z", { start: "2026-11-02", duration: 1, deps: [{ t: { $task: 8 }, type: "FS", lag: 0 }] }, al),
  ]);
  const spy = spyRun();
  try {
    const h = await swView(clock, { tasks });
    const before = spy.runs.length;
    switchOf(h.tree).props.onClick({});
    await settle();
    const dlg = dialogOf(h.render());
    assert.deepEqual(dlg.props.model.notMoved.map((x) => [x.key, x.why, x.wbs]), [["8", "cycle", "5"], ["9", "cycle", "6"]]);
    assert.equal(spy.runs.length - before, 0, "view tidak menjalankan mesin tambahan (engine.run); 'sebelum' pratinjau = hasil useEngine");
    h.m.unmount();
  } finally {
    spy.restore();
  }
}));


// ── Fix review Task 8 ───────────────────────────────────────────────────────────────────────────────────────────
test("fix T8 #1: catatan 'Menunggu data jadwal workspace…' hanya setelah muat pertama (bukan saat memuat); sakelar tetap nonaktif saat memuat", () => withEngineClock(async (clock) => {
  const { fr, tasks, ctx } = wsSetup({ all: false });
  const listP = [];
  const list0 = fr.api.list;
  fr.api.list = (...a) => new Promise((res) => listP.push(() => res(list0(...a)))); // muat unit tertahan
  const h = await swView(clock, { records: fr, tasks, ctx });
  buttonByText(h.tree, "Jadwal otomatis").props.onClick({});
  let pop = unitPopOf(h.render());
  assert.deepEqual(pop.props.entries.map((e) => e.locked), [true, true, true, true], "memuat → semua nonaktif");
  assert.equal(pop.props.waiting, false, "memuat → tanpa catatan tunggu");
  assert.equal(nodes(child(pop), (n) => n.props.role === "status").length, 0);
  // muat selesai (record Alpha ada lokal, belum pulled) → catatan tampil untuk unit tanpa record
  while (listP.length) listP.shift()();
  await h.again();
  pop = unitPopOf(h.tree);
  assert.deepEqual(pop.props.entries.map((e) => e.locked), [false, true, true, true]);
  assert.equal(pop.props.waiting, true);
  assert.ok(nodes(child(pop), (n) => n.props.role === "status" && txt(n).trim() === MSG_WAIT_UNITS).length === 1);
  h.m.unmount();
}));

test("fix T8 #3: hitung ulang setelah CAS tanpa item → ringkasan '0 task bergeser' (Selesai project/lewat tenggat dibersihkan), Terapkan nonaktif", () => withEngineClock(async (clock) => {
  const h = await swView(clock);
  switchOf(h.tree).props.onClick({});
  await settle();
  const dlg = dialogOf(h.render());
  // anggota lain sudah menyalakan unit → hitung ulang: 0 item
  const rec = unitRec(null, "Alpha", { auto: true, by: 9 }, { updated_at: "2026-11-04T05:00:00Z" });
  putRec(h.fr, rec);
  dlg.props.onApply();
  await settle();
  await settle();
  assert.deepEqual(h.writes(), []);
  const again = dialogOf(h.render());
  assert.equal(again.props.model.rows.length, 0);
  const dt = child(again);
  assert.equal(txt(byCls(dt, "plg-timeline-pv-summary")[0]).trim(), "0 task bergeser");
  assert.equal(buttonByText(dt, "Terapkan").props.disabled, true);
  h.m.unmount();
}));

test("fix T8 #4/#6: membuka pratinjau menutup popover Kalender kerja (satu Esc = dialog saja); Esc di dialog terbuka → 0 tulis, dialog tertutup", () => withEngineClock((clock) => withPop(async (w) => {
  const h = await swView(clock);
  buttonByText(h.tree, "Kalender kerja").props.onClick({});
  assert.ok(popNode(h.render()), "popover kalender terbuka");
  switchOf(h.tree).props.onClick({});
  await settle();
  const tree = h.render();
  assert.equal(popNode(tree), undefined, "pratinjau menutup popover kalender");
  const dlg = dialogOf(tree);
  assert.ok(dlg);
  // pasang dialog sungguhan (efek → pendengar window), lalu Esc lewat window
  const dm = mount(dlg.type);
  dm.render(dlg.props);
  dm.flush();
  assert.equal(w.ls.filter((l) => l.type === "keydown").length, 1, "hanya pendengar dialog");
  w.fire("keydown", { key: "Escape", preventDefault() {}, stopPropagation() {} });
  assert.equal(dialogOf(h.render()), undefined, "Esc menutup dialog");
  dm.unmount();
  await settle();
  assert.deepEqual(h.writes(), []);
  h.m.unmount();
})));

test("fix T8 #5: Terapkan ditekan dua kali cepat → satu setMany, satu put", () => withEngineClock(async (clock) => {
  const h = await swView(clock);
  switchOf(h.tree).props.onClick({});
  await settle();
  const dlg = dialogOf(h.render());
  dlg.props.onApply();
  dlg.props.onApply(); // props basi (render belum terjadi)
  await settle();
  await settle();
  assert.deepEqual(h.writes().map((x) => x[0]), ["setMany", "put"]);
  h.m.unmount();
}));

// ── 1c-1 Task 9: aliran gestur di Gantt (R12, R13; K32, K33) ─────────────────────────────────────────────────
// Halaman project pribadi "Alpha"; record unit auto (kecuali manualUnit). Tanggal tersimpan bebas drift kecuali
// disebut. Jam mesin palsu + window palsu (pendengar seret).
const AL = { project: "Alpha" };
const fsDep = (id) => [{ t: { $task: id }, type: "FS", lag: 0 }];
const withAuto = (fn) => withEngineClock((clock) => withIx((w) => fn(clock, w)));
async function autoIx(clock, tasks, o) {
  const fr = fakeRecords();
  if (!(o && o.manualUnit)) putRec(fr, unitRec(null, "Alpha"));
  return ixSetup(tasks, Object.assign({ clock, records: fr }, o || {}));
}
const engReadyIn = (tree) => !!switchOf(tree); // tombol "Jadwal otomatis" hanya tampil saat mesin siap
// Seret bar k sejauh `days` hari kalender (zoom Minggu = 12 px/hari; bar ≥ 2 hari agar titik +10 px di zona geser,
// bukan tepi); frames() = cat bar (restore butuh cat).
function dragBy(h, w, clock, k, days) {
  const b = h.box(k);
  const y = h.cy(h.midY(k));
  const x0 = h.cx(b.x + 10);
  const el = fakeNode();
  h.bar(k).props.onPointerDown(pev(x0, y, { currentTarget: el }));
  w.fire("pointermove", pev(x0 + Math.sign(days) * 6, y));
  w.fire("pointermove", pev(x0 + days * 12, y));
  clock.frames();
  w.fire("pointerup", pev(x0 + days * 12, y));
  return { el, base: "translate(" + b.x + "px, " + (h.row(k).index * 32 + 8) + "px)" };
}
const lastToast = (h) => h.calls.toast[h.calls.toast.length - 1];
const settle2 = async () => { await settle(); await settle(); await settle(); };
const U4 = (start, duration) => ({ start, duration, constraint: null, mode: null }); // patch Urungkan (undoItems)

test("unit Manual tanpa penerus otomatis: seret = satu set + toast 'Jadwal diubah' (1b, tanpa ubah asersi lama)", () => withAuto(async (clock, w) => {
  const tasks = [mk(1, "A", { start: "2026-11-02", duration: 2 }, AL), mk(2, "B", { start: "2026-11-04", duration: 1, deps: fsDep(1) }, AL)];
  const h = await autoIx(clock, tasks, { manualUnit: true });
  assert.ok(engReadyIn(h.tree), "mesin siap");
  dragBy(h, w, clock, "1", 2);
  await settle2();
  assert.deepEqual(h.calls.set, [[1, { start: "2026-11-04" }]]);
  assert.equal(h.calls.setMany.length, 0, "penerus Manual tidak ikut");
  const t = lastToast(h);
  assert.deepEqual([t[0], t[1], t[2].label], ["Jadwal diubah", "success", "Urungkan"]);
  t[2].onClick();
  await settle2();
  assert.deepEqual(h.calls.setMany, [[{ taskId: 1, patch: { start: "2026-11-02" } }]]);
  h.m.unmount();
}));

test("unit otomatis: seret akar +2 hk dengan 3 turunan → satu setMany 4 item (gestur + turunan) + toast 'Jadwal diubah · 3 task ikut bergeser' + Urungkan → setMany nilai lama", () => withAuto(async (clock, w) => {
  const tasks = [
    mk(1, "A", { start: "2026-11-02", duration: 2 }, AL),
    mk(2, "B", { start: "2026-11-04", duration: 1, deps: fsDep(1) }, AL),
    mk(3, "C", { start: "2026-11-05", duration: 1, deps: fsDep(2) }, AL),
    mk(4, "D", { start: "2026-11-06", duration: 1, deps: fsDep(3) }, AL),
  ];
  const h = await autoIx(clock, tasks);
  assert.ok(engReadyIn(h.tree), "mesin siap");
  dragBy(h, w, clock, "1", 2);
  await settle2();
  assert.deepEqual(h.calls.set, [], "tidak ada set + setMany berpasangan");
  assert.deepEqual(h.calls.setMany, [[
    { taskId: 1, patch: { start: "2026-11-04" } }, { taskId: 2, patch: { start: "2026-11-06" } },
    { taskId: 3, patch: { start: "2026-11-09" } }, { taskId: 4, patch: { start: "2026-11-10" } },
  ]]);
  const t = lastToast(h);
  assert.deepEqual([t[0], t[1], t[2].label], ["Jadwal diubah · 3 task ikut bergeser", "success", "Urungkan"]);
  assert.equal(h.calls.toast.length, 1);
  t[2].onClick();
  await settle2();
  assert.deepEqual(h.calls.setMany[1], [
    { taskId: 1, patch: U4("2026-11-02", 2) }, { taskId: 2, patch: U4("2026-11-04", 1) },
    { taskId: 3, patch: U4("2026-11-05", 1) }, { taskId: 4, patch: U4("2026-11-06", 1) },
  ]);
  assert.equal(h.calls.set.length, 0);
  h.m.unmount();
}));

test("turunan 0 → set + 'Jadwal diubah'", () => withAuto(async (clock, w) => {
  const tasks = [mk(1, "A", { start: "2026-11-02", duration: 2 }, AL), mk(5, "E", { start: "2026-11-02", duration: 1 }, AL)];
  const h = await autoIx(clock, tasks);
  assert.ok(engReadyIn(h.tree));
  dragBy(h, w, clock, "1", 2);
  await settle2();
  assert.deepEqual(h.calls.set, [[1, { start: "2026-11-04" }]]);
  assert.equal(h.calls.setMany.length, 0);
  const t = lastToast(h);
  assert.deepEqual([t[0], t[1], t[2].label], ["Jadwal diubah", "success", "Urungkan"]);
  t[2].onClick();
  await settle2();
  assert.deepEqual(h.calls.setMany, [[{ taskId: 1, patch: { start: "2026-11-02" } }]]);
  h.m.unmount();
}));

test("turunan 21 → PreviewDialog, 0 tulis sebelum Terapkan", () => withAuto(async (clock, w) => {
  const tasks = [mk(1, "A", { start: "2026-11-02", duration: 2 }, AL)];
  for (let i = 0; i < 21; i++) tasks.push(mk(100 + i, "S" + i, { start: "2026-11-04", duration: 1, deps: fsDep(1) }, AL));
  const h = await autoIx(clock, tasks);
  assert.ok(engReadyIn(h.tree));
  const d = dragBy(h, w, clock, "1", 2);
  await settle2();
  assert.deepEqual(h.calls.set, []);
  assert.deepEqual(h.calls.setMany, [], "0 tulis sebelum Terapkan");
  assert.deepEqual(h.calls.toast, []);
  assert.equal(d.el.style.transform, d.base, "bar kembali sampai Terapkan");
  const dlg = dialogOf(h.rerender());
  assert.ok(dlg, "pratinjau terbuka");
  assert.equal(dlg.props.title, "Tinjau jadwal otomatis");
  assert.equal(dlg.props.model.rows.length, 22);
  assert.equal(dlg.props.model.rows[0].key, "1");
  // Batal → 0 tulis
  dlg.props.onCancel();
  assert.equal(dialogOf(h.rerender()), undefined);
  assert.deepEqual(h.calls.setMany, []);
  // seret lagi → Terapkan → satu setMany 22 item
  dragBy(h, w, clock, "1", 2);
  await settle2();
  dialogOf(h.rerender()).props.onApply();
  await settle2();
  assert.equal(h.calls.setMany.length, 1);
  assert.equal(h.calls.setMany[0].length, 22);
  assert.deepEqual(h.calls.setMany[0][0], { taskId: 1, patch: { start: "2026-11-04" } });
  assert.ok(h.calls.setMany[0].slice(1).every((x) => x.patch.start === "2026-11-06"));
  assert.equal(lastToast(h)[0], "Jadwal diterapkan · 22 task");
  assert.equal(h.calls.set.length, 0);
  h.m.unmount();
}));

test("seret task berpendahulu ke sebelum syaratnya → 0 tulis, bar kembali (restore), toast 'Tidak bisa lebih awal dari dependensinya'", () => withAuto(async (clock, w) => {
  const tasks = [mk(1, "A", { start: "2026-11-02", duration: 2 }, AL), mk(2, "B", { start: "2026-11-04", duration: 2, deps: fsDep(1) }, AL)];
  const h = await autoIx(clock, tasks);
  assert.ok(engReadyIn(h.tree));
  const d = dragBy(h, w, clock, "2", -1);
  assert.notEqual(d.base, undefined);
  await settle2();
  assert.deepEqual(h.calls.set, []);
  assert.deepEqual(h.calls.setMany, []);
  assert.deepEqual(h.calls.toast, [["Tidak bisa lebih awal dari dependensinya", "error"]]);
  assert.equal(d.el.style.transform, d.base, "bar kembali ke posisi semula");
  h.m.unmount();
}));

test("seret task berpendahulu ke setelah syarat → patch berisi constraint SNET tanggal jatuh", () => withAuto(async (clock, w) => {
  const tasks = [mk(1, "A", { start: "2026-11-02", duration: 2 }, AL), mk(2, "B", { start: "2026-11-04", duration: 2, deps: fsDep(1) }, AL)];
  const h = await autoIx(clock, tasks);
  assert.ok(engReadyIn(h.tree));
  dragBy(h, w, clock, "2", 2);
  await settle2();
  assert.deepEqual(h.calls.set, [[2, { start: "2026-11-06", constraint: { type: "SNET", date: "2026-11-06" } }]]);
  const t = lastToast(h);
  assert.equal(t[0], "Jadwal diubah");
  t[2].onClick();
  await settle2();
  assert.deepEqual(h.calls.setMany, [[{ taskId: 2, patch: U4("2026-11-04", 2) }]], "Urungkan menghapus SNET (null)");
  h.m.unmount();
}));

test("Alt+→ pada task otomatis = satu tulis per tekan (set/setMany), tombol ditahan saat busy diabaikan", () => withAuto(async (clock, w) => {
  // P = pendahulu kedua B: gestur pada P yang hilirnya menyentuh B yang sedang ditulis → diabaikan (tanpa antre)
  const tasks = [
    mk(1, "A", { start: "2026-11-02", duration: 2 }, AL),
    mk(2, "B", { start: "2026-11-04", duration: 1, deps: fsDep(1).concat(fsDep(3)) }, AL),
    mk(3, "P", { start: "2026-11-02", duration: 2 }, AL),
  ];
  let release = null;
  const h = await autoIx(clock, tasks, { setMany: () => new Promise((r) => { release = r; }) });
  assert.ok(engReadyIn(h.tree));
  const kev = (key, o) => Object.assign({ key, altKey: true, shiftKey: false, preventDefault() {} }, o || {});
  h.tableRow("1").props.onKeyDown(kev("ArrowRight"));
  h.bar("1").props.onKeyDown(kev("ArrowRight", { repeat: true })); // selama pemeriksaan → sibuk, diabaikan
  h.bar("2").props.onKeyDown(kev("ArrowRight")); // turunan ikut sibuk seketika
  await settle2();
  assert.deepEqual(h.calls.setMany, [[{ taskId: 1, patch: { start: "2026-11-03" } }, { taskId: 2, patch: { start: "2026-11-05" } }]]);
  h.bar("1").props.onKeyDown(kev("ArrowRight", { repeat: true })); // tulis masih berjalan → diabaikan (tanpa antre)
  const d = dragBy(h, w, clock, "3", 3); // P → Kam 5: B (sibuk) ikut bergeser → seluruh gestur diabaikan
  await settle2();
  assert.equal(h.calls.setMany.length, 1);
  assert.deepEqual(h.calls.set, []);
  assert.equal(d.el.style.transform, d.base, "bar P kembali");
  release();
  await settle2();
  assert.equal(h.calls.setMany.length, 1, "tekan yang diabaikan tidak diputar ulang");
  // tekan berikutnya dihitung dari nilai optimistis (props belum mengikuti)
  h.bar("1").props.onKeyDown(kev("ArrowRight"));
  await settle2();
  assert.deepEqual(h.calls.setMany[1], [{ taskId: 1, patch: { start: "2026-11-04" } }, { taskId: 2, patch: { start: "2026-11-06" } }]);
  release();
  await settle2();
  assert.deepEqual(h.calls.toast.map((t) => t[0]), ["Jadwal diubah · 1 task ikut bergeser", "Jadwal diubah · 1 task ikut bergeser"]);
  assert.equal(h.calls.set.length, 0);
  h.m.unmount();
}));

test("klik-jadwalkan di unit otomatis → akar baru {start, duration: 1}", () => withAuto(async (clock, w) => {
  const tasks = [mk(1, "A", { start: "2026-11-02", duration: 2 }, AL), mk(5, "E", {}, AL)];
  const h = await autoIx(clock, tasks);
  assert.ok(engReadyIn(h.tree));
  const x = h.cx(h.xOfIso("2026-11-10") + 5);
  const y = h.cy(h.midY("5"));
  h.slot("5").props.onPointerDown(pev(x, y));
  w.fire("pointerup", pev(x + 1, y));
  await settle2();
  assert.deepEqual(h.calls.set, [[5, { start: "2026-11-10", duration: 1 }]]);
  assert.equal(h.calls.setMany.length, 0);
  assert.equal(lastToast(h)[0], "Jadwal diubah");
  h.m.unmount();
}));

test("tautkan A→B (B otomatis) → deps + B dan hilirnya mengalir dalam satu setMany", () => withAuto(async (clock, w) => {
  const tasks = [
    mk(1, "A", { start: "2026-11-02", duration: 2 }, AL),
    mk(2, "B", { start: "2026-11-02", duration: 1 }, AL),
    mk(3, "C", { start: "2026-11-03", duration: 1, deps: fsDep(2) }, AL),
  ];
  const h = await autoIx(clock, tasks);
  assert.ok(engReadyIn(h.tree));
  linkDragOf(h, w)("1", "2");
  await settle2();
  assert.deepEqual(h.calls.set, []);
  assert.deepEqual(h.calls.setMany, [[
    { taskId: 2, patch: { deps: [{ t: { $task: 1 }, type: "FS", lag: 0 }], start: "2026-11-04" } },
    { taskId: 3, patch: { start: "2026-11-05" } },
  ]]);
  const t = lastToast(h);
  assert.equal(t[0], "Jadwal diubah · 1 task ikut bergeser");
  t[2].onClick();
  await settle2();
  assert.deepEqual(h.calls.setMany[1], [
    { taskId: 2, patch: Object.assign(U4("2026-11-02", 1), { deps: null }) },
    { taskId: 3, patch: U4("2026-11-03", 1) },
  ], "Urungkan memulihkan deps lama (tidak ada → null)");
  h.m.unmount();
}));

test("mesin belum siap/gagal: task otomatis (unit auto) → 0 tulis + 'Jadwal gagal disimpan'; task Manual → perilaku 1b", () => withAuto(async (clock, w) => {
  const tasks = [mk(1, "A", { start: "2026-11-02", duration: 2 }, AL), mk(6, "M", { start: "2026-11-02", duration: 2, mode: "manual" }, AL)];
  // belum siap: raf mesin tidak pernah dijalankan (status loading); unit sudah dimuat (auto)
  const h = await autoIx(clock, tasks, { noEngine: true });
  assert.ok(!engReadyIn(h.tree), "mesin belum siap");
  dragBy(h, w, clock, "1", 2);
  await settle2();
  assert.deepEqual(h.calls.set, []);
  assert.deepEqual(h.calls.setMany, []);
  assert.deepEqual(h.calls.toast, [["Jadwal gagal disimpan", "error"]]);
  dragBy(h, w, clock, "6", 2);
  await settle2();
  assert.deepEqual(h.calls.set, [[6, { start: "2026-11-04" }]], "Manual eksplisit → set 1b");
  assert.equal(lastToast(h)[0], "Jadwal diubah");
  h.m.unmount();
  // gagal: daftar lengkap pertama ditolak (status error); pemeriksaan sebelum tulis berikutnya berhasil
  let n = 0;
  const g = await autoIx(clock, tasks, { listImpl: () => (n++ === 0 ? Promise.reject(new Error("idb")) : Promise.resolve(tasks)) });
  assert.ok(!engReadyIn(g.tree), "mesin gagal");
  dragBy(g, w, clock, "1", 2);
  await settle2();
  assert.deepEqual(g.calls.set, []);
  assert.deepEqual(g.calls.setMany, []);
  assert.deepEqual(g.calls.toast, [["Jadwal gagal disimpan", "error"]]);
  dragBy(g, w, clock, "6", 2);
  await settle2();
  assert.deepEqual(g.calls.set, [[6, { start: "2026-11-04" }]]);
  g.m.unmount();
}));

test("drift di luar turunan tidak ikut setMany", () => withAuto(async (clock, w) => {
  const tasks = [
    mk(1, "A", { start: "2026-11-02", duration: 2 }, AL),
    mk(2, "B", { start: "2026-11-04", duration: 1, deps: fsDep(1) }, AL),
    // drift bukan turunan: X → D, D tersimpan Sen 2 padahal hasil hitung Rab 4
    mk(7, "X", { start: "2026-11-02", duration: 2 }, AL),
    mk(8, "D", { start: "2026-11-02", duration: 1, deps: fsDep(7) }, AL),
    // turunan drift yang tidak digeser gestur (SNET Jum 20 mendominasi; tersimpan Kam 19)
    mk(9, "E", { start: "2026-11-19", duration: 1, deps: fsDep(1), constraint: { type: "SNET", date: "2026-11-20" } }, AL),
    // di belakang jangkar Manual yang tidak bergeser: G (Manual, Sen 9) → H drift (tersimpan Sen 9, hitung Sel 10)
    mk(10, "G", { start: "2026-11-09", duration: 1, deps: fsDep(1), mode: "manual" }, AL),
    mk(11, "H", { start: "2026-11-09", duration: 1, deps: fsDep(10) }, AL),
  ];
  const h = await autoIx(clock, tasks);
  assert.ok(engReadyIn(h.tree));
  dragBy(h, w, clock, "1", 2);
  await settle2();
  assert.deepEqual(h.calls.setMany, [[{ taskId: 1, patch: { start: "2026-11-04" } }, { taskId: 2, patch: { start: "2026-11-06" } }]]);
  assert.equal(lastToast(h)[0], "Jadwal diubah · 1 task ikut bergeser");
  assert.deepEqual(h.calls.set, []);
  h.m.unmount();
}));

test("flowItems: item tanpa perubahan (deltaHk 0, nilai = tersimpan) dibuang → gestur tanpa efek diam (tanpa tulis/toast)", () => {
  const it = (key, before, patch) => ({ key, task: { id: Number(key) }, before, patch, deltaHk: 0, kind: "move" });
  const b = { start: "2026-11-04", duration: 1, constraint: { type: "SNET", date: "2026-11-04" }, mode: null };
  const same = it("1", b, { start: "2026-11-04" });
  const sameCst = it("2", b, { constraint: { date: "2026-11-04", type: "SNET" } }); // urutan kunci tidak relevan
  const moved = it("3", b, { start: "2026-11-05" });
  const cleared = it("4", b, { constraint: null });
  assert.deepEqual(T.flowItems([same, sameCst, moved, cleared]).map((x) => x.key), ["3", "4"]);
  // kasus T4: {start: null} pada task otomatis berpendahulu → mesin mengisi start = tersimpan → no-op
  const ctxTasks = [mk(1, "A", { start: "2026-11-02", duration: 2 }, AL), mk(2, "B", { start: "2026-11-04", duration: 1, deps: fsDep(1) }, AL)];
  const api = fakeApi().api;
  const units = new Map([[T.TLSched.unitOf(ctxTasks[0]).recId, { auto: true }]]);
  const ctx = { tasks: ctxTasks, cal: T.TLCal.compile(T.TLCal.DEFAULT_CAL), units, readExt: (t) => api.taskExt.read(t) };
  const c = T.TLPlan.cascade(ctx, [{ task: ctxTasks[1], patch: { start: null } }]);
  assert.equal(c.items.length, 1);
  assert.equal(c.items[0].deltaHk, 0);
  assert.deepEqual(T.flowItems(c.items), []);
});

test("sumber Task 9: teks persis + satu pintu flow untuk empat gestur", () => {
  for (const t of ['"Tidak bisa lebih awal dari dependensinya"', '"Jadwal diubah · "', '" task ikut bergeser"']) assert.ok(jsx.includes(t), t);
  const body = jsx.slice(jsx.indexOf("function createInteractions()"), jsx.indexOf("function TimelineViewBody("));
  for (const fn of ["finish", "link", "slotUp", "key"]) {
    const s = body.slice(body.indexOf("  function " + fn + "("));
    const f = s.slice(0, s.indexOf("\n  }\n"));
    assert.ok(/\bflow\(/.test(f), fn + " lewat flow()");
    assert.ok(!/\bwrite\(/.test(f), fn + " tidak memanggil write langsung");
  }
});

test("fix T9: Urungkan gestur antre di belakang tulis yang sedang berjalan (task sama); tekan berikutnya selama itu diabaikan", () => withAuto(async (clock) => {
  const tasks = [mk(1, "A", { start: "2026-11-02", duration: 2 }, AL), mk(2, "B", { start: "2026-11-04", duration: 1, deps: fsDep(1) }, AL)];
  const rel = [];
  const h = await autoIx(clock, tasks, { setMany: () => new Promise((r) => { rel.push(r); }) });
  assert.ok(engReadyIn(h.tree));
  const kev = (key) => ({ key, altKey: true, shiftKey: false, preventDefault() {} });
  h.bar("1").props.onKeyDown(kev("ArrowRight"));
  await settle2();
  rel.shift()();
  await settle2();
  const first = lastToast(h);
  assert.equal(first[0], "Jadwal diubah · 1 task ikut bergeser");
  h.bar("1").props.onKeyDown(kev("ArrowRight")); // tekan kedua: setMany masih terbang
  await settle2();
  assert.equal(h.calls.setMany.length, 2);
  first[2].onClick(); // Urungkan dari toast pertama
  await settle2();
  assert.equal(h.calls.setMany.length, 2, "Urungkan menunggu tulis yang sedang berjalan");
  h.bar("1").props.onKeyDown(kev("ArrowRight")); // masih sibuk → diabaikan
  await settle2();
  assert.equal(h.calls.setMany.length, 2);
  rel.shift()(); // tulis kedua selesai → Urungkan berjalan
  await settle2();
  assert.equal(h.calls.setMany.length, 3);
  assert.deepEqual(h.calls.setMany[2], [{ taskId: 1, patch: U4("2026-11-02", 2) }, { taskId: 2, patch: U4("2026-11-04", 1) }]);
  // selama Urungkan terbang, tekan berikutnya diabaikan (busy)
  h.bar("1").props.onKeyDown(kev("ArrowRight"));
  await settle2();
  assert.equal(h.calls.setMany.length, 3);
  rel.shift()();
  await settle2();
  h.m.unmount();
}));

// ── Task 10: banner jadwal belum mutakhir dan lingkaran (R16), Tinjau, Jadwalkan ulang (R17) ──
const bannersOf = (tree) => byCls(tree, "plg-timeline-banner");
const bannerText = (b) => txt(byCls(b, "plg-timeline-banner-text")[0]).trim();
const bannerBtn = (b, t) => nodes(b, (n) => n.type === "button" && (txt(n).trim() === t || n.props["aria-label"] === t))[0];
const driftTasks = () => [...chainTasks(), mk(5, "E", { start: "2026-11-02", duration: 1, deps: fsDep(4) }, AL)];
const autoRecs = () => {
  const fr = fakeRecords();
  putRec(fr, unitRec(null, "Alpha"));
  return fr;
};
const MSG_DRIFT4 = "Jadwal otomatis belum mutakhir: 4 task berbeda dari hasil hitung.";

test("drift 4 task di halaman → banner 'Jadwal otomatis belum mutakhir: 4 task berbeda dari hasil hitung.' + 'Tinjau' → dialog 'Tinjau jadwal otomatis' berisi 4 item; Terapkan = satu setMany", () => withEngineClock(async (clock) => {
  const h = await swView(clock, { records: autoRecs(), tasks: driftTasks() });
  const bs = bannersOf(h.tree);
  assert.equal(bs.length, 1, "satu banner (tanpa lingkaran)");
  assert.equal(bannerText(bs[0]), MSG_DRIFT4);
  assert.deepEqual(h.writes(), [], "banner tidak menulis");
  bannerBtn(bs[0], "Tinjau").props.onClick({});
  await settle();
  const dlg = dialogOf(h.render());
  assert.ok(dlg, "pratinjau terbuka");
  assert.equal(dlg.props.title, "Tinjau jadwal otomatis");
  assert.deepEqual(dlg.props.model.rows.map((r) => [r.key, r.from, r.to]), [
    ["2", "2026-11-02", "2026-11-04"], ["3", "2026-11-02", "2026-11-05"], ["4", "2026-11-02", "2026-11-06"], ["5", "2026-11-02", "2026-11-09"],
  ]);
  assert.equal(dlg.props.todayLabel, undefined, "Hari ini hanya untuk Jadwalkan ulang");
  assert.deepEqual(h.writes(), [], "0 tulis saat dibuka");
  dlg.props.onApply();
  await settle();
  await settle();
  assert.deepEqual(h.writes(), [["setMany", [
    { taskId: 2, patch: { start: "2026-11-04" } }, { taskId: 3, patch: { start: "2026-11-05" } },
    { taskId: 4, patch: { start: "2026-11-06" } }, { taskId: 5, patch: { start: "2026-11-09" } },
  ]]], "satu setMany lewat applyPlan");
  assert.ok(h.calls.toast.find((t) => t[0] === "Jadwal diterapkan · 4 task" && t[1] === "success"));
  h.m.unmount();
}));

test("drift di luar halaman (task tersaring panel tetapi di scope) tidak dihitung; banner tidak tampil saat loading", () => withEngineClock(async (clock) => {
  // loading: render pertama (mesin belum jalan) → tanpa banner
  {
    const { api } = fakeApi({ records: autoRecs() });
    api.data = { tasks: { list: () => Promise.resolve(driftTasks()) } };
    const m = mount(T.TimelineViewBody);
    const props = { context: ctxOf(driftTasks()).ctx, api };
    assert.equal(bannersOf(m.render(props)).length, 0);
    m.flush();
    await settle();
    assert.equal(bannersOf(m.render(props)).length, 0, "daftar dimuat, mesin belum jalan → tetap tanpa banner");
    m.unmount();
  }
  // C (id 3) tersaring panel: tetap di daftar lengkap/scope mesin, tetapi tidak dihitung di banner maupun Tinjau
  const all = driftTasks();
  const h = await swView(clock, { records: autoRecs(), tasks: all, ctx: { scopeTasks: all.filter((t) => t.id !== 3) } });
  const bs = bannersOf(h.tree);
  assert.equal(bs.length, 1);
  assert.equal(bannerText(bs[0]), "Jadwal otomatis belum mutakhir: 3 task berbeda dari hasil hitung.");
  bannerBtn(bs[0], "Tinjau").props.onClick({});
  await settle();
  assert.deepEqual(dialogOf(h.render()).props.model.rows.map((r) => r.key), ["2", "4", "5"]);
  h.m.unmount();
  // tanpa drift (unit Manual) → tanpa banner
  const n = await swView(clock, { tasks: driftTasks() });
  assert.equal(bannersOf(n.tree).length, 0);
  n.m.unmount();
}));

const cycleTasks = (n) => {
  const ids = Array.from({ length: n }, (_, i) => i + 1);
  return ids.map((id) => mk(id, String.fromCharCode(64 + id), { start: "2026-11-0" + (1 + id), duration: 1, deps: fsDep(id === 1 ? n : id - 1) }, AL));
};

test("lingkaran A↔B → 'Dependensi melingkar: A, B — tidak dihitung' + 'Buka' → onTaskClick(A)", () => withEngineClock(async (clock) => {
  const clicked = [];
  const h = await swView(clock, { tasks: cycleTasks(2), ctx: { page: "proj_Cyc2", onTaskClick: (t) => clicked.push(t) } });
  const bs = bannersOf(h.tree);
  assert.equal(bs.length, 1);
  assert.equal(bannerText(bs[0]), "Dependensi melingkar: A, B — tidak dihitung");
  bannerBtn(bs[0], "Buka").props.onClick({});
  assert.deepEqual(clicked.map((t) => t.id), [1]);
  assert.deepEqual(h.writes(), []);
  h.m.unmount();
  // > 3 anggota → 3 judul + "dan {n} lainnya"
  const f = await swView(clock, { tasks: cycleTasks(5), ctx: { page: "proj_Cyc5" } });
  assert.equal(bannerText(bannersOf(f.tree)[0]), "Dependensi melingkar: A, B, C dan 2 lainnya — tidak dihitung");
  f.m.unmount();
}));

test("Tutup → tidak tampil lagi sampai jumlah berubah, termasuk setelah view dipasang ulang (Set modul)", () => withEngineClock(async (clock) => {
  const page = { page: "proj_Tutup" };
  const h = await swView(clock, { tasks: cycleTasks(2), ctx: page });
  const close = bannerBtn(bannersOf(h.tree)[0], "Tutup");
  assert.equal(close.props["aria-label"], "Tutup");
  close.props.onClick({});
  assert.equal(bannersOf(h.render()).length, 0, "tertutup");
  h.m.unmount();
  const again = await swView(clock, { tasks: cycleTasks(2), ctx: page });
  assert.equal(bannersOf(again.tree).length, 0, "pasang ulang: tetap tertutup");
  again.m.unmount();
  const other = await swView(clock, { tasks: cycleTasks(2), ctx: { page: "proj_Lain" } });
  assert.equal(bannersOf(other.tree).length, 1, "halaman lain tidak ikut tertutup");
  other.m.unmount();
  const more = await swView(clock, { tasks: cycleTasks(3), ctx: page });
  assert.equal(bannerText(bannersOf(more.tree)[0]), "Dependensi melingkar: A, B, C — tidak dihitung", "jumlah berubah → tampil lagi");
  more.m.unmount();
  // drift: Tutup per jenis + n
  const d = await swView(clock, { records: autoRecs(), tasks: driftTasks(), ctx: page });
  bannerBtn(bannersOf(d.tree)[0], "Tutup").props.onClick({});
  assert.equal(bannersOf(d.render()).length, 0);
  d.m.unmount();
  const d2 = await swView(clock, { records: autoRecs(), tasks: driftTasks(), ctx: page });
  assert.equal(bannersOf(d2.tree).length, 0);
  d2.m.unmount();
  const d3 = await swView(clock, { records: autoRecs(), tasks: chainTasks(), ctx: page });
  assert.equal(bannerText(bannersOf(d3.tree)[0]), "Jadwal otomatis belum mutakhir: 3 task berbeda dari hasil hitung.");
  d3.m.unmount();
}));

const SAT = "2026-11-07"; // Sabtu → T = Senin 9 Nov
const reschedBtn = (tree) => buttonByText(tree, "Jadwalkan ulang");
const pvTexts = (dlg, cls) => byCls(child(dlg), cls).map((n) => txt(n).trim());

test("Jadwalkan ulang (today 2026-11-07 Sabtu → T Sen 9 Nov): dialog 'Jadwalkan ulang yang belum selesai' + 'Hari ini: Sab 7 Nov'; unit otomatis → SNET T + penerus; unit Manual → start T + '{n} dependensi akan dilanggar'; 0 item → Terapkan nonaktif", () => withEngineClock(async (clock) => {
  // unit otomatis: A (Jum 6, 2 hk) belum mulai, ES < T → SNET T (+ start T); B (ES Sel 10 ≥ T) hanya mengalir → Rab 11
  const autoT = [mk(1, "A", { start: "2026-11-06", duration: 2 }, AL), mk(2, "B", { start: "2026-11-10", duration: 1, deps: fsDep(1) }, AL)];
  const h = await swView(clock, { records: autoRecs(), tasks: autoT, today: SAT });
  const btn = reschedBtn(h.tree);
  assert.ok(btn && !btn.props.disabled, "tombol aktif");
  btn.props.onClick({});
  await settle();
  let dlg = dialogOf(h.render());
  assert.equal(dlg.props.title, "Jadwalkan ulang yang belum selesai");
  assert.equal(dlg.props.todayLabel, "Sab 7 Nov");
  assert.deepEqual(pvTexts(dlg, "plg-timeline-pv-today"), ["Hari ini: Sab 7 Nov"]);
  assert.deepEqual(dlg.props.model.rows.map((r) => [r.key, r.from, r.to]), [["1", "2026-11-06", "2026-11-09"], ["2", "2026-11-10", "2026-11-11"]]);
  assert.deepEqual(pvTexts(dlg, "plg-timeline-pv-broken"), [], "tanpa pelanggaran");
  assert.deepEqual(h.writes(), []);
  dlg.props.onCancel();
  assert.equal(dialogOf(h.render()), undefined);
  reschedBtn(h.tree).props.onClick({});
  await settle();
  dialogOf(h.render()).props.onApply();
  await settle();
  await settle();
  assert.deepEqual(h.writes(), [["setMany", [
    { taskId: 1, patch: { constraint: { type: "SNET", date: "2026-11-09" }, start: "2026-11-09" } },
    { taskId: 2, patch: { start: "2026-11-11" } },
  ]]]);
  h.m.unmount();
  // unit Manual: semua yang lewat → start T; penerus tidak dipindah → 2 dependensi dilanggar (reschedule().broken)
  const manT = [
    mk(1, "A", { start: "2026-11-02", duration: 2 }, AL),
    mk(2, "B", { start: "2026-11-04", duration: 1, deps: fsDep(1) }, AL),
    mk(3, "C", { start: "2026-11-05", duration: 1, deps: fsDep(2) }, AL),
    mk(4, "D", { start: "2026-11-20", duration: 1 }, AL),
  ];
  const m = await swView(clock, { tasks: manT, today: SAT });
  reschedBtn(m.tree).props.onClick({});
  await settle();
  dlg = dialogOf(m.render());
  assert.deepEqual(dlg.props.model.rows.map((r) => [r.key, r.to]), [["1", "2026-11-09"], ["2", "2026-11-09"], ["3", "2026-11-09"]]);
  assert.equal(dlg.props.broken, 2);
  assert.deepEqual(pvTexts(dlg, "plg-timeline-pv-broken"), ["2 dependensi akan dilanggar"]);
  assert.deepEqual(m.writes(), []);
  m.m.unmount();
  // 0 item → dialog tetap dibuka, Terapkan nonaktif, 0 tulis
  const z = await swView(clock, { records: autoRecs(), tasks: [mk(1, "A", { start: "2026-11-10", duration: 1 }, AL)], today: SAT });
  reschedBtn(z.tree).props.onClick({});
  await settle();
  dlg = dialogOf(z.render());
  assert.ok(dlg, "selalu pratinjau (R17)");
  assert.equal(dlg.props.model.rows.length, 0);
  const apply = nodes(child(dlg), (n) => n.type === "button" && txt(n).trim() === "Terapkan")[0];
  assert.equal(apply.props.disabled, true);
  assert.deepEqual(z.writes(), []);
  z.m.unmount();
}));

test("0 tulisan sampai Terapkan; Batal → 0", () => withEngineClock(async (clock) => {
  const h = await swView(clock, { records: autoRecs(), tasks: driftTasks(), today: SAT });
  // Tinjau → Batal
  bannerBtn(bannersOf(h.tree)[0], "Tinjau").props.onClick({});
  await settle();
  dialogOf(h.render()).props.onCancel();
  assert.equal(dialogOf(h.render()), undefined);
  // Jadwalkan ulang → Batal
  reschedBtn(h.tree).props.onClick({});
  await settle();
  assert.ok(dialogOf(h.render()));
  dialogOf(h.render()).props.onCancel();
  await settle();
  await h.again();
  assert.deepEqual(h.writes(), [], "0 tulis");
  assert.deepEqual(h.calls.toast, []);
  h.m.unmount();
}));

test("CAS Jadwalkan ulang: data berubah sebelum Terapkan → toast persis, 0 tulis, dihitung ulang dengan T yang sama", () => withEngineClock(async (clock) => {
  const tasks = [mk(1, "A", { start: "2026-11-02", duration: 1 }, AL), mk(2, "B", { start: "2026-11-03", duration: 1 }, AL)];
  const h = await swView(clock, { tasks, today: SAT });
  reschedBtn(h.tree).props.onClick({});
  await settle();
  const dlg = dialogOf(h.render());
  assert.deepEqual(dlg.props.model.rows.map((r) => r.key), ["1", "2"]);
  h.setList([tasks[0], mk(2, "B", { start: "2026-11-12", duration: 1 }, AL)]); // sinkron memindah B ke depan T
  dlg.props.onApply();
  await settle();
  await settle();
  assert.deepEqual(h.writes(), []);
  assert.deepEqual(h.calls.toast.map((t) => t.slice(0, 2)), [[MSG_STALE, "error"]]);
  const again = dialogOf(h.render());
  assert.deepEqual(again.props.model.rows.map((r) => [r.key, r.to]), [["1", "2026-11-09"]]);
  assert.equal(again.props.todayLabel, "Sab 7 Nov");
  again.props.onApply();
  await settle();
  await settle();
  assert.deepEqual(h.writes(), [["setMany", [{ taskId: 1, patch: { start: "2026-11-09" } }]]]);
  h.m.unmount();
}));

test("sumber Task 10: teks persis (R16, R17) dan CSS banner hanya token tema", () => {
  const src = fs.readFileSync(path.join(dir, "plugin.jsx"), "utf8");
  for (const s of ["Jadwal otomatis belum mutakhir: ", " task berbeda dari hasil hitung.", "Tinjau", "Dependensi melingkar: ", " — tidak dihitung", " lainnya",
    "Buka", "Jadwalkan ulang yang belum selesai", " dependensi akan dilanggar"]) {
    assert.ok(src.includes(s), s);
  }
  const css = fs.readFileSync(path.join(dir, "style.css"), "utf8");
  const block = css.slice(css.indexOf(".plg-timeline-banner"));
  assert.ok(css.includes(".plg-timeline-banner"), "kelas banner");
  assert.ok(!/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i.test(block.slice(0, block.indexOf("/* ──", 10) > 0 ? block.indexOf("/* ──", 10) : block.length)), "tanpa warna tetap");
});

// ── fix T10 (review): CAS unit untuk Tinjau/Jadwalkan ulang; Buka anggota di halaman; T lewat libur; unitKeys ──
const offRec = () => unitRec(null, "Alpha", { auto: false, by: 9 }, { updated_at: "2026-11-04T05:00:00Z" });

test("fix T10 #1: Jadwalkan ulang di unit otomatis; anggota lain mematikan Otomatis (onChange, updatedAt baru) → Terapkan ditolak, toast persis, 0 tulis, hitung ulang sebagai Manual", () => withEngineClock(async (clock) => {
  const autoT = [mk(1, "A", { start: "2026-11-06", duration: 2 }, AL), mk(2, "B", { start: "2026-11-10", duration: 1, deps: fsDep(1) }, AL)];
  const h = await swView(clock, { records: autoRecs(), tasks: autoT, today: SAT });
  reschedBtn(h.tree).props.onClick({});
  await settle();
  const dlg = dialogOf(h.render());
  assert.deepEqual(dlg.props.model.rows.map((r) => r.key), ["1", "2"], "otomatis: A + penerus B");
  const rec = offRec();
  putRec(h.fr, rec);
  h.fr.emit({ entity: "project", ids: [rec.id], source: "sync" });
  dlg.props.onApply();
  await settle();
  await settle();
  assert.deepEqual(h.writes(), [], "0 tulis");
  assert.deepEqual(h.calls.toast.map((t) => t.slice(0, 2)), [[MSG_STALE, "error"]]);
  const again = dialogOf(h.render());
  assert.ok(again, "dialog tetap terbuka");
  // Manual: hanya A (Mulai < T) → start T tanpa SNET; B tidak dipindah → 1 dependensi dilanggar
  assert.deepEqual(again.props.model.rows.map((r) => [r.key, r.to]), [["1", "2026-11-09"]]);
  assert.equal(again.props.broken, 1);
  again.props.onApply();
  await settle();
  await settle();
  assert.deepEqual(h.writes(), [["setMany", [{ taskId: 1, patch: { start: "2026-11-09" } }]]], "Terapkan kedua menulis rencana Manual");
  h.m.unmount();
}));

const m_flush = (h) => { if (typeof h.m.flush === "function") h.m.flush(); };
test("fix final 5: CAS auto terisolasi — record unit terbaru = potret (updatedAt/by sama) tetapi auto RENCANA (ctx.units mesin, debounce) ≠ auto terbaru → Terapkan ditolak, 0 tulis", () => withEngineClock(async (clock) => {
  const autoT = [mk(1, "A", { start: "2026-11-06", duration: 2 }, AL), mk(2, "B", { start: "2026-11-10", duration: 1, deps: fsDep(1) }, AL)];
  const h = await swView(clock, { records: autoRecs(), tasks: autoT, today: SAT });
  // anggota lain mematikan Otomatis: useUnits memuat ulang (debounce 300 ms) → un.units = record baru; mesin dijadwalkan
  // raf + setTimeout(0) tetapi raf BELUM dijalankan → eng.ctx.units masih auto (jendela debounce mesin).
  const rec = offRec();
  putRec(h.fr, rec);
  h.fr.emit({ entity: "project", ids: [rec.id], source: "sync" });
  clock.tick(300);
  await settle();
  await settle();
  h.render();
  m_flush(h);
  reschedBtn(h.render()).props.onClick({});
  await settle();
  const dlg = dialogOf(h.render());
  assert.deepEqual(dlg.props.model.rows.map((r) => r.key), ["1", "2"], "rencana masih otomatis (ctx.units mesin lama)");
  dlg.props.onApply();
  await settle();
  await settle();
  assert.deepEqual(h.writes(), [], "0 tulis: auto rencana (true) ≠ auto terbaru (false) walau updatedAt/by sama");
  assert.deepEqual(h.calls.toast.map((t) => t.slice(0, 2)), [[MSG_STALE, "error"]]);
  const again = dialogOf(h.render());
  assert.deepEqual(again.props.model.rows.map((r) => [r.key, r.to]), [["1", "2026-11-09"]], "hitung ulang sebagai Manual");
  again.props.onApply();
  await settle();
  await settle();
  assert.deepEqual(h.writes(), [["setMany", [{ taskId: 1, patch: { start: "2026-11-09" } }]]]);
  h.m.unmount();
}));

test("fix T10 #1: Tinjau; anggota lain mematikan Otomatis → Terapkan ditolak, 0 tulis, hitung ulang tanpa drift (0 item)", () => withEngineClock(async (clock) => {
  const h = await swView(clock, { records: autoRecs(), tasks: driftTasks() });
  bannerBtn(bannersOf(h.tree)[0], "Tinjau").props.onClick({});
  await settle();
  const dlg = dialogOf(h.render());
  assert.equal(dlg.props.model.rows.length, 4);
  const rec = offRec();
  putRec(h.fr, rec);
  h.fr.emit({ entity: "project", ids: [rec.id], source: "sync" });
  dlg.props.onApply();
  await settle();
  await settle();
  assert.deepEqual(h.writes(), []);
  assert.deepEqual(h.calls.toast.map((t) => t.slice(0, 2)), [[MSG_STALE, "error"]]);
  const again = dialogOf(h.render());
  assert.equal(again.props.model.rows.length, 0, "unit Manual → tidak ada drift");
  h.m.unmount();
}));

test("fix T10 #2: 'Buka' membuka anggota lingkaran pertama yang ADA di halaman (A tersaring panel → B)", () => withEngineClock(async (clock) => {
  const clicked = [];
  const all = cycleTasks(2);
  const h = await swView(clock, { tasks: all, ctx: { page: "proj_CycBuka", scopeTasks: all.filter((t) => t.id !== 1), onTaskClick: (t) => clicked.push(t) } });
  const b = bannersOf(h.tree)[0];
  assert.equal(bannerText(b), "Dependensi melingkar: A, B — tidak dihitung");
  bannerBtn(b, "Buka").props.onClick({});
  assert.deepEqual(clicked.map((t) => t.id), [2]);
  h.m.unmount();
}));

test("fix T10 #3: T lewat libur bernama di kalender unit (Sab 15 Agu → Senin 17 Agu libur Proklamasi → T Sel 18 Agu)", () => withEngineClock(async (clock) => {
  const h = await swView(clock, { tasks: [mk(1, "A", { start: "2026-08-10", duration: 1 }, AL)], today: "2026-08-15" });
  reschedBtn(h.tree).props.onClick({});
  await settle();
  const dlg = dialogOf(h.render());
  assert.equal(dlg.props.todayLabel, T.TLCal.fmtShort(T.TLCal.dn("2026-08-15")));
  assert.deepEqual(dlg.props.model.rows.map((r) => [r.key, r.to]), [["1", "2026-08-18"]]);
  h.m.unmount();
}));

test("fix T10 #3: workspace — unitKeys = unit halaman; task unit lain (tersaring panel, tetap di scope mesin) tidak dijadwalkan ulang", () => withEngineClock(async (clock) => {
  const s = wsSetup();
  const h = await swView(clock, { records: s.fr, tasks: s.tasks, today: SAT, ctx: Object.assign({}, s.ctx, { scopeTasks: s.tasks.filter((t) => t.id !== 2) }) });
  reschedBtn(h.tree).props.onClick({});
  await settle();
  const keys = dialogOf(h.render()).props.model.rows.map((r) => r.key);
  assert.deepEqual(keys.slice().sort(), ["1", "3", "4"], "Beta (task 2) di luar unit halaman");
  h.m.unmount();
}));

// ── Fix review Task 12: "Kenapa dijadwalkan di sini?" per baris PreviewDialog (R14 + R21) ─────────────────────────
// Spy pintu explain; buka baris pertama dialog lewat mount PreviewDialog (props dialog view apa adanya).
function spyExplain() {
  const orig = T.engine.explain;
  const spy = { calls: [], restore() { T.engine.explain = orig; } };
  T.engine.explain = (...a) => { spy.calls.push(a); return orig(...a); };
  return spy;
}
function whyOfRow(dlg, key) {
  const pm = mount(T.PreviewDialog);
  let t = pm.render(dlg.props);
  const row = nodes(t, (n) => hasCls(n, "plg-timeline-pv-row") && n.props["data-key"] === key)[0];
  const b = byCls(row, "plg-timeline-pv-why")[0];
  assert.equal(b.props["aria-expanded"], false);
  b.props.onClick();
  t = pm.render(dlg.props);
  const r2 = nodes(t, (n) => hasCls(n, "plg-timeline-pv-row") && n.props["data-key"] === key)[0];
  const p = byCls(r2, "plg-timeline-pv-whytext")[0];
  pm.unmount();
  return p ? txt(p) : null;
}

test("fix T12 #1: dialog pratinjau (sakelar ON, Tinjau, Jadwalkan ulang, gestur > 20) — baris dibuka → teks 'Kenapa' R21 atas hasil sesudah rencana; explain hanya saat dibuka", () => withEngineClock(async (clock) => {
  const spy = spyExplain();
  try {
    // sakelar ON: B pindah ke Rab 4 setelah A (selesai Sel 3)
    const h = await swView(clock);
    switchOf(h.tree).props.onClick({});
    await settle();
    const dlg = dialogOf(h.render());
    assert.equal(typeof dlg.props.whyOf, "function");
    assert.equal(spy.calls.length, 0, "dialog terbuka → explain belum dipanggil");
    assert.equal(whyOfRow(dlg, "2"), "Mulai Rab 4 Nov karena menunggu 1 A selesai Sel 3 Nov. Durasi 1 hari kerja, jadi selesai Rab 4 Nov.");
    assert.equal(spy.calls.length, 1, "explain hanya untuk baris yang dibuka");
    assert.equal(spy.calls[0][1], "2");
    assert.ok(spy.calls[0][0].nodes instanceof Map && spy.calls[0][0].nodes.get("2").es === T.TLCal.dn("2026-11-04"), "hasil SESUDAH rencana (baris dialog)");
    assert.equal(typeof spy.calls[0][3], "function", "readExt selalu diberikan");
    h.m.unmount();
    // Tinjau (drift): hasil mesin halaman
    const v = await swView(clock, { records: autoRecs(), tasks: driftTasks() });
    bannerBtn(bannersOf(v.tree)[0], "Tinjau").props.onClick({});
    await settle();
    const n0 = spy.calls.length;
    const d2 = dialogOf(v.render());
    assert.equal(spy.calls.length, n0);
    assert.equal(whyOfRow(d2, "3"), "Mulai Kam 5 Nov karena menunggu 2 B selesai Rab 4 Nov. Durasi 1 hari kerja, jadi selesai Kam 5 Nov.");
    assert.equal(spy.calls.length, n0 + 1);
    v.m.unmount();
    // Jadwalkan ulang: SNET T dari patch rencana (readExt = ext + patch item) → acuan batasan Sen 9 Nov
    const autoT = [mk(1, "A", { start: "2026-11-06", duration: 2 }, AL), mk(2, "B", { start: "2026-11-10", duration: 1, deps: fsDep(1) }, AL)];
    const r = await swView(clock, { records: autoRecs(), tasks: autoT, today: SAT });
    reschedBtn(r.tree).props.onClick({});
    await settle();
    const d3 = dialogOf(r.render());
    assert.equal(whyOfRow(d3, "1"), "Mulai Sen 9 Nov karena batasan: mulai tidak lebih awal dari Sen 9 Nov. Durasi 2 hari kerja, jadi selesai Sel 10 Nov.");
    assert.equal(whyOfRow(d3, "2"), "Mulai Rab 11 Nov karena menunggu 1 A selesai Sel 10 Nov. Durasi 1 hari kerja, jadi selesai Rab 11 Nov.");
    r.m.unmount();
  } finally {
    spy.restore();
  }
}));

test("fix T12 #1: pratinjau gestur > 20 turunan — baris dibuka → teks 'Kenapa' R21; explain hanya saat dibuka", () => withAuto(async (clock, w) => {
  const spy = spyExplain();
  try {
    const tasks = [mk(1, "A", { start: "2026-11-02", duration: 2 }, AL)];
    for (let i = 0; i < 21; i++) tasks.push(mk(100 + i, "S" + i, { start: "2026-11-04", duration: 1, deps: fsDep(1) }, AL));
    const h = await autoIx(clock, tasks);
    dragBy(h, w, clock, "1", 2);
    await settle2();
    const dlg = dialogOf(h.rerender());
    assert.ok(dlg && typeof dlg.props.whyOf === "function");
    assert.equal(spy.calls.length, 0);
    assert.equal(dlg.props.model.rows[0].key, "1");
    assert.equal(whyOfRow(dlg, "100"), "Mulai Jum 6 Nov karena menunggu " + dlg.props.model.rows[0].wbs + " A selesai Kam 5 Nov. Durasi 1 hari kerja, jadi selesai Jum 6 Nov.");
    assert.equal(spy.calls.length, 1);
    assert.deepEqual(h.calls.setMany, [], "membuka Kenapa tidak menulis");
    h.m.unmount();
  } finally {
    spy.restore();
  }
}));

test("fix final 2 (K32): pratinjau gestur > 20 ditolak CAS; sinkron menggeser turunan yang TIDAK digeser gestur → hitung ulang TIDAK mencantumkannya ('sebelum' dari ctx segar)", () => withAuto(async (clock, w) => {
  // A → S0..S20 (FS); D menunggu A dan X — D digerakkan X (selesai Jum 13 → D Sen 16), seret A +2 tidak menggeser D.
  const base = [mk(1, "A", { start: "2026-11-02", duration: 2 }, AL)];
  for (let i = 0; i < 21; i++) base.push(mk(100 + i, "S" + i, { start: "2026-11-04", duration: 1, deps: fsDep(1) }, AL));
  base.push(mk(50, "X", { start: "2026-11-09", duration: 5 }, AL));
  base.push(mk(60, "D", { start: "2026-11-16", duration: 1, deps: fsDep(50).concat(fsDep(1)) }, AL));
  let list = base;
  const h = await autoIx(clock, base, { listImpl: () => Promise.resolve(list) });
  dragBy(h, w, clock, "1", 2);
  await settle2();
  const dlg = dialogOf(h.rerender());
  assert.ok(dlg, "pratinjau > 20");
  const ks = (d) => d.props.model.rows.map((r) => r.key);
  assert.ok(!ks(dlg).includes("60"), "D tidak digeser gestur");
  // sinkron: X mulai Rab 11 (D kini hasil hitung Rab 18, tersimpan masih Sen 16) + S0 berubah (CAS gagal)
  list = base.map((t) => {
    if (t.id === 50) return mk(50, "X", { start: "2026-11-11", duration: 5 }, AL);
    if (t.id === 100) return mk(100, "S0", { start: "2026-11-05", duration: 1, deps: fsDep(1) }, AL);
    return t;
  });
  dlg.props.onApply();
  await settle2();
  assert.deepEqual(h.calls.setMany, [], "0 tulis");
  assert.deepEqual(h.calls.toast.map((t) => t.slice(0, 2)), [[MSG_STALE, "error"]]);
  const again = dialogOf(h.rerender());
  assert.ok(again, "dialog menghitung ulang");
  assert.ok(ks(again).includes("100"), "turunan gestur tetap tercantum");
  assert.ok(!ks(again).includes("60"), "D bergeser karena SINKRON, bukan gestur → tidak tercantum");
  h.m.unmount();
}));

// ════════════════════════════════════════════════════════════════════════════
// Fase 1 PR 1c-1 — Task 13: anggaran DOM dan kinerja (R24) dengan mesin, Jalur kritis, Slack, banner drift
// ════════════════════════════════════════════════════════════════════════════
// 500 task/400 dep (bigTasks) di workspace 12, lima project P0–P4 semuanya Otomatis → banyak drift; pref Jalur kritis ON.
function perfSetup() {
  const tasks = bigTasks(500, 400).map((t) => Object.assign(t, { list_id: 12 }));
  const fr = fakeRecords();
  for (let k = 0; k < 5; k++) putRec(fr, unitRec(12, "P" + k));
  const { api, calls } = fakeApi({ records: fr, storageGet: (k) => Promise.resolve(k === "crit:slist_12" ? true : null) });
  api.data = { tasks: { list: () => Promise.resolve(tasks) } };
  const writes = spyWrites(api);
  const { ctx } = ctxOf(tasks, { page: "slist_12", pageKind: "workspace", listId: 12, projectName: null });
  return { tasks, fr, api, calls, writes, props: { context: ctx, api } };
}
const slackCells = (tree) => {
  const i = headerCells(tree).indexOf("Slack");
  // baris task saja (baris kelompok project is-group tidak punya sel Slack berisi)
  return i < 0 ? [] : nodes(tree, (n) => n.props.role === "row" && n.props["aria-rowindex"] > 1 && !hasCls(n, "is-group")).map((r) => txt(cellsOf(r)[i]).trim());
};

test("DOM 500 task/400 dep, Jalur kritis ON, Slack, banner drift → ≤ 1.500 elemen", () => withEngineClock(async (clock) => {
  const s = perfSetup();
  const spy = spyRun();
  try {
    const m = mount(T.TimelineViewBody);
    const tree = await settleView(m, () => s.props, clock);
    assert.ok(spy.runs.length >= 1, "mesin sudah jalan");
    // semua beban tambahan 1c-1 hadir
    assert.equal(headerCells(tree).indexOf("Slack") >= 0, true, "kolom Slack");
    assert.ok(slackCells(tree).some((v) => /hk$|^0$/.test(v)), "nilai Slack terisi");
    const crit = buttonByText(tree, "Jalur kritis");
    assert.ok(crit, "sakelar Jalur kritis tampil (mesin siap)");
    assert.equal(crit.props["aria-pressed"], true, "Jalur kritis ON dari pref");
    assert.ok(nodes(tree, (n) => hasCls(n, "is-critical")).length > 0, "ada elemen is-critical");
    const bs = bannersOf(tree);
    assert.equal(bs.length >= 1, true, "banner drift tampil");
    assert.match(bannerText(bs[0]), /^Jadwal otomatis belum mutakhir: \d+ task berbeda dari hasil hitung\.$/);
    assert.ok(byCls(tree, "plg-timeline-arrow").length > 0, "ada panah");
    const rows = nodes(tree, (n) => n.props.role === "row" && n.props["aria-rowindex"] > 1);
    assert.ok(rows.length > 20 && rows.length <= 60, "baris tervirtualisasi: " + rows.length);
    // elemen = node pohon bertipe string (tag DOM); teks dan komponen tidak dihitung
    const n = domCount(tree);
    assert.ok(n <= 1500, "elemen: " + n);
    console.log("# DOM elemen 500 task/400 dep + Jalur kritis + Slack + banner: " + n);
    assert.deepEqual(s.writes, [], "0 tulisan latar");
    assert.equal(s.fr.calls.put.length, 0);
    m.unmount();
  } finally {
    spy.restore();
  }
}));

test("render awal tidak menjalankan TLCpm.run (spy) — mesin setelah raf+setTimeout", () => withEngineClock(async (clock) => {
  const s = perfSetup();
  const spy = spyRun(); // T.engine.run = satu-satunya pintu TLCpm.run di plugin (TLCpm beku, tidak bisa di-spy langsung)
  try {
    const m = mount(T.TimelineViewBody);
    let tree = m.render(s.props);
    assert.equal(spy.runs.length, 0, "render pertama tanpa mesin");
    assert.ok(domCount(tree) > 0, "tabel/grafik langsung tergambar");
    m.flush();
    await settle();
    tree = m.render(s.props); // pref terbaca, daftar + unit termuat; mesin dijadwalkan
    m.flush();
    await settle();
    tree = m.render(s.props);
    assert.equal(spy.runs.length, 0, "mesin belum jalan sebelum gambar pertama");
    assert.ok(headerCells(tree).indexOf("Slack") >= 0, "kolom Slack ada sejak awal (tanpa geser tata letak)");
    assert.ok(slackCells(tree).length > 0 && slackCells(tree).every((v) => v === "—"), "tanpa nilai Slack sebelum mesin");
    assert.equal(bannersOf(tree).length, 0, "tanpa banner sebelum mesin");
    assert.equal(nodes(tree, (n) => hasCls(n, "is-critical")).length, 0);
    assert.ok(clock.frames() >= 1, "raf terjadwal");
    assert.equal(spy.runs.length, 0, "raf hanya menjadwalkan setTimeout 0");
    clock.tick(0);
    assert.equal(spy.runs.length, 1, "mesin jalan setelah raf + setTimeout");
    tree = m.render(s.props);
    m.flush();
    await settle();
    tree = m.render(s.props);
    assert.ok(slackCells(tree).some((v) => v !== "—"), "nilai Slack ada setelah mesin");
    assert.equal(bannersOf(tree).length >= 1, true, "banner drift setelah mesin");
    assert.deepEqual(s.writes, [], "0 tulisan");
    m.unmount();
  } finally {
    spy.restore();
  }
}));

// 1c-2 T10 ("render awal tetap tanpa TLCpm.run"): tes di atas memakai perfSetup tanpa baseline/aktual, jadi tidak gagal bila
// overlay baru memanggil mesin saat render pertama. Ulang dengan view LENGKAP 1c-2: pref baseline slot 1 + record baseline
// lima unit + actual.start (blPerfSetup).
test("render awal tetap tanpa TLCpm.run — dengan baseline aktif + garis aktual (overlay 1c-2 terpasang)", () => withEngineClock(async (clock) => {
  const s = blPerfSetup();
  const spy = spyRun();
  try {
    const m = mount(T.TimelineViewBody);
    let tree = m.render(s.props);
    assert.equal(spy.runs.length, 0, "render pertama tanpa mesin");
    assert.ok(domCount(tree) > 0, "tabel/grafik langsung tergambar");
    m.flush();
    await settle();
    tree = m.render(s.props); // pref (crit + bl:slist_12 = 1), daftar, unit, baseline termuat; mesin dijadwalkan
    m.flush();
    await settle();
    tree = m.render(s.props);
    assert.equal(spy.runs.length, 0, "pref baseline + record baseline termuat tetap tanpa mesin sebelum gambar pertama");
    assert.ok(s.fr.calls.list.some((c) => c[0] === "baseline"), "record baseline sudah dimuat");
    assert.equal(blBars(tree).length, 0, "bar baseline menunggu mesin (tanpa hitung sinkron)");
    assert.ok(actLines(tree).length > 0, "garis aktual dari tata letak saja (tanpa mesin)");
    assert.ok(slackCells(tree).length > 0 && slackCells(tree).every((v) => v === "—"), "tanpa nilai Slack sebelum mesin");
    assert.equal(bannersOf(tree).length, 0);
    assert.ok(clock.frames() >= 1, "raf terjadwal");
    assert.equal(spy.runs.length, 0, "raf hanya menjadwalkan setTimeout 0");
    clock.tick(0);
    assert.equal(spy.runs.length, 1, "tepat satu run setelah raf + setTimeout");
    tree = m.render(s.props);
    m.flush();
    await settle();
    tree = m.render(s.props);
    assert.ok(blBars(tree).length > 0, "bar baseline setelah mesin");
    assert.ok(legendTexts(tree).indexOf("Baseline") >= 0 && legendTexts(tree).indexOf("Aktual") >= 0);
    assert.equal(spy.runs.length, 1, "overlay baseline/aktual tidak memicu run tambahan");
    assert.deepEqual(s.writes, [], "0 tulisan");
    assert.equal(s.fr.calls.put.length + s.fr.calls.remove.length, 0);
    m.unmount();
  } finally {
    spy.restore();
  }
}));

// Investigasi regresi render 1c-2 (task-12 concern 1): render pertama membaca ext tiap task scope TIGA kali (tata letak,
// anchorTasks, actualOverlay) — api.taskExt.read runtime menyalin dalam (JSON) tiap kunci. Satu bacaan per task per
// scopeTasks dibagi ketiganya; garis aktual + jangkar tetap sama (tes T6 / 1c-2 jangkar di atas).
test("regresi render 1c-2: render pertama membaca taskExt tiap task scope TEPAT sekali (tata letak, jangkar aktual, garis aktual berbagi bacaan)", () => withEngineClock(async () => {
  const s = blPerfSetup();
  const read0 = s.api.taskExt.read;
  const reads = new Map();
  s.api.taskExt.read = (t) => {
    reads.set(t.id, (reads.get(t.id) || 0) + 1);
    return read0(t);
  };
  const m = mount(T.TimelineViewBody);
  const tree = m.render(s.props);
  assert.ok(actLines(tree).length > 0, "garis aktual tetap tergambar di render pertama");
  assert.equal(reads.size, s.tasks.length, "setiap task scope dibaca");
  const multi = [...reads.values()].filter((n) => n > 1).length;
  assert.equal(multi, 0, "tidak ada task yang dibaca lebih dari sekali (sebelumnya 3×)");
  // render ulang dengan scopeTasks sama (setVp/pref) → memo tetap, tanpa bacaan baru
  reads.clear();
  m.render(s.props);
  assert.equal(reads.size, 0, "render ulang tanpa bacaan ext");
  m.unmount();
}));

// ── Fix 2 review Task 8: menu "Lainnya" tidak meluap di HP 375 px (E2E 12a) ───────────────────────────────────────
test("fix T8 r2: menu 'Lainnya' rata kanan tombol bila rata kiri meluap viewport (375 px, tombol x≈262); tombol di kiri (Daftar) tetap rata kiri", () => {
  assert.equal(T.menuAlign({ left: 262, right: 330 }, 375, 180), "end", "262 + 180 > 367 → rata kanan");
  assert.equal(T.menuAlign({ left: 8, right: 78 }, 375, 180), "start", "Daftar: tombol paling kiri → rata kiri (rata kanan meluap kiri)");
  assert.equal(T.menuAlign({ left: 150, right: 220 }, 375, 180), "start", "150 + 180 ≤ 367 → muat rata kiri");
  assert.equal(T.menuAlign({ left: 200, right: 270 }, 375, 180), "end");
  assert.equal(T.menuAlign({ left: 100, right: 170 }, 1280, 180), "start", "lebar: rata kiri seperti biasa");
  assert.equal(T.menuAlign(null, 375, 180), "start", "tanpa ukuran → bawaan");
  const prev = global.window;
  global.window = { innerWidth: 375, addEventListener() {}, removeEventListener() {} };
  try {
    const items = [{ id: "auto", text: "Jadwal otomatis", role: "menuitem" }];
    for (const [rect, end] of [[{ left: 262, right: 330 }, true], [{ left: 8, right: 78 }, false]]) {
      const m = mount(T.MoreMenu);
      let t = m.render({ items });
      nodes(t, (n) => hasCls(n, "plg-timeline-more"))[0].props.ref.current = { getBoundingClientRect: () => rect, contains: () => false };
      buttonByText(t, "Lainnya").props.onClick({});
      t = m.render({ items });
      const menu = nodes(t, (n) => n.props.role === "menu")[0];
      assert.equal(hasCls(menu, "is-end"), end, JSON.stringify(rect));
    }
  } finally {
    global.window = prev;
  }
  assert.match(css, /\.plg-timeline-more-menu\.is-end\s*\{[^}]*right:\s*0;[^}]*left:\s*auto;/);
  assert.match(css, /\.plg-timeline-more-menu\s*\{[^}]*max-width:\s*calc\(100vw - 16px\)/);
});

// ════════════════════════════════════════════════════════════════════════════
// Fase 1 PR 1c-2 — Task 5: toolbar "Baseline" (pilihan = pref bl:<page>) + "Simpan baseline" (dialog slot 1–3)
// ════════════════════════════════════════════════════════════════════════════
const blPickOf = (tree) => nodes(tree, (n) => n.type === T.BaselinePicker)[0];
const blDlgOf = (tree) => nodes(tree, (n) => n.type === T.SaveBaselineDialog)[0];
const radios = (tree, label) => {
  const g = nodes(tree, (n) => n.props.role === "radiogroup" && n.props["aria-label"] === label)[0];
  return g ? nodes(g, (n) => n.props.role === "radio") : [];
};
const radioTexts = (tree, label) => radios(tree, label).map((n) => txt(n).trim());
const blPuts = (fr) => fr.calls.put.filter((p) => p[0] === "baseline");
const blLists = (fr) => fr.calls.list.filter((l) => l[0] === "baseline");
const settleN = async (k) => { for (let i = 0; i < (k || 4); i++) await settle(); };
const MSG_BL_STALE = "Data berubah sejak dialog dibuka — muat ulang";
const MSG_BL_SAVE_FAIL = "Baseline gagal disimpan";

// Dialog simpan dipasang sebagai komponen anak tetap (state slot/nama/langkah miliknya); props selalu dari view terbaru.
function blDialog(h) {
  const dm = mount(T.SaveBaselineDialog);
  const d = {
    dm,
    tree: null,
    sync() {
      h.render();
      const nd = blDlgOf(h.tree);
      d.tree = nd ? dm.render(nd.props) : null;
      return nd;
    },
    btn: (t) => buttonByText(d.tree, t),
    click(t) { d.btn(t).props.onClick({}); d.sync(); },
    slot(n) { radios(d.tree, "Baseline")[n - 1].props.onClick({}); d.sync(); },
    unit(i) { radios(d.tree, "Project")[i].props.onClick({}); d.sync(); },
    name(v) { input(d.tree, "Nama").props.onChange({ target: { value: v } }); d.sync(); },
  };
  d.sync();
  return d;
}
function openBlDialog(h) {
  buttonByText(h.tree, "Simpan baseline").props.onClick({});
  h.render();
  assert.ok(blDlgOf(h.tree), "dialog Simpan baseline terbuka");
  return blDialog(h);
}

test("1c-2 T5: Baseline · Simpan baseline di antara Jalur kritis dan Jadwalkan ulang; Lainnya (≤ 640 px / Live Edit) memuat keduanya; mesin belum siap → keduanya tidak tampil", () => withEngineClock(async (clock) => {
  const { api } = fakeApi();
  api.data = { tasks: { list: () => Promise.resolve(chainTasks()) } };
  const m0 = mount(T.TimelineViewBody);
  const props0 = { context: ctxOf(chainTasks()).ctx, api };
  m0.render(props0);
  const t0 = m0.render(props0);
  assert.equal(buttonByText(t0, "Baseline"), undefined, "mesin belum siap");
  assert.equal(buttonByText(t0, "Simpan baseline"), undefined);
  m0.unmount();
  const h = await swView(clock);
  const tt = toolbarTexts(h.tree);
  assert.deepEqual(tt.slice(tt.indexOf("Jalur kritis"), tt.indexOf("Jadwalkan ulang") + 1), ["Jalur kritis", "Beban Tim", "Baseline", "Simpan baseline", "Jadwalkan ulang"]); // 1d-1 T4
  const b = buttonByText(h.tree, "Baseline");
  assert.equal(b.props["aria-haspopup"], "menu");
  assert.equal(b.props["aria-expanded"], false);
  assert.equal(buttonByText(h.tree, "Simpan baseline").props["aria-haspopup"], "dialog");
  h.m.unmount();
  const le = await swView(clock, { ctx: { liveEdit: true } });
  const items = moreOf(le.tree).props.items;
  const blIt = items.find((it) => it.text === "Baseline");
  assert.equal(blIt.haspopup, "menu");
  assert.equal(items.find((it) => it.text === "Simpan baseline").haspopup, "dialog");
  // dari Lainnya: Baseline membuka pemilih, Simpan baseline membuka dialog
  blIt.onSelect();
  le.render();
  assert.ok(blPickOf(le.tree));
  items.find((it) => it.text === "Simpan baseline").onSelect();
  le.render();
  assert.ok(blDlgOf(le.tree));
  assert.equal(blPickOf(le.tree), undefined, "satu lapisan: dialog menutup pemilih");
  le.m.unmount();
}));

test("1c-2 T5: pemilih Baseline — 'Tidak ada' + 'Baseline {n}' (nama slot bila ada); pilih = HANYA pref bl:<page> (0 tulis record); pref terbaca lagi; nilai rusak → Tidak ada", () => withEngineClock(async (clock) => {
  const fr = fakeRecords();
  putRec(fr, blRec(null, "Alpha", 1, { name: "Rencana awal" }));
  putRec(fr, blRec(null, "Alpha", 3, { v: 2 })); // asing: terdaftar, tanpa nama
  const h = await swView(clock, { records: fr });
  buttonByText(h.tree, "Baseline").props.onClick({});
  h.render();
  assert.equal(buttonByText(h.tree, "Baseline").props["aria-expanded"], true);
  const node = blPickOf(h.tree);
  const pm = mount(T.BaselinePicker);
  let pt = pm.render(node.props);
  const menu = nodes(pt, (n) => n.props.role === "menu")[0];
  assert.equal(menu.props["aria-label"], "Baseline");
  const its = nodes(menu, (n) => n.type === "button");
  assert.deepEqual(its.map((n) => [txt(n).trim(), n.props.role, n.props["aria-checked"]]), [
    ["Tidak ada", "menuitemradio", true], ["Rencana awal", "menuitemradio", false], ["Baseline 2", "menuitemradio", false], ["Baseline 3", "menuitemradio", false],
  ]);
  its[2].props.onClick({});
  await settle();
  h.render();
  assert.equal(blPickOf(h.tree), undefined, "memilih menutup pemilih");
  assert.deepEqual(h.calls.storageSet.filter((s) => s[0].indexOf("bl:") === 0), [["bl:proj_alpha", 2]]);
  assert.ok(nodes(h.tree, (n) => n.type === "button" && txt(n).trim() === "Baseline" && hasCls(n, "is-active")).length === 1, "pilihan ≠ Tidak ada → tombol aktif");
  assert.equal(fr.calls.put.length + fr.calls.remove.length, 0, "pilihan baseline tidak pernah menulis record (P2 a)");
  // pref round-trip: dibaca dari api.storage saat pasang
  h.m.unmount();
  for (const [stored, want] of [[1, 1], [3, 3], ["2", 0], [7, 0], [null, 0]]) {
    const fr2 = fakeRecords();
    const { api } = fakeApi({ records: fr2, storageGet: (k) => Promise.resolve(k === "bl:proj_alpha" ? stored : null) });
    api.env.userId = 7;
    api.data = { tasks: { list: () => Promise.resolve(chainTasks()) } };
    const m = mount(T.TimelineViewBody);
    const props = { context: ctxOf(chainTasks()).ctx, api };
    let tree = await settleView(m, () => props, clock);
    buttonByText(tree, "Baseline").props.onClick({});
    tree = m.render(props);
    assert.equal(blPickOf(tree).props.value, want, "tersimpan " + JSON.stringify(stored));
    m.unmount();
  }
}));

test("1c-2 T5: activeBaseline — slot pref dari semua unit halaman digabung (urutan unit); asing / kosong → baris kosong; 0 → null", () => {
  const a = blUnit(12, "Alpha");
  const b = blUnit(12, "Beta");
  const dec = (rows) => ({ n: 1, foreign: false, name: "x", rows: new Map(rows) });
  const byUnit = new Map([
    [a.recId, new Map([[1, dec([["1", { s: 1, f: 2, d: 2 }], ["9", { s: 5, f: 5, d: 1 }]])], [2, { n: 2, foreign: true, rows: new Map() }]])],
    [b.recId, new Map([[1, dec([["2", { s: 3, f: 3, d: 1 }], ["9", { s: 7, f: 7, d: 1 }]])]])],
  ]);
  assert.equal(T.activeBaseline(byUnit, [a.recId, b.recId], 0), null);
  const one = T.activeBaseline(byUnit, [a.recId, b.recId], 1);
  assert.equal(one.n, 1);
  assert.deepEqual([...one.rows.keys()], ["1", "9", "2"]);
  assert.deepEqual(one.rows.get("9"), { s: 5, f: 5, d: 1 }, "kunci ganda lintas unit → unit pertama menang");
  assert.equal(T.activeBaseline(byUnit, [a.recId, b.recId], 2).rows.size, 0, "slot asing → pembanding kosong");
  assert.equal(T.activeBaseline(byUnit, [a.recId, b.recId], 3).rows.size, 0, "slot kosong → pembanding kosong");
  assert.equal(T.activeBaseline(new Map(), [], 1).rows.size, 0);
});

test("1c-2 T5: Simpan baseline — slot 1–3 (nama + 'disimpan {tanggal}'), nama bawaan 'Baseline {n}'; slot kosong tanpa konfirmasi → SATU records.put dari hasil useEngine (g = unit); terisi → 'Timpa {nama} (disimpan {tanggal})?'; Batal → 0 tulis", () => withEngineClock(async (clock) => {
  const fr = fakeRecords();
  putRec(fr, blRec(null, "Alpha", 1, { name: "Rencana awal" }));
  const spy = spyRun();
  try {
    const h = await swView(clock, { records: fr });
    const unit = blUnit(null, "Alpha");
    let d = openBlDialog(h);
    const dlg = nodes(d.tree, (n) => n.props.role === "dialog")[0];
    assert.equal(dlg.props["aria-modal"], "true");
    assert.equal(dlg.props["aria-label"], "Simpan baseline");
    assert.deepEqual(radios(d.tree, "Project"), [], "halaman project: unit = halaman, tanpa pemilih");
    assert.deepEqual(radioTexts(d.tree, "Baseline"), ["Rencana awal · disimpan Rab 4 Nov", "Baseline 2", "Baseline 3"]);
    assert.equal(radios(d.tree, "Baseline")[0].props["aria-checked"], true, "bawaan slot 1");
    assert.equal(input(d.tree, "Nama").props.value, "Baseline 1");
    assert.equal(input(d.tree, "Nama").props.maxLength, 40);
    // Batal → 0 tulis
    d.click("Batal");
    assert.equal(blDlgOf(h.tree), undefined);
    // slot kosong 2 → tanpa konfirmasi, satu put
    d = openBlDialog(h);
    d.slot(2);
    assert.equal(input(d.tree, "Nama").props.value, "Baseline 2", "nama bawaan ikut slot selama belum diubah");
    const gets0 = fr.calls.get.length;
    d.click("Simpan baseline");
    await settleN();
    h.render();
    const run = spy.runs[spy.runs.length - 1];
    const want = T.TLPlan.baselineEncode(run.result, run.ctx, { n: 2, name: "Baseline 2", savedAt: TODAY, by: 7 }, unit.recId).data;
    assert.deepEqual(blPuts(fr), [["baseline", "bl2" + unit.recId.slice(3), want, { scope: "user" }]]);
    assert.equal(want.t.length, 4);
    assert.equal(fr.calls.get.length, gets0 + 1, "CAS baca slot dulu");
    assert.equal(blDlgOf(h.tree), undefined, "sukses → dialog tertutup");
    assert.deepEqual(h.calls.toast[h.calls.toast.length - 1], ["Baseline 2 disimpan", "success"]);
    // slot terisi → konfirmasi; Batal di konfirmasi → 0 tulis
    d = openBlDialog(h);
    d.name("  Rencana revisi  ");
    d.click("Simpan baseline");
    assert.equal(txt(byCls(d.tree, "plg-timeline-bl-confirm-text")[0]).trim(), "Timpa Rencana awal (disimpan Rab 4 Nov)?");
    assert.equal(blPuts(fr).length, 1);
    d.click("Batal");
    assert.equal(blDlgOf(h.tree), undefined);
    assert.equal(blPuts(fr).length, 1, "Batal konfirmasi → 0 tulis");
    // terisi → Timpa → satu put (nama dipangkas); klik ganda saat busy = satu put
    d = openBlDialog(h);
    d.name("  Rencana revisi  ");
    d.click("Simpan baseline");
    const timpa = d.btn("Timpa");
    timpa.props.onClick({});
    timpa.props.onClick({});
    await settleN();
    h.render();
    assert.equal(blPuts(fr).length, 2);
    assert.equal(blPuts(fr)[1][1], "bl1" + unit.recId.slice(3));
    assert.equal(blPuts(fr)[1][2].name, "Rencana revisi");
    assert.equal(fr.calls.remove.length, 0);
    h.m.unmount();
  } finally {
    spy.restore();
  }
}));

test("1c-2 T5: Esc = Batal (0 tulis, propagasi dihentikan); fokus ke kontrol pertama; nama > 40 dipotong, kosong → 'Baseline {n}'", () => withEngineClock((clock) => withPop(async (w) => {
  const fr = fakeRecords();
  const h = await swView(clock, { records: fr });
  let d = openBlDialog(h);
  const doc = { activeElement: null };
  const f1 = { focus() { doc.activeElement = this; } };
  const f2 = { focus() { doc.activeElement = this; } };
  nodes(d.tree, (n) => n.props.role === "dialog")[0].props.ref.current = { ownerDocument: doc, focus() {}, contains: (t) => t === f1 || t === f2, querySelectorAll: () => [f1, f2] };
  d.dm.flush();
  assert.equal(doc.activeElement, f1);
  let stopped = 0;
  w.fire("keydown", { key: "Escape", preventDefault() {}, stopPropagation() { stopped++; } });
  assert.equal(stopped, 1);
  d.sync();
  assert.equal(blDlgOf(h.tree), undefined, "Esc menutup");
  d.dm.unmount();
  assert.equal(w.ls.filter((l) => l.type === "keydown").length, 0, "pendengar dilepas");
  // nama panjang / kosong
  d = openBlDialog(h);
  d.name("x".repeat(39) + "🌸🌸");
  d.click("Simpan baseline");
  await settleN();
  assert.equal(blPuts(fr)[0][2].name, "x".repeat(39), "potong 40 unit tanpa memisah pasangan surrogate");
  d = openBlDialog(h);
  d.slot(2);
  d.name("   ");
  d.click("Simpan baseline");
  await settleN();
  assert.equal(blPuts(fr)[1][2].name, "Baseline 2");
  assert.equal(fr.calls.put.length, 2);
  h.m.unmount();
})));

test("1c-2 T5: slot asing (record klien lebih baru) tampil TERISI '(versi lebih baru)'; konfirmasi 'Timpa (versi lebih baru) (disimpan {tanggal})?'; Timpa memakai snap loadAll → satu put", () => withEngineClock(async (clock) => {
  const fr = fakeRecords();
  putRec(fr, blRec(null, "Alpha", 3, { v: 2 }, { updated_at: "2026-11-03T18:00:00Z" })); // 01.00 WIB Rab 4 Nov
  const h = await swView(clock, { records: fr });
  const d = openBlDialog(h);
  assert.deepEqual(radioTexts(d.tree, "Baseline"), ["Baseline 1", "Baseline 2", "(versi lebih baru) · disimpan Rab 4 Nov"]);
  d.slot(3);
  d.click("Simpan baseline");
  assert.equal(txt(byCls(d.tree, "plg-timeline-bl-confirm-text")[0]).trim(), "Timpa (versi lebih baru) (disimpan Rab 4 Nov)?");
  d.click("Timpa");
  await settleN();
  assert.equal(blPuts(fr).length, 1);
  assert.equal(blPuts(fr)[0][2].v, 1);
  assert.equal(h.calls.toast.filter((t) => t[1] === "error").length, 0, "bukan STALE");
  h.m.unmount();
}));

test("1c-2 T5: STALE — slot diisi anggota lain sejak dialog dibuka → toast 'Data berubah sejak pratinjau dibuka — hitung ulang', 0 put, dialog memuat potret baru → konfirmasi Timpa → satu put", () => withEngineClock(async (clock) => {
  const fr = fakeRecords();
  const h = await swView(clock, { records: fr });
  const d = openBlDialog(h);
  assert.equal(radioTexts(d.tree, "Baseline")[0], "Baseline 1");
  putRec(fr, blRec(null, "Alpha", 1, { name: "Punya Sari", by: 9 }, { updated_at: "2026-11-04T05:00:00Z" })); // tanpa peristiwa
  d.click("Simpan baseline");
  await settleN();
  d.sync();
  assert.equal(blPuts(fr).length, 0);
  assert.deepEqual(h.calls.toast[h.calls.toast.length - 1], [MSG_BL_STALE, "error"]);
  assert.ok(blDlgOf(h.tree), "dialog tetap terbuka");
  assert.equal(radioTexts(d.tree, "Baseline")[0], "Punya Sari · disimpan Rab 4 Nov", "potret segar");
  d.click("Simpan baseline");
  assert.equal(txt(byCls(d.tree, "plg-timeline-bl-confirm-text")[0]).trim(), "Timpa Punya Sari (disimpan Rab 4 Nov)?");
  d.click("Timpa");
  await settleN();
  assert.equal(blPuts(fr).length, 1);
  h.m.unmount();
}));

// Fixture ukuran eksak: task Manual Alpha Mulai Sen 2 Nov durasi 1, id 5 digit (10000+i) atau 6 digit (100000+i) —
// tiap id 6 digit menambah tepat 1 byte, jadi jumlah baris + digit menyetel ukuran data ke byte yang diinginkan.
function blBigTasks(k, six) {
  const out = [];
  for (let i = 0; i < k; i++) out.push(mk(i < six ? 100000 + i : 10000 + i, "T", { start: "2026-11-02", duration: 1 }, { project: "Alpha" }));
  return out;
}
const blSizeOf = (tasks, name) => T.TLPlan.baselineByteSize({ v: 1, n: 1, name, savedAt: TODAY, by: 7, t: tasks.map((t) => [{ $task: t.id }, "2026-11-02", "2026-11-02", 1, 0]) });

test("1c-2 T5: batas BL_MAX di UI — data tepat 65536 byte → satu put; 65537 → toast 'Baseline terlalu besar', 0 put (dan 0 baca)", () => withEngineClock(async (clock) => {
  let k = Math.floor((65536 - blSizeOf([], "B")) / (blSizeOf(blBigTasks(2, 0), "B") - blSizeOf(blBigTasks(1, 0), "B")));
  while (blSizeOf(blBigTasks(k, 0), "B") > 65536) k--;
  const six = 65536 - blSizeOf(blBigTasks(k, 0), "B");
  assert.ok(six >= 0 && six < k);
  const tasks = blBigTasks(k, six);
  assert.equal(blSizeOf(tasks, "B"), 65536);
  const fr = fakeRecords();
  const h = await swView(clock, { records: fr, tasks });
  let d = openBlDialog(h);
  d.name("B");
  d.click("Simpan baseline");
  await settleN();
  assert.equal(blPuts(fr).length, 1);
  assert.equal(T.TLPlan.baselineByteSize(blPuts(fr)[0][2]), 65536, "fixture = byte yang benar-benar ditulis");
  assert.equal(blPuts(fr)[0][2].t.length, k);
  d = openBlDialog(h);
  d.slot(2);
  d.name("BB");
  const gets = fr.calls.get.length;
  d.click("Simpan baseline");
  await settleN();
  assert.equal(blPuts(fr).length, 1, "65537 → 0 put");
  assert.equal(fr.calls.get.length, gets, "ditolak sebelum baca");
  assert.deepEqual(h.calls.toast[h.calls.toast.length - 1], ["Baseline terlalu besar", "error"]);
  h.m.unmount();
}));

test("1c-2 T5: workspace — SATU list baseline se-scope untuk semua unit; dialog memilih project dulu; kunci 'Menunggu data baseline workspace…' + Simpan nonaktif sampai pulled; simpan Beta → put bl1@list:12:<hBeta> berisi task Beta saja", () => withEngineClock(async (clock) => {
  const ws = wsSetup();
  putRec(ws.fr, blRec(12, "Alpha", 1, { name: "Awal Alpha" }));
  const spy = spyRun();
  try {
    const h = await swView(clock, { records: ws.fr, tasks: ws.tasks, ctx: ws.ctx });
    const loads = blLists(ws.fr).length;
    assert.ok(loads >= 1);
    assert.ok(blLists(ws.fr).every((l) => l[1].scope === "list:12"));
    assert.equal(new Set(blLists(ws.fr).map((l) => JSON.stringify(l[1]))).size, 1, "tidak ada list per unit");
    const d = openBlDialog(h);
    assert.deepEqual(radioTexts(d.tree, "Project"), ["Alpha", "Beta", "Gamma", "(Tanpa project)"]);
    assert.equal(radios(d.tree, "Project")[0].props["aria-checked"], true);
    // Alpha: slot 1 ada lokal (terbuka), slot 2/3 menunggu
    assert.deepEqual(radios(d.tree, "Baseline").map((r) => !!r.props.disabled), [false, true, true]);
    assert.equal(txt(nodes(d.tree, (n) => hasCls(n, "plg-timeline-bl-wait"))[0]).trim(), "Menunggu data baseline workspace…");
    d.unit(1); // Beta: semua slot menunggu
    assert.deepEqual(radios(d.tree, "Baseline").map((r) => !!r.props.disabled), [true, true, true]);
    assert.equal(d.btn("Simpan baseline").props.disabled, true);
    d.click("Simpan baseline");
    await settleN();
    assert.equal(blPuts(ws.fr).length, 0);
    // tarik sukses → terbuka
    ws.fr.emit(PULLED);
    await settleN();
    d.sync();
    assert.equal(nodes(d.tree, (n) => hasCls(n, "plg-timeline-bl-wait")).length, 0);
    assert.equal(d.btn("Simpan baseline").props.disabled, false);
    assert.equal(blLists(ws.fr).length, loads + 1, "muat ulang sesudah pulled = satu list se-scope");
    d.slot(1);
    d.click("Simpan baseline");
    await settleN();
    const beta = blUnit(12, "Beta");
    assert.equal(blPuts(ws.fr).length, 1);
    const p = blPuts(ws.fr)[0];
    assert.equal(p[1], "bl1" + beta.recId.slice(3));
    assert.deepEqual(p[3], { scope: "list:12" });
    assert.deepEqual(p[2].t.map((r) => r[0]), [{ $task: 2 }], "g = recId unit terpilih");
    h.m.unmount();
  } finally {
    spy.restore();
  }
}));

test("sumber Task 5 (1c-2): teks persis §7.6; simpan hanya lewat baselineStore (pagar R25), pilihan lewat usePref 'bl'", () => {
  for (const t of ['"Baseline"', '"Simpan baseline"', '"Tidak ada"', '"Baseline terlalu besar"', '"Menunggu data baseline workspace…"', '"Timpa "', '" (disimpan "', '"(versi lebih baru)"',
    '"Baseline gagal disimpan"', '"Baseline gagal dihapus"', '"Data berubah sejak dialog dibuka — muat ulang"', '"Hapus "', '" dihapus"']) {
    assert.ok(jsx.includes(t), t);
  }
  assert.match(jsx, /usePref\(api, "bl", page\)/);
  assert.equal((jsx.match(/records\.put\(/g) || []).length, 4, "tidak ada situs records.put baru (calendar, project, baseline; 1d-1 Task 2: + resource lewat saveResource)");
});

// ── Fix review Task 5 (1c-2): teks toast baseline, potret dialog ikut pulled, hapus baseline ────────────────────────
const delBtns = (tree) => nodes(tree, (n) => n.type === "button" && hasCls(n, "plg-timeline-bl-del"));
const confirmText = (tree) => txt(byCls(tree, "plg-timeline-bl-confirm-text")[0]).trim();

test("fix T5 #1: put ditolak (galat lain) → toast 'Baseline gagal disimpan', dialog tetap terbuka (tidak sibuk)", () => withEngineClock(async (clock) => {
  const fr = fakeRecords();
  const h = await swView(clock, { records: fr });
  fr.api.put = () => Promise.reject(Object.assign(new Error("idb"), { code: "IDB" }));
  const d = openBlDialog(h);
  d.click("Simpan baseline");
  await settleN();
  d.sync();
  assert.deepEqual(h.calls.toast[h.calls.toast.length - 1], [MSG_BL_SAVE_FAIL, "error"]);
  assert.ok(blDlgOf(h.tree));
  assert.equal(d.btn("Simpan baseline").props.disabled, false);
  h.m.unmount();
}));

test("fix T5 #3: workspace — slot tiba bersama pulled saat dialog terbuka (form) → potret disegarkan: Simpan memberi KONFIRMASI Timpa, bukan STALE", () => withEngineClock(async (clock) => {
  const ws = wsSetup();
  const h = await swView(clock, { records: ws.fr, tasks: ws.tasks, ctx: ws.ctx });
  const d = openBlDialog(h);
  d.unit(1); // Beta: menunggu
  assert.equal(d.btn("Simpan baseline").props.disabled, true);
  putRec(ws.fr, blRec(12, "Beta", 1, { name: "Awal Beta" }));
  ws.fr.emit(PULLED);
  await settleN();
  h.render();
  h.m.flush();
  d.sync();
  assert.equal(radioTexts(d.tree, "Baseline")[0], "Awal Beta · disimpan Rab 4 Nov", "potret ikut data tarik");
  d.slot(1);
  d.click("Simpan baseline");
  assert.equal(confirmText(d.tree), "Timpa Awal Beta (disimpan Rab 4 Nov)?");
  d.click("Timpa");
  await settleN();
  assert.equal(blPuts(ws.fr).length, 1);
  assert.equal(h.calls.toast.filter((t) => t[0] === MSG_BL_STALE).length, 0, "tanpa STALE");
  h.m.unmount();
}));

test("fix T5 #3: potret TIDAK disegarkan saat langkah konfirmasi (yang dikonfirmasi = yang dilihat)", () => withEngineClock(async (clock) => {
  const ws = wsSetup();
  putRec(ws.fr, blRec(12, "Alpha", 1, { name: "Awal Alpha" }));
  const h = await swView(clock, { records: ws.fr, tasks: ws.tasks, ctx: ws.ctx });
  const d = openBlDialog(h);
  d.click("Simpan baseline");
  assert.equal(confirmText(d.tree), "Timpa Awal Alpha (disimpan Rab 4 Nov)?");
  putRec(ws.fr, blRec(12, "Alpha", 1, { name: "Ganti Sari" }, { updated_at: "2026-11-04T09:00:00Z" }));
  ws.fr.emit(PULLED);
  await settleN();
  h.render();
  h.m.flush();
  d.sync();
  assert.equal(confirmText(d.tree), "Timpa Awal Alpha (disimpan Rab 4 Nov)?", "konfirmasi tetap");
  d.click("Timpa");
  await settleN();
  assert.equal(blPuts(ws.fr).length, 0, "potret lama → STALE (CAS tetap menjaga)");
  assert.deepEqual(h.calls.toast[h.calls.toast.length - 1], [MSG_BL_STALE, "error"]);
  h.m.unmount();
}));

test("fix T5 #4: Hapus baseline — slot terisi (bukan asing) bertombol 'Hapus'; konfirmasi 'Hapus {nama} (disimpan {tanggal})?'; Batal → 0 tulis; Hapus → satu records.remove dengan snap + toast '{nama} dihapus'; pref aktif tidak diubah", () => withEngineClock(async (clock) => {
  const fr = fakeRecords();
  putRec(fr, blRec(null, "Alpha", 1, { name: "Rencana awal" }));
  putRec(fr, blRec(null, "Alpha", 3, { v: 2 })); // asing → tanpa Hapus
  const h = await swView(clock, { records: fr, });
  const unit = blUnit(null, "Alpha");
  let d = openBlDialog(h);
  assert.equal(delBtns(d.tree).length, 1, "hanya slot 1 (terisi, terbaca)");
  assert.equal(txt(delBtns(d.tree)[0]).trim(), "Hapus");
  assert.equal(delBtns(d.tree)[0].props["aria-label"], "Hapus Rencana awal");
  delBtns(d.tree)[0].props.onClick({});
  d.sync();
  assert.equal(confirmText(d.tree), "Hapus Rencana awal (disimpan Rab 4 Nov)?");
  d.click("Batal");
  assert.equal(blDlgOf(h.tree), undefined);
  assert.equal(fr.calls.remove.length + fr.calls.put.length, 0, "Batal → 0 tulis");
  d = openBlDialog(h);
  delBtns(d.tree)[0].props.onClick({});
  d.sync();
  const del = d.btn("Hapus");
  del.props.onClick({});
  del.props.onClick({});
  await settleN();
  h.render();
  assert.deepEqual(fr.calls.remove, [["baseline", "bl1" + unit.recId.slice(3)]], "klik ganda = satu remove");
  assert.ok(fr.calls.get.length >= 1, "CAS snap dibaca dulu");
  assert.equal(fr.calls.put.length, 0);
  assert.equal(blDlgOf(h.tree), undefined);
  assert.deepEqual(h.calls.toast[h.calls.toast.length - 1], ["Rencana awal dihapus", "success"]);
  assert.equal(h.calls.storageSet.filter((x) => x[0].indexOf("bl:") === 0).length, 0, "pref tidak disentuh");
  h.m.unmount();
}));

test("fix T5 #4: Hapus STALE (slot ditimpa anggota lain) → toast 'Data berubah sejak dialog dibuka — muat ulang', 0 remove, potret segar; slot terkunci → Hapus nonaktif", () => withEngineClock(async (clock) => {
  const fr = fakeRecords();
  putRec(fr, blRec(null, "Alpha", 1, { name: "Rencana awal" }));
  const h = await swView(clock, { records: fr });
  const d = openBlDialog(h);
  putRec(fr, blRec(null, "Alpha", 1, { name: "Punya Sari", by: 9 }, { updated_at: "2026-11-04T05:00:00Z" }));
  delBtns(d.tree)[0].props.onClick({});
  d.sync();
  d.click("Hapus");
  await settleN();
  d.sync();
  assert.equal(fr.calls.remove.length, 0);
  assert.deepEqual(h.calls.toast[h.calls.toast.length - 1], [MSG_BL_STALE, "error"]);
  assert.ok(blDlgOf(h.tree));
  assert.equal(radioTexts(d.tree, "Baseline")[0], "Punya Sari · disimpan Rab 4 Nov");
  h.m.unmount();
  // terkunci (lockedOf true) → tombol Hapus nonaktif
  const props = {
    units: [{ key: "u", label: "U" }], rev: 0, busy: false,
    bases: new Map([["u", new Map([[1, { n: 1, foreign: false, name: "X", savedAt: "2026-11-04", snap: { exists: true, updatedAt: null, by: null }, rows: new Map() }]])]]),
    lockedOf: () => true, waitingOf: () => false, onSave() {}, onRemove() { throw new Error("tidak boleh"); }, onCancel() {},
  };
  const t = mount(T.SaveBaselineDialog).render(props);
  assert.equal(delBtns(t)[0].props.disabled, true);
}));

test("fix T5 #5: Esc di langkah konfirmasi (Timpa / Hapus) → 0 tulis; workspace ganti project lalu Batal/Esc → 0 put", () => withEngineClock((clock) => withPop(async (w) => {
  const fr = fakeRecords();
  putRec(fr, blRec(null, "Alpha", 1, { name: "Rencana awal" }));
  const h = await swView(clock, { records: fr });
  const esc = () => w.fire("keydown", { key: "Escape", preventDefault() {}, stopPropagation() {} });
  let d = openBlDialog(h);
  d.dm.flush();
  d.click("Simpan baseline");
  assert.equal(confirmText(d.tree), "Timpa Rencana awal (disimpan Rab 4 Nov)?");
  esc();
  await settleN();
  assert.equal(fr.calls.put.length + fr.calls.remove.length, 0, "Esc di konfirmasi Timpa");
  d.sync();
  assert.equal(blDlgOf(h.tree), undefined);
  d.dm.unmount();
  d = openBlDialog(h);
  d.dm.flush();
  delBtns(d.tree)[0].props.onClick({});
  d.sync();
  esc();
  await settleN();
  assert.equal(fr.calls.put.length + fr.calls.remove.length, 0, "Esc di konfirmasi Hapus");
  d.dm.unmount();
  h.m.unmount();
  const ws = wsSetup();
  const hw = await swView(clock, { records: ws.fr, tasks: ws.tasks, ctx: ws.ctx });
  ws.fr.emit(PULLED);
  await settleN();
  hw.render();
  let dw = openBlDialog(hw);
  dw.unit(2);
  dw.click("Batal");
  assert.equal(blDlgOf(hw.tree), undefined);
  dw = openBlDialog(hw);
  dw.dm.flush();
  dw.unit(1);
  esc();
  await settleN();
  dw.sync();
  assert.equal(blDlgOf(hw.tree), undefined);
  assert.equal(ws.fr.calls.put.filter((p) => p[0] === "baseline").length + ws.fr.calls.remove.length, 0);
  dw.dm.unmount();
  hw.m.unmount();
})));

test("fix T5 r2: remove ditolak (galat lain) → toast 'Baseline gagal dihapus' (bukan teks simpan), dialog tetap terbuka", () => withEngineClock(async (clock) => {
  const fr = fakeRecords();
  putRec(fr, blRec(null, "Alpha", 1, { name: "Rencana awal" }));
  const h = await swView(clock, { records: fr });
  fr.api.remove = () => Promise.reject(Object.assign(new Error("idb"), { code: "IDB" }));
  const d = openBlDialog(h);
  delBtns(d.tree)[0].props.onClick({});
  d.sync();
  d.click("Hapus");
  await settleN();
  d.sync();
  assert.deepEqual(h.calls.toast[h.calls.toast.length - 1], ["Baseline gagal dihapus", "error"]);
  assert.equal(h.calls.toast.filter((t) => t[0] === MSG_BL_SAVE_FAIL).length, 0);
  assert.ok(blDlgOf(h.tree));
  h.m.unmount();
}));

// ════════════════════════════════════════════════════════════════════════════
// Fase 1 PR 1c-2 — Task 6: grafik — bar baseline (4 px di bawah bar) + garis aktual (2 px) + legenda
// ════════════════════════════════════════════════════════════════════════════
// Unit Manual (tanpa record project) → mesin berjangkar di tanggal tersimpan → es/ef dapat diramal.
//   A Sen 2–Rab 4 (baseline Sen 2 → Sel 3: selesai +1 hk); B Sen 9 (baseline Sel 10 → Rab 11: −2 hk); C tanpa entri baseline;
//   D berjalan (actual.start Sen 2, belum selesai) → garis sampai HARI INI; E selesai, finish turunan completed_at 23:30 UTC
//   (= Kam 29 Okt Jakarta); F selesai dengan finish tersimpan Sel 27 Okt; G belum selesai dengan finish tersimpan Sel 3 Nov.
const t6Tasks = () => {
  const al = { project: "Alpha" };
  return [
    mk(1, "A", { start: "2026-11-02", duration: 3 }, al),
    mk(2, "B", { start: "2026-11-09", duration: 1 }, al),
    mk(3, "C", { start: "2026-11-05", duration: 1 }, al),
    mk(4, "D", { start: "2026-11-02", duration: 5, actual: { start: "2026-11-02" } }, al),
    mk(5, "E", { start: "2026-10-26", duration: 2, actual: { start: "2026-10-26" } }, Object.assign({ gtd_status: "done", completed_at: "2026-10-28T23:30:00Z" }, al)),
    mk(6, "F", { start: "2026-10-26", duration: 2, actual: { start: "2026-10-26", finish: "2026-10-27" } }, Object.assign({ gtd_status: "done", completed_at: "2026-10-30T03:00:00Z" }, al)),
    mk(7, "G", { start: "2026-11-02", duration: 1, actual: { start: "2026-11-02", finish: "2026-11-03" } }, al),
  ];
};
// baris baseline: A, B, dan task 99 yang sudah dihapus (dilewati tanpa crash)
const T6_BL = [[{ $task: 1 }, "2026-11-02", "2026-11-03", 2, 0], [{ $task: 2 }, "2026-11-10", "2026-11-11", 2, 0], [{ $task: 99 }, "2026-11-02", "2026-11-02", 1, 0]];
const blBars = (tree) => byCls(tree, "plg-timeline-blbar");
const actLines = (tree) => byCls(tree, "plg-timeline-actual");
const keyed = (list, key) => list.find((n) => n.props["data-key"] === key);
const dnOf = (iso) => T.TLCal.dn(iso);

// View halaman project Alpha; pref bl:proj_alpha (kunci bl dilipat A–Z, fix T7) dari opt.bl; record opsional; tata letak terakhir ditangkap (spy layout).
async function t6View(clock, o) {
  const opt = o || {};
  const tasks = opt.tasks || t6Tasks();
  const fr = fakeRecords();
  for (const r of opt.recs || []) putRec(fr, r);
  const { api, calls } = fakeApi({ records: fr, today: opt.today, storageGet: (k) => Promise.resolve(k === "bl:proj_alpha" && opt.bl !== undefined ? opt.bl : null) });
  api.data = { tasks: { list: () => Promise.resolve(tasks) } };
  const writes = spyWrites(api);
  const props = { context: ctxOf(tasks).ctx, api };
  const orig = T.engine.layout;
  const h = { nLay: 0, lay: null };
  T.engine.layout = (a) => { h.nLay++; return (h.lay = orig(a)); };
  h.restore = () => { T.engine.layout = orig; };
  try {
    const m = mount(T.TimelineViewBody);
    const tree = await settleView(m, () => props, clock);
    return Object.assign(h, { m, tree, props, api, calls, writes, fr, render() { h.tree = m.render(props); return h.tree; } });
  } catch (e) {
    h.restore();
    throw e;
  }
}
const spanPx = (lay, s, f) => ({ left: T.TLLayout.xOf(dnOf(s), lay.range, lay.px), width: (dnOf(f) - dnOf(s) + 1) * lay.px });

test("1c-2 T6: bar baseline hanya saat pref aktif; rentang Mulai→Selesai baseline, 4 px di bawah bar; aria/tooltip 'Baseline: {s} → {f} ({±df} hk)'; task tanpa entri / terhapus → tanpa bar; 0 tulis", () => withEngineClock(async (clock) => {
  const recs = [blRec(null, "Alpha", 1, { name: "Rencana awal", t: T6_BL })];
  const off = await t6View(clock, { recs });
  try {
    assert.equal(blBars(off.tree).length, 0, "pref Tidak ada → tanpa bar baseline");
    off.m.unmount();
  } finally {
    off.restore();
  }
  const h = await t6View(clock, { recs, bl: 1 });
  try {
    const bars = blBars(h.tree);
    assert.deepEqual(bars.map((n) => n.props["data-key"]).sort(), ["1", "2"], "hanya task dengan entri baseline (C tanpa entri, 99 terhapus)");
    const a = keyed(bars, "1");
    const b = keyed(bars, "2");
    // selisih = pergeseran SELESAI (df compareBaseline): A Sel 3 → Rab 4 = +1; B Rab 11 → Sen 9 = −2 (minus U+2212)
    assert.equal(a.props["aria-label"], "Baseline: Sen 2 Nov → Sel 3 Nov (+1 hk)");
    assert.equal(a.props.title, a.props["aria-label"]);
    assert.equal(a.props.role, "img");
    assert.equal(b.props["aria-label"], "Baseline: Sel 10 Nov → Rab 11 Nov (−2 hk)");
    const exp = spanPx(h.lay, "2026-11-02", "2026-11-03");
    assert.equal(a.props.style.left, exp.left);
    assert.equal(a.props.style.width, exp.width);
    const rowA = h.lay.rows.find((r) => r.key === "1");
    assert.equal(a.props.style.top, rowA.index * T.TLLayout.ROW_H + (T.TLLayout.ROW_H + 16) / 2 + 1, "tepat di bawah bar 16 px");
    assert.ok(a.props.style.top + 4 <= (rowA.index + 1) * T.TLLayout.ROW_H, "tetap di dalam baris");
    assert.deepEqual(spanPx(h.lay, "2026-11-10", "2026-11-11"), { left: b.props.style.left, width: b.props.style.width });
    assert.deepEqual(h.writes, [], "0 tulisan task");
    assert.equal(h.fr.calls.put.length + h.fr.calls.remove.length, 0, "0 tulisan record");
    h.m.unmount();
  } finally {
    h.restore();
  }
  // CSS: 4 px, warna color-mix token (tanpa hex)
  assert.match(css, /\.plg-timeline-blbar\s*\{[^}]*height:\s*4px;[^}]*\}/);
  assert.match(css, /\.plg-timeline-blbar\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--text-secondary\) 45%, transparent\);[^}]*\}/);
  assert.match(css, /\.plg-timeline-actual\s*\{[^}]*height:\s*2px;[^}]*background:\s*var\(--text-primary\);[^}]*\}/);
}));

test("1c-2 T6: slot aktif tanpa baris (kosong / asing v2) → tidak ada bar dan tanpa legenda 'Baseline', tanpa crash", () => withEngineClock(async (clock) => {
  for (const [bl, recs] of [[2, [blRec(null, "Alpha", 1, { t: T6_BL })]], [1, [blRec(null, "Alpha", 1, { v: 2, t: T6_BL })]], [3, []]]) {
    const h = await t6View(clock, { recs, bl });
    try {
      assert.equal(buttonByText(h.tree, "Baseline").props["aria-expanded"], false, "view tergambar (slot " + bl + ")");
      assert.equal(blBars(h.tree).length, 0, "rows.size 0 → tanpa bar (slot " + bl + ")");
      assert.equal(legendTexts(h.tree).indexOf("Baseline"), -1, "tanpa legenda Baseline (slot " + bl + ")");
      h.m.unmount();
    } finally {
      h.restore();
    }
  }
}));

test("1c-2 T6: garis aktual — berjalan sampai HARI INI dan ikut env.today TANPA tulisan (Review Focus 5); selesai → finish turunan (completed_at 23:30 UTC = besok Jakarta) / tersimpan; tanpa actual.start → tanpa garis", () => withEngineClock(async (clock) => {
  const h = await t6View(clock);
  try {
    const lines = actLines(h.tree);
    assert.deepEqual(lines.map((n) => n.props["data-key"]).sort(), ["4", "5", "6", "7"], "hanya task ber-actual.start");
    for (const n of lines) assert.equal(n.props["aria-hidden"], "true");
    const pos = (tree, key) => { const n = keyed(actLines(tree), key); return { left: n.props.style.left, width: n.props.style.width }; };
    assert.deepEqual(pos(h.tree, "4"), spanPx(h.lay, "2026-11-02", TODAY), "berjalan → berhenti di hari ini (Rab 4), bukan EF");
    assert.deepEqual(pos(h.tree, "5"), spanPx(h.lay, "2026-10-26", "2026-10-29"), "selesai → finish turunan Kam 29 Okt (Jakarta)");
    assert.deepEqual(pos(h.tree, "6"), spanPx(h.lay, "2026-10-26", "2026-10-27"), "finish tersimpan menang atas completed_at");
    assert.deepEqual(pos(h.tree, "7"), spanPx(h.lay, "2026-11-02", "2026-11-03"), "finish tersimpan pada task belum selesai");
    const rowD = h.lay.rows.find((r) => r.key === "4");
    const top = keyed(lines, "4").props.style.top;
    assert.ok(top >= rowD.index * T.TLLayout.ROW_H && top + 2 <= rowD.index * T.TLLayout.ROW_H + (T.TLLayout.ROW_H - 16) / 2, "di atas bar, di dalam baris");
    // hari berganti (tanpa tulisan, tanpa event) → garis berjalan memanjang ke hari ini yang baru; garis selesai tetap
    h.api.env.today = () => "2026-11-06";
    h.render();
    h.m.flush();
    await settle();
    h.render();
    assert.deepEqual(pos(h.tree, "4"), spanPx(h.lay, "2026-11-02", "2026-11-06"), "ikut env.today (Jum 6)");
    assert.deepEqual(pos(h.tree, "5"), spanPx(h.lay, "2026-10-26", "2026-10-29"));
    assert.deepEqual(pos(h.tree, "7"), spanPx(h.lay, "2026-11-02", "2026-11-03"));
    assert.deepEqual(h.writes, [], "0 tulisan (R25)");
    assert.equal(h.fr.calls.put.length + h.fr.calls.remove.length, 0);
    h.m.unmount();
  } finally {
    h.restore();
  }
}));

test("1c-2 T6: legenda + 'Baseline' (pref aktif dan slot berisi) + 'Aktual' (ada garis aktual di halaman); urutan setelah Jalur kritis", () => withEngineClock(async (clock) => {
  const base = ["Task", "Selesai", "Lewat tenggat", "Ringkasan", "Milestone", "Tenggat", "Libur", "Dependensi"];
  const recs = [blRec(null, "Alpha", 1, { t: T6_BL })];
  const plain = await t6View(clock, { tasks: chainTasks(), recs });
  try {
    assert.deepEqual(legendTexts(plain.tree), base, "tanpa baseline aktif, tanpa aktual");
    plain.m.unmount();
  } finally {
    plain.restore();
  }
  const act = await t6View(clock, { recs });
  try {
    assert.deepEqual(legendTexts(act.tree), base.concat(["Aktual"]));
    act.m.unmount();
  } finally {
    act.restore();
  }
  const both = await t6View(clock, { recs, bl: 1 });
  try {
    assert.deepEqual(legendTexts(both.tree), base.concat(["Baseline", "Aktual"]));
    assert.ok(byCls(both.tree, "plg-timeline-swatch").some((n) => hasCls(n, "is-baseline")));
    assert.ok(byCls(both.tree, "plg-timeline-swatch").some((n) => hasCls(n, "is-actual")));
    both.m.unmount();
  } finally {
    both.restore();
  }
  const blOnly = await t6View(clock, { tasks: chainTasks(), recs, bl: 1 });
  try {
    assert.deepEqual(legendTexts(blOnly.tree), base.concat(["Baseline"]));
    blOnly.m.unmount();
  } finally {
    blOnly.restore();
  }
  assert.match(css, /\.plg-timeline-swatch\.is-baseline\s*\{[^}]*color-mix\(in srgb, var\(--text-secondary\) 45%, transparent\)/);
  assert.match(css, /\.plg-timeline-swatch\.is-actual\s*\{[^}]*var\(--text-primary\)/);
}));

test("1c-2 T6: memilih baseline (pref) tidak menghitung ulang tata letak — overlay memo terpisah (spy pola T7 1c-1); bar muncul / hilang, 0 tulis", () => withEngineClock(async (clock) => {
  const h = await t6View(clock, { recs: [blRec(null, "Alpha", 1, { t: T6_BL })] });
  try {
    const n0 = h.nLay;
    const lay0 = h.lay;
    assert.equal(blBars(h.tree).length, 0);
    const pick = async (i) => {
      buttonByText(h.tree, "Baseline").props.onClick({});
      h.render();
      const pt = mount(T.BaselinePicker).render(blPickOf(h.tree).props);
      nodes(nodes(pt, (n) => n.props.role === "menu")[0], (n) => n.type === "button")[i].props.onClick({});
      await settle();
      h.render();
      h.m.flush();
      await settle();
      h.render();
    };
    await pick(1);
    assert.deepEqual(blBars(h.tree).map((n) => n.props["data-key"]).sort(), ["1", "2"], "bar muncul");
    assert.equal(h.nLay, n0, "pref baseline tidak menghitung ulang lay");
    assert.equal(h.lay, lay0);
    await pick(0);
    assert.equal(blBars(h.tree).length, 0, "Tidak ada → bar hilang");
    assert.equal(h.nLay, n0);
    assert.deepEqual(h.calls.storageSet.filter((s) => s[0] === "bl:proj_alpha"), [["bl:proj_alpha", 1], ["bl:proj_alpha", 0]]);
    assert.deepEqual(h.writes, []);
    assert.equal(h.fr.calls.put.length + h.fr.calls.remove.length, 0);
    h.m.unmount();
  } finally {
    h.restore();
  }
}));

// Perluasan anggaran T13 1c-1: + baseline aktif (slot 1 tiap unit P0–P4 memuat semua task terjadwalnya) + garis aktual
// (actual.start pada tiap task ketiga yang terjadwal). Dipakai juga oleh tes "render awal tetap tanpa TLCpm.run" (T10).
function blPerfSetup() {
  const tasks = bigTasks(500, 400).map((t) => Object.assign(t, { list_id: 12 }));
  const perUnit = new Map();
  tasks.forEach((t, i) => {
    const s = t.ext["timeline.start"];
    if (!s) return;
    if (i % 3 === 0) t.ext["timeline.actual"] = { start: s };
    const d = t.ext["timeline.duration"];
    const row = [{ $task: t.id }, s, T.TLCal.iso(T.TLCal.dn(s) + d), d, 0];
    if (!perUnit.has(t.project)) perUnit.set(t.project, []);
    perUnit.get(t.project).push(row);
  });
  const fr = fakeRecords();
  for (let k = 0; k < 5; k++) {
    putRec(fr, unitRec(12, "P" + k));
    putRec(fr, blRec(12, "P" + k, 1, { t: perUnit.get("P" + k) }));
  }
  const { api } = fakeApi({ records: fr, storageGet: (k) => Promise.resolve(k === "crit:slist_12" ? true : k === "bl:slist_12" ? 1 : null) });
  api.data = { tasks: { list: () => Promise.resolve(tasks) } };
  const writes = spyWrites(api);
  const { ctx } = ctxOf(tasks, { page: "slist_12", pageKind: "workspace", listId: 12, projectName: null });
  return { tasks, fr, api, writes, props: { context: ctx, api } };
}

// 1c-2 T10 (nama brief "DOM 500/400 + crit + baseline + garis aktual ≤ 1.500"): tes T6 diperluas di tempat ke cakupan
// penuh T13 1c-1 (kolom Slack terisi + banner drift) — seksi Jadwal tidak dibuka: ia hidup di detail task (mount lain),
// bukan di view; anggaran T13 1c-1 pun hanya view.
test("DOM 500/400 + crit + baseline + garis aktual ≤ 1.500 (Slack, banner drift; bar/garis hanya di baris tampak)", () => withEngineClock(async (clock) => {
  const { fr, writes, props } = blPerfSetup();
  const spy = spyRun();
  try {
    const m = mount(T.TimelineViewBody);
    const tree = await settleView(m, () => props, clock);
    assert.ok(spy.runs.length >= 1, "mesin sudah jalan");
    assert.equal(buttonByText(tree, "Jalur kritis").props["aria-pressed"], true);
    assert.ok(nodes(tree, (n) => hasCls(n, "is-critical")).length > 0);
    assert.ok(headerCells(tree).indexOf("Slack") >= 0, "kolom Slack");
    assert.ok(slackCells(tree).some((v) => /hk$|^0$/.test(v)), "nilai Slack terisi");
    const bs = bannersOf(tree);
    assert.ok(bs.length >= 1, "banner drift tampil");
    assert.match(bannerText(bs[0]), /^Jadwal otomatis belum mutakhir: \d+ task berbeda dari hasil hitung\.$/);
    assert.ok(byCls(tree, "plg-timeline-arrow").length > 0, "ada panah");
    const rows = nodes(tree, (n) => n.props.role === "row" && n.props["aria-rowindex"] > 1);
    assert.ok(rows.length > 20 && rows.length <= 60, "baris tervirtualisasi: " + rows.length);
    const shown = new Set(nodes(tree, (n) => n.props.role === "row" && n.props["data-key"] !== undefined).map((n) => n.props["data-key"]));
    const bl = blBars(tree);
    const al = actLines(tree);
    assert.ok(bl.length > 5, "ada bar baseline: " + bl.length);
    assert.ok(al.length > 2, "ada garis aktual: " + al.length);
    assert.ok(bl.length <= rows.length && al.length <= rows.length, "≤ satu per baris tampak");
    for (const n of bl.concat(al)) assert.ok(shown.has(n.props["data-key"]), "hanya baris tampak: " + n.props["data-key"]);
    assert.ok(legendTexts(tree).indexOf("Baseline") >= 0 && legendTexts(tree).indexOf("Aktual") >= 0);
    const n = domCount(tree);
    assert.ok(n <= 1500, "elemen: " + n);
    console.log("# DOM elemen 500 task/400 dep + Jalur kritis + Slack + banner + baseline + aktual: " + n);
    assert.deepEqual(writes, [], "0 tulisan latar");
    assert.equal(fr.calls.put.length + fr.calls.remove.length, 0);
    m.unmount();
  } finally {
    spy.restore();
  }
}));

test("fix T6: task selesai TANPA completed_at dan tanpa selesai tersimpan → garis aktual berakhir di r.span.f (rentang selesai sepakat doneFinish), lebar ≥ 1 hari", () => withEngineClock(async (clock) => {
  const al = { project: "Alpha" };
  const tasks = [mk(8, "H", { start: "2026-10-26", duration: 3, actual: { start: "2026-10-26" } }, Object.assign({ gtd_status: "done" }, al))];
  const h = await t6View(clock, { tasks });
  try {
    const row = h.lay.rows.find((r) => r.key === "8");
    assert.ok(row.done && row.span, "baris selesai dengan rentang");
    assert.equal(row.task.completed_at, undefined);
    const line = keyed(actLines(h.tree), "8");
    assert.ok(line, "garis aktual ada");
    const exp = spanPx(h.lay, "2026-10-26", T.TLCal.iso(row.span.f));
    assert.deepEqual({ left: line.props.style.left, width: line.props.style.width }, exp, "berakhir di r.span.f, bukan hari ini");
    assert.ok(line.props.style.width >= h.lay.px, "lebar ≥ 1 hari");
    assert.ok(row.span.f < dnOf(TODAY), "bukan HARI INI");
    assert.deepEqual(h.writes, []);
    h.m.unmount();
  } finally {
    h.restore();
  }
}));

test("fix T7: kunci pref bl dilipat huruf kecil A–Z saja (NOCASE host); jenis lain & slist_ tidak berubah; view proj_Alpha membaca bl:proj_alpha", () => withEngineClock(async (clock) => {
  assert.equal(T.prefKey("bl", "proj_Alpha"), "bl:proj_alpha");
  assert.equal(T.prefKey("bl", "proj_ALPHA"), T.prefKey("bl", "proj_alpha"));
  assert.equal(T.prefKey("bl", "proj_Ärger Á"), "bl:proj_Ärger Á", "hanya ASCII A–Z (SQLite NOCASE)");
  assert.equal(T.prefKey("bl", "slist_7"), "bl:slist_7");
  assert.equal(T.prefKey("zoom", "proj_Alpha"), "zoom:proj_Alpha", "jenis lain tidak dilipat");
  assert.equal(T.prefKey("crit", "proj_Alpha"), "crit:proj_Alpha");
  const recs = [blRec(null, "Alpha", 1, { name: "Rencana awal", t: T6_BL })];
  const h = await t6View(clock, { recs, bl: 1 });
  try {
    assert.ok(h.calls.storageGet.includes("bl:proj_alpha"));
    assert.ok(!h.calls.storageGet.includes("bl:proj_Alpha"));
    assert.ok(blBars(h.tree).length > 0, "baseline aktif dari kunci terlipat");
    h.m.unmount();
  } finally {
    h.restore();
  }
}));

// ── 1c-2 Task 8 (K42 + amandemen koordinator): pencatatan mulai aktual otomatis HANYA dari event host gestur lokal
// `pomodoro.ended` dan `task.completed` (pemicu "progress naik dari 0" DIBUANG — diff data tidak bisa membedakan lokal
// dari sinkron; R25 menang). recordActual = SATU-SATUNYA penulis otomatis, "isi bila kosong", tidak pernah menulis finish.
function trackApi(tasks, o) {
  const opts = o || {};
  const live = tasks; // daftar "IndexedDB": set memperbarui ext di tempat (pembacaan berikutnya melihat tulisan)
  const writes = [];
  const emitted = [];
  const warn = [];
  const toast = [];
  const handlers = {};
  let lists = 0;
  const api = {
    id: "timeline",
    events: {
      on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); return () => { handlers[name] = handlers[name].filter((f) => f !== fn); }; },
      emit(name, p) { emitted.push([name, p]); for (const f of (handlers[name] || []).slice()) f(Object.freeze(Object.assign({}, p))); },
    },
    taskExt: {
      read(t) {
        const out = {};
        for (const k of Object.keys((t && t.ext) || {})) if (k.indexOf("timeline.") === 0) out[k.slice(9)] = JSON.parse(JSON.stringify(t.ext[k]));
        return out;
      },
      set(id, patch) {
        writes.push(["set", id, JSON.parse(JSON.stringify(patch))]);
        if (opts.setFail) return Promise.reject(new Error("gagal"));
        const t = live.find((x) => String(x.id) === String(id));
        if (t) {
          t.ext = Object.assign({}, t.ext);
          for (const k of Object.keys(patch)) { if (patch[k] === null) delete t.ext["timeline." + k]; else t.ext["timeline." + k] = patch[k]; }
        }
        return Promise.resolve(t);
      },
      setMany(items) { writes.push(["setMany", items]); return Promise.resolve([]); },
      ref: (t) => ({ $task: t.id }),
    },
    data: { tasks: { list: (q) => { lists += 1; assert.deepEqual(q, { includeDone: true }); return opts.listFail ? Promise.reject(new Error("x")) : Promise.resolve(JSON.parse(JSON.stringify(live))); } } },
    env: { today: () => opts.today || "2026-11-05", online: true },
    ui: { toast: (...a) => toast.push(a) },
    log: { info() {}, warn: (...a) => warn.push(a), error: (...a) => warn.push(a) },
  };
  const fire = (name, p) => { for (const f of (handlers[name] || []).slice()) f(Object.freeze(Object.assign({}, p))); };
  return { api, writes, emitted, warn, toast, handlers, fire, lists: () => lists };
}
const settleTrack = async () => { for (let k = 0; k < 8; k++) await new Promise((r) => setImmediate(r)); }; // setImmediate: tidak dipalsukan mock.timers
const POMO = (taskId, endedAt) => ({ taskId, kind: "session", pomodoros: 1, focusSeconds: 1500, endedAt });

test("T8 pomodoro.ended task tanpa actual.start → satu set {actual:{start: hari Jakarta endedAt}}; dengan actual.start → 0 tulis", async () => {
  const tasks = [mk(1, "A", {}), mk(2, "B", { actual: { start: "2026-11-02" } }), mk(3, "C", { start: "2026-11-02", duration: 3 })];
  const h = trackApi(tasks);
  const off = T.installActualTracking(h.api);
  assert.equal(typeof off, "function");
  assert.equal(h.handlers["pomodoro.ended"].length, 1);
  assert.equal(h.handlers["task.completed"].length, 1);
  assert.deepEqual(Object.keys(h.handlers).sort(), ["pomodoro.ended", "task.completed"], "tidak ada pendengar sync.done/app.dayChanged");
  h.fire("pomodoro.ended", POMO(1, "2026-11-05T03:00:00.000Z"));
  await settleTrack();
  assert.deepEqual(h.writes, [["set", 1, { actual: { start: "2026-11-05" } }]]);
  assert.deepEqual(h.emitted, [["timeline.actualRecorded", { taskId: 1 }]], "seksi terpasang diberi tahu (muat ulang baca-saja)");
  h.writes.length = 0;
  h.fire("pomodoro.ended", POMO(2, "2026-11-05T03:00:00.000Z"));
  await settleTrack();
  assert.deepEqual(h.writes, [], "sudah ada actual.start → 0 tulis");
  // task berjadwal tanpa actual: kunci jadwal lain tidak disentuh (patch hanya `actual`)
  h.fire("pomodoro.ended", POMO(3, "2026-11-05T03:00:00.000Z"));
  await settleTrack();
  assert.deepEqual(h.writes, [["set", 3, { actual: { start: "2026-11-05" } }]]);
  assert.deepEqual(h.toast, []);
  off();
  assert.deepEqual(Object.values(h.handlers).flat(), [], "off melepas kedua pendengar");
});

test("T8 tanggal: endedAt lintas tengah malam (18:30Z = 01:30 WIB besok) → hari Jakarta; replay sesi basi → tanggal sesi itu (jujur + idempoten); tanpa/rusak → api.env.today", async () => {
  const tasks = [mk(1, "A", {}), mk(2, "B", {}), mk(3, "C", {}), mk(4, "D", {})];
  const h = trackApi(tasks, { today: "2026-11-07" });
  T.installActualTracking(h.api);
  h.fire("pomodoro.ended", POMO(1, "2026-11-04T18:30:00.000Z"));
  h.fire("pomodoro.ended", POMO(2, "2026-11-03T09:00:00Z")); // sesi hari sebelumnya dilaporkan saat mount (index.html :11459)
  h.fire("pomodoro.ended", POMO(3, undefined));
  h.fire("pomodoro.ended", POMO(4, "kemarin sore"));
  await settleTrack();
  const by = Object.fromEntries(h.writes.map((w) => [w[1], w[2].actual.start]));
  assert.deepEqual(by, { 1: "2026-11-05", 2: "2026-11-03", 3: "2026-11-07", 4: "2026-11-07" });
  // replay sesi basi yang sama (mount berikutnya) → 0 tulis
  h.writes.length = 0;
  h.fire("pomodoro.ended", POMO(2, "2026-11-03T09:00:00Z"));
  await settleTrack();
  assert.deepEqual(h.writes, []);
});

test("T8 task.completed: tanpa actual.start → satu set start = hari Jakarta completedAt (?? hari ini); task ber-actual.start → 0; finish TIDAK PERNAH ditulis", async () => {
  const tasks = [
    mk(1, "A", {}, { gtd_status: "done", completed_at: "2026-11-04T23:30:00Z" }),
    mk(2, "B", { actual: { start: "2026-11-01" } }, { gtd_status: "done", completed_at: "2026-11-05T02:00:00Z" }),
    mk(3, "C", {}),
  ];
  const h = trackApi(tasks);
  T.installActualTracking(h.api);
  h.fire("task.completed", { taskId: 1, completedAt: "2026-11-04T23:30:00.000Z" });
  h.fire("task.completed", { taskId: 2, completedAt: "2026-11-05T02:00:00.000Z" });
  h.fire("task.completed", { taskId: 3 });
  await settleTrack();
  assert.deepEqual(h.writes, [
    ["set", 1, { actual: { start: "2026-11-05" } }],
    ["set", 3, { actual: { start: "2026-11-05" } }],
  ]);
  for (const w of h.writes) assert.ok(!("finish" in w[2].actual), "finish tidak ditulis otomatis (turunan completed_at)");
});

test("T8 gabung: finish TERSIMPAN dibawa; start > finish tersimpan → ditolak sanitizePatch, 0 tulis; actual rusak/asing (bukan kosong) → 0 tulis", async () => {
  const tasks = [
    mk(1, "A", { actual: { finish: "2026-11-06" } }),
    mk(2, "B", { actual: { finish: "2026-11-02" } }),
    mk(3, "C", { actual: { start: "2026-11-01", catatan: "versi lebih baru" } }),
    mk(4, "D", { actual: "2026-11-01" }),
    mk(5, "E", { actual: null }),
  ];
  const h = trackApi(tasks);
  T.installActualTracking(h.api);
  for (const id of [1, 2, 3, 4, 5]) h.fire("pomodoro.ended", POMO(id, "2026-11-05T03:00:00Z"));
  await settleTrack();
  assert.deepEqual(h.writes, [
    ["set", 1, { actual: { start: "2026-11-05", finish: "2026-11-06" } }],
    ["set", 5, { actual: { start: "2026-11-05" } }],
  ]);
});

test("T8 baca segar: ext dibaca ulang dari api.data.tasks.list tiap event (bukan cache) — dua event beruntun task sama → satu set; id cid/teks, task tak dikenal, berulang, payload rusak → 0", async () => {
  const tasks = [mk(1, "A", {}), mk("c-77", "Lokal", {}, { cid: "c-77" }), mk(9, "Harian", {}, { recurrence_type: "daily" }), mk(12, "Server", {}, { cid: "c-12" })];
  const h = trackApi(tasks);
  T.installActualTracking(h.api);
  h.fire("pomodoro.ended", POMO(1, "2026-11-05T03:00:00Z"));
  h.fire("task.completed", { taskId: 1, completedAt: "2026-11-05T04:00:00Z" });
  await settleTrack();
  assert.equal(h.writes.length, 1, "event kedua membaca tulisan pertama (berurutan per task) → 0 tulis");
  assert.ok(h.lists() >= 2, "setiap event membaca daftar segar");
  h.writes.length = 0;
  h.fire("pomodoro.ended", POMO("c-77", "2026-11-05T03:00:00Z"));
  h.fire("pomodoro.ended", POMO("c-12", "2026-11-05T03:00:00Z")); // cid lama setelah task mendapat id server → id terkini
  h.fire("pomodoro.ended", POMO(404, "2026-11-05T03:00:00Z"));
  h.fire("pomodoro.ended", POMO(9, "2026-11-05T03:00:00Z"));
  for (const bad of [{}, { taskId: null }, { taskId: "" }, { taskId: { id: 1 } }, null]) h.fire("pomodoro.ended", bad);
  await settleTrack();
  assert.deepEqual(h.writes.map((w) => w[1]), ["c-77", 12]);
});

test("T8 gagal diam: set ditolak / daftar gagal → tanpa toast, tanpa lempar ke bus (tidak dihitung error plugin), dicatat api.log.warn", async () => {
  const h = trackApi([mk(1, "A", {})], { setFail: true });
  T.installActualTracking(h.api);
  assert.doesNotThrow(() => h.fire("pomodoro.ended", POMO(1, "2026-11-05T03:00:00Z")));
  await settleTrack();
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.toast, []);
  assert.equal(h.warn.length, 1);
  assert.deepEqual(h.emitted, [], "gagal → seksi tidak diberi tahu");
  const g = trackApi([mk(1, "A", {})], { listFail: true });
  T.installActualTracking(g.api);
  assert.doesNotThrow(() => g.fire("task.completed", { taskId: 1 }));
  await settleTrack();
  assert.deepEqual(g.writes, []);
  assert.deepEqual(g.toast, []);
  assert.equal(g.warn.length, 1);
});

test("T8 R25 spy: pelacak terpasang + view terpasang — sync.done, pulled, onChange, app.dayChanged, scopeTasks dengan progress 0→20 dan status selesai (tiba lewat refresh/sinkron) → 0 tulis; lalu pomodoro.ended task tanpa start → tepat satu set", () => withEngineClock(async (clock) => {
  const tasks = [mk(1, "A", { start: "2026-11-02", duration: 3 }, { progress: 0 }), mk(2, "B", { start: "2026-11-03", duration: 2, actual: { start: "2026-11-03" } }, { progress: 0 })];
  const h = trackApi(tasks);
  const fr = fakeRecords();
  const v = fakeApi({ records: fr });
  // satu bus: pelacak dan view berbagi pendengar
  v.api.events = h.api.events;
  v.api.data = h.api.data;
  v.api.taskExt = h.api.taskExt;
  const off = T.installActualTracking(h.api);
  try {
    const base = ctxOf(tasks).ctx;
    let props = { context: base, api: v.api };
    const m = mount(T.TimelineViewBody);
    m.render(props);
    await settleView(m, () => props, clock);
    const zero = (step) => {
      assert.deepEqual(h.writes, [], step);
      assert.equal(fr.calls.put.length, 0, step + ": records.put");
    };
    zero("mount");
    h.fire("sync.done", { initial: false });
    await settleView(m, () => props, clock);
    zero("sync.done");
    fr.emit(PULLED);
    fr.emit({ entity: "project", ids: [], source: "sync" });
    fr.emit({ entity: "baseline", ids: [], source: "local" });
    await settleView(m, () => props, clock);
    zero("pulled/onChange");
    h.fire("app.dayChanged", { date: "2026-11-06" });
    await settleView(m, () => props, clock);
    zero("app.dayChanged");
    // progress naik dari 0 dan status selesai TIBA lewat sinkron/refresh (data diff) → BUKAN pemicu (amandemen K42)
    const synced = tasks.map((t) => Object.assign({}, t, { progress: 20 }));
    synced[0] = Object.assign({}, synced[0], { gtd_status: "done", completed_at: "2026-11-05T01:00:00Z", progress: 100 });
    props = { context: Object.assign({}, base, { tasks: synced, scopeTasks: synced }), api: v.api };
    await settleView(m, () => props, clock);
    h.fire("sync.done", { initial: false });
    await settleView(m, () => props, clock);
    zero("progress/status via refresh");
    await settleTrack();
    zero("settle");
    // event host gestur lokal: task ber-actual.start → 0; tanpa → tepat satu set
    h.fire("pomodoro.ended", POMO(2, "2026-11-05T03:00:00Z"));
    h.fire("task.completed", { taskId: 2, completedAt: "2026-11-05T03:00:00Z" });
    await settleTrack();
    zero("ber-actual.start");
    h.fire("pomodoro.ended", POMO(1, "2026-11-05T03:00:00Z"));
    await settleTrack();
    assert.deepEqual(h.writes, [["set", 1, { actual: { start: "2026-11-05" } }]]);
    m.unmount();
  } finally {
    off();
  }
}));

test("T8 sumber: factory memasang installActualTracking; recordActual satu-satunya penulis otomatis, tanpa Date/finish; tanpa pendengar progres", () => {
  const fac = jsx.slice(jsx.indexOf("register(manifest, function factory(api)"));
  assert.match(fac, /installActualTracking\(api\)/);
  const start = jsx.indexOf("function recordActual(");
  assert.ok(start > 0);
  const end = jsx.indexOf("\n}\n", start);
  const body = jsx.slice(start, end);
  assert.equal((body.match(/taskExt\.set\(/g) || []).length, 1);
  assert.doesNotMatch(body, /\bDate\b|finish:\s/);
  assert.doesNotMatch(jsx, /"task\.progress|"task\.updated|taskUpdated/, "tidak ada pemicu progres");
});

// ════════════════════════════════════════════════════════════════════════════
// Fase 1 PR 1d-1 — Task 2: record `resource` (K48, R9) — resRecId, resourceStore ber-CAS (saveResource), useResources
// (muat hanya saat panel terbuka, latch pulled), nol tulisan latar (R25)
// ════════════════════════════════════════════════════════════════════════════
// Record `resource` sah (lid null = pribadi). Id ditulis tangan DI TES (bentuk yang diharapkan); plugin membangunnya
// hanya lewat resRecId.
function resRec(lid, uid, data, extra) {
  return Object.assign({
    entity: "resource", id: lid ? "res@list:" + lid + ":" + uid : "res@user:" + uid, scope: lid ? "list:" + lid : "user",
    data: Object.assign({ v: 1, capacity: 6, leave: [{ from: "2026-11-09", to: "2026-11-10", note: "Cuti" }], by: 9 }, data || {}),
    updated_at: "2026-11-05T02:00:00Z", version: 2, pending: false,
  }, extra || {});
}
const resPuts = (fr) => fr.calls.put.filter((p) => p[0] === "resource");
const resLists = (fr) => fr.calls.list.filter((l) => l[0] === "resource");
const RES_ABSENT = { exists: false, updatedAt: null };

test("resRecId: workspace → res@list:<lid>:<uid> scope list:<lid>; project → res@user:<uid> scope user; uid/listId/pageKind tak sah → INVALID; id/scope cocok pola server", () => {
  assert.deepEqual(T.resRecId("workspace", 12, 7), { id: "res@list:12:7", scope: "list:12" });
  assert.deepEqual(T.resRecId("project", null, 7), { id: "res@user:7", scope: "user" });
  assert.deepEqual(T.resRecId("project", 12, 7), { id: "res@user:7", scope: "user" }, "halaman project pribadi: listId diabaikan");
  const bad = [
    ["workspace", 12, 0], ["workspace", 12, -3], ["workspace", 12, "7"], ["workspace", 12, 1.5], ["workspace", 12, null], ["project", null, undefined],
    ["workspace", null, 7], ["workspace", "12", 7], ["workspace", 0, 7], ["workspace", NaN, 7], ["workspace", 1.5, 7], ["lain", 12, 7], [undefined, 12, 7],
  ];
  for (const [k, lid, uid] of bad) assert.throws(() => T.resRecId(k, lid, uid), blCode("INVALID"), JSON.stringify([k, lid, uid]));
  const src = fs.readFileSync(path.join(__dirname, "../../plugin_records.py"), "utf8");
  const re = (n) => new RegExp(src.match(new RegExp("^" + n + ' = re\\.compile\\(r"([^"]+)"\\)', "m"))[1]);
  for (const t of [T.resRecId("workspace", 12, 7), T.resRecId("workspace", 987654321, 123456789), T.resRecId("project", null, 123456789)]) {
    assert.match(t.id, re("ID_RE"), t.id);
    assert.match(t.scope, re("SCOPE_RE"), t.scope);
  }
});

test("resourceStore.loadScope: dua halaman next (limit 1000) → Map<uid, {res, snap, pending}> lewat TLLoad.resourceDecode; id asing/rusak/scope lain dilewati; tanpa tulis", async () => {
  const fr = fakeRecords();
  for (let i = 0; i < 1003; i++) putRec(fr, resRec(12, 1000 + i, { capacity: i % 41 }));
  const a = resRec(12, 7, {}, { pending: true });
  const asing = resRec(12, 9, { v: 2, capacity: 3 }); // versi lain → bawaan lewat decode, tetap ada (exists, potret CAS)
  const byStr = resRec(12, 11, { by: "9" });
  for (const r of [a, asing, byStr]) putRec(fr, r);
  // id yang tidak cocok pola scope ini (ditanam langsung di scope list:12) → dilewati
  for (const id of ["res@list:13:5", "res@list:12:abc", "res@list:12:0", "res@list:12:007", "res@list:12:7:x", "res@user:5", "xres@list:12:5", "res@list:12:"]) {
    putRec(fr, Object.assign(resRec(12, 1), { id }));
  }
  putRec(fr, resRec(13, 7)); // workspace lain
  putRec(fr, resRec(null, 7, { capacity: 2 })); // pribadi
  putRec(fr, unitRec(12, "Alpha")); // entitas lain di scope sama
  const store = T.resourceStore({ records: fr.api, env: { userId: 7 } });
  const map = await store.loadScope("list:12");
  const ids12 = [...fr.store.values()].filter((r) => r.entity === "resource" && r.scope === "list:12").map((r) => r.id).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  assert.deepEqual(resLists(fr), [["resource", { scope: "list:12", limit: 1000 }], ["resource", { scope: "list:12", limit: 1000, after: ids12[999] }]]);
  assert.ok(map instanceof Map);
  assert.equal(map.size, 1003 + 3);
  const dn = T.TLCal.dn;
  assert.deepEqual(map.get(7), { res: { capacity: 6, leave: [{ from: dn("2026-11-09"), to: dn("2026-11-10"), note: "Cuti" }] }, snap: { exists: true, updatedAt: "2026-11-05T02:00:00Z", by: 9 }, pending: true });
  assert.deepEqual(map.get(9), { res: { capacity: 8, leave: [] }, snap: { exists: true, updatedAt: "2026-11-05T02:00:00Z", by: null }, pending: false }, "data asing: bawaan, by tidak dipercaya");
  assert.equal(map.get(11).snap.by, null, "by bukan bilangan bulat → null");
  assert.equal(map.get(1000 + 1002).res.capacity, 1002 % 41, "halaman kedua ikut");
  for (const k of map.keys()) assert.ok(Number.isInteger(k) && k > 0, "kunci uid bilangan: " + k);
  assert.equal(map.has(5), false);
  assert.equal(map.has(1), false);
  // pribadi: scope user, satu halaman
  const mine = await store.loadScope("user");
  assert.deepEqual(resLists(fr)[2], ["resource", { scope: "user", limit: 1000 }]);
  assert.deepEqual([...mine.keys()], [7]);
  assert.equal(mine.get(7).res.capacity, 2);
  // scope tidak sah → INVALID tanpa list
  for (const s of [null, undefined, "", "list:", "list:x", "list:0", "list:012", "workspace", 12]) await assert.rejects(store.loadScope(s), blCode("INVALID"), String(s));
  assert.equal(resLists(fr).length, 3);
  assert.equal(fr.calls.get.length, 0);
  assert.equal(fr.calls.put.length + fr.calls.remove.length, 0, "memuat tidak pernah menulis");
});

test("resourceStore.save → saveResource: CAS potret {exists, updatedAt} lewat records.get; beda → STALE (pesan persis) 0 put; record absen + potret {exists:false} → put ter-encode (by = env.userId, cuti tergabung) + {scope}", async () => {
  assert.equal(T.MSG_RES_STALE, "Data berubah sejak dialog dibuka — muat ulang");
  assert.equal(T.MSG_RES_WAIT, "Menunggu data workspace…");
  assert.equal(T.RES_ENTITY, "resource");
  const fr = fakeRecords();
  const store = T.resourceStore({ records: fr.api, env: { userId: 7 } });
  const tgt = T.resRecId("workspace", 12, 9);
  const value = { capacity: 5, leave: [{ from: "2026-11-10", to: "2026-11-12", note: "" }, { from: "2026-11-09", to: "2026-11-09", note: "Mudik" }] };
  // record absen + potret absen → satu get (CAS) lalu satu put
  const rec = await store.save(tgt, value, RES_ABSENT);
  assert.deepEqual(fr.calls.get, [["resource", "res@list:12:9"]]);
  assert.deepEqual(resPuts(fr), [["resource", "res@list:12:9", { v: 1, capacity: 5, leave: [{ from: "2026-11-09", to: "2026-11-12", note: "Mudik" }], by: 7 }, { scope: "list:12" }]]);
  assert.equal(rec.id, "res@list:12:9");
  assert.equal(rec.pending, true);
  // potret lama (absen) padahal record kini ada → STALE, 0 put
  await assert.rejects(store.save(tgt, value, RES_ABSENT), (e) => e instanceof Error && e.code === "STALE" && e.message === T.MSG_RES_STALE);
  assert.equal(resPuts(fr).length, 1);
  // potret dari loadScope → cocok → put
  const snap = (await store.loadScope("list:12")).get(9).snap;
  assert.deepEqual(snap, { exists: true, updatedAt: "2026-11-01T00:00:00Z", by: 7 });
  await store.save(tgt, { capacity: 4, leave: [] }, snap);
  assert.equal(resPuts(fr).length, 2);
  assert.deepEqual(resPuts(fr)[1][2], { v: 1, capacity: 4, leave: [], by: 7 });
  // anggota lain menimpa (updated_at baru) → potret lama STALE; record dihapus (absen) dengan potret exists → STALE
  const cur = fr.store.get("resource/res@list:12:9");
  fr.store.set("resource/res@list:12:9", Object.assign({}, cur, { updated_at: "2026-11-06T00:00:00Z" }));
  await assert.rejects(store.save(tgt, { capacity: 3, leave: [] }, snap), blCode("STALE"));
  fr.store.delete("resource/res@list:12:9");
  await assert.rejects(store.save(tgt, { capacity: 3, leave: [] }, snap), blCode("STALE"));
  await assert.rejects(store.save(tgt, { capacity: 3, leave: [] }, { exists: true, updatedAt: null }), blCode("STALE"));
  assert.equal(resPuts(fr).length, 2);
  // hanya exists + updatedAt yang dibandingkan (by potret tidak berpengaruh)
  await store.save(tgt, { capacity: 3, leave: [] }, { exists: false, updatedAt: null, by: 99 });
  assert.equal(resPuts(fr).length, 3);
  // pribadi: res@user:<uid> scope user; env.userId string angka → by bilangan (uidOf); env tanpa userId → by null
  await T.resourceStore({ records: fr.api, env: { userId: "7" } }).save(T.resRecId("project", null, 7), { capacity: 8, leave: [] }, RES_ABSENT);
  assert.deepEqual(resPuts(fr)[3], ["resource", "res@user:7", { v: 1, capacity: 8, leave: [], by: 7 }, { scope: "user" }]);
  await T.resourceStore({ records: fr.api }).save(T.resRecId("project", null, 8), { capacity: 0 }, RES_ABSENT);
  assert.deepEqual(resPuts(fr)[4], ["resource", "res@user:8", { v: 1, capacity: 0, leave: [], by: null }, { scope: "user" }]);
  assert.equal(fr.calls.remove.length, 0);
});

test("saveResource: > 4096 byte → TOO_LARGE (MSG_RES_TOO_LARGE) sebelum baca/tulis; = 4096 boleh; nilai/target/potret tak sah → INVALID 0 put; TOO_LARGE host dipetakan, galat lain diteruskan", async () => {
  assert.equal(typeof T.MSG_RES_TOO_LARGE, "string");
  assert.ok(T.MSG_RES_TOO_LARGE.length > 0);
  const fr = fakeRecords();
  const store = T.resourceStore({ records: fr.api, env: { userId: 7 } });
  const tgt = T.resRecId("workspace", 12, 9);
  // 45 rentang cuti terpisah (selang 3 hari, tidak bergabung) → ukuran diatur lewat panjang catatan
  const leaveOf = (lens) => lens.map((n, i) => ({ from: T.TLCal.iso(T.TLCal.dn("2026-01-05") + i * 3), to: T.TLCal.iso(T.TLCal.dn("2026-01-05") + i * 3), note: "x".repeat(n) }));
  const sizeOf = (lens) => T.TLLoad.resourceByteSize(T.TLLoad.resourceEncode({ capacity: 8, leave: leaveOf(lens) }, { by: 7 }));
  const base = sizeOf(new Array(45).fill(0));
  let need = 4096 - base;
  assert.ok(need > 0 && need <= 45 * 60, "rentang bisa mencapai 4096: " + base);
  const lens = new Array(45).fill(0).map(() => { const n = Math.min(60, need); need -= n; return n; });
  assert.equal(sizeOf(lens), 4096);
  await store.save(tgt, { capacity: 8, leave: leaveOf(lens) }, RES_ABSENT);
  assert.equal(resPuts(fr).length, 1, "= 4096 boleh");
  const over = lens.slice();
  over[over.findIndex((n) => n < 60)] += 1;
  assert.equal(sizeOf(over), 4097);
  const gets = fr.calls.get.length;
  await assert.rejects(store.save(tgt, { capacity: 8, leave: leaveOf(over) }, RES_ABSENT), (e) => e.code === "TOO_LARGE" && e.message === T.MSG_RES_TOO_LARGE);
  assert.equal(fr.calls.get.length, gets, "ditolak sebelum baca CAS");
  assert.equal(resPuts(fr).length, 1);
  // nilai tak sah (kode INVALID dari TLLoad.resourceEncode), target palsu, potret tak sah → INVALID tanpa baca/tulis
  for (const v of [null, { capacity: 41 }, { capacity: 2.5 }, { capacity: 8, leave: [{ from: "2026-11-05", to: "2026-11-04" }] }, { capacity: 8, leave: "x" }]) {
    await assert.rejects(store.save(tgt, v, RES_ABSENT), blCode("INVALID"), JSON.stringify(v));
  }
  for (const t of [null, {}, { id: "res@list:12:9", scope: "list:13" }, { id: "res@list:12:9", scope: "user" }, { id: "res@user:9", scope: "list:12" }, { id: "res@list:12:0", scope: "list:12" }, { id: "prj@list:12:-", scope: "list:12" }, { id: "res@list:12:9" }]) {
    await assert.rejects(store.save(t, { capacity: 8, leave: [] }, RES_ABSENT), blCode("INVALID"), JSON.stringify(t));
  }
  for (const s of [undefined, null, "x", 5]) await assert.rejects(store.save(tgt, { capacity: 8, leave: [] }, s), blCode("INVALID"), String(s));
  assert.equal(fr.calls.get.length, gets);
  assert.equal(resPuts(fr).length, 1);
  // TOO_LARGE dari host → galat sama dengan penolakan klien; galat lain apa adanya
  fr.api.put = () => Promise.reject(Object.assign(new Error("TOO_LARGE: data > 4096 byte"), { code: "TOO_LARGE", detail: "size" }));
  await assert.rejects(store.save(T.resRecId("workspace", 12, 3), { capacity: 8, leave: [] }, RES_ABSENT), (e) => e.code === "TOO_LARGE" && e.message === T.MSG_RES_TOO_LARGE);
  fr.api.put = () => Promise.reject(Object.assign(new Error("SCOPE_IMMUTABLE"), { code: "SCOPE_IMMUTABLE" }));
  await assert.rejects(store.save(T.resRecId("workspace", 12, 4), { capacity: 8, leave: [] }, RES_ABSENT), blCode("SCOPE_IMMUTABLE"));
});

test("resourceStore.subscribe: entitas resource + peristiwa pulled diteruskan (recordEvent); entitas lain diabaikan; off berhenti", () => {
  const fr = fakeRecords();
  const store = T.resourceStore({ records: fr.api, env: { userId: 7 } });
  const got = [];
  const off = store.subscribe((ev) => got.push(ev));
  fr.emit({ entity: "resource", ids: ["res@list:12:7"], source: "sync", lost: ["res@list:12:7"] });
  fr.emit({ entity: "baseline", ids: ["x"], source: "sync" });
  fr.emit(PULLED);
  fr.emit({ entity: "resource", ids: ["res@user:7"], source: "local" });
  assert.deepEqual(got, [
    { ids: ["res@list:12:7"], source: "sync", lost: ["res@list:12:7"] },
    { ids: [], source: "sync", lost: [], pulled: true },
    { ids: ["res@user:7"], source: "local", lost: [] },
  ]);
  off();
  assert.equal(fr.listenerCount(), 0);
});

test("useResources: tertutup → 0 records.list (juga setelah onChange resource); terbuka → muat scope list:<lid>, muat ulang onChange resource (debounce 300 ms) dan SEGERA saat pulled lalu latch; ditutup → data dilepas, tidak memuat; lepas → 0 pendengar", () => withEngineClock(async (clock) => {
  const fr = fakeRecords();
  putRec(fr, resRec(12, 7));
  const { api } = fakeApi({ records: fr });
  const m = mount((p) => T.useResources(p.api, p.pageKind, p.listId, p.open));
  let props = { api, pageKind: "workspace", listId: 12, open: false };
  m.render(props);
  m.flush();
  await settle();
  let r = m.render(props);
  assert.equal(resLists(fr).length, 0, "tertutup: tidak memuat");
  assert.equal(r.loaded, false);
  assert.equal(r.map.size, 0);
  assert.equal(r.pulled, false);
  fr.emit({ entity: "resource", ids: ["res@list:12:7"], source: "sync" });
  clock.tick(300);
  await settle();
  assert.equal(resLists(fr).length, 0, "tertutup: onChange tidak memuat");
  // buka → muat pertama segera (tanpa debounce)
  props = Object.assign({}, props, { open: true });
  m.render(props);
  m.flush();
  await settle();
  r = m.render(props);
  assert.deepEqual(resLists(fr), [["resource", { scope: "list:12", limit: 1000 }]]);
  assert.equal(r.loaded, true);
  assert.deepEqual([...r.map.keys()], [7]);
  assert.equal(r.map.get(7).res.capacity, 6);
  assert.equal(r.pulled, false);
  // record tiba lewat sinkron biasa → muat ulang setelah 300 ms (beruntun = satu)
  putRec(fr, resRec(12, 9, { capacity: 2 }));
  fr.emit({ entity: "resource", ids: ["res@list:12:9"], source: "sync" });
  fr.emit({ entity: "resource", ids: ["res@list:12:9"], source: "sync" });
  clock.tick(299);
  await settle();
  assert.equal(resLists(fr).length, 1);
  clock.tick(1);
  await settle();
  r = m.render(props);
  assert.equal(resLists(fr).length, 2);
  assert.deepEqual([...r.map.keys()].sort((a, b) => a - b), [7, 9]);
  assert.equal(r.pulled, false, "sinkron biasa bukan tanda tarik sukses");
  // entitas lain tidak memuat ulang
  fr.emit({ entity: "baseline", ids: ["x"], source: "sync" });
  clock.tick(300);
  await settle();
  assert.equal(resLists(fr).length, 2);
  // tarik sukses → muat ulang SEGERA, lalu latch
  fr.emit(PULLED);
  await settle();
  r = m.render(props);
  assert.equal(resLists(fr).length, 3);
  assert.equal(r.pulled, true);
  // ditutup → data dilepas; event tidak memuat
  props = Object.assign({}, props, { open: false });
  r = m.render(props);
  assert.equal(r.loaded, false);
  assert.equal(r.map.size, 0);
  m.flush();
  await settle();
  fr.emit({ entity: "resource", ids: ["res@list:12:7"], source: "sync" });
  fr.emit(PULLED);
  clock.tick(300);
  await settle();
  r = m.render(props);
  assert.equal(resLists(fr).length, 3);
  assert.equal(r.pulled, true, "latch bertahan selama terpasang");
  assert.equal(r.loaded, false);
  // dibuka lagi → mulai dari memuat (bukan data lama), lalu termuat
  props = Object.assign({}, props, { open: true });
  r = m.render(props);
  assert.equal(r.loaded, false);
  m.flush();
  await settle();
  r = m.render(props);
  assert.equal(resLists(fr).length, 4);
  assert.equal(r.loaded, true);
  m.unmount();
  assert.equal(fr.listenerCount(), 0);
  assert.equal(fr.calls.put.length + fr.calls.remove.length, 0, "hook tidak pernah menulis");
}));

test("useResources: latch pulled menyala juga saat panel tertutup (tanpa muat) — dibuka sesudahnya → muat sekali; pribadi pulled true, scope user; listId tak sah → tanpa muat; muat gagal → failed + latch tetap menyala", () => withEngineClock(async (clock) => {
  const fr = fakeRecords();
  putRec(fr, resRec(12, 7));
  putRec(fr, resRec(null, 7, { capacity: 3 }));
  const { api } = fakeApi({ records: fr });
  const hook = () => mount((p) => T.useResources(p.api, p.pageKind, p.listId, p.open));
  const m = hook();
  let props = { api, pageKind: "workspace", listId: 12, open: false };
  m.render(props);
  m.flush();
  fr.emit(PULLED);
  await settle();
  let r = m.render(props);
  assert.equal(r.pulled, true, "tarik sukses saat tertutup → latch menyala tanpa memuat");
  assert.equal(resLists(fr).length, 0);
  props = Object.assign({}, props, { open: true });
  m.render(props);
  m.flush();
  await settle();
  r = m.render(props);
  assert.equal(resLists(fr).length, 1);
  assert.equal(r.loaded, true);
  assert.equal(r.pulled, true);
  m.unmount();
  // pribadi: tidak butuh latch (pulled true), scope user
  const p = hook();
  const pp = { api, pageKind: "project", listId: null, open: true };
  r = p.render(pp);
  assert.equal(r.pulled, true);
  p.flush();
  await settle();
  r = p.render(pp);
  assert.deepEqual(resLists(fr)[1], ["resource", { scope: "user", limit: 1000 }]);
  assert.deepEqual([...r.map.keys()], [7]);
  assert.equal(r.map.get(7).res.capacity, 3);
  p.unmount();
  // workspace dengan listId tak sah → tanpa muat, tidak termuat
  const w = hook();
  const wp = { api, pageKind: "workspace", listId: NaN, open: true };
  w.render(wp);
  w.flush();
  await settle();
  r = w.render(wp);
  assert.equal(resLists(fr).length, 2);
  assert.equal(r.loaded, false);
  w.unmount();
  // muat gagal → failed + warn; pulled → muat ulang (gagal lagi) tetapi latch tetap menyala (pola useBaselines)
  const fr3 = fakeRecords();
  fr3.api.list = () => Promise.reject(new Error("idb"));
  const h3 = fakeApi({ records: fr3 });
  const f = hook();
  const fp = { api: h3.api, pageKind: "workspace", listId: 12, open: true };
  f.render(fp);
  f.flush();
  await settle();
  r = f.render(fp);
  assert.equal(r.failed, true);
  assert.equal(r.loaded, false);
  assert.equal(h3.calls.warn.length, 1);
  fr3.emit(PULLED);
  await settle();
  r = f.render(fp);
  assert.equal(h3.calls.warn.length, 2);
  assert.equal(r.pulled, true);
  f.unmount();
  assert.equal(fr.calls.put.length + fr3.calls.put.length + fr.calls.remove.length, 0);
}));

test("spy R25 Beban Tim: taskExt.set/setMany + records.put/remove = 0 dengan view + useResources TERBUKA (record resource ada) setelah: mount, sync.done, pulled, onChange resource dari sinkron (anggota lain), app.dayChanged + env.today berubah, lepas; record resource yang belum ada tidak pernah dibuat", () => withEngineClock(async (clock) => {
  const tasks = bigTasks(60, 40).map((t, i) => Object.assign({}, t, { list_id: 12, assigned_to: [7, 9, 11, null][i % 4], estimated_pomodoros: 1 + (i % 6) }));
  const fr = fakeRecords();
  for (let i = 0; i < 5; i++) putRec(fr, unitRec(12, "P" + i));
  putRec(fr, resRec(12, 7, { capacity: 1 }));
  let resState = null;
  const ViewRes = (p) => { resState = T.useResources(p.api, "workspace", 12, true); return T.TimelineViewBody(p); };
  const { api, calls } = fakeApi({ records: fr });
  api.env.userId = 7;
  api.data = { tasks: { list: () => Promise.resolve(tasks) } };
  const writes = spyWrites(api);
  const spy = spyRun();
  try {
    const base = ctxOf(tasks, { page: "slist_12", pageKind: "workspace", listId: 12, projectName: null }).ctx;
    const props = { context: base, api };
    const m = mount(ViewRes);
    await settleView(m, () => props, clock);
    const ok = (step) => {
      assert.deepEqual(writes, [], step + ": taskExt");
      assert.equal(fr.calls.put.length, 0, step + ": records.put");
      assert.equal(fr.calls.remove.length, 0, step + ": records.remove");
    };
    assert.equal(resState.loaded, true);
    assert.deepEqual([...resState.map.keys()], [7]);
    ok("mount");
    for (const f of calls.handlers["sync.done"] || []) f({ initial: false });
    await settleView(m, () => props, clock);
    ok("sync.done");
    fr.emit(PULLED);
    await settleView(m, () => props, clock);
    assert.equal(resState.pulled, true);
    ok("pulled");
    // anggota lain mengubah kapasitas uid 7 dan menambah uid 9 (sinkron)
    putRec(fr, resRec(12, 7, { capacity: 4 }, { updated_at: "2026-11-06T00:00:00Z" }));
    putRec(fr, resRec(12, 9, { capacity: 2 }));
    const lists = resLists(fr).length;
    fr.emit({ entity: "resource", ids: ["res@list:12:7", "res@list:12:9"], source: "sync", lost: ["res@list:12:7"] });
    await settleView(m, () => props, clock);
    assert.ok(resLists(fr).length > lists, "onChange resource → muat ulang");
    assert.equal(resState.map.get(7).res.capacity, 4);
    assert.deepEqual([...resState.map.keys()].sort((a, b) => a - b), [7, 9]);
    ok("onChange resource");
    // ganti hari: app.dayChanged (bila ada pendengar) + env.today baru
    api.env.today = () => "2026-11-05";
    for (const f of calls.handlers["app.dayChanged"] || []) f({ today: "2026-11-05" });
    await settleView(m, () => props, clock);
    ok("app.dayChanged");
    assert.equal(fr.store.has("resource/res@list:12:11"), false, "record uid 11 (tanpa record) tidak dibuat otomatis");
    m.unmount();
    clock.tick(5000);
    await settle();
    ok("lepas");
    assert.equal(fr.listenerCount(), 0);
  } finally {
    spy.restore();
  }
}));

// ════════════════════════════════════════════════════════════════════════════
// Fase 1 PR 1d-1 — Task 3: useLoad + daftar orang (R4, P2 (a)) + pref panel `load:<page>` (K56, R10)
// ════════════════════════════════════════════════════════════════════════════
// Spy beban: T.engine.load = satu-satunya pintu TLLoad.run di plugin (TLLoad beku, tidak bisa di-spy langsung; pola spyRun).
function spyLoad() {
  const orig = T.engine.load;
  const runs = [];
  T.engine.load = (input) => {
    const out = orig(input);
    runs.push({ input, out });
    return out;
  };
  return { runs, restore: () => { T.engine.load = orig; } };
}
const loadPrefGet = (page, v) => (k) => Promise.resolve(k === "load:" + page ? v : null);

test("pref load:<page>: bawaan false (K56), kunci per halaman, nilai rusak → false; usePref round-trip lewat api.storage", async () => {
  assert.equal(T.PREF_DEFAULTS.load, false);
  assert.equal(T.prefKey("load", "slist_12"), "load:slist_12");
  assert.equal(T.prefKey("load", "proj_Alpha"), "load:proj_Alpha");
  assert.equal(T.cleanPref("load", true), true);
  for (const v of [false, "ya", 1, null, undefined]) assert.equal(T.cleanPref("load", v), false, String(v));
  assert.match(jsx, /usePref\(api, "load", page\)/);
  // tulis: set(true) → storage.set("load:<page>", true); baca: nilai tersimpan → true
  const stored = new Map();
  const { api, calls } = fakeApi({ storageGet: (k) => Promise.resolve(stored.has(k) ? stored.get(k) : null) });
  api.storage.set = (k, v) => { calls.storageSet.push([k, v]); stored.set(k, v); return Promise.resolve(); };
  const m = mount((p) => T.usePref(p.api, "load", p.page));
  let [val, set] = m.render({ api, page: "slist_12" });
  assert.equal(val, false);
  m.flush();
  await settle();
  [val, set] = m.render({ api, page: "slist_12" });
  assert.equal(val, false, "belum tersimpan → bawaan");
  set(true);
  await settle();
  assert.deepEqual(calls.storageSet, [["load:slist_12", true]]);
  m.unmount();
  const m2 = mount((p) => T.usePref(p.api, "load", p.page));
  m2.render({ api, page: "slist_12" });
  m2.flush();
  await settle();
  assert.equal(m2.render({ api, page: "slist_12" })[0], true, "pulang-pergi");
  m2.render({ api, page: "slist_13" });
  m2.flush();
  await settle();
  assert.equal(m2.render({ api, page: "slist_13" })[0], false, "halaman lain: kunci sendiri");
  assert.ok(calls.storageGet.indexOf("load:slist_13") >= 0);
  m2.unmount();
});

test("peopleOf workspace (P2 (a)): pengguna aktif ∪ penanggung jawab task hidup belum selesai tidak berulang ∪ pemilik record; nama dari currentUser/collaborators, tak dikenal → 'Anggota #id'; res dari record; urut uid", () => {
  const dn = T.TLCal.dn;
  const tasks = [
    mk(1, "A", {}, { assigned_to: 9 }),
    mk(2, "B", {}, { assigned_to: "11" }), // string angka → 11
    mk(3, "C", {}, { assigned_to: 13, gtd_status: "done" }), // selesai → tidak menambah
    mk(4, "D", {}, { assigned_to: 15, completed_at: "2026-11-03T02:00:00Z" }), // selesai (completed_at)
    mk(5, "E", {}, { assigned_to: 17, recurrence_type: "daily" }), // berulang
    mk(6, "F", {}, { assigned_to: 19, archived: true }), // diarsip
    mk(7, "G", {}, { assigned_to: 21, gtd_status: "archived" }),
    mk(8, "H", {}, { assigned_to: 23, deleted: true }),
    mk(9, "I", {}, { assigned_to: null }),
    mk(10, "J", {}, { assigned_to: 0 }),
    mk(11, "K", {}, { assigned_to: 9 }), // ganda
    null,
  ];
  const resources = new Map([
    [31, { res: { capacity: 4, leave: [{ from: dn("2026-11-09"), to: dn("2026-11-09"), note: "" }] }, snap: { exists: true, updatedAt: "x", by: 7 }, pending: false }],
    [9, { res: { capacity: 2, leave: [] }, snap: { exists: true, updatedAt: "x", by: 7 }, pending: true }],
  ]);
  const collaborators = [
    { id: 9, username: "budi", display_name: "Budi Santoso" },
    { id: "11", username: "citra", display_name: "" },
    { id: 31, username: "  ", display_name: "   " }, // nama kosong → Anggota #31
    { id: 13, username: "dina", display_name: "Dina" },
  ];
  const out = T.peopleOf({ byAssignee: true, ctxTasks: tasks, resources, currentUser: { id: 7, username: "sari", display_name: "Sari" }, collaborators, userId: 7 });
  assert.deepEqual(out, [
    { uid: 7, name: "Sari", res: null },
    { uid: 9, name: "Budi Santoso", res: { capacity: 2, leave: [] } },
    { uid: 11, name: "citra", res: null },
    { uid: 31, name: "Anggota #31", res: { capacity: 4, leave: [{ from: dn("2026-11-09"), to: dn("2026-11-09"), note: "" }] } },
  ]);
  // deterministik: urutan masukan tidak berpengaruh
  const out2 = T.peopleOf({ byAssignee: true, ctxTasks: tasks.slice().reverse(), resources: new Map([...resources].reverse()), currentUser: { id: 7, username: "sari", display_name: "Sari" }, collaborators: collaborators.slice().reverse(), userId: 7 });
  assert.deepEqual(out2, out);
  // userId string angka (JWT sub) + currentUser.id string → tetap satu baris uid bilangan
  const s = T.peopleOf({ byAssignee: true, ctxTasks: [mk(1, "A", {}, { assigned_to: 7 })], resources: new Map(), currentUser: { id: "7", username: "sari" }, collaborators: [], userId: "7" });
  assert.deepEqual(s, [{ uid: 7, name: "sari", res: null }]);
  // pengguna aktif tanpa currentUser cocok → "Anggota #id"; tanpa userId → hanya penanggung jawab/pemilik record
  assert.deepEqual(T.peopleOf({ byAssignee: true, ctxTasks: [], resources: new Map(), currentUser: null, collaborators: [], userId: 7 }), [{ uid: 7, name: "Anggota #7", res: null }]);
  assert.deepEqual(T.peopleOf({ byAssignee: true, ctxTasks: [mk(1, "A", {}, { assigned_to: 5 })], resources: undefined, currentUser: undefined, collaborators: undefined, userId: null }), [{ uid: 5, name: "Anggota #5", res: null }]);
  assert.deepEqual(T.peopleOf(null), []);
});

test("peopleOf pribadi (byAssignee false): satu baris pengguna aktif dengan res record pribadi; penanggung jawab/record lain diabaikan", () => {
  const resources = new Map([[7, { res: { capacity: 3, leave: [] }, snap: {}, pending: false }], [9, { res: { capacity: 1, leave: [] }, snap: {}, pending: false }]]);
  const out = T.peopleOf({ byAssignee: false, ctxTasks: [mk(1, "A", {}, { assigned_to: 9 })], resources, currentUser: { id: 7, username: "sari", display_name: "Sari" }, collaborators: [{ id: 9, username: "budi" }], userId: 7 });
  assert.deepEqual(out, [{ uid: 7, name: "Sari", res: { capacity: 3, leave: [] } }]);
  assert.deepEqual(T.peopleOf({ byAssignee: false, ctxTasks: [], resources: new Map(), currentUser: { id: 7, username: "sari" }, collaborators: [], userId: 7 }), [{ uid: 7, name: "sari", res: null }]);
  assert.deepEqual(T.peopleOf({ byAssignee: false, ctxTasks: [], resources: new Map(), currentUser: null, collaborators: [], userId: null }), [], "tanpa pengguna aktif → tanpa baris");
});

test("useLoad: null bila panel tertutup / mesin belum siap / hari tak sah / kapasitas belum termuat atau gagal (ready bukan true) (0 run); siap → satu run engine.load dengan masukan eng.ctx + result; memo per peopleKey (larik baru berisi sama → 0 run); lempar → null + satu peringatan", () => {
  const tasks = [mk(1, "A", { start: "2026-11-02", duration: 2 }, { assigned_to: 7, estimated_pomodoros: 4 })];
  const cal = T.TLCal.compile(T.TLCal.DEFAULT_CAL);
  const readExt = (t) => fakeApi().api.taskExt.read(t);
  const ctx = { tasks, cal, units: new Map(), readExt };
  const result = T.TLCpm.run(ctx);
  const ready = { status: "ready", result, ctx };
  const people = [{ uid: 7, name: "Sari", res: null }];
  const D = T.TLCal.dn(TODAY);
  const { api, calls } = fakeApi();
  const spy = spyLoad();
  try {
    const m = mount((p) => T.useLoad(p));
    const base = { open: false, ready: true, eng: ready, people, todayDn: D, byAssignee: true, ownerUid: 7, api };
    assert.equal(m.render(base), null, "tertutup");
    assert.equal(m.render(Object.assign({}, base, { open: true, eng: { status: "loading", result: null, ctx: null } })), null, "mesin belum siap");
    assert.equal(m.render(Object.assign({}, base, { open: true, eng: { status: "error", result: null, ctx: null } })), null, "mesin galat");
    assert.equal(m.render(Object.assign({}, base, { open: true, todayDn: null })), null, "hari tak sah");
    // review akhir: kapasitas/cuti belum termuat (ready false / tidak diberikan) → 0 run (tanpa kilatan kapasitas bawaan)
    assert.equal(m.render(Object.assign({}, base, { open: true, ready: false })), null, "kapasitas belum termuat");
    assert.equal(m.render(Object.assign({}, base, { open: true, ready: undefined })), null, "ready tidak diberikan");
    assert.equal(spy.runs.length, 0);
    const on = Object.assign({}, base, { open: true });
    const out = m.render(on);
    assert.equal(spy.runs.length, 1);
    const inp = spy.runs[0].input;
    assert.equal(inp.tasks, tasks);
    assert.equal(inp.cal, cal);
    assert.equal(inp.readExt, readExt);
    assert.equal(inp.units, ctx.units);
    assert.equal(inp.result, result);
    assert.deepEqual(inp.people, people);
    assert.deepEqual([inp.byAssignee, inp.ownerUid, inp.D], [true, 7, D]);
    assert.ok(out && Array.isArray(out.rows));
    assert.deepEqual(out.rows.map((r) => [r.uid, r.name, r.total]), [[7, "Sari", 4000]]);
    // render ulang: objek props baru, larik people baru berisi sama → 0 run
    m.render(Object.assign({}, on, { people: people.map((p) => Object.assign({}, p)) }));
    m.render(on);
    assert.equal(spy.runs.length, 1);
    // perubahan nyata: hari, isi people (res), byAssignee, ownerUid, hasil mesin → masing-masing satu run
    m.render(Object.assign({}, on, { todayDn: D + 1 }));
    assert.equal(spy.runs.length, 2);
    const p2 = [{ uid: 7, name: "Sari", res: { capacity: 1, leave: [] } }];
    m.render(Object.assign({}, on, { todayDn: D + 1, people: p2 }));
    assert.equal(spy.runs.length, 3);
    m.render(Object.assign({}, on, { todayDn: D + 1, people: p2, byAssignee: false }));
    assert.equal(spy.runs.length, 4);
    m.render(Object.assign({}, on, { todayDn: D + 1, people: p2, byAssignee: false, ownerUid: 9 }));
    assert.equal(spy.runs.length, 5);
    // tutup lalu buka lagi tanpa perubahan data → satu run saat dibuka (tertutup = 0)
    m.render(Object.assign({}, on, { open: false }));
    assert.equal(spy.runs.length, 5);
    m.render(on);
    assert.equal(spy.runs.length, 6);
    // lempar tak terduga → null + satu peringatan saja
    T.engine.load = () => { throw new Error("rusak"); };
    assert.equal(m.render(Object.assign({}, on, { todayDn: D + 2 })), null);
    assert.equal(m.render(Object.assign({}, on, { todayDn: D + 3 })), null);
    assert.equal(calls.warn.length, 1);
  } finally {
    spy.restore();
  }
});

// View workspace 12: anggota 7 (pengguna aktif), 9, 11; record resource uid 9 kapasitas 1; pref load opsional.
function loadTasks() {
  const L = { list_id: 12, project: "P0" };
  return [
    mk(1, "A", { start: "2026-11-04", duration: 2 }, Object.assign({ assigned_to: 9, estimated_pomodoros: 6 }, L)),
    mk(2, "B", { start: "2026-11-04", duration: 1 }, Object.assign({ assigned_to: 7, estimated_pomodoros: 2 }, L)),
    mk(3, "C", { start: "2026-11-05", duration: 1 }, Object.assign({ assigned_to: 11, estimated_pomodoros: 3, gtd_status: "done" }, L)),
    mk(4, "D", { start: "2026-11-05", duration: 1 }, Object.assign({ estimated_pomodoros: 1 }, L)),
  ];
}
async function loadView(clock, o) {
  const opt = o || {};
  const tasks = opt.tasks || loadTasks();
  const fr = fakeRecords();
  putRec(fr, unitRec(12, "P0"));
  putRec(fr, resRec(12, 9, { capacity: 1, leave: [] }));
  // review akhir: holdRes → records.list resource PERTAMA ditahan sampai releaseRes() (muat kapasitas lambat)
  const held = { release: null };
  if (opt.holdRes) {
    const list0 = fr.api.list;
    fr.api.list = (entity, q) => {
      if (entity !== "resource" || held.used) return list0(entity, q);
      held.used = true;
      const out = list0(entity, q); // panggilan tercatat seketika; jawabannya ditahan
      return new Promise((resolve) => { held.release = () => resolve(out); });
    };
  }
  const { api, calls } = fakeApi({ records: fr, storageGet: opt.storageGet });
  api.env.userId = 7;
  api.data = { tasks: { list: () => Promise.resolve(tasks) } };
  const writes = spyWrites(api);
  const ctx = ctxOf(tasks, {
    page: "slist_12", pageKind: "workspace", listId: 12, projectName: null,
    currentUser: { id: 7, username: "sari", display_name: "Sari" },
    collaborators: [{ id: 9, username: "budi", display_name: "Budi" }, { id: 11, username: "citra" }],
  }).ctx;
  let props = { context: ctx, api };
  const m = mount(T.TimelineViewBody);
  const settleNow = () => settleView(m, () => props, clock);
  const tree = await settleNow();
  return { m, tree, api, calls, fr, writes, settleNow, held, releaseRes: () => held.release(), getProps: () => props, setProps: (p) => { props = p; } };
}

test("view: panel Beban Tim tertutup (pref bawaan false) → 0 run TLLoad meski mesin siap, 0 records.list resource", () => withEngineClock(async (clock) => {
  const spy = spyRun();
  const ls = spyLoad();
  try {
    const h = await loadView(clock);
    assert.ok(spy.runs.length >= 1, "mesin siap");
    assert.ok(h.calls.storageGet.indexOf("load:slist_12") >= 0, "pref load dibaca");
    assert.equal(ls.runs.length, 0, "panel tertutup → TLLoad.run tidak dipanggil");
    assert.equal(resLists(h.fr).length, 0, "kapasitas tidak dimuat");
    // render ulang + event → tetap 0
    for (const f of h.calls.handlers["sync.done"] || []) f({ initial: false });
    h.fr.emit(PULLED);
    h.fr.emit({ entity: "resource", ids: ["res@list:12:9"], source: "sync" });
    await h.settleNow();
    assert.equal(ls.runs.length, 0);
    assert.equal(resLists(h.fr).length, 0);
    assert.deepEqual(h.writes, []);
    assert.equal(h.fr.calls.put.length, 0);
    h.m.unmount();
  } finally {
    ls.restore();
    spy.restore();
  }
}));

test("view: pref load:slist_12 true → tepat 1 run TLLoad setelah mesin siap DAN kapasitas termuat (review akhir: mesin siap lebih dulu → 0 run sampai records.list selesai; masukan = ctx mesin, orang P2 (a) dengan res record, hari ini); render ulang tanpa perubahan → 0 run; ganti hari → 1 run; record resource berubah → 1 run; 0 tulis di semua langkah", () => withEngineClock(async (clock) => {
  const spy = spyRun();
  const ls = spyLoad();
  try {
    const h = await loadView(clock, { storageGet: loadPrefGet("slist_12", true), holdRes: true });
    assert.ok(spy.runs.length >= 1, "mesin siap");
    assert.equal(resLists(h.fr).length, 1, "kapasitas sedang dimuat");
    assert.equal(ls.runs.length, 0, "kapasitas belum termuat → 0 run (tanpa kilatan kapasitas bawaan)");
    assert.equal(panelOf(h.m.render(h.getProps())), undefined, "panel belum tampil");
    h.releaseRes();
    await h.settleNow();
    assert.equal(ls.runs.length, 1, "tepat satu run setelah mesin siap dan kapasitas termuat");
    const eng = spy.runs[spy.runs.length - 1];
    const inp = ls.runs[0].input;
    assert.equal(inp.tasks, eng.ctx.tasks, "daftar lengkap halaman = ctx mesin");
    assert.equal(inp.cal, eng.ctx.cal);
    assert.equal(inp.result, eng.result);
    assert.equal(inp.units, eng.ctx.units);
    assert.equal(inp.readExt, eng.ctx.readExt);
    assert.equal(inp.byAssignee, true);
    assert.equal(inp.ownerUid, 7);
    assert.equal(inp.D, T.TLCal.dn(TODAY));
    assert.deepEqual(inp.people, [
      { uid: 7, name: "Sari", res: null },
      { uid: 9, name: "Budi", res: { capacity: 1, leave: [] } },
    ], "11 hanya punya task selesai → bukan baris");
    const out = ls.runs[0].out;
    assert.deepEqual(out.rows.map((r) => [r.uid, r.name]), [[9, "Budi"], [7, "Sari"], [null, "Belum ditugaskan"]]);
    assert.deepEqual(out.rows[0].overDays.map(T.TLCal.iso), ["2026-11-04", "2026-11-05"], "6 🍅 / 2 hari > kapasitas 1");
    assert.equal(resLists(h.fr).length, 1, "kapasitas dimuat karena panel terbuka");
    // render ulang tanpa perubahan data (props baru, context baru dengan isi sama) → 0 run
    h.m.render(h.getProps());
    h.setProps(Object.assign({}, h.getProps(), { context: Object.assign({}, h.getProps().context, { collaborators: h.getProps().context.collaborators.map((c) => Object.assign({}, c)) }) }));
    await h.settleNow();
    assert.equal(ls.runs.length, 1, "render ulang tanpa perubahan data");
    // ganti hari → 1 run
    h.api.env.today = () => "2026-11-05";
    for (const f of h.calls.handlers["app.dayChanged"] || []) f({ today: "2026-11-05" });
    await h.settleNow();
    assert.equal(ls.runs.length, 2);
    assert.equal(ls.runs[1].input.D, T.TLCal.dn("2026-11-05"));
    // anggota lain mengubah kapasitas uid 9 (sinkron) → muat ulang → 1 run
    putRec(h.fr, resRec(12, 9, { capacity: 6, leave: [] }, { updated_at: "2026-11-06T00:00:00Z" }));
    h.fr.emit({ entity: "resource", ids: ["res@list:12:9"], source: "sync" });
    await h.settleNow();
    assert.equal(ls.runs.length, 3);
    assert.deepEqual(ls.runs[2].input.people.find((p) => p.uid === 9).res, { capacity: 6, leave: [] });
    // sync.done tanpa perubahan data + pulled → muat ulang, tetapi 0 run tambahan
    for (const f of h.calls.handlers["sync.done"] || []) f({ initial: false });
    h.fr.emit(PULLED);
    await h.settleNow();
    assert.equal(ls.runs.length, 3, "data sama → tanpa hitung ulang");
    assert.deepEqual(h.writes, [], "R25: taskExt");
    assert.equal(h.fr.calls.put.length + h.fr.calls.remove.length, 0, "R25: records");
    h.m.unmount();
    assert.equal(h.fr.listenerCount(), 0);
  } finally {
    ls.restore();
    spy.restore();
  }
}));

test("view project pribadi: pref load:proj_Alpha true → satu baris pengguna aktif (byAssignee false, ownerUid), record res@user dimuat dari scope user", () => withEngineClock(async (clock) => {
  const tasks = [mk(1, "A", { start: "2026-11-04", duration: 2 }, { project: "Alpha", assigned_to: 9, estimated_pomodoros: 4 })];
  const fr = fakeRecords();
  putRec(fr, resRec(null, 7, { capacity: 1, leave: [] }));
  const { api } = fakeApi({ records: fr, storageGet: loadPrefGet("proj_Alpha", true) });
  api.env.userId = 7;
  api.data = { tasks: { list: () => Promise.resolve(tasks) } };
  const writes = spyWrites(api);
  const ls = spyLoad();
  try {
    const ctx = ctxOf(tasks, { currentUser: { id: 7, username: "sari", display_name: "Sari" }, collaborators: [{ id: 9, username: "budi" }] }).ctx;
    const m = mount(T.TimelineViewBody);
    await settleView(m, () => ({ context: ctx, api }), clock);
    assert.deepEqual(resLists(fr), [["resource", { scope: "user", limit: 1000 }]]);
    assert.equal(ls.runs.length, 1);
    const inp = ls.runs[0].input;
    assert.equal(inp.byAssignee, false);
    assert.equal(inp.ownerUid, 7);
    assert.deepEqual(inp.people, [{ uid: 7, name: "Sari", res: { capacity: 1, leave: [] } }]);
    assert.deepEqual(ls.runs[0].out.rows.map((r) => [r.uid, r.name, r.total, r.overDays.length]), [[7, "Sari", 4000, 2]]);
    assert.deepEqual(writes, []);
    assert.equal(fr.calls.put.length, 0);
    m.unmount();
  } finally {
    ls.restore();
  }
}));

// ════════════════════════════════════════════════════════════════════════════
// Fase 1 PR 1d-1 — Task 4: tombol "Beban Tim" di toolbar (spec §7.1, R10, K56)
// ════════════════════════════════════════════════════════════════════════════
const loadBtnOf = (tree) => buttonByText(tree, "Beban Tim");

test("T4 Beban Tim: urutan … Jalur kritis · Beban Tim · Baseline · Simpan baseline · Jadwalkan ulang; ikon histogram SVG berkelas tanpa warna; aria-pressed false bawaan; klik → pref load:<page> true + aria-pressed true + is-active; klik lagi → false", () => withEngineClock(async (clock) => {
  const h = await swView(clock);
  const tt = toolbarTexts(h.tree);
  assert.deepEqual(tt.slice(tt.indexOf("Jadwal otomatis"), tt.indexOf("Jadwalkan ulang") + 1), ["Jadwal otomatis", "Jalur kritis", "Beban Tim", "Baseline", "Simpan baseline", "Jadwalkan ulang"]);
  let b = loadBtnOf(h.tree);
  assert.equal(b.props.type, "button");
  assert.equal(b.props["aria-pressed"], false, "K56: bawaan tertutup");
  assert.ok(!hasCls(b, "is-active"));
  // ikon: satu <svg> kecil berkelas plg-timeline-btn-icon, aria-hidden, warna dari CSS (currentColor) — tanpa fill/stroke inline
  const svgs = nodes(b, (n) => n.type === "svg");
  assert.equal(svgs.length, 1);
  assert.ok(hasCls(svgs[0], "plg-timeline-btn-icon"));
  assert.equal(svgs[0].props["aria-hidden"], "true");
  for (const n of nodes(svgs[0], () => true)) {
    assert.equal(n.props.fill, undefined);
    assert.equal(n.props.stroke, undefined);
    assert.equal(n.props.style, undefined);
  }
  assert.match(css, /\.plg-timeline-btn-icon\s*\{[^}]*fill:\s*currentColor/);
  b.props.onClick({});
  await settle();
  assert.deepEqual(h.calls.storageSet.filter((s) => s[0].indexOf("load:") === 0), [["load:proj_Alpha", true]]);
  b = loadBtnOf(h.render());
  assert.equal(b.props["aria-pressed"], true);
  assert.ok(hasCls(b, "is-active"));
  b.props.onClick({});
  await settle();
  assert.deepEqual(h.calls.storageSet.filter((s) => s[0].indexOf("load:") === 0), [["load:proj_Alpha", true], ["load:proj_Alpha", false]]);
  assert.equal(loadBtnOf(h.render()).props["aria-pressed"], false);
  assert.deepEqual(h.writes(), [], "pref saja: 0 tulis task/record");
  h.m.unmount();
}));

test("T4 Beban Tim: aria-pressed mengikuti pref load:<page> tersimpan (true); mesin belum siap → tombol tidak tampil (juga tidak di Lainnya)", () => withEngineClock(async (clock) => {
  {
    const { api } = fakeApi({ storageGet: loadPrefGet("proj_Alpha", true) });
    api.data = { tasks: { list: () => Promise.resolve(chainTasks()) } };
    for (const liveEdit of [false, true]) {
      const m = mount(T.TimelineViewBody);
      const props = { context: ctxOf(chainTasks(), { liveEdit }).ctx, api };
      m.render(props);
      m.flush();
      await settle();
      const tree = m.render(props); // pref terbaca, mesin belum jalan (raf/setTimeout belum)
      assert.equal(loadBtnOf(tree), undefined, "mesin belum siap (liveEdit " + liveEdit + ")");
      const mm = moreOf(tree);
      assert.ok(!mm || mm.props.items.every((it) => it.id !== "load"));
      m.unmount();
    }
  }
  const { m, tree } = await critView(clock, { storageGet: loadPrefGet("proj_Alpha", true) });
  const b = loadBtnOf(tree);
  assert.ok(b, "tampil setelah mesin siap");
  assert.equal(b.props["aria-pressed"], true, "pref tersimpan ON");
  assert.ok(hasCls(b, "is-active"));
  m.unmount();
}));

test("T4 Beban Tim: Live Edit → item menuitemcheckbox 'Beban Tim' di Lainnya setelah Jalur kritis (aria-checked = pref); pilih → pref load:<page> ditulis, menu tertutup", () => withEngineClock(async (clock) => {
  const le = await swView(clock, { ctx: { liveEdit: true } });
  assert.equal(loadBtnOf(le.tree), undefined, "tidak di toolbar saat collapse");
  const mm = moreOf(le.tree);
  const it = mm.props.items.find((x) => x.text === "Beban Tim");
  assert.ok(it);
  assert.equal(it.role, "menuitemcheckbox");
  assert.equal(it.checked, false);
  const texts = mm.props.items.map((x) => x.text);
  assert.equal(texts.indexOf("Beban Tim"), texts.indexOf("Jalur kritis") + 1);
  const mt = mount(T.MoreMenu);
  let t = mt.render(mm.props);
  buttonByText(t, "Lainnya").props.onClick({});
  t = mt.render(mm.props);
  const btn = nodes(t, (n) => n.type === "button" && n.props.role === "menuitemcheckbox" && txt(n).trim() === "Beban Tim")[0];
  assert.ok(btn);
  assert.equal(btn.props["aria-checked"], false);
  btn.props.onClick({});
  t = mt.render(mm.props);
  assert.equal(nodes(t, (n) => n.props.role === "menu").length, 0, "menu tertutup");
  await settle();
  assert.deepEqual(le.calls.storageSet.filter((s) => s[0].indexOf("load:") === 0), [["load:proj_Alpha", true]]);
  const it2 = moreOf(le.render()).props.items.find((x) => x.text === "Beban Tim");
  assert.equal(it2.checked, true, "aria-checked mengikuti pref");
  const t2 = mount(T.MoreMenu);
  let tt = t2.render(moreOf(le.tree).props);
  buttonByText(tt, "Lainnya").props.onClick({});
  tt = t2.render(moreOf(le.tree).props);
  assert.equal(nodes(tt, (n) => n.props.role === "menuitemcheckbox" && txt(n).trim() === "Beban Tim")[0].props["aria-checked"], true);
  mt.unmount();
  t2.unmount();
  assert.deepEqual(le.writes(), []);
  le.m.unmount();
}));

test("T4 Beban Tim: ≤ 640 px → di Lainnya, baik Gantt maupun Daftar (daftar HP R10); Daftar hanya ada ≤ 640 px — pref mode:list di layar lebar tetap Gantt dengan tombol di toolbar", () => withEngineClock(async (clock) => {
  const prevWin = global.window;
  global.window = { matchMedia: (q) => ({ matches: q === "(max-width: 640px)", addEventListener() {}, removeEventListener() {} }), innerHeight: 800, addEventListener() {}, removeEventListener() {} };
  try {
    const n = await swView(clock);
    assert.equal(loadBtnOf(n.tree), undefined);
    const items = () => moreOf(n.tree).props.items;
    assert.deepEqual(items().map((it) => it.text), ["Jadwal otomatis", "Jalur kritis", "Beban Tim", "Baseline", "Simpan baseline", "Jadwalkan ulang", "Ekspor ke Microsoft Project (.xml)"]); // 1d-2 T5
    buttonByText(n.tree, "Daftar").props.onClick({});
    n.render();
    assert.deepEqual(items().map((it) => it.text), ["Jadwal otomatis", "Beban Tim", "Simpan baseline", "Jadwalkan ulang", "Ekspor ke Microsoft Project (.xml)"]);
    const it = items().find((x) => x.text === "Beban Tim");
    assert.equal(it.role, "menuitemcheckbox");
    it.onSelect();
    await settle();
    assert.deepEqual(n.calls.storageSet.filter((s) => s[0].indexOf("load:") === 0), [["load:proj_Alpha", true]]);
    n.render();
    assert.equal(items().find((x) => x.text === "Beban Tim").checked, true);
    n.m.unmount();
  } finally {
    global.window = prevWin;
  }
  // layar lebar: mode:list tersimpan diabaikan (Gantt penuh) → tombol Beban Tim di toolbar
  const fr = fakeRecords();
  putRec(fr, unitRec(null, "Alpha"));
  const { api } = fakeApi({ records: fr, storageGet: (k) => Promise.resolve(k === "mode:proj_Alpha" ? "list" : null) });
  api.data = { tasks: { list: () => Promise.resolve(chainTasks()) } };
  const m = mount(T.TimelineViewBody);
  const props = { context: ctxOf(chainTasks()).ctx, api };
  const tree = await settleView(m, () => props, clock);
  assert.ok(gridOf(tree), "Gantt");
  assert.ok(loadBtnOf(tree));
  m.unmount();
}));

// ════════════════════════════════════════════════════════════════════════════
// Fase 1 PR 1d-1 — Task 5: panel histogram desktop `LoadPanel` (spec §7.2, §1 butir 6; rencana R5, P3 (a))
// ════════════════════════════════════════════════════════════════════════════
// Workspace 12, hari ini Rab 4 Nov 2026. Orang: 7 Sari (pengguna aktif, kapasitas bawaan 8), 9 Budi (record: 2 🍅/hari,
// cuti Sen 9–Sel 10 Nov), 11 Citra (bawaan 8; hanya task tanpa jadwal).
//   1 Desain API  Budi  Rab 4–Jum 6, 12 🍅 → 4/hari > 2 → merah Rab 4, Kam 5, Jum 6
//   2 Uji beban   Budi  Sen 9–Sel 10, 2 🍅 → 1/hari, cuti (kapasitas 0) → merah Sen 9, Sel 10
//   3 Dokumen     Sari  Kam 5–Jum 6, 4 🍅 → 2/hari
//   4 Riset       Citra tanpa jadwal → "belum dijadwalkan"
//   5 Rapat       —     Jum 6, target bawaan 1 → baris "Belum ditugaskan"
//   6 Laporan     Sari  Sen 26–Sel 27 Okt (terlambat), target bawaan 1 → 1 🍅 di T = Rab 4
//   7 Rilis jauh  Budi  Sen 2 Agu 2027, 5 🍅 → merah DI LUAR jendela dw (zoom Minggu)
// counted 5 (1, 2, 3, 5, 6), bertarget bawaan 2 (5, 6) → 2 × 4 > 5 → catatan tampil; belum dijadwalkan 1 (4).
const PANEL_L = { list_id: 12, project: "P0" };
function panelTasks() {
  const L = PANEL_L;
  return [
    mk(1, "Desain API", { start: "2026-11-04", duration: 3 }, Object.assign({ assigned_to: 9, estimated_pomodoros: 12 }, L)),
    mk(2, "Uji beban", { start: "2026-11-09", duration: 2 }, Object.assign({ assigned_to: 9, estimated_pomodoros: 2 }, L)),
    mk(3, "Dokumen", { start: "2026-11-05", duration: 2 }, Object.assign({ assigned_to: 7, estimated_pomodoros: 4 }, L)),
    mk(4, "Riset", {}, Object.assign({ assigned_to: 11, estimated_pomodoros: 3 }, L)),
    mk(5, "Rapat", { start: "2026-11-06", duration: 1 }, L),
    mk(6, "Laporan", { start: "2026-10-26", duration: 2 }, Object.assign({ assigned_to: 7 }, L)),
    mk(7, "Rilis jauh", { start: "2027-08-02", duration: 1 }, Object.assign({ assigned_to: 9, estimated_pomodoros: 5 }, L)),
  ];
}
const PANEL_PEOPLE = {
  currentUser: { id: 7, username: "sari", display_name: "Sari" },
  collaborators: [{ id: 9, username: "budi", display_name: "Budi" }, { id: 11, username: "citra", display_name: "Citra" }],
};
// View panel: pref load:<page> ON (kecuali loadOff), pref lain lewat opt.pref(k); records bawaan: unit P0 otomatis + record Budi.
async function panelView(clock, o) {
  const opt = o || {};
  const tasks = opt.tasks || panelTasks();
  const fr = opt.records || fakeRecords();
  if (!opt.records) {
    putRec(fr, unitRec(12, "P0"));
    putRec(fr, resRec(12, 9, { capacity: 2, leave: [{ from: "2026-11-09", to: "2026-11-10", note: "Cuti" }] }));
  }
  const ctxExtra = Object.assign({ page: "slist_12", pageKind: "workspace", listId: 12, projectName: null }, PANEL_PEOPLE, opt.ctx || {});
  const page = ctxExtra.page;
  const storageGet = (k) => Promise.resolve(k === "load:" + page ? !opt.loadOff : opt.pref ? opt.pref(k) : null);
  const { api, calls } = fakeApi({ records: fr, storageGet });
  api.env.userId = "userId" in opt ? opt.userId : 7; // 1d-1 T7: tanpa pengguna aktif (empty state)
  api.data = { tasks: { list: () => Promise.resolve(opt.listOf ? opt.listOf() : tasks) } };
  const writes = spyWrites(api);
  const { ctx, clicked } = ctxOf(tasks, ctxExtra);
  const props = { context: ctx, api };
  const m = mount(T.TimelineViewBody);
  const h = { m, fr, api, calls, writes, props, clicked, tasks };
  h.tree = await settleView(m, () => props, clock);
  h.render = () => (h.tree = m.render(props));
  h.again = async () => (h.tree = await settleView(m, () => props, clock));
  return h;
}
const panelOf = (tree) => nodes(tree, (n) => n.type === T.LoadPanel)[0];
const panelHead = (pt) => txt(byCls(pt, "plg-timeline-load-head")[0]).trim();
const panelNames = (pt) => byCls(pt, "plg-timeline-load-name").map((n) => [n.type, txt(n).trim()]);
const panelSvgs = (pt) => nodes(pt, (n) => n.type === "svg" && hasCls(n, "plg-timeline-load-svg"));
const panelHits = (pt) => byCls(pt, "plg-timeline-load-hit");
const pathCls = (svg) => nodes(svg, (n) => n.type === "path").map((p) => p.props.className);
const pathD = (svg, c) => (nodes(svg, (n) => n.type === "path" && hasCls(n, c))[0] || { props: {} }).props.d;
const dnOfIso = (s) => T.TLCal.dn(s);

test("T5 loadHeadText: 'Beban Tim · {n} hari kelebihan beban' (n = Σ pasangan orang×hari) + '· {m} task belum dijadwalkan' bila ada + '· {k} task bertarget bawaan 1 🍅' bila k > 25 % counted", () => {
  const rows = [{ uid: 1, overDays: [10, 11] }, { uid: 2, overDays: [10] }, { uid: null, overDays: [] }];
  const L = (o) => Object.assign({ rows, unscheduled: 0, counted: 4, defaultTarget: 1 }, o);
  assert.equal(T.loadHeadText(L()), "Beban Tim · 3 hari kelebihan beban", "1 × 4 = 4 tidak > 4 (tepat 25 %)");
  assert.equal(T.loadHeadText(L({ unscheduled: 2 })), "Beban Tim · 3 hari kelebihan beban · 2 task belum dijadwalkan");
  assert.equal(T.loadHeadText(L({ defaultTarget: 2 })), "Beban Tim · 3 hari kelebihan beban · 2 task bertarget bawaan 1 🍅");
  assert.equal(T.loadHeadText(L({ unscheduled: 1, defaultTarget: 3 })), "Beban Tim · 3 hari kelebihan beban · 1 task belum dijadwalkan · 3 task bertarget bawaan 1 🍅");
  assert.equal(T.loadHeadText(L({ counted: 0, defaultTarget: 0 })), "Beban Tim · 3 hari kelebihan beban");
  assert.equal(T.loadHeadText({ rows: [], unscheduled: 0, counted: 0, defaultTarget: 0 }), "Beban Tim · 0 hari kelebihan beban");
});

test("T5 view: pref load ON + mesin siap → LoadPanel di bawah .plg-timeline-scroll, sebelum legenda; props primitif jendela dw/zoom (sama dengan Gantt) + ref + callback; pref OFF / mesin belum siap → tidak ada", () => withEngineClock(async (clock) => {
  // mesin belum siap: pref ON terbaca, load null → tanpa panel
  {
    const fr = fakeRecords();
    const { api } = fakeApi({ records: fr, storageGet: loadPrefGet("slist_12", true) });
    api.env.userId = 7;
    api.data = { tasks: { list: () => Promise.resolve(panelTasks()) } };
    const m = mount(T.TimelineViewBody);
    const props = { context: ctxOf(panelTasks(), Object.assign({ page: "slist_12", pageKind: "workspace", listId: 12, projectName: null }, PANEL_PEOPLE)).ctx, api };
    m.render(props);
    m.flush();
    await settle();
    assert.equal(panelOf(m.render(props)), undefined, "sebelum mesin siap");
    m.unmount();
  }
  const off = await panelView(clock, { loadOff: true });
  assert.equal(panelOf(off.tree), undefined, "pref OFF");
  off.m.unmount();
  const h = await panelView(clock);
  const root = h.tree;
  assert.ok(hasCls(root, "plg-timeline"));
  const kids = root.children.filter((c) => c && typeof c === "object");
  const iGrid = kids.findIndex((c) => hasCls(c, "plg-timeline-scroll"));
  const iPanel = kids.findIndex((c) => c.type === T.LoadPanel);
  const iFoot = kids.findIndex((c) => hasCls(c, "plg-timeline-foot"));
  assert.ok(iGrid >= 0 && iPanel === iGrid + 1 && iFoot === iPanel + 1, "urutan: grafik · panel · legenda (" + [iGrid, iPanel, iFoot] + ")");
  const p = panelOf(root).props;
  const lay = T.TLLayout.layout({ tasks: h.tasks, pageKind: "workspace", cal: T.TLCal.DEFAULT_CAL, today: TODAY, zoom: "week", readSchedOf: (t) => T.TLSched.readSched(h.api.taskExt.read(t)) });
  const dw = T.TLLayout.windowDays(lay.range, lay.px, T.TLLayout.initialScrollLeft(lay.range, lay.px, TODAY, 1000), 1000);
  assert.deepEqual([p.rangeFrom, p.px, p.fromDn, p.toDn, p.tableW, p.viewW, p.pageKind], [lay.range.from, lay.px, dw.fromDn, dw.toDn, TABLE_W_FULL, 1000, "workspace"]);
  assert.ok(p.load && Array.isArray(p.load.rows));
  assert.equal(p.cal && typeof p.cal.mask.has, "function", "kalender terkompilasi mesin (eng.ctx.cal)");
  for (const k of ["trackRef", "boxRef"]) assert.ok(p[k] && "current" in p[k], k);
  for (const k of ["getLeft", "onEditPerson"]) assert.equal(typeof p[k], "function", k);
  assert.equal(p.getLeft(), 0, "tanpa wadah terpasang → 0");
  // memo: render ulang view tanpa perubahan → props LoadPanel identik (React.memo melewati render panel)
  const p2 = panelOf(h.render()).props;
  for (const k of Object.keys(p)) assert.ok(Object.is(p[k], p2[k]), "prop stabil: " + k);
  assert.match(jsx, /React\.memo\(LoadPanel\)/);
  assert.deepEqual(h.writes, []);
  assert.equal(h.fr.calls.put.length, 0);
  h.m.unmount();
}));

test("T5 view: ≤ 640 px (Gantt dan Daftar) → panel desktop tidak dirender (daftar HP = T8); Live Edit lebar → dirender", () => withEngineClock(async (clock) => {
  const prevWin = global.window;
  global.window = { matchMedia: (q) => ({ matches: q === "(max-width: 640px)", addEventListener() {}, removeEventListener() {} }), innerHeight: 800, addEventListener() {}, removeEventListener() {} };
  try {
    const h = await panelView(clock);
    assert.ok(gridOf(h.tree), "Gantt HP");
    assert.equal(panelOf(h.tree), undefined, "Gantt ≤ 640 px");
    buttonByText(h.tree, "Daftar").props.onClick({});
    assert.equal(panelOf(h.render()), undefined, "Daftar");
    h.m.unmount();
  } finally {
    global.window = prevWin;
  }
  const le = await panelView(clock, { ctx: { liveEdit: true } });
  assert.ok(panelOf(le.tree), "Live Edit lebar: Gantt + panel");
  assert.equal(panelOf(le.tree).props.tableW, 48 + 160, "kolom kiri = lebar tabel ringkas");
  le.m.unmount();
}));

test("T5 LoadPanel: judul persis (+ belum dijadwalkan + bertarget bawaan), kolom kiri '{nama} · {cap} 🍅/hari' (tombol → onEditPerson(uid)), 'Belum ditugaskan' bukan tombol; tanpa catatan P3 di workspace", () => withEngineClock(async (clock) => {
  const h = await panelView(clock);
  const node = panelOf(h.tree);
  const edits = [];
  const props = Object.assign({}, node.props, { onEditPerson: (u) => edits.push(u) });
  const pm = mount(T.LoadPanel);
  const pt = pm.render(props);
  const sec = nodes(pt, (n) => n.type === "section")[0];
  assert.ok(sec && hasCls(sec, "plg-timeline-load"), "akar section.plg-timeline-load");
  assert.equal(sec.props["aria-label"], "Beban Tim");
  assert.equal(sec.props.ref, node.props.boxRef, "ref akar = boxRef view (ukur tinggi)");
  const head = byCls(pt, "plg-timeline-load-head")[0];
  assert.equal(head.type, "h3");
  assert.equal(panelHead(pt), "Beban Tim · 6 hari kelebihan beban · 1 task belum dijadwalkan · 2 task bertarget bawaan 1 🍅");
  assert.equal(byCls(pt, "plg-timeline-load-note").length, 0, "workspace tanpa catatan (P3 a)");
  assert.deepEqual(panelNames(pt), [["button", "Budi · 2 🍅/hari"], ["button", "Citra · 8 🍅/hari"], ["button", "Sari · 8 🍅/hari"], ["div", "Belum ditugaskan"]]);
  const names = byCls(pt, "plg-timeline-load-name");
  names[0].props.onClick({});
  names[2].props.onClick({});
  assert.deepEqual(edits, [9, 7]);
  assert.equal(names[3].props.onClick, undefined);
  // halaman view: onEditPerson = penyetel state (T7) — memanggilnya merender ulang view tanpa tulis
  const n0 = h.m.setCalls.length;
  node.props.onEditPerson(9);
  assert.equal(h.m.setCalls.length, n0 + 1);
  pm.unmount();
  assert.deepEqual(h.writes, []);
  assert.equal(h.fr.calls.put.length, 0);
  h.m.unmount();
}));

test("T5 LoadPanel project pribadi: satu baris pengguna aktif + catatan persis 'Hanya beban dari project ini' (P3 a)", () => withEngineClock(async (clock) => {
  const al = { project: "Alpha" };
  const tasks = [
    mk(1, "A", { start: "2026-11-04", duration: 2 }, Object.assign({ estimated_pomodoros: 20 }, al)),
    mk(2, "B", {}, al),
  ];
  const fr = fakeRecords();
  putRec(fr, resRec(null, 7, { capacity: 6, leave: [] }));
  const h = await panelView(clock, { tasks, records: fr, ctx: { page: "proj_Alpha", pageKind: "project", listId: null, projectName: "Alpha" } });
  const pt = child(panelOf(h.tree));
  assert.equal(panelOf(h.tree).props.pageKind, "project");
  assert.equal(panelHead(pt), "Beban Tim · 2 hari kelebihan beban · 1 task belum dijadwalkan", "A 20 🍅 / 2 hari > 6; B tanpa jadwal (tidak berbeban → bukan bertarget bawaan)");
  const note = byCls(pt, "plg-timeline-load-note");
  assert.equal(note.length, 1);
  assert.equal(txt(note[0]).trim(), "Hanya beban dari project ini");
  assert.deepEqual(panelNames(pt), [["button", "Sari · 6 🍅/hari"]]);
  h.m.unmount();
}));

test("T5 LoadPanel grafik (R5): satu <svg> per baris di xOf(dw.fromDn) selebar jendela, tinggi 28; path berkelas tanpa warna inline (satu per kelas); geometri batang/kelebihan/kapasitas; baris Belum ditugaskan tanpa kapasitas/merah/cuti", () => withEngineClock(async (clock) => {
  const h = await panelView(clock);
  const p = panelOf(h.tree).props;
  const pt = child(panelOf(h.tree));
  const svgs = panelSvgs(pt);
  assert.equal(svgs.length, 4, "satu svg per baris");
  const W = (p.toDn - p.fromDn + 1) * p.px;
  svgs.forEach((s, i) => {
    assert.equal(s.props.width, W);
    assert.equal(s.props.height, 28);
    assert.equal(s.props["aria-hidden"], "true");
    assert.deepEqual(s.props.style, { left: (p.fromDn - p.rangeFrom) * p.px, top: i * 28 });
    for (const n of nodes(s, (x) => x.type === "path")) {
      assert.equal(n.props.fill, undefined);
      assert.equal(n.props.stroke, undefined);
      assert.equal(n.props.style, undefined);
      assert.ok(typeof n.props.d === "string" && n.props.d.length > 0, "path tanpa d kosong");
    }
    const cls = pathCls(s);
    assert.equal(new Set(cls).size, cls.length, "satu path per kelas");
  });
  assert.deepEqual(pathCls(svgs[0]), ["plg-timeline-load-off", "plg-timeline-load-cap", "plg-timeline-load-bar", "plg-timeline-load-over", "plg-timeline-load-leave"], "Budi: semua lapis");
  assert.deepEqual(pathCls(svgs[1]), ["plg-timeline-load-off", "plg-timeline-load-cap"], "Citra: tanpa beban di jendela");
  assert.deepEqual(pathCls(svgs[2]), ["plg-timeline-load-off", "plg-timeline-load-cap", "plg-timeline-load-bar"], "Sari: tanpa merah/cuti");
  assert.deepEqual(pathCls(svgs[3]), ["plg-timeline-load-off", "plg-timeline-load-bar"], "Belum ditugaskan: tanpa kapasitas/merah/cuti");
  // geometri Budi Rab 4 Nov: skala baris (review T4–T6 I4: seluruh hasil, bukan jendela) = maks(kapasitas 2, beban maks
  // 5 🍅 Rilis jauh Agu 2027) = 5 🍅 → 25 px (28 − 3); kapasitas 2 → 10 px; batang = bagian ≤ kapasitas (10), kelebihan =
  // 2 🍅 di atasnya (y 8..18); zoom Minggu 12 px, inset 1 → lebar 10.
  const xd = (iso) => (dnOfIso(iso) - p.fromDn) * p.px;
  assert.ok(pathD(svgs[0], "plg-timeline-load-bar").includes("M" + (xd("2026-11-04") + 1) + " 18h10v10h-10Z"), "batang Rab 4");
  assert.ok(pathD(svgs[0], "plg-timeline-load-over").includes("M" + (xd("2026-11-04") + 1) + " 8h10v10h-10Z"), "kelebihan Rab 4");
  // cuti Sen 9 (kapasitas 0): beban 1 seluruhnya merah, tanpa batang biasa; skala 5 → 5 px
  assert.ok(pathD(svgs[0], "plg-timeline-load-over").includes("M" + (xd("2026-11-09") + 1) + " 23h10v5h-10Z"), "kelebihan Sen 9 (cuti)");
  assert.ok(!pathD(svgs[0], "plg-timeline-load-bar").includes("M" + (xd("2026-11-09") + 1) + " "), "tanpa batang biasa di hari cuti");
  // kapasitas Budi: area 10 px digabung per rentang hari kerja berkapasitas sama (Sen 2–Jum 6 satu persegi)
  assert.ok(pathD(svgs[0], "plg-timeline-load-cap").includes("M" + xd("2026-11-02") + " 18h60v10h-60Z"), "kapasitas Sen 2–Jum 6");
  // hari non-kerja: Sab 7–Min 8 satu persegi setinggi baris
  assert.ok(pathD(svgs[0], "plg-timeline-load-off").includes("M" + xd("2026-11-07") + " 0h24v28h-24Z"), "Sab–Min");
  // arsir cuti hanya di Sen 9–Sel 10 (x dalam [Sen 9, Rab 11))
  const xs = pathD(svgs[0], "plg-timeline-load-leave").match(/[ML](-?[\d.]+) /g).map((s) => Number(s.slice(1)));
  assert.ok(xs.length >= 4 && xs.every((x) => x >= xd("2026-11-09") - 1e-9 && x <= xd("2026-11-11") + 1e-9), "arsir dalam rentang cuti");
  // Sari: skala 8 (kapasitas) → beban 2 🍅 = 6.25 → 6.3 px pada Kam 5
  assert.ok(pathD(svgs[2], "plg-timeline-load-bar").includes("M" + (xd("2026-11-05") + 1) + " 21.8h10v6.3h-10Z"), "Sari Kam 5");
  h.m.unmount();
}));

test("T5 LoadPanel tombol hari merah: hanya overDays di jendela dw (Rilis jauh Agu 2027 di luar → tanpa tombol), di atas hari itu, aria-label = teks tooltip persis", () => withEngineClock(async (clock) => {
  const h = await panelView(clock);
  const p = panelOf(h.tree).props;
  const budi = p.load.rows.find((r) => r.uid === 9);
  assert.deepEqual(budi.overDays.map(T.TLCal.iso), ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10", "2027-08-02"]);
  assert.ok(dnOfIso("2027-08-02") > p.toDn, "di luar jendela");
  const pt = child(panelOf(h.tree));
  const hits = panelHits(pt);
  assert.deepEqual(hits.map((b) => b.props["aria-label"]), [
    "Budi · Rab 4 Nov: 4 dari 2 🍅 (~1.5 jam)",
    "Budi · Kam 5 Nov: 4 dari 2 🍅 (~1.5 jam)",
    "Budi · Jum 6 Nov: 4 dari 2 🍅 (~1.5 jam)",
    "Budi · Sen 9 Nov: 1 dari 0 🍅 (~0.5 jam)",
    "Budi · Sel 10 Nov: 1 dari 0 🍅 (~0.5 jam)",
  ]);
  hits.forEach((b, k) => {
    assert.equal(b.type, "button");
    assert.equal(b.props.type, "button");
    assert.equal(b.props["aria-haspopup"], "dialog");
    const dn = budi.overDays[k];
    assert.deepEqual(b.props.style, { left: (dn - p.rangeFrom) * p.px, top: 0, width: p.px });
    assert.equal(typeof b.props.onClick, "function");
  });
  h.m.unmount();
}));

test("T5 LoadPanel readout: satu elemen .plg-timeline-load-tip aria-hidden saat pointer di atas grafik; teks persis (hari biasa/merah/libur/Belum ditugaskan, '(~x jam)' sekali); setState hanya bila (baris, hari) berubah; pointerleave → hilang", () => withEngineClock(async (clock) => {
  const h = await panelView(clock);
  const node = panelOf(h.tree);
  const p = node.props;
  const pm = mount(T.LoadPanel);
  let pt = pm.render(p);
  pm.flush();
  const view = byCls(pt, "plg-timeline-load-view")[0];
  assert.ok(view, "wadah grafik");
  assert.equal(byCls(pt, "plg-timeline-load-tip").length, 0, "tanpa readout sebelum hover");
  view.props.ref.current = { getBoundingClientRect: () => ({ left: 100, top: 50, width: 1000, height: 112 }) };
  const at = (iso, i, dx) => ({ clientX: 100 + (dnOfIso(iso) - p.rangeFrom) * p.px + (dx || 1) - p.getLeft(), clientY: 50 + i * 28 + 5 });
  const tipText = () => {
    pt = pm.render(p);
    const tips = byCls(pt, "plg-timeline-load-tip");
    assert.ok(tips.length <= 1, "satu elemen readout per panel");
    if (!tips.length) return null;
    assert.equal(tips[0].props["aria-hidden"], "true");
    return txt(tips[0]).trim();
  };
  const cases = [
    ["2026-11-04", 0, "Budi · Rab 4 Nov: 4 dari 2 🍅 (~1.5 jam)"],
    ["2026-11-09", 0, "Budi · Sen 9 Nov: 1 dari 0 🍅 (~0.5 jam)"],
    ["2026-11-04", 2, "Sari · Rab 4 Nov: 1 dari 8 🍅 (~0.5 jam)"],
    ["2026-11-05", 2, "Sari · Kam 5 Nov: 2 dari 8 🍅 (~1 jam)"],
    ["2026-11-07", 2, "Sari · Sab 7 Nov: 0 dari 0 🍅 (~0 jam)"],
    ["2026-11-05", 1, "Citra · Kam 5 Nov: 0 dari 8 🍅 (~0 jam)"],
    ["2026-11-06", 3, "Belum ditugaskan · Jum 6 Nov: 1 🍅 (~0.5 jam)"],
  ];
  for (const [iso, i, want] of cases) {
    view.props.onPointerMove(at(iso, i));
    const got = tipText();
    assert.equal(got, want);
    assert.equal((got.match(/~/g) || []).length, 1, "satu '~'");
    assert.equal((got.match(/jam/g) || []).length, 1, "satu 'jam'");
  }
  // gerak di dalam sel yang sama → tanpa setState; sel lain → tepat satu
  const n0 = pm.setCalls.length;
  view.props.onPointerMove(at("2026-11-06", 3, 2));
  view.props.onPointerMove(at("2026-11-06", 3, 5));
  assert.equal(pm.setCalls.length, n0, "sel sama → 0 setState");
  view.props.onPointerMove(at("2026-11-05", 3));
  assert.equal(pm.setCalls.length, n0 + 1);
  assert.equal(tipText(), "Belum ditugaskan · Kam 5 Nov: 0 🍅 (~0 jam)");
  // di bawah baris terakhir → hilang; pointerleave → hilang
  view.props.onPointerMove({ clientX: at("2026-11-05", 0).clientX, clientY: 50 + 4 * 28 + 3 });
  assert.equal(tipText(), null);
  view.props.onPointerMove(at("2026-11-05", 0));
  assert.ok(tipText());
  view.props.onPointerLeave({});
  assert.equal(tipText(), null);
  pm.unmount();
  assert.deepEqual(h.writes, [], "hover: 0 tulis");
  assert.equal(h.fr.calls.put.length, 0);
  h.m.unmount();
}));

test("T5 gulir (R5): onScroll wadah Gantt menyetel translateX isi grafik panel LANGSUNG lewat ref — tanpa setState view dalam kuantum yang sama, props LoadPanel tetap identik (memo); render panel menyetel transform dari getLeft (useLayoutEffect); kuantum baru → jendela dw baru", () => withEngineClock(async (clock) => {
  const h = await panelView(clock);
  const el = fakeEl();
  let tree = attach(h.m, h.props, h.tree, el);
  await settle();
  clock.frames();
  tree = h.m.render(h.props);
  const node = panelOf(tree);
  const track = { style: {} };
  node.props.trackRef.current = track;
  assert.equal(node.props.getLeft(), el.scrollLeft);
  const n0 = h.m.setCalls.length;
  const q = 500; // quantLeft: ½ lebar grafik tampak (1000)
  const base = Math.floor(el.scrollLeft / q) * q;
  const nextLeft = base + (el.scrollLeft - base === 7 ? 9 : 7);
  el.scrollLeft = nextLeft;
  gridOf(tree).props.onScroll();
  assert.equal(track.style.transform, "translateX(-" + nextLeft + "px)", "disetel di handler gulir, sebelum frame");
  clock.frames();
  assert.equal(h.m.setCalls.length, n0, "kuantum sama → view tidak dirender ulang");
  const p2 = panelOf(h.m.render(h.props)).props;
  for (const k of Object.keys(node.props)) assert.ok(Object.is(node.props[k], p2[k]), "prop stabil: " + k);
  // panel dirender (dw/zoom berubah) → transform dari getLeft() saat itu
  const pm = mount(T.LoadPanel);
  const track2 = { style: {} };
  const pt = pm.render(p2);
  nodes(pt, (n) => hasCls(n, "plg-timeline-load-track"))[0].props.ref.current = track2;
  pm.flush();
  assert.equal(track2.style.transform, "translateX(-" + nextLeft + "px)");
  pm.unmount();
  node.props.trackRef.current = track; // elemen isi grafik view kembali
  // kuantum berikutnya → setVp → jendela dw baru (fromDn berubah) → panel menerima jendela baru
  el.scrollLeft = base + 3 * q + 1;
  gridOf(tree).props.onScroll();
  assert.equal(track.style.transform, "translateX(-" + (base + 3 * q + 1) + "px)");
  clock.frames();
  assert.equal(h.m.setCalls.length, n0 + 1);
  const p3 = panelOf(h.m.render(h.props)).props;
  assert.notEqual(p3.fromDn, p2.fromDn);
  assert.deepEqual(h.writes, []);
  h.m.unmount();
}));

test("T5 tinggi: baris 28 px, maks 10 baris terlihat (body maxHeight 280, overflow-y di CSS), kolom kiri dan grafik setinggi semua baris dalam satu wadah gulir; tinggi panel dikurangkan dari wadah Gantt (legenda + panel tetap terlihat)", () => withEngineClock(async (clock) => {
  const L = PANEL_L;
  const tasks = [];
  for (let u = 1; u <= 12; u++) tasks.push(mk(u, "T" + u, { start: "2026-11-04", duration: 1 }, Object.assign({ assigned_to: 100 + u, estimated_pomodoros: 2 }, L)));
  const h = await panelView(clock, { tasks });
  const pt = child(panelOf(h.tree));
  const body = byCls(pt, "plg-timeline-load-body")[0];
  assert.equal(body.props.style.maxHeight, 280);
  const rowsN = panelOf(h.tree).props.load.rows.length;
  assert.equal(rowsN, 14, "12 penanggung jawab + pengguna aktif + pemilik record (Budi)");
  assert.equal(byCls(pt, "plg-timeline-load-names")[0].props.style.height, rowsN * 28);
  assert.equal(byCls(pt, "plg-timeline-load-view")[0].props.style.height, rowsN * 28);
  assert.equal(byCls(pt, "plg-timeline-load-names")[0].props.style.width, TABLE_W_FULL);
  assert.match(css, /\.plg-timeline-load-body\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.plg-timeline-load-view\s*\{[^}]*overflow:\s*hidden;\s*overflow:\s*clip;/, "review T4–T6 I2: clip (bukan wadah gulir), hidden cadangan");
  h.m.unmount();
  // ukur: boxH = maks(360, innerHeight − top − 16 − legenda − panel)
  const prevWin = global.window;
  global.window = { innerHeight: 1200, addEventListener() {}, removeEventListener() {} };
  try {
    const v = await panelView(clock, { loadOff: true });
    const el = fakeEl();
    let tree = attach(v.m, v.props, v.tree, el);
    assert.equal(gridOf(tree).props.style.height, 1200 - 100 - 16, "panel tertutup");
    loadBtnOf(tree).props.onClick({});
    tree = v.m.render(v.props);
    v.m.flush(); // review akhir: panel menunggu kapasitas termuat (records.list) — tanpa kilatan kapasitas bawaan
    await settle();
    tree = v.m.render(v.props);
    panelOf(tree).props.boxRef.current = { offsetHeight: 300 };
    tree = attach(v.m, v.props, tree, el);
    assert.equal(gridOf(tree).props.style.height, 1200 - 100 - 16 - 300, "panel terbuka: tingginya dikurangkan");
    v.m.unmount();
  } finally {
    global.window = prevWin;
  }
}));

// 10 orang dengan hampir semua hari kerja merah (40 task 99 🍅 per orang) — kasus terburuk tombol hari merah.
function heavyLoad(zoom) {
  const tasks = [];
  const people = [];
  let id = 1;
  for (let u = 1; u <= 10; u++) {
    people.push({ uid: u, name: "Orang " + u, res: u % 3 === 0 ? { capacity: 4, leave: [{ from: dnOfIso("2026-11-09"), to: dnOfIso("2026-11-20"), note: "" }] } : null });
    for (let w = 0; w < 40; w++) {
      tasks.push(mk(id++, "Berat " + u + "." + w, { start: T.TLCal.iso(dnOfIso("2026-08-03") + 7 * w), duration: 5 }, { assigned_to: u, estimated_pomodoros: 99, list_id: 12, project: "P0" }));
    }
  }
  const api = fakeApi().api;
  const cal = T.TLCal.compile(T.TLCal.DEFAULT_CAL);
  const ctx = { tasks, cal, units: new Map(), readExt: (t) => api.taskExt.read(t) };
  const result = T.TLCpm.run(ctx);
  const load = T.TLLoad.run({ tasks, cal, readExt: ctx.readExt, result, units: ctx.units, people, byAssignee: true, ownerUid: 1, D: dnOfIso(TODAY) });
  const lay = T.TLLayout.layout({ tasks, pageKind: "workspace", cal: T.TLCal.DEFAULT_CAL, today: TODAY, zoom, readSchedOf: (t) => T.TLSched.readSched(api.taskExt.read(t)) });
  const sl = T.TLLayout.initialScrollLeft(lay.range, lay.px, TODAY, 1000);
  const dw = T.TLLayout.windowDays(lay.range, lay.px, sl, 1000);
  return {
    load, ctx, result, lay, dw,
    props: {
      load, cal, result, ctx, rangeFrom: lay.range.from, px: lay.px, fromDn: dw.fromDn, toDn: dw.toDn, tableW: TABLE_W_FULL, viewW: 1000,
      pageKind: "workspace", trackRef: { current: null }, boxRef: { current: null }, getLeft: () => sl, onEditPerson() {}, onReveal() {},
    },
  };
}

test("T5 anggaran DOM: 10 orang × zoom Hari/Minggu/Bulan → elemen panel ≤ 300; tombol merah dibatasi LOAD_HIT_MAX (prioritas dekat tengah jendela, urut baris lalu hari)", () => {
  assert.equal(T.LOAD_HIT_MAX, 150);
  for (const zoom of ["day", "week", "month"]) {
    const x = heavyLoad(zoom);
    const pm = mount(T.LoadPanel);
    const pt = pm.render(x.props);
    pm.flush();
    const n = domCount(pt);
    const inWin = x.load.rows.reduce((s, r) => s + r.overDays.filter((d) => d >= x.dw.fromDn && d <= x.dw.toDn).length, 0);
    const hits = panelHits(pt);
    assert.ok(inWin > T.LOAD_HIT_MAX, zoom + ": kasus terburuk (" + inWin + " hari merah di jendela)");
    assert.equal(hits.length, T.LOAD_HIT_MAX);
    assert.ok(n <= 300, zoom + ": " + n + " elemen");
    assert.equal(panelSvgs(pt).length, 10);
    // prioritas: jarak ke tengah jendela tidak melebihi hari merah mana pun yang tidak mendapat tombol
    const mid = (x.dw.fromDn + x.dw.toDn) / 2;
    const got = new Set(hits.map((b) => b.props.style.top / 28 + ":" + (b.props.style.left / x.lay.px + x.lay.range.from)));
    const far = Math.max(...hits.map((b) => Math.abs(b.props.style.left / x.lay.px + x.lay.range.from - mid)));
    for (const [i, r] of x.load.rows.entries()) {
      for (const d of r.overDays) if (d >= x.dw.fromDn && d <= x.dw.toDn && !got.has(i + ":" + d)) assert.ok(Math.abs(d - mid) >= far, "tanpa tombol hanya yang lebih jauh dari tengah");
    }
    const order = hits.map((b) => [b.props.style.top, b.props.style.left]);
    const sorted = order.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    assert.deepEqual(order, sorted, "urutan DOM (tab) = baris lalu hari");
    console.log("# DOM panel Beban Tim 10 orang (" + zoom + "): " + n + " elemen, " + hits.length + "/" + inWin + " tombol merah");
    pm.unmount();
  }
});

test("T5 DOM total 500 task/400 dep + Jalur kritis + panel Beban Tim (10 orang) ≤ 1.500 elemen; 0 tulis", () => withEngineClock(async (clock) => {
  const tasks = bigTasks(500, 400).map((t, i) => Object.assign(t, { list_id: 12, assigned_to: 1 + (i % 10) }));
  const fr = fakeRecords();
  for (let k = 0; k < 5; k++) putRec(fr, unitRec(12, "P" + k));
  const { api } = fakeApi({ records: fr, storageGet: (k) => Promise.resolve(k === "crit:slist_12" || k === "load:slist_12" ? true : null) });
  api.env.userId = 1;
  api.data = { tasks: { list: () => Promise.resolve(tasks) } };
  const writes = spyWrites(api);
  const { ctx } = ctxOf(tasks, { page: "slist_12", pageKind: "workspace", listId: 12, projectName: null });
  const props = { context: ctx, api };
  const m = mount(T.TimelineViewBody);
  const tree = await settleView(m, () => props, clock);
  assert.equal(buttonByText(tree, "Jalur kritis").props["aria-pressed"], true);
  assert.equal(loadBtnOf(tree).props["aria-pressed"], true);
  const node = panelOf(tree);
  assert.ok(node, "panel terbuka");
  assert.equal(node.props.load.rows.filter((r) => r.uid !== null).length, 10);
  const pm = mount(T.LoadPanel);
  const pt = pm.render(node.props);
  pm.flush();
  const nView = domCount(tree);
  const nPanel = domCount(pt);
  assert.ok(nPanel <= 300, "panel: " + nPanel);
  assert.ok(nView + nPanel <= 1500, "total: " + (nView + nPanel));
  console.log("# DOM elemen 500 task/400 dep + Jalur kritis + Beban Tim: view " + nView + " + panel " + nPanel + " = " + (nView + nPanel));
  for (const n of nodes(pt, (x) => typeof x.props.className === "string")) {
    for (const c of n.props.className.split(/\s+/).filter(Boolean)) assert.match(c, /^(plg-timeline(-[\w-]+)?|is-[\w-]+)$/, c);
  }
  pm.unmount();
  assert.deepEqual(writes, []);
  assert.equal(fr.calls.put.length + fr.calls.remove.length, 0);
  m.unmount();
}));

test("T5 CSS panel: kelas .plg-timeline-load-* hanya token tema (kapasitas --bg-subtle, beban --accent, kelebihan --plg-timeline-danger, cuti --text-secondary + opacity, non-kerja abu --text-secondary 12 % — review T4–T6 I3), tanpa border-left aksen, :focus-visible untuk nama/tombol merah", () => {
  const rule = (sel) => {
    const m = css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}"));
    assert.ok(m, "aturan " + sel);
    return m[1];
  };
  assert.match(rule(".plg-timeline-load-cap"), /fill:\s*var\(--bg-subtle\)/);
  assert.match(rule(".plg-timeline-load-bar"), /fill:\s*var\(--accent\)/);
  assert.match(rule(".plg-timeline-load-over"), /fill:\s*var\(--plg-timeline-danger\)/);
  const lv = rule(".plg-timeline-load-leave");
  assert.match(lv, /stroke:\s*var\(--text-secondary\)/);
  assert.match(lv, /(stroke-)?opacity:\s*0?\.\d+/);
  assert.match(rule(".plg-timeline-load-off"), /fill:\s*color-mix\(in srgb, var\(--text-secondary\) 12%, transparent\)/);
  assert.doesNotMatch(rule(".plg-timeline-load-off"), /danger/, "hari non-kerja tidak ditint merah");
  assert.match(css, /\.plg-timeline-load-name:focus-visible[^{]*\{[^}]*outline:\s*2px solid var\(--accent\)/);
  assert.match(css, /\.plg-timeline-load-hit:focus-visible[^{]*\{[^}]*outline:\s*2px solid var\(--accent\)/);
  const block = css.slice(css.indexOf("1d-1: Beban Tim"));
  assert.ok(block.length > 100);
  assert.doesNotMatch(block, /border-left\s*:/, "tanpa border-left aksen");
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
});

// ════════════════════════════════════════════════════════════════════════════
// Fase 1 PR 1d-1 — Task 6: popover saran (spec §7.4, K50, R6) + revealRow (R7)
// ════════════════════════════════════════════════════════════════════════════
// Workspace 12, unit P0 dan P1 Otomatis. Budi (9) kapasitas 2; Rab 4 Nov = 12 🍅 → merah, kontributor semua jenis R6:
//   Ikon 3 🍅 slack 9 (free) · Warna 1 🍅 slack 8 (free) · Fondasi 1 🍅 (kritis, jalur terpanjang P0) · Pin 1 🍅 (mode
//   manual eksplisit di unit Otomatis) · Berjalan 2 🍅 (progress 30) · Tunggakan 4 🍅 (selesai Sen 26 Okt → terlambat, di T).
// Citra (11) Rab 4 Nov: Besar 20 🍅 sendirian di P1 → kritis saja (tanpa free).
// Sepuluh task isi selesai (dibuat lebih dulu) mendorong baris task P0 ke indeks 11–16 agar scrollTop > 0; Tanpa jadwal
// (id 8) = baris tanpa rentang.
function sugTasks() {
  const L0 = { list_id: 12, project: "P0" };
  const L1 = { list_id: 12, project: "P1" };
  const fill = [];
  for (let k = 0; k < 10; k++) {
    fill.push(mk(60 + k, "Isi " + k, { start: "2026-10-01", duration: 1 }, Object.assign({ gtd_status: "done", completed_at: "2026-10-01T03:00:00Z", created_at: "2026-09-01T00:00:0" + k + "Z" }, L0)));
  }
  return fill.concat([
    mk(1, "Fondasi", { start: "2026-11-04", duration: 10 }, Object.assign({ assigned_to: 9, estimated_pomodoros: 10 }, L0)),
    mk(2, "Ikon", { start: "2026-11-04", duration: 1 }, Object.assign({ assigned_to: 9, estimated_pomodoros: 3 }, L0)),
    mk(3, "Warna", { start: "2026-11-04", duration: 2 }, Object.assign({ assigned_to: 9, estimated_pomodoros: 2 }, L0)),
    mk(4, "Pin", { start: "2026-11-04", duration: 1, mode: "manual" }, Object.assign({ assigned_to: 9, estimated_pomodoros: 1 }, L0)),
    mk(5, "Berjalan", { start: "2026-11-04", duration: 1 }, Object.assign({ assigned_to: 9, estimated_pomodoros: 2, progress: 30 }, L0)),
    mk(6, "Tunggakan", { start: "2026-10-26", duration: 1 }, Object.assign({ assigned_to: 9, estimated_pomodoros: 4 }, L0)),
    mk(7, "Besar", { start: "2026-11-04", duration: 1 }, Object.assign({ assigned_to: 11, estimated_pomodoros: 20 }, L1)),
    mk(8, "Tanpa jadwal", {}, Object.assign({ assigned_to: 9 }, L0)),
  ]);
}
function sugRecords() {
  const fr = fakeRecords();
  putRec(fr, unitRec(12, "P0"));
  putRec(fr, unitRec(12, "P1"));
  putRec(fr, resRec(12, 9, { capacity: 2, leave: [] }));
  return fr;
}
const sugOf = (pt) => nodes(pt, (n) => n.type === T.SuggestPopover)[0];
const sugRows = (spt) => byCls(spt, "plg-timeline-load-sug-btn").map((b) => {
  const k = byCls(b, "plg-timeline-load-sug-kind")[0];
  return [txt(byCls(b, "plg-timeline-load-sug-text")[0]).trim(), k ? txt(k).trim() : null];
});
const hitOf = (pt, label) => panelHits(pt).find((b) => b.props["aria-label"].indexOf(label) === 0);
// Panel view (props asli dari view, termasuk onReveal) dipasang sendiri; tombol pemicu palsu mencatat fokus.
function sugPanel(h) {
  const node = panelOf(h.tree);
  const pm = mount(T.LoadPanel);
  const ph = { node, pm, props: node.props, tree: pm.render(node.props) };
  ph.render = () => (ph.tree = pm.render(ph.props));
  ph.open = (label) => {
    const btn = { focused: 0, focus() { this.focused++; } };
    hitOf(ph.tree, label).props.onClick({ currentTarget: btn });
    ph.render();
    return btn;
  };
  return ph;
}

test("T6 popover saran: klik tombol hari merah → dialog 'Bisa digeser — {nama}, {tgl}'; baris persis free '{judul} · {n} 🍅 hari ini · slack {s} hk', lainnya + label 'Kritis'/'Manual'/'Sudah mulai'/'terlambat'; urutan = TLLoad.suggest; 0 tulis", () => withEngineClock(async (clock) => {
  const h = await panelView(clock, { tasks: sugTasks(), records: sugRecords() });
  const ph = sugPanel(h);
  assert.equal(sugOf(ph.tree), undefined, "tertutup bawaan");
  assert.deepEqual(panelHits(ph.tree).map((b) => b.props["aria-label"]), [
    "Budi · Rab 4 Nov: 12 dari 2 🍅 (~5 jam)",
    "Citra · Rab 4 Nov: 20 dari 8 🍅 (~8.5 jam)",
  ]);
  ph.open("Budi · Rab 4 Nov");
  const sp = sugOf(ph.tree);
  assert.ok(sp, "popover terbuka");
  assert.equal(sp.props.title, "Bisa digeser — Budi, Rab 4 Nov");
  const p = ph.props;
  const want = T.TLLoad.suggest(p.load, 9, dnOfIso("2026-11-04"), { result: p.result, units: p.ctx.units, readExt: p.ctx.readExt, tasks: p.ctx.tasks });
  assert.deepEqual(sp.props.items.map((s) => [s.key, s.kind]), want.map((s) => [s.key, s.kind]), "urutan = suggest");
  assert.deepEqual(want.map((s) => s.kind), ["free", "free", "critical", "manual", "started", "late"]);
  const spt = child(sp);
  const dlg = nodes(spt, (n) => n.props.role === "dialog")[0];
  assert.ok(dlg && hasCls(dlg, "plg-timeline-pop") && hasCls(dlg, "plg-timeline-load-pop"));
  assert.equal(dlg.props["aria-label"], "Bisa digeser — Budi, Rab 4 Nov");
  assert.equal(dlg.props.tabIndex, -1);
  assert.equal(txt(nodes(spt, (n) => n.type === "h3")[0]).trim(), "Bisa digeser — Budi, Rab 4 Nov");
  assert.deepEqual(sugRows(spt), [
    ["Ikon · 3 🍅 hari ini · slack 9 hk", null],
    ["Warna · 1 🍅 hari ini · slack 8 hk", null],
    ["Fondasi · 1 🍅 hari ini", "Kritis"],
    ["Pin · 1 🍅 hari ini", "Manual"],
    ["Berjalan · 2 🍅 hari ini", "Sudah mulai"],
    ["Tunggakan · 4 🍅 hari ini", "terlambat"],
  ]);
  for (const b of byCls(spt, "plg-timeline-load-sug-btn")) assert.equal(b.props.type, "button");
  assert.equal(byCls(spt, "plg-timeline-pop-note").length, 0, "ada free → tanpa pesan kosong");
  assert.equal(typeof dlg.props.style.left, "number");
  assert.deepEqual(h.writes, []);
  assert.equal(h.fr.calls.put.length + h.fr.calls.remove.length, 0);
  ph.pm.unmount();
  h.m.unmount();
}));

test("T6 popover tanpa free → paragraf persis 'Tidak ada task yang bisa digeser tanpa menggeser jalur kritis' di atas daftar sisanya", () => withEngineClock(async (clock) => {
  const h = await panelView(clock, { tasks: sugTasks(), records: sugRecords() });
  const ph = sugPanel(h);
  ph.open("Citra · Rab 4 Nov");
  const sp = sugOf(ph.tree);
  assert.equal(sp.props.title, "Bisa digeser — Citra, Rab 4 Nov");
  const spt = child(sp);
  const dlg = nodes(spt, (n) => n.props.role === "dialog")[0];
  const note = byCls(spt, "plg-timeline-pop-note");
  assert.equal(note.length, 1);
  assert.equal(txt(note[0]).trim(), "Tidak ada task yang bisa digeser tanpa menggeser jalur kritis");
  assert.deepEqual(sugRows(spt), [["Besar · 20 🍅 hari ini", "Kritis"]]);
  const kids = dlg.children.filter((c) => c && typeof c === "object");
  assert.ok(kids.indexOf(note[0]) < kids.findIndex((c) => hasCls(c, "plg-timeline-load-sug")), "pesan di atas daftar");
  ph.pm.unmount();
  h.m.unmount();
}));

test("T6 SuggestPopover: fokus ke dialog saat dibuka; Esc (fase tangkap, propagasi dihentikan) → tutup + fokus kembali; klik luar → tutup tanpa fokus; tombol hari merah lain tidak menutup; Tutup → fokus kembali; pendengar dilepas", () => withPop(async (w) => {
  const closes = [];
  const props = { title: "Bisa digeser — Budi, Rab 4 Nov", items: [], left: 40, onPick() {}, onClose: (a) => closes.push(a) };
  const m = mount(T.SuggestPopover);
  const tree = m.render(props);
  const rootEl = { focused: 0, focus() { this.focused++; }, contains: (t) => t === rootEl };
  nodes(tree, (n) => n.props.role === "dialog")[0].props.ref.current = rootEl;
  m.flush();
  assert.equal(rootEl.focused, 1);
  assert.equal(txt(byCls(tree, "plg-timeline-pop-note")[0]).trim(), "Tidak ada task yang bisa digeser tanpa menggeser jalur kritis", "daftar kosong");
  let stopped = 0;
  w.fire("keydown", { key: "Escape", preventDefault() {}, stopPropagation() { stopped++; } });
  assert.deepEqual(closes, [{ restoreFocus: true }]);
  assert.equal(stopped, 1);
  w.fire("pointerdown", { target: { closest: (sel) => (sel === ".plg-timeline-load-hit" ? {} : null) } });
  assert.equal(closes.length, 1, "tombol hari merah lain ditangani tombolnya (ganti hari)");
  w.fire("pointerdown", { target: rootEl });
  assert.equal(closes.length, 1, "klik di dalam");
  w.fire("pointerdown", { target: { closest: () => null } });
  assert.deepEqual(closes[1], { restoreFocus: false });
  nodes(tree, (n) => n.type === "button" && n.props["aria-label"] === "Tutup")[0].props.onClick({});
  assert.deepEqual(closes[2], { restoreFocus: true });
  m.unmount();
  assert.equal(w.ls.filter((l) => l.type === "keydown" || l.type === "pointerdown").length, 0);
}));

test("T6 LoadPanel: onClose restoreFocus → popover tertutup + fokus kembali ke tombol hari merah pemicu; klik luar tanpa fokus; klik pemicu yang sama lagi → tertutup (toggle); tombol hari lain → ganti hari", () => withEngineClock(async (clock) => {
  const h = await panelView(clock, { tasks: sugTasks(), records: sugRecords() });
  const ph = sugPanel(h);
  const btn = ph.open("Budi · Rab 4 Nov");
  sugOf(ph.tree).props.onClose({ restoreFocus: true });
  ph.render();
  assert.equal(sugOf(ph.tree), undefined);
  assert.equal(btn.focused, 1, "fokus kembali ke pemicu");
  const b2 = ph.open("Budi · Rab 4 Nov");
  sugOf(ph.tree).props.onClose({ restoreFocus: false });
  ph.render();
  assert.equal(sugOf(ph.tree), undefined);
  assert.equal(b2.focused, 0);
  ph.open("Budi · Rab 4 Nov");
  ph.open("Budi · Rab 4 Nov");
  assert.equal(sugOf(ph.tree), undefined, "pemicu sama → tutup");
  ph.open("Budi · Rab 4 Nov");
  ph.open("Citra · Rab 4 Nov");
  assert.equal(sugOf(ph.tree).props.title, "Bisa digeser — Citra, Rab 4 Nov", "hari lain → ganti isi");
  ph.pm.unmount();
  assert.deepEqual(h.writes, []);
  h.m.unmount();
}));

test("T6 revealRow (R7): klik baris saran → popover tertutup; scrollTop = indeks × rowH − tinggi viewport/3, scrollLeft = xOf(Mulai bar) − lebar viewport/3; bar + baris is-flash 1,5 dtk (jam palsu); panel ikut bergeser; tanpa rentang → hanya scrollTop; unmount membersihkan timer; 0 tulis", () => withEngineClock(async (clock) => {
  const h = await panelView(clock, { tasks: sugTasks(), records: sugRecords() });
  const el = fakeEl();
  h.tree = attach(h.m, h.props, h.tree, el);
  await settle();
  clock.frames();
  h.render();
  const ph = sugPanel(h);
  const track = { style: {} };
  ph.props.trackRef.current = track;
  assert.equal(typeof ph.props.onReveal, "function");
  ph.open("Budi · Rab 4 Nov");
  const ikon = sugOf(ph.tree).props.items.find((s) => s.key === "2");
  sugOf(ph.tree).props.onPick(ikon);
  ph.render();
  assert.equal(sugOf(ph.tree), undefined, "popover ditutup");
  h.render();
  const i = rowOf(h.tree, "2").props["aria-rowindex"] - 2;
  assert.equal(i, 12, "baris Ikon setelah kelompok + 10 isi + Fondasi");
  assert.equal(el.scrollTop, Math.round(i * 32 - 600 / 3), "baris di sepertiga atas");
  const wantLeft = Math.round((dnOfIso("2026-11-04") - ph.props.rangeFrom) * ph.props.px - 1000 / 3);
  assert.equal(el.scrollLeft, Math.max(0, wantLeft), "awal bar di sepertiga kiri");
  assert.equal(track.style.transform, "translateX(-" + el.scrollLeft + "px)", "panel mengikuti");
  const flashed = () => nodes(h.tree, (n) => hasCls(n, "is-flash")).map((n) => [n.props.role, n.props["data-key"]]);
  assert.deepEqual(flashed(), [["row", "2"], ["button", "2"]], "baris tabel + bar");
  assert.ok(hasCls(barOf(h.tree, "2"), "plg-timeline-bar"));
  clock.tick(1499);
  h.render();
  assert.equal(flashed().length, 2, "masih berkedip sebelum 1,5 dtk");
  clock.tick(1);
  h.render();
  assert.deepEqual(flashed(), [], "hilang setelah 1,5 dtk");
  // tanpa rentang: hanya scrollTop
  const left0 = el.scrollLeft;
  const t8 = h.tasks.find((t) => t.id === 8);
  ph.props.onReveal("8", t8);
  h.render();
  const i8 = rowOf(h.tree, "8").props["aria-rowindex"] - 2;
  assert.equal(el.scrollTop, Math.max(0, Math.round(i8 * 32 - 200)));
  assert.equal(el.scrollLeft, left0, "tanpa rentang → scrollLeft tetap");
  assert.deepEqual(flashed(), [["row", "8"]], "baris tanpa bar tetap berkedip");
  // unmount sebelum 1,5 dtk → timer dibersihkan (tanpa setState sesudahnya)
  const n0 = h.m.setCalls.length;
  h.m.unmount();
  clock.tick(5000);
  assert.equal(h.m.setCalls.length, n0, "timer dibersihkan saat unmount");
  assert.deepEqual(h.clicked, [], "baris ada di Gantt → tidak membuka detail");
  assert.deepEqual(h.writes, [], "revealRow tanpa tulisan");
  assert.equal(h.fr.calls.put.length + h.fr.calls.remove.length, 0);
  ph.pm.unmount();
}));

test("T6 revealRow: task tersaring filter panel (ada di daftar lengkap, tidak di lay.rows) → context.onTaskClick(task) membuka detail, tanpa gulir/kedip; 0 tulis", () => withEngineClock(async (clock) => {
  const all = sugTasks();
  const shown = all.filter((t) => t.id !== 2); // filter panel menyembunyikan Ikon
  const h = await panelView(clock, { tasks: shown, listOf: () => all, records: sugRecords() });
  const el = fakeEl();
  h.tree = attach(h.m, h.props, h.tree, el);
  await settle();
  clock.frames();
  h.render();
  assert.equal(rowOf(h.tree, "2"), undefined, "Ikon tidak di Gantt");
  const ph = sugPanel(h);
  ph.open("Budi · Rab 4 Nov");
  const sp = sugOf(ph.tree);
  assert.ok(sp.props.items.some((s) => s.key === "2"), "beban task tersaring tetap terhitung (R2)");
  const top0 = el.scrollTop;
  const left0 = el.scrollLeft;
  sp.props.onPick(sp.props.items.find((s) => s.key === "2"));
  ph.render();
  assert.equal(sugOf(ph.tree), undefined);
  assert.deepEqual(h.clicked.map((t) => [t.id, t.title]), [[2, "Ikon"]]);
  assert.deepEqual([el.scrollTop, el.scrollLeft], [top0, left0]);
  h.render();
  assert.equal(nodes(h.tree, (n) => hasCls(n, "is-flash")).length, 0);
  assert.deepEqual(h.writes, []);
  assert.equal(h.fr.calls.put.length + h.fr.calls.remove.length, 0);
  ph.pm.unmount();
  h.m.unmount();
}));

test("T6 CSS: kedip is-flash memakai var(--accent) (animasi singkat), prefers-reduced-motion tanpa animasi; popover saran membuka ke atas panel", () => {
  assert.match(css, /@keyframes plg-timeline-flash[^{]*\{[^@]*var\(--accent\)/);
  assert.match(css, /\.plg-timeline-row\.is-flash[^{]*\{[^}]*animation:\s*plg-timeline-flash/);
  assert.match(css, /\.plg-timeline-bar\.is-flash/);
  const rm = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.ok(rm.length > 0 && /is-flash[^{]*\{[^}]*animation:\s*none/.test(rm), "reduced motion");
  assert.match(css, /\.plg-timeline-load-pop\s*\{[^}]*bottom:\s*100%/);
});

// ════════════════════════════════════════════════════════════════════════════
// Fase 1 PR 1d-1 — Task 7: editor kapasitas/cuti (spec K55, §7.3, Q4 (a); rencana R9) + perbaikan minor review T2–T3
// ════════════════════════════════════════════════════════════════════════════
const edOf = (tree) => nodes(tree, (n) => n.type === T.ResourceEditor)[0];
const dlgNode = (tree) => nodes(tree, (n) => n.props.role === "dialog")[0];
const inputsOf = (tree, type) => nodes(tree, (n) => n.type === "input" && n.props.type === type);
const notesOf = (tree) => nodes(tree, (n) => n.type === "input" && n.props["aria-label"] === "Catatan cuti");
const btnsByLabel = (tree, label) => nodes(tree, (n) => n.type === "button" && n.props["aria-label"] === label);
const hasText = (tree, s) => nodes(tree, (n) => typeof n.type === "string" && txt(n).trim() === s).length > 0;
const chg = (value) => ({ target: { value } });
const RES_WAIT = "Menunggu data workspace…";
const RES_CAP_BAD = "Kapasitas 0–40 🍅/hari";
const RES_DATE_BAD = "Periksa tanggal cuti";
const RES_STALE = "Data berubah sejak dialog dibuka — muat ulang";
const capIn = (tree) => inputsOf(tree, "number")[0];
const saveBtn = (tree) => buttonByText(tree, "Simpan");
const dateVals = (tree) => inputsOf(tree, "date").map((i) => i.props.value);
const mapOf = (fr, scope) => T.resourceStore({ records: fr.api, env: { userId: 7 } }).loadScope(scope || "list:12");

// Editor dipasang sendiri. res = bundel view {map, loaded, pulled, store, pageKind, listId, currentUser, collaborators,
// userId, api}; bawaan: workspace 12, termuat + pulled, peta kosong (record absen), pengguna aktif Sari (7).
function edSetup(o) {
  const opt = o || {};
  const fr = opt.records || fakeRecords();
  const { api, calls } = fakeApi({ records: fr });
  api.env.userId = 7;
  const store = T.resourceStore(api);
  const closes = [];
  const res = Object.assign({
    map: new Map(), loaded: true, pulled: true, store, pageKind: "workspace", listId: 12,
    currentUser: { id: 7, username: "sari", display_name: "Sari" }, collaborators: [{ id: 9, username: "budi", display_name: "Budi" }],
    userId: 7, api,
  }, opt.res || {});
  const m = mount(T.ResourceEditor);
  // rootH (review akhir): tinggi editor terukur (offsetHeight) untuk logika buka ke bawah; anchorRef = akar panel desktop
  const rootEl = { focused: 0, offsetHeight: opt.rootH || 0, focus() { this.focused++; }, contains: (t) => t === rootEl };
  const h = { m, fr, api, calls, store, closes, rootEl };
  h.props = { uid: opt.uid || 9, name: opt.name || "Budi", res, onClose: (a) => closes.push(a === undefined ? null : a) };
  if (opt.anchorRef) h.props.anchorRef = opt.anchorRef;
  h.render = () => {
    h.tree = m.render(h.props);
    const d = dlgNode(h.tree);
    if (d && d.props.ref) d.props.ref.current = rootEl;
    return h.tree;
  };
  h.flush = () => { m.flush(); return h.render(); };
  h.set = (patch) => { h.props = Object.assign({}, h.props, { res: Object.assign({}, h.props.res, patch) }); return h.render(); };
  h.render();
  h.flush();
  return h;
}

test("T7 minor review T2–T3: resRecId menolak uid/listId bukan bilangan bulat aman (1e21, 2^53) — uid lewat TLLoad.uidOf, listId Number.isSafeInteger; batas aman tetap sah", () => {
  for (const [k, lid, uid] of [["workspace", 12, 1e21], ["workspace", 1e21, 7], ["project", null, 1e21], ["workspace", 2 ** 53, 7], ["workspace", 12, 2 ** 53], ["project", null, "7"]]) {
    assert.throws(() => T.resRecId(k, lid, uid), blCode("INVALID"), JSON.stringify([k, lid, uid]));
  }
  const big = 2 ** 53 - 1;
  assert.deepEqual(T.resRecId("workspace", big, big), { id: "res@list:" + big + ":" + big, scope: "list:" + big });
  assert.match(jsx, /TLLoad\.uidOf\(uid\) !== uid/);
  assert.match(jsx, /Number\.isSafeInteger\(listId\) && listId > 0/);
});

test("T7 minor review T2–T3: halaman pribadi tanpa pengguna aktif (ownerUid null, people kosong) → panel judul tanpa baris, tanpa lempar, 0 tulis", () => withEngineClock(async (clock) => {
  const al = { project: "Alpha" };
  const tasks = [mk(1, "A", { start: "2026-11-04", duration: 2 }, Object.assign({ estimated_pomodoros: 20 }, al)), mk(2, "B", {}, al)];
  const h = await panelView(clock, { tasks, records: fakeRecords(), userId: undefined, ctx: { page: "proj_Alpha", pageKind: "project", listId: null, projectName: "Alpha", currentUser: null } });
  const node = panelOf(h.tree);
  assert.ok(node, "panel tetap tampil");
  assert.deepEqual(node.props.load.rows, [], "tanpa baris (bukan 'Belum ditugaskan')");
  const pt = child(node);
  assert.equal(panelHead(pt), "Beban Tim · 0 hari kelebihan beban · 1 task belum dijadwalkan");
  assert.deepEqual(panelNames(pt), []);
  assert.equal(panelSvgs(pt).length, 0);
  assert.deepEqual(h.writes, []);
  assert.equal(h.fr.calls.put.length, 0);
  h.m.unmount();
}));

test("T7 ResourceEditor isi (§7.3): dialog 'Kapasitas Budi' (kelas pop + res-pop, fokus saat dibuka); 'Kapasitas' + input number 0–40 step 1 numeric + '🍅/hari' + petunjuk persis; 'Cuti' + baris record (ISO, dua tanggal, catatan, '×' 'Hapus cuti'); 'Tambah cuti' menambah baris kosong, nonaktif di 50; hapus baris; Simpan/Batal; record absen → 8 tanpa cuti", () => withPop(async () => {
  const fr = fakeRecords();
  putRec(fr, resRec(12, 9, { capacity: 2, leave: [{ from: "2026-12-24", to: "2026-12-24", note: "" }, { from: "2026-11-09", to: "2026-11-10", note: "Cuti" }] }));
  const h = edSetup({ records: fr, res: { map: await mapOf(fr) } });
  const d = dlgNode(h.tree);
  assert.ok(hasCls(d, "plg-timeline-pop") && hasCls(d, "plg-timeline-res-pop"));
  assert.equal(d.props["aria-label"], "Kapasitas Budi");
  assert.equal(d.props.tabIndex, -1);
  assert.equal(h.rootEl.focused, 1, "fokus ke dialog saat dibuka");
  assert.equal(txt(nodes(h.tree, (n) => n.type === "h3")[0]).trim(), "Kapasitas Budi");
  const cap = capIn(h.tree);
  assert.deepEqual([cap.props.type, cap.props.min, cap.props.max, cap.props.step, cap.props.inputMode, cap.props.value, cap.props.disabled], ["number", 0, 40, 1, "numeric", "2", false]);
  const lab = nodes(h.tree, (n) => n.type === "label" && nodes(n, (x) => x === cap).length > 0)[0];
  assert.ok(lab, "input kapasitas di dalam <label>");
  assert.ok(hasText(lab, "Kapasitas") && hasText(lab, "🍅/hari"), "label 'Kapasitas' + sufiks '🍅/hari'");
  assert.ok(hasText(h.tree, "8 🍅 ≈ 3 jam 20 menit fokus"));
  const sec = nodes(h.tree, (n) => n.type === "section" && n.props["aria-label"] === "Cuti")[0];
  assert.ok(sec && hasText(sec, "Cuti"));
  assert.deepEqual(dateVals(h.tree), ["2026-11-09", "2026-11-10", "2026-12-24", "2026-12-24"], "cuti sebagai ISO, urut");
  assert.deepEqual(notesOf(h.tree).map((i) => i.props.value), ["Cuti", ""]);
  assert.deepEqual(inputsOf(h.tree, "date").map((i) => i.props["aria-label"]), ["Dari tanggal", "Sampai tanggal", "Dari tanggal", "Sampai tanggal"]);
  const dels = btnsByLabel(h.tree, "Hapus cuti");
  assert.equal(dels.length, 2);
  assert.ok(dels.every((b) => txt(b).trim() === "×" && b.props.type === "button"));
  assert.ok(saveBtn(h.tree) && buttonByText(h.tree, "Batal"));
  assert.equal(saveBtn(h.tree).props.disabled, false);
  // tambah → baris kosong di akhir; hapus baris pertama
  buttonByText(h.tree, "Tambah cuti").props.onClick({});
  h.render();
  assert.deepEqual(dateVals(h.tree), ["2026-11-09", "2026-11-10", "2026-12-24", "2026-12-24", "", ""]);
  btnsByLabel(h.tree, "Hapus cuti")[0].props.onClick({});
  h.render();
  assert.deepEqual(dateVals(h.tree), ["2026-12-24", "2026-12-24", "", ""]);
  // 50 baris → Tambah cuti nonaktif
  for (let i = 0; i < 60; i++) {
    const add = buttonByText(h.tree, "Tambah cuti");
    if (!add.props.disabled) add.props.onClick({});
    h.render();
  }
  assert.equal(btnsByLabel(h.tree, "Hapus cuti").length, 50);
  assert.equal(buttonByText(h.tree, "Tambah cuti").props.disabled, true);
  assert.equal(h.fr.calls.put.length, 0);
  h.m.unmount();
  // record absen → kapasitas bawaan 8 tanpa cuti, tanpa keterangan "Diubah oleh"
  const a = edSetup();
  assert.equal(capIn(a.tree).props.value, "8");
  assert.equal(inputsOf(a.tree, "date").length, 0);
  assert.equal(nodes(a.tree, (n) => typeof n.type === "string" && /^Diubah oleh/.test(txt(n).trim())).length, 0);
  a.m.unmount();
}));

test("T7 Batal / Esc / klik luar / Tutup → onClose tanpa tulis (0 records.get/put); klik di dalam atau tombol nama/chip pemicu tidak menutup; pendengar dilepas", () => withPop(async (w) => {
  const h = edSetup();
  capIn(h.tree).props.onChange(chg("5"));
  h.render();
  buttonByText(h.tree, "Batal").props.onClick({});
  let stopped = 0;
  w.fire("keydown", { key: "Escape", preventDefault() {}, stopPropagation() { stopped++; } });
  w.fire("pointerdown", { target: h.rootEl });
  w.fire("pointerdown", { target: { closest: (sel) => (sel.indexOf(".plg-timeline-load-name") >= 0 ? {} : null) } });
  w.fire("pointerdown", { target: { closest: (sel) => (sel.indexOf(".plg-timeline-load-m-person") >= 0 ? {} : null) } });
  w.fire("pointerdown", { target: { closest: () => null } });
  btnsByLabel(h.tree, "Tutup")[0].props.onClick({});
  assert.deepEqual(h.closes, [{ restoreFocus: true }, { restoreFocus: true }, { restoreFocus: false }, { restoreFocus: true }]);
  assert.equal(stopped, 1, "Esc: propagasi dihentikan (modal/Live Edit host tidak ikut tertutup)");
  assert.equal(h.fr.calls.put.length + h.fr.calls.get.length + h.fr.calls.remove.length, 0);
  h.m.unmount();
  assert.equal(w.ls.filter((l) => l.type === "keydown" || l.type === "pointerdown").length, 0);
}));

test("T7 Simpan → tepat 1 records.put ter-normalisasi (cuti digabung, by = userId) + {scope}; toast persis 'Kapasitas Budi disimpan'; ditutup (fokus kembali); klik Simpan dua kali cepat → 1 put; pribadi → res@user scope user", () => withPop(async () => {
  const h = edSetup();
  capIn(h.tree).props.onChange(chg("5"));
  h.render();
  buttonByText(h.tree, "Tambah cuti").props.onClick({});
  h.render();
  buttonByText(h.tree, "Tambah cuti").props.onClick({});
  h.render();
  const set = (i, which, v) => { inputsOf(h.tree, "date")[i * 2 + which].props.onChange(chg(v)); h.render(); };
  set(0, 0, "2026-11-10");
  set(0, 1, "2026-11-12");
  set(1, 0, "2026-11-09");
  set(1, 1, "2026-11-09");
  notesOf(h.tree)[1].props.onChange(chg("Mudik"));
  h.render();
  assert.equal(saveBtn(h.tree).props.disabled, false);
  saveBtn(h.tree).props.onClick({});
  h.render();
  assert.equal(saveBtn(h.tree).props.disabled, true, "nonaktif selama menyimpan");
  saveBtn(h.tree).props.onClick({}); // klik ganda
  await settle();
  await settle();
  assert.deepEqual(resPuts(h.fr), [["resource", "res@list:12:9", { v: 1, capacity: 5, leave: [{ from: "2026-11-09", to: "2026-11-12", note: "Mudik" }], by: 7 }, { scope: "list:12" }]]);
  assert.equal(h.fr.calls.get.length, 1, "satu baca CAS");
  assert.deepEqual(h.calls.toast, [["Kapasitas Budi disimpan", "success"]]);
  assert.deepEqual(h.closes, [{ restoreFocus: true }]);
  h.m.unmount();
  // halaman project pribadi: res@user:<uid> scope user (Q4 a: tanpa batas siapa yang mengedit — di sini diri sendiri)
  const p = edSetup({ uid: 7, name: "Sari", res: { pageKind: "project", listId: null, pulled: true } });
  capIn(p.tree).props.onChange(chg("0"));
  p.render();
  saveBtn(p.tree).props.onClick({});
  await settle();
  await settle();
  assert.deepEqual(resPuts(p.fr), [["resource", "res@user:7", { v: 1, capacity: 0, leave: [], by: 7 }, { scope: "user" }]]);
  assert.deepEqual(p.calls.toast, [["Kapasitas Sari disimpan", "success"]]);
  p.m.unmount();
}));

test("T7 validasi inline: kapasitas bukan bilangan bulat 0–40 → Simpan nonaktif + 'Kapasitas 0–40 🍅/hari' (aria-invalid); tanggal cuti kosong/tidak sah/di luar 1970–2199 atau dari > sampai → 'Periksa tanggal cuti'; diperbaiki → aktif; klik saat tidak sah → 0 put", () => withPop(async () => {
  const h = edSetup();
  for (const [v, ok] of [["", false], ["41", false], ["2.5", false], ["-1", false], ["1e1", false], ["abc", false], ["0", true], ["40", true], ["08", true], ["7", true]]) {
    capIn(h.tree).props.onChange(chg(v));
    h.render();
    assert.equal(saveBtn(h.tree).props.disabled, !ok, "Simpan: " + JSON.stringify(v));
    assert.deepEqual(alerts(h.tree), ok ? [] : [RES_CAP_BAD], "pesan: " + JSON.stringify(v));
    assert.equal(capIn(h.tree).props["aria-invalid"], !ok);
    if (!ok) saveBtn(h.tree).props.onClick({});
  }
  buttonByText(h.tree, "Tambah cuti").props.onClick({});
  h.render();
  // review T7–T8 (Important): baris baru kosong total netral — bukan galat, Simpan tetap aktif
  assert.equal(saveBtn(h.tree).props.disabled, false, "baris baru kosong");
  assert.deepEqual(alerts(h.tree), []);
  const dates = () => inputsOf(h.tree, "date");
  for (const [from, to, ok] of [["2026-11-10", "", false], ["2026-11-10", "2026-11-09", false], ["2026-02-30", "2026-03-01", false], ["1969-12-31", "1970-01-02", false], ["2026-11-10", "2200-01-01", false], ["2026-11-10", "2026-11-10", true], ["1970-01-01", "2199-12-31", true]]) {
    dates()[0].props.onChange(chg(from));
    h.render();
    dates()[1].props.onChange(chg(to));
    h.render();
    assert.equal(saveBtn(h.tree).props.disabled, !ok, from + ".." + to);
    assert.deepEqual(alerts(h.tree), ok ? [] : [RES_DATE_BAD], from + ".." + to);
    assert.equal(dates()[0].props["aria-invalid"], !ok);
    if (!ok) saveBtn(h.tree).props.onClick({});
  }
  // keduanya tidak sah → dua pesan
  capIn(h.tree).props.onChange(chg("99"));
  h.render();
  dates()[1].props.onChange(chg(""));
  h.render();
  assert.deepEqual(alerts(h.tree), [RES_CAP_BAD, RES_DATE_BAD]);
  saveBtn(h.tree).props.onClick({});
  await settle();
  assert.equal(h.fr.calls.put.length + h.fr.calls.get.length, 0, "tidak sah → tanpa baca/tulis");
  h.m.unmount();
}));

test("T7 kunci Simpan (R9, review T2–T3): workspace (a) belum termuat → terkunci + 'Menunggu data workspace…'; (c) termuat + record ada → terbuka tanpa pulled; pribadi: belum termuat → terkunci TANPA teks, termuat → terbuka (pulled tidak berpengaruh)", () => withPop(async () => {
  const fr = fakeRecords();
  putRec(fr, resRec(12, 9, { capacity: 3 }));
  const map = await mapOf(fr);
  const locked = (t) => saveBtn(t).props.disabled === true && capIn(t).props.disabled === true && buttonByText(t, "Tambah cuti").props.disabled === true;
  // (a)
  const a = edSetup({ records: fr, res: { map: new Map(), loaded: false, pulled: true } });
  assert.ok(locked(a.tree), "(a) terkunci (pulled menyala sebelum muat tidak cukup)");
  assert.ok(hasText(a.tree, RES_WAIT));
  assert.equal(buttonByText(a.tree, "Batal").props.disabled, false, "Batal tetap aktif (nonaktif hanya selama menyimpan — review T7–T8)");
  a.m.unmount();
  // (c)
  const c = edSetup({ records: fr, res: { map, loaded: true, pulled: false } });
  assert.ok(!locked(c.tree), "(c) record lokal ada → terbuka tanpa pulled");
  assert.equal(saveBtn(c.tree).props.disabled, false);
  assert.ok(!hasText(c.tree, RES_WAIT));
  c.m.unmount();
  // pribadi
  const p = edSetup({ uid: 7, name: "Sari", res: { pageKind: "project", listId: null, map: new Map(), loaded: false, pulled: false } });
  assert.ok(locked(p.tree), "pribadi belum termuat → terkunci");
  assert.ok(!hasText(p.tree, RES_WAIT), "tanpa teks");
  p.set({ loaded: true });
  p.flush();
  assert.ok(!locked(p.tree), "pribadi termuat → terbuka walau pulled false");
  assert.ok(!hasText(p.tree, RES_WAIT));
  p.m.unmount();
}));

test("T7 kunci (b): termuat + tanpa record + belum pulled → terkunci + teks; pulled → terbuka (record tetap absen → potret absen, Simpan → 1 put)", () => withPop(async () => {
  const h = edSetup({ res: { map: new Map(), loaded: true, pulled: false } });
  assert.equal(saveBtn(h.tree).props.disabled, true);
  assert.equal(capIn(h.tree).props.disabled, true);
  assert.ok(hasText(h.tree, RES_WAIT));
  saveBtn(h.tree).props.onClick({});
  await settle();
  assert.equal(h.fr.calls.put.length, 0, "terkunci → tanpa tulis");
  h.set({ pulled: true });
  h.flush();
  assert.equal(saveBtn(h.tree).props.disabled, false);
  assert.ok(!hasText(h.tree, RES_WAIT));
  capIn(h.tree).props.onChange(chg("6"));
  h.render();
  saveBtn(h.tree).props.onClick({});
  await settle();
  await settle();
  assert.equal(resPuts(h.fr).length, 1);
  assert.equal(resPuts(h.fr)[0][2].capacity, 6);
  h.m.unmount();
}));

test("T7 dibuka sebelum termuat → nilai + potret DIPERBARUI saat data termuat (selama belum diubah); render pertama sesudah buka kunci tetap nonaktif sampai potret baru; Simpan memakai potret record terbaru (CAS lolos, 1 put)", () => withPop(async () => {
  const fr = fakeRecords();
  putRec(fr, resRec(12, 9, { capacity: 6, leave: [{ from: "2026-11-09", to: "2026-11-10", note: "Cuti" }] }));
  const h = edSetup({ records: fr, res: { map: new Map(), loaded: false, pulled: false } });
  assert.equal(capIn(h.tree).props.value, "8", "sebelum termuat: bawaan");
  assert.equal(saveBtn(h.tree).props.disabled, true);
  // data termuat: render sebelum efek → masih nonaktif (potret lama tidak pernah bisa dipakai)
  h.set({ map: await mapOf(fr), loaded: true });
  assert.equal(saveBtn(h.tree).props.disabled, true, "sebelum potret diperbarui");
  h.flush();
  assert.equal(capIn(h.tree).props.value, "6");
  assert.deepEqual(dateVals(h.tree), ["2026-11-09", "2026-11-10"]);
  assert.equal(saveBtn(h.tree).props.disabled, false);
  assert.ok(hasText(h.tree, "Diubah oleh Budi · Kam 5 Nov"), "keterangan ikut record yang termuat");
  capIn(h.tree).props.onChange(chg("3"));
  h.render();
  saveBtn(h.tree).props.onClick({});
  await settle();
  await settle();
  assert.equal(resPuts(h.fr).length, 1, "CAS lolos: potret = record terbaru (bukan potret absen saat dibuka)");
  assert.deepEqual(resPuts(h.fr)[0][2], { v: 1, capacity: 3, leave: [{ from: "2026-11-09", to: "2026-11-10", note: "Cuti" }], by: 7 });
  h.m.unmount();
  // sudah terbuka + belum diubah: perubahan data sesudahnya TIDAK mengganti potret (potret = saat dibuka) → CAS menolak
  const fr2 = fakeRecords();
  putRec(fr2, resRec(12, 9, { capacity: 6 }));
  const g = edSetup({ records: fr2, res: { map: await mapOf(fr2) } });
  putRec(fr2, resRec(12, 9, { capacity: 4 }, { updated_at: "2026-11-06T00:00:00Z" }));
  g.set({ map: await mapOf(fr2) });
  g.flush();
  assert.equal(capIn(g.tree).props.value, "6", "potret saat dibuka dipertahankan");
  saveBtn(g.tree).props.onClick({});
  await settle();
  await settle();
  g.render();
  assert.equal(resPuts(g.fr).length, 0);
  assert.ok(alerts(g.tree).indexOf(RES_STALE) >= 0);
  g.m.unmount();
}));

test("T7 STALE (CAS, Review Focus 4): record berubah sejak dialog dibuka → 0 put + teks persis + 'Muat ulang' (Simpan nonaktif); Muat ulang mengisi nilai + potret terbaru dari records.get (membuang ketikan) → Simpan → 1 put", () => withPop(async () => {
  const fr = fakeRecords();
  putRec(fr, resRec(12, 9, { capacity: 6, leave: [] }));
  const h = edSetup({ records: fr, res: { map: await mapOf(fr) } });
  capIn(h.tree).props.onChange(chg("3"));
  h.render();
  // anggota lain menyimpan (sinkron) — peta panel BELUM dimuat ulang
  putRec(fr, resRec(12, 9, { capacity: 4, leave: [{ from: "2026-12-01", to: "2026-12-02", note: "Dinas" }], by: 9 }, { updated_at: "2026-11-06T03:00:00Z" }));
  saveBtn(h.tree).props.onClick({});
  await settle();
  await settle();
  h.render();
  assert.equal(resPuts(fr).length, 0, "STALE → 0 put");
  assert.ok(alerts(h.tree).indexOf(RES_STALE) >= 0, "teks persis");
  assert.equal(saveBtn(h.tree).props.disabled, true, "Simpan nonaktif sampai dimuat ulang");
  assert.deepEqual(h.closes, [], "dialog tetap terbuka");
  assert.deepEqual(h.calls.toast, []);
  const reload = buttonByText(h.tree, "Muat ulang");
  assert.ok(reload && reload.props.type === "button");
  reload.props.onClick({});
  await settle();
  await settle();
  h.render();
  assert.equal(capIn(h.tree).props.value, "4", "ketikan dibuang, nilai terbaru");
  assert.deepEqual(dateVals(h.tree), ["2026-12-01", "2026-12-02"]);
  assert.deepEqual(notesOf(h.tree).map((i) => i.props.value), ["Dinas"]);
  assert.ok(alerts(h.tree).indexOf(RES_STALE) < 0);
  assert.ok(hasText(h.tree, "Diubah oleh Budi · Jum 6 Nov"));
  assert.equal(saveBtn(h.tree).props.disabled, false);
  capIn(h.tree).props.onChange(chg("5"));
  h.render();
  saveBtn(h.tree).props.onClick({});
  await settle();
  await settle();
  assert.equal(resPuts(fr).length, 1);
  assert.equal(resPuts(fr)[0][2].capacity, 5);
  h.m.unmount();
}));

test("T7 galat simpan: TOO_LARGE → pesan MSG_RES_TOO_LARGE inline; INVALID → 'Periksa tanggal cuti'; galat lain → toast persis 'Gagal menyimpan kapasitas'; dialog tetap terbuka, Simpan aktif lagi", () => withPop(async () => {
  for (const [code, inline, toast] of [["TOO_LARGE", T.MSG_RES_TOO_LARGE, null], ["INVALID", RES_DATE_BAD, null], ["IDB", null, "Gagal menyimpan kapasitas"]]) {
    const h = edSetup();
    let n = 0;
    h.set({ store: { save: () => { n++; return Promise.reject(Object.assign(new Error("x"), { code })); }, get: () => Promise.resolve(null) } });
    saveBtn(h.tree).props.onClick({});
    await settle();
    await settle();
    h.render();
    assert.equal(n, 1, code);
    assert.deepEqual(alerts(h.tree), inline ? [inline] : [], code);
    assert.deepEqual(h.calls.toast, toast ? [[toast, "error"]] : [], code);
    assert.deepEqual(h.closes, [], code);
    assert.equal(saveBtn(h.tree).props.disabled, false, code + ": aktif lagi");
    if (inline) {
      capIn(h.tree).props.onChange(chg("7"));
      h.render();
      assert.deepEqual(alerts(h.tree), [], code + ": pesan hilang saat diubah");
    }
    h.m.unmount();
  }
  assert.equal(T.MSG_RES_SAVE_FAIL, "Gagal menyimpan kapasitas");
}));

test("T7 keterangan 'Diubah oleh {nama} · {tgl}' (tanggal Jakarta dari updated_at; nama dari currentUser/collaborators) dan 'Diubah oleh anggota lain · {tgl}'", () => withPop(async () => {
  const at = { updated_at: "2026-11-04T18:30:00Z" }; // UTC Rab 4 Nov, Jakarta Kam 5 Nov 01.30
  const cases = [
    [{ by: 9 }, "Diubah oleh Budi · Kam 5 Nov"],
    [{ by: 7 }, "Diubah oleh Sari · Kam 5 Nov"],
    [{ by: 99 }, "Diubah oleh anggota lain · Kam 5 Nov"],
    [{ by: null }, "Diubah oleh anggota lain · Kam 5 Nov"],
    [{ v: 2, by: 9 }, "Diubah oleh anggota lain · Kam 5 Nov"], // data asing: by tidak dipercaya
  ];
  for (const [data, want] of cases) {
    const fr = fakeRecords();
    putRec(fr, resRec(12, 9, data, at));
    const h = edSetup({ records: fr, res: { map: await mapOf(fr) } });
    const by = nodes(h.tree, (n) => hasCls(n, "plg-timeline-res-by"));
    assert.equal(by.length, 1, want);
    assert.equal(txt(by[0]).trim(), want);
    h.m.unmount();
  }
  // id string (JWT) di collaborators/currentUser tetap cocok
  const fr = fakeRecords();
  putRec(fr, resRec(12, 9, { by: 9 }, at));
  const h = edSetup({ records: fr, res: { map: await mapOf(fr), collaborators: [{ id: "9", username: "budi" }] } });
  assert.equal(txt(nodes(h.tree, (n) => hasCls(n, "plg-timeline-res-by"))[0]).trim(), "Diubah oleh budi · Kam 5 Nov");
  h.m.unmount();
}));

// View → LoadPanel → ResourceEditor (tiga tingkat dipasang terpisah, props asli dari view).
async function edView(clock, o) {
  const h = await panelView(clock, o);
  const pm = mount(T.LoadPanel);
  let em = null;
  let emKey = null;
  const x = { h, pm };
  x.panel = () => {
    h.render();
    x.node = panelOf(h.tree);
    x.pt = x.node ? pm.render(x.node.props) : null;
    return x.pt;
  };
  x.editor = () => {
    x.panel();
    const e = x.pt ? edOf(x.pt) : undefined;
    if (!e) {
      x.ed = null;
      x.et = null;
      return null;
    }
    if (!em || emKey !== e.key) {
      em = mount(T.ResourceEditor);
      emKey = e.key;
    }
    x.ed = e;
    x.et = em.render(e.props);
    em.flush();
    x.et = em.render(e.props);
    return x.et;
  };
  x.nameBtn = (prefix) => byCls(x.pt, "plg-timeline-load-name").find((n) => txt(n).trim().indexOf(prefix) === 0);
  x.open = (prefix) => {
    x.panel();
    const btn = { focused: 0, focus() { this.focused++; } };
    x.nameBtn(prefix).props.onClick({ currentTarget: btn });
    x.editor();
    return btn;
  };
  x.unmount = () => {
    if (em) em.unmount();
    pm.unmount();
    h.m.unmount();
  };
  return x;
}

test("T7 view: nama di panel → editor (Q4 a: siapa pun) — tombol nama aria-haspopup dialog + aria-expanded; props editor = bundel kapasitas view; klik nama yang sama → tutup; nama lain → ganti; Batal → fokus kembali ke nama; 'Belum ditugaskan' tanpa editor; 0 tulis", () => withEngineClock(async (clock) => {
  const x = await edView(clock);
  x.panel();
  const names = byCls(x.pt, "plg-timeline-load-name").filter((n) => n.type === "button");
  assert.ok(names.length === 3 && names.every((n) => n.props["aria-haspopup"] === "dialog" && n.props["aria-expanded"] === false));
  assert.equal(edOf(x.pt), undefined, "tertutup bawaan");
  const btn = x.open("Budi");
  assert.ok(x.ed, "editor dirender LoadPanel");
  assert.equal(x.nameBtn("Budi").props["aria-expanded"], true);
  assert.equal(x.nameBtn("Sari").props["aria-expanded"], false);
  assert.deepEqual([x.ed.props.uid, x.ed.props.name], [9, "Budi"]);
  const r = x.ed.props.res;
  assert.ok(r.map instanceof Map && r.map.has(9));
  assert.deepEqual([r.loaded, r.pulled, r.pageKind, r.listId, r.userId], [true, false, "workspace", 12, 7]);
  assert.equal(typeof r.store.save, "function");
  assert.equal(r.api, x.h.api);
  assert.equal(r.currentUser, x.h.props.context.currentUser);
  assert.equal(r.collaborators, x.h.props.context.collaborators);
  assert.equal(dlgNode(x.et).props["aria-label"], "Kapasitas Budi");
  assert.equal(capIn(x.et).props.value, "2");
  assert.equal(saveBtn(x.et).props.disabled, false, "record lokal ada → terbuka");
  // memo: render ulang view tanpa perubahan → props panel identik
  const p1 = x.node.props;
  x.panel();
  for (const k of Object.keys(p1)) assert.ok(Object.is(p1[k], x.node.props[k]), "prop stabil: " + k);
  // Batal → tutup + fokus kembali ke tombol nama
  buttonByText(x.et, "Batal").props.onClick({});
  x.editor();
  assert.equal(x.ed, null);
  assert.equal(btn.focused, 1);
  assert.equal(x.nameBtn("Budi").props["aria-expanded"], false);
  // toggle + ganti orang
  x.open("Sari");
  assert.equal(x.ed.props.uid, 7);
  x.nameBtn("Sari").props.onClick({ currentTarget: btn });
  x.editor();
  assert.equal(x.ed, null, "nama yang sama → tutup");
  x.open("Citra");
  x.nameBtn("Budi").props.onClick({ currentTarget: btn });
  x.editor();
  assert.equal(x.ed.props.uid, 9, "nama lain → ganti");
  assert.equal(byCls(x.pt, "plg-timeline-load-name").find((n) => txt(n).trim() === "Belum ditugaskan").type, "div");
  // panel ditutup → editor tertutup (tidak terbuka lagi saat panel dibuka kembali)
  loadBtnOf(x.h.tree).props.onClick({});
  await x.h.again();
  loadBtnOf(x.h.tree).props.onClick({});
  await x.h.again();
  x.editor();
  assert.equal(x.ed, null);
  assert.deepEqual(x.h.writes, []);
  assert.equal(x.h.fr.calls.put.length, 0);
  x.unmount();
}));

test("T7 view: kunci (b) perangkat baru — Sari tanpa record lokal, belum ada tarik → terkunci 'Menunggu data workspace…'; peristiwa pulled → muat ulang → terbuka; 0 tulis", () => withEngineClock(async (clock) => {
  const x = await edView(clock);
  x.open("Sari");
  assert.equal(saveBtn(x.et).props.disabled, true);
  assert.ok(hasText(x.et, RES_WAIT));
  x.h.fr.emit(PULLED);
  await x.h.again();
  x.editor();
  assert.equal(x.ed.props.res.pulled, true);
  assert.equal(saveBtn(x.et).props.disabled, false);
  assert.ok(!hasText(x.et, RES_WAIT));
  assert.deepEqual(x.h.writes, []);
  assert.equal(x.h.fr.calls.put.length, 0);
  x.unmount();
}));

test("T7 view: Simpan kapasitas Budi 8 → 1 put (saveResource) + toast; onChange lokal → panel memuat ulang: '{nama} · 8 🍅/hari', hari merah tinggal cuti; pagar R25 (pin saveResource:records.put = 1) tetap", () => withEngineClock(async (clock) => {
  const x = await edView(clock);
  x.panel();
  assert.equal(panelHead(x.pt), "Beban Tim · 6 hari kelebihan beban · 1 task belum dijadwalkan · 2 task bertarget bawaan 1 🍅");
  x.open("Budi");
  capIn(x.et).props.onChange(chg("8"));
  x.editor();
  saveBtn(x.et).props.onClick({});
  await settle();
  await settle();
  assert.deepEqual(resPuts(x.h.fr).map((p) => [p[1], p[2], p[3]]), [["res@list:12:9", { v: 1, capacity: 8, leave: [{ from: "2026-11-09", to: "2026-11-10", note: "Cuti" }], by: 7 }, { scope: "list:12" }]]);
  assert.deepEqual(x.h.calls.toast, [["Kapasitas Budi disimpan", "success"]]);
  x.editor();
  assert.equal(x.ed, null, "ditutup setelah simpan");
  // host: put lokal → onChange {source: "local"} → useResources memuat ulang (debounce) → beban dihitung ulang
  x.h.fr.emit({ entity: "resource", ids: ["res@list:12:9"], source: "local" });
  await x.h.again();
  x.panel();
  assert.deepEqual(panelNames(x.pt)[0], ["button", "Budi · 8 🍅/hari"]);
  assert.equal(panelHead(x.pt), "Beban Tim · 2 hari kelebihan beban · 1 task belum dijadwalkan · 2 task bertarget bawaan 1 🍅");
  const budi = x.node.props.load.rows.find((r) => r.uid === 9);
  assert.deepEqual(budi.overDays.map(T.TLCal.iso), ["2026-11-09", "2026-11-10"], "tinggal hari cuti");
  assert.deepEqual(x.h.writes, [], "taskExt tidak disentuh");
  assert.equal(resPuts(x.h.fr).length, 1, "satu-satunya tulisan = Simpan");
  assert.match(jsx, /function saveResource\(/);
  assert.equal((jsx.match(/records\.put\(/g) || []).length, 4, "records.put hanya di save/setAuto/saveBaseline/saveResource");
  x.unmount();
}));

test("T7 CSS editor: .plg-timeline-res-pop membuka ke atas panel; baris cuti grid tanpa lebar tetap; input tidak sah bertepi --plg-timeline-danger; input 16 px di ≤ 640 px (cegah zoom iOS); hanya token", () => {
  const block = css.slice(css.indexOf("1d-1 Task 7"));
  assert.ok(block.length > 100, "blok CSS Task 7");
  assert.match(block, /\.plg-timeline-res-pop\s*\{[^}]*bottom:\s*100%/);
  assert.match(block, /\.plg-timeline-res-row\s*\{[^}]*display:\s*grid/);
  assert.match(block, /\[aria-invalid="true"\][^{]*\{[^}]*var\(--plg-timeline-danger\)/);
  assert.match(block, /@media \(max-width: 640px\)\s*\{[^@]*\.plg-timeline-res-pop \.plg-timeline-pop-input\s*\{[^}]*font-size:\s*16px/);
  assert.doesNotMatch(block, /border-left\s*:/);
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
});

test("T7 satu popover panel pada satu waktu: buka editor saat popover saran terbuka → saran tertutup; buka saran (keyboard, tanpa pointerdown) saat editor terbuka → editor tertutup; 0 tulis", () => withEngineClock(async (clock) => {
  const x = await edView(clock, { tasks: sugTasks(), records: sugRecords() });
  x.panel();
  const hit = () => hitOf(x.pt, "Budi · Rab 4 Nov");
  hit().props.onClick({ currentTarget: { focus() {} } });
  x.panel();
  assert.ok(sugOf(x.pt), "saran terbuka");
  x.nameBtn("Budi").props.onClick({ currentTarget: { focus() {} } });
  x.editor();
  assert.equal(sugOf(x.pt), undefined, "saran ditutup saat editor dibuka");
  assert.ok(x.ed, "editor terbuka");
  hit().props.onClick({ currentTarget: { focus() {} } });
  x.editor();
  assert.equal(x.ed, null, "editor ditutup saat saran dibuka");
  assert.ok(sugOf(x.pt));
  assert.deepEqual(x.h.writes, []);
  assert.equal(x.h.fr.calls.put.length, 0);
  x.unmount();
}));

// ════════════════════════════════════════════════════════════════════════════
// Fase 1 PR 1d-1 — Task 8: Beban Tim versi HP (≤ 640 px; spec §7.6; rencana R10) — daftar "Hari kelebihan beban"
// ════════════════════════════════════════════════════════════════════════════
const listOf = (tree) => nodes(tree, (n) => n.type === T.LoadList)[0];
const mDays = (lt) => byCls(lt, "plg-timeline-load-m-day");
const mChips = (lt) => byCls(lt, "plg-timeline-load-m-person");
const narrowGlobal = (innerHeight) => ({
  matchMedia: (q) => ({ matches: q === "(max-width: 640px)", addEventListener() {}, removeEventListener() {} }),
  innerHeight: innerHeight || 800, addEventListener() {}, removeEventListener() {},
});
function withNarrowClock(fn, innerHeight) {
  return withEngineClock(async (clock) => {
    const prev = global.window;
    global.window = narrowGlobal(innerHeight);
    try {
      return await fn(clock);
    } finally {
      global.window = prev;
    }
  });
}
// Daftar HP dipasang sendiri (props asli dari view).
function mList(h) {
  const node = listOf(h.tree);
  const lm = mount(T.LoadList);
  const x = { node, lm, props: node.props };
  x.render = () => (x.tree = lm.render(x.props));
  x.render();
  lm.flush();
  x.render();
  return x;
}
const PANEL_DAYS = [
  "Budi · Rab 4 Nov · 4 dari 2 🍅",
  "Budi · Kam 5 Nov · 4 dari 2 🍅",
  "Budi · Jum 6 Nov · 4 dari 2 🍅",
  "Budi · Sen 9 Nov · 1 dari 0 🍅",
  "Budi · Sel 10 Nov · 1 dari 0 🍅",
  "Budi · Sen 2 Agu · 5 dari 2 🍅",
];

test("T8 view ≤ 640 px + pref ON: Gantt → LoadList tepat setelah .plg-timeline-scroll, sebelum legenda; Daftar → setelah daftar ListFallback; tanpa LoadPanel; props stabil (memo); layar lebar / pref OFF → tanpa LoadList; 0 tulis", () => withNarrowClock(async (clock) => {
  const h = await panelView(clock);
  assert.ok(gridOf(h.tree), "Gantt HP");
  assert.equal(panelOf(h.tree), undefined, "histogram desktop tidak dirender");
  const kids = h.tree.children.filter((c) => c && typeof c === "object");
  const iGrid = kids.findIndex((c) => hasCls(c, "plg-timeline-scroll"));
  const iList = kids.findIndex((c) => c.type === T.LoadList);
  const iFoot = kids.findIndex((c) => hasCls(c, "plg-timeline-foot"));
  assert.ok(iGrid >= 0 && iList === iGrid + 1 && iFoot === iList + 1, "grafik · daftar HP · legenda (" + [iGrid, iList, iFoot] + ")");
  const p = listOf(h.tree).props;
  assert.ok(p.load && Array.isArray(p.load.rows));
  assert.equal(p.cal && typeof p.cal.mask.has, "function");
  assert.equal(p.pageKind, "workspace");
  for (const k of ["onEditPerson", "onReveal"]) assert.equal(typeof p[k], "function", k);
  assert.ok(p.boxRef && "current" in p.boxRef);
  assert.equal(p.editUid, null);
  assert.ok(p.res && p.res.map instanceof Map);
  const p2 = listOf(h.render()).props;
  for (const k of Object.keys(p)) assert.ok(Object.is(p[k], p2[k]), "prop stabil: " + k);
  assert.match(jsx, /React\.memo\(LoadList\)/);
  // Daftar HP
  buttonByText(h.tree, "Daftar").props.onClick({});
  const t2 = h.render();
  assert.equal(gridOf(t2), undefined);
  const k2 = t2.children.filter((c) => c && typeof c === "object");
  const iLi = k2.findIndex((c) => hasCls(c, "plg-timeline-list"));
  assert.ok(iLi >= 0 && k2.findIndex((c) => c.type === T.LoadList) === iLi + 1, "Daftar · daftar HP");
  assert.equal(panelOf(t2), undefined);
  assert.deepEqual(h.writes, []);
  assert.equal(h.fr.calls.put.length, 0);
  h.m.unmount();
  const off = await panelView(clock, { loadOff: true });
  assert.equal(listOf(off.tree), undefined, "pref OFF");
  off.m.unmount();
}));

test("T8 view lebar (> 640 px) dan Live Edit lebar → tanpa LoadList (histogram desktop)", () => withEngineClock(async (clock) => {
  const h = await panelView(clock);
  assert.equal(listOf(h.tree), undefined);
  assert.ok(panelOf(h.tree));
  h.m.unmount();
  const le = await panelView(clock, { ctx: { liveEdit: true } });
  assert.equal(listOf(le.tree), undefined);
  le.m.unmount();
}));

test("T8 LoadList: section .plg-timeline-load-m (ref = boxRef) + judul persis desktop; chip '{nama} · {cap} 🍅/hari' (tanpa Belum ditugaskan); subjudul persis 'Hari kelebihan beban' + <ul> tombol teks persis '{nama} · {tgl} · {beban} dari {kapasitas} 🍅' urut tanggal; tanpa <svg>", () => withNarrowClock(async (clock) => {
  const h = await panelView(clock);
  const x = mList(h);
  const sec = nodes(x.tree, (n) => n.type === "section")[0];
  assert.ok(hasCls(sec, "plg-timeline-load-m"));
  assert.equal(sec.props["aria-label"], "Beban Tim");
  assert.equal(sec.props.ref, x.props.boxRef, "diukur view (tinggi wadah Gantt)");
  assert.equal(txt(byCls(x.tree, "plg-timeline-load-head")[0]).trim(), "Beban Tim · 6 hari kelebihan beban · 1 task belum dijadwalkan · 2 task bertarget bawaan 1 🍅");
  assert.equal(byCls(x.tree, "plg-timeline-load-note").length, 0, "workspace tanpa catatan P3");
  assert.deepEqual(mChips(x.tree).map((b) => [b.type, txt(b).trim(), b.props["aria-haspopup"], b.props["aria-expanded"]]), [
    ["button", "Budi · 2 🍅/hari", "dialog", false], ["button", "Citra · 8 🍅/hari", "dialog", false], ["button", "Sari · 8 🍅/hari", "dialog", false],
  ]);
  const sub = byCls(x.tree, "plg-timeline-load-m-sub")[0];
  assert.equal(sub.type, "h4");
  assert.equal(txt(sub).trim(), "Hari kelebihan beban");
  const ul = nodes(x.tree, (n) => n.type === "ul")[0];
  assert.ok(hasCls(ul, "plg-timeline-load-m-list"));
  const days = mDays(x.tree);
  assert.deepEqual(days.map((b) => txt(b).trim()), PANEL_DAYS);
  assert.ok(days.every((b) => b.type === "button" && b.props.type === "button" && b.props["aria-haspopup"] === "dialog" && b.props["aria-expanded"] === false));
  assert.ok(nodes(ul, (n) => n.type === "li").length === 6);
  assert.equal(nodes(x.tree, (n) => n.type === "svg").length, 0, "tanpa SVG");
  assert.equal(byCls(x.tree, "plg-timeline-load-m-more").length, 0);
  x.lm.unmount();
  h.m.unmount();
}));

test("T8 loadDayItems: urut tanggal naik lalu nama (TLCpm.cmpKey) lalu uid; teks persis (beban dibulatkan ke atas di hari merah); baris tanpa penanggung jawab dilewati", () => {
  const dn = dnOfIso;
  const cal = T.TLCal.compile(T.TLCal.DEFAULT_CAL);
  const day = (load) => ({ load, parts: [] });
  const load = {
    rows: [
      { uid: 3, name: "Zaki", capacity: 2, res: { capacity: 2, leave: [] }, days: new Map([[dn("2026-11-05"), day(2100)], [dn("2026-11-04"), day(4000)]]), overDays: [dn("2026-11-04"), dn("2026-11-05")], total: 6100 },
      { uid: 1, name: "Ani", capacity: 1, res: { capacity: 1, leave: [{ from: dn("2026-11-05"), to: dn("2026-11-05"), note: "" }] }, days: new Map([[dn("2026-11-05"), day(500)]]), overDays: [dn("2026-11-05")], total: 500 },
      { uid: 2, name: "Zaki", capacity: 8, res: null, days: new Map([[dn("2026-11-05"), day(9000)]]), overDays: [dn("2026-11-05")], total: 9000 },
      { uid: null, name: "Belum ditugaskan", capacity: null, res: null, days: new Map([[dn("2026-11-04"), day(50000)]]), overDays: [], total: 50000 },
    ],
  };
  assert.deepEqual(T.loadDayItems(load, cal).map((it) => [it.uid, it.dn, it.text]), [
    [3, dn("2026-11-04"), "Zaki · Rab 4 Nov · 4 dari 2 🍅"],
    [1, dn("2026-11-05"), "Ani · Kam 5 Nov · 0.5 dari 0 🍅"],
    [2, dn("2026-11-05"), "Zaki · Kam 5 Nov · 9 dari 8 🍅"],
    [3, dn("2026-11-05"), "Zaki · Kam 5 Nov · 2.5 dari 2 🍅"],
  ]);
  assert.deepEqual(T.loadDayItems({ rows: [] }, cal), []);
  assert.match(jsx, /TLCpm\.cmpKey\(a\.name, b\.name\)/);
});

test("T8 ketuk item → popover saran T6 di dalam <li> item (judul 'Bisa digeser — {nama}, {tgl}', items = TLLoad.suggest, tanpa left — CSS HP); ketuk lagi → tutup; item lain → ganti; Esc/Tutup → fokus kembali ke item; pilih baris → onReveal (Gantt HP: gulir + kedip); 0 tulis", () => withNarrowClock(async (clock) => {
  const h = await panelView(clock, { tasks: sugTasks(), records: sugRecords() });
  const x = mList(h);
  assert.deepEqual(mDays(x.tree).map((b) => txt(b).trim()), ["Budi · Rab 4 Nov · 12 dari 2 🍅", "Citra · Rab 4 Nov · 20 dari 8 🍅"]);
  const item = (i) => mDays(x.tree)[i];
  const btn = { focused: 0, focus() { this.focused++; } };
  item(0).props.onClick({ currentTarget: btn });
  x.render();
  let sp = sugOf(x.tree);
  assert.ok(sp, "popover terbuka");
  assert.equal(sp.props.title, "Bisa digeser — Budi, Rab 4 Nov");
  assert.equal(sp.props.left, undefined, "posisi dari CSS HP");
  assert.equal(item(0).props["aria-expanded"], true);
  const li0 = nodes(x.tree, (n) => n.type === "li")[0];
  assert.ok(nodes(li0, (n) => n.type === T.SuggestPopover).length === 1, "popover di dalam item (jangkar)");
  const p = x.props;
  const want = T.TLLoad.suggest(p.load, 9, dnOfIso("2026-11-04"), { result: p.result, units: p.ctx.units, readExt: p.ctx.readExt, tasks: p.ctx.tasks });
  assert.deepEqual(sp.props.items.map((s) => [s.key, s.kind]), want.map((s) => [s.key, s.kind]));
  const spt = child(sp);
  assert.deepEqual(sugRows(spt)[0], ["Ikon · 3 🍅 hari ini · slack 9 hk", null]);
  // ketuk lagi → tutup (toggle); item lain → ganti
  item(0).props.onClick({ currentTarget: btn });
  x.render();
  assert.equal(sugOf(x.tree), undefined);
  item(0).props.onClick({ currentTarget: btn });
  x.render();
  item(1).props.onClick({ currentTarget: btn });
  x.render();
  sp = sugOf(x.tree);
  assert.equal(sp.props.title, "Bisa digeser — Citra, Rab 4 Nov");
  // Esc/Tutup → fokus kembali ke item pemicu
  sp.props.onClose({ restoreFocus: true });
  x.render();
  assert.equal(sugOf(x.tree), undefined);
  assert.equal(btn.focused, 1);
  // pemicu lain di daftar HP tidak menutup lewat pointerdown (ditangani tombolnya)
  item(0).props.onClick({ currentTarget: btn });
  x.render();
  sp = sugOf(x.tree);
  assert.match(sp.props.skipSel, /\.plg-timeline-load-m-day/);
  // pilih baris → onReveal view (Gantt HP: baris ada di lay.rows → gulir + kedip, bukan detail)
  const el = fakeEl();
  h.tree = attach(h.m, h.props, h.tree, el);
  await settle();
  clock.frames();
  sp.props.onPick(sp.props.items.find((s) => s.key === "2"));
  x.render();
  assert.equal(sugOf(x.tree), undefined);
  h.render();
  assert.ok(nodes(h.tree, (n) => hasCls(n, "is-flash")).length > 0, "kedip di Gantt HP");
  assert.deepEqual(h.clicked, []);
  assert.deepEqual(h.writes, []);
  assert.equal(h.fr.calls.put.length + h.fr.calls.remove.length, 0);
  x.lm.unmount();
  h.m.unmount();
}));

test("T8 Daftar HP: pilih baris saran → detail task (context.onTaskClick, tidak ada Gantt untuk digulir); 0 tulis", () => withNarrowClock(async (clock) => {
  const h = await panelView(clock, { tasks: sugTasks(), records: sugRecords() });
  buttonByText(h.tree, "Daftar").props.onClick({});
  h.render();
  const x = mList(h);
  mDays(x.tree)[0].props.onClick({ currentTarget: { focus() {} } });
  x.render();
  const sp = sugOf(x.tree);
  sp.props.onPick(sp.props.items.find((s) => s.key === "2"));
  assert.deepEqual(h.clicked.map((t) => t.id), [2]);
  assert.deepEqual(h.writes, []);
  assert.equal(h.fr.calls.put.length, 0);
  x.lm.unmount();
  h.m.unmount();
}));

test("T8 chip → editor T7 (ResourceEditor di dalam wadah chip, aria-expanded; sama = tutup; lain = ganti) — kapasitas orang tanpa hari merah (Sari) bisa diatur di HP; Simpan → 1 put", () => withNarrowClock(async (clock) => {
  const h = await panelView(clock);
  let x = mList(h);
  const btn = { focused: 0, focus() { this.focused++; } };
  const chip = (prefix) => mChips(x.tree).find((b) => txt(b).trim().indexOf(prefix) === 0);
  chip("Sari").props.onClick({ currentTarget: btn });
  h.render();
  x.props = listOf(h.tree).props;
  x.render();
  assert.equal(x.props.editUid, 7);
  assert.equal(chip("Sari").props["aria-expanded"], true);
  const people = byCls(x.tree, "plg-timeline-load-m-people")[0];
  const ed = nodes(people, (n) => n.type === T.ResourceEditor)[0];
  assert.ok(ed, "editor di wadah chip");
  assert.deepEqual([ed.props.uid, ed.props.name], [7, "Sari"]);
  assert.equal(ed.props.res, x.props.res);
  // editor bekerja seperti di desktop (Sari tanpa record → menunggu pulled; tarik → simpan)
  h.fr.emit(PULLED);
  h.tree = await h.again();
  x.props = listOf(h.tree).props;
  x.render();
  const em = mount(T.ResourceEditor);
  const e1 = edOf(x.tree);
  let et = em.render(e1.props);
  em.flush();
  et = em.render(e1.props);
  capIn(et).props.onChange(chg("6"));
  et = em.render(e1.props);
  saveBtn(et).props.onClick({});
  await settle();
  await settle();
  assert.deepEqual(resPuts(h.fr).map((p) => [p[1], p[2].capacity, p[3]]), [["res@list:12:7", 6, { scope: "list:12" }]]);
  assert.equal(btn.focused, 1, "ditutup setelah simpan → fokus kembali ke chip");
  em.unmount();
  h.render();
  x.props = listOf(h.tree).props;
  x.render();
  assert.equal(x.props.editUid, null);
  // sama = tutup; lain = ganti
  chip("Budi").props.onClick({ currentTarget: btn });
  h.render();
  x.props = listOf(h.tree).props;
  x.render();
  chip("Budi").props.onClick({ currentTarget: btn });
  h.render();
  assert.equal(listOf(h.tree).props.editUid, null);
  x.props = listOf(h.tree).props;
  x.render();
  chip("Budi").props.onClick({ currentTarget: btn });
  h.render();
  x.props = listOf(h.tree).props;
  x.render();
  chip("Citra").props.onClick({ currentTarget: btn });
  h.render();
  assert.equal(listOf(h.tree).props.editUid, 11);
  assert.equal(resPuts(h.fr).length, 1);
  x.lm.unmount();
  h.m.unmount();
}));

test("T8 kosong (0 hari kelebihan beban) → judul 'Beban Tim · 0 hari kelebihan beban' + chip orang, tanpa subjudul/daftar; pribadi + catatan P3", () => withNarrowClock(async (clock) => {
  const L = PANEL_L;
  const tasks = [mk(1, "Ringan", { start: "2026-11-04", duration: 2 }, Object.assign({ assigned_to: 7, estimated_pomodoros: 2 }, L))];
  const h = await panelView(clock, { tasks });
  const x = mList(h);
  assert.equal(txt(byCls(x.tree, "plg-timeline-load-head")[0]).trim(), "Beban Tim · 0 hari kelebihan beban");
  assert.deepEqual(mChips(x.tree).map((b) => txt(b).trim()), ["Budi · 2 🍅/hari", "Sari · 8 🍅/hari"]);
  assert.equal(byCls(x.tree, "plg-timeline-load-m-sub").length, 0);
  assert.equal(nodes(x.tree, (n) => n.type === "ul").length, 0);
  assert.equal(mDays(x.tree).length, 0);
  x.lm.unmount();
  h.m.unmount();
  const al = { project: "Alpha" };
  const fr = fakeRecords();
  const p = await panelView(clock, { tasks: [mk(1, "A", { start: "2026-11-04", duration: 1 }, al)], records: fr, ctx: { page: "proj_Alpha", pageKind: "project", listId: null, projectName: "Alpha" } });
  const y = mList(p);
  assert.equal(txt(byCls(y.tree, "plg-timeline-load-note")[0]).trim(), "Hanya beban dari project ini");
  assert.deepEqual(mChips(y.tree).map((b) => txt(b).trim()), ["Sari · 8 🍅/hari"]);
  y.lm.unmount();
  p.m.unmount();
}));

test("T8 batas DOM: > 100 hari kelebihan beban → 100 item terdekat (urut tanggal) + 'dan {n} lainnya'; elemen daftar ≤ 300; tanpa <svg>", () => {
  const x = heavyLoad("week");
  const props = { load: x.load, cal: x.ctx.cal, result: x.result, ctx: x.ctx, pageKind: "workspace", boxRef: { current: null }, editUid: null, onEditPerson() {}, res: null, onReveal() {} };
  const lm = mount(T.LoadList);
  const lt = lm.render(props);
  lm.flush();
  const total = x.load.rows.reduce((s, r) => s + r.overDays.length, 0);
  assert.ok(total > 100, "kasus terburuk: " + total);
  const all = T.loadDayItems(x.load, x.ctx.cal);
  assert.deepEqual(mDays(lt).map((b) => txt(b).trim()), all.slice(0, 100).map((it) => it.text));
  assert.equal(txt(byCls(lt, "plg-timeline-load-m-more")[0]).trim(), "dan " + (total - 100) + " lainnya");
  const n = domCount(lt);
  assert.ok(n <= 300, "elemen daftar HP: " + n);
  assert.equal(nodes(lt, (q) => q.type === "svg").length, 0);
  console.log("# DOM daftar HP Beban Tim 10 orang: " + n + " elemen, 100/" + total + " item");
  lm.unmount();
});

test("T8 tinggi: daftar HP diukur seperti panel desktop — saat daftar muncul tinggi wadah Gantt HP diukur ulang dan dikurangi tinggi daftar (legenda tetap terlihat)", () => withNarrowClock(async (clock) => {
  const v = await panelView(clock, { loadOff: true });
  const el = fakeEl();
  let tree = attach(v.m, v.props, v.tree, el);
  assert.equal(listOf(tree), undefined);
  assert.equal(gridOf(tree).props.style.height, 1200 - 100 - 16, "Beban Tim mati");
  loadBtnMenu(tree).onSelect();
  tree = v.m.render(v.props);
  v.m.flush(); // review akhir: daftar menunggu kapasitas termuat (records.list) — tanpa kilatan kapasitas bawaan
  await settle();
  tree = v.m.render(v.props);
  const node = listOf(tree);
  assert.ok(node, "daftar HP muncul");
  node.props.boxRef.current = { offsetHeight: 250 }; // React memasang ref akar section SEBELUM efek tata letak (ukur)
  tree = attach(v.m, v.props, tree, el);
  assert.equal(gridOf(tree).props.style.height, 1200 - 100 - 16 - 250, "tinggi daftar dikurangkan");
  assert.deepEqual(v.writes, []);
  v.m.unmount();
}, 1200));
const loadBtnMenu = (tree) => moreOf(tree).props.items.find((it) => it.text === "Beban Tim");

test("T8 375 px tanpa gulir horizontal (pendekatan: pohon tanpa lebar inline + CSS tanpa lebar tetap > 343 px, teks membungkus, popover HP ≤ 100vw − 32 px; E2E T11 skenario 9 mengukur scrollWidth)", () => withNarrowClock(async (clock) => {
  const h = await panelView(clock, { tasks: sugTasks(), records: sugRecords() });
  const x = mList(h);
  mDays(x.tree)[0].props.onClick({ currentTarget: { focus() {} } });
  x.render();
  for (const n of nodes(x.tree, (q) => typeof q.type === "string")) {
    const s = n.props.style || {};
    for (const k of ["width", "minWidth", "left", "right"]) assert.equal(s[k], undefined, n.type + "." + k);
  }
  const spt = child(sugOf(x.tree));
  assert.deepEqual(nodes(spt, (n) => n.props.role === "dialog")[0].props.style, { left: undefined });
  x.lm.unmount();
  h.m.unmount();
  const block = css.slice(css.indexOf("1d-1 Task 8"));
  assert.ok(block.length > 100, "blok CSS Task 8");
  for (const m of block.matchAll(/(?:^|[\s;{])(min-width|width|flex-basis)\s*:\s*(\d+)px/g)) assert.ok(Number(m[2]) <= 343, m[0]);
  assert.match(block, /\.plg-timeline-load-m-day\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(block, /\.plg-timeline-load-m-day\s*\{[^}]*width:\s*100%/);
  assert.match(block, /\.plg-timeline-load-m-person\s*\{[^}]*max-width:\s*100%[^}]*text-overflow:\s*ellipsis/);
  assert.match(block, /\.plg-timeline-load-m-people\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(block, /\.plg-timeline-load-m \.plg-timeline-pop\s*\{[^}]*top:\s*100%[^}]*max-width:\s*min\(calc\(100% - 16px\), calc\(100vw - 32px\)\)/);
  assert.match(block, /\.plg-timeline-load-m-item\s*\{[^}]*position:\s*relative/);
  assert.doesNotMatch(block, /border-left\s*:/);
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  for (const n of nodes(x.tree, (q) => typeof q.props.className === "string")) {
    for (const c of n.props.className.split(/\s+/).filter(Boolean)) assert.match(c, /^(plg-timeline(-[\w-]+)?|is-[\w-]+)$/, c);
  }
}));

// ════════════════════════════════════════════════════════════════════════════
// Fase 1 PR 1d-1 — perbaikan review T4–T6: hari merah selalu terjangkau (I1), panel tetap sejajar dengan Gantt (I2), hari
// non-kerja abu (I3), skala vertikal stabil (I4); minor M1–M5, M7
// ════════════════════════════════════════════════════════════════════════════
const fakeFocus = (o) => Object.assign({ focused: 0, opts: [], focus(x) { this.focused++; this.opts.push(x); } }, o || {});
const daysBtnOf = (pt) => byCls(pt, "plg-timeline-load-daysbtn")[0];
const headOf = (pt) => byCls(pt, "plg-timeline-load-head")[0];

test("Review T4–T6 I4: skala vertikal per baris = maks(kapasitas, beban maks) atas SELURUH row.days (sekali per hasil beban) — jendela dw berganti tidak mengubah tinggi kapasitas/batang; Belum ditugaskan = beban maks; minimal 1 🍅", () => withEngineClock(async (clock) => {
  const h = await panelView(clock);
  const p = panelOf(h.tree).props;
  const M = T.TLLoad.MILLI;
  // Budi: kapasitas 2, beban maks 5 🍅 (Rilis jauh Sen 2 Agu 2027, DI LUAR jendela); Citra/Sari: kapasitas 8; Belum
  // ditugaskan: beban maks 1 🍅 (Rapat)
  assert.deepEqual(p.load.rows.map((r) => [r.name, T.loadScaleOf(r)]), [["Budi", 5 * M], ["Citra", 8 * M], ["Sari", 8 * M], ["Belum ditugaskan", M]]);
  assert.equal(T.loadScaleOf({ uid: 3, capacity: 0, days: new Map() }), M, "minimal 1 🍅");
  assert.equal(T.loadScaleOf({ uid: null, capacity: null, days: new Map([[1, { load: 250, parts: [] }]]) }), M);
  assert.equal(T.loadScaleOf({ uid: null, capacity: null, days: new Map([[1, { load: 2500, parts: [] }], [2, { load: 1200, parts: [] }]]) }), 2500);
  const pm = mount(T.LoadPanel);
  const capD = (pt, i) => pathD(panelSvgs(pt)[i], "plg-timeline-load-cap");
  const barD = (pt, i) => pathD(panelSvgs(pt)[i], "plg-timeline-load-bar");
  let pt = pm.render(p);
  pm.flush();
  // jendela bawaan: kapasitas Budi 2 dari skala 5 → 10 px (dulu 12.5 dari maks jendela 4)
  assert.ok(capD(pt, 0).includes("M" + (dnOfIso("2026-11-02") - p.fromDn) * p.px + " 18h60v10h-60Z"), capD(pt, 0));
  // jendela tanpa beban Budi (Sen 2–Sel 3 Nov): dulu skala = kapasitas 2 → 25 px (melompat); kini tetap 10 px
  pt = pm.render(Object.assign({}, p, { fromDn: dnOfIso("2026-11-02"), toDn: dnOfIso("2026-11-03") }));
  assert.equal(capD(pt, 0), "M0 18h24v10h-24Z");
  // jendela Kam 5 Nov saja: batang Sari 2 🍅 dari skala 8 tetap 6.3 px
  pt = pm.render(Object.assign({}, p, { fromDn: dnOfIso("2026-11-05"), toDn: dnOfIso("2026-11-05") }));
  assert.equal(barD(pt, 2), "M1 21.8h10v6.3h-10Z");
  pm.unmount();
  assert.match(jsx, /React\.useMemo\(\(\) => [^\n]*loadScaleOf[^\n]*\[load\]\)/, "skala dihitung sekali per hasil beban (useMemo atas load)");
  h.m.unmount();
}));

test("Review T4–T6 I3: hari non-kerja abu (--text-secondary 12 %), berbeda dari area kapasitas (--bg-subtle + garis --border) dan bukan tint merah", () => {
  const off = css.match(/\.plg-timeline-load-off\s*\{([^}]*)\}/)[1];
  assert.match(off, /fill:\s*color-mix\(in srgb, var\(--text-secondary\) 12%, transparent\)/);
  assert.doesNotMatch(off, /danger|bg-subtle|stroke/);
  const cap = css.match(/\.plg-timeline-load-cap\s*\{([^}]*)\}/)[1];
  assert.match(cap, /fill:\s*var\(--bg-subtle\)/);
  assert.match(cap, /stroke:\s*var\(--border\)/);
});

test("Review T4–T6 I2: wadah grafik panel 'overflow: hidden; overflow: clip;' (clip tidak membuat wadah gulir; hidden cadangan); pengaman onScroll view panel → scrollLeft/scrollTop kembali 0", () => withEngineClock(async (clock) => {
  assert.match(css, /\.plg-timeline-load-view\s*\{[^}]*overflow:\s*hidden;\s*overflow:\s*clip;/);
  const h = await panelView(clock);
  const pm = mount(T.LoadPanel);
  const pt = pm.render(panelOf(h.tree).props);
  pm.flush();
  const view = byCls(pt, "plg-timeline-load-view")[0];
  assert.equal(typeof view.props.onScroll, "function");
  const ve = { scrollLeft: 37, scrollTop: 5 };
  view.props.ref.current = ve;
  view.props.onScroll({ currentTarget: ve });
  assert.deepEqual([ve.scrollLeft, ve.scrollTop], [0, 0], "gulir tak sengaja (fokus) direset");
  pm.unmount();
  h.m.unmount();
}));

test("Review T4–T6 I2: fokus (Tab) tombol hari merah — di luar [getLeft(), getLeft() + viewW] (kiri/kanan) → onShowDay(dn); di dalam layar → tidak; tombol tanpa onShowDay tidak melempar", () => withEngineClock(async (clock) => {
  const h = await panelView(clock);
  const p = panelOf(h.tree).props;
  assert.equal(typeof p.onShowDay, "function", "view menyediakan onShowDay (stabil)");
  const x = (iso) => (dnOfIso(iso) - p.rangeFrom) * p.px;
  const shown = [];
  let left = 0;
  const q = Object.assign({}, p, { getLeft: () => left, onShowDay: (dn) => shown.push(T.TLCal.iso(dn)) });
  const pm = mount(T.LoadPanel);
  const pt = pm.render(q);
  pm.flush();
  const focusHit = (label) => hitOf(pt, label).props.onFocus({ currentTarget: fakeFocus() });
  left = x("2026-11-10") + 1; // Sel 10 sedikit terpotong di kiri
  focusHit("Budi · Sel 10 Nov");
  left = x("2026-11-04") + p.px - 1000 - 1; // tepi kanan Rab 4 melewati layar 1 px
  focusHit("Budi · Rab 4 Nov");
  left = x("2026-11-04") + p.px - 1000; // tepat muat
  focusHit("Budi · Rab 4 Nov");
  left = x("2026-11-04") - 300;
  focusHit("Budi · Sen 9 Nov");
  assert.deepEqual(shown, ["2026-11-10", "2026-11-04"]);
  // fokus karena klik mouse/sentuh (bukan :focus-visible) → tanpa gulir (tombol tidak bergeser dari bawah pointer);
  // fokus keyboard (:focus-visible) → gulir; peramban tanpa :focus-visible (matches melempar) → anggap keyboard
  left = x("2026-11-10") + 1;
  const viaMatches = (fn) => hitOf(pt, "Budi · Sel 10 Nov").props.onFocus({ currentTarget: fakeFocus({ matches: fn }) });
  viaMatches((s) => (s === ":focus-visible" ? false : null));
  assert.equal(shown.length, 2, "fokus pointer → tanpa gulir");
  viaMatches((s) => s === ":focus-visible");
  viaMatches(() => { throw new Error("SyntaxError"); });
  assert.deepEqual(shown.slice(2), ["2026-11-10", "2026-11-10"]);
  pm.unmount();
  const pm2 = mount(T.LoadPanel);
  const pt2 = pm2.render(Object.assign({}, q, { onShowDay: undefined }));
  left = x("2026-11-10") + 50;
  hitOf(pt2, "Budi · Sel 10 Nov").props.onFocus({});
  pm2.unmount();
  h.m.unmount();
}));

test("Review T4–T6 I2: view onShowDay(dn) → wadah Gantt digulir lewat jalur applyLeft (hari di sepertiga kiri, translateX panel seketika, getLeft baru) sehingga panel ikut; event scroll susulan menjaga translateX; 0 tulis", () => withEngineClock(async (clock) => {
  const h = await panelView(clock);
  const el = fakeEl();
  h.tree = attach(h.m, h.props, h.tree, el);
  await settle();
  clock.frames();
  h.render();
  const node = panelOf(h.tree);
  const p = node.props;
  const track = { style: {} };
  p.trackRef.current = track;
  const pm = mount(T.LoadPanel);
  const pt = pm.render(p);
  pm.flush();
  const x = (iso) => (dnOfIso(iso) - p.rangeFrom) * p.px;
  // pengguna menggulir sehingga Sel 10 Nov di kiri layar (jendela dw belum berganti → tombolnya masih ada)
  el.scrollLeft = x("2026-11-10") + 50;
  hitOf(pt, "Budi · Sel 10 Nov").props.onFocus({ currentTarget: fakeFocus() });
  const want = Math.round(x("2026-11-10") - 1000 / 3);
  assert.equal(el.scrollLeft, want, "hari itu di sepertiga kiri wadah Gantt");
  assert.equal(track.style.transform, "translateX(-" + want + "px)", "panel ikut seketika");
  h.render();
  assert.equal(panelOf(h.tree).props.getLeft(), want);
  // event scroll asli menyusul (onScroll wadah Gantt) → translateX panel tetap sejajar
  gridOf(h.tree).props.onScroll();
  assert.equal(track.style.transform, "translateX(-" + want + "px)");
  pm.unmount();
  assert.deepEqual(h.writes, []);
  assert.equal(h.fr.calls.put.length, 0);
  h.m.unmount();
}));

test("Review T4–T6 I1a: klik/ketuk di grafik → (baris, hari) dipetakan seperti readout; hari merah TANPA tombol (di luar LOAD_HIT_MAX) → popover saran hari itu; klik hari sama → tutup; hari biasa → tidak membuka (yang terbuka ditutup); klik bertarget tombol hari merah diabaikan; Esc → fokus ke tombol 'Hari kelebihan beban'", () => {
  const x = heavyLoad("week");
  const pm = mount(T.LoadPanel);
  let pt = pm.render(x.props);
  pm.flush();
  const view = byCls(pt, "plg-timeline-load-view")[0];
  assert.equal(typeof view.props.onClick, "function");
  view.props.ref.current = { getBoundingClientRect: () => ({ left: 100, top: 50, width: 1000, height: 280 }) };
  const home = fakeFocus();
  daysBtnOf(pt).props.ref.current = home;
  const sl = x.props.getLeft();
  const px = x.props.px;
  const rf = x.props.rangeFrom;
  const none = { closest: () => null };
  const at = (i, dn, target) => ({ clientX: 100 + (dn - rf) * px - sl + 2, clientY: 50 + i * 28 + 5, target: target || none });
  const got = new Set(panelHits(pt).map((b) => b.props.style.top / 28 + ":" + (b.props.style.left / px + rf)));
  const vis = (d) => (d - rf) * px >= sl && (d - rf + 1) * px <= sl + 1000;
  const row = x.load.rows[0];
  const d = row.overDays.find((dd) => vis(dd) && !got.has("0:" + dd));
  assert.ok(d !== undefined, "ada hari merah tampak tanpa tombol");
  const click = (ev) => {
    view.props.onClick(ev);
    pt = pm.render(x.props);
    return sugOf(pt);
  };
  let sp = click(at(0, d));
  assert.ok(sp, "popover saran untuk hari merah tanpa tombol");
  assert.equal(sp.props.title, "Bisa digeser — " + row.name + ", " + T.TLCal.fmtShort(d));
  const want = T.TLLoad.suggest(x.load, row.uid, d, { result: x.result, units: x.ctx.units, readExt: x.ctx.readExt, tasks: x.ctx.tasks });
  assert.deepEqual(sp.props.items.map((s) => s.key), want.map((s) => s.key));
  assert.match(sp.props.skipSel, /\.plg-timeline-load-view/, "pointerdown di grafik tidak menutup (ditangani klik grafik)");
  // Esc → fokus ke tombol daftar (hari ini tanpa tombol)
  sp.props.onClose({ restoreFocus: true });
  pt = pm.render(x.props);
  assert.equal(sugOf(pt), undefined);
  assert.equal(home.focused, 1);
  // klik hari sama dua kali → buka lalu tutup
  assert.ok(click(at(0, d)));
  assert.equal(click(at(0, d)), undefined, "hari sama → tutup");
  // hari biasa (Sabtu tampak) → tidak membuka; popover terbuka → ditutup
  const sat = (() => { for (let k = x.dw.fromDn; k <= x.dw.toDn; k++) if (vis(k) && !T.TLCal.isWork(x.ctx.cal, k)) return k; return null; })();
  assert.ok(sat !== null && row.overDays.indexOf(sat) < 0);
  assert.equal(click(at(0, sat)), undefined, "hari biasa → tanpa popover");
  assert.ok(click(at(0, d)));
  assert.equal(click(at(0, sat)), undefined, "klik hari biasa menutup popover yang terbuka");
  // klik yang targetnya tombol hari merah: ditangani tombolnya (tidak membuka/menutup dua kali)
  const hitTarget = { closest: (s) => (s.split(",").some((t) => t.trim() === ".plg-timeline-load-hit") ? {} : null) };
  assert.equal(click(at(0, d, hitTarget)), undefined);
  assert.ok(click(at(0, d)));
  assert.ok(click(at(0, d, hitTarget)), "tetap terbuka");
  // di luar baris / jendela → abaikan
  assert.ok(click({ clientX: at(0, d).clientX, clientY: 50 + 10 * 28 + 5, target: none }), "di bawah baris terakhir: tanpa perubahan");
  pm.unmount();
});

test("Review T4–T6 I1b: judul panel desktop + tombol teks persis 'Hari kelebihan beban' (aria-expanded, aria-controls) → daftar yang SAMA dengan HP (teks item persis, ketuk → popover saran di item, Esc → fokus ke item, pilih → onReveal); dirender hanya saat terbuka; status di view; 0 tulis", () => withEngineClock(async (clock) => {
  const h = await panelView(clock);
  let node = panelOf(h.tree);
  assert.equal(node.props.daysOpen, false);
  assert.equal(typeof node.props.onDaysOpen, "function");
  const reveals = [];
  const props = () => Object.assign({}, node.props, { onReveal: (k, t) => reveals.push([k, t.id]) });
  const pm = mount(T.LoadPanel);
  let pt = pm.render(props());
  pm.flush();
  const btn = daysBtnOf(pt);
  assert.ok(btn, "tombol daftar");
  assert.deepEqual([btn.type, btn.props.type, txt(btn).trim(), btn.props["aria-expanded"]], ["button", "button", "Hari kelebihan beban", false]);
  const ctl = btn.props["aria-controls"];
  assert.match(ctl, /^plg-timeline-load-days-\d+$/);
  assert.equal(panelHead(pt), "Beban Tim · 6 hari kelebihan beban · 1 task belum dijadwalkan · 2 task bertarget bawaan 1 🍅", "teks judul tetap (tombol di luar <h3>)");
  assert.equal(byCls(pt, "plg-timeline-load-days").length, 0, "tertutup → daftar tidak dirender");
  assert.equal(byCls(pt, "plg-timeline-load-m-day").length + nodes(pt, (n) => n.type === "li").length, 0);
  const nClosed = domCount(pt);
  // buka → status di view (props), daftar setelah judul sebelum grafik
  daysBtnOf(pt).props.onClick({});
  h.render();
  node = panelOf(h.tree);
  assert.equal(node.props.daysOpen, true);
  pt = pm.render(props());
  assert.equal(daysBtnOf(pt).props["aria-expanded"], true);
  const box = byCls(pt, "plg-timeline-load-days")[0];
  assert.equal(box.props.id, ctl);
  const sec = nodes(pt, (n) => n.type === "section")[0];
  const kids = sec.children.filter((c) => c && typeof c === "object");
  assert.ok(kids.indexOf(box) > kids.findIndex((c) => hasCls(c, "plg-timeline-load-top")) && kids.indexOf(box) < kids.findIndex((c) => hasCls(c, "plg-timeline-load-body")), "judul · daftar · grafik");
  const days = () => byCls(pt, "plg-timeline-load-m-day");
  assert.deepEqual(days().map((b) => txt(b).trim()), PANEL_DAYS, "teks item = daftar HP");
  assert.ok(days().every((b) => b.type === "button" && b.props["aria-haspopup"] === "dialog" && b.props["aria-expanded"] === false));
  assert.ok(hasCls(nodes(box, (n) => n.type === "ul")[0], "plg-timeline-load-m-list"), "render daftar HP dipakai ulang");
  // ketuk item (Enter = klik tombol) → popover saran di dalam <li> item, bukan di tingkat panel
  const it = fakeFocus();
  days()[0].props.onClick({ currentTarget: it });
  pt = pm.render(props());
  const li0 = nodes(pt, (n) => n.type === "li")[0];
  const sp = nodes(li0, (n) => n.type === T.SuggestPopover)[0];
  assert.ok(sp, "popover di item");
  assert.equal(nodes(pt, (n) => n.type === T.SuggestPopover).length, 1, "satu popover");
  assert.equal(sp.props.title, "Bisa digeser — Budi, Rab 4 Nov");
  assert.equal(sp.props.left, undefined);
  assert.equal(days()[0].props["aria-expanded"], true);
  assert.equal(panelHits(pt)[0].props["aria-expanded"], false, "tombol grafik hari yang sama tidak ikut terbuka");
  sp.props.onClose({ restoreFocus: true });
  pt = pm.render(props());
  assert.equal(nodes(pt, (n) => n.type === T.SuggestPopover).length, 0);
  assert.equal(it.focused, 1, "Esc → fokus kembali ke item");
  // item → pilih baris saran → onReveal (pilih + gulir R7)
  days()[0].props.onClick({ currentTarget: it });
  pt = pm.render(props());
  const sp2 = sugOf(pt);
  sp2.props.onPick(sp2.props.items[0]);
  pt = pm.render(props());
  assert.deepEqual(reveals, [[sp2.props.items[0].key, sp2.props.items[0].task.id]]);
  assert.equal(sugOf(pt), undefined);
  // tutup daftar (popover item ikut tertutup) → kembali ke anggaran DOM semula
  days()[1].props.onClick({ currentTarget: it });
  pt = pm.render(props());
  assert.ok(sugOf(pt));
  daysBtnOf(pt).props.onClick({});
  h.render();
  node = panelOf(h.tree);
  assert.equal(node.props.daysOpen, false);
  pt = pm.render(props());
  assert.equal(byCls(pt, "plg-timeline-load-days").length, 0);
  assert.equal(sugOf(pt), undefined, "popover item tertutup bersama daftar");
  assert.equal(domCount(pt), nClosed);
  pm.unmount();
  assert.deepEqual(h.writes, []);
  assert.equal(h.fr.calls.put.length, 0);
  h.m.unmount();
}));

test("Review T4–T6 I1b: daftar desktop ≤ 100 item terdekat + 'dan {n} lainnya' (pola HP); tertutup → DOM panel tetap ≤ 300; n = 0 → tanpa tombol 'Hari kelebihan beban'", () => withEngineClock(async (clock) => {
  const x = heavyLoad("week");
  const pm = mount(T.LoadPanel);
  let pt = pm.render(x.props);
  pm.flush();
  assert.ok(daysBtnOf(pt));
  assert.ok(domCount(pt) <= 300, "tertutup: " + domCount(pt));
  pt = pm.render(Object.assign({}, x.props, { daysOpen: true }));
  const total = x.load.rows.reduce((s, r) => s + r.overDays.length, 0);
  const all = T.loadDayItems(x.load, x.ctx.cal);
  assert.deepEqual(byCls(pt, "plg-timeline-load-m-day").map((b) => txt(b).trim()), all.slice(0, 100).map((it) => it.text));
  assert.equal(txt(byCls(pt, "plg-timeline-load-m-more")[0]).trim(), "dan " + (total - 100) + " lainnya");
  console.log("# DOM panel Beban Tim 10 orang + daftar desktop terbuka: " + domCount(pt) + " elemen");
  pm.unmount();
  // n = 0
  const L = PANEL_L;
  const h = await panelView(clock, { tasks: [mk(1, "Ringan", { start: "2026-11-04", duration: 2 }, Object.assign({ assigned_to: 7, estimated_pomodoros: 2 }, L))] });
  const pm2 = mount(T.LoadPanel);
  const pt2 = pm2.render(Object.assign({}, panelOf(h.tree).props, { daysOpen: true }));
  assert.equal(panelHead(pt2), "Beban Tim · 0 hari kelebihan beban");
  assert.equal(daysBtnOf(pt2), undefined, "n = 0 → tanpa tombol");
  assert.equal(byCls(pt2, "plg-timeline-load-days").length, 0, "tanpa daftar");
  pm2.unmount();
  h.m.unmount();
}));

test("Review T4–T6 M1: popover saran max-height min(50vh, 320px) + gulir dalam; ruang di atas panel (getBoundingClientRect().top) < tinggi maks popover → membuka ke bawah (is-down), cukup → ke atas", () => withEngineClock(async (clock) => {
  const rule = css.match(/\.plg-timeline-load-pop\s*\{([^}]*)\}/)[1];
  assert.match(rule, /max-height:\s*min\(50vh, 320px\)/);
  assert.match(rule, /overflow-y:\s*auto/);
  assert.match(rule, /bottom:\s*100%/);
  assert.match(css, /\.plg-timeline-load-pop\.is-down\s*\{[^}]*top:\s*100%[^}]*bottom:\s*auto/);
  const h = await panelView(clock, { tasks: sugTasks(), records: sugRecords() });
  const prev = global.window;
  global.window = { innerHeight: 900, addEventListener() {}, removeEventListener() {} };
  try {
    const ph = sugPanel(h);
    const dlg = () => nodes(child(sugOf(ph.tree)), (n) => n.props.role === "dialog")[0];
    ph.props.boxRef.current = { clientWidth: TABLE_W_FULL + 1000, getBoundingClientRect: () => ({ top: 200 }) };
    ph.open("Budi · Rab 4 Nov");
    assert.equal(sugOf(ph.tree).props.down, true, "200 < min(450, 320)");
    assert.ok(hasCls(dlg(), "is-down"));
    ph.open("Budi · Rab 4 Nov");
    ph.props.boxRef.current = { clientWidth: TABLE_W_FULL + 1000, getBoundingClientRect: () => ({ top: 400 }) };
    ph.open("Budi · Rab 4 Nov");
    assert.equal(sugOf(ph.tree).props.down, false);
    assert.ok(!hasCls(dlg(), "is-down"));
    ph.open("Budi · Rab 4 Nov");
    global.window.innerHeight = 500; // layar pendek: maks 250
    ph.props.boxRef.current = { clientWidth: TABLE_W_FULL + 1000, getBoundingClientRect: () => ({ top: 300 }) };
    ph.open("Citra · Rab 4 Nov");
    assert.equal(sugOf(ph.tree).props.down, false);
    ph.pm.unmount();
  } finally {
    global.window = prev;
  }
  h.m.unmount();
}));

test("Review T4–T6 M2: tinggi wadah Gantt diukur ulang saat daftar desktop 'Hari kelebihan beban' dibuka/ditutup dan saat teks judul panel berubah (jumlah baris tetap)", () => withEngineClock(async (clock) => {
  const prevWin = global.window;
  global.window = { innerHeight: 1200, addEventListener() {}, removeEventListener() {} };
  try {
    const v = await panelView(clock);
    const el = fakeEl();
    let tree = attach(v.m, v.props, v.tree, el);
    const box = panelOf(tree).props.boxRef;
    box.current = { offsetHeight: 200 };
    panelOf(tree).props.onDaysOpen(true);
    box.current = { offsetHeight: 520 };
    tree = attach(v.m, v.props, v.m.render(v.props), el);
    assert.equal(gridOf(tree).props.style.height, 1200 - 100 - 16 - 520, "daftar dibuka");
    panelOf(tree).props.onDaysOpen(false);
    box.current = { offsetHeight: 200 };
    tree = attach(v.m, v.props, v.m.render(v.props), el);
    assert.equal(gridOf(tree).props.style.height, 1200 - 100 - 16 - 200, "daftar ditutup");
    // judul berubah (kapasitas Budi 8 dari perangkat lain → 2 hari kelebihan beban), baris tetap 4
    box.current = { offsetHeight: 180 };
    putRec(v.fr, resRec(12, 9, { capacity: 8 }));
    v.fr.emit({ entity: "resource", ids: ["res@list:12:9"], source: "sync" });
    tree = await v.again();
    tree = attach(v.m, v.props, tree, el);
    assert.equal(panelOf(tree).props.load.rows.length, 4);
    assert.equal(T.loadHeadText(panelOf(tree).props.load), "Beban Tim · 2 hari kelebihan beban · 1 task belum dijadwalkan · 2 task bertarget bawaan 1 🍅");
    assert.equal(gridOf(tree).props.style.height, 1200 - 100 - 16 - 180, "judul berubah → ukur ulang");
    assert.deepEqual(v.writes, []);
    v.m.unmount();
  } finally {
    global.window = prevWin;
  }
}));

test("Review T4–T6 M3: popover saran menutup sendiri (hari tak lagi merah) → fokus ke tombol 'Hari kelebihan beban'; tanpa tombol (n = 0) → judul panel (tabIndex −1); pemicu terlepas → Esc ke tombol daftar; fokus di tempat lain (document.activeElement bukan body) tidak dicuri", () => withEngineClock(async (clock) => {
  const h = await panelView(clock, { tasks: sugTasks(), records: sugRecords() });
  const ph = sugPanel(h);
  assert.equal(headOf(ph.tree).props.tabIndex, -1);
  const home = fakeFocus();
  const headEl = fakeFocus();
  daysBtnOf(ph.tree).props.ref.current = home;
  headOf(ph.tree).props.ref.current = headEl;
  const base = ph.props;
  const dn4 = dnOfIso("2026-11-04");
  const without = (pred) => Object.assign({}, base, { load: Object.assign({}, base.load, { rows: base.load.rows.map((r) => Object.assign({}, r, { overDays: r.overDays.filter((d) => !pred(r, d)) })) }) });
  // (1) pemicu terlepas (dipasang ulang/jendela berganti) → Esc → tombol daftar
  const gone = fakeFocus({ isConnected: false });
  hitOf(ph.tree, "Budi · Rab 4 Nov").props.onClick({ currentTarget: gone });
  ph.render();
  sugOf(ph.tree).props.onClose({ restoreFocus: true });
  ph.render();
  assert.deepEqual([gone.focused, home.focused], [0, 1]);
  // (2) menutup sendiri: Rab 4 Budi tidak lagi merah → tombol daftar
  const b2 = ph.open("Budi · Rab 4 Nov");
  ph.props = without((r, d) => r.uid === 9 && d === dn4);
  ph.render();
  ph.pm.flush();
  ph.render();
  assert.equal(sugOf(ph.tree), undefined);
  assert.deepEqual([b2.focused, home.focused, headEl.focused], [0, 2, 0]);
  // (3) fokus sudah di tempat lain → tidak dicuri
  ph.props = base;
  ph.render();
  ph.open("Budi · Rab 4 Nov");
  const prevDoc = global.document;
  global.document = { body: {}, activeElement: { isConnected: true } };
  try {
    ph.props = without((r, d) => r.uid === 9 && d === dn4);
    ph.render();
    ph.pm.flush();
    ph.render();
    assert.equal(sugOf(ph.tree), undefined);
    assert.equal(home.focused, 2, "fokus di elemen lain → tetap");
    // fokus jatuh ke body (popover dilepas) → dipindah
    ph.props = base;
    ph.render();
    ph.open("Budi · Rab 4 Nov");
    global.document.activeElement = global.document.body;
    ph.props = without((r, d) => r.uid === 9 && d === dn4);
    ph.render();
    ph.pm.flush();
    ph.render();
    assert.equal(home.focused, 3);
  } finally {
    if (prevDoc === undefined) delete global.document; else global.document = prevDoc;
  }
  // (4) hari merah terakhir hilang (n = 0 → tombol daftar tidak dirender) → judul panel
  ph.props = base;
  ph.render();
  ph.open("Budi · Rab 4 Nov");
  ph.props = without(() => true);
  ph.render();
  ph.pm.flush();
  ph.render();
  assert.equal(daysBtnOf(ph.tree), undefined);
  assert.deepEqual([home.focused, headEl.focused], [3, 1]);
  ph.pm.unmount();
  h.m.unmount();
}));

test("Review T4–T6 M4: tombol hari merah aria-haspopup='dialog' + aria-expanded true hanya saat popover-nya terbuka", () => withEngineClock(async (clock) => {
  const h = await panelView(clock, { tasks: sugTasks(), records: sugRecords() });
  const ph = sugPanel(h);
  const ex = () => panelHits(ph.tree).map((b) => [b.props["aria-haspopup"], b.props["aria-expanded"]]);
  assert.deepEqual(ex(), [["dialog", false], ["dialog", false]]);
  ph.open("Budi · Rab 4 Nov");
  assert.deepEqual(ex(), [["dialog", true], ["dialog", false]]);
  ph.open("Citra · Rab 4 Nov");
  assert.deepEqual(ex(), [["dialog", false], ["dialog", true]]);
  ph.open("Citra · Rab 4 Nov");
  assert.deepEqual(ex(), [["dialog", false], ["dialog", false]]);
  ph.pm.unmount();
  h.m.unmount();
}));

test("Review T4–T6 M5: revealRow memfokuskan bar (role button, data-key) dengan preventScroll; baris tanpa bar (span null) → baris tabel (role row, tabIndex −1) dengan preventScroll", () => withEngineClock(async (clock) => {
  const h = await panelView(clock, { tasks: sugTasks(), records: sugRecords() });
  const el = fakeEl();
  const focused = [];
  const fake = (key, role) => ({ getAttribute: (a) => (a === "data-key" ? key : a === "role" ? role : null), focus: (o) => focused.push([key, role, o]) });
  el.querySelectorAll = (sel) => (sel === "[data-key]" ? [fake("2", "row"), fake("2", "button"), fake("8", "row")] : []);
  h.tree = attach(h.m, h.props, h.tree, el);
  await settle();
  clock.frames();
  h.render();
  const p = panelOf(h.tree).props;
  p.onReveal("2", h.tasks.find((t) => t.id === 2));
  clock.frames();
  assert.deepEqual(focused, [["2", "button", { preventScroll: true }]], "bar diutamakan");
  p.onReveal("8", h.tasks.find((t) => t.id === 8));
  clock.frames();
  assert.deepEqual(focused[1], ["8", "row", { preventScroll: true }], "tanpa bar → baris tabel");
  h.render();
  assert.equal(rowOf(h.tree, "8").props.tabIndex, -1, "baris task dapat difokus skrip");
  assert.equal(focused.length, 2);
  assert.deepEqual(h.writes, []);
  h.m.unmount();
}));

test("Review T4–T6 M7: tombol Beban Tim cukup bersyarat engReady (mode Daftar hanya ≤ 640 px) — perilaku tetap", () => {
  assert.match(jsx, /if \(v\.engReady\) extras\.push\(\{ id: "load"/);
  assert.doesNotMatch(jsx, /v\.engReady && \(gantt \|\| v\.narrow\)/);
});

// ════════════════════════════════════════════════════════════════════════════
// Fase 1 PR 1d-1 — perbaikan review T7–T8: editor kapasitas (baris cuti kosong netral, fokus, busy, STALE beku,
// aria-describedby) + chip orang HP dibatasi
// ════════════════════════════════════════════════════════════════════════════
const dateInvalid = (tree) => inputsOf(tree, "date").map((i) => i.props["aria-invalid"]);
const alertNode = (tree, s) => nodes(tree, (n) => n.props.role === "alert" && txt(n).trim() === s)[0];

test("Review T7–T8 I: baris cuti kosong total (dari, sampai, catatan kosong) netral — bukan galat, Simpan tetap aktif, dibuang saat simpan; terisi sebagian (satu tanggal / catatan saja) tetap 'Periksa tanggal cuti' hanya untuk baris itu", () => withPop(async () => {
  // resFormCheck murni: kosong total (catatan spasi saja = kosong) bukan galat; sebagian = galat
  const chk = T.resFormCheck({ cap: "8", rows: [
    { k: 1, from: "", to: "", note: "" }, { k: 2, from: "2026-11-10", to: "", note: "" }, { k: 3, from: "", to: "", note: "Mudik" },
    { k: 4, from: "2026-11-10", to: "2026-11-11", note: "" }, { k: 5, from: "", to: "", note: "   " }, { k: 6, from: "", to: "2026-11-10", note: "" },
  ] });
  assert.deepEqual([...chk.bad].sort((a, b) => a - b), [2, 3, 6]);
  assert.equal(chk.dateBad, true);
  const blank = T.resFormCheck({ cap: "8", rows: [{ k: 1, from: "", to: "", note: "" }, { k: 2, from: "", to: "", note: " " }] });
  assert.deepEqual([blank.bad.size, blank.dateBad], [0, false]);
  // editor: dua baris baru kosong → netral
  const h = edSetup();
  capIn(h.tree).props.onChange(chg("5"));
  h.render();
  buttonByText(h.tree, "Tambah cuti").props.onClick({});
  h.render();
  buttonByText(h.tree, "Tambah cuti").props.onClick({});
  h.render();
  assert.equal(saveBtn(h.tree).props.disabled, false, "baris kosong tidak menonaktifkan Simpan");
  assert.deepEqual(alerts(h.tree), [], "tanpa pesan galat untuk baris kosong");
  assert.deepEqual(dateInvalid(h.tree), [false, false, false, false]);
  // baris kedua terisi sebagian → galat hanya baris itu
  inputsOf(h.tree, "date")[2].props.onChange(chg("2026-11-10"));
  h.render();
  assert.equal(saveBtn(h.tree).props.disabled, true);
  assert.deepEqual(alerts(h.tree), [RES_DATE_BAD]);
  assert.deepEqual(dateInvalid(h.tree), [false, false, true, true]);
  saveBtn(h.tree).props.onClick({});
  // dikosongkan lagi → netral lagi
  inputsOf(h.tree, "date")[2].props.onChange(chg(""));
  h.render();
  assert.deepEqual(alerts(h.tree), []);
  assert.equal(saveBtn(h.tree).props.disabled, false);
  // catatan saja tanpa tanggal = terisi sebagian → galat baris pertama
  notesOf(h.tree)[0].props.onChange(chg("Mudik"));
  h.render();
  assert.deepEqual(alerts(h.tree), [RES_DATE_BAD]);
  assert.deepEqual(dateInvalid(h.tree), [true, true, false, false]);
  notesOf(h.tree)[0].props.onChange(chg(""));
  h.render();
  // baris kedua lengkap, baris pertama kosong total → Simpan: baris kosong dibuang dari value
  inputsOf(h.tree, "date")[2].props.onChange(chg("2026-11-10"));
  h.render();
  inputsOf(h.tree, "date")[3].props.onChange(chg("2026-11-11"));
  h.render();
  assert.deepEqual(alerts(h.tree), []);
  assert.equal(h.fr.calls.put.length + h.fr.calls.get.length, 0, "klik saat galat → tanpa baca/tulis");
  saveBtn(h.tree).props.onClick({});
  await settle();
  await settle();
  assert.deepEqual(resPuts(h.fr), [["resource", "res@list:12:9", { v: 1, capacity: 5, leave: [{ from: "2026-11-10", to: "2026-11-11", note: "" }], by: 7 }, { scope: "list:12" }]]);
  h.m.unmount();
  // hanya baris kosong → leave []
  const g = edSetup();
  buttonByText(g.tree, "Tambah cuti").props.onClick({});
  g.render();
  saveBtn(g.tree).props.onClick({});
  await settle();
  await settle();
  assert.deepEqual(resPuts(g.fr).map((p) => p[2]), [{ v: 1, capacity: 8, leave: [], by: 7 }]);
  g.m.unmount();
}));

test("Review T7–T8 m: setelah 'Muat ulang' atau galat simpan, fokus kembali ke akar dialog bila elemen yang fokus jadi nonaktif/hilang; fokus di elemen yang masih aktif tidak dicuri", () => withPop(async () => {
  const prevDoc = global.document;
  const body = {};
  global.document = { body, activeElement: body };
  try {
    // STALE: tombol Simpan yang fokus menjadi nonaktif → akar dialog
    const fr = fakeRecords();
    putRec(fr, resRec(12, 9, { capacity: 6 }));
    const h = edSetup({ records: fr, res: { map: await mapOf(fr) } });
    const f0 = h.rootEl.focused;
    assert.equal(f0, 1, "fokus saat dibuka");
    capIn(h.tree).props.onChange(chg("3"));
    h.render();
    h.flush();
    assert.equal(h.rootEl.focused, f0, "mengetik tidak memindah fokus");
    putRec(fr, resRec(12, 9, { capacity: 4 }, { updated_at: "2026-11-06T03:00:00Z" }));
    const saveEl = { isConnected: true, disabled: false };
    global.document.activeElement = saveEl;
    saveBtn(h.tree).props.onClick({});
    h.render();
    saveEl.disabled = true; // tombol yang fokus dinonaktifkan selama menyimpan, tetap nonaktif (STALE)
    await settle();
    await settle();
    h.render();
    h.flush();
    assert.ok(alerts(h.tree).indexOf(RES_STALE) >= 0);
    assert.equal(saveBtn(h.tree).props.disabled, true);
    assert.equal(h.rootEl.focused, f0 + 1, "Simpan nonaktif → fokus ke akar dialog");
    // Muat ulang: tombolnya hilang setelah selesai (elemen terlepas) → akar dialog
    const reloadEl = { isConnected: true, disabled: false };
    global.document.activeElement = reloadEl;
    buttonByText(h.tree, "Muat ulang").props.onClick({});
    h.render();
    h.flush();
    assert.equal(h.rootEl.focused, f0 + 1, "selama memuat ulang belum dipindah");
    reloadEl.isConnected = false;
    await settle();
    await settle();
    h.render();
    h.flush();
    assert.equal(buttonByText(h.tree, "Muat ulang"), undefined);
    assert.equal(capIn(h.tree).props.value, "4");
    assert.equal(h.rootEl.focused, f0 + 2, "Muat ulang hilang → fokus ke akar dialog");
    h.render();
    h.flush();
    assert.equal(h.rootEl.focused, f0 + 2, "sekali saja");
    h.m.unmount();
    // galat simpan lain: fokus jatuh ke body → akar; Simpan aktif kembali dan masih fokus → tidak dicuri
    for (const [active, want] of [[body, 1], [{ isConnected: true, disabled: false }, 0], [null, 1]]) {
      const g = edSetup();
      g.set({ store: { save: () => Promise.reject(Object.assign(new Error("x"), { code: "IDB" })), get: () => Promise.resolve(null) } });
      const before = g.rootEl.focused;
      global.document.activeElement = active;
      saveBtn(g.tree).props.onClick({});
      await settle();
      await settle();
      g.render();
      g.flush();
      assert.deepEqual(g.calls.toast, [["Gagal menyimpan kapasitas", "error"]]);
      assert.equal(g.rootEl.focused - before, want, "aktif = " + JSON.stringify(active));
      g.m.unmount();
    }
    // galat inline TOO_LARGE dengan fokus di Simpan yang aktif lagi → tidak dicuri
    const t = edSetup();
    t.set({ store: { save: () => Promise.reject(Object.assign(new Error("x"), { code: "TOO_LARGE" })), get: () => Promise.resolve(null) } });
    const b0 = t.rootEl.focused;
    global.document.activeElement = { isConnected: true, disabled: false };
    saveBtn(t.tree).props.onClick({});
    await settle();
    await settle();
    t.render();
    t.flush();
    assert.deepEqual(alerts(t.tree), [T.MSG_RES_TOO_LARGE]);
    assert.equal(t.rootEl.focused, b0);
    t.m.unmount();
  } finally {
    if (prevDoc === undefined) delete global.document; else global.document = prevDoc;
  }
}));

test("Review T7–T8 m: selama menyimpan (put berjalan) Batal dan × nonaktif dan Esc diabaikan (tanpa onClose, propagasi tetap dihentikan); selesai gagal → aktif lagi dan Esc menutup", () => withPop(async (w) => {
  const h = edSetup();
  let rej = null;
  h.set({ store: { save: () => new Promise((_, r) => { rej = r; }), get: () => Promise.resolve(null) } });
  assert.equal(buttonByText(h.tree, "Batal").props.disabled, false);
  assert.equal(btnsByLabel(h.tree, "Tutup")[0].props.disabled, false);
  saveBtn(h.tree).props.onClick({});
  await settle();
  h.render();
  assert.ok(typeof rej === "function", "put berjalan");
  assert.equal(buttonByText(h.tree, "Batal").props.disabled, true, "Batal nonaktif");
  assert.equal(btnsByLabel(h.tree, "Tutup")[0].props.disabled, true, "× nonaktif");
  let stopped = 0;
  w.fire("keydown", { key: "Escape", preventDefault() {}, stopPropagation() { stopped++; } });
  // pemanggilan langsung (mis. klik yang lolos sebelum render) juga diabaikan
  buttonByText(h.tree, "Batal").props.onClick({});
  btnsByLabel(h.tree, "Tutup")[0].props.onClick({});
  assert.deepEqual(h.closes, [], "tidak ditutup selama menyimpan");
  assert.equal(stopped, 1, "Esc tidak diteruskan ke modal/Live Edit host");
  rej(Object.assign(new Error("x"), { code: "IDB" }));
  await settle();
  await settle();
  h.render();
  assert.equal(buttonByText(h.tree, "Batal").props.disabled, false);
  assert.equal(btnsByLabel(h.tree, "Tutup")[0].props.disabled, false);
  w.fire("keydown", { key: "Escape", preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(h.closes, [{ restoreFocus: true }]);
  assert.equal(h.fr.calls.put.length, 0);
  h.m.unmount();
  // selama "Muat ulang" (baca) juga sibuk: Batal nonaktif
  const fr = fakeRecords();
  putRec(fr, resRec(12, 9, { capacity: 6 }));
  const g = edSetup({ records: fr, res: { map: await mapOf(fr) } });
  putRec(fr, resRec(12, 9, { capacity: 4 }, { updated_at: "2026-11-06T03:00:00Z" }));
  saveBtn(g.tree).props.onClick({});
  await settle();
  await settle();
  g.render();
  buttonByText(g.tree, "Muat ulang").props.onClick({});
  g.render();
  assert.equal(buttonByText(g.tree, "Batal").props.disabled, true);
  await settle();
  await settle();
  g.render();
  assert.equal(buttonByText(g.tree, "Batal").props.disabled, false);
  g.m.unmount();
}));

test("Review T7–T8 m: STALE → isian dibekukan (kapasitas, tanggal, catatan, Hapus cuti, Tambah cuti nonaktif; perubahan diabaikan) sampai 'Muat ulang'; Muat ulang dan Batal tetap aktif; aria-busy hanya saat memuat/menyimpan", () => withPop(async () => {
  const fr = fakeRecords();
  putRec(fr, resRec(12, 9, { capacity: 6, leave: [{ from: "2026-11-09", to: "2026-11-10", note: "Cuti" }] }));
  const h = edSetup({ records: fr, res: { map: await mapOf(fr) } });
  const frozen = (t) => [capIn(t).props.disabled, ...inputsOf(t, "date").map((i) => i.props.disabled), ...notesOf(t).map((i) => i.props.disabled),
    ...btnsByLabel(t, "Hapus cuti").map((b) => b.props.disabled), buttonByText(t, "Tambah cuti").props.disabled];
  assert.ok(frozen(h.tree).every((d) => d === false), "awal: aktif");
  assert.equal(dlgNode(h.tree).props["aria-busy"], false);
  capIn(h.tree).props.onChange(chg("3"));
  h.render();
  putRec(fr, resRec(12, 9, { capacity: 4, leave: [] }, { updated_at: "2026-11-06T03:00:00Z" }));
  saveBtn(h.tree).props.onClick({});
  h.render();
  assert.equal(dlgNode(h.tree).props["aria-busy"], true, "menyimpan");
  await settle();
  await settle();
  h.render();
  assert.ok(alerts(h.tree).indexOf(RES_STALE) >= 0);
  assert.ok(frozen(h.tree).every((d) => d === true), "STALE: semua isian beku");
  assert.equal(dlgNode(h.tree).props["aria-busy"], false, "STALE bukan sedang memuat");
  assert.equal(buttonByText(h.tree, "Muat ulang").props.disabled, false);
  assert.equal(buttonByText(h.tree, "Batal").props.disabled, false);
  // perubahan diabaikan selama beku
  capIn(h.tree).props.onChange(chg("9"));
  notesOf(h.tree)[0].props.onChange(chg("X"));
  buttonByText(h.tree, "Tambah cuti").props.onClick({});
  btnsByLabel(h.tree, "Hapus cuti")[0].props.onClick({});
  h.render();
  assert.equal(capIn(h.tree).props.value, "3");
  assert.deepEqual(notesOf(h.tree).map((i) => i.props.value), ["Cuti"]);
  assert.deepEqual(dateVals(h.tree), ["2026-11-09", "2026-11-10"]);
  assert.ok(alerts(h.tree).indexOf(RES_STALE) >= 0, "pesan STALE tetap");
  // Muat ulang → cair, nilai terbaru
  buttonByText(h.tree, "Muat ulang").props.onClick({});
  await settle();
  await settle();
  h.render();
  assert.ok(frozen(h.tree).every((d) => d === false), "setelah Muat ulang: aktif");
  assert.equal(capIn(h.tree).props.value, "4");
  assert.equal(saveBtn(h.tree).props.disabled, false);
  assert.equal(h.fr.calls.put.length, 0);
  h.m.unmount();
}));

test("Review T7–T8 m: input kapasitas/tanggal yang aria-invalid → aria-describedby = id paragraf galatnya (unik per editor); sah atau baris kosong → tanpa aria-describedby", () => withPop(async () => {
  const h = edSetup();
  assert.equal(capIn(h.tree).props["aria-describedby"], undefined);
  capIn(h.tree).props.onChange(chg("41"));
  h.render();
  const capErr = alertNode(h.tree, RES_CAP_BAD);
  assert.ok(capErr && typeof capErr.props.id === "string" && /^plg-timeline-/.test(capErr.props.id), "paragraf galat kapasitas ber-id");
  assert.equal(capIn(h.tree).props["aria-invalid"], true);
  assert.equal(capIn(h.tree).props["aria-describedby"], capErr.props.id);
  buttonByText(h.tree, "Tambah cuti").props.onClick({});
  h.render();
  buttonByText(h.tree, "Tambah cuti").props.onClick({});
  h.render();
  inputsOf(h.tree, "date")[0].props.onChange(chg("2026-11-10"));
  h.render();
  const dateErr = alertNode(h.tree, RES_DATE_BAD);
  assert.ok(dateErr && typeof dateErr.props.id === "string" && /^plg-timeline-/.test(dateErr.props.id));
  assert.notEqual(dateErr.props.id, capErr.props.id);
  assert.deepEqual(inputsOf(h.tree, "date").map((i) => i.props["aria-describedby"]), [dateErr.props.id, dateErr.props.id, undefined, undefined], "baris kosong tanpa rujukan galat");
  assert.equal(notesOf(h.tree)[0].props["aria-describedby"], undefined);
  // diperbaiki → rujukan hilang bersama galatnya
  capIn(h.tree).props.onChange(chg("6"));
  h.render();
  inputsOf(h.tree, "date")[1].props.onChange(chg("2026-11-12"));
  h.render();
  assert.deepEqual(alerts(h.tree), []);
  assert.equal(capIn(h.tree).props["aria-describedby"], undefined);
  assert.deepEqual(inputsOf(h.tree, "date").map((i) => i.props["aria-describedby"]), [undefined, undefined, undefined, undefined]);
  // editor kedua → id lain (dua editor bisa ada di dokumen yang sama: panel desktop + daftar HP)
  const g = edSetup();
  capIn(g.tree).props.onChange(chg(""));
  g.render();
  const capErr2 = alertNode(g.tree, RES_CAP_BAD);
  assert.notEqual(capErr2.props.id, capErr.props.id);
  assert.equal(capIn(g.tree).props["aria-describedby"], capErr2.props.id);
  h.m.unmount();
  g.m.unmount();
}));

test("Review T7–T8 m: chip orang HP dibatasi 30 (urutan baris) + 'dan {n} lainnya' (pola daftar item); ≤ 30 → tanpa teks lainnya; DOM tetap kecil", () => {
  assert.equal(T.LOAD_M_PEOPLE_MAX, 30);
  const cal = T.TLCal.compile(T.TLCal.DEFAULT_CAL);
  const ctx = { tasks: [], cal, units: new Map(), readExt: () => ({}) };
  const result = T.TLCpm.run(ctx);
  const mkLoad = (n) => T.TLLoad.run({
    tasks: [], cal, readExt: ctx.readExt, result, units: ctx.units, byAssignee: true, ownerUid: 1, D: dnOfIso(TODAY),
    people: Array.from({ length: n }, (_, i) => ({ uid: i + 1, name: "Orang " + String(i + 1).padStart(2, "0"), res: null })),
  });
  const render = (load) => {
    const lm = mount(T.LoadList);
    const lt = lm.render({ load, cal, result, ctx, pageKind: "workspace", boxRef: { current: null }, editUid: null, onEditPerson() {}, res: null, onReveal() {} });
    lm.flush();
    return { lm, lt };
  };
  const a = render(mkLoad(35));
  const chips = mChips(a.lt);
  assert.equal(chips.length, 30);
  assert.deepEqual(chips.map((b) => txt(b).trim()), Array.from({ length: 30 }, (_, i) => "Orang " + String(i + 1).padStart(2, "0") + " · 8 🍅/hari"));
  const more = byCls(a.lt, "plg-timeline-load-m-pmore");
  assert.equal(more.length, 1);
  assert.equal(txt(more[0]).trim(), "dan 5 lainnya");
  const box = byCls(a.lt, "plg-timeline-load-m-people")[0];
  assert.ok(nodes(box, (n) => n === more[0]).length === 1, "teks lainnya di baris chip");
  assert.equal(byCls(a.lt, "plg-timeline-load-m-more").length, 0, "bukan teks lainnya daftar hari");
  assert.ok(domCount(a.lt) <= 40, "DOM daftar HP 35 orang: " + domCount(a.lt));
  a.lm.unmount();
  const b = render(mkLoad(30));
  assert.equal(mChips(b.lt).length, 30);
  assert.equal(byCls(b.lt, "plg-timeline-load-m-pmore").length, 0);
  b.lm.unmount();
  // CSS teks lainnya di baris chip: token saja
  const m = css.match(/\.plg-timeline-load-m-pmore\s*\{([^}]*)\}/);
  assert.ok(m, "aturan .plg-timeline-load-m-pmore");
  assert.match(m[1], /color:\s*var\(--text-secondary\)/);
  assert.doesNotMatch(m[1], /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
});

// ════════════════════════════════════════════════════════════════════════════
// Fase 1 PR 1d-1 — Task 9: integrasi + anggaran (pola R24 1c-1 Task 13). Integrasi api.records nyata + sinkron ada di
// timeline_runtime.test.js; DOM 500/400/10 orang ≤ 1.500 = tes "T5 DOM total …" di atas (dirujuk).
// ════════════════════════════════════════════════════════════════════════════
test("1d-1 T9 (R24): render awal dengan pref load ON (+ Jalur kritis) → tanpa TLCpm.run dan TLLoad.run sebelum frame pertama; panel/tombol Beban Tim baru muncul setelah mesin (raf + setTimeout 0) → tepat 1 run beban; 0 tulis", () => withEngineClock(async (clock) => {
  const tasks = bigTasks(500, 400).map((t, i) => Object.assign(t, { list_id: 12, assigned_to: 1 + (i % 10) }));
  const fr = fakeRecords();
  for (let k = 0; k < 5; k++) putRec(fr, unitRec(12, "P" + k));
  const { api, calls } = fakeApi({ records: fr, storageGet: (k) => Promise.resolve(k === "crit:slist_12" || k === "load:slist_12" ? true : null) });
  api.env.userId = 1;
  api.data = { tasks: { list: () => Promise.resolve(tasks) } };
  const writes = spyWrites(api);
  const { ctx } = ctxOf(tasks, { page: "slist_12", pageKind: "workspace", listId: 12, projectName: null });
  const props = { context: ctx, api };
  const spy = spyRun();
  const ls = spyLoad();
  try {
    const m = mount(T.TimelineViewBody);
    let tree = m.render(props);
    assert.deepEqual([spy.runs.length, ls.runs.length], [0, 0], "render pertama tanpa mesin dan tanpa beban");
    assert.ok(domCount(tree) > 0, "tabel/grafik langsung tergambar");
    m.flush();
    await settle();
    tree = m.render(props); // pref terbaca (load ON), daftar + unit + kapasitas termuat; mesin dijadwalkan
    m.flush();
    await settle();
    tree = m.render(props);
    assert.ok(calls.storageGet.indexOf("load:slist_12") >= 0, "pref load dibaca");
    assert.deepEqual([spy.runs.length, ls.runs.length], [0, 0], "belum ada hitung sebelum gambar pertama");
    assert.equal(panelOf(tree), undefined, "panel belum dirender sebelum mesin siap (R2)");
    assert.equal(loadBtnOf(tree), undefined, "tombol Beban Tim belum tampil (R10)");
    assert.ok(clock.frames() >= 1, "raf terjadwal");
    assert.deepEqual([spy.runs.length, ls.runs.length], [0, 0], "raf hanya menjadwalkan setTimeout 0");
    clock.tick(0);
    assert.equal(spy.runs.length, 1, "mesin jalan setelah raf + setTimeout");
    assert.equal(ls.runs.length, 0, "beban dihitung saat render (useLoad), bukan di penjadwal mesin");
    tree = m.render(props);
    m.flush();
    await settle();
    tree = m.render(props);
    assert.equal(ls.runs.length, 1, "tepat satu run beban setelah mesin siap");
    assert.equal(ls.runs[0].input.result, spy.runs[0].result, "beban memakai hasil mesin yang sama");
    assert.ok(panelOf(tree), "panel Beban Tim tampil");
    assert.equal(loadBtnOf(tree).props["aria-pressed"], true);
    assert.deepEqual(writes, [], "0 tulisan latar");
    assert.equal(fr.calls.put.length + fr.calls.remove.length, 0);
    m.unmount();
  } finally {
    ls.restore();
    spy.restore();
  }
}));

// ════════════════════════════════════════════════════════════════════════════
// Fase 1 PR 1d-1 — perbaikan review akhir: Beban Tim tampil saat dinyalakan lewat gestur (I1, terutama HP), tanpa kilatan
// kapasitas bawaan (useLoad menunggu data kapasitas), showDay membaca lebar view langsung, fokus cadangan daftar HP, editor
// kapasitas desktop membuka ke bawah bila ruang di atas panel kurang.
// ════════════════════════════════════════════════════════════════════════════
// Akar panel/daftar palsu: mencatat scrollIntoView (opsi apa adanya). React memasang ref akar saat panel ada di pohon dan
// mengosongkannya saat panel dilepas — disimulasikan revealStep (komponen panel tidak dirender oleh view palsu).
const revealBox = () => ({ calls: [], offsetHeight: 0, scrollIntoView(o) { this.calls.push(o); } });
async function revealStep(h, clock, box, nodeOf) {
  h.render();
  const n = nodeOf(h.tree);
  if (n) {
    h.boxRef = n.props.boxRef;
    n.props.boxRef.current = box;
  } else if (h.boxRef) h.boxRef.current = null;
  h.m.flush();
  await settle();
  clock.frames();
  clock.tick(300);
  await settle();
}
const revealSteps = async (h, clock, box, nodeOf, k) => { for (let i = 0; i < (k || 4); i++) await revealStep(h, clock, box, nodeOf); };
const loadMoreItem = (tree) => moreOf(tree).props.items.find((x) => x.text === "Beban Tim");

test("Review akhir I1: menyalakan Beban Tim lewat tombol toolbar → setelah panel desktop terpasang akarnya digulir ke layar TEPAT 1× (scrollIntoView {block: 'nearest'}, sesudah frame); sebelum terpasang (kapasitas dimuat) 0; render ulang / sinkron / frame berikut 0; mematikan 0; menyalakan lagi +1; 0 tulis", () => withEngineClock(async (clock) => {
  const h = await panelView(clock, { loadOff: true });
  assert.equal(panelOf(h.tree), undefined, "pref OFF");
  const box = revealBox();
  // efek pasif render terakhir panelView (loadOn false) masih tertunda dan baru berjalan SESUDAH klik — seperti React yang
  // menjalankan efek commit sebelumnya sebelum render berikut; penanda tidak boleh dilepas olehnya
  loadBtnOf(h.tree).props.onClick({});
  h.render();
  assert.equal(panelOf(h.tree), undefined, "kapasitas belum termuat → panel belum terpasang");
  h.m.flush();
  clock.frames();
  assert.equal(box.calls.length, 0, "belum terpasang → tanpa gulir");
  await revealSteps(h, clock, box, panelOf);
  assert.ok(panelOf(h.tree), "panel terpasang");
  assert.deepEqual(box.calls, [{ block: "nearest" }], "tepat satu gulir setelah terpasang");
  // render ulang + sinkron (tarik) + perubahan record kapasitas → tanpa gulir lagi
  for (const f of h.calls.handlers["sync.done"] || []) f({ initial: false });
  h.fr.emit(PULLED);
  h.fr.emit({ entity: "resource", ids: ["res@list:12:9"], source: "sync" });
  await revealSteps(h, clock, box, panelOf);
  assert.equal(box.calls.length, 1, "render ulang/sinkron tidak menggulir");
  // mematikan → tanpa gulir
  loadBtnOf(h.tree).props.onClick({});
  await revealSteps(h, clock, box, panelOf, 3);
  assert.equal(panelOf(h.tree), undefined);
  assert.equal(box.calls.length, 1, "mematikan tidak menggulir");
  // menyalakan lagi → +1
  loadBtnOf(h.tree).props.onClick({});
  await revealSteps(h, clock, box, panelOf);
  assert.ok(panelOf(h.tree));
  assert.equal(box.calls.length, 2);
  assert.deepEqual(h.writes, []);
  assert.equal(h.fr.calls.put.length + h.fr.calls.remove.length, 0);
  h.m.unmount();
}));

test("Review akhir I1: HP (≤ 640 px) — menyalakan Beban Tim lewat item 'Lainnya' → daftar HP digulir ke layar tepat 1× (Gantt), juga di mode Daftar (+1); mematikan dan render ulang biasa tidak menggulir", () => withNarrowClock(async (clock) => {
  const h = await panelView(clock, { loadOff: true });
  const box = revealBox();
  assert.equal(loadBtnOf(h.tree), undefined, "HP: Beban Tim di Lainnya");
  loadMoreItem(h.render()).onSelect();
  await revealSteps(h, clock, box, listOf);
  assert.ok(gridOf(h.tree), "Gantt HP");
  assert.ok(listOf(h.tree), "daftar HP terpasang");
  assert.deepEqual(box.calls, [{ block: "nearest" }]);
  // matikan lewat Lainnya, pindah ke mode Daftar, nyalakan lagi lewat Lainnya → +1
  loadMoreItem(h.render()).onSelect();
  await revealSteps(h, clock, box, listOf, 3);
  assert.equal(listOf(h.tree), undefined);
  buttonByText(h.tree, "Daftar").props.onClick({});
  await revealSteps(h, clock, box, listOf, 2);
  assert.equal(gridOf(h.tree), undefined, "mode Daftar");
  assert.equal(box.calls.length, 1);
  loadMoreItem(h.render()).onSelect();
  await revealSteps(h, clock, box, listOf);
  assert.ok(listOf(h.tree), "daftar HP di mode Daftar");
  assert.equal(box.calls.length, 2, "mode Daftar: tepat satu gulir lagi");
  await revealSteps(h, clock, box, listOf, 2);
  assert.equal(box.calls.length, 2, "render ulang biasa tidak menggulir");
  assert.deepEqual(h.writes, []);
  h.m.unmount();
}));

test("Review akhir I1: pref load:<page> ON saat view dipasang → panel desktop / daftar HP terpasang TANPA gulir (0 scrollIntoView), juga setelah render ulang, sinkron, dan ganti zoom", () => withEngineClock(async (clock) => {
  const h = await panelView(clock);
  const box = revealBox();
  await revealSteps(h, clock, box, panelOf);
  assert.ok(panelOf(h.tree));
  for (const f of h.calls.handlers["sync.done"] || []) f({ initial: false });
  h.fr.emit(PULLED);
  buttonByText(h.tree, "Hari").props.onClick({});
  await revealSteps(h, clock, box, panelOf);
  assert.equal(box.calls.length, 0);
  h.m.unmount();
  const prev = global.window;
  global.window = narrowGlobal();
  try {
    const n = await panelView(clock);
    const nb = revealBox();
    await revealSteps(n, clock, nb, listOf);
    assert.ok(listOf(n.tree), "daftar HP");
    assert.equal(nb.calls.length, 0, "HP: pref tersimpan tidak menggulir");
    n.m.unmount();
  } finally {
    global.window = prev;
  }
}));

test("Review akhir I1: pengaman scrollIntoView — akar tanpa scrollIntoView (peramban lama) atau yang melempar → tidak melempar, penanda dilepas (tidak mencoba lagi di render berikut)", () => withEngineClock(async (clock) => {
  const h = await panelView(clock, { loadOff: true });
  const bare = { offsetHeight: 0 };
  loadBtnOf(h.tree).props.onClick({});
  await revealSteps(h, clock, bare, panelOf);
  assert.ok(panelOf(h.tree));
  loadBtnOf(h.tree).props.onClick({});
  await revealSteps(h, clock, bare, panelOf, 3);
  let n = 0;
  const bad = { offsetHeight: 0, scrollIntoView() { n++; throw new Error("tidak didukung"); } };
  loadBtnOf(h.tree).props.onClick({});
  await revealSteps(h, clock, bad, panelOf);
  assert.equal(n, 1, "dicoba sekali, galat ditelan");
  await revealSteps(h, clock, bad, panelOf, 2);
  assert.equal(n, 1);
  h.m.unmount();
}));

test("Review akhir (kilatan kapasitas): menyalakan Beban Tim setelah mesin siap → 0 run TLLoad dan tanpa panel selama records.list resource berjalan, lalu tepat 1 run dengan kapasitas tersimpan (Budi 1 🍅/hari) tanpa tanda gagal; 0 tulis", () => withEngineClock(async (clock) => {
  const spy = spyRun();
  const ls = spyLoad();
  try {
    const h = await loadView(clock, { holdRes: true });
    assert.ok(spy.runs.length >= 1, "mesin siap");
    assert.equal(ls.runs.length, 0);
    loadBtnOf(h.m.render(h.getProps())).props.onClick({});
    await h.settleNow();
    assert.equal(resLists(h.fr).length, 1, "records.list resource berjalan");
    assert.equal(ls.runs.length, 0, "0 run sebelum kapasitas termuat");
    let tree = h.m.render(h.getProps());
    assert.equal(panelOf(tree), undefined, "tanpa panel (tanpa kilatan 8 🍅/hari)");
    assert.equal(loadBtnOf(tree).props["aria-pressed"], true, "tombol sudah menyala");
    h.releaseRes();
    await h.settleNow();
    assert.equal(ls.runs.length, 1, "tepat satu run setelah termuat");
    assert.deepEqual(ls.runs[0].input.people.find((p) => p.uid === 9).res, { capacity: 1, leave: [] });
    tree = h.m.render(h.getProps());
    assert.ok(panelOf(tree));
    assert.equal(panelOf(tree).props.capMissing, false);
    assert.deepEqual(h.writes, []);
    assert.equal(h.fr.calls.put.length + h.fr.calls.remove.length, 0);
    h.m.unmount();
  } finally {
    ls.restore();
    spy.restore();
  }
}));

test("Review akhir (kilatan kapasitas): loadHeadText(load, true) menambah tanda persis ' · kapasitas belum termuat' di akhir judul; false/absen → tanpa tanda", () => {
  const rows = [{ uid: 1, overDays: [10, 11] }, { uid: null, overDays: [] }];
  const L = { rows, unscheduled: 2, counted: 4, defaultTarget: 0 };
  assert.equal(T.loadHeadText(L, true), "Beban Tim · 2 hari kelebihan beban · 2 task belum dijadwalkan · kapasitas belum termuat");
  assert.equal(T.loadHeadText(L, false), "Beban Tim · 2 hari kelebihan beban · 2 task belum dijadwalkan");
  assert.equal(T.loadHeadText(L), "Beban Tim · 2 hari kelebihan beban · 2 task belum dijadwalkan");
});

test("Review akhir (kilatan kapasitas): records.list resource gagal sebelum pernah termuat → panel tetap tampil (1 run, kapasitas bawaan) dengan judul bertanda ' · kapasitas belum termuat' (panel desktop + daftar HP); muat ulang sukses → tanda hilang; gagal lagi setelah pernah termuat → tanpa tanda (data terakhir tetap data)", () => withEngineClock(async (clock) => {
  const fr = fakeRecords();
  putRec(fr, unitRec(12, "P0"));
  putRec(fr, resRec(12, 9, { capacity: 2, leave: [{ from: "2026-11-09", to: "2026-11-10", note: "Cuti" }] }));
  const fail = { on: true };
  const list0 = fr.api.list;
  fr.api.list = (entity, q) => (entity === "resource" && fail.on ? Promise.reject(new Error("jaringan")) : list0(entity, q));
  const ls = spyLoad();
  try {
    const h = await panelView(clock, { records: fr });
    let node = panelOf(h.tree);
    assert.ok(node, "panel tetap tampil saat kapasitas gagal dimuat");
    assert.equal(node.props.capMissing, true);
    assert.equal(ls.runs.length, 1);
    assert.deepEqual(ls.runs[0].input.people.map((p) => [p.uid, p.res]), [[7, null], [9, null], [11, null]], "kapasitas bawaan");
    const pm = mount(T.LoadPanel);
    const head = panelHead(pm.render(node.props));
    assert.equal(head, T.loadHeadText(node.props.load) + " · kapasitas belum termuat");
    assert.ok(head.endsWith(" · kapasitas belum termuat"));
    pm.unmount();
    const lm = mount(T.LoadList);
    const lt = lm.render({ load: node.props.load, cal: node.props.cal, result: node.props.result, ctx: node.props.ctx, pageKind: "workspace", boxRef: { current: null }, editUid: null, onEditPerson() {}, res: null, onReveal() {}, capMissing: true });
    assert.equal(txt(byCls(lt, "plg-timeline-load-head")[0]).trim(), head, "daftar HP: tanda yang sama");
    lm.unmount();
    // muat ulang sukses (perubahan record) → tanda hilang
    fail.on = false;
    h.fr.emit({ entity: "resource", ids: ["res@list:12:9"], source: "sync" });
    await h.again();
    node = panelOf(h.tree);
    assert.equal(node.props.capMissing, false);
    assert.ok(!panelHead(mount(T.LoadPanel).render(node.props)).includes("kapasitas belum termuat"));
    // gagal lagi setelah pernah termuat → tetap tanpa tanda (peta terakhir dipakai)
    fail.on = true;
    h.fr.emit({ entity: "resource", ids: ["res@list:12:9"], source: "sync" });
    await h.again();
    assert.equal(panelOf(h.tree).props.capMissing, false);
    assert.equal(h.fr.calls.put.length, 0);
    h.m.unmount();
  } finally {
    ls.restore();
  }
}));

test("Review akhir: showDay panel membaca lebar view LANGSUNG lewat getViewW() (clientWidth wadah Gantt − tableW), bukan viewW props yang bisa basi — tombol tampak di lebar sebenarnya tidak menggulir, terpotong di lebar sebenarnya → onShowDay; tanpa getViewW / nilai tak sah → viewW props", () => withEngineClock(async (clock) => {
  const h = await panelView(clock);
  const p = panelOf(h.tree).props;
  assert.equal(typeof p.getViewW, "function", "view menyediakan getViewW");
  const x = (iso) => (dnOfIso(iso) - p.rangeFrom) * p.px;
  const shown = [];
  let left = 0;
  let vw = 1000;
  const q = Object.assign({}, p, { viewW: 300, getLeft: () => left, getViewW: () => vw, onShowDay: (dn) => shown.push(T.TLCal.iso(dn)) });
  const pm = mount(T.LoadPanel);
  let pt = pm.render(q);
  pm.flush();
  const focusHit = (label) => hitOf(pt, label).props.onFocus({ currentTarget: fakeFocus() });
  left = x("2026-11-04") + p.px - 1000; // tepat muat di lebar sebenarnya 1000 (viewW basi 300 → seolah di luar)
  focusHit("Budi · Rab 4 Nov");
  assert.deepEqual(shown, [], "lebar sebenarnya: tombol tampak → tanpa gulir");
  vw = 600; // lebar sebenarnya menyempit tanpa render ulang
  focusHit("Budi · Rab 4 Nov");
  assert.deepEqual(shown, ["2026-11-04"], "terpotong di lebar sebenarnya → gulir");
  // tanpa getViewW / nilai tak sah (wadah belum terpasang) → viewW props
  pt = pm.render(Object.assign({}, q, { getViewW: undefined, viewW: 1000 }));
  focusHit("Budi · Rab 4 Nov");
  pt = pm.render(Object.assign({}, q, { getViewW: () => NaN, viewW: 1000 }));
  focusHit("Budi · Rab 4 Nov");
  assert.equal(shown.length, 1, "viewW 1000 → muat");
  pt = pm.render(Object.assign({}, q, { getViewW: () => 0, viewW: 300 }));
  focusHit("Budi · Rab 4 Nov");
  assert.equal(shown.length, 2, "0 (tersembunyi) → viewW props 300 → terpotong");
  pm.unmount();
  // view: getViewW stabil, membaca wadah Gantt terkini (clientWidth − tableW) tanpa render ulang; tanpa wadah → NaN
  assert.ok(Number.isNaN(p.getViewW()), "tanpa wadah → NaN");
  const el = fakeEl();
  h.tree = attach(h.m, h.props, h.tree, el);
  const g = panelOf(h.tree).props.getViewW;
  assert.equal(g, p.getViewW, "stabil (prop memo)");
  assert.equal(g(), 1000);
  el.clientWidth = TABLE_W_FULL + 640;
  assert.equal(g(), 640, "dibaca langsung");
  h.m.unmount();
}));

test("Review akhir: LoadList — Esc/Tutup popover saran dengan tombol pemicu sudah terlepas → fokus cadangan ke subjudul 'Hari kelebihan beban' (tabIndex −1); fokus di elemen lain (bukan body) tidak dicuri; pemicu terpasang → kembali ke pemicu; popover menutup sendiri → subjudul, hari merah terakhir hilang → judul (tabIndex −1)", () => withNarrowClock(async (clock) => {
  const h = await panelView(clock);
  const x = mList(h);
  const sub = byCls(x.tree, "plg-timeline-load-m-sub")[0];
  const head = byCls(x.tree, "plg-timeline-load-head")[0];
  assert.equal(sub.props.tabIndex, -1);
  assert.equal(head.props.tabIndex, -1);
  const subEl = fakeFocus();
  const headEl = fakeFocus();
  sub.props.ref.current = subEl;
  head.props.ref.current = headEl;
  const open = (i, btn) => {
    mDays(x.tree)[i].props.onClick({ currentTarget: btn });
    x.render();
    return sugOf(x.tree);
  };
  // (1) pemicu terlepas → Esc → subjudul
  const gone = fakeFocus({ isConnected: false });
  open(0, gone).props.onClose({ restoreFocus: true });
  x.render();
  assert.equal(sugOf(x.tree), undefined);
  assert.deepEqual([gone.focused, subEl.focused, headEl.focused], [0, 1, 0]);
  // (2) pemicu terpasang → pemicu
  const b = fakeFocus();
  open(0, b).props.onClose({ restoreFocus: true });
  x.render();
  assert.deepEqual([b.focused, subEl.focused], [1, 1]);
  // (3) klik luar (tanpa restoreFocus) → fokus tidak dipindah
  open(0, fakeFocus({ isConnected: false })).props.onClose({ restoreFocus: false });
  x.render();
  assert.equal(subEl.focused, 1);
  // (4) fokus sudah di elemen lain → tidak dicuri; jatuh ke body → dipindah
  const prevDoc = global.document;
  global.document = { body: {}, activeElement: { isConnected: true } };
  try {
    open(0, fakeFocus({ isConnected: false })).props.onClose({ restoreFocus: true });
    x.render();
    assert.equal(subEl.focused, 1, "fokus di elemen lain → tetap");
    global.document.activeElement = global.document.body;
    open(0, fakeFocus({ isConnected: false })).props.onClose({ restoreFocus: true });
    x.render();
    assert.equal(subEl.focused, 2, "fokus di body → subjudul");
  } finally {
    if (prevDoc === undefined) delete global.document; else global.document = prevDoc;
  }
  // (5) popover menutup sendiri (hari tak lagi merah) → subjudul; hari merah terakhir hilang → judul
  const base = x.props;
  const without = (pred) => Object.assign({}, base, { load: Object.assign({}, base.load, { rows: base.load.rows.map((r) => Object.assign({}, r, { overDays: r.overDays.filter((d) => !pred(r, d)) })) }) });
  const dn4 = dnOfIso("2026-11-04");
  open(0, fakeFocus());
  x.props = without((r, d) => r.uid === 9 && d === dn4);
  x.render();
  x.lm.flush();
  x.render();
  assert.equal(sugOf(x.tree), undefined);
  assert.deepEqual([subEl.focused, headEl.focused], [3, 0]);
  x.props = base;
  x.render();
  open(0, fakeFocus());
  x.props = without(() => true);
  x.render();
  x.lm.flush();
  x.render();
  assert.equal(byCls(x.tree, "plg-timeline-load-m-sub").length, 0, "tanpa hari merah → tanpa subjudul");
  assert.deepEqual([subEl.focused, headEl.focused], [3, 1]);
  x.lm.unmount();
  h.m.unmount();
}));

test("Review akhir: editor kapasitas desktop memakai logika SuggestPopover — ruang di atas wadah panel (anchorRef.getBoundingClientRect().top) < tinggi editor + 4 → membuka ke bawah (is-down; CSS top 100%, bottom auto); cukup → ke atas; diukur sekali saat dibuka; HP (tanpa anchorRef) tidak pernah is-down", () => withPop(async () => {
  assert.match(css, /\.plg-timeline-res-pop\.is-down\s*\{[^}]*top:\s*100%[^}]*bottom:\s*auto/);
  const rule = css.match(/\.plg-timeline-res-pop\s*\{([^}]*)\}/)[1];
  assert.match(rule, /bottom:\s*100%/, "bawaan tetap ke atas");
  let top = 200;
  const anchorRef = { current: { getBoundingClientRect: () => ({ top }) } };
  const dlg = (h) => dlgNode(h.tree);
  const down = edSetup({ anchorRef, rootH: 300 });
  assert.ok(hasCls(dlg(down), "is-down"), "200 < 300 + 4");
  top = 500;
  down.render();
  down.flush();
  assert.ok(hasCls(dlg(down), "is-down"), "diukur sekali saat dibuka (tidak melompat saat menyunting)");
  down.m.unmount();
  const up = edSetup({ anchorRef, rootH: 300 });
  assert.ok(!hasCls(dlg(up), "is-down"), "500 ≥ 304 → ke atas");
  up.m.unmount();
  top = 303;
  const edge = edSetup({ anchorRef, rootH: 300 });
  assert.ok(hasCls(dlg(edge), "is-down"), "303 < 304");
  edge.m.unmount();
  top = 100;
  const hp = edSetup({ rootH: 300 });
  assert.ok(!hasCls(dlg(hp), "is-down"), "tanpa anchorRef (daftar HP) → CSS HP yang menentukan");
  hp.m.unmount();
  const zero = edSetup({ anchorRef, rootH: 0 });
  assert.ok(!hasCls(dlg(zero), "is-down"), "tinggi tak terukur → bawaan");
  zero.m.unmount();
}));

test("Review akhir: LoadPanel meneruskan anchorRef = boxRef (akar panel) ke ResourceEditor; LoadList tidak (HP membuka ke bawah lewat CSS)", () => withEngineClock(async (clock) => {
  const x = await edView(clock);
  x.open("Budi");
  assert.ok(x.ed, "editor terbuka");
  assert.equal(x.ed.props.anchorRef, x.node.props.boxRef);
  x.unmount();
  const prev = global.window;
  global.window = narrowGlobal();
  try {
    const h = await panelView(clock);
    const lx = mList(h);
    mChips(lx.tree)[0].props.onClick({ currentTarget: fakeFocus() });
    lx.props = listOf(h.render()).props;
    lx.render();
    const e = edOf(lx.tree);
    assert.ok(e, "editor HP terbuka");
    assert.equal(e.props.anchorRef, undefined);
    lx.lm.unmount();
    h.m.unmount();
  } finally {
    global.window = prev;
  }
}));

// ════════════════════════════════════════════════════════════════════════════
// Fase 1 PR 1d-2 — Task 4: ringkasan earned value 🍅 di toolbar (rencana R1, R2, R10; spec K51, K57, §7.1, §7.5)
// ════════════════════════════════════════════════════════════════════════════
// Workspace list 12, hari ini Rab 4 Nov: A1 (Alpha, baseline Sen 2–Rab 4, w 4, progres 50, 2 🍅 selesai), B1 (Beta,
// baseline Kam 5, w 2, progres 20, 1 🍅), A2 (Alpha, baru — di luar baseline). PV = 4 (A1 penuh, B1 belum mulai), EV =
// 2 + 0,4, AC = 3, BAC = 6 → Jadwal 60% · Efisiensi 🍅 80%.
const EV_TEXT = "Jadwal 60% · Efisiensi 🍅 80%";
const EV_TIP = "Baseline: Rencana · PV 4 · EV 2.4 · AC 3 · BAC 6 🍅 · 1 task di luar baseline";
const EV_ROWS = {
  Alpha: [[{ $task: 1 }, "2026-11-02", "2026-11-04", 3, 4]],
  Beta: [[{ $task: 2 }, "2026-11-05", "2026-11-05", 1, 2]],
};
function evTasks() {
  const w = { list_id: 12 };
  return [
    mk(1, "A1", { start: "2026-11-02", duration: 3 }, Object.assign({ project: "Alpha", progress: 50, pomodoros_done: 2, estimated_pomodoros: 4 }, w)),
    mk(2, "B1", { start: "2026-11-05", duration: 1 }, Object.assign({ project: "Beta", progress: 20, pomodoros_done: 1, estimated_pomodoros: 2 }, w)),
    mk(3, "A2", { start: "2026-11-03", duration: 1 }, Object.assign({ project: "Alpha" }, w)),
  ];
}
// Record baseline slot n unit (workspace 12); rows = baris t [ref, s, f, d, w]; nama bawaan "Rencana".
const evRec = (project, n, data) => blRec(12, project, n, Object.assign({ name: "Rencana", t: EV_ROWS[project] }, data || {}));
const evOf = (tree) => byCls(tree, "plg-timeline-ev")[0];
const EV_CTX = {
  page: "slist_12", pageKind: "workspace", listId: 12, projectName: null,
  collaborators: [{ id: 9, display_name: "Sari" }, { id: 11, username: "budi" }],
  currentUser: { id: 7, display_name: "Saya", username: "saya" },
};
// Spy EV: T.engine.ev (satu pintu TLLoad.ev di plugin) → daftar {bl, ctx, D, out}.
function spyEv() {
  const orig = T.engine.ev;
  const runs = [];
  T.engine.ev = (bl, ctx, D) => {
    const out = orig(bl, ctx, D);
    runs.push({ bl, ctx, D, out });
    return out;
  };
  return { runs, restore: () => { T.engine.ev = orig; } };
}

// View workspace EV: recs = record baseline (bawaan Alpha + Beta slot 1 "Rencana"), pref bl:slist_12 (bawaan 1).
async function evView(clock, o) {
  const opt = o || {};
  const fr = fakeRecords();
  for (const r of opt.recs || [evRec("Alpha", 1), evRec("Beta", 1)]) putRec(fr, r);
  const tasks = opt.tasks || evTasks();
  const pref = opt.pref === undefined ? 1 : opt.pref;
  const { api, calls } = fakeApi({ records: fr, storageGet: (k) => Promise.resolve(k === "bl:slist_12" ? pref : null) });
  api.env.userId = 7;
  api.data = { tasks: { list: () => Promise.resolve(tasks) } };
  const writes = spyWrites(api);
  const ctx = ctxOf(tasks, Object.assign({}, EV_CTX, opt.ctx || {})).ctx;
  const m = mount(T.TimelineViewBody);
  const h = { m, fr, api, calls, writes, tasks, props: { context: ctx, api } };
  h.render = () => (h.tree = m.render(h.props));
  h.again = async () => (h.tree = await settleView(m, () => h.props, clock));
  h.zero = () => writes.length + fr.calls.put.length + fr.calls.remove.length;
  await h.again();
  return h;
}

test("1d-2 T4: unitIdsOf — recId TLSched.unitOf unik dari daftar task (bukan baris tata letak), urut cmpKey; bukan objek dilewati", () => {
  const ts = evTasks().concat([null, "x", mk(4, "N1", {}, { list_id: 12 }), mk(5, "A3", {}, { list_id: 12, project: "ALPHA" })]);
  const want = [blUnit(12, "Alpha").recId, blUnit(12, "Beta").recId, blUnit(12, "").recId].sort(T.TLCpm.cmpKey);
  assert.deepEqual(T.unitIdsOf(ts), want, "Alpha/ALPHA satu unit (lipatan), tanpa project = unit '-'");
  assert.deepEqual(T.unitIdsOf(ts.slice().reverse()), want, "urutan masukan tidak berpengaruh");
  assert.deepEqual(T.unitIdsOf([]), []);
  assert.deepEqual(T.unitIdsOf(null), []);
});

test("1d-2 T4: blNameFor — semua unit yang punya slot n bernama sama → nama itu; nama beda / asing / tanpa nama → 'Baseline {n}'; unit tanpa slot n diabaikan", () => {
  const a = blUnit(12, "Alpha").recId;
  const b = blUnit(12, "Beta").recId;
  const ent = (name, foreign) => ({ n: 1, foreign: !!foreign, name, rows: new Map() });
  const by = (ea, eb) => new Map([[a, new Map(ea ? [[1, ea]] : [])], [b, new Map(eb ? [[1, eb]] : [])]]);
  assert.equal(T.blNameFor(by(ent("Rencana"), ent("Rencana")), [a, b], 1), "Rencana", "seragam");
  assert.equal(T.blNameFor(by(ent("Rencana"), ent("Revisi")), [a, b], 1), "Baseline 1", "campur");
  assert.equal(T.blNameFor(by(ent("Rencana"), null), [a, b], 1), "Rencana", "Beta tanpa slot 1 tidak ikut menentukan");
  assert.equal(T.blNameFor(by(ent("Rencana"), ent(null, true)), [a, b], 1), "Baseline 1", "slot asing (versi lebih baru)");
  assert.equal(T.blNameFor(by(ent(""), ent("")), [a, b], 1), "Baseline 1", "tanpa nama");
  assert.equal(T.blNameFor(by(null, null), [a, b], 2), "Baseline 2", "tidak ada slot");
  assert.equal(T.blNameFor(new Map(), [], 3), "Baseline 3");
});

test("1d-2 T4: ringkasan EV '.plg-timeline-ev' = TLLoad.evText dengan tooltip TLLoad.evTip (title + aria-label pola blbar/flag) SEBELUM 'Selesai {tgl}'; angka = TLLoad.ev atas daftar lengkap + baseline gabungan; 0 tulis", () => withEngineClock(async (clock) => {
  const spy = spyRun();
  try {
    const h = await evView(clock);
    const end = byCls(h.tree, "plg-timeline-toolbar-end")[0];
    assert.ok(end, "kanan toolbar");
    const kids = end.children.filter((c) => c && typeof c === "object");
    assert.deepEqual(kids.map((c) => c.props.className), ["plg-timeline-ev", "plg-timeline-finish"], "EV sebelum Selesai");
    const ev = evOf(h.tree);
    assert.equal(ev.type, "span");
    assert.equal(txt(ev), EV_TEXT);
    assert.equal(ev.props.title, EV_TIP);
    assert.equal(ev.props.role, "img", "pola tooltip plugin (blbar/flag/⚠): role img + aria-label + title");
    assert.equal(ev.props["aria-label"], EV_TEXT + " · " + EV_TIP, "pembaca layar mendengar teks + tooltip");
    assert.equal(nodes(ev, (n) => typeof n.type === "string").length, 1, "satu elemen");
    // angka = mesin murni atas masukan yang sama (daftar lengkap mesin, baris dua unit, hari ini)
    const res = spy.runs[spy.runs.length - 1].result;
    const ctx = spy.runs[spy.runs.length - 1].ctx;
    const rows = new Map();
    for (const p of ["Alpha", "Beta"]) for (const [k, r] of T.TLPlan.baselineDecode(evRec(p, 1).data).rows) rows.set(k, r);
    const r = T.TLLoad.ev({ n: 1, rows }, { tasks: ctx.tasks, cal: ctx.cal, result: res }, T.TLCal.dn(TODAY));
    assert.deepEqual([r.bac, r.pv, r.ev, r.ac, r.outside, r.missing], [6000, 4000, 2400, 3000, 1, 0]);
    assert.equal(T.TLLoad.evText(r), EV_TEXT);
    assert.equal(T.TLLoad.evTip(r, "Rencana"), EV_TIP);
    assert.equal(h.zero(), 0, "EV tidak menulis apa pun (R25)");
    h.m.unmount();
  } finally {
    spy.restore();
  }
}));

test("1d-2 T4 (R2): filter panel (scopeTasks hanya Alpha) tidak mengubah EV — unit dari eng.ctx.tasks, baseline unit tersaring tetap dimuat dalam SATU list se-scope; hari ini berubah → dihitung ulang", () => withEngineClock(async (clock) => {
  const h = await evView(clock);
  assert.equal(txt(evOf(h.tree)), EV_TEXT);
  const lists0 = blLists(h.fr).length;
  // host menyaring panel: hanya project Alpha (scopeTasks baru); Beta tetap di daftar lengkap mesin
  const alpha = h.tasks.filter((t) => t.project === "Alpha");
  h.props = { context: Object.assign({}, h.props.context, { tasks: alpha, scopeTasks: alpha }), api: h.api };
  await h.again();
  assert.equal(nodes(h.tree, (n) => n.props.role === "row" && n.props["data-key"] === "2").length, 0, "baris B1 tersaring");
  assert.equal(txt(evOf(h.tree)), EV_TEXT, "teks sama");
  assert.equal(evOf(h.tree).props.title, EV_TIP, "BAC/outside sama (Beta tetap dihitung)");
  assert.equal(blLists(h.fr).length, lists0, "unit Beta sudah termuat — filter tidak memuat ulang baseline");
  assert.ok(blLists(h.fr).every((l) => l[1].scope === "list:12"), "tidak ada list per unit");
  // filter dimuat SEJAK awal (halaman dibuka dengan filter aktif) → angka tetap sama
  const f = await evView(clock, { ctx: { tasks: alpha, scopeTasks: alpha } });
  assert.equal(txt(evOf(f.tree)), EV_TEXT);
  assert.equal(evOf(f.tree).props.title, EV_TIP);
  assert.equal(new Set(blLists(f.fr).map((l) => JSON.stringify(l[1]))).size, 1, "satu bentuk list se-scope (tanpa list per unit)");
  f.m.unmount();
  // hari ini Kam 5 Nov → PV B1 ikut (6) → Jadwal 40%
  h.api.env.today = () => "2026-11-05";
  await h.again();
  assert.equal(txt(evOf(h.tree)), "Jadwal 40% · Efisiensi 🍅 80%");
  assert.equal(h.zero(), 0);
  h.m.unmount();
}));

test("1d-2 T4: tanpa baseline aktif (pref Tidak ada) / slot kosong / BAC 0 (baseline lama tanpa w) / mesin belum siap → ringkasan TIDAK dirender (Selesai tetap)", () => withEngineClock(async (clock) => {
  for (const [label, o] of [
    ["pref 0", { pref: 0 }],
    ["slot 2 kosong", { pref: 2 }],
    ["BAC 0", { recs: [evRec("Alpha", 1, { t: [[{ $task: 1 }, "2026-11-02", "2026-11-04", 3]] }), evRec("Beta", 1, { t: [[{ $task: 2 }, "2026-11-05", "2026-11-05", 1, 0]] })] }],
    ["slot asing", { recs: [evRec("Alpha", 1, { v: 2 }), evRec("Beta", 1, { v: 2 })] }],
  ]) {
    const h = await evView(clock, o);
    assert.equal(evOf(h.tree), undefined, label);
    assert.ok(byCls(h.tree, "plg-timeline-finish").length === 1, label + ": Selesai tetap");
    assert.equal(h.zero(), 0, label);
    h.m.unmount();
  }
  // mesin belum siap (render pertama, pref + record sudah termuat) → tanpa ringkasan
  const fr = fakeRecords();
  putRec(fr, evRec("Alpha", 1));
  putRec(fr, evRec("Beta", 1));
  const { api } = fakeApi({ records: fr, storageGet: (k) => Promise.resolve(k === "bl:slist_12" ? 1 : null) });
  api.data = { tasks: { list: () => Promise.resolve(evTasks()) } };
  const m = mount(T.TimelineViewBody);
  const props = { context: ctxOf(evTasks(), EV_CTX).ctx, api };
  let tree = m.render(props);
  m.flush();
  await settle();
  tree = m.render(props);
  m.flush();
  await settle();
  tree = m.render(props);
  assert.ok(fr.calls.list.some((c) => c[0] === "baseline"), "baseline sudah dimuat");
  assert.equal(evOf(tree), undefined, "mesin belum siap");
  m.unmount();
}));

test("1d-2 T4: nama baseline di tooltip — semua unit slot 1 bernama sama → nama itu; campur → 'Baseline 1'; hanya satu unit punya slot → namanya", () => withEngineClock(async (clock) => {
  const same = await evView(clock);
  assert.ok(evOf(same.tree).props.title.startsWith("Baseline: Rencana · "));
  same.m.unmount();
  const mixed = await evView(clock, { recs: [evRec("Alpha", 1), evRec("Beta", 1, { name: "Revisi" })] });
  assert.equal(evOf(mixed.tree).props.title, "Baseline: Baseline 1 · PV 4 · EV 2.4 · AC 3 · BAC 6 🍅 · 1 task di luar baseline");
  mixed.m.unmount();
  const one = await evView(clock, { recs: [evRec("Alpha", 1, { name: "Awal Alpha" })] });
  // hanya Alpha: BAC 4, B1 di luar baseline (2 task di luar)
  assert.equal(txt(evOf(one.tree)), "Jadwal 50% · Efisiensi 🍅 100%");
  assert.equal(evOf(one.tree).props.title, "Baseline: Awal Alpha · PV 4 · EV 2 · AC 2 · BAC 4 🍅 · 2 task di luar baseline");
  one.m.unmount();
}));

test("1d-2 T4 (R10): render awal tanpa TLLoad.ev — EV dihitung SETELAH mesin (raf + setTimeout 0), tepat 1×; render ulang tanpa perubahan 0; 0 tulis", () => withEngineClock(async (clock) => {
  const fr = fakeRecords();
  putRec(fr, evRec("Alpha", 1));
  putRec(fr, evRec("Beta", 1));
  const { api } = fakeApi({ records: fr, storageGet: (k) => Promise.resolve(k === "bl:slist_12" ? 1 : null) });
  api.data = { tasks: { list: () => Promise.resolve(evTasks()) } };
  const writes = spyWrites(api);
  const props = { context: ctxOf(evTasks(), EV_CTX).ctx, api };
  const spy = spyRun();
  const evs = spyEv();
  try {
    const m = mount(T.TimelineViewBody);
    let tree = m.render(props);
    assert.deepEqual([spy.runs.length, evs.runs.length], [0, 0], "render pertama tanpa mesin dan tanpa EV");
    m.flush();
    await settle();
    tree = m.render(props);
    m.flush();
    await settle();
    tree = m.render(props);
    assert.deepEqual([spy.runs.length, evs.runs.length], [0, 0], "pref + baseline termuat, mesin belum → EV belum dihitung");
    assert.ok(clock.frames() >= 1);
    clock.tick(0);
    assert.equal(spy.runs.length, 1);
    assert.equal(evs.runs.length, 0, "EV dihitung saat render (memo), bukan di penjadwal mesin");
    tree = m.render(props);
    m.flush();
    await settle();
    tree = m.render(props);
    assert.equal(evs.runs.length, 1, "tepat satu hitung EV setelah mesin siap");
    assert.equal(evs.runs[0].ctx.result, spy.runs[0].result, "hasil mesin yang sama");
    assert.equal(evs.runs[0].ctx.tasks, spy.runs[0].ctx.tasks, "daftar lengkap mesin (R2)");
    assert.equal(evs.runs[0].D, T.TLCal.dn(TODAY));
    assert.equal(txt(evOf(tree)), EV_TEXT);
    m.render(props);
    m.render(props);
    assert.equal(evs.runs.length, 1, "render ulang tanpa perubahan tidak menghitung ulang");
    assert.deepEqual(writes, []);
    assert.equal(fr.calls.put.length + fr.calls.remove.length, 0);
    m.unmount();
  } finally {
    evs.restore();
    spy.restore();
  }
}));

test("1d-2 T4 (R10): DOM +1 elemen — baseline ber-w vs baseline sama tanpa w (BAC 0) berselisih tepat satu elemen (span ringkasan)", () => withEngineClock(async (clock) => {
  const withW = await evView(clock);
  const noW = await evView(clock, { recs: [
    evRec("Alpha", 1, { t: [[{ $task: 1 }, "2026-11-02", "2026-11-04", 3, 0]] }), evRec("Beta", 1, { t: [[{ $task: 2 }, "2026-11-05", "2026-11-05", 1, 0]] }),
  ] });
  assert.ok(evOf(withW.tree));
  assert.equal(evOf(noW.tree), undefined);
  assert.equal(domCount(withW.tree) - domCount(noW.tree), 1);
  withW.m.unmount();
  noW.m.unmount();
}));

test("1d-2 T4: CSS .plg-timeline-ev token saja (tanpa border-left aksen), satu baris + elipsis; ≤ 640 px kanan toolbar boleh terbungkus dan dibatasi lebar baris (tanpa gulir horizontal 375 px); sumber: teks EV dari TLLoad, 1 pintu engine.ev", () => {
  const rule = css.match(/\.plg-timeline-ev\s*\{([^}]*)\}/);
  assert.ok(rule, "aturan .plg-timeline-ev");
  for (const re of [/min-width:\s*0/, /max-width:\s*100%/, /overflow:\s*hidden/, /text-overflow:\s*ellipsis/, /white-space:\s*nowrap/]) assert.match(rule[1], re);
  assert.doesNotMatch(rule[1], /border-left/);
  assert.doesNotMatch(rule[1], /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  for (const m of rule[1].matchAll(/color:\s*([^;]+);/g)) assert.match(m[1], /^var\(--/, "warna lewat token");
  // ≤ 640 px: blok media yang memuat .plg-timeline-toolbar-end → bungkus + dibatasi lebar baris toolbar
  const narrow = [...css.matchAll(/@media \(max-width: 640px\) \{([\s\S]*?)\n\}/g)].map((x) => x[1]).join("\n");
  const endRule = narrow.match(/\.plg-timeline-toolbar-end\s*\{([^}]*)\}/);
  assert.ok(endRule, "aturan HP .plg-timeline-toolbar-end");
  for (const re of [/flex-wrap:\s*wrap/, /max-width:\s*100%/, /min-width:\s*0/]) assert.match(endRule[1], re);
  // sumber: teks persis lewat TLLoad (tanpa salinan teks di plugin.jsx), satu pintu engine.ev
  assert.match(jsx, /TLLoad\.evText\(/);
  assert.match(jsx, /TLLoad\.evTip\(/);
  assert.equal((jsx.match(/TLLoad\.ev\(/g) || []).length, 1, "TLLoad.ev hanya lewat engine.ev");
  assert.doesNotMatch(jsx, /"Jadwal "|Efisiensi 🍅/, "teks EV tidak disalin ke plugin.jsx");
});

// ════════════════════════════════════════════════════════════════════════════
// Fase 1 PR 1d-2 — Task 5: menu "Lainnya" → "Ekspor ke Microsoft Project (.xml)" + alur unduh (rencana R5, R6, R9; spec
// K53, K54, §7.1, §7.5, §7.7; Q7 (a); P2 (a) context.listName)
// ════════════════════════════════════════════════════════════════════════════
const EXPORT = "Ekspor ke Microsoft Project (.xml)";
const MSG_EXPORT_NATIVE = "Ekspor tersedia di alurik.com lewat browser";
const MSG_EXPORT_FAIL = "Ekspor gagal";
const exportOf = (tree) => {
  const mm = nodes(tree, (n) => n.type === T.MoreMenu);
  assert.equal(mm.length, 1, "tepat satu menu Lainnya");
  return mm[0].props.items.find((it) => it.text === EXPORT);
};
// Spy ekspor: T.engine.mspdi (satu pintu TLMspdi.build di plugin) → daftar {input, out}; throwErr → melempar.
function spyMspdi(throwErr) {
  const orig = T.engine.mspdi;
  const runs = [];
  T.engine.mspdi = (input) => {
    if (throwErr) {
      runs.push({ input, out: null });
      throw throwErr;
    }
    const out = orig(input);
    runs.push({ input, out });
    return out;
  };
  return { runs, restore: () => { T.engine.mspdi = orig; } };
}
// api.ui.saveFile palsu: hasil per panggilan (true / false / "reject" / "throw").
function fakeSave(api, mode) {
  const calls = [];
  api.ui.saveFile = (...a) => {
    calls.push(a);
    const m = typeof mode === "function" ? mode(calls.length) : mode === undefined ? true : mode;
    if (m === "throw") throw new TypeError("saveFile: sinkron");
    if (m === "reject") return Promise.reject(new TypeError("saveFile: nama tidak sah"));
    return Promise.resolve(m);
  };
  return calls;
}
const exportToasts = (calls) => calls.toast.filter((t) => /^Berkas |^Ekspor /.test(t[0]));

test("1d-2 T5 (R6): layar lebar — tombol 'Lainnya' tetap SETELAH extras berisi tepat 'Ekspor ke Microsoft Project (.xml)' (menuitem, aktif setelah mesin siap); dibuka → satu item role menuitem", () => withEngineClock(async (clock) => {
  const h = await swView(clock);
  const tt = toolbarTexts(h.tree);
  assert.equal(tt.indexOf("[Lainnya]"), tt.indexOf("Jadwalkan ulang") + 1, "setelah extras");
  assert.equal(tt.indexOf("Kalender kerja"), tt.indexOf("[Lainnya]") + 1);
  const mm = moreOf(h.tree);
  assert.deepEqual(mm.props.items.map((it) => [it.id, it.text, it.role, !!it.disabled]), [["export", EXPORT, "menuitem", false]]);
  const mt = mount(T.MoreMenu);
  let t = mt.render(mm.props);
  buttonByText(t, "Lainnya").props.onClick({});
  t = mt.render(mm.props);
  const menu = nodes(t, (n) => n.props.role === "menu")[0];
  const its = nodes(menu, (n) => n.type === "button");
  assert.deepEqual(its.map((n) => [txt(n).trim(), n.props.role, n.props.disabled]), [[EXPORT, "menuitem", false]]);
  mt.unmount();
  assert.deepEqual(h.writes(), []);
  h.m.unmount();
}));

test("1d-2 T5 (R6): collapse (Live Edit / ≤ 640 px Gantt + Daftar) → Ekspor di AKHIR daftar Lainnya yang ada, satu tombol Lainnya; mesin belum siap → item nonaktif dan memilihnya tidak membangun/mengunduh", () => withEngineClock(async (clock) => {
  const le = await swView(clock, { ctx: { liveEdit: true } });
  const items = moreOf(le.tree).props.items;
  assert.equal(items[items.length - 1].text, EXPORT);
  assert.equal(exportOf(le.tree).disabled, false);
  le.m.unmount();
  const prevWin = global.window;
  global.window = narrowGlobal();
  try {
    const n = await swView(clock);
    assert.equal(moreOf(n.tree).props.items.slice(-1)[0].text, EXPORT, "HP Gantt");
    exportOf(n.tree);
    buttonByText(n.tree, "Daftar").props.onClick({});
    n.render();
    assert.equal(moreOf(n.tree).props.items.slice(-1)[0].text, EXPORT, "HP Daftar");
    exportOf(n.tree);
    n.m.unmount();
  } finally {
    global.window = prevWin;
  }
  // mesin belum siap: item ada tetapi nonaktif; onSelect (dipanggil paksa) tidak membangun dan tidak mengunduh
  const ms = spyMspdi();
  try {
    for (const liveEdit of [false, true]) {
      const { api, calls } = fakeApi();
      api.data = { tasks: { list: () => Promise.resolve(chainTasks()) } };
      const saves = fakeSave(api);
      const m = mount(T.TimelineViewBody);
      const props = { context: ctxOf(chainTasks(), { liveEdit }).ctx, api };
      m.render(props);
      m.flush();
      await settle();
      const tree = m.render(props);
      const it = exportOf(tree);
      assert.equal(it.disabled, true, "nonaktif sebelum mesin siap (liveEdit " + liveEdit + ")");
      it.onSelect();
      await settle();
      assert.deepEqual([ms.runs.length, saves.length, exportToasts(calls).length], [0, 0, 0]);
      m.unmount();
    }
  } finally {
    ms.restore();
  }
}));

test("1d-2 T5 (R5): klik Ekspor di web (workspace, filter panel aktif) → engine.mspdi SEKALI dengan daftar lengkap/kalender/readExt/hasil/unit mesin, judul context.listName, nama orang, baseline aktif semua unit, hari ini → api.ui.saveFile(nama, xml, 'application/xml') sinkron di gestur → toast 'Berkas {nama} diunduh'; 0 tulis", () => withEngineClock(async (clock) => {
  const spy = spyRun();
  const ms = spyMspdi();
  try {
    const alpha = evTasks().filter((t) => t.project === "Alpha");
    const h = await evView(clock, { ctx: { listName: "Tim Pemasaran", tasks: alpha, scopeTasks: alpha } });
    const saves = fakeSave(h.api);
    exportOf(h.tree).onSelect();
    assert.equal(ms.runs.length, 1, "build sekali");
    assert.equal(saves.length, 1, "saveFile dipanggil sinkron di dalam gestur (sebelum await apa pun)");
    const run = spy.runs[spy.runs.length - 1];
    const inp = ms.runs[0].input;
    assert.equal(inp.tasks, run.ctx.tasks, "daftar lengkap mesin (R5), bukan baris tersaring");
    assert.ok(inp.tasks.some((t) => t.title === "B1"), "B1 (tersaring panel) ikut");
    assert.equal(inp.cal, run.ctx.cal);
    assert.equal(inp.readExt, run.ctx.readExt);
    assert.equal(inp.result, run.result);
    assert.equal(inp.units, run.ctx.units);
    assert.equal(inp.pageKind, "workspace");
    assert.equal(inp.title, "Tim Pemasaran");
    assert.equal(inp.fileName, "Tim-Pemasaran-2026-11-04.xml");
    assert.equal(inp.D, T.TLCal.dn(TODAY));
    assert.ok(inp.people instanceof Map);
    assert.deepEqual([...inp.people].sort((a, b) => a[0] - b[0]), [[7, "Saya"], [9, "Sari"], [11, "budi"]]);
    assert.equal(inp.ownerUid, null, "workspace: resource = penanggung jawab");
    assert.ok(inp.baseline && inp.baseline.rows instanceof Map);
    const want = new Map();
    for (const p of ["Alpha", "Beta"]) for (const [k, r] of T.TLPlan.baselineDecode(evRec(p, 1).data).rows) want.set(k, r);
    assert.deepEqual([...inp.baseline.rows.keys()].sort(), [...want.keys()].sort(), "baseline aktif semua unit (Beta tersaring tetap)");
    const out = ms.runs[0].out;
    assert.deepEqual(saves[0], ["Tim-Pemasaran-2026-11-04.xml", out.xml, "application/xml"]);
    assert.ok(out.xml.includes("<Title>Tim Pemasaran</Title>"));
    assert.deepEqual([out.stats.unscheduled, out.stats.skippedLinks], [0, 0]);
    await settle();
    assert.deepEqual(exportToasts(h.calls), [["Berkas Tim-Pemasaran-2026-11-04.xml diunduh", "success"]]);
    assert.equal(h.zero(), 0, "ekspor tidak menulis apa pun (R25)");
    h.m.unmount();
  } finally {
    ms.restore();
    spy.restore();
  }
}));

test("1d-2 T5 (R5): toast sukses varian — ' · {n} task tanpa jadwal ditandai perkiraan' dan/atau ' · {k} tautan dilewati' bila > 0 (stats build)", () => withEngineClock(async (clock) => {
  const al = { project: "Alpha" };
  const base = () => [mk(1, "A", { start: "2026-11-02", duration: 2 }, al)];
  const cases = [
    ["tanpa jadwal", base().concat([mk(2, "B", {}, al)]), [1, 0], "Berkas Alpha-2026-11-04.xml diunduh · 1 task tanpa jadwal ditandai perkiraan"],
    ["tautan dilewati", base().concat([mk(3, "C", { start: "2026-11-03", duration: 1, deps: [{ t: { $task: 999 }, type: "FS", lag: 0 }] }, al)]), [0, 1],
      "Berkas Alpha-2026-11-04.xml diunduh · 1 tautan dilewati"],
    ["keduanya", base().concat([mk(2, "B", {}, al), mk(4, "D", {}, al), mk(3, "C", { start: "2026-11-03", duration: 1, deps: [{ t: { $task: 999 }, type: "FS", lag: 0 }] }, al)]), [2, 1],
      "Berkas Alpha-2026-11-04.xml diunduh · 2 task tanpa jadwal ditandai perkiraan · 1 tautan dilewati"],
  ];
  const ms = spyMspdi();
  try {
    for (const [label, tasks, stats, text] of cases) {
      const h = await swView(clock, { tasks });
      fakeSave(h.api);
      exportOf(h.tree).onSelect();
      await settle();
      const out = ms.runs[ms.runs.length - 1].out;
      assert.deepEqual([out.stats.unscheduled, out.stats.skippedLinks], stats, label);
      assert.deepEqual(exportToasts(h.calls), [[text, "success"]], label);
      assert.deepEqual(h.writes(), [], label);
      h.m.unmount();
    }
  } finally {
    ms.restore();
  }
}));

test("1d-2 T5 (R5): saveFile reject / melempar sinkron atau build melempar → 'Ekspor gagal' (error) + log; build melempar → saveFile tidak dipanggil", () => withEngineClock(async (clock) => {
  for (const mode of ["reject", "throw"]) {
    const h = await swView(clock);
    const saves = fakeSave(h.api, mode);
    exportOf(h.tree).onSelect();
    await settle();
    assert.equal(saves.length, 1, mode);
    assert.deepEqual(exportToasts(h.calls), [[MSG_EXPORT_FAIL, "error"]], mode);
    assert.ok(h.calls.warn.length >= 1, mode + ": galat dicatat");
    h.m.unmount();
  }
  const ms = spyMspdi(new Error("rusak"));
  try {
    const h = await swView(clock);
    const saves = fakeSave(h.api);
    exportOf(h.tree).onSelect();
    await settle();
    assert.equal(ms.runs.length, 1);
    assert.equal(saves.length, 0, "tanpa XML tidak ada unduhan");
    assert.deepEqual(exportToasts(h.calls), [[MSG_EXPORT_FAIL, "error"]]);
    assert.deepEqual(h.writes(), []);
    h.m.unmount();
  } finally {
    ms.restore();
  }
}));

test("1d-2 T5 (Q7 a): api.env.platform 'tauri' → toast 'Ekspor tersedia di alurik.com lewat browser' TANPA membangun XML dan tanpa saveFile; web dengan saveFile → false → toast yang sama (setelah build)", () => withEngineClock(async (clock) => {
  const ms = spyMspdi();
  try {
    const h = await swView(clock);
    h.api.env.platform = "tauri";
    const saves = fakeSave(h.api);
    exportOf(h.tree).onSelect();
    await settle();
    assert.deepEqual([ms.runs.length, saves.length], [0, 0], "native: build tidak dipanggil");
    assert.deepEqual(exportToasts(h.calls), [[MSG_EXPORT_NATIVE, "info"]]);
    h.m.unmount();
    const w = await swView(clock);
    w.api.env.platform = "web";
    const s2 = fakeSave(w.api, false);
    exportOf(w.tree).onSelect();
    await settle();
    assert.deepEqual([ms.runs.length, s2.length], [1, 1]);
    assert.deepEqual(exportToasts(w.calls), [[MSG_EXPORT_NATIVE, "info"]]);
    assert.deepEqual(w.writes(), []);
    w.m.unmount();
  } finally {
    ms.restore();
  }
}));

test("1d-2 T5 (R9, P2 a): nama berkas/judul — project = projectName (+ ownerUid pengguna aktif); workspace = context.listName; listName kosong/absen (host lama) → 'Timeline'", () => withEngineClock(async (clock) => {
  const ms = spyMspdi();
  try {
    const p = await swView(clock, { ctx: { currentUser: { id: 7, display_name: "Saya" } } });
    const sp = fakeSave(p.api);
    exportOf(p.tree).onSelect();
    assert.deepEqual([ms.runs[0].input.title, ms.runs[0].input.fileName, ms.runs[0].input.pageKind, ms.runs[0].input.ownerUid], ["Alpha", "Alpha-2026-11-04.xml", "project", 7]);
    assert.equal(sp[0][0], "Alpha-2026-11-04.xml");
    assert.match(ms.runs[0].out.xml, /<Resource>\s*<UID>1<\/UID>\s*<ID>1<\/ID>\s*<Name>Saya<\/Name>/, "halaman pribadi: resource tunggal = pengguna aktif (currentUser)");
    p.m.unmount();
    for (const [listName, title, file] of [["Tim Pemasaran", "Tim Pemasaran", "Tim-Pemasaran-2026-11-04.xml"], [undefined, "Timeline", "Timeline-2026-11-04.xml"], ["   ", "Timeline", "Timeline-2026-11-04.xml"], [" Riset & Data ", "Riset & Data", "Riset-&-Data-2026-11-04.xml"]]) {
      const before = ms.runs.length;
      const w = await evView(clock, { ctx: listName === undefined ? {} : { listName } });
      const sw = fakeSave(w.api);
      exportOf(w.tree).onSelect();
      const inp = ms.runs[before].input;
      assert.deepEqual([inp.title, inp.fileName], [title, file], JSON.stringify(listName));
      assert.equal(sw[0][0], file);
      await settle();
      assert.deepEqual(exportToasts(w.calls), [["Berkas " + file + " diunduh", "success"]]);
      w.m.unmount();
    }
  } finally {
    ms.restore();
  }
}));

test("1d-2 T5: sumber — teks UI persis, satu pintu engine.mspdi (TLMspdi.build) dan satu api.ui.saveFile (hanya dari handler menu), toast lewat api.ui.toast; CSS menu Lainnya 375 px tanpa luber (lebar menu tetap, label panjang terbungkus)", () => {
  for (const t of ['"Ekspor ke Microsoft Project (.xml)"', '"Ekspor gagal"', '"Ekspor tersedia di alurik.com lewat browser"', '"Berkas "', '" diunduh"', '" task tanpa jadwal ditandai perkiraan"', '" tautan dilewati"', '"application/xml"']) {
    assert.ok(jsx.includes(t), t);
  }
  assert.equal((jsx.match(/TLMspdi\.build\(/g) || []).length, 1, "build hanya lewat engine.mspdi");
  assert.equal((jsx.match(/api\.ui\.saveFile\(/g) || []).length, 1, "satu situs saveFile");
  assert.equal((jsx.match(/\.saveFile\(/g) || []).length, 1);
  // saveFile hanya di dalam handler ekspor (dipicu onSelect item menu), bukan efek/pendengar
  const at = jsx.indexOf("api.ui.saveFile(");
  const fnAt = jsx.lastIndexOf("const exportXml = () => {", at);
  assert.ok(fnAt > 0 && jsx.indexOf("\n  };\n", fnAt) > at, "di dalam exportXml");
  assert.match(jsx, /onSelect: exportXml/);
  assert.doesNotMatch(jsx, /showToast\(/, "toast lewat api.ui.toast (toastSafe), bukan context.showToast");
  // CSS 375 px: menu Lainnya lebar tetap (min-width = MORE_MENU_W menuAlign) dibatasi viewport; item tanpa nowrap →
  // label "Ekspor ke Microsoft Project (.xml)" terbungkus di dalam menu, bukan melebarkannya melewati tepi layar
  assert.match(css, /\.plg-timeline-more-menu\s*\{[^}]*min-width:\s*180px;[^}]*max-width:\s*calc\(100vw - 16px\)/);
  assert.match(jsx, /const MORE_MENU_W = 180;/);
  const item = css.match(/\.plg-timeline-more-item\s*\{([^}]*)\}/)[1];
  assert.doesNotMatch(item, /white-space:\s*nowrap/);
  assert.match(css, /\.plg-timeline-toolbar\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.equal(T.menuAlign({ left: 262, right: 330 }, 375, 180), "end", "tombol di separuh kanan HP → rata kanan");
});
