"use strict";
// Service worker: precache app shell (spec docs/superpowers/specs/2026-10-22-sw-precache-shell-design.md).
// Shell = STATIC: setiap <script src> / <link rel="stylesheet"> lokal di index.html harus ada dengan URL PERSIS
// (query versi ikut), karena cabang catch-all fetch mencocokkan URL persis. Aset opsional (ikon, manifest,
// font KaTeX, build tldraw) ada di OPTIONAL_STATIC dan tidak boleh menggagalkan install.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "../..");
const swJs = fs.readFileSync(path.join(ROOT, "static/sw.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "static/index.html"), "utf8").replace(/\r\n/g, "\n");

// Isi teks blok `const <name> = [ … \n];` (bentuk yang juga dipakai regex sw_ambient_cache.test.js).
function listOf(name) {
  const m = new RegExp("const " + name + " = \\[([\\s\\S]*?)\\n\\];").exec(swJs);
  assert.ok(m, "blok `const " + name + " = [ … \\n];` tidak ditemukan di sw.js");
  return [...m[1].matchAll(/^\s*"([^"]+)",/gm)].map(x => x[1]);
}

// Nilai runtime STATIC / OPTIONAL_STATIC setelah sw.js dijalankan (termasuk TLDRAW_ASSETS yang di-push).
function swGlobals() {
  const sandbox = {
    self: { addEventListener() {}, skipWaiting() {}, clients: { claim() {} }, registration: {} },
    caches: {},
    Response, Request, Headers, URL, Promise, JSON, console, setTimeout, clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(swJs, sandbox);
  // lewat JSON supaya array-nya milik realm tes (deepStrictEqual membandingkan prototipe)
  return JSON.parse(vm.runInContext(
    "JSON.stringify({ STATIC, OPTIONAL_STATIC: typeof OPTIONAL_STATIC === 'undefined' ? null : OPTIONAL_STATIC, TLD })",
    sandbox
  ));
}

// <script src="/…"> dan <link rel="stylesheet" href="/…"> lokal di index.html (urutan atribut bebas).
function localAssetsOfIndex() {
  const urls = [];
  for (const [tag] of indexHtml.matchAll(/<script\b[^>]*>/g)) {
    const src = /\bsrc="([^"]+)"/.exec(tag);
    if (src && src[1].startsWith("/") && !src[1].startsWith("//")) urls.push(src[1]);
  }
  for (const [tag] of indexHtml.matchAll(/<link\b[^>]*>/g)) {
    if (!/\brel="stylesheet"/.test(tag)) continue;
    const href = /\bhref="([^"]+)"/.exec(tag);
    if (href && href[1].startsWith("/") && !href[1].startsWith("//")) urls.push(href[1]);
  }
  return urls;
}

test("sw precache: setiap script/stylesheet lokal di index.html ada di STATIC dengan URL persis", () => {
  const { STATIC } = swGlobals();
  const local = localAssetsOfIndex();
  // sanity: parser menemukan tag-tag utama (termasuk <link href=… rel=…> dengan urutan atribut terbalik)
  for (const u of ["/config.js", "/static/vendor/tailwind.min.css", "/static/ui-components.js"]) {
    assert.ok(local.includes(u), "parser index.html tidak menemukan " + u);
  }
  assert.ok(local.some(u => u.startsWith("/static/app.css?v=")), "parser tidak menemukan app.css");
  assert.ok(local.some(u => u.startsWith("/static/vendor/milkdown.bundle.js?v=")), "parser tidak menemukan milkdown");
  const missing = local.filter(u => !STATIC.includes(u));
  assert.deepEqual(missing, [], "dimuat index.html tapi tidak ada di STATIC (URL persis): " + missing.join(", "));
});

test("sw precache: entri STATIC menunjuk file yang ada", () => {
  const { STATIC } = swGlobals();
  const absent = STATIC
    .filter(u => u !== "/" && u !== "/config.js")
    .filter(u => !fs.existsSync(path.join(ROOT, u.split("?")[0].replace(/^\//, ""))));
  assert.deepEqual(absent, [], "entri STATIC tanpa file di repo: " + absent.join(", "));
});

test("sw precache: STATIC dan OPTIONAL_STATIC tidak beririsan; tldraw/ikon/katex hanya opsional", () => {
  const { STATIC, OPTIONAL_STATIC, TLD } = swGlobals();
  assert.ok(Array.isArray(OPTIONAL_STATIC), "OPTIONAL_STATIC belum didefinisikan di sw.js");
  const both = STATIC.filter(u => OPTIONAL_STATIC.includes(u));
  assert.deepEqual(both, [], "ada di kedua daftar: " + both.join(", "));
  const forbidden = ["/static/vendor/tldraw/", "/static/vendor/katex/fonts/", "/static/icon-", "/manifest.json"];
  const wrong = STATIC.filter(u => forbidden.some(p => u.startsWith(p)));
  assert.deepEqual(wrong, [], "aset opsional di STATIC (shell): " + wrong.join(", "));
  assert.ok(OPTIONAL_STATIC.includes(TLD + "/watermarks/watermark-desktop.svg"), "TLDRAW_ASSETS harus di-push ke OPTIONAL_STATIC");
  for (const u of [
    "/manifest.json?v=2",
    "/static/icon-192.png?v=2",
    "/static/icon-512.png?v=2",
    "/static/icon-maskable-192.png?v=2",
    "/static/icon-maskable-512.png?v=2",
    "/static/icon-new-task.svg",
    "/static/vendor/tldraw/index.html",
    "/static/vendor/tldraw/assets/index.js",
    "/static/vendor/tldraw/assets/index.css",
  ]) assert.ok(OPTIONAL_STATIC.includes(u), "OPTIONAL_STATIC tanpa " + u);
  const fonts = fs.readdirSync(path.join(ROOT, "static/vendor/katex/fonts")).filter(f => f.endsWith(".woff2"));
  assert.ok(fonts.length > 0);
  for (const f of fonts) assert.ok(OPTIONAL_STATIC.includes("/static/vendor/katex/fonts/" + f), "font KaTeX " + f);
  // bentuk teks: blok STATIC = nilai runtime (tidak ada push ke STATIC); blok OPTIONAL_STATIC = awal nilai runtime
  assert.deepEqual(listOf("STATIC"), STATIC);
  const optText = listOf("OPTIONAL_STATIC");
  assert.deepEqual(OPTIONAL_STATIC.slice(0, optText.length), optText);
});

test("sw precache: /static/sounds/ tidak di-precache", () => {
  const { STATIC, OPTIONAL_STATIC } = swGlobals();
  for (const [name, list] of [["STATIC", STATIC], ["OPTIONAL_STATIC", OPTIONAL_STATIC || []]]) {
    const snd = list.filter(u => u.startsWith("/static/sounds/"));
    assert.deepEqual(snd, [], name + " memuat suara latar: " + snd.join(", "));
  }
  assert.ok(!/const STATIC = \[([\s\S]*?)\n\];/.exec(swJs)[1].includes("/static/sounds/"));
});
