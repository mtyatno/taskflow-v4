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
test("overtimeSeconds", () => {
  assert.equal(pl.overtimeSeconds({ accumSec: 30, runStartedAt: 1000, now: 61000 }), 90);
  assert.equal(pl.overtimeSeconds({ accumSec: 30, runStartedAt: null, now: 61000 }), 30);
  assert.equal(pl.overtimeSeconds({ accumSec: 30, runStartedAt: 1000, now: 1000 + 10 * 3600 * 1000 }), 7200);
});
test("overtimePomodoros, formatOvertime, overtimeProgress", () => {
  assert.equal(pl.overtimePomodoros(1499), 0);
  assert.equal(pl.overtimePomodoros(1500), 1);
  assert.equal(pl.overtimePomodoros(7200), 4);
  assert.equal(pl.formatOvertime(0), "+00:00");
  assert.equal(pl.formatOvertime(725), "+12:05");
  assert.equal(pl.formatOvertime(3909), "+1:05:09");
  assert.equal(pl.overtimeProgress(1800), 0.2);
});
test("overtimeClientId", () => {
  assert.equal(pl.overtimeClientId(7, 1760000000000), "pomo-7-1760000000000-o");
});
test("breakAfter", () => {
  assert.equal(pl.breakAfter(3, 4), "longBreak");
  assert.equal(pl.breakAfter(3, 5), "longBreak");
  assert.equal(pl.breakAfter(1, 2), "shortBreak");
  assert.equal(pl.breakAfter(4, 5), "shortBreak");
});
test("overtimeLogEntry", () => {
  assert.equal(pl.overtimeLogEntry({ sec: 59, workStartedAt: 5, userId: 7, logDate: "2026-10-20", endedAt: "x" }), null);
  assert.deepEqual(pl.overtimeLogEntry({ sec: 3100, workStartedAt: 5, userId: 7, logDate: "2026-10-20", endedAt: "x" }),
    { client_id: "pomo-7-5-o", kind: "overtime", pomodoros: 2, focus_seconds: 3100, log_date: "2026-10-20", ended_at: "x" });
});
test("staleSessionLogs", () => {
  const now = Date.parse("2026-10-20T08:00:00Z");
  const toLocalISO = (ms) => new Date(ms).toISOString().slice(0, 10);
  const ctx = { todayISO: "2026-10-20", now, userId: 7, toLocalISO };
  const base = { mode: "work", focusTaskId: 3, sessionTaskId: 9, date: "2026-10-19" };
  const end = Date.parse("2026-10-19T23:00:00Z");
  const r = pl.staleSessionLogs({ ...base, isRunning: true, targetEndTime: end, workStartedAt: end - 1500000 }, ctx);
  assert.equal(r.length, 1);
  assert.equal(r[0].taskId, 9);
  assert.deepEqual(r[0].entry, { client_id: "pomo-7-" + (end - 1500000) + "-s", kind: "session", pomodoros: 1,
    focus_seconds: 1500, log_date: "2026-10-19", ended_at: new Date(end).toISOString() });
  const ot = pl.staleSessionLogs({ ...base, phase: "overtime", otAccumSec: 0, otRunStartedAt: now - 3 * 3600 * 1000, workStartedAt: 5 }, ctx);
  assert.equal(ot.length, 1);
  assert.equal(ot[0].entry.kind, "overtime");
  assert.equal(ot[0].entry.pomodoros, 4);
  assert.equal(ot[0].entry.focus_seconds, 7200);
  assert.equal(ot[0].entry.client_id, "pomo-7-5-o");
  assert.equal(ot[0].entry.log_date, "2026-10-20");
  assert.deepEqual(pl.staleSessionLogs({ ...base, phase: "awaiting", isRunning: false }, ctx), []);
  assert.deepEqual(pl.staleSessionLogs({ ...base, date: "2026-10-20", phase: "overtime", otAccumSec: 900 }, ctx), []);
  assert.deepEqual(pl.staleSessionLogs({ mode: "work", phase: "overtime", otAccumSec: 900, date: "2026-10-19" }, ctx), []);
});
test("index.html memuat pomologic.js setelah focuspage.js", () => {
  const a = indexHtml.indexOf('src="/static/offline/focuspage.js"');
  const b = indexHtml.indexOf('src="/static/offline/pomologic.js"');
  assert.ok(a > 0 && b > a);
});
test("sw.js memuat pomologic.js di STATIC", () => {
  assert.ok(swJs.includes('"/static/offline/pomologic.js"'));
});
