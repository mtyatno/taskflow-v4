# Offline Chat (#2h-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make per-list chat usable offline — cache history locally for reading and queue outgoing messages (compose offline → outbox → auto-send on reconnect with optimistic display), deduplicated exactly via a new server `client_id`.

**Architecture:** New local store `chat_messages` (db v4). New modules `chatrepo.js` (cache/query/send/enrich) and `chatroutes.js` (read-through GET + optimistic POST intercept), wired into `buildTaskRouter`. One push handler `opChatSend` in `syncpush.js`. Backend `messages` table gains a nullable `client_id` column. ChatRoom UI persists SSE messages to cache and dedups by `client_id`. No `syncpull` change (lazy read-through; queued sends flush via existing outbox push).

**Tech Stack:** Vanilla UMD modules (browser `window.TF.*` + Node `require`), IndexedDB (fake-indexeddb in tests), `node --test`, FastAPI + SQLite (Python backend).

**Reference spec:** `docs/superpowers/specs/2026-06-11-offline-chat-design.md`

**Baseline before starting:** `node --test tests/offline/*.test.js` → `pass 291`.

**Key facts established from the codebase (do not re-derive):**
- `db.js` has `DB_VERSION` and an `ENTITY_STORES` map; `createSchema` creates any missing store on `onupgradeneeded`. Adding a store = add to the map + bump version. Each entity store is keyed by `cid`.
- idmap API: `mapPut(type, serverId, cid)`, `cidOf(type, serverId)`, `serverIdOf(cid)` (returns `undefined` when unmapped), `mapDelete(type, serverId)`. Use `type === "message"`.
- outbox API: `outboxAdd(op)`, `outboxAll()`, `outboxRemove(qid)`, `outboxByEntity(type, cid)`.
- `syncpush.js` helpers already in file: `send(transport, method, path, body)`, `ok(res)`. Transport returns `{status, data}`. `processOp(op, transport, tagsFor, habitTagsFor, result)` dispatches by `op.entity_type`/`op.op`.
- Read-through pattern precedent: `drawingrepo.configureFetcher` + `drawingroutes` GET (online → fetch + cache + return; offline → local). `onlineNow = () => (typeof navigator !== "undefined" ? navigator.onLine : true)`.
- Server message dict shape (from `webapp.py` GET/POST): `{id, list_id, user_id, content, task_id, note_id, msg_type, created_at, reply_to_id, username, display_name, task_title, task_priority, task_deadline, task_quadrant, task_status, note_title, reply_to_username, reply_to_display_name, reply_to_content}`. The server `task_status` field = the task's `gtd_status`.
- Backend migration pattern (mirror exactly), `webapp.py:222-231` — guarded `PRAGMA table_info` + `ALTER TABLE ... ADD COLUMN`.
- `MessageCreate` is at `webapp.py:518-523`. POST endpoint at `webapp.py:1951`, its broadcast SELECT at `1975-1992`. GET endpoint SELECT at `1878-1895` (used by both `before_id` and default branches).
- Frontend: `ChatRoom` (index.html ~12115) has `user` in scope (`{id, username, display_name}` from `/api/auth/me`). SSE handler ~12156; `onSent` ~12365; message bubble `chat-time` ~12354; `handleSend` in `ChatInputBar` ~12562. Current user loaded in App at ~12436 (`api.get("/api/auth/me").then(setUser)`), with an offline-token fallback at ~12440.

---

### Task 1: db v4 — add `chat_messages` store

**Files:**
- Modify: `static/offline/db.js`
- Test: `tests/offline/chatdb.test.js`

- [ ] **Step 1: Write the failing test** — create `tests/offline/chatdb.test.js`:

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, DB_VERSION, _reset, openDB } = require("../../static/offline/db.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

test("DB_VERSION is 4", () => {
  assert.equal(DB_VERSION, 4);
});

test("chat_messages store exists with list_id, created_at, server_id, client_id indexes", async () => {
  const db = await openDB();
  assert.equal(db.objectStoreNames.contains("chat_messages"), true);
  const idx = db.transaction("chat_messages", "readonly").objectStore("chat_messages").indexNames;
  for (const name of ["list_id", "created_at", "server_id", "client_id"]) {
    assert.equal(idx.contains(name), true, "missing index " + name);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/chatdb.test.js`
Expected: FAIL — `DB_VERSION` is 3 / store missing.

- [ ] **Step 3: Implement** — in `static/offline/db.js`:

Change the version constant (line ~12):

```js
  const DB_VERSION = 4;
```

Add a `chat_messages` entry to the `ENTITY_STORES` map (place it right after the `mindmaps:` line):

```js
    chat_messages: [
      ["list_id", "list_id"], ["created_at", "created_at"],
      ["server_id", "server_id"], ["client_id", "cid"],
    ],
```

(The `client_id` index points at the record's own `cid` keyPath — the cid IS the client_id sent to the server. `createSchema` creates the store and these indexes on the v3→v4 upgrade; existing stores/data are untouched.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/chatdb.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite to confirm no regression**

Run: `node --test tests/offline/*.test.js`
Expected: `pass 293` (291 + 2), `fail 0`. (All other suites `deleteDB` + `_reset` per test, so the version bump is transparent.)

- [ ] **Step 6: Commit**

```bash
git add static/offline/db.js tests/offline/chatdb.test.js
git commit -m "feat(offline): db v4 adds chat_messages store (#2h-1)"
```

---

### Task 2: `chatrepo.js` — local cache, query, optimistic send

**Files:**
- Create: `static/offline/chatrepo.js`
- Test: `tests/offline/chatrepo.test.js`

- [ ] **Step 1: Write the failing test** — create `tests/offline/chatrepo.test.js`:

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { cidOf } = require("../../static/offline/idmap.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const {
  cacheMessages, getMessages, sendMessage, upsertIncoming, setCurrentUser, getCurrentUser,
} = require("../../static/offline/chatrepo.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); setCurrentUser(null); });

async function put(store, recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    for (const r of recs) os.put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
function srv(over) {
  return Object.assign({
    id: over.id, list_id: 7, user_id: 2, content: "hi", task_id: null, note_id: null,
    msg_type: "text", created_at: over.created_at || "2026-06-11T00:00:00", reply_to_id: null,
    client_id: over.client_id != null ? over.client_id : null,
    username: "bob", display_name: "Bob",
  }, over);
}

test("cacheMessages inserts new server messages with cid + idmap, no data_json", async () => {
  await cacheMessages([srv({ id: 10, content: "a" }), srv({ id: 11, content: "b", created_at: "2026-06-11T00:01:00" })]);
  const list = await getMessages(7, {});
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((m) => m.content), ["a", "b"]); // ascending by created_at
  assert.equal(list[0].id, 10);
  assert.ok(await cidOf("message", 10));
});

test("cacheMessages dedups by server_id (idempotent)", async () => {
  await cacheMessages([srv({ id: 10, content: "a" })]);
  await cacheMessages([srv({ id: 10, content: "a" })]);
  assert.equal((await getMessages(7, {})).length, 1);
});

test("cacheMessages confirms an optimistic message by client_id (no duplicate)", async () => {
  setCurrentUser({ user_id: 2, username: "me", display_name: "Me" });
  const opt = await sendMessage(7, { content: "hello" }, getCurrentUser(), { now: "2026-06-11T00:00:00", cid: "c-1" });
  assert.equal(opt.pending, 1);
  assert.equal(opt.id, "c-1"); // optimistic id = cid
  await cacheMessages([srv({ id: 50, content: "hello", client_id: "c-1", user_id: 2 })]);
  const list = await getMessages(7, {});
  assert.equal(list.length, 1); // same logical message, not duplicated
  assert.equal(list[0].id, 50);
  assert.equal(list[0].pending, 0);
});

test("getMessages applies before_id pagination + limit, returns ascending", async () => {
  await cacheMessages([
    srv({ id: 1, content: "m1", created_at: "2026-06-11T00:00:01" }),
    srv({ id: 2, content: "m2", created_at: "2026-06-11T00:00:02" }),
    srv({ id: 3, content: "m3", created_at: "2026-06-11T00:00:03" }),
  ]);
  const older = await getMessages(7, { before_id: 3 });
  assert.deepEqual(older.map((m) => m.content), ["m1", "m2"]);
  const limited = await getMessages(7, { limit: 1 });
  assert.deepEqual(limited.map((m) => m.content), ["m3"]); // newest-last, last `limit`
});

test("sendMessage writes optimistic pending record + send op + local enrichment", async () => {
  setCurrentUser({ user_id: 9, username: "me", display_name: "Me" });
  await put("tasks", [{ cid: "tk", server_id: 100, title: "Fix bug", priority: "P1", deadline: "2026-06-12", quadrant: "Q1", gtd_status: "next" }]);
  const out = await sendMessage(7, { content: "see this", task_id: 100, msg_type: "task_attach" }, getCurrentUser(), { now: "2026-06-11T03:00:00", cid: "c-9" });
  assert.equal(out.pending, 1);
  assert.equal(out.user_id, 9);
  assert.equal(out.username, "me");
  assert.equal(out.task_title, "Fix bug");
  assert.equal(out.task_status, "next"); // gtd_status -> task_status
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].entity_type, "message");
  assert.equal(ops[0].op, "send");
  assert.equal(ops[0].cid, "c-9");
});

test("upsertIncoming caches a single SSE message", async () => {
  await upsertIncoming(srv({ id: 77, content: "live" }));
  const list = await getMessages(7, {});
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 77);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/chatrepo.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `static/offline/chatrepo.js`:

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
  const TFidmap = req("./idmap.js", root.TF && root.TF.idmap);

  let _fetcher = null;
  let _currentUser = null;
  function configureFetcher(fn) { _fetcher = fn; }
  function getFetcher() { return _fetcher; }
  function setCurrentUser(u) { _currentUser = u; }
  function getCurrentUser() { return _currentUser; }

  function getAll() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("chat_messages", "readonly").objectStore("chat_messages").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  function getAllFrom(store) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction(store, "readonly").objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  function putRaw(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("chat_messages", "readwrite");
      tx.objectStore("chat_messages").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  // Local record -> server-shaped display object the ChatRoom renders.
  function shape(rec) {
    return {
      id: rec.server_id != null ? rec.server_id : rec.cid, // pending -> cid
      client_id: rec.cid,
      list_id: rec.list_id, user_id: rec.user_id, content: rec.content,
      task_id: rec.task_id, note_id: rec.note_id, msg_type: rec.msg_type,
      reply_to_id: rec.reply_to_id, created_at: rec.created_at,
      username: rec.username, display_name: rec.display_name,
      task_title: rec.task_title, task_priority: rec.task_priority, task_deadline: rec.task_deadline,
      task_quadrant: rec.task_quadrant, task_status: rec.task_status,
      note_title: rec.note_title,
      reply_to_username: rec.reply_to_username, reply_to_display_name: rec.reply_to_display_name,
      reply_to_content: rec.reply_to_content,
      pending: rec.pending ? 1 : 0,
    };
  }

  // Upsert one server message dict into the store, deduping by server_id then client_id.
  // `all` is the current snapshot (kept current by the caller for batch dedup).
  function upsertOne(all, msg) {
    let existing = null;
    if (msg.id != null) existing = all.find((r) => r.server_id != null && String(r.server_id) === String(msg.id));
    if (!existing && msg.client_id) existing = all.find((r) => r.cid === msg.client_id);
    const cid = existing ? existing.cid : TFids.newCid();
    const rec = {
      cid: cid,
      server_id: msg.id != null ? msg.id : (existing ? existing.server_id : null),
      list_id: msg.list_id, user_id: msg.user_id,
      content: msg.content != null ? msg.content : "",
      task_id: msg.task_id != null ? msg.task_id : null,
      note_id: msg.note_id != null ? msg.note_id : null,
      msg_type: msg.msg_type || "text",
      reply_to_id: msg.reply_to_id != null ? msg.reply_to_id : null,
      created_at: msg.created_at,
      username: msg.username != null ? msg.username : null,
      display_name: msg.display_name != null ? msg.display_name : null,
      task_title: msg.task_title != null ? msg.task_title : null,
      task_priority: msg.task_priority != null ? msg.task_priority : null,
      task_deadline: msg.task_deadline != null ? msg.task_deadline : null,
      task_quadrant: msg.task_quadrant != null ? msg.task_quadrant : null,
      task_status: msg.task_status != null ? msg.task_status : null,
      note_title: msg.note_title != null ? msg.note_title : null,
      reply_to_username: msg.reply_to_username != null ? msg.reply_to_username : null,
      reply_to_display_name: msg.reply_to_display_name != null ? msg.reply_to_display_name : null,
      reply_to_content: msg.reply_to_content != null ? msg.reply_to_content : null,
      pending: 0,
    };
    return putRaw(rec)
      .then(() => (rec.server_id != null ? TFidmap.mapPut("message", rec.server_id, cid) : null))
      .then(() => rec);
  }

  function cacheMessages(serverMsgs) {
    const list = serverMsgs || [];
    return getAll().then((all) =>
      list.reduce((p, msg) => p.then(() => upsertOne(all, msg).then((rec) => {
        const idx = all.findIndex((r) => r.cid === rec.cid);
        if (idx >= 0) all[idx] = rec; else all.push(rec);
      })), Promise.resolve()));
  }

  function upsertIncoming(msg) {
    return getAll().then((all) => upsertOne(all, msg)).then(() => undefined);
  }

  function getMessages(listId, query) {
    query = query || {};
    const limit = query.limit != null ? Number(query.limit) : 50;
    const beforeId = query.before_id != null ? query.before_id : null;
    return getAll().then((all) => {
      let rows = all.filter((r) => String(r.list_id) === String(listId));
      rows.sort((a, b) => {
        if (a.created_at < b.created_at) return -1;
        if (a.created_at > b.created_at) return 1;
        const as = a.server_id != null ? a.server_id : Infinity;
        const bs = b.server_id != null ? b.server_id : Infinity;
        return as - bs;
      });
      if (beforeId != null) {
        const refIdx = rows.findIndex((r) => r.server_id != null && String(r.server_id) === String(beforeId));
        if (refIdx >= 0) rows = rows.slice(0, refIdx);
      }
      const sliced = rows.slice(Math.max(0, rows.length - limit));
      return sliced.map(shape);
    });
  }

  function sendMessage(listId, payload, currentUser, opts) {
    payload = payload || {};
    const cu = currentUser || _currentUser || {};
    const now = (opts && opts.now) || new Date().toISOString();
    const cid = (opts && opts.cid) || TFids.newCid();
    return Promise.all([
      payload.task_id != null ? getAllFrom("tasks") : Promise.resolve([]),
      payload.note_id != null ? getAllFrom("scratchpad_notes") : Promise.resolve([]),
      payload.reply_to_id != null ? getAll() : Promise.resolve([]),
    ]).then(([tasks, notes, msgs]) => {
      const task = payload.task_id != null ? tasks.find((t) => String(t.server_id) === String(payload.task_id) || t.cid === payload.task_id) : null;
      const note = payload.note_id != null ? notes.find((n) => String(n.server_id) === String(payload.note_id) || n.cid === payload.note_id) : null;
      const reply = payload.reply_to_id != null ? msgs.find((m) => String(m.server_id) === String(payload.reply_to_id) || m.cid === payload.reply_to_id) : null;
      const rec = {
        cid: cid, server_id: null, list_id: Number(listId),
        user_id: cu.user_id != null ? cu.user_id : null,
        content: payload.content != null ? payload.content : "",
        task_id: payload.task_id != null ? payload.task_id : null,
        note_id: payload.note_id != null ? payload.note_id : null,
        msg_type: payload.msg_type || "text",
        reply_to_id: payload.reply_to_id != null ? payload.reply_to_id : null,
        created_at: now,
        username: cu.username != null ? cu.username : null,
        display_name: cu.display_name != null ? cu.display_name : null,
        task_title: task ? task.title : null,
        task_priority: task ? task.priority : null,
        task_deadline: task ? task.deadline : null,
        task_quadrant: task ? task.quadrant : null,
        task_status: task ? task.gtd_status : null,
        note_title: note ? note.title : null,
        reply_to_username: reply ? reply.username : null,
        reply_to_display_name: reply ? reply.display_name : null,
        reply_to_content: reply ? reply.content : null,
        pending: 1,
      };
      return putRaw(rec)
        .then(() => TFoutbox.outboxAdd({ op: "send", entity_type: "message", cid: cid, payload: { cid: cid } }))
        .then(() => shape(rec));
    });
  }

  const exported = {
    cacheMessages, getMessages, sendMessage, upsertIncoming,
    configureFetcher, getFetcher, setCurrentUser, getCurrentUser,
  };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.chatrepo = exported; }
  return exported;
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/chatrepo.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add static/offline/chatrepo.js tests/offline/chatrepo.test.js
git commit -m "feat(offline): chatrepo local cache + optimistic send (#2h-1)"
```

---

### Task 3: `chatroutes.js` — read-through GET + optimistic POST, wired in

**Files:**
- Create: `static/offline/chatroutes.js`
- Modify: `static/offline/taskroutes.js`
- Test: `tests/offline/chatroutes.test.js`

- [ ] **Step 1: Write the failing test** — create `tests/offline/chatroutes.test.js`:

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset } = require("../../static/offline/db.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");
const chatrepo = require("../../static/offline/chatrepo.js");
const { outboxAll } = require("../../static/offline/outbox.js");

beforeEach(async () => {
  _reset(); await deleteDB(DB_NAME);
  chatrepo.setCurrentUser({ user_id: 1, username: "me", display_name: "Me" });
  chatrepo.configureFetcher(null);
});

test("POST /api/lists/:id/messages returns optimistic record + enqueues send op", async () => {
  const R = buildTaskRouter();
  const out = await R.dispatch("POST", "/api/lists/7/messages", { content: "hi" });
  assert.equal(out.pending, 1);
  assert.equal(out.content, "hi");
  assert.equal(out.username, "me");
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].entity_type, "message");
});

test("GET offline returns local cache (paginated)", async () => {
  await chatrepo.cacheMessages([
    { id: 1, list_id: 7, user_id: 2, content: "a", msg_type: "text", created_at: "2026-06-11T00:00:01", username: "bob" },
    { id: 2, list_id: 7, user_id: 2, content: "b", msg_type: "text", created_at: "2026-06-11T00:00:02", username: "bob" },
  ]);
  const R = buildTaskRouter();
  // offline: navigator.onLine is false under fake-indexeddb/node (no navigator) -> onlineNow() true,
  // but with no fetcher configured the route must fall back to local cache.
  const list = await R.dispatch("GET", "/api/lists/7/messages", undefined);
  assert.deepEqual(list.map((m) => m.content), ["a", "b"]);
});

test("GET online calls the fetcher, caches, and returns server data", async () => {
  let calledUrl = null;
  chatrepo.configureFetcher((url) => {
    calledUrl = url;
    return Promise.resolve([{ id: 9, list_id: 7, user_id: 2, content: "fromServer", msg_type: "text", created_at: "2026-06-11T00:00:05", username: "bob" }]);
  });
  const R = buildTaskRouter();
  const list = await R.dispatch("GET", "/api/lists/7/messages?limit=50", { limit: "50" });
  assert.equal(calledUrl, "/api/lists/7/messages?limit=50");
  assert.equal(list.length, 1);
  assert.equal(list[0].content, "fromServer");
  // cached locally
  const cached = await chatrepo.getMessages(7, {});
  assert.equal(cached.length, 1);
});

test("SSE stream route is NOT intercepted", () => {
  const R = buildTaskRouter();
  assert.equal(R.hasRoute("GET", "/api/lists/7/messages/stream"), false);
});
```

NOTE: the "GET online calls the fetcher" test forces the online path by configuring a fetcher; `onlineNow()` returns `true` in Node (no `navigator`). The "offline returns local cache" test leaves the fetcher `null`, so the route falls back to `getMessages` even though `onlineNow()` is `true` — i.e. the route uses the local cache whenever there is no usable fetcher OR the device is offline.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/chatroutes.test.js`
Expected: FAIL — module not found / routes unregistered.

- [ ] **Step 3a: Implement** — create `static/offline/chatroutes.js`:

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
  const TFrepo = req("./chatrepo.js", root.TF && root.TF.chatrepo);

  const onlineNow = () => (typeof navigator !== "undefined" ? navigator.onLine : true);

  function buildUrl(listId, q) {
    let url = "/api/lists/" + listId + "/messages";
    const qs = [];
    if (q && q.limit != null) qs.push("limit=" + encodeURIComponent(q.limit));
    if (q && q.before_id != null) qs.push("before_id=" + encodeURIComponent(q.before_id));
    if (qs.length) url += "?" + qs.join("&");
    return url;
  }

  function registerChatRoutes(router) {
    router.register("GET", "/api/lists/:id/messages", ({ params, query }) => {
      const listId = params.id;
      const q = query || {};
      const fetcher = TFrepo.getFetcher();
      if (onlineNow() && fetcher) {
        return Promise.resolve(fetcher(buildUrl(listId, q)))
          .then((serverMsgs) => {
            const list = Array.isArray(serverMsgs) ? serverMsgs : [];
            return TFrepo.cacheMessages(list).then(() => list);
          })
          .catch(() => TFrepo.getMessages(listId, q));
      }
      return TFrepo.getMessages(listId, q);
    });
    router.register("POST", "/api/lists/:id/messages", ({ params, body }) =>
      TFrepo.sendMessage(params.id, body || {}, TFrepo.getCurrentUser(), {}));
  }

  const exported = { registerChatRoutes };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.chatroutes = exported; }
  return exported;
});
```

- [ ] **Step 3b: Wire into `static/offline/taskroutes.js`**

After the `TFmindmaproutes` require line (added in the mindmaps slice, ~line 23), add:

```js
  const TFchatroutes = req("./chatroutes.js", root.TF && root.TF.chatroutes);
```

Inside `buildTaskRouter`, after `TFmindmaproutes.registerMindmapRoutes(router);`, add:

```js
    TFchatroutes.registerChatRoutes(router);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/chatroutes.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Run full suite**

Run: `node --test tests/offline/*.test.js`
Expected: `pass 303` (293 + 6 + 4), `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add static/offline/chatroutes.js static/offline/taskroutes.js tests/offline/chatroutes.test.js
git commit -m "feat(offline): chatroutes read-through GET + optimistic POST (#2h-1)"
```

---

### Task 4: `syncpush.js` — `opChatSend` handler

**Files:**
- Modify: `static/offline/syncpush.js`
- Test: `tests/offline/chatsync_push.test.js`

- [ ] **Step 1: Write the failing test** — create `tests/offline/chatsync_push.test.js`:

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { serverIdOf, mapPut } = require("../../static/offline/idmap.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const { pushOutbox } = require("../../static/offline/syncpush.js");

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
async function getMsg(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("chat_messages").objectStore("chat_messages").get(cid); q.onsuccess = () => res(q.result); });
}
function msg(over) {
  return Object.assign({
    cid: over.cid, server_id: null, list_id: 7, user_id: 1, content: "hi",
    task_id: null, note_id: null, msg_type: "text", reply_to_id: null,
    created_at: "2026-06-11T00:00:00", pending: 1,
  }, over);
}
function fakeTransport(handler) {
  const calls = [];
  return { calls, request(method, path, body) { calls.push({ method, path, body }); const h = handler(method, path, body); if (h === "NETWORK") return Promise.reject(new Error("net")); return Promise.resolve(h); } };
}

test("opChatSend POSTs with client_id, sets server_id + idmap + created_at, clears pending", async () => {
  await put("chat_messages", [msg({ cid: "c1", content: "yo" })]);
  await put("_outbox", [{ qid: 1, op: "send", entity_type: "message", cid: "c1", payload: {} }]);
  const tr = fakeTransport((m, p, b) => {
    assert.equal(p, "/api/lists/7/messages");
    assert.equal(b.client_id, "c1");
    assert.equal(b.content, "yo");
    return { status: 200, data: { id: 500, created_at: "2026-06-11T09:00:00" } };
  });
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(await serverIdOf("c1"), 500);
  const rec = await getMsg("c1");
  assert.equal(rec.server_id, 500);
  assert.equal(rec.pending, 0);
  assert.equal(rec.created_at, "2026-06-11T09:00:00");
  assert.equal((await outboxAll()).length, 0);
});

test("opChatSend holds when reply target (a cid) has no server id yet", async () => {
  await put("chat_messages", [msg({ cid: "c2", content: "reply", reply_to_id: "c-target" })]);
  await put("_outbox", [{ qid: 1, op: "send", entity_type: "message", cid: "c2", payload: {} }]);
  const tr = fakeTransport(() => { throw new Error("should not POST while held"); });
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 0);
  assert.equal((await outboxAll()).length, 1); // op retained for retry
});

test("opChatSend resolves a cid reply target via idmap to a server id", async () => {
  await mapPut("message", 300, "c-target");
  await put("chat_messages", [msg({ cid: "c3", content: "reply", reply_to_id: "c-target" })]);
  await put("_outbox", [{ qid: 1, op: "send", entity_type: "message", cid: "c3", payload: {} }]);
  const tr = fakeTransport((m, p, b) => { assert.equal(b.reply_to_id, 300); return { status: 200, data: { id: 501, created_at: "x" } }; });
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
});

test("opChatSend on 403 drops the op and deletes the local optimistic record", async () => {
  await put("chat_messages", [msg({ cid: "c4" })]);
  await put("_outbox", [{ qid: 1, op: "send", entity_type: "message", cid: "c4", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 403, data: { detail: "Not a member" } }));
  const r = await pushOutbox(tr);
  assert.equal((await outboxAll()).length, 0);
  assert.equal(await getMsg("c4"), undefined);
});

test("opChatSend retains the op on network error", async () => {
  await put("chat_messages", [msg({ cid: "c5" })]);
  await put("_outbox", [{ qid: 1, op: "send", entity_type: "message", cid: "c5", payload: {} }]);
  const tr = fakeTransport(() => "NETWORK");
  await pushOutbox(tr);
  assert.equal((await outboxAll()).length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/chatsync_push.test.js`
Expected: FAIL — `opChatSend` not dispatched (no chat handling).

- [ ] **Step 3a: Add helpers + handler** — in `static/offline/syncpush.js`, after `opMindmapPin` (the last mindmap handler from the previous slice), add:

```js
  function getChatRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("chat_messages", "readonly").objectStore("chat_messages").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function putChatRaw(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("chat_messages", "readwrite");
      tx.objectStore("chat_messages").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function deleteChatRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("chat_messages", "readwrite");
      tx.objectStore("chat_messages").delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function chatSendPayload(rec, replyServerId) {
    return {
      content: rec.content != null ? rec.content : "",
      task_id: rec.task_id != null ? rec.task_id : null,
      note_id: rec.note_id != null ? rec.note_id : null,
      msg_type: rec.msg_type || "text",
      reply_to_id: replyServerId != null ? replyServerId : null,
      client_id: rec.cid,
    };
  }
  // reply_to_id is a server int for confirmed targets, or a cid for a still-local target.
  function resolveReplyServerId(rec) {
    const rt = rec.reply_to_id;
    if (rt == null) return Promise.resolve({ serverId: null, hold: false });
    if (typeof rt === "number" || /^\d+$/.test(String(rt))) return Promise.resolve({ serverId: Number(rt), hold: false });
    return TFidmap.serverIdOf(rt).then((sid) => (sid != null ? { serverId: sid, hold: false } : { hold: true }));
  }

  function opChatSend(op, transport, result) {
    return getChatRaw(op.cid).then((rec) => {
      if (!rec) return TFoutbox.outboxRemove(op.qid);
      if (rec.server_id != null) return TFoutbox.outboxRemove(op.qid);
      return resolveReplyServerId(rec).then((rep) => {
        if (rep.hold) return; // reply target not on the server yet; retry next drain (FIFO)
        return send(transport, "POST", "/api/lists/" + rec.list_id + "/messages", chatSendPayload(rec, rep.serverId)).then((res) => {
          if (ok(res)) {
            const sid = res.data.id;
            return TFidmap.mapPut("message", sid, op.cid)
              .then(() => putChatRaw(Object.assign({}, rec, { server_id: sid, created_at: res.data.created_at != null ? res.data.created_at : rec.created_at, pending: 0 })))
              .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; });
          }
          if (res.status === 403) {
            return deleteChatRaw(op.cid).then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.failed++; });
          }
          result.failed++;
          return TFoutbox.outboxRemove(op.qid);
        });
      });
    });
  }
```

- [ ] **Step 3b: Dispatch in `processOp`** — after the mindmap dispatch lines, add:

```js
    if (op.entity_type === "message" && op.op === "send") return opChatSend(op, transport, result);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/chatsync_push.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Run full suite**

Run: `node --test tests/offline/*.test.js`
Expected: `pass 308` (303 + 5), `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add static/offline/syncpush.js tests/offline/chatsync_push.test.js
git commit -m "feat(offline): push chat send op with client_id + reply-hold (#2h-1)"
```

---

### Task 5: Backend — `client_id` column on `messages`

**Files:**
- Modify: `webapp.py`

- [ ] **Step 1: Add the migration** — in `webapp.py`, immediately after the `messages.note_id` migration block (ends ~line 231), add a parallel block:

```python
    # Migrate messages.client_id column (offline chat dedup)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(messages)").fetchall()]
        if "client_id" not in cols:
            conn.execute("ALTER TABLE messages ADD COLUMN client_id TEXT")
            conn.commit()
    finally:
        conn.close()
```

- [ ] **Step 2: Add the field to `MessageCreate`** — in the model (~line 518-523), add a line:

```python
class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)
    task_id: Optional[int] = None
    note_id: Optional[int] = None
    msg_type: str = "text"
    reply_to_id: Optional[int] = None
    client_id: Optional[str] = Field(default=None, max_length=64)
```

- [ ] **Step 3: Persist + return client_id in POST** — in `post_message` (~line 1967), change the INSERT to include `client_id`:

```python
        cur = conn.execute(
            "INSERT INTO messages (list_id, user_id, content, task_id, note_id, msg_type, reply_to_id, client_id, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (list_id, uid, req.content, req.task_id, req.note_id, req.msg_type, req.reply_to_id, req.client_id, now),
        )
```

- [ ] **Step 4: Add `m.client_id` to both SELECTs** — the POST broadcast SELECT (~line 1975) and the GET history SELECT (~line 1879) both begin `SELECT m.id, m.list_id, m.user_id, m.content, m.task_id, m.note_id, m.msg_type,`. In BOTH, add `m.client_id,` right after `m.msg_type,`:

```python
            SELECT m.id, m.list_id, m.user_id, m.content, m.task_id, m.note_id, m.msg_type,
                   m.client_id,
                   m.created_at, m.reply_to_id,
```

(Apply the identical edit to the GET SELECT at ~1879 and the POST broadcast SELECT at ~1975. The GET SELECT is shared by both the `before_id` and default branches, so one edit covers both.)

- [ ] **Step 5: Verify Python compiles**

Run: `python -m py_compile webapp.py`
Expected: no output (success). (Do NOT `import webapp` — it runs migrations against the real DB on import.)

- [ ] **Step 6: Commit**

```bash
git add webapp.py
git commit -m "feat(chat): add client_id column to messages for offline dedup (#2h-1)"
```

NOTE: after deploy, `taskflow-web` must be restarted on the VPS so the new column + model take effect (static deploy does not reload Python).

---

### Task 6: Wire offline chat into `index.html` + bump SW

**Files:**
- Modify: `static/index.html`
- Modify: `static/sw.js`

- [ ] **Step 1: Add module `<script>` tags** — in `static/index.html`, after the `mindmaproutes.js` script tag (from the mindmaps slice) and before `listsync.js`, insert:

```html
  <script src="/static/offline/chatrepo.js"></script>
  <script src="/static/offline/chatroutes.js"></script>
```

(Order: chatrepo before chatroutes, both before taskroutes.js — taskroutes' `buildTaskRouter` calls `registerChatRoutes`.)

- [ ] **Step 2: Configure the read-through fetcher** — find where `drawingrepo.configureFetcher` is called (it uses `__syncRawFetch`). Immediately after that call, add:

```js
  if (window.TF && window.TF.chatrepo) {
    window.TF.chatrepo.configureFetcher((url) =>
      __syncRawFetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error("http " + r.status)))));
  }
```

- [ ] **Step 3: Set the current user for the chat layer** — find the App's auth load (`api.get("/api/auth/me").then(u => { setUser(u); ...`, ~line 12436). Inside that `.then`, after `setUser(u)`, add:

```js
        if (window.TF && window.TF.chatrepo) window.TF.chatrepo.setCurrentUser({ user_id: u.id, username: u.username, display_name: u.display_name });
```

And in the offline-token fallback branch (the `catch` that does `setUser({...})` from the decoded token payload, ~line 12444), after that `setUser({...})`, add the same call using the payload fields:

```js
            if (window.TF && window.TF.chatrepo) window.TF.chatrepo.setCurrentUser({ user_id: payload.sub, username: payload.username, display_name: payload.username });
```

(Use whatever id/username fields the token payload exposes — match the object already passed to `setUser` in that branch. If the payload lacks a numeric id, pass `user_id: payload.sub`.)

- [ ] **Step 4: Verify the offline suite is unaffected + wiring landed**

Run: `node --test tests/offline/*.test.js`
Expected: `pass 308`, `fail 0`.

Run: `node -e "const s=require('fs').readFileSync('static/index.html','utf8'); console.log('repo:', /offline\/chatrepo\.js/.test(s), 'routes:', /offline\/chatroutes\.js/.test(s), 'fetcher:', /chatrepo\.configureFetcher/.test(s), 'user:', /chatrepo\.setCurrentUser/.test(s));"`
Expected: `repo: true routes: true fetcher: true user: true`

Run (load order): `node -e "const s=require('fs').readFileSync('static/index.html','utf8'); const i=s.indexOf('offline/chatroutes.js'); const j=s.indexOf('offline/taskroutes.js'); console.log('order ok:', i>0 && j>0 && i<j);"`
Expected: `order ok: true`

- [ ] **Step 5: Bump SW + precache** — in `static/sw.js` line 1, set:

```js
const CACHE = "taskflow-v133-chat";
```

Add the two modules to the STATIC precache list, after the mindmap module entries:

```js
  "/static/offline/chatrepo.js",
  "/static/offline/chatroutes.js",
```

Verify: `node -e "const s=require('fs').readFileSync('static/sw.js','utf8'); console.log('v133:', /taskflow-v133-chat/.test(s), 'precache:', /offline\/chatrepo\.js/.test(s) && /offline\/chatroutes\.js/.test(s));"`
Expected: `v133: true precache: true`

- [ ] **Step 6: Commit**

```bash
git add static/index.html static/sw.js
git commit -m "feat(offline): load chat modules + fetcher + current user + SW v133 (#2h-1)"
```

---

### Task 7: ChatRoom UI — persist SSE to cache, dedup by client_id, optimistic send

**Files:**
- Modify: `static/index.html` (ChatRoom ~12115-12373, ChatInputBar handleSend ~12562)

- [ ] **Step 1: SSE handler persists to cache + dedups by client_id** — find the SSE `es.onmessage` handler (~line 12156-12163):

```js
    es.onmessage = e => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "ping") return;
        setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
        setTimeout(scrollToBottom, 30);
      } catch (_) {}
    };
```

Replace with:

```js
    es.onmessage = e => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "ping") return;
        if (window.TF && window.TF.chatrepo) window.TF.chatrepo.upsertIncoming(msg);
        setMessages(prev => {
          if (msg.client_id) {
            const idx = prev.findIndex(m => m.client_id === msg.client_id);
            if (idx >= 0) { const next = prev.slice(); next[idx] = msg; return next; }
          }
          return prev.some(m => m.id === msg.id) ? prev : [...prev, msg];
        });
        setTimeout(scrollToBottom, 30);
      } catch (_) {}
    };
```

- [ ] **Step 2: `onSent` dedups by client_id too** — find the `onSent` callback passed to `ChatInputBar` (~line 12365):

```js
    onSent: msg => {
      setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
      setTimeout(scrollToBottom, 30);
    },
```

Replace with:

```js
    onSent: msg => {
      setMessages(prev => {
        if (msg.client_id) {
          const idx = prev.findIndex(m => m.client_id === msg.client_id);
          if (idx >= 0) { const next = prev.slice(); next[idx] = msg; return next; }
        }
        return prev.some(m => m.id === msg.id) ? prev : [...prev, msg];
      });
      setTimeout(scrollToBottom, 30);
    },
```

- [ ] **Step 3: `handleSend` includes a `client_id`** — find `handleSend` in `ChatInputBar` (~line 12562). The `payload` object (~12566) currently is:

```js
      const payload = {
        content: text.trim() || (attachedTask ? `📌 ${attachedTask.title}` : attachedNote ? `📝 ${attachedNote.title || "(tanpa judul)"}` : ""),
        task_id: attachedTask?.id || null,
        note_id: attachedNote?.id || null,
        msg_type: attachedTask ? "task_attach" : attachedNote ? "note_attach" : "text",
        reply_to_id: replyTo?.id || null
      };
```

Add a `client_id` field generated from the offline ids helper (falling back to a timestamp-random if unavailable):

```js
      const clientId = (window.TF && window.TF.ids && window.TF.ids.newCid)
        ? window.TF.ids.newCid()
        : `tmp_msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const payload = {
        content: text.trim() || (attachedTask ? `📌 ${attachedTask.title}` : attachedNote ? `📝 ${attachedNote.title || "(tanpa judul)"}` : ""),
        task_id: attachedTask?.id || null,
        note_id: attachedNote?.id || null,
        msg_type: attachedTask ? "task_attach" : attachedNote ? "note_attach" : "text",
        reply_to_id: replyTo?.id || null,
        client_id: clientId
      };
```

(The intercepted `POST` ignores the incoming `client_id` and uses the `cid` it mints — but passing it keeps the request shape correct for the rare non-intercepted path and documents intent. The optimistic record returned by the intercept carries its own `cid` as `client_id`, which the SSE echo matches.)

- [ ] **Step 4: Optimistic "sending…" indicator** — find the `chat-time` element in the message bubble (~line 12354):

```js
    }, /*#__PURE__*/React.createElement("div", {
      className: "chat-time",
      style: {
        textAlign: isSelf ? "right" : "left"
      }
    }, formatTime(msg.created_at)))));
```

Replace the time content with a pending-aware version:

```js
    }, /*#__PURE__*/React.createElement("div", {
      className: "chat-time",
      style: {
        textAlign: isSelf ? "right" : "left"
      }
    }, msg.pending ? "🕐 mengirim…" : formatTime(msg.created_at)))));
```

- [ ] **Step 5: Verify inline scripts still parse + suite green**

Run: `node --test tests/offline/*.test.js`
Expected: `pass 308`, `fail 0` (UI-only change; suite unaffected).

Run: `node -e "const s=require('fs').readFileSync('static/index.html','utf8'); console.log('upsert:', /chatrepo\.upsertIncoming/.test(s), 'clientid-send:', /client_id: clientId/.test(s), 'pending-ind:', /mengirim/.test(s));"`
Expected: `upsert: true clientid-send: true pending-ind: true`

- [ ] **Step 6: Commit**

```bash
git add static/index.html
git commit -m "feat(offline): ChatRoom persists SSE to cache, dedups by client_id, optimistic send (#2h-1)"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** §1 store/record → Task 1 + 2; §2 backend client_id → Task 5; §3 chatrepo (cache/getMessages/sendMessage/upsertIncoming/configureFetcher/setCurrentUser) → Task 2; §4 chatroutes (read-through GET, optimistic POST, stream-not-intercepted) → Task 3; §5 opChatSend (client_id, reply-hold, 403-drop, network-retain) → Task 4; §6 wiring (scripts, fetcher, setCurrentUser, ChatRoom SSE+dedup+client_id+pending, SW v133) → Tasks 6 + 7; §7 tests → each task; §8 verification → final review + browser steps.
- **No `syncpull` change** (lazy read-through + outbox push for sends) — matches spec; no task needed.
- **Type/shape consistency:** `shape()` produces `id = server_id ?? cid` and `client_id = cid`; the ChatRoom dedup (Task 7) keys on `client_id` then `id`, consistent with `shape`. `entity_type === "message"` and idmap `type "message"` uniform across Tasks 2, 3, 4. `task_status` ← `gtd_status` mapping consistent in `sendMessage` (Task 2) and matches the server field.
- **Reply-hold (Task 4)** correctly handles offline-reply-to-offline-message via FIFO + idmap; `resolveReplyServerId` treats a numeric `reply_to_id` as a server id and a non-numeric one as a cid.
- **Final expected suite count:** 308 (291 baseline + 17 new across Tasks 1-4). Trust `fail 0` over the exact total if a test is split during TDD.
- **Backend has no Node tests** (Python change); verified via `py_compile` + the browser verification step (POST returns 200 with the new column live after restart).
