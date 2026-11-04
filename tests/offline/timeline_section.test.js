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
// Dedupe toast "kalah LWW" (final review #7): 1500 ms di aplikasi; 0 di tes = hanya dalam satu dispatch sinkron.
if (T.LOST_TIMING) T.LOST_TIMING.dedupeMs = 0;
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
  const calls = { set: [], setMany: [], list: [], storageGet: [], storageSet: [], toast: [], recGet: [], recList: [], events: [], handlers: {} };
  const recs = new Map(Object.entries(opts.records || {}));
  const recListeners = opts.recListeners || new Set(); // bersama antar-api palsu = satu pluginsync
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
      // 1c-1 Task 11: tulis massal seksi (writeMany) direkam; opts.setMany mengganti hasilnya
      setMany(items) { calls.setMany.push(JSON.parse(JSON.stringify(items))); return opts.setMany ? opts.setMany(items) : Promise.resolve([]); },
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
      // 1c-1 Task 11: unit jadwal workspace (record project scope list:<lid>) untuk mode efektif seksi
      list(entity, q) {
        calls.recList.push([entity, q]);
        if (opts.recList) return opts.recList(entity, q); // fix T11: jendela muat unit (ditahan / gagal)
        const pre = "prj@" + (q && q.scope) + ":";
        const items = [...recs.keys()].filter((id) => id.indexOf(pre) === 0).sort()
          .map((id) => ({ entity, id, scope: q.scope, data: recs.get(id), updated_at: "2026-11-03T02:00:00Z", version: 1, pending: false }));
        return Promise.resolve({ items, next: null });
      },
      put: () => Promise.reject(new Error("tidak dipakai seksi")),
      onChange: (fn) => { recListeners.add(fn); return () => recListeners.delete(fn); },
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
  return { api, calls, setSet: (fn) => { setImpl = fn; }, recListeners, emitRec: (ev) => { for (const fn of [...recListeners]) fn(ev); } };
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
  const deps = [good, { t: { $task: 3 }, type: "XX", lag: 0 }, { t: null, type: "FS" }, "x"]; // 1c-1: SS/FF/SF sah
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

// ════════════════════════════════════════════════════════════════════════════
// Final review #7: toast "kalah LWW" kalender juga dari seksi (tanpa view Gantt), tanpa ganda bila keduanya terpasang
// ════════════════════════════════════════════════════════════════════════════
const MSG_LOST = "Perubahan kalender di perangkat ini kalah oleh perubahan yang lebih baru";

test("final #7: seksi saja (tanpa Gantt) → lost untuk kalendernya → satu toast persis; kalender lain → tanpa toast", async () => {
  const task = mk(400, "Kerja", { start: "2026-11-02", duration: 2 }, { list_id: 12 });
  const s = await ui(task, { tasks: [task] });
  assert.ok(s.f.recListeners.size >= 1, "seksi mendengar perubahan kalender");
  s.f.emitRec({ entity: "calendar", ids: ["cal@list:99"], source: "sync", lost: ["cal@list:99"] });
  assert.deepEqual(s.calls.toast, [], "kalender lain");
  s.f.emitRec({ entity: "calendar", ids: ["cal@list:12"], source: "sync", lost: ["cal@list:12"] });
  assert.deepEqual(s.calls.toast, [[MSG_LOST, "error"]]);
  await tick();
  s.m.unmount();
  assert.equal(s.f.recListeners.size, 0, "pendengar dilepas");
});

test("final #7: view Gantt + seksi (panel Live Edit) pada kalender yang sama → satu lost = SATU toast", async () => {
  const recListeners = new Set();
  const task = mk(401, "Kerja", { start: "2026-11-02", duration: 2 }, { list_id: 12 });
  const s = await ui(task, { tasks: [task], recListeners });
  // view Gantt workspace 12 dengan api palsu yang berbagi pendengar record (satu pluginsync)
  const fv = fakeApi({ tasks: [task], recListeners });
  const vm = mount(T.TimelineViewBody);
  const ctx = { page: "slist_12", pageKind: "workspace", listId: 12, projectName: null, tasks: [task], scopeTasks: [task], liveEdit: true, onTaskClick() {}, isSelected: () => false, showToast() {} };
  vm.render({ context: ctx, api: fv.api });
  vm.flush();
  await tick();
  assert.ok(recListeners.size >= 2, "view dan seksi sama-sama mendengar");
  s.f.emitRec({ entity: "calendar", ids: ["cal@list:12"], source: "sync", lost: ["cal@list:12"] });
  const all = s.calls.toast.concat(fv.calls.toast).filter((t) => t[0] === MSG_LOST);
  assert.equal(all.length, 1, "tanpa toast ganda: " + JSON.stringify(all));
  // peristiwa lost berikutnya (dispatch lain) memberi tahu lagi
  await tick();
  s.f.emitRec({ entity: "calendar", ids: ["cal@list:12"], source: "sync", lost: ["cal@list:12"] });
  assert.equal(s.calls.toast.concat(fv.calls.toast).filter((t) => t[0] === MSG_LOST).length, 2);
  vm.unmount();
  s.m.unmount();
});

// ════════════════════════════════════════════════════════════════════════════
// 1c-1 Task 11 (R20 tingkat 1–2): kontrol Mode, kartu otomatis, "Perbarui", writeMany seksi
// ════════════════════════════════════════════════════════════════════════════
const S = T.TLSched;
const WS = (project) => ({ list_id: 7, project });
// Record unit otomatis untuk project task (id dari TLSched.unitOf, satu-satunya pembuat id).
function autoRecs(...tasks) {
  const out = {};
  for (const t of tasks) {
    const u = S.unitOf(t);
    out[u.recId] = { v: 1, auto: true, name: u.name, by: 1 };
  }
  return out;
}
const modeGroup = (tree) => nodes(tree, (n) => n.props.role === "group" && n.props["aria-label"] === "Mode")[0];
const modeBtn = (tree, m) => nodes(tree, (n) => n.type === "button" && n.props["data-mode"] === m)[0];
const chips = (tree) => byCls(tree, "plg-timeline-chip").map((n) => txt(n).trim());
const lastToast = (s) => s.calls.toast[s.calls.toast.length - 1];
function spyRun() {
  const orig = T.engine.run;
  const spy = { n: 0, restore() { T.engine.run = orig; } };
  T.engine.run = (ctx) => { spy.n++; return orig(ctx); };
  return spy;
}

// Data mockup R20/R21: 1.2 "Palet Sakura + Lavender" selesai Sel 3 Nov → task 2.1 (FS +1, 4 hk) → 3.1.
function mockup(o) {
  const x = o || {};
  const p11 = mk(11, "Riset warna", { start: "2026-10-26", duration: 2 }, WS("Desain"));
  const p12 = mk(12, "Palet Sakura + Lavender", { start: "2026-11-02", duration: 2 }, WS("Desain"));
  const self = mk(20, "Token tema", { start: x.start || "2026-11-05", duration: 4, deps: [{ t: { $task: 12 }, type: "FS", lag: 1 }] },
    Object.assign(WS("Fondasi"), x.deadline ? { deadline: x.deadline } : {}));
  const c31 = mk(31, "Uji tema", { start: x.cStart || "2026-11-11", duration: 2, deps: [{ t: { $task: 20 }, type: "FS", lag: 0 }] }, WS("Rilis"));
  const tasks = [p11, p12, self, c31].concat(x.extra || []);
  return { self, c31, tasks, records: autoRecs(self, c31) };
}

test("mode efektif manual: tingkat 1 1b tidak berubah (asersi lama lulus); Selengkapnya → kontrol Mode Manual|Otomatis, nilai unit 'sama dengan project'; pilih Otomatis di unit Manual → patch {mode: 'auto'}; pilih Manual → {mode: null} + aliran penerus", async () => {
  const m = mk(500, "Token", { start: "2026-11-02", duration: 2 }, WS("Fondasi"));
  const s = await ui(m, { tasks: [m] });
  // tingkat 1 apa adanya: input 1b, tanpa chip, kontrol Mode hanya di Selengkapnya
  assert.ok(byLabel(s.tree, "Mulai"));
  assert.equal(byLabel(s.tree, "Durasi (hari kerja)").props.value, "2");
  assert.ok(buttonByText(s.tree, "Tambah dependensi"));
  assert.deepEqual(chips(s.tree), []);
  assert.equal(modeGroup(s.tree), undefined);
  buttonByText(s.tree, "Selengkapnya").props.onClick();
  s.render();
  await tick();
  const g = modeGroup(s.tree);
  assert.ok(g, "kontrol Mode");
  assert.ok(txt(g).includes("Mode"));
  assert.equal(modeBtn(s.tree, "manual").props["aria-pressed"], true);
  assert.equal(modeBtn(s.tree, "auto").props["aria-pressed"], false);
  assert.equal(txt(modeBtn(s.tree, "manual")).trim(), "Manualsama dengan project", "nilai unit diberi keterangan");
  assert.equal(txt(modeBtn(s.tree, "auto")).trim(), "Otomatis");
  // pilih nilai yang sama → tanpa tulis
  modeBtn(s.tree, "manual").props.onClick();
  s.render();
  assert.equal(s.calls.setMany.length, 0);
  // Otomatis di unit Manual → satu setMany {mode: "auto"}; tampilan langsung otomatis (optimistis)
  modeBtn(s.tree, "auto").props.onClick();
  s.render();
  assert.deepEqual(s.calls.setMany, [[{ taskId: 500, patch: { mode: "auto" } }]]);
  assert.equal(s.calls.set.length, 0);
  assert.equal(modeBtn(s.tree, "auto").props["aria-pressed"], true);
  assert.ok(chips(s.tree).includes("Otomatis"), "kartu tingkat 2 seketika");
  await s.settle();
  assert.equal(lastToast(s)[0], "Jadwal diubah");
  assert.equal(lastToast(s)[1], "success");
  assert.equal(lastToast(s)[2].label, "Urungkan");
  // kembali ke Manual (= unit) → {mode: null}
  modeBtn(s.tree, "manual").props.onClick();
  s.render();
  assert.deepEqual(s.calls.setMany[1], [{ taskId: 500, patch: { mode: null } }]);
  await s.settle();
  assert.ok(byLabel(s.tree, "Mulai"), "tingkat 1 lagi");

  // aliran penerus: B otomatis eksplisit di unit Manual, tersimpan Sen 9 (hasil hitung Kam 5); C otomatis setelah B
  const A = mk(510, "A", { start: "2026-11-02", duration: 3 }, WS("Fondasi"));
  const B = mk(511, "B", { start: "2026-11-09", duration: 2, mode: "auto", deps: [{ t: { $task: 510 }, type: "FS", lag: 0 }] }, WS("Fondasi"));
  const C = mk(512, "C", { start: "2026-11-09", duration: 1, mode: "auto", deps: [{ t: { $task: 511 }, type: "FS", lag: 0 }] }, WS("Fondasi"));
  const s2 = await ui(B, { tasks: [A, B, C], storage: { "section:open": true } });
  assert.equal(modeBtn(s2.tree, "auto").props["aria-pressed"], true);
  assert.ok(txt(modeBtn(s2.tree, "manual")).includes("sama dengan project"));
  modeBtn(s2.tree, "manual").props.onClick();
  s2.render();
  // B jadi jangkar Manual di Sen 9 (selesai Sel 10) → C bergeser ke Rab 11; satu setMany
  assert.deepEqual(s2.calls.setMany, [[{ taskId: 511, patch: { mode: null } }, { taskId: 512, patch: { start: "2026-11-11" } }]]);
  assert.equal(s2.calls.set.length, 0);
  await s2.settle();
  assert.equal(lastToast(s2)[0], "Jadwal diubah · 1 task ikut bergeser");
  lastToast(s2)[2].onClick();
  await s2.settle();
  assert.deepEqual(s2.calls.setMany[1], [
    { taskId: 511, patch: { start: "2026-11-09", duration: 2, constraint: null, mode: "auto" } },
    { taskId: 512, patch: { start: "2026-11-09", duration: 1, constraint: null, mode: "auto" } },
  ], "Urungkan = undoItems persis (kunci yang dulu tidak ada → null)");
  assert.equal(s2.calls.toast.length, 1, "Urungkan tanpa toast sukses");
});

test("punya 3 penerus otomatis → 'Mengubah task ini menggeser 3 task otomatis'", async () => {
  const M = mk(520, "Induk jadwal", { start: "2026-11-02", duration: 2 }, WS("Fondasi"));
  const succ = [521, 522, 523].map((id) => mk(id, "S" + id, { start: "2026-11-04", duration: 1, mode: "auto", deps: [{ t: { $task: 520 }, type: "FS", lag: 0 }] }, WS("Fondasi")));
  const man = mk(524, "Manual", { start: "2026-11-04", duration: 1, deps: [{ t: { $task: 520 }, type: "FS", lag: 0 }] }, WS("Fondasi"));
  const s = await ui(M, { tasks: [M, man].concat(succ), storage: { "section:open": true } });
  const note = byCls(s.tree, "plg-timeline-sec-shiftnote");
  assert.equal(note.length, 1);
  assert.equal(txt(note[0]).trim(), "Mengubah task ini menggeser 3 task otomatis");
  // tanpa penerus otomatis → tidak tampil; tertutup → tidak tampil
  const s2 = await ui(M, { tasks: [M, man], storage: { "section:open": true } });
  assert.equal(byCls(s2.tree, "plg-timeline-sec-shiftnote").length, 0);
  const s3 = await ui(M, { tasks: [M, man].concat(succ) });
  assert.equal(byCls(s3.tree, "plg-timeline-sec-shiftnote").length, 0);
  assert.equal(s.calls.setMany.length + s.calls.set.length, 0);
});

test("mode efektif otomatis: kartu tingkat 2 — chip 'Otomatis', 'lewat tenggat 1 hk', 'Kam 5 Nov → Sel 10 Nov · 4 hari kerja', 'menunggu 1.2 (+1 hk) · diikuti 3.1 · slack 0', chip 'Di jalur kritis'", async () => {
  // tenggat Sen 9 Nov: lewat 1 hk. Backward pass menjepit LF ke tenggat (R10) → slack task yang sama −1 hk.
  const a = mockup({ deadline: "2026-11-09" });
  const s = await ui(a.self, { tasks: a.tasks, records: a.records });
  assert.deepEqual(chips(s.tree), ["Otomatis", "lewat tenggat 1 hk", "Di jalur kritis"]);
  assert.equal(txt(byCls(s.tree, "plg-timeline-sec-title")[0]).trim(), "Jadwal");
  assert.equal(txt(byCls(s.tree, "plg-timeline-sec-range")[0]).trim(), "Kam 5 Nov → Sel 10 Nov · 4 hari kerja");
  assert.equal(txt(byCls(s.tree, "plg-timeline-sec-links")[0]).trim(), "menunggu 1.2 (+1 hk) · diikuti 3.1 · slack −1 hk");
  assert.equal(inputs(s.tree).length, 0, "tingkat 2 terlipat: tanpa input");
  assert.equal(byCls(s.tree, "plg-timeline-sec-drift").length, 0);
  assert.ok(buttonByText(s.tree, "Selengkapnya"));
  // tanpa tenggat: data mockup baris dependensi persis
  const b = mockup();
  const s2 = await ui(b.self, { tasks: b.tasks, records: b.records });
  assert.deepEqual(chips(s2.tree), ["Otomatis", "Di jalur kritis"]);
  assert.equal(txt(byCls(s2.tree, "plg-timeline-sec-range")[0]).trim(), "Kam 5 Nov → Sel 10 Nov · 4 hari kerja");
  assert.equal(txt(byCls(s2.tree, "plg-timeline-sec-links")[0]).trim(), "menunggu 1.2 (+1 hk) · diikuti 3.1 · slack 0");
  // maks 2 penerus + "…"; lag 0 tanpa "(+0 hk)"
  const more = [32, 33].map((id) => mk(id, "Uji " + id, { start: "2026-11-11", duration: 1, deps: [{ t: { $task: 20 }, type: "FS", lag: 0 }] }, WS("Rilis")));
  const c = mockup({ extra: more });
  const s3 = await ui(c.self, { tasks: c.tasks, records: c.records });
  assert.ok(txt(byCls(s3.tree, "plg-timeline-sec-links")[0]).includes("diikuti 3.1, 3.2, …"));
  const s4 = await ui(c.c31, { tasks: c.tasks, records: c.records });
  assert.ok(txt(byCls(s4.tree, "plg-timeline-sec-links")[0]).trim().startsWith("menunggu 2.1 · slack"), txt(byCls(s4.tree, "plg-timeline-sec-links")[0]));
  for (const x of [s, s2, s3, s4]) assert.equal(x.calls.setMany.length + x.calls.set.length, 0);
});

test("drift → 'Belum mutakhir — hasil hitung Kam 5 Nov.' + 'Perbarui' → setMany task + turunan; dipasang ulang/props berubah → 0 tulis", async () => {
  // task tersimpan Sen 9 (hasil hitung Kam 5), penerus 3.1 tersimpan Sen 16 (hasil Rab 11), D drift bukan turunan
  const D = mk(40, "Lain", { start: "2026-11-20", duration: 1, deps: [{ t: { $task: 11 }, type: "FS", lag: 0 }] }, WS("Fondasi"));
  const m = mockup({ start: "2026-11-09", cStart: "2026-11-16", extra: [D] });
  let release = null;
  let first = true;
  const listImpl = () => {
    const out = JSON.parse(JSON.stringify(m.tasks));
    if (!first) return Promise.resolve(out);
    first = false;
    return new Promise((r) => { release = () => r(out); });
  };
  const spy = spyRun();
  try {
    const s = await ui(m.self, { listImpl, records: m.records });
    assert.equal(spy.n, 0, "mesin seksi tidak berjalan sebelum daftar lengkap ada (render pertama)");
    assert.equal(inputs(s.tree).length, 0);
    release();
    await s.settle();
    assert.ok(spy.n > 0, "mesin seksi berjalan setelah daftar ada");
    const note = byCls(s.tree, "plg-timeline-sec-drift")[0];
    assert.ok(note);
    assert.equal(txt(byCls(note, "plg-timeline-sec-drift-text")[0]).trim(), "Belum mutakhir — hasil hitung Kam 5 Nov.");
    assert.ok(buttonByText(s.tree, "Perbarui"));
    // dipasang ulang / props berubah / sync.done / render ulang → 0 tulis
    s.render(Object.assign({}, m.self));
    s.calls.handlers["sync.done"][0]();
    await s.settle();
    const again = await ui(m.self, { tasks: m.tasks, records: m.records, variant: "panel" });
    again.render(Object.assign({}, m.self));
    await again.settle();
    again.m.unmount();
    assert.equal(s.calls.setMany.length + s.calls.set.length + again.calls.setMany.length + again.calls.set.length, 0);
    // Perbarui → SATU setMany: task + turunan yang drift (D bukan turunan, tidak ikut)
    buttonByText(s.tree, "Perbarui").props.onClick();
    s.render();
    assert.deepEqual(s.calls.setMany, [[{ taskId: 20, patch: { start: "2026-11-05" } }, { taskId: 31, patch: { start: "2026-11-11" } }]]);
    assert.equal(s.calls.set.length, 0);
    assert.equal(byCls(s.tree, "plg-timeline-sec-drift").length, 0, "optimistis: task sendiri mutakhir");
    await s.settle();
    assert.equal(lastToast(s)[0], "Jadwal diubah · 1 task ikut bergeser");
    lastToast(s)[2].onClick();
    await s.settle();
    assert.equal(s.calls.setMany.length, 2);
    assert.deepEqual(s.calls.setMany[1].map((x) => [x.taskId, x.patch.start]), [[20, "2026-11-09"], [31, "2026-11-16"]]);
  } finally {
    spy.restore();
  }
});

test("writeMany gagal → mode lokal kembali + toast 'Jadwal gagal disimpan'; sebagian → '(k dari n)' + Urungkan yang tersimpan", async () => {
  const m = mk(530, "Gagal", { start: "2026-11-02", duration: 2 }, WS("Fondasi"));
  const s = await ui(m, { tasks: [m], storage: { "section:open": true }, setMany: () => Promise.reject(new Error("x")) });
  modeBtn(s.tree, "auto").props.onClick();
  s.render();
  assert.equal(modeBtn(s.tree, "auto").props["aria-pressed"], true);
  await s.settle();
  assert.equal(modeBtn(s.tree, "manual").props["aria-pressed"], true);
  assert.deepEqual(lastToast(s), ["Jadwal gagal disimpan", "error"]);
  // sebagian: B tersimpan, C gagal
  const A = mk(540, "A", { start: "2026-11-02", duration: 3 }, WS("Fondasi"));
  const B = mk(541, "B", { start: "2026-11-09", duration: 2, mode: "auto", deps: [{ t: { $task: 540 }, type: "FS", lag: 0 }] }, WS("Fondasi"));
  const C = mk(542, "C", { start: "2026-11-09", duration: 1, mode: "auto", deps: [{ t: { $task: 541 }, type: "FS", lag: 0 }] }, WS("Fondasi"));
  let n = 0;
  const setMany = () => (n++ === 0 ? Promise.reject(Object.assign(new Error("y"), { applied: [541] })) : Promise.resolve([]));
  const s2 = await ui(B, { tasks: [A, B, C], storage: { "section:open": true }, setMany });
  modeBtn(s2.tree, "manual").props.onClick();
  await s2.settle();
  assert.equal(lastToast(s2)[0], "Sebagian jadwal gagal disimpan (1 dari 2)");
  assert.equal(modeBtn(s2.tree, "manual").props["aria-pressed"], true, "task sendiri tersimpan → tetap");
  lastToast(s2)[2].onClick();
  await s2.settle();
  assert.deepEqual(s2.calls.setMany[1].map((x) => x.taskId), [541]);
});

test("task berulang / tanpa id → null (1b); ringkasan → teks 1b", async () => {
  const { api } = fakeApi();
  const base = { variant: "modal", collaborators: [], onOpenTask() {}, showToast() {} };
  assert.equal(guard({ context: Object.assign({ task: mk(1, "Harian", { mode: "auto" }, { recurrence_type: "daily" }) }, base), api }), null);
  assert.equal(guard({ context: Object.assign({ task: { title: "Baru", ext: ext({ mode: "auto" }) } }, base), api }), null);
  // ringkasan di unit otomatis: teks 1b, tanpa chip/kontrol
  const parent = mk(600, "Fase", {}, WS("Fondasi"));
  const kid = mk(601, "Anak", { start: "2026-11-02", duration: 3 }, Object.assign({ parent_id: 600 }, WS("Fondasi")));
  const s = await ui(parent, { tasks: [parent, kid], records: autoRecs(parent), storage: { "section:open": true } });
  assert.ok(txt(s.tree).includes("Jadwal task ini mengikuti subtask-nya"));
  assert.equal(txt(byCls(s.tree, "plg-timeline-sec-range")[0]).trim(), "Sen 2 Nov → Rab 4 Nov · 3 hari kerja");
  assert.deepEqual(chips(s.tree), []);
  assert.equal(modeGroup(s.tree), undefined);
  assert.equal(s.calls.setMany.length + s.calls.set.length, 0);
});

test("variant panel dan modal sama (tingkat 2 dengan drift dan kontrol Mode)", async () => {
  const m = mockup({ start: "2026-11-09", deadline: "2026-11-09" });
  const strip = (n) => JSON.stringify(n, (k, v) => (typeof v === "function" ? "fn" : v));
  const a = await ui(m.self, { tasks: m.tasks, records: m.records, variant: "modal", storage: { "section:open": true } });
  const b = await ui(m.self, { tasks: m.tasks, records: m.records, variant: "panel", storage: { "section:open": true } });
  assert.ok(modeGroup(a.tree) && byCls(a.tree, "plg-timeline-sec-drift").length === 1);
  assert.equal(strip(a.tree), strip(b.tree));
});

test("sumber Task 11: teks persis R20 + writeMany satu pintu setMany seksi", () => {
  for (const t of ['"Otomatis"', '"Manual"', '"sama dengan project"', '"Di jalur kritis"', '"Perbarui"', '"Mode"',
    '"Belum mutakhir — hasil hitung "', '"Mengubah task ini menggeser "', '" task otomatis"', '"lewat tenggat "', '"menunggu "', '"diikuti "', '"slack "']) {
    assert.ok(jsx.includes(t), t);
  }
  const start = jsx.indexOf("// 4g.");
  const block = jsx.slice(start, jsx.indexOf("// React.memo dibuat malas", start));
  assert.equal((block.match(/taskExt\.setMany\(/g) || []).length, 1, "satu setMany di seksi");
  assert.match(block, /const writeMany = /);
  assert.match(block, /engine\.run\(/, "mesin seksi lewat engine.run (pintu spy)");
  assert.doesNotMatch(block, /TLCpm\.run\(/);
  assert.match(css, /\.plg-timeline-chip\b/);
});

// ════════════════════════════════════════════════════════════════════════════
// Fix review Task 11: aliran edit tingkat 1, kunci jendela muat unit, urutan Urungkan seksi
// ════════════════════════════════════════════════════════════════════════════
function manualWithSucc(nSucc, extraDeps) {
  const M = mk(700, "Induk", Object.assign({ start: "2026-11-02", duration: 2 }, extraDeps ? { deps: extraDeps } : {}), WS("Fondasi"));
  const succ = [];
  for (let k = 0; k < nSucc; k++) succ.push(mk(701 + k, "S" + k, { start: "2026-11-04", duration: 1, mode: "auto", deps: [{ t: { $task: 700 }, type: "FS", lag: 0 }] }, WS("Fondasi")));
  return { M, succ };
}

test("fix 1: tingkat 1 Manual dengan 3 penerus otomatis — ubah Durasi → SATU setMany (task + 3) + 'Jadwal diubah · 3 task ikut bergeser'; tanpa turunan tetap set 1b", async () => {
  const { M, succ } = manualWithSucc(3);
  const s = await ui(M, { tasks: [M].concat(succ) });
  byLabel(s.tree, "Durasi (hari kerja)").props.onChange(ev("3"));
  byLabel(s.tree, "Durasi (hari kerja)").props.onBlur(ev("3"));
  s.render();
  assert.deepEqual(s.calls.setMany, [[
    { taskId: 700, patch: { duration: 3 } },
    { taskId: 701, patch: { start: "2026-11-05" } },
    { taskId: 702, patch: { start: "2026-11-05" } },
    { taskId: 703, patch: { start: "2026-11-05" } },
  ]]);
  assert.equal(s.calls.set.length, 0);
  assert.equal(byLabel(s.tree, "Durasi (hari kerja)").props.value, "3", "optimistis + draf dibersihkan");
  await s.settle();
  assert.equal(lastToast(s)[0], "Jadwal diubah · 3 task ikut bergeser");
  assert.equal(lastToast(s)[2].label, "Urungkan");
  // Mulai juga mengalir
  byLabel(s.tree, "Mulai").props.onChange(ev("2026-11-09"));
  byLabel(s.tree, "Mulai").props.onBlur(ev("2026-11-09"));
  s.render();
  assert.deepEqual(s.calls.setMany[1].map((x) => x.taskId), [700, 701, 702, 703]);
  assert.deepEqual(s.calls.setMany[1][0], { taskId: 700, patch: { start: "2026-11-09" } });
  // tanpa penerus otomatis → set 1b tunggal
  const lone = mk(710, "Sendiri", { start: "2026-11-02", duration: 2 }, WS("Fondasi"));
  const s2 = await ui(lone, { tasks: [lone] });
  byLabel(s2.tree, "Durasi (hari kerja)").props.onChange(ev("3"));
  byLabel(s2.tree, "Durasi (hari kerja)").props.onBlur(ev("3"));
  s2.render();
  assert.deepEqual(s2.calls.set, [[710, { duration: 3 }]]);
  assert.equal(s2.calls.setMany.length, 0);
});

// Task 12 (satu-satunya perubahan tes T11 yang disetujui): aturan sementara "> 20 → set 1b task ini saja" diganti
// gerbang PreviewCard — 0 tulis sampai Terapkan; Terapkan = SATU setMany seluruh item; Batal = 0 tulis.
test("fix 1 → Task 12: > 20 penerus otomatis bergeser → PreviewCard (0 tulis), Batal = 0, Terapkan = satu setMany", async () => {
  const { M, succ } = manualWithSucc(21);
  const s = await ui(M, { tasks: [M].concat(succ) });
  byLabel(s.tree, "Durasi (hari kerja)").props.onChange(ev("3"));
  byLabel(s.tree, "Durasi (hari kerja)").props.onBlur(ev("3"));
  s.render();
  assert.equal(s.calls.set.length, 0);
  assert.equal(s.calls.setMany.length, 0);
  assert.equal(byCls(s.tree, "plg-timeline-pvcard").length, 1);
  assert.equal(byLabel(s.tree, "Durasi (hari kerja)").props.value, "2", "draf kembali ke nilai tersimpan sampai Terapkan");
  buttonByText(s.tree, "Batal").props.onClick();
  await s.settle();
  assert.equal(byCls(s.tree, "plg-timeline-pvcard").length, 0);
  assert.equal(s.calls.set.length + s.calls.setMany.length, 0);
  byLabel(s.tree, "Durasi (hari kerja)").props.onChange(ev("3"));
  byLabel(s.tree, "Durasi (hari kerja)").props.onBlur(ev("3"));
  s.render();
  buttonByText(s.tree, "Terapkan").props.onClick();
  await s.settle();
  assert.equal(s.calls.set.length, 0);
  assert.equal(s.calls.setMany.length, 1);
  assert.equal(s.calls.setMany[0].length, 22);
  assert.deepEqual(s.calls.setMany[0][0], { taskId: 700, patch: { duration: 3 } });
  assert.equal(lastToast(s)[0], "Jadwal diterapkan · 22 task");
  assert.equal(byCls(s.tree, "plg-timeline-pvcard").length, 0);
});

test("fix 2: unit belum termuat dan ext.mode bukan 'manual' → input Mulai nonaktif; termuat / gagal muat / mode manual → aktif", async () => {
  let release = null;
  const recList = () => new Promise((r) => { release = () => r({ items: [], next: null }); });
  const t = mk(720, "Tunggu", { start: "2026-11-02", duration: 2 }, WS("Fondasi"));
  const s = await ui(t, { tasks: [t], recList });
  assert.equal(byLabel(s.tree, "Mulai").props.disabled, true);
  release();
  await s.settle();
  assert.equal(byLabel(s.tree, "Mulai").props.disabled, false);
  const man = mk(721, "Manual", { start: "2026-11-02", duration: 2, mode: "manual" }, WS("Fondasi"));
  const s2 = await ui(man, { tasks: [man], recList: () => new Promise(() => {}) });
  assert.equal(byLabel(s2.tree, "Mulai").props.disabled, false, "mode manual tersimpan tidak bergantung unit");
  const s3 = await ui(t, { tasks: [t], recList: () => Promise.reject(new Error("idb")) });
  assert.equal(byLabel(s3.tree, "Mulai").props.disabled, false, "gagal muat tidak mengunci selamanya");
});

test("fix 3: Urungkan seksi menunggu set 1b dan setMany yang berjalan (urut); set 1b pada task yang sedang setMany diabaikan", async () => {
  const P = mk(730, "Pendahulu", { start: "2026-10-26", duration: 2 }, WS("Fondasi"));
  const { M, succ } = manualWithSucc(3, [{ t: { $task: 730 }, type: "FS", lag: 0 }]);
  let held = null;
  const setMany = () => (held ? new Promise((r) => { held.release = r; }) : Promise.resolve([]));
  const s = await ui(M, { tasks: [P, M].concat(succ), storage: { "section:open": true }, setMany });
  const order = [];
  const origSet = s.f.api.taskExt.set;
  const origMany = s.f.api.taskExt.setMany;
  s.f.api.taskExt.set = (...a) => { order.push("set"); return origSet(...a); };
  s.f.api.taskExt.setMany = (...a) => { order.push("setMany"); return origMany(...a); };
  // writeMany #1 (aliran Durasi) selesai → toast dengan Urungkan
  byLabel(s.tree, "Durasi (hari kerja)").props.onChange(ev("3"));
  byLabel(s.tree, "Durasi (hari kerja)").props.onBlur(ev("3"));
  await s.settle();
  const undo1 = lastToast(s)[2];
  // set 1b (lag dependensi) ditahan → Urungkan menunggu sampai set selesai
  let relSet = null;
  s.f.setSet(() => new Promise((r) => { relSet = r; }));
  byLabel(s.tree, "Jeda setelah Pendahulu (hari kerja)").props.onChange(ev("2"));
  byLabel(s.tree, "Jeda setelah Pendahulu (hari kerja)").props.onBlur(ev("2"));
  s.render();
  assert.equal(s.calls.set.length, 1);
  undo1.onClick();
  await s.settle();
  assert.equal(s.calls.setMany.length, 1, "Urungkan menunggu set 1b task yang sama");
  relSet();
  await s.settle();
  assert.equal(s.calls.setMany.length, 2);
  assert.deepEqual(order, ["setMany", "set", "setMany"]);
  assert.deepEqual(s.calls.setMany[1].map((x) => x.taskId), [700, 701, 702, 703]);
  assert.equal(s.calls.setMany[1][0].patch.duration, 2);
  s.f.setSet(() => Promise.resolve());
  // setMany ditahan: set 1b pada task yang sama diabaikan; Urungkan berikutnya menunggu setMany
  held = {};
  byLabel(s.tree, "Durasi (hari kerja)").props.onChange(ev("4"));
  byLabel(s.tree, "Durasi (hari kerja)").props.onBlur(ev("4"));
  s.render();
  assert.equal(s.calls.setMany.length, 3);
  byLabel(s.tree, "Jeda setelah Pendahulu (hari kerja)").props.onChange(ev("5"));
  byLabel(s.tree, "Jeda setelah Pendahulu (hari kerja)").props.onBlur(ev("5"));
  s.render();
  assert.equal(s.calls.set.length, 1, "set 1b diabaikan selama setMany task ini berjalan");
  assert.equal(txt(byLabel(s.tree, "Jeda setelah Pendahulu (hari kerja)").props.value), "2", "draf kembali ke nilai tersimpan");
  const h = held;
  held = null;
  h.release([]);
  await s.settle();
  assert.equal(lastToast(s)[0], "Jadwal diubah · 3 task ikut bergeser");
  assert.deepEqual(order, ["setMany", "set", "setMany", "setMany"]);
});

// ════════════════════════════════════════════════════════════════════════════
// 1c-1 Task 12 (R20 tingkat 3, R21, R14 PreviewCard): Batasan, Dependensi bertipe, "Kenapa", "Ubah ke Manual"
// ════════════════════════════════════════════════════════════════════════════
const body3 = (tree) => byCls(tree, "plg-timeline-sec-body")[0];
const part = (tree, p) => nodes(tree, (n) => n.props["data-part"] === p)[0];
const optTexts = (sel) => nodes(sel, (n) => n.type === "option").map((n) => txt(n).trim());
const TYPE_LABELS = ["Selesai → Mulai (FS)", "Mulai → Mulai (SS)", "Selesai → Selesai (FF)", "Mulai → Selesai (SF)"];
const MOCKUP_WHY = "Mulai Kam 5 Nov karena menunggu 1.2 Palet Sakura + Lavender selesai Sel 3 Nov, ditambah lag 1 hari (Rab 4 Nov dilewati). Durasi 4 hari kerja melompati Sab–Min, jadi selesai Sel 10 Nov, 1 hari kerja setelah tenggat Sen 9 Nov.";
const whyStr = (arr) => arr.map((p) => (typeof p === "string" ? p : p.b)).join("");
async function open3(o) {
  const m = mockup(o);
  const s = await ui(m.self, Object.assign({ tasks: m.tasks, records: m.records, storage: { "section:open": true } }, (o && o.ui) || {}));
  return { m, s };
}

test("tingkat 3 urutan: Mode · Mulai (teks + 'Ubah') · Durasi · Selesai · Milestone · % selesai · Batasan · Dependensi (Menunggu / Diikuti oleh) · Tambah dependensi · Kenapa dijadwalkan di sini? · Ubah ke Manual", async () => {
  const { s } = await open3();
  const b = body3(s.tree);
  assert.ok(b, "badan tingkat 3");
  const order = nodes(b, (n) => typeof n.props["data-part"] === "string").map((n) => n.props["data-part"]);
  assert.deepEqual(order, ["mode", "start", "dur", "finish", "milestone", "pct", "constraint", "deps", "add", "why", "manual"]);
  const st = part(s.tree, "start");
  assert.equal(txt(byCls(st, "plg-timeline-sec-val")[0]).trim(), "Kam 5 Nov");
  assert.ok(buttonByText(st, "Ubah"));
  assert.equal(nodes(st, (n) => n.type === "input").length, 0, "Mulai otomatis = teks, bukan input");
  assert.ok(txt(part(s.tree, "finish")).includes("Selasa, 10 November 2026") || txt(part(s.tree, "finish")).includes("10"), txt(part(s.tree, "finish")));
  assert.equal(byLabel(part(s.tree, "dur"), "Durasi (hari kerja)").props.value, "4");
  assert.ok(byLabel(part(s.tree, "milestone"), "Milestone"));
  assert.ok(txt(part(s.tree, "pct")).includes("% selesai"));
  assert.ok(txt(part(s.tree, "constraint")).startsWith("Batasan"));
  const deps = part(s.tree, "deps");
  assert.ok(txt(deps).includes("Menunggu") && txt(deps).includes("Diikuti oleh"));
  assert.ok(txt(deps).indexOf("Menunggu") < txt(deps).indexOf("Diikuti oleh"));
  assert.ok(buttonByText(part(s.tree, "add"), "Tambah dependensi"));
  assert.ok(buttonByText(part(s.tree, "why"), "Kenapa dijadwalkan di sini?"));
  assert.ok(buttonByText(part(s.tree, "manual"), "Ubah ke Manual"));
  assert.equal(s.calls.set.length + s.calls.setMany.length, 0);
});

test("tingkat 3: catatan dependensi rusak + 'Hapus dependensi rusak' kembali (dependensi sah apa adanya)", async () => {
  const good = { t: { $task: 12 }, type: "FS", lag: 1 };
  const m = mockup();
  const self = mk(20, "Token tema", { start: "2026-11-05", duration: 4, deps: [good, { t: { $task: 11 }, type: "XX" }, "x"] }, WS("Fondasi"));
  const tasks = m.tasks.map((t) => (t.id === 20 ? self : t));
  const s = await ui(self, { tasks, records: m.records, storage: { "section:open": true } });
  assert.ok(body3(s.tree));
  const note = byCls(part(s.tree, "deps"), "plg-timeline-sec-bad")[0];
  assert.ok(note && txt(note).includes("2 dependensi rusak"), note && txt(note));
  buttonByText(s.tree, "Hapus dependensi rusak").props.onClick();
  s.render();
  assert.deepEqual(s.calls.set, [[20, { deps: [good] }]]);
  assert.equal(s.calls.setMany.length, 0);
});

test("Batasan: pilih 'Mulai tidak lebih awal dari' + 2026-11-12 → patch constraint SNET + aliran; 'Harus selesai pada' → MFO; 'Secepatnya (ASAP)' → constraint null", async () => {
  const { s } = await open3();
  const g = part(s.tree, "constraint");
  assert.equal(g.props.role, "group");
  assert.equal(g.props["aria-label"], "Batasan");
  const sel = byLabel(g, "Jenis batasan");
  assert.equal(sel.type, "select");
  assert.deepEqual(optTexts(sel), ["Secepatnya (ASAP)", "Mulai tidak lebih awal dari", "Harus selesai pada"]);
  assert.equal(sel.props.value, "");
  assert.equal(byLabel(g, "Tanggal batasan"), undefined, "ASAP tanpa tanggal");
  sel.props.onChange(ev("SNET"));
  s.render();
  assert.deepEqual(s.calls.set, [[20, { constraint: { type: "SNET", date: "2026-11-05" } }]], "tanggal bawaan = Mulai hasil hitung (tanpa geser)");
  await s.settle();
  const date = byLabel(part(s.tree, "constraint"), "Tanggal batasan");
  assert.equal(date.props.value, "2026-11-05");
  assert.equal(byLabel(part(s.tree, "constraint"), "Jenis batasan").props.value, "SNET");
  date.props.onChange(ev("2026-11-12"));
  byLabel(part(s.tree, "constraint"), "Tanggal batasan").props.onBlur(ev("2026-11-12"));
  s.render();
  assert.deepEqual(s.calls.setMany, [[
    { taskId: 20, patch: { constraint: { type: "SNET", date: "2026-11-12" }, start: "2026-11-12" } },
    { taskId: 31, patch: { start: "2026-11-18" } },
  ]]);
  await s.settle();
  assert.equal(lastToast(s)[0], "Jadwal diubah · 1 task ikut bergeser");
  // MFO: tanggal bawaan = Selesai hasil hitung
  const b = await open3();
  byLabel(part(b.s.tree, "constraint"), "Jenis batasan").props.onChange(ev("MFO"));
  b.s.render();
  assert.deepEqual(b.s.calls.set, [[20, { constraint: { type: "MFO", date: "2026-11-10" } }]]);
  // ASAP dari SNET tersimpan → constraint null (+ Mulai kembali ke hasil hitung)
  const m = mockup({ start: "2026-11-09" });
  const self = mk(20, "Token tema", { start: "2026-11-09", duration: 4, constraint: { type: "SNET", date: "2026-11-09" }, deps: [{ t: { $task: 12 }, type: "FS", lag: 1 }] }, WS("Fondasi"));
  const c = await ui(self, { tasks: m.tasks.map((t) => (t.id === 20 ? self : t)), records: m.records, storage: { "section:open": true } });
  assert.equal(byLabel(part(c.tree, "constraint"), "Jenis batasan").props.value, "SNET");
  byLabel(part(c.tree, "constraint"), "Jenis batasan").props.onChange(ev(""));
  c.render();
  assert.deepEqual(c.calls.set, [[20, { constraint: null, start: "2026-11-05" }]]);
  assert.equal(c.calls.setMany.length, 0);
});

test("Menunggu: pilihan tipe berlabel 'Selesai → Mulai (FS)'…'Mulai → Selesai (SF)'; ubah ke SS → deps ditulis ulang utuh (dependensi lain apa adanya); lag 1 → '+1 hk'; Diikuti oleh = penerus dari daftar lengkap, tanpa input", async () => {
  const d12 = { t: { $task: 12 }, lag: 1 }; // bentuk 1b tanpa type → tetap tanpa type (byte-identik)
  const d11 = { t: { $task: 11 }, type: "FS", lag: 0 };
  const m = mockup();
  const self = mk(20, "Token tema", { start: "2026-11-05", duration: 4, deps: [d12, d11, "x"] }, WS("Fondasi"));
  const note = mk(32, "Catatan rilis", { mode: "manual", deps: [{ t: { $task: 20 }, type: "FF", lag: 2 }] }, WS("Rilis")); // Manual tanpa Mulai: bukan simpul
  const tasks = m.tasks.map((t) => (t.id === 20 ? self : t)).concat([note]);
  const s = await ui(self, { tasks, records: m.records, storage: { "section:open": true } });
  const deps = part(s.tree, "deps");
  const pred = nodes(deps, (n) => n.props["data-group"] === "pred")[0];
  const succ = nodes(deps, (n) => n.props["data-group"] === "succ")[0];
  assert.ok(txt(pred).startsWith("Menunggu"));
  assert.ok(txt(succ).startsWith("Diikuti oleh"));
  const rows = byCls(pred, "plg-timeline-dep");
  assert.equal(rows.length, 2);
  assert.equal(txt(byCls(rows[0], "plg-timeline-dep-name")[0]).trim(), "1.2 Palet Sakura + Lavender");
  const sel = byLabel(rows[0], "Tipe dependensi Palet Sakura + Lavender");
  assert.equal(sel.type, "select");
  assert.deepEqual(optTexts(sel), TYPE_LABELS);
  assert.equal(sel.props.value, "FS");
  assert.equal(txt(byCls(rows[0], "plg-timeline-dep-lag")[0]).trim(), "+1 hk");
  assert.equal(byCls(rows[1], "plg-timeline-dep-lag").length, 0, "lag 0 tanpa keterangan");
  assert.ok(byLabel(rows[0], "Jeda setelah Palet Sakura + Lavender (hari kerja)"));
  assert.ok(byLabel(rows[0], "Hapus dependensi Palet Sakura + Lavender"));
  // Diikuti oleh: 3.1 (simpul) + Catatan rilis (bukan simpul, dari daftar lengkap); baca saja
  const srows = byCls(succ, "plg-timeline-dep");
  assert.deepEqual(srows.map((r) => txt(byCls(r, "plg-timeline-dep-name")[0]).trim()), ["3.1 Uji tema", "3.2 Catatan rilis"]);
  assert.equal(nodes(succ, (n) => n.type === "input" || n.type === "select" || n.type === "button").length, 0);
  // ubah dependensi 11 → SS: tidak menggeser (pendorong tetap 12) → set tunggal; deps utuh, item lain apa adanya
  byLabel(rows[1], "Tipe dependensi Riset warna").props.onChange(ev("SS"));
  s.render();
  assert.equal(s.calls.setMany.length, 0);
  assert.deepEqual(s.calls.set, [[20, { deps: [d12, { t: { $task: 11 }, type: "SS", lag: 0 }, "x"] }]]);
  assert.equal(JSON.stringify(s.calls.set[0][1].deps[0]), JSON.stringify(d12));
  // pendorong 12 → SS (lag 1): Mulai maju ke Sel 3, penerus 3.1 ikut → satu setMany (aliran)
  const s2 = await ui(self, { tasks, records: m.records, storage: { "section:open": true } });
  const r2 = byCls(nodes(part(s2.tree, "deps"), (n) => n.props["data-group"] === "pred")[0], "plg-timeline-dep");
  byLabel(r2[0], "Tipe dependensi Palet Sakura + Lavender").props.onChange(ev("SS"));
  s2.render();
  assert.equal(s2.calls.set.length, 0);
  assert.deepEqual(s2.calls.setMany, [[
    { taskId: 20, patch: { deps: [{ t: { $task: 12 }, lag: 1, type: "SS" }, d11, "x"], start: "2026-11-03" } },
    { taskId: 31, patch: { start: "2026-11-09" } },
  ]]);
});

test("Ubah (Mulai otomatis) → input; tanggal sebelum syarat → toast 'Tidak bisa lebih awal dari dependensinya', 0 tulis; sesudah → start + SNET", async () => {
  const { s } = await open3();
  buttonByText(part(s.tree, "start"), "Ubah").props.onClick();
  s.render();
  const inp = byLabel(part(s.tree, "start"), "Mulai");
  assert.equal(inp.type, "input");
  assert.equal(inp.props.type, "date");
  assert.equal(inp.props.value, "2026-11-05");
  inp.props.onChange(ev("2026-11-04"));
  byLabel(part(s.tree, "start"), "Mulai").props.onBlur(ev("2026-11-04"));
  s.render();
  assert.equal(s.calls.set.length + s.calls.setMany.length, 0);
  assert.deepEqual(lastToast(s), ["Tidak bisa lebih awal dari dependensinya", "error"]);
  assert.equal(txt(byCls(part(s.tree, "start"), "plg-timeline-sec-val")[0]).trim(), "Kam 5 Nov", "kembali ke teks");
  buttonByText(part(s.tree, "start"), "Ubah").props.onClick();
  s.render();
  byLabel(part(s.tree, "start"), "Mulai").props.onChange(ev("2026-11-09"));
  byLabel(part(s.tree, "start"), "Mulai").props.onBlur(ev("2026-11-09"));
  s.render();
  assert.deepEqual(s.calls.setMany, [[
    { taskId: 20, patch: { start: "2026-11-09", constraint: { type: "SNET", date: "2026-11-09" } } },
    { taskId: 31, patch: { start: "2026-11-13" } },
  ]]);
  assert.equal(s.calls.set.length, 0);
  await s.settle();
  assert.equal(lastToast(s)[0], "Jadwal diubah · 1 task ikut bergeser");
});

test("whyText contoh mockup persis (R21) — 'Kenapa' terlipat bawaan; explain dipanggil hanya saat dibuka (spy), dengan kalender run dan readExt", async () => {
  const orig = T.engine.explain;
  const seen = [];
  T.engine.explain = (...a) => { seen.push(a); return orig(...a); };
  try {
    const { s } = await open3({ deadline: "2026-11-09" });
    const box = part(s.tree, "why");
    const btn = buttonByText(box, "Kenapa dijadwalkan di sini?");
    assert.equal(btn.props["aria-expanded"], false);
    assert.equal(byCls(s.tree, "plg-timeline-sec-why").length, 0);
    s.render();
    await s.settle();
    assert.equal(seen.length, 0, "terlipat → explain tidak dipanggil");
    btn.props.onClick();
    s.render();
    assert.ok(seen.length > 0);
    const [result, key, cal, readExt] = seen[0];
    assert.ok(result.nodes instanceof Map);
    assert.equal(key, "20");
    assert.ok(cal && typeof cal === "object");
    assert.equal(typeof readExt, "function");
    const p = byCls(s.tree, "plg-timeline-sec-why")[0];
    assert.equal(txt(p), MOCKUP_WHY);
    assert.deepEqual(nodes(p, (n) => n.type === "strong").map((n) => txt(n)), ["Kam 5 Nov", "1.2 Palet Sakura + Lavender", "Sel 10 Nov"]);
    assert.equal(buttonByText(part(s.tree, "why"), "Kenapa dijadwalkan di sini?").props["aria-expanded"], true);
    buttonByText(part(s.tree, "why"), "Kenapa dijadwalkan di sini?").props.onClick();
    s.render();
    assert.equal(byCls(s.tree, "plg-timeline-sec-why").length, 0);
    assert.equal(s.calls.set.length + s.calls.setMany.length, 0);
  } finally {
    T.engine.explain = orig;
  }
});

test("whyText murni: varian root/snet/mfo/manual/done/started/cycle/unscheduled persis; SS/FF; lag tanpa hari lag; > 6 hari dilewati → 'dan {n} hari lain'", () => {
  const ctx = { label: (k) => ({ 12: "1.2 Palet Sakura + Lavender", 7: "1.1 A" })[k] || k, title: (k) => ({ 7: "Riset", 8: "Desain" })[k] || k };
  const W = (ex) => whyStr(T.whyText(Object.assign({ base: null, lagDays: [], start: null, skipped: [], finish: null, durSkipped: [], late: 0, deadline: null }, ex), ctx));
  const wk = (iso, why) => ({ dn: D(iso), why });
  // mockup sebagai struktur explain
  const mock = { kind: "pred", pred: "12", type: "FS", lag: 1, base: D("2026-11-03"), lagDays: [D("2026-11-04")], start: D("2026-11-05"), finish: D("2026-11-10"),
    durSkipped: [wk("2026-11-07", "Sabtu"), wk("2026-11-08", "Minggu")], late: 1, deadline: D("2026-11-09") };
  assert.equal(W(mock), MOCKUP_WHY);
  const arr = T.whyText(Object.assign({}, mock), ctx);
  assert.deepEqual(arr.filter((x) => typeof x !== "string"), [{ b: "Kam 5 Nov" }, { b: "1.2 Palet Sakura + Lavender" }, { b: "Sel 10 Nov" }]);
  // tanpa tenggat terlewat → "."
  assert.equal(W(Object.assign({}, mock, { late: 0, deadline: D("2026-11-20") })),
    "Mulai Kam 5 Nov karena menunggu 1.2 Palet Sakura + Lavender selesai Sel 3 Nov, ditambah lag 1 hari (Rab 4 Nov dilewati). Durasi 4 hari kerja melompati Sab–Min, jadi selesai Sel 10 Nov.");
  // SS → "mulai {tglP}"; FS dari Jumat tanpa lag → Sab–Min dilewati
  assert.equal(W({ kind: "pred", pred: "7", type: "SS", lag: 0, base: D("2026-11-02"), start: D("2026-11-02"), finish: D("2026-11-02") }),
    "Mulai Sen 2 Nov karena menunggu 1.1 A mulai Sen 2 Nov. Durasi 1 hari kerja, jadi selesai Sen 2 Nov.");
  assert.equal(W({ kind: "pred", pred: "7", type: "FS", lag: 0, base: D("2026-11-06"), skipped: [wk("2026-11-07", "Sabtu"), wk("2026-11-08", "Minggu")], start: D("2026-11-09"), finish: D("2026-11-09") }),
    "Mulai Sen 9 Nov karena menunggu 1.1 A selesai Jum 6 Nov (Sab–Min dilewati). Durasi 1 hari kerja, jadi selesai Sen 9 Nov.");
  // tepi T3: lag ≠ 0 tanpa hari lag (FF dari milestone akhir pekan) → tanpa "()"
  const ff = W({ kind: "pred", pred: "7", type: "FF", lag: 1, base: D("2026-11-07"), start: D("2026-11-09"), finish: D("2026-11-10") });
  assert.equal(ff, "Mulai Sen 9 Nov karena menunggu 1.1 A selesai Sab 7 Nov, ditambah lag 1 hari. Durasi 2 hari kerja, jadi selesai Sel 10 Nov.");
  assert.ok(!ff.includes("()"));
  // varian persis
  assert.equal(W({ kind: "root", base: D("2026-11-02"), start: D("2026-11-02"), finish: D("2026-11-04") }),
    "Mulai di tanggal yang kamu tentukan. Durasi 3 hari kerja, jadi selesai Rab 4 Nov.");
  assert.equal(W({ kind: "snet", base: D("2026-11-07"), skipped: [wk("2026-11-07", "Sabtu"), wk("2026-11-08", "Minggu")], start: D("2026-11-09"), finish: D("2026-11-11") }),
    "Mulai Sen 9 Nov karena batasan: mulai tidak lebih awal dari Sab 7 Nov. Durasi 3 hari kerja, jadi selesai Rab 11 Nov.");
  assert.equal(W({ kind: "mfo", start: D("2026-11-09"), finish: D("2026-11-11") }),
    "Harus selesai pada Rab 11 Nov (batasan). Durasi 3 hari kerja, jadi selesai Rab 11 Nov.");
  // tepi T3: Manual tersimpan Sabtu — durSkipped memuat hari mulai sendiri → tidak disebut "melompati"
  assert.equal(W({ kind: "manual", start: D("2026-11-07"), finish: D("2026-11-11"), durSkipped: [wk("2026-11-07", "Sabtu"), wk("2026-11-08", "Minggu")] }),
    "Task ini Manual: tanggal mengikuti yang kamu isi. Durasi 3 hari kerja, jadi selesai Rab 11 Nov.");
  assert.equal(W({ kind: "done", start: D("2026-11-02"), finish: D("2026-11-03") }), "Task ini sudah selesai: tanggalnya tidak dihitung ulang.");
  assert.equal(W({ kind: "started", start: D("2026-11-02"), finish: D("2026-11-03"), late: 2, deadline: D("2026-10-30") }),
    "Task ini sudah mulai: tanggal mulainya dikunci. Durasi 2 hari kerja, jadi selesai Sel 3 Nov, 2 hari kerja setelah tenggat Jum 30 Okt.");
  assert.equal(W({ kind: "cycle", cycleWith: ["7", "8"] }), "Dependensinya melingkar dengan Riset, Desain; tidak dihitung.");
  assert.equal(W({ kind: "unscheduled" }), "Belum dijadwalkan.");
  // milestone (ctx.d = 0): tanpa kalimat durasi; task 1 hari pada tanggal sama tetap berkalimat durasi
  const W0 = (ex, d) => whyStr(T.whyText(Object.assign({ base: null, lagDays: [], start: null, skipped: [], finish: null, durSkipped: [], late: 0, deadline: null }, ex), Object.assign({}, ctx, { d })));
  assert.equal(W0({ kind: "root", base: D("2026-11-07"), start: D("2026-11-07"), finish: D("2026-11-07") }, 0), "Mulai di tanggal yang kamu tentukan.");
  assert.equal(W0({ kind: "root", base: D("2026-11-09"), start: D("2026-11-09"), finish: D("2026-11-09") }, 1), "Mulai di tanggal yang kamu tentukan. Durasi 1 hari kerja, jadi selesai Sen 9 Nov.");
  // libur bernama (libur + cuti bernama sama berurutan = satu sebutan), akhir pekan yang juga libur = Sab–Min
  const hol = [{ dn: D("2026-03-18"), why: "cuti", name: "Nyepi" }, { dn: D("2026-03-19"), why: "libur", name: "Nyepi" }];
  assert.equal(W({ kind: "pred", pred: "7", type: "FS", lag: 0, base: D("2026-03-17"), skipped: hol, start: D("2026-03-20"), finish: D("2026-03-20") }),
    "Mulai Jum 20 Mar karena menunggu 1.1 A selesai Sel 17 Mar (Nyepi dilewati). Durasi 1 hari kerja, jadi selesai Jum 20 Mar.");
  // > 6 hari dilewati → 6 disebut + "dan {n} hari lain"; hari tambahan tanpa nama = tanggal
  const nine = [];
  for (let k = 0; k < 9; k++) nine.push({ dn: D("2026-11-10") + k, why: "tambahan" });
  const many = W({ kind: "pred", pred: "7", type: "FS", lag: 0, base: D("2026-11-09"), skipped: nine, start: D("2026-11-19"), finish: D("2026-11-19") });
  const six = nine.slice(0, 6).map((x) => T.TLCal.fmtShort(x.dn)).join(", ");
  assert.ok(many.includes("(" + six + " dan 3 hari lain dilewati)"), many);
  // dua akhir pekan → dibedakan dengan tanggal
  const two = W({ kind: "manual", start: D("2026-11-06"), finish: D("2026-11-16"), durSkipped: [wk("2026-11-07", "Sabtu"), wk("2026-11-08", "Minggu"), wk("2026-11-14", "Sabtu"), wk("2026-11-15", "Minggu")] });
  assert.ok(two.includes("melompati Sab 7–Min 8 Nov, Sab 14–Min 15 Nov, jadi"), two);
  assert.equal(T.whyText(null, ctx).map((p) => (typeof p === "string" ? p : p.b)).join(""), "Belum dijadwalkan.");
});

test("Ubah ke Manual di unit otomatis → {mode: 'manual'}", async () => {
  const { s } = await open3();
  buttonByText(part(s.tree, "manual"), "Ubah ke Manual").props.onClick();
  s.render();
  assert.deepEqual(s.calls.setMany, [[{ taskId: 20, patch: { mode: "manual" } }]]);
  assert.equal(s.calls.set.length, 0);
  await s.settle();
  assert.equal(lastToast(s)[0], "Jadwal diubah");
  assert.ok(byLabel(s.tree, "Mulai") && byLabel(s.tree, "Mulai").type === "input", "tingkat 1 (Manual)");
});

// B otomatis eksplisit (unit Manual) tersimpan Sen 9 (hasil Kam 5) + n penerus otomatis setelah B.
function autoWithSucc(n, succStart) {
  const A = mk(800, "A", { start: "2026-11-02", duration: 3 }, WS("Fondasi"));
  const B = mk(801, "B", { start: "2026-11-09", duration: 2, mode: "auto", deps: [{ t: { $task: 800 }, type: "FS", lag: 0 }] }, WS("Fondasi"));
  const succ = [];
  for (let k = 0; k < n; k++) succ.push(mk(810 + k, "T" + k, { start: succStart, duration: 1, mode: "auto", deps: [{ t: { $task: 801 }, type: "FS", lag: 0 }] }, WS("Fondasi")));
  return { A, B, succ, tasks: [A, B].concat(succ) };
}

test("aliran dari seksi > 20 → PreviewCard 5 baris + 'dan {n} lainnya' (Mode dan Perbarui juga); Terapkan = satu setMany, Batal = 0", async () => {
  // Mode: B → Manual (jangkar Sen 9) menggeser 21 penerus (tersimpan Sen 9 → Rab 11)
  const x = autoWithSucc(21, "2026-11-09");
  const s = await ui(x.B, { tasks: x.tasks, storage: { "section:open": true } });
  modeBtn(s.tree, "manual").props.onClick();
  s.render();
  assert.equal(s.calls.set.length + s.calls.setMany.length, 0);
  const card = byCls(s.tree, "plg-timeline-pvcard")[0];
  assert.ok(card);
  assert.equal(card.props.role, "group");
  assert.equal(byCls(card, "plg-timeline-pv-row").length, 5);
  assert.equal(txt(byCls(card, "plg-timeline-pvcard-more")[0]).trim(), "dan 17 lainnya");
  assert.ok(txt(byCls(card, "plg-timeline-pv-summary")[0]).startsWith("22 task bergeser") || txt(byCls(card, "plg-timeline-pv-summary")[0]).startsWith("21 task bergeser"), txt(byCls(card, "plg-timeline-pv-summary")[0]));
  assert.equal(modeBtn(s.tree, "auto").props["aria-pressed"], true, "tanpa tulis optimistis sebelum Terapkan");
  buttonByText(card, "Batal").props.onClick();
  await s.settle();
  assert.equal(byCls(s.tree, "plg-timeline-pvcard").length, 0);
  assert.equal(s.calls.set.length + s.calls.setMany.length, 0);
  modeBtn(s.tree, "manual").props.onClick();
  s.render();
  buttonByText(byCls(s.tree, "plg-timeline-pvcard")[0], "Terapkan").props.onClick();
  await s.settle();
  assert.equal(s.calls.setMany.length, 1);
  assert.equal(s.calls.setMany[0].length, 22);
  assert.deepEqual(s.calls.setMany[0][0], { taskId: 801, patch: { mode: null } });
  assert.deepEqual(s.calls.setMany[0][1], { taskId: 810, patch: { start: "2026-11-11" } });
  assert.equal(lastToast(s)[0], "Jadwal diterapkan · 22 task");
  assert.equal(lastToast(s)[2].label, "Urungkan");
  // Perbarui: B drift + 21 penerus drift (tersimpan Sen 16, hasil Sen 9) → PreviewCard, bukan tulis langsung
  const y = autoWithSucc(21, "2026-11-16");
  const s2 = await ui(y.B, { tasks: y.tasks });
  buttonByText(s2.tree, "Perbarui").props.onClick();
  s2.render();
  assert.equal(s2.calls.setMany.length, 0);
  const card2 = byCls(s2.tree, "plg-timeline-pvcard")[0];
  assert.ok(card2, "kartu tampil juga saat terlipat");
  assert.equal(txt(byCls(card2, "plg-timeline-pvcard-more")[0]).trim(), "dan 17 lainnya");
  buttonByText(card2, "Terapkan").props.onClick();
  await s2.settle();
  assert.equal(s2.calls.setMany.length, 1);
  assert.deepEqual(s2.calls.setMany[0].slice(0, 2), [{ taskId: 801, patch: { start: "2026-11-05" } }, { taskId: 810, patch: { start: "2026-11-09" } }]);
  // Terapkan saat data berubah (CAS) → toast hitung ulang, 0 tulis, kartu tetap
  const z = autoWithSucc(21, "2026-11-16");
  let calls = 0;
  const listImpl = () => {
    calls++;
    const out = JSON.parse(JSON.stringify(z.tasks));
    if (calls > 1) out[2].ext["timeline.start"] = "2026-11-17";
    return Promise.resolve(out);
  };
  const s3 = await ui(z.B, { listImpl });
  buttonByText(s3.tree, "Perbarui").props.onClick();
  s3.render();
  buttonByText(byCls(s3.tree, "plg-timeline-pvcard")[0], "Terapkan").props.onClick();
  await s3.settle();
  assert.equal(s3.calls.setMany.length, 0);
  assert.equal(lastToast(s3)[0], "Data berubah sejak pratinjau dibuka — hitung ulang");
  assert.ok(byCls(s3.tree, "plg-timeline-pvcard")[0], "kartu dihitung ulang");
});

test("PreviewCard: durasi hilang → 'durasi belum diisi, dianggap 1 hari kerja'; Terapkan nonaktif tanpa baris", () => {
  const prev = global.React;
  global.React = { createElement: (type, p, ...children) => ({ type, props: p || {}, children: children.flat(Infinity) }) };
  try {
    let applied = 0;
    let cancelled = 0;
    const model = { rows: [{ key: "9", task: { title: "Baru" }, wbs: "2.3", from: null, to: "2026-11-05", deltaHk: null, isNew: true, durChanged: false, durGuess: true }],
      moved: 1, endBefore: null, endAfter: null, endDelta: null, late: 0, notMoved: [], brokenDeps: 0 };
    const el = T.PreviewCard({ model, onApply: () => applied++, onCancel: () => cancelled++ });
    assert.ok(txt(el).includes("durasi belum diisi, dianggap 1 hari kerja"));
    assert.ok(txt(el).includes("baru dijadwalkan"));
    assert.ok(txt(byCls(el, "plg-timeline-pv-row")[0]).includes("2.3 · Baru · — → Kam 5 Nov"));
    assert.equal(byCls(el, "plg-timeline-pvcard-more").length, 0);
    buttonByText(el, "Terapkan").props.onClick();
    buttonByText(el, "Batal").props.onClick();
    assert.deepEqual([applied, cancelled], [1, 1]);
    const empty = T.PreviewCard({ model: Object.assign({}, model, { rows: [], moved: 0 }), onApply() {}, onCancel() {} });
    assert.equal(buttonByText(empty, "Terapkan").props.disabled, true);
  } finally {
    global.React = prev;
  }
});

test("sumber Task 12: teks persis R20/R21 tingkat 3, tetap satu setMany di seksi", () => {
  for (const t of TYPE_LABELS.concat(["Batasan", "Secepatnya (ASAP)", "Mulai tidak lebih awal dari", "Harus selesai pada", "Menunggu", "Diikuti oleh",
    "Kenapa dijadwalkan di sini?", "Ubah ke Manual", "Ubah", "Mulai di tanggal yang kamu tentukan.", "Task ini Manual: tanggal mengikuti yang kamu isi.",
    "Task ini sudah selesai: tanggalnya tidak dihitung ulang.", "Task ini sudah mulai: tanggal mulainya dikunci.", "Belum dijadwalkan.", "Sab–Min", " hari lain"])) {
    assert.ok(jsx.includes('"' + t + '"') || jsx.includes(t), t);
  }
  const start = jsx.indexOf("// 4g.");
  const block = jsx.slice(start, jsx.indexOf("// React.memo dibuat malas", start));
  assert.equal((block.match(/taskExt\.setMany\(/g) || []).length, 1);
  assert.equal((block.match(/taskExt\.set\(/g) || []).length, 1);
  assert.match(block, /engine\.explain\(/, "explain lewat pintu spy");
  assert.doesNotMatch(block, /TLCpm\.explain\(/);
  for (const c of [".plg-timeline-pvcard", ".plg-timeline-sec-why", ".plg-timeline-dep-lag"]) assert.ok(css.includes(c), c);
});
