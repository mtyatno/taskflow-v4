;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Normalisasi untuk pencocokan kutipan komentar: kutip lengkung → lurus, deret whitespace
  // (termasuk NBSP) → satu spasi. map[i] = indeks asli karakter normal ke-i.
  function normalize(s) {
    const src = String(s == null ? "" : s);
    let text = "";
    const map = [];
    let inSpace = false;
    for (let i = 0; i < src.length; i++) {
      let ch = src[i];
      if (/\s/.test(ch)) {
        if (!inSpace) { text += " "; map.push(i); inSpace = true; }
        continue;
      }
      inSpace = false;
      if (ch === "‘" || ch === "’") ch = "'";
      else if (ch === "“" || ch === "”") ch = '"';
      text += ch;
      map.push(i);
    }
    return { text, map };
  }

  function findQuote(docText, quote) {
    const q = String(quote == null ? "" : quote).trim();
    if (!q) return null;
    const doc = String(docText == null ? "" : docText);
    const exact = doc.indexOf(q);
    if (exact !== -1) return { from: exact, to: exact + q.length };
    const nd = normalize(doc);
    const nq = normalize(q).text;
    if (!nq) return null;
    const i = nd.text.indexOf(nq);
    if (i === -1) return null;
    return { from: nd.map[i], to: nd.map[i + nq.length - 1] + 1 };
  }

  const exported = { normalize, findQuote };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.commentanchor = exported; }
  return exported;
});
