"use strict";

// Regression tests untuk DrawPage open path (numeric server id vs string event detail):
// ROUND 2 (user directive: NO recovery machinery — drawings wiped server+client; prevention only):
// 1. selectDrawing TIDAK mem-push sync-on-open (no api.post / getRaw / mapId / server_id guard).
//    Detail di-fetch via raw bypass __syncRawFetch (api.get tidak cukup: router offline
//    getDrawing() butuh local record utk fetcher idmap → server row tanpa local record
//    selalu notFound walau online; stale local record juga diutamakan).
// 2. Semua lookup id dinormalisasi via String(...) — event openDrawing mengirim STRING
//    ("1737" dari data-drawing-id) sementara baris server ber-id NUMBER (1737).
// 3. Gagal buka (404/offline) tidak silent: toast muncul, tanpa pesan menyesatkan "offline".
//
// Style mengikuti rebrand.test.js / slash_draw_query.test.js: assertion string/regex
// terhadap output compiled static/index.html.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8");

// Blok fungsi selectDrawing (sampai penutup `  };` pertama — tidak ada `  };` di dalam body)
const selectDrawingBlock = () => indexHtml.match(/const selectDrawing = async d => \{[\s\S]*?\n  \};/);

test("DrawPage open path — server_id marker & string/number normalization", async (t) => {
  await t.test("selectDrawing tidak lagi mem-push sync-on-open (no POST / getRaw / mapId / server_id guard)", () => {
    const sel = selectDrawingBlock();
    assert.ok(sel, "blok selectDrawing harus ditemukan");
    assert.ok(!sel[0].includes('api.post("/api/drawings"'), "selectDrawing tidak boleh memanggil api.post('/api/drawings') (junk-row generator)");
    assert.ok(!sel[0].includes("getRaw("), "selectDrawing tidak boleh memanggil drawingrepo.getRaw (branch sync-on-open dihapus)");
    assert.ok(!sel[0].includes("mapId("), "selectDrawing tidak boleh memanggil idmap.mapId (branch sync-on-open dihapus)");
    assert.ok(!sel[0].includes("server_id == null"), "guard sync-on-open (server_id == null) harus hilang dari selectDrawing");
    assert.ok(!sel[0].includes("client_id"), "POST payload client_id tidak boleh ada di selectDrawing");
  });

  await t.test("selectDrawing mengambil detail via raw fetch bypass dengan fallback ke baris list", () => {
    const sel = selectDrawingBlock();
    assert.ok(sel, "blok selectDrawing harus ditemukan");
    assert.ok(
      sel[0].includes("__syncRawFetch(`/api/drawings/${d.id}`)"),
      "selectDrawing harus fetch detail via __syncRawFetch(`/api/drawings/${d.id}`) (template literal)"
    );
    assert.ok(sel[0].includes("|| d"), "fallback `|| d` (buka dari baris list) harus dipertahankan");
  });

  await t.test("lookup list.find(initialDrawingId) memakai String() normalization", () => {
    assert.ok(
      indexHtml.includes("const found = list.find(d => String(d.id) === String(initialDrawingId));"),
      "list.find harus pakai String(d.id) === String(initialDrawingId)"
    );
  });

  await t.test("lookup drawings.find(initialDrawingId) memakai String() normalization", () => {
    assert.ok(
      indexHtml.includes("const found = drawings.find(d => String(d.id) === String(initialDrawingId));"),
      "drawings.find(initialDrawingId) harus pakai String(d.id) === String(initialDrawingId)"
    );
  });

  await t.test("lookup drawings.find(openDrawing detail id) memakai String() normalization", () => {
    assert.ok(
      indexHtml.includes("const found = drawings.find(d => String(d.id) === String(id));"),
      "drawings.find(id) harus pakai String(d.id) === String(id)"
    );
  });

  await t.test("prev.find(full.id) memakai String() normalization di 3 call-site", () => {
    const matches = indexHtml.match(/prev\.find\(d => String\(d\.id\) === String\(full\.id\)\)/g) || [];
    assert.equal(matches.length, 3, "ketiga prev.find(d.id === full.id) harus di-normalize String()");
  });

  await t.test("perbandingan strict lama tanpa String() tidak boleh tersisa", () => {
    assert.strictEqual(indexHtml.includes("list.find(d => d.id === initialDrawingId)"), false, "list.find tanpa String() harus hilang");
    assert.strictEqual(indexHtml.includes("drawings.find(d => d.id === initialDrawingId)"), false, "drawings.find(initialDrawingId) tanpa String() harus hilang");
    assert.strictEqual(indexHtml.includes("drawings.find(d => d.id === id)"), false, "drawings.find(id) tanpa String() harus hilang");
    assert.strictEqual(indexHtml.includes("prev.find(d => d.id === full.id)"), false, "prev.find(full.id) tanpa String() harus hilang");
  });

  await t.test("catch kedua effect initialDrawingId menampilkan toast (tidak silent), terikat dalam blok effect", () => {
    // Window terbatas (bukan [\s\S]*?): dari baris find sampai toast HARUS dalam blok effect yang sama
    const m1 = indexHtml.match(/list\.find\(d => String\(d\.id\) === String\(initialDrawingId\)\)[\s\S]{0,400}?showToast\('Gambar tidak ditemukan', 'error'\);/);
    assert.ok(m1, "catch effect pertama (list) harus showToast('Gambar tidak ditemukan', 'error') dalam blok effect");
    const m2 = indexHtml.match(/drawings\.find\(d => String\(d\.id\) === String\(initialDrawingId\)\)[\s\S]{0,400}?showToast\('Gambar tidak ditemukan', 'error'\);/);
    assert.ok(m2, "catch effect kedua (drawings) harus showToast('Gambar tidak ditemukan', 'error') dalam blok effect");
    const toasts = indexHtml.match(/showToast\('Gambar tidak ditemukan', 'error'\)/g) || [];
    assert.ok(toasts.length >= 2, `harus ada minimal 2 toast 'Gambar tidak ditemukan' (ada ${toasts.length})`);
  });

  await t.test("toast openDrawing tidak lagi menyebut offline (404 & offline sama-sama 'Gambar tidak tersedia')", () => {
    assert.ok(indexHtml.includes("showToast('Gambar tidak tersedia', 'error')"), "toast not-found harus 'Gambar tidak tersedia'");
    assert.strictEqual(indexHtml.includes("Gambar tidak tersedia — offline"), false, "pesan lama '— offline' harus hilang");
  });
});
