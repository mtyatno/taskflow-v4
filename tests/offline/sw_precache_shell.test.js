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

// ── Siklus hidup install/activate (spec §3.2, §3.3, §6) ──
// CacheStorage palsu DIBAGI antar versi SW (seperti di browser) dan jaringan yang bisa diatur. Cache.addAll
// dibuat ATOMIK seperti aslinya: semua request di-fetch dulu; satu reject atau berstatus non-2xx → tolak tanpa
// menyimpan apa pun. Cache.add menolak bila !res.ok. Pola dasar: repro_css.js dari analisis bug 2026-10-22.
const ORIGIN = "http://app";
const CSS = "/static/app.css?v=362";
const MILK = "/static/vendor/milkdown.bundle.js?v=289";
const TAILWIND = "/static/vendor/tailwind.min.css";
const withCache = (src, name) => src.replace(/const CACHE = "[^"]+"/, 'const CACHE = "' + name + '"');
const tick = () => new Promise(r => setTimeout(r, 10));
const pathOf = href => { const u = new URL(href); return u.pathname + u.search; };

function makeWorld() {
  const stores = new Map(); // nama cache → Map(href → Response)
  // mode: "online" | "offline"; fail: { re, status? } — URL (path+query) yang cocok gagal: reject (tanpa
  // status, seperti koneksi putus) atau dijawab dengan status itu (mis. 404 build tldraw tidak ada).
  const net = { mode: "online", fail: null, log: [] };
  const hrefOf = req => new URL(typeof req === "string" ? req : req.url, ORIGIN).href;
  const network = async (req, init) => {
    const r = typeof req === "string" ? new Request(hrefOf(req), init) : req;
    net.log.push({ url: pathOf(r.url), cache: (init && init.cache) || r.cache });
    if (net.mode === "offline") throw new TypeError("Failed to fetch");
    const p = pathOf(r.url);
    if (net.fail && net.fail.re.test(p)) {
      if (!net.fail.status) throw new TypeError("connection reset");
      return new Response("gagal", { status: net.fail.status });
    }
    return new Response("/* " + p + " */", { status: 200 });
  };
  const fetchOk = async req => {
    const res = await network(req);
    if (!res.ok) throw new TypeError("Cache.add: status " + res.status);
    return res;
  };
  function cacheOf(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      add: async req => { const res = await fetchOk(req); m.set(hrefOf(req), res); },
      addAll: async reqs => {
        const list = [...reqs];
        const resps = await Promise.all(list.map(fetchOk)); // satu gagal → tolak, belum ada yang disimpan
        list.forEach((r, i) => m.set(hrefOf(r), resps[i]));
      },
      put: async (req, res) => { m.set(hrefOf(req), res); },
      match: async (req, opt) => {
        const ig = !!(opt && opt.ignoreSearch);
        const strip = h => (ig ? h.split("?")[0] : h);
        const k = strip(hrefOf(req));
        for (const [kk, v] of m) if (strip(kk) === k) return v.clone();
        return undefined;
      },
      delete: async req => m.delete(hrefOf(req)),
      keys: async () => [...m.keys()].map(k => new Request(k)),
    };
  }
  const cachesApi = {
    open: async n => cacheOf(n),
    keys: async () => [...stores.keys()],
    has: async n => stores.has(n),
    delete: async n => stores.delete(n),
    match: async (req, opt) => {
      for (const n of stores.keys()) { const r = await cacheOf(n).match(req, opt); if (r) return r; }
      return undefined;
    },
  };
  class RelRequest extends Request {
    constructor(u, init) { super(typeof u === "string" ? new URL(u, ORIGIN).href : u, init); }
  }
  // active: null = install pertama (belum ada SW yang mengendalikan); objek = SW lama aktif.
  function loadSw(src, { active }) {
    const h = {};
    const counts = { skipWaiting: 0 };
    const sandbox = {
      self: {
        addEventListener: (t, f) => { h[t] = f; },
        skipWaiting: () => { counts.skipWaiting++; return Promise.resolve(); },
        clients: { claim: async () => {} },
        registration: { active },
      },
      caches: cachesApi,
      fetch: (req, init) => network(req, init),
      Response, Request: RelRequest, Headers, URL, URLSearchParams, Promise, JSON, console, setTimeout, clearTimeout,
    };
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    // promise lifecycle = gabungan waitUntil; menolak bila waitUntil menolak (install gagal → SW redundant)
    const run = type => {
      const ps = [];
      h[type]({ waitUntil: p => ps.push(Promise.resolve(p)) });
      assert.ok(ps.length > 0, type + " harus memakai e.waitUntil");
      return Promise.all(ps).then(() => undefined);
    };
    return {
      counts,
      sandbox,
      install: () => run("install"),
      activate: () => run("activate"),
      get: p => new Promise((resolve, reject) => {
        let responded = false;
        h.fetch({ request: new RelRequest(p), respondWith: r => { responded = true; resolve(Promise.resolve(r)); }, waitUntil() {} });
        if (!responded) reject(new Error("fetch tidak di-respondWith: " + p));
      }),
    };
  }
  return {
    net,
    loadSw,
    cacheNames: () => [...stores.keys()],
    storedUrls: name => (stores.has(name) ? [...stores.get(name).keys()].map(pathOf) : []),
  };
}

test('sw precache: install memakai cache: "no-cache" untuk semua request precache', async () => {
  const { STATIC, OPTIONAL_STATIC } = swGlobals();
  const w = makeWorld();
  const sw = w.loadSw(swJs, { active: null });
  await sw.install();
  const fetched = [...new Set(w.net.log.map(x => x.url))].sort();
  assert.deepEqual(fetched, [...new Set(STATIC.concat(OPTIONAL_STATIC))].sort(), "semua entri precache di-fetch");
  const notNoCache = w.net.log.filter(x => x.cache !== "no-cache");
  assert.deepEqual(notNoCache.slice(0, 3), [], notNoCache.length + " request precache tanpa cache: no-cache");
  assert.ok(!/["']reload["']/.test(swJs), 'mode cache "reload" tidak boleh tersisa di sw.js');
  assert.equal(vm.runInContext('freshRequest("/static/app.css?v=362").cache', sw.sandbox), "no-cache");
});

test("sw precache: shell gagal satu (tailwind) → install menolak, tak ada entri shell tersimpan, skipWaiting tidak dipanggil (active ada)", async () => {
  const { STATIC } = swGlobals();
  const w = makeWorld();
  w.net.fail = { re: /^\/static\/vendor\/tailwind\.min\.css$/ };
  const sw = w.loadSw(withCache(swJs, "taskflow-vNEW"), { active: {} });
  await assert.rejects(sw.install(), "install harus gagal bila satu file shell gagal");
  const stored = w.storedUrls("taskflow-vNEW");
  const shellStored = STATIC.filter(u => stored.includes(u));
  assert.deepEqual(shellStored, [], "addAll atomik: tidak ada entri shell tersimpan");
  assert.equal(sw.counts.skipWaiting, 0);
});

test("sw precache: opsional gagal (semua /static/vendor/tldraw/…) → install sukses, semua STATIC tersimpan", async () => {
  const { STATIC } = swGlobals();
  for (const fail of [{ re: /^\/static\/vendor\/tldraw\//, status: 404 }, { re: /^\/static\/vendor\/tldraw\// }]) {
    const w = makeWorld();
    w.net.fail = fail;
    const sw = w.loadSw(withCache(swJs, "taskflow-vNEW"), { active: {} });
    await sw.install();
    const stored = w.storedUrls("taskflow-vNEW");
    assert.deepEqual(STATIC.filter(u => !stored.includes(u)), [], "semua shell tersimpan");
    assert.ok(stored.includes("/static/icon-192.png?v=2"), "opsional lain tetap tersimpan");
    assert.ok(!stored.some(u => u.startsWith("/static/vendor/tldraw/")));
    assert.equal(sw.counts.skipWaiting, 0, "ada SW aktif → SW baru menunggu");
  }
});

test("sw precache: install pertama sukses (active null) → skipWaiting dipanggil sekali", async () => {
  const w = makeWorld();
  const sw = w.loadSw(swJs, { active: null });
  await sw.install();
  assert.equal(sw.counts.skipWaiting, 1);
});

test("sw precache: install pertama gagal → skipWaiting tidak dipanggil, install menolak", async () => {
  const w = makeWorld();
  w.net.fail = { re: /^\/static\/vendor\/tailwind\.min\.css$/ };
  const sw = w.loadSw(swJs, { active: null });
  await assert.rejects(sw.install());
  assert.equal(sw.counts.skipWaiting, 0);
});

test("sw precache: siklus: SW lama aktif + app.css ter-cache → SW baru install gagal (app.css reject) → cache lama utuh, GET app.css offline 200", async () => {
  const w = makeWorld();
  const oldSw = w.loadSw(withCache(swJs, "taskflow-vOLD"), { active: null });
  await oldSw.install();
  await oldSw.activate();
  assert.equal((await oldSw.get(CSS)).status, 200, "app dibuka online sekali");
  await tick();
  const before = w.storedUrls("taskflow-vOLD");
  assert.ok(before.includes(CSS) && before.includes(TAILWIND));

  // rilis baru di-install di latar saat request app.css gagal
  w.net.fail = { re: /^\/static\/app\.css/ };
  const newSw = w.loadSw(withCache(swJs, "taskflow-vNEW"), { active: {} });
  await assert.rejects(newSw.install(), "install SW baru harus gagal");
  assert.equal(newSw.counts.skipWaiting, 0);
  // install gagal → SW baru redundant, tidak pernah activate; SW lama tetap mengendalikan
  assert.ok(w.cacheNames().includes("taskflow-vOLD"));
  assert.deepEqual(w.storedUrls("taskflow-vOLD"), before, "cache lama tidak tersentuh");

  w.net.mode = "offline";
  const css = await oldSw.get(CSS);
  assert.equal(css.status, 200);
  assert.equal(await css.text(), "/* " + CSS + " */");
  assert.equal((await oldSw.get(TAILWIND)).status, 200);
});

test("sw precache: siklus: SW baru install sukses → activate → cache lama terhapus → GET /static/app.css?v=362 dan /static/vendor/milkdown.bundle.js?v=289 offline 200", async () => {
  const w = makeWorld();
  const oldSw = w.loadSw(withCache(swJs, "taskflow-vOLD"), { active: null });
  await oldSw.install();
  await oldSw.activate();

  const newSw = w.loadSw(withCache(swJs, "taskflow-vNEW"), { active: {} });
  await newSw.install();
  assert.equal(newSw.counts.skipWaiting, 0, "menunggu sampai semua klien tertutup (mis. HP restart)");
  await newSw.activate();
  assert.deepEqual(w.cacheNames(), ["taskflow-vNEW"], "activate menghapus cache versi lama");

  w.net.mode = "offline";
  for (const p of ["/", CSS, MILK, TAILWIND]) {
    const r = await newSw.get(p);
    assert.equal(r.status, 200, p + " offline");
    assert.equal(await r.text(), "/* " + p + " */");
  }
});
