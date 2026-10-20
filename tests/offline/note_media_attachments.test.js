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

test("mediaAttachmentCanDelete: baris daftar asli (uploader di user_id, tanpa uploaded_by)", () => {
  const { C } = load();
  // Bentuk baris GET /api/scratchpad/{id}/attachments: user_id = pengunggah.
  const row = { id: 5, kind: "media", user_id: 3, client_id: "c1", status: "ready" };
  assert.equal(C(row, "3", 9), true, "pengunggah (user_id) boleh hapus");
  assert.equal(C(row, "4", 9), false);
  assert.equal(C(row, "9", 9), true, "pemilik note boleh hapus");
  // uploaded_by tetap diutamakan bila ada
  assert.equal(C({ uploaded_by: 3, user_id: 4 }, "4", 9), false);
});

// ── fix wave item 5: shell native (Tauri) → unduhan media lewat jalur opener openAttachment ──
function loadNative(native) {
  const blk = slice("// ── Baris media di daftar lampiran note ──", "// ── Akhir baris media ──");
  const events = []; const opened = [];
  const win = { TF: {}, open: (...a) => opened.push(a), dispatchEvent: (ev) => events.push(ev) };
  if (native) win.__TAURI__ = {};
  const ctx = {
    window: win, isFinite, Number, String, Array, Map, JSON,
    API_BASE: native ? "https://api.x" : "",
    apiUrl: (p) => (typeof p === "string" && p.charAt(0) === "/" ? (native ? "https://api.x" : "") + p : p),
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    __token: "tok",
    fetch: async () => ({ ok: true, json: async () => ({ download_url: "/media/dl9" }) }),
    document: { querySelector: () => null },
  };
  vm.createContext(ctx);
  vm.runInContext(blk + "\nthis.D = openMediaDownload; this.O = openMediaAttachment; this.N = mediaNativeShell;", ctx);
  return { ctx, events, opened };
}

test("openMediaDownload: native → event tf-open-attachment (URL bertanda tangan, tanpa token); web → window.open", () => {
  const n = loadNative(true);
  assert.equal(n.ctx.N(), true);
  n.ctx.D("/media/abc", "rapat.mp4");
  assert.equal(n.opened.length, 0, "native tidak memakai window.open");
  assert.equal(n.events.length, 1);
  assert.equal(n.events[0].type, "tf-open-attachment");
  assert.deepEqual({ ...n.events[0].detail }, { url: "https://api.x/media/abc", filename: "rapat.mp4" });
  n.ctx.D("https://api.x/media/x", "");
  assert.equal(n.events[1].detail.url, "https://api.x/media/x");
  const w = loadNative(false);
  assert.equal(w.ctx.N(), false);
  w.ctx.D("/media/abc", "rapat.mp4");
  assert.equal(w.events.length, 0);
  assert.deepEqual(w.opened.map((a) => [...a]), [["/media/abc", "_blank"]]);
});

test("openMediaAttachment (baris daftar) di native memakai opener native", async () => {
  const n = loadNative(true);
  await n.ctx.O({ id: 9, status: "ready", original_name: "v.mp4" });
  assert.equal(n.opened.length, 0);
  assert.equal(n.events.length, 1);
  assert.deepEqual({ ...n.events[0].detail }, { url: "https://api.x/media/dl9", filename: "v.mp4" });
  const w = loadNative(false);
  await w.ctx.O({ id: 9, status: "ready", original_name: "v.mp4" });
  assert.deepEqual(w.opened.map((a) => [...a]), [["/media/dl9", "_blank"]]);
});
