"use strict";
// Regression UI sinkronisasi drawing: schedulePush (busy → jadwal ulang), QuickDrawModal menunggu
// snapshot iframe sebelum menutup, penyimpan global svg_stale, iframe tldraw (source 'user', pagehide),
// cache bust SW. Lihat brief-drawing-sync.md (RC4, RC5, F, G).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "../..");
const indexHtml = fs.readFileSync(path.join(ROOT, "static/index.html"), "utf8");
const appJsx = fs.readFileSync(path.join(ROOT, "draw-app/src/App.jsx"), "utf8");
const swJs = fs.readFileSync(path.join(ROOT, "static/sw.js"), "utf8");

function block(startMarker, endMarker) {
  const s = indexHtml.indexOf(startMarker);
  if (s === -1) return "";
  const e = indexHtml.indexOf(endMarker, s + startMarker.length);
  return e === -1 ? "" : indexHtml.slice(s, e);
}
const flush = () => new Promise((r) => setImmediate(r));

// ── E. schedulePush menjadwal ulang saat pushOutbox sedang berjalan (busy) ────
function loadSchedulePush(pushImpl) {
  const m = indexHtml.match(/function schedulePush\(\) \{[\s\S]*?\n\}/);
  assert.ok(m, "function schedulePush() harus ada di index.html");
  const timers = [];
  const fakeSetTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  const win = { TF: { syncpush: { pushOutbox: pushImpl } } };
  const factory = new Function("window", "navigator", "setTimeout", "clearTimeout", "__syncTransport", "runSyncExclusive",
    "let __pushTimer = null;\n" + m[0] + "\nreturn schedulePush;");
  const passThrough = (task) => Promise.resolve().then(task); // antrian sinkron diuji terpisah
  return { schedulePush: factory(win, { onLine: true }, fakeSetTimeout, () => {}, {}, passThrough), timers };
}

test("schedulePush: hasil busy → push dijadwalkan ulang sampai benar-benar jalan", async () => {
  const results = [{ pushed: 0, failed: 0, remaining: -1, busy: true }, { pushed: 0, failed: 0, remaining: -1, busy: true }, { pushed: 1, failed: 0, remaining: 0 }];
  let calls = 0;
  const { schedulePush, timers } = loadSchedulePush(() => Promise.resolve(results[calls++]));
  schedulePush();
  assert.equal(timers.length, 1);
  timers[0].fn(); await flush();
  assert.equal(calls, 1);
  assert.equal(timers.length, 2, "busy → harus ada timer push susulan");
  timers[1].fn(); await flush();
  assert.equal(timers.length, 3, "masih busy → dijadwalkan lagi");
  timers[2].fn(); await flush();
  assert.equal(calls, 3);
  assert.equal(timers.length, 3, "push sukses → tidak menjadwal ulang");
});

test("schedulePush: push gagal (reject) tidak melempar & tidak loop", async () => {
  let calls = 0;
  const { schedulePush, timers } = loadSchedulePush(() => { calls++; return Promise.reject(new Error("x")); });
  schedulePush();
  timers[0].fn(); await flush();
  assert.equal(calls, 1);
  assert.equal(timers.length, 1);
});

test("index.html: sinyal 'tf:outbox-queued' (heal drawing saat GET) menjadwalkan push", () => {
  assert.match(indexHtml, /window\.addEventListener\("tf:outbox-queued", \(\) => schedulePush\(\)\);/);
});

test("sync(): push busy di akhir sync → schedulePush() dipanggil", () => {
  const m = indexHtml.match(/function sync\(\) \{[\s\S]*?\n\}/);
  assert.ok(m, "function sync() harus ada");
  assert.match(m[0], /pushOutbox\(__syncTransport\)\)[\s\S]{0,200}?busy[\s\S]{0,80}?schedulePush\(\)/,
    "sync() harus menjadwalkan push susulan bila pushOutbox mengembalikan busy");
});

// ── F. QuickDrawModal menunggu balasan snapshot dari iframe-nya ───────────────
function loadRequestIframeSnapshot() {
  const m = indexHtml.match(/function requestIframeSnapshot\([\s\S]*?\n\}/);
  assert.ok(m, "helper function requestIframeSnapshot(...) harus ada di index.html");
  return (win) => new Function("window", "setTimeout", "clearTimeout", m[0] + "\nreturn requestIframeSnapshot;")(win, setTimeout, clearTimeout);
}
function fakeParent() {
  const listeners = new Set();
  return {
    listeners,
    location: { origin: "http://app" },
    addEventListener: (t, f) => { if (t === "message") listeners.add(f); },
    removeEventListener: (t, f) => { if (t === "message") listeners.delete(f); },
    emit(ev) { for (const f of [...listeners]) f(ev); },
  };
}

test("requestIframeSnapshot: kirim requestSnapshot+reqId, tunggu 'change' dari iframe yang sama dengan reqId sama", async () => {
  const win = fakeParent();
  const fn = loadRequestIframeSnapshot()(win);
  const iframeWin = { posted: [], postMessage(msg, origin) { this.posted.push({ msg, origin }); } };
  let settled = false;
  const p = fn(iframeWin, 1000).then((v) => { settled = true; return v; });
  assert.equal(iframeWin.posted.length, 1);
  const { msg, origin } = iframeWin.posted[0];
  assert.equal(msg.type, "requestSnapshot");
  assert.ok(msg.reqId, "permintaan harus membawa reqId");
  assert.equal(origin, "http://app");
  win.emit({ origin: "http://app", source: {}, data: { type: "change", reqId: msg.reqId, data: "LAIN" } });
  win.emit({ origin: "http://evil", source: iframeWin, data: { type: "change", reqId: msg.reqId, data: "EVIL" } });
  win.emit({ origin: "http://app", source: iframeWin, data: { type: "change", data: "DEBOUNCE-LAMA" } });
  win.emit({ origin: "http://app", source: iframeWin, data: { type: "change", reqId: "lain", data: "X" } });
  await flush();
  assert.equal(settled, false, "pesan dari sumber/reqId lain harus diabaikan");
  win.emit({ origin: "http://app", source: iframeWin, data: { type: "change", reqId: msg.reqId, noteId: "7", data: "SNAP" } });
  const res = await p;
  assert.equal(res.data, "SNAP");
  assert.equal(win.listeners.size, 0, "listener harus dilepas setelah balasan");
});

test("requestIframeSnapshot: tanpa balasan → resolve null setelah timeout; iframe null → null", async () => {
  const win = fakeParent();
  const fn = loadRequestIframeSnapshot()(win);
  const iframeWin = { postMessage() {} };
  assert.equal(await fn(iframeWin, 20), null);
  assert.equal(win.listeners.size, 0);
  assert.equal(await fn(null, 20), null);
});

const qdm = (() => {
  const s = indexHtml.indexOf("function QuickDrawModal");
  const e = indexHtml.indexOf("function DrawingInsertModal", s);
  return s !== -1 && e !== -1 ? indexHtml.slice(s, e) : "";
})();

test("QuickDrawModal: tidak ada setTimeout 350ms buta; tutup menunggu requestIframeSnapshot (maks 3000ms)", () => {
  assert.ok(qdm, "QuickDrawModal harus ada");
  assert.doesNotMatch(qdm, /setTimeout\([\s\S]{0,400}?,\s*350\s*\)/, "penutupan tidak boleh lagi memakai setTimeout 350ms tanpa menunggu balasan");
  assert.match(qdm, /await requestIframeSnapshot\(iframeRef\.current\?\.contentWindow,\s*3000\)/);
});

test("QuickDrawModal: hydrateDrawingPreviews hanya dipanggil SETELAH snapshot ditunggu (bukan di awal tutup)", () => {
  const waitIdx = qdm.indexOf("await requestIframeSnapshot(");
  const hydrateIdx = qdm.indexOf("hydrateDrawingPreviews");
  assert.ok(waitIdx > 0 && hydrateIdx > waitIdx, "hydrate preview harus setelah menunggu snapshot");
  assert.doesNotMatch(qdm, /const handleClose = \(\) => \{\s*if \(iframeRef\.current\?\.contentWindow\) \{\s*iframeRef\.current\.contentWindow\.postMessage\(\{ type: 'requestSnapshot' \}/);
});

test("QuickDrawModal: state 'Menyimpan…' — tombol nonaktif & cegah tutup ganda", () => {
  assert.match(qdm, /Menyimpan…/);
  assert.match(qdm, /savingRef\.current\) return/, "cegah tutup ganda");
  assert.match(qdm, /disabled:\s*saving/);
});

test("QuickDrawModal: handleOpenStandalone ikut menunggu simpan sebelum membuka halaman Draw", () => {
  assert.match(qdm, /const handleOpenStandalone = \(\) => [\s\S]{0,200}?openDrawing/);
  assert.doesNotMatch(qdm, /const handleOpenStandalone = \(\) => \{\s*handleClose\(\);\s*window\.dispatchEvent/);
});

test("waitDrawingSaved: menunggu penyimpanan global yang sedang berjalan (dengan batas waktu)", async () => {
  const m = indexHtml.match(/function waitDrawingSaved\([\s\S]*?\n\}/);
  assert.ok(m, "helper function waitDrawingSaved(...) harus ada");
  const reg = {};
  const fn = new Function("_drawingSaveInFlight", "setTimeout", "clearTimeout", m[0] + "\nreturn waitDrawingSaved;")(reg, setTimeout, clearTimeout);
  let done = false;
  let release;
  reg["9"] = new Promise((r) => { release = r; });
  const p = fn(9, 1000).then(() => { done = true; });
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(done, false, "harus menunggu simpanan in-flight");
  release();
  await p;
  assert.equal(done, true);
  const t0 = Date.now();
  reg["10"] = new Promise(() => {});
  await fn("10", 30);
  assert.ok(Date.now() - t0 < 500, "batas waktu harus dihormati");
  await fn("tidak-ada", 30);
});

// ── Penyimpan global: svg_stale & registry in-flight ─────────────────────────
const globalHandler = block("const handleIframeMessage = async e => {", "window.addEventListener(\"editDrawingModal\", handleEditDrawingModal);");

test("handleIframeMessage: tanpa svg → simpan data saja + svg_stale 1; ada svg → svg_stale 0", () => {
  assert.ok(globalHandler, "handleIframeMessage harus ada");
  assert.match(globalHandler, /svg_stale:\s*hasSvg\s*\?\s*0\s*:\s*1/);
  assert.match(globalHandler, /if \(hasSvg\) payload\.svg_preview = e\.data\.svg;/);
  assert.match(globalHandler, /_drawingSaveInFlight\[did\]\s*=/, "simpanan in-flight harus didaftarkan agar QuickDrawModal bisa menunggu");
});

test("handleIframeMessage: simpan gagal → cache dedupe dilepas agar pesan berikutnya dicoba lagi", () => {
  assert.match(globalHandler, /catch \(_\) \{[\s\S]{0,200}?delete _lastSavedDrawingJson\[did\]/);
});

// ── Parent meneruskan svg_stale ke iframe; melacak data kiriman iframe sendiri ─
const dti = block("function DrawingTabInstance", "function DrawPage");

test("QuickDrawModal & DrawingTabInstance meneruskan flag svgStale pada pesan load", () => {
  for (const [name, code] of [["QuickDrawModal", qdm], ["DrawingTabInstance", dti]]) {
    const n = (code.match(/svgStale:\s*!!(?:doc|fresh)\.svg_stale/g) || []).length;
    assert.ok(n >= 2, name + " harus mengirim svgStale di load awal (ready) dan load ulang (drawingSaved), ditemukan " + n);
  }
});

test("QuickDrawModal & DrawingTabInstance mencatat data 'change' iframe sendiri (tidak memantulkan load gema)", () => {
  for (const [name, code] of [["QuickDrawModal", qdm], ["DrawingTabInstance", dti]]) {
    assert.match(code, /e\.data\?\.type === 'change' && e\.data\.data[\s\S]{0,80}?lastLoadedJsonRef\.current = e\.data\.data/, name);
  }
});

// ── G. iframe tldraw (draw-app/src/App.jsx) ──────────────────────────────────
test("App.jsx: dengarkan hanya perubahan user (source 'user', scope 'document'); tanpa jendela buta 800ms", () => {
  assert.match(appJsx, /store\.listen\([\s\S]{0,400}?\{\s*source:\s*'user',\s*scope:\s*'document'\s*\}/);
  assert.doesNotMatch(appJsx, /isRemoteLoadingRef/);
  assert.doesNotMatch(appJsx, /,\s*800\)/);
});

test("App.jsx: load snapshot sebagai perubahan remote (mergeRemoteChanges + loadSnapshot tldraw)", () => {
  assert.match(appJsx, /import \{[^}]*\bloadSnapshot\b[^}]*\} from 'tldraw'/);
  assert.match(appJsx, /mergeRemoteChanges\(\(\) => \{?\s*loadSnapshot\(editor\.store, snapshot\)/);
  assert.doesNotMatch(appJsx, /editorRef\.current\.store\.loadSnapshot\(/, "Store.loadSnapshot (deprecated, memicu listener user) tidak dipakai lagi");
});

test("App.jsx: pagehide mem-flush perubahan yang belum terkirim (tanpa svg, sinkron)", () => {
  assert.match(appJsx, /window\.addEventListener\('pagehide', onPageHide\)/, "App.jsx harus mendaftarkan handler pagehide");
  const h = appJsx.match(/const onPageHide = \(\) => \{[\s\S]*?\n {4}\}/);
  assert.ok(h, "onPageHide harus ada");
  assert.match(h[0], /userRevRef\.current !== sentRevRef\.current/);
  assert.match(h[0], /postMessage\(\{ type: 'change', noteId, data: snapshot \}/);
  assert.doesNotMatch(h[0], /await|generateSvgString/, "flush pagehide harus sinkron & tanpa svg");
});

test("App.jsx: requestSnapshot membalas dengan reqId; load ber-svgStale memicu kirim svg segar", () => {
  assert.match(appJsx, /e\.data\?\.type === 'requestSnapshot'[\s\S]{0,120}?syncToParent\(e\.data\.reqId\)/);
  assert.match(appJsx, /if \(reqId\) msg\.reqId = reqId/);
  assert.match(appJsx, /if \(e\.data\.svgStale\)/);
});

test("App.jsx: snapshot lama tidak dikirim setelah snapshot yang lebih baru (svg async bisa selesai terbalik)", () => {
  const m = appJsx.match(/const syncToParent = async \(reqId\) => \{[\s\S]*?\n {2}\};/);
  assert.ok(m, "syncToParent harus ada");
  assert.match(m[0], /const seq = \+\+syncSeqRef\.current;/);
  assert.match(m[0], /if \(seq < postedSeqRef\.current\) \{[\s\S]{0,300}?if \(reqId\) window\.parent\.postMessage\(\{ type: 'change', noteId, data: null, reqId \}/);
  assert.match(m[0], /postedSeqRef\.current = seq;/);
  const h = appJsx.match(/const onPageHide = \(\) => \{[\s\S]*?\n {4}\}/);
  assert.match(h[0], /postedSeqRef\.current = \+\+syncSeqRef\.current;/, "flush pagehide juga menutup kiriman async yang lebih lama");
});

test("App.jsx: requestSnapshot dibalas data HANYA bila sudah loaded & ada perubahan user belum terkirim; selain itu data null", () => {
  assert.match(appJsx, /if \(e\.data\?\.type === 'requestSnapshot'\) \{\s*if \(editorRef\.current && loadedRef\.current && userRevRef\.current !== sentRevRef\.current\) syncToParent\(e\.data\.reqId\);\s*else window\.parent\.postMessage\(\{ type: 'change', noteId, data: null, reqId: e\.data\.reqId \}, '\*'\);/);
});

test("App.jsx: load gema (snapshot yang baru saja dikirim iframe ini) diabaikan", () => {
  assert.match(appJsx, /recentSentRef\.current\.includes\(/);
});

// ── Cache bust ───────────────────────────────────────────────────────────────
test("sw.js CACHE = taskflow-v382-chat-send-self-healing (tldraw di-cache cache-first)", () => {
  assert.match(swJs, /^const CACHE = "taskflow-v382-chat-send-self-healing";/m);
});

// ══ Putaran pengerasan (review independen) ══════════════════════════════════════

// ── #1a Request sinkron ditandai X-TF-Sync & dibatasi waktu; SW meneruskannya network-only ──
test("index.html: __syncRawFetch & __syncTransport memberi header X-TF-Sync dan timeout 30 detik", () => {
  const raw = indexHtml.match(/const __syncRawFetch = [\s\S]*?\r?\n\};?\r?\n/);
  const tr = indexHtml.match(/const __syncTransport = \{[\s\S]*?\r?\n\};\r?\n/);
  assert.ok(raw && tr, "__syncRawFetch & __syncTransport harus ada");
  for (const [name, code] of [["__syncRawFetch", raw[0]], ["__syncTransport", tr[0]]]) {
    assert.match(code, /"X-TF-Sync": "1"/, name + " harus menandai request sinkron");
    assert.match(code, /syncFetch\(/, name + " harus lewat syncFetch (AbortController)");
  }
  const sf = indexHtml.match(/function syncFetch\(url, opts, timeoutMs\) \{[\s\S]*?\n\}/);
  assert.ok(sf, "helper syncFetch harus ada");
  assert.match(sf[0], /new AbortController\(\)/);
  assert.match(sf[0], /timeoutMs \|\| SYNC_FETCH_TIMEOUT_MS/);
  assert.match(indexHtml, /const SYNC_FETCH_TIMEOUT_MS = 30000;/);
  // fetcher drawing (buka gambar, interaktif) memakai batas waktu lebih pendek lalu jatuh ke data lokal
  const fetcher = indexHtml.match(/window\.TF\.drawingrepo\.configureFetcher\([\s\S]*?\n  \}\);/)[0];
  assert.equal((fetcher.match(/DRAWING_FETCH_TIMEOUT_MS/g) || []).length, 2);
});

function loadSw(fetchImpl) {
  const vm = require("node:vm");
  const handlers = {};
  const state = { cacheMatch: 0, cachePut: 0 };
  const cacheObj = {
    put: () => { state.cachePut++; return Promise.resolve(); },
    match: () => { state.cacheMatch++; return Promise.resolve(undefined); },
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
    fetch: fetchImpl, Response, Request, Headers, URL, Promise, JSON, console, setTimeout, clearTimeout,
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

test("sw.js: GET /api/* ber-header X-TF-Sync → network-only (tanpa baca/tulis cache), gagal → 503 OFFLINE", async () => {
  const fail = loadSw(() => Promise.reject(new TypeError("Failed to fetch")));
  const r1 = await fail.dispatch(new Request("http://app/api/drawings/5", { headers: { "X-TF-Sync": "1" } }));
  assert.equal(r1.status, 503);
  assert.deepEqual(await r1.json(), { detail: "OFFLINE" });
  assert.equal(fail.state.cacheMatch, 0, "request sinkron tidak boleh membaca cache (respons basi)");
  const ok = loadSw(() => Promise.resolve(new Response('{"id":5}', { status: 200 })));
  const r2 = await ok.dispatch(new Request("http://app/api/drawings/5", { headers: { "X-TF-Sync": "1" } }));
  assert.equal(r2.status, 200);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(ok.state.cachePut, 0, "request sinkron tidak boleh menulis cache");
  // GET biasa (tanpa penanda) tetap network-first + fallback cache (perilaku offline lama)
  const plain = loadSw(() => Promise.reject(new TypeError("Failed to fetch")));
  const r3 = await plain.dispatch(new Request("http://app/api/tasks"));
  assert.equal(r3.status, 200);
  assert.ok(plain.state.cacheMatch > 0);
});

// ── #4 sync() & push terjadwal diserialkan lewat satu antrian ─────────────────────
function loadRunSyncExclusive(maxMs) {
  const m = indexHtml.match(/function runSyncExclusive\(task\) \{[\s\S]*?\n\}/);
  assert.ok(m, "function runSyncExclusive(task) harus ada");
  return new Function("SYNC_TASK_MAX_MS", "setTimeout", "clearTimeout",
    "let __syncQueue = Promise.resolve();\n" + m[0] + "\nreturn runSyncExclusive;")(maxMs, setTimeout, clearTimeout);
}

test("runSyncExclusive: tugas berjalan berurutan, gagal tidak mengunci antrian, macet dilepas setelah batas waktu", async () => {
  const run = loadRunSyncExclusive(80);
  const log = [];
  let releaseA;
  const a = run(() => new Promise((r) => { log.push("A mulai"); releaseA = () => { log.push("A selesai"); r("a"); }; }));
  const b = run(() => { log.push("B mulai"); return Promise.reject(new Error("b")); });
  const c = run(() => { log.push("C mulai"); return "c"; });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(log, ["A mulai"], "B & C menunggu A");
  releaseA();
  assert.equal(await a, "a");
  await assert.rejects(b);
  assert.equal(await c, "c");
  assert.deepEqual(log, ["A mulai", "A selesai", "B mulai", "C mulai"]);
  const hung = run(() => new Promise(() => {}));
  const t0 = Date.now();
  assert.equal(await run(() => "d"), "d");
  assert.ok(Date.now() - t0 < 1000, "tugas macet dilepas setelah SYNC_TASK_MAX_MS");
  void hung;
});

test("index.html: sync(), push terjadwal & __pushNow lewat runSyncExclusive; drawingSaved juga saat merged > 0", () => {
  const sync = indexHtml.match(/function sync\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(sync, /const pending = runSyncExclusive\(\(\) => \{ __syncPending = null; return window\.TF\.syncpull\.pullAndReconcile/);
  assert.match(sync, /drawRes\.merged > 0/);
  const sp = indexHtml.match(/function schedulePush\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(sp, /runSyncExclusive\(\(\) => window\.TF\.syncpush\.pushOutbox\(__syncTransport\)\)/);
  assert.match(indexHtml, /window\.__pushNow = \(\) => \(window\.TF && window\.TF\.syncpush\) \? runSyncExclusive\(\(\) => window\.TF\.syncpush\.pushOutbox\(__syncTransport\)\)/);
  assert.match(indexHtml, /const SYNC_TASK_MAX_MS = \d+;/);
});

// ── #2 Parent selalu membalas 'ready' (load ber-flag empty / loadError + toast) ───
test("isEmptyDrawingData: '{}' / kosong = gambar baru; snapshot atau JSON lain bukan", () => {
  const m = indexHtml.match(/function isEmptyDrawingData\(s\) \{[\s\S]*?\n\}/);
  assert.ok(m, "helper function isEmptyDrawingData(s) harus ada");
  const fn = new Function(m[0] + "\nreturn isEmptyDrawingData;")();
  for (const v of ["{}", " {} ", "", null, undefined]) assert.equal(fn(v), true, JSON.stringify(v));
  for (const v of ['{"store":{},"schema":{}}', '{"a":1}', "rusak{", "[]"]) assert.equal(fn(v), false, JSON.stringify(v));
});

test("QuickDrawModal & DrawingTabInstance: 'ready' → load {v:2, empty} atau loadError + toast 'Gagal memuat gambar'", () => {
  for (const [name, code] of [["QuickDrawModal", qdm], ["DrawingTabInstance", dti]]) {
    assert.match(code, /type: 'load',\s*v: 2,\s*data: doc\.data_json \|\| '\{\}',\s*empty: isEmptyDrawingData\(doc\.data_json\)/, name + " load awal");
    assert.match(code, /type: 'load',\s*v: 2,\s*data: fresh\.data_json,\s*empty: isEmptyDrawingData\(fresh\.data_json\)/, name + " load ulang");
    assert.match(code, /postMessage\(\{ type: 'loadError', v: 2 \}, window\.location\.origin\)/, name + " loadError");
    assert.match(code, /showToast\('Gagal memuat gambar', 'error'\)/, name + " toast");
  }
});

// ── #11 hanya SATU QuickDrawModal per klik preview ───────────────────────────────
test("index.html: hanya App yang mendengar editDrawingModal (tidak ada modal ganda)", () => {
  const n = (indexHtml.match(/addEventListener\(\s*['"]editDrawingModal['"]/g) || []).length;
  assert.equal(n, 1, "listener editDrawingModal ditemukan " + n + "×");
  assert.match(indexHtml, /window\.addEventListener\("editDrawingModal", handleEditDrawingModal\);/);
});

// ── #2 iframe: status loaded, read-only sampai load pertama ─────────────────────
test("App.jsx: read-only sampai load pertama diterapkan; tidak mengirim apa pun sebelum loaded", () => {
  assert.match(appJsx, /const loadedRef = useRef\(false\)/);
  const mount = appJsx.match(/const handleMount = \(editor\) => \{[\s\S]*?\n {2}\}/)[0];
  assert.match(mount, /editor\.updateInstanceState\(\{ isReadonly: true \}\)/);
  assert.match(mount, /if \(!loadedRef\.current\) return;/);
  const mark = appJsx.match(/const markLoaded = \(\) => \{[\s\S]*?\n {2}\}/);
  assert.ok(mark, "markLoaded harus ada");
  assert.match(mark[0], /loadedRef\.current = true/);
  assert.match(mark[0], /updateInstanceState\(\{ isReadonly: false \}\)/);
  const ph = appJsx.match(/const onPageHide = \(\) => \{[\s\S]*?\n {4}\}/)[0];
  assert.match(ph, /loadedRef\.current/);
  const vis = appJsx.match(/const onVisibility = \(\) => \{[\s\S]*?\n {4}\}/)[0];
  assert.match(vis, /loadedRef\.current/);
});

test("App.jsx: load tanpa store hanya dianggap loaded bila flag empty (atau parent lama mengirim '{}')", () => {
  assert.match(appJsx, /const hasStore = /);
  assert.match(appJsx, /if \(hasStore\) \{[\s\S]*?markLoaded\(\)/);
  assert.match(appJsx, /\} else if \(e\.data\.empty === true \|\| \(legacyParent && isEmptyObject\)\) \{[\s\S]{0,200}?markLoaded\(\)/);
  assert.match(appJsx, /const legacyParent = e\.data\.v == null/);
  assert.match(appJsx, /e\.data\?\.type === 'loadError'/);
});

// ══ Putaran review akhir ════════════════════════════════════════════════════════

// ── syncFetch: batas waktu hanya menunggu respons; request ber-body diskalakan ukuran body ──
function loadSyncFetch(fetchImpl) {
  const m = indexHtml.match(/function syncFetch\(url, opts, timeoutMs\) \{[\s\S]*?\n\}/);
  assert.ok(m, "syncFetch harus ada");
  const consts = ["SYNC_FETCH_TIMEOUT_MS", "SYNC_UPLOAD_MAX_MS"].map((n) => {
    const c = indexHtml.match(new RegExp("const " + n + " = (\\d+);"));
    assert.ok(c, n + " harus didefinisikan");
    return "const " + n + " = " + c[1] + ";";
  }).join("\n");
  const timers = []; const cleared = [];
  const fakeSet = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  const fakeClear = (id) => { cleared.push(id); };
  const fn = new Function("window", "setTimeout", "clearTimeout", "AbortController", consts + "\n" + m[0] + "\nreturn syncFetch;")(
    { fetch: fetchImpl }, fakeSet, fakeClear, AbortController);
  return { fn, timers, cleared };
}

test("syncFetch: timer dihentikan saat respons tiba (body dibaca tanpa abort) & saat gagal", async () => {
  const ok = loadSyncFetch(() => Promise.resolve({ status: 200 }));
  await ok.fn("/api/x", { headers: {} });
  assert.equal(ok.timers.length, 1);
  assert.equal(ok.timers[0].ms, 30000);
  assert.deepEqual(ok.cleared, [1], "timer harus dihentikan begitu respons (headers) tiba");
  const bad = loadSyncFetch(() => Promise.reject(new TypeError("Failed to fetch")));
  await assert.rejects(bad.fn("/api/x", {}));
  assert.deepEqual(bad.cleared, [1]);
});

test("syncFetch: batas waktu request ber-body diskalakan ukuran body (30s + 1s/20KB, maks 10 menit)", async () => {
  const f = loadSyncFetch(() => Promise.resolve({ status: 200 }));
  await f.fn("/api/drawings/1", { method: "PUT", body: "x".repeat(200 * 1024) });
  assert.equal(f.timers[0].ms, 30000 + 10 * 1000);
  await f.fn("/api/drawings/1", { method: "PUT", body: "x".repeat(50 * 1024 * 1024) });
  assert.equal(f.timers[1].ms, 600000);
  await f.fn("/api/drawings/1", { headers: {} }, 8000);
  assert.equal(f.timers[2].ms, 8000, "timeout eksplisit (fetcher gambar) tetap dipakai untuk GET");
});

// ── runSyncExclusive: batas tahan dihitung sejak tugas MULAI (antrian panjang tetap eksklusif) ──
test("runSyncExclusive: tugas yang lama mengantre tidak dilepas paralel (maxHold mulai saat tugas berjalan)", async () => {
  const run = loadRunSyncExclusive(120);
  let running = 0, maxConc = 0;
  const mk = (ms) => () => { running++; maxConc = Math.max(maxConc, running); return new Promise((r) => setTimeout(() => { running--; r(); }, ms)); };
  const ps = [run(mk(100))];
  await new Promise((r) => setTimeout(r, 30)); ps.push(run(mk(100)));
  await new Promise((r) => setTimeout(r, 10)); ps.push(run(mk(20)));
  await new Promise((r) => setTimeout(r, 20)); ps.push(run(mk(100)));
  await Promise.all(ps);
  assert.equal(maxConc, 1, "skenario mutex_sim reviewer: harus tetap satu per satu");
});

// ── sync(): panggilan yang sudah antre tapi belum mulai digabung (fetchAll tiap 30s tidak menumpuk) ──
test("sync(): pemanggilan saat sync lain masih antre (belum mulai) mengembalikan promise yang sama", async () => {
  const m = indexHtml.match(/function sync\(\) \{[\s\S]*?\n\}/);
  const queue = [];
  const fakeRun = (task) => new Promise((resolve, reject) => { queue.push(() => Promise.resolve().then(task).then(resolve, reject)); });
  let pulls = 0;
  const win = { TF: {
    syncpull: { pullAndReconcile: () => { pulls++; return Promise.resolve(); } },
    syncpush: { pushOutbox: () => Promise.resolve({ pushed: 0 }) },
  }, dispatchEvent() {} };
  const sync = new Function("window", "renderConflicts", "schedulePush", "__syncRawFetch", "__syncTransport", "runSyncExclusive", "CustomEvent",
    "let __syncPending = null;\n" + m[0] + "\nreturn sync;")(win, () => {}, () => {}, () => {}, {}, fakeRun, function () {});
  const a = sync(); const b = sync();
  assert.equal(a, b, "sync yang belum mulai digabung");
  assert.equal(queue.length, 1);
  await queue.shift()();
  await a;
  assert.equal(pulls, 1);
  const c = sync();
  assert.notEqual(c, a, "setelah mulai/selesai, sync baru diantre lagi");
  assert.equal(queue.length, 1);
  await queue.shift()(); await c;
});

// ── Parent: data_missing → loadError; iframe gagal memuat (loadFailed) → toast ──
test("QuickDrawModal & DrawingTabInstance: doc.data_missing → loadError (read-only + toast), loadFailed iframe → toast", () => {
  for (const [name, code] of [["QuickDrawModal", qdm], ["DrawingTabInstance", dti]]) {
    assert.match(code, /if \(!doc \|\| doc\.data_missing\) throw new Error\(/, name + ": data_missing tidak boleh dianggap gambar kosong");
    assert.match(code, /e\.data\?\.type === 'loadFailed'/, name + ": menangani loadFailed dari iframe");
  }
  assert.match(qdm, /if \(fresh && fresh\.data_json && !fresh\.data_missing && iframeRef\.current\?\.contentWindow\)/);
  assert.match(dti, /if \(fresh && fresh\.data_json && !fresh\.data_missing && iframeRef\.current\?\.contentWindow\)/);
});

test("App.jsx: snapshot tak dikenal / loadSnapshot melempar → kirim {type:'loadFailed'} ke parent (kanvas tetap read-only)", () => {
  const n = (appJsx.match(/postMessage\(\{ type: 'loadFailed', noteId \}, '\*'\)/g) || []).length;
  assert.ok(n >= 2, "loadFailed dikirim untuk format tak dikenal & saat load melempar (ditemukan " + n + ")");
});
