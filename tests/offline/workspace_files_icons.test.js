const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const indexHtml = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");
const appCss = fs.readFileSync(path.join(__dirname, "../../static/app.css"), "utf8");

const start = indexHtml.indexOf("function WorkspaceFilesView(");
const end = indexHtml.indexOf("// ── Pesan Pribadi (DM 1-on-1)", start);
assert.ok(start > 0 && end > start, "WorkspaceFilesView source slice");
const view = indexHtml.slice(start, end);
// Teks toast dan isi pesan chat "📎 nama" bukan ikon UI.
const uiLines = view.split("\n").filter(l => !/showToast\(/.test(l) && !/content:\s*"📎 "/.test(l)).join("\n");

const NEW_KEYS = ["fFolder", "fPdf", "fSheet", "fImage", "fFile", "fSearch", "fUpload", "fDownload", "fEye", "fChat", "fPin", "fTrash", "fX"];

test("WorkspaceFilesView bebas emoji ikon (literal maupun escape \\u)", () => {
  const literal = /[\u{1F300}-\u{1FAFF}☀-➿⬀-⯿️]/u;
  const m = uiLines.match(literal);
  assert.ok(!m, "emoji literal tersisa: " + (m && m[0]));
  const esc = uiLines.match(/\\u(?:D83[CD]|D83E|2[67][0-9A-F]{2}|2B[0-9A-F]{2}|FE0F)/i);
  assert.ok(!esc, "emoji escape tersisa: " + (esc && esc[0]));
});

test("VIEW_GLYPHS memuat semua glyph berkas baru", () => {
  const block = indexHtml.slice(indexHtml.indexOf("const VIEW_GLYPHS = {"), indexHtml.indexOf("function ViewGlyph("));
  for (const k of NEW_KEYS) assert.match(block, new RegExp("\\b" + k + ":\\s*'<"), "glyph " + k);
});

test("getFileIcon mengembalikan nama glyph", () => {
  const fn = view.slice(view.indexOf("const getFileIcon"), view.indexOf("const filteredFiles"));
  for (const [cat, g] of [["pdf", "fPdf"], ["image", "fImage"], ["document", "fSheet"]]) {
    assert.match(fn, new RegExp('cat === "' + cat + '"\\) return "' + g + '"'));
  }
  assert.match(fn, /return "fFile"/);
  assert.ok(!/fFolder/.test(fn), "kategori lain = file, bukan folder");
});

test("kartu berkas: tile 40x40 + ViewGlyph ukuran 22", () => {
  assert.match(view, /width: 40,\s*height: 40/);
  assert.match(view, /React\.createElement\(ViewGlyph,\s*\{\s*name:\s*getFileIcon\(f\),\s*size:\s*22\s*\}\)/);
});

test("pencarian: placeholder tanpa emoji, wrapper merender fSearch, paddingLeft 36", () => {
  assert.match(view, /placeholder: "Cari nama berkas\.\.\."/);
  assert.match(view, /name:\s*"fSearch",\s*size:\s*16/);
  assert.match(view, /paddingLeft: 36|padding: "6px 30px 6px 36px"/);
  assert.match(view, /name:\s*"fX",\s*size:\s*14/);
});

test("header, tombol, chip, state kosong, provenance, aksi memakai ViewGlyph", () => {
  for (const [k, s] of [["fFolder", 22], ["fUpload", 15], 
    ["fFolder", 30], ["fSearch", 26], ["fChat", 13], ["fPin", 13], ["fEye", 14], ["fDownload", 14], ["fChat", 14], ["fTrash", 14]]) {
    assert.match(view, new RegExp('name:\\s*"' + k + '",\\s*size:\\s*' + s + "\\b"), k + " " + s);
  }
  assert.match(view, /\["pdf", "PDF", "fPdf"\], \["document", "Dokumen\/Sheet", "fSheet"\], \["image", "Gambar", "fImage"\], \["other", "Lainnya", "fFile"\]/);
  assert.match(view, /name:\s*glyph,\s*size:\s*14/);
  assert.match(view, /className: "wsf-title-ico"/);
  assert.match(view, /Berkas Workspace/);
  assert.match(view, /"Mengunggah\.\.\."/);
});

test("CSS wsf-title-ico terang + gelap", () => {
  assert.match(appCss, /\.wsf-title-ico\s*\{\s*color:\s*#7E9400;\s*\}/);
  assert.match(appCss, /\[data-theme="dark"\]\s*\.wsf-title-ico\s*\{\s*color:\s*var\(--accent\);\s*\}/);
});

test("cache bust v432 + app.css?v=353", () => {
  const swJs = fs.readFileSync(path.join(__dirname, "../../static/sw.js"), "utf8");
  const py = fs.readFileSync(path.join(__dirname, "../../webapp.py"), "utf8");
  assert.match(swJs, /^const CACHE = "taskflow-v447-kelola-workspace-fase2a";/m);
  assert.match(indexHtml, /window\.__SW_VERSION\s*=\s*"taskflow-v447-kelola-workspace-fase2a";/);
  assert.match(indexHtml, /window\.__SW_VERSION\s*\|\|\s*"taskflow-v447-kelola-workspace-fase2a"/);
  assert.match(py, /sw_cache = "taskflow-v447-kelola-workspace-fase2a"/);
  assert.match(indexHtml, /app\.css\?v=353/);
});
