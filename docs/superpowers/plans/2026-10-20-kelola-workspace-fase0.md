# Kelola Workspace Fase 0 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membereskan bug data saat workspace dihapus / anggota keluar, dan merapikan halaman Kelola Workspace (dialog Hapus dengan ringkasan dampak + ketik nama, owner di daftar anggota, istilah, mode gelap, aksesibilitas).

**Architecture:** Semua aturan data di `repository.py` dalam satu transaksi (dipakai bersama `webapp.py` dan `bot.py`); satu endpoint baru `GET /api/lists/{id}/delete-impact`. Frontend: logika murni di modul baru `static/offline/wsmanage.js` (dites node), UI di `SharedListsManager` (`static/index.html`, plain `React.createElement`). Sinkronisasi offline tidak berubah (rekonsiliasi `pullTasks` sudah menghapus task yang 403).

**Tech Stack:** FastAPI + SQLite (`repository.py`, `webapp.py`), pytest; React tanpa build (`static/index.html`), node:test; Playwright (E2E lokal, tidak di CI).

**Spec:** `docs/superpowers/specs/2026-10-20-kelola-workspace-fase0-design.md`

## Global Constraints

- `static/index.html` adalah JS `React.createElement` biasa; **jangan** menjalankan `compile.js`. Setelah mengubahnya: `node temporary_files/check_inline_scripts.js static/index.html` harus OK.
- "Belum selesai" = `gtd_status NOT IN ('done','archived')`.
- Timestamp yang ditulis ke `tasks.updated_at` = `datetime.now().isoformat()` (sama dengan penulisan task lain di `repository.py`).
- Kolom teks `tasks.project` / `tasks.context` dikosongkan menjadi `''`; `project_id`, `context_id`, `assigned_to`, `list_id` menjadi `NULL`.
- File workspace fisik ada di `os.path.join(UPLOAD_DIR, filename)` (`from config import UPLOAD_DIR`). File yang filename-nya masih dirujuk `task_attachments.filename` **tidak boleh** dihapus.
- Semua teks UI berbahasa Indonesia dan memakai istilah "workspace" (bukan "list" / "shared list") di halaman ini dan toast-nya. Teks yang dipatok spec dipakai persis.
- Tanpa warna hex tetap di markup baru; pakai token tema (`var(--…)`) dan kelas di `app.css` dengan varian gelap.
- Versi: SW `taskflow-v434-kelola-workspace-fase0` (bila v434 sudah terpakai di `main` saat merge, naikkan ke nomor kosong berikutnya) di `static/sw.js`, `static/index.html` (2 tempat), `webapp.py` (`sw_cache`), `tests/test_version.py`; `app.css?v=342`; tambahkan `/static/offline/wsmanage.js` ke daftar precache `static/sw.js` dan `<script>` di `static/index.html` (dekat `workspacepins.js`).
- Deploy: restart `taskflow-web` **dan** `taskflow` (bot).

## Review Focus

1. **Lampiran task workspace** (file dicerminkan ke `workspace_files`, `source='task'`): setelah workspace dihapus, lampiran task yang kembali pribadi tetap bisa diunduh — file fisiknya tidak terhapus. Tes: Task 1 `test_delete_keeps_task_attachment_file`.
2. **Workspace dihapus lewat bot** (`dlist_confirm_` di `bot.py`): aturan task dan file disk berlaku sama karena ada di `repository.py`. Tes: Task 1 memanggil `TaskRepository.delete_shared_list` langsung (`test_repo_delete_returns_task_to_creator`).
3. **Anggota yang task-nya sudah selesai lalu dikeluarkan**: riwayat penanggung jawab task done/archived tidak berubah, dan task di workspace **lain** milik anggota itu tidak tersentuh. Tes: Task 2 `test_remove_member_keeps_done_and_other_workspace`.
4. **Nama workspace dengan spasi / huruf besar / karakter khusus** (`"  Proyek A&B "`): pencocokan ketik-nama tetap benar dan tidak lolos untuk nama parsial. Tes: Task 3 `nameMatches` (kasus spasi, kapital, parsial, kosong).
5. **Migrasi dijalankan pada DB yang tidak punya task yatim / dijalankan dua kali**: tidak mengubah apa pun, `updated_at` task lain tidak naik. Tes: Task 1 `test_orphan_migration_idempotent`.

---

### Task 1: Hapus workspace mengembalikan task ke pembuatnya + bersihkan file disk + migrasi task yatim

**Files:**
- Modify: `repository.py` — `delete_shared_list` (±baris 1551), `migrate_db` (bagian migrasi tasks), import `UPLOAD_DIR` + `logging`
- Test: `tests/test_workspace_delete_rules.py` (baru)

**Interfaces:**
- Produces: `TaskRepository.delete_shared_list(list_id: int, owner_id: int) -> bool` (signature tetap; perilaku baru). Helper modul `_return_tasks_to_creator(conn, where_sql: str, args: tuple) -> int` (dipakai delete dan migrasi; mengembalikan jumlah baris).

- [ ] **Step 1: Tulis tes gagal** di `tests/test_workspace_delete_rules.py` (pakai pola `U`, `_workspace`, `_add_member` dari `tests/test_workspace_pins_api.py`; task dibuat lewat `POST /api/tasks` dengan `list_id`):
  - `test_delete_returns_task_to_creator`: A owner W, B anggota; B membuat task T di W dengan `assigned_to=A`, project & context workspace. A `DELETE /api/lists/W` → 200. Baris T di DB: `user_id == B.id`, `list_id is None`, `assigned_to is None`, `project_id is None`, `project == ''`, `context_id is None`, `context == ''`, `updated_at` > nilai sebelumnya. `B.get(f"/api/tasks/{T}")` → 200; `A.get(f"/api/tasks/{T}")` → 403 atau 404; T ada di `B.get("/api/tasks?include_done=true")`.
  - `test_delete_unlinks_workspace_files`: unggah berkas langsung `POST /api/lists/W/files` → file ada di `UPLOAD_DIR`; hapus W → file tidak ada.
  - `test_delete_keeps_task_attachment_file`: unggah `POST /api/tasks/{T}/attachments` untuk task di W (tercermin di `workspace_files`) → hapus W → file masih ada dan `B.get` unduhan lampiran task → 200.
  - `test_delete_unlink_failure_does_not_abort`: monkeypatch `os.unlink` di modul `repository` agar melempar `OSError` → `DELETE` tetap 200, baris `shared_lists` W hilang.
  - `test_repo_delete_returns_task_to_creator`: sama seperti kasus pertama tetapi lewat `TaskRepository(DB_PATH).delete_shared_list(W, A.id)` → `True`; bukan owner → `False` dan task tidak berubah.
  - `test_orphan_migration_fixes_and_idempotent`: sisipkan task dengan `list_id = 999999` (workspace tidak ada; kolom tanpa FK sehingga insert langsung berhasil) → `webapp.migrate_db()` → task kembali pribadi (aturan sama). Simpan `updated_at` semua task, jalankan `migrate_db()` lagi → tidak ada `updated_at` yang berubah.
- [ ] **Step 2: Jalankan → FAIL.** `python -m pytest tests/test_workspace_delete_rules.py -q`
- [ ] **Step 3: Implementasi.** Di `delete_shared_list`, dalam blok `with self._connect()` yang sama dan hanya bila `shared_lists` W milik `owner_id`: (a) kumpulkan `filename` dari `workspace_files WHERE list_id=? AND is_deleted=0 AND filename NOT IN (SELECT filename FROM task_attachments)`; (b) `_return_tasks_to_creator(conn, "list_id = ?", (list_id,))` yang menjalankan satu `UPDATE tasks SET list_id=NULL, assigned_to=NULL, project_id=NULL, project='', context_id=NULL, context='', updated_at=? WHERE <where_sql>`; (c) perilaku mindmap/drawing lama; (d) DELETE. **Setelah** blok `with` (commit) dan bila terhapus: unlink tiap file di `UPLOAD_DIR` dalam `try/except OSError` → `logging.warning`. Di `migrate_db`: `_return_tasks_to_creator(conn, "list_id IS NOT NULL AND list_id NOT IN (SELECT id FROM shared_lists)", ())` (idempoten secara alami: setelah sekali, tidak ada baris yang cocok).
- [ ] **Step 4: Jalankan → PASS**, lalu `python -m pytest -q` penuh → semua PASS.
- [ ] **Step 5: Commit** `fix(workspace): hapus workspace mengembalikan task ke pembuatnya dan membersihkan berkas`

### Task 2: Keluarkan/keluar melepas penanggung jawab, `member_count` termasuk owner, endpoint `delete-impact`

**Files:**
- Modify: `repository.py` — `remove_list_member` (±1675), `get_lists_for_user` (`member_count`), method baru `workspace_delete_impact`
- Modify: `webapp.py` — rute `GET /api/lists/{list_id}/delete-impact` (dekat `/leave-impact`)
- Test: `tests/test_workspace_member_rules.py` (baru)

**Interfaces:**
- Consumes: pola tes Task 1.
- Produces: `TaskRepository.workspace_delete_impact(list_id: int) -> dict` dengan kunci persis `tasks_total, tasks_active, files, messages, projects, stages, notes_to_personal, drawings_to_personal` (int). Endpoint: owner → 200 dict itu; anggota → 403; workspace tidak ada → 404. `member_count` = `COUNT(list_members) + 1`.

- [ ] **Step 1: Tulis tes gagal:**
  - `test_remove_member_releases_active_tasks`: task aktif di W dengan `assigned_to=B` → A `DELETE /api/lists/W/members/{B}` → `assigned_to is None`, `updated_at` naik.
  - `test_leave_releases_active_tasks`: sama lewat B `DELETE /api/lists/W/leave`.
  - `test_remove_member_keeps_done_and_other_workspace`: task `gtd_status='done'` dan `'archived'` di W ber-assignee B tetap `B.id` (updated_at tidak berubah); task aktif di workspace W2 ber-assignee B tetap.
  - `test_member_count_includes_owner`: W baru → `member_count == 1`; + B → 2.
  - `test_delete_impact_counts`: W berisi 3 task (1 done), 1 berkas langsung + 1 lampiran task, 2 pesan, 1 project, 1 tahap, 1 note W, 1 drawing W → `{"tasks_total":3,"tasks_active":2,"files":1,"messages":2,"projects":1,"stages":1,"notes_to_personal":1,"drawings_to_personal":1}` (pakai helper di `tests/drawing_ws_helpers.py` atau insert langsung bila lebih sederhana).
  - `test_delete_impact_forbidden_and_missing`: B (anggota) → 403; id tidak ada → 404.
- [ ] **Step 2: Jalankan → FAIL.**
- [ ] **Step 3: Implementasi.** `remove_list_member`: dalam transaksi yang sama, bila baris keanggotaan terhapus, `UPDATE tasks SET assigned_to=NULL, updated_at=? WHERE list_id=? AND assigned_to=? AND gtd_status NOT IN ('done','archived')`. Rute `delete-impact` didefinisikan sebelum rute generik yang bisa menangkapnya (ikuti posisi `/leave-impact`); cek `get_shared_list` (404) lalu `is_list_owner` (403). Tabel yang belum dimigrasi (`OperationalError`) dihitung 0.
- [ ] **Step 4: Jalankan → PASS**, `python -m pytest -q` penuh → PASS.
- [ ] **Step 5: Commit** `fix(workspace): lepas penanggung jawab saat anggota keluar, member_count + ringkasan dampak hapus`

### Task 3: Modul murni `static/offline/wsmanage.js`

**Files:**
- Create: `static/offline/wsmanage.js` (pola UMD seperti `workspacepins.js`, ekspor `window.TF.wsmanage` dan `module.exports`)
- Modify: `static/index.html` (`<script src="/static/offline/wsmanage.js">` setelah `workspacepins.js`), `static/sw.js` (precache)
- Test: `tests/offline/wsmanage.test.js`

**Interfaces:**
- Produces:
  - `nameMatches(input: string, name: string) -> boolean` — trim kedua sisi, bandingkan `toLowerCase()`; input kosong → `false`.
  - `impactLines(impact: object) -> string[]` — baris bernilai 0 dihilangkan; semua 0 → `["Workspace ini kosong."]`.
  - `memberRows(detail: {owner, members}) -> Array<{id, username, display_name, role: "owner"|"member"}>` — owner pertama, anggota sesudahnya dalam urutan asli, owner yang juga muncul di `members` tidak digandakan; `owner` null → anggota saja.

- [ ] **Step 1: Tulis tes gagal** `tests/offline/wsmanage.test.js`:
  - `nameMatches`: `("proyek a&b", "  Proyek A&B ")` → true; `("Proyek", "Proyek A&B")` → false; `("", "X")` → false; `("  x ", "X")` → true.
  - `impactLines` dengan `{tasks_total:12,tasks_active:3,files:4,messages:57,projects:2,stages:3,notes_to_personal:5,drawings_to_personal:1}` →
    ```js
    ["12 task (3 aktif) akan kembali menjadi task pribadi pembuatnya",
     "4 berkas dan 57 pesan chat dihapus permanen",
     "2 project dan 3 tahap dihapus",
     "5 catatan dan 1 drawing kembali menjadi pribadi"]
    ```
  - `impactLines` sebagian nol: `{tasks_total:2,tasks_active:0,files:0,messages:5,projects:0,stages:1,notes_to_personal:0,drawings_to_personal:2}` → `["2 task akan kembali menjadi task pribadi pembuatnya", "5 pesan chat dihapus permanen", "1 tahap dihapus", "2 drawing kembali menjadi pribadi"]`.
  - `impactLines` semua nol / `{}` → `["Workspace ini kosong."]`.
  - `memberRows`: owner {id:1} + members [{id:2},{id:1},{id:3}] → ids `[1,2,3]`, role `["owner","member","member"]`; owner null → hanya anggota.
- [ ] **Step 2: Jalankan → FAIL.** `node --test tests/offline/wsmanage.test.js`
- [ ] **Step 3: Implementasi** sesuai Interfaces; tambah `<script>` dan entri precache.
- [ ] **Step 4: Jalankan → PASS**; `npm test` (satu kegagalan pra-ada `draw_local_reactive` boleh, selain itu PASS).
- [ ] **Step 5: Commit** `feat(workspace): helper murni kelola workspace (cocok nama, ringkasan dampak, urutan anggota)`

### Task 4: UI `SharedListsManager` — dialog, daftar anggota, istilah, mode gelap, aksesibilitas

**Files:**
- Modify: `static/index.html` — `SharedListsManager` (±2136–2726) dan komponen dialog baru `WorkspaceDeleteDialog` di dekatnya
- Modify: `static/app.css` — kelas `.btn-danger-soft`, `.btn-warn-soft` (+ varian tema gelap mengikuti pola tema yang ada), `.ws-invite-link`
- Test: `tests/offline/wsmanage_ui.test.js` (cek sumber, pola tes `*_ui.test.js` yang ada)

**Interfaces:**
- Consumes: `TF.wsmanage.{nameMatches, impactLines, memberRows}` (Task 3); `GET /api/lists/{id}/delete-impact` (Task 2); `GET /api/lists/{id}` (`owner`, `members`, sudah ada).
- Produces: `WorkspaceDeleteDialog({ list, onClose, onDeleted })` — memuat dampak saat mount.

Teks persis:
- Judul dialog hapus: `Hapus workspace "{nama}"?`; label input: `Ketik nama workspace untuk konfirmasi`; tombol: `Batal`, `Hapus permanen`; offline: `Hapus workspace butuh koneksi internet`; gagal: `Gagal memuat ringkasan — coba lagi` + tombol `Coba lagi`.
- Dialog keluarkan: judul `Keluarkan {nama} dari workspace ini?`, isi `Task belum selesai yang ditugaskan ke {nama} akan dilepas penanggung jawabnya.`, tombol `Batal` / `Keluarkan`.
- Daftar anggota: label baris owner `Owner`; bila tidak ada anggota selain owner: `Belum ada anggota lain.`; judul seksi `Anggota:` tetap.
- Toast/kosong: `Workspace dibuat ✅`, `Workspace dihapus`, `{username} ditambahkan ke workspace ✅`, `Anggota dikeluarkan`, `Belum ada workspace. Buat yang pertama di atas!`.

- [ ] **Step 1: Tulis tes gagal** `tests/offline/wsmanage_ui.test.js` (baca `static/index.html` sebagai teks, potong blok `function SharedListsManager` s/d fungsi berikutnya):
  - tidak mengandung `confirm(` maupun `shared list` / `Shared list` / `"List dihapus` ;
  - tidak mengandung `#fee2e2`, `#fef3c7`, `#f8f8f8`;
  - mengandung `"aria-expanded"`, `"aria-controls"`, `` `Keluarkan ${ `` (aria-label) dan semua teks persis di atas;
  - memanggil `TF.wsmanage.memberRows` dan `/delete-impact`;
  - `static/app.css` mengandung `.btn-danger-soft` dan `.btn-warn-soft`.
- [ ] **Step 2: Jalankan → FAIL.** `node --test tests/offline/wsmanage_ui.test.js`
- [ ] **Step 3: Implementasi.**
  - Hapus: tombol Hapus (owner) membuka `WorkspaceDeleteDialog` (overlay `modal-overlay` seperti `DrawingScopeDialog`, `role="dialog"`, `aria-modal="true"`, `aria-labelledby`). Saat mount: bila `navigator.onLine === false` → teks offline; selain itu `api.get` dampak (bypass router lokal dengan opsi network yang dipakai `handleWorkspacePin`), tampilkan `impactLines` sebagai daftar. Input fokus otomatis; tombol `Hapus permanen` (kelas `btn-danger-soft`) `disabled` kecuali `nameMatches` dan dampak termuat. Konfirmasi → `api.del('/api/lists/'+id)` → toast `Workspace dihapus` → `onDeleted()` (`onRefresh`). Esc / klik overlay → tutup; fokus kembali ke tombol Hapus asal (simpan `document.activeElement` saat buka).
  - Keluarkan anggota: pakai `useDrawingScopeDialog` yang sudah ada (spec `{title, note, actions:[{value:null,label:"Batal"},{value:"ok",label:"Keluarkan",primary:true,danger:true}]}`).
  - Daftar anggota: simpan `detail` (`owner` + `members`) per workspace; `loadMembers(listId, force)` selalu mengambil ulang saat panel dibuka dan setelah undang/keluarkan (hapus guard cache); render `memberRows(detail)`; baris owner tanpa tombol keluarkan.
  - Teks: ganti semua teks/ toast di komponen ini sesuai daftar; jumlah anggota memakai `member_count` (kini termasuk owner).
  - Mode gelap: tombol Hapus → `btn btn-sm btn-danger-soft`, Keluar → `btn btn-sm btn-warn-soft`; input link undangan → kelas `ws-invite-link` (`background: var(--bg-subtle)`).
  - Aksesibilitas: tombol Kelola/Tutup `aria-expanded={expanded}` + `aria-controls={"ws-panel-"+id}` pada panel; tombol keluarkan anggota `aria-label={`Keluarkan ${nama}`}`.
- [ ] **Step 4: Jalankan → PASS**; `npm test`; `node temporary_files/check_inline_scripts.js static/index.html` OK.
- [ ] **Step 5: Commit** `feat(workspace): dialog hapus dengan ringkasan dampak, owner di daftar anggota, istilah dan mode gelap`

### Task 5: Versi, E2E dua akun, verifikasi penuh

**Files:**
- Modify: `static/sw.js`, `static/index.html`, `webapp.py`, `tests/test_version.py` (versi SW), `static/index.html` (`app.css?v=342`)
- Create: `temporary_files/e2e_kelola_workspace_fase0.py` (pola `temporary_files/e2e_workspace_pins.py`: uvicorn lokal, DB sementara, screenshot ke `temporary_files/e2e_kelola_workspace_fase0/`, keluar non-zero bila gagal; tidak dijalankan CI)

**Interfaces:**
- Consumes: semua task sebelumnya.

- [ ] **Step 1: Naikkan versi** di semua tempat (Global Constraints); `python -m pytest tests/test_version.py -q` → PASS.
- [ ] **Step 2: Tulis E2E** (akun A owner, B anggota; tema terang lalu gelap):
  1. Daftar anggota W: baris pertama A berlabel `Owner`, lalu B; W2 tanpa anggota → `Belum ada anggota lain.`; kartu W menulis `2 anggota`.
  2. Dialog hapus W: ringkasan memuat baris task; ketik nama salah → `Hapus permanen` nonaktif; nama dengan kapital berbeda + spasi → aktif. Esc menutup dan fokus kembali ke tombol Hapus.
  3. Offline (`context.set_offline(True)`) → dialog menampilkan `Hapus workspace butuh koneksi internet`, tombol nonaktif.
  4. Keluarkan B dari W3: task aktif B tanpa penanggung jawab, task selesai B tetap (cek lewat API).
  5. Hapus W (B punya task di W yang sudah tersinkron di perangkat B): setelah sync di perangkat B, task itu tampil sebagai task pribadi B; di perangkat A task itu hilang dari store lokal (cek IndexedDB `tasks` lewat `page.evaluate`).
  6. Tidak ada teks `shared list` di halaman; screenshot terang + gelap tiap langkah.
- [ ] **Step 3: Jalankan E2E → semua langkah lulus.** `python temporary_files/e2e_kelola_workspace_fase0.py`
- [ ] **Step 4: Verifikasi penuh:** `python -m pytest -q` (PASS), `npm test` (hanya `draw_local_reactive` pra-ada yang boleh gagal), `node temporary_files/check_inline_scripts.js static/index.html` (OK).
- [ ] **Step 5: Commit** `chore: SW v434 + E2E kelola workspace fase 0`; perbarui `.agents/CURRENT_STATE.md` dan `.agents/SESSION_LOG.md` (status, versi SW, restart `taskflow-web` + `taskflow`, query cek task yatim sebelum/sesudah:
  `SELECT COUNT(*) FROM tasks WHERE list_id IS NOT NULL AND list_id NOT IN (SELECT id FROM shared_lists);`).

## Di luar cakupan

Pemindahan tombol Hapus / Danger Zone, soft delete / arsip, undangan dengan persetujuan, daftar link aktif, ganti nama (Fase 1–2). Perubahan `listsync.js` / `syncpull.js` (tidak diperlukan; dibuktikan E2E langkah 5).
