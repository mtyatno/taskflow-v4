"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const td = require("../../static/offline/taskdetail.js");
const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const swJs = fs.readFileSync(path.resolve(__dirname, "../../static/sw.js"), "utf8").replace(/\r\n/g, "\n");

test("konstanta", () => {
  assert.deepEqual([...td.TAB_ORDER], ["subtask", "checklist", "notes", "attachments"]);
  assert.deepEqual([...td.PROGRESS_PRESETS], [0, 25, 50, 75, 100]);
  assert.deepEqual([...td.STATUS_ORDER], ["inbox", "next", "waiting", "someday", "done"]);
  assert.deepEqual([...td.PRIORITY_ORDER], ["P1", "P2", "P3", "P4"]);
  assert.deepEqual([...td.MONTHS_SHORT], ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]);
  for (const k of ["TAB_ORDER", "PROGRESS_PRESETS", "STATUS_ORDER", "PRIORITY_ORDER", "MONTHS_SHORT"]) assert.ok(Object.isFrozen(td[k]), k);
});
test("initialTab: urutan subtask, checklist, notes, attachments; kosong → subtask", () => {
  assert.equal(td.initialTab({ subtask: 0, checklist: 0, notes: 0, attachments: 0 }), "subtask");
  assert.equal(td.initialTab({ subtask: 0, checklist: 3, notes: 1, attachments: 2 }), "checklist");
  assert.equal(td.initialTab({ notes: 2 }), "notes");
  assert.equal(td.initialTab({ attachments: 1, notes: null }), "attachments");
  assert.equal(td.initialTab(null), "subtask");
});
test("isOverdue", () => {
  const today = "2026-10-26";
  assert.equal(td.isOverdue("2026-10-25", "next", today), true);
  assert.equal(td.isOverdue("2026-10-26", "next", today), false);
  assert.equal(td.isOverdue("2026-10-27", "inbox", today), false);
  assert.equal(td.isOverdue("2026-10-25", "done", today), false);
  assert.equal(td.isOverdue("2026-10-25", "archived", today), false);
  assert.equal(td.isOverdue("", "next", today), false);
  assert.equal(td.isOverdue(null, "next", today), false);
});
test("format tanggal", () => {
  assert.equal(td.formatCreated("2026-10-21T08:30:00"), "21 Okt 2026");
  assert.equal(td.formatCreated("2026-01-05 03:00:00"), "5 Jan 2026");
  for (const bad of ["", null, undefined, "kemarin"]) assert.equal(td.formatCreated(bad), "");
  assert.equal(td.formatDeadline("2026-12-31"), "31 Des 2026");
  assert.equal(td.formatDeadline(""), "");
  assert.equal(td.formatShortDate("2026-10-21", "2026-10-26"), "21 Okt");
  assert.equal(td.formatShortDate("2027-02-03", "2026-10-26"), "3 Feb 2027");
  assert.equal(td.formatShortDate("", "2026-10-26"), "");
});
test("filterOptions / exactOption / canCreate (tanpa beda huruf, trim)", () => {
  const opts = ["Pemasaran", "Keuangan", "pemasaran digital"];
  assert.deepEqual(td.filterOptions(opts, ""), opts);
  assert.notEqual(td.filterOptions(opts, ""), opts, "salinan, bukan array yang sama");
  assert.deepEqual(td.filterOptions(opts, "  PEMA "), ["Pemasaran", "pemasaran digital"]);
  assert.deepEqual(td.filterOptions(opts, "uang"), ["Keuangan"]);
  assert.deepEqual(td.filterOptions(null, "x"), []);
  assert.equal(td.exactOption(" pemasaran ", opts), "Pemasaran");
  assert.equal(td.exactOption("pema", opts), null);
  assert.equal(td.canCreate("pemasaran", opts), false);
  assert.equal(td.canCreate("   ", opts), false);
  assert.equal(td.canCreate("Pema", opts), true);
  assert.equal(td.canCreate("Baru", null), true);
});
test("normalizeTagName", () => {
  assert.deepEqual(td.normalizeTagName("  #kerja "), { name: "kerja" });
  assert.deepEqual(td.normalizeTagName("##Rapat_2"), { name: "Rapat_2" });
  assert.deepEqual(td.normalizeTagName("café"), { name: "café" });
  assert.deepEqual(td.normalizeTagName(" # "), { error: "Tulis nama tag" });
  assert.deepEqual(td.normalizeTagName(null), { error: "Tulis nama tag" });
  assert.deepEqual(td.normalizeTagName("dua kata"), { error: "Tag hanya boleh huruf, angka, dan _" });
  assert.deepEqual(td.normalizeTagName("a-b"), { error: "Tag hanya boleh huruf, angka, dan _" });
});
test("clampProgress: kelipatan 5 dalam 0..100", () => {
  for (const [v, want] of [[-5, 0], [0, 0], [12, 10], [13, 15], [99, 100], [150, 100], ["40", 40], ["x", 0], [null, 0]])
    assert.equal(td.clampProgress(v), want, String(v));
});
test("popoverPosition", () => {
  const vp = { width: 1280, height: 800 };
  assert.deepEqual(td.popoverPosition({ anchor: { top: 100, bottom: 130, left: 200 }, size: { height: 200 }, viewport: vp }),
    { top: 134, left: 200, width: 320, maxHeight: 420, placement: "below" });
  const up = td.popoverPosition({ anchor: { top: 700, bottom: 730, left: 200 }, size: { height: 300 }, viewport: vp });
  assert.equal(up.placement, "above"); assert.equal(up.top, 396); assert.equal(up.maxHeight, 420);
  assert.equal(td.popoverPosition({ anchor: { top: 100, bottom: 130, left: 1200 }, size: { height: 100 }, viewport: vp }).left, 952);
  assert.equal(td.popoverPosition({ anchor: { top: 100, bottom: 130, left: 2 }, size: { height: 100 }, viewport: vp }).left, 8);
  const m = td.popoverPosition({ anchor: { top: 100, bottom: 130, left: 300 }, size: { height: 100 }, viewport: { width: 375, height: 700 } });
  assert.equal(m.left, 8); assert.equal(m.width, 359); assert.equal(m.placement, "below");
  const tall = td.popoverPosition({ anchor: { top: 380, bottom: 410, left: 10 }, size: { height: 900 }, viewport: vp });
  assert.deepEqual([tall.placement, tall.top, tall.maxHeight], ["below", 414, 378]);
});
test("dimuat di index.html sesudah tasklogic.js dan ada di STATIC sw.js", () => {
  const a = indexHtml.indexOf('<script src="/static/offline/tasklogic.js"></script>');
  const b = indexHtml.indexOf('<script src="/static/offline/taskdetail.js"></script>');
  assert.ok(a > 0 && b > a);
  assert.match(swJs, /"\/static\/offline\/taskdetail\.js",/);
});
