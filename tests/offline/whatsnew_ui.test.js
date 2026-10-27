"use strict";

// UI modal "Apa yang baru" (spec 2026-10-23-apa-yang-baru §3.5–3.6): WhatsNewModal, useWhatsNewOnLoad,
// tombol riwayat di Pengaturan, banner pembaruan tanpa emoji, gaya app.css.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8");
const appCss = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8");
const swJs = fs.readFileSync(path.resolve(__dirname, "../../static/sw.js"), "utf8");

// Sumber fungsi tingkat atas dari index.html, sampai "}" pertama di kolom 0. `async function` ikut dicari.
function fnSource(name) {
  let start = indexHtml.indexOf(`async function ${name}(`);
  if (start < 0) start = indexHtml.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist in index.html`);
  const end = indexHtml.indexOf("\n}\n", start);
  assert.ok(end > start, `${name} end must be found`);
  return indexHtml.slice(start, end);
}

test("WhatsNewModal: dialog aksesibel, teks Indonesia, tanpa HTML mentah", () => {
  const s = fnSource("WhatsNewModal");
  for (const re of [/role: "dialog"/, /"aria-modal": "true"/, /"aria-labelledby": "whatsnew-title"/, /Apa yang baru di Alurik/,
                    /"Baru"/, /"Diperbaiki"/, /Mengerti/, /pembaruan lain sebelumnya/, /name: "sparkles"/, /name: "wrench"/, /Escape/])
    assert.match(s, re);
  assert.doesNotMatch(s, /dangerouslySetInnerHTML/);
});

test("useWhatsNewOnLoad: penanda, tur, storage, sekali per muat", () => {
  const s = fnSource("useWhatsNewOnLoad");
  for (const re of [/TF\.whatsnew\.load/, /pickUnseen/, /shouldMarkSeen/, /writeSeen/, /driver-active/, /"storage"/, /__TF_HAD_USER_AT_LOAD/, /_whatsNewStarted/])
    assert.match(s, re);
});

test("App memanggil hook dan merender WhatsNewModal", () => {
  const s = fnSource("App");
  assert.match(s, /useWhatsNewOnLoad\(user\)/);
  assert.match(s, /React\.createElement\(WhatsNewModal/);
});

test("__TF_HAD_USER_AT_LOAD diset di skrip awal body sebelum skrip aplikasi", () => {
  const i = indexHtml.indexOf("window.__TF_HAD_USER_AT_LOAD");
  assert.ok(i > 0 && i < indexHtml.indexOf('<script src="/static/offline/'));
});

test("penanda tidak ikut dihapus saat logout", () => {
  assert.doesNotMatch(fnSource("clearLocalUserData"), /tf_whatsnew_seen/);
});

test("SettingsPage: tombol Apa yang baru (riwayat) + Cek Pembaruan tanpa emoji", () => {
  const s = fnSource("SettingsPage");
  assert.match(s, /Apa yang baru/); assert.match(s, /TF\.whatsnew\.history/);
  assert.match(s, /Catatan pembaruan belum tersedia/); assert.doesNotMatch(s, /🔍/);
});

test("UpdateNotificationBanner: ikon, bukan emoji; status Memperbarui…", () => {
  const s = fnSource("UpdateNotificationBanner");
  assert.doesNotMatch(s, /🚀|🔄/); assert.match(s, /Memperbarui…/); assert.match(s, /disabled/);
});

test("app.css: gaya modal + mode gelap + versi cocok dengan STATIC", () => {
  assert.match(appCss, /\.whatsnew-modal\s*\{/); assert.match(appCss, /\[data-theme="dark"\][^{]*\.whatsnew-/);
  assert.match(indexHtml, /app\.css\?v=372/); assert.match(swJs, /"\/static\/app\.css\?v=372"/);
});
