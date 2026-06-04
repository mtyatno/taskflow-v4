"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { todayJkt, weekDates, deriveToday, monthly } = require("../../static/offline/habitlogic.js");

test("todayJkt converts a UTC ms to the Jakarta (UTC+7) date", () => {
  assert.equal(todayJkt(Date.parse("2026-06-04T20:00:00Z")), "2026-06-05");
  assert.equal(todayJkt(Date.parse("2026-06-04T10:00:00Z")), "2026-06-04");
});

test("weekDates returns Monday..Sunday of the week containing the date", () => {
  assert.deepEqual(weekDates("2026-06-04"), [
    "2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04",
    "2026-06-05", "2026-06-06", "2026-06-07",
  ]);
});

test("deriveToday computes today_status, week_log, and streak (done/skipped/break)", () => {
  const logs = {
    "2026-06-04": { status: "done", skip_reason: "" },
    "2026-06-03": { status: "done", skip_reason: "" },
    "2026-06-02": { status: "skipped", skip_reason: "sakit" },
    "2026-06-01": { status: "done", skip_reason: "" },
  };
  const d = deriveToday({}, logs, "2026-06-04");
  assert.equal(d.today_status, "done");
  assert.equal(d.streak, 3);
  assert.deepEqual(d.week_log, ["done", "skipped", "done", "done", null, null, null]);
});

test("deriveToday streak is 0 when today has no log (server parity)", () => {
  const d = deriveToday({}, { "2026-06-03": { status: "done" } }, "2026-06-04");
  assert.equal(d.today_status, null);
  assert.equal(d.streak, 0);
});

test("monthly counts done per day with avg up to today", () => {
  const logs = [
    { date: "2026-06-01", status: "done" },
    { date: "2026-06-01", status: "done" },
    { date: "2026-06-02", status: "skipped" },
    { date: "2026-05-31", status: "done" },
  ];
  const m = monthly(logs, 2026, 6, 2);
  assert.equal(m.days_in_month, 30);
  assert.equal(m.days[0].done, 2);
  assert.equal(m.days[1].done, 0);
  assert.equal(m.today_day, 2);
  assert.equal(m.avg, 1);
});
