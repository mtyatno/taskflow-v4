"use strict";
// Tema PR B, Task 6: kartu "Tampilan" di Pengaturan (spec §3.7) dan ThemeToggle header sebagai tombol aksesibel.
// - ThemeSettingsCard: radiogroup Mode (roving tabIndex + panah), pemilih palet aria-pressed dengan 3 swatch dari
//   registri TF.themes, radiogroup Latar dari registri TF.herobg (spec latar-hero §7; hanya bila registri ada),
//   baris "Dekorasi tema" hanya bila modul TF.decor ada (plan S2), pratinjau bertoken + strip hero mini.
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
const herobg = require("../../static/offline/herobg.js");
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

function renderCard({ prefs, systemDark = false, decorModule = false, herobgModule = true }) {
  const calls = [];
  const win = { TF: { themes } };
  if (decorModule) win.TF.decor = {};
  if (herobgModule) win.TF.herobg = herobg;
  const sandbox = {
    React: { createElement: h, Fragment: "Fragment" },
    useRef: init => ({ current: init }),
    useState: init => [typeof init === "function" ? init() : init, () => {}],
    useCallback: fn => fn,
    useMemo: fn => fn(),
    Icon: function Icon() { return null; },
    FocusGlyph: function FocusGlyph() { return null; },
    // Komponen fungsi tidak dijalankan (React tiruan): cukup jadi tipe simpul yang bisa dicari.
    HeroBackdrop: function HeroBackdrop() { return null; },
    window: win,
  };
  vm.runInNewContext(fnSource("ThemeSettingsCard") + "\nthis.Card = ThemeSettingsCard;", sandbox);
  const resolvedTheme = themes.resolve(prefs, systemDark);
  // Objek patch dibuat di realm vm → salin ke objek realm ini supaya deepStrictEqual membandingkan isi saja.
  const tree = sandbox.Card({ themePrefs: prefs, resolvedTheme, onThemePrefs: p => calls.push({ ...p }) });
  return { tree, calls, resolvedTheme };
}

const PREFS = { mode: "light", palette: "default", decor: "on", herobg: "kontur" };
// Nama aksesibel radiogroup: aria-label, atau teks elemen yang dirujuk aria-labelledby (label tampak).
const groupName = (tree, g) => {
  if (g.props["aria-label"] !== undefined) return g.props["aria-label"];
  const ref = findAll(tree, n => n.props.id === g.props["aria-labelledby"]);
  return ref.length === 1 ? text(ref[0]) : undefined;
};
const group = (tree, label) => {
  const g = findAll(tree, n => n.props.role === "radiogroup" && groupName(tree, n) === label);
  assert.equal(g.length, 1, "radiogroup " + label);
  return g[0];
};

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
  assert.deepEqual(groups.map(g => groupName(tree, g)), ["Mode", "Latar"]);
  assert.equal(findAll(renderCard({ prefs: PREFS, herobgModule: false }).tree, n => n.props.role === "radiogroup").length, 1, "tanpa registri latar: hanya Mode");
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
  const radios = findAll(group(tree, "Mode"), n => n.props.role === "radio");
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

// ── Latar (spec docs/superpowers/specs/2026-10-27-latar-hero-design.md §7) ──
test("Latar: teks UI persis; nama/lencana dari registri TF.herobg.KINDS", () => {
  const src = fnSource("ThemeSettingsCard");
  for (const t of ["Latar", "Untuk bagian atas Dashboard dan kartu Pomodoro di Fokus Hari Ini.", "Selamat pagi"]) {
    assert.ok(src.includes(`"${t}"`), `teks "${t}"`);
  }
  assert.match(src, /const heroKinds = window\.TF\.herobg \? window\.TF\.herobg\.KINDS : null;/);
  assert.match(src, /heroKinds\.map\(\(k, i\) =>/);
  assert.match(src, /k\.name/);
  assert.match(src, /k\.badge/);
  // Teks persis spec §7 berasal dari registri (bukan string tetap di kartu).
  assert.deepEqual(herobg.KINDS.map(k => k.name), ["Kontur", "Gradasi", "Lanskap", "Galaksi", "Objek 3D", "Polos"]);
  assert.deepEqual(herobg.KINDS.filter(k => k.badge).map(k => [k.id, k.badge]), [["kontur", "Bawaan"]]);
  const { tree } = renderCard({ prefs: PREFS });
  const t = text(tree);
  assert.ok(t.includes("Latar") && t.includes("Untuk bagian atas Dashboard dan kartu Pomodoro di Fokus Hari Ini."));
});

test("Latar: urutan bagian Mode → Palet → Latar → Dekorasi tema → Pratinjau; tanpa registri bagian tidak ada", () => {
  const { tree } = renderCard({ prefs: PREFS, decorModule: true });
  const order = findAll(tree, n => cls(n).some(c => ["theme-card-label", "theme-card-decor-title"].includes(c))).map(text);
  assert.deepEqual(order, ["Mode", "Palet", "Latar", "Dekorasi tema", "Pratinjau"]);
  const none = renderCard({ prefs: PREFS, herobgModule: false }).tree;
  assert.ok(!text(none).includes("Untuk bagian atas Dashboard"));
  assert.equal(findAll(none, n => n.type && n.type.name === "HeroBackdrop").length, 0, "tanpa registri: tanpa HeroBackdrop");
});

test("Latar: radiogroup 6 radio (button type=button) dengan pratinjau thumb, aria-checked + roving tabIndex, lencana & centang", () => {
  for (const sel of ["kontur", "lanskap", "polos", "zzz"]) {
    const { tree, resolvedTheme } = renderCard({ prefs: { ...PREFS, palette: "sakura", herobg: sel } });
    const g = group(tree, "Latar");
    // Nama dari label tampak "Latar" (aria-labelledby), bukan aria-label ganda.
    assert.equal(g.props["aria-labelledby"], "theme-herobg-label");
    assert.equal(g.props["aria-label"], undefined);
    assert.equal(g.props["aria-describedby"], "theme-herobg-hint");
    assert.equal(findAll(tree, n => n.props.id === "theme-herobg-hint").length, 1);
    const radios = findAll(g, n => n.props.role === "radio");
    assert.equal(radios.length, herobg.KINDS.length);
    const want = herobg.KINDS.findIndex(k => k.id === resolvedTheme.herobg);
    assert.ok(want >= 0, "resolve menormalkan " + sel);
    radios.forEach((r, i) => {
      const k = herobg.KINDS[i];
      assert.equal(r.type, "button");
      assert.equal(r.props.type, "button");
      assert.ok(cls(r).includes("theme-card-herobg"));
      assert.equal(r.props["aria-checked"], i === want ? "true" : "false", `${sel}: ${k.id}`);
      assert.equal(r.props.tabIndex, i === want ? 0 : -1);
      // Pratinjau: HeroBackdrop place thumb dengan kind kartu itu, di dalam bingkai thumb.
      const thumb = findAll(r, n => cls(n).includes("theme-card-herobg-thumb"));
      assert.equal(thumb.length, 1);
      const bd = findAll(thumb[0], n => n.type && n.type.name === "HeroBackdrop");
      assert.equal(bd.length, 1);
      assert.deepEqual({ place: bd[0].props.place, kind: bd[0].props.kind }, { place: "thumb", kind: k.id });
      const name = findAll(r, n => cls(n).includes("theme-card-herobg-name"))[0];
      assert.equal(text(name), k.badge ? `${k.name} ${k.badge}` : k.name, "nama (+ lencana, dipisah spasi untuk nama aksesibel)");
      assert.equal(findAll(r, n => cls(n).includes("theme-card-herobg-badge")).length, k.badge ? 1 : 0);
      const check = findAll(r, n => cls(n).includes("theme-card-herobg-check"));
      assert.equal(check.length, i === want ? 1 : 0, "centang hanya di kartu terpilih");
      if (check.length) {
        assert.equal(check[0].props["aria-hidden"], "true");
        // Centang polos (FocusGlyph "check"), bukan Icon "check" ui-components (lingkaran + centang).
        assert.deepEqual(check[0].props.children.map(c => [c.type.name, c.props.name, c.props.size]), [["FocusGlyph", "check", 12]]);
      }
    });
  }
});

test("Latar: klik → onThemePrefs({herobg}); panah memindah pilihan + fokus (melingkar), tombol lain diabaikan", () => {
  const { tree, calls } = renderCard({ prefs: { ...PREFS, herobg: "kontur" } });
  const radios = findAll(group(tree, "Latar"), n => n.props.role === "radio");
  radios.forEach((r, i) => { r.props.onClick(); assert.deepEqual(calls.pop(), { herobg: herobg.KINDS[i].id }); });
  const focused = [];
  radios.forEach((r, i) => { assert.equal(typeof r.props.ref, "function", "ref callback"); r.props.ref({ focus: () => focused.push(i) }); });
  const key = k => { let prevented = false; radios[0].props.onKeyDown({ key: k, preventDefault: () => { prevented = true; } }); return prevented; };
  assert.equal(key("ArrowRight"), true);
  assert.deepEqual(calls.pop(), { herobg: "gradasi" });
  assert.deepEqual(focused.pop(), 1);
  key("ArrowLeft");
  assert.deepEqual(calls.pop(), { herobg: "polos" }, "kiri dari pertama → terakhir");
  assert.deepEqual(focused.pop(), 5);
  key("ArrowDown");
  assert.deepEqual(calls.pop(), { herobg: "gradasi" });
  key("ArrowUp");
  assert.deepEqual(calls.pop(), { herobg: "polos" });
  assert.equal(key("Enter"), false);
  assert.equal(key("Tab"), false);
  assert.equal(calls.length, 0);
  // Dari pilihan terakhir, kanan → pertama.
  const last = renderCard({ prefs: { ...PREFS, herobg: "polos" } });
  const lr = findAll(group(last.tree, "Latar"), n => n.props.role === "radio");
  lr[5].props.onKeyDown({ key: "ArrowRight", preventDefault() {} });
  assert.deepEqual(last.calls.pop(), { herobg: "kontur" });
});

test("Latar: Home/End → pilihan pertama/terakhir + fokus", () => {
  const { tree, calls } = renderCard({ prefs: { ...PREFS, herobg: "galaksi" } });
  const radios = findAll(group(tree, "Latar"), n => n.props.role === "radio");
  const focused = [];
  radios.forEach((r, i) => r.props.ref({ focus: () => focused.push(i) }));
  const key = k => { let prevented = false; radios[3].props.onKeyDown({ key: k, preventDefault: () => { prevented = true; } }); return prevented; };
  assert.equal(key("End"), true);
  assert.deepEqual(calls.pop(), { herobg: "polos" });
  assert.deepEqual(focused.pop(), 5);
  assert.equal(key("Home"), true);
  assert.deepEqual(calls.pop(), { herobg: "kontur" });
  assert.deepEqual(focused.pop(), 0);
  assert.equal(calls.length, 0);
});

test("Pratinjau: strip hero mini (HeroBackdrop place hero, latar terpilih) + sapaan contoh di atas baris task", () => {
  const { tree } = renderCard({ prefs: { ...PREFS, herobg: "galaksi" } });
  const prev = findAll(tree, n => cls(n).includes("theme-preview"))[0];
  const strip = prev.props.children[0];
  assert.ok(cls(strip).includes("theme-preview-hero"), "strip = anak pertama pratinjau");
  const bd = findAll(strip, n => n.type && n.type.name === "HeroBackdrop");
  assert.equal(bd.length, 1);
  assert.deepEqual({ ...bd[0].props, children: undefined }, { place: "hero", children: undefined }, "tanpa kind: ikut pilihan aktif");
  assert.equal(text(findAll(strip, n => cls(n).includes("theme-preview-hero-greet"))[0]), "Selamat pagi");
  assert.equal(text(findAll(strip, n => cls(n).includes("theme-preview-hero-sub"))[0]), "Ada 3 prioritas hari ini.");
  assert.ok(cls(prev.props.children[1]).includes("theme-preview-row"));
  assert.ok(!cls(renderCard({ prefs: PREFS, herobgModule: false }).tree.props.children.at(-1).props.children[1].props.children[0]).includes("theme-preview-hero"), "tanpa registri: tanpa strip");
});

test("CSS Latar: grid 3 kolom (2 kolom < 560 px), terpilih = garis aksen + cincin + centang bertinta --accent-on, thumb 5:2", () => {
  const body = sel => cssRules(sel).filter(r => r.sel.split(",").map(x => x.trim()).includes(sel)).map(r => r.body).join("\n");
  assert.match(body(".theme-card-herobgs"), /display:\s*grid;[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  const i = appCss.indexOf("@media (max-width: 559px) {");
  assert.ok(i > 0, "media 559px");
  assert.match(appCss.slice(i, appCss.indexOf("\n}", i)), /\.theme-card-herobgs\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);?\s*\}/);
  assert.match(body(".theme-card-herobg"), /border:\s*2px solid var\(--border\)/);
  assert.match(body('.theme-card-herobg[aria-checked="true"]'), /border-color:\s*var\(--accent\);\s*box-shadow:\s*0 0 0 3px var\(--accent-ring\)/);
  const check = body(".theme-card-herobg-check");
  assert.match(check, /background:\s*var\(--accent\)/);
  assert.match(check, /color:\s*var\(--accent-on, #1a2a00\)/, "bukan teks putih di atas aksen");
  assert.match(check, /position:\s*absolute;\s*top:\s*6px;\s*right:\s*6px/);
  assert.match(body(".theme-card-herobg-check svg"), /stroke-width:\s*3;/);
  const thumb = body(".theme-card-herobg-thumb");
  for (const re of [/position:\s*relative/, /aspect-ratio:\s*5 \/ 2/, /overflow:\s*hidden/, /border:\s*1px solid var\(--border\)/, /border-radius:\s*var\(--radius-control\)/]) assert.match(thumb, re);
  assert.match(body(".theme-card-herobg:focus-visible"), /outline:\s*2px solid var\(--accent-text\)/);
  // Strip pratinjau: tinggi 110 px, isi di atas latar, kotak fitur hero diperkecil ke kanan strip (rasio 290:140).
  const strip = body(".theme-preview-hero");
  for (const re of [/position:\s*relative/, /height:\s*110px/, /overflow:\s*hidden/]) assert.match(strip, re);
  assert.match(body(".theme-preview-hero .hb-feature"), /right:\s*8px;\s*top:\s*6px;\s*bottom:\s*6px;\s*height:\s*auto;\s*width:\s*203px/);
  assert.match(body(".theme-preview-hero-greet"), /z-index:\s*1/);
  assert.match(body(".theme-preview-hero-sub"), /z-index:\s*1/);
  // Baris task pertama tetap berlatar --bg-subtle walau strip menjadi anak pertama.
  assert.match(body(".theme-preview-row:not(.is-done)"), /background:\s*var\(--bg-subtle\)/);
  assert.ok(!appCss.includes(".theme-preview-row:first-child"));
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
  assert.match(block, /\.theme-card-mode, \.theme-card-palette, \.theme-card-herobg, \.theme-card-switch \{ transition: none; \}/);
});

test("CSS: palet 1 kolom di bawah 420 px", () => {
  const i = appCss.indexOf("@media (max-width: 419px)");
  assert.ok(i > 0, "media query 419px");
  const block = appCss.slice(i, appCss.indexOf("\n}", i));
  assert.match(block, /\.theme-card-palettes\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});
