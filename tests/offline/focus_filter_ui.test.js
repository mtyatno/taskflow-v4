"use strict";

// UI pemilihan task halaman Fokus: satu definisi cakupan "hari ini" (focusfilter.inTodayScope,
// tanggal lokal) dipakai Sidebar, Dashboard, dan App.getFilteredTasks.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");

function fnSource(name) {
  const start = indexHtml.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = indexHtml.indexOf("\n}\n", start + 1);
  assert.ok(end > start, `${name} end must be found`);
  return indexHtml.slice(start, end);
}

test("Sidebar, Dashboard, App: cakupan hari ini dari focusfilter.inTodayScope", () => {
  for (const name of ["Sidebar", "Dashboard", "App"]) {
    const src = fnSource(name);
    assert.ok(src.includes("focusfilter.inTodayScope("), `${name} harus memakai focusfilter.inTodayScope(`);
    assert.ok(
      !src.includes('t.quadrant === "Q1" || t.is_overdue'),
      `${name} tidak boleh lagi memuat definisi cakupan lama (Q1 || is_overdue)`
    );
  }
});

test("Sidebar: todayCount memakai tanggal lokal dan task fokus aktif", () => {
  const src = fnSource("Sidebar");
  assert.match(
    src,
    /const todayCount = \(tasks \|\| \[\]\)\.filter\(t => window\.TF\.focusfilter\.inTodayScope\(t, \{ todayISO(?:: [^,}]+)?, focusTaskId \}\)\)\.length;/
  );
  assert.match(src, /const todayISO = window\.TF\.tasklogic\.todayLocalISO\(\);/);
  // done tidak dihitung di badge sidebar (includeDone hanya untuk Dashboard)
  assert.ok(!src.includes("includeDone"));
});

test("Dashboard: todayStr lokal, allToday includeDone, pengurutan memakai timeBucket", () => {
  const src = fnSource("Dashboard");
  assert.ok(!src.includes('toISOString().split("T")[0]'), "todayStr tidak boleh memakai tanggal UTC");
  assert.match(src, /const todayStr = window\.TF\.tasklogic\.todayLocalISO\(\);/);
  assert.match(
    src,
    /const allToday = tasks\.filter\(t => window\.TF\.focusfilter\.inTodayScope\(t, \{ todayISO: todayStr, includeDone: true \}\)\);/
  );
  assert.ok(src.includes("includeDone: true"));
  // pendingToday: terlambat dulu menurut bucket lokal, bukan is_overdue server (basi)
  const pend = src.slice(src.indexOf("const pendingToday"), src.indexOf("const visibleDone"));
  assert.ok(pend.includes('window.TF.focusfilter.timeBucket(a, todayStr) === "late"'));
  assert.ok(pend.includes('window.TF.focusfilter.timeBucket(b, todayStr) === "late"'));
  assert.ok(!pend.includes("is_overdue"));
  assert.ok(pend.includes("SORT_PRI(a, b)"));
  // kelas baris kartu tidak diubah
  assert.ok(src.includes("is-overdue"));
});

test("App.getFilteredTasks: kasus today memakai tanggal lokal tanpa done/archived", () => {
  const src = fnSource("App");
  const start = src.indexOf('case "today":');
  assert.ok(start >= 0);
  const block = src.slice(start, src.indexOf('case "all":', start));
  assert.ok(block.includes("window.TF.tasklogic.todayLocalISO()"));
  assert.match(block, /window\.TF\.focusfilter\.inTodayScope\(t, \{ todayISO \}\)/);
  assert.ok(!block.includes("includeDone"));
});
