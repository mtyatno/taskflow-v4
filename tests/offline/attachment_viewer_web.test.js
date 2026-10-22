"use strict";

// Lampiran task/note di web (API_BASE kosong): dulu openAttachment memakai window.open(path) → navigasi biasa
// yang hanya terautentikasi lewat cookie httpOnly `token`. Bila cookie itu hilang (SPA tetap login lewat
// localStorage.tf_token + header Authorization; /api/auth/refresh tidak memasang ulang cookie yang hilang),
// server menjawab 401 {"detail":"Not authenticated"}. Kini web memakai AttachmentViewer in-app yang sama
// dengan app native: event tf-open-attachment dengan path RELATIF (tanpa ?token=), lalu viewer mengambil
// berkas dengan header Authorization: Bearer <__token>.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");

function fnSource(sig) {
  const start = html.indexOf("\n" + sig);
  assert.ok(start >= 0, `${sig} must exist`);
  const end = html.indexOf("\n}\n", start + 1);
  assert.ok(end > start, `${sig} end must be found`);
  return html.slice(start, end + 2);
}

function load({ apiBase = "", tauri = false, token = "tok-123", fetchImpl } = {}) {
  const events = []; const opened = []; const fetches = [];
  const win = { open: (...a) => opened.push(a), dispatchEvent: ev => events.push(ev) };
  if (tauri) win.__TAURI__ = {};
  const ctx = {
    window: win,
    API_BASE: apiBase,
    __token: token,
    encodeURIComponent,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    fetch: async (url, opts) => {
      fetches.push({ url, opts });
      return fetchImpl ? fetchImpl(url, opts) : { ok: true, status: 200 };
    },
  };
  vm.createContext(ctx);
  const apiUrlSrc = 'const apiUrl = (p) => (typeof p === "string" && p.charAt(0) === "/") ? API_BASE + p : p;\n';
  const helper = html.includes("\nasync function fetchAttachmentResponse(") ? fnSource("async function fetchAttachmentResponse(") : "";
  vm.runInContext(apiUrlSrc + fnSource("async function openAttachment(") + helper +
    "\nthis.O = openAttachment; this.F = typeof fetchAttachmentResponse === 'function' ? fetchAttachmentResponse : null;", ctx);
  return { ctx, events, opened, fetches };
}

test("openAttachment di web: event tf-open-attachment dengan path relatif, tanpa token, tanpa window.open", async () => {
  const w = load();
  await w.ctx.O("/api/attachments/7/download", "foto.png");
  assert.equal(w.opened.length, 0, "web tidak lagi memakai window.open (bergantung cookie)");
  assert.equal(w.events.length, 1);
  assert.equal(w.events[0].type, "tf-open-attachment");
  assert.deepEqual({ ...w.events[0].detail }, { url: "/api/attachments/7/download", filename: "foto.png" });
  assert.doesNotMatch(w.events[0].detail.url, /token=/);
  await w.ctx.O("/api/scratchpad/attachments/3/view");
  assert.deepEqual({ ...w.events[1].detail }, { url: "/api/scratchpad/attachments/3/view", filename: "" });
});

test("openAttachment di Tauri: tetap URL absolut + ?token= lewat event (perilaku lama)", async () => {
  const n = load({ apiBase: "https://api.x", tauri: true });
  await n.ctx.O("/api/attachments/7/download", "foto.png");
  assert.equal(n.opened.length, 0);
  assert.equal(n.events.length, 1);
  assert.deepEqual({ ...n.events[0].detail },
    { url: "https://api.x/api/attachments/7/download?token=tok-123", filename: "foto.png" });
});

test("openAttachment dengan API_BASE tanpa Tauri: window.open dengan ?token= (tidak berubah)", async () => {
  const x = load({ apiBase: "https://api.x" });
  await x.ctx.O("/api/attachments/7/download", "foto.png");
  assert.equal(x.events.length, 0);
  assert.deepEqual(x.opened.map(a => [...a]), [["https://api.x/api/attachments/7/download?token=tok-123", "_blank"]]);
});

test("fetchAttachmentResponse: header Authorization dari __token saat fetch, URL relatif di web tidak diubah", async () => {
  const w = load();
  assert.ok(w.ctx.F, "fetchAttachmentResponse harus ada");
  w.ctx.__token = "baru-456"; // dibaca saat fetch, bukan saat modul dimuat
  await w.ctx.F("/api/attachments/7/download");
  assert.equal(w.fetches.length, 1);
  assert.equal(w.fetches[0].url, "/api/attachments/7/download");
  assert.equal(w.fetches[0].opts.headers.Authorization, "Bearer baru-456");
  // tanpa token → tanpa header Authorization
  const t = load({ token: null });
  await t.ctx.F("/api/attachments/7/download");
  assert.ok(!(t.fetches[0].opts && t.fetches[0].opts.headers && t.fetches[0].opts.headers.Authorization));
});

test("fetchAttachmentResponse: URL relatif di-resolve dengan API_BASE; URL absolut (Tauri) tidak di-prefix ganda", async () => {
  const n = load({ apiBase: "https://api.x", tauri: true });
  await n.ctx.F("/api/attachments/7/download");
  assert.equal(n.fetches[0].url, "https://api.x/api/attachments/7/download");
  await n.ctx.F("https://api.x/api/attachments/7/download?token=tok-123");
  assert.equal(n.fetches[1].url, "https://api.x/api/attachments/7/download?token=tok-123");
});

test("fetchAttachmentResponse: 401 → 'Sesi berakhir — masuk lagi', status lain → 'HTTP n'", async () => {
  const a = load({ fetchImpl: () => ({ ok: false, status: 401 }) });
  await assert.rejects(a.ctx.F("/api/attachments/7/download"), { message: "Sesi berakhir — masuk lagi" });
  const b = load({ fetchImpl: () => ({ ok: false, status: 404 }) });
  await assert.rejects(b.ctx.F("/api/attachments/7/download"), { message: "HTTP 404" });
  const c = load({ fetchImpl: () => ({ ok: true, status: 200, tag: "x" }) });
  const res = await c.ctx.F("/api/attachments/7/download");
  assert.equal(res.tag, "x");
});

test("AttachmentViewer memakai fetchAttachmentResponse (bukan fetch polos tanpa header)", () => {
  const start = html.indexOf("function AttachmentViewer() {");
  assert.ok(start >= 0);
  const v = html.slice(start, html.indexOf("\n}\n", start));
  assert.match(v, /await fetchAttachmentResponse\(item\.url\)/);
  assert.doesNotMatch(v, /await fetch\(item\.url\)/);
});
