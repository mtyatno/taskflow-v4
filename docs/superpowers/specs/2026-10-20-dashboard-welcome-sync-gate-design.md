# Dashboard: welcome card hanya untuk akun yang benar-benar kosong — desain

Tanggal: 2026-10-20 · Status: draf, menunggu persetujuan Bapak · Basis kode: `main` a5f5f37

## 1. Masalah

Akun lama yang login di perangkat/browser baru (atau setelah logout, karena logout mengosongkan IndexedDB) melihat
welcome card "Selamat datang di Alurik!" selama sync pertama berjalan. Setelah sync selesai, card hilang dan dashboard
penuh muncul. Pengguna sempat mengira datanya hilang.

## 2. Akar masalah (dari kode)

- `Dashboard` (`static/index.html` ±17651) menampilkan `DashOnboardingCard` dengan syarat
  `!hasTasks && !dismissedOnboarding`, `hasTasks = tasks.length > 0`. Kalimat ringkasan (±18031) juga memakai
  `tasks.length === 0` → "Selamat datang di Alurik!…".
- `App.fetchAll` (±36120): tanpa cache, state `tasks` awal `[]`, lalu `await sync()` (pull semua domain + push)
  sebelum `GET /api/tasks`. Selama sync, `Dashboard` sudah dirender dengan `tasks=[]` — prop `loading` tidak
  diteruskan ke `Dashboard`. Jadi welcome card tampil sepanjang sync pertama.
- `sync()` (±1120) menelan error setiap langkah (`stepFailed → null`). Bila pull task gagal (offline, 5xx),
  `tasks` tetap `[]` dan welcome card tetap tampil — akun lama "terlihat kosong" tanpa batas waktu.
- Bug sampingan: syarat hanya melihat task. Akun yang punya note tapi tanpa task juga mendapat welcome card.

## 3. Keputusan Bapak (brainstorming 2026-10-20)

1. Alurik tetap **local-first** (target 100% offline). Tidak beralih ke "dashboard ambil langsung dari API".
2. "Punya data" = **task atau note**. Mindmap, drawing, habit tidak dihitung.
3. Note di **Sampah tidak dihitung**.
4. Task/note di **workspace yang diikuti** (pemilik atau anggota) **dihitung**.
5. Bila pengguna lama menghapus semua task & note, **welcome card boleh muncul lagi**.

Asumsi (koreksi bila keliru): task berstatus `done`/`archived` tetap dihitung (masih data, bukan sampah).
Tombol "tutup" welcome card (`tf_dismiss_onboarding`) tetap dihormati seperti sekarang.

## 4. Desain

### 4.1 Prinsip

Welcome card hanya boleh tampil bila Alurik **yakin** akun kosong. Keyakinan itu ada bila perangkat ini
pernah menyelesaikan **pull task dan pull note yang sukses** untuk akun ini. Setelah itu data lokal adalah
cerminan server (ditambah perubahan lokal), jadi "lokal kosong" = "akun kosong", online maupun offline.

### 4.2 Tidak perlu endpoint server baru

Brainstorming awal mengusulkan `has_data` dari server. Setelah membaca kode: `fetchAll` sudah menunggu sync
penuh, dan pull task (`GET /api/tasks?include_done=true`) serta pull note (`GET /api/scratchpad`) memakai
klausa akses yang sama persis dengan definisi §3 (pribadi + workspace sebagai pemilik/anggota; note di Sampah
sudah dipindah ke `trashed_notes`, jadi tidak ikut). Hasil kedua pull itu sudah merupakan jawaban otoritatif.
Endpoint tambahan hanya mempercepat keputusan untuk akun yang memang baru, dan sync akun kosong sudah cepat.
Jadi: tanpa endpoint baru, tanpa perubahan backend.

### 4.3 Penanda sync awal

- Disimpan di `_meta` IndexedDB, kunci `initial_sync:v1`, nilai `{ user_id, at }`.
- Ditulis oleh `sync()` hanya bila **langkah pull task dan langkah pull note keduanya sukses** dalam satu
  putaran sync (langkah lain boleh gagal).
- Dibaca dengan memeriksa `user_id` sama dengan pengguna aktif (pertahanan tambahan; `_meta` sudah ikut
  dikosongkan `db.clearAll()` saat logout / ganti akun).
- Setelah ditulis, `sync()` mengirim event `tf:initial-sync` agar dashboard memperbarui tampilannya.

### 4.4 "Punya data lokal"

Fungsi `hasLocalData()`: ada record di store `tasks` dengan `!deleted`, **atau** record di store `notes`
dengan `!deleted`. Satu definisi, dipakai di satu tempat. (Record `deleted:true` = dihapus/di Sampah dan
belum/sudah dipush.)

### 4.5 Keputusan tampilan (fungsi murni)

Modul baru `static/offline/introgate.js`, pola UMD seperti modul offline lain, fungsi murni:

`decideIntro({ hasData, initialSyncDone, online, syncRunning, lastSyncFailed })` → salah satu:

| Kondisi (dicek berurutan) | Hasil | Tampilan |
|---|---|---|
| `hasData` | `dashboard` | Dashboard normal |
| `initialSyncDone` | `welcome` | Welcome card (online maupun offline) |
| `!online` | `offline_empty` | "Belum terhubung ke server — datamu akan muncul setelah online." |
| `syncRunning` | `syncing` | Skeleton + "Menyinkronkan data kamu dari server…" |
| `lastSyncFailed` | `sync_error` | "Gagal mengambil data dari server." + tombol **Coba lagi** |
| lainnya (belum mulai) | `syncing` | sama dengan di atas |

Welcome card tetap tunduk pada `tf_dismiss_onboarding` (hasil `welcome` + sudah ditutup → kartu Prioritas
biasa yang kosong, seperti sekarang).

### 4.6 Perubahan di `index.html`

- `sync()`: catat sukses/gagal langkah pull task & pull note; bila keduanya sukses → tulis penanda, dispatch
  `tf:initial-sync`. Tanpa mengubah urutan langkah, perilaku push, atau penanganan error yang ada.
- Status sync global kecil: `window.__syncState = { running, lastFailed }` + event `tf:sync-state` saat
  berubah (mulai / selesai / gagal), supaya Dashboard tahu `syncRunning` & `lastSyncFailed` tanpa prop baru
  dari App.
- `Dashboard`: hook `useIntroState(tasks)` → hitung `hasData` (cepat: `tasks.length > 0`; bila 0, baca
  `hasLocalData()` agar note ikut dihitung), baca penanda, `navigator.onLine` + event `online`/`offline`,
  dengarkan `tf:initial-sync`, `tf:sync-state`, `noteSaved`.
  - `welcome` → `DashOnboardingCard` (aturan dismiss tetap).
  - `syncing` / `offline_empty` / `sync_error` → kartu status di posisi welcome card (kelas CSS baru
    `dash-sync-card`), kartu Prioritas tidak dirender dengan isi kosong yang menyesatkan.
  - Kalimat ringkasan atas: `syncing` → "Menyinkronkan datamu…", `offline_empty` → "Menunggu koneksi untuk
    memuat datamu.", `sync_error` → "Datamu belum termuat."; "Selamat datang di Alurik!…" hanya untuk `welcome`.
- Tombol **Coba lagi** memanggil `window.__refreshTasks()` (fetchAll → sync).
- Tanpa progres angka ("128 dari 340"): pull tidak melaporkan progres per item; ditunda (YAGNI).

### 4.7 Di luar cakupan

Halaman lain (Today, Tasks, Notes) yang menampilkan kondisi kosong selama sync pertama; backend; perubahan
logika sync/konflik (lihat audit 2026-10-15).

## 5. Pengujian

- Unit node (`tests/offline/introgate.test.js`): tabel §4.5 lengkap, termasuk urutan prioritas
  (`hasData` mengalahkan semua; penanda ada + offline → `welcome`; tanpa penanda + offline → `offline_empty`).
- Unit node untuk `hasLocalData` dan baca/tulis penanda (fake-indexeddb, pola tes offline yang ada):
  task `deleted` saja → false; note saja → true; penanda akun lain → dianggap belum.
- Unit untuk `sync()`: penanda hanya ditulis bila pull task & note sukses; gagal salah satu → tidak ditulis.
- E2E Playwright (`temporary_files/e2e_dashboard_intro.py`): (a) akun lama, IndexedDB kosong, pull ditahan
  → kartu "Menyinkronkan", tidak ada teks "Selamat datang"; lepas → dashboard penuh. (b) akun baru → welcome.
  (c) akun lama, offline sejak awal di perangkat baru → `offline_empty`. (d) pull 500 → `sync_error` →
  Coba lagi → dashboard. (e) akun hanya punya note → bukan welcome. (f) hapus semua task+note → welcome,
  juga setelah reload offline. Terang + gelap.
- `pytest` penuh (versi SW), `npm test` penuh.

## 6. Rilis

Frontend saja → naik versi SW (nomor kosong berikutnya saat merge; cek `main`), `app.css?v=` naik bila CSS
berubah, `sw_cache` di `webapp.py` + `tests/test_version.py`. Restart `taskflow-web` hanya agar
`/api/version` melaporkan versi baru. Tanpa migrasi.
