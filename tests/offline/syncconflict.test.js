"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut, cidOf, serverIdOf } = require("../../static/offline/idmap.js");
const { outboxAll, outboxAdd } = require("../../static/offline/outbox.js");
const { listConflicts, resolveConflict } = require("../../static/offline/syncconflict.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function putTasks(recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("tasks", "readwrite");
    for (const r of recs) tx.objectStore("tasks").put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function getTask(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("tasks").objectStore("tasks").get(cid); q.onsuccess = () => res(q.result); });
}

test("listConflicts returns only flagged records", async () => {
  await putTasks([
    { cid: "a", title: "A", conflict: "remote_deleted", dirty: 1 },
    { cid: "b", title: "B", dirty: 1 },
  ]);
  const list = await listConflicts();
  assert.deepEqual(list.map((c) => c.cid), ["a"]);
  assert.equal(list[0].title, "A");
});

test("resolveConflict discard removes the record, its outbox ops, and idmap entry", async () => {
  await putTasks([{ cid: "a", server_id: 10, title: "A", conflict: "remote_deleted", dirty: 1 }]);
  await mapPut("task", 10, "a");
  await outboxAdd({ op: "update", entity_type: "task", cid: "a", payload: {} });
  await resolveConflict("task", "a", "discard");
  assert.equal(await getTask("a"), undefined);
  assert.equal((await outboxAll()).length, 0);
  assert.equal(await cidOf("task", 10), undefined);
});

test("resolveConflict keep_as_new clears server_id, drops idmap, and queues a create", async () => {
  await putTasks([{ cid: "a", server_id: 10, title: "A", conflict: "remote_deleted", dirty: 1 }]);
  await mapPut("task", 10, "a");
  await outboxAdd({ op: "update", entity_type: "task", cid: "a", payload: {} });
  await resolveConflict("task", "a", "keep_as_new");
  const rec = await getTask("a");
  assert.equal(rec.server_id, null);
  assert.equal(rec.conflict, undefined);
  assert.equal(rec.dirty, 1);
  assert.equal(await cidOf("task", 10), undefined);
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "create");
});

test("listConflicts includes list_id (for shared-task discard-only)", async () => {
  await putTasks([{ cid: "a", title: "A", conflict: "remote_deleted", dirty: 1, list_id: 7 }]);
  const list = await listConflicts();
  assert.equal(list[0].list_id, 7);
});
