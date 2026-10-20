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
    `${proj}\n${code}; return { kanbanScopeKey, readKanbanScope, kanbanDonePool, taskInitials, runKanbanAction };`)(
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
  assert.match(view, /TF\.kanbanboard\.buildContextBoard\(/);
  assert.match(view, /TF\.kanbanboard\.buildPriorityBoard\(/);
  assert.match(view, /TF\.kanbanboard\.withDoneColumn\(/);
  assert.match(view, /TF\.kanbanboard\.dropAction\(/);
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
