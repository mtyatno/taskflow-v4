"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pl = require("../../static/offline/pomologic.js");
const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const swJs = fs.readFileSync(path.resolve(__dirname, "../../static/sw.js"), "utf8").replace(/\r\n/g, "\n");

test("konstanta", () => {
  assert.equal(pl.POMO_SECONDS, 1500); assert.equal(pl.EST_MIN, 1); assert.equal(pl.EST_MAX, 20);
});
test("estimateHoursLabel", () => {
  assert.equal(pl.estimateHoursLabel(32), "~13.5 jam");
  assert.equal(pl.estimateHoursLabel(24), "~10 jam");
  assert.equal(pl.estimateHoursLabel(3), "~1.5 jam");
  assert.equal(pl.estimateHoursLabel(1), "~0.5 jam");
  assert.equal(pl.estimateHoursLabel(2), "~1 jam");
});
test("nextEstimate", () => {
  assert.equal(pl.nextEstimate(1, 3), 3);
  assert.equal(pl.nextEstimate(7, 2), 2);
  assert.equal(pl.nextEstimate(3, 5), 5);
  assert.equal(pl.nextEstimate(5, 5), 6);
  assert.equal(pl.nextEstimate(19, 5), 20);
  assert.equal(pl.nextEstimate(20, 5), 20);
});
test("clampEstimate", () => {
  assert.equal(pl.clampEstimate(0), 1); assert.equal(pl.clampEstimate(25), 20);
  assert.equal(pl.clampEstimate("3"), 3); assert.equal(pl.clampEstimate(2.6), 3);
  assert.equal(pl.clampEstimate(null), 1); assert.equal(pl.clampEstimate("x"), 1);
});
test("headerSummary", () => {
  assert.deepEqual(pl.headerSummary({ count: 28, done: 0, estimate: 32 }),
    { tasksText: "28 tugas", pomoText: "0 / 32", hoursText: "~13.5 jam" });
  assert.deepEqual(pl.headerSummary({ count: 0, done: 2, estimate: 0 }),
    { tasksText: "0 tugas", pomoText: "2", hoursText: null });
});
test("sessionClientId", () => {
  assert.equal(pl.sessionClientId(7, 1760000000000), "pomo-7-1760000000000-s");
});
test("isOverEstimate", () => {
  assert.equal(pl.isOverEstimate(4, 2), true); assert.equal(pl.isOverEstimate(2, 2), false);
});
test("index.html memuat pomologic.js setelah focuspage.js", () => {
  const a = indexHtml.indexOf('src="/static/offline/focuspage.js"');
  const b = indexHtml.indexOf('src="/static/offline/pomologic.js"');
  assert.ok(a > 0 && b > a);
});
test("sw.js memuat pomologic.js di STATIC", () => {
  assert.ok(swJs.includes('"/static/offline/pomologic.js"'));
});
