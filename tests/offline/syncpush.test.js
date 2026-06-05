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

const { mapPut: _mapPutL, cidOf: _cidOfL } = require("../../static/offline/idmap.js");

test("taskToCreatePayload includes the record's list_id", () => {
  assert.equal(taskToCreatePayload(task({ cid: "a", title: "A", list_id: 9 }), [], null).list_id, 9);
  assert.equal(taskToCreatePayload(task({ cid: "a", title: "A" }), [], null).list_id, null);
});

test("pushOutbox update 403 (removed from list) deletes the task locally + idmap + op", async () => {
  await put("tasks", [task({ cid: "a", server_id: 10, title: "A", list_id: 7 })]);
  await _mapPutL("task", 10, "a");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "task", cid: "a", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 403, data: { detail: "Not a member" } }));
  const r = await pushOutbox(tr);
  const db = await openDB();
  const rec = await new Promise((res) => { const q = db.transaction("tasks").objectStore("tasks").get("a"); q.onsuccess = () => res(q.result); });
  assert.equal(rec, undefined);
  assert.equal(await _cidOfL("task", 10), undefined);
  assert.equal(r.remaining, 0);
});

const {
  habitToCreatePayload, habitToUpdatePayload, checkinPayload,
} = require("../../static/offline/syncpush.js");

function habit(over) {
  return Object.assign({
    cid: over.cid, server_id: null, title: over.cid, phase: "pagi", micro_target: "",
    frequency: JSON.stringify(["mon", "wed"]), identity_pillar: "", created_at: null,
    deleted: false, dirty: 1,
  }, over);
}

test("habitToCreatePayload reconstructs title+tags and parses frequency to array", () => {
  const p = habitToCreatePayload(habit({ cid: "h", title: "Lari", phase: "siang", micro_target: "5 menit", identity_pillar: "sehat" }), ["pagi_hari"]);
  assert.equal(p.title, "Lari #pagi_hari");
  assert.equal(p.phase, "siang");
  assert.equal(p.micro_target, "5 menit");
  assert.deepEqual(p.frequency, ["mon", "wed"]);
  assert.equal(p.identity_pillar, "sehat");
});

test("habitToUpdatePayload has the same shape as create", () => {
  const p = habitToUpdatePayload(habit({ cid: "h", title: "Baca" }), ["x"]);
  assert.equal(p.title, "Baca #x");
  assert.deepEqual(p.frequency, ["mon", "wed"]);
});

test("checkinPayload returns date/status/skip_reason", () => {
  assert.deepEqual(
    checkinPayload({ date: "2026-06-05", status: "done", skip_reason: "" }),
    { date: "2026-06-05", status: "done", skip_reason: "" }
  );
});

const { cidOf: _cidOfH, mapPut: _mapPutH } = require("../../static/offline/idmap.js");
const { setEntityTags: _setTagsH } = require("../../static/offline/tagrepo.js");

async function getHabit(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("habits").objectStore("habits").get(cid); q.onsuccess = () => res(q.result); });
}

test("pushOutbox habit create posts, sets server_id + idmap, removes op", async () => {
  await put("habits", [habit({ cid: "h", title: "Lari" })]);
  await _setTagsH("habit", "h", ["pagi_hari"]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "habit", cid: "h", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 200, data: { id: 50, title: "Lari" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(r.remaining, 0);
  assert.equal(tr.calls[0].method, "POST");
  assert.equal(tr.calls[0].path, "/api/habits");
  assert.equal(tr.calls[0].body.title, "Lari #pagi_hari");
  assert.equal(await serverIdOf("h"), 50);
  const rec = await getHabit("h");
  assert.equal(rec.server_id, 50);
  assert.equal(rec.dirty, 0);
});

test("pushOutbox skips a habit create whose record already has server_id", async () => {
  await put("habits", [habit({ cid: "h", server_id: 9, title: "Lari" })]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "habit", cid: "h", payload: {} }]);
  const tr = fakeTransport(() => { throw new Error("should not POST"); });
  const r = await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);
  assert.equal(r.remaining, 0);
});

test("pushOutbox habit update posts to /update and clears dirty", async () => {
  await put("habits", [habit({ cid: "h", server_id: 7, title: "Lari" })]);
  await _mapPutH("habit", 7, "h");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "habit", cid: "h", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 200, data: { ok: true, id: 7 } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[0].method, "POST");
  assert.equal(tr.calls[0].path, "/api/habits/7/update");
  assert.equal((await getHabit("h")).dirty, 0);
});

test("pushOutbox habit update 404 re-creates the habit and remaps server_id", async () => {
  await put("habits", [habit({ cid: "h", server_id: 7, title: "Lari" })]);
  await _mapPutH("habit", 7, "h");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "habit", cid: "h", payload: {} }]);
  let n = 0;
  const tr = fakeTransport((m, p) => {
    if (n++ === 0) return { status: 404, data: { detail: "gone" } };
    return { status: 200, data: { id: 88, title: "Lari" } };
  });
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[1].method, "POST");
  assert.equal(tr.calls[1].path, "/api/habits");
  assert.equal(await serverIdOf("h"), 88);
  assert.equal(await _cidOfH("habit", 7), undefined);
  const rec = await getHabit("h");
  assert.equal(rec.server_id, 88);
  assert.equal(rec.dirty, 0);
});

test("pushOutbox habit delete DELETEs, hard-deletes local + idmap", async () => {
  await put("habits", [habit({ cid: "h", server_id: 7, deleted: true })]);
  await _mapPutH("habit", 7, "h");
  await put("_outbox", [{ qid: 1, op: "delete", entity_type: "habit", cid: "h", payload: { cid: "h" } }]);
  const tr = fakeTransport(() => ({ status: 200, data: { ok: true } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[0].method, "DELETE");
  assert.equal(tr.calls[0].path, "/api/habits/7");
  assert.equal(await getHabit("h"), undefined);
  assert.equal(await _cidOfH("habit", 7), undefined);
});

test("pushOutbox habit delete with no server_id just drops op + local record", async () => {
  await put("habits", [habit({ cid: "h", deleted: true })]);
  await put("_outbox", [{ qid: 1, op: "delete", entity_type: "habit", cid: "h", payload: { cid: "h" } }]);
  const tr = fakeTransport(() => { throw new Error("should not call"); });
  const r = await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);
  assert.equal(r.remaining, 0);
  assert.equal(await getHabit("h"), undefined);
});

async function putLogRow(rec) { await put("habit_logs", [rec]); }
async function getLog(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("habit_logs").objectStore("habit_logs").get(cid); q.onsuccess = () => res(q.result); });
}

test("pushOutbox checkin resolves habit server_id and posts to /checkin", async () => {
  await put("habits", [habit({ cid: "h", server_id: 7 })]);
  await _mapPutH("habit", 7, "h");
  await putLogRow({ cid: "log1", habit_cid: "h", date: "2026-06-05", status: "done", skip_reason: "", dirty: 1 });
  await put("_outbox", [{ qid: 1, op: "checkin", entity_type: "habit_log", cid: "log1", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 200, data: { ok: true, habit_id: 7, date: "2026-06-05", status: "done" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[0].method, "POST");
  assert.equal(tr.calls[0].path, "/api/habits/7/checkin");
  assert.deepEqual(tr.calls[0].body, { date: "2026-06-05", status: "done", skip_reason: "" });
  assert.equal((await getLog("log1")).dirty, 0);
});

test("pushOutbox checkin drops op when the habit has no server_id (deleted)", async () => {
  await putLogRow({ cid: "log1", habit_cid: "gone", date: "2026-06-05", status: "done", skip_reason: "", dirty: 1 });
  await put("_outbox", [{ qid: 1, op: "checkin", entity_type: "habit_log", cid: "log1", payload: {} }]);
  const tr = fakeTransport(() => { throw new Error("should not call"); });
  const r = await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);
  assert.equal(r.remaining, 0);
});

test("pushOutbox HOLDS note ops (no push handler yet) without deleting them", async () => {
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "note", cid: "n1", payload: {} }]);
  const tr = fakeTransport(() => { throw new Error("should not call network for a note op"); });
  const r = await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);
  assert.equal(r.remaining, 1);
  assert.equal((await outboxAll()).length, 1);
});

const { noteToCreatePayload, noteToUpdatePayload } = require("../../static/offline/syncpush.js");

function note(over) {
  return Object.assign({
    cid: over.cid, server_id: null, title: over.cid, content: "",
    linked_task_cids: "[]", linked_to_cids: "[]", pinned: false, list_id: null,
    created_at: null, updated_at: null, deleted: false, dirty: 1, base_rev: null,
  }, over);
}

test("noteToCreatePayload builds the ScratchpadCreate body with tags + task server ids", () => {
  const p = noteToCreatePayload(note({ cid: "n", title: "Hi", content: "body [[X]]" }), ["work"], [42]);
  assert.equal(p.title, "Hi");
  assert.equal(p.content, "body [[X]]");
  assert.deepEqual(p.tags, ["work"]);
  assert.deepEqual(p.linked_task_ids, [42]);
  assert.equal(p.list_id, null);
});

test("noteToUpdatePayload has the same shape as create", () => {
  const p = noteToUpdatePayload(note({ cid: "n", title: "T", content: "c" }), ["a"], []);
  assert.equal(p.title, "T");
  assert.equal(p.content, "c");
  assert.deepEqual(p.tags, ["a"]);
  assert.deepEqual(p.linked_task_ids, []);
  assert.equal(p.list_id, null);
});
