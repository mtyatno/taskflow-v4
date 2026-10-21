# Kelola Workspace — Fase 2a: undangan & akses gabung

Tanggal: 2026-10-21 · Status: desain disetujui di chat, menunggu tinjauan spec

Peta fase: 0 perbaikan aman (selesai, #63) · 1 halaman Kelola per workspace (selesai, #70) · **2a undangan & akses gabung (spec ini)** · 2b siklus hidup (transfer ownership, arsip, ekspor) · 3 bawaan & template · 4 peran & izin · 5 statistik & notifikasi.

## Masalah sekarang

- Undang via username (aplikasi `POST /api/lists/{id}/invite` dan bot `/invite`) **langsung memasukkan** orang ke workspace tanpa persetujuan penerima.
- Link undangan (`list_invites`) selalu sekali pakai, berlaku 48 jam, tidak bisa dilihat lagi setelah halaman ditinggal, dan tidak bisa dibatalkan.
- Modal `?join=` belum menampilkan owner + jumlah anggota (sisa Fase 1).

## Keputusan Bapak

| Topik | Pilihan |
|---|---|
| Penerima melihat undangan di | Seksi "Undangan untukmu" di Kelola Workspace, notifikasi aplikasi, pesan Telegram + tombol, badge di sidebar (keempatnya) |
| Opsi link | Masa berlaku (1 jam / 1 hari / 7 hari) + batas pemakaian (1 orang / maks 10 / tanpa batas) |
| Gabung lewat link | Langsung masuk (owner tetap diberi notifikasi) |
| Penyimpanan | Tabel baru `workspace_invitations` + perluas `list_invites` (pendekatan A) |

## Bagian 1 — Data, backend, bot

### 1.1 Skema (migrasi idempoten)

`workspace_invitations`:

| Kolom | Keterangan |
|---|---|
| `id` INTEGER PK | |
| `list_id` | FK `shared_lists(id)` ON DELETE CASCADE |
| `invitee_id` | FK `users(id)` ON DELETE CASCADE |
| `inviter_id` | user pengundang (owner saat dibuat) |
| `status` TEXT | `pending` / `accepted` / `declined` / `cancelled` |
| `created_at`, `responded_at` | ISO (`datetime.now().isoformat()`) |

- Indeks unik parsial: satu `pending` per `(list_id, invitee_id)`.
- Kedaluwarsa: `pending` dengan `created_at` > **14 hari** dianggap kedaluwarsa saat dibaca/dijawab (tidak muncul di daftar; terima/tolak → 410 "Undangan sudah kedaluwarsa"). Tidak ada job terjadwal.

`list_invites` ditambah kolom: `max_uses` INTEGER (NULL = tanpa batas), `uses` INTEGER DEFAULT 0, `revoked_at` TEXT, `created_at` TEXT. Backfill baris lama: `max_uses = 1`, `uses = 1` bila `used = 1`, `created_at` = `expires_at` − 48 jam. Kolom `used` dipertahankan (diset 1 bila `uses >= max_uses`) agar kode lama tidak salah baca.

`notifications` ditambah kolom `kind` TEXT DEFAULT NULL (NULL = notifikasi lama); notifikasi undangan memakai `kind = 'workspace_invite'`. `GET /api/notifications` menyertakan `kind`.

### 1.2 Undangan via username

- `TaskRepository.create_workspace_invitation(list_id, inviter_id, invitee_id) -> dict` — dipakai aplikasi **dan** bot `/invite`.
- `POST /api/lists/{id}/invite` (owner): user tidak ada → 404 (pesan lama); diri sendiri → 400; sudah anggota → 400 "User '{u}' sudah menjadi anggota"; sudah ada pending → 409 "Undangan untuk @{u} sudah dikirim". Sukses → 200 `{ok, invitation: {id, invitee: {id, username, display_name}, created_at}}`. **Tidak** lagi menambah anggota.
- Efek samping: baris `notifications` untuk penerima (`list_id` diisi) dengan teks `{pengundang} mengundangmu ke workspace {nama}`; bila penerima punya `telegram_id`, bot mengirim pesan (nama di-escape) dengan tombol inline **Terima** (`inv_acc_{id}`) / **Tolak** (`inv_dec_{id}`).
- Penerima:
  - `GET /api/invitations` → daftar pending miliknya (belum kedaluwarsa): `[{id, list: {id, name, avatar, color_idx}, inviter_name, created_at}]`.
  - `POST /api/invitations/{id}/accept` → jadi anggota (`add_list_member`), status `accepted`, notifikasi owner `{nama} menerima undangan ke {workspace}`; 404 bila bukan miliknya / tidak ada; 409 bila sudah dijawab/dibatalkan; 410 bila kedaluwarsa; bila sudah jadi anggota lewat jalur lain → status `accepted`, 200.
  - `POST /api/invitations/{id}/decline` → status `declined`, notifikasi owner `{nama} menolak undangan ke {workspace}`; kode galat sama.
- Owner:
  - `GET /api/lists/{id}/invitations` → pending (belum kedaluwarsa): `[{id, invitee: {id, username, display_name}, created_at}]`; bukan owner → 403.
  - `DELETE /api/lists/{id}/invitations/{inv_id}` → status `cancelled`; 404 bila tidak ada / bukan workspace ini; 409 bila bukan pending.
- Bot callback `inv_acc_` / `inv_dec_`: user Telegram yang menekan harus `invitee_id` undangan itu (selain itu jawaban "Undangan ini bukan untukmu"); memakai fungsi repository yang sama; hasil → edit pesan: "✅ Bergabung ke {nama}" / "Undangan ditolak" / "Undangan ini sudah tidak berlaku".
- Workspace dihapus → undangan ikut terhapus (CASCADE). Owner menghapus anggota yang punya undangan pending lain → tidak terpengaruh.

### 1.3 Link undangan

- `POST /api/lists/{id}/generate-link` (owner) body opsional `{expires_in: "1h"|"1d"|"7d", max_uses: 1|10|null}` (bawaan `1d`, `1`; nilai lain → 422). Respons `{code, join_url, expires_at, max_uses, uses: 0}`.
- `GET /api/lists/{id}/links` (owner) → link aktif saja (tidak dibatalkan, belum kedaluwarsa, `max_uses IS NULL OR uses < max_uses`), urut terbaru: `[{code, join_url, expires_at, max_uses, uses, created_at}]`.
- `DELETE /api/lists/{id}/links/{code}` → `revoked_at = now`; 404 bila bukan milik workspace ini. `DELETE /api/lists/{id}/links` → batalkan semua yang aktif; respons `{revoked: n}`.
- `consume_list_invite(code)` → satu `UPDATE … SET uses = uses + 1 WHERE code = ? AND revoked_at IS NULL AND expires_at > now AND (max_uses IS NULL OR uses < max_uses)`; hanya bila `rowcount == 1` dianggap sah (aman untuk pemakaian bersamaan). Pemakai yang sudah anggota/owner tidak menghabiskan kuota (cek keanggotaan **sebelum** consume; urutan di endpoint join diubah).
- `GET /api/lists/preview/{code}` dan `POST /api/lists/join` membedakan galat: tidak ada → 400 "Kode tidak valid."; dibatalkan → 400 "Link sudah dibatalkan owner."; kedaluwarsa → 400 "Link sudah kedaluwarsa."; penuh → 400 "Link sudah mencapai batas pemakaian.". Pratinjau tetap memuat `owner_name` + `member_count`.

### 1.4 Offline

Semua fitur undangan dan link online saja (`{ network: true }`). Daftar undangan untukmu + jumlahnya disimpan di `OfflineDB.cacheSet("invitations", …)` agar seksi dan badge tetap tampil (data terakhir) saat offline.

**Deploy:** restart `taskflow-web` lalu `taskflow` (migrasi + perubahan bot).

## Bagian 2 — Tampilan

### 2.1 Penerima

1. **Seksi "Undangan untukmu"** paling atas halaman Kelola Workspace (hanya bila ada pending). Kartu: `WorkspaceAvatar`, nama workspace, `Diundang oleh {nama} · {tanggal}`, tombol **Terima** / **Tolak**. Terima → toast `Bergabung ke {nama}` + daftar workspace/sidebar dimuat ulang; Tolak → toast `Undangan ditolak`.
2. **Badge** jumlah undangan pending di menu Kelola Workspace (sidebar terbuka + tombol "Semua workspace" di rail). Dimuat di `fetchAll` (online) dan setelah terima/tolak.
3. **Notifikasi aplikasi** (daftar yang sudah ada): notifikasi undangan dikenali dari kolom `kind = 'workspace_invite'` (lihat 1.1); mengklik membuka `manage_lists` dan menggulir ke seksi "Undangan untukmu" (`id="ws-invitations"`).
4. **Telegram:** lihat 1.2.

### 2.2 Owner (seksi Anggota halaman `ws_manage_<id>`)

1. Form **Undang via username** → toast `Undangan dikirim ke @{username}`.
2. **Undangan menunggu** (disembunyikan bila kosong): nama + @username + tanggal kirim + **Batalkan**.
3. **Link undangan**: pilihan `Berlaku` (1 jam / 1 hari / 7 hari) dan `Bisa dipakai` (1 orang / maks 10 orang / tanpa batas) + **Buat link**. **Link aktif**: URL (input baca-saja) + **Salin** + `Sisa {n} dari {max} · berlaku sampai {tanggal jam}` (atau `Tanpa batas · berlaku sampai …`) + **Batalkan**; tombol **Matikan semua link** dengan konfirmasi dialog Alurik (`Matikan semua link undangan workspace ini? Link yang sudah dibagikan tidak bisa dipakai lagi.`). Kosong → `Belum ada link aktif.`

### 2.3 Membuka link / kode

Pratinjau di halaman daftar **dan** modal `?join=` (`JoinListModal`) menampilkan `Owner: {owner_name} · {member_count} anggota`; galat link memakai pesan 1.3.

### 2.4 Umum

- Ikon memakai glyph duotone Alurik yang sudah ada (`VIEW_GLYPHS`), tanpa emoji baru di UI (pesan Telegram tetap memakai emoji seperti pesan bot lain).
- Offline: Terima, Tolak, Undang, Buat link, Batalkan, Matikan semua → nonaktif + `Butuh koneksi internet`.
- Semua teks pengguna (nama, username) dirender sebagai teks.
- Versi SW / `app.css?v=` naik ke nomor kosong berikutnya saat implementasi (saat spec ditulis `main` = v445 / 351).

## Pengujian

- **pytest**: migrasi idempoten + backfill `list_invites`; undang → pending (bukan anggota), duplikat 409, sudah anggota 400; terima/tolak (bukan milik → 404, sudah dijawab 409, kedaluwarsa 410, sudah anggota → 200); batalkan oleh owner; daftar penerima & owner tidak memuat kedaluwarsa; notifikasi dibuat; link: opsi valid/invalid, aktif/daftar, batalkan satu/semua, kuota 1 → orang kedua ditolak, pemakaian bersamaan (dua thread pada link sisa 1 → tepat satu sukses), anggota yang sudah ada tidak menghabiskan kuota, pesan galat dibedakan; bot callback (penekan bukan penerima, sudah dijawab, sukses) dengan mock bot.
- **node**: helper teks (`Sisa n dari m`, `Tanpa batas`, format tanggal), badge count.
- **E2E** (dua akun, terang + gelap, 375 px): owner undang B → B melihat badge + seksi + notifikasi → terima → workspace muncul; undang lagi → tolak; owner batalkan undangan → hilang di B; link 1 orang dipakai B, C ditolak dengan pesan penuh; link tanpa batas dipakai 2 orang; Matikan semua → link ditolak dengan pesan dibatalkan; `?join=` menampilkan owner + jumlah; offline → tombol nonaktif.

## Di luar cakupan

Persetujuan owner untuk gabung lewat link; undangan via email; peran saat diundang (Fase 4); transfer ownership, arsip, ekspor (Fase 2b).
