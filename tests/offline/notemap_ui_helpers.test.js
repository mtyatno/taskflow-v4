"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const NM = require("../../static/offline/notemap.js");

test("plain text and locate with occurrences", () => {
  assert.equal(NM.plainHeadingText("**Bold** [[Note X]] `code` [t](u) ==s=="), "Bold Note X code t s");
  assert.deepEqual(NM.locateHeading(NM.parseNote("# A\n# A\n"), "s1"), { index: 1, text: "A", occurrence: 1 });
  assert.equal(NM.locateHeading(NM.parseNote("# A\n"), null), null);
});
test("matchHeading: index first, then occurrence, else -1", () => {
  const list = [{ text: "Intro" }, { text: "A" }, { text: "A" }];
  assert.equal(NM.matchHeading(list, { index: 1, text: "a", occurrence: 0 }), 1);
  assert.equal(NM.matchHeading(list, { index: 9, text: "A", occurrence: 1 }), 2);
  assert.equal(NM.matchHeading(list, { index: 0, text: "Tidak ada", occurrence: 0 }), -1);
});
test("renderTopicNoteInline uses note rules and stays safe", () => {
  assert.match(NM.renderTopicNoteInline("==sorot=="), /<mark>sorot<\/mark>/);
  assert.match(NM.renderTopicNoteInline("__tebal__"), /<strong>tebal<\/strong>/);
  const x = NM.renderTopicNoteInline("<img src=x onerror=alert(1)> [x](javascript:alert(1)) [[Catatan]]");
  assert.ok(!x.includes("<img")); assert.match(x, /href="#"/); assert.match(x, /Catatan/); assert.ok(!x.includes("[["));
});
test("renderSummaryHtml escapes and formats", () => {
  const h = NM.renderSummaryHtml({ excerpt: "<b>x</b>", items: ["a", "b"], more: 2, counts: { checkDone: 1, checkTotal: 3, images: 2, tables: 0 } });
  assert.ok(!h.includes("<b>")); assert.match(h, /• a • b \+2/); assert.match(h, /☑ 1\/3 · 🖼 2/); assert.ok(!h.includes("⊞"));
  assert.equal(NM.renderSummaryHtml(null), "");
});
