"use strict";
// Kanban tahap kustom (frontend) Task 5 — papan di TaskListView: helper top-level (di-slice dari index.html)
// dan pemeriksaan sumber (kolom, scope, Selesai, aksi drop, kartu).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const KB = require("../../static/offline/kanbanboard.js");

const ROOT = path.resolve(__dirname, "../..");
const indexHtml = fs.readFileSync(path.join(ROOT, "static/index.html"), "utf8").replace(/\r\n/g, "\n");

function sliceFn(startMarker, endMarker) {
  const start = indexHtml.indexOf(startMarker);
  assert.ok(start > 0, `${startMarker} harus ada`);
  const end = indexHtml.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `${endMarker} harus ada setelah ${startMarker}`);
  return indexHtml.slice(start, end);
}

function loadHelpers(windowStub) {
  const proj = sliceFn("function projectNameFold(", "function fetchScopeProjects(");
  const code = sliceFn("function kanbanScopeKey(", "function KanbanCard(");
  const win = windowStub || { TF: { kanbanboard: KB } };
  return new Function("window", "localStorage",
    `${proj}\n${code}; return { kanbanScopeKey, readKanbanScope, kanbanDonePool, taskInitials, runKanbanAction, kanbanScopeFor, kanbanBoardFor, kanbanMoveAction, kanbanCheckAction };`)(
    win, { getItem: () => { throw new Error("blocked"); } });
}

// 2026-10-20 Jakarta; window 7 hari = 2026-10-14..2026-10-20
const TODAY = "2026-10-20";
const D = (over) => Object.assign({ id: 1, title: "t", gtd_status: "done", completed_at: "2026-10-19T03:00:00Z", list_id: null, project: "" }, over);

test("kanbanScopeKey + readKanbanScope (localStorage diblokir → \"\")", () => {
  const H = loadHelpers();
  assert.equal(H.kanbanScopeKey("next"), "tf_kanban_scope:next");
  assert.equal(H.kanbanScopeKey("proj_Alpha"), "tf_kanban_scope:proj_Alpha");
  assert.equal(H.readKanbanScope("next"), "");
});

test("kanbanDonePool applies page predicate (slist, proj_, next) and 7-day Jakarta window", () => {
  const H = loadHelpers();
  const all = [
    D({ id: 1, list_id: 7 }),
    D({ id: "c-2", list_id: "7" }),
    D({ id: 3, list_id: 9 }),
    D({ id: 4, project: "ALPHA" }),
    D({ id: 5, project: "alpha", list_id: 7 }), // project workspace: bukan halaman proj_ pribadi
    D({ id: 6, completed_at: "2026-10-13T16:59:59Z" }), // = 2026-10-13 23:59 WIB → di luar jendela
    D({ id: 7, completed_at: "2026-10-13T17:00:00Z" }), // = 2026-10-14 00:00 WIB → masuk
    D({ id: 8, gtd_status: "next", completed_at: "2026-10-19T00:00:00Z" }),
    D({ id: 9, completed_at: "2026-10-20 10:00:00" }), // naive = UTC
    D({ id: 10, completed_at: null }),
  ];
  const ids = (xs) => xs.map((t) => t.id);
  assert.deepEqual(ids(H.kanbanDonePool(all, "slist_7", TODAY)), [1, "c-2", 5]);
  assert.deepEqual(ids(H.kanbanDonePool(all, "proj_alpha", TODAY)), [4]);
  assert.deepEqual(ids(H.kanbanDonePool(all, "next", TODAY)), [1, "c-2", 3, 4, 5, 7, 9]);
  assert.deepEqual(H.kanbanDonePool(null, "next", TODAY), []);
});

test("taskInitials: nama dua kata, username saja, tak dikenal \"?\", tanpa assignee null", () => {
  const H = loadHelpers();
  const me = { id: 1, username: "budi", display_name: "budi santoso wijaya" };
  const collab = [{ id: 2, username: "rina", display_name: "" }, { id: "3", username: "x", display_name: "Andi" }];
  assert.equal(H.taskInitials({ assigned_to: 1 }, me, collab), "BS");
  assert.equal(H.taskInitials({ assigned_to: "1" }, me, collab), "BS");
  assert.equal(H.taskInitials({ assigned_to: 2 }, me, collab), "R");
  assert.equal(H.taskInitials({ assigned_to: 3 }, me, collab), "A");
  assert.equal(H.taskInitials({ assigned_to: 99 }, me, collab), "?");
  assert.equal(H.taskInitials({ assigned_to: 99 }, null, null), "?");
  assert.equal(H.taskInitials({ assigned_to: null }, me, collab), null);
  assert.equal(H.taskInitials({}, me, collab), null);
});

function deps(over) {
  const calls = [];
  const d = Object.assign({
    onDone: (id) => { calls.push(["done", id]); },
    onUpdateTask: (id, patch) => { calls.push(["update", id, patch]); return Promise.resolve(); },
    api: { post: (url, body) => { calls.push(["post", url, body]); return Promise.resolve({ ok: true }); } },
    showToast: (msg, kind) => { calls.push(["toast", msg, kind]); },
    onAfterOccurrence: () => { calls.push(["after"]); },
    projectTargetFor: (key, task) => { calls.push(["target", key, task.id]); return key === "p:alpha" ? "Alpha" : null; },
  }, over);
  return { d, calls };
}

test("runKanbanAction dispatches each action type", async () => {
  const H = loadHelpers();
  const task = { id: "c-9", title: "x" };
  let r;

  r = deps(); await H.runKanbanAction({ type: "done" }, task, r.d);
  assert.deepEqual(r.calls, [["done", "c-9"]]);

  r = deps(); await H.runKanbanAction({ type: "occurrence", date: TODAY }, { id: 12 }, r.d);
  assert.deepEqual(r.calls, [["post", "/api/tasks/12/occurrences/2026-10-20/mark", { status: "done" }], ["after"]]);

  r = deps({ api: { post: () => Promise.reject(Object.assign(new Error("HTTP 500"), {})) } });
  await H.runKanbanAction({ type: "occurrence", date: TODAY }, { id: 12 }, r.d);
  assert.deepEqual(r.calls, [["toast", "Gagal: HTTP 500", "error"]]);

  r = deps({ api: { post: () => Promise.reject(Object.assign(new Error("x"), { body: { detail: { code: "c", message: "Bukan hari ini" } } })) } });
  await H.runKanbanAction({ type: "occurrence", date: TODAY }, { id: 12 }, r.d);
  assert.deepEqual(r.calls, [["toast", "Gagal: Bukan hari ini", "error"]]);

  r = deps(); await H.runKanbanAction({ type: "reopen", patch: { gtd_status: "next", context_id: 5, context: "A" } }, task, r.d);
  assert.deepEqual(r.calls, [["update", "c-9", { gtd_status: "next", context_id: 5, context: "A" }]]);

  r = deps(); await H.runKanbanAction({ type: "patch", patch: { priority: "P1" } }, task, r.d);
  assert.deepEqual(r.calls, [["update", "c-9", { priority: "P1" }]]);

  r = deps(); await H.runKanbanAction({ type: "blocked", message: "Tidak bisa dilakukan saat offline" }, task, r.d);
  assert.deepEqual(r.calls, [["toast", "Tidak bisa dilakukan saat offline", "error"]]);

  r = deps(); await H.runKanbanAction({ type: "none" }, task, r.d);
  assert.deepEqual(r.calls, []);
  r = deps(); await H.runKanbanAction(null, task, r.d);
  assert.deepEqual(r.calls, []);
});

test("runKanbanAction project: projectTargetFor → {project}; reopen menambah gtd_status next; null → no-op", async () => {
  const H = loadHelpers();
  const task = { id: 4, project: "" };
  let r;
  r = deps(); await H.runKanbanAction({ type: "project", columnKey: "p:alpha", reopen: false }, task, r.d);
  assert.deepEqual(r.calls, [["target", "p:alpha", 4], ["update", 4, { project: "Alpha" }]]);
  r = deps(); await H.runKanbanAction({ type: "project", columnKey: "p:alpha", reopen: true }, task, r.d);
  assert.deepEqual(r.calls, [["target", "p:alpha", 4], ["update", 4, { project: "Alpha", gtd_status: "next" }]]);
  r = deps(); await H.runKanbanAction({ type: "project", columnKey: "7:beta", reopen: false }, task, r.d);
  assert.deepEqual(r.calls, [["target", "7:beta", 4]]);
  r = deps(); await H.runKanbanAction({ type: "project", columnKey: "7:beta", reopen: true }, task, r.d);
  assert.deepEqual(r.calls, [["target", "7:beta", 4], ["update", 4, { gtd_status: "next" }]]);
});

test("sumber: TaskListView memakai buildContextBoard + dropAction + runKanbanAction; scope picker; R4", () => {
  const view = sliceFn("function TaskListView(", "\nfunction ");
  const helpers = sliceFn("function kanbanScopeFor(", "function kanbanTint(");
  assert.match(helpers, /TF\.kanbanboard\.buildContextBoard\(/);
  assert.match(helpers, /TF\.kanbanboard\.buildPriorityBoard\(/);
  assert.match(helpers, /TF\.kanbanboard\.withDoneColumn\(/);
  assert.match(helpers, /TF\.kanbanboard\.dropAction\(/);
  assert.match(view, /kanbanBoardFor\(/);
  assert.match(view, /kanbanMoveAction\(/);
  assert.match(view, /kanbanCheckAction\(/);
  assert.match(view, /kanbanScopeFor\(page, /);
  assert.match(view, /runKanbanAction\(/);
  assert.match(view, /kanbanDonePool\(/);
  assert.match(view, /kanbanScopeKey\(page\)/);
  assert.match(view, /"Papan:"/);
  assert.match(view, /task dari scope lain tidak ditampilkan/);
  assert.match(view, /String\(t\.id\) === /);
  assert.doesNotMatch(view, /filtered\.find\(t => t\.id === taskId\)/);
  // R4: cabang kanban dirender sebelum (tidak dijaga) filtered.length === 0
  const kanbanBranch = view.indexOf("kanbanOn ? ");
  const emptyBranch = view.indexOf("filtered.length === 0 ? ");
  assert.ok(kanbanBranch > 0 && emptyBranch > 0, "kedua cabang ada");
  assert.ok(kanbanBranch < emptyBranch, "cabang kanban harus sebelum kartu 'Tidak ada task'");
});

test("sumber: KanbanColumn/KanbanCard tanpa parseInt id; kartu tanpa tanggal UTC; checkbox terkontrol; menu Pindah ke…", () => {
  const card = sliceFn("function KanbanCard(", "\nfunction ");
  const col = sliceFn("function KanbanColumn(", "\nfunction ");
  assert.doesNotMatch(card, /parseInt\(/);
  assert.doesNotMatch(col, /parseInt\(/);
  assert.doesNotMatch(card, /new Date\(\)\.toISOString\(\)/);
  assert.match(card, /jktDay\(/);
  assert.match(card, /checked: /);
  assert.match(card, /opacity: isDone \? 0\.6 : 1/);
  assert.match(card, /taskInitials\(/);
  assert.match(card, /"Pindah ke…"/);
  assert.match(card, /"⋯"/);
  assert.match(col, /badge/);
  const view = sliceFn("function KanbanView(", "\nfunction ");
  assert.match(view, /TF\.kanbanboard\.moveTargets\(/);
});

test("sumber: kedua call site TaskListView memuat currentUser + contextItems setelah sharedLists", () => {
  const uses = indexHtml.split("React.createElement(TaskListView, {").slice(1).map((s) => s.slice(0, s.indexOf("})")));
  assert.equal(uses.length, 2);
  for (const u of uses) {
    const s = u.indexOf("sharedLists: sharedLists");
    assert.ok(s > 0);
    assert.ok(u.indexOf("currentUser: user") > s, "currentUser setelah sharedLists");
    assert.ok(u.indexOf("contextItems: contextItems") > s, "contextItems setelah sharedLists");
  }
});

test("sumber: App memuat contextItems lokal dan memuat ulang pada tf:contexts-changed", () => {
  const app = indexHtml.slice(indexHtml.indexOf("const [contexts, setContexts] = useState([]);"));
  assert.match(app, /const \[contextItems, setContextItems\] = useState\(\[\]\);/);
  const reload = sliceFn("const reloadContextItems = ", "};");
  assert.match(reload, /api\.get\("\/api\/contexts\?format=full&scope=all&include_archived=1"\)/);
  assert.match(reload, /setContextItems\(/);
  assert.match(app, /window\.addEventListener\("tf:contexts-changed", reloadContextItems\)/);
  assert.match(app, /window\.removeEventListener\("tf:contexts-changed", reloadContextItems\)/);
});

// ---- Fix round 1: task done hanya di "Selesai", kolom asal dari kartu, checkbox, scope ----
const ITEMS = [
  { id: 5, name: "Doing", list_id: null, position: 0, color: null, archived: false },
  { id: 6, name: "Review", list_id: null, position: 1, color: null, archived: false },
];
const PAGE_TASKS = [ // halaman "done": tasks halaman memuat task done
  { id: 1, title: "aktif", gtd_status: "next", context: "Doing", context_id: 5, list_id: null, priority: "P1", project: "Alpha" },
  { id: "c-2", title: "selesai", gtd_status: "done", context: "Doing", context_id: 5, list_id: null, priority: "P2", project: "Alpha",
    completed_at: "2026-10-19T03:00:00Z" },
  { id: 3, title: "selesai ws", gtd_status: "done", context: "", list_id: 9, completed_at: "2026-10-19T03:00:00Z" },
];
const where = (board, id) => board.columns.filter((c) => c.tasks.some((t) => String(t.id) === String(id))).map((c) => c.key);

test("kanbanBoardFor: task done di tasks halaman hanya muncul di Selesai (context/priority/project), tidak dihitung scope lain", () => {
  const H = loadHelpers();
  const donePool = H.kanbanDonePool(PAGE_TASKS, "done", TODAY);
  const lists = [{ id: 9, name: "W" }];
  const ctx = H.kanbanBoardFor({ groupBy: "context", tasks: PAGE_TASKS, donePool, items: ITEMS, scope: "", sharedLists: lists });
  assert.deepEqual(where(ctx, "c-2"), ["done"]);
  assert.deepEqual(where(ctx, 1), ["stage:5"]);
  assert.equal(ctx.hiddenOtherScope, 0, "task done scope lain tidak dihitung");
  const pri = H.kanbanBoardFor({ groupBy: "priority", tasks: PAGE_TASKS, donePool });
  assert.deepEqual(where(pri, "c-2"), ["done"]);
  let seen = null;
  const proj = H.kanbanBoardFor({ groupBy: "project", tasks: PAGE_TASKS, donePool, projectColumns: (active) => {
    seen = active.map((t) => t.id);
    return [{ key: "p:alpha", kind: "project", label: "Alpha", tasks: active.filter((t) => t.project === "Alpha") }];
  } });
  assert.deepEqual(seen, [1]);
  assert.deepEqual(where(proj, "c-2"), ["done"]);
  assert.equal(H.kanbanBoardFor({ groupBy: "quadrant", tasks: PAGE_TASKS, donePool }), null);
});

test("kanbanMoveAction: dari Selesai ke tahap = reopen gtd_status next; Selesai→Selesai none; kolom asal dari kartu", async () => {
  const H = loadHelpers();
  const donePool = H.kanbanDonePool(PAGE_TASKS, "done", TODAY);
  const board = H.kanbanBoardFor({ groupBy: "context", tasks: PAGE_TASKS, donePool, items: ITEMS, scope: "", sharedLists: [] });
  const doneTask = PAGE_TASKS[1];
  const base = { task: doneTask, columns: board.columns, groupBy: "context", online: true, todayIso: TODAY };
  const a = H.kanbanMoveAction(Object.assign({}, base, { fromKey: "done", toKey: "stage:6" }));
  assert.deepEqual(a, { type: "reopen", patch: { gtd_status: "next", context_id: 6, context: "Review" } });
  const r = deps(); await H.runKanbanAction(a, doneTask, r.d);
  assert.deepEqual(r.calls, [["update", "c-2", { gtd_status: "next", context_id: 6, context: "Review" }]]);
  assert.deepEqual(H.kanbanMoveAction(Object.assign({}, base, { fromKey: "done", toKey: "done" })), { type: "none" });
  assert.deepEqual(H.kanbanMoveAction(Object.assign({}, base, { fromKey: "nope", toKey: "stage:6" })), { type: "none" });
  const pri = H.kanbanBoardFor({ groupBy: "priority", tasks: PAGE_TASKS, donePool });
  assert.deepEqual(H.kanbanMoveAction({ task: doneTask, columns: pri.columns, fromKey: "done", toKey: "pri:P1", groupBy: "priority", online: true, todayIso: TODAY }),
    { type: "reopen", patch: { gtd_status: "next", priority: "P1" } });
});

test("kanbanCheckAction (onKanbanCheck): uncheck done → next; recurring online → occurrence; offline → blocked; normal → done", async () => {
  const H = loadHelpers();
  const recur = { id: 7, title: "r", gtd_status: "next", context: "", list_id: null, recurrence_type: "daily" };
  const plain = { id: "c-8", title: "p", gtd_status: "next", context: "", list_id: null, recurrence_type: "" };
  const doneT = { id: 9, title: "d", gtd_status: "done", context: "Doing", context_id: 5, list_id: null, completed_at: "2026-10-19T03:00:00Z" };
  const board = H.kanbanBoardFor({ groupBy: "context", tasks: [recur, plain], donePool: [doneT], items: ITEMS, scope: "", sharedLists: [] });
  const run = async (task, fromKey, online) => {
    const r = deps();
    const a = H.kanbanCheckAction({ task, columns: board.columns, fromKey, groupBy: "context", online, todayIso: TODAY });
    await H.runKanbanAction(a, task, r.d);
    return r.calls;
  };
  assert.deepEqual(await run(doneT, "done", true), [["update", 9, { gtd_status: "next" }]]);
  assert.deepEqual(await run(recur, "none", true), [["post", "/api/tasks/7/occurrences/2026-10-20/mark", { status: "done" }], ["after"]]);
  assert.deepEqual(await run(recur, "none", false), [["toast", "Tidak bisa dilakukan saat offline", "error"]]);
  assert.deepEqual(await run(plain, "none", true), [["done", "c-8"]]);
});

test("kanbanScopeFor: workspace tersimpan yang tidak ada lagi → \"\"; slist_W memaksa W", () => {
  const H = loadHelpers();
  const opts = [{ value: "", label: "Pribadi" }, { value: "9", label: "👥 W" }];
  assert.equal(H.kanbanScopeFor("next", opts, "9"), "9");
  assert.equal(H.kanbanScopeFor("next", opts, "12"), "");
  assert.equal(H.kanbanScopeFor("next", opts, null), "");
  assert.equal(H.kanbanScopeFor("slist_12", [], ""), "12");
  assert.equal(H.kanbanScopeFor("slist_c-ws", opts, "9"), "c-ws");
});
