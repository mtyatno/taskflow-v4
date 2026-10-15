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

// ── Workstream A2 (audit 2026-10-15) S1: keep_as_personal untuk access_lost ───────────────────────
async function putStore(store, recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    for (const r of recs) tx.objectStore(store).put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function getStore(store, cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction(store).objectStore(store).get(cid); q.onsuccess = () => res(q.result); });
}

test("resolveConflict keep_as_personal (task): list_id/list_cid null, server_id null, fresh client_id, conflict removed, dirty 1, ops+idmap dropped, create queued", async () => {
  await putTasks([{ cid: "a", server_id: 10, title: "A", list_id: 7, list_cid: "lc", conflict: "access_lost", dirty: 1, rev: 2, description: "edit lokal" }]);
  await mapPut("task", 10, "a");
  await outboxAdd({ op: "update", entity_type: "task", cid: "a", payload: {} });
  await resolveConflict("task", "a", "keep_as_personal");
  const rec = await getTask("a");
  assert.equal(rec.list_id, null);
  assert.equal(rec.list_cid, null);
  assert.equal(rec.server_id, null);
  assert.equal(rec.conflict, undefined);
  assert.equal(rec.dirty, 1);
  assert.equal(rec.rev, 3);
  assert.equal(rec.description, "edit lokal");
  assert.ok(rec.client_id && rec.client_id !== "a", "client_id segar: server tidak boleh mengembalikan baris lama");
  assert.equal(await cidOf("task", 10), undefined);
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "create");
  assert.equal(ops[0].cid, "a");
});

test("resolveConflict keep_as_personal (note & mindmap) clears list_id and queues a create with a fresh client_id", async () => {
  await putStore("scratchpad_notes", [{ cid: "n", server_id: 5, title: "N", content: "c", list_id: 3, conflict: "access_lost", dirty: 1 }]);
  await putStore("mindmaps", [{ cid: "m", server_id: 6, title: "M", data_json: "{}", list_id: 3, conflict: "access_lost", dirty: 1 }]);
  await mapPut("note", 5, "n");
  await mapPut("mindmap", 6, "m");
  await resolveConflict("note", "n", "keep_as_personal");
  await resolveConflict("mindmap", "m", "keep_as_personal");
  const n = await getStore("scratchpad_notes", "n");
  const m = await getStore("mindmaps", "m");
  for (const r of [n, m]) {
    assert.equal(r.list_id, null);
    assert.equal(r.server_id, null);
    assert.equal(r.conflict, undefined);
    assert.ok(r.client_id);
  }
  assert.notEqual(n.client_id, m.client_id);
  const ops = await outboxAll();
  assert.deepEqual(ops.map((o) => o.entity_type + ":" + o.op).sort(), ["mindmap:create", "note:create"]);
});

test("keep_as_personal copy is POSTed with the fresh client_id, not the old cid (T11)", async () => {
  const { pushOutbox } = require("../../static/offline/syncpush.js");
  await putTasks([{ cid: "a", server_id: 10, title: "A", list_id: 7, conflict: "access_lost", dirty: 1, deleted: false }]);
  await mapPut("task", 10, "a");
  await resolveConflict("task", "a", "keep_as_personal");
  const rec = await getTask("a");
  const calls = [];
  const tr = { request(m, p, b) { calls.push({ m, p, b }); return Promise.resolve({ status: 201, data: { id: 99 } }); } };
  await pushOutbox(tr);
  assert.equal(calls[0].p, "/api/tasks");
  assert.equal(calls[0].b.client_id, rec.client_id);
  assert.equal(calls[0].b.list_id, null);
  assert.equal((await getTask("a")).server_id, 99);
  assert.equal(await serverIdOf("a"), 99);
});

test("resolveConflict applies changes to the CURRENT record (TFdb.mutate), not the pre-read object", async () => {
  const { mutate } = require("../../static/offline/db.js");
  await putTasks([{ cid: "a", server_id: 10, title: "A", conflict: "remote_deleted", dirty: 1, rev: 1 }]);
  // edit "bersamaan" sebelum resolveConflict menulis: harus tetap terlihat setelahnya
  const p = resolveConflict("task", "a", "keep_as_new");
  await mutate("tasks", "a", (cur) => Object.assign({}, cur, { title: "A-edited", rev: 2 }));
  await p;
  const rec = await getTask("a");
  assert.equal(rec.server_id, null);
  assert.equal(rec.conflict, undefined);
  assert.equal(rec.title, "A-edited");
});
