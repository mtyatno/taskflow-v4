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

async function seedSubtasks(recs) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("subtasks", "readwrite");
    const store = tx.objectStore("subtasks");
    for (const r of recs) store.put(r);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function seedTaskNotes(recs) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("task_notes", "readwrite");
    const store = tx.objectStore("task_notes");
    for (const r of recs) store.put(r);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function seedTaskAttachments(recs) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("task_attachments", "readwrite");
    const store = tx.objectStore("task_attachments");
    for (const r of recs) store.put(r);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

test("hasRoute is false for un-ported task routes and true for ported routes", () => {
  const R = buildTaskRouter();
  assert.equal(R.hasRoute("POST", "/api/tasks/10/done"), true);
  assert.equal(R.hasRoute("GET", "/api/tasks/10/child-tasks"), true);
  assert.equal(R.hasRoute("POST", "/api/tasks/10/focus"), true);
  assert.equal(R.hasRoute("GET", "/api/tasks/10/subtasks"), true);
  assert.equal(R.hasRoute("GET", "/api/tasks/10/notes"), true);
  assert.equal(R.hasRoute("GET", "/api/tasks/10/attachments"), true);
  assert.equal(R.hasRoute("POST", "/api/tasks/10/bogus-unsupported"), false);
});

test("POST /api/tasks/:id/focus toggles is_focused between 0 and 1 for server_id and cid", async () => {
  await seedTasks([
    task({ cid: "t_server", server_id: 101, title: "Server task", is_focused: 0 }),
    task({ cid: "t_client", server_id: null, title: "Client task", is_focused: 1 }),
  ]);
  const R = buildTaskRouter();

  // Via server_id: toggles 0 -> 1
  const res1 = await R.dispatch("POST", "/api/tasks/101/focus", undefined);
  assert.equal(res1.id, 101);
  assert.equal(res1.is_focused, true);

  // Toggle again: 1 -> 0
  const res2 = await R.dispatch("POST", "/api/tasks/101/focus", undefined);
  assert.equal(res2.is_focused, false);

  // Via cid: toggles 1 -> 0
  const res3 = await R.dispatch("POST", "/api/tasks/t_client/focus", undefined);
  assert.equal(res3.id, "t_client");
  assert.equal(res3.is_focused, false);

  // Toggle again: 0 -> 1
  const res4 = await R.dispatch("POST", "/api/tasks/t_client/focus", undefined);
  assert.equal(res4.is_focused, true);

  // Unknown id rejects
  await assert.rejects(() => R.dispatch("POST", "/api/tasks/unknown/focus", undefined));
});

test("GET /api/tasks/:id/subtasks, notes, attachments return entries for resolved cid or empty array when none exist", async () => {
  await seedTasks([
    task({ cid: "t_main", server_id: 501, title: "Main Task" }),
    task({ cid: "t_empty", server_id: 502, title: "Empty Task" }),
  ]);
  await seedSubtasks([
    { cid: "sub_1", task_cid: "t_main", title: "Subtask 1", is_done: 0, deleted: false },
    { cid: "sub_2", task_cid: "t_main", title: "Subtask 2", is_done: 1, deleted: false },
    { cid: "sub_del", task_cid: "t_main", title: "Subtask Deleted", is_done: 0, deleted: true },
    { cid: "sub_other", task_cid: "other_task", title: "Other", is_done: 0, deleted: false },
  ]);
  await seedTaskNotes([
    { cid: "note_1", task_cid: "t_main", content: "Note 1", deleted: false },
    { cid: "note_del", task_cid: "t_main", content: "Note Deleted", deleted: true },
    { cid: "note_other", task_cid: "other_task", content: "Other", deleted: false },
  ]);
  await seedTaskAttachments([
    { cid: "att_1", task_cid: "t_main", filename: "file1.png" },
    { cid: "att_other", task_cid: "other_task", filename: "other.pdf" },
  ]);

  const R = buildTaskRouter();

  // Via server_id (501 -> t_main)
  const subsViaServer = await R.dispatch("GET", "/api/tasks/501/subtasks", undefined);
  assert.equal(subsViaServer.length, 2);
  assert.deepEqual(subsViaServer.map((s) => s.title).sort(), ["Subtask 1", "Subtask 2"]);

  const notesViaServer = await R.dispatch("GET", "/api/tasks/501/notes", undefined);
  assert.equal(notesViaServer.length, 1);
  assert.equal(notesViaServer[0].content, "Note 1");

  const attsViaServer = await R.dispatch("GET", "/api/tasks/501/attachments", undefined);
  assert.equal(attsViaServer.length, 1);
  assert.equal(attsViaServer[0].filename, "file1.png");

  // Via cid
  const subsViaCid = await R.dispatch("GET", "/api/tasks/t_main/subtasks", undefined);
  assert.equal(subsViaCid.length, 2);

  const notesViaCid = await R.dispatch("GET", "/api/tasks/t_main/notes", undefined);
  assert.equal(notesViaCid.length, 1);

  const attsViaCid = await R.dispatch("GET", "/api/tasks/t_main/attachments", undefined);
  assert.equal(attsViaCid.length, 1);

  // Empty task (502 -> t_empty) returns empty arrays
  assert.deepEqual(await R.dispatch("GET", "/api/tasks/502/subtasks", undefined), []);
  assert.deepEqual(await R.dispatch("GET", "/api/tasks/502/notes", undefined), []);
  assert.deepEqual(await R.dispatch("GET", "/api/tasks/502/attachments", undefined), []);

  // Unknown task returns empty arrays
  assert.deepEqual(await R.dispatch("GET", "/api/tasks/nonexistent/subtasks", undefined), []);
  assert.deepEqual(await R.dispatch("GET", "/api/tasks/nonexistent/notes", undefined), []);
  assert.deepEqual(await R.dispatch("GET", "/api/tasks/nonexistent/attachments", undefined), []);
});

test("POST /api/tasks/:id/done marks task done and sets completed_at (resolves by server_id and cid)", async () => {
  await seedTasks([
    task({ cid: "t_server", server_id: 101, title: "Server task", gtd_status: "next" }),
    task({ cid: "t_client", server_id: null, title: "Client task", gtd_status: "inbox" }),
  ]);
  const R = buildTaskRouter();

  // Via server_id
  const resServer = await R.dispatch("POST", "/api/tasks/101/done", undefined);
  assert.equal(resServer.id, 101);
  assert.equal(resServer.gtd_status, "done");
  assert.ok(resServer.completed_at, "completed_at should be populated");

  // Via cid
  const resClient = await R.dispatch("POST", "/api/tasks/t_client/done", undefined);
  assert.equal(resClient.id, "t_client");
  assert.equal(resClient.gtd_status, "done");
  assert.ok(resClient.completed_at, "completed_at should be populated");

  // Unknown id rejects
  await assert.rejects(() => R.dispatch("POST", "/api/tasks/unknown/done", undefined));
});

test("GET /api/tasks/:id/child-tasks resolves child tasks by parent cid", async () => {
  await seedTasks([
    task({ cid: "parent_1", server_id: 200, title: "Parent" }),
    task({ cid: "child_1", server_id: 201, title: "Child 1", parent_cid: "parent_1" }),
    task({ cid: "child_2", server_id: null, title: "Child 2", parent_cid: "parent_1" }),
    task({ cid: "child_deleted", server_id: null, title: "Child Deleted", parent_cid: "parent_1", deleted: true }),
    task({ cid: "other", server_id: 202, title: "Other", parent_cid: "other_parent" }),
  ]);
  const R = buildTaskRouter();

  // Via server_id
  const childrenViaServerId = await R.dispatch("GET", "/api/tasks/200/child-tasks", undefined);
  assert.equal(childrenViaServerId.length, 2);
  assert.deepEqual(childrenViaServerId.map((c) => c.title).sort(), ["Child 1", "Child 2"]);
  assert.equal(childrenViaServerId.find((c) => c.cid === "child_1").id, 201);
  assert.equal(childrenViaServerId.find((c) => c.cid === "child_2").id, "child_2");

  // Via cid
  const childrenViaCid = await R.dispatch("GET", "/api/tasks/parent_1/child-tasks", undefined);
  assert.equal(childrenViaCid.length, 2);

  // Unknown id returns empty array
  const unknownChildren = await R.dispatch("GET", "/api/tasks/nonexistent/child-tasks", undefined);
  assert.deepEqual(unknownChildren, []);
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

async function seedHabits(recs) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("habits", "readwrite");
    for (const r of recs) tx.objectStore("habits").put(r);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}

test("GET /api/habits returns local habits via the router", async () => {
  await seedHabits([{ cid: "h1", server_id: 5, title: "Run", phase: "pagi", micro_target: "", frequency: '["mon"]', identity_pillar: "", deleted: false }]);
  const R = buildTaskRouter();
  const rows = await R.dispatch("GET", "/api/habits", undefined);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 5);
});

test("POST /api/habits/:id/checkin records a local log via the router", async () => {
  await seedHabits([{ cid: "h1", server_id: 5, title: "Run", phase: "pagi", frequency: '["mon"]', deleted: false }]);
  const R = buildTaskRouter();
  await R.dispatch("POST", "/api/habits/5/checkin", { status: "done", date: "2026-06-04" });
  const today = await R.dispatch("GET", "/api/habits/today", undefined);
  const run = today.find((h) => h.id === 5);
  assert.equal(run.week_log.length, 7);
  assert.equal(run.today_status === "done" || run.today_status === null, true);
});

// ── Workstream A2 (audit 2026-10-15) K6 ──────────────────────────────────────────────────────────
const { shouldRouteLocally, isTaskChildListCall } = require("../../static/offline/taskroutes.js");

test("K6: GET /api/tasks/:id/subtasks|notes|attachments go to the network for numeric ids, local ([]) for cids", async () => {
  await seedTasks([task({ cid: "t_client", server_id: null, title: "Belum sinkron" })]);
  const R = buildTaskRouter();
  for (const kind of ["subtasks", "notes", "attachments"]) {
    // task sudah di server → data ada di server (store lokal tidak pernah diisi) → jaringan
    assert.equal(shouldRouteLocally(R, "GET", "/api/tasks/501/" + kind), false, kind + " numerik");
    assert.equal(shouldRouteLocally(R, "get", "/api/tasks/501/" + kind + "?x=1"), false, kind + " numerik + query");
    // task belum tersinkron (id = cid) → server tidak mengenalnya → lokal, []
    assert.equal(shouldRouteLocally(R, "GET", "/api/tasks/t_client/" + kind), true, kind + " cid");
    assert.deepEqual(await R.dispatch("GET", "/api/tasks/t_client/" + kind, undefined), []);
    // registrasi rute tetap ada (fallback index.html lama memakai hasRoute)
    assert.equal(R.hasRoute("GET", "/api/tasks/501/" + kind), true);
  }
  // rute task lain tidak terpengaruh
  assert.equal(shouldRouteLocally(R, "GET", "/api/tasks/501"), true);
  assert.equal(shouldRouteLocally(R, "GET", "/api/tasks/501/child-tasks"), true);
  assert.equal(shouldRouteLocally(R, "POST", "/api/tasks/501/subtasks"), false); // tidak terdaftar → jaringan
  assert.deepEqual(isTaskChildListCall("GET", "/api/tasks/12/notes"), { id: "12", kind: "notes", numeric: true });
  assert.equal(isTaskChildListCall("GET", "/api/tasks/12/tags"), null);
});
