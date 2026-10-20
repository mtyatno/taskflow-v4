;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  const PIN_LIMIT = 5;

  function pinnedForRail(lists) {
    return (lists || [])
      .filter((l) => l && l.pinned === true)
      .sort((a, b) => {
        const pa = a.pin_position != null ? a.pin_position : Infinity;
        const pb = b.pin_position != null ? b.pin_position : Infinity;
        if (pa !== pb) return pa < pb ? -1 : 1;
        const sa = String(a.id), sb = String(b.id);
        return sa < sb ? -1 : sa > sb ? 1 : 0;
      })
      .slice(0, PIN_LIMIT);
  }

  function avatarInitial(name) {
    const chars = Array.from(String(name == null ? "" : name).trim());
    return chars.length ? chars[0].toUpperCase() : "?";
  }

  function avatarColorIndex(id) {
    if (typeof id === "number") return Math.abs(id) % 8;
    let sum = 0;
    const s = String(id == null ? "" : id);
    for (let i = 0; i < s.length; i++) sum += s.charCodeAt(i);
    return sum % 8;
  }

  function canPinMore(lists) {
    return (lists || []).filter((l) => l && l.pinned === true).length < PIN_LIMIT;
  }

  function applyPinChange(lists, listId, pinned, pinPosition) {
    return (lists || []).map((l) =>
      l && l.id === listId ? Object.assign({}, l, { pinned: pinned, pin_position: pinPosition }) : l);
  }

  const exported = { PIN_LIMIT, pinnedForRail, avatarInitial, avatarColorIndex, canPinMore, applyPinChange };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.workspacepins = exported; }
  return exported;
});
