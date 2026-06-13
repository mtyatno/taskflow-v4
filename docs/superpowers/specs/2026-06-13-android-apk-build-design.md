# Design Spec: Android APK Build (#4a)

**Date:** 2026-06-13
**Status:** Approved
**Slice:** #4a, the first sub-project of #4 (Android). Builds an installable, release-signed Android APK from the same codebase, in GitHub Actions (no local Android toolchain). First sub-project of #4; Play Store / AAB, FS BlobStore, and push notifications are later.

---

## Overview

Tauri v2 builds Android from the same Rust + frontend project. The foundation is already in place from #3b: `src-tauri/src/lib.rs` has `#[cfg_attr(mobile, tauri::mobile_entry_point)] pub fn run()`, `static/config.js` resolves `__API_BASE` to the VPS for any non-web host (the Android webview host `tauri.localhost` qualifies), `scripts/build-tauri-dist.js` assembles the bundled frontend, and the CSP in `tauri.conf.json` already allows `connect-src https://todo.yatno.web.id`. So #4a adds essentially **one new CI workflow** plus a **user-provided signing keystore** — no frontend or Rust changes.

The app is a webview that loads the bundled frontend and talks to the VPS over HTTPS; the default Android manifest from `tauri android init` includes the `INTERNET` permission, which is all this needs.

### Locked decisions
- **`gen/android`:** regenerated in CI each build (`tauri android init`), not committed (stays gitignored). Default manifest suffices.
- **Signing:** a self-generated **release keystore** (free; Android needs no paid CA), supplied via GitHub secrets; the unsigned release APK is signed **post-build with `apksigner`** (not by editing the generated Gradle).
- **Format:** a sideloadable **APK** (transfer to a phone + install). AAB/Play Store is #4b.
- **Build location:** GitHub Actions (`ubuntu-latest`); no local Android SDK/Rust.

### Out of scope (deferred)
- Play Store listing / AAB (#4b).
- BlobStore → filesystem — the existing IndexedDB BlobStore works in the Android webview; FS migration is later.
- Push notifications, deep links, share-target on Android.
- iOS (separate, needs macOS + Apple Developer account).

---

## 1. Prerequisite — signing keystore (user, one-time, free)

Android requires APKs to be signed to install. Generate a self-signed release keystore (with `keytool` from any JDK) and store it in GitHub Actions secrets:

```bash
keytool -genkey -v -keystore taskflow.jks -alias taskflow \
  -keyalg RSA -keysize 2048 -validity 10000
# choose a store password + key password when prompted; fill in the dialog fields.
base64 -w0 taskflow.jks > taskflow.jks.base64   # (-w0 = no line wrap; on macOS use `base64 -i taskflow.jks`)
```

Add four repository secrets (Settings → Secrets and variables → Actions):
- `ANDROID_KEYSTORE_BASE64` — contents of `taskflow.jks.base64`
- `ANDROID_KEYSTORE_PASSWORD` — the store password
- `ANDROID_KEY_ALIAS` — `taskflow`
- `ANDROID_KEY_PASSWORD` — the key password

Keep `taskflow.jks` safe (the same key must sign all future updates, or installed apps can't update in place). If the keystore secrets are absent, the signing step fails clearly; a first toolchain smoke-test can instead build a debug APK (auto-signed) by running `tauri android build --apk --debug`, but the target is the release-signed APK.

---

## 2. CI workflow — `.github/workflows/android.yml`

Triggered by `workflow_dispatch` (+ `v*` tags), on `ubuntu-latest`:

1. **Checkout**, **setup-node** (20), **setup-java** (Temurin 17).
2. **Android SDK + NDK:** `android-actions/setup-android@v3` (installs the SDK, sets `ANDROID_HOME`/`ANDROID_SDK_ROOT`, adds cmdline-tools to PATH); then `sdkmanager` installs a platform, build-tools, and an NDK; export `ANDROID_NDK_HOME` to the installed NDK path.
3. **Rust** (`dtolnay/rust-toolchain@stable`) with the four Android targets: `aarch64-linux-android`, `armv7-linux-androideabi`, `i686-linux-android`, `x86_64-linux-android`.
4. **Frontend prep (reused from #3b):** `npm install` → `node compile.js` → `cd draw-app && npm ci && npx vite build` → `node scripts/build-tauri-dist.js`.
5. **`npx tauri android init`** — regenerates `src-tauri/gen/android/` from `tauri.conf.json` (app id `id.web.yatno.taskflow`, icons, INTERNET permission). Needs `ANDROID_HOME` + `NDK_HOME`/`ANDROID_NDK_HOME` in env.
6. **`npx tauri android build --apk`** — produces an unsigned release APK under `src-tauri/gen/android/app/build/outputs/apk/**/release/*-unsigned.apk`.
7. **Sign:** decode `ANDROID_KEYSTORE_BASE64` → `keystore.jks`; locate the latest `build-tools` dir under `$ANDROID_HOME/build-tools/`; `zipalign -v 4` the unsigned APK; `apksigner sign --ks keystore.jks --ks-pass env:... --key-pass env:... --ks-key-alias "$ANDROID_KEY_ALIAS" --out taskflow-release.apk` the aligned APK; verify with `apksigner verify`.
8. **Upload** the signed APK as the artifact `taskflow-android-apk`.

The exact APK output path, build-tools version, and NDK version are resolved dynamically (globs / `$(ls ... | sort -V | tail -1)`) where possible, since they can't be validated without a CI run; the first build may need a couple of iterations from the Actions logs.

---

## 3. Repo changes

- New: `.github/workflows/android.yml`.
- No frontend/Rust changes (mobile entry point, `config.js`, and CSP were established in #3b). `gen/android` remains gitignored (already covered by `src-tauri/gen/`).
- Optionally pin SDK platform / build-tools / NDK versions in the workflow for reproducibility.

---

## 4. Testing & Verification

- **Local (this session):** the workflow YAML is well-formed (parses); the Node offline suite is unaffected (`pass 352`, `fail 0`); no other file changed.
- **Acceptance (user, via CI):** ensure the four `ANDROID_*` secrets exist, then Actions → **Build Android APK** → Run workflow. On green, download the `taskflow-android-apk` artifact, transfer the `.apk` to an Android phone, enable "install unknown apps," install, and open: the app loads the TaskFlow UI, logs in, and syncs to the VPS (validating `__API_BASE` + CORS from the Android webview). Offline data works; the IndexedDB BlobStore (drawings) works in the webview. The first CI build will likely need 1–3 iterations to settle the Android toolchain (SDK/NDK/Gradle/Rust-target/APK-path/signing) — iterate from the Actions log.

---

## 5. Known gaps after #4a
- Not on the Play Store (sideload only); AAB + store listing → #4b.
- The APK is signed with a self-signed key (installs fine via sideload; no Play App Signing yet).
- FS BlobStore, push notifications, Android share-target — later.
