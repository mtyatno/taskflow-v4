# Rencana: Perbaikan Audit Offline & Sinkronisasi (2026-10-15)

Sumber temuan: `docs/superpowers/specs/2026-10-15-offline-sync-audit.md` (K1–K6, T1–T13, S1–S17). Branch `claude/sync-audit-fixes`, SW target **v412** `taskflow-v412-sync-audit-fixes` (bump hanya di workstream E, terakhir).

Prinsip desain yang disepakati untuk semua workstream:

1. **Tidak ada penghapusan data lokal yang diam-diam.** Setiap jalur yang dulu `deleteXRaw`/`dropOutbox`/timpa harus berakhir di salah satu: (a) data terkirim, (b) record ditandai `conflict`/`sync_error` dan muncul di conflict bar, atau (c) salinan konflik dibuat sebagai entitas baru.
2. **Record `dirty` tanpa op outbox adalah bug.** Pull tidak boleh menimpa record `dirty`; ia harus mengantrekan ulang op (self-heal) kecuali record punya `sync_error` (lalu dilewati dan ditampilkan ke pengguna).
3. **Klasifikasi respons push** (helper bersama di `syncpush.js`):
   - jaringan putus / timeout berulang → berhenti, op tetap;
   - **401** → berhenti, op tetap, `window.dispatchEvent(new CustomEvent("tf:auth-expired"))`;
   - **429 / 5xx** → op tetap, lanjut op lain;
   - **403** → `conflict: "access_lost"` (bukan hapus);
   - **404** pada update → `conflict: "remote_deleted"` (bukan hapus; drawing/mindmap/note pribadi boleh re-create seperti sekarang bila sudah demikian);
   - **400/409(non-rev)/413/422** → op dibuang, record tetap `dirty`, `sync_error: {status, detail, at}`; conflict bar menawarkan "Coba lagi" (hapus `sync_error`, antre op lagi) / "Buang perubahan lokal" (ambil versi server).
4. **CAS/rev untuk semua entitas yang di-push** (task, note, habit, mindmap; drawing sudah): record punya `rev` (naik di setiap tulis lokal). Push membaca `sentRev` sebelum request dan setelah sukses memakai `TFdb.mutate(store, cid, fn)` (satu transaksi readwrite baca-ubah-tulis): `dirty = (cur.rev === sentRev) ? 0 : 1`, `base_rev` hanya maju, `server_id` diisi bila kosong. Tidak pernah menulis objek yang dibaca sebelum request.
5. **Pull defensif**: cek `res.ok` (throw bila tidak); tiap langkah pull di `sync()` terisolasi (`catch` per langkah) dan push selalu dijalankan di akhir; hapus lokal hanya setelah GET per item mengembalikan **404 eksplisit** (pola drawing) untuk task, note, mindmap; habit cukup bila daftar `ok`.
6. **Idempotensi create**: semua payload create mengirim `client_id: rec.cid`; server mengembalikan baris yang sudah ada bila `(user_id, client_id)` cocok.
7. **Konflik edit-vs-edit**: untuk note & mindmap, sisi yang kalah **tidak dibuang** — dibuat salinan konflik (entitas baru pribadi, judul `"(konflik) <judul>"`, `client_id` baru) + notice. Server menerima `base_rev` opsional pada PUT note/mindmap/task/drawing dan menjawab **409** bila `updated_at` saat ini ≠ `base_rev` (body: `{"detail": {"code": "REV_MISMATCH", "current": <row>}}` — klien membaca `body.detail.code`).
8. Timestamp: klien `tsEpoch` menormalkan `"YYYY-MM-DD HH:MM:SS"` → `"T"`; server tidak mengubah format (di luar cakupan), tetapi **tidak boleh** mem-bump `updated_at` untuk perubahan non-pengguna (kuadran).

## Workstream A1 — Ketahanan sinkron (klien) — SELESAI (commit 1fd4e75)
File: `static/offline/syncpush.js`, `syncpull.js`, `listsync.js`, `syncconflict.js`, `static/index.html` (bagian API helper/Sync Transport baris ±385–832, `api.fetch` 401 ±569, `logout` ±29993, `tryAuth` ±30044–30075, `handleLogin` ±30560).
- K1: 401 ≠ ganti pengguna. `tryAuth` 401 → **jangan** `clearLocalUserData`; hapus token, tampilkan login, toast "Sesi berakhir — masuk lagi; perubahan offline tetap tersimpan dan akan dikirim." `api.fetch` 401 → panggil handler yang sama (jangan `tokenStore.clear()` sebelum `__logout`; `logout()` normal tetap seperti sekarang untuk logout manual). `handleLogin` dengan `tf_user_id` sama → jangan clear, lalu panggil `window.__syncNow()`. Listener `tf:auth-expired` → handler yang sama.
- K3 + T13: klasifikasi respons (prinsip 3) untuk SEMUA op di `processOp`; helper `markSyncError(store, cid, res)`; `syncconflict.listConflicts` memasukkan `sync_error` (entity task/note/mindmap/habit/drawing) dan `resolveConflict(entity,cid,"retry"|"discard_local")`; `renderConflicts` di index.html menampilkan teks & tombolnya. `healStranded*` dan `ensureDrawingUpdateOp` di pull melewati record dengan `sync_error`.
- Prinsip 2: di `pullTasks/pullNotes/pullMindmaps/pullHabits`: `local.dirty && !pending && !sync_error` → antre op (`create` bila `server_id == null`, else `update`) dan **jangan timpa**.
- T1 + prinsip 5: cek status di semua `pull*AndReconcile` (+ `listsync`); `sync()` per-langkah terisolasi; konfirmasi 404 per item sebelum hapus lokal (task `GET /api/tasks/:id`, note `GET /api/scratchpad/:id`, mindmap sudah ada `fetchOne`).
- S9 klien: `tsEpoch` normalisasi spasi → `T`.
- S14: error yang dilempar router lokal diberi `err.__local = true`; `isOfflineErr` mengembalikan `false` untuk error `__local`.
- S17: `ensureNoteCid` mencocokkan `s.client_id` dengan cid lokal (seperti `ensureDrawingCid`).
- Tes: `tests/offline/syncpush.test.js`, `syncpull.test.js`, `syncconflict.test.js` (+ baru `sync_robustness.test.js`) mencakup: 401 menahan op; 422 → sync_error + conflict bar + retry; dirty tanpa op → requeue bukan timpa; pull 503 tidak menghapus; hapus lokal hanya setelah 404.

## Workstream B — Server (`webapp.py`, `repository.py`, `tests/test_*.py`) — SELESAI (commit 7827679)
- K2: `repository.update_quadrant` dan `POST /api/recalculate` tidak lagi menulis `updated_at` (kuadran = field turunan). Cari pemicu non-pengguna lain yang mem-bump `updated_at` (notif level recurring, dsb.) dan perlakukan sama.
- K4: `PATCH /api/scratchpad/{id}/share` mem-bump `updated_at`; `ScratchpadUpdate.list_id` hanya diterapkan bila ada di `model_fields_set` (absen = tidak berubah).
- K6: `TaskUpdate.is_focused: Optional[bool]` diterapkan di PUT.
- T11: kolom `client_id TEXT` + unique partial index `(user_id, client_id)` untuk `tasks`, `habits`, `mindmaps` (migrasi di `migrate_db`, pola drawings baris ±458–466); `TaskCreate/HabitCreate/MindmapCreate.client_id` → bila sudah ada baris dengan `(user_id, client_id)` kembalikan baris itu (200, bukan insert). `POST /api/lists/{id}/messages`: bila `client_id` ada dan pesan `(list_id, user_id, client_id)` sudah ada → kembalikan yang ada. DM `POST` serupa bila mudah.
- T7: tag note berskop note: PUT menghapus semua `entity_tags` note itu (bukan hanya milik editor) lalu upsert di bawah `user_id` **pemilik** note; `_scratchpad_row` memakai `DISTINCT`.
- S7: `MindmapCreate.list_id` (cek keanggotaan) disimpan.
- Prinsip 7: `base_rev: Optional[str]` pada `TaskUpdate`, `ScratchpadUpdate`, `MindmapUpdate`, `DrawingUpdate` → 409 `{"detail": {"code":"REV_MISMATCH","current":<row dict>}}` bila `base_rev` dikirim dan ≠ `updated_at` saat ini.
- Hapus blok rute trash duplikat (±4550, dead code); pastikan `tests/test_note_trash.py::test_delete_is_atomic_when_snapshot_fails` lulus (gagal di baseline).
- Tes pytest untuk setiap poin (idempotensi client_id, 409, share bump, quadrant tidak bump, tag note, is_focused).

## Workstream A2 — Kebenaran data task/habit/recurring (klien, setelah A1)
File: `static/offline/db.js` (helper `mutate`), `taskrepo.js`, `taskroutes.js`, `habitrepo.js`, `noterepo.js` (hanya `rev`), `recurrence.js`, `syncpush.js`, `syncpull.js`, `hydrate.js`, tes terkait.
- Prinsip 4: `TFdb.mutate`; `rev` pada task/note/habit (+log); push task/note/habit memakai CAS (K5 untuk mindmap dikerjakan D dengan helper yang sama). Setelah PUT/POST task sukses adopsi field turunan server dari `res.data` (`quadrant`, `recurrence_end_date`, `completed_at`, `updated_at`→`base_rev`) tanpa menimpa field yang berubah sejak `sentRev`.
- K6: `taskToUpdatePayload` mengirim `is_focused`; rute lokal `GET /api/tasks/:id/subtasks|notes|attachments` hanya dilayani lokal (→ `[]`) bila id **bukan** angka (task belum tersinkron); id numerik diteruskan ke jaringan (`shouldRouteLocally`).
- T12: `recurrence_renew` → flag `recurrence_renew_pending` di record, dikirim sebagai `recurrence_renew: true` di PUT, dihapus setelah sukses.
- T10: op yang bergantung (`opHabitCheckin/opHabitUncheck/opMark`, `opCreate` dengan `parent_cid`, `opChatSend` reply) **ditahan** (`return;`) bila server id belum ada **dan** masih ada op `create` untuk cid induk di outbox; hanya dibuang bila induk memang tidak ada.
- T11 klien: `client_id: rec.cid` di payload create task/habit/mindmap.
- T8: `pullRecurringExceptions(rawFetch)` (jendela −60..+60 hari, `/api/recurring/exceptions?from=&to=`) ditambahkan ke `sync()` setelah tasks; rekonsiliasi per `(task_cid, occurrence_date)`: op lokal pending menang; hapus entri lokal non-dirty dalam jendela yang absen di server.
- T9 + S13: `pullHabitLogs` menghapus log lokal `dirty:0` dalam jendela 90 hari yang absen di server; log dirty yang statusnya sama dengan server → `dirty:0`; hapus habit (lokal & dari pull) ikut menghapus log `habit_cid`-nya; `getHabitsMonthly` hanya menghitung habit yang masih ada.
- S8: tanggal check-in dari UI memakai hari Jakarta (`habitlogic.todayJkt`) — ubah pemanggil di index.html (±14401–14419, ±28052–28060) bila mudah, atau biarkan `habitrepo` yang memaksa.
- S1: 403 → `conflict:"access_lost"` untuk task/note/mindmap/drawing (bukan hapus); `resolveConflict` menawarkan `keep_as_personal` (list_id=null, antre create baru dengan client_id baru) / `discard`.
- Low: `opDrawingCreate` menghormati `rec.deleted`; kalender un-done `api.patch('/api/tasks/:id')` → `api.put` (index.html ±12509).

## Workstream C — Editor note (setelah A2)
File: `static/index.html` (NoteModal ±22100–23100, NotePanel, share ±22393/24340, template ±18091/18523), `noterepo.js`, `noteroutes.js`, bagian note di `syncpush.js`/`syncpull.js`.
- T4: autosave tidak jalan pada render pertama; simpan hanya bila berbeda dari snapshot terakhir yang disimpan/dimuat; `noterepo.updateNote` menggabungkan op `update` tertunda per cid (hapus op lama, tambah baru — aman karena CAS rev).
- T5: NoteModal menyimpan `loadedBaseRevRef`; sebelum setiap autosave baca record lokal; bila `base_rev` lokal ≠ yang dimuat dan editor **tidak** dirty → muat ulang konten; bila dirty → tampilkan banner yang sudah ada ("Muat perubahan" / "Simpan versi saya" → membuat salinan konflik dari versi server). `lastKnownAtRef` diperbarui setelah autosave sendiri. `sync()` mengirim `noteSaved` dengan `detail.cids` yang berubah; NoteModal mendengarkan untuk note pribadi juga. Poll 5 detik untuk note bersama membaca server (`__syncRawFetch`), bukan router lokal.
- Prinsip 7: `noteToUpdatePayload` menyertakan `base_rev`; 409 → buat salinan konflik lokal (note baru pribadi `"(konflik) <judul>"` berisi versi lokal, `client_id` baru, antre create) lalu adopsi versi server ke record asli; `pullNotes` cabang server-wins melakukan hal yang sama alih-alih hanya notice.
- T6: hapus guard `navigator.onLine` di autosave; flush autosave saat modal ditutup bila dirty.
- K4 klien: setelah PATCH `/share` sukses, tulis `list_id` + `updated_at`→`base_rev` ke record lokal (`noterepo.adoptServerFields(cid, row)`); `pullNotes` mengadopsi `list_id` walau `updated_at` sama.
- S15: setelah create task sukses (`opCreate`), ganti `[tasklink:<cid>]` → `[tasklink:<sid>]` di semua note lokal yang memuatnya (tandai dirty + antre update); autosave tidak lagi membuang link ke task ber-cid (`linked_task_ids` boleh berisi cid; `noterepo` menyimpannya di `linked_task_cids`).
- Low: `api.delete` → `api.del` (±18091, ±18523).

## Workstream D — Mindmap & Drawing (setelah A2, paralel dengan C)
File: `mindmaprepo.js`, `drawingrepo.js`, bagian mindmap/drawing di `syncpush.js`/`syncpull.js`, `index.html` tab mindmap (±9064–9128), `sync()` event mindmap (±733), `draw-app/src/App.jsx`.
- K5: `rev` + CAS (`TFdb.mutate`) untuk mindmap create/update; `dedupeUpdates` aman karena CAS.
- T3: pull mindmap mengirim event `mindmapSynced {cids}`; tab yang tidak dirty memuat ulang `data_json`; `mindmapToUpdatePayload` menyertakan `base_rev`; 409 → salinan konflik (`"(konflik) <judul>"`, client_id baru) + adopsi server; `pullMindmaps` server-wins juga membuat salinan konflik, bukan notice saja.
- T13: drawing 4xx permanen → `sync_error` (helper A1); `healStrandedDrawings`/pull tidak mengantre ulang record `sync_error`.
- S2: PUT drawing 404 → `conflict:"remote_deleted"` (pull melewati record conflict); `resolveConflict` mendukung entity `drawing` (`discard` / `keep_as_new` dengan client_id baru).
- S4: `mergeDirtyDrawing` menghapus `data_missing` saat blob ditulis.
- T2: three-way merge: simpan `base_blob_ref` (snapshot pada `base_rev`) saat mengadopsi data server / setelah push sukses; `mergeDrawingSnapshots(local, remote, base)`: record ada di base tapi hilang di satu sisi dan tidak berubah di sisi lain → dihapus; hilang di satu sisi tapi berubah di sisi lain → dipertahankan; tanpa base → perilaku union lama. Blob base lama dibuang saat diganti. Tes: skenario "hapus di A, coret di B" tidak menghidupkan shape.
- S3: judul: pilih sisi yang berbeda dari base (bila base ada), bukan selalu remote.
- S6: `opDrawingUpsert`/jalur `note_cid` legacy: konversi record menjadi drawing standalone (`note_cid` dihapus, `server_id null`, antre create dengan client_id) alih-alih PUT ke `/api/drawings/{noteSid}`.
- S5 (opsional bila waktu): `App.jsx` menerapkan snapshot masuk sebagai diff dan menunda saat pointer ditekan / `userRev !== sentRev`.
- Low: blob dibuang saat drawing yang belum pernah di-push dihapus; 403 create membuang blob.

## Workstream E — Penutup
- Bump SW v412 di `static/sw.js`, fallback `static/index.html`, `webapp.py sw_cache`, `tests/test_version.py`, semua string cache di `tests/offline/*.test.js`; `app.css?v=` hanya bila CSS berubah.
- `node temporary_files/check_inline_scripts.js static/index.html`, `node --check` modul yang diubah, `node --test tests/offline/*.test.js`, `python -m pytest tests/ -q`, `git diff -U0 | grep -iE "border-?left"` = 0.
- Review kode oleh agen terpisah; perbaiki temuan.
- `.agents/CURRENT_STATE.md`, `SESSION_LOG.md`, `DECISIONS.md` (ADR-006: klasifikasi error outbox + CAS rev + base_rev/409 + salinan konflik), lalu PR (draft) — tunggu "merge dan deploy".
