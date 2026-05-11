# Milkdown Wikilink Hotfix Plan (Production)

**Date:** 2026-05-11  
**Status:** In Progress

## Goal

Memperbaiki bug production di editor Milkdown: wikilink `[[...]]` tidak berfungsi karena error context saat inisialisasi plugin.

## Bug Evidence

- Browser console menunjukkan error berulang:
  - `MilkdownError: Context "" not found, do you forget to inject it?`
  - Stack mengarah ke `wikilinkInputRule` di `static/index.html`.

## Root Cause (Working Hypothesis)

- Implementasi `MB.$inputRule(...)` untuk custom wikilink memerlukan context yang tidak tersedia/ tidak ter-inject dengan konfigurasi bundling + plugin chain saat ini.
- Akibatnya inisialisasi plugin wikilink gagal dan fitur `[[...]]` jadi tidak berjalan normal.

## Step-by-step Workplan

### Step 1 — Stabilize editor boot

1. Ubah `createWikilinkPlugin` agar **tidak** memakai `MB.$inputRule(...)` untuk sementara.
2. Pertahankan `wikilinkNode` + `remarkWikilinkPlugin` agar parser markdown `[[...]]` tetap kompatibel.

### Step 2 — Add safe runtime conversion fallback

1. Tambahkan fallback converter di `NoteModal` untuk menangani input manual `[[Title]]`.
2. Converter berjalan saat edit berubah, lalu:
   - mendeteksi pola `[[...]]` tepat sebelum cursor,
   - mengganti teks dengan node `wikilink` via transaction,
   - tetap menjaga fokus editor.

### Step 3 — Prevent regressions

1. Pastikan dropdown wikilink existing (`[[query`) tetap muncul.
2. Pastikan pilih item dropdown tetap menyisipkan node wikilink.
3. Pastikan save/reopen note tetap serialisasi ke markdown `[[...]]`.

### Step 4 — Quality control checklist

1. Reproduce scenario dari bug report awal.
2. Test manual typing:
   - ketik `[[Catatan A]]` lalu lanjut ketik teks.
3. Test autocomplete:
   - ketik `[[Cat` -> pilih suggestion.
4. Test persistensi:
   - save -> tutup modal -> buka lagi note yang sama.
5. Pastikan tidak ada error `MilkdownError: Context` di console.

### Step 5 — Rollout notes

1. Karena app memakai service worker, bump cache version hanya jika ada perubahan file static tambahan.
2. Lakukan hard refresh di browser klien untuk memastikan script terbaru termuat.

## Scope

- `static/index.html` (hotfix code)
- Dokumen ini (runbook hotfix)

## Out of Scope

- Refactor total plugin wikilink ke arsitektur Milkdown extension yang lebih advanced.
- Perubahan backend API.
