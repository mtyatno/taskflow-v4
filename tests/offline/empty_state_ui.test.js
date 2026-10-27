"use strict";
// Tema PR C, Task 3: komponen bersama EmptyState (spec §3.5/§3.6, plan C2–C4).
// - Palet bertema + dekorasi aktif → maskot dari slot "empty-<kind>" (96 px, 40 px bila compact).
// - Selain itu → ikon duotone VIEW_GLYPHS (emptyDone/emptySearch/emptyInbox) 36 px (18 px bila compact).
// - Tiga pemanggil: focus-empty Fokus Hari Ini, kosong TaskListView, DashEmpty dashboard; emoji 🎉/🔍 hilang.
// Render dengan React tiruan lewat vm (tanpa DOM); Decor asli dijalankan supaya svg maskot bisa diperiksa.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const themes = require("../../static/offline/themes.js");
const decor = require("../../static/offline/decor.js");
const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const appCss = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8").replace(/\r\n/g, "\n");

function fnSource(name) {
  const start = indexHtml.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = indexHtml.indexOf("\n}\n", start + 1);
  return indexHtml.slice(start, end + 2);
}

function h(type, props, ...children) {
  return { type, props: { ...(props || {}), children: children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false) } };
}
function walk(node, fn) {
  if (!node || typeof node !== "object") return;
  fn(node);
  for (const c of node.props.children) walk(c, fn);
}
function findAll(tree, pred) {
  const out = [];
  walk(tree, n => { if (pred(n)) out.push(n); });
  return out;
}
function text(node) {
  if (node === null || node === undefined || node === false) return "";
  if (typeof node !== "object") return String(node);
  return node.props.children.map(text).join("");
}
const cls = n => String(n.props.className || "").split(/\s+/).filter(Boolean);

function render(attrs, props, { withModules = true } = {}) {
  let hookCalls = 0;
  const win = withModules ? { TF: { themes, decor } } : {};
  function ViewGlyph() { return null; }
  const sandbox = {
    React: { createElement: h },
    useThemeAttrs: () => { hookCalls++; return attrs; },
    ViewGlyph,
    window: win,
    TF: win.TF,
  };
  vm.runInNewContext(fnSource("Decor") + fnSource("EmptyState") + "\nthis.EmptyState = EmptyState; this.Decor = Decor;", sandbox);
  const tree = sandbox.EmptyState(props);
  const decors = findAll(tree, n => n.type === sandbox.Decor);
  const glyphs = findAll(tree, n => n.type === ViewGlyph);
  // Jalankan Decor asli (hook dipanggil lagi, wajar seperti React).
  const decorOut = decors.map(d => sandbox.Decor(d.props));
  return { tree, decors, glyphs, decorOut, hookCalls };
}

const DEFAULT = { theme: "light", palette: "default", decor: "on" };
const SAKURA = { theme: "light", palette: "sakura", decor: "on" };
const LAVENDER = { theme: "dark", palette: "lavender", decor: "on" };
const GLYPH = { done: "emptyDone", filter: "emptySearch", empty: "emptyInbox" };

test("EmptyState didefinisikan tepat sebelum DashEmpty", () => {
  const comp = indexHtml.indexOf("\nfunction EmptyState(");
  const dash = indexHtml.indexOf("\nfunction DashEmpty(");
  assert.ok(comp > 0 && dash > comp, "EmptyState sebelum DashEmpty");
  const between = indexHtml.slice(comp + 1, dash);
  assert.equal((between.match(/\nfunction /g) || []).length, 0, "tidak ada fungsi lain di antaranya");
});

test("Default → ViewGlyph sesuai kind (36 px, warna accent-text lewat .empty-state-icon), tanpa svg maskot", () => {
  for (const kind of ["done", "filter", "empty"]) {
    const { tree, decors, glyphs, hookCalls } = render(DEFAULT, { kind, title: "Judul" });
    assert.equal(hookCalls, 1, "hook dipanggil tanpa syarat");
    assert.equal(decors.length, 0, kind + ": tanpa Decor");
    assert.equal(glyphs.length, 1, kind + ": satu ikon");
    assert.equal(glyphs[0].props.name, GLYPH[kind]);
    assert.equal(glyphs[0].props.size, 36);
    const wraps = findAll(tree, n => cls(n).includes("empty-state-icon"));
    assert.equal(wraps.length, 1);
    assert.equal(wraps[0].props["aria-hidden"], "true");
    assert.ok(findAll(wraps[0], n => n.type === glyphs[0].type).length === 1, "ikon di dalam .empty-state-icon");
    assert.ok(!JSON.stringify(tree).includes("<svg"), "tanpa svg maskot");
    assert.deepEqual(cls(tree), ["empty-state"]);
  }
});

test("sakura/lavender + dekorasi on → maskot mascot-happy (done/empty) / mascot-search (filter) 96 px", () => {
  const want = { done: "mascot-happy", empty: "mascot-happy", filter: "mascot-search" };
  for (const attrs of [SAKURA, LAVENDER]) {
    for (const kind of ["done", "filter", "empty"]) {
      const { decors, glyphs, decorOut } = render(attrs, { kind, title: "Judul" });
      assert.equal(glyphs.length, 0, `${attrs.palette}/${kind}: tanpa ikon`);
      assert.equal(decors.length, 1);
      assert.equal(decors[0].props.slot, "empty-" + kind);
      assert.equal(decors[0].props.size, 96);
      const out = decorOut[0];
      assert.equal(out.type, "span");
      assert.ok(cls(out).includes("decor") && cls(out).includes("decor-empty-" + kind));
      assert.equal(out.props["aria-hidden"], "true");
      assert.equal(out.props.dangerouslySetInnerHTML.__html, decor.svgFor(want[kind]));
      assert.equal(out.props.style.width, 96);
    }
  }
});

test("sakura + dekorasi off → kembali ke ikon duotone", () => {
  const { decors, glyphs } = render({ ...SAKURA, decor: "off" }, { kind: "done", title: "Judul" });
  assert.equal(decors.length, 0);
  assert.equal(glyphs.length, 1);
  assert.equal(glyphs[0].props.name, "emptyDone");
});

test("modul TF tidak ada → ikon tanpa melempar", () => {
  const { decors, glyphs, hookCalls } = render(SAKURA, { kind: "filter", title: "Judul" }, { withModules: false });
  assert.equal(decors.length, 0);
  assert.equal(glyphs.length, 1);
  assert.equal(glyphs[0].props.name, "emptySearch");
  assert.equal(hookCalls, 1);
});

test("compact → kelas empty-state-compact; maskot 40 px / ikon 18 px", () => {
  const a = render(SAKURA, { kind: "empty", title: "Belum ada task", compact: true });
  assert.deepEqual(cls(a.tree), ["empty-state", "empty-state-compact"]);
  assert.equal(a.decors[0].props.size, 40);
  assert.equal(a.decorOut[0].props.style.width, 40);
  const b = render(DEFAULT, { kind: "empty", title: "Belum ada task", compact: true });
  assert.deepEqual(cls(b.tree), ["empty-state", "empty-state-compact"]);
  assert.equal(b.glyphs[0].props.size, 18);
});

test("teks: judul di .empty-state-title, hint opsional di .empty-state-hint", () => {
  const { tree } = render(DEFAULT, { kind: "done", title: "Tidak ada task urgent!", hint: "Semua Q1, terlambat, dan deadline hari ini sudah selesai." });
  const titles = findAll(tree, n => cls(n).includes("empty-state-title"));
  const hints = findAll(tree, n => cls(n).includes("empty-state-hint"));
  assert.equal(titles.length, 1);
  assert.equal(text(titles[0]), "Tidak ada task urgent!");
  assert.equal(hints.length, 1);
  assert.equal(text(hints[0]), "Semua Q1, terlambat, dan deadline hari ini sudah selesai.");
  const { tree: t2 } = render(DEFAULT, { kind: "empty", title: "Tidak ada task" });
  assert.equal(findAll(t2, n => cls(n).includes("empty-state-hint")).length, 0, "tanpa hint → tanpa elemen hint");
  assert.equal(text(t2), "Tidak ada task");
});

// ── VIEW_GLYPHS ──
function viewGlyphsSource() {
  const start = indexHtml.indexOf("\nconst VIEW_GLYPHS = {");
  assert.ok(start >= 0);
  return indexHtml.slice(start, indexHtml.indexOf("\n};\n", start) + 3);
}

test("VIEW_GLYPHS: emptyDone, emptySearch, emptyInbox bergaya duotone tanpa warna tetap", () => {
  const glyphs = vm.runInNewContext(viewGlyphsSource() + "\nVIEW_GLYPHS;");
  for (const name of ["emptyDone", "emptySearch", "emptyInbox"]) {
    const s = glyphs[name];
    assert.equal(typeof s, "string", name);
    assert.match(s, /fill="currentColor" fill-opacity="\.22"/, name + ": isian lembut");
    assert.doesNotMatch(s, /#[0-9a-f]{3,8}\b|rgb|hsl|<script|url\(|\bon\w+=/i, name + ": tanpa warna tetap/skrip");
    assert.doesNotMatch(s, /<svg/, name + ": isi saja (ViewGlyph membungkus svg)");
  }
});

// ── Pemanggil ──
test("Fokus Hari Ini: focus-empty memakai EmptyState done dengan teks persis, pembungkus Zen tetap, tanpa 🎉", () => {
  const start = indexHtml.indexOf("className: `focus-empty${zenClass}`");
  assert.ok(start > 0, "pembungkus focus-empty${zenClass}");
  const end = indexHtml.indexOf("Semua task hari ini sudah ada di Target.", start);
  const block = indexHtml.slice(start, end);
  assert.match(block, /^className: `focus-empty\$\{zenClass\}`,\s*"aria-hidden": zenOn \? true : undefined\s*\}, React\.createElement\(EmptyState, \{/);
  assert.match(block, /kind: "done",\s*title: "Tidak ada task urgent!",\s*hint: "Semua Q1, terlambat, dan deadline hari ini sudah selesai\."/);
  assert.ok(!block.includes("🎉"), "tanpa emoji 🎉");
});

test("TaskListView kosong: filter / Inbox / lainnya lewat EmptyState di .card, tanpa 🎉/🔍", () => {
  const s = fnSource("TaskListView");
  assert.ok(!s.includes("🎉") && !s.includes("🔍"), "tanpa emoji");
  assert.match(s, /\{\s*kind: "filter",\s*title: "Tidak ada task yang cocok dengan filter"\s*\}/);
  assert.match(s, /\{\s*kind: "done",\s*title: "Kotak Masuk bersih!"\s*\}/);
  assert.match(s, /\{\s*kind: "empty",\s*title: "Tidak ada task"\s*\}/);
  assert.match(s, /hasFilters \? \{\s*kind: "filter"[^}]*\} : isInbox \? \{\s*kind: "done"[^}]*\} : \{\s*kind: "empty"/, "urutan: filter → Inbox → lainnya");
  const i = s.indexOf("filtered.length === 0 ?");
  assert.ok(i > 0);
  const block = s.slice(i, s.indexOf("groupBy === \"none\"", i));
  assert.match(block, /className: "card"/, "pembungkus .card tetap");
  assert.match(block, /React\.createElement\(EmptyState, /);
});

test("DashEmpty memakai EmptyState compact (kind empty) di pembungkus dash-empty", () => {
  const s = fnSource("DashEmpty");
  assert.match(s, /text = "Belum ada task"/);
  assert.match(s, /className: "dash-empty"/);
  assert.match(s, /React\.createElement\(EmptyState, \{\s*kind: "empty",\s*title: text,\s*compact: true\s*\}\)/);
  assert.doesNotMatch(s, /Icon, \{/, "ikon centang lama hilang");
});

// ── CSS ──
function rule(selector) {
  const re = new RegExp("(?:^|\\n)\\s*" + selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}");
  const m = appCss.match(re);
  assert.ok(m, `rule ${selector} must exist`);
  return m[1];
}

test("CSS .empty-state*: kolom terpusat; compact = baris dengan gap; ikon accent-text; hanya token", () => {
  const base = rule(".empty-state");
  assert.match(base, /display:\s*flex/);
  assert.match(base, /flex-direction:\s*column/);
  assert.match(base, /align-items:\s*center/);
  assert.match(base, /text-align:\s*center/);
  const compact = rule(".empty-state-compact");
  assert.match(compact, /flex-direction:\s*row/);
  assert.match(compact, /gap:\s*\d+px/);
  assert.match(rule(".empty-state-icon"), /color:\s*var\(--accent-text\)/);
  assert.match(rule(".empty-state-title"), /font-weight:\s*(600|700|800)/);
  const all = appCss.match(/(?:^|\n)[^\n{}]*\.empty-state[^{]*\{[^}]*\}/g) || [];
  assert.ok(all.length >= 5, "aturan .empty-state*");
  for (const r of all) assert.doesNotMatch(r, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i, "hanya token: " + r.trim());
});

test("CSS: dash-empty tidak lagi memaksa svg hijau (ikon/maskot memakai token)", () => {
  assert.doesNotMatch(appCss, /\.dash-empty svg\s*\{[^}]*#22c55e/);
});
