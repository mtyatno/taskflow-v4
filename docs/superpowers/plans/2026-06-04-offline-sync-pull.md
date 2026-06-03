# Offline Sync — Pull Engine Implementation Plan (#2b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull server-side task changes (from bot / web / other devices) into the local store via client-only full-list reconcile — detecting remote create/update/delete while leaving locally-dirty records untouched.

**Architecture:** A new Node-tested module `static/offline/syncpull.js` with `pullTasks(serverList)` (two-pass reconcile reusing `hydrate.taskFromServer`) + `pullAndReconcile(rawFetch)`. A small `syncpush.js` touch-up records `base_rev` on push success so the reconcile's `updated_at` comparison is precise. Then browser-verified wiring in `static/index.html` (`sync()` = push→pull on boot/online/manual, replacing the old hydration boot call) and `static/sw.js` (precache + cache bump).

**Tech Stack:** Vanilla ES2017 JS, IndexedDB, `node:test`, `fake-indexeddb`. No backend changes, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-04-offline-sync-pull-design.md`

---

## Key facts (verified)

- `GET /api/tasks?include_done=true` returns `task_row_to_dict` = `dict(row)` + extras → **includes every column** incl. `id`, `updated_at` (TEXT ISO), `parent_id`, `recurrence_*`.
- `hydrate.taskFromServer(dict, getCid)` (existing) → local record: `cid=getCid(dict.id)`, `server_id=dict.id`, `parent_cid=dict.parent_id!=null?getCid(parent_id):null`, copies fields, `list_cid=null`, `deleted=false`, `dirty=0`, `base_rev=dict.updated_at`.
- `idmap.{cidOf(type,serverId), mapPut(type,serverId,cid)}`; `ids.newCid()`; `db.openDB()` (`tasks` store keyed by `cid`).
- `syncpush.js` `opCreate`/`opUpdate` set `{server_id, dirty:0}` / `{dirty:0}` on success — this plan adds `base_rev`.
- `static/index.html`: offline `<script>`s near :1306 (currently end at `syncpush.js`); `__syncTransport` + `schedulePush` + `__pushNow` + the `online` listener live just after the `api` object; `fetchAll` boot block calls `hydrate.ensureTasks` then `schedulePush` (search `Hydrate local tasks from the server`).
- `static/sw.js`: `CACHE = "taskflow-v120-sync-push"`; STATIC lists `/static/offline/*.js` ending with `syncpush.js`.

## File structure

```
static/offline/syncpull.js       # NEW — pullTasks, pullAndReconcile
tests/offline/syncpull.test.js   # NEW
static/offline/syncpush.js       # MODIFY — record base_rev on push success
tests/offline/syncpush.test.js   # MODIFY (append 1 test)
static/index.html                # MODIFY — script tag, sync(), triggers
static/sw.js                     # MODIFY — precache syncpull.js + cache bump
```

---

## Task 1: `syncpull.js`

**Files:**
- Create: `static/offline/syncpull.js`
- Test: `tests/offline/syncpull.test.js`

- [ ] **Step 1: Write the failing test `tests/offline/syncpull.test.js`**

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut } = require("../../static/offline/idmap.js");
const { pullTasks } = require("../../static/offline/syncpull.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function putTasks(recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("tasks", "readwrite");
    const os = tx.objectStore("tasks");
    for (const r of recs) os.put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function allTasks() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction("tasks").objectStore("tasks").getAll();
    r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
  });
}
async function getTask(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("tasks").objectStore("tasks").get(cid); q.onsuccess = () => res(q.result); });
}
function local(over) {
  return Object.assign({
    cid: over.cid, server_id: null, title: over.cid, gtd_status: "next", base_rev: null,
    deleted: false, dirty: 0,
  }, over);
}
function srv(over) {
  return Object.assign({
    id: over.id, title: "T", description: "", gtd_status: "next", priority: "P3", quadrant: "Q4",
    project: "", context: "", deadline: null, waiting_for: "", completed_at: null, progress: 0,
    is_focused: 0, assigned_to: null, parent_id: null, list_id: null,
    recurrence_type: null, recurrence_days: null, recurrence_end_date: null, recurrence_notif_level: null,
    created_at: "2026-06-01T00:00:00", updated_at: "2026-06-04T00:00:00",
  }, over);
}

test("pullTasks creates a record for an unknown server task", async () => {
  const r = await pullTasks([srv({ id: 5, title: "New", updated_at: "2026-06-04T01:00:00" })]);
  assert.equal(r.created, 1);
  const rows = await allTasks();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].server_id, 5);
  assert.equal(rows[0].title, "New");
  assert.equal(rows[0].dirty, 0);
  assert.equal(rows[0].base_rev, "2026-06-04T01:00:00");
});

test("pullTasks updates a clean local record when server updated_at differs", async () => {
  await putTasks([local({ cid: "a", server_id: 10, title: "Old", base_rev: "2026-06-01T00:00:00" })]);
  await mapPut("task", 10, "a");
  const r = await pullTasks([srv({ id: 10, title: "Newer", updated_at: "2026-06-05T00:00:00" })]);
  assert.equal(r.updated, 1);
  const a = await getTask("a");
  assert.equal(a.title, "Newer");
  assert.equal(a.base_rev, "2026-06-05T00:00:00");
  assert.equal(a.dirty, 0);
});

test("pullTasks leaves unchanged records (same updated_at) alone", async () => {
  await putTasks([local({ cid: "a", server_id: 10, title: "Same", base_rev: "2026-06-04T00:00:00" })]);
  await mapPut("task", 10, "a");
  const r = await pullTasks([srv({ id: 10, title: "Same", updated_at: "2026-06-04T00:00:00" })]);
  assert.equal(r.updated, 0);
  assert.equal(r.created, 0);
});

test("pullTasks skips a dirty local record even if the server changed", async () => {
  await putTasks([local({ cid: "a", server_id: 10, title: "Local edit", base_rev: "2026-06-01T00:00:00", dirty: 1 })]);
  await mapPut("task", 10, "a");
  const r = await pullTasks([srv({ id: 10, title: "Server", updated_at: "2026-06-05T00:00:00" })]);
  assert.equal(r.skipped, 1);
  assert.equal(r.updated, 0);
  assert.equal((await getTask("a")).title, "Local edit");
});

test("pullTasks deletes a clean local record whose server_id vanished", async () => {
  await putTasks([local({ cid: "a", server_id: 10, dirty: 0 })]);
  await mapPut("task", 10, "a");
  const r = await pullTasks([]); // server no longer has 10
  assert.equal(r.deleted, 1);
  assert.equal(await getTask("a"), undefined);
});

test("pullTasks does NOT delete a dirty local record missing from the server", async () => {
  await putTasks([local({ cid: "a", server_id: 10, dirty: 1 })]);
  await mapPut("task", 10, "a");
  const r = await pullTasks([]);
  assert.equal(r.deleted, 0);
  assert.equal(r.skipped, 1);
  assert.notEqual(await getTask("a"), undefined);
});

test("pullTasks ignores local-only records (server_id null) when reconciling deletes", async () => {
  await putTasks([local({ cid: "b", server_id: null, dirty: 1 })]);
  const r = await pullTasks([]);
  assert.equal(r.deleted, 0);
  assert.notEqual(await getTask("b"), undefined);
});

test("pullTasks resolves parent_cid across the server batch", async () => {
  const r = await pullTasks([
    srv({ id: 1, title: "Parent" }),
    srv({ id: 2, title: "Kid", parent_id: 1 }),
  ]);
  assert.equal(r.created, 2);
  const rows = await allTasks();
  const parent = rows.find((x) => x.server_id === 1);
  const kid = rows.find((x) => x.server_id === 2);
  assert.equal(kid.parent_cid, parent.cid);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/syncpull.test.js`
Expected: FAIL — cannot find module `syncpull.js`.

- [ ] **Step 3: Write `static/offline/syncpull.js`**

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
  const TFhydrate = req("./hydrate.js", root.TF && root.TF.hydrate);

  function getAllTasks() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("tasks", "readonly").objectStore("tasks").getAll();
      r.onsuccess = () => resolve(r.result || []);
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
  function ensureCid(serverId, cache) {
    if (cache[serverId]) return Promise.resolve(cache[serverId]);
    return TFidmap.cidOf("task", serverId).then((cid) => {
      if (cid) { cache[serverId] = cid; return cid; }
      const fresh = TFids.newCid();
      cache[serverId] = fresh;
      return TFidmap.mapPut("task", serverId, fresh).then(() => fresh);
    });
  }

  function pullTasks(serverList) {
    const list = serverList || [];
    const cache = {}; // serverId -> cid
    // Pass 1: ensure a cid exists for every server id (so parents resolve).
    return list.reduce((p, s) => p.then(() => ensureCid(s.id, cache)), Promise.resolve())
      .then(() => getAllTasks())
      .then((localAll) => {
        const localByCid = {};
        for (const r of localAll) localByCid[r.cid] = r;
        const getCid = (sid) => cache[sid] || null;
        const result = { created: 0, updated: 0, deleted: 0, skipped: 0 };
        let chain = Promise.resolve();
        // Pass 2: create / update / skip.
        for (const s of list) {
          const cid = cache[s.id];
          const localRec = localByCid[cid];
          chain = chain.then(() => {
            if (!localRec) { result.created++; return putTask(TFhydrate.taskFromServer(s, getCid)); }
            if (localRec.dirty) { result.skipped++; return; }
            if (s.updated_at !== localRec.base_rev) { result.updated++; return putTask(TFhydrate.taskFromServer(s, getCid)); }
            return; // unchanged
          });
        }
        // Pass 3: delete clean local records whose server_id vanished from the list.
        const serverIds = new Set(list.map((s) => String(s.id)));
        for (const r of localAll) {
          if (r.server_id == null) continue;            // local-only — never a remote delete
          if (serverIds.has(String(r.server_id))) continue;
          chain = chain.then(() => {
            if (r.dirty) { result.skipped++; return; }
            result.deleted++;
            return deleteTask(r.cid);
          });
        }
        return chain.then(() => result);
      });
  }

  function pullAndReconcile(rawFetch) {
    return Promise.resolve(rawFetch("/api/tasks?include_done=true"))
      .then((res) => (res && typeof res.json === "function" ? res.json() : res))
      .then((list) => pullTasks(list || []));
  }

  const exported = { pullTasks, pullAndReconcile };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.syncpull = exported; }
  return exported;
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/syncpull.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add static/offline/syncpull.js tests/offline/syncpull.test.js
git commit -m "feat(offline): syncpull engine (full-list reconcile)"
```

---

## Task 2: `syncpush.js` — record `base_rev` on push success

**Files:**
- Modify: `static/offline/syncpush.js`
- Modify: `tests/offline/syncpush.test.js`

- [ ] **Step 1: Append a failing test to `tests/offline/syncpush.test.js`**

```js
test("pushOutbox create records base_rev from the server response updated_at", async () => {
  await put("tasks", [task({ cid: "a", title: "A" })]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "task", cid: "a", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 201, data: { id: 100, updated_at: "2026-06-04T09:00:00" } }));
  await pushOutbox(tr);
  const db = await openDB();
  const rec = await new Promise((res) => { const q = db.transaction("tasks").objectStore("tasks").get("a"); q.onsuccess = () => res(q.result); });
  assert.equal(rec.base_rev, "2026-06-04T09:00:00");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/syncpush.test.js`
Expected: FAIL — `rec.base_rev` is `undefined` (not yet recorded).

- [ ] **Step 3: Edit `static/offline/syncpush.js`**

In `opCreate`, change the success write from:

```js
            return TFidmap.mapPut("task", sid, op.cid)
              .then(() => putTaskRaw(Object.assign({}, rec, { server_id: sid, dirty: 0 })))
```

to:

```js
            return TFidmap.mapPut("task", sid, op.cid)
              .then(() => putTaskRaw(Object.assign({}, rec, { server_id: sid, dirty: 0, base_rev: res.data && res.data.updated_at != null ? res.data.updated_at : rec.base_rev })))
```

In `opUpdate`, change the success write from:

```js
          if (ok(res)) { return putTaskRaw(Object.assign({}, rec, { dirty: 0 })).then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; }); }
```

to:

```js
          if (ok(res)) { return putTaskRaw(Object.assign({}, rec, { dirty: 0, base_rev: res.data && res.data.updated_at != null ? res.data.updated_at : rec.base_rev })).then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; }); }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/syncpush.test.js`
Expected: PASS, 13 tests (12 prior + 1 new).

- [ ] **Step 5: Commit**

```bash
git add static/offline/syncpush.js tests/offline/syncpush.test.js
git commit -m "feat(offline): syncpush records base_rev on push success"
```

---

## Task 3: Full Node-suite regression

- [ ] **Step 1: Run the whole offline suite (17 files)**

Run:
```bash
node --test tests/offline/smoke.test.js tests/offline/ids.test.js tests/offline/db.test.js tests/offline/meta.test.js tests/offline/idmap.test.js tests/offline/outbox.test.js tests/offline/blobstore.test.js tests/offline/router.test.js tests/offline/tasklogic.test.js tests/offline/taskrepo.test.js tests/offline/taskquery.test.js tests/offline/tagrepo.test.js tests/offline/recurrence.test.js tests/offline/taskroutes.test.js tests/offline/hydrate.test.js tests/offline/syncpush.test.js tests/offline/syncpull.test.js
```
Expected: `ℹ tests 147 / ℹ pass 147 / ℹ fail 0`, terminating promptly.

> Count: prior 138 + Task 1 (8) + Task 2 (1) = **147**.

- [ ] **Step 2: No commit** (regression run only). Fix any failure before continuing.

---

## Task 4: Wire `static/index.html` (browser-verified)

**Files:**
- Modify: `static/index.html` (script tag near :1306; `sync()` near the `__syncTransport` block; `online` listener; `fetchAll` boot block)

> No Node test — browser-verified in Task 6.

- [ ] **Step 1: Add the `syncpull.js` script tag**

Find `  <script src="/static/offline/syncpush.js"></script>` and insert immediately AFTER it:

```html
  <script src="/static/offline/syncpull.js"></script>
```

- [ ] **Step 2: Add `__syncRawFetch` + `sync()` after the push transport block**

Find the line `window.addEventListener("online", schedulePush);` (added in #2a). Insert this block immediately BEFORE it:

```js
const __syncRawFetch = (u) => window.fetch(u, { headers: __token ? { Authorization: "Bearer " + __token } : {} });
function sync() {
  if (!(window.TF && window.TF.syncpush && window.TF.syncpull)) return Promise.resolve(null);
  return window.TF.syncpush.pushOutbox(__syncTransport)
    .then(() => window.TF.syncpull.pullAndReconcile(__syncRawFetch))
    .catch(() => null);
}
window.__syncNow = () => sync();
```

- [ ] **Step 3: Make the `online` event run a full sync (push→pull)**

Replace the line:

```js
window.addEventListener("online", schedulePush);
```

with:

```js
window.addEventListener("online", sync);
```

- [ ] **Step 4: Replace the boot hydration call with `sync()` in `fetchAll`**

Find this block (search `Hydrate local tasks from the server`):

```js
    // Hydrate local tasks from the server once (token-aware raw fetch — bypasses the api intercept).
    if (navigator.onLine && __token && window.TF && window.TF.hydrate) {
      const _rawFetch = (u) => window.fetch(u, { headers: { Authorization: "Bearer " + __token } });
      try { await window.TF.hydrate.ensureTasks(_rawFetch); } catch (e) {}
    }
    if (navigator.onLine) schedulePush();
```

Replace the ENTIRE block above with:

```js
    // Sync local tasks with the server (push pending, then pull/reconcile). Supersedes one-shot hydration.
    if (navigator.onLine && __token) {
      try { await sync(); } catch (e) {}
    }
```

- [ ] **Step 5: Commit**

```bash
git add static/index.html
git commit -m "feat(offline): wire sync() push->pull on boot/online/manual"
```

---

## Task 5: Service Worker — precache + cache bump

**Files:**
- Modify: `static/sw.js:1` (CACHE), STATIC array

- [ ] **Step 1: Bump the cache version**

At `static/sw.js:1`, change `const CACHE = "taskflow-v120-sync-push";` to:

```js
const CACHE = "taskflow-v121-sync-pull";
```

- [ ] **Step 2: Precache `syncpull.js`**

In the `STATIC` array, find `"/static/offline/syncpush.js",` and add immediately after it:

```js
  "/static/offline/syncpull.js",
```

- [ ] **Step 3: Verify syntax + commit**

Run: `node --check static/sw.js`
Expected: no output (valid).

```bash
git add static/sw.js
git commit -m "chore(sw): bump cache v121 + precache syncpull.js"
```

---

## Task 6: Browser verification (manual — record results)

Deploy (merge → push → confirm VPS pulled — `deploy.yml` now auto-discards `package-lock.json`; verify `curl https://todo.yatno.web.id/sw.js | grep CACHE` shows v121). In the logged-in tab, reset the old SW:

```js
(async()=>{for(const r of await navigator.serviceWorker.getRegistrations())await r.unregister();for(const k of await caches.keys())await caches.delete(k);location.reload();})()
```

After reload, verify (paste in console, share output):

```js
(async()=>{
  const R=[]; const ok=(n,c)=>R.push((c?'✅':'❌')+' '+n);
  try{
    ok('syncpull loaded', !!(window.TF && TF.syncpull));
    const h={Authorization:'Bearer '+localStorage.getItem('tf_token'),'Content-Type':'application/json'};
    // 1) create a task DIRECTLY on the server (simulates another device/bot), bypassing local
    const made = await (await window.fetch('/api/tasks',{method:'POST',headers:h,body:JSON.stringify({title:'__pull verif', gtd_status:'inbox'})})).json();
    ok('server task created (id '+made.id+')', !!made.id);
    // 2) pull → it should appear locally
    await window.__syncNow();
    const localList = await api.get('/api/tasks?include_done=true');
    const pulled = localList.find(t=>t.title==='__pull verif');
    ok('pulled into local store', !!pulled);
    // 3) delete it on the server, pull again → it should vanish locally
    await window.fetch('/api/tasks/'+made.id,{method:'DELETE',headers:h});
    await window.__syncNow();
    const after = await api.get('/api/tasks?include_done=true');
    ok('remote delete reconciled (gone locally)', !after.find(t=>t.title==='__pull verif'));
  }catch(e){ R.push('❌ EXCEPTION: '+(e&&e.message)); }
  const out='=== PULL VERIFICATION ===\n'+R.join('\n'); console.log(out); return out;
})()
```

Expected: all ✅ — a server-side create appears locally after sync, and a server-side delete is reconciled away locally. Report pass/fail.

---

## Done criteria

- `syncpull.js` exports `pullTasks`, `pullAndReconcile`; `syncpush` records `base_rev` on success; Node suite green (147).
- Pull detects remote create/update/delete via full-list reconcile; skips dirty records; ignores local-only.
- `sync()` = push→pull wired to boot (replacing one-shot hydration), `online`, and `window.__syncNow()`; raw fetch (not `api`).
- SW bumped to v121 with `syncpull.js` precached. Browser verification passes.

## Next (out of scope)

- **#2c Conflict resolution** — dirty-local vs server-changed (3-way via `base_rev`).
- **#2d collaborative**; pull `recurring_exceptions`; realtime/periodic.
- Cleanup: retire `computeOfflineQuadrant`; `hydrate.ensureTasks` is now unused (pull supersedes) — remove in a cleanup pass.
```
