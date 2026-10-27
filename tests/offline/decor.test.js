"use strict";
// Registri dekorasi TF.decor (kelopak pojok halaman, maskot kosong/pencarian) — spec tema §3.5/§3.6.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "../..");
const decor = require("../../static/offline/decor.js");
const themes = require("../../static/offline/themes.js");

const IDS = ["mascot-happy", "mascot-search", "petals"];
const ALLOWED_VARS = ["--accent", "--accent-duo", "--accent-soft", "--bg-card", "--text-primary"];

test("DECOR berisi tepat petals, mascot-happy, mascot-search", () => {
  assert.deepEqual(Object.keys(decor.DECOR).sort(), IDS);
  assert.ok(Object.isFrozen(decor.DECOR));
  for (const id of IDS) assert.ok(Object.isFrozen(decor.DECOR[id]), id + " beku");
  assert.equal(decor.DECOR.petals.animated, true);
  assert.notEqual(decor.DECOR["mascot-happy"].animated, true);
});

test("tiap svg diawali <svg dan berisi viewBox sesuai brief", () => {
  const boxes = { petals: "0 0 130 90", "mascot-happy": "0 0 96 96", "mascot-search": "0 0 96 96" };
  for (const id of IDS) {
    const s = decor.DECOR[id].svg;
    assert.equal(typeof s, "string");
    assert.ok(s.startsWith("<svg"), id);
    assert.ok(s.includes('viewBox="' + boxes[id] + '"'), id + " viewBox");
    assert.ok(s.includes('aria-hidden="true"'), id + " aria-hidden");
    assert.ok(s.endsWith("</svg>"), id);
  }
});

test("tanpa hex/rgb/hsl, <script, url(, on\\w+=, <image, <foreignObject", () => {
  for (const id of IDS) {
    const s = decor.DECOR[id].svg;
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(s), id + " hex");
    assert.ok(!/\b(rgb|rgba|hsl|hsla)\s*\(/i.test(s), id + " rgb/hsl");
    assert.ok(!/<script/i.test(s), id + " script");
    assert.ok(!/url\s*\(/i.test(s), id + " url(");
    assert.ok(!/\bon\w+\s*=/i.test(s), id + " on*=");
    assert.ok(!/<image/i.test(s), id + " image");
    assert.ok(!/<foreignObject/i.test(s), id + " foreignObject");
  }
});

test("warna hanya currentColor atau var(--accent|--accent-duo|--accent-soft|--bg-card|--text-primary)", () => {
  for (const id of IDS) {
    const s = decor.DECOR[id].svg;
    const vals = [...s.matchAll(/\b(?:fill|stroke)="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(vals.length > 0, id + " punya warna");
    for (const v of vals) {
      if (v === "none" || v === "currentColor") continue;
      const m = /^var\((--[a-z-]+)\)$/.exec(v);
      assert.ok(m && ALLOWED_VARS.includes(m[1]), id + " warna tak diizinkan: " + v);
    }
  }
  assert.ok(decor.DECOR.petals.svg.includes('fill="var(--accent-duo)"'));
  assert.ok(decor.DECOR["mascot-search"].svg.includes('stroke="var(--accent)"'));
});

test("petals: 4 kelopak; maskot: bunga 5 kelopak", () => {
  assert.equal((decor.DECOR.petals.svg.match(/<path/g) || []).length, 4);
  assert.equal((decor.DECOR["mascot-happy"].svg.match(/<ellipse/g) || []).length, 5);
  assert.equal((decor.DECOR["mascot-search"].svg.match(/<ellipse/g) || []).length, 5);
});

test("svgFor id tak dikenal → null; id dikenal → string svg", () => {
  assert.equal(decor.svgFor("nope"), null);
  assert.equal(decor.svgFor(undefined), null);
  assert.equal(decor.svgFor("toString"), null);
  assert.equal(decor.svgFor("petal"), null);
  for (const id of IDS) assert.equal(decor.svgFor(id), decor.DECOR[id].svg);
});

test("setiap id dekorasi yang dirujuk peta slot TF.themes ada di DECOR, kecuali petal", () => {
  for (const p of themes.PALETTES) {
    for (const id of Object.values(p.decor)) {
      if (id === "petal") continue;
      assert.ok(decor.DECOR[id], p.id + " merujuk dekorasi tak ada: " + id);
    }
  }
});

test("browser: root.TF.decor terpasang tanpa menyentuh DOM", () => {
  const code = fs.readFileSync(path.join(ROOT, "static/offline/decor.js"), "utf8");
  const sandbox = { self: {} };
  sandbox.self.TF = {};
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  assert.deepEqual(Object.keys(sandbox.self.TF.decor.DECOR).sort(), IDS);
});

test("decor.js dimuat setelah themes.js dan sebelum ui-components.js; ada di STATIC", () => {
  const html = fs.readFileSync(path.join(ROOT, "static/index.html"), "utf8");
  const a = html.indexOf('<script src="/static/offline/themes.js"></script>');
  const b = html.indexOf('<script src="/static/offline/decor.js"></script>');
  const c = html.indexOf('<script src="/static/ui-components.js"></script>');
  assert.ok(a > 0 && b > a && c > b, "urutan themes.js < decor.js < ui-components.js");
  const sw = fs.readFileSync(path.join(ROOT, "static/sw.js"), "utf8");
  const m = /const STATIC = \[([\s\S]*?)\n\];/.exec(sw);
  assert.ok(m && m[1].includes('"/static/offline/decor.js",'), "decor.js ada di STATIC");
});
