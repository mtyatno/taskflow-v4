"use strict";
// Skrip boot tema di <head> (id="tf-theme-boot") harus memasang atribut <html> dan meta theme-color persis seperti
// TF.themes.readPrefs + resolve (skrip boot tidak bisa memakai TF.themes: berkasnya belum dimuat), dan App harus
// memakai TF.themes serta pengamat atribut ikut mengawasi data-palette.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const th = require("../../static/offline/themes.js");
const html = fs.readFileSync(path.join(__dirname, "..", "..", "static", "index.html"), "utf8").replace(/\r\n/g, "\n");
const mem = (o) => ({ getItem: (k) => (k in o ? o[k] : null), setItem: (k, v) => { o[k] = v; } });

function bootSource() {
  const m = html.match(/<script id="tf-theme-boot">([\s\S]*?)<\/script>/);
  assert.ok(m, 'tidak ada <script id="tf-theme-boot"> di index.html');
  return m[1];
}

// storage: objek kunci→nilai (dibungkus mem), objek ber-getItem (dipakai apa adanya), atau THROWING_GETTER
// (akses properti window.localStorage itu sendiri melempar, seperti Safari dengan cookie diblokir).
const THROWING_GETTER = Symbol("throwing-getter");
function runBoot(storage, systemDark) {
  const attrs = {};
  const meta = { content: "#0f172a", setAttribute(k, v) { if (k === "content") this.content = v; }, getAttribute(k) { return k === "content" ? this.content : null; } };
  const document = {
    documentElement: { setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return k in attrs ? attrs[k] : null; } },
    querySelector: (s) => (s === 'meta[name="theme-color"]' ? meta : null),
  };
  const sandbox = { document, matchMedia: (q) => ({ matches: q === "(prefers-color-scheme: dark)" ? systemDark : false }) };
  sandbox.window = sandbox;
  if (storage === THROWING_GETTER) {
    Object.defineProperty(sandbox, "localStorage", { get() { throw new Error("SecurityError"); } });
  } else {
    sandbox.localStorage = typeof storage.getItem === "function" ? storage : mem(storage);
  }
  vm.runInNewContext(bootSource(), sandbox);
  return { attrs, meta: meta.content };
}

const cases = [];
for (const mode of ["light", "dark", "system", "blue", null]) {
  for (const palette of ["default", "mint", null]) {
    for (const decor of ["on", "off", "x"]) {
      for (const systemDark of [true, false]) {
        const storage = {};
        if (mode !== null) storage.tf_theme = mode;
        if (palette !== null) storage.tf_palette = palette;
        storage.tf_decor = decor;
        cases.push({ storage, systemDark });
      }
    }
  }
}

test("matriks berisi 90 kasus", () => assert.equal(cases.length, 90));
test("boot script = TF.themes.resolve untuk seluruh matriks", () => { for (const c of cases) { const got = runBoot(c.storage, c.systemDark); const want = th.resolve(th.readPrefs(mem(c.storage)), c.systemDark); assert.deepEqual(got.attrs, { "data-theme": want.theme, "data-palette": want.palette, "data-decor": want.decor }, JSON.stringify(c)); assert.equal(got.meta, want.themeColor); } });
test("boot script: storage melempar → atribut bawaan", () => assert.deepEqual(runBoot({ getItem() { throw new Error(); } }, false).attrs, { "data-theme": "light", "data-palette": "default", "data-decor": "on" }));
test("boot script: akses window.localStorage melempar → atribut bawaan", () => {
  const got = runBoot(THROWING_GETTER, true);
  assert.deepEqual(got.attrs, { "data-theme": "light", "data-palette": "default", "data-decor": "on" });
  assert.equal(got.meta, "#0f172a");
});
test("boot script: tanpa matchMedia, mode system → terang", () => {
  const src = bootSource();
  const attrs = {};
  const sandbox = { document: { documentElement: { setAttribute(k, v) { attrs[k] = v; } }, querySelector: () => null }, localStorage: mem({ tf_theme: "system" }) };
  sandbox.window = sandbox;
  vm.runInNewContext(src, sandbox);
  assert.equal(attrs["data-theme"], "light");
});
test("boot script: ES5 dan tidak memakai TF.themes", () => {
  const src = bootSource();
  assert.doesNotMatch(src, /TF\.themes/);
  assert.doesNotMatch(src, /\b(const|let|class)\b|=>|`/);
});
// Brief menulis readPrefs(localStorage); App memakai safeLocalStorage() (akses window.localStorage bisa melempar).
test("App memakai TF.themes dan pengamat mengawasi data-palette", () => { assert.match(html, /TF\.themes\.readPrefs\(safeLocalStorage\(\)\)/); assert.match(html, /TF\.themes\.apply\(resolvedTheme, document\)/); assert.doesNotMatch(html, /attributeFilter: \["data-theme"\]\s*\}/); assert.doesNotMatch(html, /localStorage\.setItem\('tf_theme'/); });
