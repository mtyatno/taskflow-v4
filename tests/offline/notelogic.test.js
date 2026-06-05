"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseWikilinks } = require("../../static/offline/notelogic.js");

test("parseWikilinks extracts plain [[Title]] refs", () => {
  assert.deepEqual(parseWikilinks("see [[Alpha]] and [[Beta]]"), ["Alpha", "Beta"]);
});

test("parseWikilinks handles remark-escaped \\[\\[Title\\]\\]", () => {
  assert.deepEqual(parseWikilinks("ref \\[\\[Gamma\\]\\] here"), ["Gamma"]);
});

test("parseWikilinks takes the part before | in [[Title|alias]]", () => {
  assert.deepEqual(parseWikilinks("[[Delta|see this]]"), ["Delta"]);
});

test("parseWikilinks de-dupes and drops empty, preserving first-seen order", () => {
  assert.deepEqual(parseWikilinks("[[A]] [[A]] [[B]] [[ ]]"), ["A", "B"]);
});

test("parseWikilinks returns [] for no links / empty content", () => {
  assert.deepEqual(parseWikilinks(""), []);
  assert.deepEqual(parseWikilinks("plain text"), []);
});
