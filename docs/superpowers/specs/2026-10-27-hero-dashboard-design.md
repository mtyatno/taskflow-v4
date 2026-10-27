# Spec: Hero Dashboard baru — fokus + habit + topografi, dan streak habit "hari ini boleh belum"

- **Tanggal:** 2026-10-27
- **Basis kode:** `main` @ `d5a8872` (SW `taskflow-v479-tema-sakura-lavender`, `app.css?v=375`, `themes.css?v=2`)
- **Status:** disetujui Bapak lewat mockup (kanvas Design "Hero Dashboard Alurik", bagian **D · Gabungan**) dan jawaban 2026-10-27 11:34–11:40 WIB.
- **Branch:** `claude/hero-dashboard`

## 1. Permintaan dan keputusan

Bapak ingin hero card Dashboard lebih menarik. Dari dua inspirasi (ilustrasi 3D + kartu fokus; topografi + streak) dipilih gabungan:

| Topik | Keputusan |
|---|---|
| Latar | Gradien `--bg-card` → `--accent-soft` + pola garis topografi SVG berwarna `--accent` (ikut palet & mode, offline) |
| Ilustrasi | SVG duotone kecil per palet (Default: daun, Sakura: ranting bunga, Lavender: tangkai lavender), bukan 3D raster |
| Streak | Chip "N hari beruntun" = **streak habit tertinggi** saat ini (sama dengan "Rekor" di halaman Habit); tooltip menyebut nama habit; disembunyikan bila 0 |
| Logika streak | **Diperbaiki:** hari ini yang belum dicentang tidak memutus streak (sama seperti bot Telegram). Berlaku juga di halaman Habit. |
| Terlambat | Chip peringatan "N terlambat" (warna bahaya, sama di semua palet) |
| Fokus | Chip "Fokus · judul task + Mulai/Jeda" bila ada task difokuskan; bila tidak ada: chip ajakan **"Pilih task untuk difokuskan"** → buka Fokus Hari Ini |
| Habit | Semua habit hari ini sebagai chip (belum selesai bisa dicentang langsung; selesai dicoret), maksimal 3 di desktop + chip "+N" → halaman Habit |
| Ring | Tetap `DashProgressRing` di kanan, latar semi-transparan |
| HP | Ilustrasi disembunyikan; chip Fokus selebar layar, target sentuh ≥ 44 px; habit satu baris bisa digeser |

## 2. Logika streak habit

Aturan lama (`static/offline/habitlogic.js` `deriveToday` dan `webapp.py` daftar habit): mundur dari **hari ini**; `done` +1, `skipped` dilewati, selain itu putus. Akibatnya habit yang belum dicentang hari ini selalu bernilai 0.

Aturan baru (dua tempat itu, identik): bila hari ini **tidak punya log**, mulai menghitung dari kemarin; selebihnya sama (`done` +1, `skipped` dilewati, lainnya putus). Log hari ini `done` tetap dihitung, `skipped` tetap dilewati, `missed` tetap memutus. `repository.get_habit_streak` (bot) tidak diubah.

## 3. Hero

- Modul murni baru `static/offline/herologic.js` (`window.TF.hero`):
  - `bestStreak(habits)` → `{ days, title }` habit dengan `streak` terbesar (> 0), atau `null`.
  - `habitChips(habits, phase, limit)` → `{ shown, more }`; urutan: belum selesai di fase sekarang, belum selesai lainnya, lalu selesai.
  - `focusChip(focusTask, timer)` → `{ kind: "active"|"invite", title, action: "start"|"pause"|null }`.
- `Dashboard` hero (struktur):
  - `svg.dash-hero-topo` dan `span.dash-hero-illus` (keduanya `aria-hidden`, `pointer-events:none`); ilustrasi memilih SVG dari palet aktif (`useThemeAttrs()`), disembunyikan bila `[data-decor="off"]` dan di lebar ≤ 1100 px.
  - Baris meta: tanggal + chip streak.
  - Judul sapaan (tidak berubah).
  - Ringkasan: kalimat yang sama seperti sekarang kecuali cabang "Ada N prioritas hari ini" tidak lagi menyebut terlambat di teks; chip "N terlambat" tampil bila `pendingToday.length > 0 && overdueCount > 0`.
  - Ring progres (tidak berubah perilakunya).
  - Baris chip: chip Fokus/ajakan (hanya bila `intro === "dashboard"` dan ada task) lalu chip habit (bila ada habit) dan "+N".
  - Kotak tangkap cepat (tidak berubah).
- Chip Fokus aktif: klik judul → `onNav("today")`; tombol `Mulai` → `timer.start()`, `Jeda` → `timer.pause()` saat berjalan.
- Chip habit belum selesai = `<button>` → `handleCheckinHabit(h)` (perilaku sekarang); selesai = elemen non-interaktif bercoret dengan centang terisi.
- Teks UI persis: `"hari beruntun"`, `"terlambat"`, `"Fokus"`, `"Mulai"`, `"Jeda"`, `"Pilih task untuk difokuskan"`.
- Emoji di hero dihapus (pakai `ViewGlyph`, mis. `pFlame`).
- Warna: hanya token (`--accent*`, `--bg-card`, `--border`, `--text-*`) + warna bahaya yang sudah dipakai `.dash-date.is-overdue`. Tanpa `border-left` aksen.

## 4. Koordinasi

- Plan PR C dekorasi (`docs/superpowers/plans/2026-10-27-tema-dekorasi.md` Task 4) memasang `Decor page-corner` di `.dash-hero`. Setelah PR ini, hero sudah punya ilustrasinya sendiri; PR C cukup memasang kelopak di titlebar Fokus Hari Ini saja (catat di handover).

## 5. Pengujian

- Node: `herologic.test.js`, tambahan `habitlogic.test.js` (hari ini kosong → hitung dari kemarin), `dashboard_hero.test.js` (sumber: teks UI, chip, tanpa emoji hero, topo/illus `aria-hidden`).
- Pytest: streak daftar habit dengan hari ini tanpa log.
- E2E Playwright `temporary_files/e2e_hero_dashboard.py`: tangkapan Default/Sakura/Lavender × terang/gelap pada 1280 px + 375 px; cek chip ajakan saat tidak ada fokus, chip aktif setelah fokus, centang habit dari hero, streak muncul tanpa check-in hari ini.
- Standar: `npm test`, `python -m pytest tests/ -q`, `node temporary_files/check_inline_scripts.js`.
