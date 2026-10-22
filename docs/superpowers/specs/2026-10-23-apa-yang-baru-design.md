# Spec: Banner pembaruan yang selalu berhasil + modal "Apa yang baru"

- **Tanggal:** 2026-10-23
- **Basis kode:** `main` @ `d950796` (mtyatno/taskflow-v4; SW v465 `taskflow-v465-note-lampiran-gambar`, `app.css?v=363`, ADR terakhir ADR-029)
- **Status:** desain disetujui pemilik per bagian (2026-10-22 23:18 – 2026-10-23 05:09 WIB). Belum diimplementasikan.
- **Salinan:** repo `docs/superpowers/specs/2026-10-23-apa-yang-baru-design.md` dan Project claude.ai "alurik" `claude/spec-apa-yang-baru-2026-10-23.md`. Isi keduanya sama.
- **Terkait:** spec precache `docs/superpowers/specs/2026-10-22-sw-precache-shell-design.md` §4 (perilaku banner diserahkan ke thread ini), ADR-029.
- **Istilah:**
  - *versi* = nilai `CACHE` di `static/sw.js`, mis. `taskflow-v466-apa-yang-baru`; *nomor versi* = angka setelah `taskflow-v` (466);
  - *SW menunggu* = `registration.waiting` (SW baru sudah ter-install lengkap, menunggu diaktifkan);
  - *halaman terkendali* = `navigator.serviceWorker.controller` tidak null;
  - *penanda* = `localStorage.tf_whatsnew_seen`, versi terakhir yang catatannya sudah dilihat di perangkat ini.

---

## 1. Masalah

### 1.1 Laporan pemilik (2026-10-22)

1. Banner "Pembaruan Alurik tersedia! Muat ulang…" muncul, tetapi setelah diklik SW seperti tidak berubah.
2. Permintaan: setelah memuat ulang, tampilkan modal berisi fitur baru yang kini bisa dipakai. Isinya ditulis agent saat merge di sebuah file, lalu dibaca aplikasi.

### 1.2 Akar masalah banner (direproduksi dengan uvicorn lokal + Chromium/Playwright, konteks persisten)

**A. Banner palsu sesudah deploy tanpa restart.** `checkForAppUpdate` (`index.html`, skrip terakhir) menganggap ada pembaruan bila `/api/version` ≠ `window.__SW_VERSION`. `/api/version` mengembalikan string yang ditulis langsung di `webapp.py` (`sw_cache = "…"`), yang baru berubah setelah `taskflow-web` di-restart. Deploy (`.github/workflows/deploy.yml`) tidak me-restart service. Akibatnya, setelah perangkat sudah pindah ke versi baru, server masih melaporkan versi lama, sehingga banner muncul lagi pada setiap `visibilitychange` atau interval 30 menit. Setiap klik hanya memuat ulang versi yang sama, dan ini berulang sampai service di-restart.
- Bukti: klik pertama v462→v900 berhasil, lalu banner muncul lagi dua kali dengan `page = v900`, `server = v462`, tanpa SW menunggu.

**B. Klik saat SW baru masih ter-install.** Banner juga muncul dari selisih `/api/version` saat SW baru masih `installing` (precache ±350 file). `applyAppUpdate` tidak menemukan `reg.waiting`, lalu mengirim `SKIP_WAITING` ke SW **aktif** (tanpa efek) dan memuat ulang setelah 300 ms. Halaman dimuat ulang oleh SW lama dari cache lama, versinya tidak berubah, dan banner kembali beberapa detik kemudian saat SW baru selesai ter-install.
- Bukti: saat klik `installing = true`, `waiting = false`. Setelah reload `page` tetap v900 sementara server v901. Empat detik kemudian `waiting = true` dan banner muncul lagi.

**C. Celah pendengar.** `trackInstall` hanya mendengarkan `updatefound` yang terjadi *setelah* pendaftaran. Bila halaman dibuka saat SW baru sudah `installing`, transisinya ke `installed` tidak pernah didengar. Banner baru muncul pada pengecekan berikutnya, yang bisa sampai 30 menit kemudian.

Sejak ADR-029, install SW bersifat atomik. Kalau satu file shell gagal diunduh, install gagal dan SW baru menjadi `redundant`. Alur banner harus memperlakukan kegagalan ini dengan jelas.

## 2. Tujuan

**Kriteria berhasil**
1. Di halaman terkendali, banner hanya muncul bila ada SW menunggu, dan klik "Perbarui Sekarang" selalu berakhir di versi baru.
2. Deploy tanpa restart tidak pernah memunculkan banner palsu.
3. Halaman yang dibuka saat SW baru sedang ter-install tetap memunculkan banner begitu install selesai, tanpa menunggu pengecekan berikutnya.
4. Setelah pindah ke versi yang membawa catatan untuk pengguna, modal "Apa yang baru" tampil sekali per perangkat. Rilis yang terlewat digabung, dan modal tetap tampil saat offline.
5. Setiap kenaikan versi SW di repo wajib disertai entri catatan. CI menolak PR yang lupa.

## 3. Desain

### 3.1 Alur pembaruan — modul `static/offline/appupdate.js` (`TF.appupdate`)

Logika banner dipindahkan dari skrip inline terakhir `index.html` ke modul murni dengan dependensi yang disuntikkan (`navigator`, `window`, `fetch`, `setTimeout`, `toast`), supaya bisa dites di Node dengan registration palsu. Modul memakai pola UMD yang sama dengan modul `static/offline/*` lain, dimuat lewat `<script src>`, dan masuk `STATIC`.

**Pelacakan registration (`track(reg)`):**
- Bila `reg.waiting` dan halaman terkendali → *siap*.
- Bila `reg.installing` sudah ada saat dilacak → pasang pendengar `statechange` pada worker itu (menutup celah C).
- `updatefound` → pasang pendengar pada `reg.installing` baru.
- Pendengar worker: `installed` dan halaman terkendali → *siap*; `redundant` → *gagal* (lihat pengecekan manual).
- *Siap* = `window.__APP_UPDATE_AVAILABLE = true` dan event `appupdateavailable`. Nama ini dipertahankan karena dipakai `App`.

**Pengecekan otomatis** (`visibilitychange` → visible, dan setiap 30 menit):
- Halaman terkendali:
  - bila sudah ada SW menunggu → *siap* (banner yang ditutup muncul lagi, seperti sekarang);
  - bila tidak ada SW menunggu atau ter-install, ambil `/api/version`. Bila `sw_version` ≠ `window.__SW_VERSION`, panggil `reg.update()`. **Selisih versi tidak pernah memunculkan banner secara langsung.** Banner hanya datang dari *siap*.
- Halaman tidak terkendali (browser tanpa SW, pendaftaran SW gagal, atau setelah hard reload): selisih `/api/version` → *siap*. Klik lalu memuat ulang halaman biasa, dan ini aman karena `/` disajikan `no-store`.
- `/api/version` gagal (offline) → abaikan.

**Pengecekan manual** (tombol "Cek Pembaruan" di Pengaturan):
- Halaman terkendali: `await reg.update()`, lalu:
  - ada SW menunggu → *siap* + toast "Pembaruan tersedia! Silakan muat ulang.";
  - ada SW ter-install → toast "Mengunduh pembaruan…", lalu toast lagi saat worker itu menjadi `installed` ("Pembaruan tersedia! Silakan muat ulang.") atau `redundant` ("Pembaruan gagal diunduh, coba lagi saat koneksi stabil.");
  - tidak ada keduanya → toast "Aplikasi sudah dalam versi terbaru";
  - `reg.update()` gagal → toast "Gagal memeriksa pembaruan".
- Halaman tidak terkendali: bandingkan `/api/version` seperti pengecekan otomatis, lalu tampilkan toast "tersedia" atau "terbaru".

**Menerapkan pembaruan (`apply()`, tombol "Perbarui Sekarang"):**
- Ada SW menunggu → `postMessage({type: "SKIP_WAITING"})`. Pendengar `controllerchange` yang sudah ada (dengan penjaga `refreshing`) memuat ulang halaman saat SW baru mengambil alih.
- Pengaman: bila `controllerchange` tidak terjadi dalam 5 detik → `location.reload()`.
- Tidak ada SW menunggu → `location.reload()`.
- Tombol berubah menjadi "Memperbarui…" (nonaktif) setelah diklik.

**Skrip inline di akhir `index.html`** hanya berisi pemasangan: membuat updater, `navigator.serviceWorker.register("/sw.js")` → `track(reg)` + `reg.update()`, pendengar `controllerchange`, `visibilitychange`, dan interval. `window.applyAppUpdate` dan `window.checkForAppUpdate` tetap ada sebagai pembungkus updater. Bila `TF.appupdate` tidak termuat, skrip tetap mendaftarkan SW dan memuat ulang pada `controllerchange`, sehingga aplikasi tidak pernah terkunci di versi lama.

### 3.2 `/api/version` membaca `static/sw.js`

- `GET /api/version` mengambil versi dari baris `const CACHE = "…";` di `STATIC_DIR / "sw.js"`. Hasilnya disimpan di memori proses dengan kunci `(st_mtime_ns, st_size)` file, jadi hanya dibaca ulang bila file berubah.
- Bentuk respons dan header tidak berubah: `app_version` "4.0.0", `sw_version` = `cache_name` = versi itu, `timestamp`, dan `Cache-Control: no-cache, no-store, must-revalidate`.
- File tidak terbaca atau baris tidak cocok → 500 dengan log. Klien sudah mengabaikan respons non-ok.
- Baris `sw_cache = "…"` di `webapp.py` dihapus. Kenaikan versi berikutnya tidak lagi menyentuh `webapp.py`, dan `/api/version` langsung benar setelah deploy tanpa restart.
- Tes Node yang selama ini memeriksa `sw_cache = "…"` di `webapp.py` diubah. Pemeriksaan baris itu dihapus, pemeriksaan versi di `sw.js` dan `index.html` dipertahankan.

### 3.3 `static/whatsnew.json`

```json
{
  "entries": [
    {
      "version": "taskflow-v466-apa-yang-baru",
      "date": "2026-10-23",
      "title": "Catatan pembaruan",
      "new": ["Setelah Alurik diperbarui, muncul ringkasan fitur baru seperti ini."],
      "fixed": ["Tombol Perbarui Sekarang kini benar-benar memasang versi terbaru."]
    },
    { "version": "taskflow-v465-note-lampiran-gambar", "date": "2026-10-23", "title": "…", "fixed": ["…"] }
  ]
}
```

**Aturan isi** (dijaga `tests/test_whatsnew.py`):
1. Objek dengan kunci `entries` (array tidak kosong). Kunci memakai bahasa Inggris, isi teks memakai bahasa Indonesia.
2. Setiap entri punya `version` (cocok `^taskflow-v\d+-[a-z0-9-]+$`) dan `date` (`YYYY-MM-DD`, tanggal valid).
3. Nomor versi turun tegas dari atas ke bawah (tanpa ganda). Celah nomor diperbolehkan.
4. `version` entri teratas sama persis dengan `CACHE` di `static/sw.js` dan `window.__SW_VERSION` di `static/index.html`.
5. Entri `"silent": true` tidak boleh punya `title`, `new`, atau `fixed`. Entri non-silent wajib punya `title` (≤ 60 karakter) dan minimal satu poin di `new` atau `fixed`.
6. `new` dan `fixed` (bila ada) berupa array string. Setiap poin tidak kosong, maksimal 140 karakter, tanpa `<`, `>`, atau baris baru.
7. Tidak ada kunci lain di luar `version`, `date`, `title`, `new`, `fixed`, `silent`.
8. Ukuran file ≤ 64 KB. Bila terlampaui, hapus entri paling lama.

**Gaya tulisan** (dijaga lewat aturan agent dan review pemilik, bukan tes):
- Kalimat dari sudut pandang pengguna, tentang apa yang sekarang bisa dilakukan atau apa yang sudah beres.
- Satu kalimat per poin, memakai istilah yang tampil di UI (mis. "Sketsa", "Checklist").
- Tanpa nama file, PR, branch, endpoint, atau istilah teknis.

**Kapan entri dibuat silent:** bila rilis tidak mengubah apa pun yang terasa oleh pengguna, misalnya refactor, tes, dokumentasi, atau perubahan internal tanpa efek yang terlihat.

### 3.4 Precache

- `"/static/whatsnew.json"` dan `"/static/offline/whatsnew.js"`, `"/static/offline/appupdate.js"` ditambahkan ke `STATIC` di `static/sw.js` (shell atomik, ADR-029). Hanya daftar `STATIC` yang diubah. Install, activate, dan fetch tidak berubah.
- Aplikasi memuat catatan dengan `fetch("/static/whatsnew.json", {cache: "no-cache"})`, bukan lewat `apiUrl`, karena ini aset statis seperti `/config.js`. Di halaman terkendali, permintaan dilayani cabang catch-all *cache-first* dari cache versi yang sedang berjalan, sehingga isinya selalu cocok dengan versi itu dan tersedia offline. Tanpa SW, `no-cache` memaksa revalidasi.

### 3.5 Logika tampil — modul `static/offline/whatsnew.js` (`TF.whatsnew`)

Fungsi murni (dites di Node):
- `versionNumber(v)` → bilangan dari `^taskflow-v(\d+)`, atau `null`.
- `pickUnseen({entries, current, seen, hadUser, limit = 10})` → `{entries, hiddenCount}`:
  - `current` tidak terbaca → kosong;
  - `seen` kosong/tidak terbaca: `hadUser` → hanya entri non-silent dengan nomor = nomor `current`; selain itu kosong;
  - selain itu: entri non-silent dengan `nomor(seen) < nomor ≤ nomor(current)`, diurutkan menurun, diambil `limit` teratas, dan `hiddenCount` = sisanya.
- `history({entries, current, limit = 10})` → entri non-silent dengan nomor ≤ nomor `current`, menurun, `limit` teratas.
- `shouldMarkSeen(seen, current)` → benar bila `seen` kosong/tidak terbaca atau `nomor(seen) < nomor(current)`. Penanda tidak pernah diturunkan, jadi rollback tidak membuat modal yang sama muncul dua kali.
- `formatDate("2026-10-23")` → "23 Okt 2026".
- `load(fetchFn)` → array `entries`, atau `null` bila gagal atau bentuknya salah.

**Alur di `App`** (sekali per pemuatan halaman, setelah `user` terisi; tidak berjalan di halaman login):
1. `hadUser` diambil di skrip awal `<body>` sebelum render: `localStorage.tf_user_id` atau `tf_token` sudah ada sebelum halaman dimuat. Nilainya disimpan di `window.__TF_HAD_USER_AT_LOAD`.
2. Tunggu sampai tidak ada tur halaman yang aktif (`document.body.classList.contains("driver-active")` bernilai salah; dicek ulang setiap 1 detik).
3. `load()` gagal → berhenti tanpa mengubah penanda.
4. `pickUnseen(...)` kosong → bila `shouldMarkSeen`, isi penanda dengan `current`. Selesai.
5. Ada entri → tampilkan modal. Saat modal ditutup (tombol "Mengerti", ✕, klik di luar, atau Esc) → bila `shouldMarkSeen`, isi penanda dengan `current`.
6. Selama modal terbuka, pendengar `storage` menutupnya bila tab lain mengisi penanda dengan nomor ≥ `current`.

Penanda tidak dihapus saat logout dan tidak dimasukkan ke daftar kunci `clearLocalUserData`.

### 3.6 Tampilan

**Modal `WhatsNewModal`** (`index.html`, gaya di `app.css` dengan kelas `whatsnew-*`):
- Memakai pola `modal-overlay` yang sudah ada, dengan `role="dialog"`, `aria-modal="true"`, dan `aria-labelledby` ke judul. Fokus awal ada di tombol "Mengerti", dan Esc menutup modal.
- Judul "Apa yang baru di Alurik".
- Setiap rilis menampilkan judul dan tanggal (`formatDate`), lalu kelompok **Baru** (ikon `sparkles`) dan **Diperbaiki** (ikon `wrench`) dengan poin-poin. Kelompok kosong tidak ditampilkan.
- Bila `hiddenCount > 0`: keterangan "dan N pembaruan lain sebelumnya" di bawah daftar.
- Satu tombol utama, "Mengerti".
- Lebar maks ±520 px. Di HP lebarnya mengikuti layar dengan gutter 16 px, dan isinya bisa digulir (`max-height` ±80vh). Warna memakai variabel tema, jadi mode gelap ikut.
- Teks dirender sebagai teks React biasa, bukan `dangerouslySetInnerHTML`.

**Banner `UpdateNotificationBanner`:** emoji 🚀 dan 🔄 diganti komponen `Icon` (ikon garis yang sudah ada). Teks pesan tidak berubah. Setelah tombol "Perbarui Sekarang" diklik, labelnya menjadi "Memperbarui…" dan tombol nonaktif.

**Pengaturan, kartu "Pembaruan Aplikasi":**
- Emoji 🔍 di "Cek Pembaruan" diganti `Icon search`.
- Tombol sekunder baru "Apa yang baru" membuka modal yang sama dalam mode riwayat (`history`, 10 rilis non-silent terakhir). Mode ini tidak mengubah penanda.
- Bila catatan gagal dimuat → toast "Catatan pembaruan belum tersedia".

`app.css?v=` naik satu, dan entri `app.css?v=` di `STATIC` ikut diubah (dijaga tes precache).

### 3.7 Aturan untuk agent

**`.agents/PROTOCOL.md`** mendapat bagian baru "Checklist rilis frontend (setiap kenaikan versi SW)":
1. Naikkan `CACHE` di `static/sw.js` dan `window.__SW_VERSION` (beserta fallback-nya) di `static/index.html`, lalu sesuaikan tes yang memeriksa versi.
2. Bila `app.css` berubah: naikkan `app.css?v=` di `index.html` **dan** entri yang sama di `STATIC`.
3. Tambahkan entri teratas di `static/whatsnew.json` untuk versi itu, di PR yang sama, sesuai aturan §3.3. Rilis tanpa perubahan yang terasa oleh pengguna ditulis sebagai `{"version", "date", "silent": true}`.
4. Saat menggabungkan `main` dan nomor versi bentrok: pertahankan entri yang sudah ada di `main` apa adanya, naikkan versi PR ini di semua tempat termasuk `version` entrinya, dan pastikan entri itu tetap paling atas.
5. Jalankan `python -m pytest tests/test_whatsnew.py tests/test_version.py -q` sebelum push.

**`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`:** satu butir di aturan wajib berbunyi: "Setiap kenaikan versi SW wajib mengikuti *Checklist rilis frontend* di `.agents/PROTOCOL.md`, termasuk entri `static/whatsnew.json`. Isinya tampil ke pengguna sebagai modal 'Apa yang baru' setelah mereka memperbarui Alurik."

### 3.8 Yang tidak berubah

- `install`, `activate`, dan seluruh cabang `fetch` di `sw.js`.
- `skipWaiting` otomatis hanya untuk install pertama.
- Pesan `SKIP_WAITING`, dan perilaku semua tab memuat ulang saat SW baru mengambil alih.
- Skema database dan bot.

## 4. Versi, isi awal, deploy

- **SW v466** `taskflow-v466-apa-yang-baru`, `app.css?v=364`. Periksa `main` sebelum merge karena nomor bisa bentrok dengan PR paralel.
- **Isi awal `whatsnew.json`:** entri v466 ditambah entri yang ditulis ulang dari rilis yang sudah di-merge (v465, v464, v463, v462, v461, v460, v458, v457, v456; diambil dari `.agents/CURRENT_STATE.md`), supaya "Apa yang baru" di Pengaturan langsung berisi. Kalimatnya bisa disunting pemilik saat review PR.
- **Deploy:**
  - file statis + `webapp.py`; restart `taskflow-web` **sekali**, dan setelah itu `/api/version` tidak lagi butuh restart;
  - tanpa migrasi;
  - sebelum restart, proses lama masih melaporkan v465. Di klien v466, selisih itu hanya memicu `reg.update()`, tidak memunculkan banner palsu.
- **Perpindahan v465 → v466** masih dijalankan kode banner lama di perangkat pengguna, jadi bug B masih bisa terjadi sekali di perpindahan ini. Perbaikan berlaku penuh mulai rilis sesudahnya. Modal v466 tetap tampil setelah reload karena kodenya sudah baru, dan pengguna lama tanpa penanda mendapat entri v466 lewat aturan `hadUser`.
- **Aplikasi desktop/Android (Tauri):** `scripts/build-tauri-dist.js` menyalin seluruh `static/`, jadi `whatsnew.json` ikut terbawa dan modal muncul setelah aplikasi diperbarui. Ini diverifikasi di plan; perilaku tanpa SW mengikuti §3.1 "tidak terkendali".

## 5. Pengujian

**Node (`node --test`), dijalankan juga dari pytest lewat pembungkus pola `tests/test_sw_precache_node.py`, karena CI hanya menjalankan pytest:**
- `tests/offline/whatsnew.test.js`: semua cabang `pickUnseen`, `history`, `shouldMarkSeen` (termasuk rollback dan penanda rusak), `formatDate`, dan `load` (gagal, bentuk salah).
- `tests/offline/app_update_flow.test.js` dengan registration/worker palsu:
  - SW menunggu saat dilacak → siap;
  - `installing` sudah ada saat dilacak → siap setelah `installed` (celah C);
  - pengecekan otomatis dengan selisih `/api/version` → `reg.update()` dipanggil, banner **tidak** muncul (bug A);
  - halaman tidak terkendali dengan selisih → siap;
  - `apply()` dengan SW menunggu → `SKIP_WAITING` ke worker menunggu, bukan ke SW aktif (bug B); pengaman 5 detik → reload;
  - manual: toast "mengunduh" lalu "gagal" saat `redundant`;
  - modul tidak ada → skrip inline tetap mendaftarkan SW (dicek dari sumber `index.html`).
- `tests/offline/app_update_notifier.test.js` diperbarui mengikuti teks dan ikon baru.

**Python:**
- `tests/test_whatsnew.py`: semua aturan §3.3, ditambah `whatsnew.json`, `whatsnew.js`, dan `appupdate.js` ada di `STATIC`.
- `tests/test_version.py`: `sw_version` = `CACHE` yang dibaca dari `sw.js` (bukan string tetap), header tidak berubah, dan setelah isi `sw.js` (salinan sementara lewat `STATIC_DIR` yang di-monkeypatch) diubah, respons ikut berubah tanpa restart.

**E2E Playwright `temporary_files/e2e_apa_yang_baru.py`** (uvicorn lokal + Chromium dengan konteks persisten; dikembangkan dari skrip reproduksi §1.2). Dijalankan pada `main` (skenario 1–2 harus gagal) dan pada branch ini (semua lolos):
1. Deploy tanpa restart: setelah pindah versi tidak ada banner palsu, termasuk setelah `visibilitychange`.
2. Banner hanya muncul setelah SW menunggu, dan satu klik → versi baru.
3. Setelah reload, modal menampilkan entri yang tepat. Jaringan diputus lalu halaman dimuat ulang dengan penanda dihapus → modal tetap tampil dari cache.
4. Dua tab: menutup modal di satu tab menutup modal di tab lain.
5. Perangkat baru (login di halaman ini) → modal tidak tampil dan penanda terisi.
6. Pengaturan → "Apa yang baru" → mode riwayat.

**Suite penuh:**
- `python -m pytest tests/ -q`;
- `npm test`, dibandingkan dengan baseline `main`;
- `node temporary_files/check_inline_scripts.js static/index.html`;
- `node --test tests/build-tauri-dist.test.js`.

## 6. Koordinasi dan risiko

- **PR paralel yang masih menaikkan `sw_cache` di `webapp.py`** akan bentrok dengan penghapusan baris itu. Penyelesaiannya: buang baris tersebut. Catatan ini ditulis di `.agents/CURRENT_STATE.md`.
- **Bentrok entri teratas `whatsnew.json`** antar-PR paralel diselesaikan dengan checklist §3.7 butir 4. Tes menolak hasil gabungan yang salah urut atau tidak cocok dengan `CACHE`.
- **Kalimat yang terlalu teknis** dicegah lewat aturan agent dan review pemilik di setiap PR, karena tes tidak bisa menilainya.
- **Banner yang ditutup muncul lagi** pada pengecekan berikutnya selama masih ada SW menunggu. Perilaku ini sama dengan sekarang dan sengaja dipertahankan.

## 7. Di luar cakupan

- Tombol "Coba" per poin yang membuka halaman fitur (keputusan pemilik: versi pertama teks saja).
- Penanda per akun (penanda per perangkat sudah cukup).
- Pengumuman dari server di luar rilis.

## 8. ADR

Tambahkan **ADR-030: Banner pembaruan berbasis SW menunggu + catatan `whatsnew.json`** ke `.agents/DECISIONS.md`:
- **konteks:** §1;
- **keputusan:** §3.1, §3.2, §3.3, §3.5, dan §3.7;
- **konsekuensi:**
  - setiap kenaikan versi SW wajib menyertakan entri `whatsnew.json` (dijaga CI);
  - `webapp.py` tidak lagi menyimpan versi SW;
  - `/api/version` hanya pemicu `reg.update()` di halaman terkendali;
  - perbaikan banner berlaku mulai rilis setelah v466.
