# Offline Shared Notes (#2h-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make shared notes (`scratchpad_notes` with `list_id != null`) local-first by extending the existing personal-notes offline machinery, reconciled with the same last-write-wins the server already uses, plus a notice when a local offline edit loses LWW and member-permission edge handling.

**Architecture:** No new modules. Lift the `list_id == null` personal-only filter from the note modules; thread collaborator metadata (`user_id`, `last_edited_by`, `last_editor_*`) through the local note record; intercept the list-scoped notes route; add permission-edge handling to the push handlers; extend `syncconflict` for note conflicts + notices. No DB schema bump.

**Tech Stack:** Vanilla UMD modules (`window.TF.*` + Node `require`), IndexedDB (fake-indexeddb in tests), `node --test`. Backend unchanged.

**Reference spec:** `docs/superpowers/specs/2026-06-12-offline-shared-notes-design.md`

**Baseline before starting:** `node --test tests/offline/*.test.js` → `pass 309`.

**Canonical local note record (extended — all tasks must agree):**
```js
{
  cid, server_id, title, content,
  linked_task_cids, linked_to_cids,   // JSON strings
  pinned, list_id,                     // list_id null = personal, else shared
  user_id,                             // note OWNER's server id
  last_edited_by,                      // server user id of last editor
  last_editor_username,                // present (from server) only when last_edited_by != requester
  last_editor_display_name,
  created_at, updated_at, deleted, dirty, base_rev,
  conflict?,                           // "remote_deleted" → edit-vs-delete discard banner
  notice?                              // { kind:"overwritten"|"delete_refused", title, editor? } → dismissable notice banner
}
```
(`user_id`, `last_editor_username`, `last_editor_display_name`, `notice` are NEW fields added by this slice. `conflict` already exists for tasks; now also used for notes.)

**Key facts (do not re-derive):**
- `notehydrate.js` is loaded but `ensureNotes` is never invoked (superseded by `pullNotes`) — **dead code, do NOT touch it.**
- Server `PUT /api/scratchpad/{id}` is pure LWW (no version check). `GET /api/scratchpad` returns owned + list-member notes. `_scratchpad_row` adds `last_editor_username`/`last_editor_display_name` only when `last_edited_by != requesting uid`. `GET /api/lists/{id}/notes` returns `{id, title, updated_at}`. `DELETE` is owner-only (member → 403). `PUT` on a note you can't access → 404.
- idmap: `mapPut(type, serverId, cid)`, `cidOf(type, serverId)`, `serverIdOf(cid)` (undefined when unmapped), `mapDelete(type, serverId)`. Type `"note"`.
- `chatrepo.setCurrentUser` is already called in `index.html` at the online auth load (~line 20461) and the offline JWT fallback (~line 20473).
- `syncconflict.js` is currently TASK-only.

---

### Task 1: `noterepo.js` — list_id, last_edited_by/user_id, current user

**Files:**
- Modify: `static/offline/noterepo.js`
- Test: `tests/offline/noterepo_shared.test.js`

- [ ] **Step 1: Write the failing test** — create `tests/offline/noterepo_shared.test.js`:

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset } = require("../../static/offline/db.js");
const { createNote, updateNote, getNoteRaw, setCurrentUser } = require("../../static/offline/noterepo.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); setCurrentUser(null); });

test("createNote stores list_id and stamps owner+last_edited_by from current user", async () => {
  setCurrentUser({ user_id: 5, username: "me", display_name: "Me" });
  const rec = await createNote({ title: "Shared", content: "x", list_id: 9 }, {});
  assert.equal(rec.list_id, 9);
  assert.equal(rec.user_id, 5);
  assert.equal(rec.last_edited_by, 5);
});

test("createNote defaults list_id null (personal) when omitted", async () => {
  setCurrentUser({ user_id: 5 });
  const rec = await createNote({ title: "Personal", content: "" }, {});
  assert.equal(rec.list_id, null);
});

test("updateNote stamps last_edited_by from current user", async () => {
  setCurrentUser({ user_id: 5 });
  const rec = await createNote({ title: "A", content: "", list_id: 9 }, {});
  setCurrentUser({ user_id: 7 }); // a different member edits
  await updateNote(rec.cid, { content: "edited" }, {});
  const raw = await getNoteRaw(rec.cid);
  assert.equal(raw.last_edited_by, 7);
  assert.equal(raw.content, "edited");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/noterepo_shared.test.js`
Expected: FAIL — `setCurrentUser` is not a function / list_id is null.

- [ ] **Step 3: Implement** — in `static/offline/noterepo.js`:

Add module-level current-user state near the top of the factory body (after the `req` requires):

```js
  let _currentUser = null;
  function setCurrentUser(u) { _currentUser = u; }
  function getCurrentUser() { return _currentUser; }
  function curUid() { return (_currentUser && _currentUser.user_id != null) ? _currentUser.user_id : null; }
```

In `createNote`, change the record literal's `pinned: false, list_id: null, last_edited_by: null,` line to:

```js
        pinned: false,
        list_id: input.list_id != null ? input.list_id : null,
        user_id: curUid(),
        last_edited_by: curUid(),
        last_editor_username: null, last_editor_display_name: null,
```

In `updateNote`, the `next` object (`Object.assign({}, rec, { ... })`) — add `last_edited_by: curUid()` to the assigned fields:

```js
        const next = Object.assign({}, rec, {
          title: patch.title != null ? patch.title : rec.title,
          content: content,
          linked_to_cids: JSON.stringify(toCids),
          linked_task_cids: JSON.stringify(taskCids),
          last_edited_by: curUid(),
          updated_at: now, dirty: 1,
        });
```

Add `setCurrentUser, getCurrentUser` to the `exported` object.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/noterepo_shared.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Run full suite (existing noterepo tests must still pass)**

Run: `node --test tests/offline/*.test.js`
Expected: `pass 312` (309 + 3), `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add static/offline/noterepo.js tests/offline/noterepo_shared.test.js
git commit -m "feat(offline): noterepo accepts list_id + stamps owner/last_edited_by (#2h-2)"
```

---

### Task 2: `notequery.js` — include shared notes + expose collaborator fields

**Files:**
- Modify: `static/offline/notequery.js`
- Test: `tests/offline/notequery_shared.test.js`

- [ ] **Step 1: Write the failing test** — create `tests/offline/notequery_shared.test.js`:

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { getNotes, getNote } = require("../../static/offline/notequery.js");

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
function note(over) {
  return Object.assign({
    cid: over.cid, server_id: over.server_id != null ? over.server_id : null,
    title: over.title || "", content: over.content || "",
    linked_task_cids: "[]", linked_to_cids: "[]", pinned: false,
    list_id: over.list_id != null ? over.list_id : null,
    user_id: over.user_id != null ? over.user_id : null,
    last_edited_by: over.last_edited_by != null ? over.last_edited_by : null,
    last_editor_username: over.last_editor_username != null ? over.last_editor_username : null,
    last_editor_display_name: over.last_editor_display_name != null ? over.last_editor_display_name : null,
    created_at: "2026-06-12T00:00:00", updated_at: over.updated_at || "2026-06-12T00:00:00",
    deleted: false, dirty: 0, base_rev: null,
  }, over);
}

test("getNotes includes shared notes (list_id != null), not just personal", async () => {
  await put("scratchpad_notes", [
    note({ cid: "p", server_id: 1, title: "Personal" }),
    note({ cid: "s", server_id: 2, title: "Shared", list_id: 9 }),
  ]);
  const list = await getNotes({});
  assert.deepEqual(list.map((n) => n.title).sort(), ["Personal", "Shared"]);
});

test("shape exposes list_id, user_id, last_edited_by and last_editor fields", async () => {
  await put("scratchpad_notes", [
    note({ cid: "s", server_id: 2, title: "Shared", list_id: 9, user_id: 3, last_edited_by: 7, last_editor_username: "bob", last_editor_display_name: "Bob" }),
  ]);
  const n = await getNote("s");
  assert.equal(n.list_id, 9);
  assert.equal(n.user_id, 3);
  assert.equal(n.last_edited_by, 7);
  assert.equal(n.last_editor_username, "bob");
  assert.equal(n.last_editor_display_name, "Bob");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/notequery_shared.test.js`
Expected: FAIL — shared note excluded / fields missing.

- [ ] **Step 3: Implement** — in `static/offline/notequery.js`:

In `shape`, replace the returned object's `list_id: null, created_at: rec.created_at, updated_at: rec.updated_at,` tail with:

```js
      list_id: rec.list_id != null ? rec.list_id : null,
      user_id: rec.user_id != null ? rec.user_id : null,
      last_edited_by: rec.last_edited_by != null ? rec.last_edited_by : null,
      last_editor_username: rec.last_editor_username != null ? rec.last_editor_username : null,
      last_editor_display_name: rec.last_editor_display_name != null ? rec.last_editor_display_name : null,
      created_at: rec.created_at, updated_at: rec.updated_at,
```

In `personalSorted`, drop the `list_id == null` clause so it includes accessible (personal + shared) notes:

```js
  function personalSorted(notes) {
    return notes.filter((n) => !n.deleted)
      .sort((a, b) => (String(b.updated_at) < String(a.updated_at) ? -1 : String(b.updated_at) > String(a.updated_at) ? 1 : 0));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/notequery_shared.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Full suite**

Run: `node --test tests/offline/*.test.js`
Expected: `pass 314` (312 + 2), `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add static/offline/notequery.js tests/offline/notequery_shared.test.js
git commit -m "feat(offline): notequery includes shared notes + exposes collaborator fields (#2h-2)"
```

---

### Task 3: `noteroutes.js` — `GET /api/lists/:id/notes`

**Files:**
- Modify: `static/offline/noteroutes.js`
- Test: `tests/offline/noteroutes_shared.test.js`

- [ ] **Step 1: Write the failing test** — create `tests/offline/noteroutes_shared.test.js`:

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset } = require("../../static/offline/db.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");
const { createNote } = require("../../static/offline/noterepo.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

test("GET /api/lists/:id/notes returns that list's local notes shaped {id,title,updated_at}", async () => {
  const R = buildTaskRouter();
  await createNote({ title: "InList", content: "", list_id: 9 }, {});
  await createNote({ title: "Other", content: "", list_id: 4 }, {});
  await createNote({ title: "Personal", content: "" }, {});
  const list = await R.dispatch("GET", "/api/lists/9/notes", undefined);
  assert.equal(list.length, 1);
  assert.equal(list[0].title, "InList");
  assert.deepEqual(Object.keys(list[0]).sort(), ["id", "title", "updated_at"]);
});

test("PATCH /api/scratchpad/:id/share is NOT intercepted (stays network)", () => {
  const R = buildTaskRouter();
  assert.equal(R.hasRoute("PATCH", "/api/scratchpad/5/share"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/noteroutes_shared.test.js`
Expected: FAIL — no local route for `GET /api/lists/9/notes`.

- [ ] **Step 3: Implement** — in `static/offline/noteroutes.js`:

Add a helper to read notes (near the existing `allNotes`) and register the route inside `registerNoteRoutes`. After the existing `router.register("PATCH", "/api/scratchpad/:id/pin", ...)` line, add:

```js
    router.register("GET", "/api/lists/:id/notes", ({ params }) =>
      allNotes().then((all) => all
        .filter((n) => !n.deleted && n.list_id != null && String(n.list_id) === String(params.id))
        .sort((a, b) => (String(b.updated_at) < String(a.updated_at) ? -1 : String(b.updated_at) > String(a.updated_at) ? 1 : 0))
        .map((n) => ({ id: n.server_id != null ? n.server_id : n.cid, title: n.title, updated_at: n.updated_at }))));
```

(`allNotes()` already exists in noteroutes.js and reads the `scratchpad_notes` store.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/noteroutes_shared.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Full suite**

Run: `node --test tests/offline/*.test.js`
Expected: `pass 316` (314 + 2), `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add static/offline/noteroutes.js tests/offline/noteroutes_shared.test.js
git commit -m "feat(offline): intercept GET /api/lists/:id/notes (#2h-2)"
```

---

### Task 4: `syncpush.js` — list_id in payload + member-permission edges

**Files:**
- Modify: `static/offline/syncpush.js`
- Test: `tests/offline/notesync_shared_push.test.js`

- [ ] **Step 1: Write the failing test** — create `tests/offline/notesync_shared_push.test.js`:

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { serverIdOf, mapPut } = require("../../static/offline/idmap.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const { noteToCreatePayload, pushOutbox } = require("../../static/offline/syncpush.js");

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
async function getNote(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("scratchpad_notes").objectStore("scratchpad_notes").get(cid); q.onsuccess = () => res(q.result); });
}
function note(over) {
  return Object.assign({
    cid: over.cid, server_id: over.server_id != null ? over.server_id : null, title: "N", content: "c",
    linked_task_cids: "[]", linked_to_cids: "[]", pinned: false,
    list_id: over.list_id != null ? over.list_id : null, user_id: null, last_edited_by: null,
    created_at: "x", updated_at: "2026-06-12T00:00:00", deleted: false, dirty: 1, base_rev: null,
  }, over);
}
function fakeTransport(handler) {
  const calls = [];
  return { calls, request(method, path, body) { calls.push({ method, path, body }); const h = handler(method, path, body); if (h === "NETWORK") return Promise.reject(new Error("net")); return Promise.resolve(h); } };
}

test("noteToCreatePayload sends the real list_id", () => {
  const p = noteToCreatePayload(note({ cid: "n", list_id: 9 }), [], []);
  assert.equal(p.list_id, 9);
});

test("shared update 404 sets conflict=remote_deleted (no re-create)", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, list_id: 9 })]);
  await mapPut("note", 7, "n");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "note", cid: "n", payload: {} }]);
  const tr = fakeTransport((m) => { assert.notEqual(m, "POST"); return { status: 404, data: { detail: "gone" } }; });
  await pushOutbox(tr);
  const rec = await getNote("n");
  assert.equal(rec.conflict, "remote_deleted");
  assert.equal(rec.server_id, 7); // not re-created
});

test("personal update 404 still re-creates (regression guard)", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, list_id: null })]);
  await mapPut("note", 7, "n");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "note", cid: "n", payload: {} }]);
  let n = 0;
  const tr = fakeTransport(() => (n++ === 0 ? { status: 404, data: {} } : { status: 200, data: { id: 99, updated_at: "x" } }));
  await pushOutbox(tr);
  assert.equal(await serverIdOf("n"), 99);
});

test("shared create 403 (lost membership) drops op + deletes local + idmap", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: null, list_id: 9 })]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "note", cid: "n", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 403, data: { detail: "Not a member" } }));
  await pushOutbox(tr);
  assert.equal((await outboxAll()).length, 0);
  assert.equal(await getNote("n"), undefined);
});

test("member delete 403 reverts the tombstone + records a notice", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, list_id: 9, deleted: true, title: "Shared" })]);
  await mapPut("note", 7, "n");
  await put("_outbox", [{ qid: 1, op: "delete", entity_type: "note", cid: "n", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 403, data: { detail: "Hanya pemilik" } }));
  await pushOutbox(tr);
  const rec = await getNote("n");
  assert.equal(rec.deleted, false);
  assert.equal(rec.dirty, 0);
  assert.equal(rec.notice.kind, "delete_refused");
  assert.equal((await outboxAll()).length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/notesync_shared_push.test.js`
Expected: FAIL — list_id null in payload / no 404-branch / no 403 handling.

- [ ] **Step 3a: list_id in create payload** — in `static/offline/syncpush.js`, in `noteToCreatePayload`, change `list_id: null,` to:

```js
      list_id: record.list_id != null ? record.list_id : null,
```

- [ ] **Step 3b: opNoteCreate 403** — in `opNoteCreate`, the failure tail currently is `result.failed++; return TFoutbox.outboxRemove(op.qid);`. Replace that tail (inside the `.then((res) => {...})` after the `if (ok(res)) {...}` block) with:

```js
          if (res.status === 403) {
            return deleteNoteRaw(op.cid).then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.failed++; });
          }
          result.failed++;
          return TFoutbox.outboxRemove(op.qid);
```

- [ ] **Step 3c: opNoteUpdate 404 branch + 403** — in `opNoteUpdate`, replace the `if (res.status === 404) { ... re-create ... }` block AND the trailing generic-failure with:

```js
        if (res.status === 404) {
          if (rec.list_id != null) {
            // shared note deleted by owner (or access lost): do not re-create — surface edit-vs-delete.
            return putNoteRaw(Object.assign({}, rec, { conflict: "remote_deleted" }))
              .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.failed++; });
          }
          return send(transport, "POST", "/api/scratchpad", noteToCreatePayload(rec, tags, taskSids)).then((res2) => {
            if (ok(res2)) {
              const nid = res2.data.id;
              return TFidmap.mapDelete("note", sid)
                .then(() => TFidmap.mapPut("note", nid, op.cid))
                .then(() => putNoteRaw(Object.assign({}, rec, { server_id: nid, dirty: 0, base_rev: res2.data && res2.data.updated_at != null ? res2.data.updated_at : rec.base_rev })))
                .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; });
            }
            result.failed++;
            return TFoutbox.outboxRemove(op.qid);
          });
        }
        if (res.status === 403) {
          return TFidmap.mapDelete("note", sid)
            .then(() => deleteNoteRaw(op.cid))
            .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.failed++; });
        }
        result.failed++;
        return TFoutbox.outboxRemove(op.qid);
```

- [ ] **Step 3d: opNoteDelete 403** — in `opNoteDelete`, the branch after the DELETE send currently is `if (ok(res) || res.status === 404) { ... } result.failed++; return TFoutbox.outboxRemove(op.qid);`. Replace the trailing generic failure with a 403 revert:

```js
        if (res.status === 403) {
          return getNoteRaw(op.cid).then((rec) =>
            (rec
              ? putNoteRaw(Object.assign({}, rec, { deleted: false, dirty: 0, notice: { kind: "delete_refused", title: rec.title } }))
              : Promise.resolve()))
            .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.failed++; });
        }
        result.failed++;
        return TFoutbox.outboxRemove(op.qid);
```

(`getNoteRaw`, `putNoteRaw`, `deleteNoteRaw` already exist in syncpush.js.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/notesync_shared_push.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Full suite (existing note push tests must still pass — personal re-create path unchanged)**

Run: `node --test tests/offline/*.test.js`
Expected: `pass 321` (316 + 5), `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add static/offline/syncpush.js tests/offline/notesync_shared_push.test.js
git commit -m "feat(offline): push shared notes (list_id) + member-permission edges (#2h-2)"
```

---

### Task 5: `syncpull.js` — reconcile shared notes + LWW-loss notice

**Files:**
- Modify: `static/offline/syncpull.js`
- Test: `tests/offline/notesync_shared_pull.test.js`

- [ ] **Step 1: Write the failing test** — create `tests/offline/notesync_shared_pull.test.js`:

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut } = require("../../static/offline/idmap.js");
const { pullNotes } = require("../../static/offline/syncpull.js");

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
function srv(over) {
  return Object.assign({
    id: over.id, title: over.title || "S", content: over.content || "", pinned: false,
    list_id: over.list_id != null ? over.list_id : null,
    last_edited_by: over.last_edited_by != null ? over.last_edited_by : null,
    last_editor_username: over.last_editor_username != null ? over.last_editor_username : null,
    last_editor_display_name: over.last_editor_display_name != null ? over.last_editor_display_name : null,
    user_id: over.user_id != null ? over.user_id : 1,
    linked_to: [], linked_task_ids: [], tags: [],
    created_at: "2026-06-12T00:00:00", updated_at: over.updated_at || "2026-06-12T00:00:00",
  }, over);
}
function localNote(over) {
  return Object.assign({
    cid: over.cid, server_id: over.server_id, title: over.title || "L", content: over.content || "",
    linked_task_cids: "[]", linked_to_cids: "[]", pinned: false,
    list_id: over.list_id != null ? over.list_id : null, user_id: 1, last_edited_by: null,
    created_at: "x", updated_at: over.updated_at || "2026-06-12T00:00:00",
    deleted: false, dirty: over.dirty != null ? over.dirty : 0, base_rev: over.base_rev || "2026-06-12T00:00:00",
  }, over);
}

test("pullNotes reconciles shared notes (no longer personal-only) + carries collaborator fields", async () => {
  const res = await pullNotes([srv({ id: 5, title: "Remote", list_id: 9, last_edited_by: 7, last_editor_username: "bob", last_editor_display_name: "Bob" })]);
  assert.equal(res.created, 1);
  const local = (await getAll("scratchpad_notes"))[0];
  assert.equal(local.list_id, 9);
  assert.equal(local.last_editor_display_name, "Bob");
});

test("LWW-loss on a dirty shared note attaches an overwritten notice", async () => {
  await put("scratchpad_notes", [localNote({ cid: "n", server_id: 5, list_id: 9, dirty: 1, title: "MineOld", updated_at: "2026-06-12T01:00:00", base_rev: "2026-06-12T00:00:00" })]);
  await mapPut("note", 5, "n");
  // server newer than local -> server wins
  const res = await pullNotes([srv({ id: 5, list_id: 9, title: "Theirs", updated_at: "2026-06-12T05:00:00", last_edited_by: 7, last_editor_display_name: "Bob" })]);
  assert.equal(res.lwwResolved, 1);
  const local = (await getAll("scratchpad_notes"))[0];
  assert.equal(local.title, "Theirs");
  assert.equal(local.notice.kind, "overwritten");
  assert.equal(local.notice.editor, "Bob");
});

test("shared dirty note vanished from server -> conflict remote_deleted (not silent keep)", async () => {
  await put("scratchpad_notes", [localNote({ cid: "n", server_id: 5, list_id: 9, dirty: 1, title: "Mine" })]);
  await mapPut("note", 5, "n");
  const res = await pullNotes([]); // server no longer has it
  const local = (await getAll("scratchpad_notes"))[0];
  assert.equal(local.conflict, "remote_deleted");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/notesync_shared_pull.test.js`
Expected: FAIL — shared note filtered out / no notice / dirty-vanished silently kept.

- [ ] **Step 3a: include shared + carry fields** — in `static/offline/syncpull.js`:

In `noteFromServer`, change the record literal's `pinned: !!s.pinned, list_id: null, last_edited_by: ...` portion to:

```js
        pinned: !!s.pinned,
        list_id: s.list_id != null ? s.list_id : null,
        user_id: s.user_id != null ? s.user_id : null,
        last_edited_by: s.last_edited_by != null ? s.last_edited_by : null,
        last_editor_username: s.last_editor_username != null ? s.last_editor_username : null,
        last_editor_display_name: s.last_editor_display_name != null ? s.last_editor_display_name : null,
```

Change `writeNote` to accept an `extra` overlay:

```js
  function writeNote(s, cid, cache, extra) {
    return noteFromServer(s, cid, cache).then((rec) => putNote(Object.assign(rec, extra || {}))).then(() => TFtag.setEntityTags("note", cid, s.tags || []));
  }
```

In `pullNotes`, change the filter line `const list = (serverNotes || []).filter((s) => s.list_id == null);` to:

```js
    const list = (serverNotes || []);
```

- [ ] **Step 3b: LWW-loss notice** — in `pullNotes`, the dirty-local server-wins branch currently is `return dropOutbox("note", cid).then(() => writeNote(s, cid, cache)); // server wins`. Replace with:

```js
                return dropOutbox("note", cid).then(() => writeNote(s, cid, cache, {
                  notice: { kind: "overwritten", title: s.title, editor: s.last_editor_display_name || s.last_editor_username || "Pengguna lain" },
                })); // server wins (LWW) — leave a notice
```

- [ ] **Step 3c: shared dirty-vanished → remote_deleted** — in `pullNotes`, the orphan-delete pass currently is:

```js
          if (r.dirty) { result.skipped++; return; } // local-wins; push update→404→re-create
          result.deleted++;
          return deleteNoteRec(r.cid).then(() => TFidmap.mapDelete("note", r.server_id));
```

Replace with:

```js
          if (r.dirty) {
            if (r.list_id != null) { result.skipped++; return putNote(Object.assign({}, r, { conflict: "remote_deleted" })); }
            result.skipped++; return; // personal local-wins; push update→404→re-create
          }
          result.deleted++;
          return deleteNoteRec(r.cid).then(() => TFidmap.mapDelete("note", r.server_id));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/notesync_shared_pull.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Full suite (existing personal pullNotes tests must still pass)**

Run: `node --test tests/offline/*.test.js`
Expected: `pass 324` (321 + 3), `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add static/offline/syncpull.js tests/offline/notesync_shared_pull.test.js
git commit -m "feat(offline): pull shared notes + LWW-loss notice + shared edit-vs-delete (#2h-2)"
```

---

### Task 6: `syncconflict.js` — note conflicts + notices

**Files:**
- Modify: `static/offline/syncconflict.js`
- Test: `tests/offline/syncconflict_notes.test.js`

- [ ] **Step 1: Write the failing test** — create `tests/offline/syncconflict_notes.test.js`:

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut, serverIdOf } = require("../../static/offline/idmap.js");
const { listConflicts, resolveConflict, listNotices, dismissNotice } = require("../../static/offline/syncconflict.js");

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
async function getNote(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("scratchpad_notes").objectStore("scratchpad_notes").get(cid); q.onsuccess = () => res(q.result); });
}
function note(over) {
  return Object.assign({ cid: over.cid, server_id: over.server_id != null ? over.server_id : null, title: "N", content: "", linked_task_cids: "[]", linked_to_cids: "[]", pinned: false, list_id: 9, user_id: 1, last_edited_by: null, created_at: "x", updated_at: "x", deleted: false, dirty: 1, base_rev: null }, over);
}

test("listConflicts includes note conflicts tagged entity=note", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, conflict: "remote_deleted", title: "Gone" })]);
  const list = await listConflicts();
  const noteC = list.find((c) => c.entity === "note");
  assert.ok(noteC);
  assert.equal(noteC.cid, "n");
  assert.equal(noteC.title, "Gone");
});

test("resolveConflict('note', cid, 'discard') removes the note + idmap + op", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, conflict: "remote_deleted" })]);
  await mapPut("note", 7, "n");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "note", cid: "n", payload: {} }]);
  await resolveConflict("note", "n", "discard");
  assert.equal(await getNote("n"), undefined);
  assert.equal(await serverIdOf("n"), undefined);
});

test("listNotices surfaces note notices; dismissNotice clears them", async () => {
  await put("scratchpad_notes", [note({ cid: "n", notice: { kind: "overwritten", title: "Doc", editor: "Bob" } })]);
  const notices = await listNotices();
  assert.equal(notices.length, 1);
  assert.equal(notices[0].editor, "Bob");
  await dismissNotice("n");
  assert.equal((await listNotices()).length, 0);
  assert.equal((await getNote("n")).notice, undefined);
});

test("resolveConflict still works for tasks (entity='task', backward-compatible)", async () => {
  await put("tasks", [{ cid: "t", server_id: 3, title: "T", conflict: "remote_deleted", list_id: null }]);
  await mapPut("task", 3, "t");
  await resolveConflict("task", "t", "discard");
  const db = await openDB();
  const got = await new Promise((res) => { const q = db.transaction("tasks").objectStore("tasks").get("t"); q.onsuccess = () => res(q.result); });
  assert.equal(got, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/syncconflict_notes.test.js`
Expected: FAIL — note conflicts not listed / `listNotices` undefined / `resolveConflict` signature is (cid, choice).

- [ ] **Step 3: Implement** — rewrite `static/offline/syncconflict.js` to be entity-aware. Replace the whole factory body (keep the UMD wrapper) with:

```js
  const isNode = (typeof module !== "undefined" && module.exports);
  const req = (m, g) => (isNode ? require(m) : g);
  const TFdb = req("./db.js", root.TF && root.TF.db);
  const TFoutbox = req("./outbox.js", root.TF && root.TF.outbox);
  const TFidmap = req("./idmap.js", root.TF && root.TF.idmap);

  const STORE = { task: "tasks", note: "scratchpad_notes" };

  function getAll(store) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction(store, "readonly").objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  function getRaw(store, cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction(store, "readonly").objectStore(store).get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function putRaw(store, rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function deleteRaw(store, cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function dropOutbox(entity, cid) {
    return TFoutbox.outboxByEntity(entity, cid).then((ops) =>
      ops.reduce((p, o) => p.then(() => TFoutbox.outboxRemove(o.qid)), Promise.resolve()));
  }

  function listConflicts() {
    return Promise.all([getAll("tasks"), getAll("scratchpad_notes")]).then(([tasks, notes]) => {
      const out = [];
      for (const r of tasks) if (r.conflict) out.push({ entity: "task", cid: r.cid, title: r.title, conflict: r.conflict, list_id: r.list_id != null ? r.list_id : null });
      for (const r of notes) if (r.conflict) out.push({ entity: "note", cid: r.cid, title: r.title, conflict: r.conflict, list_id: r.list_id != null ? r.list_id : null });
      return out;
    });
  }

  function resolveConflict(entity, cid, choice) {
    const store = STORE[entity];
    if (!store) return Promise.reject(new Error("unknown entity: " + entity));
    return getRaw(store, cid).then((rec) => {
      if (!rec) return { ok: false };
      const cleanup = dropOutbox(entity, cid)
        .then(() => (rec.server_id != null ? TFidmap.mapDelete(entity, rec.server_id) : null));
      if (choice === "discard") {
        return cleanup.then(() => deleteRaw(store, cid)).then(() => ({ ok: true }));
      }
      if (choice === "keep_as_new") {
        const next = Object.assign({}, rec, { server_id: null, dirty: 1 });
        delete next.conflict;
        return cleanup
          .then(() => putRaw(store, next))
          .then(() => TFoutbox.outboxAdd({ op: "create", entity_type: entity, cid: cid, payload: {} }))
          .then(() => ({ ok: true }));
      }
      return Promise.reject(new Error("unknown choice: " + choice));
    });
  }

  function listNotices() {
    return getAll("scratchpad_notes").then((notes) =>
      notes.filter((r) => r.notice).map((r) => ({ cid: r.cid, kind: r.notice.kind, title: r.notice.title, editor: r.notice.editor != null ? r.notice.editor : null })));
  }

  function dismissNotice(cid) {
    return getRaw("scratchpad_notes", cid).then((rec) => {
      if (!rec) return { ok: false };
      const next = Object.assign({}, rec);
      delete next.notice;
      return putRaw("scratchpad_notes", next).then(() => ({ ok: true }));
    });
  }

  const exported = { listConflicts, resolveConflict, listNotices, dismissNotice };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.syncconflict = exported; }
  return exported;
```

(NOTE: `resolveConflict` signature changed from `(cid, choice)` to `(entity, cid, choice)`. The only call site is `renderConflicts()` in index.html, updated in Task 7.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/syncconflict_notes.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Full suite — NOTE: the existing `syncconflict.test.js` calls `resolveConflict(cid, choice)` and will break.** Update those call sites to `resolveConflict("task", cid, choice)`.

Run: `node --test tests/offline/syncconflict.test.js`
First observe the failures, then in `tests/offline/syncconflict.test.js` change every `resolveConflict(<cid>, <choice>)` call to `resolveConflict("task", <cid>, <choice>)` (the existing tests operate on tasks). Re-run until green.

Then full suite: `node --test tests/offline/*.test.js`
Expected: `pass 328` (324 + 4), `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add static/offline/syncconflict.js tests/offline/syncconflict_notes.test.js tests/offline/syncconflict.test.js
git commit -m "feat(offline): syncconflict handles note conflicts + notices, entity-aware resolve (#2h-2)"
```

---

### Task 7: Wire `index.html` — current user for notes + notice banner + SW v134

**Files:**
- Modify: `static/index.html`
- Modify: `static/sw.js`

- [ ] **Step 1: Set the current user for the notes layer** — in `static/index.html`, find the two `window.TF.chatrepo.setCurrentUser({...})` calls (online auth load ~line 20461 and offline JWT fallback ~line 20473). Immediately after EACH, add the analogous noterepo call with the same identity object:

After the online one:
```js
        if (window.TF && window.TF.noterepo) window.TF.noterepo.setCurrentUser({ user_id: u.id, username: u.username, display_name: u.display_name });
```
After the offline-fallback one:
```js
            if (window.TF && window.TF.noterepo) window.TF.noterepo.setCurrentUser({ user_id: payload.sub, username: payload.username || payload.sub, display_name: payload.display_name || payload.username || payload.sub });
```

- [ ] **Step 2: Update `resolveConflict` call + add the notice banner** — in `renderConflicts()` (~line 1541-1578):

(a) Change the conflict-button handler call `window.TF.syncconflict.resolveConflict(c.cid, choice)` to:
```js
          window.TF.syncconflict.resolveConflict(c.entity || "task", c.cid, choice)
```

(b) The conflict label text currently says "dihapus di perangkat lain". That stays for both task and note conflicts (correct for edit-vs-delete).

(c) After the `list.forEach(...)` block that builds conflict rows (i.e. after the loop, still inside the `.then(list => {...})` or right after `bar.appendChild` logic), append a notices section. Insert this just before the closing of the `listConflicts().then` callback (after the conflict rows are appended, before `}).catch`):

Replace the tail of `renderConflicts` — from the `list.forEach(c => { ... });` end through `}).catch(() => {});` — so it also renders notices. Concretely, after the existing `list.forEach(...)` loop and before `}).catch(() => {});`, add:

```js
    // Dismissable notices (e.g. your offline edit was overwritten; delete refused).
    window.TF.syncconflict.listNotices().then(notices => {
      notices.forEach(n => {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:8px;margin:4px 0;flex-wrap:wrap;";
        const label = document.createElement("span");
        label.textContent = n.kind === "delete_refused"
          ? "🔔 '" + (n.title || "(tanpa judul)") + "' tidak bisa dihapus — hanya pemilik yang bisa menghapus."
          : "🔔 Edit offline-mu pada '" + (n.title || "(tanpa judul)") + "' ditimpa oleh " + (n.editor || "pengguna lain") + ".";
        row.appendChild(label);
        const b = document.createElement("button");
        b.textContent = "Tutup";
        b.style.cssText = "padding:4px 10px;border:1px solid #92400e;border-radius:6px;background:#fff;cursor:pointer;";
        b.onclick = () => { b.disabled = true; window.TF.syncconflict.dismissNotice(n.cid).then(() => renderConflicts()).catch(() => {}); };
        row.appendChild(b);
        bar.appendChild(row);
      });
      if (!bar.children.length) bar.remove();
    }).catch(() => {});
```

ALSO: the early `if (!list.length) { if (bar) bar.remove(); return; }` guard at the top must NOT short-circuit when there are notices but no conflicts. Change that guard to first check notices. Replace:
```js
    if (!list.length) { if (bar) bar.remove(); return; }
```
with:
```js
    if (!list.length) {
      // no conflicts — still may have notices to show
      return window.TF.syncconflict.listNotices().then(notices => {
        if (!notices.length) { if (bar) bar.remove(); return; }
        if (!bar) {
          bar = document.createElement("div");
          bar.id = "tf-conflict-bar";
          bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#fef3c7;border-top:2px solid #f59e0b;padding:10px 14px;font:14px sans-serif;color:#92400e;max-height:40vh;overflow:auto;";
          document.body.appendChild(bar);
        }
        bar.innerHTML = "";
        notices.forEach(n => {
          const row = document.createElement("div");
          row.style.cssText = "display:flex;align-items:center;gap:8px;margin:4px 0;flex-wrap:wrap;";
          const label = document.createElement("span");
          label.textContent = n.kind === "delete_refused"
            ? "🔔 '" + (n.title || "(tanpa judul)") + "' tidak bisa dihapus — hanya pemilik yang bisa menghapus."
            : "🔔 Edit offline-mu pada '" + (n.title || "(tanpa judul)") + "' ditimpa oleh " + (n.editor || "pengguna lain") + ".";
          row.appendChild(label);
          const b = document.createElement("button");
          b.textContent = "Tutup";
          b.style.cssText = "padding:4px 10px;border:1px solid #92400e;border-radius:6px;background:#fff;cursor:pointer;";
          b.onclick = () => { b.disabled = true; window.TF.syncconflict.dismissNotice(n.cid).then(() => renderConflicts()).catch(() => {}); };
          row.appendChild(b);
          bar.appendChild(row);
        });
      });
    }
```

(This makes the banner appear for notices-only state. The conflict-present path then also appends notices via the block in (c).)

- [ ] **Step 3: Bump SW** — in `static/sw.js` line 1, change the cache name to:

```js
const CACHE = "taskflow-v134-sharednotes";
```

(No new module files — only the version bump to refresh the shell. Do NOT add precache entries.)

- [ ] **Step 4: Verify**

Run: `node --test tests/offline/*.test.js` → expect `pass 328`, `fail 0` (UI/SW change doesn't affect the Node suite).

Run: `node -e "const s=require('fs').readFileSync('static/index.html','utf8'); console.log('noteuser:', (s.match(/noterepo\.setCurrentUser/g)||[]).length, 'resolve3:', /resolveConflict\(c\.entity/.test(s), 'notices:', /listNotices/.test(s), 'dismiss:', /dismissNotice/.test(s));"`
Expected: `noteuser: 2 resolve3: true notices: true dismiss: true`

Run: `node -e "const s=require('fs').readFileSync('static/sw.js','utf8'); console.log('v134:', /taskflow-v134-sharednotes/.test(s));"`
Expected: `v134: true`

Inline-script parse: `node -e "const s=require('fs').readFileSync('static/index.html','utf8'); const m=s.match(/<script>[\s\S]*?<\/script>/g)||[]; let bad=0; for(const b of m){try{new Function(b.replace(/^<script>/,'').replace(/<\/script>$/,''));}catch(e){bad++;}} console.log('parse errors:', bad);"`
Expected: `parse errors: 0`

- [ ] **Step 5: Commit**

```bash
git add static/index.html static/sw.js
git commit -m "feat(offline): notes current-user + conflict/notice banner + SW v134 (#2h-2)"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** §1 lift filter → Tasks 2 (notequery) + 5 (syncpull); `notehydrate` is dead code (skipped, documented). §2 noterepo list_id/last_edited_by/setCurrentUser → Task 1. §3 syncpush list_id payload + 404-branch + 403 + delete-403 → Task 4. §4 syncpull lift filter + last_editor + overwrite notice + shared edit-vs-delete → Task 5. §5 `GET /api/lists/:id/notes` + /share-not-intercepted → Task 3. §6 syncconflict notices → Task 6. §7 wiring + SW v134 → Task 7. §8 backend zero changes (no task). §9 tests → each task.
- **notice field generalization:** the spec named the field `overwrite_notice`; the plan uses a single `notice = { kind, title, editor }` field carrying `kind:"overwritten"` (LWW-loss) and `kind:"delete_refused"` (member delete refused), so one notice channel serves both. This is a deliberate, documented refinement.
- **Record-shape consistency:** the canonical record (header) is produced identically by `createNote` (Task 1), `noteFromServer` (Task 5), and consumed by `shape` (Task 2) and `syncconflict` (Task 6). `user_id`, `last_editor_username`, `last_editor_display_name`, `notice` are the new fields, set everywhere a record is built.
- **Signature change risk:** `resolveConflict(cid, choice)` → `resolveConflict(entity, cid, choice)`. Sole call site is `renderConflicts` (Task 7 updates it); the existing `tests/offline/syncconflict.test.js` is updated in Task 6 Step 5.
- **Personal-note regression guard:** Task 4 explicitly tests that personal (`list_id==null`) update-404 STILL re-creates; Task 5's shared-only branches leave personal pull behavior unchanged.
- **Final expected suite count:** 328 (309 baseline + 19 new). Trust `fail 0` over the exact total if a test is split during TDD.
