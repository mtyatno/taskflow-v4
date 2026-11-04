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
    version: "1.2.0",
    minApi: 1,
    defaultEnabled: false,
    slots: ["taskList.views", "taskDetail.sections"],
    permissions: ["storage", "task.ext", "records"],
    contributes: {
      "taskList.views": [{ id: "gantt", label: "Timeline", icon: { path: "M2 4h7M5 8h8M3 12h5" }, pages: ["project", "workspace"] }],
      "taskDetail.sections": [{ id: "schedule", label: "Jadwal", order: 10 }],
    },
    records: { calendar: { conflict: "lww", maxBytes: 16384 }, project: { conflict: "lww", maxBytes: 1024 }, baseline: { conflict: "lww", maxBytes: 65536 } },
    taskExt: { keys: ["start", "duration", "deps", "mode", "constraint", "actual"] },
    parts: ["holidays-id.js", "calendar.js", "schedule.js", "cpm.js", "plan.js", "layout.js", "drag.js"],
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

test("calendarStore, projectStore, dan baselineStore satu-satunya yang menyentuh api.records; tiap entitas hanya di adaptornya (R5, R6, 1c-2 K41)", () => {
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
  const strip = (s) => s.replace(/\/\/[^\n]*/g, "");
  const cuts = [[cs, ce], [ps, pe], [bs, be]].sort((a, b) => a[0] - b[0]);
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
const FENCE_ALLOW = new Set(["issue", "issueMany", "write", "writeMany", "setAuto", "save", "saveBaseline"]);
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

test("sumber plugin.js: setiap 'taskExt.set(' / 'taskExt.setMany(' / 'records.put(' / 'records.remove(' berada di dalam fungsi issue|issueMany|write|writeMany|setAuto|save|saveBaseline", () => {
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
  // mesin belum siap: tidak ada tiga tombol baru (juga tidak ada 'Lainnya' di Live Edit)
  {
    const { api } = fakeApi();
    api.data = { tasks: { list: () => Promise.resolve(chainTasks()) } };
    const m = mount(T.TimelineViewBody);
    const props = { context: ctxOf(chainTasks()).ctx, api };
    m.render(props);
    m.flush();
    await settle();
    const tree = m.render(props);
    assert.deepEqual(toolbarTexts(tree), ["Hari", "Minggu", "Bulan", "Hari ini", "Kalender kerja", "Urutkan menurut Mulai"]);
    const le = mount(T.TimelineViewBody).render({ context: ctxOf(chainTasks(), { liveEdit: true }).ctx, api });
    assert.equal(moreOf(le), undefined, "Lainnya tanpa isi tidak tampil");
    m.unmount();
  }
  // lebar, mesin siap: urutan R23
  const h = await swView(clock);
  assert.deepEqual(toolbarTexts(h.tree), ["Hari", "Minggu", "Bulan", "Hari ini", "Jadwal otomatis", "Jalur kritis", "Baseline", "Simpan baseline", "Jadwalkan ulang", "Kalender kerja", "Urutkan menurut Mulai"]); // 1c-2 T5: §7.1
  assert.equal(moreOf(h.tree), undefined);
  h.m.unmount();
  // Live Edit: tiga tombol pindah ke 'Lainnya' (posisi sama di urutan), Kolom tetap di toolbar
  const le = await swView(clock, { ctx: { liveEdit: true } });
  assert.deepEqual(toolbarTexts(le.tree), ["Hari", "Minggu", "Bulan", "Hari ini", "[Lainnya]", "Kalender kerja", "Urutkan menurut Mulai", "Kolom"]);
  const mm = moreOf(le.tree);
  assert.deepEqual(mm.props.items.map((it) => it.text), ["Jadwal otomatis", "Jalur kritis", "Baseline", "Simpan baseline", "Jadwalkan ulang"]);
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
    ["Jadwal otomatis", "menuitemcheckbox", false], ["Jalur kritis", "menuitemcheckbox", false],
    ["Baseline", "menuitem", undefined], ["Simpan baseline", "menuitem", undefined], ["Jadwalkan ulang", "menuitem", undefined],
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
    assert.deepEqual(moreOf(n.tree).props.items.map((it) => it.text), ["Jadwal otomatis", "Jalur kritis", "Baseline", "Simpan baseline", "Jadwalkan ulang"]);
    assert.equal(switchOf(n.tree), undefined, "sakelar tidak di toolbar HP");
    buttonByText(n.tree, "Daftar").props.onClick({});
    const lt = n.render();
    // 1c-2 T5: pilihan Baseline hanya untuk Gantt (seperti Jalur kritis); Simpan baseline tetap (aksi data)
    assert.deepEqual(moreOf(lt).props.items.map((it) => it.text), ["Jadwal otomatis", "Simpan baseline", "Jadwalkan ulang"]);
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
  assert.deepEqual(tt.slice(tt.indexOf("Jalur kritis"), tt.indexOf("Jadwalkan ulang") + 1), ["Jalur kritis", "Baseline", "Simpan baseline", "Jadwalkan ulang"]);
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
  assert.deepEqual(h.calls.storageSet.filter((s) => s[0].indexOf("bl:") === 0), [["bl:proj_Alpha", 2]]);
  assert.ok(nodes(h.tree, (n) => n.type === "button" && txt(n).trim() === "Baseline" && hasCls(n, "is-active")).length === 1, "pilihan ≠ Tidak ada → tombol aktif");
  assert.equal(fr.calls.put.length + fr.calls.remove.length, 0, "pilihan baseline tidak pernah menulis record (P2 a)");
  // pref round-trip: dibaca dari api.storage saat pasang
  h.m.unmount();
  for (const [stored, want] of [[1, 1], [3, 3], ["2", 0], [7, 0], [null, 0]]) {
    const fr2 = fakeRecords();
    const { api } = fakeApi({ records: fr2, storageGet: (k) => Promise.resolve(k === "bl:proj_Alpha" ? stored : null) });
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
    '"Baseline gagal disimpan"', '"Data berubah sejak dialog dibuka — muat ulang"', '"Hapus "', '" dihapus"']) {
    assert.ok(jsx.includes(t), t);
  }
  assert.match(jsx, /usePref\(api, "bl", page\)/);
  assert.equal((jsx.match(/records\.put\(/g) || []).length, 3, "tidak ada situs records.put baru (calendar, project, baseline)");
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
