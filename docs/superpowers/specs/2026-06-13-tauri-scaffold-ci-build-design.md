# Design Spec: Tauri Scaffold + CI Build (#3b)

**Date:** 2026-06-13
**Status:** Approved
**Slice:** #3b of #3 (Tauri desktop shell), after #3a (remote-API ready). Produces the first launchable Windows `.exe`. Built in GitHub Actions (no local Rust). Realtime chat SSE auth is deferred to #3b-2.

---

## Overview

Wrap the existing PWA into a **Tauri v2 desktop app** that bundles the local frontend assets (`static/`), loads them from the Tauri webview, and talks to the VPS API. The webview origin is not the VPS, so the app relies on #3a's `API_BASE` indirection — set here by a small **origin-based `config.js`** (not a Rust init script, to keep the Rust side standard boilerplate and the logic testable). The `.exe` (NSIS installer) is built on a GitHub-hosted Windows runner via `tauri-action`; **there is no local Rust toolchain**, so the scaffold is authored against the Tauri v2 schema and validated by the CI build.

### Locked decisions
- **Build:** GitHub Actions (`windows-latest`, `tauri-action`), triggered manually (`workflow_dispatch`) or on `v*` tags. Not on every push.
- **Frontend loading:** bundle `static/` (`frontendDist: "../static"`); IndexedDB source of truth, sync to VPS.
- **`API_BASE` injection:** `static/config.js` sets `window.__API_BASE` from `location.hostname` (web hosts → `""`; anything else, i.e. the Tauri webview → the VPS URL).
- **Platform:** Windows `.exe` first (NSIS). Linux AppImage later.
- **SSE realtime chat:** deferred to #3b-2 (cross-origin `EventSource` can't send the `Authorization` header). Chat history still works offline from cache; only realtime push is affected in the desktop app.

### Out of scope
- Auto-update / code signing (→ #3c).
- Linux/macOS/Android targets.
- SSE cross-origin auth (→ #3b-2).
- BlobStore → filesystem (attachments are #2f-4, unbuilt).

---

## 1. `static/config.js` — origin → `window.__API_BASE`

A tiny script loaded in BOTH web and Tauri (shared `static/`), before the main app script. It decides the API base from the hostname.

```js
function resolveApiBase(host) {
  // The web app is served from these hosts (same-origin → no base). Anything else
  // (the bundled Tauri webview at tauri.localhost / tauri://) targets the VPS.
  const WEB_HOSTS = ["todo.yatno.web.id", "localhost", "127.0.0.1"];
  return WEB_HOSTS.indexOf(host) === -1 ? "https://todo.yatno.web.id" : "";
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { resolveApiBase };
} else {
  try { window.__API_BASE = resolveApiBase(location.hostname || ""); } catch (e) {}
}
```

- **Web** (`todo.yatno.web.id`, or `localhost`/`127.0.0.1` during dev) → `resolveApiBase` returns `""` → `window.__API_BASE = ""` → #3a's `API_BASE === ""` → byte-identical to today. **No web behavior change.**
- **Tauri** (`tauri.localhost` on Windows / `tauri://localhost` elsewhere) → not a web host → `window.__API_BASE = "https://todo.yatno.web.id"` → all `/api` calls (via #3a's `apiUrl()`) hit the VPS.
- The UMD-style export makes `resolveApiBase` unit-testable under Node.

In `static/index.html`, add `<script src="/config.js"></script>` **before** the main inline app `<script>` (so `window.__API_BASE` is set before `const API_BASE = window.__API_BASE || ""` reads it). It is a same-origin relative URL in both contexts (do not wrap with `apiUrl` — it's a static asset, not `/api`). Bump SW (`static/sw.js`) to **v137** and add `/config.js` to the precache list.

---

## 2. `src-tauri/` — Tauri v2 scaffold

Standard Tauri v2 layout at the repo root. The Rust is the generated boilerplate (no custom logic — `config.js` handles `API_BASE`, so the shell just loads the bundled frontend).

- **`src-tauri/Cargo.toml`** — `[package]` (name `taskflow`, version `4.0.0`, edition 2021); `[lib]` (name `taskflow_lib`, crate-type `["staticlib", "cdylib", "rlib"]`); `[build-dependencies] tauri-build = { version = "2", features = [] }`; `[dependencies] tauri = { version = "2", features = [] }`, `serde = { version = "1", features = ["derive"] }`, `serde_json = "1"`.
- **`src-tauri/build.rs`** — `fn main() { tauri_build::build() }`.
- **`src-tauri/src/main.rs`** — `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` + `fn main() { taskflow_lib::run() }`.
- **`src-tauri/src/lib.rs`** — `pub fn run() { tauri::Builder::default().run(tauri::generate_context!()).expect("error while running tauri application"); }`.
- **`src-tauri/capabilities/default.json`** — Tauri v2 permissions: `{ "$schema": "../gen/schemas/desktop-schema.json", "identifier": "default", "description": "default capability", "windows": ["main"], "permissions": ["core:default"] }`.
- **`src-tauri/tauri.conf.json`**:
  ```json
  {
    "$schema": "https://schema.tauri.app/config/2",
    "productName": "TaskFlow",
    "version": "4.0.0",
    "identifier": "id.web.yatno.taskflow",
    "build": { "frontendDist": "../static" },
    "app": {
      "windows": [
        { "title": "TaskFlow", "label": "main", "width": 1280, "height": 800, "resizable": true }
      ],
      "security": {
        "csp": "default-src 'self'; connect-src 'self' https://todo.yatno.web.id; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; frame-src 'self'; worker-src 'self' blob:; media-src 'self' blob:"
      }
    },
    "bundle": {
      "active": true,
      "targets": ["nsis"],
      "icon": ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico"]
    }
  }
  ```
  - `frontendDist: "../static"` bundles the committed `static/` (relative to `src-tauri/`).
  - CSP is permissive by necessity: the app uses large inline scripts (`'unsafe-inline'`/`'unsafe-eval'`), wasm (`'wasm-unsafe-eval'`, e.g. tldraw), local vendor iframes (`frame-src 'self'`: mind-elixir, tldraw), the service worker + web workers (`worker-src`), remote avatar images (`img-src https:`), and must reach the VPS for fetch + SSE (`connect-src ... https://todo.yatno.web.id`).
  - `bundle.targets: ["nsis"]` → a Windows `.exe` installer at `src-tauri/target/release/bundle/nsis/*.exe`.

- **Icons** (`src-tauri/icons/`): generated by `npx @tauri-apps/cli icon static/icon-512.png` (the `icon` subcommand is pure JS — no Rust needed) and committed. Produces `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.ico`, `icon.icns`, etc.

- **Root `package.json`:** add `@tauri-apps/cli` (v2) to `devDependencies` so the CI `npm install` provides the `tauri` CLI that `tauri-action` invokes.

- **`.gitignore`:** add `src-tauri/target/` and `src-tauri/gen/` (build output / generated schemas).

---

## 3. `.github/workflows/tauri.yml` — CI build (Windows)

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
      - name: Build tldraw vendor (draw-app → static/vendor/tldraw)
        run: cd draw-app && npm ci && npx vite build
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

- Mirrors `deploy.yml`'s frontend prep: `node compile.js` (no-op if already compiled) + the **draw-app vite build** that populates the gitignored `static/vendor/tldraw/` (must exist before bundling).
- `tauri-action` runs `tauri build` (Rust compile + NSIS bundle); `dtolnay/rust-toolchain@stable` ensures Rust is present. On a `v*` tag, `tauri-action` also drafts a GitHub Release; on `workflow_dispatch`, the explicit `upload-artifact` step makes the `.exe` downloadable from the run.

---

## 4. Testing & Verification

**Local (what this session can verify):**
- `resolveApiBase` unit test (Node): web hosts → `""`, any other host → the VPS URL.
- Node offline suite unaffected: `node --test tests/offline/*.test.js` → `pass 351` (350 + 1 new `config.js` test), `fail 0`.
- `static/config.js` is loaded in `index.html` before the app script; inline-script parse = 0 errors; SW v137 + precache `/config.js`.
- Structural validity: `tauri.conf.json` / `capabilities/default.json` parse as JSON; `Cargo.toml` parses as TOML; `tauri.yml` parses as YAML.
- `@tauri-apps/cli` present in root `package.json` devDependencies; icons committed under `src-tauri/icons/`.

**Acceptance (user, via CI — out of this session's control):**
- Trigger the **Build Tauri Desktop (Windows)** workflow (Actions tab → Run workflow). It must go green and upload `taskflow-windows-exe`.
- Install/run the `.exe`: the app window opens, loads the TaskFlow UI, logs in, and syncs against the VPS (confirming `__API_BASE` + CORS work end-to-end). Offline data (tasks/notes/mindmaps/etc.) works; chat **history** loads; chat **realtime** is the one known gap (→ #3b-2).
- The first build may need a few CI iterations to resolve config/schema issues (no local Rust to pre-validate). Iterate from the Actions logs.

---

## 5. Known gaps after #3b
- **Realtime chat (SSE)** in the desktop app — deferred to #3b-2 (token-via-query on the SSE endpoint + frontend wiring).
- **Code signing / auto-update** — #3c (the unsigned `.exe` will show a SmartScreen warning on first run; acceptable for internal use).
- **Service worker under the Tauri protocol** — if the SW fails to register in the webview, the app still works (assets are bundled locally); not a blocker.
