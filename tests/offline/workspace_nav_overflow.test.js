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

// Permintaan pemilik 2026-10-28: di HP baris tombol workspace diganti satu dropdown.
const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
function fnSource(name) {
  const start = indexHtml.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, name + " ada");
  return indexHtml.slice(start, indexHtml.indexOf("\n}\n", start + 1) + 2);
}
test("HP: dropdown workspace menggantikan baris tombol (≤ 640 px)", () => {
  const m = fnSource("WorkspaceNavMobileMenu");
  for (const re of [/React\.createElement\(DetailPopover/, /role: "menu"/, /"aria-haspopup": "menu"/, /"Kelola project"/, /"Kelola tahap"/,
    /"Lepas pin dari sidebar"/, /"Pin ke sidebar"/, /WORKSPACE_PIN_FULL_TEXT/, /onTab\("files"\)/]) assert.match(m, re);
  assert.match(indexHtml, /React\.createElement\(WorkspaceNavMobileMenu, \{[\s\S]{0,200}workspaceTab: workspaceTab,/);
  assert.match(appCss, /\.workspace-nav-mobile\s*\{\s*display:\s*none;\s*\}/);
  assert.match(appCss, /@media \(max-width: 640px\)\s*\{\s*\.workspace-nav-tabs\s*\{\s*display:\s*none !important;\s*\}\s*\.workspace-nav-mobile\s*\{\s*display:\s*flex;/);
});
