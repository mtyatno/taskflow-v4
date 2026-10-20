const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "../../static/app.css"), "utf8");

function hookBody() {
  const i = html.indexOf("function useIntroState");
  assert.ok(i >= 0, "useIntroState missing");
  const j = html.indexOf("function DashSyncCard", i);
  return html.slice(i, j > i ? j : i + 6000);
}

test("index.html mendefinisikan useIntroState dan DashSyncCard", () => {
  assert.match(html, /function useIntroState\s*\(\s*tasks\s*\)/);
  assert.match(html, /DashSyncCard\s*=|function DashSyncCard/);
  assert.match(html, /window\.TF\.DashSyncCard\s*=\s*DashSyncCard/);
});

test("slot welcome memakai intro === welcome && !dismissedOnboarding dan DashSyncCard untuk mode status", () => {
  assert.match(html, /intro\s*===\s*"welcome"\s*&&\s*!dismissedOnboarding/);
  assert.match(html, /createElement\(DashSyncCard/);
  assert.match(html, /syncing[\s\S]{0,80}offline_empty[\s\S]{0,80}sync_error/);
});

test("teks UI persis", () => {
  for (const s of [
    "Menyinkronkan data kamu dari server…",
    "Datamu aman di server. Sebentar lagi muncul di sini.",
    "Belum terhubung ke server",
    "Datamu akan muncul setelah perangkat ini online.",
    "Gagal mengambil data dari server",
    "Datamu aman di server. Coba lagi sebentar lagi.",
    "Coba lagi",
    "Menyinkronkan datamu…",
    "Menunggu koneksi untuk memuat datamu.",
    "Datamu belum termuat.",
  ]) assert.ok(html.includes(s), "missing: " + s);
});

test('"Selamat datang di Alurik!" hanya di cabang intro === "welcome"', () => {
  assert.match(html, /intro\s*===\s*"welcome"\s*\?\s*"Selamat datang di Alurik! Mari mulai dengan mencatat tugas atau ide pertamamu\."/);
  assert.equal(html.split("Selamat datang di Alurik! Mari mulai").length - 1, 1);
});

test("useIntroState memanggil __refreshTasks saat tf:initial-sync dan tasks kosong", () => {
  const b = hookBody();
  assert.match(b, /tf:initial-sync/);
  assert.match(b, /__refreshTasks/);
});

test("useIntroState mendengarkan tf:sync-state, noteSaved, online, offline", () => {
  const b = hookBody();
  for (const ev of ["tf:sync-state", "noteSaved", "online", "offline"])
    assert.ok(b.includes('"' + ev + '"'), ev);
  assert.match(b, /removeEventListener/);
});

test("app.css punya .dash-sync-card tanpa border-left", () => {
  const i = css.indexOf(".dash-sync-card");
  assert.ok(i >= 0);
  const block = css.slice(i, i + 3000);
  assert.doesNotMatch(block, /border-left/);
  assert.match(css, /prefers-reduced-motion[\s\S]{0,200}dash-sync/);
});

test("__refreshTasks dalam useIntroState hanya di dalam callback then() hasLocalData", () => {
  const b = hookBody();
  assert.match(b, /\.then\(\(\[has, done\]\)[^]*?has === true[^]*?__refreshTasks/);
  assert.equal(b.split("__refreshTasks()").length - 1, 1);
  assert.doesNotMatch(b, /onInitial = \(\) => \{[^}]*__refreshTasks/);
});

test("sync() finish memanggil readInitialSync sebelum markInitialSync", () => {
  const m = html.match(/function sync\(\) \{[\s\S]*?\n\}/)[0];
  const r = m.indexOf("readInitialSync"), k = m.indexOf("markInitialSync");
  assert.ok(r > 0 && k > r);
});

test("useIntroState membaca hasLocalData dan readInitialSync bersamaan (Promise.all), tanpa jalur syncDone sendiri", () => {
  const b = hookBody();
  assert.match(b, /Promise\.all\(\[[^]*?hasLocalData\(\)[^]*?readInitialSync\([^]*?\]\)/);
  assert.equal(b.split("readInitialSync(").length - 1, 1);
  assert.equal(b.split("hasLocalData()").length - 1, 1);
  assert.doesNotMatch(b, /setSyncDone/);
  assert.match(b, /setRead\(\{\s*localHas:[^}]*syncDone:/);
});
