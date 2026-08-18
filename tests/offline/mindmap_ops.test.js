"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const OPS = require("../../static/offline/mindmapops.js");

const el = (tag, parent) => ({ tagName: tag, parentElement: parent });

test("isNodeTopicTarget: hanya me-tpc di dalam ME-PARENT / ME-ROOT", () => {
  const parent = el("ME-PARENT", el("ME-CHILD", null));
  assert.equal(OPS.isNodeTopicTarget(el("ME-TPC", parent)), true);
  assert.equal(OPS.isNodeTopicTarget(el("ME-TPC", el("ME-ROOT", null))), true);
  assert.equal(OPS.isNodeTopicTarget(el("ME-TPC", el("ME-CHILD", null))), false);
  assert.equal(OPS.isNodeTopicTarget(null), false);
  assert.equal(OPS.isNodeTopicTarget(el("SPAN", parent)), false);
});

test("resolveTopicTarget: walk dari inner text ke me-tpc", () => {
  const parent = el("ME-PARENT", el("ME-CHILD", el("ME-CHILDREN", null)));
  const tpc = el("ME-TPC", parent);
  const span = el("SPAN", tpc);
  assert.equal(OPS.resolveTopicTarget(span), tpc);
  assert.equal(OPS.resolveTopicTarget(tpc), tpc);
  // tap di area kosong map / node tanpa parent valid
  assert.equal(OPS.resolveTopicTarget(el("DIV", el("ME-MAP", null))), null);
  assert.equal(OPS.resolveTopicTarget(el("ME-TPC", el("ME-CHILD", null))), null);
  assert.equal(OPS.resolveTopicTarget(null), null);
});

test("opsDisabledStates mirror flag root context menu engine", () => {
  assert.deepEqual(OPS.opsDisabledStates(true),
    { parent: true, focus: true, moveUp: true, moveDown: true });
  assert.deepEqual(OPS.opsDisabledStates(false),
    { parent: false, focus: false, moveUp: false, moveDown: false });
});
