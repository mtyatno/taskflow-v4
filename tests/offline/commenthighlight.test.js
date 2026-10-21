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

// ── I-1: pemisah blok virtual "\n" di collectSegments ──
const BLOCK_SEL = "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th, div";
function fakeDom(spec, rootEl) {
  // spec: [{ text, block, skip }] — block = objek blok (atau null), skip = di dalam elemen SKIP.
  const nodes = spec.map((s) => ({
    nodeValue: s.text,
    parentElement: {
      closest(sel) {
        if (sel === BLOCK_SEL) return s.block || null;
        return s.skip ? {} : null;
      },
    },
  }));
  const blocks = new Set(spec.map((s) => s.block).filter(Boolean));
  rootEl.contains = (el) => blocks.has(el) && !(el && el.outside);
  rootEl.ownerDocument = {
    createTreeWalker() { let i = 0; return { nextNode() { return i < nodes.length ? nodes[i++] : null; } }; },
  };
  return nodes;
}

test("collectSegments: blok berbeda → \\n virtual tanpa segmen, offset segmen konsisten", () => {
  global.NodeFilter = { SHOW_TEXT: 4 };
  try {
    const p1 = { tag: "p1" }, p2 = { tag: "p2" };
    const rootEl = {};
    const nodes = fakeDom([
      { text: "alpha ", block: p1 },
      { text: "one", block: p1 },
      { text: "beta two", block: p2 },
    ], rootEl);
    const { text, segments } = hl.collectSegments(rootEl);
    assert.equal(text, "alpha one\nbeta two");
    assert.equal(segments.length, 3);
    assert.deepEqual(segments.map((s) => [s.start, s.end]), [[0, 6], [6, 9], [10, 18]]);
    for (const s of segments) assert.equal(text.slice(s.start, s.end), s.node.nodeValue);
    assert.equal(segments[2].node, nodes[2]);
    // findQuote lintas paragraf menemukan "one beta" dan locate memetakan ke dua node
    const anchor = require("../../static/offline/commentanchor.js");
    const hit = anchor.findQuote(text, "one beta");
    assert.ok(hit, "kutipan lintas paragraf harus ketemu");
    const loc = hl.locate(segments, hit.from, hit.to);
    assert.ok(loc);
    assert.equal(loc.startNode, nodes[1]);
    assert.equal(loc.startOffset, 0);
    assert.equal(loc.endNode, nodes[2]);
    assert.equal(loc.endOffset, 4);
  } finally { delete global.NodeFilter; }
});

test("collectSegments: blok sama tanpa pemisah; node SKIP dilewati; blok di luar root = tanpa blok", () => {
  global.NodeFilter = { SHOW_TEXT: 4 };
  try {
    const p1 = { tag: "p1" }, outer = { tag: "outer", outside: true };
    const rootEl = {};
    fakeDom([
      { text: "a", block: outer },
      { text: "b", block: outer },
      { text: "x", block: p1, skip: true },
      { text: "c", block: p1 },
      { text: "d", block: p1 },
    ], rootEl);
    const { text, segments } = hl.collectSegments(rootEl);
    // outer di luar root → null untuk a & b (sama) ; c masuk p1 → satu pemisah; x dilewati
    assert.equal(text, "ab\ncd");
    assert.equal(segments.length, 4);
    for (const s of segments) assert.equal(text.slice(s.start, s.end), s.node.nodeValue);
  } finally { delete global.NodeFilter; }
});
