"use strict";

// Field Context per scope (Pribadi / workspace) di form dan detail task.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const indexHtml = fs.readFileSync(path.join(ROOT, "static/index.html"), "utf8").replace(/\r\n/g, "\n");

function sliceFn(startMarker, endMarker) {
  const start = indexHtml.indexOf(startMarker);
  assert.ok(start > 0, `${startMarker} harus ada`);
  const end = indexHtml.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `${endMarker} harus ada setelah ${startMarker}`);
  return indexHtml.slice(start, end);
}

function loadLabel() {
  const code = sliceFn("function contextScopeLabel(", "\nfunction ");
  return new Function(`${code}; return contextScopeLabel;`)();
}

test("contextScopeLabel: pribadi, workspace, workspace tak dikenal", () => {
  const contextScopeLabel = loadLabel();
  const lists = [{ id: 7, name: "Tim Inti" }, { id: 9, name: "Rumah" }];
  assert.equal(contextScopeLabel(null, lists), "Tahap/Context · Pribadi");
  assert.equal(contextScopeLabel("", lists), "Tahap/Context · Pribadi");
  assert.equal(contextScopeLabel(7, lists), "Tahap/Context · Tim Inti");
  assert.equal(contextScopeLabel("9", lists), "Tahap/Context · Rumah");
  // workspace yang belum dimuat / tidak dikenal → "Workspace" (bukan "Pribadi"), sama dengan projectScopeLabel
  assert.equal(contextScopeLabel(55, lists), "Tahap/Context · Workspace");
  assert.equal(contextScopeLabel(55, null), "Tahap/Context · Workspace");
  assert.equal(contextScopeLabel("55", []), "Tahap/Context · Workspace");
  assert.equal(contextScopeLabel(undefined, lists), "Tahap/Context · Pribadi");
  assert.equal(contextScopeLabel(7, [{ id: 7, name: "" }]), "Tahap/Context · Workspace");
});

test("fetchScopeContexts + useScopeContexts: route per scope, muat ulang saat tf:contexts-changed", () => {
  const fetchCode = sliceFn("function fetchScopeContexts(", "\nfunction ");
  assert.match(fetchCode, /listId \? "\/api\/contexts\?list_id=" \+ encodeURIComponent\(listId\) : "\/api\/contexts"/);
  const hook = sliceFn("function useScopeContexts(", "\nfunction ");
  assert.match(hook, /fetchScopeContexts\(listId\)/);
  assert.match(hook, /let alive = true;/);
  assert.match(hook, /if \(alive\) setNames\(r\)/);
  assert.match(hook, /window\.addEventListener\("tf:contexts-changed", load\)/);
  assert.match(hook, /window\.removeEventListener\("tf:contexts-changed", load\)/);
  assert.match(hook, /\}, \[listId\]\);/);
});

test("TaskFormModal: context per scope + changeScope mengosongkan context di luar scope baru", () => {
  const form = sliceFn("function TaskFormModal({", "\nfunction ModalAttachments(");
  assert.match(form, /const scopeContexts = useScopeContexts\(form\.list_id\);/);
  assert.match(form, /projectAfterScopeChange\(f\.context, ctxNames\)/);
  assert.match(form, /contextScopeLabel\(form\.list_id, sharedLists\)/);
  assert.match(form, /options: scopeContexts/);
  assert.doesNotMatch(form, /options: contexts/);
});

test("TaskDetailModal: context mengikuti scope task", () => {
  const detail = sliceFn("function TaskDetailBody({", "\nfunction ");
  assert.match(detail, /useScopeContexts\(task\.list_id\)/);
  assert.match(detail, /contextScopeLabel\(task\.list_id, scopeLists\)/);
  assert.match(detail, /options: scopeContexts/);
  assert.doesNotMatch(detail, /options: contexts/);
});
