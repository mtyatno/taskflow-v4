;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    root.TF.notemap = factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  const HEADING_RE = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*\r?$/;
  const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;
  const QUOTE_RE = /^ {0,3}>/;

  // Pisah baris beserta pemisahnya, sehingga gabungan semua baris == input.
  function splitLines(md) {
    return md.match(/[^\n]*\n|[^\n]+$/g) || [];
  }

  const countMatches = (s, re) => (s.match(re) || []).length;

  function parseNote(markdown) {
    const md = String(markdown == null ? "" : markdown);
    const lines = splitLines(md);
    const firstEnded = lines.find((l) => l.endsWith("\n"));
    const eol = firstEnded && firstEnded.endsWith("\r\n") ? "\r\n" : "\n";

    let intro = "";
    const sections = [];
    const stack = [];
    let fence = null;
    let detailsDepth = 0;

    for (const raw of lines) {
      const line = raw.replace(/\r?\n$/, "").replace(/\r$/, "");
      let heading = null;

      if (fence) {
        const m = line.match(/^ {0,3}(`+|~+)[ \t]*$/);
        if (m && m[1][0] === fence.ch && m[1].length >= fence.len) fence = null;
      } else {
        const f = line.match(FENCE_OPEN_RE);
        if (f) {
          fence = { ch: f[1][0], len: f[1].length };
        } else {
          const wasOutside = detailsDepth === 0;
          if (wasOutside && !QUOTE_RE.test(line)) {
            const h = line.match(HEADING_RE);
            if (h && h[2].trim() !== "") heading = h;
          }
          detailsDepth += countMatches(line, /<details\b/gi);
          detailsDepth -= countMatches(line, /<\/details>/gi);
          if (detailsDepth < 0) detailsDepth = 0;
        }
      }

      if (heading) {
        const index = sections.length;
        const level = heading[1].length;
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        const parent = stack.length ? stack[stack.length - 1] : null;
        const section = {
          sid: "s" + index,
          index,
          level,
          text: heading[2].trim(),
          headingLine: raw,
          body: "",
          parentSid: parent ? parent.sid : null,
          childSids: [],
        };
        if (parent) parent.childSids.push(section.sid);
        sections.push(section);
        stack.push(section);
      } else if (sections.length) {
        sections[sections.length - 1].body += raw;
      } else {
        intro += raw;
      }
    }

    return { intro, sections, eol };
  }

  return { parseNote };
});
