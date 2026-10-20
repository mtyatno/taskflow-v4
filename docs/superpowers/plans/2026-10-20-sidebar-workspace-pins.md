# Workspace Di-pin di Sidebar Mode Ikon — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rail sidebar (desktop, collapsed) menampilkan sampai 5 workspace yang di-pin user sebagai avatar shortcut, plus tombol "Semua workspace"; pin disimpan per user di server.

**Architecture:** Dua PR. **Bagian A (backend):** tabel `workspace_pins` + kolom `users.workspace_pins_seeded`, helper di `repository.py` (pin, unpin, seed, bersihkan saat keluar workspace), `GET /api/lists` membawa `pinned`/`pin_position`, endpoint `PUT`/`DELETE /api/lists/{id}/pin`. **Bagian B (frontend + offline):** modul murni `static/offline/workspacepins.js`, `listsync.js` menyimpan field pin, rail di `Sidebar`, tombol Pin di halaman workspace, kenaikan versi SW.

**Tech Stack:** Python 3, FastAPI, SQLite, pytest + `TestClient`; React (JSX terkompilasi di `static/index.html`), modul UMD `static/offline/*`, `node --test`, Playwright untuk E2E.

**Spec:** `docs/superpowers/specs/2026-10-20-sidebar-workspace-pins-design.md` — baca bersama rencana ini. Bagian A = spec §4, §5, §9–§11 butir 1. Bagian B = spec §6–§8, §10 (node + browser), §11 butir 2.

**Branch:** Bagian A `claude/workspace-pins-backend` dari `main` (≥ `9e79989`). Bagian B `claude/workspace-pins-ui` dari `main` **setelah** PR Bagian A di-merge. Baseline: `python -m pytest tests/ -q` dan `npm test` (catat angka saat mulai; kegagalan pra-ada yang diketahui: `draw_local_reactive`).

## Global Constraints

- Batas pin **5** (`PIN_LIMIT = 5`), sama di server dan klien.
- Seed: maksimal **3** workspace, satu kali per user, ditandai `users.workspace_pins_seeded = 1`; user tanpa workspace tidak ditandai.
- Urutan pin = `ORDER BY position, list_id`. Pin baru: `position = COALESCE(MAX(position), -1) + 1` milik user itu.
- 409 pin ke-6: `detail={"code": "PIN_LIMIT", "message": "Maksimal 5 workspace di-pin"}`.
- Bukan pemilik/anggota pada `PUT /pin` → 404 `"List not found"`. `DELETE /pin` tidak memeriksa keanggotaan dan selalu 200.
- `GET /api/lists`: bentuk dan urutan tidak berubah; tiap item ditambah `pinned: bool`, `pin_position: int | null`.
- Pin/unpin hanya online (`api.put/delete(..., { network: true })`); tidak ada op outbox.
- Teks UI persis: tooltip pin penuh "Maksimal 5 workspace di-pin. Lepas salah satu dulu."; offline "Butuh koneksi internet"; gagal "Gagal menyimpan pin"; menu klik kanan "Buka" / "Lepas pin"; tombol "Pin" / "Di-pin"; tombol rail "Semua workspace".
- Sidebar expanded **tidak berubah**. Rail tidak ada di ≤ 768 px (tidak disentuh).
- Aturan gaya repo: jangan pakai `border-left` aksen. Ikon dari registri `static/ui-components.js`.
- Waktu `created_at` = `datetime.now().isoformat()`.
- Deploy Bagian A: restart `taskflow-web` **dan** `taskflow` (bot), karena `repository.py` berubah.

## Review Focus

1. **Workspace yang dibuat offline (id = cid string) atau rekaman lama tanpa field pin** tidak boleh membuat rail error: `pinned` dianggap `false`, `avatarColorIndex` menerima string. Diuji di Task 3 (`avatarColorIndex accepts cid strings`, `getLocalLists defaults pin fields`).
2. **User keluar lalu diundang lagi ke workspace yang sama**: pin lama tidak muncul kembali. Diuji di Task 1 (`test_rejoin_does_not_restore_pin`).
3. **Dua tab memanggil `GET /api/lists` bersamaan saat seed**: tidak ada pin ganda atau error. Diuji di Task 1 (`test_seed_runs_once_and_is_idempotent`).
4. **Workspace tanpa task sama sekali** tetap bisa masuk seed (urut `created_at`). Diuji di Task 1 (`test_seed_orders_by_task_activity_then_created`).
5. **Pin ke-6 dari perangkat lain** saat tombol masih aktif di perangkat ini: server menolak dan klien menampilkan toast tanpa mengubah state. Diuji di Task 2 (`test_pin_limit_409`) dan Task 5 (langkah E2E pin ke-6).

---

## Bagian A — PR backend

### Task 1: Skema, seed, dan helper pin di `repository.py`

**Files:**
- Modify: `repository.py` — fungsi modul baru di dekat `ensure_contexts_schema` (~baris 300); panggil di `TaskRepository._init_db` setelah `ensure_contexts_schema(conn)` (~baris 955); `get_lists_for_user` (~baris 1524); `remove_list_member` (~baris 1563)
- Modify: `webapp.py` `migrate_db()` — panggil `repository.ensure_workspace_pins_schema(conn)` setelah `ensure_contexts_schema` (~baris 864)
- Test: `tests/test_workspace_pins_repo.py`

**Interfaces:**
- Produces:
  - `PIN_LIMIT = 5`
  - `class PinLimitError(Exception)`
  - `ensure_workspace_pins_schema(conn) -> None` — skema spec §4 persis; `ALTER TABLE users ADD COLUMN workspace_pins_seeded …` hanya bila kolom belum ada (`PRAGMA table_info`).
  - `seed_workspace_pins(conn, user_id: int) -> int` — jumlah pin yang disisipkan; tidak commit (pemanggil yang commit).
  - `TaskRepository.pin_workspace(user_id: int, list_id: int) -> int` — mengembalikan `position`; idempoten (sudah di-pin → posisi lama); `PinLimitError` bila sudah 5 pin lain; set `workspace_pins_seeded = 1`. Tidak memeriksa akses (pemanggil yang memeriksa). Hitung + insert dalam satu transaksi `BEGIN IMMEDIATE`.
  - `TaskRepository.unpin_workspace(user_id: int, list_id: int) -> bool` — `True` bila ada baris terhapus; set `workspace_pins_seeded = 1`.
  - `get_lists_for_user(user_id)` — jalankan seed (bila perlu) lalu tambahkan `pinned` dan `pin_position` ke tiap item.
  - `remove_list_member(list_id, user_id)` — juga `DELETE FROM workspace_pins WHERE user_id = ? AND list_id = ?`.

- [ ] **Step 1: Write the failing tests** di `tests/test_workspace_pins_repo.py` (pakai `TaskRepository(os.environ["DB_PATH"])`, `repo.create_shared_list(name, owner_id)`, dan helper user/member seperti `tests/test_contexts_repo.py`):
  - `test_schema_idempotent`: `ensure_workspace_pins_schema` dua kali; tabel `workspace_pins` ada dengan PK `(user_id, list_id)`; `users` punya `workspace_pins_seeded` default 0.
  - `test_lists_carry_pin_fields`: user dengan 1 workspace yang tidak di-pin (seeded sudah 1) → item punya `pinned is False`, `pin_position is None`; setelah `pin_workspace` → `pinned is True`, `pin_position == 0`; urutan daftar sama dengan sebelum ada pin.
  - `test_pin_positions_and_idempotent`: pin A, B → posisi 0, 1; pin A lagi → mengembalikan 0, jumlah baris tetap 2; unpin A lalu pin A → posisi 2.
  - `test_pin_limit`: 5 pin → pin ke-6 raise `PinLimitError`, jumlah baris tetap 5; pin ulang salah satu dari 5 → tidak raise.
  - `test_unpin_returns_flag`: unpin yang di-pin → `True`; unpin lagi → `False`.
  - `test_seed_orders_by_task_activity_then_created`: user punya 4 workspace: W1 (task `updated_at` paling baru), W2 (task lebih lama), W3 dan W4 tanpa task (W4 dibuat lebih baru dari W3) → seed memilih W1, W2, W4 dengan posisi 0, 1, 2; `workspace_pins_seeded == 1`.
  - `test_seed_runs_once_and_is_idempotent`: panggil `get_lists_for_user` dua kali → 3 pin, bukan 6; unpin semua lalu panggil lagi → tetap 0 pin.
  - `test_seed_skips_user_without_workspace`: user tanpa workspace → `workspace_pins_seeded == 0`; buat workspace pertama lalu panggil lagi → 1 pin, ditandai 1.
  - `test_manual_pin_before_seed_not_overwritten`: user dengan 4 workspace memanggil `pin_workspace(W3)` sebelum pernah `get_lists_for_user` → panggilan berikutnya hanya punya pin W3.
  - `test_leave_removes_pin` dan `test_rejoin_does_not_restore_pin`: anggota pin W, `remove_list_member(W, uid)` → baris pin hilang; tambahkan lagi sebagai anggota → `pinned is False`.
  - `test_delete_workspace_cascades_pins`: owner pin W lalu `delete_shared_list(W, owner)` → tidak ada baris `workspace_pins` untuk W.

- [ ] **Step 2: Run to verify fail**
  Run: `python -m pytest tests/test_workspace_pins_repo.py -q`
  Expected: FAIL (`AttributeError: module 'repository' has no attribute 'ensure_workspace_pins_schema'`)

- [ ] **Step 3: Implement di `repository.py` dan sambungkan di `webapp.migrate_db()`**
  Seed: kumpulkan id workspace yang bisa diakses (owner + anggota, sama dengan query di `get_lists_for_user`), urutkan `MAX(tasks.updated_at)` per list menurun dengan NULL di belakang, lalu `shared_lists.created_at` menurun, lalu `id` menurun; ambil 3; `INSERT OR IGNORE` posisi 0..2; `UPDATE users SET workspace_pins_seeded = 1`. Seed hanya bila flag 0 dan ada ≥ 1 workspace. Pin field dibaca dengan satu query `SELECT list_id, position FROM workspace_pins WHERE user_id = ?`.

- [ ] **Step 4: Run to verify pass**
  Run: `python -m pytest tests/test_workspace_pins_repo.py tests/test_workspace_files.py -q`
  Expected: PASS semua

- [ ] **Step 5: Commit**
  ```bash
  git add repository.py webapp.py tests/test_workspace_pins_repo.py
  git commit -m "feat(workspace-pins): tabel workspace_pins, seed sekali, pin/unpin di repository"
  ```

---

### Task 2: Endpoint pin + ADR

**Files:**
- Modify: `webapp.py` — tambah endpoint setelah `remove_member` (~baris 3216), **sebelum** rute `/api/lists/{list_id}/...` lain yang bisa bentrok (tidak ada konflik karena path diakhiri `/pin`)
- Modify: `.agents/DECISIONS.md` — **ADR-018** (nomor kosong berikutnya; terakhir ADR-017 setelah #51)
- Test: `tests/test_workspace_pins_api.py` (kelas `U`, `_workspace`, `_add_member` seperti `tests/test_projects_api.py`)

**Interfaces:**
- Consumes: `PIN_LIMIT`, `PinLimitError`, `TaskRepository.pin_workspace`, `unpin_workspace`, `is_list_member_or_owner` (Task 1 / sudah ada).
- Produces (dipakai Bagian B):
  - `PUT /api/lists/{list_id}/pin` → `{"ok": true, "pinned": true, "pin_position": int}`
  - `DELETE /api/lists/{list_id}/pin` → `{"ok": true, "pinned": false}`
  - `GET /api/lists` item: `pinned`, `pin_position` (dari Task 1).

- [ ] **Step 1: Write the failing tests**:
  - `test_get_lists_has_pin_fields`: user baru membuat 1 workspace → `GET /api/lists` item punya `pinned` (seed → `True`) dan `pin_position == 0`.
  - `test_put_pin_idempotent`: dua `PUT` → 200 keduanya, `pin_position` sama.
  - `test_pin_limit_409`: buat 6 workspace (seed memakai 3), pin 2 lagi → total 5; `PUT` ke-6 → 409, `detail["code"] == "PIN_LIMIT"`, `detail["message"] == "Maksimal 5 workspace di-pin"`.
  - `test_put_pin_non_member_404`: user lain → 404.
  - `test_delete_pin_idempotent_and_orphan`: `DELETE` dua kali → 200; user yang sudah keluar (`DELETE /api/lists/{id}/leave`) → `DELETE /pin` tetap 200.
  - `test_leave_endpoint_removes_pin` dan `test_owner_removes_member_removes_pin`: lewat endpoint `/leave` dan `DELETE /api/lists/{id}/members/{member_id}` → pin anggota hilang di `GET /api/lists` saat diundang lagi.

- [ ] **Step 2: Run to verify fail**
  Run: `python -m pytest tests/test_workspace_pins_api.py -q`
  Expected: FAIL (405/404 untuk `/pin`)

- [ ] **Step 3: Implement endpoint di `webapp.py`**
  `PUT`: `is_list_member_or_owner` False → 404 `"List not found"`; `PinLimitError` → `HTTPException(409, detail={"code": "PIN_LIMIT", "message": "Maksimal 5 workspace di-pin"})`.

- [ ] **Step 4: Tulis ADR-018** di `.agents/DECISIONS.md` (format ADR yang ada): "Pin workspace per user untuk rail sidebar (`workspace_pins`)" — keputusan (tabel pin per user, maks 5, seed sekali bertanda `users.workspace_pins_seeded`, pin dibersihkan saat keluar workspace, field di `GET /api/lists`), alasan (navigasi cepat di mode ikon tanpa membebani rail), konsekuensi (hanya online di v1, urutan drag belum ada, bot ikut memicu seed lewat `get_lists_for_user`).

- [ ] **Step 5: Run full suite**
  Run: `python -m pytest tests/ -q`
  Expected: semua PASS (baseline + tes baru), tanpa kegagalan baru.

- [ ] **Step 6: Commit**
  ```bash
  git add webapp.py tests/test_workspace_pins_api.py .agents/DECISIONS.md
  git commit -m "feat(workspace-pins): PUT/DELETE /api/lists/{id}/pin + ADR-018"
  ```

**Setelah Bagian A:** review akhir branch, perbarui `.agents/CURRENT_STATE.md` + `SESSION_LOG.md`, buka draft PR dengan catatan deploy (restart `taskflow-web` + `taskflow`). Bagian B dimulai setelah PR ini di-merge.

---

## Bagian B — PR frontend + offline

### Task 3: Modul `workspacepins.js` + field pin di `listsync.js`

**Files:**
- Create: `static/offline/workspacepins.js` (UMD seperti `listsync.js`; ekspor ke `TF.workspacepins`)
- Modify: `static/offline/listsync.js` — `listFromServer`, `getLocalLists`
- Modify: `static/index.html` — `<script src="/static/offline/workspacepins.js"></script>` setelah `listsync.js` (~baris 296)
- Modify: `static/sw.js` — tambahkan `"/static/offline/workspacepins.js"` ke daftar precache setelah `listsync.js`
- Test: `tests/offline/workspacepins.test.js`, tambahan di `tests/offline/listsync.test.js`

**Interfaces:**
- Produces (`TF.workspacepins`):
  - `PIN_LIMIT = 5`
  - `pinnedForRail(lists: Array) -> Array` — item dengan `pinned === true`, urut `pin_position` lalu `String(id)`, maksimal 5; input `null`/`undefined` → `[]`.
  - `avatarInitial(name: string) -> string` — karakter pertama setelah `trim()` lewat `Array.from`, `toUpperCase()`; kosong → `"?"`.
  - `avatarColorIndex(id: number|string) -> number` — 0..7 deterministik (angka: `Math.abs(id) % 8`; string: jumlah kode karakter `% 8`).
  - `canPinMore(lists: Array) -> boolean` — jumlah `pinned === true` < 5.
  - `applyPinChange(lists: Array, listId, pinned: boolean, pinPosition: number|null) -> Array` — array baru; item `id === listId` mendapat `pinned` dan `pin_position` baru; item lain sama (referensi tetap).
- Produces (`TF.listsync`): rekaman dan hasil `getLocalLists` membawa `pinned` (default `false`) dan `pin_position` (default `null`).

- [ ] **Step 1: Write the failing tests**:
  - `pinnedForRail sorts by pin_position and caps at 5`: 7 item dengan 6 `pinned` acak posisi → 5 item, urut posisi 0..4.
  - `pinnedForRail ignores unpinned and missing field` dan `pinnedForRail(null) → []`.
  - `avatarInitial handles emoji, leading spaces, empty`: `"  jatahku"` → `"J"`, `"🚀 Tim"` → `"🚀"`, `""`/`null` → `"?"`.
  - `avatarColorIndex is deterministic and accepts cid strings`: sama untuk input sama; hasil dalam 0..7 untuk `5`, `-3`, `"c_abc123"`.
  - `canPinMore`: 4 pinned → `true`; 5 → `false`.
  - `applyPinChange returns new array with only the target changed`.
  - Di `listsync.test.js`: `pullLists stores pinned and pin_position` (server `pinned: true, pin_position: 2` → rekaman sama) dan `getLocalLists defaults pin fields` (server tanpa field → `pinned === false`, `pin_position === null`).

- [ ] **Step 2: Run to verify fail**
  Run: `node --test tests/offline/workspacepins.test.js tests/offline/listsync.test.js`
  Expected: FAIL (`Cannot find module '../../static/offline/workspacepins.js'`)

- [ ] **Step 3: Implement modul dan perubahan `listsync.js`, tambahkan tag script dan entri precache.**

- [ ] **Step 4: Run to verify pass**
  Run: `npm test`
  Expected: PASS (kecuali kegagalan pra-ada `draw_local_reactive`)

- [ ] **Step 5: Commit**
  ```bash
  git add static/offline/workspacepins.js static/offline/listsync.js static/index.html static/sw.js tests/offline/workspacepins.test.js tests/offline/listsync.test.js
  git commit -m "feat(workspace-pins): modul workspacepins + listsync menyimpan field pin"
  ```

---

### Task 4: Rail — avatar pin, "Semua workspace", menu klik kanan

**Files:**
- Modify: `static/index.html` — `Sidebar` (props ~baris 2519, rail ~baris 2776–2818); pemakaian `Sidebar` di App (~baris 34826)
- Modify: `static/ui-components.js` — tambah ikon `pin-off` dan `more-horizontal` (path Lucide) ke registri
- Modify: `static/app.css` — blok rail (~baris 124–139)

**Interfaces:**
- Consumes: `TF.workspacepins.pinnedForRail`, `avatarInitial`, `avatarColorIndex` (Task 3).
- Produces:
  - Prop baru `Sidebar`: `onUnpinWorkspace(listId) -> void`. App memberi `id => handleWorkspacePin(id, false)` (handler dibuat di Task 5; di task ini cukup prop opsional yang dipanggil bila ada).
  - Kelas CSS: `.sidebar-rail-ws` (tombol avatar), `.sidebar-rail-ws-avatar` (lingkaran 28 px), `.ws-c0` … `.ws-c7` (8 warna, tema terang + gelap kontras), `.sidebar-rail-ctx` (menu klik kanan).

Perilaku (spec §6):
- Setelah `railLinks`: bila `pinnedForRail(sharedLists)` tidak kosong → `sidebar-rail-divider` lalu satu `sidebar-rail-btn sidebar-rail-ws` per pin (`title`/`aria-label` = nama, `aria-current="page"` bila `page === "slist_" + id`, kelas `active` bila aktif, klik → `setPage("slist_" + id); onClose?.()`).
- Selalu tampil tombol `sidebar-rail-btn` ikon `more-horizontal`, `title`/`aria-label` "Semua workspace", aktif saat `page === "manage_lists"`, klik → `setPage("manage_lists")`.
- `onContextMenu` (dan `onKeyDown` untuk tombol `ContextMenu` atau `Shift+F10`) di avatar → `preventDefault`, buka menu `sidebar-rail-ctx` di posisi pointer (atau di samping tombol untuk keyboard) dengan item "Buka" dan "Lepas pin". "Lepas pin" `disabled` dengan `title` "Butuh koneksi internet" bila `!navigator.onLine`. Escape, klik di luar, atau memilih item menutup menu. State menu lokal di `Sidebar` (`useState`).
- Ring aksen avatar saat aktif: `.sidebar-rail-btn.active .sidebar-rail-ws-avatar { box-shadow: 0 0 0 2px var(--accent); }`.

- [ ] **Step 1: Implement rail, ikon, dan CSS**

- [ ] **Step 2: Verifikasi kompilasi & tes**
  `compile.js` menimpa `static/index.html` di tempat dengan hasil kompilasi, padahal yang di-commit adalah sumber JSX. Jadi cek sintaks pada salinan lalu pulihkan sumbernya:
  Run: `cp static/index.html /tmp/index.src.html && node compile.js; rc=$?; cp /tmp/index.src.html static/index.html; exit $rc` lalu `npm test` dan `python -m pytest tests/test_version.py -q`
  Expected: `compile.js` selesai tanpa error (exit 0), `git diff --stat static/index.html` hanya menunjukkan perubahan Task ini; tes PASS (kecuali pra-ada)

- [ ] **Step 3: Cek visual cepat dengan Playwright** (server lokal `uvicorn webapp:app`, akun dengan 3 workspace ter-seed): sidebar collapsed menampilkan divider + 3 avatar + tombol "Semua workspace"; klik avatar membuka workspace dan avatar aktif; klik kanan → menu muncul, Escape menutup; tema gelap dan terang. Simpan screenshot di `temporary_files/e2e_workspace_pins/` dan tambahkan folder itu ke `.gitignore` (pola `temporary_files/e2e_mindmap_live/`).

- [ ] **Step 4: Commit**
  ```bash
  git add static/index.html static/ui-components.js static/app.css .gitignore
  git commit -m "feat(workspace-pins): avatar workspace di rail + Semua workspace + menu klik kanan"
  ```

---

### Task 5: Tombol Pin di halaman workspace, handler App, versi SW, E2E

**Files:**
- Modify: `static/index.html` — handler `handleWorkspacePin` di App (dekat `setSharedLists`, ~baris 33374); tombol di `workspace-nav-tabs` (~baris 34730–34767, sebelum "Kelola project"); prop `onUnpinWorkspace` di `Sidebar`
- Modify: versi SW ke nomor kosong berikutnya di `main` saat itu (cek `git log origin/main -- static/sw.js`): `static/sw.js` `CACHE`, dua fallback di `static/index.html` (`window.__SW_VERSION` dan teks "Versi Aplikasi"), `sw_cache` di `webapp.py` (~baris 4167), `tests/test_version.py`; naikkan `app.css?v=` di `static/index.html`
- Create: `temporary_files/e2e_workspace_pins.py` (pola `temporary_files/e2e_project_scope.py`)

**Interfaces:**
- Consumes: `PUT`/`DELETE /api/lists/{id}/pin` (Task 2), `TF.workspacepins.applyPinChange`, `canPinMore`, `PIN_LIMIT` (Task 3), prop `onUnpinWorkspace` (Task 4).
- Produces: `handleWorkspacePin(listId, pin: boolean) -> Promise<void>` di App.

Perilaku (spec §7, §9):
- `handleWorkspacePin`: `!navigator.onLine` → tidak memanggil apa pun. Panggil `api.put(`/api/lists/${listId}/pin`, {}, { network: true })` atau `api.delete(..., { network: true })`. Sukses → `setSharedLists(ls => TF.workspacepins.applyPinChange(ls, listId, r.pinned, r.pin_position ?? null))`, lalu `window.TF.listsync.pullAndReconcileLists(window.__syncRawFetch).catch(() => {})` di latar. 409 `PIN_LIMIT` → toast "Maksimal 5 workspace di-pin. Lepas salah satu dulu."; error lain → toast "Gagal menyimpan pin". State tidak berubah bila gagal.
- Tombol: `btn btn-sm btn-secondary`, ikon `pin` + teks "Pin" bila belum, "Di-pin" bila sudah (hover pada "Di-pin" menampilkan ikon `pin-off`, klik = lepas). Nonaktif dengan `title` "Butuh koneksi internet" bila offline; nonaktif dengan `title` "Maksimal 5 workspace di-pin. Lepas salah satu dulu." bila belum di-pin dan `!canPinMore(sharedLists)`. "Kelola project" tetap `marginLeft: "auto"`, tombol Pin diletakkan tepat sebelumnya dengan `marginLeft: "auto"` dipindah ke tombol Pin.

- [ ] **Step 1: Implement handler, tombol, dan prop `onUnpinWorkspace`**

- [ ] **Step 2: Naikkan versi SW dan `app.css?v=`; perbarui `tests/test_version.py`**

- [ ] **Step 3: Verifikasi tes**
  Run: `python -m pytest tests/ -q` dan `npm test`
  Expected: PASS (kecuali pra-ada `draw_local_reactive`)

- [ ] **Step 4: Tulis dan jalankan E2E** `temporary_files/e2e_workspace_pins.py` — skenario spec §10 (Browser): seed tampil di rail; pin dari halaman workspace muncul di rail (urutan terakhir); unpin dari menu klik kanan menghilangkan avatar; pin ke-6: tombol nonaktif dengan tooltip, lalu paksa `PUT` ke-6 lewat perangkat kedua (context browser kedua) saat tombol perangkat pertama masih aktif → toast dan state tidak berubah; offline (`context.set_offline(True)` + reload) → rail tetap sama, tombol Pin dan "Lepas pin" nonaktif; tema gelap dan terang.
  Run: `python temporary_files/e2e_workspace_pins.py`
  Expected: semua langkah PASS; screenshot di `temporary_files/e2e_workspace_pins/`

- [ ] **Step 5: Commit**
  ```bash
  git add static/index.html static/sw.js webapp.py tests/test_version.py temporary_files/e2e_workspace_pins.py
  git commit -m "feat(workspace-pins): tombol Pin di halaman workspace + versi SW"
  ```

**Setelah Bagian B:** review akhir branch (model terkuat), perbaikan + re-review, perbarui `.agents/CURRENT_STATE.md` + `SESSION_LOG.md`, buka draft PR dengan catatan deploy (versi SW baru; restart `taskflow-web` karena `sw_cache` berubah).
