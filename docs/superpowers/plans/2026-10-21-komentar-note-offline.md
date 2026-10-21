# Komentar Note — PR 2 Offline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Komentar note bisa dibaca, ditulis, dibalas, diedit, diselesaikan, dan dihapus lewat router lokal (IndexedDB + outbox), lalu tersinkron dua arah dengan API PR 1 — tanpa UI baru.

**Architecture:** Store IndexedDB baru `note_comments` (DB_VERSION 6). Tiga modul UMD baru: `commentanchor.js` (murni, cari kutipan), `commentrepo.js` (record lokal, thread, hitungan, penanda baca, tulis lokal + op outbox), `commentroutes.js` (rute lokal untuk endpoint komentar). `syncpush.js` mendapat op `comment` dan `comment_read`; `syncpull.js` mendapat `pullComments` (delta pull berkursor) yang dipanggil di `fullSync` setelah pull note. Rute note lokal menambahkan `comment_open_count`/`comment_unread` dari data lokal.

**Tech Stack:** JS UMD tanpa bundler (`window.TF.*` + `module.exports`), IndexedDB, `node --test` + `fake-indexeddb` (`tests/offline/setup.js`).

**Spec:** `docs/superpowers/specs/2026-10-21-komentar-note-design.md` (§6, dan §4 untuk kontrak API; backend sudah di `main` lewat #71, ADR-024).

## Global Constraints

- Pola modul persis seperti `static/offline/chatrepo.js`/`chatroutes.js`: UMD, `req(m, g)`, ekspor `root.TF.<nama>` dan `module.exports`.
- Kontrak server (PR 1, jangan diubah): bentuk komentar `{id, note_id, list_id, parent_id, user_id, username, display_name, body, quote, resolved_at, resolved_by, resolved_by_name, edited_at, deleted_at, client_id, created_at, updated_at}`; tombstone `deleted_at` terisi, `body: ""`, `quote: null`. Delta pull `GET /api/note-comments?since=<kursor>&limit=500` → `{items, cursor, more}` atau `{"reset": true, "items": [], "cursor": "", "more": false}`; kursor bisa maju tanpa item. POST idempoten per `client_id`. 409 note pribadi: `{"detail": {"code": "NOTE_NOT_SHARED"}}`. Kehilangan akses tidak menghasilkan tombstone.
- `client_id` komentar = `cid` lokal (UUID dari `TF.ids.newCid()`).
- Komentar ditampilkan hanya bila `comment.list_id == note.list_id` saat ini dan `note.list_id != null` (spec §6.2).
- `since` dikirim dengan `encodeURIComponent` (kursor memuat `+07:00`).
- Kursor di `_meta` kunci `comments_cursor`; penanda baca di `_meta` kunci `comment_reads` (objek `{[note_cid]: ISO}`).
- Teks error lokal (persis): note pribadi → `"Catatan ini belum dibagikan ke workspace"` (status 409, `code: "NOTE_NOT_SHARED"`); balasan diselesaikan → `"Hanya thread yang bisa diselesaikan"` (422); tidak ada → `"Komentar tidak ditemukan"` / `"Note not found"` (404).
- `sync_error` push (persis, field `{code, message}`): 403/404 pada create → `{code: "access", message: "Kamu sudah tidak punya akses ke catatan ini."}`; 409 → `{code: "not_shared", message: "Catatan ini sudah tidak dibagikan ke workspace."}`; 422 → `{code: "invalid", message: "Komentar tidak valid."}`; perubahan pada komentar yang sudah ada ditolak → `{code: "rejected", message: "Perubahan tidak tersimpan."}`.
- Frontend berubah (tag `<script>` + precache) → naikkan versi SW ke nomor kosong berikutnya setelah `main` (saat rencana ditulis: v445 → **v446** `taskflow-v446-komentar-offline`) di `static/sw.js` `CACHE`, fallback `window.__SW_VERSION` dan teks Pengaturan di `static/index.html`, `sw_cache` di `webapp.py`, `tests/test_version.py`. `app.css` tidak berubah.
- Tes: `npm test` (satu kegagalan pra-ada `draw_local_reactive` boleh), `python -m pytest tests/ -q` (bukan `pytest` di root), `node scripts/check_inline_scripts.js` bila ada di repo (cek `package.json`/`.agents/PROTOCOL.md`).

## Review Focus

1. **Komentar offline pada note yang baru dibuat atau baru di-share offline** — create ditahan sampai op note (create/update) untuk note itu habis dari outbox; tidak berakhir 409. Tes di Task 5.
2. **Balasan offline ke thread yang juga belum terkirim** — balasan ditahan lalu terkirim dengan `parent_id` server yang benar dalam drain yang sama. Tes di Task 5.
3. **Respons POST hilang lalu pull mengembalikan komentar kita sendiri** — record lokal mengadopsi `server_id` lewat `client_id`, op create berhenti, tidak ada duplikat. Tes di Task 6.
4. **Note dipindah ke workspace lain** — cache komentar workspace lama tidak tampil di rute lokal maupun hitungan badge. Tes di Task 3 dan Task 4.
5. **`reset` dari server** — komentar lokal non-pending dikosongkan lalu ditarik ulang; komentar pending tidak hilang. Tes di Task 6.

---

## File Structure

| File | Tanggung jawab |
|---|---|
| Modify `static/offline/db.js` | `DB_VERSION` 6, store `note_comments` |
| Create `static/offline/commentanchor.js` | `normalize`, `findQuote` (murni) |
| Create `static/offline/commentrepo.js` | record lokal, bentuk, thread, hitungan, penanda baca, tulis lokal + op, merge pull |
| Create `static/offline/commentroutes.js` | rute lokal komentar |
| Modify `static/offline/noteroutes.js` | ekspor `resolveNoteCid`; dekorasi `comment_open_count`/`comment_unread` |
| Modify `static/offline/taskroutes.js` | daftarkan `commentroutes` |
| Modify `static/offline/syncpush.js` | op `comment` (create/edit/resolve/delete) + `comment_read` (mark) |
| Modify `static/offline/syncpull.js` | `pullComments`; seed penanda baca dari pull note |
| Modify `static/index.html`, `static/sw.js`, `webapp.py`, `tests/test_version.py` | tag script, precache, versi SW, langkah `fullSync` |
| Tests `tests/offline/comment*.test.js` | per task |

---

### Task 1: Store IndexedDB `note_comments`

**Files:**
- Modify: `static/offline/db.js:12-53`
- Test: `tests/offline/commentdb.test.js`

**Interfaces:**
- Produces: `DB_VERSION === 6`; store `note_comments` (keyPath `cid`) dengan index `server_id`, `note_cid`, `note_id`, `list_id`.

- [ ] **Step 1: Tulis tes gagal** `tests/offline/commentdb.test.js`:
  - `test("db v6 punya store note_comments dengan index")`: `openDB()` → `db.version === 6`, store ada, `indexNames` memuat keempat index.
  - `test("upgrade v5 → v6 mempertahankan data lama")`: buka DB nama sama versi 5 dengan store `tasks` (keyPath `cid`) berisi `{cid: "t1", title: "x"}` lewat `indexedDB.open(DB_NAME, 5)` mentah, tutup, lalu `_reset(); openDB()` → `tasks` masih berisi `t1` dan `note_comments` ada.
  - `test("clearAll mengosongkan note_comments")`.
- [ ] **Step 2: Jalankan → FAIL.** `node --test tests/offline/commentdb.test.js`
- [ ] **Step 3: Implementasi** — tambah entri `note_comments: [["server_id","server_id"],["note_cid","note_cid"],["note_id","note_id"],["list_id","list_id"]]` di `ENTITY_STORES`, `DB_VERSION = 6`.
- [ ] **Step 4: Jalankan → PASS**, `npm test` → hanya `draw_local_reactive` gagal (perbarui tes lain yang mematok versi 5, bila ada).
- [ ] **Step 5: Commit** `feat(komentar-offline): store IndexedDB note_comments (DB v6)`

### Task 2: `commentanchor.js` (murni)

**Files:**
- Create: `static/offline/commentanchor.js`
- Test: `tests/offline/commentanchor.test.js`

**Interfaces:**
- Produces: `TF.commentanchor = { normalize, findQuote }`
  - `normalize(s: string) -> {text: string, map: number[]}` — kutip lengkung `‘’` → `'`, `“”` → `"`; tiap deret whitespace (termasuk NBSP ` `) jadi satu spasi; `map[i]` = indeks asli karakter normal ke-i.
  - `findQuote(docText: string, quote: string) -> {from: number, to: number} | null` — `quote` di-trim; kosong → `null`. Cocok persis dulu (kemunculan pertama); gagal → cocok setelah `normalize` kedua sisi, dipetakan balik: `from = map[i]`, `to = map[i + len - 1] + 1`. Tidak ketemu → `null`.
- [ ] **Step 1: Tulis tes gagal:**
  - persis: `findQuote("abc Rilis beta 4 Nov", "Rilis beta")` → `{from: 4, to: 14}`.
  - kemunculan pertama: `findQuote("x a x a", "a")` → `{from: 2, to: 3}`.
  - spasi: `findQuote("Rilis   beta\ndijadwalkan", "Rilis beta dijadwalkan")` → `{from: 0, to: 24}`.
  - kutip: `findQuote("Ia bilang “halo” tadi", 'bilang "halo"')` → `{from: 3, to: 16}`.
  - trim + kosong: `findQuote("abc", "  ")` → `null`; `findQuote("abc", " b ")` → `{from: 1, to: 2}`.
  - hilang: `findQuote("abc", "xyz")` → `null`.
- [ ] **Step 2: FAIL** → **Step 3: implementasi** → **Step 4: PASS** (`node --test tests/offline/commentanchor.test.js`).
- [ ] **Step 5: Commit** `feat(komentar-offline): commentanchor findQuote`

### Task 3: `commentrepo.js`

**Files:**
- Create: `static/offline/commentrepo.js`
- Test: `tests/offline/commentrepo.test.js`

**Interfaces:**
- Consumes: `TF.db`, `TF.outbox`, `TF.idmap`, `TF.ids`, `TF.meta`, `TF.chatrepo.getCurrentUser()` (user saat ini `{user_id, username, display_name}`; dibaca saat dipanggil).
- Record lokal: field server + `cid`, `server_id`, `note_cid` (null bila note belum lokal), `note_id` (server, boleh null), `parent_cid`, `parent_id` (server), `pending` (`null|"create"|"edit"|"resolve"|"delete"`), `sync_error` (`null|{code,message}`), `server_copy` (salinan field server sebelum perubahan lokal pertama pada komentar yang sudah ber-`server_id`; `null` bila tidak ada perubahan tertunda).
- Produces (`TF.commentrepo`):
  - `shape(rec) -> object` — bentuk server + `id` (= `server_id ?? cid`), `cid`, `parent_id` (server id induk, atau `parent_cid` bila induk belum terkirim), `pending` (bool), `sync_error`.
  - `listForNote(noteCid: string) -> Promise<object[]>` — `[]` bila note tidak ada atau `list_id` null; record cocok bila `note_cid === noteCid` atau (`note.server_id != null` dan `note_id == note.server_id`), `list_id == note.list_id`, `deleted_at` null; urut `created_at` lalu `cid`; hasil `shape`.
  - `threads(rows: object[], tab: "open"|"done") -> object[]` — thread (`parent_id` dan `parent_cid` kosong) dengan `replies` (urut waktu), dicocokkan lewat `parent_cid === thread.cid` atau `parent_id == thread.server_id`; `open` = `resolved_at` null, `done` = terisi.
  - `parts(body: string) -> {s, m}[]` — pecah `@\w+`; `m` true untuk mention.
  - `create(noteCid, {body, quote, parent_id}) -> Promise<object>` — `parent_id` boleh server id atau cid induk; balasan ke balasan diratakan ke induknya; `quote` dibuang pada balasan; `list_id`/`note_id` dari note saat ini; nama dari user saat ini; `created_at = updated_at = new Date().toISOString()`; `pending: "create"`; op `{entity_type: "comment", op: "create", cid}`. Kembalikan `shape`.
  - `edit(cid, body)`, `resolve(cid, resolved: bool)`, `remove(cid)` — leburan: pada record `pending === "create"` hanya mengubah record (tanpa op baru; `resolve` menyimpan `resolved_at`/`resolved_by` lokal; `remove` menghapus record + semua op outbox ber-cid itu + balasan lokal yang juga belum terkirim); pada record ber-`server_id`: simpan `server_copy` bila belum ada, ubah record, `pending` = jenisnya, tambahkan op `{entity_type: "comment", op: <jenis>, cid}` kecuali op jenis yang sama untuk cid itu sudah ada; `remove` juga membuang op `edit`/`resolve` cid itu. `resolve` pada balasan → reject `Error("Hanya thread yang bisa diselesaikan")` status 422.
  - `discard(cid) -> Promise` — `pending:"create"` → hapus record + op; selain itu kembalikan dari `server_copy` dan kosongkan `pending`/`sync_error`/`server_copy` + hapus op cid itu.
  - `mergePulled(items: object[], opts?: {replaceForNoteId?: number}) -> Promise<{changedNoteIds: number[]}>` — per item: cari lokal lewat `idmap.cidOf("comment", id)` lalu `cid === client_id`; lokal `pending === "create"` dan `client_id` cocok → adopsi field server, `server_id`, `pending: null`, `mapPut`; lokal lain yang ber-`pending` atau `sync_error` → lewati; tombstone → hapus record + `mapDelete`; selain itu upsert (cid baru bila belum ada) dengan `note_cid = idmap.cidOf("note", note_id) ?? null`, `parent_cid = idmap.cidOf("comment", parent_id) ?? null`. `replaceForNoteId` → setelah merge, hapus record non-pending untuk note itu yang tidak ada di `items`.
  - `clearSynced() -> Promise` — hapus semua record tanpa `pending` dan tanpa `sync_error`.
  - `markRead(noteCid)` — `comment_reads[noteCid] = now` + op `{entity_type: "comment_read", op: "mark", cid: noteCid}` (tanpa duplikat).
  - `seedReadMarkers(serverNotes: object[], now: string) -> Promise` — untuk tiap note server dengan `comment_unread === false` yang cid lokalnya (lewat `idmap.cidOf("note", id)`) belum punya penanda → set `now`.
  - `decorateNotes(rows: object[]) -> Promise<object[]>` — tiap row (punya `cid`, `list_id`) mendapat `comment_open_count` (thread terlihat, belum selesai) dan `comment_unread` (ada komentar terlihat milik user lain dengan `created_at > comment_reads[cid] ?? ""`); `list_id` null → `0`/`false`.
- [ ] **Step 1: Tulis tes gagal** (siapkan note lokal `scratchpad_notes` `{cid:"n1", server_id: 10, list_id: 7}` dan user `chatrepo.setCurrentUser({user_id: 1, username: "me", display_name: "Me"})`):
  - `create` → record `pending:"create"`, `list_id 7`, `note_id 10`, op create; balasan ke balasan → `parent_cid` = thread; `quote` balasan `null`.
  - `create` pada note pribadi → reject status 409 `code: "NOTE_NOT_SHARED"`.
  - leburan: create → edit → resolve → satu op saja, record memuat body baru + `resolved_at`; create → remove → tidak ada record dan op; thread pending dengan balasan pending → remove menghapus keduanya.
  - komentar ber-`server_id`: edit dua kali → satu op `edit`, `server_copy.body` = body server; `discard` → body kembali, op hilang.
  - `resolve` pada balasan → 422.
  - `listForNote` (Review Focus 4): komentar `list_id 7` tampil; ubah note jadi `list_id 9` → `[]`; note `list_id null` → `[]`; komentar yang hanya punya `note_id 10` (tanpa `note_cid`) tetap tampil.
  - `threads` + `parts`: balasan tertaut lewat `parent_id` server; tab open/done; `parts("hai @rina!")` → `[{s:"hai ",m:false},{s:"@rina",m:true},{s:"!",m:false}]`.
  - `mergePulled`: upsert baru; tombstone menghapus; record pending dilewati; adopsi `client_id` milik sendiri; `replaceForNoteId` membuang record yang hilang dari server tetapi menyimpan yang pending.
  - `decorateNotes` + `markRead` + `seedReadMarkers`: komentar user lain → unread true; setelah `markRead` → false dan satu op `comment_read`; komentar sendiri tidak membuat unread; `seedReadMarkers` hanya mengisi penanda yang belum ada.
- [ ] **Step 2: FAIL** → **Step 3: implementasi** → **Step 4: PASS** `node --test tests/offline/commentrepo.test.js`, lalu `npm test`.
- [ ] **Step 5: Commit** `feat(komentar-offline): commentrepo (record lokal, thread, leburan op, penanda baca)`

### Task 4: Rute lokal

**Files:**
- Create: `static/offline/commentroutes.js`
- Modify: `static/offline/noteroutes.js` (ekspor `resolveNoteCid`; dekorasi GET daftar/detail), `static/offline/taskroutes.js` (impor + `registerCommentRoutes(router)` di samping `registerChatRoutes`)
- Test: `tests/offline/commentroutes.test.js`

**Interfaces:**
- Consumes: Task 3; `TF.noteroutes.resolveNoteCid(idOrCid) -> Promise<cid|null>`; `TF.commentrepo` fetcher: `TF.chatrepo.getFetcher()` (fetcher jaringan yang sudah dipasang aplikasi).
- Produces `TF.commentroutes.registerCommentRoutes(router)`:
  - `GET /api/scratchpad/:id/comments` → note tidak ada → reject status 404 `"Note not found"`; online + fetcher → ambil `/api/scratchpad/<server_id>/comments` (hanya bila note punya `server_id`), `mergePulled(list, {replaceForNoteId: server_id})`, lalu `listForNote`; gagal jaringan atau offline → `listForNote`.
  - `POST /api/scratchpad/:id/comments` → `create`.
  - `PATCH /api/note-comments/:cid` → `:cid` server id atau cid lokal; body `{body}` → `edit`, `{resolved}` → `resolve`; tidak ditemukan → 404 `"Komentar tidak ditemukan"`. Kembalikan `shape` terbaru.
  - `DELETE /api/note-comments/:cid` → `remove` → `{ok: true}`.
  - `POST /api/scratchpad/:id/comments/read` → `markRead` → `{ok: true}`.
  - Tidak mendaftarkan `GET /api/note-comments` maupun `/comments/stream` (tetap ke jaringan).
  - `GET /api/scratchpad` dan `GET /api/scratchpad/:id` lokal melewati `commentrepo.decorateNotes`.
- [ ] **Step 1: Tulis tes gagal** (pola `tests/offline/chatroutes.test.js`, lewat `buildTaskRouter().dispatch`):
  - POST lalu GET offline → satu komentar `pending: true`; POST ke note pribadi → error status 409.
  - PATCH body/resolved lewat cid dan lewat server id; PATCH id tak dikenal → 404; DELETE → hilang dari GET.
  - GET online dengan fetcher palsu → memanggil `/api/scratchpad/10/comments`, hasil ter-merge; fetcher melempar → jatuh ke lokal.
  - `GET /api/scratchpad` dan `/api/scratchpad/:id` memuat `comment_open_count` dan `comment_unread` (Review Focus 4: note dipindah workspace → `0`/`false`).
  - `router.hasRoute("GET", "/api/note-comments?since=")` dan `"/api/scratchpad/10/comments/stream"` → false.
- [ ] **Step 2: FAIL** → **Step 3: implementasi** → **Step 4: PASS**, `npm test`.
- [ ] **Step 5: Commit** `feat(komentar-offline): rute lokal komentar + badge di rute note`

### Task 5: Push (`syncpush.js`)

**Files:**
- Modify: `static/offline/syncpush.js` (`processOp`, fungsi op baru di samping `opChatSend`)
- Test: `tests/offline/commentsync_push.test.js`

**Interfaces:**
- Consumes: Task 3 (record & op), `send`, `classify`, `parentCreatePending`, `TFidmap`, `TFoutbox`.
- Produces: `processOp` menangani `comment/create|edit|resolve|delete` dan `comment_read/mark`.
  - **create**: record hilang → buang op; sudah ber-`server_id` → buang op. Note: `serverIdOf(note_cid)` atau `note_id`; tidak ada → tahan bila `pending` memuat `note_cid`, selain itu `sync_error` `access`. Tahan juga selama outbox memuat op `entity_type: "note"` apa pun untuk `note_cid` itu (Review Focus 1). Induk: `parent_cid` tanpa server id → tahan bila create induk masih antre (Review Focus 2), selain itu `sync_error` `access`. POST `/api/scratchpad/<sid>/comments` `{body, quote, parent_id, client_id: cid}`. 2xx → adopsi field server, `server_id`, `mapPut("comment", id, cid)`, `pending: null`; bila record lokal punya `resolved_at` → set `pending: "resolve"` dan tambahkan op resolve. 403/404 → `access`; 409 → `not_shared`; 422 → `invalid`; record tetap ada.
  - **edit / resolve**: PATCH `/api/note-comments/<sid>` `{body}` / `{resolved}`; 2xx → adopsi, `pending: null`, `server_copy: null`; 404 → hapus record lokal + `mapDelete`; 403/409/422 → kembalikan dari `server_copy`, `sync_error` `rejected`.
  - **delete**: DELETE; 2xx/404 → hapus record + balasan lokalnya + `mapDelete`; 403 → kembalikan dari `server_copy`, `sync_error` `rejected`.
  - **comment_read/mark**: note sid tidak ada → tahan bila create note antre, selain itu buang; POST `/api/scratchpad/<sid>/comments/read`; 2xx/403/404/409 → buang op.
  - 429/5xx/jaringan mengikuti `send` (op tetap antre).
- [ ] **Step 1: Tulis tes gagal** (pola `tests/offline/chatsync_push.test.js`, `fakeTransport`):
  - create sukses → `server_id`, idmap, `pending null`, body POST memuat `client_id`.
  - Review Focus 1: note tanpa sid dengan op note create antre lalu komentar → satu drain: note POST dulu, komentar POST memakai sid baru; note dengan op update antre dan transport update 500 → komentar tidak dikirim (tetap antre).
  - Review Focus 2: thread + balasan sama-sama pending → satu drain mengirim keduanya, POST balasan memakai `parent_id` = id server thread.
  - create → 409 → `sync_error.code === "not_shared"`, op hilang, record ada; 404 → `access`; 422 → `invalid`.
  - create lalu resolve lokal (leburan) → setelah create sukses ada PATCH resolve di drain yang sama atau berikutnya.
  - edit 403 → body kembali ke `server_copy`, `sync_error.code === "rejected"`; edit 404 → record hilang.
  - delete 404 → record hilang; delete 500 → op tetap.
  - `comment_read` → POST `/read`, op hilang; note tanpa sid dan tanpa op note → op dibuang tanpa request.
- [ ] **Step 2: FAIL** → **Step 3: implementasi** → **Step 4: PASS**, `npm test`.
- [ ] **Step 5: Commit** `feat(komentar-offline): push op komentar dan penanda baca`

### Task 6: Pull, wiring aplikasi, versi SW

**Files:**
- Modify: `static/offline/syncpull.js` (`pullComments`, seed penanda baca di `pullNotesAndReconcile`, ekspor), `static/index.html` (tag `<script>` `commentanchor.js`, `commentrepo.js`, `commentroutes.js` sebelum `taskroutes.js`; langkah `fullSync` setelah pull note), `static/sw.js` (precache + `CACHE`), `webapp.py` (`sw_cache`), `tests/test_version.py`
- Test: `tests/offline/commentsync_pull.test.js`, `tests/offline/comment_wiring.test.js`

**Interfaces:**
- Consumes: Task 3 `mergePulled`, `clearSynced`, `seedReadMarkers`; `TF.meta`.
- Produces:
  - `TF.syncpull.pullComments(rawFetch) -> Promise<{pulled: number, reset: boolean, changedNoteIds: number[]}>` — baca `comments_cursor` (default `""`); ulangi `rawFetch("/api/note-comments?since=" + encodeURIComponent(cursor) + "&limit=500")` sampai `more: false` (maks 50 halaman); `reset: true` → `clearSynced()`, kursor `""`, ulangi sekali dari awal; simpan kursor setelah tiap halaman. Gagal jaringan → reject (langkah `fullSync` menangkap lewat `step`).
  - `pullNotesAndReconcile` memanggil `commentrepo.seedReadMarkers(list, new Date().toISOString())` bila modulnya ada (gagal diabaikan).
  - `fullSync` di `index.html`: `step(() => window.TF.syncpull.pullComments ? window.TF.syncpull.pullComments(__syncRawFetch).then((r) => { if (r && (r.pulled > 0 || r.reset)) window.dispatchEvent(new CustomEvent("tf:comments-changed", { detail: { source: "sync", note_ids: r.changedNoteIds } })); return r; }) : null)` setelah langkah note, sebelum mindmap.
- [ ] **Step 1: Tulis tes gagal:**
  - dua halaman (`more: true` lalu `false`) → keduanya di-merge, kursor tersimpan = kursor halaman terakhir, URL kedua memakai kursor pertama ter-encode (`%2B07%3A00`).
  - Review Focus 5: `reset` → komentar non-pending terhapus, yang pending tetap, lalu pull dari `""`.
  - Review Focus 3: record pending create + item server dengan `client_id` = cid → setelah pull ber-`server_id`; `pushOutbox` sesudahnya membuang op create tanpa POST.
  - `pullNotesAndReconcile` dengan note server `comment_unread: false` → penanda baca terisi.
  - `comment_wiring.test.js` (cek sumber, pola `*_ui.test.js`): `index.html` memuat ketiga `<script src="/static/offline/comment…">` sebelum `taskroutes.js` dan memanggil `pullComments` setelah `pullNotesAndReconcile`; `sw.js` mem-precache ketiganya.
- [ ] **Step 2: FAIL** → **Step 3: implementasi** + naikkan versi SW sesuai Global Constraints (cek `git log origin/main -1 -- static/sw.js` dulu).
- [ ] **Step 4: PASS** — `npm test`, `python -m pytest tests/ -q`, cek inline script sesuai `.agents/PROTOCOL.md`.
- [ ] **Step 5: Commit** `feat(komentar-offline): delta pull komentar di fullSync + SW v446`

### Task 7: Dokumentasi agen dan spec

**Files:**
- Modify: `.agents/CURRENT_STATE.md` (entri teratas `## 🟠 Komentar Note PR 2: offline — \`claude/komentar-note-offline\` — <tanggal> (Claude)`), `.agents/SESSION_LOG.md`, `docs/superpowers/specs/2026-10-21-komentar-note-design.md`

- [ ] **Step 1:** Spec §4 baris delta pull: ganti rumusan kursor menjadi "kursor halaman terakhir = `ts|id` item terbaru bila ≥ now − 5 menit, selain itu `now − 5 menit|0`; tidak pernah mundur". Spec §6: catat penanda baca lokal (`comment_reads`, di-seed dari `comment_unread` pull note), `server_copy` untuk rollback, dan aturan tahan create selama op note antre.
- [ ] **Step 2:** CURRENT_STATE: status, isi, versi SW, deploy (file statis saja → restart `taskflow-web` saja), verifikasi, sisa diketahui, berikutnya PR 3 UI (panel, sorotan via `commentanchor`, EventSource `/comments/stream` → `pullComments`, kartu "Gagal terkirim" memakai `discard`). SESSION_LOG: ringkasan.
- [ ] **Step 3:** `npm test`, `python -m pytest tests/ -q` → hijau (kecuali pra-ada).
- [ ] **Step 4: Commit** `docs(agents): komentar note PR 2 offline` (tanpa push; controller yang push dan membuka PR).
