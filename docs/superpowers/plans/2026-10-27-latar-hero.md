# Latar hero Dashboard + kartu Pomodoro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Enam latar (Kontur/Gradasi/Lanskap/Galaksi/Objek 3D/Polos) yang dipilih di Pengaturan › Tampilan dan berlaku di hero Dashboard + kartu Pomodoro; kartu Pomodoro terang di mode terang dan ikut palet di mode gelap.

**Spec:** `docs/superpowers/specs/2026-10-27-latar-hero-design.md` (acuan visual: `docs/superpowers/specs/2026-10-27-latar-hero/mockup_gen.py`).

**Tech Stack:** React tanpa build (`static/index.html` = `React.createElement`, JSX dilarang), modul UMD `static/offline/`, CSS di `static/app.css`, `node --test` + jembatan pytest (`tests/test_theme_node.py`, `tests/test_hero_node.py`), Playwright E2E lokal.

## Global Constraints

- Basis `main` @ `ce4ccd1`. Versi PR: SW `taskflow-v483-latar-hero`, `app.css?v=379` (cek ulang `main` sebelum merge).
- Kode baru di `index.html` = `React.createElement(...)`; `node temporary_files/check_inline_scripts.js` OK.
- Penjaga tema (`tests/offline/theme_guard.test.js`) wajib hijau: tanpa hex keluarga lime/`rgba(168,197,0` baru di luar tempat sah, tanpa aturan `[data-theme="dark"] …` berliteral baru (allowlist tidak boleh bertambah), tanpa teks putih di atas `var(--accent…)`, tanpa `border-left` aksen. Warna skema latar hidup di `herobg.js` (JS), bukan di `app.css`.
- Warna bermakna (merah/hijau/ungu/kuning Pomodoro, bahaya) tidak berubah nilainya kecuali versi teks mode terang yang ditetapkan spec §6.
- Baseline tes: `npm test` semua lulus kecuali 1 gagal pra-ada (`draw_local_reactive.test.js`, butuh bundel tldraw); `pytest` lulus.
- Tiap commit diakhiri trailer sesi (lihat brief subagent).

### Task 1: Preferensi `herobg` di sistem tema
**Files:** `static/offline/themes.js`, skrip `#tf-theme-boot` di `static/index.html`, `useThemeAttrs` (±19908) dan `setThemePrefs` di App, `tests/offline/themes.test.js`, `tests/offline/theme_boot.test.js`.
- [ ] Tes gagal → implementasi (spec §2) → tes lulus → commit `feat(tema): preferensi latar hero (tf_herobg, data-herobg)`.

### Task 2: Registri `static/offline/herobg.js`
**Files:** create `static/offline/herobg.js`, `tests/offline/herobg.test.js` (+ daftarkan di jembatan pytest), `<script>` di `index.html` (sebelum skrip aplikasi utama, dekat `decor.js`), `STATIC` `sw.js`.
- [ ] Port `bg()`/skema dari `mockup_gen.py` ke JS (spec §3): `render` → `{base, ambient, feature}`; kotak fitur TIDAK lagi berbasis px kartu — tiap `place` memakai viewBox tetap untuk fitur (hero 400×190 objek / 180×225 menara / 150×110 ilustrasi / pohon; pomo baris lebar; thumb) dan ambient berbasis viewBox + `preserveAspectRatio` (lihat spec). Kontur/Polos hanya token.
- [ ] Tes (spec §9) → commit `feat(latar): registri latar hero (6 pilihan)`.

### Task 3: `HeroBackdrop` + hero Dashboard
**Files:** `static/index.html` (komponen baru dekat `DashHeroIllus`; hero `Dashboard`), `static/app.css` (`.hb*`, `.dash-hero`), tes UI.
- [ ] Hero memakai backdrop; Kontur identik dengan sebelumnya (bandingkan tangkapan `main`); hapus kode topo/ilustrasi lama yang pindah ke registri. Commit `feat(dashboard): hero memakai latar pilihan`.

### Task 4: Kartu Pomodoro + bar ringkas
**Files:** `static/index.html` (kartu Pomodoro ±12198, bar ringkas), `static/app.css` (`.focus-pomo*`, `.pomo-*`, `.focus-mini*`, blok HP), tes UI.
- [ ] Spec §6. Commit `feat(fokus): kartu Pomodoro terang di mode terang + latar pilihan`.

### Task 5: Pengaturan › Tampilan — bagian Latar
**Files:** `static/index.html` (kartu Tampilan ±27075), `static/app.css`, `tests/offline/theme_settings_ui.test.js` (atau tes baru).
- [ ] Spec §7. Commit `feat(pengaturan): pilihan latar di Tampilan`.

### Task 6: Rilis + E2E + handover
**Files:** `static/sw.js`, `static/index.html` (`__SW_VERSION`), tes versi, `static/whatsnew.json`, create `temporary_files/e2e_latar_hero.py`, `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md`, `.agents/DECISIONS.md` (ADR: latar = sumbu ke-4; skema warna latar di JS registri).
- [ ] PROTOCOL §4; E2E spec §9; commit `chore(rilis): v483 latar hero`.
