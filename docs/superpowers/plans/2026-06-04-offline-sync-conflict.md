# Offline Sync — Conflict Resolution Implementation Plan (#2c)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve sync conflicts: edit-vs-edit by last-write-wins (`updated_at`), edit-vs-delete by a user prompt (discard / save-as-new), with the sync order reordered to pull→push so conflicts are detected before push overwrites the server.

**Architecture:** Conflict detection lives in `syncpull.js` (during reconcile); a `conflict` flag on the task record holds edit-vs-delete cases. `syncpush.js` skips flagged records (and flags update-404s). A new `syncconflict.js` lists/resolves them. `idmap.js` gains `mapDelete`. `index.html` reorders `sync()` and renders a minimal plain-DOM conflict banner. Client-only, no backend.

**Tech Stack:** Vanilla ES2017 JS, IndexedDB, `node:test`, `fake-indexeddb`. No backend changes, no new deps.

**Spec:** `docs/superpowers/specs/2026-06-04-offline-sync-conflict-design.md`

---

## Key facts (verified)

- `syncpull.pullTasks(serverList)` currently returns `{created, updated, deleted, skipped}` and **skips dirty records**. `hydrate.taskFromServer(dict, getCid)` maps server→local (`dirty=0`, `base_rev=updated_at`).
- `syncpush.js` `opCreate` reads the record (`getTaskRaw`) and drops the op if `server_id != null`; `opUpdate` drops on non-2xx; `send()` tags network rejections with `__network`.
- `outbox.{outboxAll, outboxRemove, outboxAdd, outboxByEntity}`; `idmap.{mapPut, cidOf, serverIdOf}` (no delete yet, keyed `\`${type}:${serverId}\``); records have `updated_at` (local, ISO-Z), server `updated_at` is naive VPS local time.
- `static/index.html`: offline `<script>`s end at `syncpull.js` (:1335); `sync()` at :1503 (currently push→pull); the mount effect `useEffect(() => { fetchAll(); }, [fetchAll]);` at :20690.
- `static/sw.js`: `CACHE = "taskflow-v121-sync-pull"`; STATIC ends with `syncpull.js`.

## File structure

```
static/offline/idmap.js          # MODIFY — add mapDelete
static/offline/syncpull.js       # MODIFY — conflict detection (LWW + flag)
static/offline/syncpush.js       # MODIFY — skip flagged records; update-404 → flag
static/offline/syncconflict.js   # NEW — listConflicts, resolveConflict
tests/offline/{idmap,syncpull,syncpush}.test.js  # MODIFY (append)
tests/offline/syncconflict.test.js               # NEW
static/index.html                # MODIFY — reorder sync(), conflict banner, refresh hook
static/sw.js                     # MODIFY — precache syncconflict.js + bump
```

---

## Task 1: `idmap.mapDelete`

**Files:** Modify `static/offline/idmap.js`, `tests/offline/idmap.test.js`

- [ ] **Step 1: Append a failing test to `tests/offline/idmap.test.js`**

```js
const { mapDelete } = require("../../static/offline/idmap.js");

test("mapDelete removes a mapping (cidOf and serverIdOf become undefined)", async () => {
  await mapPut("task", 42, "cid-42");
  assert.equal(await cidOf("task", 42), "cid-42");
  await mapDelete("task", 42);
  assert.equal(await cidOf("task", 42), undefined);
  assert.equal(await serverIdOf("cid-42"), undefined);
});
```

> If `idmap.test.js` doesn't already import `mapPut`/`cidOf`/`serverIdOf`, check its existing requires and reuse them; only add the `mapDelete` import if missing.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/idmap.test.js`
Expected: FAIL — `mapDelete` is not a function.

- [ ] **Step 3: Edit `static/offline/idmap.js`**

Add this function after `serverIdOf` (before the `const exported = ...` line):

```js
  function mapDelete(type, serverId) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("_idmap", "readwrite");
      tx.objectStore("_idmap").delete(keyFor(type, serverId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
```

Update the export line:

```js
  const exported = { mapPut, cidOf, serverIdOf, mapDelete };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/idmap.test.js`
Expected: PASS (prior tests + 1 new).

- [ ] **Step 5: Commit**

```bash
git add static/offline/idmap.js tests/offline/idmap.test.js
git commit -m "feat(offline): idmap.mapDelete"
```

---

## Task 2: `syncpull` conflict detection (LWW + flag)

**Files:** Modify `static/offline/syncpull.js`, `tests/offline/syncpull.test.js`

- [ ] **Step 1: Append failing tests to `tests/offline/syncpull.test.js`**

(The helpers `putTasks`, `allTasks`, `getTask`, `local`, `srv`, `mapPut` are already defined at the top. Add the outbox import and tests.)

```js
const { outboxAll, outboxAdd } = require("../../static/offline/outbox.js");

test("pullTasks edit-vs-edit: server newer wins, overwrites local and drops outbox op", async () => {
  await putTasks([local({ cid: "a", server_id: 10, title: "Local", base_rev: "2026-06-01T00:00:00", updated_at: "2026-06-04T01:00:00.000Z", dirty: 1 })]);
  await mapPut("task", 10, "a");
  await outboxAdd({ op: "update", entity_type: "task", cid: "a", payload: {} });
  const r = await pullTasks([srv({ id: 10, title: "Server", updated_at: "2026-06-04T05:00:00" })]); // naive → 05:00 UTC > local 01:00Z
  assert.equal(r.lwwResolved, 1);
  assert.equal((await getTask("a")).title, "Server");
  assert.equal((await getTask("a")).dirty, 0);
  assert.equal((await outboxAll()).length, 0); // op dropped
});

test("pullTasks edit-vs-edit: local newer wins, keeps local and outbox op", async () => {
  await putTasks([local({ cid: "a", server_id: 10, title: "Local", base_rev: "2026-06-01T00:00:00", updated_at: "2026-06-04T09:00:00.000Z", dirty: 1 })]);
  await mapPut("task", 10, "a");
  await outboxAdd({ op: "update", entity_type: "task", cid: "a", payload: {} });
  const r = await pullTasks([srv({ id: 10, title: "Server", updated_at: "2026-06-04T02:00:00" })]); // 02:00 UTC < local 09:00Z
  assert.equal(r.lwwResolved, 1);
  assert.equal((await getTask("a")).title, "Local"); // kept
  assert.equal((await getTask("a")).dirty, 1);
  assert.equal((await outboxAll()).length, 1); // op kept
});

test("pullTasks edit-vs-delete: dirty local missing from server is flagged, not deleted", async () => {
  await putTasks([local({ cid: "a", server_id: 10, title: "Local edit", dirty: 1 })]);
  await mapPut("task", 10, "a");
  const r = await pullTasks([]); // server no longer has 10
  assert.equal(r.conflicts, 1);
  assert.equal(r.deleted, 0);
  assert.equal((await getTask("a")).conflict, "remote_deleted");
});

test("pullTasks skips an already-flagged conflict record", async () => {
  await putTasks([local({ cid: "a", server_id: 10, title: "Local", dirty: 1, conflict: "remote_deleted" })]);
  await mapPut("task", 10, "a");
  const r = await pullTasks([srv({ id: 10, title: "Server", updated_at: "2026-06-09T00:00:00" })]);
  assert.equal((await getTask("a")).title, "Local"); // untouched
  assert.equal(r.skipped, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/syncpull.test.js`
Expected: FAIL — `lwwResolved`/`conflicts` undefined, conflict not flagged.

- [ ] **Step 3: Edit `static/offline/syncpull.js`**

Add the outbox dependency near the other requires (after `TFhydrate`):

```js
  const TFoutbox = req("./outbox.js", root.TF && root.TF.outbox);
```

Add these two helpers right before `function pullTasks(` :

```js
  // Normalize a timestamp to epoch ms; treat a tz-less string (server naive) as UTC.
  function tsEpoch(ts) {
    if (ts == null) return 0;
    const s = String(ts);
    const hasTz = /[zZ]|[+-]\d\d:?\d\d$/.test(s);
    const v = Date.parse(hasTz ? s : s + "Z");
    return isNaN(v) ? 0 : v;
  }
  function dropOutbox(cid) {
    return TFoutbox.outboxByEntity("task", cid).then((ops) =>
      ops.reduce((p, o) => p.then(() => TFoutbox.outboxRemove(o.qid)), Promise.resolve()));
  }
```

Replace the entire body of `pullTasks` (from `const list = serverList || [];` through its final `});`) with:

```js
    const list = serverList || [];
    const cache = {}; // serverId -> cid
    return list.reduce((p, s) => p.then(() => ensureCid(s.id, cache)), Promise.resolve())
      .then(() => getAllTasks())
      .then((localAll) => {
        const localByCid = {};
        for (const r of localAll) localByCid[r.cid] = r;
        const getCid = (sid) => cache[sid] || null;
        const result = { created: 0, updated: 0, deleted: 0, skipped: 0, lwwResolved: 0, conflicts: 0 };
        let chain = Promise.resolve();
        for (const s of list) {
          const cid = cache[s.id];
          const localRec = localByCid[cid];
          chain = chain.then(() => {
            if (!localRec) { result.created++; return putTask(TFhydrate.taskFromServer(s, getCid)); }
            if (localRec.conflict) { result.skipped++; return; }
            if (localRec.dirty) {
              if (s.updated_at !== localRec.base_rev) {
                // edit-vs-edit conflict → last-write-wins
                result.lwwResolved++;
                if (tsEpoch(s.updated_at) > tsEpoch(localRec.updated_at)) {
                  return dropOutbox(cid).then(() => putTask(TFhydrate.taskFromServer(s, getCid))); // server wins
                }
                return; // local wins — keep dirty, push will send
              }
              result.skipped++; return; // local pending, server unchanged
            }
            if (s.updated_at !== localRec.base_rev) { result.updated++; return putTask(TFhydrate.taskFromServer(s, getCid)); }
            return; // unchanged
          });
        }
        const serverIds = new Set(list.map((s) => String(s.id)));
        for (const r of localAll) {
          if (r.server_id == null) continue;
          if (serverIds.has(String(r.server_id))) continue;
          chain = chain.then(() => {
            if (r.conflict) { result.skipped++; return; }
            if (r.dirty) { result.conflicts++; return putTask(Object.assign({}, r, { conflict: "remote_deleted" })); }
            result.deleted++;
            return deleteTask(r.cid);
          });
        }
        return chain.then(() => result);
      });
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/syncpull.test.js`
Expected: PASS, 12 tests (8 prior + 4 new).

- [ ] **Step 5: Commit**

```bash
git add static/offline/syncpull.js tests/offline/syncpull.test.js
git commit -m "feat(offline): syncpull conflict detection (LWW + edit-vs-delete flag)"
```

---

## Task 3: `syncpush` holds flagged records + flags update-404

**Files:** Modify `static/offline/syncpush.js`, `tests/offline/syncpush.test.js`

- [ ] **Step 1: Append failing tests to `tests/offline/syncpush.test.js`**

```js
const { mapPut: _mapPutP } = require("../../static/offline/idmap.js");

test("pushOutbox skips an op whose record is flagged conflict (op kept, not pushed)", async () => {
  await put("tasks", [task({ cid: "a", server_id: 10, title: "A", conflict: "remote_deleted" })]);
  await _mapPutP("task", 10, "a");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "task", cid: "a", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 200, data: { id: 10 } }));
  const r = await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);     // not pushed
  assert.equal(r.pushed, 0);
  assert.equal(r.remaining, 1);         // op held
});

test("pushOutbox update 404 flags the record conflict and keeps the op", async () => {
  await put("tasks", [task({ cid: "a", server_id: 10, title: "A" })]);
  await _mapPutP("task", 10, "a");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "task", cid: "a", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 404, data: { detail: "gone" } }));
  const r = await pushOutbox(tr);
  const db = await openDB();
  const rec = await new Promise((res) => { const q = db.transaction("tasks").objectStore("tasks").get("a"); q.onsuccess = () => res(q.result); });
  assert.equal(rec.conflict, "remote_deleted");
  assert.equal(r.remaining, 1);         // op kept for user resolution
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/syncpush.test.js`
Expected: FAIL — conflicted op is pushed / 404 drops the op.

- [ ] **Step 3: Edit `static/offline/syncpush.js`**

In `opCreate`, change the opening of the `.then((rec) => {` body from:

```js
      if (!rec) return TFoutbox.outboxRemove(op.qid);
      if (rec.server_id != null) return TFoutbox.outboxRemove(op.qid); // already created (idempotent)
```

to (add the conflict guard first):

```js
      if (!rec) return TFoutbox.outboxRemove(op.qid);
      if (rec.conflict) return; // held until user resolves the conflict
      if (rec.server_id != null) return TFoutbox.outboxRemove(op.qid); // already created (idempotent)
```

In `opUpdate`, change:

```js
    return Promise.all([getTaskRaw(op.cid), TFidmap.serverIdOf(op.cid)]).then(([rec, sid]) => {
      if (!rec || sid == null) return TFoutbox.outboxRemove(op.qid);
      return tagsOf(op.cid, tagsFor).then((tags) =>
        send(transport, "PUT", "/api/tasks/" + sid, taskToUpdatePayload(rec, tags)).then((res) => {
          if (ok(res)) { return putTaskRaw(Object.assign({}, rec, { dirty: 0, base_rev: res.data && res.data.updated_at != null ? res.data.updated_at : rec.base_rev })).then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; }); }
          result.failed++;
          return TFoutbox.outboxRemove(op.qid);
        })
      );
    });
```

to:

```js
    return Promise.all([getTaskRaw(op.cid), TFidmap.serverIdOf(op.cid)]).then(([rec, sid]) => {
      if (!rec || sid == null) return TFoutbox.outboxRemove(op.qid);
      if (rec.conflict) return; // held until user resolves the conflict
      return tagsOf(op.cid, tagsFor).then((tags) =>
        send(transport, "PUT", "/api/tasks/" + sid, taskToUpdatePayload(rec, tags)).then((res) => {
          if (ok(res)) { return putTaskRaw(Object.assign({}, rec, { dirty: 0, base_rev: res.data && res.data.updated_at != null ? res.data.updated_at : rec.base_rev })).then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; }); }
          if (res.status === 404) { return putTaskRaw(Object.assign({}, rec, { conflict: "remote_deleted" })); } // safety net: flag, keep op
          result.failed++;
          return TFoutbox.outboxRemove(op.qid);
        })
      );
    });
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/syncpush.test.js`
Expected: PASS, 15 tests (13 prior + 2 new).

- [ ] **Step 5: Commit**

```bash
git add static/offline/syncpush.js tests/offline/syncpush.test.js
git commit -m "feat(offline): syncpush holds conflicted records + flags update-404"
```

---

## Task 4: `syncconflict.js`

**Files:** Create `static/offline/syncconflict.js`, `tests/offline/syncconflict.test.js`

- [ ] **Step 1: Write the failing test `tests/offline/syncconflict.test.js`**

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut, cidOf, serverIdOf } = require("../../static/offline/idmap.js");
const { outboxAll, outboxAdd } = require("../../static/offline/outbox.js");
const { listConflicts, resolveConflict } = require("../../static/offline/syncconflict.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function putTasks(recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("tasks", "readwrite");
    for (const r of recs) tx.objectStore("tasks").put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function getTask(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("tasks").objectStore("tasks").get(cid); q.onsuccess = () => res(q.result); });
}

test("listConflicts returns only flagged records", async () => {
  await putTasks([
    { cid: "a", title: "A", conflict: "remote_deleted", dirty: 1 },
    { cid: "b", title: "B", dirty: 1 },
  ]);
  const list = await listConflicts();
  assert.deepEqual(list.map((c) => c.cid), ["a"]);
  assert.equal(list[0].title, "A");
});

test("resolveConflict discard removes the record, its outbox ops, and idmap entry", async () => {
  await putTasks([{ cid: "a", server_id: 10, title: "A", conflict: "remote_deleted", dirty: 1 }]);
  await mapPut("task", 10, "a");
  await outboxAdd({ op: "update", entity_type: "task", cid: "a", payload: {} });
  await resolveConflict("a", "discard");
  assert.equal(await getTask("a"), undefined);
  assert.equal((await outboxAll()).length, 0);
  assert.equal(await cidOf("task", 10), undefined);
});

test("resolveConflict keep_as_new clears server_id, drops idmap, and queues a create", async () => {
  await putTasks([{ cid: "a", server_id: 10, title: "A", conflict: "remote_deleted", dirty: 1 }]);
  await mapPut("task", 10, "a");
  await outboxAdd({ op: "update", entity_type: "task", cid: "a", payload: {} });
  await resolveConflict("a", "keep_as_new");
  const rec = await getTask("a");
  assert.equal(rec.server_id, null);
  assert.equal(rec.conflict, undefined);
  assert.equal(rec.dirty, 1);
  assert.equal(await cidOf("task", 10), undefined);       // old mapping gone
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "create");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/syncconflict.test.js`
Expected: FAIL — cannot find module `syncconflict.js`.

- [ ] **Step 3: Write `static/offline/syncconflict.js`**

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
  const TFoutbox = req("./outbox.js", root.TF && root.TF.outbox);
  const TFidmap = req("./idmap.js", root.TF && root.TF.idmap);

  function getAllTasks() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("tasks", "readonly").objectStore("tasks").getAll();
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
  function putTask(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      tx.objectStore("tasks").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function deleteTask(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      tx.objectStore("tasks").delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function dropOutbox(cid) {
    return TFoutbox.outboxByEntity("task", cid).then((ops) =>
      ops.reduce((p, o) => p.then(() => TFoutbox.outboxRemove(o.qid)), Promise.resolve()));
  }

  function listConflicts() {
    return getAllTasks().then((all) =>
      all.filter((r) => r.conflict).map((r) => ({ cid: r.cid, title: r.title, conflict: r.conflict })));
  }

  function resolveConflict(cid, choice) {
    return getTaskRaw(cid).then((rec) => {
      if (!rec) return { ok: false };
      const cleanup = dropOutbox(cid)
        .then(() => (rec.server_id != null ? TFidmap.mapDelete("task", rec.server_id) : null));
      if (choice === "discard") {
        return cleanup.then(() => deleteTask(cid)).then(() => ({ ok: true }));
      }
      if (choice === "keep_as_new") {
        const next = Object.assign({}, rec, { server_id: null, dirty: 1 });
        delete next.conflict;
        return cleanup
          .then(() => putTask(next))
          .then(() => TFoutbox.outboxAdd({ op: "create", entity_type: "task", cid: cid, payload: {} }))
          .then(() => ({ ok: true }));
      }
      return Promise.reject(new Error("unknown choice: " + choice));
    });
  }

  const exported = { listConflicts, resolveConflict };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.syncconflict = exported; }
  return exported;
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/syncconflict.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add static/offline/syncconflict.js tests/offline/syncconflict.test.js
git commit -m "feat(offline): syncconflict list + resolve (discard / keep_as_new)"
```

---

## Task 5: Full Node-suite regression

- [ ] **Step 1: Run the whole offline suite (18 files)**

Run:
```bash
node --test tests/offline/*.test.js
```
Expected: `ℹ tests 156 / ℹ pass 156 / ℹ fail 0`, terminating promptly.

> Count: prior 146 + Task 1 (1) + Task 2 (4) + Task 3 (2) + Task 4 (3) = **156**.

- [ ] **Step 2: No commit** (regression run only). Fix any failure before continuing.

---

## Task 6: Wire `static/index.html` (browser-verified)

**Files:** Modify `static/index.html` (script tag :1335; `sync()` :1503; conflict banner; refresh hook :20690)

> No Node test — browser-verified in Task 8.

- [ ] **Step 1: Add the `syncconflict.js` script tag**

Find `  <script src="/static/offline/syncpull.js"></script>` and insert immediately AFTER it:

```html
  <script src="/static/offline/syncconflict.js"></script>
```

- [ ] **Step 2: Reorder `sync()` to pull→push and render conflicts**

Replace this exact existing block (the current push→pull `sync`):

```js
function sync() {
  if (!(window.TF && window.TF.syncpush && window.TF.syncpull)) return Promise.resolve(null);
  return window.TF.syncpush.pushOutbox(__syncTransport)
    .then(() => window.TF.syncpull.pullAndReconcile(__syncRawFetch))
    .catch(() => null);
}
```

with (pull→push, plus the `renderConflicts` banner renderer):

```js
function sync() {
  if (!(window.TF && window.TF.syncpull && window.TF.syncpush)) { renderConflicts(); return Promise.resolve(null); }
  return window.TF.syncpull.pullAndReconcile(__syncRawFetch)
    .then(() => window.TF.syncpush.pushOutbox(__syncTransport))
    .then((r) => { renderConflicts(); return r; })
    .catch(() => { renderConflicts(); return null; });
}
function renderConflicts() {
  if (!(window.TF && window.TF.syncconflict)) return;
  window.TF.syncconflict.listConflicts().then(list => {
    let bar = document.getElementById("tf-conflict-bar");
    if (!list.length) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "tf-conflict-bar";
      bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#fef3c7;border-top:2px solid #f59e0b;padding:10px 14px;font:14px sans-serif;color:#92400e;max-height:40vh;overflow:auto;";
      document.body.appendChild(bar);
    }
    bar.innerHTML = "";
    list.forEach(c => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:8px;margin:4px 0;flex-wrap:wrap;";
      const label = document.createElement("span");
      label.textContent = "🔔 '" + (c.title || "(tanpa judul)") + "' dihapus di perangkat lain, tapi ada perubahan lokal.";
      row.appendChild(label);
      [["Buang perubahan", "discard"], ["Simpan sebagai task baru", "keep_as_new"]].forEach(([text, choice]) => {
        const b = document.createElement("button");
        b.textContent = text;
        b.style.cssText = "padding:4px 10px;border:1px solid #92400e;border-radius:6px;background:#fff;cursor:pointer;";
        b.onclick = () => {
          b.disabled = true;
          window.TF.syncconflict.resolveConflict(c.cid, choice)
            .then(() => sync())
            .then(() => { if (window.__refreshTasks) window.__refreshTasks(); })
            .catch(() => {});
        };
        row.appendChild(b);
      });
      bar.appendChild(row);
    });
  }).catch(() => {});
}
```

- [ ] **Step 3: Expose a task-refresh hook so the banner can refresh the list**

Find the mount effect (at :20690):

```js
  useEffect(() => {
    fetchAll();
  }, [fetchAll]);
```

Replace it with:

```js
  useEffect(() => {
    window.__refreshTasks = fetchAll;
    fetchAll();
  }, [fetchAll]);
```

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "feat(offline): reorder sync pull->push + conflict banner UI"
```

---

## Task 7: Service Worker — precache + cache bump

**Files:** Modify `static/sw.js:1` (CACHE), STATIC array

- [ ] **Step 1: Bump the cache version**

At `static/sw.js:1`, change `const CACHE = "taskflow-v121-sync-pull";` to:

```js
const CACHE = "taskflow-v122-sync-conflict";
```

- [ ] **Step 2: Precache `syncconflict.js`**

In `STATIC`, find `"/static/offline/syncpull.js",` and add immediately after it:

```js
  "/static/offline/syncconflict.js",
```

- [ ] **Step 3: Verify syntax + commit**

Run: `node --check static/sw.js`
Expected: no output (valid).

```bash
git add static/sw.js
git commit -m "chore(sw): bump cache v122 + precache syncconflict.js"
```

---

## Task 8: Browser verification (manual — record results)

This deploy also carries the earlier dead-code cleanup (computeOfflineQuadrant etc.), so verify the app still loads and habits/notes work.

Deploy (merge → push → confirm `curl https://todo.yatno.web.id/sw.js | grep CACHE` shows v122). Reset the SW in the logged-in tab:

```js
(async()=>{for(const r of await navigator.serviceWorker.getRegistrations())await r.unregister();for(const k of await caches.keys())await caches.delete(k);location.reload();})()
```

After reload, run the verification (paste in console, share output):

```js
(async()=>{
  const R=[]; const ok=(n,c)=>R.push((c?'✅':'❌')+' '+n);
  try{
    ok('app loaded (no blank) + syncconflict', !!(window.TF && TF.syncconflict) && document.querySelectorAll('button,a').length>0);
    const h={Authorization:'Bearer '+localStorage.getItem('tf_token'),'Content-Type':'application/json'};
    // --- edit-vs-edit (LWW) ---
    const t1 = await api.post('/api/tasks',{title:'__conf A', gtd_status:'inbox'}); // local-first
    await window.__pushNow(); const rec1 = await TF.taskrepo.getTask(t1.cid);
    // change it on the server (newer) then edit locally (older base) — then sync
    await new Promise(r=>setTimeout(r,1100));
    await window.fetch('/api/tasks/'+rec1.server_id,{method:'PUT',headers:h,body:JSON.stringify({title:'__conf A SERVER'})});
    await api.put('/api/tasks/'+rec1.server_id,{title:'__conf A LOCAL'}); // makes it dirty
    await window.__syncNow();
    const a = await TF.taskrepo.getTask(t1.cid);
    ok('edit-vs-edit resolved by LWW (a side won, no crash): '+a.title, a.title.includes('__conf A'));
    await window.fetch('/api/tasks/'+rec1.server_id,{method:'DELETE',headers:h}).catch(()=>{}); await window.__syncNow();
    // --- edit-vs-delete (prompt) ---
    const t2 = await api.post('/api/tasks',{title:'__conf B', gtd_status:'inbox'});
    await window.__pushNow(); const rec2 = await TF.taskrepo.getTask(t2.cid);
    await window.fetch('/api/tasks/'+rec2.server_id,{method:'DELETE',headers:h}); // deleted on server
    await api.put('/api/tasks/'+rec2.server_id,{title:'__conf B EDITED'});        // edited locally → dirty
    await window.__syncNow();
    const flagged = await TF.syncconflict.listConflicts();
    ok('edit-vs-delete flagged + banner shown', flagged.some(c=>c.cid===t2.cid) && !!document.getElementById('tf-conflict-bar'));
    // resolve discard
    await TF.syncconflict.resolveConflict(t2.cid,'discard'); await window.__syncNow();
    ok('discard removed it locally', (await TF.taskrepo.getTask(t2.cid))===undefined);
  }catch(e){ R.push('❌ EXCEPTION: '+(e&&e.message)); }
  const out='=== CONFLICT VERIFICATION ===\n'+R.join('\n'); console.log(out); return out;
})()
```

Also manually: confirm the yellow conflict banner appeared with both buttons during the test, that **"Simpan sebagai task baru"** (try it on a fresh edit-vs-delete) re-creates the task on the server, and that **habits/notes still work** (open those pages, no console errors). Report pass/fail + which side won the LWW case (tells us the VPS-clock assumption).

---

## Done criteria

- `idmap.mapDelete`, `syncpull` conflict detection (LWW + flag), `syncpush` holds flagged + 404-flag, `syncconflict` list/resolve — Node suite green (156).
- `sync()` is pull→push; conflict banner shows edit-vs-delete with Buang / Simpan-sebagai-baru, wired to `resolveConflict` + refresh.
- Browser-verified: edit-vs-edit LWW, edit-vs-delete prompt (discard + keep-as-new), app loads, habits/notes intact.

## Next (out of scope)

- **#2d collaborative** (shared lists/chat offline); pull `recurring_exceptions`; realtime/periodic.
- If LWW picks the wrong side (VPS not UTC), follow-up: backend returns UTC `updated_at`.
- Sub-project #3 (Tauri → .exe/AppImage), #4 (Android).
```
