#!/usr/bin/env node
"use strict";
// Migrasi sekali pakai PR A tema (Task 4): literal keluarga aksen lime → token CSS (--accent*, --accent-rgb).
// Tanpa dependensi. Dijalankan dari akar repo:
//
//   node temporary_files/migrate_theme_tokens.js --dry [--lines=a,b,c-d]   laporan `file:baris: lama → baru` + jumlah
//   node temporary_files/migrate_theme_tokens.js [--lines=a,b,c-d]         tulis ulang
//
// static/app.css ditulis ulang seluruhnya, KECUALI blok token (`:root {…}` + `[data-theme="dark"] {…}` pertama) dan
// kemunculan yang tidak aman mode (lihat di bawah). static/index.html hanya baris yang disebut di --lines: tiap baris
// harus ditinjau manusia dulu (konteks CSS: <style>, objek style, el.style.x = …); konteks canvas/Chart.js/atribut SVG
// dikerjakan manual. `var(--accent, #A8C500)` di index.html (fallback saat app.css gagal dimuat) dibiarkan; di app.css
// fallback itu mubazir (--accent didefinisikan di berkas yang sama) → `var(--accent)`.
//
// Aman mode = nilai token di tiap mode tempat deklarasi itu berlaku sama dengan literal lama:
//   - terang: nilai token :root = literal (atau selisih kanal ≤ TOL, keputusan plan R2 untuk #6B7F00);
//   - gelap, selektor ber-[data-theme="dark"]: nilai token gelap = literal;
//   - gelap, selektor tanpa [data-theme="dark"] (aturan terang yang juga berlaku di mode gelap): nilai token gelap =
//     literal, ATAU setiap bagian selektor S punya aturan `[data-theme="dark"] S` (global/konteks @media sama) yang
//     mendeklarasikan properti yang sama (atau longhand/shorthand -color-nya) — deklarasi terang itu tidak tampil di gelap.
// Yang tidak aman dilewati dan dicetak di bagian DILEWATI.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CSS = "static/app.css";
const HTML = "static/index.html";
const TOL = 3; // toleransi E2E per kanal (temporary_files/e2e_tema_fondasi.py)

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const linesArg = (args.find(a => a.startsWith("--lines=")) || "").slice(8);
const htmlLines = new Set();
for (const part of linesArg.split(",").map(s => s.trim()).filter(Boolean)) {
  const m = part.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) { console.error("--lines tidak valid: " + part); process.exit(2); }
  for (let n = +m[1]; n <= +(m[2] || m[1]); n++) htmlLines.add(n);
}

// Pemetaan hex → token (huruf besar/kecil diabaikan). rgba(168,197,0,a) ditangani terpisah.
const HEX_MAP = {
  "a8c500": "--accent",
  "95ad00": "--accent-hover",
  "7e9400": "--accent-text",
  "6b8000": "--accent-text-strong",
  "5d6e00": "--accent-text-strong",
  "6b7f00": "--accent-text-strong",
  "b6d400": "--accent-2",
  "a3c100": "--accent-2-hover",
  "f4fad6": "--accent-soft",
};
const RE = /var\(--accent,\s*#a8c500\)|#(a8c500|95ad00|7e9400|6b8000|5d6e00|6b7f00|b6d400|a3c100|f4fad6)\b|rgba\(\s*168\s*,\s*197\s*,\s*0\s*,\s*([^)]*?)\s*\)/gi;

// ── Warna: normalisasi ke [r,g,b,a] untuk membandingkan literal dengan nilai token ──
function rgbaOf(v) {
  v = String(v).trim().toLowerCase();
  let m = v.match(/^#([0-9a-f]{6})$/);
  if (m) { const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255, 1]; }
  m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  return null;
}
function delta(a, b) {
  const x = rgbaOf(a), y = rgbaOf(b);
  if (!x || !y) return Infinity;
  if (x[3] !== y[3]) return Infinity;
  return Math.max(Math.abs(x[0] - y[0]), Math.abs(x[1] - y[1]), Math.abs(x[2] - y[2]));
}

// ── Parser CSS minimal: aturan (selektor, konteks @-rule, deklarasi + offset) ──
function blankComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, c => c.replace(/[^\n]/g, " "));
}
function parseCss(text) {
  const src = blankComments(text);
  const rules = [];
  const stack = [];
  let buf = "", bufStart = 0, paren = 0, quote = null;
  const addDecl = (node, raw, start) => {
    const i = raw.indexOf(":");
    if (!node || i < 0) return;
    const prop = raw.slice(0, i).trim().toLowerCase();
    let value = raw.slice(i + 1);
    const lead = value.length - value.trimStart().length;
    value = value.trim();
    node.decls.push({ prop, value, important: /!important\s*$/i.test(value), start: start + i + 1 + lead });
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quote) { if (ch === quote && src[i - 1] !== "\\") quote = null; buf += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === "(") paren++;
    if (ch === ")") paren--;
    if (paren > 0) { buf += ch; continue; }
    if (ch === "{") {
      stack.push({ prelude: buf.trim(), ctx: stack.map(n => n.prelude), decls: [], start: i });
      buf = ""; bufStart = i + 1;
    } else if (ch === ";") {
      addDecl(stack[stack.length - 1], buf, bufStart); buf = ""; bufStart = i + 1;
    } else if (ch === "}") {
      const node = stack.pop();
      if (buf.trim()) addDecl(node, buf, bufStart);
      if (node) { node.end = i; rules.push(node); }
      buf = ""; bufStart = i + 1;
    } else {
      if (!buf.length) bufStart = i;
      buf += ch;
    }
  }
  return rules;
}
function splitSelectors(sel) {
  const out = []; let depth = 0, cur = "";
  for (const ch of sel) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}
const DARK = '[data-theme="dark"]';
const covers = (overrideProp, prop) => overrideProp === prop || overrideProp === prop + "-color" || prop === overrideProp + "-color";

// ── Token: nilai terang (:root) dan gelap (blok gelap pertama, jatuh ke terang bila tidak ditimpa) ──
function tokenTable(cssText) {
  const rules = parseCss(cssText);
  const rootRule = rules.find(r => r.prelude === ":root" && !r.ctx.length);
  const darkRule = rules.find(r => r.prelude === DARK && !r.ctx.length);
  const light = {}, dark = {};
  for (const d of rootRule.decls) light[d.prop] = d.value;
  for (const d of darkRule.decls) dark[d.prop] = d.value;
  // Rentang offset blok token (dilewati), sama dengan stripRoot di tests/offline/theme_guard.test.js.
  return { light, dark: { ...light, ...dark }, skip: [cssText.lastIndexOf(":root", rootRule.start), darkRule.end], rules };
}

const lineOf = (text) => { const starts = [0]; for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1); return (off) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; } return lo + 1; }; };

function replacementFor(m) {
  if (/^var\(/i.test(m[0])) return { token: "--accent", literal: "#A8C500", out: "var(--accent)", kind: "fallback" };
  if (m[1]) { const token = HEX_MAP[m[1].toLowerCase()]; return { token, literal: "#" + m[1], out: `var(${token})`, kind: "hex" }; }
  return { token: "--accent-rgb", literal: `rgba(168,197,0,${m[2]})`, out: `rgba(var(--accent-rgb), ${m[2]})`, kind: "rgba" };
}
// Nilai efektif token setelah substitusi untuk dibandingkan dengan literal.
function tokenValue(rep, table, mode) {
  const t = table[mode];
  if (rep.kind === "rgba") return `rgba(${t["--accent-rgb"]},${rep.literal.match(/,([^,]*)\)$/)[1]})`;
  return t[rep.token];
}

// ── app.css ──
function planCss(text) {
  const table = tokenTable(text);
  const line = lineOf(text);
  // Indeks aturan gelap: bagian selektor tanpa awalan [data-theme="dark"] → [{decls, ctx (@-rule induk), line}]
  const darkIdx = new Map();
  for (const r of table.rules) {
    for (const part of splitSelectors(r.prelude)) {
      if (!part.startsWith(DARK + " ")) continue;
      const key = part.slice(DARK.length + 1);
      if (!darkIdx.has(key)) darkIdx.set(key, []);
      darkIdx.get(key).push({ decls: r.decls, ctx: r.ctx.join(" | "), line: line(r.start) });
    }
  }
  const findDecl = (off) => {
    for (const r of table.rules) for (const d of r.decls) if (off >= d.start && off < d.start + d.value.length) return { r, d };
    return null;
  };
  const plans = [], skipped = [];
  for (const m of text.matchAll(RE)) {
    const off = m.index;
    if (off >= table.skip[0] && off <= table.skip[1]) continue; // blok token
    const rep = replacementFor(m);
    const ln = line(off);
    const where = findDecl(off);
    const reasons = [], notes = [];
    const lightVal = tokenValue(rep, table, "light"), darkVal = tokenValue(rep, table, "dark");
    const dLight = delta(lightVal, rep.literal), dDark = delta(darkVal, rep.literal);
    if (!where) reasons.push("bukan di dalam deklarasi CSS");
    else {
      const parts = splitSelectors(where.r.prelude);
      const ctx = where.r.ctx.join(" | ");
      if (/@keyframes/.test(ctx) && dDark !== 0) reasons.push("@keyframes dengan token yang beda di mode gelap");
      for (const part of parts) {
        if (/@keyframes/.test(ctx)) break;
        const isDark = part.startsWith(DARK);
        if (!isDark && dLight > TOL) reasons.push(`terang: ${rep.token} = ${lightVal} ≠ ${rep.literal} (selisih kanal ${dLight})`);
        if (!isDark && dLight > 0 && dLight <= TOL) notes.push(`≈ terang selisih kanal ${dLight} ≤ ${TOL} (plan R2)`);
        if (dDark === 0) continue;
        if (isDark) { if (dDark > TOL) reasons.push(`gelap: ${rep.token} = ${darkVal} ≠ ${rep.literal}`); continue; }
        const overrides = (darkIdx.get(part) || []).filter(o => (o.ctx === "" || o.ctx === ctx) &&
          o.decls.some(d => covers(d.prop, where.d.prop) && (d.important || !where.d.important)));
        if (overrides.length) notes.push(`gelap ditimpa [data-theme="dark"] ${part} (baris ${overrides.map(o => o.line).join(",")})`);
        else reasons.push(`gelap: "${part}" { ${where.d.prop} } tanpa aturan gelap penimpa; ${rep.token} gelap = ${darkVal} ≠ ${rep.literal}`);
      }
    }
    const item = { file: CSS, line: ln, off, len: m[0].length, old: m[0], out: rep.out, key: rep.kind === "rgba" ? "rgba(168,197,0,a) → rgba(var(--accent-rgb), a)" : rep.kind === "fallback" ? "var(--accent, #A8C500) → var(--accent)" : `${rep.literal.toUpperCase()} → var(${rep.token})`, notes: [...new Set(notes)] };
    if (reasons.length) skipped.push({ ...item, reasons: [...new Set(reasons)] });
    else plans.push(item);
  }
  return { plans, skipped };
}

// ── index.html: semua kandidat dicetak; hanya baris di --lines yang ditulis ──
function planHtml(text) {
  const line = lineOf(text);
  const plans = [], skipped = [];
  for (const m of text.matchAll(RE)) {
    const ln = line(m.index);
    if (/^var\(/i.test(m[0])) { skipped.push({ file: HTML, line: ln, old: m[0], reasons: ["fallback var(--accent, #A8C500) dibiarkan (berlaku saat app.css gagal dimuat)"] }); continue; }
    const rep = replacementFor(m);
    const item = { file: HTML, line: ln, off: m.index, len: m[0].length, old: m[0], out: rep.out, key: rep.kind === "rgba" ? "rgba(168,197,0,a) → rgba(var(--accent-rgb), a)" : `${rep.literal.toUpperCase()} → var(${rep.token})`, notes: [] };
    if (htmlLines.has(ln)) plans.push(item);
    else skipped.push({ ...item, reasons: ["tidak ada di --lines → dikerjakan manual (canvas/Chart.js, atau warna yang diurai dashTint)"] });
  }
  return { plans, skipped };
}

function apply(text, plans) {
  let out = text;
  for (const p of [...plans].sort((a, b) => b.off - a.off)) out = out.slice(0, p.off) + p.out + out.slice(p.off + p.len);
  return out;
}

const report = [];
const say = (s) => report.push(s);
const results = {};
for (const [file, planner] of [[CSS, planCss], [HTML, planHtml]]) {
  const abs = path.join(ROOT, file);
  const text = fs.readFileSync(abs, "utf8");
  const { plans, skipped } = planner(text);
  results[file] = { plans, skipped };
  say(`== ${file}: ${plans.length} penggantian${DRY ? " (rencana)" : ""}`);
  for (const p of plans) say(`${p.file}:${p.line}: ${p.old} → ${p.out}${p.notes.length ? "   [" + p.notes.join("; ") + "]" : ""}`);
  if (!DRY && plans.length) fs.writeFileSync(abs, apply(text, plans));
}
say("");
say("== Jumlah per pemetaan");
for (const file of [CSS, HTML]) {
  const counts = {};
  for (const p of results[file].plans) counts[p.key] = (counts[p.key] || 0) + 1;
  for (const [k, n] of Object.entries(counts).sort()) say(`${file}  ${String(n).padStart(3)}  ${k}`);
}
say("");
say("== DILEWATI (tetap literal di berkas; index.html non-CSS dikerjakan manual)");
for (const file of [CSS, HTML]) for (const s of results[file].skipped) say(`${s.file}:${s.line}: ${s.old}   — ${s.reasons.join("; ")}`);
console.log(report.join("\n"));
