"use strict";
// renderMarkdown (static/index.html) + marked.use: HTML mentah di-escape, allowlist §2.1, URL §2.2, kartu Alurik
// §2.3 (spec docs/superpowers/specs/2026-10-19-xss-hardening-design.md). Pola harness sama dengan
// note_toc_headings.test.js: marked.min.js + potongan index.html dijalankan di vm.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "../..");
const html = fs.readFileSync(path.join(rootDir, "static/index.html"), "utf8");
const markedSrc = fs.readFileSync(path.join(rootDir, "static/vendor/marked.min.js"), "utf8");
const shSrc = fs.readFileSync(path.join(rootDir, "static/offline/safehtml.js"), "utf8");
const SH = require(path.join(rootDir, "static/offline/safehtml.js"));

function slice(startMarker, endMarker) {
  const a = html.indexOf(startMarker);
  assert.ok(a >= 0, "marker not found: " + startMarker);
  const b = html.indexOf(endMarker, a);
  assert.ok(b > a, "end marker not found: " + endMarker);
  return html.slice(a, b);
}

// safehtml.js dimuat SETELAH skrip index (urutan terburuk): renderMarkdown harus mengambil TF.safehtml saat dipanggil.
function makeCtx({ loadSafehtml = true } = {}) {
  const sandbox = { console: { warn() {}, log() {}, error() {} }, setTimeout() {}, clearTimeout() {} };
  sandbox.window = sandbox;
  sandbox.mediaCalls = [];
  vm.createContext(sandbox);
  vm.runInContext(markedSrc, sandbox);
  const code = [
    "window.katex = { renderToString: function (l) { return '<span class=\"katex\">' + String(l).replace(/</g, '&lt;') + '</span>'; } };",
    "function mediaUrl(u) { mediaCalls.push(u); return '/media' + u; }",
    slice("// Item task berisi blok?", "\n});\n") + "\n});\n",
    slice('function normalizeWikiText(s = "") {', "window.hydrateDrawingPreviews = function"),
    "this.renderMarkdown = renderMarkdown; this.escapeHtml = escapeHtml;",
  ].join("\n");
  vm.runInContext(code, sandbox);
  if (loadSafehtml) vm.runInContext(shSrc, sandbox);
  return sandbox;
}

const ctx = makeCtx();
const R = (md, ...rest) => ctx.renderMarkdown(md, ...rest);

// ── Pemeriksa HTML sederhana (mengikuti tokenizer HTML untuk tag dan atribut) ─────────────────────────────
function decodeAttr(v) {
  return v.replace(/&(#x[0-9a-f]+|#\d+|quot|amp|lt|gt|apos);?/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k[0] === "#") return String.fromCodePoint(k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
    return { quot: '"', amp: "&", lt: "<", gt: ">", apos: "'" }[k];
  });
}
function parseTags(s) {
  const tags = [];
  let i = 0;
  const ws = /[\t\n\f\r ]/;
  while (i < s.length) {
    if (s[i] !== "<") { i++; continue; }
    if (s.startsWith("<!--", i)) { const e = s.indexOf("-->", i + 4); i = e < 0 ? s.length : e + 3; continue; }
    let j = i + 1;
    const closing = s[j] === "/";
    if (closing) j++;
    if (!/[a-zA-Z]/.test(s[j] || "")) { i++; continue; }
    let name = "";
    while (j < s.length && !ws.test(s[j]) && s[j] !== "/" && s[j] !== ">") name += s[j++];
    const attrs = [];
    while (j < s.length && s[j] !== ">") {
      if (ws.test(s[j]) || s[j] === "/") { j++; continue; }
      let an = s[j++];
      while (j < s.length && !ws.test(s[j]) && s[j] !== "/" && s[j] !== ">" && s[j] !== "=") an += s[j++];
      while (j < s.length && ws.test(s[j])) j++;
      let val = "";
      if (s[j] === "=") {
        j++;
        while (j < s.length && ws.test(s[j])) j++;
        const q = s[j];
        if (q === '"' || q === "'") {
          const e = s.indexOf(q, j + 1);
          val = s.slice(j + 1, e < 0 ? s.length : e);
          j = e < 0 ? s.length : e + 1;
        } else {
          while (j < s.length && !ws.test(s[j]) && s[j] !== ">") val += s[j++];
        }
      }
      attrs.push([an.toLowerCase(), decodeAttr(val)]);
    }
    tags.push({ name: name.toLowerCase(), closing, attrs });
    i = j + 1;
  }
  return tags;
}

const ALLOWED_TAGS = new Set(["p", "a", "img", "code", "pre", "div", "span", "button", "input", "ul", "ol", "li", "em",
  "strong", "del", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "br", "hr", "details", "summary", "mark", "table",
  "thead", "tbody", "tr", "th", "td"]);
// Handler statis buatan renderer sendiri (nilai tidak memuat data pengguna).
const STATIC_HANDLERS = [
  /^this\.style\.display='none';this\.nextSibling&&\(this\.nextSibling\.style\.display='inline'\)$/,
  /^copyCodeBlock\('code-[a-z0-9]+', this\)$/,
  /^window\.dispatchEvent\(new CustomEvent\('changeDrawingSize', \{ detail: \{ id: '[0-9a-zA-Z_-]+', size: '[SML]', width: '(50|75|100)%' \} \}\)\)$/,
  /^window\.dispatchEvent\(new CustomEvent\('openDrawing', \{ detail: '[0-9a-zA-Z_-]+' \}\)\)$/,
  /^window\.dispatchEvent\(new CustomEvent\('editDrawingModal', \{ detail: \{ id: '[0-9a-zA-Z_-]+', title: this\.closest\('\[data-draw-title\]'\)\.getAttribute\('data-draw-title'\), noteListId: window\.noteListIdFromEl \? window\.noteListIdFromEl\(this\) : undefined \} \}\)\)$/,
];
function activeProblems(out) {
  const probs = [];
  for (const t of parseTags(out)) {
    if (t.closing) continue;
    if (!ALLOWED_TAGS.has(t.name)) probs.push("tag <" + t.name + ">");
    for (const [n, v] of t.attrs) {
      if (n.startsWith("on") && !STATIC_HANDLERS.some(re => re.test(v))) probs.push(`<${t.name} ${n}=${JSON.stringify(v)}>`);
      if ((n === "href" || n === "src" || n === "action" || n === "formaction" || n === "xlink:href") &&
          SH.safeUrl(v, { image: n === "src" }) === null) probs.push(`<${t.name} ${n}=${JSON.stringify(v)}>`);
      if (n === "style" && /url\(|expression|javascript|[<>"]/i.test(v)) probs.push(`<${t.name} style=${JSON.stringify(v)}>`);
      if (!/^[a-z][a-z0-9-]*$/.test(n)) probs.push(`<${t.name}> attribute name ${JSON.stringify(n)}`);
    }
  }
  return probs;
}

// ── Tes ────────────────────────────────────────────────────────────────────────────────────────────
test("raw HTML escaped, allowlist kept, <br> in code stays text", () => {
  const a = R("a <b>x</b> <span onclick=1>y</span>\n\n<div onclick=\"x\">\nblok\n</div>");
  assert.ok(a.includes("&lt;b&gt;x&lt;/b&gt;"), a);
  assert.ok(a.includes("&lt;div onclick=&quot;x&quot;&gt;") || a.includes('&lt;div onclick="x"&gt;'), a);
  assert.deepEqual(activeProblems(a), []);
  assert.ok(!/<b>|<span onclick|<div onclick/.test(a), a);

  const b = R("x<br>y<br/>z<BR />w <mark>m</mark>\n\n<details>\n<summary>S</summary>\n\nisi\n\n</details>");
  assert.ok(b.includes("x<br>y<br>z<br>w <mark>m</mark>"), b);
  assert.ok(b.includes("<details>") && b.includes("<summary>S</summary>") && b.includes("</details>"), b);

  const c = R("kode `<br>` dan `<mark>`\n\n```\n<details>\n<br>\n```\n\n~~~html\n<br>\n~~~");
  assert.ok(c.includes("<code>&lt;br&gt;</code>") && c.includes("<code>&lt;mark&gt;</code>"), c);
  assert.ok(!c.includes("<details>") && !/<br>/.test(c), c);

  // teks sesudah tag inline <code>/<pre>/<script>/<style> (inRawBlock marked) tetap di-escape
  for (const md of ["<code><img src=x onerror=window.__xss=1 ", "a <script>b <img src=x onerror=window.__xss=1//",
    "_</mark><scr<script>ipt>>_", "<pre>x <svg/onload=window.__xss=1// ", "<style>x</style><img/src=x/onerror=1 "]) {
    const o = R(md);
    assert.deepEqual(activeProblems(o), [], md + " → " + o);
    assert.ok(!/<(img|svg|scr)/i.test(o), md + " → " + o);
  }

  // item task "rapat" (tanpa blok) memakai keluaran parser, bukan item.text mentah
  const d = R("- [ ] <img src=x onerror=window.__xss=1> *e*\n- [x] <b>s</b>");
  assert.ok(!/<img|<b>/.test(d), d);
  assert.ok(d.includes("<em>e</em>") && d.includes("&lt;b&gt;s&lt;/b&gt;"), d);
  assert.equal((d.match(/data-task-checkbox-idx/g) || []).length, 2, d);
  assert.deepEqual(activeProblems(d), []);
  const h = R("- [ ] # <img src=x onerror=window.__xss=1> **t**\n\n# Asli");
  assert.ok(!/<img|<h1 id="note-h-1"/.test(h) && h.includes('<h1 id="note-h-0">Asli</h1>'), h);
  assert.ok(h.includes("# &lt;img src=x onerror=window.__xss=1&gt; <strong>t</strong>"), h);
});

test("javascript: links become text; image src attribute breakout blocked", () => {
  const a = R("[klik](javascript:window.__xss=1) dan [**tebal**](JAVA&#x53;CRIPT:x)");
  assert.ok(!a.includes("<a "), a);
  assert.ok(a.includes("klik") && a.includes("<strong>tebal</strong>"), a);

  const ok = R('[ok](https://a.b/?q=1&r=2 "t\\"<x>\'") [rel](./x) [m](mailto:a@b)');
  assert.ok(ok.includes('<a href="https://a.b/?q=1&amp;r=2" title="t&quot;&lt;x&gt;&#x27;">ok</a>'), ok);
  assert.ok(ok.includes('<a href="./x">rel</a>') && ok.includes('<a href="mailto:a@b">m</a>'), ok);

  ctx.mediaCalls.length = 0;
  const img = R('![x](x"onerror="window.__xss=1)');
  assert.deepEqual(activeProblems(img), []);
  for (const t of parseTags(img).filter(t => t.name === "img")) {
    assert.deepEqual(t.attrs.map(a => a[0]), ["src", "alt", "onerror"], img);
  }

  ctx.mediaCalls.length = 0;
  const bad = R("![alt <i>teks</i>](javascript:window.__xss=1) ![svg](data:image/svg+xml;base64,PHN2Zz4=)");
  assert.ok(!bad.includes("<img"), bad);
  assert.ok(bad.includes("alt &lt;i&gt;teks&lt;/i&gt;") && bad.includes("svg"), bad);
  assert.deepEqual([...ctx.mediaCalls], [], "mediaUrl dipanggil hanya untuk URL yang lolos safeUrl");

  ctx.mediaCalls.length = 0;
  const good = R('![a"b<c>](/api/scratchpad/attachments/1/view)');
  assert.deepEqual([...ctx.mediaCalls], ["/api/scratchpad/attachments/1/view"]);
  assert.ok(good.includes('<img src="/media/api/scratchpad/attachments/1/view" alt="a&quot;b&lt;c&gt;"'), good);
  assert.ok(good.includes("📎 a\"b&lt;c&gt; — tidak tersedia offline") || good.includes("📎 a&quot;b&lt;c&gt; — tidak tersedia offline"), good);
});

test("obfuscated cases produce no active tag/attribute", () => {
  assert.ok(SH.OBFUSCATED_CASES.length >= 30);
  for (const md of SH.OBFUSCATED_CASES) {
    const out = R(md);
    assert.deepEqual(activeProblems(out), [], JSON.stringify(md) + "\n→ " + out);
    // juga di dalam kutipan, callout, list, tabel dan link
    for (const wrap of [s => "> " + s, s => "> [!NOTE] " + s + "\n> " + s, s => "- [ ] " + s, s => "- " + s,
      s => "| a |\n|---|\n| " + s + " |", s => "[" + s + "](https://a.b)", s => "# " + s]) {
      const w = R(wrap(md));
      assert.deepEqual(activeProblems(w), [], JSON.stringify(wrap(md)) + "\n→ " + w);
    }
  }
});

test("fuzz: combinations of payload fragments never yield active markup", () => {
  const parts = ["<img src=x onerror=a>", "<br>", "<br/onclick=1>", "<mark>", "</mark>", "<details>", "<summary>",
    "`", "```\n", "\n", "\n\n", "> ", "- [ ] ", "# ", "[", "](", ")", "![", "javascript:a", "java&#x73;cript:a",
    "\"", "'", "==", "$", "[[", "]]", "::draw[d]{width='1px\" onclick=\"a' title='\"><img src=x onerror=a>'}",
    "[tasklink:abc]", "&lt;br&gt;", "&lt;", "<", ">", "x", " ", "|", "| a |\n|---|\n", "<!--", "-->", "<a href=x>",
    "<svg onload=a>", "\\", "*", "_", "<scr<script>ipt>", "&", "&amp;", "> [!NOTE] ", "<code>", "</code>"];
  let seed = 4242;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let i = 0; i < 1500; i++) {
    let md = "";
    const len = 2 + rnd(12);
    for (let j = 0; j < len; j++) md += parts[rnd(parts.length)];
    const out = R(md, ["d"], [{ id: 1, title: "d" }], [{ id: "abc", title: "<img src=x onerror=a>", priority: "<b>" }]);
    assert.deepEqual(activeProblems(out), [], JSON.stringify(md) + "\n→ " + out);
  }
});

test("callout title/body escaped; draw attrs injection ignored", () => {
  const c = R("> [!NOTE] Judul <img src=x onerror=window.__xss=1> & co\n> <script>window.__xss=1</script> isi");
  assert.ok(c.includes('class="note-callout note-callout-note"'), c);
  assert.ok(!/<img|<script/.test(c), c);
  assert.ok(c.includes("&lt;script&gt;"), c);
  assert.deepEqual(activeProblems(c), []);
  const c2 = R("> [!TIP] A &amp; B\n> isi");
  assert.ok(c2.includes('<span class="note-callout-title">A &amp; B</span>'), c2);

  const d = R("::draw[d1]{width='x\" onclick=\"window.__xss=1' size='S\" onmouseover=\"window.__xss=1' height='1px;background:url(javascript:x)'}");
  assert.deepEqual(activeProblems(d), [], d);
  assert.ok(d.includes('data-size="L"') && d.includes("width:100%;margin:10px 0;") && d.includes("max-height:400px;"), d);

  const ok = R("::draw[d2]{size='s' width='50%' height='250px'}");
  assert.ok(ok.includes('data-size="S"') && ok.includes("width:50%;max-width:50%;") && ok.includes("max-height:250px;"), ok);

  // judul drawing tidak pernah masuk konteks string JavaScript di onclick
  const t = R("::draw[d3]{title=\"x');window.__xss=1;('\"}");
  assert.deepEqual(activeProblems(t), [], t);
  assert.ok(!/onclick="[^"]*__xss/.test(t), t);
  assert.ok(t.includes('data-draw-title="x&#x27;);window.__xss=1;(&#x27;"'), t);
});

test("placeholders inside attributes become text, not markup", () => {
  const a = R("![==x==](a.png) [l](https://a.b \"[[T]]\") ![$y$](b.png) ![::draw[d]{}](c.png)");
  assert.deepEqual(activeProblems(a), [], a);
  for (const t of parseTags(a)) for (const [, v] of t.attrs) assert.ok(!/[<>]/.test(v), JSON.stringify(v));
  assert.ok(a.includes('alt="==x=="'), a);
  assert.ok(a.includes('title="[[T]]"'), a);
  // kunci placeholder tidak bisa ditebak dari teks pengguna
  const b = R("WKLN0WKLNEND HLMK0HLMKEND ==a== [[b]]");
  assert.ok(b.includes("WKLN0WKLNEND HLMK0HLMKEND"), b);
  // placeholder di href/src: sumber mentahnya selalu diawali [ = $ : \ → tidak pernah membentuk skema
  for (const md of ["[a](==javascript:x==)", "[a]($javascript:x$)", "![a](==x==)", "[a](java==x==script:y)",
    "[a](::draw[d]{}javascript:x)", "[[x]](javascript:y)", "[==a==](https://a.b \"==t==\")"]) {
    const o = R(md);
    assert.deepEqual(activeProblems(o), [], md + " → " + o);
    for (const t of parseTags(o)) for (const [, v] of t.attrs) assert.ok(!/[<>]/.test(v), md + " → " + o);
  }
  // highlight berisi math (bersarang) tetap jalan
  const m = R("==$x$==");
  assert.ok(m.includes('<mark class="highlight-mark"><span class="math-inline"><span class="katex">x</span></span></mark>'), m);
});

test("print template escapes note title", () => {
  const line = html.split("\n").find(l => l.includes("el.innerHTML = `") && l.includes("npa-title"));
  assert.ok(line, "template cetak tidak ditemukan");
  const tpl = line.slice(line.indexOf("`"), line.lastIndexOf("`") + 1);
  const sb = { note: { title: "<img src=x onerror=window.__xss=1>" }, html: "", fmtDate: () => "d", escapeHtml: ctx.escapeHtml };
  vm.createContext(sb);
  const out = vm.runInContext(tpl, sb);
  assert.ok(!out.includes("<img"), out);
  assert.equal((out.match(/&lt;img src=x onerror=window.__xss=1&gt;/g) || []).length, 2, out);
  // ekspor Word (cadangan offline) juga meng-escape judul
  const w = html.split("\n").find(l => l.includes("const wordHtml = `"));
  assert.ok(w && /<title>\$\{escapeHtml\(title\)\}<\/title>/.test(w), w);
  assert.ok(/<h1>\$\{escapeHtml\(title\)\}<\/h1>/.test(html.slice(html.indexOf(w))), "judul h1 ekspor Word");
});

test("renderMarkdown resolves TF.safehtml lazily (module loaded after index script)", () => {
  const late = makeCtx({ loadSafehtml: false });
  // tanpa modul: gagal tertutup (semua jadi teks), tidak melempar
  const before = late.renderMarkdown("a <img src=x onerror=1> [x](javascript:1)");
  assert.ok(!before.includes("<img") && !before.includes("<a "), before);
  assert.deepEqual(activeProblems(before), []);
  vm.runInContext(shSrc, late);
  const after = late.renderMarkdown("x<br>y [ok](https://a.b) [no](javascript:1)");
  assert.ok(after.includes("x<br>y") && after.includes('<a href="https://a.b">ok</a>') && !after.includes("javascript"), after);
  assert.ok(/<script src="\/static\/offline\/safehtml\.js"><\/script>/.test(html), "safehtml.js dimuat di index.html");
});
