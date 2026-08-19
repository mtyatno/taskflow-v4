;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.TF = root.TF || {};
    root.TF.drawingtabs = factory();
  }
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const MAX_TABS = 5;

  function openTab(tabs, drawingId, title) {
    const list = Array.isArray(tabs) ? [...tabs] : [];
    const existingIndex = list.findIndex(t => t.id === drawingId);

    if (existingIndex !== -1) {
      if (title && list[existingIndex].title !== title) {
        list[existingIndex] = { ...list[existingIndex], title };
      }
      return {
        tabs: list,
        activeTabId: drawingId
      };
    }

    // Add new tab
    const newTab = {
      id: drawingId,
      title: title || "Untitled Drawing"
    };

    if (list.length >= MAX_TABS) {
      // Evict oldest (first) tab
      list.shift();
    }

    list.push(newTab);

    return {
      tabs: list,
      activeTabId: drawingId
    };
  }

  function closeTab(tabs, activeTabId, closeTabId) {
    const list = Array.isArray(tabs) ? [...tabs] : [];
    const closeIndex = list.findIndex(t => t.id === closeTabId);
    if (closeIndex === -1) {
      return { tabs: list, activeTabId };
    }

    list.splice(closeIndex, 1);

    if (activeTabId !== closeTabId) {
      return { tabs: list, activeTabId };
    }

    // Determine new activeTabId
    if (list.length === 0) {
      return { tabs: list, activeTabId: null };
    }

    // If closeIndex is within bounds of remaining list, use same index (right neighbor), else last element
    const nextIndex = closeIndex < list.length ? closeIndex : list.length - 1;
    return {
      tabs: list,
      activeTabId: list[nextIndex].id
    };
  }

  function updateTabTitle(tabs, drawingId, newTitle) {
    const list = Array.isArray(tabs) ? [...tabs] : [];
    return list.map(t => (t.id === drawingId ? { ...t, title: newTitle } : t));
  }

  function reorderTabs(tabs, fromIndex, toIndex) {
    const list = Array.isArray(tabs) ? [...tabs] : [];
    if (
      fromIndex < 0 ||
      fromIndex >= list.length ||
      toIndex < 0 ||
      toIndex >= list.length
    ) {
      return list;
    }
    const [moved] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, moved);
    return list;
  }

  return {
    MAX_TABS,
    openTab,
    closeTab,
    updateTabTitle,
    reorderTabs
  };
});
