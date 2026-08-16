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
