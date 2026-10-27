"use strict";
// Tema PR B, Task 5: hook React tema di static/index.html dan aksen iframe mindmap.
// - useThemeAttrs menggantikan useThemeName: grafik Chart.js menggambar ulang saat palet berganti (bukan hanya mode).
// - useSystemDark: nilai yang dikembalikan sinkron dengan `enabled` pada render yang sama (derived state).
// - Mindmap: setTheme membawa accent/accentSoft/accentInk; iframe menulisnya ke --side-* atau menghapusnya.
// Tes sumber (iris fungsi dari index.html) + tes perilaku kecil dengan React tiruan lewat vm.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const iframeHtml = fs.readFileSync(path.resolve(__dirname, "../../static/vendor/mind-elixir/index.html"), "utf8").replace(/\r\n/g, "\n");

function fnSource(name, src = indexHtml) {
  const start = src.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = src.indexOf("\n}\n", start + 1);
  return src.slice(start, end + 2);
}

// React tiruan minimal: useState persisten antar-render, setState saat render diterapkan langsung, efek dikumpulkan.
function fakeReact() {
  const r = { slots: [], i: 0, effects: [] };
  r.useState = init => {
    const k = r.i++;
    if (!(k in r.slots)) r.slots[k] = typeof init === "function" ? init() : init;
    const set = v => { r.slots[k] = typeof v === "function" ? v(r.slots[k]) : v; };
    return [r.slots[k], set];
  };
  r.useEffect = fn => { r.effects.push(fn); };
  r.render = (fn, ...args) => { r.i = 0; r.effects = []; return fn(...args); };
  return r;
}

test("useThemeName tidak ada lagi; 3 pemakai memakai useThemeAttrs dan deps efek memuat palette", () => {
  assert.equal(indexHtml.includes("useThemeName"), false, "useThemeName harus dihapus");
  for (const name of ["ProductivityChart", "CompletionDonut", "StatusBarChart"]) {
    const s = fnSource(name);
    assert.match(s, /const \{ theme, palette \} = useThemeAttrs\(\);/, name);
    assert.match(s, /\}, \[[^\]]*\btheme\b[^\]]*\bpalette\b[^\]]*\]\);/, name + ": deps efek gambar ulang memuat theme & palette");
    assert.match(s, /dashChartColors\(theme\)/, name);
  }
});

test("useThemeAttrs mengamati 3 atribut", () => {
  const s = fnSource("useThemeAttrs");
  assert.match(s, /new MutationObserver\(/);
  assert.match(s, /attributeFilter: \["data-theme", "data-palette", "data-decor"\]/);
  assert.match(s, /mo\.disconnect\(\)/);
});

test("useThemeAttrs: nilai awal dari atribut; state hanya berganti bila salah satu nilai berubah", () => {
  const attrs = { "data-theme": "dark", "data-palette": "sakura", "data-decor": "off" };
  let observerCb = null, observed = null;
  const R = fakeReact();
  const sandbox = {
    useState: R.useState, useEffect: R.useEffect,
    document: { documentElement: { getAttribute: k => (k in attrs ? attrs[k] : null) } },
    MutationObserver: class { constructor(cb) { observerCb = cb; } observe(el, opts) { observed = opts; } disconnect() {} }
  };
  vm.runInNewContext(fnSource("useThemeAttrs") + "\nthis.hook = useThemeAttrs;", sandbox);
  const first = R.render(sandbox.hook);
  assert.deepEqual({ ...first }, { theme: "dark", palette: "sakura", decor: "off" });
  R.effects.forEach(fn => fn());
  assert.deepEqual([...observed.attributeFilter], ["data-theme", "data-palette", "data-decor"]);
  // Mutasi tanpa perubahan nilai → objek state sama (tidak memicu render/gambar ulang grafik).
  observerCb();
  assert.equal(R.render(sandbox.hook), first);
  attrs["data-palette"] = "lavender";
  observerCb();
  const next = R.render(sandbox.hook);
  assert.notEqual(next, first);
  assert.deepEqual({ ...next }, { theme: "dark", palette: "lavender", decor: "off" });
  // Atribut hilang → bawaan.
  delete attrs["data-theme"]; delete attrs["data-palette"]; delete attrs["data-decor"];
  observerCb();
  assert.deepEqual({ ...R.render(sandbox.hook) }, { theme: "light", palette: "default", decor: "on" });
});

test("useSystemDark: nilai sinkron saat enabled berubah", () => {
  const s = fnSource("useSystemDark");
  // Jalur render membandingkan `enabled` tersimpan dengan argumen (derived state), bukan menunggu efek.
  assert.match(s, /\.enabled !== enabled/);
  assert.match(s, /addEventListener\("change", onChange\)/);

  let matches = true;
  const R = fakeReact();
  const sandbox = { useState: R.useState, useEffect: R.useEffect };
  sandbox.window = { matchMedia: () => ({ matches, addEventListener() {}, removeEventListener() {} }) };
  vm.runInNewContext(s + "\nthis.hook = useSystemDark;", sandbox);
  assert.equal(R.render(sandbox.hook, false), false);
  // Render pertama yang melihat enabled === true sudah mengembalikan read(), tanpa menunggu efek.
  assert.equal(R.render(sandbox.hook, true), true);
  assert.equal(R.render(sandbox.hook, false), false);
  matches = false;
  assert.equal(R.render(sandbox.hook, true), false);
});

test("useSystemDark: pendengar change memperbarui nilai", () => {
  let mql = null;
  const R = fakeReact();
  const sandbox = { useState: R.useState, useEffect: R.useEffect };
  sandbox.window = { matchMedia: () => (mql = mql || { matches: false, l: null, addEventListener(t, f) { this.l = f; }, removeEventListener() { this.l = null; } }) };
  vm.runInNewContext(fnSource("useSystemDark") + "\nthis.hook = useSystemDark;", sandbox);
  assert.equal(R.render(sandbox.hook, true), false);
  const cleanups = R.effects.map(fn => fn());
  mql.matches = true;
  mql.l();
  assert.equal(R.render(sandbox.hook, true), true);
  cleanups.forEach(c => c && c());
  assert.equal(mql.l, null);
});

test("mindmap: postMessage membawa accent/accentSoft/accentInk", () => {
  const s = fnSource("mindmapThemeMessage");
  assert.match(s, /type: "setTheme"/);
  assert.match(s, /getComputedStyle\(document\.documentElement\)/);
  for (const [field, token] of [["accent", "--accent"], ["accentSoft", "--accent-soft"], ["accentInk", "--accent-ink"]]) {
    assert.match(s, new RegExp(`${field}: [^,\\n]*"${token}"`), field);
  }
  assert.match(s, /\.trim\(\)/);
  // Semua kiriman setTheme ke iframe memakai pembangun pesan yang sama (efek postTheme + dua jalur "ready").
  assert.equal((indexHtml.match(/type: "setTheme"/g) || []).length, 1);
  const inst = fnSource("MindmapTabInstance");
  assert.match(inst, /const postTheme = \(\) => \{\s*iframeRef\.current\?\.contentWindow\?\.postMessage\(mindmapThemeMessage\(\), window\.location\.origin\)/);
  assert.equal((inst.match(/postMessage\(mindmapThemeMessage\(\), window\.location\.origin\)/g) || []).length, 3);
});

test("mindmap: pesan tema berisi token terhitung; palet Default mengirim aksen kosong (iframe tetap bawaan)", () => {
  const tokens = { "--accent": " #B0287E ", "--accent-soft": "#F9E1F0", "--accent-ink": " #FFFFFF" };
  const attrs = { "data-theme": "dark", "data-palette": "sakura" };
  const sandbox = {
    document: { documentElement: { getAttribute: k => (k in attrs ? attrs[k] : null) } },
    getComputedStyle: () => ({ getPropertyValue: k => tokens[k] || "" })
  };
  vm.runInNewContext(fnSource("mindmapThemeMessage") + "\nthis.msg = mindmapThemeMessage;", sandbox);
  assert.deepEqual({ ...sandbox.msg() }, { type: "setTheme", theme: "dark", accent: "#B0287E", accentSoft: "#F9E1F0", accentInk: "#FFFFFF" });
  attrs["data-palette"] = "default";
  attrs["data-theme"] = "light";
  assert.deepEqual({ ...sandbox.msg() }, { type: "setTheme", theme: "light", accent: "", accentSoft: "", accentInk: "" });
});

test("iframe: handler mengabaikan accent kosong", () => {
  assert.match(iframeHtml, /removeProperty\('--side-accent'\)/);
  const m = iframeHtml.match(/if \(e\.data && e\.data\.type === 'setTheme'\) \{([\s\S]*?)\n {6}\}/);
  assert.ok(m, "handler setTheme");
  assert.match(m[1], /applySideAccent\(e\.data\)/);

  const fnStart = iframeHtml.indexOf("function applySideAccent(");
  assert.ok(fnStart >= 0, "applySideAccent must exist");
  const fnEnd = iframeHtml.indexOf("\n    }\n", fnStart);
  const props = {};
  const sandbox = { document: { documentElement: { style: {
    setProperty: (k, v) => { props[k] = v; },
    removeProperty: k => { delete props[k]; }
  } } } };
  vm.runInNewContext(iframeHtml.slice(fnStart, fnEnd + 6) + "\nthis.apply = applySideAccent;", sandbox);
  sandbox.apply({ accent: "#B0287E", accentSoft: "#F9E1F0", accentInk: "#FFFFFF" });
  assert.deepEqual(props, { "--side-accent": "#B0287E", "--side-hover": "#F9E1F0", "--side-accent-ink": "#FFFFFF" });
  sandbox.apply({ accent: "" , accentSoft: "#F9E1F0", accentInk: "#FFFFFF" });
  assert.deepEqual(props, {});
  sandbox.apply({ accent: "#8A3AAE", accentSoft: "#F1E4FA", accentInk: "#FFFFFF" });
  sandbox.apply({ theme: "light" }); // pesan lama tanpa field aksen
  assert.deepEqual(props, {});
});

test("src iframe ?v=147", () => {
  assert.match(indexHtml, /src: "\/static\/vendor\/mind-elixir\/index\.html\?v=147"/);
});
