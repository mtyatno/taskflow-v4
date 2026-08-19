"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const DT = require("../../static/offline/drawingtabs.js");

test("openTab adds a new tab and activates it", () => {
  const result = DT.openTab([], 1, "Drawing 1");
  assert.equal(result.tabs.length, 1);
  assert.equal(result.activeTabId, 1);
  assert.equal(result.tabs[0].id, 1);
  assert.equal(result.tabs[0].title, "Drawing 1");
});

test("openTab does not duplicate existing tab and switches to it", () => {
  const tabs = [
    { id: 1, title: "Drawing 1" },
    { id: 2, title: "Drawing 2" }
  ];
  const result = DT.openTab(tabs, 1, "Drawing 1");
  assert.equal(result.tabs.length, 2);
  assert.equal(result.activeTabId, 1);
});

test("openTab updates title if existing tab has changed title", () => {
  const tabs = [{ id: 1, title: "Old Title" }];
  const result = DT.openTab(tabs, 1, "New Title");
  assert.equal(result.tabs.length, 1);
  assert.equal(result.tabs[0].title, "New Title");
  assert.equal(result.activeTabId, 1);
});

test("openTab caps at 5 tabs by evicting oldest tab", () => {
  let state = { tabs: [], activeTabId: null };
  for (let i = 1; i <= 5; i++) {
    state = DT.openTab(state.tabs, i, `Drawing ${i}`);
  }
  assert.equal(state.tabs.length, 5);
  assert.equal(state.activeTabId, 5);

  const next = DT.openTab(state.tabs, 6, "Drawing 6");
  assert.equal(next.tabs.length, 5);
  assert.equal(next.activeTabId, 6);
  assert.equal(next.tabs[0].id, 2); // 1 was evicted
  assert.equal(next.tabs[4].id, 6);
});

test("closeTab closes the active tab and switches to adjacent neighbor", () => {
  const tabs = [
    { id: 1, title: "D1" },
    { id: 2, title: "D2" },
    { id: 3, title: "D3" }
  ];
  // Close middle tab when it is active -> switch to next (D3)
  const res1 = DT.closeTab(tabs, 2, 2);
  assert.equal(res1.tabs.length, 2);
  assert.equal(res1.activeTabId, 3);

  // Close last tab when it is active -> switch to previous (D1)
  const res2 = DT.closeTab(res1.tabs, 3, 3);
  assert.equal(res2.tabs.length, 1);
  assert.equal(res2.activeTabId, 1);

  // Close last remaining tab -> activeTabId is null
  const res3 = DT.closeTab(res2.tabs, 1, 1);
  assert.equal(res3.tabs.length, 0);
  assert.equal(res3.activeTabId, null);
});

test("closeTab closing inactive tab keeps active tab intact", () => {
  const tabs = [
    { id: 1, title: "D1" },
    { id: 2, title: "D2" },
    { id: 3, title: "D3" }
  ];
  const res = DT.closeTab(tabs, 1, 2);
  assert.equal(res.tabs.length, 2);
  assert.equal(res.activeTabId, 1);
  assert.deepEqual(res.tabs.map(t => t.id), [1, 3]);
});

test("updateTabTitle updates matching tab title", () => {
  const tabs = [
    { id: 1, title: "D1" },
    { id: 2, title: "D2" }
  ];
  const updated = DT.updateTabTitle(tabs, 2, "D2 Renamed");
  assert.equal(updated[1].title, "D2 Renamed");
  assert.equal(updated[0].title, "D1");
});

test("reorderTabs moves tab to new position", () => {
  const tabs = [
    { id: 1, title: "D1" },
    { id: 2, title: "D2" },
    { id: 3, title: "D3" }
  ];
  const reordered = DT.reorderTabs(tabs, 0, 2);
  assert.deepEqual(reordered.map(t => t.id), [2, 3, 1]);
});
