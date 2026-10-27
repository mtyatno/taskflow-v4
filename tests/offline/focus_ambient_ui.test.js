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
  // Warna status bermakna lewat versi teks per mode (latar hero §6; terang lebih tua, gelap = #4ade80/#f87171/#facc15).
  for (const [st, tok] of [["playing", "green"], ["error", "red"], ["waiting-tap", "yellow"]]) {
    assert.match(appCss, new RegExp(`\\.pomo-ambient\\[data-state="${st}"\\] \\.pomo-ambient-icon \\{ color: var\\(--pomo-text-${tok}\\); \\}`), st);
    assert.match(appCss, new RegExp(`\\.pomo-amb-mobile\\[data-state="${st}"\\] \\.pomo-amb-pill svg:first-child \\{ color: var\\(--pomo-text-${tok}\\); \\}`), "HP " + st);
  }
  const darkTok = appCss.slice(appCss.indexOf('[data-theme="dark"] {'), appCss.indexOf("}", appCss.indexOf('[data-theme="dark"] {')));
  for (const d of ["--pomo-text-green: #4ade80", "--pomo-text-red: #f87171", "--pomo-text-yellow: #facc15"]) assert.ok(darkTok.includes(d), d);
  assert.match(appCss, /prefers-reduced-motion: reduce\)\s*\{[^}]*\.pomo-ambient\[data-state="loading"\][^}]*animation: none/);
  // HP (kartu ringkas): kontrol inline disembunyikan, diganti pil 🎧 + popover di baris atas
  const hp = appCss.slice(appCss.indexOf("/* Kartu Pomodoro ringkas di HP */"));
  assert.match(hp, /\.focus-pomo-stats \.pomo-ambient[^{]*\{[^}]*display: none/);
  assert.match(hp, /\.pomo-amb-mobile \{[^}]*grid-area: amb/);
  // Popup native <option> bisa gelap (tema OS): teks gelap butuh latar terang eksplisit.
  assert.match(appCss, /\.pomo-ambient-select option\s*\{[^}]*color: #111;[^}]*background: #fff/);
});
