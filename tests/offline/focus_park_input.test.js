"use strict";

// Parkir Distraksi: input cepat di kartu Pomodoro halaman Fokus Hari Ini.

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

test("PomoParkInput: salin, a11y, dan perilaku utama", () => {
  const src = fnSource("PomoParkInput");
  assert.ok(src.includes("Ada pikiran lewat? Ketik & tekan Enter untuk simpan ke Inbox..."));
  assert.ok(src.includes("maxLength: 200"));
  assert.ok(src.includes('"aria-label": "Parkir distraksi ke Inbox"'));
  assert.ok(src.includes("e.stopPropagation()"));
  assert.ok(src.includes("isComposing"));
  assert.ok(src.includes("229"));
  assert.ok(src.includes("parkPayload("));
  assert.ok(src.includes('api.post("/api/tasks"'));
  assert.ok(src.includes("__refreshTasks"));
  assert.ok(src.includes("1500"));
  assert.ok(src.includes('"Gagal menyimpan ke Inbox"'));
  assert.ok(!src.includes("Tersimpan ke Inbox"), "sukses hanya diumumkan HUD (satu pengumuman SR)");
  assert.ok(!src.includes('className: "sr-only"'), "tanpa live region sr-only kedua");
  const guard = src.search(/busy\.current\)\s*return/);
  assert.ok(guard >= 0, "guard busy ada");
  assert.ok(guard < src.indexOf('api.post("/api/tasks"'), "guard busy sebelum api.post");
});

test("PomodoroTimer: PomoParkInput dirender sebelum task/hint", () => {
  const src = fnSource("PomodoroTimer");
  const p = src.indexOf("React.createElement(PomoParkInput");
  assert.ok(p >= 0);
  assert.ok(p < src.indexOf('"focus-pomo-task"'));
  assert.ok(p < src.indexOf('"focus-pomo-hint"'));
});

test("CSS: .pomo-park-input dan order mobile", () => {
  assert.ok(appCss.includes(".pomo-park-input"));
  // HP: kartu ringkas menempatkan kolom parkir di baris paling bawah (grid-area park)
  const i = appCss.indexOf("@media (max-width: 768px)", appCss.indexOf("/* Kartu Pomodoro ringkas di HP */"));
  assert.ok(i >= 0);
  const block = appCss.slice(i, appCss.indexOf("\n}\n", i));
  assert.match(block, /\.focus-pomo \.pomo-park\s*\{[^}]*grid-area:\s*park/);
});
