"use strict";

// Live Edit, Task 5: varian `panel` di TaskDetailBody. Field utama selalu bisa diedit dan tersimpan otomatis lewat
// TF.liveedit.createAutosaver (dibungkus useTaskAutosave); modal (variant "modal") tetap lihat → ✏️ Edit → 💾 Simpan.
// Spec docs/superpowers/specs/2026-10-26-live-edit-design.md §7.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const appCss = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8").replace(/\r\n/g, "\n");

function fnSource(name) {
  const start = indexHtml.indexOf(`\nasync function ${name}(`) >= 0
    ? indexHtml.indexOf(`\nasync function ${name}(`) : indexHtml.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = indexHtml.indexOf("\n}\n", start + 1);
  return indexHtml.slice(start, end + 2);
}

test("useTaskAutosave: pembungkus createAutosaver dengan flush saat sembunyi/unmount", () => {
  const s = fnSource("useTaskAutosave");
  for (const re of [/TF\.liveedit\.createAutosaver/, /"visibilitychange"/, /"pagehide"/, /\.flush\(\)/, /\.dispose\(\)/, /\.external\(/, /api\.put\("\/api\/tasks\/" \+ taskIdRef\.current/])
    assert.match(s, re);
});

test("TaskSaveIndicator: teks, aria-live, Coba lagi, 2000 ms", () => {
  const s = fnSource("TaskSaveIndicator");
  for (const re of [/"Menyimpan…"/, /"Tersimpan"/, /"Gagal menyimpan"/, /"Coba lagi"/, /"aria-live": "polite"/, /2000/]) assert.match(s, re);
});

test("TaskDetailBody: varian panel", () => {
  const s = fnSource("TaskDetailBody");
  for (const re of [/const isPanel = variant === "panel"/, /const editing = isPanel \|\| isEditing/, /useTaskAutosave\(task, isPanel/,
    /auto\.commit\("title"\)/, /auto\.revertTitle\(\)/, /e\.key === "Enter"/, /e\.key === "Escape"/, /role: "alert"/,
    /React\.createElement\(TaskSaveIndicator/, /auto\.commit\("project"\)/, /auto\.commit\("context"\)/, /auto\.commit\("progress"\)/,
    /onPointerUp/, /className: "task-detail-actions"/, /const tagChips = \(\) =>/, /\[editing, task\?\.list_id\]/])
    assert.match(s, re);
  assert.ok((s.match(/tagChips\(\)/g) || []).length >= 2, "chip tag dipakai mode lihat + panel");
  assert.match(s, /!isPanel && (\/\*#__PURE__\*\/)?React\.createElement\("button", \{[\s\S]{0,160}setIsEditing\(true\)/);
  assert.match(s, /if \(!isPanel\) onClose\(\)/);
  assert.doesNotMatch(s, /borderLeft/);
});

test("Modal tetap: TaskDetailModal variant modal, handleSave menutup", () => {
  assert.match(fnSource("TaskDetailModal"), /variant: "modal"/);
  assert.match(fnSource("TaskDetailBody"), /const handleSave = async[\s\S]{0,200}onClose\(\)/);
});

test("CSS indikator + aksi menempel di panel", () => {
  assert.match(appCss, /\.tl-save-ind\s*\{/); assert.match(appCss, /\.tl-live-panel \.task-detail-actions\s*\{[^}]*position:\s*sticky/);
  assert.match(appCss, /\.task-detail-title-input\s*\{/);
});

// Perbaikan review Task 5 #1: "Judul tidak boleh kosong" (spec §7.4 langkah 2, role="alert") harus terlihat.
test("Panel judul: Enter dengan judul tidak valid tidak blur; pesan bertahan setelah blur (titleNotice)", () => {
  const s = fnSource("TaskDetailBody");
  const row = s.slice(s.indexOf('"aria-label": "Judul task"'));
  const enter = row.slice(row.indexOf('e.key === "Enter"'), row.indexOf('e.key === "Escape"'));
  const v = enter.indexOf("validateTitle(auto.getState().form.title)");
  const b = enter.indexOf("e.currentTarget.blur()");
  assert.ok(v >= 0 && b > v, "cabang Enter memeriksa validateTitle sebelum blur()");
  assert.match(enter, /if \(invalid\) setTitleNotice\(invalid\);\s*else e\.currentTarget\.blur\(\)/);
  assert.match(s, /const \[titleNotice, setTitleNotice\] = useState\(null\)/);
  assert.match(s, /auto\.revertTitle\(\);\s*auto\.retry\(\);\s*setTitleNotice\(invalid\)/, "blur mengembalikan judul dan menyimpan pesannya");
  assert.match(s, /sf\("title", e\.target\.value\);\s*if \(titleNotice\) setTitleNotice\(null\)/, "ketikan berikutnya menghapus pesan");
  assert.match(s, /const titleAlert = isPanel \? titleNotice \|\|/);
  assert.match(s, /titleAlert && (\/\*#__PURE__\*\/)?React\.createElement\("div", \{\s*role: "alert"[\s\S]{0,160}\}, titleAlert\)/);
});

// Perbaikan review Task 5 #2 (ruling R14): judul tidak dikirim sebelum daftar tag task diketahui.
test("R14: put menunggu daftar tag hanya bila patch membawa judul", () => {
  const h = fnSource("useTaskAutosave");
  const put = h.slice(h.indexOf("put: async patch =>"), h.indexOf('api.put("/api/tasks/" + taskIdRef.current'));
  const check = put.indexOf("if (patch.title != null) {");
  assert.ok(check >= 0, "cek patch.title ada di jalur put");
  assert.ok(put.indexOf("await ") > check, "tidak ada await sebelum cek judul: simpan tanpa judul tidak menunggu");
  assert.match(put.slice(check), /await tagsOf\(\)[\s\S]{0,160}titleWithTags\(patch\.title, tags\)/);

  const s = fnSource("TaskDetailBody");
  assert.match(s, /getTags: tagsForTitle/);
  assert.doesNotMatch(s, /getTags: \(\) => taskTagsRef\.current/);
  const fn = s.slice(s.indexOf("const tagsForTitle = async () =>"), s.indexOf("const liveMountedRef"));
  assert.match(fn, /await \(tagsLoadRef\.current \|\| Promise\.resolve\(false\)\)/, "menunggu pemuatan tag task ini");
  assert.match(fn, /if \(known\) return taskTagsRef\.current/);
  assert.equal((fn.match(/loadTags\(task\.id\)/g) || []).length, 1, "muat ulang sekali bila pemuatan awal gagal");
  assert.match(fn, /throw new Error\(/, "gagal lagi → put ditolak, bukan mengirim judul tanpa tag");
  assert.match(s, /taskTagsRef\.current = list;/, "loadTags mengisi ref sebelum promise selesai");
  assert.match(s, /tagsLoadRef\.current = loadTags\(task\.id\)\.catch\(\(\) => \{\s*setTaskTags\(\[\]\);\s*return false;/);
  assert.match(s, /patch\.title != null\) \{[\s\S]{0,200}tagsLoadRef\.current = loadTags\(task\.id\)\.catch\(\(\) => false\)/,
    "muat ulang tag setelah simpan judul ikut ditunggu simpan judul berikutnya");
});

// Task 6: penanda task terpilih di baris dan kartu (spec §6.5). Tanpa prop selected/isSelected tampilan tidak berubah.
test("baris & kartu menerima selected + aria-current, tanpa border-left", () => {
  const row = fnSource("TaskRow"), comp = fnSource("CompactRow"), card = fnSource("KanbanCard");
  assert.match(row, /selected = false/); assert.match(row, /" is-selected"/); assert.match(row, /"aria-current": selected \? "true" : undefined/);
  assert.match(comp, /className: "compact-row" \+ \(selected \? " is-selected" : ""\)/); assert.doesNotMatch(comp, /onMouseLeave/);
  assert.match(card, /linear-gradient\(var\(--bg-selected\), var\(--bg-selected\)\), var\(--bg-card\)/);
  assert.match(fnSource("KanbanView"), /isSelected/);
  for (const s of [row, comp, card]) assert.doesNotMatch(s, /borderLeft/);
});
test("CSS sorotan terang/gelap", () => {
  assert.match(appCss, /--bg-selected:\s*rgba\(15, 23, 42, 0\.07\)/); assert.match(appCss, /--bg-selected:\s*rgba\(255, 255, 255, 0\.10\)/);
  assert.match(appCss, /\.task-row\.is-selected\s*\{[^}]*var\(--bg-selected\)/); assert.match(appCss, /\.compact-row\.is-selected\s*\{/);
  assert.match(appCss, /\.compact-row:hover\s*\{[^}]*var\(--bg-primary\)/);
});

// Task 7: tombol Live Edit, tata letak dua kolom, pilihan task (spec §4–§6, R3/R4/R6).
test("useLiveEdit: ResizeObserver, storage aman, panelTop dari desktop-topbar", () => {
  const s = fnSource("useLiveEdit");
  for (const re of [/ResizeObserver/, /TF\.liveedit\.isAvailable/, /TF\.liveedit\.panelWidth/, /TF\.liveedit\.readOn/, /TF\.liveedit\.writeOn/, /"\.desktop-topbar"/, /try \{/])
    assert.match(s, re);
});
test("TaskDetailPanel: aside, key cid, varian panel, teks keadaan", () => {
  const s = fnSource("TaskDetailPanel");
  for (const re of [/"aria-label": "Detail task"/, /key: task\.cid \|\| String\(task\.id\)/, /variant: "panel"/,
    /"Task ini sudah dihapus atau tidak bisa diakses lagi\."/, /onClose: \(\) => \{\}/, /await detailProps\.onDelete\(task\.id\)/])
    assert.match(s, re);
});
test("TaskListView: tombol Live Edit, reducer pilihan, pembungkus dua kolom", () => {
  const s = fnSource("TaskListView");
  for (const re of [/useLiveEdit\(rootRef\)/, /className: "tl-view-btn tl-live-btn"/, /"aria-pressed": live\.on/, /"aria-label": "Live Edit"/,
    /"Sembunyikan panel detail"/, /"Tampilkan panel detail di samping"/, /TF\.liveedit\.selectionReducer/, /type: "init"/, /type: "deleted"/,
    /className: "tl-live"/, /className: "tl-live-list"/, /React\.createElement\(TaskDetailPanel/, /"Pilih task di daftar"/, /"Tidak ada task"/,
    /isSelected: liveOn \? isSel : null/, /TF\.liveedit\.isNotFound/])
    assert.match(s, re);
  assert.equal((s.match(/buildGroups\(filtered\)/g) || []).length, 1, "grup dihitung sekali");
});
test("App: handleDelete mengembalikan boolean, detailProps ke kedua TaskListView", () => {
  const s = fnSource("App");
  assert.match(s, /if \(!confirm\("Hapus task ini\?"\)\) return false;/);
  assert.equal((s.match(/detailProps: taskDetailProps/g) || []).length, 2);
});
test("CSS tata letak Live Edit", () => {
  for (const re of [/\.tl-live\s*\{[^}]*display:\s*flex/, /\.tl-live-panel\s*\{[^}]*position:\s*sticky/, /\.tl-live-sep\s*\{/, /\.tl-live-label/])
    assert.match(appCss, re);
  // R16: hanya blok CSS Live Edit (penanda awal/akhir), bukan sampai akhir app.css.
  const lsStart = appCss.indexOf("/* ── Live Edit:");
  const lsEnd = appCss.indexOf("/* ── Live Edit: akhir ── */");
  assert.ok(lsStart >= 0 && lsEnd > lsStart, "blok CSS Live Edit bertanda awal dan akhir");
  const block = appCss.slice(lsStart, lsEnd);
  assert.match(block, /\.tl-live-panel\s*\{/);
  assert.doesNotMatch(block, /border-left/);
});
// Review mandiri Task 7: scrollbar halaman yang muncul karena panel tidak boleh menyembunyikan panel itu sendiri
// (berkedip di dekat ambang 760 px); "tidak tersedia" hanya selama task memang tidak ada di allTasks.
test("useLiveEdit: lebar seolah tanpa scrollbar halaman; gone hanya bila task tidak ditemukan", () => {
  const s = fnSource("useLiveEdit");
  assert.match(s, /window\.innerWidth - document\.documentElement\.clientWidth/);
  assert.match(s, /const w = el\.clientWidth \+ pageScrollbar;/);
  const v = fnSource("TaskListView");
  assert.match(v, /const gone = !selFound && goneId != null/);
  assert.match(v, /if \(!selMissingId\) \{\s*checkedIdRef\.current = null;/);
  // daftar kosong → berisi (task pertama tiba setelah panel tampil): pilih ulang, bukan "Tidak ada task" di samping daftar berisi
  assert.match(v, /\}, \[liveOn, page, loading, hasVisible\]\);/);
});
// Ruling R15: max-height panel dari posisi panel sekarang (bar aksi terlihat di scrollTop 0 dan setelah gulir).
test("R15: TaskDetailPanel max-height dari posisi sekarang, scroll/resize pasif + rAF, tanpa maxHeight di style", () => {
  const s = fnSource("TaskDetailPanel");
  assert.match(s, /ref: asideRef/);
  assert.match(s, /window\.innerHeight - Math\.max\(topRef\.current, el\.getBoundingClientRect\(\)\.top\) - 16/);
  assert.match(s, /el\.style\.maxHeight = next/);
  assert.match(s, /window\.addEventListener\("scroll", onMove, \{ passive: true \}\)/);
  assert.match(s, /window\.addEventListener\("resize", onMove, \{ passive: true \}\)/);
  assert.match(s, /window\.removeEventListener\("scroll", onMove\)/);
  assert.match(s, /window\.removeEventListener\("resize", onMove\)/);
  assert.match(s, /raf = requestAnimationFrame\(/);
  assert.match(s, /if \(raf\) cancelAnimationFrame\(raf\)/);
  assert.match(s, /\}, \[top\]\);/, "dihitung ulang saat top berubah");
  const style = s.slice(s.indexOf("style: {"), s.indexOf("}", s.indexOf("style: {")));
  assert.match(style, /width,\s*top/);
  assert.doesNotMatch(s, /maxHeight:/, "max-height tidak lagi lewat prop style React");
});
// Ruling R16: pemeriksaan "tidak tersedia" yang berhasil (atau dipersenjatai ulang) membuang goneId lama.
test("R16: goneId dibuang saat task ditemukan lagi", () => {
  const v = fnSource("TaskListView");
  assert.match(v, /if \(task\) \{\s*setGoneId\(null\);\s*dispatchSel\(\{ type: "snapshot", task \}\);/);
  // dipersenjatai ulang: dibuang hanya saat panel tampil (task ditemukan lagi / pilihan berganti), bukan saat panel
  // disembunyikan — kalau tidak, body task yang sudah dihapus sempat di-mount saat layar melebar lagi.
  assert.match(v, /if \(!selMissingId\) \{\s*checkedIdRef\.current = null;\s*if \(liveOn\) setGoneId\(null\);/);
});
