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


  // ---- summarizeSection -------------------------------------------------

  const EXCERPT_MAX = 120;
  const ITEM_MAX = 40;
  const ITEMS_LIMIT = 3;
  const LIST_RE = /^(\s*)(?:[-*+]|\d+\.)\s+(.*)$/;
  const TASK_RE = /^\[([ xX])\](?:\s+|$)/;
  const TABLE_DELIM_RE = /^\s*\|[\s:|-]*-[\s:|-]*$/;

  // Potong di batas kata (bila ada) sehingga hasil ≤ max, lalu tambah "…".
  function truncate(s, max) {
    if (s.length <= max) return s;
    let cut = s.slice(0, max);
    if (s[max] !== " ") {
      const sp = cut.lastIndexOf(" ");
      if (sp > 0) cut = cut.slice(0, sp);
    }
    return cut.trimEnd() + "…";
  }

  const collapse = (s) => s.replace(/\s+/g, " ").trim();

  function stripFences(text) {
    const out = [];
    let fence = null;
    for (const line of text.split("\n")) {
      if (fence) {
        const m = line.match(/^ {0,3}(`+|~+)[ \t]*$/);
        if (m && m[1][0] === fence.ch && m[1].length >= fence.len) fence = null;
        out.push("");
      } else {
        const f = line.match(FENCE_OPEN_RE);
        if (f) {
          fence = { ch: f[1][0], len: f[1].length };
          out.push("");
        } else out.push(line);
      }
    }
    return out.join("\n");
  }

  function inlineClean(s) {
    return s
      .replace(/\*\*|__|~~|==|`/g, "")
      .replace(/\*([^*\n]+)\*/g, "$1")
      .replace(/(^|\W)_([^_\n]+)_(?!\w)/g, "$1$2");
  }

  const indentOf = (s) => s.match(/^[ \t]*/)[0].replace(/\t/g, "    ").length;

  function summarizeSection(body) {
    let text = String(body == null ? "" : body).replace(/\r/g, "");
    let images = 0;

    text = stripFences(text).replace(/\$\$[\s\S]*?\$\$/g, "");
    text = text.replace(/<\/?[a-zA-Z][^>]*>/g, "");
    text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, () => (images++, ""));
    text = text.replace(/::draw\[[^\]]*\](?:\{[^}]*\})?/g, () => (images++, ""));
    text = text
      .replace(/\[tasklink:[^\]]*\]/g, "")
      .replace(/\[\[([^\]]*)\]\]/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

    // Klasifikasi baris.
    const rows = [];
    let inList = false; // sedang dalam butir daftar (lanjutan menjorok ≥ 2)
    for (let line of text.split("\n")) {
      if (/^ {0,3}>\s*\[![^\]]*\]/.test(line)) line = "";
      while (/^ {0,3}>/.test(line)) line = line.replace(/^ {0,3}>[ \t]?/, "");
      let row;
      if (line.trim() === "") {
        row = { kind: "blank" };
        inList = false;
      } else if (/^\s*\|/.test(line)) {
        row = { kind: "table", line };
        inList = false;
      } else if (LIST_RE.test(line)) {
        const m = line.match(LIST_RE);
        row = { kind: "list", indent: indentOf(m[1]), raw: m[2] };
        inList = true;
      } else if (inList && indentOf(line) >= 2) {
        row = { kind: "cont" };
      } else {
        row = { kind: "text", line };
        inList = false;
      }
      rows.push(row);
    }

    // Tabel: run baris berawalan "|" dengan baris kedua berupa pemisah.
    let tables = 0;
    for (let i = 0; i < rows.length; ) {
      if (rows[i].kind !== "table") { i++; continue; }
      let j = i;
      while (j < rows.length && rows[j].kind === "table") j++;
      if (j - i >= 2 && TABLE_DELIM_RE.test(rows[i + 1].line)) tables++;
      i = j;
    }

    // Checklist (semua tingkat) dan butir tingkat teratas dari daftar pertama.
    let checkDone = 0, checkTotal = 0;
    const topItems = [];
    let firstBlockDone = false;
    let inFirstBlock = false;
    for (const r of rows) {
      if (r.kind === "list") {
        const t = r.raw.match(TASK_RE);
        if (t) {
          checkTotal++;
          if (t[1] !== " ") checkDone++;
        }
        if (!firstBlockDone) {
          inFirstBlock = true;
          if (r.indent < 2) {
            const txt = collapse(inlineClean(t ? r.raw.slice(t[0].length) : r.raw));
            if (txt) topItems.push(txt);
          }
        }
      } else if (r.kind === "cont") {
        // lanjutan butir: tidak mengakhiri blok
      } else if (inFirstBlock) {
        firstBlockDone = true;
      }
    }
    const items = topItems.slice(0, ITEMS_LIMIT).map((s) => truncate(s, ITEM_MAX));
    const more = Math.max(0, topItems.length - ITEMS_LIMIT);

    // Excerpt: paragraf pertama.
    let excerpt = "";
    const para = [];
    for (const r of rows) {
      if (r.kind === "text") {
        para.push(r.line);
        continue;
      }
      if (r.kind === "cont") continue;
      if (collapse(inlineClean(para.join(" "))) !== "") break;
      para.length = 0;
    }
    const ptext = collapse(inlineClean(para.join(" ")));
    if (ptext) {
      const sentences = (ptext.match(/.+?[.!?](?=\s|$)|.+$/g) || []).map((s) => s.trim()).filter(Boolean);
      excerpt = sentences[0] || "";
      for (let i = 1; excerpt.length < 20 && i < sentences.length; i++) excerpt += " " + sentences[i];
      excerpt = truncate(excerpt, EXCERPT_MAX);
    }

    const counts = { checkDone, checkTotal, images, tables };
    const empty = !excerpt && !items.length && !checkTotal && !images && !tables;
    return empty ? null : { excerpt, items, more, counts };
  }

  // ---- buildMindData ----------------------------------------------------

  const KEY_SEP = "\u001f";
  const COLLAPSE_NODE_LIMIT = 30;
  const DEFAULT_ROOT_TITLE = "Tanpa judul";

  const LINKED_VIEW_STATE_DEFAULT = Object.freeze({
    linked: 1,
    direction: 2,
    justify: false,
    collapsed: Object.freeze([]),
    summary: true,
  });

  // Satu lintasan: sid -> kunci jalur (teks kembar sesama saudara diberi #2, #3, ...).
  function computePathKeys(parsed) {
    const bySid = new Map(parsed.sections.map((s) => [s.sid, s]));
    const keys = new Map();
    const visit = (sids, prefix) => {
      const seen = new Map();
      for (const sid of sids) {
        const sec = bySid.get(sid);
        const n = (seen.get(sec.text) || 0) + 1;
        seen.set(sec.text, n);
        const key = prefix + (prefix ? KEY_SEP : "") + sec.text + (n > 1 ? "#" + n : "");
        keys.set(sid, key);
        visit(sec.childSids, key);
      }
    };
    visit(parsed.sections.filter((s) => s.parentSid === null).map((s) => s.sid), "");
    return keys;
  }

  function pathKey(parsed, sid) {
    return computePathKeys(parsed).get(sid);
  }

  function buildMindData(parsed, opts) {
    const o = opts || {};
    const saved = o.viewState && Array.isArray(o.viewState.collapsed) ? new Set(o.viewState.collapsed) : null;
    const keys = computePathKeys(parsed);
    const bySid = new Map(parsed.sections.map((s) => [s.sid, s]));
    const collapseDeep = !saved && parsed.sections.length > COLLAPSE_NODE_LIMIT;

    const make = (sid, depth) => {
      const sec = bySid.get(sid);
      return {
        id: sid,
        topic: sec.text,
        expanded: saved ? !saved.has(keys.get(sid)) : !(collapseDeep && depth >= 2),
        children: sec.childSids.map((c) => make(c, depth + 1)),
        nm: { sid, level: sec.level, summary: summarizeSection(sec.body) },
      };
    };

    return {
      nodeData: {
        id: "root",
        topic: o.title || DEFAULT_ROOT_TITLE,
        root: true,
        expanded: true,
        nm: { sid: null, level: 0, summary: summarizeSection(parsed.intro) },
        children: parsed.sections.filter((s) => s.parentSid === null).map((s) => make(s.sid, 1)),
      },
    };
  }

  return { parseNote, summarizeSection, pathKey, buildMindData, LINKED_VIEW_STATE_DEFAULT };
});
