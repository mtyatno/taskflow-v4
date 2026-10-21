"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { findQuote, normalize } = require("../../static/offline/commentanchor.js");

test("cocok persis", () => {
  assert.deepEqual(findQuote("abc Rilis beta 4 Nov", "Rilis beta"), { from: 4, to: 14 });
});
test("kemunculan pertama", () => {
  assert.deepEqual(findQuote("x a x a", "a"), { from: 2, to: 3 });
});
test("whitespace dinormalkan", () => {
  assert.deepEqual(findQuote("Rilis   beta\ndijadwalkan", "Rilis beta dijadwalkan"), { from: 0, to: 24 });
});
test("kutip lengkung dinormalkan", () => {
  assert.deepEqual(findQuote("Ia bilang “halo” tadi", 'bilang "halo"'), { from: 3, to: 16 });
});
test("trim dan kosong", () => {
  assert.equal(findQuote("abc", "  "), null);
  assert.deepEqual(findQuote("abc", " b "), { from: 1, to: 2 });
});
test("tidak ketemu", () => {
  assert.equal(findQuote("abc", "xyz"), null);
});
test("normalize memetakan indeks asli", () => {
  const r = normalize("a  b");
  assert.equal(r.text, "a b");
  assert.deepEqual(r.map, [0, 1, 3]);
});
