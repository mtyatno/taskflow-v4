"use strict";
// Tema PR C, Task 2: komponen Decor (slot dekorasi) + CSS .decor*.
// Render dengan React tiruan lewat vm; useThemeAttrs diganti stub yang membaca atribut dari objek dokumen palsu.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const themes = require("../../static/offline/themes.js");
const decor = require("../../static/offline/decor.js");
const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const appCss = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8").replace(/\r\n/g, "\n");

function fnSource(name) {
  const start = indexHtml.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = indexHtml.indexOf("\n}\n", start + 1);
  return indexHtml.slice(start, end + 2);
}

function h(type, props, ...children) {
  return { type, props: { ...(props || {}), children: children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false) } };
}

function renderDecor(attrs, props, { withModules = true } = {}) {
  let hookCalls = 0;
  const win = withModules ? { TF: { themes, decor } } : {};
  const sandbox = {
    React: { createElement: h },
    useThemeAttrs: () => { hookCalls++; return attrs; },
    window: win,
    TF: win.TF,
  };
  vm.runInNewContext(fnSource("Decor") + fnSource("decorSvgFor") + "\nthis.Decor = Decor;", sandbox);
  const out = sandbox.Decor(props);
  return { out, hookCalls };
}

const SAKURA = { theme: "light", palette: "sakura", decor: "on" };

test("Decor didefinisikan tepat setelah useThemeAttrs", () => {
  const hook = indexHtml.indexOf("\nfunction useThemeAttrs(");
  const comp = indexHtml.indexOf("\nfunction Decor(");
  assert.ok(hook > 0 && comp > hook, "Decor setelah useThemeAttrs");
  const between = indexHtml.slice(hook + 1, comp);
  assert.equal((between.match(/\nfunction /g) || []).length, 0, "tidak ada fungsi lain di antaranya");
});

test("palet Default → null (tetapi hook tetap dipanggil)", () => {
  const { out, hookCalls } = renderDecor({ theme: "light", palette: "default", decor: "on" }, { slot: "page-corner" });
  assert.equal(out, null);
  assert.equal(hookCalls, 1);
});

test("sakura + decor on + page-corner → span.decor.decor-page-corner aria-hidden berisi svg kelopak", () => {
  const { out } = renderDecor(SAKURA, { slot: "page-corner" });
  assert.equal(out.type, "span");
  assert.deepEqual(out.props.className.split(/\s+/), ["decor", "decor-page-corner"]);
  assert.equal(out.props["aria-hidden"], "true");
  assert.equal(out.props.dangerouslySetInnerHTML.__html, decor.svgFor("petals"));
  assert.ok(/^<svg/.test(out.props.dangerouslySetInnerHTML.__html));
});

test("className tambahan ditambahkan setelah kelas dasar", () => {
  const { out } = renderDecor(SAKURA, { slot: "page-corner", className: "extra" });
  assert.deepEqual(out.props.className.split(/\s+/), ["decor", "decor-page-corner", "extra"]);
});

test("decor off → null", () => {
  const { out } = renderDecor({ ...SAKURA, decor: "off" }, { slot: "page-corner" });
  assert.equal(out, null);
});

test("slot tak dipetakan → null", () => {
  const { out } = renderDecor(SAKURA, { slot: "tidak-ada" });
  assert.equal(out, null);
});

test("modul TF.decor/TF.themes tidak ada → null tanpa melempar", () => {
  const { out, hookCalls } = renderDecor(SAKURA, { slot: "page-corner" }, { withModules: false });
  assert.equal(out, null);
  assert.equal(hookCalls, 1);
});

test("size → style width/height", () => {
  const { out } = renderDecor(SAKURA, { slot: "page-corner", size: 40 });
  assert.equal(out.props.style.width, 40);
  assert.equal(out.props.style.height, 40);
  const { out: out2 } = renderDecor(SAKURA, { slot: "page-corner" });
  assert.equal(out2.props.style, undefined);
});

// ── Guard CSS ──
function ruleBody(selectorRe) {
  const m = appCss.match(selectorRe);
  assert.ok(m, `rule ${selectorRe} must exist`);
  return m[1];
}

test("CSS: .decor tidak menangkap pointer & svg mengisi wadah", () => {
  assert.match(ruleBody(/(?:^|\n)\s*\.decor\s*\{([^}]*)\}/), /pointer-events:\s*none/);
  assert.match(ruleBody(/(?:^|\n)\s*\.decor\s*\{([^}]*)\}/), /user-select:\s*none/);
  assert.match(ruleBody(/\.decor svg\s*\{([^}]*)\}/), /width:\s*100%[^}]*height:\s*100%/);
});

test("CSS: reduced-motion mematikan animasi decor-page-corner", () => {
  const m = appCss.match(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.decor-page-corner\s*\{\s*animation:\s*none;?\s*\}\s*\}/);
  assert.ok(m, "reduced-motion rule");
  assert.match(appCss, /@keyframes decor-float/);
});

test("CSS: is-zen menyembunyikan decor-page-corner (kelas Zen sama dengan halaman Fokus)", () => {
  assert.match(appCss, /\.is-zen \.decor-page-corner\s*\{\s*display:\s*none;?\s*\}/);
  assert.ok(indexHtml.includes('`focus-page fade-in${zenOn ? " is-zen" : ""}`'), "halaman Fokus memasang is-zen");
});

test("CSS: ukuran pojok halaman & varian ponsel", () => {
  const body = ruleBody(/\.decor-page-corner\s*\{([^}]*)\}/);
  for (const re of [/position:\s*absolute/, /top:\s*0/, /right:\s*12px/, /width:\s*130px/, /height:\s*90px/, /animation:\s*decor-float 6s ease-in-out infinite/]) assert.match(body, re);
  assert.match(appCss, /@media \(max-width: 479px\)\s*\{\s*\.decor-page-corner\s*\{\s*width:\s*88px;\s*height:\s*61px;\s*right:\s*4px;\s*\}\s*\}/);
});

// ── Tema PR C, Task 4: kelopak header + glyph kelopak Pomodoro ──
// Task 5 Step 0: hook tema hanya di PomoGlyph (dipakai ViewGlyph untuk pomoTomato), glyph lain tanpa hook.
function loadGlyphs(attrs, { withThemes = true } = {}) {
  const counter = { hookCalls: 0 };
  const start = indexHtml.indexOf("\nconst VIEW_GLYPHS = {");
  assert.ok(start >= 0, "VIEW_GLYPHS must exist");
  const end = indexHtml.indexOf("\n};\n", start);
  const glyphsSrc = indexHtml.slice(start, end + 4);
  const win = withThemes ? { TF: { themes, decor } } : {};
  const sandbox = {
    React: { createElement: h },
    useThemeAttrs: () => { counter.hookCalls++; return attrs; },
    window: win,
    TF: win.TF,
  };
  vm.runInNewContext(glyphsSrc + fnSource("ViewGlyph") + fnSource("PomoGlyph") +
    "\nthis.ViewGlyph = ViewGlyph; this.PomoGlyph = PomoGlyph; this.VIEW_GLYPHS = VIEW_GLYPHS;", sandbox);
  return { counter, ViewGlyph: sandbox.ViewGlyph, PomoGlyph: sandbox.PomoGlyph, glyphs: sandbox.VIEW_GLYPHS };
}

// Render dangkal sampai elemen host ("svg"): komponen fungsi dipanggil dengan props-nya.
function renderDeep(el) {
  let cur = el;
  for (let i = 0; i < 5 && cur && typeof cur.type === "function"; i++) cur = cur.type(cur.props);
  return cur;
}

function renderViewGlyph(attrs, props, opts) {
  const g = loadGlyphs(attrs, opts);
  const out = renderDeep(g.ViewGlyph(props));
  return { out, hookCalls: g.counter.hookCalls, glyphs: g.glyphs };
}

const LAVENDER = { theme: "light", palette: "lavender", decor: "on" };

test("VIEW_GLYPHS.pomoPetal: kelopak duotone gaya pomoTomato", () => {
  const { glyphs } = renderViewGlyph(SAKURA, { name: "pomoTomato" });
  assert.ok(glyphs.pomoPetal, "pomoPetal ada");
  assert.match(glyphs.pomoPetal, /fill="currentColor" fill-opacity="\.22"/);
  assert.match(glyphs.pomoPetal, /<ellipse/);
  assert.ok(!/var\(--/.test(glyphs.pomoPetal), "warna lewat currentColor, bukan token");
});

test("ViewGlyph pomoTomato → elemen PomoGlyph (ukuran diteruskan), tanpa hook di ViewGlyph", () => {
  const g = loadGlyphs(SAKURA);
  const el = g.ViewGlyph({ name: "pomoTomato", size: 14 });
  assert.equal(el.type, g.PomoGlyph);
  assert.equal(el.props.size, 14);
  assert.equal(g.counter.hookCalls, 0, "ViewGlyph sendiri tidak memanggil hook");
});

test("ViewGlyph pomoTomato → pomoPetal di sakura/lavender + decor on (hook sekali, di PomoGlyph)", () => {
  for (const attrs of [SAKURA, LAVENDER]) {
    const { out, glyphs, hookCalls } = renderViewGlyph(attrs, { name: "pomoTomato", size: 14 });
    assert.equal(out.type, "svg");
    assert.equal(out.props.dangerouslySetInnerHTML.__html, glyphs.pomoPetal, attrs.palette);
    assert.equal(out.props.width, 14);
    assert.equal(hookCalls, 1);
  }
});

test("ViewGlyph pomoTomato tetap tomat di Default atau decor off", () => {
  for (const attrs of [{ theme: "light", palette: "default", decor: "on" }, { ...SAKURA, decor: "off" }, { ...LAVENDER, decor: "off" }]) {
    const { out, glyphs, hookCalls } = renderViewGlyph(attrs, { name: "pomoTomato" });
    assert.equal(out.props.dangerouslySetInnerHTML.__html, glyphs.pomoTomato, JSON.stringify(attrs));
    assert.equal(out.props.width, 16, "ukuran bawaan 16");
    assert.equal(hookCalls, 1, "hook PomoGlyph dipanggil tanpa syarat");
  }
});

test("ViewGlyph pomoTomato tetap tomat bila TF.themes tidak ada (tanpa melempar)", () => {
  const { out, glyphs } = renderViewGlyph(SAKURA, { name: "pomoTomato" }, { withThemes: false });
  assert.equal(out.props.dangerouslySetInnerHTML.__html, glyphs.pomoTomato);
});

test("ViewGlyph nama lain: svg langsung, tanpa hook/observer tema", () => {
  for (const name of ["pomoBreak", "pomoPetal", "live", "emptyDone", "sparkles"]) {
    const g = loadGlyphs(SAKURA);
    const out = g.ViewGlyph({ name });
    assert.equal(out.type, "svg", name);
    assert.equal(out.props.dangerouslySetInnerHTML.__html, g.glyphs[name], name);
    assert.equal(g.counter.hookCalls, 0, name + ": tanpa hook");
  }
  const { out } = renderViewGlyph(SAKURA, { name: "tidakAda" });
  assert.equal(out.props.dangerouslySetInnerHTML.__html, "");
});

test("PomoGlyph didefinisikan tepat setelah ViewGlyph; hook hanya di PomoGlyph", () => {
  const vg = indexHtml.indexOf("\nfunction ViewGlyph(");
  const pg = indexHtml.indexOf("\nfunction PomoGlyph(");
  assert.ok(vg > 0 && pg > vg, "PomoGlyph setelah ViewGlyph");
  assert.equal((indexHtml.slice(vg + 1, pg).match(/\nfunction /g) || []).length, 0, "tidak ada fungsi lain di antaranya");
  assert.doesNotMatch(fnSource("ViewGlyph"), /useThemeAttrs/);
  assert.match(fnSource("PomoGlyph"), /useThemeAttrs\(\)/);
});

test("ViewGlyph & PomoGlyph hanya dipakai sebagai komponen (hook di dalamnya aman)", () => {
  assert.equal((indexHtml.match(/[^.\w]ViewGlyph\(/g) || []).length, 1, "hanya deklarasi fungsi; tidak ada panggilan biasa");
  assert.equal((indexHtml.match(/[^.\w]PomoGlyph\(/g) || []).length, 1, "hanya deklarasi fungsi; tidak ada panggilan biasa");
  assert.ok(!/\b(View|Pomo)Glyph\.(call|apply)/.test(indexHtml));
});

test("sumber: Decor page-corner di dalam h1.focus-page-title (setelah teks judul), bukan anak langsung titlebar", () => {
  const i = indexHtml.indexOf('className: "focus-page-title"');
  assert.ok(i > 0);
  const seg = indexHtml.slice(i, indexHtml.indexOf('className: "focus-page-summary"', i));
  assert.match(seg, /"Fokus Hari Ini", React\.createElement\(Decor, \{\s*slot: "page-corner"\s*\}\)\)/);
  const t = indexHtml.indexOf('className: "focus-page-titlebar"');
  assert.doesNotMatch(indexHtml.slice(t, i), /Decor/, "tidak lagi anak langsung titlebar");
});

test("sumber: Decor page-corner item flex di dash-hero-top (antara teks sapaan dan kartu progres)", () => {
  const i = indexHtml.indexOf('className: "dash-hero"');
  assert.ok(i > 0);
  const top = indexHtml.indexOf('className: "dash-hero-top"', i);
  assert.doesNotMatch(indexHtml.slice(i, top), /Decor/, "tidak lagi anak langsung dash-hero");
  const seg = indexHtml.slice(top, indexHtml.indexOf('className: "dash-hero-progress"', top));
  assert.match(seg, /`\$\{overdueCount\} terlambat`\)\)\), \/\*#__PURE__\*\/React\.createElement\(Decor, \{\s*slot: "page-corner"\s*\}\), totalToday > 0 &&/);
});

test("CSS: kelopak Fokus dijangkar ke judul (kanan teks, tengah vertikal), ruang dicadangkan untuk ringkasan", () => {
  // aturan terpisah di blok dekorasi: aturan desktop .focus-page-title asli tetap (focus_header_strip.test.js)
  const block = appCss.slice(appCss.indexOf("/* ── Dekorasi tema (slot Decor): awal ── */"), appCss.indexOf("/* ── Dekorasi tema (slot Decor): akhir ── */"));
  assert.match(block, /(?:^|\n)\.focus-page-title \{ position: relative; \}/);
  const body = ruleBody(/(?:^|\n)\.focus-page-title > \.decor-page-corner\s*\{([^}]*)\}/);
  assert.match(body, /left:\s*calc\(100% \+ 24px\)/);
  assert.match(body, /right:\s*auto/);
  assert.match(body, /top:\s*calc\(50% - 45px\)/, "tengah vertikal pada judul (tinggi 90px)");
  const reserve = ruleBody(/(?:^|\n)\.focus-page-title--decor\s*\{([^}]*)\}/);
  const m = reserve.match(/margin-right:\s*(\d+)px/);
  assert.ok(m && Number(m[1]) >= 24 + 130, "margin kanan judul ≥ 24 + lebar kelopak: ringkasan tidak bisa menimpa kelopak");
});

test("CSS: kelopak hero = item flex sebaris (tanpa posisi absolut), hanya memakai ruang sisa, tidak menambah tinggi baris", () => {
  const body = ruleBody(/(?:^|\n)\.dash-hero-top > \.decor-page-corner\s*\{([^}]*)\}/);
  for (const re of [/position:\s*relative/, /top:\s*auto/, /right:\s*auto/, /min-width:\s*0/, /max-width:\s*130px/, /align-self:\s*stretch/, /height:\s*auto/]) assert.match(body, re);
  // basis 0 + grow: sapaan tidak pernah menyusut karena kelopak (sapaan panjang = kelopak mengecil sampai 0)
  assert.match(body, /flex:\s*1 1 0;/);
  // margin kiri auto (didorong ke kartu progres), margin kanan = -gap baris (.dash-hero-top gap 20px; 12px di <= 640px)
  assert.match(body, /margin:\s*0 -20px 0 auto/);
  assert.match(ruleBody(/(?:^|\n)\.dash-hero-top\s*\{([^}]*)\}/), /gap:\s*20px/);
  assert.match(appCss, /@media \(max-width: 640px\)\s*\{\s*\.dash-hero-top > \.decor-page-corner\s*\{\s*margin-right:\s*-12px;?\s*\}\s*\}/);
  assert.match(appCss, /@media \(max-width: 640px\)\s*\{[^@]*\.dash-hero-top\s*\{\s*gap:\s*12px;?\s*\}/);
  // svg absolut di dalam kotak: isi tidak menyumbang tinggi, kelopak mengikuti tinggi baris (sapaan/kartu progres)
  assert.match(ruleBody(/(?:^|\n)\.dash-hero-top > \.decor-page-corner svg\s*\{([^}]*)\}/), /position:\s*absolute[^}]*height:\s*100%/);
  assert.match(appCss, /@media \(max-width: 479px\)\s*\{\s*\.dash-hero-top > \.decor-page-corner\s*\{\s*max-width:\s*88px;?\s*\}\s*\}/);
});

test("CSS: > 1100 px kelopak hero pindah ke kiri fitur latar (Kontur: ilustrasi right 228px lebar 150px; Galaksi/Objek: kotak penuh)", () => {
  // Fitur latar hero (spec latar-hero §4) tampil > 1100 px tepat di kiri kartu progres; kelopak tidak boleh menumpuk di atasnya.
  const box = ruleBody(/(?:^|\n)\.hb-hero \.hb-feature\s*\{([^}]*)\}/);
  assert.match(box, /right:\s*226px/);
  assert.match(box, /width:\s*290px/);
  // Ilustrasi Kontur (= .dash-hero-illus lama) di ujung kanan kotak fitur: x 138, lebar 150 → right 226 + (290 - 288) = 228px.
  const kontur = require("../../static/offline/herobg.js").render({ kind: "kontur", palette: "sakura", mode: "light", place: "hero", uid: "k" });
  assert.match(kontur.feature, /viewBox="0 0 290 140"[\s\S]*<svg x="138" y="10" width="150" height="110" viewBox="0 0 150 110"/);
  const q = appCss.indexOf("@media (max-width: 1100px) {");
  assert.ok(q > 0);
  assert.match(appCss.slice(q, appCss.indexOf("\n}", q)), /\.hb-hero \.hb-feature, \.hb-pomo \.hb-feature\s*\{\s*display:\s*none;?\s*\}/, "fitur sembunyi <= 1100 px");
  const m = decorBlock().match(/@media \(min-width: 1101px\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, "aturan kelopak hero untuk lebar > 1100 px");
  const media = m[1];
  assert.match(media, /\.dash-hero-top > \.decor-page-corner\s*\{\s*max-width:\s*284px;?\s*\}/);
  const svg = media.match(/\n  \.dash-hero-top > \.decor-page-corner svg\s*\{([^}]*)\}/)[1];
  // 164px dari kanan item (= tepi kiri kartu progres) melewati ilustrasi (6 + 150px) + celah 8px; lebar = sisa ruang
  for (const re of [/left:\s*auto/, /right:\s*164px/, /width:\s*calc\(100% - 164px\)/, /max-width:\s*120px/]) assert.match(svg, re);
  // Galaksi / Objek 3D menggambar di seluruh kotak fitur (tepi kiri ±294px dari kanan item) → kelopak 320px dari kanan item;
  // tidak berlaku untuk anak terakhir (tanpa kartu progres kelopak tetap di pojok kanan, kanan kotak fitur).
  assert.match(media, /\[data-herobg="galaksi"\] \.dash-hero-top > \.decor-page-corner:not\(:last-child\),\s*\[data-herobg="objek"\] \.dash-hero-top > \.decor-page-corner:not\(:last-child\)\s*\{\s*max-width:\s*440px;?\s*\}/);
  assert.match(media, /\[data-herobg="galaksi"\] \.dash-hero-top > \.decor-page-corner:not\(:last-child\) svg,\s*\[data-herobg="objek"\] \.dash-hero-top > \.decor-page-corner:not\(:last-child\) svg\s*\{\s*right:\s*320px;\s*width:\s*calc\(100% - 320px\);?\s*\}/);
  // tanpa kartu progres: kelopak tetap di pojok kanan (fitur di kirinya)
  assert.match(media, /\.dash-hero-top > \.decor-page-corner:last-child\s*\{\s*max-width:\s*130px;?\s*\}/);
  assert.match(media, /\.dash-hero-top > \.decor-page-corner:last-child svg\s*\{[^}]*left:\s*0[^}]*right:\s*auto/);
});


test("CSS: tanpa offset magic & aturan z-index lama", () => {
  const block = appCss.slice(appCss.indexOf("/* ── Dekorasi tema (slot Decor): awal ── */"), appCss.indexOf("/* ── Dekorasi tema (slot Decor): akhir ── */"));
  assert.ok(block.length > 0);
  for (const re of [/right:\s*232px/, /right:\s*290px/, /right:\s*84px/, /top:\s*-24px/, /> \.decor ~ \*/, /\.focus-page-titlebar \.decor-page-corner/, /\.dash-hero \.decor-page-corner/]) {
    assert.doesNotMatch(block, re);
  }
  assert.doesNotMatch(ruleBody(/(?:^|\n)\.focus-page-titlebar\s*\{([^}]*)\}/), /position:\s*relative/, "titlebar kembali seperti Default");
});

// ── Perbaikan akhir dekorasi: tanpa :has(), kelopak Fokus disembunyikan <= 1024 px, hero kosong, kelopak gelap ──
function decorBlock() {
  const a = appCss.indexOf("/* ── Dekorasi tema (slot Decor): awal ── */");
  const b = appCss.indexOf("/* ── Dekorasi tema (slot Decor): akhir ── */");
  assert.ok(a >= 0 && b > a);
  return appCss.slice(a, b);
}

function loadDecorSvgFor(win) {
  const sandbox = { window: win };
  vm.runInNewContext(fnSource("decorSvgFor") + "\nthis.decorSvgFor = decorSvgFor;", sandbox);
  return sandbox.decorSvgFor;
}

test("decorSvgFor: svg hanya untuk palet berdekorasi + decor on + modul ada; selain itu null", () => {
  const f = loadDecorSvgFor({ TF: { themes, decor } });
  assert.equal(f("sakura", "on", "page-corner"), decor.svgFor("petals"));
  assert.equal(f("lavender", "on", "page-corner"), decor.svgFor("petals"));
  assert.equal(f("default", "on", "page-corner"), null);
  assert.equal(f("sakura", "off", "page-corner"), null);
  assert.equal(f("sakura", "on", "tidak-ada"), null);
  assert.equal(loadDecorSvgFor({})("sakura", "on", "page-corner"), null);
  assert.equal(loadDecorSvgFor({ TF: { themes } })("sakura", "on", "page-corner"), null, "tanpa TF.decor");
});

test("Decor memakai decorSvgFor (satu syarat render bersama TodayFocusView)", () => {
  assert.match(fnSource("Decor"), /const svg = decorSvgFor\(palette, decor, slot\);/);
  assert.doesNotMatch(fnSource("Decor"), /decorFor\(/, "syarat tidak diduplikasi di Decor");
});

test("sumber: h1 Fokus mendapat focus-page-title--decor hanya bila kelopak pojok tampil", () => {
  const view = fnSource("TodayFocusView");
  assert.match(view, /const themeAttrs = useThemeAttrs\(\);/);
  assert.match(view, /const hasCornerDecor = !!decorSvgFor\(themeAttrs\.palette, themeAttrs\.decor, "page-corner"\);/);
  assert.ok(view.includes('className: "focus-page-title" + (hasCornerDecor ? " focus-page-title--decor" : "")'));
  // ekspresi className bernilai persis "focus-page-title" (Default) atau dengan kelas tambahan (Sakura)
  const expr = '"focus-page-title" + (hasCornerDecor ? " focus-page-title--decor" : "")';
  const f = loadDecorSvgFor({ TF: { themes, decor } });
  const cls = (palette, d) => vm.runInNewContext(expr, { hasCornerDecor: !!f(palette, d, "page-corner") });
  assert.equal(cls("default", "on"), "focus-page-title");
  assert.equal(cls("sakura", "off"), "focus-page-title");
  assert.equal(cls("sakura", "on"), "focus-page-title focus-page-title--decor");
  assert.equal(cls("lavender", "on"), "focus-page-title focus-page-title--decor");
});

test("CSS: tidak ada :has( di aturan dekorasi; ruang kelopak lewat .focus-page-title--decor", () => {
  const block = decorBlock();
  const rulesOnly = block.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!rulesOnly.includes(":has("), "aturan dekorasi tanpa :has()");
  assert.ok(!/\.decor[^{]*:has\(|:has\([^)]*decor/.test(appCss.replace(/\/\*[\s\S]*?\*\//g, "")), "tak ada :has() terkait decor di app.css");
  assert.match(ruleBody(/(?:^|\n)\.focus-page-title--decor\s*\{([^}]*)\}/), /margin-right:\s*154px/);
});

test("CSS: kelopak judul Fokus display:none di <= 1024 px (titlebar visually-hidden)", () => {
  assert.match(decorBlock(), /@media \(max-width: 1024px\)\s*\{\s*\.focus-page-title > \.decor-page-corner\s*\{\s*display:\s*none;?\s*\}\s*\}/);
});

test("CSS: kelopak hero sebagai anak terakhir (belum ada task hari ini) tanpa margin kanan negatif", () => {
  assert.match(ruleBody(/(?:^|\n)\.dash-hero-top > \.decor-page-corner:last-child\s*\{([^}]*)\}/), /margin-right:\s*0;?/);
  const block = decorBlock();
  // setelah aturan media 640px (-12px) supaya menang juga di HP (spesifisitas lebih tinggi + urutan)
  assert.ok(block.indexOf(".dash-hero-top > .decor-page-corner:last-child") > block.indexOf("@media (max-width: 640px) { .dash-hero-top > .decor-page-corner"));
});

test("CSS: mode gelap menimpa --accent-duo hanya di kelopak pojok (rgba aksen), bukan maskot/root", () => {
  const block = decorBlock();
  const m = block.match(/(?:^|\n)\[data-theme="dark"\] \.decor-page-corner\s*\{\s*--accent-duo:\s*rgba\(var\(--accent-rgb\),\s*(0?\.\d+)\);?\s*\}/);
  assert.ok(m, "override lokal --accent-duo");
  const a = Number(m[1]);
  assert.ok(a >= 0.4 && a <= 0.55, "alpha lembut tapi jelas: " + a);
  assert.equal((block.match(/--accent-duo\s*:/g) || []).length, 1, "satu-satunya penimpaan token di blok dekorasi");
  // kelopak hanya memakai --accent-duo sebagai warna (penimpaan lokal cukup)
  assert.deepEqual([...decor.svgFor("petals").matchAll(/var\(--[\w-]+\)/g)].map(x => x[0]), ["var(--accent-duo)"]);
});
