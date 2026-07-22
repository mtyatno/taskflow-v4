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

// Inject AI feature flag for Tauri/APK builds (mirrors webapp.py serve_config).
// APK users are server admins — enable by default so /ai slash command and
// Settings toggle are visible. If AI is not configured on the server, the
// API call will fail gracefully with an error message.
const configPath = path.join(out, "config.js");
const aiFlag = process.env.AI_FEATURES_ENABLED !== "false" ? "true" : "false";
fs.appendFileSync(configPath, `\ntry { window.__AI_ENABLED = ${aiFlag}; } catch (e) {}\n`);

console.log("assembled dist-tauri/ from static/");
