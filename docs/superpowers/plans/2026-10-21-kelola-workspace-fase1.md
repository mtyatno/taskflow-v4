# Kelola Workspace Fase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Halaman Kelola per workspace (identitas: nama/deskripsi/warna/avatar, anggota, Danger Zone), avatar selaras di 5 tempat, dan pengaturan pin + urutan sidebar dari halaman daftar.

**Architecture:** Kolom identitas baru di `shared_lists` + `PATCH /api/lists/{id}` + `PUT /api/lists/pins/order` (backend, online saja). Klien: helper murni di `static/offline/workspacepins.js` (`avatarFor`, `validateAvatar`), record list lokal menyimpan field baru (`listsync.js`), komponen `WorkspaceAvatar` dipakai di semua tempat, halaman baru `WorkspaceManagePage` (`ws_manage_<id>`), dan `SharedListsManager` dirombak menjadi daftar (seksi "Di sidebar" + "Semua workspace").

**Tech Stack:** FastAPI + SQLite (`repository.py`, `webapp.py`), pytest; React tanpa build (`static/index.html`), node:test; Playwright E2E lokal.

**Spec:** `docs/superpowers/specs/2026-10-21-kelola-workspace-fase1-design.md`

## Global Constraints

- `static/index.html` adalah JS `React.createElement` biasa; **jangan** menjalankan `compile.js`. Setelah mengubahnya: `node temporary_files/check_inline_scripts.js static/index.html` harus OK.
- Teks UI berbahasa Indonesia, istilah "workspace". Teks yang dipatok spec dipakai persis.
- Tanpa warna hex tetap di markup baru; pakai token tema dan kelas `app.css` dengan varian `[data-theme="dark"]`. Palet avatar = kelas `ws-c0`..`ws-c7` yang sudah ada.
- Batas: nama 1–100, deskripsi 0–300 (setelah trim), `color_idx` 0–7 atau null, avatar null / 1–2 karakter `isalnum` (uppercase) / satu emoji (aturan spec §1.2), pin maks 5.
- Semua aksi tulis (Simpan identitas, urutan pin, Pin, Keluar, Hapus) memakai `{ network: true }`; offline → nonaktif + "Butuh koneksi internet".
- `updated_at` = `datetime.now().isoformat()`.
- Versi SW/`app.css?v=` naik ke nomor kosong berikutnya di Task 7 (saat rencana ditulis `main` = v439 / 347).
- Deploy: restart `taskflow-web` dan `taskflow` (bot).

## Review Focus

1. **Emoji gabungan** (👨‍👩‍👧, 🇮🇩, 👍🏽, 1️⃣) diterima sebagai satu emoji di server **dan** klien dengan hasil sama; "🔥🔥", "A🔥", "a b" ditolak di keduanya. Tes: Task 1 `test_avatar_validation_cases` dan Task 3 `validateAvatar parity` memakai tabel kasus yang sama.
2. **Perangkat anggota melihat identitas baru tanpa reload penuh** (setelah sync list) dan saat offline (dari record lokal). Tes: Task 3 `listsync keeps identity fields`; Task 7 E2E langkah anggota.
3. **Urutan pin dari dua perangkat** — perangkat lain sudah melepas/menambah pin → `PUT /pins/order` 409 → klien menyegarkan daftar dan urutan tidak rusak. Tes: Task 2 `test_pin_order_mismatch_*`; Task 6 node `pinOrderAfterMove` + E2E 409.
4. **Workspace yang dibuka di halaman detail lalu dihapus/keluar dari perangkat lain** → "Workspace tidak ditemukan" + tombol kembali, bukan crash. Tes: Task 5 node source check + E2E.
5. **Nama/deskripsi panjang atau tanpa spasi di 375 px** tidak membuat scroll horizontal (elipsis/wrap). Tes: Task 7 E2E 375 px dengan nama 100 karakter tanpa spasi.

---

### Task 1: Backend identitas workspace (skema, PATCH, GET, pratinjau kode)

**Files:**
- Modify: `repository.py` (migrasi kolom; `get_lists_for_user`, `get_shared_list`; method baru `update_workspace_identity`)
- Create: `workspace_identity.py` (validasi murni: `normalize_avatar`, `normalize_description`, `normalize_color_idx`)
- Modify: `webapp.py` (model `WorkspacePatch`; rute `PATCH /api/lists/{list_id}`; `GET /api/lists/preview/{code}` + `owner_name`, `member_count`)
- Test: `tests/test_workspace_identity.py`

**Interfaces:**
- Produces:
  - `workspace_identity.normalize_avatar(value: str | None) -> str | None` (raise `ValueError("Avatar harus 1–2 huruf/angka atau satu emoji")`)
  - `workspace_identity.normalize_description(value: str | None) -> str` (raise `ValueError("Deskripsi maksimal 300 karakter")`)
  - `workspace_identity.normalize_color_idx(value) -> int | None` (raise `ValueError("Warna tidak valid")`)
  - `TaskRepository.update_workspace_identity(list_id: int, owner_id: int, fields: dict) -> dict | None` — `fields` hanya kunci yang dikirim (`name`, `description`, `color_idx`, `avatar`, sudah dinormalisasi); bump `updated_at`; None bila bukan owner.
  - Item `GET /api/lists` dan `GET /api/lists/{id}` memuat `description` (str), `color_idx` (int|null), `avatar` (str|null), `updated_at` (str|null).
  - `PATCH /api/lists/{id}` → 200 item list (bentuk sama dengan item `GET /api/lists` untuk owner, termasuk `role`, `member_count`, `pinned`, `pin_position`); 404 / 403 / 422.

- [ ] **Step 1: Tulis tes gagal** `tests/test_workspace_identity.py` (pola `U`/`_workspace`/`_add_member` dari `tests/test_workspace_pins_api.py`):
  - `test_avatar_validation_cases` (fungsi murni), tabel:
    ```python
    OK = [(None, None), ("", None), ("  ", None), ("ab", "AB"), ("x", "X"), ("7", "7"), ("é", "É"),
          ("🔥", "🔥"), ("👨‍👩‍👧", "👨‍👩‍👧"), ("🇮🇩", "🇮🇩"), ("👍🏽", "👍🏽"), ("❤️", "❤️"), ("1️⃣", "1️⃣")]
    BAD = ["abc", "a b", "🔥🔥", "A🔥", "a-", "<b>", "​", "🇮🇩🇮🇩"]
    ```
  - `test_description_and_color`: 300 karakter OK, 301 → ValueError; `"  x "` → `"x"`; color 0 dan 7 OK, 8 / -1 / "1" / True → ValueError; None → None.
  - `test_patch_owner_updates_fields`: PATCH `{name, description, color_idx: 3, avatar: "🔥"}` → 200, respons memuat nilai baru + `updated_at`; `GET /api/lists` item sama.
  - `test_patch_partial_and_reset`: PATCH `{description: "a"}` tidak mengubah nama/warna; PATCH `{color_idx: null, avatar: null}` → keduanya null.
  - `test_patch_member_forbidden_and_missing`: anggota → 403; id tidak ada → 404.
  - `test_patch_validation_422`: deskripsi 301, avatar "ABC", color_idx 8, nama "" → 422 dengan `detail` memuat teks Indonesia dari Interfaces.
  - `test_member_sees_identity`: setelah owner PATCH, anggota `GET /api/lists` dan `GET /api/lists/{id}` memuat field baru.
  - `test_preview_has_owner_and_count`: `POST /api/lists/{id}/generate-link` → `GET /api/lists/preview/{code}` memuat `owner_name` (display_name atau username owner) dan `member_count` (anggota + 1).
  - `test_identity_migration_idempotent`: `webapp.migrate_db()` dua kali tanpa error; kolom ada.
- [ ] **Step 2: Jalankan → FAIL.** `python3 -m pytest tests/test_workspace_identity.py -q`
- [ ] **Step 3: Implementasi.** Kolom per spec §1.1 lewat pola `PRAGMA table_info` + `ALTER TABLE` yang dipakai `migrate_db`/`_init_db` untuk tabel lain (di tempat skema `shared_lists` dipastikan; idempoten). Validasi emoji sesuai spec §1.2 tanpa dependensi baru. Pydantic model memakai `model_fields_set` (atau `exclude_unset`) agar field yang tidak dikirim tidak diubah; `ValueError` → 422 `detail` = pesan.
- [ ] **Step 4: Jalankan → PASS**, lalu `python3 -m pytest tests -q` penuh.
- [ ] **Step 5: Commit** `feat(workspace): identitas workspace (deskripsi, warna, avatar) + PATCH /api/lists/{id}`

### Task 2: Backend urutan pin

**Files:**
- Modify: `repository.py` (method `reorder_workspace_pins`), `webapp.py` (rute `PUT /api/lists/pins/order`, sebelum rute `/api/lists/{list_id}`)
- Test: `tests/test_workspace_pin_order.py`

**Interfaces:**
- Produces: `TaskRepository.reorder_workspace_pins(user_id: int, list_ids: list[int]) -> bool` (False bila himpunan ≠ pin user atau ada duplikat; posisi ditulis 0..n-1 dalam satu transaksi `BEGIN IMMEDIATE`). Endpoint → 200 `{"ok": true, "list_ids": [...]}` / 409 `{"detail": {"code": "PIN_ORDER_MISMATCH", "message": "Urutan pin sudah berubah di perangkat lain"}}` / 422 body salah.

- [ ] **Step 1: Tulis tes gagal:** `test_pin_order_success` (pin W1,W2,W3 → order [W3,W1,W2] → `GET /api/lists` `pin_position` W3=0, W1=1, W2=2); `test_pin_order_mismatch_missing` ([W1,W2]); `test_pin_order_mismatch_extra` ([W1,W2,W3,W4] dengan W4 tidak di-pin); `test_pin_order_duplicate` ([W1,W1,W2]); `test_pin_order_other_users_untouched` (pin user lain tidak berubah); `test_pin_order_empty_when_no_pins` ([] → 200).
- [ ] **Step 2: FAIL.** `python3 -m pytest tests/test_workspace_pin_order.py -q`
- [ ] **Step 3: Implementasi** sesuai Interfaces.
- [ ] **Step 4: PASS** + suite penuh.
- [ ] **Step 5: Commit** `feat(workspace): PUT /api/lists/pins/order untuk urutan pin sidebar`

### Task 3: Helper klien + record list lokal

**Files:**
- Modify: `static/offline/workspacepins.js` (`avatarFor`, `validateAvatar`, `pinOrderAfterMove`), `static/offline/listsync.js` (field baru; `setLocalIdentity`, `setLocalPinOrder`)
- Test: `tests/offline/workspace_identity.test.js`, update `tests/offline/workspacepins.test.js`/listsync tests bila ada yang memaku bentuk record

**Interfaces:**
- Produces (`window.TF.workspacepins`):
  - `avatarFor(list) -> { text: string, colorIdx: number, isEmoji: boolean }` — `list.avatar` bila string tidak kosong (isEmoji = bukan `isalnum`), selain itu `avatarInitial(list.name)`; `colorIdx` = `list.color_idx` bila integer 0–7, selain itu `avatarColorIndex(list.id)`.
  - `validateAvatar(input: string|null) -> { ok: boolean, value: string|null, error?: string }` — aturan dan pesan sama dengan `normalize_avatar` (Task 1).
  - `pinOrderAfterMove(ids: Array, fromIndex: number, toIndex: number) -> Array` — salinan baru; indeks di luar batas → salinan tanpa perubahan.
- Produces (`window.TF.listsync`): `listFromServer`/`getLocalLists` menyertakan `description`, `color_idx`, `avatar`, `updated_at`; `setLocalIdentity(serverId, fields) -> Promise<boolean>`; `setLocalPinOrder(serverIds: Array) -> Promise<number>` (menulis `pin_position` = indeks untuk tiap id; mengembalikan jumlah record diperbarui).

- [ ] **Step 1: Tulis tes gagal** `tests/offline/workspace_identity.test.js`:
  - `validateAvatar parity`: tabel OK/BAD **persis sama** dengan Task 1 Step 1 (nilai hasil sama: "ab"→"AB", "é"→"É", null/""/"  "→null).
  - `avatarFor`: `{id:3,name:"proyek",avatar:null,color_idx:null}` → `{text:"P", colorIdx:3, isEmoji:false}`; `{id:3,name:"x",avatar:"🔥",color_idx:6}` → `{text:"🔥",colorIdx:6,isEmoji:true}`; `{id:3,name:"x",avatar:"AB",color_idx:9}` → `{text:"AB",colorIdx:3,isEmoji:false}`.
  - `pinOrderAfterMove([1,2,3],0,2)` → `[2,3,1]`; `([1,2,3],2,0)` → `[3,1,2]`; `([1,2,3],0,5)` → `[1,2,3]`.
  - `listsync keeps identity fields`: `listFromServer({id:1,name:"a",role:"owner",description:"d",color_idx:2,avatar:"🔥",updated_at:"t"},"c1")` memuat keempat field; (dengan fake IndexedDB yang dipakai tes listsync yang ada) `setLocalIdentity` lalu `getLocalLists` mengembalikan nilai baru; `setLocalPinOrder([3,1])` → pin_position 3→0, 1→1.
- [ ] **Step 2: FAIL.** `node --test tests/offline/workspace_identity.test.js`
- [ ] **Step 3: Implementasi** sesuai Interfaces (segmentasi emoji di JS boleh memakai `Intl.Segmenter` bila ada, tetapi hasil harus sama dengan aturan codepoint spec §1.2 — pakai aturan codepoint sebagai sumber kebenaran).
- [ ] **Step 4: PASS**; `npm test` (hanya `draw_local_reactive` pra-ada yang boleh gagal).
- [ ] **Step 5: Commit** `feat(workspace): helper avatar/validasi/urutan pin + field identitas di record list lokal`

### Task 4: Komponen `WorkspaceAvatar` di sidebar dan halaman workspace

**Files:**
- Modify: `static/index.html` — komponen baru `WorkspaceAvatar({ list, size })`; rail (±3306), sidebar terbuka bagian WORKSPACES (±3049, ikon clipboard/users → avatar), judul + deskripsi halaman `slist_<id>` (±38285)
- Modify: `static/app.css` — `.ws-avatar` (+ ukuran `--sz`), `.ws-page-desc`
- Test: `tests/offline/workspace_avatar_ui.test.js` (cek sumber)

**Interfaces:**
- Consumes: `TF.workspacepins.avatarFor` (Task 3). Lindungi akses: `const WP = window.TF && window.TF.workspacepins` dengan fallback huruf pertama + `ws-c0`.
- Produces: `WorkspaceAvatar({ list, size = 20 })` → `<span class="ws-avatar ws-c{n}" aria-hidden="true">` berisi teks avatar; dipakai Task 5 dan 6 (ukuran 40 kartu, 56 header detail).

- [ ] **Step 1: Tes gagal** (sumber): `function WorkspaceAvatar` ada dan memanggil `avatarFor`; rail tidak lagi memakai `avatarColorIndex(w.id)` langsung; blok WORKSPACES sidebar tidak lagi memakai `icon: l.role === "owner" ? "clipboard" : "users"`; halaman `slist_` merender `WorkspaceAvatar` dan `ws-page-desc` hanya bila `description`; `app.css` memuat `.ws-avatar` dan `.ws-page-desc`.
- [ ] **Step 2: FAIL.** `node --test tests/offline/workspace_avatar_ui.test.js`
- [ ] **Step 3: Implementasi.** Sidebar terbuka: tipe link mendukung render avatar (mis. properti `avatarList` pada item link yang dipakai `NavIcon` cabang baru); jangan mengubah link lain. Judul halaman workspace: avatar 28 px di kiri nama; deskripsi satu baris (`text-overflow: ellipsis`) di bawah, warna `var(--text-light)`.
- [ ] **Step 4: PASS**; `npm test`; inline check OK.
- [ ] **Step 5: Commit** `feat(workspace): avatar workspace di rail, sidebar, dan judul halaman workspace`

### Task 5: Halaman detail `WorkspaceManagePage` (`ws_manage_<id>`)

**Files:**
- Modify: `static/index.html` — komponen baru `WorkspaceManagePage({ listId, sharedLists, onBack, onUpdated, onRefresh, showToast })`; routing di App (`page.startsWith("ws_manage_")`), judul halaman (`getPageTitle`), penanda aktif sidebar = `manage_lists`; handler App `handleWorkspaceUpdated(list)`
- Modify: `static/app.css` — `.ws-danger-zone` (+ gelap), pemilih warna `.ws-color-swatch`
- Modify: `static/offline/wsmanage.js` (`identityDiff`)
- Test: `tests/offline/workspace_manage_page.test.js` (helper murni yang diekspor + cek sumber)

**Interfaces:**
- Consumes: `WorkspaceAvatar` (Task 4); `TF.workspacepins.validateAvatar` (Task 3); `TF.listsync.setLocalIdentity` (Task 3); `PATCH /api/lists/{id}` (Task 1); bagian anggota/undangan dan `WorkspaceDeleteDialog`, `leaveWorkspaceWithDrawings`, `useDrawingScopeDialog` dari Fase 0 (sudah ada di `SharedListsManager`).
- Produces: `handleWorkspaceUpdated(list)` di App — mengganti item di `sharedLists`, `OfflineDB.cacheSet("lists", next)`, `TF.listsync.setLocalIdentity(list.id, {name, description, color_idx, avatar, updated_at})`, lalu `queueListPull()` (pola `handleWorkspacePin`). Helper murni di `wsmanage.js`: `identityDiff(original, draft) -> object` (hanya field yang berubah; nama/deskripsi di-trim) dipakai tombol Simpan.

Teks persis: tombol kembali `← Semua workspace`; seksi `Umum`, `Anggota`, `Danger Zone`; label `Nama`, `Deskripsi`, `Warna`, `Avatar`; pilihan avatar `Otomatis` / `Inisial` / `Emoji`; warna `Otomatis`; tombol `Simpan` / `Batal`; toast `Workspace disimpan`; anggota tanpa deskripsi `Belum ada deskripsi.`; `bergabung {tanggal}` (format `toLocaleDateString("id-ID", {day:"numeric", month:"short", year:"numeric"})`); Danger Zone owner `Hapus workspace` + penjelasan `Task kembali menjadi task pribadi pembuatnya; berkas, chat, project, dan tahap dihapus permanen.`; anggota `Keluar dari workspace` + `Kamu tidak lagi melihat task dan berkas workspace ini.`; tidak ditemukan `Workspace tidak ditemukan`; offline `Butuh koneksi internet`.

- [ ] **Step 1: Tes gagal:**
  - `identityDiff`: `({name:"A",description:"",color_idx:null,avatar:null}, {name:" A ",description:"x",color_idx:null,avatar:null})` → `{description:"x"}`; perubahan avatar `"🔥"`→`null` → `{avatar:null}`; tanpa perubahan → `{}`.
  - Sumber: `function WorkspaceManagePage` ada; routing `ws_manage_`; memakai `{ network: true }` untuk PATCH; semua teks persis di atas ada; seksi Umum untuk anggota tidak merender `input`/`textarea` (cek cabang `isOwner`); pemilih warna `role: "radiogroup"` dan `"aria-checked"`; Danger Zone memakai `WorkspaceDeleteDialog` (owner) dan `leaveWorkspaceWithDrawings` (anggota) dan memanggil `onBack` setelah sukses.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implementasi.** Pindahkan isi panel anggota + undangan dari `SharedListsManager` ke `WorkspaceManagePage` (fungsi yang dipakai bersama dijadikan komponen `WorkspaceMembersSection({ list, showToast, onRefresh })` agar tidak duplikat). Simpan: validasi klien (`validateAvatar`, panjang nama/deskripsi) → `api.fetch(url, { method: "PATCH", body, network: true })` → `onUpdated(resp)` → toast. Galat server → tampilkan `detail` di bawah form (`role="alert"`). Workspace tidak ada di `sharedLists` → tampilan tidak ditemukan.
- [ ] **Step 4: PASS**; `npm test`; inline OK.
- [ ] **Step 5: Commit** `feat(workspace): halaman Kelola per workspace (Umum, Anggota, Danger Zone)`

### Task 6: Halaman daftar — seksi "Di sidebar" dan "Semua workspace"

**Files:**
- Modify: `static/index.html` — `SharedListsManager` (kartu baru, tanpa panel/Hapus/Keluar; seksi Di sidebar; cari; pratinjau kode memuat owner + jumlah); App: handler `handleWorkspacePinOrder(ids)`; teruskan `onPin`/`onPinOrder`/`onOpen`/`onManage` ke `SharedListsManager`
- Modify: `static/app.css` — `.ws-pin-row`, status drag
- Modify: `static/offline/wsmanage.js` (`filterWorkspaces`)
- Test: `tests/offline/workspace_list_page.test.js`

**Interfaces:**
- Consumes: `WorkspaceAvatar` (Task 4); `TF.workspacepins.{pinnedForRail, canPinMore, pinOrderAfterMove}` (Task 3); `TF.listsync.setLocalPinOrder` (Task 3); `PUT /api/lists/pins/order` (Task 2); `handleWorkspacePin` App yang sudah ada.
- Produces: `handleWorkspacePinOrder(ids: number[])` di App — optimistis set `pin_position` di `sharedLists` + `OfflineDB.cacheSet("lists")` + `setLocalPinOrder`; panggil `PUT …/pins/order` `{network:true}`; gagal → kembalikan urutan sebelumnya + toast `Gagal menyimpan urutan`; 409 → toast `Urutan pin sudah berubah di perangkat lain` + `queueListPull()`.

Teks persis: judul seksi `Di sidebar` dan `Semua workspace`; kosong `Belum ada workspace di sidebar. Pin dari daftar di bawah.`; tombol `Pin` / `Di-pin` / `Lepas pin` / `Buka` / `Kelola`; tooltip penuh `Maksimal 5 workspace di sidebar`; aria `Naikkan {nama}` / `Turunkan {nama}`; cari placeholder `Cari workspace…` (muncul bila ≥ 6 workspace); tanpa hasil `Tidak ada workspace yang cocok.`; pratinjau kode `Owner: {owner_name} · {member_count} anggota`.

- [ ] **Step 1: Tes gagal:** helper murni `filterWorkspaces(lists, query)` di `wsmanage.js` (cocok nama/deskripsi, case-insensitive, trim; query kosong → semua); cek sumber: kartu di `SharedListsManager` tidak memuat `btn-danger-soft`/`btn-warn-soft`/`handleDelete`/`handleLeave`; ada teks persis di atas; drag memakai Pointer Events (`onPointerDown`) dan tombol ↑/↓ dengan aria persis; cari hanya dirender bila `sharedLists.length >= 6`.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implementasi.** Kartu "Semua workspace": `WorkspaceAvatar` 40 px, nama, deskripsi satu baris (elipsis; tidak dirender bila kosong), `Owner/Member · N anggota`, tombol Pin/Di-pin, Buka, Kelola. Drag: pola Pointer Events seperti papan Kanban (mouse mulai setelah 6 px, sentuh tekan-tahan ≥ 250 ms); saat dilepas hitung indeks tujuan → `pinOrderAfterMove` → `onPinOrder`. Tombol ↑ nonaktif di baris pertama, ↓ di baris terakhir. Offline: Pin/urutan/↑↓ nonaktif dengan `title="Butuh koneksi internet"`. Buka → `setPage("slist_"+id)`, Kelola → `setPage("ws_manage_"+id)`.
- [ ] **Step 4: PASS**; `npm test`; inline OK.
- [ ] **Step 5: Commit** `feat(workspace): daftar workspace dengan seksi Di sidebar (urutan pin) dan kartu Buka/Kelola`

### Task 7: Versi, E2E, verifikasi penuh

**Files:**
- Modify: versi SW di `static/sw.js`, `static/index.html` (2 tempat), `webapp.py` (`sw_cache`), `tests/test_version.py`, tes `tests/offline/*.test.js` yang memaku versi; `app.css?v=`
- Create: `temporary_files/e2e_kelola_workspace_fase1.py` (pola `temporary_files/e2e_kelola_workspace_fase0.py`; screenshot `temporary_files/e2e_kelola_workspace_fase1/` di-.gitignore)

- [ ] **Step 1: Naikkan versi** ke nomor kosong berikutnya setelah `main` terbaru (cek `git show origin/main:static/sw.js`), nama `taskflow-v<N>-kelola-workspace-fase1`.
- [ ] **Step 2: E2E** (A owner, B anggota; terang + gelap; 375 px):
  1. A buka Kelola W → ubah nama, deskripsi, warna `ws-c5`, avatar emoji 🔥 → Simpan → toast; avatar 🔥 + kelas `ws-c5` tampil di kartu daftar, header detail, rail, sidebar terbuka, judul halaman W; deskripsi di bawah judul W.
  2. B (perangkat lain) setelah sync melihat identitas baru; seksi Umum tanpa input; Danger Zone hanya `Keluar dari workspace`.
  3. Avatar "abc" → pesan galat, Simpan nonaktif; "ab" → tampil "AB".
  4. A pin W1..W3 → seksi Di sidebar urut; drag W3 ke atas → rail mengikuti; reload → urutan bertahan; ↑/↓ dengan keyboard.
  5. Urutan 409: perangkat lain melepas pin lewat API → A ubah urutan → toast `Urutan pin sudah berubah di perangkat lain` dan daftar segar.
  6. Kartu daftar tidak punya Hapus/Keluar; Danger Zone A hapus W2 → kembali ke daftar; B keluar W3 → kembali ke daftar.
  7. Halaman detail W yang dihapus dari perangkat lain → `Workspace tidak ditemukan` + tombol kembali.
  8. Offline → Simpan/Pin/urutan/Keluar/Hapus nonaktif dengan `Butuh koneksi internet`.
  9. Pratinjau kode gabung memuat `Owner:` + `anggota`.
  10. 375 px dengan nama 100 karakter tanpa spasi: tanpa scroll horizontal (`document.documentElement.scrollWidth <= innerWidth`).
- [ ] **Step 3: Jalankan E2E dua kali → semua lulus.**
- [ ] **Step 4: Verifikasi penuh:** `python3 -m pytest tests -q`, `npm test` (hanya `draw_local_reactive` pra-ada), inline check OK.
- [ ] **Step 5: Commit** `chore: SW v<N> + E2E kelola workspace fase 1`

## Di luar cakupan

Sama dengan spec (unggah gambar, warna bebas, Fase 2–5, drag di rail).
