# Design Spec: Collaborative Shared Mindmaps (#2h-3)

**Date:** 2026-06-12
**Status:** Approved
**Slice:** #2h-3 of the Native Offline initiative (Model B). Third sub-slice of the collaborative tranche (#2h), after #2h-1 (chat) and #2h-2 (shared notes).

---

## Overview

Make shared mindmaps **collaboratively editable** and offline-capable. Unlike notes, mindmaps are currently **owner-only** on the backend: `GET/PUT /api/mindmaps/{id}` check `WHERE id=? AND user_id=?`, so a list member who doesn't own a mindmap gets 404 on read and write. "Sharing" a mindmap today only tags it with a `list_id` so its title appears in the list — members cannot open or edit the content.

This slice has **two parts**:
1. **Backend:** broaden mindmap access from owner-only to owner-OR-list-member (mirroring notes' `_note_access_clause`), so members can open and edit shared mindmaps. Add `last_edited_by` tracking. Make non-owner DELETE return 403 (so the offline layer can react). Pin stays owner-only.
2. **Offline:** extend the mindmap offline machinery (#2g) to shared mindmaps, reusing the exact pattern proven in #2h-2 (shared notes): lift the personal-only filter, carry collaborator metadata, intercept the list-scoped route, LWW + overwrite-notice, member-permission edges, and the now entity-aware `syncconflict`.

Conflict model = **last-write-wins + notice** (same as #2h-2): server wins on edit-vs-edit, the loser of a dirty offline edit gets a dismissable "ditimpa oleh X" notice; edit-vs-delete surfaces the discard banner.

### In scope
- Backend: member read/write of shared mindmaps; `last_edited_by` + last-editor display; non-owner DELETE → 403.
- Offline: shared mindmaps readable/editable offline, synced with LWW + notice; list-scoped view offline; member-permission edges.

### Out of scope
- A live "edited by X" banner on `MindmapPage` (notes have one via polling; mindmaps don't, and adding it is an online-UX feature beyond this slice). `last_edited_by` is carried only to name the offline overwrite-notice.
- Per-user pin for mindmaps (the `is_pinned` column is a single global flag, not per-user like notes' `note_pins`). Pin stays **owner-only**.
- `/share` offline (stays network, owner-only).
- #3 Tauri.

### No offline DB bump
The `mindmaps` IndexedDB store and its `list_id` field already exist (db v4). Backend adds a SQLite `last_edited_by` column (additive migration). **No offline schema bump.**

---

## 1. Backend changes (`webapp.py`) — requires `taskflow-web` restart

1. **`last_edited_by` column** on the `mindmaps` table — idempotent `PRAGMA table_info` + `ALTER TABLE mindmaps ADD COLUMN last_edited_by INTEGER` migration (mirroring the `messages.client_id` / `mindmaps.list_id` patterns).
2. **`_mindmap_access_clause(uid, prefix="")`** — analogous to `_note_access_clause`: `(user_id = ? OR list_id IN (SELECT id FROM shared_lists WHERE owner_id = ? UNION SELECT list_id FROM list_members WHERE user_id = ?))`. Returns `(clause, [uid, uid, uid])`.
3. **`GET /api/mindmaps/{id}`**: replace `WHERE id=? AND user_id=?` with `WHERE id=? AND {access_clause}`. Enrich the returned dict with `last_editor_username`/`last_editor_display_name` when `last_edited_by` is set and `!= uid` (mirror `_scratchpad_row`'s last-editor lookup).
4. **`PUT /api/mindmaps/{id}`**: access check via `{access_clause}` (members can edit). Set `last_edited_by = uid` in the UPDATE. Return the enriched dict. (PUT updates only `title`/`data_json` today — it does not accept `list_id`; sharing happens via `/share` only — so no owner-vs-member `list_id` branch is needed here.)
5. **`GET /api/mindmaps`** (list): replace `WHERE user_id=?` with `WHERE {access_clause}` so members see accessible shared mindmaps in their list, and the offline `pullMindmaps` (which calls this) picks them up. Keep the `ORDER BY is_pinned DESC, updated_at DESC`. Include `last_edited_by` (and, if cheap, the last-editor names) in the row shape.
6. **`DELETE /api/mindmaps/{id}`**: non-owner → **403** ("Hanya pemilik yang bisa menghapus") instead of the current 404; owner-only delete preserved (mirror notes' delete).
7. **`PATCH /api/mindmaps/{id}/pin`**: stays **owner-only** (`WHERE id=? AND user_id=?`, current behavior unchanged) — pin is a single global flag, not per-user.

After deploy, restart `taskflow-web` (static deploy doesn't reload Python).

---

## 2. Offline local record (extended)

Local `mindmaps` store record gains the same collaborator fields as notes:

```js
{
  cid, server_id, title, data_json,   // data_json opaque, lazy-fetched (from #2g)
  pinned, list_id,                     // list_id null = personal, else shared
  user_id,                             // owner server id
  last_edited_by,                      // server user id of last editor
  last_editor_username, last_editor_display_name,  // from server, only when last_edited_by != requester
  created_at, updated_at, deleted, dirty, base_rev,
  conflict?,                           // "remote_deleted" → edit-vs-delete discard banner
  notice?                              // { kind:"overwritten"|"delete_refused", title, editor? }
}
```

`user_id`, `last_edited_by`, `last_editor_username`, `last_editor_display_name`, `notice` are NEW; `conflict` already exists in the shared infra. (`last_editor_*` are carried mainly to name the overwrite notice — there is no MindmapPage "edited by" banner.)

---

## 3. `mindmaprepo.js`

- `createMindmap(input)`: accept `input.list_id` (default null) instead of hardcoding null; stamp `user_id = curUid()`, `last_edited_by = curUid()`, `last_editor_*: null`.
- `updateMindmap(cid, patch)`: stamp `last_edited_by = curUid()` and reset `last_editor_username/display_name` to null (I edited it now — clear stale attribution), as notes' `updateNote` does.
- Add `setCurrentUser({user_id, username, display_name})` / `getCurrentUser()` / `curUid()` (mirroring noterepo/chatrepo), set in wiring.

---

## 4. `mindmaproutes.js`

- `listMindmaps`: drop the `list_id == null` personal-only filter (include accessible shared, matching the broadened server `GET /api/mindmaps`). `meta`/`full` shape expose the real `list_id` plus `user_id`, `last_edited_by`, `last_editor_username`, `last_editor_display_name`.
- Register **`GET /api/lists/:id/mindmaps`** → local mindmaps where `list_id === :id`, non-deleted, sorted `updated_at` desc, shaped `{id: server_id ?? cid, title, updated_at}` (matching webapp.py `get_list_mindmaps`). Currently this route is network — now intercepted.
- `/share` stays NOT intercepted (network, owner-only).

---

## 5. `syncpush.js` — list_id + permission edges (mirror notes)

- `mindmapToCreatePayload` / `mindmapToUpdatePayload`: include the real `list_id` (currently omit it — #2g was personal-only).
- `opMindmapUpdate` 404: branch on `list_id` — shared (`list_id != null`) → set `conflict="remote_deleted"` (no re-create); personal → existing re-create (preserved). Add `if (rec.conflict) return outboxRemove` guard at the top.
- `opMindmapCreate` / `opMindmapUpdate` 403 (lost membership) → drop op + delete local + `mapDelete("mindmap", sid)`.
- `opMindmapDelete` 403 (member can't delete) → revert tombstone (`deleted:false, dirty:0`, `notice:{kind:"delete_refused", title}`) + drop op. (404 still treated as done.)
- `opMindmapPin` 403 (member can't pin an owned-by-other mindmap) → drop op (the next pull's pin-adopt restores the correct server state). The UI won't offer pin for non-owned mindmaps, so this is a safety net.

---

## 6. `syncpull.js` — `pullMindmaps` shared + notice (mirror notes)

- Drop the `list_id == null` filter (include shared).
- `mindmapFromServer`: carry `list_id`, `user_id`, `last_edited_by`, `last_editor_username`, `last_editor_display_name`. (`data_json` still lazy-fetched via `fetchOne`.)
- `writeMindmapFull` (the fetch+write helper) gains an `extra` overlay so the notice can be attached.
- LWW-loss (dirty local, server newer → server wins): attach `notice = {kind:"overwritten", title, editor: last_editor_display_name || last_editor_username || "Pengguna lain"}`. **Preserve an existing un-dismissed `notice`** across a subsequent ordinary "updated" pull (carry `local.notice` into the clean-update write), as the notes fix did.
- Shared dirty note vanished from server (deleted by owner) → set `conflict="remote_deleted"` (not silent keep); personal keeps local-wins.
- Keep the `local.conflict` early-skip guard and pin-adopt pass intact.

---

## 7. `syncconflict.js` — add the `mindmap` entity

`syncconflict` is already entity-aware (task + note from #2h-2). Add `mindmap`:
- `STORE.mindmap = "mindmaps"`.
- `listConflicts` scans the `mindmaps` store too (tags `entity:"mindmap"`).
- `listNotices` currently scans only `scratchpad_notes` — generalize to also scan `mindmaps` (return `{cid, entity, kind, title, editor}` so `dismissNotice` knows which store). `dismissNotice(entity, cid)` clears the `notice` field on the right store. (This is a small signature/shape extension; update the one note call path + the index.html notice banner accordingly.)
- `resolveConflict(entity, cid, choice)` already routes by `STORE[entity]` → `mindmap` works for free (discard removes the local mindmap + idmap + ops).

---

## 8. Wiring — `index.html`

- Call `mindmaprepo.setCurrentUser({...})` alongside the existing `noterepo.setCurrentUser`/`chatrepo.setCurrentUser` calls (online auth load + offline JWT fallback).
- `renderConflicts()` already renders entity-aware conflicts (`resolveConflict(c.entity, ...)`) and notices. Update the notice rendering to pass `entity` to `dismissNotice` (per §7) so mindmap notices dismiss correctly. The conflict/notice banner text already covers `overwritten`/`delete_refused`.
- `sync()` is structurally unchanged — `pullMindmapsAndReconcile` already runs; it now reconciles shared mindmaps too.
- SW (`static/sw.js`): bump cache version → **v135**. No new module files.

---

## 9. Testing

Node tests (`node --test tests/offline/*.test.js`), extending the mindmap suites + the conflict suite:
- `mindmaprepo`: create with list_id; updateMindmap stamps last_edited_by + clears last_editor_*.
- `mindmaproutes`: list includes shared + shape carries collaborator fields; `GET /api/lists/:id/mindmaps` returns that list's mindmaps; `/share` not intercepted.
- `syncpush` mindmap: create/update send real list_id; shared update-404 → remote_deleted (no re-create) while personal re-creates; create/update 403 → drop+delete+mapDelete; delete-403 → revert+notice; conflict re-push guard.
- `syncpull` mindmap: shared reconcile + collaborator fields; LWW-loss overwrite notice (preserved across clean pull); shared dirty-vanished → remote_deleted.
- `syncconflict`: mindmap conflicts listed (entity=mindmap); mindmap notices listed + dismissed; task/note backward-compatible.

Backend: no new Python tests (access-clause + column + 403); verify `python -m py_compile webapp.py` + the browser steps. Baseline before: **331 pass**. Target after: ~358 (exact count emerges during TDD).

---

## 10. Verification

- Self-verify Node suite green; `python -m py_compile webapp.py`; `curl .../sw.js | grep CACHE` shows v135 after deploy; **confirm `taskflow-web` restarted** (member can now GET/PUT a shared mindmap — previously 404).
- Browser-verify (user, two accounts sharing a list): owner shares a mindmap to a list → member opens it (previously 404, now works) → member edits offline → reconnect pushes (LWW) → owner sees it; both edit the same mindmap, the later offline edit loses LWW and shows the "ditimpa oleh X" notice; owner deletes a shared mindmap while a member edited it offline → discard banner; member tries to delete a not-owned shared mindmap offline → reverts + "hanya pemilik" notice; per-list mindmap view works offline. Confirm no console errors.
