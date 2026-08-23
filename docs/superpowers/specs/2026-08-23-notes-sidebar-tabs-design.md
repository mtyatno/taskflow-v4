# Design — Notes Sidebar: 3 Baris Operasi + Tabs

**Tanggal:** 2026-08-23
**Status:** Disetujui user
**Cakupan:** `static/index.html` (NotesPage), `static/app.css`, `tests/offline/notes_page_layout.test.js` (+ test baru), `static/sw.js`

## Konteks & Masalah

Panel kiri NotesPage (desktop) berisi: header, searchbar, filter strip (Published/Semua/tags/Shared), accordion pinned, lalu daftar note. Zona kontrol memakan hampir semua tinggi panel → daftar note hanya menampilkan ~1 kartu. UX buruk.

## Keputusan Desain (disetujui user)

1. Zona operasi = **3 baris**: (1) searchbox, (2) tags, (3) tabs — header (baru/close/sort) tetap baris pertama.
2. **Tags 1 baris**: 2 tag teratas + `🏷️ +N Tags ▾` popover (berisi semua tag + "⬜ Tanpa Tag"). Pill "Semua", "Published", "Shared" DIHAPUS dari baris tags.
3. **Tabs 1 baris**: segmented control equal-width `[All] [Pinned] [Pub] [Shared]` — menggantikan pill Published, pill Shared, dan accordion pinned (accordion dihapus total).
4. **Semantik tab**: All = semua; Pinned = note ter-pin; Pub = note ter-publish; Shared = note yang di-share ke list mana pun.
5. **Kombinasi filter**: `tab ∩ tags ∩ search`; sort tetap berlaku; "Catatan (N)" = jumlah subset aktif; empty state spesifik per tab.
6. **State**: `filterPublished`, `filterListId`, `pinnedExpanded` dihapus → `notesTab: "all" | "pinned" | "pub" | "shared"` (default `all`, tidak perlu persist).
7. **CSS**: semua zona kontrol `flex-shrink: 0`; `.notes-left-inner` dapat `min-height: 0` (scroll region benar); kelas baru `.notes-tabs`/`.notes-tab` gaya chip konsisten aplikasi.

## Edge cases

- 4 tab di panel sempit (280px): segmented equal-width → masing-masing ±70px, label pendek 11–12px — muat tanpa wrap.
- Tab aktif + tag + search kosong hasil → empty state tab yang benar.
- Mobile (panel full-width): baris sama, tidak ada perubahan khusus.
- Pinned tab render note sebagai **card standar** (klik = openTab); unpin tetap tersedia via alur existing (bukan accordion).
- Tag popover "⬜ Tanpa Tag" tetap di dalam popover.

## Testing

- Perbarui `tests/offline/notes_page_layout.test.js`: asersi struktur baru (4 tab `.notes-tabs`, label tab, pill lama hilang, accordion pinned hilang, `notesTab` state ada, `filterPublished`/`filterListId` hilang).
- Test logika kombinasi tab ∩ tags ∩ search (pola existing: regex/markup + logika terisolasi kalau diekstrak).
- Verifikasi penuh: `node --check` inline 5/5, JS suite penuh, `pytest tests/`, SW bump `taskflow-v305-notes-sidebar-tabs`, deploy + live curl + handover `.agents/*`.

## Device-test checklist (user)

1. Desktop: panel kiri = header + search + tags + tabs + list penuh yang scroll sendiri — daftar note menampilkan banyak kartu.
2. Tab All/Pinned/Pub/Shared menampilkan subset benar; kombinasi dengan tag & search berjalan; "Catatan (N)" ikut berubah.
3. Pinned tab: klik card membuka note; tidak ada accordion lama.
4. Mobile: baris & tab sama rapi, list tetap scroll.
5. Dark mode konsisten.
