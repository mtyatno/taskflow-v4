"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const iframe = fs.readFileSync(path.join(__dirname, "../../static/vendor/mind-elixir/index.html"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");
function slice(src, a, b) {
  const s = src.indexOf(a); assert.ok(s !== -1, a + " harus ada");
  const e = src.indexOf(b, s + a.length); assert.ok(e !== -1, b + " harus ada setelah " + a);
  return src.slice(s, e);
}

test("iframe loads mindmaplinks.js and renders cards through linkDisplay", () => {
  assert.match(iframe, /<script src="\/static\/offline\/mindmaplinks\.js\?v=\d+"><\/script>/);
  assert.match(slice(iframe, "function renderPanel(", "function removeLinkAtIndex"), /mindmaplinks\.linkDisplay\(/);
  assert.match(slice(iframe, "function showNodeLinksPopover(", "function updateBadges"), /mindmaplinks\.linkDisplay\(/);
  assert.match(iframe, /\.lp-stale\s*\{/);
  assert.match(slice(iframe, "e.data.type === 'linkInfo'", "\n      }"), /liveLinkInfo = /);
});

test("MindmapTabInstance resolves link info from local data and posts it", () => {
  const t = slice(html, "function MindmapTabInstance(", "\nconst MINDMAP_DIRECTIONS");
  assert.match(t, /mindmaplinks\.resolveLinkInfo\(/);
  assert.match(t, /type: "linkInfo"/);
  for (const ev of ["taskSaved", "taskUpdated", "noteSaved", "mindmapSaved", "mindmapSynced"]) {
    assert.match(t, new RegExp('addEventListener\\("' + ev + '", refreshLinkInfo'));
  }
  assert.match(t, /linkInfo: linkInfo/);
});

test("link info also refreshes on sync-pulled task changes and skips unchanged info", () => {
  const t = slice(html, "function MindmapTabInstance(", "\nconst MINDMAP_DIRECTIONS");
  assert.match(t, /addEventListener\("tf:projects-changed", refreshLinkInfo/);
  assert.match(t, /removeEventListener\("tf:projects-changed", refreshLinkInfo/);
  const r = slice(t, "const refreshLinkInfo = ", "const linkRefsML");
  assert.match(r, /JSON\.stringify\(info\) === JSON\.stringify\(linkInfoRef\.current\)/);
  assert.ok(r.indexOf("JSON.stringify(info)") < r.indexOf("setLinkInfo(info)"));
  assert.ok(r.indexOf("JSON.stringify(info)") < r.indexOf('type: "linkInfo"'));
});

test("MindmapOutline renders link titles via linkDisplay", () => {
  const o = slice(html, "function MindmapOutline(", "\nfunction MindmapTabInstance(");
  assert.match(o, /linkInfo = \{\}/);
  assert.match(o, /mindmaplinks\.linkDisplay\(/);
});
