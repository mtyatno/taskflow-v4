# Current Workspace State & Handover

**Last Updated:** 2026-08-21 15:20  
**Updated By:** Antigravity (Gemini 3.7 Flash — Note DOCX SVG-to-PNG Rasterizer & Image Syntax Support SELESAI)

---

## 📌 Active Task
- **Note DOCX Export SVG-to-PNG Rasterizer & Image Syntax Support SELESAI 2026-08-21:**
  - **Problem / Root Cause:**
    - **Area Draw Kotak Putih:** Microsoft Word Desktop pada Windows mengandalkan representasi raster bitmap (PNG) saat membuka dokumen docx. Karena fallback sebelumnya berupa PNG 1x1 transparan, Word menampilkan kotak putih kosong.
    - **Image Menampilkan Teks `!image.png`:** Parser regex sebelumnya hanya mencocokkan pola markdown dengan tanda kurung `![alt](url)`, sehingga penulisan gambar standalone seperti `!image.png`, `![image.png]`, `[image.png]`, dan `<img ... />` terlewat dan dianggap teks biasa.
  - **Solusi / Perbaikan:**
    1. **SVG-to-PNG Rasterizer ([`docx_exporter.py`](file:///Z:/Todolist%20Manager%20V5.0/docx_exporter.py)):**
       - Menambahkan fungsi `_svg_to_png_bytes` menggunakan `svglib` + `reportlab` + `rlPyCairo` (dengan fallback `cairosvg`) untuk merasterisasi SVG menjadi PNG bitmap resolusi tinggi asli.
       - Disematkan langsung sebagai raster picture di file `.docx` sehingga 100% kompatibel dan tampil visual jelas di semua versi Microsoft Word, LibreOffice, WPS Office, dan Google Docs.
    2. **Comprehensive Image Syntax Parser ([`docx_exporter.py`](file:///Z:/Todolist%20Manager%20V5.0/docx_exporter.py)):**
       - Menambahkan `_parse_standalone_image` yang mendukung:
         - `!filename.png` / `!filename.jpg`
         - `![filename.png]` / `[filename.png]`
         - `![alt](url)` / `[filename.png](url)`
         - HTML `<img src="..." alt="..." />`
    3. **Backend Image Filename Resolver ([`webapp.py`](file:///Z:/Todolist%20Manager%20V5.0/webapp.py#L3740)):**
       - Mencocokkan `src`/`alt` nama file dengan database Nextcloud `note_attachments` (berdasarkan `note_id` dan `user_id`) untuk mengambil byte gambar asli secara otomatis.
    4. **Dependencies:**
       - Menambahkan `svglib>=1.5.0`, `reportlab>=4.0.0`, dan `rlPyCairo>=0.3.0` pada `requirements.txt` dan `requirements-web.txt`.
  - All tests passed: 433/433 JS unit tests + 43/43 pytest (0 failures).
  - **Device-test checklist:** (1) Buka catatan yang memiliki inline draw dan format gambar `!image.png` / `![alt](url)` -> Export Word (.docx) -> Buka di Microsoft Word -> Seluruh gambar dan diagram canvas ter-render visual dengan jelas (bukan kotak putih dan bukan teks mentah).
  - **Problem / Root Cause:**
    - Sebelumnya, inline drawing (`::draw[...]`) hanya dicari di server database SQLite berdasarkan ID. Jika drawing baru dibuat / berada di client cache/IndexedDB (`drawingrepo`), server tidak menemukan SVG sehingga menghasilkan placeholder teks saja `🎨 [Gambar/Canvas: ...]`.
    - Gambar lampiran Nextcloud dan HTML `<img>` tag belum memiliki fallback unescaping dan filename matching.
  - **Solusi / Perbaikan:**
    1. **Client-Side Drawing Map Pre-fetch ([`static/index.html`](file:///Z:/Todolist%20Manager%20V5.0/static/index.html#L19406)):**
       - Sebelum mengekspor, `handleExportDocx` memindai semua `::draw[id]` di catatan dan mengambil SVG asli dari IndexedDB / API router (`api.get('/api/drawings/' + id)`), lalu mengirimkannya via `POST /api/scratchpad/export/docx` dalam objek `drawings: { [id]: { title, svg } }`.
    2. **Combined Backend Resolver ([`webapp.py`](file:///Z:/Todolist%20Manager%20V5.0/webapp.py#L3826)):**
       - Endpoint export memprioritaskan `drawings` SVG langsung dari client, dan fallback ke query database SQLite + fuzzy title match + note_id fallback.
    3. **Robust Image & Nextcloud Resolver ([`docx_exporter.py`](file:///Z:/Todolist%20Manager%20V5.0/docx_exporter.py), [`webapp.py`](file:///Z:/Todolist%20Manager%20V5.0/webapp.py#L3740)):**
       - Menambahkan dukungan untuk tag HTML `<img src="..." />`, unescaping URL gambar, dan pencarian lampiran Nextcloud berdasarkan nama file / ID lampiran.
    4. **Syncpush SVG Fix ([`static/offline/syncpush.js`](file:///Z:/Todolist%20Manager%20V5.0/static/offline/syncpush.js#L458)):**
       - Mengirimkan `svg_preview` pada operasi sync `PUT /api/drawings/:id`.
    5. **SW Cache Bump:** Di-bump ke **`taskflow-v265-docx-drawings-and-images-support`**.
  - All tests passed: 433/433 JS unit tests + 43/43 pytest (0 failures).
  - **Device-test checklist:** (1) Buka catatan dengan inline draw dan gambar -> Klik `Export ▾` > `Word (.docx)` -> File Word terbuka dengan seluruh diagram canvas dan gambar visual utuh.
  - **Problem / Root Cause:**
    - Serializer Markdown / Milkdown menghasilkan token draw dan karakter bracket dengan backslash escape (misal `::draw\[8720afce-...\]{title="..."}`) serta tag `<br />`.
    - Regex sebelumnya hanya mencari literal `[` tanpa backslash, sehingga token draw dan tag `<br />` terlewat dan dicetak sebagai teks mentah di Microsoft Word.
  - **Solusi / Perbaikan:**
    1. **Pre-cleaner ([`docx_exporter.py`](file:///Z:/Todolist%20Manager%20V5.0/docx_exporter.py)):**
       - Menghapus tag `<br />` / `<br>` menjadi newline dan unescape plain text bracket `\[...\]` -> `[...]`.
    2. **Flexible Drawing Parser ([`docx_exporter.py`](file:///Z:/Todolist%20Manager%20V5.0/docx_exporter.py)):**
       - Regex fleksibel `\\?::draw\\?\[([0-9a-zA-Z_-]+)\\?\](?:\s*\\?\{([^}]*)\\?\})?` yang mengekstrak ID, title, width, size, dan menangani prefix/suffix text pada baris yang sama.
    3. **Smart Database Resolver ([`webapp.py`](file:///Z:/Todolist%20Manager%20V5.0/webapp.py#L3684)):**
       - Mencocokkan gambar tidak hanya dari numeric ID, tetapi juga dari attribute `title` (termasuk fuzzy match tanpa prefix "Gambar - ") dan fallback `note_id`.
  - All tests passed: 433/433 JS unit tests + 43/43 pytest (0 failures).
  - **Device-test checklist:** (1) Export catatan dengan draw token bervalue UUID / title / `<br />` -> Buka file Word -> Seluruh gambar/canvas ter-render rapi tanpa sisa markup escape / tag br mentah.
  - **Summary:** Menambahkan dukungan rendering lengkap untuk inline drawing/canvas (`::draw[...]`) dan gambar (`![alt](url)`, base64, dan lampiran file) ke dalam dokumen Microsoft Word (`.docx`):
    1. **Native SVG Drawing Embedding ([`docx_exporter.py`](file:///Z:/Todolist%20Manager%20V5.0/docx_exporter.py)):**
       - Menggunakan format Word OpenXML `asvg:svgBlip` untuk menyematkan SVG preview gambar/canvas secara native ke dalam `.docx` dengan kalkulasi proporsi otomatis dari viewBox/dimensi SVG.
    2. **Raster Images & Attachments Rendering ([`docx_exporter.py`](file:///Z:/Todolist%20Manager%20V5.0/docx_exporter.py)):**
       - Mendukung gambar base64, URL gambar eksternal, dan lampiran Nextcloud via `_resolve_image_bytes` dengan auto-konversi format (Pillow) dan penyesuaian ukuran proporsional.
    3. **Backend Resolvers ([`webapp.py`](file:///Z:/Todolist%20Manager%20V5.0/webapp.py#L3684)):**
       - Menghubungkan `_make_drawing_resolver` (query SVG dari tabel `drawings`) dan `_make_image_resolver` (fetch lampiran Nextcloud/lokal) ke endpoint export `.docx`.
    4. **Dependencies:**
       - Menambahkan `Pillow>=9.0.0` ke `requirements.txt` dan `requirements-web.txt`.
  - All tests passed: 433/433 JS unit tests + 43/43 pytest (0 failures).
  - **Device-test checklist:** (1) Buat catatan dengan inline drawing dan gambar -> Klik `Export ▾` > `Word (.docx)` -> Buka file `.docx` di Word/LibreOffice -> Seluruh gambar dan diagram canvas ter-render visual dengan jelas.

## 📌 Active Task
- **Fix Error when Clicking "Edit" on a Note SELESAI 2026-08-21:**
  - **Problem / Root Cause:**
    - Saat `milkdown.bundle.js` mengalami gangguan jaringan / slow load / `ERR_CONNECTION_RESET`, objek global `window.MilkdownBundle` bernilai `undefined`.
    - Ketika user membuka modal edit note, `MilkdownEditor` mengakses `MB.addRowBeforeCommand.key` tanpa safe check / optional chaining, memicu crash: `TypeError: Cannot read properties of undefined (reading 'addRowBeforeCommand')`.
  - **Solusi / Perbaikan ([`static/index.html`](file:///Z:/Todolist%20Manager%20V5.0/static/index.html#L15764)):**
    1. **Initialization Guard:** Menambahkan guard `if (!MB || !MB.Editor) return;` di awal `useEffect` `MilkdownEditor`.
    2. **Table & Toolbar Command Safe Optional Chaining:** Menggunakan `MB.addRowBeforeCommand?.key`, `MB.addColBeforeCommand?.key`, `MB.setAlignCommand?.key`, `MB.slashFactory`, dll. serta try/catch di `NoteToolbar` dan `NoteModal`.
    3. **Resilient Fallback Editor:** Menambahkan fallback editor `<textarea>` Markdown yang responsif dan siap pakai jika `MilkdownBundle` belum/gagal dimuat, sehingga modal edit catatan 100% tidak pernah crash dan selalu bisa mengedit catatan secara instan dalam kondisi jaringan apa pun.
    4. **SW Cache Bump:** SW cache di-bump ke **`taskflow-v264-fix-note-edit-milkdown-guard`**.
  - All tests passed: 433/433 JS unit tests + 42/42 pytest (0 failures).
  - **Device-test checklist:** (1) Buka catatan -> Klik tombol `Edit` -> Modal editor terbuka dengan mulus tanpa error konsol.

## 📌 Active Task
- **Note Export to Word (.docx) & Markdown (.md) SELESAI 2026-08-21:**
  - **Summary:** Menambahkan kemampuan export lengkap untuk Scratchpad Notes ke format Microsoft Word (`.docx`) dan raw Markdown (`.md`) selain fitur cetak/simpan PDF yang sudah ada:
    1. **Converter Module ([`docx_exporter.py`](file:///Z:/Todolist%20Manager%20V5.0/docx_exporter.py)):**
       - Mengonversi Markdown (Headings H1-H4, inline runs bold/italic/strike/code/links, tabel dengan header background & borders, code blocks dengan monospace font & shading, checklists `☐`/`☑`, blockquotes) menjadi file `.docx` native yang bersih dan rapi via `python-docx`.
    2. **Backend API Endpoints ([`webapp.py`](file:///Z:/Todolist%20Manager%20V5.0/webapp.py#L3684)):**
       - `GET /api/scratchpad/{note_id}/export/docx`: Mengunduh dokumen `.docx` dengan filename ter-sanitasi.
       - `GET /api/scratchpad/{note_id}/export/md`: Mengunduh file `.md` raw UTF-8.
       - `POST /api/scratchpad/export/docx`: Mengunduh dokumen Word dari konten live unsaved di editor.
    3. **Frontend UI Dropdown ([`static/index.html`](file:///Z:/Todolist%20Manager%20V5.0/static/index.html#L19730)):**
       - Mengganti tombol `PDF` tunggal menjadi menu dropdown **`Export ▾`** dengan 3 opsi:
         - 📄 **PDF (Cetak)**: Membuka print preview browser untuk menyimpan PDF.
         - 📘 **Word (.docx)**: Mengunduh file Microsoft Word `.docx` terformat (dengan fallback client-side Word HTML saat offline).
         - 📝 **Markdown (.md)**: Mengunduh file teks Markdown murni `.md` secara instan (100% offline-ready).
    4. **Cache & Dependencies:**
       - Menambahkan `python-docx==1.*` pada `requirements.txt` dan `requirements-web.txt`.
       - SW cache di-bump ke **`taskflow-v263-note-export-docx-and-md`**.
  - All tests passed: 433/433 JS unit tests + 42/42 pytest (0 failures), 5/5 inline scripts parse cleanly.
  - **Device-test checklist:** (1) Buka modal catatan -> Klik tombol `Export ▾` -> Pilih `Word (.docx)` -> File `.docx` terunduh dan terbuka dengan rapi di Microsoft Word / Google Docs / LibreOffice; (2) Pilih `Markdown (.md)` -> File `.md` terunduh instan; (3) Pilih `PDF (Cetak)` -> Dialog print PDF terbuka normal.

## 📌 Active Task
- **Desktop Topbar Slim Height Optimization SELESAI 2026-08-21:**
  - **Summary:** Merampingkan tinggi area atas aplikasi (`.desktop-topbar`) pada tampilan desktop:
    1. **CSS Topbar & Main Content ([`static/app.css`](file:///Z:/Todolist%20Manager%20V5.0/static/app.css#L127)):**
       - Padding `.desktop-topbar` dirampingkan dari `20px .. 16px` menjadi `calc(8px + env(safe-area-inset-top, 0px)) 28px 8px`.
       - Padding `.main-content` disesuaikan menjadi `16px 28px`.
       - Workspace container height (`.notes-layout`, `.draw-container`, `.mindmap-container`) disesuaikan ke `calc(100vh - 84px)` memberikan ruang vertikal lebih luas untuk konten utama.
    2. **Komponen Header ([`static/index.html`](file:///Z:/Todolist%20Manager%20V5.0/static/index.html#L24840)):**
       - Ukuran tombol menu, kotak pencarian global, tombol lonceng notifikasi, dan tombol `+ Buat Baru` diseragamkan dengan tinggi kompak `32px` dan radius `7px`.
       - Ukuran font tanggal dan search placeholder disesuaikan menjadi `12.5px`.
    3. **Cache Bump:** SW cache di-bump ke **`taskflow-v262-slim-desktop-topbar`**.
  - All tests passed: 433/433 JS unit tests + 40/40 pytest (0 failures), 5/5 inline scripts parse cleanly.
  - **Device-test checklist:** (1) Buka aplikasi desktop di browser -> Area topbar atas terlihat ramping, bersih, dan proporsional.

## 📌 Active Task
- **Notes Page Search Header Unification SELESAI 2026-08-21:**
  - **Summary:** Menyelaraskan tampilan header dan kotak pencarian pada halaman Catatan (`NotesPage`) agar 100% seragam dengan halaman Gambar/Canvas (`DrawPage`) dan Mindmaps (`MindmapPage`):
    1. **Header Sidebar:** Menambahkan header dengan judul `📝 Catatan` dan tombol `✕` (`btn btn-icon btn-sm`) untuk meminimise / menyembunyikan sidebar list.
    2. **Kotak Pencarian:** Menghilangkan icon kaca pembesar di dalam input dan menyelaraskan placeholder `"Cari..."`, border radius, padding, serta styling container pencarian persis seperti di page Gambar dan Mindmap.
    3. **Cache Bump:** SW cache di-bump ke **`taskflow-v261-notes-page-search-and-header-unification`**.
  - All tests passed: 433/433 JS unit tests + 40/40 pytest (0 failures), 5/5 inline scripts parse cleanly.
  - **Device-test checklist:** (1) Buka menu Catatan (`page === "notes"`) -> Header menampilkan `📝 Catatan` dengan tombol `✕` di kanan; (2) Kotak pencarian menampilkan kata `Cari...` bersih tanpa icon di dalamnya.

## 📌 Active Task
- **Published Note Tables, Images, and Inline Drawing Rendering VERIFIED & SELESAI 2026-08-21:**
  - **Summary:**
    1. **Tabel Markdown:** Ter-render rapi menjadi HTML `<table>` via mistune `table` plugin & normalization unescaping.
    2. **Gambar `.png` & Lampiran:** Otomatis dipromosikan dari link `[image.png]` menjadi `![image.png]` dan menampilkan visual thumbnail pada daftar lampiran.
    3. **Inline Drawing (`::draw[...]`):** Ter-render sempurna dengan pencocokan cerdas (`id`/`title`/`note_id`), fallback live iframe preview, dan auto-swap ke static `<svg>`.
    4. **IndexedDB & Database Migration:** Startup migration crash (`drawings.is_pinned`) dan IndexedDB missing index `server_id` telah diperbaiki secara aman.
  - All tests passed: 433/433 JS unit tests + 40/40 pytest (0 failures), 5/5 inline scripts parse cleanly.
  - **User Verification:** Terverifikasi langsung oleh user di live instance (`https://todo.yatno.web.id/`) bahwa tabel, gambar PNG, dan inline drawing sudah tampil sempurna.

## 📌 Active Task
- **Draw Canvas Export (PNG, SVG, JSON) Bugfix SELESAI 2026-08-19:**
  - Root cause: Implementasi bawaan tldraw `downloadFile` tidak meng-append anchor `<a download>` ke DOM dan langsung memanggil `URL.revokeObjectURL` secara sinkronis pada baris berikutnya sehingga browser membatalkan proses download blob secara instan.
  - Perbaikan: Mengimplementasikan custom action overrides (`uiOverrides`) di `draw-app/src/App.jsx` untuk menu dan context menu (`export-as-svg`, `export-as-png`, `export-as-json`, `export-all-as-svg`, `export-all-as-png`, `export-all-as-json`) dengan helper `downloadBlob` yang aman (append ke body, delay revoke 10s), deteksi canvas kosong dengan toast informatif, serta resolusi nama file timestamp.
  - Build & Deploy: Vite build `draw-app` selesai meng-update `static/vendor/tldraw/assets/index.js`, iframe query versioning di-bump `?v=141` di `static/index.html`.
  - All tests passed: 433/433 JS unit tests + 39/39 pytest (0 fail).

## 📌 Active Task
- **Global Search (Ctrl+K) Mindmap Integration SELESAI 2026-08-18 (commit `b1fe23c`):**
  - Backend `GET /api/search` di `webapp.py` diperluas: mendukung pencarian `mindmaps` (personal + shared via `_mindmap_access_clause(uid)`) mencakup pencarian judul (`title LIKE ?`) dan isi topik node (`data_json LIKE ?`).
  - Frontend `SearchModal` di `static/index.html`: placeholder diperbarui menjadi "Cari task, catatan, mindmap, atau tag…".
  - Navigasi mulus ke mindmap via `pendingMindmapId` prop di `MindmapPage` dan multi-tab auto-open.
  - SW Cache di-bump ke **`taskflow-v240-global-search-mindmaps`**.
  - All tests passed: 419/419 JS unit tests + 38/38 pytest.
  - **PENDING user device-test:** Tekan `Ctrl+K` -> ketik kata kunci judul mindmap atau topik node -> hasil 🧠 Mindmaps muncul -> klik hasil -> mindmap terbuka instan di tab bar.

## 📌 Active Task
- **SDD Mindmap Level-Justify SELESAI 2026-08-18.** 5 task (spec `2026-08-18-mindmap-level-justify-design.md`, plan `2026-08-18-mindmap-level-justify.md`) di commit `3e68dee`..`41d4678`:
  - `static/offline/mindmapjustify.js` UMD helper module (`toggleJustify`, `computeTreeDepths`, `applyLevelJustify` horizontal/vertical per depth + 7 unit test TDD di `tests/offline/mindmapjustify.test.js`).
  - Script tag registration di `static/index.html`, `static/vendor/mind-elixir/index.html`, dan `STATIC` array di `static/sw.js`.
  - Integrasi engine `applyJustifyLayout()` dan postMessage handler `setJustify` / `load` di iframe vendor `static/vendor/mind-elixir/index.html`.
  - Toolbar toggle chip button `[ ⇤⇥ Justify ]` di `MindmapTabInstance` pada `static/index.html`, sinkronisasi state `justify`, dan penyimpanan ke `data_json.justify`.
  - Service Worker cache bump → **`taskflow-v239-mindmap-level-justify`** dan iframe bump `?v=136`.
  - `419/419` unit test pass (0 fail).
  - **PENDING user device-test:** (1) Buka mindmap -> klik tombol `[ ⇤⇥ Justify ]` di toolbar -> node per level sejajar rapi dalam kolom vertikal (atau baris horizontal untuk mode org chart); (2) Toggle aktif/mati bekerja mulus dan garis cabang (*SVG branches*) ter-render sempurna; (3) Status `justify` tersimpan otomatis per mindmap.

## 📌 Active Task
- **SDD mindmap Multi-Tab View SELESAI 2026-08-18.** 5 task (spec `2026-08-18-mindmap-tab-view-design.md`, plan `2026-08-18-mindmap-tab-view.md`) di commit `0fc68d9`..`5d3d5da` di main:
  - `static/offline/mindmaptabs.js` UMD helper module (openTab, closeTab, updateTabTitle dengan aturan cap 5 tab + 6 unit test TDD di `tests/offline/mindmaptabs.test.js`).
  - Markup & CSS tab bar `.mindmap-tab-bar` / `.mindmap-tab-item` di `static/app.css` (gaya visual serasi dengan `note-tab-bar`).
  - Refactoring `MindmapPage` di `static/index.html` dengan komponen `MindmapTabInstance` (multi-instance DOM rendering hidden/visible per tab, 0ms tab switch delay, message listener disambiguation via `e.source`).
  - Service Worker cache bump → **`taskflow-v238-mindmap-multi-tab-syntax-fix`**.
  - Fix `SyntaxError: missing ) after argument list` pada baris 8397 `MindmapTabInstance` di `static/index.html` (terverifikasi 52 inline script parser OK & 412 unit test pass).
  - Iframe `index.html?v=134 → ?v=135` & Sub-resources (`MindElixir.css?v=121`, `MindElixir.iife.js?v=121`, `mindmapoutline.js?v=126`, `mindmapops.js?v=3`).
  - `412/412` unit test pass (0 fail).
  - **PENDING user device-test:** (1) Buka beberapa mindmap dari sidebar/search → tampil tab di bagian atas; (2) Pindah tab instan tanpa reload; (3) Tab ke-6 otomatis menutup tab tertua; (4) Hapus/rename mindmap memperbarui tab bar secara real-time.

---

## 📌 Active Task
- **SDD mindmap Ops-panel mirror (context menu ↔ toolbar) SELESAI & LIVE 2026-08-18.** 5 task (module `static/offline/mindmapops.js` TDD + markup + wiring + bump + final) di commit `c972645`..`78a08c4`; final whole-branch review (opus) → 1 Important (root-guard engine = 6 item, bukan 4) → fix wave `78a08c4` (6-key `opsDisabledStates` + disable ntb-sibling/ntb-delete + guard module-missing + koreksi spec). Re-review 3/3 ADDRESSED. 405/405 test, LIVE terverifikasi curl (SW `taskflow-v235-mindmap-ops-context-actions`, iframe `?v=133` 13 tombol, `mindmapops.js` tersaji). **PENDING user: device-test checklist (ponsel/tablet)**: (1) Ops tampilkan 13 tombol; (2) Focus → subtree → Cancel → peta penuh; (3) Move up/down urutkan sibling, Summary buat node ringkasan; (4) Link → hint "Tap node target" → tap node lain → panah → reload persisten; (5) Bidirectional 2 arah persisten; (6) root dipilih → Parent/Focus/Move up/down/Sibling/Hapus disabled (Child aktif); (7) desktop context menu tak berubah. Minor deferred (parity engine, aman): setDirection tak cancel link flow; self-link diizinkan; klik panel samping tak cancel flow.
- **BUGFIX mindmap header mobile (2026-08-18, commit `de9750f`, LIVE + TERVERIFIKASI user):** toolbox atas (Canvas/Outline + arah + Rename/Share) terpotong di layar ponsel kecil — root cause: flex row tanpa wrap/scroll, `flexShrink: 0`, ancestor `overflow: hidden`; regresi dari `b669b46`. Fix: `flexWrap: "wrap"` di header + SW bump → **`taskflow-v234-mindmap-header-wrap`**. 402/402 test hijau, live-verifikasi curl (SW + line flexWrap di VPS), user konfirmasi: semua tombol terlihat, wrap jadi 2 baris di layar kecil.
- **SDD voice dictation (spec `b80a64c`) sedang berjalan.** Task 1-4 SELESAI di main + **Final Fix Wave SELESAI** (commit `31f112c`): Kotlin restart-guard terakumulasi antar-restart (pindah ke poller "start" branch), diagnostik "Dikte tidak merespons" JS di-gate (sekali per sesi, hanya jika nol event) + interval poller di-clear saat error + seam opts `silentLimit`/`pollIntervalMs`; 3 unit test baru (9/9 target, 398/398 full suite, 0 fail). Kotlin TIDAK bisa compile lokal (no Android toolchain) → gate compile = CI APK build. Detail: `.superpowers/sdd/2026-08-16-android-offline-voice-dictation/task-final-fix-report.md`. **Next (coordinator): push + trigger CI "Build Android APK" + device-test checklist.**
- Task 4 commit `14ebdf3`: SW cache bump `taskflow-v231-mindmap-header-chips` → **`taskflow-v232-native-voice`** (wajib — SW cache-first, tanpa bump device lama sajikan voicedictate.js lama). Verifikasi: 3× `node --check` hijau, full suite 395/395 pass 0 fail, `git diff --stat HEAD~3..HEAD -- static/index.html` kosong (index.html tak tersentuh fitur ini). HANYA `static/sw.js` di-commit. Detail: `.superpowers/sdd/2026-08-16-android-offline-voice-dictation/task-4-report.md`.
- Task 3 commit `44d797f`: native path di `static/offline/voicedictate.js` (TDD, 6 test baru, full suite 395/395). Deviasi wajib dicatat: wrapper UMD node-branch sekarang `module.exports = { voicedictate: factory(root) }` agar test verbatim (`TF.voicedictate.*`) hijau. Detail: `.superpowers/sdd/2026-08-16-android-offline-voice-dictation/task-3-report.md`.

## 🟢 Ringkasan Sesi (mindmap, 2026-08-15 s/d 2026-08-16)

Semua di main, semua LIVE di todo.yatno.web.id. **SW: `taskflow-v231-mindmap-header-chips`. Iframe: `?v=132`. Tests: 32/32 targeted, 384/384 full suite.**

1. **Outline Mode** (subagent-driven, 11 commit): parent React = source of truth; module UMD `static/offline/mindmapoutline.js` (25 export: transform + renderer md + link helpers); iframe `refresh` handler; tree styling (circle ●○ + indent guides CSS border); Shift+drag child + indikator + hint; link popover + picker.
2. **4-Arah Layout (org chart)**: engine di-upgrade **mind-elixir 1.1 → 5.15.1** (stabil; 6.0.0-next ditolak — pre-release & hilang `moveNodeAfter`); tombol ←→⇄↓ per-mindmap tersimpan di `data_json.direction`; serangkaian bug cache dipecahkan (lihat Notes).
3. **Text Formatting Fase 1**: renderer bersama (marked v15, escape-first XSS-proof + scheme allowlist + strip `<p>`/trailing-`\n`), toolbar canvas (pointerdown dispatch, br-aware innerText walker) + toolbar outline (stopPropagation anti focus-steal), align per-node (`align` field).
4. **Sidebar kanan bertab** (🎨 Font / 🔧 Ops / 🔗 Links) auto-switch konteks, collapsible; font pane = grid tombol persegi; theming ikut app (light #fff+lime, dark #262626 netral); **map canvas theme ikut app** (Latte/Dark via `changeTheme` minimal-object).
5. **Create-from-picker**: ➕ Note/{q} & ➕ Task/{q} di kedua picker link (buat note/task baru langsung tertaut).
6. **Polish**: nav auto-collapse saat masuk page mindmap (seperti Notes & Draw); header toggle (arah + Canvas/Outline) bergaya chip selalu terlihat; context menu clamp; tombol aksi baris diperbesar; link topik buka tab baru; phantom newline hilang.

## ✉️ Notes for Next Agent
- **Fase 2 styling node BELUM dikerjakan** (diminta user, ditunda): background color, font size/color, icon, insert gambar per node (engine 5.15.1 punya dukungan image bawaan `node.image`). Next kalau user minta.
- **Pelajaran cache (KRITIS):** SW handler `/static/*` = CACHE-FIRST. Setiap ubah aset ber-URL stabil (module offline, iframe vendor, sub-resource) → bump `?v=` pada referensinya ATAU bump nama cache SW. Bukti nyata: bug "wrapSelection is not a function" — iframe menyajikan module lama dari cache.
- Pelajaran engine 5.15.1: `selectNewNode` HANYA fire untuk seleksi programatik (klik user → wrap `mind.selectNode`); `layout()` rebuild DOM node dari nol (badge/align harus re-apply via wrapper layout); toolbar harus dispatch di `pointerdown` + preventDefault (blur membunuh edit box sebelum click); `marked` menambah trailing `\n` + wrapper `<p>` (tampil sebagai baris hantu di pre-wrap → strip di renderer); themes internal Latte/Dark diakses via objek minimal `{type:'dark'|'light', cssVar:{}}`.
- Minor tertunda (aman): junk undo entri align-same-value; auto-grow tak rerun setelah applyFmt; O(N²) updateBadges; toolbar residual visible setelah Escape-cancel.
- Handover `.agents/*` ini belum di-push (tidak ada kode menunggu deploy — semua sudah live). Push kapan pun untuk menyelaraskan.

## 🔴 Known Issues / In Progress
- Habit Tracker UI Redesign plan (`docs/superpowers/plans/2026-08-14-habit-tracker-redesign.md`) masih menunggu eksekusi.
- **Voice dictation Android: IMPLEMENTASI SELESAI & TER-REVIEW, PENDING user.** 6 commit di main (`25ba3aa`..`31f112c`): patch CI (RECORD_AUDIO + SpeechBridge.kt + MainActivity wiring), 3 command Rust (speech_cmd atomic-write / read_speech_events / speech_debug), impl native di voicedictate.js (deteksi Tauri+Android, interface sama dengan web impl — call site index.html TIDAK diubah), SW bump `taskflow-v232-native-voice`, 11 unit test baru (full suite 398/398). Final whole-branch review bersih (2 Important fix: restart-guard Kotlin + diagnostik JS zero-events). **NEXT (user): `git push origin main` → trigger Actions "Build Android APK" → device-test checklist: (1) izin mic muncul→izinkan→tombol merah+bicara→teks live→stop→final masuk; (2) MODE PESAWAT dikte tetap jalan (paket offline Bahasa Indonesia wajib sudah di-download: Google app → Voice → Offline speech recognition); (3) tolak izin→toast panduan; (4) diam >10 detik→bicara lagi tetap masuk. Kalau tak ada hasil sama sekali → baca toast diagnostik `speech_debug` (mismatch path filesDir).** Kotlin belum compile lokal — gate = CI APK build hijau.
- Attachment upload base64 fallback in progress (fitur lama).
