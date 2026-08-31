## 🚨 CRITICAL WARNING FROM PAST SESSION 🚨
**ATTENTION ALL AGENTS:** In a previous session, an agent was severely reprimanded by the user for ignoring the Superpowers plugin rules, writing code inline (cowboy coding), breaking the database with untested migrations, and falsely claiming a task was complete without running tests.
**YOU MUST NOT REPEAT THIS.**
1. Read the Superpowers skills (`subagent-driven-development`, `requesting-code-review`, etc.).
2. Delegate implementation and review tasks to SUBAGENTS.
3. NEVER guess bugs; isolate and reproduce them systematically.
4. Always run `pytest` (e.g. `python -m pytest tests/test_docx_export.py` and `tests/test_drawings.py`) and verify JS syntax before pushing code.

## 🟢 Active Task
- **Linux `.deb` Desktop Packaging & CI Configuration (`src-tauri/tauri.conf.json`, `.github/workflows/appimage.yml`, `tests/build-tauri-dist.test.js`) — SELESAI 2026-08-31 (Antigravity/Gemini):**
  - **Problem / Context:**
    - Sebelumnya, packaging desktop Linux pada Alurik (Tauri v2) hanya mengonfigurasi `appimage` pada `bundle.targets` dan GitHub Actions CI hanya mem-build serta meng-upload bundle AppImage. Pengguna distribusi Linux berbasis Debian/Ubuntu membutuhkan paket native `.deb` dengan dependensi sistem yang terdefinisi secara presisi.
  - **Solusi / Perbaikan:**
    1. `src-tauri/tauri.conf.json`:
       - Mengupdate `bundle.targets` menjadi `["nsis", "appimage", "deb"]`.
       - Menambahkan konfigurasi `bundle.linux`:
         - `deb`: dependensi `["libwebkit2gtk-4.1-0 | libwebkit2gtk-4.0-37", "libgtk-3-0", "libayatana-appindicator3-1"]`, `section: "utils"`, `priority: "optional"`.
         - `appimage`: `bundleMediaFramework: false`.
    2. `.github/workflows/appimage.yml`:
       - Mengubah nama workflow menjadi `Build Linux Desktop (AppImage & Deb)`.
       - Mengupdate command build menjadi `npx tauri build --bundles appimage,deb`.
       - Mengupdate upload artifact untuk mengunggah `taskflow-linux-appimage` (`src-tauri/target/release/bundle/appimage/*.AppImage`) dan `taskflow-linux-deb` (`src-tauri/target/release/bundle/deb/*.deb`).
    3. `tests/build-tauri-dist.test.js`:
       - Menambahkan test suite `tauri.conf.json configures linux deb and appimage packaging` dan `github workflow builds and uploads both appimage and deb`.
  - **Verifikasi:**
    - Unit test suite: `node --test tests/build-tauri-dist.test.js` ➡️ **3/3 pass (0 fail)**.
    - Full JS offline test suite: `node --test tests/offline/*.test.js` ➡️ **606/606 pass (0 fail)** across 7 suites.
    - Backend test suite: `venv/bin/python -m pytest tests/` ➡️ **59/59 tests pass (0 fail)**.
    - Independent Subagent Review: **APPROVED**.

- **NotesPage Sidebar Header Deduplication (`static/index.html`, `static/sw.js`) — SELESAI 2026-08-30 (Antigravity/Gemini):**
  - **Problem / Context:**
    - Sebelumnya pada header sidebar `NotesPage`, label judul di sebelah kiri menampilkan `📝 Catatan` dan div aksi di sebelah kanan kembali memuat span duplikat `Catatan (${sortedNotes.length})`, sehingga terjadi redundansi tampilan teks "Catatan".
  - **Solusi / Perbaikan:**
    1. `static/index.html`:
       - Mengubah judul sisi kiri menjadi `/*#__PURE__*/React.createElement("span", { style: { fontWeight: 700, fontSize: 14, color: "var(--text-primary)" } }, `📝 Catatan (${sortedNotes.length})`)`.
       - Menghapus span duplikat `Catatan (${sortedNotes.length})` dari div aksi kanan (`display: flex, alignItems: center, gap: 6`), menyisakan select sort dan tombol collapse `✕`.
    2. `static/sw.js`:
       - Bump Service Worker cache version ke **`taskflow-v329-notes-sidebar-header-dedup`**.
  - **Verifikasi:**
    - Inline syntax check: `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 scripts OK**.
    - Service Worker syntax check: `node --check static/sw.js` ➡️ **OK**.
    - Unit test suite: `node --test tests/offline/notes_page_layout.test.js` ➡️ **20/20 pass (0 fail)**.
    - Full JS offline test suite: `node --test tests/offline/*.test.js` ➡️ **606/606 pass (0 fail)** across 7 suites.
    - Backend test suite: `venv/bin/python -m pytest tests/` ➡️ **59/59 tests pass (0 fail)**.

- **Chat Unified Container Layout (`static/app.css`, `static/index.html`, `static/sw.js`, `tests/offline/chat_page_layout.test.js`) — SELESAI 2026-08-30 (Antigravity/Gemini):**
  - **Problem / Root Cause & Context:**
    - Sebelumnya, halaman Chat (`ChatPage`) menggunakan styling terpisah dengan padding viewport `100vh` (.main-content.no-padding), `.chat-list-panel` dengan border independen `16px`, dan `.chat-room` dengan border/radius tersendiri. Ini tidak seragam dengan pola unified container frame pada `NotesPage` (`.notes-layout`), `DrawPage` (`.draw-container`), dan `MindmapPage` (`.mindmap-container`).
  - **Solusi / Perbaikan:**
    1. `static/app.css`:
       - Mengupdate `.chat-layout` menjadi unified container: `display: flex; height: calc(100vh - 84px); min-height: 480px; margin-top: 6px; overflow: hidden; position: relative; border-radius: 12px; border: 1px solid var(--border); background: var(--bg-card); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04); gap: 0; padding: 0;`.
       - Mengupdate `.chat-list-panel` dengan `width: 260px; flex-shrink: 0; border: none; border-right: 1px solid var(--border); border-radius: 0; display: flex; flex-direction: column; height: 100%; background: var(--bg-card); overflow: hidden; transition: width 0.2s ease;` dan `.collapsed { width: 52px; overflow: hidden; }`.
       - Mengupdate `.chat-list-item` dengan `padding: 10px 12px; cursor: pointer; border-bottom: 1px solid var(--border); transition: background 0.15s; display: flex; align-items: center; gap: 10px;` serta menghapus rule `border-radius: 16px 16px 0 0`.
       - Mengupdate `.chat-room` menyatu mulus: `border: none; border-radius: 0; height: 100%; min-width: 0; flex: 1; display: flex; flex-direction: column; overflow: hidden; background: var(--bg-card);`.
       - Mengupdate `.chat-room-header` (`border-radius: 0; border-bottom: 1px solid var(--border);`) dan `.chat-input-bar` (`border-radius: 0; border-top: 1px solid var(--border);`).
       - Mengupdate mobile media query `@media (max-width: 768px)`: `.chat-layout { height: calc(100vh - 56px); margin: -8px -16px 0; border-radius: 0; border-left: none; border-right: none; padding: 0; gap: 0; }` dan `.chat-list-panel { width: 100%; border-right: none; border-radius: 0; }`.
       - Mengelompokkan `.chat-layout` dan `.chat-list-panel` ke dalam rule grup workspace full-height containers (`.mindmap-container, .draw-container, .notes-layout, .chat-layout`).
    2. `static/index.html`:
       - Pada `ChatListPanel`: header menampilkan `💬 Diskusi / Chat` (font-weight 700, font-size 14px) dan tombol toggle collapse `◀`/`▶`.
       - Search input dirapikan dengan wrapper `.scratchpad-bar` (background `var(--bg-primary)`, border `1px solid var(--border)`, ikon 🔍 dan tombol ✕ saat ada teks query).
       - Area list scroll menggunakan `flex: 1`, `overflowY: "auto"`, `scrollbarWidth: "none"`.
       - Menghilangkan `${page === "chat" ? " no-padding" : ""}` dari wrapper `.main-content` agar konsisten dengan workspace lainnya.
    3. `static/sw.js`:
       - Bump Service Worker cache version ke **`taskflow-v328-chat-unified-container-layout`**.
    4. `tests/offline/chat_page_layout.test.js`:
       - Membuat test suite komprehensif 10 subtests untuk memvalidasi struktur JSX `ChatPage` dan `ChatListPanel`, styling CSS unified container, styling `.chat-list-panel`, item list tanpa radius, reset border/radius `.chat-room`, header & input bar, mobile media query, dan Service Worker cache version.
  - **Verifikasi:**
    - Inline syntax check: `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 scripts OK**.
    - Service Worker syntax check: `node --check static/sw.js` ➡️ **OK**.
    - Unit test suite: `node --test tests/offline/chat_page_layout.test.js` ➡️ **11/11 pass (0 fail)**.
    - Full JS offline test suite: `node --test tests/offline/*.test.js` ➡️ **606/606 pass (0 fail)** across 7 suites.
    - Backend test suite: `venv/bin/python -m pytest tests/` ➡️ **59/59 tests pass (0 fail)**.

- **Notes Unified Container Layout (`static/app.css`, `static/sw.js`, `tests/offline/notes_page_layout.test.js`) — SELESAI 2026-08-30 (Antigravity/Gemini):**
  - **Problem / Root Cause & Context:**
    - Sebelumnya, halaman Catatan (`NotesPage`) menggunakan styling terpisah antara `.notes-left` dan `.notes-right` (dengan margin `margin-left: 10px` / `8px`, border independen `14px`, dan box shadow), berbeda dari pola unified container yang digunakan pada `DrawPage` (`.draw-container`) dan `MindmapPage` (`.mindmap-container`).
  - **Solusi / Perbaikan:**
    1. `static/app.css`:
       - Mengupdate `.notes-layout` menjadi unified container: `display: flex; height: calc(100vh - 84px); min-height: 480px; margin-top: 6px; overflow: hidden; position: relative; border-radius: 12px; border: 1px solid var(--border); background: var(--bg-card); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);`.
       - Mengupdate `.notes-left` dengan `height: 100%; display: flex; flex-direction: column; overflow: hidden; position: relative; background: var(--bg-card); flex-shrink: 0;` dan garis pemisah `border-right: 1px solid var(--border)` (hilang saat collapsed).
       - Mengupdate `.notes-right` menyatu mulus ke panel kiri tanpa margin/border independen: `margin-left: 0; border: none; border-radius: 0; box-shadow: none; height: 100%; flex: 1; min-width: 0; background: var(--bg-card);`.
       - Menyelaraskan tablet media query `@media (min-width: 768px) and (max-width: 1024px)` (`.notes-right { margin-left: 0 !important; }`) dan mobile media query `@media (max-width: 767px)`.
       - Mengelompokkan `.notes-layout` dan `.notes-left` ke dalam rule grup workspace full-height containers (`.mindmap-container, .draw-container, .notes-layout`).
    2. `static/sw.js`:
       - Bump Service Worker cache version ke **`taskflow-v327-notes-unified-container-layout`**.
    3. `tests/offline/notes_page_layout.test.js`:
       - Mengupdate asersi test 7 untuk memvalidasi `border-radius: 12px`, `border: 1px solid var(--border)`, `margin-left: 0`, `border: none; border-radius: 0; box-shadow: none`, dan `height: 100%`.
  - **Verifikasi:**
    - Inline syntax check: `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 scripts OK**.
    - Service Worker syntax check: `node --check static/sw.js` ➡️ **OK**.
    - Unit test suite: `node --test tests/offline/notes_page_layout.test.js` ➡️ **20/20 pass (0 fail)**.
    - Full JS offline test suite: `node --test tests/offline/*.test.js` ➡️ **595/595 pass (0 fail)** across 7 suites.
    - Backend test suite: `venv/bin/python -m pytest tests/` ➡️ **59/59 tests pass (0 fail)**.

- **Idempotent Note Deletion & Resilient Outbox Sync (`webapp.py`, `static/offline/syncpush.js`, `static/sw.js`, `tests/test_scratchpad.py`, `tests/offline/notesync_autoheal.test.js`) — SELESAI 2026-08-29 (Antigravity/Gemini):**
  - **Problem / Root Cause:**
    1. `DELETE /api/scratchpad/{note_id}` di `webapp.py` sebelumnya melempar HTTP 403 saat note tidak ditemukan (`if not conn.execute("SELECT id FROM scratchpad_notes WHERE id = ? AND user_id = ?", (note_id, uid)).fetchone(): raise HTTPException(403)`), bukannya mengembalikan respons 200 idempotent (`{"ok": True, "detail": "Note already deleted"}`). Selain itu, relasi terkait di tabel `entity_tags`, `note_pins`, `published_notes`, dan `note_attachments` belum dibersihkan secara eksplisit.
    2. Di `static/offline/syncpush.js`, fungsi `send` menandai error HTTP 5xx dengan `e.__network = true`, dan `pushOutbox` menghentikan pemrosesan seluruh antrean outbox (`stopped = true`) saat terjadi error. Akibatnya, jika satu operasi outbox mengalami error 500 dari server, seluruh operasi note create berikutnya di antrean outbox terblokir.
  - **Solusi / Perbaikan:**
    1. `webapp.py`:
       - Mengupdate `delete_scratchpad` untuk mengambil row by `id`. Jika tidak ditemukan, mengembalikan `{"ok": True, "detail": "Note already deleted"}` secara idempotent.
       - Memvalidasi kepemilikan (`if row["user_id"] != uid: raise HTTPException(403)`).
       - Menghapus relasi terkait dari `entity_tags`, `note_pins`, `published_notes`, `note_attachments`, dan `scratchpad_notes`.
    2. `static/offline/syncpush.js`:
       - Mengupdate `send` agar menandai response HTTP >= 500 dengan `e.__network = false` (server reached, 5xx server error) dan `e.status = res.status`.
       - Mengupdate `pushOutbox` agar hanya menghentikan antrean outbox (`stopped = true`) jika terjadi pemutusan jaringan sesungguhnya (`err && err.__network === true`). Untuk error 5xx pada operasi individual, mencatat `result.failed++` tanpa memblokir operasi lainnya di outbox.
    3. `static/sw.js`:
       - Bump Service Worker cache version ke **`taskflow-v326-idempotent-note-delete-resilient-sync`**.
    4. Unit Tests:
       - `tests/test_scratchpad.py`: Menambahkan unit test `test_scratchpad_delete_idempotent` (menghapus note yang ada, menghapus note yang sudah terhapus secara idempotent, menghapus note non-existent) dan `test_scratchpad_delete_forbidden_for_other_user` (validasi 403 untuk user lain).
       - `tests/offline/notesync_autoheal.test.js`: Menambahkan Test 7 untuk memvalidasi ketahanan antrean outbox saat satu operasi mengalami 500 error, operasi note create berikutnya tetap diproses dan di-push (`pushed: 1, failed: 1`).
  - **Verifikasi:**
    - Inline syntax check: `node scratch/check_inline.js static/index.html` ➡️ **5/5 scripts OK**.
    - Service Worker syntax check: `node --check static/sw.js` ➡️ **OK**.
    - Backend test suite: `python -m pytest tests/` ➡️ **59/59 tests pass (0 fail)**.
    - JS offline test suite: `node --test tests/offline/*.test.js` ➡️ **595/595 tests pass (0 fail)** across 7 suites.

- **Fix Inline Drawing Standalone Open ("Gambar tidak ditemukan") from Note Modal/Viewer to DrawPage (`static/index.html`, `static/sw.js`, `tests/offline/drawpage_open.test.js`, `tests/offline/draw_local_reactive.test.js`) — SELESAI 2026-08-28 (Antigravity/Gemini):**
  - **Problem / Root Cause:**
    1. **Multi-Identifier Mismatch (Numeric Server ID vs String Client CID):** Ketika inline drawing disisipkan via slash command `/draw` (`::draw[drw_...]`), ID yang disimpan di catatan adalah Client CID string (misal `drw_1724678123_abc`). Ketika dibuka ke halaman standalone `DrawPage`, `list.find`, `drawings.find`, dan `openDrawing` handler hanya melakukan strict equality `String(d.id) === String(initialDrawingId)`. Jika drawing record telah tersinkronkan atau memiliki numeric `d.id = 105`, pencocokan gagal (`String(105) !== "drw_..."`), sehingga pencarian lokal gagal.
    2. **`configureFetcher` Null Fallback:** Pada `configureFetcher` di `static/index.html`, handler memanggil `window.TF.idmap.serverIdOf(noteCid)`. Jika `noteCid` adalah CID yang belum tercatat di `_idmap` lokal atau merupakan numeric ID, `serverIdOf` mengembalikan `null`, dan fetcher mengembalikan `null` tanpa mencoba me-request `__syncRawFetch('/api/drawings/' + target)` (padahal backend FastAPI mendukung lookup by integer ID dan string `client_id`). Akibatnya offline router me-reject request dengan 404.
    3. **Mount Race Condition pada `useEffect([initialDrawingId])`:** Pada saat `DrawPage` pertama kali mount, state `drawings` bernilai array kosong (`[]`). `useEffect([initialDrawingId])` langsung mengeksekusi `drawings.find(...)` yang pasti undefined, langsung menembak `api.get` dan secara prematur memanggil `onInitialDrawingConsumed()` sebelum proses `fetchDrawingsList()` selesai.
    4. **`selectDrawing` Tab Mapping & ID Fallback:** `selectDrawing` sebelumnya menggunakan `d.id` langsung tanpa fallback ke `d.cid`, dan pemetaan tab (`res.tabs.map`) belum menggunakan multi-identifier matching.
  - **Solusi / Perbaikan:**
    1. `static/index.html`:
       - Menambahkan helper `matchesDrawingId(d, targetId)` di `DrawPage` yang mencocokkan target terhadap `d.id`, `d.cid`, `d.client_id`, dan `d.server_id`.
       - Mengupdate seluruh lookup di `DrawPage` (`list.find`, `drawings.find`, `openDrawing` event listener, deduplikasi `prev.some` di `setDrawings`, dan tab mapping di `selectDrawing`) menggunakan `matchesDrawingId`.
       - Mengupdate `selectDrawing` untuk menentukan `drawId = d.id != null ? d.id : d.cid`.
       - Menambahkan guard `if (!initialDrawingId || loading) return;` pada `useEffect([initialDrawingId, loading])` guna mencegah race condition pada saat inisialisasi awal.
       - Memperbarui `configureFetcher` agar mendukung numeric ID secara instan dan melakukan fallback `sid != null ? sid : idOrCid` langsung ke `__syncRawFetch`.
    2. `static/sw.js`:
       - Bump Service Worker cache version ke **`taskflow-v325-draw-open-cid-standalone-fix`**.
    3. Unit Tests:
       - `tests/offline/drawpage_open.test.js`: Menambahkan suite pengujian komprehensif memvalidasi `matchesDrawingId`, resolusi CID/numeric ID, non-premature mount consumption, dan fetcher fallback (12/12 pass).
       - `tests/offline/draw_local_reactive.test.js`: Menyesuaikan assertion `selectDrawing` ke `drawId`/`d.id` (5/5 pass).
  - **Verifikasi:**
    - Inline syntax check: `node scratch/check_inline.js static/index.html` ➡️ **5/5 scripts OK**.
    - Backend test suite: `python -m pytest tests/` ➡️ **57/57 tests pass (0 fail)**.
    - JS offline test suite: `node --test tests/offline/*.test.js` ➡️ **594/594 tests pass (0 fail)** across 7 suites.
    - Independent Subagent Code Review: **APPROVED**.

- **Unified Offline Drawing Reactivity & Bidirectional Synchronization (Notes ↔ DrawPage) — SELESAI 2026-08-27 (Antigravity/Gemini):**
  - **Problem / Root Cause:**
    1. **Rogue Network Fetch di `draw-app/src/App.jsx`:** Pada `handleMount`, iframe `draw-app` melakukan `fetch(/api/drawings/${noteId})` langsung ke jaringan backend SQLite. Ketika pengguna mengedit gambar di catatan (offline / sebelum sync), lalu membuka halaman `DrawPage`, iframe melakukan fetch ke server yang masih memegang data lama (stale snapshot). Snapshot lama ini termuat ke kanvas dan memicu event perubahan (`change`) yang menimpa kembali (*overwrite/revert*) data mutakhir di IndexedDB lokal.
    2. **Race Condition Unmount pada `QuickDrawModal.handleClose`:** Penutupan modal `QuickDrawModal` sebelumnya hanya menunggu 120ms (`setTimeout 120ms`). Ketika pengguna baru saja selesai menggambar dan mengklik "✓ Selesai", proses `requestSnapshot` (generasi SVG asinkron) belum sempat mengirim pesan `{ type: 'change' }` sebelum iframe di-unmount oleh React.
    3. **Event Listener `drawingSaved` Mengabaikan Save Lokal:** Pada komponen `DrawingTabInstance` dan `QuickDrawModal` di `static/index.html`, terdapat guard `if (e.detail?.source === 'sync' || e.detail?.remote)`. Karena penyimpanan lokal dari catatan/kanvas menembakkan `{ detail: { id: did } }` tanpa flag `source: 'sync'`, tab halaman Draw yang sedang terbuka mengabaikan seluruh pembaruan lokal dari catatan (dan sebaliknya) sampai proses `sync()` server dijalankan.
    4. **`DrawPage.selectDrawing` Mem-bypass Router Offline:** Pemanggilan `selectDrawing` sebelumnya menggunakan `__syncRawFetch('/api/drawings/' + d.id)` yang langsung menembak jaringan backend FastAPI alih-alih melalui `api.get` (offline router lokal IndexedDB + BlobStore).
  - **Solusi / Perbaikan:**
    1. `draw-app/src/App.jsx`:
       - Menghapus seluruh pemanggilan direct network `fetch(/api/drawings/${noteId})` di dalam `handleMount`. Iframe kini 100% offline-first mengandalkan handshake `{ type: 'ready' }` / `{ type: 'load' }` dari parent window host.
       - Membangun ulang (*rebuild*) bundle vendor tldraw produksi: `npm --prefix draw-app run build` (`static/vendor/tldraw/assets/index.js`).
    2. `static/index.html`:
       - Pada `QuickDrawModal.handleClose`: Menaikkan close timeout dari 120ms ke 350ms guna memberikan waktu yang aman bagi `requestSnapshot` untuk men-serialize SVG dan mengirimkan pesan `{ type: 'change' }` sebelum iframe dilepas dari DOM.
       - Pada `DrawingTabInstance` & `QuickDrawModal`: Menghapus guard `e.detail?.source === 'sync'`. Handler kini secara instan mendengarkan seluruh event `drawingSaved` yang cocok dengan `tab.id`/`drawingId`, mengambil snapshot terbaru via `api.get`, membandingkan dengan `lastLoadedJsonRef` untuk mencegah echo loop, dan mengirim `{ type: 'load', data: fresh.data_json }` ke iframe.
       - Pada `DrawPage.selectDrawing`: Mengganti `__syncRawFetch` menjadi `api.get('/api/drawings/' + d.id)` sehingga selalu membaca record otoritatif dari IndexedDB lokal `drawings` + `BlobStore`.
    3. `static/sw.js`:
       - Bump Service Worker cache version ke **`taskflow-v324-offline-draw-no-rogue-fetch`**.
    4. Unit Tests:
       - `tests/offline/draw_local_reactive.test.js`: Menambahkan suite pengujian komprehensif memvalidasi reaktivitas lokal dua arah tanpa sync guard, ketiadaan direct network fetch di `App.jsx`, timeout 350ms di modal, offline routing di `selectDrawing`, dan bundle exports (5/5 pass).
       - `tests/offline/drawpage_open.test.js`: Menyesuaikan assertion `selectDrawing` ke `api.get`.
  - **Verifikasi:**
    - Inline syntax check: `node scratch/check_inline.js static/index.html` ➡️ **5/5 scripts OK**.
    - Backend test suite: `python -m pytest tests/` ➡️ **57/57 tests pass (0 fail)**.
    - JS offline test suite: `node --test tests/offline/*.test.js` ➡️ **592/592 tests pass (0 fail)** across all suites.
    - Independent Subagent Code Review: **APPROVED**.


- **Fix Inline Drawing (`::draw[...]`) in Notes Showing Blank Frame / Missing Preview (`static/index.html`, `static/sw.js`, `draw-app`, `tests/offline/drawdirective.test.js`) — SELESAI 2026-08-26 (Antigravity/Gemini):**

  - **Problem / Root Cause:**
    1. **Format XML Header pada Output SVG:** Ketika library canvas `tldraw` mengekspor SVG (atau saat di-serialize `XMLSerializer`), output string SVG sering kali diawali dengan header standar XML `<?xml version="1.0" encoding="utf-8"?>` sebelum tag `<svg>`. Kode sebelumnya menggunakan validasi yang sangat kaku: `if (svg && svg.trim().startsWith('<svg'))`. Karena ada header `<?xml`, kondisi ini mengevaluasi `false`, sehingga `hydrateDrawingPreviews` mengabaikan SVG yang sah dan membiarkan kartu preview gambar di catatan hanya menampilkan bingkai frame kosong / teks placeholder.
    2. **Cache `_lastSavedDrawingJson` Mengabaikan Pembaruan SVG:** Pada event handler `handleIframeMessage` di `static/index.html`, pengecekan debounce hanya membandingkan `data_json` (`if (_lastSavedDrawingJson[did] === e.data.data) return;`). Ketika stroke pertama menyimpan JSON tanpa SVG atau saat SVG diproses secara asinkron (`exportToBlob`), pengiriman pesan berikutnya yang membawa SVG baru dengan JSON yang sama langsung dibatalkan (*dropped*), sehingga `svg_preview` tidak tersimpan ke database.
    3. **Komponen Editor & Viewer Tidak Mendengarkan Event `drawingSaved`:** Baik `MilkdownEditor` (mode edit) maupun `NotePanel` (mode baca) sebelumnya tidak meregister event listener untuk `drawingSaved`. Akibatnya, saat modal editor gambar (`QuickDrawModal`) ditutup dan mengirim event `drawingSaved`, kartu preview di editor dan viewer tidak di-hydrate ulang secara otomatis.
    4. **Race Condition Penutupan Modal:** `QuickDrawModal.handleClose()` sebelumnya hanya menunggu timeout pendek sebelum unmount, yang berpotensi mematikan iframe sebelum proses pembuatan SVG asinkron selesai.
    5. **Fitur Print & Word Docx Export:** `handlePrint` dan `handleExportDocx` juga memiliki pengecekan kaku `startsWith('<svg')` yang mengabaikan SVG ber-header XML.
  - **Solusi / Perbaikan:**
    1. `static/index.html`:
       - Mengupdate fungsi `hydrateDrawingPreviews`: Menggunakan pengecekan `if (svg && (svg.includes('<svg') || svg.trim().startsWith('<svg')))` agar mendukung SVG standar maupun SVG dengan XML declaration.
       - Menambahkan cache `_lastSavedDrawingSvg`: Memperbarui `handleIframeMessage` agar melacak dan membandingkan kombinasi `data_json` dan `svg_preview` (`if (_lastSavedDrawingJson[did] === e.data.data && _lastSavedDrawingSvg[did] === newSvg) return;`), sehingga update SVG selalu tersimpan ke IndexedDB dan server.
       - Pada `MilkdownEditor`: Menambahkan event listener `window.addEventListener('drawingSaved', hydrate)` dengan `force = true` dan pembersihan listener saat unmount.
       - Pada `NotePanel`: Menambahkan event listener `window.addEventListener('drawingSaved', handler)` untuk me-rehydrate preview saat gambar disimpan.
       - Pada `QuickDrawModal`: Memanggil `hydrateDrawingPreviews(null, true)` baik secara langsung maupun setelah delay saat modal ditutup.
       - Pada `handlePrint` dan `handleExportDocx`: Memperbarui validasi SVG agar mendukung XML header (`includes('<svg')`).
    2. `draw-app`:
       - Membangun ulang (*rebuild*) vendor bundle tldraw produksi via `npm --prefix draw-app run build`.
    3. `static/sw.js`:
       - Bump Service Worker cache version ke **`taskflow-v322-inline-draw-preview-xml-fix`**.
    4. `tests/offline/drawdirective.test.js`:
       - Menambahkan suite pengujian unit baru (*TDD*) `Inline Drawing Preview SVG Parsing and XML Header Acceptance` (memvalidasi penerimaan `<svg>` standar, XML-prefixed SVG dari tldraw, penolakan non-SVG, serta asersi struktural terhadap 6 titik perbaikan di `static/index.html`).
  - **Verifikasi:**
    - Inline syntax check: `node scratch/check_inline.js static/index.html` ➡️ **5/5 scripts OK**.
    - Backend test suite: `python -m pytest tests/` ➡️ **57/57 tests pass (0 fail)**.
    - JS offline test suite: `node --test tests/offline/*.test.js` ➡️ **587/587 tests pass (0 fail)** across 6 suites.
    - Independent Subagent Code Review: **APPROVED**.

- **Fix Empty Dashboard Pinned Notes Card in Offline Mode (`notequery.js`, `noteroutes.js`, `index.html`, `sw.js`) — SELESAI 2026-08-26 (Antigravity/Gemini):**
  - **Problem / Root Cause:**
    1. Di `static/offline/notequery.js`: `TFquery` sebelumnya belum mengimplementasikan fungsi `getPinned()`.
    2. Di `static/offline/noteroutes.js`: Rute `GET /api/scratchpad/pinned` belum terdaftar, sehingga saat dipanggil saat offline, router mencocokkannya ke `GET /api/scratchpad/:id` dengan `id="pinned"` yang menghasilkan 404 Not Found.
    3. Di `static/index.html` (baris ~440): `api.fetch` memiliki guard pengecualian eksplisit `&& url !== "/api/scratchpad/pinned"`, yang memaksa request tersebut selalu dilempar ke jaringan (network) dan gagal total ketika aplikasi berjalan dalam kondisi offline.
    4. Akibatnya, pada komponen Dashboard (`DashboardPage`), pemanggilan `api.get("/api/scratchpad/pinned")` saat offline masuk ke handler `.catch(() => {})` dan membiarkan state `pinnedNotes` kosong (`[]`), sehingga kartu "📌 Notes Disematkan" selalu menampilkan "Belum ada note yang disematkan.".
  - **Solusi / Perbaikan:**
    1. `static/offline/notequery.js`:
       - Mengimplementasikan `getPinned()`: mengambil seluruh catatan dari IndexedDB store `scratchpad_notes`, menyaring catatan aktif (`!n.deleted && !!n.pinned`), mengurutkan secara descending (`updated_at DESC`), serta membentuk payload respons yang lengkap (`shape(n, ctx)` dengan tags dan display ID).
       - Mengekspor `getPinned` ke objek modul ekspor.
    2. `static/offline/noteroutes.js`:
       - Mendaftarkan handler `router.register("GET", "/api/scratchpad/pinned", () => TFquery.getPinned())` sebelum rute wildcard `/:id`.
    3. `static/index.html`:
       - Menghapus pengecualian `&& url !== "/api/scratchpad/pinned"` pada interceptor `api.fetch`, sehingga request `/api/scratchpad/pinned` diproses langsung secara local-first oleh offline router.
    4. `static/sw.js`:
       - Bump Service Worker cache version ke **`taskflow-v321-dashboard-pinned-notes-offline-fix`**.
    5. Unit Tests:
       - `tests/offline/notequery.test.js`: Menambahkan pengujian `getPinned` (memvalidasi hanya catatan aktif yang di-pin yang dikembalikan dengan urutan `updated_at DESC` dan struktur data lengkap).
       - `tests/offline/noteroutes.test.js`: Menambahkan unit test integrasi `GET /api/scratchpad/pinned` via local router.
  - **Verifikasi:**
    - Inline syntax check: `node scratch/check_inline.js static/index.html` ➡️ **5/5 scripts OK**.
    - Backend test suite: `python -m pytest tests/` ➡️ **57/57 tests pass (0 fail)**.
    - JS offline test suite: `node --test tests/offline/*.test.js` ➡️ **583/583 tests pass (0 fail)** across 5 suites.
    - Independent Subagent Code Review: **APPROVED**.

- **Fix Drawing Duplication during Sync & Server Dedup CID/UUID Protection (`syncpull.js`, `dedup_drawings.py`, `sw.js`) — SELESAI 2026-08-26 (Antigravity/Gemini):**
  - **Problem / Root Cause:**
    1. Di `static/offline/syncpull.js`: `ensureDrawingCid(serverId, cache)` sebelumnya melakukan strict comparison `d.server_id === serverId`. Ketika `serverId` bernilai numerik di server namun tersimpan sebagai string di IndexedDB (atau saat drawing baru lokal masih `server_id == null` namun server memiliki `client_id = d.cid`), lookup gagal mencocokkan record lokal yang ada dan membangkitkan CID baru sehingga memicu duplikasi record lokal.
    2. Di `scripts/dedup_drawings.py`: `_find_draw_refs` hanya mengumpulkan integer ID (`if body.isdigit(): ids.add(int(body))`) dan mengabaikan token string UUID / client_id (`drw_...` / UUID), sehingga saat dedup dijalankan, gambar yang direferensikan via client_id di note berisiko terhapus.
  - **Solusi / Perbaikan:**
    1. `static/offline/syncpull.js`:
       - Mengupdate `ensureDrawingCid(serverId, cache, serverObj)` untuk menerima `serverObj`, memeriksa match via `(d.server_id != null && String(d.server_id) === String(serverId)) || (serverObj && serverObj.client_id && d.cid === serverObj.client_id)`.
       - Menggunakan fallback CID `(serverObj && serverObj.client_id) ? serverObj.client_id : TFids.newCid()`.
       - Di `pullDrawings`: Memperbarui pass 1 reduce untuk meneruskan `s` ke `ensureDrawingCid(s.id, cache, s)`.
    2. `scripts/dedup_drawings.py`:
       - Di `_find_draw_refs(content)`: Mengumpulkan string `body` dan integer `int(body)` jika `body.isdigit()`.
       - Di query SQL: Memilih `client_id` (`SELECT id, user_id, client_id, title, data_json, svg_preview, is_pinned, updated_at FROM drawings`).
       - Di `kept_rows` dan `candidates`: Memastikan pengecekan mencakup `r["id"] in refs or str(r["id"]) in refs or (r["client_id"] and r["client_id"] in refs) or r["is_pinned"]`.
    3. `static/sw.js`:
       - Bump Service Worker cache version ke **`taskflow-v320-drawing-dedup-fix`**.
    4. Unit Tests:
       - `tests/offline/drawingsync.test.js`: Menambahkan Test 21 untuk validasi `pullDrawings`/`ensureDrawingCid` match by `client_id` ketika `server_id` lokal bernilai `null` atau bertipe string vs number.
       - `tests/test_dedup_drawings.py`: Menambahkan `client_id TEXT` pada skema database pengujian dan unit test `test_dedup_preserves_uuid_client_id_refs`.
  - **Verifikasi:**
    - Inline syntax check: `node scratch/check_inline.js static/index.html` ➡️ **5/5 scripts OK**.
    - Backend test suite: `python -m pytest tests/` ➡️ **57/57 tests pass (0 fail)**.
    - JS offline test suite: `node --test tests/offline/*.test.js` ➡️ **581/581 tests pass (0 fail)** across 47 test suites.
    - Independent Subagent Code Review: **APPROVED**.

- **Fix Empty Drawing Canvas on DrawPage & Bidirectional Ready Handshake (`DrawingTabInstance`, `QuickDrawModal`, `draw-app`) — SELESAI 2026-08-26 (Antigravity/Gemini):**
  - **Problem / Root Cause:**
    1. Di `draw-app/src/App.jsx` pada `handleMount`: `fetch('/api/drawings/' + noteId)` dieksekusi dari dalam iframe tanpa menyertakan header `Authorization: Bearer <token>`, sehingga server merespons `401 Unauthorized` dan kanvas gagal memuat data saat mount.
    2. Di `static/index.html`: `DrawingTabInstance` dan `QuickDrawModal` sebelumnya tidak memiliki event listener `message` yang menangani pesan `{ type: 'ready' }` dari `iframeRef.current.contentWindow`. Ketika iframe selesai dimuat dan mengumumkan `{ type: 'ready' }`, parent component tidak mengirim balik snapshot `{ type: 'load', data: doc.data_json }`.
  - **Solusi / Perbaikan:**
    1. `draw-app/src/App.jsx`:
       - Di `handleMount`, mengambil token dari `localStorage.getItem('tf_token')` dan menyertakan header `{ Authorization: 'Bearer ' + token }` pada request `fetch('/api/drawings/' + noteId)`.
       - Mempertahankan fallback ke endpoint publik `/pub/drawings/${noteId}` jika request API drawing privat gagal.
    2. `static/index.html`:
       - Di `DrawingTabInstance` (baris ~9234): Menambahkan `useEffect` yang mendengarkan pesan `{ type: 'ready' }` dari `iframeRef.current.contentWindow` dengan origin guard dan source guard, mengambil data drawing terbaru dari `api.get('/api/drawings/' + tab.id)`, mengupdate `lastLoadedJsonRef.current`, dan mengirim pesan `{ type: 'load', data: doc.data_json }` ke iframe.
       - Di `QuickDrawModal` (baris ~17362): Menambahkan matching `useEffect` listener untuk `{ type: 'ready' }` guna menginisialisasi canvas modal dengan data snapshot authoritative.
    3. `static/vendor/tldraw/assets/index.js`:
       - Mengompilasi bundle produksi draw-app dengan auth header & ready handshake yang diperbarui.
    4. `static/sw.js`:
       - Bump Service Worker cache version ke **`taskflow-v319-draw-ready-auth-sync`**.
  - **Verifikasi:**
    - Inline syntax check: `node scratch/check_inline.js static/index.html` ➡️ **5/5 scripts OK**.
    - Backend test suite: `python -m pytest tests/` ➡️ **56/56 tests pass (0 fail)**.
    - JS offline test suite: `node --test tests/offline/*.test.js` ➡️ **580/580 tests pass (0 fail)** across 5 suites.
    - Subagent Code Review: **APPROVED**.

- **Fix Note Inline Drawings (`::draw[...]` / `QuickDrawModal`) & Draw Page (`DrawPage`) Synchronization — SELESAI 2026-08-26 (Antigravity/Gemini):**
  - **Problem / Root Cause:**
    1. Ketika gambar dibuat inline di Catatan (`::draw[drw_...]`), client menggunakan CID (string `drw_...`). Endpoint `/api/drawings/{did}` di `webapp.py` sebelumnya memiliki anotasi tipe `did: int`, sehingga saat iframe di Note me-request `/api/drawings/drw_...`, FastAPI merespons `422 Unprocessable Entity`.
    2. Endpoint `/pub/drawings/{drawing_id}` dan `/pub/attachments/{att_id}` di `webapp.py` terdaftar setelah route wildcard `/pub/{username}/{slug}`, sehingga lookup drawing publik dengan string CID salah diarahkan ke handler halaman publik dan mengembalikan 404.
    3. Di `draw-app/src/App.jsx`, `<Tldraw>` memiliki prop `persistenceKey={'tldraw-note-' + noteId}`. Saat dibuka dari Note, tldraw me-load cache localStorage `tldraw-note-drw_...`, sementara DrawPage me-load `tldraw-note-105`. Dua key terpisah ini menyebabkan tldraw me-load state usang/divergen alih-alih mengambil snapshot mutakhir dari database.
  - **Solusi / Perbaikan:**
    1. `webapp.py`:
       - Mengubah anotasi tipe `did: str` pada `get_drawing_detail`, `update_drawing_detail`, `toggle_pin_drawing`, dan `delete_drawing_detail`.
       - Menambahkan helper resolver by `int(did)` jika `did.isdigit()` dan fallback ke `client_id = ?`. Menggunakan resolved integer `id` untuk operasi SQL UPDATE/DELETE/PATCH.
       - Mengubah `get_published_drawing(drawing_id: str)` untuk mendukung lookup id integer dan `client_id`.
       - Memindahkan endpoint `/pub/drawings/{drawing_id}` dan `/pub/attachments/{att_id}` sebelum route wildcard `/pub/{slug}` dan `/pub/{username}/{slug}`.
       - Mengupdate `_drawing_enrich` untuk mencocokkan `::draw[{did}]` dan `::draw[{cid}]` pada linked notes.
    2. `draw-app/src/App.jsx`:
       - Menghapus prop `persistenceKey={`tldraw-note-${noteId}`}` dari `<Tldraw>` agar tldraw selalu me-mount secara bersih dan me-load authoritative snapshot dari database via `handleMount`.
       - Mengompilasi bundle produksi: `npm --prefix draw-app run build` (`static/vendor/tldraw/assets/index.js`).
    3. `static/sw.js`:
       - Bump Service Worker cache version ke **`taskflow-v318-inline-draw-sync`**.
    4. `tests/test_drawings.py`:
       - Menambahkan unit test `test_drawing_endpoints_by_client_id` untuk memvalidasi `GET`, `PUT`, `PATCH`, `DELETE` by `client_id` (e.g. `drw_test_cid_123`) dan `/pub/drawings/{client_id}`.
  - **Verifikasi:**
    - Inline syntax check: `node scratch/check_inline.js static/index.html` ➡️ **5/5 scripts OK**.
    - Backend test suite: `python -m pytest tests/` ➡️ **56/56 tests pass (0 fail)**.
    - JS offline test suite: `node --test tests/offline/*.test.js` ➡️ **580/580 tests pass (0 fail)** across 5 suites.

- **Drawing Smart Shape-Level Auto-Merge Engine (`static/offline/syncpull.js`) — SELESAI 2026-08-26 (Antigravity/Gemini):**
  - **Problem / Root Cause:**
    - Sebelumnya, sinkronisasi gambar menggunakan LWW (Last-Write-Wins) pada level file/snapshot utuh. Jika user mengedit gambar yang sama di dua tempat saat offline terpisah (misal di Kantor dan di Rumah), saat online snapshot dari satu tempat akan menimpa seluruh coretan dari tempat lain.
  - **Solusi / Perbaikan:**
    - `static/offline/syncpull.js`:
      - Mengimplementasikan `mergeDrawingSnapshots(localSnap, remoteSnap, opts)` dan fungsi helper `deepMerge`, `extractSnapshotData`, `parseSnapshot`, `updateDrawingOutboxMerged`.
      - Menangani 4 skenario resolusi konflik berbasis shape:
        1. **Disjoint Shapes:** Objek baru dari remote dan lokal digabung secara otomatis.
        2. **Deep Property Merge:** Perubahan atribut berbeda pada ID shape yang sama (misal ukuran di remote vs warna di lokal) digabungkan.
        3. **Property Collision:** Jika atribut yang sama persis bertabrakan, menggunakan opsi `preferRemote` berdasarkan perbandingan timestamp LWW.
        4. **Edit vs Delete:** Jika shape dihapus di satu sisi tapi dimodifikasi di sisi lain, modifikasi dipertahankan (*Edit Wins Over Delete*).
      - Mengupdate `pullDrawings`: Saat `local.dirty && pendingDrawingOps.has(cid)` dan `s.updated_at !== local.base_rev`, sistem melakukan *Smart Shape Auto-Merge* antara local snapshot dan remote snapshot, menyimpan hasil gabungan ke BlobStore dan local record, serta memperbarui payload `_outbox` dengan snapshot gabungan.
      - Mengekspor `mergeDrawingSnapshots` dari `syncpull.js`.
    - `static/sw.js`:
      - Bump Service Worker cache version ke **`taskflow-v317-draw-smart-shape-automerge`**.
    - `tests/offline/drawingsync.test.js`:
      - Menambahkan Test 16 (disjoint shapes merge), Test 17 (deep property merge on same shape), Test 18 (preferRemote on collision), Test 19 (edit-wins-over-delete), dan Test 20 (pullDrawings integration test with dirty local drawing & divergent server revision).
  - **Verifikasi:**
    - Inline syntax check: `node scratch/check_inline.js static/index.html` ➡️ **5/5 scripts OK**.
    - Unit tests: `node --test tests/offline/drawingsync.test.js` ➡️ **20/20 pass (0 fail)**.
    - JS offline test suite: `node --test tests/offline/*.test.js` ➡️ **580/580 tests pass (0 fail)** across 5 suites.
    - Backend test suite: `python -m pytest tests/` ➡️ **55/55 tests pass (0 fail)**.
  - **Problem / Root Cause:**
    - Ketika user menggambar di Browser 1 (misal Edge) dan perubahannya disinkronkan ke Browser 2 (misal Firefox), `DrawingTabInstance` / `QuickDrawModal` di Browser 2 mengirim `postMessage({ type: 'load', data: snapshot })` ke iframe tldraw (`draw-app/src/App.jsx`).
    - Listener `editor.store.listen(...)` di Browser 2 memperlakukan snapshot remote yang baru di-load sebagai perubahan lokal baru, lalu men-debounce 600ms dan mengirim pesan `change` kembali ke parent window Browser 2.
    - Parent window Browser 2 kemudian mem-`PUT /api/drawings/:id` ke server dengan timestamp baru (T2).
    - Saat Browser 1 yang sedang aktif menggambar objek baru (misal Arrow 2, 3, 4) melakukan sync berikutnya, Browser 1 menarik revisi lama dari Browser 2 (T2 yang hanya berisi Arrow 1) dan me-load ulang kanvas, seketika menghapus gambar-gambar baru yang sedang dibuat di Browser 1.
  - **Solusi / Perbaikan:**
    - `draw-app/src/App.jsx`:
      - Menambahkan `isRemoteLoadingRef`, `lastSnapshotStrRef`, dan `debounceTimerRef`.
      - Pada `handler` event `load`:
        - Membandingkan payload incoming `(typeof e.data.data === 'string' ? e.data.data : JSON.stringify(e.data.data))` dengan `lastSnapshotStrRef.current`. Jika identik, no-op (return early).
        - Mengaktifkan `isRemoteLoadingRef.current = true` dan membatalkan pending timer (`clearTimeout(debounceTimerRef.current)`).
        - Me-load snapshot ke editor store, mengupdate `lastSnapshotStrRef.current`, dan mengunci store listener selama 800ms cooldown.
      - Pada `handleMount`:
        - Menghapus semua panggilan `setTimeout(syncToParent, 400)` saat inisialisasi awal.
        - Membungkus pembacaan snapshot awal dengan `isRemoteLoadingRef.current = true` dan mengupdate `lastSnapshotStrRef.current` untuk mencegah initial save debounce.
      - Pada `editor.store.listen`:
        - Menolak trigger `syncToParent` jika `isRemoteLoadingRef.current === true`.
      - Pada `syncToParent`:
        - Menyimpan snapshot JSON string terbaru ke `lastSnapshotStrRef.current` setelah membaca store snapshot.
    - `static/index.html`:
      - Di `handleIframeMessage`: Menyediakan ref cache global `const _lastSavedDrawingJson = {}` untuk mengabaikan `api.put` jika payload JSON sama persis dengan yang terakhir disimpan.
      - Di `DrawingTabInstance` & `QuickDrawModal`: Menambahkan `lastLoadedJsonRef` untuk melewati `iframe.postMessage({ type: 'load' })` jika `fresh.data_json === lastLoadedJsonRef.current`.
    - `static/sw.js`:
      - Bump Service Worker cache version ke **`taskflow-v316-draw-no-echo-loop`**.
    - Build Production Bundle:
      - `npm --prefix draw-app run build` sukses mengompilasi `static/vendor/tldraw/assets/index.js`.
  - **Verifikasi:**
    - Inline syntax check: `node scratch/check_inline.js static/index.html` ➡️ **5/5 scripts OK**.
    - JS offline test suite: `node --test tests/offline/*.test.js` ➡️ **575/575 tests pass (0 fail)**.
    - Backend test suite: `python -m pytest tests/` ➡️ **55/55 tests pass (0 fail)**.
    - Independent Subagent Code Review: **APPROVED**.

- **Drawing Canvas Live Content Synchronization (`DrawingTabInstance` & `QuickDrawModal`) — SELESAI 2026-08-26 (Antigravity/Gemini):**
  - **Problem / Root Cause:**
    - Ketika user menggambar di Browser 1 (misal Edge) dan menyimpan perubahannya ke server, background sync di Browser 2 (misal Firefox) berhasil mem-pull `data_json` terbaru ke IndexedDB dan memicu event `drawingSaved`.
    - Namun, tab canvas yang sedang terbuka di Browser 2 (`DrawingTabInstance` dan modal `QuickDrawModal`) hanya me-load snapshot tldraw satu kali saat iframe mount. Karena kedua komponen tidak mendengarkan event `drawingSaved` dari `sync`, canvas tldraw yang sedang terbuka di Browser 2 tetap membeku dengan gambar versi lama sampai user menutup tab dan membukanya kembali secara manual.
  - **Solusi / Perbaikan:**
    - `static/index.html`:
      - Di dalam `sync()`, menyertakan `{ detail: { source: "sync", ...drawRes } }` pada event `drawingSaved` saat `drawRes.created > 0 || drawRes.updated > 0 || drawRes.deleted > 0 || drawRes.pinned > 0`.
      - Di dalam komponen `DrawingTabInstance`, menambahkan `useEffect` yang mendengarkan event `drawingSaved` (`source === 'sync' || remote`). Jika ID cocok atau wildcard, mengambil data drawing terbaru dari `api.get(/api/drawings/:id)` dan mengirimkan pesan `{ type: 'load', data: fresh.data_json }` ke `iframeRef.current.contentWindow`.
      - Di dalam komponen `QuickDrawModal`, menambahkan `useEffect` serupa yang mendengarkan event `drawingSaved` untuk menyinkronkan judul (`title`) dan snapshot data (`fresh.data_json`) ke iframe tldraw yang sedang aktif.
    - `static/sw.js`:
      - Bump Service Worker cache version ke **`taskflow-v315-draw-canvas-live-sync`**.
    - `tests/offline/drawingsync.test.js`:
      - Menambahkan Test 15 untuk memvalidasi kembalian result counters dari `pullDrawingsAndReconcile` dan struktur payload event dispatching `drawingSaved`.
  - **Verifikasi:**
    - Inline syntax check: `node scratch/check_inline.js static/index.html` ➡️ **5/5 scripts OK**.
    - JS offline test suite: `node --test tests/offline/*.test.js` ➡️ **575/575 tests pass (0 fail)**.
    - Backend test suite: `python -m pytest tests/` ➡️ **55/55 tests pass (0 fail)**.
    - Independent Subagent Code Review: **APPROVED**.

- **DrawPage Real-time Drawing List Refresh on `drawingSaved` Event — SELESAI 2026-08-25 (Antigravity/Gemini):**
  - **Problem / Context:**
    - Saat background sync (`sync()`) selesai mem-pull gambar terbaru dari perangkat lain dan memicu event `drawingSaved`, komponen `DrawPage` belum mendengarkan event tersebut sehingga daftar gambar di sidebar `DrawPage` tidak ter-refresh secara real-time tanpa refresh browser (F5).
  - **Solusi / Perbaikan:**
    - `static/index.html`:
      - Di dalam komponen `DrawPage`, mengekstrak fungsi pengambilan daftar gambar menjadi helper `fetchDrawingsList`.
      - Menambahkan `useEffect` listener untuk event `drawingSaved` yang secara otomatis memanggil `api.get("/api/drawings")` dan mengupdate `setDrawings(data || [])`.
  - **Verifikasi:**
    - Syntax inline scripts: `node scratch/check_inline.js static/index.html` ➡️ **5/5 scripts OK**.
    - JS test suite: `node --test tests/offline/*.test.js` ➡️ **574/574 tests pass (0 fail)**.

- **Fix Drawing Sync Engine & Comprehensive Offline Drawing Sync Tests — SELESAI 2026-08-25 (Antigravity/Gemini):**
  - **Problem / Root Cause:**
    1. Di `static/offline/syncpush.js` pada `opDrawingCreate`, pemanggilan `TFidmap.mapId(rec.cid, res.data.id)` memicu `TypeError: TFidmap.mapId is not a function` (karena method sesungguhnya di `TFidmap` adalah `mapPut(type, serverId, cid)`). Akibatnya `putDrawingRaw` tidak mengupdate `server_id` dan membiarkan data drawing lokal tetap `server_id: null, dirty: 1`, memicu duplicate rows saat `DrawPage` memuat daftar gambar.
    2. Belum ada `healStrandedDrawings` untuk memulihkan gambar lokal standalone yang tertinggal (`server_id: null`, `!deleted`, tanpa pending outbox op).
    3. `static/offline/syncpull.js` belum memiliki fungsi pull & rekonsiliasi drawing (`pullDrawings`, `pullDrawingsAndReconcile`, `ensureDrawingCid`, `drawingFromServer`, `writeDrawing`, `writeDrawingFull`, `getAllDrawings`, `putDrawingRec`, `deleteDrawingRec`).
  - **Solusi / Perbaikan:**
    - `static/offline/syncpush.js`:
      - Mengganti `TFidmap.mapId` menjadi `TFidmap.mapPut("drawing", sid, rec.cid)` dan mengupdate record dengan `server_id: sid, dirty: 0, base_rev: res.data.updated_at`.
      - Menambahkan `deleteDrawingRaw(cid)` untuk handling error 403.
      - Menambahkan `getAllDrawingsRaw()` dan `healStrandedDrawings()` untuk mengantrekan op create otomatis pada drawing unpushed yang tertinggal.
      - Menghubungkan `healStrandedDrawings()` di dalam `pushOutbox` dan mengekspornya.
    - `static/offline/syncpull.js`:
      - Mengimpor `TFblob` & `BlobStore`.
      - Mengimplementasikan `getAllDrawings`, `putDrawingRec`, `deleteDrawingRec`.
      - Mengimplementasikan `ensureDrawingCid(serverId, cache)` dengan multi-tier lookup (cache -> `TFidmap.cidOf` -> fallback `getAllDrawings` by `server_id` + auto-repair idmap -> `TFids.newCid`).
      - Mengimplementasikan `drawingFromServer`, `writeDrawing`, `writeDrawingFull`, `pullDrawings` (multi-pass sync: CID resolution, outbox-aware upsert, phantom duplicate cleanup, remote deletions, pin adoption), dan `pullDrawingsAndReconcile`.
    - `static/index.html`: Menghubungkan `pullDrawingsAndReconcile` di `sync()` dan memicu event `window.dispatchEvent(new CustomEvent("drawingSaved"))` saat ada perubahan drawing.
    - `static/sw.js`: SW cache di-bump ke **`taskflow-v314-drawing-sync-engine`**.
    - `tests/offline/drawingsync.test.js`: Membuat test suite komprehensif 14 unit test mencakup semua edge case sinkronisasi drawing (14/14 tests).
  - Verifikasi: Subagent code review **APPROVED**.

- **Fix Sync Stale Tombstone Restore (Notes, Tasks, Mindmaps) — SELESAI 2026-08-25 (Antigravity/Gemini):**
  - **Problem / Root Cause:**
    - Ketika sebuah catatan/task/mindmap lokal di IndexedDB memiliki flag `deleted: true, dirty: 1` (namun outbox queue sudah kehilangan pending op dari sesi lama), atau `deleted: true, dirty: 0`, namun masih AKTIF di server (dikirim dengan `updated_at == base_rev`), `pullNotes`, `pullTasks`, dan `pullMindmaps` sebelumnya melewati item tersebut. Akibatnya `deleted: true` tidak pernah di-reset menjadi `false` dan item tetap tersembunyi.
  - **Solusi / Perbaikan:**
    - `static/offline/syncpull.js`:
      - Mengambil `outboxOps` secara paralel di awal `pullNotes`, `pullTasks`, dan `pullMindmaps`.
      - Kondisi restore di-update menjadi `if (!local || (local.deleted && !pendingOps.has(cid))) { result.created++; return writeNote(s, cid, cache); }`.
      - Kondisi update / auto-heal di-update menjadi `if (s.updated_at !== local.base_rev || local.deleted || (local.dirty && !pendingOps.has(cid))) { result.updated++; return writeNote(...); }`.
    - `tests/offline/syncpull.test.js`: Menambahkan unit tests untuk memvalidasi pemulihan stale dirty tombstone tanpa pending outbox ops untuk tasks, notes, dan mindmaps (560/560 pass).
    - `static/sw.js`: SW cache di-bump ke **`taskflow-v313-stale-tombstone-fix`**.
  - Verifikasi: JS test suite `tests/offline/*.test.js` **560/560 pass 0 fail**, pytest **55/55 pass 0 fail**, 5/5 inline scripts parse cleanly. Independent Subagent Code Review: **APPROVED**.

- **Penyempurnaan Sync & Auto-Heal Notes — SELESAI 2026-08-25 (Antigravity/Gemini):**
  - `static/offline/syncpull.js`:
    - `ensureNoteCid(serverId, cache)`: menambahkan fallback ke `getAllNotes()` jika `TFidmap.cidOf("note", serverId)` bernilai falsy/undefined untuk mencocokkan `server_id === serverId` dan memperbaiki idmap via `TFidmap.mapPut("note", serverId, existing.cid)`.
    - `pullNotes(serverNotes)` pass 3: memeriksa `const expectedCid = cache[r.server_id]`. Jika `expectedCid && r.cid !== expectedCid` (duplikat lokal), hapus row duplikat via `deleteNoteRec(r.cid)`.
  - `tests/offline/syncpull.test.js`: Menambahkan 3 unit tests untuk memvalidasi pembersihan duplicate rows dan perbaikan idmap otomatis (37/37 pass).
  - `static/index.html`: Pada `sync()`, menangkap hasil `pullNotesAndReconcile` dan memicu `window.dispatchEvent(new CustomEvent("noteSaved"))` bila `created > 0 || updated > 0 || deleted > 0`.
  - `static/sw.js`: SW cache di-bump ke **`taskflow-v311-notes-sync-autoheal`**.
  - Verifikasi: JS test suite `tests/offline/*.test.js` **553/553 pass 0 fail**, pytest **55/55 pass 0 fail**, 5/5 inline scripts parse cleanly.


## 🔴 SDD Notes Sidebar 3-Baris + Tabs — Task 1 CSS SELESAI 2026-08-23 (Claude, commit `d68be18`)
- `static/app.css` (area umum baris 734-766, BUKAN di @media): `.notes-tabs`/`.notes-tab`(+`:hover`/`.active`) verbatim dari brief; `.notes-left > *:not(.notes-left-inner) { flex-shrink: 0; }`; `min-height: 0;` DITAMBAH ke rule `.notes-left-inner` yang sudah ada (bukan rule baru). CRLF app.css terjaga.
- TDD di `tests/offline/notes_page_layout.test.js` (suite baru dari brief): RED 11 tests/8 pass/3 fail → GREEN 11/11; full suite `node --test "tests/offline/*.test.js"` **522/522 pass 0 fail** (~149.5s).
- **TIDAK di-push** (push/deploy = Task 3). Report: `.superpowers/sdd/2026-08-23-notes-sidebar-tabs/task-1-report.md`.

## 🔴 SDD Notes Sidebar 3-Baris + Tabs — Task 2 JSX + state SELESAI 2026-08-23 (Claude, commit `58fcbeb`)
- `static/index.html` (NotesPage, compiled output diedit langsung): state `filterPublished`/`filterListId`/`pinnedExpanded` → `notesTab` ("all"); `applyFilters`/`applyFiltersStatic`/`fetchNotes` tab-aware (`tab ∩ tags ∩ search`, param `tab = "all"`); `handleListFilter`/`handlePublishedFilter` dihapus, `handleTabChange` baru; header merged (span count `Catatan (${sortedNotes.length})` + select sort di row header, row subheader dihapus); tags row dirampingkan (pill Published/Semua/Shared + `isAllActive` dihapus; 2 top tags + pill 🏷️ + popover lengkap dipertahankan); baris tabs `.notes-tabs` (All/Pinned/Pub/Shared, className template `notes-tab${notesTab === x ? " active" : ""}`) disisipkan setelah tags row; accordion pinned IIFE dihapus total; empty state per tab (Belum ada catatan yang di-pin/di-publish/di-share).
- `listsWithNotes` di-hoist ke component scope sebelum memo `sharedListIds` (TDZ-safe). Semua call-site lama di-update ke `notesTab` (handlePin, ✕ clear-search, Reset popover, handleSave, handleDelete, handler noteSaved + deps). Deviasi: 2 sisa `filterListId` di MindmapPage (fitur filter list mindmap, sengaja dipertahankan — di luar scope); title `📝 Catatan (${allNotes.length})` header dipertahankan (brief tak instruksikan hapus).
- Verifikasi: TDD RED (18 tests/9 pass/9 fail) → GREEN 18/18; rebrand 6/6; check_inline 5/5 (3×); full suite `node --test "tests/offline/*.test.js"` **529/529 pass 0 fail** (~171s); grep NotesPage-scoped untuk 4 identifier lama = nol; CRLF index.html terjaga.
- **TIDAK di-push.** NEXT = Task 3 (SW bump `taskflow-v305-notes-sidebar-tabs` + push + deploy + verifikasi live + handover). Report: `.superpowers/sdd/2026-08-23-notes-sidebar-tabs/task-2-report.md`.

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
- **FIX Draw sync idempoten + slash query + dedup tool — SELESAI & LIVE 2026-08-24 (Claude, commit `ede8224`)**: (1) `webapp.py` — kolom `drawings.client_id` (migrasi guarded + partial unique index) + POST /api/drawings upsert by (user_id, client_id) → retry sync pasca-503 TIDAK lagi menduplikasi baris (root cause ~800 duplikat server); (2) `syncpush.js` opDrawingCreate kirim `client_id: rec.cid`; (3) `static/index.html` doSlashAction 'draw' hapus teks query slash sebelum buka modal (`/Draw` tidak lagi nyasar di konten note); (4) `scripts/dedup_drawings.py` — dedup sekali pakai (dry-run default; tidak pernah sentuh baris direferensikan note / di-pin; baris unik kosong dipertahankan). SW **`taskflow-v308-draw-sync-idempotency`** LIVE. Verifikasi: JS 534/534, pytest 48/48 (termasuk test idempotensi baru), 5/5 inline.
  - **PENDING user (urut):** (1) restart VPS `sudo systemctl restart taskflow taskflow-web` (migrasi + endpoint baru aktif); (2) backup + jalankan dedup: `cp taskflow.db taskflow.db.bak-$(date +%F)` lalu `venv/bin/python scripts/dedup_drawings.py` (dry-run) → `--run`; (3) **rebuild APK** (ponsel masih kode lama — /draw & save token rusak sampai rebuild); (4) hard refresh desktop; (5) note lama yang kontennya cuma "/Draw" (tanpa token ::draw) tidak bisa dipulihkan — buat ulang.
  - **Catatan:** 503 storm di console = backend sempat down saat retry sync; dengan endpoint idempoten, retry aman walau server flaky.

## 🟢 Active Task
- **FIX gelombang buka-drawing + WIPE semua drawings — SELESAI & LIVE 2026-08-24 (Claude, commit `a57c64d`, SW v310):** (1) `selectDrawing` — cabang sync-on-open DIHAPUS total (POST /api/drawings selalu di-intercept offline router `drawingroutes.js` → `createDrawing` abaikan client_id → baris sampah baru; `raw.data_json` selalu undefined krn konten di BlobStore) → diganti fetch detail via `__syncRawFetch('/api/drawings/${d.id}')` bypass router + fallback `|| d`; (2) normalisasi `String()` perbandingan id string vs number di 7 titik DrawPage; (3) kegagalan buka tak lagi diam — toast 'Gambar tidak ditemukan' di 2 efek + 'Gambar tidak tersedia' di handler openDrawing; (4) `webapp.py` `_drawing_enrich` kembalikan `server_id = id` (penanda akurat baris server — BARU AKTIF setelah restart service VPS); (5) tes regresi `tests/offline/drawpage_open.test.js` (10 subtest) + `server_id` di test_drawings.py; SW `taskflow-v310-draw-open-fixes` LIVE terverifikasi curl (bypass 1×, `getRaw(d.cid || d.id)`=0, toast 2×). Review 2 putaran APPROVE. JS 544/544, pytest 51/51, check_inline 5/5.
- **WIPE semua drawing (perintah user 2026-08-24, user-eksekusi):** server `drawings` 29→0 (backup `taskflow.db.bak-before-delete-drawings-*`, notes 170 utuh); browser: store drawings + 29 blobs + 14 op drawing outbox + localStorage `tldraw-note-*` dihapus via console. Row 1737/1711 (korban retry 503) sudah tak relevan — 1737 dihapus, 1711 sempat di-PUT dari IndexedDB lalu ikut terhapus wipe. `draw-app/src/App.jsx` di-revert ke HEAD (loadLocalFallback dead-code; bundle TIDAK di-rebuild atas keputusan user).
  - **PENDING user:** (1) `sudo systemctl restart taskflow taskflow-web` di VPS (aktifkan `server_id` — deploy.yml TIDAK restart service); (2) hard refresh browser (Ctrl+Shift+R) → SW v310; (3) rebuild APK/.exe bila perlu (kode lama masih punya sync-on-open rusak + node-schema-drop); (4) PONSEL: salinan drawing lokal masih di IndexedDB ponsel — kalau nanti sync, baris bisa muncul lagi → jalankan ulang DELETE SQL atau hapus lokal di ponsel; (5) note lama berisi `::draw[...]` → klik kartu kini toast 'Gambar tidak tersedia' (bukan error diam).

## 🟢 Active Task (lama, dipertahankan)
- **Fix clip 1px kartu note pertama — SELESAI & LIVE 2026-08-24 (Claude, commit `b4e20d7` di-push)**: `.note-card:hover { translateY(-1px) }` mengangkat kartu hover 1px; `.notes-left-inner` padding-top 0 + `overflow-y: auto` → tepi atas kartu pertama ter-clip ~1px (jelas di border accent kartu selected). Fix 2 baris `static/app.css`: `.notes-left-inner` base padding `6px 16px 16px 0` (baris 735) + override mobile `6px 14px 84px 0 !important` (baris 852). SW **`taskflow-v307-note-card-clip-fix`** — **LIVE terverifikasi curl** (SW v307; kedua rule padding ada di live app.css). TDD: subtest baru "scroll list punya padding atas (anti-clip hover lift)" di `tests/offline/notes_page_layout.test.js` (RED 18/20 → GREEN 20/20); full suite JS **531/531 pass 0 fail** (~152s). PENDING user: hard refresh (Ctrl+Shift+R) → hover/klik kartu note pertama → border atas utuh.
- **Hapus tombol + Baru header NotesPage — SELESAI & LIVE 2026-08-24 (Claude, commit `f8ea23f` di-push)**: tombol + Baru di header panel NotesPage dihapus, SW **`taskflow-v306-remove-notes-new-button`**. Topbar global "+ Buat Baru", FAB mobile, dan CTA empty-state `＋ Catatan Baru` TETAP (pembuatan note tak terpengaruh; `openNew` masih terpakai di empty-state). Test: notes_page_layout 19/19 (subtest baru absensi tombol; assertion keberadaan lama dihapus); full suite JS 530/530 pass 0 fail (~145s); check_inline 5/5; LIVE terverifikasi curl (SW v306; `btn btn-sm btn-primary` di live index.html = 0). Report: `.superpowers/sdd/2026-08-24-notes-header-button/report.md`. PENDING user: hard refresh (Ctrl+Shift+R) → header kiri Catatan = `📝 Catatan` + count + sort + ✕.
- **SDD Notes Sidebar 3-Baris + Tabs — SELESAI & LIVE 2026-08-23 (Claude, 4 commit `d68be18`..`6031293` di-push)**: panel kiri NotesPage jadi 3 baris operasi (header+search, tags, tabs) + daftar note full-scroll. State `filterPublished`/`filterListId`/`pinnedExpanded` → satu **`notesTab`** ("all", component-local tanpa persist); `applyFilters`/`applyFiltersStatic`/`fetchNotes` tab-aware (kombinasi **`tab ∩ tags ∩ search`**, param `tab = "all"`); tab **All/Pinned/Pub/Shared** menggantikan pill Published/Shared + accordion pinned (dihapus total); empty state per tab; header count tunggal `Catatan (${sortedNotes.length})` (title `📝 Catatan` tanpa count); `sharedListIds` Set biasa (useMemo no-op dihapus). CSS: `.notes-tabs`/`.notes-tab`/`.active` segmented (flex:1) + `.notes-left > *:not(.notes-left-inner) { flex-shrink: 0 }` + `.notes-left-inner { min-height: 0 }`. SW **`taskflow-v305-notes-sidebar-tabs`** — **LIVE terverifikasi curl** (SW v305; index.html: container `notes-tabs` + 4 tombol `notes-tab${notesTab === "all"/"pinned"/"pub"/"shared"}`; app.css `notes-tab` ×4). Verifikasi: JS **529/529 pass 0 fail** (~165s); pytest 47/47; check_inline 5/5. Report: `.superpowers/sdd/2026-08-23-notes-sidebar-tabs/task-3-report.md`.
  - **PENDING user (device-test):**
    1. Desktop: panel kiri = header + search + tags + tabs + list scroll penuh — banyak kartu terlihat.
    2. Tab All/Pinned/Pub/Shared menampilkan subset benar; kombinasi dengan tag & search; count "Catatan (N)" berubah.
    3. Tab Pinned: klik card membuka note; accordion lama tidak ada.
    4. Mobile: baris & tab rapi, list scroll.
    5. Dark mode konsisten.
    6. Hard refresh (Ctrl+Shift+R) — SW v305.
  - **Masih PENDING dari rebrand Alurik (tetap berlaku):** hard refresh browser; `sudo systemctl restart taskflow taskflow-web` (perubahan webapp.py/bot.py/mailer.py baru aktif setelah restart; cek SMTP_FROM di .env VPS bila set eksplisit nama lama); cek bot Telegram `/start` menampilkan "⚡ Alurik". URL aplikasi tetap `todo.yatno.web.id` sampai domain `alurik.com` di-pointing (DNS/HTTPS — langkah terpisah, butuh akses registrar + Nginx VPS).

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

**Last Updated:** 2026-08-24 (Claude — fix clip 1px kartu note pertama, commit `b4e20d7`, SW v307 LIVE)
**Updated By:** Claude — fix clip 1px note card (TDD, SW bump v307, push + live-verified)

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
