## 🚨 CRITICAL WARNING FROM PAST SESSION 🚨
**ATTENTION ALL AGENTS:** In a previous session, an agent was severely reprimanded by the user for ignoring the Superpowers plugin rules, writing code inline (cowboy coding), breaking the database with untested migrations, and falsely claiming a task was complete without running tests.
**YOU MUST NOT REPEAT THIS.**
1. Read the Superpowers skills (`subagent-driven-development`, `requesting-code-review`, etc.).
2. Delegate implementation and review tasks to SUBAGENTS.
3. NEVER guess bugs; isolate and reproduce them systematically.
4. Always run `pytest` (e.g. `python -m pytest tests/test_docx_export.py` and `tests/test_drawings.py`) and verify JS syntax before pushing code.

## 🔴 SDD Rebrand TaskFlow → Alurik — Task 1 frontend strings SELESAI 2026-08-23 (Claude, commit `b4acbe9`)
- Semua string user-visible "TaskFlow" → "Alurik": `static/index.html` (title, apple-title, nama file export `alurik-export-`, 4× header auth "⚡ Alurik", brand sidebar, footer print note, deskripsi tour), `static/manifest.json` (name/short_name/description), komentar Driver.js di `static/app.css`. SW bump **`taskflow-v303-rebrand-alurik`**.
- Identifier internal TETAP: `taskflow-legacy-cache` (index.html:290), DB `taskflow-offline`, package id `id.web.yatno.taskflow`. Test regresi baru `tests/offline/rebrand.test.js` (6/6) — TDD RED (5 fail/1 pass) → GREEN; check_inline 5/5; full suite 519/519 pass 0 fail.
- **TIDAK di-push** (push/deploy = Task 3). NEXT = Task 2 (backend strings — independen). Report: `.superpowers/sdd/2026-08-23-rebrand-alurik/task-1-report.md`.

## 🔴 SDD Rebrand TaskFlow → Alurik — Task 2 backend strings SELESAI 2026-08-23 (Claude, commit `3511091`)
- `webapp.py` 16 titik + `bot.py` 8 titik user-visible → "Alurik" (docstring, FastAPI title, 3× "Buka Alurik untuk", static-not-found h1, `alurik-export-`, `AlurikBookmark/1.0`, prompt AI "di Alurik", "Alurik Note AI", publish page ("Alurik Publish", "Published via Alurik", footer), 404/Protected titles, bot welcome/help/DASHBOARD/login/not-found/startup-log).
- Identifier internal TETAP: `webapp.py:179` komentar `/TaskFlow/attachments`, `bot.py:79` `logging.getLogger("taskflow")`. Final grep sisa HANYA 2 baris itu.
- Test regresi baru `tests/test_rebrand.py` (3/3) — TDD RED (2 fail/1 pass) → GREEN; full suite **46/46 pass 0 fail** (43 existing + 3 baru); `py_compile` webapp.py + bot.py OK.
- **TIDAK di-push** (push/deploy = Task 3). **PENTING:** perubahan webapp.py/bot.py baru aktif setelah restart service VPS (taskflow-web + bot) — di luar kendali kita, dicatat utk Task 3. NEXT = Task 3 (icons + docs + deploy). Report: `.superpowers/sdd/2026-08-23-rebrand-alurik/task-2-report.md`.
- **FIX ROUND review (Important — gap rebrand di luar scope brief) SELESAI, commit `ce820eb`:** `mailer.py` (subject/body reset password, docstring, komentar From-header), `docx_exporter.py:396` ("Catatan Alurik"), `ai_review.py` (X-Title "Alurik"/"Alurik Weekly Review" + bare "TaskFlow" = nol), `config.py` (SMTP_FROM default "Alurik <noreply@localhost>" + docstring; `taskflow.db` & `/TaskFlow/attachments` internal TETAP). Test `test_rebrand.py` diperkuat (3 absences webapp + fungsi `test_other_modules_visible_strings_rebranded`). TDD RED (1 fail/3 pass) → GREEN 4/4; full suite **47/47 pass 0 fail**; grep 3 file = nol. TIDAK di-push. Deploy-note: kalau VPS set SMTP_FROM eksplisit via .env, update juga.



## 🟢 Active Task
- **SDD Rebrand TaskFlow → Alurik — SELESAI & LIVE 2026-08-23 (Claude, 7 commit `b4acbe9`..`f4f5e7b` di-push)**: semua string user-visible "TaskFlow" → "Alurik": frontend (`static/index.html` title/brand/export-file, `static/manifest.json` name/short_name/description, deskripsi tour `static/app.css`), backend (`webapp.py` 16 titik, `bot.py` 8 titik, `mailer.py`, `docx_exporter.py`, `ai_review.py`, `config.py` default SMTP_FROM), `.env.example` (SMTP_FROM + header box), `src-tauri/tauri.conf.json` productName/title (display-only), README + PROJECT_MAP + CLAUDE.md, ikon placeholder monogram "A" lime #a8c500 di bg #0f172a (4 PNG: favicon 48px + icon-32/192/512). SW **`taskflow-v303-rebrand-alurik`** — **LIVE terverifikasi curl** (SW v303, `<title>Alurik</title>`, manifest `"name": "Alurik"`, ikon baru tersaji byte-identik). Yang DIPERTAHANKAN (internal): identifier `id.web.yatno.taskflow`, `taskflow-legacy-cache`, `taskflow.db`, `/TaskFlow/attachments`, `logging.getLogger("taskflow")`, nama service VPS `taskflow`/`taskflow-web` (perintah systemctl di README tetap akurat), path `taskflow-v4/`. Verifikasi: JS 519/519 pass 0 fail; pytest 47/47; check_inline 5/5. Report: `.superpowers/sdd/2026-08-23-rebrand-alurik/task-3-report.md`.
  - **PENDING user:**
    1. Hard refresh browser (Ctrl+Shift+R) → tab title & favicon jadi "Alurik", ikon placeholder baru tampil.
    2. Restart service VPS: `sudo systemctl restart taskflow taskflow-web` — perubahan **webapp.py/bot.py baru aktif setelah restart** (bagian static sudah aktif seketika); kalau VPS `.env` set `SMTP_FROM` eksplisit dengan display name lama, update juga di sana.
    3. Cek bot Telegram `/start` menampilkan "⚡ Alurik".
    4. Ikon native Tauri (`src-tauri/icons/*`) menyusul saat build native berikutnya (di luar scope task ini).
    5. Logo placeholder monogram bisa diganti desain kapan saja (regenerasi 4 file PNG: favicon, icon-32/192/512).
    6. URL tetap `todo.yatno.web.id` (domain alurik.com belum di-pointing — DNS/HTTPS VPS = langkah terpisah butuh akses user ke Cloudflare/registrar & VPS).

## ✅ FIX Table Toolbar Offset — SELESAI & LIVE 2026-08-23 (Claude, commit `fc00552`, SW v302)
- Toolbar tabel Milkdown menutupi teks cell; fix `offset.mainAxis: -8 → 6` di `static/index.html:16238` (toolbar 6px DI ATAS cell). JS 513/513 pass 0 fail; pytest 43/43; check_inline 5/5. PENDING user: hard refresh → klik dalam cell tabel → toolbar DI ATAS teks (gap ~6px). Report: `.superpowers/sdd/2026-08-23-table-toolbar-offset/report.md`.

## ✅ SDD Floating ToC — Task 1 CSS SELESAI 2026-08-23 (Claude, commit `d719c4a`)
- Konsolidasi CSS floating ToC ala Medium di `static/app.css` (anchor fixed, trigger lingkaran 44/40px, popover absolute buka atas/kiri, `toc-pop-in` opacity-only, `.note-toc-item.active` unscoped tint) + tulis ulang `tests/offline/note_toc.test.js` (TDD: RED 7/7 fail → GREEN 8/8 pass; regresi targeted 3 file app.css 41/41 pass).
- Deviasi terdokumentasi di report: 3 adaptasi regex test (brief inkonsisten dengan CSS brief-nya sendiri: count 1→2 + guard gaya pill, mediaDup di-scope ke braces, desktop lazy→greedy); hapus `.note-toc-sticky` (dituntut test, tidak terpakai di index.html); pertahankan `.note-toc-panel::-webkit-scrollbar` (masih dipakai `static/index.html:17159`).
- Report: `.superpowers/sdd/2026-08-23-floating-toc-fly/task-1-report.md`. TIDAK di-push (push/deploy = Task 3). NEXT = Task 2 (NotePanel JSX + scroll-spy). Intermediate visual: trigger lingkaran baru langsung berlaku di tombol lama (teks "Isi (N)" bisa tampak sesak) sampai Task 2 ganti FAB icon-only; popover terlindungi inline style sampai Task 2.

## ✅ SDD Floating ToC — Task 2 NotePanel JSX + scroll-spy SELESAI 2026-08-23 (Claude, commit `6e23e93`)
- 7 edit di `static/index.html` (compiled output, diedit langsung; NEW text verbatim dari brief): wrapper ToC `className: "floating-toc-anchor"` (inline relative dihapus), tombol icon-only 📑 (label "Isi (N)" + panah ▲/▼ dihapus), popover tanpa inline positioning (`className: "floating-toc-popover"` saja, scale-in dihapus), item class template `` `note-toc-item${tocActiveIdx === item.idx ? " active" : ""}` ``, klik item `setTocActiveIdx(item.idx)`, `ref: tocSpyRef` di `.note-rendered`, state `tocActiveIdx` + effect IntersectionObserver (rootMargin "-15% 0px -60% 0px") SETELAH deklarasi `tocItems` (TDZ-safe, diregresi-tes).
- Test `tests/offline/note_toc.test.js`: tambah suite markup JSX (TDD: RED 7/7 fail → GREEN). 2 adaptasi assertion test (dokumentasi di report): (1) inline-relative di-scope ke wrapper ToC (dropdown export di NotePanel sah pakai inline yang sama); (2) regex querySelectorAll ditambah `\^` (brief regex tak cocok dengan kode brief sendiri `[id^="note-h-"]`).
- Verifikasi: check_inline 5/5 OK, targeted 16/16 pass, FULL suite 510/510 pass 0 fail (exit 0). CRLF index.html utuh. TIDAK di-push (push/deploy = Task 3).
- Report: `.superpowers/sdd/2026-08-23-floating-toc-fly/task-2-report.md`. NEXT = Task 3 (SW bump + push + deploy).

## ✅ SDD Floating ToC — Task 3 SW bump + deploy + handover SELESAI 2026-08-23 (Claude, commit `bc3601f`)
- SW cache `taskflow-v299-fix-toc-syntax` → **`taskflow-v300-floating-toc-fab`** (1 baris di `static/sw.js`); push `bc3601f` → Actions auto-deploy → LIVE terverifikasi curl (SW v300 + `floating-toc-anchor` ≥1 di index.html + `toc-pop-in` ≥2 di app.css).
- Verifikasi penuh: node --check sw.js OK; JS suite `node --test "tests/offline/*.test.js"` 510/510 pass 0 fail (exit 0, ~152s); `python -m pytest tests/` 43/43; `node scratch/check_inline.js` 5/5.
- Report: `.superpowers/sdd/2026-08-23-floating-toc-fly/task-3-report.md`. Handover `.agents/*` di-commit+push terpisah (docs(agents)). NEXT = Final review + fix wave (bila perlu).

# Current Workspace State & Handover

**Last Updated:** 2026-08-23 (Claude — SDD Rebrand Alurik Task 3 deploy, commit `f4f5e7b`)
**Updated By:** Claude — SDD Rebrand Alurik Task 3 icons + docs + deploy + handover (7 commit rebrand di-push & LIVE, SW v303)

---

## 📌 Active Task
- **TaskFormModal Note Tab Paper Selector & Paper Guides SELESAI 2026-08-23:**
  - **Problem / Root Cause:**
    - Saat membuat catatan baru melalui tombol "+ Buat Baru" di topbar (`TaskFormModal`), komponen `NoteToolbar` dipanggil tanpa props `paperConfig` dan `onPaperConfigChange`. Karena `NoteToolbar` meng-guard tombol `📄 Kertas` dan dropdown ukuran/orientasi kertas dengan `onPaperConfigChange && ...`, opsi mode kertas tidak muncul sama sekali di modal "+ Buat Baru".
    - Kontainer editor `MilkdownEditor` di `TaskFormModal` juga belum dibungkus styling `paper-mode-active`, `paper-inner-wrap`, CSS variables `--paper-width`/`--paper-height`, dan komponen `PaperPageGuides`.
    - Penyimpanan catatan baru di `TaskFormModal` belum menyertakan `meta_json: JSON.stringify({ paper_mode: notePaperConfig })`.
  - **Solusi / Perbaikan:**
    1. **TaskFormModal State ([`static/index.html`](file:///Z:/Todolist%20Manager%20V5.0/static/index.html)):**
       - Menambahkan state `notePaperConfig` (`{ enabled: false, size: 'A4', orientation: 'portrait' }`) dan `notePaperWrapRef`.
       - Meneruskan `paperConfig: notePaperConfig` dan `onPaperConfigChange: setNotePaperConfig` ke `NoteToolbar`.
       - Membungkus `MilkdownEditor` dengan class `paper-mode-active`, CSS variables `--paper-width`/`--paper-height`, wrapper `paper-inner-wrap` bertarget `notePaperWrapRef`, serta rendering kondisional `PaperPageGuides`.
       - Menyimpan `meta_json: JSON.stringify({ paper_mode: notePaperConfig })` pada `handleSubmit` dan image-paste fallback creation.
    2. **TDD Unit Tests ([`tests/offline/note_paper_mode.test.js`](file:///Z:/Todolist%20Manager%20V5.0/tests/offline/note_paper_mode.test.js)):**
       - Membuat test suite (7/7 tests) yang memvalidasi `TaskFormModal` state, props passing, CSS variables, `paper-inner-wrap`, `PaperPageGuides`, dan `meta_json` saving.
    3. **SW Cache Bump ([`static/sw.js`](file:///Z:/Todolist%20Manager%20V5.0/static/sw.js)):**
       - Bump cache ke **`taskflow-v292-taskform-note-paper-selector`**.
  - All tests passed: 484/484 JS unit tests + 43/43 pytest (0 failures).
  - **Status:** SELESAI.
  - **Problem / Context:**
    - Di editor Milkdown WYSIWYG, tabel markdown sebelumnya belum memiliki visual column resize handle dan cell selection overlay yang rapi, sehingga pengguna tidak dapat mengatur lebar kolom secara visual atau melihat highlight seleksi sel saat mengedit tabel.
  - **Solusi / Perbaikan:**
    1. **ProseMirror Column Resizing & Selection Styles ([`static/app.css`](file:///Z:/Todolist%20Manager%20V5.0/static/app.css)):**
       - Menambahkan styling `.tableWrapper` dengan `overflow-x: auto; max-width: 100%`.
       - Menambahkan styling `table` dengan `table-layout: fixed; overflow: hidden`.
       - Menambahkan styling `td, th` dengan `vertical-align: top; box-sizing: border-box; position: relative`.
       - Menambahkan `.column-resize-handle` dengan positioning presisi, lebar responsif, accent color, dan hover cursor `col-resize`.
       - Menambahkan `.selectedCell:after` selection overlay semi-transparan.
    2. **TDD Unit Tests ([`tests/offline/table_resizing.test.js`](file:///Z:/Todolist%20Manager%20V5.0/tests/offline/table_resizing.test.js)):**
       - Menambahkan unit test suite (7/7 tests) untuk memvalidasi keberadaan dan aturan selector CSS table resizing.
    3. **SW Cache Bump:** Di-bump ke **`taskflow-v287-table-column-resizing`** di `static/sw.js`.
  - All tests passed: 455/455 JS unit tests + 43/43 pytest (0 failures).
  - **Status:** SELESAI.

---
- **Milkdown toDOM null Attribute TypeError Fix SELESAI 2026-08-22:**
  - **Problem / Root Cause:**
    - `drawingNode.toDOM` menghasilkan `['span', null, ...]` pada judul gambar di dalam `DOMOutputSpec`. Dalam parser DOM ProseMirror (`DOMSerializer.renderSpec`), nilai `null` di index 1 tidak terdeteksi sebagai objek attribute melainkan diperlakukan sebagai child node pertama, yang kemudian memicu `TypeError: Failed to execute 'appendChild' on 'Node': parameter 1 is not of type 'Node'`.
    - `MilkdownEditor` `MB.Editor.make().create()` tidak memiliki handler `.catch()` pada promise chain inisialisasinya.
  - **Solusi / Perbaikan:**
    1. **Valid DOMOutputSpec Attributes ([`static/index.html`](file:///Z:/Todolist%20Manager%20V5.0/static/index.html#L16878)):**
       - Mengganti `['span', null, ...]` menjadi `['span', { class: 'note-draw-title' }, ...]` sehingga seluruh elemen `toDOM` memiliki attribute object non-null yang valid.
    2. **Resilient Error Logging ([`static/index.html`](file:///Z:/Todolist%20Manager%20V5.0/static/index.html#L16316)):**
       - Menambahkan `.catch(err => console.error('Milkdown init error:', err))` pada promise chain inisialisasi Milkdown editor.
    3. **DOMOutputSpec Unit Tests ([`tests/offline/drawdirective.test.js`](file:///Z:/Todolist%20Manager%20V5.0/tests/offline/drawdirective.test.js#L274)):**
       - Menambahkan unit test suite untuk memvalidasi keamanan `DOMOutputSpec` dan mencegah regresi `null` attributes di ProseMirror DOMSerializer.
    4. **SW Cache Bump:** Di-bump ke **`taskflow-v286-todom-null-fix`** di `static/sw.js`.
  - All tests passed: 448/448 JS unit tests + 43/43 pytest (0 failures), 4/4 inline scripts parse cleanly.
  - **Status:** APPROVED.

---
- **Note DOCX Export Universal Word XML & Timeout Fix SELESAI 2026-08-21:**
  - **Problem / Root Cause:**
    1. File `.docx` tidak bisa dibaca oleh MS Word karena adanya injeksi OpenXML manual `<asvg:svgBlip>` pada fallback SVG yang tidak terdaftar di namespace resmi MS Word.
    2. Gambar `!image.png` tidak muncul karena batas waktu request frontend (2.5s) dan backend (3s) memutus koneksi streaming Nextcloud sebelum data gambar selesai diunduh.
    3. Status 503 saat hard refresh terjadi sementara selama 1-2 detik ketika service backend Uvicorn sedang direstart oleh `systemctl`.
  - **Solusi / Perbaikan:**
    1. **Universal Word XML Compliance ([`docx_exporter.py`](file:///Z:/Todolist%20Manager%20V5.0/docx_exporter.py)):**
       - Menghapus seluruh manipulasi XML manual `<asvg:svgBlip>` dan menggantinya dengan `run.add_picture(...)` standar dari library `python-docx`. File `.docx` kini 100% valid dan kompatibel di semua versi Microsoft Word (Word 2010–2024, Microsoft 365, LibreOffice).
    2. **Reliable Nextcloud Stream Timeouts ([`static/index.html`](file:///Z:/Todolist%20Manager%20V5.0/static/index.html#L19460), [`webapp.py`](file:///Z:/Todolist%20Manager%20V5.0/webapp.py#L3787)):**
       - Memperpanjang timeout fetch gambar di frontend menjadi 10 detik (dan race cap 15 detik) serta backend Nextcloud timeout menjadi 15 detik.
    3. **SW Cache:** Di-bump ke **`taskflow-v272-docx-table-images-fix`**.
  - All tests passed: 433/433 JS unit tests + 43/43 pytest (0 failures).
  - **Device-test checklist:** (1) Buka catatan dengan drawing dan gambar `!image.png` -> Export Word (.docx) -> Buka di Word -> Terbuka lancar tanpa error corrupt dan gambar tertanam utuh.
  - **Problem / Root Cause:**
    - Saat mencocokkan nama file di database `note_attachments`, string `clean_src` masih mempertahankan awalan tanda seru (misal `!image.png`), sedangkan `original_name` di database tersimpan tanpa tanda seru (`image.png`). Akibatnya pencocokan selalu bernilai `False` dan gambar gagal di-load dari Nextcloud.
  - **Solusi / Perbaikan:**
    1. **Sanitized Name Matching ([`webapp.py`](file:///Z:/Todolist%20Manager%20V5.0/webapp.py#L3743)):**
       - Membersihkan karakter tanda seru, bracket, dan spasi (`re.sub(r'^[!\[\]\(\)\s]+|[!\[\]\(\)\s]+$', '', clean_src)`) menjadi `clean_fn`.
       - Mencocokkan `clean_fn`, `clean_alt`, nama file tanpa ekstensi (`no_ext`), dan substring.
       - Menambahkan fallback pencarian ke seluruh lampiran milik user (`WHERE user_id = ?`) jika `note_id` belum terisi.
    2. **SW Cache:** Di-bump ke **`taskflow-v270-docx-stripped-fn-and-user-fallback`**.
  - All tests passed: 433/433 JS unit tests + 43/43 pytest (0 failures).
  - **Device-test checklist:** (1) Buka catatan dengan gambar `!image.png` -> Export Word (.docx) -> Gambar visual otomatis ter-embed di file Word.
  - **Problem / Root Cause:**
    - Regex sebelumnya mewajibkan ekstensi file (`\.(?:png|jpg|...)`) pada pola `!image.png`, sehingga penulisan seperti `!image` atau `![image]` (tanpa ekstensi eksplisit atau alias lampiran) tidak cocok dan dicetak sebagai teks mentah.
  - **Solusi / Perbaikan:**
    1. **Flexible Standalone Image Parser ([`docx_exporter.py`](file:///Z:/Todolist%20Manager%20V5.0/docx_exporter.py)):**
       - Menghapus kewajiban ekstensi pada pola `!name`, `![name]`, dan `[name]` sehingga format `!image` langsung dikenali sebagai gambar.
    2. **Comprehensive Attachment Aliases ([`static/index.html`](file:///Z:/Todolist%20Manager%20V5.0/static/index.html#L19406)):**
       - Mendaftarkan semua variasi nama lampiran ke `imagesMap`: nama asli (`image.png`), lowercase (`image.png`), tanpa ekstensi (`image`), dengan tanda seru (`!image`, `!image.png`), dan URL attachment.
       - Menggunakan cache `panelAttachments` yang sudah ada di memori `NotePanel` untuk instan response.
    3. **SW Cache:** Di-bump ke **`taskflow-v269-docx-image-alias-and-no-ext-support`**.
  - All tests passed: 433/433 JS unit tests + 43/43 pytest (0 failures).
  - **Device-test checklist:** (1) Buka catatan dengan format `!image` / `!image.png` -> Export Word (.docx) -> Gambar visual tertanam langsung di dokumen Word.
  - **Problem / Root Cause:**
    - Sebelumnya, export Word membutuhkan waktu lama (~5 menit) jika terjadi timeout jaringan saat fetching gambar/Nextcloud tanpa batas waktu atau tanpa caching di server. Selain itu, UI tidak memberikan feedback instan saat sedang menyiapkan file.
  - **Solusi / Perbaikan:**
    1. **Instant UI Feedback & Fast Parallel Prefetch ([`static/index.html`](file:///Z:/Todolist%20Manager%20V5.0/static/index.html#L19406)):**
       - Menampilkan toast `Menyiapkan dokumen Word...` secara instan saat tombol diklik.
       - Setiap pengambilan gambar diberikan `AbortController` timeout maksimal 2.5 detik.
       - Seluruh proses pre-fetch client dibatasi maksimal 4 detik dengan `Promise.race`, sehingga proses export langsung berjalan tanpa pernah menunggu lama.
    2. **Memoized Backend Image Resolver ([`webapp.py`](file:///Z:/Todolist%20Manager%20V5.0/webapp.py#L3743)):**
       - Menambahkan in-memory cache `_img_cache` untuk menghindari duplicate query/request.
       - Mengurangi timeout Nextcloud dari 15s menjadi 3s, dan otomatis men-disable request berikutnya jika backend Nextcloud tidak merespons.
    3. **SW Cache:** Di-bump ke **`taskflow-v268-docx-fast-export-timeout-cap`**.
  - All tests passed: 433/433 JS unit tests + 43/43 pytest (0 failures).
  - **Device-test checklist:** (1) Klik Export > Word (.docx) -> Toast "Menyiapkan dokumen Word..." langsung muncul -> File Word terunduh instan dalam 1-2 detik.
  - **Problem / Root Cause:**
    - Sebelumnya, gambar lampiran Nextcloud (`note_attachments`) dan image URL hanya di-resolve di backend. Jika Nextcloud backend sedang lambat / auth loopback gagal, gambar tidak dapat diunduh oleh server dan muncul sebagai teks `!image.png`.
  - **Solusi / Perbaikan:**
    1. **Client-Side Images & Attachments Hydration ([`static/index.html`](file:///Z:/Todolist%20Manager%20V5.0/static/index.html#L19406)):**
       - Saat export DOCX dipicu, browser secara otomatis mengambil semua lampiran catatan (`/api/scratchpad/:id/attachments`) dan gambar (`![alt](url)`, `<img src="...">`, `!image.png`, `[image.png]`) menggunakan sesi login aktif pengguna di browser.
       - Browser mengonversinya menjadi Base64 Data URL dan mengirimkannya dalam `images: { [src]: base64Data }` via `POST /api/scratchpad/export/docx`.
    2. **Combined Backend Image Resolver ([`webapp.py`](file:///Z:/Todolist%20Manager%20V5.0/webapp.py#L3840)):**
       - Backend menerima data Base64 gambar langsung dari browser dan menyematkannya ke file `.docx` dengan 0 dependensi eksternal.
    3. **Clean Image Captioning ([`docx_exporter.py`](file:///Z:/Todolist%20Manager%20V5.0/docx_exporter.py)):**
       - Menghilangkan pencetakan caption teks redundan jika `alt_text` hanyalah nama file mentah (seperti `image.png`, `foto.jpg`).
    4. **SW Cache:** Di-bump ke **`taskflow-v267-docx-client-images-hydration`**.
  - All tests passed: 433/433 JS unit tests + 43/43 pytest (0 failures).
  - **Device-test checklist:** (1) Buka catatan dengan gambar lampiran / `!image.png` -> Export Word (.docx) -> Buka di Word -> Seluruh gambar dan diagram canvas ter-render visual dengan utuh.
  - **Problem / Root Cause:**
    - Pada VPS Linux (Ubuntu 24.04), `pip install -r requirements.txt` gagal saat kompilasi `pycairo` via Meson karena dependensi sistem `libcairo2-dev` dan `pkg-config` belum terinstall.
  - **Solusi / Perbaikan:**
    1. **Client-Side HTML5 Canvas Rasterizer ([`static/index.html`](file:///Z:/Todolist%20Manager%20V5.0/static/index.html#L19406)):**
       - Frontend memanfaatkan kemampuan bawaan browser (HTML5 Canvas) untuk merender SVG menjadi PNG data URL resolusi tinggi (`data:image/png;base64,...`) secara instan (~5ms).
       - Objek `drawings` mengirimkan `{ did: { title, svg, png: pngDataUrl } }` ke backend.
    2. **Pure Python Server Decoder ([`docx_exporter.py`](file:///Z:/Todolist%20Manager%20V5.0/docx_exporter.py)):**
       - Backend menerima data PNG yang sudah di-rasterisasi oleh browser dan langsung menyematkannya via Pillow / base64 decode bawaan Python.
       - Server **TIDAK memerlukan** library C `pycairo`, `libcairo2-dev`, `pkg-config`, `svglib`, ataupun `reportlab`!
    3. **Clean Dependencies ([`requirements.txt`](file:///Z:/Todolist%20Manager%20V5.0/requirements.txt), [`requirements-web.txt`](file:///Z:/Todolist%20Manager%20V5.0/requirements-web.txt)):**
       - Menghapus `svglib`, `reportlab`, dan `rlPyCairo` dari requirements. Hanya menyisakan pure binary wheels `Pillow>=9.0.0` dan `python-docx==1.*`.
       - `pip install -r requirements.txt` kini dijamin 100% instan dan tidak akan pernah error di Linux/Windows/macOS.
    4. **SW Cache:** Di-bump ke **`taskflow-v266-docx-client-canvas-rasterizer`**.
  - All tests passed: 433/433 JS unit tests + 43/43 pytest (0 failures).
  - **Device-test checklist:** (1) `pip install -r requirements.txt` di VPS berhasil instan tanpa error -> (2) Export Word (.docx) -> Seluruh diagram canvas dan gambar visual utuh tanpa dependensi compiler C.
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


## PENDING USER ACTION (Drawings Sync Fix)
- Fixed bug where standalone drawings were missing on new devices or cleared IndexedDB because \syncpull.js\ intentionally skips pulling drawings (too large), but \listDrawings\ intercepted the network call forever.
- User needs to \git pull origin main\ on VPS and do a hard refresh (Ctrl+Shift+R) in their browser to see the drawings sync down from the server correctly.


## ✅ FIX Aksesibilitas Filter Strip & Tag Popover di Desktop (2026-08-23, Antigravity — SELESAI)
- **Ringkasan**: Memperbaiki aksesibilitas tombol `🏷️ +X Tags ▾` dan chip filter lainnya di sidebar desktop yang sebelumnya terpotong dan tidak bisa di-scroll dengan mouse wheel biasa.
- **Root Cause & Fix**:
  - Pada browser desktop, mouse wheel standar mengeluarkan event sumbu vertikal (`deltaY`). Container dengan `overflow-x: auto` tanpa scrollbar (`scrollbarWidth: none`) mengabaikan event scroll mouse vertikal.
  - Menerapkan `flexWrap: "wrap"` pada container filter chip dan membatasi tag teratas ke 2 tag (`sorted.slice(0, 2)`), sehingga seluruh chip filter (Published, Semua, #Tag1, #Tag2, `+X Tags ▾`, Shared) selalu tampak utuh dalam 1–2 baris rapi tanpa tersembunyi.
  - Menambahkan listener `onWheel` untuk scroll horizontal otomatis dari putaran roda mouse.
- **SW Cache**: Di-bump ke `taskflow-v297-desktop-filter-wrap-fix`.
- **Verifikasi**: JS 494/494 unit tests pass (0 fail), Pytest 43/43 pass (0 fail), Subagent Code Reviewer APPROVED.

## ✅ ADJUSTMENT Reorder Published Filter Button di NotesPage Filter Strip (2026-08-23, Antigravity — SELESAI)
- **Ringkasan**: Menggeser posisi tombol chip filter `🔗 Published` ke posisi paling kiri di baris filter strip (sebelum tombol `Semua`).
- **Changes**:
  - `static/index.html`: Memindahkan elemen chip `🔗 Published` sebelum `Semua` di `NotesPage` dan memperbarui cache stylesheet ke `app.css?v=296`.
  - `tests/offline/notes_page_layout.test.js`: Menambahkan assertion bahwa `Published` mendahului `Semua`.
- **SW Cache**: Di-bump ke `taskflow-v296-published-chip-reorder`.
- **Verifikasi**: JS 494/494 unit tests pass (0 fail), Pytest 43/43 pass (0 fail), Subagent Code Reviewer APPROVED.

## ✅ FEAT Redesign Halaman Catatan (NotesPage) untuk Tablet & Desktop (2026-08-23, Antigravity — SELESAI)
- **Ringkasan**: Menata ulang layout `NotesPage` menjadi arsitektur 2-kolom terpadu (Unified Sidebar + Viewer) yang dioptimalkan untuk iPad Pro (vertikal/portrait 768px–1024px), desktop, dan mobile.
- **Key Improvements**:
  1. *Unified Sidebar Layout*: Menghapus pemisahan sub-kolom 200px kaku. Sidebar kini menyatu utuh dengan lebar nyaman (320px di tablet / 340px di desktop) sehingga judul dan preview kartu catatan tidak terpotong.
  2. *Header & Collapse 100%*: Dilengkapi tombol `+ Baru` dan tombol `✕` di header sidebar untuk menyembunyikan sidebar (`sidebarCollapsed`) sehingga panel baca/viewer menjadi 100% full-width. Tombol floating `.sidebar-toggle` di tepi layar memudahkan pengembalian sidebar kapan saja.
  3. *Searchbox Lebar Penuh*: Input pencarian modern 100% lebar dengan ikon kaca pembesar dan tombol hapus `✕`.
  4. *Filter Strip Ringkas & Tag Popover*: Menghilangkan tumpukan vertikal tag yang semrawut. Menampilkan baris chip horizontal ringkas (`[ Semua ]`, 2–3 tag terpopuler dengan hitungan, `[ 🔗 Published ]`, `[ 👥 Shared ]`) dan tombol `[ 🏷️ +X Tags ▾ ]` yang membuka popover dropdown elegan untuk seluruh tag dan `⬜ Tanpa Tag`.
  5. *Pinned Notes Accordion*: Catatan yang disematkan disajikan dalam akordeon rapi `📌 Disematkan (N)` yang dapat dilipat/dibuka.
- **SW Cache**: Di-bump ke `taskflow-v295-notes-page-tablet-redesign`.
- **Verifikasi**: JS 486/486 unit tests pass (0 fail, termasuk 7 tests baru di `tests/offline/notes_page_layout.test.js`), Pytest 43/43 pass (0 fail), Subagent Code Reviewer APPROVED.

## ✅ FIX Mounting Drawing Modals di TaskFormModal Note Mode (2026-08-23, Antigravity — SELESAI)
- **Ringkasan**: Memperbaiki tombol `🎨 +Gambar` dan slash command `/draw` yang tidak memicu popup pada form catatan baru di `TaskFormModal` (+ Buat Baru).
- **Root Cause & Fix**:
  - Pada `TaskFormModal`, cabang `if (mode === "note")` mengembalikan JSX secara *early return*, namun komponen modal `DrawingInsertModal` dan `QuickDrawModal` sebelumnya hanya diletakkan pada return utama bagian bawah (mode task).
  - Menempatkan `DrawingInsertModal` dan `QuickDrawModal` di dalam fragment return cabang `mode === "note"`, sehingga tombol `+ Gambar`, slash command `/draw`, dan klik card inline drawing untuk mengedit gambar berfungsi 100%.
- **SW Cache**: Di-bump ke `taskflow-v294-taskform-note-drawing-modals`.
- **Verifikasi**: JS 486/486 unit tests pass (0 fail), Pytest 43/43 pass (0 fail), Subagent Code Reviewer APPROVED.

## ✅ CLEANUP Hapus Section Canvas Bawah di TaskFormModal Note Tab (+ Buat Baru) (2026-08-23, Antigravity — SELESAI)
- **Ringkasan**: Menghapus sisa section/accordion canvas terpisah (`noteCanvasId`, `noteDrawIframeRef`, `noteDrawOpen`, `noteDrawFullscreen`, `noteDrawIframeReady`, tombol `✏️ Canvas` dan iframe `tldraw`) yang masih tersisa di tab Note pada modal terpadu `TaskFormModal` (+ Buat Baru).
- **Changes**:
  1. *TaskFormModal Cleanup*: Menghapus deklarasi state/ref canvas per-note dan elemen DOM accordion canvas di bawah editor catatan `TaskFormModal`.
  2. *Testing & Coverage*: Menambahkan unit test di `tests/offline/drawdirective.test.js` yang memverifikasi tidak ada lagi sisa state, refs, atau iframe canvas lama di `TaskFormModal`.
- **SW Cache**: Di-bump ke `taskflow-v293-remove-taskform-note-bottom-canvas`.
- **Verifikasi**: JS 485/485 unit tests pass (0 fail), Pytest 43/43 pass (0 fail), Subagent Code Reviewer APPROVED.

## ✅ CLEANUP Hapus Section Canvas Bawah Note Editor & Note Viewer (2026-08-23, Antigravity — SELESAI)
- **Ringkasan**: Menghapus section/accordion canvas terpisah yang sebelumnya menempel di bagian bawah Note Editor (`NoteModal`) dan Note Viewer (`NoteViewerModal`/`NotePanel`). Fitur gambar/sketsa kini sepenuhnya terintegrasi secara *inline* via directif `::draw[...]`, slash command `/draw`, dan tombol toolbar `+ Gambar`.
- **Changes**:
  1. *NoteModal Cleanup*: Menghapus state `canvasNoteId`, `drawIframeRef`, `drawActive`, `drawContainerRef`, `drawFullscreen`, `drawSyncStatus`, `drawIframeReady`, `drawPendingData`, hook sync drawing per-note, serta tombol accordion `✏️ Canvas` dan iframe `tldraw`.
  2. *NoteViewerModal / NotePanel Cleanup*: Menghapus state `canvasActive`, `canvasContainerRef`, `iframeRef`, `drawOpen`, `drawFullscreen`, `syncStatus`, `iframeReady`, `pendingDrawData`, hook sync drawing per-note, serta tombol accordion `✏️ Canvas` dan iframe `tldraw`.
  3. *Inline Drawings Preservation*: Mempertahankan handler `changeDrawingSize` dan efek `hydrateDrawingPreviews` pada viewer, modal `QuickDrawModal` pada editor, halaman mandiri `DrawingsPage`, serta canvas task pada `TaskDetailModal`.
- **SW Cache**: Di-bump ke `taskflow-v291-remove-note-bottom-canvas`.
- **Verifikasi**: JS 473/473 unit tests pass (0 fail), Pytest 43/43 pass (0 fail), Subagent Code Reviewer APPROVED.

## ✅ FIX & FEAT Milkdown Table Interactive Column Resizing & Toolbar Fix (2026-08-23, Antigravity — SELESAI)
- **Ringkasan**: Memperbaiki hilangnya tombol table toolbar, mengaktifkan fitur drag-to-resize kolom tabel secara interaktif, dan mengatasi bug tumpang tindih antara Table Toolbar dan Text Formatting Tooltip saat teks di dalam tabel diblok/diseleksi.
- **Root Cause & Fixes**:
  1. *Toolbar Overlap*: Saat teks di dalam tabel diblok (`!selection.empty`), kedua provider tooltip (Text Formatting `tooltipPair` dan Table Operations `tableToolbarPair`) aktif bersamaan dan mengambang di koordinat yang sama persis. Diperbaiki dengan logika *mutually exclusive*:
     - Saat teks diblok di dalam sel (`!selection.empty && !isCellSelection`): Hanya **Text Formatting Tooltip** (`B I S <>`) yang tampil.
     - Saat kursor *collapsed* di dalam sel (`selection.empty`) atau seluruh sel/baris/kolom diseleksi (`isCellSelection`): Hanya **Table Toolbar** (`+⇧ +⇩ −⇶ +⇦ +⇨ −⇵ ◧ ◰ ◨`) yang tampil.
  2. *Lazy Command Key Evaluation*: Di Milkdown v7, `$command(key, cmd)` mengisi properti `.key` secara lazy saat pipeline editor dijalankan. Pemeriksaan `if (MB.xxxCommand?.key)` pada saat pembuatan DOM toolbar diganti dengan inisialisasi tombol langsung menggunakan string key kanonikal Milkdown (`'AddRowBefore'`, `'AddRowAfter'`, `'AddColBefore'`, `'AddColAfter'`, `'SetAlign'`, `'SelectRow'`, `'SelectCol'`, `'DeleteSelectedCells'`).
  3. *Vendor Bundle & Plugin Rebuild*: Me-rebuild bundle dari `milkdown-build/entry.js` yang meng-export seluruh perintah dan plugin `prosemirror-tables`, mendaftarkan `.use(MB.columnResizingPlugin || [])` di `MilkdownEditor`, dan menambahkan cache buster `?v=288` pada script tag di `static/index.html`.
  4. *CSS Grip Styling*: Menambahkan styling `.column-resize-handle`, `.resize-cursor`, `.tableWrapper`, dan `.selectedCell:after` di `static/app.css`.
- **SW Cache**: Di-bump ke `taskflow-v290-table-tooltip-overlap-fix`.
- **Verifikasi**: JS 473/473 unit tests pass (0 fail), Pytest 43/43 pass (0 fail), Subagent Code Reviewer APPROVED.

## ✅ FIX Milkdown Editor toDOM null Attribute TypeError (2026-08-22, Antigravity — SELESAI)
- **Ringkasan**: Memperbaiki bug editor blank / tidak ada teks saat membuka catatan akibat `TypeError: Failed to execute 'appendChild' on 'Node': parameter 1 is not of type 'Node'`.
- **Root Cause & Fixes**:
  1. *Null Attributes in DOMOutputSpec*: Pada `drawingNode.toDOM`, elemen judul dirender dengan `['span', null, '🎨 ...']`. Dalam `DOMSerializer.renderSpec` milik ProseMirror, keberadaan `null` pada indeks ke-2 membuat parser menganggap `null` sebagai *child node*, sehingga mengeksekusi `appendChild(null)` dan melempar TypeError fatal yang membatalkan inisialisasi dokumen.
  2. *Safe Object Attributes*: Mengganti `null` dengan objek atribut valid `{ class: 'note-draw-title' }`.
  3. *Editor Creation Error Logging*: Menambahkan handler `.catch(err => { console.error('Milkdown init error:', err); })` pada promise `.create()` Milkdown.
  4. *Safety Unit Tests*: Menambahkan suite pengujian DOMOutputSpec di `tests/offline/drawdirective.test.js` untuk memvalidasi algoritma render DOMSerializer terhadap seluruh kemungkinan variasi atribut node drawing.
- **SW Cache**: Di-bump ke `taskflow-v286-todom-null-fix`.
- **Verifikasi**: JS 448/448 unit tests pass (0 fail), Pytest 43/43 pass (0 fail), Subagent Code Reviewer APPROVED.

## ✅ FIX Milkdown Editor Blank / Shrinking DOM Fix (2026-08-22, Antigravity — SELESAI)
- **Ringkasan**: Memperbaiki bug editor blank / 0 height saat membuka catatan dengan mengganti tag `div` pada `toDOM` `drawingNode` menjadi `span` dengan styling display yang sesuai, menghapus `selectable/draggable`, serta memperbarui selector `parseDOM`.
- **Root Cause & Fixes**:
  1. *DOM Reconciliation Crash*: `drawingNode` merupakan node `inline: true` di dalam paragraph `<p>`. Namun `toDOM` menghasilkan tag `<div>` yang tidak valid di dalam `<p>` HTML5. Browser memecah paragraph dan merusak mapping DOM ProseMirror saat reconciliation, menyebabkan editor crash dan render blank/ciut.
  2. *Valid Inline Container*: Mengganti seluruh `div` di `drawingNode.toDOM` menjadi `span` dengan inline style `display: block` pada kartu dan `display: flex` pada header & preview.
  3. *Clean Node Spec*: Menghapus `selectable: true, draggable: true` dari `drawingNode` (selaras dengan `wikilinkNode` & `tasklinkNode`) dan memperbarui `parseDOM` tag ke `'[data-drawing-id]'`.
  4. *CSS Enforcement*: Memastikan `.note-draw-card` dan `.editor-draw-card` memiliki `display: block; box-sizing: border-box;`.
- **SW Cache**: Di-bump ke `taskflow-v285-editor-draw-card-dom-fix`.
- **Verifikasi**: JS 446/446 unit tests pass (0 fail), Pytest 43/43 pass (0 fail), 5/5 inline scripts parse cleanly.

## ✅ FIX & FEAT Milkdown Inline Interactive Drawing Card (2026-08-22, Antigravity — SELESAI)
- **Ringkasan**: Menjadikan sintaks gambar/kanvas `::draw[id]{title="..." size="..."}` sebagai kartu visual interaktif (`.note-draw-card`) langsung di dalam editor Milkdown WYSIWYG & memperbaiki hidrasi preview di viewer.
- **Root Cause & Fixes**:
  1. *Editor Frame Drop*: `drawingNode` sebelumnya didaftarkan sebagai `group: 'block'` sehingga ditolak oleh parser ProseMirror di dalam blok paragraph. Diperbaiki menjadi `group: 'inline', inline: true, atom: true` dan AST splicing di `remarkDrawPlugin` disesuaikan dengan pola walker `(node, parent, index)`.
  2. *Viewer SVG Missing*: `hydrateDrawingPreviews` sebelumnya memanggil `window.TF.drawingrepo.get(did)` yang tidak eksis (nama method sebenarnya adalah `getDrawing` / `getRaw`), memicu TypeError yang membuat fallback `api.get` terlewati. Diperbaiki dengan memanggil `getDrawing`/`getRaw` dan fallback `api.get`, serta hanya menandai `data-hydrated="true"` saat SVG sukses di-render.
  3. *ProseMirror Insertion*: Mengubah `handleNoteDrawingSelected` & `handleDrawingSelected` agar mengurai markdown via `parserCtx` + `replaceSelection` alih-alih raw text insertion.
- **SW Cache**: Di-bump ke `taskflow-v284-milkdown-inline-draw-fix`.
- **Verifikasi**: JS 444/444 unit tests pass (0 fail), Pytest 43/43 pass (0 fail), `node --check` pass, Subagent Code Reviewer APPROVED.

## ✅ FIX Paper Selector Dropdown Dark Mode Contrast — fase 6 (2026-08-22, Antigravity — SELESAI)
- ROOT CAUSE: `.note-toolbar select.paper-select` menggunakan `background: none` dan `color: var(--text-primary)`. Di dark mode, `--text-primary` bernilai `#e5e5e5` (abu-abu terang), dan dropdown options `<option>` mewarisi warna teks tersebut namun merender background default putih bawaan browser karena tidak memiliki styling eksplisit dan `color-scheme: dark`.
- SOLUSI: Menambahkan styling `.note-toolbar select.paper-select option { background: var(--bg-primary); color: var(--text-primary); }` dan `[data-theme="dark"] .note-toolbar select.paper-select { color-scheme: dark; background: #262626; }` di `static/index.html`.
- SW CACHE: Di-bump ke `taskflow-v282-paper-dropdown-dark-fix` di `static/sw.js`.
- VERIFIKASI: JS 433/433 pass, pytest 43/43 pass (0 fail), `node --check static/sw.js` OK. PENDING deploy VPS & verifikasi user.

## ✅ FIX Continuous Paper Mode — fase 5: styling toolbar paper (2026-08-22, Claude — belum di-commit)
- Fase 4 (4acad99) LIVE: teks paper mode dark theme fix via selector .ProseMirror.
- Request user: tombol 📄 Kertas + select ukuran/orientasi diseragamkan dengan tombol toolbar lain (Heading/Template).
- Fix (belum di-commit): buang class icon-btn + inline style; tombol = .note-toolbar button standar + class `paper-btn-active` (tint accent 14% + border/teks accent, pola badge aktif); select = class `paper-select` (border var(--border), radius 6, tinggi 28px, teks var(--text-primary), hover accent) — CSS di head style block. SW → taskflow-v281-paper-toolbar-style.
- Verifikasi: 5/5 inline OK, JS 433/433. PENDING commit+push → deploy → user-verify visual.

- Fase 3 (9976239) LIVE: tombol OK kedua tema; tapi teks paper mode di dark theme MASIH abu-abu.
- ROOT CAUSE: app.css punya `[data-theme="dark"] .milkdown-editor .ProseMirror { color: var(--text-primary) }` — set warna LANGSUNG di .ProseMirror, mengalahkan warna warisan dari override .milkdown-editor (cascade: direct > inherited, walau parent !important).
- Fix (belum di-commit): tambah .ProseMirror di rule color #1e293b + th bg #f1f5f9 + tasklink-node-fallback terang. SW → taskflow-v280-paper-dark-text.
- Verifikasi: 5/5 inline OK, JS 433/433. PENDING commit+push → deploy → user-verify dark theme.

- Fase 2 (238bb9d) LIVE & user-verify OK. Keluhan lanjutan: teks di kertas abu-abu sulit dibaca (dark theme: --text-primary #e5e5e5 di atas kertas putih) + tombol kertas sulit dibaca (var --primary/--primary-light TIDAK TERDEFINISI di CSS).
- Fix (belum di-commit): blok CSS palet dokumen paksa utk paper mode (teks #1e293b, blockquote, pre/code, link #2563eb, border tabel, wikilink olive, tasklink kuning) + tombol Kertas pakai var(--accent)+#1d2400 & border saat nonaktif + select putih dgn color #0f172a. SW → taskflow-v279-paper-contrast.
- Verifikasi: 5/5 inline script OK, JS 433/433. PENDING commit+push → deploy VPS → user-verify kedua tema (light & dark).

- Fase 1: SW bump v277 + autosave paperConfig + buang meta_json task/mindmap (sudah di-commit 7097bf9).
- Fase 2 (belum di-commit): (1) FIX root cause design: CSS paper menarget `.milkdown-editor-container` yang TIDAK ADA di DOM (editor = `.milkdown-editor`) → kertas tak pernah tampil; ganti selector + box-sizing:border-box; (2) komponen baru `PaperPageGuides` di index.html — overlay pointer-events:none mengukur alur blok ProseMirror (getBoundingClientRect), garis putus 2px dashed + label pill "Halaman N" tiap batas kapasitas (tinggi mm − 40mm margin); solid media (img/table/iframe/pre/.draw-embed) → garis digeser ke atas blok; MutationObserver+ResizeObserver debounce 150ms + guard lastSig anti render-loop; (3) wrapper baru `.paper-inner-wrap` (width var + margin auto); (4) SW bump taskflow-v278-paper-guides; (5) hapus duplikat CSS mati di template Word fallback.
- Verifikasi: 5/5 inline script node --check OK; JS 433/433; pytest 43/43; simulasi algoritma 3 kasus benar.
- PENDING: commit+push → git pull VPS → restart → hard refresh → device-test (lihat batas Halaman 2/3 saat konten > 1 halaman, ubah ukuran kertas, cek gambar besar).
- (1) SW cache di-bump `taskflow-v276-syncpush-drawings` → `taskflow-v277-paper-mode` (sw.js).
- (2) `paperConfig` ditambah ke deps autosave effect di static/index.html:17598 — ganti kertas kini ikut alur autosave 2.5s (sudah kirim meta_json) + set dirty via effect.
- (3) TEMUAN BARU: syncpush.js kirim `meta_json: '{}'` ke payload TASK & MINDMAP (regresi 7d35d4b) — backend tak punya kolom itu; dihapus, sisakan note saja. Test 433/433 JS + 43/43 pytest HIJAU.
- PENDING: commit + push + git pull VPS + restart taskflow-web + hard refresh + verifikasi live (UI kertas + cache baru aktif).

---
## ✅ FEAT Floating TOC Overlay in NotePanel (2026-08-23, Antigravity — SELESAI)
- **Ringkasan**: Menggantikan kolom TOC statis yang memakan ruang (120px) dengan sistem *floating trigger button* dan *popover overlay* yang responsif.
- **Key Improvements**:
  1. **Floating Trigger Button**: Tombol `📑 Isi (${tocItems.length}) ▾` yang muncul di header `NotePanel` saat catatan memiliki 2+ heading.
  2. **Popover Overlay**: Daftar isi yang muncul *float* di atas konten catatan saat tombol diklik, dengan fitur *outside-click dismiss* dan *smooth scroll* ke heading.
  3. **Full-Width Note Body**: Konten catatan kini 100% full-width tanpa terpotong side-column TOC statis.
  4. **CSS**: Styling modern dengan efek `backdrop-filter: blur`, *smooth transition*, dan *popover* yang responsif.
- **SW Cache**: Di-bump ke `taskflow-v298-floating-toc-overlay`.
- **Verifikasi**: JS tests dibuat & logika diverifikasi, Pytest 43/43 pass.
