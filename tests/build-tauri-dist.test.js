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
