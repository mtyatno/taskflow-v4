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
