"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { getTask } = require("../../static/offline/taskrepo.js");

const TODAY = "2026-06-03";

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

// Helper: put a raw task record straight into the store.
async function seedTask(rec) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("tasks", "readwrite");
    tx.objectStore("tasks").put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

test("getTask returns undefined for a missing cid", async () => {
  assert.equal(await getTask("nope", TODAY), undefined);
});

test("getTask assembles derived fields and is_focused bool", async () => {
  await seedTask({
    cid: "t1", server_id: null, title: "A", deadline: "2026-06-02",
    gtd_status: "next", is_focused: 1, parent_cid: null,
    deleted: false, dirty: 0,
  });
  const t = await getTask("t1", TODAY);
  assert.equal(t.cid, "t1");
  assert.equal(t.is_focused, true);            // coerced to boolean
  assert.equal(t.days_until_deadline, -1);
  assert.equal(t.is_overdue, true);            // overdue + active
  assert.equal(t.assigned_to_name, null);      // not resolved in this plan
  assert.equal(t.parent_title, null);
});

test("getTask resolves parent_title from the local tasks store", async () => {
  await seedTask({ cid: "parent", title: "Parent Task", parent_cid: null, deleted: false, dirty: 0 });
  await seedTask({ cid: "child", title: "Child", parent_cid: "parent", deleted: false, dirty: 0 });
  const t = await getTask("child", TODAY);
  assert.equal(t.parent_title, "Parent Task");
});

test("getTask hides soft-deleted (tombstoned) records", async () => {
  await seedTask({ cid: "gone", title: "Gone", parent_cid: null, deleted: true, dirty: 1 });
  assert.equal(await getTask("gone", TODAY), undefined);
});

const { createTask } = require("../../static/offline/taskrepo.js");
const { outboxAll } = require("../../static/offline/outbox.js");

const NOW = "2026-06-03T08:00:00.000Z";

test("createTask applies defaults, uppercases priority, sets timestamps", async () => {
  const t = await createTask({ title: "Beli kopi" }, { today: TODAY, now: NOW });
  assert.equal(typeof t.cid, "string");
  assert.equal(t.server_id, null);
  assert.equal(t.title, "Beli kopi");
  assert.equal(t.description, "");
  assert.equal(t.priority, "P3");
  assert.equal(t.gtd_status, "inbox");
  assert.equal(t.project, "");
  assert.equal(t.context, "");
  assert.equal(t.deadline, null);
  assert.equal(t.progress, 0);
  assert.equal(t.is_focused, false);
  assert.equal(t.completed_at, null);
  assert.equal(t.created_at, NOW);
  assert.equal(t.updated_at, NOW);
  assert.equal(t.dirty, 1);
  assert.equal(t.deleted, false);
});

test("createTask lowercases-and-strips #tags from the title", async () => {
  const t = await createTask({ title: "Riset pasar #Kerja #urgent" }, { today: TODAY, now: NOW });
  assert.equal(t.title, "Riset pasar");
});

test("createTask throws when title is empty after stripping tags", async () => {
  await assert.rejects(
    () => createTask({ title: "#onlytags" }, { today: TODAY, now: NOW }),
    /kosong setelah strip tag/i
  );
});

test("createTask computes quadrant via tasklogic (P1 due in 5 days -> Q1)", async () => {
  const t = await createTask({ title: "X", priority: "p1", deadline: "2026-06-08" }, { today: TODAY, now: NOW });
  assert.equal(t.priority, "P1");
  assert.equal(t.quadrant, "Q1");
});

test("createTask P3 with no deadline -> Q4", async () => {
  const t = await createTask({ title: "Y", priority: "P3" }, { today: TODAY, now: NOW });
  assert.equal(t.quadrant, "Q4");
});

test("createTask persists the record and enqueues a create op in _outbox", async () => {
  const t = await createTask({ title: "Z" }, { today: TODAY, now: NOW });
  const fetched = await getTask(t.cid, TODAY);
  assert.equal(fetched.title, "Z");
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "create");
  assert.equal(ops[0].entity_type, "task");
  assert.equal(ops[0].cid, t.cid);
});

const { updateTask } = require("../../static/offline/taskrepo.js");

const LATER = "2026-06-04T09:00:00.000Z";

test("updateTask changes only provided fields and bumps updated_at", async () => {
  const t = await createTask({ title: "Edit me", priority: "P3" }, { today: TODAY, now: NOW });
  const u = await updateTask(t.cid, { description: "added" }, { today: TODAY, now: LATER });
  assert.equal(u.description, "added");
  assert.equal(u.title, "Edit me");
  assert.equal(u.priority, "P3");
  assert.equal(u.updated_at, LATER);
  assert.equal(u.dirty, 1);
});

test("updateTask uppercases priority and recomputes quadrant", async () => {
  const t = await createTask({ title: "Q", priority: "P3", deadline: "2026-06-05" }, { today: TODAY, now: NOW });
  const u = await updateTask(t.cid, { priority: "p1" }, { today: TODAY, now: LATER });
  assert.equal(u.priority, "P1");
  assert.equal(u.quadrant, "Q1"); // P1 + due in 2 days
});

test("updateTask gtd_status done sets completed_at", async () => {
  const t = await createTask({ title: "Finish" }, { today: TODAY, now: NOW });
  const u = await updateTask(t.cid, { gtd_status: "done" }, { today: TODAY, now: LATER });
  assert.equal(u.gtd_status, "done");
  assert.equal(u.completed_at, LATER);
});

test("updateTask deadline '' or '-' clears the deadline", async () => {
  const t = await createTask({ title: "D", deadline: "2026-06-10" }, { today: TODAY, now: NOW });
  const u1 = await updateTask(t.cid, { deadline: "" }, { today: TODAY, now: LATER });
  assert.equal(u1.deadline, null);
  const t2 = await createTask({ title: "D2", deadline: "2026-06-10" }, { today: TODAY, now: NOW });
  const u2 = await updateTask(t2.cid, { deadline: "-" }, { today: TODAY, now: LATER });
  assert.equal(u2.deadline, null);
});

test("updateTask assigned_to 0 becomes null; progress is clamped", async () => {
  const t = await createTask({ title: "P" }, { today: TODAY, now: NOW });
  const u = await updateTask(t.cid, { assigned_to: 0, progress: 250 }, { today: TODAY, now: LATER });
  assert.equal(u.assigned_to, null);
  assert.equal(u.progress, 100);
  const u2 = await updateTask(t.cid, { progress: -5 }, { today: TODAY, now: LATER });
  assert.equal(u2.progress, 0);
});

test("updateTask strips tags from a new title; rejects empty result", async () => {
  const t = await createTask({ title: "Orig" }, { today: TODAY, now: NOW });
  const u = await updateTask(t.cid, { title: "New title #tag" }, { today: TODAY, now: LATER });
  assert.equal(u.title, "New title");
  await assert.rejects(() => updateTask(t.cid, { title: "#only" }, { today: TODAY, now: LATER }), /kosong/i);
});

test("updateTask enqueues an update op and rejects unknown cid", async () => {
  const t = await createTask({ title: "OB" }, { today: TODAY, now: NOW });
  await updateTask(t.cid, { description: "x" }, { today: TODAY, now: LATER });
  const ops = await outboxAll();
  assert.ok(ops.some((o) => o.op === "update" && o.cid === t.cid));
  await assert.rejects(() => updateTask("ghost", { description: "x" }, { today: TODAY, now: LATER }), /not found/i);
});

const { deleteTask } = require("../../static/offline/taskrepo.js");

test("deleteTask soft-deletes (tombstone) and hides from getTask", async () => {
  const t = await createTask({ title: "Trash" }, { today: TODAY, now: NOW });
  const res = await deleteTask(t.cid, { now: LATER });
  assert.deepEqual(res, { ok: true });
  assert.equal(await getTask(t.cid, TODAY), undefined);
});

test("deleteTask sets deleted=true + dirty and enqueues a delete op", async () => {
  const t = await createTask({ title: "Trash2" }, { today: TODAY, now: NOW });
  await deleteTask(t.cid, { now: LATER });
  const db = await openDB();
  const raw = await new Promise((resolve, reject) => {
    const r = db.transaction("tasks", "readonly").objectStore("tasks").get(t.cid);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  assert.equal(raw.deleted, true);
  assert.equal(raw.dirty, 1);
  assert.equal(raw.updated_at, LATER);
  const ops = await outboxAll();
  assert.ok(ops.some((o) => o.op === "delete" && o.cid === t.cid));
});

test("deleteTask rejects an unknown cid", async () => {
  await assert.rejects(() => deleteTask("ghost", { now: LATER }), /not found/i);
});
