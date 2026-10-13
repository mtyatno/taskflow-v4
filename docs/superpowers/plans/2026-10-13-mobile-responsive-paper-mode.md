# Rencana Kerja: Adaptasi Responsif Layar Kecil (Mobile) untuk Mode Kertas di Note Viewer & Note Editor

**Tanggal Dibuat:** 2026-10-13  
**Penulis/Agent:** Antigravity (Gemini)  
**Status:** ✅ DIEKSEKUSI 2026-10-13 (Claude, draft PR)  
**Terkait:** Note Viewer (`NotePanel`), Note Editor (`NoteModal`), Paper Mode CSS  

---

## 1. Konteks & Masalah
- **Masalah Saat Ini di Layar Kecil (Mobile):**
  - Tampilan lembaran kertas (Paper Mode) saat ini memaksakan lebar fisik kertas A4 (`var(--paper-width, 210mm)` ~ 794px) dan padding margin `20mm` (~75px) di sisi kiri dan kanan.
  - Pada layar ponsel pintar (viewport 360px - 420px), lembaran ini menyebabkan *overflow* horizontal yang parah. Pengguna harus menggeser-geser layar (*horizontal scroll / pan*) ke kiri dan kanan hanya untuk membaca atau menulis kalimat.
  - Selain itu, pembatas halaman putus-putus (`.paper-page-guides`) dan dropdown ukuran kertas (A4, Letter) memakan ruang visual pada layar HP kecil.
- **Tujuan Desain:**
  - **Layar Lebar & Besar (Desktop / Laptop / Tablet >= 769px):** Mempertahankan sensasi membaca dan menulis di lembaran kertas A4/Letter/A3 fisik yang sangat memuaskan, lengkap dengan bayangan elevasi (*box-shadow*), alas meja kerja (*desk canvas*), dan pembatas halaman (*page guides*).
  - **Layar Kecil (Mobile <= 768px):** Tampilan **BUKAN tampilan kertas**. Catatan secara otomatis mengalir *fluid* 100% mengisi layar ponsel (*full-width responsive*), tanpa *horizontal scroll*, tanpa *box-shadow*, tanpa *fixed-width*, dan kembali ke tema warna alami aplikasi (gelap saat tema gelap, terang saat tema terang).

---

## 2. Rincian Teknis Implementasi

### A. Override CSS Responsif (`static/index.html` dan/atau `static/app.css`)
Tambahkan blok `@media (max-width: 768px)` untuk mengatur `.paper-mode-active` dan turunannya:
```css
@media (max-width: 768px) {
  /* 1. Reset meja kerja kertas menjadi fluid transparan */
  .paper-mode-active {
    background-color: transparent !important;
    padding: 0 !important;
    overflow: visible !important;
  }
  .paper-inner-wrap {
    width: 100% !important;
    margin: 0 !important;
  }

  /* 2. Reset lembaran kertas di editor dan viewer ke tampilan natural mobile */
  .paper-mode-active .paper-inner-wrap .milkdown-editor,
  .paper-mode-active .paper-inner-wrap .note-rendered {
    background-color: transparent !important;
    box-shadow: none !important;
    width: 100% !important;
    max-width: 100% !important;
    min-height: auto !important;
    padding: 0 !important;
    transition: none !important;
    color: var(--text-primary) !important;
  }

  /* 3. Kembalikan tipografi ke palet tema aktif ponsel */
  .paper-mode-active .paper-inner-wrap .milkdown-editor,
  .paper-mode-active .paper-inner-wrap .milkdown-editor .ProseMirror,
  .paper-mode-active .paper-inner-wrap .note-rendered {
    color: var(--text-primary) !important;
  }
  .paper-mode-active .paper-inner-wrap .milkdown-editor .ProseMirror blockquote,
  .paper-mode-active .paper-inner-wrap .note-rendered blockquote {
    color: var(--text-secondary) !important;
    border-left-color: var(--accent) !important;
  }
  .paper-mode-active .paper-inner-wrap .milkdown-editor .ProseMirror pre,
  .paper-mode-active .paper-inner-wrap .milkdown-editor .ProseMirror code,
  .paper-mode-active .paper-inner-wrap .note-rendered pre,
  .paper-mode-active .paper-inner-wrap .note-rendered code {
    background: var(--bg-primary) !important;
    color: var(--text-primary) !important;
  }
  .paper-mode-active .paper-inner-wrap .milkdown-editor .ProseMirror th,
  .paper-mode-active .paper-inner-wrap .milkdown-editor .ProseMirror td,
  .paper-mode-active .paper-inner-wrap .note-rendered th,
  .paper-mode-active .paper-inner-wrap .note-rendered td {
    border-color: var(--border) !important;
    color: var(--text-primary) !important;
  }
  .paper-mode-active .paper-inner-wrap .milkdown-editor .ProseMirror th,
  .paper-mode-active .paper-inner-wrap .note-rendered th {
    background: var(--bg-primary) !important;
  }

  /* 4. Sembunyikan garis panduan halaman di layar ponsel */
  .paper-page-guides {
    display: none !important;
  }

  /* 5. Sembunyikan dropdown select kertas di toolbar HP agar tidak sesak */
  .note-toolbar select.paper-select,
  .notes-panel-actions select.paper-select {
    display: none !important;
  }
}
```

### B. Pertimbangan Penyesuaian Komponen JS
- Menjaga state `meta_json` tetap utuh sehingga saat catatan dibuka di desktop, mode kertas tetap aktif sesuai pilihan pengguna.
- Di `NoteModal` dan `NotePanel`, pembungkus `.paper-inner-wrap` yang memiliki inline `style={{ width: "var(--paper-width, 210mm)" }}` akan di-override oleh CSS `width: 100% !important; margin: 0 !important;` pada breakpoint mobile.

---

## 3. Rencana Pengujian
1. **Unit Tests (`tests/offline/note_paper_mode.test.js`):**
   - Asersi keberadaan media query `@media (max-width: 768px)` untuk `.paper-mode-active`, `.paper-inner-wrap`, `.milkdown-editor`, dan `.note-rendered`.
   - Asersi `display: none !important` untuk `.paper-page-guides` dan `select.paper-select` pada mobile.
   - Asersi `width: 100% !important`, `box-shadow: none !important`, `padding: 0 !important`.
2. **Regression Testing:**
   - Menjalankan seluruh test suite offline (`node --test tests/offline/*.test.js`) dan pytest (`tests/test_version.py`).
   - Verifikasi inline script parser (`node temporary_files/check_inline_scripts.js static/index.html`).

---

## 4. Langkah Handover untuk Sesi Malam
1. Buka branch baru atau lanjutkan di branch kerja.
2. Terapkan penambahan styling CSS responsif media query di `static/index.html`.
3. Tambahkan pengujian di `tests/offline/note_paper_mode.test.js`.
4. Bump Service Worker version (misal v401) jika diperlukan atau pertahankan v400.
5. Jalankan verifikasi tes hingga seluruhnya passed.
