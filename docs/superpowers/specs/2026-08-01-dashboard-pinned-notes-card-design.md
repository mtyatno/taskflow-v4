# Dashboard Pinned Notes Card — Design Spec

**Date:** 2026-08-01
**Status:** Final

## Overview

Tambahkan card baru "📌 Notes Disematkan" di dashboard, menampilkan notes yang di-pin user dari halaman Notes & Draw. Card ini diletakkan di atas card "Prioritas Hari Ini".

## Position

Urutan card di dashboard (top to bottom):

1. ⚡ Quick Capture (scratchpad bar) — tidak berubah
2. KPI stat cards — tidak berubah
3. **📌 Notes Disematkan** ← card baru
4. 🔴 Prioritas Hari Ini — tidak berubah
5. 📝 Notes Terbaru — **tidak berubah** (tetap ada)
6. Analytics, Eisenhower, GTD Status, Project — tidak berubah

## Visual Design

### Card dengan pinned notes

```
┌─────────────────────────────────────────────────────┐
│ 📌 Notes Disematkan              Lihat semua →      │
│                                                     │
│  📌  Rencana Q3 2026                    28 Jul      │
│  ───────────────────────────────────────────────    │
│  📌  Referensi API design               25 Jul      │
│  ───────────────────────────────────────────────    │
│  📌  Meeting notes mingguan             20 Jul      │
│                                                     │
│         +2 lainnya ▼                                │
└─────────────────────────────────────────────────────┘
```

- Style card: sama seperti "Prioritas Hari Ini" — `className="card"`, padding `18px 22px`, `marginBottom: 28px`
- Header: kiri "📌 Notes Disematkan" (fontSize 15, fontWeight 700), kanan "Lihat semua →" link
- Row per note: ikon pin + judul (kiri, fontSize 13, overflow ellipsis), tanggal badge (kanan, fontSize 11)
- Separator antar row: `borderBottom: "1px solid var(--border)"`
- Max tampil 3 note, sisanya collapse "+N lainnya ▼"

### Empty state

```
┌─────────────────────────────────────────────────────┐
│ 📌 Notes Disematkan                                 │
│                                                     │
│     Belum ada note yang disematkan.                 │
│     Pin note dari halaman Notes & Draw →            │
│                                                     │
└─────────────────────────────────────────────────────┘
```

- Pesan di tengah, teks abu-abu (`var(--text-secondary)`), link "Notes & Draw →" navigasi ke halaman notes

## Behavior

| Trigger | Action |
|---|---|
| Klik row note | Panggil `onNoteClick(n)` — buka tab note di halaman Notes |
| Klik "Lihat semua →" | Navigasi ke halaman Notes (`onNav("notes")`) |
| Klik "+N lainnya ▼" | Expand semua pinned notes |
| Klik "Notes & Draw →" (empty state) | Navigasi ke halaman Notes |
| Klik ikon pin / judul di row | Sama seperti klik row — buka note |

## Data Source

- **API:** Endpoint baru `GET /api/scratchpad/pinned` — return notes user yang ada di `note_pins`, di-enrich dengan `_scratchpad_row()`
- **State di Dashboard:** `pinnedNotes` (useState + useEffect fetch)
- **Refresh:** Fetch ulang saat event `noteSaved` (seperti `recentNotes` yang ada)

### API Spec

```
GET /api/scratchpad/pinned
Auth: required
Response: Note[]  (sama seperti /api/scratchpad, sudah include field pinned: true)
```

SQL:
```sql
SELECT s.* FROM scratchpad_notes s
JOIN note_pins np ON np.note_id = s.id AND np.user_id = ?
WHERE {access_clause}
ORDER BY s.updated_at DESC
```

### Fallback

- Kalau API gagal → card tidak muncul (catch silently, seperti behavior `recentNotes` saat ini)
- Kalau user tidak punya note pinned → empty state
- Kalau semua note di-unpin → card langsung update ke empty state (refetch on `noteSaved`)

## Implementation Scope

### Files yang disentuh

| File | Change |
|---|---|
| `webapp.py` | Tambah endpoint `GET /api/scratchpad/pinned` |
| `static/index.html` | Tambah card baru di Dashboard component, di atas "Prioritas Hari Ini" |

### Yang TIDAK berubah

- Card "📝 Notes Terbaru" — tetap ada, tidak disentuh
- Sidebar Notes "Disematkan" section — tetap ada, tidak disentuh
- API `PATCH /api/scratchpad/{id}/pin` — tetap, tidak berubah
- CSS `.note-card`, `.pinned-note-*` — tetap, tidak berubah
