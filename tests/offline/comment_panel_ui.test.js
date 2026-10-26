"use strict";

// UI panel komentar note (PR 3, Task 3): hook data useNoteComments + NoteCommentsPanel
// (kartu thread, komposer, dialog hapus) + CSS. Cek sumber: index.html/app.css dibaca sebagai teks.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const appCss = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8").replace(/\r\n/g, "\n");

function fnSource(name) {
  const start = indexHtml.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = indexHtml.indexOf("\n}\n", start + 1);
  assert.ok(end > start, `${name} end must be found`);
  return indexHtml.slice(start, end);
}

// Seluruh blok NoteComments: dari header dependensi sampai function NoteModal.
function blockSource() {
  const start = indexHtml.indexOf("// ═══ DEPENDENCIES: NoteComments ═══");
  assert.ok(start >= 0, "NoteComments block header must exist");
  const end = indexHtml.indexOf("\nfunction NoteModal({", start);
  assert.ok(end > start, "NoteComments block must sit before NoteModal");
  return indexHtml.slice(start, end);
}

// Aturan CSS (selector → isi) untuk selector yang memuat `needle`.
function cssRules(needle) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(appCss))) {
    if (m[1].includes(needle)) out.push({ sel: m[1].trim(), body: m[2] });
  }
  return out;
}

test("script commentui.js + commenthighlight.js dimuat setelah commentroutes.js", () => {
  const routes = indexHtml.indexOf('<script src="/static/offline/commentroutes.js"></script>');
  const ui = indexHtml.indexOf('<script src="/static/offline/commentui.js"></script>');
  const hl = indexHtml.indexOf('<script src="/static/offline/commenthighlight.js"></script>');
  assert.ok(routes >= 0 && ui > routes && hl > ui);
});

test("blok NoteComments memuat semua komponen, tepat sebelum NoteModal", () => {
  const block = blockSource();
  for (const name of ["useNoteComments", "NoteCommentsPanel", "CommentThreadCard", "CommentComposer", "CommentDeleteDialog"]) {
    assert.ok(block.includes(`\nfunction ${name}(`), `${name} in block`);
  }
});

test("useNoteComments: aktif hanya untuk note tersimpan + list_id, rute, SSE, read, toast", () => {
  const src = fnSource("useNoteComments");
  assert.ok(src.includes("note.list_id != null"));
  assert.ok(src.includes("note.id != null"));
  assert.ok(src.includes("/api/scratchpad/${"));
  assert.ok(src.includes("/comments`"));
  assert.ok(src.includes("/comments/read"));
  assert.ok(src.includes("/comments/stream"));
  assert.ok(src.includes("new EventSource("));
  assert.ok(src.includes("API_BASE && __token"));
  assert.ok(src.includes("encodeURIComponent(__token)"));
  assert.ok(src.includes("comments_changed"));
  assert.ok(src.includes("comments_access_lost"));
  assert.ok(src.includes("pullComments(window.__syncRawFetch)"));
  assert.ok(src.includes('"tf:comments-changed"'));
  assert.ok(src.includes('"online"'));
  assert.ok(src.includes("TF.commentrepo.threads"));
  assert.ok(src.includes("10000"), "read paling sering sekali per 10 detik");
  assert.ok(src.includes('"Gagal memuat komentar", "error"'));
  assert.ok(src.includes("server_id"));
});

test("useNoteComments: akses hilang → stream ditutup dan rows kosong", () => {
  const src = fnSource("useNoteComments");
  const i = src.indexOf('"comments_access_lost"');
  assert.ok(i >= 0);
  const tail = src.slice(i, i + 400);
  assert.ok(tail.includes("setRows([])"));
  assert.ok(/close\w*\(\)/.test(tail));
});

test("NoteCommentsPanel: teks persis header/tab/kosong/offline + viewModel", () => {
  const src = fnSource("NoteCommentsPanel");
  assert.ok(src.includes("TF.commentui.viewModel"));
  assert.ok(src.includes("mentionCandidates"));
  assert.ok(src.includes("/api/lists/${note.list_id}"));
  assert.ok(src.includes('"Komentar"'));
  assert.ok(src.includes('"aria-label": "Tutup panel komentar"'));
  assert.ok(src.includes('name: "fX"'));
  assert.ok(src.includes('"Terbuka · "'));
  assert.ok(src.includes('"Selesai · "'));
  assert.ok(src.includes("Belum ada komentar terbuka. Pilih teks di catatan untuk mengomentari bagian tertentu, atau tulis komentar umum di bawah."));
  assert.ok(src.includes("Belum ada komentar yang diselesaikan."));
  assert.ok(src.includes("Kamu sedang offline. Komentar dikirim otomatis saat tersambung."));
  assert.ok(src.includes("navigator.onLine"));
  assert.ok(src.includes("cmt-panel--side"));
  assert.ok(src.includes("cmt-sheet"));
  assert.ok(src.includes("cmt-sheet-backdrop"));
  assert.ok(src.includes('"Escape"'));
  assert.ok(src.includes('"workspace"'), "fallback nama workspace");
});

test("CommentThreadCard: aksi, label, kutipan hilang, gagal/rejected, ikon", () => {
  const src = fnSource("CommentThreadCard");
  for (const s of ['"Balas"', '"Selesaikan"', '"Buka lagi"', '"Edit"', '"Hapus"', '"Simpan"', '"Batal"',
    '"diedit"', '"Menunggu sinkron"', '"Diselesaikan oleh "', '"Salin teks"', '"Buang"', '"Tutup"',
    '"Bagian ini sudah diubah atau dihapus dari catatan."', '"Gagal terkirim."', '"Perubahan tidak tersimpan."',
    '"Tulis balasan…"', '"Teks disalin"']) {
    assert.ok(src.includes(s), `card text ${s}`);
  }
  for (const g of ['name: "pCheckCircle"', 'name: "fTrash"', 'name: "pPencil"', 'name: "fChat"']) {
    assert.ok(src.includes(g), `glyph ${g}`);
  }
  assert.ok(src.includes("TF.commentrepo.parts"));
  assert.ok(src.includes("TF.commentrepo.discard"));
  assert.ok(src.includes("cmt-mention"));
  assert.ok(src.includes("cmt-quote"));
  assert.ok(src.includes("is-lost"));
  assert.ok(src.includes("is-active"));
  assert.ok(src.includes("onActivate("));
  assert.ok(src.includes("relTime("));
  assert.ok(src.includes("navigator.clipboard.writeText"));
  assert.ok(src.includes("/api/note-comments/${"));
  assert.ok(src.includes("api.patch("));
  assert.ok(src.includes("resolved:"));
  assert.ok(src.includes("canEdit") && src.includes("canResolve") && src.includes("canDelete"));
});

test("CommentComposer: placeholder, petunjuk, chip kutipan, Kirim terkunci selama request", () => {
  const src = fnSource("CommentComposer");
  assert.ok(src.includes("MentionInput"));
  assert.ok(src.includes('as: "textarea"'));
  assert.ok(src.includes("Tulis komentar… ketik @ untuk menyebut anggota"));
  assert.ok(src.includes("Ctrl + Enter untuk kirim · terlihat oleh semua anggota "));
  assert.ok(src.includes('"Kirim"'));
  assert.ok(src.includes('"Mengomentari: “"'));
  assert.ok(src.includes('"aria-label": "Lepas kutipan"'));
  assert.ok(src.includes("api.post(`/api/scratchpad/${"));
  assert.ok(src.includes("sendingRef.current"), "guard ref anti kirim ganda");
  assert.ok(/disabled: [^,]*sending/.test(src), "Kirim nonaktif selama request");
  assert.ok(src.includes("!text.trim()"), "Kirim nonaktif saat kosong");
  assert.ok(src.includes("ctrlKey") && src.includes("metaKey") && src.includes('"Enter"'));
  assert.ok(src.includes("onClearQuote"));
  assert.ok(src.includes("reload()"));
});

test("CommentDeleteDialog: dialog in-app, teks persis, Esc, tanpa window.confirm", () => {
  const src = fnSource("CommentDeleteDialog");
  assert.ok(src.includes('role: "dialog"'));
  assert.ok(src.includes('"aria-modal": "true"'));
  assert.ok(src.includes("Hapus komentar ini?"));
  assert.ok(src.includes("Hapus komentar ini beserta balasannya?"));
  assert.ok(src.includes('"Batal"') && src.includes('"Hapus"'));
  assert.ok(src.includes('"Escape"'));
  assert.ok(src.includes(".focus()"), "fokus kembali");
  assert.ok(!blockSource().includes("window.confirm("));
  assert.ok(!blockSource().includes("confirm("));
});

test("blok NoteComments tanpa emoji", () => {
  const block = blockSource();
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(block), "no emoji in NoteComments block");
});

test("app.css: aturan .cmt-* dan highlight, tanpa border-left", () => {
  assert.ok(/::highlight\(cmt\)\s*\{[^}]*rgba\(var\(--accent-rgb\),\s*0\.25\)/.test(appCss));
  assert.ok(/::highlight\(cmt-active\)\s*\{[^}]*rgba\(var\(--accent-rgb\),\s*0\.55\)/.test(appCss));
  for (const sel of [".cmt-panel", ".cmt-panel--side", ".cmt-sheet", ".cmt-sheet-backdrop", ".cmt-card", ".cmt-card.is-active",
    ".cmt-quote", ".cmt-quote.is-lost", ".cmt-mention", ".cmt-pending", ".cmt-failed", ".cmt-tabs", ".cmt-composer",
    ".cmt-badge", ".cmt-bubble", ".cmt-touchbar"]) {
    assert.ok(cssRules(sel).length > 0, `css ${sel}`);
  }
  const side = cssRules(".cmt-panel--side").map((r) => r.body).join("\n");
  assert.ok(side.includes("380px"));
  assert.ok(side.includes("1px solid var(--border)"), "garis pemisah panel 1px var(--border)");
  const sheet = cssRules(".cmt-sheet").filter((r) => !r.sel.includes("backdrop")).map((r) => r.body).join("\n");
  assert.ok(sheet.includes("position: fixed"));
  assert.ok(sheet.includes("72vh"));
  for (const r of cssRules(".cmt-")) assert.ok(!/border-left/.test(r.body), `no border-left in ${r.sel}`);
  assert.ok(cssRules('[data-theme="dark"] .cmt-').length > 0, "dark overrides");
});

// ── Perbaikan review ronde 1 ──
const uiComponents = fs.readFileSync(path.resolve(__dirname, "../../static/ui-components.js"), "utf8").replace(/\r\n/g, "\n");

test("MentionInput: Esc di dropdown memanggil preventDefault (lembar komentar tidak ikut tertutup)", () => {
  const i = uiComponents.indexOf('} else if (e.key === "Escape") {');
  assert.ok(i >= 0, "Escape branch exists");
  const branch = uiComponents.slice(i, uiComponents.indexOf("} else {", i));
  assert.ok(branch.includes("e.preventDefault()"));
  assert.ok(branch.includes("setMentionState(null)"));
  // Panel melewati Esc yang sudah ditangani.
  assert.ok(fnSource("NoteCommentsPanel").includes("e.defaultPrevented"));
});

test("useNoteComments: tandai dibaca dengan POST susulan (setTimeout + clearTimeout) dan POST akhir saat ditutup", () => {
  const src = fnSource("useNoteComments");
  const i = src.indexOf("Tandai dibaca");
  assert.ok(i >= 0);
  const read = src.slice(i);
  assert.ok(/setTimeout\(\(\) => \{[^}]*postRead\(\)/.test(read), "trailing POST dijadwalkan");
  assert.ok(read.includes("10000 - (Date.now() - lastReadRef.current)"), "sisa waktu throttle");
  assert.ok(read.includes("clearTimeout(readTimerRef.current)"), "timer dibersihkan di cleanup");
  assert.ok(read.includes("wasOpen && !open"), "POST akhir saat panel ditutup");
  assert.ok(read.includes("st.sig !== lastReadSigRef.current"), "hanya bila ada yang baru");
  assert.ok(read.includes("/comments/read"));
});

test("NoteCommentsPanel: status online dari hook (prop), tanpa pendengar online/offline sendiri", () => {
  const src = fnSource("NoteCommentsPanel");
  const sig = src.slice(0, src.indexOf(") {"));
  assert.ok(sig.includes("online"));
  assert.ok(!src.includes('addEventListener("offline"'));
  assert.ok(!src.includes('addEventListener("online"'));
  assert.ok(src.includes("!isOnline ?"));
});

test("useNoteComments: note hilang dari lokal (dipindah ke pribadi / di-unshare, terlihat lewat sync) → rows kosong, stream ditutup, tanpa toast", () => {
  const src = fnSource("useNoteComments");
  // pull note dari sync menghapus/memindah note → muat ulang komentar
  assert.ok(src.includes('addEventListener("noteSaved"'), "dengarkan noteSaved");
  assert.ok(src.includes('removeEventListener("noteSaved"'), "pendengar noteSaved dilepas");
  // galat rute lokal "Note not found" = akses hilang, bukan gagal muat
  const i = src.indexOf("noteGone(err)");
  assert.ok(i >= 0, "reload memeriksa noteGone(err)");
  const branch = src.slice(i, i + 300);
  assert.ok(branch.includes("setRows([])"), "rows dikosongkan");
  assert.ok(branch.includes("setGone(true)"), "tandai gone");
  assert.ok(branch.indexOf("return") < branch.indexOf("Gagal memuat komentar") || !branch.includes("Gagal memuat komentar"),
    "tanpa toast gagal muat");
  assert.ok(/__local\s*&&\s*\/note not found\/i/.test(fnSource("noteGone")), "deteksi galat lokal note not found");
  // stream SSE tidak dibuka / ditutup selama gone
  assert.ok(src.includes("if (!live || serverId == null || gone ||"), "SSE berhenti saat gone / tidak live");
  assert.ok(src.includes("}, [serverId, listId, reload, gone, live]);"), "efek SSE bergantung pada gone dan live");
});
