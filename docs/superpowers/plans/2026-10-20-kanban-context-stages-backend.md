# Kanban Tahap Kustom — PR Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Context menjadi entitas berscope (pribadi / workspace) dengan urutan, sehingga tahap Kanban bisa disiapkan tanpa task; semua jalur tulis task (web + bot) mengikat `tasks.context_id`.

**Architecture:** Meniru Project PR 4 (ADR-010): tabel `contexts` + `tasks.context_id`, backfill idempoten di `migrate_db()`, satu resolver `resolve_task_context` di `repository.py` yang dipakai `TaskRepository` (bot) dan `webapp.py`, plus API `/api/contexts`. Teks `tasks.context` tetap diisi nama sehingga pembaca lama tidak berubah. Tanpa frontend dan tanpa kenaikan SW.

**Tech Stack:** Python 3, FastAPI, SQLite (`sqlite3`), pytest + Starlette `TestClient`.

**Spec:** `docs/superpowers/specs/2026-10-19-kanban-context-stages-design.md` — §4 (model data), §5 (resolusi), §6 (API), §9 (bot), §10 (error), §11 (pytest), §12 butir 1. Baca bersama rencana ini.

**Branch:** `claude/kanban-stages-backend` dari `main` (≥ `bac8f5d`). Baseline: `python -m pytest tests/ -q` → 556 passed.

## Global Constraints

- Skema idempoten; `migrate_db()` boleh jalan berkali-kali. Data rusak tidak boleh menggagalkan migrasi (SAVEPOINT per grup + `_log.warning`).
- `GET /api/contexts` tanpa parameter tetap mengembalikan `string[]` context pribadi (kompat APK & cache SW).
- Teks `tasks.context` selalu sama dengan `contexts.name` bila `context_id` terisi. Nama disimpan sudah di-`strip()`; awalan `@` (gaya bot, mis. `@phone`) **tidak** dibuang.
- Pembanding nama = NOCASE SQLite (hanya A–Z dilipat), pakai `repository._nocase`.
- Urutan context = `ORDER BY position, name COLLATE NOCASE, id`. Context baru (resolver/POST/bot) → `position = MAX(position)+1` di scope (0 bila kosong).
- Hak kelola (opsi C): pribadi = pemilik; workspace = `created_by` atau owner W. Semua anggota W boleh membuat dan memakai.
- Penolakan akses API context (bukan anggota, atau tidak boleh kelola) = **404** `"Tahap tidak ditemukan"`.
- Kode error 409 memakai `detail={"code": ..., "message": ...}`: `CONTEXT_NAME_TAKEN` ("Nama tahap sudah dipakai"), `CONTEXT_ORDER_STALE` ("Urutan tahap sudah berubah, muat ulang").
- Waktu `created_at`/`updated_at` = `datetime.now().isoformat()` (sama dengan projects).
- Rename dan hapus context mem-bump `tasks.updated_at` task terkait (sync pull memakai `updated_at`). Backfill **tidak** mem-bump.
- Deploy PR ini: restart `taskflow-web` **dan** `taskflow` (bot), karena `repository.py` berubah.

## Review Focus

1. **Nama hanya beda kapital/spasi** (`"@Phone "` vs `"@phone"`): harus satu context, tanpa 409 dan tanpa baris ganda. Diuji di Task 2 (`test_resolve_nocase_and_trim_same_row`) dan Task 4 (`test_patch_rename_case_only_ok`).
2. **Task workspace diedit lewat bot/repo oleh user yang sudah keluar dari W**: tidak boleh error; jatuh ke teks saja dengan `context_id = NULL`. Diuji di Task 2 (`test_repo_update_non_member_text_only`).
3. **Edit task tanpa menyentuh context** (judul, status done) tidak boleh mengaktifkan lagi context yang diarsip atau mengganti link. Diuji di Task 2 (`test_repo_update_unchanged_context_keeps_link`) dan Task 3 (`test_put_title_only_keeps_context_link`).
4. **Perangkat basi mengirim `context_id` yang sudah dihapus**: perubahan context diabaikan, task tetap kosong, tidak 400 dan tidak membuat ulang. Diuji di Task 3 (`test_put_deleted_context_id_ignored`).
5. **Urutan dengan daftar yang tidak lengkap / berisi id scope lain / duplikat / context diarsip** → 409, posisi tidak berubah. Diuji di Task 4 (`test_order_stale_variants`).

---

### Task 1: Skema `contexts` + backfill

**Files:**
- Modify: `repository.py` (tambah setelah `backfill_projects`, ~baris 230; panggil di `TaskRepository._init_db` setelah `ensure_projects_schema(conn)` ~baris 749; di `link_telegram…` ~baris 835 dan `assign_orphan_tasks` ~baris 843 setelah `backfill_projects(conn)`)
- Modify: `webapp.py` `migrate_db()` blok "Project sebagai entitas" (~baris 857–869): panggil `repository.ensure_contexts_schema(conn)` dan `repository.backfill_contexts(conn)` setelah `backfill_projects`
- Test: `tests/test_contexts_schema.py` (fixture `conn`, `_user`, `_workspace`, `_task` seperti `tests/test_projects_schema.py`)

**Interfaces:**
- Produces: `ensure_contexts_schema(conn) -> None`; `backfill_contexts(conn) -> dict` dengan kunci `created`, `linked`, `cleared`, `skipped`. Skema persis spec §4.1 (indeks `ux_contexts_user`, `ux_contexts_list`, `idx_tasks_context_id`).

- [ ] **Step 1: Write the failing tests** di `tests/test_contexts_schema.py`:
  - `test_schema_idempotent`: panggil `ensure_contexts_schema` dua kali; `PRAGMA table_info(contexts)` memuat `position`, `color`, `archived`, `created_by`; `tasks` punya `context_id`.
  - `test_check_constraint_scope`: INSERT dengan `user_id` dan `list_id` sama-sama terisi → `sqlite3.IntegrityError`.
  - `test_unique_nocase_per_scope`: dua context pribadi `"@Home"`/`"@home"` untuk user sama → `IntegrityError`; nama sama untuk user lain dan untuk workspace → OK.
  - `test_backfill_personal_alpha_positions`: user dengan task aktif context `"b"`, `"A"`, `"c"` → context `A,b,c` dengan `position` 0,1,2; setiap task `context_id` terisi dan teks = ejaan kanonis.
  - `test_backfill_appends_after_existing`: scope sudah punya context `"Z"` di `position` 5 → context baru hasil backfill mulai di 6, urut alfabetis.
  - `test_backfill_spelling_from_newest_task`: task `"review"` (updated_at lama) dan `"Review"` (updated_at baru) → satu context `"Review"`, kedua task teksnya `"Review"`.
  - `test_backfill_archived_when_no_active`: context yang hanya dipakai task `done`/`archived` → `archived = 1`; task itu tetap ter-link.
  - `test_backfill_workspace_scope_and_created_by`: task di workspace W oleh dua user → satu context `list_id=W`, `created_by` = pembuat task tertua.
  - `test_backfill_idempotent_and_no_updated_at_bump`: jalankan dua kali → hitungan `created` kedua = 0, baris `contexts` sama, `tasks.updated_at` tidak berubah.
  - `test_backfill_fixes_stale_link`: task dengan `context_id` menunjuk context bernama lain / scope lain → di-link ulang ke context yang benar; teks kosong dengan `context_id` terisi → `context_id = NULL`.
  - `test_backfill_skips_orphans`: task tanpa user yang valid dan `list_id` tidak ada → dilewati tanpa exception.

- [ ] **Step 2: Run to verify fail**
  Run: `python -m pytest tests/test_contexts_schema.py -q`
  Expected: FAIL (`AttributeError: module 'repository' has no attribute 'ensure_contexts_schema'`)

- [ ] **Step 3: Implement `ensure_contexts_schema` dan `backfill_contexts` di `repository.py`**
  Salin struktur `ensure_projects_schema`/`backfill_projects` (join `shared_lists`/`users`/`contexts`, grup `(scope, _nocase(name))`, SAVEPOINT per grup, `clear_ids` untuk teks kosong). Perbedaan: kolom `position`; grup baru per scope diproses **urut `_nocase(nama kanonis)`** dan diberi `position = base + i` dengan `base = COALESCE(MAX(position)+1, 0)` scope itu yang dibaca sekali per scope sebelum grup pertama dibuat; UPDATE task menulis `context_id` dan `context`. Lalu panggil di empat lokasi pada bagian **Files**.

- [ ] **Step 4: Run to verify pass**
  Run: `python -m pytest tests/test_contexts_schema.py tests/test_projects_schema.py -q`
  Expected: PASS semua

- [ ] **Step 5: Commit**
  ```bash
  git add repository.py webapp.py tests/test_contexts_schema.py
  git commit -m "feat(contexts): tabel contexts + tasks.context_id + backfill idempoten"
  ```

---

### Task 2: Resolver + jalur `TaskRepository` (bot)

**Files:**
- Modify: `repository.py` — resolver di dekat `resolve_task_project`; `TaskRepository.add` (~baris 857), `update` (~baris 895), `add_to_list` (~baris 1431), `list_contexts` (~baris 1039)
- Test: `tests/test_contexts_repo.py`

**Interfaces:**
- Consumes: skema Task 1.
- Produces:
  - `class ContextScopeError(ValueError)`
  - `resolve_task_context(conn, *, owner_id: int, list_id: Optional[int], name: Optional[str], context_id: Optional[int], actor_id: int) -> tuple[Optional[int], str]` — semantik sama dengan `resolve_task_project` (cek keanggotaan aktor di W → `ContextScopeError`; `context_id` di luar scope → `ContextScopeError`; nama → cari NOCASE termasuk arsip, buat baru di posisi terakhir dengan `created_by=actor_id`, tangani `IntegrityError` balapan; arsip yang dipakai diaktifkan lagi; kosong → `(None, "")`). Pemanggil yang commit.
  - `context_text_changed(new: Optional[str], current: Optional[str]) -> bool` (sama dengan `project_text_changed`; boleh memanggil helper bersama).
  - `TaskRepository.list_contexts(user_id)` → nama context pribadi tidak diarsip dari tabel, urut posisi (`user_id=None` → semua pribadi, urut sama).

- [ ] **Step 1: Write the failing tests** di `tests/test_contexts_repo.py` (pakai `TaskRepository(os.environ["DB_PATH"])` dan `Task` dari `models`):
  - `test_resolve_creates_at_last_position`: scope punya posisi 0..2 → nama baru mendapat `position` 3, `created_by` = actor.
  - `test_resolve_nocase_and_trim_same_row`: `"@Phone "` lalu `"@phone"` → id sama, nama kanonis `"@Phone"`, `COUNT(*)` = 1.
  - `test_resolve_reactivates_archived`: context diarsip → resolve nama/id → `archived = 0`.
  - `test_resolve_id_other_scope_raises`: `context_id` milik user lain / W lain → `ContextScopeError`.
  - `test_resolve_workspace_non_member_raises`: actor bukan anggota W → `ContextScopeError`.
  - `test_repo_add_links_context`: `repo.add(Task(title="x", context="@kantor"), uid)` → baris task `context_id` terisi, context pribadi `"@kantor"` ada.
  - `test_repo_add_to_list_workspace_context`: `repo.add_to_list(..., list_id=W)` → context ber-`list_id=W`.
  - `test_repo_update_unchanged_context_keeps_link`: context diarsip setelah task dibuat; `repo.update` hanya mengganti judul → `context_id` sama, context tetap `archived = 1`.
  - `test_repo_update_changed_context_relinks`: ganti `task.context` ke `"@rumah"` → `context_id` baru; ganti ke `""` → `context_id IS NULL`.
  - `test_repo_update_non_member_text_only`: task di W, pemilik task dikeluarkan dari `list_members`, `repo.update` dengan context baru → tidak raise; `context_id IS NULL`, teks = nama baru.
  - `test_list_contexts_from_table_ordered`: context pribadi tanpa task tampil; urut `position`, bukan alfabetis; yang diarsip tidak tampil; context workspace tidak tampil.

- [ ] **Step 2: Run to verify fail**
  Run: `python -m pytest tests/test_contexts_repo.py -q`
  Expected: FAIL (`ImportError`/`AttributeError` untuk `resolve_task_context`)

- [ ] **Step 3: Implement resolver dan sambungkan ke `TaskRepository`**
  `add`/`add_to_list`: pola blok project yang ada (tanpa pemilik → teks saja; `ContextScopeError` → teks saja), INSERT menulis kolom `context_id`. `update`: baca `context, context_id` bersama `project`; tidak berubah (`context_text_changed` False) → pakai nilai lama; selain itu resolve dengan `owner_id=ex["user_id"]`, `actor_id=ex["user_id"]`; `ContextScopeError` → teks saja, `context_id = NULL`; UPDATE menulis `context_id`. `list_contexts`: query tabel `contexts`.

- [ ] **Step 4: Run to verify pass**
  Run: `python -m pytest tests/test_contexts_repo.py tests/test_projects_tasks.py -q`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add repository.py tests/test_contexts_repo.py
  git commit -m "feat(contexts): resolve_task_context + jalur TaskRepository/bot"
  ```

---

### Task 3: Jalur task web (`POST`/`PUT /api/tasks`)

**Files:**
- Modify: `webapp.py` — `TaskCreate` (~baris 1073) dan `TaskUpdate` (~baris 1099) tambah `context_id: Optional[int] = None`; `create_task` (warisan parent ~baris 1914, INSERT ~baris 1978); `update_task` (~baris 2099)
- Test: `tests/test_contexts_tasks.py` (helper `U`, `_workspace`, `_add_member`, `_mk` seperti `tests/test_projects_api.py`)

**Interfaces:**
- Consumes: `resolve_task_context`, `context_text_changed`, `ContextScopeError` (Task 2).
- Produces: respons task (`task_row_to_dict`) memuat `context_id` (otomatis dari `dict(row)`).

Aturan (spec §5):
- **Create:** `req.context_id` yang tidak ada di tabel → diperlakukan `None` (resolusi pakai teks). Subtask tanpa context mewarisi **teks** context parent (perilaku sekarang); id di-resolve di scope subtask. `ContextScopeError` → 400 `"Tahap tidak berada di scope task"`.
- **Update:** `context_id` non-null sama dengan milik task → tidak berubah. `context_id` non-null yang tidak ada lagi → seluruh perubahan context diabaikan (juga teks `context` di request yang sama). `context_id` non-null lain → resolve dengan id (nama diabaikan). Tanpa `context_id` di request (atau null) → berubah hanya bila `req.context is not None and context_text_changed(req.context, existing["context"])`; resolve dengan nama. `ContextScopeError` → 400. Resolve memakai `owner_id=existing["user_id"]`, `list_id=existing["list_id"]`, `actor_id=uid`.

- [ ] **Step 1: Write the failing tests**:
  - `test_post_task_creates_context_entity`: `POST /api/tasks {"title":"t","context":"Desain"}` → respons `context_id` = id baris `contexts` pribadi `"Desain"`.
  - `test_post_task_with_context_id`: context dibuat lebih dulu; POST dengan `context_id` saja → `context` = nama kanonis.
  - `test_post_task_unknown_context_id_uses_text`: `context_id=999999, context="Baru"` → context `"Baru"` dibuat dan di-link.
  - `test_post_task_context_id_other_scope_400`: `context_id` pribadi user lain → 400.
  - `test_post_task_workspace_context`: anggota W membuat task di W dengan context baru → context `list_id=W`, `created_by` = anggota itu.
  - `test_post_subtask_inherits_context_text`: parent ber-context; subtask tanpa context → teks sama dan `context_id` = id context parent.
  - `test_put_context_id_moves_stage`: PUT `{"context_id": X}` → `context` = nama X, `updated_at` berubah.
  - `test_put_empty_context_clears`: PUT `{"context": ""}` → `context_id` null.
  - `test_put_title_only_keeps_context_link`: context diarsip; PUT `{"title":"baru"}` → `context_id` tetap, context tetap diarsip.
  - `test_put_same_id_stale_text_not_rewritten`: context di-rename langsung di DB (UPDATE contexts dan tasks); PUT `{"context_id": X, "context": "<nama lama>"}` → teks task tetap nama baru.
  - `test_put_deleted_context_id_ignored`: context dihapus (task sudah kosong); PUT `{"context_id": <id terhapus>, "context": "<nama lama>"}` → 200, task tetap tanpa context, tidak ada context baru dibuat.
  - `test_put_context_id_other_scope_400`.

- [ ] **Step 2: Run to verify fail**
  Run: `python -m pytest tests/test_contexts_tasks.py -q`
  Expected: FAIL (respons tanpa `context_id` / context tidak dibuat)

- [ ] **Step 3: Implement di `webapp.py`** mengikuti blok project yang berdekatan (pola `stale_pid` dan `project_changed`), dengan variabel `ctx_id, ctx_name` dan INSERT/`updates` menulis `context` + `context_id`.

- [ ] **Step 4: Run to verify pass**
  Run: `python -m pytest tests/test_contexts_tasks.py tests/test_projects_api.py tests/test_projects_tasks.py -q`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add webapp.py tests/test_contexts_tasks.py
  git commit -m "feat(contexts): POST/PUT task mengikat context_id per scope"
  ```

---

### Task 4: API `/api/contexts` + ADR

**Files:**
- Modify: `webapp.py` — ganti `get_contexts` (~baris 2586) dan tambah endpoint di sebelahnya
- Modify: `.agents/DECISIONS.md` — tambah **ADR-016** (nomor kosong berikutnya; ADR-014 dipakai dua kali, terakhir ADR-015)
- Test: `tests/test_contexts_api.py`

**Interfaces:**
- Consumes: `resolve_task_context` (Task 2); `_project_visible`, `_project_can_manage` (sudah ada; hanya membaca `list_id`, `user_id`, `created_by` sehingga bisa dipakai untuk baris `contexts` — beri komentar satu baris).
- Produces (dipakai PR frontend):
  - `class ContextCreate(BaseModel)`: `name: str`, `list_id: Optional[int] = None`, `client_id: Optional[str] = Field(default=None, max_length=64)` (diterima, tidak disimpan; idempotensi lewat nama).
  - `class ContextPatch(BaseModel)`: `name`, `color`, `archived` (opsional).
  - `class ContextOrder(BaseModel)`: `list_id: Optional[int] = None`, `ids: list[int]`.
  - `_require_ws_member_404(conn, list_id, uid) -> None` — seperti `_require_ws_member` tetapi 404 `"Tahap tidak ditemukan"` (dipakai GET `list_id`, POST, PUT `/order`).
  - `_context_full(conn, row, uid) -> dict` dengan kunci persis: `id, name, list_id, user_id, position, color, archived (bool), created_by, active_task_count, task_count, can_manage, updated_at`.
  - Endpoint sesuai spec §6:
    - `GET /api/contexts?list_id&format&scope&include_archived` — tanpa `format=full` → `string[]` (pribadi atau W); `scope=all` hanya dengan `format=full` (selain itu 400), berisi pribadi + semua W yang bisa diakses; urutan global `ORDER BY COALESCE(list_id,0), position, name COLLATE NOCASE, id`.
    - `POST /api/contexts` → `_context_full`; nama kosong → 400.
    - `PATCH /api/contexts/{id}` → `_context_full`; rename menulis `tasks.context` + `updated_at`; warna `#rrggbb` (pakai `_COLOR_RE`) atau null.
    - `PUT /api/contexts/order` → `{"ok": true, "contexts": [<_context_full>...]}` urut baru.
    - `DELETE /api/contexts/{id}` → `{"ok": true, "tasks_cleared": n}`.
  - Hak `PUT /order`: pribadi → pemilik; W → anggota, **dan** (owner W atau `created_by == uid` untuk setiap context yang posisinya berubah); selain itu 404.

- [ ] **Step 1: Write the failing tests**:
  - `test_get_default_still_string_list`: tanpa parameter → `list[str]` urut posisi, termasuk context tanpa task, tanpa yang diarsip, tanpa context W.
  - `test_get_list_id_member_and_nonmember`: anggota → `string[]` W; bukan anggota → 404 (spec §6: semua penolakan = 404).
  - `test_get_full_keys_and_scope_all`: `format=full&scope=all` → kunci persis set di atas; berisi context pribadi + W; `scope=all` tanpa `format=full` → 400; `include_archived=1` menampilkan yang diarsip.
  - `test_post_creates_and_is_idempotent_by_name`: dua POST `"Review"` / `"review"` → id sama; POST nama context diarsip → `archived=false`; nama `"  "` → 400; `list_id` bukan anggota → 404.
  - `test_patch_archive_hides_from_default`: PATCH `{"archived": true}` → tidak ada di `GET` default, ada di `format=full&include_archived=1`; task yang memakainya tetap ter-link; PATCH `{"archived": false}` → tampil lagi.
  - `test_patch_rename_propagates_to_tasks`: task ber-context X; rename → `tasks.context` baru dan `updated_at` task berubah.
  - `test_patch_rename_case_only_ok`: `"review"` → `"Review"` → 200.
  - `test_patch_rename_taken_409`: → 409, `detail.code == "CONTEXT_NAME_TAKEN"`.
  - `test_patch_color_validation`: `"#12ab9F"` OK, `"red"` → 400, `null` OK.
  - `test_manage_matrix`: workspace W milik A, anggota B dan C, non-anggota D. Context dibuat B: PATCH oleh B → 200, oleh A (owner) → 200, oleh C → 404, oleh D → 404; `can_manage` di `format=full` benar untuk A/B/C. Context pribadi A: PATCH oleh B → 404.
  - `test_order_writes_positions`: tiga context pribadi; `PUT /order` dengan id terbalik → `position` 0,1,2 sesuai urutan baru; `GET` default ikut urutan baru.
  - `test_order_stale_variants`: id kurang satu, id ekstra dari scope lain, id duplikat, id context diarsip → masing-masing 409 `CONTEXT_ORDER_STALE`; posisi tidak berubah.
  - `test_order_workspace_permissions`: C (bukan pembuat, bukan owner) menggeser context buatan B → 404; B menggeser hanya context buatannya sendiri (yang lain tetap di posisi) → 200; A boleh semua.
  - `test_delete_clears_tasks`: task aktif + done ber-context X → DELETE → `tasks_cleared == 2`, kedua task `context=''`, `context_id NULL`, `updated_at` berubah; baris context hilang.
  - `test_workspace_delete_cascades`: hapus `shared_lists` W (lewat endpoint hapus list yang ada) → baris `contexts` W hilang, `tasks.context_id` null.

- [ ] **Step 2: Run to verify fail**
  Run: `python -m pytest tests/test_contexts_api.py -q`
  Expected: FAIL (404/405 untuk endpoint baru, kunci full tidak ada)

- [ ] **Step 3: Implement endpoint** mengikuti pola `/api/projects` (blok baris ~2420–2585). Penolakan kelola memakai 404 (bukan 403 seperti projects). `PUT /order`: ambil id context tidak diarsip di scope; bila `sorted(ids) != sorted(set_scope)` atau ada duplikat → 409; hitung id yang posisinya berubah, cek hak; tulis `position = indeks`, `updated_at = now` hanya untuk yang berubah. Rename: cek duplikat NOCASE `id <> ?`, tangkap `IntegrityError` → 409 yang sama.

- [ ] **Step 4: Tulis ADR-016** di `.agents/DECISIONS.md` (format ADR yang ada): "Context sebagai entitas berscope dengan urutan (`contexts.position`) untuk tahap Kanban" — keputusan, alasan (tahap tanpa task, dibagi di workspace), konsekuensi (teks `tasks.context` dipertahankan, rename/hapus bump `updated_at`, 404 untuk penolakan, kelola hanya online di v1).

- [ ] **Step 5: Run full suite**
  Run: `python -m pytest tests/ -q`
  Expected: semua PASS (556 baseline + tes baru), tanpa kegagalan baru.

- [ ] **Step 6: Commit**
  ```bash
  git add webapp.py tests/test_contexts_api.py .agents/DECISIONS.md
  git commit -m "feat(contexts): API /api/contexts (full, kelola, urutan) + ADR-016"
  ```

---

## Setelah semua task

- Review akhir seluruh branch (model terkuat), perbaiki temuan, re-review.
- Simulasi upgrade DB: salin DB dengan task ber-context lama (teks campur kapital, task done, task workspace, task yatim) ke file temp, jalankan `migrate_db()` dua kali, cek hitungan backfill dan tidak ada exception.
- Perbarui `.agents/CURRENT_STATE.md` dan `.agents/SESSION_LOG.md`; buka **draft PR** ke `main` dengan catatan deploy: restart `taskflow-web` **dan** `taskflow`.
