const assert = require("assert");
const { test, describe } = require("node:test");
const { mindmaptabs } = require("../../static/offline/mindmaptabs.js");

describe("mindmaptabs helper module", () => {
  test("openTab adds new tab and sets activeTabId", () => {
    const res = mindmaptabs.openTab([], { id: "m1", title: "Mindmap 1" });
    assert.strictEqual(res.tabs.length, 1);
    assert.strictEqual(res.activeTabId, "m1");
  });

  test("openTab switches activeTabId if tab already open", () => {
    const initial = [{ id: "m1", title: "M1" }, { id: "m2", title: "M2" }];
    const res = mindmaptabs.openTab(initial, { id: "m1", title: "M1" });
    assert.strictEqual(res.tabs.length, 2);
    assert.strictEqual(res.activeTabId, "m1");
  });

  test("openTab evicts oldest tab when capacity (max 5) reached", () => {
    const initial = [
      { id: "m1", title: "M1" },
      { id: "m2", title: "M2" },
      { id: "m3", title: "M3" },
      { id: "m4", title: "M4" },
      { id: "m5", title: "M5" }
    ];
    const res = mindmaptabs.openTab(initial, { id: "m6", title: "M6" }, 5);
    assert.strictEqual(res.tabs.length, 5);
    assert.strictEqual(res.tabs[0].id, "m2");
    assert.strictEqual(res.tabs[4].id, "m6");
    assert.strictEqual(res.activeTabId, "m6");
  });

  test("closeTab removes target tab and activates neighbor tab", () => {
    const initial = [{ id: "m1" }, { id: "m2" }, { id: "m3" }];
    const res = mindmaptabs.closeTab(initial, "m2", "m2");
    assert.strictEqual(res.tabs.length, 2);
    assert.strictEqual(res.activeTabId, "m3");
  });

  test("closeTab keeps activeTabId if closed tab was not active", () => {
    const initial = [{ id: "m1" }, { id: "m2" }, { id: "m3" }];
    const res = mindmaptabs.closeTab(initial, "m1", "m2");
    assert.strictEqual(res.tabs.length, 2);
    assert.strictEqual(res.activeTabId, "m1");
  });

  test("updateTabTitle updates specific tab title", () => {
    const initial = [{ id: "m1", title: "Old Title" }];
    const updated = mindmaptabs.updateTabTitle(initial, "m1", "New Title");
    assert.strictEqual(updated[0].title, "New Title");
  });
});
