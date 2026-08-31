"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const out = path.join(root, "dist-tauri");

test("build-tauri-dist assembles the web server layout", () => {
  execFileSync(process.execPath, [path.join(root, "scripts", "build-tauri-dist.js")], { stdio: "ignore" });
  for (const f of ["index.html", "sw.js", "manifest.json", "config.js"]) {
    assert.ok(fs.existsSync(path.join(out, f)), "missing root file " + f);
  }
  assert.ok(fs.existsSync(path.join(out, "static", "offline", "db.js")), "missing static/offline/db.js");
  assert.ok(fs.existsSync(path.join(out, "static", "index.html")), "missing static/index.html");
});

test("tauri.conf.json configures linux deb and appimage packaging", () => {
  const confPath = path.join(root, "src-tauri", "tauri.conf.json");
  assert.ok(fs.existsSync(confPath), "src-tauri/tauri.conf.json must exist");
  const raw = fs.readFileSync(confPath, "utf8");
  const conf = JSON.parse(raw);

  assert.ok(conf.bundle, "bundle config must exist");
  assert.ok(Array.isArray(conf.bundle.targets), "bundle.targets must be an array");
  assert.ok(conf.bundle.targets.includes("deb"), "bundle.targets must include deb");
  assert.ok(conf.bundle.targets.includes("appimage"), "bundle.targets must include appimage");

  assert.ok(conf.bundle.linux, "bundle.linux must be defined");
  assert.ok(conf.bundle.linux.deb, "bundle.linux.deb must be defined");
  assert.ok(Array.isArray(conf.bundle.linux.deb.depends), "bundle.linux.deb.depends must be an array");

  const expectedDepends = [
    "libwebkit2gtk-4.1-0 | libwebkit2gtk-4.0-37",
    "libgtk-3-0",
    "libayatana-appindicator3-1"
  ];
  for (const dep of expectedDepends) {
    assert.ok(conf.bundle.linux.deb.depends.includes(dep), `missing dependency in deb config: ${dep}`);
  }
  assert.equal(conf.bundle.linux.deb.section, "utils");
  assert.equal(conf.bundle.linux.deb.priority, "optional");
});

test("github workflow builds and uploads both appimage and deb", () => {
  const workflowPath = path.join(root, ".github", "workflows", "appimage.yml");
  assert.ok(fs.existsSync(workflowPath), ".github/workflows/appimage.yml must exist");
  const content = fs.readFileSync(workflowPath, "utf8");

  assert.match(content, /--bundles\s+appimage,deb/, "workflow must invoke tauri build with --bundles appimage,deb");
  assert.match(content, /bundle\/appimage\/\*\.AppImage/, "workflow must upload AppImage bundle");
  assert.match(content, /bundle\/deb\/\*\.deb/, "workflow must upload deb bundle");
  assert.match(content, /name:\s*taskflow-linux-deb/, "workflow must have artifact name for deb");
  assert.match(content, /name:\s*taskflow-linux-appimage/, "workflow must have artifact name for appimage");
});

