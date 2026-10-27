# Hero Dashboard baru — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Hero Dashboard dengan latar topografi + ilustrasi palet, chip streak, chip terlambat, chip Fokus/ajakan, chip habit; streak habit tidak lagi 0 saat hari ini belum dicentang.

**Spec:** `docs/superpowers/specs/2026-10-27-hero-dashboard-design.md`

**Tech Stack:** React tanpa build (`static/index.html` = `React.createElement`, JSX dilarang), modul UMD `static/offline/`, `node --test` + jembatan pytest, Playwright E2E lokal.

## Global Constraints

- Basis `main` @ `d5a8872`. Versi PR ini: SW `taskflow-v480-hero-dashboard`, `app.css?v=376` (cek ulang `main` sebelum merge).
- Kode baru di `index.html` = `React.createElement(...)`; `node temporary_files/check_inline_scripts.js` harus OK.
- Warna hanya lewat token (`var(--accent…)`, `--bg-card`, `--border`, `--text-*`, `--accent-soft`, `--accent-duo`, `--accent-on`); warna bahaya mengikuti `.dash-date.is-overdue`. Tanpa `border-left` aksen. Tanpa emoji di hero.
- Baseline: `npm test` 3352 lulus + 1 gagal pra-ada (`draw_local_reactive.test.js`, butuh bundel tldraw); `pytest` 1230 lulus.

### Task 1: Streak habit — hari ini boleh belum
**Files:** `static/offline/habitlogic.js` (`deriveToday`), `webapp.py` (loop streak di endpoint daftar habit ±5205), `tests/offline/habitlogic.test.js`, pytest baru/terkait streak.
- [ ] Tes gagal: hari ini tanpa log + kemarin & lusa `done` → 2; hari ini `done` → dihitung; hari ini `missed` → 0; `skipped` di tengah dilewati; tanpa log sama sekali → 0. Endpoint (pytest) dengan data yang sama.
- [ ] Implementasi: bila hari ini tanpa log, mulai dari kemarin. Logika lain tetap. `repository.get_habit_streak` tidak diubah.
- [ ] Tes lulus; commit `fix(habit): streak tidak putus saat habit hari ini belum dicentang`.

### Task 2: Modul `herologic.js`
**Files:** create `static/offline/herologic.js`, `tests/offline/herologic.test.js`; `static/index.html` (`<script>` dimuat bersama modul offline lain), `static/sw.js` `STATIC`.
- [ ] Tes gagal untuk `bestStreak`, `habitChips` (urutan, `limit`, `more`), `focusChip` (aktif + start/pause, invite).
- [ ] Implementasi UMD seperti `habitlogic.js`; commit.

### Task 3: Hero UI + CSS
**Files:** `static/index.html` (hero `Dashboard` ±23220–23290 + derivasi ±22900), `static/app.css` (`.dash-hero*`, blok mobile ±2956), `tests/offline/dashboard_hero.test.js`, sesuaikan tes lama yang memeriksa pil habit lama (`dashboard_habit_checkin`, `pages_icons_habit_dashboard`) tanpa melemahkan maksudnya.
- [ ] Ikuti spec §3. Ilustrasi = komponen kecil `DashHeroIllus({ palette })` dengan SVG inline yang hanya memakai `currentColor`/`var(--…)`.
- [ ] HP (≤ 640 px): ilustrasi tersembunyi, chip Fokus selebar penuh (min-height 44 px), habit satu baris `overflow-x:auto`.
- [ ] Tes lulus; commit `feat(dashboard): hero baru — topografi, streak, fokus, habit`.

### Task 4: Rilis + E2E
**Files:** `static/sw.js`, `static/index.html` (`__SW_VERSION`), `webapp.py` bila memuat versi, `tests/test_version.py` dll., `static/whatsnew.json`, create `temporary_files/e2e_hero_dashboard.py`.
- [ ] Checklist rilis PROTOCOL §4. whatsnew: judul "Dashboard baru yang lebih hidup", poin pengguna (fokus & habit dari dashboard, streak, terlambat); `fixed`: streak habit tidak lagi 0 sebelum dicentang hari ini.
- [ ] E2E: seed user + task hari ini (1 terlambat) + 4 habit (1 done hari ini, streak berjalan dari kemarin); tangkapan 3 palet × 2 mode @1280 + Sakura terang & Default gelap @375 ke `temporary_files/e2e_hero_dashboard/`; cek chip ajakan, fokus aktif + Mulai/Jeda, centang habit, streak > 0 tanpa check-in hari ini.
- [ ] `npm test`, `pytest`, `check_inline_scripts`; commit.
