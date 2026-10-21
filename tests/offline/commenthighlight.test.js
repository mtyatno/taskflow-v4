"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const hl = require("../../static/offline/commenthighlight.js");

const SEG = [{ node: "A", start: 0, end: 5 }, { node: "B", start: 5, end: 12 }];

test("locate lintas segmen", () => {
  assert.deepEqual(hl.locate(SEG, 2, 9), { startNode: "A", startOffset: 2, endNode: "B", endOffset: 4 });
});
test("locate batas tepat", () => {
  assert.deepEqual(hl.locate(SEG, 5, 12), { startNode: "B", startOffset: 0, endNode: "B", endOffset: 7 });
  assert.deepEqual(hl.locate(SEG, 0, 5), { startNode: "A", startOffset: 0, endNode: "A", endOffset: 5 });
});
test("locate di luar rentang -> null", () => {
  assert.equal(hl.locate(SEG, 12, 14), null);
  assert.equal(hl.locate(SEG, 3, 20), null);
  assert.equal(hl.locate(SEG, 4, 4), null);
  assert.equal(hl.locate([], 0, 1), null);
});
test("supported false di node; apply/clear tidak melempar", () => {
  assert.equal(hl.supported(), false);
  assert.deepEqual(hl.apply(null, [{ id: 1, quote: "x" }], 1), []);
  hl.clear();
});
test("apply dengan dukungan palsu: set cmt & cmt-active, hapus bila kosong", () => {
  const store = new Map();
  global.CSS = { highlights: store };
  global.Highlight = class { constructor(...r) { this.ranges = r; } };
  const ranges = [{ id: "a" }, { id: "b" }];
  const origRanges = hl.rangesFor;
  try {
    assert.equal(hl.supported(), true);
    // root null -> rangesFor melempar/kosong -> [] dan key terhapus
    store.set("cmt", 1); store.set("cmt-active", 1);
    assert.deepEqual(hl.apply(null, [], null), []);
    assert.equal(store.has("cmt"), false);
    assert.equal(store.has("cmt-active"), false);
    // doc palsu lewat root.ownerDocument
    const textNode = { nodeValue: "halo dunia" };
    const doc = {
      createTreeWalker() { let done = false; return { nextNode() { if (done) return null; done = true; return textNode; } }; },
      createRange() { return { setStart() {}, setEnd() {} }; },
    };
    global.NodeFilter = { SHOW_TEXT: 4 };
    textNode.parentElement = { closest: () => null };
    const rootEl = { ownerDocument: doc };
    const out = hl.apply(rootEl, [{ id: "a", quote: "halo" }, { id: "b", quote: "dunia" }], "b");
    assert.equal(out.length, 2);
    assert.equal(store.get("cmt").ranges.length, 1);
    assert.equal(store.get("cmt-active").ranges.length, 1);
  } finally {
    delete global.CSS; delete global.Highlight; delete global.NodeFilter;
  }
  void ranges; void origRanges;
});
test("threadAt", () => {
  const e = [
    { id: 1, range: { isPointInRange: (n, o) => n === "x" && o < 3 } },
    { id: 2, range: { isPointInRange: () => true } },
  ];
  assert.equal(hl.threadAt(e, "x", 1), 1);
  assert.equal(hl.threadAt(e, "x", 5), 2);
  assert.equal(hl.threadAt([{ id: 3, range: { isPointInRange: () => { throw new Error("x"); } } }], "x", 0), null);
  assert.equal(hl.threadAt([], "x", 0), null);
  assert.equal(hl.threadAt(null, "x", 0), null);
});
