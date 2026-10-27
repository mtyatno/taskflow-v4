# Spec: Latar yang bisa dipilih untuk hero Dashboard dan kartu Pomodoro + restyle kartu Pomodoro

- **Tanggal:** 2026-10-27
- **Basis kode:** `main` @ `ce4ccd1` (SW `taskflow-v482-tema-dekorasi`, `app.css?v=378`, `themes.css?v=2`)
- **Branch:** `claude/latar-hero`
- **Status:** disetujui Bapak 2026-10-27 14:34 WIB ("masukkan semuanya, dan kerjakan dengan baik").
- **Mockup:** kanvas Design "Hero Dashboard Alurik", halaman **"Pilihan latar"** (papan G) dan bagian E (kartu Pomodoro). Salinan sumber di `docs/superpowers/specs/2026-10-27-latar-hero/`:
  - `mockup_gen.py` — generator mockup (semua warna, komposisi SVG, tata letak kartu); **acuan visual utama**.
  - `topo_gradasi_d.txt` — data garis kontur latar Gradasi (12,6 KB).
  - `pomodoro_mockup.dc.html` — mockup kartu Pomodoro terang/gelap (bagian E).
  - `latar-sheet.jpg`, `pengaturan.jpg` — tangkapan mockup yang disetujui.

## 1. Permintaan dan keputusan

| Topik | Keputusan |
|---|---|
| Pilihan latar | 6: **Kontur** (bawaan = latar hero Dashboard sekarang), **Gradasi** (mesh + kontur), **Lanskap**, **Galaksi** (quest/piksel), **Objek 3D**, **Polos** |
| Tempat berlaku | Satu pilihan untuk **hero Dashboard dan kartu Pomodoro** Fokus Hari Ini |
| Tempat memilih | Bagian baru **"Latar"** di Pengaturan › Tampilan (kartu pratinjau per latar) |
| Penyimpanan | Per perangkat (`localStorage`), seperti palet; tidak disinkron, tidak dihapus saat logout; jalan 100% offline |
| Warna | Ikut **palet** (Default/Sakura/Lavender) dan **mode**: versi terang = pastel (teks gelap), versi gelap = pekat (teks terang). Galaksi/Objek 3D tetap terang di mode terang |
| Kartu Pomodoro | Mode terang **tidak lagi gelap**; mode gelap ikut palet (bukan navy tetap). Warna bermakna tetap (merah fokus, hijau istirahat, ungu overtime, kuning Jeda) |
| Teknologi | CSS + SVG inline, tanpa gambar raster; hanya latar terpilih yang digambar |

## 2. Sumbu tampilan baru: latar

- `localStorage.tf_herobg` ∈ `kontur | gradasi | lanskap | galaksi | objek | polos`; nilai lain/hilang → `kontur`.
- Atribut `<html data-herobg="…">`, dipasang **skrip boot `#tf-theme-boot`** (sebelum render, tanpa kilatan) dan oleh `TF.themes.apply`.
- `TF.themes`: `KEYS.herobg = "tf_herobg"`, `HEROBGS` (daftar id), `DEFAULT_PREFS.herobg = "kontur"`; `readPrefs`/`writePrefs`/`resolve`/`apply` menangani `herobg` dengan pola yang sama seperti `decor` (writePrefs hanya menulis kunci yang ada di patch dan sah). Tes paritas boot (`theme_boot.test.js`) diperluas.
- `useThemeAttrs()` ikut mengembalikan `herobg` (MutationObserver juga memantau `data-herobg`).
- App: `setThemePrefs({ herobg })` berlaku langsung tanpa muat ulang.

## 3. Registri latar — `static/offline/herobg.js` (`window.TF.herobg`)

Modul UMD murni (pola `decor.js`/`habitlogic.js`), di-precache di `sw.js` dengan URL persis.

- `KINDS`: `[{ id:"kontur", name:"Kontur", badge:"Bawaan" }, { id:"gradasi", name:"Gradasi" }, { id:"lanskap", name:"Lanskap" }, { id:"galaksi", name:"Galaksi" }, { id:"objek", name:"Objek 3D" }, { id:"polos", name:"Polos" }]`.
- `SCHEMES[palette][mode]` — tabel warna per latar (Gradasi: `m0..m4`, garis; Lanskap: langit, matahari/bulan, bukit, kabut, tanah, pohon; Galaksi: dasar, piksel, jalur, simpul, menara; Objek 3D: dasar, ubin, bola, buku, jam). Nilainya **disalin dari `mockup_gen.py`** (`MESH`, `LAND`, `GAL`, `OBJ`, `OBJBASE`). Palet tanpa entri → pakai skema `default` (palet baru tetap tampil benar sebelum diberi skema sendiri).
- **Kontur dan Polos hanya memakai token CSS** (`var(--bg-card)`, `var(--accent-soft)`, `var(--accent)`, `var(--accent-duo)`, `var(--accent-text)`, `var(--text-secondary)`), sehingga Kontur identik dengan hero sekarang dan otomatis ikut palet apa pun.
- `render({ kind, palette, mode, place, uid })` → `{ base, ambient, feature }`:
  - `base`: string CSS `background` (gradien, matahari/bulan sebagai `radial-gradient` berjari-jari px agar tetap bulat);
  - `ambient`: string SVG lapisan penuh kartu (kontur, garis gradasi, bukit, piksel/bintang/jalur, bola kabur);
  - `feature`: string SVG elemen utama (ilustrasi palet, pohon, menara kristal / baris jalur misi, kelompok objek 3D), digambar dalam **kotak fitur** yang posisinya diatur CSS per tempat;
  - `place` ∈ `hero | pomo | thumb` menentukan komposisi (lihat `place_boxes` dan cabang `place` di `mockup_gen.py`: mis. Galaksi di Pomodoro tanpa jalur di atas isi, piksel hanya tepi kanan; Objek 3D di Pomodoro berupa baris kecil; Lanskap di Pomodoro: bukit mulai 48% tinggi, pohon di pojok kiri bawah).
  - Semua `id` SVG diawali `uid` (unik per instance) — banyak latar bisa tampil bersamaan (pratinjau Pengaturan).
  - Deterministik (RNG berbiji); tanpa `<script`, tanpa `url(` selain rujukan internal `url(#<uid>…)`, tanpa sumber eksternal; tanpa animasi.
- Ukuran: total modul ≲ 60 KB mentah, **≤ 16 KB gzip** (terukur 2026-10-27: 47,8 KB mentah / 15,8 KB gzip; dijaga `herobg.test.js`). Target awal ≲ 15 KB gzip tidak tercapai: logika render 6 latar × 3 tempat beserta komentarnya sendiri ±13 KB gzip; data kontur Gradasi sudah dipadatkan tanpa mengubah gambar (koordinat ×2 bulat, perintah relatif, subjalur di luar viewBox dibuang: 5,9 → 2,1 KB gzip).

## 4. Komponen `HeroBackdrop({ place, kind })` (index.html)

- `kind` bawaan = `useThemeAttrs().herobg`; `palette`/`theme` dari hook yang sama; hasil `render` di-`useMemo` per kombinasi.
- Markup: `div.hb.hb-<place>.hb-k-<kind>` (`aria-hidden="true"`, `position:absolute; inset:0; z-index:0; pointer-events:none; border-radius:inherit; overflow:hidden`, `style.background = base`) berisi `div.hb-ambient` dan `div.hb-feature` (keduanya `dangerouslySetInnerHTML` dari registri — sumber internal statis, bukan data pengguna; sama dengan `Decor`).
- Kotak fitur (CSS): hero → di celah antara teks dan ring (`right: 226px; top: 4px; width: 290px; height: 140px`); pomo → pita kosong kanan baris tombol (`right: 28px; top: 68px; width: 340px; height: 62px`); thumb → kanan (`right: 6px; top: 4px; width: 86px; bottom: 4px`).
- Fitur disembunyikan bila `html[data-decor="off"]`, di lebar ≤ 1100 px, dan di tata letak HP; lapisan ambient + base tetap.
- Hero/kartu yang sempit di desktop (> 1100 px dengan menu lengkap): kotak fitur tetap berukuran px, jadi fitur disembunyikan per latar menurut lebar **isi** kartu (`container` inline-size, hanya > 1100 px) bila gambarnya tidak muat di celah yang tersedia. Hero: tepi kiri gambar (isi − 490 + d, d = tepi kiri gambar di kotak: Objek 3D 5, Galaksi 100, Kontur 151, Lanskap 225 px) harus ≥ kolom teks 420 + 16 px → ambang isi ≤ 920 / 825 / 774 / 701 px. Kartu Pomodoro: ambang per status (berjalan/Overtime/menunggu) terhadap ujung baris tombol. 1280 px dengan sidebar ikon = semua fitur tampil.
- Kartu yang memakai base sebagai latarnya sendiri (hero, Pomodoro) memanggil `useHeroBackdrop` sekali dan merender lapisannya lewat `HeroBackdropLayer({ bd, cardBase })`; `HeroBackdrop` (hook + lapisan) untuk pratinjau Pengaturan.

## 5. Hero Dashboard

- `.dash-hero` memakai `HeroBackdrop place="hero"`; topografi (`DASH_HERO_TOPO`) dan `DashHeroIllus` pindah ke registri (cabang `kontur`). Dengan latar Kontur tampilan **sama dengan sekarang** (gerbang tangkapan piksel).
- Isi hero (chip, ring, tangkap cepat) tidak berubah strukturnya; `Decor slot="page-corner"` tetap.
- Kontras teks hero di atas latar ramai (diukur dari piksel latar nyata, semua latar × palet × mode): chip bertint (streak, terlambat, habit selesai) = tint dicampur ke `--bg-card` (alas kartu; di zona teks Kontur identik dengan sebelumnya), chip transparan (+N / Lihat habit, habit dilewati) = `--bg-card` 80%; tinta aksen chip (`--hero-ink`) = aksen dicampur 20% ke `--text-primary` di mode terang (Default `#6B8000` hanya 4,45:1 di atas putih); merah "terlambat" mode terang `#b91c1c`; petunjuk "Enter" = `--text-secondary`; teks sekunder hero (tanggal, ringkasan, +N) dicampur 20% ke `--text-primary` hanya di atas Gradasi/Lanskap/Galaksi/Objek 3D. Latar Kontur di 1280 px tetap identik piksel dengan `main` kecuali warna chip tersebut.

## 6. Kartu Pomodoro (`.focus-pomo`) — restyle

Acuan: `pomodoro_mockup.dc.html` + kartu Pomodoro di `mockup_gen.py` (`pomo()`).

- Latar dari `HeroBackdrop place="pomo"`; ditambah cahaya fase (`radial-gradient` warna fase, 0.10 terang / 0.20 gelap) dan **piringan lembut di belakang ring** (`--bg-card` beralfa 0.8→0.6 terang, 0.62→0.45 gelap) agar waktu terbaca di latar ramai.
- Semua warna teks/garis/tombol sekunder memakai token: teks `--text-primary/secondary`; tombol sekunder (Lewati, Stop, Zen, pilihan Work/Short/Long, select suara) = latar `--bg-card` (terang) / putih 0.08 (gelap) + garis `rgba(text, .12/.16)`; kotak task aktif = putih 0.78 (terang) / hitam 0.18 (gelap); input parkir bergaris bawah `rgba(text, .12/.16)`.
- **Warna bermakna tetap**; versi teks di mode terang lebih tua agar kontras: merah `#dc2626`, hijau `#15803d`, ungu overtime `#6d28d9`; di mode gelap tetap `#f87171`, `#4ade80`, `#c4b5fd`. Tombol utama (Mulai/Jeda/Ambil Istirahat/Lanjut Fokus) tidak berubah.
- Bar ringkas sticky (`.focus-mini`): terang = `--bg-card` + garis + bayangan; gelap = `--bg-card` palet. Tanpa latar ilustrasi.
- Tata letak HP (≤ 768 px) tidak berubah strukturnya; latar ambient tetap, fitur disembunyikan.
- Zen Mode, Overtime, istirahat, menunggu pilihan: perilaku tidak berubah.

## 7. Pengaturan › Tampilan

- Bagian **"Latar"** setelah "Palet": keterangan "Untuk bagian atas Dashboard dan kartu Pomodoro di Fokus Hari Ini."; `role="radiogroup" aria-labelledby` → label tampak "Latar" (`#theme-herobg-label`), grid 3 kolom (2 kolom < 560 px); tiap kartu = `<button role="radio" aria-checked>` berisi pratinjau `HeroBackdrop place="thumb" kind=<id>` (dengan palet & mode aktif) + nama + lencana "Bawaan" untuk Kontur; terpilih: garis 2 px `--accent` + cincin `--accent-ring` + centang. Panah kiri/kanan berpindah pilihan (pola radiogroup Mode bila ada); Home/End ke pilihan pertama/terakhir.
- Pratinjau Tampilan menambah strip hero mini (latar terpilih + sapaan contoh) di atas pratinjau yang sudah ada.
- Teks UI persis: `"Latar"`, `"Untuk bagian atas Dashboard dan kartu Pomodoro di Fokus Hari Ini."`, `"Kontur"`, `"Bawaan"`, `"Gradasi"`, `"Lanskap"`, `"Galaksi"`, `"Objek 3D"`, `"Polos"`.

## 8. Rilis

SW `taskflow-v483-latar-hero` (cek `main` saat merge), `app.css?v=379`, entri `whatsnew`: judul "Latar Dashboard dan Pomodoro bisa dipilih"; poin: pilih latar di Pengaturan › Tampilan (enam pilihan, ikut tema terang/gelap dan palet); kartu Pomodoro kini terang di mode terang. File statis saja (tanpa restart).

## 9. Pengujian

- Node: `herobg.test.js` (semua `kind × palet × mode × place` me-render; id unik antar dua render; tanpa `<script`/`url(` eksternal/`javascript:`; deterministik; Kontur/Polos tanpa hex; skema lengkap untuk tiap palet di `TF.themes.PALETTES`; palet tak dikenal → skema default; **kontras**: `--text-primary`/`--text-secondary` palet vs warna "zona teks" tiap latar (warna dasar sisi kiri) ≥ 4,5:1 di kedua mode); `themes.test.js`/`theme_boot.test.js` (pref `herobg`); tes UI sumber (HeroBackdrop di hero & Pomodoro, bagian Latar di Pengaturan, teks persis, `aria-hidden`); penjaga tema (`theme_guard.test.js`) tetap hijau.
- E2E Playwright `temporary_files/e2e_latar_hero.py`: ganti latar di Pengaturan → `data-herobg` + hero berubah tanpa reload, tersimpan setelah reload; tangkapan hero Dashboard + kartu Pomodoro untuk 6 latar × 3 palet × 2 mode (1280 px) + HP 375 px (Sakura terang, Default gelap) + Pengaturan; cek tanpa scroll horizontal di 375 px; Kontur Default terang identik dengan `main` (toleransi antialias); kontras teks hero dan kartu Pomodoro terhadap piksel latar nyata; hero sempit (1101/1180/1280 px menu lengkap + 1101 px sidebar ikon, nama tampilan panjang) tanpa irisan gambar fitur dengan kolom teks; HP: pohon Lanskap Pomodoro dan ambient Objek 3D hero tersembunyi.
- Standar: `npm test`, `python -m pytest tests/ -q`, `node temporary_files/check_inline_scripts.js`.

## 10. Di luar cakupan

Unggah foto sendiri sebagai latar; animasi latar; latar berbeda untuk Dashboard dan Pomodoro; sinkron preferensi ke akun.
