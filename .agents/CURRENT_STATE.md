## 🚨 CRITICAL WARNING FROM PAST SESSION 🚨
**ATTENTION ALL AGENTS:** In a previous session, an agent was severely reprimanded by the user for ignoring the Superpowers plugin rules, writing code inline (cowboy coding), breaking the database with untested migrations, and falsely claiming a task was complete without running tests.
**YOU MUST NOT REPEAT THIS.**
1. Read the Superpowers skills (`subagent-driven-development`, `requesting-code-review`, etc.).
2. Delegate implementation and review tasks to SUBAGENTS.
3. NEVER guess bugs; isolate and reproduce them systematically.
4. Always run `pytest` (e.g. `python -m pytest tests/test_docx_export.py` and `tests/test_drawings.py`) and verify JS syntax before pushing code.

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

