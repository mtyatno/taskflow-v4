"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { serverIdOf } = require("../../static/offline/idmap.js");
const { setEntityTags } = require("../../static/offline/tagrepo.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const {
  taskToCreatePayload, taskToUpdatePayload, markPayload, pushOutbox,
} = require("../../static/offline/syncpush.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function put(store, recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    for (const r of recs) os.put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
function task(over) {
  return Object.assign({
    cid: over.cid, server_id: null, title: over.cid, description: "", gtd_status: "next",
    priority: "P3", quadrant: "Q4", project: "", context: "", deadline: null, waiting_for: "",
    assigned_to: null, progress: 0, parent_cid: null, recurrence_type: null, recurrence_days: null,
    deleted: false, dirty: 1,
  }, over);
}
function fakeTransport(handler) {
  const calls = [];
  return {
    calls,
    request(method, path, body) {
      calls.push({ method, path, body });
      const h = handler(method, path, body);
      if (h === "NETWORK") return Promise.reject(new Error("net"));
      return Promise.resolve(h);
    },
  };
}

test("taskToCreatePayload reconstructs title+tags, parses recurrence_days, maps parent_id, list_id null", () => {
  const rec = task({ cid: "a", title: "Beli", recurrence_type: "weekly", recurrence_days: JSON.stringify([1, 3]) });
  const p = taskToCreatePayload(rec, ["kopi", "susu"], 42);
  assert.equal(p.title, "Beli #kopi #susu");
  assert.deepEqual(p.recurrence_days, [1, 3]);
  assert.equal(p.recurrence_type, "weekly");
  assert.equal(p.parent_id, 42);
  assert.equal(p.list_id, null);
  assert.equal(p.gtd_status, "next");
});

test("taskToUpdatePayload has progress, reconstructs title, no parent/list keys", () => {
  const rec = task({ cid: "a", title: "Edit", progress: 40 });
  const p = taskToUpdatePayload(rec, ["x"]);
  assert.equal(p.title, "Edit #x");
  assert.equal(p.progress, 40);
  assert.equal("parent_id" in p, false);
  assert.equal("list_id" in p, false);
});

test("markPayload returns {status}", () => {
  assert.deepEqual(markPayload({ status: "done" }), { status: "done" });
});

test("pushOutbox create posts, sets server_id + idmap, removes op", async () => {
  await put("tasks", [task({ cid: "a", title: "Beli" })]);
  await setEntityTags("task", "a", ["kopi"]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "task", cid: "a", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 201, data: { id: 100 } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(r.remaining, 0);
  assert.equal(tr.calls[0].body.title, "Beli #kopi");
  assert.equal(await serverIdOf("a"), 100);
  const db = await openDB();
  const rec = await new Promise((res) => { const q = db.transaction("tasks").objectStore("tasks").get("a"); q.onsuccess = () => res(q.result); });
  assert.equal(rec.server_id, 100);
  assert.equal(rec.dirty, 0);
});

test("pushOutbox processes FIFO; child create uses parent server_id from earlier create", async () => {
  await put("tasks", [task({ cid: "par", title: "Parent" }), task({ cid: "kid", title: "Kid", parent_cid: "par" })]);
  await put("_outbox", [
    { qid: 1, op: "create", entity_type: "task", cid: "par", payload: {} },
    { qid: 2, op: "create", entity_type: "task", cid: "kid", payload: {} },
  ]);
  let next = 500;
  const tr = fakeTransport((m, p, b) => ({ status: 201, data: { id: next++ } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 2);
  assert.equal(tr.calls[1].body.parent_id, 500);
});

test("pushOutbox update uses serverIdOf and PUTs", async () => {
  await put("tasks", [task({ cid: "a", server_id: 10, title: "New" })]);
  const { mapPut } = require("../../static/offline/idmap.js");
  await mapPut("task", 10, "a");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "task", cid: "a", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 200, data: { id: 10 } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[0].method, "PUT");
  assert.equal(tr.calls[0].path, "/api/tasks/10");
});

test("pushOutbox delete uses serverIdOf and DELETEs", async () => {
  await put("tasks", [task({ cid: "a", server_id: 10, deleted: true })]);
  const { mapPut } = require("../../static/offline/idmap.js");
  await mapPut("task", 10, "a");
  await put("_outbox", [{ qid: 1, op: "delete", entity_type: "task", cid: "a", payload: { cid: "a" } }]);
  const tr = fakeTransport(() => ({ status: 200, data: { ok: true } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[0].method, "DELETE");
  assert.equal(tr.calls[0].path, "/api/tasks/10");
});

test("pushOutbox mark_occurrence resolves task server_id", async () => {
  await put("tasks", [task({ cid: "a", server_id: 10 })]);
  const { mapPut } = require("../../static/offline/idmap.js");
  await mapPut("task", 10, "a");
  await put("_outbox", [{
    qid: 1, op: "mark_occurrence", entity_type: "recurring_exception", cid: "x",
    payload: { cid: "x", task_cid: "a", occurrence_date: "2026-06-10", status: "done" },
  }]);
  const tr = fakeTransport(() => ({ status: 200, data: {} }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[0].path, "/api/tasks/10/occurrences/2026-06-10/mark");
  assert.deepEqual(tr.calls[0].body, { status: "done" });
});

test("pushOutbox stops on network error, leaving remaining ops", async () => {
  await put("tasks", [task({ cid: "a", title: "A" }), task({ cid: "b", title: "B" })]);
  await put("_outbox", [
    { qid: 1, op: "create", entity_type: "task", cid: "a", payload: {} },
    { qid: 2, op: "create", entity_type: "task", cid: "b", payload: {} },
  ]);
  let n = 0;
  const tr = fakeTransport(() => (n++ === 0 ? { status: 201, data: { id: 1 } } : "NETWORK"));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(r.remaining, 1);
});

test("pushOutbox drops a 4xx op and counts it failed", async () => {
  await put("tasks", [task({ cid: "a", server_id: 10, title: "A" })]);
  const { mapPut } = require("../../static/offline/idmap.js");
  await mapPut("task", 10, "a");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "task", cid: "a", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 400, data: { detail: "bad request" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.failed, 1);
  assert.equal(r.remaining, 0);
});

test("pushOutbox skips a create whose record already has server_id (idempotent)", async () => {
  await put("tasks", [task({ cid: "a", server_id: 77, title: "A" })]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "task", cid: "a", payload: {} }]);
  const tr = fakeTransport(() => { throw new Error("should not POST"); });
  const r = await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);
  assert.equal(r.remaining, 0);
});

test("pushOutbox returns busy without double-processing when already running", async () => {
  await put("tasks", [task({ cid: "a", title: "A" })]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "task", cid: "a", payload: {} }]);
  let release;
  const gate = new Promise((res) => { release = res; });
  const tr = fakeTransport(() => ({ status: 201, data: { id: 1 } }));
  const slow = { request: (m, p, b) => gate.then(() => tr.request(m, p, b)) };
  const first = pushOutbox(slow);
  const second = await pushOutbox(slow);
  assert.equal(second.busy, true);
  release();
  await first;
});

test("pushOutbox create records base_rev from the server response updated_at", async () => {
  await put("tasks", [task({ cid: "a", title: "A" })]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "task", cid: "a", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 201, data: { id: 100, updated_at: "2026-06-04T09:00:00" } }));
  await pushOutbox(tr);
  const db = await openDB();
  const rec = await new Promise((res) => { const q = db.transaction("tasks").objectStore("tasks").get("a"); q.onsuccess = () => res(q.result); });
  assert.equal(rec.base_rev, "2026-06-04T09:00:00");
});

const { mapPut: _mapPutP } = require("../../static/offline/idmap.js");

test("pushOutbox skips an op whose record is flagged conflict (op kept, not pushed)", async () => {
  await put("tasks", [task({ cid: "a", server_id: 10, title: "A", conflict: "remote_deleted" })]);
  await _mapPutP("task", 10, "a");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "task", cid: "a", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 200, data: { id: 10 } }));
  const r = await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);
  assert.equal(r.pushed, 0);
  assert.equal(r.remaining, 1);
});

test("pushOutbox update 404 flags the record conflict and keeps the op", async () => {
  await put("tasks", [task({ cid: "a", server_id: 10, title: "A" })]);
  await _mapPutP("task", 10, "a");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "task", cid: "a", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 404, data: { detail: "gone" } }));
  const r = await pushOutbox(tr);
  const db = await openDB();
  const rec = await new Promise((res) => { const q = db.transaction("tasks").objectStore("tasks").get("a"); q.onsuccess = () => res(q.result); });
  assert.equal(rec.conflict, "remote_deleted");
  assert.equal(r.remaining, 1);
});
