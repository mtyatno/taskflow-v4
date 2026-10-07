## 🚨 CRITICAL WARNING FROM PAST SESSION 🚨
**ATTENTION ALL AGENTS:** In a previous session, an agent was severely reprimanded by the user for ignoring the Superpowers plugin rules, writing code inline (cowboy coding), breaking the database with untested migrations, and falsely claiming a task was complete without running tests.
**YOU MUST NOT REPEAT THIS.**
1. Read the Superpowers skills (`subagent-driven-development`, `requesting-code-review`, etc.).
2. Delegate implementation and review tasks to SUBAGENTS.
3. NEVER guess bugs; isolate and reproduce them systematically.
4. Always run `pytest` (e.g. `python -m pytest tests/test_docx_export.py` and `tests/test_drawings.py`) and verify JS syntax before pushing code.

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

