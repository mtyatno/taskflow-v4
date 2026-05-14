# Inline Task Link — Design Spec

**Date:** 2026-05-14  
**Status:** Approved

---

## Overview

Fitur untuk me-link task langsung di dalam teks note secara inline. Source of truth adalah konten teks note itu sendiri — section "Di-link ke Task" hanya menampilkan derivasi dari parsing teks.

---

## Trigger

User bisa attach task via dua cara:

### 1. Ketik inline
Ketika user mengetik salah satu keyword berikut di dalam editor Milkdown, dropdown task picker muncul di posisi kursor:

```
[task   [Task   [tasks   [Tasks
[todo   [Todo   [todos   [Todos
[tugas  [Tugas
```

Deteksi menggunakan regex pada `textBeforeCursor`:
```
/\[(task|tasks|todo|todos|tugas)([a-zA-Z0-9 ]*)$/i
```

Tidak bentrok dengan:
- `[[wikilink]]` — regex wikilink butuh `[[` ganda
- `@mention` — karakter berbeda
- `#tag` — karakter berbeda  
- `[ ]` checkbox markdown — spasi di dalam, bukan keyword teks

### 2. Toolbar button "+ Task"
Button teks "+ Task" ditambahkan ke toolbar editor Milkdown, setelah button `[[…]]`. Ketika diklik:
1. Fokus kembali ke editor
2. Dropdown task picker muncul di posisi kursor saat ini
3. Identik dengan mengetik `[task` secara manual

---

## Dropdown Task Picker

- Muncul posisi absolut di koordinat kursor (pakai `getCursorCoords()` yang sudah ada)
- Input search untuk filter task by nama
- List task dengan PriBadge + nama (format yang sudah ada)
- Keyboard: ArrowUp/Down, Enter untuk pilih, Escape untuk tutup
- Exclude task yang sudah di-link di note yang sama

---

## Inline Badge — Tampilan

Setelah user memilih task, teks trigger diganti dengan custom ProseMirror node (`tasklink`):

```
[STATUS_LABEL] [PRIORITY] Task Name
```

| Elemen | Open | Done |
|--------|------|------|
| Label kiri | `OPEN` — biru `#3b82f6` | `DONE` — hijau `#16a34a` |
| Badge priority | P1–P4 (warna existing) | P1–P4 (warna existing) |
| Background badge | Kuning `#fef9c3` | Kuning `#fef9c3` (sama) |
| Border | `#fde68a` | `#fde68a` (sama) |
| Teks nama | Normal | Normal (tidak strikethrough — printout friendly) |

Status (OPEN/DONE) diambil live dari data tasks saat note dibuka.

### Click behavior
Klik inline badge → buka task detail modal (`onTaskClick(task)`), identik dengan klik task di list utama.

---

## Serialisasi Markdown

Node `tasklink` disimpan dalam konten note sebagai:

```
[tasklink:TASK_ID]
```

Contoh: `[tasklink:42]`

- Menggunakan task ID (bukan nama) agar robust jika task di-rename
- Nama task diambil saat render dari state `tasks` yang sudah di-pass ke NoteModal
- Jika task tidak ditemukan (dihapus): tampilkan badge abu-abu `[? task tidak ditemukan]`

Parser remark (plugin Milkdown) mendeteksi pola `/\[tasklink:(\d+)\]/` dan mengkonversinya ke node `tasklink`.

---

## Section "Di-link ke Task" — Perubahan

Section ini menjadi **read-only**, derived dari parsing konten note:

- **Dihapus**: button "+ Tambah Link Task" dan seluruh UI task search di section
- **Tetap**: daftar task yang terkait (dengan badge priority + nama + button "Buka")
- **Source**: diekstrak dari `content` note dengan regex `[tasklink:(\d+)]` lalu di-lookup dari `tasks`

Tidak ada lagi divergensi antara teks dan section — selalu sinkron karena bersumber dari satu tempat.

### Alur sync
```
User ketik [task → pilih task
    ↓
Node tasklink:ID masuk ke teks
    ↓
handleEditorChange() parse content → extract task IDs
    ↓
setLinkedTaskIds(extractedIds)
    ↓
Section "Di-link ke Task" re-render otomatis
```

Hapus badge dari teks → `setLinkedTaskIds` update → task keluar dari section.

---

## Perubahan File

| File | Perubahan |
|------|-----------|
| `static/index.html` | Tambah `tasklink` node + remark plugin di `createWikilinkPlugin` atau plugin baru; tambah task trigger detection di `handleEditorChange`; tambah `insertTasklink()`; tambah toolbar button "+ Task"; ubah section menjadi read-only |

Semua perubahan dalam satu file, mengikuti pola implementasi wikilink yang sudah ada.

---

## Scope Task berdasarkan State Note

### Task yang tersedia di dropdown picker

| State note | Task yang muncul di dropdown |
|---|---|
| Private / belum di-share | Semua task dari semua list yang user punya akses |
| Shared ke 1 list | Hanya task dari list tersebut |
| Shared ke beberapa list | Task dari semua list yang note itu di-share |

Logika di frontend: dropdown task picker memfilter `tasks` prop berdasarkan `sharedLists` yang sudah di-pass ke `NoteModal`. Jika `sharedLists` kosong → tampilkan semua tasks.

### Badge task milik list lain (privacy guard)

Jika note di-share dan member lain melihat note tersebut, task yang berasal dari list yang tidak bisa diakses member tersebut ditampilkan sebagai:

```
[OPEN] [?] task tidak tersedia
```

Badge tetap kuning, label biru OPEN, priority badge abu-abu `?`, nama task disembunyikan. Klik tidak membuka modal apapun.

Implementasi: saat render badge, cek apakah task ID ada di dalam `tasks` prop yang diterima user tersebut. Jika tidak ada → render fallback badge.

---

## Backward Compatibility

Note lama yang sudah punya `linked_task_ids` di database (di-link via sistem lama) tetap terbaca:

- Saat note dibuka: `linkedTaskIds` diinisialisasi dari `note.linked_task_ids` (DB) **union** task IDs yang diparsing dari `content`
- Saat note disimpan: backend menerima `linked_task_ids` berisi IDs yang diparsing dari konten saat itu
- Efek: note lama yang dibuka + disimpan ulang akan migrasi otomatis — jika task lama tidak ada di teks, mereka hilang dari section setelah save pertama
- Note lama yang tidak pernah dibuka/disimpan: section tetap menampilkan task dari DB (no regression)

---

## Out of Scope

- Export markdown dengan task link sebagai plain text (future)
- Task link di luar NoteModal (e.g. di list view note card)
- Mention task di note yang berbeda dari list berbeda
