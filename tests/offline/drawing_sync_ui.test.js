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
  const factory = new Function("window", "navigator", "setTimeout", "clearTimeout", "__syncTransport",
    "let __pushTimer = null;\n" + m[0] + "\nreturn schedulePush;");
  return { schedulePush: factory(win, { onLine: true }, fakeSetTimeout, () => {}, {}), timers };
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

test("App.jsx: requestSnapshot sebelum editor siap tetap dibalas (parent tidak menunggu timeout)", () => {
  assert.match(appJsx, /if \(e\.data\?\.type === 'requestSnapshot'\) \{\s*if \(editorRef\.current\) syncToParent\(e\.data\.reqId\);\s*else window\.parent\.postMessage\(\{ type: 'change', noteId, data: null, reqId: e\.data\.reqId \}, '\*'\);/);
});

test("App.jsx: load gema (snapshot yang baru saja dikirim iframe ini) diabaikan", () => {
  assert.match(appJsx, /recentSentRef\.current\.includes\(/);
});

// ── Cache bust ───────────────────────────────────────────────────────────────
test("sw.js CACHE = taskflow-v333-drawing-sync-fix (tldraw di-cache cache-first)", () => {
  assert.match(swJs, /^const CACHE = "taskflow-v333-drawing-sync-fix";/m);
});
