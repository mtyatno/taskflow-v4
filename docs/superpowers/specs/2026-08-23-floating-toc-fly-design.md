# Design — Floating ToC ala Medium (NotePanel)

**Tanggal:** 2026-08-23
**Status:** Disetujui user
**Cakupan:** `static/index.html` (NotePanel), `static/app.css`, `tests/offline/note_toc.test.js`, `static/sw.js`

## Konteks & Masalah

ToC yang ada (spec `2026-08-23-floating-toc-design.md`, commit `b2ba698` + fix `38cd66f`) merender tombol `📑 Isi (N)` **inline di dalam alur artikel** (setelah panel Lampiran). Ini memakan satu baris vertikal di artikel, dan popover-nya melekat pada posisi inline tersebut.

User ingin gaya Medium: tombol **melayang** (floating) di tepi layar sehingga area artikel jadi lebar/lega, plus navigasi cepat antar-section tanpa scrolling.

## Keputusan Desain (disetujui user)

1. **Posisi desktop (≥769px):** tombol lingkaran kecil **fixed di tepi kanan layar, vertikal tengah** (`right: 16px; top: 50%`).
2. **Gaya tombol:** lingkaran ikon 📑 saja (40px), tanpa label. Tooltip `title="Daftar Isi"`. Hover → accent.
3. **Scroll-spy:** ya — section yang sedang dibaca ter-highlight di popover (IntersectionObserver).
4. **Mobile (<769px):** 2 FAB bertumpuk — ToC FAB kecil (44px, netral `bg-card` + border) **di atas** FAB Buat Baru existing (52px accent, `bottom: 28px+safe-area`), gap 12px → ToC FAB `bottom: calc(92px + env(safe-area-inset-bottom, 0px)); right: 16px`. Accent tetap eksklusif milik FAB Buat Baru.
5. **Pendekatan implementasi:** A — reposisi CSS di tempat + observer inline di NotePanel. **Bukan** portal, **bukan** modul UMD terpisah (YAGNI).

## Desain

### 1. Komponen (semua di NotePanel, `static/index.html`)

- DOM trigger ToC **tetap di lokasi sekarang** (setelah panel Lampiran) — hanya CSS yang mengubahnya keluar dari alur (out of flow) sehingga artikel jadi full-width.
- **State baru:** `tocActiveIdx` (number|null) — section aktif untuk highlight.
- **Ref baru:** `tocSpyRef` — dipasang di div `.note-rendered` milik panel ini; scope observer agar heading di kartu preview sidebar (id `note-h-*` bisa bentrok karena counter `_markedHIdx` global) tidak ikut diamati.
- **Item popover:** dapat class `active` saat `item.idx === tocActiveIdx`.
- **Wrapper trigger:** inline style saat ini `{ position: "relative", display: "inline-block" }` diganti ke class CSS `floating-toc-anchor` (posisi fixed via CSS, berbeda per breakpoint).

### 2. CSS

Ganti kedua blok `.floating-toc-trigger`/`.floating-toc-popover` yang ada **di app.css** (blok di dalam media scope ~1018 + blok umum ~1879 — duplikat mati; konsolidasi ke satu sumber kebenaran). CSS ToC tidak ada di index.html (hanya className JSX di baris 20418/20422).

```
Desktop (≥769px):
  .floating-toc-anchor  { position: fixed; right: 16px; top: 50%; transform: translateY(-50%); z-index: 60; }
  .floating-toc-trigger { lingkaran 40px; bg-card; border var(--border); shadow lembut;
                          hover → border+teks accent; .active → tint accent 12% }
  .floating-toc-popover { absolute; right: calc(100% + 8px); top: 50%; transform: translateY(-50%);
                          width 250px; max-height 60vh; overflow-y auto; radius 12; shadow; }
Mobile (<769px):
  .floating-toc-anchor  { bottom: calc(92px + env(safe-area-inset-bottom,0px)); right: 16px; top: auto;
                          transform: none; }
  .floating-toc-trigger { 44px }
  .floating-toc-popover { right: 0; bottom: calc(100% + 8px); top: auto; transform: none; }
```

- **Highlight item aktif:** perpanjang rule existing `.note-toc-item.active` (app.css ~1016, sudah ada `color accent` + bold dari ToC statis lama) dengan tambahan background tint `rgba(168,197,0,0.12)` — item tetap memakai class `note-toc-item`.

- Popover desktop membuka **ke kiri** dari tombol (tepi kanan layar → tak pernah keluar layar); mobile membuka **ke atas** (di bawahnya ada FAB Buat Baru).
- `z-index` tombol & popover: 60 — di atas konten & sidebar (40), di bawah modal (1000) dan toast (100).
- Semua warna pakai var CSS (`--bg-card`, `--border`, `--accent`) → otomatis ikut dark mode.

### 3. Scroll-spy (data flow)

1. Effect di NotePanel, aktif saat `tocItems.length >= 2`:
   - `IntersectionObserver` (root viewport — window yang scroll; `.notes-panel` tidak punya overflow) mengamati `tocSpyRef.current.querySelectorAll('[id^="note-h-"]')`.
   - Callback: dari entry `isIntersecting`, ambil yang `boundingClientRect.top` terkecil → parse index dari `id` (`note-h-N`) → `setTocActiveIdx(N)`.
   - Cleanup: observer.disconnect() saat note berganti/unmount.
2. Klik item (handler existing di 20451): `scrollIntoView({ behavior: "smooth" })` + `setTocOpen(false)` + **`setTocActiveIdx(item.idx)`** (feedback instan tanpa menunggu observer).
3. `tocItems.length < 2` → trigger tidak render (kondisi existing) dan observer tidak dibuat.

### 4. Edge cases

- **Heading bentrok id:** kartu preview sidebar juga render `note-h-*` (counter global) — diatasi dengan scope query dalam `tocSpyRef`.
- **`IntersectionObserver` tak tersedia:** guard `typeof IntersectionObserver !== "undefined"` → tanpa scroll-spy, fitur lompat tetap jalan.
- **Note tanpa heading:** tidak ada tombol (existing).
- **Modal terbuka di atas:** z-index ToC (60) < modal (1000) — ToC tidak menutupi modal.
- **Safe-area:** mobile pakai `env(safe-area-inset-bottom)` (konsisten dengan `.fab` existing).
- **Aksesibilitas:** tombol tetap `<button type="button">` dengan `title`; klik-outside menutup popover (existing `pointerdown` handler di `tocRef` tetap dipertahankan).

## Testing

Perluas `tests/offline/note_toc.test.js` (pola existing: asersi string/pattern pada index.html & app.css + logika terisolasi):

1. Rule CSS `.floating-toc-anchor` fixed right/top 50% di desktop + FAB bottom 92px di mobile.
2. Tombol lingkaran 40px/44px tanpa label teks `Isi (`.
3. Popover anchoring: `right: calc(100% + 8px)` desktop, `bottom: calc(100% + 8px)` mobile.
4. State `tocActiveIdx` + class `active` pada item.
5. Wiring observer: `tocSpyRef`, `querySelectorAll('[id^="note-h-"]')`, guard `typeof IntersectionObserver`.
6. Artikel full-width: trigger tidak lagi di dalam alur (class anchor, bukan inline-block di flow).
7. Update test lama yang mengecek bentuk lama (pill `📑 Isi (N)` inline) — diubah sesuai desain baru.

## Verifikasi & Deploy

- `node --check` 5/5 inline script parse clean.
- JS suite penuh (`node --test "tests/offline/*.test.js"`) hijau.
- `python -m pytest tests/` 43/43 hijau.
- SW bump `taskflow-v300-floating-toc-fab` (wajib — SW cache-first).
- Deploy via push → Actions; verifikasi live curl (SW version + marker CSS `.floating-toc-anchor`).
- Device-test user: (1) desktop buka note ≥2 heading → lingkaran 📑 di tengah kanan, artikel full-width; (2) klik → popover ke kiri, scroll → item aktif ter-highlight; (3) klik item → lompat mulus ke section; (4) mobile → FAB kecil di atas FAB Buat Baru, popover ke atas; (5) dark mode tampil konsisten.
