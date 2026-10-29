"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resolveApiBase } = require("../../static/config.js");

test("web hosts resolve to empty base (same-origin)", () => {
  assert.equal(resolveApiBase("alurik.com"), "");
  assert.equal(resolveApiBase("www.alurik.com"), "");
  assert.equal(resolveApiBase("todo.yatno.web.id"), "");
  assert.equal(resolveApiBase("localhost"), "");
  assert.equal(resolveApiBase("127.0.0.1"), "");
});

test("non-web hosts (Tauri webview) resolve to the VPS base", () => {
  assert.equal(resolveApiBase("tauri.localhost"), "https://alurik.com");
  assert.equal(resolveApiBase(""), "https://alurik.com");
  assert.equal(resolveApiBase("anything-else"), "https://alurik.com");
});
