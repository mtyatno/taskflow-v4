"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut } = require("../../static/offline/idmap.js");
const { pullTasks } = require("../../static/offline/syncpull.js");

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

test("pullTasks skips a dirty local record even if the server changed", async () => {
  await putTasks([local({ cid: "a", server_id: 10, title: "Local edit", base_rev: "2026-06-01T00:00:00", dirty: 1 })]);
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
  assert.equal(r.skipped, 1);
  assert.notEqual(await getTask("a"), undefined);
});

test("pullTasks ignores local-only records (server_id null) when reconciling deletes", async () => {
  await putTasks([local({ cid: "b", server_id: null, dirty: 1 })]);
  const r = await pullTasks([]);
  assert.equal(r.deleted, 0);
  assert.notEqual(await getTask("b"), undefined);
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
