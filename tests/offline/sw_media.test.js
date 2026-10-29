// Service worker & CSP Tauri untuk audio/video di note (Task 7, spec §8.1).
// Harness fetch-event palsu: pola sama dengan tes X-TF-Sync di drawing_sync_ui.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const swJs = fs.readFileSync(path.resolve(__dirname, "../../static/sw.js"), "utf8");
const tauriConf = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../src-tauri/tauri.conf.json"), "utf8"));

function loadSw(fetchImpl) {
  const handlers = {};
  const state = { cacheMatch: 0, cachePut: 0, fetches: [] };
  const cacheObj = {
    put: () => { state.cachePut++; return Promise.resolve(); },
    match: () => { state.cacheMatch++; return Promise.resolve(new Response('{"stale":true}', { status: 200 })); },
    add: () => Promise.resolve(),
  };
  const sandbox = {
    self: { addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting() {}, clients: { claim() {} } },
    caches: {
      open: () => Promise.resolve(cacheObj),
      match: () => { state.cacheMatch++; return Promise.resolve(new Response('{"stale":true}', { status: 200 })); },
      keys: () => Promise.resolve([]),
      delete: () => Promise.resolve(true),
    },
    fetch: (req, init) => { state.fetches.push(req); return fetchImpl(req, init); },
    Response, Request, Headers, URL, Promise, JSON, console, setTimeout, clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(swJs, sandbox);
  const dispatch = (req) => new Promise((resolve) => {
    let responded = false;
    handlers.fetch({ request: req, respondWith: (p) => { responded = true; resolve(Promise.resolve(p)); }, waitUntil() {} });
    if (!responded) resolve(null);
  });
  return { dispatch, state };
}

const offline = () => Promise.reject(new TypeError("Failed to fetch"));
const tick = () => new Promise((r) => setTimeout(r, 10));

test("sw: /media/<token> tidak di-intercept (tanpa respondWith), termasuk Range dan HEAD", async () => {
  const sw = loadSw(() => Promise.resolve(new Response("x", { status: 206 })));
  assert.equal(await sw.dispatch(new Request("http://app/media/abc.def-ghi", { headers: { Range: "bytes=100-" } })), null);
  assert.equal(await sw.dispatch(new Request("http://app/media/abc.def", { method: "HEAD" })), null);
  assert.equal(sw.state.fetches.length, 0);
  assert.equal(sw.state.cacheMatch, 0);
  assert.equal(sw.state.cachePut, 0);
});

test("sw: GET /api/media/7 network-only — offline → 503 OFFLINE tanpa baca cache; online → tidak di-cache", async () => {
  const off = loadSw(offline);
  const r = await off.dispatch(new Request("http://app/api/media/7"));
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { detail: "OFFLINE" });
  assert.equal(off.state.cacheMatch, 0, "meta bertanda tangan tidak boleh dilayani dari cache");
  const on = loadSw(() => Promise.resolve(new Response('{"id":7,"play_url":"/media/t"}', { status: 200 })));
  const r2 = await on.dispatch(new Request("http://app/api/media/7"));
  assert.equal(r2.status, 200);
  await tick();
  assert.equal(on.state.cachePut, 0, "meta media tidak boleh ditulis ke cache");
  assert.equal(on.state.cacheMatch, 0);
});

test("sw: semua method /api/media/<id>/upload & /complete network-only", async () => {
  for (const [method, p] of [["GET", "/api/media/7/upload"], ["PATCH", "/api/media/7/upload"], ["POST", "/api/media/7/complete"]]) {
    const off = loadSw(offline);
    const init = { method };
    if (method === "PATCH") init.body = "abc";
    const r = await off.dispatch(new Request("http://app" + p, init));
    assert.equal(r.status, 503, method + " " + p);
    assert.deepEqual(await r.json(), { detail: "OFFLINE" });
    assert.equal(off.state.cacheMatch, 0, method + " " + p);
  }
});

test("sw: /api/scratchpad/5/media/by-client/x dan POST /api/scratchpad/5/media network-only", async () => {
  const off = loadSw(offline);
  const r = await off.dispatch(new Request("http://app/api/scratchpad/5/media/by-client/x"));
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { detail: "OFFLINE" });
  assert.equal(off.state.cacheMatch, 0);
  const r2 = await off.dispatch(new Request("http://app/api/scratchpad/5/media", { method: "POST", body: "{}" }));
  assert.equal(r2.status, 503);
  const on = loadSw(() => Promise.resolve(new Response('{"id":1}', { status: 200 })));
  await on.dispatch(new Request("http://app/api/scratchpad/5/media/by-client/x"));
  await tick();
  assert.equal(on.state.cachePut, 0);
  // jalur scratchpad lain tetap network-first + fallback cache (perilaku offline lama)
  const plain = loadSw(offline);
  const r3 = await plain.dispatch(new Request("http://app/api/scratchpad/5"));
  assert.equal(r3.status, 200);
  assert.ok(plain.state.cacheMatch > 0);
  const r4 = await plain.dispatch(new Request("http://app/api/scratchpad/5/mediafoo"));
  assert.equal(r4.status, 200, "hanya segmen 'media' yang network-only");
});

test("sw: precache memuat mediadirective/mediaupload/mediacard", () => {
  for (const m of ["mediadirective", "mediaupload", "mediacard"]) {
    assert.ok(swJs.includes('"/static/offline/' + m + '.js"'), m);
  }
});

test("tauri csp media-src memuat https://alurik.com dan https://todo.yatno.web.id", () => {
  const csp = tauriConf.app.security.csp;
  const media = csp.split(";").map((s) => s.trim()).find((s) => s.startsWith("media-src"));
  assert.ok(media, "media-src ada");
  assert.deepEqual(media.split(/\s+/), ["media-src", "'self'", "blob:", "https://alurik.com", "https://todo.yatno.web.id"]);
});

test("tauri csp connect-src memuat https://alurik.com dan https://todo.yatno.web.id", () => {
  const csp = tauriConf.app.security.csp;
  const connect = csp.split(";").map((s) => s.trim()).find((s) => s.startsWith("connect-src"));
  assert.ok(connect, "connect-src ada");
  assert.deepEqual(connect.split(/\s+/), ["connect-src", "'self'", "https://alurik.com", "https://todo.yatno.web.id"]);
});
