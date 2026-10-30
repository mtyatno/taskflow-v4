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
