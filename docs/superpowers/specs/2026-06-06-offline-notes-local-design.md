# Offline Notes — Local Layer (#2f-1) Design

**Status:** Disetujui 2026-06-06
**Parent:** Inisiatif offline native (Model B), Kelompok 1 domain personal. Slice pertama domain **notes**. #1 + #2a–e SELESAI & deployed (SW v126, 207 test). Lihat [[project_offline_native]].
**Predecessor state:** Notes saat ini online + cache `OfflineDB` legacy (satu-satunya domain yang masih pakai OfflineDB). Store `scratchpad_notes` (+`drawings`, `note_attachments`, `note_pins`) sudah ada di db.js (v3). Mesin sync (push/pull/konflik) sudah ada utk tasks & habits. `tagrepo` generik (entity_type apa saja). Tasks & lists sudah lokal.

## Tujuan

Bawa domain **notes personal** (scratchpad) ke local-first: lihat daftar, cari, filter tag, buka, buat, edit, hapus, pin, wikilink `[[Title]]`, backlinks — semua jalan offline dari IndexedDB. Mengikuti pola tasks #1 & habits #2e-1 (**Opsi B**: tulis ke `_outbox`, BELUM push; sync di #2f-2).

## Dekomposisi #2f (terkunci brainstorming 2026-06-06)

| Sub-slice | Isi | Status |
|---|---|---|
| **#2f-1 Notes local layer (spec ini)** | Personal notes: CRUD + tags + wikilinks + backlinks + pins, offline + outbox | INI |
| #2f-2 Notes sync | push/pull notes + konflik **LWW by `updated_at`** (pakai ulang pola task #2c) | next |
| #2f-3 Drawings offline | tldraw JSON via **BlobStore** (IndexedDB impl skrg) | nanti |
| #2f-4 Attachments offline | Nextcloud/WebDAV — **ditunda ke #3 Tauri** (butuh FS BlobStore) | tunda |

**Shared notes** (`list_id` di-set = kolaboratif, Kelompok 2) → online-only, ditunda ke slice kolaboratif (bareng chat #2h), seperti shared-list tasks sebelum #2d-1.

## Keputusan terkunci

1. **Personal-only.** Intercept `GET /api/scratchpad` mengembalikan notes lokal personal (list_id null). Shared notes TIDAK tampil sampai slice kolaboratif — "island" sementara, diterima (precedent task #1: shared-list task baru muncul di #2d-1).
2. **`PATCH /{id}/share` TIDAK di-intercept** (network passthrough). Sharing tetap online-only.
3. **Pin = op outbox terpisah** (`op:'pin'`), karena di server pin adalah `PATCH /{id}/pin` toggle terpisah (tabel `note_pins` per-user). Lokal single-user → simpan `pinned` boolean di record note.
4. **Notes punya `updated_at`** → siap LWW di #2f-2 (set `base_rev` saat hydrate; tak dipakai di #2f-1).
5. **Tags eksplisit** dari `req.tags` (BUKAN diturunkan dari judul spt task/habit). `tagrepo.setEntityTags('note', cid, tags)`.

## Non-goals (eksplisit)

- ❌ Push/pull notes ke server (Opsi B → #2f-2).
- ❌ Shared notes & `/share` offline (online-only, ditunda).
- ❌ Drawings (#2f-3) & attachments (#2f-4/Tauri).
- ❌ Resolusi `linked_to` lintas-shared (hanya notes lokal/personal yang ter-resolve).

## Sumber kebenaran (dari `webapp.py`, TAK diubah)

- **Schema** `scratchpad_notes{id, user_id, title, content, tags(legacy JSON, "[]"), linked_task_id, linked_task_ids(JSON), linked_to(JSON note-ids), list_id, last_edited_by, created_at, updated_at}`. Tag sebenarnya via `entity_tags` (entity_type='note'); pin via `note_pins{user_id,note_id}`.
- `_scratchpad_row(row, conn, uid)` → dict + `tags`(dari entity_tags), `linked_task_ids`, `linked_to`, `pinned`(dari note_pins), `linked_tasks`([{id,title,priority,gtd_status}]), owner/editor info.
- `_parse_wikilinks(content)` → regex `(?:\\?\[){2}([^\[\]\\]+)(?:\\?\]){2}`, ambil grup, `split('|')[0].strip()`, dedupe, drop kosong. (Menangani bentuk escaped remark-stringify `\[\[..\]\]`.)
- `_resolve_linked_to(titles, uid, conn)` → resolusi title/`id:N`/`N` → note IDs yang accessible. (Lokal: hanya title→cid notes lokal.)
- `GET /api/scratchpad?q=&tag=` → `[_scratchpad_row]` ORDER BY `updated_at DESC` (filter q: title/content LIKE; tag via entity_tags). Termasuk shared (access_clause).
- `GET /api/scratchpad/recent` → 5 terbaru. `GET /api/scratchpad/titles` → `[{id,title,...}]` utk autocomplete wikilink.
- `GET /api/scratchpad/{id}` → single (404 bila tak accessible).
- `POST /api/scratchpad` (`ScratchpadCreate{title, content, tags[], linked_task_id, linked_task_ids[], list_id}`): server derive `linked_to` dari `_parse_wikilinks(content)`; simpan tags via entity_tags; `last_edited_by=uid`; `created_at=updated_at=now(JKT)`. Balas `_scratchpad_row`.
- `PUT /api/scratchpad/{id}` (`ScratchpadUpdate` sama): re-derive linked_to & tags; `updated_at=now`. Hanya owner bisa ubah `list_id`.
- `DELETE /api/scratchpad/{id}`: hanya owner (403 bila bukan). Hard delete.
- `PATCH /api/scratchpad/{id}/pin`: toggle `note_pins` (per-user). Balas `_scratchpad_row` (pinned ter-update).
- `GET /api/scratchpad/{id}/backlinks` → notes yang `linked_to` memuat note ini.
- `PATCH /api/scratchpad/{id}/share` → online-only (TIDAK di-intercept).

## Arsitektur

| Unit | Status | Tanggung jawab | Uji |
|---|---|---|---|
| `static/offline/notelogic.js` | **BARU** | pure: `parseWikilinks(content)` | Node |
| `static/offline/noterepo.js` | **BARU** | `createNote`/`updateNote`/`deleteNote`/`togglePin` + outbox + tags + resolusi wikilink/linked_task | Node |
| `static/offline/notequery.js` | **BARU** | `getNotes`/`getNote`/`getRecent`/`getTitles`/`getBacklinks` + shaping | Node |
| `static/offline/notehydrate.js` | **BARU** | seed notes personal dari `/api/scratchpad`; idmap `note` | Node |
| `static/offline/noteroutes.js` | **BARU** | `registerNoteRoutes(router)` | Node |
| `static/offline/taskroutes.js` | **UBAH** | `buildTaskRouter` panggil `registerNoteRoutes(router)` | Node |
| `static/index.html` | **UBAH** | load 5 modul note; pensiun OfflineDB legacy note; (hydration ikut `sync()`/boot di #2f-2 — di #2f-1 cukup `notehydrate` di boot) | Browser |
| `static/sw.js` | **UBAH** | bump v126→v127 + precache modul note | Browser |

### Record note lokal (store `scratchpad_notes`, key `cid`)
`{cid, server_id, title, content, linked_task_cids(JSON string), linked_to_cids(JSON string), pinned(bool), list_id(null=personal), last_edited_by, created_at, updated_at, deleted, dirty, base_rev}`. Tag di `entity_tags` (type `note`).

### `notelogic.js` (pure)
- `parseWikilinks(content) → [title]` — port setia `_parse_wikilinks` (regex sama; `split('|')[0]`; trim; dedupe insertion-order; drop kosong).

### `noterepo.js`
- `createNote(input, opts)`: mint cid; `linked_to_cids` = resolve `parseWikilinks(content)` → cid notes lokal (by title, case-insensitive; abaikan yang tak ketemu); `linked_task_cids` = resolve `input.linked_task_ids` (id‖cid) → cid via idmap/local; record `{...,pinned:false,list_id:null,dirty:1}`; outbox `{op:'create',entity_type:'note',cid,payload}`; `tagrepo.setEntityTags('note',cid,input.tags)`.
- `updateNote(cid, patch, opts)`: re-derive linked_to_cids & linked_task_cids; `updated_at=now`; re-set tags; outbox `update`.
- `deleteNote(cid, opts)`: tombstone `deleted:true`; outbox `delete`.
- `togglePin(cid, opts)`: flip `pinned`; outbox `{op:'pin',entity_type:'note',cid,payload:{pinned}}`.

### `notequery.js`
- `getNotes({q,tag})`: notes lokal non-tombstone, **personal** (list_id null), order `updated_at DESC`; filter q (title/content includes) / tag (via `tagrepo.cidsForTag('note',tag)`); shape tiap row.
- `getNote(cid)`, `getRecent()` (5), `getTitles()` (`[{id,title}]`).
- `getBacklinks(cid)`: scan notes lokal yang `linked_to_cids` memuat cid → shaped list.
- **Shaping** (`shapeNote`): `{id: server_id??cid, title, content, tags(dari entity_tags), pinned, linked_task_ids:[display ids], linked_tasks:[{id,title,priority,gtd_status} dari task lokal], linked_to:[display ids], list_id:null, created_at, updated_at}` — bentuk = `_scratchpad_row` (subset yang dipakai frontend; owner/editor info di-skip utk personal/self).

### `notehydrate.js`
- `hydrateNotes(serverNotes)`: filter `list_id == null` (personal); map server_id↔cid via idmap `note`; resolve `linked_to`(server ids)→cids & `linked_task_ids`(server ids)→cids via idmap (dua-pass: pass-1 mint cid semua note dulu, lalu resolve linked_to); store `dirty:0, base_rev=updated_at`. `ensureNotes(rawFetch)`: `GET /api/scratchpad` → seed. Idempoten.

### `noteroutes.js` → `registerNoteRoutes(router)`
Map 9 route personal (lihat bagian Route). `id`=server_id‖cid; `resolveNoteCid` via notes store/idmap. `buildTaskRouter` memanggil `registerNoteRoutes(router)`. (Urutan load: notehydrate/noterepo/notequery/notelogic sebelum noteroutes; noteroutes sebelum taskroutes — lihat [[feedback_umd_load_order]].)

### `index.html` + SW
- Load 5 modul note (urutan benar). Boot: `notehydrate.ensureNotes` saat online (di #2f-2 dilipat ke `sync()`; di #2f-1 panggilan terpisah spt habits #2e-1).
- **Pensiun OfflineDB legacy note** (cache + queue note; kini ter-intercept). Ini ref OfflineDB TERAKHIR → setelah ini `OfflineDB` bisa dihapus total (cleanup, hati-hati verifikasi).
- SW bump v127 + precache modul note.

## Opsi B
CRUD/pin note offline → lokal + `_outbox`, **belum push** sampai #2f-2. "Island" notes sementara. Diterima.

## Testing
- **Node**: `notelogic.test.js` (parseWikilinks: plain `[[A]]`, escaped `\[\[A\]\]`, alias `[[A|B]]`→A, dedupe, drop kosong), `noterepo.test.js` (create/update/delete/pin; linked_to resolve title→cid; linked_task resolve; tags; outbox shape), `notequery.test.js` (list/q/tag filter; recent; titles; backlinks scan; shape id/tags/pinned/linked_tasks), `notehydrate.test.js` (seed personal, **skip shared list_id≠null**, linked_to dua-pass), `noteroutes` (intercept 9 route; `/share` tak ter-handle).
- **Browser** (reset SW dulu): offline → list/cari/filter-tag notes; buat note dgn `[[Judul lain]]` → wikilink ke note lokal; backlinks muncul; edit/hapus/pin; shared notes tak tampil (diterima); notes legacy OfflineDB pensiun, fitur lain (tasks/habits) utuh.
- **Deploy:** backend tak berubah → tak perlu restart `taskflow-web`. Verifikasi SW v127 via curl.

## Done criteria
1. 5 modul note Node-tested; 9 route personal ter-intercept via `buildTaskRouter`; `/share` tetap network.
2. Offline: notes personal CRUD + pin + wikilink/backlink + tag filter dari lokal; shape = `_scratchpad_row` (subset).
3. OfflineDB legacy note dipensiun; SW v127; backend nol perubahan.
4. Node suite hijau (207 + tambahan); browser-verified.

## Next
- **#2f-2 Notes sync** (push/pull + konflik LWW by `updated_at`) → **#2f-3 drawings** (BlobStore) → [#2f-4 attachments di Tauri]. Lalu #2g mindmap, #2h chat/kolaboratif (termasuk shared notes) → #3 Tauri.
