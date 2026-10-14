"use strict";

// Hero Dashboard untuk user dengan ratusan/ribuan task: angka di bawah cincin dibuat ringkas di HP
// ("12rb/15rb"), lengkap dengan pemisah ribuan di layar besar ("12.480/15.000"), angka lengkap di
// title, dan persen cincin tidak pernah 100% sebelum semua selesai.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const appCss = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8").replace(/\r\n/g, "\n");

const start = indexHtml.indexOf("const dashFullNum = ");
const end = indexHtml.indexOf("function DashProgressRing(");
assert.ok(start > 0 && end > start, "helper angka hero ada sebelum DashProgressRing");
const { dashFullNum, dashCompactNum, dashRingPct } = new Function(
  indexHtml.slice(start, end) + "\nreturn { dashFullNum, dashCompactNum, dashRingPct };"
)();

test("1. dashFullNum memakai pemisah ribuan Indonesia", () => {
  assert.equal(dashFullNum(0), "0");
  assert.equal(dashFullNum(66), "66");
  assert.equal(dashFullNum(1250), "1.250");
  assert.equal(dashFullNum(12480), "12.480");
  assert.equal(dashFullNum(1500000), "1.500.000");
});

test("2. dashCompactNum ringkas ala Indonesia dan dibulatkan ke bawah", () => {
  assert.equal(dashCompactNum(46), "46");
  assert.equal(dashCompactNum(999), "999");
  assert.equal(dashCompactNum(1000), "1rb");
  assert.equal(dashCompactNum(1250), "1,2rb");
  assert.equal(dashCompactNum(9999), "9,9rb");
  assert.equal(dashCompactNum(12480), "12rb");
  assert.equal(dashCompactNum(15000), "15rb");
  assert.equal(dashCompactNum(999999), "999rb");
  assert.equal(dashCompactNum(1500000), "1,5jt");
  assert.equal(dashCompactNum(25000000), "25jt");
});

test("3. Bentuk ringkas tidak lebih dari 5 karakter per angka", () => {
  for (const n of [0, 7, 999, 1000, 1999, 9999, 10000, 99999, 999999, 1e6, 9999999, 99999999]) {
    assert.ok(dashCompactNum(n).length <= 5, `${n} → ${dashCompactNum(n)}`);
  }
});

test("4. dashRingPct: 100% hanya jika semua selesai, <1% untuk sangat sedikit", () => {
  assert.equal(dashRingPct(0, 0), "0%");
  assert.equal(dashRingPct(0, 66), "0%");
  assert.equal(dashRingPct(46, 66), "69%");
  assert.equal(dashRingPct(14990, 15000), "99%");
  assert.equal(dashRingPct(15000, 15000), "100%");
  assert.equal(dashRingPct(3, 15000), "<1%");
});

test("5. Hero merender angka lengkap + ringkas dengan title angka lengkap", () => {
  assert.match(indexHtml, /title: `\$\{dashFullNum\(doneN\)\} dari \$\{dashFullNum\(totalToday\)\} prioritas selesai hari ini`/);
  assert.match(indexHtml, /className: "dash-num-full"\s*\}, dashFullNum\(doneN\), "\/", dashFullNum\(totalToday\)\)/);
  assert.match(indexHtml, /className: "dash-num-compact"\s*\}, dashCompactNum\(doneN\), "\/", dashCompactNum\(totalToday\)\)/);
  assert.match(indexHtml, /dash-ring-label"\s*\}, dashRingPct\(done, total\)\)/);
  assert.match(indexHtml, /Ada \$\{dashFullNum\(pendingToday\.length\)\} prioritas hari ini/);
});

test("6. CSS: ringkas hanya di HP, angka tidak pernah membungkus atau mendorong layout", () => {
  assert.match(appCss, /\.dash-hero-progress-text b \{[^}]*white-space: nowrap;[^}]*tabular-nums/);
  assert.match(appCss, /\n\.dash-num-compact \{ display: none; \}/);
  const mobile = appCss.slice(appCss.indexOf("@media (max-width: 640px) {\n  .dash-hero {"));
  const block = mobile.slice(0, mobile.indexOf("\n}"));
  assert.match(block, /\.dash-hero-progress \{ max-width: 76px; \}/);
  assert.match(block, /\.dash-num-full \{ display: none; \}/);
  assert.match(block, /\.dash-num-compact \{ display: inline; \}/);
  assert.match(block, /\.dash-hero-progress-text > span \{ display: none; \}/);
});
