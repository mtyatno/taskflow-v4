"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const fp = require("../../static/offline/focuspage.js");
const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const swJs = fs.readFileSync(path.resolve(__dirname, "../../static/sw.js"), "utf8").replace(/\r\n/g, "\n");

test("parkPayload: trim + inbox P2 tanpa deadline", () => {
  assert.deepEqual(fp.parkPayload("  telepon Budi  "),
    { title: "telepon Budi", gtd_status: "inbox", priority: "P2", deadline: null });
});
test("parkPayload: kosong/spasi → null", () => {
  assert.equal(fp.parkPayload(""), null); assert.equal(fp.parkPayload("   \n "), null);
  assert.equal(fp.parkPayload(null), null);
});
test("parkPayload: dipotong 200", () => { assert.equal(fp.parkPayload("x".repeat(250)).title.length, 200); });
test("zenActive hanya saat enabled + work + running", () => {
  assert.equal(fp.zenActive({ enabled: true, mode: "work", isRunning: true }), true);
  assert.equal(fp.zenActive({ enabled: false, mode: "work", isRunning: true }), false);
  assert.equal(fp.zenActive({ enabled: true, mode: "shortBreak", isRunning: true }), false);
  assert.equal(fp.zenActive({ enabled: true, mode: "longBreak", isRunning: true }), false);
  assert.equal(fp.zenActive({ enabled: true, mode: "work", isRunning: false }), false);
});
test("pref Zen: default mati, baca/tulis, storage melempar", () => {
  const m = new Map(); const st = { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
  assert.equal(fp.readZenPref(st), false);
  fp.writeZenPref(st, true); assert.equal(m.get("tf_focus_zen"), "1"); assert.equal(fp.readZenPref(st), true);
  fp.writeZenPref(st, false); assert.equal(fp.readZenPref(st), false);
  const bad = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); } };
  assert.equal(fp.readZenPref(bad), false); assert.doesNotThrow(() => fp.writeZenPref(bad, true));
  assert.equal(fp.readZenPref(undefined), false);
});
test("konstanta", () => { assert.equal(fp.ZEN_KEY, "tf_focus_zen"); assert.equal(fp.PARK_MAX, 200); });
test("index.html memuat focuspage.js setelah introgate.js", () => {
  const a = indexHtml.indexOf('src="/static/offline/introgate.js"');
  const b = indexHtml.indexOf('src="/static/offline/focuspage.js"');
  assert.ok(a >= 0 && b > a);
});
test("sw.js memuat focuspage.js di STATIC", () => {
  assert.ok(swJs.includes('"/static/offline/focuspage.js"'));
});
