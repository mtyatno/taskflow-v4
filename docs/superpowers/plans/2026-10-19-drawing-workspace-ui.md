# Rencana: drawing milik workspace — PR 3, frontend + offline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Tanggal: 2026-10-19 · Agent: Claude · Branch: `claude/drawing-workspace-ui` · Frontend + offline, **naik versi SW**

**Goal:** Aplikasi memakai drawing berscope workspace dari PR 2 (#43). Daftar Draw memuat drawing W orang lain. Pemilik bisa share/unshare (dengan dialog 409). Note memberi tahu dan menangani beda scope (sisip, salin, banner, badge, placeholder). Dialog share/unshare note dan keluar workspace mengikuti spec §4.5.

**Architecture:** Lapisan offline (`drawingrepo.js`, `drawingroutes.js`, `syncpull.js`, `syncpush.js`) menyimpan `list_id`/`user_id`/`last_edited_by` seperti mindmap. Modul baru `static/offline/drawingshare.js` (`window.TF.drawingshare`) berisi logika murni + aksi share/salin yang dipakai UI. UI di `static/index.html` (DrawPage, DrawingTabInstance, DrawingInsertModal, QuickDrawModal, node view drawing, dialog share note, SharedListsManager). Share/unshare hanya online (pola mindmap `handleShare`), salin bisa offline bila data lokal ada.

**Tech Stack:** JS tanpa bundler (`static/offline/*.js` → `window.TF.*`), `static/index.html` (React.createElement terkompilasi), IndexedDB, `node --test` (`tests/offline/`), Playwright Python (E2E di `temporary_files/`).

**Spec:** `docs/superpowers/specs/2026-10-18-workspace-drawing-project-design.md` §4.5, §4.7, §4.8 (dengan aturan §4.4 versi PR 2: server hanya memindah drawing saat `list_id` note berubah; sisip ke note W yang sudah ada dibagikan klien lewat `PATCH /api/drawings/{id}/share`).

## Global Constraints

- API PR 2 yang dipakai (sudah di main): `GET /api/drawings?shared=1`; `PATCH /api/drawings/{id}/share {list_id}` → 409 `{"detail": {"code": "DRAWING_IN_USE", "notes": [{"id","title"}], "hidden_count": n}}`; `POST /api/drawings/{id}/copy {list_id, title?, client_id?}`; `POST /api/drawings` menerima `list_id`; `GET /api/lists/{id}/leave-impact` → `{"items": [{note_id, note_title, drawing_id, drawing_client_id, drawing_title}]}`; respons simpan/share note membawa `moved_drawings: [{id, client_id, list_id, updated_at}]` dan `unresolved_drawings: [token]`; baris drawing membawa `list_id`, `user_id`, `last_edited_by`, `last_editor_username`, `last_editor_display_name`.
- Teks UI persis (spec §4.5/§4.7):
  - Placeholder embed: `Gambar tidak tersedia untukmu: sudah dihapus atau tidak dibagikan ke workspace ini.`
  - Banner editor: `Kamu mengedit drawing milik workspace {W}. Perubahan terlihat oleh semua anggota.`
  - Badge scope: `👥 {W}`; label scope pribadi: `Pribadi`.
  - Tombol: `👥 Share`, `Jadikan salinan pribadi`, `Salin ke {W}`.
  - 409 unshare: judul `Drawing masih dipakai`, isi daftar judul note (+ `dan {n} note lain` bila `hidden_count` > 0), saran `Buat salinan pribadi sebagai gantinya.`
- Hanya pemilik (`user_id` = user saat ini) yang melihat aksi share, pindah, hapus, pin. Anggota bisa membuka, mengedit isi/judul, dan menyalin.
- Share/unshare/pindah drawing: online saja (seperti mindmap). Offline → toast `Butuh koneksi untuk membagikan gambar.` dan tidak ada perubahan lokal.
- Error dari share/copy tidak boleh ditelan diam-diam (`catch {}` kosong dilarang di jalur baru).
- Naik versi SW: string berikutnya setelah main saat eksekusi (sekarang `taskflow-v420-toc-headings` → `taskflow-v421-drawing-workspace`) di `static/sw.js`, `static/index.html` (dua tempat), `webapp.py` `sw_cache`, `tests/test_version.py`, dan 14 file `tests/offline/*` yang mem-pin versi. Hindari mengubah `app.css` (tetap `?v=334`); gaya baru inline.
- Tes: `npm test` (baseline 1 kegagalan pra-ada `draw_local_reactive`), `python3 -m pytest tests -q`, `node temporary_files/check_inline_scripts.js`. Commit diakhiri trailer atribusi harness pelaksana; jangan push.

## Review Focus

1. **Anggota offline menekan hapus/pin pada drawing W milik orang lain** → route lokal menjawab 403, tidak ada op outbox, tidak muncul konflik `access_lost`. Tes: Task 1 `member delete/pin of others' drawing is rejected locally`.
2. **Dikeluarkan dari W** → drawing W milik orang lain hilang dari daftar setelah pull; yang punya edit tertunda menjadi konflik `access_lost` (pilihan `keep_as_personal` yang sudah ada). Tes: Task 1 `pull removes lost workspace drawings; dirty one becomes access_lost`.
3. **Note lama merujuk drawing orang lain lewat id angka** → `GET /api/drawings/<server_id>` lokal tetap menemukan baris yang di-adopsi dari pull `shared=1`. Tes: Task 1 `local GET by server id finds other user's workspace drawing`.
4. **Salin saat data lokal belum ada** (`data_missing`) → online: salin lewat server; offline: pesan `Data gambar belum tersedia offline.` tanpa membuat baris kosong. Tes: Task 2 `copyDrawing falls back to server copy / refuses offline without data`.
5. **Share note berisi drawing W2** → default menyalin ke W lalu mengganti token di isi note sebelum share; pembatalan tidak mengubah apa pun. Tes: Task 2 `planNoteShare` + Task 5 alur dialog.

---

### Task 1 — Lapisan offline: field scope, daftar shared, guard pemilik, pull/push

**Files:**
- Modify: `static/offline/drawingrepo.js` (record, `createDrawing` ±306, `adoptServerDrawing` ±367, `reconcileWithServer`/`refreshFromServer`, `listDrawings` ±577, ekspor `setCurrentUser`), `static/offline/drawingroutes.js`, `static/offline/syncpull.js` (`drawingFromServer` ±1122, `pullDrawings` ±1535 bagian baris hilang ±1590-1625, `pullDrawingsAndReconcile` ±1682), `static/offline/syncpush.js` (`opDrawingCreate` ±911), `static/index.html` (panggil `TF.drawingrepo.setCurrentUser` di tempat yang sama dengan `TF.mindmaprepo.setCurrentUser`: ±503, ±31946, ±31984)
- Test: `tests/offline/drawing_workspace_offline.test.js` (baru)

**Interfaces:**
- Produces:
  - Record drawing menyimpan `list_id` (default `null`), `user_id`, `last_edited_by`, `last_editor_username`, `last_editor_display_name` dari server; record yang dibuat lokal: `user_id = curUid()`, `list_id = input.list_id ?? null`, `last_edited_by = curUid()`. `updateDrawing` mengisi `last_edited_by = curUid()` dan menghapus `last_editor_*` (pola `mindmaprepo.updateMindmap`).
  - `TF.drawingrepo.setCurrentUser(user|null)`, `TF.drawingrepo.currentUid() -> number|null`.
  - `createDrawing({title, data, list_id?, ...})` → payload outbox `create` membawa `list_id`; `opDrawingCreate` mengirim `list_id` di body POST.
  - `listDrawings(opts)` mengambil `/api/drawings?shared=1`, meneruskan field scope di setiap item, dan menerima filter `opts.list_id` (`"personal"` = `list_id == null`, angka = W tertentu).
  - Route lokal: `GET /api/lists/:id/drawings` → item `{id, client_id, title, svg_preview, list_id, user_id, updated_at}` milik W, urut `updated_at` desc (pola `mindmaproutes`). `PATCH /api/drawings/:id/pin` dan `DELETE /api/drawings/:id` untuk baris dengan `user_id` ≠ user saat ini → `{status: 403, body: {detail: "Hanya pemilik drawing"}}` tanpa menulis apa pun.
  - Pull: `pullDrawingsAndReconcile` memakai `/api/drawings?shared=1`; `drawingFromServer` menyalin field scope. Baris **milik orang lain** yang hilang dari daftar: tidak dirty → dihapus lokal + `mapDelete`; dirty dengan op tertunda → `conflict: "access_lost"`. Baris milik sendiri: perilaku lama (konfirmasi 404).

- [ ] **Step 1: Tulis tes yang gagal** (`node --test`, pola `mindmaprepo_shared.test.js` / `mindmapsync_shared_pull.test.js` / `mindmaproutes_shared.test.js`):

```js
test("createDrawing stores list_id/user_id and queues list_id in create payload")
test("updateDrawing stamps last_edited_by and clears last_editor_*")
test("adoptServerDrawing keeps list_id, user_id, last_edited_by, last_editor_username")
test("listDrawings requests ?shared=1 and filters by list_id ('personal' | number)")
test("local GET /api/lists/:id/drawings lists only that workspace")
test("member delete/pin of others' drawing is rejected locally")   // 403, outbox kosong, record utuh
test("local GET by server id finds other user's workspace drawing")
test("pull removes lost workspace drawings; dirty one becomes access_lost")
test("pull keeps own drawings missing from list until 404 (old behaviour)")
test("opDrawingCreate sends list_id")
```

- [ ] **Step 2:** `node --test tests/offline/drawing_workspace_offline.test.js` → FAIL
- [ ] **Step 3: Implementasi** sesuai Interfaces.
- [ ] **Step 4:** `npm test` → hanya kegagalan pra-ada; perbarui tes drawing lama hanya bila mengecek URL `/api/drawings` persis (sekarang `?shared=1`).
- [ ] **Step 5: Commit** — `feat(drawings-offline): field scope workspace, daftar shared, guard pemilik, pull akses hilang`

---

### Task 2 — Modul `drawingshare.js`: share, salin, rencana scope, adopsi `moved_drawings`

**Files:**
- Create: `static/offline/drawingshare.js` (muat di `index.html` setelah `drawingrepo.js`), `tests/offline/drawingshare.test.js`
- Modify: `static/offline/syncpush.js` (`opNoteCreate` ±697 dan `opNoteUpdate` ±744: setelah sukses, panggil `TF.drawingshare.applyMovedDrawings(res.body.moved_drawings)` bila ada)

**Interfaces:** (`window.TF.drawingshare`; fungsi aksi menerima `api` = objek dengan `get/post/patch` yang dipakai index.html)
- `scopeNotice(drawing, noteListId, myUid) -> {kind, listId}` dengan `kind`:
  - `"same"`: `drawing.list_id == noteListId` (termasuk keduanya null).
  - `"own_to_ws"`: note W, drawing pribadi milik saya → akan dibagikan ke W.
  - `"ws_in_personal"`: note pribadi, drawing milik W → tetap tautan, badge.
  - `"other_ws_copy"`: note W, drawing milik W2 (atau pribadi orang lain yang terlihat) → akan disalin ke W.
- `noticeText(notice, listName) -> string` — teks Indonesia per `kind` (dipakai modal sisip dan dialog share note).
- `shareDrawing(api, drawing, listId) -> Promise<{ok:true, drawing} | {ok:false, code:"DRAWING_IN_USE", notes, hidden_count} | {ok:false, code:"OFFLINE"|"ERROR", message}>` — `PATCH /api/drawings/{server_id}/share` dengan `{network:true}`; sukses → mutasi record lokal (`list_id`, `updated_at`, `base_rev`, `rev`+1; pola `MindmapTabInstance.handleShare`).
- `copyDrawing(api, drawing, listId, title?) -> Promise<{ok:true, drawing} | {ok:false, code, message}>` — data lokal ada → `TF.drawingrepo.createDrawing({title, data, list_id: listId})` (jalan offline); `data_missing` → online `POST /api/drawings/{id}/copy` lalu adopsi; offline tanpa data → `{ok:false, code:"OFFLINE", message:"Data gambar belum tersedia offline."}`.
- `replaceDrawingToken(content, drawing, newToken) -> string` — ganti semua `::draw[<id|client_id>]` (case-insensitive, bentuk ter-escape juga) milik `drawing` dengan `newToken`, atribut `{...}` dipertahankan.
- `planNoteShare(content, targetListId, drawingsById, myUid) -> {move: [drawing], copy: [drawing], unavailable: [token]}` — daftar untuk dialog share note (§4.5).
- `applyMovedDrawings(moved) -> Promise<void>` — set `list_id`/`updated_at`/`base_rev` record lokal yang cocok (`server_id` atau `client_id`).

- [ ] **Step 1: Tulis tes yang gagal**

```js
test("scopeNotice covers same / own_to_ws / ws_in_personal / other_ws_copy")
test("replaceDrawingToken swaps id and client_id forms incl ::DRAW and escaped, keeps attributes")
test("planNoteShare splits own personal (move), other workspace (copy), unknown (unavailable)")
test("shareDrawing success mutates local list_id; 409 returns notes + hidden_count; offline returns OFFLINE without writes")
test("copyDrawing with local data creates local record with list_id (works offline)")
test("copyDrawing falls back to server copy / refuses offline without data")
test("applyMovedDrawings updates matching records by server_id or client_id")
test("opNoteUpdate applies moved_drawings from response")
```

- [ ] **Step 2:** `node --test tests/offline/drawingshare.test.js` → FAIL
- [ ] **Step 3: Implementasi**
- [ ] **Step 4:** `npm test` → hanya kegagalan pra-ada
- [ ] **Step 5: Commit** — `feat(drawings): modul drawingshare (share, salin, rencana scope, moved_drawings)`

---

### Task 3 — Halaman Draw: share, badge, filter, aksi pemilik

**Files:**
- Modify: `static/index.html` — `DrawPage` (±11418; terima prop `sharedLists` dari App seperti `MindmapPage`), `DrawingListItem` (±11182), `DrawingTabInstance` (±11223, toolbar ±11370-11415, `handleDelete` ±11326)
- Test: `tests/offline/drawpage_workspace_ui.test.js` (pola regex/`new Function` seperti `drawpage_open.test.js`)

**Interfaces:**
- Consumes: Task 1 (`listDrawings` item punya `list_id`, `user_id`, `last_editor_username`; filter `list_id`), Task 2 (`shareDrawing`, `copyDrawing`).
- Perilaku:
  - Item daftar: badge `👥 {W}` bila `list_id`; pemilik lain ditampilkan `oleh {username}` bila tersedia; bintang pin hanya untuk pemilik.
  - Filter scope di atas daftar: `Semua` · `Pribadi` · tiap W dari `sharedLists`.
  - Toolbar tab: tombol `👥 Share` (pemilik dan `sharedLists.length > 0`) → dropdown `Pribadi` + tiap W; non-pemilik melihat badge saja. Hasil 409 → dialog `Drawing masih dipakai` (lihat Global Constraints) dengan tombol `Jadikan salinan pribadi` (memanggil `copyDrawing(..., null)` lalu membuka salinan) dan `Tutup`.
  - Hapus/rename-hapus/pin: hanya pemilik. Konfirmasi hapus menyebut judul `linked_notes` bila ada.
  - Baris "terakhir diedit oleh {nama}" di toolbar bila `last_editor_username`.
  - Buat drawing baru saat filter = W → `list_id` W.

- [ ] **Step 1: Tulis tes yang gagal** (memeriksa sumber `index.html` + menjalankan fungsi kecil yang diekstrak)

```js
test("DrawPage passes sharedLists and filters by scope (Semua/Pribadi/W)")
test("DrawingListItem shows 👥 badge and hides pin for non-owner")
test("DrawingTabInstance share uses TF.drawingshare.shareDrawing and renders DRAWING_IN_USE dialog text")
test("App passes sharedLists to DrawPage")
```

- [ ] **Step 2:** jalankan → FAIL
- [ ] **Step 3: Implementasi**; `node temporary_files/check_inline_scripts.js` OK
- [ ] **Step 4:** `npm test`
- [ ] **Step 5: Commit** — `feat(draw-ui): share drawing ke workspace, badge, filter scope, aksi khusus pemilik`

---

### Task 4 — Note: sisip, buat baru, banner editor, badge embed, placeholder, salin

**Files:**
- Modify: `static/index.html` — `DrawingInsertModal` (±23498; mount ±4989, ±5775, ±25915 meneruskan `noteListId`), node view drawing (`createDrawingPlugin` ±22779) + handler klik (±22255-22310), `window.hydrateDrawingPreviews` (±20780), `QuickDrawModal` (±23328) dan pemicu `editDrawingModal`; jalur `/draw` (slash) yang membuat drawing dari note
- Test: `tests/offline/note_drawing_scope_ui.test.js`

**Interfaces:**
- Consumes: Task 1, Task 2 (`scopeNotice`, `noticeText`, `shareDrawing`, `copyDrawing`).
- Wrapper editor note memberi atribut `data-note-list-id` (kosong untuk pribadi); hydrate dan handler klik membacanya lewat `closest('[data-note-list-id]')`.
- `DrawingInsertModal({..., noteListId})`:
  - Galeri dikelompokkan `Pribadi` lalu per W (nama dari `sharedLists`).
  - Saat memilih, tampilkan `noticeText(scopeNotice(...))` lalu konfirmasi.
  - `own_to_ws` → `shareDrawing(listId)` dulu; offline atau gagal → tetap sisip + toast `Gambar belum dibagikan ke {W}; bagikan dari halaman Draw saat online.`
  - `other_ws_copy` → `copyDrawing(noteListId)` lalu sisipkan salinannya.
  - "Baru" dari note W → `POST /api/drawings` dengan `list_id`. Jalur `/draw` sama.
- Embed (hydrate):
  - Drawing tidak ditemukan lokal maupun server → isi container dengan teks placeholder persis.
  - `drawing.list_id` ≠ `noteListId` dan `drawing.list_id` terisi → badge `👥 {W}` di header kartu + tombol aksi:
    - note pribadi → `Jadikan salinan pribadi`;
    - note W → `Salin ke {W}`.
  - Aksi = `copyDrawing` lalu `setNodeMarkup` mengganti `id` node ke token salinan (pola tombol ukuran ±22258-22289).
- `QuickDrawModal`: event `editDrawingModal` membawa `noteListId`. Bila drawing ber-`list_id` ≠ `noteListId` dan terisi → banner persis spec.

- [ ] **Step 1: Tulis tes yang gagal**

```js
test("DrawingInsertModal groups gallery by scope and uses scopeNotice/noticeText")
test("insert own personal drawing into W note calls shareDrawing; other workspace drawing is copied")
test("new drawing from W note posts list_id")
test("hydrateDrawingPreviews renders exact placeholder text when drawing unavailable")
test("embed shows 👥 badge and copy action when scopes differ; action swaps node id")
test("QuickDrawModal shows workspace banner text")
```

- [ ] **Step 2:** → FAIL
- [ ] **Step 3: Implementasi**; `check_inline_scripts` OK
- [ ] **Step 4:** `npm test`
- [ ] **Step 5: Commit** — `feat(note-draw): sisip/buat/salin drawing sesuai scope note, banner, badge, placeholder`

---

### Task 5 — Dialog share/unshare note dan keluar workspace

**Files:**
- Modify: `static/index.html` — `NoteModal.handleModalShare` (±24136) dan `NotePanel.handleShare` (±26134) lewat satu helper bersama; `SharedListsManager.handleLeave` (±2072)
- Test: `tests/offline/note_share_drawing_dialog.test.js`

**Interfaces:**
- Consumes: Task 2 (`planNoteShare`, `copyDrawing`, `replaceDrawingToken`, `shareDrawing`, `applyMovedDrawings`).
- Helper `async function confirmNoteShareWithDrawings({note, targetListId, listName, api, showToast}) -> boolean` (didefinisikan sekali di `index.html` dekat helper note lain):
  - **Share ke W:** hitung `planNoteShare`. Bila ada `move`/`copy`, tampilkan dialog berisi daftar `Ikut dibagikan ke {W}:` (move) dan `Akan disalin ke {W}:` (copy) dengan tombol `Bagikan` / `Batal`. `Bagikan`:
    1. Salin dulu tiap `copy`.
    2. Ganti token di isi note (`replaceDrawingToken`).
    3. Simpan note lewat jalur simpan biasa.
    4. Panggil `PATCH share`.
    5. `applyMovedDrawings(res.moved_drawings)`.
    `Batal` tidak mengubah apa pun.
  - **Unshare (`list_id` null):** setelah sukses, tawarkan `Tarik kembali ke pribadi?` untuk drawing milik saya ber-`list_id` = W lama yang dirujuk note ini. Ya → `shareDrawing(null)` per drawing; 409 dilewati dengan toast `"{judul}" masih dipakai note lain di {W}.`
  - Error tidak ditelan: toast pesan error.
- `handleLeave`:
  1. Panggil `GET /api/lists/{id}/leave-impact`.
  2. Bila `items` tidak kosong, dialog menyebut note dan drawing terdampak dengan tombol `Salin ke pribadi lalu keluar` / `Keluar saja` / `Batal`.
  3. Opsi salin: `copyDrawing(null)` per drawing, lalu ganti token di note pribadi terkait lewat `PUT /api/scratchpad/{id}` (konten baru), lalu `DELETE /leave`.

- [ ] **Step 1: Tulis tes yang gagal**

```js
test("note share shows move/copy lists and cancels without writes")
test("note share copies other-workspace drawings, rewrites tokens, then shares and applies moved_drawings")
test("note unshare offers pulling own drawings back; 409 is reported, not swallowed")
test("leave workspace fetches leave-impact and offers copy-then-leave")
```

- [ ] **Step 2:** → FAIL
- [ ] **Step 3: Implementasi**; `check_inline_scripts` OK
- [ ] **Step 4:** `npm test`
- [ ] **Step 5: Commit** — `feat(note-share): dialog drawing saat share/unshare note dan keluar workspace`

---

### Task 6 — Versi SW + E2E dua akun

**Files:**
- Modify: versi SW (lihat Global Constraints) + 14 tes yang mem-pin versi
- Create: `temporary_files/e2e_drawing_workspace.py` (pola `temporary_files/e2e_project_scope.py`: server uvicorn + DB sementara, dua akun A pemilik W dan B anggota), screenshot ke `temporary_files/e2e_drawing_workspace/`

- [ ] **Step 1:** Bump versi; `npm test` + `python3 -m pytest tests -q` hijau (kecuali pra-ada).
- [ ] **Step 2: E2E** (tiap langkah PASS/FAIL + screenshot):
  1. A buat drawing D; A buat note pribadi berisi D lalu share note ke W → dialog menyebut D; setelah share D ber-badge `👥 W` di Draw.
  2. B buka note → preview D tampil; B edit judul D → A melihat `terakhir diedit oleh B`.
  3. B di Draw: D tampil dengan badge, tanpa bintang pin dan tanpa tombol hapus.
  4. A di tab D: `👥 Share` → `Pribadi` → dialog `Drawing masih dipakai` menyebut note.
  5. A sisip drawing pribadi D2 ke note W yang sudah ada → pemberitahuan → setelah sisip, B melihat D2 (bukan placeholder).
  6. B dikeluarkan dari W (DB) → setelah sync B, D hilang dari Draw B; embed di note pribadi B (bila ada) menampilkan placeholder persis.
- [ ] **Step 3: Commit** — `chore(sw): v421 drawing-workspace; test(e2e): drawing workspace dua akun`

## Di luar cakupan PR ini (ruling rencana)

- **Daftar Drawing di halaman workspace** (spec §4.7) tidak dibuat: halaman workspace saat ini hanya punya tab Tasks dan Files, tanpa daftar Notes/Mindmap untuk ditiru. Penggantinya filter scope di halaman Draw (Task 3). Route lokal `GET /api/lists/:id/drawings` tetap dibuat (Task 1) untuk dipakai nanti.
- Pemberitahuan (notice center) untuk drawing di `syncconflict.listNotices`.
