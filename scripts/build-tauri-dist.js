#!/usr/bin/env node
/**
 * Assemble the Tauri frontendDist (dist-tauri/) mirroring how the web server serves files:
 *   /                -> static/index.html
 *   /sw.js           -> static/sw.js
 *   /manifest.json   -> static/manifest.json
 *   /config.js       -> static/config.js
 *   /static/*        -> static/*
 * Run AFTER the tldraw vendor build (so static/vendor/tldraw exists when copied).
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const staticDir = path.join(root, "static");
const out = path.join(root, "dist-tauri");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// /static/* -> dist-tauri/static/*
fs.cpSync(staticDir, path.join(out, "static"), { recursive: true });

// root-served files -> dist-tauri root
for (const f of ["index.html", "sw.js", "manifest.json", "config.js"]) {
  fs.copyFileSync(path.join(staticDir, f), path.join(out, f));
}

console.log("assembled dist-tauri/ from static/");
