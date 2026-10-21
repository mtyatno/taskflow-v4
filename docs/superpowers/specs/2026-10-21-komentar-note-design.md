# Komentar level halaman untuk note — desain

Tanggal: 2026-10-21 · Basis: `main` `50d0e24c` (SW v439, IndexedDB v5)
Mockup UI disetujui: kanvas "Komentar Note Alurik" (Desktop prototipe, Mobile, Keadaan khusus).

## 1. Tujuan dan cakupan

Anggota workspace bisa meninjau note bersama lewat komentar tanpa mengubah isinya, dan pemilik note bisa melihat, menindaklanjuti, dan menyelesaikan masukan itu — termasuk saat offline (Alurik local-first).

**Dalam cakupan:** komentar umum dan komentar berkutipan (potongan teks) pada note yang sedang dibagikan ke workspace; satu tingkat balasan; Selesaikan/Buka lagi; edit dan hapus; @mention; notifikasi in-app + Telegram; live update via SSE; sinkron offline penuh; badge jumlah komentar di daftar catatan.

**Di luar cakupan:** permission per halaman / note readonly (spec terpisah sesudah ini); komentar di note pribadi; reaksi emoji; lampiran di komentar; fuzzy re-anchoring; komentar di halaman publish, ekspor DOCX/MD, atau pencarian global; komentar di mindmap/drawing/task.

## 2. Data

### 2.1 Skema (migrasi idempoten di `migrate_db()`)

```sql
CREATE TABLE IF NOT EXISTS note_comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id     INTEGER NOT NULL,              -- tanpa FK: bertahan saat note ke Sampah (restore memakai id sama)
  list_id     INTEGER NOT NULL,              -- workspace note saat komentar dibuat
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id   INTEGER DEFAULT NULL,          -- NULL = thread; isi = balasan (selalu id thread, satu tingkat)
  body        TEXT NOT NULL,                 -- teks polos, 1–4000 karakter setelah trim
  quote       TEXT DEFAULT NULL,             -- teks polos ≤ 500 karakter; NULL = komentar umum; hanya di thread
  resolved_at TEXT DEFAULT NULL,
  resolved_by INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL,
  edited_at   TEXT DEFAULT NULL,
  deleted_at  TEXT DEFAULT NULL,             -- soft delete (tombstone untuk pull)
  client_id   TEXT DEFAULT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL                  -- kursor pull; di-bump oleh setiap perubahan
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_note_comments_client ON note_comments(user_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_note_comments_note ON note_comments(note_id, list_id, created_at);
CREATE INDEX IF NOT EXISTS idx_note_comments_updated ON note_comments(updated_at, id);

CREATE TABLE IF NOT EXISTS note_comment_reads (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id      INTEGER NOT NULL,
  last_read_at TEXT NOT NULL,
  PRIMARY KEY (user_id, note_id)
);

ALTER TABLE notifications ADD COLUMN note_id INTEGER DEFAULT NULL;  -- bila belum ada
```

Waktu disimpan ISO dengan zona Jakarta (`datetime.now(_TZ_JKT).isoformat()`), sama dengan tabel lain.

### 2.2 Siklus hidup

| Kejadian | Efek pada komentar |
|---|---|
| Note dihapus → Sampah | Baris tetap; tidak terlihat (join ke `scratchpad_notes` gagal) |
| Note di-restore | Terlihat lagi (id note sama) |
| Note di-purge / Sampah dikosongkan | `DELETE FROM note_comments WHERE note_id IN (…)` + `note_comment_reads` |
| Note di-unshare (`list_id` → NULL) | Tersembunyi |
| Note di-share ulang ke workspace yang sama | Terlihat lagi |
| Note di-share ke workspace lain | Komentar lama tetap tersembunyi (`c.list_id ≠ n.list_id`) |
| Workspace dihapus | Note kembali pribadi → tersembunyi. Baris komentar dengan `list_id` itu dihapus di transaksi hapus workspace |
| Anggota keluar/dikeluarkan | Komentarnya tetap atas namanya; ia kehilangan akses baca |
| Soft delete > 30 hari | Dibersihkan permanen di `migrate_db()` (berjalan tiap deploy/start). Kursor `since` yang lebih tua dari 30 hari dijawab `{"reset": true}` → klien mengosongkan komentar lokal yang tidak `pending` lalu menarik ulang dari awal (§6.4), sehingga tombstone yang sudah dibersihkan tidak meninggalkan komentar basi |

### 2.3 Visibilitas (satu helper, dipakai semua endpoint)

`note_comments.visible_clause(uid)` (dan `note_comments.visible_note` untuk satu note) — komentar `c` terlihat bila ada note `n` dengan `n.id = c.note_id`, `n.list_id IS NOT NULL`, `n.list_id = c.list_id`, dan `n` lolos `_note_access_clause(uid, "n")`.

## 3. Hak akses

| Aksi | Siapa |
|---|---|
| Lihat, tulis thread, balas | Siapa pun yang lolos visibilitas; note harus sedang di workspace |
| Edit isi | Penulis komentar itu |
| Selesaikan / Buka lagi (thread saja) | Penulis thread + pemilik note |
| Hapus (thread → ikut balasannya) | Penulis komentar itu + pemilik note |

Semua dicek di server; klien hanya menyembunyikan tombol yang tidak berhak.

## 4. API

Semua memerlukan login. Ukuran dan format diperiksa di model Pydantic.

| Metode & path | Fungsi |
|---|---|
| `GET /api/note-comments?since=&limit=` | Delta pull global. `since` = kursor `"<updated_at>|<id>"` (kosong = dari awal), `limit` default 500, maks 1000. Urut `(updated_at, id)`. Mengembalikan `{items, cursor, more}`; `items` termasuk tombstone (`deleted_at` terisi, `body` dikosongkan). Kursor > 30 hari → `{"reset": true}`. Kursor bisa maju tanpa item: kursor halaman terakhir = `ts\|id` item terbaru bila ≥ now − 5 menit, selain itu `now − 5 menit\|0`; tidak pernah mundur; `reset` hanya berarti klien tidak sinkron > 30 hari; komentar yang terlihat lagi (restore, share ulang, bergabung ke workspace) di-bump `updated_at`-nya. |
| `GET /api/scratchpad/{id}/comments` | Semua komentar terlihat milik satu note, tanpa tombstone |
| `POST /api/scratchpad/{id}/comments` | `{body, quote?, parent_id?, client_id?}` → baris baru. `client_id` yang sudah ada → kembalikan baris lama (200). `parent_id` yang menunjuk balasan → diratakan ke thread induknya. `quote` diabaikan pada balasan |
| `PATCH /api/note-comments/{cid}` | `{body}` (edit, isi `edited_at`) **atau** `{resolved: bool}` (thread saja) |
| `DELETE /api/note-comments/{cid}` | Soft delete; thread → balasannya ikut. Idempoten (sudah terhapus → 200) |
| `POST /api/scratchpad/{id}/comments/read` | Upsert `last_read_at = now` |
| `GET /api/scratchpad/{id}/comments/stream` | SSE sinyal saja (§5.3) |

**Bentuk satu komentar:** `{id, note_id, list_id, parent_id, user_id, username, display_name, body, quote, resolved_at, resolved_by, resolved_by_name, edited_at, deleted_at, client_id, created_at, updated_at}`.

**Kode error:** note tidak ada / tidak bisa diakses / komentar tidak terlihat → 404; note pribadi → 409 `{"code":"NOTE_NOT_SHARED"}`; tidak berhak edit/selesaikan/hapus → 403; body kosong/terlalu panjang → 422.

**Field turunan di `GET /api/scratchpad` (daftar) dan `GET /api/scratchpad/{id}`:** `comment_open_count` (thread belum selesai dan belum dihapus) dan `comment_unread` (ada komentar terlihat dari user lain dengan `created_at > last_read_at`, atau belum pernah dibaca). Dihitung lewat subquery; **tidak mengubah `updated_at` note**. Note pribadi → `0` / `false`.

Komentar tidak disertakan di `/pub`, ekspor DOCX/MD, `/api/search`, backlink, maupun snapshot Sampah.

## 5. Notifikasi dan live update

### 5.1 Penerima

- **Thread baru:** pemilik note + yang di-@mention.
- **Balasan:** peserta thread (penulis thread + semua yang pernah membalas, kecuali komentar yang sudah dihapus) + yang di-@mention.
- **Diselesaikan:** penulis thread, bila yang menyelesaikan orang lain.
- Selalu: pengirim tidak dinotifikasi; satu orang paling banyak satu notifikasi per kejadian; hanya pemilik/anggota workspace note saat itu yang bisa menerima.
- Edit, Buka lagi, dan hapus tidak menghasilkan notifikasi. Edit yang menambah @mention baru **tidak** mengirim notifikasi (YAGNI).

@mention di-parse dengan regex chat `@(\w+)` terhadap `username`.

### 5.2 Pesan

Teks (di-escape `_esc_msg`, kutipan isi dipotong 80 karakter):
- `{nama} menyebutmu di {judul}: "{isi}"`
- `{nama} mengomentari catatanmu {judul}: "{isi}"`
- `{nama} membalas komentar di {judul}: "{isi}"`
- `{nama} menyelesaikan komentarmu di {judul}`

Prioritas jenis bila seseorang memenuhi beberapa syarat: menyebut > mengomentari > membalas. Disimpan ke `notifications` dengan `list_id` dan `note_id`, lalu dikirim ke Telegram bila akun terhubung — lewat helper baru `_notify_users_bg(user_ids, message, list_id, note_id)` yang dibuat dari pola `_notify_members_bg` (berjalan di background setelah commit; kegagalan diabaikan).

### 5.3 SSE

`note_comment_subscribers: dict[int, set[tuple[int, asyncio.Queue]]]`, pola `mindmap_subscribers`: endpoint stream memeriksa akses saat berlangganan, dan `_note_comment_broadcast(note_id, event)` memeriksa ulang akses tiap pelanggan. Event berisi sinyal saja: `{"type":"comments_changed","note_id":…}`. Klien merespons dengan delta pull. Heartbeat dan pembersihan antrean mengikuti endpoint mindmap stream.

## 6. Offline

### 6.1 Penyimpanan

- `DB_VERSION` 5 → 6. Store baru `note_comments` (keyPath `cid`, sama dengan entity store lain), index `by_note_cid`.
- Record: field server + `cid`, `note_cid`, `parent_cid`, `pending` (`null` | `"create"` | `"edit"` | `"resolve"` | `"delete"`), `sync_error` (`null` | `{code, message}`).
- `_idmap` entitas `"comment"`. Kursor pull di `_meta` kunci `comments_cursor`.

### 6.2 Modul baru (UMD, `window.TF.*` + `module.exports`)

- `static/offline/commentrepo.js`: `listForNote(noteCid, noteListId)` (hanya record dengan `list_id` sama dengan `list_id` note saat ini, supaya cache komentar workspace lama tidak tampil setelah note dipindah), `threads(records, {tab})` (thread + balasan urut `created_at`, tab `open`/`done`), `counts(records, uid, lastReadAt)`, `create/reply/edit/resolve/remove` (tulis lokal + outbox), `mergePulled(items)`, `parts(body)` (pecah @mention).
- `static/offline/commentanchor.js`: `findQuote(docText, quote) -> {from, to} | null` — cocok persis; kalau gagal, cocok setelah normalisasi (spasi beruntun jadi satu, kutip lengkung → lurus, trim). Banyak kecocokan → yang pertama. Murni, tanpa DOM.
- `static/offline/commentroutes.js`: daftarkan endpoint §4 di router lokal (`GET` per note dan `POST/PATCH/DELETE`), membalas dari repo lokal.

### 6.3 Push (`syncpush.js`, op `entity_type: "comment"`)

- Ketergantungan: op menunggu sampai note punya server id di `_idmap("note")`, dan balasan menunggu thread induknya terkirim (pola `reply_to_id` chat).
- Peleburan sebelum kirim: edit/resolve pada komentar yang `pending:"create"` masuk ke payload create; hapus pada `pending:"create"` → op dibuang, record lokal dihapus, tanpa request.
- Hasil: 2xx → bersihkan `pending`, isi field server, `_idmap` diisi. 404/403/409 → record diberi `sync_error`, op dibuang, komentar **tidak** dihapus (UI: kartu "Gagal terkirim" dengan Salin teks / Buang); tidak memakai alur `access_lost` note. 422 → sama, pesan "Komentar tidak valid". 5xx/jaringan → backoff outbox yang ada.

### 6.4 Pull (`syncpull.js`)

Ikut `fullSync` (berkala 30 detik dan saat online) serta sinyal SSE: ulangi `GET /api/note-comments?since=` sampai `more:false`, simpan kursor. Respons `{"reset": true}` → hapus semua record lokal yang tidak `pending`, kosongkan kursor, tarik ulang. Tombstone → hapus record lokal. Record lokal yang `pending` tidak ditimpa. Komentar milik note yang belum ada di lokal tetap disimpan (note datang di pull note).

### 6.5 Tambahan hasil implementasi (PR 2)

- **Penanda baca lokal:** `_meta` kunci `comment_reads` (`note_cid → waktu baca`), di-seed dari `comment_unread` saat pull note, sehingga badge belum-dibaca tetap benar offline; perbandingan waktu memakai `Date.parse` (epoch), bukan string, karena waktu lokal berakhiran `Z` sedangkan server `+07:00`.
- **`server_copy` untuk rollback:** record `pending` menyimpan salinan keadaan server terakhir (`server_copy`). Bila op ditolak (`sync_error`), perubahan dikembalikan ke `server_copy`; `pending` dan `server_copy` dikosongkan saat revert.
- **Create ditahan:** op create komentar ditahan selama masih ada op note untuk note itu di antrean (note harus sampai ke server lebih dulu).
- **Body di-trim seperti server:** `create`/`edit` menyimpan body yang sudah di-trim, dan push membandingkan dengan body yang dikirim, sehingga spasi di tepi tidak memicu PATCH palsu / tanda "diedit".
- **Perubahan lokal setelah `sync_error` = coba lagi:** `sync_error` dikosongkan dan op untuk jenisnya dipastikan ada (jalur create: op create dimasukkan lagi), karena push membuang op saat gagal permanen.
- **Adopsi lewat `client_id`:** bila pull membawa komentar yang cocok dengan create lokal, record diadopsi; body/resolved lokal yang berbeda dari server dipertahankan (`server_copy` = item server, `pending` + op edit/resolve) sehingga perubahan yang sudah dilebur ke create tidak hilang.

## 7. UI (`static/index.html`, `static/app.css`)

Komponen baru: `NoteCommentsPanel` (panel/lembar), `CommentThread`, `CommentComposer` (memakai `MentionInput` dengan kandidat anggota workspace), `CommentSelectionBubble`.

- **`NoteModal`:** tombol header "Komentar · N" hanya untuk note di workspace; badge hijau bila `comment_unread`. Desktop ≥ 1024px: panel 380px di kanan, kertas bergeser; status buka/tutup di `localStorage` (try/catch). Layar sempit: lembar dari bawah tinggi ±70%, latar diredupkan. Membuka panel → `POST /comments/read` dan berlangganan SSE; menutup modal → berhenti berlangganan.
- **Seleksi:** seleksi tak kosong di editor → gelembung "Komentari" di atasnya (desktop) atau tombol di bar bawah (sentuh). Klik → panel terbuka, chip kutipan di kolom tulis (teks polos, dipotong 500 karakter, chip bisa dilepas).
- **Sorotan:** plugin ProseMirror berbasis `Decoration.inline` dengan kelas `.cmt-anchor` / `.cmt-anchor-active` untuk thread terbuka yang kutipannya ketemu. Klik sorotan → thread aktif di panel; klik kutipan di kartu → sorotan aktif + scroll ke posisinya. Markdown note tidak berubah. Bundle Milkdown di-rebuild agar `milkdown-build/entry.js` mengekspor `Decoration` dan `DecorationSet` dari `@milkdown/prose/view`; bila tidak tersedia, sorotan dimatikan dan panel tetap berjalan.
- **Kutipan hilang:** kartu menampilkan kutipan dicoret + "Bagian ini sudah diubah atau dihapus dari catatan."
- **Panel:** tab `Terbuka · N` / `Selesai · N`; aksi per hak §3; edit inline dengan label "diedit"; "Menunggu sinkron" untuk `pending`; Ctrl/⌘+Enter untuk kirim; status kosong sesuai mockup; banner offline "Kamu sedang offline. Komentar dikirim otomatis saat tersambung."
- **Daftar catatan:** badge jumlah komentar terbuka (hijau bila `comment_unread`, abu bila sudah dibaca, tidak tampil bila 0).
- **Notifikasi:** item dengan `note_id` membuka note dengan panel komentar terbuka.
- Mode gelap via token tema yang ada; tanpa aksen `border-left`; target sentuh ≥ 44px di mobile.

Teks UI persis mengikuti mockup (lihat kanvas).

## 8. Tes kunci

**pytest**
- Akses: pemilik/anggota bisa lihat & tulis; non-anggota → 404; note pribadi → 409 `NOTE_NOT_SHARED`.
- Visibilitas lintas workspace: unshare → tersembunyi; share ulang ke W sama → muncul; share ke W2 → tetap tersembunyi; hapus workspace → baris komentar W terhapus.
- Sampah: hapus note → komentar tidak terlihat; restore → terlihat; purge → baris terhapus.
- Idempotensi `client_id`; balasan ke balasan diratakan; `quote` diabaikan di balasan; batas panjang → 422.
- Hak edit/selesaikan/hapus sesuai §3 (403 untuk yang lain); hapus thread ikut balasan.
- Delta pull: urutan dan paginasi kursor, tombstone, kursor > 30 hari → `reset`, komentar tersembunyi tidak bocor.
- Notifikasi: penerima sesuai §5.1, dedup + prioritas jenis, pengirim dikecualikan, @mention non-anggota diabaikan, `note_id` terisi.
- `comment_open_count`/`comment_unread` benar dan tidak mengubah `updated_at` note.
- Komentar tidak muncul di `/pub`, ekspor DOCX/MD, `/api/search`.

**node**
- `commentrepo`: thread & tab, hitungan & unread, merge pull (tombstone, tidak menimpa `pending`), peleburan op tertunda.
- `commentanchor`: persis, normalisasi, tidak ketemu, banyak kecocokan.
- Router lokal; `syncpush` komentar untuk 2xx / 403 / 404 / 409 / 422 / 5xx dan ketergantungan id note & induk.
- Upgrade IndexedDB v5 → v6 mempertahankan store lama.

**E2E Playwright** (dua akun, terang + gelap): A berkomentar saat offline → online → B melihat komentar (SSE) dan notifikasinya; B membalas → A dinotifikasi; A menyelesaikan → pindah ke tab Selesai di kedua sisi; edit teks yang dikutip → "Bagian ini sudah diubah"; badge di daftar catatan.

Semua PR: `npm test`, `python -m pytest`, `check_inline_scripts`, dan pembaruan `.agents/`.

## 9. Pembagian PR

1. **Backend** — skema & migrasi, helper visibilitas, endpoint §4, field turunan, siklus hidup §2.2, notifikasi + Telegram, SSE, pytest.
2. **Offline** — `DB_VERSION` 6, `commentrepo`, `commentanchor`, `commentroutes`, push/pull, tes node, precache SW.
3. **UI** — rebuild bundle Milkdown (ekspor Decoration), panel/lembar, seleksi, sorotan, badge daftar, navigasi notifikasi, CSS + mode gelap, naik versi SW, E2E.

Setiap PR punya rencana sendiri di `docs/superpowers/plans/` (skill writing-plans) sebelum implementasi.
