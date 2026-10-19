;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    root.TF.mindmapops = factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Pure helpers for the iframe Ops panel (context-menu mirror).

  // The engine's context menu allows createArrow only when the click target
  // is a node topic (me-tpc) whose parent element is ME-PARENT or ME-ROOT.
  function isNodeTopicTarget(el) {
    if (!el || el.tagName !== "ME-TPC" || !el.parentElement) return false;
    const t = el.parentElement.tagName;
    return t === "ME-PARENT" || t === "ME-ROOT";
  }

  // Walk up from a map click target to the enclosing me-tpc, then apply the
  // engine's exact parent check. (Improvement over the engine's raw
  // parentElement check: taps landing on text inside a topic still resolve.)
  function resolveTopicTarget(el) {
    let cur = el;
    while (cur && cur.tagName !== "ME-TPC") cur = cur.parentElement;
    return cur && isNodeTopicTarget(cur) ? cur : null;
  }

  // Buttons the engine's context menu disables when the selected node is
  // the root (its C flag): addParent, focus, moveUp, moveDown, addSibling,
  // removeNode — six items. addChild stays enabled for root.
  function opsDisabledStates(isRoot) {
    return {
      parent: !!isRoot,
      focus: !!isRoot,
      moveUp: !!isRoot,
      moveDown: !!isRoot,
      sibling: !!isRoot,
      remove: !!isRoot,
    };
  }

  // safeExportName(title, ext): sanitasi judul mindmap jadi nama file yang
  // aman di semua OS (ganti karakter path-hostile dan kontrol dengan "-"),
  // fallback "mindmap" kalau kosong, lalu tambahkan ekstensi.
  function safeExportName(title, ext) {
    const raw = typeof title === "string" ? title : "";
    const cleaned = raw
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
    const name = cleaned || "mindmap";
    return name + "." + ext;
  }

  // engineOptions(linked, handlers): opsi tambahan mesin mind-elixir. Peta
  // tertaut: undo ditangani induk (catatan), panah dimatikan dari menu konteks,
  // dan dua item menu membuka catatan di heading node. Peta biasa: opsi lama.
  function engineOptions(linked, handlers) {
    if (!linked) return { contextMenu: true };
    const h = handlers || {};
    return {
      allowUndo: false,
      newTopicName: "Node baru",
      contextMenu: {
        focus: true,
        link: false,
        extend: [
          { name: "📄 Buka di catatan", key: "Ctrl+Click", onclick: h.openModal },
          { name: "↗ Buka di halaman Notes", onclick: h.openPage },
        ],
      },
    };
  }

  // Ctrl+Click (Cmd+Click di Mac) dengan tombol kiri membuka catatan di heading.
  function isOpenNoteClick(evt) {
    return !!evt && evt.button === 0 && !!(evt.ctrlKey || evt.metaKey);
  }

  // Kontrol yang tidak bisa dipetakan ke catatan (panah, ringkasan engine,
  // tautan node, format blok) disembunyikan di peta tertaut.
  const LINKED_HIDDEN_SELECTORS = [
    "#ntb-summary",
    "#ntb-link",
    "#ntb-linkbi",
    '.side-tab[data-tab="links"]',
    ...["underline", "highlight", "heading", "table", "ul", "ol", "hr", "align"].map(
      (a) => `#fmt-panel [data-act="${a}"]`
    ),
  ];

  return {
    isNodeTopicTarget: isNodeTopicTarget,
    resolveTopicTarget: resolveTopicTarget,
    opsDisabledStates: opsDisabledStates,
    safeExportName: safeExportName,
    engineOptions: engineOptions,
    isOpenNoteClick: isOpenNoteClick,
    LINKED_HIDDEN_SELECTORS: LINKED_HIDDEN_SELECTORS,
  };
});
