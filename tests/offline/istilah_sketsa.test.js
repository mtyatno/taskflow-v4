"use strict";

// Istilah "Sketsa" untuk fitur drawing (tldraw) di SELURUH app. "Gambar" dikembalikan ke arti
// foto/gambar raster (filter File workspace "Gambar", lampiran gambar). Teks drawing yang DILIHAT
// pengguna memakai "Sketsa"/"sketsa"; identifier (rute/page id `draw`, event `openDrawing`,
// direktif `::draw`, kelas CSS, field data) dan default skema 'Untitled Drawing' di server/offline
// TIDAK berubah. Tes ini membaca index.html sebagai teks (JS biasa, bukan JSX).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const indexHtml = read("static/index.html");
const drawShareJs = read("static/offline/drawingshare.js");
const drawDirectiveJs = read("static/offline/drawdirective.js");

test("teks kunci baru 'Sketsa' ada di index.html", () => {
  // Toolbar note (NoteToolbar): pil "Sketsa" + title
  assert.ok(indexHtml.includes('title: "Sisipkan sketsa yang ada atau buat sketsa baru"'), "title pil toolbar note");
  assert.match(indexHtml, /marginLeft: 4 \} \}, "Sketsa"\)\]\)/, "pil toolbar note harus berlabel Sketsa");
  // Slash menu (grup Sisipkan)
  assert.ok(
    indexHtml.includes("{ glyph: 'pPalette', label: 'Sketsa', type: 'draw', title: 'Sketsa — coretan bebas, diagram, papan tulis' }"),
    "item slash menu harus 'Sketsa'"
  );
  // Nav sidebar + peta judul halaman
  assert.match(indexHtml, /id: "draw",\s*icon: "draw",\s*label: "Sketsa"/, "label nav sidebar");
  assert.ok(indexHtml.includes('draw: "Sketsa"'), "peta judul halaman draw");
  // Dashboard grup Disematkan
  assert.match(indexHtml, /key: "drawings",\s*label: "Sketsa",\s*emptyLabel: "sketsa"/, "grup Disematkan Dashboard");
  assert.match(indexHtml, /navLabel: "Sketsa"/, "navLabel Dashboard");
  assert.ok(indexHtml.includes('"Sketsa tanpa judul"'), "untitled sketsa");
  // Modal sisip di note
  assert.ok(indexHtml.includes('"🎨 Sisipkan Sketsa"'), "judul modal sisip");
  assert.ok(indexHtml.includes('"+ Sketsa Baru"'), "tombol sketsa baru");
  assert.ok(indexHtml.includes('"Judul Sketsa"'), "label judul");
  assert.ok(indexHtml.includes('"Cari sketsa yang sudah ada..."'), "placeholder cari");
  assert.ok(indexHtml.includes('"Tidak ada sketsa ditemukan"'), "kosong");
  // Pencarian global
  assert.ok(indexHtml.includes('"🎨 Sketsa"'), "header pencarian global");
  assert.ok(indexHtml.includes('"Cari task, catatan, mindmap, sketsa, atau tag…"'), "placeholder pencarian global");
  // Halaman Sketsa
  assert.ok(indexHtml.includes('"Editor sketsa"'), "title iframe halaman");
  assert.ok(indexHtml.includes('"Sketsa masih dipakai"'), "dialog masih dipakai");
  assert.ok(indexHtml.includes('"Sketsa terdampak:"'), "dialog keluar workspace");
});

test("literal UI lama untuk drawing sudah tidak ada di index.html", () => {
  const banned = [
    '"Gambar / Canvas"',
    '"🎨 Sisipkan Gambar"',
    '"+ Gambar Baru"',
    '"🎨 Gambar / Drawings"',
    "label: 'Gambar', type: 'draw'",
    'label: "Draw"',
    'navLabel: "Draw"',
    'draw: "Draw"',
    '"Drawing masih dipakai"',
    '"Drawing terdampak:"',
    '"Gambar tanpa judul"',
    '"+ Buat Gambar Pertama"',
    '"Judul Gambar"',
    '"Draw editor"',
    '"Quick Draw editor"',
    '"Belum ada gambar"',
    '"Tidak ada gambar ditemukan"',
    "Klik untuk membuka / mengedit gambar",
    "Gambar tidak tersedia",
    "Gagal memuat gambar",
    "Gagal membuat salinan gambar",
  ];
  for (const s of banned) {
    assert.ok(!indexHtml.includes(s), `literal lama masih ada di index.html: ${s}`);
  }
});

test("judul bawaan, kartu, toast, dan dialog sketsa memakai 'Sketsa'", () => {
  // Judul bawaan sketsa BARU + fallback judul node/kartu ::draw
  assert.ok(indexHtml.includes('useState(drawingTitle || "Sketsa")'), "judul bawaan QuickDrawModal");
  assert.ok(indexHtml.includes('titleInput.trim() || "Sketsa"'), "judul kosong saat simpan");
  assert.ok(indexHtml.includes('`Sketsa - ${noteTitle || "Catatan"}`'), "judul bawaan sketsa baru dari note");
  assert.ok(indexHtml.includes("const titleRaw = attrs.title || 'Sketsa';"), "fallback kartu ::draw (render markdown)");
  assert.ok(indexHtml.includes("title: { default: 'Sketsa' }"), "default atribut node drawing milkdown");
  assert.ok(indexHtml.includes("`🎨 ${title || 'Sketsa'}`"), "fallback judul node drawing milkdown");
  assert.ok(indexHtml.includes("textContent?.replace(/^🎨\\s*/, '') || 'Sketsa'"), "fallback judul dari DOM .note-draw-header");
  assert.ok(!/replace\(\/\^🎨\\s\*\/, ''\) \|\| 'Gambar'/.test(indexHtml), "tidak ada fallback DOM 'Gambar'");
  assert.ok(indexHtml.includes('"Sketsa tanpa judul"'), "fallback tampilan 'Untitled Drawing'");
  assert.ok(!/\|\| "Untitled Drawing"/.test(indexHtml), "tidak ada fallback tampilan 'Untitled Drawing' di index.html");
  // Kartu sketsa di note
  assert.ok(indexHtml.includes("🎨 Klik untuk membuka / mengedit sketsa"), "placeholder kartu");
  assert.ok(indexHtml.includes("🎨 Memuat sketsa..."), "placeholder memuat (milkdown)");
  assert.ok(indexHtml.includes('title="Ubah ukuran frame sketsa"'), "title pil ukuran");
  assert.ok(indexHtml.includes('title="Buka di halaman Sketsa"'), "title tombol Buka");
  assert.ok(indexHtml.includes('"Sketsa tidak tersedia untukmu: sudah dihapus atau tidak dibagikan ke workspace ini."'), "DRAWING_UNAVAILABLE_TEXT");
  assert.ok(indexHtml.includes("'Sketsa tidak tersedia'"), "kartu sketsa tidak tersedia");
  assert.ok(indexHtml.includes('"; bagikan dari halaman Sketsa saat online."'), "toast belum dibagikan");
  assert.ok(indexHtml.includes("Kamu mengedit sketsa milik workspace "), "banner sketsa milik workspace");
  // Halaman Sketsa
  for (const t of ['"+ Sketsa Baru"', '"+ Buat Sketsa Pertama"', '"Buat sketsa pertamamu"', '"Pilih sketsa dari daftar"',
    '"Belum ada sketsa"', '"Nama sketsa baru..."', '"Sematkan sketsa"', '"Gagal membuat sketsa"', '"Gagal mengubah nama sketsa"',
    '"Gagal membagikan sketsa"', '"Muat ulang aplikasi untuk membagikan sketsa."', '"↗️ Buka di Halaman Sketsa"']) {
    assert.ok(indexHtml.includes(t), "string halaman Sketsa hilang: " + t);
  }
  // Share/keluar workspace
  for (const t of ['"Gagal membuat salinan sketsa"', "Gagal menyalin sketsa (", "sketsa tidak ikut dibagikan.", "sketsa tidak bisa diperiksa",
    "Sketsa milikmu di ${w} yang dirujuk note ini:", "Memeriksa sketsa…", "Tidak bisa memeriksa sketsa; coba lagi.",
    "Butuh koneksi untuk membagikan sketsa.", "sketsa ikut dibagikan ke",
    "Note pribadimu menautkan sketsa milik ${w}. Setelah keluar, sketsa itu tidak bisa kamu buka lagi.", '"Salinan sketsa dibuat"']) {
    assert.ok(indexHtml.includes(t), "string berbagi sketsa hilang: " + t);
  }
  // Tur
  assert.ok(indexHtml.includes("Habit Tracker, Notes, Sketsa, Mindmap, dan Diskusi"), "tur sidebar-rail");
  assert.ok(indexHtml.includes("Habit Tracker, Notes & Sketsa, Mindmap, dan Diskusi"), "tur sidebar-general");
});

test("pesan server/offline: 'sketsa' (bukan 'drawing')", () => {
  const wsmanage = read("static/offline/wsmanage.js");
  assert.ok(wsmanage.includes("returned.push(`${drawings} sketsa`)"), "ringkasan hapus workspace");
  assert.ok(!wsmanage.includes("} drawing`"), "tidak ada '… drawing' tersisa di wsmanage.js");
  const repo = read("static/offline/drawingrepo.js");
  assert.ok(repo.includes('new Error("Hanya pemilik sketsa")') && repo.includes('{ detail: "Hanya pemilik sketsa" }'), "galat pemilik offline");
  assert.ok(!repo.includes("Hanya pemilik drawing"));
  assert.ok(read("static/offline/drawingtabs.js").includes('title || "Sketsa tanpa judul"'), "fallback judul tab");
  const web = read("webapp.py");
  assert.ok(web.includes('detail="Hanya pemilik sketsa"'), "galat pemilik server");
  assert.ok(web.includes('detail="Sketsa tidak ditemukan"') && !web.includes('detail="Drawing tidak ditemukan"'), "404 server");
  // Paritas render publik: judul bawaan kartu dan teks 'tidak tersedia' sama dengan klien
  assert.ok(web.includes('title = "Sketsa"') && web.includes(">Sketsa tidak tersedia</div>"), "halaman publik");
  assert.ok(web.includes("^(?:sketsa|gambar|canvas)"), "regex awalan judul ekspor DOCX tetap membersihkan judul lama");
  assert.ok(web.includes('f"Sketsa - {note_title}"') && web.includes('f"Sketsa {did}"'), "judul legacy + fallback ekspor");
  assert.ok(read("docx_exporter.py").includes('f"🎨 [Sketsa: {draw_title}]"'), "placeholder ekspor DOCX");
});

test("yang berarti foto/gambar raster TETAP", () => {
  assert.ok(indexHtml.includes('["image", "Gambar", "fImage"]'), "filter File workspace tetap 'Gambar'");
  assert.ok(indexHtml.includes("spreadsheet, atau gambar dengan tim"), "'Unggah berkas … atau gambar' tetap");
  assert.ok(indexHtml.includes("Paste gambar gagal"), "paste gambar (foto) tetap");
  assert.ok(indexHtml.includes("memproses gambar"), "pesan ekspor Word tetap");
  assert.ok(indexHtml.includes("Gambaran performa kamu"), "'Gambaran' bukan istilah ini");
  assert.ok(indexHtml.includes("Canvas Mindmap"), "tur Canvas Mindmap tetap");
});

test("identifier dan default skema tidak berubah", () => {
  assert.ok(indexHtml.includes('id: "draw"'), "page id draw");
  assert.ok(indexHtml.includes("openDrawing"), "event openDrawing");
  assert.ok(indexHtml.includes("editDrawingModal"), "event editDrawingModal");
  assert.ok(indexHtml.includes("::draw"), "direktif ::draw");
  assert.ok(indexHtml.includes("type: 'draw'"), "type slash menu draw");
  assert.match(read("static/offline/drawingrepo.js"), /"Untitled Drawing"/, "default sinkron drawingrepo.js (base_title) tetap");
});

test("__entityNoun: drawing → 'sketsa'", () => {
  assert.ok(indexHtml.includes('entity === "drawing" ? "sketsa" : "item"'));
  assert.ok(!indexHtml.includes('entity === "drawing" ? "gambar"'));
});

test("drawingshare.js: pesan pengguna memakai 'sketsa'", () => {
  assert.match(drawShareJs, /Butuh koneksi untuk membagikan sketsa\./);
  assert.match(drawShareJs, /Data sketsa belum tersedia offline\./);
  assert.match(drawShareJs, /Sketsa belum tersinkron ke server\./);
  assert.ok(!/Gambar (ini|belum)/.test(drawShareJs), "tidak ada 'Gambar ini/belum' tersisa");
  assert.ok(!/membagikan gambar/.test(drawShareJs));
});

test("drawdirective.js: fallback judul kartu ::draw = 'Sketsa'", () => {
  assert.ok(drawDirectiveJs.includes("'Sketsa'"), "fallback 'Sketsa'");
  assert.ok(!drawDirectiveJs.includes("'Gambar'"), "tidak ada fallback 'Gambar'");
});
