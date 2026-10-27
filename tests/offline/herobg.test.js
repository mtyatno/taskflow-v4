"use strict";
// Registri latar hero static/offline/herobg.js (TF.herobg) — spec docs/superpowers/specs/2026-10-27-latar-hero-design.md §3, §9.
// - render() untuk semua kind × palet × mode × place; id unik per uid; tanpa skrip/sumber eksternal; deterministik.
// - Kontur/Polos hanya token (tanpa hex); skema lengkap untuk tiap palet TF.themes; palet asing → skema default.
// - Kontras teks palet vs warna zona teks tiap latar ≥ 4,5:1.
// - Kesetiaan pada mockup yang disetujui (docs/superpowers/specs/2026-10-27-latar-hero/mockup_gen.py): tabel warna,
//   susunan acak (piksel/titik/bintang = random.Random Python), garis kontur. Penyimpangan sengaja dicatat di DEVIATIONS.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const hb = require("../../static/offline/herobg.js");
const th = require("../../static/offline/themes.js");
const MOCK_DIR = path.join(ROOT, "docs/superpowers/specs/2026-10-27-latar-hero");

const KIND_IDS = ["kontur", "gradasi", "lanskap", "galaksi", "objek", "polos"];
const PALETTE_IDS = th.PALETTES.map((p) => p.id);
const MODES = ["light", "dark"];
const PLACES = ["hero", "pomo", "thumb"];
const all = (r) => r.base + "\n" + r.ambient + "\n" + r.feature;
const idsOf = (s) => [...s.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1]);

test("KINDS: urutan, nama, lencana sesuai spec §3; sama dengan TF.themes.HEROBGS", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(hb.KINDS)), [
    { id: "kontur", name: "Kontur", badge: "Bawaan" },
    { id: "gradasi", name: "Gradasi" },
    { id: "lanskap", name: "Lanskap" },
    { id: "galaksi", name: "Galaksi" },
    { id: "objek", name: "Objek 3D" },
    { id: "polos", name: "Polos" },
  ]);
  assert.deepEqual(hb.KINDS.map((k) => k.id), [...th.HEROBGS]);
  assert.ok(Object.isFrozen(hb.KINDS) && Object.isFrozen(hb.KINDS[0]));
});

test("SCHEMES: terang + gelap untuk tiap palet TF.themes, lengkap per latar, beku", () => {
  for (const p of PALETTE_IDS) {
    for (const m of MODES) {
      const s = hb.SCHEMES[p] && hb.SCHEMES[p][m];
      assert.ok(s, `${p}/${m}`);
      for (const k of ["m0", "m1", "m2", "m3", "m4", "line", "op"]) assert.ok(k in s.gradasi, `${p}/${m} gradasi.${k}`);
      for (const k of ["sky", "sun", "glow", "far1", "far2", "hill", "ridge", "ridgeP", "mist", "ground", "tree", "trunk", "cloud", "night"]) assert.ok(k in s.lanskap, `${p}/${m} lanskap.${k}`);
      for (const k of ["base", "px1", "px2", "path", "node", "nodeStroke", "icon", "spark", "spark2", "dot", "dotOp", "tw", "gem", "gemStroke", "core"]) assert.ok(k in s.galaksi, `${p}/${m} galaksi.${k}`);
      for (const k of ["base", "tile", "tileSide", "sph", "sph2", "book", "bookSide", "ring", "face", "bell", "hand", "tick", "dot2", "legs", "glow", "shadow"]) assert.ok(k in s.objek, `${p}/${m} objek.${k}`);
      assert.equal(s.lanskap.night, m === "dark");
    }
  }
  assert.ok(Object.isFrozen(hb.SCHEMES) && Object.isFrozen(hb.SCHEMES.default.light.lanskap.sky));
});

test("render: semua kind × palet (+ asing) × mode × place menghasilkan string", () => {
  let n = 0;
  for (const kind of KIND_IDS) for (const palette of [...PALETTE_IDS, "zzz"]) for (const mode of MODES) for (const place of PLACES) {
    const r = hb.render({ kind, palette, mode, place, uid: "t" });
    assert.deepEqual(Object.keys(r).sort(), ["ambient", "base", "feature"]);
    for (const k of ["base", "ambient", "feature"]) assert.equal(typeof r[k], "string", `${kind}/${palette}/${mode}/${place}.${k}`);
    assert.ok(r.base.length > 0, "base kosong");
    n++;
  }
  assert.equal(n, 6 * (PALETTE_IDS.length + 1) * 2 * 3);
});

test("render: fitur hanya untuk latar yang punya (gradasi/polos tanpa fitur; thumb lanskap/galaksi tanpa fitur)", () => {
  const f = (kind, place) => hb.render({ kind, palette: "sakura", mode: "light", place, uid: "f" }).feature;
  for (const place of PLACES) {
    assert.equal(f("gradasi", place), "");
    assert.equal(f("polos", place), "");
    assert.notEqual(f("kontur", place), "");
    assert.notEqual(f("objek", place), "");
  }
  assert.notEqual(f("lanskap", "hero"), "");
  assert.equal(f("lanskap", "pomo"), "", "pohon Pomodoro ada di ambient (pojok kiri bawah)");
  assert.equal(f("lanskap", "thumb"), "");
  assert.notEqual(f("galaksi", "hero"), "");
  assert.notEqual(f("galaksi", "pomo"), "");
  assert.equal(f("galaksi", "thumb"), "");
  assert.equal(hb.render({ kind: "polos", palette: "default", mode: "light", place: "hero" }).ambient, "");
});

test("id: unik di dalam satu render, berawalan uid, dan tidak ada yang sama antara dua uid", () => {
  for (const kind of KIND_IDS) for (const mode of MODES) for (const place of PLACES) {
    const a = all(hb.render({ kind, palette: "lavender", mode, place, uid: "hbA" }));
    const b = all(hb.render({ kind, palette: "lavender", mode, place, uid: "hbB" }));
    const ia = idsOf(a), ib = idsOf(b);
    assert.equal(new Set(ia).size, ia.length, `id ganda ${kind}/${mode}/${place}`);
    for (const id of ia) assert.ok(id.startsWith("hbA-"), id);
    for (const id of ib) assert.ok(!ia.includes(id), `id ${id} dipakai dua render`);
  }
});

test("url(): hanya rujukan internal url(#<uid>-…) ke id yang ada di string SVG yang sama; base tanpa url(", () => {
  for (const kind of KIND_IDS) for (const palette of PALETTE_IDS) for (const mode of MODES) for (const place of PLACES) {
    const r = hb.render({ kind, palette, mode, place, uid: "u1" });
    assert.doesNotMatch(r.base, /url\(/i);
    for (const part of [r.ambient, r.feature]) {
      const defined = new Set(idsOf(part));
      for (const m of part.matchAll(/url\(([^)]*)\)/gi)) {
        assert.match(m[1], /^#u1-[A-Za-z0-9_-]+$/, `${kind}/${place}: ${m[0]}`);
        assert.ok(defined.has(m[1].slice(1)), `${kind}/${place}: ${m[0]} tidak didefinisikan di SVG yang sama`);
      }
    }
  }
});

test("aman: tanpa skrip, javascript:, href, handler on*, foreignObject, image/use, animasi", () => {
  const BAD = [/<script/i, /javascript:/i, /href/i, /\son[a-z]+\s*=/i, /<foreignObject/i, /<image/i, /<use\b/i, /<animate/i, /<set\b/i, /@import/i, /expression\(/i, /https?:/i];
  for (const kind of KIND_IDS) for (const palette of PALETTE_IDS) for (const mode of MODES) for (const place of PLACES) {
    const s = all(hb.render({ kind, palette, mode, place, uid: "s" }));
    for (const re of BAD) assert.doesNotMatch(s, re, `${kind}/${palette}/${mode}/${place}`);
  }
});

test("uid dibersihkan (tanpa kutip/kurung/skrip); uid kosong → fallback unik", () => {
  const evil = '"><script>alert(1)</script>';
  const r = hb.render({ kind: "galaksi", palette: "default", mode: "dark", place: "hero", uid: evil });
  const s = all(r);
  assert.doesNotMatch(s, /<script/i);
  for (const id of idsOf(s)) assert.match(id, /^[A-Za-z][A-Za-z0-9_-]*$/);
  // useId React (":r1:") tetap sah dan dua uid berbeda tetap menghasilkan id berbeda.
  const a = idsOf(all(hb.render({ kind: "objek", palette: "sakura", mode: "light", place: "hero", uid: ":r1:" })));
  const b = idsOf(all(hb.render({ kind: "objek", palette: "sakura", mode: "light", place: "hero", uid: ":r2:" })));
  for (const id of a) { assert.match(id, /^[A-Za-z][A-Za-z0-9_-]*$/); assert.ok(!b.includes(id)); }
  const x = idsOf(all(hb.render({ kind: "lanskap", palette: "sakura", mode: "light", place: "hero" })));
  const y = idsOf(all(hb.render({ kind: "lanskap", palette: "sakura", mode: "light", place: "hero" })));
  assert.ok(x.length > 0);
  for (const id of x) assert.ok(!y.includes(id), "fallback uid harus unik antar panggilan");
});

test("deterministik: argumen sama → keluaran sama", () => {
  for (const kind of KIND_IDS) for (const mode of MODES) for (const place of PLACES) {
    const args = { kind, palette: "sakura", mode, place, uid: "d" };
    assert.deepEqual(hb.render(args), hb.render({ ...args }));
  }
});

test("Kontur dan Polos hanya token CSS: tanpa hex (#rgb…#rrggbbaa)", () => {
  for (const kind of ["kontur", "polos"]) for (const palette of [...PALETTE_IDS, "zzz"]) for (const mode of MODES) for (const place of PLACES) {
    const s = all(hb.render({ kind, palette, mode, place, uid: "k" })).replace(/url\(#[^)]*\)/g, "");
    assert.doesNotMatch(s, /#[0-9a-fA-F]{3,8}\b/, `${kind}/${palette}/${mode}/${place}`);
    assert.match(s, /var\(--bg-card\)/);
  }
  const k = hb.render({ kind: "kontur", palette: "default", mode: "light", place: "hero", uid: "k" });
  assert.equal(k.base, "linear-gradient(105deg, var(--bg-card) 30%, var(--accent-soft) 100%), var(--bg-card)");
  assert.match(k.ambient, /stroke: var\(--accent\)/);
  assert.match(k.ambient, /opacity: 0\.28;/);
  assert.match(hb.render({ kind: "kontur", palette: "default", mode: "dark", place: "hero", uid: "k" }).ambient, /opacity: 0\.32;/);
  assert.equal(hb.render({ kind: "polos", mode: "light" }).base, "linear-gradient(105deg, var(--bg-card) 45%, var(--accent-soft) 100%), var(--bg-card)");
  assert.equal(hb.render({ kind: "polos", mode: "dark" }).base, "linear-gradient(105deg, var(--bg-card) 40%, var(--bg-page) 100%), var(--bg-card)");
});

test("Kontur: ilustrasi per palet (Sakura bunga, Lavender tangkai, lainnya daun) di posisi hero lama", () => {
  const f = (palette) => hb.render({ kind: "kontur", palette, mode: "light", place: "hero", uid: "i" }).feature;
  assert.match(f("sakura"), /rotate\(288\)/);
  assert.match(f("lavender"), /M82 110 C82 80 84 50 80 18/);
  assert.match(f("default"), /M70 108 C68 80 76 54 92 30/);
  assert.equal(f("zzz"), f("default"));
  // .dash-hero-illus lama: right 228px, top 14px, 150×110 → di kotak fitur (right 226px, top 4px, 290×140): x 138, y 10.
  assert.match(f("default"), /viewBox="0 0 290 140"/);
  assert.match(f("default"), /<svg x="138" y="10" width="150" height="110" viewBox="0 0 150 110"/);
});

test("fallback: palet asing = skema default; kind asing = kontur; mode selain dark = terang; place asing = hero", () => {
  for (const kind of KIND_IDS) for (const mode of MODES) for (const place of PLACES) {
    assert.deepEqual(hb.render({ kind, palette: "zzz", mode, place, uid: "z" }), hb.render({ kind, palette: "default", mode, place, uid: "z" }), `${kind}/${mode}/${place}`);
    assert.deepEqual(hb.render({ kind, palette: "constructor", mode, place, uid: "z" }), hb.render({ kind, palette: "default", mode, place, uid: "z" }));
  }
  const base = { palette: "sakura", mode: "light", place: "pomo", uid: "z" };
  assert.deepEqual(hb.render({ ...base, kind: "foto" }), hb.render({ ...base, kind: "kontur" }));
  assert.deepEqual(hb.render({ ...base, kind: "galaksi", mode: "DARK" }), hb.render({ ...base, kind: "galaksi", mode: "light" }));
  assert.deepEqual(hb.render({ ...base, kind: "objek", place: "x" }), hb.render({ ...base, kind: "objek", place: "hero" }));
  assert.doesNotThrow(() => hb.render());
  assert.doesNotThrow(() => hb.render(null));
});

test("tanpa ukuran px kartu: ambient memenuhi kartu (persen/viewBox), fitur memakai viewBox kotak fitur", () => {
  const BOX = { hero: "0 0 290 140", pomo: "0 0 340 62", thumb: "0 0 86 70" };
  for (const kind of KIND_IDS) for (const mode of MODES) for (const place of PLACES) {
    const r = hb.render({ kind, palette: "default", mode, place, uid: "p" });
    if (r.feature) {
      assert.ok(r.feature.startsWith('<svg aria-hidden="true" focusable="false" viewBox="' + BOX[place] + '" preserveAspectRatio="xMidYMid meet" style="position: absolute; inset: 0; width: 100%; height: 100%;'), `${kind}/${place}`);
    }
    // Setiap <svg> lapisan ambient: absolut, memenuhi kartu atau dijangkar ke tepi; tanpa lebar px selain pohon Pomodoro.
    for (const m of r.ambient.matchAll(/<svg aria-hidden="true"[^>]*style="([^"]*)"/g)) {
      assert.match(m[1], /^position: absolute; /);
      const fixed = m[1].match(/width: (\d+)px/);
      if (fixed) assert.ok(kind === "lanskap" && place === "pomo" && /left: 0; bottom: 0;/.test(m[1]), m[1]);
    }
  }
  const l = (place) => hb.render({ kind: "lanskap", palette: "default", mode: "light", place, uid: "l" });
  assert.match(l("hero").ambient, /top: 38%; width: 100%; height: 62%;/);
  assert.match(l("pomo").ambient, /top: 48%; width: 100%; height: 52%;/);
  assert.match(l("thumb").ambient, /top: 30%; width: 100%; height: 70%;/);
  assert.match(l("hero").base, /^radial-gradient\(circle 34px at 58% 40%, /);
  assert.match(l("pomo").base, /^radial-gradient\(circle 30px at 78% 36%, /);
  assert.match(l("thumb").base, /^radial-gradient\(circle 10px at 56% 42%, /);
  const n = (place) => hb.render({ kind: "lanskap", palette: "default", mode: "dark", place, uid: "l" }).base;
  assert.match(n("hero"), /^radial-gradient\(circle 16px at 66% 24%, .*radial-gradient\(circle 64px at 66% 24%, /);
  assert.match(n("pomo"), /^radial-gradient\(circle 18px at 56% 20%, /);
  assert.match(n("thumb"), /^radial-gradient\(circle 7px at 70% 26%, /);
});

test("Lanskap: bukit jauh tanpa tepi tegak di celah antarbukit (far1 ujung kanan, far2 ujung kiri turun landai ke dasar)", () => {
  // Mockup memotong far1 di x 780 (L780 225) dan far2 di x 800 (M800 160 … L800 225): tepi keras di bawah matahari.
  for (const mode of MODES) for (const place of PLACES) {
    const amb = hb.render({ kind: "lanskap", palette: "sakura", mode, place, uid: "l" }).ambient;
    assert.ok(amb.includes("C670 95 720 110 780 122 C820 130 850 165 880 225 L0 225 Z"), `far1 ${mode}/${place}`);
    assert.ok(amb.includes('d="M740 225 C760 200 765 175 800 160 C870 130 960 96 1060 86'), `far2 ${mode}/${place}`);
    assert.ok(amb.includes("L1440 225 L740 225 Z"), `far2 tutup ${mode}/${place}`);
    assert.doesNotMatch(amb, /L780 225|M800 160|L800 225/);
  }
  // Tangen sambungan sama (kurva halus): titik kendali sebelum/sesudah segaris dengan titik sambung.
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  assert.equal(cross([780, 122], [720, 110], [820, 130]), 0, "far1 (780,122)");
  assert.equal(cross([800, 160], [765, 175], [870, 130]), 0, "far2 (800,160)");
});

// ---------- kontras zona teks ----------
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const tcss = stripComments(fs.readFileSync(path.join(ROOT, "static/themes.css"), "utf8"));
const css = stripComments(fs.readFileSync(path.join(ROOT, "static/app.css"), "utf8"));
const parseDecls = (body) => {
  const out = {};
  for (const d of body.split(";").map((s) => s.trim()).filter(Boolean)) {
    const i = d.indexOf(":");
    out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
  }
  return out;
};
const palettes = {};
for (const m of tcss.matchAll(/\[data-palette="([a-z]+)"\](\[data-theme="dark"\])?\s*\{([^{}]*)\}/g)) {
  (palettes[m[1]] = palettes[m[1]] || {})[m[2] ? "dark" : "light"] = parseDecls(m[3]);
}
const blockAfter = (src, head) => { const i = src.indexOf(head); return parseDecls(src.slice(i + head.length, src.indexOf("}", i))); };
const appRoot = blockAfter(css, ":root {");
const appDark = blockAfter(css, '[data-theme="dark"] {');
const token = (id, mode, name) => {
  const p = palettes[id] || {};
  const map = mode === "dark" ? { ...appRoot, ...appDark, ...(p.light || {}), ...(p.dark || {}) } : { ...appRoot, ...(p.light || {}) };
  assert.ok(name in map, `${id}/${mode}: ${name}`);
  return map[name];
};
const rgb = (s) => {
  const m = s.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  assert.ok(m, "warna opak tak dikenal: " + s);
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const lum = ([r, g, b]) => {
  const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};
const contrast = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// Warna hex pertama sesudah var(--bg-card) 0% di gradien 90deg (galaksi/objek): perhentian berikutnya di sisi kiri.
const firstStopAfterCard = (base) => {
  const i = base.indexOf("var(--bg-card) 0%, ");
  assert.ok(i >= 0, "gradien tanpa var(--bg-card) 0%: " + base);
  return base.slice(i).match(/#[0-9a-fA-F]{6}/)[0];
};

test("kontras: --text-primary/--text-secondary palet vs warna zona teks (sisi kiri) tiap latar ≥ 4,5:1", () => {
  for (const p of PALETTE_IDS) for (const mode of MODES) {
    const s = hb.SCHEMES[p][mode];
    const card = token(p, mode, "--bg-card");
    const zones = {
      "kontur/polos --bg-card": card,
      "polos gelap --bg-page": token(p, mode, "--bg-page"),
      "gradasi m0": s.gradasi.m0,
      "lanskap sky[0]": s.lanskap.sky[0],
      "lanskap sky[1]": s.lanskap.sky[1],
      "galaksi --bg-card": card,
      "galaksi perhentian ke-2": firstStopAfterCard(s.galaksi.base),
      "objek --bg-card": card,
      "objek perhentian ke-2": firstStopAfterCard(s.objek.base),
    };
    if (mode === "light") delete zones["polos gelap --bg-page"];
    for (const t of ["--text-primary", "--text-secondary"]) {
      const fg = token(p, mode, t);
      for (const [zone, bg] of Object.entries(zones)) {
        const c = contrast(fg, bg);
        assert.ok(c >= 4.5, `${p}/${mode} ${t} ${fg} di atas ${zone} ${bg} = ${c.toFixed(2)}:1`);
      }
    }
  }
});

// ---------- kesetiaan pada mockup ----------
test("Kontur: 11 garis topografi sama dengan mockup (= hero Dashboard lama)", () => {
  const src = fs.readFileSync(path.join(MOCK_DIR, "mockup_gen.py"), "utf8");
  const m = src.match(/TOPO_KONTUR = (\[[^\]]*\])/);
  assert.ok(m);
  const want = JSON.parse(m[1].replace(/'/g, '"'));
  const got = [...hb.render({ kind: "kontur", palette: "default", mode: "light", place: "hero", uid: "k" }).ambient.matchAll(/<path d="([^"]*)"><\/path>/g)].map((x) => x[1]);
  assert.deepEqual(got, want);
});

test("Gradasi: data garis kontur = topo_gradasi_d.txt", () => {
  const want = fs.readFileSync(path.join(MOCK_DIR, "topo_gradasi_d.txt"), "utf8").trim();
  const amb = hb.render({ kind: "gradasi", palette: "default", mode: "light", place: "hero", uid: "g" }).ambient;
  const d = amb.match(/<path d="([^"]*)"/);
  assert.ok(d);
  assert.equal(d[1], want);
});

test("ukuran modul ≤ 60 KB mentah (spec §3)", () => {
  const size = fs.statSync(path.join(ROOT, "static/offline/herobg.js")).size;
  assert.ok(size <= 60 * 1024, `herobg.js ${size} byte`);
});

// Penyimpangan sengaja dari mockup: warna Default terang dicerahkan minimal (dicampur putih) agar --text-secondary
// #64748b mencapai 4,5:1 di zona teks (mockup: 4,11–4,41:1).
const DEVIATIONS = [
  ["default/light/gradasi/m0", "#F2F8DE", "#F7FBEA"],
  ["default/light/lanskap/sky/0", "#E3F2EA", "#F4FAF7"],
  ["default/light/lanskap/sky/1", "#F0F7DE", "#F7FBED"],
  ["default/light/galaksi/base", "#F3F9E4 30%", "#F6FBEB 30%"],
  ["default/light/objek/base", "#F3F9E3 28%", "#F6FBEA 28%"],
];

// Muat mockup_gen.py lewat python3 (dilewati bila python3 tidak ada) dan keluarkan tabel + lapisan acuan sebagai JSON.
function mockup() {
  const py = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("mg", sys.argv[1])
mg = importlib.util.module_from_spec(spec); spec.loader.exec_module(mg)
k = lambda t: t[0] + "/" + t[1]
out = dict(
  MESH={k(a): b for a, b in mg.MESH.items()}, LAND={k(a): b for a, b in mg.LAND.items()},
  GAL={k(a): b for a, b in mg.GAL.items()}, OBJ=mg.OBJ, OBJBASE={k(a): b for a, b in mg.OBJBASE.items()},
  galHero=mg.bg("galaksi", "sakura", "dark", 960, 246, "hero")[1],
  galPomo=mg.bg("galaksi", "lavender", "light", 960, 304, "pomo")[1],
  landNight=mg.bg("lanskap", "default", "dark", 960, 246, "hero")[1],
)
print(json.dumps(out))
`;
  try {
    return JSON.parse(execFileSync("python3", ["-I", "-c", py, path.join(MOCK_DIR, "mockup_gen.py")], { encoding: "utf8", maxBuffer: 1 << 26 }));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
const MOCK = mockup();

test("SCHEMES = tabel warna mockup (MESH/LAND/GAL/OBJ/OBJBASE) + DEVIATIONS", (t) => {
  if (!MOCK) return t.skip("python3 tidak ada");
  const card = (s) => s.replace(/\{card\}/g, "var(--bg-card)");
  const want = {};
  for (const p of Object.keys(MOCK.OBJ)) {
    want[p] = {};
    for (const m of MODES) {
      const key = p + "/" + m;
      want[p][m] = {
        gradasi: MOCK.MESH[key],
        lanskap: MOCK.LAND[key],
        galaksi: { ...MOCK.GAL[key], base: card(MOCK.GAL[key].base) },
        objek: { base: (m === "dark" ? `radial-gradient(40% 130% at 72% 40%, ${MOCK.OBJ[p].glow} 0%, transparent 70%), ` : "") + card(MOCK.OBJBASE[key]), ...MOCK.OBJ[p] },
      };
    }
  }
  for (const [where, from, to] of DEVIATIONS) {
    const keys = where.split("/");
    const last = keys.pop();
    const obj = keys.reduce((o, k) => o[k], want);
    assert.ok(String(obj[last]).includes(from), `${where} di mockup bukan ${from}`);
    obj[last] = String(obj[last]).replace(from, to);
  }
  assert.deepEqual(Object.keys(hb.SCHEMES).sort(), Object.keys(want).sort());
  assert.deepEqual(JSON.parse(JSON.stringify(hb.SCHEMES)), want);
});

test("acak = random.Random mockup: piksel + titik galaksi, bintang lanskap, titik galaksi Pomodoro", (t) => {
  if (!MOCK) return t.skip("python3 tidak ada");
  const rects = (s) => [...s.matchAll(/<rect x="\d+" y="\d+" width="7" height="7" fill="[^"]+" style="opacity: [\d.]+;"><\/rect>/g)].map((m) => m[0]);
  // Titik/bintang saja (r 0.8–1.6); lingkaran cahaya kilau (r ≥ 5) dan simpul jalur tidak dihitung.
  const dots = (s) => [...s.matchAll(/<circle cx="([\d.]+%?)" cy="([\d.]+%?)" r="(0\.8|1|1\.3|1\.6)" fill="([^"]+)" style="opacity: ([\d.]+);"><\/circle>/g)].map((m) => m.slice(1));
  const gh = hb.render({ kind: "galaksi", palette: "sakura", mode: "dark", place: "hero", uid: "r" }).ambient;
  assert.equal(rects(gh).length, 44);
  assert.deepEqual(rects(gh), rects(MOCK.galHero));
  assert.equal(dots(gh).length, 45);
  assert.deepEqual(dots(gh), dots(MOCK.galHero));
  const ln = hb.render({ kind: "lanskap", palette: "default", mode: "dark", place: "hero", uid: "r" }).ambient;
  assert.equal(dots(ln).length, 40);
  assert.deepEqual(dots(ln), dots(MOCK.landNight));
  // Pomodoro: mockup memakai px kartu 960×304, registri memakai persen.
  const gp = hb.render({ kind: "galaksi", palette: "lavender", mode: "light", place: "pomo", uid: "r" }).ambient;
  assert.equal(rects(gp).length, 22);
  assert.deepEqual(rects(gp), rects(MOCK.galPomo));
  const want = dots(MOCK.galPomo).map(([x, y, r, f, o]) => [((x / 960) * 100).toFixed(2) + "%", ((y / 304) * 100).toFixed(2) + "%", r, f, o]);
  assert.equal(want.length, 40);
  assert.deepEqual(dots(gp), want);
});
