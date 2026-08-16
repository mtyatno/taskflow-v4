# Android Offline Voice Dictation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hidupkan kembali dikte suara di APK Android secara offline via engine native `SpeechRecognizer`, menggantikan Web Speech API yang ditutup Google.

**Architecture:** File-bridge dua arah di `filesDir` APK (pola `pending_share.json` yang sudah terbukti): JS → Rust `speech_cmd` → `speech_cmd.json` → `SpeechBridge.kt` (poller) → `SpeechRecognizer` native → events di-append ke `speech_events` → JS poll `read_speech_events`. Call site di `index.html` **tidak diubah** — `TF.voicedictate.create()` otomatis memilih impl native saat Tauri-Android terdeteksi.

**Tech Stack:** Kotlin (Android SDK `SpeechRecognizer`), Rust (Tauri commands), vanilla JS (UMD module), node --test.

**Spec:** `docs/superpowers/specs/2026-08-15-android-offline-voice-dictation-design.md` (commit `b80a64c`)

## Global Constraints

- **SW cache-first** (`static/sw.js` `CACHE` saat ini `taskflow-v231-mindmap-header-chips`): setiap perubahan aset statis WAJIB bump nama cache (Task 4) — pelajaran cache mindmap: tanpa bump, device memakai aset lama.
- **`src-tauri/gen/android` di-generate ulang CI** (`tauri android init`) setiap build — JANGAN pernah edit lokal; patch script = source of truth.
- **Zero dependensi native baru** (Rust crate, NDK lib, Maven) — repo punya sejarah sakit dengan dependensi native (brotli pin 8.0.2).
- **Tanpa sudo di CI/CD**; deploy via git push user.
- **UI bahasa Indonesia**; error wajib toast + log console `[voice]` — tidak boleh silent catch (kecuali poll transient yang memang retry).
- **`node --test` di drive Z: lambat** — jalankan di foreground, baca output sendiri, verifikasi 0 fail (jangan percaya laporan subagent, per memori `feedback_node_test_env`).
- Kotlin package: `id.web.yatno.taskflow`; compile SDK android-34 (sesuai `android.yml`).

---

### Task 1: Patch CI — RECORD_AUDIO + SpeechBridge.kt + wiring MainActivity

**Files:**
- Create: `scripts/patch-android-speech.js`
- Create: `src-tauri/android-template/SpeechBridge.kt`
- Modify: `.github/workflows/android.yml` (1 langkah baru)
- Test: `tests/offline/patch_android_speech.test.js`

**Interfaces:**
- Consumes: pola `scripts/patch-android-share.js` (referensi), struktur generated `MainActivity.kt` (punya `super.onCreate(savedInstanceState)`, diakhiri `}` class)
- Produces: modul Node dengan export `{ patchAll, patchManifest, copySpeechBridge, patchMainActivity }`; CLI guard `if (require.main === module)`; file Kotlin `SpeechBridge.kt` berisi `object SpeechBridge` dengan `init(act)`, `onPermissionResult(requestCode, grantResults)`, `stopListening()`, konstanta `REQUEST_RECORD_AUDIO = 1400`

- [ ] **Step 1: Tulis failing test**

`tests/offline/patch_android_speech.test.js`:

```js
"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const patch = require("../../scripts/patch-android-speech.js");

const tmpDirs = [];
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tf-android-"));
  tmpDirs.push(root);
  const mainDir = path.join(root, "app/src/main");
  fs.mkdirSync(mainDir, { recursive: true });
  const manifest =
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n' +
    '  <uses-permission android:name="android.permission.INTERNET" />\n' +
    '  <application>\n' +
    '    <activity android:name=".MainActivity">\n' +
    '    </activity>\n' +
    '  </application>\n' +
    "</manifest>\n";
  fs.writeFileSync(path.join(mainDir, "AndroidManifest.xml"), manifest);
  const kt =
    "package id.web.yatno.taskflow\n\n" +
    "class MainActivity : TauriActivity() {\n" +
    "  override fun onCreate(savedInstanceState: Bundle?) {\n" +
    "    super.onCreate(savedInstanceState)\n" +
    "  }\n" +
    "}\n";
  fs.writeFileSync(path.join(mainDir, "MainActivity.kt"), kt);
  return root;
}

after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

test("patchManifest menambahkan RECORD_AUDIO (idempoten)", () => {
  const root = makeFixture();
  const silent = () => {};
  patch.patchManifest(root, silent);
  let mf = fs.readFileSync(path.join(root, "app/src/main/AndroidManifest.xml"), "utf8");
  assert.ok(mf.includes('android:name="android.permission.RECORD_AUDIO"'));
  patch.patchManifest(root, silent); // kedua kali: tidak duplikat
  mf = fs.readFileSync(path.join(root, "app/src/main/AndroidManifest.xml"), "utf8");
  assert.equal(mf.match(/RECORD_AUDIO/g).length, 1);
});

test("copySpeechBridge menyalin template ke samping MainActivity.kt", () => {
  const root = makeFixture();
  patch.copySpeechBridge(root, () => {});
  const dst = path.join(root, "app/src/main/SpeechBridge.kt");
  assert.ok(fs.existsSync(dst));
  const kt = fs.readFileSync(dst, "utf8");
  assert.ok(kt.includes("object SpeechBridge"));
  assert.ok(kt.includes("REQUEST_RECORD_AUDIO"));
});

test("patchMainActivity menyuntik instance, init, override permission, companion", () => {
  const root = makeFixture();
  patch.patchMainActivity(root, () => {});
  const kt = fs.readFileSync(path.join(root, "app/src/main/MainActivity.kt"), "utf8");
  assert.ok(kt.includes("instance = this"));
  assert.ok(kt.includes("SpeechBridge.init(this)"));
  assert.ok(kt.includes("onRequestPermissionsResult"));
  assert.ok(kt.includes("companion object"));
  assert.ok(kt.includes("SpeechBridge.onPermissionResult(requestCode, grantResults)"));
  // idempoten
  const before = kt;
  patch.patchMainActivity(root, () => {});
  assert.equal(fs.readFileSync(path.join(root, "app/src/main/MainActivity.kt"), "utf8"), before);
});

test("patchAll menjalankan ketiganya", () => {
  const root = makeFixture();
  patch.patchAll(root, () => {});
  assert.ok(fs.readFileSync(path.join(root, "app/src/main/AndroidManifest.xml"), "utf8").includes("RECORD_AUDIO"));
  assert.ok(fs.existsSync(path.join(root, "app/src/main/SpeechBridge.kt")));
  assert.ok(fs.readFileSync(path.join(root, "app/src/main/MainActivity.kt"), "utf8").includes("SpeechBridge.init(this)"));
});
```

- [ ] **Step 2: Jalankan — verifikasi FAIL**

Run: `node --test tests/offline/patch_android_speech.test.js`
Expected: FAIL `Cannot find module '../../scripts/patch-android-speech.js'`

- [ ] **Step 3: Implementasikan patch script + template Kotlin + wiring workflow**

`scripts/patch-android-speech.js` (utuh):

```js
#!/usr/bin/env node
// Patches the regenerated gen/android so TaskFlow has native offline speech
// recognition on Android:
//   1. AndroidManifest.xml: add RECORD_AUDIO (mic capture is impossible without it)
//   2. Copy src-tauri/android-template/SpeechBridge.kt next to MainActivity.kt
//   3. MainActivity.kt: expose the activity instance, start SpeechBridge, and
//      forward onRequestPermissionsResult (runtime mic permission)
// Mirrors scripts/patch-android-share.js — the android project is regenerated
// by `tauri android init` on every CI build, so patches must be re-applied.
const fs = require("fs");
const path = require("path");

const ANDROID = "src-tauri/gen/android";
const TEMPLATE = path.join("src-tauri", "android-template", "SpeechBridge.kt");

function findFile(root, name) {
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name === name) return p;
    }
  }
  return null;
}

function patchManifest(androidDir, log = console.log) {
  const manifestPath = path.join(androidDir, "app/src/main/AndroidManifest.xml");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("PATCH FAIL: manifest not found at " + manifestPath);
  }
  let mf = fs.readFileSync(manifestPath, "utf8");
  if (!mf.includes("android.permission.RECORD_AUDIO")) {
    const perm = '    <uses-permission android:name="android.permission.RECORD_AUDIO" />\n';
    const idx = mf.indexOf("</manifest>");
    if (idx === -1) throw new Error("PATCH FAIL: no </manifest> in manifest");
    mf = mf.slice(0, idx) + perm + mf.slice(idx);
    fs.writeFileSync(manifestPath, mf);
    log("patched manifest: added RECORD_AUDIO");
  } else {
    log("manifest already has RECORD_AUDIO");
  }
}

function copySpeechBridge(androidDir, log = console.log) {
  const ktPath = findFile(path.join(androidDir, "app/src/main"), "MainActivity.kt");
  if (!ktPath) throw new Error("PATCH FAIL: MainActivity.kt not found");
  if (!fs.existsSync(TEMPLATE)) {
    throw new Error("PATCH FAIL: template not found at " + TEMPLATE);
  }
  const dst = path.join(path.dirname(ktPath), "SpeechBridge.kt");
  fs.copyFileSync(TEMPLATE, dst);
  log("copied SpeechBridge.kt to " + dst);
}

function patchMainActivity(androidDir, log = console.log) {
  const ktPath = findFile(path.join(androidDir, "app/src/main"), "MainActivity.kt");
  if (!ktPath) throw new Error("PATCH FAIL: MainActivity.kt not found");
  let kt = fs.readFileSync(ktPath, "utf8");

  if (!kt.includes("SpeechBridge.init")) {
    if (kt.indexOf("super.onCreate(savedInstanceState)") === -1) {
      throw new Error("PATCH FAIL: super.onCreate(savedInstanceState) not found in MainActivity.kt");
    }
    kt = kt.replace(
      "super.onCreate(savedInstanceState)",
      "super.onCreate(savedInstanceState)\n    instance = this\n    SpeechBridge.init(this)"
    );
  }

  if (!kt.includes("onRequestPermissionsResult")) {
    const override =
      "\n  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {\n" +
      "    super.onRequestPermissionsResult(requestCode, permissions, grantResults)\n" +
      "    SpeechBridge.onPermissionResult(requestCode, grantResults)\n" +
      "  }\n";
    kt = kt.replace(/}\s*$/, override + "}\n");
  }

  if (!kt.includes("companion object")) {
    const companion = "\n  companion object {\n    var instance: MainActivity? = null\n  }\n";
    kt = kt.replace(/}\s*$/, companion + "}\n");
  }

  fs.writeFileSync(ktPath, kt);
  log("patched MainActivity: " + ktPath);
}

function patchAll(androidDir, log = console.log) {
  patchManifest(androidDir, log);
  copySpeechBridge(androidDir, log);
  patchMainActivity(androidDir, log);
  log("android speech patch done");
}

module.exports = { patchAll, patchManifest, copySpeechBridge, patchMainActivity };

if (require.main === module) {
  patchAll(ANDROID);
}
```

`src-tauri/android-template/SpeechBridge.kt` (utuh):

```kotlin
package id.web.yatno.taskflow

// SpeechBridge — native offline voice dictation for the Tauri APK.
// The JS frontend (static/offline/voicedictate.js native impl) drives this via
// two files in the app's private filesDir:
//   speech_cmd.json  — written by the Rust `speech_cmd` command:
//                      {"cmd":"start","lang":"id-ID"} | {"cmd":"stop"}
//   speech_events    — appended here (one JSON line per event), read by the
//                      Rust `read_speech_events` command
// Events: {"type":"state","state":...} | {"type":"partial","text":...} |
//         {"type":"final","text":...} | {"type":"error","message":...} | {"type":"end"}
// The command file is deleted after consumption so a command never runs twice.

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import org.json.JSONObject
import java.io.File

object SpeechBridge {
    private const val MAX_RESTARTS = 50
    private const val POLL_MS = 250L
    private const val RESTART_MS = 300L
    const val REQUEST_RECORD_AUDIO = 1400

    private val handler = Handler(Looper.getMainLooper())
    private var activity: MainActivity? = null
    private var recognizer: SpeechRecognizer? = null
    private var userStopped = true
    private var restartCount = 0
    private var currentLang = "id-ID"

    fun init(act: MainActivity) {
        activity = act
        startPoller()
    }

    fun onPermissionResult(requestCode: Int, grantResults: IntArray) {
        if (requestCode != REQUEST_RECORD_AUDIO) return
        if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            startListening()
        } else {
            userStopped = true
            appendEvent(JSONObject().put("type", "error")
                .put("message", "Mikrofon tidak diizinkan. Buka pengaturan aplikasi."))
            appendEvent(JSONObject().put("type", "state").put("state", "idle"))
        }
    }

    fun stopListening() {
        userStopped = true
        try { recognizer?.stopListening() } catch (_: Exception) {}
        try { recognizer?.destroy() } catch (_: Exception) {}
        recognizer = null
        appendEvent(JSONObject().put("type", "state").put("state", "idle"))
    }

    private fun startPoller() {
        val r = object : Runnable {
            override fun run() {
                try {
                    val f = cmdFile()
                    if (f != null && f.exists()) {
                        val raw = f.readText()
                        f.delete()
                        val cmd = JSONObject(raw)
                        when (cmd.optString("cmd")) {
                            "start" -> {
                                currentLang = cmd.optString("lang", "id-ID")
                                startListening()
                            }
                            "stop" -> stopListening()
                        }
                    }
                } catch (_: Exception) {
                } finally {
                    handler.postDelayed(this, POLL_MS)
                }
            }
        }
        handler.post(r)
    }

    private fun startListening() {
        val act = activity ?: return
        if (act.checkSelfPermission(Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) {
            act.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_RECORD_AUDIO)
            appendEvent(JSONObject().put("type", "state").put("state", "waiting"))
            return
        }
        userStopped = false
        restartCount = 0
        try { recognizer?.destroy() } catch (_: Exception) {}
        val sr = SpeechRecognizer.createSpeechRecognizer(act)
        recognizer = sr
        sr.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {
                appendEvent(JSONObject().put("type", "state").put("state", "listening"))
            }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {
                appendEvent(JSONObject().put("type", "state").put("state", "paused"))
            }
            override fun onError(error: Int) {
                val networkMsg = "Perlu internet atau paket offline: download Bahasa Indonesia di Google app → Voice → Offline speech recognition"
                val msg = when (error) {
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ->
                        "Mikrofon tidak diizinkan. Buka pengaturan aplikasi."
                    SpeechRecognizer.ERROR_CLIENT, SpeechRecognizer.ERROR_RECOGNIZER_BUSY ->
                        "Engine suara tidak tersedia. Pastikan Google app terpasang dan paket offline Bahasa Indonesia sudah di-download."
                    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> networkMsg
                    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "silence"
                    else -> "Engine suara error (kode $error)"
                }
                if (msg == "silence") {
                    appendEvent(JSONObject().put("type", "end"))
                    maybeRestart()
                } else {
                    userStopped = true
                    appendEvent(JSONObject().put("type", "error").put("message", msg))
                    appendEvent(JSONObject().put("type", "state").put("state", "idle"))
                }
            }
            override fun onResults(results: Bundle?) {
                restartCount = 0
                val txt = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    ?.firstOrNull() ?: ""
                appendEvent(JSONObject().put("type", "final").put("text", txt))
                maybeRestart()
            }
            override fun onPartialResults(partialResults: Bundle?) {
                restartCount = 0
                val txt = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    ?.firstOrNull() ?: ""
                appendEvent(JSONObject().put("type", "partial").put("text", txt))
            }
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, currentLang)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        try {
            sr.startListening(intent)
        } catch (e: Exception) {
            userStopped = true
            appendEvent(JSONObject().put("type", "error")
                .put("message", "Gagal memulai dikte: ${e.message}"))
            appendEvent(JSONObject().put("type", "state").put("state", "idle"))
        }
    }

    private fun maybeRestart() {
        if (userStopped) return
        restartCount++
        if (restartCount > MAX_RESTARTS) {
            userStopped = true
            appendEvent(JSONObject().put("type", "error")
                .put("message", "Sesi terlalu lama. Silakan mulai ulang."))
            appendEvent(JSONObject().put("type", "state").put("state", "idle"))
            return
        }
        handler.postDelayed({ if (!userStopped) startListening() }, RESTART_MS)
    }

    private fun cmdFile(): File? = activity?.filesDir?.let { File(it, "speech_cmd.json") }
    private fun eventsFile(): File? = activity?.filesDir?.let { File(it, "speech_events") }

    private fun appendEvent(obj: JSONObject) {
        try {
            eventsFile()?.appendText(obj.toString() + "\n")
        } catch (_: Exception) {
        }
    }
}
```

`.github/workflows/android.yml` — tambah langkah tepat setelah langkah share-target (baris 53-54 yang ada):

```yaml
      - name: Patch gen/android for share-target
        run: node scripts/patch-android-share.js
      - name: Patch gen/android for native speech recognition
        run: node scripts/patch-android-speech.js
```

- [ ] **Step 4: Jalankan test — verifikasi PASS**

Run: `node --test tests/offline/patch_android_speech.test.js`
Expected: PASS semua (5 test). Baca output sendiri (jangan percaya laporan subagent).

- [ ] **Step 5: Sanity syntax**

Run: `node --check scripts/patch-android-speech.js`
Expected: exit 0 tanpa output.

- [ ] **Step 6: Commit**

```bash
git add scripts/patch-android-speech.js src-tauri/android-template/SpeechBridge.kt .github/workflows/android.yml tests/offline/patch_android_speech.test.js
git commit -m "feat(voice): add CI patch for native SpeechRecognizer — RECORD_AUDIO + SpeechBridge.kt"
```

---

### Task 2: Rust commands — speech_cmd / read_speech_events / speech_debug

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: pola `candidate_share_paths` di lib.rs (baris 11-38)
- Produces:
  - `candidate_speech_dirs(app: &tauri::AppHandle) -> Vec<PathBuf>` (privat)
  - `#[tauri::command] fn speech_cmd(app: tauri::AppHandle, cmd: String) -> Result<(), String>`
  - `#[tauri::command] fn read_speech_events(app: tauri::AppHandle) -> String`
  - `#[tauri::command] fn speech_debug(app: tauri::AppHandle) -> String`
  - Terdaftar di `generate_handler!`

- [ ] **Step 1: Implementasikan command di `src-tauri/src/lib.rs`**

Tambahkan di bawah fungsi `share_debug` (setelah baris 71):

```rust
// ── Native speech dictation bridge (Android) ──────────────────────
// The APK's SpeechBridge.kt polls `speech_cmd.json` in the app's private
// filesDir and appends results to `speech_events`. The exact mapping of
// Tauri's path API to Context.filesDir is not guaranteed (same lesson as
// pending_share.json), so commands write to / read from every existing
// candidate directory — one of them is guaranteed to be filesDir.

fn candidate_speech_dirs(app: &tauri::AppHandle) -> Vec<std::path::PathBuf> {
    let p = app.path();
    let mut dirs: Vec<std::path::PathBuf> = Vec::new();
    let mut push = |dirs: &mut Vec<std::path::PathBuf>, d: std::path::PathBuf| {
        if d.exists() && !dirs.contains(&d) {
            dirs.push(d);
        }
    };
    for base in [
        p.app_local_data_dir().ok(),
        p.app_data_dir().ok(),
        p.app_config_dir().ok(),
        p.app_cache_dir().ok(),
    ]
    .into_iter()
    .flatten()
    {
        push(&mut dirs, base.clone());
        push(&mut dirs, base.join("files"));
        if let Some(parent) = base.parent() {
            push(&mut dirs, parent.to_path_buf());
            push(&mut dirs, parent.join("files"));
        }
    }
    dirs
}

#[tauri::command]
fn speech_cmd(app: tauri::AppHandle, cmd: String) -> Result<(), String> {
    let mut wrote = 0usize;
    for dir in candidate_speech_dirs(&app) {
        if fs::write(dir.join("speech_cmd.json"), &cmd).is_ok() {
            wrote += 1;
        }
    }
    if wrote == 0 {
        return Err("filesDir tidak ditemukan".into());
    }
    Ok(())
}

#[tauri::command]
fn read_speech_events(app: tauri::AppHandle) -> String {
    let mut out = String::new();
    for dir in candidate_speech_dirs(&app) {
        let path = dir.join("speech_events");
        if path.exists() {
            if let Ok(data) = fs::read_to_string(&path) {
                out.push_str(&data);
            }
            // Truncate-by-delete: Kotlin's appendText recreates the file on
            // the next event (tiny race window, accepted in the spec).
            let _ = fs::remove_file(&path);
        }
    }
    out
}

#[tauri::command]
fn speech_debug(app: tauri::AppHandle) -> String {
    candidate_speech_dirs(&app)
        .into_iter()
        .map(|d| {
            format!(
                "{} : events={} cmd={}",
                d.display(),
                if d.join("speech_events").exists() { "EXISTS" } else { "-" },
                if d.join("speech_cmd.json").exists() { "EXISTS" } else { "-" }
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}
```

- [ ] **Step 2: Daftarkan command di `generate_handler!` (baris 129)**

Ubah dari:

```rust
        .invoke_handler(tauri::generate_handler![get_pending_share, share_debug, save_token, get_token, delete_token])
```

menjadi:

```rust
        .invoke_handler(tauri::generate_handler![get_pending_share, share_debug, save_token, get_token, delete_token, speech_cmd, read_speech_events, speech_debug])
```

- [ ] **Step 3: Verifikasi**

Run: `cd src-tauri && cargo check 2>&1 | tail -5` (kalau toolchain Rust tersedia lokal)
Expected: exit 0, tidak ada error/warning baru. Kalau cargo tidak tersedia lokal: baca ulang diff baris-per-baris — tipe & nama fungsi harus persis seperti Step 1; compile penuh dibuktikan CI build APK nanti (Task akhir).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(voice): add speech_cmd/read_speech_events/speech_debug Rust commands"
```

---

### Task 3: Impl native di voicedictate.js + unit test

**Files:**
- Modify: `static/offline/voicedictate.js`
- Test: `tests/offline/voicedictate_native.test.js`

**Interfaces:**
- Consumes: `window.__TAURI__.core.invoke(cmd, args)` (pola share poll di `index.html` ~21959); struktur UMD existing (`factory(root)`, `root.TF.voicedictate`)
- Produces (export tambahan di objek `exported`):
  - `parseSpeechEvents(raw: string|null) -> Array<{type:string, [state|text|message]:string}>` — pure
  - `dispatchEvents(raw: string, handlers: {onState(s), onText(text, isFinal), onError(msg)}) -> number` — pure
  - `isSupported()` true bila Web SpeechRecognition ATAU native bridge; `create(opts)` memilih impl native bila Tauri+Android

- [ ] **Step 1: Tulis failing test**

`tests/offline/voicedictate_native.test.js`:

```js
"use strict";
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const TF = require("../../static/offline/voicedictate.js");

// UMD wrapper menangkap `globalThis` sebagai root saat load — mutasi global
// di sini terlihat oleh runtime check modul (dibaca saat call, bukan load).
let calls;
function mockTauri(invokeImpl) {
  calls = [];
  globalThis.__TAURI__ = {
    core: {
      invoke: (cmd, args) => {
        calls.push({ cmd, args });
        return invokeImpl ? invokeImpl(cmd, args) : Promise.resolve("");
      },
    },
  };
}
function mockAndroid() {
  globalThis.navigator = { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36" };
}
afterEach(() => {
  delete globalThis.__TAURI__;
  delete globalThis.navigator;
});

test("parseSpeechEvents: parse baris valid, lewati korup", () => {
  const raw = [
    '{"type":"state","state":"listening"}',
    "not-json",
    '{"type":"partial","text":"halo"}',
    "",
    '{"noType":true}',
    '{"type":"final","text":"halo dunia"}',
  ].join("\r\n");
  const events = TF.voicedictate.parseSpeechEvents(raw);
  assert.equal(events.length, 3);
  assert.deepEqual(events[0], { type: "state", state: "listening" });
  assert.deepEqual(events[1], { type: "partial", text: "halo" });
  assert.deepEqual(events[2], { type: "final", text: "halo dunia" });
});

test("parseSpeechEvents: input kosong/null → array kosong", () => {
  assert.deepEqual(TF.voicedictate.parseSpeechEvents(""), []);
  assert.deepEqual(TF.voicedictate.parseSpeechEvents(null), []);
});

test("dispatchEvents: routing + mapping waiting→paused + end→paused", () => {
  const seen = { states: [], partials: [], finals: [], errors: [] };
  const n = TF.voicedictate.dispatchEvents(
    [
      '{"type":"state","state":"waiting"}',
      '{"type":"state","state":"listening"}',
      '{"type":"partial","text":"seb"}',
      '{"type":"final","text":"sebentar"}',
      '{"type":"end"}',
      '{"type":"error","message":"boom"}',
    ].join("\n"),
    {
      onState: (s) => seen.states.push(s),
      onText: (t, isFinal) => (isFinal ? seen.finals.push(t) : seen.partials.push(t)),
      onError: (m) => seen.errors.push(m),
    }
  );
  assert.equal(n, 6);
  assert.deepEqual(seen.states, ["paused", "listening", "paused"]);
  assert.deepEqual(seen.partials, ["seb"]);
  assert.deepEqual(seen.finals, ["sebentar"]);
  assert.deepEqual(seen.errors, ["boom"]);
});

test("deteksi native: isSupported true + create() kembalikan impl native", () => {
  mockTauri();
  mockAndroid();
  assert.equal(TF.voicedictate.isSupported(), true);
  const impl = TF.voicedictate.create({});
  assert.equal(typeof impl.start, "function");
  assert.equal(typeof impl.stop, "function");
  assert.equal(typeof impl.getState, "function");
});

test("start/stop kirim command yang benar, stop bersihkan poller", () => {
  mockTauri();
  mockAndroid();
  const impl = TF.voicedictate.create({ onStateChange: () => {} });
  impl.start();
  assert.deepEqual(calls.map((c) => c.cmd), ["read_speech_events", "speech_cmd"]);
  assert.deepEqual(JSON.parse(calls[1].args.cmd), { cmd: "start", lang: "id-ID" });
  assert.equal(impl.getState(), "listening");
  impl.stop();
  assert.equal(calls[2].cmd, "speech_cmd");
  assert.deepEqual(JSON.parse(calls[2].args.cmd), { cmd: "stop" });
  assert.equal(impl.getState(), "idle");
});

test("tanpa Tauri/Android di node → isSupported false (fallback web impl)", () => {
  assert.equal(TF.voicedictate.isSupported(), false);
});
```

- [ ] **Step 2: Jalankan — verifikasi FAIL**

Run: `node --test tests/offline/voicedictate_native.test.js`
Expected: FAIL — `TF.voicedictate.parseSpeechEvents is not a function` (RED murni; modul sudah ada, fungsi belum).

- [ ] **Step 3: Implementasikan di `static/offline/voicedictate.js`**

3a. Setelah `const SpeechRecognition = ...` (baris 11), tambahkan:

```js
  // ── Native Android bridge (Tauri APK) ────────────────────────────
  // Web Speech API sudah mati di Android (layanan Google ditutup). Di APK,
  // dikte memakai SpeechRecognizer native via file-bridge speech_cmd.json /
  // speech_events (pola pending_share). Deteksi: Tauri + userAgent Android.
  function isTauri() {
    var T = root.__TAURI__;
    return !!(T && T.core && typeof T.core.invoke === "function");
  }

  function isAndroid() {
    return !!(root.navigator && /android/i.test(root.navigator.userAgent));
  }

  function isNativeBridgeAvailable() {
    return isTauri() && isAndroid();
  }
```

3b. Ubah `isSupported()` (baris 14-16) menjadi:

```js
  function isSupported() {
    return !!SpeechRecognition || isNativeBridgeAvailable();
  }
```

3c. Ubah awal `create(opts)` (baris 18-21) menjadi:

```js
  function create(opts) {
    if (!isSupported()) {
      throw new Error("SpeechRecognition tidak didukung di browser ini");
    }
    if (isNativeBridgeAvailable()) {
      return createNativeAndroid(opts);
    }
```

3d. Sebelum `var exported = ...` (baris 132), tambahkan fungsi pure + impl native:

```js
  // Pure: parse baris-baris JSON dari file speech_events → array event.
  // Baris korup / tanpa `type` dilewati. Di-export untuk unit test.
  function parseSpeechEvents(raw) {
    if (!raw) return [];
    var events = [];
    var lines = String(raw).split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      try {
        var obj = JSON.parse(line);
        if (obj && obj.type) events.push(obj);
      } catch (e) { /* baris korup — lewati */ }
    }
    return events;
  }

  // Pure: dispatch event → handler. "waiting" dipetakan ke "paused" agar
  // tombol tetap menampilkan state menunggu (konsisten dgn UI lama).
  // Return jumlah event yang diproses (0 = tidak ada event baru).
  function dispatchEvents(raw, handlers) {
    var events = parseSpeechEvents(raw);
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      switch (ev.type) {
        case "state":
          handlers.onState(ev.state === "waiting" ? "paused" : ev.state);
          break;
        case "partial":
          if (ev.text) handlers.onText(ev.text, false);
          break;
        case "final":
          if (ev.text) handlers.onText(ev.text, true);
          break;
        case "error":
          handlers.onError(ev.message || "");
          break;
        case "end":
          handlers.onState("paused");
          break;
      }
    }
    return events.length;
  }

  function createNativeAndroid(opts) {
    var lang = opts.lang || "id-ID";
    var onInterim = opts.onInterim || function () {};
    var onFinal = opts.onFinal || function () {};
    var onError = opts.onError || function () {};
    var onStateChange = opts.onStateChange || function () {};

    var currentState = "idle";
    var pollTimer = null;
    var silentCycles = 0;
    var SILENT_LIMIT = 20; // ~6 detik tanpa event saat listening → diagnostik path

    function setState(state) {
      if (currentState !== state) {
        currentState = state;
        onStateChange(state);
      }
    }

    function invoke(cmd, args) {
      return root.__TAURI__.core.invoke(cmd, args || {});
    }

    function poll() {
      invoke("read_speech_events", {}).then(function (raw) {
        if (currentState === "idle") return; // sudah di-stop
        var n = dispatchEvents(raw, {
          onState: function (s) {
            silentCycles = 0;
            setState(s);
          },
          onText: function (text, isFinal) {
            silentCycles = 0;
            if (isFinal) onFinal(text);
            else onInterim(text);
          },
          onError: function (msg) {
            silentCycles = 0;
            setState("idle");
            if (msg) onError(msg);
          }
        });
        if (n === 0) {
          silentCycles++;
          // Diagnostik: kemungkinan mapping filesDir tidak cocok — tampilkan
          // lokasi yang dicek Rust (pola share_debug).
          if (silentCycles >= SILENT_LIMIT && currentState === "listening") {
            silentCycles = 0;
            invoke("speech_debug", {}).then(function (dbg) {
              onError("Dikte tidak merespons.\nLokasi yang dicek:\n\n" + dbg);
            }).catch(function () {});
          }
        }
      }).catch(function () { /* invoke transient error — poll berikutnya coba lagi */ });
    }

    function start() {
      setState("listening");
      silentCycles = 0;
      // Buang event stale dari sesi sebelumnya (mis. app crash saat recording).
      invoke("read_speech_events", {}).catch(function () {});
      invoke("speech_cmd", { cmd: JSON.stringify({ cmd: "start", lang: lang }) }).catch(function (e) {
        setState("idle");
        onError("Gagal memulai dikte: " + String(e));
      });
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(poll, 300);
    }

    function stop() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      invoke("speech_cmd", { cmd: JSON.stringify({ cmd: "stop" }) }).catch(function () {});
      setState("idle");
    }

    function getState() {
      return currentState;
    }

    return { start: start, stop: stop, getState: getState };
  }
```

3e. Ubah export (baris 132):

```js
  var exported = {
    isSupported: isSupported,
    create: create,
    parseSpeechEvents: parseSpeechEvents,
    dispatchEvents: dispatchEvents
  };
```

- [ ] **Step 4: Jalankan test — verifikasi PASS**

Run: `node --test tests/offline/voicedictate_native.test.js`
Expected: PASS semua (6 test). Baca output sendiri.

- [ ] **Step 5: Full suite**

Run: `npm test` (foreground, jangan background — Z: lambat)
Expected: 0 fail (jumlah total bertambah: 384 baseline + 5 patch test + 6 voice test). Verifikasi output sendiri.

- [ ] **Step 6: Commit**

```bash
git add static/offline/voicedictate.js tests/offline/voicedictate_native.test.js
git commit -m "feat(voice): native Android speech bridge in voicedictate.js"
```

---

### Task 4: SW cache bump + verifikasi akhir

**Files:**
- Modify: `static/sw.js` (baris 2)

**Interfaces:**
- Consumes: aturan SW cache-first dari Global Constraints

- [ ] **Step 1: Bump cache name**

Ubah baris 2 `static/sw.js` dari:

```js
const CACHE = "taskflow-v231-mindmap-header-chips";
```

menjadi:

```js
const CACHE = "taskflow-v232-native-voice";
```

- [ ] **Step 2: Verifikasi akhir**

Run satu per satu (baca output sendiri):

```bash
node --check static/offline/voicedictate.js
node --check static/sw.js
node --check scripts/patch-android-speech.js
npm test
```

Expected: semua exit 0; `npm test` 0 fail. Grep konfirmasi call site index.html utuh (TIDAK boleh ada perubahan di index.html pada fitur ini):

```bash
git diff --stat HEAD~3..HEAD -- static/index.html
```

Expected: kosong (tidak ada commit fitur ini menyentuh index.html).

- [ ] **Step 3: Commit**

```bash
git add static/sw.js
git commit -m "chore(voice): bump SW cache v232 for native voice dictation"
```

- [ ] **Step 4: Post-plan (bukan bagian commit)**

1. Beri tahu user untuk `git push origin main` + trigger workflow **"Build Android APK"** (Actions).
2. Verifikasi build hijau = bukti `SpeechBridge.kt` ter-compile & manifest valid.
3. Beri user checklist device test (dari spec §Testing):
   - Klik mic → izin mic muncul → izinkan → tombol merah + bicara → teks interim muncul live → klik stop → teks final masuk.
   - **Mode pesawat** → dikte tetap jalan (pastikan paket offline Bahasa Indonesia sudah di-download: Google app → Settings → Voice → Offline speech recognition).
   - Tolak izin mic → toast panduan, tombol kembali normal.
   - Diam >10 detik → bicara lagi tetap masuk (auto-restart).
4. Kalau tidak ada hasil sama sekali di device → baca toast diagnostik `speech_debug` (daftar lokasi filesDir yang dicek Rust) dan laporkan ke sesi berikutnya — itu penanda mismatch path Kotlin↔Rust, fix-nya menyelaraskan daftar candidate dirs.

---

## Self-Review Notes (dijalankan penulis plan)

- **Spec coverage:** engine native + EXTRA_PREFER_OFFLINE (Task 1 Kotlin) ✓; file-bridge 2 arah (Task 1+2) ✓; RECORD_AUDIO manifest + izin runtime (Task 1) ✓; impl native + deteksi + call site tidak diubah (Task 3) ✓; error mapping + toast panduan (Task 1 Kotlin + Task 3 dispatch) ✓; diagnostik speech_debug (Task 2 + Task 3 poll) ✓; SW bump (Task 4) ✓; unit test node (Task 1+3) ✓; auto-restart silence guard 50 (Task 1 Kotlin) ✓.
- **Placeholder scan:** bersih — semua langkah berisi kode utuh, tidak ada TBD/"similar to".
- **Type consistency:** `speech_cmd` args = `{ cmd: "start"|"stop", lang? }` konsisten di JS (Task 3) ↔ Kotlin parser (Task 1) ↔ Rust (pass-through string). `speech_events` baris JSON: key `type` + `state|text|message` konsisten Kotlin ↔ dispatchEvents. `REQUEST_RECORD_AUDIO = 1400` sama di Kotlin & tidak dipakai tempat lain. `waiting→paused` dipetakan sekali di `dispatchEvents` (bukan di Kotlin) — konsisten dengan test Task 3.
