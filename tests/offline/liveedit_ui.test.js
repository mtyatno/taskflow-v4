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
