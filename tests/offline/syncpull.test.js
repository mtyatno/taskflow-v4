"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut } = require("../../static/offline/idmap.js");
const { pullTasks, pullAndReconcile } = require("../../static/offline/syncpull.js");
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
  await outboxAdd({ op: "update", entity_type: "task", cid: "a", payload: {} });
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
  await outboxAdd({ op: "update", entity_type: "task", cid: "a", payload: {} });
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
  await outboxAdd({ op: "update", entity_type: "task", cid: "a", payload: {} });
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

test("pullNotes includes shared notes (list_id != null) and carries list_id", async () => {
  const r = await pullNotes([srvNote({ id: 5, list_id: 9 })]);
  assert.equal(r.created, 1);
  const rows = await allNotesP();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].list_id, 9);
});

test("pullNotes updates a clean local note when updated_at differs", async () => {
  await putNotes([localNote({ cid: "n", server_id: 5, title: "Old", base_rev: "2026-06-01T00:00:00" })]);
  await mapPut("note", 5, "n");
  const r = await pullNotes([srvNote({ id: 5, title: "New", updated_at: "2026-06-05T00:00:00" })]);
  assert.equal(r.updated, 1);
  assert.equal((await getNoteRec("n")).title, "New");
  assert.equal((await getNoteRec("n")).base_rev, "2026-06-05T00:00:00");
});

// Prinsip 7 (audit 2026-10-15, workstream C): edit-vs-edit tidak lagi LWW — versi lokal SELALU disimpan sebagai
// salinan konflik "(konflik) <judul>" (note pribadi baru + op create), record asli mengadopsi versi server.
test("pullNotes edit-vs-edit (server newer): local kept as conflict copy, original adopts server, original ops dropped", async () => {
  await putNotes([localNote({ cid: "n", server_id: 5, title: "Local", content: "isi lokal", base_rev: "2026-06-01T00:00:00", updated_at: "2026-06-04T01:00:00.000Z", dirty: 1 })]);
  await mapPut("note", 5, "n");
  await outboxAdd({ op: "update", entity_type: "note", cid: "n", payload: {} });
  const r = await pullNotes([srvNote({ id: 5, title: "Server", content: "isi server", updated_at: "2026-06-04T05:00:00" })]);
  assert.equal(r.lwwResolved, 1);
  assert.equal(r.conflictCopies, 1);
  const orig = await getNoteRec("n");
  assert.equal(orig.title, "Server");
  assert.equal(orig.content, "isi server");
  assert.equal(orig.dirty, 0);
  assert.equal(orig.base_rev, "2026-06-04T05:00:00");
  assert.equal(orig.notice.kind, "conflict_copy");
  const copy = (await allNotesP()).find((n) => n.cid !== "n");
  assert.ok(copy, "salinan konflik harus ada");
  assert.equal(copy.title, "(konflik) Local");
  assert.equal(copy.content, "isi lokal");
  assert.equal(copy.server_id, null);
  assert.equal(copy.dirty, 1);
  const ops = await outboxAll();
  assert.deepEqual(ops.map((o) => [o.op, o.cid]), [["create", copy.cid]]);
  assert.ok(r.changedCids.includes("n") && r.changedCids.includes(copy.cid));
});

test("pullNotes edit-vs-edit (local newer): still a conflict copy — no side is dropped", async () => {
  await putNotes([localNote({ cid: "n", server_id: 5, title: "Local", base_rev: "2026-06-01T00:00:00", updated_at: "2026-06-04T09:00:00.000Z", dirty: 1 })]);
  await mapPut("note", 5, "n");
  await outboxAdd({ op: "update", entity_type: "note", cid: "n", payload: {} });
  await pullNotes([srvNote({ id: 5, title: "Server", updated_at: "2026-06-04T02:00:00" })]);
  assert.equal((await getNoteRec("n")).title, "Server");
  const titles = (await allNotesP()).map((n) => n.title).sort();
  assert.deepEqual(titles, ["(konflik) Local", "Server"]);
  assert.equal((await outboxAll()).length, 1); // hanya create salinan
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
  await outboxAdd({ op: "update", entity_type: "note", cid: "n", payload: {} });
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

const { pullNotesAndReconcile } = require("../../static/offline/syncpull.js");

test("pullNotes adopts server pinned for a clean note with no pending pin op", async () => {
  await putNotes([localNote({ cid: "n", server_id: 5, base_rev: "2026-06-02T00:00:00", pinned: false })]);
  await mapPut("note", 5, "n");
  const r = await pullNotes([srvNote({ id: 5, pinned: true, updated_at: "2026-06-02T00:00:00" })]); // updated_at unchanged → only pin differs
  assert.equal(r.pinned, 1);
  assert.equal((await getNoteRec("n")).pinned, true);
});

test("pullNotes does NOT adopt server pinned when a pin op is pending", async () => {
  await putNotes([localNote({ cid: "n", server_id: 5, base_rev: "2026-06-02T00:00:00", pinned: true })]);
  await mapPut("note", 5, "n");
  await outboxAdd({ op: "pin", entity_type: "note", cid: "n", payload: { pinned: true } });
  const r = await pullNotes([srvNote({ id: 5, pinned: false, updated_at: "2026-06-02T00:00:00" })]);
  assert.equal(r.pinned, 0);
  assert.equal((await getNoteRec("n")).pinned, true); // local pin intent preserved
});

test("pullNotesAndReconcile fetches /api/scratchpad and reconciles", async () => {
  const rawFetch = () => Promise.resolve({ json: () => Promise.resolve([srvNote({ id: 5, title: "P", updated_at: "2026-06-03T00:00:00" })]) });
  const r = await pullNotesAndReconcile(rawFetch);
  assert.equal(r.created, 1);
  assert.equal((await allNotesP()).length, 1);
});

test("pullNotes cleans up duplicate local rows with same server_id but different cid", async () => {
  await putNotes([
    localNote({ cid: "note-canonical", server_id: 10, title: "Canonical", base_rev: "2026-06-01T00:00:00" }),
    localNote({ cid: "note-dup-1", server_id: 10, title: "Duplicate Phantom 1", base_rev: "2026-06-01T00:00:00" }),
    localNote({ cid: "note-dup-2", server_id: 10, title: "Duplicate Phantom 2", base_rev: "2026-06-01T00:00:00" }),
  ]);
  await mapPut("note", 10, "note-canonical");

  const r = await pullNotes([srvNote({ id: 10, title: "Updated Server Note", updated_at: "2026-06-05T00:00:00" })]);
  assert.equal(r.updated, 1);

  const rows = await allNotesP();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cid, "note-canonical");
  assert.equal(rows[0].title, "Updated Server Note");

  assert.equal(await getNoteRec("note-dup-1"), undefined);
  assert.equal(await getNoteRec("note-dup-2"), undefined);
  assert.equal(await _cidOfNp("note", 10), "note-canonical");
});

test("pullNotes repairs missing idmap using existing local note with matching server_id", async () => {
  await putNotes([
    localNote({ cid: "note-existing", server_id: 25, title: "Existing Local Note", base_rev: "2026-06-01T00:00:00" }),
  ]);
  // Note: idmap is intentionally empty for server_id 25
  assert.equal(await _cidOfNp("note", 25), undefined);

  const r = await pullNotes([srvNote({ id: 25, title: "Server Note 25", updated_at: "2026-06-05T00:00:00" })]);
  assert.equal(r.updated, 1);

  // Verify idmap has been repaired
  assert.equal(await _cidOfNp("note", 25), "note-existing");

  const rows = await allNotesP();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cid, "note-existing");
  assert.equal(rows[0].title, "Server Note 25");
});

test("pullNotes repairs missing idmap and cleans up phantom duplicates simultaneously", async () => {
  await putNotes([
    localNote({ cid: "note-first", server_id: 50, title: "First Note", base_rev: "2026-06-01T00:00:00" }),
    localNote({ cid: "note-second", server_id: 50, title: "Second Duplicate", base_rev: "2026-06-01T00:00:00" }),
  ]);
  // idmap is empty
  assert.equal(await _cidOfNp("note", 50), undefined);

  const r = await pullNotes([srvNote({ id: 50, title: "Server Note 50", updated_at: "2026-06-05T00:00:00" })]);
  assert.equal(r.updated, 1);

  assert.equal(await _cidOfNp("note", 50), "note-first");

  const rows = await allNotesP();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cid, "note-first");
  assert.equal(rows[0].title, "Server Note 50");
  assert.equal(await getNoteRec("note-second"), undefined);
});

const { pullMindmaps } = require("../../static/offline/syncpull.js");

async function putMindmaps(recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("mindmaps", "readwrite");
    const os = tx.objectStore("mindmaps");
    for (const r of recs) os.put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function getMindmapRec(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("mindmaps").objectStore("mindmaps").get(cid); q.onsuccess = () => res(q.result); });
}

test("pullTasks restores a stale tombstone (deleted: true, dirty: 0)", async () => {
  await putTasks([local({ cid: "t-stale", server_id: 10, title: "Deleted Task", deleted: true, dirty: 0, base_rev: "2026-06-01T00:00:00" })]);
  await mapPut("task", 10, "t-stale");

  const r = await pullTasks([srv({ id: 10, title: "Server Restored Task", updated_at: "2026-06-01T00:00:00" })]);
  assert.equal(r.created, 1);

  const task = await getTask("t-stale");
  assert.equal(task.deleted, false);
  assert.equal(task.dirty, 0);
  assert.equal(task.title, "Server Restored Task");
});

test("pullNotes restores a local note with deleted: true and dirty: 0 even when server updated_at == base_rev", async () => {
  await putNotes([localNote({ cid: "n-stale", server_id: 10, title: "Deleted Note", deleted: true, dirty: 0, base_rev: "2026-06-01T00:00:00", updated_at: "2026-06-01T00:00:00" })]);
  await mapPut("note", 10, "n-stale");

  const r = await pullNotes([srvNote({ id: 10, title: "Server Restored Note", updated_at: "2026-06-01T00:00:00" })]);
  assert.equal(r.created, 1);

  const note = await getNoteRec("n-stale");
  assert.equal(note.deleted, false);
  assert.equal(note.dirty, 0);
  assert.equal(note.title, "Server Restored Note");
});

test("pullMindmaps restores a stale tombstone (deleted: true, dirty: 0)", async () => {
  await putMindmaps([{ cid: "m-stale", server_id: 10, title: "Deleted Mindmap", data_json: "{}", pinned: false, list_id: null, created_at: "2026-06-01T00:00:00", updated_at: "2026-06-01T00:00:00", deleted: true, dirty: 0, base_rev: "2026-06-01T00:00:00" }]);
  await mapPut("mindmap", 10, "m-stale");

  const rows = [{ id: 10, title: "Server Restored Mindmap", is_pinned: 0, list_id: null, created_at: "2026-06-01T00:00:00", updated_at: "2026-06-01T00:00:00" }];
  const fetchOne = (sid) => Promise.resolve({ id: 10, title: "Server Restored Mindmap", is_pinned: 0, list_id: null, data_json: "{\"nodeData\":{\"id\":\"root\"}}", created_at: "2026-06-01T00:00:00", updated_at: "2026-06-01T00:00:00" });

  const r = await pullMindmaps(rows, fetchOne);
  assert.equal(r.created, 1);

  const mm = await getMindmapRec("m-stale");
  assert.equal(mm.deleted, false);
  assert.equal(mm.dirty, 0);
  assert.equal(mm.title, "Server Restored Mindmap");
  assert.match(mm.data_json, /root/);
});

test("pullTasks restores a tombstone with deleted: true and dirty: 1 when outbox has NO pending op", async () => {
  await putTasks([local({ cid: "t-dirty-stale", server_id: 11, title: "Deleted Dirty Task", deleted: true, dirty: 1, base_rev: "2026-06-01T00:00:00" })]);
  await mapPut("task", 11, "t-dirty-stale");

  const r = await pullTasks([srv({ id: 11, title: "Server Restored Task", updated_at: "2026-06-01T00:00:00" })]);
  assert.equal(r.created, 1);

  const task = await getTask("t-dirty-stale");
  assert.equal(task.deleted, false);
  assert.equal(task.dirty, 0);
  assert.equal(task.title, "Server Restored Task");
});

test("pullNotes restores a local note with deleted: true and dirty: 1 when outbox has NO pending op", async () => {
  await putNotes([localNote({ cid: "n-dirty-stale", server_id: 11, title: "Deleted Dirty Note", deleted: true, dirty: 1, base_rev: "2026-06-01T00:00:00", updated_at: "2026-06-01T00:00:00" })]);
  await mapPut("note", 11, "n-dirty-stale");

  const r = await pullNotes([srvNote({ id: 11, title: "Server Restored Note", updated_at: "2026-06-01T00:00:00" })]);
  assert.equal(r.created, 1);

  const note = await getNoteRec("n-dirty-stale");
  assert.equal(note.deleted, false);
  assert.equal(note.dirty, 0);
  assert.equal(note.title, "Server Restored Note");
});

test("pullMindmaps restores a tombstone with deleted: true and dirty: 1 when outbox has NO pending op", async () => {
  await putMindmaps([{ cid: "m-dirty-stale", server_id: 11, title: "Deleted Dirty Mindmap", data_json: "{}", pinned: false, list_id: null, created_at: "2026-06-01T00:00:00", updated_at: "2026-06-01T00:00:00", deleted: true, dirty: 1, base_rev: "2026-06-01T00:00:00" }]);
  await mapPut("mindmap", 11, "m-dirty-stale");

  const rows = [{ id: 11, title: "Server Restored Mindmap", is_pinned: 0, list_id: null, created_at: "2026-06-01T00:00:00", updated_at: "2026-06-01T00:00:00" }];
  const fetchOne = (sid) => Promise.resolve({ id: 11, title: "Server Restored Mindmap", is_pinned: 0, list_id: null, data_json: "{\"nodeData\":{\"id\":\"root\"}}", created_at: "2026-06-01T00:00:00", updated_at: "2026-06-01T00:00:00" });

  const r = await pullMindmaps(rows, fetchOne);
  assert.equal(r.created, 1);

  const mm = await getMindmapRec("m-dirty-stale");
  assert.equal(mm.deleted, false);
  assert.equal(mm.dirty, 0);
  assert.equal(mm.title, "Server Restored Mindmap");
  assert.match(mm.data_json, /root/);
});

test("pullNotes skips a deleted note when outbox has a pending op for that note", async () => {
  await putNotes([localNote({ cid: "n-pending-del", server_id: 12, title: "Pending Del Note", deleted: true, dirty: 1, base_rev: "2026-06-01T00:00:00", updated_at: "2026-06-01T00:00:00" })]);
  await mapPut("note", 12, "n-pending-del");
  await outboxAdd({ op: "delete", entity_type: "note", cid: "n-pending-del", payload: {} });

  const r = await pullNotes([srvNote({ id: 12, title: "Server Note", updated_at: "2026-06-01T00:00:00" })]);
  assert.equal(r.skipped, 1);
  assert.equal(r.created, 0);

  const note = await getNoteRec("n-pending-del");
  assert.equal(note.deleted, true);
  assert.equal(note.dirty, 1);
});




test("pullTasks adopts server pomodoros_done on a clean record with same updated_at", async () => {
  await putTasks([local({ cid: "pd", server_id: 70, pomodoros_done: 1, base_rev: "2026-06-04T00:00:00", updated_at: "2026-06-04T00:00:00" })]);
  await mapPut("task", 70, "pd");
  const r = await pullTasks([srv({ id: 70, pomodoros_done: 4 })]);
  assert.equal((await getTask("pd")).pomodoros_done, 4);
  assert.equal(r.derived, 1);
});

test("pullTasks leaves pomodoros_done of a dirty record with a pending op", async () => {
  await putTasks([local({ cid: "pe", server_id: 71, pomodoros_done: 1, dirty: 1, rev: 2, base_rev: "2026-06-04T00:00:00", updated_at: "2026-06-04T00:00:00" })]);
  await mapPut("task", 71, "pe");
  await outboxAdd({ op: "update", entity_type: "task", cid: "pe", payload: {} });
  await pullTasks([srv({ id: 71, pomodoros_done: 4 })]);
  assert.equal((await getTask("pe")).pomodoros_done, 1);
});

// Checklist bertingkat (spec §9, ADR-048): progress dan checklist_total = field turunan server (tanpa bump updated_at).
test("pullTasks mengadopsi progress dan checklist_total pada record bersih dengan updated_at sama", async () => {
  await putTasks([local({ cid: "ck", quadrant: "Q4", project: "", server_id: 72, progress: 10, checklist_total: 0, base_rev: "2026-06-04T00:00:00", updated_at: "2026-06-04T00:00:00" })]);
  await mapPut("task", 72, "ck");
  const r = await pullTasks([srv({ id: 72, progress: 33, checklist_total: 3 })]);
  const rec = await getTask("ck");
  assert.deepEqual([rec.progress, rec.checklist_total], [33, 3]);
  assert.deepEqual([rec.dirty, rec.base_rev], [0, "2026-06-04T00:00:00"]);
  assert.equal(r.derived, 1);
});

test("pullTasks tidak mengadopsi progress/checklist_total pada record dirty dengan op tertunda", async () => {
  await putTasks([local({ cid: "cl", quadrant: "Q4", project: "", server_id: 73, progress: 10, checklist_total: 0, dirty: 1, rev: 2, base_rev: "2026-06-04T00:00:00", updated_at: "2026-06-04T00:00:00" })]);
  await mapPut("task", 73, "cl");
  await outboxAdd({ op: "update", entity_type: "task", cid: "cl", payload: {} });
  await pullTasks([srv({ id: 73, progress: 33, checklist_total: 3 })]);
  const rec = await getTask("cl");
  assert.deepEqual([rec.progress, rec.checklist_total, rec.dirty], [10, 0, 1]);
});

test("pullTasks: dict server tanpa checklist_total tidak mengubah checklist_total lokal", async () => {
  await putTasks([local({ cid: "cm", quadrant: "Q4", project: "", server_id: 74, progress: 60, checklist_total: 5, base_rev: "2026-06-04T00:00:00", updated_at: "2026-06-04T00:00:00" })]);
  await mapPut("task", 74, "cm");
  const r = await pullTasks([srv({ id: 74, progress: 60 })]);
  assert.equal((await getTask("cm")).checklist_total, 5);
  assert.equal(r.derived, 0);
});

test("pullTasks: progress/checklist_total lokal yang belum ada setara 0 (tanpa tulis ulang massal)", async () => {
  await putTasks([local({ cid: "cn", quadrant: "Q4", project: "", server_id: 75, base_rev: "2026-06-04T00:00:00", updated_at: "2026-06-04T00:00:00" })]);
  await mapPut("task", 75, "cn");
  const r = await pullTasks([srv({ id: 75, progress: 0, checklist_total: 0 })]);
  assert.equal(r.derived, 0);
});

// Balapan pull vs adoptTaskProgress (review S1): daftar server dibaca SEBELUM centang (progress 33); respons centang
// diadopsi (67) di antara snapshot pull dan mutate-nya. Pull tidak boleh menimpa 67 dengan nilai basi, dan hanya
// menulis kunci turunan yang memang berbeda. Hook deterministik: adopsi dijalankan tepat sebelum mutate pull.
const TFdbMod = require("../../static/offline/db.js");
const TFchecklist = require("../../static/offline/checklist.js");
async function pullDenganAdopsiDiTengah(list, cid, serverId, tp) {
  const asli = TFdbMod.mutate;
  let sudah = false;
  TFdbMod.mutate = function (store, key, fn) {
    if (!sudah && store === "tasks" && key === cid) {
      sudah = true;
      return TFchecklist.adoptTaskProgress(serverId, tp).then(() => asli.call(TFdbMod, store, key, fn));
    }
    return asli.call(TFdbMod, store, key, fn);
  };
  try { return await pullTasks(list); } finally { TFdbMod.mutate = asli; assert.equal(sudah, true, "hook harus terpicu"); }
}

test("pullTasks tidak menimpa progress yang diadopsi setelah snapshot dengan nilai basi dari daftar", async () => {
  await putTasks([local({ cid: "ra", quadrant: "Q4", project: "", server_id: 80, progress: 0, checklist_total: 3, base_rev: "2026-06-04T00:00:00", updated_at: "2026-06-04T00:00:00" })]);
  await mapPut("task", 80, "ra");
  const r = await pullDenganAdopsiDiTengah([srv({ id: 80, progress: 33, checklist_total: 3 })], "ra", 80, { done: 2, total: 3, progress: 67 });
  const rec = await getTask("ra");
  assert.deepEqual([rec.progress, rec.checklist_total, rec.dirty], [67, 3, 0]);
  assert.equal(r.derived, 0); // satu-satunya kunci berbeda sudah berubah setelah snapshot → tanpa tulis
});

test("pullTasks: hanya kunci turunan yang berbeda yang ditulis (quadrant diadopsi, progress hasil adopsi tetap)", async () => {
  await putTasks([local({ cid: "rb", quadrant: "Q4", project: "", server_id: 81, progress: 33, checklist_total: 3, base_rev: "2026-06-04T00:00:00", updated_at: "2026-06-04T00:00:00" })]);
  await mapPut("task", 81, "rb");
  const r = await pullDenganAdopsiDiTengah([srv({ id: 81, quadrant: "Q2", progress: 33, checklist_total: 3 })], "rb", 81, { done: 2, total: 3, progress: 67 });
  const rec = await getTask("rb");
  assert.deepEqual([rec.quadrant, rec.progress, rec.checklist_total], ["Q2", 67, 3]);
  assert.equal(r.derived, 1);
});

test("pullTasks: dict server tanpa progress tidak menolkan progress lokal (only-if-sent)", async () => {
  await putTasks([local({ cid: "rc", quadrant: "Q4", project: "", server_id: 82, progress: 60, checklist_total: 5, base_rev: "2026-06-04T00:00:00", updated_at: "2026-06-04T00:00:00" })]);
  await mapPut("task", 82, "rc");
  const d = srv({ id: 82, checklist_total: 5 });
  delete d.progress;
  const r = await pullTasks([d]);
  assert.equal((await getTask("rc")).progress, 60);
  assert.equal(r.derived, 0);
});

// Balapan pull basi (review akhir S2): GET daftar dilayani server SEBELUM centang, respons centang diadopsi lebih
// dulu, lalu snapshot pull membaca nilai hasil adopsi SESUDAHNYA — nilai daftar yang basi tidak boleh menimpanya.
// Penjaga: checklist_adopted_at (cap waktu lokal saat adoptTaskProgress menulis) ≥ waktu mulai GET daftar
// (pullAndReconcile → pullTasks opts.requestedAt) → progress/checklist_total dari daftar itu dilewati.
const B = "2026-06-04T00:00:00";
function responsDaftar(list) { return { status: 200, ok: true, json: () => Promise.resolve(list) }; }
function fetchTertahan(list) {
  let lepas;
  const gerbang = new Promise((r) => { lepas = r; });
  const rawFetch = (u) => (u === "/api/tasks?include_done=true" ? gerbang.then(() => responsDaftar(list)) : Promise.resolve(null));
  return { rawFetch, lepas };
}
async function setelahJam(t) { while (Date.now() <= t) await new Promise((r) => setTimeout(r, 1)); }

test("pullAndReconcile: GET dimulai sebelum adopsi → daftar basi tidak menimpa progress hasil adopsi (jalur turunan)", async () => {
  await putTasks([local({ cid: "sa", quadrant: "Q4", project: "", server_id: 90, progress: 33, checklist_total: 3, base_rev: B, updated_at: B })]);
  await mapPut("task", 90, "sa");
  const f = fetchTertahan([srv({ id: 90, quadrant: "Q2", progress: 33, checklist_total: 3 })]);
  const pull = pullAndReconcile(f.rawFetch); // GET daftar dimulai (dilayani server sebelum centang)
  assert.equal(await TFchecklist.adoptTaskProgress(90, { done: 2, total: 3, progress: 67 }), true); // respons centang
  f.lepas(); // respons GET basi baru diproses; snapshot pull membaca 67
  await pull;
  const rec = await getTask("sa");
  assert.deepEqual([rec.progress, rec.checklist_total, rec.quadrant, rec.dirty], [67, 3, "Q2", 0]);
});

test("pullAndReconcile: GET dimulai sebelum adopsi → jalur tulis penuh (updated_at server baru) mempertahankan progress hasil adopsi", async () => {
  await putTasks([local({ cid: "sb", quadrant: "Q4", project: "", server_id: 91, progress: 33, checklist_total: 3, base_rev: B, updated_at: B })]);
  await mapPut("task", 91, "sb");
  const f = fetchTertahan([srv({ id: 91, title: "Judul baru", progress: 33, checklist_total: 3, updated_at: "2026-06-05T00:00:00" })]);
  const pull = pullAndReconcile(f.rawFetch);
  assert.equal(await TFchecklist.adoptTaskProgress(91, { done: 2, total: 3, progress: 67 }), true);
  const stamp = (await getTask("sb")).checklist_adopted_at;
  f.lepas();
  await pull;
  const rec = await getTask("sb");
  assert.deepEqual([rec.title, rec.base_rev, rec.dirty], ["Judul baru", "2026-06-05T00:00:00", 0]);
  assert.deepEqual([rec.progress, rec.checklist_total, rec.checklist_adopted_at], [67, 3, stamp]);
});

test("pullAndReconcile: GET yang dimulai SESUDAH adopsi mengadopsi nilai server seperti biasa (turunan dan tulis penuh)", async () => {
  await putTasks([
    local({ cid: "sc", quadrant: "Q4", project: "", server_id: 92, progress: 33, checklist_total: 3, base_rev: B, updated_at: B }),
    local({ cid: "sd", quadrant: "Q4", project: "", server_id: 93, progress: 33, checklist_total: 3, base_rev: B, updated_at: B }),
  ]);
  await mapPut("task", 92, "sc");
  await mapPut("task", 93, "sd");
  await TFchecklist.adoptTaskProgress(92, { done: 2, total: 3, progress: 67 });
  await TFchecklist.adoptTaskProgress(93, { done: 2, total: 3, progress: 67 });
  await setelahJam(Math.max((await getTask("sc")).checklist_adopted_at, (await getTask("sd")).checklist_adopted_at));
  // perangkat lain mengubah checklist sesudahnya; GET baru melihat nilai server terbaru
  const f = fetchTertahan([
    srv({ id: 92, progress: 100, checklist_total: 4 }),
    srv({ id: 93, title: "Lain", progress: 100, checklist_total: 4, updated_at: "2026-06-05T00:00:00" }),
  ]);
  const pull = pullAndReconcile(f.rawFetch);
  f.lepas();
  await pull;
  for (const cid of ["sc", "sd"]) {
    const rec = await getTask(cid);
    assert.deepEqual([rec.progress, rec.checklist_total], [100, 4], cid);
  }
});

test("pullTasks tanpa requestedAt (umur daftar tidak diketahui): progress hasil adopsi tidak ditimpa; requestedAt sesudah adopsi → diadopsi", async () => {
  await putTasks([local({ cid: "se", quadrant: "Q4", project: "", server_id: 94, progress: 33, checklist_total: 3, base_rev: B, updated_at: B })]);
  await mapPut("task", 94, "se");
  await TFchecklist.adoptTaskProgress(94, { done: 2, total: 3, progress: 67 });
  await pullTasks([srv({ id: 94, progress: 33, checklist_total: 3 })]);
  assert.equal((await getTask("se")).progress, 67);
  const stamp = (await getTask("se")).checklist_adopted_at;
  await setelahJam(stamp);
  await pullTasks([srv({ id: 94, progress: 33, checklist_total: 3 })], undefined, { requestedAt: Date.now() });
  assert.equal((await getTask("se")).progress, 33);
});

test("pullTasks: record tanpa checklist_adopted_at tetap mengadopsi progress tanpa requestedAt (perilaku lama)", async () => {
  await putTasks([local({ cid: "sf", quadrant: "Q4", project: "", server_id: 95, progress: 10, checklist_total: 3, base_rev: B, updated_at: B })]);
  await mapPut("task", 95, "sf");
  await pullTasks([srv({ id: 95, progress: 33, checklist_total: 3 })]);
  assert.equal((await getTask("sf")).progress, 33);
});

// Checklist offline Fase 2 (spec §4.1/§4.2, E1/E5; rencana PR B2 R5): checklist_rev = field turunan server (TASK_DERIVED,
// only-if-sent). Task yang masih punya entri antrean `subtasks` tidak mengadopsi progress/checklist_total dari server
// (hasil aksi lokal yang belum terkirim tidak "melompat" balik) — checklist_rev tetap diadopsi.
const subtaskOp = (taskCid) => ({ op: "rename", entity_type: "subtasks", cid: "b1", task_cid: taskCid, payload: { title: "x" } });

test("pullTasks mengadopsi checklist_rev sebagai field turunan (updated_at sama); tidak dikirim → tidak berubah", async () => {
  await putTasks([
    local({ cid: "cr1", quadrant: "Q4", project: "", server_id: 120, checklist_rev: 2, base_rev: B, updated_at: B }),
    local({ cid: "cr2", quadrant: "Q4", project: "", server_id: 121, checklist_rev: 2, base_rev: B, updated_at: B }),
  ]);
  await mapPut("task", 120, "cr1");
  await mapPut("task", 121, "cr2");
  const r = await pullTasks([srv({ id: 120, checklist_rev: 5 }), srv({ id: 121 })]);
  assert.equal((await getTask("cr1")).checklist_rev, 5);
  assert.equal((await getTask("cr2")).checklist_rev, 2);
  assert.equal(r.derived, 1);
});

test("pullTasks: checklist_rev lokal yang belum ada setara 0 (tanpa tulis ulang massal)", async () => {
  await putTasks([local({ cid: "cr3", quadrant: "Q4", project: "", server_id: 122, base_rev: B, updated_at: B })]);
  await mapPut("task", 122, "cr3");
  const r = await pullTasks([srv({ id: 122, checklist_rev: 0 })]);
  assert.equal(r.derived, 0);
});

test("E5: task berantrean subtasks → progress/checklist_total tidak diadopsi (updated_at sama), checklist_rev diadopsi", async () => {
  await putTasks([local({ cid: "cr4", quadrant: "Q4", project: "", server_id: 123, progress: 50, checklist_total: 2, checklist_rev: 3, base_rev: B, updated_at: B })]);
  await mapPut("task", 123, "cr4");
  await outboxAdd(subtaskOp("cr4"));
  await pullTasks([srv({ id: 123, progress: 0, checklist_total: 1, checklist_rev: 4 })]);
  const rec = await getTask("cr4");
  assert.deepEqual([rec.progress, rec.checklist_total, rec.checklist_rev, rec.dirty], [50, 2, 4, 0]);
});

test("E5: tulis penuh (updated_at berbeda) task berantrean subtasks mempertahankan progress/checklist_total lokal", async () => {
  await putTasks([local({ cid: "cr5", quadrant: "Q4", project: "", server_id: 124, progress: 50, checklist_total: 2, checklist_rev: 3, base_rev: B, updated_at: B })]);
  await mapPut("task", 124, "cr5");
  await outboxAdd(subtaskOp("cr5"));
  await pullTasks([srv({ id: 124, title: "Baru", progress: 0, checklist_total: 1, checklist_rev: 6, updated_at: "2026-06-05T00:00:00" })]);
  const rec = await getTask("cr5");
  assert.deepEqual([rec.title, rec.progress, rec.checklist_total, rec.checklist_rev], ["Baru", 50, 2, 6]);
});

test("E5: antrean subtasks task LAIN tidak menghalangi adopsi progress", async () => {
  await putTasks([local({ cid: "cr6", quadrant: "Q4", project: "", server_id: 125, progress: 50, checklist_total: 2, base_rev: B, updated_at: B })]);
  await mapPut("task", 125, "cr6");
  await outboxAdd(subtaskOp("lain"));
  await pullTasks([srv({ id: 125, progress: 0, checklist_total: 1 })]);
  const rec = await getTask("cr6");
  assert.deepEqual([rec.progress, rec.checklist_total], [0, 1]);
});

test("checklist_rev diadopsi juga untuk task dirty berantrean (edit lokal tertunda), tanpa mengubah dirty/rev/field lain", async () => {
  await putTasks([local({ cid: "cr7", quadrant: "Q4", project: "", title: "Lokal", server_id: 126, progress: 10, checklist_total: 1, checklist_rev: 3, dirty: 1, rev: 4, base_rev: B, updated_at: B })]);
  await mapPut("task", 126, "cr7");
  await outboxAdd({ op: "update", entity_type: "task", cid: "cr7", payload: {} });
  await pullTasks([srv({ id: 126, title: "Server", progress: 90, checklist_total: 5, checklist_rev: 8 })]);
  const rec = await getTask("cr7");
  assert.deepEqual([rec.title, rec.progress, rec.checklist_total, rec.checklist_rev, rec.dirty, rec.rev], ["Lokal", 10, 1, 8, 1, 4]);
});

test("checklist_rev diadopsi untuk task ber-sync_error / konflik (pull dilewati) tanpa menyentuh field lain", async () => {
  await putTasks([
    local({ cid: "cr8", quadrant: "Q4", project: "", title: "L", server_id: 127, checklist_rev: 1, dirty: 1, rev: 2, sync_error: { status: 422 }, base_rev: B, updated_at: B }),
    local({ cid: "cr9", quadrant: "Q4", project: "", title: "L", server_id: 128, checklist_rev: 1, conflict: "access_lost", base_rev: B, updated_at: B }),
  ]);
  await mapPut("task", 127, "cr8");
  await mapPut("task", 128, "cr9");
  await pullTasks([srv({ id: 127, title: "S", checklist_rev: 4, updated_at: "2026-06-06T00:00:00" }), srv({ id: 128, title: "S", checklist_rev: 6 })]);
  const a = await getTask("cr8");
  const b = await getTask("cr9");
  assert.deepEqual([a.title, a.checklist_rev, a.dirty, a.rev], ["L", 4, 1, 2]);
  assert.deepEqual([b.title, b.checklist_rev], ["L", 6]);
});

test("pullTasks: salinan hantu (server id yang sama dipetakan ke cid lain) dibuang beserta checklist-nya", async () => {
  const TFrepo = require("../../static/offline/checklistrepo.js");
  TFrepo._reset();
  await putTasks([
    local({ cid: "asli", server_id: 130, base_rev: B, updated_at: B }),
    local({ cid: "hantu", server_id: 130, base_rev: B, updated_at: B }),
  ]);
  await mapPut("task", 130, "asli");
  const db = await openDB();
  await new Promise((res) => {
    const t = db.transaction("subtasks", "readwrite");
    t.objectStore("subtasks").put({ cid: "h1", server_id: null, task_cid: "hantu", parent_cid: null, title: "x", is_done: false, sort_order: 0 });
    t.oncomplete = () => res();
  });
  await pullTasks([srv({ id: 130 })]);
  assert.equal(await getTask("hantu"), undefined);
  assert.deepEqual(await TFrepo.recordsForTask("hantu"), []);
});
