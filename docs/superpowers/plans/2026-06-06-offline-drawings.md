# Offline Drawings (#2f-3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bawa tldraw drawings (1 per note) ke local-first — edit offline tersimpan via BlobStore + outbox, buka kembali offline (lazy read-through), push ke server saat online — dan ganti mekanisme localStorage ad-hoc.

**Architecture:** `data_json` disimpan via `BlobStore` (impl IndexedDB; record drawing kecil menyimpan `blob_ref`). GET/PUT `/api/drawings/:id` di-intercept ke `drawingrepo`. GET = lazy read-through (lokal → bila online & cache-miss/stale fetch+cache, LWW by `updated_at`). PUT = lokal + outbox. Push: `opDrawingUpsert` PUT ke `/api/drawings/{note_server_id}` (hold bila note belum ter-push). Backend nol perubahan.

**Tech Stack:** Vanilla JS UMD modules, IndexedDB + BlobStore (`fake-indexeddb` di Node test), `node:test`. Spec: `docs/superpowers/specs/2026-06-06-offline-drawings-design.md`.

---

## Konteks kunci (baca sebelum mulai)

- Store `drawings` di-key `cid`, index `note_cid` (non-unik; 1 drawing/note). Drawing lokal: `{cid, note_cid, blob_ref, updated_at, deleted, dirty, base_rev}`.
- `blobstore.js`: `makeBlobStore()` → `{kind, put(bytes,meta)→Promise<ref>, getBytes(ref)→Promise<bytes>, getURL(ref), delete(ref)}`. Impl IndexedDB menyimpan `{id, mime, bytes}` di store `blobs`. `put` menyimpan `bytes` apa adanya (string OK); `getBytes` mengembalikannya. `getURL` (pakai Blob/URL) TIDAK dipakai di sini → aman di Node.
- `idmap.serverIdOf(cid)` 1-arg (global by cid). Notes pakai idmap type `"note"`.
- `outbox`: `outboxAdd`, `outboxByEntity(type,cid)`, `outboxRemove`, `outboxAll`.
- Router: `R.register(method,pattern,handler)`, `R.dispatch(method,path,body)`, `R.hasRoute`. `buildTaskRouter()` di `taskroutes.js` memanggil `registerHabitRoutes` + `registerNoteRoutes` di akhir; tambah `registerDrawingRoutes(router)`.
- `noteroutes.js` punya pola `resolveNoteCid(idOrCid)` (notes store: cid langsung lalu server_id) — drawingroutes butuh hal sama.
- `syncpush.js`: `send`/`ok`/`processOp(op,transport,tagsFor,habitTagsFor,result)` + fall-through `outboxRemove`. Requires `TFdb/TFids?/TFoutbox/TFidmap/TFtag` — tambah `TFblob`.
- Server: `GET /api/drawings/{note_id}` → `{data_json, updated_at}` (404 bila note tak ada / drawing belum ada); `PUT /api/drawings/{note_id}` body `{data_json}` → `{updated_at}` (403 non-owner, 404 note hilang).
- Drawing React: **2 `useEffect`** (NoteModal canvas ≈`index.html:15051`, fullscreen ≈`16753`). Region ≈8106 = MINDMAP (bukan drawing — jangan sentuh).

## File yang disentuh

- **Create** `static/offline/drawingrepo.js`, `static/offline/drawingroutes.js`
- **Create** `tests/offline/drawingrepo.test.js`, `tests/offline/drawingroutes.test.js`
- **Modify** `static/offline/taskroutes.js` (registerDrawingRoutes), `static/offline/syncpush.js` (opDrawingUpsert), `tests/offline/syncpush.test.js`
- **Modify** `static/index.html` (load modul + configure fetcher + rewire 2 drawing useEffect), `static/sw.js` (v129 + precache)

---

## Task 1: drawingrepo — putDrawing + getDrawingLocal (BlobStore)

**Files:** Create `static/offline/drawingrepo.js`; Test `tests/offline/drawingrepo.test.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/offline/drawingrepo.test.js`:

```javascript
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const { putDrawing, getDrawingLocal } = require("../../static/offline/drawingrepo.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function allBlobs() {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("blobs").objectStore("blobs").getAll(); q.onsuccess = () => res(q.result || []); });
}

test("putDrawing stores data_json in BlobStore, records outbox upsert, sets dirty 1", async () => {
  const rec = await putDrawing("note1", '{"shapes":1}', { now: "2026-06-06T00:00:00Z" });
  assert.equal(rec.note_cid, "note1");
  assert.ok(rec.blob_ref);
  assert.equal(rec.dirty, 1);
  assert.equal(rec.updated_at, "2026-06-06T00:00:00Z");
  const local = await getDrawingLocal("note1");
  assert.equal(local.cid, rec.cid);
  const blobs = await allBlobs();
  assert.equal(blobs.length, 1);
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "upsert");
  assert.equal(ops[0].entity_type, "drawing");
  assert.deepEqual(ops[0].payload, { note_cid: "note1" });
});

test("putDrawing overwrite reuses cid, deletes the old blob, dedupes the outbox op", async () => {
  const r1 = await putDrawing("note1", "v1", {});
  const r2 = await putDrawing("note1", "v2", {});
  assert.equal(r2.cid, r1.cid);
  const blobs = await allBlobs();
  assert.equal(blobs.length, 1); // old blob deleted
  const ops = (await outboxAll()).filter((o) => o.entity_type === "drawing");
  assert.equal(ops.length, 1); // deduped — single pending upsert
});

test("getDrawingLocal returns null for an unknown note", async () => {
  assert.equal(await getDrawingLocal("nope"), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/drawingrepo.test.js`
Expected: FAIL — `Cannot find module ... drawingrepo.js`.

- [ ] **Step 3: Write minimal implementation**

Create `static/offline/drawingrepo.js`:

```javascript
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
  const TFblob = req("./blobstore.js", root.TF && root.TF.blobstore);

  const BlobStore = TFblob.makeBlobStore();
  let _fetcher = null;

  function tsEpoch(ts) {
    if (ts == null) return 0;
    const s = String(ts);
    const hasTz = /[zZ]|[+-]\d\d:?\d\d$/.test(s);
    const v = Date.parse(hasTz ? s : s + "Z");
    return isNaN(v) ? 0 : v;
  }
  function getByNoteCid(noteCid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("drawings", "readonly").objectStore("drawings").index("note_cid").get(noteCid);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    }));
  }
  function putRec(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("drawings", "readwrite");
      tx.objectStore("drawings").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function _store(noteCid, dataJson, updatedAt, dirty, baseRev, existing) {
    const oldRef = existing && existing.blob_ref;
    return BlobStore.put(dataJson, { mime: "application/json" }).then((ref) => {
      const rec = {
        cid: existing ? existing.cid : TFids.newCid(),
        note_cid: noteCid, blob_ref: ref, updated_at: updatedAt,
        deleted: false, dirty: dirty, base_rev: baseRev,
      };
      return putRec(rec)
        .then(() => (oldRef && oldRef !== ref ? BlobStore.delete(oldRef) : null))
        .then(() => rec);
    });
  }

  function putDrawing(noteCid, dataJson, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    return getByNoteCid(noteCid).then((existing) =>
      _store(noteCid, dataJson, now, 1, existing ? existing.base_rev : null, existing).then((rec) =>
        TFoutbox.outboxByEntity("drawing", rec.cid).then((ops) => {
          if (ops.some((o) => o.op === "upsert")) return rec; // dedupe: one pending upsert per drawing
          return TFoutbox.outboxAdd({ op: "upsert", entity_type: "drawing", cid: rec.cid, payload: { note_cid: noteCid } }).then(() => rec);
        })));
  }

  function getDrawingLocal(noteCid) {
    return getByNoteCid(noteCid).then((rec) => (rec && !rec.deleted ? rec : null));
  }

  const exported = { putDrawing, getDrawingLocal, _BlobStore: BlobStore };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.drawingrepo = exported; }
  return exported;
});
```

(`tsEpoch` + `_fetcher` are unused until Task 2 — keep them; they're wired there.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/drawingrepo.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add static/offline/drawingrepo.js tests/offline/drawingrepo.test.js
git commit -m "feat(offline): drawingrepo putDrawing + getDrawingLocal via BlobStore (#2f-3)"
```

---

## Task 2: drawingrepo — cacheServerDrawing + getDrawing (read-through)

**Files:** Modify `static/offline/drawingrepo.js`; Test `tests/offline/drawingrepo.test.js`.

- [ ] **Step 1: Write the failing test**

Append to `tests/offline/drawingrepo.test.js`:

```javascript
const { cacheServerDrawing, getDrawing } = require("../../static/offline/drawingrepo.js");

test("cacheServerDrawing stores a clean drawing (dirty 0, base_rev=updated_at)", async () => {
  const rec = await cacheServerDrawing("note1", '{"s":2}', "2026-06-05T00:00:00");
  assert.equal(rec.dirty, 0);
  assert.equal(rec.base_rev, "2026-06-05T00:00:00");
  assert.equal((await getDrawingLocal("note1")).blob_ref, rec.blob_ref);
});

test("getDrawing returns the local data_json when present (no fetch)", async () => {
  await putDrawing("note1", '{"local":1}', {});
  let fetched = false;
  const out = await getDrawing("note1", { online: true, fetch: () => { fetched = true; return Promise.resolve(null); } });
  // local is dirty → fetch may run but must NOT overwrite; returns local bytes
  assert.equal(out.data_json, '{"local":1}');
});

test("getDrawing fetches + caches on a local miss when online", async () => {
  const out = await getDrawing("note1", { online: true, fetch: () => Promise.resolve({ data_json: '{"srv":1}', updated_at: "2026-06-05T00:00:00" }) });
  assert.equal(out.data_json, '{"srv":1}');
  assert.equal((await getDrawingLocal("note1")).dirty, 0);
});

test("getDrawing LWW: adopts a newer server drawing over a clean local one", async () => {
  await cacheServerDrawing("note1", '{"old":1}', "2026-06-01T00:00:00");
  const out = await getDrawing("note1", { online: true, fetch: () => Promise.resolve({ data_json: '{"new":1}', updated_at: "2026-06-09T00:00:00" }) });
  assert.equal(out.data_json, '{"new":1}');
});

test("getDrawing keeps a dirty local drawing even if server is newer", async () => {
  await putDrawing("note1", '{"localedit":1}', { now: "2026-06-02T00:00:00" }); // dirty:1
  const out = await getDrawing("note1", { online: true, fetch: () => Promise.resolve({ data_json: '{"srv":1}', updated_at: "2026-06-09T00:00:00" }) });
  assert.equal(out.data_json, '{"localedit":1}');
});

test("getDrawing returns null on offline miss", async () => {
  const out = await getDrawing("note1", { online: false, fetch: () => Promise.reject(new Error("no net")) });
  assert.equal(out, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/drawingrepo.test.js`
Expected: FAIL — `cacheServerDrawing is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `static/offline/drawingrepo.js`, add before the `exported` line:

```javascript
  function cacheServerDrawing(noteCid, dataJson, updatedAt) {
    return getByNoteCid(noteCid).then((existing) =>
      _store(noteCid, dataJson, updatedAt, 0, updatedAt, existing));
  }

  function getDrawing(noteCid, opts) {
    opts = opts || {};
    const fetcher = opts.fetch || _fetcher;
    const online = opts.online != null ? opts.online : true;
    return getDrawingLocal(noteCid).then((local) => {
      const refreshP = (fetcher && online)
        ? Promise.resolve(fetcher(noteCid)).then((srv) => {
            if (!srv || srv.data_json == null) return;
            if (!local || (local.dirty === 0 && tsEpoch(srv.updated_at) > tsEpoch(local.base_rev))) {
              return cacheServerDrawing(noteCid, srv.data_json, srv.updated_at);
            }
          }).catch(() => {})
        : Promise.resolve();
      return refreshP.then(() => getDrawingLocal(noteCid)).then((rec) => {
        if (!rec) return null;
        return Promise.resolve(BlobStore.getBytes(rec.blob_ref)).then((bytes) => ({ data_json: bytes, updated_at: rec.updated_at }));
      });
    });
  }

  function configureFetcher(fn) { _fetcher = fn; }
```

Update the `exported` line:

```javascript
  const exported = { putDrawing, getDrawingLocal, cacheServerDrawing, getDrawing, configureFetcher, _BlobStore: BlobStore };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/drawingrepo.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add static/offline/drawingrepo.js tests/offline/drawingrepo.test.js
git commit -m "feat(offline): drawingrepo cacheServerDrawing + getDrawing read-through (#2f-3)"
```

---

## Task 3: drawingroutes + wire into buildTaskRouter

**Files:** Create `static/offline/drawingroutes.js`; Modify `static/offline/taskroutes.js`; Test `tests/offline/drawingroutes.test.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/offline/drawingroutes.test.js`:

```javascript
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function putNote(rec) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("scratchpad_notes", "readwrite");
    tx.objectStore("scratchpad_notes").put(rec);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
function note(over) {
  return Object.assign({ cid: over.cid, server_id: null, title: "N", content: "", linked_task_cids: "[]", linked_to_cids: "[]", pinned: false, list_id: null, deleted: false, dirty: 0 }, over);
}

test("PUT then GET /api/drawings/:id round-trips via the router (by cid)", async () => {
  await putNote(note({ cid: "ncid" }));
  const R = buildTaskRouter();
  const put = await R.dispatch("PUT", "/api/drawings/ncid", { data_json: '{"a":1}' });
  assert.ok(put.updated_at);
  const got = await R.dispatch("GET", "/api/drawings/ncid", undefined);
  assert.equal(got.data_json, '{"a":1}');
});

test("GET /api/drawings/:id resolves a note by server_id", async () => {
  await putNote(note({ cid: "ncid", server_id: 42 }));
  const R = buildTaskRouter();
  await R.dispatch("PUT", "/api/drawings/ncid", { data_json: '{"b":2}' });
  const got = await R.dispatch("GET", "/api/drawings/42", undefined);
  assert.equal(got.data_json, '{"b":2}');
});

test("GET /api/drawings/:id rejects when there is no local drawing (offline miss)", async () => {
  await putNote(note({ cid: "ncid" }));
  const R = buildTaskRouter();
  await assert.rejects(() => R.dispatch("GET", "/api/drawings/ncid", undefined));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/drawingroutes.test.js`
Expected: FAIL — drawings routes not registered (no local route / `Cannot find module`).

- [ ] **Step 3: Write minimal implementation**

Create `static/offline/drawingroutes.js`:

```javascript
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
  const TFrepo = req("./drawingrepo.js", root.TF && root.TF.drawingrepo);

  function allNotes() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("scratchpad_notes", "readonly").objectStore("scratchpad_notes").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  function resolveNoteCid(idOrCid) {
    return allNotes().then((all) => {
      for (const n of all) if (n.cid === idOrCid) return n.cid;
      for (const n of all) if (n.server_id != null && String(n.server_id) === String(idOrCid)) return n.cid;
      return null;
    });
  }
  function notFound() { return Promise.reject(new Error("Drawing not found")); }
  const onlineNow = () => (typeof navigator !== "undefined" ? navigator.onLine : true);

  function registerDrawingRoutes(router) {
    router.register("GET", "/api/drawings/:id", ({ params }) =>
      resolveNoteCid(params.id).then((cid) => (cid ? TFrepo.getDrawing(cid, { online: onlineNow() }) : null))
        .then((d) => (d ? d : notFound())));
    router.register("PUT", "/api/drawings/:id", ({ params, body }) =>
      resolveNoteCid(params.id).then((cid) => (cid ? TFrepo.putDrawing(cid, (body || {}).data_json, {}).then((rec) => ({ updated_at: rec.updated_at })) : notFound())));
  }

  const exported = { registerDrawingRoutes };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.drawingroutes = exported; }
  return exported;
});
```

In `static/offline/taskroutes.js`: add the require near the other route requires (after the `TFnoteroutes` require):

```javascript
  const TFdrawingroutes = req("./drawingroutes.js", root.TF && root.TF.drawingroutes);
```

And inside `buildTaskRouter`, right after `TFnoteroutes.registerNoteRoutes(router);`:

```javascript
    TFdrawingroutes.registerDrawingRoutes(router);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/drawingroutes.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full offline suite (no regressions)**

Run: `node --test tests/offline/*.test.js`
Expected: `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add static/offline/drawingroutes.js static/offline/taskroutes.js tests/offline/drawingroutes.test.js
git commit -m "feat(offline): drawingroutes registered on the LocalRouter (#2f-3)"
```

---

## Task 4: syncpush — opDrawingUpsert

**Files:** Modify `static/offline/syncpush.js`; Test `tests/offline/syncpush.test.js`.

- [ ] **Step 1: Write the failing test**

Append to `tests/offline/syncpush.test.js`:

```javascript
const { putDrawing: _putDrawing } = require("../../static/offline/drawingrepo.js");
const { mapPut: _mapPutD } = require("../../static/offline/idmap.js");

async function getDrawingRow(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("drawings").objectStore("drawings").get(cid); q.onsuccess = () => res(q.result); });
}

test("pushOutbox drawing upsert holds the op when the note is not yet pushed", async () => {
  const rec = await _putDrawing("ncid", '{"x":1}', {}); // creates outbox op too
  const tr = fakeTransport(() => { throw new Error("should not call without note server_id"); });
  const r = await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);
  assert.equal(r.remaining, 1); // op held
});

test("pushOutbox drawing upsert PUTs to /api/drawings/{noteSid}, sets dirty 0 + base_rev", async () => {
  const rec = await _putDrawing("ncid", '{"x":1}', {});
  await _mapPutD("note", 70, "ncid"); // note now has a server id
  const tr = fakeTransport(() => ({ status: 200, data: { updated_at: "2026-06-06T12:00:00" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[0].method, "PUT");
  assert.equal(tr.calls[0].path, "/api/drawings/70");
  assert.equal(tr.calls[0].body.data_json, '{"x":1}');
  const row = await getDrawingRow(rec.cid);
  assert.equal(row.dirty, 0);
  assert.equal(row.base_rev, "2026-06-06T12:00:00");
  assert.equal(r.remaining, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/syncpush.test.js`
Expected: FAIL — drawing op hits the fall-through and is removed (test 1: `remaining` 0 not 1; test 2: no PUT).

- [ ] **Step 3: Write minimal implementation**

In `static/offline/syncpush.js`, add the `TFblob` require near the other requires:

```javascript
  const TFblob = req("./blobstore.js", root.TF && root.TF.blobstore);
```

Add a BlobStore instance + drawing store helpers near the other store helpers:

```javascript
  const _BlobStore = TFblob.makeBlobStore();
  function getDrawingRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("drawings", "readonly").objectStore("drawings").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function putDrawingRaw(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("drawings", "readwrite");
      tx.objectStore("drawings").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
```

Add the handler after the note handlers:

```javascript
  function opDrawingUpsert(op, transport, result) {
    return getDrawingRaw(op.cid).then((rec) => {
      if (!rec) return TFoutbox.outboxRemove(op.qid);
      return TFidmap.serverIdOf(rec.note_cid).then((noteSid) => {
        if (noteSid == null) return; // hold: note not pushed yet (FIFO → note create runs first; retry next drain)
        return Promise.resolve(_BlobStore.getBytes(rec.blob_ref)).then((dataJson) =>
          send(transport, "PUT", "/api/drawings/" + noteSid, { data_json: dataJson }).then((res) => {
            if (ok(res)) {
              return putDrawingRaw(Object.assign({}, rec, { dirty: 0, base_rev: res.data && res.data.updated_at != null ? res.data.updated_at : rec.base_rev }))
                .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; });
            }
            result.failed++;
            return TFoutbox.outboxRemove(op.qid);
          }));
      });
    });
  }
```

Add dispatch in `processOp` before the fall-through `return TFoutbox.outboxRemove(op.qid);`:

```javascript
    if (op.entity_type === "drawing" && op.op === "upsert") return opDrawingUpsert(op, transport, result);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/syncpush.test.js`
Expected: PASS, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add static/offline/syncpush.js tests/offline/syncpush.test.js
git commit -m "feat(offline): push drawing upsert (hold-if-note-unsynced) (#2f-3)"
```

---

## Task 5: Load modules + configure fetcher in index.html

**Files:** Modify `static/index.html`.

- [ ] **Step 1: Load the 2 drawing modules**

In `static/index.html`, in the offline `<script src>` block, add after the `noteroutes.js` line and before `listsync.js`:

```html
  <script src="/static/offline/drawingrepo.js"></script>
  <script src="/static/offline/drawingroutes.js"></script>
```

(`drawingroutes` requires `drawingrepo`; both must load before `taskroutes.js`.)

- [ ] **Step 2: Configure the read-through fetcher at boot**

Find where `__syncRawFetch` is defined (≈`index.html:1509`). Right after it, add:

```javascript
if (window.TF && window.TF.drawingrepo && window.TF.idmap) {
  window.TF.drawingrepo.configureFetcher((noteCid) =>
    window.TF.idmap.serverIdOf(noteCid).then((sid) =>
      (sid == null ? null : __syncRawFetch("/api/drawings/" + sid).then((r) => (r.ok ? r.json() : null)))));
}
```

- [ ] **Step 3: Syntax-check inline scripts**

Run (PowerShell, root repo):

```powershell
node -e "const fs=require('fs');const h=fs.readFileSync('static/index.html','utf8');const m=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)];let i=0,err=0;for(const x of m){try{new Function(x[1]);}catch(e){console.log('SCRIPT',i,'ERR',e.message);err++;}i++;}console.log('checked',m.length,'inline scripts, errors:',err);"
```

Expected: `errors: 0`.

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "feat(offline): load drawing modules + configure read-through fetcher (#2f-3)"
```

---

## Task 6: Bump service worker cache

**Files:** Modify `static/sw.js`.

- [ ] **Step 1: Bump CACHE + precache**

In `static/sw.js` line 1, change:

```javascript
const CACHE = "taskflow-v128-notes-sync";
```
to:
```javascript
const CACHE = "taskflow-v129-drawings";
```

In the `STATIC` array, add after the `noteroutes.js` line:

```javascript
  "/static/offline/drawingrepo.js",
  "/static/offline/drawingroutes.js",
```

- [ ] **Step 2: Commit**

```bash
git add static/sw.js
git commit -m "chore(sw): bump cache v129 + precache drawing modules (#2f-3)"
```

---

## Task 7: Rewire the drawing React components (browser)

**Files:** Modify `static/index.html` (two drawing `useEffect`s: ≈`15051` and ≈`16753`).

The current pattern (both components) does: `api.get` then `localStorage.getItem` fallback; on iframe `change` → `localStorage.setItem` + `if(!navigator.onLine){setStatus('offline');return;}` + `api.put`; plus an `online` handler that flushes localStorage. With the routes intercepted, `api.get`/`api.put` are local-first (offline-safe) — so the localStorage machinery + offline guard must go.

- [ ] **Step 1: Rewire the NoteModal canvas effect (≈`index.html:15051`)**

Replace the open-fetch (the `api.get(\`/api/drawings/${note.id}\`)...` block at ≈15057-15067) with:

```javascript
      api.get(`/api/drawings/${note.id}`).then(data => {
        setDrawPendingData(data.data_json);
      }).catch(() => { setDrawPendingData(null); });
```

Replace the iframe `change` branch (≈15072-15089) with (always persist via api; intercept handles offline + outbox):

```javascript
      if (e.data?.type === 'change' && e.data.data && note?.id) {
        setDrawSyncStatus(navigator.onLine ? 'saving' : 'offline');
        api.put(`/api/drawings/${note.id}`, { data_json: e.data.data })
          .then(() => setDrawSyncStatus(navigator.onLine ? 'saved' : 'offline'))
          .catch(() => setDrawSyncStatus('offline'));
      }
```

Remove the `_lsKey` const (≈15056) and the entire `onlineHandler` + its `addEventListener('online', ...)` / `removeEventListener('online', ...)` (≈15092-15110, keep the `message` listener add/remove). The cleanup should only remove the `message` listener.

- [ ] **Step 2: Rewire the fullscreen canvas effect (≈`index.html:16753`)**

Apply the same three changes to the second component (state setters are `setPendingDrawData` / `setSyncStatus`, key var `_lsKeyModal`, ref `iframeRef`):

Open-fetch (≈16754-16764) becomes:

```javascript
    api.get(`/api/drawings/${note.id}`).then(data => {
      setPendingDrawData(data.data_json);
    }).catch(() => { setPendingDrawData(null); });
```

`change` branch (≈16770-16787) becomes:

```javascript
      if (e.data?.type === 'change' && e.data.data) {
        setSyncStatus(navigator.onLine ? 'saving' : 'offline');
        api.put(`/api/drawings/${note.id}`, { data_json: e.data.data })
          .then(() => setSyncStatus(navigator.onLine ? 'saved' : 'offline'))
          .catch(() => setSyncStatus('offline'));
      }
```

Remove the `_lsKeyModal` const and the `onlineHandler` + its add/remove listeners; keep the `message` listener.

- [ ] **Step 3: Syntax-check inline scripts**

Run (PowerShell, root repo):

```powershell
node -e "const fs=require('fs');const h=fs.readFileSync('static/index.html','utf8');const m=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)];let i=0,err=0;for(const x of m){try{new Function(x[1]);}catch(e){console.log('SCRIPT',i,'ERR',e.message);err++;}i++;}console.log('checked',m.length,'inline scripts, errors:',err);"
```

Expected: `errors: 0`. Also grep to confirm no stray drawing localStorage remains:

```bash
grep -nE "draw_pending|_lsKey|_lsKeyModal" static/index.html
```

Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "refactor(offline): drawing components use api.* (retire draw_pending localStorage) (#2f-3)"
```

---

## Task 8: Full suite + deploy + browser verify

- [ ] **Step 1: Run the whole offline suite**

Run (root repo Z:): `node --test tests/offline/*.test.js`
Expected: `fail 0`; pass = 254 + new drawing tests (target ~270+).

- [ ] **Step 2: Merge ff to main + push**

```bash
git checkout main
git merge --ff-only <branch>
git push origin main
```
(Skip if working directly on `main`.)

- [ ] **Step 3: Verify deploy (backend unchanged — no taskflow-web restart)**

Run: `curl -s https://todo.yatno.web.id/sw.js | findstr CACHE`
Expected: `const CACHE = "taskflow-v129-drawings";`.

- [ ] **Step 4: Browser verify (reset SW first in the login tab)**

In DevTools console (https://todo.yatno.web.id), unregister SW + clear caches + reload, then:
1. Open a note's canvas online, draw something → it saves (status 'saved'); reload → drawing persists.
2. Go offline (DevTools Network → Offline), draw more → status 'offline', no error; reload offline → drawing still loads from local (BlobStore).
3. Back online → `window.__syncNow()` (or wait for auto push) → drawing PUT to server (verify via another web session / raw GET).
4. Draw on the web in another session → open that note's canvas on this device → read-through fetches + shows it.
5. Confirm `localStorage` has no `draw_pending_*` keys; notes/tasks/habits still work; no console errors.

Record result (e.g. "5/5 ✅") for the [[project_offline_native]] memory update.

---

## Self-review notes

- **Spec coverage:** putDrawing+getDrawingLocal+BlobStore (T1); cacheServerDrawing+getDrawing read-through+LWW (T2); drawingroutes GET/PUT + buildTaskRouter wire (T3); opDrawingUpsert hold-if-unsynced (T4); load modules+configure fetcher (T5); SW v129 (T6); React rewiring retire localStorage (T7); suite+deploy+browser (T8). All spec sections covered.
- **No backend change:** confirmed — GET/PUT /api/drawings predate this slice; lazy read-through, no bulk endpoint.
- **Type/name consistency:** `putDrawing/getDrawingLocal/cacheServerDrawing/getDrawing/configureFetcher` (drawingrepo); `registerDrawingRoutes/resolveNoteCid` (drawingroutes); `opDrawingUpsert/getDrawingRaw/putDrawingRaw/_BlobStore` (syncpush). Record fields `note_cid`/`blob_ref`/`updated_at`/`dirty`/`base_rev` consistent. Outbox op `{op:'upsert',entity_type:'drawing',cid,payload:{note_cid}}`.
- **BlobStore in Node:** `put`/`getBytes`/`delete` use only the `blobs` IndexedDB store (no `getURL`/Blob/URL), so `fake-indexeddb` covers them. `put` stores the string as-is; `getBytes` returns it.
- **Hold-op safety:** `opDrawingUpsert` returns the `getDrawingRaw().then(...)` promise; the `noteSid==null → return;` resolves that chain (does NOT break `processOp`'s `.catch`). Op left in outbox, retried next drain.
- **Outbox dedupe:** `putDrawing` adds at most one pending `upsert` op per drawing cid (rapid tldraw edits won't flood the outbox; push re-reads the latest blob).
- **React rewiring (T7) is browser-only** (not Node-testable) — isolated as the final code task before verification; the grep in T7 Step 3 guards against leftover localStorage.
