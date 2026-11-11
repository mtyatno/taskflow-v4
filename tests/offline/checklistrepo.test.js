"use strict";
// TF.checklistrepo — penyimpanan checklist lokal + antrean aksi (checklist offline Fase 2, spec §4.1–§4.4; rencana
// PR B2 R2). Setiap aksi lokal menulis butir + entri `_outbox` dalam SATU transaksi ["subtasks", "_outbox"],
// lalu progress task lokal (tanpa dirty/rev) dan event tf:outbox-queued. Kesiapan routing dibaca sinkron dari memori.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { deleteDB } = require("./setup.js");
const TFdb = require("../../static/offline/db.js");
const { mapPut, cidOf } = require("../../static/offline/idmap.js");
const { outboxAdd, outboxAll } = require("../../static/offline/outbox.js");
const R = require("../../static/offline/checklistrepo.js");

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "static/offline/checklistrepo.js");
const KEYS = ["depth", "id", "is_done", "parent_id", "sort_order", "task_id", "title"];

beforeEach(async () => {
  R._reset();
  TFdb._reset();
  await deleteDB(TFdb.DB_NAME);
  delete globalThis.__userEpoch;
});

// ── alat bantu ───────────────────────────────────────────────────────────────

function tx(stores, mode, fn) {
  return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let out;
    const r = fn(t);
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
  }));
}
function putTask(rec) { return tx("tasks", "readwrite", (t) => { t.objectStore("tasks").put(rec); }); }
function putItems(recs) { return tx("subtasks", "readwrite", (t) => { for (const r of recs) t.objectStore("subtasks").put(r); }); }
function getTask(cid) { return tx("tasks", "readonly", (t) => t.objectStore("tasks").get(cid)); }
function allItems() { return tx("subtasks", "readonly", (t) => t.objectStore("subtasks").getAll()); }
function metaGet(key) { return tx("_meta", "readonly", (t) => t.objectStore("_meta").get(key)); }
function metaPut(key, val) { return tx("_meta", "readwrite", (t) => { t.objectStore("_meta").put(val, key); }); }
function task(over) {
  return Object.assign({
    cid: "t1", server_id: 7, title: "T", progress: 10, checklist_total: 0, dirty: 0, rev: 3,
    base_rev: "2026-11-01T00:00:00", updated_at: "2026-11-01T00:00:00", deleted: false,
  }, over || {});
}
// Record butir lokal.
function rec(cid, over) {
  return Object.assign({ cid, server_id: null, task_cid: "t1", parent_cid: null, title: cid, is_done: false, sort_order: 0, created_at: null }, over || {});
}
const qOf = (ops) => ops.map((o) => [o.op, o.cid, o.task_cid, o.payload]);
const subtaskOps = async () => (await outboxAll()).filter((o) => o.entity_type === "subtasks");
// a(server 11) > a1(server 12), b(cid "b", belum tersinkron) — task t1 (server 7).
async function pohon() {
  await putTask(task());
  await putItems([
    rec("a", { server_id: 11, sort_order: 0 }),
    rec("a1", { server_id: 12, parent_cid: "a", sort_order: 0 }),
    rec("b", { sort_order: 1 }),
  ]);
  await mapPut("subtask", 11, "a");
  await mapPut("subtask", 12, "a1");
}
// Tangkap event window (Node: globalThis).
function tangkapEvent() {
  const seen = [];
  const prev = globalThis.dispatchEvent;
  globalThis.dispatchEvent = (ev) => { seen.push([ev.type, ev.detail]); return true; };
  return { seen, lepas: () => { if (prev) globalThis.dispatchEvent = prev; else delete globalThis.dispatchEvent; } };
}

// ── modul ────────────────────────────────────────────────────────────────────

test("modul: di browser terpasang sebagai TF.checklistrepo", () => {
  // openDB tidak pernah selesai: start() otomatis di browser tidak menyentuh IndexedDB tes.
  const ctx = { self: { TF: { db: { openDB: () => new Promise(() => {}) }, outbox: {}, ids: {}, checklist: require("../../static/offline/checklist.js") } } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(SRC, "utf8"), ctx);
  const api = ctx.self.TF.checklistrepo;
  for (const k of ["start", "refresh", "reset", "isReady", "knowsTask", "knowsItem", "resolveTask", "findItem",
    "recordsForTask", "itemsForTask", "pendingTaskCids", "create", "setDone", "toggle", "patch", "move", "remove",
    "getRevs", "setRev", "clearRev", "markHydrated", "replaceTaskChecklist", "purgeTask", "adoptServerId", "noteTaskServerId"]) {
    assert.equal(typeof api[k], "function", k);
  }
  assert.equal(api.STORE, "subtasks");
  assert.equal(api.REVS_KEY, "checklist_revs");
  assert.equal(api.HYDRATED_KEY, "checklists_hydrated");
});

test("modul: dimuat index.html tepat setelah checklist.js dan ada di STATIC sw.js", () => {
  const html = fs.readFileSync(path.join(ROOT, "static/index.html"), "utf8");
  assert.match(html, /<script src="\/static\/offline\/checklist\.js"><\/script>\s*\n\s*<script src="\/static\/offline\/checklistrepo\.js"><\/script>/);
  const sw = fs.readFileSync(path.join(ROOT, "static/sw.js"), "utf8");
  assert.match(sw, /"\/static\/offline\/checklist\.js",\s*\n\s*"\/static\/offline\/checklistrepo\.js",/);
});

// ── bentuk API ───────────────────────────────────────────────────────────────

test("itemsForTask: pre-order bentuk API — id = server_id ?? cid, parent_id = id induk, task_id = id server task", async () => {
  await pohon();
  const items = await R.itemsForTask("t1");
  assert.deepEqual(items.map((x) => [x.id, x.parent_id, x.depth, x.task_id, x.sort_order, x.is_done, x.title]), [
    [11, null, 0, 7, 0, false, "a"],
    [12, 11, 1, 7, 0, false, "a1"],
    ["b", null, 0, 7, 1, false, "b"],
  ]);
  for (const x of items) assert.deepEqual(Object.keys(x).sort(), KEYS);
});

test("itemsForTask: task belum tersinkron → task_id = cid; induk belum tersinkron → parent_id = cid; is_done boolean", async () => {
  await putTask(task({ server_id: null }));
  await putItems([rec("p", { is_done: 1 }), rec("q", { parent_cid: "p", is_done: 0 })]);
  const items = await R.itemsForTask("t1");
  assert.deepEqual(items.map((x) => [x.id, x.parent_id, x.task_id, x.is_done]), [["p", null, "t1", true], ["q", "p", "t1", false]]);
  assert.deepEqual(await R.itemsForTask("tidak-ada"), []);
});

test("resolveTask / findItem: cid atau id server (angka maupun teks angka); task terhapus → null", async () => {
  await pohon();
  await putTask(task({ cid: "t9", server_id: 9, deleted: true }));
  assert.equal((await R.resolveTask("t1")).cid, "t1");
  assert.equal((await R.resolveTask(7)).cid, "t1");
  assert.equal((await R.resolveTask("7")).cid, "t1");
  assert.equal(await R.resolveTask("9"), null);
  assert.equal(await R.resolveTask("x"), null);
  assert.equal((await R.findItem("b")).cid, "b");
  assert.equal((await R.findItem("12")).cid, "a1");
  assert.equal((await R.findItem(11)).cid, "a");
  assert.equal(await R.findItem("99"), null);
});

// ── tambah ───────────────────────────────────────────────────────────────────

test("create: butir baru (cid UUID) + satu entri antrean create; respons bentuk API dengan id = cid", async () => {
  await pohon();
  const out = await R.create("t1", { title: "  baru ", parent_id: null, client_id: "ui-1" });
  assert.match(out.item.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual([out.item.title, out.item.parent_id, out.item.depth, out.item.sort_order, out.item.task_id, out.item.is_done],
    ["baru", null, 0, 2, 7, false]);
  assert.deepEqual(out.items.map((x) => x.id), [11, 12, "b", out.item.id]);
  assert.deepEqual(out.task_progress, { done: 0, total: 3, progress: 0 });
  const r = (await allItems()).find((x) => x.cid === out.item.id);
  assert.deepEqual([r.server_id, r.task_cid, r.parent_cid, r.title, r.is_done, r.sort_order, r.client_id],
    [null, "t1", null, "baru", false, 2, "ui-1"]);
  assert.equal(typeof r.created_at, "string");
  const ops = await subtaskOps();
  assert.deepEqual(qOf(ops), [["create", out.item.id, "t1", { title: "baru", parent_cid: null, index: null }]]);
  assert.equal(typeof ops[0].ts, "number");
  assert.equal(ops[0].retries, 0);
});

test("create: tulis butir dan antrean dalam SATU transaksi readwrite [subtasks, _outbox, _meta]", async () => {
  await pohon();
  const db = await TFdb.openDB();
  const asli = db.transaction;
  const catat = [];
  db.transaction = function (stores, mode) { catat.push([[].concat(stores).join(","), mode || "readonly"]); return asli.apply(this, arguments); };
  try {
    await R.create("t1", { title: "x" });
  } finally { db.transaction = asli; }
  const tulis = catat.filter(([s, m]) => m === "readwrite" && /subtasks|_outbox|_meta/.test(s));
  assert.deepEqual(tulis, [["subtasks,_outbox,_meta", "readwrite"]]);
});

test("create: antrean gagal ditulis → butir juga tidak tersimpan (atomik)", async () => {
  await pohon();
  const proto = globalThis.IDBObjectStore.prototype;
  const asli = proto.add;
  proto.add = function () { if (this.name === "_outbox") throw new Error("disk penuh"); return asli.apply(this, arguments); };
  try {
    await assert.rejects(R.create("t1", { title: "x" }));
  } finally { proto.add = asli; }
  assert.equal((await allItems()).length, 3);
  assert.equal((await subtaskOps()).length, 0);
});

test("create: anak dari induk ber-id server (angka atau teks) dan dari induk cid; payload memakai parent_cid", async () => {
  await pohon();
  const a = await R.create("t1", { title: "x", parent_id: 11, index: 0 });
  assert.deepEqual([a.item.parent_id, a.item.depth, a.item.sort_order], [11, 1, 0]);
  const b = await R.create("t1", { title: "y", parent_id: "12" });
  assert.equal(b.item.parent_id, 12);
  const c = await R.create("t1", { title: "z", parent_id: "b" });
  assert.equal(c.item.parent_id, "b");
  const ops = await subtaskOps();
  assert.deepEqual(ops.map((o) => [o.payload.parent_cid, o.payload.index]), [["a", 0], ["a1", null], ["b", null]]);
  const byCid = new Map((await allItems()).map((x) => [x.cid, x]));
  assert.equal(byCid.get(a.item.id).parent_cid, "a");
  assert.equal(byCid.get("a1").sort_order, 1, "saudara dinomori ulang");
});

test("create: progress lokal ditulis ke task tanpa dirty/rev/base_rev/updated_at, dengan cap checklist_adopted_at", async () => {
  await pohon();
  const sebelum = Date.now();
  await R.setDone("a", true);
  const out = await R.create("t1", { title: "x" });
  assert.deepEqual(out.task_progress, { done: 1, total: 3, progress: 33 });
  const t = await getTask("t1");
  assert.deepEqual([t.progress, t.checklist_total, t.dirty, t.rev, t.base_rev, t.updated_at],
    [33, 3, 0, 3, "2026-11-01T00:00:00", "2026-11-01T00:00:00"]);
  assert.ok(t.checklist_adopted_at >= sebelum);
  assert.equal("rev" in out.task_progress, false);
});

test("create: tf:outbox-queued dipancarkan {entity: subtasks, cid}", async () => {
  await pohon();
  const ev = tangkapEvent();
  try {
    const out = await R.create("t1", { title: "x" });
    assert.deepEqual(ev.seen, [["tf:outbox-queued", { entity: "subtasks", cid: out.item.id }]]);
  } finally { ev.lepas(); }
});

test("create: client_id sama di task yang sama → butir lama tanpa entri baru; task lain → butir baru", async () => {
  await pohon();
  await putTask(task({ cid: "t2", server_id: 8 }));
  const a = await R.create("t1", { title: "x", client_id: "ui-1" });
  const b = await R.create("t1", { title: "x", client_id: "ui-1" });
  assert.equal(b.item.id, a.item.id);
  const c = await R.create("t2", { title: "x", client_id: "ui-1" });
  assert.notEqual(c.item.id, a.item.id);
  assert.equal((await subtaskOps()).length, 2);
  assert.equal((await allItems()).length, 5);
});

test("create: galat validasi (EMPTY_TITLE, PARENT_NOT_FOUND) dan task tidak dikenal/terhapus → tanpa tulis", async () => {
  await pohon();
  await putTask(task({ cid: "t9", server_id: 9, deleted: true }));
  await assert.rejects(R.create("t1", { title: "  " }), (e) => e.code === "EMPTY_TITLE");
  await assert.rejects(R.create("t1", { title: "x", parent_id: 999 }), (e) => e.code === "PARENT_NOT_FOUND");
  await assert.rejects(R.create("t1", { title: "x", parent_id: "zz" }), (e) => e.code === "PARENT_NOT_FOUND");
  await assert.rejects(R.create("t9", { title: "x" }), (e) => e.code === "TASK_NOT_FOUND");
  await assert.rejects(R.create("nihil", { title: "x" }), (e) => e.code === "TASK_NOT_FOUND");
  assert.equal((await allItems()).length, 3);
  assert.equal((await subtaskOps()).length, 0);
});

test("create: cid butir selalu baru dan berbeda lintas task", async () => {
  await pohon();
  await putTask(task({ cid: "t2", server_id: 8 }));
  const a = await R.create("t1", { title: "x" });
  const b = await R.create("t2", { title: "x" });
  assert.notEqual(a.item.id, b.item.id);
});

// ── centang ──────────────────────────────────────────────────────────────────

test("setDone: centang berantai lokal + antrean set_done {is_done, cascade_cids (lokal)}; tanpa perubahan → tanpa entri", async () => {
  await pohon();
  const out = await R.setDone(11, true);
  assert.deepEqual(out.changed_ids, [11, 12]);
  assert.deepEqual([out.item.id, out.item.is_done], [11, true]);
  assert.deepEqual(out.task_progress, { done: 1, total: 2, progress: 50 });
  const again = await R.setDone("a", true);
  assert.deepEqual(again.changed_ids, []);
  assert.deepEqual(qOf(await subtaskOps()), [["set_done", "a", "t1", { is_done: true, cascade_cids: ["a1"] }]]);
  const byCid = new Map((await allItems()).map((x) => [x.cid, x]));
  assert.deepEqual([byCid.get("a").is_done, byCid.get("a1").is_done, byCid.get("b").is_done], [true, true, false]);
});

test("toggle: dikirim sebagai set_done (bukan toggle) dengan nilai sesudah dibalik", async () => {
  await pohon();
  await R.toggle("b");
  const out = await R.toggle("b");
  assert.deepEqual([out.item.is_done, out.changed_ids], [false, ["b"]]);
  assert.deepEqual(qOf(await subtaskOps()), [
    ["set_done", "b", "t1", { is_done: true }], ["set_done", "b", "t1", { is_done: false }],
  ]);
});

test("setDone/toggle/patch/move/remove: butir tidak dikenal → NOT_FOUND", async () => {
  await pohon();
  for (const f of [() => R.setDone("zz", true), () => R.toggle(99), () => R.patch("zz", { title: "x" }),
    () => R.move("zz", null, 0), () => R.remove(99)]) {
    await assert.rejects(f(), (e) => e.code === "NOT_FOUND");
  }
});

// ── ubah teks / PATCH ────────────────────────────────────────────────────────

test("patch title: di-trim, antrean rename; sama → tanpa entri; kosong → EMPTY_TITLE", async () => {
  await pohon();
  const out = await R.patch(12, { title: "  baru  " });
  assert.deepEqual([out.item.id, out.item.title, out.changed_ids], [12, "baru", []]);
  await R.patch("a1", { title: "baru" });
  await assert.rejects(R.patch("a1", { title: " " }), (e) => e.code === "EMPTY_TITLE");
  assert.deepEqual(qOf(await subtaskOps()), [["rename", "a1", "t1", { title: "baru" }]]);
});

test("patch title + is_done: dua entri berurutan (rename lalu set_done) dalam satu transaksi; body kosong → NO_CHANGE", async () => {
  await pohon();
  const out = await R.patch("a", { title: "A", is_done: true });
  assert.deepEqual([out.item.title, out.item.is_done, out.changed_ids], ["A", true, [11, 12]]);
  assert.deepEqual(qOf(await subtaskOps()), [
    ["rename", "a", "t1", { title: "A" }], ["set_done", "a", "t1", { is_done: true, cascade_cids: ["a1"] }],
  ]);
  await assert.rejects(R.patch("a", {}), (e) => e.code === "NO_CHANGE");
  await assert.rejects(R.patch("a", { title: null, is_done: null }), (e) => e.code === "NO_CHANGE");
});

// ── pindah ───────────────────────────────────────────────────────────────────

test("move: applyMove lokal + antrean move {parent_cid, index}; posisi sama → tanpa entri", async () => {
  await pohon();
  const out = await R.move("b", 11, 0);
  assert.deepEqual(out.items.map((x) => [x.id, x.depth, x.parent_id, x.sort_order]),
    [[11, 0, null, 0], ["b", 1, 11, 0], [12, 1, 11, 1]]);
  assert.deepEqual(out.task_progress, { done: 0, total: 1, progress: 0 });
  await R.move("b", "11", 0);
  assert.deepEqual(qOf(await subtaskOps()), [["move", "b", "t1", { parent_cid: "a", index: 0 }]]);
  const byCid = new Map((await allItems()).map((x) => [x.cid, x]));
  assert.deepEqual([byCid.get("b").parent_cid, byCid.get("b").sort_order, byCid.get("a1").sort_order], ["a", 0, 1]);
});

test("move: index null = akhir; ke level atas; galat CYCLE / PARENT_NOT_FOUND tanpa tulis", async () => {
  await pohon();
  const out = await R.move(12, null, null);
  assert.deepEqual(out.items.map((x) => [x.id, x.depth]), [[11, 0], ["b", 0], [12, 0]]);
  await assert.rejects(R.move("a", 11, 0), (e) => e.code === "CYCLE");
  await assert.rejects(R.move("a", "b", 0).then(() => R.move("b", 11, 0)), (e) => e.code === "CYCLE"); // b → anak a (turunannya)
  await assert.rejects(R.move("b", 999, 0), (e) => e.code === "PARENT_NOT_FOUND");
  assert.deepEqual((await subtaskOps()).map((o) => [o.op, o.payload]),
    [["move", { parent_cid: null, index: null }], ["move", { parent_cid: "b", index: 0 }]]);
});

// ── hapus ────────────────────────────────────────────────────────────────────

test("remove butir tersinkron: hapus berantai lokal + SATU entri delete untuk akarnya", async () => {
  await pohon();
  const out = await R.remove(11);
  assert.deepEqual(out.deleted_ids, [11, 12]);
  assert.deepEqual(out.items.map((x) => x.id), ["b"]);
  assert.deepEqual(out.task_progress, { done: 0, total: 1, progress: 0 });
  assert.deepEqual((await allItems()).map((x) => x.cid), ["b"]);
  assert.deepEqual(qOf(await subtaskOps()), [["delete", "a", "t1", {}]]);
});

test("remove butir yang create-nya belum terkirim: create + entri turunannya dibuang, tanpa delete", async () => {
  await pohon();
  const p = await R.create("t1", { title: "p" });
  const c = await R.create("t1", { title: "c", parent_id: p.item.id });
  await R.patch(c.item.id, { title: "c2" });
  await R.setDone(p.item.id, true);
  const ev = tangkapEvent();
  let out;
  try { out = await R.remove(p.item.id); } finally { ev.lepas(); }
  assert.deepEqual(out.deleted_ids, [p.item.id, c.item.id]);
  assert.deepEqual(await subtaskOps(), []);
  assert.deepEqual((await allItems()).map((x) => x.cid).sort(), ["a", "a1", "b"]);
  assert.equal(ev.seen.length, 1, "antrean berubah → event");
  assert.equal((await R.getRevs()).t1, undefined, "tanpa entri lain sesudahnya → rev tidak dikosongkan");
});

test("remove create belum terkirim padahal entri lain sesudahnya masih antre → rev tersimpan dikosongkan (ambil ulang)", async () => {
  await pohon();
  await R.setRev("t1", 4);
  const x = await R.create("t1", { title: "x", index: 0 });
  await R.move(12, null, 1);
  await R.remove(x.item.id);
  assert.deepEqual(qOf(await subtaskOps()), [["move", "a1", "t1", { parent_cid: null, index: 1 }]]);
  assert.equal((await R.getRevs()).t1, null);
  assert.equal(R.knowsTask("t1"), true, "rev kosong tetap dikenal");
});

test("remove: butir tersinkron yang dipindah ke bawah butir belum terkirim → move dibuang, delete eksplisit untuknya", async () => {
  await pohon();
  const p = await R.create("t1", { title: "p" });
  await R.move(12, p.item.id, 0);
  const out = await R.remove(p.item.id);
  assert.deepEqual(out.deleted_ids, [p.item.id, 12]);
  assert.deepEqual(qOf(await subtaskOps()), [["delete", "a1", "t1", {}]]);
});

test("remove: anak belum terkirim di bawah induk tersinkron → create anak dibuang, satu delete untuk induk", async () => {
  await pohon();
  const c = await R.create("t1", { title: "c", parent_id: 12 });
  const out = await R.remove(11);
  assert.deepEqual(out.deleted_ids, [11, 12, c.item.id]);
  assert.deepEqual(qOf(await subtaskOps()), [["delete", "a", "t1", {}]]);
});

test("remove level atas terakhir: total 0 → progress task tetap nilai terakhir (K11)", async () => {
  await putTask(task({ progress: 100, checklist_total: 1 }));
  await putItems([rec("a", { server_id: 11, is_done: true })]);
  const out = await R.remove("a");
  assert.deepEqual(out.task_progress, { done: 0, total: 0, progress: 100 });
  const t = await getTask("t1");
  assert.deepEqual([t.progress, t.checklist_total], [100, 0]);
});

// ── kesiapan di memori ───────────────────────────────────────────────────────

test("kesiapan: sebelum start tidak siap; sesudah start tanpa checklists_hydrated tetap tidak siap", async () => {
  await pohon();
  assert.equal(R.isReady(), false);
  assert.equal(R.knowsTask(7), false);
  await R.start();
  assert.equal(R.isReady(), false);
  assert.equal(R.knowsItem(11), true, "memori tetap dimuat");
});

test("kesiapan: start memuat checklists_hydrated, rev tersimpan, butir lokal, dan id server task", async () => {
  await pohon();
  await putTask(task({ cid: "t2", server_id: 8 }));
  await putTask(task({ cid: "t3", server_id: 9 }));
  await metaPut("checklists_hydrated", true);
  await metaPut("checklist_revs", { t2: 0 });
  await R.start();
  assert.equal(R.isReady(), true);
  assert.equal(R.knowsTask(7), true, "punya butir lokal");
  assert.equal(R.knowsTask("7"), true);
  assert.equal(R.knowsTask("t1"), true);
  assert.equal(R.knowsTask(8), true, "rev tersimpan 0 tanpa butir");
  assert.equal(R.knowsTask(9), false, "task dikenal tanpa rev dan tanpa butir");
  assert.equal(R.knowsTask(99), false);
  assert.equal(R.knowsItem(11), true);
  assert.equal(R.knowsItem("12"), true);
  assert.equal(R.knowsItem("b"), true);
  assert.equal(R.knowsItem(99), false);
});

test("kesiapan: diperbarui oleh aksi lokal (butir baru/terhapus) tanpa memuat ulang", async () => {
  await pohon();
  await metaPut("checklists_hydrated", true);
  await R.start();
  await putTask(task({ cid: "t2", server_id: null }));
  const out = await R.create("t2", { title: "x" });
  assert.equal(R.knowsItem(out.item.id), true);
  assert.equal(R.knowsTask("t2"), true);
  await R.remove(11);
  assert.equal(R.knowsItem(11), false);
  assert.equal(R.knowsItem(12), false);
});

test("kesiapan: aksi yang selesai saat memori sedang dimuat tidak hilang", async () => {
  await pohon();
  await metaPut("checklists_hydrated", true);
  const muat = R.start();
  const out = await R.create("t1", { title: "x" });
  await muat;
  assert.equal(R.knowsItem(out.item.id), true);
});

test("kesiapan: ganti sesi (window.__userEpoch naik, data lokal dikosongkan) → memori kosong dan tidak siap", async () => {
  await pohon();
  await metaPut("checklists_hydrated", true);
  await R.start();
  assert.equal(R.isReady(), true);
  globalThis.__userEpoch = 1;
  assert.equal(R.isReady(), false);
  assert.equal(R.knowsTask(7), false);
  assert.equal(R.knowsItem(11), false);
  await R.markHydrated();
  assert.equal(R.isReady(), true);
});

test("reset/refresh: reset mengosongkan memori; refresh memuat ulang dari IndexedDB", async () => {
  await pohon();
  await metaPut("checklists_hydrated", true);
  await R.start();
  R.reset();
  assert.equal(R.isReady(), false);
  await R.refresh();
  assert.equal(R.isReady(), true);
  assert.equal(R.knowsItem(12), true);
});

// ── rev tersimpan dan unduhan awal ───────────────────────────────────────────

test("setRev/getRevs/clearRev: _meta checklist_revs {task_cid: rev}; kosong = null (tetap dikenal)", async () => {
  await putTask(task());
  await R.start();
  await R.setRev("t1", 3);
  await R.setRev("t2", 0);
  assert.deepEqual(await metaGet("checklist_revs"), { t1: 3, t2: 0 });
  await R.clearRev("t1");
  assert.deepEqual(await R.getRevs(), { t1: null, t2: 0 });
  assert.equal(R.knowsTask(7), true);
  await R.setRev("t1", "x");
  assert.deepEqual(await R.getRevs(), { t1: null, t2: 0 });
});

test("markHydrated: _meta checklists_hydrated = true dan siap; bertahan setelah muat ulang", async () => {
  await R.start();
  assert.equal(R.isReady(), false);
  await R.markHydrated();
  assert.equal(R.isReady(), true);
  assert.equal(await metaGet("checklists_hydrated"), true);
  R._reset();
  await R.start();
  assert.equal(R.isReady(), true);
});

// ── ganti isi dari server ────────────────────────────────────────────────────

function srv(id, over) {
  return Object.assign({ id, task_id: 7, parent_id: null, depth: 0, title: "s" + id, is_done: false, sort_order: 0 }, over || {});
}

test("replaceTaskChecklist: cid butir dikenal dipertahankan (_idmap subtask), butir baru cid baru, yang hilang dihapus, rev ditulis", async () => {
  await pohon();
  await R.start();
  const ok = await R.replaceTaskChecklist("t1", [
    srv(11, { title: "A", is_done: true, sort_order: 0 }),
    srv(13, { parent_id: 11, depth: 1, sort_order: 0 }),
    srv(14, { parent_id: 13, depth: 2, sort_order: 0 }),
  ], 5);
  assert.equal(ok, true);
  const all = await allItems();
  const bySid = new Map(all.map((x) => [x.server_id, x]));
  assert.deepEqual(all.length, 3);
  assert.equal(bySid.get(11).cid, "a");
  assert.deepEqual([bySid.get(11).title, bySid.get(11).is_done], ["A", true]);
  assert.equal(bySid.get(12), undefined, "hilang dari server → dihapus");
  assert.equal(all.some((x) => x.cid === "b"), false, "butir lokal tanpa id server dan tanpa antrean → dihapus");
  assert.equal(bySid.get(13).parent_cid, "a");
  assert.equal(bySid.get(14).parent_cid, bySid.get(13).cid);
  assert.equal(await cidOf("subtask", 13), bySid.get(13).cid);
  assert.equal(await cidOf("subtask", 12), undefined);
  assert.equal((await R.getRevs()).t1, 5);
  assert.deepEqual((await R.itemsForTask("t1")).map((x) => [x.id, x.depth, x.parent_id]), [[11, 0, null], [13, 1, 11], [14, 2, 13]]);
  assert.equal(R.knowsItem(14), true);
  assert.equal(R.knowsItem(12), false);
  assert.equal(R.knowsItem("b"), false);
});

test("replaceTaskChecklist: cid dipertahankan lewat record bila _idmap belum ada; ganti ulang idempoten", async () => {
  await putTask(task());
  await putItems([rec("a", { server_id: 11 })]);
  await R.replaceTaskChecklist("t1", [srv(11)], 2);
  await R.replaceTaskChecklist("t1", [srv(11)], 2);
  const all = await allItems();
  assert.deepEqual(all.map((x) => [x.cid, x.server_id]), [["a", 11]]);
  assert.equal(await cidOf("subtask", 11), "a");
});

test("replaceTaskChecklist: task masih punya antrean subtasks → dilewati (false), isi dan rev tidak berubah", async () => {
  await pohon();
  await R.setRev("t1", 2);
  await R.toggle("b");
  const ok = await R.replaceTaskChecklist("t1", [srv(11)], 9);
  assert.equal(ok, false);
  assert.equal((await allItems()).length, 3);
  assert.equal((await R.getRevs()).t1, 2);
});

test("replaceTaskChecklist: antrean task lain tidak menghalangi; checklist kosong menghapus semua butir", async () => {
  await pohon();
  await putTask(task({ cid: "t2", server_id: 8 }));
  await putItems([rec("z", { task_cid: "t2" })]);
  await R.toggle("z");
  assert.equal(await R.replaceTaskChecklist("t1", [], 6), true);
  assert.deepEqual((await allItems()).map((x) => x.cid), ["z"]);
  assert.equal((await R.getRevs()).t1, 6);
});

// ── buang task ───────────────────────────────────────────────────────────────

test("purgeTask: butir, entri antrean subtasks task itu, rev tersimpan, dan _idmap butirnya dibuang; task lain utuh", async () => {
  await pohon();
  await putTask(task({ cid: "t2", server_id: 8 }));
  await putItems([rec("z", { task_cid: "t2", server_id: 30 })]);
  await R.setRev("t1", 3);
  await R.setRev("t2", 1);
  await R.toggle("b");
  await R.toggle("z");
  await outboxAdd({ op: "update", entity_type: "task", cid: "t1", payload: {} });
  await R.start();
  await R.purgeTask("t1");
  assert.deepEqual((await allItems()).map((x) => x.cid), ["z"]);
  const ops = await outboxAll();
  assert.deepEqual(ops.map((o) => [o.entity_type, o.cid]), [["subtasks", "z"], ["task", "t1"]]);
  assert.deepEqual(await R.getRevs(), { t2: 1 });
  assert.equal(await cidOf("subtask", 11), undefined);
  assert.equal(R.knowsTask(7), false);
  assert.equal(R.knowsItem(11), false);
  assert.equal(R.knowsTask(8), true);
});

// ── id server dari push ──────────────────────────────────────────────────────

test("adoptServerId: record mendapat server_id + _idmap subtask; dikenal lewat id server", async () => {
  await pohon();
  await R.start();
  assert.equal(await R.adoptServerId("b", 15), true);
  const b = (await allItems()).find((x) => x.cid === "b");
  assert.equal(b.server_id, 15);
  assert.equal(await cidOf("subtask", 15), "b");
  assert.equal(R.knowsItem(15), true);
  assert.equal((await R.itemsForTask("t1")).find((x) => x.title === "b").id, 15);
  assert.equal(await R.adoptServerId("tidak-ada", 16), false);
});

test("pendingTaskCids: task yang masih punya entri antrean subtasks", async () => {
  await pohon();
  await putTask(task({ cid: "t2", server_id: 8 }));
  await putItems([rec("z", { task_cid: "t2" })]);
  await outboxAdd({ op: "update", entity_type: "task", cid: "t2", payload: {} });
  assert.deepEqual([...(await R.pendingTaskCids())], []);
  await R.toggle("b");
  assert.deepEqual([...(await R.pendingTaskCids())], ["t1"]);
});

test("recordsForTask: record mentah butir task itu", async () => {
  await pohon();
  assert.deepEqual((await R.recordsForTask("t1")).map((x) => x.cid).sort(), ["a", "a1", "b"]);
  assert.deepEqual(await R.recordsForTask("t2"), []);
});

// ── id server task untuk routing (rencana PR B2 R3) ──────────────────────────

test("noteTaskServerId: task yang tersinkron sesudah memori dimuat langsung dikenal lewat id server", async () => {
  await putTask(task({ server_id: null }));
  await putItems([rec("a")]);
  await R.start();
  assert.equal(R.knowsTask("t1"), true);
  assert.equal(R.knowsTask(70), false);
  R.noteTaskServerId("t1", 70);
  assert.equal(R.knowsTask(70), true);
  assert.equal(R.knowsTask("70"), true);
});

test("setRev mencatat id server task (task yang diketahui pull sesudah memori dimuat)", async () => {
  await R.start();
  await putTask(task({ cid: "t5", server_id: 55 }));
  assert.equal(R.knowsTask(55), false);
  await R.setRev("t5", 0);
  assert.equal(R.knowsTask(55), true);
});


// ── perbaikan review: antrean tanpa induk yatim (W1) ─────────────────────────
// Hapus butir yang create-nya belum terkirim (U) membuang entri U; entri create/move butir LAIN yang masih
// menunjuk U sebagai induk ditulis ulang menjadi {parent_cid: null, index: null}. Aman: butir itu tidak ikut terhapus,
// jadi sesudah entri itu ia pasti punya `move` sendiri ke induk akhirnya (lihat komentar di checklistrepo.remove).

const tanpaYatim = async () => {
  const cids = new Set((await allItems()).map((x) => x.cid));
  for (const o of await subtaskOps()) {
    const pc = o.payload && o.payload.parent_cid;
    assert.ok(pc == null || cids.has(pc), "entri " + o.op + " menunjuk induk yang tidak ada: " + pc);
    assert.ok(o.op === "delete" || cids.has(o.cid), "entri " + o.op + " untuk butir yang tidak ada: " + o.cid);
  }
};

test("W1 S1: anak dibuat di bawah U, dikeluarkan (Shift+Tab), U dihapus → create anak ditulis ulang ke level atas", async () => {
  await putTask(task());
  await putItems([rec("a", { server_id: 1 })]);
  await R.setRev("t1", 1);
  const u = await R.create("t1", { title: "U" });
  const c = await R.create("t1", { title: "C", parent_id: u.item.id });
  await R.move(c.item.id, null, 1);
  await R.remove(u.item.id);
  assert.deepEqual(qOf(await subtaskOps()), [
    ["create", c.item.id, "t1", { title: "C", parent_cid: null, index: null }],
    ["move", c.item.id, "t1", { parent_cid: null, index: 1 }],
  ]);
  await tanpaYatim();
  assert.equal((await R.getRevs()).t1, null, "entri lain sesudah create U → ambil ulang");
});

test("W1 S2: butir tersinkron masuk ke U lalu keluar, U dihapus → move ke U ditulis ulang", async () => {
  await putTask(task());
  await putItems([rec("a", { server_id: 1 })]);
  const u = await R.create("t1", { title: "U" });
  await R.move("a", u.item.id, null);
  await R.move("a", null, 0);
  await R.remove(u.item.id);
  assert.deepEqual(qOf(await subtaskOps()), [
    ["move", "a", "t1", { parent_cid: null, index: null }],
    ["move", "a", "t1", { parent_cid: null, index: 0 }],
  ]);
  await tanpaYatim();
});

test("W1 S3: butir belum terkirim masuk ke U lalu keluar, U dihapus → move ke U ditulis ulang, create-nya utuh", async () => {
  await putTask(task());
  await putItems([rec("a", { server_id: 1 })]);
  const u = await R.create("t1", { title: "U" });
  const d = await R.create("t1", { title: "D" });
  await R.move(d.item.id, u.item.id, null);
  await R.move(d.item.id, null, 2);
  await R.remove(u.item.id);
  assert.deepEqual(qOf(await subtaskOps()), [
    ["create", d.item.id, "t1", { title: "D", parent_cid: null, index: null }],
    ["move", d.item.id, "t1", { parent_cid: null, index: null }],
    ["move", d.item.id, "t1", { parent_cid: null, index: 2 }],
  ]);
  await tanpaYatim();
});

test("W1: cucu U yang dikeluarkan bersama induknya — hanya entri yang menunjuk U langsung yang ditulis ulang", async () => {
  await putTask(task());
  const u = await R.create("t1", { title: "U" });
  const w = await R.create("t1", { title: "W", parent_id: u.item.id });
  const y = await R.create("t1", { title: "Y", parent_id: w.item.id });
  await R.move(w.item.id, null, 0);
  await R.remove(u.item.id);
  assert.deepEqual(qOf(await subtaskOps()), [
    ["create", w.item.id, "t1", { title: "W", parent_cid: null, index: null }],
    ["create", y.item.id, "t1", { title: "Y", parent_cid: w.item.id, index: null }],
    ["move", w.item.id, "t1", { parent_cid: null, index: 0 }],
  ]);
  await tanpaYatim();
  assert.deepEqual((await R.itemsForTask("t1")).map((x) => [x.id, x.depth]), [[w.item.id, 0], [y.item.id, 1]]);
});

// ── perbaikan review: rev dikosongkan atomik (S1) ────────────────────────────

test("S1: rev tersimpan dikosongkan di transaksi aksi yang sama — galat sesudah commit tidak meninggalkan rev lama", async () => {
  await putTask(task());
  await putItems([rec("a", { server_id: 1 })]);
  await R.setRev("t1", 4);
  const x = await R.create("t1", { title: "x", index: 0 });
  await R.move("a", null, 0);
  const C = require("../../static/offline/checklist.js");
  const asli = C.writeTaskProgress;
  C.writeTaskProgress = () => Promise.reject(new Error("tab ditutup"));
  try {
    await assert.rejects(R.remove(x.item.id));
  } finally { C.writeTaskProgress = asli; }
  assert.equal((await R.getRevs()).t1, null);
  assert.deepEqual(qOf(await subtaskOps()), [["move", "a", "t1", { parent_cid: null, index: 0 }]]);
});

test("S1: menulis rev kosong gagal → seluruh aksi batal (butir, antrean, dan rev tetap seperti semula)", async () => {
  await putTask(task());
  await putItems([rec("a", { server_id: 1 })]);
  await R.setRev("t1", 4);
  const x = await R.create("t1", { title: "x", index: 0 });
  await R.move("a", null, 0);
  const sebelum = qOf(await subtaskOps());
  const proto = globalThis.IDBObjectStore.prototype;
  const asli = proto.put;
  proto.put = function () { if (this.name === "_meta") throw new Error("kuota penuh"); return asli.apply(this, arguments); };
  try {
    await assert.rejects(R.remove(x.item.id));
  } finally { proto.put = asli; }
  assert.equal((await R.getRevs()).t1, 4);
  assert.deepEqual(qOf(await subtaskOps()), sebelum);
  assert.ok((await allItems()).some((r) => r.cid === x.item.id), "butir tidak terhapus");
});

test("S1: hapus yang mengosongkan rev tidak membuka transaksi _meta terpisah", async () => {
  await putTask(task());
  await putItems([rec("a", { server_id: 1 })]);
  await R.setRev("t1", 4);
  const x = await R.create("t1", { title: "x", index: 0 });
  await R.move("a", null, 0);
  const db = await TFdb.openDB();
  const asli = db.transaction;
  const catat = [];
  db.transaction = function (stores, mode) { catat.push([[].concat(stores).join(","), mode || "readonly"]); return asli.apply(this, arguments); };
  try { await R.remove(x.item.id); } finally { db.transaction = asli; }
  assert.deepEqual(catat.filter(([st, m]) => m === "readwrite" && /subtasks|_outbox|_meta/.test(st)),
    [["subtasks,_outbox,_meta", "readwrite"]]);
  assert.equal((await R.getRevs()).t1, null);
  assert.equal(R.knowsTask("t1"), true);
});

// ── perbaikan review: kesiapan (S2) ──────────────────────────────────────────

test("S2: start() idempoten — sudah dimuat → langsung selesai tanpa memuat ulang; refresh() memuat ulang", async () => {
  await pohon();
  await metaPut("checklists_hydrated", true);
  await R.start();
  await putItems([rec("baru", { server_id: 90 })]); // ditulis tab lain
  await R.start();
  assert.equal(R.knowsItem(90), false, "start kedua tidak memuat ulang");
  await R.refresh();
  assert.equal(R.knowsItem(90), true);
});

test("S2: markHydrated idempoten", async () => {
  await R.start();
  await R.markHydrated();
  await R.markHydrated();
  assert.equal(R.isReady(), true);
  assert.equal(await metaGet("checklists_hydrated"), true);
});

test("W1 kaskade: centang U (berantai ke anak C), C dikeluarkan, U dihapus → centang C tidak hilang di server", async () => {
  await putTask(task());
  const u = await R.create("t1", { title: "U" });
  const c = await R.create("t1", { title: "C", parent_id: u.item.id });
  const z = await R.create("t1", { title: "Z", parent_id: c.item.id });
  await R.setDone(u.item.id, true);               // U, C, Z selesai
  await R.setDone(z.item.id, false);              // Z dibuka lagi (hanya Z)
  await R.move(c.item.id, null, null);            // C (beserta Z) keluar dari U
  await R.remove(u.item.id);
  const items = await R.itemsForTask("t1");
  assert.deepEqual(items.map((x) => [x.title, x.is_done]), [["C", true], ["Z", false]]);
  // set_done U dibuang (U tidak pernah ada di server); efek berantainya ke C diganti entri set_done C, dan Z yang
  // terbuka ditegaskan sesudahnya (set_done true berantai di server).
  assert.deepEqual((await subtaskOps()).map((o) => [o.op, o.cid, o.payload]), [
    ["create", c.item.id, { title: "C", parent_cid: null, index: null }],
    ["create", z.item.id, { title: "Z", parent_cid: c.item.id, index: null }],
    ["set_done", z.item.id, { is_done: false }],
    ["move", c.item.id, { parent_cid: null, index: null }],
    ["set_done", c.item.id, { is_done: true }],
    ["set_done", z.item.id, { is_done: false }],
  ]);
  await tanpaYatim();
});

// setRevs (rencana PR B2 R5, pullChecklists): aturan rev 0 untuk banyak task sekaligus — satu transaksi _meta (bukan
// satu transaksi + salinan objek checklist_revs per task), `onlyIfAbsent` tidak menimpa kunci yang ada (null = ambil ulang).
test("setRevs: banyak rev dalam satu transaksi _meta; onlyIfAbsent tidak menimpa kunci yang ada (termasuk null); id server task dicatat", async () => {
  await putTask(task());
  await putTask(task({ cid: "t2", server_id: 8 }));
  await metaPut("checklist_revs", { t1: null });
  await R.start();
  const asli = TFdb.openDB;
  let tulis = 0;
  TFdb.openDB = () => asli().then((db) => new Proxy(db, { get(o, k) {
    if (k === "transaction") return (s, m) => { if (m === "readwrite") tulis++; return o.transaction(s, m); };
    const v = o[k]; return typeof v === "function" ? v.bind(o) : v;
  } }));
  let n;
  try { n = await R.setRevs([["t1", 0], ["t2", 0], ["t3", 0]], { onlyIfAbsent: true }); } finally { TFdb.openDB = asli; }
  assert.equal(n, 2);
  assert.equal(tulis, 1, "satu transaksi readwrite");
  assert.deepEqual(await R.getRevs(), { t1: null, t2: 0, t3: 0 });
  assert.equal(R.knowsTask(8), true);
  assert.equal(R.knowsTask("t3"), true);
  assert.equal(await R.setRevs([["t1", 4]]), 1);
  assert.equal((await R.getRevs()).t1, 4);
  assert.equal(await R.setRevs([]), 0);
});

// Id stabil (perbaikan uji coba PR B2 Task 6): butir yang DIBUAT di perangkat ini tetap memakai cid sebagai id API walau
// push sudah mengadopsi id servernya — ChecklistTree yang sedang terbuka memegang cid itu (tanpa ini respons centang/pindah
// sesudah sinkron memakai id server dan tampilan tidak cocok lagi). Butir dari server tetap memakai id server; urutan
// pohon tetap dihitung dengan id server (tie-break sama dengan server).
test("id stabil: butir buatan perangkat ini tetap ber-id cid sesudah adoptServerId; butir server ber-id server", async () => {
  await pohon();
  const r = await R.create("t1", { title: "Baru", parent_id: 11 });
  const cid = r.item.id;
  assert.equal(typeof cid, "string");
  await R.adoptServerId(cid, 40);
  const items = await R.itemsForTask("t1");
  assert.deepEqual(items.map((i) => [i.id, i.parent_id]), [[11, null], [12, 11], [cid, 11], ["b", null]]);
  // aksi lewat cid: respons memakai cid (item, changed_ids, items, deleted_ids)
  const t = await R.toggle(cid);
  assert.equal(t.item.id, cid);
  assert.deepEqual(t.changed_ids, [cid]);
  const mv = await R.move(cid, null, 0);
  assert.equal(mv.items[0].id, cid);
  // aksi lewat id server butir yang sama juga dijawab dengan cid (id API butir itu di perangkat ini)
  const p = await R.patch(40, { title: "Baru 2" });
  assert.equal(p.item.id, cid);
  const del = await R.remove(cid);
  assert.deepEqual(del.deleted_ids, [cid]);
});

test("id stabil: body parent_id berupa cid butir yang sudah ber-id server dipetakan (tanpa PARENT_NOT_FOUND)", async () => {
  await pohon();
  // a1 (server 12) dikenal tampilan lewat cid-nya "a1" bila dibuat di perangkat ini → body memakai "a1"
  const c = await R.create("t1", { title: "Anak", parent_id: "a1" });
  assert.equal(c.item.parent_id, 12, "a1 berasal dari server → id server");
  const mv = await R.move("b", "a", 0);
  assert.deepEqual(mv.items.map((i) => [i.id, i.parent_id]).slice(0, 2), [[11, null], ["b", 11]]);
  const own = await R.create("t1", { title: "Milik" });
  await R.adoptServerId(own.item.id, 41);
  const sub = await R.create("t1", { title: "Sub milik", parent_id: own.item.id });
  assert.equal(sub.item.parent_id, own.item.id, "induk buatan perangkat ini → cid");
});

test("id stabil: replaceTaskChecklist mempertahankan asal butir (cid tetap id API sesudah unduh ulang)", async () => {
  await pohon();
  const r = await R.create("t1", { title: "Baru" });
  const cid = r.item.id;
  await R.adoptServerId(cid, 40);
  await tx("_outbox", "readwrite", (t) => { t.objectStore("_outbox").clear(); });
  await R.replaceTaskChecklist("t1", [
    { id: 11, parent_id: null, title: "a", is_done: false, sort_order: 0 },
    { id: 40, parent_id: null, title: "Baru", is_done: true, sort_order: 1 },
  ], 9);
  assert.deepEqual((await R.itemsForTask("t1")).map((i) => [i.id, i.is_done]), [[11, false], [cid, true]]);
});
