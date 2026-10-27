"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const th = require("../../static/offline/themes.js");
const mem = (o) => ({ getItem: (k) => (k in o ? o[k] : null), setItem: (k, v) => { o[k] = v; } });
test("readPrefs: kosong → bawaan", () => assert.deepEqual(th.readPrefs(mem({})), { mode: "light", palette: "default", decor: "on", herobg: "kontur" }));
test("readPrefs: nilai lama dark tetap dark", () => assert.equal(th.readPrefs(mem({ tf_theme: "dark" })).mode, "dark"));
test("readPrefs: nilai asing → bawaan", () => assert.deepEqual(th.readPrefs(mem({ tf_theme: "blue", tf_palette: "mint", tf_decor: "maybe", tf_herobg: "foto" })), { mode: "light", palette: "default", decor: "on", herobg: "kontur" }));
test("readPrefs: storage melempar → bawaan", () => assert.equal(th.readPrefs({ getItem() { throw new Error("blocked"); } }).palette, "default"));
test("readPrefs: null storage → bawaan", () => assert.equal(th.readPrefs(null).mode, "light"));
test("resolve: system mengikuti systemDark", () => { assert.equal(th.resolve({ mode: "system", palette: "default", decor: "on" }, true).theme, "dark"); assert.equal(th.resolve({ mode: "system", palette: "default", decor: "on" }, false).theme, "light"); });
test("resolve: light/dark mengabaikan systemDark; themeColor dari registri", () => { const r = th.resolve({ mode: "light", palette: "default", decor: "off" }, true); assert.equal(r.theme, "light"); assert.equal(r.decor, "off"); assert.equal(r.themeColor, "#FCFCFB"); });
test("apply: memasang 4 atribut + meta, lalu nilai sama → tanpa setAttribute", () => {
  const calls = []; const el = { attrs: {}, getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { calls.push(k); this.attrs[k] = v; } };
  const meta = { content: "#000", getAttribute(k) { return k === "content" ? this.content : null; }, setAttribute(k, v) { calls.push("meta"); this.content = v; } };
  const doc = { documentElement: el, querySelector: (s) => (s === 'meta[name="theme-color"]' ? meta : null) };
  const r = th.resolve({ mode: "dark", palette: "default", decor: "on" }, false);
  th.apply(r, doc); assert.deepEqual(el.attrs, { "data-theme": "dark", "data-palette": "default", "data-decor": "on", "data-herobg": "kontur" }); assert.equal(meta.content, "#0f172a");
  calls.length = 0; th.apply(r, doc); assert.deepEqual(calls, []);
});
test("writePrefs menulis 4 kunci; melempar ditelan", () => { const o = {}; th.writePrefs(mem(o), { mode: "system", palette: "default", decor: "off", herobg: "galaksi" }); assert.deepEqual(o, { tf_theme: "system", tf_palette: "default", tf_decor: "off", tf_herobg: "galaksi" }); assert.doesNotThrow(() => th.writePrefs({ setItem() { throw new Error(); } }, { mode: "light" })); });
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
  assert.deepEqual(th.KEYS, { mode: "tf_theme", palette: "tf_palette", decor: "tf_decor", herobg: "tf_herobg" });
  assert.deepEqual(th.MODES, ["light", "dark", "system"]);
  assert.deepEqual(th.DEFAULT_PREFS, { mode: "light", palette: "default", decor: "on", herobg: "kontur" });
});
test("registri: swatch default sesuai nilai :root dan gelap", () => {
  const d = th.paletteById("default");
  assert.deepEqual(d.swatch.light, { accent: "#A8C500", soft: "#F4FAD6", bg: "#FCFCFB" });
  assert.deepEqual(d.swatch.dark, { accent: "#A8C500", soft: "rgba(168,197,0,0.18)", bg: "#171717" });
  assert.deepEqual(d.themeColor, { light: "#FCFCFB", dark: "#0f172a" });
  assert.deepEqual(d.decor, {});
  assert.equal(th.PALETTES[0].id, "default");
});

// --- PR B Task 1: palet Sakura + Lavender ---
const PETAL_DECOR = { "page-corner": "petals", "empty-done": "mascot-happy", "empty-empty": "mascot-happy", "empty-filter": "mascot-search", "pomo-glyph": "petal" };
test("registri: urutan id default,sakura,lavender", () => assert.deepEqual(th.PALETTES.map((p) => p.id), ["default", "sakura", "lavender"]));
test("themeColor Default terang #FCFCFB (gelap tetap #0f172a)", () => {
  assert.equal(th.paletteById("default").themeColor.light, "#FCFCFB");
  assert.equal(th.paletteById("default").themeColor.dark, "#0f172a");
});
test("swatch + themeColor sakura sesuai", () => {
  const p = th.paletteById("sakura");
  assert.equal(p.name, "Sakura");
  assert.deepEqual(p.swatch.light, { accent: "#B0287E", soft: "#F9E1F0", bg: "#FDF5FA" });
  assert.deepEqual(p.swatch.dark, { accent: "#EE8FCB", soft: "#3A2236", bg: "#1C1219" });
  assert.deepEqual(p.themeColor, { light: "#FDF5FA", dark: "#1C1219" });
  assert.deepEqual(p.decor, PETAL_DECOR);
});
test("swatch + themeColor lavender sesuai", () => {
  const p = th.paletteById("lavender");
  assert.equal(p.name, "Lavender");
  assert.deepEqual(p.swatch.light, { accent: "#8A3AAE", soft: "#F1E4FA", bg: "#FAF6FD" });
  assert.deepEqual(p.swatch.dark, { accent: "#CDA2F2", soft: "#2F2440", bg: "#18131D" });
  assert.deepEqual(p.themeColor, { light: "#FAF6FD", dark: "#18131D" });
  assert.deepEqual(p.decor, PETAL_DECOR);
});
test("isDecorAvailable(sakura|lavender) true, default false; decorFor sakura pomo-glyph = petal", () => {
  assert.equal(th.isDecorAvailable("sakura"), true);
  assert.equal(th.isDecorAvailable("lavender"), true);
  assert.equal(th.isDecorAvailable("default"), false);
  assert.equal(th.decorFor("sakura", "pomo-glyph"), "petal");
  assert.equal(th.decorFor("lavender", "page-corner"), "petals");
});
test("readPrefs/resolve mengenali palet baru; themeColor mengikuti mode", () => {
  assert.equal(th.readPrefs(mem({ tf_palette: "sakura" })).palette, "sakura");
  assert.equal(th.resolve({ mode: "dark", palette: "lavender", decor: "on" }, false).themeColor, "#18131D");
  assert.equal(th.resolve({ mode: "light", palette: "sakura", decor: "on" }, false).themeColor, "#FDF5FA");
});
test("resolve: palette asing jatuh ke default; decor selain \"off\" menjadi on; mode asing = light", () => {
  const r = th.resolve({ mode: "blue", palette: "zzz", decor: "maybe", herobg: "foto" }, true);
  assert.deepEqual(r, { theme: "light", palette: "default", decor: "on", herobg: "kontur", themeColor: "#FCFCFB" });
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
  assert.deepEqual(r.changed, ["data-palette", "data-decor", "data-herobg", "theme-color"]);
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
  assert.deepEqual(r.changed, ["data-theme", "data-palette", "data-decor", "data-herobg"]);
});
test("writePrefs: parsial hanya menulis kunci yang ada dan valid", () => {
  const o = {};
  th.writePrefs(mem(o), { mode: "light" });
  assert.deepEqual(o, { tf_theme: "light" });
  const p = {};
  th.writePrefs(mem(p), { mode: "blue", palette: "zzz", decor: "maybe", herobg: "foto" });
  assert.deepEqual(p, {});
  assert.doesNotThrow(() => th.writePrefs(null, { mode: "dark" }));
});
test("decorFor/isDecorAvailable: palet tak dikenal → null/false", () => {
  assert.equal(th.decorFor("zzz", "page-corner"), null);
  assert.equal(th.isDecorAvailable("zzz"), false);
});

// --- Latar hero (spec docs/superpowers/specs/2026-10-27-latar-hero-design.md §2) ---
test("HEROBGS: enam latar berurutan, kontur bawaan", () => {
  assert.deepEqual([...th.HEROBGS], ["kontur", "gradasi", "lanskap", "galaksi", "objek", "polos"]);
  assert.ok(Object.isFrozen(th.HEROBGS));
  assert.equal(th.DEFAULT_PREFS.herobg, "kontur");
  assert.equal(th.KEYS.herobg, "tf_herobg");
});
test("readPrefs: tf_herobg sah dipakai; asing/huruf besar/kosong → kontur", () => {
  for (const id of th.HEROBGS) assert.equal(th.readPrefs(mem({ tf_herobg: id })).herobg, id);
  for (const v of ["foto", "GALAKSI", "", "constructor", "toString"]) assert.equal(th.readPrefs(mem({ tf_herobg: v })).herobg, "kontur", v);
  assert.equal(th.readPrefs(mem({})).herobg, "kontur");
  assert.equal(th.readPrefs({ getItem() { throw new Error("blocked"); } }).herobg, "kontur");
});
test("writePrefs: herobg hanya ditulis bila ada di patch dan sah", () => {
  const o = {};
  th.writePrefs(mem(o), { herobg: "lanskap" });
  assert.deepEqual(o, { tf_herobg: "lanskap" });
  const q = { tf_herobg: "objek" };
  th.writePrefs(mem(q), { mode: "dark" });
  assert.deepEqual(q, { tf_herobg: "objek", tf_theme: "dark" });
  const r = {};
  th.writePrefs(mem(r), { herobg: "foto" });
  th.writePrefs(mem(r), { herobg: undefined });
  assert.deepEqual(r, {});
});
test("resolve: herobg dinormalkan; tanpa herobg → kontur", () => {
  assert.equal(th.resolve({ mode: "light", palette: "default", decor: "on", herobg: "polos" }, false).herobg, "polos");
  assert.equal(th.resolve({ mode: "light", palette: "default", decor: "on" }, false).herobg, "kontur");
  assert.equal(th.resolve({ mode: "light", palette: "default", decor: "on", herobg: "foto" }, false).herobg, "kontur");
  assert.equal(th.resolve().herobg, "kontur");
});
test("apply: data-herobg hanya disentuh bila berubah dan dilaporkan di changed", () => {
  const calls = [];
  const el = { attrs: { "data-theme": "light", "data-palette": "default", "data-decor": "on", "data-herobg": "kontur" }, getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { calls.push(k); this.attrs[k] = v; } };
  const meta = { content: "#FCFCFB", getAttribute(k) { return k === "content" ? this.content : null; }, setAttribute(k, v) { this.content = v; } };
  const doc = { documentElement: el, querySelector: (s) => (s === 'meta[name="theme-color"]' ? meta : null) };
  let r = th.apply(th.resolve({ mode: "light", palette: "default", decor: "on", herobg: "kontur" }, false), doc);
  assert.deepEqual(r.changed, []);
  r = th.apply(th.resolve({ mode: "light", palette: "default", decor: "on", herobg: "galaksi" }, false), doc);
  assert.deepEqual(r.changed, ["data-herobg"]);
  assert.deepEqual(calls, ["data-herobg"]);
  assert.equal(el.attrs["data-herobg"], "galaksi");
});
// Alur App (setThemePrefs): patch {herobg} ditulis ke storage, digabung ke state, lalu resolve + apply memasang
// data-herobg tanpa muat ulang.
test("alur setThemePrefs({ herobg }): storage + data-herobg langsung", () => {
  const store = { tf_palette: "sakura" };
  let state = th.readPrefs(mem(store));
  const el = { attrs: {}, getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { this.attrs[k] = v; } };
  const doc = { documentElement: el, querySelector: () => null };
  th.apply(th.resolve(state, false), doc);
  assert.equal(el.attrs["data-herobg"], "kontur");
  const patch = { herobg: "lanskap" };
  th.writePrefs(mem(store), patch);
  state = { ...state, ...patch };
  const r = th.apply(th.resolve(state, false), doc);
  assert.deepEqual(r.changed, ["data-herobg"]);
  assert.equal(el.attrs["data-herobg"], "lanskap");
  assert.deepEqual(store, { tf_palette: "sakura", tf_herobg: "lanskap" });
  assert.equal(th.readPrefs(mem(store)).herobg, "lanskap");
});
