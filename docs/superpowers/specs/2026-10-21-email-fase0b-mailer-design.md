# Email — Fase 0b: mailer andal (outbox + retry, HTML, SSL/STARTTLS, kartu Admin)

Tanggal: 2026-10-21 · Status: desain disetujui di chat, menunggu tinjauan spec

Lanjutan Fase 0a (PR #66, ADR-022). Peta fase email (analisis lengkap: Project claude.ai "alurik" `claude/analisis-email-alurik-2026-10-20.md`): 0a perbaikan akun (selesai) · **0b mailer andal (spec ini)** · 1 keamanan akun (verifikasi email, notifikasi ganti email/password, login via link email) · 2 email sebagai kanal notifikasi · 3 email-in (email → task).

## Latar

- Produksi **masih dev mode**: `.env` di server tidak berisi `SMTP_*` sama sekali (dicek Bapak 2026-10-21). Email reset password tidak pernah terkirim; link hanya tercetak di log `taskflow-web`.
- `mailer.py` sekarang: plain text saja, selalu `starttls()` (port 465/SSL tidak bisa), dikirim langsung dari `BackgroundTasks` FastAPI, gagal = hanya dicatat di log, tanpa retry, tanpa jejak status.
- Layanan SMTP **belum dipilih** (Brevo / Resend / SES / Exim HestiaCP diputuskan nanti, kemungkinan saat pindah ke alurik.com). Mailer harus netral dan bisa diverifikasi begitu `.env` diisi.

## Tujuan

- Email tidak hilang saat SMTP sedang gagal atau server di-restart: setiap email lewat **antrean persisten** dengan percobaan ulang.
- Mendukung server SMTP mana pun lewat `.env`: STARTTLS (587), SSL (465), atau tanpa enkripsi (tes lokal).
- Email tampil rapi (HTML bermerek + cadangan teks), aman (semua nilai di-escape), dan tidak memicu balasan otomatis.
- Admin bisa melihat status SMTP, mengirim **email tes**, melihat 20 email terakhir, dan mengulang email gagal — tanpa membaca log.

## Keputusan Bapak

| Topik | Pilihan |
|---|---|
| Layanan SMTP | Belum dipilih — mailer netral, diatur lewat `.env` |
| Pengiriman | Pendekatan A: outbox di SQLite + worker thread di `taskflow-web` |
| Kartu Admin | Ya: status SMTP, kirim email tes, 20 email terakhir, coba lagi |
| Arsitektur, konfigurasi & template, kartu Admin + error + tes | Disetujui per bagian di chat |

## Bagian 1 — Arsitektur & alur data

### 1.1 Modul (di luar `webapp.py`; tidak mengimpor `webapp`)

- **`mailer.py`** — transport SMTP saja. `send_message(msg: EmailMessage) -> None` membuka koneksi sesuai `SMTP_SECURITY`, login bila `SMTP_USER` diisi, mengirim dengan envelope sender bare address (`parseaddr(SMTP_FROM)[1]`, perilaku yang sudah ada). `SMTP_HOST` kosong → **dev mode**: cetak penerima + subjek + isi teks ke stdout/log (`[MAILER DEV MODE]`, format sekarang dipertahankan agar cara cek di log tetap berlaku) dan kembali tanpa error. Melempar `MailPermanentError` / `MailTemporaryError` (lihat 3.4). `send_reset_email` lama dihapus; pemanggil pindah ke outbox.
- **`email_templates.py`** — fungsi murni yang mengembalikan `RenderedEmail(subject, text, html)`: `reset_password(username, link)` dan `smtp_test(host, port, security, sent_at)`. Satu kerangka HTML bersama (`_layout(title, body_html, cta_label, cta_url)`).
- **`email_outbox.py`** — `enqueue(conn, *, kind, to_addr, rendered, user_id=None, expires_at=None) -> int` (menulis baris, tanpa commit sendiri — ikut transaksi pemanggil) dan `EmailWorker(connect, send=mailer.send_message, now=…)` dengan `start()`, `wake()`, `run_due() -> int` (memproses semua baris yang jatuh tempo; dipakai thread dan tes), `recover_stale()`, `purge_old()`. Pola mengikuti `media_worker.py`: satu thread daemon, `process` tidak pernah melempar.

### 1.2 Tabel `email_outbox` (migrasi idempoten `CREATE TABLE IF NOT EXISTS` di `migrate_db`)

| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | INTEGER PK | |
| `kind` | TEXT NOT NULL | `reset`, `test` (Fase 1–2 menambah jenis lain) |
| `user_id` | INTEGER NULL | pemilik email bila ada; tanpa FK |
| `to_addr` | TEXT NOT NULL | |
| `subject`, `body_text`, `body_html` | TEXT NOT NULL | |
| `status` | TEXT NOT NULL | `queued` · `sending` · `sent` · `failed` · `expired` |
| `attempts` | INTEGER NOT NULL DEFAULT 0 | |
| `last_error` | TEXT NULL | maks 300 karakter, tanpa kredensial |
| `next_attempt_at` | TEXT NOT NULL | ISO UTC naif (sama dengan `media_worker._now()`) |
| `expires_at` | TEXT NULL | lewat waktu ini → `expired`, tidak dikirim |
| `created_at`, `updated_at` | TEXT NOT NULL | |
| `sent_at` | TEXT NULL | |

Indeks: `(status, next_attempt_at)` untuk worker, `(created_at)` untuk kartu Admin dan pembersihan.

### 1.3 Alur

1. `POST /api/auth/forgot` membuat token reset seperti sekarang, lalu dalam transaksi yang sama `enqueue(kind="reset", user_id, to_addr=email, rendered=reset_password(...), expires_at=now+50 menit)`; setelah commit memanggil `email_worker.wake()`. Respons tetap `_FORGOT_GENERIC`; pembatasan 3 permintaan/jam per user tetap.
2. Worker bangun saat `wake()` atau tiap **30 detik**, mengambil baris `status='queued' AND next_attempt_at <= now` (urut `id`, maks 20 per putaran).
3. Per baris: bila `expires_at` lewat → `expired`. Selain itu klaim atomik `UPDATE … SET status='sending', attempts=attempts+1 WHERE id=? AND status='queued'` (rowcount 0 = dilewati), lalu kirim.
4. Sukses → `sent`, `sent_at`. Gagal sementara → kembali `queued` dengan `next_attempt_at` = now + jeda menurut `attempts`: **1 → 1 menit, 2 → 5 menit, 3 → 30 menit, 4 → 2 jam**; percobaan ke-5 gagal → `failed`. Gagal permanen → langsung `failed`.
5. Start (`startup` di webapp, sebelum `start()`): `recover_stale()` mengembalikan `sending` → `queued` (server mati di tengah kirim; risiko terburuk satu email ganda — diterima), lalu `purge_old()`.
6. Pembersihan: baris `sent`, `expired`, dan `failed` yang berumur > 30 hari dihapus (isi email reset memuat link sensitif). Dijalankan saat start dan sekali per hari oleh worker.

### 1.4 Batasan

- Worker hanya di proses `taskflow-web` (uvicorn satu proses, `reload=False`). Bot Telegram tidak menjalankan worker; di fase berikutnya bot cukup menulis ke tabel yang sama.
- Isi email (subjek/body) **tidak pernah** ditampilkan di Admin atau API — hanya metadata.
- Tes: `BackgroundTasks` tidak lagi dipakai untuk email. Fixture `captured_emails` di `tests/conftest.py` diganti membaca baris `email_outbox` (kind, to_addr, body_text untuk mengambil link reset).

## Bagian 2 — Konfigurasi & template

### 2.1 `.env` (`config.py`)

Tetap: `SMTP_HOST`, `SMTP_PORT` (bawaan 587), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` (bawaan `Alurik <noreply@localhost>`).

Baru:
- `SMTP_SECURITY` = `starttls` | `ssl` | `none`. Kosong → ditebak dari port: 465 → `ssl`, selain itu `starttls`. Nilai lain → log peringatan + `starttls`.
- `SMTP_REPLY_TO` — opsional, header `Reply-To`.
- `SMTP_TIMEOUT` — detik, bawaan 15.

`.env.example` diperbarui: blok SMTP berisi keterangan dev mode, contoh terkomentar Brevo (`smtp-relay.brevo.com:587 starttls`), Resend (`smtp.resend.com:465 ssl`, user `resend`), dan Exim lokal (`localhost:587 starttls`).

### 2.2 Pesan

- `EmailMessage` multipart/alternative: `text/plain` lalu `text/html`, UTF-8.
- Header: `From` (`SMTP_FROM`), `To`, `Subject`, `Date` (`formatdate(localtime=False)`), `Message-ID` (`make_msgid(domain=<domain SMTP_FROM>)`, fallback `alurik.local`), `Reply-To` bila diisi, `Auto-Submitted: auto-generated`, `X-Auto-Response-Suppress: All`.
- Pesan disusun saat **pengiriman** dari kolom tabel (Message-ID/Date baru tiap percobaan).

### 2.3 Tampilan HTML

- Tabel satu kolom, lebar maks 560 px, latar halaman `#f1f5f9`, kartu putih, sudut membulat.
- Header: wordmark teks "Alurik" warna lime `#a8c500` di atas slate gelap `#0f172a` (tanpa gambar).
- Satu tombol utama (lime, teks gelap) + link teks penuh di bawahnya ("Jika tombol tidak berfungsi, salin link ini: …").
- Footer kecil abu-abu: "Email ini dikirim otomatis oleh Alurik · <domain dari WEBAPP_URL>".
- Semua CSS inline; tanpa gambar eksternal, font web, maupun piksel pelacak. Semua nilai yang disisipkan di-escape (`html.escape`, termasuk atribut `href`; link hanya `http`/`https`).

### 2.4 Template

- **Reset password** — subjek "Reset Password Alurik". Isi: sapaan dengan username, "Klik tombol di bawah untuk membuat password baru", tombol "Buat password baru", "Link berlaku 1 jam dan hanya bisa dipakai sekali", "Jika kamu tidak meminta reset password, abaikan email ini — password-mu tidak berubah." Versi teks setara dengan email yang sekarang.
- **Email tes** — subjek "Email tes Alurik". Isi: "SMTP Alurik berfungsi", host, port, mode keamanan, waktu kirim (WIB). Tanpa user/password.

## Bagian 3 — Kartu Admin, error, tes

### 3.1 Endpoint (dependensi `get_admin_user`)

- `GET /api/admin/email/status` →
  ```json
  {"mode": "dev|smtp", "host": "...", "port": 587, "security": "starttls", "from": "Alurik <noreply@...>",
   "worker_alive": true,
   "counts_7d": {"sent": 0, "failed": 0, "queued": 0, "expired": 0},
   "recent": [{"id": 1, "kind": "reset", "to": "hi***@jatahku.com", "status": "sent", "attempts": 1,
               "last_error": null, "created_at": "...", "sent_at": "..."}]}
  ```
  `host`/`port`/`security` null pada dev mode. `queued` termasuk `sending`. `recent` = 20 terbaru. Penyamaran penerima: 2 karakter pertama bagian lokal (atau seluruhnya bila lebih pendek) + `***@` + domain ("hi@jatahku.com" → "hi***@jatahku.com", "a@b.id" → "a***@b.id").
- `POST /api/admin/email/test` body `{"to": "opsional"}` → bawaan email admin; tanpa keduanya → 400 "Isi alamat tujuan atau tambahkan email di Pengaturan". Validasi `EMAIL_RE`. Batas **5 email tes per jam** (hitung baris `kind='test'` 1 jam terakhir, global) → 429. Hasil `{"id": n}` lalu `wake()`.
- `POST /api/admin/email/{id}/retry` → hanya `status='failed'`; set `queued`, `attempts=0`, `next_attempt_at=now`, `last_error` dipertahankan sampai percobaan berikutnya; `wake()`. Email `reset` yang `expires_at`-nya lewat → 400 "Link reset sudah kedaluwarsa — minta reset baru". Status lain → 400. Tidak ada → 404.

### 3.2 UI — kartu "Email" di `AdminPage`

- Kartu baru di atas daftar user. Judul "Email" dengan ikon gaya Alurik (glyph inline duotone `VIEW_GLYPHS`, bukan emoji).
- Badge: dev mode → kuning "Dev mode — email hanya dicetak ke log server"; smtp → hijau "SMTP: host:port · starttls"; `worker_alive=false` → merah "Worker email tidak berjalan".
- Ringkasan 7 hari: Terkirim · Gagal · Antre · Kedaluwarsa.
- Form "Kirim email tes": input email (placeholder email admin) + tombol. Setelah kirim, polling `status` tiap 3 detik maks 30 detik sampai baris itu `sent`/`failed`, lalu toast.
- Tabel 20 email terakhir: Jenis (Reset / Tes), Penerima tersamar, Status (chip berwarna), Percobaan, Waktu, Error (dipotong, title berisi teks penuh), aksi "Coba lagi" untuk `failed`. ≤ 768 px → daftar kartu. Tombol "Muat ulang".
- Tema terang + gelap memakai token CSS yang ada; tanpa `border-left` aksen; tanpa scroll horizontal di 375 px.
- Online saja (halaman Admin memang online). Gagal muat → "Gagal memuat status email" + "Coba lagi".

### 3.3 Logika murni klien

`static/offline/emailadmin.js` (`window.TF.emailadmin`): `statusLabel`, `kindLabel`, `badgeFor(status)`, `isPollingDone(row)`, `formatAttempts`. Dimuat seperti helper offline lain dan masuk daftar precache SW.

### 3.4 Klasifikasi error

- **Permanen** → `failed` langsung: `SMTPAuthenticationError`, `SMTPSenderRefused`/`SMTPRecipientsRefused`/`SMTPDataError` dengan kode 5xx, `SMTPNotSupportedError`, `ssl.SSLCertVerificationError`, konfigurasi tidak valid.
- **Sementara** → retry: timeout, `OSError`/`ConnectionError`, `SMTPServerDisconnected`, `SMTPConnectError`, kode 4xx, exception lain yang tak dikenal.
- `last_error` = `"<KelasError> <kode> <pesan>"` dipotong 300 karakter; kredensial tidak pernah disertakan (pesan SMTP dari server tidak memuat password; teks juga disaring dari nilai `SMTP_PASSWORD` bila kebetulan muncul).
- Exception apa pun di dalam worker ditangkap dan dicatat (`log.exception`); thread tidak mati. Bila thread mati (seharusnya tidak), `worker_alive=false` tampil di Admin dan `wake()` mencoba `start()` ulang.

### 3.5 Pengujian

- **pytest** `tests/test_email_outbox.py`, `tests/test_email_templates.py`, `tests/test_admin_email.py`, `tests/test_mailer.py`:
  - mailer: `smtplib.SMTP`/`SMTP_SSL` di-monkeypatch dengan kelas palsu yang merekam pemanggilan → mode `starttls` (memanggil `starttls`), `ssl` (memakai `SMTP_SSL`), `none`, login hanya bila user diisi, envelope sender bare, header lengkap, multipart text+html, dev mode tidak membuka koneksi.
  - Tes pulang-pergi sungguhan dengan `aiosmtpd` **opsional** (`pytest.importorskip("aiosmtpd")`); CI tidak diubah.
  - template: escape username/link (`<script>`), link non-http ditolak, teks dan HTML memuat link yang sama.
  - outbox dengan jam yang dikendalikan: jadwal retry 1/5/30/120 menit, `failed` di percobaan ke-5, permanen → `failed` langsung, `expired`, klaim ganda tidak mengirim dua kali, `recover_stale`, `purge_old` 30 hari, worker tidak mati saat `send` melempar exception acak.
  - endpoint: non-admin 403, status (dev/smtp, penyamaran, tanpa subjek/isi), email tes (default email admin, tanpa email → 400, batas 5/jam → 429), retry (`failed` saja, reset kedaluwarsa → 400).
  - alur lupa password: baris `reset` dibuat dengan `expires_at` +50 menit; respons generik tetap; batas 3/jam tetap; tes lama `tests/test_forgot_password.py` disesuaikan dengan fixture baru.
- **node** `tests/offline/emailadmin.test.js` (helper) + tes sumber kartu Admin (endpoint dipanggil, polling dibatasi 30 detik, chip status, tanpa emoji di judul).
- `node temporary_files/check_inline_scripts.js static/index.html`.
- E2E Playwright (skrip di `temporary_files/`): admin membuka kartu (dev mode), kirim email tes → baris berstatus `sent` (dev mode mencatat terkirim; badge kartu tetap "Dev mode"); terang + gelap, 375 px.

### 3.6 Versi & deploy

- SW dan `app.css?v=` naik ke nomor kosong berikutnya saat implementasi (cek `main`; saat spec ditulis `main` = v445 / 351).
- Deploy: tabel baru → `sudo systemctl restart taskflow-web`. Bot tidak perlu restart.
- ADR baru di `.agents/DECISIONS.md`: "Email lewat outbox SQLite + worker thread di taskflow-web".

## Checklist setelah merge (oleh Bapak, saat memilih layanan SMTP)

1. Pilih layanan, verifikasi domain pengirim (yatno.web.id sekarang atau alurik.com setelah pindah).
2. DNS di Cloudflare: **SPF** (`v=spf1 include:<layanan> ~all`, gabungkan dengan SPF yang sudah ada — hanya boleh satu record SPF), **DKIM** (record dari layanan), **DMARC** (`_dmarc` → `v=DMARC1; p=none; rua=mailto:<alamat>` dulu, naikkan ke `quarantine` setelah aman).
3. Isi `.env` di `/home/yatno/todo-system/taskflow-v4/.env`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM="Alurik <noreply@domain>"`.
4. `sudo systemctl restart taskflow-web` → Admin → kartu Email → badge hijau → "Kirim email tes" → cek inbox (dan folder spam).
5. Saat pindah ke alurik.com: perbarui `SMTP_FROM` dan `WEBAPP_URL`, ulangi langkah 2 untuk domain baru.

## Di luar cakupan

Verifikasi email, notifikasi ganti email/password, login via link email (Fase 1); ringkasan harian, digest, undangan via email, `List-Unsubscribe` (Fase 2); email masuk (Fase 3); bot Telegram menulis ke outbox; pemilihan layanan SMTP dan perubahan DNS.
