"use strict";

// Redesain detail task (spec docs/superpowers/specs/2026-10-26-redesain-detail-task-design.md §6.1): modal dan panel
// memakai TaskDetailBody yang sama dengan simpan otomatis (useTaskAutosave). Mode lihat → ✏️ Edit → 💾 Simpan dihapus.

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

test("simpan otomatis di modal dan panel; tanpa mode Edit/Simpan", () => {
  const s = fnSource("TaskDetailBody");
  assert.match(s, /const auto = useTaskAutosave\(task, true, \{/);
  assert.match(s, /const fv = auto\.form;/); assert.match(s, /const sf = auto\.change;/);
  for (const re of [/isEditing/, /handleSave/, /"💾 Simpan"/, /\\u270F\\uFE0F Edit/, /OfflineDB\.queueAdd/, /resetForm/,
                    /const \[form, setForm\]/, /const \[saving, setSaving\]/, /isPanel \? auto\./, /onOfflineEdit/])
    assert.doesNotMatch(s, re);
  assert.match(s, /const tagsVersion = task\?\.updated_at;/);
  assert.match(s, /api\.get\(`\/api\/lists\/\$\{task\.list_id\}\/members`\)[\s\S]{0,400}\}, \[task\?\.list_id\]\);/);
  // Indikator simpan + ✕ (headerAction) diteruskan ke bar atas (DetailTopBar) di kedua variant.
  assert.match(s, /indicator: (\/\*#__PURE__\*\/)?React\.createElement\(TaskSaveIndicator/);
  assert.match(s, /headerAction: headerAction/);
  assert.match(s, /"aria-label": "Deskripsi"/);
});

// ── Task 3: bar atas, judul, chip, progress, popover, menu ⋯ (spec §4.1–§4.3, §5) ──
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

// ── Task 4: kisi properti dengan popover (spec §4.4, §6.2) ──
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
