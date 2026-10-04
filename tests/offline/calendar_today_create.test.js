"use strict";

// Kalender: tombol "Today" untuk kembali ke bulan berjalan, dan membuat task dari tanggal
// (modal "+ Buat Baru" yang sama, dengan deadline terisi tanggal yang diklik).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8");

function componentSource(signature) {
  const start = indexHtml.indexOf(signature);
  assert.ok(start >= 0, `${signature} must exist`);
  const end = indexHtml.indexOf("\n}\n", start);
  assert.ok(end > start, `${signature} end must be found`);
  return indexHtml.slice(start, end);
}

const cal = componentSource("function CalendarView({");

test("CalendarView menerima prop onCreateOnDate", () => {
  assert.match(cal.slice(0, 200), /onCreateOnDate/);
});

test("tombol Today mengembalikan kalender ke bulan & tahun hari ini", () => {
  const m = cal.match(/const goToday = \(\) => \{([\s\S]*?)\n  \};/);
  assert.ok(m, "goToday handler must exist");
  assert.match(m[1], /setYear\(now\.getFullYear\(\)\)/);
  assert.match(m[1], /setMonth\(now\.getMonth\(\)\)/);
  assert.match(m[1], /setSelectedDay\(null\)/);
  assert.match(cal, /onClick: goToday[\s\S]{0,400}"Today"/);
});

test("klik tanggal kosong langsung membuka modal buat task untuk tanggal itu", () => {
  const m = cal.match(/const handleDayClick = day => \{([\s\S]*?)\n  \};/);
  assert.ok(m, "handleDayClick must exist");
  assert.match(m[1], /onCreateOnDate\(dateKey\(day\)\)/);
  assert.match(m[1], /setSelectedDay/);
  // desktop & mobile cell sama-sama memakai handleDayClick
  assert.equal((cal.match(/onClick: \(\) => day && handleDayClick\(day\)/g) || []).length, 2);
});

test("panel tanggal (ada task) punya tombol buat task di tanggal itu", () => {
  assert.match(cal, /const addOnDayButton = [\s\S]{0,200}onClick: \(\) => createOnSelectedDay\(\)/);
  const n = (cal.match(/onCreateOnDate && addOnDayButton/g) || []).length;
  assert.equal(n, 2, "mobile panel + desktop modal");
  assert.match(cal, /const createOnSelectedDay = \(\) => \{[\s\S]*?onCreateOnDate\(selectedDateStr\)/);
});

test("App membuka TaskFormModal (tab Task/Habit/Note/Goal) dengan deadline terisi", () => {
  assert.match(indexHtml, /createElement\(CalendarView, \{\s*tasks: tasks,\s*onTaskClick: setSelectedTask,\s*onCreateOnDate: dateStr => \{\s*setEditTask\(\{\s*deadline: dateStr\s*\}\);\s*setShowForm\(true\);/);
  // task tanpa id = mode buat baru, bukan edit
  assert.match(indexHtml, /const isEdit = !!task\?\.id;/);
  assert.match(indexHtml, /deadline: task\?\.deadline \|\| ""/);
});

test("toast setelah simpan membedakan edit vs baru dari id, bukan sekadar editTask terisi", () => {
  assert.match(indexHtml, /showToast\(editTask\?\.id \? "Task diupdate ✅" : "Task ditambahkan ✅"\)/);
});
