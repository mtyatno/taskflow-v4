"use strict";
// Blok palet di static/themes.css (spec docs/superpowers/specs/2026-10-26-tema-palet-dekorasi-design.md §3.3, §5):
// kelengkapan token tiap palet non-Default, --accent-rgb konsisten, kontras WCAG ≥ 4,5:1, dan swatch registri
// (static/offline/themes.js) = nilai token yang benar-benar dipasang.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const th = require("../../static/offline/themes.js");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", "..", rel), "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const tcss = stripComments(read("static/themes.css"));
const css = stripComments(read("static/app.css"));

// Parser kecil: isi blok "a: b; c: d" → { a: "b", c: "d" } (nilai boleh berisi koma/kurung, tidak berisi ";").
const parseDecls = (body) => {
  const out = {};
  for (const d of body.split(";").map((s) => s.trim()).filter(Boolean)) {
    const i = d.indexOf(":");
    out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
  }
  return out;
};
// themes.css: selektor `[data-palette="x"]` / `[data-palette="x"][data-theme="dark"]` → { x: { light, dark } }.
const palettes = {};
for (const m of tcss.matchAll(/\[data-palette="([a-z]+)"\](\[data-theme="dark"\])?\s*\{([^{}]*)\}/g)) {
  const p = (palettes[m[1]] = palettes[m[1]] || {});
  const mode = m[2] ? "dark" : "light";
  assert.ok(!p[mode], `blok ganda ${m[1]} ${mode}`);
  p[mode] = parseDecls(m[3]);
}
// app.css: :root pertama dan blok token gelap pertama (tepat setelahnya).
const blockAfter = (src, head) => { const i = src.indexOf(head); return parseDecls(src.slice(i + head.length, src.indexOf("}", i))); };
const appRoot = blockAfter(css, ":root {");
const appDark = blockAfter(css, '[data-theme="dark"] {');

// Nilai efektif (urutan kaskade): :root (+ blok gelap app.css) ← blok terang palet (← blok gelap palet).
// Selektor palet sama spesifik dengan :root/[data-theme="dark"] dan themes.css dimuat sesudah app.css,
// jadi blok terang palet juga menimpa token gelap app.css — karena itu blok gelap palet wajib lengkap.
const effective = (id, mode) => {
  const p = palettes[id] || {};
  const map = mode === "dark"
    ? { ...appRoot, ...appDark, ...(p.light || {}), ...(p.dark || {}) }
    : { ...appRoot, ...(p.light || {}) };
  const resolve = (v, depth = 0) => {
    assert.ok(depth < 10, "var() melingkar: " + v);
    return v.replace(/var\(\s*(--[a-z0-9-]+)\s*(?:,[^)]*)?\)/g, (_, n) => resolve(map[n], depth + 1));
  };
  return (name) => { assert.ok(name in map, `${id} ${mode}: ${name} tidak terdefinisi`); return resolve(map[name]); };
};

// Warna → [r,g,b,a] (hex 3/6/8 digit, rgb(), rgba()).
const parseColor = (s) => {
  s = s.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    assert.ok(h.length === 6 || h.length === 8, "hex tak dikenal: " + s);
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  assert.ok(m, "warna tak dikenal: " + s);
  return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
};
// rgba dikomposisi di atas latar (default: --bg-card blok itu); latar sendiri harus opak.
const over = ([r, g, b, a], [R, G, B]) => [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a), 1];
const lum = ([r, g, b]) => {
  const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};
const contrast = (fg, bg) => { const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05); };

const NON_DEFAULT = th.PALETTES.map((p) => p.id).filter((id) => id !== "default");
const MODES = ["light", "dark"];
const REQUIRED = ["--bg-page", "--bg-primary", "--bg-secondary", "--bg-card", "--bg-sidebar", "--border", "--border-strong",
  "--text-primary", "--text-secondary", "--text-light", "--outline-guide", "--bg-hover", "--bg-subtle", "--bg-selected",
  "--accent", "--accent-hover", "--accent-ink", "--accent-text", "--accent-text-strong", "--accent-soft", "--accent-duo",
  "--accent-ring", "--accent-rgb", "--accent-2", "--accent-2-hover", "--line-soft", "--track"];
const REQUIRED_LIGHT_ONLY = ["--radius-sm", "--radius-control", "--radius-md", "--radius-card", "--radius-lg", "--font-heading"];
const PAIRS = [["--text-primary", "--bg-page"], ["--text-primary", "--bg-card"], ["--text-secondary", "--bg-card"],
  ["--text-light", "--bg-page"], ["--accent-text", "--bg-card"], ["--accent-text", "--accent-soft"], ["--accent-ink", "--accent"]];

// Tabel kontras terukur (juga dicetak untuk laporan: `node --test … --test-reporter=spec`).
const measure = (id, mode) => {
  const v = effective(id, mode);
  const card = parseColor(v("--bg-card"));
  assert.equal(card[3], 1, `${id} ${mode}: --bg-card harus opak`);
  const solid = (n) => over(parseColor(v(n)), card);
  return PAIRS.map(([fg, bg]) => ({ fg, bg, ratio: contrast(solid(fg), solid(bg)) }));
};

test("registri punya palet non-Default (sakura, lavender)", () => {
  assert.deepEqual(NON_DEFAULT, ["sakura", "lavender"]);
});

test("kelengkapan: tiap palet registri selain default punya blok terang & gelap berisi semua token wajib", () => {
  for (const id of NON_DEFAULT) {
    assert.ok(palettes[id] && palettes[id].light, `${id}: blok terang tidak ada`);
    assert.ok(palettes[id].dark, `${id}: blok gelap tidak ada`);
    for (const t of [...REQUIRED, ...REQUIRED_LIGHT_ONLY]) assert.ok(t in palettes[id].light, `${id} terang: ${t}`);
    for (const t of REQUIRED) assert.ok(t in palettes[id].dark, `${id} gelap: ${t}`);
  }
});

test("--accent-rgb = komponen RGB --accent di blok yang sama", () => {
  for (const id of NON_DEFAULT) for (const mode of MODES) {
    const b = palettes[id][mode];
    const [r, g, bl] = parseColor(b["--accent"]);
    assert.equal(b["--accent-rgb"].replace(/\s+/g, ""), `${r},${g},${bl}`, `${id} ${mode}`);
  }
});

test("kontras ≥ 4.5 untuk tiap palet non-Default × mode", () => {
  const fails = [];
  for (const id of NON_DEFAULT) for (const mode of MODES) {
    for (const { fg, bg, ratio } of measure(id, mode)) {
      if (process.env.TF_CONTRAST_TABLE) console.log(`${id}\t${mode}\t${fg}/${bg}\t${ratio.toFixed(2)}`);
      if (ratio < 4.5) fails.push(`${id} ${mode} ${fg}/${bg} = ${ratio.toFixed(2)}`);
    }
  }
  assert.deepEqual(fails, []);
});

test("swatch registri = nilai token themes.css (accent, accent-soft, bg-page per mode)", () => {
  const norm = (s) => s.replace(/\s+/g, "").toLowerCase();
  for (const id of NON_DEFAULT) for (const mode of MODES) {
    const v = effective(id, mode), sw = th.paletteById(id).swatch[mode];
    assert.equal(norm(v("--accent")), norm(sw.accent), `${id} ${mode} accent`);
    assert.equal(norm(v("--accent-soft")), norm(sw.soft), `${id} ${mode} soft`);
    assert.equal(norm(v("--bg-page")), norm(sw.bg), `${id} ${mode} bg`);
  }
});

test("turunan: --bg-primary/--bg-secondary, --outline-guide, --accent-text-strong, --accent-2*", () => {
  for (const id of NON_DEFAULT) for (const mode of MODES) {
    const b = palettes[id][mode];
    const surface = mode === "light" ? b["--bg-page"] : b["--bg-card"];
    assert.equal(b["--bg-primary"], surface, `${id} ${mode} --bg-primary`);
    assert.equal(b["--bg-secondary"], surface, `${id} ${mode} --bg-secondary`);
    assert.equal(b["--outline-guide"], b["--text-light"], `${id} ${mode} --outline-guide`);
    assert.equal(b["--accent-text-strong"], b["--accent-text"], `${id} ${mode} --accent-text-strong`);
    assert.equal(b["--accent-2"], b["--accent"], `${id} ${mode} --accent-2`);
    assert.equal(b["--accent-2-hover"], b["--accent-hover"], `${id} ${mode} --accent-2-hover`);
  }
});

// PR B Task 3 (plan 2026-10-27 S1): token opsional — tidak ada di :root (Default memakai fallback literal lama di
// var(--t, literal)), wajib ada di blok palet. null = tidak perlu di mode itu (aturan pemakainya hanya gelap).
// Nilai = tabel brief Task 3 (dipin persis).
const OPTIONAL = {
  "--accent-on":          { sakura: ["#FFFFFF", "#2B0F24"], lavender: ["#FFFFFF", "#22113A"] },
  "--accent-text-deep":   { sakura: ["#8E1F63", "#F5B3DA"], lavender: ["#6A2B88", "#E0C6F8"] },
  "--accent-text-bright": { sakura: ["#F5B3DA", "#F5B3DA"], lavender: ["#E0C6F8", "#E0C6F8"] },
  "--accent-2-rgb":       { sakura: ["176, 40, 126", "238, 143, 203"], lavender: ["138, 58, 174", "205, 162, 242"] },
  "--chat-self-bg":       { sakura: [null, "#5A2A4A"], lavender: [null, "#3F2D5C"] },
  "--border-hover":       { sakura: [null, "#5A3E52"], lavender: [null, "#4E3F63"] },
};

test("token opsional: tiap blok palet (terang+gelap sesuai tabel) mendefinisikannya", () => {
  assert.deepEqual(Object.keys(OPTIONAL[Object.keys(OPTIONAL)[0]]), NON_DEFAULT);
  for (const [tok, per] of Object.entries(OPTIONAL)) for (const id of NON_DEFAULT) MODES.forEach((mode, i) => {
    const want = per[id][i], got = palettes[id][mode][tok];
    if (want === null) assert.equal(got, undefined, `${id} ${mode}: ${tok} tidak perlu (blok terang palet juga berlaku di mode gelap)`);
    else assert.equal(got, want, `${id} ${mode}: ${tok}`);
  });
  // --accent-2-rgb = komponen RGB --accent-2 di blok yang sama (dipakai sebagai rgba(var(--accent-2-rgb), a)).
  for (const id of NON_DEFAULT) for (const mode of MODES) {
    const [r, g, b] = parseColor(palettes[id][mode]["--accent-2"]);
    assert.equal(palettes[id][mode]["--accent-2-rgb"].replace(/\s+/g, ""), `${r},${g},${b}`, `${id} ${mode}`);
  }
});

test(":root tidak mendefinisikan token opsional", () => {
  for (const tok of Object.keys(OPTIONAL)) {
    assert.ok(!(tok in appRoot), ":root " + tok);
    assert.ok(!(tok in appDark), "blok gelap app.css " + tok);
    assert.doesNotMatch(css, new RegExp(`(^|[\\s;{])${tok}\\s*:`), "app.css mendefinisikan " + tok);
  }
});

test("--line-soft/--track ada di :root, blok gelap, dan tiap palet", () => {
  assert.equal(appRoot["--line-soft"], "#f1f5f9");
  assert.equal(appRoot["--track"], "#e2e8f0");
  assert.equal(appDark["--line-soft"], "#333333");
  assert.equal(appDark["--track"], "#404040");
  for (const id of NON_DEFAULT) {
    const l = palettes[id].light, d = palettes[id].dark;
    assert.equal(l["--line-soft"], l["--border"], `${id} terang --line-soft = --border`);
    assert.equal(l["--track"], l["--border-strong"], `${id} terang --track = --border-strong`);
    assert.equal(d["--line-soft"], d["--border"], `${id} gelap --line-soft = --border`);
    assert.equal(d["--track"], d["--border"], `${id} gelap --track = --border`);
  }
});
