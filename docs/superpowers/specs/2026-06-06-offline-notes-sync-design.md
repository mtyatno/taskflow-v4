# Offline Notes — Sync (#2f-2) Design

**Status:** Disetujui 2026-06-06
**Parent:** Inisiatif offline native (Model B). Sub-proyek #2 (sync engine). Slice notes kedua. #1 + #2a–e + #2f-1 SELESAI & deployed (SW v127, 234 test). Lihat [[project_offline_native]].
**Predecessor state:** Notes personal sudah local-first (#2f-1): `noterepo` (create/update/delete/togglePin) merekam `_outbox` (op `create`/`update`/`delete`/`pin` entity_type `note`) tapi **belum push** (Opsi B; `syncpush.processOp` saat ini *hold* op note — guard `if(entity_type==='note') return Promise.resolve()`). `notehydrate.ensureNotes` blind-pull saat boot. Mesin sync task lengkap (`syncpush.processOp` dispatch, `syncpull.pullTasks` full-list reconcile + LWW by `updated_at` + edit-vs-delete flag). `sync()` = pull(tasks)→pull(lists)→pull(habits)→push.

## Tujuan

Sambungkan domain **notes personal** ke mesin sync: CRUD + pin lokal merambat ke server (terlihat di web), dan perubahan server (web/device lain) ditarik ke lokal. Extend `syncpush` + `syncpull` — **tanpa modul baru, tanpa perubahan backend**.

## Keputusan terkunci (brainstorming 2026-06-06)

1. **Konten note = LWW by `updated_at`** (notes punya `updated_at`, di-bump server tiap PUT) — persis pola task #2c. Edit-vs-edit auto-resolve.
2. **edit-vs-delete = local-wins re-create** (pola habits #2e-2): push update kena 404 → POST ulang + remap server_id. **Tanpa banner UI, tanpa kehilangan edit.** Pull: dirty note hilang dari server → SKIP (push yang resolusi).
3. **Pin = conditional-PATCH** (endpoint server = TOGGLE, tak bump `updated_at`): push pin → GET note → PATCH `/pin` hanya bila `server.pinned ≠ local.pinned`. Pull: adopsi `server.pinned` HANYA bila tak ada op pin tertunda di outbox utk note itu (pass terpisah, krn pin tak terbawa LWW-konten).
4. **Ganti note-hold guard** (#2f-1) dgn handler asli di `processOp`.
5. **`pullNotes` menggantikan `ensureNotes` di boot** (pola `syncpull`↔`ensureTasks`, `pullHabits`↔`ensureHabits`). `ensureNotes` jadi unused → cleanup ditunda.

## Non-goals (eksplisit)

- ❌ Shared notes (`list_id≠null`) & `/share` (online-only, ditunda ke slice kolaboratif #2h).
- ❌ Drawings (#2f-3) & attachments (#2f-4/Tauri).
- ❌ Banner/prompt konflik notes (edit-vs-delete auto re-create).
- ❌ Endpoint delta `?since=` / tombstone server (tetap full-list reconcile client-only).
- ❌ Pull `linked_to` lintas-shared (hanya note personal lokal yang resolve).

## Kontrak server (dari `webapp.py`, TAK diubah)

- `GET /api/scratchpad` → `[_scratchpad_row]` (incl. personal + shared; pull **filter `list_id==null`**). `_scratchpad_row`: `id, title, content, tags[], linked_task_ids[], linked_to[](note ids), pinned, linked_tasks[], created_at, updated_at, list_id, ...`.
- `GET /api/scratchpad/{id}` → single `_scratchpad_row` (incl. `pinned`). Dipakai opNotePin utk baca server.pinned.
- `POST /api/scratchpad` (`ScratchpadCreate{title, content, tags[], linked_task_id, linked_task_ids[], list_id}`): server derive `linked_to` dari `_parse_wikilinks(content)` + simpan tags via entity_tags + `updated_at=now`. Balas `_scratchpad_row` (incl. `id`, `updated_at`).
- `PUT /api/scratchpad/{id}` (`ScratchpadUpdate` sama): re-derive linked_to+tags; `updated_at=now`. **404** bila note hilang/tak accessible. Balas `_scratchpad_row`.
- `DELETE /api/scratchpad/{id}`: hanya owner. Hard delete. **404** bila sudah hilang.
- `PATCH /api/scratchpad/{id}/pin`: **TOGGLE** `note_pins` per-user (TIDAK bump `updated_at`). Balas `_scratchpad_row` (pinned ter-update).

## Bentuk record & `_outbox` (dari #2f-1)

- **Note lokal:** `{cid, server_id, title, content, linked_task_cids(JSON), linked_to_cids(JSON), pinned(bool), list_id(null), last_edited_by, created_at, updated_at, deleted, dirty, base_rev}`. Tag di `entity_tags` (type `note`).
- **Outbox:** `{op:'create'|'update'|'delete'|'pin', entity_type:'note', cid, payload}`; payload pin = `{pinned}`.

## Arsitektur

| Unit | Status | Tanggung jawab | Uji |
|---|---|---|---|
| `static/offline/syncpush.js` | **UBAH** | mapper `noteToCreatePayload`/`noteToUpdatePayload` + 4 handler op note (create/update[404→recreate]/delete[hard]/pin[conditional]); ganti note-hold guard | Node |
| `static/offline/syncpull.js` | **UBAH** | `pullNotes` (2-pass + LWW + pin pass) + `pullNotesAndReconcile(rawFetch)` + `noteFromServer` | Node |
| `static/index.html` | **UBAH** | `sync()` tambah pull notes; hapus `ensureNotes()` boot | Browser |
| `static/sw.js` | **UBAH** | bump v127→v128 | Browser |

### `syncpush.js` (extend)
Mapper (tags & linked_task di-resolve oleh handler, dikirim sebagai argumen):
- `noteToCreatePayload(rec, tagNames, taskServerIds)` → `{title: rec.title, content: rec.content, tags: tagNames, linked_task_ids: taskServerIds, list_id: null}`.
- `noteToUpdatePayload(rec, tagNames, taskServerIds)` → bentuk sama.

`noteTagsFor(cid)` = `tagrepo.getEntityTags('note',cid).then(ts=>ts.map(t=>t.name))` (injectable `opts.noteTagsFor`). `linkedTaskServerIds(rec)` = parse `rec.linked_task_cids` → `serverIdOf(cid)` masing-masing, buang null (task belum ter-push; urutan qid jamin task lebih dulu bila dibuat sebelum note).

Handler (dispatch di `processOp`, ganti baris guard note):
- **note/create** (`opNoteCreate`): getNoteRaw; `!rec`→remove; `server_id≠null`→remove (idempotent); resolve tags+taskSids → `POST /api/scratchpad` → 2xx: `mapPut('note',id,cid)` + put `{server_id, dirty:0, base_rev:resp.updated_at}` + remove + pushed++. 4xx→drop. network→stop.
- **note/update** (`opNoteUpdate`): getNoteRaw + serverIdOf; `!rec`‖sid null→remove. `PUT /api/scratchpad/{sid}` → 2xx: put `{dirty:0, base_rev:resp.updated_at}` + remove + pushed++. **404 → re-create**: `POST /api/scratchpad` → 2xx: `mapDelete('note',sid)`→`mapPut('note',newId,cid)`→put `{server_id:newId, dirty:0, base_rev:resp.updated_at}`+remove+pushed++ (re-create POST dulu baru remap = crash-safe; network→stop; 4xx→drop). other 4xx→drop. network→stop.
- **note/delete** (`opNoteDelete`): serverIdOf; null→hard-delete lokal+remove op; else `DELETE /api/scratchpad/{sid}` → 2xx/404: `mapDelete('note',sid)`+hard-delete lokal+remove+pushed++. network→stop.
- **note/pin** (`opNotePin`): getNoteRaw + serverIdOf; null→remove (note belum ter-create / hilang). `GET /api/scratchpad/{sid}` → bila `resp.pinned !== rec.pinned`: `PATCH /api/scratchpad/{sid}/pin`; selalu remove op + pushed++ (atau no-op count bila sudah sama). 4xx→drop. network→stop.

### `syncpull.js` (extend)
`noteFromServer(s, cid, noteCidCache)` → record lokal: resolve `s.linked_to`(note server-ids)→cids via `noteCidCache`, `s.linked_task_ids`→cids via `idmap.cidOf('task',id)` (async); `{cid, server_id:s.id, title, content, linked_to_cids:JSON, linked_task_cids:JSON, pinned:!!s.pinned, list_id:null, last_edited_by, created_at, updated_at, deleted:false, dirty:0, base_rev:s.updated_at}`. (Tags: `setEntityTags('note',cid,s.tags)` dipanggil terpisah saat create/update.)

`pullNotes(serverNotes) → {created, updated, deleted, skipped, lwwResolved, pinned}` — full-list reconcile, **personal only** (`s.list_id==null`):
- **Pass 1:** ensure cid semua server note personal via `idmap.cidOf/mapPut('note')`.
- **Pass 2 (konten LWW, per note):** `!local`→CREATE (noteFromServer + setEntityTags); `local.conflict`→skip; `local.dirty`→ bila `s.updated_at≠base_rev`: LWW by `tsEpoch` (server menang→`dropOutbox(note,cid)`+overwrite; lokal menang→keep), else skip; clean & `s.updated_at≠base_rev`→UPDATE (overwrite + setEntityTags).
- **Pass 3 (delete):** local note ber-server_id hilang dari list → clean→hard-delete+`mapDelete('note')`; **dirty→SKIP** (local-wins; push update→404→re-create).
- **Pass 4 (pin):** kumpulkan cid yang punya op `pin` tertunda di `_outbox`; utk tiap server note dgn local record, bila cid TAK ada op pin tertunda & `local.pinned !== s.pinned` → put `{...local, pinned:s.pinned}` (pinned saja; `dirty` tak berubah). `pinned++`.

`pullNotesAndReconcile(rawFetch)`: `GET /api/scratchpad` (raw, token) → `.json()` → `pullNotes`.

`dropOutbox(entity_type, cid)`: ekstensi/penggunaan helper outbox-by-entity (sudah ada pola `dropOutbox` utk task di syncpull — generalkan utk `note`).

### Wiring `index.html`
- `sync()` → tambah `.then(()=> window.TF.syncpull.pullNotesAndReconcile ? pullNotesAndReconcile(__syncRawFetch) : null)` setelah pull habits, sebelum `pushOutbox`.
- **Hapus** `notehydrate.ensureNotes(...)` di boot (diganti pull). `ensureNotes` jadi unused (cleanup ditunda).

### `sw.js`
- Bump `v127-notes-local` → `v128-notes-sync`. Tak ada modul baru (extend syncpush/syncpull yang sudah precached).

## Data flow
```
sync() [boot/online/manual]
  ├─ pullAndReconcile (tasks) · pullAndReconcileLists · pullHabitsAndLogs
  ├─ pullNotesAndReconcile:
  │    GET /api/scratchpad (filter list_id==null)
  │    pass1 mint cids · pass2 LWW konten · pass3 delete · pass4 pin-adopt
  └─ pushOutbox:
       note create → POST /api/scratchpad           → server_id+idmap, dirty=0, base_rev
       note update → PUT  /api/scratchpad/{sid}      → dirty=0,base_rev (404→re-create POST+remap)
       note delete → DELETE /api/scratchpad/{sid}    → hard-delete lokal + mapDelete
       note pin    → GET then PATCH /pin (bila beda) → idempoten
  network error → STOP (sisa op retry)
```

## Testing
- **Node** extend `tests/offline/syncpush.test.js` (ganti test "HOLDS note ops"): note create (POST, server_id+idmap+base_rev, tags+linked_task resolve); update (PUT, base_rev); **update 404→re-create** (remap, server_id baru); delete (hard-delete+mapDelete); **pin conditional** (server.pinned beda→GET+PATCH; sama→GET saja, no PATCH); idempotent create; stop-on-network.
- **Node** extend `tests/offline/syncpull.test.js`: `pullNotes` create; update clean; skip dirty (edit-vs-edit LWW server-menang vs lokal-menang); delete clean (hilang→hapus+mapDelete); skip dirty delete (dirty hilang→dibiarkan); pin adopt (no pending op→adopsi server.pinned); pin skip (pending pin op→tak adopsi); linked_to 2-pass (note A→B server-ids→cids).
- **Browser** (reset SW dulu): buat/edit/hapus/pin note offline→online→push→cek server (web lain); buat note di web→`__syncNow()`→muncul lokal; edit lokal+hapus di web→re-create; pin di web→pull→pin lokal ikut. Tasks/habits utuh.
- **Deploy:** backend tak berubah → tak perlu restart `taskflow-web`. Verifikasi SW v128 via curl.

## Done criteria
1. `syncpush` ekspor `noteToCreatePayload`/`noteToUpdatePayload` + 4 handler note (guard note-hold diganti); `syncpull` ekspor `pullNotes`/`pullNotesAndReconcile`. Node-tested.
2. Notes CRUD+pin merambat 2-arah; konten LWW by updated_at; edit-vs-delete=re-create; pin conditional-PATCH; pull pin-adopt menghormati op tertunda.
3. `sync()` tambah pull notes; `ensureNotes` boot diganti; SW v128; backend nol perubahan.
4. Node suite hijau (234 + tambahan); browser-verified.

## Next
- **#2f-3 Drawings offline** (tldraw JSON via BlobStore IndexedDB) → #2g mindmap → #2h chat/kolaboratif (+shared notes & `/share`) → #3 Tauri shell (.exe/AppImage) → #4 Android.
