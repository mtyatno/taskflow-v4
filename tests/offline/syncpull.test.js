"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut } = require("../../static/offline/idmap.js");
const { pullTasks } = require("../../static/offline/syncpull.js");
const { outboxAll, outboxAdd } = require("../../static/offline/outbox.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function putTasks(recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("tasks", "readwrite");
    const os = tx.objectStore("tasks");
    for (const r of recs) os.put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function allTasks() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction("tasks").objectStore("tasks").getAll();
    r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
  });
}
async function getTask(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("tasks").objectStore("tasks").get(cid); q.onsuccess = () => res(q.result); });
}
function local(over) {
  return Object.assign({
    cid: over.cid, server_id: null, title: over.cid, gtd_status: "next", base_rev: null,
    deleted: false, dirty: 0,
  }, over);
}
function srv(over) {
  return Object.assign({
    id: over.id, title: "T", description: "", gtd_status: "next", priority: "P3", quadrant: "Q4",
    project: "", context: "", deadline: null, waiting_for: "", completed_at: null, progress: 0,
    is_focused: 0, assigned_to: null, parent_id: null, list_id: null,
    recurrence_type: null, recurrence_days: null, recurrence_end_date: null, recurrence_notif_level: null,
    created_at: "2026-06-01T00:00:00", updated_at: "2026-06-04T00:00:00",
  }, over);
}

test("pullTasks creates a record for an unknown server task", async () => {
  const r = await pullTasks([srv({ id: 5, title: "New", updated_at: "2026-06-04T01:00:00" })]);
  assert.equal(r.created, 1);
  const rows = await allTasks();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].server_id, 5);
  assert.equal(rows[0].title, "New");
  assert.equal(rows[0].dirty, 0);
  assert.equal(rows[0].base_rev, "2026-06-04T01:00:00");
});

test("pullTasks updates a clean local record when server updated_at differs", async () => {
  await putTasks([local({ cid: "a", server_id: 10, title: "Old", base_rev: "2026-06-01T00:00:00" })]);
  await mapPut("task", 10, "a");
  const r = await pullTasks([srv({ id: 10, title: "Newer", updated_at: "2026-06-05T00:00:00" })]);
  assert.equal(r.updated, 1);
  const a = await getTask("a");
  assert.equal(a.title, "Newer");
  assert.equal(a.base_rev, "2026-06-05T00:00:00");
  assert.equal(a.dirty, 0);
});

test("pullTasks leaves unchanged records (same updated_at) alone", async () => {
  await putTasks([local({ cid: "a", server_id: 10, title: "Same", base_rev: "2026-06-04T00:00:00" })]);
  await mapPut("task", 10, "a");
  const r = await pullTasks([srv({ id: 10, title: "Same", updated_at: "2026-06-04T00:00:00" })]);
  assert.equal(r.updated, 0);
  assert.equal(r.created, 0);
});

test("pullTasks skips a dirty local record when the server is unchanged since base_rev", async () => {
  await putTasks([local({ cid: "a", server_id: 10, title: "Local edit", base_rev: "2026-06-05T00:00:00", dirty: 1 })]);
  await mapPut("task", 10, "a");
  const r = await pullTasks([srv({ id: 10, title: "Server", updated_at: "2026-06-05T00:00:00" })]);
  assert.equal(r.skipped, 1);
  assert.equal(r.updated, 0);
  assert.equal((await getTask("a")).title, "Local edit");
});

test("pullTasks deletes a clean local record whose server_id vanished", async () => {
  await putTasks([local({ cid: "a", server_id: 10, dirty: 0 })]);
  await mapPut("task", 10, "a");
  const r = await pullTasks([]);
  assert.equal(r.deleted, 1);
  assert.equal(await getTask("a"), undefined);
});

test("pullTasks does NOT delete a dirty local record missing from the server", async () => {
  await putTasks([local({ cid: "a", server_id: 10, dirty: 1 })]);
  await mapPut("task", 10, "a");
  const r = await pullTasks([]);
  assert.equal(r.deleted, 0);
  assert.equal(r.conflicts, 1);
  assert.notEqual(await getTask("a"), undefined);
});

test("pullTasks ignores local-only records (server_id null) when reconciling deletes", async () => {
  await putTasks([local({ cid: "b", server_id: null, dirty: 1 })]);
  const r = await pullTasks([]);
  assert.equal(r.deleted, 0);
  assert.notEqual(await getTask("b"), undefined);
});

test("pullTasks edit-vs-edit: server newer wins, overwrites local and drops outbox op", async () => {
  await putTasks([local({ cid: "a", server_id: 10, title: "Local", base_rev: "2026-06-01T00:00:00", updated_at: "2026-06-04T01:00:00.000Z", dirty: 1 })]);
  await mapPut("task", 10, "a");
  await outboxAdd({ op: "update", entity_type: "task", cid: "a", payload: {} });
  const r = await pullTasks([srv({ id: 10, title: "Server", updated_at: "2026-06-04T05:00:00" })]);
  assert.equal(r.lwwResolved, 1);
  assert.equal((await getTask("a")).title, "Server");
  assert.equal((await getTask("a")).dirty, 0);
  assert.equal((await outboxAll()).length, 0);
});

test("pullTasks edit-vs-edit: local newer wins, keeps local and outbox op", async () => {
  await putTasks([local({ cid: "a", server_id: 10, title: "Local", base_rev: "2026-06-01T00:00:00", updated_at: "2026-06-04T09:00:00.000Z", dirty: 1 })]);
  await mapPut("task", 10, "a");
  await outboxAdd({ op: "update", entity_type: "task", cid: "a", payload: {} });
  const r = await pullTasks([srv({ id: 10, title: "Server", updated_at: "2026-06-04T02:00:00" })]);
  assert.equal(r.lwwResolved, 1);
  assert.equal((await getTask("a")).title, "Local");
  assert.equal((await getTask("a")).dirty, 1);
  assert.equal((await outboxAll()).length, 1);
});

test("pullTasks edit-vs-delete: dirty local missing from server is flagged, not deleted", async () => {
  await putTasks([local({ cid: "a", server_id: 10, title: "Local edit", dirty: 1 })]);
  await mapPut("task", 10, "a");
  const r = await pullTasks([]);
  assert.equal(r.conflicts, 1);
  assert.equal(r.deleted, 0);
  assert.equal((await getTask("a")).conflict, "remote_deleted");
});

test("pullTasks skips an already-flagged conflict record", async () => {
  await putTasks([local({ cid: "a", server_id: 10, title: "Local", dirty: 1, conflict: "remote_deleted" })]);
  await mapPut("task", 10, "a");
  const r = await pullTasks([srv({ id: 10, title: "Server", updated_at: "2026-06-09T00:00:00" })]);
  assert.equal((await getTask("a")).title, "Local");
  assert.equal(r.skipped, 1);
});

test("pullTasks resolves parent_cid across the server batch", async () => {
  const r = await pullTasks([
    srv({ id: 1, title: "Parent" }),
    srv({ id: 2, title: "Kid", parent_id: 1 }),
  ]);
  assert.equal(r.created, 2);
  const rows = await allTasks();
  const parent = rows.find((x) => x.server_id === 1);
  const kid = rows.find((x) => x.server_id === 2);
  assert.equal(kid.parent_cid, parent.cid);
});

const { pullHabits } = require("../../static/offline/syncpull.js");
const { cidOf: _cidOfHp } = require("../../static/offline/idmap.js");

async function putHabits(recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("habits", "readwrite");
    const os = tx.objectStore("habits");
    for (const r of recs) os.put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function getHabitRec(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("habits").objectStore("habits").get(cid); q.onsuccess = () => res(q.result); });
}
async function allHabits() {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("habits").objectStore("habits").getAll(); q.onsuccess = () => res(q.result || []); });
}
function srvHabit(over) {
  return Object.assign({
    id: over.id, title: "H", phase: "pagi", micro_target: "",
    frequency: JSON.stringify(["mon"]), identity_pillar: "", created_at: "2026-06-01T00:00:00",
  }, over);
}

test("pullHabits creates an unknown server habit", async () => {
  const r = await pullHabits([srvHabit({ id: 3, title: "Lari" })]);
  assert.equal(r.created, 1);
  const rows = await allHabits();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].server_id, 3);
  assert.equal(rows[0].title, "Lari");
  assert.equal(rows[0].dirty, 0);
});

test("pullHabits treats frequency differing only by whitespace as unchanged", async () => {
  // local stores compact JSON (no spaces); server returns python json.dumps (with spaces)
  await putHabits([{ cid: "h", server_id: 3, title: "H", phase: "pagi", micro_target: "", frequency: '["mon","wed"]', identity_pillar: "", deleted: false, dirty: 0 }]);
  await mapPut("habit", 3, "h");
  const r = await pullHabits([srvHabit({ id: 3, title: "H", frequency: '["mon", "wed"]' })]);
  assert.equal(r.updated, 0);
  assert.equal(r.created, 0);
});

test("pullHabits updates a clean local habit when a field differs", async () => {
  await putHabits([{ cid: "h", server_id: 3, title: "Old", phase: "pagi", micro_target: "", frequency: JSON.stringify(["mon"]), identity_pillar: "", deleted: false, dirty: 0 }]);
  await mapPut("habit", 3, "h");
  const r = await pullHabits([srvHabit({ id: 3, title: "New" })]);
  assert.equal(r.updated, 1);
  assert.equal((await getHabitRec("h")).title, "New");
});

test("pullHabits skips a dirty local habit (local-wins)", async () => {
  await putHabits([{ cid: "h", server_id: 3, title: "Local edit", phase: "pagi", micro_target: "", frequency: JSON.stringify(["mon"]), identity_pillar: "", deleted: false, dirty: 1 }]);
  await mapPut("habit", 3, "h");
  const r = await pullHabits([srvHabit({ id: 3, title: "Server" })]);
  assert.equal(r.skipped, 1);
  assert.equal((await getHabitRec("h")).title, "Local edit");
});

test("pullHabits leaves an unchanged clean habit alone", async () => {
  await putHabits([{ cid: "h", server_id: 3, title: "H", phase: "pagi", micro_target: "", frequency: JSON.stringify(["mon"]), identity_pillar: "", deleted: false, dirty: 0 }]);
  await mapPut("habit", 3, "h");
  const r = await pullHabits([srvHabit({ id: 3, title: "H" })]);
  assert.equal(r.updated, 0);
  assert.equal(r.created, 0);
});

test("pullHabits hard-deletes a clean local habit whose server_id vanished + clears idmap", async () => {
  await putHabits([{ cid: "h", server_id: 3, title: "H", phase: "pagi", micro_target: "", frequency: JSON.stringify(["mon"]), identity_pillar: "", deleted: false, dirty: 0 }]);
  await mapPut("habit", 3, "h");
  const r = await pullHabits([]);
  assert.equal(r.deleted, 1);
  assert.equal(await getHabitRec("h"), undefined);
  assert.equal(await _cidOfHp("habit", 3), undefined);
});

test("pullHabits does NOT delete a dirty local habit missing from server", async () => {
  await putHabits([{ cid: "h", server_id: 3, title: "Local", phase: "pagi", micro_target: "", frequency: JSON.stringify(["mon"]), identity_pillar: "", deleted: false, dirty: 1 }]);
  await mapPut("habit", 3, "h");
  const r = await pullHabits([]);
  assert.equal(r.deleted, 0);
  assert.equal(r.skipped, 1);
  assert.notEqual(await getHabitRec("h"), undefined);
});

const { pullHabitLogs, pullHabitsAndLogs } = require("../../static/offline/syncpull.js");

async function putLogs(recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("habit_logs", "readwrite");
    const os = tx.objectStore("habit_logs");
    for (const r of recs) os.put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function logByHabitDate(habitCid, date) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("habit_logs").objectStore("habit_logs").index("habit_date").get([habitCid, date]); q.onsuccess = () => res(q.result); });
}

test("pullHabitLogs creates a new log mapped to the habit cid", async () => {
  await mapPut("habit", 3, "h");
  const r = await pullHabitLogs([{ habit_id: 3, date: "2026-06-05", status: "done", skip_reason: "" }]);
  assert.equal(r.created, 1);
  const log = await logByHabitDate("h", "2026-06-05");
  assert.equal(log.status, "done");
  assert.equal(log.dirty, 0);
});

test("pullHabitLogs upserts a clean local log when status differs", async () => {
  await mapPut("habit", 3, "h");
  await putLogs([{ cid: "L1", habit_cid: "h", date: "2026-06-05", status: "skipped", skip_reason: "", dirty: 0 }]);
  const r = await pullHabitLogs([{ habit_id: 3, date: "2026-06-05", status: "done", skip_reason: "" }]);
  assert.equal(r.updated, 1);
  assert.equal((await logByHabitDate("h", "2026-06-05")).status, "done");
});

test("pullHabitLogs skips a dirty local log (local-wins)", async () => {
  await mapPut("habit", 3, "h");
  await putLogs([{ cid: "L1", habit_cid: "h", date: "2026-06-05", status: "done", skip_reason: "", dirty: 1 }]);
  const r = await pullHabitLogs([{ habit_id: 3, date: "2026-06-05", status: "skipped", skip_reason: "" }]);
  assert.equal(r.skipped, 1);
  assert.equal((await logByHabitDate("h", "2026-06-05")).status, "done");
});

test("pullHabitsAndLogs pulls habits then logs from rawFetch", async () => {
  const rawFetch = (u) => {
    if (u === "/api/habits") return Promise.resolve({ json: () => Promise.resolve([srvHabit({ id: 3, title: "Lari" })]) });
    return Promise.resolve({ json: () => Promise.resolve([{ habit_id: 3, date: "2026-06-05", status: "done", skip_reason: "" }]) });
  };
  const r = await pullHabitsAndLogs(rawFetch);
  assert.equal(r.habits.created, 1);
  assert.equal(r.logs.created, 1);
  assert.equal((await logByHabitDate((await allHabits())[0].cid, "2026-06-05")).status, "done");
});

const { pullNotes } = require("../../static/offline/syncpull.js");
const { getEntityTags: _getTagsNp } = require("../../static/offline/tagrepo.js");
const { cidOf: _cidOfNp } = require("../../static/offline/idmap.js");

async function putNotes(recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("scratchpad_notes", "readwrite");
    const os = tx.objectStore("scratchpad_notes");
    for (const r of recs) os.put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function getNoteRec(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("scratchpad_notes").objectStore("scratchpad_notes").get(cid); q.onsuccess = () => res(q.result); });
}
async function allNotesP() {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("scratchpad_notes").objectStore("scratchpad_notes").getAll(); q.onsuccess = () => res(q.result || []); });
}
function srvNote(over) {
  return Object.assign({
    id: over.id, title: "N", content: "", tags: [], linked_to: [], linked_task_ids: [],
    pinned: false, list_id: null, created_at: "2026-06-01T00:00:00", updated_at: "2026-06-02T00:00:00",
  }, over);
}
function localNote(over) {
  return Object.assign({
    cid: over.cid, server_id: null, title: over.cid, content: "", linked_task_cids: "[]", linked_to_cids: "[]",
    pinned: false, list_id: null, created_at: null, updated_at: "2026-06-01T00:00:00", base_rev: "2026-06-01T00:00:00",
    deleted: false, dirty: 0,
  }, over);
}

test("pullNotes creates an unknown personal server note (dirty 0, base_rev, tags)", async () => {
  const r = await pullNotes([srvNote({ id: 5, title: "New", tags: ["x"], updated_at: "2026-06-03T00:00:00" })]);
  assert.equal(r.created, 1);
  const rows = await allNotesP();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].server_id, 5);
  assert.equal(rows[0].dirty, 0);
  assert.equal(rows[0].base_rev, "2026-06-03T00:00:00");
  const tags = await _getTagsNp("note", rows[0].cid);
  assert.deepEqual(tags.map((t) => t.name), ["x"]);
});

test("pullNotes skips shared notes (list_id != null)", async () => {
  const r = await pullNotes([srvNote({ id: 5, list_id: 9 })]);
  assert.equal(r.created, 0);
  assert.equal((await allNotesP()).length, 0);
});

test("pullNotes updates a clean local note when updated_at differs", async () => {
  await putNotes([localNote({ cid: "n", server_id: 5, title: "Old", base_rev: "2026-06-01T00:00:00" })]);
  await mapPut("note", 5, "n");
  const r = await pullNotes([srvNote({ id: 5, title: "New", updated_at: "2026-06-05T00:00:00" })]);
  assert.equal(r.updated, 1);
  assert.equal((await getNoteRec("n")).title, "New");
  assert.equal((await getNoteRec("n")).base_rev, "2026-06-05T00:00:00");
});

test("pullNotes edit-vs-edit LWW: server newer wins and drops outbox", async () => {
  await putNotes([localNote({ cid: "n", server_id: 5, title: "Local", base_rev: "2026-06-01T00:00:00", updated_at: "2026-06-04T01:00:00.000Z", dirty: 1 })]);
  await mapPut("note", 5, "n");
  await outboxAdd({ op: "update", entity_type: "note", cid: "n", payload: {} });
  const r = await pullNotes([srvNote({ id: 5, title: "Server", updated_at: "2026-06-04T05:00:00" })]);
  assert.equal(r.lwwResolved, 1);
  assert.equal((await getNoteRec("n")).title, "Server");
  assert.equal((await getNoteRec("n")).dirty, 0);
  assert.equal((await outboxAll()).length, 0);
});

test("pullNotes edit-vs-edit LWW: local newer wins and keeps local + outbox", async () => {
  await putNotes([localNote({ cid: "n", server_id: 5, title: "Local", base_rev: "2026-06-01T00:00:00", updated_at: "2026-06-04T09:00:00.000Z", dirty: 1 })]);
  await mapPut("note", 5, "n");
  await outboxAdd({ op: "update", entity_type: "note", cid: "n", payload: {} });
  const r = await pullNotes([srvNote({ id: 5, title: "Server", updated_at: "2026-06-04T02:00:00" })]);
  assert.equal((await getNoteRec("n")).title, "Local");
  assert.equal((await outboxAll()).length, 1);
});

test("pullNotes deletes a clean local note whose server_id vanished + clears idmap", async () => {
  await putNotes([localNote({ cid: "n", server_id: 5, dirty: 0 })]);
  await mapPut("note", 5, "n");
  const r = await pullNotes([]);
  assert.equal(r.deleted, 1);
  assert.equal(await getNoteRec("n"), undefined);
  assert.equal(await _cidOfNp("note", 5), undefined);
});

test("pullNotes does NOT delete a dirty local note missing from server", async () => {
  await putNotes([localNote({ cid: "n", server_id: 5, dirty: 1 })]);
  await mapPut("note", 5, "n");
  const r = await pullNotes([]);
  assert.equal(r.deleted, 0);
  assert.equal(r.skipped, 1);
  assert.notEqual(await getNoteRec("n"), undefined);
});

test("pullNotes resolves linked_to server ids to cids across the batch", async () => {
  const r = await pullNotes([
    srvNote({ id: 1, title: "A", linked_to: [2] }),
    srvNote({ id: 2, title: "B" }),
  ]);
  assert.equal(r.created, 2);
  const rows = await allNotesP();
  const a = rows.find((x) => x.server_id === 1);
  const bCid = await _cidOfNp("note", 2);
  assert.deepEqual(JSON.parse(a.linked_to_cids), [bCid]);
});
