# Halaman Fokus — pemilihan task (tab waktu, cari, chip, filter tersembunyi, kelompok) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Halaman Fokus Hari Ini mendapat:
- seksi ⭐ Target hari ini di atas bar filter;
- tab waktu Semua/Hari ini/Terlambat, kotak cari, dan chip cepat P1 P2 P3 Q1 Q3;
- lembar filter tersembunyi (Status default Next, Prioritas, Kuadran, satu Workspace › Project);
- daftar yang dikelompokkan per Workspace › Project dan bisa dilipat.

Semua pilihan diingat per perangkat. Cakupan "hari ini" dihitung dari satu fungsi dengan tanggal lokal.

**Architecture:**
- Logika murni di modul UMD baru `static/offline/focusfilter.js` (`window.TF.focusfilter`), diuji dengan `node --test`.
- `static/index.html` memakai modul itu di empat pemakai cakupan (Sidebar, TodayFocusView, Dashboard, `getFilteredTasks("today")`).
- Halaman Fokus mendapat komponen baru `FocusTargetSection`, `FocusFilterBar`, `FocusFilterSheet`, dan `FocusTaskGroups`. `FocusTaskItem` mendapat tombol ⭐.
- Hanya klien: tanpa perubahan server, skema, atau API.

**Tech Stack:** UMD JS + `node --test`; React tanpa JSX (`React.createElement`) di `static/index.html`; CSS `static/app.css`; service worker `static/sw.js`; Playwright Python untuk E2E.

**Spec:** `docs/superpowers/specs/2026-10-22-fokus-filter-task-design.md` (seluruhnya; ADR-027 di §12). Prototipe: artifact "Filter Halaman Fokus" v2.

## Global Constraints

- **Kode:** `React.createElement` tanpa JSX. Setiap akses `localStorage` lewat pola `zenStorage()` yang sudah ada di `TodayFocusView` + try/catch di modul. `todayISO` selalu `window.TF.tasklogic.todayLocalISO()`.
- **Cakupan** (spec §4.1): Q1, `timeBucket` late/today, `is_focused`, atau `String(id) === String(focusTaskId)`. Task archived selalu keluar; done keluar kecuali `includeDone`.
- **Bucket** (spec §4.2):
  - 10 karakter pertama `deadline` dibanding `todayISO`: `<` → `"late"`, `===` → `"today"`, selain itu `"none"`;
  - deadline kosong atau tak berbentuk `YYYY-MM-DD` → `"none"`;
  - done/archived tidak pernah `"late"`.
- **Filter default:** `{ time: "all", status: ["next"], pri: [], quad: [], proj: null }`. Urutan kanonis: `next, inbox, waiting, someday` / `P1..P4` / `Q1..Q4`. Chip cepat: `P1 P2 P3 Q1 Q3`. Di luar chip cepat ada `P4 Q2 Q4`.
- **Storage:** `tf_focus_filter` (JSON filter ternormalisasi) dan `tf_focus_collapsed` (JSON array `groupKey`, maksimal 200, yang tertua dibuang). Tidak dihapus saat logout. Kata pencarian tidak disimpan.
- **Kunci kelompok:** `(list_id == null || list_id === "" ? "p" : String(list_id)) + ":" + fold(project || "")`, dengan `fold` = huruf A–Z menjadi kecil saja (sama dengan `projectNameFold`).
- **Urutan kelompok:** Pribadi dulu, lalu workspace menurut label (`localeCompare("id", {sensitivity:"base"})`, lalu `list_id`). Di dalam scope, project menurut perbandingan string ter-`fold` (`<`/`>`), dengan "Tanpa project" paling akhir.
- **Urutan task:** P1 < P2 < P3 < P4 < lainnya → deadline terawal (tanpa deadline paling akhir) → judul (`localeCompare("id")`) → id.
- **Teks persis:**
  - Seksi: "Target hari ini", "Task hari ini".
  - Tab: "Semua", "Hari ini", "Terlambat" (grup `aria-label` "Waktu").
  - Cari: placeholder "Cari judul task…", `aria-label` "Cari task".
  - Tombol Filter: `aria-label` "Filter lainnya", ditambah ", N aktif" bila badge > 0.
  - Lembar: judul "Filter lainnya"; subjudul "Status", "Prioritas", "Kuadran", "Workspace › Project"; catatan "Default: Next saja. Kosongkan semua untuk menampilkan semua status.".
  - Label status: "Next", "Inbox", "Waiting", "Someday". Label kuadran: "Q1 Lakukan", "Q2 Rencanakan", "Q3 Delegasikan", "Q4 Singkirkan".
  - Opsi project "Semua"; aksi lembar "Reset" dan "Tampilkan N task".
  - Pil: "Status: Next, Waiting" (label status digabung ", ") atau "Semua status", `aria-label` "Hapus filter <label>". Chip "Reset".
  - Pesan: "Tidak ada task urgent!" + "Semua Q1, terlambat, dan deadline hari ini sudah selesai."; "Semua task hari ini sudah ada di Target."; "Tidak ada task yang cocok dengan filter ini." + tombol "Reset filter"; "N task berstatus lain disembunyikan · Tampilkan".
  - ⭐: "Tandai sebagai target hari ini" / "Lepas dari target hari ini".
  - Label kelompok: "Pribadi", "Workspace", "Tanpa project".
- **Kombinasi filter:** "atau" di dalam satu jenis, "dan" antarjenis. `status: []` = semua status. Query dicocokkan dengan `toLocaleLowerCase("id")`, spasi berulang dirapatkan, dan `trim()`.
- **Badge** `nonDefaultCount`:
  - +1 bila status ≠ `["next"]`;
  - +1 bila `proj` ada;
  - +1 per `P4`, `Q2`, `Q4` yang dipilih.
- **Breakpoint:** ≤ 768 px → lembar bawah `position: fixed` (maks 86vh) dengan latar redup. Di atasnya → panel `position: absolute` di bawah tombol Filter, rata kanan, lebar 340 px, latar transparan penangkap klik luar.
- **Aksesibilitas:**
  - `aria-pressed` pada tab, chip, dan ⭐;
  - `aria-expanded` pada judul kelompok dan tombol Filter (+ `aria-haspopup="dialog"`);
  - lembar `role="dialog"` + `aria-modal="true"` + `aria-labelledby`;
  - Esc / klik luar / "Tampilkan" menutup lembar, lalu fokus kembali ke tombol Filter; saat dibuka fokus pindah ke chip pertama, Tab berputar di dalam lembar;
  - di ≤ 768 px scroll `body` dikunci selama lembar terbuka;
  - target sentuh ≥ 36 px; `prefers-reduced-motion` mematikan transisi chevron dan lembar.
- **Rilis:**
  - SW + `app.css?v=` naik ke nomor kosong berikutnya. Saat plan ditulis: `main` v452 / 356, draft #77 v452 / 357. Jadi pakai **v454 `taskflow-v454-focus-filter`, `?v=358`**, dan cek ulang di Task 6.
  - Ubah di `sw.js` `CACHE`, `index.html` (`__SW_VERSION` di skrip awal body + fallback About + link css), `webapp.py` `sw_cache`, `tests/test_version.py`, dan semua tes yang mengunci versi (`grep -rl "v452" tests`).
  - Deploy: file statis; restart `taskflow-web`.
- **Verifikasi standar:** `export PATH=/home/claude/venv-alurik/bin:$PATH`, lalu:
  - `npm test` (hanya `draw_local_reactive` boleh gagal);
  - `python -m pytest tests/ -q`;
  - `node temporary_files/check_inline_scripts.js`.

## Review Focus

1. **Task aktif di luar cakupan dan berstatus non-Next** (P3, Q2, tanpa deadline, Waiting, dimulai dari halaman Tasks) harus muncul di Target, tidak pernah di `pool`, dan tidak tersembunyi oleh filter status. Ditest di Task 2 (`splitTarget`) dan Task 6 E2E (k).
2. **`is_overdue` server basi vs tanggal lokal:**
   - task ber-`deadline` hari ini dengan `is_overdue: true` (data IndexedDB lama) → bucket `today`, masuk tab Hari ini, dan barisnya tidak merah;
   - task ber-deadline kemarin dengan `is_overdue: false` → `late`.
   Ditest di Task 1 dan Task 4 (sumber `FocusTaskItem` memakai `timeBucket`).
3. **Filter project basi:** semua task project terpilih selesai → pil tetap ada, opsi di lembar ber-angka 0, dan muncul pesan "tidak ada yang cocok" + Reset. Reload tidak menghapusnya. Ditest di Task 2 (`projectOptions`) dan Task 6 E2E (h).
4. **Storage rusak atau diblokir:** `tf_focus_filter = "{rusak"`, `tf_focus_collapsed = "[1,{}]"`, atau `getItem` melempar → halaman tampil dengan default tanpa pageerror. Ditest di Task 1 (unit) dan Task 6 E2E (j).
5. **Nama panjang dan banyak pil di 375 px:** workspace + project 40 karakter dan lima pil aktif → tidak ada scroll horizontal. Judul kelompok terpotong elipsis, baris chip bergeser di dalam dirinya sendiri. Ditest di Task 6 E2E (l).

---

### Task 1: Modul `focusfilter.js` — cakupan, bucket, model filter, penyimpanan

**Files:**
- Create: `static/offline/focusfilter.js` (pola UMD `focuspage.js`; `root.TF.focusfilter`)
- Modify: `static/index.html` (tag `<script src="/static/offline/focusfilter.js">` tepat setelah `tasklogic.js`), `static/sw.js` (`STATIC`, setelah `/static/offline/tasklogic.js`)
- Test: `tests/offline/focusfilter.test.js`

**Interfaces:**
- Produces (`TF.focusfilter`):
  - konstanta: `FILTER_KEY`, `COLLAPSED_KEY`, `MAX_COLLAPSED = 200`, `STATUSES`, `PRIORITIES`, `QUADRANTS`, `QUICK_PRI = ["P1","P2","P3"]`, `QUICK_QUAD = ["Q1","Q3"]`, `DEFAULT_FILTER` (dibekukan, array di dalamnya juga);
  - `timeBucket(task, todayISO) -> "late"|"today"|"none"`;
  - `inTodayScope(task, { todayISO, focusTaskId = null, includeDone = false }) -> boolean`;
  - `normalizeFilter(raw) -> filter` (spec §5.2: `proj.key` string tak kosong ≤ 300, `label` ≤ 120 atau `""`);
  - `isDefaultStatus(status) -> boolean`, `nonDefaultCount(filter) -> number`, `isFilterDefault(filter) -> boolean` (semua field sama dengan default);
  - `readFilter(storage) -> filter`, `writeFilter(storage, filter) -> void`;
  - `readCollapsed(storage) -> string[]`, `writeCollapsed(storage, keys) -> void` (dedupe, string saja, simpan 200 terakhir).
  Semua tidak pernah melempar.

- [ ] **Step 1: Tulis test yang gagal** — `tests/offline/focusfilter.test.js` (`require("../../static/offline/focusfilter.js")`, `todayISO = "2026-10-22"`):
  - `timeBucket`:
    - `{deadline:"2026-10-21"}` → `late`, `"2026-10-22"` → `today`, `"2026-10-22T10:00"` → `today`, `"2026-10-23"` → `none`;
    - `null` / `""` / `"22-10-2026"` / `123` → `none`;
    - `{deadline:"2026-10-01", gtd_status:"done"}` → `none`;
    - `{deadline:"2026-10-22", is_overdue:true}` → `today`, `{deadline:"2026-10-21", is_overdue:false}` → `late` (Review Focus 2);
    - pergantian `todayISO` ke `"2026-10-23"` membuat task `"2026-10-22"` menjadi `late`.
  - `inTodayScope`:
    - masing-masing pemicu benar sendiri-sendiri: Q1, late, today, `is_focused: true`, `focusTaskId: 7` vs `id: "7"`;
    - `{quadrant:"Q2", deadline:"2026-11-01", gtd_status:"next"}` → false;
    - done → false, tetapi true dengan `includeDone`; archived → false walaupun `includeDone`.
  - `normalizeFilter`:
    - `null`, `"x"`, `[]` → sama dengan `DEFAULT_FILTER` tetapi objek baru (bukan referensi beku);
    - `{time:"week"}` → `"all"`;
    - `{status:["someday","next","next","x"]}` → `["next","someday"]`; `{status:"next"}` → `["next"]`; `{status:[]}` → `[]`;
    - `{pri:["P4","P1","P9"]}` → `["P1","P4"]`; `{quad:"Q1"}` → `[]`;
    - `proj` `{key:"p:a", label:"Pribadi · A"}` dipertahankan; `{key:""}`, key 301 karakter, atau `"p:a"` → `null`; label 200 karakter dipotong 120.
  - `nonDefaultCount`:
    - default → 0;
    - `status:["next","waiting"]` → 1, `status:[]` → 1;
    - `proj` → 1;
    - `pri:["P1","P4"]` → 1;
    - `quad:["Q2","Q4","Q1"]` → 2.
  - `isFilterDefault`: default → true; `time:"late"` → false.
  - Storage (fake `{getItem,setItem}` berbasis Map):
    - kosong → default;
    - `writeFilter` lalu `readFilter` → sama;
    - `"{rusak"` → default;
    - `getItem` atau `setItem` melempar → default / tidak melempar;
    - `storage = null` → default;
    - `readCollapsed` atas `"[1,{},\"p:a\",\"p:a\"]"` → `["p:a"]`;
    - `writeCollapsed` 250 kunci → yang tersimpan 200 terakhir.
  - Sumber: `index.html` memuat tag script `focusfilter.js` setelah `tasklogic.js`; `sw.js` `STATIC` memuat `/static/offline/focusfilter.js`.
- [ ] **Step 2: Jalankan → FAIL** — `node --test tests/offline/focusfilter.test.js`
- [ ] **Step 3: Implementasi** fungsi-fungsi di atas, plus tag script dan entri `STATIC`.
- [ ] **Step 4: Jalankan → PASS**; `npm test`.
- [ ] **Step 5: Commit** — `feat(fokus): modul focusfilter — cakupan, bucket waktu lokal, model filter`

---

### Task 2: Modul `focusfilter.js` — pencocokan, hitungan, kelompok, urutan

**Files:**
- Modify: `static/offline/focusfilter.js`
- Test: `tests/offline/focusfilter.test.js` (tambah)

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `groupKey(task) -> string`;
  - `comparePriority(a, b) -> number`;
  - `splitTarget(scope, focusTaskId) -> { target, pool }`. `target` = task aktif (bila ada di scope) di posisi pertama, lalu task `is_focused` lain diurutkan `comparePriority`. `pool` = sisanya, urutan masuk dipertahankan;
  - `matches(task, filter, { todayISO, query = "", except = null }) -> boolean`, dengan `except` ∈ `null|"time"|"status"`;
  - `timeCounts(pool, filter, opts) -> { all, today, late }`;
  - `statusCounts(pool, filter, opts) -> { next, inbox, waiting, someday }`;
  - `hiddenByStatus(pool, filter, opts) -> number`;
  - `groupTasks(tasks, sharedLists) -> Array<{ key, listId, workspaceLabel, projectLabel, tasks }>`, dengan task dalam kelompok terurut `comparePriority`;
  - `projectOptions(pool, sharedLists, filter) -> Array<{ key, label, count }>`. `label = workspaceLabel + " · " + projectLabel`, urutan sama dengan `groupTasks`, dan opsi basi untuk `filter.proj` ditambahkan di akhir dengan `count: 0`.

- [ ] **Step 1: Tulis test yang gagal.** Fixture `PROTO` meniru 16 task prototipe v2:
  - field `id, title, list_id, project, priority, quadrant, gtd_status, deadline, is_focused`;
  - task 1 (aktif) dan 2 ber-`is_focused`;
  - `deadline` "2026-10-22" untuk "today", tanggal Okt/Sep/Apr/Jun 2026 sebelum 22 untuk "late", `null` untuk "none";
  - workspace `list_id: 9` dengan `sharedLists = [{id: 9, name: "Tim Marketing"}]`;
  - task "Telepon dokter gigi" tanpa project.

  Test:
  - `splitTarget(scope, 1)` → target ids `[1, 2]`, pool 14 task. Task aktif `{id: 50, quadrant:"Q2", priority:"P3", gtd_status:"waiting", deadline:null}` dengan `focusTaskId: 50` → di target pertama, tidak di pool (Review Focus 1). `focusTaskId: null` → hanya task ⭐.
  - `timeCounts(pool, DEFAULT_FILTER, opts)` → `{all: 10, today: 4, late: 5}`.
  - `hiddenByStatus` → 4.
  - `statusCounts` → `{next: 10, inbox: 1, waiting: 2, someday: 1}`.
  - `matches`:
    - `pri:["P1"]` → hanya P1;
    - `pri:["P1","P2"]` + `quad:["Q1"]` → (P1 atau P2) dan Q1;
    - `status: []` → semua status;
    - query `"  REKAP  "` → hanya "Rekap performa iklan September";
    - query `"perbaiki   ikon"` cocok dengan "Perbaiki ikon menu samping";
    - `proj: {key: "9:kampanye q4"}` → hanya kelompok itu;
    - `except: "time"` mengabaikan `time`, `except: "status"` mengabaikan `status`;
    - task `priority: null` gagal bila `pri` terisi dan lolos bila kosong.
  - `groupKey`:
    - `{list_id: null, project: "TaskFlow"}` → `"p:taskflow"`;
    - `{list_id: 7, project: "ÄBC"}` → `"7:Äbc"` (hanya A–Z yang dilipat);
    - `{list_id: "", project: ""}` → `"p:"`.
  - `groupTasks(pool, sharedLists)`:
    - urutan label `Pribadi·Alurik, Pribadi·Rumah, Pribadi·Tanpa project, Tim Marketing·Kampanye Q4, Tim Marketing·Konten Video`;
    - "Alurik" pribadi dan "Alurik" di `list_id: 9` → dua kelompok;
    - "alurik" dan "Alurik" di scope sama → satu kelompok berlabel kapitalisasi task pertama;
    - `list_id: 77` tanpa entri `sharedLists` → `workspaceLabel` "Workspace";
    - workspace "beta" sebelum "Gamma" (sensitivity base).
  - `comparePriority`:
    - P2 sebelum P3;
    - P2 deadline 2026-10-01 sebelum P2 2026-10-20 sebelum P2 tanpa deadline;
    - prioritas tak dikenal setelah P4;
    - judul sama → id kecil dulu.
  - `projectOptions`:
    - 5 opsi dengan angka 4/3/1/4/2 (dari seluruh pool, tanpa filter);
    - `filter.proj = {key: "p:hilang", label: "Pribadi · Hilang"}` → opsi terakhir `{key: "p:hilang", label: "Pribadi · Hilang", count: 0}` (Review Focus 3).
- [ ] **Step 2: Jalankan → FAIL.**
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**; `npm test`.
- [ ] **Step 5: Commit** — `feat(fokus): focusfilter — pencocokan filter, hitungan tab/status, kelompok Workspace › Project`

---

### Task 3: Satu definisi cakupan untuk Sidebar, Dashboard, dan `getFilteredTasks`

**Files:**
- Modify: `static/index.html`:
  - `Sidebar` → `todayCount` = `tasks.filter(t => TF.focusfilter.inTodayScope(t, { todayISO, focusTaskId })).length`;
  - `Dashboard` → `todayStr` = `todayLocalISO()`, `allToday` = `inTodayScope(t, { todayISO: todayStr, includeDone: true })`. Pengurutan `pendingToday` mengganti `is_overdue` dengan `timeBucket(t, todayStr) === "late"`. Kelas baris `is-overdue` di kartu tidak diubah;
  - `App.getFilteredTasks` kasus `"today"` → `inTodayScope(t, { todayISO })`.
- Test: `tests/offline/focus_filter_ui.test.js` (baru, gaya `fnSource` dari `focus_target_ui.test.js`)

**Interfaces:**
- Consumes: `TF.focusfilter.inTodayScope`, `timeBucket` (Task 1).

- [ ] **Step 1: Tulis test yang gagal:**
  - `fnSource("Sidebar")`, `fnSource("Dashboard")`, `fnSource("App")` masing-masing memuat `focusfilter.inTodayScope(`;
  - tidak ada lagi `t.quadrant === "Q1" || t.is_overdue` di ketiganya;
  - `Dashboard` tidak memuat `toISOString().split("T")[0]` untuk `todayStr`, tetapi memuat `includeDone: true` dan `todayLocalISO()`.
- [ ] **Step 2: Jalankan → FAIL** — `node --test tests/offline/focus_filter_ui.test.js`
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**; `node temporary_files/check_inline_scripts.js`; `npm test` (perbarui tes lama yang mengunci teks lama `allToday`/`todayCount` bila ada, tanpa melemahkan maksudnya).
- [ ] **Step 5: Commit** — `refactor(fokus): cakupan hari ini dari focusfilter.inTodayScope (tanggal lokal) di sidebar, dashboard, filter`

---

### Task 4: Seksi Target, kelompok, dan ⭐ di baris task

**Files:**
- Modify: `static/index.html`:
  - `FOCUS_GLYPHS`: tambah `star` (outline, fill mengikuti `currentColor` bila aktif lewat kelas), `sliders`, dan `search` dalam gaya garis glyph lain.
  - `FocusTaskItem`:
    - prop baru `onToggleStar`. Bila ada, dirender `button.ftask-star` sebelum tombol Fokus/Aktif, dengan `aria-pressed`, `aria-label` sesuai Global Constraints, `stopPropagation`, dan kelas `is-on` bila `task.is_focused`;
    - prop baru `hideProject` menyembunyikan span project di meta;
    - deadline merah memakai `TF.focusfilter.timeBucket(task, TF.tasklogic.todayLocalISO()) === "late"`, bukan `task.is_overdue` (teks title "Terlambat"/"Deadline" ikut).
  - Komponen baru `FocusTargetSection({ tasks, renderItem })`: `FocusSectionHead` glyph `star`, judul "Target hari ini", jumlah, lalu `div.ftask-list.focus-target`.
  - Komponen baru `FocusTaskGroups({ groups, collapsed, onToggleGroup, renderItem })`:
    - per kelompok `section.focus-group` (`is-collapsed`);
    - `button.focus-group-head` dengan `aria-expanded`, `aria-controls`, chevron (`FocusGlyph chevron`), `span.focus-group-ws` "‹ws› ·", nama project, dan `span.focus-group-count`;
    - isi `div.ftask-list` (tidak dirender bila terlipat).
  - `TodayFocusView`:
    - props baru `sharedLists = []`, `onToggleFocus`;
    - `scope` dari `inTodayScope`, lalu `splitTarget(scope, focusTask?.id)`;
    - `headerSummary` dan `useFocusTaskCounts` memakai `scope`;
    - state `collapsed` dari `readCollapsed(zenStorage())` (Set), ditulis ulang setiap toggle;
    - `renderItem(task, { inGroup })` membuat `FocusTaskItem` dengan props lama + `onToggleStar: t => onToggleFocus?.(t.id)` + `hideProject: inGroup`;
    - pool dirender lewat `groupTasks(pool, sharedLists)` **tanpa filter dulu** (filter di Task 5);
    - pesan kosong cakupan memakai teks baru; bila `pool` kosong tetapi target ada → "Semua task hari ini sudah ada di Target.";
    - `zenHiddenCount` = `scope` selain task aktif + `recurringToday.length`. Seksi Target, judul kelompok, dan catatan ikut kelas zen seperti item.
  - App: teruskan `sharedLists` dan `onToggleFocus: handleToggleFocus` ke `TodayFocusView`.
- Modify: `static/app.css`:
  - `.focus-target` (latar aksen lembut `rgba(168,197,0,0.10)`, radius 14, padding 8; varian gelap);
  - `.focus-group`, `.focus-group-head` (target sentuh ≥ 36 px, judul elipsis satu baris), `.focus-group-ws` (warna `--text-secondary`), `.focus-group-count`;
  - chevron berputar −90° saat `is-collapsed`, tanpa transisi di `prefers-reduced-motion`;
  - `.ftask-star` (36 × 36, `is-on` warna aksen gelap `#6B8000` / tema gelap `#A8C500`).
- Test: `tests/offline/focus_filter_ui.test.js` (tambah)

**Interfaces:**
- Consumes: `splitTarget`, `groupTasks`, `readCollapsed`, `writeCollapsed`, `timeBucket` (Task 1–2).
- Produces: `renderItem(task, { inGroup })` di `TodayFocusView` (dipakai Task 5); kelas DOM `.focus-target`, `.focus-group[.is-collapsed]`, `.focus-group-head[aria-expanded]`, `.ftask-star[aria-pressed]`.

- [ ] **Step 1: Tulis test yang gagal** (sumber):
  - `FocusTaskItem`: tanda tangan memuat `onToggleStar` dan `hideProject`; sumber memuat `ftask-star`, `aria-pressed`, kedua `aria-label` ⭐, `stopPropagation`, dan `focusfilter.timeBucket(`; tidak ada `task.is_overdue`.
  - `FocusTargetSection` memuat `"Target hari ini"` dan `focus-target`.
  - `FocusTaskGroups` memuat `aria-expanded`, `aria-controls`, `focus-group-head`, dan `is-collapsed`.
  - `TodayFocusView` memuat `splitTarget(`, `groupTasks(`, `readCollapsed(`, `writeCollapsed(`, `sharedLists`, `onToggleFocus`, teks pesan kosong baru, dan "Semua task hari ini sudah ada di Target."; tidak ada lagi `t.quadrant === "Q1" || t.is_overdue`.
  - App meneruskan `sharedLists: sharedLists` dan `onToggleFocus: handleToggleFocus` di blok `TodayFocusView`.
  - `FOCUS_GLYPHS` memuat `star`, `sliders`, `search`.
  - CSS memuat `.focus-target`, `.focus-group-head`, `.ftask-star`, dan aturan reduced-motion untuk chevron.
  - Tes lama `focus_zen`, `focus_target_ui`, `focus_workstation`, `focus_park_input`, `focus_overtime_ui`, `focus_ambient_ui`, `tasklist_focus_btn` tetap lulus. Perbarui seperlunya bila mengunci struktur lama (`sortedTasks.map`), dengan tetap menguji maksudnya.
- [ ] **Step 2: Jalankan → FAIL.**
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**; `check_inline_scripts`; `npm test`; `python temporary_files/e2e_focus_page.py` (via `/usr/bin/python3`, `E2E_PYTHON=/home/claude/venv-alurik/bin/python`) tetap lulus.
- [ ] **Step 5: Commit** — `feat(fokus): seksi Target hari ini, kelompok Workspace › Project, tombol ⭐ di baris task`

---

### Task 5: Bar filter, lembar filter, penyimpanan, catatan

**Files:**
- Modify: `static/index.html`:
  - **`FocusFilterBar({ filter, query, counts, badge, pills, sheetOpen, onTime, onQuery, onToggleQuick, onRemovePill, onReset, onOpenSheet, filterBtnRef })`** → `div.focus-filter`:
    - `div.focus-filter-time[role=group][aria-label=Waktu]` berisi tiga `button[aria-pressed]` (label + `span.n`);
    - `div.focus-filter-searchrow` (position relative): `label.focus-filter-search` (glyph `search`, `input type=search`, `enterKeyHint="search"`, tombol hapus ✕ `aria-label` "Hapus pencarian" bila tidak kosong) + `button.focus-filter-btn` (glyph `sliders`, `span.focus-filter-badge`, `aria-haspopup`, `aria-expanded`, `aria-label`);
    - `div.focus-filter-chips`: pil (`.focus-filter-chip.is-pill`), chip cepat (`.focus-filter-chip[aria-pressed]`, `.is-on`), dan chip Reset (`.is-reset`) bila `!isFilterDefault(filter) || query.trim()`.
  - **`FocusFilterSheet({ open, filter, statusCounts, projectOptions, shownCount, onChange, onResetHidden, onClose, returnFocusRef })`**:
    - `div.focus-filter-backdrop` + `div.focus-filter-sheet[role=dialog][aria-modal=true][aria-labelledby]`;
    - empat grup chip (status multi, pri multi, quad multi, proj tunggal dengan "Semua");
    - `div.focus-filter-sheet-actions` berisi "Reset" (status/pri/quad/proj ke default; `time` dan query tetap) dan "Tampilkan N task" (tutup);
    - efek saat `open`: fokus ke chip pertama, `keydown` Esc → `onClose`, Tab berputar, dan kunci `document.body.style.overflow` bila `matchMedia("(max-width: 768px)")`. Dipulihkan saat tutup/unmount, lalu fokus ke `returnFocusRef`.
  - **`TodayFocusView`:**
    - state `filter` dari `readFilter(zenStorage())`, setiap perubahan → `normalizeFilter` + `writeFilter`;
    - state `query`;
    - state `sheetOpen` (ditutup bila `zenOn` menjadi true);
    - `useMemo` atas `[tasks, filter, query, todayISO, focusTask?.id, sharedLists]` untuk `shown = pool.filter(matches)`, `timeCounts`, `statusCounts`, `hiddenByStatus`, `projectOptions`, dan `groupTasks(shown, sharedLists)`;
    - pil dibentuk sesuai Global Constraints, dengan `proj.label` dari opsi saat dipilih;
    - `FocusSectionHead` "Task hari ini" ber-angka `shown.length`;
    - bar filter tidak dirender bila `scope` kosong atau `pool` kosong;
    - pesan "tidak ada yang cocok" (`div.focus-filter-empty` + tombol "Reset filter" → `DEFAULT_FILTER` + query kosong);
    - `p.focus-filter-hidden-note` bila `hiddenByStatus > 0` (tombol "Tampilkan" → `status: []`);
    - saat `zenOn`, bar, kelompok, catatan, dan pesan diberi `is-zen-hidden` + `aria-hidden`; saat `zenReveal`, diberi `is-zen-shown`.
- Modify: `static/app.css`:
  - `.focus-filter*` sesuai prototipe v2: tab gelap aktif, chip pil `--text-primary`/`--bg-card` terbalik, Reset bergaris putus, badge aksen `#A8C500` teks `#1F2116`;
  - baris chip `overflow-x: auto` tanpa scrollbar, semua anak `flex-shrink: 0`;
  - lembar: ≤ 768 px fixed bottom radius 20 maks 86vh + backdrop `rgba(15,18,8,.38)`; di atasnya absolute `top: calc(100% + 6px); right: 0; width: 340px` + backdrop transparan;
  - tema gelap `[data-theme="dark"]`; reduced-motion tanpa animasi lembar.
- Test: `tests/offline/focus_filter_ui.test.js` (tambah)

**Interfaces:**
- Consumes: seluruh `TF.focusfilter` (Task 1–2), `renderItem` (Task 4).
- Produces: kelas DOM untuk E2E: `.focus-filter-time button`, `.focus-filter-search input`, `.focus-filter-btn`, `.focus-filter-badge`, `.focus-filter-chip(.is-pill|.is-on|.is-reset)`, `.focus-filter-sheet`, `.focus-filter-backdrop`, `.focus-filter-empty`, `.focus-filter-hidden-note`.

- [ ] **Step 1: Tulis test yang gagal** (sumber):
  - `FocusFilterBar` memuat semua teks bar persis (Global Constraints), `aria-label: "Waktu"`, `aria-pressed`, `aria-haspopup`, `aria-expanded`, `enterKeyHint`, dan `isFilterDefault(`.
  - `FocusFilterSheet` memuat `role: "dialog"`, `"aria-modal"`, `aria-labelledby`, keempat subjudul, catatan status persis, label kuadran, `"Tampilkan "`, `"Escape"`, `matchMedia("(max-width: 768px)")`, dan `overflow`.
  - `TodayFocusView` memuat `readFilter(`, `writeFilter(`, `normalizeFilter(`, `matches(`, `timeCounts(`, `statusCounts(`, `hiddenByStatus(`, `projectOptions(`, `nonDefaultCount(`, `"berstatus lain disembunyikan"`, `"Reset filter"`, `"Tidak ada task yang cocok dengan filter ini."`, dan penutupan lembar saat `zenOn`.
  - CSS memuat `.focus-filter-sheet`, `.focus-filter-backdrop`, `.focus-filter-chips`, media 768 px untuk lembar, `width: 340px`, dan reduced-motion untuk lembar.
- [ ] **Step 2: Jalankan → FAIL.**
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**; `check_inline_scripts`; `npm test`; `e2e_focus_page.py` tetap lulus.
- [ ] **Step 5: Commit** — `feat(fokus): bar filter (tab waktu, cari, chip cepat) + lembar filter tersembunyi yang diingat per perangkat`

---

### Task 6: Versi, E2E, ADR, handover

**Files:**
- Modify: versi (Global Constraints). Lebih dulu `git fetch origin` dan cek PR terbuka (`gh api "repos/mtyatno/taskflow-v4/pulls?state=open"` + `git show origin/<branch>:static/sw.js`). Bila `main` sudah bergerak, `git merge origin/main` (merge commit) lalu ambil nomor kosong berikutnya.
- Create: `temporary_files/e2e_focus_filter.py` (harness dari `temporary_files/e2e_focus_page.py`). Screenshot ke `temporary_files/e2e_focus_filter/`, di-.gitignore seperti folder E2E lain.
- Modify: `.agents/DECISIONS.md` (ADR-027 dari spec §12, atau nomor kosong berikutnya), `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md`.

- [ ] **Step 1: Naikkan versi**, lalu jalankan `python -m pytest tests/test_version.py -q` dan `npm test`.
- [ ] **Step 2: Tulis E2E.** Data dibuat lewat API:
  - satu user dan workspace `POST /api/lists {name: "Tim Marketing Kampanye Akhir Tahun 2026"}`;
  - task pribadi di project "Alurik" dan "Rumah", task tanpa project, dan task workspace (`list_id`) di project "Kampanye Q4" dan "Konten Video Produk Baru Panjang Sekali";
  - kombinasi prioritas P1–P4, deadline kemarin / hari ini / tanpa, dan status next / waiting / someday / inbox;
  - satu task ⭐ (`POST /api/tasks/:id/focus`).

  Angka harapan dihitung di Python dari `GET /api/tasks` dengan aturan Global Constraints, karena quadrant dihitung server. `localStorage tf_groupby` dll. mengikuti `open_app`. Skenario:
  - a. Desktop 1280: Target berisi task ⭐ dan tidak ada judul itu di `.focus-group`. Angka tiga tab sama dengan harapan. Kelompok berurutan Pribadi → workspace, dengan "Tanpa project" terakhir dalam Pribadi.
  - b. Tab "Hari ini" lalu "Terlambat" → judul yang tampil sama dengan harapan. Chip P1 → hanya P1; P1 + Q1 → irisan.
  - c. Ketik query huruf besar → hanya judul cocok; ✕ hapus → kembali.
  - d. Tombol Filter → lembar `role=dialog` tampil, fokus di chip pertama. Pilih Waiting dan satu project → badge "2", tombol "Tampilkan N task" benar. Esc → lembar tertutup, fokus di `.focus-filter-btn`. Pil "Status: Next, Waiting" dan pil project tampil; ✕ pada pil project → badge "1".
  - e. Catatan "N task berstatus lain disembunyikan" → klik Tampilkan → pil "Semua status" dan task Waiting/Someday/Inbox tampil.
  - f. Lipat satu kelompok → isinya hilang. Reload → filter, tab, chip, dan kelompok terlipat tetap; query kosong.
  - g. ⭐ pada baris di kelompok → task pindah ke Target (toast), tidak duplikat. ⭐ lagi → kembali ke kelompoknya.
  - h. Pilih project lalu tandai semua task-nya selesai lewat API dan refresh → pil tetap, pesan "Tidak ada task yang cocok dengan filter ini." tampil. "Reset filter" → default (Review Focus 3).
  - i. Mode Zen nyala + Fokus satu task + Mulai → `.focus-filter` dan `.focus-group` ber-`is-zen-hidden`; buka lembar sebelum Mulai → lembar tertutup saat Work berjalan. Jeda → tampil lagi.
  - j. `localStorage tf_focus_filter = "{rusak"` dan `tf_focus_collapsed = "[1,{}]"` lalu reload → halaman tampil default tanpa `pageerror` (Review Focus 4).
  - k. Mulai Fokus pada task P3 Waiting tanpa deadline dari halaman Tasks → di halaman Fokus task itu ada di Target, tidak di kelompok, dan status default Next tidak menyembunyikannya (Review Focus 1).
  - l. 375 px dan Pixel 7 (412 px): `document.documentElement.scrollWidth <= innerWidth`, termasuk saat lima pil aktif (status, project panjang, P4, Q2, Q4). Lembar bawah menempel di bawah, body tidak bisa digulir selama terbuka (Review Focus 5).
  - m. Badge menu Fokus di sidebar = jumlah cakupan harapan, termasuk task ber-deadline hari ini yang bukan Q1. Kartu Prioritas dashboard memuat task itu.
  - n. Tidak ada `pageerror` atau `console.error` sepanjang skenario.
  - Screenshot terang + gelap, desktop + 375 px: daftar default, lembar terbuka, pil aktif, pesan kosong.
- [ ] **Step 3: Jalankan:**
  - E2E baru exit 0 (`E2E_PYTHON=/home/claude/venv-alurik/bin/python /usr/bin/python3 temporary_files/e2e_focus_filter.py`);
  - `e2e_focus_page.py`, `e2e_focus_target.py`, `e2e_focus_overtime.py`, dan `e2e_android_notification.py` tetap lulus;
  - verifikasi standar (Global Constraints).
- [ ] **Step 4: ADR + handover:**
  - ADR-027 di `DECISIONS.md`;
  - entri `CURRENT_STATE` (ganti entri "SPEC DITULIS" untuk `claude/fokus-filter`): versi, isi, verifikasi, deploy = restart `taskflow-web`;
  - entri `SESSION_LOG`.
- [ ] **Step 5: Commit** — `chore(fokus): SW v454 + E2E filter halaman Fokus + ADR-027`
