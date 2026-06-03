"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { calculateQuadrant } = require("../../static/offline/tasklogic.js");

const TODAY = "2026-06-03";

test("P1 with no deadline is important but not urgent -> Q2", () => {
  assert.equal(calculateQuadrant({ priority: "P1", deadline: null }, TODAY), "Q2");
});

test("P4 with no deadline is neither -> Q4", () => {
  assert.equal(calculateQuadrant({ priority: "P4", deadline: null }, TODAY), "Q4");
});

test("P1 due today is urgent + important -> Q1", () => {
  assert.equal(calculateQuadrant({ priority: "P1", deadline: "2026-06-03" }, TODAY), "Q1");
});

test("P3 due today is urgent but not important -> Q3", () => {
  assert.equal(calculateQuadrant({ priority: "P3", deadline: "2026-06-03" }, TODAY), "Q3");
});

test("unknown priority defaults to importance 4 (not important)", () => {
  // no deadline -> not urgent, importance 4 < 5 -> Q4
  assert.equal(calculateQuadrant({ priority: "PX", deadline: null }, TODAY), "Q4");
});
