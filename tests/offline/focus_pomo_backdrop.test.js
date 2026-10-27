"use strict";
// Kartu Pomodoro Fokus Hari Ini dengan latar pilihan (spec docs/superpowers/specs/2026-10-27-latar-hero-design.md §6):
// HeroBackdrop place="pomo" + cahaya fase + piringan ring, teks/garis/tombol sekunder lewat token (kartu terang di mode
// terang, ikut palet di mode gelap), warna bermakna versi teks per mode, bar ringkas = permukaan kartu palet.
// Sumber index.html + app.css + themes.css (nilai palet untuk uji kontras token).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "../..");
const html = fs.readFileSync(path.join(root, "static/index.html"), "utf8").replace(/\r\n/g, "\n");
const css = fs.readFileSync(path.join(root, "static/app.css"), "utf8").replace(/\r\n/g, "\n");
const tcss = fs.readFileSync(path.join(root, "static/themes.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const herobg = require("../../static/offline/herobg.js");

function fnSource(name) {
  const s = html.indexOf(`\nfunction ${name}(`);
  assert.ok(s >= 0, `${name} harus ada`);
  const e = html.indexOf("\n}\n", s + 1);
  assert.ok(e > s, `${name} akhir`);
  return html.slice(s, e);
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const rule = (sel, src = css) => {
  const m = src.match(new RegExp(`(^|\\n)\\s*${esc(sel)} \\{([^}]*)\\}`));
  assert.ok(m, "aturan CSS " + sel);
  return m[2];
};
const block = (head) => { const i = css.indexOf(head); assert.ok(i >= 0, head); return css.slice(i, css.indexOf("}", i)); };
const rootTok = block(":root {");
const darkTok = block('[data-theme="dark"] {');
const tok = (blk, name) => { const m = blk.match(new RegExp(`\\n\\s*${esc(name)}: ([^;]+);`)); assert.ok(m, name); return m[1]; };
const mobile = (() => {
  const i = css.indexOf("/* Kartu Pomodoro ringkas di HP */");
  const s = css.indexOf("@media (max-width: 768px) {", i);
  return css.slice(s, css.indexOf("\n}\n", s));
})();

test("PomodoroTimer: satu useHeroBackdrop(\"pomo\") → kartu melukis base + HeroBackdropLayer (hasil yang sama) sebagai anak pertama", () => {
  const src = fnSource("PomodoroTimer");
  assert.match(src, /const pomoBg = useHeroBackdrop\("pomo"\);/);
  assert.equal(src.split("useHeroBackdrop(").length - 1, 1, "latar kartu dihitung sekali (satu hook, satu MutationObserver, satu uid)");
  assert.match(src, /React\.createElement\("section", \{\s*ref: cardRef,\s*className: `focus-pomo scale-in[^`]*`,\s*style: pomoBg \? \{\s*background: pomoBg\.base\s*\} : undefined,\s*"aria-label": "Pomodoro"\s*\}, React\.createElement\(HeroBackdropLayer, \{\s*bd: pomoBg,\s*cardBase: true\s*\}\), React\.createElement\("div", \{\s*className: "focus-pomo-ring"/);
  assert.equal(src.split("React.createElement(HeroBackdropLayer,").length - 1, 1, "satu latar di kartu");
  assert.equal(src.split("React.createElement(HeroBackdrop,").length - 1, 0, "kartu tidak memakai HeroBackdrop (hook kedua)");
  // Bar ringkas tanpa latar ilustrasi.
  assert.ok(!fnSource("PomodoroMiniBar").includes("HeroBackdrop"), "bar ringkas tanpa HeroBackdrop");
  assert.ok(!fnSource("PomodoroMiniBar").includes("useHeroBackdrop"));
});

test("CSS kartu: tanpa gradien navy; cadangan = base Kontur; garis + bayangan per mode lewat token; isi di atas latar", () => {
  const card = rule(".focus-pomo");
  assert.doesNotMatch(card, /#1e293b|#0f172a|color: #fff/i, "gradien navy / teks putih lama");
  const kontur = herobg.render({ kind: "kontur", palette: "default", mode: "light", place: "pomo", uid: "t" });
  assert.ok(card.includes("background: " + kontur.base + ";"), "cadangan CSS = base Kontur (registri belum termuat)");
  for (const re of [/color: var\(--text-primary\);/, /border: 1px solid var\(--pomo-card-border\);/, /box-shadow: var\(--pomo-card-shadow\);/,
    /border-radius: 20px; padding: 24px 28px;/, /grid-template-columns: auto minmax\(0, 1fr\); gap: 28px;/, /overflow: hidden;/]) assert.match(card, re);
  // Garis terang = aksen 0.22 + bayangan lembut; gelap = --border tanpa bayangan (mockup bagian E).
  assert.equal(tok(rootTok, "--pomo-card-border"), "rgba(var(--accent-rgb), 0.22)");
  assert.equal(tok(darkTok, "--pomo-card-border"), "var(--border)");
  assert.match(tok(rootTok, "--pomo-card-shadow"), /rgba\(15,23,42,0\.05\)/);
  assert.equal(tok(darkTok, "--pomo-card-shadow"), "none");
  // Lapisan: .hb (z 0, radius dalam garis) < cahaya fase (z 1) < isi (z 1, sesudahnya di DOM).
  assert.match(rule(".focus-pomo > .hb"), /border-radius: 19px;/);
  assert.match(rule(".focus-pomo > :not(.hb)"), /position: relative; z-index: 1;/);
  assert.ok(!/\n\.focus-pomo > \* \{/.test(css), "aturan lama .focus-pomo > * menimpa position absolute .hb");
});

test("CSS: cahaya fase (0.10 terang / 0.20 gelap) dan piringan ring (--bg-card 0.8→0.6 terang, 0.62→0.45 gelap)", () => {
  const glow = rule(".focus-pomo::before");
  assert.match(glow, /z-index: 1;/);
  assert.match(glow, /radial-gradient\([^;]*color-mix\(in srgb, var\(--pomo-ink\) var\(--pomo-glow-a\), transparent\)/);
  assert.equal(tok(rootTok, "--pomo-glow-a"), "10%");
  assert.equal(tok(darkTok, "--pomo-glow-a"), "20%");
  const ring = rule(".focus-pomo-ring");
  assert.match(ring, /border-radius: 50%;/);
  assert.match(ring, /radial-gradient\(circle closest-side, color-mix\(in srgb, var\(--bg-card\) var\(--pomo-disk-a\), transparent\) 0%, color-mix\(in srgb, var\(--bg-card\) var\(--pomo-disk-b\), transparent\) 86%, transparent 100%\)/);
  assert.deepEqual([tok(rootTok, "--pomo-disk-a"), tok(rootTok, "--pomo-disk-b")], ["80%", "60%"]);
  assert.deepEqual([tok(darkTok, "--pomo-disk-a"), tok(darkTok, "--pomo-disk-b")], ["62%", "45%"]);
  // HP: waktu 16 px (teks kecil) → bagian tengah piringan opak.
  assert.match(rule(".focus-pomo-ring", mobile), /radial-gradient\(circle closest-side, var\(--bg-card\) 0%, var\(--bg-card\) 72%,/);
});

test("warna bermakna: versi teks per mode (terang lebih tua), tombol utama tidak berubah", () => {
  const want = {
    "--pomo-text-red": ["#dc2626", "#f87171"], "--pomo-text-green": ["#15803d", "#4ade80"], "--pomo-text-purple": ["#6d28d9", "#c4b5fd"],
    "--pomo-text-red-strong": ["#b91c1c", "#fca5a5"], "--pomo-text-green-strong": ["#166534", "#86efac"],
  };
  for (const [name, [light, dark]] of Object.entries(want)) {
    assert.equal(tok(rootTok, name), light, ":root " + name);
    assert.equal(tok(darkTok, name), dark, "gelap " + name);
  }
  assert.match(rule(".focus-pomo, .focus-mini"), /--pomo-ink: #ef4444; --pomo-ink-text: var\(--pomo-text-red\);/);
  assert.match(rule(".focus-pomo.is-break, .focus-mini.is-break"), /--pomo-ink: #22c55e; --pomo-ink-text: var\(--pomo-text-green\);/);
  assert.match(rule(".focus-pomo.is-overtime, .focus-mini.is-overtime"), /--pomo-ink: #8b5cf6; --pomo-ink-text: var\(--pomo-text-purple\);/);
  assert.match(rule(".focus-pomo-time"), /color: var\(--pomo-ink-text\);/);
  assert.match(rule(".focus-mini-time"), /color: var\(--pomo-ink-text\);/);
  assert.match(rule(".pomo-ring-value"), /stroke: var\(--pomo-ink\);/);
  assert.match(rule(".focus-pomo-stat-value.is-red"), /color: var\(--pomo-text-red\);/);
  assert.match(rule(".focus-pomo-stat-value.is-green"), /color: var\(--pomo-text-green\);/);
  assert.match(rule(".pomo-mode.is-active"), /color: var\(--pomo-text-red-strong\);/);
  assert.match(rule(".pomo-mode.is-break.is-active"), /color: var\(--pomo-text-green-strong\);/);
  // Tombol utama (Mulai/Jeda/Ambil Istirahat/Lanjut Fokus + pil OVERTIME) tetap.
  assert.match(rule(".pomo-btn-main"), /background: var\(--pomo-ink\); color: #fff;/);
  assert.match(rule(".pomo-btn-main.is-pause"), /background: #f59e0b; color: #1f1300;/);
  assert.match(rule(".pomo-btn-break"), /background: var\(--break\); color: #052e16;/);
  assert.match(rule(".pomo-btn-overtime"), /background: #8b5cf6; color: #fff;/);
  assert.match(rule(".pomo-btn-overtime small"), /background: rgba\(255,255,255,0\.22\);/);
  // Lintasan ring = teks palet beralfa (0.09 terang / 0.14 gelap).
  assert.match(rule(".pomo-ring-track"), /stroke: var\(--pomo-track\);/);
  assert.equal(tok(rootTok, "--pomo-track"), "color-mix(in srgb, var(--text-primary) 9%, transparent)");
  assert.equal(tok(darkTok, "--pomo-track"), "color-mix(in srgb, var(--text-primary) 14%, transparent)");
});

test("teks, garis, dan kontrol sekunder memakai token (tanpa putih/navy literal di aturan kartu)", () => {
  assert.equal(tok(rootTok, "--pomo-line"), "color-mix(in srgb, var(--text-primary) 12%, transparent)");
  assert.equal(tok(darkTok, "--pomo-line"), "color-mix(in srgb, var(--text-primary) 16%, transparent)");
  assert.equal(tok(rootTok, "--pomo-ctl-bg"), "var(--bg-card)");
  assert.equal(tok(rootTok, "--pomo-box-bg"), "rgba(255,255,255,0.78)");
  // Gelap: tombol sekunder & kotak task opak (tepi latar yang terang — mesh Gradasi, piksel Galaksi — tidak menembus teks).
  assert.equal(tok(darkTok, "--pomo-ctl-bg"), "color-mix(in srgb, var(--text-primary) 8%, var(--bg-card))");
  assert.equal(tok(darkTok, "--pomo-box-bg"), "color-mix(in srgb, var(--bg-page) 86%, transparent)");
  assert.match(rule(".focus-pomo, .focus-mini"), /--pomo-sec: color-mix\(in srgb, var\(--text-secondary\) 80%, var\(--text-primary\)\);/);
  for (const sel of [".pomo-btn", ".pomo-modes", ".focus-zen-btn", ".pomo-ambient-select"]) {
    const b = rule(sel);
    assert.match(b, /background: var\(--pomo-ctl-bg\);/, sel);
    assert.match(b, /var\(--pomo-line\)/, sel);
  }
  assert.match(rule(".pomo-btn"), /color: var\(--text-primary\);/);
  assert.match(rule(".focus-pomo-task"), /background: var\(--pomo-box-bg\); box-shadow: inset 0 0 0 1px var\(--pomo-line\);/);
  assert.match(rule(".pomo-park-input"), /border-bottom: 1px solid var\(--pomo-line\);/);
  assert.match(rule(".pomo-park-input::placeholder"), /color: var\(--pomo-sec\);/);
  for (const sel of [".focus-pomo-sub", ".focus-pomo-label", ".focus-pomo-stat-label", ".focus-pomo-task-kicker", ".pomo-mode"]) {
    assert.match(rule(sel), /color: var\(--pomo-sec\);/, sel);
  }
  assert.match(rule(".focus-pomo-title"), /color: var\(--text-primary\);/);
  // Semua aturan kartu/bar ringkas (desktop + HP): tanpa putih, navy, atau slate gelap literal — kecuali tombol utama
  // berwarna dan <option> select (popup native).
  const KEEP = new Set([".pomo-btn-main", ".pomo-btn-overtime", ".pomo-btn-overtime small", ".pomo-ambient-select option"]);
  const bad = [];
  for (const m of css.matchAll(/(^|\n)([^{}\n@]*(?:focus-pomo|\.pomo-|focus-mini|focus-zen-btn)[^{}\n]*)\{([^}]*)\}/g)) {
    const sel = m[2].trim();
    if (KEEP.has(sel) || /topbar-pomo|ftask/.test(sel)) continue;
    if (/rgba\(255,\s*255,\s*255|#fff\b|#ffffff|#1e293b|#0f172a|rgba\(15,\s*23,\s*42|rgba\(10,\s*14,\s*24/i.test(m[3])) bad.push(sel);
  }
  assert.deepEqual(bad, []);
});

test("bar ringkas: permukaan --bg-card + --border + bayangan per mode, teks token, tanpa aturan gelap berliteral", () => {
  const mini = rule(".focus-mini");
  for (const re of [/background: var\(--bg-card\);/, /color: var\(--text-primary\);/, /border: 1px solid var\(--border\);/, /box-shadow: var\(--pomo-float-shadow\);/]) assert.match(mini, re);
  assert.doesNotMatch(mini, /backdrop-filter|rgba\(15,23,42/);
  assert.ok(!/\[data-theme="dark"\] \.focus-mini \{/.test(css), "aturan gelap .focus-mini lama dihapus");
  assert.ok(!/@supports \(backdrop-filter: blur\(8px\)\) \{ \.focus-mini/.test(css));
  assert.match(tok(rootTok, "--pomo-float-shadow"), /rgba\(15,23,42,0\.12\)/);
  assert.equal(tok(darkTok, "--pomo-float-shadow"), "0 10px 28px rgba(0,0,0,0.45)");
  assert.match(rule(".focus-mini-kicker"), /color: var\(--pomo-sec\);/);
  assert.match(rule(".focus-mini-title"), /color: var\(--text-primary\);/);
});

test("baris statistik: kabut --bg-card kabur di belakangnya (0.80 terang / 0.72 gelap), angka 19 px tebal (teks besar)", () => {
  assert.match(rule(".focus-pomo-stats"), /position: relative; isolation: isolate;/);
  const scrim = rule(".focus-pomo-stats::before");
  assert.match(scrim, /z-index: -1;/);
  assert.match(scrim, /background: color-mix\(in srgb, var\(--bg-card\) var\(--pomo-scrim-a\), transparent\); filter: blur\(8px\);/);
  assert.equal(tok(rootTok, "--pomo-scrim-a"), "80%");
  assert.equal(tok(darkTok, "--pomo-scrim-a"), "72%");
  assert.match(rule(".focus-pomo-stat-value"), /font-size: 19px; font-weight: 800;/);
  // HP: kabut tidak keluar kartu (overflow visible), angka 13 px memakai versi -strong.
  assert.match(rule(".focus-pomo-stats::before", mobile), /inset: -4px -6px;/);
  assert.match(rule(".focus-pomo-stat-value.is-red", mobile), /var\(--pomo-text-red-strong\)/);
  assert.match(rule(".focus-pomo-stat-value.is-green", mobile), /var\(--pomo-text-green-strong\)/);
});

test("HP (≤768px): struktur grid tetap, latar dipotong .hb sendiri, isi grid diposisikan di atas latar", () => {
  assert.match(rule(".focus-pomo", mobile), /grid-template-areas: "modes modes zen amb" "ring ctrl ctrl ctrl" "ring task task task" "stats stats stats stats" "park park park park"/);
  assert.match(rule(".focus-pomo", mobile), /overflow: visible/);
  assert.match(rule(".focus-pomo > .hb", mobile), /border-radius: 15px;/);
  // Pohon Lanskap (lapisan ambient, pojok kiri bawah) tampak menembus input parkir di HP → disembunyikan; desktop tetap.
  assert.match(rule(".focus-pomo > .hb .hb-trees", mobile), /^\s*display: none;\s*$/);
  assert.ok(!css.slice(0, css.indexOf("/* Kartu Pomodoro ringkas di HP */")).includes(".hb-trees"), "pohon hanya disembunyikan di HP");
  assert.match(rule(".focus-pomo-head-tools > *, .focus-pomo-body > *", mobile), /position: relative;/);
  assert.match(rule(".focus-pomo-head-tools .pomo-modes", mobile), /background: var\(--pomo-ctl-bg\); box-shadow: inset 0 0 0 1px var\(--pomo-line\);/);
  assert.match(rule(".pomo-amb-pop", mobile), /background: var\(--bg-card\);[^}]*color: var\(--text-primary\);/);
  assert.match(rule(".pomo-amb-opt.is-on", mobile), /background: var\(--accent-soft\); color: var\(--accent-text-deep, #4d5c00\);/);
  assert.match(rule('[data-theme="dark"] .pomo-amb-opt.is-on', mobile), /color: var\(--accent-text-bright, #D9EE6A\);/);
  assert.match(rule(".focus-pomo .pomo-park", mobile), /background: var\(--pomo-box-bg\);/);
  // Fitur latar Pomodoro tersembunyi ≤ 1100 px (termasuk HP) dan saat dekorasi mati; ambient + base tetap.
  assert.match(css, /@media \(max-width: 1100px\)\s*\{[^@]*\.hb-pomo \.hb-feature\s*\{\s*display: none;/);
  assert.match(css, /\[data-decor="off"\] \.hb-hero \.hb-feature, \[data-decor="off"\] \.hb-pomo \.hb-feature\s*\{\s*display: none;/);
});

test("desktop sempit: fitur latar disembunyikan per latar/status menurut lebar isi kartu (container pomo)", () => {
  const m = css.match(/@media \(min-width: 1101px\) \{\n  \.focus-pomo \{ container: pomo \/ inline-size; \}\n([\s\S]*?)\n\}/);
  assert.ok(m, "container pomo hanya di desktop");
  const want = [["819px", ".focus-pomo.is-awaiting > .hb-k-kontur"], ["879px", ".focus-pomo > .hb-k-galaksi"],
    ["929px", ".focus-pomo.is-overtime > .hb-k-galaksi"], ["1049px", ".focus-pomo.is-awaiting > .hb-k-galaksi"],
    ["819px", ".focus-pomo > .hb-k-objek"], ["869px", ".focus-pomo.is-overtime > .hb-k-objek"], ["989px", ".focus-pomo.is-awaiting > .hb-k-objek"]];
  for (const [w, sel] of want) {
    assert.ok(m[1].includes(`@container pomo (max-width: ${w}) { ${sel} .hb-feature { display: none; } }`), sel + " " + w);
  }
});

// Kontras token (nilai Default dari app.css, Sakura/Lavender dari themes.css): teks kecil di atas tint/permukaan kartu.
const parseDecls = (body) => Object.fromEntries(body.split(";").map((s) => s.trim()).filter(Boolean).map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()]));
const palettes = { default: { light: {}, dark: {} } };
for (const m of tcss.matchAll(/\[data-palette="([a-z]+)"\](\[data-theme="dark"\])?\s*\{([^{}]*)\}/g)) {
  palettes[m[1]] = palettes[m[1]] || { light: {}, dark: {} };
  palettes[m[1]][m[2] ? "dark" : "light"] = parseDecls(m[3]);
}
const appRoot = parseDecls(rootTok.slice(rootTok.indexOf("{") + 1).replace(/\/\*[\s\S]*?\*\//g, ""));
const appDark = parseDecls(darkTok.slice(darkTok.indexOf("{") + 1).replace(/\/\*[\s\S]*?\*\//g, ""));
const hex = (h) => { h = h.replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const mix = (a, b, t) => a.map((v, i) => v * t + b[i] * (1 - t)); // t = porsi a
const lum = (c) => { const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("kontras token: pil mode aktif, teks sekunder kartu, realisasi task (≥ 4,5:1) di tiap palet dan mode", () => {
  for (const id of Object.keys(palettes)) {
    for (const mode of ["light", "dark"]) {
      const v = mode === "dark" ? { ...appRoot, ...appDark, ...palettes[id].light, ...palettes[id].dark } : { ...appRoot, ...palettes[id].light };
      const card = hex(v["--bg-card"]), text = hex(v["--text-primary"]), sec = hex(v["--text-secondary"]);
      const ctl = mode === "dark" ? mix(text, card, 0.08) : card; // --pomo-ctl-bg
      const soft = mode === "dark" ? 0.18 : 0.12; // --pomo-soft-a
      const pomoSec = mix(sec, text, 0.8);
      const tag = `${id} ${mode}`;
      assert.ok(ratio(hex(v["--pomo-text-red-strong"]), mix(hex("#ef4444"), ctl, soft)) >= 4.5, tag + " Work aktif");
      assert.ok(ratio(hex(v["--pomo-text-green-strong"]), mix(hex("#22c55e"), ctl, soft)) >= 4.5, tag + " Short/Long aktif");
      assert.ok(ratio(pomoSec, ctl) >= 4.5, tag + " label mode tidak aktif");
      assert.ok(ratio(pomoSec, card) >= 5, tag + " --pomo-sec di atas --bg-card (cadangan untuk tint latar)");
      // Kotak task terang: putih 0.78 di atas latar terburuk (pastel ~ L 0.5) — realisasi -strong tetap ≥ 4,5:1.
      if (mode === "light") assert.ok(ratio(hex(v["--pomo-text-red-strong"]), mix([255, 255, 255], hex("#e6a07a"), 0.78)) >= 4.5, tag + " realisasi");
    }
  }
});
