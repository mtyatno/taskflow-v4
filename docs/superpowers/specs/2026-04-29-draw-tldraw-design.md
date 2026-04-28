# Draw (tldraw) Feature Design

**Date:** 2026-04-29
**Status:** Approved

## Overview

Tambah fitur drawing/whiteboard ke Notes menggunakan tldraw, fully offline (PWA), dengan sync ke backend saat online. Sidebar "Notes" berganti nama "Notes & Draw". Setiap note punya satu drawing canvas di bawah konten teks, dengan opsi expand fullscreen.

## Architecture

### tldraw Mini App (`draw-app/`)

Mini React app terpisah yang di-build sekali (npm/Node di Windows lokal):
- Baca `noteId` dari URL param (`?noteId=123`)
- Gunakan `noteId` sebagai IndexedDB key tldraw (storage per-note, built-in tldraw persistence)
- `onMount`: kirim `postMessage({ type: "ready" })` ke parent window
- Parent reply dengan snapshot → tldraw load data
- `onChange`: debounce 1 detik → `postMessage({ type: "change", data: snapshot })`

Output build (`dist/`) di-copy ke `static/vendor/tldraw/`. FastAPI serve sebagai static files di `/static/vendor/tldraw/*`.

### Service Worker

Tambah pattern `/static/vendor/tldraw/` ke cache list agar semua file tldraw tersedia offline setelah pertama kali dimuat.

### Data Flow

```
[tldraw iframe] --postMessage(change)--> [Note component]
                                              |
                                         debounce 2s
                                              |
                                    online? --> PUT /api/drawings/{note_id}
                                    offline? --> skip (data aman di IndexedDB)

window.online event --> sync pending drawing ke backend
```

Load flow:
1. Note dibuka → fetch `GET /api/drawings/{note_id}`
2. Online & ada data → `postMessage({ type: "load", data })` ke iframe
3. Offline atau 404 → iframe pakai IndexedDB sendiri

## Notes UI Changes

### Sidebar
- Label "Notes" → "Notes & Draw"
- Icon tetap seperti sekarang

### Note View (panel detail)
Di bawah editor teks, tambah section Canvas:

```
[konten teks note]

─── Canvas ─────────────────────── [Expand ⤢]
┌──────────────────────────────────────────────┐
│  <iframe src="/static/vendor/tldraw/         │
│   index.html?noteId={id}" height="360px">    │
└──────────────────────────────────────────────┘
[status: "Tersimpan" | "Menyimpan..." | "Offline — tersimpan lokal"]
```

### Fullscreen Overlay
Tombol "Expand ⤢" buka overlay fullscreen (z-index tinggi, cover seluruh layar). iframe height 100vh. Tombol "✕ Tutup" pojok kanan atas untuk kembali ke normal view.

### Sync Status Indicator
Teks kecil di bawah canvas:
- "Tersimpan" — hijau, setelah PUT sukses
- "Menyimpan..." — abu, saat debounce/request in-flight
- "Offline — tersimpan lokal" — kuning, saat `!navigator.onLine`

## Data Model

### Tabel `drawings`

```sql
CREATE TABLE drawings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id INTEGER NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    data_json TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);
```

Drawing terhapus otomatis saat note dihapus (CASCADE). Tidak ada versioning untuk MVP.

### Endpoints

`data_json` adalah tldraw `TLStoreSnapshot` yang di-serialize ke JSON string via `JSON.stringify(editor.store.getSnapshot())`.

```
GET  /api/drawings/{note_id}
  → 200: { data_json: string, updated_at: string }
  → 404: drawing belum ada (note baru tanpa canvas)

PUT  /api/drawings/{note_id}
  Body: { data_json: string }
  → upsert (INSERT OR REPLACE)
  → 200: { updated_at: string }
```

Auth: endpoint menggunakan middleware yang sama dengan `/api/notes`. User hanya bisa akses drawing miliknya sendiri (validasi via note ownership).

## Sync Logic

### Load
1. Note view mount → fetch `GET /api/drawings/{note_id}` dan set `iframeReady = false`
2. iframe selesai mount → kirim `postMessage({ type: "ready" })` → parent set `iframeReady = true`
3. Kirim `{ type: "load", data: data_json }` ke iframe hanya setelah KEDUA kondisi terpenuhi: fetch selesai AND `iframeReady = true` (menghindari race condition)
4. Jika 404 atau offline → biarkan iframe pakai IndexedDB (tldraw built-in), tidak kirim load message

### Save
1. iframe `postMessage({ type: "change", data: snapshot })` → parent terima
2. Parent set sync status "Menyimpan..."
3. Debounce 2 detik
4. Jika online → `PUT /api/drawings/{note_id}` → set status "Tersimpan"
5. Jika offline → set status "Offline — tersimpan lokal", data tetap di IndexedDB
6. `window.addEventListener("online", ...)` → flush pending drawing ke backend

## Scope

- **draw-app/**: mini React app dengan tldraw (build sekali, output ke `static/vendor/tldraw/`)
- **static/index.html**: ubah sidebar label, tambah canvas section di Note view, tambah fullscreen overlay
- **backend (main.py / routes)**: tabel `drawings`, dua endpoint GET/PUT
- **static/sw.js**: tambah cache pattern untuk `/static/vendor/tldraw/`
- Tidak ada fitur collaboration, versioning, atau export untuk MVP
