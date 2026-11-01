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

// ── Fix round 1: jalur gulir dengan elemen palsu (ref) + rAF sinkron (requestAnimationFrame tidak ada di Node → raf
// menjalankan callback langsung). window palsu agar useLayoutEffect mengukur wadah.
const TABLE_W_FULL = 56 + 220 + 92 + 56 + 52 + 56; // COLS_FULL

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

test("gulir: pertama dibuka → hari ini di 1/3 lebar grafik; setState hanya saat baris/kolom pertama berubah", () => withWindow(async () => {
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
  assert.equal(m.setCalls.length, n0, "gulir dalam baris yang sama → tanpa setState");
  el.scrollTop = 33; onScroll(); // baris pertama 0 → 1
  assert.equal(m.setCalls.length, n0 + 1);
  el.scrollTop = 40; onScroll();
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
  assert.equal(renderedRowKeys(tree)[0], lay.rows[90].key, "jendela mulai di baris 100 − 10");
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
  const { api, calls } = fakeApi();
  calls.set = [];
  calls.setMany = [];
  api.taskExt.set = (id, p) => { calls.set.push([id, p]); return opts.set ? opts.set(id, p) : Promise.resolve(); };
  api.taskExt.setMany = (items) => { calls.setMany.push(items); return opts.setMany ? opts.setMany(items) : Promise.resolve(); };
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
  await tick();
  tree = m.render(props);
  wire(tree);
  m.flush();
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
  assert.deepEqual(h.calls.set, [[1, { start: "2026-11-09" }]]);
  assert.equal(w.gesture(), 0, "pendengar dilepas setelah lepas");
  assert.equal(h.tip.style.display, "none");
  h.bar("1").props.onClick({}); // klik sesudah seret tidak membuka task
  assert.deepEqual(h.clicked, []);
  await tick();
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
  assert.deepEqual(h.calls.set[1], [2, { duration: 3 }]);
  await tick();
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
  assert.deepEqual(h.calls.set, [[2, { deps: [old, { t: { $task: 1 }, type: "FS", lag: 0 }] }]]);
  assert.equal(h.rubber.style.display, "none", "garis karet disembunyikan setelah lepas");
  await tick();
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
  assert.deepEqual(h.calls.set, []);
  slot.props.onPointerDown(pev(x, y));
  w.fire("pointerup", pev(x + 1, y));
  assert.deepEqual(h.calls.set, [[4, { start: "2026-11-09", duration: 1 }]]);
  assert.equal(w.gesture(), 0);
  await tick();
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
  assert.deepEqual(h2.calls.set, []);
  s2.props.onPointerDown(pev(x2, y2, touch));
  w.fire("pointerup", pev(x2, y2, touch));
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
  assert.deepEqual(h.calls.set, [[1, { start: "2026-11-09" }]]);
  assert.equal(prevented, 1, "Alt+← / Alt+→ tidak menjadi navigasi peramban");
  // tombol ditahan (repeat) saat tulis masih berjalan → diabaikan
  h.bar("1").props.onKeyDown(kev("ArrowRight", { repeat: true }));
  assert.equal(h.calls.set.length, 1);
  release();
  await tick();
  // props belum mengikuti (task di context masih Jumat) → dihitung dari nilai optimistis Senin
  h.bar("1").props.onKeyDown(kev("ArrowRight", { repeat: true }));
  assert.deepEqual(h.calls.set[1], [1, { start: "2026-11-10" }]);
  release();
  await tick();
  const t = h.calls.toast[h.calls.toast.length - 1];
  t[2].onClick();
  await tick();
  assert.deepEqual(h.calls.setMany[0], [{ taskId: 1, patch: { start: "2026-11-09" } }], "Urungkan = nilai sebelum tekan ini");
  h.bar("1").props.onKeyDown(kev("ArrowLeft", { shiftKey: true }));
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
  assert.equal(h.calls.set.length, 1);
  await tick();
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
  pending.shift()();
  await tick();
  const undo1 = h.calls.toast[h.calls.toast.length - 1][2].onClick;
  h.bar("1").props.onKeyDown(kev("ArrowLeft", { shiftKey: true })); // tulis kedua berjalan
  assert.equal(h.calls.set.length, 2);
  undo1();
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
