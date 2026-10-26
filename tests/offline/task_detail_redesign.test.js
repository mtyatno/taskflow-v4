"use strict";

// Redesain detail task (spec docs/superpowers/specs/2026-10-26-redesain-detail-task-design.md §6.1): modal dan panel
// memakai TaskDetailBody yang sama dengan simpan otomatis (useTaskAutosave). Mode lihat → ✏️ Edit → 💾 Simpan dihapus.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");

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
  assert.match(s, /React\.createElement\(TaskSaveIndicator, \{[^}]*\}\), headerAction/, "indikator + ✕ berdampingan di kedua variant");
  assert.match(s, /"aria-label": "Deskripsi"/);
});
