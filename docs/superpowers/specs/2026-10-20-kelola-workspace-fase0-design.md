# Kelola Workspace — Fase 0: perbaikan aman

Tanggal: 2026-10-20 · Status: desain disetujui di chat, menunggu tinjauan spec

## Latar belakang

Bapak mengajukan 5 kelompok enhancement untuk halaman Kelola Workspace (`SharedListsManager` di `static/index.html`). Pekerjaan dipecah menjadi fase:

| Fase | Isi |
|---|---|
| **0 — Perbaikan aman (spec ini)** | Bug data saat hapus workspace / keluarkan anggota, owner di daftar anggota, dialog Hapus dengan ringkasan dampak + ketik nama, istilah, mode gelap, aksesibilitas |
| 1 — Halaman Kelola per workspace | Halaman detail bersection; nama/deskripsi/warna/inisial; kartu hanya Buka + Kelola, Hapus ke Danger Zone; urutan pin sidebar |
| 2 — Undangan & siklus hidup | Undangan butuh persetujuan; kode gabung aktif/nonaktif, masa berlaku, reset; daftar link aktif; transfer ownership; arsip / soft delete; ekspor |
| 3 — Bawaan & template | Default view/grouping per workspace; default task baru; template / duplikat struktur |
| 4 — Peran & izin | Admin/Viewer, izin granular |
| 5 — Statistik & notifikasi | Pemakaian penyimpanan, rekap fokus per project, mute notifikasi per workspace |

Fase 1–5 masing-masing punya spec sendiri nanti. Spec ini hanya Fase 0.

## Temuan di kode (dasar Fase 0)

1. `tasks.list_id` ditambahkan lewat `ALTER TABLE tasks ADD COLUMN list_id INTEGER DEFAULT NULL` **tanpa foreign key**. `delete_shared_list` tidak menyentuh task, sehingga setelah workspace dihapus task tetap ada dengan `list_id` menggantung. Karena `/api/tasks` memakai `user_id = ? OR list_id IN (...)`, task tetap terlihat oleh pembuatnya (dengan scope workspace yang sudah tidak ada) dan hilang bagi anggota lain. Dialog saat ini justru berkata "Semua task di list ini akan ikut terhapus".
2. `workspace_files` terhapus lewat `ON DELETE CASCADE`, tetapi file fisiknya tertinggal di disk.
3. `projects` dan `contexts` (tahap) workspace terhapus lewat cascade; `tasks.project_id` / `context_id` menjadi NULL lewat FK `SET NULL` **tanpa** menaikkan `updated_at` dan kolom teks `project` / `context` tetap berisi nama lama.
4. `remove_list_member` (dipakai untuk "keluarkan" dan "keluar") hanya menghapus keanggotaan dan pin; `tasks.assigned_to` tetap menunjuk orang yang sudah bukan anggota.
5. `get_list_members` hanya membaca `list_members`, owner tidak termasuk → workspace baru menampilkan "Belum ada anggota." padahal `GET /api/lists/{id}` sudah mengirim `owner`.
6. `member_count` di `get_lists_for_user` tidak menghitung owner (owner + 1 orang tertulis "1 anggota").
7. Daftar anggota di-cache di state `members[listId]` saat panel pertama dibuka dan tidak dimuat ulang.
8. Teks campur "shared list" / "list" / "workspace".
9. Warna hex tetap (`#fee2e2`, `#fef3c7`, `#f8f8f8`) rusak di tema gelap.
10. Semua konfirmasi memakai `confirm()` bawaan; tombol Kelola tanpa `aria-expanded`; tombol hapus anggota berupa teks tanpa label.

## Keputusan Bapak

- Anggota dikeluarkan / keluar: task **belum selesai** di workspace itu yang ditugaskan kepadanya **dilepas** penanggung jawabnya; task selesai tetap tercatat (riwayat).
- Dialog Hapus: **ringkasan dampak + ketik nama**.
- Hapus workspace: task **kembali menjadi task pribadi pembuatnya** (seperti note dan drawing). Task yatim yang sudah ada di produksi dibereskan dengan aturan yang sama.

## Desain

### Bagian 1 — Backend & data (`repository.py`, `webapp.py`)

Semua aturan data ada di `repository.py` dalam satu transaksi, sehingga bot dan aplikasi memakai jalur yang sama dan perangkat offline cukup menarik task dengan `updated_at` baru.

**1. Hapus workspace — `delete_shared_list(list_id, owner_id)`** (satu transaksi, hanya bila pemanggil owner):
- Task dengan `list_id = W`: `list_id = NULL`, `assigned_to = NULL`, `project_id = NULL`, `project = ''`, `context_id = NULL`, `context = ''` (nilai bawaan kolom teks), `updated_at = sekarang` (format sama dengan penulisan `updated_at` task yang lain). Task tetap milik `user_id` pembuatnya. Status, deadline, subtask, catatan task, lampiran task tidak diubah.
- Kumpulkan nama file fisik `workspace_files` milik W (`is_deleted = 0`) **sebelum** DELETE, **kecuali** yang masih dirujuk `task_attachments.filename` — lampiran task workspace dicerminkan ke `workspace_files` (`source = 'task'`) dengan file fisik yang sama, dan task kembali pribadi beserta lampirannya. Hapus file `UPLOAD_DIR/<filename>` dari disk **setelah** commit sukses (di `repository.py`, sehingga jalur bot juga membersihkan). Kegagalan unlink dicatat (`logging.warning`), tidak membatalkan.
- Perilaku yang sudah ada tetap: mindmap tertaut note dan drawing kembali pribadi, note lewat FK `SET NULL`, sisanya cascade.

**2. `GET /api/lists/{id}/delete-impact`** (owner saja; anggota 403; workspace tidak ada 404). Respons:

```json
{
  "tasks_total": 12, "tasks_active": 3,
  "files": 4, "messages": 57,
  "projects": 2, "stages": 3,
  "notes_to_personal": 5, "drawings_to_personal": 1
}
```

`tasks_active` = `gtd_status NOT IN ('done','archived')`. `files` = baris `workspace_files` W dengan `is_deleted = 0` yang filename-nya tidak dirujuk `task_attachments` (yang benar-benar dihapus); `messages` = baris `messages` W; `projects` / `stages` = baris `projects` / `contexts` W (termasuk arsip); `notes_to_personal` = `scratchpad_notes` W; `drawings_to_personal` = `drawings` W. Rute didefinisikan dengan pola yang sama seperti `/leave-impact`.

**3. Keluarkan / keluar — `remove_list_member(list_id, user_id)`** (satu transaksi): selain menghapus keanggotaan dan pin, `UPDATE tasks SET assigned_to = NULL, updated_at = sekarang WHERE list_id = ? AND assigned_to = ? AND gtd_status NOT IN ('done','archived')`. Hanya dilakukan bila baris keanggotaan memang terhapus.

**4. Migrasi idempoten di `migrate_db`**: task dengan `list_id IS NOT NULL AND list_id NOT IN (SELECT id FROM shared_lists)` dibereskan dengan aturan nomor 1 (tanpa file disk). Dijalankan ulang tidak mengubah apa pun. Query pemeriksaan sebelum/sesudah disertakan di deskripsi PR.

**5. `member_count`** di `get_lists_for_user` = jumlah `list_members` + 1 (owner). Pemakai lain `member_count` dicek di rencana agar tidak terhitung ganda.

**Perangkat offline (dicek saat menyusun rencana):** tidak perlu perubahan sinkronisasi. `pullTasks` di `static/offline/syncpull.js` mengonfirmasi task yang hilang dari daftar server lewat `GET /api/tasks/{id}`; anggota lain mendapat 403 (task kini pribadi orang lain) → task dihapus dari store lokal; task dengan edit tertunda ditandai `conflict: "remote_deleted"` seperti task terhapus lainnya. Perangkat pembuat menerima task dengan `updated_at` baru dan `list_id` kosong. Dibuktikan di E2E.

**Deploy:** restart `taskflow-web` **dan** `taskflow` (bot), karena `repository.py` berubah.

### Bagian 2 — Tampilan (`SharedListsManager`, `app.css`)

Tata letak tetap; tidak ada tombol yang dipindah (itu Fase 1).

1. **Dialog Hapus workspace** (komponen dialog bergaya Alurik, bukan `confirm()`):
   - Saat dibuka memuat `delete-impact`, menampilkan ringkasan, mis. "12 task (3 aktif) akan kembali menjadi task pribadi pembuatnya · 4 berkas dan 57 pesan chat dihapus permanen · 2 project dan 3 tahap dihapus · 5 catatan dan 1 drawing kembali pribadi". Baris bernilai 0 tidak ditampilkan.
   - Input "Ketik nama workspace untuk konfirmasi"; tombol "Hapus permanen" aktif hanya bila input cocok dengan nama (huruf besar/kecil diabaikan, spasi di ujung dipangkas).
   - Offline atau gagal memuat dampak → teks "Hapus workspace butuh koneksi internet" / "Gagal memuat ringkasan — coba lagi" + tombol coba lagi; tombol Hapus nonaktif.
   - Esc dan klik di luar menutup; `role="dialog"`, `aria-modal="true"`, fokus ke input saat terbuka, dikembalikan ke tombol asal saat ditutup.
2. **Dialog keluarkan anggota** (gaya Alurik): "Keluarkan {nama} dari workspace ini? Task belum selesai yang ditugaskan ke {nama} akan dilepas penanggung jawabnya."
3. **Daftar anggota**: owner di baris pertama dengan label "Owner" (data `owner` dari `GET /api/lists/{id}`), anggota sesudahnya; bila tidak ada anggota selain owner → "Belum ada anggota lain." Daftar dimuat ulang setiap panel dibuka dan setelah undang / keluarkan.
4. **Istilah**: semua teks halaman ini dan toast terkait memakai "workspace": "Workspace dibuat", "Workspace dihapus", "{username} ditambahkan ke workspace", "Anggota dikeluarkan", "Belum ada workspace. Buat yang pertama di atas!".
5. **Mode gelap**: hex tetap diganti token tema; tombol Hapus/Keluar memakai kelas baru `.btn-danger-soft` / `.btn-warn-soft` di `app.css` dengan varian gelap; kotak link undangan memakai `var(--bg-subtle)`.
6. **Aksesibilitas**: tombol Kelola/Tutup `aria-expanded` + `aria-controls`; tombol keluarkan anggota `aria-label="Keluarkan {nama}"`.

Logika murni (pencocokan nama, format ringkasan dampak, urutan daftar anggota) diletakkan di modul `static/offline/wsmanage.js` agar bisa dites dengan node.

### Versi

SW dinaikkan ke nomor kosong berikutnya (saat ini `main` v433 → v434), `app.css?v=` naik.

## Pengujian

- **pytest**: hapus workspace → task kembali pribadi pembuatnya (list_id/assigned_to/project/context kosong, updated_at naik), anggota lain tidak lagi melihatnya, file disk terhapus, gagal unlink tidak membatalkan; keluarkan dan keluar → task aktif dilepas, task done/archived tetap, task workspace lain tidak tersentuh; migrasi task yatim + idempoten; `delete-impact` owner (angka benar), anggota 403, tidak ada 404; `member_count` termasuk owner.
- **node**: helper `wsmanage.js` (cocok nama, ringkasan, urutan anggota).
- **E2E Playwright** (dua akun, terang + gelap): nama salah → tombol nonaktif; hapus → task buatan B kembali pribadi di perangkat B setelah sync; keluarkan B → task aktif B tanpa penanggung jawab, task selesai tetap; owner tampil di daftar; tidak ada sisa teks "shared list".
- `npm test`, pytest penuh, `check_inline_scripts`.

## Di luar cakupan

Pemindahan tombol Hapus / Danger Zone, soft delete / arsip, undangan dengan persetujuan, daftar link aktif, ganti nama — semua di Fase 1–2.
