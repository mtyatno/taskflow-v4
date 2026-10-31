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
