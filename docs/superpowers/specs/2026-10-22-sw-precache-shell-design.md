# Spec: Precache service worker — app shell lengkap, atomik, dan hemat kuota

- **Tanggal:** 2026-10-22
- **Basis kode:** `main` @ `59c95ba` (mtyatno/taskflow-v4; SW v462, `app.css?v=362`)
- **Status:** arah perbaikan A–C disetujui pemilik 2026-10-22 23:25 WIB ("ok lanjut") setelah analisis bug. Belum diimplementasikan.
- **Salinan:** repo `docs/superpowers/specs/2026-10-22-sw-precache-shell-design.md` dan Project claude.ai "alurik" `claude/spec-sw-precache-shell-2026-10-22.md`. Isi keduanya sama.
- **Analisis:** Project `claude/analisis-bug-css-hilang-setelah-restart-2026-10-22.md`.
- **Istilah:**
  - *shell* = semua file yang wajib ada agar `index.html` tampil dan berjalan offline: `/`, `/config.js`, setiap `<script src>` dan `<link rel="stylesheet">` lokal di `static/index.html`, dan modul `static/offline/*` lain yang sudah di-precache;
  - *opsional* = file yang boleh diambil belakangan saat dipakai (ikon, manifest, font KaTeX, build tldraw);
  - *rilis* = kenaikan `CACHE` di `static/sw.js`.

---

## 1. Masalah

Laporan pemilik: setelah HP restart, Alurik (masih login) dibuka saat internet hidup tapi lambat, lalu tampil tanpa styling.

Akar masalah (dibuktikan di kode dan dengan simulasi `sw.js` asli di Node):

1. **`/static/app.css?v=362` tidak ada di `STATIC`.** File itu hanya masuk cache lewat cabang catch-all "Static assets" (`sw.js:491-502`) saat pernah dimuat online. `activate` menghapus semua cache versi lain (`sw.js:166`), jadi setiap rilis membuang app.css. Pembukaan pertama setelah rilis wajib mengambilnya dari jaringan. Bila gagal, catch-all membalas `Response("Offline", 503)` dan browser membuang stylesheet itu.
2. **`milkdown.bundle.js` tercatat tanpa query.** `index.html` memuat `/static/vendor/milkdown.bundle.js?v=289`, tetapi `STATIC` berisi `/static/vendor/milkdown.bundle.js`. Catch-all mencocokkan URL persis, jadi precache itu tidak pernah terpakai. Editor note (786 KB) bernasib sama dengan app.css.
3. **Install memakai `Promise.allSettled`** (`sw.js:149`). File yang gagal diunduh diabaikan, dan SW baru tetap terpasang dengan cache bolong (mis. `tailwind.min.css` 2,9 MB pada koneksi putus-putus). Saat aktif, SW itu menghapus cache lama yang lengkap.
4. **Setiap rilis mengunduh ulang seluruh precache dengan `cache: "reload"`**, termasuk file yang tidak berubah: ±115 entri `STATIC` dan ±230 aset tldraw, beberapa MB per rilis. Versi SW naik 6–15 kali per hari. Unduhan ini juga bersaing dengan request aplikasi di jaringan lambat.

Restart memicu masalah karena SW baru yang sudah ter-install di latar menunggu (`waiting`) sampai semua klien tertutup. Restart HP, atau menutup app dari recent apps, menutup semua klien, sehingga navigasi berikutnya mengaktifkan SW baru dan menghapus cache lama. Status login tidak terkait: token dan IndexedDB ada di luar Cache Storage.

## 2. Tujuan

**Kriteria berhasil**
1. Setelah SW baru aktif, setiap stylesheet dan skrip lokal yang dimuat `index.html` dilayani dari cache tanpa jaringan, termasuk `app.css` dan `milkdown.bundle.js` dengan query versinya.
2. SW baru hanya bisa terpasang bila seluruh shell berhasil disimpan. Bila satu file shell gagal, install gagal dan SW lama tetap aktif dengan cache lengkapnya. Kegagalan file opsional tidak menggagalkan install.
3. File yang tidak berubah sejak rilis sebelumnya cukup direvalidasi (304), tidak diunduh ulang penuh.
4. Tes otomatis menolak perubahan yang membuat `index.html` memuat file lokal yang tidak ada di shell dengan URL persis, atau yang mendaftarkan file shell yang tidak ada di repo.

## 3. Desain

### 3.1 Dua daftar precache di `static/sw.js`

- **`STATIC`** tetap menjadi daftar shell. Nama dipertahankan karena tes dan plan lain mengacu ke `const STATIC = [`, dan modul baru otomatis masuk shell dengan cara yang sudah biasa ("tambahkan ke STATIC").
  - Ganti `/static/vendor/milkdown.bundle.js` menjadi `/static/vendor/milkdown.bundle.js?v=289`.
  - Tambah `/static/app.css?v=362`.
  - Pindahkan entri non-shell ke `OPTIONAL_STATIC` (di bawah).
  - Isi lain tidak berubah, termasuk `"/"` dan `"/config.js"`.
- **`OPTIONAL_STATIC`** (baru): `/manifest.json?v=2`, keempat ikon `?v=2`, `/static/icon-new-task.svg`, ke-19 font KaTeX, `/static/vendor/tldraw/index.html`, `/static/vendor/tldraw/assets/index.js`, `/static/vendor/tldraw/assets/index.css`, dan `TLDRAW_ASSETS`. `TLDRAW_ASSETS` sekarang ditambahkan ke `OPTIONAL_STATIC`, bukan ke `STATIC`.
  - Alasan: file tldraw adalah hasil build saat deploy dan tidak ada di repo. Bila build gagal dan file itu ada di shell, install akan gagal selamanya. Ikon/manifest punya cabang network-first sendiri, dan font KaTeX hanya dipakai saat note berisi rumus.

### 3.2 Install atomik

```js
const freshRequest = url => new Request(url, { cache: "no-cache" });

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(STATIC.map(freshRequest))          // shell: atomik
        .then(() => Promise.allSettled(OPTIONAL_STATIC.map(u => cache.add(freshRequest(u))))))
      .then(() => { if (!self.registration.active) self.skipWaiting(); })
  );
});
```

- `cache.addAll` menolak dan tidak menyimpan apa pun bila satu request gagal atau berstatus non-2xx. Promise `waitUntil` ikut menolak, sehingga install gagal dan SW baru menjadi *redundant*.
- **Tidak ada `.catch` yang menelan kegagalan shell.** Kode lama memanggil `skipWaiting()` di `.catch` untuk install pertama. Itu dihapus: install pertama yang gagal hanya berarti halaman belum dikendalikan SW (tetap jalan online) dan dicoba lagi pada pemuatan berikutnya.
- `skipWaiting()` tetap hanya untuk install pertama (`!self.registration.active`) dan hanya setelah shell tersimpan.
- Cache bernama versi baru yang sempat dibuat oleh install gagal (berisi sebagian file opsional, atau kosong) tidak dipakai. Ia terhapus oleh `activate` berikutnya yang berhasil (filter `k !== CACHE`). Install ulang ke nama yang sama menimpa isinya.
- Browser mencoba update lagi pada navigasi berikutnya, saat `reg.update()` dipanggil di `load` / `visibilitychange`, dan tiap 30 menit (`index.html`). Dengan §3.3, percobaan ulang itu murah.

### 3.3 Revalidasi, bukan unduh ulang

- Semua request precache memakai `cache: "no-cache"`, menggantikan `"reload"`. Browser mengirim request bersyarat (`If-None-Match` / `If-Modified-Since`) bila HTTP cache punya entri. `StaticFiles` (Starlette) menjawab 304 untuk file yang tidak berubah, dan browser memakai isi HTTP cache sebagai respons 200 untuk `cache.add`.
- Konsistensi versi tetap terjaga karena setiap file divalidasi ke server. File yang berubah mendapat ETag baru dan diunduh penuh. `"reload"` sudah memperbarui HTTP cache, jadi rilis pertama setelah perubahan ini langsung bisa memanfaatkan 304.
- `/`, `/sw.js`, `/api/version` tetap `no-store` dari server (tidak berubah). `/` selalu diunduh penuh, dan itu wajar karena isinya berubah setiap rilis.

### 3.4 Yang tidak berubah

`activate`, seluruh cabang `fetch` (termasuk aturan S11 untuk `/`), cache suara latar `alurik-ambient-v1`, logika banner update di `index.html`, server, dan skema.

## 4. Interaksi dengan banner update (thread "apa yang baru")

Bila install gagal karena jaringan, `/api/version` tetap melaporkan versi baru sehingga banner "Pembaruan tersedia" bisa muncul tanpa SW `waiting`. `applyAppUpdate` lalu mengirim `SKIP_WAITING` ke SW aktif (tanpa efek) dan memuat ulang halaman. Muat ulang itu memicu percobaan install berikutnya, jadi pengguna tidak macet, tetapi versinya baru berganti setelah install berhasil. Perilaku banner menjadi cakupan thread "apa yang baru" (laporan pemilik 2026-10-22: banner muncul tapi SW seperti tidak berubah setelah reload). PR ini tidak mengubah logika banner. Catatan ini perlu dibawa ke thread tersebut.

## 5. Versi dan deploy

- SW **v464** `taskflow-v464-sw-precache-shell`. v463 dicadangkan untuk PR #84; periksa `main` sebelum merge karena nomor bisa bentrok dengan PR paralel. Ganti semua kemunculan versi lama di `static/`, `webapp.py` (`sw_cache`), dan `tests/`.
- `app.css` tidak berubah (`?v=362`).
- Deploy: file statis + `webapp.py` (`sw_cache`) → restart `taskflow-web` agar `/api/version` melaporkan v464. Tanpa migrasi.
- Rilis ini sendiri masih memakai jalur update lama di perangkat pengguna: SW lama (v462) yang menghapus cache saat SW baru aktif. Perlindungan berlaku mulai rilis sesudahnya, karena yang menjalankan install adalah SW baru.

## 6. Pengujian

- **Unit (`node --test`), file baru `tests/offline/sw_precache_shell.test.js`:**
  - setiap `<script src>` dan `<link rel="stylesheet" href>` lokal (diawali `/`) di `static/index.html` ada di `STATIC` dengan string persis;
  - setiap entri `STATIC` selain `/` dan `/config.js` menunjuk file yang ada di `static/` (query diabaikan);
  - `STATIC` dan `OPTIONAL_STATIC` tidak beririsan, dan `/static/sounds/` tidak ada di keduanya;
  - install memakai `cache: "no-cache"` dan tidak memakai `"reload"`;
  - harness install dengan Cache palsu yang `addAll`-nya atomik:
    - shell gagal satu → `waitUntil` menolak, tidak ada entri shell tersimpan, `skipWaiting` tidak dipanggil;
    - opsional gagal → install sukses, semua shell tersimpan;
    - install pertama (`registration.active` null) sukses → `skipWaiting` dipanggil;
  - siklus lengkap (pola `repro_css.js` dari analisis): SW lama aktif → SW baru install dengan jaringan gagal untuk satu file shell → cache lama tetap ada dan app.css offline 200. SW baru install sukses → aktif → app.css dan `milkdown.bundle.js?v=289` offline 200.
- **Python:** `tests/test_version.py` mengikuti v464. Satu tes bahwa `GET /static/app.css` dengan `If-None-Match` dari respons pertama menghasilkan 304 (bukti dasar §3.3).
- **E2E Playwright** `temporary_files/e2e_sw_precache_shell.py`, Chromium dengan konteks persisten untuk mensimulasikan restart:
  1. pemuatan online sampai SW aktif;
  2. naikkan versi SW di salinan server;
  3. muat ulang supaya SW baru ter-install, lalu tutup konteks (restart);
  4. buka lagi dengan request `app.css` dari jaringan dibatalkan.
  - Harapan: gaya dari app.css tetap diterapkan (variabel CSS dari app.css terbaca di `getComputedStyle`).
  - Skenario kedua: request `tailwind.min.css` dibatalkan saat install → SW lama tetap mengendalikan dan tampilan tetap bergaya.
  - Bandingkan dengan `main` (harapan: gagal di skenario pertama).
- Suite penuh: `npm test` (bandingkan dengan baseline `main`), `python -m pytest tests/ -q`, `node temporary_files/check_inline_scripts.js static/index.html`.

## 7. Di luar cakupan (tindak lanjut)

- **D.** Font Google (Nunito Sans) di-self-host dan di-precache. Stylesheet lintas origin itu render-blocking dan tidak pernah disimpan SW (respons opaque `ok=false`).
- **E.** Iframe mindmap `static/vendor/mind-elixir/index.html` dan asetnya (`MindElixir.iife.js?v=121`, `MindElixir.css?v=121`, modul offline ber-query seperti `mindmapops.js?v=8`) tidak di-precache dengan URL persis. Mindmap offline setelah rilis bisa rusak dengan cara yang sama. Tes penjaga §6 bisa diperluas ke halaman iframe.
- Perilaku banner update (§4).

## 8. ADR

Tambahkan **ADR-029: Precache SW — shell atomik dan revalidasi** ke `.agents/DECISIONS.md`. Isinya: konteks (§1), keputusan (§3.1–3.3), dan konsekuensi:
- update bisa tertunda sampai jaringan cukup baik untuk memvalidasi shell;
- setiap file baru yang dimuat `index.html` wajib ada di `STATIC` dengan URL persis (dijaga tes);
- tldraw/ikon/KaTeX tetap bisa hilang sampai dipakai online;
- perlindungan berlaku mulai rilis setelah v464.
