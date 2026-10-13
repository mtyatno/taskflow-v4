## 🚨 CRITICAL WARNING FROM PAST SESSION 🚨
**ATTENTION ALL AGENTS:** In a previous session, an agent was severely reprimanded by the user for ignoring the Superpowers plugin rules, writing code inline (cowboy coding), breaking the database with untested migrations, and falsely claiming a task was complete without running tests.
**YOU MUST NOT REPEAT THIS.**
1. Read the Superpowers skills (`subagent-driven-development`, `requesting-code-review`, etc.).
2. Delegate implementation and review tasks to SUBAGENTS.
## 🟠 Proses Inbox: prioritas, project, tanggal bisa diedit — 2026-10-13 (Claude) — NEEDS REVIEW
- **Status:** Draft PR dari `claude/project-thread-yxh0y6`, SW v408 `taskflow-v408-inbox-wizard-edit`, app.css?v=330. Tunggu "merge dan deploy". Item 6 dari daftar Eisenhower/task Bapak; item 1-5 dikerjakan thread lain (bisa bentrok versi SW, cek main sebelum merge).
- **Fitur:** `GtdWizardEditFields` di `GtdInboxWizardModal`: tombol P1-P4, select project (+ project baru), input tanggal + chip Hari ini/Besok/+7 hari + tombol hapus. Tiap perubahan langsung disimpan lewat `handleUpdateTaskFields` (App, PUT parsial, optimistik, antre offline). Kuadran tampil sebagai badge dan ikut berubah. Kartu "dikunci" ke task yang sedang diedit (`pinnedIdRef`) karena daftar inbox diurutkan ulang saat prioritas berubah. Overlay wizard z-index 60 agar FAB mobile tidak menutupi tombol.
- **Bug ikut diperbaiki:** `taskToUpdatePayload` (static/offline/syncpush.js) mengirim `deadline: null` saat tanggal dihapus, padahal server mengabaikan null → hapus tanggal tidak pernah tersinkron. Sekarang mengirim `""`.

## 🟢 Callout "> [!NOTE]" tampil mentah di penampil catatan — 2026-10-13 (Claude) — DI-MERGE & DEPLOY
- **Status:** PR #21 di-merge (`8f166c4`) atas "merge dan deploy" Bapak; Deploy Taskflow V4 run #886 sukses. SW v407 `taskflow-v407-note-callout-render`, app.css?v=329. `webapp.py` (/api/version) baru aktif setelah `sudo systemctl restart taskflow-web`.
- **Penyebab:** menu `/callout` menyisipkan teks `> [!NOTE]\n> ` ke paragraf (insertText) → Milkdown menyimpan `\> \[!NOTE] > isi` (ter-escape), jadi penampil menampilkan teks mentah. `>` yang diketik setelah Shift+Enter juga tersimpan `\>`.
- **Fix:** `/callout` membuat blockquote sungguhan (`[!NOTE]` + paragraf isi); `repairQuoteMarkdown()` (sebelum `renderMarkdown`) mengubah baris `\>` di luar blok kode jadi kutipan dan memecah callout satu baris lama; editor memuat markdown lewat fungsi yang sama dan memberi kelas `note-callout-editing` + ikon lewat node view `createCalloutBlockquotePlugin`. Callout dan blockquote kini tanpa garis kiri (latar lembut + ikon); teks callout/toggle terbaca di Mode Kertas saat tema gelap. `NOTE_CALLOUT_TYPES` dipakai bersama.
- **Belum:** halaman catatan publik (`/p/...`, mistune di webapp.py) belum merender callout dan masih bergaris kiri.

## 🟠 Ikon PWA tidak ter-update setelah pasang ulang — 2026-10-13 (Claude) — NEEDS REVIEW
- **Status:** Draft PR dari `claude/android-icon-margin-8g31kx`, SW v406 `taskflow-v406-pwa-icon-refresh`. Tunggu "merge dan deploy".
- **Masalah:** setelah PR #18 (v405) Bapak uninstall + install ulang PWA, ikon tetap lama. SW lama menyajikan `/manifest.json` dan `icon-*.png` cache-first dari precache (SW baru menunggu tombol update), dan uninstall PWA tidak menghapus cache/SW situs.
- **Fix:** URL manifest dan ikon diberi `?v=2` (index.html, manifest.json, precache sw.js) supaya cache lama tidak cocok; SW: manifest + `/static/icon-*.png` network-first; precache pakai `cache: "reload"`; `/manifest.json` dikirim dengan `Cache-Control: no-cache`.

## 🟡 Margin Ikon Aplikasi Android (PWA maskable + Tauri) — 2026-10-13 (Claude) — DI-MERGE
- **Status:** 🟡 PR #18 di-merge atas "merge dan deploy" Bapak (2026-10-13), SW v405 `taskflow-v405-android-icon-margin`.
- **Masalah:** `icon-192/512.png` (logo memenuhi seluruh kanvas) juga dipakai sebagai `purpose: maskable`, jadi launcher Android memotong logo dan tanpa margin.
- **Solusi:** `scripts/gen_app_icons.py` mengangkat logo dari `src-tauri/icons/icon-source.png` (tidak diubah) ke latar putih solid: `icon-192/512.png` (any, logo 72%), `icon-maskable-192/512.png` baru (logo 56%, di dalam safe zone 80%), dan ikon Tauri Android `mipmap-*/ic_launcher*.png` (sebelumnya masih logo TaskFlow lama). `manifest.json` menunjuk ikon maskable baru; `sw.js` meng-cache keduanya.
- **Catatan:** v403 dinaikkan ke v405 karena PR #17 (v401) dan PR #19 (v404) masuk main lebih dulu. Di Android, ikon baru bisa jadi baru muncul setelah uninstall + pasang ulang. `draw_local_reactive.test.js` 1 gagal sudah ada di main.

## 🟠 Tombol + blok di editor catatan (mobile) — 2026-10-13 (Claude) — NEEDS REVIEW
- **Status:** Draft PR dari branch `claude/fix-mobile-block-plus-menu-yssn7h`, SW v404 `taskflow-v404-mobile-block-plus-menu` (v402/v403 dilewati: v403 dipakai branch android-icon-margin). Menunggu Bapak bilang "merge dan deploy".
- **Bug:** di HP, ketuk "+" di depan blok → "/" muncul di paragraf baru tapi slash menu tidak terbuka, kursor pindah ke blok bawah.
- **Penyebab:** `preventDefault` di `pointerdown` tidak membatalkan `click` kompatibilitas dari ketukan. Saat click tiba, handle sudah tersembunyi (dokumen berubah) → click jatuh ke `.milkdown-editor`, handler "klik area kosong" memindahkan kursor ke baris terakhir, slash menu batal.
- **Fix:** `addBtn` listener `touchend` non-passive dengan `preventDefault()` (MilkdownEditor, static/index.html). Tes baru di `tests/offline/block_handle.test.js`.

## 🟠 Mode Kertas di HP lebar penuh — 2026-10-13 (Claude) — NEEDS REVIEW
- **Status:** Draft PR dari branch `claude/mobile-paper-mode-loyv6u`, SW v401 `taskflow-v401-mobile-paper-mode`. Menunggu Bapak bilang "merge dan deploy".
- Gaya lembar kertas kini di dalam `@media (min-width: 769px)`; di <= 768px catatan tampil normal (lebar penuh, ikut tema), garis halaman dan kontrol kertas (`.paper-controls`) disembunyikan. Pilihan kertas per catatan (meta_json) tidak berubah. Detail di SESSION_LOG.

## ✅ (dieksekusi, lihat di atas) RENCANA KERJA: Adaptasi Responsif Layar Kecil (Mobile) untuk Mode Kertas Note Viewer & Note Editor
- **Status:** Dieksekusi 2026-10-13 oleh Claude (lihat bagian di atas).
- **Rencana Kerja Tertulis:** `docs/superpowers/plans/2026-10-13-mobile-responsive-paper-mode.md`.
- **Konteks & Kebutuhan:**
  - Pengguna mencatat bahwa pada perangkat mobile berlayar kecil, tampilan kertas dengan lebar fisik 210mm dan padding 20mm memaksa pengguna menggeser-geser layar secara horizontal (*horizontal scroll*) sehingga tulisan sulit dibaca.
  - Solusi yang disepakati:
    - **Layar Lebar & Besar (Desktop / Laptop / Tablet >= 769px):** Tampilan kertas tetap aktif dan memberikan sensasi membaca & menulis lembaran fisik A4 yang memuaskan.
    - **Layar Kecil / Mobile (<= 768px):** Tampilan **BUKAN tampilan kertas**, melainkan otomatis mengalir *fluid full-width* 100% tanpa *box-shadow*, tanpa batas fisik 210mm, padding natural, mengikuti tema aktif HP (gelap/terang), serta menyembunyikan garis panduan halaman (`PaperPageGuides`) dan dropdown select kertas di toolbar.
- **Rencana Langkah Eksekusi (Malam Hari):**
  1. Tambahkan CSS responsif `@media (max-width: 768px)` untuk `.paper-mode-active`, `.paper-inner-wrap`, `.milkdown-editor`, `.note-rendered`, `.paper-page-guides`, dan `select.paper-select` di `static/index.html`.
  2. Tambahkan unit test di `tests/offline/note_paper_mode.test.js` untuk memverifikasi aturan responsif mobile.
  3. Verifikasi menyeluruh: inline scripts OK, tests passed 100%, ZERO `border-left`.

## 🟢 Mode Kertas (Paper Mode) di Note Viewer (NotePanel) — 2026-10-13 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI. Branch `feat/note-viewer-paper-mode`. SW v400 `taskflow-v400-note-viewer-paper-mode`.
- **Konteks & Masalah:**
  - Sebelumnya, tampilan lembaran kertas (Paper Mode) hanya tersedia saat mode edit di Note Editor (`NoteModal`). Pengguna menginginkan opsi tampilan kertas yang sama juga tersedia saat membaca catatan di Note Viewer (`NotePanel`) baik pada dark theme maupun light theme.
  - Sesi ini dijalankan secara terisolasi dengan standar industri (branch terisolasi dan zero-touch ke NoteToolbar/NoteModal) untuk menjamin tidak ada konflik dengan sesi paralel sebelah.
- **Solusi & Implementasi:**
  1. **`static/index.html`:**
     - Menambahkan styling desk gelap untuk dark theme: `[data-theme="dark"] .paper-mode-active { background-color: #18181b !important; }`.
     - Memperluas selector CSS `.paper-mode-active .paper-inner-wrap .milkdown-editor` agar mencakup `.note-rendered` (background putih solid, box shadow, min-height, padding 20mm, box-sizing, tipografi `#1e293b` untuk blockquote, code, pre, table, link, wikilink, tasklink).
     - Menambahkan styling `.notes-panel-actions button.paper-btn-active` dan `.notes-panel-actions select.paper-select` (lengkap dengan mode gelap).
     - Memperbarui `PaperPageGuides`: `const pm = root.querySelector('.ProseMirror') || root.querySelector('.note-rendered');` sehingga garis pembatas halaman otomatis menghitung tinggi dokumen di Note Viewer.
     - Pada `NotePanel`:
       - Menambahkan state `viewerPaperConfig` dengan inisialisasi cerdas `initViewerPaperConfig` yang membaca `meta_json.paper_mode` (default `enabled: true, size: 'A4', orientation: 'portrait'`, serta menjaga `user_toggled: true`).
       - Menambahkan handler `saveViewerPaperConfig` dengan update instan ke state dan `note.meta_json` via `PUT /api/scratchpad/:id` serta antrean outbox offline `OfflineDB.queueAdd`.
       - Menambahkan tombol toggle "Kertas" (`React.createElement(Icon, { name: "fileText", size: 14 })`) serta dropdown ukuran kertas (`A4`, `Letter`, `A3`, `Legal`) dan orientasi (`portrait`, `landscape`) di `.notes-panel-actions`.
       - Membungkus `.note-rendered` ke dalam `.paper-mode-active` dan `.paper-inner-wrap` dengan CSS variables `--paper-width` & `--paper-height` serta `PaperPageGuides` ketika paper mode aktif.
     - Bump fallback SW version ke `taskflow-v400-note-viewer-paper-mode`.
     - Strict isolation: Baris NoteToolbar (18990-19570), NoteModal, MilkdownEditor, Dashboard, GTD Wizard, auth isolation terlindungi 100% tanpa modifikasi. ZERO `border-left` atau `borderLeft`.
  2. **Backend & Service Worker:**
     - `webapp.py`: bump `sw_cache` ke `taskflow-v400-note-viewer-paper-mode`.
     - `static/sw.js`: bump `CACHE` ke `taskflow-v400-note-viewer-paper-mode`.
     - `tests/test_version.py`: bump asersi ke `taskflow-v400-note-viewer-paper-mode` dan `v400`.
  3. **Pengujian:**
     - Menambahkan suite pengujian komprehensif baru di `tests/offline/note_paper_mode.test.js` (7 tests) memvalidasi Note Viewer Paper Mode, inisialisasi state, default & user_toggled, toggle & select buttons di NotePanel, pembungkus paper-mode-active & PaperPageGuides, serta CSS rules untuk note-rendered dan dark desk.
     - Sinkronisasi SW cache `taskflow-v400-note-viewer-paper-mode` di seluruh 8 test suite offline.
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `git diff -U0 | grep -iE "border-?left"` ➡️ **0 matches (OK)**.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
  - `node --test tests/offline/*.test.js` ➡️ **1085/1085 passed (0 failed)** across 8 suites.

## 🟢 Modernisasi Ikon Note Editor Toolbar (NoteToolbar) ke Lucide SVG Icons — 2026-10-13 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI.
- **Konteks & Masalah:**
  - Toolbar editor catatan (`NoteToolbar`) sebelumnya menggunakan campuran emoji lawas dan karakter teks unicode (seperti `\uD83D\uDCCB`, `H \u25BE`, `B`, `I`, `</>`, `\u2261`, `\u2611`, `\u275D`, `\u2014`, `\uD83D\uDCCE`, `📄 Kertas`, dll.) yang inkonsisten dan kurang modern.
  - Pengguna membutuhkan standarisasi ikon Lucide SVG seragam dengan standar industri (`viewBox="0 0 24 24"`, `stroke="currentColor"`, `strokeWidth=1.9`, `fill="none"`) dan penataan layout tombol yang rapi serta presisi.
- **Solusi & Implementasi:**
  1. **`static/ui-components.js`:**
     - Mendaftarkan seluruh ikon SVG Lucide yang dibutuhkan ke kamus `ICONS`: `bold`, `italic`, `code`, `heading`, `checkSquare`, `quote`, `listOrdered`, `strikethrough`, `table`, `minus`, `mic`, `fileText`.
  2. **`static/index.html`:**
     - Memodernisasi seluruh tombol pada `NoteToolbar` dengan `React.createElement(Icon, ...)`:
       - Template: `[Icon('clipboardCheck'), span('Template'), Icon('chevronDown')]`
       - Heading: `[Icon('heading'), Icon('chevronDown')]`
       - Bold: `Icon('bold')`
       - Italic: `Icon('italic')`
       - Inline Code: `Icon('code')`
       - Bullet List: `Icon('list')`
       - Checklist: `Icon('checkSquare')`
       - Blockquote: `Icon('quote')`
       - + Task: `[Icon('checkSquare'), span('Task')]`
       - + Gambar: `[Icon('draw'), span('Gambar')]`
       - Format Lainnya (+): `Icon('plus')`
         - Numbered List: `Icon('listOrdered')`
         - Strikethrough: `Icon('strikethrough')`
         - Table: `Icon('table')`
         - Wikilink: `[Icon('link'), span('Wiki')]`
       - Horizontal Rule: `Icon('minus')`
       - Lampirkan File: `Icon('paperclip')`
       - Dikte Suara: `Icon('mic')` + indikator status dot (merah untuk listening, kuning untuk paused)
       - Mode Kertas: `[Icon('fileText'), span('Kertas')]` dengan seluruh prop, title, dan select size/orientation tetap utuh.
     - Strict isolation: Baris-baris note editor di luar `NoteToolbar` dan file-file di `static/offline/` terlindungi utuh tanpa modifikasi.
  3. **`static/app.css`:**
     - Memperbarui styling `.note-toolbar button` dan `.note-mic-btn`: height 28px, border-radius 7px, gap 3px, padding 0 8px, align-items center, justify-content center, dan zero border (left).
  4. **Pengujian:**
     - Membuat unit test suite baru `tests/offline/note_toolbar_icons.test.js` (6 unit tests):
       - Validasi kamus `ICONS` di `ui-components.js`.
       - Validasi pemanggilan `React.createElement(Icon, ...)` untuk setiap tombol di `NoteToolbar`.
       - Validasi ketiadaan emoji/unicode lawas di tombol `NoteToolbar`.
       - Validasi kelengkapan atribut dan kontrol Mode Kertas.
       - Validasi styling modern `.note-toolbar button` di `static/app.css`.
     - Seluruh 93 tes note editor offline passed (`note_toolbar_icons.test.js`, `note_paper_mode.test.js`, `note_toc.test.js`, `interactive_note_viewer.test.js`, `note_editor_trailing_block.test.js`).
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/ui-components.js` ➡️ **OK**.
  - `git diff -U0 | grep -iE "border-?left"` ➡️ **0 matches (OK)**.
  - `node --test tests/offline/note_toolbar_icons.test.js tests/offline/note_paper_mode.test.js tests/offline/note_toc.test.js tests/offline/interactive_note_viewer.test.js tests/offline/note_editor_trailing_block.test.js` ➡️ **93/93 passed (0 failed)**.

## 🟢 Multi-Account Local DB & Session Isolation pada Logout & Account Switch — 2026-10-13 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI. SW v399 `taskflow-v399-user-switch-localdb-isolation`.
- **Konteks & Masalah:**
  - Pengguna melaporkan bahwa dalam satu laptop yang sama di mana beberapa anggota keluarga bergantian menggunakan Alurik via Google Chrome PWA dengan akun masing-masing, ketika ada akun yang logout dan akun lain login, akun yang baru masuk masih membaca data local database (IndexedDB `taskflow-offline` & `taskflow-legacy-cache`, serta CacheStorage API cache) milik akun sebelumnya.
  - Akar masalah:
    1. Fungsi `logout()` sebelumnya hanya mereset state in-memory React dan menghapus token, tanpa membersihkan object store di IndexedDB `taskflow-offline` (`tasks`, `habits`, `scratchpad_notes`, `_outbox`, dll.) maupun `taskflow-legacy-cache` (`cache` dan `queue`).
    2. Singleton `api._localRouter` tetap aktif merutekan request `/api/tasks` dsb. ke IndexedDB lokal yang masih berisi rekaman pengguna sebelumnya.
    3. `handleLogin()` dan `tryAuth()` tidak membandingkan ID akun yang masuk (`user_id`) dengan akun sebelumnya yang tercatat di local storage.
    4. Service Worker CacheStorage menyimpan cache respons GET `/api/*` sehingga saat offline atau cache hit, data API lama dapat terambil.
- **Solusi & Implementasi:**
  1. **`static/offline/db.js`:**
     - Menambahkan fungsi `clearAll()` yang membuka database `taskflow-offline` dan mengosongkan seluruh object store dalam satu transaksi `readwrite`, serta mengeksposnya pada `publicApi` dan module exports.
  2. **`static/index.html`:**
     - Pada `OfflineDB`: menambahkan `cacheClear()` dan `clearAll()` untuk mengosongkan store `cache` dan `queue` pada `taskflow-legacy-cache`.
     - Menambahkan fungsi komprehensif `clearLocalUserData()` yang:
       - Memanggil `TF.db.clearAll()` untuk mengosongkan IndexedDB `taskflow-offline`.
       - Memanggil `OfflineDB.clearAll()` untuk mengosongkan IndexedDB `taskflow-legacy-cache`.
       - Menghapus entri endpoint `/api/` dari semua cache di `window.caches` (CacheStorage).
       - Menghapus key `localStorage` terikat user: `tf_user_id`, `tf_pomo_state`, `tf_last_review`, `tf_review_snooze`, `tf_last_backup`, `tf_backup_snooze`, `tf_dismiss_onboarding`, `tf_ai_review_optin`.
       - Mereset singleton lokal `api._localRouter = null`, `TF.db._reset()`, dan mengosongkan user closures pada `chatrepo`, `noterepo`, dan `mindmaprepo`.
     - Integrasi pada `logout()`: jika online, mencoba flush outbox via `window.__pushNow()` sebelum logout agar data offline pengguna lama terunggah ke akunnya, memanggil endpoint logout server, mengeksekusi `await clearLocalUserData()`, mereset `initialLoad.current = true`, dan mengosongkan seluruh state in-memory React.
     - Integrasi pada `handleLogin(data)`: mendeteksi pergantian user ID (`prevUserId !== data.user_id`), memanggil `await clearLocalUserData()` jika berganti akun, dan mencatat `tf_user_id` baru.
     - Integrasi pada `tryAuth()`: mendeteksi pergantian user ID pada `/api/auth/me` berhasil maupun token decode fallback offline, memanggil `clearLocalUserData()` jika akun berbeda; serta memanggil `clearLocalUserData()` saat error 401 Unauthorized.
     - Bump fallback `window.__SW_VERSION` dan info About modal ke `taskflow-v399-user-switch-localdb-isolation`.
     - Strict isolation: Baris note editor (Milkdown, dll.) 100% terjaga. ZERO border (left).
  3. **Backend & Service Worker:**
     - `webapp.py`: bump `sw_cache` ke `taskflow-v399-user-switch-localdb-isolation`.
     - `static/sw.js`: bump `CACHE` ke `taskflow-v399-user-switch-localdb-isolation`.
     - `tests/test_version.py`: bump asersi ke `taskflow-v399-user-switch-localdb-isolation` dan `v399`.
  4. **Pengujian Komprehensif:**
     - Menambahkan unit test di `tests/offline/db.test.js`: verifikasi `clearAll` mengosongkan seluruh entity dan system stores.
     - Membuat unit test suite baru `tests/offline/user_session_isolation.test.js` (7 tests):
       - `TF.db.clearAll()` mengosongkan seluruh store `taskflow-offline`.
       - `OfflineDB.clearAll()` mengosongkan `cache` dan `queue`.
       - Logika cache purge menghapus request `/api/` dan mempertahankan aset statis.
       - `clearLocalUserData()` menghapus key user localStorage dan mereset router sambil mempertahankan setting umum (`theme`).
       - Account switch detection di `handleLogin` mendeteksi pergantian user ID dan memicu pembersihan.
       - Validasi keberadaan deklarasi fungsi pembersihan dan wiring di `index.html`.
       - Sinkronisasi konsistensi versi SW cache.
     - Sinkronisasi string cache SW di seluruh 12 test suite offline.
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `git diff -U0 | grep -iE "border-?left"` ➡️ **0 matches (OK)**.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
  - `node --test tests/offline/*.test.js` ➡️ **1071/1071 passed (0 failed)** across 8 suites.

## 🟢 Smart Direct GTD Inbox Wizard dari KPI Inbox Dashboard — 2026-10-13 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI. Branch `feat/dashboard-inbox-kpi-wizard`.
- **Konteks & Masalah:**
  - Sebelumnya, mengklik kartu KPI Inbox di Dashboard langsung melakukan navigasi ke halaman GTD Inbox (`onNav("inbox")`). Dari sana pengguna baru mengklik tombol "⚡ Proses Inbox".
  - Alur ini memiliki *friction* 2 langkah dan mengalihkan konteks halaman. Pengguna menginginkan proses telaah inbox dipercepat langsung dari Dashboard.
- **Solusi & Implementasi:**
  1. **`static/index.html`:**
     - Pada `GtdInboxWizardModal`:
       - Menambahkan prop `onNav`.
       - Di header modal di samping tombol tutup, menambahkan tombol aksi `"Buka Inbox ↗"` (`className="btn btn-ghost btn-xs"`) saat `onNav` tersedia, sehingga pengguna sewaktu-waktu dapat beralih ke tampilan daftar list konvensional dengan 1 klik.
     - Pada `Dashboard`:
       - Menerima prop `onUpdateGtdStatus`.
       - Menambahkan state `[inboxWizardOpen, setInboxWizardOpen] = useState(false)`.
       - Menghitung `inboxTasks` (`tasks.filter(t => t.gtd_status === "inbox" && t.gtd_status !== "done" && t.gtd_status !== "archived").sort(SORT_PRI)`).
       - Pada kartu KPI `"inbox"`: jika `inboxCount > 0`, klik membuka modal wizard secara instan (`setInboxWizardOpen(true)`); jika `inboxCount === 0`, jatuh ke `onNav("inbox")`.
       - Merender `inboxWizardOpen && React.createElement(GtdInboxWizardModal, { tasks: inboxTasks, onClose: () => setInboxWizardOpen(false), onUpdateGtdStatus, onDone, onNav })`.
     - Pada `App`:
       - Mengoper `onUpdateGtdStatus: handleUpdateTaskGtd` ke komponen `<Dashboard>`.
     - Strict isolation: Baris-baris Note Editor (MilkdownEditor, NoteModal, scratchpad, dll.) terlindungi 100% tanpa modifikasi dari pekerjaan sesi ini. ZERO `border-left` atau `borderLeft`.
  2. **Pengujian:**
     - Menambahkan Unit Test 8 di `tests/offline/gtd_inbox_triage.test.js`: memvalidasi `Dashboard` menerima `onUpdateGtdStatus`, state `inboxWizardOpen`, filter `inboxTasks`, KPI click logic (`inboxCount > 0` vs `0`), rendering `GtdInboxWizardModal`, passing prop dari `App`, dan tombol `"Buka Inbox ↗"`.
     - Sinkronisasi seluruh pengujian offline (`node --test tests/offline/*.test.js`).
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `git diff -U0 | grep -iE "border-?left"` ➡️ **0 matches (OK)**.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
  - `node --test tests/offline/*.test.js` ➡️ **1064/1064 passed (0 failed)** across 8 suites.

## 🟢 Default Paper View (Mode Kertas) Note Editor & User Toggled Preservation — 2026-10-13 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI. SW v398 `taskflow-v398-note-editor-default-paper-mode`.
- **Konteks & Masalah:**
  - Sebelumnya, tampilan Note Editor (Mode Kertas / Paper View) secara default tidak aktif (`enabled: false`). Pengguna menginginkan Mode Kertas aktif secara default saat membuat catatan baru atau membuka catatan lama tanpa modifikasi eksplisit, namun tetap mempertahankan preferensi pengguna jika pengguna secara sengaja mematikan Mode Kertas (`user_toggled: true`).
- **Solusi & Implementasi:**
  1. **`static/index.html`:**
     - `TaskFormModal` (line 2965): Inisialisasi state `notePaperConfig` diubah ke default `{ enabled: true, size: 'A4', orientation: 'portrait' }`.
     - `NoteToolbar` (line 19494): Pada saat pengguna mengklik tombol toggle mode kertas, dicatat flag `user_toggled: true`: `onPointerDown: (e) => { e.preventDefault(); onPaperConfigChange(p => ({ ...p, enabled: !p.enabled, user_toggled: true })); }`.
     - `NoteModal` (line 21718): Pembaruan fungsi `initPaperConfig`:
       - Catatan baru (tanpa `meta_json` atau `paper_mode` kosong) -> default `{ enabled: true, size: 'A4', orientation: 'portrait' }`.
       - Catatan lama/legacy (`meta.paper_mode.enabled === false` tanpa `user_toggled`) -> default `{ enabled: true, size: meta.paper_mode.size || 'A4', orientation: meta.paper_mode.orientation || 'portrait' }`.
       - Catatan dengan toggle eksplisit (`user_toggled === true`) -> mempertahankan preferensi pengguna (`enabled: meta.paper_mode.enabled`, `user_toggled: true`).
     - Versi Service Worker fallback dan About modal di-bump ke `taskflow-v398-note-editor-default-paper-mode`.
     - Strict isolation: baris Dashboard dan GtdInboxWizardModal milik sesi paralel pengguna tidak disentuh dan terlindungi seutuhnya. ZERO `border-left` atau `borderLeft`.
  2. **Backend & Service Worker:**
     - `webapp.py`: bump `sw_cache` ke `taskflow-v398-note-editor-default-paper-mode`.
     - `static/sw.js`: bump `CACHE` ke `taskflow-v398-note-editor-default-paper-mode`.
     - `tests/test_version.py`: bump asersi ke `taskflow-v398-note-editor-default-paper-mode` dan `v398`.
  3. **Pengujian:**
     - `tests/offline/note_paper_mode.test.js`:
       - Update asersi `TaskFormModal` state `notePaperConfig` ke `enabled: true`.
       - Tambah unit test komprehensif menguji `NoteModal` `initPaperConfig` untuk new note, legacy note, user-toggled off note, user-toggled on note, dan `NoteToolbar` `user_toggled: true`.
     - Sinkronisasi SW cache `taskflow-v398-note-editor-default-paper-mode` di seluruh test suite offline (`tests/offline/`).
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `git diff -U0 | grep -iE "border-?left"` ➡️ **0 matches (OK)**.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
  - `node --test tests/offline/*.test.js` ➡️ **1064/1064 passed (0 failed)** across 8 suites.

## 🟢 Task Insertion (/task, /tasks) di Popup Block Slash Menu Note Editor — 2026-10-12 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI. SW v397 `taskflow-v397-note-block-slash-task`.
- **Konteks & Masalah:**
  - Pengguna melaporkan bahwa pada popup menu block slash (`slashMenu` saat ketik `/` atau klik `+` block handle), belum ada opsi untuk memasukkan task (`/tasks` / `/task`). Hanya tersedia `/code`, `/callout`, `/toggle`, `/draw`.
  - Padahal task link (`[tasklink:...]`) adalah salah satu fitur inti catatan Alurik untuk menyematkan tugas langsung di dalam dokumen catatan.
- **Solusi & Implementasi:**
  1. **`static/index.html`:**
     - Di `MilkdownEditor`:
       - Menambahkan prop `onInsertTask` dan ref `onInsertTaskRef`.
       - Di `doSlashAction`: menangani `case 'task':` dengan menghapus pemicu query slash (`/` atau `/task`) dan memanggil `onInsertTaskRef.current?.()`. Menyesuaikan pengecualian pre-deletion `if (type !== 'draw' && type !== 'task')`.
       - Menambahkan item menu slash `slashMenu.appendChild(makeSlashItem('📌', 'Tugas / Task (/task, /tasks)', 'task'))` di baris item block bersama `/draw`, `/code`, `/callout`, `/toggle`.
     - Di `NoteDetailModal` (`NoteModal`):
       - Mengoper `onInsertTask: openTaskDropdown` ke `MilkdownEditor`.
       - Menambahkan `_taskJustOpened.current = true` di dalam `openTaskDropdown` agar dropdown tidak langsung tertutup saat ProseMirror menghapus slash command.
       - Memperluas regex inline slash command `/(?:^|\n)\/(todo|todos|task|tasks|tugas)$/i` dengan penghitungan panjang dinamis `cmdLen = todoMatch2[1].length + 1` agar `/tasks` (6 karakter) dan varian lainnya terhapus sempurna.
     - Di `TaskDetailModal` (`TaskFormModal`):
       - Mengoper `onInsertTask: openNoteTaskDropdown` ke `MilkdownEditor`.
       - Menambahkan pelindung `_noteTaskJustOpened.current` dan memperluas regex slash command `/(?:^|\n)\/(todo|todos|task|tasks|tugas)$/i`.
     - Memperbarui fallback `window.__SW_VERSION` ke `taskflow-v397-note-block-slash-task`.
  2. **Backend & Service Worker:**
     - `webapp.py`: bump `sw_cache` ke `taskflow-v397-note-block-slash-task`.
     - `static/sw.js`: bump `CACHE` ke `taskflow-v397-note-block-slash-task`.
     - `tests/test_version.py`: bump asersi ke `taskflow-v397-note-block-slash-task` dan `v397`.
  3. **Pengujian:**
     - Membuat unit test suite baru `tests/offline/note_slash_task.test.js` (8 tests) memvalidasi `makeSlashItem` untuk task, `doSlashAction` case 'task', integrasi prop `onInsertTask` di kedua modal, regex slash commands, dan cache SW.
     - Memperbarui regex `tests/offline/block_handle.test.js` untuk mengakomodasi `type !== 'task'`.
     - Sinkronisasi string cache SW di seluruh 8 test suite offline.
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `git diff -U0 | grep -iE "border-?left"` ➡️ **0 matches (OK)**.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
  - `node --test tests/offline/*.test.js` ➡️ **1056/1056 passed (0 failed)** across 8 suites.

## 🟢 Focus Button Text Label di Prioritas Hari Ini Dashboard — 2026-10-12 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI. SW v396 `taskflow-v396-dash-priority-focus-btn-label` & `app.css?v=328`.
- **Konteks & Masalah:**
  - Di Dashboard kartu "Prioritas Hari Ini" (`dash-prio-card`, dirender oleh `TodayRow`), tombol fokus sebelumnya hanya menampilkan ikon target 13px dalam kotak 22x22px tanpa label teks (`dash-focus-btn`).
  - Pengguna meminta menambahkan label teks fokus sehingga tampilannya sama persis seperti tombol fokus di halaman Fokus Hari Ini (`ftask-focus-btn` di `TodayFocusView`), menampilkan teks "Fokus" atau "Aktif".
- **Solusi & Implementasi:**
  1. **`static/app.css`:**
     - Update styling `.dash-focus-btn`: pill button dengan height 26px, padding 0 10px, border-radius 999px, gap 5px, font-size 11.5px, font-weight 700, warna `#dc2626` dan background tint `rgba(239, 68, 68, 0.06)`, berubah solid `#ef4444` dengan teks putih saat `.is-active` dan hover.
     - Dukungan penuh untuk dark mode (`[data-theme="dark"] .dash-focus-btn`).
     - Strict rule: ZERO `border-left` atau `borderLeft`.
  2. **`static/index.html`:**
     - Pada `TodayRow`, update tombol fokus `.dash-focus-btn` dengan menambahkan attribute `"aria-pressed": isFocusing` dan elemen `<span className="dash-focus-label">{isFocusing ? "Aktif" : "Fokus"}</span>`.
     - Update link stylesheet ke `/static/app.css?v=328`.
     - Update fallback `window.__SW_VERSION` ke `taskflow-v396-dash-priority-focus-btn-label`.
     - Strict isolation: note editor lines terlindungi tanpa modifikasi.
  3. **Backend & Service Worker:**
     - `webapp.py`: bump `sw_cache` ke `taskflow-v396-dash-priority-focus-btn-label`.
     - `static/sw.js`: bump `CACHE` ke `taskflow-v396-dash-priority-focus-btn-label`.
     - `tests/test_version.py`: bump asersi ke `taskflow-v396-dash-priority-focus-btn-label` dan `v396`.
  4. **Pengujian:**
     - `tests/offline/focus_workstation.test.js`: update asersi height 26px, border-radius 999px, serta teks `dash-focus-label` dan `isFocusing ? "Aktif" : "Fokus"`.
     - `tests/offline/note_toc.test.js`, `tests/offline/gtd_inbox_triage.test.js`, `tests/offline/dashboard_onboarding.test.js`: update asersi `app.css?v=328`.
     - Sinkronisasi SW cache `taskflow-v396-dash-priority-focus-btn-label` di seluruh 8 test suite offline.
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `git diff -U0 | grep -iE "border-?left"` ➡️ **0 matches (OK)**.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
  - `node --test tests/offline/*.test.js` ➡️ **1048/1048 passed (0 failed)** across 8 suites.

## 🟢 Fluid 100% Width Layout pada Page Focus & Page Habit — 2026-10-12 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI. SW v395 `taskflow-v395-fluid-focus-habit-pages` & `app.css?v=327`.
- **Konteks & Masalah:**
  - Halaman Focus (`TodayFocusView`) dan Halaman Habit (`HabitPage`) sebelumnya memiliki margin/sisi kosong di sisi kiri dan kanan pada monitor/layar lebar karena dibatasi oleh `max-width: 900px; margin: 0 auto;`.
  - Dashboard sudah menggunakan layout fluid 100% (`.dash { width: 100%; max-width: 100%; }`), dan kontainer `.main-content` sudah memiliki gutter padding standar (16px 28px di desktop, 16px di mobile).
- **Solusi & Implementasi:**
  1. **`static/app.css`:**
     - Update `.focus-page`: `width: 100%; max-width: 100%; padding: 0 0 32px;` (menggantikan `max-width: 900px; margin: 0 auto; padding: 24px 16px 32px;`).
     - Update `.focus-page` di `@media (max-width: 768px)`: `padding: 0 0 24px;`.
     - Tambahkan `.habit-page`: `width: 100%; max-width: 100%; padding-bottom: 32px;`.
     - Strict rule: TIDAK ADA styling `border-left` atau `borderLeft`.
  2. **`static/index.html`:**
     - Pada `HabitPage`, ganti root element div dari inline style `{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }` menjadi `className: "habit-page fade-in"`.
     - Update stylesheet link ke `/static/app.css?v=327`.
     - Update fallback `window.__SW_VERSION` ke `taskflow-v395-fluid-focus-habit-pages`.
     - Note editor di `static/index.html` terlindungi tanpa modifikasi.
  3. **Backend & Service Worker:**
     - `webapp.py`: bump `sw_cache` ke `taskflow-v395-fluid-focus-habit-pages`.
     - `static/sw.js`: bump `CACHE` ke `taskflow-v395-fluid-focus-habit-pages`.
     - `tests/test_version.py`: bump asersi ke `taskflow-v395-fluid-focus-habit-pages` dan `v395`.
  4. **Pengujian:**
     - `tests/offline/focus_workstation.test.js`: unit test untuk memvalidasi fluid layout `.focus-page` (width: 100%, max-width: 100%), `.habit-page` (width: 100%, max-width: 100%), dan rendering `HabitPage` tanpa inline `maxWidth: 900`.
     - `tests/offline/note_toc.test.js` & `tests/offline/gtd_inbox_triage.test.js` & `tests/offline/dashboard_onboarding.test.js`: perbarui asersi `app.css?v=327`.
     - Sinkronisasi SW cache `taskflow-v395-fluid-focus-habit-pages` di seluruh test suite offline.
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `git diff | grep -iE "border-?left"` ➡️ **0 matches (OK)**.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
  - `node --test tests/offline/*.test.js` ➡️ **1048/1048 passed (0 failed)** across 8 suites.

## 🟢 Fix Layout Hero Order & Habit Pill Mobile Overflow — 2026-10-11 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI. SW v394 `taskflow-v394-mobile-hero-habit-pill-layout` & `app.css?v=326`.
- **Konteks & Masalah:**
  - Pengguna melaporkan tampilan Hero di HP kecil:
    1. Urutan di hero amburadul dan habit pill tumpang tindih dengan persentase task hari ini karena `.dash-hero-habit-strip` sebelumnya berada di dalam `.dash-hero-text` yang berada sejajar flex row dengan `.dash-hero-progress`.
    2. Pada judul habit panjang, habit pill melebihi lebar layar dan terpotong (clipping/over display) di sisi kanan layar karena flex child tidak memiliki `min-width: 0`, tidak ada `box-sizing: border-box`, teks tidak memiliki `flex: 1 1 auto` yang dapat mengecil, dan icon/cta/count tertekan mengecil.
- **Solusi & Implementasi:**
  1. **`static/index.html`:**
     - Memindahkan `.dash-hero-habit-strip` keluar dari `.dash-hero-text` dan `.dash-hero-top`, menjadikannya direct child dari `.dash-hero` tepat di antara penutup `.dash-hero-top` dan pembuka `.scratchpad-bar.dash-capture`. Baris atas menampilkan greeting & task progress ring tanpa terganggu, dan baris bawahnya habit pill strip full-width.
     - Menambahkan `className: "dash-hero-habit-name"` pada span completed habit text `Semua habit hari ini selesai...` agar ter-truncate jika di layar HP sempit.
     - Bump stylesheet query ke `/static/app.css?v=326`.
     - Bump fallback `window.__SW_VERSION` ke `taskflow-v394-mobile-hero-habit-pill-layout`.
  2. **`static/app.css`:**
     - Update `.dash-hero-habit-strip`: `display: flex; align-items: center; gap: 8px; margin-top: 12px; margin-bottom: 2px; flex-wrap: wrap; width: 100%; max-width: 100%; box-sizing: border-box;`.
     - Update `.dash-hero-habit-pill`: `min-width: 0; box-sizing: border-box; max-width: 100%;`.
     - Update `.dash-hero-habit-name`: `min-width: 0; flex: 1 1 auto; max-width: 280px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`.
     - Update `.dash-hero-habit-check`, `.dash-hero-habit-tag`, `.dash-hero-habit-cta`, `.dash-hero-habit-count`: tambahkan `flex-shrink: 0;`.
     - Di `@media (max-width: 640px)`: margin, padding, gap kompak dan `max-width: 180px` untuk `.dash-hero-habit-name`.
     - Di `@media (max-width: 420px)`: `max-width: 120px` untuk `.dash-hero-habit-name`, ukuran font cta 10.5px, count 11px.
     - STRICTLY NO `border-left` atau `borderLeft`.
  3. **Backend & Service Worker:**
     - `webapp.py`: bump `sw_cache` ke `taskflow-v394-mobile-hero-habit-pill-layout`.
     - `static/sw.js`: bump `CACHE` ke `taskflow-v394-mobile-hero-habit-pill-layout`.
     - `tests/test_version.py`: bump asersi ke `taskflow-v394-mobile-hero-habit-pill-layout` dan `v394`.
  4. **Pengujian:**
     - `tests/offline/dashboard_habit_checkin.test.js`:
       - Asersi layout order (dash-hero-top sebelum habit strip, habit strip sebelum dash-capture).
       - Asersi completed state class `.dash-hero-habit-name`.
       - Asersi CSS flex, min-width: 0, box-sizing, flex-shrink, dan responsive media queries (640px & 420px).
       - Asersi SW v394.
     - `tests/offline/note_toc.test.js` & `tests/offline/gtd_inbox_triage.test.js` & `tests/offline/dashboard_onboarding.test.js`: perbarui asersi `app.css?v=326`.
     - Sinkronisasi SW cache `taskflow-v394-mobile-hero-habit-pill-layout` di seluruh test suite offline.
  5. **Isolasi Ketat:**
     - Note editor di `static/index.html` dan `note_editor_trailing_block.test.js` terlindungi tanpa modifikasi.
     - Nol styling `border-left` atau `borderLeft`.
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
  - `node --test tests/offline/*.test.js` ➡️ **1047/1047 passed (0 failed)** across 8 suites.

## 🟢 Resolusi Discrepancy Local Router vs Backend untuk Task Focus, Subtasks, Notes, & Attachments — 2026-10-11 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI. SW v393 `taskflow-v393-offline-task-discrepancies-fix`.
- **Konteks & Masalah:**
  - Pengguna meminta pengecekan dan penyelesaian menyeluruh terhadap potensi perbedaan (discrepancy) lainnya antara local router offline (`static/offline/taskroutes.js`) dengan network backend FastAPI (`webapp.py`).
  - Hasil audit menemukan beberapa rute penting yang dipanggil oleh frontend tetapi belum didaftarkan di router lokal atau belum lengkap penanganan CID-nya:
    1. `POST /api/tasks/:id/focus`:
       - Dipanggil oleh `handleToggleFocus(taskId)` dan `handleReviewFocus(taskId)`.
       - Saat task berupa string CID (belum tersinkronisasi), ketiadaan rute ini meneruskan request ke backend `/api/tasks/{task_id: int}/focus` yang gagal dengan HTTP 422 (integer parsing error).
       - Di `taskrepo.js`: `updateTask` belum menyimpan field `patch.is_focused`.
    2. `GET /api/tasks/:id/subtasks`, `GET /api/tasks/:id/notes`, `GET /api/tasks/:id/attachments`:
       - Dipanggil secara masif di `TaskListView` (baris 6581) saat prefetch counts untuk semua task di tampilan list, dan di `TaskDetailModal` saat membuka detail task.
       - Ketiadaan rute-rute ini di `taskroutes.js` menyebabkan task baru/offline melempar 422 di server dan gagal memuat relasi lokal.
    3. `handleDoneAll` & `handleDoneParentOnly` di `static/index.html`:
       - Ditambahkan safety fallback untuk string CIDs jika request POST done melempar error.
- **Solusi & Implementasi:**
  1. **`static/offline/taskrepo.js`:**
     - Menambahkan penanganan `if (patch.is_focused != null) next.is_focused = patch.is_focused ? 1 : 0;` pada `updateTask`.
     - Mengekspor fungsi `getRaw` di `taskrepo.js` agar dapat digunakan router lokal.
  2. **`static/offline/taskroutes.js`:**
     - Mendaftarkan `POST /api/tasks/:id/focus`: menyelesaikan CID via `resolveCid`, membaca raw task record, melakukan toggle `0` <-> `1`, dan memanggil `TFrepo.updateTask(cid, { is_focused: nextVal }, opts())`.
     - Mendaftarkan `GET /api/tasks/:id/subtasks`: membaca store `subtasks` via index `task_cid` dan memfilter `!s.deleted`.
     - Mendaftarkan `GET /api/tasks/:id/notes`: membaca store `task_notes` via index `task_cid` dan memfilter `!n.deleted`.
     - Mendaftarkan `GET /api/tasks/:id/attachments`: membaca store `task_attachments` via index `task_cid`.
  3. **`static/index.html`:**
     - Pada `handleDoneAll` dan `handleDoneParentOnly`: menambahkan safety fallback `try { await api.post(...); } catch (postErr) { if (!isIntegerId) await api.put(..., { gtd_status: "done" }); else throw postErr; }`.
     - Bump fallback SW version ke `taskflow-v393-offline-task-discrepancies-fix`.
  4. **Backend & Service Worker:**
     - `webapp.py`: bump `sw_cache` ke `taskflow-v393-offline-task-discrepancies-fix`.
     - `static/sw.js`: bump `CACHE` ke `taskflow-v393-offline-task-discrepancies-fix`.
     - `tests/test_version.py`: bump asersi ke `taskflow-v393-offline-task-discrepancies-fix` dan `v393`.
  5. **Pengujian:**
     - `tests/offline/taskroutes.test.js`:
       - Asersi `hasRoute` untuk focus, subtasks, notes, attachments.
       - Unit test `POST /api/tasks/:id/focus` toggle `is_focused` antara 0 dan 1 untuk `server_id` dan `cid`.
       - Unit test `GET /api/tasks/:id/subtasks`, `notes`, `attachments` untuk `server_id` dan `cid` serta empty/unknown handling.
     - Sinkronisasi SW cache string di seluruh test suite offline (`tests/offline/`).
  6. **Isolasi Ketat:**
     - Tidak ada styling `borderLeft` atau `border-left`.
     - Kode note editor tetap utuh tanpa modifikasi yang tidak diinginkan.
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
  - `node --test tests/offline/*.test.js` ➡️ **1046/1046 passed (0 failed)** across 8 suites.

## 🟢 Fix GTD Wizard '<2m' (Done) String CID Task ID Support — 2026-10-11 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI. SW v392 `taskflow-v392-gtd-inbox-done-cid-fix`. Commit: `56e50bf`.
- **Konteks & Masalah:**
  - Ketika menelaah task di GTD Wizard dan memilih '<2m' (Done), muncul error:
    `Input should be a valid integer, unable to parse string as an integer`.
  - Root cause:
    1. Task baru/offline di IndexedDB memiliki format ID berupa string Client ID (`cid`, e.g. `c_172866...`).
    2. `static/offline/taskroutes.js` belum mendaftarkan rute `POST /api/tasks/:id/done` dan `GET /api/tasks/:id/child-tasks`.
    3. Akibatnya, request tidak diarahkan ke lokal IndexedDB melainkan dikirim ke server FastAPI (`webapp.py`), di mana path parameter `task_id` bertipe `int` (`task_id: int`). Pydantic menolak string CID dengan HTTP 422 error.
- **Solusi & Implementasi:**
  1. **`static/offline/taskroutes.js`:**
     - Mendaftarkan rute `POST /api/tasks/:id/done` dengan `resolveCid(params.id)` -> `TFrepo.updateTask(cid, { gtd_status: "done" }, opts())` (yang otomatis mengisi `completed_at: now`).
     - Mendaftarkan rute `GET /api/tasks/:id/child-tasks` dengan `resolveCid(params.id)` -> memfilter tugas anak dengan `parent_cid === cid` dan `!r.deleted`.
  2. **`static/index.html`:**
     - Memperbarui `handleDone(taskId)` dengan validasi `isIntegerId = /^\d+$/.test(String(taskId))`.
     - Melindungi pemanggilan `(children || []).filter(...)` agar tidak error saat children undefined/null.
     - Menambahkan fallback jika `api.post(/api/tasks/${taskId}/done)` gagal dan `!isIntegerId`, maka memanggil `api.put(/api/tasks/${taskId}, { gtd_status: "done" })`.
     - Bump fallback SW version ke `taskflow-v392-gtd-inbox-done-cid-fix`.
  3. **Backend & Service Worker:**
     - `webapp.py`: bump `sw_cache` ke `taskflow-v392-gtd-inbox-done-cid-fix`.
     - `static/sw.js`: bump `CACHE` ke `taskflow-v392-gtd-inbox-done-cid-fix`.
     - `tests/test_version.py`: bump asersi ke `taskflow-v392-gtd-inbox-done-cid-fix` dan `v392`.
  4. **Pengujian:**
     - Menambahkan unit test di `tests/offline/taskroutes.test.js` untuk resolusi CID & server_id pada `POST /api/tasks/:id/done` dan `GET /api/tasks/:id/child-tasks`.
     - Sinkronisasi SW cache string di seluruh test suite offline (`tests/offline/`).
  5. **Isolasi Ketat:**
     - Perubahan note editor (MilkdownEditor trailing block) tidak disentuh dan tidak di-stage.
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ OK (5/5 inline scripts).
  - `node --check static/sw.js` ➡️ OK.
  - `node --test tests/offline/taskroutes.test.js tests/offline/gtd_inbox_triage.test.js` ➡️ 26/26 passed (0 failed).
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ 2 passed (0 failed).
  - `node --test tests/offline/*.test.js` ➡️ 1044/1044 passed across 8 suites.

## 🟢 Trailing Empty Block di Note Editor (MilkdownEditor) — 2026-10-11 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI.
- **Konteks & Masalah:**
  - Sebelumnya, jika baris/blok terakhir catatan berisi teks atau elemen (tabel, heading, list, quote), tidak ada baris kosong di bawahnya.
  - Pengguna harus mengklik baris terakhir yang ada isinya, menempatkan kursor di akhir isi blok, lalu menekan Enter untuk mendapatkan baris baru.
  - Hal ini memakan waktu dan mengganggu alur penulisan catatan.
- **Solusi & Implementasi (Opsi A — Clean UX):**
  1. **ProseMirror Plugin `createTrailingEmptyBlockPlugin(MB)` di `static/index.html`:**
     - Menggunakan hook `appendTransaction` untuk mendeteksi perubahan dokumen (`docChanged`).
     - Jika node terakhir (`doc.lastChild`) bukan paragraph kosong (`lastNode.type === schema.nodes.paragraph && lastNode.content.size === 0`), secara otomatis menyisipkan `<p></p>` kosong di posisi akhir dokumen (`doc.content.size`).
     - Mengembalikan `null` jika dokumen sudah berakhir dengan paragraph kosong (mencegah duplikasi).
     - Menyediakan fallback aman `return [];` jika `MilkdownBundle` atau prerequisite tidak tersedia, dan chaining `.use(createTrailingEmptyBlockPlugin(MB) || [])`.
  2. **Verifikasi Initial Document:**
     - Pada inisialisasi editor (`.create().then(editor => { ... })`), dokumen awal langsung diperiksa dan disisipkan trailing empty paragraph jika belum ada.
  3. **Navigasi Klik Area Bawah:**
     - Pada `handleContainerClick` di `MilkdownEditor`: jika pengguna mengklik area kosong kontainer di bawah dokumen atau di bawah elemen anak terakhir (`e.clientY > lastRect.bottom`), kursor langsung diarahkan ke baris kosong terakhir (`TextSelection.near(doc.resolve(Math.max(0, doc.content.size - 1)))`) dan editor difokuskan (`view.focus()`).
  4. **Normalisasi Markdown Saat Simpan:**
     - Di listener `markdownUpdated`: membersihkan trailing newlines ekstra (mendukung LF `\n` dan Windows CRLF `\r\n`) menggunakan regex `replace(/[\r\n]+$/, '')` sebelum memanggil `onChange`.
  5. **Isolasi Penuh:**
     - Tidak ada intervensi ke Inbox, GTD status, tasklist, maupun task modals.
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --test tests/offline/note_editor_trailing_block.test.js` ➡️ **14/14 passed (0 failed)**.
  - `node --test tests/offline/*.test.js` ➡️ **1042/1042 passed (0 failed)** across 8 suites.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.

## 🟢 Dual-Mode GTD Inbox Triage System (Inline Quick Triage + Guided '⚡ Proses Inbox' Wizard) — 2026-10-11 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI. SW v391 `taskflow-v391-gtd-inbox-triage-wizard` & `app.css?v=325`. Commits: `ed389d1`, `41e6229`.
- **Konteks & Masalah:**
  - Sebelumnya di GTD Inbox (`page === "inbox"`), pengguna harus klik tiap task, buka modal, klik edit, ganti status GTD, dan simpan. Friksinya terlalu tinggi untuk alur GTD David Allen (aturan 2 menit: <2m kerjakan sekarang -> done, actionable -> next/waiting/someday).
- **Solusi & Implementasi:**
  1. **Inline Quick Triage Bar:**
     - Pada setiap baris tugas di tampilan Inbox (`TaskRow` dan `CompactRow`), ketika `isInbox && task.gtd_status === "inbox"`, dirender kontainer `.gtd-inline-triage` berisi 4 chip aksi cepat:
       - `✓ <2m`: Aturan 2 menit (langsung diselesaikan).
       - `⚡ Next`: Pindahkan ke Next Actions.
       - `⏳ Wait`: Pindahkan ke Waiting For.
       - `☁️ Someday`: Pindahkan ke Someday / Maybe.
     - Mengklik chip triage memicu `onUpdateGtdStatus` optimistik dan tidak membuka detail modal (`e.stopPropagation()`).
  2. **Guided '⚡ Proses Inbox' Wizard Modal (`GtdInboxWizardModal`):**
     - Tombol peluncur wizard `.gtd-launch-wizard-btn` di header Inbox (`TaskListView`): `⚡ Proses Inbox (N)`.
     - Modal telaah fokus 1-per-1 menampilkan detail tugas (judul, prioritas, project, konteks, deadline, deskripsi) dan pengingat prinsip 2 menit GTD.
     - 4 tombol keputusan GTD besar dan tombol `Lewati ⏩` dengan indeks looping/cycling yang aman.
     - Tampilan Inbox Zero ("🎉 Inbox Zero! Semua tugas telah ditelaah.") saat seluruh tugas selesai diproses.
     - Dukungan keyboard `Escape` untuk menutup modal.
  3. **Backend & Optimistic Updates (`App`):**
     - Handler `handleUpdateTaskGtd`: update state lokal secara optimistik, toast feedback visual, persist via `PUT /api/tasks/:id`, fallback offline ke `OfflineDB.queueAdd`, dan memancarkan event `taskUpdated`.
  4. **Strict Styling Constraint:**
     - Seluruh styling triage chip dan wizard modal TIDAK menggunakan `borderLeft` maupun `border-left`.
  5. **Bumps & Verifikasi:**
     - Stylesheet di-bump ke `app.css?v=325`.
     - Service Worker cache di-bump ke `taskflow-v391-gtd-inbox-triage-wizard`.
     - Backend API version di `webapp.py` & `tests/test_version.py` di-bump ke `v391`.
     - Unit test komprehensif baru di `tests/offline/gtd_inbox_triage.test.js` (7/7 passed) dan `tests/offline/note_editor_trailing_block.test.js` (13/13 passed).
     - Sinkronisasi versi cache SW di seluruh 8 test suites offline (1041/1041 passed).
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `node --test tests/offline/*.test.js` ➡️ **1041/1041 passed (0 failed)** across 8 suites.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
- **Review:**
  - Code Review: Approved with minor findings (trailing block plugin & wizard skip index).
  - Code Re-Review: Approved (commit `41e6229`, 0 findings).

## 🟢 Fix Judul Habit di Quick Habit Pill Dashboard & Center HUD Toast — 2026-10-11 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI. SW v390 `taskflow-v390-dashboard-habit-title-fix`.
- **Konteks & Masalah:**
  - Teks subjek / nama habit tidak muncul pada Quick Habit Pill di Hero Dashboard (hanya muncul `◯ HABIT • Selesai? ⚡`).
  - Root cause: Objek habit dari endpoint `/api/habits/today` dan database menggunakan properti `title` (`nextHabit.title`), bukan `nextHabit.name`.
- **Solusi & Perubahan:**
  - `static/index.html`:
    - Memperbarui title, aria-label, dan label teks `.dash-hero-habit-name` menjadi `nextHabit.title || nextHabit.name || "Habit"`.
    - Memperbarui Center HUD Toast pada `handleCheckinHabit` menjadi: `title: \`Great, one activity done! 🎉 (${habit.title || habit.name || "Habit"})\``.
    - Bump fallback SW version ke `taskflow-v390-dashboard-habit-title-fix`.
  - `webapp.py` & `static/sw.js`:
    - Bump SW cache ke `taskflow-v390-dashboard-habit-title-fix`.
  - `tests/test_version.py`:
    - Update asersi ke `taskflow-v390-dashboard-habit-title-fix` dan `v390`.
  - `tests/offline/dashboard_habit_checkin.test.js`:
    - Menambahkan asersi habit title fallback pada `.dash-hero-habit-name`, title, aria-label, dan Center HUD Toast.
    - Menambahkan unit test SW cache `taskflow-v390-dashboard-habit-title-fix`.
  - Sinkronisasi SW cache `taskflow-v390-dashboard-habit-title-fix` di seluruh file test offline (`tests/offline/`).
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `node --test tests/offline/*.test.js` ➡️ **1021/1021 passed (0 failed)** across 8 suites.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.

## 🟢 Quick Habit Check-in Pill di Hero Dashboard & Center HUD Toast — 2026-10-11 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI & DEPLOYED (Pushed ke `origin/main`). SW v389 `taskflow-v389-dashboard-habit-checkin` & `app.css?v=324`. Commits: `c5428d3`, `a463b09`. Deploy pipeline VPS aktif otomatis.
- **Konteks & Solusi:**
  - Pengguna ingin dapat melakukan check-in habit langsung dari Dashboard. Dalam sesi brainstorming (Bounded task), pengguna memilih Opsi A: Quick Habit Pill di Hero section.
  - Menambahkan pill badge interaktif `.dash-hero-habit-strip` di bawah ringkasan hero (`.dash-hero-text`).
  - Menampilkan habit aktif berikutnya yang belum selesai hari ini yang disesuaikan secara cerdas dengan fase waktu lokal saat ini (`pagi`, `siang`, `malam`).
  - Mengklik habit pill langsung memicu check-in optimistik, mengirim `POST /api/habits/:id/checkin` (dengan fallback antrean offline `OfflineDB.queueAdd`), memancarkan event `habitSaved`, dan memunculkan **Center HUD Toast** bergaya pill badge di tengah layar (`"Great, one activity done! 🎉"`) dengan ikon aktivitas (`activity`) dan fade halus selama 2.8 detik.
  - Ketika seluruh habit hari ini rampung, pill berubah menjadi status sukses `"Semua habit hari ini selesai (N/N) 🎉"` yang dapat diklik untuk menuju ke halaman Habits. Jika pengguna belum memiliki habit sama sekali (0 habit), pill tidak dirender (bersih tanpa elemen kosong).
  - Sesuai aturan wajib: TIDAK ADA garis tepi berwarna di sisi kiri (`borderLeft` dilarang keras).
- **Perubahan yang Selesai:**
  - `static/app.css`:
    - Menambahkan styling `.dash-hero-habit-strip`, `.dash-hero-habit-pill` (dengan hover & completed state), `.dash-hero-habit-check` (dengan status done), tag, nama, count, dan cta.
    - Menambahkan styling `.center-hud-icon-habit` untuk tema terang dan gelap dengan aksen amber/warm activity.
  - `static/index.html`:
    - Menambahkan state `habits` dan data fetching `/api/habits/today` dengan offline caching di `Dashboard`.
    - Menambahkan event listener `habitSaved` untuk sinkronisasi reaktif multi-komponen.
    - Menambahkan handler `handleCheckinHabit` dengan update optimistik dan Center HUD Toast `type: "habit"`.
    - Merender `.dash-hero-habit-strip` di Hero section di bawah `dash-hero-summary`.
    - Memperbarui Center HUD Toast dengan ikon `activity` saat `type === "habit"`.
    - Memperbarui link stylesheet ke `/static/app.css?v=324`.
    - Memperbarui versi Service Worker fallback ke `taskflow-v389-dashboard-habit-checkin`.
  - `webapp.py` & `static/sw.js`: Bump cache SW ke `taskflow-v389-dashboard-habit-checkin`.
  - Tests:
    - Unit test baru di `tests/offline/dashboard_habit_checkin.test.js`: memvalidasi selector CSS, ketiadaan `border-left`, integrasi fetching, dan Center HUD Toast habit di Dashboard.
    - Asersi stylesheet `app.css?v=324` di `tests/offline/note_toc.test.js`.
    - Asersi backend `tests/test_version.py` di-bump ke `v389`.
    - Sinkronisasi versi cache SW ke `v389` di seluruh 8 suite test offline.
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `node --test tests/offline/*.test.js` ➡️ **1020/1020 passed (0 failed)** across 8 suites.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.

## 🟢 Fokus Task & Pomodoro dari Dashboard — 2026-10-11 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI. SW v388 `taskflow-v388-dashboard-pomodoro-focus` & `app.css?v=323`. Commit: `c175900`, `70cffd1`.
- **Konteks & Solusi:**
  - Pengguna ingin dapat memfokuskan task langsung dari kartu "Prioritas Hari Ini" di Dashboard dan langsung memicu Pomodoro di widget topbar (`TopBarPomodoroChip`).
  - Menambahkan tombol fokus `.dash-focus-btn` dengan ikon target (`<Icon name="target" size={13} />`) tepat di samping checklist `TodayRow`.
  - Callback `handleStartFocus` di level `App` memulai Pomodoro jika belum berjalan dan menandai task sebagai `focusTask`. Jika task yang sama diklik kembali, fokus dilepas dan timer dijeda.
  - Saat task selesai (`handleDone`), jika task tersebut sedang fokus maka fokus dilepas dan timer dijeda.
  - Sesuai aturan wajib: TIDAK ADA garis tepi berwarna di sisi kiri (`borderLeft` dilarang).
- **Perubahan yang Selesai:**
  - `static/app.css`: Menambahkan `.dash-focus-btn`, `.dash-focus-btn:hover`, dan `.dash-focus-btn.is-active` dengan dukungan dark mode tanpa `border-left`.
  - `static/index.html`:
    - Hook `usePomodoro`: fungsi `start(explicitTask = null)` menerima task eksplisit agar timer langsung dapat dimulai saat fokus berpindah sebelum render cycle React selesai.
    - Callback `handleStartFocus` di `App` dengan `timer.start(task)` dan notifikasi toast informatif.
    - Penanganan `handleDone`, `handleDoneParentOnly`, dan `handleDoneAll` yang melepas fokus dan menjeda timer bila task/subtask yang sedang fokus diselesaikan.
    - Oper props `focusTask`, `timer`, `onStartFocus` ke `Dashboard`.
    - `TodayRow` di `Dashboard` merender tombol fokus `.dash-focus-btn` sebelum `dash-check` saat `!isDone && onStartFocus`.
    - Update stylesheet link ke `app.css?v=323`.
    - Update versi Service Worker ke `taskflow-v388-dashboard-pomodoro-focus`.
  - `webapp.py` & `static/sw.js`: Bump cache SW ke `taskflow-v388-dashboard-pomodoro-focus`.
  - Tests:
    - Unit test baru di `tests/offline/focus_workstation.test.js`:
      - Memvalidasi keberadaan CSS `.dash-focus-btn` dan rendering di `Dashboard` `TodayRow`.
      - Memvalidasi `usePomodoro` `start(explicitTask)` menerima task eksplisit dan menyalakan timer saat closure `focusTask` awalnya null.
      - Memvalidasi `handleDoneParentOnly` dan `handleDoneAll` membersihkan fokus.
    - Asersi stylesheet `app.css?v=323` di `tests/offline/note_toc.test.js`.
    - Asersi backend `tests/test_version.py` di-bump ke `v388`.
    - Sinkronisasi versi cache SW ke `v388` di seluruh 8 suite test offline.
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `node --test tests/offline/*.test.js` ➡️ **1017/1017 passed (0 failed)** across 8 suites.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.

## 🟢 Progressive Disclosure Dashboard & Onboarding Task Prefill — 2026-10-11 (Antigravity/Gemini) — SELESAI & DEPLOYED (Merged ke `main`)
- **Status:** 🟢 SELESAI, MERGED ke `main` & PUSHED ke GitHub (`origin/main`). SW v387 `taskflow-v387-quick-capture-onboarding-prefill` & `app.css?v=322`. Deploy pipeline VPS aktif otomatis.
- **Spec & Plan:**
  - `docs/superpowers/specs/2026-10-11-dashboard-progressive-onboarding-design.md` (commit `6acd880`)
  - `docs/superpowers/plans/2026-10-11-dashboard-progressive-onboarding.md` (commit `e950ef6`)
- **Konteks & Masalah:**
  - Pengguna baru tanpa tugas/data dihadapkan pada ~17 kontainer kosong yang mengintimidasi (5 KPI angka 0, grafik analitik kosong, 4 kuadran Eisenhower kosong, 4 kuadran GTD kosong).
  - Masalah UX: `parseQuickCapture` memerlukan awalan `tugas/task/todo` agar teks menjadi Task dan bukan Note. Pengguna baru yang mengetik biasa tanpa awalan akan menghasilkan Note, sehingga `tasks.length` tetap 0 dan langkah 1 onboarding tidak tercentang.
  - Solusi yang diimplementasikan:
    1. Progressive disclosure menyembunyikan 17 kontainer kosong saat `tasks.length === 0`.
    2. Kartu "Mulai Langkah Pertama" (`DashOnboardingCard`) dengan tombol *"✍️ Buat Tugas"* yang secara otomatis mengisikan teks awalan `"Tugas: "` ke input capture bar, memposisikan kursor di akhir teks, dan scroll halus ke tengah layar.
    3. Teks instruksi Langkah 1 diperjelas: *"Awali dengan kata tugas (contoh: Tugas: beli buku besok) lalu tekan Enter, atau klik tombol di samping."*
    4. Placeholder baris input capture adaptif: saat `!hasTasks` menampilkan *"Awali 'tugas: ...' untuk tugas, atau tulis apa saja untuk catatan..."*.
    5. Saat ada tugas (`tasks.length > 0`), KPI dan matriks otomatis muncul dan kartu onboarding berganti ke kartu Prioritas Hari Ini. Seksi Analitik baru muncul jika ada tugas selesai (`hasCompletedTasks`).
    6. Sesuai aturan wajib: TIDAK ADA garis tepi berwarna di sisi kiri (`borderLeft` dilarang).
- **Perubahan yang Selesai:**
  - `static/app.css`:
    - Menambahkan CSS `.dash-onboarding-card`, `.onboarding-head`, `.onboarding-step-item`, badge, dan tombol CTA.
    - Menambahkan fallback CSS variables untuk dark mode (`[data-theme="dark"]`).
    - Tanpa `border-left` berwarna.
  - `static/index.html`:
    - Greeting teks hangat: *"Selamat datang di Alurik! Mari mulai dengan mencatat tugas atau ide pertamamu."* saat `tasks.length === 0`.
    - Komponen modular `DashOnboardingCard` dengan instruksi eksplisit dan tombol prefill `"Tugas: "`.
    - Placeholder adaptif pada `.dash-capture input`.
    - Conditional rendering untuk `dash-kpis`, `dash-main` (kartu onboarding vs prioritas), `eisenhower-grid`, `gtd-grid`, dan `charts-grid` (Analitik).
    - Memperbarui stylesheet link ke `/static/app.css?v=322` dan SW fallback ke `taskflow-v387-quick-capture-onboarding-prefill`.
  - `webapp.py` & `static/sw.js`:
    - Bump cache SW ke `taskflow-v387-quick-capture-onboarding-prefill`.
  - Tests:
    - Unit test baru `tests/offline/dashboard_onboarding.test.js` dengan pengujian prefill, placeholder adaptif, dan instruksi baru.
    - `tests/test_version.py` di-bump ke `v387`.
    - Sinkronisasi versi cache SW ke `v387` di seluruh 8 suite test offline.
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `node --test tests/offline/*.test.js` ➡️ **1014/1014 passed (0 failed)** across 8 suites.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
- **Review:** Task 1, 2, 3 Review (Approved), Bounded Task Review (Approved), Whole-Branch Review (Ready to merge: Yes).

## 🟢 Redesain Split-View Kalender (Layar Lebar >= 1200px) & Sidebar Agenda — 2026-10-11 (Antigravity/Gemini) — SELESAI & DEPLOYED (Merged ke `main`)
- **Status:** 🟢 SELESAI, MERGED ke `main` & PUSHED ke GitHub (`origin/main`). SW v385 `taskflow-v385-calendar-split-view-redesign` & `app.css?v=321`. Deploy pipeline VPS aktif otomatis.
- **Spec & Plan:**
  - `docs/superpowers/specs/2026-10-11-calendar-split-view-redesign.md`
  - `docs/superpowers/plans/2026-10-11-calendar-split-view-redesign.md`
- **Konteks & Masalah:**
  - Pada layar lebar (>= 1200px), tampilan kalender bulanan terasa terlalu lapang/terentang dan cell bulanan terbatas tingginya sehingga task chip terpotong cepat (`+N lagi`).
  - Pengguna menginginkan redesain split-view: grid kalender bulanan di sebelah kiri (dengan tinggi cell desktop ditingkatkan ke 105px dan chip ditampilkan hingga 3 task sebelum `+N lagi`), serta sidebar agenda interaktif yang sticky di sebelah kanan (lebar ~340px) pada layar >= 1200px.
  - Sidebar agenda menampilkan tanggal aktif (default ke hari ini atau tgl 1), tombol "+ Tugas", daftar tugas pada hari tersebut lengkap dengan checkbox penyelesaian, detail hari libur nasional, serta rangkuman hari libur bulan berjalan.
  - Pada layar lebar, klik tanggal langsung memperbarui agenda sidebar tanpa modal overlay yang menghalangi. Di layar < 1200px, modal popup dan daftar tanggal tetap berfungsi seperti semula.
  - Sesuai aturan wajib pengguna: TIDAK ADA garis tepi berwarna di sisi kiri task (`borderLeft` styling dilarang keras).
- **Perubahan yang Selesai:**
  - `static/app.css`:
    - Menambahkan `.cal-split-layout` (2-kolom grid `minmax(0, 1fr) 340px` dengan `gap: 20px; align-items: start;` pada `@media (min-width: 1200px)`).
    - Menambahkan `.cal-split-sidebar` (`position: sticky; top: 80px;`, tersembunyi `display: none` di bawah 1200px).
    - Menambahkan styling lengkap agenda header, badge, filter, list item dengan checkbox custom (`.cal-agenda-checkbox`), empty state, dan kartu hari libur nasional.
  - `static/index.html`:
    - Mengintegrasikan split layout di `CalendarView`.
    - Meningkatkan tinggi desktop cell kalender menjadi `minHeight: 105, height: 105` dan menampilkan hingga 3 chip sebelum `+N lagi`.
    - Menambahkan parameter `onDone` pada `TaskListItems` dan menambahkan checkbox toggle tugas.
    - Pada klik tanggal di layar lebar (`window.innerWidth >= 1200`), state `selectedDay` diperbarui dan modal overlay disembunyikan agar navigasi sidebar mulus.
    - Menambahkan default `selectedDay` saat pertama kali render (hari ini jika di bulan aktif, atau tanggal 1 bulan tersebut).
    - Memperbarui link stylesheet ke `/static/app.css?v=321`.
    - Memperbarui fallback dan `window.__SW_VERSION` ke `taskflow-v385-calendar-split-view-redesign`.
  - `webapp.py`:
    - Memperbarui `sw_cache = "taskflow-v385-calendar-split-view-redesign"`.
  - `static/sw.js`:
    - Bump cache Service Worker ke `taskflow-v385-calendar-split-view-redesign`.
  - `tests/test_version.py`:
    - Memperbarui asersi versi backend ke `v385`.
  - `tests/offline/note_toc.test.js`:
    - Memperbarui asersi stylesheet ke `app.css?v=321`.
  - Sinkronisasi versi cache SW ke `taskflow-v385-calendar-split-view-redesign` di 8 test suites offline.
  - `tests/offline/calendar_week_view.test.js`:
    - Menambahkan test suite offline untuk memvalidasi `cal-split-layout`, sticky sidebar, desktop cell 105px, dan rendering 3 chips.
- **Verifikasi Pengujian:**
  - `node --check static/sw.js` ➡️ **OK**.
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --test tests/offline/*.test.js` ➡️ **1010/1010 passed (0 failed)** across 8 suites.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
- **Commit:** `466d7db feat(calendar): split-view layout on wide screens with agenda sidebar and bump SW v385`.

## 🟢 Implementasi Dashboard Full-Width Fluid (Layar Lebar) — 2026-10-11 (Antigravity/Gemini) — SELESAI & DEPLOYED (Merged ke `main`)
- **Status Integrasi:** Merged ke `main` (commit `459db81`), dipush ke GitHub (`origin/main`). Feature branch `feat/dashboard-full-width-fluid` telah dihapus.
- **Spec & Plan:**
  - `docs/superpowers/specs/2026-10-11-dashboard-full-width-fluid-design.md`
  - `docs/superpowers/plans/2026-10-11-dashboard-full-width-fluid.md`
- **Konteks & Masalah Selesai:** Di layar laptop/monitor lebar, `.dash` yang sebelumnya dibatasi `max-width: 1320px;` kini telah diubah menjadi `width: 100%; max-width: 100%;` di `static/app.css:2301`.
- **Perubahan yang Selesai:**
  - `static/app.css`: `.dash` diubah ke `width: 100%; max-width: 100%;`.
  - `static/index.html`: stylesheet di-bump ke `/static/app.css?v=320`, fallback dan `window.__SW_VERSION` diperbarui ke `taskflow-v384-dashboard-full-width-fluid`.
  - `webapp.py`: `sw_cache = "taskflow-v384-dashboard-full-width-fluid"`.
  - `static/sw.js`: `const CACHE = "taskflow-v384-dashboard-full-width-fluid";`.
  - `tests/test_version.py`: asersi versi backend diperbarui ke `v384`.
  - `tests/offline/app_update_notifier.test.js`: ditambahkan unit test 10 untuk asersi tata letak `.dash` (width: 100%, max-width: 100%, tanpa 1320px).
  - Sinkronisasi versi cache SW ke `taskflow-v384-dashboard-full-width-fluid` di semua test offline terkait (8 file).
  - Tracking docs: spec dan implement plan dicatat di commit `b20cecf`.
- **Verifikasi Pengujian:**
  - `node --check static/sw.js` ➡️ **OK**.
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --test tests/offline/*.test.js` ➡️ **1008/1008 passed (0 failed)** across 8 suites.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
  - `venv/bin/python -m pytest tests/` ➡️ **134 passed, 1 failed** (1 failure adalah kegagalan pre-existing upstream pada commit `413f9c0`).
- **Review:** Task 1 Review Approved (Spec ✅, Quality Approved); Whole-Branch Review Approved (Ready to merge: Yes).
- **Status:** 🟢 SELESAI, MERGED ke `main` & PUSHED ke GitHub (`origin/main`). SW v384 `taskflow-v384-dashboard-full-width-fluid` & `app.css?v=320`. Deploy pipeline VPS aktif otomatis.


## 🟢 Fitur Notifikasi & Deteksi Pembaruan Aplikasi (PWA & Web) — 2026-10-11 (Antigravity/Gemini) — SELESAI
- **Task:** Implementasi notifikasi dan deteksi pembaruan aplikasi Alurik (PWA & Web).
- **Komponen & Perubahan:**
  1. `webapp.py`:
     - Menambahkan header `Cache-Control` (`no-cache, no-store, must-revalidate, max-age=0`), `Pragma: no-cache`, `Expires: 0` pada endpoint `GET /sw.js`.
     - Menambahkan endpoint publik `GET /api/version` yang mengembalikan info versi JSON (`app_version: "4.0.0"`, `sw_version: "taskflow-v383-app-update-notifier"`, `cache_name`, `timestamp`) dengan header `Cache-Control: no-cache, no-store, must-revalidate`.
  2. `static/sw.js`:
     - Bump cache Service Worker ke `taskflow-v383-app-update-notifier`.
     - Update lifecycle: pada event `install`, jika `!self.registration.active` panggil `self.skipWaiting()`; jika sudah ada SW aktif biarkan masuk state `waiting` sampai pengguna memilih perbarui.
     - Event listener `message`: menangani string `"SKIP_WAITING"` dan objek `{ type: "SKIP_WAITING" }`.
     - Route `GET /api/version` diatur sebagai `NETWORK-ONLY` agar bebas dari stale cache.
  3. `static/index.html` & `static/app.css`:
     - Komponen melayang `UpdateNotificationBanner` (ikon 🚀, pesan update, tombol "🔄 Perbarui Sekarang", dan tombol tutup "✕") dengan styling `var(--bg-card)` dan animasi `slideUpFade`.
     - Handler `applyAppUpdate`: mengirim pesan `SKIP_WAITING` ke waiting worker dan reload halaman via event `controllerchange`.
     - Registrasi Service Worker & deteksi: melacak event `updatefound` dan worker state `installed` saat ada worker waiting.
     - Global function `window.checkForAppUpdate(options)`: memanggil `reg.update()`, cek `/api/version`, dan menampilkan toast responsif saat dipanggil manual.
     - Event listener `visibilitychange` (cek update otomatis saat tab dibuka) & auto-check periodik via `setInterval` tiap 30 menit.
     - Halaman Pengaturan (`SettingsPage`): kartu info versi aplikasi dan tombol "🔍 Cek Pembaruan" (`window.checkForAppUpdate({ manual: true })`).
  4. Pengujian & Sinkronisasi:
     - 7 file test offline disinkronkan ke cache `taskflow-v383-app-update-notifier`.
     - Unit test backend baru `tests/test_version.py` untuk endpoint `/api/version` dan header `/sw.js`.
     - Unit test offline baru `tests/offline/app_update_notifier.test.js` (9/9 pass).
- **Verifikasi:**
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `node --test tests/offline/app_update_notifier.test.js` ➡️ **9/9 passed**.
  - `node --test tests/offline/*.test.js` ➡️ **1007/1007 passed (0 failed)** across 8 suites.
- **Status:** 🟢 SELESAI (SW v383 `taskflow-v383-app-update-notifier`).

## 🟢 Sinkronisasi Repo Lokal dari GitHub — 2026-10-11 (Antigravity/Gemini) — SELESAI
- **Task:** Sinkronisasi repo lokal yang tertinggal dari GitHub (`origin/main`).
- **Status Sinkronisasi:**
  - Branch lokal `main` telah di-fast-forward dari `d57a1a8` ke `2303019` (`origin/main` / `origin/HEAD`), menarik 106 file terubah (+28503, -4615).
  - Production vendor bundle `draw-app` berhasil di-rebuild via `npm --prefix draw-app run build` (`static/vendor/tldraw/assets/index.js`).
- **Verifikasi:**
  - JS offline test suite (`node --test tests/offline/*.test.js`): **998/998 PASS (0 FAIL)** across all 8 suites.
  - Backend test suite (`venv/bin/python -m pytest tests/`): 132 passed, 1 failed (`test_delete_is_atomic_when_snapshot_fails` di `tests/test_note_trash.py` bawaan dari commit upstream `413f9c0`).

## 🟢 Perbaikan Pengiriman Chat & Self-Healing Migration Skema Chat — 2026-10-08 (Claude) — SELESAI
- **Masalah:** Pengguna melaporkan pesan chat tidak bisa terkirim (stuck di status "🕐 mengirim…" pada obrolan grup / shared list atau gagal kirim).
- **Root Cause:**
  1. **Missing Table & Columns di Database:** Pada endpoint `POST /api/lists/{id}/messages` dan `GET /api/lists/{id}/messages`, query melakukan `LEFT JOIN workspace_files wf ON wf.id = m.file_id` dan `INSERT INTO messages` menyertakan kolom `file_id`, `note_id`, `client_id`. Namun tabel `workspace_files` dan kolom `file_id` sebelumnya hanya dibuat via `migrate_db()` saat startup. Saat kode di-deploy via CI/CD tanpa restart proses webapp di VPS, tabel `workspace_files` belum terbuat di SQLite (`sqlite3.OperationalError: no such table: workspace_files`). Akibatnya, backend melempar error 500, background sync `syncpush.js` gagal push (`server_error_500`), dan pesan tetap berstatus `pending: 1` ("🕐 mengirim…") tanpa terkirim ke server.
  2. **CI/CD Deploy Script:** `.github/workflows/deploy.yml` sebelumnya tidak menjalankan `migrate_db()` setelah pull kode baru.
  3. **Repository Init DB:** `TaskRepository._init_db()` di `repository.py` belum menyertakan pembuatan tabel `workspace_files`, `dm_conversations`, `dm_messages`, `dm_reads`, `dm_blocks` serta migrasi kolom `file_id`, `note_id`, `client_id` pada tabel `messages`.
  4. **Payload Validation:** Pada `ChatInputBar`, `task_id`, `note_id`, `file_id`, dan `reply_to_id` berpotensi dikirim sebagai string client ID (cid) bukannya integer server ID, yang dapat memicu error 422 Unprocessable Entity dari Pydantic.
- **Solusi & Implementasi:**
  1. `webapp.py`:
     - Menambahkan fungsi self-healing `_ensure_workspace_files_table(conn)`, `_ensure_chat_schema(conn)`, dan `_ensure_dm_schema(conn)`.
     - Memanggil `_ensure_chat_schema(conn)` di `get_messages` dan `post_message`.
     - Memanggil `_ensure_workspace_files_table(conn)` di `list_workspace_files`, `upload_workspace_file`, `download_workspace_file`, `delete_workspace_file`, serta attachment task.
     - Memanggil `_ensure_dm_schema(conn)` di semua endpoint DM (`_dm_get_conv_or_404`, `dm_contacts`, `dm_list_conversations`, `dm_create_conversation`).
  2. `repository.py`:
     - Memperbarui skema `messages` di `_init_db()` agar mencakup `note_id`, `file_id`, `client_id`, `reply_to_id`.
     - Menambahkan pembuatan tabel `workspace_files` dan seluruh tabel DM di `_init_db()`.
     - Menambahkan migrasi kolom `file_id`, `note_id`, `client_id`, `reply_to_id` jika belum ada di tabel `messages`.
  3. `static/index.html` & `static/offline/syncpush.js`:
     - Memastikan `task_id`, `note_id`, `file_id`, dan `reply_to_id` hanya dikirim sebagai integer murni (atau `null`), mencegah error 422 Pydantic.
     - Mendaftarkan `setCurrentUser` untuk chat, note, dan mindmap saat `handleLogin`.
  4. `.github/workflows/deploy.yml`:
     - Menambahkan eksekusi `venv/bin/python -c "import webapp; webapp.migrate_db()"` pada pipeline deploy VPS.
  5. `static/sw.js` & Tests:
     - Bump cache Service Worker ke `taskflow-v382-chat-send-self-healing`.
     - Menambahkan unit test self-healing di `tests/test_chat_self_healing.py`.
     - Sinkronisasi versi cache di 7 file test offline.
- **Status:** 🟢 SELESAI (SW v382 `taskflow-v382-chat-send-self-healing`).

## 🟢 Pengerasan Ketahanan Hapus Catatan & Bulletproof Trash Snapshot — 2026-10-08 (Claude) — SELESAI
- **Masalah:** `DELETE /api/scratchpad/:id` sebelumnya mengembalikan HTTP 500 saat menghapus catatan (misal note id 228), sehingga catatan gagal dihapus dan tidak masuk ke Sampah.
- **Root Cause:**
  1. Pada `delete_scratchpad` di `webapp.py`, jika `row["user_id"]` adalah `None` atau tidak sesuai tipe, `row["user_id"] != uid` menolak atau saat `_snapshot_note_to_trash` mencoba `INSERT INTO trashed_notes`, jika `note.get("user_id")` `None` atau FK constraint memicu IntegrityError, query melempar 500 dan transaksi SQLite rollback.
  2. Pada `delete_scratchpad`, trigger FTS5 `trg_scratchpad_notes_ad` pada `scratchpad_notes` dapat memicu `IntegrityError` / `OperationalError` jika FTS external-content out-of-sync.
  3. Pada `list_trashed_notes`, `WHERE user_id = ? OR user_id = ? OR user_id IS NULL OR user_id = ''` memastikan seluruh catatan sampah terbaca tanpa terlewat.
- **Solusi & Implementasi:**
  1. `webapp.py`:
     - Di `_snapshot_note_to_trash`, penentuan `note_uid` dengan fallback user ID aktif/admin serta perlindungan `PRAGMA foreign_keys=OFF` fallback jika tabel lama memiliki FK constraint ketat.
     - Di `delete_scratchpad`, guard `if row["user_id"] is not None and str(row["user_id"]) != str(uid)` serta safe try-except pada snapshot dan penghapusan relasi.
     - Penanganan `sqlite3.IntegrityError` pada trigger FTS5: jika trigger delete FTS5 gagal karena sync mismatch, trigger di-drop sementara lalu dibuat ulang secara otomatis.
     - Di `list_trashed_notes`, query membaca `WHERE user_id = ? OR user_id = ? OR user_id IS NULL OR user_id = ''` untuk menjamin catatan sampah selalu muncul.
  2. `static/index.html`:
     - Guard query attachments `api.get(/api/scratchpad/${note.id}/attachments)` dengan regex integer `!note?.id || !/^\d+$/.test(String(note.id))` untuk mencegah error 422 saat note berstatus cid lokal.
  3. `static/sw.js` & Tests:
     - Bump cache Service Worker ke `taskflow-v381-notes-trash-bulletproof`.
     - Sinkronisasi asersi versi cache di 7 file test offline.
- **Verifikasi:**
  - `node --check static/sw.js` ➡️ **OK**.
  - `node --test tests/offline/note_trash_sync.test.js tests/offline/notetrash.test.js tests/offline/note_trash_routing.test.js` ➡️ **31/31 pass (0 fail)**.
  - Synchronized offline tests ➡️ **100/100 pass (0 fail)** across test suites.
- **Status:** 🟢 SELESAI (SW v381 `taskflow-v381-notes-trash-bulletproof`).

## 🟢 Perbaikan Note Trash & Self-Healing Migration Tabel Sampah — 2026-10-07 (Claude) — SELESAI
- **Masalah:** Tombol Sampah (Trash) di halaman catatan tidak berfungsi dan daftar sampah selalu kosong meskipun pengguna telah menghapus catatan.
- **Root Cause:**
  1. **Backend / Database Migration:** Tabel `trashed_notes` sebelumnya hanya dibuat via `migrate_db()` saat startup uvicorn. Ketika kode di-deploy via CI/CD tanpa restart proses VPS, tabel `trashed_notes` belum ada di database SQLite. Akibatnya, `DELETE /api/scratchpad/{id}` melempar error 500 (`no such table: trashed_notes`) saat mencoba snapshot, sehingga catatan tidak tersimpan ke Sampah dan `GET /api/scratchpad/trash` mengembalikan error / kosong.
  2. **Offline Syncpush:** Pada `opNoteDelete` di `syncpush.js`, jika pemetaan di IndexedDB `_idmap` hilang/kosong, `TFidmap.serverIdOf(op.cid)` bernilai `undefined`, menyebabkan penghapusan hanya diproses di lokal tanpa mengirim `DELETE /api/scratchpad/{sid}` ke backend.
  3. **UI NoteModal:** Tombol hapus di `NoteModal` tidak memanggil `onClose()`, membiarkan modal tetap terbuka setelah dihapus.
- **Solusi & Implementasi:**
  1. `webapp.py`:
     - Menambahkan fungsi self-healing `_ensure_trashed_notes_table(conn)` yang dipanggil otomatis saat snapshot note, purge expired, list trash, restore, dan delete scratchpad. Tabel `trashed_notes` otomatis terbuat seketika pada request pertama tanpa perlu restart service manual di VPS.
     - Menambahkan pengujian `test_trashed_notes_lazy_self_healing_when_table_dropped` di `tests/test_note_trash.py`.
  2. `static/offline/syncpush.js`:
     - Memperbarui `opNoteDelete` agar melakukan fallback ke `rec.server_id` jika `_idmap` tidak memiliki record, memastikan request `DELETE` tetap terkirim ke server.
     - Menambahkan unit test di `tests/offline/note_trash_sync.test.js`.
  3. `static/index.html`:
     - Menambahkan pemanggilan `onClose()` saat konfirmasi hapus di `NoteModal`.
  4. `static/sw.js` & Tests:
     - Bump cache Service Worker ke `taskflow-v379-notes-trash-self-heal`.
     - Sinkronisasi asersi versi cache di 7 file test offline.
- **Verifikasi:**
  - `node --check static/sw.js` ➡️ **OK**.
  - `node --test tests/offline/note_trash_sync.test.js tests/offline/notetrash.test.js tests/offline/note_trash_routing.test.js` ➡️ **31/31 pass (0 fail)**.
  - Full synchronized offline test suite ➡️ **100/100 pass (0 fail)**.
- **Status:** 🟢 SELESAI (SW v379 `taskflow-v379-notes-trash-self-heal`).

## 🟢 Dukungan Multiline & Preservasi Newline pada Bubble Chat — 2026-10-07 (Claude) — SELESAI
- **Kebutuhan Pengguna:**
  1. Input chat yang memiliki baris baru (*newline* via `Shift + Enter`) sebelumnya hanya terlihat 1 baris di textarea dan menutupi teks saat ada lampiran.
  2. Ketika pesan chat dengan baris baru terkirim, gelembung pesan (`.chat-bubble`) sebelumnya tidak merender baris baru (semua teks menyatu dalam 1 paragraf mengalir).
- **Solusi & Implementasi:**
  1. `static/app.css`:
     - Menambahkan `white-space: pre-wrap; word-break: break-word;` pada `.chat-bubble` sehingga karakter baris baru (`\n`) ter-render sebagai baris baru sejati tanpa merusak wrapping kata-kata panjang.
     - Menambahkan class `.chat-attach-preview-banner` di atas input bar.
     - Bump stylesheet query ke `app.css?v=319`.
  2. `static/index.html`:
     - Menambahkan handler `autoResizeTextarea` pada `ChatInputBar` dan `DmInputBar`: saat ada baris baru, tinggi textarea otomatis membesar minimal 5 baris (~115px) hingga maks 125px (scrollable).
     - Memindahkan banner lampiran berkas/task/note (`.chat-attach-preview-banner`) berada bersih di atas textarea (bukan absolute overlay yang menutupi area ketik).
  3. `static/sw.js` & Tests:
     - Bump cache Service Worker ke `taskflow-v378-chat-bubble-newline-pre-wrap`.
     - Menambahkan uji `ChatInputBar renders attachment preview banner above input text and supports multiline auto-resize` di `tests/offline/workspace_files_chat.test.js`.
     - Menambahkan uji `.chat-bubble should have white-space: pre-wrap and word-break: break-word` di `tests/offline/chat_page_layout.test.js`.
     - Sinkronisasi asersi versi cache dan stylesheet di 9 test offline.
- **Verifikasi:**
  - `node scratch/check_inline.js static/index.html` ➡️ **5/5 scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - Offline tests ➡️ **Pass across all suites**.
  - Backend pytest ➡️ **130/130 pass (0 fail)**.
- **Status:** 🟢 SELESAI (SW v378 `taskflow-v378-chat-bubble-newline-pre-wrap`).

## 🟢 Auto-Detect Quick Task & Center Screen Fade Notification di Dashboard — 2026-10-07 (Claude) — SELESAI
- **Kebutuhan Pengguna:**
  1. Pada kolom input capture Dashboard ("Tulis apa saja... tekan Enter untuk simpan"), pengguna ingin tulisan otomatis dideteksi menjadi Task jika diawali kata kunci task (seperti `tugas`, `task`, `tasks`, `todo`, `todos`), bukan selalu menjadi Note.
  2. Contoh masukan: `"Tugas, beli mobil fortuner besok"` otomatis menjadi Task dengan judul `"beli mobil fortuner"` dan deadline besok.
  3. Saat pengguna menekan Enter, muncul notifikasi di tengah layar yang mengindikasikan apakah `Task Created` atau `Note Created` dengan animasi pop-in lalu memudar otomatis (auto fade-out) tanpa perlu diklik.
  4. **Enhancement HUD Badge:** Tampilan didesain lebih mewah dan modern berupa pill badge (`border-radius: 9999px`) dengan badge ikon melingkar (`.center-hud-icon-wrap`), tanpa garis tepi kiri yang kasar, durasi tampil lebih lama (~2.8 detik) agar nyaman dibaca sebelum memudar halus.
- **Solusi & Implementasi:**
  1. `static/index.html`:
     - Fungsi `parseQuickCapture(text, baseDate)`: mendeteksi awalan `tugas`, `task`, `tasks`, `todo`, `todos` (case-insensitive) diikuti pemisah (`,`, `:`, `-`, `.`) atau spasi.
     - Mengekstrak kata waktu relatif (`hari ini`/`today`, `besok`/`tomorrow`, `lusa`) menjadi deadline ISO `YYYY-MM-DD` dan membersihkan judul task.
     - Handler `handleScratch`: jika `parsed.isTask`, memanggil `api.post("/api/tasks", { title, deadline, priority: "P3", gtd_status: "inbox" })`, mendukung offline queue fallback, memicu `taskSaved` event, dan memanggil `window.__refreshTasks()` sehingga ring KPI dan daftar prioritas Dashboard ter-update seketika.
     - Notifikasi HUD tengah layar (`.center-hud-toast`): dirender di Dashboard saat enter ditekan dengan pesan `Task Created` (ikon checklist melingkar hijau) atau `Note Created` (ikon note melingkar indigo), auto-dismiss setelah 2.8 detik.
     - Listener `taskSaved` di `App` untuk sinkronisasi `fetchAll()`.
     - Bump stylesheet query ke `app.css?v=318`.
  2. `static/app.css`:
     - Menambahkan styling `.center-hud-toast`, `.center-hud-icon-wrap`, `.center-hud-icon-task`, `.center-hud-icon-note`, `.center-hud-title` dengan backdrop blur 16px, pill border radius, subtle multi-layer shadow, penempatan tengah layar (`top: 50%; left: 50%; transform: translate(-50%, -50%)`), `pointer-events: none`, serta keyframes animasi `centerHudFade` 2.8s.
  3. `static/sw.js` & Tests:
     - Bump cache Service Worker ke `taskflow-v377-hud-toast-redesign-longer-fade`.
     - Menambahkan test suite baru `tests/offline/quick_capture_detect.test.js`.
     - Sinkronisasi versi cache dan stylesheet di 8 file test offline.
- **Status:** 🟢 SELESAI (SW v377 `taskflow-v377-hud-toast-redesign-longer-fade`).

## 🟢 Perbaikan Share Workspace File ke Chat (Offline Repo & Syncpush) — 2026-10-07 (Claude) — SELESAI
- **Masalah:** Saat pengguna membagikan berkas workspace yang sudah ada ke obrolan (`handleShareToChat` di tab Files), kartu di ruang chat sempat menampilkan status "*🗑️ BERKAS TELAH DIHAPUS*" meskipun berkas masih ada di workspace.
- **Root Cause:**
  1. `POST /api/lists/:id/messages` dicegat oleh router lokal (`TF.taskroutes` ➔ `TF.chatrepo.sendMessage`), namun `chatrepo.js` tidak menyimpan `file_id`, `file_original_name`, `file_size`, `file_mime_type`, dan `file_is_deleted` ke IndexedDB `chat_messages` maupun pada fungsi `shape()` & `upsertOne()`.
  2. Saat sinkronisasi outbox berjalan (`opChatSend` di `syncpush.js`), `chatSendPayload()` tidak menyertakan `file_id`, sehingga pesan dikirim ke backend tanpa `file_id`.
  3. UI `FileMiniCard` memvalidasi `msg.file_is_deleted || !msg.file_original_name`. Karena metadata berkas hilang/kosong, kartu otomatis menganggap berkas dihapus.
- **Solusi:**
  1. `static/offline/chatrepo.js`: Mempertahankan dan memetakan `file_id`, `file_original_name`, `file_size`, `file_mime_type`, serta `file_is_deleted` pada `shape()`, `upsertOne()`, dan `sendMessage()`.
  2. `static/offline/syncpush.js`: Menambahkan `file_id: rec.file_id` pada `chatSendPayload()` dan memperbarui record lokal saat respons server diterima pada `opChatSend()`.
  3. `static/index.html`: Menyertakan `file_original_name`, `file_size`, `file_mime_type`, dan `client_id` saat `handleShareToChat` dan `ChatInputBar` mengirim pesan agar kartu optimistik langsung lengkap dan reaktif.
  4. Pengujian & SW: Menambahkan pengujian di `tests/offline/chatrepo.test.js`, `tests/offline/chatsync_push.test.js`, dan `tests/offline/workspace_files_chat.test.js`.
- **Verifikasi:**
  - `node scratch/check_inline.js static/index.html` ➡️ **5/5 scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - Full offline tests ➡️ **987/987 pass (0 fail)** across all suites.
  - Backend pytest ➡️ **130/130 pass (0 fail)**.
- **Status:** 🟢 SELESAI.

## 🟢 Tata Letak 2-Baris Mini Pomodoro di Mobile Topbar — 2026-10-07 (Claude) — SELESAI
- **Masalah:** Pada tampilan mobile, widget mini Pomodoro (`TopBarPomodoroChip`) sebelumnya berdesakan di baris pertama sejajar dengan tombol hamburger `☰` dan seluruh tombol aksi (`🔍`, `🔔`, `?`, `☀️/🌙`), menyebabkan judul task terpotong sempit (`max-width: 85px`) dan header sangat sesak.
- **Solusi:**
  1. `static/index.html`: Merestrukturisasi `.mobile-topbar` menjadi 2 baris terpisah saat Pomodoro aktif:
     - Baris 1 (`.mobile-topbar-main`): Tombol hamburger, spacer, dan tombol aksi pencarian, notifikasi, tour, serta toggle tema.
     - Baris 2 (`.mobile-topbar-pomo-row`): Dirender kondisional saat `page !== "today" && focusTask`, memuat `TopBarPomodoroChip`.
  2. `static/app.css`:
     - Menyesuaikan `.mobile-topbar` dengan `flex-direction: column; gap: 8px;`.
     - Memberikan styling `.mobile-topbar-main` (flex 100%) dan `.mobile-topbar-pomo-row` (flex 100%).
     - Memperluas `.mobile-topbar-pomo-row .topbar-pomo-task` di mobile menjadi `max-width: calc(100vw - 150px)` agar nama task terbaca jelas dan tidak terpotong sempit.
     - Bump stylesheet query ke `app.css?v=316`.
  3. SW & Tests: Bump cache version SW ke `taskflow-v374-mobile-pomodoro-second-row`. Menambahkan pengujian di `tests/offline/focus_workstation.test.js` dan menyesuaikan asersi stylesheet di `tests/offline/note_toc.test.js` serta sinkronisasi versi cache di 7 test offline.
- **Verifikasi:**
  - `node --check static/sw.js` ➡️ **OK**.
  - `node --test tests/offline/focus_workstation.test.js` ➡️ **14/14 pass (0 fail)**.
  - `node --test tests/offline/note_toc.test.js` ➡️ **50/50 pass (0 fail)**.
  - Synchronized offline tests ➡️ **99/99 pass (0 fail)** across test suites.
- **Status:** 🟢 SELESAI (SW v374 `taskflow-v374-mobile-pomodoro-second-row`).

## 🟢 CI / CD Deployment Git Lock & Ref Mismatch Resilience — 2026-10-06 (Antigravity/Gemini) — SELESAI (`main`, Commit `4352293`)
- **Masalah:** Deploy workflow gagal akibat stale lock dan ref mismatch saat push beruntun (`cannot lock ref 'refs/remotes/origin/main'`).
- **Solusi:** Di `.github/workflows/deploy.yml`, menambahkan `rm -f .git/refs/remotes/origin/main.lock .git/index.lock` sebelum checkout dan mengganti `git pull` dengan `git fetch --prune origin main` + `git reset --hard origin/main`.
- **Verifikasi CI:**
  - Commit `4352293` pushed ke `origin/main`.
  - GitHub Actions Workflow Run `37470817511` (Deploy Taskflow V4) ➡️ **completed (success)**.
  - GitHub Actions Workflow Run `37470817463` (Tests) ➡️ **completed (success)**.
- **Status:** 🟢 SELESAI & DEPLOYED ke VPS.

## 🟢 Workspace Files Repository & Chat File Attachments — 2026-10-06 (Antigravity/Gemini) — SELESAI (branch `feat/workspace-files-chat-attachments` merged ke `main`, SW v370 `taskflow-v370-workspace-files`)
- **Plan & Spec:** `docs/superpowers/specs/2026-10-05-workspace-files-and-chat-attachments-design.md`, `docs/superpowers/plans/2026-10-05-workspace-files-and-chat-attachments.md`.
- **Fitur Utama:**
  1. **Kemampuan Attach File di Chat (`ChatRoom`):** Tab `[ 📁 File ]` di `AttachPopup`, upload berkas baru atau memilih berkas yang sudah ada di workspace, preview chip di input bar, dan render kartu berkas interaktif `FileMiniCard` dengan pratinjau & unduh.
  2. **Tab Files di Workspace (`slist_<id>`):** Tab navigasi `[ 📋 Tasks ] [ 📁 Files (N) ]` pada halaman workspace, pencarian berkas instan, filter kategori (PDF, Dokumen/Sheet, Gambar), tracking asal-usul (chat, task, langsung), tombol aksi pratinjau, unduh, bagikan ke chat, dan hapus.
  3. **Katalog Terpusat & Agregasi Otomatis:** Lampiran task (`task_attachments`) di dalam workspace otomatis tercatat di `workspace_files`.
  4. **Kebijakan Hapus (Opsi A):** Hanya uploader berkas dan owner workspace yang berhak menghapus file (soft delete + physical delete).
- **Hasil Eksekusi 7 Task TDD:**
  - Task 1: Database migration & schema setup (`workspace_files`, `messages.file_id`).
  - Task 2: Backend API untuk workspace files CRUD & download.
  - Task 3: Task attachment auto-sync & chat message file attachment.
  - Task 4: Frontend chat input bar attach popup file tab & preview chip.
  - Task 5: Frontend chat bubble file card (`FileMiniCard`).
  - Task 6: Frontend workspace tabs & `WorkspaceFilesView`.
  - Task 7: Service Worker bump (`taskflow-v370-workspace-files`) & full test suite verification.
- **Verifikasi:**
  - `node scratch/check_inline.js static/index.html` ➡️ **5/5 scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `node --test tests/offline/workspace_files_chat.test.js` ➡️ **pass**.
  - Synchronized offline tests ➡️ **pass** across all suites.
  - `python -m pytest tests/test_workspace_files.py` ➡️ **pass**.
  - `python -m pytest tests/` ➡️ **pass**.
- **Status:** 🟢 SELESAI di `main`, SW v370 `taskflow-v370-workspace-files` (Commit `715caeb` pushed ke `origin/main`, CI GitHub Actions deployment triggered).
- **PENDING DEPLOY:** Di VPS WAJIB restart service `sudo systemctl restart taskflow-web` agar `migrate_db()` membuat tabel `workspace_files` dan kolom `messages.file_id`. Klien memerlukan hard refresh browser (Ctrl+Shift+R) atau tutup-buka PWA agar Service Worker v370 aktif.


## 🟢 Global Pomodoro State Persistence & Top Bar Mini Widget — 2026-10-05 (Antigravity/Gemini) — SELESAI (branch `feat/global-pomodoro-topbar-widget`, SW v367 `taskflow-v367-global-pomodoro`)
- **Plan & Spec:** `docs/superpowers/specs/2026-10-05-global-pomodoro-topbar-widget-design.md`, `docs/superpowers/plans/2026-10-05-global-pomodoro-topbar-widget.md`.
- **Fitur:**
  1. **Lifting State ke `App` (`static/index.html`):** State Pomodoro (`timer = usePomodoro(...)`, `focusTask`, `focusTaskId`, `taskPomodoros`) diangkat ke level `App` agar timer terus berjalan saat user berpindah ke halaman lain (Tasks, Habits, Notes, Mindmap, Draw, dll.).
  2. **Persistensi `localStorage` & Drift Correction (`usePomodoro`):** Menyimpan snapshot state Pomodoro ke `tf_pomo_state` (`mode`, `timeLeft`, `isRunning`, `targetEndTime`, `focusTaskId`, dll.). Waktu tersisa dikoreksi terhadap `targetEndTime` untuk mencegah perlambatan/throttling tab di background dan mendukung pemulihan setelah reload tab.
  3. **Mini Widget `TopBarPomodoroChip` (`static/index.html` & `static/app.css`):** Ditampilkan di top bar (`desktop-topbar` dan `mobile-topbar`) saat `page !== "today" && focusTask`. Menampilkan ikon mode (🍅/☕), display waktu tabular (`mm:ss`), judul task fokus (dengan pemotongan ellipsis), dan tombol kontrol mini Play/Pause (`e.stopPropagation()`). Mengklik chip mengarahkan user kembali ke halaman "Fokus Hari Ini" (`setPage("today")`).
  4. **SW Cache Version Bump:** Bump ke `taskflow-v367-global-pomodoro` di `static/sw.js` beserta sinkronisasi seluruh 6 file test offline (`tests/offline/`).
- **Verifikasi:**
  - `node scratch/check_inline.js static/index.html` ➡️ 5/5 scripts OK.
  - `node --check static/sw.js` ➡️ OK.
  - `node --test tests/offline/focus_workstation.test.js` ➡️ 13/13 pass (0 fail).
  - Synchronized offline tests ➡️ 89/89 pass across 6 suites.
  - `python -m pytest tests/` ➡️ 122/122 pass (0 fail).
  - Subagent reviews: Task 1 (review clean), Task 2 (review clean), Task 3 (review clean), Final whole-branch review (Spec ✅, Code Quality: Approved, zero findings).
- **PENDING:** Klien perlu hard refresh browser (Ctrl+Shift+R) atau tutup-buka PWA agar SW v367 aktif.


## 🟢 Note Trash & Restore (backend + klien + perbaikan review) — 2026-10-03 (Gemini/Claude) — SELESAI & MERGED ke `main` (commit `74b8114`, test fix `d5d0b77`, SW v348 `taskflow-v348-notes-trash-and-restore`)
- **Commit:** spec `5a42ff8`, backend `8be74b4`, klien `011d6de`, review `60748b8`, merge `74b8114`, test fix `d5d0b77`. ADR-004 di DECISIONS.md.
- **PENDING saat deploy:** `sudo systemctl restart taskflow-web` WAJIB (tabel `trashed_notes` dibuat oleh `migrate_db()` saat startup; deploy.yml tidak me-restart) → tanpa restart, hapus note gagal 500 karena tabel belum ada; hard refresh browser (SW v348); rebuild APK/.exe.
- **Konteks:** backend sudah di commit `8be74b4` (tabel `trashed_notes`, `/api/scratchpad/trash*`). Spec: `docs/superpowers/specs/2026-10-02-note-trash-design.md`.
- **Jebakan router (diperbaiki + dites):** rute lokal `GET/DELETE /api/scratchpad/:id` menelan `/api/scratchpad/trash`. `taskroutes.js` kini mengekspor `isNoteTrashCall` + `shouldRouteLocally(router, method, path)` (menggabung preseden `isNoteTagsCall`); api wrapper `index.html` memakai `shouldRouteLocally` (fallback inline untuk taskroutes.js lama dari cache SW). `sw.js`: `/api/scratchpad/trash*` NETWORK-ONLY semua method (tanpa cache GET basi; offline → 503 `OFFLINE`). Tidak pernah lewat `OfflineDB.queueAdd`/outbox.
- **UI:** `NoteTrashModal` (index.html, sebelum NotesPage) + tombol ikon `trash` (title "Sampah") di header sidebar Notes. Daftar/Pulihkan/Hapus permanen/Kosongkan (confirm), loading/kosong/error, offline → "Perlu koneksi internet untuk melihat Sampah" tanpa API. Saat dibuka: `__pushNow()` (maks 5 dtk) dulu karena hapus online lewat router lokal + outbox. Pulihkan → `__syncNow()` + `fetchNotes` + titles, toast "♻️ Catatan dipulihkan". Logika murni di modul baru `static/offline/notetrash.js` (`TF.notetrash`, di-precache SW).
- **Konfirmasi hapus:** semua jalur pakai `TF.notetrash.CONFIRM_MOVE` + toast "🗑 Dipindahkan ke Sampah" (panel viewer, NoteModal — sebelumnya TANPA konfirmasi —, mindmap NoteModal, App-level NoteModal). Bug lama diperbaiki: App-level NoteModal memanggil `api.delete` (tidak ada → TypeError) → `api.del`. Perilaku hapus offline (outbox) tidak diubah.
- **Verifikasi:** JS 825/826 (+20 tes: `note_trash_routing.test.js`, `notetrash.test.js`; 1 fail pra-ada `draw_local_reactive`), pytest 90/90, inline 5/5. E2E Playwright 49/49 (desktop 1280 + mobile 390, uvicorn lokal): hapus UI → Sampah → Pulihkan (id asli + tag, server & IndexedDB) → Hapus permanen → Kosongkan → offline. Skrip & screenshot: scratchpad sesi `trash-e2e/`.
- **Review independen + perbaikan (2026-10-02):**
  - BUG 1 restore dibatalkan DELETE tertunda (respons DELETE hilang → op `note/delete` tetap antre → push ulang memindahkan note ke Sampah lagi): `noterepo.discardPendingDelete(serverId)` membuang semua op outbox note itu bila ada op `delete`; rekaman lokal `deleted:true` + idmap DIPERTAHANKAN supaya pull membuatnya ulang dengan cid yang sama. Dipanggil `handleTrashRestored(note)` sebelum `__syncNow`.
  - BUG 2 backlink/outlink lokal hilang setelah restore (note dibuat ulang dengan cid baru, note lain bersih tidak ditulis ulang): `pullNotes` kini, untuk rekaman NON-dirty dengan updated_at sama, memperbarui `linked_to_cids` bila `linked_to` server menunjuk note yang dikenal lokal tapi cid-nya tidak ada di `linked_to_cids` (hasil `relinked`; index.html memicu `noteSaved` bila `relinked > 0`). Id server linked_to tidak perlu disimpan lokal — daftar server di tiap pull membawanya.
  - BUG 3 `_trash_preview` (webapp.py) kuadratik → content dipotong `[:2000]` sebelum regex ('a['*50000: 18 dtk → instan).
  - S-a: semua `window.TF.notetrash.*` di index.html di-guard `?.` + teks bawaan; `NoteTrashModal` menampilkan "Sampah belum termuat. Muat ulang halaman…" bila modul tidak ada. S-b: `notetrash.canTrash(note, uid)` — toast "Dipindahkan ke Sampah" tidak muncul untuk note shared milik orang lain (user_id null/tak diketahui → dianggap pemilik, karena hydrate note pribadi tidak menyimpan user_id).
  - Tes: `tests/offline/note_trash_sync.test.js` (baru, S1/S2 reviewer), tambahan di `notetrash.test.js` & `tests/test_note_trash.py`. JS 835/836 (fail pra-ada tldraw), pytest 91/91, inline 5/5. Koordinator: repro reviewer S1 (dengan handler baru) & S2 lulus; E2E Playwright diulang setelah perbaikan 49/49 (wajib env `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1`, tanpa itu 2 uji SW-offline gagal palsu). Fallback modal S-a belum pernah dirender.
  - **Keterbatasan diketahui:** perangkat kedua yang punya edit dirty pada note saat note itu dihapus di perangkat lain → push PUT 404 → POST membuat note baru; setelah restore ada 2 note (yang dipulihkan + salinan dengan edit) — edit tidak hilang, user merapikan manual.
- **Catatan agen berikut:** Playwright `context.setOffline` TIDAK berlaku untuk fetch dari service worker — uji jalur SW offline pakai `context.route(...abort)` + `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1`. E2E harus menunggu reload `controllerchange` SW pertama sebelum navigasi. Belum dites HP fisik/APK/Tauri.

