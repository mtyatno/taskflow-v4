"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { buildTaskRouter, isNoteTagsCall } = require("../../static/offline/taskroutes.js");
const { setEntityTags } = require("../../static/offline/tagrepo.js");

const TODAY = "2026-06-03";
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

function task(over) {
  return Object.assign({
    cid: over.cid, server_id: null, title: over.cid, gtd_status: "next",
    priority: "P3", quadrant: "Q4", project: "", context: "", deadline: null,
    completed_at: null, parent_cid: null, is_focused: 0, created_at: "2026-06-01T00:00:00.000Z",
    recurrence_type: null, recurrence_end_date: null, deleted: false,
  }, over);
}

test("GET /api/tasks returns rows carrying id (server_id when present, cid when local-only)", async () => {
  await seedTasks([task({ cid: "a", server_id: 10 }), task({ cid: "b" })]);
  const R = buildTaskRouter();
  const rows = await R.dispatch("GET", "/api/tasks", undefined);
  const byCid = Object.fromEntries(rows.map((r) => [r.cid, r.id]));
  assert.equal(byCid["a"], 10);   // hydrated → server_id
  assert.equal(byCid["b"], "b");  // local-only → cid
});

test("GET /api/tasks/:id resolves by server_id and by cid", async () => {
  await seedTasks([task({ cid: "a", server_id: 10, title: "Hydrated" }), task({ cid: "b", title: "Local" })]);
  const R = buildTaskRouter();
  const viaServer = await R.dispatch("GET", "/api/tasks/10", undefined);
  assert.equal(viaServer.title, "Hydrated");
  assert.equal(viaServer.id, 10);
  const viaCid = await R.dispatch("GET", "/api/tasks/b", undefined);
  assert.equal(viaCid.title, "Local");
  assert.equal(viaCid.id, "b");
});

test("GET /api/tasks/:id unknown rejects", async () => {
  const R = buildTaskRouter();
  await assert.rejects(() => R.dispatch("GET", "/api/tasks/999", undefined));
});

test("POST /api/tasks creates and returns id=cid", async () => {
  const R = buildTaskRouter();
  const created = await R.dispatch("POST", "/api/tasks", { title: "Beli #kopi" });
  assert.equal(created.title, "Beli");
  assert.equal(created.id, created.cid);
  const rows = await R.dispatch("GET", "/api/tasks", undefined);
  assert.equal(rows.length, 1);
});

test("PUT /api/tasks/:id updates (resolve by server_id)", async () => {
  await seedTasks([task({ cid: "a", server_id: 10, title: "Old" })]);
  const R = buildTaskRouter();
  const u = await R.dispatch("PUT", "/api/tasks/10", { title: "New" });
  assert.equal(u.title, "New");
  assert.equal(u.id, 10);
});

test("DELETE /api/tasks/:id soft-deletes", async () => {
  await seedTasks([task({ cid: "a", server_id: 10 })]);
  const R = buildTaskRouter();
  const res = await R.dispatch("DELETE", "/api/tasks/10", undefined);
  assert.deepEqual(res, { ok: true });
  const rows = await R.dispatch("GET", "/api/tasks", undefined);
  assert.equal(rows.length, 0);
});

test("GET /api/summary returns the aggregation with date", async () => {
  await seedTasks([task({ cid: "a", gtd_status: "next" })]);
  const R = buildTaskRouter();
  const s = await R.dispatch("GET", "/api/summary", undefined);
  assert.equal(typeof s.date, "string");
  assert.equal(s.by_status.next, 1);
});

test("GET /api/projects and /api/contexts return sorted distinct values", async () => {
  await seedTasks([task({ cid: "a", project: "Web", context: "@home" })]);
  const R = buildTaskRouter();
  assert.deepEqual(await R.dispatch("GET", "/api/projects", undefined), ["Web"]);
  assert.deepEqual(await R.dispatch("GET", "/api/contexts", undefined), ["@home"]);
});

test("GET /api/tasks/:id/tags returns the task's tags", async () => {
  await seedTasks([task({ cid: "a", server_id: 10 })]);
  await setEntityTags("task", "a", ["kerja"]);
  const R = buildTaskRouter();
  const tags = await R.dispatch("GET", "/api/tasks/10/tags", undefined);
  assert.deepEqual(tags.map((t) => t.name), ["kerja"]);
});

test("GET /api/tags returns all tags; DELETE removes one task relation", async () => {
  await seedTasks([task({ cid: "a", server_id: 10 })]);
  await setEntityTags("task", "a", ["kerja", "urgent"]);
  const R = buildTaskRouter();
  assert.deepEqual((await R.dispatch("GET", "/api/tags", undefined)).map((t) => t.name), ["kerja", "urgent"]);
  await R.dispatch("DELETE", "/api/tasks/10/tags/kerja", undefined);
  assert.deepEqual((await R.dispatch("GET", "/api/tasks/10/tags", undefined)).map((t) => t.name), ["urgent"]);
});

test("GET /api/recurring/exceptions remaps keys to display id", async () => {
  await seedTasks([task({
    cid: "a", server_id: 10, recurrence_type: "daily",
    created_at: "2026-06-01T00:00:00.000Z", recurrence_end_date: "2026-08-30",
  })]);
  const R = buildTaskRouter();
  await R.dispatch("POST", "/api/tasks/10/occurrences/2026-06-10/mark", { status: "done" });
  const map = await R.dispatch("GET", "/api/recurring/exceptions?from=2026-06-01&to=2026-06-30", undefined);
  assert.deepEqual(map["10"], [{ occurrence_date: "2026-06-10", status: "done" }]); // keyed by server_id, not cid
});

test("isNoteTagsCall is true only for GET /api/tags?entity_type=note", () => {
  assert.equal(isNoteTagsCall("GET", "/api/tags?entity_type=note"), true);
  assert.equal(isNoteTagsCall("GET", "/api/tags"), false);
  assert.equal(isNoteTagsCall("GET", "/api/tags?entity_type=task"), false);
});

test("hasRoute is false for un-ported task routes", () => {
  const R = buildTaskRouter();
  assert.equal(R.hasRoute("POST", "/api/tasks/10/done"), false);
  assert.equal(R.hasRoute("POST", "/api/tasks/10/focus"), false);
  assert.equal(R.hasRoute("GET", "/api/tasks/10/subtasks"), false);
});

async function seedLists(recs) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("lists", "readwrite");
    for (const r of recs) tx.objectStore("lists").put(r);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}

test("GET /api/lists returns local lists shaped like the server", async () => {
  await seedLists([{ cid: "l1", server_id: 7, name: "Team", owner_id: 1, role: "owner", member_count: 3, dirty: 0 }]);
  const R = buildTaskRouter();
  const lists = await R.dispatch("GET", "/api/lists", undefined);
  assert.deepEqual(lists, [{ id: 7, name: "Team", owner_id: 1, role: "owner", member_count: 3 }]);
});

test("GET /api/lists/:id/tasks returns only that list's active tasks", async () => {
  await seedTasks([
    task({ cid: "a", server_id: 100, list_id: 7, gtd_status: "next" }),
    task({ cid: "b", server_id: 101, list_id: 7, gtd_status: "next" }),
    task({ cid: "c", server_id: 102, list_id: 9, gtd_status: "next" }),
    task({ cid: "d", server_id: 103, list_id: null, gtd_status: "next" }),
  ]);
  const R = buildTaskRouter();
  const rows = await R.dispatch("GET", "/api/lists/7/tasks", undefined);
  assert.deepEqual(rows.map((r) => r.cid).sort(), ["a", "b"]);
  assert.ok(rows.every((r) => r.id !== undefined));
});
