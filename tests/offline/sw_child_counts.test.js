"use strict";
// Service worker: GET /api/tasks/child-counts (hitungan halaman Fokus) — network-first dengan cache PER TASK.
// URL batch bergantung pada himpunan id; fallback URL persis tidak cocok lagi saat task berubah (selesai, baru,
// deadline, tengah malam, potongan 200 bergeser). SW menyimpan /api/tasks/child-counts/<id> per task dan saat
// offline merakit {"counts": …} dari kunci-kunci itu. Harness fetch-event palsu: pola sw_media.test.js, tetapi
// cache palsu berbasis Map supaya isi cache bisa diperiksa.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const swJs = fs.readFileSync(path.resolve(__dirname, "../../static/sw.js"), "utf8");
const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const CACHE = swJs.match(/^const CACHE = "([^"]+)";/m)[1];
const ORIGIN = "http://app";

function loadSw(fetchImpl) {
  const handlers = {};
  const store = new Map(); // url → { body, status, type }
  const state = { fetches: [], waits: [], puts: [], deletes: [], opened: [] };
  const keyOf = r => (typeof r === "string" ? new URL(r, ORIGIN).href : r.url);
  const toRes = v => new Response(v.body, { status: v.status, headers: { "Content-Type": v.type || "" } });
  const cacheObj = {
    put: (req, res) => res.clone().text().then(body => {
      const k = keyOf(req);
      state.puts.push(k);
      store.set(k, { body, status: res.status, type: res.headers.get("Content-Type") });
    }),
    match: req => Promise.resolve(store.has(keyOf(req)) ? toRes(store.get(keyOf(req))) : undefined),
    delete: req => { const k = keyOf(req); state.deletes.push(k); return Promise.resolve(store.delete(k)); },
    keys: () => Promise.resolve([...store.keys()].map(k => new Request(k))),
    add: () => Promise.resolve(),
  };
  const sandbox = {
    self: { addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting() {}, clients: { claim() {} }, registration: {} },
    caches: {
      open: name => { state.opened.push(name); return Promise.resolve(cacheObj); },
      match: req => cacheObj.match(req),
      keys: () => Promise.resolve([CACHE]),
      delete: () => Promise.resolve(true),
    },
    fetch: (req, init) => { state.fetches.push(req); return state.net(req, init); },
    Response, Request, Headers, URL, URLSearchParams, Promise, JSON, Object, Array, Set, console, setTimeout, clearTimeout,
  };
  state.net = fetchImpl;
  vm.createContext(sandbox);
  vm.runInContext(swJs, sandbox);
  const dispatch = req => new Promise(resolve => {
    let responded = false;
    handlers.fetch({
      request: req,
      respondWith: p => { responded = true; resolve(Promise.resolve(p)); },
      waitUntil: p => { state.waits.push(Promise.resolve(p)); },
    });
    if (!responded) resolve(null);
  });
  const settle = async () => {
    await Promise.all(state.waits);
    await new Promise(r => setTimeout(r, 5));
  };
  return { dispatch, settle, state, store };
}

const offline = () => Promise.reject(new TypeError("Failed to fetch"));
const json = (obj, status = 200) => () => Promise.resolve(new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } }));
const C = (sub_total, sub_done, notes, atts) => ({ sub_total, sub_done, notes, atts });
const batchUrl = ids => `${ORIGIN}/api/tasks/child-counts?ids=${ids}`;
const perId = id => `${ORIGIN}/api/tasks/child-counts/${id}`;
const req = ids => new Request(batchUrl(ids));

test("sw child-counts: online {10,11,12} lalu offline {10,12} → hitungan 10 & 12 dari cache per task", async () => {
  const server = { counts: { "10": C(2, 1, 1, 0), "11": C(1, 1, 0, 2), "12": C(3, 1, 3, 1) } };
  const sw = loadSw(json(server));
  const r = await sw.dispatch(req("10,11,12"));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), server, "respons jaringan diteruskan apa adanya");
  await sw.settle();
  for (const id of ["10", "11", "12"]) {
    assert.ok(sw.store.has(perId(id)), "kunci per task " + id);
    assert.deepEqual(JSON.parse(sw.store.get(perId(id)).body), server.counts[id]);
    assert.equal(sw.store.get(perId(id)).type, "application/json");
  }
  assert.ok(sw.state.opened.every(n => n === CACHE), "ditulis ke CACHE versi aktif");

  sw.state.net = offline;
  const off = await sw.dispatch(req("10,12"));
  assert.equal(off.status, 200);
  assert.deepEqual(await off.json(), { counts: { "10": server.counts["10"], "12": server.counts["12"] } });
  // himpunan lain lagi (task baru 99 belum pernah dimuat): yang ada di cache tetap dikembalikan
  const mixed = await sw.dispatch(req("99,12"));
  assert.equal(mixed.status, 200);
  assert.deepEqual(await mixed.json(), { counts: { "12": server.counts["12"] } });
});

test("sw child-counts: offline tanpa cache apa pun → 503 OFFLINE", async () => {
  const sw = loadSw(offline);
  const r = await sw.dispatch(req("10,11"));
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { detail: "OFFLINE" });
  const r2 = await sw.dispatch(new Request(`${ORIGIN}/api/tasks/child-counts`));
  assert.equal(r2.status, 503);
});

test("sw child-counts: URL batch tidak pernah disimpan di cache", async () => {
  const sw = loadSw(json({ counts: { "5": C(0, 0, 0, 0) } }));
  await sw.dispatch(req("5"));
  await sw.settle();
  assert.ok(![...sw.store.keys()].some(k => k.includes("?")), [...sw.store.keys()].join(" "));
  assert.deepEqual(sw.state.puts, [perId(5)]);
});

test("sw child-counts: id yang diminta tapi tidak dikembalikan server → entri per task-nya dihapus", async () => {
  const sw = loadSw(json({ counts: { "10": C(1, 0, 0, 0), "11": C(2, 2, 0, 0) } }));
  await sw.dispatch(req("10,11"));
  await sw.settle();
  assert.ok(sw.store.has(perId(11)));
  // task 11 dihapus / akses hilang: server melewatkannya
  sw.state.net = json({ counts: { "10": C(1, 1, 0, 0) } });
  await sw.dispatch(req("10,11"));
  await sw.settle();
  assert.ok(!sw.store.has(perId(11)), "hitungan lama task 11 dibuang");
  assert.ok(sw.state.deletes.includes(perId(11)));
  assert.deepEqual(JSON.parse(sw.store.get(perId(10)).body), C(1, 1, 0, 0), "hitungan 10 diperbarui");
  sw.state.net = offline;
  const off = await sw.dispatch(req("10,11"));
  assert.deepEqual(await off.json(), { counts: { "10": C(1, 1, 0, 0) } });
});

test("sw child-counts: respons non-ok (422 backend lama, 500) diteruskan tanpa menulis/menghapus cache", async () => {
  for (const status of [422, 500]) {
    const sw = loadSw(json({ detail: "x" }, status));
    const r = await sw.dispatch(req("10"));
    assert.equal(r.status, status);
    assert.deepEqual(await r.json(), { detail: "x" });
    await sw.settle();
    assert.equal(sw.state.puts.length, 0, status + " tidak ditulis");
    assert.equal(sw.state.deletes.length, 0, status + " tidak menghapus");
  }
});

test("sw child-counts: aturan id sama dengan server (positif, ≤ 18 digit, nol depan dibuang, unik)", async () => {
  const sw = loadSw(json({ counts: { "12": C(1, 0, 0, 0) } }));
  await sw.dispatch(req("12"));
  await sw.settle();
  sw.state.net = offline;
  const r = await sw.dispatch(req("abc,0,-3,1.5,0012,12, 12 ,9223372036854775807"));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { counts: { "12": C(1, 0, 0, 0) } });
});

test("sw child-counts: kunci per task di bawah /api/ → ikut dibersihkan saat logout (index.html)", async () => {
  const sw = loadSw(json({ counts: { "7": C(0, 0, 1, 0) } }));
  await sw.dispatch(req("7"));
  await sw.settle();
  for (const k of sw.store.keys()) assert.ok(new URL(k).pathname.startsWith("/api/"), k);
  // pembersihan logout di index.html: hapus entri cache yang pathname-nya diawali /api/
  assert.ok(indexHtml.includes('try { return new URL(r.url).pathname.startsWith("/api/"); } catch (_) { return false; }'));
});

test("sw child-counts: cabang khusus berada sebelum cabang umum GET /api/* (network-first + cache URL persis)", () => {
  const iChild = swJs.indexOf('url.pathname === "/api/tasks/child-counts"');
  const iGeneric = swJs.indexOf('if (request.method === "GET" && url.pathname.startsWith("/api/")) {');
  assert.ok(iChild > 0 && iGeneric > 0 && iChild < iGeneric);
});
