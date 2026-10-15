# Architecture Decision Records (ADR)

---

### ADR-001: Multi-Agent Synchronization Protocol
- **Date:** 2026-08-12
- **Agent:** Antigravity (Gemini 3.6 Flash)
- **Context:** Multiple AI agents (Claude, DeepSeek, Antigravity/Gemini) access this workspace across different sessions, causing context loss and duplicate work.
- **Decision:** Standardize multi-agent context via root entrypoints (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`) and a shared memory folder (`.agents/`).
- **Consequences:** All agents must read `.agents/CURRENT_STATE.md` at start and log changes to `.agents/SESSION_LOG.md` at end.

---

### ADR-002: Native Filesystem Storage for Tauri JWT Tokens
- **Date:** 2026-08-05
- **Agent:** Claude
- **Context:** Android WebView `localStorage` is not persistent across app restarts in Tauri mobile builds.
- **Decision:** Replaced `localStorage` token storage with native filesystem JWT storage via Rust `app_data_dir()` commands and frontend JS integration.

---

### ADR-003: Retention of tldraw v2.4.6 for Drawing Canvas
- **Date:** 2026-08-19
- **Agent:** Antigravity (Gemini 3.7 Flash)
- **Context:** Evaluated upgrading `tldraw` to v5.3.2. Version 3+ introduces watermarks ("Made with tldraw") for non-commercial/free use and requires re-vendoring of offline assets and snapshot schema migrations.
- **Decision:** Retain `tldraw` v2.4.6. It is completely stable, watermark-free, 100% offline-first with self-hosted assets in `draw-app/public/cdn/2.4.6/`, and has custom export overrides for PNG/SVG/JSON.


---

### ADR-004: Note Trash via snapshot table `trashed_notes` (bukan kolom `deleted_at`)
- **Date:** 2026-10-02
- **Agent:** Claude
- **Context:** Fitur Sampah note butuh hapus yang bisa dipulihkan 30 hari. ±30 query di `webapp.py` membaca `scratchpad_notes` (list, search, titles, backlinks, halaman publik, export, bot); soft-delete lewat kolom memaksa semua query difilter dan satu yang terlewat membocorkan note terhapus.
- **Decision:** Hapus tetap menghapus dari `scratchpad_notes` (cascade lama tidak berubah), tetapi dalam transaksi yang sama menulis snapshot JSON (semua kolom + tag + pin + publish + lampiran) ke `trashed_notes`. Restore memasukkan kembali dengan id asli. Purge lazy setelah `NOTE_TRASH_RETENTION_DAYS = 30`. Endpoint `/api/scratchpad/trash*` hanya online (router lokal & SW tidak melayaninya). Spec: `docs/superpowers/specs/2026-10-02-note-trash-design.md`.
- **Consequences:** Query lama tidak tersentuh. Klien: setelah restore buang op outbox `delete` tertunda (`noterepo.discardPendingDelete`) dan pull memperbarui `linked_to_cids` basi. Keterbatasan: perangkat lain yang mengedit note saat note dihapus membuat salinan baru (POST setelah PUT 404) → setelah restore ada 2 note. File lampiran Nextcloud tidak dibersihkan saat hapus permanen (perilaku lama). Deploy wajib restart service agar `migrate_db()` membuat tabel.


---

### ADR-005: Pesan Pribadi (DM) di tabel terpisah, tanpa ikatan ke shared list
- **Date:** 2026-10-03
- **Agent:** Claude
- **Context:** Diskusi hanya mendukung chat grup (`messages.list_id`). Pemilik produk ingin DM 1-on-1; memulai hanya dengan sesama anggota grup (anti-spam), tetapi percakapan tetap aktif walau keduanya tidak lagi satu grup.
- **Decision:** Tabel baru `dm_conversations` (pasangan ternormalisasi `user_a < user_b`, UNIQUE), `dm_messages`, `dm_reads` (penanda baca per user = `last_read_id`). Cek berbagi grup hanya saat membuat percakapan baru; akses berikutnya hanya cek peserta (404 untuk selainnya). Tidak ada FK ke `shared_lists`. Endpoint `/api/dm/*` online-only (SW network-only, tidak ada rute lokal, tidak memakai chatrepo). Notifikasi in-app ditahan bila penerima subscribe SSE percakapan (`dm_subscribers` menyimpan `(user_id, queue)`), dan tidak diduplikasi selama notifikasi identik belum dibaca. Spec: `docs/superpowers/specs/2026-10-03-direct-messages-design.md`.
- **Consequences:** Hapus/keluar grup tidak memengaruhi DM; hapus akun menghapus DM-nya (CASCADE). `dm_subscribers` per proses — dengan beberapa worker uvicorn, SSE & penahanan notifikasi hanya akurat dalam worker yang sama (sama seperti chat grup). Deploy wajib restart service.
- **Addendum 2026-10-04 (Blokir):** tabel `dm_blocks (blocker_id, blocked_id)` per pasangan user (bukan per percakapan). Blokir dari salah satu pihak menolak kirim kedua arah (403 "Obrolan ini diblokir", tanpa notifikasi/SSE) dan menolak percakapan BARU; percakapan lama tetap dikembalikan & riwayat tetap terbaca. Buka blokir hanya menghapus blokir milik sendiri.

---

### ADR-006: Outbox dengan klasifikasi error, CAS/rev per record, `base_rev`/409 + salinan konflik, `client_id` idempoten
- **Date:** 2026-10-15
- **Agent:** Claude
- **Context:** Audit offline/sync (`docs/superpowers/specs/2026-10-15-offline-sync-audit.md`) menemukan kehilangan data diam-diam: token kedaluwarsa menghapus IndexedDB + outbox; push membuang op pada semua 4xx lalu pull menimpa record dirty; LWW berbasis `updated_at` (jam dinding, 3 format/zona) dikalahkan oleh proses non-pengguna (cron Eisenhower, `/share`, membuka note); record ditulis dari objek pra-request (edit in-flight hilang); POST tanpa idempotensi menggandakan task/habit/mindmap/pesan.
- **Decision:** (1) 401 = sesi berakhir, bukan ganti pengguna: data lokal dipertahankan, push setelah login ulang. (2) Respons push diklasifikasikan: jaringan/401/429/5xx → op tetap; 403 → `conflict:"access_lost"`; 404 → `conflict:"remote_deleted"`; 4xx lain → op dibuang + `record.sync_error` dan ditampilkan di conflict bar (Coba lagi / Buang). Record `dirty` tanpa op diantre ulang oleh pull, tidak ditimpa. (3) Setiap record punya `rev` (naik di tiap tulis lokal); semua tulis setelah jeda async lewat `TFdb.mutate` (satu transaksi baca-ubah-tulis); push menandai bersih hanya bila `rev` tidak berubah (`markPushed`). (4) PUT task/note/mindmap/drawing membawa `base_rev` opsional; server menjawab 409 `{"detail":{"code":"REV_MISMATCH","current":<row>}}` bila beda. Untuk note & mindmap konflik edit-vs-edit (409 atau pull) TIDAK memakai LWW: versi lokal disimpan sebagai entitas pribadi baru "(konflik) <judul>" (client_id baru), record asli mengadopsi server + notice `conflict_copy`; tidak dibuat bila isinya sama. Task tetap LWW (field kecil), drawing memakai three-way merge dengan `base_blob_ref`. (5) Semua create mengirim `client_id` (= cid); server mengembalikan baris yang ada bila `(user_id, client_id)` cocok (index unik parsial). (6) `updated_at` hanya berubah oleh edit pengguna: kuadran cron ditulis tanpa bump; klien mengadopsi field turunan (`quadrant`, `recurrence_end_date`, `recurrence_notif_level`, `completed_at`) terpisah. (7) Pull defensif: cek status HTTP, tiap langkah terisolasi (push selalu jalan), hapus lokal hanya setelah GET per item 404, tulis lewat CAS.
- **Consequences:** Pengguna bisa melihat lebih banyak item di conflict bar (sync_error, access_lost, salinan "(konflik)") — itu disengaja: tidak ada lagi kehilangan diam-diam. Klien lama (modul SW lama) tetap kompatibel: `base_rev`/`client_id` opsional di server. Rev/`client_id` mengubah bentuk record IndexedDB (tanpa migrasi skema; field baru opsional). SW `/` hanya di-cache bila versi index.html = versi SW (S11). Sisa: server masih `datetime.now()` naive (S9) — perubahan ke UTC disarankan sebagai ADR terpisah.
