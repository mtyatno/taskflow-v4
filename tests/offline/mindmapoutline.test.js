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
  ].sort();
  assert.deepEqual(Object.keys(MO).sort(), expected);
});
