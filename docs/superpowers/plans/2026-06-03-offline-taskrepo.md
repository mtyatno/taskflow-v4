# Offline taskRepo — Record CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `static/offline/taskrepo.js` — record-level CRUD for tasks over IndexedDB (create / get / update / soft-delete), returning the server-parity task shape and recording every mutation to `_outbox`, Node-tested.

**Architecture:** A `static/offline/` module that composes the scaffold primitives (`db`, `ids`, `outbox`) and the pure logic (`tasklogic`). It is the canonical local source of truth for individual tasks: it owns the `tasks` store record shape (cid-keyed, with sync metadata) and assembles the display object the frontend expects (quadrant + derived fields + parent_title). It is pure of any DOM/`index.html` concern. Stateful behavior is verified with `fake-indexeddb`; all time inputs (`now`, `today`) are injectable for determinism.

**Tech Stack:** Vanilla ES2017 JS, IndexedDB, `node:test`, `fake-indexeddb`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-03-offline-first-local-data-layer-design.md` (Sections 3, 4, 5).

---

## Source-of-truth behavior (from `webapp.py`)

**Create** (`create_task`, `TaskCreate`): defaults `description ""`, `priority "P3"`, `project ""`, `context ""`, `gtd_status "inbox"`, `waiting_for ""`, `deadline null`, `progress 0`, `completed_at null`, `is_focused 0`. Priority stored UPPERCASE. `#tags` are stripped from the title (regex `#([a-zA-Z0-9_À-ɏ]+)`, i.e. `À-ɏ`); if the title is empty after stripping → error "Judul tidak boleh kosong setelah strip tag". `quadrant = calculate_quadrant(priority, deadline)`. `created_at == updated_at == now`. Returns `task_row_to_dict(row)`.

**Update** (`update_task`, `TaskUpdate`): only provided fields change. `priority` → uppercased. `gtd_status == "done"` also sets `completed_at = now`. `deadline == "" or "-"` clears to `null`. `assigned_to == 0` → `null`. `progress` clamped to `[0,100]`. Title (if provided) is tag-stripped (and must be non-empty). `updated_at = now`. Quadrant is **recomputed** from the new-or-existing priority+deadline. Returns `task_row_to_dict(row)`.

**Display shape** (`task_row_to_dict`): all stored columns plus `is_overdue`, `days_until_deadline`, `is_focused` (bool), `assigned_to_name`, `parent_title`.

**Local adaptation (Model B):** the canonical id is `cid` (not server integer `id`); relations use `parent_cid`/`list_cid`. Each record carries sync metadata `deleted` (tombstone), `dirty`, `base_rev`, `server_id`. "Parity" here means the **computed/business fields** match the server (quadrant, derived fields, defaults, title-stripping, completed_at-on-done) — NOT byte-identical ids.

---

## Non-goals (explicit — each is a later plan)

- ❌ `list` / query filtering (`GET /api/tasks` params + ordering) and `projects`/`contexts`/`summary` — next plan (`taskrepo-query`).
- ❌ Tag persistence to `entity_tags`/`tags` — create/update DO strip `#tags` from the title (title parity) but DO NOT yet persist them. Tags are a separate domain plan.
- ❌ Recurrence fields/expansion — create/update ignore recurrence inputs for now (stored as `null`); recurrence is its own plan.
- ❌ Full `assigned_to_name` resolution — set to `null` in this plan (no local users store yet); `parent_title` IS resolved from the local `tasks` store.
- ❌ Any `index.html` wiring, `api` interception, hydration, Service Worker change — integration plan.

---

## File structure

```
static/offline/taskrepo.js        # NEW — createTask, getTask, updateTask, deleteTask, + internal assemble/buildRecord
tests/offline/taskrepo.test.js     # NEW — Node tests with fake-indexeddb
```

Depends on existing `static/offline/{db,ids,outbox,tasklogic}.js`. No other files change.

---

## Task 1: Module scaffold + `getTask` + `_assemble`

**Files:**
- Create: `static/offline/taskrepo.js`
- Test: `tests/offline/taskrepo.test.js`

Seed a record directly into the `tasks` store, then read it back via `getTask` to verify the assembled display shape (derived fields, `is_focused` bool, `parent_title` lookup, tombstone hidden).

- [ ] **Step 1: Write the failing test `tests/offline/taskrepo.test.js`**

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/taskrepo.test.js`
Expected: FAIL — cannot find module `taskrepo.js`.

- [ ] **Step 3: Write `static/offline/taskrepo.js`**

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
  const TFids = isNode ? require("./ids.js") : root.TF.ids;
  const TFoutbox = isNode ? require("./outbox.js") : root.TF.outbox;
  const TFlogic = isNode ? require("./tasklogic.js") : root.TF.tasklogic;

  function getRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("tasks", "readonly").objectStore("tasks").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }

  // Build the frontend-facing display object from a stored record.
  function assemble(rec, todayISO) {
    const derived = TFlogic.deriveTaskFields(rec, todayISO);
    return getParentTitle(rec.parent_cid).then((parentTitle) =>
      Object.assign({}, rec, {
        is_focused: !!rec.is_focused,
        days_until_deadline: derived.days_until_deadline,
        is_overdue: derived.is_overdue,
        assigned_to_name: null, // resolution deferred (no local users store yet)
        parent_title: parentTitle,
      })
    );
  }

  function getParentTitle(parentCid) {
    if (!parentCid) return Promise.resolve(null);
    return getRaw(parentCid).then((p) => (p && !p.deleted ? p.title : null));
  }

  function getTask(cid, todayISO) {
    return getRaw(cid).then((rec) => {
      if (!rec || rec.deleted) return undefined;
      return assemble(rec, todayISO);
    });
  }

  const exported = { getTask };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.taskrepo = exported; }
  return exported;
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/taskrepo.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add static/offline/taskrepo.js tests/offline/taskrepo.test.js
git commit -m "feat(offline): taskRepo getTask + display assembly"
```

---

## Task 2: `createTask`

**Files:**
- Modify: `static/offline/taskrepo.js`
- Modify: `tests/offline/taskrepo.test.js`

- [ ] **Step 1: Write failing tests — append to `tests/offline/taskrepo.test.js`**

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/taskrepo.test.js`
Expected: FAIL — `createTask` is not a function.

- [ ] **Step 3: Add `createTask` (and the tag regex + write helper) to `static/offline/taskrepo.js`**

Add this `TAG_RE` constant near the top of the factory body (after the dependency consts):

```js
  const TAG_RE = /#([a-zA-Z0-9_À-ɏ]+)/g;
```

Add these functions before the `const exported = ...` line:

```js
  function putRaw(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      tx.objectStore("tasks").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function stripTags(title) {
    return String(title).replace(TAG_RE, "").trim();
  }

  function createTask(input, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    const cleanTitle = stripTags(input.title);
    if (!cleanTitle) {
      return Promise.reject(new Error("Judul tidak boleh kosong setelah strip tag"));
    }
    const priority = String(input.priority || "P3").toUpperCase();
    const deadline = input.deadline || null;
    const rec = {
      cid: TFids.newCid(),
      server_id: null,
      title: cleanTitle,
      description: input.description != null ? input.description : "",
      gtd_status: input.gtd_status != null ? input.gtd_status : "inbox",
      priority: priority,
      quadrant: TFlogic.calculateQuadrant({ priority: priority, deadline: deadline }, opts && opts.today),
      project: input.project != null ? input.project : "",
      context: input.context != null ? input.context : "",
      deadline: deadline,
      waiting_for: input.waiting_for != null ? input.waiting_for : "",
      list_cid: input.list_cid != null ? input.list_cid : null,
      assigned_to: input.assigned_to != null ? input.assigned_to : null,
      parent_cid: input.parent_cid != null ? input.parent_cid : null,
      progress: 0,
      is_focused: 0,
      completed_at: null,
      created_at: now,
      updated_at: now,
      deleted: false,
      dirty: 1,
      base_rev: null,
    };
    return putRaw(rec)
      .then(() => TFoutbox.outboxAdd({ op: "create", entity_type: "task", cid: rec.cid, payload: rec }))
      .then(() => assemble(rec, opts && opts.today));
  }
```

Update the export line:

```js
  const exported = { getTask, createTask };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/taskrepo.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add static/offline/taskrepo.js tests/offline/taskrepo.test.js
git commit -m "feat(offline): taskRepo createTask (defaults, tag-strip, quadrant, outbox)"
```

---

## Task 3: `updateTask`

**Files:**
- Modify: `static/offline/taskrepo.js`
- Modify: `tests/offline/taskrepo.test.js`

- [ ] **Step 1: Write failing tests — append to `tests/offline/taskrepo.test.js`**

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/taskrepo.test.js`
Expected: FAIL — `updateTask` is not a function.

- [ ] **Step 3: Add `updateTask` to `static/offline/taskrepo.js`**

Add before the `const exported = ...` line:

```js
  function updateTask(cid, patch, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    return getRaw(cid).then((rec) => {
      if (!rec || rec.deleted) {
        return Promise.reject(new Error("Task not found"));
      }
      const next = Object.assign({}, rec);

      if (patch.title != null) {
        const clean = stripTags(patch.title);
        if (!clean) return Promise.reject(new Error("Judul tidak boleh kosong setelah strip tag"));
        next.title = clean;
      }
      if (patch.description != null) next.description = patch.description;
      if (patch.priority != null) next.priority = String(patch.priority).toUpperCase();
      if (patch.project != null) next.project = patch.project;
      if (patch.context != null) next.context = patch.context;
      if (patch.waiting_for != null) next.waiting_for = patch.waiting_for;
      if (patch.gtd_status != null) {
        next.gtd_status = patch.gtd_status;
        if (patch.gtd_status === "done") next.completed_at = now;
      }
      if (patch.deadline != null) {
        next.deadline = (patch.deadline === "" || patch.deadline === "-") ? null : patch.deadline;
      }
      if (patch.assigned_to != null) {
        next.assigned_to = patch.assigned_to === 0 ? null : patch.assigned_to;
      }
      if (patch.progress != null) {
        next.progress = Math.max(0, Math.min(100, patch.progress));
      }

      next.updated_at = now;
      next.dirty = 1;
      next.quadrant = TFlogic.calculateQuadrant(
        { priority: next.priority, deadline: next.deadline },
        opts && opts.today
      );

      return putRaw(next)
        .then(() => TFoutbox.outboxAdd({ op: "update", entity_type: "task", cid: cid, payload: next }))
        .then(() => assemble(next, opts && opts.today));
    });
  }
```

Update the export line:

```js
  const exported = { getTask, createTask, updateTask };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/taskrepo.test.js`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add static/offline/taskrepo.js tests/offline/taskrepo.test.js
git commit -m "feat(offline): taskRepo updateTask (partial, quadrant recompute, outbox)"
```

---

## Task 4: `deleteTask` (soft tombstone)

**Files:**
- Modify: `static/offline/taskrepo.js`
- Modify: `tests/offline/taskrepo.test.js`

- [ ] **Step 1: Write failing tests — append to `tests/offline/taskrepo.test.js`**

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/taskrepo.test.js`
Expected: FAIL — `deleteTask` is not a function.

- [ ] **Step 3: Add `deleteTask` to `static/offline/taskrepo.js`**

Add before the `const exported = ...` line:

```js
  function deleteTask(cid, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    return getRaw(cid).then((rec) => {
      if (!rec || rec.deleted) {
        return Promise.reject(new Error("Task not found"));
      }
      const next = Object.assign({}, rec, { deleted: true, dirty: 1, updated_at: now });
      return putRaw(next)
        .then(() => TFoutbox.outboxAdd({ op: "delete", entity_type: "task", cid: cid, payload: { cid: cid } }))
        .then(() => ({ ok: true }));
    });
  }
```

Update the export line:

```js
  const exported = { getTask, createTask, updateTask, deleteTask };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/taskrepo.test.js`
Expected: PASS, 20 tests.

- [ ] **Step 5: Run the whole offline suite to confirm no regression**

Run: `node --test tests/offline/smoke.test.js tests/offline/ids.test.js tests/offline/db.test.js tests/offline/meta.test.js tests/offline/idmap.test.js tests/offline/outbox.test.js tests/offline/blobstore.test.js tests/offline/router.test.js tests/offline/tasklogic.test.js tests/offline/taskrepo.test.js`
Expected: `ℹ tests 67 / ℹ pass 67 / ℹ fail 0` (47 prior + 20 new), terminating promptly.

- [ ] **Step 6: Commit**

```bash
git add static/offline/taskrepo.js tests/offline/taskrepo.test.js
git commit -m "feat(offline): taskRepo deleteTask (soft tombstone + outbox)"
```

---

## Done criteria

- `static/offline/taskrepo.js` exports `createTask`, `getTask`, `updateTask`, `deleteTask`.
- Create/update faithfully reproduce server defaults, priority-uppercasing, `#tag` title-stripping, `done`→`completed_at`, deadline clearing, progress clamping, and quadrant (re)computation via `tasklogic`.
- Every mutation appends the correct `_outbox` op (`create`/`update`/`delete`); deletes are tombstones hidden from reads.
- Full offline suite green (67 tests), no hang.

## Next plans (not in scope here)

1. **`taskrepo-query`** — `listTasks(query, {today})` porting `GET /api/tasks` filtering (status/priority/quadrant/project/context/include_done/tag) + ordering (`priority, deadline`), plus `projects`/`contexts`/`summary` derivation.
2. **Tag domain + recurrence** — persist `#tags` to `entity_tags`/`tags`; recurrence fields + occurrence expansion.
3. **index.html integration** — script-tag wiring + load order, retire in-page `OfflineDB` and the inaccurate `computeOfflineQuadrant`, intercept the `api` object for task routes via `LocalRouter`, hydrate the tasks domain, adjust the Service Worker + cache bump.
```
