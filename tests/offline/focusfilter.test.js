"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ff = require("../../static/offline/focusfilter.js");
const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const swJs = fs.readFileSync(path.resolve(__dirname, "../../static/sw.js"), "utf8").replace(/\r\n/g, "\n");

const TODAY = "2026-10-22";

function fakeStorage(seed) {
  const m = new Map(Object.entries(seed || {}));
  return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
}
const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };

// ---- konstanta ----
test("konstanta: kunci, batas, urutan kanonis, chip cepat", () => {
  assert.equal(ff.FILTER_KEY, "tf_focus_filter");
  assert.equal(ff.COLLAPSED_KEY, "tf_focus_collapsed");
  assert.equal(ff.MAX_COLLAPSED, 200);
  assert.deepEqual([...ff.STATUSES], ["next", "inbox", "waiting", "someday"]);
  assert.deepEqual([...ff.PRIORITIES], ["P1", "P2", "P3", "P4"]);
  assert.deepEqual([...ff.QUADRANTS], ["Q1", "Q2", "Q3", "Q4"]);
  assert.deepEqual([...ff.QUICK_PRI], ["P1", "P2", "P3"]);
  assert.deepEqual([...ff.QUICK_QUAD], ["Q1", "Q3"]);
});
test("DEFAULT_FILTER: nilai default dan beku sampai ke array di dalamnya", () => {
  assert.deepEqual(ff.DEFAULT_FILTER, { time: "all", status: ["next"], pri: [], quad: [], proj: null });
  assert.ok(Object.isFrozen(ff.DEFAULT_FILTER));
  assert.ok(Object.isFrozen(ff.DEFAULT_FILTER.status));
  assert.ok(Object.isFrozen(ff.DEFAULT_FILTER.pri));
  assert.ok(Object.isFrozen(ff.DEFAULT_FILTER.quad));
});

// ---- timeBucket ----
test("timeBucket: kemarin late, hari ini today (juga dengan jam), besok none", () => {
  assert.equal(ff.timeBucket({ deadline: "2026-10-21" }, TODAY), "late");
  assert.equal(ff.timeBucket({ deadline: "2026-10-22" }, TODAY), "today");
  assert.equal(ff.timeBucket({ deadline: "2026-10-22T10:00" }, TODAY), "today");
  assert.equal(ff.timeBucket({ deadline: "2026-10-23" }, TODAY), "none");
});
test("timeBucket: deadline kosong / tak berbentuk / bukan string → none", () => {
  assert.equal(ff.timeBucket({ deadline: null }, TODAY), "none");
  assert.equal(ff.timeBucket({ deadline: "" }, TODAY), "none");
  assert.equal(ff.timeBucket({ deadline: "22-10-2026" }, TODAY), "none");
  assert.equal(ff.timeBucket({ deadline: 123 }, TODAY), "none");
  assert.equal(ff.timeBucket({}, TODAY), "none");
  assert.equal(ff.timeBucket(null, TODAY), "none");
  assert.equal(ff.timeBucket({ deadline: "2026-10-21" }, undefined), "none");
});
test("timeBucket: done/archived tidak pernah late", () => {
  assert.equal(ff.timeBucket({ deadline: "2026-10-01", gtd_status: "done" }, TODAY), "none");
  assert.equal(ff.timeBucket({ deadline: "2026-10-01", gtd_status: "archived" }, TODAY), "none");
});
test("timeBucket: is_overdue server basi diabaikan (Review Focus 2)", () => {
  assert.equal(ff.timeBucket({ deadline: "2026-10-22", is_overdue: true }, TODAY), "today");
  assert.equal(ff.timeBucket({ deadline: "2026-10-21", is_overdue: false }, TODAY), "late");
});
test("timeBucket: pergantian todayISO menggeser 2026-10-22 menjadi late", () => {
  assert.equal(ff.timeBucket({ deadline: "2026-10-22" }, "2026-10-22"), "today");
  assert.equal(ff.timeBucket({ deadline: "2026-10-22" }, "2026-10-23"), "late");
});

// ---- inTodayScope ----
const base = { id: 1, quadrant: "Q2", deadline: "2026-11-01", gtd_status: "next" };
test("inTodayScope: tiap pemicu benar sendiri-sendiri", () => {
  assert.equal(ff.inTodayScope({ ...base, quadrant: "Q1" }, { todayISO: TODAY }), true);
  assert.equal(ff.inTodayScope({ ...base, deadline: "2026-10-20" }, { todayISO: TODAY }), true);
  assert.equal(ff.inTodayScope({ ...base, deadline: "2026-10-22" }, { todayISO: TODAY }), true);
  assert.equal(ff.inTodayScope({ ...base, is_focused: true }, { todayISO: TODAY }), true);
  assert.equal(ff.inTodayScope({ ...base, id: "7" }, { todayISO: TODAY, focusTaskId: 7 }), true);
  assert.equal(ff.inTodayScope({ ...base, id: 7 }, { todayISO: TODAY, focusTaskId: "7" }), true);
});
test("inTodayScope: tanpa pemicu → false", () => {
  assert.equal(ff.inTodayScope(base, { todayISO: TODAY }), false);
  assert.equal(ff.inTodayScope(base, { todayISO: TODAY, focusTaskId: 2 }), false);
  assert.equal(ff.inTodayScope(base, { todayISO: TODAY, focusTaskId: null }), false);
  assert.equal(ff.inTodayScope(null, { todayISO: TODAY }), false);
});
test("inTodayScope: done keluar kecuali includeDone; archived selalu keluar", () => {
  const done = { ...base, quadrant: "Q1", gtd_status: "done" };
  assert.equal(ff.inTodayScope(done, { todayISO: TODAY }), false);
  assert.equal(ff.inTodayScope(done, { todayISO: TODAY, includeDone: true }), true);
  const arch = { ...base, quadrant: "Q1", is_focused: true, gtd_status: "archived" };
  assert.equal(ff.inTodayScope(arch, { todayISO: TODAY }), false);
  assert.equal(ff.inTodayScope(arch, { todayISO: TODAY, includeDone: true }), false);
});
test("inTodayScope: done ber-deadline hari ini tetap masuk dengan includeDone (Dashboard)", () => {
  const t = { ...base, deadline: "2026-10-22", gtd_status: "done" };
  assert.equal(ff.inTodayScope(t, { todayISO: TODAY }), false);
  assert.equal(ff.inTodayScope(t, { todayISO: TODAY, includeDone: true }), true);
});

// ---- normalizeFilter ----
test("normalizeFilter: bukan objek → salinan default (bukan referensi beku)", () => {
  for (const raw of [null, undefined, "x", 5, true, []]) {
    const f = ff.normalizeFilter(raw);
    assert.deepEqual(f, ff.DEFAULT_FILTER);
    assert.notEqual(f, ff.DEFAULT_FILTER);
    assert.ok(!Object.isFrozen(f));
    assert.ok(!Object.isFrozen(f.status));
    assert.notEqual(f.status, ff.DEFAULT_FILTER.status);
  }
});
test("normalizeFilter: time tak dikenal → all; tiga nilai sah dipertahankan", () => {
  assert.equal(ff.normalizeFilter({ time: "week" }).time, "all");
  assert.equal(ff.normalizeFilter({ time: 1 }).time, "all");
  for (const t of ["all", "today", "late"]) assert.equal(ff.normalizeFilter({ time: t }).time, t);
});
test("normalizeFilter: status — urutan kanonis, tanpa duplikat/tak dikenal", () => {
  assert.deepEqual(ff.normalizeFilter({ status: ["someday", "next", "next", "x"] }).status, ["next", "someday"]);
  assert.deepEqual(ff.normalizeFilter({ status: "next" }).status, ["next"]);
  assert.deepEqual(ff.normalizeFilter({ status: "waiting" }).status, ["next"]);
  assert.deepEqual(ff.normalizeFilter({}).status, ["next"]);
  assert.deepEqual(ff.normalizeFilter({ status: [] }).status, []);
  assert.deepEqual(ff.normalizeFilter({ status: ["x"] }).status, []);
});
test("normalizeFilter: pri dan quad", () => {
  assert.deepEqual(ff.normalizeFilter({ pri: ["P4", "P1", "P9"] }).pri, ["P1", "P4"]);
  assert.deepEqual(ff.normalizeFilter({ pri: ["P2", "P2"] }).pri, ["P2"]);
  assert.deepEqual(ff.normalizeFilter({ quad: "Q1" }).quad, []);
  assert.deepEqual(ff.normalizeFilter({ pri: "P1" }).pri, []);
  assert.deepEqual(ff.normalizeFilter({ quad: ["Q4", "Q1", "Q4", "Q7"] }).quad, ["Q1", "Q4"]);
});
test("normalizeFilter: proj — dipertahankan, label dipotong, bentuk lain → null", () => {
  assert.deepEqual(ff.normalizeFilter({ proj: { key: "p:a", label: "Pribadi · A" } }).proj,
    { key: "p:a", label: "Pribadi · A" });
  assert.equal(ff.normalizeFilter({ proj: { key: "" } }).proj, null);
  assert.equal(ff.normalizeFilter({ proj: { key: "k".repeat(301) } }).proj, null);
  assert.equal(ff.normalizeFilter({ proj: { key: 5 } }).proj, null);
  assert.equal(ff.normalizeFilter({ proj: "p:a" }).proj, null);
  assert.equal(ff.normalizeFilter({ proj: ["p:a"] }).proj, null);
  assert.equal(ff.normalizeFilter({ proj: null }).proj, null);
  assert.equal(ff.normalizeFilter({ proj: { key: "k".repeat(300), label: "x" } }).proj.key.length, 300);
  assert.equal(ff.normalizeFilter({ proj: { key: "p:a", label: "L".repeat(200) } }).proj.label.length, 120);
  assert.equal(ff.normalizeFilter({ proj: { key: "p:a" } }).proj.label, "");
  assert.equal(ff.normalizeFilter({ proj: { key: "p:a", label: 9 } }).proj.label, "");
});
test("normalizeFilter: idempoten dan tidak mengubah masukan", () => {
  const raw = { time: "late", status: ["waiting", "next"], pri: ["P4"], quad: ["Q2"], proj: { key: "p:a", label: "A" } };
  const snap = JSON.stringify(raw);
  const once = ff.normalizeFilter(raw);
  assert.equal(JSON.stringify(raw), snap);
  assert.deepEqual(ff.normalizeFilter(once), once);
});

// ---- isDefaultStatus / nonDefaultCount / isFilterDefault ----
test("isDefaultStatus: hanya [next]", () => {
  assert.equal(ff.isDefaultStatus(["next"]), true);
  assert.equal(ff.isDefaultStatus([]), false);
  assert.equal(ff.isDefaultStatus(["next", "inbox"]), false);
  assert.equal(ff.isDefaultStatus(["inbox"]), false);
  assert.equal(ff.isDefaultStatus("next"), false);
  assert.equal(ff.isDefaultStatus(null), false);
});
test("nonDefaultCount: default 0", () => {
  assert.equal(ff.nonDefaultCount(ff.DEFAULT_FILTER), 0);
  assert.equal(ff.nonDefaultCount(null), 0);
});
test("nonDefaultCount: status ≠ [next] dihitung 1 berapa pun isinya", () => {
  assert.equal(ff.nonDefaultCount({ ...ff.DEFAULT_FILTER, status: ["next", "waiting"] }), 1);
  assert.equal(ff.nonDefaultCount({ ...ff.DEFAULT_FILTER, status: [] }), 1);
  assert.equal(ff.nonDefaultCount({ ...ff.DEFAULT_FILTER, status: ["inbox", "waiting", "someday"] }), 1);
});
test("nonDefaultCount: proj, P4, Q2/Q4 dihitung; chip cepat dan time tidak", () => {
  assert.equal(ff.nonDefaultCount({ ...ff.DEFAULT_FILTER, proj: { key: "p:a", label: "A" } }), 1);
  assert.equal(ff.nonDefaultCount({ ...ff.DEFAULT_FILTER, pri: ["P1", "P4"] }), 1);
  assert.equal(ff.nonDefaultCount({ ...ff.DEFAULT_FILTER, pri: ["P1", "P2", "P3"] }), 0);
  assert.equal(ff.nonDefaultCount({ ...ff.DEFAULT_FILTER, quad: ["Q2", "Q4", "Q1"] }), 2);
  assert.equal(ff.nonDefaultCount({ ...ff.DEFAULT_FILTER, quad: ["Q1", "Q3"] }), 0);
  assert.equal(ff.nonDefaultCount({ ...ff.DEFAULT_FILTER, time: "late" }), 0);
  assert.equal(ff.nonDefaultCount({ time: "today", status: [], pri: ["P4"], quad: ["Q2", "Q4"], proj: { key: "p:a" } }), 5);
});
test("isFilterDefault: default true; satu field berbeda → false", () => {
  assert.equal(ff.isFilterDefault(ff.DEFAULT_FILTER), true);
  assert.equal(ff.isFilterDefault(ff.normalizeFilter(null)), true);
  assert.equal(ff.isFilterDefault({ ...ff.DEFAULT_FILTER, time: "late" }), false);
  assert.equal(ff.isFilterDefault({ ...ff.DEFAULT_FILTER, status: [] }), false);
  assert.equal(ff.isFilterDefault({ ...ff.DEFAULT_FILTER, pri: ["P1"] }), false);
  assert.equal(ff.isFilterDefault({ ...ff.DEFAULT_FILTER, quad: ["Q1"] }), false);
  assert.equal(ff.isFilterDefault({ ...ff.DEFAULT_FILTER, proj: { key: "p:a", label: "" } }), false);
});

// ---- penyimpanan filter ----
test("readFilter: storage kosong → default (objek baru)", () => {
  const f = ff.readFilter(fakeStorage());
  assert.deepEqual(f, ff.DEFAULT_FILTER);
  assert.ok(!Object.isFrozen(f));
});
test("writeFilter lalu readFilter → sama; yang tersimpan sudah ternormalisasi", () => {
  const st = fakeStorage();
  const f = { time: "late", status: ["waiting", "next"], pri: ["P1", "P4"], quad: ["Q2"], proj: { key: "p:a", label: "Pribadi · A" } };
  ff.writeFilter(st, f);
  assert.deepEqual(JSON.parse(st.m.get("tf_focus_filter")), ff.normalizeFilter(f));
  assert.deepEqual(ff.readFilter(st), ff.normalizeFilter(f));
});
test("readFilter: JSON rusak / bentuk salah → default", () => {
  assert.deepEqual(ff.readFilter(fakeStorage({ tf_focus_filter: "{rusak" })), ff.DEFAULT_FILTER);
  assert.deepEqual(ff.readFilter(fakeStorage({ tf_focus_filter: "null" })), ff.DEFAULT_FILTER);
  assert.deepEqual(ff.readFilter(fakeStorage({ tf_focus_filter: "[1,2]" })), ff.DEFAULT_FILTER);
  assert.deepEqual(ff.readFilter(fakeStorage({ tf_focus_filter: "" })), ff.DEFAULT_FILTER);
});
test("readFilter: nilai tersimpan yang sebagian rusak dinormalisasi", () => {
  const st = fakeStorage({ tf_focus_filter: JSON.stringify({ time: "week", status: ["someday", "x"], pri: ["P9"] }) });
  assert.deepEqual(ff.readFilter(st), { time: "all", status: ["someday"], pri: [], quad: [], proj: null });
});
test("filter: getItem/setItem melempar atau storage null/undefined → tidak melempar", () => {
  assert.deepEqual(ff.readFilter(throwing), ff.DEFAULT_FILTER);
  assert.doesNotThrow(() => ff.writeFilter(throwing, ff.DEFAULT_FILTER));
  assert.deepEqual(ff.readFilter(null), ff.DEFAULT_FILTER);
  assert.deepEqual(ff.readFilter(undefined), ff.DEFAULT_FILTER);
  assert.doesNotThrow(() => ff.writeFilter(null, ff.DEFAULT_FILTER));
  assert.doesNotThrow(() => ff.writeFilter(undefined, ff.DEFAULT_FILTER));
});

// ---- penyimpanan kelompok terlipat ----
test("readCollapsed: kosong → []; bukan array → []; JSON rusak → []", () => {
  assert.deepEqual(ff.readCollapsed(fakeStorage()), []);
  assert.deepEqual(ff.readCollapsed(fakeStorage({ tf_focus_collapsed: "{\"a\":1}" })), []);
  assert.deepEqual(ff.readCollapsed(fakeStorage({ tf_focus_collapsed: "[rusak" })), []);
});
test("readCollapsed: hanya string, tanpa duplikat", () => {
  assert.deepEqual(ff.readCollapsed(fakeStorage({ tf_focus_collapsed: "[1,{},\"p:a\",\"p:a\"]" })), ["p:a"]);
  assert.deepEqual(ff.readCollapsed(fakeStorage({ tf_focus_collapsed: "[1,{}]" })), []);
});
test("writeCollapsed lalu readCollapsed → sama (urutan terjaga)", () => {
  const st = fakeStorage();
  ff.writeCollapsed(st, ["p:a", "12:b", "p:a", 3, null]);
  assert.deepEqual(JSON.parse(st.m.get("tf_focus_collapsed")), ["p:a", "12:b"]);
  assert.deepEqual(ff.readCollapsed(st), ["p:a", "12:b"]);
});
test("writeCollapsed: 250 kunci → tersimpan 200 terakhir", () => {
  const st = fakeStorage();
  const keys = Array.from({ length: 250 }, (_, i) => "k" + i);
  ff.writeCollapsed(st, keys);
  const saved = JSON.parse(st.m.get("tf_focus_collapsed"));
  assert.equal(saved.length, 200);
  assert.equal(saved[0], "k50");
  assert.equal(saved[199], "k249");
});
test("readCollapsed: nilai tersimpan >200 dipangkas ke 200 terakhir", () => {
  const keys = Array.from({ length: 230 }, (_, i) => "k" + i);
  const r = ff.readCollapsed(fakeStorage({ tf_focus_collapsed: JSON.stringify(keys) }));
  assert.equal(r.length, 200);
  assert.equal(r[0], "k30");
});
test("collapsed: storage melempar / null / masukan bukan array → tidak melempar", () => {
  assert.deepEqual(ff.readCollapsed(throwing), []);
  assert.doesNotThrow(() => ff.writeCollapsed(throwing, ["p:a"]));
  assert.deepEqual(ff.readCollapsed(null), []);
  assert.doesNotThrow(() => ff.writeCollapsed(null, ["p:a"]));
  const st = fakeStorage();
  assert.doesNotThrow(() => ff.writeCollapsed(st, "p:a"));
  assert.deepEqual(ff.readCollapsed(st), []);
});

// ---- sumber ----
test("index.html memuat focusfilter.js tepat setelah tasklogic.js", () => {
  const a = indexHtml.indexOf('<script src="/static/offline/tasklogic.js"></script>');
  const b = indexHtml.indexOf('<script src="/static/offline/focusfilter.js"></script>');
  assert.ok(a >= 0 && b > a);
  assert.equal(indexHtml.slice(a, b).split("\n").length, 2, "tidak ada tag lain di antara keduanya");
});
test("sw.js memuat focusfilter.js di STATIC setelah tasklogic.js", () => {
  const a = swJs.indexOf('"/static/offline/tasklogic.js"');
  const b = swJs.indexOf('"/static/offline/focusfilter.js"');
  assert.ok(a >= 0 && b > a);
  const block = /const STATIC = \[([\s\S]*?)\n\];/.exec(swJs)[1];
  assert.ok(block.includes('"/static/offline/focusfilter.js"'));
});
