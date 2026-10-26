"use strict";

// Live Edit, Task 1: isi TaskDetailModal dipisah ke TaskDetailBody (Fragment, ruling R4) supaya bisa dipakai
// ulang di panel samping. TaskDetailModal tinggal pembungkus overlay + tombol ✕. Refactor murni: tanpa
// perubahan perilaku modal.

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

test("TaskDetailBody didefinisikan tepat sebelum TaskDetailModal", () => {
  const b = indexHtml.indexOf("\nfunction TaskDetailBody({"), m = indexHtml.indexOf("\nfunction TaskDetailModal(");
  assert.ok(b > 0 && m > b);
  assert.equal(indexHtml.slice(b + 1, m).match(/\nfunction /g), null, "tidak ada fungsi lain di antaranya");
});

test("TaskDetailModal hanya pembungkus overlay + ✕", () => {
  const s = fnSource("TaskDetailModal");
  for (const re of [/className: "modal-overlay"/, /className: "modal-content scale-in"/, /React\.createElement\(TaskDetailBody/,
                    /variant: "modal"/, /headerAction:/, /"\\u2715"/, /onClick: props\.onClose/, /stopPropagation/])
    assert.match(s, re);
  assert.doesNotMatch(s, /useState\(|ModalNotes|handleSave/);
});

test("TaskDetailBody memuat isi detail dan slot headerAction, tanpa overlay", () => {
  const s = fnSource("TaskDetailBody");
  assert.match(s, /variant = "modal"/); assert.match(s, /headerAction = null/);
  for (const re of [/ModalNotes/, /ModalAttachments/, /moveOpen && (\/\*#__PURE__\*\/)?React\.createElement\(TaskMovePanel, \{/, /onMove: handleMove/])
    assert.match(s, re);
  // Panel Pindah dipisah ke TaskMovePanel (redesain detail Task 4: isi detail tanpa select); isinya tetap.
  for (const re of [/"Pindah ke Workspace"/, /"aria-label": "Workspace tujuan"/, /"Pindahkan"/, /"Batal"/])
    assert.match(fnSource("TaskMovePanel"), re);
  // Redesain detail (spec §6.1): mode lihat → ✏️ Edit → 💾 Simpan dihapus, modal ikut simpan otomatis.
  for (const re of [/handleSave/, /"💾 Simpan"/, /"\\u270F\\uFE0F Edit"/])
    assert.doesNotMatch(s, re);
  assert.doesNotMatch(s, /modal-overlay|modal-content/);
  assert.ok(s.lastIndexOf("return /*#__PURE__*/React.createElement(React.Fragment, null,") > s.indexOf("const progress ="), "root = Fragment (R4)");
});

test("App tetap merender TaskDetailModal dengan props yang sama", () => {
  const s = fnSource("App");
  assert.match(s, /React\.createElement\(TaskDetailModal, \{\s*task: selectedTask,\s*onClose: \(\) => setSelectedTask\(null\)/);
});
