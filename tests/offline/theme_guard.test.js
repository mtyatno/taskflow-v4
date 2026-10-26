"use strict";
// Penjaga fondasi tema (spec docs/superpowers/specs/2026-10-26-tema-palet-dekorasi-design.md):
// token semantik ada di :root, warna bermakna tidak ikut tema, themes.css hanya berisi token palet,
// dan kedua berkas tema dimuat index.html. Tes di Task 4–5 ditambahkan di bawah konstanta bersama ini.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", "..", rel), "utf8");
const css = read("static/app.css"), tcss = read("static/themes.css"), html = read("static/index.html").replace(/\r\n/g, "\n");
const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
// Blok token gelap = blok `[data-theme="dark"] {` pertama (tepat setelah :root).
const darkTok = css.slice(css.indexOf('[data-theme="dark"] {'), css.indexOf("}", css.indexOf('[data-theme="dark"] {')));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const declares = (block, decl) => new RegExp(`\\n\\s*${esc(decl)};`).test(block);

test("token baru ada di :root", () => {
  for (const t of ["--accent-rgb", "--accent-ink", "--accent-text", "--accent-text-strong", "--accent-2", "--accent-2-hover", "--accent-soft", "--accent-duo", "--accent-ring", "--bg-sidebar", "--border-strong", "--radius-sm", "--radius-md", "--radius-pill", "--font-heading"]) {
    assert.match(root, new RegExp(`\\n\\s*${t}:`), t);
  }
});

test("warna bermakna di :root tidak berubah", () => {
  for (const d of ["--p1: #ef4444", "--p2: #f97316", "--p3: #eab308", "--p4: #22c55e", "--q1: #ef4444", "--q3: #f97316", "--q4: #94a3b8", "--success: #22c55e", "--pomodoro: #ef4444", "--pomodoro-light: #fef2f2", "--break: #22c55e", "--break-light: #f0fdf4"]) {
    assert.ok(root.includes(d), d);
  }
  assert.ok(root.includes("--q2: var(--accent)"));
  // Aksen dan Q2 sama di kedua mode: blok gelap tidak boleh menimpanya (termasuk turunan aksen yang mode-bebas).
  for (const t of ["--accent", "--q2", "--accent-rgb", "--accent-hover", "--accent-2", "--accent-2-hover"]) {
    assert.doesNotMatch(darkTok, new RegExp(`(^|[\\s;{])${t}\\s*:`), "blok gelap menimpa " + t);
  }
});

test("nilai token :root dan blok gelap dipin (= literal Default yang digantikannya)", () => {
  for (const d of ["--accent: #A8C500", "--accent-hover: #95AD00", "--accent-rgb: 168, 197, 0", "--accent-ink: #ffffff", "--accent-text: #7E9400", "--accent-text-strong: #6B8000", "--accent-2: #B6D400", "--accent-2-hover: #A3C100", "--accent-soft: #F4FAD6", "--accent-duo: rgba(168,197,0,0.22)", "--accent-ring: rgba(168,197,0,0.35)", "--bg-sidebar: var(--bg-primary)", "--border-strong: #DDDDD5", "--radius-sm: 6px", "--radius-md: 10px", "--radius-pill: 999px", "--font-heading: inherit"]) {
    assert.ok(declares(root, d), ":root " + d);
  }
  for (const d of ["--accent-text: #A8C500", "--accent-text-strong: #A8C500", "--accent-soft: rgba(168,197,0,0.18)", "--border-strong: #404040"]) {
    assert.ok(declares(darkTok, d), "gelap " + d);
  }
});

test("themes.css dimuat setelah app.css (token palet menimpa token Default)", () => {
  const a = html.indexOf("/static/app.css"), t = html.indexOf("/static/themes.css");
  assert.ok(a > -1 && t > -1);
  assert.ok(a < t);
});

test("themes.css hanya blok [data-palette] berisi deklarasi --*; tiap palet non-Default punya blok", () => {
  const body = tcss.replace(/\/\*[\s\S]*?\*\//g, "");
  const seen = new Set();
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().match(/^\[data-palette="([a-z]+)"\](\[data-theme="dark"\])?$/);
    assert.ok(sel, "selektor asing: " + m[1].trim());
    seen.add(sel[1]);
    for (const d of m[2].split(";").map(s => s.trim()).filter(Boolean)) assert.match(d, /^--[a-z0-9-]+\s*:/, d);
  }
  // Sisa teks di luar blok (mis. aturan tanpa kurung tutup) juga ditolak.
  assert.equal(body.replace(/([^{}]+)\{([^{}]*)\}/g, "").trim(), "", "teks di luar blok");
  const ids = require("../../static/offline/themes.js").PALETTES.map(p => p.id).filter(id => id !== "default");
  assert.ok(ids.length > 0);
  for (const id of ids) assert.ok(seen.has(id), "themes.css tanpa blok palet " + id);
});

test("themes.css dan themes.js dimuat index.html", () => {
  assert.match(html, /<link rel="stylesheet" href="\/static\/themes\.css\?v=1">/);
  assert.ok(html.includes('<script src="/static/offline/themes.js">'), "tag themes.js tidak ada");
  assert.ok(html.indexOf('<script src="/static/offline/themes.js">') < html.indexOf('<script src="/static/ui-components.js">'));
});

// Task 4: literal keluarga aksen lime → token (--accent*, --accent-rgb). Hanya blok token yang boleh berliteral.
const LIME = /#(A8C500|95AD00|7E9400|6B8000|5D6E00|6B7F00|B6D400|A3C100|F4FAD6)\b|rgba\(\s*168\s*,\s*197\s*,\s*0\s*,/i;
const stripRoot = (s) => s.replace(/:root \{[\s\S]*?\}\s*\[data-theme="dark"\] \{[\s\S]*?\}/, "");
// Dua deklarasi terang dibiarkan berliteral: token mana pun mengubah tampilan Default (spec §2.3: Default identik
// piksel; §3.2: perbaikan kontras Default = PR terpisah). Lihat bagian DILEWATI di temporary_files/tema_migrasi_aksen.txt.
//   .badge-q2 color #6B8000   — aturan gelap .badge-q2 hanya menimpa background, jadi warna ini juga tampil di mode
//                               gelap; --accent-text-strong gelap = #A8C500.
//   .cmt-mention color #5d6e00 — tidak ada token bernilai #5D6E00 (--accent-text-strong = #6B8000, selisih kanal 18).
// Pengecualian harus tetap cocok persis (gagal bila basi), lalu dihapus dari teks sebelum guard dijalankan.
// PR B (S1): keduanya kini fallback token opsional var(--accent-text-deep, …) — Default tetap memakai literal itu.
const LIME_KEEP = [/(\n\s*\.badge-q2 \{[^}]*color: )var\(--accent-text-deep, #6B8000\);/, /(\n\.cmt-mention \{ color: )var\(--accent-text-deep, #5d6e00\);/];
test("guard: tidak ada literal lime di app.css di luar blok token", () => {
  let s = stripRoot(css);
  for (const re of LIME_KEEP) { assert.match(s, re, "pengecualian basi: " + re); s = s.replace(re, "$1;"); }
  assert.equal(s.match(new RegExp(LIME.source, "gi")), null);
});
test("guard: tidak ada literal lime di index.html kecuali fallback var(--accent, #A8C500)", () => { const h = html.replace(/var\(--accent, #A8C500\)/g, ""); assert.equal(h.match(new RegExp(LIME.source, "gi")), null); });
test("guard: Chart.js tidak menerima var()", () => { const chart = html.slice(html.indexOf("function ProductivityChart("), html.indexOf("function DashCardHead(")); assert.doesNotMatch(chart, /addColorStop\([^)]*var\(|borderColor:\s*"var\(|backgroundColor:\s*\[[^\]]*var\(/); });

// Task 5: aturan gelap berliteral hanya kelas 2 (warna bermakna) atau 4 (netral tanpa token) — daftar + alasan di
// tests/offline/theme_dark_allowlist.json. Literal permukaan lain sudah memakai token (atau aturan gelapnya dihapus).
// Plan memperkirakan ≤ 80 entri, tetapi aturan "warna bermakna" saja sudah 83 → batas dipisah per alasan.
// Ratchet: angka = jumlah saat Task 5 (tanpa ruang sisa) dan harus sama persis; PR B hanya boleh menurunkannya
// (menghapus entri allowlist wajib diiringi menurunkan konstanta, agar ruang kosong tidak bisa diisi literal baru).
// PR B Task 3: fallback token opsional palet (var(--border-hover, #525252), var(--accent-text-bright, #D9EE6A), …)
// TIDAK dihitung literal — palet bisa menimpanya. Guard S1 di bawah tetap melarang literal mentah tabel S1.
// 9 entri keluar (5 hover #525252 "netral tanpa token", 4 teks aktif "lime-adjacent") → 135/52.
const ALLOW_MAX_TOTAL = 135, ALLOW_MAX_NON_BERMAKNA = 52;
const ALLOW_REASONS = ["warna bermakna", "netral tanpa token", "lime-adjacent", "blok token gelap"];
const allowList = JSON.parse(read("tests/offline/theme_dark_allowlist.json"));
const allow = new Set(allowList.map(e => e.selector));
// Buang var(--<token opsional>, …) beserta fallback-nya (kurung seimbang: fallback bisa berisi rgba(...)).
const OPTIONAL_TOKENS = ["accent-on", "accent-text-deep", "accent-text-bright", "accent-2-rgb", "chat-self-bg", "border-hover"];
const stripOptionalFallbacks = (body) => {
  const re = new RegExp(`var\\(--(${OPTIONAL_TOKENS.join("|")})\\s*,`, "g");
  let out = "", last = 0, m;
  while ((m = re.exec(body))) {
    let depth = 1, i = m.index + 4; // tepat setelah "var("
    for (; i < body.length && depth > 0; i++) { if (body[i] === "(") depth++; else if (body[i] === ")") depth--; }
    assert.equal(depth, 0, "kurung var() tidak seimbang: " + body.slice(m.index, m.index + 60));
    out += body.slice(last, m.index) + `var(--${m[1]})`;
    last = re.lastIndex = i;
  }
  return out + body.slice(last);
};
const darkRules = [...css.matchAll(/(\[data-theme="dark"\][^{]*)\{([^}]*)\}/g)].map(m => [m[1].trim(), stripOptionalFallbacks(m[2])]);
const LITERAL = /#[0-9a-f]{3,8}\b|rgba?\(\s*\d/i;
test("guard: aturan gelap berliteral hanya yang di-allowlist", () => { const bad = darkRules.filter(([s, b]) => LITERAL.test(b) && !allow.has(s)).map(([s]) => s); assert.deepEqual(bad, []); });
test("guard: allowlist tidak basi (selektor ada dan masih berliteral), alasan baku, ratchet jumlah", () => {
  const body = new Map(darkRules);
  for (const s of allow) {
    assert.ok(body.has(s), "basi: " + s);
    assert.ok(LITERAL.test(body.get(s)), "tidak berliteral lagi, hapus dari allowlist: " + s);
  }
  for (const e of allowList) assert.ok(ALLOW_REASONS.includes(e.reason), `alasan tidak baku: ${e.reason} (${e.selector})`);
  assert.equal(allow.size, allowList.length, "selektor ganda di allowlist");
  assert.equal(allow.size, ALLOW_MAX_TOTAL,
    `allowlist berisi ${allow.size} entri, ALLOW_MAX_TOTAL ${ALLOW_MAX_TOTAL}: bila entri dihapus, turunkan ALLOW_MAX_TOTAL ke ${allow.size}; entri baru tidak boleh ditambah`);
  const nonBermakna = allowList.filter(e => e.reason !== "warna bermakna").length;
  assert.equal(nonBermakna, ALLOW_MAX_NON_BERMAKNA,
    `entri bukan "warna bermakna" ${nonBermakna}, ALLOW_MAX_NON_BERMAKNA ${ALLOW_MAX_NON_BERMAKNA}: bila entri dihapus, turunkan ALLOW_MAX_NON_BERMAKNA ke ${nonBermakna}; entri baru tidak boleh ditambah`);
});

// PR B Task 3 (plan 2026-10-27 S1): literal lime-adjacent / tinta di atas aksen / hover gelap → token opsional
// berfallback. Token ini tidak ada di :root (Default = fallback = literal lama, identik); hanya blok palet
// themes.css yang mendefinisikannya. Setiap kemunculan literal tabel S1 di app.css (di luar blok token) dan
// index.html wajib berupa fallback `var(--<token>, <literal>)`, dan tiap token minimal dipakai sekali.
const S1_FALLBACK = {
  "--accent-on": [/#1a1f00(?![0-9a-f])/gi, /#1a2a00(?![0-9a-f])/gi, /#1F2116(?![0-9a-f])/gi],
  "--accent-text-deep": [/#4d5c00(?![0-9a-f])/gi, /#4E5C00(?![0-9a-f])/gi, /#5D6E00(?![0-9a-f])/gi, /#6B8000(?![0-9a-f])/gi, /#364d00(?![0-9a-f])/gi, /rgba\(\s*54\s*,\s*77\s*,\s*0\s*,\s*0?\.7\s*\)/gi],
  "--accent-text-bright": [/#d4e85c(?![0-9a-f])/gi, /#D9EE6A(?![0-9a-f])/gi],
  "--accent-2-rgb": [/182\s*,\s*212\s*,\s*0(?![\d.])/g],
  "--chat-self-bg": [/#4a7000(?![0-9a-f])/gi],
  "--border-hover": [/#525252(?![0-9a-f])/gi],
};
test("guard: literal tabel S1 hanya muncul sebagai fallback var(--…, literal)", () => {
  const bad = [], used = {};
  for (const [file, src] of [["app.css", stripRoot(css)], ["index.html", html]]) {
    for (const [tok, res] of Object.entries(S1_FALLBACK)) {
      const prefix = `var(${tok}, `;
      for (const re of res) for (const m of src.matchAll(re)) {
        if (src.slice(m.index - prefix.length, m.index) === prefix) { used[tok] = (used[tok] || 0) + 1; continue; }
        bad.push(`${file}:${src.slice(0, m.index).split("\n").length} ${m[0]} (harus var(${tok}, ${m[0]}))`);
      }
    }
  }
  assert.deepEqual(bad, []);
  for (const tok of Object.keys(S1_FALLBACK)) assert.ok(used[tok] > 0, "token opsional tidak dipakai: " + tok);
  // Bentuk rgba beralpha: rgba(var(--accent-2-rgb, 182, 212, 0), a) — bukan rgba(182,212,0,a) apa pun.
  assert.doesNotMatch(css + html, /rgba\(\s*182\s*,/);
});

// Kelas .dark tidak pernah dipasang index.html (tema gelap = [data-theme="dark"]); aturan .dark … mati dihapus.
test("guard: tidak ada aturan .dark (selektor diawali .dark )", () => {
  assert.equal(css.match(/(^|[}\n,])\s*\.dark[\s.,{:]/g), null);
});

test("guard: hover sidebar terang memakai var(--text-primary), bukan #0f172a", () => {
  for (const sel of [".sidebar-link:hover", ".sidebar-rail-btn:hover"]) {
    const m = css.match(new RegExp(`\\n\\s*${esc(sel)} \\{([^}]*)\\}`));
    assert.ok(m, sel);
    assert.match(m[1], /color: var\(--text-primary\);/, sel);
  }
});

// S5: garis/track terang di mode gelap (tabel sisa-hex, "salah") → --line-soft / --track. Tiga lokasi TaskDetailBody
// di tabel itu sudah hilang oleh redesain detail task (#100, kini .td-check-bar berbasis token).
const fnBody = (name) => { const i = html.indexOf(`function ${name}(`); assert.ok(i > -1, name); return html.slice(i, html.indexOf("\nfunction ", i + 1)); };
test("guard: #f1f5f9/#e2e8f0 di lokasi S5 diganti token", () => {
  for (const name of ["ModalAttachments", "ModalNotes"]) {
    const b = fnBody(name);
    assert.ok(b.includes('borderBottom: "1px solid var(--line-soft)"'), name);
    assert.doesNotMatch(b, /#f1f5f9|#e2e8f0/i, name);
  }
  const row = fnBody("TaskRow");
  assert.match(row, /height: 4,\n\s*background: "var\(--track\)",/);
  assert.doesNotMatch(row, /#f1f5f9|#e2e8f0/i);
  assert.match(html, /borderBottom: "1px solid var\(--line-soft\)",\n\s*background: n\.is_read \? "var\(--bg-card\)"/);
  // Sisa yang sah: blok <style> mode kertas di <head> (kertas selalu putih) dan chipColor kalender (di luar cakupan).
  const rest = html.slice(html.indexOf("</head>")).replace(/bg: "#f1f5f9",\n\s*color: "#475569",/, "");
  assert.equal(rest.match(/#f1f5f9|#e2e8f0/gi), null);
});

// PR B Task 4: radius & font judul lewat token. Nilai Default token = literal lama (tampilan identik);
// palet lain menimpa lewat themes.css. Hanya komponen yang literalnya sama dengan Default token yang dialihkan.
const ruleBodies = (sel) => [...css.matchAll(new RegExp(`(?:^|\\n)\\s*${esc(sel)} \\{([^}]*)\\}`, "g"))].map((m) => m[1]);
test("guard: komponen inti memakai token radius", () => {
  const MAP = {
    ".btn": "--radius-control", ".input": "--radius-control", ".sidebar-link": "--radius-control",
    ".card": "--radius-card", ".stat-card": "--radius-card", ".ftask": "--radius-card",
    ".task-row": "--radius-md", ".modal-content": "--radius-lg",
    ".badge": "--radius-sm", ".tl-view-btn": "--radius-sm",
  };
  for (const [sel, tok] of Object.entries(MAP)) {
    const bodies = ruleBodies(sel).filter((b) => /(^|[\s;])border-radius:/.test(b));
    assert.ok(bodies.length >= 1, sel);
    for (const b of bodies) {
      assert.match(b, new RegExp(`border-radius: var\\(${tok}\\)`), `${sel} → ${tok}`);
      assert.doesNotMatch(b, /border-radius: \d/, sel);
    }
  }
  // .task-row punya dua aturan ber-radius (dasar + override mobile).
  assert.equal(ruleBodies(".task-row").filter((b) => /border-radius:/.test(b)).length, 2);
});

test("guard: --radius-control 8px, --radius-card 14px di :root", () => {
  for (const d of ["--radius-control: 8px", "--radius-card: 14px", "--radius-lg: 16px"]) assert.ok(declares(root, d), d);
});

test("guard: aturan font-heading ada", () => {
  const m = css.match(/\n\s*h1, h2, h3, \.dash-hero-greet, \.focus-page-title \{([^}]*)\}/);
  assert.ok(m, "aturan font-heading");
  assert.match(m[1], /font-family: var\(--font-heading\);/);
});

test("guard: link Google Fonts memuat Nunito 700;800 (satu link, display=swap)", () => {
  const links = html.match(/<link href="https:\/\/fonts\.googleapis\.com\/css2[^"]*"/g) || [];
  assert.equal(links.length, 1);
  assert.ok(links[0].includes("&family=Nunito:wght@700;800"), links[0]);
  assert.ok(links[0].includes("display=swap"));
});

test("guard: palet non-Default mendefinisikan lima token radius & font-heading", () => {
  for (const t of ["--radius-control", "--radius-card", "--radius-md", "--radius-lg", "--radius-sm", "--font-heading"]) {
    assert.ok(new RegExp(`\\[data-palette="(sakura|lavender)"\\][^{]*\\{[^}]*${t}:`).test(tcss), t);
  }
});
