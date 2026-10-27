"use strict";
// Bug 2026-10-28: di HP baris tombol halaman workspace meluber, halaman jadi lebih lebar dari layar dan modal detail task
// tampil terpotong/bergeser hanya di halaman workspace. Baris itu kini digulir ke samping.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const appCss = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8").replace(/\r\n/g, "\n");

test("baris workspace-nav-tabs digulir ke samping, tidak meluber", () => {
  const rule = appCss.match(/\.workspace-nav-tabs\s*\{[^}]*\}/);
  assert.ok(rule, "aturan .workspace-nav-tabs ada");
  assert.match(rule[0], /overflow-x:\s*auto/);
  assert.match(rule[0], /flex-wrap:\s*nowrap/);
  assert.match(appCss, /\.workspace-nav-tabs > \*\s*\{[^}]*flex-shrink:\s*0/);
});
