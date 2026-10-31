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

test("manifest persis", () => {
  assert.deepEqual(manifest, {
    id: "timeline",
    name: "Timeline",
    description: "Gantt untuk project dan workspace: jadwal hari kerja, dependensi, milestone.",
    version: "1.0.0",
    minApi: 1,
    defaultEnabled: false,
    slots: ["taskList.views", "taskDetail.sections"],
    permissions: ["storage", "task.ext", "records"],
    contributes: {
      "taskList.views": [{ id: "gantt", label: "Timeline", icon: { path: "M2 4h7M5 8h8M3 12h5" }, pages: ["project", "workspace"] }],
      "taskDetail.sections": [{ id: "schedule", label: "Jadwal", order: 10 }],
    },
    records: { calendar: { conflict: "lww", maxBytes: 16384 } },
    taskExt: { keys: ["start", "duration", "deps"] },
    parts: ["holidays-id.js", "calendar.js", "schedule.js", "layout.js", "drag.js"],
  });
});

// Bentuk api.records (README §5): put mengembalikan record publik, get → record atau null, onChange → off.
function fakeRecords() {
  const store = new Map();
  const listeners = new Set();
  const calls = { get: [], put: [], onChange: 0 };
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
      put(entity, id, data, opts) {
        calls.put.push([entity, id, data, opts]);
        const rec = { entity, id, scope: opts.scope, data: JSON.parse(JSON.stringify(data)), updated_at: "2026-11-01T00:00:00Z", version: ++ver, pending: true };
        store.set(entity + "/" + id, rec);
        return Promise.resolve(JSON.parse(JSON.stringify(rec)));
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
  assert.deepEqual(r, { data: T.TLCal.DEFAULT_CAL, pending: false });
  assert.deepEqual(fr.calls.get, [["calendar", "cal@user"]]);
  // data anggota lain dinormalisasi (weekdays kosong → bawaan, kunci asing dibuang)
  fr.store.set("calendar/cal@list:7", { entity: "calendar", id: "cal@list:7", scope: "list:7", pending: true, data: { v: 1, weekdays: [], national: false, extra: 1, off: [{ d: "2026-12-24", n: "Libur kantor" }, { d: "bukan", n: "x" }], work: [] } });
  const r2 = await store.load("cal@list:7");
  assert.equal(r2.pending, true);
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
  assert.deepEqual(res, { data, pending: true });
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

test("calendarStore adalah satu-satunya yang menyentuh api.records", () => {
  const hits = jsx.match(/\.records\b/g) || [];
  assert.ok(hits.length > 0);
  const start = jsx.indexOf("function calendarStore(");
  const end = jsx.indexOf("\n}\n", start);
  assert.ok(start > 0 && end > start);
  const outside = jsx.slice(0, start) + jsx.slice(end);
  assert.doesNotMatch(outside.replace(/\/\/[^\n]*/g, ""), /api\.records|\.records\./);
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
      if (!s.set) s.set = (nv) => { setCalls.push(k); s.v = typeof nv === "function" ? nv(s.v) : nv; };
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
  const calls = { storageGet: [], storageSet: [], toast: [], warn: [] };
  const api = {
    id: "timeline",
    records: fr.api,
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
  assert.deepEqual(cells3, ["2.1", "Wireframe", "Sen 2 Nov", "3 hk", "2/4", "40%"]);
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

const headerCells = (tree) => nodes(tree, (n) => n.props.role === "columnheader").map((n) => txt(n).trim());

test("≤ 640 px / liveEdit: hanya WBS + Nama + tombol Kolom", async () => {
  const tasks = [mk(1, "A", { start: "2026-11-02", duration: 3 })];
  // lebar, tanpa Live Edit: semua kolom, tanpa tombol Kolom / Gantt|Daftar
  {
    const { api } = fakeApi();
    const tree = mount(T.TimelineViewBody).render({ context: ctxOf(tasks).ctx, api });
    assert.deepEqual(headerCells(tree), ["WBS", "Nama", "Mulai", "Dur", "🍅", "%"]);
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
    assert.deepEqual(headerCells(tree), ["WBS", "Nama", "Mulai", "Dur", "🍅", "%"]);
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
