# Tema PR A — sisa literal hex netral di `index.html` (untuk audit PR B)

Dibuat di Task 5 plan `2026-10-26-tema-fondasi-token.md` (keputusan R6: literal netral `index.html` **tidak** diubah di
PR A karena menggantinya dengan token mengubah tampilan mode gelap). Daftar ini adalah bahan audit PR B.

- Cakupan: `static/index.html` pada commit Task 5, pencarian tanpa membedakan huruf besar/kecil untuk `#0f172a`,
  `#64748b`, `#94a3b8`, `#262626`, `#171717`, `#e5e5e5`, `#f1f5f9`, `#e2e8f0`, `#cbd5e1`, `#1e293b` → **49 baris**
  (`#171717` tidak ditemukan).
- Kolom **Gelap sekarang**: `benar` = di mode gelap literal itu tampil sesuai maksud (disengaja tetap, cabang
  per mode, fallback yang tak terpakai, atau warna bermakna); `salah` = tampil sebagai sisa tema terang di atas
  permukaan gelap (garis/latar terang).
- Kolom **Saran PR B** hanya arah, bukan keputusan.

## Ringkasan

| Kelompok | Baris | Gelap sekarang | Saran PR B |
|---|---|---|---|
| Detail task, modal, notifikasi (garis/track terang) | 7 | salah (7) | ganti token: `--border` / `--bg-hover` |
| Kalender: chip tanpa prioritas | 2 | salah (1: latar chip), benar (1: titik) | bersama seluruh peta `chipColor` (semua pastel terang) |
| Mode kertas, select kertas, cetak, ekspor dokumen | 16 | benar | biarkan (kertas selalu putih); select gelap → `var(--bg-card)` |
| Layar auth & splash | 5 | benar | putuskan bersama palet (gradien navy tetap) |
| Warna bermakna & ikon dashboard (P4 / Q4 / Someday / KPI, slate) | 12 | benar | biarkan; opsional `--q4` bila konteksnya CSS |
| Fallback (`var(--x, #…)`, `tok()` per mode) | 6 | benar | biarkan |
| `<meta theme-color>` | 1 | benar (R4) | PR B: ikut `--bg-page` per palet/mode |

Total 49 = 7 + 2 + 16 + 5 + 12 + 6 + 1 → **8 salah, 41 benar**. Kelompok kertas = blok `<style>` mode kertas (10) +
select kertas gelap (1) + `PaperPageGuides` (3) + cetak/ekspor (2).

## Rincian per halaman / komponen

### `<head>`

| Lokasi | Konteks | Gelap sekarang |
|---|---|---|
| `index.html:10` | `<meta name="theme-color" content="#0f172a">` | benar — warna status bar sama di kedua mode (plan R4); PR B menggantinya per palet |

### `<head>` `<style>` — mode kertas (`.paper-mode-active .paper-inner-wrap …`)

Kertas selalu putih walau tema gelap (komentar di sumber: "paksa palet dokumen gelap-di-atas-putih"). Semua `benar`.

| Lokasi | Konteks | Gelap sekarang |
|---|---|---|
| `index.html:104` | editor/rendered: `color: #1e293b !important;` | benar |
| `index.html:107` | placeholder kosong: `color: #94a3b8 !important;` | benar |
| `index.html:118` | callout/toggle: `color: #1e293b !important;` | benar |
| `index.html:123` | `details`: `border-color: #e2e8f0 !important;` | benar |
| `index.html:129` | `pre`/`code`: `background: #f1f5f9 !important;` | benar |
| `index.html:130` | `pre`/`code`: `color: #0f172a !important;` | benar |
| `index.html:140` | `th`/`td`: `border-color: #cbd5e1 !important;` | benar |
| `index.html:144` | `th`: `background: #f1f5f9 !important;` | benar |
| `index.html:160` | tasklink fallback: `background: #f1f5f9 !important;` | benar |
| `index.html:161` | tasklink fallback: `border-color: #cbd5e1 !important;` | benar |

### `<head>` `<style>` — select kertas di toolbar (mode gelap)

| Lokasi | Konteks | Gelap sekarang |
|---|---|---|
| `index.html:212` | `[data-theme="dark"] .note-toolbar select.paper-select, … { color-scheme: dark; background: #262626; }` | benar — = `--bg-card` gelap; PR B bisa langsung `var(--bg-card)` |

### Layar auth & splash (gradien navy, sengaja sama di kedua mode)

| Lokasi | Komponen | Konteks | Gelap sekarang |
|---|---|---|---|
| `index.html:1769` | `LoginPage` (lupa sandi) | `background: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)"` | benar |
| `index.html:1814` | `LoginPage` | `background: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)"` | benar |
| `index.html:1928` | `ResetPasswordPage` | `background: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)"` | benar |
| `index.html:2011` | `RegisterPage` | `background: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)"` | benar |
| `index.html:43111` | `App` (splash cek sesi) | `background: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)",` | benar |

### Detail task & modal

| Lokasi | Komponen | Konteks | Gelap sekarang |
|---|---|---|---|
| `index.html:8159` | `ModalAttachments` (baris lampiran) | `borderBottom: "1px solid #f1f5f9"` | **salah** — garis nyaris putih di kartu gelap |
| `index.html:8312` | `ModalNotes` (baris catatan) | `borderBottom: "1px solid #f1f5f9",` | **salah** — idem |
| `index.html:9292` | `TaskDetailBody` (track progress) | `height: 8, background: "#e2e8f0",` | **salah** — track abu terang |
| `index.html:9455` | `TaskDetailBody` (track progress subtask) | `height: 6, background: "#e2e8f0",` | **salah** — idem |
| `index.html:9480` | `TaskDetailBody` (baris subtask) | `borderBottom: "1px solid #f1f5f9"` | **salah** — garis terang |
| `index.html:9999` | `TaskRow` (bar progress mini) | `height: 4, background: "#e2e8f0",` | **salah** — track terang di daftar task |

### Dashboard

| Lokasi | Komponen | Konteks | Gelap sekarang |
|---|---|---|---|
| `index.html:19127` | `dashChartColors` | `text: tok("--text-secondary", dark ? "#a3a3a3" : "#64748b"),` | benar — fallback per mode bila token tak terbaca |
| `index.html:19128` | `dashChartColors` | `textStrong: tok("--text-primary", dark ? "#e5e5e5" : "#0f172a"),` | benar — idem |
| `index.html:19130` | `dashChartColors` | `card: tok("--bg-card", dark ? "#262626" : "#ffffff"),` | benar — idem |
| `index.html:19360` | `StatusBarChart` (canvas) | `const colors = ["#3b82f6", "#f97316", "#eab308", "#94a3b8"];` | benar — warna status GTD (Someday) |
| `index.html:21069` | `dashTint` | `const h = String(hex \|\| "#94a3b8").replace("#", "");` | benar — default tint slate (alpha), netral di kedua mode |
| `index.html:22159` | `Dashboard` KPI "Terlambat" (nol) | `grad: … : ["#cbd5e1", "#94a3b8"],` | benar — gradien ikon KPI, sama di kedua mode seperti KPI lain |
| `index.html:22669` | `Dashboard` kartu Q4 "Singkirkan" | `color: "#94a3b8",` | benar — warna bermakna = `--q4` (lewat `dashTint`, perlu hex) |
| `index.html:22703` | `Dashboard` GTD "Someday" | `accent: "#94a3b8",` | benar — warna bermakna |

### Kalender

| Lokasi | Komponen | Konteks | Gelap sekarang |
|---|---|---|---|
| `index.html:19717` | `CalendarView` `chipColor` (tanpa prioritas) | `bg: "#f1f5f9",` | **salah** — chip pastel terang di kartu gelap (seluruh peta `chipColor` P1–P4/done/overdue juga pastel terang tanpa varian gelap) |
| `index.html:19719` | `CalendarView` `chipColor` | `dot: "#94a3b8"` | benar — titik warna prioritas (bermakna) |

### Prioritas di catatan / editor (warna bermakna P4 = slate)

| Lokasi | Komponen | Konteks | Gelap sekarang |
|---|---|---|---|
| `index.html:1571` | `PRI_DOT` | `P4: "#94a3b8"` | benar |
| `index.html:26937` | `prepMarkdownBlocks` | `P4: '#94a3b8'` | benar |
| `index.html:26951` | `prepMarkdownBlocks` (HTML tasklink hilang) | `<span class="tasklink-priority-label" style="background:#94a3b8">?</span>` | benar |
| `index.html:26957` | `prepMarkdownBlocks` | `const priColor = _PRI_COLORS[priority] \|\| '#94a3b8';` | benar |
| `index.html:30861` | `createTasklinkPlugin` | `P4: '#94a3b8'` | benar |
| `index.html:30886` | `createTasklinkPlugin` | `style: 'background:#94a3b8'` | benar |
| `index.html:30893` | `createTasklinkPlugin` | `const priColor = PRI_COLORS[priority] \|\| '#94a3b8';` | benar |

### Mode kertas, cetak & ekspor (permukaan selalu putih)

| Lokasi | Komponen | Konteks | Gelap sekarang |
|---|---|---|---|
| `index.html:28484` | `printDrawingPreview` (area cetak) | `card.style.cssText = 'color:#64748b;font-size:10pt;';` | benar |
| `index.html:31987` | `PaperPageGuides` (garis batas halaman) | `borderTop: "2px dashed #94a3b8", opacity: 0.9` | benar |
| `index.html:31991` | `PaperPageGuides` (label halaman) | `background: "#fff", color: "#64748b",` | benar |
| `index.html:31992` | `PaperPageGuides` | `border: "1px solid #cbd5e1",` | benar |
| `index.html:36090` | `NotePanel` ekspor Word | `<style>body{…color:#1e293b;}h1{…color:#0f172a;}…` | benar — dokumen ekspor, bukan UI |

### App — panel notifikasi & ErrorBoundary

| Lokasi | Komponen | Konteks | Gelap sekarang |
|---|---|---|---|
| `index.html:44206` | `App` daftar notifikasi | `borderBottom: "1px solid #f1f5f9",` | **salah** — garis terang; baris yang sama juga memakai `#f0fdf4` (belum dibaca) dan `#e0f2fe` (hover) yang terang di mode gelap |
| `index.html:44521` | ErrorBoundary | `color: "var(--text-primary, #0f172a)",` | benar — fallback bila `app.css` gagal dimuat |
| `index.html:44537` | ErrorBoundary | `color: "var(--text-secondary, #64748b)"` | benar — idem |
| `index.html:44562` | ErrorBoundary | `color: "var(--text-primary, #0f172a)"` | benar — idem |

## Literal lime-adjacent yang tetap olive di palet lain (audit PR B)

Tidak ada token yang nilainya sama (selisih > 3 per kanal), jadi PR A membiarkannya. Di palet Sakura/Lavender
warna-warna ini akan tetap hijau-olive. Baris = posisi pada commit Task 5.

| Literal | Lokasi | Peran |
|---|---|---|
| `#4d5c00` | `app.css:3797` `.ftask-tab.is-active` | teks tab aktif (terang) |
| `#d4e85c` | `app.css:3798` `[data-theme="dark"] .ftask-tab.is-active` | teks tab aktif (gelap) — di allowlist |
| `#4E5C00` | `app.css:4910` `.focus-filter-btn.is-on`, `app.css:4922` `.focus-filter-chip.is-on` | teks filter aktif (terang) |
| `#D9EE6A` | `app.css:3893` `.pomo-amb-opt.is-on`; `app.css:4865` `[dark] .ftask-star.is-on`; `app.css:4911` `[dark] .focus-filter-btn.is-on…`; `app.css:4923` `[dark] .focus-filter-chip.is-on` | teks/ikon aktif (gelap) — tiga aturan gelap di allowlist |
| `rgba(182,212,0,…)` (= `--accent-2` beralpha) | `app.css:435` `.chat-bubble.self` (0.14 latar, 0.35 garis); `index.html:28855` `background: 'rgba(182,212,0,0.08)'` | gelembung chat sendiri (terang); tidak ada `--accent-2-rgb` |
| `#6B8000` (`LIME_KEEP`) | `app.css:304` `.badge-q2 { … color: #6B8000; }` | teks badge Q2 — juga tampil di mode gelap (aturan gelap hanya menimpa latar) |
| `#5D6E00` (`LIME_KEEP`) | `app.css:4695` `.cmt-mention { color: #5d6e00; … }` | teks mention komentar (terang) |

Tambahan yang ditemukan di Task 5 (keluarga yang sama, tidak ada di daftar Task 4):

| Literal | Lokasi | Peran |
|---|---|---|
| `#4a7000` | `app.css:436` `[data-theme="dark"] .chat-bubble.self` | latar gelembung chat sendiri (gelap) — di allowlist |
| `#364d00`, `rgba(54,77,0,0.7)` | `app.css:435`, `463`, `476`, `477` (`.chat-bubble.self …`) | tinta di gelembung chat sendiri (terang) |
| `#1a1f00` | `app.css:4708` `.cmt-btn--primary`, `4730` `.cmt-badge.is-unread`, `4768`, `4780` (`.task-date-prompt`) | tinta di atas `--accent` (bukan `--accent-ink` putih) |
| `#1a2a00` | `app.css:1967` `.driver-popover-navigation-btns button`, `1973` `.tour-btn:hover`, `4796` `.tl-view-btn[aria-pressed="true"]`; `index.html:13926`, `18849` | tinta di atas `--accent` |
| `#1F2116` | `app.css:4912` `.focus-filter-badge`, `4959` `.focus-filter-sheet-go` | tinta di atas `--accent` |
| `#4d7c0f` | `index.html:148`, `150` (wikilink mode kertas) | teks/garis wikilink di kertas putih |

Tiga keluarga tinta gelap di atas aksen (`#1a1f00`, `#1a2a00`, `#1F2116`) kemungkinan perlu satu token
"tinta gelap di atas aksen" di PR B; `--accent-ink` (putih) tidak cocok untuk tempat-tempat ini.

## Catatan untuk PR B (dari migrasi `app.css` Task 5)

- **Token dipakai di luar peran namanya** (nilai persis, aman untuk Default; palet harus sadar):
  `--border-strong` = latar `[data-theme="dark"] .task-row:hover`; `--bg-page` = warna teks tooltip terbalik
  `[data-theme="dark"] .habit-heatmap-cell::after` / `.habit-mini-cell::after`; `--bg-hover` = warna garis
  `.milkdown-slash-menu`/`.milkdown-tooltip` gelap dan latar pembatas `.sidebar-rail-divider` gelap;
  `--bg-selected` = garis `.sidebar-rail-ctx` gelap dan `stroke` `.dash-ring-track` gelap.
- **Dua aturan terang masih `color: #0f172a` literal**: `.sidebar-link:hover` dan `.sidebar-rail-btn:hover`
  (aturan gelapnya kini `var(--text-primary)`, tetapi tidak bisa dihapus: `[data-theme="dark"] .sidebar-link` /
  `.sidebar-rail-btn` yang lebih belakang akan menang atas hover terang). Bisa langsung `var(--text-primary)`.
- **10 aturan `.dark …` mati** (`app.css` ≈2075–2233, tab bar mindmap/sketsa): kelas `.dark` tidak pernah dipasang
  `index.html`; tidak dijaga guard. Hapus atau pindahkan ke `[data-theme="dark"]`.
- **Garis hover `#525252` butuh token `--border-hover`**: `[data-theme="dark"] .task-row:hover`, `.ftask:hover`,
  `.ftask-sub-box`, `.focus-filter-btn:hover`, `.focus-filter-chip:hover` (di allowlist "netral tanpa token";
  `--outline-guide` `#555555` sengaja tidak dipakai — selisih 3 dan peran berbeda).
- Allowlist `tests/offline/theme_dark_allowlist.json` adalah ratchet (total 144, bukan "warna bermakna" 61):
  setiap aturan yang dimigrasi PR B wajib keluar dari daftar dan angkanya diturunkan.
