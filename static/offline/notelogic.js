;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Port of webapp.py _parse_wikilinks: [[Title]] incl. remark-escaped \[\[..\]\].
  const WIKILINK_RE = /(?:\\?\[){2}([^\[\]\\]+)(?:\\?\]){2}/g;

  function parseWikilinks(content) {
    const s = String(content == null ? "" : content);
    const out = [];
    const seen = {};
    WIKILINK_RE.lastIndex = 0;
    let m;
    while ((m = WIKILINK_RE.exec(s)) !== null) {
      const title = m[1].split("|")[0].trim();
      if (title && !seen[title]) { seen[title] = true; out.push(title); }
    }
    return out;
  }

  const exported = { parseWikilinks };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.notelogic = exported; }
  return exported;
});
