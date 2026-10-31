"use strict";
// Banner DOM polos untuk status pembaruan IndexedDB (K2 / R12, spec plugin Fase 1 §4).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const U = require("../../static/offline/dbupgrade.js");

const SRC = fs.readFileSync(path.join(__dirname, "../../static/offline/dbupgrade.js"), "utf8");

function fakeDoc(opts) {
  const o = opts || {};
  const byId = new Map();
  const listeners = {};
  function el(tag) {
    const e = {
      tagName: tag.toUpperCase(), attrs: {}, children: [], listeners: {}, parent: null, textContent: "",
      setAttribute(k, v) { this.attrs[k] = String(v); if (k === "id") byId.set(String(v), this); },
      getAttribute(k) { return this.attrs[k]; },
      appendChild(c) { c.parent = this; this.children.push(c); return c; },
      addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
      remove() {
        if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
        this.parent = null;
        if (byId.get(this.attrs.id) === this) byId.delete(this.attrs.id);
      },
    };
    Object.defineProperty(e, "id", { get() { return this.attrs.id; }, set(v) { this.setAttribute("id", v); } });
    return e;
  }
  const doc = {
    body: o.noBody ? null : el("body"),
    createElement: el,
    getElementById: (id) => byId.get(id) || null,
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    fire(t) { (listeners[t] || []).forEach((fn) => fn()); },
    _el: el,
  };
  return doc;
}

function texts(node) {
  return [node.textContent].concat(node.children.flatMap(texts)).filter(Boolean);
}
function find(node, tag) {
  if (node.tagName === tag) return node;
  for (const c of node.children) { const f = find(c, tag); if (f) return f; }
  return null;
}

test("teks persis (R12)", () => {
  assert.equal(U.TEXT_BLOCKED, "Tutup tab Alurik lain untuk menyelesaikan pembaruan");
  assert.equal(U.TEXT_ELSEWHERE, "Alurik diperbarui di tab lain. Muat ulang tab ini.");
  assert.equal(U.RELOAD_LABEL, "Muat ulang");
});

test("bannerFor: tiga status, elsewhere menang", () => {
  assert.equal(U.bannerFor({ blocked: false, upgradedElsewhere: false }), null);
  assert.equal(U.bannerFor(null), null);
  assert.deepEqual(U.bannerFor({ blocked: true, upgradedElsewhere: false }),
    { kind: "blocked", text: U.TEXT_BLOCKED, role: "status", reload: false });
  assert.deepEqual(U.bannerFor({ blocked: false, upgradedElsewhere: true }),
    { kind: "elsewhere", text: U.TEXT_ELSEWHERE, role: "alert", reload: true });
  assert.equal(U.bannerFor({ blocked: true, upgradedElsewhere: true }).kind, "elsewhere");
});

test("render blocked → role=status tanpa tombol, gaya fixed bertoken", () => {
  const doc = fakeDoc();
  const el = U.render(doc, U.bannerFor({ blocked: true }), () => {});
  assert.ok(el);
  assert.equal(doc.getElementById("tf-db-banner"), el);
  assert.equal(el.getAttribute("role"), "status");
  assert.equal(find(el, "BUTTON"), null);
  assert.ok(texts(el).includes(U.TEXT_BLOCKED));
  const style = el.getAttribute("style");
  assert.match(style, /position:\s*fixed/);
  assert.match(style, /var\(--bg-card\)/);
  assert.match(style, /var\(--text-primary\)/);
  assert.match(style, /var\(--border\)/);
  assert.equal(doc.body.children.length, 1);
});

test("render elsewhere → role=alert + tombol Muat ulang memanggil onReload; diganti, bukan ditumpuk", () => {
  const doc = fakeDoc();
  U.render(doc, U.bannerFor({ blocked: true }), () => {});
  let reloads = 0;
  const el = U.render(doc, U.bannerFor({ upgradedElsewhere: true }), () => { reloads++; });
  assert.equal(doc.body.children.length, 1, "satu banner saja");
  assert.equal(el.getAttribute("role"), "alert");
  assert.ok(texts(el).includes(U.TEXT_ELSEWHERE));
  const btn = find(el, "BUTTON");
  assert.ok(btn);
  assert.equal(btn.textContent, "Muat ulang");
  assert.equal(btn.getAttribute("type"), "button");
  btn.listeners.click.forEach((fn) => fn());
  assert.equal(reloads, 1);
});

test("render null → elemen dihapus", () => {
  const doc = fakeDoc();
  U.render(doc, U.bannerFor({ blocked: true }), () => {});
  assert.equal(U.render(doc, null, () => {}), null);
  assert.equal(doc.getElementById("tf-db-banner"), null);
  assert.equal(doc.body.children.length, 0);
  assert.equal(U.render(doc, null, () => {}), null, "tanpa banner pun aman");
});

test("install: berlangganan TF.db, status awal, menunggu DOMContentLoaded bila body belum ada", () => {
  let state = { blocked: false, upgradedElsewhere: false };
  let sub = null;
  let reloaded = 0;
  const doc = fakeDoc({ noBody: true });
  const win = {
    document: doc,
    location: { reload() { reloaded++; } },
    TF: { db: { subscribe(fn) { sub = fn; return () => {}; }, upgradeState: () => state } },
  };
  state = { blocked: true, upgradedElsewhere: false };
  assert.equal(U.install(win), true);
  assert.equal(typeof sub, "function");
  doc.body = doc._el("body");
  doc.fire("DOMContentLoaded");
  assert.equal(doc.getElementById("tf-db-banner").getAttribute("role"), "status");
  state = { blocked: false, upgradedElsewhere: true };
  sub({ type: "upgraded-elsewhere" });
  const el = doc.getElementById("tf-db-banner");
  assert.equal(el.getAttribute("role"), "alert");
  find(el, "BUTTON").listeners.click.forEach((fn) => fn());
  assert.equal(reloaded, 1);
  state = { blocked: false, upgradedElsewhere: false };
  sub({ type: "unblocked" });
  assert.equal(doc.getElementById("tf-db-banner"), null);
});

test("install tanpa TF.db.subscribe → false, tanpa error", () => {
  assert.equal(U.install({ document: fakeDoc(), TF: {} }), false);
  assert.equal(U.install(null), false);
});

test("tidak memakai localStorage/innerHTML", () => {
  assert.doesNotMatch(SRC, /localStorage/);
  assert.doesNotMatch(SRC, /innerHTML/);
});
