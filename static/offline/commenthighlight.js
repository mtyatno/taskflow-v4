;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Sorotan kutipan komentar lewat CSS Custom Highlight API (tanpa mengubah DOM/editor).
  // commentanchor dibaca saat dipanggil (urutan muat di browser tidak dijamin).
  const isNode = (typeof module !== "undefined" && module.exports);
  const anchor = () => (isNode ? require("./commentanchor.js") : root.TF && root.TF.commentanchor);

  const SKIP = 'script, style, button, [contenteditable="false"], .cmt-ignore';
  const KEY = "cmt";
  const KEY_ACTIVE = "cmt-active";

  function docOf(el) {
    return (el && el.ownerDocument) || (typeof document !== "undefined" ? document : null);
  }

  // Blok terdekat (dibatasi root). DOM ProseMirror tidak punya teks spasi antar blok, jadi tanpa
  // pemisah "<p>a</p><p>b</p>" menjadi "ab" dan kutipan lintas paragraf tidak ketemu.
  const BLOCK = "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th, div";
  function blockOf(p, rootEl) {
    if (!p || typeof p.closest !== "function") return null;
    const b = p.closest(BLOCK);
    if (!b || b === rootEl) return null;
    if (rootEl && typeof rootEl.contains === "function" && !rootEl.contains(b)) return null;
    return b;
  }

  function collectSegments(rootEl) {
    const doc = docOf(rootEl);
    const filter = (typeof NodeFilter !== "undefined" && NodeFilter.SHOW_TEXT) || 4;
    const walker = doc.createTreeWalker(rootEl, filter);
    const segments = [];
    let text = "";
    let node;
    let prevBlock;
    let started = false;
    while ((node = walker.nextNode())) {
      const p = node.parentElement;
      if (p && typeof p.closest === "function" && p.closest(SKIP)) continue;
      const v = node.nodeValue || "";
      if (!v.length) continue;
      const block = blockOf(p, rootEl);
      // Pindah blok → "\n" virtual di text (tanpa segmen); findQuote menormalkan spasi.
      if (started && block !== prevBlock) text += "\n";
      started = true;
      prevBlock = block;
      segments.push({ node, start: text.length, end: text.length + v.length });
      text += v;
    }
    return { text, segments };
  }

  function locate(segments, from, to) {
    if (!(to > from)) return null;
    let s = null, e = null;
    for (const g of segments || []) {
      if (!s && g.start <= from && from < g.end) s = g;
      if (!e && g.start < to && to <= g.end) e = g;
    }
    if (!s || !e) return null;
    return { startNode: s.node, startOffset: from - s.start, endNode: e.node, endOffset: to - e.start };
  }

  function rangesFor(rootEl, threads, doc) {
    const { text, segments } = collectSegments(rootEl);
    const d = doc || docOf(rootEl);
    const out = [];
    for (const t of threads || []) {
      if (!t || !t.quote) continue;
      const hit = anchor().findQuote(text, t.quote);
      if (!hit) continue;
      const loc = locate(segments, hit.from, hit.to);
      if (!loc) continue;
      const range = d.createRange();
      range.setStart(loc.startNode, loc.startOffset);
      range.setEnd(loc.endNode, loc.endOffset);
      out.push({ id: t.id, range });
    }
    return out;
  }

  function supported() {
    return typeof CSS !== "undefined" && !!CSS.highlights && typeof Highlight === "function";
  }

  function clear() {
    try {
      if (typeof CSS !== "undefined" && CSS.highlights) {
        CSS.highlights.delete(KEY);
        CSS.highlights.delete(KEY_ACTIVE);
      }
    } catch (_) { /* abaikan */ }
  }

  function apply(rootEl, threads, activeId) {
    try {
      if (!supported() || !rootEl) { clear(); return []; }
      const entries = rangesFor(rootEl, threads, docOf(rootEl));
      const isActive = (en) => activeId != null && String(en.id) === String(activeId);
      const normal = entries.filter((en) => !isActive(en)).map((en) => en.range);
      const active = entries.filter(isActive).map((en) => en.range);
      if (normal.length) CSS.highlights.set(KEY, new Highlight(...normal)); else CSS.highlights.delete(KEY);
      if (active.length) CSS.highlights.set(KEY_ACTIVE, new Highlight(...active)); else CSS.highlights.delete(KEY_ACTIVE);
      return entries;
    } catch (_) {
      clear();
      return [];
    }
  }

  function threadAt(entries, node, offset) {
    for (const en of entries || []) {
      try {
        if (en.range.isPointInRange(node, offset)) return en.id;
      } catch (_) { /* range tak valid lagi */ }
    }
    return null;
  }

  const exported = { collectSegments, locate, rangesFor, supported, apply, clear, threadAt };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.commenthighlight = exported; }
  return exported;
});
