"use strict";

// Modal "Kapan task ini dikerjakan?": muncul saat task baru disimpan tanpa deadline.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const appCss = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8").replace(/\r\n/g, "\n");

function loadHelpers() {
  const start = indexHtml.indexOf("function taskNeedsDatePrompt(");
  const end = indexHtml.indexOf("const TASK_DATE_PROMPT_MONTHS", start);
  assert.ok(start > 0 && end > start, "helper modal tanggal harus ada");
  return new Function(`${indexHtml.slice(start, end)}; return { taskNeedsDatePrompt, taskDatePromptCells, taskDatePromptKey, taskDatePromptQuickPicks };`)();
}

test("taskNeedsDatePrompt: hanya untuk task tanpa deadline yang tidak berulang", () => {
  const { taskNeedsDatePrompt } = loadHelpers();
  assert.equal(taskNeedsDatePrompt({ deadline: "" }, false), true);
  assert.equal(taskNeedsDatePrompt({ deadline: null }, false), true);
  assert.equal(taskNeedsDatePrompt({ deadline: "2026-10-20" }, false), false);
  assert.equal(taskNeedsDatePrompt({ deadline: "" }, true), false);
});

test("taskDatePromptCells: minggu mulai Senin, kelipatan 7", () => {
  const { taskDatePromptCells } = loadHelpers();
  // 1 Oktober 2026 hari Kamis → 3 sel kosong (Sen, Sel, Rab)
  const oct = taskDatePromptCells(2026, 9);
  assert.deepEqual(oct.slice(0, 4), [null, null, null, 1]);
  assert.equal(oct.filter(Boolean).length, 31);
  assert.equal(oct.length % 7, 0);
  // 1 Februari 2027 hari Senin → tanpa sel kosong di depan
  assert.equal(taskDatePromptCells(2027, 1)[0], 1);
});

test("taskDatePromptQuickPicks: hari ini, besok, Senin depan", () => {
  const { taskDatePromptQuickPicks } = loadHelpers();
  const wed = taskDatePromptQuickPicks(new Date(2026, 9, 14, 23, 30));
  assert.deepEqual(wed.map(q => q.key), ["2026-10-14", "2026-10-15", "2026-10-19"]);
  // Senin → Senin depan = 7 hari lagi; lintas bulan/tahun
  const mon = taskDatePromptQuickPicks(new Date(2026, 11, 28));
  assert.deepEqual(mon.map(q => q.key), ["2026-12-28", "2026-12-29", "2027-01-04"]);
});

test("TaskFormModal memunculkan modal tanggal dan menyimpan sesuai pilihan", () => {
  const start = indexHtml.indexOf("function TaskFormModal({");
  const form = indexHtml.slice(start, indexHtml.indexOf("\nfunction ModalAttachments(", start));
  assert.match(form, /mode === "task" && !isEdit && !opts && taskNeedsDatePrompt\(form, recurringOn\)/);
  assert.match(form, /setDatePromptOpen\(true\)/);
  assert.match(form, /onSkip: \(\) => \{\s*setDatePromptOpen\(false\);\s*handleSubmit\(null, \{ deadline: "" \}\);/);
  assert.match(form, /handleSubmit\(null, \{ deadline: dateKey \}\);/);
  assert.match(form, /"deadline" in opts \? \{ deadline: opts\.deadline \}/);
});

test("TaskDatePromptModal: tombol bulan, Lewati dan Tambahkan", () => {
  const start = indexHtml.indexOf("function TaskDatePromptModal(");
  const comp = indexHtml.slice(start, indexHtml.indexOf("\nfunction TaskFormModal({", start));
  assert.match(comp, /"Bulan sebelumnya"/);
  assert.match(comp, /"Bulan berikutnya"/);
  assert.match(comp, /"Tidak perlu \(Lewati\)"/);
  assert.match(comp, /"Tambahkan"/);
  assert.match(comp, /disabled: saving \|\| !picked/);
});

test("app.css: gaya modal tanggal tanpa garis aksen berwarna", () => {
  const start = appCss.indexOf("Modal pilih tanggal saat task baru");
  assert.ok(start > 0);
  const css = appCss.slice(start);
  assert.match(css, /\.task-date-prompt \.tdp-grid \{/);
  assert.doesNotMatch(css, /border-(left|top)\s*:/);
});
