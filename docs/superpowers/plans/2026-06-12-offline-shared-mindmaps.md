# Collaborative Shared Mindmaps (#2h-3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make shared mindmaps collaboratively editable (backend: owner→owner-or-member access + last_edited_by + non-owner-delete 403) and offline-capable (extend the #2g mindmap offline machinery to shared mindmaps with LWW + notice, mirroring #2h-2 shared notes).

**Architecture:** Backend broadens mindmap access via a `_mindmap_access_clause` (like notes), adds a `last_edited_by` column, and returns 403 for non-owner delete. Offline: lift the personal-only filter in mindmaprepo/mindmaproutes/syncpull, thread collaborator metadata, intercept the list-scoped route, add member-permission edges to the push handlers, and extend the already entity-aware `syncconflict` with the `mindmap` entity. No offline DB bump.

**Tech Stack:** FastAPI + SQLite (backend); vanilla UMD modules + IndexedDB (offline, fake-indexeddb in tests); `node --test`.

**Reference spec:** `docs/superpowers/specs/2026-06-12-offline-shared-mindmaps-design.md`

**Baseline before starting:** `node --test tests/offline/*.test.js` → `pass 331`.

**Canonical local mindmap record (extended — all tasks agree):**
```js
{
  cid, server_id, title, data_json,   // data_json opaque, lazy-fetched
  pinned, list_id,                     // list_id null = personal, else shared
  user_id,                             // owner server id
  last_edited_by,                      // server user id of last editor
  last_editor_username, last_editor_display_name,  // from server (when last_edited_by != owner)
  created_at, updated_at, deleted, dirty, base_rev,
  conflict?,                           // "remote_deleted"
  notice?                              // { kind:"overwritten"|"delete_refused", title, editor? }
}
```
(`user_id`, `last_edited_by`, `last_editor_*`, `notice` are NEW; `conflict` from the shared infra.)

**Key facts (do not re-derive):**
- This mirrors #2h-2 (shared notes) almost exactly; mindmap `data_json` is opaque + lazy-fetched (pullMindmaps takes a `fetchOne`). Mindmaps had NO `last_edited_by` before this slice.
- Backend mindmap endpoints currently owner-only (`WHERE id=? AND user_id=?`): GET/:id, PUT, pin, delete; GET list is `WHERE user_id=?`. `/share` + list_id migration already exist. `_note_access_clause` (webapp.py:2466) is the template for the new mindmap clause. `_scratchpad_row` (webapp.py:2393-2399) is the last-editor enrichment template. Notes DELETE returns 403 for non-owner (webapp.py:2952-2961) — the template for mindmap delete.
- `syncconflict.js` is entity-aware (task+note) with `STORE` map, `listConflicts`, `resolveConflict(entity,cid,choice)`, `listNotices()`, `dismissNotice(cid)` — this slice adds `mindmap` and generalizes notices to be entity-aware.
- idmap/outbox entity for mindmaps = `"mindmap"`.

---

### Task 1: Backend — mindmap access clause + last_edited_by + non-owner-delete 403

**Files:**
- Modify: `webapp.py`

This task has no Node test (Python). Verify with `python -m py_compile webapp.py`. Edit ONLY the repo-root `webapp.py`, NOT `.claude/worktrees/*` copies.

- [ ] **Step 1: Add the `last_edited_by` migration** — after the `mindmaps.list_id` migration block (the one ending ~line 220 with its `finally: conn.close()`), insert a parallel block:

```python
    # Migrate mindmaps.last_edited_by column (collaborative shared mindmaps #2h-3)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(mindmaps)").fetchall()]
        if "last_edited_by" not in cols:
            conn.execute("ALTER TABLE mindmaps ADD COLUMN last_edited_by INTEGER")
            conn.commit()
    finally:
        conn.close()
```

- [ ] **Step 2: Add the access clause + enrichment helpers** — near `_note_access_clause` (webapp.py ~2466), add:

```python
def _mindmap_access_clause(uid: int, prefix: str = "") -> tuple[str, list]:
    """SQL WHERE fragment + params: mindmaps owned by uid OR shared via list membership."""
    p = f"{prefix}." if prefix else ""
    clause = (
        f"({p}user_id = ? OR {p}list_id IN ("
        "  SELECT id FROM shared_lists WHERE owner_id = ?"
        "  UNION SELECT list_id FROM list_members WHERE user_id = ?"
        "))"
    )
    return clause, [uid, uid, uid]


def _mindmap_enrich(d: dict, conn) -> dict:
    """Add last_editor_username/display_name when last_edited_by is set and != owner."""
    if d.get("last_edited_by") and d["last_edited_by"] != d.get("user_id"):
        editor = conn.execute(
            "SELECT username, display_name FROM users WHERE id = ?", (d["last_edited_by"],)
        ).fetchone()
        if editor:
            d["last_editor_username"] = editor["username"]
            d["last_editor_display_name"] = editor["display_name"]
    return d
```

- [ ] **Step 3: GET list — broaden access + enrich** — replace the `list_mindmaps` body's query. The current is:
```python
        rows = conn.execute(
            "SELECT id, title, is_pinned, list_id, created_at, updated_at FROM mindmaps "
            "WHERE user_id = ? ORDER BY is_pinned DESC, updated_at DESC",
            (uid,)
        ).fetchall()
        return [dict(r) for r in rows]
```
Replace with:
```python
        access_clause, access_params = _mindmap_access_clause(uid)
        rows = conn.execute(
            "SELECT id, title, is_pinned, list_id, user_id, last_edited_by, created_at, updated_at FROM mindmaps "
            f"WHERE {access_clause} ORDER BY is_pinned DESC, updated_at DESC",
            access_params
        ).fetchall()
        return [_mindmap_enrich(dict(r), conn) for r in rows]
```

- [ ] **Step 4: GET /:id — broaden access + enrich** — in `get_mindmap`, replace:
```python
        row = conn.execute(
            "SELECT * FROM mindmaps WHERE id = ? AND user_id = ?", (mid, uid)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Mindmap tidak ditemukan")
        return dict(row)
```
with:
```python
        access_clause, access_params = _mindmap_access_clause(uid)
        row = conn.execute(
            f"SELECT * FROM mindmaps WHERE id = ? AND {access_clause}", [mid] + access_params
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Mindmap tidak ditemukan")
        return _mindmap_enrich(dict(row), conn)
```

- [ ] **Step 5: PUT — broaden access + stamp last_edited_by + enrich** — in `update_mindmap`, replace:
```python
        row = conn.execute(
            "SELECT id, title, data_json FROM mindmaps WHERE id = ? AND user_id = ?", (mid, uid)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Mindmap tidak ditemukan")
        new_title = req.title if req.title is not None else row["title"]
        new_data = req.data_json if req.data_json is not None else row["data_json"]
        conn.execute(
            "UPDATE mindmaps SET title = ?, data_json = ?, updated_at = ? WHERE id = ?",
            (new_title, new_data, now, mid)
        )
        updated = conn.execute("SELECT * FROM mindmaps WHERE id = ?", (mid,)).fetchone()
        return dict(updated)
```
with:
```python
        access_clause, access_params = _mindmap_access_clause(uid)
        row = conn.execute(
            f"SELECT id, title, data_json FROM mindmaps WHERE id = ? AND {access_clause}", [mid] + access_params
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Mindmap tidak ditemukan")
        new_title = req.title if req.title is not None else row["title"]
        new_data = req.data_json if req.data_json is not None else row["data_json"]
        conn.execute(
            "UPDATE mindmaps SET title = ?, data_json = ?, last_edited_by = ?, updated_at = ? WHERE id = ?",
            (new_title, new_data, uid, now, mid)
        )
        updated = conn.execute("SELECT * FROM mindmaps WHERE id = ?", (mid,)).fetchone()
        return _mindmap_enrich(dict(updated), conn)
```

- [ ] **Step 6: DELETE — non-owner → 403** — in `delete_mindmap`, replace:
```python
        if not conn.execute(
            "SELECT id FROM mindmaps WHERE id = ? AND user_id = ?", (mid, uid)
        ).fetchone():
            raise HTTPException(status_code=404, detail="Mindmap tidak ditemukan")
```
with:
```python
        if not conn.execute(
            "SELECT id FROM mindmaps WHERE id = ? AND user_id = ?", (mid, uid)
        ).fetchone():
            raise HTTPException(status_code=403, detail="Hanya pemilik yang bisa menghapus mindmap ini")
```

(GET /api/lists/{id}/mindmaps and PATCH /pin are unchanged — pin stays owner-only, list-scoped route already member-gated.)

- [ ] **Step 7: Verify** — `python -m py_compile webapp.py` → no output. Confirm via grep that `_mindmap_access_clause` is referenced in list/get/put (3 call sites) and `last_edited_by` appears in the migration + the PUT UPDATE + the list SELECT.

- [ ] **Step 8: Commit**

```bash
git add webapp.py
git commit -m "feat(mindmap): member access + last_edited_by + non-owner-delete 403 (#2h-3)"
```

---

### Task 2: `mindmaprepo.js` — list_id + last_edited_by + current user

**Files:**
- Modify: `static/offline/mindmaprepo.js`
- Test: `tests/offline/mindmaprepo_shared.test.js`

- [ ] **Step 1: Write the failing test** — create `tests/offline/mindmaprepo_shared.test.js`:

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { createMindmap, updateMindmap, getRaw, setCurrentUser } = require("../../static/offline/mindmaprepo.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); setCurrentUser(null); });

test("createMindmap stores list_id + stamps owner/last_edited_by from current user", async () => {
  setCurrentUser({ user_id: 5, username: "me", display_name: "Me" });
  const rec = await createMindmap({ title: "Shared", list_id: 9 }, {});
  assert.equal(rec.list_id, 9);
  assert.equal(rec.user_id, 5);
  assert.equal(rec.last_edited_by, 5);
});

test("createMindmap defaults list_id null when omitted", async () => {
  setCurrentUser({ user_id: 5 });
  const rec = await createMindmap({ title: "Personal" }, {});
  assert.equal(rec.list_id, null);
});

test("updateMindmap stamps last_edited_by + clears stale last_editor_*", async () => {
  setCurrentUser({ user_id: 5 });
  const rec = await createMindmap({ title: "A", list_id: 9 }, {});
  const db = await openDB();
  await new Promise((res) => { const tx = db.transaction("mindmaps", "readwrite"); tx.objectStore("mindmaps").put(Object.assign({}, rec, { last_editor_username: "bob", last_editor_display_name: "Bob" })); tx.oncomplete = res; });
  setCurrentUser({ user_id: 7 });
  await updateMindmap(rec.cid, { data_json: "{\"x\":1}" }, {});
  const raw = await getRaw(rec.cid);
  assert.equal(raw.last_edited_by, 7);
  assert.equal(raw.last_editor_username, null);
  assert.equal(raw.last_editor_display_name, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/mindmaprepo_shared.test.js`
Expected: FAIL — setCurrentUser not a function / list_id null.

- [ ] **Step 3: Implement** — in `static/offline/mindmaprepo.js`:

After the requires (before `DEFAULT_DATA`), add:
```js
  let _currentUser = null;
  function setCurrentUser(u) { _currentUser = u; }
  function getCurrentUser() { return _currentUser; }
  function curUid() { return (_currentUser && _currentUser.user_id != null) ? _currentUser.user_id : null; }
```

In `createMindmap`, change the record's `pinned: false, list_id: null,` line to:
```js
      pinned: false,
      list_id: input.list_id != null ? input.list_id : null,
      user_id: curUid(),
      last_edited_by: curUid(),
      last_editor_username: null, last_editor_display_name: null,
```

In `updateMindmap`, add to the `next` Object.assign fields (before `updated_at: now,`):
```js
        last_edited_by: curUid(),
        last_editor_username: null, last_editor_display_name: null,
```

Add `setCurrentUser, getCurrentUser` to the `exported` object.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/mindmaprepo_shared.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Full suite**

Run: `node --test tests/offline/*.test.js`
Expected: `pass 334` (331 + 3), `fail 0`. Existing mindmaprepo tests still pass (list_id defaults null).

- [ ] **Step 6: Commit**

```bash
git add static/offline/mindmaprepo.js tests/offline/mindmaprepo_shared.test.js
git commit -m "feat(offline): mindmaprepo accepts list_id + stamps owner/last_edited_by (#2h-3)"
```

---

### Task 3: `mindmaproutes.js` — include shared + collaborator fields + list route

**Files:**
- Modify: `static/offline/mindmaproutes.js`
- Test: `tests/offline/mindmaproutes_shared.test.js`

- [ ] **Step 1: Write the failing test** — create `tests/offline/mindmaproutes_shared.test.js`:

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset } = require("../../static/offline/db.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");
const { createMindmap, setCurrentUser } = require("../../static/offline/mindmaprepo.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); setCurrentUser({ user_id: 3 }); });

test("GET /api/mindmaps includes shared mindmaps and exposes collaborator fields", async () => {
  const R = buildTaskRouter();
  await createMindmap({ title: "Personal" }, {});
  await createMindmap({ title: "Shared", list_id: 9 }, {});
  const list = await R.dispatch("GET", "/api/mindmaps", undefined);
  assert.deepEqual(list.map((m) => m.title).sort(), ["Personal", "Shared"]);
  const shared = list.find((m) => m.title === "Shared");
  assert.equal(shared.list_id, 9);
  assert.equal(shared.user_id, 3);
  assert.ok("last_edited_by" in shared);
});

test("GET /api/lists/:id/mindmaps returns that list's local mindmaps shaped {id,title,updated_at}", async () => {
  const R = buildTaskRouter();
  await createMindmap({ title: "InList", list_id: 9 }, {});
  await createMindmap({ title: "Other", list_id: 4 }, {});
  const list = await R.dispatch("GET", "/api/lists/9/mindmaps", undefined);
  assert.equal(list.length, 1);
  assert.equal(list[0].title, "InList");
  assert.deepEqual(Object.keys(list[0]).sort(), ["id", "title", "updated_at"]);
});

test("PATCH /api/mindmaps/:id/share is NOT intercepted", () => {
  const R = buildTaskRouter();
  assert.equal(R.hasRoute("PATCH", "/api/mindmaps/5/share"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/mindmaproutes_shared.test.js`
Expected: FAIL — shared excluded / collaborator fields missing / list route absent.

- [ ] **Step 3: Implement** — in `static/offline/mindmaproutes.js`:

In `meta`, add collaborator fields. Replace the `meta` function with:
```js
  function meta(rec) {
    return {
      id: displayId(rec), title: rec.title, is_pinned: rec.pinned ? 1 : 0,
      list_id: rec.list_id != null ? rec.list_id : null,
      user_id: rec.user_id != null ? rec.user_id : null,
      last_edited_by: rec.last_edited_by != null ? rec.last_edited_by : null,
      last_editor_username: rec.last_editor_username != null ? rec.last_editor_username : null,
      last_editor_display_name: rec.last_editor_display_name != null ? rec.last_editor_display_name : null,
      created_at: rec.created_at, updated_at: rec.updated_at,
    };
  }
```

In `listMindmaps`, drop the `&& m.list_id == null` so it includes shared:
```js
      const personal = all.filter((m) => !m.deleted);
```
(Keep the variable name / sort as-is.)

In `registerMindmapRoutes`, after the `DELETE /api/mindmaps/:id` registration, add the list-scoped route:
```js
    router.register("GET", "/api/lists/:id/mindmaps", ({ params }) =>
      allMindmaps().then((all) => all
        .filter((m) => !m.deleted && m.list_id != null && String(m.list_id) === String(params.id))
        .sort((a, b) => (String(b.updated_at) < String(a.updated_at) ? -1 : String(b.updated_at) > String(a.updated_at) ? 1 : 0))
        .map((m) => ({ id: m.server_id != null ? m.server_id : m.cid, title: m.title, updated_at: m.updated_at }))));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/mindmaproutes_shared.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Full suite — a stale assertion may break.** The existing `mindmaproutes.test.js` may assert shared mindmaps are excluded from the list. Run `node --test tests/offline/mindmaproutes.test.js`; if a "shared excluded"/personal-only assertion now fails, update ONLY that stale assertion to reflect shared-now-included, and report it. Then full suite:

Run: `node --test tests/offline/*.test.js`
Expected: `pass 337` (334 + 3), `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add static/offline/mindmaproutes.js tests/offline/mindmaproutes_shared.test.js
# include tests/offline/mindmaproutes.test.js if a stale assertion was updated
git commit -m "feat(offline): mindmaproutes includes shared + collaborator fields + list route (#2h-3)"
```

---

### Task 4: `syncpush.js` — list_id payload + member-permission edges

**Files:**
- Modify: `static/offline/syncpush.js`
- Test: `tests/offline/mindmapsync_shared_push.test.js`

- [ ] **Step 1: Write the failing test** — create `tests/offline/mindmapsync_shared_push.test.js`:

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { serverIdOf, mapPut } = require("../../static/offline/idmap.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const { mindmapToCreatePayload, pushOutbox } = require("../../static/offline/syncpush.js");

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
    cid: over.cid, server_id: over.server_id != null ? over.server_id : null, title: "M", data_json: "{}",
    pinned: false, list_id: over.list_id != null ? over.list_id : null, user_id: null, last_edited_by: null,
    created_at: "x", updated_at: "2026-06-12T00:00:00", deleted: false, dirty: 1, base_rev: null,
  }, over);
}
function fakeTransport(handler) {
  const calls = [];
  return { calls, request(method, path, body) { calls.push({ method, path, body }); const h = handler(method, path, body); if (h === "NETWORK") return Promise.reject(new Error("net")); return Promise.resolve(h); } };
}

test("mindmapToCreatePayload sends the real list_id", () => {
  const p = mindmapToCreatePayload(mm({ cid: "m", list_id: 9 }));
  assert.equal(p.list_id, 9);
});

test("shared update 404 sets conflict=remote_deleted (no re-create)", async () => {
  await put("mindmaps", [mm({ cid: "m", server_id: 7, list_id: 9 })]);
  await mapPut("mindmap", 7, "m");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  const tr = fakeTransport((method) => { assert.notEqual(method, "POST"); return { status: 404, data: {} }; });
  await pushOutbox(tr);
  const rec = await getMM("m");
  assert.equal(rec.conflict, "remote_deleted");
  assert.equal(rec.server_id, 7);
});

test("personal update 404 still re-creates (regression guard)", async () => {
  await put("mindmaps", [mm({ cid: "m", server_id: 7, list_id: null })]);
  await mapPut("mindmap", 7, "m");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  let n = 0;
  const tr = fakeTransport(() => (n++ === 0 ? { status: 404, data: {} } : { status: 200, data: { id: 99, updated_at: "x" } }));
  await pushOutbox(tr);
  assert.equal(await serverIdOf("m"), 99);
});

test("shared create 403 drops op + deletes local + idmap", async () => {
  await put("mindmaps", [mm({ cid: "m", server_id: null, list_id: 9 })]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "mindmap", cid: "m", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 403, data: {} }));
  await pushOutbox(tr);
  assert.equal((await outboxAll()).length, 0);
  assert.equal(await getMM("m"), undefined);
});

test("member delete 403 reverts the tombstone + records a notice", async () => {
  await put("mindmaps", [mm({ cid: "m", server_id: 7, list_id: 9, deleted: true, title: "Shared" })]);
  await mapPut("mindmap", 7, "m");
  await put("_outbox", [{ qid: 1, op: "delete", entity_type: "mindmap", cid: "m", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 403, data: {} }));
  await pushOutbox(tr);
  const rec = await getMM("m");
  assert.equal(rec.deleted, false);
  assert.equal(rec.dirty, 0);
  assert.equal(rec.notice.kind, "delete_refused");
  assert.equal((await outboxAll()).length, 0);
});

test("a mindmap already flagged conflict is not re-pushed (guard)", async () => {
  await put("mindmaps", [mm({ cid: "m", server_id: 7, list_id: 9, conflict: "remote_deleted" })]);
  await mapPut("mindmap", 7, "m");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  const tr = fakeTransport(() => { throw new Error("should not hit network for conflicted mindmap"); });
  await pushOutbox(tr);
  assert.equal((await outboxAll()).length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/mindmapsync_shared_push.test.js`
Expected: FAIL.

- [ ] **Step 3a: list_id in payload** — in `mindmapToCreatePayload`, add a `list_id` field:
```js
  function mindmapToCreatePayload(record) {
    return {
      title: record.title != null ? record.title : "Untitled",
      data_json: record.data_json != null ? record.data_json : MM_DEFAULT_DATA,
      list_id: record.list_id != null ? record.list_id : null,
    };
  }
```

- [ ] **Step 3b: opMindmapCreate 403** — in `opMindmapCreate`, replace the trailing failure `result.failed++; return TFoutbox.outboxRemove(op.qid);` (after the `if (ok(res)) {...}` block) with:
```js
        if (res.status === 403) {
          return deleteMindmapRaw(op.cid).then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.failed++; });
        }
        result.failed++;
        return TFoutbox.outboxRemove(op.qid);
```

- [ ] **Step 3c: opMindmapUpdate conflict guard + 404 branch + 403** — in `opMindmapUpdate`, add the conflict guard right after `if (!rec || sid == null) return TFoutbox.outboxRemove(op.qid);`:
```js
      if (rec.conflict) return TFoutbox.outboxRemove(op.qid); // held until user resolves
```
Then replace the `if (res.status === 404) { ...re-create... }` block AND the trailing `result.failed++; return TFoutbox.outboxRemove(op.qid);` with:
```js
        if (res.status === 404) {
          if (rec.list_id != null) {
            return putMindmapRaw(Object.assign({}, rec, { conflict: "remote_deleted" }))
              .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.failed++; });
          }
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
        if (res.status === 403) {
          return TFidmap.mapDelete("mindmap", sid)
            .then(() => deleteMindmapRaw(op.cid))
            .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.failed++; });
        }
        result.failed++;
        return TFoutbox.outboxRemove(op.qid);
```

- [ ] **Step 3d: opMindmapDelete 403** — in `opMindmapDelete`, replace the trailing `result.failed++; return TFoutbox.outboxRemove(op.qid);` (after the `if (ok(res) || res.status === 404) {...}` block) with:
```js
        if (res.status === 403) {
          return getMindmapRaw(op.cid).then((rec) =>
            (rec
              ? putMindmapRaw(Object.assign({}, rec, { deleted: false, dirty: 0, notice: { kind: "delete_refused", title: rec.title } }))
              : Promise.resolve()))
            .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.failed++; });
        }
        result.failed++;
        return TFoutbox.outboxRemove(op.qid);
```

- [ ] **Step 3e: opMindmapPin 403 safety net** — in `opMindmapPin`, the inner PATCH failure is `result.failed++; return TFoutbox.outboxRemove(op.qid);`. Leave it; on 403 the op is already dropped (failed++), which is the desired "member can't pin" behavior (pull pin-adopt restores state). No change needed beyond confirming the existing drop-on-failure handles it.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/mindmapsync_shared_push.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Full suite**

Run: `node --test tests/offline/*.test.js`
Expected: `pass 343` (337 + 6), `fail 0`. Existing mindmap push tests (personal create/update/delete/pin) still pass.

- [ ] **Step 6: Commit**

```bash
git add static/offline/syncpush.js tests/offline/mindmapsync_shared_push.test.js
git commit -m "feat(offline): push shared mindmaps (list_id) + member-permission edges (#2h-3)"
```

---

### Task 5: `syncpull.js` — pullMindmaps shared + LWW-loss notice

**Files:**
- Modify: `static/offline/syncpull.js`
- Test: `tests/offline/mindmapsync_shared_pull.test.js`

- [ ] **Step 1: Write the failing test** — create `tests/offline/mindmapsync_shared_pull.test.js`:

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut } = require("../../static/offline/idmap.js");
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
function metaRow(over) {
  return Object.assign({ id: over.id, title: over.title || "S", is_pinned: 0, list_id: over.list_id != null ? over.list_id : null, user_id: over.user_id != null ? over.user_id : 1, last_edited_by: over.last_edited_by != null ? over.last_edited_by : null, last_editor_username: over.last_editor_username != null ? over.last_editor_username : null, last_editor_display_name: over.last_editor_display_name != null ? over.last_editor_display_name : null, created_at: "2026-06-12T00:00:00", updated_at: over.updated_at || "2026-06-12T00:00:00" }, over);
}
function fullFor(rows) {
  return (sid) => { const r = rows.find((x) => String(x.id) === String(sid)); return Promise.resolve(r ? Object.assign({}, r, { data_json: r.data_json || "{}" }) : null); };
}
function localMM(over) {
  return Object.assign({ cid: over.cid, server_id: over.server_id, title: over.title || "L", data_json: "{}", pinned: false, list_id: over.list_id != null ? over.list_id : null, user_id: 1, last_edited_by: null, created_at: "x", updated_at: over.updated_at || "2026-06-12T00:00:00", deleted: false, dirty: over.dirty != null ? over.dirty : 0, base_rev: over.base_rev || "2026-06-12T00:00:00" }, over);
}

test("pullMindmaps reconciles shared mindmaps + carries collaborator fields", async () => {
  const rows = [metaRow({ id: 5, title: "Remote", list_id: 9, last_edited_by: 7, last_editor_display_name: "Bob" })];
  const res = await pullMindmaps(rows, fullFor(rows));
  assert.equal(res.created, 1);
  const local = (await getAll("mindmaps"))[0];
  assert.equal(local.list_id, 9);
  assert.equal(local.last_editor_display_name, "Bob");
});

test("LWW-loss on a dirty shared mindmap attaches an overwritten notice", async () => {
  await put("mindmaps", [localMM({ cid: "m", server_id: 5, list_id: 9, dirty: 1, title: "MineOld", updated_at: "2026-06-12T01:00:00", base_rev: "2026-06-12T00:00:00" })]);
  await mapPut("mindmap", 5, "m");
  const rows = [metaRow({ id: 5, list_id: 9, title: "Theirs", updated_at: "2026-06-12T05:00:00", last_edited_by: 7, last_editor_display_name: "Bob" })];
  const res = await pullMindmaps(rows, fullFor(rows));
  assert.equal(res.lwwResolved, 1);
  const local = (await getAll("mindmaps"))[0];
  assert.equal(local.notice.kind, "overwritten");
  assert.equal(local.notice.editor, "Bob");
});

test("shared dirty mindmap vanished from server -> conflict remote_deleted", async () => {
  await put("mindmaps", [localMM({ cid: "m", server_id: 5, list_id: 9, dirty: 1, title: "Mine" })]);
  await mapPut("mindmap", 5, "m");
  const res = await pullMindmaps([], fullFor([]));
  const local = (await getAll("mindmaps"))[0];
  assert.equal(local.conflict, "remote_deleted");
});

test("an un-dismissed mindmap notice survives a later clean update", async () => {
  await put("mindmaps", [localMM({ cid: "m", server_id: 5, list_id: 9, dirty: 0, title: "Theirs", updated_at: "2026-06-12T05:00:00", base_rev: "2026-06-12T05:00:00", notice: { kind: "overwritten", title: "Theirs", editor: "Bob" } })]);
  await mapPut("mindmap", 5, "m");
  const rows = [metaRow({ id: 5, list_id: 9, title: "TheirsAgain", updated_at: "2026-06-12T09:00:00" })];
  await pullMindmaps(rows, fullFor(rows));
  const local = (await getAll("mindmaps"))[0];
  assert.equal(local.title, "TheirsAgain");
  assert.equal(local.notice.kind, "overwritten");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/mindmapsync_shared_pull.test.js`
Expected: FAIL.

- [ ] **Step 3a: include shared + collaborator fields** — in `static/offline/syncpull.js`:

In `mindmapFromServer`, change `pinned: !!s.is_pinned, list_id: null,` to:
```js
      pinned: !!s.is_pinned,
      list_id: s.list_id != null ? s.list_id : null,
      user_id: s.user_id != null ? s.user_id : null,
      last_edited_by: s.last_edited_by != null ? s.last_edited_by : null,
      last_editor_username: s.last_editor_username != null ? s.last_editor_username : null,
      last_editor_display_name: s.last_editor_display_name != null ? s.last_editor_display_name : null,
```

Change `writeMindmapFull` to accept an `extra` overlay:
```js
  function writeMindmapFull(serverId, cid, fetchOne, extra) {
    return Promise.resolve(fetchOne(serverId)).then((fullRow) => (fullRow ? putMindmap(Object.assign(mindmapFromServer(fullRow, cid), extra || {})) : null));
  }
```

In `pullMindmaps`, change the filter line `const list = (serverList || []).filter((s) => s.list_id == null);` to:
```js
    const list = (serverList || []);
```

- [ ] **Step 3b: LWW-loss notice + conflict skip guard** — in `pullMindmaps`, the per-mindmap loop. First add a conflict-skip guard: change the `if (!local) {...}` line's following logic by inserting after `const local = byCid[cid];`'s `chain = chain.then(() => {` opening, right after `if (!local) { result.created++; return writeMindmapFull(s.id, cid, fetchOne); }`:
```js
            if (local.conflict) { result.skipped++; return; }
```
Then change the dirty server-wins branch `return dropOutbox("mindmap", cid).then(() => writeMindmapFull(s.id, cid, fetchOne)); // server wins` to:
```js
                  return dropOutbox("mindmap", cid).then(() => writeMindmapFull(s.id, cid, fetchOne, {
                    notice: { kind: "overwritten", title: s.title, editor: s.last_editor_display_name || s.last_editor_username || "Pengguna lain" },
                  })); // server wins (LWW) — leave a notice
```
And change the clean-updated branch `if (s.updated_at !== local.base_rev) { result.updated++; return writeMindmapFull(s.id, cid, fetchOne); }` to preserve an existing notice:
```js
            if (s.updated_at !== local.base_rev) { result.updated++; return writeMindmapFull(s.id, cid, fetchOne, local.notice ? { notice: local.notice } : undefined); }
```

- [ ] **Step 3c: shared dirty-vanished → remote_deleted** — in the orphan-delete pass, change:
```js
            if (r.dirty) { result.skipped++; return; } // local-wins; push update→404→re-create
            result.deleted++;
            return deleteMindmapRec(r.cid).then(() => TFidmap.mapDelete("mindmap", r.server_id));
```
to:
```js
            if (r.dirty) {
              if (r.list_id != null) { result.skipped++; return putMindmap(Object.assign({}, r, { conflict: "remote_deleted" })); }
              result.skipped++; return; // personal local-wins; push update→404→re-create
            }
            result.deleted++;
            return deleteMindmapRec(r.cid).then(() => TFidmap.mapDelete("mindmap", r.server_id));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/mindmapsync_shared_pull.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Full suite — a stale "skips shared" assertion in `mindmapsync_pull.test.js` may break.** If so, update ONLY that stale assertion to reflect shared-now-included; report it.

Run: `node --test tests/offline/*.test.js`
Expected: `pass 347` (343 + 4), `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add static/offline/syncpull.js tests/offline/mindmapsync_shared_pull.test.js
# include tests/offline/mindmapsync_pull.test.js if a stale assertion was updated
git commit -m "feat(offline): pull shared mindmaps + LWW-loss notice + shared edit-vs-delete (#2h-3)"
```

---

### Task 6: `syncconflict.js` — add the `mindmap` entity + entity-aware notices

**Files:**
- Modify: `static/offline/syncconflict.js`
- Modify: `tests/offline/syncconflict_notes.test.js` (the `listNotices`/`dismissNotice` shape/signature changes)
- Test: `tests/offline/syncconflict_mindmaps.test.js`

- [ ] **Step 1: Write the failing test** — create `tests/offline/syncconflict_mindmaps.test.js`:

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
async function getMM(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("mindmaps").objectStore("mindmaps").get(cid); q.onsuccess = () => res(q.result); });
}
function mm(over) {
  return Object.assign({ cid: over.cid, server_id: over.server_id != null ? over.server_id : null, title: "M", data_json: "{}", pinned: false, list_id: 9, user_id: 1, created_at: "x", updated_at: "x", deleted: false, dirty: 1, base_rev: null }, over);
}

test("listConflicts includes mindmap conflicts tagged entity=mindmap", async () => {
  await put("mindmaps", [mm({ cid: "m", server_id: 7, conflict: "remote_deleted", title: "Gone" })]);
  const list = await listConflicts();
  const c = list.find((x) => x.entity === "mindmap");
  assert.ok(c);
  assert.equal(c.cid, "m");
});

test("resolveConflict('mindmap', cid, 'discard') removes the mindmap + idmap + op", async () => {
  await put("mindmaps", [mm({ cid: "m", server_id: 7, conflict: "remote_deleted" })]);
  await mapPut("mindmap", 7, "m");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  await resolveConflict("mindmap", "m", "discard");
  assert.equal(await getMM("m"), undefined);
  assert.equal(await serverIdOf("m"), undefined);
});

test("listNotices includes mindmap notices (entity tagged); dismissNotice('mindmap',cid) clears", async () => {
  await put("mindmaps", [mm({ cid: "m", notice: { kind: "overwritten", title: "Doc", editor: "Bob" } })]);
  const notices = await listNotices();
  const n = notices.find((x) => x.entity === "mindmap");
  assert.ok(n);
  assert.equal(n.editor, "Bob");
  await dismissNotice("mindmap", "m");
  assert.equal((await listNotices()).length, 0);
  assert.equal((await getMM("m")).notice, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/syncconflict_mindmaps.test.js`
Expected: FAIL.

- [ ] **Step 3a: Implement** — in `static/offline/syncconflict.js`:

Add `mindmap` to the `STORE` map:
```js
  const STORE = { task: "tasks", note: "scratchpad_notes", mindmap: "mindmaps" };
```

In `listConflicts`, also scan mindmaps. Replace the body with:
```js
  function listConflicts() {
    return Promise.all([getAll("tasks"), getAll("scratchpad_notes"), getAll("mindmaps")]).then(([tasks, notes, mindmaps]) => {
      const out = [];
      const add = (entity, rows) => { for (const r of rows) if (r.conflict) out.push({ entity: entity, cid: r.cid, title: r.title, conflict: r.conflict, list_id: r.list_id != null ? r.list_id : null }); };
      add("task", tasks); add("note", notes); add("mindmap", mindmaps);
      return out;
    });
  }
```

Generalize `listNotices` (scan notes + mindmaps, tag entity) and `dismissNotice` (entity-aware):
```js
  function listNotices() {
    return Promise.all([getAll("scratchpad_notes"), getAll("mindmaps")]).then(([notes, mindmaps]) => {
      const out = [];
      const add = (entity, rows) => { for (const r of rows) if (r.notice) out.push({ entity: entity, cid: r.cid, kind: r.notice.kind, title: r.notice.title, editor: r.notice.editor != null ? r.notice.editor : null }); };
      add("note", notes); add("mindmap", mindmaps);
      return out;
    });
  }

  function dismissNotice(entity, cid) {
    const store = STORE[entity];
    if (!store) return Promise.reject(new Error("unknown entity: " + entity));
    return getRaw(store, cid).then((rec) => {
      if (!rec) return { ok: false };
      const next = Object.assign({}, rec);
      delete next.notice;
      return putRaw(store, next).then(() => ({ ok: true }));
    });
  }
```

- [ ] **Step 3b: Update the existing note notices test** — in `tests/offline/syncconflict_notes.test.js`, the `listNotices`/`dismissNotice` test now needs: `listNotices()` results carry an `entity` field (find the note one), and `dismissNotice` takes `(entity, cid)`. Update that test's `dismissNotice("n")` → `dismissNotice("note", "n")` and adjust the assertion to locate the note notice (it now returns `[{entity:"note", ...}]`). Run `node --test tests/offline/syncconflict_notes.test.js` and fix until green.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/syncconflict_mindmaps.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Full suite**

Run: `node --test tests/offline/*.test.js`
Expected: `pass 350` (347 + 3), `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add static/offline/syncconflict.js tests/offline/syncconflict_mindmaps.test.js tests/offline/syncconflict_notes.test.js
git commit -m "feat(offline): syncconflict handles mindmap conflicts + entity-aware notices (#2h-3)"
```

---

### Task 7: Wire `index.html` — current user + entity-aware dismiss + SW v135

**Files:**
- Modify: `static/index.html`
- Modify: `static/sw.js`

- [ ] **Step 1: mindmaprepo.setCurrentUser (2 places)** — find the two `window.TF.noterepo.setCurrentUser({...})` calls (added in #2h-2, right after the chatrepo ones). Immediately AFTER EACH, add the analogous mindmaprepo call with the SAME identity object:

After the online one:
```js
        if (window.TF && window.TF.mindmaprepo) window.TF.mindmaprepo.setCurrentUser({ user_id: u.id, username: u.username, display_name: u.display_name });
```
After the offline-fallback one:
```js
            if (window.TF && window.TF.mindmaprepo) window.TF.mindmaprepo.setCurrentUser({ user_id: payload.sub, username: payload.username || payload.sub, display_name: payload.display_name || payload.username || payload.sub });
```

- [ ] **Step 2: entity-aware dismissNotice** — in `renderConflicts()`, there are TWO `window.TF.syncconflict.dismissNotice(n.cid)` calls (the notices-only branch + the conflicts-present append, both added in #2h-2). Change BOTH to:
```js
window.TF.syncconflict.dismissNotice(n.entity, n.cid)
```
(The notice objects now carry `n.entity` from the generalized `listNotices`.)

- [ ] **Step 3: SW bump** — in `static/sw.js` line 1, change to:
```js
const CACHE = "taskflow-v135-sharedmindmaps";
```

- [ ] **Step 4: Verify**

Run: `node --test tests/offline/*.test.js` → expect `pass 350`, `fail 0`.

Run: `node -e "const s=require('fs').readFileSync('static/index.html','utf8'); console.log('mmuser:', (s.match(/mindmaprepo\.setCurrentUser/g)||[]).length, 'dismiss2:', (s.match(/dismissNotice\(n\.entity, n\.cid\)/g)||[]).length);"`
Expected: `mmuser: 2 dismiss2: 2`

Run: `node -e "const s=require('fs').readFileSync('static/sw.js','utf8'); console.log('v135:', /taskflow-v135-sharedmindmaps/.test(s));"`
Expected: `v135: true`

Inline-script parse: `node -e "const s=require('fs').readFileSync('static/index.html','utf8'); const m=s.match(/<script>[\s\S]*?<\/script>/g)||[]; let bad=0; for(const b of m){try{new Function(b.replace(/^<script>/,'').replace(/<\/script>$/,''));}catch(e){bad++;}} console.log('parse errors:', bad);"`
Expected: `parse errors: 0`

- [ ] **Step 5: Commit**

```bash
git add static/index.html static/sw.js
git commit -m "feat(offline): mindmaps current-user + entity-aware notice dismiss + SW v135 (#2h-3)"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** §1 backend access/last_edited_by/403 → Task 1; §3 mindmaprepo → Task 2; §4 mindmaproutes (filter + fields + list route) → Task 3; §5 syncpush (list_id + edges + guard) → Task 4; §6 syncpull (shared + notice + dirty-vanished) → Task 5; §7 syncconflict (mindmap entity + entity-aware notices) → Task 6; §8 wiring + SW → Task 7; §9 tests → each task.
- **Record-shape consistency:** the canonical record (header) is produced by `createMindmap` (Task 2), `mindmapFromServer` (Task 5), consumed by `meta` (Task 3) and `syncconflict` (Task 6). New fields `user_id`/`last_edited_by`/`last_editor_*`/`notice` set everywhere a record is built.
- **Signature changes:** `dismissNotice(cid)` → `dismissNotice(entity, cid)` and `listNotices()` results gain `entity`. Sole call sites: index.html renderConflicts (Task 7) + the syncconflict_notes test (Task 6 Step 3b). `resolveConflict(entity,...)` already exists — `mindmap` works via the STORE map for free.
- **Personal-mindmap regression guard:** Task 4 tests personal update-404 STILL re-creates; Task 5's shared-only branches (guarded by `list_id != null`) leave personal pull unchanged.
- **Pin owner-only:** no offline pin change needed; member pin → server 403 → existing drop-on-failure in opMindmapPin handles it (pull pin-adopt restores). Noted in Task 4 Step 3e.
- **Backend:** Task 1, no Node tests; `py_compile` + browser verification. Requires `taskflow-web` restart after deploy.
- **Final expected offline suite count:** 350 (331 baseline + 19 new). Trust `fail 0` over the exact total; stale-assertion updates in Tasks 3/5 may shift counts slightly.
