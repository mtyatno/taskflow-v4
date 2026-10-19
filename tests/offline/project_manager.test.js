"use strict";

// Task 5: modal "Kelola project" (online). Helper murni diekstrak dari index.html.
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

function loadHelpers() {
  const fold = sliceFn("function projectNameFold(", "\nfunction projectScopeOf(");
  const helpers = sliceFn("const PROJECT_MANAGER_OFFLINE_TEXT", "\nfunction ProjectManagerModal(");
  return new Function(`${fold}\n${helpers}; return { PROJECT_MANAGER_OFFLINE_TEXT, projectManagerUrl, projectManagerRows, projectManagerActions, projectDeleteConfirmText, projectColorValid };`)();
}

test("teks offline persis", () => {
  const { PROJECT_MANAGER_OFFLINE_TEXT } = loadHelpers();
  assert.equal(PROJECT_MANAGER_OFFLINE_TEXT, "Kelola project butuh koneksi internet");
});

test("projectManagerUrl: full + arsip, list_id bila workspace", () => {
  const { projectManagerUrl } = loadHelpers();
  assert.equal(projectManagerUrl(null), "/api/projects?format=full&include_archived=1");
  assert.equal(projectManagerUrl(""), "/api/projects?format=full&include_archived=1");
  assert.equal(projectManagerUrl(7), "/api/projects?format=full&include_archived=1&list_id=7");
  assert.equal(projectManagerUrl("a b"), "/api/projects?format=full&include_archived=1&list_id=a%20b");
});

test("projectManagerRows: hanya scope itu, aktif dulu lalu arsip, urut NOCASE", () => {
  const { projectManagerRows } = loadHelpers();
  const items = [
    { id: 1, name: "beta", list_id: null, archived: false },
    { id: 2, name: "Alpha", list_id: null, archived: true },
    { id: 3, name: "alpha2", list_id: 7, archived: false },
    { id: 4, name: "Zeta", list_id: null, archived: false },
    { id: 5, name: "aku", list_id: null, archived: false },
  ];
  assert.deepEqual(projectManagerRows(items, null).map(p => p.id), [5, 1, 4, 2]);
  assert.deepEqual(projectManagerRows(items, 7).map(p => p.id), [3]);
  assert.deepEqual(projectManagerRows(items, "7").map(p => p.id), [3]);
  assert.deepEqual(projectManagerRows(null, null), []);
  assert.deepEqual(projectManagerRows({ detail: "x" }, null), []);
});

test("projectManagerActions: aksi hanya bila can_manage", () => {
  const { projectManagerActions } = loadHelpers();
  assert.deepEqual(projectManagerActions({ can_manage: false, archived: false }), []);
  assert.deepEqual(projectManagerActions({ archived: false }), []);
  assert.deepEqual(projectManagerActions(null), []);
  assert.deepEqual(projectManagerActions({ can_manage: true, archived: false }), ["rename", "archive", "delete"]);
  assert.deepEqual(projectManagerActions({ can_manage: true, archived: true }), ["rename", "unarchive", "delete"]);
});

test("projectDeleteConfirmText: teks konfirmasi persis", () => {
  const { projectDeleteConfirmText } = loadHelpers();
  assert.equal(projectDeleteConfirmText({ name: "taskflow", active_task_count: 3 }),
    "Hapus project «taskflow»? 3 task akan kehilangan project-nya.");
  assert.equal(projectDeleteConfirmText({ name: "Rumah" }),
    "Hapus project «Rumah»? 0 task akan kehilangan project-nya.");
});

test("projectColorValid: #rrggbb saja", () => {
  const { projectColorValid } = loadHelpers();
  assert.equal(projectColorValid("#a1B2c3"), true);
  assert.equal(projectColorValid("#abc"), false);
  assert.equal(projectColorValid("a1b2c3"), false);
  assert.equal(projectColorValid(null), false);
});

test("api.fetch: opsi network:true melewati router lokal; default tidak berubah", () => {
  const apiCode = sliceFn("const api = {", "\n};");
  assert.match(apiCode, /if \(_R && !opts\.network\)/);
  // opsi network tidak ikut diteruskan ke fetch()
  assert.match(apiCode, /const \{ __authRetried, network: _network, \.\.\.fetchOpts \} = opts;/);
  assert.match(apiCode, /get: \(url, opts\) => api\.fetch\(url, opts\)/);
});

test("ProjectManagerModal: muat langsung ke jaringan, offline → pesan, sesudah aksi refresh cache + event", () => {
  const modal = sliceFn("function ProjectManagerModal(", "\nfunction ");
  assert.match(modal, /api\.get\(projectManagerUrl\(listId\), \{ network: true \}\)/);
  assert.match(modal, /navigator\.onLine/);
  assert.match(modal, /PROJECT_MANAGER_OFFLINE_TEXT/);
  assert.match(modal, /api\.patch\("\/api\/projects\/" \+ /);
  assert.match(modal, /api\.del\("\/api\/projects\/" \+ /);
  assert.match(modal, /projectDeleteConfirmText\(/);
  assert.match(modal, /projectManagerActions\(/);
  assert.match(modal, /"Kelola project"/);
  const after = sliceFn("function projectManagerAfterChange(", "\nfunction ");
  assert.match(after, /window\.TF\.projectcache[\s\S]*\.refresh\(window\.__syncRawFetch\)/);
  assert.match(after, /new CustomEvent\("tf:projects-changed"/);
  assert.ok(after.indexOf("refresh(") < after.indexOf("tf:projects-changed"), "refresh dulu baru event");
  assert.match(after, /__syncNow|__refreshTasks/);
});

test("Tombol Kelola project di sidebar PROJECTS dan halaman workspace", () => {
  const sidebar = sliceFn("function Sidebar(", "\nfunction ");
  assert.match(sidebar, /onManageProjects/);
  assert.match(sidebar, /"Kelola project"/);
  const ws = sliceFn('if (page.startsWith("slist_")) {\n      const listId = parseInt(page.slice(6));\n      const currentList', "TaskListView");
  assert.match(ws, /setProjectManager\(\{ listId: listId/);
  assert.match(ws, /"Kelola project"/);
  assert.match(indexHtml, /React\.createElement\(ProjectManagerModal, \{/);
});
