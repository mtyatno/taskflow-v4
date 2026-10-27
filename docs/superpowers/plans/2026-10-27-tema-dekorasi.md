# Tema PR C — dekorasi Sakura & Lavender: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Di palet Sakura dan Lavender (dekorasi aktif) tampil kelopak melayang di header, maskot bunga di layar kosong, dan penghitung sesi fokus berbentuk kelopak; sakelar "Dekorasi tema" di Pengaturan mematikannya.

**Architecture:** Registri SVG murni `TF.decor` (`static/offline/decor.js`) yang hanya mewarnai lewat token; komponen slot `Decor({slot})` membaca `useThemeAttrs()` + peta slot palet `TF.themes.decorFor`; komponen bersama `EmptyState` memakai maskot bila slot terpetakan, selain itu ikon duotone; `ViewGlyph` menukar `pomoTomato` → `pomoPetal` lewat slot `pomo-glyph`. Kartu Tampilan otomatis menampilkan sakelar karena `window.TF.decor` kini ada.

**Tech Stack:** React tanpa build (`static/index.html` = `React.createElement`, JSX dilarang), SVG inline, CSS custom property, `node --test` + jembatan pytest, Playwright E2E lokal.

**Spec:** `docs/superpowers/specs/2026-10-26-tema-palet-dekorasi-design.md` (§3.5, §3.6, §3.7 butir 3, §4 baris C, §5). Mockup yang disetujui (bentuk maskot & kelopak): artboard "Hari Ini" di kanvas "Tema Sakura Alurik" (sumber disalin ke workspace SDD sebagai `mockup-main.dc.html`).

## Penyesuaian terhadap spec (diputuskan saat menulis plan)

- **C1 — "Hari Ini" dan "Fokus" adalah satu halaman** (`page === "today"`, judul "Fokus Hari Ini"). Kelopak `page-corner` dipasang di titlebar halaman itu **dan** di hero Dashboard (`.dash-hero`), supaya tetap ada dua tempat.
- **C2 — Kotak Masuk kosong** = `TaskListView` dengan `isInbox`; tidak ada komponen terpisah. Empat tempat spec → tiga pemanggil kode: (1) `focus-empty` Fokus Hari Ini (`done`), (2) kosong `TaskListView` (`filter` bila ada filter; `done` + judul "Kotak Masuk bersih!" bila Inbox; selain itu `empty` "Tidak ada task"), (3) `DashEmpty` dashboard (`empty`, varian kecil).
- **C3 — `DashEmpty` varian kecil:** maskot 40 px sebaris dengan teks (bukan 96 px) agar kartu dashboard tidak melar; ikon duotone 18 px tetap di Default.
- **C4 — Default juga berubah sedikit (disengaja, spec §3.6/§6):** emoji 🎉/🔍 di Fokus Hari Ini dan daftar task diganti ikon duotone. Gerbang piksel Default mengharapkan perubahan hanya di gambar yang memuat layar kosong itu.

## Global Constraints

- Basis: `main` @ `d5a8872` (SW `taskflow-v479-tema-sakura-lavender`, `app.css?v=375`, `themes.css?v=2`). Versi PR ini: SW `taskflow-v<N>-tema-dekorasi` (saat plan ditulis N = 480; cek `main` + PR terbuka di Task 6), `app.css?v=376`.
- `static/index.html` terkompilasi: kode baru = `React.createElement(...)`; `node temporary_files/check_inline_scripts.js` harus OK.
- Hanya klien; tanpa backend.
- SVG dekorasi hanya memakai `currentColor` atau `var(--accent)`, `var(--accent-duo)`, `var(--accent-soft)`, `var(--bg-card)`, `var(--text-primary)`; tanpa hex/rgb, tanpa `<script>`, `url(`, `on*=`, `<image>`, `<foreignObject>`.
- Semua dekorasi `aria-hidden="true"`, `pointer-events: none`; animasi mati di `@media (prefers-reduced-motion: reduce)`; kelopak header tersembunyi saat Zen Mode (kelas `is-zen` halaman) dan di lebar < 480 px bila menutupi judul.
- `decorFor(palette, slot)` dari `TF.themes` adalah satu-satunya sumber peta slot; Default tidak punya slot.
- Teks UI persis: `"Kotak Masuk bersih!"`, `"Tidak ada task urgent!"`, `"Semua Q1, terlambat, dan deadline hari ini sudah selesai."`, `"Tidak ada task"`, `"Tidak ada task yang cocok dengan filter"`, `"Belum ada task"`; sakelar: `"Dekorasi tema"`, `"Kelopak dan maskot di layar kosong"`, `"Tersedia untuk palet Sakura dan Lavender"`.
- File baru `static/offline/decor.js` masuk `STATIC` `sw.js` URL persis (ADR-029), dimuat sebelum `ui-components.js` (setelah `themes.js`).
- Rilis: checklist `.agents/PROTOCOL.md` §4; `whatsnew` judul "Dekorasi tema Sakura dan Lavender". Branch `claude/tema-dekorasi`, PR draft, merge hanya setelah "merge dan deploy".
- Commit diakhiri baris atribusi sesi. Verifikasi standar: `npm test`, `python -m pytest tests/ -q`, `check_inline_scripts`.

## Review Focus

1. **Sakelar dekorasi dimatikan saat halaman terbuka** — kelopak & maskot hilang seketika tanpa muat ulang, ruangnya tidak tersisa. Tes: Task 2 `Decor → null saat data-decor=off` + E2E Task 5 `d-toggle`.
2. **Ganti palet ke Default saat layar kosong tampil** — maskot berganti ikon duotone seketika. Tes: Task 3 `EmptyState: Default → ikon` + E2E `d-palette`.
3. **Pengguna dengan "kurangi gerakan"** — kelopak tidak beranimasi. Tes: Task 2 guard CSS `prefers-reduced-motion` + E2E `d-motion` (`emulate_media(reduced_motion="reduce")` → `animation-name: none`).
4. **Zen Mode di Fokus Hari Ini** — kelopak header ikut tersembunyi. Tes: Task 4 E2E `d-zen`.
5. **HP 375 px** — kelopak tidak menutupi judul/tombol titlebar. Tes: Task 5 E2E `d-375` (kotak kelopak tidak berpotongan dengan `h1` dan tombol).

---

### Task 1: Registri `TF.decor`

**Files:**
- Create: `static/offline/decor.js` (pola UMD `static/offline/themes.js`)
- Modify: `static/index.html` (`<script src="/static/offline/decor.js">` tepat setelah `themes.js`), `static/sw.js` (`STATIC`)
- Test: `tests/offline/decor.test.js`

**Interfaces:**
- Produces `window.TF.decor = { DECOR, svgFor(id) }`. `DECOR` beku: `{ petals: { svg, animated: true }, "mascot-happy": { svg }, "mascot-search": { svg } }`. `svgFor(id) -> string|null`.
- `petals`: viewBox 130×90, 4 kelopak (bentuk mockup), `fill="var(--accent-duo)"`.
- `mascot-happy`: viewBox 96×96, bunga 5 kelopak (`fill var(--bg-card)`, `stroke var(--accent)`), pusat `var(--accent-duo)`, mata & senyum `var(--text-primary)`, pipi `var(--accent)` opacity .45 (mockup "Kotak Masuk bersih!").
- `mascot-search`: wajah sama tanpa senyum lebar (mulut "o" kecil) + kaca pembesar `stroke var(--accent)` di kanan bawah.
- Registri `TF.themes` sudah memetakan `pomo-glyph: "petal"`; `petal` bukan entri `DECOR` (glyph ada di `VIEW_GLYPHS`, Task 4).

- [ ] **Step 1: Tes gagal** `decor.test.js`: `DECOR berisi tepat petals, mascot-happy, mascot-search`; `tiap svg diawali <svg dan berisi viewBox`; `tanpa hex/rgb/hsl, <script, url(, on\w+=, <image, <foreignObject`; `warna hanya currentColor atau var(--accent|--accent-duo|--accent-soft|--bg-card|--text-primary)`; `svgFor id tak dikenal → null`; `setiap id dekorasi yang dirujuk peta slot TF.themes ada di DECOR, kecuali "petal"`; `decor.js dimuat setelah themes.js dan sebelum ui-components.js; ada di STATIC`.
- [ ] **Step 2:** `node --test tests/offline/decor.test.js tests/offline/sw_precache_shell.test.js` → FAIL.
- [ ] **Step 3:** Implementasi.
- [ ] **Step 4:** Tes → PASS; `check_inline_scripts` OK; `compare`: `settings-*` berubah (baris sakelar dekorasi kini tampil, disabled di Default) — selain itu tanpa perubahan.
- [ ] **Step 5: Commit** — `feat(tema): registri dekorasi TF.decor (kelopak, maskot)`

### Task 2: Komponen `Decor` + CSS dekorasi

**Files:**
- Modify: `static/index.html` (komponen `Decor` tepat setelah `useThemeAttrs`), `static/app.css` (`.decor*`)
- Test: `tests/offline/decor_ui.test.js` (render dengan React tiruan lewat `vm`, pola `tests/offline/theme_settings_ui.test.js`)

**Interfaces:**
- `Decor({ slot, size, className }) -> element|null`: `const { palette, decor } = useThemeAttrs(); const id = decor === "on" ? TF.themes.decorFor(palette, slot) : null; const svg = id && TF.decor.svgFor(id);` bila `!svg` → `null`; selain itu `span.decor.decor-<slot>(+className)` `aria-hidden="true"` dengan `dangerouslySetInnerHTML: { __html: svg }` dan `style.width/height = size` bila diberikan.
- CSS: `.decor { display:inline-block; pointer-events:none; user-select:none; line-height:0 }`, `.decor svg { width:100%; height:100% }`, `.decor-page-corner { position:absolute; top:0; right:12px; width:130px; height:90px; animation: decor-float 6s ease-in-out infinite; }` (`@keyframes decor-float` translateY 0→-6px→0), `@media (prefers-reduced-motion: reduce) { .decor-page-corner { animation: none } }`, `@media (max-width: 479px) { .decor-page-corner { width:88px; height:61px; right:4px; } }`, `.is-zen .decor-page-corner { display:none }`.

- [ ] **Step 1: Tes gagal** `decor_ui.test.js`: `Default → null`, `sakura + decor on + slot page-corner → span.decor.decor-page-corner aria-hidden berisi svg petals`, `decor off → null`, `slot tak dipetakan → null`, `size → style width/height`; guard CSS: `reduced-motion mematikan animasi decor-page-corner`, `.decor pointer-events none`, `is-zen menyembunyikan decor-page-corner`.
- [ ] **Step 2:** Tes → FAIL.
- [ ] **Step 3:** Implementasi.
- [ ] **Step 4:** Tes → PASS; `check_inline_scripts` OK; `compare` Default tanpa perubahan (komponen belum dipakai).
- [ ] **Step 5: Commit** — `feat(tema): komponen Decor + CSS dekorasi`

### Task 3: `EmptyState` bersama + migrasi 3 pemanggil

**Files:**
- Modify: `static/index.html` (`EmptyState` sebelum `DashEmpty`; pemakai: `focus-empty` Fokus Hari Ini, kosong `TaskListView`, `DashEmpty`), `static/index.html` `VIEW_GLYPHS` (glyph `emptyDone`, `emptySearch`, `emptyInbox` bila belum ada — duotone, `currentColor`, `fill-opacity .22`), `static/app.css` (`.empty-state*`)
- Test: `tests/offline/empty_state_ui.test.js`

**Interfaces:**
- `EmptyState({ kind, title, hint, compact = false })`, `kind ∈ "done"|"filter"|"empty"`: slot `"empty-" + kind`; bila `Decor` slot itu menghasilkan svg → maskot (`size` 96, atau 40 bila `compact`); selain itu `ViewGlyph` (`done`→`emptyDone`, `filter`→`emptySearch`, `empty`→`emptyInbox`) ukuran 36 (18 bila `compact`) dengan warna `var(--accent-text)`. `title` (tebal), `hint` (opsional). `compact` = satu baris (ikon/maskot + teks) untuk dashboard.
- Pemakai: Fokus Hari Ini → `EmptyState({kind:"done", title:"Tidak ada task urgent!", hint:"Semua Q1, terlambat, dan deadline hari ini sudah selesai."})` (pertahankan `className` `focus-empty${zenClass}` dan `aria-hidden` Zen di pembungkus); `TaskListView` → filter: `{kind:"filter", title:"Tidak ada task yang cocok dengan filter"}`, Inbox: `{kind:"done", title:"Kotak Masuk bersih!"}`, lainnya `{kind:"empty", title:"Tidak ada task"}` (pembungkus `.card` tetap); `DashEmpty({text})` → `EmptyState({kind:"empty", title:text, compact:true})` (kelas `dash-empty` tetap di pembungkus).
- Emoji 🎉/🔍 hilang dari ketiga tempat (C4).

- [ ] **Step 1: Tes gagal** `empty_state_ui.test.js`: `Default → ViewGlyph sesuai kind, tanpa svg maskot`; `sakura+on → maskot mascot-happy (done/empty) / mascot-search (filter) 96 px`; `compact → 40 px / 18 px`; `teks UI persis`; sumber: `tidak ada "🎉"/"🔍" di focus-empty dan TaskListView kosong`, `Inbox memakai "Kotak Masuk bersih!"`, `DashEmpty memakai EmptyState compact`.
- [ ] **Step 2:** Tes → FAIL.
- [ ] **Step 3:** Implementasi.
- [ ] **Step 4:** Tes → PASS; `check_inline_scripts` OK; `compare` (Default: berubah hanya gambar yang memuat layar kosong — catat nama dan periksa diff).
- [ ] **Step 5: Commit** — `feat(tema): EmptyState bersama (maskot di palet, ikon duotone di Default)`

### Task 4: Kelopak header + glyph kelopak Pomodoro

**Files:**
- Modify: `static/index.html` (titlebar Fokus Hari Ini `.focus-page-titlebar` dan `.dash-hero`: tambah `React.createElement(Decor, { slot: "page-corner" })`; `VIEW_GLYPHS.pomoPetal`; `ViewGlyph` memetakan `pomoTomato` → `pomoPetal` bila `decorFor(palette,"pomo-glyph") === "petal"` dan `decor === "on"`), `static/app.css` (`position: relative` pada titlebar/hero bila belum)
- Test: `tests/offline/decor_ui.test.js` (tambahan)

**Interfaces:**
- `pomoPetal`: satu kelopak duotone 24×24 (`fill="currentColor" fill-opacity=".22"` + garis), gaya sama `pomoTomato`.
- `ViewGlyph` memanggil `useThemeAttrs()` (hook, aman: `ViewGlyph` adalah komponen fungsi). Pemanggil `ViewGlyph` tidak berubah.

- [ ] **Step 1: Tes gagal**: `ViewGlyph pomoTomato → pomoPetal di sakura/lavender + on; tetap tomat di Default atau decor off`; `ViewGlyph nama lain tidak terpengaruh`; sumber: `Decor slot page-corner ada di titlebar Fokus Hari Ini dan dash-hero`.
- [ ] **Step 2:** Tes → FAIL.
- [ ] **Step 3:** Implementasi.
- [ ] **Step 4:** Tes → PASS; `compare` Default (hanya perubahan Task 3).
- [ ] **Step 5: Commit** — `feat(tema): kelopak header + penghitung sesi kelopak`

### Task 5: E2E dekorasi + audit visual

**Files:**
- Modify: `temporary_files/e2e_tema_fondasi.py` (cek `verify` baru; `shots` menambah layar kosong)

**Interfaces:**
- `verify` tambahan: `d-show` (sakura+on → `.decor-page-corner` ada di Fokus Hari Ini & dashboard, maskot di Inbox kosong), `d-toggle` (sakelar "Dekorasi tema" di Pengaturan → off: tidak ada `.decor` di DOM tanpa reload; on lagi: kembali), `d-palette` (ganti ke Default → maskot berganti ikon duotone), `d-motion` (`emulate_media(reduced_motion="reduce")` → `getComputedStyle(.decor-page-corner).animationName === "none"`), `d-zen` (Zen aktif → kelopak `display:none`), `d-375` (viewport 375 → kotak kelopak tidak berpotongan dengan `h1` dan tombol titlebar), `d-glyph` (kartu Pomodoro di sakura memuat glyph kelopak).
- `shots --palette` menambah: Inbox kosong (akun tanpa task inbox) dan Fokus Hari Ini kosong, terang/gelap; lembar kontak diperbarui.

- [ ] **Step 1:** Tambah cek; jalankan `verify` → PASS semua.
- [ ] **Step 2:** `shots --palette sakura` dan `--palette lavender`; periksa gambar dekorasi; catat temuan.
- [ ] **Step 3: Commit** — `test(tema): E2E dekorasi (verify + shots)`

### Task 6: Rilis + handover

**Files:**
- Modify: `static/sw.js`, `static/index.html` (versi; `app.css?v=376`), tes versi, `static/whatsnew.json`, `tests/test_theme_node.py` (+ `decor`, `decor_ui`, `empty_state_ui` — glob `theme*` tidak mencakup nama ini: perluas glob ke `{theme,decor,empty_state}*` atau daftar eksplisit + uji kesamaan), `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md`, spec §3.5/§3.6 (C1–C4)

**Interfaces:**
- `whatsnew.json` entri teratas: `{"version": "taskflow-v<N>-tema-dekorasi", "date": "<tanggal>", "title": "Dekorasi tema Sakura dan Lavender", "new": ["Kelopak bunga dan maskot lucu muncul di palet Sakura dan Lavender.", "Dekorasi bisa dimatikan di Pengaturan › Tampilan."]}`.

- [ ] **Step 1:** Cek versi `main` + PR terbuka; terapkan versi (jangan `sed` massal `whatsnew.json`).
- [ ] **Step 2:** Gerbang: PROTOCOL §4 pytest, `npm test`, `pytest tests/`, `check_inline_scripts`, `compare` (perubahan Default hanya layar kosong + kartu/sakelar Pengaturan bila tampil), `verify`.
- [ ] **Step 3:** CURRENT_STATE (entri teratas), SESSION_LOG, spec.
- [ ] **Step 4: Commit** — `chore(tema): rilis v<N> dekorasi tema + handover`.
