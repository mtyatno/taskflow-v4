"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

// Test UMD loading via require
let JUSTIFY;
try {
  JUSTIFY = require("../../static/offline/mindmapjustify.js");
} catch (e) {
  // If file doesn't exist yet, JUSTIFY will be undefined for TDD Red phase
}

// Helper to create mock DOM elements for applyLevelJustify testing
function createMockElement(tagName, props = {}) {
  const children = [];
  const style = {};
  const el = {
    tagName: tagName.toUpperCase(),
    style,
    offsetWidth: props.offsetWidth || 0,
    offsetHeight: props.offsetHeight || 0,
    clientWidth: props.offsetWidth || 0,
    clientHeight: props.offsetHeight || 0,
    children,
    parentElement: null,
    appendChild(child) {
      child.parentElement = el;
      children.push(child);
      return child;
    },
    querySelector(selector) {
      if (selector === ":scope > me-parent" || selector === "me-parent") {
        return children.find(c => c.tagName === "ME-PARENT") || null;
      }
      if (selector === ":scope > me-tpc" || selector === "me-tpc") {
        return children.find(c => c.tagName === "ME-TPC") || null;
      }
      if (selector === ":scope > me-children" || selector === "me-children") {
        return children.find(c => c.tagName === "ME-CHILDREN") || null;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "me-parent") {
        const results = [];
        function collect(curr) {
          if (curr.tagName === "ME-PARENT") results.push(curr);
          curr.children.forEach(collect);
        }
        collect(el);
        return results;
      }
      if (selector === "me-main > me-wrapper" || selector === ":scope > me-wrapper") {
        return children.filter(c => c.tagName === "ME-WRAPPER");
      }
      if (selector === "me-main") {
        return children.filter(c => c.tagName === "ME-MAIN");
      }
      return [];
    }
  };
  return el;
}

// Build a mock mind-elixir map container
function buildMockMapContainer() {
  const mapContainer = createMockElement("div");
  const main = createMockElement("me-main");
  mapContainer.appendChild(main);

  // Depth 1: Wrapper 1 (width 120, height 30)
  const w1 = createMockElement("me-wrapper");
  const p1 = createMockElement("me-parent");
  const tpc1 = createMockElement("me-tpc", { offsetWidth: 120, offsetHeight: 30 });
  p1.appendChild(tpc1);
  w1.appendChild(p1);

  // Children of w1 (Depth 2: w1_1 width 200, height 40; w1_2 width 150, height 25)
  const ch1 = createMockElement("me-children");
  const w1_1 = createMockElement("me-wrapper");
  const p1_1 = createMockElement("me-parent");
  const tpc1_1 = createMockElement("me-tpc", { offsetWidth: 200, offsetHeight: 40 });
  p1_1.appendChild(tpc1_1);
  w1_1.appendChild(p1_1);

  const w1_2 = createMockElement("me-wrapper");
  const p1_2 = createMockElement("me-parent");
  const tpc1_2 = createMockElement("me-tpc", { offsetWidth: 150, offsetHeight: 25 });
  p1_2.appendChild(tpc1_2);
  w1_2.appendChild(p1_2);

  ch1.appendChild(w1_1);
  ch1.appendChild(w1_2);
  w1.appendChild(ch1);

  // Depth 1: Wrapper 2 (width 80, height 50)
  const w2 = createMockElement("me-wrapper");
  const p2 = createMockElement("me-parent");
  const tpc2 = createMockElement("me-tpc", { offsetWidth: 80, offsetHeight: 50 });
  p2.appendChild(tpc2);
  w2.appendChild(p2);

  main.appendChild(w1);
  main.appendChild(w2);

  // Quick query helper
  main.querySelectorAll = (selector) => {
    if (selector === ":scope > me-wrapper" || selector === "me-main > me-wrapper") {
      return [w1, w2];
    }
    return [];
  };
  mapContainer.querySelectorAll = (selector) => {
    if (selector === "me-main > me-wrapper") return [w1, w2];
    if (selector === "me-parent") return [p1, p1_1, p1_2, p2];
    return [];
  };

  return { mapContainer, p1, p2, p1_1, p1_2, tpc1, tpc2, tpc1_1, tpc1_2 };
}

describe("mindmapjustify module", () => {
  test("toggleJustify flips boolean values correctly", () => {
    assert.ok(JUSTIFY, "mindmapjustify module must be loaded");
    const helper = JUSTIFY.mindmapjustify || JUSTIFY;
    assert.equal(helper.toggleJustify(false), true);
    assert.equal(helper.toggleJustify(true), false);
    assert.equal(helper.toggleJustify(undefined), true);
    assert.equal(helper.toggleJustify(null), true);
    assert.equal(helper.toggleJustify(""), true);
  });

  test("computeTreeDepths groups nodes by tree depth level", () => {
    assert.ok(JUSTIFY, "mindmapjustify module must be loaded");
    const helper = JUSTIFY.mindmapjustify || JUSTIFY;
    const tree = {
      id: "root",
      topic: "Root",
      children: [
        {
          id: "c1",
          topic: "Child 1",
          children: [
            { id: "c1_1", topic: "Grandchild 1" }
          ]
        },
        {
          id: "c2",
          topic: "Child 2",
          children: [
            { id: "c2_1", topic: "Grandchild 2" },
            { id: "c2_2", topic: "Grandchild 3" }
          ]
        }
      ]
    };

    const res = helper.computeTreeDepths(tree);
    assert.equal(res.maxDepth, 2);
    assert.equal(res.byDepth[1].length, 2);
    assert.equal(res.byDepth[2].length, 3);
    assert.equal(res.byDepth[1][0].id, "c1");
    assert.equal(res.byDepth[1][1].id, "c2");
    assert.equal(res.byDepth[2][0].id, "c1_1");
    assert.equal(res.byDepth[2][1].id, "c2_1");
    assert.equal(res.byDepth[2][2].id, "c2_2");
  });

  test("computeTreeDepths handles empty or childless root gracefully", () => {
    assert.ok(JUSTIFY, "mindmapjustify module must be loaded");
    const helper = JUSTIFY.mindmapjustify || JUSTIFY;
    const res1 = helper.computeTreeDepths({ id: "root", topic: "Root" });
    assert.equal(res1.maxDepth, 0);
    assert.deepEqual(res1.byDepth, {});

    const res2 = helper.computeTreeDepths(null);
    assert.equal(res2.maxDepth, 0);
    assert.deepEqual(res2.byDepth, {});
  });

  test("applyLevelJustify applies uniform min-width horizontally", () => {
    assert.ok(JUSTIFY, "mindmapjustify module must be loaded");
    const helper = JUSTIFY.mindmapjustify || JUSTIFY;
    const { mapContainer, p1, p2, p1_1, p1_2 } = buildMockMapContainer();

    // Horizontal justify (isVertical = false)
    helper.applyLevelJustify(mapContainer, true, false);

    // Depth 1: max width is max(120, 80) = 120px
    assert.equal(p1.style.minWidth, "120px");
    assert.equal(p2.style.minWidth, "120px");

    // Depth 2: max width is max(200, 150) = 200px
    assert.equal(p1_1.style.minWidth, "200px");
    assert.equal(p1_2.style.minWidth, "200px");
  });

  test("applyLevelJustify applies uniform min-height vertically", () => {
    assert.ok(JUSTIFY, "mindmapjustify module must be loaded");
    const helper = JUSTIFY.mindmapjustify || JUSTIFY;
    const { mapContainer, p1, p2, p1_1, p1_2 } = buildMockMapContainer();

    // Vertical justify (isVertical = true)
    helper.applyLevelJustify(mapContainer, true, true);

    // Depth 1: max height is max(30, 50) = 50px
    assert.equal(p1.style.minHeight, "50px");
    assert.equal(p2.style.minHeight, "50px");

    // Depth 2: max height is max(40, 25) = 40px
    assert.equal(p1_1.style.minHeight, "40px");
    assert.equal(p1_2.style.minHeight, "40px");
  });

  test("applyLevelJustify resets styles when isJustify is false", () => {
    assert.ok(JUSTIFY, "mindmapjustify module must be loaded");
    const helper = JUSTIFY.mindmapjustify || JUSTIFY;
    const { mapContainer, p1, p2, p1_1, p1_2 } = buildMockMapContainer();

    // First apply
    helper.applyLevelJustify(mapContainer, true, false);
    assert.equal(p1.style.minWidth, "120px");

    // Then reset
    helper.applyLevelJustify(mapContainer, false, false);
    assert.equal(p1.style.minWidth, "");
    assert.equal(p1.style.minHeight, "");
    assert.equal(p2.style.minWidth, "");
    assert.equal(p1_1.style.minWidth, "");
    assert.equal(p1_2.style.minWidth, "");
  });

  test("applyLevelJustify handles null mapContainer gracefully", () => {
    assert.ok(JUSTIFY, "mindmapjustify module must be loaded");
    const helper = JUSTIFY.mindmapjustify || JUSTIFY;
    assert.doesNotThrow(() => {
      helper.applyLevelJustify(null, true, false);
      helper.applyLevelJustify(undefined, false, true);
    });
  });
});
