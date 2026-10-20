"use strict";
// Kanban tahap kustom (frontend) Task 4 — model papan murni.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const KB = require("../../static/offline/kanbanboard.js");

const T = (over) => Object.assign({
  id: 1, title: "t", priority: "", deadline: null, gtd_status: "next", completed_at: null,
  context: "", context_id: null, list_id: null, recurrence_type: "",
}, over);
const I = (over) => Object.assign({
  id: 1, name: "S", list_id: null, position: 0, color: null, archived: false, can_manage: true,
}, over);
const ids = (ts) => ts.map((t) => t.id);

test("jktDay and tsMs", () => {
  assert.equal(KB.jktDay(Date.parse("2026-10-20T16:59:59Z")), "2026-10-20");
  assert.equal(KB.jktDay(Date.parse("2026-10-20T17:00:00Z")), "2026-10-21");
  assert.equal(KB.tsMs("2026-10-20T00:00:00"), Date.parse("2026-10-20T00:00:00Z"));
  assert.equal(KB.tsMs("2026-10-20T07:00:00+07:00"), Date.parse("2026-10-20T00:00:00Z"));
  assert.ok(Number.isNaN(KB.tsMs("")));
  assert.ok(Number.isNaN(KB.tsMs(null)));
});

test("isDoneRecent handles Z, naive and microsecond timestamps around WIB midnight", () => {
  const today = "2026-10-20";
  const d = (c, st) => KB.isDoneRecent({ gtd_status: st || "done", completed_at: c }, today);
  assert.equal(d("2026-10-13T17:30:00Z"), true);
  assert.equal(d("2026-10-13T16:59:59"), false);
  assert.equal(d("2026-10-19T23:59:59.123456"), true);
  assert.equal(d("2026-10-20T16:59:59Z"), true);
  assert.equal(d("2026-10-20T17:00:00Z"), false); // 21 Okt WIB, di masa depan
  assert.equal(d("2026-10-19T00:00:00Z", "next"), false);
  assert.equal(d(null), false);
});

test("sortCards orders by priority, deadline, title nocase, id", () => {
  const out = KB.sortCards([
    T({ id: 1, title: "b" }), T({ id: 2, title: "a", priority: "P2" }),
    T({ id: 3, title: "z", priority: "P1", deadline: "2026-11-01" }),
    T({ id: 4, title: "y", priority: "P1", deadline: "2026-10-30" }),
    T({ id: 5, title: "y", priority: "P1" }), T({ id: 6, title: "B" }),
    T({ id: "c-1", title: "b" }),
  ]);
  assert.deepEqual(ids(out), [4, 3, 5, 2, 1, 6, "c-1"]);
});

test("sortDone puts newest completed_at first", () => {
  const out = KB.sortDone([
    T({ id: 1, completed_at: "2026-10-18T01:00:00Z" }),
    T({ id: 2, completed_at: "2026-10-19T01:00:00.5" }),
    T({ id: 3, completed_at: null }),
  ]);
  assert.deepEqual(ids(out), [2, 1, 3]);
});

test("taskScope and scopeOptions ignore deleted workspace and default to personal", () => {
  const shared = [{ id: 7, name: "beta" }, { id: 8, name: "Alpha" }, { id: 9, name: "Empty" }];
  assert.equal(KB.taskScope(T({ list_id: 7 }), shared), "7");
  assert.equal(KB.taskScope(T({ list_id: 99 }), shared), "");
  assert.equal(KB.taskScope(T({ list_id: null }), shared), "");
  const opts = KB.scopeOptions([T({ list_id: 7 }), T({ list_id: 8 }), T({ list_id: 99 })], shared);
  assert.deepEqual(opts, [
    { value: "", label: "Pribadi" }, { value: "8", label: "👥 Alpha" }, { value: "7", label: "👥 beta" },
  ]);
  assert.deepEqual(KB.scopeOptions([], []), [{ value: "", label: "Pribadi" }]);
});

test("buildContextBoard shows empty stages, orphan archived and unsynced, done last", () => {
  const items = [
    I({ id: 2, name: "Beta", position: 2 }), I({ id: 1, name: "Alpha", position: 1 }),
    I({ id: 3, name: "Old", position: 3, archived: true }),
    { id: "cid-9", cid: "cid-9", name: "Pend", list_id: null, position: 9, archived: false, pending: true },
    I({ id: 50, name: "Other", list_id: 7 }),
  ];
  const tasks = [
    T({ id: 10, context_id: 1, context: "Alpha" }),
    T({ id: 11 }),
    T({ id: 12, context_id: 3, context: "Old" }),
    T({ id: 13, context: "Ghost" }),
    T({ id: 14, context: "ghost" }),
  ];
  const done = [T({ id: 20, gtd_status: "done", completed_at: "2026-10-19T00:00:00Z" })];
  const { columns, hiddenOtherScope } = KB.buildContextBoard({ tasks, donePool: done, items, scope: "", sharedLists: [{ id: 7, name: "W" }] });
  assert.deepEqual(columns.map((c) => c.key), ["none", "stage:1", "stage:2", "stage:cid-9", "orphan:old", "orphan:ghost", "done"]);
  const by = (k) => columns.find((c) => c.key === k);
  assert.equal(by("none").label, "Belum ada tahap");
  assert.equal(by("none").kind, "none");
  assert.deepEqual(ids(by("none").tasks), [11]);
  assert.equal(by("stage:1").kind, "stage");
  assert.equal(by("stage:1").item.id, 1);
  assert.deepEqual(ids(by("stage:1").tasks), [10]);
  assert.deepEqual(by("stage:2").tasks, []);
  assert.equal(by("orphan:old").label, "Old (diarsip)");
  assert.deepEqual(ids(by("orphan:old").tasks), [12]);
  assert.equal(by("orphan:ghost").label, "Ghost (belum tersinkron)");
  assert.equal(by("orphan:ghost").kind, "orphan");
  assert.deepEqual(ids(by("orphan:ghost").tasks).sort(), [13, 14]);
  assert.equal(by("done").label, "Selesai");
  assert.deepEqual(ids(by("done").tasks), [20]);
  assert.equal(hiddenOtherScope, 0);
});

test("buildContextBoard matches by id before name and counts other scope", () => {
  const shared = [{ id: 7, name: "W" }];
  const items = [
    I({ id: 1, name: "Alpha", position: 1 }), I({ id: 2, name: "Beta", position: 2 }),
    I({ id: 5, name: "Alpha", list_id: 7, position: 1 }),
  ];
  const tasks = [
    T({ id: 1, context_id: 2, context: "alpha" }), // id menang atas nama
    T({ id: 2, context_id: null, context: "ALPHA" }), // nama NOCASE
    T({ id: 3, context_id: "1", context: "" }), // id string
    T({ id: 4, list_id: 7, context_id: 5, context: "Alpha" }),
    T({ id: 5, list_id: 99, context: "" }), // workspace hilang → pribadi
  ];
  const p = KB.buildContextBoard({ tasks, donePool: [], items, scope: "", sharedLists: shared });
  const by = (b, k) => b.columns.find((c) => c.key === k);
  assert.deepEqual(ids(by(p, "stage:2").tasks), [1]);
  assert.deepEqual(ids(by(p, "stage:1").tasks), [2, 3]);
  assert.deepEqual(ids(by(p, "none").tasks), [5]);
  assert.equal(p.hiddenOtherScope, 1);
  const w = KB.buildContextBoard({ tasks, donePool: [], items, scope: "7", sharedLists: shared });
  assert.deepEqual(w.columns.map((c) => c.key), ["none", "stage:5", "done"]);
  assert.deepEqual(ids(by(w, "stage:5").tasks), [4]);
  assert.equal(w.hiddenOtherScope, 4);
});

test("buildPriorityBoard always shows P1-P4", () => {
  const b = KB.buildPriorityBoard({ tasks: [], donePool: [] });
  assert.deepEqual(b.columns.map((c) => c.key), ["pri:P1", "pri:P2", "pri:P3", "pri:P4", "done"]);
  assert.deepEqual(b.columns.map((c) => c.label), ["🔴 P1 Critical", "🟠 P2 High", "🟡 P3 Medium", "🟢 P4 Low", "Selesai"]);
  assert.equal(b.columns[0].kind, "priority");
  assert.equal(b.columns[0].value, "P1");
  const b2 = KB.buildPriorityBoard({ tasks: [T({ id: 1, priority: "P2" }), T({ id: 2, priority: "" })], donePool: [T({ id: 3 })] });
  assert.deepEqual(b2.columns.map((c) => c.key), ["pri:P1", "pri:P2", "pri:P3", "pri:P4", "pri:", "done"]);
  const none = b2.columns[4];
  assert.equal(none.label, "(Tanpa Priority)");
  assert.equal(none.value, "");
  assert.deepEqual(ids(none.tasks), [2]);
  assert.deepEqual(ids(b2.columns[1].tasks), [1]);
  assert.deepEqual(ids(b2.columns[5].tasks), [3]);
});

test("withDoneColumn appends sorted Selesai", () => {
  const cols = [{ key: "proj:a", kind: "project", label: "A", tasks: [] }];
  const out = KB.withDoneColumn(cols, [T({ id: 1, completed_at: "2026-10-01T00:00:00Z" }), T({ id: 2, completed_at: "2026-10-02T00:00:00Z" })]);
  assert.equal(out.length, 2);
  assert.equal(out[1].key, "done");
  assert.deepEqual(ids(out[1].tasks), [2, 1]);
  assert.equal(cols.length, 1);
});

test("dropAction with cid string task id", () => {
  const id = "3f2a1c9e-1111-4222-8333-444455556666";
  const task = T({ id });
  const none = { key: "none", kind: "none", tasks: [] };
  const st = { key: "stage:4", kind: "stage", item: I({ id: 4, name: "Alpha" }), tasks: [] };
  const st2 = { key: "stage:5", kind: "stage", item: I({ id: 5, name: "Beta" }), tasks: [] };
  const orphan = { key: "orphan:x", kind: "orphan", tasks: [] };
  const done = { key: "done", kind: "done", tasks: [] };
  const p2 = { key: "pri:P2", kind: "priority", value: "P2", tasks: [] };
  const p0 = { key: "pri:", kind: "priority", value: "", tasks: [] };
  const pr = { key: "proj:x", kind: "project", tasks: [] };
  const A = (over) => KB.dropAction(Object.assign({ task, groupBy: "context", online: true, todayIso: "2026-10-20" }, over));
  assert.deepEqual(A({ from: st, to: st }), { type: "none" });
  assert.deepEqual(A({ from: st, to: done }), { type: "done" });
  const rec = T({ id, recurrence_type: "daily" });
  assert.deepEqual(A({ task: rec, from: st, to: done }), { type: "occurrence", date: "2026-10-20" });
  assert.deepEqual(A({ task: rec, from: st, to: done, online: false }), { type: "blocked", message: "Tidak bisa dilakukan saat offline" });
  assert.deepEqual(A({ from: done, to: st }), { type: "reopen", patch: { gtd_status: "next", context_id: 4, context: "Alpha" } });
  assert.deepEqual(A({ from: done, to: none }), { type: "reopen", patch: { gtd_status: "next", context_id: null, context: "" } });
  assert.deepEqual(A({ from: done, to: p2, groupBy: "priority" }), { type: "reopen", patch: { gtd_status: "next", priority: "P2" } });
  assert.deepEqual(A({ from: done, to: p0, groupBy: "priority" }), { type: "reopen", patch: { gtd_status: "next", priority: "" } });
  assert.deepEqual(A({ from: done, to: pr, groupBy: "project" }), { type: "reopen", patch: { gtd_status: "next" }, columnKey: "proj:x" });
  assert.deepEqual(A({ from: none, to: st2 }), { type: "patch", patch: { context_id: 5, context: "Beta" } });
  assert.deepEqual(A({ from: st, to: none }), { type: "patch", patch: { context_id: null, context: "" } });
  assert.deepEqual(A({ from: st, to: orphan }), { type: "none" });
  assert.deepEqual(A({ from: done, to: orphan }), { type: "none" });
  assert.deepEqual(A({ from: p0, to: p2, groupBy: "priority" }), { type: "patch", patch: { priority: "P2" } });
  assert.deepEqual(A({ from: p2, to: p0, groupBy: "priority" }), { type: "patch", patch: { priority: "" } });
  assert.deepEqual(A({ from: pr, to: { key: "proj:y", kind: "project", tasks: [] }, groupBy: "project" }), { type: "project", columnKey: "proj:y" });
});

test("moveTargets excludes source and orphan", () => {
  const cols = [{ key: "none", label: "Belum ada tahap", kind: "none" }, { key: "stage:1", label: "A", kind: "stage" },
    { key: "orphan:x", label: "X", kind: "orphan" }, { key: "done", label: "Selesai", kind: "done" }];
  assert.deepEqual(KB.moveTargets(cols, "stage:1"), [{ key: "none", label: "Belum ada tahap" }, { key: "done", label: "Selesai" }]);
  assert.deepEqual(KB.moveTargets(cols, "orphan:x").map((c) => c.key), ["none", "stage:1", "done"]);
});

test("reorderIds swaps and refuses pending/edges", () => {
  const items = [
    I({ id: 1, name: "A", position: 1 }), I({ id: 2, name: "B", position: 2 }), I({ id: 3, name: "C", position: 3 }),
    I({ id: 4, name: "Arch", position: 0, archived: true }),
    I({ id: 9, name: "W", list_id: 7, position: 1 }),
    { id: "cid-1", cid: "cid-1", name: "P", list_id: null, position: 4, archived: false, pending: true },
  ];
  assert.deepEqual(KB.reorderIds(items, "", 2, -1), [2, 1, 3]);
  assert.deepEqual(KB.reorderIds(items, "", "2", 1), [1, 3, 2]);
  assert.equal(KB.reorderIds(items, "", 1, -1), null);
  assert.equal(KB.reorderIds(items, "", 3, 1), null);
  assert.equal(KB.reorderIds(items, "", "cid-1", -1), null);
  assert.equal(KB.reorderIds(items, "", 99, 1), null);
  assert.deepEqual(KB.reorderIds(items, "7", 9, 1), null);
});
