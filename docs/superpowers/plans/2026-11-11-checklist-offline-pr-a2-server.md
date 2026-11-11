# Checklist offline (Fase 2) — PR A2 (server) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** server menyediakan semua yang dibutuhkan checklist local-first (PR B2): versi checklist per task (`tasks.checklist_rev`, field turunan tanpa `updated_at`), unduhan banyak checklist sekaligus (`GET /api/checklists`), centang yang aman diulang (`PATCH /api/subtasks/{id} {is_done}`), dan idempotensi tambah per task. Tanpa perubahan tampilan; aplikasi v502 tetap berjalan.

**Architecture:** semua aturan di `TaskRepository` (dipakai web dan bot). Helper baru `_bump_rev(conn, task_id)` dipanggil di transaksi tulis yang sama dengan operasi checklist, mengikuti aturan spec E2 (naik tepat 1 per transaksi yang mengubah sesuatu; pemulihan pohon yang mengubah sesuatu naik 1 tersendiri). `_recompute_progress` mengembalikan `rev` di `task_progress`. Endpoint batch hanya baca.

**Tech Stack:** FastAPI + pydantic 2, SQLite (`dbconn.write_tx`), pytest (`tests/conftest.py`, helper `tests/test_contexts_tasks.py`), E2E Playwright (`temporary_files/e2e_checklist_tree.py` sebagai regresi klien v502).

**Spec:** `docs/superpowers/specs/2026-11-11-checklist-offline-fase2-design.md` — §2 (F1–F7, E1–E7), **§3 Server**, §5, §6 (pytest), §7 (PR A2). Disetujui pemilik 2026-11-11. Fase 1: ADR-048.

**Basis kode:** `main` @ `155ee07` (SW v502; ADR terakhir ADR-049; ADR-050 dipesan rencana 1d-2 → PR ini memakai **ADR-051**).

## Fakta hasil eksplorasi (titik sentuh)

| Lapisan | Lokasi | Keadaan sekarang |
|---|---|---|
| Kolom task | `_init_db` migrasi `checklist_total` `repository.py:1012` | tanpa `checklist_rev` |
| Progress | `_recompute_progress(conn, task_id)` `:631` → `{done, total, progress}` | tanpa `rev` |
| Pemulihan | `_heal_task_tree(conn, task_id) -> int` `:654` (dipanggil di awal setiap operasi tulis), `_heal_for_subtask` `:679`, `heal_checklists()` `:1273` (dari `webapp.migrate_db` `:354`) | tidak menaikkan versi |
| Operasi | `add_subtask` `:1650` (idempotensi `client_id` GLOBAL `:1662`; **ada** indeks unik global `idx_subtasks_client_id` — dikoreksi saat eksekusi, lihat catatan implementasi spec), `get_subtasks` `:1685`, `rename_subtask` `:1690`, `move_subtask` `:1704`, `toggle_subtask` `:1747`, `delete_subtask` `:1769`; `_subtask_with_progress` | – |
| API | `_CHECKLIST_ERRORS` `webapp.py:3516`; `SubtaskRename {title}` `:3506`; `GET /api/tasks/{id}/subtasks` `:3536`; `PATCH /api/subtasks/{id}` `:3563` (judul saja); toggle `:3587`; batas batch pola `child-counts` (`CHILD_COUNTS_MAX_*` `:2328–2356`) | tanpa batch checklist, tanpa set centang |
| Hitung ulang | `checklist_tree.recompute_all(conn)` `checklist_tree.py:103` | tidak menyentuh rev (tetap) |
| Serialisasi task | `task_row_to_dict` = `dict(row)` | kolom baru otomatis ikut |
| Bot | memakai `toggle_subtask`/`delete_subtask`/`add_subtask` | rev ikut naik tanpa perubahan bot |

## Keputusan rencana (controller)

- **R1 — `_bump_rev(conn, task_id, n=1)`** (fungsi modul): `UPDATE tasks SET checklist_rev = COALESCE(checklist_rev, 0) + ? WHERE id = ?`, tanpa `updated_at`. Aturan per operasi:
  - `healed = _heal_task_tree(...)`; bila `healed > 0` → `_bump_rev` 1 (tersendiri, E2).
  - Lalu operasinya; bila mengubah sesuatu → `_bump_rev` 1: `add` (butir baru; **bukan** saat `client_id` sudah ada), `rename` (judul berbeda), `move` (posisi berubah), `toggle` (selalu), `set_done` (`changed_ids` tidak kosong), `delete` (butir ada).
  - `_recompute_progress` dipanggil SESUDAH bump; mengembalikan `rev` = nilai kolom terkini (`progress: None` bila task tidak ada → `rev: None`).
- **R2 — `update_subtask(subtask_id, title=None, is_done=None)`** (baru, satu `write_tx`): validasi `title` (trim; kosong → `EMPTY_TITLE`), terapkan judul lalu centang (`True` → butir + turunan; `False` → butir saja), **satu** bump bila ada yang berubah. Kembalian = butir + `changed_ids` (id yang `is_done`-nya berubah; kosong untuk judul saja) + `task_progress`; `None` bila butir tidak ada. `rename_subtask` dan `toggle_subtask` tetap (dipakai bot/tes), dengan bump R1. `ChecklistError("NO_CHANGE")` bila kedua argumen None.
- **R3 — Idempotensi per task:** `SELECT … WHERE client_id = ? AND task_id = ?`.
- **R4 — `heal_checklists()`** menaikkan rev 1 untuk setiap task yang dipulihkan, dan (langkah baru, satu transaksi) `UPDATE tasks SET checklist_rev = 1 WHERE COALESCE(checklist_rev, 0) = 0 AND id IN (SELECT DISTINCT task_id FROM subtasks)`. Kembalian ditambah `"rev_init": n`. Idempoten (start kedua `{orphans: 0, recomputed: 0, rev_init: 0}`).
- **R5 — `get_checklists(task_ids) -> dict[int, {"rev", "items"}]`** di repository (baca saja, `_subtask_items` per task, satu koneksi). Webapp: `GET /api/checklists?task_ids=…` — parse seperti `child-counts` (string kosong → `{}`; panjang > batas karakter atau > **200** id → 400 "Maksimal 200 id task per request"; id bukan angka → 400 "task_ids tidak valid"), akses per task dengan `_can_access_task` (gagal → dilewati), kunci respons berupa string id.
- **R6 — `PATCH /api/subtasks/{id}`**: model `SubtaskPatch {title: Optional[str] = None, is_done: Optional[bool] = None}` (gantikan `SubtaskRename`); keduanya None → 422 "Tidak ada perubahan" (`_CHECKLIST_ERRORS["NO_CHANGE"]`); akses tulis seperti sekarang; tanpa notifikasi.
- **R7 — ADR-051** "Checklist Fase 2: `checklist_rev` sebagai field turunan dan centang set" (Context F5/E1–E4; Decision R1–R6; Consequences: klien B2 memakai `TASK_DERIVED` + batch; v502 tidak terpengaruh; rollback = revert, kolom dibiarkan).
- **R8 — Tanpa perubahan `static/**`** → tanpa SW bump/whatsnew.

## Global Constraints

- Komentar dan nama tes berbahasa Indonesia; TDD; commit per tugas dengan trailer atribusi sesi; push hanya di tugas terakhir.
- Tidak ada operasi checklist yang menulis `tasks.updated_at` (uji setiap tugas). Skema baru hanya `tasks.checklist_rev`.
- Teks galat persis: "Tidak ada perubahan", "Maksimal 200 id task per request", "task_ids tidak valid" + teks Fase 1.
- Verifikasi standar: `python3 -m pytest tests/ -q -p no:cacheprovider` (basis diukur di awal), `python3 -c "import webapp, bot"`.
- PR DRAFT; merge hanya atas "merge dan deploy". Deploy: **cadangkan `taskflow.db` sebelum merge**, workflow, lalu `sudo systemctl restart taskflow taskflow-web`.

## Review Focus

1. **Rev tepat:** naik tepat 1 per transaksi yang mengubah (termasuk berantai), 0 untuk no-op, +1 tersendiri untuk pemulihan; bot ikut; `updated_at` tidak pernah naik.
2. **Kompatibilitas:** respons lama tetap memuat field lama; toggle tetap; `PATCH {title}` tetap bekerja untuk v502; `child-counts`/ekspor/bot tidak berubah.
3. **Batch aman:** batas, validasi, akses per task (tidak membocorkan checklist task orang lain), biaya kueri wajar untuk 200 task.
4. **Migrasi:** rev awal untuk task lama, idempoten, murah.

---

### Task 1: `checklist_rev` + aturan naik + `task_progress.rev`

**Files:** Modify `repository.py`; Create `tests/test_checklist_rev.py`.
- [ ] **Step 1: Tes gagal** — kolom ada, `_init_db` berulang aman; tambah → +1; tambah dengan `client_id` yang sudah ada → +0; ubah teks sama → +0, berbeda → +1; pindah posisi sama → +0, berubah → +1; toggle → +1; centang induk berantai 3 tingkat → +1; hapus berantai → +1; data yatim + operasi → +2 (pemulihan tersendiri); `task_progress.rev` = kolom; `updated_at` tidak berubah di semua kasus; pemanggilan dari jalur bot (`toggle_subtask`/`delete_subtask`) ikut menaikkan.
- [ ] **Step 2–4** (FAIL → implementasi R1 → PASS + pytest penuh). **Step 5: Commit** `feat(checklist): versi checklist per task tanpa updated_at`

### Task 2: `update_subtask` (judul/centang set) + idempotensi per task + `heal_checklists` rev

**Files:** Modify `repository.py`; `tests/test_checklist_rev.py`, `tests/test_checklist_repo.py`, `tests/test_checklist_migrate.py`.
- [ ] **Step 1: Tes gagal** — R2 (set true berantai, set true dua kali → kedua tanpa perubahan dan rev tetap, set false hanya butir, judul + centang satu bump, `NO_CHANGE`, `EMPTY_TITLE`, id tidak ada → None); R3 (`client_id` sama di task lain → butir baru di task ini, di task sama → butir lama); R4 (pemulihan per task +1, rev awal 1 untuk task lama bercheklist, task tanpa butir tetap 0, start kedua nol).
- [ ] **Step 2–4. Step 5: Commit** `feat(checklist): centang set yang aman diulang, client_id per task, versi awal saat migrasi`

### Task 3: API — `PATCH {is_done}`, `GET /api/checklists`, `rev` di respons

**Files:** Modify `webapp.py`; Create `tests/test_checklist_offline_api.py`.
- [ ] **Step 1: Tes gagal** — `PATCH {is_done: true}` → `changed_ids` berantai + `task_progress.rev`; diulang → 200 tanpa perubahan; `PATCH {}` → 422 "Tidak ada perubahan"; `PATCH {title}` bentuk lama tetap; orang luar 403; batch: dua task milik sendiri + satu task orang lain + satu id tak ada → hanya dua kunci; 201 id → 400 teks persis; `task_ids=a,1` → 400; kosong → `{}`; `items` sama dengan `GET …/subtasks`; anggota workspace bisa membaca checklist task workspace; semua respons tulis (`POST`, `PATCH`, `move`, toggle, `DELETE`) memuat `task_progress.rev`; `GET /api/tasks/{id}` memuat `checklist_rev`.
- [ ] **Step 2–4. Step 5: Commit** `feat(checklist): API unduhan checklist dan centang set`

### Task 4: ADR, regresi klien v502, handover, review akhir, PR draft

- [ ] ADR-051 (R7) + catatan implementasi PR A2 di akhir spec Fase 2.
- [ ] Regresi klien v502: `E2E_PYTHON=$(which python3) TZ=Asia/Jakarta python3 temporary_files/e2e_checklist_tree.py` (harus 152/152) + `tests/test_checklist_*` Fase 1 tetap hijau.
- [ ] Review akhir seluruh branch oleh reviewer terpisah (Review Focus 1–4).
- [ ] `.agents/CURRENT_STATE.md` + `SESSION_LOG.md`; push; PR **DRAFT** "Checklist offline (Fase 2) — PR A2: server" dengan langkah deploy (backup → merge → restart) dan verifikasi pasca-deploy (`GET /api/checklists?task_ids=<id>` memuat `rev`; `PATCH {is_done}` → 200).

## Keputusan untuk pemilik

Tidak ada — semua sudah diputuskan di spec Fase 2 (F1–F7).
