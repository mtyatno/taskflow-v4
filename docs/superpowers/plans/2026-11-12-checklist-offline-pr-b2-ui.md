# Checklist offline (Fase 2) — PR B2 (aplikasi) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** checklist bisa dipakai penuh saat offline — semua checklist diunduh ke perangkat, setiap aksi `ChecklistTree` dilayani rute lokal (IndexedDB) dan masuk antrean, antrean dikirim berurutan saat online, dan perangkat hanya mengambil ulang checklist yang versinya berubah. Server sudah siap (PR A2 #133, `f293bcb`, di produksi).

**Architecture:** modul baru `static/offline/checklistrepo.js` (penyimpanan `subtasks`, rev tersimpan di `_meta`, tulis butir + entri `_outbox` dalam SATU transaksi IndexedDB, ganti isi dari snapshot server, penanda kesiapan di memori untuk keputusan routing sinkron) dan `static/offline/checklistroutes.js` (rute lokal yang meniru respons server). `TF.checklist` (Fase 1) tetap satu-satunya logika pohon. `syncpush.js` mendapat handler entitas `subtasks`; `syncpull.js` mendapat `pullChecklists` + `checklist_rev` sebagai field turunan. `ChecklistTree` nyaris tidak berubah.

**Tech Stack:** modul UMD `static/offline/*.js` (Node: `module.exports`; browser: `root.TF.*`), IndexedDB (`db.js`, `fake-indexeddb` di tes lewat `tests/offline/setup.js`), `node --test`, SPA `static/index.html` (terkompilasi: `React.createElement`), Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-11-11-checklist-offline-fase2-design.md` — §2 (F1–F7, E1–E7), **§4 Aplikasi** (termasuk §4.2 aturan rev 0), §5, §6 (node/E2E), §7 PR B2, dan "Catatan implementasi PR A2" (cid tidak dipakai ulang lintas task; `rev_bumped`). ADR-048, ADR-051.

**Basis kode:** `main` @ `cdb5fe5` (SW `taskflow-v502-checklist-bertingkat`, `app.css?v=385`; PR A2 di produksi + restart dikonfirmasi pemilik 2026-11-12 01.56 WIB). PR 1d-2 (rencana, menunggu pemilik) memesan v503 → PR B2 memakai **nomor bebas berikutnya saat merge** (v503 bila 1d-2 belum di-merge).

## Fakta hasil eksplorasi (titik sentuh)

| Lapisan | Lokasi | Keadaan sekarang |
|---|---|---|
| Store | `db.js`: store `subtasks` (indeks `task_cid`, `server_id`, `dirty`), `_meta` (`:135`), `_idmap`, `_outbox`; `ENTITY_STORES` | `subtasks` tidak pernah diisi |
| Antrean | `outbox.js` (`outboxAdd/All/Remove/ByEntity`); tulis record + antrean atomik = satu transaksi `[store, "_outbox"]` (pola `noterepo.js:307`); event `tf:outbox-queued` (`noterepo.js:287`) → `schedulePush` (`index.html:1006`) | – |
| Push | `syncpush.js` `pushOutbox` `:2475` (urut `qid`, `processOp`, klasifikasi galat: `__auth` berhenti, `__network` berhenti, lainnya `failed`), `parentCreatePending` `:613`, `pendingCreateCids`; analog entitas anak berbasis aksi: komentar catatan `opCommentCreate/Patch/Delete` `:2187–2300` | tanpa `subtasks` |
| Pull | `syncpull.js` `pullAndReconcile` (dipanggil `index.html:1308`), `TASK_DERIVED`/`ONLY_IF_SENT`/`adoptTaskDerived` (Fase 1 B: hanya kunci berbeda, lewati nilai yang diadopsi sesudah GET dimulai), `hydrate.js` `COPY`; siklus sinkron = pull semua entitas lalu `pushOutbox` di akhir (`index.html:1308–1372`) | tanpa `checklist_rev`, tanpa pull checklist |
| Routing | `index.html:815–845` `api.fetch` → `TF.taskroutes.shouldRouteLocally(router, method, url)` (SINKRON) → `router.dispatch`; `taskroutes.js:133–164` K6: GET `/api/tasks/<angka>/subtasks` → jaringan, cid → `[]` lokal; `/api/subtasks/*` tanpa rute lokal; `buildTaskRouter` `:166` mendaftarkan modul rute lain (`register…Routes(router)` `:362–367`) | checklist selalu jaringan |
| Id map | `idmap.js` `cidOf(type, serverId)`, `serverIdOf(cid)`, `setMapping` | – |
| Task lokal | `taskrepo.deleteTask(cid, opts)` `:408` | tidak membuang checklist |
| Pohon | `static/offline/checklist.js` (`preorder`, `applyMove`, `descendantIds`, `topLevelCounts`, `percent`, `adoptTaskProgress` + `checklist_adopted_at`, …); vektor `tests/fixtures/checklist_tree_vectors.json` | id dianggap angka |
| UI | `ChecklistTree` (`index.html`): penjaga "taskId bukan angka → tanpa `/api/subtasks/*`", `adoptTaskProgress(task.server_id ?? taskId, tp)`; toast `window.__showToast` | – |

## Keputusan rencana (controller)

- **R1 — Id campuran di `TF.checklist`.** Pembanding tie-break `(sort_order NULL→0, id)` menerima angka dan teks: angka sebelum teks, teks menurut `<` biasa. Vektor Fase 1 (semua angka) tetap lulus. Fungsi pohon menerima `id`/`parent_id` string. Tambah fungsi murni untuk rute lokal (hasil sama dengan server): `applyCreate(items, {id, task_id, title, parent_id, index})`, `applySetDone(items, id, done) → {items, changed_ids}`, `applyRename(items, id, title)`, `applyDelete(items, id) → {items, deleted_ids}` (`applyMove` sudah ada). Galat validasi → `{error: "PARENT_NOT_FOUND"|"CYCLE"|"EMPTY_TITLE"}`.
- **R2 — `checklistrepo.js`** (IndexedDB):
  - Record butir `{cid, server_id, task_cid, parent_cid, title, is_done, sort_order, created_at}`; bentuk API dibangun `itemsForTask(taskCid)` → pre-order dengan `id = server_id ?? cid`, `parent_id` = id induk (server_id ?? cid), `task_id` = id server task ?? cid.
  - Setiap aksi lokal: baca butir task → terapkan fungsi murni R1 → tulis perubahan butir + SATU entri `_outbox` dalam satu transaksi `["subtasks", "_outbox"]` → hitung `task_progress` lokal → tulis `progress`/`checklist_total` task lokal tanpa `dirty`/`rev`/`base_rev` dengan cap `checklist_adopted_at` (pakai/ekstrak dari `adoptTaskProgress`) → `tf:outbox-queued`.
  - Entri antrean: `{entity_type: "subtasks", cid, task_cid, op, payload}` (spec §4.4). Hapus butir yang `create`-nya belum terkirim → hapus entri `create` + semua entri antrean butir turunannya (yang juga belum terkirim), tanpa entri `delete`. Butir yang sudah terkirim → satu entri `delete` untuk akarnya (server berantai).
  - Rev tersimpan: `_meta` kunci `checklist_revs` (`{task_cid: rev}`); penanda unduhan awal selesai: `_meta` `checklists_hydrated` (true sesudah `pullChecklists` pertama sukses penuh).
  - **Kesiapan sinkron di memori** (`isReady()` dan `knowsTask(id)`/`knowsItem(id)`): dimuat saat modul start (async dari `_meta`/store) dan diperbarui oleh pull dan aksi lokal, supaya `shouldRouteLocally` tetap sinkron.
  - `replaceTaskChecklist(taskCid, serverItems, rev)` (pull): satu transaksi; pertahankan `cid` butir yang dikenal (`_idmap` jenis `"subtask"`), cid baru untuk butir baru, hapus yang hilang; tulis rev tersimpan.
  - `purgeTask(taskCid)`: hapus butir + entri antrean `subtasks` task itu + rev tersimpan (dipanggil saat task dihapus lokal / hilang dari server).
- **R3 — `checklistroutes.js`** (didaftarkan di `buildTaskRouter`): rute spec §4.3 dengan respons bentuk server (`items`, `changed_ids`, `deleted_ids`, `task_progress {done,total,progress}` tanpa `rev`); galat validasi → 422 berteks persis server (Fase 1); butir/task tak dikenal → 404 "Subtask not found"/"Task not found". `shouldRouteLocally`: checklist → lokal bila `isReady()` dan (task/butir dikenal lokal ATAU task belum tersinkron); selain itu jaringan (perilaku sekarang, termasuk sebelum unduhan awal). GET untuk task yang dikenal tetapi belum punya rev tersimpan (mis. akses baru) → jaringan.
- **R4 — Push (`syncpush.js`, handler `subtasks`)**: spec §4.4. Menunggu `create` task (`task_cid`) dan `create` induk (`parent_cid`) yang tertunda (`pending` dari `pendingCreateCids`). `create` sukses → `_idmap` + `server_id`. Rev: majukan rev tersimpan hanya bila `task_progress.rev_bumped` **dan** `rev` = tersimpan + 1; `rev` = tersimpan → tetap; selain itu kosongkan (ADR-051). Adopsi progress lewat `adoptTaskProgress`. Galat: jaringan/401/429/5xx → seperti entitas lain (op tetap); 403/404/422 → op dibuang, entri antrean lain untuk butir yang tidak punya `server_id` dan tidak punya `create` tertunda ikut dibuang, rev tersimpan task dikosongkan, `result.checklistRejected++`; `delete` 404 = sukses. Akhir `pushOutbox`: `checklistRejected > 0` → event `tf:checklist-rejected {count}` (sekali).
- **R5 — Pull (`syncpull.js`)**: `checklist_rev` masuk `TASK_DERIVED`, `ONLY_IF_SENT`, `COPY`. `adoptTaskDerived` melewati `progress`/`checklist_total` untuk task yang punya entri antrean `subtasks` (E5). `pullChecklists(rawFetch)` (spec §4.2 termasuk aturan rev 0) — langkah sinkron baru di `index.html` setelah `pullAndReconcile` (sebelum push); kegagalannya tidak menggagalkan siklus. Task yang hilang dari server (pull task membuangnya) → `purgeTask`.
- **R6 — UI**: hapus penjaga "taskId bukan angka" di `ChecklistTree`; `adoptTaskProgress` tetap aman dipanggil (respons lokal tanpa `rev`). Pendengar `tf:checklist-rejected` → `window.__showToast("N perubahan checklist dibatalkan karena checklist sudah berubah di perangkat lain.", "error")` (satu kali per event). `taskrepo.deleteTask` → `checklistrepo.purgeTask`.
- **R7 — Rilis**: SW nomor bebas berikutnya (v503 bila 1d-2 belum), `checklistrepo.js` + `checklistroutes.js` di `STATIC` + `<script>` (setelah `checklist.js`, sebelum `taskroutes.js` bila `taskroutes` me-`req` modul itu), whatsnew "Checklist kini bisa dipakai saat offline. Perubahan terkirim otomatis begitu tersambung lagi." (judul mis. "Checklist offline"). `app.css?v` hanya bila CSS berubah.

## Global Constraints

- Tanpa perubahan server (`*.py` di akar). Semua di `static/**`, `tests/**`, `temporary_files/**`, dokumen.
- `static/index.html`: tulis `React.createElement`; `node compile.js` tanpa diff; `node temporary_files/check_inline_scripts.js` OK; anggaran baris `plugin_host_wiring.test.js` (`CHECKLIST_PRB_EXTRA` atau konstanta baru) diperbarui bila baris berubah.
- Pagar penulis store (`tests/offline/taskext_writers_fence.test.js`) dan tes sejenis harus mencatat penulis baru.
- Komentar dan nama tes berbahasa Indonesia; TDD; commit per tugas dengan trailer atribusi sesi; push hanya di tugas terakhir.
- Verifikasi standar: `npm test` (basis diukur di awal; satu-satunya gagal pra-ada `draw_local_reactive`), `python3 -m pytest tests/ -q -p no:cacheprovider`, check inline, compile.
- PR DRAFT; merge hanya atas "merge dan deploy". Deploy statis (tanpa restart).

## Review Focus

1. **Tidak ada kehilangan data:** aksi offline bertahan setelah muat ulang; urutan aksi = urutan kirim; tidak ada butir ganda saat kirim ulang; pull tidak menimpa perubahan lokal yang belum terkirim (isi maupun progress); `create`+`delete` sebelum terkirim dibersihkan tuntas.
2. **Kesepakatan klien–server:** hasil rute lokal = hasil server untuk aksi yang sama (fungsi murni bersama + vektor); rev tersimpan hanya maju sesuai ADR-051; ambil ulang terjadi ketika perlu dan tidak berulang tanpa perlu.
3. **Routing aman:** sebelum unduhan awal / untuk task tak dikenal perilaku sama dengan v502; tidak ada jalur yang melayani data lokal kosong untuk task yang sebenarnya punya checklist di server.
4. **Bentrok dan galat:** klasifikasi galat (sementara vs ditolak), pembersihan entri yatim, pesan sekali, tidak macet (antrean tidak tersangkut selamanya).
5. **Tanpa regresi** Fase 1 (detail, Fokus, seret, kunci progress, `e2e_checklist_tree.py`) dan sinkron entitas lain.

---

### Task 1: `TF.checklist` — id campuran + fungsi aksi murni
**Files:** `static/offline/checklist.js`, `tests/offline/checklist.test.js`, vektor baru `tests/fixtures/checklist_action_vectors.json` (aksi create/set_done/rename/delete dengan hasil server — diuji juga di `tests/test_checklist_repo.py` lewat repository Python supaya JS = server).
- [ ] TDD R1. **Commit** `feat(checklist): id campuran dan aksi checklist murni untuk rute lokal`

### Task 2: `checklistrepo.js`
**Files:** baru `static/offline/checklistrepo.js`, `tests/offline/checklistrepo.test.js`; `<script>` + `STATIC`; pagar penulis.
- [ ] TDD R2 (atomik record + antrean, `itemsForTask` bentuk API, progress lokal tanpa dirty, kesiapan di memori, `replaceTaskChecklist` mempertahankan cid, `purgeTask`, create+delete belum terkirim). **Commit** `feat(checklist): penyimpanan checklist lokal dan antrean aksi`

### Task 3: Rute lokal
**Files:** baru `static/offline/checklistroutes.js`, `static/offline/taskroutes.js` (daftar + `shouldRouteLocally`), `tests/offline/checklistroutes.test.js`, `tests/offline/taskroutes.test.js`; `<script>` + `STATIC`.
- [ ] TDD R3 (setiap rute, bentuk respons persis, 422/404, routing sebelum/sesudah siap, task belum tersinkron, id server vs cid). **Commit** `feat(checklist): rute lokal checklist`

### Task 4: Push `subtasks`
**Files:** `static/offline/syncpush.js`, `tests/offline/syncpush_checklist.test.js`.
- [ ] TDD R4 (urutan, menunggu task/induk, `create` idempoten saat kirim ulang, `set_done`, `move` dengan id server induk, `delete` 404, ditolak vs sementara, pembersihan entri yatim, rev maju/tetap/kosong per `rev_bumped`, event sekali). **Commit** `feat(sync): kirim antrean checklist`

### Task 5: Pull checklist
**Files:** `static/offline/syncpull.js`, `static/offline/hydrate.js`, `static/index.html` (langkah sinkron), `tests/offline/syncpull_checklist.test.js`, `tests/offline/syncpull.test.js`, `tests/offline/hydrate.test.js`.
- [ ] TDD R5 (rev 0 tanpa unduh, batch 200, ganti isi, lewati task berantrean, E5 progress, hilang dari server → purge, gagal tidak menggagalkan siklus, `checklists_hydrated`). **Commit** `feat(sync): unduh checklist yang berubah`

### Task 6: UI dan penghapusan task
**Files:** `static/index.html` (`ChecklistTree` penjaga, pendengar toast), `static/offline/taskrepo.js` (`deleteTask` → `purgeTask`), tes terkait (`checklist_tree_ui.test.js`, `taskrepo*.test.js`).
- [ ] TDD R6. **Commit** `feat(checklist): checklist offline di tampilan`

### Task 7: E2E
**Files:** baru `temporary_files/e2e_checklist_offline.py`; regresi `e2e_checklist_tree.py`, `e2e_focus_page.py`, `e2e_detail_redesign.py` (`tabs`).
- [ ] Skenario spec §6 E2E: offline (`context.set_offline(True)`) → tambah, Tab, seret, centang, hapus, ubah teks → muat ulang offline → tetap → online → server sama + perangkat kedua sama; task baru offline + checklist; bentrok (perangkat lain menghapus butir yang diubah offline) → satu pesan; perangkat baru mengunduh semua checklist; progress daftar task berubah saat offline dan tidak melompat saat sinkron. **Commit** `test(e2e): checklist offline`

### Task 8: Rilis, review akhir, PR draft
- [ ] R7 + PROTOCOL §4; catatan implementasi PR B2 di spec; handover; review akhir (Review Focus 1–5); push + PR **DRAFT** "Checklist offline (Fase 2) — PR B2: aplikasi" (deploy statis; verifikasi pasca-deploy: Pengaturan versi baru, "Apa yang baru", mode pesawat → ubah checklist → online → perangkat lain sama).

## Keputusan untuk pemilik

Tidak ada — semua sudah diputuskan di spec Fase 2.
