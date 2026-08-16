"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const MO = require("../../static/offline/mindmapoutline.js");

const fixture = () => ({
  id: "root",
  topic: "Root",
  root: true,
  children: [
    {
      id: "a",
      topic: "Alpha",
      expanded: true,
      links: [{ type: "note", id: 1, title: "N" }],
      children: [{ id: "a1", topic: "A-one", x: "custom", children: [] }],
    },
    { id: "b", topic: "Beta", children: [] },
    { id: "c", topic: "Gamma", expanded: false, children: [{ id: "c1", topic: "C-one", children: [] }] },
  ],
});

const ids = (n) => [n.id, ...(n.children || []).flatMap(ids)].sort();

test("findNode returns node, parent, index; null when missing", () => {
  const t = fixture();
  const a1 = MO.findNode(t, "a1");
  assert.equal(a1.node.id, "a1");
  assert.equal(a1.parent.id, "a");
  assert.equal(a1.index, 0);
  const root = MO.findNode(t, "root");
  assert.equal(root.parent, null);
  assert.equal(root.index, -1);
  assert.equal(MO.findNode(t, "zzz"), null);
});

test("addChild appends node, auto-expands parent, returns fresh id", () => {
  const res = MO.addChild(fixture(), "b", "Baru");
  assert.notEqual(res.id, "b");
  assert.notEqual(res.id, "root");
  const b = MO.findNode(res.tree, "b").node;
  assert.equal(b.children.length, 1);
  assert.equal(b.children[0].topic, "Baru");
  assert.equal(b.children[0].id, res.id);
  assert.equal(b.expanded, true);
});

test("addSibling inserts before/after; root target appends child instead", () => {
  const after = MO.addSibling(fixture(), "a", true);
  assert.deepEqual(after.tree.children.map((c) => c.id), ["a", after.id, "b", "c"]);
  const before = MO.addSibling(fixture(), "a", false);
  assert.deepEqual(before.tree.children.map((c) => c.id), [before.id, "a", "b", "c"]);
  const atRoot = MO.addSibling(fixture(), "root", true);
  assert.equal(atRoot.tree.children[atRoot.tree.children.length - 1].id, atRoot.id);
});

test("renameNode changes topic and preserves all other fields", () => {
  const t = fixture();
  const res = MO.renameNode(t, "b", "Beta baru");
  assert.equal(MO.findNode(res, "b").node.topic, "Beta baru");
  assert.deepEqual(MO.findNode(res, "a").node.links, [{ type: "note", id: 1, title: "N" }]);
  assert.equal(MO.findNode(res, "c").node.expanded, false);
  assert.equal(MO.findNode(res, "a1").node.x, "custom");
});

test("deleteNode removes node; root is protected", () => {
  const res = MO.deleteNode(fixture(), "a1");
  assert.deepEqual(MO.findNode(res, "a").node.children, []);
  assert.equal(MO.findNode(res, "a1"), null);
  const rootDel = MO.deleteNode(fixture(), "root");
  assert.deepEqual(rootDel, fixture());
});

test("duplicateNode clones sibling after original; root duplicates as first child", () => {
  const t = fixture();
  const res = MO.duplicateNode(t, "a");
  assert.deepEqual(res.tree.children.map((c) => c.id), ["a", res.id, "b", "c"]);
  const copy = MO.findNode(res.tree, res.id).node;
  assert.equal(copy.topic, "Alpha");
  assert.equal(copy.id, res.id);
  assert.notEqual(copy.children[0].id, "a1"); // fresh ids recursively
  assert.deepEqual(copy.links, [{ type: "note", id: 1, title: "N" }]);
  assert.notEqual(copy.root, true);
  const rootDup = MO.duplicateNode(t, "root");
  assert.equal(rootDup.tree.children[0].id, rootDup.id);
  assert.equal(rootDup.tree.children[0].topic, "Root");
});

test("moveNode swaps with adjacent sibling; boundaries no-op", () => {
  const up = MO.moveNode(fixture(), "b", "up");
  assert.deepEqual(up.children.map((c) => c.id), ["b", "a", "c"]);
  const down = MO.moveNode(fixture(), "b", "down");
  assert.deepEqual(down.children.map((c) => c.id), ["a", "c", "b"]);
  assert.deepEqual(MO.moveNode(fixture(), "a", "up"), fixture());
  assert.deepEqual(MO.moveNode(fixture(), "c", "down"), fixture());
});

test("moveSibling repositions via drag-drop semantics; guards no-op", () => {
  const res = MO.moveSibling(fixture(), "b", "a", "before");
  assert.deepEqual(res.children.map((c) => c.id), ["b", "a", "c"]);
  const after = MO.moveSibling(fixture(), "b", "a", "after");
  assert.deepEqual(after.children.map((c) => c.id), ["a", "b", "c"]);
  // target inside dragged subtree -> no-op
  assert.deepEqual(MO.moveSibling(fixture(), "a", "a1", "after"), fixture());
  // root target -> no-op
  assert.deepEqual(MO.moveSibling(fixture(), "b", "root", "after"), fixture());
});

test("moveInto appends as child and expands target; guards no-op", () => {
  const res = MO.moveInto(fixture(), "c", "a");
  assert.deepEqual(MO.findNode(res, "a").node.children.map((c) => c.id), ["a1", "c"]);
  assert.deepEqual(res.children.map((c) => c.id), ["a", "b"]);
  assert.deepEqual(MO.moveInto(fixture(), "a", "a1"), fixture());
  assert.deepEqual(MO.moveInto(fixture(), "c", "root"), fixture()); // root cannot be moved
});

test("indentNode makes node last child of previous sibling; guards no-op", () => {
  const res = MO.indentNode(fixture(), "b");
  assert.deepEqual(MO.findNode(res, "a").node.children.map((c) => c.id), ["a1", "b"]);
  assert.deepEqual(res.children.map((c) => c.id), ["a", "c"]);
  assert.deepEqual(MO.indentNode(fixture(), "a"), fixture()); // first child
  assert.deepEqual(MO.indentNode(fixture(), "root"), fixture());
});

test("outdentNode makes node sibling after parent; guards no-op", () => {
  const res = MO.outdentNode(fixture(), "a1");
  assert.deepEqual(MO.findNode(res, "a").node.children, []);
  assert.deepEqual(res.children.map((c) => c.id), ["a", "a1", "b", "c"]);
  assert.deepEqual(MO.outdentNode(fixture(), "b"), fixture()); // top-level
  assert.deepEqual(MO.outdentNode(fixture(), "root"), fixture());
});

test("toggleExpand flips expanded", () => {
  assert.equal(MO.findNode(MO.toggleExpand(fixture(), "c"), "c").node.expanded, true);
  assert.equal(MO.findNode(MO.toggleExpand(fixture(), "a"), "a").node.expanded, false);
});

test("expandAll/collapseAll only touch nodes with children", () => {
  const ex = MO.expandAll(fixture());
  assert.equal(MO.findNode(ex, "a").node.expanded, true);
  assert.equal(MO.findNode(ex, "c").node.expanded, true);
  assert.equal("expanded" in MO.findNode(ex, "b").node, false);
  const col = MO.collapseAll(fixture());
  assert.equal(MO.findNode(col, "a").node.expanded, false);
  assert.equal(MO.findNode(col, "c").node.expanded, false);
});

test("cloneSubtree deep-copies with fresh ids and detached references", () => {
  const src = MO.findNode(fixture(), "a").node;
  const clone = MO.cloneSubtree(src);
  assert.equal(clone.topic, "Alpha");
  assert.notEqual(clone.id, "a");
  assert.notEqual(clone.children[0].id, "a1");
  assert.equal(clone.root, false);
  clone.children[0].topic = "MUTATED";
  clone.links.push({ type: "task", id: 9, title: "X" });
  const orig = MO.findNode(fixture(), "a").node;
  assert.equal(orig.children[0].topic, "A-one");
  assert.equal(orig.links.length, 1);
});

test("insertSubtree appends given subtree and auto-expands parent", () => {
  const t = fixture();
  const sub = MO.cloneSubtree(MO.findNode(t, "c").node);
  const res = MO.insertSubtree(t, "b", sub);
  assert.equal(MO.findNode(res.tree, "b").node.children.length, 1);
  assert.equal(MO.findNode(res.tree, "b").node.children[0].id, res.id);
  assert.equal(MO.findNode(res.tree, "b").node.children[0].topic, "Gamma");
  assert.equal(MO.findNode(res.tree, "b").node.expanded, true);
});

test("searchNodes matches case-insensitive substring in DFS order", () => {
  assert.deepEqual(MO.searchNodes(fixture(), "one"), ["a1", "c1"]);
  assert.deepEqual(MO.searchNodes(fixture(), "ROOT"), ["root"]);
  assert.deepEqual(MO.searchNodes(fixture(), "zzz"), []);
});

test("ancestorsOf returns ancestor ids excluding the node; [] when missing", () => {
  assert.deepEqual(MO.ancestorsOf(fixture(), "a1"), ["root", "a"]);
  assert.deepEqual(MO.ancestorsOf(fixture(), "a"), ["root"]);
  assert.deepEqual(MO.ancestorsOf(fixture(), "root"), []);
  assert.deepEqual(MO.ancestorsOf(fixture(), "zzz"), []);
});

test("export surface is complete", () => {
  const expected = [
    "findNode", "addChild", "addSibling", "renameNode", "deleteNode", "duplicateNode",
    "moveNode", "moveSibling", "moveInto", "indentNode", "outdentNode", "toggleExpand",
    "expandAll", "collapseAll", "cloneSubtree", "insertSubtree", "searchNodes", "ancestorsOf",
    "renderTopicMd", "wrapSelection", "prefixLines", "insertBlock", "setNodeAlign",
  ].sort();
  assert.deepEqual(Object.keys(MO).sort(), expected);
});

test("renderTopicMd renders bold, italic, highlight, underline, strike", () => {
  assert.match(MO.renderTopicMd("**tebal**"), /<strong>tebal<\/strong>/);
  assert.match(MO.renderTopicMd("*miring*"), /<em>miring<\/em>/);
  assert.match(MO.renderTopicMd("__sorot__"), /underscore-emphasis/);
  assert.match(MO.renderTopicMd("<u>garis</u>"), /<u>garis<\/u>/);
  assert.match(MO.renderTopicMd("~~coret~~"), /<del>coret<\/del>/);
});

test("renderTopicMd renders heading, code, link", () => {
  assert.match(MO.renderTopicMd("# Judul"), /<h1[^>]*>Judul<\/h1>/);
  assert.match(MO.renderTopicMd("`kode`"), /<code>kode<\/code>/);
  assert.match(MO.renderTopicMd("[x](https://a)"), /<a href="https:\/\/a">x<\/a>/);
});

test("renderTopicMd renders lists, divider, table", () => {
  assert.match(MO.renderTopicMd("- a\n- b"), /<ul>/);
  assert.match(MO.renderTopicMd("1. a\n2. b"), /<ol>/);
  assert.match(MO.renderTopicMd("---"), /<hr/);
  assert.match(MO.renderTopicMd("| a | b |\n| - | - |\n| 1 | 2 |"), /<table>/);
});

test("renderTopicMd leaves plain text unchanged and handles mixed content", () => {
  // marked wraps plain text in <p> and appends a trailing block newline;
  // assert the text itself is unchanged apart from that wrapper.
  assert.equal(MO.renderTopicMd("halo dunia").replace(/<\/?p>/g, "").replace(/\n$/, ""), "halo dunia");
  const mixed = MO.renderTopicMd("__sorot__ dan **tebal**");
  assert.match(mixed, /underscore-emphasis/);
  assert.match(mixed, /<strong>tebal<\/strong>/);
});

test("renderTopicMd escapes raw HTML but keeps underline and highlight", () => {
  const xss = MO.renderTopicMd('<img src=x onerror="alert(1)">');
  assert.ok(!xss.includes("<img"));
  assert.match(xss, /&lt;img/); // img fully entity-escaped (inert text)
  assert.ok(!/<[^>]*onerror/i.test(xss)); // no live tag carries an event handler
  const script = MO.renderTopicMd("<script>alert(1)</script>");
  assert.ok(!script.includes("<script"));
  assert.match(script, /&lt;script&gt;/);
  assert.match(MO.renderTopicMd("<u>garis</u>"), /<u>garis<\/u>/);
  assert.match(MO.renderTopicMd("__sorot__"), /underscore-emphasis/);
  const xss2 = MO.renderTopicMd("<u><img src=x onerror=alert(1)></u>");
  assert.ok(!xss2.includes("<img"));
  assert.ok(!/<[^>]*onerror/i.test(xss2));
  assert.match(xss2, /<u>/); // underline still renders around escaped payload
  const jslink = MO.renderTopicMd("[x](javascript:alert(1))");
  assert.ok(!/href="javascript:/i.test(jslink)); // dangerous URL schemes neutralized
  assert.match(MO.renderTopicMd("[x](https://a)"), /href="https:\/\/a"/); // safe schemes kept
});

test("renderTopicMd keeps query-string links intact", () => {
  const out = MO.renderTopicMd("[x](https://a.com/?a=1&b=2)");
  assert.match(out, /https:\/\/a\.com\/\?a=1%26b=2/);
  assert.ok(!out.includes("?a=1&amp;b=2"));
});

test("wrapSelection wraps selection and inserts placeholder when empty", () => {
  const w = MO.wrapSelection("halo dunia", 5, 10, "**", "**", "teks");
  assert.equal(w.text, "halo **dunia**");
  assert.equal(w.selStart, 7);
  assert.equal(w.selEnd, 12);
  const p = MO.wrapSelection("abc", 1, 1, "[", "](https://)", "teks");
  assert.equal(p.text, "a[teks](https://)bc");
  assert.equal(p.selStart, 2);
  assert.equal(p.selEnd, 6);
});

test("prefixLines prefixes each selected line; numbered counts sequentially", () => {
  const u = MO.prefixLines("a\nb", 0, 3, "- ", false);
  assert.equal(u.text, "- a\n- b");
  const o = MO.prefixLines("a\nb\nc", 0, 5, "", true);
  assert.equal(o.text, "1. a\n2. b\n3. c");
  const e = MO.prefixLines("ab", 1, 1, "- ", false);
  assert.equal(e.text, "a- b");
});

test("insertBlock puts block on its own line and places caret after it", () => {
  const b = MO.insertBlock("a\nb", 2, 2, "---");
  assert.equal(b.text, "a\n---\nb");
  assert.equal(b.selStart, 5);
  assert.equal(b.selEnd, 5);
  const e2 = MO.insertBlock("", 0, 0, "---");
  assert.equal(e2.text, "---");
});

test("setNodeAlign sets align and preserves fields; invalid no-op", () => {
  const t = fixture();
  const r = MO.setNodeAlign(t, "b", "center");
  assert.equal(MO.findNode(r, "b").node.align, "center");
  assert.deepEqual(MO.findNode(r, "a").node.links, [{ type: "note", id: 1, title: "N" }]);
  assert.equal(MO.setNodeAlign(t, "b", "banana"), t);
  assert.equal(MO.setNodeAlign(t, "zzz", "center"), t);
});

test("renderTopicMd output has no trailing newline (phantom line fix)", () => {
  assert.ok(!MO.renderTopicMd("**tebal**").endsWith("\n"));
  assert.ok(!MO.renderTopicMd("halo dunia").endsWith("\n"));
  assert.ok(!MO.renderTopicMd("| a | b |\n| - | - |\n| 1 | 2 |").endsWith("\n"));
});

test("renderTopicMd strips the single-paragraph <p> wrapper (no phantom block)", () => {
  assert.equal(MO.renderTopicMd("halo dunia"), "halo dunia");
  assert.equal(MO.renderTopicMd("**tebal**"), "<strong>tebal</strong>");
  assert.ok(!MO.renderTopicMd("*miring* dan __sorot__").includes("<p>"));
  // multi-paragraph topics keep their block structure
  const multi = MO.renderTopicMd("para1\n\npara2");
  assert.match(multi, /<p>para1<\/p>/);
  assert.match(multi, /<p>para2<\/p>/);
});
