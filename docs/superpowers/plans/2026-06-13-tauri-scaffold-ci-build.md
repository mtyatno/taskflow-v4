# Tauri Scaffold + CI Build (#3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold a Tauri v2 desktop app that bundles the assembled frontend and a GitHub Actions workflow that builds a Windows `.exe` (NSIS) on `windows-latest` — producing the first launchable desktop build.

**Architecture:** `static/config.js` sets `window.__API_BASE` from the hostname (web → `""`, Tauri webview → VPS). A Node script assembles `dist-tauri/` mirroring the web server layout (root `index.html`/`sw.js`/`manifest.json`/`config.js` + `static/` subdir). Standard Tauri v2 `src-tauri/` (no custom Rust) bundles `dist-tauri/`. A `workflow_dispatch`/tag-triggered workflow builds the tldraw vendor, assembles `dist-tauri`, and runs `tauri-action`.

**Tech Stack:** Tauri v2 (Rust, built in CI only — no local toolchain), GitHub Actions, Node, vanilla JS.

**Reference spec:** `docs/superpowers/specs/2026-06-13-tauri-scaffold-ci-build-design.md`

**Baseline before starting:** `node --test tests/offline/*.test.js` → `pass 350`.

**Critical context (verified):**
- Web serving (`webapp.py`): `GET /` → `static/index.html`; `GET /sw.js` → `static/sw.js`; `GET /manifest.json` → `static/manifest.json`; `app.mount("/static", static/)`. `index.html` references vendor/offline as `/static/...` and root files as `/sw.js`, `/manifest.json`. Only non-`/static` root ref in index.html is `/manifest.json`; manifest icons are all `/static/icon-*.png`.
- `static/index.html` is committed already-compiled plain JS (inline `<script>` blocks, not `<script type="text/babel">`). `compile.js` is a no-op on it.
- `static/vendor/tldraw/` is **gitignored** — built by `cd draw-app && npx vite build`. Must exist before assembling `dist-tauri`.
- Root `package.json` exists (`taskflow-compile`); `npm test` = `node --test "tests/offline/*.test.js"`.
- **No local Rust** — the Tauri scaffold + workflow are authored against the v2 schema and validated by CI; this session verifies only the Node-testable scripts, JSON/TOML/YAML validity, and the unchanged offline suite.

---

### Task 1: `static/config.js` — origin → `window.__API_BASE`

**Files:**
- Create: `static/config.js`
- Modify: `static/index.html` (add the `<script>` tag)
- Modify: `static/sw.js` (bump version + precache `/config.js`)
- Test: `tests/offline/config.test.js`

- [ ] **Step 1: Write the failing test** — create `tests/offline/config.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resolveApiBase } = require("../../static/config.js");

test("web hosts resolve to empty base (same-origin)", () => {
  assert.equal(resolveApiBase("todo.yatno.web.id"), "");
  assert.equal(resolveApiBase("localhost"), "");
  assert.equal(resolveApiBase("127.0.0.1"), "");
});

test("non-web hosts (Tauri webview) resolve to the VPS base", () => {
  assert.equal(resolveApiBase("tauri.localhost"), "https://todo.yatno.web.id");
  assert.equal(resolveApiBase(""), "https://todo.yatno.web.id");
  assert.equal(resolveApiBase("anything-else"), "https://todo.yatno.web.id");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/config.test.js`
Expected: FAIL — `Cannot find module '../../static/config.js'`.

- [ ] **Step 3: Create `static/config.js`**

```js
function resolveApiBase(host) {
  // The web app is served from these hosts (same-origin → no base). Anything else
  // (the bundled Tauri webview at tauri.localhost / tauri://) targets the VPS.
  var WEB_HOSTS = ["todo.yatno.web.id", "localhost", "127.0.0.1"];
  return WEB_HOSTS.indexOf(host) === -1 ? "https://todo.yatno.web.id" : "";
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { resolveApiBase };
} else {
  try { window.__API_BASE = resolveApiBase(location.hostname || ""); } catch (e) {}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/config.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Load `config.js` in `index.html` before the app script**

In `static/index.html`, find the first vendor script tag `  <script src="/static/vendor/react.production.min.js"></script>` and insert IMMEDIATELY BEFORE it:

```html
  <script src="/config.js"></script>
```

(`config.js` must run before the main inline app script — which reads `window.__API_BASE` into `const API_BASE` — so loading it before everything in `<head>` guarantees ordering. It is a same-origin root asset; do NOT wrap it with `apiUrl`.)

- [ ] **Step 6: Bump SW + precache config.js**

In `static/sw.js`, change line 1 to:
```js
const CACHE = "taskflow-v137-tauri-config";
```
Add `"/config.js",` to the STATIC precache array (near the other root entries like `"/sw.js"` if present, or alongside `"/manifest.json"`; if neither is in the list, add it near the top of the precache array).

- [ ] **Step 7: Verify**

Run the full suite: `node --test tests/offline/*.test.js`
Expected: `pass 352` (350 + 2), `fail 0`.

Confirm wiring:
```
node -e "const s=require('fs').readFileSync('static/index.html','utf8'); console.log('cfg-tag:', /<script src=\"\/config\.js\"><\/script>/.test(s)); const sw=require('fs').readFileSync('static/sw.js','utf8'); console.log('v137:', /taskflow-v137-tauri-config/.test(sw), 'precache:', /\/config\.js/.test(sw));"
```
Expected: `cfg-tag: true` then `v137: true precache: true`.

Inline-script parse:
```
node -e "const s=require('fs').readFileSync('static/index.html','utf8'); const m=s.match(/<script>[\s\S]*?<\/script>/g)||[]; let bad=0; for(const b of m){try{new Function(b.replace(/^<script>/,'').replace(/<\/script>$/,''));}catch(e){bad++;}} console.log('parse errors:', bad);"
```
Expected: `parse errors: 0`

- [ ] **Step 8: Commit**

```bash
git add static/config.js static/index.html static/sw.js tests/offline/config.test.js
git commit -m "feat(tauri): config.js sets __API_BASE by origin + SW v137 (#3b)"
```

---

### Task 2: `scripts/build-tauri-dist.js` — assemble the bundled frontend

**Files:**
- Create: `scripts/build-tauri-dist.js`
- Modify: `.gitignore`
- Test: `tests/build-tauri-dist.test.js`

- [ ] **Step 1: Write the failing test** — create `tests/build-tauri-dist.test.js`:

```js
"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const out = path.join(root, "dist-tauri");

test("build-tauri-dist assembles the web server layout", () => {
  execFileSync(process.execPath, [path.join(root, "scripts", "build-tauri-dist.js")], { stdio: "ignore" });
  // root-served files at dist-tauri root
  for (const f of ["index.html", "sw.js", "manifest.json", "config.js"]) {
    assert.ok(fs.existsSync(path.join(out, f)), "missing root file " + f);
  }
  // /static/* present under dist-tauri/static
  assert.ok(fs.existsSync(path.join(out, "static", "offline", "db.js")), "missing static/offline/db.js");
  assert.ok(fs.existsSync(path.join(out, "static", "index.html")), "missing static/index.html");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/build-tauri-dist.test.js`
Expected: FAIL — script not found / dist-tauri not assembled.

- [ ] **Step 3: Create `scripts/build-tauri-dist.js`**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/build-tauri-dist.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: gitignore `dist-tauri/`**

In `.gitignore`, add a line (near `dist/`):
```
dist-tauri/
```

- [ ] **Step 6: Verify the assembled layout + full suite**

Run: `node scripts/build-tauri-dist.js && node -e "const fs=require('fs'); console.log('root:', ['index.html','sw.js','manifest.json','config.js'].every(f=>fs.existsSync('dist-tauri/'+f)), 'static:', fs.existsSync('dist-tauri/static/offline/db.js'));"`
Expected: `assembled dist-tauri/ from static/` then `root: true static: true`

Run: `node --test tests/offline/*.test.js`
Expected: `pass 352`, `fail 0` (Task 1's tests; this task's test is in `tests/` not `tests/offline/`, run separately above).

- [ ] **Step 7: Commit**

```bash
git add scripts/build-tauri-dist.js tests/build-tauri-dist.test.js .gitignore
git commit -m "feat(tauri): assemble dist-tauri frontend mirroring web server layout (#3b)"
```

---

### Task 3: `src-tauri/` scaffold + icons + root devDependency

**Files:**
- Create: `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`, `src-tauri/tauri.conf.json`, `src-tauri/icons/*` (generated)
- Modify: `package.json` (add `@tauri-apps/cli` devDep), `.gitignore`

This task has no Node unit test (config files + Rust boilerplate). Verification is JSON/TOML validity + icon generation + the eventual CI build.

- [ ] **Step 1: Create `src-tauri/Cargo.toml`**

```toml
[package]
name = "taskflow"
version = "4.0.0"
description = "TaskFlow V4 desktop app"
authors = ["yatno"]
edition = "2021"

[lib]
name = "taskflow_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

- [ ] **Step 2: Create `src-tauri/build.rs`**

```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 3: Create `src-tauri/src/lib.rs`**

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: Create `src-tauri/src/main.rs`**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    taskflow_lib::run()
}
```

- [ ] **Step 5: Create `src-tauri/capabilities/default.json`**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability for the main window",
  "windows": ["main"],
  "permissions": ["core:default"]
}
```

- [ ] **Step 6: Create `src-tauri/tauri.conf.json`**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "TaskFlow",
  "version": "4.0.0",
  "identifier": "id.web.yatno.taskflow",
  "build": {
    "frontendDist": "../dist-tauri"
  },
  "app": {
    "windows": [
      {
        "title": "TaskFlow",
        "label": "main",
        "width": 1280,
        "height": 800,
        "resizable": true
      }
    ],
    "security": {
      "csp": "default-src 'self'; connect-src 'self' https://todo.yatno.web.id; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; frame-src 'self'; worker-src 'self' blob:; media-src 'self' blob:"
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

- [ ] **Step 7: Add `@tauri-apps/cli` to root `package.json` devDependencies**

In `package.json`, add to `devDependencies` (alongside `fake-indexeddb`):
```json
    "@tauri-apps/cli": "^2"
```

- [ ] **Step 8: Generate the icon set**

Install the CLI and generate icons from the 512px app icon (the `icon` subcommand is pure JS — no Rust needed):
```bash
npm install
npx tauri icon static/icon-512.png --output src-tauri/icons
```
Expected: creates `src-tauri/icons/` with `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.ico`, `icon.icns`, and Square*.png variants. (If `--output` is unsupported on the installed CLI version, run `npx tauri icon static/icon-512.png` from a temp setup and copy the generated `src-tauri/icons` — but the default output IS `src-tauri/icons`, so plain `npx tauri icon static/icon-512.png` works and writes there.)

Verify the icons referenced by `tauri.conf.json` exist:
```
node -e "const fs=require('fs'); console.log(['32x32.png','128x128.png','128x128@2x.png','icon.icns','icon.ico'].every(f=>fs.existsSync('src-tauri/icons/'+f)));"
```
Expected: `true`

- [ ] **Step 9: gitignore Tauri build output**

In `.gitignore`, add:
```
src-tauri/target/
src-tauri/gen/
```

- [ ] **Step 10: Verify config validity**

JSON files parse:
```
node -e "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json','utf8')); JSON.parse(require('fs').readFileSync('src-tauri/capabilities/default.json','utf8')); console.log('json ok');"
```
Expected: `json ok`

Cargo.toml parses as TOML (Python 3.11+ has `tomllib`):
```
python -c "import tomllib; tomllib.load(open('src-tauri/Cargo.toml','rb')); print('toml ok')"
```
Expected: `toml ok` (if `tomllib` is unavailable, eyeball the TOML — it is standard).

Offline suite still green: `node --test tests/offline/*.test.js` → `pass 352`, `fail 0`.

- [ ] **Step 11: Commit**

```bash
git add src-tauri/ package.json package-lock.json .gitignore
git commit -m "feat(tauri): scaffold Tauri v2 src-tauri (config, Rust shell, icons, capabilities) (#3b)"
```
(Note: `package-lock.json` may be regenerated by `npm install`; include it if changed. Do NOT commit `node_modules/`.)

---

### Task 4: `.github/workflows/tauri.yml` — CI build (Windows)

**Files:**
- Create: `.github/workflows/tauri.yml`

- [ ] **Step 1: Create the workflow**

```yaml
name: Build Tauri Desktop (Windows)
on:
  workflow_dispatch:
  push:
    tags: ["v*"]
jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Install root deps (provides @tauri-apps/cli)
        run: npm install
      - name: Pre-compile JSX (no-op if already compiled)
        run: node compile.js
      - name: Build tldraw vendor (draw-app -> static/vendor/tldraw)
        run: cd draw-app && npm ci && npx vite build
      - name: Assemble Tauri frontend (dist-tauri)
        run: node scripts/build-tauri-dist.js
      - uses: dtolnay/rust-toolchain@stable
      - name: Build Tauri app
        uses: tauri-apps/tauri-action@v0
        with:
          projectPath: "."
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Upload installer artifact
        uses: actions/upload-artifact@v4
        with:
          name: taskflow-windows-exe
          path: src-tauri/target/release/bundle/nsis/*.exe
          if-no-files-found: error
```

- [ ] **Step 2: Verify the YAML is well-formed**

```
python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/tauri.yml')); print('yaml ok')"
```
Expected: `yaml ok` (if PyYAML is unavailable, verify structure by eye — indentation must be 2-space, `on:` has `workflow_dispatch:` + `push.tags`, the job runs the 8 steps in order: checkout → setup-node → npm install → compile.js → draw-app build → assemble dist-tauri → rust-toolchain → tauri-action → upload-artifact).

Confirm the build-order invariants by eye: `node scripts/build-tauri-dist.js` runs AFTER the draw-app `vite build` (so `static/vendor/tldraw/` exists) and BEFORE `tauri-action` (so `dist-tauri/` exists for `frontendDist`).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/tauri.yml
git commit -m "ci(tauri): GitHub Actions workflow to build the Windows .exe (#3b)"
```

---

## Acceptance (user, via CI — outside this session)

After merge, the user:
1. Opens GitHub → Actions → **Build Tauri Desktop (Windows)** → Run workflow (or pushes a `v*` tag).
2. Waits for the build; the first run may surface Tauri/Rust config errors (no local toolchain pre-validated them) — iterate from the Actions log.
3. On green: downloads the `taskflow-windows-exe` artifact, installs/runs the `.exe`; the app window opens, loads TaskFlow, logs in, and syncs to the VPS (validating `__API_BASE` + CORS end-to-end). Offline data works; chat history loads; chat **realtime** is the known gap (→ #3b-2). Unsigned `.exe` → a SmartScreen warning on first run (→ #3c signing).

---

## Self-Review Notes (addressed)

- **Spec coverage:** §1 config.js + index.html tag + SW → Task 1; §2 src-tauri scaffold (Cargo/build/main/lib/capabilities/conf), the `dist-tauri` assembly + frontendDist, icons, root devDep, gitignore → Tasks 2 + 3; §3 workflow → Task 4; §4 verification → each task's verify step; §5 known gaps documented.
- **Layout correctness:** the brainstorm-era `frontendDist: "../static"` was corrected to an assembled `../dist-tauri` (Task 2) because `index.html` references `/static/vendor/...` + root `/sw.js`,`/manifest.json`,`/config.js`; the assembly mirrors the web server's path map exactly. The CI step order (vendor build → assemble → tauri build) is asserted in Task 4 Step 2.
- **No-local-Rust reality:** Tasks 3-4 are config authoring; their "tests" are JSON/TOML/YAML validity + icon presence. Tasks 1-2 are genuinely Node-tested (`resolveApiBase`, the assembly layout). The real acceptance is the CI build + the user running the `.exe`.
- **Consistency:** `frontendDist` (`../dist-tauri`), the 4 root-served files, the `taskflow_lib` lib name (referenced in `main.rs`), the `nsis` target + its output path (`src-tauri/target/release/bundle/nsis/*.exe`) used in the workflow upload — all consistent across tasks.
- **Expected suite count:** 352 (350 + 2 config.js tests). The `build-tauri-dist` test lives in `tests/` (not `tests/offline/`) so it's run explicitly, not via the `tests/offline/*.test.js` glob.
