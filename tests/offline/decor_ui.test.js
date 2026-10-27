"use strict";
// Tema PR C, Task 2: komponen Decor (slot dekorasi) + CSS .decor*.
// Render dengan React tiruan lewat vm; useThemeAttrs diganti stub yang membaca atribut dari objek dokumen palsu.

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

function renderDecor(attrs, props, { withModules = true } = {}) {
  let hookCalls = 0;
  const win = withModules ? { TF: { themes, decor } } : {};
  const sandbox = {
    React: { createElement: h },
    useThemeAttrs: () => { hookCalls++; return attrs; },
    window: win,
    TF: win.TF,
  };
  vm.runInNewContext(fnSource("Decor") + "\nthis.Decor = Decor;", sandbox);
  const out = sandbox.Decor(props);
  return { out, hookCalls };
}

const SAKURA = { theme: "light", palette: "sakura", decor: "on" };

test("Decor didefinisikan tepat setelah useThemeAttrs", () => {
  const hook = indexHtml.indexOf("\nfunction useThemeAttrs(");
  const comp = indexHtml.indexOf("\nfunction Decor(");
  assert.ok(hook > 0 && comp > hook, "Decor setelah useThemeAttrs");
  const between = indexHtml.slice(hook + 1, comp);
  assert.equal((between.match(/\nfunction /g) || []).length, 0, "tidak ada fungsi lain di antaranya");
});

test("palet Default → null (tetapi hook tetap dipanggil)", () => {
  const { out, hookCalls } = renderDecor({ theme: "light", palette: "default", decor: "on" }, { slot: "page-corner" });
  assert.equal(out, null);
  assert.equal(hookCalls, 1);
});

test("sakura + decor on + page-corner → span.decor.decor-page-corner aria-hidden berisi svg kelopak", () => {
  const { out } = renderDecor(SAKURA, { slot: "page-corner" });
  assert.equal(out.type, "span");
  assert.deepEqual(out.props.className.split(/\s+/), ["decor", "decor-page-corner"]);
  assert.equal(out.props["aria-hidden"], "true");
  assert.equal(out.props.dangerouslySetInnerHTML.__html, decor.svgFor("petals"));
  assert.ok(/^<svg/.test(out.props.dangerouslySetInnerHTML.__html));
});

test("className tambahan ditambahkan setelah kelas dasar", () => {
  const { out } = renderDecor(SAKURA, { slot: "page-corner", className: "extra" });
  assert.deepEqual(out.props.className.split(/\s+/), ["decor", "decor-page-corner", "extra"]);
});

test("decor off → null", () => {
  const { out } = renderDecor({ ...SAKURA, decor: "off" }, { slot: "page-corner" });
  assert.equal(out, null);
});

test("slot tak dipetakan → null", () => {
  const { out } = renderDecor(SAKURA, { slot: "tidak-ada" });
  assert.equal(out, null);
});

test("modul TF.decor/TF.themes tidak ada → null tanpa melempar", () => {
  const { out, hookCalls } = renderDecor(SAKURA, { slot: "page-corner" }, { withModules: false });
  assert.equal(out, null);
  assert.equal(hookCalls, 1);
});

test("size → style width/height", () => {
  const { out } = renderDecor(SAKURA, { slot: "page-corner", size: 40 });
  assert.equal(out.props.style.width, 40);
  assert.equal(out.props.style.height, 40);
  const { out: out2 } = renderDecor(SAKURA, { slot: "page-corner" });
  assert.equal(out2.props.style, undefined);
});

// ── Guard CSS ──
function ruleBody(selectorRe) {
  const m = appCss.match(selectorRe);
  assert.ok(m, `rule ${selectorRe} must exist`);
  return m[1];
}

test("CSS: .decor tidak menangkap pointer & svg mengisi wadah", () => {
  assert.match(ruleBody(/(?:^|\n)\s*\.decor\s*\{([^}]*)\}/), /pointer-events:\s*none/);
  assert.match(ruleBody(/(?:^|\n)\s*\.decor\s*\{([^}]*)\}/), /user-select:\s*none/);
  assert.match(ruleBody(/\.decor svg\s*\{([^}]*)\}/), /width:\s*100%[^}]*height:\s*100%/);
});

test("CSS: reduced-motion mematikan animasi decor-page-corner", () => {
  const m = appCss.match(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.decor-page-corner\s*\{\s*animation:\s*none;?\s*\}\s*\}/);
  assert.ok(m, "reduced-motion rule");
  assert.match(appCss, /@keyframes decor-float/);
});

test("CSS: is-zen menyembunyikan decor-page-corner (kelas Zen sama dengan halaman Fokus)", () => {
  assert.match(appCss, /\.is-zen \.decor-page-corner\s*\{\s*display:\s*none;?\s*\}/);
  assert.ok(indexHtml.includes('`focus-page fade-in${zenOn ? " is-zen" : ""}`'), "halaman Fokus memasang is-zen");
});

test("CSS: ukuran pojok halaman & varian ponsel", () => {
  const body = ruleBody(/\.decor-page-corner\s*\{([^}]*)\}/);
  for (const re of [/position:\s*absolute/, /top:\s*0/, /right:\s*12px/, /width:\s*130px/, /height:\s*90px/, /animation:\s*decor-float 6s ease-in-out infinite/]) assert.match(body, re);
  assert.match(appCss, /@media \(max-width: 479px\)\s*\{\s*\.decor-page-corner\s*\{\s*width:\s*88px;\s*height:\s*61px;\s*right:\s*4px;\s*\}\s*\}/);
});
