# Redesain detail task Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Penomoran ulang rilis (2026-10-27):** `main` bergerak ke b365263 (tema PR A #99: `taskflow-v472-tema-fondasi`, `app.css?v=369`, ADR-033). Task 8 me-merge `origin/main` dan merilis sebagai **`taskflow-v473-detail-baru`, `app.css?v=370`, ADR-034**. Sebutan v472/369/ADR-033 di Task 8 di bawah dibaca sebagai v473/370/ADR-034.

**Goal:** Detail task (modal dan panel Live Edit) menjadi satu tampilan klik-nilai-untuk-mengubah dengan simpan otomatis di keduanya: bar atas, chip, kisi properti ber-popover, deskripsi tanpa bingkai, dan tab Subtask / Checklist / Catatan / Lampiran.

**Architecture:** Logika `TaskDetailBody` (pengendali simpan Live Edit, `tagsForTitle`, overlay tag, Pindah ke Workspace, pemuatan isi) dipertahankan; tampilannya diganti komponen kecil baru yang ditaruh tepat sebelum `TaskDetailBody` di `static/index.html`. Logika murni (tab awal, terlambat, format tanggal, saring opsi, nama tag, posisi popover) masuk modul UMD baru `static/offline/taskdetail.js` yang diuji di Node. Modal ikut memakai `useTaskAutosave`; mode lihat → Edit → Simpan dihapus.

**Tech Stack:** React 18 tanpa JSX (`static/index.html` sudah terkompilasi: tulis `React.createElement`), CSS `static/app.css`, modul UMD `static/offline/*.js`, `node --test`, pytest, Playwright (E2E manual, tidak di CI).

**Spec:** `docs/superpowers/specs/2026-10-26-redesain-detail-task-design.md` (salinan Project `claude/spec-redesain-detail-task-2026-10-26.md`). Spec Live Edit (`docs/superpowers/specs/2026-10-26-live-edit-design.md`) menjelaskan pengendali simpan yang dipakai ulang (R9–R21).

## Global Constraints

- Branch `claude/redesain-detail-task` dari `main` @ `ff0d317` (SW `taskflow-v471-simpan-tag`, `app.css?v=368`). Versi SW dan `app.css?v=` **baru dinaikkan di Task 8**; E2E memakai konteks browser baru sehingga cache lama tidak berpengaruh.
- `static/index.html` sudah terkompilasi: kode baru `React.createElement(...)` (boleh dengan `/*#__PURE__*/`), bukan JSX. Hook layout: `React.useLayoutEffect`. Portal: `ReactDOM.createPortal`.
- Komponen baru didefinisikan sebagai `function Nama(...) {` di kolom 0 dan diakhiri `}` di kolom 0 (tes memotong sumber dengan `fnSource`), di antara `pinOverlayToScrollBox` dan `TaskDetailBody`. Tidak ada fungsi lain di antara `TaskDetailBody` dan `TaskDetailModal`.
- Hanya klien: tanpa perubahan `webapp.py`, skema, API, router lokal (`taskroutes.js`), `taskrepo.js`, `syncpush.js`.
- Teks UI persis (spec): "Selesai", "Buka lagi", "Aksi lain" (aria-label ⋯), "Fokus" (aria-label), "Pindah ke Workspace", "Hapus", "Ubah Progress", "Terlambat", "+ Tambah", "Cari atau buat baru…", "+ Buat '<teks>'", "Kosongkan", "Hari ini", "Besok", "Senin depan", "Hapus deadline", "Lepas", "Tidak bisa memuat anggota", "Simpan", "Tambah tag", "Tulis nama tag", "Tag hanya boleh huruf, angka, dan _", "Perubahan lain belum tersimpan. Coba lagi dulu.", "Tulis deskripsi atau catatan lingkup tugas di sini…", "Subtask", "Checklist", "Catatan", "Lampiran", "+ Buat subtask baru…", "+ Tambah butir checklist baru", "Belum ada subtask", "Belum ada checklist", "Buka subtask" (aria-label ↗), "Hapus butir" (aria-label ×). Format bar atas: `#<id> • Dibuat <d Mmm yyyy>`.
- Label properti persis: "Status", "Prioritas", "Tahap", "Proyek", "Deadline", "Assign ke", "Menunggu", "Tag".
- Ikon lewat `Icon` (`static/ui-components.js`, nama yang ada: `star`, `check`, `refresh`, `menu`, `users`, `trash`, `plus`, `x`, `calendar`, `tag`, `link`, dst.) — tanpa emoji di komponen detail baru. ✕ modal (`headerAction`) tetap.
- CSS baru hanya di blok `/* ── Detail task: awal ── */` … `/* ── Detail task: akhir ── */` di akhir `static/app.css`: warna hanya token (`--bg-card`, `--bg-hover`, `--bg-subtle`, `--bg-selected`, `--border`, `--text-primary|secondary|light`, `--accent`, `--success`, `var(--danger, #dc2626)`), latar beraksen lewat `color-mix(in srgb, var(--accent) 14%, transparent)`, bayangan lewat `color-mix(... var(--text-primary) ...)`; tanpa `#hex` lain, tanpa `rgba(`, tanpa `border-left`. Style inline baru tanpa warna kecuali `PRI_DOT[p]` (konstanta yang ada) dan lebar bar.
- Modul offline baru masuk `STATIC` di `static/sw.js` dengan URL persis **dan** `<script>` di `index.html`; berkas di-commit (git-tracked).
- Pesan commit diakhiri baris atribusi sesi (Co-Authored-By + Claude-Session) sesuai pengingat sesi.
- Verifikasi standar per task: `npm test` (hanya `draw_local_reactive` yang diketahui boleh gagal; basis 3217 lulus), `python3 -m pytest tests/ -q` (basis 1226 lulus, 1 dilewati), `node temporary_files/check_inline_scripts.js`.

## Review Focus

1. **Popover yatim saat detail hilang** — panel berganti task, modal ditutup (✕/Selesai/↗) selagi popover terbuka: tidak boleh ada `.td-pop` tersisa di `document.body`. Tes: Task 3 E2E `T-6`.
2. **Popover di wadah yang digulir / dekat tepi** — panel atau modal sudah digulir, jangkar dekat tepi kanan/bawah, layar 375 px: popover menempel pada jangkar dan tetap di dalam viewport. Tes: Task 1 `popoverPosition` + Task 3 E2E `T-7`.
3. **Duplikat yang hanya beda huruf besar/kecil** — Enter "pemasaran" saat "Pemasaran" ada, tag "#KERJA" saat "kerja" terpasang: yang ada dipakai, tidak ada proyek/tag/request baru. Tes: Task 1 `exactOption` + Task 4 E2E `P-2` + Task 5 E2E `G-2`.
4. **Task belum tersinkron (id = cid)** — `#<cid>` panjang di bar atas 375 px tidak meluber; Fokus/Selesai bekerja. Tes: Task 3 E2E `T-8`.
5. **Chip basi setelah properti diubah** — kuadran dan "Terlambat" mengikuti nilai form saat itu juga (tanpa reload). Tes: Task 4 E2E `P-4`.

---

### Task 1: Modul murni `TF.taskdetail`

**Files:**
- Create: `static/offline/taskdetail.js`
- Create: `tests/offline/taskdetail.test.js`
- Create: `tests/test_taskdetail_node.py`
- Modify: `static/index.html:272` (script tag sesudah `tasklogic.js`)
- Modify: `static/sw.js:20` (`STATIC` sesudah `"/static/offline/tasklogic.js",`)

**Interfaces:**
- Consumes: `TF.tasklogic.deriveTaskFields(task, todayISO)` (`static/offline/tasklogic.js`; di Node `require("./tasklogic.js")`).
- Produces: `TF.taskdetail` = `{ TAB_ORDER, PROGRESS_PRESETS, MONTHS_SHORT, STATUS_ORDER, PRIORITY_ORDER, TAG_EMPTY, TAG_INVALID, initialTab(counts) -> string, isOverdue(deadline, status, todayISO) -> boolean, formatCreated(iso) -> string, formatDeadline(iso) -> string, formatShortDate(iso, todayISO) -> string, filterOptions(options, query) -> string[], exactOption(query, options) -> string|null, canCreate(query, options) -> boolean, normalizeTagName(raw) -> {name}|{error}, clampProgress(v) -> number, popoverPosition({anchor, size, viewport}) -> {top, left, width, maxHeight, placement} }`. Semua array konstanta di-`Object.freeze`. `TAG_EMPTY = "Tulis nama tag"`, `TAG_INVALID = "Tag hanya boleh huruf, angka, dan _"`.

- [ ] **Step 1: Tulis tes yang gagal** `tests/offline/taskdetail.test.js` (pola `tests/offline/liveedit.test.js`: `require("../../static/offline/taskdetail.js")`, baca `index.html` dan `sw.js`):

```js
test("konstanta", () => {
  assert.deepEqual([...td.TAB_ORDER], ["subtask", "checklist", "notes", "attachments"]);
  assert.deepEqual([...td.PROGRESS_PRESETS], [0, 25, 50, 75, 100]);
  assert.deepEqual([...td.STATUS_ORDER], ["inbox", "next", "waiting", "someday", "done"]);
  assert.deepEqual([...td.PRIORITY_ORDER], ["P1", "P2", "P3", "P4"]);
  assert.deepEqual([...td.MONTHS_SHORT], ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]);
  for (const k of ["TAB_ORDER", "PROGRESS_PRESETS", "STATUS_ORDER", "PRIORITY_ORDER", "MONTHS_SHORT"]) assert.ok(Object.isFrozen(td[k]), k);
});
test("initialTab: urutan subtask, checklist, notes, attachments; kosong → subtask", () => {
  assert.equal(td.initialTab({ subtask: 0, checklist: 0, notes: 0, attachments: 0 }), "subtask");
  assert.equal(td.initialTab({ subtask: 0, checklist: 3, notes: 1, attachments: 2 }), "checklist");
  assert.equal(td.initialTab({ notes: 2 }), "notes");
  assert.equal(td.initialTab({ attachments: 1, notes: null }), "attachments");
  assert.equal(td.initialTab(null), "subtask");
});
test("isOverdue", () => {
  const today = "2026-10-26";
  assert.equal(td.isOverdue("2026-10-25", "next", today), true);
  assert.equal(td.isOverdue("2026-10-26", "next", today), false);
  assert.equal(td.isOverdue("2026-10-27", "inbox", today), false);
  assert.equal(td.isOverdue("2026-10-25", "done", today), false);
  assert.equal(td.isOverdue("2026-10-25", "archived", today), false);
  assert.equal(td.isOverdue("", "next", today), false);
  assert.equal(td.isOverdue(null, "next", today), false);
});
test("format tanggal", () => {
  assert.equal(td.formatCreated("2026-10-21T08:30:00"), "21 Okt 2026");
  assert.equal(td.formatCreated("2026-01-05 03:00:00"), "5 Jan 2026");
  for (const bad of ["", null, undefined, "kemarin"]) assert.equal(td.formatCreated(bad), "");
  assert.equal(td.formatDeadline("2026-12-31"), "31 Des 2026");
  assert.equal(td.formatDeadline(""), "");
  assert.equal(td.formatShortDate("2026-10-21", "2026-10-26"), "21 Okt");
  assert.equal(td.formatShortDate("2027-02-03", "2026-10-26"), "3 Feb 2027");
  assert.equal(td.formatShortDate("", "2026-10-26"), "");
});
test("filterOptions / exactOption / canCreate (tanpa beda huruf, trim)", () => {
  const opts = ["Pemasaran", "Keuangan", "pemasaran digital"];
  assert.deepEqual(td.filterOptions(opts, ""), opts);
  assert.notEqual(td.filterOptions(opts, ""), opts, "salinan, bukan array yang sama");
  assert.deepEqual(td.filterOptions(opts, "  PEMA "), ["Pemasaran", "pemasaran digital"]);
  assert.deepEqual(td.filterOptions(opts, "uang"), ["Keuangan"]);
  assert.deepEqual(td.filterOptions(null, "x"), []);
  assert.equal(td.exactOption(" pemasaran ", opts), "Pemasaran");
  assert.equal(td.exactOption("pema", opts), null);
  assert.equal(td.canCreate("pemasaran", opts), false);
  assert.equal(td.canCreate("   ", opts), false);
  assert.equal(td.canCreate("Pema", opts), true);
  assert.equal(td.canCreate("Baru", null), true);
});
test("normalizeTagName", () => {
  assert.deepEqual(td.normalizeTagName("  #kerja "), { name: "kerja" });
  assert.deepEqual(td.normalizeTagName("##Rapat_2"), { name: "Rapat_2" });
  assert.deepEqual(td.normalizeTagName("café"), { name: "café" });
  assert.deepEqual(td.normalizeTagName(" # "), { error: "Tulis nama tag" });
  assert.deepEqual(td.normalizeTagName(null), { error: "Tulis nama tag" });
  assert.deepEqual(td.normalizeTagName("dua kata"), { error: "Tag hanya boleh huruf, angka, dan _" });
  assert.deepEqual(td.normalizeTagName("a-b"), { error: "Tag hanya boleh huruf, angka, dan _" });
});
test("clampProgress: kelipatan 5 dalam 0..100", () => {
  for (const [v, want] of [[-5, 0], [0, 0], [12, 10], [13, 15], [99, 100], [150, 100], ["40", 40], ["x", 0], [null, 0]])
    assert.equal(td.clampProgress(v), want, String(v));
});
test("popoverPosition", () => {
  const vp = { width: 1280, height: 800 };
  assert.deepEqual(td.popoverPosition({ anchor: { top: 100, bottom: 130, left: 200 }, size: { height: 200 }, viewport: vp }),
    { top: 134, left: 200, width: 320, maxHeight: 420, placement: "below" });
  const up = td.popoverPosition({ anchor: { top: 700, bottom: 730, left: 200 }, size: { height: 300 }, viewport: vp });
  assert.equal(up.placement, "above"); assert.equal(up.top, 396); assert.equal(up.maxHeight, 420);
  assert.equal(td.popoverPosition({ anchor: { top: 100, bottom: 130, left: 1200 }, size: { height: 100 }, viewport: vp }).left, 952);
  assert.equal(td.popoverPosition({ anchor: { top: 100, bottom: 130, left: 2 }, size: { height: 100 }, viewport: vp }).left, 8);
  const m = td.popoverPosition({ anchor: { top: 100, bottom: 130, left: 300 }, size: { height: 100 }, viewport: { width: 375, height: 700 } });
  assert.equal(m.left, 8); assert.equal(m.width, 359); assert.equal(m.placement, "below");
  const tall = td.popoverPosition({ anchor: { top: 380, bottom: 410, left: 10 }, size: { height: 900 }, viewport: vp });
  assert.deepEqual([tall.placement, tall.top, tall.maxHeight], ["below", 414, 378]);
});
test("dimuat di index.html sesudah tasklogic.js dan ada di STATIC sw.js", () => {
  const a = indexHtml.indexOf('<script src="/static/offline/tasklogic.js"></script>');
  const b = indexHtml.indexOf('<script src="/static/offline/taskdetail.js"></script>');
  assert.ok(a > 0 && b > a);
  assert.match(swJs, /"\/static\/offline\/taskdetail\.js",/);
});
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `node --test tests/offline/taskdetail.test.js` → FAIL (`Cannot find module`).

- [ ] **Step 3: Implementasi `static/offline/taskdetail.js`** — UMD seperti `liveedit.js` (`root.TF.taskdetail = factory(root)`; di Node `module.exports`). `isOverdue` = `!!deadline && TL.deriveTaskFields({ deadline, gtd_status: status }, todayISO).is_overdue`. Tanggal dibaca dari 10 karakter pertama (`/^\d{4}-\d{2}-\d{2}/`, tanpa `Date` agar tidak bergeser zona waktu); bulan dari `MONTHS_SHORT`, hari tanpa nol di depan. `filterOptions`: `String(q).trim()`, bandingkan `toLowerCase()` substring, urutan asli. `normalizeTagName`: trim, buang `#` di depan (`/^#+/`), trim lagi, cocokkan `^[A-Za-z0-9_À-ɏ]+$`. `clampProgress`: `Number`, `NaN`→0, `Math.round(v/5)*5`, jepit 0..100. `popoverPosition` (margin 8, jarak 4):

```
width = vw < 640 ? vw - 16 : min(320, vw - 16)
cap = min(420, floor(vh * 0.7));  h = min(size.height, cap)
below = vh - anchor.bottom - 4 - 8;  above = anchor.top - 4 - 8
placement = (below >= h || below >= above) ? "below" : "above"
maxHeight = max(0, min(cap, placement === "below" ? below : above))
top = below ? anchor.bottom + 4 : anchor.top - 4 - min(h, maxHeight)
left = vw < 640 ? 8 : clamp(anchor.left, 8, vw - 8 - width)
```

Tambah `<script src="/static/offline/taskdetail.js"></script>` tepat sesudah baris `tasklogic.js` di `index.html`, dan `"/static/offline/taskdetail.js",` tepat sesudah `"/static/offline/tasklogic.js",` di `STATIC`.

- [ ] **Step 4: Jembatan CI** `tests/test_taskdetail_node.py` — salin pola `tests/test_liveedit_node.py` (docstring menyebut spec redesain) dengan `NODE_TESTS = ["taskdetail"]` dan `EXPECTED_NODE_TESTS = {"taskdetail"}`.

- [ ] **Step 5: Jalankan** — `node --test tests/offline/taskdetail.test.js` → PASS; `python3 -m pytest tests/test_taskdetail_node.py tests/test_sw_precache_node.py -q` → PASS; `npm test` → hanya `draw_local_reactive` gagal.

- [ ] **Step 6: Commit** — `git add static/offline/taskdetail.js tests/offline/taskdetail.test.js tests/test_taskdetail_node.py static/index.html static/sw.js && git commit -m "feat(detail): modul murni TF.taskdetail (tab awal, terlambat, tanggal, opsi, tag, posisi popover)"`

---

### Task 2: Modal ikut simpan otomatis (hapus mode Edit/Simpan) + harness E2E

**Files:**
- Modify: `static/index.html` — `TaskDetailBody` (±8553–9824)
- Create: `tests/offline/task_detail_redesign.test.js`
- Modify: `tests/offline/task_detail_body.test.js:36-43`, `tests/offline/liveedit_ui.test.js` (tes "TaskDetailBody: varian panel", "Modal tetap…", "Panel judul…", "R21: chip dimuat ulang…", "R19…")
- Modify: `tests/test_taskdetail_node.py` (`NODE_TESTS` + `EXPECTED_NODE_TESTS` += `"task_detail_redesign", "context_scope_form", "project_scope_form", "task_move_workspace"`)
- Create: `temporary_files/e2e_detail_redesign.py`; Modify: `.gitignore` (+ `temporary_files/e2e_detail_redesign/`)

**Interfaces:**
- Consumes: `useTaskAutosave(task, enabled, {onSaved, getTags})` → `{form, saveState, error, titleError, getState, change, commit, revertTitle, retry}` (sudah ada, ±8429); `TaskSaveIndicator({saveState, error, onRetry})`.
- Produces: di `TaskDetailBody` — `const auto = useTaskAutosave(task, true, { onSaved, getTags: tagsForTitle });`, `const fv = auto.form;`, `const sf = auto.change;` (dipakai semua task berikutnya). Textarea deskripsi ber-`"aria-label": "Deskripsi"`. Harness E2E dengan kelompok `autosave` dan fungsi bantu yang dipakai Task 3–7.

- [ ] **Step 1: Tes sumber yang gagal** — buat `tests/offline/task_detail_redesign.test.js` (helper `fnSource` sama dengan `task_detail_body.test.js`):

```js
test("simpan otomatis di modal dan panel; tanpa mode Edit/Simpan", () => {
  const s = fnSource("TaskDetailBody");
  assert.match(s, /const auto = useTaskAutosave\(task, true, \{/);
  assert.match(s, /const fv = auto\.form;/); assert.match(s, /const sf = auto\.change;/);
  for (const re of [/isEditing/, /handleSave/, /"💾 Simpan"/, /\\u270F\\uFE0F Edit/, /OfflineDB\.queueAdd/, /resetForm/,
                    /const \[form, setForm\]/, /const \[saving, setSaving\]/, /isPanel \? auto\./, /onOfflineEdit/])
    assert.doesNotMatch(s, re);
  assert.match(s, /const tagsVersion = task\?\.updated_at;/);
  assert.match(s, /api\.get\(`\/api\/lists\/\$\{task\.list_id\}\/members`\)[\s\S]{0,400}\}, \[task\?\.list_id\]\);/);
  assert.match(s, /React\.createElement\(TaskSaveIndicator, \{[^}]*\}\), headerAction/, "indikator + ✕ berdampingan di kedua variant");
  assert.match(s, /"aria-label": "Deskripsi"/);
});
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `node --test tests/offline/task_detail_redesign.test.js` → FAIL.

- [ ] **Step 3: Implementasi di `TaskDetailBody`** — hapus `isEditing`/`setIsEditing`/`editing`, state `form`/`setF`/`resetForm`/`saving`, `handleSave` (beserta cabang `OfflineDB.queueAdd`), tombol "✏️ Edit"/"Batal"/"💾 Simpan", cabang mode lihat (badge status/prioritas/kuadran, deskripsi dalam kotak, kisi teks beremoji, bar progress baca-saja, "✅ Done:"), dan `onEdit`/`onOfflineEdit` dari destrukturisasi props. `useTaskAutosave(task, true, …)`; `fv`/`sf` dari `auto`; semua handler `isPanel ? … : undefined` / `isPanel && …` milik field dan meta menjadi tanpa syarat (`onBlur` commit, pembungkus `onBlur`/`onKeyDown` project/context, `commit` progress, `titleNotice`/`titleAlert`, meta kuadran/Terlambat/Created, chip tag); `titleAlert = titleNotice || (auto.titleError && …)`; `tagsVersion = task?.updated_at`; efek anggota bergantung `[task?.list_id]`; kanan baris judul: `TaskSaveIndicator` lalu `headerAction` (keduanya selalu dirender, `headerAction` null di panel); deskripsi `rows: 4`, `"aria-label": "Deskripsi"`; panel Pindah tampil dengan syarat `moveOpen` saja. `variant` tetap mengatur `if (!isPanel) onClose()` di `handleMove` dan tombol Fokus (Fokus diganti di Task 3).

- [ ] **Step 4: Sesuaikan tes lama tanpa melemahkan yang dijaga:**
  - `task_detail_body.test.js` "TaskDetailBody memuat isi detail…": `handleSave`, "💾 Simpan", "✏️ Edit" pindah ke `assert.doesNotMatch`; tetap mewajibkan `ModalNotes`, `ModalAttachments`, "Pindah ke Workspace", root Fragment.
  - `liveedit_ui.test.js` "TaskDetailBody: varian panel" → judul "TaskDetailBody: simpan otomatis (kedua variant)": ganti `/const editing = isPanel \|\| isEditing/` dan `/useTaskAutosave\(task, isPanel/` dengan `/useTaskAutosave\(task, true/`; `/\[editing, task\?\.list_id\]/` → `/\[task\?\.list_id\]/`; hapus asersi `setIsEditing(true)`; jumlah `tagChips()` ≥ 1 (mode lihat sudah tidak ada). Asersi lain tetap.
  - "Modal tetap: TaskDetailModal variant modal, handleSave menutup" → "Modal: variant modal, ✕ lewat headerAction, tanpa handleSave" (`variant: "modal"`, `headerAction:` di `TaskDetailModal`; `doesNotMatch(/handleSave/)` di body).
  - "Panel judul…": `/const titleAlert = isPanel \? titleNotice \|\|/` → `/const titleAlert = titleNotice \|\|/`.
  - "R21: chip dimuat ulang…": `/const tagsVersion = isPanel \? task\?\.updated_at : null;/` → `/const tagsVersion = task\?\.updated_at;/` (pesan: modal ikut memuat ulang chip).
  - "R19…": hapus `isPanel && ` dari regex `onChange` (`if \(v && ${list}\.includes\(v\)\) auto\.commit`).

- [ ] **Step 5: Harness E2E** `temporary_files/e2e_detail_redesign.py` — docstring berisi daftar kelompok dan langkahnya; salin fungsi bantu dari `temporary_files/e2e_task_detail_body.py` (`check`, `free_port`, `start_server`, `register`, `api`, `open_app`, `go_all_tasks`, `open_task`, `seed_local_tags`, `modal_count`, `wait_closed`, `close_btn`, `shot`, `wait_until`, `server_task`, `server_tags`, `local_tags`, `local_task`, `reload_app`) dan dari `temporary_files/e2e_live_edit.py` (`net_offline`, `outbox_count`, `settle_outbox`, `expand_sidebar`, `collapse_sidebar`, `click_row`, `seed_local_tag`, pemasangan Live Edit lewat `live="1"`); `PANEL = 'aside[aria-label="Detail task"]'`, `MODAL = '.modal-content'`. `main()` menjalankan kelompok sesuai `E2E_ONLY` (default semua), screenshot ke `temporary_files/e2e_detail_redesign/` (atau `$E2E_SHOTS_DIR`), keluar non-zero bila ada langkah gagal; pengecualian konsol sama dengan `e2e_live_edit.py`. Kelompok `autosave` (modal 1280 px terang dan 375 px gelap):
  - `A-1` ketik "baru" di textarea `Deskripsi` lalu klik ✕ < 300 ms → `local_task` dan (setelah sync) `server_task` berdeskripsi "baru";
  - `A-2` task bertag lokal `kerja` → ubah judul (`aria-label="Judul task"`) + Enter → ✕ → `local_tags` tetap `["kerja"]`, `server_tags` memuat `kerja`;
  - `A-3` offline (`net_offline`) → buka lalu tutup 3 task tanpa mengubah apa pun → `outbox_count` tetap dan `updated_at`/`rev`/`dirty` rekaman lokal tiap task tetap;
  - `A-4` modal tidak memuat teks "✏️ Edit", "💾 Simpan", "Batal";
  - `A-5` tanpa error konsol/pageerror.

- [ ] **Step 6: Jalankan** — `node --test tests/offline/task_detail_redesign.test.js tests/offline/task_detail_body.test.js tests/offline/liveedit_ui.test.js tests/offline/context_scope_form.test.js tests/offline/project_scope_form.test.js tests/offline/task_move_workspace.test.js` → PASS; `E2E_ONLY=autosave python3 temporary_files/e2e_detail_redesign.py` → semua langkah lulus; verifikasi standar.

- [ ] **Step 7: Commit** — `git commit -m "feat(detail): modal ikut simpan otomatis, mode Edit/Simpan dihapus"` (berkas di atas).

---

### Task 3: Bar atas, judul, chip, progress, popover, menu ⋯

**Files:**
- Modify: `static/index.html` — komponen baru `DetailPopover`, `DetailTopBar`, `DetailChips`, `ProgressPill` sebelum `TaskDetailBody`; render `TaskDetailBody`
- Modify: `static/app.css` — buat blok `/* ── Detail task: awal ── */` … `/* ── Detail task: akhir ── */` di akhir berkas; hapus aturan `.tl-live-panel .task-detail-actions` dan `.task-detail-title-input`
- Modify: `tests/offline/task_detail_redesign.test.js`, `tests/offline/liveedit_ui.test.js` ("TaskDetailBody: simpan otomatis…" tanpa `task-detail-actions`; "CSS indikator + aksi menempel di panel"), `tests/offline/task_move_workspace.test.js:67-72`
- Modify: `temporary_files/e2e_detail_redesign.py` (kelompok `topbar`)

**Interfaces:**
- Consumes: `TF.taskdetail.popoverPosition`, `formatCreated`, `isOverdue`, `PROGRESS_PRESETS`, `clampProgress` (Task 1); `TF.tasklogic.calculateQuadrant({priority, deadline}, todayISO)`, `TF.tasklogic.todayLocalISO()`; `QuadBadge`; `auto`, `fv`, `sf` (Task 2).
- Produces:
  - `DetailPopover({ anchorRef, open, onClose, label, role = "dialog", className = "", children })` → `null` bila `!open`; selain itu portal `div.td-pop` (`role`, `"aria-label": label`, `data-placement`) ke `document.body`. Dipakai semua popover berikutnya.
  - `const [openPop, setOpenPop] = useState(null)` di `TaskDetailBody` (kunci: `"menu"`, `"progress"`, lalu nama field di Task 4, `"tag"` di Task 5).
  - `DetailTopBar({ task, isDone, focused, canMove, menuOpen, onMenuToggle, onMenuClose, onToggleFocus, onDone, onReopen, onMove, onDelete, indicator, headerAction })` → `div.td-top`.
  - `DetailChips({ priority, deadline, status, progress, todayISO, progressOpen, onProgressToggle, onProgressClose, onProgressChange, onProgressCommit })` → `div.td-chips`; `ProgressPill({ value, open, onToggle, onClose, onChange, onCommit })`.

- [ ] **Step 1: Tes sumber yang gagal** (tambahkan ke `task_detail_redesign.test.js`):

```js
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}]|\\uD83[C-E]|\\u2(?:6[0-9A-F]{2}|7[0-9A-B][0-9A-F])|\\uFE0F/u;
test("DetailPopover: portal, posisi murni, Escape/pointerdown di luar, gulir dan resize", () => {
  const p = fnSource("DetailPopover");
  for (const re of [/if \(!open\) return null;/, /ReactDOM\.createPortal\(/, /TF\.taskdetail\.popoverPosition\(/, /"Escape"/,
    /addEventListener\("pointerdown"/, /removeEventListener\("pointerdown"/, /addEventListener\("scroll", [^)]*true\)/,
    /addEventListener\("resize"/, /className: "td-pop/, /"aria-label": label/, /anchorRef\.current/])
    assert.match(p, re);
});
test("DetailTopBar: #id • Dibuat, Fokus, Selesai/Buka lagi, menu ⋯", () => {
  const t = fnSource("DetailTopBar");
  for (const re of [/TF\.taskdetail\.formatCreated\(/, /" (?:\\u2022|•) Dibuat "/, /" (?:\\u2022|•) Selesai "/, /"Selesai"/, /"Buka lagi"/,
    /"aria-label": "Aksi lain"/, /"aria-haspopup": "menu"/, /"aria-label": "Fokus"/, /"aria-pressed": focused/, /role: "menuitem"/,
    /"Pindah ke Workspace"/, /"Hapus"/, /canMove &&/, /(?:\\u21B3|↳) Subtask dari #/, /headerAction/, /indicator/])
    assert.match(t, re);
});
test("DetailChips + ProgressPill: kuadran dari nilai form, Terlambat, popover Ubah Progress", () => {
  const c = fnSource("DetailChips"), pp = fnSource("ProgressPill");
  assert.match(c, /TF\.tasklogic\.calculateQuadrant\(\{\s*priority,\s*deadline\s*\}/);
  assert.match(c, /TF\.taskdetail\.isOverdue\(deadline, status, /); assert.match(c, /"Terlambat"/);
  for (const re of [/"Ubah Progress"/, /TF\.taskdetail\.PROGRESS_PRESETS\.map\(/, /type: "range"/, /step: 5/, /onPointerUp/, /onKeyUp/, /"aria-pressed"/])
    assert.match(pp, re);
});
test("TaskDetailBody: bar atas menggantikan bar aksi bawah", () => {
  const s = fnSource("TaskDetailBody");
  for (const re of [/React\.createElement\(DetailTopBar/, /React\.createElement\(DetailChips/, /className: "td-title"/,
    /const \[openPop, setOpenPop\] = useState\(null\);/, /onReopen: \(\) => sf\("gtd_status", "next"\)/, /isDone: fv\.gtd_status === "done"/,
    /canMove: canMove && !moveOpen/, /auto\.commit\("progress"\)/])
    assert.match(s, re);
  for (const re of [/task-detail-actions/, /\\uD83D\\uDDD1\\uFE0F Hapus/, /"\\u2705 Done"/, /onToggleFocus\(task\.id\);\s*if \(!isPanel\) onClose\(\)/, /#eff6ff|#1d4ed8/])
    assert.doesNotMatch(s, re);
});
test("komponen detail baru tanpa emoji dan tanpa border-left", () => {
  for (const n of ["DetailPopover", "DetailTopBar", "DetailChips", "ProgressPill"]) {
    const src = fnSource(n); assert.doesNotMatch(src, EMOJI, n); assert.doesNotMatch(src, /borderLeft/, n);
  }
});
test("CSS blok detail: hanya token, bar atas menempel di panel, popover fixed z 60", () => {
  const a = appCss.indexOf("/* ── Detail task: awal ── */"), b = appCss.indexOf("/* ── Detail task: akhir ── */");
  assert.ok(a > 0 && b > a); const block = appCss.slice(a, b);
  assert.match(block, /\.tl-live-panel \.td-top\s*\{[^}]*position:\s*sticky;[^}]*top:\s*-20px/);
  assert.match(block, /\.td-pop\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*60/);
  assert.doesNotMatch(block, /border-left|rgba\(/);
  assert.doesNotMatch(block.replace(/var\(--danger, #dc2626\)/g, ""), /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(appCss, /\.task-detail-actions|\.task-detail-title-input/);
});
```

Sesuaikan: asersi Task 2 "indikator + ✕ berdampingan" di `task_detail_redesign.test.js` diganti `/indicator: (\/\*#__PURE__\*\/)?React\.createElement\(TaskSaveIndicator/` dan `/headerAction: headerAction/` (keduanya diteruskan ke `DetailTopBar`). `liveedit_ui.test.js` — buang `/className: "task-detail-actions"/` dari tes body; "CSS indikator + aksi menempel di panel" → "CSS indikator simpan" (hanya `.tl-save-ind`; aturan bar atas dijaga tes di atas). `task_move_workspace.test.js` — `/canMove && !moveOpen &&/` → `/canMove: canMove && !moveOpen/` (tes `"Pindah ke Workspace"` pindah ke `fnSource("DetailTopBar")`).

- [ ] **Step 2: Jalankan, pastikan gagal** — `node --test tests/offline/task_detail_redesign.test.js` → FAIL.

- [ ] **Step 3: `DetailPopover`** — render pertama di `top: -10000px` (bukan `visibility: hidden`, supaya `autoFocus` jalan), `React.useLayoutEffect` mengukur `anchorRef.current.getBoundingClientRect()` dan `offsetHeight` popover lalu `setPos(TF.taskdetail.popoverPosition({anchor, size, viewport: {width: innerWidth, height: innerHeight}}))` sebelum tampil; pendengar `scroll` (capture, `true`) dan `resize` dengan rAF menghitung ulang; `keydown` Escape dan `pointerdown` di luar popover **dan** jangkar → `onClose()`. Saat terbuka: bila fokus belum di dalam, fokus ke `input, button` pertama. Saat tertutup/unmount: bila fokus masih di dalam popover, kembalikan ke jangkar. Gaya posisi (`top`, `left`, `width`, `maxHeight`) inline.

- [ ] **Step 4: `DetailTopBar`, `DetailChips`, `ProgressPill` + render body** — tata letak dan aksi sesuai spec §4.1–§4.3; urutan kanan: `indicator`, Fokus (bila `!isDone && onToggleFocus`), Selesai/Buka lagi, ⋯ (+ `DetailPopover role "menu" label "Aksi lain"`), `headerAction`. Body: `focused` lokal (`useState(!!task.is_focused)` + efek ikut `task.is_focused`), Fokus → `setFocused(f => !f); onToggleFocus(task.id)` (tidak menutup modal); Selesai → `onDone()`; Buka lagi → `sf("gtd_status", "next")`; menu Pindah → `setOpenPop(null); setMoveOpen(true)`; menu Hapus → `setOpenPop(null); onDelete()`; popover progress ditutup → `setOpenPop(null); auto.commit("progress")`; preset → `sf("progress", p); auto.commit("progress")`. Urutan isi: bar atas › panel Pindah (bila `moveOpen`) › judul `input.td-title` (handler judul yang ada) + `titleAlert` › chip › `tagChips()` (dipindah ke kisi di Task 5) › field lain apa adanya. Hapus meta lama, kotak "↳ Subtask dari" biru, slider progress di field, bar aksi bawah. `todayISO = TF.tasklogic.todayLocalISO()`.

- [ ] **Step 5: CSS** — blok baru: `.td-top` (flex, jarak 12 px), `.tl-live-panel .td-top` (`position: sticky; top: -20px; z-index: 3; background: var(--bg-card); margin: -20px -20px 12px; padding: 20px 20px 10px; box-shadow: inset 0 -1px 0 var(--border)`), `.td-id` (elipsis, `max-width: 14ch`), `.td-btn`, `.td-icon-btn` (+`[aria-pressed="true"]` warna `--accent`), `.td-title` (20 px/700, tanpa bingkai sampai hover/fokus), `.td-chips`, `.td-chip.is-danger`, `.td-pill`/`.td-pill-bar`/`.td-pill-fill` (`--accent`, `.is-full` `--success`), `.td-pop` (`position: fixed; z-index: 60; overflow-y: auto`, kartu token), `.td-pop-title`, `.td-pop-item` (+`.is-danger`, `[aria-pressed="true"]`), `.td-presets`. Hapus `.tl-live-panel .task-detail-actions` dan `.task-detail-title-input` dari blok Live Edit.

- [ ] **Step 6: E2E kelompok `topbar`** (modal 1280 px terang, modal 375 px gelap, panel Live Edit 1280 px):
  - `T-1` teks bar atas cocok `^#\d+ • Dibuat \d{1,2} (Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agu|Sep|Okt|Nov|Des) \d{4}`; tidak ada "🗑️ Hapus"/"✅ Done";
  - `T-2` Fokus → `aria-pressed="true"`, modal tetap terbuka, `server_task(...).is_focused` benar setelah sync; klik lagi → salah;
  - `T-3` pill → "75%" → pill "75%"; reload → lokal dan server 75; slider: fokus + ArrowRight ×2 → 85 tersimpan;
  - `T-4` modal Selesai → modal tertutup, server `done`; panel: Selesai → panel tetap, tombol "Buka lagi" → klik → server `next`, tombol kembali "Selesai";
  - `T-5` ⋯ → Hapus (dialog `confirm` diterima) → task hilang di server; ⋯ untuk task anak tidak memuat "Pindah ke Workspace"; ⋯ → Pindah ke Workspace membuka panel Pindah;
  - `T-6` (Review Focus 1) panel: buka ⋯ lalu klik baris lain → `document.querySelectorAll('.td-pop').length === 0`; modal: buka pill lalu ✕ → 0;
  - `T-7` (Review Focus 2) panel dengan isi tinggi (deskripsi panjang + 12 butir checklist) digulir 40 px → buka pill → `|pop.top − (pill.bottom + 4)| ≤ 2`; gulir panel 30 px lagi → selisih tetap ≤ 2; modal 375 px: `left == 8`, `width == 359`, dasar popover ≤ tinggi viewport;
  - `T-8` (Review Focus 4) offline: `api.post('/api/tasks', {title: 'Lokal'})` di halaman lalu `window.dispatchEvent(new CustomEvent('taskSaved'))`, buka di modal 375 px → `.td-top` `scrollWidth ≤ clientWidth + 1`, Fokus bisa diklik; online → tersinkron tanpa error.

- [ ] **Step 7: Jalankan** — tes node yang disentuh → PASS; `E2E_ONLY=autosave,topbar python3 temporary_files/e2e_detail_redesign.py` → lulus; verifikasi standar.

- [ ] **Step 8: Commit** — `git commit -m "feat(detail): bar atas (Fokus, Selesai/Buka lagi, menu), chip kuadran/terlambat/progress, popover"`

---

### Task 4: Kisi properti dengan popover

**Files:**
- Modify: `static/index.html` — komponen baru `PropertyRow`, `OptionPicker`, `NamePicker`, `DatePicker`, `MemberPicker`, `TextPicker`; render `TaskDetailBody`
- Modify: `static/offline/liveedit.js` — `saveTrigger` (deadline, waiting_for → `"blur"`)
- Modify: `tests/offline/liveedit.test.js` (tes `saveTrigger` + tes autosaver baru), `tests/offline/liveedit_ui.test.js` (tes R19), `tests/offline/task_detail_redesign.test.js`
- Modify: `static/app.css` (blok detail)
- Modify: `temporary_files/e2e_detail_redesign.py` (kelompok `props`)

**Interfaces:**
- Consumes: `DetailPopover`, `openPop`/`setOpenPop` (Task 3); `TF.taskdetail.filterOptions/exactOption/canCreate/formatDeadline/isOverdue/STATUS_ORDER/PRIORITY_ORDER` (Task 1); `taskDatePromptQuickPicks(base)` (±5235, `[{label, key}]`); `GTD_LABELS`, `GTD_ICON`, `PRI_LABELS`, `PRI_DOT`; `scopeProjects`, `scopeContexts`, `scopeLists`, `projectScopeLabel`, `contextScopeLabel`, `listMembers`.
- Produces:
  - `PropertyRow({ label, text, icon = null, isEmpty, danger = false, wide = false, open, onToggle, onClose, popLabel, children })` → `div.td-prop` › `div.td-prop-label` + `button.td-prop-val` (`aria-haspopup="dialog"`, `aria-expanded`, `"aria-label": label + ": " + (isEmpty ? "kosong" : text)`, isi `icon` + `text` atau "+ Tambah") + `DetailPopover({anchorRef, open, onClose, label: popLabel || label}, children)`. Dipakai Task 5 dengan `wide`.
  - `OptionPicker({ options /* [{value, label, icon}] */, value, onPick })`, `NamePicker({ value, options, title, onPick })`, `DatePicker({ value, onChange, onPick })`, `MemberPicker({ members, value, failed, onPick })`, `TextPicker({ value, placeholder, onChange, onDone })`.
  - Body: `const pick = field => v => { sf(field, v); setOpenPop(null); auto.commit(field); };` dan `const closeProp = field => () => { setOpenPop(p => (p === field ? null : p)); auto.commit(field); };` (aturan simpan spec §4.4).

- [ ] **Step 1: Tes yang gagal**
  - `liveedit.test.js` tes `saveTrigger`: `["waiting_for", "x", "blur"]`, `["deadline", "2026-10-30", "blur"]` (judul tes menyebut redesain detail §6.2). Tes autosaver baru (pakai `mk`/`tick` yang ada):

```js
test("deadline & waiting_for: tidak ikut simpan non-eksplisit; commit mengirimnya", async () => {
  const { s, calls } = mk(T());
  s.change("deadline", "0002-11-15"); s.change("deadline", "2026-11-15"); await tick();
  assert.equal(calls.length, 0, "ketikan tanggal tidak tersimpan per digit");
  s.change("priority", "P1"); await tick();
  assert.deepEqual(calls, [{ priority: "P1" }], "pilihan 'now' tidak membawa deadline yang belum dikomit");
  s.change("waiting_for", "Budi"); s.commit("deadline"); await tick();
  assert.deepEqual(calls[1], { deadline: "2026-11-15", waiting_for: "Budi" });
});
```

  - `task_detail_redesign.test.js`:

```js
test("kisi properti: label, picker, tanpa select/ComboSelect/label input", () => {
  const s = fnSource("TaskDetailBody");
  for (const l of ["Status", "Prioritas", "Tahap", "Proyek", "Deadline", "Assign ke", "Menunggu"])
    assert.match(s, new RegExp(`label: "${l}"`), l);
  for (const re of [/React\.createElement\(NamePicker, \{\s*value: fv\.project,\s*options: scopeProjects,\s*title: projectScopeLabel\(task\.list_id, scopeLists\)/,
    /React\.createElement\(NamePicker, \{\s*value: fv\.context,\s*options: scopeContexts,\s*title: contextScopeLabel\(task\.list_id, scopeLists\)/,
    /onPick: pick\("gtd_status"\)/, /onPick: pick\("priority"\)/, /onPick: pick\("deadline"\)/, /onPick: pick\("assigned_to"\)/,
    /onChange: v => sf\("deadline", v\)/, /onDone: closeProp\("waiting_for"\)/, /TF\.taskdetail\.STATUS_ORDER/, /TF\.taskdetail\.PRIORITY_ORDER/])
    assert.match(s, re);
  for (const re of [/ComboSelect/, /createElement\("select"/, /className: "input-label"/, /type: "date"/]) assert.doesNotMatch(s, re);
});
test("NamePicker: cari tidak mengubah form; Enter = opsi sama persis atau + Buat; Kosongkan", () => {
  const n = fnSource("NamePicker");
  for (const re of [/TF\.taskdetail\.filterOptions\(/, /TF\.taskdetail\.exactOption\(/, /TF\.taskdetail\.canCreate\(/,
    /placeholder: "Cari atau buat baru(?:…|\\u2026)"/, /\+ Buat '/, /"Kosongkan"/, /onPick\(""\)/, /e\.key === "Enter"/, /autoFocus: true/])
    assert.match(n, re);
});
test("PropertyRow: nilai kosong '+ Tambah', tombol ber-aria", () => {
  const p = fnSource("PropertyRow");
  for (const re of [/"\+ Tambah"/, /"aria-haspopup": "dialog"/, /"aria-expanded": open/, /React\.createElement\(DetailPopover/]) assert.match(p, re);
});
test("DatePicker / MemberPicker / TextPicker / OptionPicker", () => {
  const d = fnSource("DatePicker");
  for (const re of [/taskDatePromptQuickPicks\(/, /type: "date"/, /"Hapus deadline"/, /onPick\(""\)/, /onChange\(e\.target\.value\)/]) assert.match(d, re);
  const m = fnSource("MemberPicker"); assert.match(m, /"Lepas"/); assert.match(m, /onPick\(null\)/); assert.match(m, /\(Saya\)/);
  assert.match(m, /"Tidak bisa memuat anggota"/);
  const t = fnSource("TextPicker"); assert.match(t, /"Simpan"/); assert.match(t, /e\.key === "Enter"/);
  const o = fnSource("OptionPicker"); assert.match(o, /"aria-pressed": /);
  for (const nm of ["PropertyRow", "OptionPicker", "NamePicker", "DatePicker", "MemberPicker", "TextPicker"])
    assert.doesNotMatch(fnSource(nm), EMOJI, nm);
});
```

  - `liveedit_ui.test.js` tes R19 diganti: "R19 → redesain: nama proyek/tahap hanya dari NamePicker (pilih = simpan, ketik = tidak)" — `fnSource("TaskDetailBody")` cocok `/onPick: pick\("project"\)/` dan `/onPick: pick\("context"\)/`, `fnSource("NamePicker")` tidak memanggil `onPick` dari `onChange` input (`assert.doesNotMatch(n, /onChange: e => \{?[^}]*onPick/)`).

- [ ] **Step 2: Jalankan, pastikan gagal** — `node --test tests/offline/liveedit.test.js tests/offline/task_detail_redesign.test.js tests/offline/liveedit_ui.test.js` → FAIL.

- [ ] **Step 3: Implementasi** — `saveTrigger`: `deadline` dan `waiting_for` → `"blur"` (perbarui komentar). Komponen sesuai Interfaces dan spec §4.4; `NamePicker` dipanggil dengan props berurutan `value, options, title, onPick`; `MemberPicker` menampilkan "Tidak bisa memuat anggota" bila `failed`. Ganti seluruh blok field (kisi `select` Priority/GTD, `ComboSelect` Project/Context beserta pembungkus `onBlur`/`onKeyDown`, input date, Waiting For, `select` Assign, deskripsi tetap di tempat) dengan `div.td-props` berurutan Status, Prioritas, Tahap, Proyek, Deadline, Assign ke (hanya `task.list_id`), Menunggu. Nilai: Status = `Icon(GTD_ICON[s])` + `GTD_LABELS[s]`; Prioritas = titik (`span.td-dot`, `background: PRI_DOT[p]`) + `` `${p} ${PRI_LABELS[p]}` ``; Deadline = `formatDeadline`, `danger: TF.taskdetail.isOverdue(fv.deadline, fv.gtd_status, todayISO)`; Assign = nama dari `listMembers` (`display_name || username`), selain itu `task.assigned_to_name || "Anggota"`; efek anggota menyetel `membersFailed` saat gagal. Semua baris: `open: openPop === field`, `onToggle: () => setOpenPop(p => (p === field ? null : field))`, `onClose: closeProp(field)`. NamePicker Enter: `exactOption` → `onPick(exact)`; selain itu `canCreate` → `onPick(q.trim())`; kotak kosong tidak melakukan apa pun.

- [ ] **Step 4: CSS** — `.td-props` (`grid-template-columns: 1fr 1fr; gap: 10px 16px`; `@media (max-width: 640px) { grid-template-columns: 1fr }`), `.td-prop.is-wide { grid-column: 1 / -1 }`, `.td-prop-label` (11–12 px, `--text-light`), `.td-prop-val` (tombol teks, hover `--bg-hover`, `.is-empty` `--text-light`, `.is-danger` `var(--danger, #dc2626)`), `.td-dot`, `.td-pop-input`, `.td-pop-list` (`max-height` dari popover), `.td-pop-create`, `.td-quick`.

- [ ] **Step 5: E2E kelompok `props`** (panel Live Edit 1280 px terang dan modal 375 px gelap):
  - `P-1` Status → "Waiting", Prioritas → "P1 Critical" → setelah sync server `waiting`/`P1`; Menunggu "Budi" + Enter → server `waiting_for == "Budi"`;
  - `P-2` (Review Focus 3) dengan proyek "Pemasaran" sudah ada: ketik "Pema", tunggu 2 dtk, Escape → `GET /api/projects` tanpa "Pema" dan proyek task tidak berubah; ketik "pemasaran" + Enter → proyek task "Pemasaran", tetap hanya satu nama itu (tanpa beda huruf) di server; "+ Buat 'Riset Pasar'" → proyek task "Riset Pasar", dibuat sekali; Tahap → "Kosongkan" → context kosong di server;
  - `P-3` offline: catat `outbox_count`, buka Deadline, klik input tanggal dan ketik `11152026` digit demi digit, tutup popover (klik di luar) → `outbox_count` naik tepat 1; online → server `deadline == "2026-11-15"`;
  - `P-4` (Review Focus 5) Prioritas P1 + Deadline "Hari ini" → chip kuadran "Q1" tanpa reload; ketik tanggal kemarin → chip "Terlambat" dan nilai Deadline ber-kelas `is-danger`; "Hapus deadline" → chip hilang, nilai "+ Tambah";
  - `P-5` workspace dua anggota (pemilik `POST /api/lists`, `POST /api/lists/{id}/generate-link`, anggota `POST /api/lists/join`): Assign ke anggota → server `assigned_to`; "Lepas" → server tanpa assignee;
  - `P-6` popover Escape menutup dan fokus kembali ke tombol nilai; detail tidak memuat `select`/`.input-label`.

- [ ] **Step 6: Jalankan** — tes node → PASS; `E2E_ONLY=autosave,topbar,props python3 temporary_files/e2e_detail_redesign.py` → lulus; verifikasi standar.

- [ ] **Step 7: Commit** — `git commit -m "feat(detail): kisi properti klik-untuk-ubah dengan popover; deadline/menunggu disimpan saat popover ditutup"`

---

### Task 5: Baris Tag dan tambah tag

**Files:**
- Modify: `static/index.html` — komponen baru `TagAdder`; `TaskDetailBody` (`addTag`, baris Tag, chip pindah dari bawah chip ke kisi)
- Modify: `static/app.css` (blok detail: `.td-tags`, `.td-tag`, `.td-tag-x`, `.td-tag-add`, `.td-pop-err`)
- Modify: `tests/offline/task_detail_redesign.test.js`, `tests/offline/liveedit_ui.test.js` (jumlah `tagChips()` / nama fungsi chip bila berubah)
- Modify: `temporary_files/e2e_detail_redesign.py` (kelompok `tags`)

**Interfaces:**
- Consumes: `TF.taskdetail.normalizeTagName`, `filterOptions` (Task 1); `tagsForTitle()`, `loadTags(id)`, `onSaved(patch)`, `taskTags`, `removeTag`, `showTagTasks` (sudah ada di body); `TF.liveedit.titleWithTags(title, tags)`; `auto.flush()`, `auto.getState()`; `DetailPopover`, `openPop` (Task 3).
- Produces: `TagAdder({ existing /* string[] */, onAdd /* async name -> string|null (pesan galat) */ })`; di body `const addTag = async raw => string|null`.

- [ ] **Step 1: Tes sumber yang gagal:**

```js
test("addTag: normalisasi, lewati yang sudah ada, flush dulu, tag segar, PUT judul tersimpan + #tag", () => {
  const s = fnSource("TaskDetailBody");
  const a = s.slice(s.indexOf("const addTag = async raw =>"));
  assert.ok(a.length > 30, "addTag ada");
  const order = ["TF.taskdetail.normalizeTagName(raw)", ".toLowerCase()", "await auto.flush()", '"Perubahan lain belum tersimpan. Coba lagi dulu."',
    "await tagsForTitle()", "TF.liveedit.titleWithTags(", "api.put(`/api/tasks/${task.id}`", "onSaved({"];
  let at = 0; for (const k of order) { const i = a.indexOf(k, at); assert.ok(i >= at, k); at = i; }
  assert.match(a, /auto\.getState\(\)\.saved\.title/);
});
test("baris Tag: chip + tombol Tambah tag + TagAdder", () => {
  const s = fnSource("TaskDetailBody");
  assert.match(s, /label: "Tag"/); assert.match(s, /"aria-label": "Tambah tag"/); assert.match(s, /React\.createElement\(TagAdder/);
  const t = fnSource("TagAdder");
  for (const re of [/api\.get\("\/api\/tags"\)/, /TF\.taskdetail\.filterOptions\(/, /role: "alert"/, /e\.key === "Enter"/, /autoFocus: true/])
    assert.match(t, re);
  assert.doesNotMatch(s, /rgba\(168,197,0/, "chip tag lewat kelas token");
  assert.doesNotMatch(t, EMOJI);
});
```

- [ ] **Step 2: Jalankan, pastikan gagal.**

- [ ] **Step 3: Implementasi** — `addTag(raw)` sesuai spec §6.3: `normalizeTagName` → galat dikembalikan; nama yang sudah ada di `taskTags` (tanpa beda huruf) → `null` tanpa request; `await auto.flush()`; `auto.getState().saveState === "error"` → pesan; `tags = await tagsForTitle()`; `await api.put(\`/api/tasks/${task.id}\`, { title: TF.liveedit.titleWithTags(auto.getState().saved.title, [...tags, { name }]) })`; `onSaved({ title: … })` (memuat ulang chip + `taskUpdated` + `onRefresh`); galat request → `err.message`. `TagAdder`: input (`autoFocus`, `"aria-label": "Nama tag"`, placeholder "Nama tag…"), saran dari `GET /api/tags` (dimuat sekali saat terbuka) yang belum terpasang dan cocok `filterOptions`, paling banyak 8; Enter/klik saran → `onAdd`; sukses → input dikosongkan, popover tetap terbuka; galat → `div.td-pop-err[role=alert]`. Baris Tag = `div.td-prop.is-wide` dengan label "Tag", chip `span.td-tag` (klik → `showTagTasks`, `button.td-tag-x` `"aria-label": "Hapus tag " + name` → `removeTag`), tombol `button.td-tag-add` (`Icon plus`, `"aria-label": "Tambah tag"`) sebagai jangkar `DetailPopover` label "Tambah tag" (`openPop === "tag"`). Hapus render `tagChips()` dari bawah chip; pertahankan pemendekan "+N more"/"‹ less" yang ada.

- [ ] **Step 4: E2E kelompok `tags`** (modal 375 px gelap, panel 1280 px terang):
  - `G-1` task bertag lokal `kerja` → "+" → "Rapat" Enter → chip `#kerja` dan `#Rapat`; lokal dua tag; setelah sync server dua tag; judul lokal/server tanpa `#`;
  - `G-2` (Review Focus 3) offline: "+" → "#KERJA" Enter → tidak ada chip baru, `outbox_count` dan `updated_at` lokal tetap;
  - `G-3` "dua kata" → alert "Tag hanya boleh huruf, angka, dan _"; kosong + Enter → "Tulis nama tag";
  - `G-4` task lain bertag `proyekx` → ketik "proy" → saran `proyekx` → klik → terpasang;
  - `G-5` × pada `#Rapat` → hilang; lalu ubah judul → `#Rapat` tidak kembali (lokal dan server);
  - `G-6` ketik deskripsi lalu (< 1 dtk) tambah tag → deskripsi dan tag sama-sama tersimpan.

- [ ] **Step 5: Jalankan** — tes node → PASS; `E2E_ONLY=tags,props python3 temporary_files/e2e_detail_redesign.py` → lulus; verifikasi standar.

- [ ] **Step 6: Commit** — `git commit -m "feat(detail): baris Tag dengan tambah tag lewat judul #tag (aman untuk tag lain)"`

---

### Task 6: Deskripsi tanpa bingkai dan tab isi

**Files:**
- Modify: `static/index.html` — komponen baru `DetailTabs`, `SubtaskRow`, `ChecklistRow`; `ModalNotes` (±8216) dan `ModalAttachments` (±8062) prop `bare`, `onCount`; `TaskDetailBody`
- Modify: `static/app.css` (blok detail: `.td-desc`, `.td-tabs`, `.td-tab`, `.td-tabpanel`, `.td-sub-row`, `.td-check-row`, `.td-add`, `@media (hover: none)`)
- Modify: `tests/offline/task_detail_redesign.test.js`; tes lain yang mengunci teks bagian lama bila ada (cek `grep -rn "Belum ada checklist\|Judul subtask baru\|📌 Subtask" tests/`)
- Modify: `temporary_files/e2e_detail_redesign.py` (kelompok `tabs`)

**Interfaces:**
- Consumes: `TF.taskdetail.initialTab`, `TAB_ORDER`, `formatShortDate`, `isOverdue` (Task 1); `childTasks`, `fetchChildTasks`, `subtasks`, `handleToggle`, `handleAddSub`, `handleDeleteSub`, `onOpenTask`, `onRefresh` (body); `StatusBadge`; `genId()`.
- Produces: `DetailTabs({ tabs /* [{id, label, count}] */, active, onSelect, idBase })` (tablist, panah kiri/kanan); `SubtaskRow({ task, todayISO, onToggle, onOpen })`; `ChecklistRow({ item, onToggle, onDelete })`; `ModalNotes({ taskId, collaborators, bare = false, onCount })`, `ModalAttachments({ taskId, bare = false, onCount })` — `onCount(n)` dipanggil sesudah muat pertama (sukses atau gagal) dan setiap jumlah berubah; tanpa prop baru tampilannya sama dengan sekarang.

- [ ] **Step 1: Tes sumber yang gagal:**

```js
test("deskripsi tanpa bingkai, tinggi mengikuti isi", () => {
  const s = fnSource("TaskDetailBody");
  assert.match(s, /className: "td-desc"/);
  assert.match(s, /placeholder: "Tulis deskripsi atau catatan lingkup tugas di sini(?:…|\\u2026)"/);
  assert.match(s, /querySelector\("textarea"\)[\s\S]{0,200}scrollHeight/);
});
test("tab: urutan, jumlah, hidden, tab awal sekali setelah empat muatan, pilihan pengguna menang", () => {
  const s = fnSource("TaskDetailBody");
  for (const re of [/React\.createElement\(DetailTabs/, /TF\.taskdetail\.initialTab\(/, /role: "tabpanel"/, /hidden: tab !== /,
    /tabPickedRef\.current/, /onCount: setNotesCount/, /onCount: setAttCount/, /bare: true/, /"\+ Buat subtask baru(?:…|\\u2026)"/,
    /"\+ Tambah butir checklist baru"/, /"Belum ada subtask"/, /"Belum ada checklist"/, /gtd_status: "inbox",\s*parent_id: task\.id/])
    assert.match(s, re);
  for (const re of [/newChildGtd/, /"Judul subtask baru\.\.\."/, /\\uD83D\\uDCCC Subtask/, /priColor/]) assert.doesNotMatch(s, re);
  const t = fnSource("DetailTabs");
  for (const re of [/role: "tablist"/, /role: "tab"/, /"aria-selected"/, /"aria-controls"/, /"ArrowRight"/, /"ArrowLeft"/]) assert.match(t, re);
});
test("SubtaskRow / ChecklistRow", () => {
  const r = fnSource("SubtaskRow");
  for (const re of [/"aria-label": "Buka subtask"/, /StatusBadge/, /TF\.taskdetail\.formatShortDate\(/, /line-through/, /role: "checkbox"/]) assert.match(r, re);
  const c = fnSource("ChecklistRow");
  for (const re of [/"aria-label": "Hapus butir"/, /role: "checkbox"/, /"aria-checked"/]) assert.match(c, re);
  for (const n of ["DetailTabs", "SubtaskRow", "ChecklistRow"]) assert.doesNotMatch(fnSource(n), EMOJI, n);
});
test("ModalNotes / ModalAttachments: bare + onCount, bawaan tetap", () => {
  for (const n of ["ModalNotes", "ModalAttachments"]) {
    const m = fnSource(n); assert.match(m, /bare = false/); assert.match(m, /onCount/); assert.match(m, /!bare &&/);
  }
});
```

- [ ] **Step 2: Jalankan, pastikan gagal.**

- [ ] **Step 3: Implementasi** — Deskripsi: pembungkus `div.td-desc-wrap` (ref) › `MentionInput as="textarea"` `className: "td-desc"`, `rows: 3`, placeholder persis, `"aria-label": "Deskripsi"`, `onBlur` commit; `React.useLayoutEffect` pada `fv.description`: `ta = wrap.querySelector("textarea")`, `ta.style.height = "auto"`, `ta.style.height = Math.min(ta.scrollHeight, maxPx) + "px"` dengan `maxPx` = 12 × `line-height` terhitung (CSS `overflow-y: auto` di atasnya). Tab: state `tab` (awal `"subtask"`), `tabPickedRef` (diset saat pengguna memilih), `autoTabDoneRef`; muatan `childLoaded`, `!loadingSubs`, `notesCount !== null`, `attCount !== null` → sekali `setTab(initialTab({subtask, checklist, notes, attachments}))` bila belum dipilih pengguna; `idBase = useRef("td" + genId())`. Panel tab dirender keempatnya dengan `hidden: tab !== id`. Subtask: `SubtaskRow` (centang selesai → `api.post(\`/api/tasks/${ct.id}/done\`)`, buka lagi → `api.put(\`/api/tasks/${ct.id}\`, { gtd_status: "next" })`, lalu `fetchChildTasks(); onRefresh?.()`; galat → `window.__showToast(err.message, "error")`; judul atau ↗ → `onOpenTask ? onOpenTask(ct) : onClose()`), input `"+ Buat subtask baru…"` (Enter → `POST /api/tasks {title, gtd_status: "inbox", parent_id: task.id}`); `fetchChildTasks` menyetel `childLoaded` di sukses dan gagal. Checklist: bar tipis selesai/total, `ChecklistRow`, tombol "+ Tambah butir checklist baru" → `MentionInput` (Enter tambah dan tetap terbuka, Escape tutup). `ModalNotes`/`ModalAttachments`: `bare` menyembunyikan garis atas + judul bagian (tombol Upload tetap), state `loaded` diset di `then` dan `catch`, efek `onCount` pada `[loaded, n]`.

- [ ] **Step 4: E2E kelompok `tabs`** (panel 1280 px terang, modal 375 px gelap):
  - `B-1` task dengan 2 task anak, 3 butir checklist, 1 catatan → label tab "Subtask (2)", "Checklist (3)", "Catatan (1)", "Lampiran"; aktif "Subtask"; task yang hanya punya catatan → aktif "Catatan";
  - `B-2` "+ Buat subtask baru…" "Anak C" Enter → baris `#<id> Anak C` dengan chip Inbox, "Subtask (3)"; centang → dicoret + server `done`; centang lagi → server `next`; ↗ → panel menampilkan Anak C; modal: ↗ → modal menampilkan Anak C;
  - `B-3` checklist: tambah "Butir 4" lalu "Butir 5" tanpa membuka ulang, Escape → "Checklist (5)"; centang → `aria-checked="true"` dan lokal selesai; × → "Checklist (4)";
  - `B-4` tambah catatan di tab Catatan → label "Catatan (2)";
  - `B-5` deskripsi: placeholder persis; 5 baris → tinggi bertambah; 30 baris → tinggi berhenti ≤ 12 baris dan textarea bisa digulir;
  - `B-6` fokus tab "Subtask", ArrowRight → "Checklist" `aria-selected="true"`.

- [ ] **Step 5: Jalankan** — tes node → PASS; `python3 temporary_files/e2e_detail_redesign.py` (semua kelompok) → lulus; verifikasi standar.

- [ ] **Step 6: Commit** — `git commit -m "feat(detail): deskripsi tanpa bingkai dan tab Subtask/Checklist/Catatan/Lampiran"`

---

### Task 7: Sesuaikan E2E lama dan uji menyeluruh

**Files:**
- Modify: `temporary_files/e2e_task_detail_body.py`, `temporary_files/e2e_live_edit.py`
- Modify (bila ada temuan): berkas Task 2–6 yang terkait temuan

**Interfaces:**
- Consumes: seluruh UI Task 2–6; pemilih yang dipakai: `aria-label` ("Judul task", "Deskripsi", "Aksi lain", "Fokus", "Tambah tag", "Buka subtask", "Hapus butir"), label properti (`.td-prop` berlabel), `.td-pop`, `role="tab"`.
- Produces: tiga skrip E2E yang lulus penuh di `HEAD` branch.

- [ ] **Step 1: `e2e_task_detail_body.py`** — ganti alur "✏️ Edit → Priority → 💾 Simpan" dengan popover Prioritas; tag aman (`g`) memakai ubah judul di modal dan form edit lengkap (`TaskFormModal`, tidak berubah); task anak (`e`) lewat tab Subtask ↗; overlay (`d`, `h`) tetap; perbarui docstring per langkah.
- [ ] **Step 2: `e2e_live_edit.py`** — perubahan prioritas/status lewat popover; skenario R19 (nama proyek/tahap setengah diketik tidak pernah dibuat) lewat `NamePicker`; cek bar aksi bawah di viewport diganti: bar atas terlihat pada scrollTop 0 dan tetap menempel (di dalam aside, `top` ≈ `aside.top`) setelah panel digulir; Done di panel → "Buka lagi"; skenario offline/outbox, perpindahan view/task, ambang 760 px, overlay tag tetap.
- [ ] **Step 3: Jalankan ketiganya penuh**, dua kali berturut-turut: `python3 temporary_files/e2e_detail_redesign.py`, `python3 temporary_files/e2e_task_detail_body.py`, `python3 temporary_files/e2e_live_edit.py` → semua langkah lulus. Lihat screenshot 375 px gelap dan 1280 px terang (modal dan panel): tidak ada teks terpotong, popover di dalam layar, kontras teks pada token.
- [ ] **Step 4: Temuan** — perbaiki di berkas terkait dengan tes sumber/E2E yang menangkapnya (gagal sebelum perbaikan), catat di laporan task.
- [ ] **Step 5: Verifikasi standar + commit** — `git commit -m "test(e2e): sesuaikan E2E detail task dan Live Edit dengan tampilan baru"`

---

### Task 8: Rilis

**Files:**
- Modify: `static/sw.js` (`CACHE`, `STATIC` `app.css?v=369`), `static/index.html` (`window.__SW_VERSION` dua tempat, `<link>` `app.css?v=369`), tes yang mengunci versi (`grep -rln "taskflow-v471-simpan-tag\|app.css?v=368" tests/ static/ --exclude=whatsnew.json`)
- Modify: `static/whatsnew.json` (entri teratas baru)
- Modify: `.agents/DECISIONS.md` (ADR-033), `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md`, `docs/superpowers/specs/2026-10-26-redesain-detail-task-design.md` (status + keputusan pelaksanaan)

**Interfaces:**
- Consumes: semua task sebelumnya.
- Produces: branch siap PR draft.

- [ ] **Step 1: Pilih versi** — `git fetch origin main` dan cek PR terbuka (`gh api repos/mtyatno/taskflow-v4/pulls`); pakai nomor kosong berikutnya (v472 bila belum terpakai): `taskflow-v472-detail-baru`.
- [ ] **Step 2: Naikkan versi** — ganti `taskflow-v471-simpan-tag` → `taskflow-v472-detail-baru` dan `app.css?v=368` → `app.css?v=369` di `static/` dan `tests/` **kecuali** `static/whatsnew.json`.
- [ ] **Step 3: `whatsnew.json`** — entri teratas `{"version": "taskflow-v472-detail-baru", "date": "<tanggal rilis>", "title": "Tampilan detail task baru", "new": ["Klik nilai mana pun di detail task untuk mengubahnya; perubahan tersimpan otomatis, juga di jendela detail di HP.", "Subtask, checklist, catatan, dan lampiran kini dalam tab dengan jumlah isinya.", "Atur progress dengan cepat lewat pilihan 0, 25, 50, 75, atau 100%."]}` (bentuk mengikuti entri yang ada).
- [ ] **Step 4: Dokumen** — ADR-033 (teks spec §12) di `DECISIONS.md`; status spec + keputusan yang diambil selama eksekusi; `CURRENT_STATE.md` (entri teratas: branch, isi, verifikasi, deploy = file statis tanpa restart) dan `SESSION_LOG.md`.
- [ ] **Step 5: Verifikasi** — `python3 -m pytest tests/test_whatsnew.py tests/test_sw_precache_node.py tests/test_app_update_node.py -q` → PASS; `npm test`; `python3 -m pytest tests/ -q`; `node temporary_files/check_inline_scripts.js`; tiga skrip E2E sekali lagi.
- [ ] **Step 6: Commit** — `git commit -m "chore(release): SW v472 taskflow-v472-detail-baru — tampilan detail task baru"`; push branch dan buka PR draft (merge hanya setelah pemilik bilang "merge dan deploy").
