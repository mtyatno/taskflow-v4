"use strict";
// XSS mindmap bersama: mesin mind-elixir memakai node.dangerouslySetInnerHTML sebagai innerHTML dan
// node.hyperLink sebagai href tanpa cek skema. Semua data yang masuk ke mesin harus lewat sanitizeMindTree.
// Iframe host: helper (mindSanitizer/cleanMindData/guardMindEngine) diuji perilakunya di vm dengan mesin
// palsu; titik masuk pesan (load/remoteUpdate/refresh) diuji di level sumber.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const rootDir = path.resolve(__dirname, "../..");
const SH = require(path.join(rootDir, "static/offline/safehtml.js"));
const OPS = require(path.join(rootDir, "static/offline/mindmapops.js"));
const iframe = fs.readFileSync(path.join(rootDir, "static/vendor/mind-elixir/index.html"), "utf8");

function slice(src, a, b) {
  const s = src.indexOf(a); assert.ok(s !== -1, a + " harus ada");
  const e = src.indexOf(b, s + a.length); assert.ok(e !== -1, b + " harus ada setelah " + a);
  return src.slice(s, e);
}

function evil() {
  return {
    nodeData: {
      id: "root", topic: "Peta", root: true,
      dangerouslySetInnerHTML: "<img src=x onerror=window.__xss=1>",
      hyperLink: "javascript:window.__xss=1",
      children: [
        { id: "a", topic: "aman", hyperLink: "https://contoh.id/x" },
        { id: "b", topic: "b", hyperLink: " JaVa&#x73;cript:x", DANGEROUSLYfoo: 1,
          children: [{ id: "c", topic: "c", dangerouslySetInnerHTML: "<svg onload=x>", hyperLink: 5 }] },
      ],
    },
    summaries: [{ id: "s", label: "S", dangerouslySetInnerHTML: "<b>x</b>" }],
    arrows: [{ id: "ar", label: "A", hyperLink: "data:text/html,x" }],
    direction: 2,
  };
}

function assertClean(d) {
  const s = JSON.stringify(d);
  assert.ok(!/dangerously/i.test(s), s);
  assert.ok(!/javascript|data:text/i.test(s), s);
  assert.equal(d.nodeData.children[0].hyperLink, "https://contoh.id/x");
  assert.equal(d.nodeData.children[1].children[0].topic, "c");
  assert.deepEqual(d.summaries, [{ id: "s", label: "S" }]);
  assert.deepEqual(d.arrows, [{ id: "ar", label: "A" }]);
}

// ── sanitizeMindTree ─────────────────────────────────────────────────

test("sanitizeMindTree strips dangerously* keys and unsafe hyperLink at every level", () => {
  const src = evil();
  const before = JSON.stringify(src);
  const out = SH.sanitizeMindTree(src);
  assertClean(out);
  assert.equal(JSON.stringify(src), before, "input tidak dimutasi (salinan dalam)");
  assert.notEqual(out.nodeData, src.nodeData);
});

test("sanitizeMindTree keeps safe links and non-container values", () => {
  for (const v of [null, undefined, 1, "x", true]) assert.equal(SH.sanitizeMindTree(v), v);
  const out = SH.sanitizeMindTree({ nodeData: { id: "r", hyperLink: "/rel/x", children: [] }, x: [1, "a", null] });
  assert.deepEqual(out, { nodeData: { id: "r", hyperLink: "/rel/x", children: [] }, x: [1, "a", null] });
  assert.equal(SH.sanitizeMindTree({ hyperLink: "mailto:a@b" }).hyperLink, "mailto:a@b");
  assert.equal(SH.sanitizeMindTree({ hyperLink: "  https://a.b  " }).hyperLink, "https://a.b");
  assert.deepEqual(SH.sanitizeMindTree({ hyperLink: "vbscript:x" }), {});
  assert.deepEqual(SH.sanitizeMindTree({ hyperLink: { toString: () => "https://a" } }), {});
});

test("sanitizeMindTree handles cycles (live nodeObj.parent), __proto__ keys and deep nesting", () => {
  const root = { id: "r", children: [] };
  const child = { id: "c", parent: root, dangerouslySetInnerHTML: "x" };
  root.children.push(child);
  const out = SH.sanitizeMindTree(child);
  assert.equal(out.parent.children[0], out, "siklus dipertahankan pada salinan");
  assert.ok(!("dangerouslySetInnerHTML" in out));

  const p = SH.sanitizeMindTree(JSON.parse('{"__proto__":{"polluted":1},"a":1}'));
  assert.equal(Object.getPrototypeOf(p), Object.prototype);
  assert.equal(({}).polluted, undefined);
  assert.deepEqual(Object.keys(p), ["__proto__", "a"]);

  let deep = { id: "d0" };
  for (let i = 1; i < 50000; i++) deep = { id: "d" + i, children: [deep], dangerouslySetInnerHTML: "x" };
  const dOut = SH.sanitizeMindTree(deep);
  assert.equal(dOut.id, "d49999");
  assert.ok(!("dangerouslySetInnerHTML" in dOut));
});

// ── mindmapops.reloadEngine ──────────────────────────────────────────

test("mindmapops.reloadEngine sanitizes before init/refresh", () => {
  for (const linked of [true, false]) {
    const calls = [];
    const fake = { init: (d) => calls.push(["init", d]), refresh: (d) => calls.push(["refresh", d]) };
    OPS.reloadEngine(fake, evil(), linked);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], linked ? "refresh" : "init");
    assertClean(calls[0][1]);
  }
  assertClean(OPS.sanitizeData(evil()));
});

// ── Iframe host: perilaku helper di vm ───────────────────────────────

const HELPERS = slice(iframe, "    function mindSanitizer() {", "    // Mesin dibuat sekali per mode");

function hostContext(win) {
  const ctx = vm.createContext({ window: win, JSON, Object, Array });
  vm.runInContext(HELPERS + "\nthis.__h = { mindSanitizer, cleanMindData, guardMindEngine, stripMindFallback };", ctx);
  return ctx.__h;
}

function fakeEngine(calls) {
  return {
    init(d) { calls.push(["init", d]); },
    refresh(d) { calls.push(["refresh", arguments.length, d]); },
    copyNodes(list, to) { calls.push(["copyNodes", list, to]); },
  };
}

test("iframe: guardMindEngine cleans init/refresh/copyNodes data (own TF.safehtml)", () => {
  const win = { TF: { safehtml: SH } };
  win.parent = win;
  const h = hostContext(win);
  assert.equal(h.mindSanitizer(), SH.sanitizeMindTree);
  const calls = [];
  const m = h.guardMindEngine(fakeEngine(calls));
  m.init(evil());
  m.refresh(evil());
  m.refresh();
  m.copyNodes([{ nodeObj: evil().nodeData }], "target");
  assertClean(calls[0][1]);
  assertClean(calls[1][2]);
  assert.deepEqual(calls[2], ["refresh", 0, undefined], "refresh() tanpa data tetap tanpa argumen");
  const pasted = calls[3][1][0].nodeObj;
  assert.ok(!/dangerously|javascript/i.test(JSON.stringify(pasted)));
  assert.equal(pasted.children[0].hyperLink, "https://contoh.id/x");
  assert.equal(calls[3][2], "target");
});

test("iframe: falls back to parent TF.safehtml, then to fail-closed strip (never raw)", () => {
  const parent = { TF: { safehtml: SH } };
  const h1 = hostContext({ parent });
  assert.equal(h1.mindSanitizer(), SH.sanitizeMindTree);
  assertClean(h1.cleanMindData(evil()));

  // induk tidak bisa diakses (lintas origin melempar) dan safehtml tidak termuat
  const win = {};
  Object.defineProperty(win, "parent", { get() { throw new Error("SecurityError"); } });
  const h2 = hostContext(win);
  assert.equal(h2.mindSanitizer(), null);
  const out = h2.cleanMindData(evil());
  const s = JSON.stringify(out);
  assert.ok(!/dangerously/i.test(s));
  assert.ok(!/hyperLink/.test(s), "fallback membuang semua hyperLink (gagal tertutup)");
  assert.equal(out.nodeData.children[1].children[0].topic, "c");

  // sanitizer melempar → tetap fallback, bukan data mentah
  const h3 = hostContext({ TF: { safehtml: { sanitizeMindTree() { throw new Error("x"); } } }, parent: null });
  assert.ok(!/dangerously|hyperLink/.test(JSON.stringify(h3.cleanMindData(evil()))));
});

// ── Iframe host: titik masuk (sumber) ────────────────────────────────

test("iframe loads safehtml.js before the host modules", () => {
  const sh = iframe.indexOf('<script src="/static/offline/safehtml.js');
  assert.ok(sh !== -1, "safehtml.js dimuat di iframe");
  assert.ok(sh < iframe.indexOf('<script src="/static/offline/mindmapops.js'));
  assert.ok(sh < iframe.indexOf("<script>\n"), "sebelum skrip inline host");
});

test("iframe: every data entry point to the engine goes through cleanMindData", () => {
  const initMind = slice(iframe, "    function initMind(data, linked) {", "\n    }\n");
  assert.match(initMind, /mind = guardMindEngine\(new ME\(opts\)\);/);
  assert.match(initMind, /mind\.init\(cleanMindData\(data\)\);/);

  const load = slice(iframe, "if (e.data && e.data.type === 'load') {", "if (e.data && e.data.type === 'setSummary')");
  assert.match(load, /initMind\(cleanMindData\(e\.data\.data\), linkedMode\)/);
  const remote = slice(iframe, "if (e.data && e.data.type === 'remoteUpdate') {", "if (e.data && e.data.type === 'refresh')");
  assert.match(remote, /mind\.refresh\(cleanMindData\(e\.data\.data\)\)/);
  const refresh = slice(iframe, "if (e.data && e.data.type === 'refresh') {", "if (e.data && e.data.type === 'setDirection')");
  assert.match(refresh, /mind\.refresh\(cleanMindData\(e\.data\.data\)\)/);

  // tidak ada init/refresh/setData mesin dengan data mentah
  const raw = iframe.match(/mind\.(?:init|refresh|setData)\((?!cleanMindData\(|\))[^)]*\)/g) || [];
  assert.deepEqual(raw, []);
});
