"use strict";
// Sistem plugin Fase 0a — fasad TF.api v1: data, ui, env, log (spec §4.7).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset: resetDB, openDB } = require("../../static/offline/db.js");
const RT = require("../../static/plugin-runtime.js");
const P = RT.plugins;

const INDEX = { v: 1, plugins: [{ id: "habit-heatmap", name: "Heatmap Habit", version: "1.0.0", permissions: ["storage"], defaultEnabled: true, files: ["plugin.js"], hash: "1" }] };

beforeEach(async () => {
  P._reset();
  resetDB();
  await deleteDB(DB_NAME);
  await P.init({ fetchIndex: () => Promise.resolve(INDEX) });
});

async function seed(store, recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    for (const r of recs) tx.objectStore(store).put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
function habit(over) {
  return Object.assign({ server_id: null, title: over.cid, phase: "pagi", micro_target: "", frequency: "[]", identity_pillar: "", deleted: false }, over);
}

test("apiVersion 1; for(id) stabil dan beku", () => {
  assert.equal(RT.api.apiVersion, 1);
  const a = RT.api.for("habit-heatmap");
  assert.equal(a, RT.api.for("habit-heatmap"));
  assert.ok(Object.isFrozen(a));
  for (const k of ["events", "storage", "data", "ui", "env", "log"]) assert.ok(a[k], k);
  // Fase 0b (spec §6.4): api.fetch selalu ada; tanpa izin network → PluginPermissionError (plugin_fetch.test.js).
  assert.equal(typeof a.fetch, "function");
});

test("data.habits.list dan logs menyaring rentang, log terhapus, dan habit terhapus", async () => {
  await seed("habits", [habit({ cid: "h1", server_id: 10 }), habit({ cid: "h2" }), habit({ cid: "h3", deleted: true })]);
  await seed("habit_logs", [
    { cid: "l1", habit_cid: "h1", date: "2026-10-01", status: "done" },
    { cid: "l2", habit_cid: "h1", date: "2026-10-15", status: "done" },
    { cid: "l3", habit_cid: "h2", date: "2026-10-31", status: "skipped" },
    { cid: "l4", habit_cid: "h2", date: "2026-11-01", status: "done" },
    { cid: "l5", habit_cid: "h3", date: "2026-10-10", status: "done" },
    { cid: "l6", habit_cid: "h1", date: "2026-10-20", status: "done", deleted: true },
    { cid: "l7", habit_cid: "h1", date: "2026-09-30", status: "done" },
  ]);
  const d = RT.api.for("habit-heatmap").data;
  const habits = await d.habits.list();
  assert.deepEqual(habits.map((h) => h.id).sort(), [10, "h2"].sort());
  const logs = await d.habits.logs({ from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(logs.map((l) => l.cid).sort(), ["l1", "l2", "l3"]);
  const l1 = logs.find((l) => l.cid === "l1");
  assert.equal(l1.habitId, 10);
  assert.equal(l1.status, "done");
  assert.equal(l1.date, "2026-10-01");
  assert.equal(logs.find((l) => l.cid === "l3").habitId, "h2");
  const all = await d.habits.logs({});
  assert.equal(all.length, 5);
});

test("data.tasks.list lewat router lokal: includeDone dan since", async () => {
  const base = { list_id: null, parent_cid: null, priority: "P2", quadrant: "Q2", project: "", context: "", deadline: null, deleted: false, title: "t" };
  await seed("tasks", [
    Object.assign({}, base, { cid: "t1", server_id: 1, gtd_status: "next", updated_at: "2026-10-01T00:00:00Z" }),
    Object.assign({}, base, { cid: "t2", server_id: 2, gtd_status: "done", completed_at: "2026-10-30T05:00:00Z", updated_at: "2026-10-30T05:00:00Z" }),
    Object.assign({}, base, { cid: "t3", gtd_status: "done", completed_at: "2026-09-01T05:00:00Z", updated_at: "2026-09-01T05:00:00Z" }),
    Object.assign({}, base, { cid: "t4", gtd_status: "next", deleted: true }),
  ]);
  const d = RT.api.for("habit-heatmap").data;
  const active = await d.tasks.list();
  assert.deepEqual(active.map((t) => t.id), [1]);
  const all = await d.tasks.list({ includeDone: true });
  assert.deepEqual(all.map((t) => t.id).sort(), [1, 2, "t3"].sort());
  const recent = await d.tasks.list({ includeDone: true, since: "2026-10-15T00:00:00+07:00" });
  assert.deepEqual(recent.map((t) => t.id), [2]);
});

test("ui: lewat bindHost; navigate hanya halaman inti", () => {
  const calls = [];
  P.bindHost({ toast: (m, t) => calls.push(["toast", m, t]), openTask: (id) => calls.push(["open", id]), navigate: (p) => calls.push(["nav", p]) });
  const ui = RT.api.for("habit-heatmap").ui;
  ui.toast("Halo", "success");
  ui.openTask(12);
  for (const p of ["dashboard", "focus", "inbox", "settings"]) ui.navigate(p);
  assert.throws(() => ui.navigate("admin"), (e) => e.name === "PluginPermissionError");
  assert.deepEqual(calls, [["toast", "Halo", "success"], ["open", 12], ["nav", "dashboard"], ["nav", "focus"], ["nav", "inbox"], ["nav", "settings"],
    ["toast", "Plugin Heatmap Habit mengalami error", "error"]]); // pelanggaran izin dihitung sebagai error (§8)
  assert.equal(P.failures("habit-heatmap")[0].kind, "permission");
  assert.equal(ui.sanitize("<img src=x onerror=alert(1)><mark>ok</mark>").indexOf("<img"), -1);
  assert.ok(ui.sanitize("<mark>ok</mark>").includes("<mark>ok</mark>")); // allowlist safehtml (br/details/summary/mark)
});

test("toast action: {label, onClick} diteruskan sebagai argumen ketiga; onClick yang melempar ditangkap, tidak menghitung failures; label > 20 / bukan fungsi → action diabaikan (toast tetap)", () => {
  const calls = [];
  P.bindHost({ toast: function () { calls.push(Array.prototype.slice.call(arguments)); } });
  const ui = RT.api.for("habit-heatmap").ui;
  let clicked = 0;
  ui.toast("Jadwal diubah", "success", { label: "Urungkan", onClick: () => { clicked += 1; } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 3);
  assert.deepEqual(calls[0].slice(0, 2), ["Jadwal diubah", "success"]);
  assert.deepEqual(Object.keys(calls[0][2]).sort(), ["label", "onClick"]);
  assert.equal(calls[0][2].label, "Urungkan");
  calls[0][2].onClick();
  assert.equal(clicked, 1);
  // onClick melempar → tertangkap (host memanggil onClose sesudahnya), bukan error plugin
  ui.toast("x", "info", { label: "Coba", onClick: () => { throw new Error("boom"); } });
  assert.doesNotThrow(() => calls[1][2].onClick());
  assert.deepEqual(P.failures("habit-heatmap"), []);
  // action tidak sah → diabaikan, toast tetap dengan dua argumen
  const bad = [
    { label: "x".repeat(21), onClick: () => {} },
    { label: "", onClick: () => {} },
    { label: "Ok", onClick: "bukan fungsi" },
    { label: 5, onClick: () => {} },
    null, "str", 12, [], {},
  ];
  for (const a of bad) {
    const before = calls.length;
    ui.toast("tetap", "info", a);
    assert.equal(calls.length, before + 1);
    assert.equal(calls[before].length, 2, JSON.stringify(a));
    assert.deepEqual(calls[before], ["tetap", "info"]);
  }
  ui.toast("dua puluh", "info", { label: "x".repeat(20), onClick: () => {} });
  assert.equal(calls[calls.length - 1].length, 3);
});

// ── api.ui.saveFile (1d-2 R4, spec 1d K54 / Q7 (a)) ──────────────────────────
// root palsu: document/URL/Blob/setTimeout dipasang di globalThis (root runtime di Node) HANYA selama fn sinkron
// berjalan, lalu dipulihkan — timer palsu dicatat dan dijalankan tangan (jam palsu).
function fakeWeb(opts = {}) {
  const log = { blobs: [], created: [], urls: [], revoked: [], timers: [], appended: [], removed: [] };
  const body = {
    children: [],
    appendChild(el) { log.appended.push(el); el.parentNode = body; body.children.push(el); return el; },
    removeChild(el) { log.removed.push(el); body.children = body.children.filter((x) => x !== el); el.parentNode = null; return el; },
  };
  const document = {
    body,
    createElement(tag) {
      const el = {
        tagName: String(tag).toUpperCase(), style: {}, parentNode: null, clicks: 0, clickedAttached: null,
        click() { el.clicks += 1; el.clickedAttached = el.parentNode === body; if (opts.clickThrows) throw new Error("klik gagal"); },
      };
      log.created.push(el);
      return el;
    },
  };
  class Blob { constructor(parts, o) { this.parts = parts; this.opts = o; log.blobs.push(this); } }
  const URL = {
    createObjectURL(b) { log.urls.push(b); return "blob:uji/" + log.urls.length; },
    revokeObjectURL(u) { log.revoked.push(u); },
  };
  const setTimeout = (fn, ms) => { log.timers.push({ fn, ms }); return log.timers.length; };
  const flush = () => { const ts = log.timers.splice(0); for (const t of ts) t.fn(); };
  return { log, body, flush, globals: { document, Blob, URL, setTimeout } };
}
function withGlobals(g, fn) {
  const keys = ["document", "URL", "Blob", "setTimeout"];
  const prev = {};
  for (const k of keys) prev[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  try {
    for (const k of keys) {
      if (!(k in g)) continue;
      if (g[k] === undefined) delete globalThis[k];
      else Object.defineProperty(globalThis, k, { value: g[k], writable: true, configurable: true, enumerable: false });
    }
    return fn();
  } finally {
    for (const k of keys) {
      if (prev[k]) Object.defineProperty(globalThis, k, prev[k]);
      else delete globalThis[k];
    }
  }
}
const quietWarn = (fn) => {
  const orig = console.warn;
  console.warn = () => {};
  try { return fn(); } finally { console.warn = orig; }
};
const noEffect = (log) => log.blobs.length + log.created.length + log.urls.length + log.revoked.length + log.timers.length + log.appended.length;

test("ui: kunci permukaan api.ui = navigate, openTask, sanitize, saveFile, toast (beku)", () => {
  const ui = RT.api.for("habit-heatmap").ui;
  assert.deepEqual(Object.keys(ui).sort(), ["navigate", "openTask", "sanitize", "saveFile", "toast"]);
  assert.ok(Object.isFrozen(ui));
  assert.equal(typeof ui.saveFile, "function");
});

test("saveFile validasi: nama/teks/mime tidak sah → lempar PluginPermissionError SINKRON, tanpa Blob/createElement/createObjectURL/timer (juga di tauri)", () => {
  const ui = RT.api.for("uji-unduh").ui; // id di luar indeks: denied tetap dicatat failures, tanpa toast/peredaman
  const f = fakeWeb();
  const ok = ["Timeline.xml", "x".repeat(20 * 1024 * 1024), "application/xml"];
  const bad = [
    // nama: bukan string, kosong, > 120, karakter terlarang, kontrol, awalan titik
    [5, ok[1], ok[2]], [null, ok[1], ok[2]], [undefined, ok[1], ok[2]], ["", ok[1], ok[2]], ["a".repeat(121), ok[1], ok[2]],
    ["🌸".repeat(117) + ".xml", ok[1], ok[2]], // 121 code point
    ...["/", "\\", ":", "*", "?", "\"", "<", ">", "|", "\u0000", "\u0009", "\n", "\u001f", "\u007f"].map((ch) => ["a" + ch + "b.xml", ok[1], ok[2]]),
    [".xml", ok[1], ok[2]], [".hidden.xml", ok[1], ok[2]],
    // teks: bukan string, > 20 MiB unit kode
    ["a.xml", 5, ok[2]], ["a.xml", null, ok[2]], ["a.xml", undefined, ok[2]], ["a.xml", {}, ok[2]], ["a.xml", ["x"], ok[2]],
    ["a.xml", "x".repeat(20 * 1024 * 1024 + 1), ok[2]],
    // mime di luar daftar
    ["a.xml", "x", "text/html"], ["a.xml", "x", "application/xml;charset=utf-8"], ["a.xml", "x", ""], ["a.xml", "x", undefined],
    ["a.xml", "x", "APPLICATION/XML"], ["a.xml", "x", "image/svg+xml"], ["a.xml", "x", "application/octet-stream"], ["a.xml", "x", 5],
  ];
  quietWarn(() => withGlobals(f.globals, () => {
    for (const args of bad) {
      let ret = "tidak dipanggil";
      assert.throws(() => { ret = ui.saveFile(...args); }, (e) => e.name === "PluginPermissionError" && e instanceof RT.api.PluginPermissionError, JSON.stringify(args.map((a) => (typeof a === "string" && a.length > 40 ? "len " + a.length : a))));
      assert.equal(ret, "tidak dipanggil", "lempar sinkron, bukan Promise reject");
    }
    globalThis.__TAURI__ = {};
    try {
      assert.throws(() => ui.saveFile("", "x", "text/plain"), (e) => e.name === "PluginPermissionError", "validasi sebelum cabang native");
    } finally { delete globalThis.__TAURI__; }
  }));
  assert.equal(noEffect(f.log), 0, "tanpa efek");
  assert.ok(P.failures("uji-unduh").length > 0 && P.failures("uji-unduh").every((x) => x.kind === "permission"));
  // plugin terdaftar: pelanggaran dihitung sebagai error plugin (pola navigate, §8)
  const calls = [];
  P.bindHost({ toast: (m, t) => calls.push([m, t]) });
  quietWarn(() => assert.throws(() => RT.api.for("habit-heatmap").ui.saveFile("a/b.xml", "x", "text/xml"), (e) => e.name === "PluginPermissionError"));
  assert.equal(P.failures("habit-heatmap")[0].kind, "permission");
  assert.deepEqual(calls, [["Plugin Heatmap Habit mengalami error", "error"]]);
});

test("saveFile batas sah: nama 120 karakter / emoji / spasi / titik di tengah, teks tepat 20 MiB, kelima mime → resolve true", async () => {
  const ui = RT.api.for("habit-heatmap").ui;
  const cases = [
    ["n".repeat(120), "x", "application/xml"],
    ["🌸".repeat(116) + ".xml", "x", "application/xml"], // 120 code point (236 unit kode): panjang dihitung per karakter
    ["Tim Pemasaran 🌸-2026-11-10.xml", "x", "text/xml"],
    ["laporan.v2.final.csv", "a,b", "text/csv"],
    ["catatan.txt", "x".repeat(20 * 1024 * 1024), "text/plain"],
    ["data.json", "{}", "application/json"],
  ];
  for (const [name, text, mime] of cases) {
    const f = fakeWeb();
    const p = withGlobals(f.globals, () => ui.saveFile(name, text, mime));
    assert.equal(await p, true, name.slice(0, 30));
    assert.equal(f.log.created.length, 1);
    assert.equal(f.log.created[0].download, name);
    assert.deepEqual(f.log.blobs[0].opts, { type: mime + ";charset=utf-8" });
  }
});

test("saveFile native (env.platform tauri) → resolve false tanpa menyentuh DOM/URL/Blob/timer", async () => {
  const ui = RT.api.for("habit-heatmap").ui;
  const f = fakeWeb();
  globalThis.__TAURI__ = {};
  let p;
  try {
    assert.equal(RT.api.for("habit-heatmap").env.platform, "tauri");
    p = withGlobals(f.globals, () => ui.saveFile("Timeline-2026-11-10.xml", "<Project/>", "application/xml"));
  } finally { delete globalThis.__TAURI__; }
  assert.ok(p instanceof Promise);
  assert.equal(await p, false);
  assert.equal(noEffect(f.log), 0);
});

test("saveFile web: Blob mime;charset=utf-8 → satu <a download> tersembunyi ditempel ke body → click sekali → dilepas → revokeObjectURL setelah timer 1000 ms → resolve true", async () => {
  const ui = RT.api.for("habit-heatmap").ui;
  const f = fakeWeb();
  const xml = "<?xml version=\"1.0\"?><Project>🍅 &amp;</Project>";
  const p = withGlobals(f.globals, () => ui.saveFile("Alpha-2026-11-10.xml", xml, "application/xml"));
  assert.ok(p instanceof Promise);
  const L = f.log;
  assert.equal(L.blobs.length, 1);
  assert.deepEqual(L.blobs[0].parts, [xml]);
  assert.deepEqual(L.blobs[0].opts, { type: "application/xml;charset=utf-8" });
  assert.deepEqual(L.urls, [L.blobs[0]], "URL objek dari Blob itu");
  assert.equal(L.created.length, 1, "tepat satu elemen");
  const a = L.created[0];
  assert.equal(a.tagName, "A");
  assert.equal(a.href, "blob:uji/1");
  assert.equal(a.download, "Alpha-2026-11-10.xml");
  assert.equal(a.rel, "noopener");
  assert.equal(a.style.display, "none");
  assert.equal(a.clicks, 1);
  assert.equal(a.clickedAttached, true, "click saat tertempel di body");
  assert.deepEqual(L.appended, [a]);
  assert.deepEqual(L.removed, [a]);
  assert.equal(f.body.children.length, 0, "elemen dilepas");
  assert.deepEqual(L.revoked, [], "URL belum dicabut sebelum timer");
  assert.equal(L.timers.length, 1);
  assert.equal(L.timers[0].ms, 1000);
  f.flush();
  assert.deepEqual(L.revoked, ["blob:uji/1"], "dicabut setelah timer");
  assert.equal(await p, true);
});

test("saveFile web: click melempar → reject, elemen tetap dilepas, URL tetap dicabut", async () => {
  const ui = RT.api.for("habit-heatmap").ui;
  const f = fakeWeb({ clickThrows: true });
  const p = withGlobals(f.globals, () => ui.saveFile("a.xml", "x", "text/xml"));
  assert.ok(p instanceof Promise);
  await assert.rejects(p, /klik gagal/);
  assert.equal(f.body.children.length, 0);
  assert.deepEqual(f.log.removed, f.log.created);
  f.flush();
  assert.deepEqual(f.log.revoked, ["blob:uji/1"]);
  assert.deepEqual(P.failures("habit-heatmap"), [], "kegagalan unduh bukan error plugin");
});

test("saveFile web tanpa document / URL.createObjectURL / Blob → reject 'saveFile tidak didukung' tanpa efek", async () => {
  const ui = RT.api.for("habit-heatmap").ui;
  for (const drop of ["document", "URL", "Blob"]) {
    const f = fakeWeb();
    const g = Object.assign({}, f.globals, { [drop]: undefined });
    const p = withGlobals(g, () => ui.saveFile("a.xml", "x", "text/xml"));
    await assert.rejects(p, (e) => e instanceof Error && e.message === "saveFile tidak didukung", drop);
    assert.equal(noEffect(f.log), 0, drop);
  }
});

test("toast tanpa action → dua argumen seperti dulu", () => {
  const calls = [];
  P.bindHost({ toast: function () { calls.push(Array.prototype.slice.call(arguments)); } });
  const ui = RT.api.for("habit-heatmap").ui;
  ui.toast("Halo", "success");
  ui.toast("Info");
  assert.deepEqual(calls, [["Halo", "success"], ["Info", "info"]]);
});

test("env: online, platform, theme, today, userId", () => {
  const env = RT.api.for("habit-heatmap").env;
  assert.equal(typeof env.online, "boolean");
  assert.equal(env.platform, "web");
  globalThis.__TAURI__ = {};
  try { assert.equal(env.platform, "tauri"); } finally { delete globalThis.__TAURI__; }
  assert.deepEqual(env.theme, { palette: "default", mode: "light" });
  const prevDoc = globalThis.document;
  globalThis.document = { documentElement: { getAttribute: (n) => ({ "data-palette": "sakura", "data-theme": "dark" })[n] } };
  try { assert.deepEqual(env.theme, { palette: "sakura", mode: "dark" }); } finally { globalThis.document = prevDoc; }
  assert.match(env.today(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(env.today(), RT.jktDate(Date.now()));
  P.bindHost({ userId: () => "42" });
  assert.equal(env.userId, "42");
});

test("log berprefiks [plugin:<id>]", () => {
  const orig = console.info;
  const got = [];
  console.info = (...a) => got.push(a);
  try { RT.api.for("habit-heatmap").log.info("halo", 1); } finally { console.info = orig; }
  assert.deepEqual(got, [["[plugin:habit-heatmap]", "halo", 1]]);
});
