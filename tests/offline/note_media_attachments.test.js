"use strict";
// Task 6 (media di note): daftar lampiran NoteModal/NotePanel + prefetch ekspor DOCX.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "../..");
const html = fs.readFileSync(path.join(rootDir, "static/index.html"), "utf8");

function slice(a, b) {
  const i = html.indexOf(a); assert.ok(i >= 0, "marker: " + a);
  const j = html.indexOf(b, i); assert.ok(j > i, "end: " + b);
  return html.slice(i, j);
}

test("kedua daftar lampiran bercabang pada kind === 'media'", () => {
  assert.match(html, /attachments\.map\(att => att\.kind === 'media' \? mediaAttachmentRow\(/);
  assert.match(html, /panelAttachments\.map\(att => att\.kind === 'media' \? mediaAttachmentRow\(att, false, null\)/);
});

test("prefetch DOCX melewati media", () => {
  const blk = slice("allAtts.map(async (att) => {", "const b64 = await urlToBase64(attUrl)");
  assert.match(blk, /att\.kind === 'media'\) return;/);
});

test("NoteModal: hak hapus dan invalidasi kartu", () => {
  assert.match(html, /mediaAttachmentCanDelete\(att, localStorage\.getItem\('tf_user_id'\), mediaNoteOwnerId\)/);
  assert.match(html, /invalidateMediaCards\(att\)/);
  const blk = slice("// ── Baris media di daftar lampiran note ──", "// ── Akhir baris media ──");
  assert.match(blk, /formatDuration/);
  assert.match(blk, /data-media-cid/);
  assert.match(blk, /apiUrl\('\/api\/media\/'/);
  assert.doesNotMatch(blk, /attachments\/.*\/view/);
});

function load() {
  const blk = slice("// ── Baris media di daftar lampiran note ──", "// ── Akhir baris media ──");
  const ctx = { window: { TF: { mediacard: { formatDuration: ms => "d" + ms } } }, isFinite, Number, String, Array, Map };
  vm.createContext(ctx);
  vm.runInContext(blk + "\nthis.L = mediaAttachmentLabel; this.C = mediaAttachmentCanDelete;", ctx);
  return ctx;
}

test("mediaAttachmentLabel", () => {
  const { L } = load();
  assert.deepEqual({ ...L({ media_type: "video", original_name: "a.mp4", duration_ms: 5, status: "ready" }) },
    { icon: "🎬", name: "a.mp4", duration: "d5", status: "" });
  assert.equal(L({ media_type: "audio", status: "uploading" }).icon, "🎵");
  assert.equal(L({ media_type: "audio", status: "uploading" }).status, "Mengunggah…");
  assert.equal(L({ status: "processing" }).status, "Memproses…");
  assert.equal(L({ status: "processing" }).icon, "🎞");
  assert.equal(L({ status: "failed", error: "rusak" }).status, "rusak");
  assert.equal(L({ status: "failed" }).status, "Gagal");
});

test("mediaAttachmentCanDelete", () => {
  const { C } = load();
  assert.equal(C({ uploaded_by: 3 }, "3", 9), true);
  assert.equal(C({ uploaded_by: 3 }, "9", 9), true);
  assert.equal(C({ uploaded_by: 3 }, "4", 9), false);
  assert.equal(C({ uploaded_by: 3 }, null, 9), false);
});
