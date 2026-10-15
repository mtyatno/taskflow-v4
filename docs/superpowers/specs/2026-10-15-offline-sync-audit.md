# Audit Offline & Sinkronisasi Antar-Perangkat — Alurik

Repo `mtyatno/taskflow-v4`, commit `e789ae1` (main, SW v411). Tanggal audit: 2026-10-15.
Cakupan: task, subtask, recurring, notes, drawing, mindmap, habit, shared list + chat, service worker, auth, server.
Metode: pembacaan kode `static/offline/*.js`, `static/sw.js`, `static/index.html`, `webapp.py`, `repository.py`, ditambah skrip probe kecil (tanpa mengubah repo). Semua temuan menyertakan lokasi file:baris dan skenario pemicu. Temuan bertanda ✅ saya verifikasi langsung di kode; sisanya diverifikasi oleh reviewer paralel dan saya cek ulang secara sampel.

Catatan arsitektur penting: `api.fetch` (index.html ~532) **selalu** melayani request dari router lokal (IndexedDB) jika rutenya terdaftar, bahkan saat online. Server hanya disentuh lewat `sync()` (pull → push outbox). Jadi bug di lapisan offline berdampak ke semua pengguna, bukan hanya saat offline.

---

## KRITIS (kehilangan data / kebocoran)

### K1 ✅ JWT kedaluwarsa (72 jam) menghapus seluruh IndexedDB termasuk outbox yang belum terkirim
- `webapp.py:164,772` masa berlaku token 72 jam. `index.html:30059-30066` `tryAuth` → `/api/auth/me` 401 → `clearLocalUserData()` → `db.clearAll()` (`db.js:131-152`) menghapus **semua** store termasuk `_outbox`, task/note/log yang `dirty`.
- Sub-bug: `api.fetch` (`index.html:569-574`) pada 401 memanggil `tokenStore.clear()` **sebelum** `__logout()`, padahal `logout` (`index.html:29993`) langsung `return` bila token kosong → sesi "zombie": UI tetap login, router lokal jalan terus, tiap push dapat 401 → op dibuang (lihat K3) → saat reload semua dihapus.
- Skenario: pengguna bekerja offline > 3 hari (atau tidak membuka app 3 hari sambil ada op tertunda) → online → reload → semua edit offline hilang tanpa peringatan.
- Perbaikan: pada 401 jangan `clearLocalUserData` bila `sub` token == `tf_user_id`; cukup hapus token, tampilkan login, lalu push setelah login ulang. Di `syncpush.send` perlakukan 401 seperti network error (berhenti, op tetap antre). Perbaiki urutan di `api.fetch`.

### K2 ✅ Rekalkulasi Eisenhower (bot, tiap 15 menit) mem-bump `tasks.updated_at` → edit offline dibuang oleh LWW
- `repository.py:825-834 update_quadrant` dan `webapp.py:2074-2076` menulis `updated_at = now` saat kuadran berubah. Klien `syncpull.js:88-96`: record dirty + `server.updated_at != base_rev` → bandingkan waktu → server (baru saja di-bump cron) > edit lokal (dibuat lebih awal saat offline) → `dropOutbox` + timpa lokal. Task tidak punya notice (hanya note/mindmap yang punya).
- Skenario: malam hari offline edit deskripsi task berdeadline 8 hari lagi; keesokan hari deadline jadi 7 hari → cron ubah Q2→Q1, bump `updated_at` → online → edit deskripsi hilang diam-diam.
- Perbaikan: jangan sentuh `updated_at` saat hanya kuadran berubah (kuadran adalah field turunan), atau pakai kolom `quadrant_calc_at` terpisah; idealnya ganti LWW berbasis jam dengan nomor revisi server + merge per field.

### K3 ✅ Push membuang op outbox pada **semua** 4xx (401/400/422/409/429), record tetap `dirty` tanpa op → pull berikutnya menimpanya
- `syncpush.js:206-207, 222-223, 246-247, 400-401, 440-441, 763-764` dll: selain 403/404 yang ditangani khusus, semua status gagal → `result.failed++; outboxRemove`. `syncpull.js:99` (`localRec.dirty && !pending` → timpa dari server). `healStranded*` hanya ada untuk create note & drawing.
- Contoh pemicu non-401: judul mindmap > 200 karakter (`webapp.py:1004`) diterima router lokal tapi 422 di server → seluruh edit node mindmap sesi itu hilang.
- Perbaikan: bedakan error permanen (400/422 → tandai `sync_error` + notice, jangan hapus data) dari sementara (401/429/5xx → tahan op). Jangan pernah membiarkan record `dirty` tanpa op.

### K4 ✅ Note `/share` tidak mem-bump `updated_at` → push berikutnya meng-un-share (atau me-re-share) catatan
- `webapp.py:5592-5611` hanya `UPDATE ... SET list_id`. Klien hanya `setNoteListId` di state React (`index.html:22393, 24340`), record IndexedDB tetap `list_id` lama; pull tidak mengadopsi `list_id` bila `updated_at` sama (`syncpull.js:366`). `noteToUpdatePayload` (`syncpush.js:85-94`) selalu mengirim `list_id`, dan PUT pemilik menerapkannya tanpa syarat (`webapp.py:5528`).
- Skenario: pemilik share note ke list → lanjut mengetik → autosave → PUT `list_id:null` → note hilang dari anggota. Kebalikannya: pemilik **unshare** note privat, lalu edit dari perangkat lain yang masih menyimpan `list_id` lama → note **terekspos lagi ke list** (kebocoran privasi).
- Perbaikan: bump `updated_at` di `/share`; `ScratchpadUpdate.list_id` absen = tidak berubah (`exclude_unset`), dan jangan kirim `list_id` dari payload update.

### K5 ✅ Edit mindmap saat push sedang berjalan ditimpa versi lama
- `syncpush.js:720,738` menulis `putMindmapRaw(Object.assign({}, rec, {dirty:0}))` dengan `rec` yang dibaca **sebelum** request. Mindmap tidak punya `rev`/CAS (drawing punya `mutateDrawing`).
- Skenario (satu perangkat, online, koneksi lambat): autosave PUT v1 in-flight → pengguna lanjut edit (v2 tersimpan lokal) → PUT selesai → record ditimpa v1 `dirty:0` → v2 hilang permanen.
- Perbaikan: tambah `rev` pada record mindmap + `mutateMindmap` CAS seperti drawing.

### K6 ✅ Subtask, catatan task, dan lampiran task tidak pernah tampil (regresi v393, 2026-10-11)
- `taskroutes.js:131-165` mendaftarkan `GET /api/tasks/:id/subtasks|notes|attachments` yang membaca store `subtasks`, `task_notes`, `task_attachments` — tetapi **tidak ada kode** yang mengisi store itu (`syncpull.js`, `hydrate.js`, `index.html` tidak pernah menulis ke sana; hanya test). Karena router lokal selalu dipakai, UI (`index.html:5547, 6867, 7394`) selalu menerima `[]`. POST subtask tetap ke server, jadi data ada di server tapi tak terlihat di perangkat mana pun setelah reload.
- Juga di PR yang sama: `POST /api/tasks/:id/focus` dialihkan ke lokal, tetapi `taskToUpdatePayload` (`syncpush.js:43-59`) tidak mengirim `is_focused` → status fokus tidak pernah sampai ke server/perangkat lain.
- Perbaikan cepat: hapus ketiga rute GET lokal itu (kembali ke jaringan) atau tambahkan pull untuk subtask/notes/attachments. Kirim `is_focused` lewat endpoint server `/focus` saat push.

---

## TINGGI

### T1 ✅ Hasil pull tidak dicek status HTTP-nya (task, list, habit, note)
- `syncpull.js:118-121, 254-257, 422-425`, `listsync.js:90-93` langsung `res.json()`. SW mengembalikan `{detail:"OFFLINE"}` 503 untuk request `X-TF-Sync` → `list.reduce` TypeError → seluruh rantai `sync()` berhenti di langkah pertama (task) dan **push tidak dijalankan** (`index.html:721-745`). Drawing sudah benar (`listJsonOrThrow` + konfirmasi 404), modul lain belum.
- Risiko tambahan: endpoint daftar yang suatu saat mengembalikan array parsial/kosong (filter, pagination) akan memicu **penghapusan lokal massal** (pass "remote deletions" `syncpull.js:103-113`).
- Perbaikan: throw bila `!res.ok`; jangan hapus lokal tanpa konfirmasi 404 per item (pola drawing).

### T2 Merge snapshot drawing tanpa tombstone → coretan yang dihapus hidup lagi
- `syncpull.js:689-713 deepMerge` menggabungkan union record store tldraw; kunci yang ada di salah satu sisi selalu bertahan. Probe: A hapus shape S + push; B punya coretan belum terkirim → pull → merge menghidupkan S → push → S muncul lagi di A. Juga terjadi satu perangkat bila PUT sukses tapi respons timeout. Index fraksional `a2` bisa duplikat (urutan z tak deterministik).
- Perbaikan: three-way merge terhadap snapshot dasar (`base_blob_ref` pada `base_rev`): absen di satu sisi tapi ada di base = hapus.

### T3 Tab mindmap tidak dimuat ulang setelah pull + PUT server tanpa syarat → timpa seluruh peta pengguna lain
- `index.html:733` mengabaikan hasil `pullMindmapsAndReconcile` (drawing punya event `drawingSaved`, mindmap tidak); tab memuat `data_json` sekali per `tab.id` (`index.html:9101-9128`) dan autosave seluruh dokumen; `webapp.py:7143-7161` tanpa cek `base_rev`.
- Skenario: A membuka peta bersama; B tambah 20 node → A sync (record lokal diganti diam-diam, tab masih lama) → A tambah 1 node → PUT pohon lama+1 → 20 node B hilang, tanpa notice ke siapa pun.
- Perbaikan: event reload tab saat pull; kirim `base_rev` pada PUT, server balas 409 bila beda.

### T4 Membuka note (tanpa edit) memicu autosave → mem-bump `updated_at`, mengklaim "diedit oleh", dan memenangkan LWW
- `index.html:22718-22738` efek autosave tanpa mount-guard → PUT 2,5 detik setelah dibuka. Tiap burst ketikan menambah op `update` baru (tidak digabung).
- Skenario: B edit offline 10:00; A hanya **membuka** note 10:05 → saat B online, edit B dibuang (`syncpull.js:356-362`) dengan notice "ditimpa oleh A" padahal A tidak mengetik.
- Perbaikan: lewati run pertama, bandingkan dengan snapshot awal sebelum menyimpan, gabungkan op update per cid.

### T5 Editor note tidak memuat ulang saat pull mengganti record → konten basi menimpa versi baru tanpa notice
- NoteModal inisialisasi state sekali (`index.html:22172-22175`); poll 5 detik hanya untuk note `list_id` dan membaca lewat router **lokal** (`noteroutes.js:36`), bukan server; `lastKnownAtRef` tidak diperbarui setelah autosave sendiri (→ banner "pengguna lain menyimpan" untuk edit sendiri).
- Skenario note pribadi: A buka note, B edit di perangkat lain, A sync (IDB terbarui), A ketik 1 huruf → autosave kirim teks lama+1 → push sukses (base_rev cocok) → edit B hilang, **tanpa notice di kedua sisi**.
- Perbaikan: pada tiap autosave bandingkan `base_rev` yang dimuat editor dengan IDB; muat ulang/merge bila IDB lebih baru; poll ke server.

### T6 Offline, NoteModal tidak menyimpan edit sama sekali
- `index.html:22723 if (!navigator.onLine) return;` di dalam timer autosave, padahal router lokal berjalan offline. Tutup modal/klik tasklink (`:23021`) atau OS mematikan PWA → edit hilang. Tidak ada guard "belum disimpan".
- Perbaikan: hapus guard `onLine`, simpan saat close.

### T7 Tag pada note bersama jadi "zombie" dan duplikat per pengguna
- PUT hanya menghapus baris tag milik editor (`webapp.py:5538`) lalu `_upsert_tags_for_note` per user; `_scratchpad_row` (`:3709-3715`) mengembalikan tag semua user. Pemilik hapus `#x` → baris milik anggota tetap → server terus mengembalikan `x` → pull memasangnya lagi. Tak ada yang bisa menghapus.
- Perbaikan: tag note berskop note (hapus semua `entity_tags` note itu saat PUT) + `DISTINCT`.

### T8 Penanda occurrence task berulang tidak pernah di-pull
- `syncpull.js` tidak menyentuh `recurring_exceptions`; `taskroutes.js:170-178` melayani `GET /api/recurring/exceptions` **selalu** lokal. Tandai selesai di HP → desktop tetap "belum". Setelah K1/logout semua riwayat hilang di perangkat itu.
- Perbaikan: `pullRecurringExceptions` (rentang tanggal) di `sync()`.

### T9 "Uncheck" habit tidak menyebar ke perangkat lain; log dirty tak pernah direkonsiliasi
- `syncpull.js:232-253 pullHabitLogs` hanya create/update, tidak menghapus log lokal yang hilang di server (`webapp.py:3691-3692` menghapus baris). Log `dirty:1` (op dibuang, lihat K3) dilewati selamanya (`:244`). Streak/heatmap salah permanen di perangkat A.
- Perbaikan: hapus log `dirty:0` dalam jendela 90 hari yang absen di server; reset `dirty` bila status sama dengan server.

### T10 Satu timeout request membuang op yang bergantung padanya
- `syncpush.js:1023-1024`: timeout pertama → op dipertahankan tapi drain lanjut. `opHabitCheckin:320-321`, `opMark:242-243`, `opHabitUncheck:338-339` → `serverIdOf == null` → **op dihapus**; `opCreate:195-197` child task dikirim dengan `parent_id:null` (hierarki hilang diam-diam). Direproduksi dengan test throwaway.
- Perbaikan: bila create induk masih di outbox → `return;` (tahan), bukan hapus.

### T11 ✅ POST task/habit/mindmap/pesan tidak idempoten → duplikat saat retry
- `TaskCreate` (`webapp.py:860`), `HabitCreate` (901), `MindmapCreate` (987) tanpa `client_id`; `messages.client_id` disimpan (`:2691-2694`) tapi tidak dicek/unik. Note & drawing sudah benar (`:465,477`).
- Skenario: POST sampai server, respons hilang (timeout 30 detik `index.html:641`, koneksi putus) → op tetap antre → drain berikutnya POST lagi → 2 baris; pull berikutnya memunculkan task ganda di semua perangkat; chat ganda untuk semua anggota.
- Perbaikan: `client_id` + unique index `(user_id, client_id)` + "kembalikan yang ada bila konflik".

### T12 ✅ `recurrence_renew` ("Perpanjang") hanya berlaku lokal
- `taskrepo.js:169-171` set `recurrence_end_date` lokal; `taskToUpdatePayload` tidak mengirim `recurrence_renew`/`recurrence_end_date`; server (`webapp.py:1736-1738`) hanya memperpanjang lewat flag. Push mem-bump `updated_at` dan klien mengadopsinya sebagai `base_rev` → pull tidak pernah mengoreksi. Server tetap "berakhir", mark setelah tanggal akhir → 400 → op dibuang.
- Perbaikan: simpan flag `recurrence_renew` di record sampai terkirim dan sertakan di PUT.

### T13 Drawing 4xx (mis. 422 `data_json` > 5.000.000 karakter) di-retry selamanya tanpa umpan balik
- Op dibuang (`syncpush.js:576-577, 612-613`) tapi `healStrandedDrawings`/pull (`syncpull.js:972-975`) mengantrekan ulang tiap sync → upload 6 MB berulang (gambar tempel base64) → 422 → ulang. Gambar tidak pernah tersinkron, pengguna tidak tahu.
- Perbaikan: error permanen → `sync_error` + notice, hentikan requeue; kecilkan aset di sisi klien.

---

## SEDANG

- **S1 Push 403 menghapus konten lokal tanpa notice** — note (`syncpush.js:397-399, 435-438`), task (`lostAccess` `:161-165`), drawing/mindmap/chat (`:573-574, 723-724, 875-876`). Skenario: dikeluarkan dari list saat sedang mengetik note panjang offline → online → note terhapus. Perbaikan: ubah jadi item pribadi (`list_id:null`) atau `conflict:"access_lost"`.
- **S2 Drawing dihapus di server saat diedit lokal → edit lokal ikut terhapus tanpa notice** — PUT 404 buang op (`syncpush.js:611-613`), pull Pass 4 (`syncpull.js:1010-1027`) menghapus record + blob. Mindmap justru membuat ulang (inkonsisten antar entitas).
- **S3 Merge drawing selalu memakai judul & primitif remote** — `syncpull.js:878`, `deepMerge preferRemote` → rename offline hilang meski perangkat lain hanya menambah coretan.
- **S4 `data_missing` permanen setelah record jadi dirty** — `mergeDirtyDrawing` tidak membersihkan flag; `refreshFromServer` butuh `!dirty` → gambar "Gagal memuat" selamanya.
- **S5 Reload iframe tldraw setelah merge menghapus coretan yang sedang digambar** — `index.html:9872-9894`, `App.jsx:266 loadSnapshot` (clear+put) di tengah debounce 600 ms.
- **S6 Path legacy drawing-dalam-note (`upsert`) menulis ke baris server yang salah** — `opDrawingUpsert` PUT `/api/drawings/{noteSid}`; server menganggapnya id drawing → menimpa drawing lain yang id-nya kebetulan sama atau 404.
- **S7 `list_id` mindmap dikirim saat create tapi diabaikan server** — `MindmapCreate` tanpa field; peta yang dibuat offline di list bersama jadi pribadi di server, lokal tetap mengira bersama.
- **S8 Tanggal check-in habit memakai hari lokal perangkat, sisanya hari Jakarta** — `index.html:14401-14419, 28052-28060` vs `habitlogic.js:12-15`, `webapp.py:117-119`.
- **S9 Timestamp campur: `datetime.now()` naive (zona host), `datetime('now')` (UTC, format spasi), Jakarta-aware** — klien `tsEpoch` (`syncpull.js:58-64`) menganggap tanpa zona = UTC. Bila zona VPS = Asia/Jakarta, edit server tampak 7 jam lebih baru → server selalu menang LWW. Format "2026-10-14 02:42:33" + "Z" → `NaN` di Safari/iOS → `0` → lokal selalu menang. Perbaikan: server selalu `datetime.now(timezone.utc).isoformat()`; normalisasi spasi→"T".
- **S10 Pesan chat pending diurutkan dengan string compare dari dua format waktu** — `chatrepo.js:128-133, 160-165`; reply ke pesan yang masih pending dibuang (`index.html:16687`).
- **S11 Versi app campur setelah deploy** — `sw.js:215-230` "/" stale-while-revalidate menimpa index.html di cache versi berjalan, modul `static/offline/*.js` cache-first → index.html baru + modul lama (kode sudah mengakui ini di `index.html:544-545`).
- **S12 Upgrade skema IndexedDB macet bila ada tab lain terbuka** — `db.js:108-129` tanpa `onversionchange`; semua `api.fetch` menggantung.
- **S13 Habit dihapus → log yatim tetap dihitung statistik** — `syncpull.js:207-211`, `habitquery.js:76-80`.
- **S14 Queue legacy `OfflineDB` memutar ulang body lama lewat router lokal** — `index.html:832 isOfflineErr` benar untuk error lokal apa pun saat offline → body note lama di-queue → diputar ulang berhari-hari kemudian menimpa versi terkini (`index.html:30340-30364`).
- **S15 `[tasklink:<cid>]` menanamkan cid lokal ke konten note** — `index.html:21292`; tidak ada rewrite ke server id setelah push → di perangkat lain "task tidak tersedia" selamanya; autosave juga membuang link ke task yang belum di-push (`:22729`).
- **S16 LWW tanpa salinan versi kalah** — baik sisi lokal maupun server yang kalah tidak disimpan di mana pun (hanya notice untuk note/mindmap, tidak ada untuk task).
- **S17 Duplikat sementara saat create note multi-perangkat** — `ensureNoteCid` (`syncpull.js:286-300`) tidak mencocokkan `s.client_id` dengan cid lokal.

## RENDAH
- `api.delete(...)` tidak ada (hanya `api.del`) → hapus note template selalu error (`index.html:18091, 18523`).
- Rute `/api/scratchpad/trash/{id}/restore` dkk. didefinisikan dua kali (`webapp.py:4433, 4550`), blok kedua dead code dengan predikat `user_id` berbeda.
- Kalender "un-done" memanggil `api.patch('/api/tasks/:id')` yang tidak ada (`index.html:12509`).
- Blob drawing bocor: hapus drawing yang belum pernah di-push meninggalkan tombstone + blob selamanya; 403 create menghapus record tapi tidak blob; tidak ada GC.
- `opDrawingCreate` mengabaikan `rec.deleted` → drawing yang dibuat lalu dihapus offline tetap di-POST lalu DELETE.
- `listDrawings` memanggil `/api/drawings` tanpa `X-TF-Sync` → bisa membaca cache SW basi.
- Lampiran note hanya pemilik (`webapp.py:4827, 4864`); anggota list tidak bisa lihat/unggah; upload dengan id cid → 422.
- `notehydrate.js`, `habithydrate.js ensureHabits` dead code; `habithydrate` memakai cid `srv-log-…` yang akan `ConstraintError` bila diaktifkan.
- Cache SW GET `/api/*` dipakai oleh jalur non-lokal (`/api/lists/:id/members`, `/files`, `/notifications`, `/api/auth/me`) → bisa bertindak atas data basi (mis. peran anggota). Isolasi multi-akun sudah dimitigasi `clearLocalUserData` (sisa risiko: respons in-flight ditulis setelah purge).
- Server: satu worker uvicorn, handler `async def` + sqlite sinkron → request terserialisasi di event loop; bukan bug sinkron tapi query lambat menahan SSE/chat semua orang.

---

## Pola akar masalah (ringkasan desain)
1. **Konflik berbasis jam dinding (LWW `updated_at`)** di tiga zona waktu/format berbeda, dan `updated_at` ikut berubah oleh proses non-pengguna (cron Eisenhower, `/share`, buka note). Solusi struktural: nomor revisi server per baris (`rev INTEGER`), PUT membawa `base_rev`, server 409 bila beda, klien merge per field / simpan salinan konflik.
2. **Outbox tidak membedakan error sementara vs permanen**, dan record bisa `dirty` tanpa op. Solusi: state mesin op (`pending → sent → failed_permanent`), 401/429/5xx/timeout = tahan; dependensi (create induk belum terkirim) = tahan.
3. **Pull belum "defensif"** di semua modul: cek status HTTP, konfirmasi 404 sebelum hapus lokal, jangan hapus massal dari daftar parsial.
4. **Pengelolaan sesi**: 401 ≠ ganti pengguna. Hapus data lokal hanya bila `user_id` berbeda; token kedaluwarsa cukup minta login ulang dan lanjut push.
5. **Editor yang memegang salinan** (NoteModal, tab mindmap, iframe tldraw) harus bereaksi pada pull (reload/merge) dan memverifikasi `base_rev` sebelum menyimpan.
6. **Idempotensi create** lewat `client_id` untuk semua entitas.

## Urutan perbaikan yang disarankan
1. K1 + K3 (sesi 401 & penanganan 4xx) — paling sering menghilangkan data, perbaikan kecil.
2. K6 (subtask/notes/lampiran kosong) — regresi yang terlihat pengguna, perbaikan 1 baris (hapus 3 rute lokal) + kirim `is_focused`.
3. K2 (cron jangan bump `updated_at`) + T1 (pull cek status).
4. K4 (`/share`), K5 (CAS mindmap), T4–T6 (autosave note).
5. T8, T9, T10, T11, T12 (recurring, habit, dependensi, idempotensi, renew).
6. T2/T3 + S9 (merge drawing 3-way, mindmap reload+409, timestamp UTC) — perubahan desain lebih besar.
