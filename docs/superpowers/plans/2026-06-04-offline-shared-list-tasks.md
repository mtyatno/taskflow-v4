# Offline Shared-List Tasks Implementation Plan (#2d-1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make shared lists and their tasks work offline — view lists + their tasks, create/edit/delete shared-list tasks offline, reusing the existing task sync/conflict engine.

**Architecture:** A new `lists` IndexedDB store (DB v3) mirrored from the server by a new `listsync.js`. Task records gain a server `list_id`. `taskroutes` serves `GET /api/lists` and `GET /api/lists/:id/tasks` from local data. Push sends `list_id` on create and, on HTTP 403 (removed from a list), removes the task locally. The conflict banner offers discard-only for shared tasks. Client-only, no backend changes.

**Tech Stack:** Vanilla ES2017 JS, IndexedDB, `node:test`, `fake-indexeddb`. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-04-offline-shared-list-tasks-design.md`

---

## Key facts (verified)

- Server `GET /api/tasks` already includes shared-list tasks (access_clause). `GET /api/lists` → `[{id,name,owner_id,created_at,role,member_count}]`. `GET /api/lists/{id}/tasks` → tasks `WHERE list_id=? AND gtd_status NOT IN ('done','archived') ORDER BY priority,deadline`; non-member → 403. `POST /api/tasks` accepts `list_id`; PUT/DELETE on a list you're not in → 403.
- `db.js`: `DB_VERSION = 2`, `ENTITY_STORES` object, `createSchema` adds any missing store (idempotent). `tests/offline/db.test.js:66` asserts `DB_VERSION is 2`; the "creates all entity stores" test is data-driven over `ENTITY_STORE_NAMES`.
- `hydrate.taskFromServer(dict, getCid)` sets `rec.list_cid = null` (drops list). `taskrepo.createTask` builds the record object. `syncpush.taskToCreatePayload` sets `list_id: null`; `opCreate`/`opUpdate` read the record; `opUpdate` already flags 404→conflict (from #2c). `idmap.mapDelete` exists. `taskroutes.buildTaskRouter` registers routes then `return router;` (has `withId`, `opts`, `TFquery` in scope). `syncconflict.listConflicts` maps `{cid,title,conflict}`.
- `static/index.html`: offline `<script>`s end at `syncconflict.js`; `sync()` (pull→push) defined globally; `renderConflicts()` builds the conflict banner buttons. `static/sw.js`: `CACHE="taskflow-v122-sync-conflict"`, STATIC ends with `syncconflict.js`.

## File structure

```
static/offline/db.js            # MODIFY — v3 + lists store   (+ db.test.js version)
static/offline/listsync.js      # NEW — pullLists/getLocalLists/pullAndReconcileLists
static/offline/hydrate.js       # MODIFY — taskFromServer copies list_id
static/offline/taskrepo.js      # MODIFY — createTask stores list_id
static/offline/syncpush.js      # MODIFY — payload list_id; 403→lost-access
static/offline/taskroutes.js    # MODIFY — GET /api/lists + /api/lists/:id/tasks
static/offline/syncconflict.js  # MODIFY — listConflicts includes list_id
static/index.html               # MODIFY — load listsync; sync() pull lists; banner discard-only
static/sw.js                    # MODIFY — bump v123 + precache listsync.js
```

---

## Task 1: DB v3 + `lists` store

**Files:** Modify `static/offline/db.js`, `tests/offline/db.test.js`

- [ ] **Step 1: Update the version test in `tests/offline/db.test.js`**

Change the line:
```js
test("DB_VERSION is 2", () => { assert.equal(DB_VERSION, 2); });
```
to:
```js
test("DB_VERSION is 3", () => { assert.equal(DB_VERSION, 3); });
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/db.test.js`
Expected: FAIL — `DB_VERSION` is still 2.

- [ ] **Step 3: Edit `static/offline/db.js`**

Change `const DB_VERSION = 2;` to:
```js
  const DB_VERSION = 3;
```

In the `ENTITY_STORES` object, add a `lists` store (e.g., right after the `mindmaps: [...]` line):
```js
    lists: [["server_id", "server_id"], ["dirty", "dirty"]],
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/db.test.js`
Expected: PASS (version 3; the data-driven "creates all entity stores" test now also covers `lists`).

- [ ] **Step 5: Commit**

```bash
git add static/offline/db.js tests/offline/db.test.js
git commit -m "feat(offline): db v3 + lists store"
```

---

## Task 2: `listsync.js`

**Files:** Create `static/offline/listsync.js`, `tests/offline/listsync.test.js`

- [ ] **Step 1: Write the failing test `tests/offline/listsync.test.js`**

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { cidOf } = require("../../static/offline/idmap.js");
const { pullLists, getLocalLists } = require("../../static/offline/listsync.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function allLists() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction("lists").objectStore("lists").getAll();
    r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
  });
}
function srv(over) {
  return Object.assign({ id: over.id, name: "L", owner_id: 1, created_at: "2026-06-01T00:00:00", role: "member", member_count: 2 }, over);
}

test("pullLists creates a list record with a stable cid", async () => {
  const r = await pullLists([srv({ id: 5, name: "Team", role: "owner", member_count: 3 })]);
  assert.equal(r.created, 1);
  const rows = await allLists();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].server_id, 5);
  assert.equal(rows[0].name, "Team");
  assert.equal(rows[0].role, "owner");
  assert.equal(rows[0].member_count, 3);
  assert.equal(rows[0].dirty, 0);
  assert.equal(await cidOf("list", 5), rows[0].cid);
});

test("pullLists updates an existing list (same cid) and is idempotent", async () => {
  await pullLists([srv({ id: 5, name: "Old" })]);
  const cid1 = (await allLists())[0].cid;
  const r = await pullLists([srv({ id: 5, name: "Renamed" })]);
  assert.equal(r.updated, 1);
  const rows = await allLists();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cid, cid1);
  assert.equal(rows[0].name, "Renamed");
});

test("pullLists deletes a local list whose server_id vanished", async () => {
  await pullLists([srv({ id: 5 }), srv({ id: 6 })]);
  const r = await pullLists([srv({ id: 5 })]); // 6 gone (left/removed)
  assert.equal(r.deleted, 1);
  const rows = await allLists();
  assert.deepEqual(rows.map((x) => x.server_id), [5]);
});

test("getLocalLists returns the server-shaped array (id = server_id)", async () => {
  await pullLists([srv({ id: 5, name: "Team", role: "owner", member_count: 4 })]);
  const out = await getLocalLists();
  assert.deepEqual(out, [{ id: 5, name: "Team", owner_id: 1, role: "owner", member_count: 4 }]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/listsync.test.js`
Expected: FAIL — cannot find module `listsync.js`.

- [ ] **Step 3: Write `static/offline/listsync.js`**

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

  function getAllLists() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("lists", "readonly").objectStore("lists").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  function putList(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("lists", "readwrite");
      tx.objectStore("lists").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function deleteList(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("lists", "readwrite");
      tx.objectStore("lists").delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function ensureCid(serverId, cache) {
    if (cache[serverId]) return Promise.resolve(cache[serverId]);
    return TFidmap.cidOf("list", serverId).then((cid) => {
      if (cid) { cache[serverId] = cid; return cid; }
      const fresh = TFids.newCid();
      cache[serverId] = fresh;
      return TFidmap.mapPut("list", serverId, fresh).then(() => fresh);
    });
  }
  function listFromServer(s, cid) {
    return {
      cid: cid, server_id: s.id, name: s.name,
      owner_id: s.owner_id != null ? s.owner_id : null,
      role: s.role, member_count: s.member_count != null ? s.member_count : 0, dirty: 0,
    };
  }

  function pullLists(serverLists) {
    const list = serverLists || [];
    const cache = {};
    return list.reduce((p, s) => p.then(() => ensureCid(s.id, cache)), Promise.resolve())
      .then(() => getAllLists())
      .then((localAll) => {
        const byCid = {};
        for (const r of localAll) byCid[r.cid] = r;
        const result = { created: 0, updated: 0, deleted: 0 };
        let chain = Promise.resolve();
        for (const s of list) {
          const cid = cache[s.id];
          const existing = byCid[cid];
          chain = chain.then(() => { if (existing) result.updated++; else result.created++; return putList(listFromServer(s, cid)); });
        }
        const serverIds = new Set(list.map((s) => String(s.id)));
        for (const r of localAll) {
          if (r.server_id == null) continue;
          if (serverIds.has(String(r.server_id))) continue;
          chain = chain.then(() => { result.deleted++; return deleteList(r.cid); });
        }
        return chain.then(() => result);
      });
  }

  function getLocalLists() {
    return getAllLists().then((rows) => rows.map((r) => ({
      id: r.server_id != null ? r.server_id : r.cid,
      name: r.name, owner_id: r.owner_id, role: r.role, member_count: r.member_count,
    })));
  }

  function pullAndReconcileLists(rawFetch) {
    return Promise.resolve(rawFetch("/api/lists"))
      .then((res) => (res && typeof res.json === "function" ? res.json() : res))
      .then((l) => pullLists(l || []));
  }

  const exported = { pullLists, getLocalLists, pullAndReconcileLists, listFromServer };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.listsync = exported; }
  return exported;
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/listsync.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add static/offline/listsync.js tests/offline/listsync.test.js
git commit -m "feat(offline): listsync (mirror shared lists server->local)"
```

---

## Task 3: `taskFromServer` copies `list_id`

**Files:** Modify `static/offline/hydrate.js`, `tests/offline/hydrate.test.js`

- [ ] **Step 1: Append a failing test to `tests/offline/hydrate.test.js`**

```js
test("taskFromServer copies the server list_id", () => {
  const rec = taskFromServer(serverTask({ id: 9, list_id: 7 }), () => "x");
  assert.equal(rec.list_id, 7);
  const personal = taskFromServer(serverTask({ id: 10, list_id: null }), () => "x");
  assert.equal(personal.list_id, null);
});
```

> The `serverTask` helper already includes `list_id: null` by default (it's in the helper's defaults). If not, add `list_id: null` to its default object.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/hydrate.test.js`
Expected: FAIL — `rec.list_id` is undefined.

- [ ] **Step 3: Edit `static/offline/hydrate.js`**

In `taskFromServer`, find the line `rec.list_cid = null;` and add immediately after it:
```js
    rec.list_id = dict.list_id != null ? dict.list_id : null;
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/hydrate.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add static/offline/hydrate.js tests/offline/hydrate.test.js
git commit -m "feat(offline): taskFromServer carries list_id"
```

---

## Task 4: `createTask` stores `list_id`

**Files:** Modify `static/offline/taskrepo.js`, `tests/offline/taskrepo.test.js`

- [ ] **Step 1: Append a failing test to `tests/offline/taskrepo.test.js`**

```js
test("createTask stores a server list_id when provided", async () => {
  const t = await createTask({ title: "Shared task", list_id: 7 }, { today: TODAY, now: NOW });
  assert.equal(t.list_id, 7);
  const plain = await createTask({ title: "Personal" }, { today: TODAY, now: NOW });
  assert.equal(plain.list_id, null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/taskrepo.test.js`
Expected: FAIL — `t.list_id` is undefined.

- [ ] **Step 3: Edit `static/offline/taskrepo.js`**

In `createTask`, find the record property `list_cid: input.list_cid != null ? input.list_cid : null,` and add immediately after it:
```js
      list_id: input.list_id != null ? input.list_id : null,
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/taskrepo.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add static/offline/taskrepo.js tests/offline/taskrepo.test.js
git commit -m "feat(offline): createTask stores list_id"
```

---

## Task 5: `syncpush` — payload `list_id` + 403 lost-access

**Files:** Modify `static/offline/syncpush.js`, `tests/offline/syncpush.test.js`

- [ ] **Step 1: Append failing tests to `tests/offline/syncpush.test.js`**

```js
const { mapPut: _mapPutL, cidOf: _cidOfL } = require("../../static/offline/idmap.js");

test("taskToCreatePayload includes the record's list_id", () => {
  assert.equal(taskToCreatePayload(task({ cid: "a", title: "A", list_id: 9 }), [], null).list_id, 9);
  assert.equal(taskToCreatePayload(task({ cid: "a", title: "A" }), [], null).list_id, null);
});

test("pushOutbox update 403 (removed from list) deletes the task locally + idmap + op", async () => {
  await put("tasks", [task({ cid: "a", server_id: 10, title: "A", list_id: 7 })]);
  await _mapPutL("task", 10, "a");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "task", cid: "a", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 403, data: { detail: "Not a member" } }));
  const r = await pushOutbox(tr);
  const db = await openDB();
  const rec = await new Promise((res) => { const q = db.transaction("tasks").objectStore("tasks").get("a"); q.onsuccess = () => res(q.result); });
  assert.equal(rec, undefined);                 // task removed locally
  assert.equal(await _cidOfL("task", 10), undefined); // idmap removed
  assert.equal(r.remaining, 0);                 // op dropped
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/syncpush.test.js`
Expected: FAIL — payload `list_id` is null; 403 leaves the task / fails.

- [ ] **Step 3: Edit `static/offline/syncpush.js`**

(a) In `taskToCreatePayload`, change the line `list_id: null,` to:
```js
      list_id: record.list_id != null ? record.list_id : null,
```

(b) Add a `deleteTaskRaw` helper next to `putTaskRaw` (after the `putTaskRaw` function):
```js
  function deleteTaskRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      tx.objectStore("tasks").delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  // Removed from the shared list (HTTP 403): drop access — delete local task + idmap + op.
  function lostAccess(rec, op) {
    return (rec.server_id != null ? TFidmap.mapDelete("task", rec.server_id) : Promise.resolve())
      .then(() => deleteTaskRaw(rec.cid))
      .then(() => TFoutbox.outboxRemove(op.qid));
  }
```

(c) In `opCreate`, the response handler currently ends:
```js
          result.failed++;
          return TFoutbox.outboxRemove(op.qid);
```
Add a 403 branch BEFORE that pair (so the block reads):
```js
          if (res.status === 403) { return lostAccess(rec, op); }
          result.failed++;
          return TFoutbox.outboxRemove(op.qid);
```

(d) In `opUpdate`, the response handler currently has (from #2c):
```js
          if (res.status === 404) { return putTaskRaw(Object.assign({}, rec, { conflict: "remote_deleted" })); } // safety net: flag, keep op
          result.failed++;
          return TFoutbox.outboxRemove(op.qid);
```
Insert a 403 branch between the 404 line and `result.failed++`:
```js
          if (res.status === 404) { return putTaskRaw(Object.assign({}, rec, { conflict: "remote_deleted" })); } // safety net: flag, keep op
          if (res.status === 403) { return lostAccess(rec, op); }
          result.failed++;
          return TFoutbox.outboxRemove(op.qid);
```

> `TFidmap.mapDelete` and `TFoutbox` are already imported in this file. Read the file first to confirm the exact surrounding text before editing.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/syncpush.test.js`
Expected: PASS, 17 tests (15 prior + 2 new).

- [ ] **Step 5: Commit**

```bash
git add static/offline/syncpush.js tests/offline/syncpush.test.js
git commit -m "feat(offline): push list_id + 403 lost-access removal"
```

---

## Task 6: `taskroutes` — list routes

**Files:** Modify `static/offline/taskroutes.js`, `tests/offline/taskroutes.test.js`

- [ ] **Step 1: Append failing tests to `tests/offline/taskroutes.test.js`**

(The helpers `seedTasks`, `task`, `buildTaskRouter` exist. Add a `lists` seeder + the tests.)

```js
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
```

> Note: the `task()` helper in this file may not set `list_id`; passing it via the override object works (it uses `Object.assign`). Confirm by reading the helper.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/taskroutes.test.js`
Expected: FAIL — no local route for `/api/lists`.

- [ ] **Step 3: Edit `static/offline/taskroutes.js`**

Add the `listsync` dependency near the other requires (after the `TFrec` require line):
```js
  const TFlistsync = req("./listsync.js", root.TF && root.TF.listsync);
```

Inside `buildTaskRouter`, add these two registrations immediately before `return router;`:
```js
    router.register("GET", "/api/lists", () => TFlistsync.getLocalLists());

    router.register("GET", "/api/lists/:id/tasks", ({ params }) =>
      TFquery.listTasks({}, opts()).then((rows) =>
        rows.filter((r) => String(r.list_id) === String(params.id)).map(withId)));
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/taskroutes.test.js`
Expected: PASS, 15 tests (13 prior + 2 new).

- [ ] **Step 5: Commit**

```bash
git add static/offline/taskroutes.js tests/offline/taskroutes.test.js
git commit -m "feat(offline): taskroutes GET /api/lists + /api/lists/:id/tasks"
```

---

## Task 7: `syncconflict.listConflicts` includes `list_id`

**Files:** Modify `static/offline/syncconflict.js`, `tests/offline/syncconflict.test.js`

- [ ] **Step 1: Append a failing test to `tests/offline/syncconflict.test.js`**

```js
test("listConflicts includes list_id (for shared-task discard-only)", async () => {
  await putTasks([{ cid: "a", title: "A", conflict: "remote_deleted", dirty: 1, list_id: 7 }]);
  const list = await listConflicts();
  assert.equal(list[0].list_id, 7);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/syncconflict.test.js`
Expected: FAIL — `list_id` is undefined on the result.

- [ ] **Step 3: Edit `static/offline/syncconflict.js`**

In `listConflicts`, change the map:
```js
      all.filter((r) => r.conflict).map((r) => ({ cid: r.cid, title: r.title, conflict: r.conflict })));
```
to:
```js
      all.filter((r) => r.conflict).map((r) => ({ cid: r.cid, title: r.title, conflict: r.conflict, list_id: r.list_id != null ? r.list_id : null })));
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/syncconflict.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add static/offline/syncconflict.js tests/offline/syncconflict.test.js
git commit -m "feat(offline): listConflicts includes list_id"
```

---

## Task 8: Full Node-suite regression

- [ ] **Step 1: Run the whole offline suite (19 files)**

Run:
```bash
node --test tests/offline/*.test.js
```
Expected: `ℹ tests 167 / ℹ pass 167 / ℹ fail 0`, terminating promptly.

> Count: prior 156 + Task 1 (0 net: 1 changed) + Task 2 (4) + Task 3 (1) + Task 4 (1) + Task 5 (2) + Task 6 (2) + Task 7 (1) = **167**.

- [ ] **Step 2: No commit** (regression run only). Fix any failure before continuing.

---

## Task 9: Wire `static/index.html` (browser-verified)

**Files:** Modify `static/index.html` (script tag; `sync()`; `renderConflicts()`)

> No Node test — browser-verified in Task 11.

- [ ] **Step 1: Add the `listsync.js` script tag**

Find `  <script src="/static/offline/syncconflict.js"></script>` and insert immediately AFTER it:
```html
  <script src="/static/offline/listsync.js"></script>
```

- [ ] **Step 2: Make `sync()` also pull lists**

Find this exact block:
```js
  return window.TF.syncpull.pullAndReconcile(__syncRawFetch)
    .then(() => window.TF.syncpush.pushOutbox(__syncTransport))
```
Replace it with:
```js
  return window.TF.syncpull.pullAndReconcile(__syncRawFetch)
    .then(() => (window.TF.listsync ? window.TF.listsync.pullAndReconcileLists(__syncRawFetch) : null))
    .then(() => window.TF.syncpush.pushOutbox(__syncTransport))
```

- [ ] **Step 3: Make the conflict banner discard-only for shared tasks**

In `renderConflicts`, find this exact line:
```js
      [["Buang perubahan", "discard"], ["Simpan sebagai task baru", "keep_as_new"]].forEach(([text, choice]) => {
```
Replace it with:
```js
      const choices = c.list_id != null
        ? [["Buang perubahan", "discard"]]
        : [["Buang perubahan", "discard"], ["Simpan sebagai task baru", "keep_as_new"]];
      choices.forEach(([text, choice]) => {
```

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "feat(offline): wire list sync + shared-task discard-only banner"
```

---

## Task 10: Service Worker — precache + cache bump

**Files:** Modify `static/sw.js:1` (CACHE), STATIC array

- [ ] **Step 1: Bump the cache version**

At `static/sw.js:1`, change `const CACHE = "taskflow-v122-sync-conflict";` to:
```js
const CACHE = "taskflow-v123-shared-lists";
```

- [ ] **Step 2: Precache `listsync.js`**

In `STATIC`, find `"/static/offline/syncconflict.js",` and add immediately after it:
```js
  "/static/offline/listsync.js",
```

- [ ] **Step 3: Verify syntax + commit**

Run: `node --check static/sw.js`
Expected: no output (valid).

```bash
git add static/sw.js
git commit -m "chore(sw): bump cache v123 + precache listsync.js"
```

---

## Task 11: Browser verification (manual — record results)

Deploy (merge → push → confirm `curl https://todo.yatno.web.id/sw.js | grep CACHE` shows v123). Reset the SW in the logged-in tab:

```js
(async()=>{for(const r of await navigator.serviceWorker.getRegistrations())await r.unregister();for(const k of await caches.keys())await caches.delete(k);location.reload();})()
```

After reload, verify (paste in console, share output). **This needs at least one shared list you own/are a member of.**

```js
(async()=>{
  const R=[]; const ok=(n,c)=>R.push((c?'✅':'❌')+' '+n);
  try{
    ok('listsync loaded', !!(window.TF && TF.listsync));
    const lists = await api.get('/api/lists');               // intercept → local
    ok('lists served locally ('+lists.length+')', Array.isArray(lists));
    if (lists.length){
      const L = lists[0];
      const before = await api.get('/api/lists/'+L.id+'/tasks'); // intercept → local filter
      ok('list tasks served locally ('+before.length+')', Array.isArray(before));
      // create a task INTO the list (local-first), push, confirm it lands in the list on the server
      const t = await api.post('/api/tasks',{title:'__shared verif', gtd_status:'inbox', list_id:L.id});
      ok('created into list locally (list_id='+t.list_id+')', String(t.list_id)===String(L.id));
      const res = await window.__syncNow();
      const rec = await TF.taskrepo.getTask(t.cid);
      const h={Authorization:'Bearer '+localStorage.getItem('tf_token')};
      const srv = await (await window.fetch('/api/lists/'+L.id+'/tasks',{headers:h})).json();
      ok('task pushed into the shared list on server', srv.some(x=>x.title==='__shared verif'));
      // cleanup
      await api.del('/api/tasks/'+rec.server_id); await window.__syncNow();
    } else { R.push('⚠️ no shared list to test list-task create — skipped that check'); }
  }catch(e){ R.push('❌ EXCEPTION: '+(e&&e.message)); }
  const out='=== SHARED-LIST VERIFICATION ===\n'+R.join('\n'); console.log(out); return out;
})()
```

Also manually (with a second account/device if available): from the shared list, remove yourself (or have the owner remove you) → `__syncNow()` → the list and its tasks should disappear locally. And have a teammate delete a shared task you edited offline → the conflict banner should show **only "Buang perubahan"**. Report pass/fail.

---

## Done criteria

- DB v3 + `lists` store; `listsync` mirrors lists; tasks carry `list_id` (hydrate + create + push payload); `taskroutes` serves `/api/lists` and `/api/lists/:id/tasks`; push 403 removes access; `listConflicts` exposes `list_id`. Node suite green (167).
- `sync()` pulls lists; conflict banner is discard-only for shared tasks.
- Browser-verified: lists + list tasks offline, create-into-list syncs, lost-access removal, discard-only banner.

## Next (out of scope)

- **#2e Habits**, **#2f Notes**, **#2g Mindmap**, **#2h Chat** → **#3 Tauri**.
- Optional: members view offline; list notes/mindmaps when those domains go offline.
```
