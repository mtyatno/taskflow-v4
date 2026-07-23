# Note Tab Viewer — Design Spec

**Date:** 2026-07-23
**Status:** Approved
**Scope:** Desktop-only, Notes & Draw page — note viewer (panel kanan)

## Overview

Menambahkan tab bar di bagian atas note viewer (`.notes-right`) sehingga user bisa membuka hingga 5 note secara bersamaan dalam bentuk tab, seperti browser tabs. Note viewer saat ini hanya bisa menampilkan 1 note — fitur ini menambah multi-note viewing tanpa mengubah NotePanel, navTrail, atau flow edit/autosave yang sudah ada.

## Architecture

```
notes-right (60% lebar layout)
├── TAB BAR (baru) — posisi paling atas, horizontal scroll jika overflow
│   └── [Note A ×] [Note B ×] [Note C ×] ...  (max 5)
└── NotePanel (existing, tidak diubah)
    └── navTrail + konten note + backlinks + attachments + dsb.
```

Semua perubahan terlokalisasi di dalam komponen Notes page (`static/index.html`, dalam fungsi `NotesAndDrawPage`). Tidak ada perubahan di `NotePanel`, modal edit, autosave, atau backend.

## State

| State | Tipe | Default | Keterangan |
|---|---|---|---|
| `openTabs` | `array<note>` | `[]` | Note yang sedang terbuka di tab, max 5 |
| `activeTabId` | `string\|null` | `null` | ID note tab yang sedang aktif |

State tidak di-persist — berpindah page mereset ke default.

`navTrail` tidak diubah — tetap bekerja per-konteks tab aktif (mengikuti `activeTabId`).

## Behavior

### Membuka note (dari note list atau wikilink)
1. Cek apakah note sudah ada di `openTabs` (berdasarkan `id`)
2. Jika **sudah ada** → switch `activeTabId` ke note tersebut
3. Jika **belum ada** dan `openTabs.length < 5` → push ke array, set `activeTabId`
4. Jika **belum ada** dan `openTabs.length === 5` → evict tab pertama (paling lama), push note baru, set `activeTabId`

### Menutup tab (klik ×)
1. Hapus note dari `openTabs`
2. Jika tab yang ditutup adalah tab aktif:
   - Switch ke tab di sebelah kanannya (jika ada)
   - Jika tidak ada di kanan, switch ke tab di sebelah kiri (jika ada)
   - Jika tidak ada tab tersisa → `activeTabId = null` (kembali ke empty state)

### Navigasi wikilink (onNavigate)
- Panggil rules yang sama dengan membuka note dari list (switch jika sudah ada, push jika belum, evict jika penuh)

### Delete note
- Hapus note dari `openTabs` + jalankan handleDelete existing
- Switch tab seperti rules tutup tab

### Edit note
- Tidak berubah — tetap via modal `openEdit`, autosave 2.5s debounced
- Setelah save, `noteSaved` event → refresh `allNotes` → useEffect sync tab content

### Berpindah page
- `openTabs = []`, `activeTabId = null` — reset bersih

### Mobile
- Tidak ada perubahan. Layout mobile (`max-width: 767px`) menggunakan `.note-open` yang menampilkan viewer full-width tanpa tab bar. Tab bar hanya render di desktop (`@media min-width: 768px` atau inline conditional).

## Tab Bar UI

- **Posisi**: di dalam `.notes-right`, di atas `NotePanel`, sebelum konten note
- **Tinggi bar**: ~34px
- **Overflow**: `overflow-x: auto`, `scrollbar-width: none` (horizontal scroll senyap)
- **Tab item**:
  - Judul note, truncated maksimal ~18 karakter + ellipsis
  - Tombol × (close) di kanan judul
  - Lebar tab: fleksibel, `max-width: 180px`, `min-width: 80px`
- **Tab aktif**: background `var(--accent)` (#B6D400), text white
- **Tab inactive**: background `var(--bg-card)`, border `var(--border)`, text `var(--text-secondary)`
- **Hover inactive**: background sedikit lebih gelap
- **Empty state** (belum ada tab terbuka): tab bar tidak dirender

## CSS

Semua CSS tab ditulis di blok `<style>` index.html, di bawah section "Notes — tab bar" (baru). Class prefix: `.note-tab-*` untuk menghindari konflik dengan `.note-tab` yang sudah ada (di note editor modal).

## Edge Cases

| Edge Case | Handling |
|---|---|
| User buka note yang sama 2x | Switch ke tab existing (tidak duplikat) |
| Tab sudah 5, buka note baru | Evict tab index 0 (paling lama) |
| Tab aktif di-delete dari tempat lain | Sync via `allNotes` useEffect — jika note hilang, hapus dari openTabs |
| Judul note sangat panjang | Truncate + ellipsis, max-width 180px |
| Judul note kosong | Tampilkan "(tanpa judul)" |
| Scroll tab horizontal | `overflow-x: auto` + `scrollbar-width: none` |
| Klik kanan tab | Tidak ada context menu khusus (native browser) |
| Note viewer di-close total (klik ×) | Kembali ke empty state "Pilih catatan untuk membaca" |

## Non-Goals (Out of Scope)

- Drag & drop reorder tab
- Persist tab state antar page navigation
- Fitur tab di mobile
- "Simpan session" / restore tab
- Duplicate tab
- Pin tab
- Indikator "unsaved" di tab (autosave handles this)
