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
