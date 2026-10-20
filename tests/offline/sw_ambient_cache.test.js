// Service worker: cache suara latar (/static/sounds/) di cache terpisah yang bertahan lintas versi SW.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const swJs = fs.readFileSync(path.resolve(__dirname, "../../static/sw.js"), "utf8");
const ACTIVE = /const CACHE = "([^"]+)"/.exec(swJs)[1];

function loadSw(fetchImpl, initialKeys = [], opts = {}) {
  const handlers = {};
  const stores = {}; // nama cache -> Map(url -> Response)
  const state = { fetches: [], puts: [], deleted: [], opened: [], waits: [] };
  const store = (n) => (stores[n] = stores[n] || new Map());
  const makeCache = (n) => ({
    match: (req) => Promise.resolve(store(n).get(typeof req === "string" ? req : req.url)),
    put: (req, res) => {
      state.puts.push(n);
      if (opts.putRejects) return Promise.reject(new Error("QuotaExceededError"));
      store(n).set(typeof req === "string" ? req : req.url, res);
      return Promise.resolve();
    },
    ...(opts.matchThrows ? { match: () => Promise.reject(new Error("cache match gagal")) } : {}),
    add: () => Promise.resolve(),
    addAll: () => Promise.resolve(),
  });
  const sandbox = {
    self: { addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting() {}, clients: { claim() {} }, registration: {} },
    caches: {
      open: (n) => {
        state.opened.push(n);
        if (opts.openThrows) return Promise.reject(new Error("Cache Storage tidak tersedia"));
        return Promise.resolve(makeCache(n));
      },
      match: () => Promise.resolve(undefined),
      keys: () => Promise.resolve(initialKeys),
      delete: (k) => { state.deleted.push(k); return Promise.resolve(true); },
    },
    fetch: (req) => { state.fetches.push(req); return fetchImpl(req); },
    Response, Request, Headers, URL, Promise, JSON, console, setTimeout, clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(swJs, sandbox);
  const dispatch = (req) => new Promise((resolve) => {
    let responded = false;
    handlers.fetch({ request: req, respondWith: (p) => { responded = true; resolve(Promise.resolve(p)); }, waitUntil: (p) => { state.waits.push(p); } });
    if (!responded) resolve(null);
  });
  const activate = () => new Promise((resolve) => handlers.activate({ waitUntil: (p) => resolve(p) }));
  return { dispatch, activate, state, stores };
}

const tick = () => new Promise((r) => setTimeout(r, 10));
const SND = "http://app/static/sounds/hujan-v1.ogg";
const ok = () => Promise.resolve(new Response("audio", { status: 200 }));

test("sw ambient: cache kosong → fetch sekali lalu di-put ke alurik-ambient-v1", async () => {
  const sw = loadSw(ok);
  const r = await sw.dispatch(new Request(SND));
  assert.equal(r.status, 200);
  await tick();
  assert.equal(sw.state.fetches.length, 1);
  assert.deepEqual(sw.state.puts, ["alurik-ambient-v1"]);
});

test("sw ambient: fetch kedua dilayani dari cache tanpa jaringan", async () => {
  const sw = loadSw(ok);
  await sw.dispatch(new Request(SND));
  await tick();
  const r = await sw.dispatch(new Request(SND));
  assert.equal(await r.text(), "audio");
  assert.equal(sw.state.fetches.length, 1);
});

test("sw ambient: offline + cache kosong → 503", async () => {
  const sw = loadSw(() => Promise.reject(new TypeError("Failed to fetch")));
  const r = await sw.dispatch(new Request(SND));
  assert.equal(r.status, 503);
});

test("sw ambient: caches.open gagal saat online → respons jaringan (bukan 503)", async () => {
  const sw = loadSw(ok, [], { openThrows: true });
  const r = await sw.dispatch(new Request(SND));
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "audio");
  assert.equal(sw.state.fetches.length, 1);
});

test("sw ambient: cache.match gagal saat online → respons jaringan", async () => {
  const sw = loadSw(ok, [], { matchThrows: true });
  const r = await sw.dispatch(new Request(SND));
  assert.equal(r.status, 200);
  assert.equal(sw.state.fetches.length, 1);
});

test("sw ambient: caches.open gagal + offline → 503", async () => {
  const sw = loadSw(() => Promise.reject(new TypeError("Failed to fetch")), [], { openThrows: true });
  const r = await sw.dispatch(new Request(SND));
  assert.equal(r.status, 503);
});

test("sw ambient: cache.put ditolak tidak merusak respons; put lewat waitUntil yang tidak reject", async () => {
  const sw = loadSw(ok, [], { putRejects: true });
  const r = await sw.dispatch(new Request(SND));
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "audio");
  await tick();
  assert.deepEqual(sw.state.puts, ["alurik-ambient-v1"]);
  assert.equal(sw.state.waits.length, 1, "put harus didaftarkan lewat e.waitUntil");
  await assert.doesNotReject(sw.state.waits[0]);
});

test("sw ambient: respons 206 tidak disimpan", async () => {
  const sw = loadSw(() => Promise.resolve(new Response("part", { status: 206 })));
  const r = await sw.dispatch(new Request(SND));
  assert.equal(r.status, 206);
  await tick();
  assert.equal(sw.state.puts.length, 0);
});

test("sw ambient: non-GET tidak dicegat oleh cabang suara", async () => {
  const sw = loadSw(ok);
  await sw.dispatch(new Request(SND, { method: "POST" }));
  await tick();
  assert.ok(!sw.state.puts.includes("alurik-ambient-v1"));
  assert.ok(!sw.state.opened.includes("alurik-ambient-v1"));
});

test("sw ambient: activate hanya menghapus cache lama non-ambient", async () => {
  const sw = loadSw(ok, [ACTIVE, "taskflow-v1-lama", "alurik-ambient-v1"]);
  await sw.activate();
  assert.deepEqual(sw.state.deleted, ["taskflow-v1-lama"]);
});

test("sw ambient: STATIC tidak memuat /static/sounds/", () => {
  const block = /const STATIC = \[([\s\S]*?)\n\];/.exec(swJs)[1];
  assert.ok(!block.includes("/static/sounds/"));
  assert.ok(block.includes("/static/offline/ambient.js"));
});
