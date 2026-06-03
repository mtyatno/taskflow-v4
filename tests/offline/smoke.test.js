"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./setup.js");

test("fake-indexeddb global is available", () => {
  assert.equal(typeof indexedDB, "object");
  assert.equal(typeof indexedDB.open, "function");
});

test("crypto.randomUUID is available in Node", () => {
  assert.equal(typeof crypto.randomUUID, "function");
});
