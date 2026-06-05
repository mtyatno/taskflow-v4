# Offline Notes Local Layer (#2f-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bawa notes personal (scratchpad) ke local-first — list/cari/filter/buka/buat/edit/hapus/pin + wikilink + backlinks dari IndexedDB, offline, rekam `_outbox` (Opsi B, belum push).

**Architecture:** 5 modul baru di `static/offline/` (notelogic/noterepo/notequery/notehydrate/noteroutes) mengikuti pola habits #2e-1. Route personal di-intercept lewat `buildTaskRouter`. Tags via `tagrepo` (entity_type `note`). Wikilink `[[Title]]` di-resolve title→cid lawan notes lokal; backlinks = scan lokal. Notes punya `updated_at` (siap LWW di #2f-2). Backend nol perubahan.

**Tech Stack:** Vanilla JS UMD modules, IndexedDB (`fake-indexeddb` di Node test), `node:test`. Spec: `docs/superpowers/specs/2026-06-06-offline-notes-local-design.md`.

---

## Konteks kunci (baca sebelum mulai)

- Modul offline = UMD; pola: `;(function(root,factory){...})(self, function(root){ const isNode=...; const req=(m,g)=>isNode?require(m):g; const TFx=req("./x.js", root.TF&&root.TF.x); ... root.TF.<name>=exported; })`.
- **Store `scratchpad_notes`** di-key `cid`, index `server_id`, `updated_at`, `linked_task_cids`(multiEntry — TIDAK dipakai di #2f-1, abaikan), `dirty`. **Catatan:** db.js index `linked_task_cids` keyPath `linked_task_cids` multiEntry mengharap array; kita simpan sbg JSON string → index tak relevan, jangan andalkan. (Tidak perlu ubah db.js.)
- `idmap`: `cidOf(type, serverId)`, `mapPut(type, serverId, cid)`, `serverIdOf(cid)` (single-arg). Notes pakai type `"note"`, tasks `"task"`.
- `ids.newCid()` → UUID. `outbox.outboxAdd({op,entity_type,cid,payload})`.
- `tagrepo`: `setEntityTags(type, cid, names[])`, `getEntityTags(type, cid)→[{name,color}]`, `cidsForTag(type, name)→Set<cid>`.
- Router: `router.register(method, path, handler)`; handler `({params, body, query})→Promise`. `buildTaskRouter()` di `taskroutes.js` memanggil `TFhabitroutes.registerHabitRoutes(router)` di akhir (baris ~116). Pola id⇄cid: `resolveCid(idOrCid)` cocokkan cid langsung lalu server_id; output pakai `displayIdOf(rec)=server_id??cid`.
- ScratchpadCreate/Update payload: `{title, content, tags[], linked_task_id, linked_task_ids[], list_id}`.
- `_scratchpad_row` (server) balas: `id, title, content, tags[], linked_task_ids[], linked_to[], pinned, linked_tasks[{id,title,priority,gtd_status}], created_at, updated_at, ...`.
- **Record note lokal** (yang kita simpan): `{cid, server_id, title, content, linked_task_cids(JSON string), linked_to_cids(JSON string), pinned(bool), list_id(null), last_edited_by(null), created_at, updated_at, deleted, dirty, base_rev}`.
- **OfflineDB legacy note:** TIDAK dibongkar di slice ini. Setelah route ter-intercept, `api.get('/api/scratchpad*')` selalu balas lokal → cabang OfflineDB di komponen notes jadi superseded (tak ada double-write krn api tak pernah throw offline utk route ter-intercept). Penghapusan kode legacy ditunda (sama precedent habits #2e-1). Browser-verify memastikan notes utuh.

## File yang disentuh

- **Create** `static/offline/notelogic.js`, `noterepo.js`, `notequery.js`, `notehydrate.js`, `noteroutes.js`
- **Create** `tests/offline/notelogic.test.js`, `noterepo.test.js`, `notequery.test.js`, `notehydrate.test.js`, `noteroutes.test.js`
- **Modify** `static/offline/taskroutes.js` — `buildTaskRouter` panggil `registerNoteRoutes(router)`
- **Modify** `static/index.html` — load 5 modul; `notehydrate.ensureNotes` di boot
- **Modify** `static/sw.js` — bump v126→v127 + precache 5 modul note

---

## Task 1: notelogic.js — parseWikilinks (pure)

**Files:**
- Create: `static/offline/notelogic.js`
- Test: `tests/offline/notelogic.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/offline/notelogic.test.js`:

```javascript
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseWikilinks } = require("../../static/offline/notelogic.js");

test("parseWikilinks extracts plain [[Title]] refs", () => {
  assert.deepEqual(parseWikilinks("see [[Alpha]] and [[Beta]]"), ["Alpha", "Beta"]);
});

test("parseWikilinks handles remark-escaped \\[\\[Title\\]\\]", () => {
  assert.deepEqual(parseWikilinks("ref \\[\\[Gamma\\]\\] here"), ["Gamma"]);
});

test("parseWikilinks takes the part before | in [[Title|alias]]", () => {
  assert.deepEqual(parseWikilinks("[[Delta|see this]]"), ["Delta"]);
});

test("parseWikilinks de-dupes and drops empty, preserving first-seen order", () => {
  assert.deepEqual(parseWikilinks("[[A]] [[A]] [[B]] [[ ]]"), ["A", "B"]);
});

test("parseWikilinks returns [] for no links / empty content", () => {
  assert.deepEqual(parseWikilinks(""), []);
  assert.deepEqual(parseWikilinks("plain text"), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/notelogic.test.js`
Expected: FAIL — `Cannot find module ... notelogic.js`.

- [ ] **Step 3: Write minimal implementation**

Create `static/offline/notelogic.js`:

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

  // Port of webapp.py _parse_wikilinks: [[Title]] incl. remark-escaped \[\[..\]\].
  const WIKILINK_RE = /(?:\\?\[){2}([^\[\]\\]+)(?:\\?\]){2}/g;

  function parseWikilinks(content) {
    const s = String(content == null ? "" : content);
    const out = [];
    const seen = {};
    WIKILINK_RE.lastIndex = 0;
    let m;
    while ((m = WIKILINK_RE.exec(s)) !== null) {
      const title = m[1].split("|")[0].trim();
      if (title && !seen[title]) { seen[title] = true; out.push(title); }
    }
    return out;
  }

  const exported = { parseWikilinks };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.notelogic = exported; }
  return exported;
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/notelogic.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add static/offline/notelogic.js tests/offline/notelogic.test.js
git commit -m "feat(offline): notelogic parseWikilinks (#2f-1)"
```

---

## Task 2: noterepo.js — createNote

**Files:**
- Create: `static/offline/noterepo.js`
- Test: `tests/offline/noterepo.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/offline/noterepo.test.js`:

```javascript
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut } = require("../../static/offline/idmap.js");
const { getEntityTags } = require("../../static/offline/tagrepo.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const { createNote } = require("../../static/offline/noterepo.js");

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
async function getNoteRow(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("scratchpad_notes").objectStore("scratchpad_notes").get(cid); q.onsuccess = () => res(q.result); });
}

test("createNote stores a personal note, records outbox + tags", async () => {
  const rec = await createNote({ title: "Note A", content: "hello", tags: ["work"] }, { now: "2026-06-06T00:00:00Z" });
  const row = await getNoteRow(rec.cid);
  assert.equal(row.title, "Note A");
  assert.equal(row.content, "hello");
  assert.equal(row.list_id, null);
  assert.equal(row.pinned, false);
  assert.equal(row.dirty, 1);
  assert.equal(row.created_at, "2026-06-06T00:00:00Z");
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "create");
  assert.equal(ops[0].entity_type, "note");
  const tags = await getEntityTags("note", rec.cid);
  assert.deepEqual(tags.map((t) => t.name), ["work"]);
});

test("createNote resolves [[Title]] wikilinks to local note cids", async () => {
  await put("scratchpad_notes", [{ cid: "target", server_id: 7, title: "Target Note", content: "", linked_task_cids: "[]", linked_to_cids: "[]", pinned: false, list_id: null, deleted: false, dirty: 0 }]);
  const rec = await createNote({ title: "Linker", content: "see [[Target Note]]", tags: [] }, {});
  const row = await getNoteRow(rec.cid);
  assert.deepEqual(JSON.parse(row.linked_to_cids), ["target"]);
});

test("createNote resolves linked_task_ids (server id or cid) to task cids", async () => {
  await put("tasks", [{ cid: "tcid", server_id: 42, title: "T", deleted: false, dirty: 0 }]);
  const rec = await createNote({ title: "N", content: "", tags: [], linked_task_ids: [42] }, {});
  const row = await getNoteRow(rec.cid);
  assert.deepEqual(JSON.parse(row.linked_task_cids), ["tcid"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/noterepo.test.js`
Expected: FAIL — `Cannot find module ... noterepo.js`.

- [ ] **Step 3: Write minimal implementation**

Create `static/offline/noterepo.js`:

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
  const TFtag = req("./tagrepo.js", root.TF && root.TF.tagrepo);
  const TFlogic = req("./notelogic.js", root.TF && root.TF.notelogic);

  function getAll(store) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction(store, "readonly").objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  function getNoteRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("scratchpad_notes", "readonly").objectStore("scratchpad_notes").get(cid);
      r.onsuccess = () => resolve(r.result);
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

  // Resolve [[Title]] -> local note cids (case-insensitive, non-deleted, first match).
  function resolveLinkedTo(content) {
    const titles = TFlogic.parseWikilinks(content);
    if (!titles.length) return Promise.resolve([]);
    return getAll("scratchpad_notes").then((notes) => {
      const byTitle = {};
      for (const n of notes) {
        if (n.deleted) continue;
        const key = String(n.title || "").trim().toLowerCase();
        if (key && !(key in byTitle)) byTitle[key] = n.cid;
      }
      const out = [];
      for (const t of titles) {
        const cid = byTitle[t.trim().toLowerCase()];
        if (cid && out.indexOf(cid) === -1) out.push(cid);
      }
      return out;
    });
  }

  // Resolve frontend task ids (cid or server_id) -> task cids.
  function resolveLinkedTasks(ids) {
    const list = (ids || []).filter((x) => x != null);
    if (!list.length) return Promise.resolve([]);
    return getAll("tasks").then((tasks) => {
      const byCid = {}; const bySid = {};
      for (const t of tasks) { byCid[t.cid] = t.cid; if (t.server_id != null) bySid[String(t.server_id)] = t.cid; }
      const out = [];
      for (const id of list) {
        const cid = byCid[id] || bySid[String(id)];
        if (cid && out.indexOf(cid) === -1) out.push(cid);
      }
      return out;
    });
  }

  function createNote(input, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    const taskIds = (input.linked_task_ids || []).concat(input.linked_task_id != null ? [input.linked_task_id] : []);
    return Promise.all([resolveLinkedTo(input.content || ""), resolveLinkedTasks(taskIds)]).then(([toCids, taskCids]) => {
      const rec = {
        cid: TFids.newCid(), server_id: null,
        title: input.title != null ? input.title : "",
        content: input.content != null ? input.content : "",
        linked_task_cids: JSON.stringify(taskCids),
        linked_to_cids: JSON.stringify(toCids),
        pinned: false, list_id: null, last_edited_by: null,
        created_at: now, updated_at: now, deleted: false, dirty: 1, base_rev: null,
      };
      return putNote(rec)
        .then(() => TFoutbox.outboxAdd({ op: "create", entity_type: "note", cid: rec.cid, payload: rec }))
        .then(() => TFtag.setEntityTags("note", rec.cid, input.tags || []))
        .then(() => rec);
    });
  }

  const exported = { createNote, getNoteRaw, putNote, resolveLinkedTo, resolveLinkedTasks };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.noterepo = exported; }
  return exported;
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/noterepo.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add static/offline/noterepo.js tests/offline/noterepo.test.js
git commit -m "feat(offline): noterepo createNote + wikilink/task resolution (#2f-1)"
```

---

## Task 3: noterepo.js — updateNote / deleteNote / togglePin

**Files:**
- Modify: `static/offline/noterepo.js`
- Test: `tests/offline/noterepo.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/offline/noterepo.test.js`:

```javascript
const { updateNote, deleteNote, togglePin } = require("../../static/offline/noterepo.js");

test("updateNote changes fields, re-derives links, sets dirty + updated_at", async () => {
  const rec = await createNote({ title: "Old", content: "", tags: ["a"] }, { now: "2026-06-06T00:00:00Z" });
  await put("scratchpad_notes", [{ cid: "tgt", server_id: 3, title: "Tgt", content: "", linked_task_cids: "[]", linked_to_cids: "[]", pinned: false, list_id: null, deleted: false, dirty: 0 }]);
  const next = await updateNote(rec.cid, { title: "New", content: "[[Tgt]]", tags: ["b"] }, { now: "2026-06-06T01:00:00Z" });
  const row = await getNoteRow(rec.cid);
  assert.equal(row.title, "New");
  assert.equal(row.updated_at, "2026-06-06T01:00:00Z");
  assert.deepEqual(JSON.parse(row.linked_to_cids), ["tgt"]);
  assert.equal(row.dirty, 1);
  const ops = (await outboxAll()).filter((o) => o.op === "update");
  assert.equal(ops.length, 1);
  const tags = await getEntityTags("note", rec.cid);
  assert.deepEqual(tags.map((t) => t.name), ["b"]);
});

test("deleteNote tombstones the note + records outbox delete", async () => {
  const rec = await createNote({ title: "Doomed", content: "", tags: [] }, {});
  await deleteNote(rec.cid, {});
  assert.equal((await getNoteRow(rec.cid)).deleted, true);
  const ops = (await outboxAll()).filter((o) => o.op === "delete");
  assert.equal(ops.length, 1);
  assert.equal(ops[0].entity_type, "note");
});

test("togglePin flips pinned and records a pin op", async () => {
  const rec = await createNote({ title: "P", content: "", tags: [] }, {});
  const r1 = await togglePin(rec.cid, {});
  assert.equal(r1.pinned, true);
  assert.equal((await getNoteRow(rec.cid)).pinned, true);
  const ops = (await outboxAll()).filter((o) => o.op === "pin");
  assert.equal(ops.length, 1);
  assert.deepEqual(ops[0].payload, { pinned: true });
  const r2 = await togglePin(rec.cid, {});
  assert.equal(r2.pinned, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/noterepo.test.js`
Expected: FAIL — `updateNote is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `static/offline/noterepo.js`, add after `createNote`:

```javascript
  function updateNote(cid, patch, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    return getNoteRaw(cid).then((rec) => {
      if (!rec || rec.deleted) return Promise.reject(new Error("Note not found"));
      const content = patch.content != null ? patch.content : rec.content;
      const taskIds = (patch.linked_task_ids || []).concat(patch.linked_task_id != null ? [patch.linked_task_id] : []);
      return Promise.all([resolveLinkedTo(content), resolveLinkedTasks(taskIds)]).then(([toCids, taskCids]) => {
        const next = Object.assign({}, rec, {
          title: patch.title != null ? patch.title : rec.title,
          content: content,
          linked_to_cids: JSON.stringify(toCids),
          linked_task_cids: JSON.stringify(taskCids),
          updated_at: now, dirty: 1,
        });
        return putNote(next)
          .then(() => TFoutbox.outboxAdd({ op: "update", entity_type: "note", cid: cid, payload: next }))
          .then(() => (patch.tags != null ? TFtag.setEntityTags("note", cid, patch.tags) : null))
          .then(() => next);
      });
    });
  }

  function deleteNote(cid, opts) {
    return getNoteRaw(cid).then((rec) => {
      if (!rec || rec.deleted) return Promise.reject(new Error("Note not found"));
      const next = Object.assign({}, rec, { deleted: true, dirty: 1 });
      return putNote(next)
        .then(() => TFoutbox.outboxAdd({ op: "delete", entity_type: "note", cid: cid, payload: { cid: cid } }))
        .then(() => ({ ok: true }));
    });
  }

  function togglePin(cid, opts) {
    return getNoteRaw(cid).then((rec) => {
      if (!rec || rec.deleted) return Promise.reject(new Error("Note not found"));
      const next = Object.assign({}, rec, { pinned: !rec.pinned, dirty: 1 });
      return putNote(next)
        .then(() => TFoutbox.outboxAdd({ op: "pin", entity_type: "note", cid: cid, payload: { pinned: next.pinned } }))
        .then(() => next);
    });
  }
```

Update the `exported` line to include the new functions:

```javascript
  const exported = { createNote, updateNote, deleteNote, togglePin, getNoteRaw, putNote, resolveLinkedTo, resolveLinkedTasks };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/noterepo.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add static/offline/noterepo.js tests/offline/noterepo.test.js
git commit -m "feat(offline): noterepo update/delete/pin (#2f-1)"
```

---

## Task 4: notequery.js — shape + getNotes / getNote / getRecent

**Files:**
- Create: `static/offline/notequery.js`
- Test: `tests/offline/notequery.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/offline/notequery.test.js`:

```javascript
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { setEntityTags } = require("../../static/offline/tagrepo.js");
const { getNotes, getNote, getRecent } = require("../../static/offline/notequery.js");

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
    cid: over.cid, server_id: null, title: over.cid, content: "",
    linked_task_cids: "[]", linked_to_cids: "[]", pinned: false, list_id: null,
    created_at: "2026-06-01T00:00:00", updated_at: "2026-06-01T00:00:00", deleted: false, dirty: 0,
  }, over);
}

test("getNotes returns personal non-deleted notes ordered by updated_at DESC with display id", async () => {
  await put("scratchpad_notes", [
    note({ cid: "a", server_id: 5, title: "A", updated_at: "2026-06-02T00:00:00" }),
    note({ cid: "b", title: "B", updated_at: "2026-06-03T00:00:00" }),
    note({ cid: "c", title: "Gone", deleted: true }),
    note({ cid: "d", title: "Shared", list_id: 9 }),
  ]);
  const rows = await getNotes({});
  assert.deepEqual(rows.map((r) => r.id), ["b", 5]); // b newest; a has server_id 5; deleted+shared excluded
});

test("getNotes filters by q (title/content) and includes tags + pinned in shape", async () => {
  await put("scratchpad_notes", [note({ cid: "a", title: "Groceries", content: "milk", pinned: true })]);
  await setEntityTags("note", "a", ["home"]);
  const byTitle = await getNotes({ q: "groc" });
  assert.equal(byTitle.length, 1);
  assert.deepEqual(byTitle[0].tags, ["home"]);
  assert.equal(byTitle[0].pinned, true);
  const byContent = await getNotes({ q: "milk" });
  assert.equal(byContent.length, 1);
  assert.equal((await getNotes({ q: "zzz" })).length, 0);
});

test("getNotes filters by tag", async () => {
  await put("scratchpad_notes", [note({ cid: "a", title: "A" }), note({ cid: "b", title: "B" })]);
  await setEntityTags("note", "a", ["work"]);
  const rows = await getNotes({ tag: "work" });
  assert.deepEqual(rows.map((r) => r.id), ["a"]);
});

test("getNote shapes linked_to and linked_tasks via display ids", async () => {
  await put("tasks", [{ cid: "t1", server_id: 11, title: "Task One", priority: "P2", gtd_status: "next", deleted: false }]);
  await put("scratchpad_notes", [
    note({ cid: "tgt", server_id: 8, title: "Target" }),
    note({ cid: "main", title: "Main", linked_to_cids: '["tgt"]', linked_task_cids: '["t1"]' }),
  ]);
  const row = await getNote("main");
  assert.deepEqual(row.linked_to, [8]);
  assert.deepEqual(row.linked_task_ids, [11]);
  assert.deepEqual(row.linked_tasks, [{ id: 11, title: "Task One", priority: "P2", gtd_status: "next" }]);
});

test("getRecent returns the 5 most recent personal notes", async () => {
  const recs = [];
  for (let i = 0; i < 7; i++) recs.push(note({ cid: "n" + i, title: "N" + i, updated_at: "2026-06-0" + (i + 1) + "T00:00:00" }));
  await put("scratchpad_notes", recs);
  const rows = await getRecent();
  assert.equal(rows.length, 5);
  assert.equal(rows[0].id, "n6"); // newest first
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/notequery.test.js`
Expected: FAIL — `Cannot find module ... notequery.js`.

- [ ] **Step 3: Write minimal implementation**

Create `static/offline/notequery.js`:

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
  const TFtag = req("./tagrepo.js", root.TF && root.TF.tagrepo);

  function getAll(store) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction(store, "readonly").objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  const displayId = (rec) => (rec.server_id != null ? rec.server_id : rec.cid);
  const parseArr = (s) => { try { return JSON.parse(s || "[]"); } catch (_) { return []; } };

  // Build the server-shaped note dict. `ctx` carries lookup maps for links/tasks/tags.
  function shape(rec, ctx) {
    const toDisplay = parseArr(rec.linked_to_cids).map((c) => ctx.noteDisp[c]).filter((x) => x != null);
    const taskCids = parseArr(rec.linked_task_cids);
    const taskDisplay = taskCids.map((c) => (ctx.taskById[c] ? displayId(ctx.taskById[c]) : null)).filter((x) => x != null);
    const linkedTasks = taskCids.map((c) => ctx.taskById[c]).filter(Boolean).map((t) => ({
      id: displayId(t), title: t.title, priority: t.priority, gtd_status: t.gtd_status,
    }));
    return {
      id: displayId(rec), title: rec.title, content: rec.content,
      tags: (ctx.tagsByCid[rec.cid] || []).map((t) => t.name),
      pinned: !!rec.pinned,
      linked_task_ids: taskDisplay, linked_tasks: linkedTasks, linked_to: toDisplay,
      list_id: null, created_at: rec.created_at, updated_at: rec.updated_at,
    };
  }

  // Personal, non-deleted, newest first.
  function personalSorted(notes) {
    return notes.filter((n) => !n.deleted && n.list_id == null)
      .sort((a, b) => (String(b.updated_at) < String(a.updated_at) ? -1 : String(b.updated_at) > String(a.updated_at) ? 1 : 0));
  }

  function buildCtx(notes) {
    return Promise.all([getAll("tasks"), getAll("entity_tags"), getAll("tags")]).then(([tasks, ets, tags]) => {
      const noteDisp = {}; for (const n of notes) noteDisp[n.cid] = displayId(n);
      const taskById = {}; for (const t of tasks) taskById[t.cid] = t;
      const tagByCid = {}; for (const t of tags) tagByCid[t.cid] = t;
      const tagsByCid = {};
      for (const et of ets) {
        if (et.entity_type !== "note") continue;
        const t = tagByCid[et.tag_cid]; if (!t) continue;
        (tagsByCid[et.entity_cid] = tagsByCid[et.entity_cid] || []).push({ name: t.name });
      }
      for (const cid in tagsByCid) tagsByCid[cid].sort((a, b) => (a.name < b.name ? -1 : 1));
      return { noteDisp, taskById, tagsByCid };
    });
  }

  function getNotes(query) {
    const q = (query && query.q ? String(query.q) : "").toLowerCase();
    const tag = query && query.tag ? String(query.tag) : "";
    return getAll("scratchpad_notes").then((all) => {
      const notes = personalSorted(all);
      const tagP = tag ? TFtag.cidsForTag("note", tag) : Promise.resolve(null);
      return Promise.all([buildCtx(all), tagP]).then(([ctx, tagSet]) => {
        let list = notes;
        if (q) list = list.filter((n) => String(n.title || "").toLowerCase().includes(q) || String(n.content || "").toLowerCase().includes(q));
        if (tagSet) list = list.filter((n) => tagSet.has(n.cid));
        return list.map((n) => shape(n, ctx));
      });
    });
  }

  function getNote(cid) {
    return getAll("scratchpad_notes").then((all) => {
      const rec = all.find((n) => n.cid === cid);
      if (!rec) return null;
      return buildCtx(all).then((ctx) => shape(rec, ctx));
    });
  }

  function getRecent() {
    return getAll("scratchpad_notes").then((all) =>
      buildCtx(all).then((ctx) => personalSorted(all).slice(0, 5).map((n) => shape(n, ctx))));
  }

  const exported = { getNotes, getNote, getRecent };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.notequery = exported; }
  return exported;
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/notequery.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add static/offline/notequery.js tests/offline/notequery.test.js
git commit -m "feat(offline): notequery list/get/recent + shape (#2f-1)"
```

---

## Task 5: notequery.js — getTitles / getBacklinks

**Files:**
- Modify: `static/offline/notequery.js`
- Test: `tests/offline/notequery.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/offline/notequery.test.js`:

```javascript
const { getTitles, getBacklinks } = require("../../static/offline/notequery.js");

test("getTitles returns {id,title} for personal notes", async () => {
  await put("scratchpad_notes", [
    note({ cid: "a", server_id: 5, title: "Alpha" }),
    note({ cid: "b", title: "Beta" }),
    note({ cid: "c", title: "Shared", list_id: 4 }),
  ]);
  const rows = await getTitles();
  const ids = rows.map((r) => r.id).sort();
  assert.deepEqual(rows.map((r) => r.title).sort(), ["Alpha", "Beta"]);
  assert.ok(ids.includes(5) && ids.includes("b"));
});

test("getBacklinks returns notes whose linked_to includes the target cid", async () => {
  await put("scratchpad_notes", [
    note({ cid: "tgt", server_id: 8, title: "Target" }),
    note({ cid: "src1", title: "Src1", linked_to_cids: '["tgt"]' }),
    note({ cid: "src2", title: "Src2", linked_to_cids: '["other"]' }),
  ]);
  const rows = await getBacklinks("tgt");
  assert.deepEqual(rows.map((r) => r.title), ["Src1"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/notequery.test.js`
Expected: FAIL — `getTitles is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `static/offline/notequery.js`, add before the `exported` line:

```javascript
  function getTitles() {
    return getAll("scratchpad_notes").then((all) =>
      personalSorted(all).map((n) => ({ id: displayId(n), title: n.title })));
  }

  function getBacklinks(cid) {
    return getAll("scratchpad_notes").then((all) => {
      const sources = personalSorted(all).filter((n) => n.cid !== cid && parseArr(n.linked_to_cids).indexOf(cid) !== -1);
      return buildCtx(all).then((ctx) => sources.map((n) => shape(n, ctx)));
    });
  }
```

Update the `exported` line:

```javascript
  const exported = { getNotes, getNote, getRecent, getTitles, getBacklinks };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/notequery.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add static/offline/notequery.js tests/offline/notequery.test.js
git commit -m "feat(offline): notequery titles + backlinks (#2f-1)"
```

---

## Task 6: notehydrate.js — seed personal notes

**Files:**
- Create: `static/offline/notehydrate.js`
- Test: `tests/offline/notehydrate.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/offline/notehydrate.test.js`:

```javascript
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut, cidOf } = require("../../static/offline/idmap.js");
const { hydrateNotes, ensureNotes } = require("../../static/offline/notehydrate.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function allNotes() {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("scratchpad_notes").objectStore("scratchpad_notes").getAll(); q.onsuccess = () => res(q.result || []); });
}

test("hydrateNotes seeds personal notes (dirty 0, base_rev=updated_at) and skips shared", async () => {
  await hydrateNotes([
    { id: 1, title: "Personal", content: "x", list_id: null, linked_to: [], linked_task_ids: [], updated_at: "2026-06-05T00:00:00" },
    { id: 2, title: "Shared", content: "y", list_id: 9, linked_to: [], linked_task_ids: [], updated_at: "2026-06-05T00:00:00" },
  ]);
  const rows = await allNotes();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].server_id, 1);
  assert.equal(rows[0].dirty, 0);
  assert.equal(rows[0].base_rev, "2026-06-05T00:00:00");
  assert.equal(rows[0].list_id, null);
});

test("hydrateNotes resolves linked_to server ids to local cids (two-pass)", async () => {
  await hydrateNotes([
    { id: 1, title: "A", content: "", list_id: null, linked_to: [2], linked_task_ids: [], updated_at: "2026-06-05T00:00:00" },
    { id: 2, title: "B", content: "", list_id: null, linked_to: [], linked_task_ids: [], updated_at: "2026-06-05T00:00:00" },
  ]);
  const rows = await allNotes();
  const a = rows.find((r) => r.server_id === 1);
  const bCid = await cidOf("note", 2);
  assert.deepEqual(JSON.parse(a.linked_to_cids), [bCid]);
});

test("hydrateNotes resolves linked_task_ids via task idmap", async () => {
  await mapPut("task", 42, "tcid");
  await hydrateNotes([{ id: 1, title: "A", content: "", list_id: null, linked_to: [], linked_task_ids: [42], updated_at: "2026-06-05T00:00:00" }]);
  const rows = await allNotes();
  assert.deepEqual(JSON.parse(rows[0].linked_task_cids), ["tcid"]);
});

test("ensureNotes fetches /api/scratchpad and seeds", async () => {
  const rawFetch = () => Promise.resolve({ json: () => Promise.resolve([{ id: 1, title: "P", content: "", list_id: null, linked_to: [], linked_task_ids: [], updated_at: "2026-06-05T00:00:00" }]) });
  await ensureNotes(rawFetch);
  assert.equal((await allNotes()).length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/notehydrate.test.js`
Expected: FAIL — `Cannot find module ... notehydrate.js`.

- [ ] **Step 3: Write minimal implementation**

Create `static/offline/notehydrate.js`:

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
  const TFidmap = req("./idmap.js", root.TF && root.TF.idmap);

  function putNote(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("scratchpad_notes", "readwrite");
      tx.objectStore("scratchpad_notes").put(rec);
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

  function hydrateNotes(serverNotes) {
    const personal = (serverNotes || []).filter((n) => n.list_id == null);
    const cache = {};
    // Pass 1: mint a cid for every personal note so linked_to can resolve in pass 2.
    return personal.reduce((p, n) => p.then(() => ensureNoteCid(n.id, cache)), Promise.resolve())
      .then(() => personal.reduce((p, n) => p.then(() => {
        const cid = cache[n.id];
        const toCids = (n.linked_to || []).map((sid) => cache[sid]).filter(Boolean);
        const taskIds = n.linked_task_ids || [];
        return taskIds.reduce((q, tid) => q.then((acc) => TFidmap.cidOf("task", tid).then((c) => { if (c) acc.push(c); return acc; })), Promise.resolve([]))
          .then((taskCids) => putNote({
            cid: cid, server_id: n.id, title: n.title, content: n.content != null ? n.content : "",
            linked_task_cids: JSON.stringify(taskCids), linked_to_cids: JSON.stringify(toCids),
            pinned: !!n.pinned, list_id: null, last_edited_by: n.last_edited_by != null ? n.last_edited_by : null,
            created_at: n.created_at != null ? n.created_at : null, updated_at: n.updated_at != null ? n.updated_at : null,
            deleted: false, dirty: 0, base_rev: n.updated_at != null ? n.updated_at : null,
          }));
      }), Promise.resolve()));
  }

  let _ensured = null;
  function ensureNotes(rawFetch) {
    if (_ensured) return _ensured;
    _ensured = Promise.resolve(rawFetch("/api/scratchpad"))
      .then((r) => (r && typeof r.json === "function" ? r.json() : r))
      .then((notes) => hydrateNotes(notes || []))
      .catch((e) => { _ensured = null; throw e; });
    return _ensured;
  }

  const exported = { hydrateNotes, ensureNotes };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.notehydrate = exported; }
  return exported;
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/notehydrate.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add static/offline/notehydrate.js tests/offline/notehydrate.test.js
git commit -m "feat(offline): notehydrate seed personal notes (#2f-1)"
```

---

## Task 7: noteroutes.js + wire into buildTaskRouter

**Files:**
- Create: `static/offline/noteroutes.js`
- Modify: `static/offline/taskroutes.js`
- Test: `tests/offline/noteroutes.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/offline/noteroutes.test.js`:

```javascript
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

test("POST then GET /api/scratchpad round-trips a local note", async () => {
  const R = buildTaskRouter();
  const created = await R.dispatch("POST", "/api/scratchpad", { title: "Hello", content: "world", tags: ["x"] });
  assert.equal(created.title, "Hello");
  const list = await R.dispatch("GET", "/api/scratchpad", undefined);
  assert.equal(list.length, 1);
  assert.equal(list[0].title, "Hello");
  assert.deepEqual(list[0].tags, ["x"]);
});

test("GET /api/scratchpad/:id, PUT, pin, DELETE, backlinks via router", async () => {
  const R = buildTaskRouter();
  const a = await R.dispatch("POST", "/api/scratchpad", { title: "A", content: "", tags: [] });
  await R.dispatch("POST", "/api/scratchpad", { title: "B", content: "[[A]]", tags: [] });
  const got = await R.dispatch("GET", "/api/scratchpad/" + a.id, undefined);
  assert.equal(got.title, "A");
  await R.dispatch("PUT", "/api/scratchpad/" + a.id, { title: "A2", content: "", tags: [] });
  assert.equal((await R.dispatch("GET", "/api/scratchpad/" + a.id, undefined)).title, "A2");
  const pinned = await R.dispatch("PATCH", "/api/scratchpad/" + a.id + "/pin", undefined);
  assert.equal(pinned.pinned, true);
  const back = await R.dispatch("GET", "/api/scratchpad/" + a.id + "/backlinks", undefined);
  assert.deepEqual(back.map((n) => n.title), ["B"]);
  await R.dispatch("DELETE", "/api/scratchpad/" + a.id, undefined);
  assert.equal((await R.dispatch("GET", "/api/scratchpad", undefined)).length, 1); // only B remains
});

test("GET /api/scratchpad/titles + /recent are registered (win over /:id by specificity)", async () => {
  const R = buildTaskRouter();
  await R.dispatch("POST", "/api/scratchpad", { title: "T1", content: "", tags: [] });
  assert.equal((await R.dispatch("GET", "/api/scratchpad/titles", undefined)).length, 1);
  assert.equal((await R.dispatch("GET", "/api/scratchpad/recent", undefined)).length, 1);
});

test("PATCH /api/scratchpad/:id/share is NOT registered (stays network)", async () => {
  const R = buildTaskRouter();
  assert.equal(R.hasRoute("PATCH", "/api/scratchpad/5/share"), false);
});
```

Router API (verified in `router.js`): `R.register(method, pattern, handler)`, `R.dispatch(method, path, body) → Promise`, `R.hasRoute(method, path) → bool`. Route matching is by **specificity** (static-segment count, highest wins) — so `/recent`, `/titles`, `/:id/backlinks` automatically beat `/:id`; **registration order does not matter**.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/noteroutes.test.js`
Expected: FAIL — note routes not registered (`/api/scratchpad` does not match).

- [ ] **Step 3: Write minimal implementation**

Create `static/offline/noteroutes.js`:

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
  const TFrepo = req("./noterepo.js", root.TF && root.TF.noterepo);
  const TFquery = req("./notequery.js", root.TF && root.TF.notequery);

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
  function notFound() { return Promise.reject(new Error("Note not found")); }

  function registerNoteRoutes(router) {
    router.register("GET", "/api/scratchpad", ({ query }) => TFquery.getNotes(query || {}));
    router.register("GET", "/api/scratchpad/recent", () => TFquery.getRecent());
    router.register("GET", "/api/scratchpad/titles", () => TFquery.getTitles());
    router.register("GET", "/api/scratchpad/:id/backlinks", ({ params }) =>
      resolveNoteCid(params.id).then((cid) => (cid ? TFquery.getBacklinks(cid) : notFound())));
    router.register("GET", "/api/scratchpad/:id", ({ params }) =>
      resolveNoteCid(params.id).then((cid) => (cid ? TFquery.getNote(cid) : notFound())));
    router.register("POST", "/api/scratchpad", ({ body }) =>
      TFrepo.createNote(body || {}, {}).then((rec) => TFquery.getNote(rec.cid)));
    router.register("PUT", "/api/scratchpad/:id", ({ params, body }) =>
      resolveNoteCid(params.id).then((cid) => (cid ? TFrepo.updateNote(cid, body || {}, {}).then(() => TFquery.getNote(cid)) : notFound())));
    router.register("DELETE", "/api/scratchpad/:id", ({ params }) =>
      resolveNoteCid(params.id).then((cid) => (cid ? TFrepo.deleteNote(cid, {}) : notFound())));
    router.register("PATCH", "/api/scratchpad/:id/pin", ({ params }) =>
      resolveNoteCid(params.id).then((cid) => (cid ? TFrepo.togglePin(cid, {}).then(() => TFquery.getNote(cid)) : notFound())));
  }

  const exported = { registerNoteRoutes };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.noteroutes = exported; }
  return exported;
});
```

NOTE on route ordering: not a concern — `router.js` matches by **specificity** (static-segment count), so `/recent`, `/titles`, and `/:id/backlinks` win over `/:id` regardless of registration order. (The order above is just for readability.)

In `static/offline/taskroutes.js`: add the require near the other route requires (after line 20):

```javascript
  const TFnoteroutes = req("./noteroutes.js", root.TF && root.TF.noteroutes);
```

And call it inside `buildTaskRouter`, right after `TFhabitroutes.registerHabitRoutes(router);`:

```javascript
    TFnoteroutes.registerNoteRoutes(router);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/noteroutes.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full offline suite (no regressions)**

Run: `node --test tests/offline/*.test.js`
Expected: `fail 0`, pass count = previous total + all new note tests.

- [ ] **Step 6: Commit**

```bash
git add static/offline/noteroutes.js static/offline/taskroutes.js tests/offline/noteroutes.test.js
git commit -m "feat(offline): noteroutes registered on the LocalRouter (#2f-1)"
```

---

## Task 8: Wire modules + boot hydration in index.html

**Files:**
- Modify: `static/index.html` (script block ≈1326-1342; boot ≈20703)

- [ ] **Step 1: Load the 5 note modules**

In `static/index.html`, in the offline `<script src>` block, add the note modules. They must load AFTER `tagrepo.js` and `idmap`/`ids` (already early) and BEFORE `taskroutes.js` (which requires `noteroutes` at load). Insert right before the `listsync.js` line (≈1337):

```html
  <script src="/static/offline/notelogic.js"></script>
  <script src="/static/offline/noterepo.js"></script>
  <script src="/static/offline/notequery.js"></script>
  <script src="/static/offline/notehydrate.js"></script>
  <script src="/static/offline/noteroutes.js"></script>
```

(Result: `...habitroutes.js`, then the 5 note lines, then `listsync.js`, then `taskroutes.js`.)

- [ ] **Step 2: Hydrate notes at boot**

Find the boot block (≈20703) that runs `await sync()` when online. Add a personal-notes hydration call right after it (mirrors how habits seeded in #2e-1; folding into `sync()` happens in #2f-2):

```javascript
    if (navigator.onLine && __token) {
      try { await sync(); } catch (e) {}
      try { if (window.TF && window.TF.notehydrate) await window.TF.notehydrate.ensureNotes(__syncRawFetch); } catch (e) {}
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
git commit -m "feat(offline): load note modules + hydrate notes on boot (#2f-1)"
```

---

## Task 9: Bump service worker cache

**Files:**
- Modify: `static/sw.js`

- [ ] **Step 1: Bump CACHE + precache note modules**

In `static/sw.js`, change line 1:

```javascript
const CACHE = "taskflow-v126-habit-sync";
```
to:
```javascript
const CACHE = "taskflow-v127-notes-local";
```

Then find the `STATIC` precache array and add the 5 note module paths alongside the other `/static/offline/*.js` entries (match the existing style/quoting):

```javascript
  "/static/offline/notelogic.js",
  "/static/offline/noterepo.js",
  "/static/offline/notequery.js",
  "/static/offline/notehydrate.js",
  "/static/offline/noteroutes.js",
```

(If the existing offline modules are NOT individually listed in STATIC — verify by reading sw.js — then only the version bump is needed; do not invent entries. Match whatever pattern the habit modules used in v125.)

- [ ] **Step 2: Commit**

```bash
git add static/sw.js
git commit -m "chore(sw): bump cache v127 + precache note modules (#2f-1)"
```

---

## Task 10: Full suite + deploy + browser verify

- [ ] **Step 1: Run the whole offline suite**

Run (root repo Z:): `node --test tests/offline/*.test.js`
Expected: `fail 0`; pass = 207 + new note tests (target ~230+).

- [ ] **Step 2: Merge ff to main + push**

```bash
git checkout main
git merge --ff-only <branch>
git push origin main
```
(Skip if working directly on `main`.)

- [ ] **Step 3: Verify deploy (backend unchanged — no taskflow-web restart)**

Run: `curl -s https://todo.yatno.web.id/sw.js | findstr CACHE`
Expected: `const CACHE = "taskflow-v127-notes-local";` (see [[feedback_deploy_silent_fail]]).

- [ ] **Step 4: Browser verify (reset SW first in the login tab)**

In DevTools console (https://todo.yatno.web.id), unregister SW + clear caches + reload, then:
1. Offline: notes list loads from local; create note "Belanja #rumah"; appears in list with tag.
2. Create note with `[[Belanja]]` → wikilink resolves; open `Belanja` → its backlinks show the linking note.
3. Edit / pin / delete a note offline — all reflect immediately from local.
4. Filter notes by tag `rumah` → only tagged notes.
5. Shared notes (if any) are NOT shown via the list (accepted island limitation).
6. Tasks & habits still work; no console errors; no double-write to OfflineDB (legacy dead under intercept).

Record result (e.g. "6/6 ✅") for the [[project_offline_native]] memory update.

---

## Self-review notes

- **Spec coverage:** notelogic/parseWikilinks (T1); noterepo create+wikilink/task resolve (T2), update/delete/pin (T3); notequery list/q/tag/get/recent+shape (T4), titles/backlinks (T5); notehydrate personal-only + skip-shared + two-pass linked_to + task idmap (T6); noteroutes 9 routes + `/share` excluded + wired into buildTaskRouter (T7); index.html load+boot (T8); SW v127 (T9); suite+deploy+browser (T10). All spec sections covered.
- **No backend change:** confirmed — all endpoints predate this slice; Opsi B (no push).
- **Type/name consistency:** `createNote/updateNote/deleteNote/togglePin/resolveLinkedTo/resolveLinkedTasks/getNoteRaw/putNote` (noterepo); `getNotes/getNote/getRecent/getTitles/getBacklinks/shape/personalSorted/buildCtx/displayId/parseArr` (notequery); `hydrateNotes/ensureNotes/ensureNoteCid` (notehydrate); `registerNoteRoutes/resolveNoteCid` (noteroutes). Record fields: `linked_task_cids`/`linked_to_cids` (JSON strings), `pinned`, `list_id`, `deleted`, `dirty`, `base_rev` — consistent across tasks.
- **Router API verified in `router.js`:** `register`/`dispatch(method,path,body)`/`hasRoute` (no `match`). Test uses `R.dispatch`/`R.hasRoute`. Matching is by specificity → explicit paths beat `/:id` regardless of registration order.
- **Legacy OfflineDB notes:** left dead-under-intercept (cleanup deferred, matching habits #2e-1); browser step 6 verifies no regression / double-write.
