"use strict";
// Kartu ::media di mode baca (renderMarkdown, static/index.html) + hidrasi (window.hydrateMediaCards).
// Harness sama dengan render_markdown_xss.test.js: marked.min.js + potongan index.html dijalankan di vm.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "../..");
const html = fs.readFileSync(path.join(rootDir, "static/index.html"), "utf8");
const css = fs.readFileSync(path.join(rootDir, "static/app.css"), "utf8");
const markedSrc = fs.readFileSync(path.join(rootDir, "static/vendor/marked.min.js"), "utf8");
const shSrc = fs.readFileSync(path.join(rootDir, "static/offline/safehtml.js"), "utf8");
const mdSrc = fs.readFileSync(path.join(rootDir, "static/offline/mediadirective.js"), "utf8");
const mcSrc = fs.readFileSync(path.join(rootDir, "static/offline/mediacard.js"), "utf8");

function slice(startMarker, endMarker) {
  const a = html.indexOf(startMarker);
  assert.ok(a >= 0, "marker not found: " + startMarker);
  const b = html.indexOf(endMarker, a);
  assert.ok(b > a, "end marker not found: " + endMarker);
  return html.slice(a, b);
}

function makeCtx({ modules = true } = {}) {
  const sandbox = { console: { warn() {}, log() {}, error() {} }, setTimeout() {}, clearTimeout() {} };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(markedSrc, sandbox);
  const code = [
    "window.katex = { renderToString: function (l) { return String(l); } };",
    "function mediaUrl(u) { return '/media' + u; }",
    slice("// Item task berisi blok?", "\n});\n") + "\n});\n",
    slice('function normalizeWikiText(s = "") {', "window.hydrateDrawingPreviews = function"),
    "this.renderMarkdown = renderMarkdown; this.markdownPlaceholderKeyRe = markdownPlaceholderKeyRe;",
  ].join("\n");
  vm.runInContext(code, sandbox);
  vm.runInContext(shSrc, sandbox);
  if (modules) { vm.runInContext(mdSrc, sandbox); vm.runInContext(mcSrc, sandbox); }
  return sandbox;
}

const ctx = makeCtx();
const R = (md) => ctx.renderMarkdown(md);
const bare = makeCtx({ modules: false });

const CARD_RE = /<div class="note-media-card" data-media-card data-media-cid="([^"]*)" data-media-name="([^"]*)">/g;
const cards = (out) => Array.from(out.matchAll(CARD_RE)).map((m) => ({ cid: m[1], name: m[2] }));

test("renderMarkdown: ::media jadi kartu ber-data-media-cid, nama ter-escape, tanpa <video> mentah", () => {
  const out = R('Halo\n\n::media[abc_1-Z]{name="<img src=x onerror=a>\\"q.mp4"}\n\nakhir');
  const cs = cards(out);
  assert.equal(cs.length, 1, out);
  assert.equal(cs[0].cid, "abc_1-Z");
  assert.ok(!/<img|<video|<audio|<script|<iframe/i.test(out), out);
  assert.ok(out.includes("&lt;img src=x onerror=a&gt;"), out);
  assert.ok(out.includes("Memuat…"), out);
  // keluaran deterministik (nonce tidak bocor) → innerHTML React tidak diganti tiap render
  assert.equal(R('::media[abc]{name="a.mp3"}'), R('::media[abc]{name="a.mp3"}'));
  assert.ok(!/MEDIABLK/.test(out), out);
  // bentuk ter-escape remark-stringify juga dikenali; inline di tengah kalimat juga
  assert.equal(cards(R('\\::media\\[x1\\]{name="v.mp4"}')).length, 1);
  assert.equal(cards(R('a ::media[x2] b ::media[x3]{name="z"}')).map((c) => c.cid).join(","), "x2,x3");
});

test("renderMarkdown: kartu tetap ada tanpa modul TF.mediacard/TF.mediadirective (cache SW basi)", () => {
  const out = bare.renderMarkdown('::media[q9]{name="<b>x</b>"}');
  const cs = cards(out);
  assert.equal(cs.length, 1, out);
  assert.ok(out.includes("&lt;b&gt;x&lt;/b&gt;") && !out.includes("<b>"), out);
});

test("renderMarkdown: <video src=x> yang diketik tetap teks", () => {
  const out = R('<video src=x controls></video> <audio src="y"></audio>\n\n<video>\n');
  assert.ok(!/<video|<audio/i.test(out), out);
  assert.ok(out.includes("&lt;video"), out);
});

test("renderMarkdown: ::media di dalam blok kode tetap literal", () => {
  const a = R('```\n::media[c1]{name="x"}\n```\n\n~~~md\n::media[c2]\n~~~\n\nteks `::media[c3]{name="y"}` lalu ::media[c4]');
  assert.deepEqual(cards(a).map((c) => c.cid), ["c4"], a);
  assert.ok(a.includes("::media[c1]") && a.includes("::media[c2]") && a.includes("::media[c3]"), a);
  // backtick ganda dan fence 4 backtick
  const b = R("``a ` ::media[d1] b``\n\n````\n```\n::media[d2]\n```\n````\n\n::media[d3]");
  assert.deepEqual(cards(b).map((c) => c.cid), ["d3"], b);
  // fence tak tertutup → sampai akhir dokumen tetap kode
  const c = R("::media[e1]\n\n```\n::media[e2]\n");
  assert.deepEqual(cards(c).map((x) => x.cid), ["e1"], c);
});

test("placeholder MEDIABLK tanpa nonce yang benar tidak terisi", () => {
  const re = ctx.markdownPlaceholderKeyRe("n0");
  assert.ok(re.includes("MEDIABLK"), re);
  const out = R("MEDIABLK0X0MEDIABLKEND dan MEDIABLKabcX1MEDIABLKEND");
  assert.ok(out.includes("MEDIABLK0X0MEDIABLKEND"), out);
  assert.equal(cards(out).length, 0, out);
  // placeholder di dalam atribut (alt gambar) → teks mentah ter-escape, bukan kartu
  const alt = R('![::media[m1]{name="<x>"}](c.png)');
  assert.ok(alt.includes('alt="::media[m1]{name=&quot;&lt;x&gt;&quot;}"'), alt);
  for (const m of alt.matchAll(/="([^"]*)"/g)) assert.ok(!/[<>]/.test(m[1]), alt);
  // pola cadangan (tanpa modul) identik dengan TF.mediadirective.MEDIA_REGEX
  const line = html.split("\n").find((l) => l.startsWith("const MEDIA_DIRECTIVE_RE_SRC = "));
  assert.ok(line, "MEDIA_DIRECTIVE_RE_SRC");
  const src = vm.runInNewContext(line.replace("const MEDIA_DIRECTIVE_RE_SRC = ", "").replace(/;$/, ""));
  assert.equal(src, require("../../static/offline/mediadirective.js").MEDIA_REGEX.source);
});

test("index.html: hydrateMediaCards ada, dipanggil di efek NotePanel dengan noteId, dan guard dblclick memuat [data-media-card]", () => {
  const hyd = html.indexOf("window.hydrateMediaCards = function");
  assert.ok(hyd > 0, "hydrateMediaCards tidak ditemukan");
  // di luar potongan yang dievaluasi tes vm renderMarkdown
  assert.ok(hyd > html.indexOf("window.hydrateDrawingPreviews = function"));
  const panel = slice("function NotePanel({", "const renderedNoteEl =");
  assert.match(panel, /window\.hydrateMediaCards\(tocSpyRef\.current, \{\s*noteId: note\.id,\s*noteOwnerId: note\.user_id\s*\}\)/);
  const el = slice("const renderedNoteEl =", "dangerouslySetInnerHTML");
  assert.match(el, /closest\('[^']*\[data-media-card\][^']*'\)/);
  const print = slice("const handlePrint = async", "const handleExportMd");
  assert.ok(!print.includes("hydrateMediaCards"), "print tidak menghidrasi player");
  // renderMarkdown tidak menghidrasi kartu media sendiri (butuh noteId dari pemanggil; print tidak dihidrasi)
  const rm = slice("function renderMarkdown(", "\n}\n");
  assert.ok(!/hydrateMediaCards\(/.test(rm), "renderMarkdown tidak memanggil hydrateMediaCards");
  // semua URL server dibungkus apiUrl; fetch memakai Bearer
  const block = slice("// ── Kartu media note", "// ── Akhir kartu media note");
  assert.ok(block.includes("/media/by-client/") && block.includes("apiUrl("), "meta lewat apiUrl");
  assert.ok(block.includes("'Bearer ' + "), "header Bearer");
  assert.ok(block.includes("/api/scratchpad/attachments/"), "hapus lewat endpoint attachments");
  assert.ok(block.includes('Hapus media ini?'));
  assert.ok(!/innerHTML\s*=\s*[^;]*play_url/.test(block), "player tidak dibuat lewat innerHTML");
});

test("helper hidrasi: cache meta ready dipakai sampai 60 dtk sebelum expires_at; refresh URL 30 dtk; noteId numerik", () => {
  const sb = {};
  vm.createContext(sb);
  vm.runInContext(slice("// ── Kartu media note", "// ── Akhir kartu media note").split("// ── Hidrasi kartu media")[0] +
    "\nthis.H = { mediaMetaCacheFresh, mediaUrlExpired, mediaNumericNoteId };", sb);
  const H = sb.H;
  const meta = { status: "ready", expires_at: 1000 };
  assert.equal(H.mediaMetaCacheFresh({ meta }, 939), true);
  assert.equal(H.mediaMetaCacheFresh({ meta }, 940), false);
  assert.equal(H.mediaMetaCacheFresh({ meta: { status: "processing", expires_at: 5000 } }, 1), false);
  assert.equal(H.mediaMetaCacheFresh({ meta: { status: "ready", expires_at: null } }, 1), false);
  assert.equal(H.mediaMetaCacheFresh(null, 1), false);
  assert.equal(H.mediaUrlExpired(meta, 969), false);
  assert.equal(H.mediaUrlExpired(meta, 970), true);
  assert.equal(H.mediaUrlExpired({ expires_at: null }, 1e12), false);
  assert.equal(H.mediaNumericNoteId(12), 12);
  assert.equal(H.mediaNumericNoteId("34"), 34);
  for (const bad of ["local-1", "", null, undefined, 0, -3, "1e3", 1.5, NaN]) assert.equal(H.mediaNumericNoteId(bad), null, String(bad));
});

test("app.css: gaya kartu media + aturan cetak (player disembunyikan, caption tampil)", () => {
  assert.match(css, /\.note-media-card\s*\{/);
  const p = css.indexOf("@media print");
  assert.ok(p >= 0);
  const printCss = css.slice(p);
  assert.match(printCss, /\.note-media-player[^{]*\{[^}]*display:\s*none/);
  assert.match(printCss, /\.note-media-caption[^{]*\{[^}]*display:\s*(block|flex)/);
});

// ── Hidrasi dengan DOM tiruan minimal (perilaku DOM penuh dicakup E2E Task 7) ─────────────────────────
class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.attrs = {}; this.children = []; this.parentNode = null;
    this.listeners = {}; this._html = ""; this.slot = null; this.connected = true; this.style = {}; this.paused = true; this.currentTime = 0;
  }
  get isConnected() { return this.connected; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  set innerHTML(h) {
    this._html = h; this.children.forEach((c) => { c.parentNode = null; }); this.children = [];
    this.slot = null;
    if (h.includes("data-media-player")) { this.slot = new FakeEl("div"); this.slot.parentNode = this; }
  }
  get innerHTML() { return this._html; }
  get firstChild() { return this._html ? {} : null; }
  querySelector(sel) { return sel === "[data-media-player]" ? this.slot : null; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); }
  fire(t, e) { (this.listeners[t] || []).slice().forEach((f) => f(e || {})); }
  pause() { this.paused = true; }
  load() {}
  play() { this.paused = false; return Promise.resolve(); }
  canPlayType() { return "maybe"; }
}
function hydCtx({ modules = true } = {}) {
  const sb = {
    console: { warn() {}, log() {}, error() {} }, Map, WeakMap, WeakSet, Set, JSON, Date, Number, Array, Promise,
    timers: [], fetchCalls: [], responses: [], winListeners: {},
    navigator: { onLine: true },
    localStorage: { getItem: (k) => (k === "tf_user_id" ? "5" : null) },
  };
  sb.window = sb;
  sb.setTimeout = (fn, ms) => { sb.timers.push({ fn, ms }); return sb.timers.length; };
  sb.clearTimeout = () => {};
  sb.addEventListener = (t, f) => { (sb.winListeners[t] = sb.winListeners[t] || []).push(f); };
  sb.document = { createElement: (t) => new FakeEl(t), body: new FakeEl("body") };
  sb.fetch = async (url, init) => {
    sb.fetchCalls.push({ url, init });
    const r = sb.responses.shift();
    if (!r || r === "throw") throw new TypeError("net");
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  vm.createContext(sb);
  vm.runInContext(shSrc, sb);
  if (modules) { vm.runInContext(mdSrc, sb); vm.runInContext(mcSrc, sb); }
  vm.runInContext("var __token = 'tok'; const apiUrl = (p) => (typeof p === 'string' && p.charAt(0) === '/') ? 'https://api.x' + p : p;\n" +
    slice("// ── Kartu media note", "// ── Akhir kartu media note"), sb);
  return sb;
}
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
function mkRoot(cids) {
  const root = new FakeEl("div");
  const cards = cids.map((cid) => { const c = new FakeEl("div"); c.setAttribute("data-media-cid", cid); c.setAttribute("data-media-name", "n.mp4"); return c; });
  root.querySelectorAll = () => cards;
  root.contains = () => true;
  return { root, cards };
}
const READY = (o = {}) => ({ id: 9, client_id: "c1", original_name: "Rapat.mp4", media_type: "video", mime_type: "video/mp4", status: "ready",
  uploaded_by: 5, play_url: "/media/p1", poster_url: "/media/po1", download_url: "/media/d1", expires_at: Date.now() / 1000 + 3600, ...o });

test("hydrateMediaCards: ready → meta via apiUrl+Bearer, player DOM dengan src/poster apiUrl, idempoten, cache dipakai", async () => {
  const sb = hydCtx();
  sb.responses.push({ status: 200, body: READY() });
  const { root, cards } = mkRoot(["c1"]);
  sb.hydrateMediaCards(root, { noteId: 7, noteOwnerId: 5 });
  await flush();
  assert.equal(sb.fetchCalls.length, 1);
  assert.equal(sb.fetchCalls[0].url, "https://api.x/api/scratchpad/7/media/by-client/c1");
  assert.equal(sb.fetchCalls[0].init.headers.Authorization, "Bearer tok");
  const card = cards[0];
  assert.equal(card.getAttribute("data-media-bound"), "1");
  assert.equal(card.getAttribute("data-media-state"), "ready");
  assert.ok(card.innerHTML.includes('href="https://api.x/media/d1"') && card.innerHTML.includes("Hapus"), card.innerHTML);
  const p = card.slot.children[0];
  assert.equal(p.tagName, "VIDEO");
  assert.equal(p.src, "https://api.x/media/p1");
  assert.equal(p.poster, "https://api.x/media/po1");
  assert.equal(p.getAttribute("preload"), "metadata");
  assert.equal(p.getAttribute("playsinline"), "");
  assert.equal(p.controls, true);
  sb.hydrateMediaCards(root, { noteId: 7, noteOwnerId: 5 });
  await flush();
  assert.equal(sb.fetchCalls.length, 1, "kartu yang sudah terikat tidak diambil ulang");
  // kartu baru (innerHTML React diganti) untuk cid yang sama → meta ready dari window.__mediaMetaCache
  const again = mkRoot(["c1"]);
  sb.hydrateMediaCards(again.root, { noteId: 7, noteOwnerId: 5 });
  await flush();
  assert.equal(sb.fetchCalls.length, 1);
  assert.ok(sb.__mediaMetaCache.get("7:c1"));
  assert.equal(again.cards[0].getAttribute("data-media-state"), "ready");
});

test("hydrateMediaCards: URL kedaluwarsa saat error → meta baru tanpa cache, src diganti, posisi + putar dipulihkan", async () => {
  const sb = hydCtx();
  sb.responses.push({ status: 200, body: READY({ expires_at: Date.now() / 1000 + 10 }) }); // < 60 dtk → tidak di-cache-pakai-ulang
  const { root, cards } = mkRoot(["c1"]);
  sb.hydrateMediaCards(root, { noteId: 7, noteOwnerId: 1 });
  await flush();
  const p = cards[0].slot.children[0];
  p.fire("play"); p.currentTime = 42; p.fire("timeupdate");
  sb.responses.push({ status: 200, body: READY({ play_url: "/media/p2", download_url: "/media/d2" }) });
  p.currentTime = 0;
  p.fire("error");
  await flush();
  assert.equal(sb.fetchCalls.length, 2);
  assert.equal(p.src, "https://api.x/media/p2");
  assert.strictEqual(cards[0].slot.children[0], p, "elemen player yang sama dipertahankan");
  assert.ok(cards[0].innerHTML.includes("https://api.x/media/d2"));
  p.paused = true;
  p.fire("loadedmetadata");
  assert.equal(p.currentTime, 42);
  assert.equal(p.paused, false);
  // error saat URL masih berlaku → tidak minta meta lagi
  p.fire("error");
  await flush();
  assert.equal(sb.fetchCalls.length, 2);
});

test("hydrateMediaCards: 404 → missing; jaringan gagal → offline + Coba lagi, pulih saat event online; processing dicek ulang 5 dtk", async () => {
  const sb = hydCtx();
  sb.responses.push({ status: 404 }, "throw", { status: 200, body: { id: 3, status: "processing", media_type: "audio", original_name: "a.m4a" } });
  const { root, cards } = mkRoot(["m1", "m2", "m3"]);
  sb.hydrateMediaCards(root, { noteId: "12", noteOwnerId: 5 });
  await flush();
  assert.ok(cards[0].innerHTML.includes("Media tidak tersedia untukmu"), cards[0].innerHTML);
  assert.equal(cards[1].getAttribute("data-media-state"), "offline");
  assert.ok(cards[1].innerHTML.includes('data-media-action="retry"'));
  assert.ok(cards[2].innerHTML.includes("Memproses…"));
  assert.ok(sb.timers.some((t) => t.ms === 5000));
  sb.responses.push({ status: 200, body: READY({ media_type: "audio", mime_type: "audio/mp4" }) });
  sb.winListeners.online.forEach((f) => f());
  await flush();
  assert.equal(cards[1].getAttribute("data-media-state"), "ready");
  assert.equal(cards[1].slot.children[0].tagName, "AUDIO");
  assert.equal(cards[1].slot.children[0].getAttribute("playsinline"), null);
  // kartu yang sudah dilepas dari DOM berhenti dicek ulang
  cards[2].connected = false;
  const n = sb.fetchCalls.length;
  sb.timers.filter((t) => t.ms === 5000).forEach((t) => t.fn());
  await flush();
  assert.equal(sb.fetchCalls.length, n);
});

test("hydrateMediaCards: noteId lokal tidak meminta meta; modul TF absen tidak throw", async () => {
  const sb = hydCtx();
  const { root, cards } = mkRoot(["c1"]);
  sb.hydrateMediaCards(root, { noteId: "local-3", noteOwnerId: 5 });
  await flush();
  assert.equal(sb.fetchCalls.length, 0);
  assert.equal(cards[0].getAttribute("data-media-state"), "loading");
  // id server muncul setelah sinkron → kartu yang sama dimuat
  sb.responses.push({ status: 200, body: READY() });
  sb.hydrateMediaCards(root, { noteId: 44, noteOwnerId: 5 });
  await flush();
  assert.equal(sb.fetchCalls.length, 1);
  assert.equal(cards[0].getAttribute("data-media-state"), "ready");

  const bare2 = hydCtx({ modules: false });
  bare2.responses.push({ status: 200, body: READY() });
  const r2 = mkRoot(["c1"]);
  assert.doesNotThrow(() => bare2.hydrateMediaCards(r2.root, { noteId: 7 }));
  await flush();
  assert.equal(r2.cards[0].innerHTML, "");
});

test("hydrateMediaCards: aksi hapus/batal lewat delegasi root", async () => {
  const sb = hydCtx();
  sb.responses.push({ status: 200, body: READY() });
  const { root, cards } = mkRoot(["c1"]);
  sb.hydrateMediaCards(root, { noteId: 7, noteOwnerId: 1 });
  await flush();
  const click = root.listeners.click[0];
  const mkBtn = (act) => ({ closest: (s) => (s === "[data-media-action]" ? { getAttribute: () => act, closest: () => cards[0] } : null) });
  let asked = 0;
  sb.confirm = () => { asked++; return false; };
  click({ target: mkBtn("delete"), currentTarget: root, preventDefault() {}, stopPropagation() {} });
  await flush();
  assert.equal(asked, 1);
  assert.equal(sb.fetchCalls.length, 1, "batal konfirmasi → tidak ada DELETE");
  sb.confirm = () => true;
  sb.responses.push({ status: 200, body: {} });
  click({ target: mkBtn("delete"), currentTarget: root, preventDefault() {}, stopPropagation() {} });
  await flush();
  const del = sb.fetchCalls[1];
  assert.equal(del.url, "https://api.x/api/scratchpad/attachments/9");
  assert.equal(del.init.method, "DELETE");
  assert.equal(del.init.headers.Authorization, "Bearer tok");
  assert.ok(cards[0].innerHTML.includes("Media tidak tersedia untukmu"));
  assert.equal(sb.__mediaMetaCache.has("7:c1"), false);

  // batal: dengan manajer unggah (Task 5) → __mediaUploads.cancel(cid)
  const sb2 = hydCtx();
  const canceled = [];
  let sub = null;
  sb2.__mediaUploads = { get: (cid) => ({ cid, phase: "uploading", sent: 50, size: 100 }), subscribe: (fn) => { sub = fn; return () => {}; },
    cancel: async (cid) => { canceled.push(cid); sb2.__mediaUploads.get = (c) => ({ cid: c, phase: "canceled", sent: 80, size: 100 }); }, pending: () => [] };
  sb2.responses.push({ status: 200, body: READY({ status: "uploading", play_url: null, download_url: null, poster_url: null, expires_at: null }) });
  const r2 = mkRoot(["c1"]);
  sb2.hydrateMediaCards(r2.root, { noteId: 7, noteOwnerId: 1 });
  await flush();
  assert.ok(r2.cards[0].innerHTML.includes("Mengunggah… 50%"), r2.cards[0].innerHTML);
  assert.ok(sub, "berlangganan progres unggah");
  sb2.__mediaUploads.get = (cid) => ({ cid, phase: "uploading", sent: 80, size: 100 });
  sub("c1", { phase: "uploading", sent: 80, size: 100 });
  assert.ok(r2.cards[0].innerHTML.includes("Mengunggah… 80%"));
  sb2.responses.push({ status: 404 });
  r2.root.listeners.click[0]({ target: { closest: (s) => (s === "[data-media-action]" ? { getAttribute: () => "cancel", closest: () => r2.cards[0] } : null) },
    currentTarget: r2.root, preventDefault() {}, stopPropagation() {} });
  await flush();
  assert.deepEqual(canceled, ["c1"]);
  assert.ok(r2.cards[0].innerHTML.includes("Media tidak tersedia untukmu"));
});

test("hydrateMediaCards (editor, Task 5): 404 sebelum init unggah lokal selesai → bukan missing; muat ulang saat attId ada", async () => {
  const sb = hydCtx();
  let snap = { cid: "c1", phase: "uploading", attId: null, sent: 0, size: 100 };
  let sub = null;
  sb.__mediaUploads = { get: () => snap, subscribe: (fn) => { sub = fn; return () => {}; }, cancel: async () => {}, pending: () => [] };
  sb.responses.push({ status: 404 });
  const { root, cards } = mkRoot(["c1"]);
  sb.hydrateMediaCards(root, { noteId: 7, noteOwnerId: 5 });
  await flush();
  assert.equal(sb.fetchCalls.length, 1);
  assert.notEqual(cards[0].getAttribute("data-media-state"), "missing", cards[0].innerHTML);
  assert.ok(!cards[0].innerHTML.includes("Media tidak tersedia untukmu"));
  assert.ok(sub, "berlangganan ke manajer sambil menunggu init");
  // progres tanpa attId → tidak memicu fetch
  sub("c1", snap);
  await flush();
  assert.equal(sb.fetchCalls.length, 1);
  // init selesai (attId) → meta diambil ulang → uploading-local dengan progres
  snap = { cid: "c1", phase: "uploading", attId: 9, sent: 10, size: 100 };
  sb.responses.push({ status: 200, body: READY({ status: "uploading", play_url: null, download_url: null, poster_url: null, expires_at: null }) });
  sub("c1", snap);
  await flush();
  assert.equal(sb.fetchCalls.length, 2);
  assert.equal(cards[0].getAttribute("data-media-state"), "uploading-local");
  assert.ok(cards[0].innerHTML.includes("Mengunggah… 10%"), cards[0].innerHTML);

  // init gagal permanen (tanpa baris server) → 404 lagi → missing
  const sb2 = hydCtx();
  let snap2 = { cid: "c2", phase: "uploading", attId: null, sent: 0, size: 100 };
  let sub2 = null;
  sb2.__mediaUploads = { get: () => snap2, subscribe: (fn) => { sub2 = fn; return () => {}; }, cancel: async () => {}, pending: () => [] };
  sb2.responses.push({ status: 404 }, { status: 404 });
  const r2 = mkRoot(["c2"]);
  sb2.hydrateMediaCards(r2.root, { noteId: 7, noteOwnerId: 5 });
  await flush();
  snap2 = { cid: "c2", phase: "failed", attId: null, error: "Kuota penuh", sent: 0, size: 100 };
  sub2("c2", snap2);
  await flush();
  assert.equal(sb2.fetchCalls.length, 2);
  assert.equal(r2.cards[0].getAttribute("data-media-state"), "missing");
});
