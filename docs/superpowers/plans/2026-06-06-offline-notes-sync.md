# Offline Notes Sync (#2f-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync notes personal dua-arah — push op note (create/update/delete/pin) dari `_outbox` ke server REST, dan pull perubahan note server ke lokal — dengan extend `syncpush.js` + `syncpull.js`, tanpa modul baru & tanpa perubahan backend.

**Architecture:** Konten note = LWW by `updated_at` (pola task #2c). Edit-vs-delete = local-wins re-create (push update 404 → POST + remap, pola habits). Pin = conditional-PATCH (GET note → PATCH `/pin` hanya bila beda; endpoint server = toggle, tak bump updated_at) + pin tak menandai note `dirty` (orthogonal terhadap LWW konten). Pull = full-list reconcile client-only, personal-only (`list_id==null`), 4-pass (mint cid → LWW konten → delete → pin-adopt).

**Tech Stack:** Vanilla JS UMD modules, IndexedDB (`fake-indexeddb` di Node test), `node:test`. Spec: `docs/superpowers/specs/2026-06-06-offline-notes-sync-design.md`.

---

## Konteks kunci (baca sebelum mulai)

- `serverIdOf(cid)` (idmap) = 1 arg (global by cid). `mapPut(type,serverId,cid)`/`mapDelete(type,serverId)`/`cidOf(type,serverId)`. Notes pakai type `"note"`, tasks `"task"`.
- `outbox`: `outboxAll()`, `outboxRemove(qid)`, `outboxByEntity(type,cid)`, `outboxAdd`.
- `tagrepo.getEntityTags('note',cid)→[{name,color}]`, `setEntityTags('note',cid,names[])`.
- Store `scratchpad_notes` di-key `cid`. Note lokal: `{cid, server_id, title, content, linked_task_cids(JSON), linked_to_cids(JSON), pinned(bool), list_id(null), last_edited_by, created_at, updated_at, deleted, dirty, base_rev}`.
- `syncpush.js` punya: `titleWithTags`, `send(transport,method,path,body)` (reject `__network`), `ok(res)`, `getTaskRaw/putTaskRaw/deleteTaskRaw`, `getHabitRaw/putHabitRaw/deleteHabitRaw`, `processOp(op,transport,tagsFor,habitTagsFor,result)`, `pushOutbox`. **Saat ini `processOp` punya guard `if (op.entity_type === "note") return Promise.resolve();` (dari #2f-1) — diganti handler bertahap; guard dihapus di Task 5.**
- `syncpull.js` punya: `tsEpoch(ts)` (epoch ms, tz-less = UTC), `dropOutbox(cid)` (HARDCODED "task" — digeneralkan di Task 6), `pullTasks`/`pullAndReconcile`/`pullHabits`/`pullHabitLogs`/`pullHabitsAndLogs`. Requires `TFdb/TFids/TFidmap/TFhydrate/TFoutbox` — Task 6 tambah `TFtag`.
- Server: `POST /api/scratchpad` (balas `_scratchpad_row` incl `id`,`updated_at`,`pinned`), `PUT /api/scratchpad/{id}` (404 bila hilang; balas row), `DELETE /api/scratchpad/{id}` (404 bila hilang), `PATCH /api/scratchpad/{id}/pin` (TOGGLE), `GET /api/scratchpad/{id}` (balas row incl `pinned`). `ScratchpadCreate/Update` = `{title, content, tags[], linked_task_id, linked_task_ids[], list_id}`. Server derive `linked_to` dari content.

## File yang disentuh

- **Modify** `static/offline/syncpush.js` — 2 mapper + note store helpers + 4 handler op + dispatch (ganti guard).
- **Modify** `static/offline/noterepo.js` — `togglePin` berhenti set `dirty` (Task 5).
- **Modify** `static/offline/syncpull.js` — generalize `dropOutbox`, `noteFromServer`, `pullNotes`, `pullNotesAndReconcile`.
- **Modify** `tests/offline/syncpush.test.js`, `tests/offline/syncpull.test.js`, `tests/offline/noterepo.test.js`.
- **Modify** `static/index.html` — `sync()` tambah pull notes; hapus `ensureNotes` boot.
- **Modify** `static/sw.js` — bump v127→v128.

---

## Task 1: Push mappers (pure)

**Files:** Modify `static/offline/syncpush.js`; Test `tests/offline/syncpush.test.js`.

- [ ] **Step 1: Write the failing test**

Append to `tests/offline/syncpush.test.js`:

```javascript
const { noteToCreatePayload, noteToUpdatePayload } = require("../../static/offline/syncpush.js");

function note(over) {
  return Object.assign({
    cid: over.cid, server_id: null, title: over.cid, content: "",
    linked_task_cids: "[]", linked_to_cids: "[]", pinned: false, list_id: null,
    created_at: null, updated_at: null, deleted: false, dirty: 1, base_rev: null,
  }, over);
}

test("noteToCreatePayload builds the ScratchpadCreate body with tags + task server ids", () => {
  const p = noteToCreatePayload(note({ cid: "n", title: "Hi", content: "body [[X]]" }), ["work"], [42]);
  assert.equal(p.title, "Hi");
  assert.equal(p.content, "body [[X]]");
  assert.deepEqual(p.tags, ["work"]);
  assert.deepEqual(p.linked_task_ids, [42]);
  assert.equal(p.list_id, null);
});

test("noteToUpdatePayload has the same shape as create", () => {
  const p = noteToUpdatePayload(note({ cid: "n", title: "T", content: "c" }), ["a"], []);
  assert.equal(p.title, "T");
  assert.equal(p.content, "c");
  assert.deepEqual(p.tags, ["a"]);
  assert.deepEqual(p.linked_task_ids, []);
  assert.equal(p.list_id, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/syncpush.test.js`
Expected: FAIL — `noteToCreatePayload is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `static/offline/syncpush.js`, after `checkinPayload` (the habit payload mappers), add:

```javascript
  function noteToCreatePayload(record, tagNames, taskServerIds) {
    return {
      title: record.title != null ? record.title : "",
      content: record.content != null ? record.content : "",
      tags: tagNames || [],
      linked_task_ids: taskServerIds || [],
      list_id: null,
    };
  }
  function noteToUpdatePayload(record, tagNames, taskServerIds) {
    return noteToCreatePayload(record, tagNames, taskServerIds);
  }
```

Add both to the `exported` object (keep existing keys), e.g.:

```javascript
  const exported = { taskToCreatePayload, taskToUpdatePayload, markPayload, habitToCreatePayload, habitToUpdatePayload, checkinPayload, noteToCreatePayload, noteToUpdatePayload, pushOutbox };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/syncpush.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add static/offline/syncpush.js tests/offline/syncpush.test.js
git commit -m "feat(offline): note push payload mappers (#2f-2)"
```

---

## Task 2: Handler push note/create

**Files:** Modify `static/offline/syncpush.js`; Test `tests/offline/syncpush.test.js`.

- [ ] **Step 1: Write the failing test**

Append to `tests/offline/syncpush.test.js`:

```javascript
const { mapPut: _mapPutN, cidOf: _cidOfN } = require("../../static/offline/idmap.js");
const { setEntityTags: _setTagsN } = require("../../static/offline/tagrepo.js");

async function getNote(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("scratchpad_notes").objectStore("scratchpad_notes").get(cid); q.onsuccess = () => res(q.result); });
}

test("pushOutbox note create POSTs to /api/scratchpad, sets server_id + idmap + base_rev", async () => {
  await put("scratchpad_notes", [note({ cid: "n", title: "Hi", content: "x", linked_task_cids: '["tc"]' })]);
  await put("tasks", [{ cid: "tc", server_id: 88, title: "T", deleted: false }]);
  await _mapPutN("task", 88, "tc");
  await _setTagsN("note", "n", ["work"]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "note", cid: "n", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 200, data: { id: 50, updated_at: "2026-06-06T10:00:00" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[0].method, "POST");
  assert.equal(tr.calls[0].path, "/api/scratchpad");
  assert.deepEqual(tr.calls[0].body.tags, ["work"]);
  assert.deepEqual(tr.calls[0].body.linked_task_ids, [88]);
  assert.equal(await serverIdOf("n"), 50);
  const rec = await getNote("n");
  assert.equal(rec.server_id, 50);
  assert.equal(rec.dirty, 0);
  assert.equal(rec.base_rev, "2026-06-06T10:00:00");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/syncpush.test.js`
Expected: FAIL — note create op is *held* by the guard (no POST; `pushed` 0).

- [ ] **Step 3: Write minimal implementation**

In `static/offline/syncpush.js`, add note store helpers after the habit store helpers (`deleteHabitRaw`):

```javascript
  function getNoteRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("scratchpad_notes", "readonly").objectStore("scratchpad_notes").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function putNoteRaw(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("scratchpad_notes", "readwrite");
      tx.objectStore("scratchpad_notes").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function deleteNoteRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("scratchpad_notes", "readwrite");
      tx.objectStore("scratchpad_notes").delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function noteTagNames(cid) {
    return TFtag.getEntityTags("note", cid).then((ts) => ts.map((t) => t.name));
  }
  function linkedTaskServerIds(rec) {
    let cids; try { cids = JSON.parse(rec.linked_task_cids || "[]"); } catch (_) { cids = []; }
    return cids.reduce((p, c) => p.then((acc) => TFidmap.serverIdOf(c).then((sid) => { if (sid != null) acc.push(sid); return acc; })), Promise.resolve([]));
  }
```

Add the create handler after the habit handlers:

```javascript
  function opNoteCreate(op, transport, result) {
    return getNoteRaw(op.cid).then((rec) => {
      if (!rec) return TFoutbox.outboxRemove(op.qid);
      if (rec.server_id != null) return TFoutbox.outboxRemove(op.qid);
      return Promise.all([noteTagNames(op.cid), linkedTaskServerIds(rec)]).then(([tags, taskSids]) =>
        send(transport, "POST", "/api/scratchpad", noteToCreatePayload(rec, tags, taskSids)).then((res) => {
          if (ok(res)) {
            const sid = res.data.id;
            return TFidmap.mapPut("note", sid, op.cid)
              .then(() => putNoteRaw(Object.assign({}, rec, { server_id: sid, dirty: 0, base_rev: res.data && res.data.updated_at != null ? res.data.updated_at : rec.base_rev })))
              .then(() => TFoutbox.outboxRemove(op.qid))
              .then(() => { result.pushed++; });
          }
          result.failed++;
          return TFoutbox.outboxRemove(op.qid);
        })
      );
    });
  }
```

In `processOp`, add the create dispatch line ABOVE the existing note guard (`if (op.entity_type === "note") return Promise.resolve();`):

```javascript
    if (op.entity_type === "note" && op.op === "create") return opNoteCreate(op, transport, result);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/syncpush.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add static/offline/syncpush.js tests/offline/syncpush.test.js
git commit -m "feat(offline): push note create (#2f-2)"
```

---

## Task 3: Handler push note/update (incl. 404 → re-create)

**Files:** Modify `static/offline/syncpush.js`; Test `tests/offline/syncpush.test.js`.

- [ ] **Step 1: Write the failing test**

Append to `tests/offline/syncpush.test.js`:

```javascript
test("pushOutbox note update PUTs and sets dirty 0 + base_rev", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, title: "T", content: "c" })]);
  await _mapPutN("note", 7, "n");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "note", cid: "n", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 200, data: { id: 7, updated_at: "2026-06-06T11:00:00" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[0].method, "PUT");
  assert.equal(tr.calls[0].path, "/api/scratchpad/7");
  const rec = await getNote("n");
  assert.equal(rec.dirty, 0);
  assert.equal(rec.base_rev, "2026-06-06T11:00:00");
});

test("pushOutbox note update 404 re-creates the note and remaps server_id", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, title: "T", content: "c" })]);
  await _mapPutN("note", 7, "n");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "note", cid: "n", payload: {} }]);
  let i = 0;
  const tr = fakeTransport(() => (i++ === 0 ? { status: 404, data: { detail: "gone" } } : { status: 200, data: { id: 99, updated_at: "2026-06-06T12:00:00" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[1].method, "POST");
  assert.equal(tr.calls[1].path, "/api/scratchpad");
  assert.equal(await serverIdOf("n"), 99);
  assert.equal(await _cidOfN("note", 7), undefined);
  const rec = await getNote("n");
  assert.equal(rec.server_id, 99);
  assert.equal(rec.dirty, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/syncpush.test.js`
Expected: FAIL — note update op held by guard (no PUT; `pushed` 0).

- [ ] **Step 3: Write minimal implementation**

Add the update handler after `opNoteCreate`:

```javascript
  function opNoteUpdate(op, transport, result) {
    return Promise.all([getNoteRaw(op.cid), TFidmap.serverIdOf(op.cid)]).then(([rec, sid]) => {
      if (!rec || sid == null) return TFoutbox.outboxRemove(op.qid);
      return Promise.all([noteTagNames(op.cid), linkedTaskServerIds(rec)]).then(([tags, taskSids]) =>
        send(transport, "PUT", "/api/scratchpad/" + sid, noteToUpdatePayload(rec, tags, taskSids)).then((res) => {
          if (ok(res)) {
            return putNoteRaw(Object.assign({}, rec, { dirty: 0, base_rev: res.data && res.data.updated_at != null ? res.data.updated_at : rec.base_rev }))
              .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; });
          }
          if (res.status === 404) {
            // note deleted on server → local-wins: re-create, then remap idmap
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
          result.failed++;
          return TFoutbox.outboxRemove(op.qid);
        })
      );
    });
  }
```

Add dispatch in `processOp` (after the note create line, above the guard):

```javascript
    if (op.entity_type === "note" && op.op === "update") return opNoteUpdate(op, transport, result);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/syncpush.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add static/offline/syncpush.js tests/offline/syncpush.test.js
git commit -m "feat(offline): push note update with 404 re-create (#2f-2)"
```

---

## Task 4: Handler push note/delete

**Files:** Modify `static/offline/syncpush.js`; Test `tests/offline/syncpush.test.js`.

- [ ] **Step 1: Write the failing test**

Append to `tests/offline/syncpush.test.js`:

```javascript
test("pushOutbox note delete DELETEs, hard-deletes local + idmap", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, deleted: true })]);
  await _mapPutN("note", 7, "n");
  await put("_outbox", [{ qid: 1, op: "delete", entity_type: "note", cid: "n", payload: { cid: "n" } }]);
  const tr = fakeTransport(() => ({ status: 200, data: { ok: true } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[0].method, "DELETE");
  assert.equal(tr.calls[0].path, "/api/scratchpad/7");
  assert.equal(await getNote("n"), undefined);
  assert.equal(await _cidOfN("note", 7), undefined);
});

test("pushOutbox note delete with no server_id just drops op + local record", async () => {
  await put("scratchpad_notes", [note({ cid: "n", deleted: true })]);
  await put("_outbox", [{ qid: 1, op: "delete", entity_type: "note", cid: "n", payload: { cid: "n" } }]);
  const tr = fakeTransport(() => { throw new Error("should not call"); });
  const r = await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);
  assert.equal(r.remaining, 0);
  assert.equal(await getNote("n"), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/syncpush.test.js`
Expected: FAIL — note delete op held by guard (no DELETE; record `n` still present).

- [ ] **Step 3: Write minimal implementation**

Add the delete handler after `opNoteUpdate`:

```javascript
  function opNoteDelete(op, transport, result) {
    return TFidmap.serverIdOf(op.cid).then((sid) => {
      if (sid == null) {
        return deleteNoteRaw(op.cid).then(() => TFoutbox.outboxRemove(op.qid));
      }
      return send(transport, "DELETE", "/api/scratchpad/" + sid, undefined).then((res) => {
        if (ok(res) || res.status === 404) {
          return TFidmap.mapDelete("note", sid)
            .then(() => deleteNoteRaw(op.cid))
            .then(() => TFoutbox.outboxRemove(op.qid))
            .then(() => { result.pushed++; });
        }
        result.failed++;
        return TFoutbox.outboxRemove(op.qid);
      });
    });
  }
```

Add dispatch in `processOp` (after the note update line):

```javascript
    if (op.entity_type === "note" && op.op === "delete") return opNoteDelete(op, transport, result);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/syncpush.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add static/offline/syncpush.js tests/offline/syncpush.test.js
git commit -m "feat(offline): push note delete (#2f-2)"
```

---

## Task 5: Handler push note/pin (conditional) + remove guard + togglePin dirty tweak

**Files:** Modify `static/offline/syncpush.js`, `static/offline/noterepo.js`; Test `tests/offline/syncpush.test.js`.

- [ ] **Step 1: Write the failing test**

Append to `tests/offline/syncpush.test.js`:

```javascript
test("pushOutbox note pin GETs then PATCHes /pin only when server differs", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, pinned: true })]);
  await _mapPutN("note", 7, "n");
  await put("_outbox", [{ qid: 1, op: "pin", entity_type: "note", cid: "n", payload: { pinned: true } }]);
  const tr = fakeTransport((m, p) => {
    if (m === "GET") return { status: 200, data: { id: 7, pinned: false } }; // server differs → must PATCH
    return { status: 200, data: { id: 7, pinned: true } };
  });
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[0].method, "GET");
  assert.equal(tr.calls[1].method, "PATCH");
  assert.equal(tr.calls[1].path, "/api/scratchpad/7/pin");
  assert.equal(r.remaining, 0);
});

test("pushOutbox note pin is a no-op PATCH when server already matches", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, pinned: true })]);
  await _mapPutN("note", 7, "n");
  await put("_outbox", [{ qid: 1, op: "pin", entity_type: "note", cid: "n", payload: { pinned: true } }]);
  const tr = fakeTransport(() => ({ status: 200, data: { id: 7, pinned: true } })); // already pinned
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls.length, 1); // only the GET, no PATCH
  assert.equal(tr.calls[0].method, "GET");
});
```

Also append a togglePin test to `tests/offline/noterepo.test.js`:

```javascript
test("togglePin records a pin op without forcing the note dirty", async () => {
  await put("scratchpad_notes", [{ cid: "n", server_id: 5, title: "N", content: "", linked_task_cids: "[]", linked_to_cids: "[]", pinned: false, list_id: null, deleted: false, dirty: 0 }]);
  const r = await togglePin("n", {});
  assert.equal(r.pinned, true);
  assert.equal(r.dirty, 0); // pin does not mark content dirty
  const ops = (await outboxAll()).filter((o) => o.op === "pin");
  assert.equal(ops.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/syncpush.test.js tests/offline/noterepo.test.js`
Expected: FAIL — pin op held by guard; and togglePin currently sets `dirty:1` so the noterepo test fails on `r.dirty === 0`.

- [ ] **Step 3: Write minimal implementation**

In `static/offline/syncpush.js`, add the pin handler after `opNoteDelete`:

```javascript
  function opNotePin(op, transport, result) {
    return Promise.all([getNoteRaw(op.cid), TFidmap.serverIdOf(op.cid)]).then(([rec, sid]) => {
      if (!rec || sid == null) return TFoutbox.outboxRemove(op.qid);
      return send(transport, "GET", "/api/scratchpad/" + sid, undefined).then((res) => {
        if (!ok(res)) { result.failed++; return TFoutbox.outboxRemove(op.qid); }
        if (!!(res.data && res.data.pinned) === !!rec.pinned) {
          return TFoutbox.outboxRemove(op.qid).then(() => { result.pushed++; }); // already in sync
        }
        return send(transport, "PATCH", "/api/scratchpad/" + sid + "/pin", undefined).then((res2) => {
          if (ok(res2)) { return TFoutbox.outboxRemove(op.qid).then(() => { result.pushed++; }); }
          result.failed++;
          return TFoutbox.outboxRemove(op.qid);
        });
      });
    });
  }
```

In `processOp`: add the pin dispatch AND remove the now-obsolete note guard. The note section should read:

```javascript
    if (op.entity_type === "note" && op.op === "create") return opNoteCreate(op, transport, result);
    if (op.entity_type === "note" && op.op === "update") return opNoteUpdate(op, transport, result);
    if (op.entity_type === "note" && op.op === "delete") return opNoteDelete(op, transport, result);
    if (op.entity_type === "note" && op.op === "pin") return opNotePin(op, transport, result);
```

(Delete the line `if (op.entity_type === "note") return Promise.resolve();` — all four note ops are now dispatched; the trailing `return TFoutbox.outboxRemove(op.qid);` fall-through remains for genuinely unknown ops.)

In `static/offline/noterepo.js`, change `togglePin` so it no longer forces `dirty` (pin is tracked solely by the outbox `pin` op and is orthogonal to content LWW):

```javascript
  function togglePin(cid, opts) {
    return getNoteRaw(cid).then((rec) => {
      if (!rec || rec.deleted) return Promise.reject(new Error("Note not found"));
      const next = Object.assign({}, rec, { pinned: !rec.pinned });
      return putNote(next)
        .then(() => TFoutbox.outboxAdd({ op: "pin", entity_type: "note", cid: cid, payload: { pinned: next.pinned } }))
        .then(() => next);
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/syncpush.test.js tests/offline/noterepo.test.js`
Expected: PASS both files.

- [ ] **Step 5: Commit**

```bash
git add static/offline/syncpush.js static/offline/noterepo.js tests/offline/syncpush.test.js tests/offline/noterepo.test.js
git commit -m "feat(offline): push note pin (conditional) + pin no longer marks dirty (#2f-2)"
```

---

## Task 6: Pull notes — reconcile (passes 1-3) + dropOutbox generalize + noteFromServer

**Files:** Modify `static/offline/syncpull.js`; Test `tests/offline/syncpull.test.js`.

- [ ] **Step 1: Write the failing test**

Append to `tests/offline/syncpull.test.js`:

```javascript
const { pullNotes } = require("../../static/offline/syncpull.js");
const { setEntityTags: _setTagsNp, getEntityTags: _getTagsNp } = require("../../static/offline/tagrepo.js");
const { cidOf: _cidOfNp } = require("../../static/offline/idmap.js");

async function putNotes(recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("scratchpad_notes", "readwrite");
    const os = tx.objectStore("scratchpad_notes");
    for (const r of recs) os.put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function getNoteRec(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("scratchpad_notes").objectStore("scratchpad_notes").get(cid); q.onsuccess = () => res(q.result); });
}
async function allNotesP() {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("scratchpad_notes").objectStore("scratchpad_notes").getAll(); q.onsuccess = () => res(q.result || []); });
}
function srvNote(over) {
  return Object.assign({
    id: over.id, title: "N", content: "", tags: [], linked_to: [], linked_task_ids: [],
    pinned: false, list_id: null, created_at: "2026-06-01T00:00:00", updated_at: "2026-06-02T00:00:00",
  }, over);
}
function localNote(over) {
  return Object.assign({
    cid: over.cid, server_id: null, title: over.cid, content: "", linked_task_cids: "[]", linked_to_cids: "[]",
    pinned: false, list_id: null, created_at: null, updated_at: "2026-06-01T00:00:00", base_rev: "2026-06-01T00:00:00",
    deleted: false, dirty: 0,
  }, over);
}

test("pullNotes creates an unknown personal server note (dirty 0, base_rev, tags)", async () => {
  const r = await pullNotes([srvNote({ id: 5, title: "New", tags: ["x"], updated_at: "2026-06-03T00:00:00" })]);
  assert.equal(r.created, 1);
  const rows = await allNotesP();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].server_id, 5);
  assert.equal(rows[0].dirty, 0);
  assert.equal(rows[0].base_rev, "2026-06-03T00:00:00");
  const tags = await _getTagsNp("note", rows[0].cid);
  assert.deepEqual(tags.map((t) => t.name), ["x"]);
});

test("pullNotes skips shared notes (list_id != null)", async () => {
  const r = await pullNotes([srvNote({ id: 5, list_id: 9 })]);
  assert.equal(r.created, 0);
  assert.equal((await allNotesP()).length, 0);
});

test("pullNotes updates a clean local note when updated_at differs", async () => {
  await putNotes([localNote({ cid: "n", server_id: 5, title: "Old", base_rev: "2026-06-01T00:00:00" })]);
  await mapPut("note", 5, "n");
  const r = await pullNotes([srvNote({ id: 5, title: "New", updated_at: "2026-06-05T00:00:00" })]);
  assert.equal(r.updated, 1);
  assert.equal((await getNoteRec("n")).title, "New");
  assert.equal((await getNoteRec("n")).base_rev, "2026-06-05T00:00:00");
});

test("pullNotes edit-vs-edit LWW: server newer wins and drops outbox", async () => {
  await putNotes([localNote({ cid: "n", server_id: 5, title: "Local", base_rev: "2026-06-01T00:00:00", updated_at: "2026-06-04T01:00:00.000Z", dirty: 1 })]);
  await mapPut("note", 5, "n");
  await outboxAdd({ op: "update", entity_type: "note", cid: "n", payload: {} });
  const r = await pullNotes([srvNote({ id: 5, title: "Server", updated_at: "2026-06-04T05:00:00" })]);
  assert.equal(r.lwwResolved, 1);
  assert.equal((await getNoteRec("n")).title, "Server");
  assert.equal((await getNoteRec("n")).dirty, 0);
  assert.equal((await outboxAll()).length, 0);
});

test("pullNotes edit-vs-edit LWW: local newer wins and keeps local + outbox", async () => {
  await putNotes([localNote({ cid: "n", server_id: 5, title: "Local", base_rev: "2026-06-01T00:00:00", updated_at: "2026-06-04T09:00:00.000Z", dirty: 1 })]);
  await mapPut("note", 5, "n");
  await outboxAdd({ op: "update", entity_type: "note", cid: "n", payload: {} });
  const r = await pullNotes([srvNote({ id: 5, title: "Server", updated_at: "2026-06-04T02:00:00" })]);
  assert.equal((await getNoteRec("n")).title, "Local");
  assert.equal((await outboxAll()).length, 1);
});

test("pullNotes deletes a clean local note whose server_id vanished + clears idmap", async () => {
  await putNotes([localNote({ cid: "n", server_id: 5, dirty: 0 })]);
  await mapPut("note", 5, "n");
  const r = await pullNotes([]);
  assert.equal(r.deleted, 1);
  assert.equal(await getNoteRec("n"), undefined);
  assert.equal(await _cidOfNp("note", 5), undefined);
});

test("pullNotes does NOT delete a dirty local note missing from server", async () => {
  await putNotes([localNote({ cid: "n", server_id: 5, dirty: 1 })]);
  await mapPut("note", 5, "n");
  const r = await pullNotes([]);
  assert.equal(r.deleted, 0);
  assert.equal(r.skipped, 1);
  assert.notEqual(await getNoteRec("n"), undefined);
});

test("pullNotes resolves linked_to server ids to cids across the batch", async () => {
  const r = await pullNotes([
    srvNote({ id: 1, title: "A", linked_to: [2] }),
    srvNote({ id: 2, title: "B" }),
  ]);
  assert.equal(r.created, 2);
  const rows = await allNotesP();
  const a = rows.find((x) => x.server_id === 1);
  const bCid = await _cidOfNp("note", 2);
  assert.deepEqual(JSON.parse(a.linked_to_cids), [bCid]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/syncpull.test.js`
Expected: FAIL — `pullNotes is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `static/offline/syncpull.js`, add the `TFtag` require near the other requires:

```javascript
  const TFtag = req("./tagrepo.js", root.TF && root.TF.tagrepo);
```

Generalize `dropOutbox` to take an entity type, and update its task call site. Change the helper from `function dropOutbox(cid)` to:

```javascript
  function dropOutbox(entityType, cid) {
    return TFoutbox.outboxByEntity(entityType, cid).then((ops) =>
      ops.reduce((p, o) => p.then(() => TFoutbox.outboxRemove(o.qid)), Promise.resolve()));
  }
```

Then in `pullTasks`, the existing server-wins LWW branch calls `dropOutbox(cid)` — change it to `dropOutbox("task", cid)`.

Add note helpers + `noteFromServer` + `pullNotes` before the `exported` line:

```javascript
  function getAllNotes() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("scratchpad_notes", "readonly").objectStore("scratchpad_notes").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  function putNote(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("scratchpad_notes", "readwrite");
      tx.objectStore("scratchpad_notes").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function deleteNoteRec(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("scratchpad_notes", "readwrite");
      tx.objectStore("scratchpad_notes").delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function ensureNoteCid(serverId, cache) {
    if (cache[serverId]) return Promise.resolve(cache[serverId]);
    return TFidmap.cidOf("note", serverId).then((cid) => {
      if (cid) { cache[serverId] = cid; return cid; }
      const fresh = TFids.newCid();
      cache[serverId] = fresh;
      return TFidmap.mapPut("note", serverId, fresh).then(() => fresh);
    });
  }
  function noteFromServer(s, cid, noteCidCache) {
    const toCids = (s.linked_to || []).map((sid) => noteCidCache[sid]).filter(Boolean);
    const taskIds = s.linked_task_ids || [];
    return taskIds.reduce((p, tid) => p.then((acc) => TFidmap.cidOf("task", tid).then((c) => { if (c) acc.push(c); return acc; })), Promise.resolve([]))
      .then((taskCids) => ({
        cid: cid, server_id: s.id, title: s.title != null ? s.title : "", content: s.content != null ? s.content : "",
        linked_to_cids: JSON.stringify(toCids), linked_task_cids: JSON.stringify(taskCids),
        pinned: !!s.pinned, list_id: null, last_edited_by: s.last_edited_by != null ? s.last_edited_by : null,
        created_at: s.created_at != null ? s.created_at : null, updated_at: s.updated_at != null ? s.updated_at : null,
        deleted: false, dirty: 0, base_rev: s.updated_at != null ? s.updated_at : null,
      }));
  }
  function writeNote(s, cid, cache) {
    return noteFromServer(s, cid, cache).then((rec) => putNote(rec)).then(() => TFtag.setEntityTags("note", cid, s.tags || []));
  }

  function pullNotes(serverNotes) {
    const list = (serverNotes || []).filter((s) => s.list_id == null);
    const cache = {};
    return list.reduce((p, s) => p.then(() => ensureNoteCid(s.id, cache)), Promise.resolve())
      .then(() => getAllNotes())
      .then((localAll) => {
        const byCid = {}; for (const r of localAll) byCid[r.cid] = r;
        const result = { created: 0, updated: 0, deleted: 0, skipped: 0, lwwResolved: 0, pinned: 0 };
        let chain = Promise.resolve();
        for (const s of list) {
          const cid = cache[s.id];
          const local = byCid[cid];
          chain = chain.then(() => {
            if (!local) { result.created++; return writeNote(s, cid, cache); }
            if (local.conflict) { result.skipped++; return; }
            if (local.dirty) {
              if (s.updated_at !== local.base_rev) {
                result.lwwResolved++;
                if (tsEpoch(s.updated_at) > tsEpoch(local.updated_at)) {
                  return dropOutbox("note", cid).then(() => writeNote(s, cid, cache)); // server wins
                }
                return; // local wins
              }
              result.skipped++; return;
            }
            if (s.updated_at !== local.base_rev) { result.updated++; return writeNote(s, cid, cache); }
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
            return deleteNoteRec(r.cid).then(() => TFidmap.mapDelete("note", r.server_id));
          });
        }
        return chain.then(() => result);
      });
  }
```

Update the `exported` line to add `pullNotes`:

```javascript
  const exported = { pullTasks, pullAndReconcile, pullHabits, pullHabitLogs, pullHabitsAndLogs, pullNotes };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/syncpull.test.js`
Expected: PASS (existing pullTasks/pullHabits tests still green — you changed `dropOutbox` signature + its one call site).

- [ ] **Step 5: Commit**

```bash
git add static/offline/syncpull.js tests/offline/syncpull.test.js
git commit -m "feat(offline): pull notes reconcile + LWW (#2f-2)"
```

---

## Task 7: Pull notes — pin adoption (pass 4) + pullNotesAndReconcile

**Files:** Modify `static/offline/syncpull.js`; Test `tests/offline/syncpull.test.js`.

- [ ] **Step 1: Write the failing test**

Append to `tests/offline/syncpull.test.js`:

```javascript
const { pullNotesAndReconcile } = require("../../static/offline/syncpull.js");

test("pullNotes adopts server pinned for a clean note with no pending pin op", async () => {
  await putNotes([localNote({ cid: "n", server_id: 5, base_rev: "2026-06-02T00:00:00", pinned: false })]);
  await mapPut("note", 5, "n");
  const r = await pullNotes([srvNote({ id: 5, pinned: true, updated_at: "2026-06-02T00:00:00" })]); // updated_at unchanged → only pin differs
  assert.equal(r.pinned, 1);
  assert.equal((await getNoteRec("n")).pinned, true);
});

test("pullNotes does NOT adopt server pinned when a pin op is pending", async () => {
  await putNotes([localNote({ cid: "n", server_id: 5, base_rev: "2026-06-02T00:00:00", pinned: true })]);
  await mapPut("note", 5, "n");
  await outboxAdd({ op: "pin", entity_type: "note", cid: "n", payload: { pinned: true } });
  const r = await pullNotes([srvNote({ id: 5, pinned: false, updated_at: "2026-06-02T00:00:00" })]);
  assert.equal(r.pinned, 0);
  assert.equal((await getNoteRec("n")).pinned, true); // local pin intent preserved
});

test("pullNotesAndReconcile fetches /api/scratchpad and reconciles", async () => {
  const rawFetch = () => Promise.resolve({ json: () => Promise.resolve([srvNote({ id: 5, title: "P", updated_at: "2026-06-03T00:00:00" })]) });
  const r = await pullNotesAndReconcile(rawFetch);
  assert.equal(r.created, 1);
  assert.equal((await allNotesP()).length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/syncpull.test.js`
Expected: FAIL — pin not adopted (`r.pinned` 0 for the first test) and `pullNotesAndReconcile is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `static/offline/syncpull.js`, inside `pullNotes`, add pass 4 right before `return chain.then(() => result);` (after the delete loop):

```javascript
        // pass 4: adopt server pinned for notes with no pending pin op (pin is orthogonal to updated_at).
        chain = chain.then(() => TFoutbox.outboxAll().then((ops) => {
          const pendingPin = new Set(ops.filter((o) => o.entity_type === "note" && o.op === "pin").map((o) => o.cid));
          return getAllNotes().then((fresh) => {
            const freshByCid = {}; for (const r of fresh) freshByCid[r.cid] = r;
            let c2 = Promise.resolve();
            for (const s of list) {
              const cid = cache[s.id];
              const local = freshByCid[cid];
              if (!local || pendingPin.has(cid)) continue;
              if (!!local.pinned !== !!s.pinned) {
                c2 = c2.then(() => { result.pinned++; return putNote(Object.assign({}, local, { pinned: !!s.pinned })); });
              }
            }
            return c2;
          });
        }));
```

Add `pullNotesAndReconcile` after `pullNotes`:

```javascript
  function pullNotesAndReconcile(rawFetch) {
    return Promise.resolve(rawFetch("/api/scratchpad"))
      .then((res) => (res && typeof res.json === "function" ? res.json() : res))
      .then((list) => pullNotes(list || []));
  }
```

Update the `exported` line to add `pullNotesAndReconcile`:

```javascript
  const exported = { pullTasks, pullAndReconcile, pullHabits, pullHabitLogs, pullHabitsAndLogs, pullNotes, pullNotesAndReconcile };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/syncpull.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add static/offline/syncpull.js tests/offline/syncpull.test.js
git commit -m "feat(offline): pull notes pin adoption + pullNotesAndReconcile (#2f-2)"
```

---

## Task 8: Wire notes pull into sync() + drop ensureNotes boot

**Files:** Modify `static/index.html`.

- [ ] **Step 1: Add notes pull to sync()**

In `static/index.html`, find `function sync()` (the chain currently does `pullAndReconcile` → `pullAndReconcileLists` → `pullHabitsAndLogs` → `pushOutbox`). Add a notes pull step right before `pushOutbox`:

```javascript
    .then(() => (window.TF.syncpull.pullHabitsAndLogs ? window.TF.syncpull.pullHabitsAndLogs(__syncRawFetch) : null))
    .then(() => (window.TF.syncpull.pullNotesAndReconcile ? window.TF.syncpull.pullNotesAndReconcile(__syncRawFetch) : null))
    .then(() => window.TF.syncpush.pushOutbox(__syncTransport))
```

- [ ] **Step 2: Remove the ensureNotes boot call**

Find the boot block (`if (navigator.onLine && __token) { try { await sync(); } catch (e) {} ... }`) which now contains:

```javascript
      try { if (window.TF && window.TF.notehydrate) await window.TF.notehydrate.ensureNotes(__syncRawFetch); } catch (e) {}
```

Delete that `notehydrate.ensureNotes` line (notes are now pulled inside `sync()` — `pullNotes` supersedes it, like `pullHabits` superseded `ensureHabits`). The block becomes just `try { await sync(); } catch (e) {}`.

- [ ] **Step 3: Syntax-check inline scripts**

Run (PowerShell, root repo):

```powershell
node -e "const fs=require('fs');const h=fs.readFileSync('static/index.html','utf8');const m=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)];let i=0,err=0;for(const x of m){try{new Function(x[1]);}catch(e){console.log('SCRIPT',i,'ERR',e.message);err++;}i++;}console.log('checked',m.length,'inline scripts, errors:',err);"
```

Expected: `errors: 0`.

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "feat(offline): wire notes pull into sync, drop ensureNotes boot (#2f-2)"
```

---

## Task 9: Bump service worker cache

**Files:** Modify `static/sw.js`.

- [ ] **Step 1: Bump CACHE version**

In `static/sw.js` line 1, change:

```javascript
const CACHE = "taskflow-v127-notes-local";
```
to:
```javascript
const CACHE = "taskflow-v128-notes-sync";
```

(No new modules — `syncpush.js`/`syncpull.js`/`noterepo.js` are already in STATIC. Version string only.)

- [ ] **Step 2: Commit**

```bash
git add static/sw.js
git commit -m "chore(sw): bump cache v128 (notes sync)"
```

---

## Task 10: Full suite + deploy + browser verify

- [ ] **Step 1: Run the whole offline suite**

Run (root repo Z:): `node --test tests/offline/*.test.js`
Expected: `fail 0`; pass = 234 + new note tests (target ~255+).

- [ ] **Step 2: Merge ff to main + push**

```bash
git checkout main
git merge --ff-only <branch>
git push origin main
```
(Skip if working directly on `main`.)

- [ ] **Step 3: Verify deploy (backend unchanged — no taskflow-web restart)**

Run: `curl -s https://todo.yatno.web.id/sw.js | findstr CACHE`
Expected: `const CACHE = "taskflow-v128-notes-sync";` (see [[feedback_deploy_silent_fail]]).

- [ ] **Step 4: Browser verify (reset SW first in the login tab)**

In DevTools console (https://todo.yatno.web.id), unregister SW + clear caches + reload, then:
1. Offline: create/edit a note → online → `window.__syncNow()` → note appears/updates on the server (check via another web session).
2. Pin a note offline → `__syncNow()` → pin reflected on server; pin a note on the web → `__syncNow()` → local pin follows.
3. Delete a note offline → `__syncNow()` → gone on server; delete a note on the web → `__syncNow()` → gone locally.
4. Edit a note locally while it is deleted on the web → `__syncNow()` → note re-created (edit survives).
5. Tasks & habits still sync; no console errors.

Record result (e.g. "5/5 ✅") for the [[project_offline_native]] memory update.

---

## Self-review notes

- **Spec coverage:** mappers (T1); create (T2), update+404-recreate (T3), delete (T4), pin conditional + guard removal + togglePin dirty tweak (T5); pull passes 1-3 + dropOutbox generalize + noteFromServer (T6); pull pass-4 pin + pullNotesAndReconcile (T7); sync() wiring + drop ensureNotes (T8); SW v128 (T9); suite+deploy+browser (T10). All spec sections covered.
- **No backend change:** confirmed — all endpoints predate this slice.
- **Type/name consistency:** `noteToCreatePayload/noteToUpdatePayload`, `opNoteCreate/Update/Delete/Pin`, `getNoteRaw/putNoteRaw/deleteNoteRaw`, `noteTagNames`, `linkedTaskServerIds` (syncpush); `pullNotes/pullNotesAndReconcile/noteFromServer/writeNote/ensureNoteCid/getAllNotes/putNote/deleteNoteRec`, `dropOutbox(entityType,cid)` (syncpull). idmap `serverIdOf(cid)` 1-arg; `mapPut/mapDelete/cidOf(type,serverId)`.
- **dropOutbox signature change:** generalized to `(entityType, cid)`; the single existing task call site updated to `dropOutbox("task", cid)` (T6 Step 3) — verify no other call sites by reading syncpull.js.
- **Pin/dirty interplay:** `togglePin` no longer marks the note dirty (T5), so a pin-only note stays `dirty:0` and pull pass-2 won't skip its content reconcile; pull pass-4 honors a pending pin op so local pin intent isn't clobbered. This is the key correctness fix for pin.
- **Guard removal:** the #2f-1 note-hold guard in `processOp` is removed in T5 once all four note handlers dispatch.
