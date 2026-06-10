# Offline Mindmaps (#2g) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make personal mindmaps local-first (IndexedDB source of truth) with two-way sync, mirroring the notes slices (#2f-1/#2f-2) but simpler — no tags, no wikilinks, no BlobStore; `data_json` is an opaque inline string.

**Architecture:** New modules `mindmaprepo.js` (local CRUD + `_outbox`) and `mindmaproutes.js` (LocalRouter intercept), registered into the existing `buildTaskRouter`. Sync extends `syncpush.js` (4 op handlers) and `syncpull.js` (`pullMindmaps` with a lazy `fetchOne` for `data_json`). Wire scripts + `sync()` chain in `index.html`, retire the legacy `tf_mindmap_pending_*`/`tf_mindmap_list` localStorage in `MindmapPage`, bump the service worker.

**Tech Stack:** Vanilla ES5-style UMD modules (browser globals on `window.TF` + Node `require`), IndexedDB (fake-indexeddb in tests), `node --test`.

**Reference spec:** `docs/superpowers/specs/2026-06-10-offline-mindmaps-design.md`

**Baseline before starting:** `node --test tests/offline/*.test.js` → `pass 268`.

**Key facts established from the codebase (do not re-derive):**
- Local store `mindmaps` already exists in `db.js` v3 (keyed `cid`, indexes `server_id`, `updated_at`, `dirty`). **No DB version bump.**
- Server mindmap row uses `is_pinned` (0/1), NOT `pinned`. Server endpoints: `GET /api/mindmaps` (list metadata, NO `data_json`), `POST /api/mindmaps`, `GET /api/mindmaps/:id` (full, includes `data_json`), `PUT /api/mindmaps/:id`, `PATCH /api/mindmaps/:id/pin` (toggle, does NOT bump `updated_at`), `DELETE /api/mindmaps/:id`. `PATCH /:id/share` and `GET /api/lists/:id/mindmaps` are collaborative — must stay on the network.
- idmap API: `mapPut(type, serverId, cid)`, `cidOf(type, serverId)`, `serverIdOf(cid)`, `mapDelete(type, serverId)`. Use `type === "mindmap"`.
- outbox API: `outboxAdd(op)`, `outboxAll()`, `outboxRemove(qid)`, `outboxByEntity(type, cid)`.
- `syncpush.js` helpers already in file: `send(transport, method, path, body)`, `ok(res)`. Transport returns `{status, data}`.
- `syncpull.js` helpers already in file: `tsEpoch(ts)` (tz-less = UTC), `dropOutbox(entityType, cid)`, `TFids.newCid()`.

---

### Task 1: `mindmaprepo.js` — local CRUD + outbox

**Files:**
- Create: `static/offline/mindmaprepo.js`
- Test: `tests/offline/mindmaprepo.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/offline/mindmaprepo.test.js`:

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const {
  createMindmap, updateMindmap, deleteMindmap, togglePin, getRaw,
} = require("../../static/offline/mindmaprepo.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

test("createMindmap writes a dirty local record + create op, defaults applied", async () => {
  const rec = await createMindmap({ title: "Plan" }, { now: "2026-06-10T00:00:00" });
  assert.ok(rec.cid);
  assert.equal(rec.server_id, null);
  assert.equal(rec.title, "Plan");
  assert.equal(rec.pinned, false);
  assert.equal(rec.list_id, null);
  assert.equal(rec.deleted, false);
  assert.equal(rec.dirty, 1);
  assert.match(rec.data_json, /nodeData/);
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].entity_type, "mindmap");
  assert.equal(ops[0].op, "create");
  assert.equal(ops[0].cid, rec.cid);
});

test("updateMindmap patches title/data_json, bumps updated_at, dedupes update ops", async () => {
  const rec = await createMindmap({ title: "A", data_json: "{\"nodeData\":{}}" }, { now: "2026-06-10T00:00:00" });
  await updateMindmap(rec.cid, { data_json: "{\"nodeData\":{\"x\":1}}" }, { now: "2026-06-10T01:00:00" });
  await updateMindmap(rec.cid, { title: "A2", data_json: "{\"nodeData\":{\"x\":2}}" }, { now: "2026-06-10T02:00:00" });
  const after = await getRaw(rec.cid);
  assert.equal(after.title, "A2");
  assert.equal(after.data_json, "{\"nodeData\":{\"x\":2}}");
  assert.equal(after.updated_at, "2026-06-10T02:00:00");
  assert.equal(after.dirty, 1);
  const ops = await outboxAll();
  // 1 create + only 1 update (second update deduped the first)
  assert.equal(ops.filter((o) => o.op === "update").length, 1);
  assert.equal(ops.filter((o) => o.op === "create").length, 1);
});

test("togglePin flips pinned, enqueues a pin op, and does NOT set dirty", async () => {
  const rec = await createMindmap({ title: "P" }, { now: "2026-06-10T00:00:00" });
  // simulate an already-synced record so we can prove pin does not dirty it
  const db = await openDB();
  await new Promise((res) => { const tx = db.transaction("mindmaps", "readwrite"); tx.objectStore("mindmaps").put(Object.assign({}, rec, { server_id: 9, dirty: 0 })); tx.oncomplete = res; });
  const next = await togglePin(rec.cid);
  assert.equal(next.pinned, true);
  const after = await getRaw(rec.cid);
  assert.equal(after.pinned, true);
  assert.equal(after.dirty, 0); // pin orthogonal to content LWW
  const ops = await outboxAll();
  const pinOps = ops.filter((o) => o.op === "pin");
  assert.equal(pinOps.length, 1);
  assert.equal(pinOps[0].payload.pinned, true);
});

test("deleteMindmap tombstones (deleted+dirty) and enqueues a delete op", async () => {
  const rec = await createMindmap({ title: "D" }, { now: "2026-06-10T00:00:00" });
  await deleteMindmap(rec.cid);
  const after = await getRaw(rec.cid);
  assert.equal(after.deleted, true);
  assert.equal(after.dirty, 1);
  const ops = await outboxAll();
  assert.equal(ops.filter((o) => o.op === "delete").length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/mindmaprepo.test.js`
Expected: FAIL — `Cannot find module '../../static/offline/mindmaprepo.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `static/offline/mindmaprepo.js`:

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
  const TFoutbox = req("./outbox.js", root.TF && root.TF.outbox);

  const DEFAULT_DATA = '{"nodeData":{"id":"root","topic":"Untitled","root":true,"children":[]}}';

  function getRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("mindmaps", "readonly").objectStore("mindmaps").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function putRaw(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("mindmaps", "readwrite");
      tx.objectStore("mindmaps").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  // Remove any pending 'update' ops for this cid (autosave fires frequently; keep outbox lean).
  function dedupeUpdates(cid) {
    return TFoutbox.outboxByEntity("mindmap", cid).then((ops) =>
      ops.filter((o) => o.op === "update").reduce((p, o) => p.then(() => TFoutbox.outboxRemove(o.qid)), Promise.resolve()));
  }

  function createMindmap(input, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    const rec = {
      cid: TFids.newCid(), server_id: null,
      title: input.title != null ? input.title : "Untitled",
      data_json: input.data_json != null ? input.data_json : DEFAULT_DATA,
      pinned: false, list_id: null,
      created_at: now, updated_at: now, deleted: false, dirty: 1, base_rev: null,
    };
    return putRaw(rec)
      .then(() => TFoutbox.outboxAdd({ op: "create", entity_type: "mindmap", cid: rec.cid, payload: { cid: rec.cid } }))
      .then(() => rec);
  }

  function updateMindmap(cid, patch, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    return getRaw(cid).then((rec) => {
      if (!rec || rec.deleted) return Promise.reject(new Error("Mindmap not found"));
      const next = Object.assign({}, rec, {
        title: patch.title != null ? patch.title : rec.title,
        data_json: patch.data_json != null ? patch.data_json : rec.data_json,
        updated_at: now, dirty: 1,
      });
      return putRaw(next)
        .then(() => dedupeUpdates(cid))
        .then(() => TFoutbox.outboxAdd({ op: "update", entity_type: "mindmap", cid: cid, payload: { cid: cid } }))
        .then(() => next);
    });
  }

  function deleteMindmap(cid) {
    return getRaw(cid).then((rec) => {
      if (!rec || rec.deleted) return Promise.reject(new Error("Mindmap not found"));
      const next = Object.assign({}, rec, { deleted: true, dirty: 1 });
      return putRaw(next)
        .then(() => TFoutbox.outboxAdd({ op: "delete", entity_type: "mindmap", cid: cid, payload: { cid: cid } }))
        .then(() => ({ ok: true }));
    });
  }

  function togglePin(cid) {
    return getRaw(cid).then((rec) => {
      if (!rec || rec.deleted) return Promise.reject(new Error("Mindmap not found"));
      const next = Object.assign({}, rec, { pinned: !rec.pinned }); // NOT dirty — pin orthogonal to LWW
      return putRaw(next)
        .then(() => TFoutbox.outboxAdd({ op: "pin", entity_type: "mindmap", cid: cid, payload: { pinned: next.pinned } }))
        .then(() => next);
    });
  }

  const exported = { createMindmap, updateMindmap, deleteMindmap, togglePin, getRaw, putRaw };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.mindmaprepo = exported; }
  return exported;
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/mindmaprepo.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add static/offline/mindmaprepo.js tests/offline/mindmaprepo.test.js
git commit -m "feat(offline): mindmaprepo local CRUD + outbox (#2g)"
```

---

### Task 2: `mindmaproutes.js` — LocalRouter intercept + wire into buildTaskRouter

**Files:**
- Create: `static/offline/mindmaproutes.js`
- Modify: `static/offline/taskroutes.js` (add require + `registerMindmapRoutes(router)`)
- Test: `tests/offline/mindmaproutes.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/offline/mindmaproutes.test.js`:

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset } = require("../../static/offline/db.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

test("POST then GET list returns server-shaped metadata WITHOUT data_json", async () => {
  const R = buildTaskRouter();
  const created = await R.dispatch("POST", "/api/mindmaps", { title: "M1", data_json: "{\"nodeData\":{\"id\":\"root\"}}" });
  assert.equal(created.title, "M1");
  assert.equal(created.is_pinned, 0);
  assert.ok("data_json" in created); // POST returns full
  const list = await R.dispatch("GET", "/api/mindmaps", undefined);
  assert.equal(list.length, 1);
  assert.equal(list[0].title, "M1");
  assert.equal("data_json" in list[0], false); // list omits data_json
  assert.ok("is_pinned" in list[0] && "updated_at" in list[0]);
});

test("GET /:id returns full record including data_json", async () => {
  const R = buildTaskRouter();
  const m = await R.dispatch("POST", "/api/mindmaps", { title: "M", data_json: "{\"nodeData\":{\"id\":\"root\",\"topic\":\"hi\"}}" });
  const full = await R.dispatch("GET", "/api/mindmaps/" + m.id, undefined);
  assert.equal(full.title, "M");
  assert.match(full.data_json, /topic/);
});

test("PUT updates, PATCH /pin toggles is_pinned, DELETE removes from list", async () => {
  const R = buildTaskRouter();
  const m = await R.dispatch("POST", "/api/mindmaps", { title: "M", data_json: "{}" });
  await R.dispatch("PUT", "/api/mindmaps/" + m.id, { title: "M2", data_json: "{\"a\":1}" });
  const afterPut = await R.dispatch("GET", "/api/mindmaps/" + m.id, undefined);
  assert.equal(afterPut.title, "M2");
  assert.equal(afterPut.data_json, "{\"a\":1}");
  const pinned = await R.dispatch("PATCH", "/api/mindmaps/" + m.id + "/pin", undefined);
  assert.equal(pinned.is_pinned, 1);
  await R.dispatch("DELETE", "/api/mindmaps/" + m.id, undefined);
  assert.equal((await R.dispatch("GET", "/api/mindmaps", undefined)).length, 0);
});

test("list sorts pinned first then by updated_at desc", async () => {
  const R = buildTaskRouter();
  const a = await R.dispatch("POST", "/api/mindmaps", { title: "A", data_json: "{}" });
  const b = await R.dispatch("POST", "/api/mindmaps", { title: "B", data_json: "{}" });
  await R.dispatch("PATCH", "/api/mindmaps/" + a.id + "/pin", undefined); // pin A
  const list = await R.dispatch("GET", "/api/mindmaps", undefined);
  assert.equal(list[0].title, "A"); // pinned first
  assert.equal(list[0].is_pinned, 1);
});

test("share + list-scoped mindmaps are NOT intercepted (stay network)", async () => {
  const R = buildTaskRouter();
  assert.equal(R.hasRoute("PATCH", "/api/mindmaps/5/share"), false);
  assert.equal(R.hasRoute("GET", "/api/lists/3/mindmaps"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/mindmaproutes.test.js`
Expected: FAIL — `Cannot find module '../../static/offline/mindmaproutes.js'` (raised via taskroutes require once wired) or routes unregistered.

- [ ] **Step 3a: Write minimal implementation**

Create `static/offline/mindmaproutes.js`:

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
  const TFrepo = req("./mindmaprepo.js", root.TF && root.TF.mindmaprepo);

  function allMindmaps() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("mindmaps", "readonly").objectStore("mindmaps").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  const displayId = (rec) => (rec.server_id != null ? rec.server_id : rec.cid);
  function meta(rec) {
    return {
      id: displayId(rec), title: rec.title, is_pinned: rec.pinned ? 1 : 0,
      list_id: rec.list_id != null ? rec.list_id : null,
      created_at: rec.created_at, updated_at: rec.updated_at,
    };
  }
  function full(rec) { return Object.assign(meta(rec), { data_json: rec.data_json }); }

  function resolveMindmapCid(idOrCid) {
    return allMindmaps().then((all) => {
      for (const m of all) if (m.cid === idOrCid) return m.cid;
      for (const m of all) if (m.server_id != null && String(m.server_id) === String(idOrCid)) return m.cid;
      return null;
    });
  }
  function notFound() { return Promise.reject(new Error("Mindmap not found")); }

  function listMindmaps() {
    return allMindmaps().then((all) => {
      const personal = all.filter((m) => !m.deleted && m.list_id == null);
      personal.sort((a, b) => {
        const pa = a.pinned ? 1 : 0, pb = b.pinned ? 1 : 0;
        if (pa !== pb) return pb - pa;
        return String(b.updated_at) < String(a.updated_at) ? -1 : String(b.updated_at) > String(a.updated_at) ? 1 : 0;
      });
      return personal.map(meta);
    });
  }
  function getFull(cid) {
    return allMindmaps().then((all) => {
      const rec = all.find((m) => m.cid === cid);
      return rec ? full(rec) : null;
    });
  }

  function registerMindmapRoutes(router) {
    router.register("GET", "/api/mindmaps", () => listMindmaps());
    router.register("POST", "/api/mindmaps", ({ body }) =>
      TFrepo.createMindmap(body || {}, {}).then((rec) => full(rec)));
    router.register("GET", "/api/mindmaps/:id", ({ params }) =>
      resolveMindmapCid(params.id).then((cid) => (cid ? getFull(cid) : notFound())));
    router.register("PUT", "/api/mindmaps/:id", ({ params, body }) =>
      resolveMindmapCid(params.id).then((cid) => (cid ? TFrepo.updateMindmap(cid, body || {}, {}).then(() => getFull(cid)) : notFound())));
    router.register("PATCH", "/api/mindmaps/:id/pin", ({ params }) =>
      resolveMindmapCid(params.id).then((cid) => (cid ? TFrepo.togglePin(cid).then(() => getFull(cid)) : notFound())));
    router.register("DELETE", "/api/mindmaps/:id", ({ params }) =>
      resolveMindmapCid(params.id).then((cid) => (cid ? TFrepo.deleteMindmap(cid) : notFound())));
  }

  const exported = { registerMindmapRoutes };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.mindmaproutes = exported; }
  return exported;
});
```

- [ ] **Step 3b: Wire into `taskroutes.js`**

In `static/offline/taskroutes.js`, after the `TFdrawingroutes` require (line ~22), add:

```js
  const TFmindmaproutes = req("./mindmaproutes.js", root.TF && root.TF.mindmaproutes);
```

In `buildTaskRouter`, after `TFdrawingroutes.registerDrawingRoutes(router);` (line ~120), add:

```js
    TFmindmaproutes.registerMindmapRoutes(router);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/mindmaproutes.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add static/offline/mindmaproutes.js static/offline/taskroutes.js tests/offline/mindmaproutes.test.js
git commit -m "feat(offline): mindmaproutes intercept + wire into buildTaskRouter (#2g)"
```

---

### Task 3: `syncpush.js` — mindmap mappers + op handlers

**Files:**
- Modify: `static/offline/syncpush.js`
- Test: `tests/offline/mindmapsync_push.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/offline/mindmapsync_push.test.js`:

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { serverIdOf, mapPut } = require("../../static/offline/idmap.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const {
  mindmapToCreatePayload, mindmapToUpdatePayload, pushOutbox,
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
async function getMM(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("mindmaps").objectStore("mindmaps").get(cid); q.onsuccess = () => res(q.result); });
}
function mm(over) {
  return Object.assign({
    cid: over.cid, server_id: null, title: "M", data_json: "{\"nodeData\":{}}",
    pinned: false, list_id: null, created_at: "2026-06-10T00:00:00", updated_at: "2026-06-10T00:00:00",
    deleted: false, dirty: 1, base_rev: null,
  }, over);
}
function fakeTransport(handler) {
  const calls = [];
  return { calls, request(method, path, body) { calls.push({ method, path, body }); const h = handler(method, path, body); if (h === "NETWORK") return Promise.reject(new Error("net")); return Promise.resolve(h); } };
}

test("mindmapToCreatePayload / Update build {title, data_json}", () => {
  const p = mindmapToCreatePayload(mm({ cid: "m", title: "Hi", data_json: "{\"x\":1}" }));
  assert.deepEqual(p, { title: "Hi", data_json: "{\"x\":1}" });
  assert.deepEqual(mindmapToUpdatePayload(mm({ cid: "m", title: "T", data_json: "{}" })), { title: "T", data_json: "{}" });
});

test("push create POSTs /api/mindmaps, sets server_id + idmap + base_rev, clears dirty", async () => {
  await put("mindmaps", [mm({ cid: "m", title: "Hi" })]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "mindmap", cid: "m", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 200, data: { id: 50, updated_at: "2026-06-10T10:00:00" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(await serverIdOf("m"), 50);
  const rec = await getMM("m");
  assert.equal(rec.server_id, 50);
  assert.equal(rec.dirty, 0);
  assert.equal(rec.base_rev, "2026-06-10T10:00:00");
  assert.equal((await outboxAll()).length, 0);
});

test("push update PUTs and clears dirty + base_rev", async () => {
  await put("mindmaps", [mm({ cid: "m", server_id: 7, title: "T" })]);
  await mapPut("mindmap", 7, "m");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  const tr = fakeTransport((method) => { assert.equal(method, "PUT"); return { status: 200, data: { id: 7, updated_at: "2026-06-10T11:00:00" } }; });
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  const rec = await getMM("m");
  assert.equal(rec.dirty, 0);
  assert.equal(rec.base_rev, "2026-06-10T11:00:00");
});

test("push update 404 re-creates (POST), remaps server_id", async () => {
  await put("mindmaps", [mm({ cid: "m", server_id: 7, title: "T" })]);
  await mapPut("mindmap", 7, "m");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  let n = 0;
  const tr = fakeTransport(() => (n++ === 0 ? { status: 404, data: { detail: "gone" } } : { status: 200, data: { id: 99, updated_at: "2026-06-10T12:00:00" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(await serverIdOf("m"), 99);
  const rec = await getMM("m");
  assert.equal(rec.server_id, 99);
  assert.equal(rec.dirty, 0);
});

test("push delete DELETEs, drops idmap + record", async () => {
  await put("mindmaps", [mm({ cid: "m", server_id: 7, deleted: true })]);
  await mapPut("mindmap", 7, "m");
  await put("_outbox", [{ qid: 1, op: "delete", entity_type: "mindmap", cid: "m", payload: {} }]);
  const tr = fakeTransport((method) => { assert.equal(method, "DELETE"); return { status: 200, data: { ok: true } }; });
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(await serverIdOf("m"), null);
  assert.equal(await getMM("m"), undefined);
});

test("push pin is conditional: skips PATCH when server already matches", async () => {
  await put("mindmaps", [mm({ cid: "m", server_id: 7, pinned: true, dirty: 0 })]);
  await mapPut("mindmap", 7, "m");
  await put("_outbox", [{ qid: 1, op: "pin", entity_type: "mindmap", cid: "m", payload: { pinned: true } }]);
  const tr = fakeTransport((method) => {
    if (method === "GET") return { status: 200, data: { id: 7, is_pinned: 1 } }; // already pinned on server
    throw new Error("should not PATCH when already in sync");
  });
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal((await outboxAll()).length, 0);
});

test("push pin PATCHes when server differs", async () => {
  await put("mindmaps", [mm({ cid: "m", server_id: 7, pinned: true, dirty: 0 })]);
  await mapPut("mindmap", 7, "m");
  await put("_outbox", [{ qid: 1, op: "pin", entity_type: "mindmap", cid: "m", payload: { pinned: true } }]);
  const seen = [];
  const tr = fakeTransport((method) => {
    seen.push(method);
    if (method === "GET") return { status: 200, data: { id: 7, is_pinned: 0 } }; // server unpinned → must toggle
    return { status: 200, data: { id: 7, is_pinned: 1 } };
  });
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.deepEqual(seen, ["GET", "PATCH"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/mindmapsync_push.test.js`
Expected: FAIL — `mindmapToCreatePayload` is not exported / undefined.

- [ ] **Step 3a: Add mappers**

In `static/offline/syncpush.js`, after `noteToUpdatePayload` (line ~94), add:

```js
  function mindmapToCreatePayload(record) {
    return {
      title: record.title != null ? record.title : "Untitled",
      data_json: record.data_json != null ? record.data_json : "",
    };
  }
  function mindmapToUpdatePayload(record) {
    return mindmapToCreatePayload(record);
  }
```

- [ ] **Step 3b: Add raw store helpers + op handlers**

In `static/offline/syncpush.js`, after `opNotePin` (line ~452), add:

```js
  function getMindmapRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("mindmaps", "readonly").objectStore("mindmaps").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function putMindmapRaw(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("mindmaps", "readwrite");
      tx.objectStore("mindmaps").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function deleteMindmapRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("mindmaps", "readwrite");
      tx.objectStore("mindmaps").delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function opMindmapCreate(op, transport, result) {
    return getMindmapRaw(op.cid).then((rec) => {
      if (!rec) return TFoutbox.outboxRemove(op.qid);
      if (rec.server_id != null) return TFoutbox.outboxRemove(op.qid);
      return send(transport, "POST", "/api/mindmaps", mindmapToCreatePayload(rec)).then((res) => {
        if (ok(res)) {
          const sid = res.data.id;
          return TFidmap.mapPut("mindmap", sid, op.cid)
            .then(() => putMindmapRaw(Object.assign({}, rec, { server_id: sid, dirty: 0, base_rev: res.data && res.data.updated_at != null ? res.data.updated_at : rec.base_rev })))
            .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; });
        }
        result.failed++;
        return TFoutbox.outboxRemove(op.qid);
      });
    });
  }

  function opMindmapUpdate(op, transport, result) {
    return Promise.all([getMindmapRaw(op.cid), TFidmap.serverIdOf(op.cid)]).then(([rec, sid]) => {
      if (!rec || sid == null) return TFoutbox.outboxRemove(op.qid);
      return send(transport, "PUT", "/api/mindmaps/" + sid, mindmapToUpdatePayload(rec)).then((res) => {
        if (ok(res)) {
          return putMindmapRaw(Object.assign({}, rec, { dirty: 0, base_rev: res.data && res.data.updated_at != null ? res.data.updated_at : rec.base_rev }))
            .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; });
        }
        if (res.status === 404) {
          return send(transport, "POST", "/api/mindmaps", mindmapToCreatePayload(rec)).then((res2) => {
            if (ok(res2)) {
              const nid = res2.data.id;
              return TFidmap.mapDelete("mindmap", sid)
                .then(() => TFidmap.mapPut("mindmap", nid, op.cid))
                .then(() => putMindmapRaw(Object.assign({}, rec, { server_id: nid, dirty: 0, base_rev: res2.data && res2.data.updated_at != null ? res2.data.updated_at : rec.base_rev })))
                .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; });
            }
            result.failed++;
            return TFoutbox.outboxRemove(op.qid);
          });
        }
        result.failed++;
        return TFoutbox.outboxRemove(op.qid);
      });
    });
  }

  function opMindmapDelete(op, transport, result) {
    return TFidmap.serverIdOf(op.cid).then((sid) => {
      if (sid == null) {
        return deleteMindmapRaw(op.cid).then(() => TFoutbox.outboxRemove(op.qid));
      }
      return send(transport, "DELETE", "/api/mindmaps/" + sid, undefined).then((res) => {
        if (ok(res) || res.status === 404) {
          return TFidmap.mapDelete("mindmap", sid)
            .then(() => deleteMindmapRaw(op.cid))
            .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; });
        }
        result.failed++;
        return TFoutbox.outboxRemove(op.qid);
      });
    });
  }

  function opMindmapPin(op, transport, result) {
    return Promise.all([getMindmapRaw(op.cid), TFidmap.serverIdOf(op.cid)]).then(([rec, sid]) => {
      if (!rec || sid == null) return TFoutbox.outboxRemove(op.qid);
      return send(transport, "GET", "/api/mindmaps/" + sid, undefined).then((res) => {
        if (!ok(res)) { result.failed++; return TFoutbox.outboxRemove(op.qid); }
        const serverPinned = !!(res.data && res.data.is_pinned);
        if (serverPinned === !!rec.pinned) {
          return TFoutbox.outboxRemove(op.qid).then(() => { result.pushed++; }); // already in sync
        }
        return send(transport, "PATCH", "/api/mindmaps/" + sid + "/pin", undefined).then((res2) => {
          if (ok(res2)) { return TFoutbox.outboxRemove(op.qid).then(() => { result.pushed++; }); }
          result.failed++;
          return TFoutbox.outboxRemove(op.qid);
        });
      });
    });
  }
```

- [ ] **Step 3c: Dispatch in `processOp` + export mappers**

In `processOp`, after the drawing dispatch line (`if (op.entity_type === "drawing" ...)`, line ~485), add:

```js
    if (op.entity_type === "mindmap" && op.op === "create") return opMindmapCreate(op, transport, result);
    if (op.entity_type === "mindmap" && op.op === "update") return opMindmapUpdate(op, transport, result);
    if (op.entity_type === "mindmap" && op.op === "delete") return opMindmapDelete(op, transport, result);
    if (op.entity_type === "mindmap" && op.op === "pin") return opMindmapPin(op, transport, result);
```

In the `exported` object (line ~509), add `mindmapToCreatePayload, mindmapToUpdatePayload`:

```js
  const exported = { taskToCreatePayload, taskToUpdatePayload, markPayload, habitToCreatePayload, habitToUpdatePayload, checkinPayload, noteToCreatePayload, noteToUpdatePayload, mindmapToCreatePayload, mindmapToUpdatePayload, pushOutbox };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/mindmapsync_push.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add static/offline/syncpush.js tests/offline/mindmapsync_push.test.js
git commit -m "feat(offline): push mindmap create/update/delete/pin ops (#2g)"
```

---

### Task 4: `syncpull.js` — pullMindmaps with lazy data_json fetch

**Files:**
- Modify: `static/offline/syncpull.js`
- Test: `tests/offline/mindmapsync_pull.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/offline/mindmapsync_pull.test.js`:

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut, serverIdOf, cidOf } = require("../../static/offline/idmap.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const { pullMindmaps } = require("../../static/offline/syncpull.js");

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
async function getAll(store) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result || []); });
}
// metadata row (list shape, no data_json) + a fetchOne that supplies the full row.
function metaRow(over) {
  return Object.assign({ id: over.id, title: "S", is_pinned: 0, list_id: null, created_at: "2026-06-10T00:00:00", updated_at: "2026-06-10T00:00:00" }, over);
}
function fullFor(rows) {
  return (sid) => { const r = rows.find((x) => String(x.id) === String(sid)); return Promise.resolve(r ? Object.assign({}, r, { data_json: r.data_json || "{\"nodeData\":{}}" }) : null); };
}

test("new server mindmap is fetched (data_json) + inserted with idmap", async () => {
  const rows = [metaRow({ id: 5, title: "Remote", data_json: "{\"nodeData\":{\"id\":\"root\"}}" })];
  const res = await pullMindmaps(rows, fullFor(rows));
  assert.equal(res.created, 1);
  const local = await getAll("mindmaps");
  assert.equal(local.length, 1);
  assert.equal(local[0].title, "Remote");
  assert.match(local[0].data_json, /root/);
  assert.equal(local[0].dirty, 0);
  assert.equal(await cidOf("mindmap", 5), local[0].cid);
});

test("changed clean local is overwritten; fetchOne only called for new/changed", async () => {
  await put("mindmaps", [{ cid: "m", server_id: 5, title: "Old", data_json: "{\"old\":1}", pinned: false, list_id: null, created_at: "x", updated_at: "2026-06-10T00:00:00", deleted: false, dirty: 0, base_rev: "2026-06-10T00:00:00" }]);
  await mapPut("mindmap", 5, "m");
  const rows = [metaRow({ id: 5, title: "New", updated_at: "2026-06-10T05:00:00", data_json: "{\"new\":1}" })];
  let fetchCount = 0;
  const fetchOne = (sid) => { fetchCount++; return fullFor(rows)(sid); };
  const res = await pullMindmaps(rows, fetchOne);
  assert.equal(res.updated, 1);
  assert.equal(fetchCount, 1);
  const local = (await getAll("mindmaps"))[0];
  assert.equal(local.title, "New");
  assert.equal(local.data_json, "{\"new\":1}");
});

test("unchanged clean local is not fetched or rewritten", async () => {
  await put("mindmaps", [{ cid: "m", server_id: 5, title: "Same", data_json: "{}", pinned: false, list_id: null, created_at: "x", updated_at: "2026-06-10T00:00:00", deleted: false, dirty: 0, base_rev: "2026-06-10T00:00:00" }]);
  await mapPut("mindmap", 5, "m");
  const rows = [metaRow({ id: 5, title: "Same", updated_at: "2026-06-10T00:00:00" })];
  let fetchCount = 0;
  const res = await pullMindmaps(rows, (sid) => { fetchCount++; return fullFor(rows)(sid); });
  assert.equal(res.updated, 0);
  assert.equal(fetchCount, 0);
});

test("dirty local is skipped (local-wins / deferred)", async () => {
  await put("mindmaps", [{ cid: "m", server_id: 5, title: "MineEdited", data_json: "{}", pinned: false, list_id: null, created_at: "x", updated_at: "2026-06-10T09:00:00", deleted: false, dirty: 1, base_rev: "2026-06-10T00:00:00" }]);
  await mapPut("mindmap", 5, "m");
  const rows = [metaRow({ id: 5, title: "ServerOlder", updated_at: "2026-06-10T01:00:00" })];
  const res = await pullMindmaps(rows, fullFor(rows));
  // local newer → local wins
  assert.equal(res.lwwResolved, 1);
  const local = (await getAll("mindmaps"))[0];
  assert.equal(local.title, "MineEdited");
});

test("clean local vanished from server is deleted + unmapped", async () => {
  await put("mindmaps", [{ cid: "m", server_id: 5, title: "Gone", data_json: "{}", pinned: false, list_id: null, created_at: "x", updated_at: "2026-06-10T00:00:00", deleted: false, dirty: 0, base_rev: "2026-06-10T00:00:00" }]);
  await mapPut("mindmap", 5, "m");
  const res = await pullMindmaps([], fullFor([]));
  assert.equal(res.deleted, 1);
  assert.equal((await getAll("mindmaps")).length, 0);
  assert.equal(await serverIdOf("m"), null);
});

test("pin-adopt uses list is_pinned but respects a pending pin op", async () => {
  await put("mindmaps", [{ cid: "m", server_id: 5, title: "P", data_json: "{}", pinned: false, list_id: null, created_at: "x", updated_at: "2026-06-10T00:00:00", deleted: false, dirty: 0, base_rev: "2026-06-10T00:00:00" }]);
  await mapPut("mindmap", 5, "m");
  await put("_outbox", [{ qid: 1, op: "pin", entity_type: "mindmap", cid: "m", payload: { pinned: false } }]);
  const rows = [metaRow({ id: 5, title: "P", is_pinned: 1, updated_at: "2026-06-10T00:00:00" })];
  const res = await pullMindmaps(rows, fullFor(rows));
  // pending pin op → do not adopt server pinned
  assert.equal(res.pinned, 0);
  const local = (await getAll("mindmaps"))[0];
  assert.equal(local.pinned, false);
});

test("shared mindmaps (list_id != null) are ignored", async () => {
  const rows = [metaRow({ id: 9, title: "Shared", list_id: 3 })];
  const res = await pullMindmaps(rows, fullFor(rows));
  assert.equal(res.created, 0);
  assert.equal((await getAll("mindmaps")).length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/mindmapsync_pull.test.js`
Expected: FAIL — `pullMindmaps` is undefined.

- [ ] **Step 3a: Add store helpers + reconcile**

In `static/offline/syncpull.js`, after `pullNotesAndReconcile` (line ~370, before the `exported` line), add:

```js
  function getAllMindmaps() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("mindmaps", "readonly").objectStore("mindmaps").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  function putMindmap(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("mindmaps", "readwrite");
      tx.objectStore("mindmaps").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function deleteMindmapRec(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("mindmaps", "readwrite");
      tx.objectStore("mindmaps").delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function ensureMindmapCid(serverId, cache) {
    if (cache[serverId]) return Promise.resolve(cache[serverId]);
    return TFidmap.cidOf("mindmap", serverId).then((cid) => {
      if (cid) { cache[serverId] = cid; return cid; }
      const fresh = TFids.newCid();
      cache[serverId] = fresh;
      return TFidmap.mapPut("mindmap", serverId, fresh).then(() => fresh);
    });
  }
  function mindmapFromServer(s, cid) {
    return {
      cid: cid, server_id: s.id,
      title: s.title != null ? s.title : "Untitled",
      data_json: s.data_json != null ? s.data_json : "",
      pinned: !!s.is_pinned, list_id: null,
      created_at: s.created_at != null ? s.created_at : null,
      updated_at: s.updated_at != null ? s.updated_at : null,
      deleted: false, dirty: 0, base_rev: s.updated_at != null ? s.updated_at : null,
    };
  }
  function writeMindmapFull(serverId, cid, fetchOne) {
    return Promise.resolve(fetchOne(serverId)).then((fullRow) => (fullRow ? putMindmap(mindmapFromServer(fullRow, cid)) : null));
  }

  // serverList = GET /api/mindmaps (metadata, no data_json). fetchOne(serverId) = GET /api/mindmaps/:id (full).
  function pullMindmaps(serverList, fetchOne) {
    const list = (serverList || []).filter((s) => s.list_id == null);
    const cache = {};
    return list.reduce((p, s) => p.then(() => ensureMindmapCid(s.id, cache)), Promise.resolve())
      .then(() => getAllMindmaps())
      .then((localAll) => {
        const byCid = {}; for (const r of localAll) byCid[r.cid] = r;
        const result = { created: 0, updated: 0, deleted: 0, skipped: 0, lwwResolved: 0, pinned: 0 };
        let chain = Promise.resolve();
        for (const s of list) {
          const cid = cache[s.id];
          const local = byCid[cid];
          chain = chain.then(() => {
            if (!local) { result.created++; return writeMindmapFull(s.id, cid, fetchOne); }
            if (local.dirty) {
              if (s.updated_at !== local.base_rev) {
                result.lwwResolved++;
                if (tsEpoch(s.updated_at) > tsEpoch(local.updated_at)) {
                  return dropOutbox("mindmap", cid).then(() => writeMindmapFull(s.id, cid, fetchOne)); // server wins
                }
                return; // local wins
              }
              result.skipped++; return;
            }
            if (s.updated_at !== local.base_rev) { result.updated++; return writeMindmapFull(s.id, cid, fetchOne); }
            return;
          });
        }
        const serverIds = new Set(list.map((s) => String(s.id)));
        for (const r of localAll) {
          if (r.server_id == null) continue;
          if (serverIds.has(String(r.server_id))) continue;
          chain = chain.then(() => {
            if (r.dirty) { result.skipped++; return; } // local-wins; push update→404→re-create
            result.deleted++;
            return deleteMindmapRec(r.cid).then(() => TFidmap.mapDelete("mindmap", r.server_id));
          });
        }
        // pin-adopt: list metadata carries is_pinned; respect a pending pin op.
        chain = chain.then(() => TFoutbox.outboxAll().then((ops) => {
          const pendingPin = new Set(ops.filter((o) => o.entity_type === "mindmap" && o.op === "pin").map((o) => o.cid));
          return getAllMindmaps().then((fresh) => {
            const freshByCid = {}; for (const r of fresh) freshByCid[r.cid] = r;
            let c2 = Promise.resolve();
            for (const s of list) {
              const cid = cache[s.id];
              const local = freshByCid[cid];
              if (!local || pendingPin.has(cid)) continue;
              if (!!local.pinned !== !!s.is_pinned) {
                c2 = c2.then(() => { result.pinned++; return putMindmap(Object.assign({}, local, { pinned: !!s.is_pinned })); });
              }
            }
            return c2;
          });
        }));
        return chain.then(() => result);
      });
  }

  function pullMindmapsAndReconcile(rawFetch) {
    const fetchOne = (sid) => Promise.resolve(rawFetch("/api/mindmaps/" + sid))
      .then((res) => (res && typeof res.json === "function" ? res.json() : res))
      .catch(() => null);
    return Promise.resolve(rawFetch("/api/mindmaps"))
      .then((res) => (res && typeof res.json === "function" ? res.json() : res))
      .then((listRows) => pullMindmaps(listRows || [], fetchOne));
  }
```

- [ ] **Step 3b: Export the new functions**

Update the `exported` object (line ~372):

```js
  const exported = { pullTasks, pullAndReconcile, pullHabits, pullHabitLogs, pullHabitsAndLogs, pullNotes, pullNotesAndReconcile, pullMindmaps, pullMindmapsAndReconcile };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/mindmapsync_pull.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `node --test tests/offline/*.test.js`
Expected: `pass` count = 268 + 4 + 5 + 7 + 7 = **291**, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add static/offline/syncpull.js tests/offline/mindmapsync_pull.test.js
git commit -m "feat(offline): pull mindmaps with lazy data_json fetch + LWW (#2g)"
```

---

### Task 5: Wire `index.html` scripts + `sync()` chain + bump SW

**Files:**
- Modify: `static/index.html` (script tags ~1343, `sync()` ~1527)
- Modify: `static/sw.js` (CACHE version line 1, STATIC precache ~31-33)

- [ ] **Step 1: Add module `<script>` tags**

In `static/index.html`, after the `drawingroutes.js` script tag (line ~1343) and BEFORE `listsync.js` / `taskroutes.js`, insert:

```html
  <script src="/static/offline/mindmaprepo.js"></script>
  <script src="/static/offline/mindmaproutes.js"></script>
```

(Load order matters in the browser: `taskroutes.js`'s `buildTaskRouter` captures `root.TF.mindmaproutes` at call time, but the require-style fallback reads the global, so `mindmaproutes.js` must be parsed before `taskroutes.js`. `mindmaprepo.js` must precede `mindmaproutes.js`.)

- [ ] **Step 2: Add mindmap pull to the `sync()` chain**

In `static/index.html`, in `function sync()`, after the `pullNotesAndReconcile` line (~1527), add:

```js
    .then(() => (window.TF.syncpull.pullMindmapsAndReconcile ? window.TF.syncpull.pullMindmapsAndReconcile(__syncRawFetch) : null))
```

The chain becomes: tasks → lists → habits → notes → **mindmaps** → push.

- [ ] **Step 3: Bump the service worker + precache the new modules**

In `static/sw.js` line 1, bump the cache name:

```js
const CACHE = "taskflow-v132-mindmaps";
```

In the STATIC precache list, after `"/static/offline/drawingroutes.js",` (line ~33), add:

```js
  "/static/offline/mindmaprepo.js",
  "/static/offline/mindmaproutes.js",
```

- [ ] **Step 4: Verify inline scripts still parse + full suite green**

Run (PowerShell): extract is unnecessary — just confirm the Node suite is unaffected and the file has no obvious syntax break:

```bash
node --test tests/offline/*.test.js
```
Expected: `pass 291`, `fail 0`.

Then sanity-check the two index.html edits landed:

Run: `node -e "const s=require('fs').readFileSync('static/index.html','utf8'); console.log(/mindmaprepo\.js/.test(s), /mindmaproutes\.js/.test(s), /pullMindmapsAndReconcile/.test(s));"`
Expected: `true true true`

- [ ] **Step 5: Commit**

```bash
git add static/index.html static/sw.js
git commit -m "feat(offline): load mindmap modules + pull in sync() + SW v132 (#2g)"
```

---

### Task 6: Retire legacy `tf_mindmap_pending_*` / `tf_mindmap_list` localStorage in `MindmapPage`

**Files:**
- Modify: `static/index.html` (MindmapPage, ~8073-8343)

**Rationale:** With the local-first intercept (Tasks 2 + 5), `api.get/post/put/patch/del` for mindmaps always resolve against IndexedDB and never fail offline. The old PWA offline mechanism (`tf_mindmap_pending_${id}` + `tf_mindmap_list` + the `!navigator.onLine` early-return + the `online`-flush effect) is now redundant — mirror the `draw_pending` retirement from #2f-3.

- [ ] **Step 1: Simplify the list-load effect**

In `static/index.html`, replace the mount list-load effect (~8073-8084):

```js
  // Load list on mount
  useEffect(() => {
    api.get("/api/mindmaps").then(data => {
      setMindmaps(data || []);
      try {
        localStorage.setItem("tf_mindmap_list", JSON.stringify(data || []));
      } catch (_) {}
    }).catch(() => {
      const cached = JSON.parse(localStorage.getItem("tf_mindmap_list") || "[]");
      setMindmaps(cached);
    }).finally(() => setLoading(false));
  }, []);
```

with:

```js
  // Load list on mount (local-first: api.get resolves from IndexedDB via intercept)
  useEffect(() => {
    api.get("/api/mindmaps")
      .then(data => setMindmaps(data || []))
      .catch(() => setMindmaps([]))
      .finally(() => setLoading(false));
  }, []);
```

- [ ] **Step 2: Use `selected.data_json` directly in the "send data to iframe" effect**

Replace (~8112-8122):

```js
    const pending = localStorage.getItem(`tf_mindmap_pending_${selected.id}`);
    const dataStr = pending || selected.data_json;
    const sendLoad = () => {
      try {
        const data = JSON.parse(dataStr);
        iframeRef.current?.contentWindow?.postMessage({
          type: "load",
          data
        }, window.location.origin);
        if (pending) setSyncStatus("offline");
      } catch (_) {}
    };
```

with:

```js
    const dataStr = selected.data_json;
    const sendLoad = () => {
      try {
        const data = JSON.parse(dataStr);
        iframeRef.current?.contentWindow?.postMessage({
          type: "load",
          data
        }, window.location.origin);
      } catch (_) {}
    };
```

- [ ] **Step 3: Use `selected.data_json` directly in the iframe `ready` handler**

Replace (~8166-8177):

```js
      if (e.data && e.data.type === "ready" && selected) {
        const pending = localStorage.getItem(`tf_mindmap_pending_${selected.id}`);
        const dataStr = pending || selected.data_json;
        try {
          const data = JSON.parse(dataStr);
          iframeRef.current?.contentWindow?.postMessage({
            type: "load",
            data
          }, window.location.origin);
          if (pending) setSyncStatus("offline");
        } catch (_) {}
      }
```

with:

```js
      if (e.data && e.data.type === "ready" && selected) {
        try {
          const data = JSON.parse(selected.data_json);
          iframeRef.current?.contentWindow?.postMessage({
            type: "load",
            data
          }, window.location.origin);
        } catch (_) {}
      }
```

- [ ] **Step 4: Simplify the `change` autosave handler (always go through intercept)**

Replace (~8201-8223):

```js
      if (e.data && e.data.type === "change" && selected) {
        const dataStr = JSON.stringify(e.data.data);
        const mid = selected.id;
        try {
          localStorage.setItem(`tf_mindmap_pending_${mid}`, dataStr);
        } catch (_) {}
        if (!navigator.onLine) {
          setSyncStatus("offline");
          return;
        }
        setSyncStatus("saving");
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          api.put(`/api/mindmaps/${mid}`, {
            data_json: dataStr
          }).then(() => {
            setSyncStatus("saved");
            try {
              localStorage.removeItem(`tf_mindmap_pending_${mid}`);
            } catch (_) {}
          }).catch(() => setSyncStatus("offline"));
        }, 1000);
      }
```

with:

```js
      if (e.data && e.data.type === "change" && selected) {
        const dataStr = JSON.stringify(e.data.data);
        const mid = selected.id;
        setSyncStatus("saving");
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          api.put(`/api/mindmaps/${mid}`, {
            data_json: dataStr
          }).then(() => setSyncStatus("saved"))
            .catch(() => setSyncStatus("offline"));
        }, 1000);
      }
```

- [ ] **Step 5: Remove the `online`-flush effect entirely**

Delete the whole effect (~8229-8247):

```js
  // Flush pending on reconnect
  useEffect(() => {
    const handler = () => {
      if (!selected) return;
      const pending = localStorage.getItem(`tf_mindmap_pending_${selected.id}`);
      if (pending) {
        api.put(`/api/mindmaps/${selected.id}`, {
          data_json: pending
        }).then(() => {
          setSyncStatus("saved");
          try {
            localStorage.removeItem(`tf_mindmap_pending_${selected.id}`);
          } catch (_) {}
        }).catch(() => {});
      }
    };
    window.addEventListener("online", handler);
    return () => window.removeEventListener("online", handler);
  }, [selected?.id]);
```

(Sync now handles offline→online reconciliation globally via `sync()` on the `online` event; per-mindmap flushing is obsolete.)

- [ ] **Step 6: Remove the remaining `tf_mindmap_list` writes in create/delete/pin handlers**

In `handleCreate` (~8276-8282), replace:

```js
      setMindmaps(prev => {
        const next = [created, ...prev];
        try {
          localStorage.setItem("tf_mindmap_list", JSON.stringify(next));
        } catch (_) {}
        return next;
      });
```

with:

```js
      setMindmaps(prev => [created, ...prev]);
```

In `handleDelete` (~8315-8320), replace:

```js
      const next = mindmaps.filter(m => m.id !== selected.id);
      setMindmaps(next);
      try {
        localStorage.setItem("tf_mindmap_list", JSON.stringify(next));
      } catch (_) {}
```

with:

```js
      setMindmaps(mindmaps.filter(m => m.id !== selected.id));
```

In `handlePin` (~8330-8338), replace:

```js
      setMindmaps(prev => {
        const next = prev.map(x => x.id === updated.id ? {
          ...x,
          is_pinned: updated.is_pinned
        } : x).sort((a, b) => b.is_pinned - a.is_pinned || new Date(b.updated_at) - new Date(a.updated_at));
        try {
          localStorage.setItem("tf_mindmap_list", JSON.stringify(next));
        } catch (_) {}
        return next;
      });
```

with:

```js
      setMindmaps(prev => prev.map(x => x.id === updated.id ? {
        ...x,
        is_pinned: updated.is_pinned
      } : x).sort((a, b) => b.is_pinned - a.is_pinned || new Date(b.updated_at) - new Date(a.updated_at)));
```

- [ ] **Step 7: Verify all legacy refs are gone + inline scripts parse**

Run: `node -e "const s=require('fs').readFileSync('static/index.html','utf8'); const hits=(s.match(/tf_mindmap_pending|tf_mindmap_list/g)||[]); console.log('legacy refs:', hits.length);"`
Expected: `legacy refs: 0`

Run the full offline suite (unchanged by this UI-only task): `node --test tests/offline/*.test.js`
Expected: `pass 291`, `fail 0`.

- [ ] **Step 8: Commit**

```bash
git add static/index.html
git commit -m "refactor(offline): retire tf_mindmap_pending/list localStorage (local-first intercept) (#2g)"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** §1 record shape → Task 1; §2 repo → Task 1; §3 routes + not-intercepted share/list → Task 2; §4 push handlers (create/update-404-recreate/delete/pin conditional) → Task 3; §5 pull (new/changed/dirty-skip/delete/pin-adopt + lazy fetchOne) → Task 4; §6 wiring + retire localStorage + SW → Tasks 5 & 6; §7 backend zero changes (no task needed); §8 tests → each task.
- **Server field name:** pull/pin handlers read `is_pinned` (server), local record uses `pinned`. Consistent across Tasks 1–4.
- **No DB bump:** `mindmaps` store pre-exists in db.js v3 — no migration task.
- **Type consistency:** `entity_type === "mindmap"` and idmap `type "mindmap"` used uniformly in Tasks 1, 3, 4. Mappers `mindmapToCreatePayload`/`mindmapToUpdatePayload` defined and exported in Task 3, consumed only there.
- **Final expected suite count:** 291 (268 baseline + 23 new). Exact number may shift slightly if a test is split during TDD — trust `fail 0`, not the precise total.
