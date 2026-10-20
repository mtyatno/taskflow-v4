"use strict";
// static/offline/safehtml.js — padanan klien safehtml.py. Kasus di sini sama dengan tests/test_safehtml.py;
// perilaku identik dengan server dicek juga oleh tests/offline/safehtml_parity.test.js (menjalankan python3)
// dan daftar OBFUSCATED_CASES dijaga sama oleh tests/test_safehtml_js_parity.py.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");

const SH_PATH = path.resolve(__dirname, "../../static/offline/safehtml.js");
const SH = require(SH_PATH);
const { escapeHtml, escapeAttr, restoreAllowedTags, safeUrl, safeDrawAttrs, OBFUSCATED_CASES } = SH;

test("escapeHtml basic", () => {
  assert.equal(escapeHtml('a&b<c>d"e\''), 'a&amp;b&lt;c&gt;d"e\'');
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
  assert.equal(escapeHtml(12), "12");
});

test("escapeAttr quotes", () => {
  assert.equal(escapeAttr('a"b\'c<'), "a&quot;b&#x27;c&lt;");
  assert.equal(escapeAttr("&>"), "&amp;&gt;");
  assert.equal(escapeAttr(null), "");
});

test("restoreAllowedTags exact forms only", () => {
  const src = "&lt;br&gt; &lt;br/&gt; &lt;br /&gt; &lt;BR&gt; " +
    "&lt;details&gt;&lt;summary&gt;S&lt;/summary&gt;D&lt;/details&gt; " +
    "&lt;mark&gt;m&lt;/MARK&gt;";
  assert.equal(restoreAllowedTags(src),
    "<br> <br> <br> <br> <details><summary>S</summary>D</details> <mark>m</mark>");
  for (const kept of ["&lt;br onclick=x&gt;", "&lt;mark style=x&gt;", "&lt;br  /&gt;", "&lt; br&gt;",
    "&lt;br/ &gt;", "&lt;details open&gt;", "&lt;b&gt;", "&lt;script&gt;",
    "&amp;lt;br&amp;gt;", "&lt;/br&gt;", "&lt;brx&gt;"]) {
    assert.equal(restoreAllowedTags(kept), kept, kept);
  }
  assert.equal(restoreAllowedTags(""), "");
  assert.equal(restoreAllowedTags(null), "");
});

test("allowlist not restored inside code", () => {
  assert.equal(restoreAllowedTags("<code>&lt;br&gt;</code>"), "<code>&lt;br&gt;</code>");
  const src = '<pre><code class="language-x">&lt;details&gt;\n&lt;mark&gt;</code></pre>';
  assert.equal(restoreAllowedTags(src), src);
  assert.equal(restoreAllowedTags("a&lt;br&gt;<code>&lt;br&gt;</code>&lt;br&gt;"), "a<br><code>&lt;br&gt;</code><br>");
  assert.equal(restoreAllowedTags("<code>&lt;br&gt;"), "<code>&lt;br&gt;");
  assert.equal(restoreAllowedTags("<PRE class=x>&lt;br&gt;</PRE >&lt;br&gt;"), "<PRE class=x>&lt;br&gt;</PRE ><br>");
});

test("allowlist not restored inside attributes", () => {
  const src = '<img src="x.png" alt="&lt;br&gt;"><a title="&lt;mark&gt;" href="/x">t</a>';
  assert.equal(restoreAllowedTags(src), src);
});

test("safeUrl allowed", () => {
  for (const url of ["https://a.b", "http://a.b/c?d=1&e=2#f", "HTTPS://A.B", "mailto:a@b", "tel:1",
    "/x", "./x", "../x", "x.png", "foo/bar", "#h", "", "//cdn.example/x", "a/b:c", "?q=1:2"]) {
    assert.equal(safeUrl(url), url.trim(), url);
  }
  assert.equal(safeUrl("  https://a.b \n"), "https://a.b");
});

test("safeUrl rejected", () => {
  for (const url of ["javascript:alert(1)", "JaVaScRiPt:x", "java&#x73;cript:x", "java&#115;cript:x",
    "&#106;avascript:x", "javascript&colon;x", "java&amp;#x73;cript:x",
    "\tjavascript:x", " javascript:x", "jav\x00ascript:x", "java\nscript:x", "java\tscript:x",
    "data:text/html,x", "data:image/png;base64,AAAA", "vbscript:x", "file:///etc/passwd",
    "ftp://a.b",
    // entity numerik tak valid dibuang (aturan html.unescape Python), entity tanpa titik koma
    "java&#1;script:x", "&#106avascript:x", "javascript&#58x", "javascript&#x3A;x",
    "java&Tab;script:x", "java&NewLine;script:x", "&amp;#106;avascript:x",
    "&amp;amp;#106;avascript:x"]) {
    assert.equal(safeUrl(url), null, JSON.stringify(url));
  }
});

test("safeUrl image cases", () => {
  assert.equal(safeUrl("data:image/png;base64,AAAA", { image: true }), "data:image/png;base64,AAAA");
  for (const ok of ["data:image/jpeg;base64,AA", "data:image/gif;base64,AA", "data:image/webp;base64,AA",
    "DATA:IMAGE/PNG;BASE64,AA", "https://a.b/x.png", "x.png"]) {
    assert.equal(safeUrl(ok, { image: true }), ok, ok);
  }
  for (const bad of ["data:image/svg+xml;base64,AAAA", "data:image/png,AAAA", "data:text/html;base64,AA",
    "data:image/svg+xml,<svg onload=alert(1)>", "javascript:alert(1)"]) {
    assert.equal(safeUrl(bad, { image: true }), null, bad);
  }
  assert.equal(safeUrl(null), null);
  assert.equal(safeUrl(undefined), null);
});

test("safeDrawAttrs", () => {
  assert.deepEqual(safeDrawAttrs({ size: "M", width: "50%", height: "300px" }), { size: "M", width: "50%", height: "300px" });
  assert.deepEqual(safeDrawAttrs({ width: 'x" onclick="y', size: "Q" }), {});
  assert.deepEqual(safeDrawAttrs({ size: "m", width: "small", height: "large" }), { size: "M", width: "small", height: "large" });
  for (const bad of ["50%\n", "50 %", "12345px", "calc(1px)", "1em", "-1px", "50%;color:red", "Small", ""]) {
    assert.deepEqual(safeDrawAttrs({ width: bad, height: bad }), {}, JSON.stringify(bad));
  }
  for (const bad of ["FULL", "SM", "S\n", "", 'X"onfocus=1']) {
    assert.deepEqual(safeDrawAttrs({ size: bad }), {}, JSON.stringify(bad));
  }
  assert.deepEqual(safeDrawAttrs({ title: '<b>"x"</b>', width: "9999px" }), { title: '<b>"x"</b>', width: "9999px" });
  assert.deepEqual(safeDrawAttrs(null), {});
  assert.deepEqual(safeDrawAttrs({ width: 50, size: 1 }), {});
});

test("OBFUSCATED_CASES cover review focus", () => {
  assert.ok(Array.isArray(OBFUSCATED_CASES) && OBFUSCATED_CASES.length >= 30);
  assert.ok(OBFUSCATED_CASES.every(c => typeof c === "string" && c));
  const joined = OBFUSCATED_CASES.join("\n");
  for (const needle of ["java&#x73;cript:", "JaVaScRiPt:", "\tjavascript:", "<SCRIPT>", "<scr<script>ipt>",
    "<br onclick=x>", "<mark style=", "<img src=x onerror=", "<svg onload=",
    "](javascript:", '](x"onerror="', "</title><script>"]) {
    assert.ok(joined.includes(needle), needle);
  }
});

test("browser: attaches window.TF.safehtml without clobbering TF", () => {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.TF = { other: 1 };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SH_PATH, "utf8"), sandbox);
  assert.equal(sandbox.TF.other, 1);
  assert.equal(typeof sandbox.TF.safehtml.safeUrl, "function");
  assert.equal(sandbox.TF.safehtml.safeUrl("javascript:x"), null);
});

// ── Notifikasi (spec §4) ───────────────────────────────────────────────────────
test("renderNotificationHtml legacy and new messages", () => {
  const { renderNotificationHtml: r } = SH;
  assert.equal(typeof r, "function");
  // pesan lama tersimpan mentah
  assert.equal(r("<b>A</b> <img src=x onerror=1>"), "<b>A</b> &lt;img src=x onerror=1&gt;");
  // pesan baru (ter-escape server): tidak dobel
  assert.equal(r("<b>A &amp; B</b>"), "<b>A &amp; B</b>");
  assert.equal(r("<b>&lt;img src=x onerror=1&gt;</b>"), "<b>&lt;img src=x onerror=1&gt;</b>");
  // tag dengan atribut → teks
  assert.equal(r("<b onclick=x>A</b>"), "&lt;b onclick=x&gt;A</b>");
  assert.equal(r('<i style="x">A</i>'), '&lt;i style="x"&gt;A</i>');
  assert.equal(r("<br/><br /><br onclick=1>"), "&lt;br/&gt;&lt;br /&gt;&lt;br onclick=1&gt;");
  // allowlist persis, tidak peka huruf
  assert.equal(r("<B>x</B><I>y</i><BR>z"), "<b>x</b><i>y</i><br>z");
  assert.equal(r("<script>alert(1)</script><a href=javascript:x>l</a><u>u</u>"),
    "&lt;script&gt;alert(1)&lt;/script&gt;&lt;a href=javascript:x&gt;l&lt;/a&gt;&lt;u&gt;u&lt;/u&gt;");
  // decode satu lintasan: &amp;lt; → teks "&lt;", bukan "<"
  assert.equal(r("&amp;lt;b&amp;gt;x"), "&amp;lt;b&amp;gt;x");
  assert.equal(r("&amp;lt;img src=x onerror=1&amp;gt;"), "&amp;lt;img src=x onerror=1&amp;gt;");
  // entity dasar saja yang didecode; entity ter-escape tidak bisa membentuk tag di luar allowlist
  assert.equal(r("&quot;a&quot; &#x27;b&#39; &lt;img&gt;"), "\"a\" 'b' &lt;img&gt;");
  assert.equal(r("&#60;img src=x onerror=1&#62; &nbsp; &copy;"), "&amp;#60;img src=x onerror=1&amp;#62; &amp;nbsp; &amp;copy;");
  assert.equal(r(null), "");
  assert.equal(r(undefined), "");
  assert.equal(r(5), "5");
});
