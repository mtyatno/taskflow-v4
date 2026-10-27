// Hero Dashboard baru (spec docs/superpowers/specs/2026-10-27-hero-dashboard-design.md §3): sumber index.html + app.css.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "../..");
const html = fs.readFileSync(path.join(root, "static/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "static/app.css"), "utf8");

function fnSource(name) {
  const s = html.indexOf(`function ${name}(`);
  assert.ok(s >= 0, `${name} harus ada`);
  const e = html.indexOf("\n}\n", s);
  assert.ok(e > s, `${name} akhir`);
  return html.slice(s, e);
}
const dash = fnSource("Dashboard");
const illus = fnSource("DashHeroIllus");
const heroStart = dash.indexOf("/* ── Hero ── */");
const heroEnd = dash.indexOf("/* ── KPI ── */");
assert.ok(heroStart > 0 && heroEnd > heroStart, "blok hero ditemukan");
const hero = dash.slice(heroStart, heroEnd);
const cssRule = sel => {
  const re = new RegExp(`(^|\\n)\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  assert.ok(m, "aturan CSS " + sel);
  return m[2];
};

test("memakai window.TF.hero dengan cadangan bila modul belum termuat", () => {
  assert.match(dash, /window\.TF && window\.TF\.hero/);
  assert.match(dash, /\.bestStreak\(habits\)/);
  assert.match(dash, /\.habitChips\(habits, currentPhase, 3\)/);
  assert.match(dash, /\.focusChip\(focusTask, timer\)/);
});

test("teks UI persis", () => {
  for (const s of ["hari beruntun", "terlambat", '"Fokus"', '"Mulai"', '"Jeda"', '"Pilih task untuk difokuskan"']) {
    assert.ok(hero.includes(s), "teks hero: " + s);
  }
  assert.match(hero, /`\$\{heroStreak\.days\} hari beruntun`/);
  assert.match(hero, /title: `Streak terpanjang: \$\{heroStreak\.title\}`/);
  assert.match(hero, /`\$\{overdueCount\} terlambat`/);
});

test("ringkasan: cabang prioritas tidak lagi menyebut terlambat; chip terlambat bersyarat", () => {
  assert.ok(dash.includes("`Ada ${pendingToday.length} prioritas hari ini.`"));
  assert.ok(!/prioritas hari ini\$\{overdueCount/.test(dash));
  assert.match(dash, /const showOverdueChip = pendingToday\.length > 0 && overdueCount > 0;/);
  assert.match(hero, /showOverdueChip && /);
  // warna bahaya = aturan .dash-date.is-overdue yang sudah ada (terang + gelap), bukan literal baru
  assert.match(hero, /className: "dash-date is-overdue dash-hero-overdue"/);
  assert.ok(dash.includes('"Menyinkronkan datamu…"'));
});

test("latar topografi + ilustrasi: aria-hidden, ilustrasi per palet", () => {
  assert.match(hero, /className: "dash-hero-topo"[\s\S]{0,200}"aria-hidden": "true"/);
  assert.match(hero, /preserveAspectRatio: "xMaxYMid slice"/);
  assert.match(hero, /React\.createElement\(DashHeroIllus, \{\s*palette: heroPalette\s*\}\)/);
  assert.match(dash, /useThemeAttrs\(\)/);
  assert.match(illus, /className: "dash-hero-illus",\s*"aria-hidden": "true"/);
  assert.match(illus, /palette === "sakura"/);
  assert.match(illus, /palette === "lavender"/);
  // hanya kelas CSS (warna token di app.css), tanpa literal warna
  assert.doesNotMatch(illus, /#[0-9a-f]{3,8}\b|rgba?\(/i);
});

test("chip Fokus: aktif (judul → today, Mulai/Jeda → timer) atau ajakan; hanya saat intro dashboard + ada task", () => {
  assert.match(dash, /const showFocusChip = intro === "dashboard" && hasTasks;/);
  assert.match(hero, /showFocusChip && \(heroFocus\.kind === "active"/);
  assert.match(hero, /timer\.pause\(\)/);
  assert.match(hero, /timer\.start\(\)/);
  assert.match(hero, /heroFocus\.action === "pause" \? "Jeda" : "Mulai"/);
  assert.match(hero, /onClick: \(\) => onNav\("today"\)[\s\S]{0,200}"Pilih task untuk difokuskan"/);
  assert.match(hero, /name: "pTarget"/);
});

test("chip habit: belum selesai = tombol check-in, selesai = non-interaktif bercoret, +N → halaman Habit", () => {
  assert.match(hero, /totalHabits > 0 && /);
  assert.match(hero, /heroHabits\.shown\.map/);
  assert.match(hero, /onClick: \(\) => handleCheckinHabit\(h\)/);
  assert.match(hero, /"aria-label": `Selesaikan habit \$\{hTitle\}`/);
  assert.match(hero, /"aria-label": `\$\{hTitle\} sudah selesai`/);
  assert.match(hero, /className: "dash-hero-chip dash-hero-habit is-done"/);
  assert.match(hero, /heroHabits\.more > 0 && /);
  assert.match(hero, /onClick: \(\) => onNav\("habits"\)/);
  assert.match(hero, /"aria-label": `Lihat \$\{heroHabits\.more\} habit lainnya`/);
  assert.match(css, /\.dash-hero-habit\.is-done \.dash-hero-habit-name\s*\{[^}]*line-through/);
});

test("streak memakai ViewGlyph pFlame dan disembunyikan bila null", () => {
  assert.match(hero, /heroStreak && /);
  assert.match(hero, /name: "pFlame"/);
});

test("tanpa emoji di hero; pil habit lama dihapus", () => {
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(hero), "emoji di blok hero");
  assert.ok(!/\\u(D83|2[67])/i.test(hero), "escape emoji di blok hero");
  assert.ok(!/Kerja bagus! 🎉/.test(dash), "ringkasan hero tanpa emoji");
  for (const old of ["dash-hero-habit-strip", "dash-hero-habit-pill", "dash-hero-habit-tag", "dash-hero-habit-cta", "dash-hero-habit-count", "nextHabit"]) {
    assert.ok(!html.includes(old), "sisa lama di index.html: " + old);
    assert.ok(!css.includes(old), "sisa lama di app.css: " + old);
  }
});

test("CSS: gradien token, topo bermask, ilustrasi disembunyikan ≤1100px dan decor off, tanpa border-left", () => {
  const h = cssRule(".dash-hero");
  assert.match(h, /linear-gradient\(105deg, var\(--bg-card\) 30%, var\(--accent-soft\) 100%\)/);
  assert.match(h, /border: 1px solid rgba\(var\(--accent-rgb\), 0\.25\)/);
  assert.ok(!/\.dash-hero::after/.test(css), "glow ::after lama dihapus");
  const topo = cssRule(".dash-hero-topo");
  assert.match(topo, /pointer-events: none/);
  assert.match(topo, /mask-image: linear-gradient\(to right/);
  assert.match(cssRule(".dash-hero-topo g"), /stroke: var\(--accent\)/);
  assert.match(cssRule(".dash-hero-illus"), /pointer-events: none/);
  assert.match(css, /\[data-decor="off"\] \.dash-hero-illus\s*\{\s*display: none;/);
  assert.match(css, /@media \(max-width: 1100px\)\s*\{[^@]*\.dash-hero-illus\s*\{\s*display: none;/);
  assert.match(cssRule(".dash-hero-focus-act"), /color: var\(--accent-on, #1a2a00\)/);
  const block = css.slice(css.indexOf("\n.dash-hero {"), css.indexOf(".dash-ring {"));
  assert.doesNotMatch(block, /border-left/);
});

test("CSS HP (≤640px): chip Fokus penuh ≥44px, habit satu baris geser, chip ≥36px", () => {
  const m = css.match(/@media \(max-width: 640px\) \{\n  \.dash-hero \{[\s\S]*?\n\}/);
  assert.ok(m, "blok mobile dashboard");
  const b = m[0];
  assert.match(b, /\.dash-hero-focus\s*\{[^}]*width: 100%;[^}]*min-height: 44px;/);
  assert.match(b, /\.dash-hero-focus-act\s*\{[^}]*min-height: 44px;/);
  assert.match(b, /\.dash-hero-habits\s*\{[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto;/);
  assert.match(b, /\.dash-hero-chip\s*\{[^}]*min-height: 36px;/);
});
