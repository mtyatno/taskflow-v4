#!/usr/bin/env node
// Patches the regenerated gen/android so TaskFlow is an ACTION_SEND share target
// and captures the shared text into a private file the Rust command reads.
const fs = require("fs");
const path = require("path");

const ANDROID = "src-tauri/gen/android";

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

// --- 1. AndroidManifest.xml: add the SEND intent-filter to the main activity ---
const manifestPath = path.join(ANDROID, "app/src/main/AndroidManifest.xml");
if (!fs.existsSync(manifestPath)) {
  console.error("PATCH FAIL: manifest not found at " + manifestPath);
  process.exit(1);
}
let mf = fs.readFileSync(manifestPath, "utf8");
if (!mf.includes("android.intent.action.SEND")) {
  const filter =
    '        <intent-filter>\n' +
    '          <action android:name="android.intent.action.SEND" />\n' +
    '          <category android:name="android.intent.category.DEFAULT" />\n' +
    '          <data android:mimeType="text/plain" />\n' +
    '        </intent-filter>\n';
  const idx = mf.indexOf("</activity>");
  if (idx === -1) { console.error("PATCH FAIL: no </activity> in manifest"); process.exit(1); }
  mf = mf.slice(0, idx) + filter + mf.slice(idx);
  fs.writeFileSync(manifestPath, mf);
  console.log("patched manifest: added SEND intent-filter");
} else {
  console.log("manifest already has SEND intent-filter");
}

// --- 2. MainActivity: capture EXTRA_TEXT/EXTRA_SUBJECT into a private file ---
const ktPath = findFile(path.join(ANDROID, "app/src/main"), "MainActivity.kt");
if (!ktPath) { console.error("PATCH FAIL: MainActivity.kt not found"); process.exit(1); }
let kt = fs.readFileSync(ktPath, "utf8");
if (!kt.includes("handleShare")) {
  // The generated MainActivity already has a body, an onCreate override, and
  // imports android.os.Bundle. So we (a) add only the imports not already
  // present, (b) call handleShare() from inside the existing onCreate, and
  // (c) add onNewIntent + handleShare before the class's closing brace.
  const needed = [
    "import android.content.Intent",
    "import org.json.JSONObject",
    "import java.io.File",
  ].filter(function (imp) { return !kt.includes(imp); });
  if (needed.length) {
    kt = kt.replace(/^(package .+)$/m, "$1\n\n" + needed.join("\n"));
  }
  if (kt.indexOf("super.onCreate(savedInstanceState)") !== -1) {
    kt = kt.replace("super.onCreate(savedInstanceState)",
      "super.onCreate(savedInstanceState)\n    handleShare(intent)");
  } else {
    console.error("PATCH WARN: super.onCreate(savedInstanceState) not found; cold-start share may not fire");
  }
  const methods =
    "\n  override fun onNewIntent(intent: Intent) {\n" +
    "    super.onNewIntent(intent)\n" +
    "    handleShare(intent)\n  }\n" +
    "  private fun handleShare(intent: Intent?) {\n" +
    "    if (intent?.action != Intent.ACTION_SEND) return\n" +
    "    val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return\n" +
    "    val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: \"\"\n" +
    "    val json = JSONObject().put(\"text\", text).put(\"subject\", subject)\n" +
    "    File(filesDir, \"pending_share.json\").writeText(json.toString())\n  }\n";
  kt = kt.replace(/}\s*$/, methods + "}\n");
  fs.writeFileSync(ktPath, kt);
  console.log("patched MainActivity: " + ktPath);
} else {
  console.log("MainActivity already patched");
}
console.log("android share patch done");
