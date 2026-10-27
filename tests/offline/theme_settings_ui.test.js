"use strict";
// Tema PR B, Task 6: kartu "Tampilan" di Pengaturan (spec §3.7) dan ThemeToggle header sebagai tombol aksesibel.
// - ThemeSettingsCard: radiogroup Mode (roving tabIndex + panah), pemilih palet aria-pressed dengan 3 swatch dari
//   registri TF.themes, baris "Dekorasi tema" hanya bila modul TF.decor ada (plan S2), pratinjau bertoken.
// - SettingsPage merender kartu sebelum percabangan lengkapi akun / "Ganti Username"; App meneruskan 3 prop.
// - ThemeToggle: <button type=button> dengan aria-label/title berbahasa Indonesia.
// - CSS .theme-card* / .theme-swatch / .theme-preview hanya memakai token.
// Tes sumber + render dengan React tiruan lewat vm (tanpa DOM).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const themes = require("../../static/offline/themes.js");
const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const appCss = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8").replace(/\r\n/g, "\n");

function fnSource(name) {
  const start = indexHtml.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = indexHtml.indexOf("\n}\n", start + 1);
  return indexHtml.slice(start, end + 2);
}

// ── React tiruan: createElement → pohon objek; komponen fungsi (Icon) tidak dijalankan. ──
function h(type, props, ...children) {
  return { type, props: { ...(props || {}), children: children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false) } };
}
function walk(node, fn) {
  if (!node || typeof node !== "object") return;
  fn(node);
  for (const c of node.props.children) walk(c, fn);
}
function findAll(tree, pred) {
  const out = [];
  walk(tree, n => { if (pred(n)) out.push(n); });
  return out;
}
function text(node) {
  if (node === null || node === undefined || node === false) return "";
  if (typeof node !== "object") return String(node);
  return node.props.children.map(text).join("");
}
const cls = n => String(n.props.className || "").split(/\s+/);

function renderCard({ prefs, systemDark = false, decorModule = false }) {
  const calls = [];
  const win = { TF: { themes } };
  if (decorModule) win.TF.decor = {};
  const sandbox = {
    React: { createElement: h, Fragment: "Fragment" },
    useRef: init => ({ current: init }),
    useState: init => [typeof init === "function" ? init() : init, () => {}],
    useCallback: fn => fn,
    useMemo: fn => fn(),
    Icon: function Icon() { return null; },
    window: win,
  };
  vm.runInNewContext(fnSource("ThemeSettingsCard") + "\nthis.Card = ThemeSettingsCard;", sandbox);
  const resolvedTheme = themes.resolve(prefs, systemDark);
  // Objek patch dibuat di realm vm → salin ke objek realm ini supaya deepStrictEqual membandingkan isi saja.
  const tree = sandbox.Card({ themePrefs: prefs, resolvedTheme, onThemePrefs: p => calls.push({ ...p }) });
  return { tree, calls, resolvedTheme };
}

const PREFS = { mode: "light", palette: "default", decor: "on" };

test("ThemeSettingsCard didefinisikan tepat sebelum SettingsPage", () => {
  const card = indexHtml.indexOf("\nfunction ThemeSettingsCard(");
  const settings = indexHtml.indexOf("\nfunction SettingsPage(");
  assert.ok(card > 0 && settings > card, "ThemeSettingsCard sebelum SettingsPage");
  const between = indexHtml.slice(card + 1, settings);
  assert.equal((between.match(/\nfunction /g) || []).length, 0, "tidak ada fungsi lain di antaranya");
});

test("semua teks UI spec §3.7 ada persis di ThemeSettingsCard", () => {
  const s = fnSource("ThemeSettingsCard");
  for (const t of ["Tampilan", "Mode", "Terang", "Gelap", "Ikuti sistem", "Palet", "Dekorasi tema",
    "Kelopak dan maskot di layar kosong", "Tersedia untuk palet Sakura dan Lavender", "Pratinjau",
    "Kerjakan tugas Biologi bab 4", "Bayar iuran kas kelas", "#sekolah"]) {
    assert.ok(s.includes(`"${t}"`), `teks "${t}"`);
  }
  // Nama palet dari registri, bukan string tetap.
  assert.match(s, /PALETTES/);
  assert.match(s, /\.name\b/);
});

test("render: judul, radiogroup Mode dengan 3 radio, roving tabIndex", () => {
  const { tree } = renderCard({ prefs: { ...PREFS, mode: "dark" } });
  assert.ok(cls(tree).includes("theme-card"), "akar .theme-card");
  assert.ok(text(tree).includes("Tampilan"));
  const groups = findAll(tree, n => n.props.role === "radiogroup");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].props["aria-label"], "Mode");
  const radios = findAll(groups[0], n => n.props.role === "radio");
  assert.equal(radios.length, 3);
  assert.deepEqual(radios.map(r => r.type), ["button", "button", "button"]);
  assert.deepEqual(radios.map(r => r.props.type), ["button", "button", "button"]);
  assert.deepEqual(radios.map(text), ["Terang", "Gelap", "Ikuti sistem"]);
  assert.deepEqual(radios.map(r => r.props["aria-checked"]), ["false", "true", "false"]);
  assert.deepEqual(radios.map(r => r.props.tabIndex), [-1, 0, -1]);
});

test("render: klik radio → onThemePrefs({mode}); panah memindah pilihan + fokus (melingkar)", () => {
  const { tree, calls } = renderCard({ prefs: { ...PREFS, mode: "light" } });
  const radios = findAll(tree, n => n.props.role === "radio");
  radios[2].props.onClick();
  assert.deepEqual(calls.pop(), { mode: "system" });
  // Pasang ref tiruan supaya fokus bisa diamati.
  const focused = [];
  radios.forEach((r, i) => { assert.equal(typeof r.props.ref, "function", "ref callback"); r.props.ref({ focus: () => focused.push(i) }); });
  const key = k => { let prevented = false; radios[0].props.onKeyDown({ key: k, preventDefault: () => { prevented = true; } }); return prevented; };
  assert.equal(key("ArrowRight"), true);
  assert.deepEqual(calls.pop(), { mode: "dark" });
  assert.deepEqual(focused.pop(), 1);
  key("ArrowLeft");
  assert.deepEqual(calls.pop(), { mode: "system" }, "kiri dari pertama → terakhir");
  assert.deepEqual(focused.pop(), 2);
  key("ArrowDown");
  assert.deepEqual(calls.pop(), { mode: "dark" });
  key("ArrowUp");
  assert.deepEqual(calls.pop(), { mode: "system" });
  assert.equal(key("Tab"), false, "tombol lain tidak ditangani");
  assert.equal(calls.length, 0);
});

test("render: 3 kartu palet aria-pressed dengan swatch dari registri (mode efektif) + nama", () => {
  for (const [mode, systemDark, theme] of [["light", true, "light"], ["system", true, "dark"]]) {
    const { tree, calls } = renderCard({ prefs: { ...PREFS, mode, palette: "sakura" }, systemDark });
    const grids = findAll(tree, n => cls(n).includes("theme-card-palettes"));
    assert.equal(grids.length, 1);
    const cards = findAll(grids[0], n => n.type === "button");
    assert.equal(cards.length, themes.PALETTES.length);
    cards.forEach((c, i) => {
      const p = themes.PALETTES[i];
      assert.equal(c.props.type, "button");
      assert.equal(c.props["aria-pressed"], p.id === "sakura" ? "true" : "false");
      assert.ok(text(c).includes(p.name), p.name);
      const sw = findAll(c, n => cls(n).includes("theme-swatch"));
      assert.equal(sw.length, 3, p.id + ": 3 swatch");
      const want = p.swatch[theme];
      assert.deepEqual(sw.map(s => s.props.style && s.props.style.background), [want.accent, want.soft, want.bg], p.id + " " + theme);
      c.props.onClick();
      assert.deepEqual(calls.pop(), { palette: p.id });
    });
  }
});

test("render: baris Dekorasi tema hanya bila window.TF.decor ada (plan S2)", () => {
  const without = renderCard({ prefs: { ...PREFS, palette: "sakura" } });
  assert.equal(findAll(without.tree, n => n.props.role === "switch").length, 0);
  assert.ok(!text(without.tree).includes("Dekorasi tema"));

  const sak = renderCard({ prefs: { ...PREFS, palette: "sakura", decor: "on" }, decorModule: true });
  let sw = findAll(sak.tree, n => n.props.role === "switch");
  assert.equal(sw.length, 1);
  assert.equal(sw[0].type, "button");
  assert.equal(sw[0].props["aria-checked"], "true");
  assert.ok(!sw[0].props.disabled);
  assert.ok(text(sak.tree).includes("Kelopak dan maskot di layar kosong"));
  // Nama aksesibel = judul saja; keterangan lewat aria-describedby.
  const byId = id => findAll(sak.tree, n => n.props.id === id);
  const lbl = byId(sw[0].props["aria-labelledby"]);
  const desc = byId(sw[0].props["aria-describedby"]);
  assert.equal(lbl.length, 1);
  assert.equal(text(lbl[0]), "Dekorasi tema");
  assert.equal(desc.length, 1);
  assert.equal(text(desc[0]), "Kelopak dan maskot di layar kosong");
  sw[0].props.onClick();
  assert.deepEqual(sak.calls.pop(), { decor: "off" });

  const off = renderCard({ prefs: { ...PREFS, palette: "lavender", decor: "off" }, decorModule: true });
  sw = findAll(off.tree, n => n.props.role === "switch");
  assert.equal(sw[0].props["aria-checked"], "false");
  sw[0].props.onClick();
  assert.deepEqual(off.calls.pop(), { decor: "on" });

  const def = renderCard({ prefs: { ...PREFS, palette: "default", decor: "on" }, decorModule: true });
  sw = findAll(def.tree, n => n.props.role === "switch");
  assert.equal(sw[0].props.disabled, true);
  assert.equal(sw[0].props["aria-checked"], "false");
  assert.ok(text(def.tree).includes("Tersedia untuk palet Sakura dan Lavender"));
  assert.ok(!text(def.tree).includes("Kelopak dan maskot"));
});

test("render: pratinjau dua baris task (kedua tercoret) + chip, tanpa warna tetap", () => {
  const { tree } = renderCard({ prefs: PREFS });
  const prev = findAll(tree, n => cls(n).includes("theme-preview"));
  assert.equal(prev.length, 1);
  const t = text(prev[0]);
  assert.ok(t.includes("Kerjakan tugas Biologi bab 4") && t.includes("Bayar iuran kas kelas") && t.includes("#sekolah"));
  const done = findAll(prev[0], n => cls(n).includes("is-done"));
  assert.equal(done.length, 1);
  assert.ok(text(done[0]).includes("Bayar iuran kas kelas"));
  findAll(prev[0], () => true).forEach(n => assert.equal(n.props.style, undefined, "pratinjau tanpa style inline"));
  assert.ok(text(tree).includes("Pratinjau"));
});

test("SettingsPage: 3 prop baru, kartu dirender sebelum percabangan lengkapi akun / Ganti Username", () => {
  const s = fnSource("SettingsPage");
  assert.match(s.slice(0, 200), /themePrefs,\s*resolvedTheme,\s*onThemePrefs/);
  const card = s.indexOf("React.createElement(ThemeSettingsCard, {");
  assert.ok(card > 0, "kartu dirender");
  assert.match(s.slice(card, card + 200), /themePrefs: themePrefs,\s*resolvedTheme: resolvedTheme,\s*onThemePrefs: onThemePrefs/);
  const branch = s.indexOf("needsSetup ? /*#__PURE__*/React.createElement(\"div\"");
  assert.ok(branch > card, "kartu sebelum percabangan needsSetup (tampil di kedua cabang)");
  assert.ok(s.indexOf("}, \"Ganti Username\")") > card && s.indexOf("}, \"Lengkapi akun\")") > card);
  assert.equal(s.split("React.createElement(ThemeSettingsCard").length - 1, 1, "satu kali saja");
});

test("App meneruskan themePrefs, resolvedTheme, onThemePrefs: setThemePrefs ke SettingsPage", () => {
  const i = indexHtml.indexOf("React.createElement(SettingsPage, {");
  assert.ok(i > 0);
  const call = indexHtml.slice(i, indexHtml.indexOf("})", i));
  assert.match(call, /themePrefs: themePrefs/);
  assert.match(call, /resolvedTheme: resolvedTheme/);
  assert.match(call, /onThemePrefs: setThemePrefs/);
});

test("ThemeToggle: button type=button dengan aria-label/title Indonesia, tanpa teks Inggris lama", () => {
  const s = fnSource("ThemeToggle");
  assert.match(s, /return \/\*#__PURE__\*\/React\.createElement\("button", \{\s*type: "button",/);
  assert.match(s, /const label = isDark \? "Ganti ke mode terang" : "Ganti ke mode gelap";/);
  assert.match(s, /"aria-label": label/);
  assert.match(s, /title: label/);
  assert.ok(!s.includes("Switch to"), "title lama dihapus");
  // Reset gaya bawaan tombol supaya tampilan identik dengan div lama.
  for (const re of [/border: 0/, /background: "transparent"/, /padding: 0/, /font: "inherit"/, /cursor: 'pointer'|cursor: "pointer"/]) {
    assert.match(s, re);
  }
  assert.ok(!/createElement\("div"/.test(s), "tanpa div di dalam button (konten frasa)");
  assert.ok(!indexHtml.includes("'Switch to Light'") && !indexHtml.includes("'Switch to Dark'"));
});

test("render ThemeToggle: label mengikuti mode efektif, onClick = onToggle", () => {
  const sandbox = { React: { createElement: h }, Icon: function Icon() { return null; } };
  vm.runInNewContext(fnSource("ThemeToggle") + "\nthis.T = ThemeToggle;", sandbox);
  const onToggle = () => {};
  const light = sandbox.T({ theme: "light", onToggle });
  assert.equal(light.type, "button");
  assert.equal(light.props.type, "button");
  assert.equal(light.props.title, "Ganti ke mode gelap");
  assert.equal(light.props["aria-label"], "Ganti ke mode gelap");
  assert.equal(light.props.onClick, onToggle);
  const dark = sandbox.T({ theme: "dark", onToggle });
  assert.equal(dark.props.title, "Ganti ke mode terang");
});

// ── CSS ──
function cssRules(needle) {
  const out = [];
  const src = appCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[1].includes(needle)) out.push({ sel: m[1].trim(), body: m[2] });
  }
  return out;
}

test("CSS .theme-card* / .theme-swatch / .theme-preview hanya memakai token", () => {
  const rules = [...cssRules(".theme-card"), ...cssRules(".theme-swatch"), ...cssRules(".theme-preview")];
  assert.ok(rules.length >= 8, "aturan ada");
  for (const r of rules) {
    // Hex hanya boleh sebagai fallback token opsional: var(--x, #…).
    const noFallback = r.body.replace(/var\(--[\w-]+,\s*#[0-9a-fA-F]{3,8}\)/g, "");
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(noFallback), `${r.sel}: tanpa hex`);
    assert.ok(!/\brgba?\(|\bhsla?\(/.test(r.body), `${r.sel}: tanpa rgba/hsl`);
    assert.ok(!/(?<![-\w])(white|black)(?![-\w])/.test(r.body), `${r.sel}: tanpa nama warna`);
  }
  const body = sel => cssRules(sel).filter(r => r.sel.split(",").map(x => x.trim()).includes(sel)).map(r => r.body).join("\n");
  assert.match(body(".theme-card-palettes"), /grid-template-columns:\s*repeat\(3,/);
  assert.match(body('.theme-card-mode[aria-checked="true"]'), /background:\s*var\(--accent\)/);
  // Keputusan kontroler (menyimpang dari §3.7 --accent-ink): tinta gelap di atas aksen Default demi kontras.
  assert.match(body('.theme-card-mode[aria-checked="true"]'), /color:\s*var\(--accent-on, #1a2a00\)/);
  assert.match(body(".theme-preview-row.is-done .theme-preview-check"), /color:\s*var\(--accent-on, #1a2a00\)/);
  assert.match(body(".theme-card-mode"), /flex:\s*1 1 auto/);
  assert.match(body(".theme-card-mode"), /white-space:\s*nowrap/);
  assert.match(body('.theme-card-palette[aria-pressed="true"]'), /border-color:\s*var\(--accent\)/);
  assert.match(body('.theme-card-palette[aria-pressed="true"]'), /var\(--accent-ring\)/);
  assert.match(body(".theme-preview"), /background:\s*var\(--bg-card\)/);
  // Bentuk ikut token radius palet.
  const all = rules.map(r => r.body).join("\n");
  assert.match(all, /var\(--radius-pill\)/);
  assert.match(all, /var\(--radius-card\)/);
  assert.match(all, /var\(--radius-control\)/);
});

test("CSS: transisi kartu dimatikan saat prefers-reduced-motion", () => {
  const i = appCss.indexOf("@media (prefers-reduced-motion: reduce) {\n  .theme-card-mode");
  assert.ok(i > 0, "media reduced-motion untuk kartu");
  const block = appCss.slice(i, appCss.indexOf("\n}", i));
  assert.match(block, /\.theme-card-mode, \.theme-card-palette, \.theme-card-switch \{ transition: none; \}/);
});

test("CSS: palet 1 kolom di bawah 420 px", () => {
  const i = appCss.indexOf("@media (max-width: 419px)");
  assert.ok(i > 0, "media query 419px");
  const block = appCss.slice(i, appCss.indexOf("\n}", i));
  assert.match(block, /\.theme-card-palettes\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});
