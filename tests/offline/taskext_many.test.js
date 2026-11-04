"use strict";
// Jalur tulis ext massal lokal (spec plugin Fase 1 1c; rencana 1c-1 R22, Review Focus 3): taskrepo.applyTaskPatch,
// taskrepo.updateTaskExtMany (satu transaksi readwrite tasks + _outbox) dan router.extPatchMany (satu getAll + satu
// baca pomolog). Inti tes: tulis massal HARUS menghasilkan record dan op outbox yang identik dengan updateTask per
// item (penanda ext_only_rev, ext_dirty, rev, dirty, updated_at, quadrant) — selisih apa pun membuka lagi bug edit
// inti offline yang hilang (rantai 1c-0/1c-0b).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const TFdb = require("../../static/offline/db.js");
const { DB_NAME, _reset, openDB } = TFdb;
const repo = require("../../static/offline/taskrepo.js");
const X = require("../../static/offline/taskext.js");
const pomolog = require("../../static/offline/pomolog.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

const N = 500;
const NOW = "2026-11-01T08:00:00.000Z";
const OPTS = { now: NOW, today: "2026-11-01" };
const pad = (i) => String(i).padStart(3, "0");
const cidOf = (i) => "cid-" + pad(i);

// Tiga kelas record: 0 = bersih, 1 = kotor inti (tanpa penanda), 2 = sudah tertunda ext saja (penanda = rev).
function kindOf(i) { return i % 3; }
function makeRec(i) {
  const kind = kindOf(i);
  const rec = {
    cid: cidOf(i),
    server_id: i % 2 === 0 ? 1000 + i : null,
    title: "Task " + i, description: "", gtd_status: "next",
    priority: ["P1", "P2", "P3", "P4"][i % 4],
    quadrant: "Q-basi", // dihitung ulang oleh setiap tulis lokal
    project: "", project_id: null, project_ref_name: null, context: "", context_id: null, context_ref_name: null,
    deadline: i % 5 === 0 ? "2026-11-03" : (i % 5 === 1 ? "2026-12-20" : null),
    waiting_for: "", list_cid: null, list_id: null, assigned_to: null,
    parent_cid: i % 11 === 0 && i > 0 ? cidOf(i - 1) : null,
    progress: 0, estimated_pomodoros: 1, pomodoros_done: i % 4, is_focused: 0, completed_at: null,
    recurrence_type: null, recurrence_days: null, recurrence_end_date: null, recurrence_notif_level: null,
    created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-02T00:00:00.000Z",
    deleted: false, base_rev: null,
    ext: { "demo-ext.a": i, "lain-plug.z": "tetap" },
  };
  if (i % 7 === 0) rec.client_id = "client-" + pad(i);
  if (kind === 0) { rec.dirty = 0; rec.rev = 2; }
  if (kind === 1) { rec.dirty = 1; rec.rev = 3; rec.ext_dirty = ["demo-ext.a"]; }
  if (kind === 2) { rec.dirty = 1; rec.rev = 4; rec.ext_dirty = ["demo-ext.b"]; rec[X.EXT_ONLY_KEY] = 4; }
  return rec;
}

// Isi store langsung (tes): 500 record dalam satu transaksi.
async function seed(mut) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("tasks", "readwrite");
    const os = tx.objectStore("tasks");
    for (let i = 0; i < N; i++) {
      const r = makeRec(i);
      if (mut) mut(r, i);
      os.put(r);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function all(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction(store, "readonly").objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}
const byCid = (rows) => { const m = {}; for (const r of rows) m[r.cid] = r; return m; };
// op outbox tanpa ts/qid (nilai jam dan kunci autoIncrement), urut qid
const opsShape = (ops) => ops.slice().sort((a, b) => a.qid - b.qid).map((o) => {
  const c = Object.assign({}, o);
  assert.equal(typeof c.ts, "number");
  assert.equal(typeof c.qid, "number");
  delete c.ts; delete c.qid;
  return c;
});
async function freshDB() { _reset(); await deleteDB(DB_NAME); }

// Patch beragam: set, hapus (null), kunci baru, beberapa kunci sekaligus.
function patchFor(i) {
  if (i % 4 === 0) return { "demo-ext.a": "baru-" + i };
  if (i % 4 === 1) return { "demo-ext.a": null };
  if (i % 4 === 2) return { "demo-ext.c": { start: "2026-11-0" + (1 + (i % 9)), deps: [{ $task: 1000 + i }] } };
  return { "demo-ext.a": [i, i + 1], "demo-ext.d": true };
}

test("kesetaraan: untuk 20 task (bersih, kotor inti, sudah ext saja), updateTask(cid, {ext_patch}) dan updateTaskExtMany([{cid, ext_patch}]) dengan now/today sama menghasilkan record identik (ext, ext_dirty, rev, dirty, updated_at, quadrant, ext_only_rev) dan op outbox berbentuk sama", async () => {
  const idx = [0, 1, 2, 3, 4, 5, 10, 11, 22, 33, 44, 45, 46, 47, 100, 101, 102, 250, 498, 499];
  assert.equal(idx.length, 20);
  for (const k of [0, 1, 2]) assert.ok(idx.filter((i) => kindOf(i) === k).length >= 5, "setiap kelas terwakili");
  const items = idx.map((i) => ({ cid: cidOf(i), ext_patch: patchFor(i) }));

  // jalur tunggal
  await seed();
  const singleOut = [];
  for (const it of items) singleOut.push(await repo.updateTask(it.cid, { ext_patch: it.ext_patch }, OPTS));
  const singleTasks = byCid(await all("tasks"));
  const singleOps = opsShape(await all("_outbox"));

  // jalur massal atas data awal yang sama
  await freshDB();
  await seed();
  const res = await repo.updateTaskExtMany(items, OPTS);
  const manyTasks = byCid(await all("tasks"));
  const manyOps = opsShape(await all("_outbox"));

  assert.equal(res.error, null);
  assert.deepEqual(res.applied, items.map((it) => it.cid));
  assert.equal(Object.keys(manyTasks).length, N);
  assert.deepEqual(manyTasks, singleTasks, "semua 500 record identik");
  assert.deepEqual(manyOps, singleOps, "op outbox berbentuk sama, urutan sama");
  assert.deepEqual(res.recs, singleOut, "nilai balik sama dengan updateTask (displayFrom + parent_title)");

  // asersi field eksplisit per kelas (bukan hanya bentuk)
  for (const i of idx) {
    const before = makeRec(i);
    const got = manyTasks[cidOf(i)];
    assert.deepEqual(got.ext, X.applyPatch(before.ext, patchFor(i)));
    const dirtyKeys = (before.ext_dirty || []).slice();
    for (const k of Object.keys(patchFor(i))) if (dirtyKeys.indexOf(k) < 0) dirtyKeys.push(k);
    assert.deepEqual(got.ext_dirty, dirtyKeys);
    assert.equal(got.rev, before.rev + 1);
    assert.equal(got.dirty, 1);
    assert.equal(got.updated_at, NOW);
    assert.notEqual(got.quadrant, "Q-basi");
    assert.equal(got.title, before.title, "field inti tidak tersentuh");
    const marked = Object.prototype.hasOwnProperty.call(got, X.EXT_ONLY_KEY);
    if (kindOf(i) === 1) assert.equal(marked, false, "kotor inti: penanda tidak muncul (" + i + ")");
    else assert.equal(got[X.EXT_ONLY_KEY], got.rev, "bersih/ext saja: penanda = rev baru (" + i + ")");
    assert.equal(X.extOnlyNow(got), kindOf(i) !== 1);
  }
  const op0 = manyOps[0];
  assert.deepEqual(Object.keys(op0).sort(), ["cid", "entity_type", "op", "payload", "retries"]);
  assert.equal(op0.op, "update");
  assert.equal(op0.entity_type, "task");
  assert.equal(op0.retries, 0);
  assert.deepEqual(op0.payload, manyTasks[cidOf(0)]);
});

test("kesetaraan: cid sama dua kali dalam satu batch → setara dengan dua updateTask berurutan (item kedua melihat hasil item pertama)", async () => {
  const items = [
    { cid: cidOf(1), ext_patch: { "demo-ext.a": "satu" } },
    { cid: cidOf(2), ext_patch: { "demo-ext.b": 2 } },
    { cid: cidOf(1), ext_patch: { "demo-ext.b": "dua", "demo-ext.a": null } },
  ];
  await seed();
  for (const it of items) await repo.updateTask(it.cid, { ext_patch: it.ext_patch }, OPTS);
  const single = byCid(await all("tasks"));
  const singleOps = opsShape(await all("_outbox"));
  await freshDB();
  await seed();
  const res = await repo.updateTaskExtMany(items, OPTS);
  assert.deepEqual(byCid(await all("tasks")), single);
  assert.deepEqual(opsShape(await all("_outbox")), singleOps);
  assert.deepEqual(res.applied, [cidOf(1), cidOf(2), cidOf(1)]);
  assert.equal(single[cidOf(1)].rev, 3 + 2);
});

test("applyTaskPatch: murni (base tidak berubah) dan sama dengan isi updateTask untuk patch ext saja", () => {
  const base = makeRec(2);
  const frozen = JSON.parse(JSON.stringify(base));
  const ctx = { now: NOW, today: OPTS.today, cleanTitle: null, projectItems: [], contextItems: [], pc: null, cc: null, needLookup: false, needCtxLookup: false };
  const next = repo.applyTaskPatch(base, { ext_patch: { "demo-ext.a": 9 } }, ctx);
  assert.deepEqual(base, frozen, "base tidak dimutasi");
  assert.notEqual(next, base);
  assert.equal(next.rev, 5);
  assert.equal(next[X.EXT_ONLY_KEY], 5);
  assert.equal(next.ext["demo-ext.a"], 9);
  assert.throws(() => repo.applyTaskPatch(base, { ext_patch: { "demo-ext.big": "x".repeat(5000) } }, ctx),
    (e) => e.status === 422 && e.code === "EXT_TOO_LARGE" && e.key === "demo-ext");
});

// Spy jumlah transaksi pada instance DB bersama (openDB() selalu mengembalikan koneksi yang sama).
async function spyTx() {
  const db = await openDB();
  const orig = db.transaction;
  const log = [];
  db.transaction = function (stores, mode) { log.push([stores, mode || "readonly"]); return orig.apply(this, arguments); };
  return { log, restore: () => { db.transaction = orig; } };
}

test("satu transaksi readwrite: 200 item → db.transaction dipanggil ≤ 3 kali (getAll id, readwrite tasks+_outbox, pomolog) — spy pada openDB().transaction", async () => {
  await seed();
  const router = buildTaskRouter();
  const items = Array.from({ length: 200 }, (_, k) => ({ id: k % 2 === 0 ? 1000 + k : cidOf(k), ext_patch: { "demo-ext.a": "m" + k } }));
  const spy = await spyTx();
  let res;
  try { res = await router.extPatchMany(items); } finally { spy.restore(); }
  assert.equal(res.error, null);
  assert.equal(res.rows.length, 200);
  assert.ok(spy.log.length <= 3, "transaksi: " + JSON.stringify(spy.log));
  const rw = spy.log.filter((t) => t[1] === "readwrite");
  assert.deepEqual(rw, [[["tasks", "_outbox"], "readwrite"]], "tepat satu transaksi readwrite atas tasks + _outbox");
  assert.equal((await all("_outbox")).length, 200);
});

test("waktu 200 item dicatat (console.log), jalur lama dicatat sebagai pembanding", async () => {
  const items = Array.from({ length: 200 }, (_, k) => ({ id: cidOf(k), ext_patch: { "demo-ext.a": "w" + k } }));
  await seed();
  let router = buildTaskRouter();
  const spyOld = await spyTx();
  const t0 = process.hrtime.bigint();
  try {
    for (const it of items) await router.dispatch("PUT", "/api/tasks/" + encodeURIComponent(it.id), { ext_patch: it.ext_patch });
  } finally { spyOld.restore(); }
  const oldMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const oldTasks = byCid(await all("tasks"));

  await freshDB();
  await seed();
  router = buildTaskRouter();
  const spyNew = await spyTx();
  const t1 = process.hrtime.bigint();
  try { await router.extPatchMany(items); } finally { spyNew.restore(); }
  const newMs = Number(process.hrtime.bigint() - t1) / 1e6;
  const newTasks = byCid(await all("tasks"));

  console.log("[taskext_many] 200 item, 500 task tersimpan: jalur massal " + newMs.toFixed(1) + " ms / "
    + spyNew.log.length + " transaksi; jalur lama (PUT per item) " + oldMs.toFixed(1) + " ms / " + spyOld.log.length + " transaksi");
  // tanpa asersi jam dinding (tidak rapuh); hasil kedua jalur sama kecuali updated_at (rute memakai jam nyata)
  for (const k of Object.keys(oldTasks)) {
    const a = Object.assign({}, oldTasks[k]); const b = Object.assign({}, newTasks[k]);
    delete a.updated_at; delete b.updated_at;
    assert.deepEqual(b, a, k);
  }
  assert.ok(spyOld.log.length > spyNew.log.length);
});

test("berhenti di gagal: item ke-6 cid hilang → applied 5 cid pertama, record 6–200 tidak berubah, error Task not found; patch tak sah di item mana pun → reject sebelum tulis, tanpa applied", async () => {
  await seed();
  const before = byCid(await all("tasks"));
  const items = Array.from({ length: 200 }, (_, k) => ({ cid: cidOf(k), ext_patch: { "demo-ext.a": "g" + k } }));
  items[5] = { cid: "cid-tidak-ada", ext_patch: { "demo-ext.a": "x" } };
  const res = await repo.updateTaskExtMany(items, OPTS);
  assert.ok(res.error instanceof Error);
  assert.equal(res.error.message, "Task not found");
  assert.deepEqual(res.applied, items.slice(0, 5).map((it) => it.cid));
  assert.equal(res.recs.length, 5);
  const after = byCid(await all("tasks"));
  for (let k = 0; k < 5; k++) assert.equal(after[cidOf(k)].ext["demo-ext.a"], "g" + k, "item sebelum titik berhenti ter-commit");
  for (let k = 5; k < N; k++) assert.deepEqual(after[cidOf(k)], before[cidOf(k)], "record " + k + " tidak berubah");
  assert.deepEqual((await all("_outbox")).map((o) => o.cid), items.slice(0, 5).map((it) => it.cid));

  // record terhapus (tombstone) di tengah = titik berhenti yang sama
  await freshDB();
  await seed((r, i) => { if (i === 3) r.deleted = true; });
  const res2 = await repo.updateTaskExtMany(items.slice(0, 10).map((it, k) => ({ cid: cidOf(k), ext_patch: it.ext_patch })), OPTS);
  assert.equal(res2.error.message, "Task not found");
  assert.deepEqual(res2.applied, [cidOf(0), cidOf(1), cidOf(2)]);

  // patch tak sah di item terakhir → reject, nol tulis
  await freshDB();
  await seed();
  const before3 = await all("tasks");
  for (const badAt of [0, 150, 199]) {
    const bad = items.map((it, k) => ({ cid: cidOf(k), ext_patch: it.ext_patch }));
    bad[badAt] = { cid: cidOf(badAt), ext_patch: { "Kunci Salah": 1 } };
    await assert.rejects(repo.updateTaskExtMany(bad, OPTS),
      (e) => e.status === 422 && e.code === "EXT_INVALID" && e.key === "Kunci Salah" && !("applied" in e));
  }
  await assert.rejects(repo.updateTaskExtMany([{ cid: cidOf(1), ext_patch: null }], OPTS), (e) => e.code === "EXT_INVALID");
  await assert.rejects(repo.updateTaskExtMany("bukan-array", OPTS), (e) => e.code === "EXT_INVALID");
  assert.deepEqual(await all("tasks"), before3);
  assert.deepEqual(await all("_outbox"), []);
});

test("ukuran ext > 4096 di item ke-3 → applied 2", async () => {
  await seed();
  const before = byCid(await all("tasks"));
  const items = Array.from({ length: 6 }, (_, k) => ({ cid: cidOf(k), ext_patch: { "demo-ext.a": "s" + k } }));
  items[2] = { cid: cidOf(2), ext_patch: { "demo-ext.a": "x".repeat(4100) } };
  const res = await repo.updateTaskExtMany(items, OPTS);
  assert.deepEqual(res.applied, [cidOf(0), cidOf(1)]);
  assert.equal(res.error.status, 422);
  assert.equal(res.error.code, "EXT_TOO_LARGE");
  assert.equal(res.error.key, "demo-ext");
  const after = byCid(await all("tasks"));
  for (let k = 2; k < 6; k++) assert.deepEqual(after[cidOf(k)], before[cidOf(k)]);
  assert.equal((await all("_outbox")).length, 2);
  // [] → tanpa transaksi, tanpa error
  assert.deepEqual(await repo.updateTaskExtMany([], OPTS), { recs: [], applied: [], error: null });
});

test("extPatchMany: id angka server_id, cid string, client_id → terpetakan seperti resolveCid; rows berbentuk sama dengan PUT lokal (id = server_id ?? cid, pomodoros_done)", async () => {
  // task 14: server_id 1014 + client_id; task 21: client_id saja (tanpa server_id); task 3: cid saja
  await seed();
  await pomolog.enqueue(cidOf(14), { client_id: "pomo-1", kind: "focus", pomodoros: 2, focus_seconds: 3000, log_date: "2026-11-01", ended_at: NOW });
  const router = buildTaskRouter();
  const ids = [1014, cidOf(3), "client-021", "1000"];
  const items = ids.map((id, k) => ({ id, ext_patch: { "demo-ext.a": "r" + k } }));
  const res = await router.extPatchMany(items);
  assert.equal(res.error, null);
  assert.deepEqual(res.appliedIds, ids, "appliedIds = id masukan apa adanya (tipe dipertahankan)");
  assert.deepEqual(res.rows.map((r) => r.cid), [cidOf(14), cidOf(3), cidOf(21), cidOf(0)]);
  assert.deepEqual(res.rows.map((r) => r.id), [1014, cidOf(3), cidOf(21), 1000]);
  assert.equal(res.rows[0].pomodoros_done, (14 % 4) + 2, "pomodoros_done = nilai server + log pending");
  assert.equal(res.rows[0].ext["demo-ext.a"], "r0");

  // bentuk baris = PUT lokal (kunci dan nilai sama kecuali updated_at; rute memakai jam nyata)
  await freshDB();
  await seed();
  await pomolog.enqueue(cidOf(14), { client_id: "pomo-1", kind: "focus", pomodoros: 2, focus_seconds: 3000, log_date: "2026-11-01", ended_at: NOW });
  const r2 = buildTaskRouter();
  const putRows = [];
  for (const it of items) putRows.push(await r2.dispatch("PUT", "/api/tasks/" + encodeURIComponent(it.id), { ext_patch: it.ext_patch }));
  const strip = (r) => { const c = Object.assign({}, r); delete c.updated_at; return c; };
  assert.deepEqual(res.rows.map(strip), putRows.map(strip));
  assert.deepEqual(Object.keys(res.rows[0]).sort(), Object.keys(putRows[0]).sort());
});

test("extPatchMany: id tak dikenal = titik berhenti 'Task not found' dengan appliedIds sebelum titik itu; patch tak sah di mana pun → reject tanpa tulis", async () => {
  await seed();
  const router = buildTaskRouter();
  const items = [{ id: cidOf(1), ext_patch: { "demo-ext.a": 1 } }, { id: 1002, ext_patch: { "demo-ext.a": 2 } },
    { id: 999999, ext_patch: { "demo-ext.a": 3 } }, { id: cidOf(4), ext_patch: { "demo-ext.a": 4 } }];
  const res = await router.extPatchMany(items);
  assert.equal(res.error.message, "Task not found");
  assert.deepEqual(res.appliedIds, [cidOf(1), 1002]);
  assert.deepEqual(res.rows.map((r) => r.cid), [cidOf(1), cidOf(2)]);
  const t4 = byCid(await all("tasks"))[cidOf(4)];
  assert.deepEqual(t4, makeRec(4), "item setelah titik berhenti tidak tersentuh");

  await freshDB();
  await seed();
  const r2 = buildTaskRouter();
  await assert.rejects(r2.extPatchMany([{ id: cidOf(1), ext_patch: { "demo-ext.a": 1 } }, { id: 999999, ext_patch: { "x": 1 } }]),
    (e) => e.status === 422 && e.code === "EXT_INVALID");
  assert.deepEqual(await all("_outbox"), []);
  assert.deepEqual(byCid(await all("tasks"))[cidOf(1)], makeRec(1));
});

test("transaksi gagal (request put ConstraintError) → reject dengan alasan bukan null, nol tulis", async () => {
  await seed();
  const before = await all("tasks");
  const db = await openDB();
  const orig = db.transaction;
  // put diganti add atas kunci yang sudah ada → request error yang naik ke tx.onerror (sebelum abort)
  db.transaction = function () {
    const tx = orig.apply(this, arguments);
    const os = tx.objectStore.bind(tx);
    tx.objectStore = (name) => {
      const s = os(name);
      if (name === "tasks") s.put = (rec) => s.add(rec);
      return s;
    };
    return tx;
  };
  let err;
  try {
    await repo.updateTaskExtMany([{ cid: cidOf(1), ext_patch: { "demo-ext.a": 1 } }], OPTS).then(() => assert.fail("harus reject"), (e) => { err = e; });
  } finally { db.transaction = orig; }
  assert.ok(err != null, "alasan reject tidak null");
  assert.equal(err.name, "ConstraintError");
  assert.deepEqual(await all("tasks"), before);
  assert.deepEqual(await all("_outbox"), []);
});
