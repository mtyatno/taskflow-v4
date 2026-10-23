"use strict";
// Fase 0a akun: adopsi token setelah ganti password/username/lengkapi akun, kartu "Lengkapi akun",
// banner email (source assertions pada static/index.html).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");
const sw = fs.readFileSync(path.join(__dirname, "../../static/sw.js"), "utf8");
const py = fs.readFileSync(path.join(__dirname, "../../webapp.py"), "utf8");

function slice(startMarker, endMarker, max = 20000) {
  const i = html.indexOf(startMarker);
  assert.ok(i >= 0, "missing: " + startMarker);
  const j = endMarker ? html.indexOf(endMarker, i + startMarker.length) : -1;
  return html.slice(i, j > i ? j : i + max);
}
const settings = () => slice("function SettingsPage(", "\nfunction ", 40000);
const handler = (name) => {
  const s = settings();
  const i = s.indexOf("const " + name + " = async");
  assert.ok(i >= 0, "missing handler " + name);
  const j = s.indexOf("\n  const ", i + 10);
  return s.slice(i, j > i ? j : i + 3000);
};

test("adoptSessionToken: tokenStore.set + cadangan native save_token (Tauri)", () => {
  const body = slice("function adoptSessionToken(", "\n}\n", 1500);
  assert.match(body, /tokenStore\.set\(token\)/);
  assert.match(body, /API_BASE && window\.__TAURI__\?\.core\?\.invoke/);
  assert.match(body, /invoke\("save_token", \{ token \}\)/);
  assert.match(body, /if \(!token\) return/);
});

test("ganti password: memakai token baru dari server", () => {
  const b = handler("handlePassword");
  assert.match(b, /const data = await api\.patch\("\/api\/auth\/profile\/password"/);
  assert.match(b, /adoptSessionToken\(data && data\.token\)/);
});

test("ganti username: field backend, adopsi token, display_name tidak ditimpa", () => {
  const b = handler("handleUsername");
  assert.match(b, /api\.patch\("\/api\/auth\/profile\/username", \{\s*new_username: unForm\.new_username\.trim\(\),\s*current_password: unForm\.current_password\s*\}\)/);
  assert.match(b, /adoptSessionToken\(data && data\.token\)/);
  assert.doesNotMatch(b, /display_name:\s*data\.username/);
  assert.match(b, /username: data\.username/);
});

test("hint aturan username di bawah input", () => {
  assert.ok(settings().includes("Huruf, angka, dan _ saja (3–50 karakter), tidak diawali tg_."));
});

test("kartu Lengkapi akun hanya bila password_set === false, menggantikan 3 form akun", () => {
  const s = settings();
  assert.match(s, /const needsSetup = user\?\.password_set === false;/);
  assert.match(s, /needsSetup \? \/\*#__PURE__\*\/React\.createElement\(\"div\", \{\s*className: "card account-setup-card"/);
  assert.ok(s.includes("Lengkapi akun"));
  assert.ok(s.includes("Akun ini dibuat dari Telegram. Atur email dan password supaya kamu bisa masuk tanpa Telegram dan memulihkan akun bila lupa password."));
  // placeholder username = username sekarang
  assert.match(s, /placeholder: user\?\.username \|\| ""/);
});

test("lengkapi akun: validasi, POST complete-account, adopsi token, update user, toast", () => {
  const b = handler("handleCompleteAccount");
  assert.match(b, /TF\.accountbanner\.validateCompleteAccount\(/);
  assert.match(b, /api\.post\("\/api\/auth\/complete-account", body\)/);
  assert.match(b, /adoptSessionToken\(data && data\.token\)/);
  assert.match(b, /onUsernameChange\(\{\s*\.\.\.user,\s*username: data\.username,\s*email: data\.email,\s*password_set: true\s*\}\)/);
  assert.ok(b.includes('showToast("Akun berhasil dilengkapi ✅")'));
  // username kosong tidak dikirim (server memakai username lama)
  assert.match(b, /if \(un\) body\.new_username = un;/);
});

test("Field dipanggil sebagai fungsi (bukan komponen baru tiap render → input tidak kehilangan fokus)", () => {
  const s = settings();
  assert.doesNotMatch(s, /React\.createElement\(Field,/);
  assert.match(s, /Field\(\{/);
});

test("AccountBanner memakai TF.accountbanner.decide + localStorage dibungkus try/catch", () => {
  const b = slice("function AccountBanner(", "\n}\n", 4000);
  assert.match(b, /TF\.accountbanner\.decide\(\{ user, now: Date\.now\(\), dismissedUntil \}\)/);
  assert.match(b, /try \{[^}]*localStorage\.getItem\(AB\.DISMISS_KEY\)/);
  assert.match(b, /try \{[^}]*localStorage\.setItem\(AB\.DISMISS_KEY/);
  assert.ok(b.includes("Tambahkan email agar kamu bisa memulihkan akun bila lupa password."));
  assert.ok(b.includes("Lengkapi akunmu: atur email dan password agar bisa masuk tanpa Telegram."));
  assert.ok(b.includes('"Buka Pengaturan"'));
  assert.match(b, /"aria-label": "Tutup pengingat akun selama 7 hari"/);
  assert.match(b, /className: "app-banner account-banner"/);
});

test("AccountBanner dirender di atas konten halaman, disembunyikan di halaman Pengaturan", () => {
  assert.match(html, /page !== "settings" && \/\*#__PURE__\*\/React\.createElement\(AccountBanner, \{\s*user: user,\s*onOpenSettings: \(\) => setPage\("settings"\)\s*\}\), renderContent\(\)/);
});

test("accountbanner.js dimuat dan di-precache service worker", () => {
  assert.match(html, /<script src="\/static\/offline\/accountbanner\.js"><\/script>/);
  assert.match(sw, /"\/static\/offline\/accountbanner\.js"/);
});

test("cache bust v450 + app.css?v=364", () => {
  assert.match(sw, /^const CACHE = "taskflow-v466-apa-yang-baru";/m);
  assert.match(html, /window\.__SW_VERSION\s*=\s*"taskflow-v466-apa-yang-baru";/);
  assert.match(html, /window\.__SW_VERSION\s*\|\|\s*"taskflow-v466-apa-yang-baru"/);
  assert.match(html, /app\.css\?v=364/);
  assert.doesNotMatch(html, /v437|app\.css\?v=345/);
});
