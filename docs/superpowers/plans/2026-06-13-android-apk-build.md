# Android APK Build (#4a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Actions workflow that builds and release-signs an installable Android APK from the existing codebase (no local Android toolchain).

**Architecture:** Tauri v2 builds Android from the same project; the foundation (mobile entry point in `lib.rs`, origin-based `config.js`, `dist-tauri` assembly, VPS-allowing CSP) was established in #3b. So this slice is one new CI workflow that sets up the Android toolchain, reuses the #3b frontend prep, runs `tauri android init` + `tauri android build --apk`, and signs the APK with a user-provided keystore via `apksigner`.

**Tech Stack:** GitHub Actions (ubuntu-latest), Android SDK/NDK, Rust (Android targets), Tauri v2 CLI — all in CI; no local build.

**Reference spec:** `docs/superpowers/specs/2026-06-13-android-apk-build-design.md`

**Baseline before starting:** `node --test tests/offline/*.test.js` → `pass 352`.

**Pinned facts (verified):** `src-tauri/src/lib.rs` already has `#[cfg_attr(mobile, tauri::mobile_entry_point)] pub fn run()`. `static/config.js` resolves any non-web host (incl. the Android webview `tauri.localhost`) to the VPS. `tauri.conf.json` CSP allows `connect-src https://todo.yatno.web.id`. `scripts/build-tauri-dist.js` assembles `dist-tauri/`. `draw-app` vite build outputs to `static/vendor/tldraw/`. Root `package.json` has `@tauri-apps/cli ^2` and a `"tauri": "tauri"` script. `gen/` is gitignored (`src-tauri/gen/`).

**User prerequisite (NOT a code task — documented for the user):** generate a release keystore and add four GitHub secrets before triggering the workflow, per the spec §1: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Without them the signing step fails clearly.

---

### Task 1: `.github/workflows/android.yml` — CI Android APK build + sign

**Files:**
- Create: `.github/workflows/android.yml`

No Node unit test (CI config). Verify the YAML parses + the offline suite is unaffected. The real validation is the CI run (acceptance, user).

- [ ] **Step 1: Create `.github/workflows/android.yml`**

```yaml
name: Build Android APK
on:
  workflow_dispatch:
  push:
    tags: ["v*"]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "17"
      - name: Setup Android SDK
        uses: android-actions/setup-android@v3
      - name: Install NDK + platform + build-tools
        run: |
          sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0" "ndk;26.3.11579264"
          echo "NDK_HOME=$ANDROID_SDK_ROOT/ndk/26.3.11579264" >> "$GITHUB_ENV"
          echo "ANDROID_NDK_HOME=$ANDROID_SDK_ROOT/ndk/26.3.11579264" >> "$GITHUB_ENV"
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-linux-android,armv7-linux-androideabi,i686-linux-android,x86_64-linux-android
      - name: Install root deps (provides @tauri-apps/cli)
        run: npm install
      - name: Pre-compile JSX (no-op if already compiled)
        run: node compile.js
      - name: Build tldraw vendor (draw-app -> static/vendor/tldraw)
        run: cd draw-app && npm ci && npx vite build
      - name: Assemble Tauri frontend (dist-tauri)
        run: node scripts/build-tauri-dist.js
      - name: Tauri Android init (regenerate gen/android)
        run: npx tauri android init
      - name: Build Android APK (unsigned release)
        run: npx tauri android build --apk
      - name: Sign APK
        env:
          ANDROID_KEYSTORE_BASE64: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}
          ANDROID_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
          ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
        run: |
          set -euo pipefail
          echo "$ANDROID_KEYSTORE_BASE64" | base64 -d > keystore.jks
          BT="$(ls -d "$ANDROID_SDK_ROOT"/build-tools/* | sort -V | tail -1)"
          UNSIGNED="$(find src-tauri/gen/android/app/build/outputs/apk -name '*-unsigned.apk' | head -1)"
          echo "build-tools: $BT"
          echo "unsigned apk: $UNSIGNED"
          "$BT/zipalign" -v -p 4 "$UNSIGNED" aligned.apk
          "$BT/apksigner" sign \
            --ks keystore.jks \
            --ks-pass env:ANDROID_KEYSTORE_PASSWORD \
            --key-pass env:ANDROID_KEY_PASSWORD \
            --ks-key-alias "$ANDROID_KEY_ALIAS" \
            --out taskflow-release.apk aligned.apk
          "$BT/apksigner" verify --verbose taskflow-release.apk
          rm -f keystore.jks
      - name: Upload APK artifact
        uses: actions/upload-artifact@v4
        with:
          name: taskflow-android-apk
          path: taskflow-release.apk
          if-no-files-found: error
```

- [ ] **Step 2: Verify the YAML is well-formed**

```
python -c "import yaml; yaml.safe_load(open('.github/workflows/android.yml')); print('yaml ok')"
```
Expected: `yaml ok`. (If PyYAML is unavailable, `python -m pip install pyyaml` then re-run; or verify by eye — 2-space indentation, `on:` has `workflow_dispatch:` + `push.tags`, one `build` job on `ubuntu-latest`.)

- [ ] **Step 3: Confirm the build-order + key invariants by grep**

```
node -e "const s=require('fs').readFileSync('.github/workflows/android.yml','utf8'); const iVite=s.indexOf('vite build'); const iAssemble=s.indexOf('build-tauri-dist.js'); const iInit=s.indexOf('tauri android init'); const iBuild=s.indexOf('tauri android build'); const iSign=s.indexOf('apksigner sign'); console.log('order ok:', iVite>0 && iAssemble>iVite && iInit>iAssemble && iBuild>iInit && iSign>iBuild); console.log('targets:', /aarch64-linux-android/.test(s) && /x86_64-linux-android/.test(s)); console.log('secrets:', ['ANDROID_KEYSTORE_BASE64','ANDROID_KEYSTORE_PASSWORD','ANDROID_KEY_ALIAS','ANDROID_KEY_PASSWORD'].every(k=>s.includes('secrets.'+k)));"
```
Expected: `order ok: true`, `targets: true`, `secrets: true`.

- [ ] **Step 4: Confirm no code regression**

```
node --test tests/offline/*.test.js
```
Expected: `pass 352`, `fail 0` (this slice adds only a workflow; no app code changes).

Confirm the existing workflows are untouched:
```
node -e "const fs=require('fs'); console.log('deploy:', fs.existsSync('.github/workflows/deploy.yml'), 'tauri:', fs.existsSync('.github/workflows/tauri.yml'), 'android:', fs.existsSync('.github/workflows/android.yml'));"
```
Expected: `deploy: true tauri: true android: true`

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/android.yml
git commit -m "ci(android): GitHub Actions workflow to build + sign the Android APK (#4a)"
```

---

## Acceptance (user, via CI — outside this session)

1. Ensure the four `ANDROID_*` secrets exist (spec §1) — generate the keystore + add secrets first.
2. GitHub → Actions → **Build Android APK** → Run workflow (or push a `v*` tag).
3. The first run may need 1–3 iterations from the Actions log (Android SDK/NDK version, Rust targets, the `tauri android build` APK output path, or the `zipalign`/`apksigner` invocation). Iterate from the logs — paste failures back.
4. On green: download the `taskflow-android-apk` artifact, transfer the `.apk` to an Android phone, enable "install unknown apps," install, and open. The app loads the TaskFlow UI, logs in, and syncs to the VPS (validates `__API_BASE` + CORS from the Android webview). Offline data + the IndexedDB drawing BlobStore work in the webview.

---

## Self-Review Notes (addressed)

- **Spec coverage:** §1 keystore prerequisite (documented user action, referenced in the plan header + acceptance); §2 the workflow (toolchain setup → #3b frontend prep → android init → build → apksigner sign → upload) → Task 1; §3 repo change is the single workflow file; §4 verification (YAML valid, suite unaffected) → Steps 2-4; §5 known gaps documented.
- **No code changes:** the Android foundation (mobile entry, config.js, CSP, dist-tauri) is already merged (#3b); #4a is CI-only, so the Node suite stays 352 and no frontend/Rust file is touched.
- **Build-order invariant:** Step 3 asserts vite build → assemble dist-tauri → android init → android build → sign, matching the dependency chain (tldraw vendor must exist before assembling, dist-tauri before init, the APK before signing).
- **Uncertain-but-flagged:** the unsigned-APK path (`find ... -name '*-unsigned.apk'`), the build-tools dir (latest via `sort -V | tail -1`), and the NDK version are resolved dynamically or pinned; these are the most likely first-CI-iteration adjustments and are called out in Acceptance.
- **Expected suite count:** 352 (unchanged).
