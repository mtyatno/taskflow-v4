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
  return new Function(`${code}; return { projectNameFold, projectGroupKey, projectWorkspaceBadge, isPersonalProjectTask, sidebarProjectCounts, groupTasksByProject, mergeProjectNames, projectDropTarget, sameStringList };`)();
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

test("sidebarProjectCounts satu lintasan: hasil sama dengan hitung per project (NOCASE, hanya pribadi aktif)", () => {
  const { sidebarProjectCounts, isPersonalProjectTask } = loadViewHelpers();
  const many = [];
  for (let i = 0; i < 500; i++) many.push({ id: i, project: ["Alpha", "ALPHA", "beta", "Été", "été", ""][i % 6], list_id: i % 7 === 0 ? 3 : null, gtd_status: ["next", "done", "inbox", "archived"][i % 4] });
  const projects = ["alpha", "Beta", "été", "Été", "none"];
  const naive = {};
  projects.forEach(p => { naive[p] = many.filter(t => isPersonalProjectTask(t, p) && t.gtd_status !== "done" && t.gtd_status !== "archived").length; });
  assert.deepEqual(sidebarProjectCounts(projects, many), naive);
  const code = sliceFn("function sidebarProjectCounts(", "\nfunction ");
  assert.doesNotMatch(code, /isPersonalProjectTask/, "tidak boleh P×N pemanggilan per project");
  assert.match(code, /new Map\(/);
});

test("Sidebar memoize hitungan project pada [projects, tasks]", () => {
  const sidebar = sliceFn("const projCounts", "// Count today's focus tasks");
  assert.match(sidebar, /React\.useMemo\(\(\) => sidebarProjectCounts\(projects, tasks\), \[projects, tasks\]\)/);
});

test("projectDropTarget: no-op bila nama sama NOCASE atau beda scope; selain itu nama grup", () => {
  const { projectDropTarget } = loadViewHelpers();
  assert.equal(projectDropTarget({ project: "TaskFlow", list_id: null }, { value: "taskflow", listId: null }), null);
  assert.equal(projectDropTarget({ project: "Alpha", list_id: null }, { value: "taskflow", listId: 7 }), null);
  assert.equal(projectDropTarget({ project: "Alpha", list_id: 7 }, { value: "taskflow", listId: 7 }), "taskflow");
  assert.equal(projectDropTarget({ project: "", list_id: null }, { value: "Beta", listId: null }), "Beta");
  assert.equal(projectDropTarget({ project: "x" }, null), null);
  const view = sliceFn("function TaskListView(", "\nfunction ");
  assert.match(view, /projectDropTarget\(task, projGroupMetaRef\.current\[targetGroupKey\]\)/);
});

test("App: reload projects tidak mengganti state bila daftar sama", () => {
  const { sameStringList } = loadViewHelpers();
  assert.equal(sameStringList(["a", "b"], ["a", "b"]), true);
  assert.equal(sameStringList(["a", "b"], ["a", "B"]), false);
  assert.equal(sameStringList(["a"], ["a", "b"]), false);
  assert.equal(sameStringList(null, []), false);
  const reload = sliceFn("const reloadProjects = ", "};");
  assert.match(reload, /setProjects\(prev => sameStringList\(prev, r\) \? prev : r\)/);
});

test("kanban drop (onMoveTask) lewat onUpdateTask App agar array tasks berganti identitas (hitungan sidebar segar)", () => {
  const start = indexHtml.indexOf("const onMoveTask = async (taskId, targetGroupKey, fromKey) => {");
  assert.ok(start > 0);
  const body = indexHtml.slice(start, indexHtml.indexOf("const buildGroups = tasks =>", start));
  // Kanban tahap (Task 5): aksi drop diputuskan dropAction dan dijalankan runKanbanAction, yang memanggil
  // deps.onUpdateTask = onUpdateTask App bila tersedia; tidak ada mutasi task di tempat.
  assert.match(body, /kanbanMoveAction\(/);
  assert.match(body, /await runKanbanAction\(action, task, kanbanDeps\);/);
  const view = sliceFn("function TaskListView(", "\nfunction ");
  const deps = view.slice(view.indexOf("const kanbanDeps = {"), view.indexOf("const onMoveTask = async"));
  assert.match(deps, /onUpdateTask: onUpdateTask \|\|/, "onMoveTask harus memakai onUpdateTask bila tersedia");
  // onMoveTask dan onKanbanCheck tidak memutasi field task di tempat
  const check = body.slice(body.indexOf("const onKanbanCheck = "));
  assert.ok(check.length > 0 && body.indexOf("const onKanbanCheck = ") > 0, "onKanbanCheck ada setelah onMoveTask");
  for (const b of [body.slice(0, body.indexOf("const onKanbanCheck = ")), check]) {
    assert.doesNotMatch(b, /\btask\.\w+\s*=[^=]/, "tidak ada assignment ke task.<field>");
    assert.doesNotMatch(b, /\btask\[[^\]]+\]\s*=[^=]/, "tidak ada assignment ke task[<field>]");
  }
  // App: handleUpdateTaskFields mengganti array (setTasks map) dan memanggil fetchAll
  const h = indexHtml.slice(indexHtml.indexOf("const handleUpdateTaskFields = async (taskId, patch) => {"));
  assert.match(h.slice(0, 1200), /setTasks\(prev => prev\.map\(/);
  assert.match(h.slice(0, 1200), /fetchAll\(\);/);
});
