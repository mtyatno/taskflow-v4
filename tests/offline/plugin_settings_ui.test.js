// Kartu Pengaturan › Plugin (spec docs/superpowers/specs/2026-10-29-plugin-fase0a-design.md §4.8; rencana Task 6):
// sumber index.html — teks persis, role switch, status, Salin detail; bekerja offline (hanya TF.plugins/_meta).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "../..");
const html = fs.readFileSync(path.join(root, "static/index.html"), "utf8");

function fnSource(name) {
  const s = html.indexOf(`function ${name}(`);
  assert.ok(s >= 0, `${name} harus ada`);
  const e = html.indexOf("\n}\n", s);
  assert.ok(e > s, `${name} akhir`);
  return html.slice(s, e);
}
const card = fnSource("PluginSettingsCard");
const settings = fnSource("SettingsPage");

test("PluginSettingsCard dirender di SettingsPage tepat setelah ThemeSettingsCard, menerima showToast", () => {
  const theme = settings.indexOf("React.createElement(ThemeSettingsCard, {");
  const plug = settings.indexOf("React.createElement(PluginSettingsCard, {");
  assert.ok(theme > 0 && plug > theme, "setelah ThemeSettingsCard");
  const between = settings.slice(theme, plug);
  assert.equal((between.match(/React\.createElement\(/g) || []).length, 1, "tidak ada elemen lain di antaranya");
  assert.match(settings.slice(plug, settings.indexOf("})", plug)), /showToast: showToast/);
  // didefinisikan tepat sebelum blok komentar + ThemeSettingsCard (ThemeSettingsCard tetap tepat sebelum SettingsPage)
  const def = html.indexOf("\nfunction PluginSettingsCard(");
  const themeDef = html.indexOf("\nfunction ThemeSettingsCard(");
  assert.ok(def > 0 && themeDef > def, "sebelum ThemeSettingsCard");
  assert.equal((html.slice(def + 1, themeDef).match(/\nfunction /g) || []).length, 0, "tidak ada fungsi lain di antaranya");
});

test("judul, subjudul, kosong, badge, izin: teks persis", () => {
  for (const s of [
    '"Plugin"',
    '"Fitur opsional. Pilihanmu tersimpan di akun dan berlaku di semua perangkat."',
    '"Menunggu sinkron"',
    '"Dimatikan di perangkat ini karena error"',
    '"Butuh koneksi internet untuk sebagian fitur"',
    '"Belum ada plugin"',
    '"Bawaan"',
    '"Tidak butuh izin"',
    '"Menyimpan pengaturan di perangkat ini"',
    '"Salin detail"',
    '"Aktifkan lagi"',
    '"Dimuat"',
    '"Belum dimuat"',
    '"Error — "',
  ]) assert.ok(card.includes(s), "teks " + s);
  assert.ok(!card.includes("Status disimpan di perangkat ini."), "subjudul 0a sudah diganti");
});

test("Fase 0b: Menunggu sinkron saat pending; diredam → teks perangkat ini + Aktifkan lagi/Salin detail", () => {
  assert.match(card, /it\.pending \? hint\("Menunggu sinkron", "q"\)/);
  const sup = card.indexOf("it.suppressed");
  assert.ok(sup > 0, "cabang suppressed");
  assert.ok(card.indexOf('"Dimatikan di perangkat ini karena error"', sup) > sup);
});

test("toast ON/OFF persis memakai nama plugin", () => {
  assert.ok(card.includes("`Plugin ${it.name} diaktifkan`"));
  assert.ok(card.includes("`Plugin ${it.name} dinonaktifkan`"));
});

test("toggle role=switch + aria-checked + teks Aktif/Nonaktif, memanggil setEnabled", () => {
  assert.match(card, /role: "switch"/);
  assert.match(card, /"aria-checked": it\.enabled \? "true" : "false"/);
  assert.match(card, /it\.enabled \? "Aktif" : "Nonaktif"/);
  assert.match(card, /P\.setEnabled\(it\.id, !it\.enabled\)/);
  assert.match(card, /className: "theme-card-switch"/);
});

test("daftar dari TF.plugins.list(), render ulang pada event plugins.*, init idempoten", () => {
  assert.match(card, /P\.list\(\)/);
  assert.match(card, /\["plugins\.ready", "plugins\.changed", "plugins\.loaded"\]/);
  assert.match(card, /P\.init\(\)/);
  assert.match(card, /if \(!P\) return null;/, "aman bila runtime tidak termuat");
});

test("error: Aktifkan lagi menyalakan ulang; Salin detail menyalin TF.plugins.failures", () => {
  assert.match(card, /P\.setEnabled\(it\.id, true\)/);
  assert.match(card, /P\.failures\(it\.id\)/);
  assert.match(card, /navigator\.clipboard/);
});

test("tanpa localStorage dan tanpa fetch di kartu (A3: hanya _meta lewat runtime)", () => {
  assert.doesNotMatch(card, /localStorage|fetch\(|api\.(get|post|put)/);
});

// Temuan review akhir #5: toast sukses hanya bila writeText berhasil.
test("Salin detail: sukses hanya bila clipboard.writeText berhasil, selain itu 'Gagal menyalin detail'", () => {
  assert.doesNotMatch(card, /Promise\.resolve\(navigator\.clipboard\?\.writeText/);
  assert.match(card, /"Gagal menyalin detail"/);
  assert.match(card, /typeof cb\.writeText !== "function"/);
  assert.match(card, /cb\.writeText\(JSON\.stringify\(P\.failures\(it\.id\), null, 2\)\)\)\.then\(\(\) => showToast\("Detail error disalin"\), \(\) => showToast\("Gagal menyalin detail", "error"\)\)/);
});

test("izin task.ext (Fase 1): label persis di baris perm", () => {
  const line = card.split("\n").find((l) => l.includes("const perm = it =>"));
  assert.ok(line, "baris perm");
  assert.ok(line.includes('p === "task.ext" ? "Menyimpan data tambahan di task (ikut tersinkron)"'));
});
