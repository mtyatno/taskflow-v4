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

  // Keluar dari Focus Mode sebelum mesin dimuat ulang. refresh()/init() mind-elixir tidak
  // menyentuh isFocusMode, dan selama flag itu aktif getData() mengembalikan nodeDataBackup —
  // pohon LAMA — sehingga tiap change setelah muat ulang mengirim pohon sebelum muat ulang.
  // Pakai cancelFocus milik mesin; bila tidak ada / gagal, setel ulang field seperti mesin.
  function exitFocusMode(mind) {
    if (!mind || !mind.isFocusMode) return false;
    try {
      if (typeof mind.cancelFocus === "function") mind.cancelFocus();
    } catch (_) {}
    if (mind.isFocusMode) {
      mind.isFocusMode = false;
      if (mind.tempDirection != null) mind.direction = mind.tempDirection;
    }
    mind.tempDirection = null;
    mind.nodeDataBackup = null;
    return true;
  }

  // Muat data baru ke mesin yang sudah ada (selalu keluar dari Focus Mode dulu). init()
  // memasang ulang menu konteks, keypress dan listener copy/paste setiap dipanggil (menu
  // ganda, tempel ganda); peta tertaut dimuat ulang sering, jadi cukup refresh() — tanpa
  // toCenter agar geseran pengguna tetap (muat awal tetap terpusat lewat init() mesin baru).
  // Peta biasa tetap lewat init() (perilaku lama, termasuk riwayat undo mesin per muatan).
  function reloadEngine(mind, data, linked) {
    exitFocusMode(mind);
    data = sanitizeData(data);
    if (linked) {
      mind.refresh(data);
    } else {
      mind.init(data);
    }
  }

  // XSS: data untuk mesin lewat TF.safehtml.sanitizeMindTree (buang dangerouslySetInnerHTML, hyperLink tidak
  // aman). Tanpa safehtml (tidak termuat): gagal tertutup — kunci dangerously* dan SEMUA hyperLink dibuang.
  function mindSanitizer() {
    const S = root && root.TF && root.TF.safehtml;
    if (S && typeof S.sanitizeMindTree === "function") return S.sanitizeMindTree;
    if (typeof module !== "undefined" && module.exports && typeof require === "function") {
      try { return require("./safehtml.js").sanitizeMindTree; } catch (_) {}
    }
    return null;
  }
  function sanitizeData(data) {
    const fn = mindSanitizer();
    if (fn) {
      try { return fn(data); } catch (_) {}
    }
    if (data === null || typeof data !== "object") return data;
    try {
      return JSON.parse(JSON.stringify(data, (k, v) => {
        if (k === "parent" && v && typeof v === "object") return undefined;
        if (/^dangerously/i.test(k) || k === "hyperLink") return undefined;
        return v;
      }));
    } catch (_) {
      return { nodeData: { id: "root", topic: "mindmap", root: true, children: [] } };
    }
  }

  // Riwayat undo mesin setelah pohon diganti dari luar (remoteUpdate, refresh dari induk). Plugin undo mind-elixir
  // menyimpan snapshot `getData()` yang hanya maju pada event "operation"; refresh() tidak memajukannya, sehingga
  // Ctrl+Z sesudahnya memulihkan pohon SEBELUM pembaruan (perubahan anggota lain terhapus pada simpan berikutnya).
  // clearHistory() mengosongkan riwayat dan mengambil snapshot baru. false = mesin tanpa undo (allowUndo:false).
  function resetUndo(mind) {
    if (!mind || typeof mind.clearHistory !== "function") return false;
    try { mind.clearHistory(); } catch (_) { return false; }
    return true;
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
    exitFocusMode: exitFocusMode,
    reloadEngine: reloadEngine,
    sanitizeData: sanitizeData,
    resetUndo: resetUndo,
    LINKED_HIDDEN_SELECTORS: LINKED_HIDDEN_SELECTORS,
  };
});
