# Komentar Note — PR 3 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Komentar note bisa dipakai dari aplikasi: tombol "Komentar" di pembaca (NotePanel) dan editor (NoteModal), panel samping / lembar bawah, gelembung "Komentari" saat memilih teks, sorotan teks terkutip, badge di daftar catatan, klik notifikasi membuka komentar, dan live update — sesuai mockup yang disetujui.

**Architecture:** Dua modul murni baru yang dites di node: `commentui.js` (hak aksi, waktu relatif, kandidat @mention, model tampilan thread, permintaan buka panel) dan `commenthighlight.js` (memetakan kutipan ke rentang teks DOM, lalu menyorot dengan **CSS Custom Highlight API** — tanpa mengubah DOM maupun markdown, dan tanpa membangun ulang bundle Milkdown). Komponen React (gaya `React.createElement` seperti kode sekitarnya) di `static/index.html`: hook `useNoteComments`, `NoteCommentsPanel`, `CommentSelectionBubble`, lalu dipasang di `NotePanel` dan `NoteModal`. Data lewat rute lokal PR 2 (`/api/scratchpad/:id/comments` …) sehingga offline otomatis.

**Tech Stack:** React 18 tanpa bundler (`React.createElement`), modul UMD `static/offline/*.js`, `node --test`, Playwright (E2E di `temporary_files/`, tidak dijalankan CI).

**Spec:** `docs/superpowers/specs/2026-10-21-komentar-note-design.md` (§7 UI, §3 hak, §5.3 SSE). Mockup: kanvas "Komentar Note Alurik" (Desktop, Mobile, Keadaan khusus).

## Global Constraints

- **Keputusan rencana (menyimpang dari spec §7, dicatat di spec pada Task 7):** sorotan memakai CSS Custom Highlight API (`CSS.highlights`, `new Highlight(...)`), bukan ProseMirror Decoration — satu mekanisme untuk pembaca (HTML statis) dan editor, tanpa rebuild `milkdown.bundle.js`. Browser tanpa API itu: tanpa sorotan, panel tetap jalan. Panel samping dipakai bila **lebar host ≥ 900px** (diukur dengan `ResizeObserver` pada elemen host), selain itu lembar bawah.
- Panel hanya untuk note yang sudah tersimpan dan `list_id != null`.
- Data: `api.get/post/patch/del` ke rute lokal PR 2 — `GET|POST /api/scratchpad/${noteId}/comments`, `PATCH|DELETE /api/note-comments/${id}`, `POST /api/scratchpad/${noteId}/comments/read`. `noteId` = `note.id` (server id atau cid). Thread/balasan disusun dengan `TF.commentrepo.threads(rows, tab)`; isi dipecah dengan `TF.commentrepo.parts(body)`; "Buang" memanggil `TF.commentrepo.discard(cid)`.
- Live: `EventSource(apiUrl("/api/scratchpad/" + serverId + "/comments/stream") + (API_BASE && __token ? "?token=" + encodeURIComponent(__token) : ""))` (pola mindmap, `static/index.html` ±12885); event `comments_changed` → `TF.syncpull.pullComments(window.__syncRawFetch)` lalu muat ulang; `comments_access_lost` → tutup stream. Juga muat ulang pada event window `tf:comments-changed` dan `online`.
- Ikon: `ViewGlyph` duotone yang ada (`fChat` untuk komentar, `fX` tutup, `pCheckCircle` selesaikan, `fTrash` hapus, `pPencil` edit); tanpa emoji di komponen baru. Tanpa aksen `border-left`. Target sentuh ≥ 44px di layar sentuh. Warna lewat token tema (`var(--accent)`, `var(--border)`, `var(--bg-card)`, `var(--text-primary)`, `var(--text-secondary)`) + override `[data-theme="dark"]` bila perlu.
- **Teks UI persis:**
  - Tombol header: `Komentar` + pil jumlah thread terbuka; `aria-label`: `Komentar, {N} terbuka`.
  - Panel: judul `Komentar`; tutup `aria-label="Tutup panel komentar"`; tab `Terbuka · {N}` / `Selesai · {N}`.
  - Kosong: terbuka `Belum ada komentar terbuka. Pilih teks di catatan untuk mengomentari bagian tertentu, atau tulis komentar umum di bawah.`; selesai `Belum ada komentar yang diselesaikan.`
  - Aksi: `Balas`, `Selesaikan`, `Buka lagi`, `Edit`, `Hapus`, `Simpan`, `Batal`; label `diedit`; `Menunggu sinkron`; `Diselesaikan oleh {nama} · {waktu}`.
  - Kutipan hilang: `Bagian ini sudah diubah atau dihapus dari catatan.`
  - Komposer: placeholder `Tulis komentar… ketik @ untuk menyebut anggota`; petunjuk `Ctrl + Enter untuk kirim · terlihat oleh semua anggota {nama workspace}`; tombol `Kirim`; chip `Mengomentari: “{kutipan}”` dengan `aria-label="Lepas kutipan"`; balasan placeholder `Tulis balasan…`.
  - Offline: `Kamu sedang offline. Komentar dikirim otomatis saat tersambung.`
  - Gagal create: `Gagal terkirim.` + `sync_error.message`, tombol `Salin teks` / `Buang`. Gagal ubah (`code === "rejected"`): `Perubahan tidak tersimpan.` + tombol `Tutup` (memanggil `discard`).
  - Dialog hapus: `Hapus komentar ini?` (thread dengan balasan: `Hapus komentar ini beserta balasannya?`), tombol `Batal` / `Hapus`. Tidak memakai `window.confirm`.
  - Gelembung seleksi: `Komentari`; bar bawah layar sentuh: `Komentari teks terpilih`.
  - Badge daftar catatan: `title`/`aria-label` `{N} komentar terbuka` (+ `, ada yang baru` bila `comment_unread`).
  - Toast gagal muat: `Gagal memuat komentar`.
- Kutipan = `selection.toString()` dengan whitespace beruntun jadi satu spasi, di-trim, dipotong 500 karakter.
- Versi: naikkan SW ke nomor kosong berikutnya setelah `main` (saat rencana ditulis v448 → **v449** `taskflow-v449-komentar-ui`) di `static/sw.js`, dua tempat di `static/index.html`, `webapp.py` `sw_cache`, `tests/test_version.py`, dan tes JS yang mematok versi; `app.css?v=` naik (353 → **354**) karena CSS baru.
- Tes: `npm test` (satu kegagalan pra-ada `draw_local_reactive` boleh), `python -m pytest tests/ -q`, `node temporary_files/check_inline_scripts.js` → OK.

## Review Focus

1. **Note pribadi / note baru belum tersimpan** — tombol Komentar dan panel tidak muncul; tidak ada request ke rute komentar. Tes di Task 4 (sumber) dan Task 6 (E2E).
2. **Editor mengetik saat ada sorotan** — sorotan dihitung ulang setelah konten berubah, tidak melempar error, dan sorotan thread yang kutipannya hilang lenyap. Tes di Task 2 (unit) dan Task 6.
3. **Panel terbuka lalu note dipindah/di-unshare atau akses hilang (`comments_access_lost`)** — panel menampilkan daftar kosong tanpa crash, stream ditutup. Tes di Task 3 dan Task 6.
4. **Dua kali klik Kirim / Ctrl+Enter cepat** — tepat satu komentar terbuat. Tes di Task 3 (sumber: tombol nonaktif selama kirim) dan Task 6.
5. **Layar 375px** — lembar bawah tanpa scroll horizontal, komposer terlihat di atas keyboard area aman. Tes di Task 6 (screenshot + `scrollWidth`).

---

## File Structure

| File | Tanggung jawab |
|---|---|
| Create `static/offline/commentui.js` | helper murni: hak, waktu relatif, kandidat mention, model tampilan, kutipan, permintaan buka |
| Create `static/offline/commenthighlight.js` | segmen teks DOM → rentang kutipan → CSS highlights; cari thread pada titik klik |
| Modify `static/index.html` | hook `useNoteComments`, `useHostWide`, `NoteCommentsPanel`, `CommentThreadCard`, `CommentComposer`, `CommentDeleteDialog`, `CommentSelectionBubble`, `NoteCommentsButton`; pasang di `NotePanel` (±31920) dan `NoteModal` (±29585, root ±31850); badge di `note-card` (±34835); klik notifikasi (±40098) |
| Modify `static/app.css` | kelas `.cmt-*` + mode gelap; `::highlight(cmt)` / `::highlight(cmt-active)` |
| Modify `static/sw.js`, `webapp.py`, `tests/test_version.py` | versi |
| Create `temporary_files/e2e_komentar_note.py` | E2E dua akun |
| Tests `tests/offline/commentui.test.js`, `commenthighlight.test.js`, `comment_panel_ui.test.js`, `comment_hosts_ui.test.js`, `comment_list_notif_ui.test.js` | per task |

---

### Task 1: `commentui.js` (murni)

**Files:**
- Create: `static/offline/commentui.js`
- Test: `tests/offline/commentui.test.js`

**Interfaces:**
- Produces `TF.commentui`:
  - `canEdit(c, meId) -> bool` (penulis); `canResolve(thread, meId, noteOwnerId) -> bool` (thread saja: penulis thread atau pemilik note); `canDelete(c, meId, noteOwnerId) -> bool` (penulis atau pemilik note). Perbandingan id dengan `String()`.
  - `relTime(iso, nowMs) -> string`: < 60 dtk `baru saja`; < 60 mnt `{n} menit lalu`; < 24 jam `{n} jam lalu`; hari kalender kemarin `kemarin`; < 7 hari `{n} hari lalu`; selain itu `{d} {Bln} {yyyy}` dengan bulan `Jan Feb Mar Apr Mei Jun Jul Agu Sep Okt Nov Des`. Pakai `Date.parse` (format `Z` dan `+07:00`).
  - `initials(name) -> string` (huruf pertama dua kata pertama, kapital; satu kata → dua huruf pertama).
  - `mentionCandidates(listDetail, meId) -> {id, username, display_name}[]` — owner + members `GET /api/lists/:id`, tanpa duplikat, tanpa diri sendiri.
  - `normalizeQuote(text) -> string` — whitespace beruntun → satu spasi, trim, potong 500.
  - `viewModel(rows, {tab, meId, noteOwnerId, docText}) -> {threads, openCount, doneCount}` — memakai `TF.commentrepo.threads`; tiap thread/balasan diberi `canEdit/canResolve/canDelete`, `anchorLost` (thread ber-`quote` dan `docText` string tetapi `TF.commentanchor.findQuote(docText, quote)` null), `failed` (`sync_error` ada dan `code !== "rejected"`), `rejected` (`code === "rejected"`).
  - `requestOpen(noteId)`, `consumeOpen(noteId) -> bool` — penanda sekali pakai di memori (cocok bila `String(noteId)` sama).
- [ ] **Step 1: Tulis tes gagal** — tiap fungsi: hak untuk penulis/pemilik/orang lain dan balasan (`canResolve` false); `relTime` tiap rentang termasuk `+07:00` dan batas 59 dtk/60 dtk; `initials("Budi Santoso") === "BS"`, `initials("rina") === "RI"`; `mentionCandidates` buang diri + duplikat owner di members; `normalizeQuote("  a\n\n b ")==="a b"` dan panjang 501 → 500; `viewModel` hitungan open/done, `anchorLost`, `failed` vs `rejected`; `consumeOpen` true sekali lalu false.
- [ ] **Step 2: FAIL** → **Step 3: implementasi** (UMD seperti `commentanchor.js`; `TF.commentrepo`/`TF.commentanchor` dibaca saat dipanggil) → **Step 4: PASS** (`node --test tests/offline/commentui.test.js`).
- [ ] **Step 5: Commit** `feat(komentar-ui): helper murni commentui`

### Task 2: `commenthighlight.js`

**Files:**
- Create: `static/offline/commenthighlight.js`
- Test: `tests/offline/commenthighlight.test.js`

**Interfaces:**
- Produces `TF.commenthighlight`:
  - `collectSegments(root) -> {text: string, segments: {node, start, end}[]}` — `document.createTreeWalker(root, NodeFilter.SHOW_TEXT)`; lewati teks di dalam `script, style, button, [contenteditable="false"], .cmt-ignore`. (Hanya browser.)
  - `locate(segments, from, to) -> {startNode, startOffset, endNode, endOffset} | null` — murni: cari segmen yang memuat `from` (start ≤ from < end) dan `to` (start < to ≤ end).
  - `rangesFor(root, threads, doc) -> {id, range}[]` — `collectSegments` + `TF.commentanchor.findQuote(text, thread.quote)` + `locate` → `doc.createRange()`; thread tanpa kutipan atau tidak ketemu dilewati.
  - `supported() -> bool` — `typeof CSS !== "undefined" && CSS.highlights && typeof Highlight === "function"`.
  - `apply(root, threads, activeId) -> {id, range}[]` — bila `supported()`: set `CSS.highlights.set("cmt", new Highlight(...nonActive))` dan `"cmt-active"` untuk thread aktif; tanpa dukungan: hapus dan kembalikan `[]`. Error apa pun ditangkap → `[]`.
  - `clear()` — hapus kedua highlight.
  - `threadAt(entries, node, offset) -> id | null` — thread pertama yang `range.isPointInRange(node, offset)`.
- [ ] **Step 1: Tulis tes gagal** (node, tanpa DOM): `locate` dengan segmen palsu `[{node:"A",start:0,end:5},{node:"B",start:5,end:12}]` → `locate(seg, 2, 9)` = `{startNode:"A",startOffset:2,endNode:"B",endOffset:4}`; batas tepat `locate(seg,5,12)` mulai di `B` offset 0, berakhir `B` 7; di luar → null. `supported()` false di node; `apply` tanpa dukungan → `[]` tanpa melempar. `threadAt` dengan objek range palsu `{isPointInRange: (n,o)=>…}`.
- [ ] **Step 2: FAIL** → **Step 3: implementasi** → **Step 4: PASS** (`node --test tests/offline/commenthighlight.test.js`).
- [ ] **Step 5: Commit** `feat(komentar-ui): commenthighlight (CSS Custom Highlight)`

### Task 3: Panel komentar dan hook data

**Files:**
- Modify: `static/index.html` (blok komponen baru tepat sebelum `function NoteModal({`), `static/app.css`
- Test: `tests/offline/comment_panel_ui.test.js` (cek sumber, pola `*_ui.test.js`: baca `static/index.html` sebagai teks dan potong blok fungsi)

**Interfaces:**
- Consumes: Task 1 (`TF.commentui`), rute lokal PR 2, `TF.commentrepo.threads/parts/discard`, `TF.syncpull.pullComments`, `MentionInput` (`static/ui-components.js`: `value, onChange(e), collaborators, as: "textarea"`), `ViewGlyph`, `api`, `apiUrl`, `API_BASE`, `__token`, `showToast` prop.
- Produces:
  - `useNoteComments(note, {open}) -> {rows, loading, reload, online}` — aktif hanya bila `note && note.id != null && note.list_id != null`; muat `GET /api/scratchpad/${note.id}/comments`; muat ulang pada `tf:comments-changed`, `online`, dan SSE (`note.server_id ?? (angka? note.id)`) selama hook aktif; `comments_access_lost` → tutup stream dan `rows = []`; saat `open` true dan ada komentar → `POST …/comments/read` (paling sering sekali per 10 detik). Gagal muat → `showToast("Gagal memuat komentar", "error")` sekali.
  - `NoteCommentsPanel({note, rows, currentUserId, layout: "side"|"sheet", onClose, quote, onClearQuote, activeId, onActivate, docText, reload, showToast, workspaceName})` — header + tab + daftar + komposer sesuai mockup dan teks persis; `layout:"sheet"` = lembar bawah `position: fixed` tinggi 72vh dengan latar redup yang menutup saat diklik, `Esc` menutup.
  - `CommentThreadCard`, `CommentComposer`, `CommentDeleteDialog` (internal panel).
  - Komposer: `MentionInput as:"textarea"` dengan kandidat dari `GET /api/lists/${note.list_id}` lewat `TF.commentui.mentionCandidates` (gagal → `[]`); tombol `Kirim` nonaktif saat kosong **dan selama request berjalan**; Ctrl/⌘+Enter kirim; setelah kirim: kosongkan, lepas kutipan, `reload()`, tab ke `Terbuka`.
  - Kartu: kutipan (klik → `onActivate(id)`), isi lewat `parts` (mention disorot `.cmt-mention`), meta nama + `relTime` + `diedit`, `Menunggu sinkron`, aksi sesuai hak, balas inline, edit inline (`Simpan`/`Batal`), kartu gagal (`Salin teks` menyalin body ke clipboard / `Buang`), kartu `rejected` (`Tutup`).
  - CSS di `app.css`: `.cmt-panel`, `.cmt-panel--side` (lebar 380px, `border` kiri penuh 1px `var(--border)` — garis pemisah panel, bukan aksen), `.cmt-sheet`, `.cmt-sheet-backdrop`, `.cmt-card`, `.cmt-card.is-active`, `.cmt-quote`, `.cmt-quote.is-lost`, `.cmt-mention`, `.cmt-pending`, `.cmt-failed`, `.cmt-tabs`, `.cmt-composer`, `.cmt-badge`, `.cmt-bubble`, `.cmt-touchbar`, `::highlight(cmt)` (latar `rgba(168,197,0,0.25)`), `::highlight(cmt-active)` (`rgba(168,197,0,0.55)`), varian `[data-theme="dark"]`.
- [ ] **Step 1: Tulis tes gagal** (`comment_panel_ui.test.js`): blok `function useNoteComments` dan `function NoteCommentsPanel` ada; memuat semua teks persis panel/kartu/komposer/dialog/offline dari Global Constraints; memanggil `/comments/read`, `/comments/stream`, `pullComments`, `TF.commentrepo.threads`, `TF.commentrepo.discard`, `TF.commentui.viewModel`, `mentionCandidates`; tidak mengandung `window.confirm(`; app.css memuat `::highlight(cmt)`, `::highlight(cmt-active)`, `.cmt-sheet`, `.cmt-panel--side` dan tidak ada `border-left` di aturan `.cmt-`.
- [ ] **Step 2: FAIL** → **Step 3: implementasi** → **Step 4: PASS**, `npm test`, `node temporary_files/check_inline_scripts.js`.
- [ ] **Step 5: Commit** `feat(komentar-ui): panel komentar + hook data`

### Task 4: Pasang di NotePanel dan NoteModal

**Files:**
- Modify: `static/index.html` (`NotePanel` ±31920–33860; `NoteModal` ±29585–31920; komponen baru `NoteCommentsButton`, `CommentSelectionBubble`, hook `useHostWide(ref, 900)` di blok Task 3)
- Test: `tests/offline/comment_hosts_ui.test.js`

**Interfaces:**
- Consumes: Task 2 (`TF.commenthighlight`), Task 3 komponen.
- Produces:
  - `NoteCommentsButton({count, active, onClick})` — pil seperti tombol header note lain (`border-radius: 20`, ikon `fChat`), `aria-pressed`, teks `Komentar` + pil jumlah.
  - `CommentSelectionBubble({containerRef, onComment})` — dengar `selectionchange`; aktif bila seleksi tak kosong dan berada di dalam `containerRef.current`; desktop: tombol `Komentari` `position: fixed` di atas rect seleksi; `(hover: none)`: bar bawah `Komentari teks terpilih`. Klik → `onComment(TF.commentui.normalizeQuote(sel.toString()))`.
  - `useHostWide(ref, minPx) -> bool` (`ResizeObserver`).
  - **NotePanel:** tombol di baris aksi header (hanya `note.list_id != null`); konten pembaca (`ref: tocSpyRef`) dan panel samping dalam satu baris flex bila lebar; sorotan `TF.commenthighlight.apply(tocSpyRef.current, threadsTerbuka, activeId)` setelah render konten/komentar berubah; klik di konten → `caretPositionFromPoint`/`caretRangeFromPoint` → `threadAt` → buka panel + aktifkan thread; `TF.commentui.consumeOpen(note.id)` saat mount → panel terbuka. `docText` = `textContent` konten untuk `anchorLost`.
  - **NoteModal:** tombol di header (setelah tombol Petakan, hanya `note?.id && noteListId != null`); root (±31850) membungkus area gulir + panel dalam baris flex bila lebar; sorotan pada elemen `.ProseMirror` di dalam editor, dihitung ulang 200 ms setelah `content` berubah; gelembung seleksi pada wadah editor.
  - Klik kutipan di kartu → aktifkan + `scrollIntoView({block:"center"})` pada `range.startContainer.parentElement`.
  - Status buka panel per host diingat di `localStorage` kunci `tf_cmt_panel_open` (try/catch; hanya untuk layout samping).
  - Saat host unmount / note berganti: `TF.commenthighlight.clear()`.
- [ ] **Step 1: Tulis tes gagal** (`comment_hosts_ui.test.js`, cek sumber): blok `function NotePanel` dan `function NoteModal` masing-masing memuat `NoteCommentsButton`, `NoteCommentsPanel`, `CommentSelectionBubble`, `TF.commenthighlight.apply`; NoteModal mensyaratkan `noteListId != null` di samping `note?.id` (Review Focus 1) dan NotePanel `note.list_id != null`; `consumeOpen(` dipanggil di NotePanel; `tf_cmt_panel_open` ada; `useHostWide(` dengan `900`; teks `Komentari` dan `Komentari teks terpilih`.
- [ ] **Step 2: FAIL** → **Step 3: implementasi** → **Step 4: PASS**, `npm test`, cek inline script.
- [ ] **Step 5: Commit** `feat(komentar-ui): komentar di pembaca dan editor note`

### Task 5: Badge daftar, notifikasi, skrip, versi

**Files:**
- Modify: `static/index.html` (`note-card` ±34835; panel notifikasi ±40098; tag `<script>` untuk `commentui.js` dan `commenthighlight.js` setelah `commentroutes.js`), `static/sw.js` (precache + `CACHE`), `webapp.py`, `tests/test_version.py`, tes JS yang mematok versi, `app.css?v=`
- Test: `tests/offline/comment_list_notif_ui.test.js`

**Interfaces:**
- Produces:
  - Badge di judul `note-card` bila `n.comment_open_count > 0`: `span.cmt-badge` (+ `.is-unread` bila `n.comment_unread`) berisi `ViewGlyph fChat 12` + angka, `title`/`aria-label` sesuai teks persis.
  - Notifikasi: item dengan `n.note_id` dapat diklik (kursor pointer seperti item task) → `TF.commentui.requestOpen(n.note_id)`, `setPendingNoteId(n.note_id)`, `setPage("notes")`, tutup panel notifikasi. Item task tetap seperti sekarang.
  - Versi sesuai Global Constraints (cek `git show origin/main:static/sw.js | head -1` dulu).
- [ ] **Step 1: Tulis tes gagal:** sumber note-card memuat `cmt-badge`, `comment_open_count`, `comment_unread`, `komentar terbuka`; panel notifikasi memuat `n.note_id` dan `requestOpen(`; `index.html` memuat `<script src="/static/offline/commentui.js">` dan `commenthighlight.js` setelah `commentroutes.js`; `sw.js` mem-precache keduanya dan versi baru.
- [ ] **Step 2: FAIL** → **Step 3: implementasi** → **Step 4: PASS** — `npm test`, `python -m pytest tests/ -q`, cek inline script.
- [ ] **Step 5: Commit** `feat(komentar-ui): badge daftar catatan, notifikasi membuka komentar, SW v449`

### Task 6: E2E dua akun

**Files:**
- Create: `temporary_files/e2e_komentar_note.py` (pola `temporary_files/e2e_mindmap_live.py`: server uvicorn lokal + DB sementara, dua context Playwright, screenshot ke `temporary_files/e2e_komentar_note/` — tambahkan folder itu ke `.gitignore`)
- Fix: bug apa pun yang ditemukan, di file Task 1–5 (commit `fix(komentar-ui): …` terpisah)

**Skenario (semua harus lulus; keluar non-zero bila gagal):**
1. A (pemilik W) buat note di W; B (anggota) buka note di Notes (pembaca) → tombol `Komentar` ada; note pribadi A → tidak ada tombol (Review Focus 1).
2. B pilih teks → `Komentari` → kirim → kartu tampil dengan kutipan; A menerima notifikasi `… mengomentari catatanmu …`; dalam ≤ 5 dtk panel A (terbuka) menampilkan komentar (SSE).
3. Sorotan: `CSS.highlights.has("cmt")` true di halaman A dan B; klik teks tersorot → kartu `.cmt-card.is-active`.
4. A membalas; B klik notifikasi → halaman Notes terbuka dengan panel komentar terbuka.
5. A `Selesaikan` → pindah ke tab `Selesai` di kedua sisi; `Buka lagi` mengembalikan.
6. A edit teks terkutip di editor → kartu menampilkan `Bagian ini sudah diubah atau dihapus dari catatan.`; mengetik di editor tidak memunculkan error console (Review Focus 2).
7. B offline (`context.set_offline(True)`) → banner offline, kirim → `Menunggu sinkron`; online → label hilang dan A melihat komentar.
8. Klik `Kirim` dua kali cepat → tepat satu komentar di server (Review Focus 4).
9. A pindahkan note ke pribadi saat panel B terbuka → panel B kosong, tanpa error (Review Focus 3).
10. 375 px (terang + gelap): lembar bawah, `document.documentElement.scrollWidth <= 375` (Review Focus 5); badge `cmt-badge` di daftar catatan B.
- [ ] **Step 1:** tulis skrip; jalankan `python3 temporary_files/e2e_komentar_note.py`.
- [ ] **Step 2:** perbaiki kegagalan (TDD: tambahkan tes node/sumber untuk tiap bug bila bisa) sampai semua lulus; `npm test` + pytest hijau.
- [ ] **Step 3: Commit** skrip + `.gitignore` + perbaikan.

### Task 7: Dokumentasi

**Files:**
- Modify: `.agents/CURRENT_STATE.md` (entri teratas `## 🟠 Komentar Note PR 3: UI — \`claude/komentar-note-ui\` — <tanggal> (Claude)`), `.agents/SESSION_LOG.md`, `docs/superpowers/specs/2026-10-21-komentar-note-design.md` §7 (sorotan lewat CSS Custom Highlight API, ambang 900px lebar host, pembaca + editor), §9 (PR 3 selesai)
- [ ] **Step 1:** perbarui dokumen; deploy = file statis saja → restart `taskflow-web`; catat hasil E2E dan sisa diketahui.
- [ ] **Step 2:** `npm test`, pytest, cek inline → hijau.
- [ ] **Step 3: Commit** `docs(agents): komentar note PR 3 UI` (tanpa push).
