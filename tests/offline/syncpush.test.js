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

test("taskToUpdatePayload sends an empty deadline so a cleared date clears on the server", () => {
  assert.equal(taskToUpdatePayload(task({ cid: "a", deadline: null }), []).deadline, "");
  assert.equal(taskToUpdatePayload(task({ cid: "a", deadline: "2026-10-20" }), []).deadline, "2026-10-20");
  // create keeps null (no deadline) since POST accepts it
  assert.equal(taskToCreatePayload(task({ cid: "a", deadline: null }), []).deadline, null);
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

test("pushOutbox drops a permanent 4xx op, counts it failed, and marks the record dirty + sync_error", async () => {
  await put("tasks", [task({ cid: "a", server_id: 10, title: "A" })]);
  const { mapPut } = require("../../static/offline/idmap.js");
  await mapPut("task", 10, "a");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "task", cid: "a", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 400, data: { detail: "bad request" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.failed, 1);
  assert.equal(r.remaining, 0);
  const db = await openDB();
  const rec = await new Promise((res) => { const q = db.transaction("tasks").objectStore("tasks").get("a"); q.onsuccess = () => res(q.result); });
  assert.equal(rec.dirty, 1); // perubahan lokal tidak dibuang
  assert.equal(rec.sync_error.status, 400);
  assert.equal(rec.sync_error.detail, "bad request");
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

test("pushOutbox update 403 (removed from list) flags the task access_lost, keeps local content, drops the op", async () => {
  await put("tasks", [task({ cid: "a", server_id: 10, title: "A", list_id: 7, description: "edit offline" })]);
  await _mapPutL("task", 10, "a");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "task", cid: "a", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 403, data: { detail: "Not a member" } }));
  const r = await pushOutbox(tr);
  const db = await openDB();
  const rec = await new Promise((res) => { const q = db.transaction("tasks").objectStore("tasks").get("a"); q.onsuccess = () => res(q.result); });
  assert.equal(rec.conflict, "access_lost"); // bukan dihapus (prinsip 1: tidak ada penghapusan diam-diam)
  assert.equal(rec.description, "edit offline");
  assert.equal(rec.dirty, 1);
  assert.equal(await _cidOfL("task", 10), "a"); // idmap tetap; resolveConflict yang membersihkan
  assert.equal(r.remaining, 0);
  assert.equal(r.failed, 1);
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

// K4 (workstream C): PUT tidak mengirim list_id (absen = server tidak mengubahnya) maupun client_id;
// base_rev disertakan bila record punya revisi server (prinsip 7 → 409 REV_MISMATCH bila basi).
test("noteToUpdatePayload omits list_id/client_id and carries base_rev when known", () => {
  const p = noteToUpdatePayload(note({ cid: "n", title: "T", content: "c", list_id: 9 }), ["a"], []);
  assert.equal(p.title, "T");
  assert.equal(p.content, "c");
  assert.deepEqual(p.tags, ["a"]);
  assert.deepEqual(p.linked_task_ids, []);
  assert.ok(!("list_id" in p), "list_id tidak boleh dikirim pada PUT");
  assert.ok(!("client_id" in p));
  assert.ok(!("base_rev" in p), "base_rev null → tidak dikirim (server memakai jalur lama)");
  const p2 = noteToUpdatePayload(note({ cid: "n", base_rev: "2026-10-15T10:00:00" }), [], []);
  assert.equal(p2.base_rev, "2026-10-15T10:00:00");
});

const { mapPut: _mapPutN, cidOf: _cidOfN } = require("../../static/offline/idmap.js");
const { setEntityTags: _setTagsN } = require("../../static/offline/tagrepo.js");

async function getNote(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("scratchpad_notes").objectStore("scratchpad_notes").get(cid); q.onsuccess = () => res(q.result); });
}

test("pushOutbox note create POSTs to /api/scratchpad, sets server_id + idmap + base_rev", async () => {
  await put("scratchpad_notes", [note({ cid: "n", title: "Hi", content: "x", linked_task_cids: '["tc"]' })]);
  await put("tasks", [{ cid: "tc", server_id: 88, title: "T", deleted: false }]);
  await _mapPutN("task", 88, "tc");
  await _setTagsN("note", "n", ["work"]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "note", cid: "n", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 200, data: { id: 50, updated_at: "2026-06-06T10:00:00" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[0].method, "POST");
  assert.equal(tr.calls[0].path, "/api/scratchpad");
  assert.deepEqual(tr.calls[0].body.tags, ["work"]);
  assert.deepEqual(tr.calls[0].body.linked_task_ids, [88]);
  assert.equal(await serverIdOf("n"), 50);
  const rec = await getNote("n");
  assert.equal(rec.server_id, 50);
  assert.equal(rec.dirty, 0);
  assert.equal(rec.base_rev, "2026-06-06T10:00:00");
});

test("pushOutbox note update PUTs and sets dirty 0 + base_rev", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, title: "T", content: "c" })]);
  await _mapPutN("note", 7, "n");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "note", cid: "n", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 200, data: { id: 7, updated_at: "2026-06-06T11:00:00" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[0].method, "PUT");
  assert.equal(tr.calls[0].path, "/api/scratchpad/7");
  const rec = await getNote("n");
  assert.equal(rec.dirty, 0);
  assert.equal(rec.base_rev, "2026-06-06T11:00:00");
});

test("pushOutbox note update 404 re-creates the note and remaps server_id", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, title: "T", content: "c" })]);
  await _mapPutN("note", 7, "n");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "note", cid: "n", payload: {} }]);
  let i = 0;
  const tr = fakeTransport(() => (i++ === 0 ? { status: 404, data: { detail: "gone" } } : { status: 200, data: { id: 99, updated_at: "2026-06-06T12:00:00" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[1].method, "POST");
  assert.equal(tr.calls[1].path, "/api/scratchpad");
  assert.equal(await serverIdOf("n"), 99);
  assert.equal(await _cidOfN("note", 7), undefined);
  const rec = await getNote("n");
  assert.equal(rec.server_id, 99);
  assert.equal(rec.dirty, 0);
});

test("pushOutbox note delete DELETEs, hard-deletes local + idmap", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, deleted: true })]);
  await _mapPutN("note", 7, "n");
  await put("_outbox", [{ qid: 1, op: "delete", entity_type: "note", cid: "n", payload: { cid: "n" } }]);
  const tr = fakeTransport(() => ({ status: 200, data: { ok: true } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[0].method, "DELETE");
  assert.equal(tr.calls[0].path, "/api/scratchpad/7");
  assert.equal(await getNote("n"), undefined);
  assert.equal(await _cidOfN("note", 7), undefined);
});

test("pushOutbox note delete with no server_id just drops op + local record", async () => {
  await put("scratchpad_notes", [note({ cid: "n", deleted: true })]);
  await put("_outbox", [{ qid: 1, op: "delete", entity_type: "note", cid: "n", payload: { cid: "n" } }]);
  const tr = fakeTransport(() => { throw new Error("should not call"); });
  const r = await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);
  assert.equal(r.remaining, 0);
  assert.equal(await getNote("n"), undefined);
});

test("pushOutbox note pin GETs then PATCHes /pin only when server differs", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, pinned: true })]);
  await _mapPutN("note", 7, "n");
  await put("_outbox", [{ qid: 1, op: "pin", entity_type: "note", cid: "n", payload: { pinned: true } }]);
  const tr = fakeTransport((m) => {
    if (m === "GET") return { status: 200, data: { id: 7, pinned: false } }; // server differs → must PATCH
    return { status: 200, data: { id: 7, pinned: true } };
  });
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[0].method, "GET");
  assert.equal(tr.calls[1].method, "PATCH");
  assert.equal(tr.calls[1].path, "/api/scratchpad/7/pin");
  assert.equal(r.remaining, 0);
});

test("pushOutbox note pin is a no-op PATCH when server already matches", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, pinned: true })]);
  await _mapPutN("note", 7, "n");
  await put("_outbox", [{ qid: 1, op: "pin", entity_type: "note", cid: "n", payload: { pinned: true } }]);
  const tr = fakeTransport(() => ({ status: 200, data: { id: 7, pinned: true } })); // already pinned
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls.length, 1); // only the GET, no PATCH
  assert.equal(tr.calls[0].method, "GET");
});

const { makeBlobStore: _mkBlobStore } = require("../../static/offline/blobstore.js");
const { outboxAdd: _outboxAddD } = require("../../static/offline/outbox.js");
const { mapPut: _mapPutD } = require("../../static/offline/idmap.js");

async function getDrawingRow(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("drawings").objectStore("drawings").get(cid); q.onsuccess = () => res(q.result); });
}
// Record legacy "gambar di dalam note" persis seperti yang ditulis putDrawing() versi lama (+ op upsert).
async function legacyNoteDrawing(cid, noteCid, dataJson) {
  const ref = await _mkBlobStore().put(dataJson, { mime: "application/json" });
  const db = await openDB();
  await new Promise((res) => { const tx = db.transaction("drawings", "readwrite"); tx.objectStore("drawings").put({ cid, note_cid: noteCid, blob_ref: ref, updated_at: "2026-06-06T00:00:00Z", deleted: false, dirty: 1, base_rev: null }); tx.oncomplete = res; });
  await _outboxAddD({ op: "upsert", entity_type: "drawing", cid, payload: { note_cid: noteCid } });
}

// S6 (workstream D): op upsert legacy TIDAK pernah lagi PUT ke /api/drawings/{noteSid} (id note ≠ id drawing).
// Record dikonversi menjadi drawing standalone dan di-POST sebagai drawing baru (client_id = cid).
test("pushOutbox drawing upsert (legacy) → converted to a standalone drawing and POSTed even without a note server id", async () => {
  await legacyNoteDrawing("dleg", "ncid", '{"store":{"x":1},"schema":{}}');
  const tr = fakeTransport(() => ({ status: 200, data: { id: 88, updated_at: "2026-06-06T12:00:00" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls.length, 1);
  assert.equal(tr.calls[0].method, "POST");
  assert.equal(tr.calls[0].path, "/api/drawings");
  assert.equal(tr.calls[0].body.data_json, '{"store":{"x":1},"schema":{}}');
  assert.equal(tr.calls[0].body.client_id, "dleg");
  const row = await getDrawingRow("dleg");
  assert.equal(row.note_cid, undefined);
  assert.equal(row.server_id, 88);
  assert.equal(row.dirty, 0);
  assert.equal(row.base_rev, "2026-06-06T12:00:00");
  assert.equal(r.remaining, 0);
});

test("pushOutbox drawing upsert (legacy) never PUTs /api/drawings/{noteSid} even when the note has a server id", async () => {
  await legacyNoteDrawing("dleg2", "ncid", '{"store":{"x":2},"schema":{}}');
  await _mapPutD("note", 70, "ncid"); // dulu: PUT /api/drawings/70 → menimpa drawing lain ber-id 70
  const tr = fakeTransport(() => ({ status: 200, data: { id: 89, updated_at: "2026-06-06T12:00:00" } }));
  await pushOutbox(tr);
  assert.ok(tr.calls.every((c) => c.method === "POST" && c.path === "/api/drawings"));
  assert.equal((await getDrawingRow("dleg2")).server_id, 89);
});

// ── Workstream A2 (audit 2026-10-15): T10 tahan op bergantung, T11 client_id, T12 recurrence_renew, K6 is_focused ──
const { pendingCreateCids } = require("../../static/offline/syncpush.js");
const { mapPut: _mapPutA2 } = require("../../static/offline/idmap.js");

async function getRec(store, cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction(store).objectStore(store).get(cid); q.onsuccess = () => res(q.result); });
}

test("T11: create payloads carry client_id (= cid, or the record's own client_id for 'keep as new' copies)", () => {
  assert.equal(taskToCreatePayload(task({ cid: "a" }), [], null).client_id, "a");
  assert.equal(taskToCreatePayload(task({ cid: "a", client_id: "fresh" }), [], null).client_id, "fresh");
  assert.equal("client_id" in taskToUpdatePayload(task({ cid: "a" }), []), false);
  assert.equal(habitToCreatePayload(habit({ cid: "h" }), []).client_id, "h");
  assert.equal(habitToCreatePayload(habit({ cid: "h", client_id: "fresh" }), []).client_id, "fresh");
  assert.equal("client_id" in habitToUpdatePayload(habit({ cid: "h" }), []), false);
  assert.equal(noteToCreatePayload(note({ cid: "n" }), [], []).client_id, "n");
  assert.equal(noteToCreatePayload(note({ cid: "n", client_id: "fresh" }), [], []).client_id, "fresh");
});

test("K6: taskToUpdatePayload sends is_focused as a boolean", () => {
  assert.equal(taskToUpdatePayload(task({ cid: "a", is_focused: 1 }), []).is_focused, true);
  assert.equal(taskToUpdatePayload(task({ cid: "a", is_focused: 0 }), []).is_focused, false);
  assert.equal(taskToUpdatePayload(task({ cid: "a" }), []).is_focused, false);
});

test("T12: taskToUpdatePayload includes recurrence_renew only while recurrence_renew_pending is set; PUT success clears it and adopts the server end date", async () => {
  assert.equal("recurrence_renew" in taskToUpdatePayload(task({ cid: "a" }), []), false);
  assert.equal(taskToUpdatePayload(task({ cid: "a", recurrence_renew_pending: 1 }), []).recurrence_renew, true);
  await put("tasks", [task({ cid: "a", server_id: 10, recurrence_type: "daily", recurrence_end_date: "2027-01-13", recurrence_renew_pending: 1, rev: 2 })]);
  await _mapPutA2("task", 10, "a");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "task", cid: "a", payload: {} }]);
  const tr = fakeTransport((m, p, b) => {
    assert.equal(b.recurrence_renew, true);
    return { status: 200, data: { id: 10, updated_at: "2026-10-15T10:00:00", recurrence_end_date: "2027-01-14", recurrence_notif_level: null, quadrant: "Q2" } };
  });
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  const rec = await getRec("tasks", "a");
  assert.equal(rec.recurrence_renew_pending, undefined);
  assert.equal(rec.recurrence_end_date, "2027-01-14");
  assert.equal(rec.dirty, 0);
});

test("T12: taskrepo.updateTask({recurrence_renew:true}) sets recurrence_renew_pending", async () => {
  const taskrepo = require("../../static/offline/taskrepo.js");
  const t = await taskrepo.createTask({ title: "R", recurrence_type: "daily" }, { now: "2026-10-15T00:00:00.000Z", today: "2026-10-15" });
  await taskrepo.updateTask(t.cid, { recurrence_renew: true }, { now: "2026-10-15T00:01:00.000Z", today: "2026-10-15" });
  const rec = await getRec("tasks", t.cid);
  assert.equal(rec.recurrence_renew_pending, 1);
  assert.equal(rec.recurrence_end_date, "2027-01-13");
});

test("T10: pendingCreateCids collects cids with a create (or chat send) op", () => {
  const s = pendingCreateCids([
    { op: "create", entity_type: "task", cid: "a" }, { op: "update", entity_type: "task", cid: "b" },
    { op: "send", entity_type: "message", cid: "m" }, { op: "checkin", entity_type: "habit_log", cid: "l" },
  ]);
  assert.deepEqual([...s].sort(), ["a", "m"]);
});

test("T10: habit checkin/uncheck and mark_occurrence are HELD while the parent create is still queued (parent 503), not dropped", async () => {
  await put("habits", [habit({ cid: "h", title: "H" })]);
  await putLogRow({ cid: "log1", habit_cid: "h", date: "2026-10-14", status: "done", skip_reason: "", dirty: 1 });
  await put("tasks", [task({ cid: "r", title: "R", recurrence_type: "daily" })]);
  await put("_outbox", [
    { qid: 1, op: "create", entity_type: "habit", cid: "h", payload: {} },
    { qid: 2, op: "checkin", entity_type: "habit_log", cid: "log1", payload: {} },
    { qid: 3, op: "uncheck", entity_type: "habit_log", cid: "u1", payload: { habit_cid: "h", date: "2026-10-13", status: "uncheck" } },
    { qid: 4, op: "create", entity_type: "task", cid: "r", payload: {} },
    { qid: 5, op: "mark_occurrence", entity_type: "recurring_exception", cid: "x", payload: { task_cid: "r", occurrence_date: "2026-10-14", status: "done" } },
  ]);
  // server sibuk: kedua create gagal sementara → op anak harus tetap antre
  const tr = fakeTransport(() => ({ status: 503, data: {} }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 0);
  assert.equal(tr.calls.length, 2, "hanya dua POST create; op anak tidak dikirim & tidak dibuang");
  assert.equal((await outboxAll()).length, 5);
  // server pulih: create lalu anaknya dalam SATU drain (induk lebih dulu di FIFO)
  const tr2 = fakeTransport((m, p) => {
    if (p === "/api/habits") return { status: 200, data: { id: 50 } };
    if (p === "/api/tasks") return { status: 201, data: { id: 60, updated_at: "u" } };
    return { status: 200, data: { ok: true } };
  });
  const r2 = await pushOutbox(tr2);
  assert.equal(r2.pushed, 5);
  assert.deepEqual(tr2.calls.map((c) => c.path), ["/api/habits", "/api/habits/50/checkin", "/api/habits/50/checkin", "/api/tasks", "/api/tasks/60/occurrences/2026-10-14/mark"]);
  assert.equal((await outboxAll()).length, 0);
});

test("T10: dependent ops are dropped only when the parent has no create op at all (no deadlock)", async () => {
  await putLogRow({ cid: "log1", habit_cid: "gone", date: "2026-10-14", status: "done", skip_reason: "", dirty: 1 });
  await put("_outbox", [
    { qid: 1, op: "checkin", entity_type: "habit_log", cid: "log1", payload: {} },
    { qid: 2, op: "mark_occurrence", entity_type: "recurring_exception", cid: "x", payload: { task_cid: "no-task", occurrence_date: "2026-10-14", status: "done" } },
  ]);
  const tr = fakeTransport(() => { throw new Error("should not call"); });
  const r = await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);
  assert.equal(r.remaining, 0);
});

test("T10: a child task create is held while the parent's create is queued, then sent with the real parent_id", async () => {
  await put("tasks", [task({ cid: "par", title: "Parent" }), task({ cid: "kid", title: "Kid", parent_cid: "par" })]);
  await put("_outbox", [
    { qid: 1, op: "create", entity_type: "task", cid: "par", payload: {} },
    { qid: 2, op: "create", entity_type: "task", cid: "kid", payload: {} },
  ]);
  // induk gagal sementara (503 → op tetap), anak harus ditahan — bukan dikirim dengan parent_id null
  const tr = fakeTransport(() => ({ status: 503, data: {} }));
  const r = await pushOutbox(tr);
  assert.equal(tr.calls.length, 1, "anak ditahan");
  assert.equal(r.remaining, 2);
  let next = 500;
  const tr2 = fakeTransport(() => ({ status: 201, data: { id: next++ } }));
  const r2 = await pushOutbox(tr2);
  assert.equal(r2.pushed, 2);
  assert.equal(tr2.calls[1].body.parent_id, 500);
});

test("T10: a child task whose parent has no create op (permanent failure earlier) is sent with parent_id null", async () => {
  await put("tasks", [task({ cid: "par", title: "Parent", sync_error: { status: 422, detail: "x", at: "t" } }), task({ cid: "kid", title: "Kid", parent_cid: "par" })]);
  await put("_outbox", [{ qid: 2, op: "create", entity_type: "task", cid: "kid", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 201, data: { id: 9 } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[0].body.parent_id, null);
});

test("a task created then deleted offline is never POSTed (create op dropped, delete op ends locally)", async () => {
  await put("tasks", [task({ cid: "a", title: "A", deleted: true })]);
  await put("_outbox", [
    { qid: 1, op: "create", entity_type: "task", cid: "a", payload: {} },
    { qid: 2, op: "delete", entity_type: "task", cid: "a", payload: { cid: "a" } },
  ]);
  const tr = fakeTransport(() => { throw new Error("should not call"); });
  const r = await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);
  assert.equal(r.remaining, 0);
});

test("task payloads carry estimated_pomodoros only when set, never pomodoros_done", () => {
  const rec = task({ cid: "a", estimated_pomodoros: 4, pomodoros_done: 9 });
  for (const p of [taskToCreatePayload(rec, []), taskToUpdatePayload(rec, [])]) {
    assert.equal(p.estimated_pomodoros, 4);
    assert.equal("pomodoros_done" in p, false);
  }
  const old = task({ cid: "b", pomodoros_done: 2 });
  for (const p of [taskToCreatePayload(old, []), taskToUpdatePayload(old, [])]) {
    assert.equal("estimated_pomodoros" in p, false);
    assert.equal("pomodoros_done" in p, false);
  }
});
