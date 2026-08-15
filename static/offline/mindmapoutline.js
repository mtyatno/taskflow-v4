;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    root.TF.mindmapoutline = factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  const uid = () =>
    (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);

  function findNode(root, id) {
    if (!root) return null;
    if (root.id === id) return { node: root, parent: null, index: -1 };
    const kids = root.children || [];
    for (let i = 0; i < kids.length; i++) {
      const found = findNode(kids[i], id);
      if (found) {
        if (!found.parent) return { ...found, parent: root, index: i };
        return found;
      }
    }
    return null;
  }

  function updateNode(root, id, updater) {
    if (!root) return root;
    if (root.id === id) return updater(root);
    if (!root.children || root.children.length === 0) return root;
    let changed = false;
    const children = root.children.map((c) => {
      const nc = updateNode(c, id, updater);
      if (nc !== c) changed = true;
      return nc;
    });
    return changed ? { ...root, children } : root;
  }

  const makeNode = (topic) => ({ id: uid(), topic: topic || "Node baru", children: [], expanded: true });

  function addChild(root, parentId, topic) {
    if (!findNode(root, parentId)) return { tree: root, id: null };
    const node = makeNode(topic);
    const tree = updateNode(root, parentId, (p) => ({
      ...p,
      expanded: true,
      children: [...(p.children || []), node],
    }));
    return { tree, id: node.id };
  }

  function addSibling(root, id, after) {
    const f = findNode(root, id);
    if (!f || !f.node) return { tree: root, id: null };
    if (!f.parent) return addChild(root, root.id, "Node baru"); // root -> append child
    const node = makeNode("Node baru");
    const idx = f.index + (after ? 1 : 0);
    const tree = updateNode(root, f.parent.id, (p) => ({
      ...p,
      children: [...p.children.slice(0, idx), node, ...p.children.slice(idx)],
    }));
    return { tree, id: node.id };
  }

  function renameNode(root, id, topic) {
    return updateNode(root, id, (n) => ({ ...n, topic }));
  }

  function deleteNode(root, id) {
    const f = findNode(root, id);
    if (!f || !f.node || f.node.root || !f.parent) return root;
    return updateNode(root, f.parent.id, (p) => ({
      ...p,
      children: p.children.filter((c) => c.id !== id),
    }));
  }

  function cloneSubtree(node) {
    return {
      ...node,
      id: uid(),
      root: false,
      children: (node.children || []).map(cloneSubtree),
      links: (node.links || []).map((l) => ({ ...l })),
    };
  }

  function duplicateNode(root, id) {
    const f = findNode(root, id);
    if (!f || !f.node) return { tree: root, id: null };
    const copy = cloneSubtree(f.node);
    if (!f.parent) {
      // root -> insert as first child
      const tree = updateNode(root, root.id, (r) => ({ ...r, children: [copy, ...(r.children || [])] }));
      return { tree, id: copy.id };
    }
    const idx = f.index + 1;
    const tree = updateNode(root, f.parent.id, (p) => ({
      ...p,
      children: [...p.children.slice(0, idx), copy, ...p.children.slice(idx)],
    }));
    return { tree, id: copy.id };
  }

  function moveNode(root, id, dir) {
    const f = findNode(root, id);
    if (!f || !f.node || f.node.root || !f.parent) return root;
    const kids = f.parent.children;
    const idx = f.index;
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= kids.length) return root;
    const children = [...kids];
    const tmp = children[idx];
    children[idx] = children[swapIdx];
    children[swapIdx] = tmp;
    return updateNode(root, f.parent.id, (p) => ({ ...p, children }));
  }

  function moveSibling(root, id, targetId, pos) {
    if (id === targetId) return root;
    if (ancestorsOf(root, targetId).indexOf(id) !== -1) return root;
    const src = findNode(root, id);
    if (!src || !src.node || src.node.root) return root;
    const tgt = findNode(root, targetId);
    if (!tgt || !tgt.node || tgt.node.root || !tgt.parent) return root;
    const without = deleteNode(root, id);
    const t2 = findNode(without, targetId);
    const idx = t2.index + (pos === "before" ? 0 : 1);
    return updateNode(without, t2.parent.id, (p) => ({
      ...p,
      children: [...p.children.slice(0, idx), src.node, ...p.children.slice(idx)],
    }));
  }

  function moveInto(root, id, targetId) {
    if (id === targetId) return root;
    if (ancestorsOf(root, targetId).indexOf(id) !== -1) return root;
    const src = findNode(root, id);
    if (!src || !src.node || src.node.root) return root;
    const tgt = findNode(root, targetId);
    if (!tgt || !tgt.node || tgt.node.root) return root;
    const without = deleteNode(root, id);
    return updateNode(without, targetId, (p) => ({
      ...p,
      expanded: true,
      children: [...(p.children || []), src.node],
    }));
  }

  function indentNode(root, id) {
    const f = findNode(root, id);
    if (!f || !f.node || f.node.root || !f.parent) return root;
    if (f.index === 0) return root; // no previous sibling
    const prev = f.parent.children[f.index - 1];
    const without = deleteNode(root, id);
    return updateNode(without, prev.id, (p) => ({
      ...p,
      expanded: true,
      children: [...(p.children || []), f.node],
    }));
  }

  function outdentNode(root, id) {
    const f = findNode(root, id);
    if (!f || !f.node || f.node.root || !f.parent) return root;
    const parentOfParent = findNode(root, f.parent.id).parent;
    if (!parentOfParent) return root; // top-level child
    const without = deleteNode(root, id);
    const pp = findNode(without, parentOfParent.id);
    const idx = pp.node.children.findIndex((c) => c.id === f.parent.id) + 1;
    return updateNode(without, parentOfParent.id, (p) => ({
      ...p,
      children: [...p.children.slice(0, idx), f.node, ...p.children.slice(idx)],
    }));
  }

  function toggleExpand(root, id) {
    return updateNode(root, id, (n) => ({ ...n, expanded: n.expanded === false }));
  }

  function mapAll(root, fn) {
    const mapped = fn(root);
    return {
      ...mapped,
      children: (mapped.children || []).map((c) => mapAll(c, fn)),
    };
  }

  function expandAll(root) {
    return mapAll(root, (n) => ((n.children || []).length > 0 ? { ...n, expanded: true } : n));
  }

  function collapseAll(root) {
    return mapAll(root, (n) => ((n.children || []).length > 0 ? { ...n, expanded: false } : n));
  }

  function insertSubtree(root, parentId, subtree) {
    if (!findNode(root, parentId)) return { tree: root, id: null };
    const tree = updateNode(root, parentId, (p) => ({
      ...p,
      expanded: true,
      children: [...(p.children || []), subtree],
    }));
    return { tree, id: subtree.id };
  }

  function searchNodes(root, query) {
    const ql = String(query || "").toLowerCase();
    const out = [];
    (function walk(n) {
      if (String(n.topic || "").toLowerCase().indexOf(ql) !== -1) out.push(n.id);
      (n.children || []).forEach(walk);
    })(root);
    return out;
  }

  function ancestorsOf(root, id) {
    const f = findNode(root, id);
    if (!f) return [];
    const out = [];
    let p = f.parent;
    while (p) {
      out.push(p.id);
      const pf = findNode(root, p.id);
      p = pf ? pf.parent : null;
    }
    return out.reverse();
  }

  return {
    findNode, addChild, addSibling, renameNode, deleteNode, duplicateNode,
    moveNode, moveSibling, moveInto, indentNode, outdentNode, toggleExpand,
    expandAll, collapseAll, cloneSubtree, insertSubtree, searchNodes, ancestorsOf,
  };
});
