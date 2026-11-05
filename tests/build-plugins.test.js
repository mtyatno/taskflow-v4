"use strict";
// Build plugin (spec docs/superpowers/specs/2026-10-29-plugin-fase0a-design.md §6, §7; rencana Task 7):
// compile.js mengompilasi static/plugins/<id>/plugin.jsx → plugin.js, menulis static/plugins/index.json dan blok
// plugin di STATIC sw.js. Diuji di folder sementara agar repo tidak ikut berubah.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const PLUGINS = path.join(ROOT, "static", "plugins");
const SW = path.join(ROOT, "static", "sw.js");
const build = require(path.join(ROOT, "compile.js"));

const SW_STUB = [
  "const CACHE = \"x\";",
  "const STATIC = [",
  "  \"/\",",
  "  \"/static/plugin-runtime.js\",",
  "  // plugins:begin — ditulis compile.js dari static/plugins/index.json, jangan edit manual",
  "  // plugins:end",
  "  \"/config.js\",",
  "];",
  "",
].join("\n");

function tmpDir(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "build-plugins-"));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}
function manifest(id, extra) {
  return Object.assign({
    id, name: "Plugin " + id, description: "Deskripsi " + id, version: "1.0.0", minApi: 1,
    slots: ["dashboard.widgets"], permissions: [], defaultEnabled: false,
  }, extra || {});
}
function put(dir, rel, content) {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
}
const SRC = "function Card() { return <div className=\"dash-card\">Halo</div>; }\n" +
  "window.TF.plugins.register(manifest, function (api) { return { slots: { \"dashboard.widgets\": [{ id: \"c\", component: Card }] } }; });\n";
function fixture(t, plugins) {
  const d = tmpDir(t);
  const pdir = path.join(d, "plugins");
  for (const [id, files] of Object.entries(plugins)) {
    for (const [rel, content] of Object.entries(files)) put(pdir, path.join(id, rel), content);
  }
  const sw = path.join(d, "sw.js");
  fs.writeFileSync(sw, SW_STUB);
  return { pluginsDir: pdir, swPath: sw };
}
const hashOf = (dir, entry) => crypto.createHash("sha1")
  .update(Buffer.concat(entry.files.map((f) => fs.readFileSync(path.join(dir, entry.id, f))))).digest("hex").slice(0, 8);

test("repo: index.json konsisten dengan folder static/plugins (tanpa _template), hash = sha1 8 hex isi files", () => {
  const idx = JSON.parse(fs.readFileSync(path.join(PLUGINS, "index.json"), "utf8"));
  assert.equal(idx.v, 1);
  const dirs = fs.readdirSync(PLUGINS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_") && fs.existsSync(path.join(PLUGINS, e.name, "plugin.jsx")))
    .map((e) => e.name).sort();
  assert.deepEqual(idx.plugins.map((p) => p.id), dirs);
  assert.ok(!idx.plugins.some((p) => p.id.startsWith("_")));
  for (const p of idx.plugins) {
    const m = JSON.parse(fs.readFileSync(path.join(PLUGINS, p.id, "manifest.json"), "utf8"));
    for (const k of ["id", "name", "description", "version", "minApi", "slots", "permissions", "defaultEnabled"]) {
      assert.deepEqual(p[k], m[k], p.id + "." + k + " sama dengan manifest.json");
    }
    assert.equal(p.files[0], "plugin.js");
    for (const f of p.files) assert.ok(fs.existsSync(path.join(PLUGINS, p.id, f)), p.id + "/" + f + " ada");
    assert.match(p.hash, /^[0-9a-f]{8}$/);
    assert.equal(p.hash, hashOf(PLUGINS, p), "hash " + p.id);
    const js = fs.readFileSync(path.join(PLUGINS, p.id, "plugin.js"), "utf8");
    assert.ok(js.startsWith("// generated from plugin.jsx — jangan edit\n"), "header " + p.id);
  }
});

test("repo: hasil build ter-commit identik dengan build ulang (idempoten; sw.js blok plugin ikut)", (t) => {
  const d = tmpDir(t);
  const pdir = path.join(d, "plugins");
  fs.cpSync(PLUGINS, pdir, { recursive: true });
  const sw = path.join(d, "sw.js");
  fs.copyFileSync(SW, sw);
  build.buildPlugins({ pluginsDir: pdir, swPath: sw, log: () => {} });
  assert.equal(fs.readFileSync(sw, "utf8"), fs.readFileSync(SW, "utf8"), "sw.js berubah setelah build ulang — jalankan node compile.js");
  const idx = JSON.parse(fs.readFileSync(path.join(PLUGINS, "index.json"), "utf8"));
  assert.equal(fs.readFileSync(path.join(pdir, "index.json"), "utf8"), fs.readFileSync(path.join(PLUGINS, "index.json"), "utf8"));
  for (const p of idx.plugins) {
    assert.equal(fs.readFileSync(path.join(pdir, p.id, "plugin.js"), "utf8"), fs.readFileSync(path.join(PLUGINS, p.id, "plugin.js"), "utf8"), p.id + "/plugin.js usang — jalankan node compile.js");
  }
  const again = build.buildPlugins({ pluginsDir: pdir, swPath: sw, log: () => {} });
  assert.deepEqual(again.written, [], "run kedua tidak menulis apa pun");
});

test("fixture: plugin.jsx → plugin.js (React.createElement + header + manifest disuntik), _template dilewati", (t) => {
  const fx = fixture(t, {
    "demo-one": { "plugin.jsx": SRC, "manifest.json": JSON.stringify(manifest("demo-one")), "style.css": ".plg-demo{}\n" },
    "_template": { "plugin.jsx": SRC, "manifest.json": JSON.stringify(manifest("my-plugin")) },
  });
  const res = build.buildPlugins(Object.assign({ log: () => {} }, fx));
  const js = fs.readFileSync(path.join(fx.pluginsDir, "demo-one", "plugin.js"), "utf8");
  assert.ok(js.startsWith("// generated from plugin.jsx — jangan edit\n"));
  assert.match(js, /React\.createElement\("div"/);
  assert.doesNotMatch(js, /<div/);
  assert.match(js, /const manifest = Object\.freeze\(\{"id":"demo-one"/);
  assert.ok(!fs.existsSync(path.join(fx.pluginsDir, "_template", "plugin.js")), "_template tidak dikompilasi");
  const idx = JSON.parse(fs.readFileSync(path.join(fx.pluginsDir, "index.json"), "utf8"));
  assert.deepEqual(idx.plugins.map((p) => p.id), ["demo-one"]);
  assert.deepEqual(idx.plugins[0].files, ["plugin.js", "style.css"]);
  assert.deepEqual(res.index, idx);
  // plugin.js memanggil register dengan manifest yang disuntik
  const calls = [];
  const vm = require("node:vm");
  const sandbox = { window: { TF: { plugins: { register: (m, f) => calls.push([m, f]) } } }, React: { createElement: () => null } };
  vm.runInNewContext(js, sandbox);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].id, "demo-one");
  assert.ok(Object.isFrozen(calls[0][0]));
  // sw.js: blok plugin berisi index.json + setiap file ?v=<hash>
  const sw = fs.readFileSync(fx.swPath, "utf8");
  const h = idx.plugins[0].hash;
  assert.ok(sw.includes("  \"/static/plugins/index.json\",\n"));
  assert.ok(sw.includes(`  "/static/plugins/demo-one/plugin.js?v=${h}",\n`));
  assert.ok(sw.includes(`  "/static/plugins/demo-one/style.css?v=${h}",\n`));
  assert.ok(sw.includes("  \"/config.js\",\n"), "isi lain sw.js utuh");
});

test("fixture: hash berubah bila isi plugin.jsx atau style.css berubah; tetap bila tidak", (t) => {
  const fx = fixture(t, { "demo-one": { "plugin.jsx": SRC, "manifest.json": JSON.stringify(manifest("demo-one")), "style.css": ".a{}\n" } });
  const h1 = build.buildPlugins(Object.assign({ log: () => {} }, fx)).index.plugins[0].hash;
  const h1b = build.buildPlugins(Object.assign({ log: () => {} }, fx)).index.plugins[0].hash;
  assert.equal(h1, h1b);
  put(fx.pluginsDir, "demo-one/plugin.jsx", SRC + "// ubah\nconst x = 1;\n");
  const h2 = build.buildPlugins(Object.assign({ log: () => {} }, fx)).index.plugins[0].hash;
  assert.notEqual(h2, h1);
  put(fx.pluginsDir, "demo-one/style.css", ".b{}\n");
  const h3 = build.buildPlugins(Object.assign({ log: () => {} }, fx)).index.plugins[0].hash;
  assert.notEqual(h3, h2);
  assert.ok(!fs.readFileSync(fx.swPath, "utf8").includes(h1), "entri sw.js lama diganti");
});

test("fixture: lint menolak localStorage / fetch( / tokenStore / API_BASE di plugin.js", (t) => {
  for (const bad of ["localStorage.getItem('x');", "fetch('/api/tasks');", "tokenStore.get();", "window.API_BASE;"]) {
    const fx = fixture(t, { "demo-bad": { "plugin.jsx": SRC + bad + "\n", "manifest.json": JSON.stringify(manifest("demo-bad")) } });
    assert.throws(() => build.buildPlugins(Object.assign({ log: () => {} }, fx)), /lint/i, bad);
  }
});

// Temuan review akhir #4: pola lint tambahan.
test("fixture: lint menolak innerHTML / indexedDB / XMLHttpRequest / window.fetch / TF.api.for( / window.TF.meta|db|taskroutes", (t) => {
  for (const bad of ["document.body.innerHTML = 'x';", "indexedDB.open('x');", "new XMLHttpRequest();", "window.fetch;",
    "window.TF.api.for('lain');", "window.TF.meta.metaGet('x');", "window.TF.db.openDB();", "window.TF.taskroutes.buildTaskRouter();"]) {
    const fx = fixture(t, { "demo-bad": { "plugin.jsx": SRC + bad + "\n", "manifest.json": JSON.stringify(manifest("demo-bad")) } });
    assert.throws(() => build.buildPlugins(Object.assign({ log: () => {} }, fx)), /lint/i, bad);
  }
});

// Fase 0b (rencana PR B Task 6, R15): fetch polos / window|self|globalThis.fetch selalu ditolak;
// `.fetch(` (api.fetch) hanya boleh bila manifest berizin "network".
test("fixture: fetch polos / window|self|globalThis.fetch ditolak walau berizin network", (t) => {
  for (const bad of ["fetch('/api/tasks');", "window.fetch('/x');", "self.fetch('/x');", "globalThis.fetch('/x');", "const f = window . fetch;"]) {
    const fx = fixture(t, { "demo-net": { "plugin.jsx": SRC + bad + "\n", "manifest.json": JSON.stringify(manifest("demo-net", { permissions: ["network"] })) } });
    assert.throws(() => build.buildPlugins(Object.assign({ log: () => {} }, fx)), /lint/i, bad);
  }
});

test("fixture: api.fetch( hanya dengan izin network", (t) => {
  const src = "function C({ api }) { api.fetch(\"/api/plugins/demo-net/items\"); return <div>x</div>; }\n" +
    "window.TF.plugins.register(manifest, function (api) { return { slots: { \"dashboard.widgets\": [{ id: \"c\", component: C }] } }; });\n";
  const a = fixture(t, { "demo-net": { "plugin.jsx": src, "manifest.json": JSON.stringify(manifest("demo-net")) } });
  assert.throws(() => build.buildPlugins(Object.assign({ log: () => {} }, a)), (err) => /lint/i.test(err.message) && err.message.includes(".fetch("));
  const b = fixture(t, { "demo-net": { "plugin.jsx": src, "manifest.json": JSON.stringify(manifest("demo-net", { permissions: ["network"] })) } });
  const res = build.buildPlugins(Object.assign({ log: () => {} }, b));
  const idx = JSON.parse(fs.readFileSync(path.join(b.pluginsDir, "index.json"), "utf8"));
  assert.deepEqual(idx.plugins[0].permissions, ["network"]);
  assert.deepEqual(res.index, idx);
  assert.equal(build.lintPlugin("api.fetch('/x');", { permissions: ["network"] }), null);
  assert.equal(build.lintPlugin("api.fetch('/x');", { permissions: [] }), ".fetch(");
  assert.equal(build.lintPlugin("fetch('/x');", { permissions: ["network"] }), "fetch(");
  assert.ok(!build.LINT_RE.test("fetch("), "LINT_RE tanpa fetch(");
});

test("fixture: folder plugin state / Bad_Id ditolak", (t) => {
  for (const id of ["state", "Bad_Id"]) {
    const fx = fixture(t, { [id]: { "plugin.jsx": SRC, "manifest.json": JSON.stringify(manifest(id)) } });
    assert.throws(() => build.buildPlugins(Object.assign({ log: () => {} }, fx)), /dicadangkan/, id);
  }
});

test("fixture: gagal kompilasi, manifest.json hilang, atau id ≠ folder → error", (t) => {
  const a = fixture(t, { "demo-syntax": { "plugin.jsx": "function (\n", "manifest.json": JSON.stringify(manifest("demo-syntax")) } });
  assert.throws(() => build.buildPlugins(Object.assign({ log: () => {} }, a)), /demo-syntax/);
  const b = fixture(t, { "demo-nomani": { "plugin.jsx": SRC } });
  assert.throws(() => build.buildPlugins(Object.assign({ log: () => {} }, b)), /manifest\.json/);
  const c = fixture(t, { "demo-id": { "plugin.jsx": SRC, "manifest.json": JSON.stringify(manifest("lain-id")) } });
  assert.throws(() => build.buildPlugins(Object.assign({ log: () => {} }, c)), /folder/);
});

test("CLI: compile.js gagal → exit 1 (lint), no-op untuk index.html terkompilasi", (t) => {
  const fx = fixture(t, { "demo-bad": { "plugin.jsx": SRC + "localStorage.clear();\n", "manifest.json": JSON.stringify(manifest("demo-bad")) } });
  const r = spawnSync(process.execPath, [path.join(ROOT, "compile.js"), "--plugins-only"], {
    env: Object.assign({}, process.env, { ALURIK_PLUGINS_DIR: fx.pluginsDir, ALURIK_SW_PATH: fx.swPath }), encoding: "utf8",
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["compile:plugins"], "node compile.js --plugins-only");
  assert.equal(pkg.scripts.compile, "node compile.js");
  const src = fs.readFileSync(path.join(ROOT, "compile.js"), "utf8");
  assert.match(src, /already compiled, skipping/);
});

// ── Fase 1 PR 1a-1 (rencana Task 8, R13): contributes, taskExt, parts + plugin contoh demo-ext ──────────────
const DEMO_EXT = path.join(ROOT, "tests", "fixtures", "plugins", "demo-ext");
const VIEW_SRC = "function V() { return <div>v</div>; }\n" +
  "window.TF.plugins.register(manifest, function (api) { return { slots: { \"taskList.views\": [{ id: \"board\", component: V }] } }; });\n";
function extManifest(id, extra) {
  return manifest(id, Object.assign({
    slots: ["taskList.views", "taskDetail.sections"], permissions: ["task.ext"], taskExt: { keys: ["note"] },
    contributes: {
      "taskList.views": [{ id: "board", label: "Demo", icon: { path: "M2 4h12M2 8h12" }, pages: ["project", "workspace"] }],
      "taskDetail.sections": [{ id: "note", label: "Catatan", order: 10 }],
    },
  }, extra || {}));
}
function buildExt(t, man, files) {
  const fx = fixture(t, { [man.id]: Object.assign({ "plugin.jsx": VIEW_SRC, "manifest.json": JSON.stringify(man) }, files || {}) });
  return () => build.buildPlugins(Object.assign({ log: () => {} }, fx));
}

test("fixture demo-ext: parts digabung sebelum kode plugin.jsx, contributes + taskExt ada di index.json dan konstanta manifest, parts tidak", (t) => {
  const d = tmpDir(t);
  const pdir = path.join(d, "plugins");
  fs.cpSync(DEMO_EXT, path.join(pdir, "demo-ext"), { recursive: true });
  const sw = path.join(d, "sw.js");
  fs.writeFileSync(sw, SW_STUB);
  const res = build.buildPlugins({ pluginsDir: pdir, swPath: sw, log: () => {} });
  const m = JSON.parse(fs.readFileSync(path.join(DEMO_EXT, "manifest.json"), "utf8"));
  assert.deepEqual(m.parts, ["util.js"]);
  const entry = res.index.plugins.find((p) => p.id === "demo-ext");
  assert.ok(entry);
  assert.deepEqual(entry.contributes, m.contributes);
  assert.deepEqual(entry.taskExt, { keys: ["note", "after"] });
  assert.deepEqual(entry.permissions, ["task.ext"]);
  assert.equal(entry.parts, undefined, "parts tidak disalin ke index.json");
  assert.deepEqual(entry.files, ["plugin.js"]);
  const js = fs.readFileSync(path.join(pdir, "demo-ext", "plugin.js"), "utf8");
  const partAt = js.indexOf("// part: util.js\n");
  const regAt = js.indexOf("window.TF.plugins.register(");
  const manAt = js.indexOf("const manifest = Object.freeze(");
  assert.ok(manAt > 0 && partAt > manAt && regAt > partAt, "urutan: manifest → part → kode plugin.jsx");
  assert.ok(js.includes(fs.readFileSync(path.join(DEMO_EXT, "util.js"), "utf8").trim()), "isi part mentah (tanpa Babel)");
  const manJson = JSON.parse(js.slice(manAt + "const manifest = Object.freeze(".length, js.indexOf(");\n", manAt)));
  assert.deepEqual(manJson.contributes, m.contributes);
  assert.deepEqual(manJson.taskExt, m.taskExt);
  assert.equal(manJson.parts, undefined);
  // dijalankan di vm: part memasang __demoExt, register memakai kontribusi view + seksi
  const vm = require("node:vm");
  const calls = [];
  const sandbox = { window: { TF: { plugins: { register: (mm, f) => calls.push([mm, f]) } } }, React: { createElement: () => null, useState: (v) => [typeof v === "function" ? v() : v, () => {}], useEffect: () => {} } };
  sandbox.self = sandbox.window;
  vm.runInNewContext(js, sandbox);
  assert.equal(calls.length, 1);
  assert.equal(typeof sandbox.window.__demoExt.label, "function");
  const inst = calls[0][1]({ taskExt: { read: () => ({}) } });
  assert.equal(inst.slots["taskList.views"].map((v) => v.id).join(","), "board");
  assert.equal(inst.slots["taskDetail.sections"].map((v) => v.id).join(","), "note");
  // build ulang idempoten
  assert.deepEqual(build.buildPlugins({ pluginsDir: pdir, swPath: sw, log: () => {} }).written, []);
  // fixture repo tidak pernah berisi hasil build (demo-ext khusus tes, bukan static/plugins)
  assert.ok(!fs.existsSync(path.join(DEMO_EXT, "plugin.js")));
  assert.ok(!fs.existsSync(path.join(PLUGINS, "demo-ext")));
});

test("util.js bisa di-require Node (fungsi murni teruji terpisah)", () => {
  const util = require(path.join(DEMO_EXT, "util.js"));
  assert.equal(util.label({ title: "  Rapat  " }), "Rapat");
  assert.equal(util.label({ title: "" }), "(tanpa judul)");
  assert.equal(util.label(null), "(tanpa judul)");
});

test("parts: berkas hilang / nama ../x.js / plugin.js / duplikat / bukan array → PluginBuildError", (t) => {
  const cases = [
    [["hilang.js"], {}],
    [["../x.js"], {}],
    [["plugin.js"], {}],
    [["a.js", "a.js"], { "a.js": "var a = 1;\n" }],
    ["a.js", { "a.js": "var a = 1;\n" }],
    [["A.js"], { "A.js": "var a = 1;\n" }],
  ];
  for (const [parts, files] of cases) {
    const run = buildExt(t, extManifest("demo-parts", { parts }), files);
    assert.throws(run, (err) => err instanceof build.PluginBuildError && /parts/.test(err.message), JSON.stringify(parts));
  }
  // lint juga berlaku untuk isi part
  const lintRun = buildExt(t, extManifest("demo-parts", { parts: ["a.js"] }), { "a.js": "localStorage.clear();\n" });
  assert.throws(lintRun, /lint/);
});

test("contributes: slot tidak di slots, pages kosong/asing, icon.path berisi '<' atau > 2048 byte, id view ganda → error", (t) => {
  const view = (o) => Object.assign({ id: "board", label: "Demo", icon: { path: "M2 4h12" }, pages: ["project"] }, o);
  const bad = [
    { slots: ["taskList.views"], contributes: { "taskDetail.sections": [{ id: "note", label: "x" }] } },
    { contributes: { "dashboard.widgets": [] } },
    { contributes: { "taskList.views": [view({ pages: [] })] } },
    { contributes: { "taskList.views": [view({ pages: ["inbox"] })] } },
    { contributes: { "taskList.views": [view({ icon: { path: "M2 4<script>" } })] } },
    { contributes: { "taskList.views": [view({ icon: { path: "M" + "1 ".repeat(1100) } })] } },
    { contributes: { "taskList.views": [view({ icon: null })] } },
    { contributes: { "taskList.views": [view(), view()] } },
    { contributes: { "taskList.views": [view({ id: "Board" })] } },
    { contributes: { "taskList.views": [view({ label: "" })] } },
    { contributes: { "taskList.views": [view({ label: "x".repeat(41) })] } },
    { contributes: { "taskDetail.sections": [{ id: "note", label: "x", order: "1" }] } },
    { contributes: [] },
  ];
  for (const extra of bad) {
    assert.throws(buildExt(t, extManifest("demo-contrib", extra)), /contributes/, JSON.stringify(extra).slice(0, 120));
  }
  assert.equal(build.validateContributes(extManifest("demo-contrib")), null);
  assert.equal(build.validateContributes(manifest("tanpa-contrib")), null);
  assert.equal(build.ICON_PATH_RE.test("M2 4h12M2 8h12M2 12h8"), true);
});

test("task.ext tanpa taskExt / taskExt tanpa izin task.ext / keys salah → error", (t) => {
  const bad = [
    { taskExt: undefined },
    { permissions: [], taskExt: { keys: ["note"] } },
    { taskExt: { keys: [] } },
    { taskExt: { keys: ["bad-key"] } },
    { taskExt: { keys: ["a", "a"] } },
    { taskExt: ["note"] },
  ];
  for (const extra of bad) {
    const man = extManifest("demo-tx", extra);
    if ("taskExt" in extra && extra.taskExt === undefined) delete man.taskExt;
    assert.throws(buildExt(t, man), /taskExt|task\.ext/, JSON.stringify(extra));
  }
  assert.equal(build.validateTaskExt(extManifest("demo-tx")), null);
});

test("habit-heatmap: index.json dan hash tidak berubah", (t) => {
  const d = tmpDir(t);
  const pdir = path.join(d, "plugins");
  fs.cpSync(PLUGINS, pdir, { recursive: true });
  const sw = path.join(d, "sw.js");
  fs.copyFileSync(SW, sw);
  const res = build.buildPlugins({ pluginsDir: pdir, swPath: sw, log: () => {} });
  const real = JSON.parse(fs.readFileSync(path.join(PLUGINS, "index.json"), "utf8"));
  const hh = res.index.plugins.find((p) => p.id === "habit-heatmap");
  assert.deepEqual(hh, real.plugins.find((p) => p.id === "habit-heatmap"));
  assert.ok(!("contributes" in hh) && !("taskExt" in hh));
});

// ── Fase 1 PR 1a-2 (rencana Task 7, R18/R23/R25): manifest.records + plugin contoh demo-records ───────────────
const DEMO_RECORDS = path.join(ROOT, "tests", "fixtures", "plugins", "demo-records");
const RECORDS_VECTORS = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "plugin_records_vectors.json"), "utf8"));
function recManifest(id, extra) {
  return manifest(id, Object.assign({
    slots: ["taskList.views"], permissions: ["records"], records: { note: { conflict: "lww", maxBytes: 4096 } },
  }, extra || {}));
}

test("fixture demo-records: records disalin ke index.json dan konstanta manifest", (t) => {
  const d = tmpDir(t);
  const pdir = path.join(d, "plugins");
  fs.cpSync(DEMO_RECORDS, path.join(pdir, "demo-records"), { recursive: true });
  const sw = path.join(d, "sw.js");
  fs.writeFileSync(sw, SW_STUB);
  const res = build.buildPlugins({ pluginsDir: pdir, swPath: sw, log: () => {} });
  const m = JSON.parse(fs.readFileSync(path.join(DEMO_RECORDS, "manifest.json"), "utf8"));
  assert.deepEqual(m.records, { note: { conflict: "lww", maxBytes: 4096 } });
  const entry = res.index.plugins.find((p) => p.id === "demo-records");
  assert.ok(entry);
  assert.deepEqual(entry.records, m.records);
  assert.deepEqual(entry.permissions, ["records"]);
  assert.deepEqual(entry.contributes, m.contributes);
  assert.equal(entry.taskExt, undefined);
  assert.deepEqual(entry.files, ["plugin.js"]);
  // sepakat dengan entri indeks fixture server (Task 1)
  const fxIndex = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "plugins", "index.json"), "utf8"));
  const fxEntry = fxIndex.plugins.find((p) => p.id === "demo-records");
  assert.deepEqual(fxEntry.records, entry.records);
  assert.deepEqual(fxEntry.permissions, entry.permissions);
  const js = fs.readFileSync(path.join(pdir, "demo-records", "plugin.js"), "utf8");
  const manAt = js.indexOf("const manifest = Object.freeze(");
  const manJson = JSON.parse(js.slice(manAt + "const manifest = Object.freeze(".length, js.indexOf(");\n", manAt)));
  assert.deepEqual(manJson.records, m.records);
  const vm = require("node:vm");
  const calls = [];
  const sandbox = { window: { TF: { plugins: { register: (mm, f) => calls.push([mm, f]) } } }, React: { createElement: () => null, useState: (v) => [v, () => {}], useEffect: () => {}, useCallback: (f) => f, useRef: (v) => ({ current: v }) } };
  sandbox.self = sandbox.window;
  vm.runInNewContext(js, sandbox);
  assert.equal(calls.length, 1);
  const inst = calls[0][1]({ records: {} });
  assert.equal(inst.slots["taskList.views"].map((v) => v.id).join(","), "recs");
  assert.deepEqual(build.buildPlugins({ pluginsDir: pdir, swPath: sw, log: () => {} }).written, []);
  assert.ok(!fs.existsSync(path.join(DEMO_RECORDS, "plugin.js")));
  assert.ok(!fs.existsSync(path.join(PLUGINS, "demo-records")));
});

test("vektor manifests: validateRecords sama dengan vektor bersama (null atau awalan alasan)", () => {
  assert.ok(RECORDS_VECTORS.manifests.length > 20);
  for (const v of RECORDS_VECTORS.manifests) {
    const m = { permissions: v.permissions };
    if (v.records !== null) m.records = v.records;
    const got = build.validateRecords(m);
    if (v.error === null) assert.equal(got, null, v.name);
    else assert.ok(typeof got === "string" && got.startsWith(v.error), v.name + ": " + got);
  }
});

test("vektor manifests: records salah (conflict merge/manual, nama entitas Bad, maxBytes 0/70000, records kosong) → PluginBuildError dengan alasan vektor", (t) => {
  const bad = RECORDS_VECTORS.manifests.filter((v) => v.error !== null);
  for (const name of ["conflict merge", "conflict manual", "nama huruf besar", "maxBytes 0", "maxBytes 70000", "records kosong + izin"]) {
    assert.ok(bad.some((v) => v.name === name), "vektor ada: " + name);
  }
  for (const v of bad) {
    const man = recManifest("demo-rv", { permissions: v.permissions });
    if (v.records === null) delete man.records; else man.records = v.records;
    assert.throws(buildExt(t, man), (e) => e instanceof build.PluginBuildError && e.message.includes("plugin demo-rv: " + v.error), v.name);
  }
  for (const v of RECORDS_VECTORS.manifests.filter((x) => x.error === null)) {
    const man = recManifest("demo-rv", { permissions: v.permissions });
    if (v.records === null) delete man.records; else man.records = v.records;
    const res = buildExt(t, man)();
    const entry = res.index.plugins[0];
    if (v.records === null) assert.ok(!("records" in entry), v.name); else assert.deepEqual(entry.records, v.records, v.name);
  }
});

test("izin records tanpa records / records tanpa izin records → error", (t) => {
  const noRec = recManifest("demo-nr"); delete noRec.records;
  assert.throws(buildExt(t, noRec), /izin records butuh manifest\.records/);
  assert.throws(buildExt(t, recManifest("demo-np", { permissions: [] })), /manifest\.records butuh izin records/);
  assert.throws(buildExt(t, recManifest("demo-np2", { permissions: ["storage"] })), /manifest\.records butuh izin records/);
  assert.equal(build.validateRecords(recManifest("demo-ok")), null);
  assert.equal(build.validateRecords(manifest("demo-none")), null);
  assert.ok(build.OPTIONAL_FIELDS.includes("records"));
});

test("habit-heatmap dan demo-ext: index.json dan hash tidak berubah", (t) => {
  const d = tmpDir(t);
  const pdir = path.join(d, "plugins");
  fs.cpSync(PLUGINS, pdir, { recursive: true });
  const sw = path.join(d, "sw.js");
  fs.copyFileSync(SW, sw);
  const real = JSON.parse(fs.readFileSync(path.join(PLUGINS, "index.json"), "utf8"));
  const res = build.buildPlugins({ pluginsDir: pdir, swPath: sw, log: () => {} });
  assert.deepEqual(res.index, real);
  const hh = res.index.plugins.find((p) => p.id === "habit-heatmap");
  assert.ok(!("records" in hh));
  // demo-ext dibangun terpisah: tidak ada field records
  const d2 = tmpDir(t);
  fs.cpSync(DEMO_EXT, path.join(d2, "plugins", "demo-ext"), { recursive: true });
  const sw2 = path.join(d2, "sw.js");
  fs.writeFileSync(sw2, SW_STUB);
  const e1 = build.buildPlugins({ pluginsDir: path.join(d2, "plugins"), swPath: sw2, log: () => {} }).index.plugins[0];
  assert.ok(!("records" in e1));
  assert.deepEqual(e1.taskExt, { keys: ["note", "after"] });
  assert.equal(e1.hash, hashOf(path.join(d2, "plugins"), e1));
});

// ── Fase 1 PR 1b (rencana Task 6, R2): plugin bawaan timeline ────────────────────────────────────────────────
const TIMELINE = path.join(PLUGINS, "timeline");
// R2 1c-1 (K44): holidays-id.js sebelum cpm.js (TLCpm memakai TLHolidays), cpm.js sebelum plan.js (TLPlan memakai TLCpm).
const TL_PARTS = ["holidays-id.js", "calendar.js", "schedule.js", "cpm.js", "plan.js", "layout.js", "drag.js"];
function copyTimeline(t) {
  const d = tmpDir(t);
  const pdir = path.join(d, "plugins");
  for (const f of [...TL_PARTS, "manifest.json", "plugin.jsx", "style.css"]) {
    fs.mkdirSync(path.join(pdir, "timeline"), { recursive: true });
    fs.copyFileSync(path.join(TIMELINE, f), path.join(pdir, "timeline", f));
  }
  const sw = path.join(d, "sw.js");
  fs.writeFileSync(sw, SW_STUB);
  return { pluginsDir: pdir, swPath: sw, log: () => {} };
}

test("timeline: parts digabung berurutan sebelum plugin.jsx, contributes + taskExt di index.json, lint lulus, hash stabil dua kali build", (t) => {
  const fx = copyTimeline(t);
  const m = JSON.parse(fs.readFileSync(path.join(TIMELINE, "manifest.json"), "utf8"));
  assert.deepEqual(m.parts, TL_PARTS);
  const r1 = build.buildPlugins(fx);
  const entry = r1.index.plugins.find((p) => p.id === "timeline");
  assert.ok(entry);
  assert.deepEqual(entry.contributes, m.contributes);
  assert.deepEqual(entry.taskExt, { keys: ["start", "duration", "deps", "mode", "constraint", "actual"] });
  assert.deepEqual(entry.records, { calendar: { conflict: "lww", maxBytes: 16384 }, project: { conflict: "lww", maxBytes: 1024 }, baseline: { conflict: "lww", maxBytes: 65536 } });
  assert.deepEqual(entry.permissions, ["storage", "task.ext", "records"]);
  assert.equal(entry.defaultEnabled, false);
  assert.equal(entry.parts, undefined, "parts tidak disalin ke index.json");
  assert.deepEqual(entry.files, ["plugin.js", "style.css"]);
  const js = fs.readFileSync(path.join(fx.pluginsDir, "timeline", "plugin.js"), "utf8");
  let at = js.indexOf("const manifest = Object.freeze(");
  assert.ok(at > 0);
  for (const p of TL_PARTS) {
    const i = js.indexOf("// part: " + p + "\n");
    assert.ok(i > at, p + " berurutan setelah part sebelumnya");
    at = i;
  }
  assert.ok(js.indexOf("function calendarStore(", at) > at, "kode plugin.jsx sesudah semua part");
  assert.equal(build.lintPlugin(js, entry), null);
  const hash1 = entry.hash;
  const sw1 = fs.readFileSync(fx.swPath, "utf8");
  const r2 = build.buildPlugins(fx);
  assert.equal(r2.written.length, 0, "build kedua tidak menulis apa pun");
  assert.equal(r2.index.plugins[0].hash, hash1);
  assert.equal(fs.readFileSync(fx.swPath, "utf8"), sw1);
  assert.ok(sw1.includes("/static/plugins/timeline/plugin.js?v=" + hash1));
  // hasil build di repo tidak basi: sama dengan build baru dari sumber
  assert.equal(js, fs.readFileSync(path.join(TIMELINE, "plugin.js"), "utf8"));
  const real = JSON.parse(fs.readFileSync(path.join(PLUGINS, "index.json"), "utf8"));
  assert.deepEqual(real.plugins.find((p) => p.id === "timeline"), entry);
});

// ── Fase 1 PR 1c-1 (rencana Task 6, R2, R6): Timeline 1.1.0 — mesin jadwal otomatis + record `project` ────────────
// 1c-2 Task 4: 1.2.0 — records.baseline {lww, 65536} (K41) + kunci taskExt `actual` (enam); bagian 1.1 dipertahankan.
test("timeline 1.2.0: parts urutan R2, records.project {lww, 1024} + records.baseline {lww, 65536}, taskExt.keys enam kunci (+actual), hash berubah, build dua kali stabil", (t) => {
  const m = JSON.parse(fs.readFileSync(path.join(TIMELINE, "manifest.json"), "utf8"));
  assert.equal(m.version, "1.2.0");
  assert.equal(m.minApi, 1);
  assert.equal(m.defaultEnabled, false);
  assert.deepEqual(m.parts, ["holidays-id.js", "calendar.js", "schedule.js", "cpm.js", "plan.js", "layout.js", "drag.js"]);
  assert.ok(m.parts.indexOf("holidays-id.js") < m.parts.indexOf("cpm.js"), "TLHolidays sebelum TLCpm");
  assert.ok(m.parts.indexOf("cpm.js") < m.parts.indexOf("plan.js"), "TLCpm sebelum TLPlan");
  assert.deepEqual(m.records, { calendar: { conflict: "lww", maxBytes: 16384 }, project: { conflict: "lww", maxBytes: 1024 }, baseline: { conflict: "lww", maxBytes: 65536 } });
  assert.deepEqual(Object.keys(m.records), ["calendar", "project", "baseline"]);
  assert.deepEqual(m.taskExt, { keys: ["start", "duration", "deps", "mode", "constraint", "actual"] });
  assert.deepEqual(m.permissions, ["storage", "task.ext", "records"], "izin tidak berubah");
  assert.deepEqual(m.slots, ["taskList.views", "taskDetail.sections"], "slot tidak berubah");
  const fx = copyTimeline(t);
  const r1 = build.buildPlugins(fx);
  const entry = r1.index.plugins.find((p) => p.id === "timeline");
  assert.equal(entry.version, "1.2.0");
  assert.deepEqual(entry.records, m.records);
  assert.deepEqual(entry.taskExt, m.taskExt);
  const js = fs.readFileSync(path.join(fx.pluginsDir, "timeline", "plugin.js"), "utf8");
  for (const p of ["cpm.js", "plan.js"]) assert.ok(js.includes("// part: " + p + "\n"), p + " ikut dibundel");
  assert.ok(js.indexOf("const TLCpm = (function") < js.indexOf("const TLPlan = (function"), "TLCpm didefinisikan sebelum TLPlan");
  assert.equal(build.lintPlugin(js, entry), null);
  // hash berubah: build yang sama dengan manifest 1.1.0 (tanpa baseline/actual) dan 1.0.0 (tanpa part mesin)
  // menghasilkan hash lain → cache SW pasti diganti
  const v11 = copyTimeline(t);
  fs.writeFileSync(path.join(v11.pluginsDir, "timeline", "manifest.json"), JSON.stringify(Object.assign({}, m, {
    version: "1.1.0", records: { calendar: m.records.calendar, project: m.records.project }, taskExt: { keys: ["start", "duration", "deps", "mode", "constraint"] },
  })));
  assert.notEqual(entry.hash, build.buildPlugins(v11).index.plugins.find((p) => p.id === "timeline").hash);
  const old = copyTimeline(t);
  const mf = path.join(old.pluginsDir, "timeline", "manifest.json");
  fs.writeFileSync(mf, JSON.stringify(Object.assign({}, m, {
    version: "1.0.0", parts: ["holidays-id.js", "calendar.js", "schedule.js", "layout.js", "drag.js"],
    records: { calendar: m.records.calendar }, taskExt: { keys: ["start", "duration", "deps"] },
  })));
  const oldHash = build.buildPlugins(old).index.plugins.find((p) => p.id === "timeline").hash;
  assert.notEqual(entry.hash, oldHash);
  // build dua kali stabil
  const sw1 = fs.readFileSync(fx.swPath, "utf8");
  const r2 = build.buildPlugins(fx);
  assert.equal(r2.written.length, 0, "build kedua tidak menulis apa pun");
  assert.equal(r2.index.plugins.find((p) => p.id === "timeline").hash, entry.hash);
  assert.equal(fs.readFileSync(fx.swPath, "utf8"), sw1);
  // artefak di repo = build baru dari sumber
  assert.equal(js, fs.readFileSync(path.join(TIMELINE, "plugin.js"), "utf8"));
  const real = JSON.parse(fs.readFileSync(path.join(PLUGINS, "index.json"), "utf8"));
  assert.deepEqual(real.plugins.find((p) => p.id === "timeline"), entry);
});

test("cpm.js dan plan.js bisa di-require sendiri", () => {
  const probe = {
    "cpm.js": "typeof m.run === 'function' && typeof m.explain === 'function' && typeof m.cmpKey === 'function' && Object.isFrozen(m)",
    "plan.js": "typeof m.diff === 'function' && typeof m.cascade === 'function' && typeof m.toggleUnit === 'function' && Object.isFrozen(m)",
  };
  for (const p of Object.keys(probe)) {
    const r = spawnSync(process.execPath, ["-e", "const m = require(process.argv[1]); if (!(" + probe[p] + ")) process.exit(2);", path.join(TIMELINE, p)], { encoding: "utf8" });
    assert.equal(r.status, 0, p + ": " + r.stderr);
  }
  // bundel mengekspor keduanya (R2: {TLHolidays, TLCal, TLSched, TLCpm, TLPlan, TLLayout, TLDrag})
  const P = require(path.join(TIMELINE, "plugin.js"));
  assert.equal(typeof P.TLCpm.run, "function");
  assert.equal(typeof P.TLPlan.cascade, "function");
});

test("plugin.js timeline bisa di-require Node dan mengekspor TLCal/TLSched/TLLayout/TLDrag/TLHolidays", () => {
  const P = require(path.join(TIMELINE, "plugin.js"));
  for (const k of ["TLCal", "TLSched", "TLLayout", "TLDrag", "TLHolidays", "calendarStore"]) assert.ok(P[k], k);
  assert.equal(typeof P.TLCal.addWork, "function");
  assert.equal(typeof P.TLSched.readSched, "function");
  assert.equal(typeof P.TLLayout.layout, "function");
  assert.equal(typeof P.TLDrag.reduce, "function");
  assert.ok(P.TLHolidays.DATA[2026]);
});

test("setiap part bisa di-require sendiri (proses terpisah, urutan bebas)", () => {
  for (const p of TL_PARTS) {
    const r = spawnSync(process.execPath, ["-e", "const m = require(process.argv[1]); if (!m || typeof m !== 'object') process.exit(2);", path.join(TIMELINE, p)], { encoding: "utf8" });
    assert.equal(r.status, 0, p + ": " + r.stderr);
  }
});

test("tanpa window.__ / self.__ global di parts dan plugin.jsx", () => {
  for (const f of [...TL_PARTS, "plugin.jsx"]) {
    const src = fs.readFileSync(path.join(TIMELINE, f), "utf8");
    assert.doesNotMatch(src, /\b(?:window|self|globalThis)\s*\.\s*__/, f);
    assert.doesNotMatch(src, /\b(?:window|self|globalThis)\s*\[\s*["']__/, f);
  }
});
