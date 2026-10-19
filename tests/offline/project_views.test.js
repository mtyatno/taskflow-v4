"use strict";

// Tampilan project (PR 5 Task 4): sidebar, filter proj_, pengelompokan, badge workspace.
// Project pribadi "taskflow" dan project "taskflow" di workspace W tidak boleh tercampur.
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

function loadViewHelpers() {
  const code = sliceFn("function projectNameFold(", "function fetchScopeProjects(");
  return new Function(`${code}; return { projectNameFold, projectGroupKey, projectWorkspaceBadge, isPersonalProjectTask, sidebarProjectCounts, groupTasksByProject, mergeProjectNames };`)();
}

const LISTS = [{ id: 7, name: "Tim Inti", role: "member" }, { id: 9, name: "Rumah", role: "owner" }];
const TASKS = [
  { id: 1, project: "taskflow", list_id: null, gtd_status: "next" },
  { id: 2, project: "TaskFlow", list_id: null, gtd_status: "inbox" },
  { id: 3, project: "taskflow", list_id: 7, gtd_status: "next" },
  { id: 4, project: "taskflow", list_id: 7, gtd_status: "done" },
  { id: 5, project: "Alpha", list_id: null, gtd_status: "done" },
  { id: 6, project: "", list_id: null, gtd_status: "next" },
  { id: 7, project: "Rumah", list_id: 9, gtd_status: "waiting" },
  { id: 8, project: "taskflow", list_id: null, gtd_status: "archived" },
];

test("projectGroupKey: (list_id ?? 'p') + ':' + nama NOCASE ASCII", () => {
  const { projectGroupKey, projectNameFold } = loadViewHelpers();
  assert.equal(projectGroupKey({ project: "TaskFlow", list_id: null }), "p:taskflow");
  assert.equal(projectGroupKey({ project: "TaskFlow" }), "p:taskflow");
  assert.equal(projectGroupKey({ project: "TaskFlow", list_id: 7 }), "7:taskflow");
  assert.notEqual(projectGroupKey({ project: "x", list_id: null }), projectGroupKey({ project: "x", list_id: 7 }));
  assert.equal(projectGroupKey({ project: "", list_id: 7 }), null);
  assert.equal(projectGroupKey({ project: null }), null);
  // NOCASE hanya ASCII: É tidak dilipat
  assert.equal(projectNameFold("ÉTÉ"), "ÉtÉ");
  assert.equal(projectNameFold("ABC"), "abc");
});

test("projectWorkspaceBadge: teks persis '👥 {nama workspace}', pribadi tanpa badge", () => {
  const { projectWorkspaceBadge } = loadViewHelpers();
  assert.equal(projectWorkspaceBadge(null, LISTS), null);
  assert.equal(projectWorkspaceBadge(undefined, LISTS), null);
  assert.equal(projectWorkspaceBadge(7, LISTS), "👥 Tim Inti");
  assert.equal(projectWorkspaceBadge("9", LISTS), "👥 Rumah");
});

test("sidebarProjectCounts: hanya task pribadi aktif dengan nama itu (NOCASE)", () => {
  const { sidebarProjectCounts } = loadViewHelpers();
  const counts = sidebarProjectCounts(["taskflow", "Alpha", "Kosong"], TASKS);
  assert.deepEqual(counts, { taskflow: 2, Alpha: 0, Kosong: 0 });
  assert.deepEqual(sidebarProjectCounts(null, TASKS), {});
  assert.deepEqual(sidebarProjectCounts(["x"], null), { x: 0 });
});

test("isPersonalProjectTask: filter proj_ tidak memasukkan task workspace", () => {
  const { isPersonalProjectTask } = loadViewHelpers();
  const ids = TASKS.filter(t => isPersonalProjectTask(t, "taskflow")).map(t => t.id);
  assert.deepEqual(ids, [1, 2, 8]);
  assert.equal(isPersonalProjectTask({ project: "", list_id: null }, ""), false);
});

test("groupTasksByProject: pribadi & workspace dengan nama sama jadi dua grup, workspace diberi badge", () => {
  const { groupTasksByProject } = loadViewHelpers();
  const groups = groupTasksByProject(TASKS, LISTS);
  assert.deepEqual(groups.map(g => [g.key, g.name, g.badge, g.tasks.map(t => t.id)]), [
    ["p:alpha", "Alpha", null, [5]],
    ["9:rumah", "Rumah", "👥 Rumah", [7]],
    ["p:taskflow", "taskflow", null, [1, 2, 8]],
    ["7:taskflow", "taskflow", "👥 Tim Inti", [3, 4]],
  ]);
  assert.equal(groups[3].listId, 7);
  assert.equal(groups[2].listId, null);
  // task tanpa project tidak masuk grup project
  assert.ok(!groups.some(g => g.tasks.some(t => t.id === 6)));
});

test("mergeProjectNames: gabung tanpa duplikat NOCASE, urut NOCASE", () => {
  const { mergeProjectNames } = loadViewHelpers();
  assert.deepEqual(mergeProjectNames(["taskflow", "beta"], ["TaskFlow", "Alpha", "", null]), ["Alpha", "beta", "taskflow"]);
  assert.deepEqual(mergeProjectNames(null, undefined), []);
});

test("Sidebar memakai sidebarProjectCounts (bukan perbandingan t.project === p)", () => {
  const sidebar = sliceFn("const projCounts", "// Count today's focus tasks");
  assert.match(sidebar, /sidebarProjectCounts\(projects, tasks\)/);
  assert.doesNotMatch(sidebar, /t\.project === p/);
});

test("filter nav proj_ hanya task pribadi", () => {
  const block = sliceFn('if (page.startsWith("proj_")) {', 'if (page.startsWith("slist_")) {');
  assert.match(block, /isPersonalProjectTask\(t, projName\)/);
  assert.doesNotMatch(block, /t\.project === projName/);
});

test("TaskListView mengelompokkan project per scope dan menampilkan badge", () => {
  const view = sliceFn("function TaskListView(", "\nfunction ");
  assert.match(view, /sharedLists = \[\]/);
  assert.match(view, /groupTasksByProject\(/);
  assert.doesNotMatch(view, /groupBy === "project"\) key = t\.project/);
  const header = sliceFn("function GroupHeader(", "\nfunction ");
  assert.match(header, /badge/);
  const col = sliceFn("function KanbanColumn(", "\nfunction ");
  assert.match(col, /badge/);
  // App meneruskan sharedLists ke TaskListView (dua tempat)
  const appUses = indexHtml.split("React.createElement(TaskListView, {").slice(1).map(s => s.slice(0, 900));
  assert.ok(appUses.length >= 2);
  for (const u of appUses) assert.match(u, /sharedLists: sharedLists/);
});

test("Dashboard: kartu project per (scope, nama) dengan badge workspace", () => {
  const dash = sliceFn("function Dashboard(", "\nfunction ");
  assert.match(dash, /sharedLists = \[\]/);
  assert.match(dash, /groupTasksByProject\(/);
  assert.doesNotMatch(dash, /tasks\.filter\(t => t\.project === proj /);
  const call = indexHtml.slice(indexHtml.indexOf("React.createElement(Dashboard, {"), indexHtml.indexOf("React.createElement(Dashboard, {") + 900);
  assert.match(call, /sharedLists: sharedLists/);
});

test("sync pull sukses memancarkan tf:projects-changed; App memuat ulang projects", () => {
  const syncFn = sliceFn("function sync() {", "\nfunction ");
  assert.match(syncFn, /pullAndReconcile\(__syncRawFetch\)\.then\(\(?\w*\)? => \{[^}]*tf:projects-changed/);
  const app = indexHtml.slice(indexHtml.indexOf("const [projects, setProjects] = useState([]);"));
  assert.match(app, /window\.addEventListener\("tf:projects-changed", \w+\)/);
  assert.match(app, /window\.removeEventListener\("tf:projects-changed", \w+\)/);
  const reload = sliceFn("const reloadProjects = ", "};");
  assert.match(reload, /api\.get\("\/api\/projects"\)/);
  assert.match(reload, /setProjects\(/);
  assert.match(reload, /OfflineDB\.cacheSet\("projects"/);
});
