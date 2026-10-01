# Design Spec: Low-Friction Interactive Note Viewer (`NotePanel`)

- **Date:** 2026-10-01
- **Status:** Approved for Implementation
- **Target Components:** `NotePanel` in `static/index.html`, `renderMarkdown` in `static/index.html`, `static/app.css`, `static/sw.js`
- **Tests:** `tests/offline/interactive_note_viewer.test.js`

---

## 1. Problem Statement & Motivation

Saat ini, pembacaan dan penyuntingan catatan pada modul Catatan Alurik memiliki pemisahan yang kaku antara mode baca ([`NotePanel`](file:///Z:/Todolist%20Manager%20V5.0/static/index.html#L19534)) dan mode sunting ([`NoteModal`](file:///Z:/Todolist%20Manager%20V5.0/static/index.html#L17729)).

Ketika pengguna sedang membaca sebuah catatan dan hanya ingin melakukan perubahan ringan—seperti mencentang item to-do (`- [ ]`), mengganti judul catatan, atau menyunting teks secara cepat—pengguna dipaksa untuk:
1. Mencari dan mengklik tombol "Edit" di header kanan panel.
2. Menunggu modal `NoteModal` muncul dengan backdrop gelap dan me-mount editor Milkdown.
3. Mencari baris teks yang ingin diubah.
4. Menutup modal untuk kembali membaca catatan.

Alur ini menimbulkan *friction* (gesekan kognitif dan waktu) untuk perubahan mikro. Di sisi lain, pengguna sangat menyukai fitur lanjutan yang ada pada `NoteModal` (seperti *Paper View A4/A3*, ProseMirror block handling, toolbar format, lampiran, dsb.) dan tidak ingin fitur-fitur tersebut hilang atau terganggu.

---

## 2. Goals & Non-Goals

### Goals
1. **Interactive Checklists di Viewer:** Pengguna dapat langsung mencentang atau membatalkan centang pada to-do checklist (`- [ ]` ↔ `- [x]`) langsung di tampilan `NotePanel` tanpa membuka modal editor. Status tersimpan otomatis ke IndexedDB dan API.
2. **Inline Title Edit di Viewer:** Pengguna dapat mengubah judul catatan langsung di header `NotePanel` dengan klik pada judul, mengetik judul baru, lalu menekan `Enter` atau blur untuk menyimpan.
3. **Double-Click to Edit:** Pengguna dapat melakukan double-click di area teks catatan pada `NotePanel` untuk langsung memicu pembukaan `NoteModal` secara instan, tanpa harus menargetkan tombol "Edit" di pojok kanan atas.
4. **100% Preservation:** Tidak mengubah, merusak, atau menghapus fitur apa pun pada `NoteModal` (Paper Mode, Milkdown WYSIWYG, block content, templates, voice dictation, dsb.).

### Non-Goals
- Tidak mengganti `NoteModal` menjadi in-place editor penuh (menjaga isolasi dan stabilitas Milkdown serta Paper Mode).
- Tidak mengubah skema database SQLite backend.
- Tidak mengubah REST API backend FastAPI (menggunakan endpoint `PUT /api/scratchpad/{id}` yang sudah ada).

---

## 3. Detailed Architecture & Design

### 3.1. Interactive Checklist Handling

1. **Rendering di `renderMarkdown`:**
   - Standar `marked.parse` menghasilkan checklist item dengan format:
     ```html
     <li class="task-list-item"><input type="checkbox" disabled="" ...> Label</li>
     ```
   - Di `renderMarkdown`, kita perbarui pemrosesan checkbox agar interaktif di viewer:
     - Menghapus atribut `disabled=""` pada checkbox atau mengganti dengan class `note-interactive-checkbox` serta atribut `data-checkbox-index="${idx}"`.
     - Memberikan styling pointer pada `.note-rendered input[type="checkbox"]` (`cursor: pointer`).

2. **Event Handling di `NotePanel` (`handlePreviewClick`):**
   - Saat event click terjadi di dalam `.note-rendered`:
     - Periksa apakah target klik adalah `input[type="checkbox"]` (atau labelnya).
     - Hitung indeks checkbox yang diklik (misal checkbox ke-$N$ dalam dokumen).
     - Ekstrak seluruh match checklist markdown pada `note.content`:
       ```regex
       /^[ \t]*[-*+]\s+\[([ xX])\]/gm
       ```
     - Temukan kemunculan ke-$N$, lalu ganti `[ ]` menjadi `[x]` (atau sebaliknya).
     - Perbarui state catatan lokal (`note.content = nextContent`).
     - Simpan perubahan secara optimistik:
       - Panggil `api.put('/api/scratchpad/' + note.id, { ...note, content: nextContent })`.
       - Fallback offline via `OfflineDB.cacheSet` dan `OfflineDB.queueAdd` jika offline.
       - Tembakkan event `window.dispatchEvent(new CustomEvent("noteSaved"))`.

### 3.2. Inline Title Quick Edit

1. **State di `NotePanel`:**
   - `const [isEditingTitle, setIsEditingTitle] = useState(false);`
   - `const [titleDraft, setTitleDraft] = useState(note?.title || "");`
   - Sinkronisasi saat `note?.id` atau `note?.title` berubah.

2. **UI & Interaksi:**
   - Saat `!isEditingTitle`:
     - Judul ditampilkan dengan tooltip *"Klik untuk ubah judul"*.
     - Ditambahkan ikon pensil kecil yang halus di sebelah judul saat hover.
     - Klik judul atau ikon pensil mengaktifkan `setIsEditingTitle(true)`.
   - Saat `isEditingTitle`:
     - Render input teks inline: `<input className="note-title-inline-input" autoFocus ... />`.
     - `onKeyDown`:
       - `Enter`: jalankan `handleSaveTitle()`.
       - `Escape`: batalkan dan kembalikan `titleDraft` ke `note.title`.
     - `onBlur`: jalankan `handleSaveTitle()`.
   - Fungsi `handleSaveTitle`:
     - Jika `titleDraft.trim() !== (note.title || "")`:
       - Perbarui `note.title = titleDraft.trim()`.
       - Panggil `api.put('/api/scratchpad/' + note.id, { ...note, title: note.title })`.
       - Tembakkan event `window.dispatchEvent(new CustomEvent("noteSaved"))`.
     - Matikan mode edit: `setIsEditingTitle(false)`.

### 3.3. Double-Click to Open Full Editor

1. Di komponen `NotePanel`, pada container `<div className="note-rendered" ...>`:
   - Tambahkan prop `onDoubleClick={handleDoubleClickContent}`.
   - Guard `handleDoubleClickContent`:
     - Jika target klik adalah interaktif (seperti checkbox, link `<a>`, wikilink `[data-wiki-...]`, tasklink `[data-tasklink]`, tombol drawing), jangan buka modal.
     - Jika target adalah teks/paragraf biasa, panggil `onEdit()`.
   - Berikan atribut `title="Double-click untuk mengedit catatan"` pada container.

---

## 4. Error Handling & Offline Resilience

- Seluruh pembaruan (`api.put`) dibungkus dalam blok `try/catch`.
- Jika terjadi error offline (`isOfflineErr(e)`), sistem mengupdate IndexedDB `scratchpad_notes` dan menambahkan operasi PUT ke antrean outbox `OfflineDB.queueAdd`, memastikan konsistensi offline-first Alurik tetap terjaga.

---

## 5. Verification Plan

1. **Unit Test Suite (`tests/offline/interactive_note_viewer.test.js`):**
   - Test 1: Verifikasi checkbox markdown di-render tanpa atribut `disabled` dan memiliki `data-checkbox-index`.
   - Test 2: Verifikasi helper toggle checklist markdown mampu membalik status checkbox ke-$N$ secara akurat (`[ ]` ↔ `[x]`) pada konten multi-baris.
   - Test 3: Verifikasi keberadaan inline title edit handler dan state di `NotePanel`.
   - Test 4: Verifikasi double click handler pada container `.note-rendered` memanggil `onEdit`.
   - Test 5: Verifikasi `NoteModal` tetap utuh dengan referensi `MilkdownEditor`, `paperConfig`, dan `NoteToolbar`.
2. **Syntax Checks:**
   - `node scratch/check_inline.js static/index.html` (5/5 scripts OK).
   - `node --check static/sw.js` (OK).
3. **Regression Tests:**
   - `node --test tests/offline/*.test.js` (semua suites pass).
   - `python -m pytest tests/` (semua backend tests pass).
