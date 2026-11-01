"use strict";
// ext/ext_dirty di record task lokal (spec plugin Fase 1 K5; rencana 1a-1 T4, R7, R8).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset } = require("../../static/offline/db.js");
const repo = require("../../static/offline/taskrepo.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");

const TODAY = "2026-06-03";
const O = { today: TODAY };

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

function big(ns, n) { return { [ns + ".v"]: "x".repeat(n) }; }

test("createTask dengan ext → rec.ext, ext_dirty, op create", async () => {
  const t = await repo.createTask({ title: "a", ext: { "demo-ext.note": "hai", "demo-ext.gone": null } }, O);
  const rec = await repo.getRaw(t.cid);
  assert.deepEqual(rec.ext, { "demo-ext.note": "hai" });
  assert.deepEqual(rec.ext_dirty, ["demo-ext.note"]);
  assert.deepEqual(t.ext, { "demo-ext.note": "hai" });
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "create");
  assert.deepEqual(ops[0].payload.ext, { "demo-ext.note": "hai" });
});

test("createTask tanpa ext → ext {} tanpa ext_dirty", async () => {
  const t = await repo.createTask({ title: "a" }, O);
  const rec = await repo.getRaw(t.cid);
  assert.deepEqual(rec.ext, {});
  assert.equal("ext_dirty" in rec, false);
  assert.deepEqual(t.ext, {});
});

test("createTask ext tidak valid → reject 422, tidak ada record/op", async () => {
  await assert.rejects(repo.createTask({ title: "a", ext: { "Bad.key": 1 } }, O),
    (e) => e.status === 422 && e.message === "EXT_INVALID" && e.key === "Bad.key");
  await assert.rejects(repo.createTask({ title: "a", ext: big("demo-ext", 5000) }, O),
    (e) => e.status === 422 && e.message === "EXT_TOO_LARGE" && e.key === "demo-ext");
  assert.equal((await outboxAll()).length, 0);
});

test("updateTask ext_patch: merge per kunci, null menghapus, ext_dirty gabungan, dirty 1, rev+1, satu op update", async () => {
  const t = await repo.createTask({ title: "a", ext: { "demo-ext.a": 1, "x-plug.k": 2 } }, O);
  const before = await repo.getRaw(t.cid);
  const out = await repo.updateTask(t.cid, { ext_patch: { "demo-ext.b": 3, "demo-ext.a": null } }, O);
  const rec = await repo.getRaw(t.cid);
  assert.deepEqual(rec.ext, { "x-plug.k": 2, "demo-ext.b": 3 });
  assert.deepEqual(rec.ext_dirty.slice().sort(), ["demo-ext.a", "demo-ext.b", "x-plug.k"]);
  assert.equal(rec.dirty, 1);
  assert.equal(rec.rev, before.rev + 1);
  assert.equal(rec.title, "a");
  assert.deepEqual(out.ext, rec.ext);
  const ops = await outboxAll();
  assert.deepEqual(ops.map((o) => o.op), ["create", "update"]);
  assert.deepEqual(ops[1].payload.ext, rec.ext);
});

test("updateTask tanpa ext_patch tidak menyentuh ext/ext_dirty", async () => {
  const t = await repo.createTask({ title: "a", ext: { "demo-ext.a": 1 } }, O);
  await repo.updateTask(t.cid, { title: "b" }, O);
  const rec = await repo.getRaw(t.cid);
  assert.equal(rec.title, "b");
  assert.deepEqual(rec.ext, { "demo-ext.a": 1 });
  assert.deepEqual(rec.ext_dirty, ["demo-ext.a"]);
});

test("updateTask bersamaan (title + ext_patch tanpa await di antaranya) → kunci ext dan judul baru sama-sama tersimpan", async () => {
  const t = await repo.createTask({ title: "a" }, O);
  const p1 = repo.updateTask(t.cid, { title: "judul baru" }, O);
  const p2 = repo.updateTask(t.cid, { ext_patch: { "demo-ext.a": 1 } }, O);
  const p3 = repo.updateTask(t.cid, { description: "d", ext_patch: { "demo-ext.b": 2 } }, O);
  await Promise.all([p1, p2, p3]);
  const rec = await repo.getRaw(t.cid);
  assert.equal(rec.title, "judul baru");
  assert.equal(rec.description, "d");
  assert.deepEqual(rec.ext, { "demo-ext.a": 1, "demo-ext.b": 2 });
  assert.deepEqual(rec.ext_dirty.slice().sort(), ["demo-ext.a", "demo-ext.b"]);
  assert.equal(rec.rev, 4);
  // urutan sebaliknya juga
  const p4 = repo.updateTask(t.cid, { ext_patch: { "demo-ext.c": 3 } }, O);
  const p5 = repo.updateTask(t.cid, { title: "lagi" }, O);
  await Promise.all([p4, p5]);
  const rec2 = await repo.getRaw(t.cid);
  assert.equal(rec2.title, "lagi");
  assert.deepEqual(rec2.ext, { "demo-ext.a": 1, "demo-ext.b": 2, "demo-ext.c": 3 });
});

test("ext_patch terlalu besar → reject status 422 pesan EXT_TOO_LARGE, record dan outbox tidak berubah", async () => {
  const t = await repo.createTask({ title: "a", ext: big("demo-ext", 2100) }, O);
  const before = await repo.getRaw(t.cid);
  const nOps = (await outboxAll()).length;
  await assert.rejects(repo.updateTask(t.cid, { title: "b", ext_patch: { "demo-ext.w": "y".repeat(2100) } }, O),
    (e) => e.status === 422 && e.message === "EXT_TOO_LARGE" && e.key === "demo-ext");
  assert.deepEqual(await repo.getRaw(t.cid), before);
  assert.equal((await outboxAll()).length, nOps);
});

test("kunci tak valid → EXT_INVALID", async () => {
  const t = await repo.createTask({ title: "a" }, O);
  await assert.rejects(repo.updateTask(t.cid, { ext_patch: { "Bad.key": 1 } }, O),
    (e) => e.status === 422 && e.message === "EXT_INVALID" && e.key === "Bad.key");
  await assert.rejects(repo.updateTask(t.cid, { ext_patch: [] }, O),
    (e) => e.status === 422 && e.message === "EXT_INVALID");
  await assert.rejects(repo.updateTask(t.cid, { ext_patch: { "demo-ext.d": { $task: 1.5 } } }, O),
    (e) => e.status === 422 && e.message === "EXT_TASK_REF");
});

test("task terhapus → Task not found", async () => {
  const t = await repo.createTask({ title: "a" }, O);
  await repo.deleteTask(t.cid, O);
  await assert.rejects(repo.updateTask(t.cid, { ext_patch: { "demo-ext.a": 1 } }, O), /Task not found/);
  // terhapus di antara baca dan tulis akhir
  const t2 = await repo.createTask({ title: "b" }, O);
  const p = repo.updateTask(t2.cid, { ext_patch: { "demo-ext.a": 1 } }, O);
  const d = repo.deleteTask(t2.cid, O);
  const res = await Promise.allSettled([p, d]);
  const rec = await repo.getRaw(t2.cid);
  assert.equal(rec.deleted, true);
  if (res[0].status === "rejected") assert.match(res[0].reason.message, /Task not found/);
});

test("rute lokal PUT /api/tasks/:id meneruskan {ext_patch} dan mengembalikan baris berisi ext", async () => {
  const R = buildTaskRouter();
  const t = await R.dispatch("POST", "/api/tasks", { title: "a", ext: { "demo-ext.a": 1 } });
  assert.deepEqual(t.ext, { "demo-ext.a": 1 });
  const out = await R.dispatch("PUT", "/api/tasks/" + t.id, { ext_patch: { "demo-ext.b": 2 } });
  assert.deepEqual(out.ext, { "demo-ext.a": 1, "demo-ext.b": 2 });
  const got = await R.dispatch("GET", "/api/tasks/" + t.id);
  assert.deepEqual(got.ext, { "demo-ext.a": 1, "demo-ext.b": 2 });
  await assert.rejects(R.dispatch("PUT", "/api/tasks/" + t.id, { ext_patch: { "Bad.key": 1 } }),
    (e) => e.status === 422 && e.body.detail.code === "EXT_INVALID");
});

test("displayFrom: ext selalu objek", () => {
  assert.deepEqual(repo.displayFrom({ cid: "c", title: "a" }, TODAY, null).ext, {});
  assert.deepEqual(repo.displayFrom({ cid: "c", title: "a", ext: "{}" }, TODAY, null).ext, {});
  assert.deepEqual(repo.displayFrom({ cid: "c", title: "a", ext: { "demo-ext.a": 1 } }, TODAY, null).ext,
    { "demo-ext.a": 1 });
});

// --- PR 1c-0 (K25; rencana R1, R2, R5, R8): penanda ext_only_rev ---
const TFdb = require("../../static/offline/db.js");
const X = require("../../static/offline/taskext.js");
const H = require("../../static/offline/hydrate.js");
const { getEntityTags } = require("../../static/offline/tagrepo.js");

// Record bersih = sudah tersinkron (seperti hasil pull/push sukses).
function clean(cid) {
  return TFdb.mutate("tasks", cid, (cur) => {
    const next = Object.assign({}, cur, { dirty: 0, server_id: 77, base_rev: "2026-06-01T00:00:00Z" });
    delete next.ext_dirty;
    return next;
  });
}

test("coreFromServer: hanya kunci yang dikirim; bawaan sama dengan taskFromServer (progress null → 0, estimated_pomodoros null → 1, is_focused true tetap true); tanpa created_at/updated_at/parent/list/ext; project_ref_name/context_ref_name dihitung", () => {
  assert.equal(typeof H.coreFromServer, "function");
  assert.deepEqual(H.coreFromServer({ title: "Judul" }), { title: "Judul" });
  assert.deepEqual(H.coreFromServer({}), {});
  const full = {
    id: 5, title: "T", description: null, gtd_status: "next", priority: "A", quadrant: "Q1",
    project: "P", project_id: 9, context: null, context_id: 4, deadline: null, waiting_for: null,
    completed_at: null, progress: null, is_focused: true, assigned_to: null,
    recurrence_type: null, recurrence_days: null, recurrence_end_date: null, recurrence_notif_level: null,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-06-02T00:00:00Z", estimated_pomodoros: null, pomodoros_done: null,
    parent_id: 3, list_id: 2, client_id: "abc", ext: { "demo-ext.a": 1 },
  };
  const core = H.coreFromServer(full);
  const ref = H.taskFromServer(full, (sid) => "c" + sid);
  for (const k of Object.keys(core)) assert.deepEqual(core[k], ref[k], k);
  assert.equal(core.progress, 0);
  assert.equal(core.estimated_pomodoros, 1);
  assert.equal(core.pomodoros_done, 0);
  assert.equal(core.is_focused, true);
  assert.equal(core.description, null);
  for (const k of ["created_at", "updated_at", "parent_cid", "parent_id", "list_id", "list_cid", "client_id", "ext",
    "cid", "server_id", "id", "dirty", "base_rev", "deleted", "rev"]) {
    assert.equal(k in core, false, k);
  }
  assert.equal(core.project_ref_name, "P");
  assert.equal(core.context_ref_name, "");
  assert.equal(H.coreFromServer({ project: "P", project_id: null }).project_ref_name, null);
  assert.equal("project_ref_name" in H.coreFromServer({ title: "x" }), false);
  assert.equal("context_ref_name" in H.coreFromServer({ title: "x" }), false);
});

test("updateTask ext_patch pada record bersih → ext_only_rev = rev baru", async () => {
  const t = await repo.createTask({ title: "a" }, O);
  await clean(t.cid);
  const before = await repo.getRaw(t.cid);
  await repo.updateTask(t.cid, { ext_patch: { "demo-ext.a": 1 } }, O);
  const rec = await repo.getRaw(t.cid);
  assert.equal(rec.rev, before.rev + 1);
  assert.equal(rec[X.EXT_ONLY_KEY], rec.rev);
  assert.equal(X.extOnlyNow(rec), true);
});

test("dua ext_patch berturut → penanda mengikuti rev terakhir", async () => {
  const t = await repo.createTask({ title: "a" }, O);
  await clean(t.cid);
  await repo.updateTask(t.cid, { ext_patch: { "demo-ext.a": 1 } }, O);
  await repo.updateTask(t.cid, { ext_patch: { "demo-ext.b": 2 } }, O);
  const rec = await repo.getRaw(t.cid);
  assert.equal(rec.ext_only_rev, rec.rev);
  assert.equal(X.extOnlyNow(rec), true);
  assert.deepEqual(rec.ext_dirty.slice().sort(), ["demo-ext.a", "demo-ext.b"]);
});

test("ext_patch lalu title → penanda hilang; title lalu ext_patch → tidak pernah ada", async () => {
  const t = await repo.createTask({ title: "a" }, O);
  await clean(t.cid);
  await repo.updateTask(t.cid, { ext_patch: { "demo-ext.a": 1 } }, O);
  await repo.updateTask(t.cid, { title: "b" }, O);
  const rec = await repo.getRaw(t.cid);
  assert.equal("ext_only_rev" in rec, false);
  assert.equal(X.extOnlyNow(rec), false);

  const t2 = await repo.createTask({ title: "c" }, O);
  await clean(t2.cid);
  await repo.updateTask(t2.cid, { title: "d" }, O);
  assert.equal("ext_only_rev" in (await repo.getRaw(t2.cid)), false);
  await repo.updateTask(t2.cid, { ext_patch: { "demo-ext.a": 1 } }, O);
  const rec2 = await repo.getRaw(t2.cid);
  assert.equal("ext_only_rev" in rec2, false);
  assert.equal(X.extOnlyNow(rec2), false);
});

test("title + ext_patch dalam satu patch → tanpa penanda", async () => {
  const t = await repo.createTask({ title: "a" }, O);
  await clean(t.cid);
  await repo.updateTask(t.cid, { title: "b", ext_patch: { "demo-ext.a": 1 } }, O);
  const rec = await repo.getRaw(t.cid);
  assert.equal("ext_only_rev" in rec, false);
  assert.equal(rec.title, "b");
});

test("{ext_patch, gtd_status:'done'} → tanpa penanda", async () => {
  const t = await repo.createTask({ title: "a" }, O);
  await clean(t.cid);
  await repo.updateTask(t.cid, { gtd_status: "done", ext_patch: { "demo-ext.a": 1 } }, O);
  const rec = await repo.getRaw(t.cid);
  assert.equal("ext_only_rev" in rec, false);
  assert.equal(rec.gtd_status, "done");
});

test("record lama kotor tanpa kunci + ext_patch → tanpa penanda (payload penuh)", async () => {
  const t = await repo.createTask({ title: "a" }, O); // dirty 1 (op create), tanpa kunci
  await repo.updateTask(t.cid, { ext_patch: { "demo-ext.a": 1 } }, O);
  const rec = await repo.getRaw(t.cid);
  assert.equal("ext_only_rev" in rec, false);
  assert.equal(X.extOnlyNow(rec), false);
  // record lama ber-dirty dari edit inti (kode 1b) tanpa kunci
  const t2 = await repo.createTask({ title: "b" }, O);
  await clean(t2.cid);
  await TFdb.mutate("tasks", t2.cid, (cur) => Object.assign({}, cur, { title: "lama", dirty: 1, rev: cur.rev + 1 }));
  await repo.updateTask(t2.cid, { ext_patch: { "demo-ext.a": 1 } }, O);
  assert.equal(X.extOnlyNow(await repo.getRaw(t2.cid)), false);
});

test("tulis mentah ala kode lama (rev+1, salin record termasuk ext_only_rev) → extOnlyNow false", async () => {
  const t = await repo.createTask({ title: "a" }, O);
  await clean(t.cid);
  await repo.updateTask(t.cid, { ext_patch: { "demo-ext.a": 1 } }, O);
  assert.equal(X.extOnlyNow(await repo.getRaw(t.cid)), true);
  // updateTask kode 1b: Object.assign({}, base) + field inti + rev+1 — kunci ikut tersalin
  await TFdb.mutate("tasks", t.cid, (cur) => Object.assign({}, cur, { title: "judul tab lama", dirty: 1, rev: (cur.rev || 0) + 1 }));
  const rec = await repo.getRaw(t.cid);
  assert.equal(typeof rec.ext_only_rev, "number"); // tersalin
  assert.equal(X.extOnlyNow(rec), false);
  // edit ext berikutnya di tab baru tidak menghidupkannya lagi
  await repo.updateTask(t.cid, { ext_patch: { "demo-ext.b": 1 } }, O);
  const rec2 = await repo.getRaw(t.cid);
  assert.equal(X.extOnlyNow(rec2), false);
  assert.equal("ext_only_rev" in rec2, false);
});

test("updateTask bersamaan (title + ext_patch tanpa await) → tanpa penanda di akhir, kedua nilai tersimpan", async () => {
  const t = await repo.createTask({ title: "a" }, O);
  await clean(t.cid);
  await Promise.all([
    repo.updateTask(t.cid, { title: "judul baru" }, O),
    repo.updateTask(t.cid, { ext_patch: { "demo-ext.a": 1 } }, O),
  ]);
  const rec = await repo.getRaw(t.cid);
  assert.equal(rec.title, "judul baru");
  assert.deepEqual(rec.ext, { "demo-ext.a": 1 });
  assert.equal(X.extOnlyNow(rec), false);
  assert.equal("ext_only_rev" in rec, false);
  // urutan sebaliknya
  const t2 = await repo.createTask({ title: "b" }, O);
  await clean(t2.cid);
  await Promise.all([
    repo.updateTask(t2.cid, { ext_patch: { "demo-ext.a": 1 } }, O),
    repo.updateTask(t2.cid, { title: "lagi" }, O),
  ]);
  const rec2 = await repo.getRaw(t2.cid);
  assert.equal(rec2.title, "lagi");
  assert.deepEqual(rec2.ext, { "demo-ext.a": 1 });
  assert.equal("ext_only_rev" in rec2, false);
});

test("createTask dengan ext → tanpa penanda", async () => {
  const t = await repo.createTask({ title: "a", ext: { "demo-ext.a": 1 } }, O);
  const rec = await repo.getRaw(t.cid);
  assert.equal("ext_only_rev" in rec, false);
  assert.equal(X.extOnlyNow(rec), false);
});

test("deleteTask → kunci dihapus", async () => {
  const t = await repo.createTask({ title: "a" }, O);
  await clean(t.cid);
  await repo.updateTask(t.cid, { ext_patch: { "demo-ext.a": 1 } }, O);
  assert.equal(X.extOnlyNow(await repo.getRaw(t.cid)), true);
  await repo.deleteTask(t.cid, O);
  const rec = await repo.getRaw(t.cid);
  assert.equal(rec.deleted, true);
  assert.equal("ext_only_rev" in rec, false);
  assert.equal(X.extOnlyNow(rec), false);
});

test("rute DELETE tag pada record kotor ext saja → rev+1, extOnlyNow false, ext_dirty tetap, {ok:true}; pada record bersih → record tidak berubah (rev sama)", async () => {
  const R = buildTaskRouter();
  const t = await R.dispatch("POST", "/api/tasks", { title: "a #kopi #teh" });
  const cid = t.cid || (await repo.getTask(t.id)).cid;
  await clean(cid);
  await R.dispatch("PUT", "/api/tasks/" + t.id, { ext_patch: { "demo-ext.a": 1 } });
  const before = await repo.getRaw(cid);
  assert.equal(X.extOnlyNow(before), true);
  const res = await R.dispatch("DELETE", "/api/tasks/" + t.id + "/tags/kopi");
  assert.deepEqual(res, { ok: true });
  const after = await repo.getRaw(cid);
  assert.equal(after.rev, before.rev + 1);
  assert.equal(X.extOnlyNow(after), false);
  assert.equal(after.dirty, 1);
  assert.deepEqual(after.ext_dirty, before.ext_dirty);
  assert.equal(after.title, before.title);
  assert.deepEqual((await getEntityTags("task", cid)).map((x) => x.name || x).sort(), ["teh"]);

  // record bersih: tidak berubah
  await clean(cid);
  const cleanRec = await repo.getRaw(cid);
  const res2 = await R.dispatch("DELETE", "/api/tasks/" + t.id + "/tags/teh");
  assert.deepEqual(res2, { ok: true });
  assert.deepEqual(await repo.getRaw(cid), cleanRec);
});
