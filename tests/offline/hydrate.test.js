"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { taskFromServer, hydrateTasks } = require("../../static/offline/hydrate.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function allTasks() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction("tasks", "readonly").objectStore("tasks").getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}

function serverTask(over) {
  return Object.assign({
    id: 1, title: "T", description: "", gtd_status: "next", priority: "P3", quadrant: "Q4",
    project: "", context: "", deadline: null, waiting_for: "", completed_at: null, progress: 0,
    is_focused: 0, assigned_to: null, parent_id: null, list_id: null,
    recurrence_type: null, recurrence_days: null, recurrence_end_date: null, recurrence_notif_level: null,
    created_at: "2026-06-01T00:00:00.000Z", updated_at: "2026-06-02T00:00:00.000Z",
  }, over);
}

test("taskFromServer maps fields, resolves parent_cid via getCid, marks clean", () => {
  const getCid = (sid) => (sid === 5 ? "parent-cid" : "self-cid");
  const rec = taskFromServer(serverTask({ id: 9, parent_id: 5, title: "Kid" }), getCid);
  assert.equal(rec.cid, "self-cid");
  assert.equal(rec.server_id, 9);
  assert.equal(rec.parent_cid, "parent-cid");
  assert.equal(rec.title, "Kid");
  assert.equal(rec.dirty, 0);
  assert.equal(rec.deleted, false);
  assert.equal(rec.base_rev, "2026-06-02T00:00:00.000Z");
});

test("taskFromServer null parent_id → parent_cid null", () => {
  const rec = taskFromServer(serverTask({ id: 9, parent_id: null }), () => "x");
  assert.equal(rec.parent_cid, null);
});

test("hydrateTasks populates the store with server_id + a stable cid", async () => {
  await hydrateTasks([serverTask({ id: 1, title: "A" }), serverTask({ id: 2, title: "B" })]);
  const rows = await allTasks();
  assert.equal(rows.length, 2);
  for (const r of rows) { assert.equal(r.dirty, 0); assert.notEqual(r.cid, undefined); assert.notEqual(r.server_id, null); }
});

test("hydrateTasks is idempotent — same cid, no duplicate rows on re-run", async () => {
  await hydrateTasks([serverTask({ id: 1 })]);
  const first = (await allTasks())[0].cid;
  await hydrateTasks([serverTask({ id: 1, title: "Renamed" })]);
  const rows = await allTasks();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cid, first);
  assert.equal(rows[0].title, "Renamed");
});

test("hydrateTasks resolves parent_cid across the batch", async () => {
  await hydrateTasks([serverTask({ id: 1, title: "Parent" }), serverTask({ id: 2, title: "Kid", parent_id: 1 })]);
  const rows = await allTasks();
  const parent = rows.find((r) => r.server_id === 1);
  const kid = rows.find((r) => r.server_id === 2);
  assert.equal(kid.parent_cid, parent.cid);
});

test("taskFromServer copies the server list_id", () => {
  const rec = taskFromServer(serverTask({ id: 9, list_id: 7 }), () => "x");
  assert.equal(rec.list_id, 7);
  const personal = taskFromServer(serverTask({ id: 10, list_id: null }), () => "x");
  assert.equal(personal.list_id, null);
});

test("hydrateTasks does not touch local-only tasks (server_id null)", async () => {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("tasks", "readwrite");
    tx.objectStore("tasks").put({ cid: "local1", server_id: null, title: "Local", deleted: false, dirty: 1 });
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
  await hydrateTasks([serverTask({ id: 1 })]);
  const rows = await allTasks();
  const local = rows.find((r) => r.cid === "local1");
  assert.equal(local.title, "Local");
  assert.equal(local.dirty, 1); // untouched
});
