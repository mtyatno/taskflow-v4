"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const {
  createMindmap, updateMindmap, deleteMindmap, togglePin, getRaw,
} = require("../../static/offline/mindmaprepo.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

test("createMindmap writes a dirty local record + create op, defaults applied", async () => {
  const rec = await createMindmap({ title: "Plan" }, { now: "2026-06-10T00:00:00" });
  assert.ok(rec.cid);
  assert.equal(rec.server_id, null);
  assert.equal(rec.title, "Plan");
  assert.equal(rec.pinned, false);
  assert.equal(rec.list_id, null);
  assert.equal(rec.deleted, false);
  assert.equal(rec.dirty, 1);
  assert.match(rec.data_json, /nodeData/);
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].entity_type, "mindmap");
  assert.equal(ops[0].op, "create");
  assert.equal(ops[0].cid, rec.cid);
});

test("updateMindmap patches title/data_json, bumps updated_at, dedupes update ops", async () => {
  const rec = await createMindmap({ title: "A", data_json: "{\"nodeData\":{}}" }, { now: "2026-06-10T00:00:00" });
  await updateMindmap(rec.cid, { data_json: "{\"nodeData\":{\"x\":1}}" }, { now: "2026-06-10T01:00:00" });
  await updateMindmap(rec.cid, { title: "A2", data_json: "{\"nodeData\":{\"x\":2}}" }, { now: "2026-06-10T02:00:00" });
  const after = await getRaw(rec.cid);
  assert.equal(after.title, "A2");
  assert.equal(after.data_json, "{\"nodeData\":{\"x\":2}}");
  assert.equal(after.updated_at, "2026-06-10T02:00:00");
  assert.equal(after.dirty, 1);
  const ops = await outboxAll();
  // 1 create + only 1 update (second update deduped the first)
  assert.equal(ops.filter((o) => o.op === "update").length, 1);
  assert.equal(ops.filter((o) => o.op === "create").length, 1);
});

test("togglePin flips pinned, enqueues a pin op, and does NOT set dirty", async () => {
  const rec = await createMindmap({ title: "P" }, { now: "2026-06-10T00:00:00" });
  // simulate an already-synced record so we can prove pin does not dirty it
  const db = await openDB();
  await new Promise((res) => { const tx = db.transaction("mindmaps", "readwrite"); tx.objectStore("mindmaps").put(Object.assign({}, rec, { server_id: 9, dirty: 0 })); tx.oncomplete = res; });
  const next = await togglePin(rec.cid);
  assert.equal(next.pinned, true);
  const after = await getRaw(rec.cid);
  assert.equal(after.pinned, true);
  assert.equal(after.dirty, 0); // pin orthogonal to content LWW
  const ops = await outboxAll();
  const pinOps = ops.filter((o) => o.op === "pin");
  assert.equal(pinOps.length, 1);
  assert.equal(pinOps[0].payload.pinned, true);
});

test("deleteMindmap tombstones (deleted+dirty) and enqueues a delete op", async () => {
  const rec = await createMindmap({ title: "D" }, { now: "2026-06-10T00:00:00" });
  await deleteMindmap(rec.cid);
  const after = await getRaw(rec.cid);
  assert.equal(after.deleted, true);
  assert.equal(after.dirty, 1);
  const ops = await outboxAll();
  assert.equal(ops.filter((o) => o.op === "delete").length, 1);
});
