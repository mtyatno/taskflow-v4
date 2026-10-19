"use strict";
// PR 5 Task 2 — cache project offline + route lokal sadar scope.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { metaGet, metaSet } = require("../../static/offline/meta.js");
const PC = require("../../static/offline/projectcache.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");
const { taskFromServer } = require("../../static/offline/hydrate.js");
const { createTask, updateTask, getRaw } = require("../../static/offline/taskrepo.js");
const { taskToCreatePayload, taskToUpdatePayload, pushOutbox } = require("../../static/offline/syncpush.js");
const { pullAndReconcile } = require("../../static/offline/syncpull.js");
const { mapPut } = require("../../static/offline/idmap.js");
const { outboxAll, outboxRemove } = require("../../static/offline/outbox.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

const FULL_PATH = "/api/projects?format=full&scope=all&include_archived=1";

function httpRes(status, body) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}
function proj(over) {
  return Object.assign({
    id: 1, name: "P", list_id: null, user_id: 1, color: null, archived: 0,
    created_by: 1, active_task_count: 0, can_manage: true,
  }, over);
}
async function put(store, recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    for (const r of recs) os.put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
function task(over) {
  return Object.assign({
    cid: over.cid, server_id: null, title: over.cid, description: "", gtd_status: "next",
    priority: "P3", quadrant: "Q4", project: "", project_id: null, context: "", deadline: null,
    waiting_for: "", assigned_to: null, progress: 0, parent_cid: null, list_id: null,
    recurrence_type: null, recurrence_days: null, deleted: false, dirty: 0,
  }, over);
}
async function seedCache(items) { await metaSet("projects:v1", { at: 1, items }); }
function fakeTransport(handler) {
  const calls = [];
  return {
    calls,
    request(method, path, body) {
      calls.push({ method, path, body });
      return Promise.resolve(handler(method, path, body));
    },
  };
}

// ── refresh ──────────────────────────────────────────────────────────────────────────────
test("refresh GETs the full all-scope list (incl. archived) and stores {at, items} under projects:v1", async () => {
  const calls = [];
  const items = [proj({ id: 1, name: "Alpha" }), proj({ id: 2, name: "Beta", list_id: 5 })];
  await PC.refresh((u) => { calls.push(u); return Promise.resolve(httpRes(200, items)); });
  assert.deepEqual(calls, [FULL_PATH]);
  const v = await metaGet("projects:v1");
  assert.equal(typeof v.at, "number");
  assert.deepEqual(v.items, items);
});

test("refresh failure (5xx / non-array) rejects and keeps the previous cache", async () => {
  await seedCache([proj({ id: 1, name: "Keep" })]);
  await assert.rejects(PC.refresh(() => Promise.resolve(httpRes(503, { detail: "OFFLINE" }))));
  await assert.rejects(PC.refresh(() => Promise.resolve(httpRes(200, { detail: "weird" }))));
  assert.deepEqual((await metaGet("projects:v1")).items.map((p) => p.name), ["Keep"]);
});

// ── names / list / idFor ────────────────────────────────────────────────────────────────────
test("names: personal and workspace scopes never mix (same name in both)", async () => {
  await seedCache([
    proj({ id: 1, name: "taskflow", list_id: null }),
    proj({ id: 2, name: "taskflow", list_id: 7 }),
    proj({ id: 3, name: "OnlyW", list_id: 7 }),
    proj({ id: 4, name: "OnlyPersonal", list_id: null }),
    proj({ id: 5, name: "OtherW", list_id: 8 }),
  ]);
  assert.deepEqual(await PC.names(null), ["OnlyPersonal", "taskflow"]);
  assert.deepEqual(await PC.names(7), ["OnlyW", "taskflow"]);
  assert.deepEqual(await PC.names("7"), ["OnlyW", "taskflow"], "list_id from a query string is a string");
  assert.deepEqual(await PC.names(8), ["OtherW"]);
});

test("names: includes active local task projects of the same scope, dedups + sorts NOCASE, skips archived", async () => {
  await seedCache([
    proj({ id: 1, name: "Alpha" }),
    proj({ id: 2, name: "Old", archived: 1 }),
    proj({ id: 3, name: "wsProj", list_id: 7 }),
  ]);
  await put("tasks", [
    task({ cid: "a", project: "alpha" }),            // dup of cache "Alpha" (NOCASE)
    task({ cid: "b", project: "beta" }),             // task-only name
    task({ cid: "c", project: "Gamma", list_id: 7 }), // other scope
    task({ cid: "d", project: "Done", gtd_status: "done" }),
    task({ cid: "e", project: "Gone", deleted: true }),
    task({ cid: "f", project: "" }),
    task({ cid: "g", project: "BETA" }),             // dup of task "beta"
  ]);
  assert.deepEqual(await PC.names(null), ["Alpha", "beta"]);
  assert.deepEqual(await PC.names(7), ["Gamma", "wsProj"]);
});

test("names: NOCASE is ASCII-only and sorting matches SQLite NOCASE ordering", async () => {
  await seedCache([proj({ id: 1, name: "b" }), proj({ id: 2, name: "A" }), proj({ id: 3, name: "_x" }), proj({ id: 4, name: "Éa" }), proj({ id: 5, name: "éa" })]);
  // NOCASE folds A–Z only, then compares bytes: "_"(0x5F) < "a"(0x61); "É" ≠ "é" (non-ASCII not folded)
  assert.deepEqual(await PC.names(null), ["_x", "A", "b", "Éa", "éa"]);
});

test("names: empty cache (never synced) → only local task names, no error", async () => {
  await put("tasks", [task({ cid: "a", project: "Web" }), task({ cid: "b", project: "Ws", list_id: 3 })]);
  assert.deepEqual(await PC.names(null), ["Web"]);
  assert.deepEqual(await PC.names(3), ["Ws"]);
  assert.deepEqual(await PC.list(null), []);
  assert.equal(await PC.idFor(null, "Web"), null);
});

test("list filters by scope and archived flag; idFor matches NOCASE within scope", async () => {
  await seedCache([
    proj({ id: 1, name: "Alpha" }),
    proj({ id: 2, name: "Old", archived: 1 }),
    proj({ id: 3, name: "Alpha", list_id: 7 }),
  ]);
  assert.deepEqual((await PC.list(null)).map((p) => p.id), [1]);
  assert.deepEqual((await PC.list(null, { includeArchived: true })).map((p) => p.id), [1, 2]);
  assert.deepEqual((await PC.list(7)).map((p) => p.id), [3]);
  assert.equal(await PC.idFor(null, "ALPHA"), 1);
  assert.equal(await PC.idFor(7, "alpha"), 3);
  assert.equal(await PC.idFor("7", "alpha"), 3);
  assert.equal(await PC.idFor(8, "alpha"), null);
  assert.equal(await PC.idFor(null, ""), null);
});

// ── route lokal ──────────────────────────────────────────────────────────────────────────────
test("local GET /api/projects: no query → personal names; ?list_id=W → names(W); ?format=full → list", async () => {
  await seedCache([
    proj({ id: 1, name: "Pers" }),
    proj({ id: 2, name: "Arch", archived: 1 }),
    proj({ id: 3, name: "Ws", list_id: 7 }),
  ]);
  await put("tasks", [task({ cid: "a", project: "Web" }), task({ cid: "b", project: "WsTask", list_id: 7 })]);
  const R = buildTaskRouter();
  assert.deepEqual(await R.dispatch("GET", "/api/projects", undefined), ["Pers", "Web"]);
  assert.deepEqual(await R.dispatch("GET", "/api/projects?list_id=7", undefined), ["Ws", "WsTask"]);
  assert.deepEqual((await R.dispatch("GET", "/api/projects?format=full", undefined)).map((p) => p.id), [1]);
  assert.deepEqual((await R.dispatch("GET", "/api/projects?format=full&include_archived=1", undefined)).map((p) => p.id), [1, 2]);
  assert.deepEqual((await R.dispatch("GET", "/api/projects?format=full&list_id=7", undefined)).map((p) => p.id), [3]);
});

test("POST/PATCH/DELETE /api/projects are not served locally", () => {
  const R = buildTaskRouter();
  assert.equal(R.hasRoute("POST", "/api/projects"), false);
  assert.equal(R.hasRoute("PATCH", "/api/projects/3"), false);
  assert.equal(R.hasRoute("DELETE", "/api/projects/3"), false);
  assert.equal(R.hasRoute("GET", "/api/projects"), true);
});

// ── hydrate ──────────────────────────────────────────────────────────────────────────────────
test("hydrate copies project_id (null when absent)", () => {
  const r1 = taskFromServer({ id: 1, title: "t", project: "A", project_id: 9 }, () => "c1");
  assert.equal(r1.project_id, 9);
  const r2 = taskFromServer({ id: 2, title: "t", project: "" }, () => "c2");
  assert.equal(r2.project_id, null);
});

// ── taskrepo ─────────────────────────────────────────────────────────────────────────────────
test("createTask stores project_id: explicit wins, else resolved from cache in the task's scope, else null", async () => {
  await seedCache([proj({ id: 1, name: "Alpha" }), proj({ id: 3, name: "Alpha", list_id: 7 })]);
  const a = await createTask({ title: "a", project: "Alpha", project_id: 42 }, { today: "2026-10-19" });
  assert.equal((await getRaw(a.cid)).project_id, 42);
  const b = await createTask({ title: "b", project: "alpha" }, { today: "2026-10-19" });
  assert.equal((await getRaw(b.cid)).project_id, 1);
  const c = await createTask({ title: "c", project: "Alpha", list_id: 7 }, { today: "2026-10-19" });
  assert.equal((await getRaw(c.cid)).project_id, 3);
  const d = await createTask({ title: "d", project: "Nope" }, { today: "2026-10-19" });
  assert.equal((await getRaw(d.cid)).project_id, null);
  const e = await createTask({ title: "e" }, { today: "2026-10-19" });
  assert.equal((await getRaw(e.cid)).project_id, null);
});

test("updateTask: patch project without project_id → id from cache if it matches, else null; untouched project keeps id", async () => {
  await seedCache([proj({ id: 1, name: "Alpha" }), proj({ id: 2, name: "Beta" })]);
  await put("tasks", [task({ cid: "t", project: "Alpha", project_id: 1, rev: 1 })]);
  await updateTask("t", { title: "renamed" }, { today: "2026-10-19" });
  assert.equal((await getRaw("t")).project_id, 1);
  await updateTask("t", { project: "beta" }, { today: "2026-10-19" });
  assert.equal((await getRaw("t")).project_id, 2);
  await updateTask("t", { project: "Brand new" }, { today: "2026-10-19" });
  assert.equal((await getRaw("t")).project_id, null);
  await updateTask("t", { project: "Alpha", project_id: 77 }, { today: "2026-10-19" });
  assert.equal((await getRaw("t")).project_id, 77);
  await updateTask("t", { project: "" }, { today: "2026-10-19" });
  assert.equal((await getRaw("t")).project_id, null);
});

// ── syncpush payload ─────────────────────────────────────────────────────────────────────────
test("payload carries project_id only when the record's project text matches the cached project (NOCASE)", () => {
  const items = [proj({ id: 1, name: "Alpha" }), proj({ id: 3, name: "Ws", list_id: 7 })];
  const match = task({ cid: "a", project: "alpha", project_id: 1 });
  assert.equal(taskToCreatePayload(match, [], null, items).project_id, 1);
  assert.equal(taskToUpdatePayload(match, [], items).project_id, 1);
  const renamedLocally = task({ cid: "b", project: "Other", project_id: 1 });
  assert.equal("project_id" in taskToCreatePayload(renamedLocally, [], null, items), false);
  assert.equal("project_id" in taskToUpdatePayload(renamedLocally, [], items), false);
  const unknownId = task({ cid: "c", project: "Alpha", project_id: 99 });
  assert.equal("project_id" in taskToUpdatePayload(unknownId, [], items), false);
  const noId = task({ cid: "d", project: "Alpha", project_id: null });
  assert.equal("project_id" in taskToUpdatePayload(noId, [], items), false);
  const wrongScope = task({ cid: "e", project: "Ws", project_id: 3, list_id: null });
  assert.equal("project_id" in taskToCreatePayload(wrongScope, [], null, items), false);
  // no cache passed (old callers) → text only
  assert.equal("project_id" in taskToUpdatePayload(match, []), false);
  assert.equal(taskToUpdatePayload(match, []).project, "alpha");
});

test("pushOutbox sends project_id from the cache and adopts project + project_id from the response", async () => {
  await seedCache([proj({ id: 1, name: "Alpha" })]);
  await put("tasks", [task({ cid: "a", project: "Alpha", project_id: 1, dirty: 1, rev: 1 })]);
  const { outboxAdd } = require("../../static/offline/outbox.js");
  await outboxAdd({ op: "create", entity_type: "task", cid: "a", payload: {} });
  const tr = fakeTransport((m, p) => {
    if (m === "POST" && p === "/api/tasks") return { ok: true, status: 201, data: { id: 50, updated_at: "u1", project: "ALPHA", project_id: 1 } };
    return { ok: true, status: 200, data: {} };
  });
  await pushOutbox(tr);
  const post = tr.calls.find((c) => c.method === "POST");
  assert.equal(post.body.project_id, 1);
  const rec = await getRaw("a");
  assert.equal(rec.project, "ALPHA");
  assert.equal(rec.project_id, 1);
  for (const o of await outboxAll()) await outboxRemove(o.qid);
});

test("pushOutbox update: server clearing project_id (stale id ignored) is adopted", async () => {
  await seedCache([proj({ id: 1, name: "Alpha" })]);
  await put("tasks", [task({ cid: "a", server_id: 60, project: "Alpha", project_id: 1, dirty: 1, rev: 1, base_rev: "x" })]);
  await mapPut("task", 60, "a");
  const { outboxAdd } = require("../../static/offline/outbox.js");
  await outboxAdd({ op: "update", entity_type: "task", cid: "a", payload: {} });
  const tr = fakeTransport(() => ({ ok: true, status: 200, data: { id: 60, updated_at: "u2", project: "Alpha", project_id: 5 } }));
  await pushOutbox(tr);
  assert.equal(tr.calls[0].body.project_id, 1);
  assert.equal((await getRaw("a")).project_id, 5);
});

// ── syncpull ─────────────────────────────────────────────────────────────────────────────────
test("pullAndReconcile refreshes the project cache after the task pull", async () => {
  const items = [proj({ id: 1, name: "Alpha" })];
  const seen = [];
  const rawFetch = (u) => {
    seen.push(u);
    if (u === "/api/tasks?include_done=true") return Promise.resolve(httpRes(200, []));
    if (u === FULL_PATH) return Promise.resolve(httpRes(200, items));
    return Promise.resolve(null);
  };
  await pullAndReconcile(rawFetch);
  assert.ok(seen.indexOf(FULL_PATH) > seen.indexOf("/api/tasks?include_done=true"));
  assert.deepEqual((await metaGet("projects:v1")).items, items);
});

test("pullAndReconcile still succeeds when the project refresh fails", async () => {
  const rawFetch = (u) => {
    if (u === "/api/tasks?include_done=true") return Promise.resolve(httpRes(200, []));
    if (u === FULL_PATH) return Promise.reject(new Error("net"));
    return Promise.resolve(null);
  };
  const res = await pullAndReconcile(rawFetch);
  assert.equal(typeof res.created, "number");
  assert.equal(await metaGet("projects:v1"), undefined);
});

test("pullAndReconcile does not refresh projects when the task pull fails", async () => {
  const seen = [];
  const rawFetch = (u) => { seen.push(u); return Promise.resolve(httpRes(503, { detail: "OFFLINE" })); };
  await assert.rejects(pullAndReconcile(rawFetch));
  assert.equal(seen.includes(FULL_PATH), false);
});

test("pullTasks adopts project/project_id on a clean record even when updated_at is unchanged (server backfill)", async () => {
  const { pullTasks } = require("../../static/offline/syncpull.js");
  await put("tasks", [task({ cid: "a", server_id: 70, project: "alpha", project_id: null, dirty: 0, base_rev: "u0", updated_at: "u0", rev: 1 })]);
  await mapPut("task", 70, "a");
  const srv = { id: 70, title: "a", gtd_status: "next", priority: "P3", quadrant: "Q4", project: "Alpha", project_id: 4,
    context: "", deadline: null, waiting_for: "", completed_at: null, progress: 0, is_focused: 0, updated_at: "u0" };
  await pullTasks([srv]);
  const rec = await getRaw("a");
  assert.equal(rec.project_id, 4);
  assert.equal(rec.project, "Alpha");
});
