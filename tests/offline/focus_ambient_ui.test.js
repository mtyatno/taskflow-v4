"use strict";

// UI suara latar: satu pemutar di App, kontrol PomoAmbient di kartu Pomodoro.

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

test("App: satu pemutar, prefs, efek update, hook debug", () => {
  const src = fnSource("App");
  assert.ok(src.includes("TF.ambient.createPlayer"));
  assert.ok(src.includes("readPrefs("));
  assert.ok(src.includes("writePrefs("));
  assert.ok(src.includes(".update({"));
  assert.ok(src.includes("__ambientState"));
  assert.ok(src.includes("preload: false"));
  assert.ok(src.includes("onState"));
  assert.ok(src.includes(".dispose()"));
  const m = src.match(/\.update\(\{[\s\S]*?\}, \[([^\]]*)\]\)/);
  assert.ok(m, "efek update dengan deps harus ada");
  assert.ok(m[1].includes("timer.phase"));
  assert.ok(m[1].includes("timer.isRunning"));
  assert.ok(m[1].includes("timer.mode"));
  assert.ok(m[1].includes("timer.timeLeft === 1500"));
});

test("App: logout / sesi berakhir (user null) memudarkan suara walau timer tetap berjalan", () => {
  const src = fnSource("App");
  const m = src.match(/\.update\(\{([\s\S]*?)\}\);?\s*\}, \[([^\]]*)\]\)/);
  assert.ok(m, "efek update dengan deps harus ada");
  assert.match(m[1], /isRunning: !!user && timer\.isRunning/);
  assert.ok(m[2].includes("!!user"), "deps efek harus memuat !!user");
});

test("PomoAmbient: label, tooltip, data-state, SOUNDS", () => {
  const src = fnSource("PomoAmbient");
  assert.ok(src.includes('"Suara latar"'));
  assert.ok(src.includes('"Volume suara latar"'));
  assert.ok(src.includes("aria-valuetext"));
  assert.ok(src.includes("data-state"));
  assert.ok(src.includes("Suara belum tersedia offline"));
  assert.ok(src.includes("Ketuk di mana saja untuk menyalakan suara"));
  assert.ok(src.includes("TF.ambient.SOUNDS"));
  assert.ok(src.includes("pomo-ambient-select"));
  assert.ok(src.includes("pomo-ambient-volume"));
});

test("PomoAmbient: status diumumkan lewat aria-live (bukan hanya warna ikon + title)", () => {
  const src = fnSource("PomoAmbient");
  assert.match(src, /className: "sr-only",\s*"aria-live": "polite"/);
  // Teks yang diumumkan = tooltip yang sama (waiting-tap / error), kosong untuk status lain.
  assert.match(src, /"aria-live": "polite"\s*\}, tip \|\| ""\)/);
});

test("PomodoroTimer merender PomoAmbient di focus-pomo-stats; props diteruskan", () => {
  const src = fnSource("PomodoroTimer");
  const stats = src.indexOf("focus-pomo-stats");
  assert.ok(stats >= 0);
  const amb = src.indexOf("PomoAmbient", stats);
  assert.ok(amb > stats, "PomoAmbient harus setelah focus-pomo-stats");
  assert.ok(fnSource("TodayFocusView").includes("ambient: ambient"));
  assert.ok(fnSource("App").includes("ambient: ambient"));
});

test("VIEW_GLYPHS memuat headphones", () => {
  assert.match(indexHtml, /\n  headphones: '/);
});

test("CSS: pomo-ambient, warna status, reduced-motion", () => {
  assert.ok(appCss.includes(".pomo-ambient"));
  assert.ok(appCss.includes("#f87171"));
  assert.ok(appCss.includes("#facc15"));
  assert.match(appCss, /prefers-reduced-motion: reduce\)\s*\{[^}]*\.pomo-ambient\[data-state="loading"\][^}]*animation: none/);
  assert.match(appCss, /max-width: 768px\)[\s\S]*?\.pomo-ambient\s*\{[^}]*flex-basis: 100%/);
  // Popup native <option> bisa gelap (tema OS): teks gelap butuh latar terang eksplisit.
  assert.match(appCss, /\.pomo-ambient-select option\s*\{[^}]*color: #111;[^}]*background: #fff/);
});
