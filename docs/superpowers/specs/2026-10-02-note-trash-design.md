# Note Trash & Restore — Design Spec

Tanggal: 2026-10-02 · Status: disetujui user untuk dikerjakan (scope & retensi memakai default di bawah).

## Masalah
`DELETE /api/scratchpad/{id}` (webapp.py) menghapus note secara permanen beserta tag, pin, publish, dan baris lampiran. Tidak ada cara memulihkan note yang terhapus tidak sengaja. Klien offline-first (IndexedDB + outbox) juga langsung membuang rekaman lokal saat op `delete` berhasil.

## Keputusan (default, bisa diubah user)
- **Scope:** hanya note (`scratchpad_notes`). Task, mindmap, drawing di luar scope.
- **Retensi:** 30 hari, lalu dihapus permanen (lazy purge, tanpa cron).
- **Pendekatan:** **tabel snapshot `trashed_notes`**, BUKAN kolom `deleted_at` pada `scratchpad_notes`. Alasan: ±30 query di `webapp.py` membaca `scratchpad_notes` (list, search, titles, backlinks, publish, export, bot…). Soft-delete lewat kolom memaksa semua query diubah dan satu yang terlewat membocorkan note terhapus (termasuk halaman publik). Dengan snapshot, semua perilaku yang ada tetap persis sama; hapus tetap menghapus dari `scratchpad_notes`.
- **Restore** memasukkan kembali baris dengan **id asli** (AUTOINCREMENT tidak pernah memakai ulang id, jadi tak bentrok), sehingga `linked_to` di note lain, wikilink, dan backlink kembali valid.
- **Tanpa perubahan sync klien:** note hilang dari `GET /api/scratchpad` → pull sudah menghapus rekaman lokal; setelah restore, pull melihat note sebagai baru (`!local → created`).
- **Tampilan Sampah hanya online.** Hapus saat offline tetap lewat outbox seperti sekarang.

## Skema
```sql
CREATE TABLE IF NOT EXISTS trashed_notes (
    note_id       INTEGER PRIMARY KEY,          -- id asli scratchpad_notes
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title         TEXT NOT NULL DEFAULT '',
    snapshot_json TEXT NOT NULL,                -- lihat di bawah
    deleted_at    TEXT NOT NULL                 -- ISO, zona _TZ_JKT (sama dgn now di webapp)
);
CREATE INDEX IF NOT EXISTS idx_trashed_user ON trashed_notes(user_id, deleted_at);
```
`snapshot_json` = `{ "note": {<semua kolom scratchpad_notes>}, "tags": [nama tag lowercase], "pins": [user_id,...], "published": {slug,password_hash,published_at,user_id} | null, "attachments": [{baris note_attachments}] }`.
Migrasi: `CREATE TABLE IF NOT EXISTS` di tempat tabel lain dibuat (ikuti pola `published_notes` di `repository.py` ±baris 459 dan/atau `migrate_db()` di webapp.py — pakai yang dipakai `tests/conftest.py`: `webapp.migrate_db()`).

## API (semua butuh login; hanya PEMILIK note)
Rute statis `trash` HARUS didaftarkan SEBELUM `/api/scratchpad/{note_id}` (path int) — letakkan di dekat `/api/scratchpad/recent`.

| Method | Path | Perilaku |
| --- | --- | --- |
| DELETE | `/api/scratchpad/{note_id}` | **Berubah:** dalam satu transaksi, tulis snapshot ke `trashed_notes`, lalu cascade-delete seperti sekarang. Respons & idempotensi tidak berubah (`{"ok":true}`; note sudah hilang → `{"ok":true,"detail":"Note already deleted"}`; bukan pemilik → 403). |
| GET | `/api/scratchpad/trash` | Purge baris kedaluwarsa (>30 hari) lalu daftar milik user: `[{id, title, preview(≤120 char dari content, tanpa markup berlebihan), tags, list_id, deleted_at, days_left}]`, terbaru dulu. |
| POST | `/api/scratchpad/trash/{note_id}/restore` | Masukkan kembali ke `scratchpad_notes` (id asli) + tag + pin + publish + lampiran. Hapus baris trash. Kembalikan note seperti `_scratchpad_row`. 404 bila tidak ada di trash milik user. |
| DELETE | `/api/scratchpad/trash/{note_id}` | Hapus permanen satu item. Idempoten. |
| DELETE | `/api/scratchpad/trash` | Kosongkan seluruh sampah milik user → `{"ok":true,"deleted":N}`. |

Kasus tepi restore (harus ada tes):
- `list_id` tak ada lagi / user bukan anggota lagi → set `NULL`.
- `linked_task_id` & id di `linked_task_ids` yang task-nya sudah hilang → buang (FK tidak boleh melempar).
- `client_id` sudah dipakai note lain milik user → set `NULL`.
- slug publish sudah dipakai note lain → lewati publish (note dipulihkan tanpa publish), jangan gagal.
- Pin pengguna lain dipulihkan hanya bila user tsb masih ada.
- Tag dipulihkan via `_upsert_tags_for_note`.
- Note shared (`list_id`) yang dihapus pemilik: anggota kehilangannya (perilaku sekarang); restore mengembalikannya.
- User lain tidak bisa melihat/restore/menghapus permanen item trash orang lain (404/403).

Batasan yang diketahui (di luar scope): file lampiran di Nextcloud tidak pernah dihapus saat note dihapus (perilaku lama) — jadi tetap ada untuk restore; hapus permanen tidak membersihkannya.

## Klien (`static/index.html`, `static/offline/*`)
1. Konfirmasi hapus (`window.confirm("Hapus catatan ini?")`, ±baris 21217 dan alur `handleDelete` ±baris 8867) → teks menjelaskan "dipindahkan ke Sampah, bisa dipulihkan 30 hari". Toast sukses.
2. Header halaman Notes: tombol **Sampah** (ikon `trash`; buat ikon bila belum ada di `ui-components.js`) membuka `NoteTrashModal`: daftar (judul, "dihapus N hari lalu", sisa hari), aksi **Pulihkan**, **Hapus permanen** (konfirmasi), **Kosongkan Sampah** (konfirmasi), state kosong, state loading, state error. Offline → pesan "Perlu koneksi internet untuk melihat Sampah" (tanpa memanggil API).
3. Setelah Pulihkan: panggil mekanisme refresh/sync yang sama dengan setelah create/update agar note muncul di daftar; toast "Catatan dipulihkan".
4. **Jebakan router offline:** `GET /api/scratchpad/trash` (3 segmen) akan cocok dengan rute lokal `GET /api/scratchpad/:id` → `resolveNoteCid("trash")` → "Note not found". Begitu pula `DELETE /api/scratchpad/trash` vs `DELETE /api/scratchpad/:id`. Implementer WAJIB memeriksa bagaimana `api` wrapper di index.html memilih router lokal vs jaringan, lalu pastikan semua rute `/api/scratchpad/trash...` selalu ke jaringan (atau diberi rute lokal eksplisit yang menolak dengan pesan offline). Tulis tes untuk ini di `tests/offline/`.
5. Bump `static/sw.js` (SW v345) dan versi cache/asset yang dipin tes lain sesuai konvensi repo (lihat entri CURRENT_STATE: tes `note_toc`, `drawing_sync_ui` dll. mem-pin versi SW).

## Verifikasi (wajib)
- `python3 -m pytest tests -q` → semua hijau (baseline 61/61 sebelum perubahan).
- `npm test` → baseline 805/806; satu-satunya kegagalan sah adalah `draw_local_reactive` (butuh `static/vendor/tldraw/` yang gitignored). Tidak boleh ada kegagalan baru.
- Tes baru backend: snapshot+restore round-trip (tag, pin, publish, lampiran), semua kasus tepi di atas, otorisasi lintas-user, purge kedaluwarsa (manipulasi `deleted_at` langsung di DB), urutan rute (`/trash` tidak 422), idempotensi.
- Tes baru klien: router tidak menelan `/api/scratchpad/trash*`, logika/format daftar sampah bila diekstrak ke modul murni.
- E2E manual (Playwright, uvicorn lokal): hapus note → muncul di Sampah → pulihkan → muncul lagi di daftar dengan tag/pin utuh; offline → pesan koneksi.
