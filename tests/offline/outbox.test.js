"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset } = require("../../static/offline/db.js");
const { outboxAdd, outboxAll, outboxRemove, outboxByEntity } = require("../../static/offline/outbox.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

test("outboxAdd assigns a qid and stores ts/retries defaults", async () => {
  const qid = await outboxAdd({ op: "create", entity_type: "task", cid: "c1", payload: { title: "a" } });
  assert.equal(typeof qid, "number");
  const all = await outboxAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].op, "create");
  assert.equal(all[0].retries, 0);
  assert.equal(typeof all[0].ts, "number");
});

test("outboxAll preserves insertion order", async () => {
  await outboxAdd({ op: "create", entity_type: "task", cid: "c1", payload: {} });
  await outboxAdd({ op: "update", entity_type: "task", cid: "c1", payload: {} });
  const all = await outboxAll();
  assert.deepEqual(all.map((o) => o.op), ["create", "update"]);
});

test("outboxRemove deletes by qid", async () => {
  const qid = await outboxAdd({ op: "delete", entity_type: "task", cid: "c1", payload: {} });
  await outboxRemove(qid);
  assert.equal((await outboxAll()).length, 0);
});

test("outboxByEntity filters by type+cid", async () => {
  await outboxAdd({ op: "create", entity_type: "task", cid: "c1", payload: {} });
  await outboxAdd({ op: "create", entity_type: "note", cid: "c2", payload: {} });
  const r = await outboxByEntity("task", "c1");
  assert.equal(r.length, 1);
  assert.equal(r[0].entity_type, "task");
});
