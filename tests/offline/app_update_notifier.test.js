"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const swJs = fs.readFileSync(path.resolve(__dirname, "../../static/sw.js"), "utf8");
const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8");
const appCss = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8");
const appUpdateJs = fs.readFileSync(path.resolve(__dirname, "../../static/offline/appupdate.js"), "utf8");

function fnSource(name) {
  const start = indexHtml.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist in index.html`);
  const end = indexHtml.indexOf("\n}\n", start);
  assert.ok(end > start, `${name} end must be found`);
  return indexHtml.slice(start, end);
}

test("1. Service Worker: CACHE version is bumped to taskflow-v484-ws-modal", () => {
  assert.match(swJs, /^const CACHE = "taskflow-v484-ws-modal";/m);
});

test("2. Service Worker: install event respects active worker (waits for skipWaiting prompt)", () => {
  assert.match(swJs, /self\.addEventListener\("install"/);
  assert.match(swJs, /!self\.registration\.active/);
  assert.match(swJs, /self\.skipWaiting\(\)/);
});

test("3. Service Worker: message event handles SKIP_WAITING as string and object", () => {
  assert.match(swJs, /self\.addEventListener\("message"/);
  assert.match(swJs, /SKIP_WAITING/);
  assert.match(swJs, /e\.data === "SKIP_WAITING"/);
  assert.match(swJs, /e\.data\.type === "SKIP_WAITING"/);
});

test("4. Service Worker: /api/version route is NETWORK-ONLY", () => {
  assert.match(swJs, /url\.pathname === "\/api\/version"/);
});

test("5. Frontend: UpdateNotificationBanner component exists with required elements", () => {
  const src = fnSource("UpdateNotificationBanner");
  assert.doesNotMatch(src, /🚀|🔄/, "emoji diganti komponen Icon");
  assert.match(src, /React\.createElement\(Icon, \{ name: "sparkles"/, "harus memiliki ikon sparkles di depan pesan");
  assert.match(src, /Pembaruan Alurik tersedia! Muat ulang untuk mendapatkan fitur-fitur terbaru\./, "harus menampilkan pesan pembaruan");
  assert.match(src, /React\.createElement\(Icon, \{ name: "refresh"/, "tombol pembaruan memakai ikon refresh");
  assert.match(src, /updating \? "Memperbarui…" : "Perbarui Sekarang"/, "harus memiliki tombol Perbarui Sekarang → Memperbarui…");
  assert.match(src, /disabled: updating/, "tombol nonaktif selama memperbarui");
  assert.match(src, /✕/, "harus memiliki tombol tutup ✕");
  assert.match(src, /handleUpdate/, "harus memanggil update handler");
  assert.match(src, /window\.applyAppUpdate/, "harus mendukung applyAppUpdate");
});

test("6. Frontend: Service Worker registration and update detection logic exists", () => {
  // Pemasangan tetap di skrip inline index.html.
  assert.match(indexHtml, /window\.__APP_VERSION\s*=\s*"4\.0\.0";/);
  assert.match(indexHtml, /window\.__SW_VERSION\s*=\s*"taskflow-v484-ws-modal";/);
  assert.match(indexHtml, /<script src="\/static\/offline\/appupdate\.js"><\/script>/);
  assert.match(indexHtml, /window\.TF\.appupdate\.createAppUpdater\(/);
  assert.match(indexHtml, /navigator\.serviceWorker\.register\("\/sw\.js"/);
  assert.match(indexHtml, /updater\.track\(reg\)/);
  assert.match(indexHtml, /window\.checkForAppUpdate\s*=\s*function/);
  assert.match(indexHtml, /reg\.update\(\)/);
  assert.match(indexHtml, /visibilitychange/);
  assert.match(indexHtml, /document\.visibilityState === "visible"/);
  assert.match(indexHtml, /1800000/, "harus memiliki interval 30 menit (1800000 ms)");
  // Logika deteksi pindah ke static/offline/appupdate.js (TF.appupdate).
  assert.match(appUpdateJs, /reg\.addEventListener\("updatefound"/);
  assert.match(appUpdateJs, /worker\.state === "installed"/);
  assert.match(appUpdateJs, /sw\.controller/);
  assert.match(appUpdateJs, /reg\.update\(\)/);
  assert.match(appUpdateJs, /\/api\/version\?t=/);
});

test("7. Frontend: SettingsPage displays app version, Cek Pembaruan and Apa yang baru buttons", () => {
  const src = fnSource("SettingsPage");
  assert.match(src, /Pembaruan Aplikasi/);
  assert.match(src, /window\.__APP_VERSION/);
  assert.match(src, /window\.__SW_VERSION/);
  assert.doesNotMatch(src, /🔍/, "emoji diganti komponen Icon");
  assert.match(src, /React\.createElement\(Icon, \{ name: "search", size: 15 \}\), "Cek Pembaruan"/);
  assert.match(src, /React\.createElement\(Icon, \{ name: "sparkles", size: 15 \}\), "Apa yang baru"/);
  assert.match(src, /window\.checkForAppUpdate\(\{ manual: true \}\)/);
});

test("8. Frontend: App layout renders UpdateNotificationBanner when hasAppUpdate is true", () => {
  const src = fnSource("App");
  assert.match(src, /const \[hasAppUpdate, setHasAppUpdate\] = useState/);
  assert.match(src, /addEventListener\("appupdateavailable"/);
  assert.match(src, /React\.createElement\(UpdateNotificationBanner/);
});

test("9. CSS: .update-notification-banner styles and slideUpFade animation exist", () => {
  assert.match(appCss, /\.update-notification-banner/);
  assert.match(appCss, /@keyframes slideUpFade/);
});

test("10. CSS: .dash defines full-width fluid layout without 1320px restriction", () => {
  assert.match(appCss, /\.dash\s*\{[^}]*width:\s*100%;\s*max-width:\s*100%;/);
  assert.doesNotMatch(appCss, /\.dash\s*\{[^}]*max-width:\s*1320px/);
});
