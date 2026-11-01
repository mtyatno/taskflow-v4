// Plugin Timeline (Fase 1, PR 1b) — Task 10: seksi "Jadwal" di detail task (slot taskDetail.sections).
// Spec docs/superpowers/specs/2026-10-31-plugin-fase1-timeline-design.md §8.8 + keputusan pemilik Q5; rencana R7, R8,
// R10, R15, R16, R17. React palsu + dispatcher hooks palsu (pola timeline_ui.test.js): pohon = {type, props, children}.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dir = path.join(__dirname, "../../static/plugins/timeline");
const jsx = fs.readFileSync(path.join(dir, "plugin.jsx"), "utf8");
const css = fs.readFileSync(path.join(dir, "style.css"), "utf8");
const T = require(path.join(dir, "plugin.js"));
// Debounce Mulai (fix round 1): 700 ms di aplikasi, dipendekkan di tes (objek waktu yang bisa diganti, pola `engine`).
const DEBOUNCE = 30;
T.SEC_TIMING.startDebounceMs = DEBOUNCE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── React palsu ────────────────────────────────────────────────────────────
function sameDeps(a, b) {
  return !!a && !!b && a.length === b.length && a.every((d, i) => Object.is(d, b[i]));
}

function mount(Comp) {
  const slots = [];
  const pending = [];
  let i = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    Fragment: "#fragment",
    memo: (c) => c,
    useState(init) {
      const k = i++;
      if (!slots[k]) slots[k] = { v: typeof init === "function" ? init() : init };
      const s = slots[k];
      if (!s.set) s.set = (nv) => { s.v = typeof nv === "function" ? nv(s.v) : nv; };
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
      slots[k].cleanup = fn();
    });
  }
  return {
    render(props) {
      const prevR = global.React;
      global.React = React;
      i = 0;
      try {
        // render ulang selama komponen memanggil setState saat render (pola state turunan React)
        let out = Comp(props);
        return out;
      } finally { global.React = prevR; }
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
const byLabel = (tree, l) => nodes(tree, (n) => n.props["aria-label"] === l)[0];
const buttonByText = (tree, t) => nodes(tree, (n) => n.type === "button" && txt(n).trim() === t)[0];
const inputs = (tree) => nodes(tree, (n) => n.type === "input");
const tick = () => new Promise((r) => setTimeout(r, 0));
const ev = (value, extra) => Object.assign({ target: Object.assign({ value, validity: { badInput: false } }, extra || {}), preventDefault() {} }, {});

// ── data + api palsu ───────────────────────────────────────────────────────
function ext(o) {
  const out = {};
  for (const k of Object.keys(o || {})) out["timeline." + k] = o[k];
  return out;
}
function mk(id, title, sched, extra) {
  return Object.assign({ id, title, created_at: "2026-10-01T00:00:00Z", gtd_status: "next", ext: ext(sched) }, extra || {});
}

function fakeApi(o) {
  const opts = o || {};
  const calls = { set: [], list: [], storageGet: [], storageSet: [], toast: [], recGet: [], events: [], handlers: {} };
  const recs = new Map(Object.entries(opts.records || {}));
  let setImpl = opts.set || (() => Promise.resolve());
  const api = {
    id: "timeline",
    taskExt: {
      read(t) {
        const out = {};
        for (const k of Object.keys((t && t.ext) || {})) if (k.indexOf("timeline.") === 0) out[k.slice(9)] = JSON.parse(JSON.stringify(t.ext[k]));
        return out;
      },
      ref(t) {
        if (!t || (typeof t.id !== "number" && typeof t.id !== "string")) throw new TypeError("ref butuh task dengan id");
        return { $task: t.id };
      },
      set(id, patch) { calls.set.push([id, JSON.parse(JSON.stringify(patch))]); return setImpl(id, patch); },
      setMany: () => Promise.resolve(),
    },
    data: {
      tasks: {
        list(q) {
          calls.list.push(q);
          if (opts.listImpl) return opts.listImpl(q, calls.list.length);
          return Promise.resolve(JSON.parse(JSON.stringify(opts.tasks || [])));
        },
      },
    },
    records: {
      get(entity, id) {
        calls.recGet.push([entity, id]);
        const d = recs.get(id);
        return Promise.resolve(d ? { entity, id, scope: "x", data: d, updated_at: "", version: 1, pending: false } : null);
      },
      put: () => Promise.reject(new Error("tidak dipakai seksi")),
      onChange: () => () => {},
    },
    events: {
      on(name, fn) { calls.events.push(name); (calls.handlers[name] = calls.handlers[name] || []).push(fn); return () => {}; },
    },
    env: { today: () => "2026-11-04", online: true, userId: 1 },
    storage: {
      get(k) { calls.storageGet.push(k); return Promise.resolve(opts.storage ? opts.storage[k] : null); },
      set(k, v) { calls.storageSet.push([k, v]); return Promise.resolve(); },
    },
    ui: { toast: (...a) => calls.toast.push(a) },
    log: { info() {}, warn() {}, error() {} },
  };
  return { api, calls, setSet: (fn) => { setImpl = fn; } };
}

// ScheduleSection (penjaga tanpa hooks) dipanggil di luar mount → React global minimal untuk createElement.
function guard(props) {
  const prev = global.React;
  global.React = { createElement: (type, p, ...children) => ({ type, props: p || {}, children }) };
  try { return T.ScheduleSection(props); } finally { global.React = prev; }
}

// Pasang seksi: ScheduleSection = penjaga (tanpa hooks) → elemen ScheduleBody (berhook).
async function ui(task, o) {
  const opts = o || {};
  const f = fakeApi(opts);
  let ctx = { task, variant: opts.variant || "modal", collaborators: [], onOpenTask() {}, showToast() {} };
  const first = guard({ context: ctx, api: f.api });
  assert.ok(first && first.type, "seksi merender elemen");
  const m = mount(first.type);
  const s = {
    f,
    calls: f.calls,
    tree: null,
    render(nextTask) {
      if (nextTask !== undefined) ctx = Object.assign({}, ctx, { task: nextTask });
      const el = guard({ context: ctx, api: f.api });
      s.tree = el ? m.render(el.props) : null;
      m.flush();
      // render ulang sekali: setState selama efek/turunan state terlihat (React palsu tidak menjadwalkan ulang)
      s.tree = el ? m.render(el.props) : null;
      return s.tree;
    },
    async settle() {
      for (let k = 0; k < 4; k++) {
        await tick();
        s.render();
      }
      return s.tree;
    },
    m,
  };
  s.render();
  await s.settle();
  return s;
}

const D = (iso) => T.TLCal.dn(iso);

// ── tes ────────────────────────────────────────────────────────────────────
test("task berulang → null; task tanpa id → null (Q5, R17)", () => {
  const { api } = fakeApi();
  const base = { variant: "modal", collaborators: [], onOpenTask() {}, showToast() {} };
  assert.equal(guard({ context: Object.assign({ task: mk(1, "Harian", {}, { recurrence_type: "daily" }) }, base), api }), null);
  assert.equal(guard({ context: Object.assign({ task: { title: "Baru" } }, base), api }), null);
  assert.equal(guard({ context: Object.assign({ task: null }, base), api }), null);
  assert.equal(guard({ context: undefined, api }), null);
  const el = guard({ context: Object.assign({ task: mk(1, "Biasa", {}) }, base), api });
  assert.ok(el && typeof el.type === "function");
});

test("tingkat 1: Mulai kosong, Durasi nonaktif sampai Mulai diisi, tautan 'Tambah dependensi'; isi Mulai → set {start, duration: 1}", async () => {
  const task = mk(5, "Rencana", {});
  const s = await ui(task);
  const tree = s.tree;
  assert.ok(hasCls(tree, "plg-timeline-section"));
  assert.equal(txt(byCls(tree, "plg-timeline-sec-title")[0]).trim(), "Jadwal");
  const start = byLabel(tree, "Mulai");
  assert.equal(start.type, "input");
  assert.equal(start.props.type, "date");
  assert.equal(start.props.value, "");
  const dur = byLabel(tree, "Durasi (hari kerja)");
  assert.equal(dur.props.type, "number");
  assert.equal(dur.props.disabled, true);
  assert.ok(txt(tree).includes("hari kerja"));
  assert.ok(buttonByText(tree, "Tambah dependensi"), "tautan Tambah dependensi");
  assert.ok(buttonByText(tree, "Selengkapnya"), "tombol Selengkapnya");
  assert.equal(buttonByText(tree, "Selengkapnya").props["aria-expanded"], false);
  // tingkat 1 tidak menampilkan Selesai/Milestone/%
  assert.equal(byLabel(tree, "Milestone"), undefined);
  assert.ok(!txt(tree).includes("% selesai"));
  // tahun parsial saat mengetik (0002-…) tidak disimpan
  start.props.onChange(ev("0002-11-09"));
  s.render();
  assert.equal(s.calls.set.length, 0);
  byLabel(s.tree, "Mulai").props.onChange(ev("2026-11-09"));
  s.render();
  assert.equal(s.calls.set.length, 0, "tanggal sah tetap draf sampai blur/Enter/debounce");
  assert.equal(byLabel(s.tree, "Mulai").props.value, "2026-11-09");
  byLabel(s.tree, "Mulai").props.onBlur(ev("2026-11-09"));
  s.render();
  assert.deepEqual(s.calls.set, [[5, { start: "2026-11-09", duration: 1 }]]);
  assert.equal(byLabel(s.tree, "Mulai").props.value, "2026-11-09");
  assert.equal(byLabel(s.tree, "Durasi (hari kerja)").props.disabled, false);
  assert.equal(byLabel(s.tree, "Durasi (hari kerja)").props.value, "1");
  // blur setelah pilih: tidak menulis ulang
  byLabel(s.tree, "Mulai").props.onBlur(ev("2026-11-09"));
  s.render();
  assert.equal(s.calls.set.length, 1);
  // ganti Mulai saat sudah terjadwal → hanya start
  byLabel(s.tree, "Mulai").props.onChange(ev("2026-11-16"));
  s.render();
  byLabel(s.tree, "Mulai").props.onKeyDown({ key: "Enter", target: { value: "2026-11-16" }, preventDefault() {} });
  s.render();
  assert.deepEqual(s.calls.set[1], [5, { start: "2026-11-16" }]);
  await sleep(DEBOUNCE * 3);
  assert.equal(s.calls.set.length, 2, "Enter membatalkan debounce");
});

test("Durasi blur 5 → set {duration: 5}; 0 / 1000 / 'abc' → dijepit 1..999 tanpa set bila sama", async () => {
  const s = await ui(mk(6, "Bangun", { start: "2026-11-02", duration: 3 }));
  const dur = () => byLabel(s.tree, "Durasi (hari kerja)");
  assert.equal(dur().props.value, "3");
  dur().props.onChange(ev("5"));
  s.render();
  assert.equal(s.calls.set.length, 0, "tidak menyimpan per ketikan");
  assert.equal(dur().props.value, "5");
  dur().props.onBlur(ev("5"));
  s.render();
  assert.deepEqual(s.calls.set, [[6, { duration: 5 }]]);
  // 0 → 1
  dur().props.onChange(ev("0"));
  s.render();
  dur().props.onBlur(ev("0"));
  s.render();
  assert.deepEqual(s.calls.set[1], [6, { duration: 1 }]);
  assert.equal(dur().props.value, "1");
  // 0 lagi → dijepit 1 = sama → tanpa set; tampilan kembali "1"
  dur().props.onChange(ev("0"));
  s.render();
  dur().props.onBlur(ev("0"));
  s.render();
  assert.equal(s.calls.set.length, 2);
  assert.equal(dur().props.value, "1");
  // 1000 → 999
  dur().props.onChange(ev("1000"));
  s.render();
  dur().props.onBlur(ev("1000"));
  s.render();
  assert.deepEqual(s.calls.set[2], [6, { duration: 999 }]);
  // 'abc' → kembali ke nilai sekarang, tanpa set
  dur().props.onChange(ev("abc"));
  s.render();
  dur().props.onBlur(ev("abc"));
  s.render();
  assert.equal(s.calls.set.length, 3);
  assert.equal(dur().props.value, "999");
  // Enter = simpan
  dur().props.onChange(ev("4"));
  s.render();
  dur().props.onKeyDown({ key: "Enter", target: { value: "4", blur() {} }, preventDefault() {} });
  s.render();
  assert.deepEqual(s.calls.set[3], [6, { duration: 4 }]);
});

test("kosongkan Mulai → set {start: null, duration: null}; tanggal setengah diketik (badInput) tidak menghapus", async () => {
  const s = await ui(mk(7, "Uji", { start: "2026-11-02", duration: 3, deps: [{ t: { $task: 1 }, type: "FS", lag: 0 }] }));
  const start = () => byLabel(s.tree, "Mulai");
  start().props.onChange(ev(""));
  s.render();
  assert.equal(s.calls.set.length, 0, "kosong saat mengetik belum disimpan");
  start().props.onBlur(ev("", { validity: { badInput: true } }));
  s.render();
  assert.equal(s.calls.set.length, 0, "tanggal setengah jadi tidak menghapus jadwal");
  assert.equal(start().props.value, "2026-11-02");
  start().props.onChange(ev(""));
  s.render();
  start().props.onBlur(ev(""));
  s.render();
  assert.deepEqual(s.calls.set, [[7, { start: null, duration: null }]], "deps dipertahankan (R7)");
  assert.equal(byLabel(s.tree, "Durasi (hari kerja)").props.disabled, true);
});

test("Selengkapnya: Selesai terhitung (fmtLong), Milestone mencentang → set {duration: 0} dan Durasi nonaktif; % baca saja + petunjuk persis; status buka disimpan section:open", async () => {
  const s = await ui(mk(8, "Desain UI", { start: "2026-11-05", duration: 4 }, { progress: 40 }));
  assert.ok(s.calls.storageGet.includes("section:open"));
  buttonByText(s.tree, "Selengkapnya").props.onClick();
  s.render();
  await tick();
  assert.deepEqual(s.calls.storageSet, [["section:open", true]]);
  const more = nodes(s.tree, (n) => n.type === "button" && n.props["aria-expanded"] === true)[0];
  assert.ok(more, "tombol buka/tutup aria-expanded true");
  // Kam 5 Nov + 4 hk = Kam, Jum, Sen, Sel → Selasa, 10 November 2026
  const fin = nodes(s.tree, (n) => n.props["data-field"] === "finish")[0];
  assert.equal(txt(fin).trim(), T.TLCal.fmtLong(D("2026-11-10")));
  assert.equal(txt(fin).trim(), "Selasa, 10 November 2026");
  const pct = nodes(s.tree, (n) => n.props["data-field"] === "pct")[0];
  assert.equal(txt(pct).trim(), "40%");
  assert.equal(pct.type === "input", false, "% bukan input");
  assert.ok(txt(s.tree).includes("% selesai"));
  assert.ok(txt(s.tree).includes("Ubah lewat progres di atas"));
  const ms = byLabel(s.tree, "Milestone");
  assert.equal(ms.props.type, "checkbox");
  assert.equal(ms.props.checked, false);
  ms.props.onChange({ target: { checked: true } });
  s.render();
  assert.deepEqual(s.calls.set, [[8, { duration: 0 }]]);
  assert.equal(byLabel(s.tree, "Milestone").props.checked, true);
  assert.equal(byLabel(s.tree, "Durasi (hari kerja)").props.disabled, true);
  assert.equal(txt(nodes(s.tree, (n) => n.props["data-field"] === "finish")[0]).trim(), "Kamis, 5 November 2026");
  byLabel(s.tree, "Milestone").props.onChange({ target: { checked: false } });
  s.render();
  assert.deepEqual(s.calls.set[1], [8, { duration: 4 }], "durasi bukan-nol terakhir (fix 4)");
  // tutup → section:open false
  nodes(s.tree, (n) => n.type === "button" && n.props["aria-expanded"] === true)[0].props.onClick();
  s.render();
  await tick();
  assert.deepEqual(s.calls.storageSet[1], ["section:open", false]);
  assert.equal(byLabel(s.tree, "Milestone"), undefined);
  // plugin tidak pernah menulis kolom host
  for (const [, p] of s.calls.set) for (const k of Object.keys(p)) assert.ok(["start", "duration", "deps"].includes(k), k);
});

test("section:open tersimpan true → langsung terbuka; task tanpa jadwal: Selesai '—', Milestone nonaktif", async () => {
  const s = await ui(mk(9, "Belum", {}, { progress: 0, gtd_status: "done" }), { storage: { "section:open": true } });
  assert.equal(txt(nodes(s.tree, (n) => n.props["data-field"] === "finish")[0]).trim(), "—");
  assert.equal(byLabel(s.tree, "Milestone").props.disabled, true);
  assert.equal(txt(nodes(s.tree, (n) => n.props["data-field"] === "pct")[0]).trim(), "100%", "task selesai = 100%");
});

const SCOPE = { list_id: 7 };
function depTasks() {
  return [
    mk(1, "Desain", { start: "2026-11-02", duration: 3 }, SCOPE), // Sen 2 – Rab 4
    mk(2, "Riset", { start: "2026-10-26", duration: 2 }, { list_id: 8 }), // workspace lain
    mk(3, "Kode", {}, SCOPE),
  ];
}

test("dependensi: daftar judul + FS + lag; ubah lag blur → set deps; hapus → set deps tanpa item; ref tak ditemukan → '(task sudah dihapus)'", async () => {
  const deps = [
    { t: { $task: 1 }, type: "FS", lag: 2 },
    { t: { $task: 2 }, type: "FS", lag: 0 },
    { t: { $task: 99 }, type: "FS", lag: 0 },
  ];
  const task = mk(10, "Uji", { start: "2026-11-16", duration: 2, deps }, SCOPE);
  const s = await ui(task, { tasks: depTasks().concat([task]), storage: { "section:open": true } });
  const items = byCls(s.tree, "plg-timeline-dep");
  assert.equal(items.length, 3);
  const name = (n) => txt(byCls(n, "plg-timeline-dep-name")[0]).trim();
  assert.equal(name(items[0]), "Desain");
  assert.ok(name(items[1]).includes("Riset") && txt(items[1]).includes("(task di luar halaman ini)"));
  assert.equal(name(items[2]), "(task sudah dihapus)");
  for (const it of items) assert.equal(txt(byCls(it, "plg-timeline-dep-type")[0]).trim(), "FS");
  const lag = byLabel(items[0], "Jeda setelah Desain (hari kerja)");
  assert.equal(lag.props.value, "2");
  lag.props.onChange(ev("5"));
  s.render();
  assert.equal(s.calls.set.length, 0);
  byLabel(s.tree, "Jeda setelah Desain (hari kerja)").props.onBlur(ev("5"));
  s.render();
  assert.deepEqual(s.calls.set, [[10, { deps: [{ t: { $task: 1 }, type: "FS", lag: 5 }, deps[1], deps[2]] }]]);
  // lag dijepit −99..999
  byLabel(s.tree, "Jeda setelah Desain (hari kerja)").props.onChange(ev("-500"));
  s.render();
  byLabel(s.tree, "Jeda setelah Desain (hari kerja)").props.onBlur(ev("-500"));
  s.render();
  assert.equal(s.calls.set[1][1].deps[0].lag, -99);
  // hapus yang sudah dihapus (ref 99)
  byLabel(s.tree, "Hapus dependensi (task sudah dihapus)").props.onClick();
  s.render();
  assert.deepEqual(s.calls.set[2], [10, { deps: [{ t: { $task: 1 }, type: "FS", lag: -99 }, deps[1]] }]);
  assert.equal(byCls(s.tree, "plg-timeline-dep").length, 2);
  // hapus semua → kunci deps dihapus (null)
  byLabel(s.tree, "Hapus dependensi Riset").props.onClick();
  s.render();
  byLabel(s.tree, "Hapus dependensi Desain").props.onClick();
  s.render();
  assert.deepEqual(s.calls.set[4], [10, { deps: null }]);
  assert.equal(byCls(s.tree, "plg-timeline-dep").length, 0);
});

test("dependensi rusak/tidak dikenali: dihitung, tombol 'Hapus dependensi rusak' menyimpan hanya yang sah (apa adanya)", async () => {
  const good = { t: { $task: 1 }, type: "FS", lag: 1 };
  const deps = [good, { t: { $task: 3 }, type: "SS", lag: 0 }, { t: null, type: "FS" }, "x"];
  const task = mk(11, "Uji", { start: "2026-11-16", duration: 1, deps }, SCOPE);
  const s = await ui(task, { tasks: depTasks().concat([task]), storage: { "section:open": true } });
  assert.equal(byCls(s.tree, "plg-timeline-dep").length, 1);
  const note = byCls(s.tree, "plg-timeline-sec-bad")[0];
  assert.ok(note && txt(note).includes("3 dependensi rusak"), txt(note));
  buttonByText(s.tree, "Hapus dependensi rusak").props.onClick();
  s.render();
  assert.deepEqual(s.calls.set, [[11, { deps: [good] }]]);
  assert.equal(byCls(s.tree, "plg-timeline-sec-bad").length, 0);
  // ubah lag item sah mempertahankan item lain apa adanya (kebijakan Task 8)
  const s2 = await ui(mk(12, "Uji2", { start: "2026-11-16", duration: 1, deps }, SCOPE), { tasks: depTasks(), storage: { "section:open": true } });
  byLabel(s2.tree, "Jeda setelah Desain (hari kerja)").props.onChange(ev("3"));
  s2.render();
  byLabel(s2.tree, "Jeda setelah Desain (hari kerja)").props.onBlur(ev("3"));
  s2.render();
  assert.deepEqual(s2.calls.set, [[12, { deps: [{ t: { $task: 1 }, type: "FS", lag: 3 }, deps[1], deps[2], deps[3]] }]]);
});

test("pemilih: memuat api.data.tasks.list({includeDone: true}) sekali saat dibuka; hanya scope sama (R15); siklus → toast persis", async () => {
  const self = mk(20, "Integrasi", { start: "2026-11-16", duration: 2, deps: [{ t: { $task: 1 }, type: "FS", lag: 0 }] }, SCOPE);
  const others = [
    mk(1, "Desain", { start: "2026-11-02", duration: 3 }, SCOPE),
    mk(21, "Uji coba", { deps: [{ t: { $task: 20 }, type: "FS", lag: 0 }] }, SCOPE), // penerus self → siklus
    mk(22, "Dokumentasi", {}, SCOPE),
    mk(23, "Riset pasar", {}, { list_id: 8 }), // workspace lain
    mk(24, "Harian", {}, Object.assign({ recurrence_type: "daily" }, SCOPE)),
    mk(25, "Induk", {}, SCOPE),
    mk(26, "Anak", {}, Object.assign({ parent_id: 25 }, SCOPE)),
    mk(27, "Arsip", {}, Object.assign({ gtd_status: "archived" }, SCOPE)),
    mk(28, "Selesai lama", {}, Object.assign({ gtd_status: "done" }, SCOPE)),
  ];
  const s = await ui(self, { tasks: others.concat([self]) });
  const before = s.calls.list.length;
  assert.ok(s.calls.list.every((q) => q && q.includeDone === true));
  buttonByText(s.tree, "Tambah dependensi").props.onClick();
  s.render();
  await s.settle();
  assert.equal(s.calls.list.length, before + 1, "satu muat saat pemilih dibuka");
  assert.deepEqual(s.calls.list[s.calls.list.length - 1], { includeDone: true });
  const picks = () => byCls(s.tree, "plg-timeline-pick").map((n) => n.props["data-key"]);
  // scope sama, bukan diri sendiri / berulang / arsip / ringkasan (induk yang punya anak)
  assert.deepEqual(picks().sort(), ["1", "21", "22", "26", "28"]);
  // pencarian judul (tanpa memuat ulang)
  byLabel(s.tree, "Cari task").props.onChange(ev("uji"));
  s.render();
  assert.deepEqual(picks(), ["21"]);
  assert.equal(s.calls.list.length, before + 1);
  // siklus
  byCls(s.tree, "plg-timeline-pick")[0].props.onClick();
  s.render();
  assert.equal(s.calls.set.length, 0);
  assert.deepEqual(s.calls.toast[s.calls.toast.length - 1], ["Dependensi ini membuat lingkaran", "error"]);
  // sudah ada (Desain) → toast persis
  byLabel(s.tree, "Cari task").props.onChange(ev("desain"));
  s.render();
  byCls(s.tree, "plg-timeline-pick")[0].props.onClick();
  s.render();
  assert.equal(s.calls.set.length, 0);
  assert.deepEqual(s.calls.toast[s.calls.toast.length - 1], ["Dependensi ini sudah ada", "error"]);
  // sah → deps lama apa adanya + item baru FS lag 0; pemilih tertutup; seksi terbuka menampilkan daftar
  byLabel(s.tree, "Cari task").props.onChange(ev("dok"));
  s.render();
  byCls(s.tree, "plg-timeline-pick")[0].props.onClick();
  s.render();
  assert.deepEqual(s.calls.set, [[20, { deps: [{ t: { $task: 1 }, type: "FS", lag: 0 }, { t: { $task: 22 }, type: "FS", lag: 0 }] }]]);
  assert.equal(byCls(s.tree, "plg-timeline-picker").length, 0);
  assert.deepEqual(byCls(s.tree, "plg-timeline-dep").map((n) => txt(byCls(n, "plg-timeline-dep-name")[0]).trim()), ["Desain", "Dokumentasi"]);
});

test("pemilih: ≤ 50 hasil; maksimal 20 dependensi → toast persis; ref cid basi kanonik lewat buildIndex", async () => {
  const many = [];
  for (let k = 100; k < 180; k++) many.push(mk(k, "Task " + k, {}, SCOPE));
  const self = mk(30, "Banyak", { deps: many.slice(0, 20).map((t) => ({ t: { $task: t.id }, type: "FS", lag: 0 })) }, SCOPE);
  const s = await ui(self, { tasks: many.concat([self]) });
  buttonByText(s.tree, "Tambah dependensi").props.onClick();
  s.render();
  await s.settle();
  assert.equal(byCls(s.tree, "plg-timeline-pick").length, 50);
  byLabel(s.tree, "Cari task").props.onChange(ev("Task 150"));
  s.render();
  byCls(s.tree, "plg-timeline-pick")[0].props.onClick();
  s.render();
  assert.equal(s.calls.set.length, 0);
  assert.deepEqual(s.calls.toast[s.calls.toast.length - 1], ["Maksimal 20 dependensi per task", "error"]);
  // salinan modal basi: task masih ber-id cid, daftar sudah ber-id server dengan cid lama; dep tersimpan pakai cid
  const stale = mk("c-abc", "Basi", { deps: [{ t: { $task: "c-pred" }, type: "FS", lag: 0 }] }, SCOPE);
  const fresh = Object.assign({}, stale, { id: 40, cid: "c-abc" });
  const pred = mk(41, "Pendahulu", {}, Object.assign({ cid: "c-pred" }, SCOPE));
  const s2 = await ui(stale, { tasks: [fresh, pred] });
  buttonByText(s2.tree, "Tambah dependensi").props.onClick();
  s2.render();
  await s2.settle();
  const picks = byCls(s2.tree, "plg-timeline-pick").map((n) => n.props["data-key"]);
  assert.deepEqual(picks, ["41"], "diri sendiri (cid lama) tidak muncul");
  byCls(s2.tree, "plg-timeline-pick")[0].props.onClick();
  s2.render();
  assert.deepEqual(s2.calls.toast[s2.calls.toast.length - 1], ["Dependensi ini sudah ada", "error"], "cid lama = task yang sama");
  assert.equal(s2.calls.set.length, 0);
});

test("peringatan tenggat persis 'Selesai Sel 10 Nov, 2 hari kerja setelah tenggat'", async () => {
  const s = await ui(mk(50, "Rilis", { start: "2026-11-05", duration: 4 }, { deadline: "2026-11-06T00:00:00" }), { storage: { "section:open": true } });
  const warn = byCls(s.tree, "plg-timeline-sec-warn");
  assert.equal(warn.length, 1);
  assert.equal(txt(warn[0]).replace(/^⚠\s*/, "").trim(), "Selesai Sel 10 Nov, 2 hari kerja setelah tenggat");
  // tepat waktu → tanpa peringatan
  const s2 = await ui(mk(51, "Rilis", { start: "2026-11-05", duration: 2 }, { deadline: "2026-11-06" }), { storage: { "section:open": true } });
  assert.equal(byCls(s2.tree, "plg-timeline-sec-warn").length, 0);
});

test("pelanggaran → tombol 'Geser ke setelah dependensi' → set {start: shiftAfterDeps}", async () => {
  // Desain Sen 2 – Rab 4; penerus mulai Rab 4 dengan FS lag 1 → paling awal Jum 6
  const task = mk(60, "Kode", { start: "2026-11-04", duration: 2, deps: [{ t: { $task: 1 }, type: "FS", lag: 1 }] }, SCOPE);
  const s = await ui(task, { tasks: depTasks().concat([task]), storage: { "section:open": true } });
  const warn = byCls(s.tree, "plg-timeline-sec-warn");
  assert.ok(warn.some((w) => txt(w).includes("Mulai sebelum dependensi selesai")));
  const btn = buttonByText(s.tree, "Geser ke setelah dependensi");
  assert.ok(btn);
  btn.props.onClick();
  s.render();
  const c = T.TLCal.compile(T.TLCal.DEFAULT_CAL);
  const expected = T.TLSched.shiftAfterDeps(c, null, [{ span: { s: D("2026-11-02"), f: D("2026-11-04") }, lag: 1 }]);
  assert.equal(expected, "2026-11-06");
  assert.deepEqual(s.calls.set, [[60, { start: expected }]]);
  assert.equal(buttonByText(s.tree, "Geser ke setelah dependensi"), undefined, "pelanggaran hilang setelah digeser");
});

test("kalender task: workspace → cal@list:<id>; Senin libur workspace menggeser Selesai", async () => {
  const cal = { v: 1, weekdays: [2, 3, 4, 5, 6], national: true, cutiBersama: true, off: [], work: [] };
  const s = await ui(mk(70, "WS", { start: "2026-11-06", duration: 2 }, { list_id: 7 }), { records: { "cal@list:7": cal }, storage: { "section:open": true } });
  assert.deepEqual(s.calls.recGet[0], ["calendar", "cal@list:7"]);
  // Jum 6 + 2 hk (Sel–Sab kerja) = Jum 6, Sab 7
  assert.equal(txt(nodes(s.tree, (n) => n.props["data-field"] === "finish")[0]).trim(), "Sabtu, 7 November 2026");
  const s2 = await ui(mk(71, "Pribadi", { start: "2026-11-06", duration: 2 }), { storage: { "section:open": true } });
  assert.deepEqual(s2.calls.recGet[0], ["calendar", "cal@user"]);
  assert.equal(txt(nodes(s2.tree, (n) => n.props["data-field"] === "finish")[0]).trim(), "Senin, 9 November 2026");
});

test("task ringkasan (punya anak di api.data.tasks) → 'Jadwal task ini mengikuti subtask-nya' + rentang, tanpa input", async () => {
  const parent = mk(80, "Fase 1", { start: "2026-12-01", duration: 9 }, SCOPE);
  const kids = [
    mk(81, "A", { start: "2026-11-02", duration: 3 }, Object.assign({ parent_id: 80 }, SCOPE)),
    mk(82, "B", {}, Object.assign({ parent_id: 80 }, SCOPE)),
    mk(83, "B1", { start: "2026-11-09", duration: 2 }, Object.assign({ parent_id: 82 }, SCOPE)),
  ];
  const s = await ui(parent, { tasks: [parent].concat(kids) });
  assert.ok(txt(s.tree).includes("Jadwal task ini mengikuti subtask-nya"));
  // rentang rekursif Sen 2 – Sel 10 Nov = 7 hari kerja
  const range = byCls(s.tree, "plg-timeline-sec-range")[0];
  assert.equal(txt(range).trim(), "Sen 2 Nov → Sel 10 Nov · 7 hari kerja");
  assert.equal(inputs(s.tree).length, 0);
  assert.equal(buttonByText(s.tree, "Tambah dependensi"), undefined);
  assert.equal(s.calls.set.length, 0);
  // anak berulang/arsip tidak menjadikan ringkasan
  const lone = mk(90, "Sendiri", {}, SCOPE);
  const s2 = await ui(lone, { tasks: [lone, mk(91, "Harian", {}, Object.assign({ parent_id: 90, recurrence_type: "daily" }, SCOPE))] });
  assert.ok(!txt(s2.tree).includes("Jadwal task ini mengikuti subtask-nya"));
  assert.ok(byLabel(s2.tree, "Mulai"));
});

test("props task sama id dengan ext berubah (sinkron) → nilai lokal di-seed ulang; props sama → nilai lokal yang baru disimpan tetap (modal snapshot)", async () => {
  const p0 = mk(100, "Snap", { start: "2026-11-02", duration: 3 });
  const s = await ui(p0);
  byLabel(s.tree, "Mulai").props.onChange(ev("2026-11-09"));
  byLabel(s.tree, "Mulai").props.onBlur(ev("2026-11-09"));
  s.render();
  await s.settle();
  // modal: props tetap salinan lama → nilai lokal tidak kembali
  s.render(p0);
  s.render(Object.assign({}, p0));
  assert.equal(byLabel(s.tree, "Mulai").props.value, "2026-11-09");
  assert.equal(byLabel(s.tree, "Durasi (hari kerja)").props.value, "3");
  // durasi lokal yang belum di-blur tetap selama props sama
  byLabel(s.tree, "Durasi (hari kerja)").props.onChange(ev("7"));
  s.render(p0);
  assert.equal(byLabel(s.tree, "Durasi (hari kerja)").props.value, "7");
  byLabel(s.tree, "Durasi (hari kerja)").props.onBlur(ev("7"));
  s.render(p0);
  // sinkron dari perangkat lain selama tulis masih berjalan: ditunda sampai tulis selesai (nilai lokal tidak berkedip)
  const p1 = mk(100, "Snap", { start: "2026-11-23", duration: 5 });
  s.render(p1);
  assert.equal(byLabel(s.tree, "Mulai").props.value, "2026-11-09");
  await s.settle(); // tulis selesai → render ulang → props p1 men-seed
  assert.equal(byLabel(s.tree, "Mulai").props.value, "2026-11-23");
  assert.equal(byLabel(s.tree, "Durasi (hari kerja)").props.value, "5");
  // task lain di instance yang sama → seed ulang
  s.render(mk(101, "Lain", {}));
  assert.equal(byLabel(s.tree, "Mulai").props.value, "");
  assert.equal(byLabel(s.tree, "Durasi (hari kerja)").props.disabled, true);
});

test("tulis gagal → nilai lokal kembali + toast 'Jadwal gagal disimpan'", async () => {
  const s = await ui(mk(110, "Gagal", { start: "2026-11-02", duration: 3 }));
  s.f.setSet(() => Promise.reject(new Error("x")));
  byLabel(s.tree, "Mulai").props.onChange(ev("2026-11-09"));
  byLabel(s.tree, "Mulai").props.onBlur(ev("2026-11-09"));
  s.render();
  assert.equal(byLabel(s.tree, "Mulai").props.value, "2026-11-09");
  await s.settle();
  assert.equal(byLabel(s.tree, "Mulai").props.value, "2026-11-02");
  assert.deepEqual(s.calls.toast[s.calls.toast.length - 1], ["Jadwal gagal disimpan", "error"]);
});

test("variant panel dan modal merender sama", async () => {
  const tasks = depTasks();
  const task = mk(120, "Sama", { start: "2026-11-05", duration: 4, deps: [{ t: { $task: 1 }, type: "FS", lag: 0 }] }, Object.assign({ deadline: "2026-11-06", progress: 25 }, SCOPE));
  const strip = (n) => JSON.stringify(n, (k, v) => (typeof v === "function" ? "fn" : v));
  const a = await ui(task, { tasks: tasks.concat([task]), variant: "modal", storage: { "section:open": true } });
  const b = await ui(task, { tasks: tasks.concat([task]), variant: "panel", storage: { "section:open": true } });
  assert.equal(strip(a.tree), strip(b.tree));
});

test("sumber: teks persis seksi, kelas .plg-timeline-*, tanpa tulis kolom host", () => {
  for (const t of ['"Jadwal"', '"Mulai"', '"Durasi"', '"hari kerja"', '"Tambah dependensi"', '"Selengkapnya"', '"Selesai"', '"Milestone"', '"% selesai"', '"Ubah lewat progres di atas"', '"Geser ke setelah dependensi"', '"Jadwal task ini mengikuti subtask-nya"', '"(task di luar halaman ini)"', '"(task sudah dihapus)"', '"Dependensi ini sudah ada"', '"Hapus dependensi rusak"']) assert.ok(jsx.includes(t), t);
  const start = jsx.indexOf("// 4g.");
  assert.ok(start > 0, "blok seksi 4g");
  const block = jsx.slice(start, jsx.indexOf("// React.memo dibuat malas", start));
  assert.doesNotMatch(block, /progress\s*:|deadline\s*:|\.records\b/, "seksi tidak menulis progress/deadline dan tidak menyentuh api.records");
  assert.match(css, /\.plg-timeline-section\b/);
  assert.match(css, /\.plg-timeline-picker\b/);
});

// ════════════════════════════════════════════════════════════════════════════
// Fix round 1 (review Task 10)
// ════════════════════════════════════════════════════════════════════════════

test("fix 1: Mulai — dua perubahan cepat (ketik hari '3','0') → satu set dengan tanggal akhir setelah debounce", async () => {
  const s = await ui(mk(200, "Ketik", { start: "2026-11-02", duration: 2 }));
  byLabel(s.tree, "Mulai").props.onChange(ev("2026-11-03"));
  s.render();
  byLabel(s.tree, "Mulai").props.onChange(ev("2026-11-30"));
  s.render();
  assert.equal(s.calls.set.length, 0, "tidak menulis per ketikan");
  assert.equal(byLabel(s.tree, "Mulai").props.value, "2026-11-30");
  await sleep(DEBOUNCE * 3);
  s.render();
  assert.deepEqual(s.calls.set, [[200, { start: "2026-11-30" }]]);
});

test("fix 1: pilih dari kalender bawaan (satu change) → satu set setelah debounce; blur menyimpan langsung dan membatalkan debounce", async () => {
  const s = await ui(mk(201, "Pilih", {}));
  byLabel(s.tree, "Mulai").props.onChange(ev("2026-11-10"));
  s.render();
  assert.equal(s.calls.set.length, 0);
  await sleep(DEBOUNCE * 3);
  s.render();
  assert.deepEqual(s.calls.set, [[201, { start: "2026-11-10", duration: 1 }]]);
  // blur: langsung, debounce dibatalkan (tidak ada tulis kedua)
  byLabel(s.tree, "Mulai").props.onChange(ev("2026-11-17"));
  s.render();
  byLabel(s.tree, "Mulai").props.onBlur(ev("2026-11-17"));
  s.render();
  assert.deepEqual(s.calls.set[1], [201, { start: "2026-11-17" }]);
  await sleep(DEBOUNCE * 3);
  assert.equal(s.calls.set.length, 2);
  // tahun parsial membatalkan debounce yang tertunda
  byLabel(s.tree, "Mulai").props.onChange(ev("2026-11-24"));
  byLabel(s.tree, "Mulai").props.onChange(ev("0002-11-24"));
  s.render();
  await sleep(DEBOUNCE * 3);
  assert.equal(s.calls.set.length, 2);
});

test("fix 1: debounce tertunda saat seksi dilepas → disimpan (pilih tanggal lalu tutup modal)", async () => {
  const s = await ui(mk(202, "Tutup", {}));
  byLabel(s.tree, "Mulai").props.onChange(ev("2026-11-11"));
  s.render();
  s.m.unmount();
  assert.deepEqual(s.calls.set, [[202, { start: "2026-11-11", duration: 1 }]]);
  await sleep(DEBOUNCE * 3);
  assert.equal(s.calls.set.length, 1);
});

test("fix 2: modal — ext lebih baru di daftar men-seed (deps [A] → daftar [A,B]); tambah C → [A,B,C]", async () => {
  const A = { t: { $task: 1 }, type: "FS", lag: 0 };
  const B = { t: { $task: 3 }, type: "FS", lag: 0 };
  const snap = mk(210, "Modal", { start: "2026-11-16", duration: 1, deps: [A] }, Object.assign({ updated_at: "2026-11-01T01:00:00Z" }, SCOPE));
  const listed = mk(210, "Modal", { start: "2026-11-16", duration: 1, deps: [A, B] }, Object.assign({ updated_at: "2026-11-01T02:00:00Z" }, SCOPE));
  const C = mk(4, "Cakupan", {}, SCOPE);
  const s = await ui(snap, { tasks: depTasks().concat([listed, C]), storage: { "section:open": true } });
  assert.deepEqual(byCls(s.tree, "plg-timeline-dep").map((n) => n.props["data-key"]), ["1", "3"]);
  buttonByText(s.tree, "Tambah dependensi").props.onClick();
  s.render();
  await s.settle();
  byLabel(s.tree, "Cari task").props.onChange(ev("cakupan"));
  s.render();
  byCls(s.tree, "plg-timeline-pick")[0].props.onClick();
  s.render();
  assert.deepEqual(s.calls.set, [[210, { deps: [A, B, { t: { $task: 4 }, type: "FS", lag: 0 }] }]]);
});

test("fix 2: daftar lebih baru tidak menimpa draf yang sedang diketik; tulis berjalan menunda seed", async () => {
  const snap = mk(211, "Draf", { start: "2026-11-16", duration: 2 }, { updated_at: "2026-11-01T01:00:00Z" });
  let listExt = { start: "2026-11-16", duration: 2 };
  const listImpl = () => Promise.resolve([mk(211, "Draf", listExt, { updated_at: "2026-11-01T0" + (listExt.duration === 2 ? 1 : 3) + ":00:00Z" })]);
  const s = await ui(snap, { listImpl });
  byLabel(s.tree, "Durasi (hari kerja)").props.onChange(ev("9"));
  s.render();
  listExt = { start: "2026-11-23", duration: 4 };
  s.calls.handlers["sync.done"][0]();
  await s.settle();
  assert.equal(byLabel(s.tree, "Durasi (hari kerja)").props.value, "9", "draf tetap");
  assert.equal(byLabel(s.tree, "Mulai").props.value, "2026-11-16");
  byLabel(s.tree, "Durasi (hari kerja)").props.onBlur(ev("9"));
  s.render();
  assert.deepEqual(s.calls.set, [[211, { duration: 9 }]]);
  await s.settle();
  // tanpa draf dan tanpa tulis berjalan: ext daftar yang lebih baru men-seed
  s.calls.handlers["sync.done"][0]();
  await s.settle();
  assert.equal(byLabel(s.tree, "Mulai").props.value, "2026-11-23");
  assert.equal(byLabel(s.tree, "Durasi (hari kerja)").props.value, "4");
});

test("fix 3: Mulai diketik di hari libur/akhir pekan → jepret ke hari kerja (durasi ≥ 1) dan input menampilkannya; milestone tetap", async () => {
  // Sabtu 7 Nov → Senin 9 Nov; jadwal baru
  const s = await ui(mk(220, "Jepret", {}));
  byLabel(s.tree, "Mulai").props.onChange(ev("2026-11-07"));
  byLabel(s.tree, "Mulai").props.onBlur(ev("2026-11-07"));
  s.render();
  assert.deepEqual(s.calls.set, [[220, { start: "2026-11-09", duration: 1 }]]);
  assert.equal(byLabel(s.tree, "Mulai").props.value, "2026-11-09");
  // Natal (Jum 25 Des 2026, libur nasional) → Senin 28 Des (26 Sab, 27 Min)
  byLabel(s.tree, "Mulai").props.onChange(ev("2026-12-25"));
  byLabel(s.tree, "Mulai").props.onBlur(ev("2026-12-25"));
  s.render();
  assert.deepEqual(s.calls.set[1], [220, { start: "2026-12-28" }]);
  // jepret = nilai tersimpan → tanpa tulis, input kembali ke tanggal tersimpan
  byLabel(s.tree, "Mulai").props.onChange(ev("2026-12-27"));
  byLabel(s.tree, "Mulai").props.onBlur(ev("2026-12-27"));
  s.render();
  assert.equal(s.calls.set.length, 2);
  assert.equal(byLabel(s.tree, "Mulai").props.value, "2026-12-28");
  // milestone (durasi 0) boleh di hari libur (R6)
  const m = await ui(mk(221, "Rilis", { start: "2026-11-02", duration: 0 }));
  byLabel(m.tree, "Mulai").props.onChange(ev("2026-11-07"));
  byLabel(m.tree, "Mulai").props.onBlur(ev("2026-11-07"));
  m.render();
  assert.deepEqual(m.calls.set, [[221, { start: "2026-11-07" }]]);
  assert.equal(byLabel(m.tree, "Mulai").props.value, "2026-11-07");
});

test("fix 4: hapus centang Milestone → durasi bukan-nol terakhir di mount ini (cadangan 1); mulai di hari libur dijepret", async () => {
  const s = await ui(mk(230, "Durasi", { start: "2026-11-02", duration: 4 }), { storage: { "section:open": true } });
  byLabel(s.tree, "Milestone").props.onChange({ target: { checked: true } });
  s.render();
  byLabel(s.tree, "Milestone").props.onChange({ target: { checked: false } });
  s.render();
  assert.deepEqual(s.calls.set, [[230, { duration: 0 }], [230, { duration: 4 }]]);
  // dipasang sebagai milestone di Sabtu → cadangan 1, mulai dijepret ke Senin
  const m = await ui(mk(231, "Rilis", { start: "2026-11-07", duration: 0 }), { storage: { "section:open": true } });
  byLabel(m.tree, "Milestone").props.onChange({ target: { checked: false } });
  m.render();
  assert.deepEqual(m.calls.set, [[231, { duration: 1, start: "2026-11-09" }]]);
  // task lain di instance yang sama tidak mewarisi durasi terakhir
  const s2 = await ui(mk(232, "A", { start: "2026-11-02", duration: 6 }), { storage: { "section:open": true } });
  s2.render(mk(233, "B", { start: "2026-11-02", duration: 0 }));
  byLabel(s2.tree, "Milestone").props.onChange({ target: { checked: false } });
  s2.render();
  assert.deepEqual(s2.calls.set, [[233, { duration: 1 }]]);
});

test("fix 5: salinan modal ber-cid basi menulis ke id terkini dari daftar", async () => {
  const stale = mk("c-xyz", "Basi", { start: "2026-11-02", duration: 2 }, SCOPE);
  const fresh = Object.assign({}, stale, { id: 77, cid: "c-xyz" });
  const s = await ui(stale, { tasks: [fresh] });
  byLabel(s.tree, "Durasi (hari kerja)").props.onChange(ev("3"));
  byLabel(s.tree, "Durasi (hari kerja)").props.onBlur(ev("3"));
  s.render();
  assert.deepEqual(s.calls.set, [[77, { duration: 3 }]]);
});

test("fix 6: sebelum daftar task dimuat hanya kepala seksi (tanpa input) — ringkasan tidak berkedip", async () => {
  let release = null;
  const parent = mk(240, "Induk", {}, SCOPE);
  const kid = mk(241, "Anak", { start: "2026-11-02", duration: 2 }, Object.assign({ parent_id: 240 }, SCOPE));
  const listImpl = () => new Promise((r) => { release = () => r([parent, kid]); });
  const s = await ui(parent, { listImpl });
  assert.ok(hasCls(s.tree, "plg-timeline-section"));
  assert.equal(txt(byCls(s.tree, "plg-timeline-sec-title")[0]).trim(), "Jadwal");
  assert.equal(inputs(s.tree).length, 0);
  assert.equal(buttonByText(s.tree, "Tambah dependensi"), undefined);
  release();
  await s.settle();
  assert.ok(txt(s.tree).includes("Jadwal task ini mengikuti subtask-nya"));
  // gagal memuat → tetap bisa dipakai (daftar kosong)
  const f = await ui(mk(242, "Gagal muat", {}), { listImpl: () => Promise.reject(new Error("idb")) });
  assert.ok(byLabel(f.tree, "Mulai"));
});

test("fix 7: muat ulang daftar berurutan — jawaban lama yang datang belakangan diabaikan", async () => {
  const pending = [];
  const listImpl = () => new Promise((r) => pending.push(r));
  const task = mk(250, "Urut", { start: "2026-11-16", duration: 1, deps: [{ t: { $task: 1 }, type: "FS", lag: 0 }] }, SCOPE);
  const s = await ui(task, { listImpl, storage: { "section:open": true } });
  assert.equal(pending.length, 1);
  s.calls.handlers["sync.done"][0]();
  await tick();
  assert.equal(pending.length, 2);
  pending[1]([mk(1, "Judul baru", {}, SCOPE), task]);
  await s.settle();
  pending[0]([mk(1, "Judul lama", {}, SCOPE), task]);
  await s.settle();
  assert.equal(txt(byCls(s.tree, "plg-timeline-dep-name")[0]).trim(), "Judul baru");
});

// ════════════════════════════════════════════════════════════════════════════
// Final review (fix-before-merge): task-switch flush
// ════════════════════════════════════════════════════════════════════════════

test("final: ketik Mulai di task 300 lalu seksi pindah ke task 301 sebelum debounce → tepat satu tulis ke 300, tidak ada ke 301", async () => {
  const t300 = mk(300, "Pertama", { start: "2026-11-02", duration: 2 });
  const t301 = mk(301, "Kedua", { start: "2026-11-16", duration: 3 });
  const s = await ui(t300, { tasks: [t300, t301] });
  byLabel(s.tree, "Mulai").props.onChange(ev("2026-11-10"));
  s.render();
  assert.equal(s.calls.set.length, 0, "masih dalam debounce");
  s.render(t301); // seksi yang sama sekarang menampilkan task lain (Live Edit / modal pindah task)
  assert.deepEqual(s.calls.set, [[300, { start: "2026-11-10" }]], "debounce tertunda disimpan ke task lama saat pindah");
  assert.equal(byLabel(s.tree, "Mulai").props.value, "2026-11-16", "task baru menampilkan nilainya sendiri, bukan draf task lama");
  await sleep(DEBOUNCE * 3);
  s.render();
  await s.settle();
  assert.deepEqual(s.calls.set, [[300, { start: "2026-11-10" }]], "tidak ada tulis tambahan (ke 300 maupun 301)");
  assert.ok(s.calls.set.every(([id]) => id !== 301));
});
