# Pesan Pribadi (Direct Message 1-on-1) di halaman Diskusi

- **Tanggal:** 2026-10-03
- **Diminta oleh:** Bapak (pemilik produk)
- **Status:** disetujui, diimplementasi di branch `claude/direct-messages-qnw5fp`

## Masalah
Halaman Diskusi hanya mendukung chat grup (per shared list, tabel `messages.list_id`). Tidak ada cara dua pengguna berdiskusi secara pribadi.

## Keputusan produk
1. **Memulai DM baru** hanya boleh dengan pengguna yang saat ini berbagi minimal satu shared list (sebagai owner atau member). Ini pagar anti-spam: username bisa ditemukan lewat fitur undang.
2. **Sekali percakapan sudah dibuat, tetap aktif selamanya** walau kedua orang tidak lagi satu grup (pilihan Bapak: "Tetap aktif"). Kirim pesan hanya mensyaratkan keduanya peserta percakapan (dan tidak ada blokir — lihat poin 5).
3. DM terpisah total dari grup: tidak ikut terhapus bila grup dihapus, owner grup tidak bisa melihatnya.
4. Fitur v1: teks, balas (reply), indikator belum dibaca, realtime via SSE, notifikasi in-app untuk penerima yang tidak sedang membuka percakapan. **Tidak** termasuk: lampiran task/note (task & note terikat ke list), @mention (hanya 2 orang), mode offline (endpoint `/api/dm/*` online-only, tidak didaftarkan di router lokal/SW — sama seperti `/api/scratchpad/trash`).
5. **Blokir / buka blokir** (disetujui Bapak, 2026-10-04): peserta bisa memblokir lawan bicara dari menu ⋯ ruang DM. Blokir berlaku per pasangan user (bukan per percakapan) dan bila **salah satu** memblokir, **keduanya** tidak bisa mengirim pesan dan percakapan baru di antara mereka ditolak; riwayat tetap bisa dibaca kedua pihak dan percakapan yang sudah ada tetap dikembalikan oleh POST create. Buka blokir hanya menghapus blokir milik sendiri.

## Skema (dibuat oleh `migrate_db()` di `webapp.py`)
```sql
CREATE TABLE IF NOT EXISTS dm_conversations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_a          INTEGER NOT NULL,   -- selalu user_a < user_b
    user_b          INTEGER NOT NULL,
    created_at      TEXT NOT NULL,
    last_message_at TEXT,
    UNIQUE (user_a, user_b),
    CHECK (user_a < user_b),
    FOREIGN KEY (user_a) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (user_b) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS dm_messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content         TEXT NOT NULL,
    reply_to_id     INTEGER DEFAULT NULL REFERENCES dm_messages(id) ON DELETE SET NULL,
    client_id       TEXT DEFAULT NULL,
    created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dm_messages_conv ON dm_messages(conversation_id, id);
CREATE TABLE IF NOT EXISTS dm_reads (
    conversation_id INTEGER NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_id    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (conversation_id, user_id)
);
CREATE TABLE IF NOT EXISTS dm_blocks (
    blocker_id INTEGER NOT NULL,
    blocked_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id),
    FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
);
```

## API (semua butuh login; percakapan milik orang lain → 404)
| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/dm/contacts` | Pengguna yang berbagi ≥1 shared list dengan saya (tanpa diri sendiri): `id, username, display_name`. |
| GET | `/api/dm/conversations` | Percakapan saya: `id, other_user{id,username,display_name}, last_message{content,user_id,created_at}\|null, unread, last_message_at, created_at, blocked_by_me, blocked_by_other`, urut aktivitas terbaru. |
| POST | `/api/dm/conversations` `{user_id}` | Get-or-create. Sudah ada → kembalikan (tanpa cek grup). Baru → wajib berbagi grup dan tidak ada blokir di antara keduanya, else 403. Diri sendiri → 400. User tidak ada → 404. Respons sama dengan item daftar (termasuk `blocked_by_me`/`blocked_by_other`). |
| GET | `/api/dm/conversations/{id}/messages?limit=50&before_id=` | Bentuk sama dengan pesan grup (tanpa field task/note): `id, conversation_id, user_id, content, client_id, created_at, reply_to_id, username, display_name, reply_to_username, reply_to_display_name, reply_to_content`. |
| POST | `/api/dm/conversations/{id}/messages` `{content(1..2000), reply_to_id?, client_id?}` | Hanya peserta. Ada blokir (dari pihak mana pun) → 403 `"Obrolan ini diblokir"` tanpa simpan/notifikasi/SSE. `reply_to_id` harus di percakapan yang sama (else 400). Update `last_message_at`, siarkan ke SSE, notifikasi penerima bila ia tidak sedang subscribe SSE percakapan itu (tanpa duplikat notifikasi belum-dibaca untuk percakapan yang sama). |
| POST | `/api/dm/conversations/{id}/read` | Tandai terbaca sampai pesan terakhir. |
| POST | `/api/dm/conversations/{id}/block` | Blokir peserta lain (idempoten). Respons: objek percakapan dengan flag blokir terbaru. |
| DELETE | `/api/dm/conversations/{id}/block` | Buka blokir milik saya (idempoten; blokir dari pihak lain tetap). Respons: objek percakapan. |
| GET | `/api/dm/conversations/{id}/stream` | SSE (`get_current_user_sse`), ping tiap 20 dtk seperti chat grup. |

## Klien (`static/index.html`)
- Panel kiri Diskusi: bagian **Grup** (list yang ada) dan **Pesan Pribadi** (percakapan + badge belum dibaca) dengan tombol **＋** untuk memulai DM dari daftar kontak (anggota grup yang sama, bisa dicari). Pencarian panel menyaring keduanya.
- Ruang DM: header avatar + nama lawan bicara, keterangan "Pesan pribadi"; gelembung pesan, reply, load lebih lama, realtime; input tanpa lampiran/mention. Saat dibuka & saat pesan masuk → tandai terbaca.
- Menu ⋯ di header ruang DM: "Blokir {nama}" (dengan `confirm()`: "Blokir {nama}? Kalian berdua tidak bisa saling mengirim pesan sampai blokir dibuka.") / "Buka blokir". Saat diblokir, input diganti pemberitahuan: `blocked_by_me` → "Kamu memblokir {nama}." + tombol "Buka blokir"; `blocked_by_other` → "Kamu tidak bisa membalas obrolan ini." Kirim yang ditolak 403 blokir → toast + refresh daftar. Daftar di-refresh setelah blokir/buka blokir.
- Daftar percakapan di-refresh saat halaman dibuka, setelah kirim, dan berkala selama halaman Diskusi terbuka.
- SW cache `taskflow-v355-direct-messages`.

## Deploy
`sudo systemctl restart taskflow-web` wajib agar `migrate_db()` membuat tabel DM; hard refresh klien (SW v355).
