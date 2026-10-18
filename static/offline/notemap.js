;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    root.TF.notemap = factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  const isNode = typeof module !== "undefined" && module.exports;
  const markedLib = isNode ? require("../vendor/marked.min.js") : root.marked;
  // Dimuat malas: urutan skrip di halaman tidak dijamin saat modul didefinisikan.
  const sanitizeHrefs = (html) =>
    (isNode ? require("./mindmapoutline.js") : root.TF.mindmapoutline).sanitizeHrefs(html);

  // Heading ATX. Setara dengan /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*\r?$/
  // (hasil [tanda pagar, teks mentah]), tetapi linear: regex itu kuadratik pada
  // deretan spasi panjang di tengah baris.
  const isSpTab = (c) => c === " " || c === "\t";
  function matchHeadingLine(line) {
    let n = 0;
    while (n < line.length && line[n] === "#") n++;
    if (n < 1 || n > 6 || !isSpTab(line[n])) return null;
    let i = n;
    while (i < line.length && isSpTab(line[i])) i++;
    let rest = line.slice(i);
    if (rest.endsWith("\r")) rest = rest.slice(0, -1);
    if (/[\r\n\u2028\u2029]/.test(rest)) return null; // "." regex lama tidak melintasinya
    let e = rest.length;
    while (e > 0 && isSpTab(rest[e - 1])) e--;
    let j = e;
    while (j > 0 && rest[j - 1] === "#") j--;
    if (j < e && j > 0 && isSpTab(rest[j - 1])) {
      e = j;
      while (e > 0 && isSpTab(rest[e - 1])) e--;
    }
    return [line, line.slice(0, n), rest.slice(0, e)];
  }
  const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})([\s\S]*)$/;
  const DETAILS_OPEN_RE = /^\s*<details\b/i;
  const DETAILS_CLOSE_START_RE = /^<\/details>/i;
  const DETAILS_CLOSE_END_RE = /<\/details>$/i;
  const QUOTE_RE = /^ {0,3}>/;

  // Pisah baris beserta pemisahnya, sehingga gabungan semua baris == input.
  function splitLines(md) {
    return md.match(/[^\n]*\n|[^\n]+$/g) || [];
  }

  const countMatches = (s, re) => (s.match(re) || []).length;

  // Pembuka fence (CommonMark): ``` / ~~~ ≥ 3; info string fence backtick tidak
  // boleh memuat backtick (``` a ``` di satu baris = kode inline, bukan fence).
  function fenceOpen(line) {
    const f = line.match(FENCE_OPEN_RE);
    if (!f || (f[1][0] === "`" && f[2].includes("`"))) return null;
    return { ch: f[1][0], len: f[1].length };
  }

  // Perubahan kedalaman <details> oleh satu baris non-heading. Tag pembuka hanya
  // dihitung bila baris diawali "<details"; tag penutup hanya bila baris (trim)
  // diawali atau diakhiri "</details>" — sebutan tag di tengah kalimat diabaikan.
  function detailsDelta(line) {
    let d = 0;
    if (DETAILS_OPEN_RE.test(line)) d += countMatches(line, /<details\b/gi);
    const t = line.trim();
    if (DETAILS_CLOSE_START_RE.test(t) || DETAILS_CLOSE_END_RE.test(t)) d -= countMatches(line, /<\/details>/gi);
    return d;
  }

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
        const f = fenceOpen(line);
        if (f) {
          fence = f;
        } else {
          if (detailsDepth === 0 && !QUOTE_RE.test(line)) {
            const h = matchHeadingLine(line);
            if (h && h[2].trim() !== "") heading = h;
          }
          // Heading tidak pernah mengubah kedalaman <details>.
          if (!heading) detailsDepth = Math.max(0, detailsDepth + detailsDelta(line));
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
  const TABLE_DELIM_RE = /^\s*\|[\s:|]*-[\s:|-]*$/;
  const LINK_WIKI_RE = /\[\[([^[\]\n]*)\]\]/g;
  const LINK_MD_RE = /\[([^[\]\n]*)\]\([^()[\]\n]*\)/g;

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
        const f = fenceOpen(line);
        if (f) {
          fence = f;
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
    // Semua pola dibatasi (tanpa baris baru / pembuka berikutnya) agar linear:
    // kelas "[^>]*" dsb. kuadratik pada teks panjang tanpa penutup.
    text = text.replace(/<\/?[a-zA-Z][^<>\n]*>/g, "");
    text = text.replace(/!\[[^[\]\n]*\]\([^()[\]\n]*\)/g, () => (images++, ""));
    text = text.replace(/::draw\[[^[\]\n]*\](?:\{[^{}\n]*\})?/g, () => (images++, ""));
    text = text
      .replace(/\[tasklink:[^[\]\n]*\]/g, "")
      .replace(LINK_WIKI_RE, "$1")
      .replace(LINK_MD_RE, "$1");

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

  // ---- applyMindData / verifyStructure ----------------------------------

  const MAX_LEVEL = 6;
  const NEW_NODE_TEXT = "Node baru";
  // origSid node baru/asing: tidak cocok dengan parentSid bagian mana pun, dan
  // berbeda dari null milik root (bagian tingkat atas di bawah node baru ≠ same).
  const NO_SID = Symbol("no-sid");

  function sanitizeTopic(text) {
    return String(text == null ? "" : text)
      .replace(/\r\n|\r|\n/g, " ")
      .replace(/^#+\s*/, "")
      .trim();
  }

  const kids = (n) => (n && Array.isArray(n.children) ? n.children : []);
  const nodeSid = (n) => (n && n.nm ? n.nm.sid : undefined);

  // Susun ulang markdown dari pohon peta. Bagian yang tidak berubah (level dan
  // teks sama, bukan salinan) memakai headingLine aslinya, jadi tanpa edit hasilnya
  // identik byte per byte. Menandai tiap node non-root dengan nm.level / nm.text
  // hasil serialisasi (dipakai verifyStructure).
  function applyMindData(markdown, parsed, edited) {
    const eol = parsed.eol;
    const known = new Map(parsed.sections.map((s) => [s.sid, s]));
    const used = new Set();
    const rootLevels = parsed.sections.filter((s) => s.parentSid === null).map((s) => s.level);
    const T0 = rootLevels.length ? Math.min(...rootLevels) : 1;
    let out = parsed.intro;

    const visit = (P) => {
      const children = kids(P.node);
      const srcs = children.map((n) => known.get(nodeSid(n)));
      const isSame = (src) => !!src && src.parentSid === P.origSid;
      const firstSame = srcs.find(isSame);
      const base = firstSame ? firstSame.level + P.shift : P.isRoot ? T0 : P.level + 1;

      for (let i = 0; i < children.length; i++) {
        const n = children[i];
        const src = srcs[i];
        const isCopy = !!src && used.has(src.sid);
        if (src && !isCopy) used.add(src.sid);

        const level = isSame(src) ? src.level + P.shift : base;
        if (level > MAX_LEVEL) return false;
        const text = sanitizeTopic(n.topic) || (src ? src.text : NEW_NODE_TEXT);
        n.nm = Object.assign({}, n.nm, { level, text });

        const heading = src && !isCopy && level === src.level && text === src.text
          ? src.headingLine
          : "#".repeat(level) + " " + text + eol;
        if (out !== "" && !out.endsWith("\n")) out += eol;
        if (!src && out !== "" && !/\n\r?\n$/.test(out)) out += eol;
        out += heading + (src ? src.body : "");

        const ok = visit({
          node: n,
          isRoot: false,
          level,
          shift: src ? level - src.level : 0,
          origSid: src ? src.sid : NO_SID,
        });
        if (!ok) return false;
      }
      return true;
    };

    if (!visit({ node: edited, isRoot: true, level: 0, shift: 0, origSid: null })) {
      return { ok: false, code: "LEVEL_OVERFLOW" };
    }

    const lost = parsed.sections.filter((s) => !used.has(s.sid));
    return {
      ok: true,
      markdown: out,
      title: sanitizeTopic(edited && edited.topic),
      removed: {
        count: lost.length,
        hasContent: lost.some((s) => s.body.trim() !== ""),
        firstTitle: lost.length ? lost[0].text : null,
      },
    };
  }

  // Benar bila markdown hasil serialisasi mengurai kembali menjadi bagian yang
  // sama (jumlah, urutan, level, teks, induk) dengan node non-root pohon (pre-order).
  function verifyStructure(markdown, edited) {
    const sections = parseNote(markdown).sections;
    const nodes = []; // { node, parentPos } — parentPos -1 = root
    const walk = (n, parentPos) => kids(n).forEach((c) => {
      const pos = nodes.length;
      nodes.push({ node: c, parentPos });
      walk(c, pos);
    });
    walk(edited, -1);
    if (nodes.length !== sections.length) return false;
    return nodes.every(({ node: n, parentPos }, i) => {
      const nm = n.nm || {};
      const text = nm.text != null ? nm.text : sanitizeTopic(n.topic);
      const parentSid = parentPos < 0 ? null : sections[parentPos].sid;
      return sections[i].level === nm.level && sections[i].text === text && sections[i].parentSid === parentSid;
    });
  }

  function plainHeadingText(text) {
    return String(text == null ? "" : text)
      // Lepas escape markdown dulu (snake\_case → snake_case), sebelum normalisasi.
      .replace(/\\([!-\/:-@\[-`{-~])/g, "$1")
      .replace(LINK_WIKI_RE, "$1")
      .replace(LINK_MD_RE, "$1")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/==([^=]+)==/g, "$1")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/[*_~]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  const norm = (x) => plainHeadingText(x).toLowerCase().replace(/\s+/g, " ").trim();

  function locateHeading(parsed, sid) {
    if (sid == null || !parsed || !Array.isArray(parsed.sections)) return null;
    const list = parsed.sections;
    const index = list.findIndex((s) => s.sid === sid);
    if (index < 0) return null;
    const key = norm(list[index].text);
    let occurrence = 0;
    for (let i = 0; i < index; i++) if (norm(list[i].text) === key) occurrence++;
    return { index, text: list[index].text, occurrence };
  }

  function matchHeading(list, target) {
    if (!Array.isArray(list) || !target) return -1;
    const key = norm(target.text);
    const at = list[target.index];
    if (at && norm(at.text) === key) return target.index;
    let seen = 0;
    for (let i = 0; i < list.length; i++) {
      if (norm(list[i].text) !== key) continue;
      if (seen === target.occurrence) return i;
      seen++;
    }
    return -1;
  }

  const escHtml = (s) =>
    String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function renderTopicNoteInline(topic) {
    const pre = escHtml(topic)
      .replace(LINK_WIKI_RE, "$1")
      .replace(/==([^=]+)==/g, "<mark>$1</mark>");
    try {
      let out;
      if (markedLib && typeof markedLib.parseInline === "function") {
        // Gambar tidak pernah jadi <img>: tampilkan teks alt (sudah lolos escape
        // `& < >`; tanda kutip diubah agar aman). Renderer khusus panggilan ini,
        // tanpa mengubah marked global.
        const renderer = new markedLib.Renderer();
        renderer.image = (tok) => String(tok.text == null ? "" : tok.text).replace(/"/g, "&quot;");
        out = markedLib.parseInline(pre, { gfm: true, renderer });
      } else return pre;
      return sanitizeHrefs(out);
    } catch (_) {
      return pre;
    }
  }

  function renderSummaryHtml(summary) {
    if (!summary) return "";
    const c = summary.counts || {};
    const items = Array.isArray(summary.items) ? summary.items : [];
    const parts = [];
    if (c.checkTotal > 0) parts.push("☑ " + (c.checkDone || 0) + "/" + c.checkTotal);
    if (c.images > 0) parts.push("🖼 " + c.images);
    if (c.tables > 0) parts.push("⊞ " + c.tables);
    const ex = summary.excerpt ? '<div class="nm-sum-ex">' + escHtml(summary.excerpt) + "</div>" : "";
    const it = items.length
      ? '<div class="nm-sum-it">' + escHtml("• " + items.join(" • ") + (summary.more ? " +" + summary.more : "")) + "</div>"
      : "";
    const ct = parts.length ? '<div class="nm-sum-ct">' + escHtml(parts.join(" · ")) + "</div>" : "";
    return '<div class="nm-sum">' + ex + it + ct + "</div>";
  }

  return {
    parseNote,
    summarizeSection,
    pathKey,
    buildMindData,
    LINKED_VIEW_STATE_DEFAULT,
    sanitizeTopic,
    applyMindData,
    verifyStructure,
    plainHeadingText,
    locateHeading,
    matchHeading,
    renderTopicNoteInline,
    renderSummaryHtml,
  };
});
