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

test("P2 due in exactly 7 days is still urgent -> Q1 (server boundary, NOT 3 days)", () => {
  assert.equal(calculateQuadrant({ priority: "P2", deadline: "2026-06-10" }, TODAY), "Q1");
});

test("P2 due in 8 days is no longer urgent -> Q2", () => {
  assert.equal(calculateQuadrant({ priority: "P2", deadline: "2026-06-11" }, TODAY), "Q2");
});

test("P1 overdue (yesterday) is urgent -> Q1", () => {
  assert.equal(calculateQuadrant({ priority: "P1", deadline: "2026-06-02" }, TODAY), "Q1");
});

test("P3 due in 8 days is neither -> Q4", () => {
  assert.equal(calculateQuadrant({ priority: "P3", deadline: "2026-06-11" }, TODAY), "Q4");
});

test("P3 overdue is urgent but not important -> Q3", () => {
  assert.equal(calculateQuadrant({ priority: "P3", deadline: "2026-05-01" }, TODAY), "Q3");
});

test("calculateQuadrant defaults today to local date when omitted (smoke, no throw)", () => {
  const q = calculateQuadrant({ priority: "P1", deadline: null });
  assert.ok(["Q1", "Q2", "Q3", "Q4"].includes(q));
});

const { deriveTaskFields } = require("../../static/offline/tasklogic.js");

test("deriveTaskFields: no deadline -> null days, not overdue", () => {
  const r = deriveTaskFields({ deadline: null, gtd_status: "inbox" }, TODAY);
  assert.equal(r.days_until_deadline, null);
  assert.equal(r.is_overdue, false);
});

test("deriveTaskFields: deadline tomorrow -> 1 day, not overdue", () => {
  const r = deriveTaskFields({ deadline: "2026-06-04", gtd_status: "inbox" }, TODAY);
  assert.equal(r.days_until_deadline, 1);
  assert.equal(r.is_overdue, false);
});

test("deriveTaskFields: deadline yesterday + active -> -1 day, overdue", () => {
  const r = deriveTaskFields({ deadline: "2026-06-02", gtd_status: "next" }, TODAY);
  assert.equal(r.days_until_deadline, -1);
  assert.equal(r.is_overdue, true);
});

test("deriveTaskFields: overdue but done -> not overdue", () => {
  const r = deriveTaskFields({ deadline: "2026-06-02", gtd_status: "done" }, TODAY);
  assert.equal(r.is_overdue, false);
});

test("deriveTaskFields: overdue but archived -> not overdue", () => {
  const r = deriveTaskFields({ deadline: "2026-06-02", gtd_status: "archived" }, TODAY);
  assert.equal(r.is_overdue, false);
});

// PR B Target 🍅: index.html memanggil window.TF.tasklogic.todayLocalISO() saat render (usePomodoro,
// FocusPage, App). Tanpa ekspor ini seluruh aplikasi crash saat dimuat (ditemukan E2E Task 7).
test("todayLocalISO diekspor (browser + Node) dan memakai tanggal lokal YYYY-MM-DD", () => {
  const tl = require("../../static/offline/tasklogic.js");
  assert.equal(typeof tl.todayLocalISO, "function");
  const n = new Date();
  const want = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  assert.equal(tl.todayLocalISO(), want);
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  const src = fs.readFileSync(path.join(__dirname, "../../static/offline/tasklogic.js"), "utf8");
  const win = {};
  vm.runInNewContext(src, { self: win, Date });
  assert.equal(typeof win.TF.tasklogic.todayLocalISO, "function");
});
