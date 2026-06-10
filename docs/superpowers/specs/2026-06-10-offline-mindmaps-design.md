# Design Spec: Offline Mindmaps (#2g)

**Date:** 2026-06-10
**Status:** Approved
**Slice:** #2g of the Native Offline initiative (Model B). Follows #2f (notes + drawings). Single combined slice: local layer + sync together.

---

## Overview

Make personal mindmaps local-first: IndexedDB is the source of truth, the VPS server is a sync endpoint. Mirrors the notes slices (#2f-1/#2f-2) almost exactly, but simpler — mindmaps have **no tags, no wikilinks, no BlobStore**. The `data_json` (a mind-elixir node tree, stored as a JSON string) is treated as an **opaque blob** and stored inline in the local record.

Because mindmaps are simpler than notes, local layer and sync are delivered in **one slice** (no temporary Opsi-B hold guard needed — push handlers exist from the start).

### In scope
- Personal mindmaps (`list_id == null`): create / read / update (title + data_json) / delete / pin, all local-first with `_outbox`.
- Two-way sync: push outbox → server, pull server → local with LWW conflict handling.

### Out of scope (deferred)
- Shared mindmaps (`list_id != null`): collaborative, online-only. Deferred to the collaborative slice (#2h). Routes `PATCH /api/mindmaps/:id/share` and `GET /api/lists/:id/mindmaps` stay on the network (not intercepted).
- Node-link id remapping: `data_json` nodes may embed `links:[{type:'task'|'note', id, title}]` where `id` is a server id. We treat `data_json` as opaque and do **not** remap these ids cid↔server_id. Safe in practice because the link picker uses `/api/search` (online-only), so new links are almost always created online with real server ids. The edge case (link to a local-only task) is accepted.

---

## 1. Data Model

Local store `mindmaps` **already exists** in `db.js` v3 (scaffolded ahead), keyed by `cid`, with indexes `server_id`, `updated_at`, `dirty`. **No DB version bump.**

Local record shape:

```js
{
  cid,            // canonical local UUID (crypto.randomUUID)
  server_id,      // server's numeric id, null until pushed
  title,          // string
  data_json,      // string (mind-elixir tree); OPAQUE — never parsed/remapped
  pinned,         // 0 | 1
  list_id: null,  // personal-only; shared deferred
  created_at,     // ISO string
  updated_at,     // ISO string — drives LWW
  deleted,        // 0 | 1 (tombstone until pushed)
  dirty,          // 0 | 1 (has un-pushed content/title changes)
  base_rev        // server updated_at last reconciled (pull change-detection)
}
```

Server record (unchanged): `{id, user_id, title, data_json, is_pinned, list_id, created_at, updated_at}`.

**Asymmetry to handle:** `GET /api/mindmaps` returns list metadata **without** `data_json` (only `id, title, is_pinned, list_id, created_at, updated_at`). `data_json` is returned **only** by `GET /api/mindmaps/:id`. Pull must lazily fetch `data_json` per mindmap when new or changed.

---

## 2. Module: `static/offline/mindmaprepo.js`

CRUD against the local store, recording `_outbox` ops. Pattern follows `noterepo.js`.

- `createMindmap({title, data_json})` → mint `cid`, write record (`dirty:1`, `deleted:0`, `server_id:null`, `pinned:0`, `list_id:null`, timestamps now), enqueue outbox `{entity_type:'mindmap', op:'create', cid}`. Return display record.
- `getMindmap(cid)` → local record or null.
- `updateMindmap(cid, {title?, data_json?})` → patch provided fields, bump `updated_at`, set `dirty:1`, enqueue (dedupe) outbox `{op:'update', cid}`. `data_json` stored as-is (opaque).
- `deleteMindmap(cid)` → tombstone (`deleted:1`, `dirty:1`), enqueue `{op:'delete', cid}`.
- `togglePin(cid)` → flip `pinned`, enqueue `{op:'pin', payload:{pinned}}`. **Does NOT set `dirty`** (pin is orthogonal to content LWW — same tweak as notes #2f-2; otherwise a pin-only mindmap stays "dirty forever" and breaks reconcile).

Outbox `entity_type` for all mindmap ops: `'mindmap'` (pin payload carries the desired `pinned`).

---

## 3. Module: `static/offline/mindmaproutes.js`

`registerMindmapRoutes(router)` registers personal mindmap routes onto the shared `buildTaskRouter` LocalRouter. Resolves display id → cid via `resolveCid` (try cid, then `server_id` via idmap). Routes intercepted:

| Method & path | Behavior |
| --- | --- |
| `GET /api/mindmaps` | List personal (`list_id==null`, non-deleted), shaped like server **metadata** (`id`=server_id??cid, title, is_pinned, list_id, created_at, updated_at), sorted `is_pinned DESC, updated_at DESC`. No `data_json`. |
| `POST /api/mindmaps` | `createMindmap`; return full record (id, title, data_json, is_pinned, list_id, timestamps). |
| `GET /api/mindmaps/:id` | Full record from local store **including `data_json`**. |
| `PUT /api/mindmaps/:id` | `updateMindmap` (title and/or data_json); return full. |
| `PATCH /api/mindmaps/:id/pin` | `togglePin`; return full (with new `is_pinned`). |
| `DELETE /api/mindmaps/:id` | `deleteMindmap`; return `{ok:true}`. |

**Not intercepted (network passthrough):** `PATCH /api/mindmaps/:id/share`, `GET /api/lists/:id/mindmaps` (collaborative, online-only).

Display shape uses `id = server_id ?? cid` and `is_pinned` (server's field name), matching what `MindmapPage` expects.

---

## 4. Sync Push — extend `static/offline/syncpush.js`

Add mappers and op handlers, following the note handlers:

- `mindmapToCreatePayload(rec)` → `{title, data_json}`.
- `mindmapToUpdatePayload(rec)` → `{title, data_json}` (PUT accepts partial; send both).
- `opMindmapCreate` → `POST /api/mindmaps` → `server_id`, `idmap.mapPut`, set `dirty:0`, `base_rev = resp.updated_at`.
- `opMindmapUpdate` → `PUT /api/mindmaps/{server_id}`. **404 → local-wins re-create**: `POST` then `mapDelete(old)` + `mapPut(new)` (crash-safe order: create first). On success set `dirty:0`, `base_rev = resp.updated_at`.
- `opMindmapDelete` → `DELETE /api/mindmaps/{server_id}` → `mapDelete` + hard-delete local record. (404 also treated as done.)
- `opMindmapPin` → **conditional-PATCH**: `GET /api/mindmaps/{server_id}` for current `is_pinned`; `PATCH /api/mindmaps/{server_id}/pin` only if `server.is_pinned !== local.pinned`. (Server pin is a toggle and does NOT bump `updated_at`, so we must read before toggling.)

`processOp` dispatch extended to route `entity_type==='mindmap'`. Content conflict policy: **last-write-wins by `updated_at`** (task/note pattern). Stop-on-network (op retained for retry), drop-on-4xx (except the re-create path above).

---

## 5. Sync Pull — extend `static/offline/syncpull.js`

- `mindmapFromServer(row)` → local record shape (used after fetching `/:id`).
- `pullMindmaps(serverList, fetchOne)` where `serverList` = `GET /api/mindmaps` (metadata) and `fetchOne(serverId)` = `GET /api/mindmaps/:id` (full). Reconcile (personal-only; ignore server rows with `list_id != null`):
  1. **New** (server id not in local idmap) → `fetchOne` → mint cid, insert via `mindmapFromServer`, `mapPut`.
  2. **Changed & local clean** (`server.updated_at !== local.base_rev`) → `fetchOne` → overwrite content + title, set `base_rev`. **Skip if local dirty** (local-wins / defer).
  3. **Pin** → adopt `server.is_pinned` **unless** a pending `pin` op for this cid sits in the outbox (respect the local intent).
  4. **Delete** → local record with `server_id` not present in `serverList` **and clean** → hard-delete local + `mapDelete`. Dirty local → keep (local-wins).
  5. Local-only records (no `server_id`) → ignored (await push).
- `pullMindmapsAndReconcile(rawFetch)` → fetches list then drives `pullMindmaps`, fetching each `/:id` only for new/changed rows (avoids N+1 every boot).

---

## 6. Wiring — `static/index.html`

- Load `mindmaprepo.js` + `mindmaproutes.js` as `<script>` modules **before** `taskroutes.js` (taskroutes' `buildTaskRouter` calls `registerMindmapRoutes`, captured at load — load-order matters in the browser).
- `sync()` sequence: append `pullMindmapsAndReconcile` to the existing pull chain (tasks → lists → habits → notes → **mindmaps** → push).
- **Retire legacy localStorage offline** in `MindmapPage` (replaced by local-first intercept, mirroring the `draw_pending` retirement in #2f-3):
  - Remove `tf_mindmap_pending_${id}` writes/reads (the `change` autosave handler, the `load`/`ready` handlers, the flush-on-`online` effect).
  - Remove the `if (!navigator.onLine) { setSyncStatus('offline'); return; }` early-return in the `change` handler so the `api.put` **always** runs through the intercept (local-first put never fails offline).
  - Remove the `tf_mindmap_list` localStorage cache (list now served from IndexedDB via intercept).
  - `load` reads `selected.data_json` directly (the local-first `GET /:id` already returns the freshest local copy).
  - `setSyncStatus` UI may stay; offline writes simply settle to `"saved"` locally.
- SW (`static/sw.js`): bump cache version (→ v132) and add the two new module paths to the precache list.

---

## 7. Backend

**Zero changes.** All endpoints (`GET/POST/PUT /api/mindmaps[/:id]`, `PATCH /:id/pin`, `DELETE /:id`) predate this slice.

---

## 8. Testing

Node tests (`node --test tests/offline/*.test.js`), one test file per new/extended concern:

- `mindmaprepo.test.js` — create/get/update/delete/pin, outbox recording, pin-not-dirty invariant, opaque data_json round-trip.
- `mindmaproutes.test.js` — each intercepted route returns the server-shaped payload; list omits data_json; `/:id` includes it; share/list-mindmaps not intercepted.
- `syncpush` mindmap ops — create→server_id+mapPut, update 404→re-create, delete→mapDelete, pin conditional-PATCH (skip when equal).
- `syncpull` mindmaps — new fetch+insert, changed clean overwrite, dirty skip, delete clean-vanished, pin-adopt respects pending op, N+1 avoidance (fetchOne only for new/changed).

Baseline before: **268 pass**. Target after: ~293 (exact count emerges during TDD).

---

## 9. Verification

- Self-verify Node suite green; grep confirms `tf_mindmap_pending`/`tf_mindmap_list` removed (0 refs); inline scripts parse; load-order correct; `curl https://todo.yatno.web.id/sw.js | grep CACHE` shows v132 live after deploy.
- Browser-verify (user, reset SW first): create mindmap offline → edits autosave with no error → reload loads from IndexedDB; `__syncNow()` online → POST/PUT reaches server (check other web client); create/edit mindmap on another client → pull shows it locally; pin offline → syncs; delete offline → syncs. Confirm no `tf_mindmap_pending_*` and no console errors.
