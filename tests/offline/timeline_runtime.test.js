"use strict";
// Plugin Timeline (Fase 1, PR 1b) — Task 11: integrasi dengan runtime NYATA (static/plugin-runtime.js), TF.pluginsync
// + fake-indexeddb (api.records, PR 1a-2) dan rute task lokal (api.taskExt tanpa binding host, 1a-1 R14).
// Memverifikasi D1–D8 rencana 1b terhadap implementasi 1a-2: plugin.js HASIL BUILD dimuat lewat P.load + vm.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { deleteDB } = require("./setup.js");
const dbmod = require("../../static/offline/db.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const SP = require("../../static/offline/syncpush.js");
const PS = require("../../static/offline/plugin_sync.js");
const repo = require("../../static/offline/taskrepo.js");
const RT = require("../../static/plugin-runtime.js");
const build = require("../../compile.js");

const P = RT.plugins;
const { PluginStorageError } = RT.api;
const dir = path.join(__dirname, "../../static/plugins/timeline");
const indexPath = path.join(__dirname, "../../static/plugins/index.json");
const idx = JSON.parse(fs.readFileSync(indexPath, "utf8"));
const entry = idx.plugins.find((p) => p.id === "timeline");
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
const code = fs.readFileSync(path.join(dir, "plugin.js"), "utf8");
const PATH = "/api/plugins/timeline/records";
const MSG_LOST = "Perubahan kalender di perangkat ini kalah oleh perubahan yang lebih baru";

let toasts;
let origDispatch;

beforeEach(async () => {
  P._reset();
  dbmod._reset();
  await deleteDB(dbmod.DB_NAME);
  await P.init({ fetchIndex: () => Promise.resolve(idx) });
  toasts = [];
  P.bindHost({ toast: (...a) => toasts.push(a) });
  origDispatch = globalThis.dispatchEvent;
  globalThis.dispatchEvent = () => true;
});
afterEach(() => {
  if (origDispatch === undefined) delete globalThis.dispatchEvent; else globalThis.dispatchEvent = origDispatch;
  P._reset();
});

// ── pembantu ────────────────────────────────────────────────────────────────
// React di sandbox vm meneruskan ke global.React (diganti `mount` per render) agar komponen hasil build bisa dirender.
const reactProxy = new Proxy({}, { get: (_, k) => (global.React ? global.React[k] : undefined) });

function loadScript(box) {
  const sandbox = { window: { TF: { plugins: P } }, module: { exports: {} }, React: reactProxy };
  sandbox.self = sandbox.window;
  vm.runInNewContext(code, sandbox);
  box.exports = sandbox.module.exports;
}

// ON → P.load menyuntik plugin.js (di vm) + style.css; mengembalikan {T: ekspor plugin.js, urls}.
async function enableAndLoad() {
  const box = { exports: null };
  const urls = [];
  const inject = (url, kind) => {
    urls.push(url);
    if (kind === "script") loadScript(box);
    return Promise.resolve();
  };
  await P.setEnabled("timeline", true);
  assert.equal(await P.load("timeline", { inject, timeoutMs: 1000 }), true);
  return { T: box.exports, urls };
}

const pluginOps = async () => (await outboxAll()).filter((o) => o.entity_type === "plugin");
function rawAll(store) {
  return dbmod.openDB().then((d) => new Promise((res, rej) => {
    const r = d.transaction(store, "readonly").objectStore(store).getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
const rawCal = async () => (await rawAll("plugin_records")).filter((r) => r.plugin_id === "timeline" && r.entity === "calendar");
// Objek dari plugin.js (vm) berasal dari realm lain: salin lewat JSON sebelum deepEqual dengan nilai di sisi tes.
const J = (x) => JSON.parse(JSON.stringify(x));
const idOf = (t) => (t.server_id != null ? t.server_id : t.cid);
const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(pred, what) {
  for (let i = 0; i < 200; i++) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail("menunggu: " + what);
}

function weekCal(over) {
  return Object.assign({ v: 1, weekdays: [1, 2, 3, 4, 5], national: true, cutiBersama: true, off: [], work: [] }, over || {});
}
const SAT_WORK = weekCal({ weekdays: [1, 2, 3, 4, 5, 6], cutiBersama: false });

// Server push palsu (pola plugin_sync_push.test.js): hook(method, path, body) → respons atau null (bawaan: applied).
function pushServer(hook) {
  const calls = [];
  const rows = new Map();
  return {
    calls, rows,
    request(method, p, body) {
      calls.push({ method, path: p, body: JSON.parse(JSON.stringify(body || {})) });
      const h = hook ? hook(method, p, body) : null;
      return Promise.resolve(h).then((x) => {
        if (x) return x;
        if (method === "POST" && p === PATH) {
          const results = body.items.map((it) => {
            const k = it.entity + "/" + it.id;
            const version = (rows.has(k) ? rows.get(k).version : 0) + 1;
            const rec = { entity: it.entity, id: it.id, scope: it.scope, data: it.data, updated_at: it.updated_at, version, deleted: !!it.deleted };
            rows.set(k, rec);
            return { entity: it.entity, id: it.id, applied: true, record: rec };
          });
          return { status: 200, data: { results } };
        }
        return { status: 404, data: { detail: "Not Found" } };
      });
    },
  };
}
const drain = (srv) => SP.pushOutbox(srv, { tagsFor: () => Promise.resolve([]) });

// Komponen dengan hooks palsu (pola timeline_ui.test.js, disederhanakan): render(props) / flush() / unmount().
function mount(Comp) {
  const slots = [];
  const pending = [];
  let i = 0;
  const same = (a, b) => !!a && !!b && a.length === b.length && a.every((d, n) => Object.is(d, b[n]));
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
    useReducer(red, init) {
      const k = i++;
      if (!slots[k]) slots[k] = { v: init };
      const s = slots[k];
      if (!s.set) s.set = (a) => { s.v = red(s.v, a); };
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
      if (s && same(s.deps, deps)) return s.v;
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
    if (s && deps && same(s.deps, deps)) return;
    const prev = s && s.cleanup;
    slots[k] = { deps, cleanup: null };
    pending.push(() => {
      if (typeof prev === "function") prev();
      slots[k].cleanup = fn();
    });
  }
  const withReact = (fn) => {
    const prev = global.React;
    global.React = React;
    try { return fn(); } finally { global.React = prev; }
  };
  return {
    render(props) { return withReact(() => { i = 0; return Comp(props); }); },
    flush() { withReact(() => { while (pending.length) pending.shift()(); }); },
    unmount() { for (const s of slots) if (s && typeof s.cleanup === "function") s.cleanup(); },
  };
}
function nodes(node, pred, out = []) {
  if (Array.isArray(node)) { for (const n of node) nodes(n, pred, out); return out; }
  if (!node || typeof node !== "object") return out;
  if (pred(node)) out.push(node);
  for (const c of node.children || []) nodes(c, pred, out);
  return out;
}
const byCls = (tree, c) => nodes(tree, (n) => typeof n.props.className === "string" && n.props.className.split(/\s+/).indexOf(c) >= 0);

// ── D1, D2: manifest dan index.json repo ────────────────────────────────────
test("index.json repo: timeline valid (izin records dikenal, records.calendar + records.project tersalin), defaultEnabled false", () => {
  assert.ok(entry, "entri timeline di index.json");
  assert.deepEqual(P.validateManifest(entry, idx), { ok: true, reason: null }, "validateManifest runtime nyata menerima entri");
  assert.ok(P.KNOWN_PERMISSIONS.includes("records") && !P.RESERVED_PERMISSIONS.includes("records"), "D1: records dikenal");
  assert.deepEqual(entry.permissions, ["storage", "task.ext", "records"]);
  assert.deepEqual(entry.records, { calendar: { conflict: "lww", maxBytes: 16384 }, project: { conflict: "lww", maxBytes: 1024 } }, "D2: records tersalin ke index.json (1c-1 R6: + project)");
  assert.deepEqual(entry.records, manifest.records, "sama dengan manifest.json");
  assert.deepEqual(entry.taskExt, { keys: ["start", "duration", "deps", "mode", "constraint"] });
  assert.equal(entry.defaultEnabled, false);
  assert.equal(P.recordsError(entry), null);
  assert.equal(build.validateRecords(entry), null, "compile.js dan runtime sepakat");
  // izin records tanpa deklarasi / deklarasi tanpa izin ditolak (⇔)
  assert.equal(P.validateManifest(Object.assign({}, entry, { records: undefined }), idx).ok, false);
  assert.equal(P.validateManifest(Object.assign({}, entry, { permissions: ["storage", "task.ext"] }), idx).ok, false);
  // P.init dengan index repo: plugin tercatat, OFF
  assert.ok(P.list().some((p) => p.id === "timeline"));
  assert.equal(P.isEnabled("timeline"), false);
});

test("OFF → plugin.js tidak di-inject; ON + SlotView gantt → register, kontribusi gantt dan schedule ada; records ditarik hanya bila ON", async () => {
  const urls = [];
  const box = { exports: null };
  const inject = (url, kind) => { urls.push(url); if (kind === "script") loadScript(box); return Promise.resolve(); };
  assert.equal(await P.load("timeline", { inject }), false, "OFF → tidak dimuat");
  assert.deepEqual(urls, []);
  assert.deepEqual(P.recordPluginIds(), [], "OFF → tidak ikut tarik record (D5)");
  assert.deepEqual(P.contributions("taskList.views"), []);
  await P.setEnabled("timeline", true);
  assert.deepEqual(P.recordPluginIds(), ["timeline"], "ON → ikut tarik record");
  assert.equal(await P.load("timeline", { inject, timeoutMs: 1000 }), true);
  assert.deepEqual(urls.sort(), [`/static/plugins/timeline/plugin.js?v=${entry.hash}`, `/static/plugins/timeline/style.css?v=${entry.hash}`]);
  assert.deepEqual(P.contributions("taskList.views").map((c) => [c.pluginId, c.id]), [["timeline", "gantt"]]);
  assert.deepEqual(P.contributions("taskDetail.sections").map((c) => [c.pluginId, c.id, c.order]), [["timeline", "schedule", 10]]);
  assert.equal(typeof P.contributions("taskList.views")[0].component, "function");
  assert.equal(P.list().find((p) => p.id === "timeline").loaded, true);
  assert.equal(P.failures("timeline").length, 0);
  // OFF lagi → kontribusi hilang, tidak lagi ikut tarik
  await P.setEnabled("timeline", false);
  assert.deepEqual(P.contributions("taskList.views"), []);
  assert.deepEqual(P.recordPluginIds(), []);
});

// ── D3: api.records nyata ───────────────────────────────────────────────────
test("api.records nyata: get cal@list:12 sebelum ada → null; put → record pending true + satu op outbox plugin; put kedua → tetap satu op (coalescing)", async () => {
  await enableAndLoad();
  const rec = RT.api.for("timeline").records;
  assert.equal(await rec.get("calendar", "cal@list:12"), null);
  const r1 = await rec.put("calendar", "cal@list:12", SAT_WORK, { scope: "list:12" });
  assert.deepEqual(Object.keys(r1).sort(), ["data", "entity", "id", "pending", "scope", "updated_at", "version"]);
  assert.equal(r1.entity, "calendar");
  assert.equal(r1.id, "cal@list:12");
  assert.equal(r1.scope, "list:12");
  assert.deepEqual(r1.data, SAT_WORK);
  assert.equal(r1.pending, true);
  assert.equal(r1.version, null);
  assert.equal((await pluginOps()).length, 1);
  const g1 = await rec.get("calendar", "cal@list:12");
  assert.deepEqual(g1, r1);
  const r2 = await rec.put("calendar", "cal@list:12", weekCal(), { scope: "list:12" });
  assert.equal(r2.pending, true);
  assert.deepEqual((await rec.get("calendar", "cal@list:12")).data, weekCal(), "put kedua pada record yang sama dengan scope sama = update");
  assert.equal((await pluginOps()).length, 1, "coalescing: satu op per record");
  assert.equal((await rawCal()).length, 1);
  // record kedua (kalender pribadi) = op kedua
  await rec.put("calendar", "cal@user", weekCal(), { scope: "user" });
  assert.equal((await pluginOps()).length, 2);
  // scope tak bisa diubah: kalender workspace tidak bisa "pindah" ke user
  const im = await rec.put("calendar", "cal@list:12", weekCal(), { scope: "user" }).catch((e) => e);
  assert.ok(im instanceof PluginStorageError);
  assert.equal(im.code, "SCOPE_IMMUTABLE");
  // entitas selain calendar tidak dideklarasikan → ditolak
  const bad = await rec.put("proyek", "x", {}, { scope: "user" }).catch((e) => e);
  assert.ok(bad instanceof PluginStorageError);
  assert.equal(bad.code, "INVALID");
  assert.equal(P.failures("timeline").length, 0, "salah pakai bukan kegagalan plugin");
});

test("bentuk record nyata cocok dengan fakeRecords tes T6–T10 (mencegah tes palsu menyimpang dari 1a-2)", async () => {
  // fakeRecords() diambil dari sumber timeline_ui.test.js (tanpa menjalankan tes-tesnya).
  const src = fs.readFileSync(path.join(__dirname, "timeline_ui.test.js"), "utf8");
  const s = src.indexOf("function fakeRecords() {");
  const e = src.indexOf("\n}\n", s);
  assert.ok(s >= 0 && e > s, "fakeRecords ditemukan di timeline_ui.test.js");
  const fake = new Function(src.slice(s, e + 3) + "\nreturn fakeRecords();")();
  const { T } = await enableAndLoad();
  const real = RT.api.for("timeline").records;
  // get tak ada → null di keduanya
  assert.equal(await fake.api.get("calendar", "cal@user"), null);
  assert.equal(await real.get("calendar", "cal@user"), null);
  // put → kunci objek record sama persis
  const fr = await fake.api.put("calendar", "cal@list:12", SAT_WORK, { scope: "list:12" });
  const rr = await real.put("calendar", "cal@list:12", SAT_WORK, { scope: "list:12" });
  assert.deepEqual(Object.keys(rr).sort(), Object.keys(fr).sort(), "kunci record put");
  assert.deepEqual(Object.keys(await real.get("calendar", "cal@list:12")).sort(), Object.keys(await fake.api.get("calendar", "cal@list:12")).sort());
  for (const k of ["entity", "id", "scope", "data", "pending"]) assert.deepEqual(rr[k], fr[k], k);
  assert.equal(typeof rr.updated_at, typeof fr.updated_at);
  // onChange → fungsi off
  assert.equal(typeof real.onChange(() => {}), "function");
  assert.equal(typeof fake.api.onChange(() => {}), "function");
  // adaptor menghasilkan hasil sama di atas keduanya (load default, load, save)
  const A = T.calendarStore({ records: fake.api });
  const B = T.calendarStore(RT.api.for("timeline"));
  assert.deepEqual(J(await A.load("cal@user")), J(await B.load("cal@user")));
  assert.deepEqual(J(await A.load("cal@list:12")), J(await B.load("cal@list:12")));
  assert.deepEqual(J(await A.save("cal@user", "user", weekCal({ off: [{ d: "2026-11-02", n: "Cuti" }] }))),
    J(await B.save("cal@user", "user", weekCal({ off: [{ d: "2026-11-02", n: "Cuti" }] }))));
});

// ── calendarStore lewat api.records nyata + IndexedDB ───────────────────────
test("calendarStore: bulat-pergi lewat api.records nyata + IndexedDB (cal@user scope user, cal@list:<id> scope list:<id>); tak ada record → kalender bawaan", async () => {
  const { T } = await enableAndLoad();
  const store = T.calendarStore(RT.api.for("timeline"));
  // D5: sebelum ada record apa pun → bawaan, pending false (tanpa menunggu tarik pertama)
  const def = J(await store.load("cal@list:12"));
  assert.deepEqual(def, { data: J(T.TLCal.normalize(T.TLCal.DEFAULT_CAL)), pending: false, exists: false });
  assert.deepEqual(def.data, { v: 1, weekdays: [1, 2, 3, 4, 5], national: true, cutiBersama: true, off: [], work: [] });
  assert.equal((await rawCal()).length, 0);
  // simpan kalender pribadi dan workspace
  const mine = weekCal({ weekdays: [1, 2, 3, 4, 5, 6], off: [{ d: "2026-11-09", n: "Cuti pribadi" }], work: [{ d: "2026-11-14", n: "Pengganti" }] });
  const sp = await store.save("cal@user", "user", mine);
  assert.deepEqual(J(sp), { data: J(T.TLCal.normalize(mine)), pending: true, exists: true });
  const ws = weekCal({ cutiBersama: false, off: [{ d: "2026-12-24", n: "Brückentag" }] });
  await store.save("cal@list:12", "list:12", ws);
  const rows = (await rawCal()).sort((a, b) => (a.id < b.id ? -1 : 1));
  assert.deepEqual(rows.map((r) => [r.id, r.scope, r.dirty]), [["cal@list:12", "list:12", 1], ["cal@user", "user", 1]]);
  assert.deepEqual(J(await store.load("cal@user")), { data: J(T.TLCal.normalize(mine)), pending: true, exists: true });
  assert.deepEqual(J(await store.load("cal@list:12")), { data: J(T.TLCal.normalize(ws)), pending: true, exists: true });
  assert.equal((await pluginOps()).length, 2);
  // simpan ulang (scope sama) = update, tetap satu op per record
  await store.save("cal@list:12", "list:12", weekCal({ cutiBersama: false, off: [] }));
  assert.equal((await pluginOps()).length, 2);
  assert.deepEqual(J((await store.load("cal@list:12")).data.off), []);
  // kirim ke server: payload membawa entity calendar dan scope; sesudahnya pending false
  const srv = pushServer();
  const r = await drain(srv);
  assert.equal(r.failed, 0);
  const sent = srv.calls.filter((c) => c.path === PATH).flatMap((c) => c.body.items).map((it) => [it.entity, it.id, it.scope]).sort();
  assert.deepEqual(sent, [["calendar", "cal@list:12", "list:12"], ["calendar", "cal@user", "user"]]);
  assert.equal((await store.load("cal@list:12")).pending, false);
  assert.equal((await pluginOps()).length, 0);
  // data dari anggota lain selalu dinormalisasi saat dibaca
  const bad = await RT.api.for("timeline").records.put("calendar", "cal@list:7", { v: 1, weekdays: [], national: "ya", off: [{ d: "salah" }], work: "x", asing: 1 }, { scope: "list:7" });
  assert.equal(bad.data.asing, 1);
  assert.deepEqual(J((await store.load("cal@list:7")).data), J(T.TLCal.normalize(T.TLCal.DEFAULT_CAL)), "data rusak → bawaan yang aman");
});

// ── D7: ukuran ──────────────────────────────────────────────────────────────
test("data > 16 KB → reject sebelum IndexedDB (adaptor menolak dengan pesan UI; runtime TOO_LARGE sebagai pengaman kedua)", async () => {
  const { T } = await enableAndLoad();
  const store = T.calendarStore(RT.api.for("timeline"));
  const off = [];
  for (let i = 0; i < 366; i++) {
    const d = new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString().slice(0, 10);
    off.push({ d, n: "x".repeat(60) });
  }
  const big = weekCal({ off });
  assert.ok(T.TLCal.byteSize(T.TLCal.normalize(big)) > 16384, "kalender uji memang > 16 KB");
  const err = await store.save("cal@list:12", "list:12", big).catch((e) => e);
  assert.equal(err.message, "Kalender terlalu besar — hapus sebagian libur tambahan");
  assert.equal(err.code, "TOO_LARGE");
  assert.equal((await rawCal()).length, 0, "tidak ada tulis IndexedDB");
  assert.equal((await pluginOps()).length, 0);
  // runtime nyata menolak sendiri: kode TOO_LARGE (bukan RECORD_TOO_LARGE), sebelum menulis
  const rec = RT.api.for("timeline").records;
  const big2 = await rec.put("calendar", "cal@user", { s: "a".repeat(16385) }, { scope: "user" }).catch((e) => e);
  assert.ok(big2 instanceof PluginStorageError);
  assert.equal(big2.code, "TOO_LARGE");
  assert.equal((await rawCal()).length, 0);
  assert.equal((await pluginOps()).length, 0);
  // tepat 16384 byte (`{"s":"…"}` = 8 byte pembungkus) diterima
  const ok = await rec.put("calendar", "cal@user", { s: "a".repeat(16376) }, { scope: "user" });
  assert.equal(JSON.stringify(ok.data).length, 16384);
  assert.equal((await rawCal()).length, 1);
});

// ── api.taskExt nyata (rute lokal) ──────────────────────────────────────────
test("api.taskExt nyata (rute lokal): set {start} lalu baca task lewat api.data.tasks.list → ext timeline.start; ext_dirty berisi kunci; deps pakai ref", async () => {
  const { T } = await enableAndLoad();
  const api = RT.api.for("timeline");
  const ra = await repo.createTask({ title: "A" }, { today: "2026-11-01" });
  const rb = await repo.createTask({ title: "B" }, { today: "2026-11-01" });
  const a = { id: idOf(ra), cid: ra.cid };
  const b = { id: idOf(rb), cid: rb.cid };
  await api.taskExt.set(a.id, { start: "2026-11-02" });
  const list = await api.data.tasks.list();
  const ta = list.find((t) => t.id === a.id);
  assert.equal(ta.ext["timeline.start"], "2026-11-02");
  assert.deepEqual(api.taskExt.read(ta), { start: "2026-11-02" });
  const raw = await repo.getRaw(a.cid);
  assert.deepEqual(raw.ext_dirty, ["timeline.start"]);
  assert.equal(raw.dirty, 1);
  // tambah durasi + dependensi (ref = {$task: id}); patch dari sanitizePatch diterima runtime nyata
  const san = J(T.TLSched.sanitizePatch({ duration: 3, deps: [{ t: api.taskExt.ref(a), type: "FS", lag: 0 }] }));
  assert.equal(san.ok, true);
  await api.taskExt.set(b.id, Object.assign({ start: "2026-11-05" }, san.patch));
  const tb = (await api.data.tasks.list()).find((t) => t.id === b.id);
  const sched = J(T.TLSched.readSched(api.taskExt.read(tb)));
  assert.equal(sched.start, "2026-11-05");
  assert.equal(sched.duration, 3);
  assert.deepEqual(sched.deps.map((d) => [d.key, d.type, d.lag]), [[String(a.id), "FS", 0]]);
  assert.deepEqual((await repo.getRaw(b.cid)).ext_dirty.slice().sort(), ["timeline.deps", "timeline.duration", "timeline.start"]);
  // setMany (dipakai Urungkan dan seret): satu hasil per task, null menghapus kunci
  await api.taskExt.setMany([{ taskId: a.id, patch: { start: null } }, { taskId: b.id, patch: { deps: null } }]);
  const after = await api.data.tasks.list();
  assert.deepEqual(api.taskExt.read(after.find((t) => t.id === a.id)), {});
  assert.equal("timeline.deps" in after.find((t) => t.id === b.id).ext, false);
  // kunci di luar manifest.taskExt.keys ditolak runtime (`mode` sah sejak 1.1.0; `actual` baru di 1c-2)
  await assert.rejects(api.taskExt.set(a.id, { actual: "2026-11-05" }), (e) => e instanceof PluginStorageError);
  assert.equal(P.failures("timeline").length, 0);
});

// ── D5, D8: onChange dari sinkron nyata ─────────────────────────────────────
test("onChange source sync (tarik) dan lost (kalah LWW saat kirim) → calendarStore.subscribe menerima; muat ulang mengembalikan data server", async () => {
  const { T } = await enableAndLoad();
  const store = T.calendarStore(RT.api.for("timeline"));
  const seen = [];
  const off = store.subscribe((ev) => seen.push(ev));
  // D5: tarik penuh hanya untuk plugin ON; anggota lain sudah menulis cal@list:12 di server
  const serverRow = (over) => Object.assign({
    entity: "calendar", id: "cal@list:12", scope: "list:12", data: SAT_WORK, updated_at: "2026-11-02T00:00:00Z", version: 3, deleted: false,
  }, over || {});
  const pulls = [];
  const fetchPage = (url) => {
    pulls.push(url);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [Object.assign(serverRow(), { seq: 1 })], cursor: "1.1.aaaa0000", more: false }) });
  };
  const noIds = await PS.pullAll(fetchPage, { userId: 1, ids: [] });
  assert.deepEqual(noIds.plugins, {});
  assert.deepEqual(pulls, []);
  const pulled = await PS.pullAll(fetchPage, { userId: 1, ids: P.recordPluginIds() });
  assert.deepEqual(pulled.errors, []);
  assert.deepEqual(pulls, ["/api/plugins/timeline/records?cursor=&limit=500"]);
  // peristiwa record dulu, lalu satu peristiwa `pulled` host (tarik selesai dan sukses) yang diteruskan adaptor
  assert.deepEqual(J(seen), [{ ids: ["cal@list:12"], source: "sync", lost: [] }, { ids: [], source: "sync", lost: [], pulled: true }]);
  assert.deepEqual(J(await store.load("cal@list:12")), { data: J(T.TLCal.normalize(SAT_WORK)), pending: false, exists: true }, "sesudah tarik selesai, kalender server terbaca");

  // D8: edit lokal kalah LWW (server menjawab applied:false) → lost
  seen.length = 0;
  await store.save("cal@list:12", "list:12", weekCal({ off: [{ d: "2026-11-09", n: "Lokal" }] }));
  assert.deepEqual(J(seen.map((e) => [e.source, e.lost])), [["local", []]]);
  seen.length = 0;
  const winner = serverRow({ data: weekCal({ cutiBersama: false }), version: 9, updated_at: "2026-11-03T00:00:00Z" });
  const srv = pushServer((m, p) => (p === PATH ? { status: 200, data: { results: [{ entity: "calendar", id: "cal@list:12", applied: false, record: winner }] } } : null));
  await drain(srv);
  assert.deepEqual(J(seen), [{ ids: ["cal@list:12"], source: "sync", lost: ["cal@list:12"] }]);
  assert.deepEqual(J(await store.load("cal@list:12")), { data: J(T.TLCal.normalize(winner.data)), pending: false, exists: true }, "data server menang");
  off();
  seen.length = 0;
  PS._internals.emit({ pluginId: "timeline", entity: "calendar", ids: ["cal@user"], source: "sync" });
  assert.deepEqual(seen, [], "off() menghentikan");
  // entitas lain / plugin lain tidak sampai ke pendengar
  const off2 = store.subscribe((ev) => seen.push(ev));
  PS._internals.emit({ pluginId: "timeline", entity: "lain", ids: ["x"], source: "sync" });
  PS._internals.emit({ pluginId: "habit-heatmap", entity: "calendar", ids: ["x"], source: "sync" });
  assert.deepEqual(seen, []);
  off2();
});

test("view nyata: lost untuk kalender aktif → toast persis lewat api.ui.toast nyata + muat ulang; plugin dinonaktifkan → pendengar dilepas", async () => {
  const { T } = await enableAndLoad();
  const api = RT.api.for("timeline");
  const store = T.calendarStore(api);
  const base = PS._internals.listeners.size;
  const tasks = [{ id: 1, title: "A", created_at: "2026-10-01T00:00:01Z", gtd_status: "next", list_id: 12, project: "P", project_id: 5, ext: { "timeline.start": "2026-11-02", "timeline.duration": 3 } }];
  const context = {
    page: "slist_12", pageKind: "workspace", listId: 12, projectName: null,
    tasks, scopeTasks: tasks, liveEdit: false, onTaskClick: () => {}, isSelected: () => false, showToast: () => {},
  };
  const m = mount(T.TimelineViewBody);
  let tree = m.render({ context, api });
  m.flush();
  // dua pendengar onChange: useCalendar (entitas calendar) + useUnits (entitas project, 1c-1 R6)
  await until(() => PS._internals.listeners.size === base + 2, "view berlangganan onChange");
  const bg = () => byCls(m.render({ context, api }), "plg-timeline-chart")[0].props.style.backgroundImage;
  const bgDefault = bg();
  // kalender workspace di-IndexedDB (Sabtu kerja): view memuat dari api.records nyata ketika ada perubahan lokal
  await store.save("cal@list:12", "list:12", SAT_WORK);
  await until(() => bg() !== bgDefault, "view memuat kalender workspace dari record");
  const L = T.TLLayout;
  const readOf = (t) => T.TLSched.readSched(api.taskExt.read(t));
  const lay = L.layout({ tasks, pageKind: "workspace", cal: SAT_WORK, today: api.env.today(), zoom: "week", readSchedOf: readOf });
  assert.equal(bg(), L.weekendGradient(lay.cal, lay.range, lay.px));
  const bgLocal = bg();
  // lost: server memenangkan kalender lain → toast persis, view memuat ulang
  const winner = { entity: "calendar", id: "cal@list:12", scope: "list:12", data: weekCal(), updated_at: "2026-11-03T00:00:00Z", version: 9, deleted: false };
  await store.save("cal@list:12", "list:12", weekCal({ off: [{ d: "2026-11-09", n: "Lokal" }] }));
  toasts.length = 0;
  await drain(pushServer((mm, p) => (p === PATH ? { status: 200, data: { results: [{ entity: "calendar", id: "cal@list:12", applied: false, record: winner }] } } : null)));
  assert.deepEqual(toasts, [[MSG_LOST, "error"]], "tepat satu toast, teks persis spec §8.9");
  await until(() => bg() !== bgLocal, "view memuat ulang kalender server");
  // kalender lain yang kalah → tanpa toast
  toasts.length = 0;
  PS._internals.emit({ pluginId: "timeline", entity: "calendar", ids: ["cal@list:99"], source: "sync", lost: ["cal@list:99"] });
  assert.deepEqual(toasts, []);
  // nonaktifkan plugin → runtime melepas pendengar walau komponen belum unmount
  await P.setEnabled("timeline", false);
  assert.equal(PS._internals.listeners.size, base, "pendengar onChange plugin dilepas saat dinonaktifkan");
  toasts.length = 0;
  PS._internals.emit({ pluginId: "timeline", entity: "calendar", ids: ["cal@list:12"], source: "sync", lost: ["cal@list:12"] });
  assert.deepEqual(toasts, [], "tidak ada callback setelah dinonaktifkan");
  m.unmount();
  assert.equal(PS._internals.listeners.size, base);
  await tick();
});
