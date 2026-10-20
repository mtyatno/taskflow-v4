# Spec: Workspace yang di-pin di sidebar mode ikon

- **Tanggal:** 2026-10-20
- **Basis kode:** `main` @ `9e79989` (mtyatno/taskflow-v4)
- **Status:** desain disetujui dalam sesi brainstorming 2026-10-20 (pemilik + Claude). Spec tertulis ini menunggu review pemilik sebelum rencana implementasi dibuat.
- **Salinan:** repo `docs/superpowers/specs/2026-10-20-sidebar-workspace-pins-design.md` dan Project claude.ai "alurik" `claude/spec-sidebar-workspace-pins-2026-10-20.md`. Isi keduanya sama.
- **Istilah:**
  - *rail* = sidebar desktop dalam mode ikon (`.sidebar.collapsed .sidebar-rail`);
  - *workspace* = baris `shared_lists` yang bisa diakses user (pemilik atau anggota), halaman `slist_<id>`;
  - *pin* = workspace yang dipilih user untuk tampil sebagai shortcut di rail.

---

## 1. Tujuan

Di mode ikon, user bisa membuka workspace yang sering dipakai dengan satu klik tanpa melebarkan sidebar. Sidebar tetap rapi berapa pun jumlah workspace yang dimiliki.

**Kriteria berhasil**
1. Rail menampilkan maksimal 5 workspace yang di-pin user sebagai avatar, di bawah menu utama dan dipisahkan divider, diikuti tombol "Semua workspace".
2. Klik avatar membuka halaman workspace itu. Avatar diberi penanda aktif hanya saat halaman workspace itu terbuka.
3. User bisa pin/unpin dari halaman workspace dan unpin dari rail (klik kanan).
4. Pin tersimpan per user di server dan sama di semua perangkat.
5. User yang belum pernah mengatur pin mendapat isi awal 3 workspace satu kali saja.
6. Rail tetap tampil benar saat offline (data pin dari cache lokal).

## 2. Keputusan

| # | Keputusan |
|---|---|
| D1 | Workspace di rail **hanya navigasi** (shortcut ke `slist_<id>`), bukan pemilih konteks aplikasi. |
| D2 | Pola hybrid: avatar workspace yang di-pin + satu tombol **"Semua workspace"** yang membuka halaman `manage_lists` ("Kelola Workspace") yang sudah ada. Tidak ada flyout baru. |
| D3 | Pin **manual**, maksimal **5**. Workspace yang baru di-pin masuk ke posisi terakhir. |
| D4 | Pin disimpan **per user di server** (tabel `workspace_pins`). |
| D5 | Isi awal satu kali: 3 workspace dengan aktivitas task terbaru, ditandai di `users` supaya tidak terulang setelah user melepas semua pin. |
| D6 | Pin/unpin hanya online di v1; rail membaca pin dari cache lokal sehingga tetap tampil saat offline. |
| D7 | Sidebar expanded **tidak berubah**: seksi WORKSPACES sudah menampilkan semua workspace. *(Mengoreksi ringkasan brainstorming yang menyebut mode expanded menampilkan pin; ternyata di kode semua workspace sudah tampil di sana.)* |
| D8 | Tidak ada badge jumlah task di avatar v1; cukup tooltip nama. |

## 3. Kondisi sekarang

- `Sidebar` (`static/index.html`, ~baris 2519) membangun array `links`. Rail mengambil `links` sebelum seksi pertama (Dashboard, Kalender, Fokus Hari Ini, Habit Tracker, Notes, Draw, Mindmap, Diskusi), lihat komentar "Icon rail (desktop, collapsed)".
- Seksi WORKSPACES di sidebar expanded berisi semua `sharedLists` (`slist_<id>`, ikon `clipboard`/`users`, jumlah task aktif, badge "shared"), lalu link `manage_lists` "Kelola Workspace".
- `sharedLists` berasal dari `GET /api/lists` (`repo.get_lists_for_user`: `{id, name, owner_id, created_at, role, member_count}`). Saat offline, route lokal `GET /api/lists` di `taskroutes.js` memanggil `TF.listsync.getLocalLists()` yang membaca store IndexedDB `lists` (`listFromServer` hanya menyimpan `name`, `owner_id`, `role`, `member_count`).
- Halaman workspace merender baris tab `workspace-nav-tabs` (Tasks / Files) dengan tombol "Kelola project" di kanan.
- Rail tidak tampil di layar ≤ 768 px (mobile memakai drawer sidebar penuh).
- Belum ada penyimpanan preferensi UI per user di server. Pola terdekat: `mindmap_pins` (pin pribadi per user).

## 4. Model data

Idempoten di `migrate_db()` (dan `TaskRepository._init_db` agar bot/tes memakai skema sama):

```sql
CREATE TABLE IF NOT EXISTS workspace_pins (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  list_id     INTEGER NOT NULL REFERENCES shared_lists(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, list_id)
);
CREATE INDEX IF NOT EXISTS idx_workspace_pins_list ON workspace_pins(list_id);
ALTER TABLE users ADD COLUMN workspace_pins_seeded INTEGER NOT NULL DEFAULT 0;
```

- Urutan pin = `ORDER BY position, list_id`. Pin baru: `position = COALESCE(MAX(position), -1) + 1` milik user itu.
- Batas 5 dicek di server saat pin.
- Workspace dihapus → baris pin hilang lewat CASCADE (koneksi memakai `PRAGMA foreign_keys=ON`).
- User keluar dari workspace atau dikeluarkan owner → baris pin user itu untuk workspace tersebut dihapus di `remove_list_member`.
- Pin untuk workspace yang tidak lagi bisa diakses (data lama) diabaikan saat dibaca karena `get_lists_for_user` hanya mengembalikan workspace yang bisa diakses.

### 4.1 Isi awal (seed)

Dijalankan di `get_lists_for_user` (dipakai `GET /api/lists` dan perintah daftar list di bot; seed dari bot tidak masalah) bila `users.workspace_pins_seeded = 0` **dan** user punya minimal satu workspace:
- Ambil sampai 3 workspace yang bisa diakses, diurutkan berdasarkan `MAX(tasks.updated_at)` task di workspace itu (terbaru dulu), lalu `shared_lists.created_at` terbaru, lalu `id`.
- Sisipkan sebagai pin dengan `position` 0, 1, 2 (`INSERT OR IGNORE`), lalu set `workspace_pins_seeded = 1`. Semua dalam satu transaksi.
- User tanpa workspace tidak ditandai, sehingga seed berjalan saat ia punya workspace pertama.
- User yang sudah pernah pin/unpin (endpoint §5) juga ditandai `workspace_pins_seeded = 1`, supaya seed tidak menimpa pilihannya.

## 5. API

| Endpoint | Perilaku |
|---|---|
| `GET /api/lists` | Bentuk sama, tiap item ditambah `pinned: bool` dan `pin_position: int \| null`. Urutan daftar tidak berubah. |
| `PUT /api/lists/{id}/pin` | Idempoten. Bukan pemilik/anggota → 404 `"List not found"`. Sudah di-pin → 200 tanpa perubahan. Sudah 5 pin lain → 409 `{"code": "PIN_LIMIT", "message": "Maksimal 5 workspace di-pin"}`. Sukses → `{"ok": true, "pinned": true, "pin_position": n}`. Menandai `workspace_pins_seeded = 1`. |
| `DELETE /api/lists/{id}/pin` | Idempoten (tidak di-pin → 200). Tidak memeriksa keanggotaan, supaya pin yatim tetap bisa dibersihkan. → `{"ok": true, "pinned": false}`. Menandai `workspace_pins_seeded = 1`. |

Pengubahan urutan (`PUT /api/lists/pins/order`) di luar cakupan v1 (§10).

## 6. Rail

Susunan rail (desktop, sidebar collapsed):

```
logo
expand ›
──────────
menu utama (8 ikon, tidak berubah)
──────────            ← divider baru, hanya bila ada pin
avatar pin #1..#5     ← urut pin_position
⋯ Semua workspace     ← selalu tampil
```

- **Avatar:** tombol `sidebar-rail-btn` berisi lingkaran 28 px dengan huruf pertama nama workspace (kapital, aman untuk emoji/huruf non-Latin dengan mengambil karakter pertama lewat `Array.from`). Warna latar dipilih deterministik dari `id` workspace (palet 8 warna dengan teks kontras di tema terang dan gelap).
- **Tooltip & aksesibilitas:** `title` dan `aria-label` = nama workspace; `aria-current="page"` saat aktif.
- **Aktif:** `page === "slist_<id>"` → kelas `active` yang sudah ada (latar aksen) ditambah ring aksen di avatar.
- **Klik:** `setPage("slist_<id>")`.
- **Klik kanan** (`contextmenu`) atau tombol keyboard `ContextMenu`/`Shift+F10` saat avatar difokus → menu kecil dengan dua item: "Buka" dan "Lepas pin". "Lepas pin" nonaktif saat offline (tooltip "Butuh koneksi internet"). Escape atau klik di luar menutup menu.
- **"⋯ Semua workspace":** ikon `more-horizontal` (Lucide; path SVG ditambahkan ke registri `static/ui-components.js` karena belum ada), `setPage("manage_lists")`, aktif saat halaman itu terbuka.
- Tidak ada pin → tidak ada divider kedua dan tidak ada avatar; tombol "Semua workspace" tetap tampil.
- Rail sudah `overflow-y: auto`, jadi layar pendek tetap aman.

Logika murni (urutan pin, inisial, warna) ditaruh di modul UMD baru `static/offline/workspacepins.js` agar bisa diuji dengan `node --test`:
- `pinnedForRail(lists) -> list[]` — item `pinned`, urut `pin_position`, lalu `id`, maksimal 5.
- `avatarInitial(name) -> string` dan `avatarColorIndex(id) -> 0..7`.
- `canPinMore(lists) -> bool`.

## 7. Pin dari halaman workspace

- Baris `workspace-nav-tabs` mendapat tombol kecil sebelum "Kelola project": ikon `pin` + teks "Pin" atau "Di-pin" (ikon `pin-off` saat hover untuk melepas; `pin` sudah ada di `static/ui-components.js`, `pin-off` ditambahkan). Tampil di tab Tasks dan Files.
- Pin saat sudah 5: tombol nonaktif dengan tooltip "Maksimal 5 workspace di-pin. Lepas salah satu dulu." Bila server tetap membalas 409 `PIN_LIMIT` (perangkat lain menambah pin), tampilkan toast pesan yang sama.
- Offline: tombol nonaktif dengan tooltip "Butuh koneksi internet".
- Panggilan memakai `api.put/delete(..., { network: true })`. Sukses → perbarui `sharedLists` di state secara langsung (optimistis setelah respons OK), lalu `TF.listsync.pullAndReconcileLists` di latar supaya cache lokal ikut. Gagal → toast "Gagal menyimpan pin", state tidak berubah.

## 8. Offline dan cache

- `listFromServer` menyimpan `pinned` (default `false`) dan `pin_position` (default `null`); `getLocalLists` mengembalikannya. Dengan begitu rail offline sama dengan saat terakhir sinkron.
- Tidak ada op outbox untuk pin (D6).
- Cache `localStorage` app (`tf_cache_lists`, lewat entri `[setSharedLists, "lists"]`) otomatis membawa field baru.

## 9. Penanganan error

| Kondisi | Perilaku |
|---|---|
| Pin ke-6 | Tombol nonaktif; server 409 `PIN_LIMIT` → toast |
| Workspace dihapus/keluar saat di-pin | Pin hilang di server; avatar hilang setelah `GET /api/lists` berikutnya |
| Pin/unpin saat offline | Tombol/menu nonaktif dengan tooltip |
| Respons gagal (5xx/jaringan) | Toast "Gagal menyimpan pin", state tetap |
| Nama workspace kosong | Avatar memakai "?" |

## 10. Pengujian

**pytest (`tests/test_workspace_pins.py`)**
- Skema idempoten (dua kali `migrate_db`), kolom `users.workspace_pins_seeded`.
- `GET /api/lists` membawa `pinned`/`pin_position`; urutan daftar tidak berubah.
- PUT idempoten, posisi bertambah, 409 `PIN_LIMIT` pada pin ke-6, non-anggota → 404.
- DELETE idempoten dan menghapus pin yatim.
- Seed: tiga workspace dengan aktivitas task terbaru; tidak berjalan dua kali; tidak berjalan lagi setelah user melepas semua pin; user tanpa workspace tidak ditandai lalu ter-seed saat punya workspace pertama; user yang sudah pin manual sebelum seed tidak ditimpa.
- Keluar dari workspace dan dikeluarkan owner menghapus pin; hapus workspace menghapus pin (CASCADE).

**node (`tests/offline/workspacepins.test.js`, tambahan di tes `listsync`)**
- `pinnedForRail` urut dan batas 5; `avatarInitial` (emoji, spasi depan, kosong); `avatarColorIndex` deterministik; `canPinMore`.
- `listFromServer`/`getLocalLists` membawa `pinned`/`pin_position` dengan default yang benar.

**Browser (Playwright, sebelum merge PR frontend)**
Collapse sidebar → avatar pin tampil sesuai urutan; klik membuka workspace dan penanda aktif pindah; pin dari halaman workspace muncul di rail; pin ke-6 ditolak; klik kanan → Lepas pin; reload offline → rail tetap sama; tema gelap dan terang.

## 11. Rilis

1. **PR backend** — tabel, seed, field `pinned`/`pin_position`, endpoint pin, pembersihan saat keluar workspace, pytest. Deploy: restart `taskflow-web` **dan** `taskflow` (bot), karena `repository.py` berubah.
2. **PR frontend + offline** — `workspacepins.js`, rail, tombol pin di halaman workspace, menu klik kanan, `listsync` membawa field pin, CSS. Naikkan versi SW (`static/sw.js` CACHE, fallback di `index.html`, `sw_cache` di `webapp.py`, `tests/test_version.py`) dan `app.css?v=` ke nomor kosong berikutnya di `main` saat itu (beberapa thread berjalan paralel).

Keputusan dicatat sebagai ADR baru di `.agents/DECISIONS.md` bersama PR backend (nomor kosong berikutnya; saat spec ditulis, terakhir ADR-016; setelah #51 terakhir ADR-017).

## 12. Di luar cakupan v1

- Mengatur urutan pin dengan drag.
- Pin/unpin saat offline.
- Badge jumlah task atau overdue di avatar.
- Warna/emoji workspace yang bisa diatur user.
- Workspace di rail versi mobile (rail memang tidak ada di ≤ 768 px).
- Workspace sebagai pemilih konteks seluruh aplikasi.
