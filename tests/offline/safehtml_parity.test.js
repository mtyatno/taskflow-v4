"use strict";
// Paritas perilaku static/offline/safehtml.js dengan safehtml.py (server). Korpus yang sama dijalankan di kedua
// sisi (python3 dipanggil sebagai subprocess); hasil harus identik. Tanpa python3 tes ini dilewati — daftar
// OBFUSCATED_CASES tetap dijaga oleh tests/test_safehtml_js_parity.py di CI Python.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "../..");
const SH = require(path.join(rootDir, "static/offline/safehtml.js"));

function python(script, input) {
  const r = spawnSync("python3", ["-c", script], { cwd: rootDir, input, encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.error && r.error.code === "ENOENT") return null;
  if (r.status !== 0) throw new Error("python3 gagal: " + r.stderr);
  return JSON.parse(r.stdout);
}

// Korpus URL: kasus tetap + kombinasi deterministik potongan rumit (entity, kontrol, spasi, huruf besar).
function urlCorpus() {
  const fixed = [
    "javascript:x", "JAVASCRIPT:x", "java&#x73;cript:x", "java&#X73;cript:x", "java&#115;cript:x", "java&#115cript:x",
    "&#106;avascript:x", "&#0106;avascript:x", "&#x6A;avascript:x", "javascript&colon;x", "javascript&colon x",
    "javascript&#58;x", "javascript&#x3a;x", "java&amp;#x73;cript:x", "java&amp;amp;#x73;cript:x",
    "java&amp;amp;amp;#x73;cript:x", "java&amp;amp;amp;amp;#x73;cript:x", "java&amp;amp;amp;amp;amp;#x73;cript:x",
    "java&#1;script:x", "java&#0;script:x", "java&#13;script:x", "java&#x7f;script:x", "java&#128;script:x",
    "java&#xd800;script:x", "java&#99999999999999999999;script:x", "java&#xfdd0;script:x",
    "java&Tab;script:x", "java&NewLine;script:x", "java&nbsp;script:x", "java&nbspscript:x",
    "&ltrif;javascript:x", "&ltjavascript:x", "&lt;javascript:x", "&notin;x:y", "&notinx:y", "&not&#105;n;x:y",
    "&co&#108;on;x", "java&#x73cript:x", "java&#x;script:x", "java&#;script:x", "java&;script:x",
    " javascript:x", "　javascript:x", "﻿javascript:x", "\x1cjavascript:x", "java\x7fscript:x",
    " https://a.b ", " https://a.b ", "\x1chttps://a.b\x1f", "﻿https://a.b",
    "data:image/png;base64,AAAA", "DATA:image/PNG;BASE64,AA", "data:image/png&semi;base64,AA",
    "data:image/png;baſe64,AA", "data:image/svg+xml;base64,AA", "data:image/jpeg ;base64,AA",
    "da&#116;a:image/gif;base64,AA", "data&colon;image/webp;base64,AA", "data:text/html,x",
    "mailto:a@b", "tel:+1", "MAILTO:x", "ftp://x", "file:///x", "vbscript:x", "blob:https://a/x",
    "x.png", "/a:b", "a/b:c", "?a:b", "#a:b", "1abc:x", "+a:x", "a+b.c-d:x", "a_b:x", "Kavascript:x",
    "", " ", "&", "&amp;", "&#", "&#x", "javascript", "javascript:",
  ];
  const parts = ["java", "script", ":", "&#x73;", "&#115;", "&amp;", "&colon;", "\t", " ", "\n", "\x00",
    "J", "S", "data", "image/png", ";base64,", "https", "/", "#", "&#58", "&Tab;", "&", "#x3a;", "x"];
  const gen = [];
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let i = 0; i < 1500; i++) {
    let s = "";
    const len = 1 + rnd(6);
    for (let j = 0; j < len; j++) s += parts[rnd(parts.length)];
    gen.push(s);
  }
  return fixed.concat(gen);
}

function htmlCorpus() {
  const fixed = [
    "&lt;br&gt;", "&lt;BR /&gt;", "&lt;br/&gt;", "&lt;Details&gt;x&lt;/DETAILS&gt;", "&lt;detailſ&gt;",
    "&lt;marK&gt;", "&lt;ſummary&gt;", "<code>&lt;br&gt;</code>&lt;br&gt;", "<pre>&lt;br&gt;",
    "<preé>&lt;br&gt;</pre>&lt;br&gt;", "<pre_x>&lt;br&gt;", "<pre٠>&lt;br&gt;</pre>",
    "<code>a</code >&lt;br&gt;</code>&lt;mark&gt;", "<code>a</code﻿>&lt;br&gt;</code>&lt;mark&gt;",
    '<a title="&lt;br&gt;">&lt;br&gt;</a>', "<a title='>'>&lt;br&gt;", "<<&lt;br&gt;", "&lt;br&gt;<",
    "<PRE>&lt;br&gt;</PRE>&lt;mark&gt;", "<code class=x>&lt;mark&gt;</CODE>&lt;mark&gt;",
  ];
  const parts = ["&lt;", "&gt;", "br", "BR", " /", "/", "details", "summary", "mark", "<code>", "</code>",
    "<pre>", "</pre>", "<a title=\"", "\">", "x", " ", "\n", "&amp;", "<", ">"];
  const gen = [];
  let seed = 999;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let i = 0; i < 1500; i++) {
    let s = "";
    const len = 1 + rnd(10);
    for (let j = 0; j < len; j++) s += parts[rnd(parts.length)];
    gen.push(s);
  }
  return fixed.concat(gen);
}

function drawCorpus() {
  const vals = ["S", "s", "M", "m", "L", "l", "ſ", "FULL", "", "50%", "50%\n", "300px", "9999px", "12345px",
    "small", "Small", "medium", "large", "٣px", "３px", "1em", "x\" onclick=\"y", "-1px", "0%"];
  const out = [];
  for (const v of vals) out.push({ size: v, width: v, height: v, title: v });
  return out;
}

const PY = `
import json, sys
from safehtml import safe_url, restore_allowed_tags, safe_draw_attrs, escape_attr, escape_html
d = json.loads(sys.stdin.read())
print(json.dumps({
  "url": [safe_url(u) for u in d["url"]],
  "img": [safe_url(u, image=True) for u in d["url"]],
  "html": [restore_allowed_tags(h) for h in d["html"]],
  "draw": [safe_draw_attrs(a) for a in d["draw"]],
  "attr": [escape_attr(h) for h in d["html"]],
  "esc": [escape_html(h) for h in d["html"]],
}))
`;

test("safehtml.js matches safehtml.py on a shared corpus", (t) => {
  const corpus = { url: urlCorpus(), html: htmlCorpus(), draw: drawCorpus() };
  const py = python(PY, JSON.stringify(corpus));
  if (!py) { t.skip("python3 tidak tersedia"); return; }
  corpus.url.forEach((u, i) => {
    assert.equal(SH.safeUrl(u), py.url[i], "safeUrl " + JSON.stringify(u));
    assert.equal(SH.safeUrl(u, { image: true }), py.img[i], "safeUrl image " + JSON.stringify(u));
  });
  corpus.html.forEach((h, i) => {
    assert.equal(SH.restoreAllowedTags(h), py.html[i], "restore " + JSON.stringify(h));
    assert.equal(SH.escapeAttr(h), py.attr[i]);
    assert.equal(SH.escapeHtml(h), py.esc[i]);
  });
  corpus.draw.forEach((a, i) => assert.deepEqual(SH.safeDrawAttrs(a), py.draw[i], "draw " + JSON.stringify(a)));
});

test("OBFUSCATED_CASES identical to safehtml.py", (t) => {
  const py = python("import json; from safehtml import OBFUSCATED_CASES as C; print(json.dumps(C))", "");
  if (!py) { t.skip("python3 tidak tersedia"); return; }
  assert.deepEqual([...SH.OBFUSCATED_CASES], py);
});
