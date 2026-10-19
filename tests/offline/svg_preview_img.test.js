"use strict";
// XSS hardening Task 5 (spec docs/superpowers/specs/2026-10-19-xss-hardening-design.md §3, §4, §7):
// pratinjau SVG drawing selalu lewat <img src="data:image/svg+xml;base64,…"> (bukan blob: — blob mewarisi origin aplikasi), tidak pernah sebagai markup; daftar notifikasi lewat
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
  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.children = [];
      this.attrs = {};
      this.style = { cssText: "" };
      this.parentNode = null;
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
  const objectUrls = [];
  const document = { createElement: tag => new El(tag) };
  // blob URL tidak boleh dipakai untuk pratinjau SVG (mewarisi origin aplikasi bila dibuka top-level)
  const URL = { createObjectURL(b) { objectUrls.push(b); return "blob:test/x"; }, revokeObjectURL() {} };
  class Blob { constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; } }
  return { El, document, URL, Blob, objectUrls };
}

// safehtml.js dimuat ke konteks dengan DOM tiruan (jalur browser: window.TF.safehtml).
function loadSafeHtml(dom, extra = {}) {
  const sandbox = Object.assign({ document: dom.document, URL: dom.URL, Blob: dom.Blob, btoa, TextEncoder }, extra);
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SH_PATH, "utf8"), sandbox);
  return sandbox;
}
const DATA_PREFIX = "data:image/svg+xml;base64,";
const decodeSrc = src => {
  assert.ok(src.startsWith(DATA_PREFIX), src.slice(0, 40));
  return Buffer.from(src.slice(DATA_PREFIX.length), "base64").toString("utf8");
};

test("svgToImg returns img with data: url that decodes to the svg; non-svg returns null", () => {
  const dom = makeDom();
  const SH = loadSafeHtml(dom).TF.safehtml;
  const img = SH.svgToImg("  " + EVIL_SVG, 'Judul "<b>"');
  assert.ok(img, "svg valid → img");
  assert.equal(img.tagName, "IMG");
  assert.equal(decodeSrc(img.src), "  " + EVIL_SVG);
  assert.equal(img.alt, 'Judul "<b>"', "alt sebagai properti teks, apa adanya");
  assert.equal(img.draggable, false, "img tidak bisa di-drag ke editor");
  assert.match(img.style.cssText, /width:100%/);
  assert.match(img.style.cssText, /object-fit:contain/);
  for (const bad of ["", null, undefined, 42, "<div>x</div>", '<?xml version="1.0"?><svg></svg>',
    "x<svg onload=1>", "<img src=x onerror=1>", "<SVG></SVG>"]) {
    assert.equal(SH.svgToImg(bad, "t"), null, String(bad));
  }
  assert.equal(dom.objectUrls.length, 0, "tidak ada blob URL");
});

test("svgToImg base64 is UTF-8 safe (non-ASCII, large) with and without TextEncoder", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Rapat — ü 日本 🎨</text>' + "<g/>".repeat(60000) + "</svg>";
  for (const extra of [{}, { TextEncoder: undefined }]) {
    const SH = loadSafeHtml(makeDom(), extra).TF.safehtml;
    const img = SH.svgToImg(svg, "t");
    assert.ok(img);
    assert.equal(decodeSrc(img.src), svg);
  }
});

test("svgToImg without DOM returns null and require() works in node", () => {
  const SH = require(SH_PATH);
  assert.equal(typeof SH.svgToImg, "function");
  assert.equal(SH.svgToImg("<svg></svg>", "t"), null);
  assert.equal(SH.mountSvgImg(null, "<svg></svg>", "t"), null);
  assert.equal(SH.releaseSvgUrl, undefined, "siklus hidup blob URL dihapus");
});

test("mountSvgImg replaces content; invalid content leaves container untouched", () => {
  const dom = makeDom();
  const SH = loadSafeHtml(dom).TF.safehtml;
  const box = dom.document.createElement("div");
  box.appendChild(dom.document.createElement("span"));
  const a = SH.mountSvgImg(box, "<svg>1</svg>", "A");
  assert.deepEqual(box.children, [a]);
  const b = SH.mountSvgImg(box, "<svg>2</svg>", "B");
  assert.deepEqual(box.children, [b]);
  assert.equal(decodeSrc(b.src), "<svg>2</svg>");
  assert.equal(SH.mountSvgImg(box, "<p>x</p>", "C"), null);
  assert.deepEqual(box.children, [b]);
  assert.equal(box.__svgUrl, undefined);
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
  assert.equal(decodeSrc(img.src), EVIL_SVG);
  assert.equal(img.alt, "<img src=x onerror=1>", "judul masuk sebagai alt teks");
  assert.ok("data-drawing-img" in img.attrs);
  assert.equal(el.attrs["data-hydrated"], "true");
  assert.ok(el.innerHTMLWrites.every(w => !/<svg/i.test(w)));
  assert.equal(dom.objectUrls.length, 0);
});

test("hydrateDrawingPreviews replaces previous preview when re-hydrating", async () => {
  const { el } = await runHydrate({ id: 42, svg_preview: "<svg>new</svg>" }, {
    prev: (box, SH) => { SH.mountSvgImg(box, "<svg>old</svg>", "x"); },
  });
  assert.equal(el.children.length, 1);
  assert.equal(decodeSrc(el.children[0].src), "<svg>new</svg>");
});

test("hydrateDrawingPreviews: invalid svg content → 'Gambar tidak tersedia' card, no markup", async () => {
  for (const bad of ['<?xml version="1.0"?><svg onload=1></svg>', "<img src=x onerror=1><svg>", "<div>x</div>"]) {
    const { el, dom } = await runHydrate({ id: 42, svg_preview: bad });
    assert.equal(dom.objectUrls.length, 0, bad);
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
  const { el } = await runHydrate({ id: 42, svg_preview: EVIL_SVG }, { noSafeHtml: true });
  assert.equal(el.children.length, 0);
  assert.notEqual(el.attrs["data-hydrated"], "true");
});

// ── Cetak, ekspor, sink lain ────────────────────────────────────────────────
test("print path uses img for drawing svg and waits for it", () => {
  const print = (html.match(/const handlePrint = async \(\) => \{[\s\S]*?\n  \};/) || [""])[0];
  assert.ok(print, "handlePrint harus ada");
  assert.doesNotMatch(print, /innerHTML\s*=\s*d\.svg_preview/);
  assert.doesNotMatch(print, /includes\(['"]<svg/);
  assert.match(print, /printDrawingPreview\(c, d, SH\)/);
  // gambar ditunggu termuat sebelum window.print()
  assert.match(print, /await Promise\.all\(imgLoads\)[\s\S]*window\.print\(\)/);
});

test("printDrawingPreview: svg → <img data:>, invalid → 'Gambar tidak tersedia' text card", async () => {
  const fnSrc = src("printDrawingPreview");
  const run = (d, withSh = true) => {
    const dom = makeDom();
    const SH = withSh ? loadSafeHtml(dom).TF.safehtml : null;
    const c = new dom.El("div");
    c.appendChild(new dom.El("span"));
    const f = new Function("document", fnSrc + "\nreturn printDrawingPreview;")(dom.document);
    return { c, wait: f(c, d, SH) };
  };
  let { c, wait } = run({ title: "T", svg_preview: EVIL_SVG });
  assert.equal(c.children.length, 1);
  assert.equal(c.children[0].tagName, "IMG");
  assert.equal(decodeSrc(c.children[0].src), EVIL_SVG);
  assert.equal(c.children[0].style.maxHeight, "380px");
  assert.ok(wait && typeof wait.then === "function", "pemanggil menunggu gambar termuat");
  c.children[0].onload();
  await wait;
  for (const d of [{ svg_preview: '<?xml version="1.0"?><svg/>' }, { svg_preview: "<img src=x onerror=1>" }, { svg_preview: null }, {}]) {
    ({ c, wait } = run(d));
    assert.equal(wait, null);
    assert.equal(c.children.length, 1, JSON.stringify(d));
    assert.equal(c.children[0].textContent, "Gambar tidak tersedia");
    assert.equal(c.innerHTMLWrites.length, 0);
    // kartu tercetak: bukan kelas drawing-preview-placeholder (disembunyikan CSS cetak)
    assert.doesNotMatch(c.children[0].className, /drawing-preview-placeholder/);
  }
  ({ c, wait } = run({ svg_preview: EVIL_SVG }, false));
  assert.equal(c.children[0].textContent, "Gambar tidak tersedia");
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

test("no createObjectURL for SVG previews (safehtml.js, hydrate, print, public page script)", () => {
  const sh = fs.readFileSync(SH_PATH, "utf8");
  assert.doesNotMatch(sh, /createObjectURL|revokeObjectURL|__svgUrl/);
  assert.match(sh, /data:image\/svg\+xml;base64,/);
  const hy = (html.match(/window\.hydrateDrawingPreviews = function\(root, force\) \{[\s\S]*?\n\};/) || [""])[0];
  const print = (html.match(/const handlePrint = async \(\) => \{[\s\S]*?\n  \};/) || [""])[0];
  const pdp = src("printDrawingPreview");
  for (const block of [hy, print, pdp]) {
    assert.ok(block);
    assert.doesNotMatch(block, /createObjectURL|revokeObjectURL|releaseSvgUrl|__svgUrl/);
  }
  assert.doesNotMatch(html, /releaseSvgUrl|__svgUrl/);
  const py = fs.readFileSync(path.join(ROOT, "webapp.py"), "utf8");
  const pubSvg = (py.match(/function _showSvg\(container, svg\) \{[\s\S]*?\n  \}/) || [""])[0];
  assert.ok(pubSvg, "_showSvg halaman publik harus ada");
  assert.doesNotMatch(pubSvg, /createObjectURL|Blob/);
  assert.match(pubSvg, /data:image\/svg\+xml;base64,/);
  assert.doesNotMatch(py, /_svgUrls/);
});

test("notification list renders via TF.safehtml.renderNotificationHtml", () => {
  assert.doesNotMatch(html, /__html:\s*n\.message/);
  const m = html.match(/notifications\.map\(n => [\s\S]*?new Date\(n\.created_at\)/);
  assert.ok(m, "daftar notifikasi harus ada");
  // __html daftar notifikasi melewati renderNotificationHtml (fallback hanya escape)
  const inner = m[0].match(/__html:([\s\S]*?)\}/);
  assert.ok(inner, "daftar notifikasi merender lewat dangerouslySetInnerHTML");
  assert.match(inner[1], /renderNotificationHtml\(\s*n\.message\s*\)/);
  assert.doesNotMatch(inner[1].replace(/renderNotificationHtml\(\s*n\.message\s*\)|escapeHtml\(\s*n\.message\s*\)/g, ""), /n\.message/,
    "n.message tidak dipakai mentah");
  // tidak ada sink HTML lain yang memakai n.message
  assert.doesNotMatch(html.replace(m[0], ""), /__html:[^}]*\bn\.message/);
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
