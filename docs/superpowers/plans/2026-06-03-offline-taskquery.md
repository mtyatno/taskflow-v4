# Offline taskQuery — List/Filter + Projects/Contexts/Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `static/offline/taskquery.js` — read-side parity for the task domain: `listTasks(query)` (filtering + ordering matching `GET /api/tasks`), plus `getProjects()`, `getContexts()`, and `getSummary()` matching their endpoints. Node-tested.

**Architecture:** A read-only `static/offline/` module over the `tasks` IndexedDB store. It loads all live (non-tombstoned) task records once per call, then filters/sorts/aggregates in memory (offline scale is small). Display objects are produced via a shared `displayFrom(rec, today, parentTitle)` helper extracted from `taskrepo.js`, so list rows and single-`getTask` rows are assembled identically. No DOM / `index.html` concern; all time inputs injectable.

**Tech Stack:** Vanilla ES2017 JS, IndexedDB, `node:test`, `fake-indexeddb`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-03-offline-first-local-data-layer-design.md` (Section 5 — summary/search/projects/contexts derivation rows).

---

## Source-of-truth behavior (from `webapp.py`)

**`GET /api/tasks`** (`list_tasks`): filters — `status` → `gtd_status == status`; else if not `include_done` → exclude `gtd_status in ('done','archived')`. `priority` (uppercased) exact; `quadrant` (uppercased) exact; `project` exact; `context` exact; `tag` → entity_tags join (DEFERRED, see non-goals). Order: `ORDER BY priority, deadline` — priority ascending (`P1 < P2 < P3 < P4`), then deadline ascending with **NULL first** (SQLite sorts NULL smallest in ASC). Returns `task_row_to_dict` objects.

**`GET /api/summary`** (`get_summary`): over the user's tasks —
- `by_status`: count grouped by `gtd_status` (ALL tasks, incl. done/archived).
- `by_quadrant`: count grouped by `quadrant`, active only (exclude done/archived).
- `overdue`: count where `deadline < today` AND active.
- `total_active`: sum of `by_status` for statuses not in (done, archived).
- `total_done`: `by_status['done']` or 0.
- `done_last_7_days`: count where `gtd_status == 'done'` AND `completed_at >= today-7days`.
- `date`: today ISO.

**`GET /api/projects`** / **`/api/contexts`**: `SELECT DISTINCT project|context WHERE field != '' AND active (not done/archived) ORDER BY field`. Returns a sorted array of strings.

**Local adaptation:** "the user's tasks" = all local non-tombstoned (`deleted !== true`) records (offline is single-user; shared-list access is Kelompok 2, deferred). Date comparisons use `YYYY-MM-DD` lexical ordering (== chronological). `completed_at` is a full ISO datetime; comparing it `>= "YYYY-MM-DD"` is correct lexically because the date prefix dominates.

---

## Non-goals (explicit — later plans)

- ❌ `tag` filter on `listTasks` — tags are not persisted locally yet (separate tag-domain plan). `listTasks` ignores a provided `tag` param; the integration plan must route tag-filtered queries to the network until tags land.
- ❌ Shared-list task access (Kelompok 2).
- ❌ `index.html` wiring / `api` interception / hydration / Service Worker.

---

## File structure

```
static/offline/taskrepo.js         # MODIFY — extract & export `displayFrom(rec, todayISO, parentTitle)`; assemble() reuses it
static/offline/taskquery.js        # NEW — listTasks, getProjects, getContexts, getSummary
tests/offline/taskquery.test.js     # NEW
```

`taskquery.js` depends on existing `static/offline/{db,tasklogic,taskrepo}.js`.

---

## Task 1: Extract `displayFrom` in `taskrepo.js`

Refactor so the per-record display assembly is a pure, reusable, synchronous function. No external behavior change — existing `taskrepo` tests must stay green.

**Files:**
- Modify: `static/offline/taskrepo.js`
- Modify: `tests/offline/taskrepo.test.js`

- [ ] **Step 1: Add a test asserting `displayFrom` is exported and pure — append to `tests/offline/taskrepo.test.js`**

```js
const { displayFrom } = require("../../static/offline/taskrepo.js");

test("displayFrom builds the display object from a record + parentTitle (pure)", () => {
  const rec = {
    cid: "x", title: "T", deadline: "2026-06-02", gtd_status: "next",
    is_focused: 1, parent_cid: "p",
  };
  const d = displayFrom(rec, TODAY, "Parent");
  assert.equal(d.is_focused, true);
  assert.equal(d.days_until_deadline, -1);
  assert.equal(d.is_overdue, true);
  assert.equal(d.assigned_to_name, null);
  assert.equal(d.parent_title, "Parent");
  assert.equal(d.cid, "x"); // original fields preserved
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/taskrepo.test.js`
Expected: FAIL — `displayFrom` is not a function.

- [ ] **Step 3: Refactor `static/offline/taskrepo.js`**

Replace the existing `assemble` function with a thin wrapper over a new pure `displayFrom`:

```js
  // Pure: build the frontend-facing display object from a record + resolved parent title.
  function displayFrom(rec, todayISO, parentTitle) {
    const derived = TFlogic.deriveTaskFields(rec, todayISO);
    return Object.assign({}, rec, {
      is_focused: !!rec.is_focused,
      days_until_deadline: derived.days_until_deadline,
      is_overdue: derived.is_overdue,
      assigned_to_name: null, // resolution deferred (no local users store yet)
      parent_title: parentTitle != null ? parentTitle : null,
    });
  }

  // Async: resolve parent title from the store, then assemble.
  function assemble(rec, todayISO) {
    return getParentTitle(rec.parent_cid).then((parentTitle) => displayFrom(rec, todayISO, parentTitle));
  }
```

Update the export line to add `displayFrom`:

```js
  const exported = { getTask, createTask, updateTask, deleteTask, displayFrom };
```

- [ ] **Step 4: Run to verify everything passes**

Run: `node --test tests/offline/taskrepo.test.js`
Expected: PASS, 21 tests (20 prior + 1 new).

- [ ] **Step 5: Commit**

```bash
git add static/offline/taskrepo.js tests/offline/taskrepo.test.js
git commit -m "refactor(offline): extract pure displayFrom from taskRepo.assemble"
```

---

## Task 2: `taskquery.js` + `listTasks`

**Files:**
- Create: `static/offline/taskquery.js`
- Test: `tests/offline/taskquery.test.js`

- [ ] **Step 1: Write the failing test `tests/offline/taskquery.test.js`**

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/taskquery.test.js`
Expected: FAIL — cannot find module `taskquery.js`.

- [ ] **Step 3: Write `static/offline/taskquery.js`**

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
  const TFdb = isNode ? require("./db.js") : root.TF.db;
  const TFrepo = isNode ? require("./taskrepo.js") : root.TF.taskrepo;

  function getAllRaw() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("tasks", "readonly").objectStore("tasks").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }

  function isActive(rec) {
    return rec.gtd_status !== "done" && rec.gtd_status !== "archived";
  }

  function truthy(v) {
    return v === true || v === "true" || v === 1 || v === "1";
  }

  function matchesQuery(rec, q) {
    q = q || {};
    if (q.status) {
      if (rec.gtd_status !== q.status) return false;
    } else if (!truthy(q.include_done)) {
      if (!isActive(rec)) return false;
    }
    if (q.priority && rec.priority !== String(q.priority).toUpperCase()) return false;
    if (q.quadrant && rec.quadrant !== String(q.quadrant).toUpperCase()) return false;
    if (q.project != null && q.project !== "" && rec.project !== q.project) return false;
    if (q.context != null && q.context !== "" && rec.context !== q.context) return false;
    // q.tag is intentionally ignored (tags not persisted locally yet — see plan non-goals).
    return true;
  }

  // priority asc (P1<P2<P3<P4), then deadline asc with NULL first (SQLite parity).
  function compareTasks(a, b) {
    if (a.priority !== b.priority) return a.priority < b.priority ? -1 : 1;
    const ad = a.deadline, bd = b.deadline;
    if (ad === bd) return 0;
    if (ad == null) return -1;
    if (bd == null) return 1;
    return ad < bd ? -1 : 1;
  }

  function listTasks(query, opts) {
    const today = opts && opts.today;
    return getAllRaw().then((all) => {
      const live = all.filter((r) => !r.deleted);
      const titleByCid = {};
      for (const r of live) titleByCid[r.cid] = r.title;
      const rows = live.filter((r) => matchesQuery(r, query)).sort(compareTasks);
      return rows.map((r) => {
        const parentTitle = r.parent_cid ? (titleByCid[r.parent_cid] != null ? titleByCid[r.parent_cid] : null) : null;
        return TFrepo.displayFrom(r, today, parentTitle);
      });
    });
  }

  const exported = { listTasks };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.taskquery = exported; }
  return exported;
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/taskquery.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add static/offline/taskquery.js tests/offline/taskquery.test.js
git commit -m "feat(offline): taskQuery listTasks (filter + priority/deadline ordering)"
```

---

## Task 3: `getProjects` + `getContexts`

**Files:**
- Modify: `static/offline/taskquery.js`
- Modify: `tests/offline/taskquery.test.js`

- [ ] **Step 1: Write failing tests — append to `tests/offline/taskquery.test.js`**

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/taskquery.test.js`
Expected: FAIL — `getProjects` is not a function.

- [ ] **Step 3: Add `getProjects`/`getContexts` to `static/offline/taskquery.js`**

Add before the `const exported = ...` line:

```js
  function distinctActiveField(field) {
    return getAllRaw().then((all) => {
      const set = new Set();
      for (const r of all) {
        if (r.deleted || !isActive(r)) continue;
        const v = r[field];
        if (v != null && v !== "") set.add(v);
      }
      return Array.from(set).sort();
    });
  }

  function getProjects() { return distinctActiveField("project"); }
  function getContexts() { return distinctActiveField("context"); }
```

Update the export line:

```js
  const exported = { listTasks, getProjects, getContexts };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/taskquery.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add static/offline/taskquery.js tests/offline/taskquery.test.js
git commit -m "feat(offline): taskQuery getProjects + getContexts"
```

---

## Task 4: `getSummary`

**Files:**
- Modify: `static/offline/taskquery.js`
- Modify: `tests/offline/taskquery.test.js`

- [ ] **Step 1: Write failing tests — append to `tests/offline/taskquery.test.js`**

```js
const { getSummary } = require("../../static/offline/taskquery.js");

test("getSummary aggregates by_status, by_quadrant, totals, overdue, done_last_7_days", async () => {
  await seed([
    task({ cid: "a", gtd_status: "next", quadrant: "Q1", deadline: "2026-06-01" }),  // active, overdue
    task({ cid: "b", gtd_status: "next", quadrant: "Q2", deadline: null }),           // active
    task({ cid: "c", gtd_status: "inbox", quadrant: "Q4", deadline: null }),          // active
    task({ cid: "d", gtd_status: "done", quadrant: "Q1", completed_at: "2026-06-02T10:00:00.000Z" }), // done within 7d
    task({ cid: "e", gtd_status: "done", quadrant: "Q1", completed_at: "2026-05-01T10:00:00.000Z" }), // done >7d ago
    task({ cid: "f", gtd_status: "archived", quadrant: "Q3" }),
    task({ cid: "g", gtd_status: "next", quadrant: "Q1", deleted: true }),            // tombstone — ignored
  ]);
  const s = await getSummary({ today: TODAY });
  assert.deepEqual(s.by_status, { next: 2, inbox: 1, done: 2, archived: 1 });
  assert.deepEqual(s.by_quadrant, { Q1: 1, Q2: 1, Q4: 1 }); // active only
  assert.equal(s.overdue, 1);            // only "a"
  assert.equal(s.total_active, 3);       // next(2) + inbox(1)
  assert.equal(s.total_done, 2);
  assert.equal(s.done_last_7_days, 1);   // only "d"
  assert.equal(s.date, TODAY);
});

test("getSummary on an empty store returns zeros", async () => {
  const s = await getSummary({ today: TODAY });
  assert.deepEqual(s.by_status, {});
  assert.deepEqual(s.by_quadrant, {});
  assert.equal(s.overdue, 0);
  assert.equal(s.total_active, 0);
  assert.equal(s.total_done, 0);
  assert.equal(s.done_last_7_days, 0);
  assert.equal(s.date, TODAY);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/taskquery.test.js`
Expected: FAIL — `getSummary` is not a function.

- [ ] **Step 3: Add `getSummary` (and a date helper) to `static/offline/taskquery.js`**

Add before the `const exported = ...` line:

```js
  function todayLocalISO() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function minusDaysISO(iso, n) {
    const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
    const t = Date.UTC(y, m - 1, d) - n * 86400000;
    const dt = new Date(t);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }

  function getSummary(opts) {
    const today = (opts && opts.today) || todayLocalISO();
    const cutoff7 = minusDaysISO(today, 7);
    return getAllRaw().then((all) => {
      const live = all.filter((r) => !r.deleted);
      const by_status = {};
      const by_quadrant = {};
      let overdue = 0;
      let done_last_7_days = 0;
      for (const r of live) {
        by_status[r.gtd_status] = (by_status[r.gtd_status] || 0) + 1;
        if (isActive(r)) {
          if (r.quadrant) by_quadrant[r.quadrant] = (by_quadrant[r.quadrant] || 0) + 1;
          if (r.deadline && r.deadline < today) overdue += 1;
        }
        if (r.gtd_status === "done" && r.completed_at && r.completed_at >= cutoff7) {
          done_last_7_days += 1;
        }
      }
      let total_active = 0;
      for (const k in by_status) {
        if (k !== "done" && k !== "archived") total_active += by_status[k];
      }
      return {
        by_status: by_status,
        by_quadrant: by_quadrant,
        overdue: overdue,
        total_active: total_active,
        total_done: by_status["done"] || 0,
        done_last_7_days: done_last_7_days,
        date: today,
      };
    });
  }
```

Update the export line:

```js
  const exported = { listTasks, getProjects, getContexts, getSummary };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/taskquery.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 5: Run the whole offline suite to confirm no regression**

Run: `node --test tests/offline/smoke.test.js tests/offline/ids.test.js tests/offline/db.test.js tests/offline/meta.test.js tests/offline/idmap.test.js tests/offline/outbox.test.js tests/offline/blobstore.test.js tests/offline/router.test.js tests/offline/tasklogic.test.js tests/offline/taskrepo.test.js tests/offline/taskquery.test.js`
Expected: `ℹ tests 79 / ℹ pass 79 / ℹ fail 0`, terminating promptly.

> Count: prior suite 67 + Task 1 adds 1 (`displayFrom`) + Task 2 adds 7 + Task 3 adds 2 + Task 4 adds 2 = **79**.

- [ ] **Step 6: Commit**

```bash
git add static/offline/taskquery.js tests/offline/taskquery.test.js
git commit -m "feat(offline): taskQuery getSummary aggregation parity"
```

---

## Done criteria

- `static/offline/taskquery.js` exports `listTasks`, `getProjects`, `getContexts`, `getSummary`.
- `listTasks` reproduces server filtering (status/include_done default, priority/quadrant/project/context) and ordering (priority asc, deadline asc NULL-first), returning assembled display rows.
- `getProjects`/`getContexts` return sorted distinct non-empty values among active tasks.
- `getSummary` matches the server aggregation (by_status incl. done/archived, by_quadrant active-only, overdue, totals, done_last_7_days, date).
- `taskRepo.displayFrom` is the shared pure assembler used by both single-get and list rows.
- Full offline suite green (79 tests), no hang.

## Next plans (not in scope here)

1. **Tag domain + recurrence** — persist `#tags` to `entity_tags`/`tags` (enables the `tag` filter); recurrence fields + occurrence expansion.
2. **index.html integration** — script-tag wiring + load order, retire in-page `OfflineDB` and the inaccurate `computeOfflineQuadrant`, intercept the `api` object for task routes via `LocalRouter` (mapping `/api/tasks*`, `/api/summary`, `/api/projects`, `/api/contexts` to these functions), hydrate the tasks domain, adjust the Service Worker + cache bump. (Browser-verified.)
```
