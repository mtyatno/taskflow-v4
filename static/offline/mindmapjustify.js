(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define([], factory);
  } else if (typeof module === "object" && module.exports) {
    const exported = factory();
    module.exports = { ...exported, mindmapjustify: exported };
  } else {
    root.TF = root.TF || {};
    root.TF.mindmapjustify = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function toggleJustify(current) {
    return !Boolean(current);
  }

  function computeTreeDepths(rootNode) {
    const byDepth = {};
    let maxDepth = 0;

    if (!rootNode) {
      return { byDepth, maxDepth };
    }

    function traverse(node, depth) {
      if (!node) return;
      if (depth > 0) {
        if (!byDepth[depth]) byDepth[depth] = [];
        byDepth[depth].push(node);
        if (depth > maxDepth) maxDepth = depth;
      }
      if (Array.isArray(node.children)) {
        node.children.forEach(child => traverse(child, depth + 1));
      }
    }

    traverse(rootNode, 0);
    return { byDepth, maxDepth };
  }

  function applyLevelJustify(mapContainer, isJustify, isVertical) {
    if (!mapContainer) return;

    if (!isJustify) {
      const parents = mapContainer.querySelectorAll ? mapContainer.querySelectorAll("me-parent") : null;
      if (parents && parents.forEach) {
        parents.forEach(p => {
          if (p && p.style) {
            p.style.minWidth = "";
            p.style.minHeight = "";
          }
        });
      }
      return;
    }

    const levels = new Map();

    function traverseDOM(wrapper, depth) {
      if (!wrapper) return;
      const parentEl = wrapper.querySelector ? (wrapper.querySelector(":scope > me-parent") || wrapper.querySelector("me-parent")) : null;
      const tpcEl = parentEl && parentEl.querySelector ? (parentEl.querySelector(":scope > me-tpc") || parentEl.querySelector("me-tpc")) : null;
      if (parentEl && tpcEl) {
        if (!levels.has(depth)) levels.set(depth, []);
        levels.get(depth).push({ parentEl, tpcEl });
      }
      const childrenEl = wrapper.querySelector ? (wrapper.querySelector(":scope > me-children") || wrapper.querySelector("me-children")) : null;
      if (childrenEl && childrenEl.querySelectorAll) {
        const childWrappers = childrenEl.querySelectorAll(":scope > me-wrapper") || childrenEl.querySelectorAll("me-wrapper");
        if (childWrappers && childWrappers.forEach) {
          childWrappers.forEach(cw => traverseDOM(cw, depth + 1));
        }
      }
    }

    const mainWrappers = mapContainer.querySelectorAll ? mapContainer.querySelectorAll("me-main > me-wrapper") : null;
    if (mainWrappers && mainWrappers.forEach) {
      mainWrappers.forEach(mw => traverseDOM(mw, 1));
    }

    levels.forEach(nodes => {
      if (isVertical) {
        let maxH = 0;
        nodes.forEach(n => {
          if (n.parentEl && n.parentEl.style) {
            n.parentEl.style.minHeight = "";
            n.parentEl.style.minWidth = "";
          }
          const h = (n.tpcEl.offsetHeight || n.tpcEl.clientHeight || 0);
          if (h > maxH) maxH = h;
        });
        if (maxH > 0) {
          nodes.forEach(n => {
            if (n.parentEl && n.parentEl.style) {
              n.parentEl.style.minHeight = maxH + "px";
            }
          });
        }
      } else {
        let maxW = 0;
        nodes.forEach(n => {
          if (n.parentEl && n.parentEl.style) {
            n.parentEl.style.minWidth = "";
            n.parentEl.style.minHeight = "";
          }
          const w = (n.tpcEl.offsetWidth || n.tpcEl.clientWidth || 0);
          if (w > maxW) maxW = w;
        });
        if (maxW > 0) {
          nodes.forEach(n => {
            if (n.parentEl && n.parentEl.style) {
              n.parentEl.style.minWidth = maxW + "px";
            }
          });
        }
      }
    });
  }

  return {
    toggleJustify,
    computeTreeDepths,
    applyLevelJustify
  };
});
