# Checklist bertingkat — PR A (server) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** server mendukung checklist bertingkat — butir punya induk (`subtasks.parent_id`), bisa dipindah dan diubah teksnya, centang dan hapus berantai ke turunan, dan persen Progress task dihitung otomatis dari butir level atas — tanpa mengubah tampilan, sehingga klien sekarang tetap berjalan dan PR B (tampilan) tinggal memakai API ini.

**Architecture:** logika pohon murni di modul baru `checklist_tree.py` (pre-order, turunan, persen); semua aturan tulis (penomoran ulang, berantai, hitung progress) di `TaskRepository` dalam satu transaksi tulis per operasi, sehingga web dan bot Telegram berperilaku sama (spec D1). `tasks.progress` dan kolom baru `tasks.checklist_total` ditulis sebagai field turunan **tanpa** menaikkan `updated_at` (D2). `PUT /api/tasks/{id}` mengabaikan `progress` selama task punya checklist (D3). `migrate_db()` membersihkan induk yatim dan menghitung ulang progress setiap start (§3.4).

**Tech Stack:** FastAPI + pydantic 2.13, SQLite (`dbconn.get_conn` / `dbconn.write_tx`), python-telegram-bot 21, pytest (`tests/conftest.py`, helper `tests/test_contexts_tasks.py`), Playwright E2E (`temporary_files/`).

**Spec:** `docs/superpowers/specs/2026-11-06-checklist-bertingkat-design.md` — §2 (K1–K17, D1–D11), §3 Data, §4 API, §5 Aturan progress, §8 Bot/ekspor/merge, §10 Kasus tepi, §11.2 pytest, §12 Rilis (PR A). **Disetujui pemilik 2026-11-09 06.00 WIB**; dampak Timeline diterima apa adanya (K17).

**Basis kode:** `main` @ `a04f0e6` (SW `taskflow-v500-target-pomodoro`, ADR terakhir ADR-047, pytest basis 1478 lulus / 1 dilewati menurut handover 1d-0).

## Fakta hasil eksplorasi (titik sentuh)

| Lapisan | Lokasi | Keadaan sekarang |
|---|---|---|
| Koneksi/transaksi | `dbconn.py` `connect` (`isolation_level="IMMEDIATE"`: transaksi implisit mulai di DML pertama, **bukan** di SELECT), `get_conn` (commit/rollback/close), `write_tx(conn)` (`BEGIN IMMEDIATE` eksplisit sebelum SELECT; menolak transaksi bersarang) | pola baca-ubah-tulis yang aman = `with self._connect() as conn, dbconn.write_tx(conn):` |
| Skema `subtasks` | `repository.py:674–686` (`CREATE TABLE`: id, task_id, title, is_done, sort_order, created_at; FK `task_id` CASCADE; `idx_subtasks_task_id`), migrasi `client_id` `:945–949` | tanpa `parent_id` |
| Kolom `tasks` | migrasi kolom di `_init_db` `:895–916` (pola `PRAGMA table_info(tasks)` lalu `ALTER TABLE`); `progress INTEGER DEFAULT 0` `:903`. `_init_db` berjalan **di setiap** `TaskRepository(...)` (per request) | tanpa `checklist_total` |
| Repo checklist | `add_subtask` `:1521` (idempoten `client_id`; `sort_order = MAX+1` per **task**), `get_subtasks` `:1542` (`ORDER BY sort_order`), `toggle_subtask` `:1551`, `delete_subtask` `:1561` (→ `bool`), `get_subtask_progress` `:1575` (semua butir) | datar |
| Tugas startup | `heal_orphan_workspace_items` `:1143` dipanggil sekali dari `webapp.migrate_db` `:350` (pola untuk pembersihan startup); `migrate_db` juga dipanggil di event `startup` `:1789` dan workflow deploy | tempat `heal_checklists` |
| API checklist | `webapp.py:3482` `SubtaskCreate {title (min_length=1), client_id}`; `GET` `:3486`; `POST` `:3493` (notifikasi workspace "menambah item checklist"); toggle `:3509` (`_can_access_task` baca); `DELETE` `:3522` (`write=True`, → `{"ok": True}`) | tanpa induk/indeks/pindah/ubah teks |
| Hitungan Fokus | `GET /api/tasks/child-counts` `:2334`; agregat `subtasks` `:2373` | semua butir |
| PUT task | `update_task` `:2570`; `existing = _can_access_task(...)` `:2591`; `progress` `:2657–2658`; `if not updates and ext_patch is None: 400 "No fields to update"` `:2687–2688`; `updated_at` selalu di-bump `:2692`; notifikasi workspace sesudah blok DB | menerima `progress` kapan pun |
| Serialisasi task | `task_row_to_dict` `:1527` = `dict(row)` + turunan | kolom baru otomatis ikut di semua respons task (tanpa ubah serializer) |
| Ekspor | `GET /api/export/download` `:7474`; `tasks.json` di zip; subtasks `:7530–7537` (`{title, done}`, `ORDER BY sort_order`) | datar |
| Bot | `_build_view_message` `bot.py:679` (judul "📝 Subtasks d/t" dari semua butir), `_build_view_buttons` `:722` (tombol `togsub_` 2 per baris), `_refresh_view_data` `:783`, callback `togsub_` `:1665`, `delsub_mode_` `:1695` (tombol `delsub_` per butir), `delsub_` `:1717`, `/sub` `:2096` (`repo.add_subtask` lalu hitung `d/t` dari semua butir) | datar; `test_bot_escape.py:37` memanggil `_build_view_message` dengan dict tanpa `depth`/`parent_id` |
| `merge_db.py` | skrip CLI tingkat modul (`argv`: backup, current, `--apply`); subtasks `:108–121` `INSERT OR IGNORE` tanpa id lama | tidak memetakan induk |
| Tes terkait | `tests/test_task_child_counts.py` (mengunci hitungan semua butir), `tests/test_notification_escape.py:41`, `tests/test_bot_escape.py:37`; vektor lintas bahasa disimpan di `tests/fixtures/*.json` (pola `plugin_records_vectors.json`) | – |
| Trigger | tidak ada trigger SQLite pada `tasks` UPDATE | tulis turunan aman |

## Keputusan rencana (controller)

- **R1 — Modul `checklist_tree.py`** (akar repo, hanya stdlib, tanpa impor `webapp`/`repository`/`config`): fungsi murni `percent(done, total) -> int | None` (`total = 0` → `None`; selain itu `(done * 200 + total) // (2 * total)`), `preorder(rows) -> list[dict]` (salinan baris + `depth`; urut saudara `(sort_order, id)`; butir yatim, lintas task, atau bersiklus diperlakukan level atas; iteratif, tanpa rekursi), `descendant_ids(rows, root_id) -> list[int]` (pre-order, tanpa `root_id`, iteratif, tahan siklus); plus satu fungsi SQL `recompute_all(conn) -> int` (hitung ulang `progress`/`checklist_total` semua task yang nilainya berbeda, R8 langkah 3; mengembalikan jumlah baris ditulis) yang hanya memakai `conn` yang diberikan — dipakai `heal_checklists` dan `merge_db.py`. Vektor persen di **`tests/fixtures/checklist_percent_vectors.json`** (`[[done, total, expected], …]`, berisi semua contoh spec §5 + batas) — PR B memakai berkas yang sama untuk `node --test` (spec §11.1).
- **R2 — Satu transaksi tulis per operasi.** Setiap tambah, ubah teks, pindah, centang, dan hapus: `with self._connect() as conn, dbconn.write_tx(conn):` → baca baris yang perlu → validasi → tulis → `_recompute_progress(conn, task_id)` → kembalikan hasil. Tidak ada operasi checklist yang menulis `tasks.updated_at`.
- **R3 — `_recompute_progress(conn, task_id) -> dict`** (fungsi modul `repository.py`): hitung level atas (`parent_id IS NULL`); `total > 0` → `UPDATE tasks SET progress = ?, checklist_total = ?` hanya bila salah satu nilainya berbeda; `total = 0` → hanya `checklist_total = 0` bila belum 0 (progress tetap, K11). Mengembalikan `task_progress = {"done", "total", "progress"}` dengan `progress` = nilai kolom setelahnya.
- **R4 — `ChecklistError(code)`** (kelas di `repository.py`, turunan `ValueError`): `"PARENT_NOT_FOUND"`, `"CYCLE"`, `"EMPTY_TITLE"`. `webapp.py` memetakannya ke 422 dengan teks persis spec §4: "Induk checklist tidak ditemukan", "Butir tidak bisa dipindah ke dalam dirinya sendiri", "Teks butir tidak boleh kosong".
- **R5 — Bentuk kembalian repo kompatibel ke belakang.** `get_subtasks` → daftar pre-order, tiap butir `{id, task_id, parent_id, depth, title, is_done, sort_order}`. `add_subtask` / `rename_subtask` / `toggle_subtask` → dict butir **ditambah** `task_progress` (toggle juga `changed_ids`). `delete_subtask` → `{"deleted_ids", "task_progress"}` atau `None` bila tidak ada — tetap truthy/falsy seperti `bool` lama (bot dan `webapp` hanya memakai truthiness). `move_subtask` → `{"items", "task_progress"}` atau `None`.
- **R6 — Indeks.** `index` di body: `Field(default=None, ge=0)` (negatif → 422 pydantic); batas atas di-clamp ke jumlah saudara. Tambah dan pindah menomori ulang kelompok saudara yang terkena `0..n−1` menurut urutan tampil (`sort_order`, `id`) — data lama dengan `sort_order` kembar jadi rapi saat pertama disentuh.
- **R7 — PUT task (D3).** Di dalam blok DB `update_task`, sebelum `updates["progress"] = …`: bila task punya ≥ 1 butir level atas (`SELECT 1 FROM subtasks WHERE task_id = ? AND parent_id IS NULL LIMIT 1`), `progress` tidak dimasukkan dan `progress_ignored = True`. Pengecekan `No fields to update` menjadi: bila `not updates and ext_patch is None and not req.recurrence_renew` → `progress_ignored` ? `return task_row_to_dict(existing, conn)` (200, tanpa UPDATE, tanpa notifikasi) : 400 seperti sekarang. Pemeriksaan `_check_base_rev` tetap sebelum semua ini.
- **R8 — Startup (`heal_checklists`).** Metode `TaskRepository.heal_checklists() -> dict` dipanggil di `migrate_db()` tepat setelah `heal_orphan_workspace_items()`: (1) `parent_id` yang menunjuk butir tidak ada atau butir task lain → `NULL`; (2) siklus diputus dengan aturan `preorder` (anggota `(sort_order, id)` terkecil → level atas; disahkan di catatan implementasi spec); (3) hitung ulang `progress`/`checklist_total` untuk semua task yang berubah nilainya (satu agregat `GROUP BY task_id`, `UPDATE` hanya baris berbeda). Mengembalikan `{"orphans": n, "recomputed": m}`. Idempoten; tanpa `updated_at`.
- **R9 — Bot.** Helper murni baru: `_checklist_lines(subtasks) -> str` (dipakai `_build_view_message`), `_checklist_toggle_rows(subtasks, task_id)` (dipakai `_build_view_buttons`), `_delsub_buttons(subtasks, task_id)` (dipakai callback `delsub_mode_`). `depth` dibaca `s.get("depth", 0)` supaya dict lama di tes tetap sah. Hitungan judul = level atas (`checklist_tree` atau `get_subtask_progress`). Teks: indentasi `"  " * depth` + `"↳ "` untuk sub butir di pesan; awalan `"↳ "` pada label tombol centang sub butir; akhiran `" (+N sub)"` pada tombol hapus butir bertu­runan. Judul bagian tetap "📝 <b>Subtasks</b>" (istilah bot tidak diubah di PR ini).
- **R10 — `merge_db.py`.** Saat menyalin subtasks: urutkan sumber per task dengan `checklist_tree.preorder`, petakan `id lama → id baru` (`lastrowid`), tulis `parent_id` = peta induk (induk tak terpetakan → `NULL`). DB cadangan lama tanpa kolom `parent_id` (cek `PRAGMA table_info(subtasks)` di sumber) → semua butir level atas. Setelah selesai, `checklist_tree.recompute_all(dst)` di DB tujuan. Skrip hanya mengimpor `checklist_tree` (bukan `repository`). Tes lewat `subprocess` dengan dua DB sementara.
- **R11 — ADR-048** (cek nomor di `main` saat merge): field turunan `progress`/`checklist_total` tanpa naik `updated_at`; PUT mengabaikan `progress` selama ada checklist; hitung ulang tiap start; K17 (dampak Timeline diterima).
- **R12 — Tanpa perubahan `static/**`** → tanpa naik versi SW, tanpa whatsnew. Klien sekarang tetap jalan (Review Focus 3); E2E T11 membuktikannya.

## Global Constraints

- Komentar dan nama tes berbahasa Indonesia; TDD per tugas (tes gagal dulu); commit kecil per tugas dengan trailer atribusi sesi pelaksana; tidak ada push oleh implementer/reviewer — push hanya di Task 12.
- **Tidak berubah:** `static/**` (diff kosong), skema tabel lain, IndexedDB, plugin, `task_ext.py`, serializer `task_row_to_dict`. Di `bot.py` hanya fungsi tampilan checklist + callback `delsub_mode_` (memakai helper baru) + teks hitungan `/sub`.
- **Skema baru hanya:** `subtasks.parent_id INTEGER DEFAULT NULL`, indeks `idx_subtasks_tree (task_id, parent_id, sort_order)`, `tasks.checklist_total INTEGER DEFAULT 0` — semuanya di `_init_db` dengan pola `PRAGMA table_info` + `ALTER TABLE` (aman dijalankan berulang).
- Operasi checklist dan `heal_checklists` **tidak pernah** menulis `tasks.updated_at` (diuji di T2–T7).
- String persis: "Induk checklist tidak ditemukan", "Butir tidak bisa dipindah ke dalam dirinya sendiri", "Teks butir tidak boleh kosong", bot `"↳ "`, `" (+N sub)"`.
- Verifikasi standar per tugas: `python -m pytest tests/ -q` (basis 1478 lulus / 1 dilewati + tes baru); `npm test` hanya di T12 (tidak ada perubahan JS — harus sama dengan basis).
- PR dibuka sebagai **DRAFT**; merge hanya setelah pemilik bilang "merge dan deploy". Deploy: **cadangkan `taskflow.db`**, workflow (menjalankan `migrate_db`), lalu **restart `taskflow-web` dan bot `taskflow`**. PR B di-deploy segera setelah PR A (spec §10, §12).

## Review Focus

1. **Invarian pohon** (spec §3.3): induk selalu di task yang sama, tanpa siklus, tanpa yatim — setelah tambah, pindah, hapus berantai, dan `heal_checklists`. → T2–T4, T7.
2. **`updated_at` tidak pernah naik** karena checklist, hitung ulang, atau PUT yang hanya membawa `progress` terabaikan; PUT yang mengubah field lain tetap menaikkannya seperti biasa. → T2–T7.
3. **Kompatibilitas klien sekarang:** urutan `GET` masuk akal tanpa indentasi, toggle masih mengembalikan objek butir, `DELETE` masih `{"ok": true}`, slider di task tanpa checklist tetap tersimpan. → T5, T6, T11.
4. **Bot = web:** centang/hapus berantai berlaku sama lewat tombol bot; hitungan level atas; tampilan berindentasi aman HTML (escape tetap). → T8.
5. **Migrasi murah dan idempoten:** start kedua tidak menulis baris apa pun; data lama (semua level atas) tidak berubah urutannya. → T7.

---

### Task 1: Modul murni `checklist_tree.py` + vektor persen

**Files:**
- Create: `checklist_tree.py`, `tests/test_checklist_tree.py`, `tests/fixtures/checklist_percent_vectors.json`

**Interfaces (Produces):** `percent`, `preorder`, `descendant_ids` sesuai R1.

- [ ] **Step 1: Tulis tes gagal:** `"persen sesuai vektor bersama"` (baca JSON; sertakan 0/3→0, 1/3→33, 2/3→67, 1/8→13, 3/8→38, 1/200→1, 5/5→100, 199/200→100, 0/1→0); `"persen total 0 → None"`; `"preorder: anak tepat di bawah induk, saudara urut sort_order lalu id"`; `"preorder: depth 0/1/2 benar untuk tiga tingkat"`; `"preorder: induk yatim atau task lain → level atas"`; `"preorder: siklus a→b→a tidak macet dan semua butir muncul sekali"`; `"preorder: 2.000 tingkat tanpa RecursionError"`; `"descendant_ids: pre-order tanpa akar, cabang lain tidak ikut"`; `"descendant_ids: tahan siklus"`.
- [ ] **Step 2: FAIL** (`python -m pytest tests/test_checklist_tree.py -q`).
- [ ] **Step 3: Implementasi.** **Step 4: PASS.**
- [ ] **Step 5: Commit** `feat(checklist): modul pohon checklist murni dan vektor persen`

### Task 2: Skema, baca pre-order, hitung progress, tambah dengan induk/indeks

**Files:**
- Modify: `repository.py` (`_init_db` kolom + indeks; `ChecklistError`; `_recompute_progress`; `get_subtasks`; `add_subtask`; `get_subtask_progress`)
- Create: `tests/test_checklist_repo.py`

**Interfaces (Produces):**
- `class ChecklistError(ValueError)` dengan atribut `code`.
- `_recompute_progress(conn, task_id) -> {"done", "total", "progress"}` (R3).
- `get_subtasks(task_id) -> list[dict]` pre-order (R5).
- `add_subtask(task_id, title, client_id=None, parent_id=None, index=None) -> dict` (butir + `task_progress`); judul di-trim, kosong → `ChecklistError("EMPTY_TITLE")`; induk tidak ada / task lain → `ChecklistError("PARENT_NOT_FOUND")`; idempoten `client_id` tetap (kembalikan butir yang ada + `task_progress` terkini).
- `get_subtask_progress(task_id) -> (done, total)` level atas saja.

- [ ] **Step 1: Tulis tes gagal** (pakai `TaskRepository(webapp.DB_PATH)` + task dari `_mk`, atau INSERT langsung lewat `conftest.db()`): kolom `parent_id`, `checklist_total`, indeks `idx_subtasks_tree` ada; `TaskRepository(...)` dua kali tidak error; tambah tanpa induk → level atas di akhir; tambah dengan `parent_id` → `depth` 1 tepat di bawah induk dalam `get_subtasks`; `index=0` di antara 3 saudara → urutan & `sort_order` 0..3; `index=99` → paling akhir; induk task lain → `PARENT_NOT_FOUND`; judul `"  "` → `EMPTY_TITLE`; `client_id` sama dua kali → satu baris; progress: 1 butir level atas belum selesai → `progress` 0, `checklist_total` 1; tambah sub butir **tidak** mengubah `checklist_total`; `updated_at` task sama sebelum/sesudah; `get_subtask_progress` mengabaikan sub butir.
- [ ] **Step 2: FAIL.** **Step 3: Implementasi** (R2, R3, R6; `add_subtask` lama yang menghitung `MAX+1` per task diganti per kelompok saudara). **Step 4: PASS** + pytest penuh (tes lama `test_task_child_counts.py` masih hijau karena belum ada sub butir di sana).
- [ ] **Step 5: Commit** `feat(checklist): kolom induk, urutan pre-order, dan progress otomatis di repository`

### Task 3: Repo — ubah teks dan pindah

**Files:**
- Modify: `repository.py` (`rename_subtask`, `move_subtask`), `tests/test_checklist_repo.py`

**Interfaces (Produces):**
- `rename_subtask(subtask_id, title) -> dict | None` (butir + `task_progress`; trim; kosong → `EMPTY_TITLE`; judul sama → tanpa tulis).
- `move_subtask(subtask_id, parent_id, index=None) -> {"items", "task_progress"} | None`. Validasi di dalam `write_tx`: induk tidak ada / task lain → `PARENT_NOT_FOUND`; induk = diri sendiri atau salah satu `descendant_ids` → `CYCLE`. `index` = posisi akhir di antara saudara baru setelah butir dikeluarkan; `None` = akhir; clamp atas. Nomori ulang kelompok lama dan baru. Posisi sama → tanpa tulis (tetap kembalikan `items`).

- [ ] **Step 1: Tulis tes gagal:** ubah teks (trim, kosong, sama → `updated_at`/baris tidak berubah); pindah di antara saudara (atas→bawah, bawah→atas, `index` > n); pindah ke induk lain — turunan ikut (`depth` mereka bertambah); pindah ke level atas; ke diri sendiri → `CYCLE`; ke cucu sendiri → `CYCLE`; ke butir task lain → `PARENT_NOT_FOUND`; id tidak ada → `None`; `sort_order` kelompok lama dan baru rapat 0..n−1; pindah sub butir jadi level atas menaikkan `checklist_total` dan mengubah `progress`; pindah level atas jadi sub menurunkannya; `updated_at` task tidak berubah.
- [ ] **Step 2: FAIL.** **Step 3: Implementasi.** **Step 4: PASS** + pytest penuh.
- [ ] **Step 5: Commit** `feat(checklist): ubah teks dan pindah butir beserta turunannya`

### Task 4: Repo — centang dan hapus berantai

**Files:**
- Modify: `repository.py` (`toggle_subtask`, `delete_subtask`), `tests/test_checklist_repo.py`

**Interfaces (Produces):**
- `toggle_subtask(subtask_id) -> dict | None`: menjadi selesai → butir + semua turunan `is_done = 1`; dibuka lagi → hanya butir itu. Kembalian = butir (`is_done` baru) + `changed_ids` (hanya yang nilainya berubah, termasuk butir itu) + `task_progress`.
- `delete_subtask(subtask_id) -> {"deleted_ids", "task_progress"} | None` (butir + semua turunan, satu transaksi).

- [ ] **Step 1: Tulis tes gagal:** centang induk dengan anak campuran → semua selesai, `changed_ids` tidak memuat anak yang sudah selesai sebelumnya; buka induk → anak tetap selesai; buka anak → induk tetap selesai; centang sub butir tidak mengubah `progress`; centang level atas 1 dari 3 → `progress` 33; hapus induk tiga tingkat → semua turunan hilang, cabang saudara utuh, `deleted_ids` lengkap; hapus level atas terakhir → `checklist_total` 0 dan `progress` tetap nilai terakhir (K11); id tidak ada → `None`; `updated_at` tidak berubah.
- [ ] **Step 2: FAIL.** **Step 3: Implementasi.** **Step 4: PASS** + pytest penuh.
- [ ] **Step 5: Commit** `feat(checklist): centang dan hapus berantai ke turunan`

### Task 5: API checklist, hitungan Fokus, ekspor

**Files:**
- Modify: `webapp.py` (`SubtaskCreate` + model baru `SubtaskRename`, `SubtaskMove`; endpoint `:3486–3531`; `child-counts` `:2373`; ekspor `:7530–7537`), `tests/test_task_child_counts.py`
- Create: `tests/test_checklist_api.py`

**Interfaces (Produces):** spec §4 persis:
- `SubtaskCreate {title: str (min_length=1), client_id?: str, parent_id?: int, index?: int ≥ 0}`; respons butir + `task_progress`.
- **Baru** `PATCH /api/subtasks/{id}` `SubtaskRename {title: str}` (akses tulis); respons butir + `task_progress`.
- **Baru** `POST /api/subtasks/{id}/move` `SubtaskMove {parent_id: Optional[int] (wajib ada, boleh null), index: Optional[int] = Field(None, ge=0)}` (akses tulis); respons `{items, task_progress}`.
- Toggle → butir + `changed_ids` + `task_progress`; `DELETE` → `{ok: True, deleted_ids, task_progress}`.
- `ChecklistError` → 422 dengan teks R4; butir tidak ada → 404 "Subtask not found" (teks lama); akses → 403/404 lewat `_can_access_task`.
- Notifikasi "menambah item checklist" tetap untuk tambah di tingkat mana pun; endpoint lain tanpa notifikasi.
- `child-counts`: `WHERE task_id IN (…) AND parent_id IS NULL`.
- Ekspor: urutan `preorder`, tiap butir `{title, done, depth}`.

- [ ] **Step 1: Tulis tes gagal** (helper `U`, `_mk`, `_workspace`, `_add_member` dari `test_contexts_tasks`): tambah sub butir lewat API → `GET` pre-order dengan `depth`; induk task lain → 422 teks persis; `index: -1` → 422; `PATCH` kosong → 422 teks persis, sukses → judul baru; `move` tanpa `parent_id` di body → 422; `move` ke turunan → 422 teks persis; `move` sukses → `items` pre-order; anggota workspace boleh pindah/ubah teks, orang luar 403; toggle mengembalikan `changed_ids` + `task_progress` dan **masih** punya `id`, `title`, `is_done` (bentuk lama); `DELETE` masih `ok: true`; `GET /api/tasks/{id}` memuat `progress` dan `checklist_total` baru setelah centang tanpa `updated_at` berubah; notifikasi tambah sub butir di workspace terkirim sekali (pola `test_notification_escape.py`); `child-counts` dengan 2 level atas + 3 sub → `sub_total` 2 (perbarui juga asersi lama `test_task_child_counts.py` bila menyentuh sub butir — saat ini tidak); ekspor: unzip `tasks.json` → butir berurutan dengan `depth`.
- [ ] **Step 2: FAIL.** **Step 3: Implementasi.** **Step 4: PASS** + pytest penuh (termasuk `test_notification_escape.py`, `test_task_child_counts.py`).
- [ ] **Step 5: Commit** `feat(checklist): API sub checklist, pindah, ubah teks; hitungan dan ekspor level atas`

### Task 6: `PUT /api/tasks/{id}` mengabaikan `progress` selama ada checklist (R7)

**Files:**
- Modify: `webapp.py` (`update_task` `:2590–2692`)
- Create: `tests/test_checklist_progress_put.py`

- [ ] **Step 1: Tulis tes gagal:** task tanpa checklist: `PUT {progress: 40}` → 40 (perilaku lama); task dengan checklist 1/2: `PUT {progress: 90}` → 200, `progress` tetap 50, `updated_at` **tidak** berubah, tanpa notifikasi workspace (hitung baris `notifications` sebelum/sesudah); `PUT {progress: 90, title: "baru"}` → judul berubah, `progress` 50, `updated_at` naik (normal); payload penuh gaya `syncpush` (semua field sama dengan baris + `progress` lama) → `progress` tidak ditimpa; `PUT {}` tetap 400 "No fields to update"; `base_rev` basi tetap 409 sebelum aturan ini; hapus semua butir level atas lalu `PUT {progress: 10}` → 10.
- [ ] **Step 2: FAIL.** **Step 3: Implementasi** (R7; jangan ubah urutan `_check_base_rev`). **Step 4: PASS** + pytest penuh (perhatikan `test_task_core_time.py`, `test_task_update_notify_coalesce.py`, `test_task_ext.py`).
- [ ] **Step 5: Commit** `feat(task): progress task bercheklist hanya dari checklist`

### Task 7: `migrate_db` — `heal_checklists` (R8)

**Files:**
- Modify: `checklist_tree.py` (`recompute_all(conn)`), `repository.py` (`TaskRepository.heal_checklists()` memakai `checklist_tree.recompute_all`), `webapp.py` (`migrate_db` `:350`)
- Create: `tests/test_checklist_migrate.py`

- [ ] **Step 1: Tulis tes gagal** (siapkan baris langsung lewat `conftest.db()` untuk meniru data lama): task lama dengan 3 butir (1 selesai) dan `progress` manual 80 → setelah `migrate_db()` 33 dan `checklist_total` 3; task tanpa checklist dengan `progress` 70 → tetap 70; butir dengan `parent_id` menunjuk id tidak ada / butir task lain → `NULL`; siklus buatan dua butir → keduanya terlihat oleh `get_subtasks` dan dihitung konsisten; `updated_at` semua task tidak berubah; `migrate_db()` kedua → `heal_checklists()` mengembalikan `{"orphans": 0, "recomputed": 0}` (tidak ada baris ditulis — cek `total_changes` atau `updated` kolom bantu); task dengan `checklist_total` 2 tetapi semua butir dihapus langsung di DB → `checklist_total` 0, `progress` tetap.
- [ ] **Step 2: FAIL.** **Step 3: Implementasi.** **Step 4: PASS** + pytest penuh + asap `python -c "import webapp; webapp.migrate_db(); webapp.migrate_db()"` pada salinan DB tes.
- [ ] **Step 5: Commit** `feat(checklist): pembersihan induk yatim dan hitung ulang progress saat start`

### Task 8: Bot Telegram (R9)

**Files:**
- Modify: `bot.py` (`_build_view_message`, `_build_view_buttons`, callback `delsub_mode_`, `cmd_sub` hitungan)
- Create: `tests/test_bot_checklist.py`; pastikan `tests/test_bot_escape.py` tetap hijau

**Interfaces (Produces):** `_checklist_lines(subtasks) -> str`, `_checklist_toggle_rows(subtasks, task_id) -> list[list[InlineKeyboardButton]]`, `_delsub_buttons(subtasks, task_id) -> list[list[InlineKeyboardButton]]`.

- [ ] **Step 1: Tulis tes gagal:** pesan `/view` dengan 2 level atas (1 selesai) + 2 sub (selesai semua) → judul `1/2`; baris sub butir diawali `"  ↳ "` (tingkat 1) dan `"    ↳ "` (tingkat 2); escape HTML tetap (`<x>` tidak muncul); dict tanpa `depth` (bentuk tes lama) dianggap tingkat 0; label tombol centang sub butir diawali `"↳ "` dan `callback_data` tetap `togsub_<id>_<task>`; tombol hapus butir dengan 3 turunan berakhiran `" (+3 sub)"`, `callback_data` tetap `delsub_<id>_<task>`; `/sub` menampilkan hitungan level atas.
- [ ] **Step 2: FAIL.** **Step 3: Implementasi** (helper murni; callback memakai helper; perilaku centang/hapus berantai datang dari repository). **Step 4: PASS** + pytest penuh + `python -c "import bot"`.
- [ ] **Step 5: Commit** `feat(bot): checklist bertingkat di /view, tombol centang, dan hapus`

### Task 9: `merge_db.py` (R10)

**Files:**
- Modify: `merge_db.py` (blok subtasks `:108–121`)
- Create: `tests/test_merge_db_checklist.py`

- [ ] **Step 1: Tulis tes gagal:** buat DB backup dan DB tujuan sementara dengan skema lewat `TaskRepository(path)` + tabel `users` (cek kolom minimal yang dibaca skrip); backup berisi task dengan 3 tingkat checklist; jalankan `subprocess.run([sys.executable, "merge_db.py", backup, current, "--apply"], cwd=repo)` → di tujuan butir anak menunjuk id **baru** induknya, urutan pre-order sama, `progress`/`checklist_total` task tujuan sesuai level atas; backup lama tanpa kolom `parent_id` (buat tabel `subtasks` versi lama secara manual) → semua butir level atas tanpa galat; dry-run tidak menulis apa pun.
- [ ] **Step 2: FAIL.** **Step 3: Implementasi.** **Step 4: PASS** + pytest penuh.
- [ ] **Step 5: Commit** `fix(merge-db): salin induk checklist dengan id baru`

### Task 10: ADR-048 dan catatan spec

**Files:**
- Modify: `.agents/DECISIONS.md`, `docs/superpowers/specs/2026-11-06-checklist-bertingkat-design.md` (bagian baru "Catatan implementasi PR A" di akhir: penyimpangan dari spec bila ada, angka tes)

- [ ] **Step 1:** ADR-048 "Checklist bertingkat: progress dan `checklist_total` sebagai field turunan server" — Context (spec K1, K2, K15, D2, D3; konflik sinkron bila centang menaikkan `updated_at`; `syncpush` selalu mengirim `progress`); Decision (R2, R3, R7, R8); Consequences (jendela PR A → PR B spec §10, K17 Timeline, rollback: revert PR A sebagai rilis baru — kolom baru dibiarkan, `parent_id` dibiarkan; klien sekarang menampilkan semua butir datar berurutan pre-order).
- [ ] **Step 2: Commit** `docs(checklist): ADR-048 field turunan progress checklist`

### Task 11: E2E — klien sekarang + server baru (jendela PR A → PR B)

**Files:**
- Create: `temporary_files/e2e_checklist_pr_a.py` (pola server lokal `uvicorn webapp:app` + DB sementara seperti `e2e_plugin_fase1_1d0.py`; `E2E_PYTHON=$(which python3) TZ=Asia/Jakarta`)

**Skenario minimum:**
1. **Detail task (UI sekarang):** tambah 3 butir di tab Checklist → "Checklist (3)", bar `0/3`; centang satu → pill Progress task menjadi 33% setelah sinkron/muat ulang daftar.
2. **Sub butir dari API** (`POST … {parent_id}`) → UI sekarang menampilkan butir anak tepat di bawah induk (tanpa indentasi), tanpa galat konsol.
3. **Slider lama pada task bercheklist** (dikoreksi setelah review T5–T7): geser ke 80 → tidak ada bilah "gagal disinkronkan"; server tetap angka checklist; perangkat itu tetap menampilkan 80 (residual jendela PR A → PR B, ADR-048); perangkat lain (atau muat ulang dari server bersih) menampilkan angka checklist.
4. **Slider pada task tanpa checklist:** 40 tersimpan seperti biasa.
5. **Halaman Fokus:** badge menghitung level atas saja.
6. **Regresi:** `e2e_detail_redesign.py` (kelompok `tabs`, B-3), `e2e_live_edit.py`, `e2e_task_detail_body.py`, `e2e_focus_page.py` — kegagalan pra-ada dicatat dengan bukti di `main` bersih.

- [ ] **Step 1:** tulis skrip + jalankan (catat N/N). **Step 2:** jalankan regresi. **Step 3: Commit** `test(e2e): klien sekarang tetap berjalan dengan server checklist bertingkat`

### Task 12: Verifikasi akhir, handover, review akhir, PR draft

- [ ] **Step 1: Verifikasi akhir:** pytest penuh; `npm test` penuh (harus sama dengan basis — tidak ada perubahan JS); `python -c "import webapp, bot"`; `migrate_db` dua kali pada DB tes; `git diff origin/main --stat -- static/` **kosong**; simulasi CI tanpa `node_modules` bila pola PR sebelumnya memakainya.
- [ ] **Step 2: Dokumen:** catatan implementasi PR A di spec (T10) dengan angka akhir; handover `.agents/CURRENT_STATE.md` + `.agents/SESSION_LOG.md`; commit `docs(agents): handover PR A checklist bertingkat`.
- [ ] **Step 3: Review akhir** seluruh branch oleh reviewer terpisah (Review Focus 1–5). Perbaiki temuan wajib, ulangi Step 1.
- [ ] **Step 4:** push branch `claude/checklist-bertingkat-server` + PR **DRAFT** "Checklist bertingkat — PR A: server" — badan: ringkasan, tabel endpoint, tabel file, **deploy = cadangkan `taskflow.db` → workflow → restart `taskflow-web` dan bot `taskflow`**, verifikasi pasca-deploy (`GET /api/tasks/{id}/subtasks` memuat `depth`; `POST …/move` → 200; `systemctl show -p ActiveEnterTimestamp taskflow-web` lebih baru dari deploy; task lama bercheklist menampilkan persen sesuai checklist), catatan jendela PR A → PR B (spec §10), rollback (ADR-048), angka tes/E2E. Merge hanya atas "merge dan deploy".

---

## Keputusan untuk pemilik

Tidak ada pertanyaan baru: semua keputusan yang memengaruhi pengguna sudah diputuskan di spec (K1–K17). Catatan yang disahkan rencana ini: istilah di bot tetap "Subtasks" (seperti sekarang) supaya PR A tidak mengubah teks yang dilihat pengguna bot; penyelarasan istilah bot dengan "Checklist" bisa ikut PR B bila diinginkan.
