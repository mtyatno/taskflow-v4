# Rencana: project sebagai entitas (pribadi / workspace) — PR 4, backend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Tanggal: 2026-10-19 · Agent: Claude · Branch: `claude/project-entities-backend` · Backend saja, **tanpa** kenaikan versi SW

**Goal:** Tabel `projects` dengan scope pribadi atau satu workspace; setiap task menunjuk project lewat `project_id` (teks `tasks.project` tetap terisi nama); API kelola project dengan hak kelola opsi C; bot memakai project pribadi.

**Architecture:** Skema + backfill idempoten di `repository.py`, dipanggil dari `webapp.migrate_db()`. Satu helper resolusi (`resolve_task_project`) dipakai semua jalur tulis task (webapp + repository/bot). API baru di `webapp.py`. Frontend (dropdown per scope, cache offline) = PR 5.

**Tech Stack:** Python 3, FastAPI, SQLite, pytest (`tests/conftest.py`).

**Spec:** `docs/superpowers/specs/2026-10-18-workspace-drawing-project-design.md` §5 (§5.1–5.5, §5.8; §5.2 = opsi C).

## Global Constraints

- Hanya `webapp.py`, `repository.py`, dan tes yang berubah. Tidak ada perubahan `static/`, `bot.py`, atau versi SW.
- Skema persis spec §5.1: tabel `projects(id, name, user_id, list_id, color, archived, created_by, created_at, updated_at)` dengan `CHECK ((user_id IS NULL) <> (list_id IS NULL))`, `user_id → users ON DELETE CASCADE`, `list_id → shared_lists ON DELETE CASCADE`, `created_by → users ON DELETE SET NULL`; index unik parsial `ux_projects_user(user_id, name COLLATE NOCASE) WHERE list_id IS NULL` dan `ux_projects_list(list_id, name COLLATE NOCASE) WHERE list_id IS NOT NULL`; `tasks.project_id INTEGER DEFAULT NULL REFERENCES projects(id) ON DELETE SET NULL` + `idx_tasks_project_id`.
- Nama project selalu di-`strip()`; nama kosong = tanpa project. Pencocokan nama: case-insensitive (NOCASE).
- Invarian: `tasks.project_id` terisi ⇔ `tasks.project` = `projects.name` project itu; `project_id` NULL ⇔ `project` = `''` (kecuali task lama yang belum dijangkau backfill).
- **Scope task:** `tasks.list_id` menunjuk `shared_lists` yang ada → workspace itu; selain itu → pribadi milik `tasks.user_id` (pemilik task, bukan aktor).
- Hak kelola (opsi C): lihat/pakai/buat = pemilik (pribadi) atau owner/anggota W (workspace). Rename/warna/arsip/hapus = pemilik (pribadi); `created_by` atau owner W (workspace).
- `GET /api/projects` tanpa parameter tetap mengembalikan `string[]` (nama project pribadi yang tidak diarsip, urut nama NOCASE). Klien lama tidak boleh rusak.
- Penolakan akses: 404 `"Project tidak ditemukan"` bila tidak bisa melihat; 403 `"Hanya pembuat project atau owner workspace"` bila bisa melihat tapi tidak boleh mengelola; `project_id` di luar scope task → 400 `"Project tidak berada di scope task"`; rename bentrok → 409 `"Nama project sudah dipakai"`.
- Deploy: `migrate_db()` dijalankan workflow; restart **`taskflow-web` dan `taskflow` (bot)** karena `repository.py` berubah.
- Commit diakhiri trailer atribusi harness pelaksana. Jangan push. Tes: `python3 -m pytest tests -q`.

## Review Focus

1. **Nama beda kapital/spasi** (`"Taskflow"`, `"taskflow "`) di scope sama → satu project; di scope berbeda (pribadi vs W) → dua project. Tes: Task 1 (backfill), Task 2 (resolusi).
2. **Task di workspace yang sudah dihapus** (`list_id` menunjuk list yang tidak ada) → diperlakukan pribadi milik pemilik task. Tes: Task 1 dan Task 2.
3. **Klien lama yang hanya mengirim teks `project`** (APK, outbox offline) → tetap jalan, `project_id` terisi otomatis. Tes: Task 2.
4. **Anggota W mengedit task W milik anggota lain** → project di-resolve di scope W, bukan pribadi si pengedit; `created_by` = pengedit bila project baru. Tes: Task 2.
5. **Backfill dijalankan dua kali / setelah task baru ditulis kode lama** → tidak ada duplikat, task baru ikut terisi. Tes: Task 1.

---

### Task 1 — Skema dan backfill

**Files:**
- Modify: `repository.py` (fungsi modul baru + panggilan skema di `_init_db`)
- Modify: `webapp.py` (`migrate_db`: panggil backfill sebelum `_heal_broken_triggers`)
- Create: `tests/test_projects_schema.py`

**Interfaces (Produces):**
- `ensure_projects_schema(conn) -> None`: DDL di Global Constraints, idempoten (`IF NOT EXISTS`, cek `PRAGMA table_info(tasks)` sebelum `ALTER`).
- `backfill_projects(conn) -> dict`: memproses task dengan `project` (setelah strip) tidak kosong dan `project_id IS NULL`; mengembalikan `{"created": n, "linked": m}`.

Aturan backfill (spec §5.5):
- Scope per aturan "Scope task". Grup = (scope, nama NOCASE). Project yang sudah ada di scope dipakai ulang; kalau belum ada, dibuat dengan ejaan dari task di grup dengan `updated_at` terbaru, `created_by` = `user_id` task tertua (`created_at`) di grup (untuk pribadi: pemiliknya).
- Project yang **dibuat oleh backfill ini** dan tidak punya task aktif (`gtd_status NOT IN ('done','archived')`) → `archived = 1`. Project yang sudah ada tidak diubah status arsipnya.
- Isi `tasks.project_id`; bila teks berbeda dari `projects.name` (kapital/spasi), teks diganti ke nama kanonis **tanpa** mengubah `updated_at` (ini bukan edit pengguna; prinsip 6 ADR-006).

- [ ] **Step 1: Tes gagal** — `test_backfill_groups_by_scope_and_case`, `test_backfill_archives_projects_without_active_tasks`, `test_backfill_deleted_workspace_is_personal`, `test_backfill_idempotent_and_picks_up_new_tasks`, `test_schema_constraints` (CHECK menolak kedua pemilik/tanpa pemilik; unik NOCASE per scope; hapus workspace → project terhapus dan `tasks.project_id` NULL). Data disisipkan langsung via `conftest.db()` (task dengan `project_id` NULL), lalu panggil `repository.backfill_projects(conn)`.
- [ ] **Step 2:** `python3 -m pytest tests/test_projects_schema.py -q` → FAIL (fungsi belum ada).
- [ ] **Step 3:** Implementasi.
- [ ] **Step 4:** Tes file ini lalu suite penuh → PASS.
- [ ] **Step 5:** Commit `feat(projects): tabel projects + backfill dari tasks.project`.

### Task 2 — Resolusi project di semua jalur tulis task

**Files:**
- Modify: `repository.py` (`add`, `add_to_list`, `update` memanggil resolusi)
- Modify: `webapp.py` (`TaskCreate`/`TaskUpdate` + `project_id: Optional[int]`; `create_task`, `update_task`, pewarisan subtask)
- Create: `tests/test_projects_tasks.py`

**Interfaces:**
- Consumes: `ensure_projects_schema` (Task 1).
- Produces: `resolve_task_project(conn, *, owner_id: int, list_id: Optional[int], name: Optional[str], project_id: Optional[int], actor_id: int) -> tuple[Optional[int], str]` di `repository.py`. Melempar `ProjectScopeError(ValueError)` bila `project_id` tidak ada atau di luar scope.
  - `project_id` diberikan → harus ada di scope; hasil `(id, projects.name)`; bila diarsip → diaktifkan lagi.
  - Hanya `name` (non-kosong setelah strip) → cari NOCASE di scope (termasuk arsip → diaktifkan lagi), kalau tidak ada buat baru (`created_by = actor_id`); hasil `(id, name kanonis)`.
  - `name` kosong dan `project_id` None → `(None, "")`.
- `create_task`: pewarisan subtask sekarang juga mewarisi `project_id` parent bila klien tidak mengirim `project`/`project_id`. Resolusi memakai scope task baru (`list_id` setelah pewarisan).
- `update_task`: resolusi hanya bila `project` atau `project_id` ada di payload (`model_fields_set`); scope dari baris task yang ada (pemilik + `list_id`); `ProjectScopeError` → 400 (Global Constraints).
- Respons task (`task_row_to_dict`) memuat `project_id` (sudah otomatis lewat `SELECT *`).

- [ ] **Step 1: Tes gagal** — via API: buat task pribadi dengan teks project → `project_id` terisi dan project pribadi tercipta; task di W dengan nama yang sama → project W berbeda; nama beda kapital → project sama, teks kanonis; `project_id` milik scope lain → 400; PUT `project=""` → keduanya kosong; PUT hanya `project_id` → teks ikut; anggota B mengedit task W milik A dengan nama baru → project di W dengan `created_by = B`; subtask mewarisi `project_id` parent; project arsip diaktifkan lagi saat dipakai; jalur repository (`repo.add(task, user_id)` dan `repo.update(task)` seperti bot) mengisi `project_id`.
- [ ] **Step 2:** `python3 -m pytest tests/test_projects_tasks.py -q` → FAIL.
- [ ] **Step 3:** Implementasi.
- [ ] **Step 4:** Tes file ini, `tests/test_sync_audit_server.py`, lalu suite penuh → PASS.
- [ ] **Step 5:** Commit `feat(projects): task menunjuk project lewat project_id (resolusi per scope)`.

### Task 3 — API project dan pembaca lama

**Files:**
- Modify: `webapp.py` (ganti `GET /api/projects`; tambah `POST /api/projects`, `PATCH /api/projects/{id}`, `DELETE /api/projects/{id}`)
- Modify: `repository.py` (`list_projects` membaca tabel `projects`)
- Create: `tests/test_projects_api.py`

**Interfaces:**
- Consumes: `resolve_task_project` (Task 2) untuk `POST`.
- `GET /api/projects` → `string[]` pribadi (Global Constraints). `?list_id=W` → `string[]` project W tidak diarsip (bukan anggota → 403 `"Kamu bukan anggota list ini"`). `?format=full` (+ opsional `list_id`, `include_archived=1`) → `[{id, name, list_id, user_id, color, archived, created_by, active_task_count, can_manage}]`.
- `POST /api/projects {name, list_id?}` → objek format full (resolve-or-create; arsip diaktifkan lagi; nama kosong → 400).
- `PATCH /api/projects/{id} {name?, color?, archived?}` → objek format full. Rename: satu transaksi, `tasks.project` + `updated_at` semua task dengan `project_id` itu ikut berubah.
- `DELETE /api/projects/{id}` → `{"ok": true, "tasks_cleared": n}`; task terkait `project_id = NULL`, `project = ''`, `updated_at` di-bump, lalu baris project dihapus.
- `repository.list_projects(user_id)` → nama project pribadi milik `user_id` yang tidak diarsip (bot `/projects` dan review mingguan bot). `list_by_project` tidak berubah.

- [ ] **Step 1: Tes gagal** — matriks hak (pemilik pribadi; owner W; anggota pembuat; anggota bukan pembuat → 403 untuk PATCH/DELETE tapi boleh POST/GET; bukan anggota → 403 list / 404 project), `GET /api/projects` tetap `string[]` dan hanya pribadi, project tanpa task aktif tetap tampil (tidak hilang seperti dulu), rename menyebar ke task + 409 bentrok NOCASE, arsip menyembunyikan dari daftar default, delete mengosongkan task, `active_task_count`, `can_manage`, `repo.list_projects`.
- [ ] **Step 2:** `python3 -m pytest tests/test_projects_api.py -q` → FAIL.
- [ ] **Step 3:** Implementasi.
- [ ] **Step 4:** Tes file ini lalu suite penuh → PASS.
- [ ] **Step 5:** Commit `feat(projects): API kelola project (opsi C) + list_projects bot`.

## Catatan untuk PR 5 (frontend, bukan bagian PR ini)

Sampai PR 5, form task masih memakai `GET /api/projects` (daftar pribadi) untuk semua task; mengetik nama di task workspace tetap benar karena server me-resolve di scope W. PR 5: dropdown per scope (`?list_id=`), kirim `project_id`, cache offline per scope, pengelolaan project, badge workspace.
