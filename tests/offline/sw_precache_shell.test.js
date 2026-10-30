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
const os = require("node:os");
const { execFileSync } = require("node:child_process");

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

// Atribut sebuah tag HTML: nama huruf kecil → nilai (kutip ganda, kutip tunggal, atau tanpa kutip).
function attrsOf(tag) {
  const attrs = {};
  for (const m of tag.matchAll(/([^\s"'<>\/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
    attrs[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
  }
  return attrs;
}
const isLocal = u => typeof u === "string" && u.startsWith("/") && !u.startsWith("//");
const relsOf = attrs => (attrs.rel || "").toLowerCase().split(/\s+/).filter(Boolean);
const tagsOf = (html, name) => [...html.matchAll(new RegExp("<" + name + "\\b[^>]*>", "gi"))].map(m => attrsOf(m[0]));

// <script src="/…"> dan <link rel="stylesheet" href="/…"> lokal di index.html (urutan atribut bebas).
function localAssetsOfIndex(html = indexHtml) {
  return [
    ...tagsOf(html, "script").map(a => a.src),
    ...tagsOf(html, "link").filter(a => relsOf(a).includes("stylesheet")).map(a => a.href),
  ].filter(isLocal);
}

// <link rel="icon" / "apple-touch-icon" / "manifest"> lokal di index.html.
function linkedAppIconsOfIndex(html = indexHtml) {
  const APP_RELS = ["icon", "apple-touch-icon", "manifest"];
  return tagsOf(html, "link")
    .filter(a => relsOf(a).some(r => APP_RELS.includes(r)))
    .map(a => a.href)
    .filter(isLocal);
}

// Entri yang dipakai tes siklus diambil dari index.html (bukan di-hardcode) supaya tidak basi saat query naik.
const INDEX_ASSETS = localAssetsOfIndex();
const indexUrlOf = pathname => INDEX_ASSETS.find(u => u.split("?")[0] === pathname);

// Path repo (tanpa "/" depan, tanpa query) yang TIDAK boleh jadi entri shell: tidak ada di disk, atau tidak
// ter-track git (untracked / gitignored, mis. hasil build lokal — di server produksi akan 404 dan install SW
// gagal terus). Pemeriksaan git hanya dilewati bila git tidak ada atau `root` bukan checkout git.
function untrackedPaths(root, rels) {
  const run = args => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  let tracked = null;
  try {
    if (run(["rev-parse", "--is-inside-work-tree"]).trim() === "true") tracked = true;
  } catch (_) {
    tracked = null; // git tidak ada / bukan checkout git → fallback: cukup ada di disk
  }
  if (tracked) tracked = new Set(run(["--literal-pathspecs", "ls-files", "-z", "--", ...rels]).split("\0").filter(Boolean));
  return rels.filter(rel => !fs.existsSync(path.join(root, rel)) || (tracked !== null && !tracked.has(rel)));
}

const dupsOf = list => [...new Set(list.filter((u, i) => list.indexOf(u) !== i))];

test("sw precache: setiap script/stylesheet lokal di index.html ada di STATIC dengan URL persis", () => {
  const { STATIC } = swGlobals();
  const local = localAssetsOfIndex();
  // sanity: parser menemukan tag-tag utama (termasuk <link href=… rel=…> dengan urutan atribut terbalik)
  for (const u of ["/config.js", "/static/vendor/tailwind.min.css", "/static/ui-components.js"]) {
    assert.ok(local.includes(u), "parser index.html tidak menemukan " + u);
  }
  assert.match(indexUrlOf("/static/app.css") || "", /^\/static\/app\.css\?v=\d+$/, "parser tidak menemukan app.css ber-query");
  assert.match(indexUrlOf("/static/vendor/milkdown.bundle.js") || "", /\?v=\d+$/, "parser tidak menemukan milkdown ber-query");
  const missing = local.filter(u => !STATIC.includes(u));
  assert.deepEqual(missing, [], "dimuat index.html tapi tidak ada di STATIC (URL persis): " + missing.join(", "));
});

test("sw precache: parser tag index.html — kutip tunggal/ganda, urutan atribut bebas, hanya URL lokal", () => {
  const html = [
    "<script src='/static/a.js?v=1'></script>",
    '<script type="module" src="/static/b.js"></script>',
    '<script src="https://cdn.example/x.js"></script>',
    '<script src="//cdn.example/y.js"></script>',
    "<script>var s = 1;</script>",
    "<link href='/static/c.css?v=2' rel='stylesheet'>",
    '<link rel="stylesheet" href="https://fonts.example/css">',
    '<LINK REL="Stylesheet" HREF="/static/e.css">',
    "<link rel='icon' type='image/png' href='/static/icon-32.png?v=2'>",
    '<link rel="apple-touch-icon" href="/static/icon-192.png?v=2">',
    '<link rel="manifest" href="/manifest.json?v=2">',
    '<link rel="preconnect" href="https://fonts.example">',
  ].join("\n");
  assert.deepEqual(localAssetsOfIndex(html), ["/static/a.js?v=1", "/static/b.js", "/static/c.css?v=2", "/static/e.css"]);
  assert.deepEqual(linkedAppIconsOfIndex(html), ["/static/icon-32.png?v=2", "/static/icon-192.png?v=2", "/manifest.json?v=2"]);
});

test("sw precache: entri STATIC menunjuk file yang ada dan ter-track git", () => {
  const { STATIC } = swGlobals();
  const rels = STATIC.filter(u => u !== "/" && u !== "/config.js").map(u => u.split("?")[0].replace(/^\//, ""));
  const bad = untrackedPaths(ROOT, rels);
  assert.deepEqual(bad, [], "entri STATIC tanpa file ter-track git (akan 404 di produksi → install gagal terus): " + bad.join(", "));
});

test("sw precache: pemeriksa entri menolak file untracked/gitignored; tanpa checkout git → cukup ada di disk", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sw-precache-"));
  try {
    const put = (dir, rel) => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), "x");
    };
    const plain = path.join(tmp, "plain");
    put(plain, "static/a.js");
    assert.deepEqual(untrackedPaths(plain, ["static/a.js", "static/hilang.js"]), ["static/hilang.js"]);

    const repo = path.join(tmp, "repo");
    for (const rel of ["static/a.js", "static/untracked.js", "static/build/out.js", ".gitignore"]) put(repo, rel);
    fs.writeFileSync(path.join(repo, ".gitignore"), "static/build/\n");
    try {
      execFileSync("git", ["init", "-q"], { cwd: repo, stdio: "ignore" });
      execFileSync("git", ["add", "static/a.js", ".gitignore"], { cwd: repo, stdio: "ignore" });
    } catch (e) {
      t.skip("git tidak tersedia: " + e.message);
      return;
    }
    assert.deepEqual(
      untrackedPaths(repo, ["static/a.js", "static/untracked.js", "static/build/out.js", "static/hilang.js"]),
      ["static/untracked.js", "static/build/out.js", "static/hilang.js"]
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("sw precache: STATIC dan OPTIONAL_STATIC masing-masing tanpa entri ganda", () => {
  const { STATIC, OPTIONAL_STATIC } = swGlobals();
  for (const [name, list] of [["STATIC", STATIC], ["OPTIONAL_STATIC", OPTIONAL_STATIC]]) {
    assert.deepEqual(dupsOf(list), [], name + " memuat entri ganda (Cache.addAll menolak request duplikat): " + dupsOf(list).join(", "));
    assert.equal(new Set(list).size, list.length);
  }
});

test("sw precache: ikon & manifest yang ditautkan index.html ada di OPTIONAL_STATIC dengan URL persis", () => {
  const { OPTIONAL_STATIC } = swGlobals();
  const links = linkedAppIconsOfIndex();
  assert.ok(links.some(u => u.startsWith("/manifest.json")), "parser tidak menemukan manifest");
  assert.ok(links.some(u => u.startsWith("/static/icon-32.png")), "parser tidak menemukan favicon 32px");
  const missing = links.filter(u => !OPTIONAL_STATIC.includes(u));
  assert.deepEqual(missing, [], "ditautkan index.html tapi tidak ada di OPTIONAL_STATIC: " + missing.join(", "));
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
    "/static/icon-32.png?v=2",
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
// dibuat ATOMIK seperti aslinya: request ganda → InvalidStateError (Chromium: "Cache.addAll(): duplicate
// requests"); semua request di-fetch dulu; satu reject atau berstatus non-2xx → tolak tanpa menyimpan apa pun.
// Cache.add menolak bila !res.ok. Pola dasar: repro_css.js dari analisis bug 2026-10-22.
const ORIGIN = "http://app";
const CSS = indexUrlOf("/static/app.css");
const MILK = indexUrlOf("/static/vendor/milkdown.bundle.js");
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
        const seen = new Set();
        for (const r of list) {
          const k = hrefOf(r);
          if (seen.has(k)) {
            const err = new Error("Cache.addAll(): duplicate requests (" + k + ")");
            err.name = "InvalidStateError";
            throw err;
          }
          seen.add(k);
        }
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
    const counts = { skipWaiting: 0, warns: [] };
    const sandbox = {
      self: {
        addEventListener: (t, f) => { h[t] = f; },
        skipWaiting: () => { counts.skipWaiting++; return Promise.resolve(); },
        clients: { claim: async () => {} },
        registration: { active },
      },
      caches: cachesApi,
      fetch: (req, init) => network(req, init),
      Response, Request: RelRequest, Headers, URL, URLSearchParams, Promise, JSON, setTimeout, clearTimeout,
      console: Object.assign(Object.create(console), { warn: (...args) => { counts.warns.push(args); } }),
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
  assert.ok(!/cache:\s*["']reload["']/.test(swJs), 'mode cache "reload" tidak boleh tersisa di sw.js');
  assert.equal(vm.runInContext("freshRequest(" + JSON.stringify(CSS) + ").cache", sw.sandbox), "no-cache");
  assert.deepEqual(sw.counts.warns, []);
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
  // kegagalan dicatat (terlihat lewat remote debugging) lalu dilempar ulang — install tetap menolak
  assert.equal(sw.counts.warns.length, 1);
  assert.match(String(sw.counts.warns[0][0]), /SW install gagal/);
  assert.match(String(sw.counts.warns[0][1]), /connection reset/);
});

test("sw precache: entri shell ganda → install menolak (InvalidStateError), tak ada entri shell tersimpan", async () => {
  const { STATIC } = swGlobals();
  const dupSrc = withCache(swJs, "taskflow-vNEW").replace("const STATIC = [\n", 'const STATIC = [\n  "' + TAILWIND + '",\n');
  assert.notEqual(dupSrc, withCache(swJs, "taskflow-vNEW"));
  const w = makeWorld();
  const sw = w.loadSw(dupSrc, { active: {} });
  await assert.rejects(sw.install(), err => err.name === "InvalidStateError" && /duplicate/.test(err.message));
  assert.deepEqual(STATIC.filter(u => w.storedUrls("taskflow-vNEW").includes(u)), []);
  assert.equal(sw.counts.skipWaiting, 0);
  assert.equal(sw.counts.warns.length, 1);
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
    assert.deepEqual(sw.counts.warns, [], "opsional gagal bukan kegagalan install");
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
  assert.equal(sw.counts.warns.length, 1);
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

test("sw precache: siklus: SW baru install sukses → activate → cache lama terhapus → GET app.css dan milkdown.bundle.js (URL persis index.html) offline 200", async () => {
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

// Sistem plugin Fase 0a (spec docs/superpowers/specs/2026-10-29-plugin-fase0a-design.md §7, Lampiran A #4): runtime,
// index.json, dan setiap file plugin bawaan ada di STATIC dengan ?v=<hash> PERSIS seperti yang disuntik loader
// (`/static/plugins/<id>/<file>?v=<hash>` dari index.json).
test("sw precache: plugin-runtime.js, plugins/index.json, dan setiap file plugin ?v=<hash> ada di STATIC", () => {
  const { STATIC } = swGlobals();
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, "static/plugins/index.json"), "utf8"));
  assert.equal(idx.v, 1);
  const want = ["/static/plugin-runtime.js", "/static/plugins/index.json"];
  for (const p of idx.plugins) for (const f of p.files) want.push(`/static/plugins/${p.id}/${f}?v=${encodeURIComponent(p.hash)}`);
  const missing = want.filter(u => !STATIC.includes(u));
  assert.deepEqual(missing, [], "file plugin tidak di-precache (jalankan node compile.js): " + missing.join(", "));
  const stale = STATIC.filter(u => u.startsWith("/static/plugins/") && !want.includes(u));
  assert.deepEqual(stale, [], "entri plugin usang di STATIC: " + stale.join(", "));
});
