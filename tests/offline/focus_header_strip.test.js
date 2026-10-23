"use strict";

// Header halaman Fokus: strip ringkas satu baris di HP & tablet (<= 1024 px), desktop tidak berubah.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const css = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8").replace(/\r\n/g, "\n");

function headSource() {
  const start = indexHtml.indexOf('className: "focus-page-head"');
  assert.ok(start >= 0, "header.focus-page-head harus ada");
  const end = indexHtml.indexOf("React.createElement(PomodoroTimer, {", start);
  assert.ok(end > start);
  return indexHtml.slice(start, end);
}

// Isi blok @media (max-width: 1024px) yang memuat aturan strip Fokus.
function mediaBlocks(query) {
  const out = [];
  let i = 0;
  while ((i = css.indexOf("@media " + query, i)) >= 0) {
    const open = css.indexOf("{", i);
    let depth = 1, j = open + 1;
    while (depth && j < css.length) { if (css[j] === "{") depth++; else if (css[j] === "}") depth--; j++; }
    out.push(css.slice(open + 1, j - 1));
    i = j;
  }
  return out;
}

test("markup: h1 + tanggal panjang + ringkasan lengkap tetap ada (desktop & pembaca layar)", () => {
  const src = headSource();
  assert.ok(src.includes('className: "focus-page-date"'));
  assert.ok(src.includes('weekday: "long"'));
  assert.ok(src.includes('React.createElement("h1", {\n    className: "focus-page-title"'));
  assert.ok(src.includes('"Fokus Hari Ini"'));
  assert.ok(src.includes('className: "focus-page-summary"'));
  assert.ok(src.includes("window.TF.pomologic.headerSummary({"));
});

test("markup: strip ringkas aria-hidden dengan tanggal pendek id-ID, headerSummaryShort, glyph pomoTomato, pemisah ' · '", () => {
  const src = headSource();
  const at = src.indexOf('className: "focus-page-strip"');
  assert.ok(at >= 0, "strip .focus-page-strip harus ada");
  const strip = src.slice(at);
  assert.match(strip, /"aria-hidden": "true"/);
  assert.match(strip, /toLocaleDateString\("id-ID", \{\s*weekday: "short",\s*day: "numeric",\s*month: "short"\s*\}\)/);
  assert.ok(strip.includes("window.TF.pomologic.headerSummaryShort({"));
  assert.ok(strip.includes('name: "pomoTomato"'));
  assert.ok(strip.includes('" · "'));
  assert.ok(strip.includes('className: "fps-hours"'), "bagian jam punya kelas sendiri agar bisa disembunyikan lebih dulu");
  // jam = bagian terakhir strip
  const iHours = strip.indexOf("fps-hours"), iPomo = strip.indexOf("fps-pomo"), iTasks = strip.indexOf("fps-tasks"), iDate = strip.indexOf("fps-date");
  assert.ok(iDate < iTasks && iTasks < iPomo && iPomo < iHours, "urutan: tanggal, task, pomodoro, jam");
});

test("CSS: strip disembunyikan di desktop; aturan desktop header tidak berubah", () => {
  assert.match(css, /\.focus-page-head \{ margin-bottom: 16px; \}/);
  assert.match(css, /\.focus-page-title \{ font-size: 24px; font-weight: 700; display: flex; align-items: center; gap: 9px; margin: 0; \}/);
  assert.match(css, /\.focus-page-strip \{ display: none; \}/);
});

test("CSS <= 1024 px: strip satu baris, h1/tanggal/ringkasan visually-hidden, margin bawah lebih kecil, jam tersembunyi dulu", () => {
  const blocks = mediaBlocks("(max-width: 1024px)").filter(b => b.includes(".focus-page-strip"));
  assert.equal(blocks.length, 1, "satu blok @media (max-width: 1024px) untuk strip Fokus");
  const b = blocks[0];
  // visually-hidden (bukan display:none) agar tetap dibaca pembaca layar
  assert.match(b, /\.focus-page-date,\s*\.focus-page-titlebar \{[^}]*position: absolute;[^}]*clip: rect\(0,? ?0,? ?0,? ?0\)/);
  assert.ok(!/\.focus-page-titlebar[^{]*\{[^}]*display: none/.test(b), "h1 tidak boleh display:none");
  assert.match(b, /\.focus-page-head \{ margin-bottom: (\d+)px; \}/);
  assert.ok(Number(b.match(/\.focus-page-head \{ margin-bottom: (\d+)px; \}/)[1]) < 16);
  const strip = b.match(/\.focus-page-strip \{([^}]*)\}/)[1];
  assert.match(strip, /display: flex/);
  assert.match(strip, /flex-wrap: wrap/, "bagian yang tidak muat turun ke baris 2...");
  assert.match(strip, /overflow: hidden/, "...lalu terpotong (tersembunyi)");
  assert.match(strip, /height: 1\.5em/, "tinggi dikunci satu baris, skala dengan ukuran teks");
  assert.match(strip, /line-height: 1\.5;/, "line-height tanpa satuan agar ikut zoom teks");
  assert.doesNotMatch(strip, /(^|[ ;])(height|line-height): \d+px/, "tanpa tinggi px tetap");
  assert.match(b, /\.focus-page-strip > span \{[^}]*white-space: (pre|nowrap)/, "tiap bagian tidak terpotong di tengah");
  assert.match(b, /\.focus-page-strip svg \{[^}]*display: inline-block/, "glyph sebaris (svg global display:block membuat bagian pomo setinggi 3 baris)");
});
