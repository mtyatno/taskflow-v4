# Rencana: project per scope di aplikasi (form task, dropdown, offline, kelola) — PR 5

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Tanggal: 2026-10-19 · Agent: Claude · Branch: `claude/project-entities-ui` · Frontend + sedikit backend · **SW naik** (v416 kecuali `main` sudah lebih tinggi saat eksekusi)

**Goal:** Dropdown project di form task mengikuti scope task (pribadi atau workspace), anggota workspace melihat project workspace yang sama, project bisa dikelola dari aplikasi, dan semuanya tetap jalan offline sesuai pola local-first yang ada.

**Architecture:** SPA melayani `GET /api/projects` dari router lokal (`static/offline/taskroutes.js` → `taskquery.getProjects`, turunan teks task lokal), jadi tabel `projects` di server (PR 4) belum terpakai. PR ini menambah cache project dari server (modul offline baru `projectcache.js`, disimpan di store `_meta`, di-refresh saat sync pull) dan membuat route lokal `GET /api/projects` sadar scope. Push task membawa `project_id`. Form dan tampilan memakai daftar per scope. Kelola project (rename/warna/arsip/hapus) hanya online, langsung ke server.

**Tech Stack:** React tanpa build step di `static/index.html` (JSX dikompilasi `compile.js` saat deploy; file berisi output `React.createElement`), modul offline UMD di `static/offline/*.js` + `node --test`, FastAPI + pytest, Playwright (Chromium terpasang) untuk bukti E2E.

**Spec:** `docs/superpowers/specs/2026-10-18-workspace-drawing-project-design.md` §5.6–5.7 (+ §5.3 batasan v1). Backend PR 4: ADR-010.

## Global Constraints

- Scope task: `list_id` terisi → workspace itu; kosong → pribadi. Sama dengan server (PR 4).
- `GET /api/projects` **tanpa query** tetap mengembalikan `string[]` project pribadi (lokal maupun server) — pemanggil lama tidak boleh rusak.
- Nama dibandingkan tanpa memperhatikan kapital ASCII (sama dengan SQLite NOCASE); daftar diurutkan dengan aturan yang sama dan tanpa duplikat.
- Payload task (create & update dari `syncpush.js`) mengirim `project_id` hanya bila record punya `project_id` non-null **dan** teks `project` record sama (NOCASE) dengan nama project itu di cache; selain itu hanya teks.
- Teks UI persis: label "Project · Pribadi" dan "Project · {nama workspace}"; pilihan scope "Pribadi" dan "👥 {nama workspace}"; tombol "Kelola project"; pesan offline kelola: "Kelola project butuh koneksi internet"; konfirmasi hapus: "Hapus project «{nama}»? {n} task akan kehilangan project-nya."; badge "👥 {nama workspace}".
- Aturan repo: tiap rilis frontend menaikkan versi SW di semua tempat (`static/sw.js` CACHE, fallback `window.__SW_VERSION` dan teks versi di `static/index.html`, `sw_cache` di `webapp.py`, `tests/test_version.py`); modul offline baru masuk precache `static/sw.js` dan `<script>` di `static/index.html` setelah `taskquery.js`; `app.css?v=` naik bila `app.css` berubah; jangan pakai `border-left` aksen; `node temporary_files/check_inline_scripts.js static/index.html` harus lulus.
- Perintah cek: `npm ci` (sekali), `npm test`, `python3 -m pytest tests -q`.
- Commit diakhiri trailer atribusi harness pelaksana. Jangan push.

## Review Focus

1. **Offline total** (belum pernah sync setelah update): dropdown tetap terisi dari teks task lokal; tidak ada error karena cache kosong. Tes: Task 2.
2. **Task workspace dengan nama project sama dengan project pribadi** ("taskflow" pribadi vs "taskflow" di W) → dropdown, sidebar, dan pengelompokan tidak mencampur keduanya. Tes: Task 2 (cache/route) + Task 4 (grouping).
3. **Perangkat basi setelah rename** → push membawa `project_id` lama yang masih sama → server tidak membuat ulang project nama lama; setelah hapus → `project_id` tak dikenal diabaikan, edit lain tetap tersimpan. Tes: Task 1 (server) + Task 2 (payload).
4. **Ganti workspace di form task baru** → project yang tidak ada di scope baru dikosongkan; yang ada tetap. Tes: Task 3 (helper murni) + E2E.
5. **Anggota yang bukan pembuat** membuka Kelola project → tombol rename/hapus tidak tampil (`can_manage`), server tetap menolak bila dipaksa. Tes: Task 5.

---

### Task 1 — Backend: daftar semua scope dan `project_id` basi

**Files:** Modify `webapp.py`; Modify `tests/test_projects_api.py`, `tests/test_projects_tasks.py`.

**Interfaces (Produces):**
- `GET /api/projects?format=full&scope=all[&include_archived=1]` → objek format full (sama dengan PR 4) untuk project pribadi milik user **dan** semua workspace tempat user owner/anggota. `scope=all` tanpa `format=full` → 400 `"scope=all hanya untuk format=full"`.
- `PUT /api/tasks/{id}`: `project_id` di payload yang **tidak ada lagi** di tabel `projects` → diperlakukan sebagai "project tidak berubah" (abaikan `project_id` dan teks `project`), bukan 400. `POST /api/tasks`: `project_id` tak dikenal → diabaikan, resolusi pakai teks.

- [ ] Step 1: tes gagal — `scope=all` memuat project pribadi + project W anggota, tidak memuat W yang bukan miliknya; `include_archived`; 400 tanpa `format=full`; PUT dengan `project_id` project yang sudah dihapus + judul baru → 200, judul berubah, project task tetap; POST dengan `project_id` tak dikenal + teks → project dari teks.
- [ ] Step 2: jalankan → FAIL. Step 3: implementasi. Step 4: tes file + suite penuh → PASS.
- [ ] Step 5: commit `feat(projects): scope=all + abaikan project_id yang sudah dihapus`.

### Task 2 — Offline: cache project dan route lokal sadar scope

**Files:** Create `static/offline/projectcache.js`, `tests/offline/projectcache.test.js`; Modify `static/offline/taskroutes.js`, `static/offline/taskquery.js`, `static/offline/hydrate.js` (`COPY` + `project_id`), `static/offline/taskrepo.js` (simpan `project_id`; patch `project` tanpa `project_id` → `project_id` dari cache bila cocok, selain itu null), `static/offline/syncpush.js` (payload `project_id` per Global Constraints; `taskAdopt` mengadopsi `project` dan `project_id` dari respons), `static/offline/syncpull.js` (panggil `TFprojects.refresh` setelah pull task berhasil; kegagalan refresh tidak menggagalkan pull), `static/sw.js` (precache), `static/index.html` (`<script>`).

**Interfaces (Produces, `window.TF.projectcache`, UMD seperti modul lain):**
- `refresh(transport) -> Promise<void>`: `GET /api/projects?format=full&scope=all&include_archived=1` lewat transport sync yang sama dengan pull; simpan ke `_meta` key `"projects:v1"` sebagai `{ at, items: [...] }`.
- `list(listId|null, {includeArchived}) -> Promise<Item[]>`: item cache di scope itu.
- `names(listId|null) -> Promise<string[]>`: nama tidak diarsip di scope ∪ nama `project` dari task lokal aktif di scope yang sama (pribadi = `list_id` null), dedup + urut NOCASE.
- `idFor(listId|null, name) -> Promise<number|null>`.
- Route lokal `GET /api/projects`: tanpa query → `names(null)`; `?list_id=W` → `names(W)`; `?format=full[&list_id=W][&include_archived=1]` → `list(...)` (tanpa `list_id` = pribadi). POST/PATCH/DELETE `/api/projects` **tidak** didaftarkan lokal (diteruskan ke jaringan).

- [ ] Step 1: tes node gagal (pakai `fake-indexeddb` seperti tes offline lain): refresh menyimpan cache; `names` pribadi vs W tidak bercampur; nama task lokal ikut; dedup NOCASE; cache kosong → hanya nama task; route lokal 3 bentuk; payload push membawa `project_id` hanya bila cocok; `taskAdopt` mengadopsi; hydrate menyalin `project_id`.
- [ ] Step 2: FAIL. Step 3: implementasi. Step 4: `npm test` + pytest → PASS (kegagalan pra-ada `draw_local_reactive` boleh).
- [ ] Step 5: commit `feat(projects): cache project offline + route lokal per scope`.

### Task 3 — Form task: pilihan scope dan dropdown per scope

**Files:** Modify `static/index.html` (`TaskFormModal` ±3455, field Project ±4960, pilihan Shared List ±5030; `TaskDetailModal` ±5759 field project ±6057; `GtdInboxWizardModal`/`GtdWizardEditFields` ±11273–11300); Create `tests/offline/project_scope_form.test.js`.

**Interfaces:**
- Hook `useScopeProjects(listId)` di `static/index.html`: memuat `api.get(listId ? "/api/projects?list_id="+listId : "/api/projects")`, muat ulang saat `listId` berubah dan saat event `window` `"tf:projects-changed"`.
- Helper murni `projectAfterScopeChange(currentName, newScopeNames) -> string` (nama tetap bila ada di daftar baru secara NOCASE, selain itu `""`), diekspor ke `window` agar bisa dites node seperti tes UI lain di `tests/offline/` (ikuti pola tes yang membaca fungsi dari `static/index.html`).
- Form task baru: pilihan scope pindah dari "Opsi Tambahan" ke baris atribut cepat, tepat sebelum Project (pilihan: "Pribadi" + "👥 {nama}" per workspace). Label field project mengikuti scope. Ganti scope → `projectAfterScopeChange`. Form edit & detail: scope dari `task.list_id` (tidak bisa diubah), label menyebut scope, opsi dari `useScopeProjects(task.list_id)`.

- [ ] Step 1: tes gagal untuk `projectAfterScopeChange` dan keberadaan label/pilihan scope (pola tes UI statis yang ada).
- [ ] Step 2: FAIL. Step 3: implementasi. Step 4: `npm test`, pytest, `check_inline_scripts` → PASS.
- [ ] Step 5: commit `feat(projects): form task memilih scope dan project per scope`.

### Task 4 — Tampilan: sidebar, filter, pengelompokan, badge

**Files:** Modify `static/index.html` (`Sidebar` ±2434–2545, `TaskListView` ±11653/11814, `Dashboard` kartu project ±15602, App `fetchAll` ±31011/31027); Create `tests/offline/project_views.test.js`.

**Interfaces:**
- Sidebar bagian PROJECTS = project pribadi (`/api/projects`); hitungan task hanya task pribadi (`list_id` null) dengan nama itu. Project workspace tidak tampil di bagian PROJECTS.
- Filter `proj_{nama}` hanya task pribadi. Pengelompokan per project di `TaskListView` dan kartu project di Dashboard memakai kunci `(list_id ?? "p") + ":" + nama NOCASE`; grup workspace diberi badge "👥 {nama workspace}".
- Setelah sync pull sukses dan setelah kelola project, App memancarkan `"tf:projects-changed"` dan memuat ulang `projects`.

- [ ] Step 1: tes gagal (helper kunci grup murni + hitungan sidebar). Step 2: FAIL. Step 3: implementasi. Step 4: semua tes → PASS.
- [ ] Step 5: commit `feat(projects): sidebar dan pengelompokan tidak mencampur scope`.

### Task 5 — Kelola project

**Files:** Modify `static/index.html` (komponen baru `ProjectManagerModal`, tombol "Kelola project" di header PROJECTS sidebar dan di halaman workspace), `static/app.css` (bila perlu, naikkan `?v=`); Create `tests/offline/project_manager.test.js`.

**Interfaces:**
- Modal memuat `GET /api/projects?format=full&include_archived=1[&list_id=W]` **langsung ke jaringan** (helper `api.network` / bypass router lokal — ikuti cara yang ada untuk endpoint online-only; bila belum ada, tambahkan opsi `{ network: true }` di `api.fetch`). Offline → tampilkan "Kelola project butuh koneksi internet".
- Per baris: nama, warna (input `#rrggbb`), jumlah task aktif, status arsip; aksi Rename / Arsip-Aktifkan / Hapus hanya bila `can_manage`. Hapus memakai konfirmasi persis di Global Constraints. Setelah aksi sukses: `TF.projectcache.refresh` lalu `"tf:projects-changed"`.

- [ ] Step 1: tes gagal (helper murni: format daftar, aturan tampil aksi berdasarkan `can_manage`, teks konfirmasi). Step 2: FAIL. Step 3: implementasi. Step 4: semua tes → PASS.
- [ ] Step 5: commit `feat(projects): modal kelola project (online)`.

### Task 6 — Versi dan bukti E2E

**Files:** Modify `static/sw.js`, `static/index.html`, `webapp.py`, `tests/test_version.py` (versi SW); Create `temporary_files/e2e_project_scope.py` (Playwright, tidak dijalankan CI).

- E2E memakai server lokal (`uvicorn webapp:app`, DB sementara) dan dua akun (A owner workspace W, B anggota): (1) A membuat task baru, pilih "👥 W", ketik project baru "Uji W" → simpan; (2) B membuka form task baru, pilih "👥 W" → dropdown memuat "Uji W"; pilih "Pribadi" → "Uji W" tidak ada; (3) B membuka Kelola project W → "Uji W" tanpa tombol hapus; A melihat tombol hapus; (4) A rename "Uji W" → "Uji W2", task W ikut. Simpan screenshot tiap langkah ke `temporary_files/e2e_project_scope/`.
- [ ] Step 1: naikkan versi SW di semua tempat. Step 2: jalankan E2E, semua langkah lulus, screenshot tersimpan. Step 3: `npm test`, pytest, `check_inline_scripts` → PASS.
- [ ] Step 4: commit `chore: SW vNNN + E2E project per scope`.

## Di luar cakupan

- `base_rev` untuk task (task tetap LWW; `project_id` di payload sudah menutup kasus rename/hapus basi).
- Membuat/kelola project saat offline; memindahkan task antar scope; project untuk note/mindmap/drawing.
