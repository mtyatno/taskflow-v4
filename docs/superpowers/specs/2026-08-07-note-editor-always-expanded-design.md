# Note Editor — Always Expanded (Default Fullscreen)

**Date:** 2026-08-07
**Status:** Design

## Goal

Hilangkan mode "Compact" (modal di tengah layar) dari kedua editor note. Editor selalu terbuka dalam posisi fullscreen. Dua mode tersisa: **Expand** (default, fullscreen lengkap) dan **Focus** (fullscreen minimal). User toggle di antara keduanya.

```
Sebelum:  Compact ──→ Expand ──→ Focus
           (modal)    (full)     (minimal)

Sesudah:  Expand (default) ⇄ Focus
           (full)            (minimal)
```

## Current State

Ada 4 state fullscreen/expand terpisah, dengan 2 editor:

### NoteModal (view/edit existing note)

| State | Variable | Default | Behavior |
|-------|----------|---------|----------|
| Compact | *(default)* | — | Modal `position:fixed` di tengah layar, semua konten |
| Focus | `textareaFullscreen` | `false` | Fullscreen editor saja + toolbar + "Tutup" |
| Expand | `expanded` | `false` | Fullscreen lengkap: header + title + toolbar + editor + TOC + drawing + tasks + files + save |

Masalah: perlu 2 kali klik untuk sampai ke Expand (Compact → Expand), dan tombol "Expand" / "Compact" + "Focus" terlalu banyak.

### NotePanel (create new note dari dashboard tab)

| State | Variable | Default | Behavior |
|-------|----------|---------|----------|
| Inline | *(default)* | — | Editor di dalam panel tab, minHeight 140px |
| Focus | `noteTextareaFullscreen` | `false` | Fullscreen editor + toolbar + "Tutup", tanpa judul/tags/drawing/save |
| Drawing FS | `noteDrawFullscreen` | `false` | Fullscreen canvas tldraw |

Masalah: editor terlalu kecil di dalam panel (140px), user harus klik "Focus" dulu untuk menulis dengan nyaman.

## Target State

### NoteModal

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Expand** (default) | Buka note | Fullscreen lengkap — header, title, toolbar, editor, TOC, drawing, linked tasks, attachments, backlinks, save/close |
| **Focus** | Klik "Focus" | Fullscreen minimal — header, title, toolbar, editor only |

Toggle: "● Focus" ⇄ "⤢ Expand" di header. Tidak ada modal compact.

### NotePanel

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Expand** (default) | Klik tab Note | Fullscreen lengkap — title, toolbar, editor, tags, canvas, Batal/Simpan |
| **Focus** | Klik "Focus" | Fullscreen minimal — title, toolbar, editor only |

Toggle: "● Focus" ⇄ "⤢ Expand" di header. Tab Note langsung fullscreen, tidak ada inline panel.

## State Variables Changes

### Remove
- `expanded` (NoteModal line ~15250) — expanded jadi default, tidak perlu state
- `textareaFullscreen` (NoteModal line ~15460) — ganti nama jadi `focusMode` dengan semantik baru
- `noteTextareaFullscreen` (NotePanel line ~2821) — ganti nama jadi `noteFocusMode`

### Add / Rename
- `focusMode` di NoteModal: `false` = Expand (default), `true` = Focus
- `noteFocusMode` di NotePanel: `false` = Expand (default), `true` = Focus

## Rendering Changes

### NoteModal

1. **Hapus branch `if (expanded)` / Compact** — selalu render fullscreen panel (yang sekarang jadi `if (expanded)` branch, line ~17013)
2. **Hapus modal overlay + box** — branch compact (line ~17036) dihapus seluruhnya
3. **Header tombol** — "Expand"/"Compact" dihapus; "Focus" tetap ada, label berubah jadi "Expand" saat di mode Focus
4. **`inner` konten** — conditional rendering berdasarkan `focusMode`:
   - `focusMode=false` (Expand): semua konten (TOC, drawing, tasks, files, backlinks, dll.) — sama seperti sekarang
   - `focusMode=true` (Focus): hanya editor + toolbar
5. **`autoFocus`, `fontSize`, `minHeight`** — semua referensi ke `expanded` diganti ke `!focusMode` (karena Expand sekarang default)

### NotePanel

1. **Hapus render inline panel** — saat `mode === "note"`, langsung render fullscreen (bukan di dalam panel)
2. **Fullscreen container** — pakai `position: fixed; inset: 0; zIndex: 1000` seperti NoteModal Expand
3. **Header** — tambahkan header dengan: label "📝 Catatan Baru", tombol Focus/Expand, tombol "✕" untuk kembali ke dashboard
4. **Focus mode** — `noteFocusMode=true` → sembunyikan tags, canvas, save buttons, hanya tampilkan title + toolbar + editor
5. **Drawing fullscreen** (`noteDrawFullscreen`) — tetap independen, tidak berubah

## Unchanged

- Semua logic autosave, voice dictation, slash commands, wikilink, tasklink
- MilkdownEditor component
- NoteToolbar component
- NoteToc component
- Attachment viewer
- Drawing/canvas (tldraw) — `noteDrawFullscreen` dan `drawFullscreen` tetap independen
- Backlink fetching & display
- Conflict detection & banner

## CSS Impact

Minimal. Style fullscreen sudah ada — hanya perlu memastikan:
- Safe area insets tetap dipakai (`env(safe-area-inset-*)`)
- Background `var(--bg-card)` untuk Expand, `#ffffff` untuk Focus (seperti sekarang)
- Z-index: Expand 1000, Focus 10000 (seperti sekarang)
- Scroll behavior di inner container tetap `overflow-y: auto`

## Edge Cases

1. **NotePanel tanpa note.id** — NotePanel untuk create new note, jadi tidak ada backlinks, tidak ada attachments, tidak ada conflict banner. Expand mode tetap fullscreen dengan konten yang relevan.
2. **Mobile** — safe-area insets, FAB tidak overlap (fullscreen menutupi semuanya)
3. **Focus → ketik `[[`** — wikilink autocomplete tetap muncul di atas fullscreen editor (z-index sudah diatur)
4. **Navigasi wikilink di mode Focus** — klik wikilink → tutup Focus dulu, lalu navigasi (seperti perilaku sekarang di line ~17090)
5. **Shortcut keyboard** — Escape di mode Focus → kembali ke Expand (bukan tutup editor)

## Scope

Perubahan terlokalisasi di **satu file**: `static/index.html`. Dua area utama: `NoteModal` (~line 15207-17143) dan `NotePanel` (~line 3635-4060 + line 2821).

Tidak menyentuh: backend, service worker, CSS file, atau komponen lainnya.
