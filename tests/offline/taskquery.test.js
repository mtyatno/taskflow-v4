"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { listTasks } = require("../../static/offline/taskquery.js");

const TODAY = "2026-06-03";

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function seed(recs) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("tasks", "readwrite");
    const store = tx.objectStore("tasks");
    for (const r of recs) store.put(r);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function task(over) {
  return Object.assign({
    cid: over.cid, title: over.cid, gtd_status: "next", priority: "P3",
    quadrant: "Q4", project: "", context: "", deadline: null, completed_at: null,
    parent_cid: null, is_focused: 0, deleted: false,
  }, over);
}

test("listTasks excludes done/archived by default and tombstones", async () => {
  await seed([
    task({ cid: "a", gtd_status: "next" }),
    task({ cid: "b", gtd_status: "done" }),
    task({ cid: "c", gtd_status: "archived" }),
    task({ cid: "d", gtd_status: "next", deleted: true }),
  ]);
  const rows = await listTasks({}, { today: TODAY });
  assert.deepEqual(rows.map((r) => r.cid), ["a"]);
});

test("listTasks include_done returns done too (string or boolean)", async () => {
  await seed([task({ cid: "a", gtd_status: "next" }), task({ cid: "b", gtd_status: "done" })]);
  const r1 = await listTasks({ include_done: true }, { today: TODAY });
  assert.deepEqual(r1.map((r) => r.cid).sort(), ["a", "b"]);
  const r2 = await listTasks({ include_done: "true" }, { today: TODAY });
  assert.deepEqual(r2.map((r) => r.cid).sort(), ["a", "b"]);
});

test("listTasks status filter overrides the default exclusion", async () => {
  await seed([task({ cid: "a", gtd_status: "next" }), task({ cid: "b", gtd_status: "done" })]);
  const rows = await listTasks({ status: "done" }, { today: TODAY });
  assert.deepEqual(rows.map((r) => r.cid), ["b"]);
});

test("listTasks filters by priority/quadrant/project/context (priority/quadrant case-insensitive)", async () => {
  await seed([
    task({ cid: "a", priority: "P1", quadrant: "Q1", project: "Web", context: "@home" }),
    task({ cid: "b", priority: "P3", quadrant: "Q4", project: "Web", context: "@office" }),
  ]);
  assert.deepEqual((await listTasks({ priority: "p1" }, { today: TODAY })).map((r) => r.cid), ["a"]);
  assert.deepEqual((await listTasks({ quadrant: "q1" }, { today: TODAY })).map((r) => r.cid), ["a"]);
  assert.deepEqual((await listTasks({ context: "@office" }, { today: TODAY })).map((r) => r.cid), ["b"]);
  assert.deepEqual((await listTasks({ project: "Web" }, { today: TODAY })).map((r) => r.cid).sort(), ["a", "b"]);
});

test("listTasks orders by priority then deadline with NULL deadline first", async () => {
  await seed([
    task({ cid: "p3late", priority: "P3", deadline: "2026-07-01" }),
    task({ cid: "p1none", priority: "P1", deadline: null }),
    task({ cid: "p1soon", priority: "P1", deadline: "2026-06-05" }),
    task({ cid: "p3none", priority: "P3", deadline: null }),
  ]);
  const rows = await listTasks({}, { today: TODAY });
  // P1 group first (null deadline before dated), then P3 group (null before dated)
  assert.deepEqual(rows.map((r) => r.cid), ["p1none", "p1soon", "p3none", "p3late"]);
});

test("listTasks rows carry assembled display fields", async () => {
  await seed([task({ cid: "x", deadline: "2026-06-02", gtd_status: "next", is_focused: 1 })]);
  const [row] = await listTasks({}, { today: TODAY });
  assert.equal(row.is_focused, true);
  assert.equal(row.days_until_deadline, -1);
  assert.equal(row.is_overdue, true);
  assert.equal(row.parent_title, null);
});

test("listTasks resolves parent_title from the live set", async () => {
  await seed([
    task({ cid: "par", title: "Parent", gtd_status: "next" }),
    task({ cid: "kid", title: "Kid", parent_cid: "par", gtd_status: "next" }),
  ]);
  const rows = await listTasks({}, { today: TODAY });
  const kid = rows.find((r) => r.cid === "kid");
  assert.equal(kid.parent_title, "Parent");
});

const { getProjects, getContexts } = require("../../static/offline/taskquery.js");

test("getProjects returns distinct non-empty projects of active tasks, sorted", async () => {
  await seed([
    task({ cid: "a", project: "Web", gtd_status: "next" }),
    task({ cid: "b", project: "Alpha", gtd_status: "next" }),
    task({ cid: "c", project: "Web", gtd_status: "next" }),
    task({ cid: "d", project: "", gtd_status: "next" }),
    task({ cid: "e", project: "Done", gtd_status: "done" }),     // excluded (not active)
    task({ cid: "f", project: "Gone", gtd_status: "next", deleted: true }), // excluded (tombstone)
  ]);
  assert.deepEqual(await getProjects(), ["Alpha", "Web"]);
});

test("getContexts returns distinct non-empty contexts of active tasks, sorted", async () => {
  await seed([
    task({ cid: "a", context: "@office", gtd_status: "next" }),
    task({ cid: "b", context: "@home", gtd_status: "next" }),
    task({ cid: "c", context: "@office", gtd_status: "next" }),
    task({ cid: "d", context: "", gtd_status: "next" }),
    task({ cid: "e", context: "@archived", gtd_status: "archived" }), // excluded
  ]);
  assert.deepEqual(await getContexts(), ["@home", "@office"]);
});
