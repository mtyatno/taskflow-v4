"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const hero = require("../../static/offline/herologic.js");
const { bestStreak, habitChips, focusChip } = hero;

test("bestStreak picks the habit with the largest streak", () => {
  const hs = [{ title: "A", streak: 2 }, { title: "B", streak: 7 }, { title: "C", streak: 5 }];
  assert.deepEqual(bestStreak(hs), { days: 7, title: "B" });
});

test("bestStreak ties go to the first in input order", () => {
  const hs = [{ title: "A", streak: 4 }, { title: "B", streak: 4 }];
  assert.deepEqual(bestStreak(hs), { days: 4, title: "A" });
});

test("bestStreak title falls back to name then 'Habit'", () => {
  assert.deepEqual(bestStreak([{ name: "N", streak: 1 }]), { days: 1, title: "N" });
  assert.deepEqual(bestStreak([{ streak: 3 }]), { days: 3, title: "Habit" });
});

test("bestStreak returns null when no streak > 0 or input is not an array", () => {
  assert.equal(bestStreak([{ title: "A", streak: 0 }, { title: "B" }]), null);
  assert.equal(bestStreak([]), null);
  assert.equal(bestStreak(null), null);
  assert.equal(bestStreak(undefined), null);
  assert.equal(bestStreak({}), null);
});

const HS = [
  { id: 1, phase: "pagi", today_status: "done" },
  { id: 2, phase: "malam", today_status: null },
  { id: 3, phase: "pagi", today_status: null },
  { id: 4, phase: "siang", today_status: "skipped" },
  { id: 5, phase: "pagi", today_status: null },
];

test("habitChips orders current-phase pending, other pending, skipped, then done", () => {
  const r = habitChips(HS, "pagi", 10);
  assert.deepEqual(r.shown.map((h) => h.id), [3, 5, 2, 4, 1]);
  assert.equal(r.more, 0);
});

test("habitChips puts skipped before done even when skipped is in the current phase", () => {
  const hs = [
    { id: 1, phase: "pagi", today_status: "done" },
    { id: 2, phase: "pagi", today_status: "skipped" },
    { id: 3, phase: "malam", today_status: null },
  ];
  const r = habitChips(hs, "pagi", 10);
  assert.deepEqual(r.shown.map((h) => h.id), [3, 2, 1]);
  assert.deepEqual(r.shown.map((h) => [h.done, h.skipped]), [[false, false], [false, true], [true, false]]);
});

test("habitChips skips null/undefined entries", () => {
  const r = habitChips([null, { id: 1, phase: "pagi", today_status: null }, undefined], "pagi", 10);
  assert.deepEqual(r.shown.map((h) => h.id), [1]);
  assert.equal(r.more, 0);
});

test("habitChips default limit is 3 and more counts the rest", () => {
  const r = habitChips(HS, "pagi");
  assert.deepEqual(r.shown.map((h) => h.id), [3, 5, 2]);
  assert.equal(r.more, 2);
});

test("habitChips respects explicit limit", () => {
  const r = habitChips(HS, "malam", 2);
  assert.deepEqual(r.shown.map((h) => h.id), [2, 3]);
  assert.equal(r.more, 3);
});

test("habitChips items keep original fields plus done/skipped flags", () => {
  const r = habitChips(HS, "siang", 5);
  assert.deepEqual(r.shown.map((h) => h.id), [2, 3, 5, 4, 1]);
  assert.equal(r.shown[3].id, 4);
  assert.equal(r.shown[3].phase, "siang");
  assert.equal(r.shown[3].done, false);
  assert.equal(r.shown[3].skipped, true);
  assert.equal(r.shown[0].skipped, false);
  assert.equal(r.shown[4].id, 1);
  assert.equal(r.shown[4].done, true);
  assert.equal(r.shown[4].skipped, false);
  assert.equal(HS[0].done, undefined, "input objects are not mutated");
});

test("habitChips handles empty / non-array input", () => {
  assert.deepEqual(habitChips([], "pagi"), { shown: [], more: 0 });
  assert.deepEqual(habitChips(null, "pagi"), { shown: [], more: 0 });
});

test("focusChip invites when there is no focus task", () => {
  assert.deepEqual(focusChip(null, { isRunning: true }), { kind: "invite", title: null, action: null });
  assert.deepEqual(focusChip(undefined), { kind: "invite", title: null, action: null });
});

test("focusChip active: start when timer idle, pause when running", () => {
  assert.deepEqual(focusChip({ title: "Tulis laporan" }, { isRunning: false }), { kind: "active", title: "Tulis laporan", action: "start" });
  assert.deepEqual(focusChip({ title: "Tulis laporan" }, null), { kind: "active", title: "Tulis laporan", action: "start" });
  assert.deepEqual(focusChip({ title: "Tulis laporan" }, { isRunning: true }), { kind: "active", title: "Tulis laporan", action: "pause" });
  assert.deepEqual(focusChip({}, { isRunning: false }), { kind: "active", title: "", action: "start" });
});

test("focusChip has no action while Pomodoro awaits a choice or during a break", () => {
  assert.deepEqual(focusChip({ title: "T" }, { phase: "awaiting", isRunning: false }), { kind: "active", title: "T", action: null });
  assert.deepEqual(focusChip({ title: "T" }, { phase: "awaiting", isRunning: true }), { kind: "active", title: "T", action: null });
  assert.deepEqual(focusChip({ title: "T" }, { isBreak: true, isRunning: true }), { kind: "active", title: "T", action: null });
  assert.deepEqual(focusChip({ title: "T" }, { isBreak: true, isRunning: false }), { kind: "active", title: "T", action: null });
  assert.deepEqual(focusChip({ title: "T" }, { phase: "overtime", isRunning: true }), { kind: "active", title: "T", action: "pause" });
});

test("herologic attaches to root.TF.hero in the browser-style global", () => {
  assert.equal(globalThis.TF && globalThis.TF.hero, hero);
});
