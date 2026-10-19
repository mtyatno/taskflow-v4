"use strict";

const { test } = require("node:test");
const assertStrict = require("node:assert/strict");
const assert = Object.assign((v, m) => assertStrict.ok(v, m), assertStrict, {
  deepEqual: (a, b, m) => assertStrict.deepEqual(JSON.parse(JSON.stringify(a)), b, m),
});
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "../..");
const html = fs.readFileSync(path.join(rootDir, "static/index.html"), "utf8");
const markedSrc = fs.readFileSync(path.join(rootDir, "static/vendor/marked.min.js"), "utf8");

function slice(startMarker, endMarker) {
  const a = html.indexOf(startMarker);
  assert.ok(a >= 0, "marker not found: " + startMarker);
  const b = html.indexOf(endMarker, a);
  assert.ok(b > a, "end marker not found: " + endMarker);
  return html.slice(a, b);
}

function makeCtx({ withMarked = true } = {}) {
  const sandbox = { console, setTimeout, clearTimeout };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  if (withMarked) vm.runInContext(markedSrc, sandbox);
  const code = [
    "var NOTE_CALLOUT_TYPES = {};",
    "function escapeHtml(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}",
    "function escapeAttr(s){return escapeHtml(s).replace(/\"/g,'&quot;');}",
    "function mediaUrl(u){return u;}",
    "function renderMath(l){return '[math:'+l+']';}",
    "function parseWikilinkRaw(t){return {title:t,label:t,raw:t};}",
    "function parseDirectiveAttrs(){return {};}",
    "function normalizeWikiText(s){return String(s).trim().toLowerCase();}",
    withMarked ? slice("// Item task berisi blok?", "\n});\n") + "\n});\n" : "var _markedHIdx = 0;",
    slice("function repairQuoteMarkdown(md) {", "window.hydrateDrawingPreviews = function"),
    slice("function extractHeadings(content) {", "// Heading top-level dokumen ProseMirror"),
    "this.renderMarkdown = renderMarkdown; this.extractHeadings = extractHeadings;",
  ].join("\n");
  vm.runInContext(code, sandbox);
  // renderMarkdown mengambil window.TF.safehtml saat dipanggil (static/offline/safehtml.js)
  vm.runInContext(fs.readFileSync(path.join(rootDir, "static/offline/safehtml.js"), "utf8"), sandbox);
  return sandbox;
}

const ctx = makeCtx();
const strip = (s) => s.replace(/<[^>]+>/g, "").trim();
function rendered(md) {
  const out = [];
  const re = /<h([1-6]) id="note-h-(\d+)">([\s\S]*?)<\/h\1>/g;
  let m;
  const h = ctx.renderMarkdown(md);
  while ((m = re.exec(h))) out.push({ level: +m[1], idx: +m[2], text: strip(m[3]) });
  return out;
}

test("TOC dasar tetap bekerja", () => {
  const md = "# A\n\ntext\n\n## B\n\n### C";
  assert.deepEqual(ctx.extractHeadings(md).map(h => [h.level, h.text, h.idx]), [[1, "A", 0], [2, "B", 1], [3, "C", 2]]);
});

test("1. baris # di dalam blok kode tidak ikut dan idx sejalan", () => {
  const md = "```\n# bukan heading\n```\n\n# Asli\n\n## Kedua";
  const hs = ctx.extractHeadings(md);
  assert.deepEqual(hs.map(h => h.text), ["Asli", "Kedua"]);
  const r = rendered(md);
  for (const h of hs) assert.equal(r.find(x => x.idx === h.idx).text, h.text);
});

test("2. fence ~~~ dan fence 4 backtick berisi ```", () => {
  const md = "~~~\n# a\n~~~\n\n````\n```\n# b\n```\n# c\n````\n\n# Asli";
  const hs = ctx.extractHeadings(md);
  assert.deepEqual(hs.map(h => h.text), ["Asli"]);
  assert.equal(rendered(md)[0].idx, hs[0].idx);
});

test("3. math blok $$ berisi # x", () => {
  const md = "$$\n# x\n$$\n\n# Asli";
  const hs = ctx.extractHeadings(md);
  assert.deepEqual(hs.map(h => h.text), ["Asli"]);
  assert.equal(rendered(md)[0].idx, hs[0].idx);
  assert.ok(!hs.some(h => /MATH\d+MATHEND/.test(h.text)));
});

test("3b. math inline di heading dikembalikan, bukan placeholder", () => {
  const hs = ctx.extractHeadings("# Rumus $x^2$ di sini");
  assert.equal(hs[0].text, "Rumus $x^2$ di sini");
});

test("4. heading di dalam blockquote konsisten dengan render", () => {
  const md = "# Satu\n\n> ## Kutip\n\n# Tiga";
  const hs = ctx.extractHeadings(md);
  const r = rendered(md);
  assert.deepEqual(hs.map(h => h.idx), r.map(h => h.idx));
  assert.deepEqual(hs.map(h => h.text), r.map(h => h.text));
});

test("5. heading kosong # di antara heading lain", () => {
  const md = "# Satu\n\n#\n\n# Tiga";
  const hs = ctx.extractHeadings(md);
  assert.deepEqual(hs.map(h => [h.text, h.idx]), [["Satu", 0], ["Tiga", 2]]);
  const r = rendered(md);
  for (const h of hs) assert.equal(r.find(x => x.idx === h.idx).text, h.text);
});

test("6. heading setext konsisten dengan render", () => {
  const md = "Judul\n=====\n\n# Lain\n\nSub\n---";
  const hs = ctx.extractHeadings(md);
  const r = rendered(md);
  assert.deepEqual(hs.map(h => h.idx), r.map(h => h.idx));
  assert.deepEqual(hs.map(h => h.text), r.map(h => h.text));
  assert.deepEqual(hs.map(h => h.level), r.map(h => h.level));
});

test("7. invarian campuran: idx subset id render dan teks cocok", () => {
  const docs = [
    "# A\n```js\n# x\n```\n- item\n  ## di list\n> # q\n\n$$\n# m\n$$\n## Z\n#\n### Akhir",
    "intro\n\n~~~\n# k\n~~~\n\nT\n=\n\n- [ ] # tugas\n- [x] biasa\n\n# $a$ b",
    "> [!NOTE] > isi\n\n# H1\n\n\\> ## kutip lolos\n\n## H2",
  ];
  for (const md of docs) {
    const hs = ctx.extractHeadings(md);
    const r = rendered(md);
    for (const h of hs) {
      const m = r.find(x => x.idx === h.idx);
      assert.ok(m, "idx " + h.idx + " tidak ada di render untuk: " + JSON.stringify(md));
      assert.equal(m.level, h.level);
      assert.equal(m.text.replace(/\[math:|\]/g, ""), h.text.replace(/\$/g, ""));
    }
  }
});

test("fallback tanpa marked melewati isi fence", () => {
  const c2 = makeCtx({ withMarked: false });
  const md = "```\n# x\n```\n~~~~\n~~~\n# y\n~~~~\n# Asli\n#\n## B";
  assert.deepEqual(c2.extractHeadings(md).map(h => [h.text, h.idx]), [["Asli", 0], ["B", 2]]);
});

test("8. wikilink lintas baris tidak membuat heading palsu", () => {
  const md = "[[a\n# x]]\n# R";
  const hs = ctx.extractHeadings(md);
  const r = rendered(md);
  assert.deepEqual(hs.map(h => [h.idx, h.text]), r.map(h => [h.idx, h.text]));
});

test("9. normalisasi tabel tidak menggeser heading", () => {
  const md = "# A\ntext\n| a | b |\n|---|---|\n| 1 | 2 |\n# B\n\\| x \\|\n## C";
  const hs = ctx.extractHeadings(md);
  const r = rendered(md);
  assert.deepEqual(hs.map(h => [h.idx, h.level, h.text]), r.map(h => [h.idx, h.level, h.text]));
});

test("10. ::draw dan ==highlight== di heading: teks mentah, idx sejalan", () => {
  const md = "# ==pen== judul\n\n::draw[abc]{title: x\n# palsu\n}\n\n## Z";
  const hs = ctx.extractHeadings(md);
  const r = rendered(md);
  assert.ok(!hs.some(h => /HLMK|DRWBLK|MATH\d/.test(h.text)));
  for (const h of hs) assert.equal(r.find(x => x.idx === h.idx).level, h.level);
  assert.ok(!hs.some(h => h.text === "palsu"));
});
