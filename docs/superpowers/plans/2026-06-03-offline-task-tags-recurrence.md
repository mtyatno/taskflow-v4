# Offline Task Tags + Recurrence Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist task `#tags` (store `tags`+`entity_tags`) and recurrence (`recurrence_*` fields + `recurring_exceptions` store) in the offline data layer, and enable the `tag` filter in `listTasks` — all Node-tested with server parity.

**Architecture:** Two new modules in `static/offline/` — `tagrepo.js` (cross-entity tag persistence; task-only callers this plan) and `recurrence.js` (`recurring_exceptions` mark + range query). `taskrepo.js` gains recurrence-field persistence and calls `tagrepo.setEntityTags` on create/update. `taskquery.js` resolves the `tag` filter via `tagrepo`. Stores already exist in `db.js` (schema v2). Reads load-all-then-filter in memory (offline scale is small), matching the existing `taskquery` pattern.

**Tech Stack:** Vanilla ES2017 JS, IndexedDB, `node:test`, `fake-indexeddb`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-03-offline-task-tags-recurrence-design.md`

---

## Source-of-truth behavior (from `webapp.py`)

- **Tag regex/normalize:** `#([a-zA-Z0-9_À-ɏ]+)`, `lower()`, `strip()`.
- **Create** strips+extracts tags, upserts `tags` unique-by-name, inserts `entity_tags(entity_type='task')`.
- **Update** re-derives tags **only when `title` is in the payload**: deletes all of the task's `entity_tags` then re-inserts.
- **`tag` filter:** task passes if it has an `entity_tags` link (type `task`) to a tag whose name == `tag.lower()`.
- **Recurrence fields:** `recurrence_type ∈ {daily,weekly,monthly,weekdays}` (else null); `recurrence_days` = JSON string (weekly `[0..6]` filtered valid; monthly `[clamp(day,1,28)]`; else null); `recurrence_end_date` = today+90 when type set (create always; update only if not already set); `recurrence_renew` → end_date today+90 + notif_level null; invalid/null type on update clears all recurrence fields.
- **mark occurrence:** `status ∈ {done,skipped}`; date `YYYY-MM-DD`; task must be recurring; date within `[created_at[:10], recurrence_end_date]`; upsert by `(task,occurrence_date)`.
- **get exceptions:** inclusive range; map `{ "<task>": [{occurrence_date,status}] }`, live tasks only.

## File structure

```
static/offline/tagrepo.js            # NEW — extractTags, setEntityTags, getEntityTags, getAllTags, removeEntityTag, cidsForTag
static/offline/recurrence.js         # NEW — markOccurrence, getExceptions
static/offline/taskrepo.js           # MODIFY — recurrence fields + call tagrepo on create/update
static/offline/taskquery.js          # MODIFY — tag filter via tagrepo
tests/offline/tagrepo.test.js        # NEW
tests/offline/recurrence.test.js     # NEW
tests/offline/taskrepo.test.js       # MODIFY (append)
tests/offline/taskquery.test.js      # MODIFY (append)
```

Existing module conventions: UMD wrapper, `isNode` require of sibling modules, `root.TF.<name>` registration. Tests use `require("./setup.js")` (`deleteDB`) + `_reset()` in `beforeEach`. See `taskrepo.js`/`outbox.js` for the exact wrapper.

---

## Task 1: `tagrepo.js`

**Files:**
- Create: `static/offline/tagrepo.js`
- Test: `tests/offline/tagrepo.test.js`

- [ ] **Step 1: Write the failing test `tests/offline/tagrepo.test.js`**

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const {
  extractTags, setEntityTags, getEntityTags, getAllTags, removeEntityTag, cidsForTag,
} = require("../../static/offline/tagrepo.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function countStore(name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction(name, "readonly").objectStore(name).count();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

test("extractTags returns clean title and lowercased unique tags in order", () => {
  const { clean, tags } = extractTags("Beli #Kopi #susu #kopi");
  assert.equal(clean, "Beli"); // tags stripped, then trimmed (server .strip())
  assert.deepEqual(tags, ["kopi", "susu"]); // lowercased, de-duped, first-seen order
});

test("setEntityTags creates tag rows and entity_tags links", async () => {
  await setEntityTags("task", "t1", ["kerja", "urgent"]);
  assert.equal(await countStore("tags"), 2);
  assert.equal(await countStore("entity_tags"), 2);
});

test("setEntityTags reuses an existing tag by name (no duplicate tag rows)", async () => {
  await setEntityTags("task", "t1", ["kerja"]);
  await setEntityTags("task", "t2", ["kerja"]);
  assert.equal(await countStore("tags"), 1);       // one shared tag
  assert.equal(await countStore("entity_tags"), 2); // two links
});

test("setEntityTags rewrites links for the entity (replaces previous set)", async () => {
  await setEntityTags("task", "t1", ["a", "b"]);
  await setEntityTags("task", "t1", ["b", "c"]);
  const names = (await getEntityTags("task", "t1")).map((t) => t.name);
  assert.deepEqual(names, ["b", "c"]);
});

test("setEntityTags with an empty list clears the entity's links", async () => {
  await setEntityTags("task", "t1", ["a"]);
  await setEntityTags("task", "t1", []);
  assert.deepEqual(await getEntityTags("task", "t1"), []);
});

test("getEntityTags returns sorted {name,color}", async () => {
  await setEntityTags("task", "t1", ["zeta", "alpha"]);
  assert.deepEqual(await getEntityTags("task", "t1"), [
    { name: "alpha", color: null }, { name: "zeta", color: null },
  ]);
});

test("getAllTags returns all tags sorted by name", async () => {
  await setEntityTags("task", "t1", ["zeta"]);
  await setEntityTags("task", "t2", ["alpha"]);
  assert.deepEqual((await getAllTags()).map((t) => t.name), ["alpha", "zeta"]);
});

test("removeEntityTag removes only that relation and keeps the global tag", async () => {
  await setEntityTags("task", "t1", ["a", "b"]);
  await removeEntityTag("task", "t1", "A"); // case-insensitive
  assert.deepEqual((await getEntityTags("task", "t1")).map((t) => t.name), ["b"]);
  assert.equal(await countStore("tags"), 2); // tag 'a' still exists globally
});

test("cidsForTag returns the set of entity cids for a tag name", async () => {
  await setEntityTags("task", "t1", ["kerja"]);
  await setEntityTags("task", "t2", ["kerja"]);
  await setEntityTags("task", "t3", ["lain"]);
  const set = await cidsForTag("task", "KERJA");
  assert.deepEqual([...set].sort(), ["t1", "t2"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/tagrepo.test.js`
Expected: FAIL — cannot find module `tagrepo.js`.

- [ ] **Step 3: Write `static/offline/tagrepo.js`**

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

  const TAG_RE = /#([a-zA-Z0-9_À-ɏ]+)/g;

  // Pure: lowercased, de-duplicated tag names (in first-seen order) + the title with tags removed.
  function extractTags(title) {
    const s = String(title == null ? "" : title);
    const tags = [];
    const seen = {};
    let m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(s)) !== null) {
      const name = m[1].toLowerCase();
      if (!seen[name]) { seen[name] = true; tags.push(name); }
    }
    return { clean: s.replace(TAG_RE, "").trim(), tags: tags };
  }

  function getAll(store) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction(store, "readonly").objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }

  // Replace the entity's links with the given tag names (normalized). Upserts `tags` by name.
  function setEntityTags(entityType, entityCid, tagNames) {
    const names = [];
    const seen = {};
    for (const raw of (tagNames || [])) {
      const n = String(raw).trim().toLowerCase();
      if (n && !seen[n]) { seen[n] = true; names.push(n); }
    }
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(["tags", "entity_tags"], "readwrite");
      const tagStore = tx.objectStore("tags");
      const etStore = tx.objectStore("entity_tags");
      const nameIdx = tagStore.index("name");
      const entityIdx = etStore.index("entity");

      const delReq = entityIdx.openCursor(IDBKeyRange.only([entityType, entityCid]));
      delReq.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) { cur.delete(); cur.continue(); }
        else { upsertNext(0); }
      };

      function upsertNext(i) {
        if (i >= names.length) return; // done — tx.oncomplete resolves
        const g = nameIdx.get(names[i]);
        g.onsuccess = () => {
          let tagCid;
          if (g.result) {
            tagCid = g.result.cid;
          } else {
            tagCid = TFids.newCid();
            tagStore.add({ cid: tagCid, server_id: null, name: names[i], color: null, dirty: 1 });
          }
          etStore.add({
            cid: TFids.newCid(), tag_cid: tagCid,
            entity_type: entityType, entity_cid: entityCid, dirty: 1,
          });
          upsertNext(i + 1);
        };
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  function getEntityTags(entityType, entityCid) {
    return Promise.all([getAll("entity_tags"), getAll("tags")]).then(([ets, tags]) => {
      const tagByCid = {};
      for (const t of tags) tagByCid[t.cid] = t;
      const out = [];
      for (const et of ets) {
        if (et.entity_type === entityType && et.entity_cid === entityCid) {
          const t = tagByCid[et.tag_cid];
          if (t) out.push({ name: t.name, color: t.color != null ? t.color : null });
        }
      }
      out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return out;
    });
  }

  function getAllTags() {
    return getAll("tags").then((rows) =>
      rows.map((t) => ({ name: t.name, color: t.color != null ? t.color : null }))
          .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    );
  }

  function removeEntityTag(entityType, entityCid, name) {
    const norm = String(name).trim().toLowerCase();
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(["tags", "entity_tags"], "readwrite");
      const nameIdx = tx.objectStore("tags").index("name");
      const entityIdx = tx.objectStore("entity_tags").index("entity");
      const g = nameIdx.get(norm);
      g.onsuccess = () => {
        const tag = g.result;
        if (!tag) return;
        const cur = entityIdx.openCursor(IDBKeyRange.only([entityType, entityCid]));
        cur.onsuccess = (e) => {
          const c = e.target.result;
          if (c) { if (c.value.tag_cid === tag.cid) c.delete(); c.continue(); }
        };
      };
      tx.oncomplete = () => resolve({ ok: true });
      tx.onerror = () => reject(tx.error);
    }));
  }

  function cidsForTag(entityType, tagName) {
    const norm = String(tagName).trim().toLowerCase();
    return Promise.all([getAll("entity_tags"), getAll("tags")]).then(([ets, tags]) => {
      const set = new Set();
      const tag = tags.find((t) => t.name === norm);
      if (!tag) return set;
      for (const et of ets) {
        if (et.entity_type === entityType && et.tag_cid === tag.cid) set.add(et.entity_cid);
      }
      return set;
    });
  }

  const exported = { extractTags, setEntityTags, getEntityTags, getAllTags, removeEntityTag, cidsForTag };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.tagrepo = exported; }
  return exported;
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/tagrepo.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add static/offline/tagrepo.js tests/offline/tagrepo.test.js
git commit -m "feat(offline): tagRepo (extract/set/get/remove entity tags)"
```

---

## Task 2: `recurrence.js`

**Files:**
- Create: `static/offline/recurrence.js`
- Test: `tests/offline/recurrence.test.js`

- [ ] **Step 1: Write the failing test `tests/offline/recurrence.test.js`**

```js
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
  // r2 is deleted — but mark still allowed? deleted task rejected by markOccurrence, so seed its exception raw:
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/recurrence.test.js`
Expected: FAIL — cannot find module `recurrence.js`.

- [ ] **Step 3: Write `static/offline/recurrence.js`**

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

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function getAll(store) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction(store, "readonly").objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }

  function getTaskRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("tasks", "readonly").objectStore("tasks").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }

  function markOccurrence(taskCid, occurrenceDate, status, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    if (status !== "done" && status !== "skipped") {
      return Promise.reject(new Error("status harus 'done' atau 'skipped'"));
    }
    if (!DATE_RE.test(String(occurrenceDate))) {
      return Promise.reject(new Error("Format tanggal tidak valid (YYYY-MM-DD)"));
    }
    return getTaskRaw(taskCid).then((task) => {
      if (!task || task.deleted) return Promise.reject(new Error("Task not found"));
      if (!task.recurrence_type) return Promise.reject(new Error("Task ini bukan recurring task"));
      const created = String(task.created_at).slice(0, 10);
      const end = task.recurrence_end_date;
      if (occurrenceDate < created || (end && occurrenceDate > end)) {
        return Promise.reject(new Error("Tanggal di luar range recurring task"));
      }
      return upsertException(taskCid, occurrenceDate, status, now);
    });
  }

  function upsertException(taskCid, occurrenceDate, status, now) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("recurring_exceptions", "readwrite");
      const store = tx.objectStore("recurring_exceptions");
      const idx = store.index("task_cid");
      let record = null;
      const cur = idx.openCursor(IDBKeyRange.only(taskCid));
      cur.onsuccess = (e) => {
        const c = e.target.result;
        if (c) {
          if (c.value.occurrence_date === occurrenceDate) {
            record = Object.assign({}, c.value, { status: status });
            c.update(record);
            return; // matched — stop
          }
          c.continue();
        } else if (!record) {
          record = {
            cid: TFids.newCid(), task_cid: taskCid,
            occurrence_date: occurrenceDate, status: status, created_at: now, dirty: 1,
          };
          store.add(record);
        }
      };
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
    })).then((record) =>
      TFoutbox.outboxAdd({
        op: "mark_occurrence", entity_type: "recurring_exception", cid: record.cid, payload: record,
      }).then(() => record)
    );
  }

  function getExceptions(fromDate, toDate) {
    return Promise.all([getAll("recurring_exceptions"), getAll("tasks")]).then(([excs, tasks]) => {
      const live = {};
      for (const t of tasks) if (!t.deleted) live[t.cid] = true;
      const out = {};
      for (const ex of excs) {
        if (!live[ex.task_cid]) continue;
        if (ex.occurrence_date < fromDate || ex.occurrence_date > toDate) continue;
        if (!out[ex.task_cid]) out[ex.task_cid] = [];
        out[ex.task_cid].push({ occurrence_date: ex.occurrence_date, status: ex.status });
      }
      return out;
    });
  }

  const exported = { markOccurrence, getExceptions };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.recurrence = exported; }
  return exported;
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/recurrence.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add static/offline/recurrence.js tests/offline/recurrence.test.js
git commit -m "feat(offline): recurrence markOccurrence + getExceptions"
```

---

## Task 3: `taskrepo.js` — recurrence fields + tag persistence

**Files:**
- Modify: `static/offline/taskrepo.js`
- Modify: `tests/offline/taskrepo.test.js`

- [ ] **Step 1: Append failing tests to `tests/offline/taskrepo.test.js`**

```js
const { updateTask } = require("../../static/offline/taskrepo.js");
const { getEntityTags } = require("../../static/offline/tagrepo.js");

test("createTask persists recurrence fields (weekly days json + end_date)", async () => {
  const t = await createTask(
    { title: "Standup", recurrence_type: "weekly", recurrence_days: [1, 3, 5] },
    { today: TODAY, now: NOW }
  );
  assert.equal(t.recurrence_type, "weekly");
  assert.equal(t.recurrence_days, JSON.stringify([1, 3, 5]));
  assert.equal(t.recurrence_end_date, "2026-09-01"); // 2026-06-03 + 90d
  assert.equal(t.recurrence_notif_level, null);
});

test("createTask without recurrence leaves recurrence fields null", async () => {
  const t = await createTask({ title: "Plain" }, { today: TODAY, now: NOW });
  assert.equal(t.recurrence_type, null);
  assert.equal(t.recurrence_days, null);
  assert.equal(t.recurrence_end_date, null);
});

test("createTask persists #tags from the title", async () => {
  const t = await createTask({ title: "Beli #kopi #Susu" }, { today: TODAY, now: NOW });
  assert.equal(t.title, "Beli");
  assert.deepEqual((await getEntityTags("task", t.cid)).map((x) => x.name), ["kopi", "susu"]);
});

test("updateTask rewrites tags when the title changes", async () => {
  const t = await createTask({ title: "A #one" }, { today: TODAY, now: NOW });
  await updateTask(t.cid, { title: "B #two #three" }, { today: TODAY, now: NOW });
  assert.deepEqual((await getEntityTags("task", t.cid)).map((x) => x.name), ["three", "two"]);
});

test("updateTask leaves tags untouched when the title is absent", async () => {
  const t = await createTask({ title: "A #keep" }, { today: TODAY, now: NOW });
  await updateTask(t.cid, { priority: "P1" }, { today: TODAY, now: NOW });
  assert.deepEqual((await getEntityTags("task", t.cid)).map((x) => x.name), ["keep"]);
});

test("updateTask sets recurrence (type + monthly day clamp + end_date)", async () => {
  const t = await createTask({ title: "Bill" }, { today: TODAY, now: NOW });
  const u = await updateTask(
    t.cid, { recurrence_type: "monthly", recurrence_days: [99] }, { today: TODAY, now: NOW }
  );
  assert.equal(u.recurrence_type, "monthly");
  assert.equal(u.recurrence_days, JSON.stringify([28])); // clamped to 28
  assert.equal(u.recurrence_end_date, "2026-09-01");
});

test("updateTask recurrence_renew bumps end_date and clears notif_level", async () => {
  const t = await createTask(
    { title: "Daily", recurrence_type: "daily" }, { today: "2026-01-01", now: NOW }
  );
  const u = await updateTask(t.cid, { recurrence_renew: true }, { today: TODAY, now: NOW });
  assert.equal(u.recurrence_end_date, "2026-09-01"); // today+90, not the old 2026-04-01
  assert.equal(u.recurrence_notif_level, null);
});

test("updateTask clears recurrence when type is null/invalid", async () => {
  const t = await createTask(
    { title: "Daily", recurrence_type: "daily" }, { today: TODAY, now: NOW }
  );
  const u = await updateTask(t.cid, { recurrence_type: null }, { today: TODAY, now: NOW });
  assert.equal(u.recurrence_type, null);
  assert.equal(u.recurrence_days, null);
  assert.equal(u.recurrence_end_date, null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/taskrepo.test.js`
Expected: FAIL — recurrence fields undefined / tags not persisted.

- [ ] **Step 3: Modify `static/offline/taskrepo.js`**

Add the tagrepo dependency near the other requires (after the `TFlogic` line):

```js
  const TFtagrepo = isNode ? require("./tagrepo.js") : root.TF.tagrepo;
```

Add these two helpers immediately after the `const TAG_RE = ...` line (and you may delete the now-unused `stripTags` function and `TAG_RE` once `extractTags` replaces them — see below):

```js
  // today (YYYY-MM-DD) + 90 days, UTC-stable.
  function plus90(todayISO) {
    const base = todayISO || new Date().toISOString().slice(0, 10);
    const [y, m, d] = String(base).slice(0, 10).split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d) + 90 * 86400000);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }

  // Normalize recurrence type + days → { type, daysJson } matching the server.
  function normRecurrence(type, days) {
    const t = (type === "daily" || type === "weekly" || type === "monthly" || type === "weekdays") ? type : null;
    let daysJson = null;
    if (t === "weekly" && Array.isArray(days)) {
      daysJson = JSON.stringify(days.map(Number).filter((n) => n >= 0 && n <= 6));
    } else if (t === "monthly" && Array.isArray(days) && days.length) {
      daysJson = JSON.stringify([Math.max(1, Math.min(28, Number(days[0])))]);
    }
    return { type: t, daysJson: daysJson };
  }
```

Replace the `createTask` body's title handling and record so it uses `extractTags`, persists recurrence, and writes tags. Replace from `const cleanTitle = stripTags(input.title);` through the `return putRaw(rec)...` chain with:

```js
    const ex = TFtagrepo.extractTags(input.title);
    const cleanTitle = ex.clean;
    if (!cleanTitle) {
      return Promise.reject(new Error("Judul tidak boleh kosong setelah strip tag"));
    }
    const priority = String(input.priority || "P3").toUpperCase();
    const deadline = input.deadline || null;
    const rc = normRecurrence(input.recurrence_type, input.recurrence_days);
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
      recurrence_type: rc.type,
      recurrence_days: rc.daysJson,
      recurrence_end_date: rc.type ? plus90(opts && opts.today) : null,
      recurrence_notif_level: null,
      created_at: now,
      updated_at: now,
      deleted: false,
      dirty: 1,
      base_rev: null,
    };
    return putRaw(rec)
      .then(() => TFoutbox.outboxAdd({ op: "create", entity_type: "task", cid: rec.cid, payload: rec }))
      .then(() => TFtagrepo.setEntityTags("task", rec.cid, ex.tags))
      .then(() => assemble(rec, opts && opts.today));
```

In `updateTask`, replace the title branch:

```js
      let newTags = null;
      if (patch.title != null) {
        const ex = TFtagrepo.extractTags(patch.title);
        if (!ex.clean) return Promise.reject(new Error("Judul tidak boleh kosong setelah strip tag"));
        next.title = ex.clean;
        newTags = ex.tags;
      }
```

Add recurrence handling immediately before the `next.updated_at = now;` line:

```js
      if (patch.recurrence_renew) {
        next.recurrence_end_date = plus90(opts && opts.today);
        next.recurrence_notif_level = null;
      } else if ("recurrence_type" in patch) {
        const rc = normRecurrence(patch.recurrence_type, patch.recurrence_days);
        if (rc.type) {
          next.recurrence_type = rc.type;
          next.recurrence_days = rc.daysJson;
          if (!next.recurrence_end_date) next.recurrence_end_date = plus90(opts && opts.today);
        } else {
          next.recurrence_type = null;
          next.recurrence_days = null;
          next.recurrence_end_date = null;
          next.recurrence_notif_level = null;
        }
      }
```

Replace the `updateTask` return chain so tags are rewritten when the title changed:

```js
      return putRaw(next)
        .then(() => TFoutbox.outboxAdd({ op: "update", entity_type: "task", cid: cid, payload: next }))
        .then(() => (newTags != null ? TFtagrepo.setEntityTags("task", cid, newTags) : null))
        .then(() => assemble(next, opts && opts.today));
```

> Note: `extractTags` replaces the old `stripTags`/`TAG_RE`. If `stripTags`/`TAG_RE` are no longer referenced anywhere, delete them; otherwise leave them. Verify with a search before deleting.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/taskrepo.test.js`
Expected: PASS, 29 tests (21 prior + 8 new).

- [ ] **Step 5: Commit**

```bash
git add static/offline/taskrepo.js tests/offline/taskrepo.test.js
git commit -m "feat(offline): taskRepo persists recurrence fields + tags"
```

---

## Task 4: `taskquery.js` — `tag` filter

**Files:**
- Modify: `static/offline/taskquery.js`
- Modify: `tests/offline/taskquery.test.js`

- [ ] **Step 1: Append failing tests to `tests/offline/taskquery.test.js`**

Add this require near the other requires at the top of the file (after the existing `getSummary` require), then append the tests:

```js
const { setEntityTags } = require("../../static/offline/tagrepo.js");

test("listTasks filters by tag", async () => {
  await seed([
    task({ cid: "a", gtd_status: "next" }),
    task({ cid: "b", gtd_status: "next" }),
    task({ cid: "c", gtd_status: "next" }),
  ]);
  await setEntityTags("task", "a", ["kerja"]);
  await setEntityTags("task", "c", ["kerja"]);
  const rows = await listTasks({ tag: "KERJA" }, { today: TODAY }); // case-insensitive
  assert.deepEqual(rows.map((r) => r.cid).sort(), ["a", "c"]);
});

test("listTasks tag with no matches returns empty", async () => {
  await seed([task({ cid: "a", gtd_status: "next" })]);
  const rows = await listTasks({ tag: "missing" }, { today: TODAY });
  assert.deepEqual(rows, []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/taskquery.test.js`
Expected: FAIL — `tag` is currently ignored, so the first test returns all 3 rows.

- [ ] **Step 3: Modify `static/offline/taskquery.js`**

Add the tagrepo dependency after the `TFrepo` require line:

```js
  const TFtagrepo = isNode ? require("./tagrepo.js") : root.TF.tagrepo;
```

In `matchesQuery`, remove the obsolete comment line `// q.tag is intentionally ignored ...` (the tag filter is now applied separately in `listTasks`).

Replace the whole `listTasks` function with:

```js
  function listTasks(query, opts) {
    const today = opts && opts.today;
    const q = query || {};
    const tagPromise = (q.tag != null && q.tag !== "")
      ? TFtagrepo.cidsForTag("task", q.tag)
      : Promise.resolve(null);
    return Promise.all([getAllRaw(), tagPromise]).then(([all, tagSet]) => {
      const live = all.filter((r) => !r.deleted);
      const titleByCid = {};
      for (const r of live) titleByCid[r.cid] = r.title;
      let rows = live.filter((r) => matchesQuery(r, q));
      if (tagSet) rows = rows.filter((r) => tagSet.has(r.cid));
      rows.sort(compareTasks);
      return rows.map((r) => {
        const parentTitle = r.parent_cid ? (titleByCid[r.parent_cid] != null ? titleByCid[r.parent_cid] : null) : null;
        return TFrepo.displayFrom(r, today, parentTitle);
      });
    });
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/taskquery.test.js`
Expected: PASS, 13 tests (11 prior + 2 new).

- [ ] **Step 5: Commit**

```bash
git add static/offline/taskquery.js tests/offline/taskquery.test.js
git commit -m "feat(offline): taskQuery tag filter via tagRepo"
```

---

## Task 5: Full-suite regression

- [ ] **Step 1: Run the whole offline suite**

Run:
```bash
node --test tests/offline/smoke.test.js tests/offline/ids.test.js tests/offline/db.test.js tests/offline/meta.test.js tests/offline/idmap.test.js tests/offline/outbox.test.js tests/offline/blobstore.test.js tests/offline/router.test.js tests/offline/tasklogic.test.js tests/offline/taskrepo.test.js tests/offline/taskquery.test.js tests/offline/tagrepo.test.js tests/offline/recurrence.test.js
```
Expected: `ℹ tests 106 / ℹ pass 106 / ℹ fail 0`, terminating promptly.

> Count: prior suite 79 + Task 1 (9) + Task 2 (8) + Task 3 (8) + Task 4 (2) = **106**.

- [ ] **Step 2: No commit needed** (regression run only). If anything fails, fix before proceeding.

---

## Done criteria

- `static/offline/tagrepo.js` exports `extractTags`, `setEntityTags`, `getEntityTags`, `getAllTags`, `removeEntityTag`, `cidsForTag`.
- `static/offline/recurrence.js` exports `markOccurrence`, `getExceptions` with server-parity validation and outbox recording.
- `taskRepo.createTask`/`updateTask` persist `recurrence_*` fields and task tags (re-derive-on-title parity); recurrence renew/set/clear handled.
- `taskQuery.listTasks` applies the `tag` filter via `tagrepo.cidsForTag`.
- Full offline suite green (106 tests), no hang.

## Next plans (not in scope here)

- **#1e(b) — Wiring `index.html`** (browser-verified): intercept `api` via `LocalRouter` for `/api/tasks*`, `/api/summary`, `/api/projects`, `/api/contexts`, `/api/tasks/{id}/tags`, `/api/tags`, `/api/recurring/exceptions`, `/api/tasks/{id}/occurrences/{date}/mark`; retire in-page `OfflineDB` + `computeOfflineQuadrant`; hydration; SW cache bump.
- **Note/habit/mindmap tag persistence** — call `tagrepo.setEntityTags` for their entity types within their own offline-domain plans.
