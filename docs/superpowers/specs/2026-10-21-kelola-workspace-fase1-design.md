# Kelola Workspace — Fase 1: halaman Kelola per workspace

Tanggal: 2026-10-21 · Status: desain disetujui di chat, menunggu tinjauan spec

Lanjutan Fase 0 (`docs/superpowers/specs/2026-10-20-kelola-workspace-fase0-design.md`, PR #63). Peta fase: 0 perbaikan aman (selesai) · **1 halaman Kelola per workspace (spec ini)** · 2 undangan & siklus hidup · 3 bawaan & template · 4 peran & izin · 5 statistik & notifikasi.

## Tujuan

- Setiap workspace punya **identitas visual** (warna + inisial/emoji) dan **deskripsi** yang sama bagi semua anggota, tampil selaras di daftar, sidebar, dan halaman workspace.
- Pengaturan workspace pindah ke **halaman detail sendiri** yang menjadi "rumah" untuk fitur Fase 2–5.
- Aksi berbahaya (Hapus / Keluar) tidak lagi bersebelahan dengan tombol Kelola di kartu, melainkan di **Danger Zone** halaman detail.
- User bisa mengatur **pin dan urutan** workspace di sidebar dari halaman daftar.

## Keputusan Bapak

| Topik | Pilihan |
|---|---|
| Bentuk halaman | Halaman sendiri (bukan modal / tab) |
| Identitas | 8 warna palet sidebar (+ Otomatis), avatar Otomatis / Inisial 1–2 karakter / satu emoji |
| Hak ubah identitas | Owner saja; anggota melihat mode baca |
| Pin & urutan | Seksi "Di sidebar" di halaman daftar (drag + ↑/↓) |
| Avatar tampil di | Kartu daftar + halaman detail, rail sidebar, sidebar terbuka, judul halaman workspace |
| Penyimpanan | Kolom di `shared_lists` (pendekatan A) |

## Bagian 1 — Data & backend

### 1.1 Skema (migrasi idempoten di `migrate_db` / pola `ALTER TABLE` yang ada)

`shared_lists` mendapat kolom:

| Kolom | Tipe | Nilai |
|---|---|---|
| `description` | TEXT DEFAULT '' | maks 300 karakter (setelah trim) |
| `color_idx` | INTEGER DEFAULT NULL | 0–7, atau NULL = otomatis (`avatarColorIndex(id)`) |
| `avatar` | TEXT DEFAULT NULL | NULL = otomatis (huruf pertama nama); 1–2 karakter huruf/angka (disimpan uppercase); atau tepat satu emoji (satu grapheme cluster) |
| `updated_at` | TEXT DEFAULT NULL | `datetime.now().isoformat()` saat identitas diubah |

### 1.2 `PATCH /api/lists/{id}` (owner saja)

- Body (semua opsional; field yang tidak dikirim tidak berubah): `name` (1–100, trim), `description` (0–300, trim; `""`/`null` = kosong), `color_idx` (0–7 atau `null` = otomatis), `avatar` (`null` = otomatis, atau string sesuai 1.1).
- Validasi avatar di server (tanpa dependensi baru): setelah trim, `null`/`""` → NULL; 1–2 karakter yang semuanya `str.isalnum()` → uppercase; selain itu harus **satu emoji**: maks 16 codepoint, semuanya codepoint emoji atau penyambung (rentang U+1F000–U+1FAFF, U+2600–U+27BF, U+2300–U+23FF, U+2B00–U+2BFF, ZWJ U+200D, VS16 U+FE0F, keycap U+20E3), dan jumlah "emoji dasar" = 1 — emoji dasar dihitung sebagai codepoint di rentang emoji yang tidak didahului ZWJ, bukan pengubah warna kulit (U+1F3FB–U+1F3FF), dan pasangan regional indicator (U+1F1E6–U+1F1FF) dihitung satu. Dua emoji terpisah ("🔥🔥") ditolak. Ditolak → 422. Klien memakai aturan yang sama (`validateAvatar`).
- Respons: objek list lengkap (sama bentuk dengan item `GET /api/lists`).
- Workspace tidak ada → 404; bukan owner → 403; validasi gagal → 422 dengan `detail` berbahasa Indonesia, mis. "Deskripsi maksimal 300 karakter", "Avatar harus 1–2 huruf/angka atau satu emoji", "Warna tidak valid".
- `rename_shared_list` yang sudah ada dipakai untuk nama (bot memakai jalur yang sama bila nanti perlu).

### 1.3 GET

`GET /api/lists` dan `GET /api/lists/{id}` menyertakan `description`, `color_idx`, `avatar`, `updated_at`. `static/offline/listsync.js` (`listFromServer`, `getLocalLists`) menyimpan dan mengembalikan keempatnya.

### 1.4 `PUT /api/lists/pins/order`

- Body `{"list_ids": [int, …]}`. Harus berisi **persis** himpunan workspace yang sedang di-pin user (urutan bebas, tanpa duplikat) → posisi pin ditulis ulang 0..n-1 dalam satu transaksi. Tidak cocok → 409 `{"code":"PIN_ORDER_MISMATCH"}`.
- Rute didefinisikan sebelum `/api/lists/{list_id}` agar tidak tertangkap rute generik.
- Respons `{"ok": true, "list_ids": [...]}`.

### 1.5 Pratinjau kode gabung

`GET /api/lists/preview/{code}` menambah `owner_name` (display_name atau username owner) dan `member_count` (anggota + owner).

### 1.6 Helper murni `static/offline/workspacepins.js`

`avatarFor(list) -> { text: string, colorIdx: number, isEmoji: boolean }` — `avatar` kustom bila ada, selain itu `avatarInitial(name)`; `color_idx` kustom bila 0–7, selain itu `avatarColorIndex(id)`. Ditambah `validateAvatar(input) -> { ok: boolean, value: string|null, error?: string }` dengan aturan yang sama dengan server (dipakai form).

### 1.7 Online saja

Simpan identitas, ubah urutan pin, pin/lepas pin, Keluar, Hapus memakai `{ network: true }` dan butuh koneksi. Offline → tombol nonaktif + keterangan "Butuh koneksi internet".

**Deploy:** restart `taskflow-web` dan `taskflow` (bot) — `repository.py` berubah.

## Bagian 2 — Tampilan

### 2.1 Halaman daftar Kelola Workspace (`manage_lists`)

1. **Gabung dengan kode** (tetap); pratinjau kini menampilkan "Owner: {owner_name} · {member_count} anggota".
2. **Buat Workspace Baru** (tetap).
3. **Di sidebar** — kartu workspace yang di-pin (maks 5) urut `pin_position`. Urutan diubah dengan drag (Pointer Events, mouse + sentuh tekan-tahan) atau tombol ↑/↓ (`aria-label` "Naikkan {nama}" / "Turunkan {nama}"). Setiap perubahan: urutan lokal langsung berubah (optimistis) → `PUT /api/lists/pins/order` → gagal: urutan dikembalikan + toast "Gagal menyimpan urutan". Tiap kartu punya tombol "Lepas pin". Kosong → "Belum ada workspace di sidebar. Pin dari daftar di bawah."
4. **Semua workspace** — kotak cari (muncul bila ≥ 6 workspace; cocok nama/deskripsi, huruf besar/kecil diabaikan). Kartu: avatar, nama, deskripsi satu baris (terpotong elipsis), `Owner/Member · N anggota`, tombol **Pin / Di-pin** (penuh 5 → nonaktif + tooltip "Maksimal 5 workspace di sidebar"), **Buka** (ke `slist_<id>`), **Kelola** (ke `ws_manage_<id>`). **Tidak ada tombol Hapus/Keluar di kartu.**

### 2.2 Halaman detail `ws_manage_<id>`

- Tombol "← Semua workspace" (ke `manage_lists`), header avatar besar + nama + `Owner/Member`.
- Workspace tidak ditemukan (dihapus / sudah keluar) → "Workspace tidak ditemukan" + tombol kembali.

**Seksi Umum**
- Owner: input Nama, textarea Deskripsi (penghitung `n/300`), pemilih warna (8 bulatan `ws-c0..7` + "Otomatis", `role="radiogroup"`), pemilih avatar (Otomatis / Inisial [input maks 2] / Emoji [input]), pratinjau avatar langsung. Tombol **Simpan** aktif hanya bila ada perubahan dan valid; **Batal** mengembalikan nilai. Sukses → toast "Workspace disimpan" + data lokal (store `lists`) diperbarui + App memuat ulang daftar workspace; gagal → pesan `detail` server.
- Anggota: nama, deskripsi (atau "Belum ada deskripsi."), avatar — teks saja, tanpa input.

**Seksi Anggota** — isi panel anggota Fase 0 dipindah ke sini (owner pertama, `Belum ada anggota lain.`, galat + Coba lagi, dialog Keluarkan), ditambah "bergabung {tanggal lokal}" per anggota (dari `joined_at`). Owner: Undang via username + Generate Invite Link (dipindah dari panel).

**Seksi Danger Zone** (kelas baru `.ws-danger-zone`: bingkai + judul merah lembut, varian tema gelap)
- Owner: "Hapus workspace" + penjelasan singkat → dialog `WorkspaceDeleteDialog` Fase 0; sukses → kembali ke `manage_lists`.
- Anggota: "Keluar dari workspace" → alur keluar Fase 0 (`leaveWorkspaceWithDrawings`); sukses → kembali ke `manage_lists`.

### 2.3 Avatar di semua tempat (helper `avatarFor`)

1. Kartu daftar + header detail (ubin 40×40 / 56×56, kelas `ws-c{n}`).
2. Rail sidebar mode ikon (avatar pin yang sudah ada).
3. Sidebar terbuka bagian WORKSPACES: ikon clipboard/users diganti avatar kecil 20×20.
4. Judul halaman workspace (`slist_<id>`): avatar di samping nama; deskripsi (bila ada) satu baris abu-abu di bawah judul.

Emoji ditampilkan apa adanya di atas latar warna; inisial putih tebal.

### 2.4 Offline

Halaman daftar dan detail tetap bisa dibuka dari data lokal; semua aksi tulis (Simpan, urutan, Pin, Keluar, Hapus) nonaktif dengan "Butuh koneksi internet"; daftar anggota memakai cache SW (perilaku Fase 0).

### 2.5 Aksesibilitas & responsif

Grup warna `role="radiogroup"` dengan `aria-checked`; tombol ↑/↓ bisa difokus; lebar 375 px tanpa scroll horizontal (kartu membungkus tombol ke baris kedua).

### 2.6 Versi

SW dan `app.css?v=` naik ke nomor kosong berikutnya saat implementasi (saat spec ditulis `main` = v439 / 347).

## Pengujian

- **pytest**: migrasi kolom idempoten; PATCH owner sukses (tiap field + kombinasi, `null` → otomatis), anggota 403, tidak ada 404, validasi 422 (deskripsi 301 karakter, avatar "ABC", avatar "a b", dua emoji, color_idx 8/-1); GET memuat field baru; urutan pin sukses / 409 (kurang, lebih, duplikat, bukan pin); pratinjau kode memuat `owner_name` + `member_count`.
- **node**: `avatarFor` (kustom/otomatis/emoji), `validateAvatar` (kasus yang sama dengan server), `listsync` menyimpan field baru.
- **E2E Playwright** (dua akun, terang + gelap, + 375 px): owner ubah nama/deskripsi/warna/emoji → tampil di 5 tempat; anggota melihat perubahan setelah sync dan seksi Umum mode baca; urutan pin lewat drag dan ↑/↓ → rail mengikuti dan bertahan setelah reload; kartu tanpa Hapus/Keluar; Danger Zone Hapus (owner) & Keluar (anggota) kembali ke daftar; offline → aksi nonaktif; pratinjau kode gabung memuat owner + jumlah.

## Di luar cakupan

Unggah gambar avatar; warna bebas (color picker); arsip, ekspor, transfer ownership, undangan dengan persetujuan, daftar link aktif (Fase 2); default view & template (Fase 3); peran Admin/Viewer (Fase 4); statistik & notifikasi (Fase 5); drag urutan langsung di rail.
