"use strict";

// UI Target pomodoro: realisasi/estimasi di bar aktif, chip task, pemilih tomat, header.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const appCss = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8").replace(/\r\n/g, "\n");

function fnSource(name) {
  const start = indexHtml.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = indexHtml.indexOf("\n}\n", start + 1);
  assert.ok(end > start, `${name} end must be found`);
  return indexHtml.slice(start, end);
}

test("PomodoroTimer: bar task aktif realisasi / estimasi tanpa emoji", () => {
  const src = fnSource("PomodoroTimer");
  assert.ok(!src.includes("🍅"));
  assert.ok(src.includes('name: "pomoTomato"'));
  assert.ok(src.includes("pomodoros_done"));
  assert.ok(src.includes("clampEstimate("));
  assert.ok(src.includes("focus-pomo-task-done"));
  assert.ok(src.includes("is-over"));
  assert.ok(src.includes("Realisasi / estimasi pomodoro"));
});

test("FocusTaskItem: chip, pemilih estimasi, urutan DOM", () => {
  const src = fnSource("FocusTaskItem");
  const sig = src.slice(0, src.indexOf(") {"));
  assert.ok(sig.includes("onEstimate"));
  assert.ok(src.includes("ftask-count is-pomo"));
  assert.ok(src.includes('name: "pomoTomato"'));
  assert.ok(src.includes("Realisasi / estimasi pomodoro"));
  assert.ok(src.includes("ftask-estimate"));
  assert.ok(src.includes('role: "radiogroup"'));
  assert.ok(src.includes('"Estimasi pomodoro"'));
  assert.ok(src.includes("nextEstimate("));
  assert.ok(src.includes('"5+"'));
  assert.ok(src.includes("ftask-est-btn"));
  assert.ok(src.includes("is-filled"));
  const bar = src.indexOf('className: "ftask-tabbar"');
  const tabs = src.indexOf('className: "ftask-tabs"', bar);
  const list = src.indexOf('role: "tablist"', tabs);
  const map = src.indexOf("FOCUS_TABS.map", list);
  const est = src.indexOf('className: "ftask-estimate"', map);
  const link = src.indexOf("ftask-detail-link", est);
  assert.ok(bar >= 0 && tabs > bar && list > tabs && map > list && est > map && link > est);
  // picker tidak boleh di dalam tablist: setelah map tab, tablist ditutup sebelum picker
  assert.ok(/\}\)\), React\.createElement\("div", \{\n    className: "ftask-estimate"/.test(src));
});

test("TodayFocusView: handleEstimate dan header ringkasan", () => {
  const src = fnSource("TodayFocusView");
  assert.ok(src.includes("headerSummary("));
  assert.ok(src.includes("estimated_pomodoros: n"));
  assert.ok(src.includes("Gagal menyimpan estimasi"));
  assert.ok(src.includes("onEstimate: handleEstimate"));
  assert.ok(!src.includes('" 🍅 hari ini"'));
  assert.ok(!src.includes("🍅"));
  assert.ok(src.includes("focus-page-summary"));
});

test("CSS: is-over dan pemilih tomat", () => {
  // Oranye "melebihi estimasi" = versi teks per mode (latar hero §6): #9a3412 di kotak task terang (≥ 4,5:1 di atas
  // putih 0.78 + latar pastel), #fb923c (nilai lama) gelap.
  assert.match(appCss, /\.focus-pomo-task-done\.is-over\s*\{[^}]*color: var\(--pomo-text-orange\)/);
  const tok = (block, name) => (block.match(new RegExp(`\\n\\s*${name}: ([^;]+);`)) || [])[1];
  const rootBlk = appCss.slice(appCss.indexOf(":root {"), appCss.indexOf("}", appCss.indexOf(":root {")));
  const darkBlk = appCss.slice(appCss.indexOf('[data-theme="dark"] {'), appCss.indexOf("}", appCss.indexOf('[data-theme="dark"] {')));
  assert.equal(tok(rootBlk, "--pomo-text-orange"), "#9a3412");
  assert.equal(tok(darkBlk, "--pomo-text-orange"), "#fb923c");
  assert.match(appCss, /\.ftask-count\.is-pomo\.is-over\s*\{[^}]*var\(--p2\)/);
  assert.ok(appCss.includes(".ftask-estimate"));
  assert.match(appCss, /\.ftask-est-btn\s*\{[^}]*26px/);
  assert.ok(appCss.includes(".ftask-est-btn:focus-visible"));
});

test("FocusTaskItem: radiogroup pindah ke .ftask-est-group, .ftask-estimate luar tanpa role", () => {
  const src = fnSource("FocusTaskItem");
  const outer = src.indexOf('className: "ftask-estimate"');
  const group = src.indexOf('className: "ftask-est-group"', outer);
  assert.ok(outer >= 0 && group > outer);
  // div luar tanpa role: tidak ada "radiogroup" antara className luar dan grup
  assert.ok(!src.slice(outer, group).includes("radiogroup"));
  const groupHead = src.slice(group, group + 120);
  assert.ok(groupHead.includes('role: "radiogroup"'));
  assert.ok(groupHead.includes('"aria-label": "Estimasi pomodoro"'));
  assert.equal(src.split('role: "radiogroup"').length - 1, 1);
});

test("FocusTaskItem: kolom angka hanya saat pomoEst >= 5, saudara radiogroup di dalam .ftask-estimate", () => {
  const src = fnSource("FocusTaskItem");
  const group = src.indexOf('className: "ftask-est-group"');
  const lastBtn = src.indexOf('className: "ftask-est-plus"', group);
  const input = src.indexOf('className: "ftask-est-input"', lastBtn);
  const link = src.indexOf("ftask-detail-link", input);
  assert.ok(group >= 0 && lastBtn > group && input > lastBtn && link > input);
  // penutup grup (akhir .map tombol) ada sebelum kolom angka
  const between = src.slice(lastBtn, input);
  assert.match(between, /\)\)\)\), pomoEst >= 5 && React\.createElement\("input", \{/);
  const blk = src.slice(input - 200, input + 700);
  assert.ok(blk.includes('type: "number"'));
  assert.ok(blk.includes('inputMode: "numeric"'));
  assert.ok(blk.includes("min: 1"));
  assert.ok(blk.includes("max: 99"));
  assert.ok(blk.includes('"aria-label": "Target pomodoro (1–99)"'));
  assert.ok(blk.includes('title: "Target pomodoro (1–99)"'));
  assert.ok(src.includes("parseEstimate("));
});

test("FocusTaskItem: badge ×n diganti kolom angka (tidak dirender lagi)", () => {
  const src = fnSource("FocusTaskItem");
  assert.ok(!src.includes("ftask-est-badge"));
  assert.ok(src.includes('"5+"'));
});

test("FocusTaskItem: komit satu kali, dijaga nilai terkirim, Escape tanpa onEstimate", () => {
  const src = fnSource("FocusTaskItem");
  assert.ok(src.includes("lastSentRef"));
  const fn = src.indexOf("const commitEst");
  assert.ok(fn >= 0);
  const nullCheck = src.indexOf("n == null", fn);
  const sameCheck = src.indexOf("lastSentRef.current", fn);
  const call = src.indexOf("onEstimate(task, n)", fn);
  assert.ok(nullCheck > fn && sameCheck > fn && call > nullCheck && call > sameCheck);
  // hanya satu pemanggilan onEstimate(task, n) di jalur ketik
  assert.equal(src.split("onEstimate(task, n)").length - 1, 1);
  // Enter mengabaikan komposisi IME
  assert.ok(src.includes("isComposing"));
  // Escape: membatalkan tanpa onEstimate
  const esc = src.indexOf('"Escape"', fn);
  assert.ok(esc > fn);
  const escBlk = src.slice(esc, esc + 450);
  assert.ok(!escBlk.includes("onEstimate"));
  assert.ok(escBlk.includes("stopPropagation"));
});

test("CSS: kolom angka target Fokus", () => {
  assert.match(appCss, /\.ftask-est-group\s*\{[^}]*inline-flex/);
  const m = appCss.match(/\.ftask-est-input\s*\{[^}]*\}/);
  assert.ok(m, ".ftask-est-input harus ada");
  assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(m[0]), "tanpa hex baru");
  assert.ok(!/border-left/.test(m[0]));
  assert.match(m[0], /26px/);
  assert.ok(appCss.includes(".ftask-est-input:focus-visible"));
  assert.ok(appCss.includes('[data-theme="dark"] .ftask-est-input:focus-visible'));
  assert.ok(appCss.includes("::-webkit-inner-spin-button"));
  assert.ok(appCss.includes("-moz-appearance: textfield"));
});
