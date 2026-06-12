# Design Spec: Offline Shared Notes (#2h-2)

**Date:** 2026-06-12
**Status:** Approved
**Slice:** #2h-2 of the Native Offline initiative (Model B). Second sub-slice of the collaborative tranche (#2h), after #2h-1 (chat). Shared mindmaps (#2h-3) remain a separate later sub-slice.

---

## Overview

Make **shared notes** (`scratchpad_notes` with `list_id != null`) local-first, extending the existing personal-notes offline machinery (#2f-1/#2f-2) which deliberately filtered shared notes out (`list_id == null` only). The work is an **extension of the existing note modules**, not new modules.

**Why this is simpler than it sounds:** the server's `PUT /api/scratchpad/{id}` is **pure last-write-wins** — it overwrites unconditionally and stamps `last_edited_by` + `updated_at`, with no version check or optimistic lock. Online "collaboration" is just LWW + polling (`GET /api/scratchpad/{id}` to notice `updated_at` changes) + a "Diedit oleh X" banner. So offline shared notes reuse the **same LWW-by-`updated_at`** the personal-notes slice already implements — there is no CRDT/merge to build. The new work is: lift the personal-only filter, carry collaborator metadata (`last_edited_by` + last-editor display fields), intercept the list-scoped notes route, surface a notice when a local offline edit loses LWW, and handle member-permission edges (403/404).

### Conflict resolution (decided)
- **edit-vs-edit, server newer (local dirty loses):** LWW — server wins (overwrites local) **+ a notice banner**: "Edit offline-mu pada '<title>' ditimpa oleh <editor>" (dismissable, informational; no undo/keep-both).
- **edit-vs-edit, local newer:** local wins (push the update; server applies LWW).
- **edit-vs-delete (shared note gone from server while local dirty):** reuse the #2c edit-vs-delete banner, **discard-only** (as #2d-1 did for shared tasks).

### Share action (decided)
- `PATCH /api/scratchpad/{id}/share` (set/clear `list_id`, owner-only) stays **online-only / network** (not intercepted) — same decision as drawing/mindmap share. Editing a shared note's content is fully offline-capable.

### In scope
- Shared notes readable/editable offline; created/edited offline → outbox → synced with LWW.
- List-scoped notes view offline (`GET /api/lists/:id/notes`).
- Collaborator metadata (`last_edited_by`, last-editor display) carried through for the "edited by X" banner.
- LWW-loss notice + edit-vs-delete discard banner + member-permission edge handling.

### Out of scope (deferred / unchanged)
- Shared mindmaps offline (#2h-3).
- `/share` offline (stays network).
- True merge / conflict-copy (the user chose LWW + notice, not keep-both).
- Real-time push of others' edits (online uses polling; offline relies on `sync()` pull on reconnect — no change to the polling mechanism).

### No DB change
The `scratchpad_notes` store and its `list_id` field already exist (db v4). **No schema bump.**

---

## 1. Lift the personal-only filter

The #2f modules restrict to `list_id == null`. Change them to include accessible shared notes (matching the server, whose `GET /api/scratchpad` already returns owned + list-member notes via `_note_access_clause`):

- **`notequery.js`**: `personalSorted` → rename intent to "accessibleSorted"; drop the `n.list_id == null` filter (keep `!n.deleted`). `shape()` returns the record's real `list_id` (not hardcoded `null`) and adds `last_edited_by`, `last_editor_username`, `last_editor_display_name`. `getNotes`/`getRecent`/`getTitles`/`getBacklinks` then naturally include shared notes, matching `GET /api/scratchpad`.
- **`notehydrate.js`**: seed shared notes too (remove the skip-shared guard); 2-pass `linked_to` resolution unchanged.
- **`syncpull.js` `pullNotes`**: drop the `s.list_id == null` filter so shared notes reconcile; carry `list_id` + `last_edited_by` + last-editor fields in `noteFromServer`.

---

## 2. `noterepo.js` — list_id + last_edited_by

- `createNote(input)`: accept `input.list_id` (default `null`) instead of hardcoding `null`, so a note can be created directly into a shared list offline. Set `last_edited_by = currentUser.user_id`.
- `updateNote(cid, patch)`: set `last_edited_by = currentUser.user_id` and bump `updated_at` (already does). `list_id` is NOT changed here (sharing is a separate online-only action).
- Add `setCurrentUser({user_id, username, display_name})` / `getCurrentUser()` (set alongside `chatrepo.setCurrentUser` in wiring) so the repo can stamp `last_edited_by` and so the shape can resolve "edited by me vs other".
- The local note record already has a `last_edited_by` field (was always `null`); now populated.

---

## 3. `syncpush.js` — list_id in payload + permission edges

- **`noteToCreatePayload` / `noteToUpdatePayload`**: send the record's real `list_id` (currently hardcoded `null`). Server validates membership on create (`POST` with a `list_id` you're not a member of → 403).
- **`opNoteUpdate` 404 handling — branch on `list_id`:**
  - personal (`list_id == null`): existing behavior — local-wins re-create via `POST` + remap (unchanged).
  - shared (`list_id != null`): the note was deleted by the owner or access was lost → **do NOT re-create**. Treat as edit-vs-delete: set the `#2c` conflict flag `conflict='remote_deleted'` on the local record (held), surfacing the discard-only banner. Drop the update op.
- **`opNoteCreate` / `opNoteUpdate` 403 handling (lost membership):** drop the op, hard-delete the local record, `idmap.mapDelete("note", server_id)` if mapped (lost-access, mirroring #2d-1 shared tasks).
- **`opNoteDelete` 403 handling (member tried to delete a note they don't own):** the server refuses (only owner deletes). **Revert the tombstone** (set `deleted:0`, `dirty:0`) so the note reappears locally, drop the op, and record a notice "Hanya pemilik yang bisa menghapus '<title>'". (404 still treated as already-gone, unchanged.)

---

## 4. `syncpull.js` `pullNotes` — LWW + notice + shared deletes

Extend the existing reconcile (which already does mint-cid → LWW content → delete → pin-adopt) to shared notes:

- Remove the `list_id == null` filter.
- `noteFromServer`: carry `list_id`, `last_edited_by`, `last_editor_username`, `last_editor_display_name`.
- **LWW-loss notice:** in the dirty-local branch, when `tsEpoch(server.updated_at) > tsEpoch(local.updated_at)` (server wins, server is about to overwrite the local offline edit), before `dropOutbox + writeNote`, attach an `overwrite_notice = { editor: server.last_editor_display_name || server.last_editor_username || "Pengguna lain", title: server.title }` onto the freshly-written server record. This fires for any LWW-loss but is meaningful mainly for shared notes (personal single-user edit-vs-edit is rare/multi-device).
- **edit-vs-delete for shared (dirty local, vanished from server):** the existing delete pass skips dirty local (local-wins); but for shared notes a vanished server note means the owner deleted it. Set `conflict='remote_deleted'` on the dirty local (discard-only banner) instead of silently keeping it. (Personal dirty-vanished keeps existing local-wins behavior.)
- Clean shared note vanished from server → delete locally + `mapDelete` (unchanged behavior, now also applies to shared).

---

## 5. `noteroutes.js` — list-scoped notes

- Register `GET /api/lists/:id/notes` → return local notes where `list_id === :id`, non-deleted, sorted by `updated_at` desc, shaped exactly like the server endpoint: `{id, title, updated_at}` (per webapp.py `get_list_notes`). `id = server_id ?? cid`.
- `/share` remains NOT intercepted.
- The personal `GET /api/scratchpad` route already returns all accessible notes once §1 lifts the filter.

---

## 6. `syncconflict.js` — the overwrite notice

- Extend to expose notices alongside the existing edit-vs-delete conflicts. A note record carrying `overwrite_notice` is surfaced by a new `listNotices()` (or folded into the existing `listConflicts()` with a `type` discriminator).
- `dismissNotice(cid)` clears the `overwrite_notice` field on the record.
- `renderConflicts()` in `index.html` renders the yellow notice banner: "🔔 Edit offline-mu pada '<title>' ditimpa oleh <editor> — [Tutup]". Informational only (no discard/keep-as-new buttons — distinct from the edit-vs-delete banner which keeps its discard action). The member-delete-refused notice ("Hanya pemilik…") uses the same notice channel.

---

## 7. Wiring — `index.html`

- Call `noterepo.setCurrentUser({user_id, username, display_name})` wherever `chatrepo.setCurrentUser` is already called (online `/api/auth/me` + offline JWT fallback).
- `sync()` is unchanged structurally — `pullNotesAndReconcile` already runs; it now also reconciles shared notes.
- `renderConflicts()` extended to render the new notice banner type.
- SW (`static/sw.js`): bump cache version → **v134**. (No new module files, so no precache-list additions — only the version bump to refresh the shell.)

---

## 8. Backend

**Zero changes.** All endpoints (`GET /api/scratchpad`, `GET /api/scratchpad/{id}`, `POST`, `PUT`, `DELETE`, `GET /api/lists/{id}/notes`, `PATCH /share`) and `last_edited_by`/`last_editor_*` already exist and behave as LWW.

---

## 9. Testing

Node tests (`node --test tests/offline/*.test.js`), extending existing note suites + a new conflict-notice test:

- `noterepo`: create with `list_id`; `updateNote` stamps `last_edited_by` from the configured current user.
- `notequery`: `getNotes` includes shared notes; `shape` carries `list_id` + last-editor fields; `getNotes` still applies q/tag filters across shared+personal.
- `noteroutes`: `GET /api/lists/:id/notes` returns that list's local notes; `/share` not intercepted.
- `syncpush`: create/update send real `list_id`; shared update-404 → `remote_deleted` flag (no re-create) while personal update-404 still re-creates; create/update 403 → drop + delete local + mapDelete; delete-403 → tombstone reverted + notice.
- `syncpull`: shared notes reconcile (create/LWW/delete); LWW-loss attaches `overwrite_notice`; shared dirty-vanished → `remote_deleted`.
- `syncconflict`: `listNotices` surfaces `overwrite_notice`; `dismissNotice` clears it.

Baseline before: **309 pass**. Target after: ~335 (exact count emerges during TDD).

---

## 10. Verification

- Self-verify Node suite green; `curl https://todo.yatno.web.id/sw.js | grep CACHE` shows v134 after deploy. Backend unchanged → no `taskflow-web` restart needed.
- Browser-verify (user, reset SW first; needs two accounts/devices sharing a list): open a shared list's notes offline → readable from cache; edit a shared note offline → reload persists; reconnect → `__syncNow()` pushes the edit, other member sees it (LWW); have the other member edit the same note while you're offline with an older edit → on your sync, server wins + the "ditimpa oleh X" notice appears, dismissable; owner deletes a shared note while you edited it offline → discard banner; member attempts to delete a not-owned shared note offline → on sync it reverts + "hanya pemilik" notice. Confirm no console errors.
