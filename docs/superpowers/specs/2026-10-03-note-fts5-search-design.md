# Design Specification: SQLite FTS5 Search & Tag Operators (`tag:`, `-tag:`)

- **Author:** Antigravity / Gemini
- **Date:** 2026-10-03
- **Status:** Approved (Ready for Implementation Planning)
- **Target:** Backend (`webapp.py`), Database Migration, Frontend (`static/index.html`, `static/sw.js`), Unit Tests

---

## 1. Overview & Motivation
Pada arsitektur Alurik sebelumnya, pencarian catatan pada endpoint `GET /api/scratchpad` menggunakan kueri `LIKE '%q%'` sederhana pada kolom `title` dan `content`, serta parameter `tag` tunggal yang mengabaikan kueri pencarian teks saat diberikan. Pendekatan ini memiliki kelemahan:
1. Performa kueri `LIKE '%q%'` mengalami full table scan dan melambat secara signifikan seiring bertambahnya ribuan catatan.
2. Tidak ada dukungan sintaks operator lanjutan seperti filter penyertaan `tag:<nama>` bersamaan dengan kata kunci bebas.
3. Tidak ada dukungan filter pengecualian `-tag:<nama>` untuk menyaring catatan yang tidak diinginkan (misalnya mengabaikan catatan bertag `#arsip`).
4. Kueri tidak memiliki skor relevansi (BM25 ranking).

Dokumen ini mendefinisikan desain teknis untuk migrasi pencarian catatan ke **SQLite FTS5 Full-Text Search**, penerapan parser operator terpadu (`tag:` dan `-tag:`), sinkronisasi otomatis via database triggers, dan dukungan filter offline in-memory yang setara pada klien PWA.

---

## 2. Database Schema & Migration Architecture

### 2.1 External Content Virtual Table
Untuk menghindari duplikasi teks dan menghemat konsumsi ruang disk, tabel virtual FTS5 akan menggunakan pola *External Content Table* yang langsung menautkan rowid ke `scratchpad_notes.id`:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS scratchpad_notes_fts USING fts5(
    title,
    content,
    content='scratchpad_notes',
    content_rowid='id',
    tokenize='unicode61'
);
```

### 2.2 Synchronization Triggers
Tiga database trigger dibuat untuk menjamin indeks FTS5 selalu konsisten dengan tabel utama `scratchpad_notes`:

```sql
-- Trigger INSERT
CREATE TRIGGER IF NOT EXISTS trg_scratchpad_notes_ai AFTER INSERT ON scratchpad_notes BEGIN
    INSERT INTO scratchpad_notes_fts(rowid, title, content)
    VALUES (new.id, new.title, new.content);
END;

-- Trigger DELETE
CREATE TRIGGER IF NOT EXISTS trg_scratchpad_notes_ad AFTER DELETE ON scratchpad_notes BEGIN
    INSERT INTO scratchpad_notes_fts(scratchpad_notes_fts, rowid, title, content)
    VALUES ('delete', old.id, old.title, old.content);
END;

-- Trigger UPDATE
CREATE TRIGGER IF NOT EXISTS trg_scratchpad_notes_au AFTER UPDATE ON scratchpad_notes BEGIN
    INSERT INTO scratchpad_notes_fts(scratchpad_notes_fts, rowid, title, content)
    VALUES ('delete', old.id, old.title, old.content);
    INSERT INTO scratchpad_notes_fts(rowid, title, content)
    VALUES (new.id, new.title, new.content);
END;
```

### 2.3 Migration Logic in `migrate_db()`
Di dalam `webapp.py` (`migrate_db()`):
1. Memastikan virtual table `scratchpad_notes_fts` dan ketiga triggers telah dibuat.
2. Melakukan pengecekan apakah tabel virtual baru dibuat / kosong sementara tabel `scratchpad_notes` memiliki data; jika ya, jalankan:
   ```sql
   INSERT INTO scratchpad_notes_fts(scratchpad_notes_fts) VALUES('rebuild');
   ```
3. Menangani penanganan kesalahan jika ekstensi FTS5 tidak tersedia (fallback aman).

---

## 3. Backend Query Parsing & Search API

### 3.1 Query Parser (`_parse_note_search_query(q: str, tag: str)`)
Fungsi pembantu di `webapp.py` yang memproses parameter kueri:
- Ekstraksi `positive_tags`:
  - Mengambil tag dari parameter `tag` (jika ada).
  - Mengambil semua token `(?:^|\s)tag:(\S+)` dari `q`.
  - Normalisasi ke huruf kecil (lowercase).
- Ekstraksi `negative_tags`:
  - Mengambil semua token `(?:^|\s)-tag:(\S+)` dari `q`.
  - Normalisasi ke huruf kecil (lowercase).
- Ekstraksi `clean_query`:
  - Menghapus pola `tag:\S+` dan `-tag:\S+` dari `q`.
  - Membersihkan karakter yang memicu error sintaks FTS5 (seperti tanda bintang tanpa kata, tanda kurung tidak berpasangan, tanda kutip ganjil).
  - Mengubah token kata menjadi prefix match `"<term>"*` agar pencarian parsial (misal `lapor` mencocokkan `laporan`) tetap berfungsi dengan alami.

### 3.2 SQL Query Assembly in `GET /api/scratchpad`
1. **Access Control:** Wajib menerapkan `_note_access_clause(uid, prefix="s")`.
2. **Positive Tag Filtering:**
   Untuk setiap tag positif:
   ```sql
   EXISTS (
       SELECT 1 FROM entity_tags et
       JOIN tags t ON t.id = et.tag_id
       WHERE et.entity_id = s.id AND et.entity_type = 'note' AND t.name = ?
   )
   ```
3. **Negative Tag Filtering:**
   Untuk setiap tag negatif:
   ```sql
   NOT EXISTS (
       SELECT 1 FROM entity_tags et
       JOIN tags t ON t.id = et.tag_id
       WHERE et.entity_id = s.id AND et.entity_type = 'note' AND t.name = ?
   )
   ```
4. **FTS5 Matching:**
   Jika `fts_query` tidak kosong:
   ```sql
   JOIN scratchpad_notes_fts fts ON fts.rowid = s.id
   -- WHERE clause:
   fts.scratchpad_notes_fts MATCH ?
   -- ORDER BY:
   ORDER BY fts.rank, s.updated_at DESC
   ```
   Jika `fts_query` kosong:
   ```sql
   ORDER BY s.updated_at DESC
   ```
5. **Fallback:** Jika terjadi `sqlite3.OperationalError` saat eksekusi MATCH, lakukan fallback transparan ke kueri `LIKE` agar pengguna tidak mengalami HTTP 500.

---

## 4. Frontend Client Integration

### 4.1 Parser Klien (`parseQuery`)
Di `static/index.html`:
```javascript
const parseQuery = query => {
  const negativeTags = [...query.matchAll(/(?:^|\s)-tag:(\S+)/gi)].map(m => m[1].toLowerCase());
  const syntaxTags = [...query.matchAll(/(?:^|\s)tag:(\S+)/gi)].map(m => m[1].toLowerCase());
  const cleanQuery = query
    .replace(/(?:^|\s)-tag:\S+/gi, " ")
    .replace(/(?:^|\s)tag:\S+/gi, " ")
    .trim();
  return { cleanQuery, syntaxTags, negativeTags };
};
```

### 4.2 Offline Filter (`applyFilters` & `applyFiltersStatic`)
Menambahkan evaluasi `negativeTags`:
```javascript
for (const ntag of negativeTags) {
  result = result.filter(n => !(n.tags || []).map(t => t.toLowerCase()).includes(ntag));
}
```
Menjamin bahwa saat mengetik di UI dalam kondisi online maupun offline, filter instan di memori mengecualikan catatan dengan tag tersebut.

### 4.3 Service Worker Cache Busting
- Versi Service Worker di `static/sw.js` dinaikkan ke: **`taskflow-v349-fts5-tag-search`**.
- Sinkronisasi asersi versi SW di test suite unit yang bersangkutan.

---

## 5. Verification & Testing Plan
1. **Unit Testing Backend (`tests/test_note_fts_search.py`):**
   - Inisialisasi dan rebuild indeks FTS5.
   - Pencarian kata kunci pada judul dan isi catatan.
   - Pencarian prefix kata.
   - Operator `tag:nama` dan `-tag:nama` (termasuk kombinasi keduanya).
   - Sinkronisasi otomatis saat INSERT, UPDATE, dan DELETE catatan.
   - Keamanan terhadap tanda baca dan karakter khusus FTS.
   - Isolasi hak akses multi-user.
2. **Unit Testing Frontend (`tests/offline/note_search_filters.test.js`):**
   - Pengujian `parseQuery` untuk tag positif, tag negatif, dan teks bersih.
   - Pengujian `applyFilters` dan `applyFiltersStatic` secara in-memory.
   - Pengecekan sintaks inline script: `node scratch/check_inline.js static/index.html`.
   - Pengecekan sintaks SW: `node --check static/sw.js`.
3. **Full Regression Test Suite:**
   - `python -m pytest tests/` (semua 91+ tes lulus).
   - `node --test tests/offline/*.test.js` (semua 850+ tes lulus).
