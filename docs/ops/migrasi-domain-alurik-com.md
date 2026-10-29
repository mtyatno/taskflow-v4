# Runbook: migrasi domain `todo.yatno.web.id` → `alurik.com`

- **Tanggal:** 2026-10-29
- **Keputusan:** ADR-036 (`.agents/DECISIONS.md`) — masa transisi dua domain, tanpa redirect `/api/*`.
- **Kode:** PR `claude/domain-alurik-com` (SW `taskflow-v487-domain-alurik`).
- **Pelaksana:** pemilik (server HestiaCP). Langkah bertanda 🖥 dikerjakan di VPS, 📱 di perangkat pengguna.

## Mengapa ada masa transisi

1. **Data offline terikat ke origin.** IndexedDB `taskflow-offline` (termasuk `_outbox`), `localStorage` (`tf_token`, preferensi `tf_*`), pendaftaran Service Worker, dan pemasangan PWA milik `todo.yatno.web.id` tidak terbawa ke `alurik.com`. Perangkat harus menyelesaikan sinkron di domain lama sebelum pindah.
2. **Build Desktop/APK yang sudah terpasang** membawa `static/config.js` lama → tetap memanggil `https://todo.yatno.web.id` sampai pengguna memasang build baru.
3. **Preflight CORS tidak boleh di-redirect.** Semua request API membawa `Authorization: Bearer`, jadi browser mengirim `OPTIONS` dulu; redirect 301 pada preflight = network error. Redirect `/api/*` akan mematikan semua PWA/APK lama seketika.

## Urutan

### 0. Kode (sudah di PR ini)

`static/config.js` memuat kedua domain (`alurik.com`, `www.alurik.com`, `todo.yatno.web.id`), fallback Tauri → `https://alurik.com`; CSP Tauri `connect-src`/`media-src` memuat kedua domain; default `CORS_ALLOW_ORIGINS` dan `WEBAPP_URL` di kode mengikuti; `.env.example` mendokumentasikan keduanya; entri "Apa yang baru" v487 mengumumkan alamat baru. Setelah merge, `deploy.yml` menjalankan `compile.js` dan restart web. **Belum ada yang berubah bagi pengguna** karena domain lama tetap dilayani.

### 1. 🖥 DNS

- `A` (dan `AAAA` bila ada) `alurik.com` dan `www.alurik.com` → IP VPS.
- Bila lewat Cloudflare: mulai **DNS only** (awan abu-abu) supaya perilaku identik dengan domain lama. Proxy oranye bisa dicoba belakangan (SSE memakai keepalive 20 s, unggah media per-chunk 5 MB; keduanya aman di bawah batas Cloudflare).

### 2. 🖥 HestiaCP (user `files`)

1. Tambah web domain `alurik.com` dengan alias `www.alurik.com`; **proxy template `taskflow`** (→ `127.0.0.1:3002`).
2. SSL Let's Encrypt untuk apex + `www`, aktifkan force HTTPS.
3. Salin include nginx kustom `nginx.ssl.conf_alurik_media` dari `/home/files/conf/web/todo.yatno.web.id/` ke `/home/files/conf/web/alurik.com/` (blok `/_alurik_media/` + unggah; tanpa ini media dan `X-Accel-Redirect` gagal di domain baru). Lalu:
   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```
4. Redirect `www.alurik.com` → `https://alurik.com` (301, pertahankan path) agar data PWA tidak terbelah di dua origin.
5. Domain lama **tidak diubah** (tetap melayani penuh, tanpa redirect) sampai §7.

### 3. 🖥 `.env` produksi

File `/home/yatno/todo-system/taskflow-v4/.env` (dibaca `config.py` lewat `load_dotenv`; tidak disentuh `deploy.yml` karena di-gitignore):

```
WEBAPP_URL=https://alurik.com
CORS_ALLOW_ORIGINS=tauri://localhost,http://tauri.localhost,https://tauri.localhost,https://alurik.com,https://todo.yatno.web.id
```

Origin ditulis persis (skema + host), tanpa slash di belakang, tanpa path. Lalu:

```bash
sudo systemctl restart taskflow-web taskflow
```

Dua-duanya: `WEBAPP_URL` dipakai bot (tautan magic login `/auth/magic`, teks "Web: …") dan web (tautan reset password, `join_url` undangan workspace, `og_url` note publik).

### 4. 🖥 Verifikasi dari terminal

```bash
curl -sI https://alurik.com/api/version            # 200, JSON berisi sw_version
curl -si -X OPTIONS https://alurik.com/api/tasks \
  -H "Origin: https://todo.yatno.web.id" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: authorization" | grep -i access-control
curl -sI https://www.alurik.com/ | head -3         # 301 → https://alurik.com/
```

### 5. Verifikasi di browser (`https://alurik.com`)

- DevTools › Network: semua request ke `alurik.com/api/...` (bukan domain lama) — bukti `config.js` baru aktif.
- Application › Service Workers: terdaftar untuk `alurik.com`; Manifest: bisa di-install.
- Login, sinkron awal, unggah + putar media, chat workspace (request SSE berstatus pending), Sketsa (tldraw) dan mindmap (iframe same-origin).
- Telegram `/start` menampilkan `Web: alurik.com`; magic link membuka `alurik.com`.

### 6. 📱 Setiap perangkat (termasuk milik pemilik)

1. Buka domain lama **saat online**, tunggu sinkron selesai (tidak ada perubahan tertunda). Jangan pindah saat sesi Pomodoro berjalan (`tf_pomo_state` per origin).
2. Buka `https://alurik.com`, login, pasang PWA (Tambahkan ke layar utama), hapus ikon lama.
3. Atur ulang preferensi per perangkat (tema/palet, latar hero, mode tampilan daftar, Live Edit). Yang di server (pin workspace, tahap Kanban, realisasi 🍅) aman.
4. Aplikasi Desktop/Android tidak perlu diapa-apakan sampai build baru beredar.

### 7. Penutupan (2–4 minggu setelah §5)

1. Pastikan tidak ada perangkat yang masih tertahan di domain lama (tanya pengguna; log nginx domain lama).
2. Hestia: ubah `todo.yatno.web.id` menjadi redirect 301 ke `https://alurik.com` (pertahankan path). Catatan: PWA lama yang masih terpasang akan terlihat "offline" terus (shell tersaji dari cache, API gagal karena preflight di-redirect) — itu memang sinyal untuk pindah; pengumuman v487 sudah menjelaskannya.
3. PR pembersihan (setelah build Desktop/APK baru beredar): hapus `todo.yatno.web.id` dari `static/config.js`, CSP `src-tauri/tauri.conf.json`, default CORS `webapp.py`, `.env` produksi, dan tes; bump SW.

## Rollback

Selama §1–§6 domain lama tidak berubah, jadi rollback = berhenti mengarahkan orang ke `alurik.com`; tidak ada migrasi data. Nilai `.env` lama bisa dikembalikan dan service di-restart.
