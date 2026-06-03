# Offline Data Layer — Foundation/Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Node-testable foundation modules for the offline-first local data layer (IndexedDB schema + migration, ID generation, id-map, outbox, meta, blob store, and the LocalRouter skeleton) — the shared scaffolding every personal domain will build on.

**Architecture:** Plain-JS modules under `static/offline/` using a dual export wrapper so each file works both in the browser (attaches to `window.TF`) and in Node (via `require`/`module.exports`). All logic is unit-tested in Node with the built-in `node:test` runner and `fake-indexeddb`. This plan does NOT touch the 21k-line `static/index.html` and does NOT wire anything into the running app — that is the next plan (tasks pilot), which is where browser end-to-end testing happens.

**Tech Stack:** Vanilla ES2017 JS, IndexedDB, `node:test`, `node:assert/strict`, `fake-indexeddb`, `crypto.randomUUID`.

**Spec:** `docs/superpowers/specs/2026-06-03-offline-first-local-data-layer-design.md` (Sections 3, 4, 5-skeleton, 6).

---

## Scope of THIS plan

In (foundation only):
- Dev tooling: `node:test` + `fake-indexeddb`, `npm test` script.
- `static/offline/ids.js` — canonical `cid` generation.
- `static/offline/db.js` — IndexedDB schema (all entity + system stores) and migration v1→v2 (`queue`→`_outbox`).
- `static/offline/meta.js` — key/value `_meta` access.
- `static/offline/idmap.js` — `(entity_type, server_id) ↔ cid` mapping.
- `static/offline/outbox.js` — append/list/remove mutation ops.
- `static/offline/blobstore.js` — `BlobStore` interface + IndexedDB implementation + factory.
- `static/offline/router.js` — `LocalRouter` skeleton (register/match/dispatch with path params).

Out (later plans):
- Wiring `<script>` tags into `static/index.html`, replacing in-page `OfflineDB`, removing legacy `cache` store from the page opener — **tasks-pilot plan**.
- `taskRepo` and other domain repos, business-logic parity (recurring/summary/search), hydration, Service Worker changes — **tasks-pilot plan + per-domain plans**.
- `BlobStore` filesystem implementation (needs Tauri runtime) — **sub-project #3**.

---

## File structure

```
static/offline/
  ids.js          # newCid()
  db.js           # DB_NAME, DB_VERSION, STORES, openDB(), tx helpers, migration
  meta.js         # metaGet(key), metaSet(key, val)
  idmap.js        # mapPut(type, serverId, cid), cidOf(type, serverId), serverIdOf(cid)
  outbox.js       # outboxAdd(op), outboxAll(), outboxRemove(qid), outboxByEntity(type, cid)
  blobstore.js    # makeBlobStore(env) -> { put, getBytes, getURL, delete }
  router.js       # makeRouter() -> { register, dispatch }
tests/offline/
  setup.js        # shared: load fake-indexeddb/auto, reset DB between tests
  ids.test.js
  db.test.js
  meta.test.js
  idmap.test.js
  outbox.test.js
  blobstore.test.js
  router.test.js
package.json       # + devDependencies, + "test" script
```

**Module wrapper convention (used by every file in `static/offline/`):**

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
  // ... module body ...
  const exported = { /* public api */ };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.<name> = exported; }
  return exported;
});
```

Dependent modules resolve their dependency once, at the top of the factory:

```js
const TFdb = (typeof module !== "undefined" && module.exports)
  ? require("./db.js")
  : root.TF.db;
```

---

## Task 1: Dev tooling — test runner + fake-indexeddb

**Files:**
- Modify: `package.json`
- Create: `tests/offline/setup.js`
- Create: `tests/offline/smoke.test.js`

- [ ] **Step 1: Add devDependencies and test script to `package.json`**

Replace the file contents with:

```json
{
  "name": "taskflow-compile",
  "version": "1.0.0",
  "description": "JSX pre-compiler for TaskFlow V4 index.html",
  "scripts": {
    "compile": "node compile.js",
    "test": "node --test tests/offline/"
  },
  "dependencies": {
    "@babel/core": "^7.24.0",
    "@babel/preset-react": "^7.24.0"
  },
  "devDependencies": {
    "fake-indexeddb": "^6.0.0"
  }
}
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: `fake-indexeddb` added under `node_modules`, no errors.

- [ ] **Step 3: Create shared test setup `tests/offline/setup.js`**

```js
"use strict";
// Installs a global `indexedDB` backed by fake-indexeddb.
require("fake-indexeddb/auto");

// Delete a database by name and wait for completion — used to isolate tests.
function deleteDB(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // no other connections in tests
  });
}

module.exports = { deleteDB };
```

- [ ] **Step 4: Write a smoke test `tests/offline/smoke.test.js`**

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./setup.js");

test("fake-indexeddb global is available", () => {
  assert.equal(typeof indexedDB, "object");
  assert.equal(typeof indexedDB.open, "function");
});

test("crypto.randomUUID is available in Node", () => {
  assert.equal(typeof crypto.randomUUID, "function");
});
```

- [ ] **Step 5: Run the smoke test**

Run: `npm test`
Expected: PASS, 2 tests passing.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tests/offline/setup.js tests/offline/smoke.test.js
git commit -m "test: add node:test + fake-indexeddb harness for offline layer"
```

---

## Task 2: `ids.js` — canonical cid generation

**Files:**
- Create: `static/offline/ids.js`
- Test: `tests/offline/ids.test.js`

- [ ] **Step 1: Write the failing test**

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { newCid } = require("../../static/offline/ids.js");

test("newCid returns a v4 UUID string", () => {
  const id = newCid();
  assert.equal(typeof id, "string");
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("newCid is unique across many calls", () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(newCid());
  assert.equal(seen.size, 1000);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/ids.test.js`
Expected: FAIL — cannot find module `../../static/offline/ids.js`.

- [ ] **Step 3: Write minimal implementation `static/offline/ids.js`**

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

  function newCid() {
    return crypto.randomUUID();
  }

  const exported = { newCid };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.ids = exported; }
  return exported;
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/ids.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add static/offline/ids.js tests/offline/ids.test.js
git commit -m "feat(offline): cid (uuid v4) generator"
```

---

## Task 3: `db.js` — schema + open + migration v1→v2

**Files:**
- Create: `static/offline/db.js`
- Test: `tests/offline/db.test.js`

- [ ] **Step 1: Write the failing test**

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, DB_VERSION, ENTITY_STORE_NAMES, openDB } = require("../../static/offline/db.js");

beforeEach(async () => { await deleteDB(DB_NAME); });

test("openDB creates all entity stores", async () => {
  const db = await openDB();
  for (const name of ENTITY_STORE_NAMES) {
    assert.ok(db.objectStoreNames.contains(name), `missing entity store: ${name}`);
  }
  db.close();
});

test("openDB creates all system stores", async () => {
  const db = await openDB();
  for (const name of ["_meta", "_idmap", "_outbox", "blobs"]) {
    assert.ok(db.objectStoreNames.contains(name), `missing system store: ${name}`);
  }
  db.close();
});

test("tasks store has expected indexes", async () => {
  const db = await openDB();
  const tx = db.transaction("tasks", "readonly");
  const idx = tx.objectStore("tasks").indexNames;
  for (const name of ["server_id", "gtd_status", "list_cid", "parent_cid", "updated_at", "dirty"]) {
    assert.ok(idx.contains(name), `tasks missing index: ${name}`);
  }
  db.close();
});

test("migration v1->v2 moves queue records into _outbox and drops queue", async () => {
  // Build a legacy v1 DB exactly like the in-page OfflineDB.
  await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      db.createObjectStore("cache");
      db.createObjectStore("queue", { keyPath: "qid", autoIncrement: true });
    };
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction("queue", "readwrite");
      tx.objectStore("queue").add({ kind: "task", action: "create", payload: { title: "x" } });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });

  const db = await openDB(); // upgrades to v2
  assert.equal(db.objectStoreNames.contains("queue"), false, "queue should be deleted");
  const all = await new Promise((resolve, reject) => {
    const r = db.transaction("_outbox", "readonly").objectStore("_outbox").getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  assert.equal(all.length, 1);
  assert.equal(all[0].kind, "task");
  db.close();
});

test("DB_VERSION is 2", () => { assert.equal(DB_VERSION, 2); });
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/db.test.js`
Expected: FAIL — cannot find module `db.js`.

- [ ] **Step 3: Write `static/offline/db.js`**

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

  const DB_NAME = "taskflow-offline";
  const DB_VERSION = 2;

  // Each entity store keyed by `cid`. Indexes: [name, keyPath, options].
  const ENTITY_STORES = {
    tasks: [
      ["server_id", "server_id"], ["gtd_status", "gtd_status"], ["list_cid", "list_cid"],
      ["parent_cid", "parent_cid"], ["updated_at", "updated_at"], ["dirty", "dirty"],
    ],
    subtasks: [["task_cid", "task_cid"], ["server_id", "server_id"], ["dirty", "dirty"]],
    task_notes: [["task_cid", "task_cid"], ["server_id", "server_id"], ["dirty", "dirty"]],
    task_attachments: [["task_cid", "task_cid"]],
    habits: [["server_id", "server_id"], ["dirty", "dirty"]],
    habit_logs: [
      ["habit_date", ["habit_cid", "date"], { unique: true }],
      ["date", "date"], ["dirty", "dirty"],
    ],
    scratchpad_notes: [
      ["server_id", "server_id"], ["updated_at", "updated_at"],
      ["linked_task_cids", "linked_task_cids", { multiEntry: true }], ["dirty", "dirty"],
    ],
    drawings: [["note_cid", "note_cid"]],
    note_attachments: [["note_cid", "note_cid"]],
    note_pins: [["note_cid", "note_cid"]],
    mindmaps: [["server_id", "server_id"], ["updated_at", "updated_at"], ["dirty", "dirty"]],
    tags: [["server_id", "server_id"], ["name", "name"], ["dirty", "dirty"]],
    entity_tags: [
      ["tag_cid", "tag_cid"],
      ["entity", ["entity_type", "entity_cid"]],
      ["dirty", "dirty"],
    ],
    recurring_exceptions: [["task_cid", "task_cid"], ["dirty", "dirty"]],
    note_templates: [["server_id", "server_id"], ["dirty", "dirty"]],
    habit_templates: [["server_id", "server_id"], ["dirty", "dirty"]],
  };

  const ENTITY_STORE_NAMES = Object.keys(ENTITY_STORES);

  let _dbPromise = null;

  function createSchema(db, tx) {
    // Entity stores (keyPath cid).
    for (const [name, indexes] of Object.entries(ENTITY_STORES)) {
      const store = db.objectStoreNames.contains(name)
        ? tx.objectStore(name)
        : db.createObjectStore(name, { keyPath: "cid" });
      for (const [idxName, keyPath, options] of indexes) {
        if (!store.indexNames.contains(idxName)) store.createIndex(idxName, keyPath, options || {});
      }
    }
    // System stores.
    if (!db.objectStoreNames.contains("_meta")) db.createObjectStore("_meta"); // out-of-line keys
    if (!db.objectStoreNames.contains("_idmap")) {
      const m = db.createObjectStore("_idmap", { keyPath: "key" }); // key = `${type}:${server_id}`
      m.createIndex("cid", "cid");
    }
    if (!db.objectStoreNames.contains("_outbox")) {
      db.createObjectStore("_outbox", { keyPath: "qid", autoIncrement: true });
    }
    if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs", { keyPath: "id" });
  }

  // Copy any legacy v1 `queue` records into `_outbox`, then delete `queue` and `cache`.
  function migrateLegacy(db, tx) {
    if (!db.objectStoreNames.contains("queue")) return;
    const src = tx.objectStore("queue");
    const dst = tx.objectStore("_outbox");
    const cur = src.openCursor();
    cur.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const { qid, ...rest } = cursor.value; // drop old key, let _outbox assign new qid
        dst.add(rest);
        cursor.continue();
      } else {
        db.deleteObjectStore("queue");
        if (db.objectStoreNames.contains("cache")) db.deleteObjectStore("cache");
      }
    };
  }

  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const tx = e.target.transaction; // versionchange transaction
        createSchema(db, tx);
        migrateLegacy(db, tx);
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => {}; // ignore in single-connection contexts
    });
    return _dbPromise;
  }

  // Reset cached connection — used by tests after deleteDatabase.
  function _reset() { _dbPromise = null; }

  const exported = { DB_NAME, DB_VERSION, ENTITY_STORES, ENTITY_STORE_NAMES, openDB, _reset };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.db = exported; }
  return exported;
});
```

- [ ] **Step 4: Make tests reset the cached connection**

The module caches its open promise. Update `beforeEach` in `tests/offline/db.test.js` to reset it:

```js
const { DB_NAME, DB_VERSION, ENTITY_STORE_NAMES, openDB, _reset } = require("../../static/offline/db.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test tests/offline/db.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add static/offline/db.js tests/offline/db.test.js
git commit -m "feat(offline): IndexedDB schema v2 + legacy queue->_outbox migration"
```

---

## Task 4: `meta.js` — key/value access to `_meta`

**Files:**
- Create: `static/offline/meta.js`
- Test: `tests/offline/meta.test.js`

- [ ] **Step 1: Write the failing test**

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset } = require("../../static/offline/db.js");
const { metaGet, metaSet } = require("../../static/offline/meta.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

test("metaGet returns undefined for missing key", async () => {
  assert.equal(await metaGet("nope"), undefined);
});

test("metaSet then metaGet round-trips a value", async () => {
  await metaSet("schema_version", 2);
  assert.equal(await metaGet("schema_version"), 2);
});

test("metaSet overwrites", async () => {
  await metaSet("cursor:tasks", "2026-01-01");
  await metaSet("cursor:tasks", "2026-02-02");
  assert.equal(await metaGet("cursor:tasks"), "2026-02-02");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/meta.test.js`
Expected: FAIL — cannot find module `meta.js`.

- [ ] **Step 3: Write `static/offline/meta.js`**

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

  const TFdb = (typeof module !== "undefined" && module.exports)
    ? require("./db.js")
    : root.TF.db;

  function metaGet(key) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("_meta", "readonly").objectStore("_meta").get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }

  function metaSet(key, val) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("_meta", "readwrite");
      tx.objectStore("_meta").put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  const exported = { metaGet, metaSet };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.meta = exported; }
  return exported;
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/meta.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add static/offline/meta.js tests/offline/meta.test.js
git commit -m "feat(offline): _meta key/value accessor"
```

---

## Task 5: `idmap.js` — server_id ↔ cid mapping

**Files:**
- Create: `static/offline/idmap.js`
- Test: `tests/offline/idmap.test.js`

- [ ] **Step 1: Write the failing test**

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset } = require("../../static/offline/db.js");
const { mapPut, cidOf, serverIdOf } = require("../../static/offline/idmap.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

test("cidOf returns undefined when unmapped", async () => {
  assert.equal(await cidOf("task", 1), undefined);
});

test("mapPut then cidOf resolves forward", async () => {
  await mapPut("task", 142, "cid-abc");
  assert.equal(await cidOf("task", 142), "cid-abc");
});

test("serverIdOf resolves reverse", async () => {
  await mapPut("note", 9, "cid-note");
  assert.equal(await serverIdOf("cid-note"), 9);
});

test("same server_id across different entity types does not collide", async () => {
  await mapPut("task", 1, "cid-task-1");
  await mapPut("note", 1, "cid-note-1");
  assert.equal(await cidOf("task", 1), "cid-task-1");
  assert.equal(await cidOf("note", 1), "cid-note-1");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/idmap.test.js`
Expected: FAIL — cannot find module `idmap.js`.

- [ ] **Step 3: Write `static/offline/idmap.js`**

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

  const TFdb = (typeof module !== "undefined" && module.exports)
    ? require("./db.js")
    : root.TF.db;

  const keyFor = (type, serverId) => `${type}:${serverId}`;

  function mapPut(type, serverId, cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("_idmap", "readwrite");
      tx.objectStore("_idmap").put({ key: keyFor(type, serverId), entity_type: type, server_id: serverId, cid });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function cidOf(type, serverId) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("_idmap", "readonly").objectStore("_idmap").get(keyFor(type, serverId));
      r.onsuccess = () => resolve(r.result ? r.result.cid : undefined);
      r.onerror = () => reject(r.error);
    }));
  }

  function serverIdOf(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("_idmap", "readonly").objectStore("_idmap").index("cid").get(cid);
      r.onsuccess = () => resolve(r.result ? r.result.server_id : undefined);
      r.onerror = () => reject(r.error);
    }));
  }

  const exported = { mapPut, cidOf, serverIdOf };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.idmap = exported; }
  return exported;
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/idmap.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add static/offline/idmap.js tests/offline/idmap.test.js
git commit -m "feat(offline): _idmap server_id<->cid mapping"
```

---

## Task 6: `outbox.js` — mutation queue

**Files:**
- Create: `static/offline/outbox.js`
- Test: `tests/offline/outbox.test.js`

- [ ] **Step 1: Write the failing test**

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset } = require("../../static/offline/db.js");
const { outboxAdd, outboxAll, outboxRemove, outboxByEntity } = require("../../static/offline/outbox.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

test("outboxAdd assigns a qid and stores ts/retries defaults", async () => {
  const qid = await outboxAdd({ op: "create", entity_type: "task", cid: "c1", payload: { title: "a" } });
  assert.equal(typeof qid, "number");
  const all = await outboxAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].op, "create");
  assert.equal(all[0].retries, 0);
  assert.equal(typeof all[0].ts, "number");
});

test("outboxAll preserves insertion order", async () => {
  await outboxAdd({ op: "create", entity_type: "task", cid: "c1", payload: {} });
  await outboxAdd({ op: "update", entity_type: "task", cid: "c1", payload: {} });
  const all = await outboxAll();
  assert.deepEqual(all.map((o) => o.op), ["create", "update"]);
});

test("outboxRemove deletes by qid", async () => {
  const qid = await outboxAdd({ op: "delete", entity_type: "task", cid: "c1", payload: {} });
  await outboxRemove(qid);
  assert.equal((await outboxAll()).length, 0);
});

test("outboxByEntity filters by type+cid", async () => {
  await outboxAdd({ op: "create", entity_type: "task", cid: "c1", payload: {} });
  await outboxAdd({ op: "create", entity_type: "note", cid: "c2", payload: {} });
  const r = await outboxByEntity("task", "c1");
  assert.equal(r.length, 1);
  assert.equal(r[0].entity_type, "task");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/outbox.test.js`
Expected: FAIL — cannot find module `outbox.js`.

- [ ] **Step 3: Write `static/offline/outbox.js`**

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

  const TFdb = (typeof module !== "undefined" && module.exports)
    ? require("./db.js")
    : root.TF.db;

  function outboxAdd(op) {
    const record = Object.assign({ ts: Date.now(), retries: 0 }, op);
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("_outbox", "readwrite");
      const r = tx.objectStore("_outbox").add(record);
      r.onsuccess = () => { record.qid = r.result; };
      tx.oncomplete = () => resolve(record.qid);
      tx.onerror = () => reject(tx.error);
    }));
  }

  function outboxAll() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("_outbox", "readonly").objectStore("_outbox").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }

  function outboxRemove(qid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("_outbox", "readwrite");
      tx.objectStore("_outbox").delete(qid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function outboxByEntity(type, cid) {
    return outboxAll().then((all) => all.filter((o) => o.entity_type === type && o.cid === cid));
  }

  const exported = { outboxAdd, outboxAll, outboxRemove, outboxByEntity };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.outbox = exported; }
  return exported;
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/outbox.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add static/offline/outbox.js tests/offline/outbox.test.js
git commit -m "feat(offline): _outbox mutation queue"
```

---

## Task 7: `blobstore.js` — interface + IndexedDB implementation

**Files:**
- Create: `static/offline/blobstore.js`
- Test: `tests/offline/blobstore.test.js`

Note: `getURL` depends on `URL.createObjectURL` (browser-only) and is NOT exercised in Node — the test covers `put`/`getBytes`/`delete`, which is the contract sync (#2) relies on. The filesystem implementation (Tauri) is sub-project #3; this plan ships only the IndexedDB implementation plus the factory that selects it.

- [ ] **Step 1: Write the failing test**

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset } = require("../../static/offline/db.js");
const { makeBlobStore } = require("../../static/offline/blobstore.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

test("factory selects IndexedDB impl when no Tauri global", () => {
  const store = makeBlobStore({ hasTauri: false });
  assert.equal(store.kind, "indexeddb");
});

test("put returns an opaque ref string", async () => {
  const store = makeBlobStore({ hasTauri: false });
  const ref = await store.put(new Uint8Array([1, 2, 3]), { mime: "application/octet-stream" });
  assert.equal(typeof ref, "string");
  assert.match(ref, /^blob_/);
});

test("getBytes returns the same bytes that were put", async () => {
  const store = makeBlobStore({ hasTauri: false });
  const ref = await store.put(new Uint8Array([10, 20, 30]), { mime: "image/png" });
  const out = await store.getBytes(ref);
  assert.deepEqual(Array.from(new Uint8Array(out)), [10, 20, 30]);
});

test("delete removes the blob", async () => {
  const store = makeBlobStore({ hasTauri: false });
  const ref = await store.put(new Uint8Array([1]), {});
  await store.delete(ref);
  assert.equal(await store.getBytes(ref), undefined);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/blobstore.test.js`
Expected: FAIL — cannot find module `blobstore.js`.

- [ ] **Step 3: Write `static/offline/blobstore.js`**

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

  const TFdb = (typeof module !== "undefined" && module.exports)
    ? require("./db.js")
    : root.TF.db;
  const TFids = (typeof module !== "undefined" && module.exports)
    ? require("./ids.js")
    : root.TF.ids;

  // IndexedDB-backed blob store (PWA / browser fallback path).
  function indexedDBBlobStore() {
    function put(bytes, meta) {
      const id = "blob_" + TFids.newCid();
      const record = { id, mime: (meta && meta.mime) || "application/octet-stream", bytes };
      return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction("blobs", "readwrite");
        tx.objectStore("blobs").put(record);
        tx.oncomplete = () => resolve(id);
        tx.onerror = () => reject(tx.error);
      }));
    }
    function getRecord(ref) {
      return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
        const r = db.transaction("blobs", "readonly").objectStore("blobs").get(ref);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }));
    }
    function getBytes(ref) {
      return getRecord(ref).then((rec) => (rec ? rec.bytes : undefined));
    }
    function getURL(ref) {
      return getRecord(ref).then((rec) => {
        if (!rec) return undefined;
        const blob = new Blob([rec.bytes], { type: rec.mime });
        return URL.createObjectURL(blob); // browser-only
      });
    }
    function del(ref) {
      return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction("blobs", "readwrite");
        tx.objectStore("blobs").delete(ref);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }));
    }
    return { kind: "indexeddb", put, getBytes, getURL, delete: del };
  }

  // env.hasTauri lets callers/tests force the selection. Filesystem impl arrives in sub-project #3.
  function makeBlobStore(env) {
    const hasTauri = env && typeof env.hasTauri === "boolean"
      ? env.hasTauri
      : (typeof root !== "undefined" && !!root.__TAURI__);
    if (hasTauri) {
      // Placeholder: real FS implementation is sub-project #3. Fall back to IndexedDB for now.
      return indexedDBBlobStore();
    }
    return indexedDBBlobStore();
  }

  const exported = { makeBlobStore };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.blobstore = exported; }
  return exported;
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/blobstore.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add static/offline/blobstore.js tests/offline/blobstore.test.js
git commit -m "feat(offline): BlobStore interface + IndexedDB implementation"
```

---

## Task 8: `router.js` — LocalRouter skeleton

**Files:**
- Create: `static/offline/router.js`
- Test: `tests/offline/router.test.js`

The router matches a `METHOD /path` against registered patterns with `:param` segments, extracts params + parsed query, and dispatches to the handler. Handlers are async and return plain data (the shape the server would return).

- [ ] **Step 1: Write the failing test**

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { makeRouter } = require("../../static/offline/router.js");

test("dispatch routes GET with query to handler", async () => {
  const r = makeRouter();
  r.register("GET", "/api/tasks", async (ctx) => ({ ok: true, q: ctx.query.gtd_status }));
  const res = await r.dispatch("GET", "/api/tasks?gtd_status=inbox");
  assert.deepEqual(res, { ok: true, q: "inbox" });
});

test("dispatch extracts path params", async () => {
  const r = makeRouter();
  r.register("PUT", "/api/tasks/:cid", async (ctx) => ({ cid: ctx.params.cid, body: ctx.body }));
  const res = await r.dispatch("PUT", "/api/tasks/abc-123", { title: "x" });
  assert.deepEqual(res, { cid: "abc-123", body: { title: "x" } });
});

test("dispatch distinguishes methods on same path", async () => {
  const r = makeRouter();
  r.register("GET", "/api/tasks", async () => "list");
  r.register("POST", "/api/tasks", async () => "created");
  assert.equal(await r.dispatch("POST", "/api/tasks"), "created");
});

test("hasRoute reports whether a path is handled locally", () => {
  const r = makeRouter();
  r.register("GET", "/api/tasks", async () => null);
  assert.equal(r.hasRoute("GET", "/api/tasks?x=1"), true);
  assert.equal(r.hasRoute("GET", "/api/lists"), false);
});

test("dispatch throws for an unregistered route", async () => {
  const r = makeRouter();
  await assert.rejects(() => r.dispatch("GET", "/api/nope"), /no local route/i);
});

test("more specific static route wins over param route regardless of registration order", async () => {
  const r = makeRouter();
  r.register("GET", "/api/tasks/:cid", async () => "param");
  r.register("GET", "/api/tasks/summary", async () => "static");
  assert.equal(await r.dispatch("GET", "/api/tasks/summary"), "static");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/router.test.js`
Expected: FAIL — cannot find module `router.js`.

- [ ] **Step 3: Write `static/offline/router.js`**

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

  function splitPath(path) {
    const qIdx = path.indexOf("?");
    const pathname = qIdx === -1 ? path : path.slice(0, qIdx);
    const search = qIdx === -1 ? "" : path.slice(qIdx + 1);
    const query = {};
    if (search) {
      for (const pair of search.split("&")) {
        if (!pair) continue;
        const eq = pair.indexOf("=");
        const k = decodeURIComponent(eq === -1 ? pair : pair.slice(0, eq));
        const v = eq === -1 ? "" : decodeURIComponent(pair.slice(eq + 1));
        query[k] = v;
      }
    }
    return { pathname: pathname.replace(/\/+$/, "") || "/", query };
  }

  function compile(pattern) {
    const segs = pattern.replace(/\/+$/, "").split("/");
    const params = [];
    let specificity = 0; // count of static segments — higher wins
    const matchers = segs.map((seg) => {
      if (seg.startsWith(":")) { params.push(seg.slice(1)); return null; }
      specificity++;
      return seg;
    });
    return { matchers, params, specificity, segLen: segs.length };
  }

  function makeRouter() {
    const routes = []; // { method, compiled, handler }

    function register(method, pattern, handler) {
      routes.push({ method: method.toUpperCase(), compiled: compile(pattern), handler });
    }

    function find(method, path) {
      const { pathname, query } = splitPath(path);
      const segs = pathname.split("/");
      const candidates = [];
      for (const route of routes) {
        if (route.method !== method.toUpperCase()) continue;
        const { matchers, params, specificity, segLen } = route.compiled;
        if (segLen !== segs.length) continue;
        let ok = true;
        for (let i = 0; i < matchers.length; i++) {
          if (matchers[i] === null) continue; // param segment matches anything
          if (matchers[i] !== segs[i]) { ok = false; break; }
        }
        if (!ok) continue;
        // Extract param values by index.
        const paramValues = {};
        let p = 0;
        for (let i = 0; i < matchers.length; i++) {
          if (matchers[i] === null) paramValues[params[p++]] = decodeURIComponent(segs[i]);
        }
        candidates.push({ route, params: paramValues, specificity, query });
      }
      if (!candidates.length) return null;
      candidates.sort((a, b) => b.specificity - a.specificity);
      return candidates[0];
    }

    function hasRoute(method, path) {
      return find(method, path) !== null;
    }

    function dispatch(method, path, body) {
      const m = find(method, path);
      if (!m) return Promise.reject(new Error(`no local route for ${method} ${path}`));
      return Promise.resolve(m.route.handler({ params: m.params, query: m.query, body, method, path }));
    }

    return { register, dispatch, hasRoute };
  }

  const exported = { makeRouter };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.router = exported; }
  return exported;
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/router.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — all offline tests green (smoke, ids, db, meta, idmap, outbox, blobstore, router).

- [ ] **Step 6: Commit**

```bash
git add static/offline/router.js tests/offline/router.test.js
git commit -m "feat(offline): LocalRouter skeleton with param matching + specificity"
```

---

## Done criteria

- `npm test` passes with the full `tests/offline/` suite green.
- `static/offline/` contains seven dependency-light modules, each loadable in Node and (via `window.TF.<name>`) in the browser.
- No change to `static/index.html`, the FastAPI backend, or the Service Worker — those land in the tasks-pilot plan.

## Next plan (not in scope here)

`docs/superpowers/plans/2026-06-XX-offline-tasks-pilot.md` — wire `static/offline/*` into `index.html` (script tags + load order), retire in-page `OfflineDB`, implement `taskRepo` over these primitives, port the tasks business logic (recurring expansion, quadrant, summary/projects/contexts parity), intercept the `api` object so Kelompok-1 task routes resolve locally, hydrate the tasks domain, and adjust the Service Worker (+ cache bump). That plan ends with the **tasks domain fully usable offline** in the browser/PWA.
```
