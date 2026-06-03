"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { markOccurrence, getExceptions } = require("../../static/offline/recurrence.js");
const { outboxAll } = require("../../static/offline/outbox.js");

const NOW = "2026-06-03T08:00:00.000Z";
beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function seedTasks(recs) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("tasks", "readwrite");
    const store = tx.objectStore("tasks");
    for (const r of recs) store.put(r);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function recurringTask(over) {
  return Object.assign({
    cid: "r1", title: "Daily", gtd_status: "next",
    created_at: "2026-06-01T00:00:00.000Z",
    recurrence_type: "daily", recurrence_end_date: "2026-08-30",
    deleted: false,
  }, over);
}

test("markOccurrence upserts an exception and enqueues an outbox op", async () => {
  await seedTasks([recurringTask({})]);
  const rec = await markOccurrence("r1", "2026-06-10", "done", { now: NOW });
  assert.equal(rec.task_cid, "r1");
  assert.equal(rec.occurrence_date, "2026-06-10");
  assert.equal(rec.status, "done");
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "mark_occurrence");
  assert.equal(ops[0].entity_type, "recurring_exception");
});

test("markOccurrence rejects an invalid status", async () => {
  await seedTasks([recurringTask({})]);
  await assert.rejects(() => markOccurrence("r1", "2026-06-10", "nope", { now: NOW }));
});

test("markOccurrence rejects an invalid date format", async () => {
  await seedTasks([recurringTask({})]);
  await assert.rejects(() => markOccurrence("r1", "10-06-2026", "done", { now: NOW }));
});

test("markOccurrence rejects a non-recurring task", async () => {
  await seedTasks([recurringTask({ cid: "r1", recurrence_type: null })]);
  await assert.rejects(() => markOccurrence("r1", "2026-06-10", "done", { now: NOW }));
});

test("markOccurrence rejects a date outside the recurring range", async () => {
  await seedTasks([recurringTask({})]); // created 2026-06-01, end 2026-08-30
  await assert.rejects(() => markOccurrence("r1", "2026-05-31", "done", { now: NOW }));
  await assert.rejects(() => markOccurrence("r1", "2026-08-31", "done", { now: NOW }));
});

test("markOccurrence on conflict updates the status (no duplicate row)", async () => {
  await seedTasks([recurringTask({})]);
  await markOccurrence("r1", "2026-06-10", "done", { now: NOW });
  await markOccurrence("r1", "2026-06-10", "skipped", { now: NOW });
  const map = await getExceptions("2026-06-01", "2026-06-30");
  assert.deepEqual(map["r1"], [{ occurrence_date: "2026-06-10", status: "skipped" }]);
});

test("getExceptions returns a map keyed by task_cid within the range", async () => {
  await seedTasks([recurringTask({ cid: "r1" }), recurringTask({ cid: "r2" })]);
  await markOccurrence("r1", "2026-06-10", "done", { now: NOW });
  await markOccurrence("r2", "2026-06-12", "skipped", { now: NOW });
  const map = await getExceptions("2026-06-01", "2026-06-30");
  assert.deepEqual(map["r1"], [{ occurrence_date: "2026-06-10", status: "done" }]);
  assert.deepEqual(map["r2"], [{ occurrence_date: "2026-06-12", status: "skipped" }]);
});

test("getExceptions excludes out-of-range and deleted-task exceptions", async () => {
  await seedTasks([recurringTask({ cid: "r1" }), recurringTask({ cid: "r2", deleted: true })]);
  await markOccurrence("r1", "2026-06-10", "done", { now: NOW });
  await markOccurrence("r1", "2026-07-10", "done", { now: NOW });
  // r2 is deleted — markOccurrence would reject it, so seed its exception raw:
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("recurring_exceptions", "readwrite");
    tx.objectStore("recurring_exceptions").put({ cid: "x", task_cid: "r2", occurrence_date: "2026-06-15", status: "done" });
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
  const map = await getExceptions("2026-06-01", "2026-06-30");
  assert.deepEqual(map["r1"], [{ occurrence_date: "2026-06-10", status: "done" }]); // 07-10 out of range
  assert.equal(map["r2"], undefined); // deleted task excluded
});
