# Offline Wiring `index.html` Implementation Plan (#1e-b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the task domain run local-first in the browser — intercept the `api` object so ported task routes are served from IndexedDB via `LocalRouter`, with boot-time hydration pulling tasks from the server once.

**Architecture:** Two new Node-tested modules — `taskroutes.js` (builds a `LocalRouter` registering every ported task route → `taskrepo`/`taskquery`/`tagrepo`/`recurrence`, with `id⇄cid` resolution and response shaping) and `hydrate.js` (maps server task dicts → local records and upserts them). Then minimal, browser-verified edits to `static/index.html` (load module `<script>`s, rename the legacy `OfflineDB` database, intercept `api.fetch`, call hydration in `fetchAll`) and `static/sw.js` (cache bump + precache).

**Tech Stack:** Vanilla ES2017 JS, IndexedDB, `node:test`, `fake-indexeddb`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-03-offline-index-wiring-design.md`

---

## Key facts (verified)

- `static/index.html` in git is **already compiled** (plain `React.createElement`, no `<script type="text/babel">`), so direct edits are correct and `compile.js` is a no-op on it. Any code added must be plain JS (no JSX).
- The `api` object is at `static/index.html:1382`; all verbs funnel through `async fetch(url, opts={})`. `OfflineDB` IIFE is at `:1337` with `NAME = "taskflow-offline", VER = 1` (line 1338) — collides with `db.js` (`"taskflow-offline"` v2). The data-load `fetchAll` is at `:20493`.
- `static/sw.js`: `CACHE = "taskflow-v109-katex-patch"` (line 1), `STATIC` array lines 2–36.
- Module APIs: `router.makeRouter()` → `{register, dispatch, hasRoute}`; `idmap.{mapPut(type,serverId,cid), cidOf(type,serverId), serverIdOf(cid)}`; `meta.{metaGet,metaSet}`; `db.openDB()`; repos/query/tagrepo/recurrence exports as built in #1c–#1e(a).

## File structure

```
static/offline/taskroutes.js     # NEW — buildTaskRouter(), isNoteTagsCall(), id⇄cid resolution, shaping
static/offline/hydrate.js        # NEW — taskFromServer(), hydrateTasks(), ensureTasks()
tests/offline/taskroutes.test.js # NEW
tests/offline/hydrate.test.js    # NEW
static/index.html                # MODIFY — script tags, rename OfflineDB, intercept api.fetch, hydration call
static/sw.js                     # MODIFY — cache bump + precache offline modules
```

---

## Task 1: `taskroutes.js`

**Files:**
- Create: `static/offline/taskroutes.js`
- Test: `tests/offline/taskroutes.test.js`

- [ ] **Step 1: Write the failing test `tests/offline/taskroutes.test.js`**

```js
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
  // persisted
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/taskroutes.test.js`
Expected: FAIL — cannot find module `taskroutes.js`.

- [ ] **Step 3: Write `static/offline/taskroutes.js`**

```js
;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  const isNode = (typeof module !== "undefined" && module.exports);
  const req = (m, g) => (isNode ? require(m) : g);
  const TFdb = req("./db.js", root.TF && root.TF.db);
  const TFrouter = req("./router.js", root.TF && root.TF.router);
  const TFrepo = req("./taskrepo.js", root.TF && root.TF.taskrepo);
  const TFquery = req("./taskquery.js", root.TF && root.TF.taskquery);
  const TFtag = req("./tagrepo.js", root.TF && root.TF.tagrepo);
  const TFrec = req("./recurrence.js", root.TF && root.TF.recurrence);

  function todayISO() {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  }

  function getAllTasks() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("tasks", "readonly").objectStore("tasks").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }

  function displayIdOf(rec) {
    return rec.server_id != null ? rec.server_id : rec.cid;
  }

  function withId(row) {
    if (!row) return row;
    row.id = displayIdOf(row);
    return row;
  }

  // Resolve a path id (string) to a local cid: direct cid match, else by server_id.
  function resolveCid(idOrCid) {
    return getAllTasks().then((all) => {
      for (const r of all) if (r.cid === idOrCid) return r.cid;
      for (const r of all) if (r.server_id != null && String(r.server_id) === String(idOrCid)) return r.cid;
      return null;
    });
  }

  function notFound() { return Promise.reject(new Error("Task not found")); }

  // GET /api/tags?entity_type=note must stay on the network (note tags not local yet).
  function isNoteTagsCall(method, path) {
    if (method.toUpperCase() !== "GET") return false;
    const q = path.indexOf("?");
    if (q === -1) return false;
    const base = path.slice(0, q).replace(/\/+$/, "");
    if (base !== "/api/tags") return false;
    return /(^|&)entity_type=note(&|$)/.test(path.slice(q + 1));
  }

  function buildTaskRouter() {
    const router = TFrouter.makeRouter();
    const opts = () => ({ today: todayISO() });

    router.register("GET", "/api/tasks", ({ query }) =>
      TFquery.listTasks(query, opts()).then((rows) => rows.map(withId)));

    router.register("GET", "/api/tasks/:id", ({ params }) =>
      resolveCid(params.id).then((cid) => (cid ? TFrepo.getTask(cid, todayISO()) : null))
        .then((row) => (row ? withId(row) : notFound())));

    router.register("POST", "/api/tasks", ({ body }) =>
      TFrepo.createTask(body || {}, opts()).then(withId));

    router.register("PUT", "/api/tasks/:id", ({ params, body }) =>
      resolveCid(params.id).then((cid) => (cid ? TFrepo.updateTask(cid, body || {}, opts()) : notFound())).then(withId));

    router.register("DELETE", "/api/tasks/:id", ({ params }) =>
      resolveCid(params.id).then((cid) => (cid ? TFrepo.deleteTask(cid, opts()) : notFound())));

    router.register("GET", "/api/summary", () => TFquery.getSummary(opts()));
    router.register("GET", "/api/projects", () => TFquery.getProjects());
    router.register("GET", "/api/contexts", () => TFquery.getContexts());

    router.register("GET", "/api/tasks/:id/tags", ({ params }) =>
      resolveCid(params.id).then((cid) => (cid ? TFtag.getEntityTags("task", cid) : notFound())));

    router.register("GET", "/api/tags", () => TFtag.getAllTags());

    router.register("DELETE", "/api/tasks/:id/tags/:name", ({ params }) =>
      resolveCid(params.id).then((cid) => (cid ? TFtag.removeEntityTag("task", cid, params.name) : notFound())));

    router.register("GET", "/api/recurring/exceptions", ({ query }) =>
      Promise.all([TFrec.getExceptions(query.from, query.to), getAllTasks()]).then(([byCid, all]) => {
        const disp = {};
        for (const r of all) disp[r.cid] = displayIdOf(r);
        const out = {};
        for (const cid in byCid) out[String(disp[cid] != null ? disp[cid] : cid)] = byCid[cid];
        return out;
      }));

    router.register("POST", "/api/tasks/:id/occurrences/:date/mark", ({ params, body }) =>
      resolveCid(params.id).then((cid) => (cid ? TFrec.markOccurrence(cid, params.date, (body || {}).status, {}) : notFound())));

    return router;
  }

  const exported = { buildTaskRouter, isNoteTagsCall };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.taskroutes = exported; }
  return exported;
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/taskroutes.test.js`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add static/offline/taskroutes.js tests/offline/taskroutes.test.js
git commit -m "feat(offline): taskroutes LocalRouter (ported task routes + id<->cid)"
```

---

## Task 2: `hydrate.js`

**Files:**
- Create: `static/offline/hydrate.js`
- Test: `tests/offline/hydrate.test.js`

- [ ] **Step 1: Write the failing test `tests/offline/hydrate.test.js`**

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { taskFromServer, hydrateTasks, ensureTasks } = require("../../static/offline/hydrate.js");

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

test("ensureTasks fetches once and hydrates; second call does not re-fetch", async () => {
  let calls = 0;
  const rawFetch = async (url) => { calls++; return { json: async () => [serverTask({ id: 1 })] }; };
  await ensureTasks(rawFetch);
  await ensureTasks(rawFetch);
  assert.equal(calls, 1);
  assert.equal((await allTasks()).length, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/hydrate.test.js`
Expected: FAIL — cannot find module `hydrate.js`.

- [ ] **Step 3: Write `static/offline/hydrate.js`**

```js
;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  const isNode = (typeof module !== "undefined" && module.exports);
  const req = (m, g) => (isNode ? require(m) : g);
  const TFdb = req("./db.js", root.TF && root.TF.db);
  const TFids = req("./ids.js", root.TF && root.TF.ids);
  const TFidmap = req("./idmap.js", root.TF && root.TF.idmap);
  const TFmeta = req("./meta.js", root.TF && root.TF.meta);

  const COPY = [
    "title", "description", "gtd_status", "priority", "quadrant", "project", "context",
    "deadline", "waiting_for", "completed_at", "progress", "is_focused", "assigned_to",
    "recurrence_type", "recurrence_days", "recurrence_end_date", "recurrence_notif_level",
    "created_at", "updated_at",
  ];

  // Pure: server task dict → local record. `getCid(serverId)` returns the cid for any server id.
  function taskFromServer(dict, getCid) {
    const rec = { cid: getCid(dict.id), server_id: dict.id };
    for (const k of COPY) rec[k] = dict[k] != null ? dict[k] : (k === "is_focused" || k === "progress" ? 0 : null);
    rec.title = dict.title;
    rec.parent_cid = dict.parent_id != null ? getCid(dict.parent_id) : null;
    rec.list_cid = null;
    rec.deleted = false;
    rec.dirty = 0;
    rec.base_rev = dict.updated_at != null ? dict.updated_at : null;
    return rec;
  }

  // Ensure a stable cid for a server id via _idmap; create + persist if missing.
  function ensureCid(serverId, cache) {
    if (cache[serverId]) return Promise.resolve(cache[serverId]);
    return TFidmap.cidOf("task", serverId).then((cid) => {
      if (cid) { cache[serverId] = cid; return cid; }
      const fresh = TFids.newCid();
      cache[serverId] = fresh;
      return TFidmap.mapPut("task", serverId, fresh).then(() => fresh);
    });
  }

  function putTask(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      tx.objectStore("tasks").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function hydrateTasks(serverTasks) {
    const list = serverTasks || [];
    const cache = {};
    // Pass 1: assign a cid to every server id (so parents resolve in pass 2).
    return list.reduce((p, d) => p.then(() => ensureCid(d.id, cache)), Promise.resolve())
      .then(() => {
        const getCid = (sid) => cache[sid] || null;
        // Pass 2: upsert each record.
        return list.reduce((p, d) => p.then(() => putTask(taskFromServer(d, getCid))), Promise.resolve());
      });
  }

  let _ensurePromise = null;
  function ensureTasks(rawFetch) {
    if (_ensurePromise) return _ensurePromise;
    _ensurePromise = Promise.resolve()
      .then(() => rawFetch("/api/tasks?include_done=true"))
      .then((res) => (res && typeof res.json === "function" ? res.json() : res))
      .then((tasks) => hydrateTasks(tasks || []))
      .then(() => TFmeta.metaSet("tasks_hydrated_at", new Date().toISOString()))
      .catch((e) => { _ensurePromise = null; throw e; });
    return _ensurePromise;
  }

  const exported = { taskFromServer, hydrateTasks, ensureTasks };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.hydrate = exported; }
  return exported;
});
```

> Note on `taskFromServer`: the `COPY` loop seeds defaults, but `title` is then forced to `dict.title` (tests rely on exact title). `is_focused`/`progress` default to `0`, others to `null` when the server omits them.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/hydrate.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add static/offline/hydrate.js tests/offline/hydrate.test.js
git commit -m "feat(offline): hydrate (server task dicts -> local records)"
```

---

## Task 3: Full Node-suite regression (modules)

- [ ] **Step 1: Run the whole offline suite (now 13 files)**

Run:
```bash
node --test tests/offline/smoke.test.js tests/offline/ids.test.js tests/offline/db.test.js tests/offline/meta.test.js tests/offline/idmap.test.js tests/offline/outbox.test.js tests/offline/blobstore.test.js tests/offline/router.test.js tests/offline/tasklogic.test.js tests/offline/taskrepo.test.js tests/offline/taskquery.test.js tests/offline/tagrepo.test.js tests/offline/recurrence.test.js tests/offline/taskroutes.test.js tests/offline/hydrate.test.js
```
Expected: `ℹ tests 126 / ℹ pass 126 / ℹ fail 0`, terminating promptly.

> Count: prior 106 + Task 1 (13) + Task 2 (7) = **126**.

- [ ] **Step 2: No commit** (regression run only). Fix any failure before continuing.

---

## Task 4: Wire `static/index.html` (browser-verified)

**Files:**
- Modify: `static/index.html` (script tags before :1306; rename :1338; intercept in `api.fetch` :1383; hydration in `fetchAll` :20493)

> No Node test — this is browser-verified. Make each edit exactly, then run the manual verification in Step 6.

- [ ] **Step 1: Add the offline module `<script>` tags before the app script**

Find the app script start (the `<script>` immediately after the katex-patch script closes, at `static/index.html:1306`). Insert these lines immediately BEFORE that `<script>` line:

```html
  <script src="/static/offline/ids.js"></script>
  <script src="/static/offline/db.js"></script>
  <script src="/static/offline/meta.js"></script>
  <script src="/static/offline/idmap.js"></script>
  <script src="/static/offline/outbox.js"></script>
  <script src="/static/offline/blobstore.js"></script>
  <script src="/static/offline/router.js"></script>
  <script src="/static/offline/tasklogic.js"></script>
  <script src="/static/offline/tagrepo.js"></script>
  <script src="/static/offline/taskrepo.js"></script>
  <script src="/static/offline/taskquery.js"></script>
  <script src="/static/offline/recurrence.js"></script>
  <script src="/static/offline/taskroutes.js"></script>
  <script src="/static/offline/hydrate.js"></script>
```

- [ ] **Step 2: Rename the legacy `OfflineDB` database (avoid v2 collision)**

At `static/index.html:1338`, change:

```js
  const NAME = "taskflow-offline",
    VER = 1;
```

to:

```js
  const NAME = "taskflow-legacy-cache",
    VER = 1;
```

- [ ] **Step 3: Intercept `api.fetch` for ported task routes**

In the `api` object (`static/index.html:1383`), insert this block as the FIRST statements inside `async fetch(url, opts = {})` (before `const headers = {`):

```js
    // ── Offline local-first intercept (TF.taskroutes) ──
    const _R = window.TF && window.TF.taskroutes;
    if (_R) {
      let _router = null;
      try { _router = api._localRouter || (api._localRouter = _R.buildTaskRouter()); } catch (_) { _router = null; }
      if (_router) {
        const _method = (opts.method || "GET").toUpperCase();
        if (_router.hasRoute(_method, url) && !_R.isNoteTagsCall(_method, url)) {
          const _body = opts.body ? JSON.parse(opts.body) : undefined;
          return await _router.dispatch(_method, url, _body)
            .catch(err => { throw new Error(err && err.message ? err.message : "local route error"); });
        }
      }
    }
```

- [ ] **Step 4: Call hydration in `fetchAll` before the network reads**

In `fetchAll` (`static/index.html:20493`), find the line that defines `const calls = [[...]]` (currently at :20511) and the next line `const results = await Promise.allSettled(...)` (:20512). Insert BETWEEN them:

```js
    // Hydrate local tasks from the server once (token-aware raw fetch — bypasses the api intercept).
    if (navigator.onLine && __token && window.TF && window.TF.hydrate) {
      const _rawFetch = (u) => window.fetch(u, { headers: { Authorization: "Bearer " + __token } });
      try { await window.TF.hydrate.ensureTasks(_rawFetch); } catch (e) {}
    }
```

> Why a wrapper, not `window.fetch` directly: hydration must bypass the `api.fetch` intercept (so it hits the real server) but still send the bearer token, otherwise the server returns 401.

- [ ] **Step 5: Commit the wiring**

```bash
git add static/index.html
git commit -m "feat(offline): wire api intercept + hydration in index.html (#1e-b)"
```

- [ ] **Step 6: Browser verification (manual — record results)**

Start the app (ask the user to run it; this project deploys via git push but can be run locally). With DevTools open:

1. **Boot online:** load the app logged in. Application → IndexedDB shows TWO DBs: `taskflow-offline` (v2, stores incl. `tasks`, `_outbox`) and `taskflow-legacy-cache` (v1). Console has no errors. Task list/board renders (hydrated from server).
2. **Read offline:** DevTools → Network → Offline. Reload. Task list, summary, projects, contexts still render (served locally). No uncaught errors.
3. **Create offline:** create a task with a `#tag` in the title while offline. It appears in the list immediately; the tag is stripped from the title. `taskflow-offline.tasks` has the new record (cid, no server_id); `_outbox` has a `create` op.
4. **Filter by tag:** filter the list by that tag → the new task shows.
5. **Edit + delete offline:** edit the task (title/priority) and delete another → list updates; `_outbox` grows.
6. **Recurring:** open a recurring task, mark today's occurrence done → reflects; `recurring_exceptions` has a row; `/api/recurring/exceptions` (Network) is NOT hit (served locally).
7. **Back online:** toggle Network back online, reload → no errors; notes & habits still work (legacy cache intact).
8. **Limp check (expected):** marking a LOCAL-only task done via the checkmark hits `/api/tasks/<cid>/done` on the network and fails (404) — this is the documented, accepted limitation.

Report pass/fail for each. If anything errors, STOP and debug before Task 5.

---

## Task 5: Service Worker cache bump + precache

**Files:**
- Modify: `static/sw.js:1` (CACHE), `static/sw.js:2-36` (STATIC)

- [ ] **Step 1: Bump the cache version**

At `static/sw.js:1`, change:

```js
const CACHE = "taskflow-v109-katex-patch";
```

to:

```js
const CACHE = "taskflow-v110-offline-tasks";
```

- [ ] **Step 2: Add offline modules to the precache list**

In the `STATIC` array (`static/sw.js:2`), add these entries (e.g., right after the `"/"` line):

```js
  "/static/offline/ids.js",
  "/static/offline/db.js",
  "/static/offline/meta.js",
  "/static/offline/idmap.js",
  "/static/offline/outbox.js",
  "/static/offline/blobstore.js",
  "/static/offline/router.js",
  "/static/offline/tasklogic.js",
  "/static/offline/tagrepo.js",
  "/static/offline/taskrepo.js",
  "/static/offline/taskquery.js",
  "/static/offline/recurrence.js",
  "/static/offline/taskroutes.js",
  "/static/offline/hydrate.js",
```

- [ ] **Step 3: Browser verification**

Reload twice (first reload installs the new SW; second activates). DevTools → Application → Cache Storage shows `taskflow-v110-offline-tasks` containing the `/static/offline/*.js` files; the old `taskflow-v109-*` cache is gone. Hard-offline reload still boots the app shell + offline modules.

- [ ] **Step 4: Commit**

```bash
git add static/sw.js
git commit -m "chore(sw): bump cache v110 + precache offline modules"
```

---

## Done criteria

- `taskroutes.js` + `hydrate.js` exist, exported, Node-tested; full suite green (126).
- `api.fetch` serves ported task routes from IndexedDB; un-ported routes and `GET /api/tags?entity_type=note` fall through to the network.
- Boot online hydrates tasks once; list/board/summary/projects/contexts render from local.
- CRUD + tag filter + recurring mark/exceptions work offline in the browser; `id⇄cid` consistent.
- `OfflineDB` renamed (notes/habits not regressed); SW bumped to v110 with offline modules precached.
- All browser verification steps pass.

## Next (out of scope)

- Cleanup: delete `computeOfflineQuadrant` + the now-dead manual offline task branches once browser verification is stable.
- Port `/done`, `/focus`, sub-entities; sub-project #2 (sync engine).
```
