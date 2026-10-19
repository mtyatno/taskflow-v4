(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = { mindmaptabs: factory() };
  } else {
    root.TF = root.TF || {};
    root.TF.mindmaptabs = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function openTab(tabs = [], mindmap, max = 5) {
    if (!mindmap || !mindmap.id) return { tabs, activeTabId: null };
    const existsIndex = tabs.findIndex(t => t.id === mindmap.id);
    if (existsIndex >= 0) {
      return { tabs, activeTabId: mindmap.id };
    }
    let nextTabs = [...tabs, mindmap];
    if (nextTabs.length > max) {
      nextTabs = nextTabs.slice(nextTabs.length - max);
    }
    return { tabs: nextTabs, activeTabId: mindmap.id };
  }

  function closeTab(tabs = [], activeTabId, targetId) {
    const index = tabs.findIndex(t => t.id === targetId);
    if (index === -1) return { tabs, activeTabId };

    const nextTabs = tabs.filter(t => t.id !== targetId);
    let nextActiveId = activeTabId;

    if (activeTabId === targetId) {
      if (nextTabs.length === 0) {
        nextActiveId = null;
      } else {
        const newActiveIdx = Math.min(index, nextTabs.length - 1);
        nextActiveId = nextTabs[newActiveIdx].id;
      }
    }

    return { tabs: nextTabs, activeTabId: nextActiveId };
  }

  function updateTabTitle(tabs = [], mindmapId, newTitle) {
    return tabs.map(t => (t.id === mindmapId ? { ...t, title: newTitle } : t));
  }

  function filterSidebar(list, opts) {
    const q = String((opts && opts.q) || '').trim().toLowerCase();
    const filter = opts ? opts.filter : null;
    return (Array.isArray(list) ? list : []).filter(m => {
      if (!m) return false;
      if (q && !String(m.title == null ? '' : m.title).toLowerCase().includes(q)) return false;
      if (filter == null) return true;
      if (filter === 'personal') return m.list_id == null;
      return String(m.list_id) === String(filter);
    });
  }

  return {
    filterSidebar,
    openTab,
    closeTab,
    updateTabTitle
  };
}));
