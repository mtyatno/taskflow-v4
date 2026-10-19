"use strict";
// XSS hardening Task 5 (spec docs/superpowers/specs/2026-10-19-xss-hardening-design.md §3, §4, §7):
// pratinjau SVG drawing selalu lewat <img src=blob:>, tidak pernah sebagai markup; daftar notifikasi lewat
// TF.safehtml.renderNotificationHtml; fallback markdown mind-elixir meng-escape topik.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "../..");
const SH_PATH = path.join(ROOT, "static/offline/safehtml.js");
const html = fs.readFileSync(path.join(ROOT, "static/index.html"), "utf8");
const meHtml = fs.readFileSync(path.join(ROOT, "static/vendor/mind-elixir/index.html"), "utf8");
const tick = () => new Promise(r => setImmediate(r));

const EVIL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" onload="window.__xss=1"><script>window.__xss=1</script></svg>';

// ── DOM tiruan minimal ───────────────────────────────────────────────────────
// innerHTML hanya boleh ditulis dengan string tanpa markup svg (placeholder konstanta).
function makeDom() {
  const created = [];
  const revoked = [];
  let seq = 0;
  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.children = [];
      this.attrs = {};
      this.style = { cssText: "" };
      this.parentNode = null;
      this.isConnected = true;
      this._html = "";
      this.innerHTMLWrites = [];
    }
    get firstChild() { return this.children[0] || null; }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
    removeChild(c) { this.children.splice(this.children.indexOf(c), 1); c.parentNode = null; return c; }
    set textContent(v) { this.children = []; this._html = ""; this._text = String(v); }
    get textContent() { return this._text || ""; }
    set innerHTML(v) {
      this.innerHTMLWrites.push(String(v));
      if (/<svg|<script|onload/i.test(String(v))) throw new Error("svg markup ditulis lewat innerHTML: " + v);
      this.children = []; this._html = String(v);
    }
    get innerHTML() { return this._html; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; }
    querySelector(sel) {
      if (/^img/.test(sel)) return this.children.find(c => c.tagName === "IMG" && (sel === "img" || "data-drawing-img" in c.attrs)) || null;
      if (sel === "svg") return this.children.find(c => c.tagName === "SVG") || null;
      return null;
    }
    querySelectorAll() { return []; }
    closest() { return null; }
  }
  const document = { createElement: tag => new El(tag) };
  const URL = {
    createObjectURL(blob) { const u = "blob:test/" + (++seq); created.push({ url: u, blob }); return u; },
    revokeObjectURL(u) { revoked.push(u); },
  };
  class Blob { constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; } }
  return { El, document, URL, Blob, created, revoked };
}

// safehtml.js dimuat ke konteks dengan DOM tiruan (jalur browser: window.TF.safehtml).
function loadSafeHtml(dom) {
  const sandbox = { document: dom.document, URL: dom.URL, Blob: dom.Blob };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SH_PATH, "utf8"), sandbox);
  return sandbox;
}

test("svgToImg returns img with blob url; non-svg returns null", () => {
  const dom = makeDom();
  const SH = loadSafeHtml(dom).TF.safehtml;
  const img = SH.svgToImg("  " + EVIL_SVG, 'Judul "<b>"');
  assert.ok(img, "svg valid → img");
  assert.equal(img.tagName, "IMG");
  assert.match(img.src, /^blob:/);
  assert.equal(img.alt, 'Judul "<b>"', "alt sebagai properti teks, apa adanya");
  assert.equal(dom.created.length, 1);
  assert.equal(dom.created[0].blob.type, "image/svg+xml");
  assert.deepEqual([...dom.created[0].blob.parts], ["  " + EVIL_SVG]);
  assert.equal(img.draggable, false, "img tidak bisa di-drag ke editor");
  for (const bad of ["", null, undefined, 42, "<div>x</div>", '<?xml version="1.0"?><svg></svg>',
    "x<svg onload=1>", "<img src=x onerror=1>", "<SVG></SVG>"]) {
    assert.equal(SH.svgToImg(bad, "t"), null, String(bad));
  }
  assert.equal(dom.created.length, 1, "tidak ada blob untuk isi ditolak");
});

test("svgToImg without DOM returns null and require() works in node", () => {
  const SH = require(SH_PATH);
  assert.equal(typeof SH.svgToImg, "function");
  assert.equal(SH.svgToImg("<svg></svg>", "t"), null);
  assert.equal(SH.mountSvgImg(null, "<svg></svg>", "t"), null);
});

test("mountSvgImg replaces content and revokes previous blob url", () => {
  const dom = makeDom();
  const SH = loadSafeHtml(dom).TF.safehtml;
  const box = dom.document.createElement("div");
  box.appendChild(dom.document.createElement("span"));
  const a = SH.mountSvgImg(box, "<svg>1</svg>", "A");
  assert.deepEqual(box.children, [a]);
  assert.equal(box.__svgUrl, a.src);
  assert.match(a.style.cssText, /width:100%/);
  assert.match(a.style.cssText, /object-fit:contain/);
  const b = SH.mountSvgImg(box, "<svg>2</svg>", "B");
  assert.deepEqual(box.children, [b]);
  assert.deepEqual(dom.revoked, [a.src], "URL lama dilepas saat diganti");
  // isi tidak valid → container tidak disentuh
  assert.equal(SH.mountSvgImg(box, "<p>x</p>", "C"), null);
  assert.deepEqual(box.children, [b]);
  SH.releaseSvgUrl(box);
  assert.deepEqual(dom.revoked, [a.src, b.src]);
  assert.equal(box.__svgUrl, null);
  SH.releaseSvgUrl(box);
  assert.equal(dom.revoked.length, 2, "release kedua tidak melepas ulang");
});

test("mountSvgImg sweeps blob urls of detached containers", () => {
  const dom = makeDom();
  const SH = loadSafeHtml(dom).TF.safehtml;
  const old = dom.document.createElement("div");
  const oldImg = SH.mountSvgImg(old, "<svg>1</svg>", "A");
  old.isConnected = false; // note dirender ulang, container lama dibuang
  SH.mountSvgImg(dom.document.createElement("div"), "<svg>2</svg>", "B");
  assert.deepEqual(dom.revoked, [oldImg.src]);
});

// ── hydrateDrawingPreviews ───────────────────────────────────────────────────
function src(name) {
  const m = html.match(new RegExp("(?:async )?function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}"));
  assert.ok(m, name + " harus ada sebagai fungsi top-level");
  return m[0];
}
function loadHydrate(env) {
  const hy = (html.match(/window\.hydrateDrawingPreviews = function\(root, force\) \{[\s\S]*?\n\};/) || [""])[0];
  assert.ok(hy, "hydrateDrawingPreviews harus ada");
  const deps = ["tfSafeHtml", "drawingPreviewLookup", "drawingLookupGone", "applyDrawingScopeUi", "noteListIdFromEl",
    "drawingEmbedScopeUi", "drawingScopeListName"].map(src).join("\n");
  const constSrc = (html.match(/const DRAWING_UNAVAILABLE_TEXT = "[^"]*";/) || [""])[0];
  const f = new Function("window", "document", "api", "navigator", constSrc + "\n" + deps + "\n" + hy + "\nreturn window.hydrateDrawingPreviews;");
  return f(env.window, env.document, env.api, env.navigator);
}
async function runHydrate(remote, opts = {}) {
  const dom = makeDom();
  const sb = loadSafeHtml(dom);
  const el = new dom.El("div");
  el.setAttribute("data-drawing-preview", "42");
  if (opts.prev) opts.prev(el, sb.TF.safehtml);
  const window = { TF: { safehtml: opts.noSafeHtml ? undefined : sb.TF.safehtml, drawingrepo: { getDrawing: async () => null, getRaw: async () => null, currentUid: () => 1 } } };
  const document = { querySelectorAll: () => [el], createElement: dom.document.createElement };
  const api = { get: async () => remote };
  const hydrate = loadHydrate({ window, document, api, navigator: { onLine: true } });
  hydrate(null, true);
  for (let i = 0; i < 10; i++) await tick();
  return { el, dom };
}

test("hydrateDrawingPreviews inserts <img>, never svg markup (svg with onload/script)", async () => {
  const { el, dom } = await runHydrate({ id: 42, title: "<img src=x onerror=1>", svg_preview: EVIL_SVG, list_id: null });
  assert.equal(el.children.length, 1);
  const img = el.children[0];
  assert.equal(img.tagName, "IMG");
  assert.match(img.src, /^blob:/);
  assert.equal(img.alt, "<img src=x onerror=1>", "judul masuk sebagai alt teks");
  assert.ok("data-drawing-img" in img.attrs);
  assert.equal(el.attrs["data-hydrated"], "true");
  assert.ok(el.innerHTMLWrites.every(w => !/<svg/i.test(w)));
  assert.equal(dom.created[0].blob.type, "image/svg+xml");
});

test("hydrateDrawingPreviews revokes previous url when re-hydrating", async () => {
  let prevUrl = null;
  const { el, dom } = await runHydrate({ id: 42, svg_preview: "<svg>new</svg>" }, {
    prev: (box, SH) => { prevUrl = SH.mountSvgImg(box, "<svg>old</svg>", "x").src; },
  });
  assert.deepEqual(dom.revoked, [prevUrl]);
  assert.equal(el.children.length, 1);
  assert.notEqual(el.children[0].src, prevUrl);
});

test("hydrateDrawingPreviews: invalid svg content → 'Gambar tidak tersedia' card, no markup", async () => {
  for (const bad of ['<?xml version="1.0"?><svg onload=1></svg>', "<img src=x onerror=1><svg>", "<div>x</div>"]) {
    const { el, dom } = await runHydrate({ id: 42, svg_preview: bad });
    assert.equal(dom.created.length, 0, bad);
    assert.equal(el.attrs["data-hydrated"], "invalid", bad);
    assert.equal(el.children.length, 1);
    assert.equal(el.children[0].textContent, "Gambar tidak tersedia");
    assert.ok(el.innerHTMLWrites.every(w => !/<svg|<img/i.test(w)), bad);
  }
  // svg belum ada (null) → placeholder bawaan tetap, bukan kartu tidak tersedia
  const { el } = await runHydrate({ id: 42, svg_preview: null });
  assert.equal(el.attrs["data-hydrated"], undefined);
  assert.equal(el.children.length, 0);
});

test("hydrateDrawingPreviews without TF.safehtml leaves placeholder (no markup)", async () => {
  const { el, dom } = await runHydrate({ id: 42, svg_preview: EVIL_SVG }, { noSafeHtml: true });
  assert.equal(dom.created.length, 0);
  assert.equal(el.children.length, 0);
  assert.notEqual(el.attrs["data-hydrated"], "true");
});

// ── Cetak, ekspor, sink lain ────────────────────────────────────────────────
test("print path uses img for drawing svg", () => {
  const print = (html.match(/const handlePrint = async \(\) => \{[\s\S]*?\n  \};/) || [""])[0];
  assert.ok(print, "handlePrint harus ada");
  assert.doesNotMatch(print, /innerHTML\s*=\s*d\.svg_preview/);
  assert.doesNotMatch(print, /includes\(['"]<svg/);
  assert.match(print, /\.mountSvgImg\(c, d\.svg_preview, /);
  assert.match(print, /trim\(\)\.startsWith\('<svg'\)/);
  // gambar ditunggu termuat sebelum window.print(), URL dilepas saat cleanup
  assert.match(print, /await Promise\.all\(imgLoads\)[\s\S]*window\.print\(\)/);
  assert.match(print, /releaseSvgUrl\(/);
});

test("no svg markup reaches innerHTML/dangerouslySetInnerHTML anywhere in the client", () => {
  const files = [path.join(ROOT, "static/index.html"), ...fs.readdirSync(path.join(ROOT, "static/offline"))
    .filter(f => f.endsWith(".js")).map(f => path.join(ROOT, "static/offline", f))];
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8");
    assert.doesNotMatch(s, /innerHTML\s*=\s*(?:svg|d\.svg_preview|[\w.]*svg_preview|[\w.]*\.svg)\b/, f);
    assert.doesNotMatch(s, /__html:\s*[\w.]*(?:svg_preview|\.svg)\b/, f);
    assert.doesNotMatch(s, /\.includes\(['"]<svg['"]\)/, f);
  }
});

test("notification list renders via TF.safehtml.renderNotificationHtml", () => {
  assert.doesNotMatch(html, /__html:\s*n\.message/);
  const m = html.match(/notifications\.map\(n => [\s\S]*?new Date\(n\.created_at\)/);
  assert.ok(m, "daftar notifikasi harus ada");
  assert.match(m[0], /renderNotificationHtml\(n\.message\)/);
  // satu-satunya tempat pesan notifikasi dirender sebagai HTML
  const lines = html.split("\n").filter(l => /\bn\.message\b/.test(l));
  assert.equal(lines.length, 1, lines.join("\n"));
  assert.match(lines[0], /^\s*__html: tfSafeHtml\(\) \? tfSafeHtml\(\)\.renderNotificationHtml\(n\.message\) : escapeHtml\(n\.message\)$/);
});

test("mind-elixir fallback escapes topic when TF.renderTopicMd missing", () => {
  const m = meHtml.match(/markdown: \(topic\) => [\s\S]*?,\n      \}, window\.TF\.mindmapops/);
  assert.ok(m, "opsi markdown harus ada");
  const expr = m[0].replace(/^markdown: /, "").replace(/,\n      \}, window\.TF\.mindmapops$/, "");
  const helpers = (meHtml.match(/function escapeTopicHtml\(s\) \{[\s\S]*?\n    \}/) || [""])[0];
  assert.ok(helpers, "escapeTopicHtml harus ada");
  const make = window => new Function("window", helpers + "\nreturn (" + expr + ");")(window);
  const evil = '<img src=x onerror=window.__xss=1> & "q"';
  assert.equal(make({ TF: {} })(evil), '&lt;img src=x onerror=window.__xss=1&gt; &amp; "q"');
  assert.equal(make({})(evil), '&lt;img src=x onerror=window.__xss=1&gt; &amp; "q"');
  assert.equal(make({ TF: {} })(null), "");
  // renderer ada → dipakai
  assert.equal(make({ TF: { mindmapoutline: { renderTopicMd: t => "R:" + t } } })("x"), "R:x");
});
