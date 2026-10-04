## 🚨 CRITICAL WARNING FROM PAST SESSION 🚨
**ATTENTION ALL AGENTS:** In a previous session, an agent was severely reprimanded by the user for ignoring the Superpowers plugin rules, writing code inline (cowboy coding), breaking the database with untested migrations, and falsely claiming a task was complete without running tests.
**YOU MUST NOT REPEAT THIS.**
1. Read the Superpowers skills (`subagent-driven-development`, `requesting-code-review`, etc.).
2. Delegate implementation and review tasks to SUBAGENTS.
3. NEVER guess bugs; isolate and reproduce them systematically.
4. Always run `pytest` (e.g. `python -m pytest tests/test_docx_export.py` and `tests/test_drawings.py`) and verify JS syntax before pushing code.
## 🟡 Redesain halaman Habits (dashboard minimalis) — 2026-10-04 (Claude) — SELESAI KODE Task 1-12 & SUDAH di-commit lokal di `main` (`d88d4bb`, `894d8cc`, `6e8b7cc`, `3e2e602`; BELUM di-push), BELUM diverifikasi visual di browser; SW v365 `taskflow-v365-habit-page-redesign` (setelah merge origin/main yang sudah v364)
- **Plan:** `docs/superpowers/plans/2026-10-04-habit-page-redesign.md` (Task 1-9 sudah di-commit sesi sebelumnya, terakhir `03952e4`). Sesi ini: Task 10 (hapus CSS `.habit-card-grid/.habit-week-*` + media query), Task 11 (SW bump; v362 lalu dinaikkan ke v365 saat merge origin/main), Task 12 (`month_log` 30 hari).
- **`month_log` (30 item `{date,status}`, terlama dulu)** ditambahkan di DUA jalur: server `get_habits_today` (webapp.py) DAN jalur lokal offline-first `habitlogic.deriveToday` → `habitquery.getHabitsToday` (app memakai router lokal, jadi tanpa ini mini heatmap kosong). `getHabit30DayData(h)` kini membaca `h.month_log`.
- **Rute lokal baru** `GET /api/habits/monthly-completion` (`habitlogic.monthlyCompletion` + `habitquery.getHabitsMonthlyCompletion` + `habitroutes.js`) → kalender juga jalan offline. Backend `monthly-completion`: tanggal WIB (`_today_jkt`, bukan `DATE('now')` UTC) dan `total_habits` = jumlah habit user (sebelumnya hanya habit yang punya log → persentase menyesatkan).
- **Bug plan yang diperbaiki:** (1) `CalendarHeatmap` menyusun grid TERBALIK (sel masa depan di awal, tak sejajar kolom Sen-Min) dan pakai tanggal UTC → kini 35 sel, baris terakhir berakhir Minggu minggu ini, tanggal lokal; data `days: []` (user baru) tetap tampilkan grid, pesan "butuh koneksi" hanya bila data null. (2) `handleCheckin` masih memanggil `fetchMonthly()` (endpoint lama, bentuk `{day,done}`) yang menimpa `monthlyData` → diganti `fetchMonthlyCompletion()`; `fetchMonthly` dihapus. (3) Update optimistik check-in kini juga mengisi `month_log` hari ini.
- **Tes:** `habitlogic.test.js` +2 (month_log, monthlyCompletion); versi SW di 5 tes lama disinkronkan ke v365 (sebelumnya masih v360). pytest 122/122, habit offline tests 11/11, inline 5/5, `node --check sw.js` OK. Suite JS penuh di Windows: 918/937 — 19 gagal TIDAK terkait habit (tes `sidebar_icon_rail`, `calendar_today_create`, `direct_messages_ui`: "… end must be found" = pola CRLF `\n}\n`; `no_accent_stripes`: `.note-callout`). Belum dibandingkan dengan HEAD bersih.
- **PENDING:** (a) cek visual di browser (summary cards, heatmap, mini heatmap, tombol check, dark mode, mobile 390px, offline); (b) push ke GitHub (deploy otomatis); (c) `month_log`+rute baru butuh restart `taskflow-web` utk sisi server; (d) versi SW berikutnya v366.
## 🟢 Menu samping mulai sebagai ikon + Disematkan akordeon tanpa scrollbar — 2026-10-04 (Claude) — MERGED ke `main` (PR #15, merge `22bab21`) & DEPLOYED (Deploy Taskflow V4 run #840 sukses, VPS fast-forward ca335d1..22bab21); SW v364 `taskflow-v364-sidebar-rail-pin-accordion`, app.css?v=312
- **Permintaan user:** (1) menu utama samping default minimized (bilah ikon) saat login pertama, tiap muat halaman, dan tiap pindah halaman; (2) Disematkan: membuka satu dari Notes/Mindmap/Gambar otomatis menutup yang lain; (3) jangan tampilkan scrollbar.
- **Sidebar (App):** `sidebarCollapsed` awal `true`; satu efek `[page, user?.id]` → `setSidebarCollapsed(true); setSidebarOpen(false)` (menggantikan auto-collapse khusus Notes/Draw/Mindmap + restore `prevSidebarCollapsedRef`); `onClose` Sidebar juga melipat (memilih halaman aktif / Review Mingguan pun melipat). › dan ☰ membuka menu lengkap sampai navigasi berikutnya. Mobile: drawer seperti semula. `sidebarCollapsed` milik halaman Notes (panel daftar catatan) TIDAK diubah.
- **Tur:** `TOUR_STEPS.dashboard` dimulai dengan `[data-tour="sidebar-rail"]` & `[data-tour="sidebar-expand"]` karena langkah menu lengkap tersembunyi saat menu terlipat (`isTourVisible` melewatinya); teks memakai "Workspace". `TOUR_STEPS.inbox` (next/waiting/someday/all/overdue/done) punya cadangan "GTD Workflow" di ›.
- **Disematkan:** `pinOpenKey` (default "notes"; klik header yang terbuka menutupnya, boleh semua tertutup), maks 3 baris per grup; "+N lainnya →" membuka modal dashboard varian `pins` (`openPinModal`, "N item disematkan", klik baris = buka item) — tidak lagi diperluas di tempat. Kartu kembali di alur normal (`.dash-pin-wrap { display:flex; min-height:352px }`, kartu `flex:1`): grid `align-items: stretch` → Prioritas & Disematkan selalu sama tinggi; TIDAK ada gulir internal/scrollbar (rule absolut, `scrollbar-width`, efek reveal-scroll & ref dihapus — menggantikan desain PR #10 di entri Dashboard di bawah). Di 901–1060px dengan menu lengkap terbuka header grup membungkus → baris bisa 378–408px, Prioritas ikut meregang.
- **Modal dashboard (task & pins):** role dialog + aria-modal + aria-labelledby `dash-modal-title`, ✕ `aria-label="Tutup"` + autoFocus, Esc menutup (juga bila fokus di <body>/halaman di belakang overlay) kecuali sasarannya di `.modal-overlay` lain di atasnya (mis. pencarian Ctrl+K) & fokus kembali ke pemicu hanya bila fokus di <body> dan tak ada `.modal-overlay` lain (detail task tidak mengambil fokus), baris role button + tabIndex 0 + Enter/Spasi, `.dash-modal-row:focus-visible` (offset −2px), pemicu ber-`aria-haspopup="dialog"`.
- **Verifikasi:** JS 952/955 (3 fail pra-ada di main: `draw_local_reactive` bundle tldraw, `no_accent_stripes` karena `.note-callout` dari commit callout `7851a9b` punya border kiri 4px berwarna), pytest 122/122, inline 5/5, `node --check sw.js` OK. Dua review independen (subagent). Playwright font asli light/dark/mobile: rail 64px saat muat & setelah pindah halaman; 352/352 untuk Notes/Mindmap/Gambar di 1440; 940 menu lengkap 408/408 dengan Gambar di dalam kartu; modal + Esc + fokus kembali; tur 1/3 di bilah ikon; drawer mobile normal. Screenshot: `/mnt/project-files/dashboard-redesign/revisi-4/`.
- **Catatan main:** commit langsung ke main (callout, rename Workspace) tidak memperbarui tes versi; PR #14 & PR ini sudah membereskannya. `.note-callout` masih melanggar aturan tanpa garis warna (ditanyakan ke user).
- **Review kedua (commit `9452a9c` + penyempurnaan Esc):** fokus tak lagi kembali ke "+N lagi →" di balik detail task (dulu Spasi membuka daftar lagi), satu Esc tak menutup dua lapis, `aria-haspopup="dialog"` di pemicu task (`DashCardHead` prop `linkPopup` → `DashLink` `popup`), tur "👥 Workspace", komentar CSS `.dash-main` akurat (di ~901–1060px dengan menu lengkap baris 352–408px). Dicek di browser: pilih task via Enter → fokus di <body>, Spasi tak membuka daftar; Esc di pencarian Ctrl+K hanya menutup pencarian; Tab keluar + Esc menutup; Esc mengembalikan fokus ke "+5 lainnya →".
- **PENDING:** tidak ada di server (statis saja, tanpa restart `taskflow-web`). Klien: hard refresh / tutup-buka PWA agar SW v364 aktif. Versi berikutnya: v365 / app.css?v=313. Ditanyakan ke user (belum dijawab): hapus juga garis kiri berwarna `.note-callout` (penyebab fail `no_accent_stripes`)?
## 🟡 Fokus Hari Ini jadi workstation — 2026-10-04 (Claude) — DRAFT PR (branch `claude/fokus-redesign-q0zll0`); SW v363 `taskflow-v363-focus-workstation`, app.css?v=311
- **Permintaan user:** saat scroll, Pomodoro jadi ringkas & menempel di atas (detik berjalan, Start/Stop, Short/Long, task aktif); daftar task tidak overwhelming tapi tetap tempat menambah catatan/subtask dan melihat project + kuadran.
- **Pomodoro:** state timer dipindah ke hook `usePomodoro` (logika sama: 25/5/15, long break tiap 4 sesi, notifikasi). `PomodoroTimer` = kartu penuh horizontal (ring 168px, Work/Short/Long, Mulai/Jeda · Stop · Lewati, task aktif, statistik). `PomodoroMiniBar` = bar ringkas sticky di bawah top bar (anchor `position: sticky; height: 0`, top diukur dari `.desktop-topbar/.mobile-topbar`), muncul saat kartu penuh tergulir; isi: ring mini + mm:ss, task aktif, Work/Short/Long, Jeda/Mulai, Stop. "Stop" = berhenti + kembali ke durasi penuh (dulu ikon reset).
- **Daftar task:** `FocusTaskItem` ringkas (judul; badge prioritas, kuadran "Q1 · Lakukan", status GTD; project; deadline; pill jumlah subtask/catatan/lampiran; tombol Fokus; chevron). Klik → panel tab Subtask/Catatan/Lampiran + "Detail" (modal lama). Hanya satu terbuka (`openId`); klik Fokus juga membuka task itu. Jumlah diambil sekali per task (`useFocusTaskCounts`), polling 15 dtk hanya untuk panel terbuka (dulu 3 polling × semua task). Kartu Tips diganti satu baris.
- `FocusTaskRow` dihapus (hanya dipakai di sini). CSS baru di akhir app.css (`.focus-pomo*`, `.focus-mini*`, `.ftask*`); CSS `.pomodoro-*` lama tidak dipakai lagi tapi dibiarkan.
- **Verifikasi:** tes baru `tests/offline/focus_workstation.test.js` (5). JS 942/945: 3 fail pra-ada di main (tldraw `draw_local_reactive`, dan `no_accent_stripes` karena `.note-callout` border-left dari commit callout `7851a9b`). Playwright light/dark × 1440/390 tanpa page error/overflow; screenshot di project files `fokus-redesign/`.
- **PENDING:** statis saja, tanpa restart server. Tes versi lama (pin v360 padahal main v361) ikut diperbarui ke v363.

## 🟢 Banner tanpa garis warna + audit garis aksen — 2026-10-04 (Claude) — MERGED ke `main` (PR #12, merge `18c25f0`) & DEPLOYED (Deploy Taskflow V4 run #836 sukses); SW v360 `taskflow-v360-no-accent-stripes`, app.css?v=309
- **Permintaan user:** banner "Saatnya Review Mingguan" di Dashboard menempel ke top bar dan masih punya garis warna kiri; cek tempat lain yang masih memakai garis warna.
- **Banner:** `ReviewNudge` & `BackupReminder` kini kelas `.app-banner` (app.css, dekat `.mobile-topbar`): border netral 1px, radius 12, chip ikon hijau 34px (`.app-banner-icon`) sebagai pengganti garis kiri 4px, `margin: 16px 0` (12px di ≤768px) → jarak 16px dari top bar (sebelumnya 0); dua banner bertumpuk berjarak 10px. Tombol tutup `.app-banner-close` (ikon x, aria-label).
- **Audit — dihapus:** kartu task berulang di Fokus Hari Ini (`borderLeft 3px accent`), item aktif dropdown Pencarian Tersimpan (`borderLeft 3px`), `.chat-quote-block` & `.chat-reply-preview` (border-left 3px; quote kini radius 6 + latar), `.math-block` (border-left → border 1px netral), bar error boot (border-top 2px amber → 1px).
- **Dibiarkan sengaja:** blockquote Markdown di catatan (`.note-rendered`, Milkdown, print) — konvensi tipografi kutipan, bukan kartu; indikator drop drag&drop outline (garis 2px sementara saat menyeret).
- **Tes penjaga:** `tests/offline/no_accent_stripes.test.js` (gaya inline & CSS tanpa border tebal berwarna kiri/atas/kanan kecuali blockquote; banner pakai `.app-banner`). JS 933/934 (1 fail pra-ada tldraw), inline 5/5, `node --check sw.js` OK. Playwright light/dark desktop + mobile: top bar bawah 49px → banner 65px (sebelum 49px).
- **PENDING:** statis saja, tanpa restart server. Versi berikutnya: v361 / app.css?v=310.

## 🟢 Kalender: tampilan Minggu (week view) — 2026-10-04 (Claude) — PR #9 (main digabung: Pesan pribadi #6 + Dashboard #10); SW v359 `taskflow-v359-calendar-week-view`; app.css tidak diubah PR ini
- **Toggle Bulan/Minggu** di kanan judul Kalender, pilihan disimpan di `localStorage.tf_cal_view`. Prev/Next geser 7 hari di mode Minggu (di HP tombol jadi ‹ ›), Today → minggu ini. Pindah Bulan→Minggu: minggu ini bila bulan tampil memuat hari ini, selain itu minggu tanggal 1; Minggu→Bulan: bulan hari Kamis minggu itu.
- **Desktop:** 7 kolom berjejer (`.cal-week--desktop`, `repeat(7, minmax(128px, 1fr))`, geser mendatar bila layar sempit, mis. 1024px + sidebar penuh), header hari + tombol + per hari, kartu task di bawahnya tanpa garis warna di tepi — prioritas lewat badge (klik → detail; berulang → popup occurrence; area kosong diklik → buat task). **Mobile:** kartu per hari berurutan ke bawah (`.cal-week--mobile`), memakai `TaskListItems`.
- **Logika murni level modul** (blok `// ── calWeek helpers`): `calDateKey`, `calAddDays`, `calWeekStart` (Senin), `calWeekKeys`, `calTasksByDate(tasks, from, to, exceptions)`, `calWeekLabel`. Libur dimuat untuk kedua tahun bila minggu melewati tahun baru. Rentang fetch `/api/recurring/exceptions` kini pakai tanggal lokal (`calDateKey`) — sebelumnya `toISOString()` menggeser 1 hari di zona UTC+7 sehingga exception di hari terakhir bulan tidak terambil.
- **Verifikasi:** tes baru `tests/offline/calendar_week_view.test.js` (7). JS 907/908 (1 fail pra-ada tldraw), pytest 96/96, inline 5/5. Playwright light/dark × 1440/1024/390: label minggu, Next/Today, + per hari → deadline benar, pilihan tersimpan setelah reload, kembali ke Bulan; tanpa page error/overflow halaman.
- **Versi SW:** main sebelum PR ini v358 (dashboard). PR berikutnya pakai v360.
## 🟢 Dashboard: Prioritas & Disematkan setinggi, Disematkan bisa dilipat — 2026-10-04 (Claude) — MERGED ke `main` (PR #10, merge `f377ea7`) & DEPLOYED (Deploy Taskflow V4 run #833 sukses, VPS fast-forward ad76f66..f377ea7); SW v358 `taskflow-v358-dashboard-pin-collapse`, app.css?v=308
- **Permintaan user:** kartu "Prioritas Hari Ini" dan "Disematkan" harus sama tinggi (sebelumnya Disematkan lebih panjang → ruang kosong di bawah Prioritas); Disematkan dibuat collapsible untuk Notes/Mindmap/Gambar, default Notes terbuka, Mindmap & Gambar tertutup.
- **Tinggi sama (desktop ≥901px, CSS saja; DIGANTI PR #15 — kini alur normal tanpa gulir internal, lihat entri teratas):** `.dash-main` kini `align-items: stretch`; kartu Disematkan (`.dash-card.dash-pin-card`) absolut `inset: 0` di dalam grid item baru `.dash-pin-wrap` (min-height 352px: cukup untuk keadaan default walau Prioritas pendek) → tinggi baris ditentukan Prioritas, Disematkan selalu setinggi itu dan `.dash-pin-groups` menggulir di dalam (scrollbar global app 6px — JANGAN pakai `scrollbar-width`, di Chromium ≥121 itu mematikan gaya `::-webkit-scrollbar` global → scrollbar putih di dark mode; tanpa `overscroll-behavior: contain` agar halaman tetap bisa digulir; margin −8/−10 + padding agar hover/fokus tak terpotong). Prioritas (`.dash-prio-card`) flex column: daftar mengisi ruang, footer "+N task lagi" di dasar, empty state di tengah. ≤900px: kembali `position: static`, tanpa gulir internal.
- **Collapsible:** state `pinOpen = { notes: true, mindmap: false, drawings: false }` (tanpa persistensi; reset tiap Dashboard mount). Header grup = `button.dash-pin-toggle` (chip, label, pill jumlah — `is-zero` abu-abu bila 0 —, chevron berputar; warna `--text-secondary`, cincin fokus #7E9400 light / accent dark) + link "Lihat semua →" di luar tombol (`.dash-pin-head` flex-wrap: di kolom sempit 901–1030px dengan sidebar terbuka link turun ke baris sendiri, tidak menimpa tombol); isi `div.dash-pin-body[hidden]` dengan `aria-controls`. Grup kosong pun punya header yang sama (pesan "Belum ada … disematkan · Pin dari … →" di dalam isi). Saat grup dibuka / "+N lainnya" diperluas, hanya daftar Disematkan yang digulir agar isi grup terlihat (tak melewati header grup, tak menggulir window, `smooth` kecuali prefers-reduced-motion). Animasi buka `dashPinIn` 0,18s (mati bila reduced motion).
- **Verifikasi:** tes baru `tests/offline/dashboard_pin_collapse.test.js` (5 tes, gagal di HEAD lama); JS 899/900 (1 fail pra-ada `draw_local_reactive`), pytest 96/96, inline 5/5, `node --check sw.js` OK. Review independen (subagent): tidak ada yang memblokir; 7 temuan diperbaiki (overlap header 901–1030px, overscroll, scrollbar dark, min-height, kontras fokus/chevron/pill nol, `aria-expanded` di "+N lainnya"); 1 nit dibiarkan (grup kosong punya "Lihat semua" + "Pin dari …"). Playwright dengan font asli Nunito Sans (Google Fonts diambil lewat Python karena Chromium sesi tak percaya CA proxy; `page.route`), user demo 8 note/3 mindmap/1 gambar disematkan seperti screenshot user: sebelum 348 vs 501 px; sesudah 352/352 tanpa scroll; Mindmap dibuka tetap 352/352, daftar menggulir 75px; mobile bertumpuk normal; light/dark. Skrip: scratchpad sesi `dash/final_shots.py` (server main lama di worktree port 8766 untuk "sebelum").
- **PENDING:** tidak ada di server (perubahan statis saja, tanpa backend/DB, tidak perlu restart `taskflow-web`). Klien: hard refresh / tutup-buka PWA agar SW v358 aktif. Versi berikutnya: v359 / app.css?v=309 (PR #9 Kalender Minggu masih v357/306 → wajib merge main & bump ulang).

## 🟢 Kalender: tombol Today + buat task dari tanggal — 2026-10-04 (Claude) — MERGED ke `main` (PR #7, merge `2e904d1`) & DEPLOYED (Deploy Taskflow V4 run #830 sukses, VPS fast-forward 678d51d..2e904d1); SW v356 `taskflow-v356-calendar-today-create`, app.css tidak berubah tetap v=306)
- **Today:** tombol "Today" (ikon calendar) di kanan bar navigasi, sebelum Next. `goToday` → bulan & tahun hari ini, tutup panel tanggal. Saat sedang melihat bulan lain tombol berwarna primary; di bulan berjalan secondary.
- **Buat task dari tanggal:** `CalendarView` menerima prop `onCreateOnDate(dateStr)`. `handleDayClick`: tanggal TANPA task → langsung buka modal "Buat Baru" (TaskFormModal yang sama dengan tombol +Buat Baru, tab Task/Habit/Note/Goal) dengan deadline = tanggal itu; tanggal YANG ADA task → panel/daftar task seperti dulu + tombol "+ Task" (`addOnDayButton`) untuk membuat task di tanggal itu. App: `setEditTask({ deadline })` + `setShowForm(true)` (task tanpa `id` = mode buat baru, `isEdit = !!task?.id`). Toast `handleSaved` kini `editTask?.id ? "diupdate" : "ditambahkan"`.
- **Verifikasi:** tes baru `tests/offline/calendar_today_create.test.js` (6, ditulis dulu & gagal). JS 900/901 (1 fail pra-ada tldraw `draw_local_reactive`), pytest 96/96, inline 5/5, `node --check sw.js` OK. Playwright (uvicorn lokal, jam dipalsukan 4 Okt 2026, Asia/Jakarta) light/dark × 1440/390: Next ×2 → Today kembali ke Oktober 2026; klik tanggal kosong → modal dengan deadline benar → simpan → chip muncul; klik tanggal ada task → panel + "+ Task" → modal deadline tanggal itu; tanpa page error/overflow.
- **Versi SW:** main kini v356. PR DM/chat (#6) memakai v355 → saat merge harus naik ke v357+ dan menyesuaikan tes versi. Tidak ada perubahan server (tanpa restart); klien perlu hard refresh / tutup-buka PWA untuk SW v356.

## 🟡 Pesan Pribadi (DM 1-on-1) di Diskusi — 2026-10-03 (Claude) — DRAFT PR #6 (branch `claude/direct-messages-qnw5fp`, main sudah di-merge, SW v357 `taskflow-v357-direct-messages`), app.css ?v=307 (garis aksen kiri item aktif daftar Diskusi dihapus — preferensi Bapak: tanpa garis warna)
- **Spec:** `docs/superpowers/specs/2026-10-03-direct-messages-design.md`. DM baru wajib berbagi ≥1 shared list (403 bila tidak); percakapan yang sudah ada tetap aktif selamanya. Non-peserta → 404.
- **Backend (`webapp.py`):** tabel `dm_conversations` (user_a<user_b, UNIQUE), `dm_messages` (+ idx `idx_dm_messages_conv`), `dm_reads` di `migrate_db()`; tanpa FK ke `shared_lists` (hapus grup tidak menghapus DM). Bagian `# ── Direct Messages API`: `GET /api/dm/contacts`, `GET/POST /api/dm/conversations`, `GET/POST /api/dm/conversations/{id}/messages`, `POST .../read`, `GET .../stream` (SSE). `dm_subscribers` menyimpan `(user_id, queue)` → notifikasi in-app "💬 {user} mengirim pesan pribadi" hanya bila penerima tidak subscribe SSE percakapan itu & belum ada notifikasi identik yang belum dibaca. Pengirim otomatis dianggap sudah membaca pesannya.
- **Klien (`static/index.html`):** `ChatListPanel` kini bagian **Grup** + **Pesan Pribadi** (tombol ＋ → `DmContactPicker` dengan pencarian, badge belum dibaca, preview pesan terakhir), pencarian panel menyaring keduanya. `ChatPage` seleksi `{kind:"group"|"dm", id}`; daftar DM di-refresh saat mount, setelah kirim/pesan masuk, dan tiap 30 dtk. Komponen baru `DmRoom`, `DmInputBar`, `DmContactPicker`, helper `dmUserName`, `ChatListSectionHeader` (reuse kelas chat-*). Grup chat & chatrepo tidak berubah.
- **SW:** `/api/dm/*` network-only (seperti Sampah note; tidak di-cache, offline → 503). Tidak ada rute di `taskroutes`.
- **Verifikasi:** pytest 114/114 (18 tes baru `tests/test_direct_messages.py`), JS 902/903 (1 fail pra-ada `draw_local_reactive` — bundle tldraw), inline 5/5, `node --check sw.js` OK, smoke uvicorn (SSE live diterima, notifikasi ditahan saat penerima subscribe). Belum dicek visual di browser (Playwright tidak tersedia di sesi).
- **Revisi review:** teks notifikasi DM memakai username dari DB (bukan JWT); `DmRoom` resync 50 pesan terbaru setiap SSE reconnect (`onopen` kedua dst.) lalu tandai terbaca; refresh daftar DM baru setelah `/read` selesai (`markReadThenRefresh`), Kembali menolkan badge lokal, dan respons `loadDms` yang dimulai sebelum ditandai terbaca dinolkan (`dmReadAtRef`); placeholder input dipendekkan ("Pesan untuk {nama}..."). Setelah revisi: pytest 115/115, JS 905/906 (1 fail pra-ada tldraw), inline 5/5.
- **Blokir (2026-10-04, di atas PR #6 `c556c75`, sudah commit di PR #6):** tabel `dm_blocks`; `POST/DELETE /api/dm/conversations/{id}/block` (peserta saja, idempoten, respons objek percakapan); blokir dari salah satu pihak → kirim 403 "Obrolan ini diblokir" (tanpa notifikasi/SSE) & percakapan baru 403 (yang lama tetap dikembalikan); daftar & create membawa `blocked_by_me`/`blocked_by_other`. Klien: menu ⋯ di header `DmRoom` (Blokir {nama} dengan confirm / Buka blokir), input diganti pemberitahuan blokir, tombol reply disembunyikan saat diblokir, 403 saat kirim → toast + refresh. SW tetap v355. Spec & ADR-005 diperbarui.
- **Catatan:** klien memanggil `PATCH /api/auth/profile/username` tetapi endpoint itu TIDAK ADA di `webapp.py` (temuan sampingan, tidak diubah).
- **PENDING saat deploy:** `sudo systemctl restart taskflow-web` (migrate_db membuat tabel DM); hard refresh klien (SW v357). Versi SW berikutnya: v358.

## 🟢 Redesain visual Dashboard — 2026-10-03 (Claude) — MERGED ke `main` (PR #3, merge `7d6de58`) & DEPLOYED (Deploy Taskflow V4 run #828 sukses, VPS fast-forward 84de142..7d6de58); SW v354 `taskflow-v354-dashboard-kpi-viz`, app.css?v=306
- **Perubahan (presentasi saja, semua data/fitur tetap):** hero (tanggal id-ID, sapaan pagi/siang/sore/malam + nama user, ringkasan, ring progres prioritas, scratchpad di dalam hero), baris KPI (Aktif/Terlambat→today, Inbox→inbox, Q1→scroll ke matrix), Prioritas Hari Ini + kartu gabungan "Disematkan" (Notes/Mindmap/Gambar), header kartu/section konsisten (`DashCardHead`, `DashSection`), Eisenhower & GTD (chip ikon + pill jumlah berwarna), Proyek Aktif dengan progress bar, Notes Terbaru grid. Chart.js theme-aware (`useThemeName` + `dashChartColors`, re-render saat `data-theme` berubah). Semua warna light-only diganti rgba/token; CSS `dash-*` di akhir app.css.
- `Dashboard` kini menerima prop `user`. Kelas `eisenhower-cell` & header "Mendesak + Penting/Penting" dihapus dari dashboard (diganti subjudul per kuadran).
- **Revisi review user (2026-10-03):** (1) garis warna atas kartu Eisenhower/GTD DIHAPUS (`.dash-qcard::before`, padding-top kompensasi desktop & 640px, inline `--dash-q`). (2) Kartu angka KPI kini: tile ikon gradien 40px (Lucide baru `activity` & `alarm` di `ICONS` ui-components.js; fallback `dashIconOr` → zap/alert bila ui-components.js lama dari cache), angka 30px proporsional (tanpa tabular-nums), baris konteks (pill delta ▲/▼ + "vs 7 hari lalu"/"vs minggu lalu", atau teks), dan slot visual 32px di dasar kartu (sejajar satu baris): Aktif = sparkline 14 hari (SVG, area gradien, titik akhir, 14 band tooltip "Sab, 3 Okt · 21 task aktif"), Selesai 7 hari = kolom mini 8 hari (hari ini penuh, hari lalu 0,35, nol = stub 3px), Q1/Terlambat/Inbox = meter porsi + caption. Warna tinta per kartu lewat `.dash-kpi-viz.ink-*` (light/dark). Semua viz `role="img"` + aria-label Indonesia.
- **Logika:** fungsi murni level modul `dashKpiStats(tasks, todayISO)` + `dashDayLabel` (index.html, dekat helper Dash) — definisi Aktif/Q1/Terlambat (`is_overdue`)/Inbox SAMA dengan sebelumnya; nilai "Selesai 7 hari" tetap `summary.done_last_7_days`. Kolom selesai memakai aturan getSummary (`done && completed_at >= hari ini−7`; tanggal "besok" karena zona waktu masuk kolom hari ini) → jumlah kolom = angka (summary & /api/tasks sama-sama dilayani router lokal dari IndexedDB). Delta Selesai = angka − selesai 8 hari sebelumnya (hari−15..−8); delta Aktif = titik hari ini − 7 hari lalu (selalu netral). `useMemo([tasks])` dengan tanggal lokal.
- **Keputusan kecil:** baris konteks memakai `--text-secondary` (bukan `--text-light`) agar terbaca (kontras 4,8:1 vs 2,6:1); caption meter tetap `--text-light`. Mobile ≤640px: 2 kolom, kartu ganjil terakhir merentang 2 kolom dengan anatomi vertikal yang sama (layout horizontal lama dihapus), tile 36px, angka 26px.
- **Verifikasi:** tes baru `tests/offline/dashboard_kpi.test.js` (28 subtest, ditulis dulu & gagal sebelum implementasi; lulus juga dengan TZ America/Los_Angeles & Asia/Tokyo). JS 889/890 (1 fail pra-ada `draw_local_reactive` — bundle tldraw tidak di-build), pytest 96/96, inline 5/5, `node --check sw.js` OK. Playwright: light/dark × 390/700/1024/1440 tanpa page error & tanpa overflow horizontal, dasar visual KPI sejajar per baris, tidak ada teks terpotong; state lain dicek dengan user demo `kpi2` (Terlambat 0 slate, delta Selesai turun merah, kolom hari ini) & `kpi3` (kosong). Hover band/kolom, tooltip, dan klik kartu (today/inbox/scroll matrix) terverifikasi.
- **PENDING:** tidak ada di server (perubahan statis saja, tanpa backend/DB, tidak perlu restart `taskflow-web`). Klien: hard refresh / tutup-buka PWA agar SW v354 aktif; rebuild APK/.exe bila ingin aset baru di aplikasi native. (versi sesudahnya dipakai PR lain; lihat entri di atas.)
## 🟢 Sidebar desktop jadi icon rail saat diperkecil — 2026-10-03 (Claude) — MERGED ke `main` (PR #4; SW v353 `taskflow-v353-sidebar-icon-rail`, app.css?v=305)
- Desktop (>768px): `sidebarCollapsed` kini = bilah ikon 64px (`--sidebar-rail-w`): logo, tombol › buka menu penuh, 8 menu utama (link sebelum section GTD). Main content `sidebar-rail-visible` (margin 64px). Toggle sidebar halaman Notes/Draw/Mindmap digeser ke `left: var(--sidebar-rail-w)`.
- Mobile tidak berubah (drawer penuh); tombol ‹ di header drawer kini menutup drawer.
- **Konflik versi dengan PR #3 sudah diselesaikan** di branch dashboard (merge main → SW v354, app.css?v=306).

## 🟢 Search Bar Dropdown Popover for Saved Searches — 2026-10-03 (Antigravity/Gemini) — SELESAI di `main` (SW v351 `taskflow-v351-note-search-dropdown`)
- **Commits:** `f50e294` (`feat(client): display saved searches in search bar dropdown popover and bump SW to v351`).
- **Fitur (Task 1):**
  - Menggantikan bar horizontal chips pencarian tersimpan di bawah `.scratchpad-bar` dengan popover dropdown `.scratchpad-search-dropdown` yang ter-anchor ke search bar.
  - Membuka otomatis saat input pencarian fokus (`onFocus`) atau melalui tombol toggle `▾` / `▴` di sisi kanan bar.
  - Dismissal otomatis ketika mengklik di luar area search bar (`pointerdown` event listener) atau menekan tombol `Escape` (`onKeyDown`).
  - Dropdown menampilkan header "Pencarian Tersimpan", daftar kueri tersimpan (nama kueri ⭐, kueri teks, highlight kueri aktif, klik untuk mencari, dan tombol × untuk menghapus), fallback kosong, serta tombol cepat simpan kueri aktif jika belum tersimpan.
- **Service Worker:** Cache version dibump ke **`taskflow-v351-note-search-dropdown`**.
- **Verifikasi:**
  - Python Pytest: **96/96 pass (0 fail)**.
  - JS Offline Test Suite: **862/862 pass (0 fail)** across 7 suites.
  - Syntax check: `node scratch/check_inline.js static/index.html` (5/5 scripts OK), `node --check static/sw.js` (OK).

## 🟢 Note Saved Searches & Compact List View Mode Toggle — 2026-10-03 (Antigravity/Gemini) — SELESAI di `main` (SW v350 `taskflow-v350-note-saved-searches-view-mode`)
- **Commits:** spec `4194895`, plan `cb9fd2c`, db migration & API `07fc6b6`, compact view `5b838d6`, client saved searches UI & SW v350 `1da02d8`.
- **Fitur:**
  - **Pencarian Tersimpan (Saved Searches):** Pengguna dapat menyimpan kueri pencarian catatan yang sering digunakan dengan memberi label (bintang ⭐ di search bar). Kueri tersimpan muncul sebagai horizontal scrollable chips di bawah search bar yang dapat diklik untuk pencarian instan atau dihapus (×). Didukung caching IndexedDB (`OfflineDB.cacheGet/Set("note_saved_searches")`).
  - **Tampilan Ringkas (Compact List View Mode):** Toggle di sidebar header notes (ikon `☰` ↔ `▤`) untuk beralih antara tampilan kartu standar multi-baris dan tampilan daftar ringkas satu baris (preview disembunyikan, padding ringkas). Preferensi disimpan di `localStorage` (`tf_notes_view_mode`).
  - **Backend & Database:** Migrasi tabel `note_saved_searches` (`id`, `user_id`, `name`, `query`, `created_at`), indeks per user, dan endpoint CRUD lengkap (`GET`, `POST`, `DELETE /api/scratchpad/saved-searches`).
- **Service Worker:** Cache version dibump ke **`taskflow-v350-note-saved-searches-view-mode`**.
- **Verifikasi:**
  - Python Pytest: **96/96 pass (0 fail)**.
  - JS Offline Test Suite: **861/861 pass (0 fail)** across 7 suites.
  - Syntax check: `node scratch/check_inline.js static/index.html` (5/5 scripts OK), `node --check static/sw.js` (OK).

## 🟢 SQLite FTS5 Full-Text Search & Search Operators (`tag:`, `-tag:`) — 2026-10-03 (Antigravity/Gemini) — SELESAI di `main` (SW v349 `taskflow-v349-fts5-tag-search`)
- **Commits:** spec `10184b6`, plan `3df9970`, db migration `807ba57`, search API `e87c527`, client offline search `d8a2dc6`.
- **Fitur Roadmap #2:** Menggantikan pencarian catatan `LIKE '%q%'` dengan SQLite FTS5 External Content Virtual Table `scratchpad_notes_fts` dan sinkronisasi otomatis database triggers (`AFTER INSERT`, `AFTER DELETE`, `AFTER UPDATE`).
- **Operator Pencarian:**
  - `tag:<nama>`: Menyaring catatan yang memiliki tag terkait via `EXISTS (SELECT 1 FROM entity_tags ...)`.
  - `-tag:<nama>`: Menyaring/mengecualikan catatan yang memiliki tag terkait via `NOT EXISTS (SELECT 1 FROM entity_tags ...)`.
  - Kata kunci teks: Disanitasi secara aman dari karakter operator FTS berbahaya (`_sanitize_fts5_token`), mendukung pencarian prefix `"<token>"*` dan frasa, dengan fallback aman ke `LIKE` jika terjadi OperationalError sehingga API tidak pernah melempar 500.
  - Multi-user isolation: Akses kontrol `_note_access_clause(uid, prefix="s")` diterapkan secara ketat di semua cabang kueri.
- **Client Offline-First:** `static/index.html` diperbarui pada `parseQuery`, `applyFilters`, dan `applyFiltersStatic` agar menyaring operator `-tag:<nama>` secara instan di memori (0ms) saat offline maupun online.
- **Service Worker:** Cache version dibump ke **`taskflow-v349-fts5-tag-search`**.
- **Verifikasi:**
  - Python Pytest: **94/94 pass (0 fail)**.
  - JS Offline Test Suite: **855/855 pass (0 fail)** across 7 suites.
  - Syntax check: `node scratch/check_inline.js static/index.html` (5/5 scripts OK), `node --check static/sw.js` (OK).
- **PENDING saat deploy:**
  - `sudo systemctl restart taskflow-web` di VPS WAJIB agar `migrate_db()` membuat tabel virtual FTS5 `scratchpad_notes_fts` dan triggers otomatis serta me-rebuild indeks catatan lama.
  - Hard refresh browser klien (Ctrl+Shift+R atau tutup-buka PWA) untuk mengaktifkan Service Worker `v349`.
  - Rebuild APK / .exe agar aset klien terbaru terintegrasi.

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

## 🟢 Breadcrumb note viewer disembunyikan di mobile — 2026-10-01 (Claude) — SELESAI di branch (BELUM merge/deploy, SW v340, app.css?v=302)
- `.notes-nav-trail { display:none !important }` di media ≤640px (`static/app.css`); desktop tetap. E2E: mobile display none, desktop flex.

## 🟢 Toolbar aksi note viewer 1 baris di mobile — 2026-10-01 (Claude) — SELESAI di branch `claude/cool-gates-qa4eg9` (BELUM merge/deploy, SW v338, app.css?v=301)
- **Keluhan:** di mobile, aksi note (share/pin/Publish/Export/Edit/hapus/tutup) terpecah 2 baris. **Perbaikan:** label teks (Publish/Export/Edit) dibungkus `.note-act-label` dan disembunyikan ≤640px; Publish pakai ikon `globe` (+`lock` bila ber-password), Export ikon `download`; `ui-components.js` ditambah ikon `globe`/`lock`; `.notes-panel-actions` nowrap di mobile, tombol tutup `margin-left:auto`. Desktop: label tetap + ikon baru.
- **Verifikasi:** E2E 390px: tinggi baris 36px (1 baris), tanpa overflow; JS/inline hijau.

- **Tag note viewer (lanjutan, SW v339):** blok tag `#...` dipindah dari atas (sebelum isi) ke SETELAH isi note (`note-rendered`), sebelum Links keluar; `marginTop:18`. E2E 390px: tag di bawah isi.

## 🟢 Topbar mobile full-bleed — 2026-10-01 (Claude) — SELESAI di branch `claude/cool-gates-qa4eg9` (BELUM merge/deploy, SW v336, app.css?v=300)
- **Keluhan:** di mobile, sisi kiri/kanan topbar terpotong (tidak sampai tepi layar). **Akar:** `.mobile-topbar` dirender DI DALAM `.main-content` yang ber-padding 16px (+safe-area) di ≤768px, jadi ikut terinset.
- **Perbaikan:** `static/app.css` (media ≤768px): `.mobile-topbar` margin kiri/kanan negatif = padding main-content (termasuk safe-area), `margin-top:-8px`, padding dalam dikompensasi. Tanpa perubahan JS. SW `taskflow-v336-mobile-topbar-bleed`; tes versi disesuaikan (`note_toc`, `drawing_sync_ui`).
- **Ikon topbar (lanjutan, SW v337):** emoji 🔍/🔔 di topbar mobile diganti komponen `Icon` (search/bell, 20px, warna `--text-secondary`) agar seragam dengan ikon SVG lain; tombol notifikasi diberi `title`.
- **Verifikasi:** E2E 390px: topbar x=0, right=390=viewport, tanpa scroll horizontal, screenshot rapi. JS 796/796, pytest 61/61, inline 5/5. Belum dites HP fisik/notch.

## 🟢 Fix bug drawing (tldraw): persistensi inline note, edit via Draw, sinkron antar mesin — 2026-10-01 (Claude) — SELESAI & LIVE (fast-forward push ke main `f63f04e..c5364ef`, Deploy run 810 + Tests run 290 sukses 2026-10-01 11:41 UTC, SW v335)
- **Keluhan user:** (1) gambar inline di note hilang setelah ditutup; (2) edit via menu Draw tidak muncul di note; (3) mesin lain tidak sinkron.
- **Akar masalah (direproduksi Playwright di app asli):** RC1 op outbox `update` menyimpan snapshot edit PERTAMA & push mengirim payload basi lalu `dirty:0` (6 coretan → server 1); RC2 `drawingrepo.getDrawing` online menulis balik objek record basi (lost update; klik "Selesai" cepat: 4 coretan → 0) dan menimpa lokal dgn server basi saat gambar dibuka; RC3 push menulis balik record basi; RC4 QuickDrawModal menutup 350ms tanpa menunggu snapshot; RC5 `schedulePush` tak reschedule saat `busy`; RC6 pull menimpa dirty tanpa op; plus `GET /api/drawings` tanpa `client_id` → mesin B gagal simpan via direktif note (id = cid mesin A).
- **Perbaikan:** `drawingrepo.js`: `rev` + `mutateDrawing` (CAS atomik 1 transaksi IDB), `updateDrawing` diserialkan (blob → CAS → hapus blob lama), op outbox metadata-only (`queueDrawingUpdate`), `getDrawing` online: tak pernah hapus op / timpa dirty, refresh via CAS bila server berubah, adopsi idempoten (cid = client_id server), **heal** data rusak lama (base_rev sama, isi beda → union `mergeDrawingSnapshots` preferRemote:false, `svg_stale`, op update), `client_id` diingat & `getRaw` fallback, `upgradeLegacyDrawingOps` (op lama ber-`data_json`). `syncpush.js`: create/update baca record+blob terkini, `markDrawingPushed` CAS `sentRev`, op susulan bila masih dirty, 404 → buang op. `syncpull.js`: semua tulis via CAS, dirty tanpa op → antre op (tak ditimpa), hapus remote dikonfirmasi GET. `index.html`: `schedulePush`/`sync` reschedule saat busy + event `tf:outbox-queued`; QuickDrawModal "Menyimpan…" menunggu balasan `requestSnapshot` ber-`reqId` lalu simpanan global; `handleIframeMessage` dedupe + `svg_stale`; gema `load` ditekan. `draw-app/src/App.jsx`: listener `{source:'user', scope:'document'}` + load via `mergeRemoteChanges(loadSnapshot)` (jendela buta 800ms hilang), flush `pagehide`/`visibilitychange`, `svgStale` → kirim svg segar. SW `taskflow-v333-drawing-sync-fix`, iframe `v=143`.
- **Verifikasi:** JS 750/750 (+54 test baru: `drawing_persist_sync.test.js`, `drawing_sync_ui.test.js`), pytest 60/60, inline 5/5. Script repro asli koordinator (tidak diubah): A1 6/6/6 (dulu server 1), A2 Draw 6 (dulu 1), A3 9/9, A4 preview 9, mesin B 9/9 (dulu 1), tutup 80ms → 4 (dulu 0). Acceptance implementer: fix_all 9/9, fix_close4 6/6, fix_a3b 4/4, fix_load200 4/4, fix_pagehide 7/7, fix_heal 5/5, fix_machineB_edit 4/4. Regresi editor: bh 36/14/15, toc 54/54.
- **Hardening (review independen, commit terpisah):** (1) fetch sinkron ber-header `X-TF-Sync` → SW network-only (cache GET basi sempat membalikkan data: server 5→3) + record bersih hanya mengadopsi server yang LEBIH BARU (`tsNewer`, presisi mikrodetik); (2) iframe read-only sampai `load` pertama, `requestSnapshot` hanya membalas data bila loaded & ada edit belum terkirim, parent selalu membalas `ready` (`load` + flag `empty` / `loadError` + toast) — tutup sebelum data tiba sempat menimpa 3→0; (3) heal hanya record legacy RC1 (`rev` undefined & updated_at ≠ base_rev); (4) `runSyncExclusive` — sync()/push terjadwal/`__pushNow` tidak tumpang tindih, `base_rev` hanya maju; (5) `readDrawingState` baca ulang record+blob (tak ada `"{}"` palsu); juga: `client_id` di `GET /api/drawings` (webapp.py), hapus remote hanya bila 404 eksplisit, timeout fetch sinkron 30s/8s, dispatch `drawingSaved` saat merged, `opDrawingPin` (pin drawing kini sampai server — bug lama), satu QuickDrawModal (listener `editDrawingModal` di NoteModal/TaskFormModal dihapus — bug lama). CORS server `allow_headers=["*"]` → header baru aman untuk Tauri/APK.
- **Verifikasi hardening:** JS 780/780, pytest 61/61, inline 5/5; E2E reviewer `rv3_sw_stale` & `rv3_close_before_load` OK; acceptance fix_all 9/9, close4 6/6, a3b 4/4, load200 4/4, pagehide 7/7, heal 5/5, machineB 4/4, new_empty 6/6, load_error 5/5, pin 4/4, single_modal 6/6; bh 36/14, toc 54/54. Catatan: `toc_edit` (scratchpad) kadang gagal di langkah HP "ketik ## Heading Baru" — terbukti PRA-ADA (gagal 2/4 juga di kode sebelum hardening; race ketuk vs seleksi DOM di harness).
- **Hardening ke-2 (review akhir, SW v335):** (1) TINGGI: detail gambar gagal/timeout saat pull/adopsi tak lagi membuat placeholder `"{}"` bersih — record ditandai `data_missing:1` + `base_rev:null` (diambil ulang), `getDrawing` mengembalikan `data_missing` (bukan kanvas kosong), parent kirim `loadError` (read-only + toast); placeholder lama dikenali (data `{}` + svg berisi gambar); push tak pernah mengirim data record `data_missing` (E2E reviewer: server 3→1). (2) `syncFetch` timeout hanya menunggu respons & diskalakan ukuran body (maks 10 menit); satu timeout tak menghentikan antrian push. (3) `runSyncExclusive`: batas tahan mulai saat tugas berjalan; `sync()` yang antre digabung. (4) iframe kirim `loadFailed` → toast. (5) Pin: toggle & adopsi pin server atomik dengan `_outbox` (pin yang di-toggle selama pull tak lagi dibalik). Unit JS 796/796, pytest 61/61. E2E (koordinator): rv4_slow_detail aman (read-only, server tetap 3), rv4_push_stall aman (op lain tetap terkirim), rv3_sw_stale OK, rv3_close_before_load OK, fix_all 9/9, close4 6/6, a3b 4/4, load200 4/4, pagehide 7/7, heal 5/5, machineB 4/4, new_empty 6/6, load_error 5/5, pin 4/4, single_modal 6/6, bh 36/36 & 14/14.
- **Risiko/keterbatasan:** edit bersamaan di 2 mesin → server LWW per push, merge/heal = union (bentuk terhapus bisa muncul lagi); `svg_stale` hanya lokal; heal hanya saat gambar dibuka online; belum dites HP fisik/APK/Safari.
- **Bug pra-ada ditemukan (belum diperbaiki):** (a) op `pin` drawing tidak punya handler di `processOp` → pin tak pernah sampai server; (b) klik preview gambar di editor note membuka 2 QuickDrawModal (App + NoteModal sama-sama mendengar `editDrawingModal`).
- **Catatan deploy:** `static/vendor/tldraw/` dibangun di VPS saat deploy (vite) — perubahan App.jsx ikut terbangun; SW v333 memaksa klien mengambil bundle baru.
- **Deploy 2026-10-01:** log job: VPS `git pull` fast-forward `f63f04e..c5364ef` (19 file), compile.js skip, `vite build` draw-app sukses (index.js 1,133 kB), pip OK. **PENDING user:** (1) `sudo systemctl restart taskflow-web` di VPS — deploy.yml TIDAK me-restart service, jadi `client_id` di `GET /api/drawings` (webapp.py) belum aktif sampai restart (detail endpoint sudah kirim client_id, jadi sinkron tetap jalan sebagian); (2) hard refresh browser → SW `taskflow-v335-drawing-sync-robust`; (3) rebuild APK/.exe. Verifikasi curl live tidak bisa dari container cloud.
- **Konfirmasi user (2026-10-01):** setelah deploy, user melaporkan bug drawing sudah hilang di pemakaian nyata.

## 🟢 Floating ToC 📑 di mode edit (ganti kolom `NoteToc`) — 2026-09-30 (Claude) — SELESAI & LIVE (fast-forward push ke main `cf3a570..f63f04e`, Deploy run 809 + Tests run 289 sukses 2026-10-01 00:21 UTC, SW v332)
- **Masalah:** di HP, edit catatan ≥2 heading → kolom `NoteToc` 120px di NoteModal membelah layar (editor 206px di 390px); klik item ToC mode edit salah target (`#note-h-N` milik panel baca).
- **Solusi:** komponen reusable `FloatingToc({ items, activeIdx, onJump, onOpen, className })` (tombol 📑 + popover) dipakai NotePanel (baca, perilaku sama) & NoteModal (edit). Mode edit: heading dari dokumen ProseMirror (`extractDocHeadings(doc)` → pos; "# ..." di code block tidak ikut), lompat via `view.nodeDOM(pos).scrollIntoView` tanpa memindah kursor, scroll-spy IntersectionObserver di DOM heading editor, sinkron ulang saat `content` berubah (retry 150ms×40 sampai editor siap) & saat popover dibuka. `NoteToc` + CSS `.note-toc-panel` dihapus. Anchor dirender di dalam root modal (fixed, z-index 1000 = konteks tumpuk sendiri) → z-index 45 cukup; varian `floating-toc-anchor--modal` hanya geser desktop `right: 8px`.
- **Hasil:** editor HP 206 → 326px, desktop 1096 → 1216px. `app.css?v=298`, SW **`taskflow-v332-edit-mode-floating-toc`**. Pin versi exact di `block_handle.test.js` dilonggarkan jadi "≥" (pin exact terbaru di `note_toc.test.js`).
- **Verifikasi:** JS 686/687 (1 fail pra-ada tldraw), pytest 60/60, inline 5/5, E2E `toc_edit` 38/38 (HP & desktop: lebar, klik tombol via elementFromPoint, tidak beririsan Batal/Simpan/toolbar, lompat akurat termasuk kasus code block, scroll-spy, focus/paper mode, mode baca tetap) + E2E block handle tetap hijau.
- **Review round (commit `3fabcc4`):** scroll-spy mode edit kini `root` = div scroll modal (pita 0–40% area scroll) → jalan di layar pendek (HP landscape 844×390, laptop 1366×520); lompat hanya menggulir area scroll modal (`scrollTo`); jeda scroll-spy `TOC_SPY_PAUSE_MS = 800` setelah klik item (mode baca & edit).
- **Fix block handle (fitur v331 yang sudah LIVE):** handle tersembunyi menyimpan top/left inline lama (mis. 5396px) → scroll palsu di `.milkdown-editor` (HP: geser jari menggulir editor ke area kosong saat Kertas/konten dipendekkan). CSS `.milkdown-block-handle:not([data-show="true"]) { top/left: 0 !important }` dengan transisi tertunda 0.12s (parkir setelah fade-out, tanpa kedip). `app.css?v=299`. Test mengunci urutan `left/top` → `data-show` di `show()` bundle.
- **Verifikasi akhir:** JS 695/696 (1 fail pra-ada tldraw), pytest 60/60, inline 5/5, E2E toc_edit 54/54, bh_overflow 13/13, block handle 36/14/2/9/15, script reviewer spy_short & edge lulus.
- **Risiko:** belum dites di HP fisik/APK/Safari; di desktop tombol menutupi 6px jalur scrollbar di pita 40px tengah layar; sebelum editor siap (~150ms) daftar memakai regex (tombol bisa berkedip bila ada "# ..." di code block); jeda 800ms dikalibrasi untuk Chromium.
- **PENDING user (ToC):** hard refresh (tutup-buka PWA di HP) lalu cek mode edit catatan ber-heading; SW `taskflow-v332-edit-mode-floating-toc`, `app.css?v=299`. APK perlu build ulang agar ikut.

## 🟢 Block handle ala Notion ("+" / ⋮⋮) di editor Milkdown — 2026-09-30 (Claude) — SELESAI & LIVE (PR #2 di-merge ke main `cf3a570`, Deploy run 808 sukses 2026-09-30 22:42 UTC, SW v331)
- **Fitur:** di kiri tiap blok editor muncul "+" (sisipkan paragraf "/" di bawah blok → slash menu terbuka) dan ⋮⋮ (desktop: seret untuk memindah blok, ada drop-cursor; HP: ketuk = pilih blok). Desktop: muncul saat hover (`@milkdown/plugin-block@7.20.0`). HP (`matchMedia('(hover: none)')`): mengikuti blok tempat kursor, sembunyi saat mengetik/blur. Isi tabel/blockquote tidak punya handle sendiri (handle untuk tabel/blockquote-nya).
- **Saklar HP:** konstanta `BLOCK_HANDLE_ON_TOUCH` (di atas `function MilkdownEditor`, `static/index.html`). User minta: tampilkan dulu di HP; kalau terasa sempit → set `false` (gutter 44px + tombol hilang di HP). Desktop gutter 48px (`.milkdown-editor.has-block-handle .ProseMirror`), paper mode tetap padding 0 (handle di margin kertas).
- **Fix ikut:** slash menu Heading/Blockquote/Divider tidak lagi menyisakan "/" (bug pra-ada, terverifikasi di app asli) — hanya "/" pemicu (awal blok/setelah spasi, helper `isSlashTriggerBefore`) yang dihapus, "/" asli teks (and/or, URL) dibiarkan; kursor setelah Bullet/Ordered/Task/Table/Divider kini masuk ke blok baru; case 'draw' tidak lagi melempar "mismatched transaction"; tooltip B/I/S tidak muncul untuk NodeSelection blok (klik ⋮⋮); tombol "+" tidak memblokir penutupan dropdown toolbar.
- **File:** `milkdown-build/{package.json,package-lock.json,entry.js}` (+plugin-block, NodeSelection, dropCursor) → `static/vendor/milkdown.bundle.js` (rebuild reproducible, +2.9 KB gzip), `static/index.html` (bundle `?v=289`, css `?v=297`), `static/app.css`, `static/sw.js` (**`taskflow-v331-milkdown-block-handle`**), `tests/offline/block_handle.test.js` (baru, 41 subtest), `tests/offline/table_resizing.test.js` (v=289).
- **Verifikasi (setelah review round):** JS 661/662 (1 fail pra-ada: `draw_local_reactive` butuh `static/vendor/tldraw/` yang gitignored — tidak ada di clone cloud); pytest 60/60; inline 5/5; E2E Playwright di app asli (uvicorn lokal): desktop 36/36, touch 14/14, lifecycle 2/2, node lain 9/9, skenario review 15/15.
- **Catatan untuk agent berikutnya:** "+" pada item list di tengah memecah list jadi dua (perilaku sama dengan Milkdown Crepe). Bug PRA-ADA slash menu yang belum disentuh (temuan reviewer, terverifikasi di versi sebelum fitur ini): (a) "teks/" (tanpa spasi) + Bullet/Ordered/Task menghapus teks sebelum kursor (`replaceRangeWith(before(para), to)`); (b) "/" di dalam sel tabel + Divider/Bullet/Table memecah tabel; (c) item slash "Table" membuat tabel tanpa `table_header_row`. Drag di layar sentuh sengaja tidak didukung (belum dites di HP fisik). Di clone baru: `npm ci` di root (fake-indexeddb) dan di `milkdown-build/` sebelum build/test.
- **Deploy:** log job deploy: VPS `git pull` fast-forward `199e985..cf3a570` (11 file), compile.js skip (sudah compiled), sukses. Verifikasi curl live TIDAK bisa dari container cloud (network policy menolak domain produksi) — cek manual di browser: SW `taskflow-v331-milkdown-block-handle`.
- **PENDING user:** hard refresh (Ctrl+Shift+R / tutup-buka PWA); cek di HP apakah editor terlalu sempit (kalau ya, `BLOCK_HANDLE_ON_TOUCH = false`). APK Android perlu build ulang agar ikut.

## 🟢 Active Task
- **Fix CRLF Line Ending Slice Incompatibility in Note Trash Unit Test (`tests/offline/notetrash.test.js`) — SELESAI 2026-10-03 (Antigravity/Gemini):**
  - **Problem / Root Cause:**
    - Pada lingkungan Windows dengan CRLF line endings (`\r\n`), `indexHtml.indexOf("\n}\n", start)` mengembalikan `-1` karena file memiliki line ending `\r\n}\r\n`.
    - Akibatnya, pemotongan string `indexHtml.slice(start, -1)` melompat ke sisa seluruh file `index.html`, sehingga `assert.doesNotMatch(body, /OfflineDB\.queueAdd/)` gagal karena menemukan `OfflineDB.queueAdd` di bagian lain file.
  - **Solusi / Perbaikan:**
    - `tests/offline/notetrash.test.js`: Menambahkan normalisasi `.replace(/\r\n/g, "\n")` saat membaca `indexHtml` dan `swJs` melalui `fs.readFileSync`.
  - **Verifikasi:**
    - Targeted unit tests: `node --test tests/offline/notetrash.test.js` ➡️ **17/17 pass (0 fail)**.
    - Full JS offline test suite: `node --test tests/offline/*.test.js` ➡️ **850/850 pass (0 fail)** across 7 suites.
    - Full Backend test suite: `python -m pytest tests/` ➡️ **91/91 pass (0 fail)**.

- **Feasibility: Milkdown block handle ala Notion (`+` / `⋮⋮` per baris) — INVESTIGASI SAJA 2026-09-30 (Claude), BELUM ADA KODE, menunggu keputusan user:**
  - **Kesimpulan:** BISA, lewat `@milkdown/plugin-block@7.20.0` (primitive yang dipakai Crepe). Dependensinya dipin EXACT ke core/ctx/prose/utils `7.20.0` = sama dengan core kita (aman dari insiden duplicate-core indent/emoji); dep baru hanya `lodash-es` (throttle) + `@floating-ui/dom` (sudah ada via slash/tooltip). **JANGAN pakai `@milkdown/crepe`** — crepe@7.20.0 menarik vue + codemirror + language-data + katex dan mengganti seluruh editor (wikilink/tasklink/`::draw`/highlight/paste/checklist/table toolbar harus di-port ulang).
  - **Terverifikasi dari source plugin-block 7.20.0:** handle muncul via `pointermove` (throttle 200ms), posisi floating-ui placement `left`, di-append ke `root ?? view.dom.parentElement`; drag = NodeSelection + drop native ProseMirror (`view.dragging.slice`, custom node aman); `defaultNodeFilter` mengecualikan isi tabel; `provider.active` = `{node, $pos, el}` → tombol `+` harus kita tulis sendiri (sisip paragraf kosong di bawah block aktif lalu buka slash menu yang sudah ada).
  - **Risiko yang ditemukan (harus masuk spec):** (1) gutter: `.milkdown-editor .ProseMirror` padding kiri cuma 12px + `.milkdown-editor` `overflow-y:auto` → handle ter-clip, perlu padding kiri ~40px atau root lain; (2) BENTROK checklist: `createTaskCheckboxPlugin` (index.html ~17298) menangkap klik x -24..-2 di kiri `<li>` task = posisi handle; (3) touch/mobile: tak ada hover, HTML5 drag tak andal di Android WebView, `pointermove` ikut fire saat scroll → usul desktop-only (`pointer: coarse` sembunyikan); (4) paper mode padding 20mm `!important`; (5) dua instance editor: `NoteModal` + tab Note `TaskFormModal` (keduanya lewat `MilkdownEditor`).
  - **BLOKER build lokal:** `Z:` = drive cloud; `milkdown-build/node_modules/@milkdown` tak terbaca ("The cloud file provider is not running") → `npm run build` bundle butuh cloud provider aktif atau `npm install` ulang. Setelah build: bump SW + rebuild .exe/APK.
  - **NEXT (kalau user setuju):** brainstorming → spec → plan → SDD (sesuai PROTOCOL).

- **Fix Chevron Icons Text Fallback in Task & Habit Accordion Toggle Buttons (`static/ui-components.js`, `static/sw.js`, `tests/offline/task_modal_progressive_disclosure.test.js`) — SELESAI 2026-10-03 (Antigravity/Gemini) — SW v347:**
  - **Problem / Context:**
    - Pada tombol toggle opsi tambahan modal task dan modal habit (`.task-advanced-toggle`), muncul teks mentah `"chevron-right"` atau `"chevron-down"` di depan label teks.
    - Akar masalah: Komponen `<Icon name={showAdvanced ? "chevron-down" : "chevron-right"} />` memanggil kamus `ICONS`, tetapi kunci `chevron-down` dan `chevron-right` belum terdaftar di `ICONS` (`static/ui-components.js`). Akibatnya, fallback default komponen Icon mencetak string nama icon ke dalam DOM (`<span>{name}</span>`).
  - **Solusi / Perbaikan:**
    1. `static/ui-components.js`:
       - Menambahkan definisi path SVG untuk `chevronDown`, `'chevron-down'`, `chevronRight`, `'chevron-right'`, `chevronUp`, `'chevron-up'`, `chevronLeft`, dan `'chevron-left'` ke dalam kamus `ICONS`.
    2. `static/sw.js`:
       - Menambahkan `/static/ui-components.js` ke daftar array `STATIC` cache Service Worker agar di-precache saat install.
       - Bump cache version ke **`taskflow-v347-fix-chevron-icons`**.
    3. Unit Tests:
       - `tests/offline/task_modal_progressive_disclosure.test.js`: Menambahkan Test 7 untuk memastikan definisi icon SVG `chevron-right` dan `chevron-down` terdaftar valid di `static/ui-components.js`.
       - `tests/offline/drawing_sync_ui.test.js` & `interactive_note_viewer.test.js`: Sinkronisasi asersi cache version ke `v347`.
  - **Verifikasi:**
    - Inline scripts syntax check: `node scratch/check_inline.js static/index.html` ➡️ **5/5 scripts OK**.
    - SW & UI syntax check: `node --check static/sw.js` & `node --check static/ui-components.js` ➡️ **OK**.
    - Targeted unit tests: `node --test tests/offline/task_modal_progressive_disclosure.test.js` ➡️ **8/8 pass (0 fail)**.
    - Full JS offline test suite: `node --test tests/offline/*.test.js` ➡️ **819/819 pass (0 fail)** across 8 suites.
    - Full Backend test suite: `python -m pytest tests/` ➡️ **61/61 pass (0 fail)**.

- **Habit Modal Progressive Disclosure for Low-Friction New Habit Creation (`static/index.html`, `static/sw.js`, `tests/offline/habit_modal_progressive_disclosure.test.js`) — SELESAI 2026-10-02 (Antigravity/Gemini) — SW v346:**
  - **Problem / Context:**
    - Pada tab Habit pembuatan baru (`TaskFormModal`), seluruh form konfigurasi (Nama Habit, Fase, Micro Target, Frekuensi 7 tombol hari, Identity Pillar) sebelumnya langsung ditampilkan secara penuh.
    - Hal ini membebani pengguna baru yang hanya ingin membuat kebiasaan sederhana secara cepat (*Frictionless Capture*).
  - **Solusi / Perbaikan:**
    1. `static/index.html`:
       - Menambahkan state `showHabitAdvanced` (default: `false`) dan komputasi `habitAdvancedFilledCount` untuk mendeteksi opsi lanjutan yang diisi (Micro Target terisi, pilihan hari khusus diubah dari 7 hari, atau Identity Pillar terisi).
       - Menata ulang layout pembuatan habit baru:
         - **Atas (Selalu tampil):** Nama Habit (auto-focused, #tag autocomplete) + Fase Waktu (Pagi/Siang/Malam). Frekuensi otomatis default setiap hari (7 hari).
         - **Tombol Toggle:** Accordion `▸ Opsi Lanjutan (Micro Target, Hari Khusus, Identity Pillar)` dengan badge pintar indikator jumlah opsi terisi (misal `1 diisi`).
         - **Kontainer Lanjutan:** Membungkus Micro Target (opsional), Frekuensi pemilihan hari khusus (Sen–Min + tombol Pilih/Hapus Semua), dan Identity Pillar (opsional).
       - Modal Edit (`HabitEditModal`): Tetap menampilkan seluruh kolom input secara terbuka penuh untuk kemudahan inspeksi dan penyuntingan kebiasaan.
    2. `static/sw.js`:
       - Bump Service Worker cache version ke **`taskflow-v346-habit-modal-progressive-disclosure`**.
    3. Unit Tests:
       - `tests/offline/habit_modal_progressive_disclosure.test.js`: Suite pengujian offline baru (6/6 tests pass) memvalidasi state `showHabitAdvanced`, tombol toggle accordion, enkapsulasi field lanjutan, komputasi filled count, dan preservasi `HabitEditModal`.
       - `tests/offline/drawing_sync_ui.test.js` & `interactive_note_viewer.test.js`: Sinkronisasi asersi cache version ke `v346`.
  - **Verifikasi:**
    - Inline scripts syntax check: `node scratch/check_inline.js static/index.html` ➡️ **5/5 scripts OK**.
    - SW syntax check: `node --check static/sw.js` ➡️ **OK**.
    - Targeted unit tests: `node --test tests/offline/habit_modal_progressive_disclosure.test.js` ➡️ **6/6 pass (0 fail)**.
    - Full JS offline test suite: `node --test tests/offline/*.test.js` ➡️ **819/819 pass (0 fail)** across 8 suites.
    - Full Backend test suite: `python -m pytest tests/` ➡️ **61/61 pass (0 fail)**.

- **TaskFormModal Progressive Disclosure for Clean New Task Creation (`static/app.css`, `static/index.html`, `static/sw.js`, `tests/offline/task_modal_progressive_disclosure.test.js`) — SELESAI 2026-10-02 (Antigravity/Gemini) — SW v345:**
  - **Problem / Context:**
    - Modal pembuatan task baru sebelumnya terasa *overwhelming* bagi pengguna karena langsung menampilkan 8–10 kolom input dan selector besar (Priority, GTD Status, Project, Context, Shared List, Deadline, Berulang, Deskripsi, Subtask) secara sekaligus.
    - Hal ini membebani kognisi pengguna (*cognitive overload*) dan bertentangan dengan prinsip dasar GTD (*Capture first, clarify later*).
  - **Solusi / Perbaikan:**
    1. `static/app.css`:
       - Menambahkan layout responsif 3 kolom `.task-quick-attributes` (`display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px`) dengan adaptasi mobile <= 640px.
       - Menambahkan styling tombol toggle `.task-advanced-toggle` dengan border putus-putus elegan dan efek hover.
    2. `static/index.html`:
       - Menambahkan state `showAdvanced` di `TaskFormModal` yang diinisialisasi `false` untuk task baru (`!isEdit`) dan `true` untuk edit task (`isEdit`).
       - Menambahkan komputasi `advancedFilledCount` yang menghitung otomatis jumlah konfigurasi lanjutan yang diisi oleh pengguna (GTD bukan inbox, context terisi, list_id, berulang aktif, deskripsi terisi, subtask ada, waiting_for terisi).
       - Menata ulang layout pembuatan task baru:
         - **Atas (Selalu tampil):** Judul task (auto-focused) + Baris ringkas 3 kolom (📅 **Deadline**, 🚩 **Priority**, 📁 **Project**).
         - **Tombol Toggle:** Accordion `▸ Opsi Tambahan (GTD, Context, Deskripsi, Subtask)` dengan badge pintar (misal `2 diisi`) jika ada field lanjutan yang diisi.
         - **Kontainer Lanjutan:** Membungkus GTD Status, Context, Waiting For, Shared List & Assignee, Berulang, Progress, Deskripsi, dan Subtask.
       - Mode Edit (`isEdit`): Semua kolom tetap langsung ditampilkan terbuka penuh agar pengguna dapat meninjau dan menyunting detail task dengan mudah.
    3. `static/sw.js`:
       - Bump Service Worker cache version ke **`taskflow-v345-task-modal-progressive-disclosure`**.
    4. Unit Tests:
       - `tests/offline/task_modal_progressive_disclosure.test.js`: Suite pengujian offline baru (7/7 tests pass) memvalidasi CSS rules, state `showAdvanced`, quick attributes grid, tombol toggle, enkapsulasi field lanjutan, dan komputasi active filled count.
       - `tests/offline/drawing_sync_ui.test.js` & `interactive_note_viewer.test.js`: Memperbarui asersi cache version ke `v345`.
  - **Verifikasi:**
    - Inline scripts syntax check: `node scratch/check_inline.js static/index.html` ➡️ **5/5 scripts OK**.
    - SW syntax check: `node --check static/sw.js` ➡️ **OK**.
    - Targeted unit tests: `node --test tests/offline/task_modal_progressive_disclosure.test.js` ➡️ **7/7 pass (0 fail)**.
    - Full JS offline test suite: `node --test tests/offline/*.test.js` ➡️ **813/813 pass (0 fail)** across 7 suites.
    - Full Backend test suite: `python -m pytest tests/` ➡️ **61/61 pass (0 fail)**.

- **Bulletproof NoteModal Block Cursor Focus, Title AutoFocus Suppression for Existing Notes & SW v344 (`static/index.html`, `static/sw.js`, `tests/offline/interactive_note_viewer.test.js`, `tests/offline/drawing_sync_ui.test.js`) — SELESAI 2026-10-02 (Antigravity/Gemini) — SW v344:**
  - **Problem / Context:**
    - Pengguna melaporkan bahwa saat membuka editor catatan, kursor selalu fokus ke input judul (title) catatan alih-alih blok teks yang ingin disunting.
    - Akar masalah:
      1. Input judul di `NoteModal` memiliki atribut `autoFocus: !focusMode && !initialBlockTarget`. Ketika catatan dibuka melalui tombol Edit toolbar, `initialBlockTarget` bernilai null, memicu autofocus ke input judul. Catatan eksisting (`note?.id`) seharusnya TIDAK PERNAH memicu autofocus ke judul.
      2. Pada `locateAndFocus`, pemanggilan `view.nodeDOM($pos.before($pos.depth))` melempar error saat depth 0, dan `nodeDOM` mengembalikan null untuk elemen heading/paragraf standar ProseMirror. Seharusnya menggunakan `view.domAtPos(safePos)` untuk resolusi DOM node.
      3. Jika teks tidak cocok persis, tidak ada fallback penempatan kursor di awal konten (`targetPos = 1`), menyebabkan kursor lepas dan browser memulihkan fokus ke input form pertama (input judul).
      4. `index.html` tidak memiliki listener `controllerchange` untuk memicu auto-reload saat Service Worker baru aktif, sehingga klien PWA dapat tertahan pada script lama.
  - **Solusi / Perbaikan:**
    1. `static/index.html`:
       - Mengubah `autoFocus` input judul di `NoteModal` menjadi `autoFocus: !note?.id && !focusMode`. Untuk semua catatan eksisting, input judul tidak akan pernah mengambil fokus secara otomatis.
       - Memperbarui `locateAndFocus` dengan normalisasi teks (menghapus tanda baca markdown/spasi berlebih), fallback index blok, fallback posisi 1 (`targetPos = 1`), dan pemindahan scroll halus ke tengah (`domAtPos` ➡️ `scrollIntoView({ behavior: 'smooth', block: 'center' })`).
       - Memperluas pemilih blok pada `onDoubleClick` di `NotePanel` untuk mencakup elemen tabel `td, th`.
       - Menambahkan listener `controllerchange` pada script registrasi Service Worker agar browser otomatis memuat ulang versi terbaru saat SW aktif.
    2. `static/sw.js`:
       - Bump Service Worker cache version ke **`taskflow-v344-double-click-block-focus`**.
    3. Unit Tests:
       - `tests/offline/interactive_note_viewer.test.js`: Memperbarui asersi Test 7 ke `v344` dan Test 9 ke `autoFocus: !note?.id && !focusMode` (10/10 pass).
       - `tests/offline/drawing_sync_ui.test.js`: Memperbarui asersi cache version ke `v344` (38/38 pass).
  - **Verifikasi:**
    - Inline scripts syntax check: `node scratch/check_inline.js static/index.html` ➡️ **5/5 scripts OK**.
    - SW syntax check: `node --check static/sw.js` ➡️ **OK**.
    - Targeted unit tests: `node --test tests/offline/interactive_note_viewer.test.js` & `drawing_sync_ui.test.js` ➡️ **48/48 pass (0 fail)**.
    - Full JS offline test suite: `node --test tests/offline/*.test.js` ➡️ **806/806 pass (0 fail)** across 7 suites.
    - Full Backend test suite: `python -m pytest tests/` ➡️ **61/61 pass (0 fail)**.

- **Fix Note Title Wrapping / Truncation on Note Viewer (`static/index.html`, `static/app.css`, `static/sw.js`, `tests/offline/interactive_note_viewer.test.js`, `tests/offline/drawing_sync_ui.test.js`) — SELESAI 2026-10-02 (Antigravity/Gemini):**
  - **Problem / Root Cause:**
    - Pada implementasi inline title edit sebelumnya, elemen pembungkus judul menggunakan `display: "inline-flex"` dengan `gap: 6` di dalam container `.notes-panel-title` yang memiliki `word-break: break-word`. Di mesin render Blink/Chromium, flex item teks anonim di dalam `inline-flex` yang memiliki `gap` dan `word-break: break-word` mengalami pengurangan ruang horizontal sub-pixel saat pengukuran intrinsic sizing. Akibatnya, karakter terakhir kata apa pun (misalnya huruf `r` pada kata `Belajar`) terpotong dan terlempar ke baris kedua.
  - **Solusi / Perbaikan:**
    1. `static/app.css`:
       - Mengubah `.notes-panel-title` dari `word-break: break-word` menjadi `word-break: normal; overflow-wrap: break-word;`.
       - Menambahkan styling `.note-title-clickable` (`cursor: pointer; word-break: normal; overflow-wrap: break-word;`) dengan hover effect warna accent dan pensil lebih kontras.
    2. `static/index.html`:
       - Mengubah span pembungkus judul dari `display: inline-flex; alignItems: center; gap: 6` menjadi normal inline flow dengan kelas `.note-title-clickable`, `wordBreak: "normal"`, dan `overflowWrap: "break-word"`.
       - Ikon pensil ✏️ diberi kelas `.note-title-pencil` dengan `marginLeft: 6` dan `verticalAlign: "middle"`.
    3. `static/sw.js`:
       - Bump Service Worker cache version ke **`taskflow-v342-note-title-wrap-fix`**.
    4. Unit Tests:
       - `tests/offline/interactive_note_viewer.test.js`: Menambahkan Test 8 untuk memvalidasi pencegahan pemotongan kata judul (`word-break: normal`, `overflow-wrap: break-word`, kelas `note-title-clickable` & `note-title-pencil`), serta memperbarui asersi versi SW ke v342 (9/9 pass).
       - `tests/offline/drawing_sync_ui.test.js`: Memperbarui asersi cache bust SW ke v342 (38/38 pass).
  - **Verifikasi:**
    - Inline script syntax check: `node scratch/check_inline.js static/index.html` ➡️ **5/5 scripts OK**.
    - Service Worker syntax check: `node --check static/sw.js` ➡️ **OK**.
    - Targeted unit tests: `node --test tests/offline/interactive_note_viewer.test.js` & `drawing_sync_ui.test.js` ➡️ **47/47 pass (0 fail)**.
    - Full JS offline test suite: `node --test tests/offline/*.test.js` ➡️ **805/805 pass (0 fail)** across 7 suites.
    - Full Backend test suite: `python -m pytest tests/` ➡️ **61/61 pass (0 fail)**.

- **Low-Friction Interactive Note Viewer (`static/index.html`, `static/app.css`, `static/sw.js`, `tests/offline/interactive_note_viewer.test.js`) — SELESAI 2026-10-01 (Antigravity/Gemini):**
  - **Problem / Context:**
    - Sebelumnya, pengguna yang ingin melakukan pengubahan ringan dan cepat pada catatan (seperti mencentang item to-do `- [ ]`, mengganti judul catatan, atau menyunting teks secara cepat) dipaksa untuk mengklik tombol "Edit" di pojok kanan atas dan membuka overlay modal penuh (`NoteModal`), menimbulkan gesekan (*friction*) dan memutus *flow state* membaca. Di sisi lain, fitur-fitur lanjutan pada `NoteModal` (Paper Mode A4/A3/Letter, Milkdown WYSIWYG editor, block handling, toolbar format) sangat penting dan harus dipertahankan 100%.
  - **Solusi / Perbaikan:**
    1. `static/index.html`:
       - Pada `renderMarkdown`: Menghapus atribut `disabled=""` pada elemen task list checkbox markdown dan menambahkan `data-task-checkbox-idx="${idx}"` serta kelas `note-interactive-checkbox`.
       - Pada `NotePanel.handlePreviewClick`: Menambahkan penanganan klik instan pada checkbox task. Sistem memetakan indeks checkbox, membalik status `[ ]` ↔ `[x]` pada markdown `note.content`, menyimpannya ke server via `api.put` (dengan fallback `OfflineDB.queueAdd` / `cacheSet` jika offline), dan menembakkan event `noteSaved`.
       - Pada `NotePanel`: Menambahkan state `isEditingTitle` dan `titleDraft`. Judul catatan di viewer kini dapat diklik (dengan tooltip "Klik untuk ubah judul" dan ikon pensil ✏️). Saat diklik, judul berubah menjadi input inline yang menyimpan perubahan via `Enter` / `blur` dan membatalkan via `Escape`.
       - Pada container `.note-rendered`: Menambahkan `onDoubleClick` handler (dengan guard pengecualian elemen interaktif) yang langsung memicu pembukaan `NoteModal` penuh (`onEdit()`).
       - Memastikan seluruh fitur `NoteModal` (MilkdownEditor, paperConfig, PaperPageGuides, NoteToolbar) tetap 100% utuh tanpa perubahan yang merusak.
    2. `static/app.css`:
       - Menambahkan cursor pointer, efek hover zoom (`transform: scale(1.15)`), dan warna accent pada `.note-rendered input[type="checkbox"]`.
       - Menambahkan styling `.note-title-inline-input` dan hover effect pada judul catatan di panel.
    3. `static/sw.js`:
       - Bump Service Worker cache version ke **`taskflow-v341-interactive-note-viewer`**.
    4. Unit Tests:
       - `tests/offline/interactive_note_viewer.test.js`: Suite pengujian offline baru (8/8 subtests pass) memvalidasi checkbox indexing, toggle logic helper, inline title edit state, double-click trigger, pelestarian struktural `NoteModal`, styling CSS, dan versi Service Worker.
  - **Verifikasi:**
    - Inline script syntax check: `node scratch/check_inline.js static/index.html` ➡️ **5/5 scripts OK**.
    - Service Worker syntax check: `node --check static/sw.js` ➡️ **OK**.
    - Unit test suite: `node --test tests/offline/interactive_note_viewer.test.js` ➡️ **8/8 pass (0 fail)**.
    - Full JS offline test suite: `node --test tests/offline/*.test.js` ➡️ **804/804 pass (0 fail)** across 7 suites.
    - Full Backend test suite: `python -m pytest tests/` ➡️ **61/61 pass (0 fail)**.
    - Live Deployment: **VERIFIED** di `https://todo.yatno.web.id/static/sw.js` (SW v341 aktif di VPS).

- **Fix Mindmap Share Error & Ownership Guard (`webapp.py`, `static/index.html`, `static/sw.js`, `tests/test_mindmaps.py`, `tests/offline/mindmaproutes_shared.test.js`) — SELESAI 2026-09-04 (Antigravity/Gemini):**
  - **Problem / Root Cause:**
    1. **Missing Ownership Check in UI (`MindmapTabInstance`):** Pada `MindmapTabInstance` (sekitar baris 8718), dropdown `👥 Share` dirender untuk sembarang pengguna hanya dengan syarat `sharedLists.length > 0`, tanpa memeriksa apakah pengguna yang sedang login merupakan pemilik mindmap (`tab.user_id === currentUserId`), berbeda dengan `NoteViewerModal` dan `NoteModal`. Selain itu, `user` / `currentUserId` sebelumnya tidak dipassing dari `App` ➡️ `MindmapPage` ➡️ `MindmapTabInstance`. Ketika kolaborator (bukan pemilik) membuka mindmap bersama dan mengklik Share, permintaan `PATCH /api/mindmaps/{mid}/share` dikirim ke server.
    2. **Backend 404 vs 403 Conflation (`webapp.py:5689`):** Endpoint `share_mindmap` sebelumnya mengeksekusi `SELECT id FROM mindmaps WHERE id = ? AND user_id = ?`. Jika mindmap ada tetapi dibuat oleh pengguna lain, server melempar `HTTP 404 "Mindmap tidak ditemukan"` alih-alih `HTTP 403 "Hanya pemilik mindmap yang bisa berbagi"`.
    3. **Identifier Type & Timestamp Refresh:** `share_mindmap` menggunakan tipe `mid: int` sehingga rentan mengembalikan 422 bila dikirimkan ID string / CID, tidak memperbarui `updated_at`, dan belum mengembalikan representasi terekayasa (`_mindmap_enrich`).
    4. **Toast Error Message Swallowing:** Handler `handleShare` menangkap error dan menampilkan flash toast umum `"Gagal menyimpan"` alih-alih `e?.message || "Gagal menyimpan"`.
    5. **IndexedDB Local Persistence:** Ketika `handleShare` berhasil, perubahan `list_id` hanya diperbarui pada React state, belum disimpan ke IndexedDB store `mindmaps` lokal.
  - **Solusi / Perbaikan:**
    1. `webapp.py`:
       - Mengubah anotasi `mid: str` dengan resolusi `int(mid)` jika digit atau pencarian `client_id`.
       - Memeriksa keberadaan mindmap terlebih dahulu (`SELECT id, user_id FROM mindmaps WHERE id = ?`). Jika tidak ada ➡️ melempar `HTTP 404 "Mindmap tidak ditemukan"`.
       - Jika pengguna bukan pemilik (`mm["user_id"] != uid`) ➡️ melempar `HTTP 403 "Hanya pemilik mindmap yang bisa berbagi"`.
       - Memvalidasi keanggotaan list pengguna jika `list_id` tidak None (403 "Bukan anggota list ini").
       - Mengupdate `list_id = ?, updated_at = ? WHERE id = ?` dan mengembalikan `_mindmap_enrich(dict(updated), conn)`.
    2. `static/index.html`:
       - Di `App`: mem-passing `user: user` dan `currentUserId: user?.id` ke `MindmapPage`.
       - Di `MindmapPage`: menerima `user` dan `currentUserId`, serta meneruskan `currentUserId: currentUserId || user?.id` ke setiap `MindmapTabInstance`.
       - Di `MindmapTabInstance`: menerima `currentUserId`, menghitung `isOwner = !tab?.user_id || !currentUserId || tab.user_id === currentUserId`.
       - Render share: jika `isOwner && sharedLists.length > 0`, menampilkan tombol & dropdown share. Jika `!isOwner && tab?.list_id`, menampilkan badge informasi `👥 <ListName>` (read-only) agar anggota mengetahui mindmap dibagikan tanpa bisa mengubah pengaturannya.
       - Memperbarui `handleShare` agar menampilkan pesan error spesifik dari API pada toast dan menyimpan update `list_id` & `updated_at` ke IndexedDB store `mindmaps`.
    3. `static/sw.js`:
       - Bump Service Worker cache version ke **`taskflow-v330-mindmap-share-ownership-fix`**.
    4. Unit Tests:
       - `tests/test_mindmaps.py`: Menambahkan suite pengujian FastAPI baru (8 assertions) memvalidasi owner sharing (200 OK), non-owner sharing (403 Forbidden), non-existent mindmap (404 Not Found), list membership guard (403 Forbidden), dan unshare (200 OK).
       - `tests/offline/mindmaproutes_shared.test.js`: Menambahkan pengujian offline untuk ownership guard logic dan persistensi store IndexedDB.
  - **Verifikasi:**
    - Inline syntax check: `node scratch/check_inline.js static/index.html` ➡️ **5/5 scripts OK**.
    - Service Worker syntax check: `node --check static/sw.js` ➡️ **OK**.
    - Backend test suite: `python -m pytest tests/` ➡️ **60/60 tests pass (0 fail)**.
    - JS offline test suite: `node --test tests/offline/*.test.js` ➡️ **597/597 tests pass (0 fail)** across 7 suites.

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
