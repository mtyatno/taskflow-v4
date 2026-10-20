"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const wp = require("../../static/offline/workspacepins.js");

test("pinnedForRail sorts by pin_position and caps at 5", () => {
  const lists = [
    { id: 1, pinned: true, pin_position: 3 },
    { id: 2, pinned: false, pin_position: null },
    { id: 3, pinned: true, pin_position: 0 },
    { id: 4, pinned: true, pin_position: 4 },
    { id: 5, pinned: true, pin_position: 1 },
    { id: 6, pinned: true, pin_position: 2 },
    { id: 7, pinned: true, pin_position: 5 },
  ];
  const out = wp.pinnedForRail(lists);
  assert.equal(out.length, 5);
  assert.deepEqual(out.map((l) => l.pin_position), [0, 1, 2, 3, 4]);
});

test("pinnedForRail ignores unpinned and missing field", () => {
  assert.deepEqual(wp.pinnedForRail([{ id: 1 }, { id: 2, pinned: false }, { id: 3, pinned: true, pin_position: 0 }]).map((l) => l.id), [3]);
});

test("pinnedForRail(null) -> []", () => {
  assert.deepEqual(wp.pinnedForRail(null), []);
  assert.deepEqual(wp.pinnedForRail(undefined), []);
});

test("pinnedForRail accepts string ids and breaks ties by String(id)", () => {
  const out = wp.pinnedForRail([
    { id: "c_b", pinned: true, pin_position: 1 },
    { id: "c_a", pinned: true, pin_position: 1 },
  ]);
  assert.deepEqual(out.map((l) => l.id), ["c_a", "c_b"]);
});

test("avatarInitial handles emoji, leading spaces, empty", () => {
  assert.equal(wp.avatarInitial("  jatahku"), "J");
  assert.equal(wp.avatarInitial("🚀 Tim"), "🚀");
  assert.equal(wp.avatarInitial(""), "?");
  assert.equal(wp.avatarInitial(null), "?");
  assert.equal(wp.avatarInitial("   "), "?");
});

test("avatarColorIndex is deterministic and accepts cid strings", () => {
  for (const id of [5, -3, "c_abc123"]) {
    const a = wp.avatarColorIndex(id);
    assert.equal(a, wp.avatarColorIndex(id));
    assert.ok(Number.isInteger(a) && a >= 0 && a <= 7);
  }
  assert.equal(wp.avatarColorIndex(5), 5);
  assert.equal(wp.avatarColorIndex(-3), 3);
});

test("canPinMore", () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: i, pinned: true }));
  assert.equal(wp.canPinMore(mk(4)), true);
  assert.equal(wp.canPinMore(mk(5)), false);
  assert.equal(wp.canPinMore(null), true);
});

test("applyPinChange returns new array with only the target changed", () => {
  const a = { id: 1, pinned: false, pin_position: null };
  const b = { id: "c_x", pinned: false, pin_position: null };
  const lists = [a, b];
  const out = wp.applyPinChange(lists, 1, true, 2);
  assert.notEqual(out, lists);
  assert.equal(out[0].pinned, true);
  assert.equal(out[0].pin_position, 2);
  assert.equal(out[1], b);
  assert.equal(a.pinned, false);
  assert.equal(wp.PIN_LIMIT, 5);
});
