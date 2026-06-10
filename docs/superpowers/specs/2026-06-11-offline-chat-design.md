# Design Spec: Offline Chat (#2h-1)

**Date:** 2026-06-11
**Status:** Approved
**Slice:** #2h-1 of the Native Offline initiative (Model B). First sub-slice of the collaborative tranche (#2h). Shared notes (#2h-2) and shared mindmaps (#2h-3) are SEPARATE later sub-slices — they involve collaborative multi-user edit conflict, which is out of scope here.

---

## Overview

Make per-list chat usable offline: cache message history locally for reading, and queue outgoing messages (compose offline → outbox → auto-send on reconnect, with optimistic display). The SSE real-time stream stays online-only.

**Why chat is simpler than the personal-data slices:** chat messages are **append-only and immutable** — the server exposes only `GET` (history), `POST` (send), and the SSE `stream`. There is no edit or delete endpoint. So there is **no LWW, no conflict resolution, no pin, no tombstone, no update/delete op**. The only write is "send" (a create). The single genuinely-hard problem is **deduplication** of an optimistic locally-composed message against the same message echoed back via the POST response and the SSE broadcast — solved with a server-stored `client_id`.

### In scope
- Lazy per-list read-through cache of message history (read offline; online fetch refreshes cache).
- Offline send queue: optimistic local message + outbox `send` op + auto-send on reconnect.
- Exact dedup via a new `client_id` column on the server `messages` table.

### Out of scope (deferred)
- Shared notes offline (#2h-2) and shared mindmaps offline (#2h-3) — collaborative edit conflict, separate specs.
- Editing/deleting messages — the feature does not exist server-side.
- A global background pull of all lists' messages — caching is lazy (read-through on chat open) by decision; queued sends still flush via the normal outbox push.
- Offline @mention notifications — notifications are a server-side side effect of POST; they fire when the queued message actually reaches the server on reconnect (no offline handling needed).

---

## 1. Data Model

New local store `chat_messages` → IndexedDB schema bump **v3 → v4**. This is the first bump since v3; `createSchema` in `db.js` creates any missing store on `onupgradeneeded`, so the change is: add `chat_messages` to `ENTITY_STORES` with its indexes, and set `DB_VERSION = 4`. Existing stores and data are untouched (additive migration, no data movement).

Local record (keyed by `cid`, a `crypto.randomUUID`):

```js
{
  cid,            // client UUID; also sent to server as client_id
  server_id,      // server message id (integer), null until pushed
  list_id,        // server list id (integer) — chat only exists on shared lists, which always have a server id
  user_id,        // sender's server user id
  content,        // string
  task_id,        // server task id or null (attachment)
  note_id,        // server note id or null (attachment)
  msg_type,       // "text" | "task_attach" | "note_attach"
  reply_to_id,    // server id of replied-to message, or null
  created_at,     // local ISO at compose time; replaced by server's on push
  pending,        // 1 = composed offline, not yet confirmed on server (optimistic); 0 = confirmed
  // denormalized display fields (so cached messages render fully offline):
  username, display_name,
  task_title, task_priority, task_deadline, task_quadrant, task_status,
  note_title,
  reply_to_username, reply_to_display_name, reply_to_content
}
```

Indexes on the store: `list_id`, `created_at`, `server_id`, and `client_id` (= the record's own `cid`; indexed to support dedup-by-client_id lookups).

idmap uses `type === "message"` to map server message id ↔ cid.

**Note on `list_id`:** chat happens only on shared lists, which are pulled from the server (via `listsync.js`, #2d-1) and always carry a server id. The frontend calls `/api/lists/${list.id}/messages` with the server list id, so the chat layer keys on the integer server `list_id` directly — no cid resolution for the list is needed.

---

## 2. Backend changes (`webapp.py`) — small, requires `taskflow-web` restart

1. **Migration:** add a nullable `client_id TEXT` column to the `messages` table (idempotent `ALTER TABLE ... ADD COLUMN` guarded by a `PRAGMA table_info` check, matching the existing `mindmaps.list_id` migration pattern).
2. **`MessageCreate` model:** add `client_id: Optional[str] = None`.
3. **`POST /api/lists/{list_id}/messages`:** persist `client_id` in the INSERT; include `client_id` in the returned/broadcast `msg_dict` (so both the POST response and the SSE broadcast carry it).
4. **`GET /api/lists/{list_id}/messages`:** add `m.client_id` to the SELECT (both the `before_id` and the default branch) so pulled history carries `client_id` for dedup.

After deploy, the Python service must be restarted manually on the VPS (`sudo systemctl restart taskflow-web`) — the static deploy alone does not reload Python.

---

## 3. Module: `static/offline/chatrepo.js`

Local message store operations.

- `configureFetcher(fn)` — store a raw fetch function (token-aware, bypasses the intercept) for read-through, mirroring `drawingrepo.configureFetcher`.
- `cacheMessages(serverMsgs)` → upsert an array of server message dicts into the local store. Dedup per message: (a) if a local record already has this `server_id`, update it in place; (b) else if the message's `client_id` matches an existing local `cid` (our own optimistic message now confirmed), update that record (set `server_id`, server `created_at`, `pending:0`); (c) else mint a fresh `cid`, store the record (`pending:0`), and `idmap.mapPut("message", server_id, cid)`. Returns nothing (side-effect cache write).
- `getMessages(listId, { limit, before_id })` → read local records for `list_id === listId`, sort ascending by `created_at` (ties broken by `server_id` then `cid`), apply `before_id` pagination (records strictly older than the referenced message), take the last `limit`, and return them shaped exactly like the server response (the stored denormalized fields ARE the server shape). Returned newest-last (the server returns ascending after its `reversed()`).
- `sendMessage(listId, payload, currentUser, opts)` → build an optimistic local record: mint `cid`, `server_id:null`, `pending:1`, `created_at = opts.now || nowISO`, copy `content`/`task_id`/`note_id`/`msg_type`/`reply_to_id` from `payload`, set `user_id`/`username`/`display_name` from `currentUser`, and **enrich locally** — if `task_id`, look up `task_title`/priority/etc. from the local `tasks` store; if `note_id`, `note_title` from `scratchpad_notes`; if `reply_to_id`, copy `reply_to_username`/`display_name`/`content` from the cached replied message. Write the record, enqueue outbox `{ entity_type:"message", op:"send", cid, payload:{ cid } }`. Return the optimistic record (server-shaped) so the UI shows it immediately.
- `upsertIncoming(msg)` → cache a single message arriving via SSE (delegates to the same dedup logic as `cacheMessages` for one record). Used by the ChatPage SSE handler so live messages are persisted for offline reading.

`currentUser` shape: `{ user_id, username, display_name }`, passed in by the ChatPage (which already knows the logged-in user) — `chatrepo` does not fetch identity itself.

---

## 4. Module: `static/offline/chatroutes.js`

`registerChatRoutes(router)` registers chat routes onto the shared `buildTaskRouter` LocalRouter, called from `taskroutes.js` after the other `register*` calls.

- `GET /api/lists/:id/messages` → **read-through** (the drawings #2f-3 pattern, NOT pure local-first):
  - If `navigator.onLine`: use the configured raw fetcher to GET the server URL (preserving `limit`/`before_id` query), `chatrepo.cacheMessages(result)`, and return the server result.
  - If offline (or the fetch fails): return `chatrepo.getMessages(listId, { limit, before_id })` from the local cache.
- `POST /api/lists/:id/messages` → `chatrepo.sendMessage(listId, body, chatrepo.getCurrentUser())` and return the optimistic record. (When online, the outbox drains almost immediately via `schedulePush`, performing the real POST; see §5.)
- The SSE stream `GET /api/lists/:id/messages/stream` is **NOT** registered — it stays on the network (online-only).

`chatrepo` owns the current-user identity: `setCurrentUser({user_id, username, display_name})` / `getCurrentUser()`. The app calls `setCurrentUser` once the logged-in user is known (see §6 wiring); `chatroutes` reads it via `getCurrentUser()` when handling a POST. If no user is set yet (shouldn't happen on the chat page), `sendMessage` still records the message and leaves the sender display fields empty rather than failing.

---

## 5. Sync push — extend `static/offline/syncpush.js`

Add one op handler (chat has only the `send` write):

- `chatSendPayload(record)` → `{ content, task_id, note_id, msg_type, reply_to_id, client_id }` where `client_id = record.cid`. `reply_to_id` is resolved to a server id (see hold rule below).
- `opChatSend(op, transport, result)`:
  1. Read the local record by `op.cid`. If missing or `server_id != null` (already sent), drop the op.
  2. **Reply-target hold:** if `record.reply_to_id` refers to a message that is still local-only (a pending message whose `server_id` is null), HOLD — return without removing the op (retry on the next drain, after the earlier message's `send` op — which is earlier in FIFO order — has assigned it a server id). Resolve `reply_to_id` via idmap if it is a cid. (In practice replies target already-sent messages, so this hold is rare.)
  3. `POST /api/lists/{record.list_id}/messages` with `chatSendPayload(record)`. On success: set `server_id = res.data.id`, `created_at = res.data.created_at`, `pending:0`, `idmap.mapPut("message", server_id, cid)`, remove the op, `result.pushed++`.
  4. `403` (lost list access): drop the op AND hard-delete the local optimistic record (it will never send). Other non-2xx: `result.failed++`, drop op. Network error: propagate (stop-on-network, op retained).
- `processOp` dispatch: `if (op.entity_type === "message" && op.op === "send") return opChatSend(op, transport, result);`.

No pull changes: queued sends flush through the existing `pushOutbox` drain that `sync()` already calls.

---

## 6. Wiring — `static/index.html`

- Load `chatrepo.js` then `chatroutes.js` as `<script>` modules before `taskroutes.js` (taskroutes' `buildTaskRouter` calls `registerChatRoutes`; capture-at-load order matters in the browser).
- Configure the read-through fetcher: `chatrepo.configureFetcher(url => __syncRawFetch(url).then(r => r.ok ? r.json() : Promise.reject()))` near where `drawingrepo.configureFetcher` is set.
- Provide the current user to the chat layer: wherever the app holds the logged-in user, call `chatrepo.setCurrentUser({ user_id, username, display_name })` (and refresh on login).
- **ChatPage changes:**
  - History load (`api.get(/api/lists/:id/messages?limit=50)`) — unchanged call site; it is now intercepted (read-through). On first online open it returns server data and caches; offline it returns the cache.
  - SSE `onmessage` — in addition to updating React state, call `chatrepo.upsertIncoming(msg)` to persist the live message. Change the state dedup from "by `id`" to **by `client_id` OR `id`**: if an incoming message's `client_id` matches an existing optimistic message in state, REPLACE it in place (adopt `id`, server `created_at`, clear `pending`) instead of appending a duplicate.
  - `handleSend` — include `client_id` (a freshly generated cid) in the POST payload so the optimistic record, the POST response, and the SSE echo all share it. `api.post` now returns the optimistic record immediately (intercepted); `onSent` shows it. The real send happens via the outbox push.
  - Optimistic messages (`pending`) render with a small "sending…"/clock indicator until confirmed.
- SW (`static/sw.js`): bump cache version → **v133** and precache `/static/offline/chatrepo.js` and `/static/offline/chatroutes.js`.

---

## 7. Testing

Node tests (`node --test tests/offline/*.test.js`), one file per concern:

- `chatrepo.test.js` — `cacheMessages` dedup (by server_id; by client_id confirming an optimistic record; new message mints cid + idmap); `getMessages` ordering + `before_id` pagination + `limit`; `sendMessage` writes optimistic `pending:1` record + outbox op + local enrichment (task/note/reply fields); `upsertIncoming` single-message dedup.
- `chatroutes.test.js` — `POST` returns optimistic record + enqueues op; `GET` offline returns local cache (paginated); `GET` online calls the fetcher + caches + returns server data; SSE stream route is NOT registered.
- `chatsync_push.test.js` — `opChatSend` POSTs with `client_id`, sets server_id + idmap + created_at + clears pending; reply-target hold (pending reply target → op retained, no POST); 403 → op dropped + local record removed; network → op retained.

Backend: no new Python tests (the change is a nullable column + pass-through). Baseline before: **291 pass**. Target after: ~315 (exact count emerges during TDD).

---

## 8. Verification

- Self-verify Node suite green; grep confirms module load order; `curl https://todo.yatno.web.id/sw.js | grep CACHE` shows v133 after deploy; confirm `taskflow-web` restarted (the `client_id` column must be live — e.g. POST a message and confirm no 500).
- Browser-verify (user, reset SW first): open a list chat online → history loads + caches; go offline → reopen → history readable from cache; compose offline → message shows "sending…" optimistically; reconnect → it sends, the indicator clears, and it does NOT duplicate when the SSE echo arrives; a second device sees the message once; send while online still works and dedups normally. Confirm no console errors.
