"use strict";
// Fase 0b: kartu "Email" di halaman Admin (source assertions pada static/index.html, sw.js, app.css).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");
const sw = fs.readFileSync(path.join(__dirname, "../../static/sw.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "../../static/app.css"), "utf8");

function slice(startMarker, endMarker, max = 30000) {
  const i = html.indexOf(startMarker);
  assert.ok(i >= 0, "missing: " + startMarker);
  const j = endMarker ? html.indexOf(endMarker, i + startMarker.length) : -1;
  return html.slice(i, j > i ? j : i + max);
}
const card = () => slice("function AdminEmailCard(", "\nfunction ", 40000);
const adminPage = () => slice("function AdminPage(", "\nfunction ", 40000);

test("helper dimuat: <script src> emailadmin.js + precache SW", () => {
  assert.match(html, /<script src="\/static\/offline\/emailadmin\.js"><\/script>/);
  assert.match(sw, /"\/static\/offline\/emailadmin\.js"/);
});

test("AdminPage merender AdminEmailCard di atas User Management", () => {
  const p = adminPage();
  const iCard = p.indexOf("React.createElement(AdminEmailCard");
  const iUsers = p.indexOf('"User Management"');
  assert.ok(iCard >= 0, "AdminEmailCard tidak dirender");
  assert.ok(iUsers >= 0);
  assert.ok(iCard < iUsers, "kartu Email harus di atas daftar user");
  assert.match(p.slice(iCard, iCard + 200), /showToast: showToast/);
});

test("kartu memanggil endpoint status / test / retry", () => {
  const c = card();
  assert.match(c, /api\.get\("\/api\/admin\/email\/status", \{ network: true \}\)/);
  assert.match(c, /api\.post\("\/api\/admin\/email\/test"/);
  assert.match(c, /api\.post\("\/api\/admin\/email\/" \+ row\.id \+ "\/retry"/);
});

test("kartu memakai TF.emailadmin (modeBadge, POLL_MS, POLL_MAX_MS, isPollingDone)", () => {
  const c = card();
  assert.match(c, /EA\.modeBadge\(/);
  assert.match(c, /EA\.POLL_MAX_MS/);
  assert.match(c, /EA\.POLL_MS/);
  assert.match(c, /EA\.testOutcome\(/);
  assert.match(c, /window\.TF && window\.TF\.emailadmin/);
});

test("judul 'Email' memakai glyph mMail, tanpa emoji", () => {
  const c = card();
  assert.match(html, /mMail: '<rect/);
  assert.match(c, /React\.createElement\(ViewGlyph, \{ name: "mMail"/);
  assert.match(c, /"Email"\)/);
  assert.doesNotMatch(c, /📧|✉️|✉|\\uD83D\\uDCE7|\\u2709/);
});

test("teks wajib: gagal muat, coba lagi, muat ulang, kirim email tes, ringkasan 4 angka", () => {
  const c = card();
  for (const s of ["Gagal memuat status email", "Coba lagi", "Muat ulang", "Kirim email tes",
                   "Terkirim", "Gagal", "Antre", "Kedaluwarsa"]) {
    assert.ok(c.includes(s), "tidak ada teks: " + s);
  }
  assert.match(c, /type: "email"/);
  assert.match(c, /EA\.truncate\(/);
  assert.match(c, /title: row\.last_error/);
});

test("polling dihentikan saat unmount (clearTimeout + flag mounted)", () => {
  const c = card();
  assert.match(c, /mountedRef\.current = false/);
  assert.match(c, /clearTimeout\(pollRef\.current\)/);
});

test("CSS kartu email: ada blok .admin-email, tanpa border-left, ada media 768px + tema gelap", () => {
  const i = css.indexOf("/* Admin: kartu Email");
  assert.ok(i >= 0, "blok CSS kartu email tidak ada");
  const j = css.indexOf("/* /Admin: kartu Email */", i);
  assert.ok(j > i, "penutup blok CSS kartu email tidak ada");
  const block = css.slice(i, j);
  assert.doesNotMatch(block, /border-left/);
  assert.match(block, /@media \(max-width: 768px\)/);
  assert.match(block, /\[data-theme="dark"\] \.admin-email-chip/);
});

test("cache bust v453 + app.css?v=362", () => {
  const py = fs.readFileSync(path.join(__dirname, "../../webapp.py"), "utf8");
  assert.match(sw, /^const CACHE = "taskflow-v466-istilah-sketsa-media";/m);
  assert.match(html, /window\.__SW_VERSION\s*=\s*"taskflow-v466-istilah-sketsa-media";/);
  assert.match(html, /window\.__SW_VERSION\s*\|\|\s*"taskflow-v466-istilah-sketsa-media"/);
  assert.match(py, /sw_cache = "taskflow-v466-istilah-sketsa-media"/);
  assert.match(html, /<link rel="stylesheet" href="\/static\/app\.css\?v=362">/);
});
