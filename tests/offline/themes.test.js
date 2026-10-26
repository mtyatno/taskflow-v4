"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const th = require("../../static/offline/themes.js");
const mem = (o) => ({ getItem: (k) => (k in o ? o[k] : null), setItem: (k, v) => { o[k] = v; } });
test("readPrefs: kosong → bawaan", () => assert.deepEqual(th.readPrefs(mem({})), { mode: "light", palette: "default", decor: "on" }));
test("readPrefs: nilai lama dark tetap dark", () => assert.equal(th.readPrefs(mem({ tf_theme: "dark" })).mode, "dark"));
test("readPrefs: nilai asing → bawaan", () => assert.deepEqual(th.readPrefs(mem({ tf_theme: "blue", tf_palette: "mint", tf_decor: "maybe" })), { mode: "light", palette: "default", decor: "on" }));
test("readPrefs: storage melempar → bawaan", () => assert.equal(th.readPrefs({ getItem() { throw new Error("blocked"); } }).palette, "default"));
test("readPrefs: null storage → bawaan", () => assert.equal(th.readPrefs(null).mode, "light"));
test("resolve: system mengikuti systemDark", () => { assert.equal(th.resolve({ mode: "system", palette: "default", decor: "on" }, true).theme, "dark"); assert.equal(th.resolve({ mode: "system", palette: "default", decor: "on" }, false).theme, "light"); });
test("resolve: light/dark mengabaikan systemDark; themeColor dari registri", () => { const r = th.resolve({ mode: "light", palette: "default", decor: "off" }, true); assert.equal(r.theme, "light"); assert.equal(r.decor, "off"); assert.equal(r.themeColor, "#0f172a"); });
test("apply: memasang 3 atribut + meta, lalu nilai sama → tanpa setAttribute", () => {
  const calls = []; const el = { attrs: {}, getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { calls.push(k); this.attrs[k] = v; } };
  const meta = { content: "#000", getAttribute(k) { return k === "content" ? this.content : null; }, setAttribute(k, v) { calls.push("meta"); this.content = v; } };
  const doc = { documentElement: el, querySelector: (s) => (s === 'meta[name="theme-color"]' ? meta : null) };
  const r = th.resolve({ mode: "dark", palette: "default", decor: "on" }, false);
  th.apply(r, doc); assert.deepEqual(el.attrs, { "data-theme": "dark", "data-palette": "default", "data-decor": "on" }); assert.equal(meta.content, "#0f172a");
  calls.length = 0; th.apply(r, doc); assert.deepEqual(calls, []);
});
test("writePrefs menulis 3 kunci; melempar ditelan", () => { const o = {}; th.writePrefs(mem(o), { mode: "system", palette: "default", decor: "off" }); assert.deepEqual(o, { tf_theme: "system", tf_palette: "default", tf_decor: "off" }); assert.doesNotThrow(() => th.writePrefs({ setItem() { throw new Error(); } }, { mode: "light" })); });
test("registri: default lengkap, decorFor/isDecorAvailable", () => { const d = th.paletteById("default"); assert.ok(d.swatch.light.accent && d.swatch.dark.accent && d.themeColor.light && d.themeColor.dark); assert.equal(th.decorFor("default", "page-corner"), null); assert.equal(th.isDecorAvailable("default"), false); assert.equal(th.paletteById("zzz"), null); });

// --- Tambahan (keputusan pelaksanaan Task 2) ---
test("readPrefs: system valid; nilai lama light tetap light", () => {
  assert.equal(th.readPrefs(mem({ tf_theme: "system" })).mode, "system");
  assert.equal(th.readPrefs(mem({ tf_theme: "light" })).mode, "light");
});
test("readPrefs: undefined storage → bawaan; decor off hanya bila persis \"off\"", () => {
  assert.deepEqual(th.readPrefs(undefined), th.DEFAULT_PREFS);
  assert.equal(th.readPrefs(mem({ tf_decor: "off" })).decor, "off");
  assert.equal(th.readPrefs(mem({ tf_decor: "OFF" })).decor, "on");
});
test("konstanta: KEYS, MODES, DEFAULT_PREFS", () => {
  assert.deepEqual(th.KEYS, { mode: "tf_theme", palette: "tf_palette", decor: "tf_decor" });
  assert.deepEqual(th.MODES, ["light", "dark", "system"]);
  assert.deepEqual(th.DEFAULT_PREFS, { mode: "light", palette: "default", decor: "on" });
});
test("registri: swatch default sesuai nilai :root dan gelap", () => {
  const d = th.paletteById("default");
  assert.deepEqual(d.swatch.light, { accent: "#A8C500", soft: "#F4FAD6", bg: "#FCFCFB" });
  assert.deepEqual(d.swatch.dark, { accent: "#A8C500", soft: "rgba(168,197,0,0.18)", bg: "#171717" });
  assert.deepEqual(d.themeColor, { light: "#0f172a", dark: "#0f172a" });
  assert.deepEqual(d.decor, {});
  assert.equal(th.PALETTES[0].id, "default");
});
test("resolve: palette asing jatuh ke default; decor selain \"off\" menjadi on; mode asing = light", () => {
  const r = th.resolve({ mode: "blue", palette: "zzz", decor: "maybe" }, true);
  assert.deepEqual(r, { theme: "light", palette: "default", decor: "on", themeColor: "#0f172a" });
});
test("resolve: mode dark → dark; tanpa argumen tidak melempar", () => {
  assert.equal(th.resolve({ mode: "dark", palette: "default", decor: "on" }, false).theme, "dark");
  assert.doesNotThrow(() => th.resolve());
  assert.equal(th.resolve().theme, "light");
});
test("apply: tanpa meta → dibuat dan ditambahkan ke head; changed mendaftar yang benar-benar diubah", () => {
  const el = { attrs: { "data-theme": "dark" }, getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { this.attrs[k] = v; } };
  const appended = [];
  const doc = {
    documentElement: el,
    querySelector: () => null,
    createElement: (tag) => { const m = { tag, attrs: {}, getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { this.attrs[k] = v; } }; return m; },
    head: { appendChild: (n) => appended.push(n) },
  };
  const r = th.apply(th.resolve({ mode: "dark", palette: "default", decor: "on" }, false), doc);
  assert.deepEqual(r.changed, ["data-palette", "data-decor", "theme-color"]);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].tag, "meta");
  assert.equal(appended[0].attrs.name, "theme-color");
  assert.equal(appended[0].attrs.content, "#0f172a");
});
test("apply: tanpa meta dan tanpa createElement/head → dilewati diam-diam", () => {
  const el = { attrs: {}, getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { this.attrs[k] = v; } };
  const doc = { documentElement: el, querySelector: () => null };
  let r;
  assert.doesNotThrow(() => { r = th.apply(th.resolve({ mode: "light", palette: "default", decor: "on" }, false), doc); });
  assert.deepEqual(r.changed, ["data-theme", "data-palette", "data-decor"]);
});
test("writePrefs: parsial hanya menulis kunci yang ada dan valid", () => {
  const o = {};
  th.writePrefs(mem(o), { mode: "light" });
  assert.deepEqual(o, { tf_theme: "light" });
  const p = {};
  th.writePrefs(mem(p), { mode: "blue", palette: "zzz", decor: "maybe" });
  assert.deepEqual(p, {});
  assert.doesNotThrow(() => th.writePrefs(null, { mode: "dark" }));
});
test("decorFor/isDecorAvailable: palet tak dikenal → null/false", () => {
  assert.equal(th.decorFor("zzz", "page-corner"), null);
  assert.equal(th.isDecorAvailable("zzz"), false);
});
