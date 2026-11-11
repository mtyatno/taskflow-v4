# Checklist bertingkat — PR B (tampilan) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** tampilan checklist bertingkat di detail task (modal + panel Live Edit) dan halaman Fokus — sub butir menjorok, seret ⠿ (mouse + sentuh), Tab/Shift+Tab saat mengetik, Alt+↑/↓, menu ⋯ (ubah teks, tambah sub butir, jadikan sub, naikkan level, hapus), lipat yang diingat per perangkat — plus slider Progress terkunci "Otomatis dari checklist" dan angka progress yang langsung sampai ke daftar task, Timeline, dan perangkat lain. Server sudah ada (PR A #129, `aa910a4`).

**Architecture:** logika pohon murni di modul baru `static/offline/checklist.js` (`TF.checklist`, pola UMD `taskdetail.js`) — urutan pre-order dengan aturan pemutus siklus yang sama dengan `checklist_tree.py`, hitungan level atas, target indent/outdent/geser, target jatuh saat seret, pemindahan lokal (optimistis) yang hasilnya sama dengan `POST /api/subtasks/{id}/move`, penyimpanan lipat, dan `adoptTaskProgress` (menulis `progress`/`checklist_total` ke record task lokal tanpa `dirty`/`rev`/`base_rev`). Satu komponen React `ChecklistTree` dipakai detail dan Fokus. `syncpull.js` mengadopsi `progress`/`checklist_total` sebagai field turunan (`TASK_DERIVED`, ADR-048).

**Tech Stack:** SPA React satu berkas `static/index.html` (sudah terkompilasi: tulis `React.createElement`, bukan JSX), `static/app.css`, modul `static/offline/*.js` (UMD, diuji `node --test` dengan `tests/offline/setup.js`), service worker `static/sw.js`, pytest (`tests/test_whatsnew.py`, `tests/test_sw_precache_node.py`, `tests/test_app_update_node.py`), Playwright E2E (`temporary_files/`).

**Spec:** `docs/superpowers/specs/2026-11-06-checklist-bertingkat-design.md` — §2 (K1–K17, D1–D11), §6 Tampilan, §7 Interaksi, §9 Offline, §11.1/§11.3/§11.4, §12 PR B, dan **"Catatan implementasi PR A"** (aturan pemutus siklus, pill `clampProgress`, `TASK_DERIVED` wajib, judul kosong). ADR-048.

**Basis kode:** `main` @ `6182810` (SW `taskflow-v501-beban-tim`, `app.css?v=384`, ADR terakhir ADR-049; PR A server sudah di produksi).

## Fakta hasil eksplorasi (titik sentuh)

| Lapisan | Lokasi | Keadaan sekarang |
|---|---|---|
| Modul murni | `static/offline/taskdetail.js` (UMD: `module.exports` di Node, `root.TF.taskdetail` di browser; `clampProgress` membulatkan ke kelipatan 5 `:112`) | pola untuk `checklist.js` |
| Muat modul | `<script src="/static/offline/taskdetail.js">` `index.html:319`; `STATIC` `sw.js:32` | `checklist.js` belum ada |
| Pill Progress | `ProgressPill` `index.html:9108` (slider `step 5`, preset, `clampProgress(value)` untuk tampilan); `DetailChips` `:9076` meneruskan `progress`, `onProgress*` dari `TaskDetailBody` `:10316–10330` | tanpa kunci |
| Tab + checklist detail | `DetailTabs` `:9599`; `ChecklistRow` `:9693` (× "Hapus butir"); state `subtasks`/`loadingSubs` `:9826–9830`, muat `:9943–9952`, `handleToggle`/`handleAddSub`/`handleDeleteSub` `:10002–10038`, tab awal `:10056–10068`, `doneCount/totalSubs/progress` `:10175–10177`, panel `tabPanel("checklist", …)` `:10528–10576` (kotak `MentionInput` "Butir checklist baru", Enter tetap terbuka, Escape tutup) | datar |
| Detail → daftar | `onSaved` + `onRefreshRef` (debounce 500 ms) `:9893–9925`; `useTaskAutosave` `:8711` → `TF.liveedit` (`mergeExternal` `liveedit.js:210`: field yang tidak di-edit pengguna ikut data baru; `progressValue` tanpa pembulatan `:138`) | – |
| Form edit lengkap | `TaskFormModal` `:6110` (`progress: task?.progress` `:6134`), slider `:7967–7995` | tanpa kunci |
| Fokus | `FocusSubtasks` `:12642` (polling 15 dtk, `onCount(taskId, {subDone, subTotal})`, kotak "Tambah item checklist, tekan Enter" + tombol "Tambah", daftar `ul.ftask-sublist` > `button.ftask-sub`), dipasang di `FocusTaskItem` `:11388`; `TodayFocusView` `:13351`; segarkan daftar = `window.__refreshTasks` (`= fetchAll` `:44312`) | datar, tanpa hapus |
| Menu | `DetailPopover` `:8842` (`role`, `className`, portal, Escape/klik luar menutup, fokus kembali ke jangkar); menu "Aksi lain" `DetailTopBar` `:9035–9060` (`role: "menu"`, `td-menu`) | pola menu ⋯ |
| Seret | `kanbanDragStart` / `kanbanDragShouldStart` `:17858–17872` (mouse ≥ 6 px; sentuh tahan ≥ 250 ms tanpa geser); seret pin sidebar `:2476–2600` (pointer events, `setPointerCapture`, `touchmove` non-pasif, tekan `contextmenu`, teardown saat `pointerup` hilang) | pola seret vertikal |
| Glyph | `FocusGlyph`/`ViewGlyph` `:10921`, `:10962`: SVG inline karena `ui-components.js` bisa tertahan di cache lama; `Icon` (`check`, `x`, `menu`, `chevronRight`, `chevronDown`, `edit`, `trash`, `plus`) | tanpa ikon pegangan/⋯ |
| Sinkron | `syncpull.js` `TASK_DERIVED` `:199`, `ONLY_IF_SENT` `:202`, `adoptTaskDerived` `:210` (hanya record bersih yang `base_rev` sama, lewat `TFdb.mutate` + `sameRecState`); `hydrate.js` `COPY` `:18` (+ `coreFromServer` `:49`); `idmap.cidOf("task", serverId)` `idmap.js:26`; `TFdb.mutate` `db.js:237` | `progress` bukan turunan; `checklist_total` tidak disalin |
| Rute lokal | `taskroutes.js:133–149`: GET `/api/tasks/<id numerik>/subtasks` diteruskan ke jaringan; `/api/subtasks/*` tidak punya rute lokal | tetap (Fase 1 online) |
| CSS | blok `/* ── Detail task: awal ── */` `app.css:5178` … `akhir` `:5383` (`.td-check-row` `:5337`, `.td-check-del` `:5341–5343`, `.td-menu` `:5230`); Fokus `.ftask-sub*` `:3856–3864` | – |
| Versi | `CACHE` `sw.js:1`; `window.__SW_VERSION` + fallback `index.html:270`, `:28168`; `app.css?v=384` `index.html:102` + `sw.js:11`; tes yang mengunci string versi (`grep -rln "taskflow-v501-beban-tim" tests/` selain whatsnew) | v501 |
| Tes yang mengunci UI lama | `tests/offline/task_detail_redesign.test.js` (`ChecklistRow`, "Hapus butir", teks tab), `tests/offline/focus_child_counts.test.js` (`FocusSubtasks` teks/aria), `tests/offline/focus_filter_ui.test.js` (stub `FocusSubtasks`), `tests/offline/theme_guard.test.js` (CSS token), `tests/offline/syncpull.test.js`, `tests/offline/hydrate.test.js` | – |
| E2E lama | `temporary_files/e2e_detail_redesign.py` (B-3 checklist: × "Hapus butir"), `e2e_live_edit.py`, `e2e_task_detail_body.py`, `e2e_focus_page.py`, `e2e_checklist_pr_a.py` (mengunci perilaku klien LAMA — sebagian ceknya akan berubah) | – |

## Keputusan rencana (controller)

- **R1 — `static/offline/checklist.js` (`TF.checklist`), murni kecuali `adoptTaskProgress`.** Ekspor:
  - `percent(done, total)` (rumus D10; `total 0 → null`), diuji dengan `tests/fixtures/checklist_percent_vectors.json` (berkas yang sama dengan pytest).
  - `preorder(items)` → salinan + `depth` + `parent_id` efektif; saudara urut `(sort_order NULL→0, id)`; yatim/lintas task/siklus → level atas; siklus diputus pada anggota `(sort_order NULL→0, id)` terkecil (sama dengan `checklist_tree.py`). Iteratif.
  - `topLevelCounts(items) → {done, total}`; `childCounts(items, id) → {done, total}` (anak langsung, untuk chip lipat); `descendantIds(items, id)`.
  - `visibleRows(items, collapsedSet)` → baris pre-order yang tampil, tiap baris `{item, depth, hasChildren, collapsed}`.
  - `indentTarget(items, id)` / `outdentTarget(items, id)` / `siblingMoveTarget(items, id, dir)` → `{parent_id, index}` atau `null` (spec §7.2: indent = anak terakhir saudara sebelumnya; outdent = tepat di bawah induk; saudara berikutnya tetap).
  - `dropRange(rows, gap) → {min, max}` dan `dropTarget(items, rows, dragId, gap, depth) → {parent_id, index} | null` (spec §7.1; `rows` = baris tampil tanpa subtree yang diseret; `null` bila posisi sama; jatuh sebagai anak butir terlipat = anak terakhir).
  - `applyMove(items, id, parent_id, index)` → daftar baru pre-order dengan `sort_order` dinomori ulang `0..n−1` di kelompok lama dan baru — semantik `index` sama dengan server (posisi akhir setelah butir dikeluarkan; `null` = akhir; clamp).
  - `maxAddDepth(items)` dan `addParentFor(items, depth)` (kotak tambah bawah, spec §7.3).
  - `autoScrollDelta(pointerY, rect)` (vertikal, 40 px dari tepi, maks 16 px/frame; pola `kanbanAutoScrollDelta`).
  - `COLLAPSE_KEY = "tf_check_collapsed"`, `COLLAPSE_MAX = 500`, `loadCollapsed(storage)`, `saveCollapsed(storage, ids)` (yang tertua dibuang; setiap akses `try/catch`; JSON rusak → kosong).
  - `lockFor(task, counts)` → `{done, total, percent}` bila terkunci (`counts.total > 0`), `{pending: true}` bila hitungan belum dimuat tetapi `task.checklist_total > 0`, `null` selain itu.
  - `adoptTaskProgress(serverTaskId, tp) → Promise<boolean>`: `idmap.cidOf("task", id)` → `TFdb.mutate("tasks", cid, cur => …)` menulis `progress = tp.progress` dan `checklist_total = tp.total` **hanya bila berbeda**, tidak menyentuh `dirty`/`rev`/`base_rev`/`updated_at`; id tidak dikenal atau `tp` tidak sah → `false`.
- **R2 — Vektor pohon lintas bahasa** `tests/fixtures/checklist_tree_vectors.json`: kasus `{rows, expected: [[id, depth, parent_id_efektif], …]}` (urutan, kembar, `sort_order` NULL, yatim, lintas task, siklus 2 dan 3 anggota) dan kasus pindah `{rows, move: {id, parent_id, index}, expected}`. Dipakai `tests/offline/checklist.test.js` **dan** tes Python baru di `tests/test_checklist_tree.py` (`preorder`) + `tests/test_checklist_repo.py` (pindah lewat `move_subtask`), sehingga JS = Python = server.
- **R3 — `ChecklistTree`** (komponen baru, `function ChecklistTree(...)` di kolom 0, di antara `pinOverlayToScrollBox` dan `TaskDetailBody`): props `{ taskId, task, collaborators, variant /* "detail" | "focus" */, autoRefreshMs, onCounts, onProgress, focusMode }`. Memuat `GET /api/tasks/{id}/subtasks` sendiri; `onCounts({done, total, loaded: true})` (level atas) sesudah muat pertama (gagal = 0/0) dan setiap berubah; antrean mutasi berurutan (D9); optimistis untuk pindah dan ubah teks, menunggu respons untuk tambah/centang/hapus; galat → toast spec §6.7 + muat ulang; `task_progress` → `TF.checklist.adoptTaskProgress(...)` lalu `onProgress(tp)`. `autoRefreshMs` ditunda selama sibuk (seret, kotak isian berisi teks, menu terbuka, antrean belum kosong). Render `ul`/`li` bersarang; indentasi lewat properti CSS `--td-depth: min(depth, 6)` (bukan warna inline). Task dengan id belum tersinkron (cid non-angka) → perilaku sekarang (daftar kosong, tambah dinonaktifkan dengan keterangan yang sudah ada bila ada; jangan memanggil endpoint `/api/subtasks/*`).
- **R4 — Glyph inline `ChecklistGlyph({name, size})`** (SVG inline, pola `FocusGlyph`): `grip` (6 titik), `more` (3 titik horizontal), `chevronRight`, `chevronDown`. Centang tetap `Icon name="check"` (sudah dipakai detail). Tanpa emoji.
- **R5 — Detail.** Tab Checklist memakai `ChecklistTree variant="detail"`; `ChecklistRow`, `handleToggle/handleAddSub/handleDeleteSub`, `subtasks/loadingSubs/newSub/adding` untuk checklist dihapus; label tab "Checklist (N)" dan `initialTab` memakai `counts.total` (level atas); bar `.td-check-bar` + `selesai/total` di atas daftar (level atas). `onProgress` → `onRefreshRef.current?.()` (bukan simpan Live Edit).
- **R6 — Kunci Progress (K2).** `ProgressPill` + `DetailChips` menerima `locked` (`TF.checklist.lockFor`): tampilan memakai angka apa adanya (bukan `clampProgress`), `aria-label` "Progress N%, otomatis dari checklist", popover: slider `disabled`, preset disembunyikan, "Otomatis dari checklist (d/t)" (tanpa "(d/t)" bila `pending`), tombol "Buka Checklist" (pindah tab + tutup popover). Live Edit tidak pernah memanggil `sf("progress")` saat terkunci (slider nonaktif). `TaskFormModal`: `task.checklist_total > 0` → slider `disabled` + "Otomatis dari checklist" dan `progress` **tidak dikirim** saat simpan (server toh mengabaikan; menghindari bump `updated_at` sia-sia).
- **R7 — Fokus.** `FocusSubtasks` mempertahankan cangkang (bar `ftask-progress` + "d/t selesai", "Belum ada checklist.", kotak "Tambah item checklist, tekan Enter" + "Tambah") dan memakai `ChecklistTree variant="focus" autoRefreshMs={15000}` untuk daftar (kotak tambah bawahnya juga mendukung Tab/Shift+Tab). `onCounts` → `onCount(taskId, {subDone, subTotal})` level atas. `onProgress` → `window.__refreshTasks?.()`.
- **R8 — Sinkron.** `hydrate.js` `COPY` + `checklist_total` (bawaan 0, juga di `coreFromServer`); `syncpull.js` `TASK_DERIVED` + `progress`, `checklist_total`, `ONLY_IF_SENT` + `checklist_total`. `syncpush.js` tidak berubah.
- **R9 — Teks UI persis** spec §6.7 + yang dipertahankan; tanpa emoji di komponen baru; CSS hanya token di blok "Detail task" (dijaga `theme_guard.test.js`), tanpa `border-left`.
- **R10 — Rilis:** `taskflow-v502-checklist-bertingkat` (cek `main` saat merge; bila bentrok ikuti PROTOCOL §4 butir 4), `app.css?v=385`, `checklist.js` di `STATIC` + `<script>` setelah `taskdetail.js`, whatsnew draf spec §12 (judul "Checklist bertingkat"). `node compile.js` dua kali tanpa diff; `node temporary_files/check_inline_scripts.js` OK.
- **R11 — `e2e_checklist_pr_a.py`** mengunci perilaku klien LAMA (mis. detail menghitung semua butir, progress tidak sampai). Di PR B skrip itu **tidak dijalankan sebagai regresi**; cek server-nya dipindah/ditiru di E2E baru bila relevan. Dicatat di docstring skrip lama.

## Global Constraints

- Tanpa perubahan server (`*.py` di akar, skema). Semua perubahan di `static/**`, `tests/**`, `temporary_files/**`, dokumen.
- `static/index.html`: tulis `React.createElement` (boleh `/*#__PURE__*/`); komponen baru `function Nama(...) {` di kolom 0 dan `}` di kolom 0; tidak ada fungsi lain di antara `TaskDetailBody` dan `TaskDetailModal`.
- Modul baru dan berkas yang di-precache harus git-tracked dan ada di `STATIC` + `<script>`.
- Komentar dan nama tes berbahasa Indonesia; TDD per tugas; commit kecil per tugas dengan trailer atribusi sesi; push hanya di tugas terakhir.
- Verifikasi standar per tugas: `npm test` (basis: semua lulus kecuali pra-ada `draw_local_reactive`), `python3 -m pytest tests/ -q -p no:cacheprovider` (basis 1635 passed / 1 skipped dengan `node_modules`), `node temporary_files/check_inline_scripts.js`.
- PR dibuka sebagai **DRAFT**; merge hanya atas "merge dan deploy". Deploy statis — **tanpa restart** (tidak ada perubahan Python).

## Review Focus

1. **Kesepakatan klien–server:** `preorder`/`applyMove`/hitungan JS = Python = server (vektor bersama); respons `move` mengganti daftar tanpa kedipan/urutan lompat; tidak ada permintaan yang mengirim `parent_id` mentah tidak sah.
2. **Progress satu sumber:** setelah centang/tambah/hapus/pindah, daftar task, pill, Timeline, dan perangkat lain menampilkan angka checklist; Live Edit tidak pernah menyimpan `progress` saat terkunci; `adoptTaskProgress` tidak membuat record dirty atau konflik.
3. **Seret di HP:** gulir biasa tidak memulai seret; tahan ⠿ memulai; tidak ada menu konteks/seleksi teks liar; teardown bersih saat `pointercancel`; auto-scroll dalam modal/panel/Fokus.
4. **Keyboard dan aksesibilitas:** Tab hanya ditangkap di kotak isian (K14); fokus tetap di butir yang dipindah; `aria-expanded`, `role="checkbox"`, menu `role="menu"`, pengumuman `aria-live`.
5. **Tidak ada regresi** di detail (tab lain, Live Edit, judul/tag), Fokus (badge, catatan, lampiran, polling), daftar task, dan sinkron offline.

---

### Task 1: Modul `TF.checklist` (murni) + vektor pohon lintas bahasa

**Files:**
- Create: `static/offline/checklist.js`, `tests/offline/checklist.test.js`, `tests/fixtures/checklist_tree_vectors.json`
- Modify: `static/index.html` (`<script>` setelah `taskdetail.js`), `static/sw.js` (`STATIC`), `tests/test_checklist_tree.py` + `tests/test_checklist_repo.py` (konsumsi vektor pohon)

**Interfaces (Produces):** semua ekspor R1 kecuali `adoptTaskProgress` (Task 2).

- [ ] **Step 1: Tes gagal** — `checklist.test.js`: vektor persen (berkas PR A), vektor pohon (urutan, depth, `parent_id` efektif), `topLevelCounts`, `childCounts`, `descendantIds`, `visibleRows` dengan lipatan, indent/outdent/sibling (butir pertama, level atas, ujung, induk terlipat), `dropRange` di setiap celah, `dropTarget` (larangan turunan sendiri, posisi sama → `null`, butir terlipat → anak terakhir), `applyMove` = vektor pindah, `maxAddDepth`/`addParentFor`, `autoScrollDelta`, lipat (batas 500, JSON rusak, `storage` melempar), 2.000 tingkat tanpa `RangeError`. Python: `preorder` dan `move_subtask` memenuhi vektor yang sama.
- [ ] **Step 2: FAIL. Step 3: Implementasi. Step 4: PASS** (`node --test tests/offline/checklist.test.js`, pytest dua berkas) + verifikasi standar (`test_sw_precache_node.py` harus hijau dengan entri `STATIC` baru).
- [ ] **Step 5: Commit** `feat(checklist): modul pohon checklist klien dan vektor lintas bahasa`

### Task 2: Sinkron — `adoptTaskProgress`, `TASK_DERIVED`, `COPY`

**Files:**
- Modify: `static/offline/checklist.js` (`adoptTaskProgress`), `static/offline/syncpull.js`, `static/offline/hydrate.js`, `tests/offline/checklist.test.js`, `tests/offline/syncpull.test.js`, `tests/offline/hydrate.test.js`

- [ ] **Step 1: Tes gagal** — `adoptTaskProgress`: menulis `progress`/`checklist_total`, tidak mengubah `dirty`/`rev`/`base_rev`/`updated_at`, tanpa tulis bila sama, id tak dikenal → `false`, record dirty tetap dirty (nilai progress ikut diperbarui — server mengabaikan `progress` saat push); `pullTasks`: record bersih dengan `updated_at` sama mengadopsi `progress` dan `checklist_total`; record dengan op tertunda tidak; dict server tanpa `checklist_total` tidak mengubah nilai lokal; `taskFromServer`/`coreFromServer` menyalin `checklist_total` (bawaan 0).
- [ ] **Step 2–4** + verifikasi standar. **Step 5: Commit** `feat(sync): progress dan checklist_total diadopsi sebagai field turunan`

### Task 3: `ChecklistTree` — tampil, centang, tambah, lipat, hitungan + pasang di detail

**Files:**
- Modify: `static/index.html` (`ChecklistGlyph`, `ChecklistTree`; `TaskDetailBody` tab Checklist; hapus `ChecklistRow`), `static/app.css` (blok Detail task: `.td-tree`, `.td-tree-row`, `.td-tree-grip`, `.td-tree-fold`, `.td-tree-chip`, `.td-tree-more`, `--td-depth`, `@media (max-width: 640px)` 16 px), `tests/offline/task_detail_redesign.test.js`
- Create: `tests/offline/checklist_tree_ui.test.js` (tes sumber `fnSource` + render React di Node bila pola sudah ada di repo, mis. `liveedit_ui.test.js`)

**Cakupan:** R3 (muat, `onCounts`, antrean, galat, `adoptTaskProgress` + `onProgress`), R4, R5; baris: ⠿ (belum aktif), ▸/▾ + chip "d/t", centang (`changed_ids`), teks, ⋯ (belum aktif); kotak tambah bawah dengan `depth` (Tab/Shift+Tab, Enter tetap terbuka, Escape reset), lipat tersimpan.

- [ ] **Step 1: Tes gagal** (sumber + perilaku murni yang dipanggil), termasuk teks persis dan larangan emoji/`border-left`. **Step 2–4.** **Step 5: Commit** `feat(detail): checklist bertingkat — tampil, centang, tambah, lipat`

### Task 4: Ubah teks, menu ⋯, keyboard, hapus

**Files:** `static/index.html` (`ChecklistTree`), `static/app.css`, `tests/offline/checklist_tree_ui.test.js`

**Cakupan:** spec §6.3 (menu + aturan nonaktif), §7.2 (Tab/Shift+Tab di kotak ubah teks — simpan teks dulu lalu pindah, kotak tetap terbuka; Alt+↑/↓ di elemen mana pun dalam baris; fokus dicari ulang menurut id), §7.3 "Tambah sub butir" (kotak di bawah turunan terakhir, Tab tidak ditangkap), §7.4 (klik teks → `MentionInput`; Enter/blur simpan; kosong kembali; Escape batal), §7.6 (`window.confirm("Hapus «judul» beserta N sub butir?")` hanya bila punya turunan; `deleted_ids`), pengumuman `aria-live`.

- [ ] **Step 1–4.** **Step 5: Commit** `feat(detail): checklist — ubah teks, menu butir, Tab/Shift+Tab, Alt+panah, hapus`

### Task 5: Seret ⠿

**Files:** `static/index.html` (`ChecklistTree`), `static/app.css` (garis penanda, subtree redup), `tests/offline/checklist_tree_ui.test.js`

**Cakupan:** spec §7.1 dengan `kanbanDragStart`/`kanbanDragShouldStart` dan pola seret pin sidebar (`:2476–2600`): mulai hanya dari ⠿; `setPointerCapture`; `touchmove` non-pasif dicegah hanya selama seret; tekan `contextmenu`; Escape batal; teardown saat `pointerup`/`pointercancel` hilang; ukur baris sekali saat mulai (tanpa subtree); tingkat dari geseran horizontal (`indentPx` 20/16) dibatasi `dropRange`; garis penanda berindentasi; auto-scroll wadah gulir terdekat (`autoScrollDelta`); butir terlipat tujuan dibuka; hasil `dropTarget` → `applyMove` optimistis → antrean `move`.

- [ ] **Step 1–4.** **Step 5: Commit** `feat(detail): seret butir checklist beserta turunannya`

### Task 6: Kunci Progress (pill + form edit lengkap)

**Files:** `static/index.html` (`ProgressPill`, `DetailChips`, `TaskDetailBody`, `TaskFormModal`), `static/app.css`, `tests/offline/task_detail_redesign.test.js`, `tests/offline/checklist_tree_ui.test.js`

**Cakupan:** R6. Tes: pill terkunci tidak memanggil `clampProgress` untuk tampilan, slider `disabled`, preset tidak dirender, teks persis, "Buka Checklist" memanggil pindah tab; `TaskFormModal` tidak mengirim `progress` bila `checklist_total > 0`.

- [ ] **Step 1–4.** **Step 5: Commit** `feat(detail): progress otomatis dari checklist, slider terkunci`

### Task 7: Halaman Fokus

**Files:** `static/index.html` (`FocusSubtasks`), `static/app.css`, `tests/offline/focus_child_counts.test.js`, `tests/offline/focus_filter_ui.test.js`

**Cakupan:** R7; badge level atas; polling ditunda saat sibuk; teks lama dipertahankan.

- [ ] **Step 1–4.** **Step 5: Commit** `feat(fokus): checklist bertingkat di halaman Fokus`

### Task 8: E2E

**Files:** Create `temporary_files/e2e_checklist_tree.py` (C-1…C-9 spec §11.4; panel 1280 px terang; modal dan Fokus 375 px gelap). Modify E2E lama sesuai UI baru (`e2e_detail_redesign.py` B-3 × → ⋯ Hapus, `e2e_live_edit.py`, `e2e_task_detail_body.py`, `e2e_focus_page.py`); docstring `e2e_checklist_pr_a.py` (R11).

- [ ] **Step 1:** skrip baru N/N. **Step 2:** regresi keempat skrip (kegagalan pra-ada dibuktikan di `main`). **Step 3: Commit** `test(e2e): checklist bertingkat di detail, Fokus, dan progress`

### Task 9: Rilis

**Files:** `static/sw.js`, `static/index.html`, `static/whatsnew.json`, tes yang mengunci versi.

- [ ] **Step 1:** R10 + PROTOCOL §4 butir 1–3, 5. **Step 2:** `node compile.js` 2× tanpa diff; `check_inline_scripts`. **Step 3: Commit** `chore(release): SW v502 checklist bertingkat`

### Task 10: Verifikasi akhir, handover, review akhir, PR draft

- [ ] Verifikasi penuh (pytest, npm, compile, inline, E2E angka); catatan implementasi PR B di spec; `.agents/CURRENT_STATE.md` + `SESSION_LOG.md`; review akhir seluruh branch oleh reviewer terpisah (Review Focus 1–5); push + PR **DRAFT** "Checklist bertingkat — PR B: tampilan" (deploy statis, tanpa restart; verifikasi pasca-deploy: Pengaturan → versi `taskflow-v502-…`, modal "Apa yang baru", seret dan Tab di detail, slider terkunci).

---

## Keputusan untuk pemilik

Tidak ada pertanyaan baru — semua perilaku sudah diputuskan di spec (K1–K17). Rencana ini mengesahkan: glyph inline (bukan `ui-components.js`) untuk ⠿/⋯/panah lipat; `TaskFormModal` tidak mengirim `progress` untuk task bercheklist; E2E PR A tidak lagi dipakai sebagai regresi setelah PR B.
