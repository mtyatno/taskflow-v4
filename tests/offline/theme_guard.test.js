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

test("token baru ada di :root", () => {
  for (const t of ["--accent-rgb", "--accent-ink", "--accent-text", "--accent-text-strong", "--accent-2", "--accent-2-hover", "--accent-soft", "--accent-duo", "--accent-ring", "--bg-sidebar", "--border-strong", "--radius-sm", "--radius-md", "--radius-pill", "--font-heading"]) {
    assert.match(root, new RegExp(`\\n\\s*${t}:`), t);
  }
});

test("warna bermakna di :root tidak berubah", () => {
  for (const d of ["--p1: #ef4444", "--p2: #f97316", "--p3: #eab308", "--p4: #22c55e", "--q1: #ef4444", "--q3: #f97316", "--q4: #94a3b8", "--success: #22c55e", "--pomodoro: #ef4444", "--break: #22c55e"]) {
    assert.ok(root.includes(d), d);
  }
  assert.ok(root.includes("--q2: var(--accent)"));
});

test("themes.css hanya blok [data-palette] berisi deklarasi --*", () => {
  const body = tcss.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    assert.match(m[1].trim(), /^\[data-palette="[a-z]+"\](\[data-theme="dark"\])?$/);
    for (const d of m[2].split(";").map(s => s.trim()).filter(Boolean)) assert.match(d, /^--[a-z0-9-]+\s*:/, d);
  }
});

test("themes.css dan themes.js dimuat index.html", () => {
  assert.match(html, /<link rel="stylesheet" href="\/static\/themes\.css\?v=1">/);
  assert.ok(html.includes('<script src="/static/offline/themes.js">'), "tag themes.js tidak ada");
  assert.ok(html.indexOf('<script src="/static/offline/themes.js">') < html.indexOf('<script src="/static/ui-components.js">'));
});
