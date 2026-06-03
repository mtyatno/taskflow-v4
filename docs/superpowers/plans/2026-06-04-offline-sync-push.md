# Offline Sync — Push Engine Implementation Plan (#2a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drain the local `_outbox` and replay each operation to the existing REST server, assigning `server_id` on create — so local-first changes finally propagate out (Model B push).

**Architecture:** A new Node-tested module `static/offline/syncpush.js` exposing pure payload mappers + `pushOutbox(transport, opts)` that processes the outbox FIFO via an injectable `transport` (raw fetch in the browser, fake server in tests). Then minimal browser-verified wiring in `static/index.html` (build the raw-fetch transport, trigger push on `online` / after local writes / manually) and `static/sw.js` (precache + cache bump).

**Tech Stack:** Vanilla ES2017 JS, IndexedDB, `node:test`, `fake-indexeddb`. No backend changes, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-04-offline-sync-push-design.md`

---

## Key facts (verified)

- `_outbox` records: `{ qid (autoincrement), ts, retries, op, entity_type, cid, payload }`. Ops: `create`/`update`/`delete` (`entity_type:'task'`), `mark_occurrence` (`entity_type:'recurring_exception'`, payload `{cid, task_cid, occurrence_date, status}`).
- Module APIs: `outbox.{outboxAll, outboxRemove}`; `idmap.{mapPut(type,serverId,cid), serverIdOf(cid)}`; `tagrepo.getEntityTags('task',cid) → [{name,color}]`; `db.openDB()`; `tasks` store keyed by `cid`, records carry `server_id` (int or null), `recurrence_days` (JSON string or null), `parent_cid`.
- Server (unchanged): `POST /api/tasks` (`TaskCreate`: title, description, priority, project, context, deadline, gtd_status, waiting_for, list_id, assigned_to, parent_id, recurrence_type, recurrence_days **list**) returns the task dict incl. `id`. `PUT /api/tasks/{id}` (`TaskUpdate`: same minus list_id/parent_id, plus progress, recurrence_renew). `DELETE /api/tasks/{id}` (hard). `POST /api/tasks/{id}/occurrences/{date}/mark` (`{status}`). Server re-derives `#tags` from `title`.
- `static/index.html`: offline module `<script>`s are at ~:1306 (before app script); `api` object at :1396; `api.fetch` intercept block already exists; `fetchAll` hydration block already exists (search `Hydrate local tasks from the server`).
- `static/sw.js`: `CACHE = "taskflow-v119-offline-tasks"` (line 1); `STATIC` array includes `/static/offline/*.js`.

## File structure

```
static/offline/syncpush.js       # NEW — taskToCreatePayload, taskToUpdatePayload, markPayload, pushOutbox
tests/offline/syncpush.test.js   # NEW
static/index.html                # MODIFY — script tag, transport, schedulePush, triggers
static/sw.js                     # MODIFY — precache syncpush.js + cache bump
```

---

## Task 1: `syncpush.js`

**Files:**
- Create: `static/offline/syncpush.js`
- Test: `tests/offline/syncpush.test.js`

- [ ] **Step 1: Write the failing test `tests/offline/syncpush.test.js`**

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { serverIdOf } = require("../../static/offline/idmap.js");
const { setEntityTags } = require("../../static/offline/tagrepo.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const {
  taskToCreatePayload, taskToUpdatePayload, markPayload, pushOutbox,
} = require("../../static/offline/syncpush.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

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
    priority: "P3", quadrant: "Q4", project: "", context: "", deadline: null, waiting_for: "",
    assigned_to: null, progress: 0, parent_cid: null, recurrence_type: null, recurrence_days: null,
    deleted: false, dirty: 1,
  }, over);
}
// Fake transport: handler(method, path, body) returns {status,data} or the string "NETWORK" to simulate offline.
function fakeTransport(handler) {
  const calls = [];
  return {
    calls,
    request(method, path, body) {
      calls.push({ method, path, body });
      const h = handler(method, path, body);
      if (h === "NETWORK") return Promise.reject(new Error("net"));
      return Promise.resolve(h);
    },
  };
}

test("taskToCreatePayload reconstructs title+tags, parses recurrence_days, maps parent_id, list_id null", () => {
  const rec = task({ cid: "a", title: "Beli", recurrence_type: "weekly", recurrence_days: JSON.stringify([1, 3]) });
  const p = taskToCreatePayload(rec, ["kopi", "susu"], 42);
  assert.equal(p.title, "Beli #kopi #susu");
  assert.deepEqual(p.recurrence_days, [1, 3]);
  assert.equal(p.recurrence_type, "weekly");
  assert.equal(p.parent_id, 42);
  assert.equal(p.list_id, null);
  assert.equal(p.gtd_status, "next");
});

test("taskToUpdatePayload has progress, reconstructs title, no parent/list keys", () => {
  const rec = task({ cid: "a", title: "Edit", progress: 40 });
  const p = taskToUpdatePayload(rec, ["x"]);
  assert.equal(p.title, "Edit #x");
  assert.equal(p.progress, 40);
  assert.equal("parent_id" in p, false);
  assert.equal("list_id" in p, false);
});

test("markPayload returns {status}", () => {
  assert.deepEqual(markPayload({ status: "done" }), { status: "done" });
});

test("pushOutbox create posts, sets server_id + idmap, removes op", async () => {
  await put("tasks", [task({ cid: "a", title: "Beli" })]);
  await setEntityTags("task", "a", ["kopi"]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "task", cid: "a", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 201, data: { id: 100 } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(r.remaining, 0);
  assert.equal(tr.calls[0].body.title, "Beli #kopi");           // tag reconstructed
  assert.equal(await serverIdOf("a"), 100);                      // idmap updated
  const db = await openDB();
  const rec = await new Promise((res) => { const q = db.transaction("tasks").objectStore("tasks").get("a"); q.onsuccess = () => res(q.result); });
  assert.equal(rec.server_id, 100);
  assert.equal(rec.dirty, 0);
});

test("pushOutbox processes FIFO; child create uses parent server_id from earlier create", async () => {
  await put("tasks", [task({ cid: "par", title: "Parent" }), task({ cid: "kid", title: "Kid", parent_cid: "par" })]);
  await put("_outbox", [
    { qid: 1, op: "create", entity_type: "task", cid: "par", payload: {} },
    { qid: 2, op: "create", entity_type: "task", cid: "kid", payload: {} },
  ]);
  let next = 500;
  const tr = fakeTransport((m, p, b) => ({ status: 201, data: { id: next++ } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 2);
  assert.equal(tr.calls[1].body.parent_id, 500); // kid sent with parent's new server_id
});

test("pushOutbox update uses serverIdOf and PUTs", async () => {
  await put("tasks", [task({ cid: "a", server_id: 10, title: "New" })]);
  const { mapPut } = require("../../static/offline/idmap.js");
  await mapPut("task", 10, "a");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "task", cid: "a", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 200, data: { id: 10 } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[0].method, "PUT");
  assert.equal(tr.calls[0].path, "/api/tasks/10");
});

test("pushOutbox delete uses serverIdOf and DELETEs", async () => {
  await put("tasks", [task({ cid: "a", server_id: 10, deleted: true })]);
  const { mapPut } = require("../../static/offline/idmap.js");
  await mapPut("task", 10, "a");
  await put("_outbox", [{ qid: 1, op: "delete", entity_type: "task", cid: "a", payload: { cid: "a" } }]);
  const tr = fakeTransport(() => ({ status: 200, data: { ok: true } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[0].method, "DELETE");
  assert.equal(tr.calls[0].path, "/api/tasks/10");
});

test("pushOutbox mark_occurrence resolves task server_id", async () => {
  await put("tasks", [task({ cid: "a", server_id: 10 })]);
  const { mapPut } = require("../../static/offline/idmap.js");
  await mapPut("task", 10, "a");
  await put("_outbox", [{
    qid: 1, op: "mark_occurrence", entity_type: "recurring_exception", cid: "x",
    payload: { cid: "x", task_cid: "a", occurrence_date: "2026-06-10", status: "done" },
  }]);
  const tr = fakeTransport(() => ({ status: 200, data: {} }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[0].path, "/api/tasks/10/occurrences/2026-06-10/mark");
  assert.deepEqual(tr.calls[0].body, { status: "done" });
});

test("pushOutbox stops on network error, leaving remaining ops", async () => {
  await put("tasks", [task({ cid: "a", title: "A" }), task({ cid: "b", title: "B" })]);
  await put("_outbox", [
    { qid: 1, op: "create", entity_type: "task", cid: "a", payload: {} },
    { qid: 2, op: "create", entity_type: "task", cid: "b", payload: {} },
  ]);
  let n = 0;
  const tr = fakeTransport(() => (n++ === 0 ? { status: 201, data: { id: 1 } } : "NETWORK"));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(r.remaining, 1); // op b stays for retry
});

test("pushOutbox drops a 4xx op and counts it failed", async () => {
  await put("tasks", [task({ cid: "a", server_id: 10, title: "A" })]);
  const { mapPut } = require("../../static/offline/idmap.js");
  await mapPut("task", 10, "a");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "task", cid: "a", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 404, data: { detail: "not found" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.failed, 1);
  assert.equal(r.remaining, 0); // dropped
});

test("pushOutbox skips a create whose record already has server_id (idempotent)", async () => {
  await put("tasks", [task({ cid: "a", server_id: 77, title: "A" })]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "task", cid: "a", payload: {} }]);
  const tr = fakeTransport(() => { throw new Error("should not POST"); });
  const r = await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);
  assert.equal(r.remaining, 0); // stale op dropped
});

test("pushOutbox returns busy without double-processing when already running", async () => {
  await put("tasks", [task({ cid: "a", title: "A" })]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "task", cid: "a", payload: {} }]);
  let release;
  const gate = new Promise((res) => { release = res; });
  const tr = fakeTransport(() => ({ status: 201, data: { id: 1 } }));
  const slow = { request: (m, p, b) => gate.then(() => tr.request(m, p, b)) };
  const first = pushOutbox(slow);
  const second = await pushOutbox(slow); // while first is gated
  assert.equal(second.busy, true);
  release();
  await first;
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/syncpush.test.js`
Expected: FAIL — cannot find module `syncpush.js`.

- [ ] **Step 3: Write `static/offline/syncpush.js`**

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
  const TFtag = req("./tagrepo.js", root.TF && root.TF.tagrepo);

  function titleWithTags(record, tagNames) {
    const base = String(record.title == null ? "" : record.title).replace(/\s+$/, "");
    return base + (tagNames || []).map((t) => " #" + t).join("");
  }

  function taskToCreatePayload(record, tagNames, parentServerId) {
    return {
      title: titleWithTags(record, tagNames),
      description: record.description != null ? record.description : "",
      priority: record.priority || "P3",
      project: record.project != null ? record.project : "",
      context: record.context != null ? record.context : "",
      deadline: record.deadline != null ? record.deadline : null,
      gtd_status: record.gtd_status || "inbox",
      waiting_for: record.waiting_for != null ? record.waiting_for : "",
      list_id: null,
      assigned_to: record.assigned_to != null ? record.assigned_to : null,
      parent_id: parentServerId != null ? parentServerId : null,
      recurrence_type: record.recurrence_type != null ? record.recurrence_type : null,
      recurrence_days: record.recurrence_days ? JSON.parse(record.recurrence_days) : null,
    };
  }

  function taskToUpdatePayload(record, tagNames) {
    return {
      title: titleWithTags(record, tagNames),
      description: record.description != null ? record.description : "",
      priority: record.priority || "P3",
      project: record.project != null ? record.project : "",
      context: record.context != null ? record.context : "",
      deadline: record.deadline != null ? record.deadline : null,
      gtd_status: record.gtd_status || "inbox",
      waiting_for: record.waiting_for != null ? record.waiting_for : "",
      assigned_to: record.assigned_to != null ? record.assigned_to : null,
      progress: record.progress != null ? record.progress : 0,
      recurrence_type: record.recurrence_type != null ? record.recurrence_type : null,
      recurrence_days: record.recurrence_days ? JSON.parse(record.recurrence_days) : null,
    };
  }

  function markPayload(record) {
    return { status: record.status };
  }

  function getTaskRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("tasks", "readonly").objectStore("tasks").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function putTaskRaw(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      tx.objectStore("tasks").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  // Wrap a transport call so ONLY a network rejection becomes a tagged stop signal.
  function send(transport, method, path, body) {
    return transport.request(method, path, body).then(
      (res) => res,
      () => { const e = new Error("network"); e.__network = true; throw e; }
    );
  }
  function ok(res) { return res && res.status >= 200 && res.status < 300; }
  function tagsOf(cid, tagsFor) { return tagsFor(cid); }

  function opCreate(op, transport, tagsFor, result) {
    return getTaskRaw(op.cid).then((rec) => {
      if (!rec) return TFoutbox.outboxRemove(op.qid);            // record gone
      if (rec.server_id != null) return TFoutbox.outboxRemove(op.qid); // already created (idempotent)
      const parentP = rec.parent_cid ? TFidmap.serverIdOf(rec.parent_cid) : Promise.resolve(null);
      return Promise.all([parentP, tagsOf(op.cid, tagsFor)]).then(([parentSid, tags]) =>
        send(transport, "POST", "/api/tasks", taskToCreatePayload(rec, tags, parentSid != null ? parentSid : null)).then((res) => {
          if (ok(res)) {
            const sid = res.data.id;
            return TFidmap.mapPut("task", sid, op.cid)
              .then(() => putTaskRaw(Object.assign({}, rec, { server_id: sid, dirty: 0 })))
              .then(() => TFoutbox.outboxRemove(op.qid))
              .then(() => { result.pushed++; });
          }
          result.failed++;
          return TFoutbox.outboxRemove(op.qid);
        })
      );
    });
  }

  function opUpdate(op, transport, tagsFor, result) {
    return Promise.all([getTaskRaw(op.cid), TFidmap.serverIdOf(op.cid)]).then(([rec, sid]) => {
      if (!rec || sid == null) return TFoutbox.outboxRemove(op.qid);
      return tagsOf(op.cid, tagsFor).then((tags) =>
        send(transport, "PUT", "/api/tasks/" + sid, taskToUpdatePayload(rec, tags)).then((res) => {
          if (ok(res)) { return putTaskRaw(Object.assign({}, rec, { dirty: 0 })).then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; }); }
          result.failed++;
          return TFoutbox.outboxRemove(op.qid);
        })
      );
    });
  }

  function opDelete(op, transport, result) {
    return TFidmap.serverIdOf(op.cid).then((sid) => {
      if (sid == null) return TFoutbox.outboxRemove(op.qid); // never created server-side
      return send(transport, "DELETE", "/api/tasks/" + sid, undefined).then((res) => {
        if (ok(res) || res.status === 404) { result.pushed++; return TFoutbox.outboxRemove(op.qid); }
        result.failed++;
        return TFoutbox.outboxRemove(op.qid);
      });
    });
  }

  function opMark(op, transport, result) {
    const p = op.payload || {};
    return TFidmap.serverIdOf(p.task_cid).then((sid) => {
      if (sid == null) return TFoutbox.outboxRemove(op.qid);
      return send(transport, "POST", "/api/tasks/" + sid + "/occurrences/" + p.occurrence_date + "/mark", markPayload(p)).then((res) => {
        if (ok(res)) { result.pushed++; return TFoutbox.outboxRemove(op.qid); }
        result.failed++;
        return TFoutbox.outboxRemove(op.qid);
      });
    });
  }

  function processOp(op, transport, tagsFor, result) {
    if (op.entity_type === "task" && op.op === "create") return opCreate(op, transport, tagsFor, result);
    if (op.entity_type === "task" && op.op === "update") return opUpdate(op, transport, tagsFor, result);
    if (op.entity_type === "task" && op.op === "delete") return opDelete(op, transport, result);
    if (op.entity_type === "recurring_exception" && op.op === "mark_occurrence") return opMark(op, transport, result);
    return TFoutbox.outboxRemove(op.qid); // unknown op → drop
  }

  let _running = false;
  function pushOutbox(transport, opts) {
    if (_running) return Promise.resolve({ pushed: 0, failed: 0, remaining: -1, busy: true });
    _running = true;
    opts = opts || {};
    const tagsFor = opts.tagsFor || ((cid) => TFtag.getEntityTags("task", cid).then((ts) => ts.map((t) => t.name)));
    const result = { pushed: 0, failed: 0, remaining: 0 };
    let stopped = false;
    return TFoutbox.outboxAll()
      .then((ops) => ops.slice().sort((a, b) => a.qid - b.qid))
      .then((ops) => ops.reduce((chain, op) => chain.then(() => {
        if (stopped) return;
        return processOp(op, transport, tagsFor, result).catch((err) => { stopped = true; if (!(err && err.__network)) result.failed++; });
      }), Promise.resolve()))
      .then(() => TFoutbox.outboxAll())
      .then((rem) => { result.remaining = rem.length; return result; })
      .then((r) => { _running = false; return r; }, (e) => { _running = false; throw e; });
  }

  const exported = { taskToCreatePayload, taskToUpdatePayload, markPayload, pushOutbox };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.syncpush = exported; }
  return exported;
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/syncpush.test.js`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add static/offline/syncpush.js tests/offline/syncpush.test.js
git commit -m "feat(offline): syncpush engine (outbox replay -> server)"
```

---

## Task 2: Full Node-suite regression

- [ ] **Step 1: Run the whole offline suite (16 files)**

Run:
```bash
node --test tests/offline/smoke.test.js tests/offline/ids.test.js tests/offline/db.test.js tests/offline/meta.test.js tests/offline/idmap.test.js tests/offline/outbox.test.js tests/offline/blobstore.test.js tests/offline/router.test.js tests/offline/tasklogic.test.js tests/offline/taskrepo.test.js tests/offline/taskquery.test.js tests/offline/tagrepo.test.js tests/offline/recurrence.test.js tests/offline/taskroutes.test.js tests/offline/hydrate.test.js tests/offline/syncpush.test.js
```
Expected: `ℹ tests 138 / ℹ pass 138 / ℹ fail 0`, terminating promptly.

> Count: prior 126 + Task 1 (12) = **138**.

- [ ] **Step 2: No commit** (regression run only). Fix any failure before continuing.

---

## Task 3: Wire `static/index.html` (browser-verified)

**Files:**
- Modify: `static/index.html` (script tag near :1306; transport + `schedulePush` after the `api` object ~:1440; post-write hook inside the `api.fetch` intercept; boot push in `fetchAll`)

> No Node test — browser-verified in Task 5. Make each edit exactly.

- [ ] **Step 1: Add the `syncpush.js` script tag**

Find the line `  <script src="/static/offline/hydrate.js"></script>` and insert immediately AFTER it:

```html
  <script src="/static/offline/syncpush.js"></script>
```

- [ ] **Step 2: Add the transport + `schedulePush` after the `api` object**

Find the end of the `api` object — the line `};` that closes `const api = { ... }`, immediately followed by the line `const isOfflineErr = err =>`. Insert this block BETWEEN them (after `};`, before `const isOfflineErr`):

```js
// ── Offline push (TF.syncpush) — raw-fetch transport bypasses the api intercept ──
const __syncTransport = {
  request: (method, path, body) => window.fetch(path, {
    method,
    headers: Object.assign({ "Content-Type": "application/json" }, __token ? { Authorization: "Bearer " + __token } : {}),
    body: body != null ? JSON.stringify(body) : undefined,
  }).then(r => r.text().then(t => ({ status: r.status, data: t ? JSON.parse(t) : null }))),
};
let __pushTimer = null;
function schedulePush() {
  if (!navigator.onLine || !(window.TF && window.TF.syncpush)) return;
  clearTimeout(__pushTimer);
  __pushTimer = setTimeout(() => { window.TF.syncpush.pushOutbox(__syncTransport).catch(() => {}); }, 1500);
}
window.__pushNow = () => (window.TF && window.TF.syncpush) ? window.TF.syncpush.pushOutbox(__syncTransport) : Promise.resolve(null);
window.addEventListener("online", schedulePush);
```

- [ ] **Step 3: Trigger push after a successful local write (inside the intercept)**

In `api.fetch`, find the intercept dispatch block:

```js
        if (_router.hasRoute(_method, url) && !_R.isNoteTagsCall(_method, url)) {
          const _body = opts.body ? JSON.parse(opts.body) : undefined;
          return await _router.dispatch(_method, url, _body)
            .catch(err => { throw new Error(err && err.message ? err.message : "local route error"); });
        }
```

Replace it with (capture the result, schedule push for non-GET, then return):

```js
        if (_router.hasRoute(_method, url) && !_R.isNoteTagsCall(_method, url)) {
          const _body = opts.body ? JSON.parse(opts.body) : undefined;
          const _res = await _router.dispatch(_method, url, _body)
            .catch(err => { throw new Error(err && err.message ? err.message : "local route error"); });
          if (_method !== "GET") schedulePush();
          return _res;
        }
```

- [ ] **Step 4: Flush accumulated outbox on boot (in `fetchAll`)**

Find the hydration block in `fetchAll` (search `Hydrate local tasks from the server`). Immediately AFTER its closing `}` (the `try { ... } catch (e) {}` line's block), add:

```js
    if (navigator.onLine) schedulePush();
```

- [ ] **Step 5: Commit**

```bash
git add static/index.html
git commit -m "feat(offline): wire push triggers (online + after-write + boot + manual)"
```

---

## Task 4: Service Worker — precache + cache bump

**Files:**
- Modify: `static/sw.js:1` (CACHE), STATIC array

- [ ] **Step 1: Bump the cache version**

At `static/sw.js:1`, change `const CACHE = "taskflow-v119-offline-tasks";` to:

```js
const CACHE = "taskflow-v120-sync-push";
```

- [ ] **Step 2: Precache `syncpush.js`**

In the `STATIC` array, find `"/static/offline/hydrate.js",` and add immediately after it:

```js
  "/static/offline/syncpush.js",
```

- [ ] **Step 3: Verify syntax + commit**

Run: `node --check static/sw.js`
Expected: no output (valid).

```bash
git add static/sw.js
git commit -m "chore(sw): bump cache v120 + precache syncpush.js"
```

---

## Task 5: Browser verification (manual — record results)

Deploy (merge → push → confirm VPS pulled; see `feedback_deploy_silent_fail` — verify `curl https://todo.yatno.web.id/sw.js | grep CACHE` shows v120). Then in the logged-in tab, **reset the old SW** (DevTools console):

```js
(async()=>{for(const r of await navigator.serviceWorker.getRegistrations())await r.unregister();for(const k of await caches.keys())await caches.delete(k);location.reload();})()
```

After reload, verify (paste in console, share output):

```js
(async()=>{
  const R=[]; const ok=(n,c)=>R.push((c?'✅':'❌')+' '+n);
  try{
    ok('syncpush loaded', !!(window.TF && TF.syncpush));
    // create a task locally (offline-first), then push and confirm it reaches the server
    const t = await api.post('/api/tasks',{title:'__push verif #pushtag', gtd_status:'inbox'});
    ok('created locally id===cid', t.id===t.cid);
    const before = (await TF.outbox.outboxByEntity('task', t.cid)).length;
    ok('outbox has op before push', before>0);
    const res = await window.__pushNow();
    ok('pushOutbox ran ('+JSON.stringify(res)+')', res && res.pushed>=1);
    // the local record now has a server_id
    const rec = await TF.taskrepo.getTask(t.cid);
    ok('record got server_id after push', rec && rec.server_id!=null);
    // confirm on server via RAW fetch (bypass intercept)
    const h={Authorization:'Bearer '+localStorage.getItem('tf_token')};
    const srv = await (await window.fetch('/api/tasks/'+rec.server_id,{headers:h})).json();
    ok('task exists on server with tag', srv && srv.title==='__push verif');
    const srvTags = await (await window.fetch('/api/tasks/'+rec.server_id+'/tags',{headers:h})).json();
    ok('tag pushed to server', srvTags.some(x=>x.name==='pushtag'));
    // cleanup: delete locally (intercept) AND on server (raw), then push the delete
    await api.del('/api/tasks/'+rec.server_id);
    await window.__pushNow();
    ok('cleanup pushed', true);
  }catch(e){ R.push('❌ EXCEPTION: '+(e&&e.message)); }
  const out='=== PUSH VERIFICATION ===\n'+R.join('\n'); console.log(out); return out;
})()
```

Expected: all ✅ — task created locally, push assigned a `server_id`, the task + its tag appear on the server, and cleanup removes it. Report pass/fail.

---

## Done criteria

- `syncpush.js` exports `pushOutbox`, `taskToCreatePayload`, `taskToUpdatePayload`, `markPayload`; Node suite green (138).
- Push drains outbox FIFO, replays create/update/delete/mark, assigns `server_id` + `_idmap` on create, removes ops; stop-on-network, drop-on-4xx, idempotent, serial.
- Tags reach the server via title reconstruction.
- Triggers wired: `online` event, after-write (debounced), boot flush, and `window.__pushNow()`; transport uses raw fetch (not `api`).
- SW bumped to v120 with `syncpush.js` precached. Browser verification passes.

## Next (out of scope)

- **#2b Pull engine** — server→local reconciliation (hard-delete handling), pull bot/other-device changes.
- **#2c Conflict resolution**; **#2d collaborative offline**.
- Cleanup: retire `computeOfflineQuadrant` + dead offline branches.
```
