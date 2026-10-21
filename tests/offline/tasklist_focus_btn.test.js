"use strict";

// Tombol "Fokus" (mulai Pomodoro) di baris TaskRow halaman daftar tugas:
//   App -> TaskListView -> TaskRow, memakai handleStartFocus yang sama dengan Dashboard.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const appCss = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8").replace(/\r\n/g, "\n");

function fnSource(name) {
  const start = indexHtml.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = indexHtml.indexOf("\n}\n", start + 1);
  assert.ok(end > start, `${name} end must be found`);
  return indexHtml.slice(start, end);
}

test("App: kedua TaskListView menerima focusTask & onStartFocus", () => {
  const calls = indexHtml.split("React.createElement(TaskListView, {").slice(1);
  assert.equal(calls.length, 2, "ada dua pemanggilan TaskListView");
  for (const c of calls) {
    const body = c.slice(0, c.indexOf("\n    })"));
    assert.match(body, /focusTask: focusTask,/);
    assert.match(body, /onStartFocus: handleStartFocus[,\n]/);
  }
});

test("TaskListView: terima props & teruskan ke setiap TaskRow", () => {
  const src = fnSource("TaskListView");
  const sig = src.slice(0, src.indexOf(") {\n"));
  assert.match(sig, /\bfocusTask\b/);
  assert.match(sig, /\bonStartFocus\b/);
  const rows = src.split("React.createElement(TaskRow, {").slice(1);
  assert.ok(rows.length >= 2, "minimal dua render TaskRow");
  for (const r of rows) {
    const body = r.slice(0, r.indexOf("}))"));
    assert.match(body, /focusTask: focusTask,/);
    assert.match(body, /onStartFocus: onStartFocus,/);
  }
});

test("TaskRow: tombol dash-focus-btn sebelum bintang, terjaga onStartFocus & belum selesai", () => {
  const src = fnSource("TaskRow");
  assert.match(src.slice(0, src.indexOf(") {\n")), /focusTask,\s*onStartFocus/);
  const badges = src.slice(src.indexOf('className: "task-row-badges"'));
  const btn = badges.indexOf('className: "dash-focus-btn"');
  const star = badges.indexOf("onToggleFocus(task.id)");
  assert.ok(btn > 0 && star > btn, "tombol fokus sebelum bintang");
  assert.match(badges, /onStartFocus && task\.gtd_status !== "done" && \/\*#__PURE__\*\/React\.createElement\("button", \{\s*type: "button",\s*className: "dash-focus-btn" \+ \(isFocusing \? " is-active" : ""\)/);
  assert.match(src, /const isFocusing = focusTask\?\.id === task\.id;/);
  const seg = badges.slice(btn, star);
  assert.match(seg, /e\.stopPropagation\(\);\s*onStartFocus\(task\);/);
  assert.match(seg, /Fokuskan tugas & mulai Pomodoro/);
  assert.match(seg, /"aria-pressed": isFocusing/);
  assert.match(seg, /name: "target",\s*size: 13/);
  assert.match(seg, /isFocusing \? "Aktif" : "Fokus"/);
  assert.match(badges, /Tambah ke daftar Fokus Hari Ini/);
});

test("CompactRow & Kanban tidak memakai onStartFocus", () => {
  assert.doesNotMatch(fnSource("CompactRow"), /onStartFocus/);
  assert.doesNotMatch(fnSource("KanbanCard"), /onStartFocus/);
  assert.doesNotMatch(fnSource("KanbanView"), /onStartFocus/);
});

test("TodayFocusView: task fokus aktif selalu tampil", () => {
  const src = fnSource("TodayFocusView");
  assert.match(src, /const todayTasks = tasks\.filter\(t => \(t\.quadrant === "Q1" \|\| t\.is_overdue \|\| t\.is_focused \|\| \(focusTask && t\.id === focusTask\.id\)\) && t\.gtd_status !== "done" && t\.gtd_status !== "archived"\)/);
});

test("CSS: label tombol fokus disembunyikan di layar sempit", () => {
  assert.match(appCss, /@media \(max-width: 768px\) \{[\s\S]*?\.task-row-badges \.dash-focus-label \{ display: none; \}/);
});

test("cache bust v432 + app.css?v=353", () => {
  const sw = fs.readFileSync(path.resolve(__dirname, "../../static/sw.js"), "utf8");
  const py = fs.readFileSync(path.resolve(__dirname, "../../webapp.py"), "utf8");
  assert.match(sw, /^const CACHE = "taskflow-v448-komentar-offline";/m);
  assert.match(indexHtml, /window\.__SW_VERSION\s*=\s*"taskflow-v448-komentar-offline";/);
  assert.match(indexHtml, /window\.__SW_VERSION\s*\|\|\s*"taskflow-v448-komentar-offline"/);
  assert.match(py, /sw_cache = "taskflow-v448-komentar-offline"/);
  assert.match(indexHtml, /app\.css\?v=353/);
});

test("Sidebar: badge Today ikut menghitung task fokus aktif", () => {
  const src = fnSource("Sidebar");
  assert.match(src.slice(0, src.indexOf(") {\n")), /\bfocusTaskId\b/);
  assert.match(src, /const todayCount = \(tasks \|\| \[\]\)\.filter\(t => \(t\.quadrant === "Q1" \|\| t\.is_overdue \|\| t\.is_focused \|\| \(focusTaskId != null && t\.id === focusTaskId\)\) && t\.gtd_status !== "done" && t\.gtd_status !== "archived"\)\.length;/);
  const call = indexHtml.split("React.createElement(Sidebar, {")[1].slice(0, 400);
  assert.match(call, /focusTaskId: focusTaskId,/);
});

test("CSS: tombol fokus di mobile setinggi 22px agar baris tidak membesar", () => {
  assert.match(appCss, /@media \(max-width: 768px\) \{[\s\S]*?\.task-row-badges \.dash-focus-btn \{[^}]*height: 22px;/);
});
