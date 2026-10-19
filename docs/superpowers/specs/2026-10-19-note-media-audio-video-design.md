# Spec: Audio & Video di Note (v1)

- **Tanggal:** 2026-10-19
- **Basis kode:** `main` @ `5df467c` (mtyatno/taskflow-v4, SW v416)
- **Status:** desain disetujui per bagian dalam sesi brainstorming 2026-10-19 (pemilik + Claude). Spec tertulis ini menunggu review pemilik sebelum rencana implementasi dibuat.
- **Salinan:** repo `docs/superpowers/specs/2026-10-19-note-media-audio-video-design.md` dan Project claude.ai "alurik" `claude/spec-note-media-audio-video-2026-10-19.md`. Isi keduanya sama.
- **Istilah:**
  - *media* = lampiran note berjenis audio atau video;
  - *direktif* = token `::media[<client_id>]{...}` di isi note;
  - *penyimpanan* = backend tempat file media disimpan (`local` = disk VPS, `r2` = Cloudflare R2);
  - *URL bertanda tangan* = URL berumur pendek yang membawa HMAC, dipakai tag `<audio>`/`<video>` karena tag itu tidak bisa mengirim header `Authorization`.

---

## 1. Tujuan

User bisa melampirkan file audio dan video ke note. File itu bisa diputar dan digeser ke menit tertentu di penampil note, di editor, dan di halaman publik. Semua file disajikan dari server Alurik sendiri; embed YouTube atau situs lain tidak didukung.

**Kriteria berhasil**
1. Rekaman suara pendek, rekaman rapat/kuliah panjang, klip video pendek, dan video ratusan MB bisa diunggah dari web dan aplikasi HP.
2. Unggahan yang putus bisa dilanjutkan dari potongan terakhir tanpa mengulang dari awal.
3. Video MP4/MOV dan audio bisa digeser ke menit tertentu di Chrome, Firefox, dan Safari/iOS (Range, `206 Partial Content`).
4. Proses Python tidak mengalirkan isi file media saat diputar; nginx yang mengirimnya.
5. Media hanya bisa diputar oleh orang yang bisa membuka note-nya, atau oleh pengunjung halaman publik note itu (dengan password bila note berpassword).
6. Tidak ada jalur bagi isi note untuk membuat tag `<audio>`, `<video>`, `<iframe>`, atau atribut HTML sendiri.

## 2. Keputusan

| # | Keputusan |
|---|---|
| D1 | Keempat jenis media didukung. Batas per user mengikuti paket dan dikerjakan di **sesi kuota terpisah**; v1 hanya punya satu batas teknis per file (`MEDIA_MAX_FILE_MB`, default 2048). |
| D2 | Penyimpanan lewat antarmuka yang bisa diganti: `local` (disk VPS, dipakai v1) dan `r2` (nanti). Media baru tidak masuk Nextcloud. Lampiran lama tetap di Nextcloud. |
| D3 | Penyajian selalu lewat endpoint Alurik yang memeriksa akses, lalu nginx mengirim file lewat `X-Accel-Redirect` (Range ditangani nginx). |
| D4 | Pemrosesan ringan saja: `ffprobe` (durasi, codec, resolusi), remux faststart untuk MP4/MOV/M4A, dan poster untuk video. File tidak dikonversi. Format yang tidak didukung browser mendapat pesan + tombol unduh. |
| D5 | Unggah hanya saat online, bertahap per potongan, bisa dilanjutkan. Tidak ada antrean offline. |
| D6 | Versi pertama belum bisa merekam langsung dari aplikasi. |
| D7 | Halaman publik: media bisa diputar dan diunduh seperti isi note lain, mengikuti password note. |
| D8 | Media adalah lampiran milik satu note (baris `note_attachments`), bukan entitas sendiri. Sampah, pemulihan, dan hapus permanen mengikuti note. |
| D9 | **Semua lampiran** note (lama dan baru) bisa dilihat, diunduh, dan ditambah oleh siapa pun yang bisa membuka note (`_note_access_clause`). Hapus hanya oleh pengunggah atau pemilik note. |
| D10 | Player dibuat Alurik dari direktif `::media[<client_id>]`. HTML mentah di note tetap di-escape sesuai PR 1b XSS (sesi lain). |
| D11 | Pemutaran butuh koneksi. Service worker tidak menyimpan file media. |

## 3. Kondisi sekarang (yang berubah)

- `note_attachments` (`repository.py:642`): `nextcloud_path NOT NULL`, `original_name`, `file_size`, `mime_type`. Semua endpoint lampiran note (`webapp.py:5301-5390`) hanya untuk **pemilik note** (`user_id = ?`), bertentangan dengan D9.
- Upload membaca seluruh file ke memori (`await file.read()`), batas `MAX_FILE_SIZE` 10 MB, tipe dibatasi `_ALLOWED_ATTACH_MIME` dan dipercaya dari `Content-Type` klien.
- `/view` dan `/pub/attachments/{id}` mengambil file dari Nextcloud dan meneruskannya tanpa Range; `/pub/attachments` bahkan memuat file utuh ke memori (`r.content`).
- Sampah: `trashed_notes.snapshot_json` menyimpan baris `note_attachments`, lalu barisnya dihapus; restore memasukkannya lagi. File di Nextcloud tidak pernah dihapus saat purge (kebocoran lama, di luar cakupan v1 untuk lampiran Nextcloud).
- Upload butuh id server note; note yang baru ada di perangkat (cid) belum bisa diberi lampiran.
- `nginx-taskflow.conf` di repo hanya template proxy; konfigurasi di VPS bisa berbeda.

## 4. Model data

### 4.1 Kolom baru `note_attachments`

Ditambahkan idempoten di `migrate_db()` (cek `PRAGMA table_info`):

```sql
ALTER TABLE note_attachments ADD COLUMN kind        TEXT NOT NULL DEFAULT 'file';      -- 'file' | 'media'
ALTER TABLE note_attachments ADD COLUMN client_id   TEXT DEFAULT NULL;                 -- id dari klien, dipakai direktif
ALTER TABLE note_attachments ADD COLUMN storage     TEXT NOT NULL DEFAULT 'nextcloud'; -- 'nextcloud' | 'local' | 'r2'
ALTER TABLE note_attachments ADD COLUMN storage_key TEXT DEFAULT NULL;                 -- kunci file di penyimpanan
ALTER TABLE note_attachments ADD COLUMN status      TEXT NOT NULL DEFAULT 'ready';     -- 'uploading' | 'processing' | 'ready' | 'failed'
ALTER TABLE note_attachments ADD COLUMN media_type  TEXT DEFAULT NULL;                 -- 'audio' | 'video'
ALTER TABLE note_attachments ADD COLUMN duration_ms INTEGER DEFAULT NULL;
ALTER TABLE note_attachments ADD COLUMN video_codec TEXT DEFAULT NULL;
ALTER TABLE note_attachments ADD COLUMN audio_codec TEXT DEFAULT NULL;
ALTER TABLE note_attachments ADD COLUMN width       INTEGER DEFAULT NULL;
ALTER TABLE note_attachments ADD COLUMN height      INTEGER DEFAULT NULL;
ALTER TABLE note_attachments ADD COLUMN poster_key  TEXT DEFAULT NULL;
ALTER TABLE note_attachments ADD COLUMN received_bytes INTEGER NOT NULL DEFAULT 0;     -- progres unggah
ALTER TABLE note_attachments ADD COLUMN error       TEXT DEFAULT NULL;                 -- pesan untuk status 'failed'
ALTER TABLE note_attachments ADD COLUMN updated_at  TEXT DEFAULT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_note_attachments_client
  ON note_attachments(user_id, client_id) WHERE client_id IS NOT NULL;
```

- Baris media: `kind='media'`, `storage='local'`, `nextcloud_path=''` (kolom lama tetap `NOT NULL`), `file_size` = ukuran yang dideklarasikan saat init.
- Alasan memakai `note_attachments` (bukan tabel baru): snapshot Sampah (`SELECT *`) dan restore (`_table_columns`) otomatis membawa kolom baru, dan akses/daftar lampiran tetap satu tempat.
- `client_id` unik per pengunggah. Direktif merujuk `client_id`, bukan id angka, supaya isi note tidak perlu ditulis ulang setelah unggahan dibuat (menghindari bug `[tasklink:<cid>]`, audit S15).

### 4.2 Penyimpanan

Modul baru `media_storage.py`:

```python
class MediaStorage:                          # antarmuka
    def temp_path(self, key) -> Path         # tempat potongan ditulis selama unggah
    def commit(self, key, src: Path) -> None # pindahkan file final
    def local_path(self, key) -> Path | None # untuk ffprobe/ffmpeg (r2: unduh ke temp)
    def delete(self, key) -> None
    def accel_uri(self, key) -> str          # nilai X-Accel-Redirect
```

- `LocalStorage(root=MEDIA_ROOT)`, default `MEDIA_ROOT=/var/lib/alurik/media`. Kunci: `<yyyy>/<mm>/<uuid4><ext>`, poster `<...>.poster.jpg`. Ekstensi diambil dari format hasil sniff, bukan dari nama file. Potongan sementara di `MEDIA_ROOT/.tmp/<attachment_id>.part`.
- `R2Storage` hanya didefinisikan antarmukanya di v1 (tidak diimplementasikan); `accel_uri` nanti mengarah ke lokasi internal nginx yang mem-proxy ke URL R2 bertanda tangan dan meneruskan `Range`.
- Konfigurasi: `MEDIA_STORAGE=local`, `MEDIA_ROOT`, `MEDIA_MAX_FILE_MB=2048`, `MEDIA_CHUNK_MB=5`, `MEDIA_URL_SECRET` (wajib di produksi; fallback turunan dari secret JWT dengan peringatan di log), `MEDIA_ACCEL=1` (0 = Python menyajikan sendiri dengan Range, untuk dev/tes), `MEDIA_URL_TTL_SEC=21600`.

## 5. Alur unggah

### 5.1 Endpoint

| Endpoint | Fungsi |
|---|---|
| `POST /api/scratchpad/{note_id}/media` `{client_id, filename, size, mime}` | Cek akses note (`_note_access_clause`), `size` ≤ `MEDIA_MAX_FILE_MB`, ekstensi/mime termasuk daftar §5.3. Panggil `_media_quota_check(uid, size)` (v1 selalu lolos; diisi sesi kuota). Idempoten berdasarkan `(user_id, client_id)`: bila sudah ada untuk note yang sama, kembalikan baris yang ada beserta `received_bytes`. `client_id` yang sudah dipakai untuk note lain → 409. |
| `GET /api/media/{att_id}/upload` | `{received_bytes, size, status}` untuk melanjutkan. |
| `PATCH /api/media/{att_id}/upload` header `Upload-Offset: <n>`, body bytes | Hanya pengunggah, hanya status `uploading`. Bila `n != received_bytes` → 409 `{received_bytes}`. Body ≤ `MEDIA_CHUNK_MB` + 1 MB, total tidak boleh melampaui `size`. Ditulis append ke `.part` di threadpool, lalu `received_bytes` diperbarui. |
| `POST /api/media/{att_id}/complete` | Wajib `received_bytes == size`. Sniff magic bytes (§5.3); tidak cocok → hapus file, `status='failed'`, 415. Cocok → pindah ke kunci final, `status='processing'`, masukkan ke antrean worker. |
| `DELETE /api/scratchpad/attachments/{id}` (diperluas) | Pengunggah atau pemilik note. Untuk media: hapus file + poster dari penyimpanan, lalu baris. Membatalkan unggahan yang belum selesai juga lewat endpoint ini. |

Semua penolakan akses menjawab 404 dengan pesan yang sama seperti "tidak ditemukan".

### 5.2 Worker pemrosesan

- Satu thread latar belakang dengan antrean (satu file per waktu) di proses `webapp`. Saat start, baris berstatus `processing` dimasukkan lagi ke antrean.
- Langkah (subprocess dengan timeout, tanpa shell):
  1. `ffprobe -v error -print_format json -show_format -show_streams` → `media_type` (ada stream video bukan cover art → `video`, selain itu `audio`), `duration_ms`, codec, `width`/`height`. Gagal → `status='failed'`, `error="File tidak bisa dibaca sebagai audio/video"`, file dihapus.
  2. MP4/MOV/M4A dengan `moov` setelah `mdat` → `ffmpeg -i in -c copy -map 0 -movflags +faststart out`, lalu ganti file. Gagal remux tidak menggagalkan media (tetap `ready`, dicatat di log).
  3. Video → poster `ffmpeg -ss <min(1 dtk, durasi/10)> -i in -frames:v 1 -vf scale=640:-2 poster.jpg`. Gagal poster tidak menggagalkan media.
  4. `status='ready'`, `updated_at` diperbarui.
- `ffmpeg`/`ffprobe` tidak terpasang → `status='ready'` tanpa metadata dan peringatan di log; deploy mensyaratkan `apt install ffmpeg`.
- Pembersihan lazy (dipanggil bersama `_purge_expired_trashed_notes` dan saat start): baris `uploading` yang tidak bertambah selama 24 jam dihapus beserta `.part`-nya; berkas `.tmp` tanpa baris dihapus.

### 5.3 Format yang diterima

Ditentukan dari magic bytes, lalu dikonfirmasi `ffprobe`. `mime_type` disimpan dari hasil sniff, bukan dari klien.

| Jenis | Format (mime yang disajikan) |
|---|---|
| Audio | MP3 `audio/mpeg`, M4A/AAC `audio/mp4`, WAV `audio/wav`, OGG/Opus `audio/ogg`, WebM audio `audio/webm`, FLAC `audio/flac`, AMR/3GP audio `audio/3gpp` |
| Video | MP4 `video/mp4`, MOV `video/quicktime`, WebM `video/webm`, MKV `video/x-matroska`, 3GP `video/3gpp` |

Signature yang dicek: `ftyp` di offset 4 (MP4/MOV/M4A/3GP, dibedakan lewat brand), `ID3` atau frame sync MPEG (MP3), `OggS`, `RIFF....WAVE`, `1A 45 DF A3` (WebM/MKV), `fLaC`, `#!AMR`. Apa pun yang lain ditolak.

## 6. Penyajian dan Range

### 6.1 URL bertanda tangan

- `GET /api/media/{att_id}` (akses note): `{id, client_id, note_id, original_name, media_type, mime_type, file_size, duration_ms, width, height, status, error, received_bytes, uploaded_by, play_url, poster_url, download_url, expires_at}`. URL hanya diisi bila `status='ready'`.
- `GET /api/scratchpad/{note_id}/media/by-client/{client_id}`: sama, dicari lewat `client_id` di antara lampiran note itu. Dipakai player untuk me-resolve direktif.
- Token: `base64url(att_id . variant . exp) . base64url(HMAC-SHA256(MEDIA_URL_SECRET, ...))`, `variant ∈ {play, poster, download}`, berlaku `MEDIA_URL_TTL_SEC` (6 jam). Token tidak memuat JWT, sehingga log nginx tidak menyimpan token login.

### 6.2 `GET /media/{token}`

1. Validasi tanda tangan dan kedaluwarsa (bandingkan dengan `hmac.compare_digest`); baris harus masih ada dan `ready`. Gagal → 404.
2. Header respons: `Content-Type` dari DB (poster `image/jpeg`), `X-Content-Type-Options: nosniff`, `Content-Disposition: inline` (play/poster) atau `attachment` (download) dengan nama aman (`filename*=UTF-8''…`), `Cache-Control: private, max-age=<sisa umur token>`, `Accept-Ranges: bytes`, `Content-Security-Policy: sandbox; default-src 'none'`.
3. `MEDIA_ACCEL=1` → body kosong + `X-Accel-Redirect: /_alurik_media/<storage_key>`. nginx mengirim file dan menangani `Range`/`If-Range`, `206`, dan `416`.
4. `MEDIA_ACCEL=0` → Python menyajikan file sendiri dengan dukungan `Range` tunggal (`206`/`416`), dibaca bertahap. Hanya untuk dev/tes.

### 6.3 nginx

Ditambahkan ke `nginx-taskflow.conf` (template) dan langkah deploy:

```nginx
location /_alurik_media/ {
    internal;
    alias /var/lib/alurik/media/;
    add_header X-Content-Type-Options nosniff always;
    add_header Cache-Control "private, max-age=3600" always;
}
location ~ ^/api/media/\d+/upload$ {
    client_max_body_size 8m;
    proxy_request_buffering off;
    proxy_pass http://127.0.0.1:__PORT__;
    # header proxy sama dengan location /
}
```

Saat implementasi diverifikasi bahwa `Content-Type` dan `Content-Disposition` dari respons Alurik dipertahankan nginx pada `X-Accel-Redirect` (bila tidak, `alias` per tipe atau `types {}` kosong + `default_type` dari header). `MEDIA_ROOT` harus bisa ditulis user service `taskflow-web` dan dibaca user nginx.

### 6.4 Akses

- **Aplikasi:** siapa pun yang lolos `_note_access_clause(uid)` untuk note lampiran itu. Berlaku untuk media **dan lampiran lama** (D9): `GET /api/scratchpad/{note_id}/attachments`, `POST .../attachments`, `GET /api/scratchpad/attachments/{id}/view` memakai klausa akses note; hapus = pengunggah atau pemilik note.
- **Halaman publik:** direktif di note publish di-resolve **hanya di antara lampiran note itu sendiri**. Media tampil bila note dipublish dan, bila berpassword, cookie `pub_unlock_{slug}` valid (`_pub_note_unlocked`). Halaman publik menanam URL bertanda tangan yang dibuat saat render (6 jam).
  - Media milik note yang sama dianggap bagian isi note, sehingga aturan "note publish tepercaya" (ADR-009) tidak menghalanginya, termasuk unggahan anggota di note bersama: anggota yang bisa menambah media juga bisa mengedit isi note, dan pemilik yang mempublish note bersama menerbitkan isinya apa adanya.
  - `/pub/attachments/{id}` untuk baris media mengalihkan (302) ke URL bertanda tangan `download`, setelah pengecekan publish + password yang sudah ada.
- **Ekspor DOCX:** media ditulis sebagai teks "🎵/🎬 <nama file> (<durasi>)" tanpa file.
- **`/api/export/download`:** media tidak disertakan di v1 (hanya metadata di markdown); dicatat sebagai pengembangan.

## 7. Siklus hidup

| Kejadian | Media |
|---|---|
| Note masuk Sampah | Baris ikut snapshot dan dihapus dari tabel (mekanisme yang ada). File tetap. URL lama gagal karena baris tidak ada. |
| Note dipulihkan | Baris kembali dengan id yang sama; media normal lagi. |
| Note dihapus permanen (purge, hapus selamanya, kosongkan Sampah) | File + poster media di snapshot dihapus dari penyimpanan, sebelum baris Sampah dihapus. |
| Lampiran media dihapus | File + poster dihapus. Direktif yang tersisa di note tampil sebagai kartu "Media tidak tersedia". |
| Direktif dihapus dari isi note | File tetap sebagai lampiran note; bisa dihapus dari daftar lampiran. |
| Unggahan macet 24 jam | Baris + `.part` dihapus. |
| Akses ke workspace hilang | Note tidak bisa dibuka → media juga tidak. |

## 8. Isi note dan keamanan

### 8.1 Direktif

```
::media[3f6c2a1e-....]{name="rapat-senin.m4a"}
```

- Regex: `\\?::media\\?\[([0-9a-zA-Z_-]{1,64})\\?\](?:\s*\\?\{([^}]*)\\?\})?` (pola escape sama dengan `::draw`).
- Atribut yang dikenali hanya `name` (label sementara selama metadata belum termuat). Semua nilai di-escape. Atribut lain diabaikan.
- Direktif yang `client_id`-nya tidak ditemukan di lampiran note → kartu "Media tidak tersedia untukmu: sudah dihapus atau bukan bagian dari catatan ini." Pesan yang sama untuk semua kasus, supaya keberadaan lampiran note lain tidak bocor.

### 8.2 Hubungan dengan PR 1b XSS

- PR 1b (sesi lain) meng-escape semua HTML mentah di isi note kecuali `<br>`, `<details>`, `<summary>`, `<mark>` tanpa atribut, di penampil aplikasi dan halaman publik.
- Player disisipkan dengan pola placeholder yang sama dengan `::draw` (`MDABLK<n>MDABLKEND`) **setelah** sanitasi, berisi HTML yang dibuat Alurik dengan semua nilai di-escape. `<audio>`/`<video>`/`<iframe>` yang diketik di isi note tetap teks.
- Bila PR 1b menambah CSP, `media-src` harus mengizinkan `'self'` (dan origin API untuk APK).
- PR 2 (frontend) dikerjakan setelah PR 1b di-merge atau di-rebase di atasnya, supaya titik penyisipan player memakai jalur render yang sudah disanitasi.

### 8.3 Lain-lain

- Hanya tipe audio/video dari daftar §5.3 yang pernah disajikan lewat `/media/`, selalu dengan `nosniff` dan CSP `sandbox`. File HTML/SVG tidak bisa lolos sniff.
- Nama file dari klien hanya dipakai sebagai `original_name` (di-escape saat tampil, disanitasi di `Content-Disposition`), tidak pernah sebagai path.
- Token berlaku 6 jam dan tidak terikat user: siapa pun yang memegang URL bisa memutar sampai kedaluwarsa. Ini diterima (setara membagikan file), dan mencegah tautan permanen ditanam di situs lain.

## 9. UI

### 9.1 Mengunggah

- Tombol lampiran note (editor `NoteModal` dan `NotePanel`) menerima audio/video (`accept` diperluas). Gambar/PDF/dokumen tetap lewat jalur lama.
- Offline: tombol media nonaktif dengan tooltip "Butuh koneksi internet untuk mengunggah audio/video".
- Note yang belum punya id server: klien memanggil `__pushNow()` (maks 5 detik) dulu; bila tetap belum punya id → toast "Simpan catatan dulu, lalu lampirkan media".
- Klien membuat `client_id` (UUID), langsung menyisipkan direktif di posisi kursor, lalu: `POST init` → `PATCH` per 5 MB → `complete`. Player menampilkan "Mengunggah… 40%" dan tombol batal.
- Putus koneksi: dicoba ulang dengan jeda bertambah; offset diambil lagi lewat `GET .../upload`. Status unggahan yang belum selesai (`client_id`, note, nama, ukuran, `lastModified`) disimpan di `localStorage`. Setelah reload, player menampilkan "Unggahan terhenti — pilih file yang sama untuk melanjutkan"; file yang cocok (nama + ukuran + `lastModified`) dilanjutkan dari offset server.
- Selama unggah, note boleh diedit dan ditutup. Unggahan berjalan di level `App` sampai tab ditutup.

### 9.2 Player

- Komponen yang sama untuk penampil (mode baca), node view editor Milkdown, dan halaman Notes: kartu dengan ikon jenis, nama file, durasi, ukuran, dan:
  - `status='ready'`: `<video controls preload="metadata" playsinline poster=…>` atau `<audio controls preload="metadata">` dengan `src` dari `play_url`, ditambah tombol unduh. URL diminta saat kartu terlihat (IntersectionObserver), dan diminta ulang saat token kedaluwarsa atau player error (`error`/`stalled` setelah lewat `expires_at`), dengan posisi pemutaran dipertahankan.
  - `uploading`: progres + batal (pengunggah) atau "Sedang diunggah oleh <nama>" (user lain).
  - `processing`: "Memproses…", dicek ulang tiap 5 detik.
  - `failed`: pesan `error` + tombol hapus (untuk yang berhak).
  - `canPlayType(mime + codecs)` kosong: "Format ini mungkin tidak bisa diputar di perangkat ini" + tombol unduh, player tetap dicoba.
  - Offline: kartu "Butuh koneksi untuk memutar" dengan judul, durasi, dan poster bila ada di cache browser.
- Editor: node view atom (tidak bisa diketik di dalamnya), bisa dipilih dan dihapus seperti `::draw`. Menghapus direktif tidak menghapus file.
- Daftar lampiran note menampilkan media dengan ikon, durasi, status, dan tombol hapus sesuai hak.

### 9.3 Halaman publik

`_render_published_content` me-resolve direktif menjadi `<figure class="pub-media">` dengan `<video>`/`<audio controls preload="metadata">`, nama file (ter-escape), durasi, dan tautan unduh. Media `processing`/`failed`/tidak ditemukan → kartu "Media tidak tersedia".

### 9.4 Service worker dan aplikasi HP

- `sw.js`: `/media/`, `/api/media/`, dan `/api/scratchpad/*/media*` network-only dan tidak pernah di-cache; request dengan header `Range` tidak di-intercept.
- URL media dibangun dengan `API_BASE` (`apiUrl()`), supaya jalan di APK Tauri dan shell Capacitor. CSP Tauri `media-src` mengizinkan origin API.
- Unggah memakai `fetch` dengan `apiUrl()` dan header `Authorization`, bukan URL relatif.

## 10. Penanganan error

| Kondisi | Perilaku |
|---|---|
| File > `MEDIA_MAX_FILE_MB` | Ditolak di klien sebelum init; server juga 413 |
| Ekstensi/mime di luar daftar | Ditolak di klien; server 415 |
| Isi file tidak cocok magic bytes | `complete` → 415, baris `failed`, file dihapus |
| ffprobe gagal | `failed` + "File tidak bisa dibaca sebagai audio/video" |
| `Upload-Offset` tidak cocok | 409 + `received_bytes`; klien melanjutkan dari situ |
| Token kedaluwarsa | 404; klien meminta URL baru lalu melanjutkan di posisi yang sama |
| Note dihapus saat unggah | `PATCH`/`complete` → 404; klien membatalkan dan membersihkan status lokal |
| Disk penuh | `PATCH` → 507 "Penyimpanan server penuh"; baris tetap `uploading` sampai dibersihkan |
| `MEDIA_URL_SECRET` tidak diset | Fallback dari secret JWT + peringatan di log saat start |

## 11. Pengujian

**pytest (`tests/test_note_media.py`, `tests/test_note_attachments_access.py`)**
- Migrasi idempoten; kolom default untuk baris lama.
- Init: akses pemilik/anggota/non-anggota (404), batas ukuran, daftar format, idempoten `client_id`, `client_id` di note lain → 409.
- Unggah bertahap: urutan benar, offset salah → 409, melampaui `size` → 413, lanjut setelah "putus", hanya pengunggah.
- `complete`: ukuran kurang → 400, magic bytes palsu (HTML dengan ekstensi `.mp4`) → 415 + file dihapus.
- Worker (ffprobe/ffmpeg di-mock, plus satu tes integrasi dengan file kecil bila ffmpeg tersedia): metadata, faststart dipanggil hanya bila perlu, poster, `failed`.
- Token: valid, kedaluwarsa, tanda tangan salah, varian ditukar, baris dihapus → 404. Header `nosniff`, `Content-Disposition`, CSP, `X-Accel-Redirect` (ACCEL=1). Range dengan ACCEL=0: `206`, `Content-Range`, `416`.
- Akses lampiran lama dibuka untuk anggota (list/upload/view), hapus hanya pengunggah/pemilik note.
- Halaman publik: media note publish tampil; note berpassword tanpa cookie → tidak ada URL media di HTML; direktif yang menunjuk lampiran note lain → kartu tidak tersedia; nama file ter-escape.
- Sampah: trash → URL gagal; restore → kembali; purge/hapus selamanya/kosongkan → file terhapus dari `MEDIA_ROOT`.
- Pembersihan unggahan macet.

**node (`tests/offline/notemedia.test.js`)**
- Parser direktif (escape, atribut, id tidak valid), state unggah (offset, retry, resume dari `localStorage`, pencocokan file), pembuatan URL dengan `API_BASE`, aturan SW network-only untuk `/media/` dan request `Range`.

**Browser (Playwright, sebelum merge PR 2)**
Unggah audio dan video dari editor; progres; putus di tengah (route abort) lalu lanjut; player di mode baca, editor, dan halaman publik; seek (permintaan `Range` → `206`, dengan nginx lokal atau `MEDIA_ACCEL=0`); anggota workspace memutar dan mengunggah; offline → kartu; note berpassword di halaman publik.

## 12. Rilis

1. **PR backend** — migrasi, `media_storage.py` (local), endpoint unggah bertahap, worker, URL bertanda tangan + `/media/`, akses lampiran note bersama (D9), hapus/purge/pembersihan, render halaman publik, konfigurasi nginx di template, pytest. Tanpa frontend/SW.
   **Langkah deploy di VPS:** `sudo apt install ffmpeg`; buat `MEDIA_ROOT` (pemilik user service, bisa dibaca nginx); set `MEDIA_URL_SECRET` di env service; tambah blok nginx §6.3 lalu `sudo nginx -t && sudo systemctl reload nginx`; `sudo systemctl restart taskflow-web`.
2. **PR frontend** — unggah + progres + resume, player (mode baca, editor Milkdown, halaman Notes), daftar lampiran, aturan SW, `apiUrl()`. Naikkan versi SW. Dikerjakan setelah PR 1b XSS di-merge (atau di-rebase di atasnya).

Keputusan arsitektur dicatat sebagai ADR baru di `.agents/DECISIONS.md` bersama PR backend (nomor = nomor kosong berikutnya saat itu).

## 13. Di luar cakupan v1

- Kuota per user/paket (sesi terpisah; titik pasang `_media_quota_check`).
- Rekam langsung dari aplikasi (rencana lanjutan: rekam suara via MediaRecorder dengan unggah bertahap selama merekam).
- Konversi format (HEVC → H.264, Opus/AMR → AAC), di server atau di aplikasi HP sebelum unggah.
- Backend R2 (antarmuka sudah ada) dan pemindahan lampiran lama dari Nextcloud, termasuk penghapusan file Nextcloud saat purge.
- Media sebagai entitas lintas note.
- Simpan media untuk diputar offline.
- Media di `/api/export/download`.
- Transkrip, subtitle, atau chapter.
