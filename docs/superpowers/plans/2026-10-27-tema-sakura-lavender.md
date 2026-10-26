# Tema PR B — palet Sakura & Lavender + kartu Tampilan: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pengguna bisa memilih palet **Default / Sakura / Lavender** dan mode **Terang / Gelap / Ikuti sistem** di Pengaturan › Tampilan; pilihan langsung berlaku tanpa muat ulang, tersimpan per perangkat, jalan offline.

**Architecture:** Di atas fondasi PR A (#99): registri `TF.themes` mendapat dua palet; `static/themes.css` mendapat blok token terang + gelap per palet; sisa literal yang belum bertoken diganti token "opsional" (`var(--x, <literal lama>)`, tidak didefinisikan di Default) sehingga Default tetap identik sementara palet menimpanya; React membaca palet lewat hook `useThemeAttrs`; kartu "Tampilan" baru memakai `setThemePrefs` yang sudah ada.

**Tech Stack:** React tanpa build (`static/index.html` = `React.createElement`, JSX dilarang), CSS custom property, `node --test` + jembatan pytest, Playwright E2E lokal.

**Spec:** `docs/superpowers/specs/2026-10-26-tema-palet-dekorasi-design.md` (§3.1, §3.3, §3.4, §3.7, §4 baris B, §5). Daftar sisa dari PR A: `.agents/CURRENT_STATE.md` ("Sisa untuk PR B", 9 butir) + `docs/superpowers/plans/2026-10-26-tema-fondasi-sisa-hex.md`.

## Penyesuaian terhadap spec (diputuskan saat menulis plan)

- **S1 — Token opsional berfallback.** Literal lime-adjacent dan tinta gelap di atas aksen (`#1a1f00`, `#1a2a00`, `#1F2116`, `#4d5c00`, `#4E5C00`, `#5D6E00`, `#6B8000` badge Q2, `#364d00`, `#d4e85c`, `#D9EE6A`, `#4a7000`, `rgba(182,212,0,a)`, `rgba(54,77,0,0.7)`, `#525252`) diganti `var(--<token>, <literal itu>)`. Token-token ini **tidak** didefinisikan di `:root` (Default memakai fallback = identik), hanya di blok palet. Ini menghindari puluhan token Default yang nilainya hampir sama.
- **S2 — Sakelar dekorasi baru tampil di PR C.** Di PR B baris "Dekorasi tema" dirender hanya bila `window.TF.decor` ada (modul PR C). Tanpa itu sakelar tidak berbuat apa-apa. Poin `whatsnew` "dekorasi bisa dimatikan" pindah ke PR C.
- **S3 — Radius.** Spec memberi `--radius-sm/md/lg`; kode memakai 6/8/10/14/16 px. Ditambah `--radius-control: 8px` (tombol, input, link sidebar) dan `--radius-card: 14px` (kartu); Sakura/Lavender: sm 10, control 12, md 14, card 18, lg 22.
- **S4 — Hook `useThemeAttrs()`** (dipakai PR C juga) menggantikan `useThemeName()` di tiga grafik dashboard agar ganti palet menggambar ulang grafik.
- **S5 — 8 literal "salah" di `index.html`** (garis/track terang di mode gelap, tabel sisa-hex) diperbaiki lewat token baru `--line-soft` (terang `#f1f5f9`, gelap `#333333`) dan `--track` (terang `#e2e8f0`, gelap `#404040`) — perbaikan bug mode gelap Default yang disengaja. `chipColor` kalender (pastel terang) di luar cakupan.

## Global Constraints

- Basis: `main` @ `b365263` (SW `taskflow-v472-tema-fondasi`, `app.css?v=369`, `themes.css?v=1`). Versi PR ini: SW `taskflow-v<N>-tema-sakura-lavender` (saat plan ditulis N = 473; cek `main` + PR terbuka saat Task 8), `app.css?v=370`, `themes.css?v=2`.
- `static/index.html` sudah terkompilasi: kode baru = `React.createElement(...)`; `node temporary_files/check_inline_scripts.js` harus OK.
- Hanya klien: tanpa `webapp.py`, skema, API, sinkron.
- **Default tetap identik** kecuali perubahan yang disengaja: (a) `theme-color` terang Default `#0f172a` → `#FCFCFB` (spec §3.4); (b) S5. Gerbang piksel `temporary_files/e2e_tema_fondasi.py compare` (baseline `--ref origin/main`) harus 16/16 PASS (toleransi 3/kanal).
- Nilai palet persis dari spec §3.3; nilai turunan ditetapkan di Task 2 Interfaces.
- Kontras WCAG ≥ 4,5:1 untuk pasangan di Task 2 (tes otomatis), di tiap palet × mode.
- Warna bermakna (P1–P4, Q1/Q3/Q4, merah hapus, hijau sukses, pomodoro/break) tidak disentuh.
- Teks UI persis (spec §3.7): `"Tampilan"`, `"Mode"`, `"Terang"`, `"Gelap"`, `"Ikuti sistem"`, `"Palet"`, `"Default"`, `"Sakura"`, `"Lavender"`, `"Dekorasi tema"`, `"Kelopak dan maskot di layar kosong"`, `"Tersedia untuk palet Sakura dan Lavender"`, `"Pratinjau"`; `ThemeToggle` `title` `"Ganti ke mode gelap"` / `"Ganti ke mode terang"`.
- File lokal baru/berubah query yang dimuat `index.html` wajib ada di `STATIC` `sw.js` dengan URL persis (ADR-029). Iframe `static/vendor/mind-elixir/index.html` tidak di-precache; cukup naikkan `?v=146` → `?v=147` di `index.html`.
- Rilis: checklist `.agents/PROTOCOL.md` §4. Branch `claude/tema-sakura-lavender`, PR draft, merge hanya setelah pemilik bilang "merge dan deploy".
- Pesan commit diakhiri baris atribusi sesi (Co-Authored-By + Claude-Session).
- Verifikasi standar: `npm test` (hanya `draw_local_reactive` boleh gagal), `python -m pytest tests/ -q`, `node temporary_files/check_inline_scripts.js`.

## Review Focus

1. **Ganti palet saat dashboard terbuka** — grafik ikut warna aksen baru tanpa muat ulang. Tes: Task 5 `grafik: deps efek memuat palette` + E2E Task 7 `v-chart`.
2. **Memilih "Ikuti sistem" saat OS gelap** — tidak ada satu frame terang. Tes: Task 5 `useSystemDark: nilai sinkron saat enabled berubah` + E2E Task 7 `v-system`.
3. **Palet tersimpan `sakura` lalu dibuka** — tidak ada frame Default (boot memasang palet sebelum stylesheet). Tes: Task 1 matriks paritas memakai `TF.themes.PALETTES`; E2E Task 7 `v-boot`.
4. **Iframe mindmap terbuka saat ganti palet** — aksen tab/garis mindmap ikut; versi iframe lama (cache) yang tak mengenal `accent` tidak error. Tes: Task 5 `mindmap: postMessage membawa accent` + `handler mengabaikan accent kosong`.
5. **Pengaturan di layar 375 px** — grid palet satu kolom, tiga pil mode tidak meluap. Tes: E2E Task 7 `v-settings-375`.

---

### Task 1: Registri palet + boot script

**Files:**
- Modify: `static/offline/themes.js` (`PALETTES`)
- Modify: `static/index.html` boot script `<script id="tf-theme-boot">` (baris ±11–45: `palettes`, `themeColors`)
- Test: `tests/offline/themes.test.js`, `tests/offline/theme_boot.test.js`

**Interfaces:**
- Produces `PALETTES` (urut): `default` (swatch tetap; `themeColor {light:"#FCFCFB", dark:"#0f172a"}`; `decor {}`), `sakura` (`name "Sakura"`; swatch light `{accent:"#B0287E", soft:"#F9E1F0", bg:"#FDF5FA"}`, dark `{accent:"#EE8FCB", soft:"#3A2236", bg:"#1C1219"}`; `themeColor {light:"#FDF5FA", dark:"#1C1219"}`), `lavender` (`name "Lavender"`; swatch light `{accent:"#8A3AAE", soft:"#F1E4FA", bg:"#FAF6FD"}`, dark `{accent:"#CDA2F2", soft:"#2F2440", bg:"#18131D"}`; `themeColor {light:"#FAF6FD", dark:"#18131D"}`). `decor` Sakura = Lavender = `{ "page-corner":"petals", "empty-done":"mascot-happy", "empty-empty":"mascot-happy", "empty-filter":"mascot-search", "pomo-glyph":"petal" }`.
- Boot script: `palettes = ["default","sakura","lavender"]`; `themeColors` sama dengan `themeColor` registri.

- [ ] **Step 1: Tes gagal** — di `themes.test.js`: `registri: urutan id default,sakura,lavender`, `themeColor Default terang #FCFCFB`, `swatch + themeColor sakura/lavender sesuai`, `isDecorAvailable(sakura|lavender) true, default false`, `decorFor("sakura","pomo-glyph") === "petal"`. Di `theme_boot.test.js`: ganti daftar palet matriks `["default","mint",null]` dengan `[...th.PALETTES.map(p => p.id), "mint", null]` (mode × palet × decor × systemDark) dan tambah `boot themeColors = registri untuk tiap palet × mode` (ekstrak objek `themeColors` dari sumber boot lewat `vm`).
- [ ] **Step 2:** `node --test tests/offline/themes.test.js tests/offline/theme_boot.test.js` → FAIL.
- [ ] **Step 3:** Implementasi sesuai Interfaces.
- [ ] **Step 4:** Tes → PASS; `node temporary_files/check_inline_scripts.js` OK.
- [ ] **Step 5: Commit** — `feat(tema): registri Sakura + Lavender, theme-color Default terang #FCFCFB`

### Task 2: Blok palet di `themes.css` + tes kelengkapan & kontras

**Files:**
- Modify: `static/themes.css`
- Create: `tests/offline/theme_palettes.test.js`
- Modify: `tests/offline/theme_guard.test.js` (tes struktur `themes.css` kini harus menemukan ≥ 1 blok per palet non-Default)

**Interfaces:**
- Token wajib per blok (terang dan gelap): `--bg-page --bg-primary --bg-secondary --bg-card --bg-sidebar --border --border-strong --text-primary --text-secondary --text-light --outline-guide --bg-hover --bg-subtle --bg-selected --accent --accent-hover --accent-ink --accent-text --accent-text-strong --accent-soft --accent-duo --accent-ring --accent-rgb --accent-2 --accent-2-hover`. Hanya blok terang tambahan: `--radius-sm --radius-control --radius-md --radius-card --radius-lg --font-heading` (Task 4 menambah `--radius-control`/`--radius-card` ke `:root`).
- Nilai: spec §3.3 persis untuk yang disebut. Turunan: `--bg-primary`/`--bg-secondary` = `--bg-page` (terang) / `--bg-card` (gelap); `--outline-guide` = `--text-light`; terang `--bg-hover rgba(<rgb --text-primary>,0.05)`, `--bg-subtle …0.025`, `--bg-selected …0.07`; gelap `rgba(255,255,255,0.08/0.03/0.10)`; Lavender terang `--accent-hover #742F93`, gelap `#DDBBF7`, `--accent-ring rgba(138,58,174,0.35)` / `rgba(205,162,242,0.35)`, `--accent-text` = `--accent`, `--accent-ink` terang `#FFFFFF`; Lavender `--bg-card` terang `#FFFFFF`; radius terang Sakura = Lavender = `10px / 12px / 14px / 18px / 22px`; `--font-heading: "Nunito", "Nunito Sans", sans-serif`.
- Parser kecil di tes: blok `[data-palette="x"]` / `[data-palette="x"][data-theme="dark"]` → objek token; nilai efektif gelap = gabungan terang ← gelap ← (`:root` + blok gelap `app.css` untuk token yang tidak ditimpa).

- [ ] **Step 1: Tes gagal** `theme_palettes.test.js`:
  - `kelengkapan: tiap palet registri selain default punya blok terang & gelap berisi semua token wajib`;
  - `--accent-rgb = komponen RGB --accent di blok yang sama`;
  - `kontras ≥ 4.5`: untuk tiap palet non-Default × mode, pasangan `text-primary/bg-page`, `text-primary/bg-card`, `text-secondary/bg-card`, `text-light/bg-page`, `accent-text/bg-card`, `accent-text/accent-soft`, `accent-ink/accent` (fungsi luminansi WCAG; `rgba` dikomposisi di atas `--bg-card`);
  - `swatch registri = nilai token themes.css` (accent, accent-soft, bg-page per mode).
- [ ] **Step 2:** `node --test tests/offline/theme_palettes.test.js tests/offline/theme_guard.test.js` → FAIL.
- [ ] **Step 3:** Tulis blok Sakura + Lavender. Pasangan yang gagal kontras: sesuaikan nilai turunan saja (bukan nilai spec); bila nilai spec sendiri gagal, ubah seminimal mungkin dan catat di laporan.
- [ ] **Step 4:** Tes → PASS; `compare` Default 16/16.
- [ ] **Step 5: Commit** — `feat(tema): blok token Sakura & Lavender + tes kelengkapan/kontras`

### Task 3: Sisa literal → token (Default identik)

**Files:**
- Modify: `static/app.css`, `static/index.html` (konteks CSS saja), `static/themes.css` (nilai token baru di blok palet)
- Modify: `tests/offline/theme_dark_allowlist.json` + ratchet di `theme_guard.test.js`
- Modify: `tests/offline/theme_palettes.test.js` (token opsional wajib ada di blok palet)

**Interfaces:**
- Token opsional (S1; tidak ada di `:root`; dipakai `var(--t, <literal lama>)`):

| Token | Literal Default yang digantikan | Sakura terang / gelap | Lavender terang / gelap |
|---|---|---|---|
| `--accent-on` | `#1a1f00`, `#1a2a00`, `#1F2116` (tinta di atas `--accent`) | `#FFFFFF` / `#2B0F24` | `#FFFFFF` / `#22113A` |
| `--accent-text-deep` | `#4d5c00`, `#4E5C00`, `#5D6E00`, `#6B8000` (`.badge-q2`), `#364d00`, `rgba(54,77,0,0.7)` | `#8E1F63` / `#F5B3DA` | `#6A2B88` / `#E0C6F8` |
| `--accent-text-bright` | `#d4e85c`, `#D9EE6A` (teks aktif gelap) | `#F5B3DA` / `#F5B3DA` | `#E0C6F8` / `#E0C6F8` |
| `--accent-2-rgb` | `182, 212, 0` di `rgba(182,212,0,a)` | `176, 40, 126` / `238, 143, 203` | `138, 58, 174` / `205, 162, 242` |
| `--chat-self-bg` | `#4a7000` (gelap) | — / `#5A2A4A` | — / `#3F2D5C` |
| `--border-hover` | `#525252` (5 aturan gelap hover) | — / `#5A3E52` | — / `#4E3F63` |

  (`rgba(54,77,0,0.7)` → `var(--accent-text-deep, rgba(54,77,0,0.7))`; nilai palet tanpa alpha diterima.)
- Token permukaan baru di `:root` + blok gelap `app.css` (S5): `--line-soft` `#f1f5f9` / `#333333`; `--track` `#e2e8f0` / `#404040`. Sakura/Lavender: `--line-soft` = `--border`, `--track` = `--border-strong` (terang) / `--border` (gelap).
- Juga: `.sidebar-link:hover`, `.sidebar-rail-btn:hover` `color: #0f172a` → `var(--text-primary)`; hapus 10 aturan `.dark …` mati (`app.css` ±2075–2233).
- Lokasi `index.html` untuk S5: baris yang ditandai **salah** di `docs/superpowers/plans/2026-10-26-tema-fondasi-sisa-hex.md` (ModalAttachments, ModalNotes, TaskDetailBody track ×2 + baris subtask, TaskRow bar, daftar notifikasi App) — grep nilai, baris bergeser.
- `#4d7c0f` (wikilink mode kertas) dan `chipColor` kalender: tidak diubah.

- [ ] **Step 1: Tes gagal** — di `theme_palettes.test.js`: `token opsional: tiap blok palet (terang+gelap sesuai tabel) mendefinisikannya`, `:root tidak mendefinisikan token opsional`, `--line-soft/--track ada di :root, blok gelap, dan tiap palet`. Di `theme_guard.test.js`: `guard: literal tabel S1 hanya muncul sebagai fallback var(--…, literal)` (regex: setiap kemunculan literal itu didahului `var(--<nama-tabel>, `), `guard: tidak ada aturan .dark ` (selektor diawali `.dark `), `guard: #f1f5f9/#e2e8f0 di lokasi S5 diganti token` (cek string konteks dari tabel sisa-hex).
- [ ] **Step 2:** Tes → FAIL.
- [ ] **Step 3:** Migrasi; perbarui allowlist (entri yang tak lagi berliteral hanya karena kini fallback tetap berliteral — sesuaikan ratchet ke jumlah persis setelah perubahan, boleh turun saja).
- [ ] **Step 4:** Tes → PASS; `compare` Default 16/16 (S5 tidak tampil di 16 gambar; bila tampil, catat sebagai perubahan disengaja di laporan); `check_inline_scripts` OK.
- [ ] **Step 5: Commit** — `refactor(tema): sisa literal aksen/hover → token palet; garis & track gelap diperbaiki`

### Task 4: Radius & font judul memakai token

**Files:**
- Modify: `static/app.css` (`:root` + komponen), `static/index.html:7` (`<link>` Google Fonts)
- Test: `tests/offline/theme_guard.test.js`

**Interfaces:**
- `:root`: `--radius-control: 8px`, `--radius-card: 14px` (Default = nilai sekarang).
- Konsumen: `.btn`, `.input`, `.sidebar-link` → `var(--radius-control)`; `.card`, `.stat-card`, `.ftask` → `var(--radius-card)`; `.task-row` (dua aturan) → `var(--radius-md)`; `.modal-content` → `var(--radius-lg)`; `.badge`, `.tl-view-btn` → `var(--radius-sm)`.
- `h1, h2, h3, .dash-hero-greet, .focus-page-title { font-family: var(--font-heading); }` (Default `inherit` = identik).
- Google Fonts: tambah `family=Nunito:wght@700;800` ke URL `<link>` yang ada (satu request).

- [ ] **Step 1: Tes gagal** — `guard: komponen inti memakai token radius` (selektor → token di atas), `guard: --radius-control 8px, --radius-card 14px di :root`, `guard: aturan font-heading ada`, `guard: link Google Fonts memuat Nunito 700;800`.
- [ ] **Step 2:** Tes → FAIL.
- [ ] **Step 3:** Implementasi.
- [ ] **Step 4:** Tes → PASS; `compare` Default 16/16.
- [ ] **Step 5: Commit** — `feat(tema): radius & font judul lewat token (Default identik)`

### Task 5: React — `useThemeAttrs`, `useSystemDark`, aksen mindmap

**Files:**
- Modify: `static/index.html` (`useThemeName` ±19190 → `useThemeAttrs`; pemakai ±19271, 19401, 19483; `useSystemDark` ±19212; efek `postTheme` mindmap ±14816; `src` iframe `?v=146` → `?v=147`)
- Modify: `static/vendor/mind-elixir/index.html` (handler `setTheme` ±1356)
- Test: `tests/offline/theme_react.test.js` (pola tes sumber: iris fungsi dari `index.html` dengan regex seperti `tests/offline/liveedit_ui.test.js`)

**Interfaces:**
- `useThemeAttrs() -> { theme: "light"|"dark", palette: string, decor: "on"|"off" }` — `MutationObserver` atribut `data-theme`/`data-palette`/`data-decor`; state berubah hanya bila salah satu nilai berubah. `useThemeName` dihapus; tiga grafik memakai `const { theme, palette } = useThemeAttrs();` dan `palette` masuk deps efek gambar ulang.
- `useSystemDark(enabled)`: nilai yang dikembalikan sinkron dengan `enabled` pada render yang sama (pola derived state: simpan `{enabled, dark}`; bila `state.enabled !== enabled` saat render → hitung `read()` dan `setState`); pendengar `change` tetap.
- `postTheme` mengirim `{ type:"setTheme", theme, accent, accentSoft, accentInk }` dari `getComputedStyle(document.documentElement)` (`--accent`, `--accent-soft`, `--accent-ink`, di-`trim`).
- Iframe: bila `accent` string tak kosong → set `--side-accent`, `--side-hover` (= `accentSoft`), `--side-accent-ink` (= `accentInk`) di `document.documentElement.style`; bila kosong → hapus properti inline (kembali ke nilai CSS bawaan iframe).

- [ ] **Step 1: Tes gagal** `theme_react.test.js`: `useThemeName tidak ada lagi; 3 pemakai memakai useThemeAttrs dan deps efek memuat palette`, `useThemeAttrs mengamati 3 atribut`, `useSystemDark: nilai sinkron saat enabled berubah` (sumber memuat pembanding `enabled` di jalur render), `mindmap: postMessage membawa accent/accentSoft/accentInk`, `iframe: handler mengabaikan accent kosong` (sumber `mind-elixir/index.html` memuat `removeProperty('--side-accent')`), `src iframe ?v=147`.
- [ ] **Step 2:** Tes → FAIL.
- [ ] **Step 3:** Implementasi.
- [ ] **Step 4:** Tes → PASS; `check_inline_scripts` OK; `compare` 16/16.
- [ ] **Step 5: Commit** — `feat(tema): useThemeAttrs (grafik ikut palet), useSystemDark sinkron, aksen mindmap`

### Task 6: Kartu "Tampilan" di Pengaturan + `ThemeToggle`

**Files:**
- Modify: `static/index.html` (`SettingsPage` ±26130: kartu baru sebelum percabangan "Ganti Username"/lengkapi akun; pemanggil `SettingsPage` di App ±43758; `ThemeToggle` ±1510)
- Modify: `static/app.css` (kelas `.theme-card*`)
- Test: `tests/offline/theme_settings_ui.test.js`

**Interfaces:**
- `SettingsPage({..., themePrefs, resolvedTheme, onThemePrefs })`; App memberi `themePrefs`, `resolvedTheme`, `onThemePrefs: setThemePrefs`.
- Komponen `ThemeSettingsCard({ themePrefs, resolvedTheme, onThemePrefs })` (didefinisikan tepat sebelum `SettingsPage`), struktur & teks spec §3.7:
  - Mode: `div[role=radiogroup][aria-label=Mode]` berisi 3 `button[role=radio][aria-checked]` (`light`/`dark`/`system` → `onThemePrefs({mode})`); panah kiri/kanan memindah pilihan.
  - Palet: `div.theme-card-palettes` (grid 3 kolom; 1 kolom < 420 px lewat `@media (max-width: 419px)`), tiap `button[aria-pressed]` dengan tiga `span.theme-swatch` (warna dari `TF.themes.paletteById(id).swatch[resolvedTheme.theme]`: accent, soft, bg) + nama → `onThemePrefs({palette})`.
  - Dekorasi (S2): dirender hanya bila `window.TF && window.TF.decor`; `button[role=switch][aria-checked]`, `disabled` bila `!TF.themes.isDecorAvailable(palette)`, keterangan dua teks spec.
  - Pratinjau: `div.theme-preview` dua baris task contoh ("Kerjakan tugas Biologi bab 4", "Bayar iuran kas kelas" tercoret) + chip `#sekolah`, warna hanya dari token.
- `ThemeToggle`: elemen `button type=button` dengan `aria-label`/`title` "Ganti ke mode gelap" (bila efektif terang) / "Ganti ke mode terang"; tampilan sama.
- CSS `.theme-card*` hanya memakai token (tanpa hex).

- [ ] **Step 1: Tes gagal** `theme_settings_ui.test.js` (tes sumber): semua teks UI persis ada di `ThemeSettingsCard`; `role=radiogroup` + 3 `role=radio`; `aria-pressed` palet; baris dekorasi dijaga `TF.decor`; kartu dirender sebelum `"Ganti Username"` dan di luar cabang lengkapi akun; App meneruskan 3 prop; `ThemeToggle` adalah `button` dengan dua `title`; `.theme-card*` di `app.css` tanpa hex.
- [ ] **Step 2:** Tes → FAIL.
- [ ] **Step 3:** Implementasi.
- [ ] **Step 4:** Tes → PASS; `check_inline_scripts` OK; `compare` (Pengaturan berubah: baseline `settings-*` diharapkan FAIL karena kartu baru — catat; 14 lainnya PASS).
- [ ] **Step 5: Commit** — `feat(tema): kartu Tampilan di Pengaturan (mode, palet, pratinjau)`

### Task 7: E2E palet + audit visual

**Files:**
- Modify: `temporary_files/e2e_tema_fondasi.py` (opsi `--palette` untuk `baseline`/`compare`/`shots`; sub-perintah `shots` dan cek `verify` baru)
- Create (tidak di-commit): `temporary_files/e2e_tema_fondasi/shots/<palette>/`

**Interfaces:**
- `shots --palette sakura|lavender` → 16 PNG (8 halaman × 2 mode) + 375 px Fokus & Pengaturan × 2 mode, untuk audit manual.
- `verify` tambahan: `v-boot` (tf_palette=sakura → `data-palette=sakura` dan `--accent` terhitung `#B0287E` sebelum React), `v-settings` (klik palet Lavender di kartu → `data-palette`, meta `theme-color` `#FAF6FD`, `localStorage.tf_palette`, tanpa reload), `v-system` (pil "Ikuti sistem" + `emulate_media(color_scheme="dark")` → `data-theme=dark`; tidak ada snapshot `light` di antara klik dan efek — rekam `data-theme` lewat `MutationObserver` di halaman), `v-chart` (dashboard terbuka, ganti palet → warna garis grafik ≠ sebelumnya; baca piksel canvas atau `chart.data.datasets[0].borderColor`), `v-mindmap` (buka mindmap, ganti palet → `--side-accent` iframe = aksen baru), `v-settings-375` (viewport 375: grid palet 1 kolom, tanpa scroll horizontal).

- [ ] **Step 1:** Tambah cek `verify` (gagal di branch sebelum Task 1–6 tidak perlu dibuktikan; jalankan sekarang).
- [ ] **Step 2:** `python3 temporary_files/e2e_tema_fondasi.py verify` → semua PASS; `shots --palette sakura` dan `--palette lavender` → 20 gambar masing-masing.
- [ ] **Step 3:** Audit visual: buka gambar; daftar elemen yang tampak "sisa Default" (hijau/abu navy) di laporan, dengan file:baris sumbernya. Perbaiki yang berupa literal aksen/permukaan di jalur komponen yang sudah disentuh plan ini; sisanya masuk daftar tindak lanjut.
- [ ] **Step 4: Commit** — `test(tema): E2E palet (verify + shots audit)`

### Task 8: Rilis, handover

**Files:**
- Modify: `static/sw.js` (`CACHE`, `STATIC` app.css + themes.css), `static/index.html` (`__SW_VERSION` + fallback, `app.css?v=370`, `themes.css?v=2`), tes versi di `tests/`, `static/whatsnew.json` (entri teratas), `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md`, `tests/test_theme_node.py` (`NODE_TESTS` + `theme_palettes`, `theme_react`, `theme_settings_ui`)

**Interfaces:**
- `whatsnew.json` entri teratas: `{"version": "taskflow-v<N>-tema-sakura-lavender", "date": "<tanggal>", "title": "Tema Sakura dan Lavender", "new": ["Pilih palet Sakura (pink) atau Lavender (ungu) di Pengaturan › Tampilan.", "Mode tampilan kini bisa Terang, Gelap, atau Ikuti sistem."], "fixed": ["Garis dan bar progres di mode gelap tidak lagi tampak terang."]}` (ikuti aturan isi spec apa-yang-baru §3.3; bentuk kunci ikuti entri yang ada).

- [ ] **Step 1:** Cek nomor versi `main` + PR terbuka; terapkan versi di semua tempat (kecuali entri lama `whatsnew.json`).
- [ ] **Step 2:** Jalankan `python -m pytest tests/test_whatsnew.py tests/test_sw_precache_node.py tests/test_app_update_node.py tests/test_theme_node.py tests/test_version.py -q && npm test && python -m pytest tests/ -q && node temporary_files/check_inline_scripts.js && python3 temporary_files/e2e_tema_fondasi.py compare && python3 temporary_files/e2e_tema_fondasi.py verify` → PASS (compare: hanya `settings-*` yang berubah, disengaja).
- [ ] **Step 3:** CURRENT_STATE (entri baru paling atas; sisa untuk PR C: `decor.js`, `EmptyState`, kelopak, glyph, sakelar dekorasi tampil; temuan audit Task 7), SESSION_LOG.
- [ ] **Step 4: Commit** — `chore(tema): rilis v<N> tema Sakura & Lavender + handover`.
