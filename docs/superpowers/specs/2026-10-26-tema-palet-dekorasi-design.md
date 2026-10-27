# Spec: Tema Alurik = mode × palet × dekorasi (Sakura & Lavender)

- **Tanggal:** 2026-10-26
- **Basis kode:** `main` @ `64f3782` (mtyatno/taskflow-v4; SW v470 `taskflow-v470-live-edit`, `app.css?v=367`, ADR terakhir ADR-031)
- **Status:** desain disetujui pemilik per bagian (2026-10-26 16:51 – 20:42 WIB). PR A di-merge (#99); PR B diimplementasikan di `claude/tema-sakura-lavender`; PR C belum.
- **Salinan:** repo `docs/superpowers/specs/2026-10-26-tema-palet-dekorasi-design.md` dan Project claude.ai "alurik" `claude/spec-tema-palet-dekorasi-2026-10-26.md`. Isi keduanya sama.
- **Mockup:** artifact Design "Tema Sakura Alurik" (Hari Ini terang/gelap, Fokus HP terang/gelap, Pengaturan Tema interaktif, papan perbandingan aksen).
- **Istilah:**
  - *mode* = terang / gelap, atribut `data-theme` (sudah ada);
  - *palet* = keluarga warna aksen + permukaan + bentuk + font judul, atribut `data-palette` (baru);
  - *dekorasi* = hiasan non-fungsional (kelopak, maskot, glyph kelopak), atribut `data-decor` (baru);
  - *token semantik* = CSS custom property bernama menurut peran (`--accent-soft`), bukan warna (`--pink-100`);
  - *warna bermakna* = warna yang membawa arti dan sama di semua palet: P1–P4, Q1/Q3/Q4, status GTD selain Next, merah hapus/bahaya, hijau sukses;
  - *slot* = nama tempat dekorasi di UI (`page-corner`, `empty-done`, …) yang dipetakan ke id dekorasi oleh palet.

---

## 1. Latar

### 1.1 Permintaan pemilik

Alurik hanya punya tema terang dan gelap. Pemilik ingin tema berwarna pink dengan ikon lucu yang menarik user remaja putri, dan setelah melihat mockup: warnanya "hangat dan menyenangkan", versi gelapnya "bagus dan tetap jelas". Keputusan:

| Topik | Pilihan pemilik |
|---|---|
| Lingkup rilis pertama | Sakura + Lavender, dibangun di atas fondasi mode + palet agar palet lain tinggal ditambah |
| Dekorasi | Fondasi agar dekorasi bisa diperbanyak tanpa perombakan; rilis pertama: kelopak di header, maskot di layar kosong, penghitung sesi fokus berbentuk kelopak; bentuk lebih bulat + judul Nunito masuk token palet |
| Tempat memilih | Toggle terang/gelap di header tetap; seksi "Tampilan" baru di Pengaturan (palet, mode termasuk Ikuti sistem, dekorasi) |
| Warna bermakna | Opsi A: tetap sama di semua palet; aksen Sakura digeser ke magenta-rose agar tidak tertukar dengan merah P1; Q2 dan status Next (sekarang lime) ikut warna aksen palet |
| Aksen | Sakura = magenta-rose; Lavender = ungu orchid |
| Dekorasi Lavender | Set dekorasi yang sama, warna ikut token; fondasi mengizinkan set sendiri kelak |
| Pendekatan teknis | Pendekatan 1: dua sumbu terpisah + token semantik + registri |

Asumsi yang dibenarkan pemilik: Default (lime) tetap bawaan; tema per perangkat; harus jalan 100% offline; komponen pihak ketiga minimal tidak tampak rusak.

### 1.2 Keadaan kode (`main` 64f3782)

- Mode gelap = `<html data-theme="dark">`, dipasang skrip inline `<head>` dari `localStorage.tf_theme` (`light`|`dark`), di-toggle `toggleTheme` di App; komponen `ThemeToggle` (matahari/bulan) di topbar HP dan header desktop.
- Token di `:root` `app.css` (`--bg-page`, `--bg-card`, `--text-*`, `--accent #A8C500`, `--accent-hover`, `--border`, `--bg-hover`, `--bg-subtle`, `--radius-lg`, …) dan blok `[data-theme="dark"]` yang mengganti sebagian; `var(--accent…)` dipakai ±357×.
- Warna hard-coded: ±612 hex di `app.css`, ±400 hex + ±100 `rgba()` di `index.html`. Keluarga aksen lime: ±53 hex (`#A8C500`, `#95AD00`, `#6B8000`, `#7E9400`, `#B6D400`, `#A3C100`, `#F4FAD6`) dan ±120 `rgba(168,197,0,…)`. ±220 aturan `[data-theme="dark"] .komponen { … }` dengan hex langsung.
- `data-theme` dibaca langsung oleh: iframe Sketsa/tldraw dan mindmap (`postMessage {type:"setTheme", theme}` + `MutationObserver`), `useThemeName` + `dashChartColors` untuk Chart.js (sudah membaca token lewat `getComputedStyle`), editor note (`paper-mode`). Iframe mindmap punya `--side-accent: #A8C500` sendiri.
- `<meta name="theme-color" content="#0f172a">` statis.
- Ikon duotone lewat registri `VIEW_GLYPHS` + komponen `ViewGlyph` (`pomoTomato` dipakai 6 tempat). Layar kosong ditulis per tempat: emoji 🎉/🔍 (Hari Ini "Tidak ada task urgent!", daftar task), `DashEmpty` (ikon centang), dan lainnya.
- Halaman Pengaturan (`SettingsPage`) = tumpukan `.card`: Ganti Username, Ganti Password, Email, Telegram, Browser Clipper, Pembaruan Aplikasi.

## 2. Tujuan

1. User bisa memilih palet **Default / Sakura / Lavender** dan mode **Terang / Gelap / Ikuti sistem**, langsung berlaku tanpa muat ulang, tersimpan per perangkat, dan jalan offline.
2. **Menambah palet** = satu blok token di `themes.css` + satu entri registri. **Menambah dekorasi** = satu SVG di registri + satu baris peta slot. Tidak ada komponen yang diubah.
3. Tampilan Default **identik piksel** dengan sekarang setelah refactor (PR A).
4. Warna bermakna tidak berubah di palet mana pun; teks dan kontrol lolos kontras 4,5:1 di tiap palet × mode.
5. Komponen pihak ketiga (Sketsa, mindmap, editor note, grafik) tetap mengikuti mode; mindmap ikut aksen.

## 3. Desain

### 3.1 Atribut `<html>` dan penyimpanan

| Atribut | Nilai | Sumber |
|---|---|---|
| `data-theme` | `light` \| `dark` (tidak berubah) | mode efektif: pilihan user, atau `prefers-color-scheme` bila `system` |
| `data-palette` | `default` \| `sakura` \| `lavender` | `localStorage.tf_palette`, bawaan `default` |
| `data-decor` | `on` \| `off` | `localStorage.tf_decor`, bawaan `on` |

- `localStorage.tf_theme` kini menerima `light` \| `dark` \| `system`. Nilai lama (`light`/`dark`) tetap terbaca; nilai lain → `light`.
- Nilai `tf_palette` yang tidak ada di registri → `default`; `tf_decor` selain `off` → `on`. Semua akses localStorage dalam `try/catch`.
- Skrip inline `<head>` (yang sekarang memasang `data-theme`) diperluas: membaca ketiga kunci, menghitung mode efektif, memasang ketiga atribut **sebelum** stylesheet dipakai menggambar, dan memasang `<meta name="theme-color">` awal. Di PR A skrip ini `<script id="tf-theme-boot">` di `<head>` tepat setelah `<meta name="theme-color">`, sebelum stylesheet aplikasi/vendor (hanya preconnect + font Google di atasnya). Modul `TF.themes` mengulang logika yang sama setelah dimuat (fungsi murni dipakai keduanya lewat salinan kecil di inline; tes memastikan hasilnya sama).
- "Ikuti sistem": `matchMedia("(prefers-color-scheme: dark)")` didengarkan; perubahan sistem → `data-theme` berganti → semua pengamat `data-theme` yang sudah ada ikut (iframe, grafik).
- Preferensi tema **tidak dihapus saat logout** dan **tidak disinkron ke server** (per perangkat; tanpa endpoint, skema, atau perubahan `webapp.py`).

### 3.2 Token semantik (`app.css` `:root`)

Nilai Default = tampilan sekarang, persis.

| Token | Default terang | Default gelap | Peran |
|---|---|---|---|
| `--bg-page`, `--bg-primary`, `--bg-secondary`, `--bg-card`, `--border`, `--text-primary`, `--text-secondary`, `--text-light`, `--bg-hover`, `--bg-subtle`, `--bg-selected`, `--outline-guide` | sudah ada | sudah ada | permukaan & teks (`--bg-selected` dari Live Edit #97) |
| `--bg-sidebar` | `var(--bg-primary)` | `var(--bg-primary)` | latar sidebar |
| `--border-strong` | `#DDDDD5` | `#404040` | garis tepi sidebar/rail, latar hover baris gelap (sebelumnya hard-coded) |
| `--accent` | `#A8C500` | `#A8C500` | sudah ada |
| `--accent-hover` | `#95AD00` | `#95AD00` | sudah ada |
| `--accent-ink` | `#FFFFFF` | `#FFFFFF` | teks/ikon di atas tombol aksen |
| `--accent-rgb` | `168, 197, 0` | `168, 197, 0` | komponen RGB aksen; **setiap** tint alfa aksen di aturan ditulis `rgba(var(--accent-rgb), a)`, bukan literal `rgba(168,197,0,a)` |
| `--accent-text` | `#7E9400` | `#A8C500` | aksen sebagai teks (badge Q2/Next, link aktif) |
| `--accent-text-strong` | `#6B8000` | `#A8C500` | teks aksen pekat (sidebar/rail aktif, badge Next, ikon seksi Fokus; dulu literal `#6B8000`) |
| `--accent-2` | `#B6D400` | `#B6D400` | aksen kedua (pil tag aktif, tautan template; dulu literal `#B6D400`) |
| `--accent-2-hover` | `#A3C100` | `#A3C100` | hover `--accent-2` |
| `--accent-soft` | `#F4FAD6` | `rgba(168,197,0,0.18)` | latar chip/sidebar aktif |
| `--accent-duo` | `rgba(168,197,0,0.22)` | `rgba(168,197,0,0.22)` | isian lembut ikon duotone |
| `--accent-ring` | `rgba(168,197,0,0.35)` | `rgba(168,197,0,0.35)` | cincin fokus, bayangan tombol |
| `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-pill` | `6px`, `10px`, `16px`, `999px` | sama | sudut (`--radius-lg` sudah ada; `--radius-md` `10px` seperti yang diimplementasi PR A) |
| `--font-heading` | `inherit` | `inherit` | font judul halaman/kartu |

Nilai di tabel = yang diimplementasi PR A di `app.css` `:root` dan blok `[data-theme="dark"]` (token yang tidak ditimpa blok gelap memakai nilai terang); aturan: tidak ada nilai baru, hanya nama baru untuk nilai lama. `--accent-ink` putih di atas lime (kontras ±2:1) **dipertahankan** di Default karena Default harus identik; perbaikan kontras Default = PR terpisah bila pemilik mau.

### 3.3 Palet — `static/themes.css`

Satu palet = dua blok yang **hanya** mengganti token, tanpa selektor komponen:

```css
[data-palette="sakura"] { --bg-page: #FDF5FA; --bg-card: #FFFFFF; --bg-sidebar: #FBEAF4; --border: #F0D2E5; --text-primary: #3A2438; --text-secondary: #694763; --text-light: #83607A; --accent: #B0287E; --accent-hover: #9A2070; --accent-ink: #FFFFFF; --accent-text: #B0287E; --accent-soft: #F9E1F0; --accent-duo: #F2C4E1; --accent-ring: rgba(176,40,126,0.35); --accent-rgb: 176, 40, 126; --accent-text-strong: #8E1F63; --accent-2: #B0287E; --accent-2-hover: #9A2070; --border-strong: #E6C0D8; --radius-sm: 10px; --radius-md: 14px; --radius-lg: 22px; --font-heading: "Nunito", "Nunito Sans", sans-serif; }
[data-palette="sakura"][data-theme="dark"] { --bg-page: #1C1219; --bg-card: #291B26; --bg-sidebar: #22161F; --border: #3E2A3A; --text-primary: #FBEAF5; --text-secondary: #DDBCD3; --text-light: #B992AC; --accent: #EE8FCB; --accent-hover: #F5A6D7; --accent-ink: #2B0F24; --accent-text: #EE8FCB; --accent-soft: #3A2236; --accent-duo: #573150; --accent-ring: rgba(238,143,203,0.35); --accent-rgb: 238, 143, 203; --accent-text-strong: #EE8FCB; --accent-2: #EE8FCB; --accent-2-hover: #F5A6D7; --border-strong: #3E2A3A; }
```

Lavender: terang `--bg-page #FAF6FD`, `--bg-sidebar #F3EBFA`, `--border #E2D4F0`, teks `#30243C / #5B4870 / #75638A`, `--accent #8A3AAE`, `--accent-rgb 138, 58, 174`, `--accent-text-strong #6A2B88` (= `--accent-text-deep`, lebih tua dari `--accent-text`), `--accent-2 #8A3AAE`, `--accent-2-hover` = `--accent-hover` terang Lavender, `--border-strong #D5C2E8`, `--accent-soft #F1E4FA`, `--accent-duo #DFC6F2`; gelap `--bg-page #18131D`, `--bg-card #231C2B`, `--bg-sidebar #1D1724`, `--border #382D45`, teks `#F3EAFB / #D3C3E6 / #AE9BC4`, `--accent #CDA2F2`, `--accent-rgb 205, 162, 242`, `--accent-text-strong` = `--accent-text`, `--accent-2 #CDA2F2`, `--accent-2-hover` = `--accent-hover` gelap Lavender, `--border-strong #382D45` (= `--border`), `--accent-ink #22113A`, `--accent-soft #2F2440`, `--accent-duo #47375F`. Radius dan font judul sama dengan Sakura. Nilai `--bg-primary/secondary`, `--bg-hover`, `--bg-subtle`, `--outline-guide`, `--accent-hover` gelap, dan `--accent-ring` Lavender diturunkan dengan pola yang sama saat implementasi dan diverifikasi skrip kontras (§5). Token keluarga aksen tambahan PR A di kedua palet adalah **nilai awal, diverifikasi tes kontras PR B**: `--accent-rgb` = komponen RGB `--accent` blok itu, `--accent-text-strong` = `--accent-text` di gelap dan lebih tua di terang (= `--accent-text-deep`: Sakura `#8E1F63`, Lavender `#6A2B88`; integrasi PR B — link sidebar/rail aktif di atas `rgba(--accent-rgb, 0.2)` pada `--bg-sidebar` dengan `--accent-text` hanya 3,89/4,10:1, kini 5,32/5,85:1), `--accent-2` = `--accent`, `--accent-2-hover` = `--accent-hover`, `--border-strong` = satu langkah lebih gelap dari `--border` di terang dan sama dengan `--border` di gelap. Setiap blok palet WAJIB menetapkan semua token keluarga aksen + permukaan; PR B menambah tes kelengkapan.

Kontras terukur (WCAG, dihitung 2026-10-26): Sakura terang — aksen/latar 5,69, putih/aksen 6,09, aksen/chip 4,94, teks redup/latar 5,01; Sakura gelap — ink/aksen 7,88, aksen/kartu 7,37; Lavender terang — 5,96 / 6,37 / 5,22 / 5,03; Lavender gelap — 8,31 / 7,90. Jarak hue dari merah P1: Sakura ±40°, Lavender ±74° (rose awal ±20°, ditolak).

Radius tambahan (PR B, S3): `--radius-control` (tombol, input, link sidebar; Default `8px`, Sakura/Lavender `12px`) dan `--radius-card` (kartu; Default `14px`, Sakura/Lavender `18px`). Token opsional berfallback (S1: `--accent-on`, `--accent-text-deep`, dll., tidak ada di `:root`, dipakai `var(--token, <literal lama>)`; integrasi PR B menambah `--accent-ink-soft` = `--accent-ink` beralpha 0,88 untuk meta + tombol header chat di atas gradien aksen, Default `rgba(255,255,255,0.8)` / `var(--text-secondary)`) tercantum di `docs/superpowers/plans/2026-10-27-tema-sakura-lavender.md` (tabel S1) dan didefinisikan di tiap blok `themes.css`. `--line-soft`/`--track` (S5) didefinisikan di `app.css` (Default, terang + gelap) dan `themes.css` (palet).

Font Nunito (judul) ditambahkan ke `<link>` Google Fonts yang sudah ada (bobot 700, 800) — ikut catatan tindak lanjut self-host font di spec precache §7 D.

### 3.4 Registri palet — `static/offline/themes.js` (`window.TF.themes`)

Fungsi murni, tanpa DOM kecuali `apply`:

- `PALETTES`: `[{ id:"default", name:"Default", swatch:{light:{accent,soft,bg}, dark:{…}}, themeColor:{light:"#FCFCFB", dark:"#0f172a"}, decor:{} }, { id:"sakura", name:"Sakura", …, themeColor:{light:"#FDF5FA", dark:"#1C1219"}, decor:{ "page-corner":"petals", "empty-done":"mascot-happy", "empty-empty":"mascot-happy", "empty-filter":"mascot-search", "pomo-glyph":"petal" } }, { id:"lavender", name:"Lavender", … decor sama … }]`. `themeColor` Default gelap `#0f172a` = nilai meta sekarang (dipertahankan).
- `readPrefs(storage)` → `{ mode, palette, decor }` dengan normalisasi §3.1.
- `resolve(prefs, systemDark)` → `{ theme:"light"|"dark", palette, decor:"on"|"off", themeColor }`.
- `apply(resolved, doc)` → memasang tiga atribut `<html>` dan `content` meta `theme-color`; tidak mengubah atribut yang nilainya sudah sama (menghindari `MutationObserver` palsu).
- `decorFor(palette, slot)` → id dekorasi atau `null`.
- `isDecorAvailable(palette)` → `true` bila `decor` palet tidak kosong (Default: `false`).
- App: state `themePrefs` menggantikan `theme`; `setThemePrefs(patch)` menulis **hanya kunci di `patch`** ke localStorage (`writePrefs(storage, patch)`; nilai yang dinormalkan `readPrefs` tidak ditimpa), memanggil `resolve` + `apply`. `toggleTheme` (header): mode efektif `dark` → set `light`, selain itu → `dark` (keluar dari `system`). Pendengar `matchMedia` aktif hanya saat `mode === "system"`.
- Hook `useThemeAttrs()` (menggantikan `useThemeName`) mengembalikan `{ theme, palette, decor }` dari atribut `<html>` lewat `MutationObserver` (`attributeFilter` `data-theme`/`data-palette`/`data-decor`; objek state hanya diganti bila salah satu nilai berubah) — dipakai grafik Chart.js dan `Decor`. Pengamat iframe mindmap juga memantau `data-palette`; pesannya dibangun `mindmapThemeMessage()`: `{ type: "setTheme", theme, accent, accentSoft, accentInk }` dengan nilai terhitung `--accent`, `--accent-soft`, `--accent-ink` (`getComputedStyle`). Palet Default mengirim string kosong untuk ketiganya, sehingga iframe (`static/vendor/mind-elixir/index.html`, `applySideAccent`) menghapus properti inline dan memakai warna CSS bawaannya sendiri (lime, tinta hitam); palet lain ditulis ke `--side-accent`, `--side-hover`, `--side-accent-ink`. Editor note mengikuti mode lewat CSS app; kanvas Sketsa (tldraw) tidak menerima pesan tema apa pun (selalu terang). Keduanya tidak berubah di PR B.

### 3.5 Registri dekorasi — `static/offline/decor.js` (`window.TF.decor`)

- `DECOR`: `{ petals: { svg, animated:true }, "mascot-happy": { svg }, "mascot-search": { svg } }`. Setiap `svg` adalah string `<svg viewBox …>` yang **hanya** memakai `fill`/`stroke` = `currentColor` atau `var(--accent)`, `var(--accent-duo)`, `var(--accent-soft)`, `var(--bg-card)`, `var(--text-primary)`; tanpa hex, tanpa `<script>`, tanpa gambar eksternal. Dijaga tes.
- Komponen React `Decor({ slot, size, className })` di `index.html`: membaca `data-decor` dan palet aktif (hook `useThemeAttrs` memakai `MutationObserver` atribut `data-palette`/`data-decor`), `TF.decor.DECOR[TF.themes.decorFor(palette, slot)]`; bila tidak ada → `null` (tidak menyisakan ruang). Render `<span class="decor decor-<slot>" aria-hidden="true">` berisi SVG lewat `dangerouslySetInnerHTML` dari registri (sumber internal, bukan data pengguna).
- CSS `.decor { pointer-events:none; user-select:none }`; `.decor-page-corner { position:absolute; top:…; right:…; }` dengan animasi melayang pelan, dimatikan di `@media (prefers-reduced-motion: reduce)`; disembunyikan saat Zen Mode (`.zen-on .decor-page-corner { display:none }`) dan di lebar < 480 px bila menabrak judul (dicek E2E 375 px).
- Glyph kelopak: `VIEW_GLYPHS.pomoPetal` baru; `ViewGlyph` memetakan `name === "pomoTomato"` → `pomoPetal` bila `decorFor(palette,"pomo-glyph") === "petal"` dan `data-decor="on"`. Pemanggil tidak berubah.

### 3.6 `EmptyState` bersama

`EmptyState({ kind, title, hint, action })`, `kind` ∈ `done` | `filter` | `empty`:
- dekorasi aktif dan palet memetakan `empty-<kind>` → maskot (ukuran 96 px);
- selain itu → ikon duotone `ViewGlyph` (`done`: centang bulat, `filter`: kaca pembesar, `empty`: kotak masuk) 36 px dengan `--accent-duo`. Emoji 🎉/🔍 **diganti** di tempat yang dimigrasi (sejalan arah ikon duotone; tampilan Default berubah di empat tempat ini saja dan dicatat di `whatsnew`).

Dimigrasi di rilis ini (PR C): (1) Hari Ini "Tidak ada task urgent!" + kalimat bawahnya (`done`); (2) daftar task "Tidak ada task" (`empty`) / "Tidak ada task yang cocok dengan filter" (`filter`); (3) `DashEmpty` dashboard (`empty`); (4) Kotak Masuk kosong (`done`, judul "Kotak Masuk bersih!"). Layar kosong lain menyusul halaman demi halaman (pola ikon).

### 3.7 Kartu "Tampilan" di Pengaturan

Kartu pertama `SettingsPage` (sebelum "Ganti Username"), judul "Tampilan":
1. **Mode** — `role="radiogroup"` `aria-label="Mode"`, tiga pil `Terang · Gelap · Ikuti sistem`, `aria-checked`; pil aktif latar `--accent`, teks `var(--accent-on, #1a2a00)` (bukan `--accent-ink`: putih di atas lime Default ≈ 1,8:1 gagal AA; `--accent-on` tidak didefinisikan di `:root` (Default memakai fallback `#1a2a00`, kontras terjaga) dan didefinisikan di tiap blok Sakura/Lavender (`#FFFFFF` di terang, tinta gelap di gelap)).
2. **Palet** — grid 3 kolom (1 kolom < 420 px), tombol `aria-pressed`, tiap kartu: tiga bulatan contoh dari `swatch[mode efektif]` (aksen, soft, bg) + nama. Terpilih: `border: 2px solid var(--accent)` + `--accent-ring`.
3. **Dekorasi tema** (S2: baris ini baru dirender di PR C, bersama `decor.js`; di PR B tidak tampil) — baris `role="switch"` `aria-checked`, label "Dekorasi tema", keterangan "Kelopak dan maskot di layar kosong" (palet berdekorasi) / "Tersedia untuk palet Sakura dan Lavender" (Default, sakelar `disabled`).
4. **Pratinjau** — kotak `--bg-card` berisi dua baris task contoh dan satu chip, memakai token hidup (tanpa warna tetap).

Setiap perubahan langsung `setThemePrefs` (tanpa tombol Simpan, tanpa toast). Teks UI persis: `"Tampilan"`, `"Mode"`, `"Terang"`, `"Gelap"`, `"Ikuti sistem"`, `"Palet"`, `"Default"`, `"Sakura"`, `"Lavender"`, `"Dekorasi tema"`, `"Kelopak dan maskot di layar kosong"`, `"Tersedia untuk palet Sakura dan Lavender"`, `"Pratinjau"`.

`ThemeToggle` header: ikon mengikuti mode efektif; `title` "Ganti ke mode gelap"/"Ganti ke mode terang".

### 3.8 Migrasi warna hard-coded (PR A)

Dua lapis, warna bermakna **tidak disentuh**:
1. **Mekanis** — skrip sekali pakai `temporary_files/migrate_theme_tokens.js` dengan tabel pemetaan nilai persis → token, dijalankan atas `app.css` dan `index.html` (inline style dan string CSS di `<style>`): keluarga lime → `--accent*`; `#DDDDD5`/`#404040` tepi sidebar → `--border-strong`; abu permukaan/teks yang sama dengan nilai token (`#0f172a`, `#64748b`, `#94a3b8`, `#262626`, `#171717`, `#e5e5e5`, `#a3a3a3`, `#737373`, `#FCFCFB`, `#E8E8E0`) → token terkait **hanya** bila konteksnya permukaan/teks (ditinjau per baris; daftar hasil disertakan di PR). Skrip tidak dipakai lagi setelah PR A.
2. **Manual** — ±220 aturan `[data-theme="dark"] .x {…}`: yang nilainya kini sama dengan token dihapus (token gelap sudah menanganinya); sisanya ditulis ulang memakai token. Aturan yang menyentuh warna bermakna (badge P/Q, pomodoro, break) dibiarkan.

Kelas `.ws-c0..7` (avatar workspace), badge P/Q/GTD selain Next, `--p*`, `--q1/3/4`, `--pomodoro*`, `--break*`, `--success` tidak berubah. `--q2` dan `.badge-next`/`.badge-q2` → `--accent-text`/`--accent-soft`.

### 3.9 Precache & versi

`static/themes.css?v=<n>` (`<link>` setelah `app.css`), `static/offline/themes.js`, `static/offline/decor.js` masuk `STATIC` `sw.js` dengan URL persis (ADR-029); `themes.js` dimuat sebelum skrip aplikasi utama. Font Nunito lewat `<link>` Google Fonts yang sudah ada (opaque, tidak di-precache; jatuh ke Nunito Sans saat offline tanpa cache — diterima, sama dengan Nunito Sans sekarang).

### 3.10 Yang tidak berubah

Warna bermakna; perilaku `data-theme` dan semua pembacanya; Sketsa/tldraw dan editor note (mode saja); backend, skema, API, sinkron; ikon aplikasi/PWA; logo Alurik; halaman publik `/pub` (tetap Default).

## 4. Pembagian PR, versi, deploy

| PR | Branch | Isi | Versi |
|---|---|---|---|
| A | `claude/tema-fondasi-token` | token baru, `themes.css`/`themes.js` (registri hanya Default), atribut `data-palette`/`data-decor`, skrip inline, migrasi warna §3.8, penjaga §5, screenshot identik | SW naik, `app.css?v=` naik, `whatsnew` `silent` |
| B | `claude/tema-sakura-lavender` | blok Sakura + Lavender, kartu "Tampilan", Ikuti sistem, `theme-color`, aksen iframe mindmap, Nunito | SW naik; `whatsnew`: judul "Tema Sakura dan Lavender", poin: pilih palet dan mode di Pengaturan › Tampilan; mode Ikuti sistem; dekorasi bisa dimatikan |
| C | `claude/tema-dekorasi` | `decor.js`, `Decor`, `EmptyState` (4 tempat), kelopak header Hari Ini + Fokus, glyph kelopak, sakelar dekorasi aktif | SW naik; `whatsnew`: "Dekorasi tema Sakura dan Lavender" |

Setiap PR mengikuti checklist `.agents/PROTOCOL.md` §4; nomor versi dicek terhadap `main` saat merge. Deploy: file statis saja (tanpa `webapp.py`, tanpa migrasi, tanpa restart kecuali bila `main` menuntut).

## 5. Pengujian

- **Node (`npm test`):** `tests/offline/themes.test.js` — `readPrefs`/`resolve` untuk semua kombinasi (nilai lama, asing, `system` × sistem terang/gelap), `apply` tidak menulis atribut yang sama, registri lengkap (tiap palet: semua token §3.2 di kedua blok, `themeColor` kedua mode, `decor` hanya merujuk id yang ada di `TF.decor`), `decorFor`/`isDecorAvailable`. `tests/offline/decor.test.js` — semua SVG registri tanpa hex/`<script>`/`url(`; `Decor` → `null` saat `data-decor="off"` atau slot tak dipetakan. Keduanya ikut CI lewat jembatan pytest (pola `tests/test_app_update_node.py`).
- **Penjaga warna:** `tests/offline/theme_guard.test.js` — `app.css`, `themes.css`, `index.html` tidak memuat hex keluarga lime atau `rgba(168,197,0` di luar `:root`/`themes.css`; daftar putih warna bermakna tidak berubah; `themes.css` hanya berisi selektor `[data-palette…]` dengan deklarasi `--*`.
- **Kontras:** `tests/offline/theme_palettes.test.js` (kontras + kelengkapan) menghitung rasio WCAG dari `themes.css` + `:root`/blok gelap `app.css` (≥ 4,5:1 untuk Sakura/Lavender, kedua mode; Default tidak diukur — pasangan Default pra-ada, mis. `--accent-ink`/`--accent` lime). Latar beralpha dikomposit di atas `--bg-card` kecuali disebut lain; teks beralpha dikomposit di atas latarnya. Pasangan kedua mode: `--text-primary`/`--bg-page`, `--text-primary`/`--bg-card`, `--text-secondary`/`--bg-card`, `--text-light`/`--bg-page`, `--text-light`/`--bg-card`, `--accent-text`/`--bg-card`, `--accent-text`/`--accent-soft`, `--accent-ink`/`--accent`, `--accent-on`/`--accent`, `--accent-text-deep`/`--accent-soft`, `--text-secondary`/`--bg-sidebar`, `--text-light`/`--bg-sidebar`, `--text-primary` dan `--text-light` di atas `--notif-unread-bg` dan `--notif-hover-bg` (baris notifikasi), `--accent-ink`/`--accent-hover`, `--accent-ink-soft`/`--accent` dan `--accent-ink-soft`/`--accent-hover` (header chat, kedua ujung gradien). Terang saja: `--accent-text-strong` di atas `rgba(--accent-rgb, 0.2)` pada `--bg-sidebar` (`.sidebar-link.active`/`.sidebar-rail-btn.active`). Gelap saja: `--accent-text-bright`/`--bg-card`, `--accent` di atas `rgba(--accent-rgb, 0.18)` pada `--bg-sidebar` (`[data-theme="dark"] .sidebar-link.active`). `theme_guard.test.js` menjaga sisi CSS: latar `var(--accent…)` tidak berteks putih (aturan + objek style), turunan `.chat-room-header` bertinta `--accent-ink`/`--accent-ink-soft`.
- **E2E Playwright PR A `temporary_files/e2e_tema_fondasi.py`:** `baseline --ref <ref>` memotret 8 halaman (Dashboard, Hari Ini, Fokus, Mendatang, Catatan, Workspace, Kanban, Pengaturan) × 2 mode dari ref pembanding (`origin/main`), `compare` memotret branch dan membandingkan dengan toleransi 3 per kanal (bukan 0: render alfa/antialias), `verify` mengecek skrip boot, toggle header, mode system, dan logout di browser.
- **E2E Playwright PR B/C (perluasan berkas yang sama `temporary_files/e2e_tema_fondasi.py`; tidak ada `e2e_tema.py`):** `--palette sakura|lavender` untuk `baseline`/`compare`/`shots`; `shots --palette <palet>` = 28 tangkapan audit per palet ke `temporary_files/e2e_tema_fondasi/shots/<palet>/` (8 halaman × 2 mode pada 1280×900, Fokus & Pengaturan 375 px × 2 mode, lalu modal detail task dari "Semua Task", note berjudul/berdaftar/bertag di editor, Sketsa dengan kanvas terbuka, mindmap terbuka × 2 mode) + lembar kontak `<palet>-sheet.png` (20 halaman) dan `<palet>-sheet-2.png` (4 surface tambahan); kanvas Sketsa butuh bundel `static/vendor/tldraw/` hasil `cd draw-app && npm ci && npm run build` (di-.gitignore). `baseline --ref`/`compare` menerima `--palette` yang sama (direktori `baseline-<palet>/` dst.); `verify` mencakup cek palet v-*. Cakupan yang direncanakan: (2) ganti palet di Pengaturan → `data-palette` dan `--accent` terhitung berubah tanpa reload, meta `theme-color` berubah; (3) muat ulang dengan `tf_palette=sakura` → atribut sudah terpasang sebelum first paint (tidak ada frame Default); (4) `tf_theme=system` + `emulateMedia(colorScheme)` → `data-theme` mengikuti, iframe menerima `setTheme`; (5) sakelar dekorasi off → tidak ada `.decor` di DOM; (6) Fokus 375 px tiap palet: kelopak tidak menutupi judul/tombol; (7) toggle header saat `system` → keluar ke mode kebalikan; (8) logout → preferensi tetap.
- **Audit visual manual** sebelum merge B dan C: 3 palet × 2 mode, halaman di atas + modal task + editor note + Sketsa + mindmap.
- Verifikasi standar: `npm test`, `python -m pytest tests/ -q`, `node temporary_files/check_inline_scripts.js`.

## 6. Koordinasi dan risiko

- Live Edit (#97, sudah di `main`) menambah `--bg-selected`; Sakura/Lavender memberi nilai sendiri (nuansa aksen sangat tipis).
- Hex permukaan yang lolos migrasi akan tampil abu di Sakura — ditangkap audit visual, diperbaiki per halaman (pola ikon).
- `--accent-ink` putih di atas lime Default tetap rendah kontras (pra-ada).
- `dangerouslySetInnerHTML` untuk SVG registri: sumbernya file statis ter-precache, bukan data pengguna; tes memastikan tidak ada `<script>`.
- Emoji 🎉/🔍 di empat layar kosong berubah jadi ikon duotone juga di Default (perubahan tampilan kecil yang disengaja, PR C).

## 7. Di luar cakupan

Sinkron preferensi tema ke akun; palet selain tiga ini; dekorasi khusus Lavender; perbaikan kontras tombol Default; tema untuk halaman publik `/pub`; mengganti logo; set ikon alternatif; self-host font.

## 8. ADR

ADR-033 "Tema = mode × palet × dekorasi: token semantik + registri" (ADR-032 sudah dipakai #98) ditulis di PR A: `data-theme` tetap satu-satunya sumbu yang dibaca pihak ketiga; palet hanya mengganti token; dekorasi lewat slot yang dipetakan palet; warna bermakna di luar sistem palet.
