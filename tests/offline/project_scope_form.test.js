"use strict";

// Form task: pilihan scope (Pribadi / workspace) dan dropdown project per scope.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const indexHtml = fs.readFileSync(path.join(ROOT, "static/index.html"), "utf8").replace(/\r\n/g, "\n");
const appCss = fs.readFileSync(path.join(ROOT, "static/app.css"), "utf8").replace(/\r\n/g, "\n");

function loadHelpers() {
  const start = indexHtml.indexOf("function projectAfterScopeChange(");
  const end = indexHtml.indexOf("function fetchScopeProjects(", start);
  assert.ok(start > 0 && end > start, "helper scope project harus ada sebelum fetchScopeProjects");
  return new Function(`${indexHtml.slice(start, end)}; return { projectAfterScopeChange, projectScopeLabel, projectScopeOptionLabel };`)();
}

function sliceFn(startMarker, endMarker) {
  const start = indexHtml.indexOf(startMarker);
  assert.ok(start > 0, `${startMarker} harus ada`);
  const end = indexHtml.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `${endMarker} harus ada setelah ${startMarker}`);
  return indexHtml.slice(start, end);
}

test("projectAfterScopeChange: nama tetap bila ada di scope baru (NOCASE), selain itu kosong", () => {
  const { projectAfterScopeChange } = loadHelpers();
  assert.equal(projectAfterScopeChange("Taskflow", ["alpha", "taskflow"]), "Taskflow");
  assert.equal(projectAfterScopeChange("taskflow", ["TASKFLOW"]), "taskflow");
  assert.equal(projectAfterScopeChange("Rumah", ["alpha", "taskflow"]), "");
  assert.equal(projectAfterScopeChange("", ["alpha"]), "");
  assert.equal(projectAfterScopeChange(null, ["alpha"]), "");
  assert.equal(projectAfterScopeChange("alpha", []), "");
  assert.equal(projectAfterScopeChange("alpha", null), "");
  // NOCASE hanya ASCII (sama dengan SQLite): É ≠ é
  assert.equal(projectAfterScopeChange("Été", ["été"]), "");
});

test("projectScopeLabel / projectScopeOptionLabel: teks UI persis", () => {
  const { projectScopeLabel, projectScopeOptionLabel } = loadHelpers();
  const lists = [{ id: 7, name: "Tim Inti", role: "member" }, { id: 9, name: "Rumah", role: "owner" }];
  assert.equal(projectScopeLabel(null, lists), "Project · Pribadi");
  assert.equal(projectScopeLabel("", lists), "Project · Pribadi");
  assert.equal(projectScopeLabel(7, lists), "Project · Tim Inti");
  assert.equal(projectScopeLabel("9", lists), "Project · Rumah");
  assert.equal(projectScopeOptionLabel(null), "Pribadi");
  assert.equal(projectScopeOptionLabel({ id: 7, name: "Tim Inti" }), "👥 Tim Inti");
});

test("helper scope diekspor ke window", () => {
  assert.match(indexHtml, /window\.projectAfterScopeChange = projectAfterScopeChange;/);
  assert.match(indexHtml, /window\.projectScopeLabel = projectScopeLabel;/);
});

test("useScopeProjects memuat route per scope dan muat ulang saat tf:projects-changed", () => {
  const fetchCode = sliceFn("function fetchScopeProjects(", "\nfunction ");
  assert.match(fetchCode, /listId \? "\/api\/projects\?list_id=" \+ (encodeURIComponent\()?listId\)? : "\/api\/projects"/);
  const hook = sliceFn("function useScopeProjects(", "\nfunction ");
  assert.match(hook, /fetchScopeProjects\(listId\)/);
  assert.match(hook, /window\.addEventListener\("tf:projects-changed", load\)/);
  assert.match(hook, /window\.removeEventListener\("tf:projects-changed", load\)/);
  assert.match(hook, /\}, \[listId\]\);/);
});

test("TaskFormModal: pilihan scope di baris atribut cepat, tepat sebelum Project", () => {
  const form = sliceFn("function TaskFormModal({", "\nfunction ModalAttachments(");
  assert.doesNotMatch(form, /Shared List \(opsional\)/, "pilihan Shared List lama harus pindah dari Opsi Tambahan");
  assert.match(form, /const scopeProjects = useScopeProjects\(form\.list_id\);/);
  const quickStart = form.indexOf('className: "task-quick-attributes');
  const toggle = form.indexOf('className: "task-advanced-toggle"', quickStart);
  assert.ok(quickStart > 0 && toggle > quickStart);
  const quick = form.slice(quickStart, toggle);
  const scopeAt = quick.indexOf('"aria-label": "Scope task"');
  const projectAt = quick.indexOf("projectScopeLabel(form.list_id, sharedLists)");
  assert.ok(scopeAt > 0, "pilihan scope harus ada di baris atribut cepat");
  assert.ok(projectAt > scopeAt, "pilihan scope tepat sebelum field Project");
  assert.match(quick, /!isEdit && hasScopeChoice &&/);
  assert.match(quick, /projectScopeOptionLabel\(null\)/);
  assert.match(quick, /projectScopeOptionLabel\(l\)/);
  assert.match(quick, /onChange: e => changeScope\(/);
  assert.match(quick, /options: scopeProjects/);
  assert.match(form, /projectAfterScopeChange\(f\.project, names\)/);
});

test("TaskFormModal: \"Assign ke\" di baris atribut cepat setelah Project saat list_id terisi, tidak di Opsi Tambahan", () => {
  const form = sliceFn("function TaskFormModal({", "\nfunction ModalAttachments(");
  const quickStart = form.indexOf('className: "task-quick-attributes');
  const toggle = form.indexOf('className: "task-advanced-toggle"', quickStart);
  const quick = form.slice(quickStart, toggle);
  const projectAt = quick.indexOf("projectScopeLabel(form.list_id, sharedLists)");
  const assignAt = quick.indexOf('"Assign ke"');
  assert.ok(assignAt > projectAt && projectAt > 0, "Assign ke tepat setelah field Project di baris cepat");
  assert.match(quick, /form\.list_id && \/\*#__PURE__\*\/React\.createElement\("div", \{\s*className: "task-assign-field"/);
  assert.match(quick, /"aria-label": "Assign ke"/);
  assert.match(quick, /listMembers\.map\(/);
  const advanced = form.slice(toggle, form.indexOf("ModalAttachments", toggle) > 0 ? form.indexOf("ModalAttachments", toggle) : undefined);
  assert.equal((form.match(/"Assign ke"\)/g) || []).length, 1, "hanya satu label Assign ke di form");
  assert.equal(advanced.indexOf('"Assign ke")'), -1, "duplikat di Opsi Tambahan dihapus");
  // anggota workspace tetap dimuat saat list_id berubah
  assert.match(form, /api\.get\(`\/api\/lists\/\$\{form\.list_id\}\/members`\)\.then\(setListMembers\)/);
});

test("TaskDetailModal: label dan opsi project mengikuti scope task", () => {
  const detail = sliceFn("function TaskDetailModal({", "\nfunction ");
  assert.match(detail, /useScopeProjects\(task\.list_id\)/);
  assert.match(detail, /projectScopeLabel\(task\.list_id, scopeLists\)/);
  assert.match(detail, /options: scopeProjects/);
});

test("GtdWizardEditFields: opsi project dari scope task", () => {
  const wiz = sliceFn("function GtdWizardEditFields({", "\nfunction ");
  assert.match(wiz, /useScopeProjects\(task\.list_id\)/);
  assert.match(wiz, /projectScopeLabel\(task\.list_id, scopeLists\)/);
});

test("CSS: baris atribut cepat dengan scope memakai 2 kolom, 1 kolom di mobile", () => {
  assert.match(appCss, /\.task-quick-attributes\.has-scope\s*\{[^}]*grid-template-columns:\s*1fr 1fr/);
  assert.match(appCss, /@media \(max-width: 640px\)\s*\{\s*\.task-quick-attributes,\s*\.task-quick-attributes\.has-scope\s*\{[^}]*grid-template-columns:\s*1fr;/);
});
