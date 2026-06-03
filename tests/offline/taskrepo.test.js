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
