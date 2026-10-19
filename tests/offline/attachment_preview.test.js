"use strict";
// XSS AttachmentViewer (app native): pratinjau diputuskan dari MIME blob saja, bukan nama file. Blob URL
// se-origin dengan aplikasi → "evil.pdf" bertipe text/html di <iframe src=blob:> menjalankan skrip.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "../..");
const SH = require(path.join(rootDir, "static/offline/safehtml.js"));
const html = fs.readFileSync(path.join(rootDir, "static/index.html"), "utf8");

function slice(src, a, b) {
  const s = src.indexOf(a); assert.ok(s !== -1, a + " harus ada");
  const e = src.indexOf(b, s + a.length); assert.ok(e !== -1, b + " harus ada setelah " + a);
  return src.slice(s, e);
}

test("attachmentPreviewKind: PDF only for exact application/pdf, images only png/jpeg/webp/gif", () => {
  assert.equal(SH.attachmentPreviewKind("application/pdf"), "pdf");
  for (const t of ["image/png", "image/jpeg", "image/webp", "image/gif"]) assert.equal(SH.attachmentPreviewKind(t), "image");
  for (const t of ["image/svg+xml", "text/html", "application/xhtml+xml", "text/xml", "application/xml",
    "application/javascript", "image/bmp", "image/avif", "image/heic", "image/x-icon", "application/octet-stream",
    "", null, undefined, 1, "application/pdf; charset=utf-8", "APPLICATION/PDF", "image/png ", "text/html;x=image/png"]) {
    assert.equal(SH.attachmentPreviewKind(t), "other", JSON.stringify(t));
  }
});

test("attachmentPreview returns the exact type to re-wrap the blob with", () => {
  assert.deepEqual(SH.attachmentPreview("application/pdf"), { kind: "pdf", type: "application/pdf" });
  assert.deepEqual(SH.attachmentPreview("image/webp"), { kind: "image", type: "image/webp" });
  assert.deepEqual(SH.attachmentPreview("image/svg+xml"), { kind: "other", type: null });
});

test("AttachmentViewer classifies by blob MIME only and re-wraps the blob", () => {
  const v = slice(html, "function AttachmentViewer() {", "\n// ─────");
  assert.match(v, /SH\.attachmentPreview\(blob\.type\)/);
  assert.match(v, /\{ kind: "other", type: null \}/, "tanpa modul → unduh saja");
  assert.match(v, /new Blob\(\[blob\], \{ type: pv\.type \|\| "application\/octet-stream" \}\)/);
  assert.doesNotMatch(v, /item\.filename[^\n]*\.test\(|\.(?:test|match)\(name\)|\\\.pdf\$|svg\|/, "nama file tidak dipakai untuk menentukan pratinjau");
  assert.doesNotMatch(v, /URL\.createObjectURL\(blob\)/, "blob asli tidak pernah dijadikan URL");
});
