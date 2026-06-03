"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { newCid } = require("../../static/offline/ids.js");

test("newCid returns a v4 UUID string", () => {
  const id = newCid();
  assert.equal(typeof id, "string");
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("newCid is unique across many calls", () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(newCid());
  assert.equal(seen.size, 1000);
});
