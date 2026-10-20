# Spec: Pengamanan XSS (PR 1b)

- **Tanggal:** 2026-10-19
- **Basis kode:** `main` setelah PR #45 (SW `taskflow-v421-drawing-workspace`)
- **Status:** desain disetujui di chat 2026-10-19. CSP seluruh aplikasi dipisah ke PR sendiri. Spec tertulis ini menunggu review pemilik.
- **Salinan:** repo `docs/superpowers/specs/2026-10-19-xss-hardening-design.md` dan Project claude.ai "alurik" `claude/spec-xss-hardening-2026-10-19.md`.
- **Asal:** temuan §3 butir 1 di `2026-10-18-workspace-drawing-project-design.md`, inventaris sink 2026-10-19.

---

## 1. Tujuan

Isi yang dibuat satu pengguna tidak boleh menjalankan script atau menyuntik atribut HTML di browser orang lain. "Orang lain" di sini adalah pengunjung halaman publik, anggota workspace, dan pembaca notifikasi. Aplikasi dan halaman publik ada di origin yang sama, dan token login disimpan di `localStorage` (`tf_token`). Karena itu satu script yang lolos bisa mengambil alih akun.

**Kriteria berhasil**

1. Payload berikut tidak pernah berjalan dan tidak pernah menjadi tag atau atribut di halaman publik, mode baca, cetak, maupun notifikasi: `<script>`, `<img src=x onerror=…>`, `<svg onload=…>`, `[x](javascript:…)`, `![x](x"onerror="…)`, `</title><script>`, serta judul, tag, nama file, atau username yang berisi `<`, `"`, atau `'`.
2. `<br>`, `<details>`, `<summary>`, dan `<mark>` yang sudah dipakai di note tetap tampil sebagai format.
3. SVG drawing yang berisi `<script>` atau `onload` tampil sebagai gambar dan scriptnya tidak berjalan.
4. Pesan Telegram berisi judul dengan `<` atau `&` terkirim dengan benar.

## 2. Aturan isi note (server dan klien sama)

### 2.1 HTML mentah

- Semua HTML mentah di isi note di-escape saat markdown dirender.
- Setelah itu, **hanya** bentuk persis berikut yang dikembalikan menjadi tag. Pencocokan tidak peka huruf besar/kecil, tanpa atribut, tanpa spasi selain `<br />`:
  `<br>`, `<br/>`, `<br />`, `<details>`, `</details>`, `<summary>`, `</summary>`, `<mark>`, `</mark>`.
- Pengembalian dilakukan pada keluaran HTML dengan mengganti bentuk ter-escape (`&lt;br&gt;` dan sejenisnya). Bentuk itu hanya bisa berasal dari teks pengguna yang sudah di-escape, jadi tidak ada jalur untuk menyisipkan atribut.
- Di dalam blok kode dan kode inline, bentuk ter-escape **tidak** dikembalikan. `<br>` di dalam backtick tetap tampil sebagai teks.

### 2.2 URL

- `href` link dan `src` gambar hanya boleh berupa:
  - skema `http:`, `https:`, `mailto:`, atau `tel:`;
  - path relatif (`/…`, `./…`, `../…`, nama file);
  - `#…`;
  - untuk gambar saja, `data:image/(png|jpeg|gif|webp);base64,…`.
- Selain itu, link menjadi teks biasa dan gambar menjadi teks alt.
- Skema diperiksa setelah entity didecode dan spasi/kontrol dibuang. Jadi `java&#x73;cript:` dan `\tjavascript:` tetap ditolak.
- Semua nilai atribut ditulis lewat fungsi escape atribut, yang meng-escape `&`, `<`, `>`, `"`, dan `'`.

### 2.3 Kartu buatan Alurik

- Kartu buatan Alurik (drawing `::draw`, wikilink, tasklink, callout, highlight `==x==`, math, dan nanti player `::media`) tetap disisipkan lewat placeholder **setelah** langkah escape, dengan semua nilai di-escape.
- Teks judul dan isi callout di-escape.
- Atribut `::draw[…]{size,width,height}` divalidasi:
  - `size` ∈ `S|M|L`;
  - `width`/`height` cocok `^\d{1,4}(px|%)$` atau kata `small|medium|large`.
  - Nilai yang tidak cocok diabaikan dan default dipakai.

### 2.4 Server (`webapp.py`, `_render_published_content`)

- mistune 3 dibuat dengan `escape=True`. Allowlist §2.1 dijalankan pada keluaran HTML **sebelum** placeholder kartu diganti.
- Renderer link dan gambar di-override untuk menerapkan §2.2.
- Highlight `==x==` di-escape.
- Wikilink `[[judul]]` meng-escape judul.
- Renderer cadangan (dipakai bila mistune tidak bisa di-import) meng-escape semua teks dan hanya membuat heading, paragraf, dan tabel.

### 2.5 Klien (`static/index.html`, `renderMarkdown` + `marked.use`)

- Token `html` (block dan inline) di-render sebagai teks ter-escape, lalu allowlist §2.1 diterapkan.
- Renderer `link` dan `image` menerapkan §2.2.
- Konsumen `renderMarkdown` (mode baca, cetak, dan ekspor Word) ikut aman.
- Template cetak meng-escape judul note.
- Fungsi bersama ditaruh di modul baru `static/offline/safehtml.js` (`window.TF.safehtml`) supaya bisa dites dengan node:
  - `escapeHtml(s)`
  - `escapeAttr(s)`
  - `restoreAllowedTags(html)`
  - `safeUrl(url, {image})`
  - `safeDrawAttrs(attrs)`

  Server memakai implementasi Python dengan aturan dan tes kasus yang sama.

## 3. SVG drawing

- Pratinjau SVG **tidak pernah** dimasukkan ke DOM sebagai markup. Pratinjau selalu tampil lewat `<img>`:
  - **server (halaman publik):** `<img src="data:image/svg+xml;base64,…" alt="{judul}">`;
  - **klien:** `img.src = URL.createObjectURL(new Blob([svg], {type:"image/svg+xml"}))`, dan URL-nya dilepas saat diganti atau dibuang.
- Berlaku di:
  - render publik (inline);
  - script halaman publik yang memuat `/pub/drawings/{id}` dan listener `message`;
  - `hydrateDrawingPreviews`;
  - cetak note.
- Syarat isi tetap `trim().startsWith("<svg")`. Pemeriksaan `includes('<svg')` diganti. Isi yang tidak memenuhi syarat ditampilkan sebagai kartu "Gambar tidak tersedia".
- Listener `message` halaman publik memeriksa `e.source` (iframe drawing miliknya), dan selector-nya memakai `CSS.escape`.
- Ukuran tampilan diatur CSS container (`width:100%; height:auto; max-height` sesuai ukuran kartu).
- Akibat yang diterima: SVG yang memuat font atau gambar eksternal tampil tanpa sumber eksternal itu. Ekspor tldraw menanam font sendiri.

## 4. Notifikasi dan Telegram

- **Server:** setiap nilai dari pengguna yang masuk ke pesan notifikasi di-escape dengan `html.escape(…, quote=False)` saat pesan disusun. Nilai itu meliputi judul task, nama list/workspace, nama file, dan username. Tempatnya `webapp.py` `_notify_members_bg` dan semua pemanggil yang menyusun `<b>…</b>`, serta `repository.notify_list_members`. Pesan yang sama dikirim ke Telegram (`ParseMode.HTML`), jadi teks ter-escape tampil benar di sana.
- **`bot.py`:** semua judul, nama, dan teks dari pengguna yang masuk ke pesan `ParseMode.HTML` di-escape lewat satu helper `h(s)`.
- **Klien (daftar notifikasi):** pesan dirender lewat `TF.safehtml.renderNotificationHtml(msg)`.
  - Semuanya di-escape, lalu hanya `<b>`, `</b>`, `<i>`, `</i>`, dan `<br>` tanpa atribut yang dikembalikan.
  - Pesan lama yang tersimpan mentah ikut aman.
  - Entity yang di-escape server (mis. `&amp;lt;` hasil escape ganda) tidak boleh tampil ganda. Karena itu entity dasar (`&amp; &lt; &gt; &quot; &#x27; &#39;`) didecode dulu, lalu proses escape-dan-allowlist dijalankan.

## 5. Halaman publik: kolom lain

- `_esc` diganti `html.escape(s, quote=True)` untuk: judul (`<title>`, `og:title`, `<h1>`), author, `og:url`, tag, nama lampiran dan `alt`-nya, mime, dan TOC. Pemakaian `.format()` diganti supaya kurung kurawal tidak perlu digandakan. Bug `{{` yang tampil di hasil ikut beres.
- `cover_html` dibentuk dari elemen yang sudah aman di body, tanpa re-parse.
- Halaman password: `username` dan `slug` di `action` di-percent-encode lalu di-escape (`_pub_href`).
- Script KaTeX halaman publik tetap memakai `innerHTML`. Script itu hanya memproses body yang sudah aman, dan KaTeX meng-escape keluarannya sendiri. Tes memastikan `$<img onerror>$` tidak menjadi tag.

## 6. Header pengaman

- **Semua respons:** `X-Content-Type-Options: nosniff` (middleware).
- **Halaman `/pub/…` (HTML):**
  ```
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; media-src 'self' blob:; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'
  ```
  `'unsafe-inline'` tetap ada untuk script inline yang sudah ada. Perlindungan utama tetap escape di §2–5.
- **File yang disajikan `inline`:**
  - endpoint: `/pub/attachments/{id}` (cabang Nextcloud dan cabang file lokal) dan `/api/scratchpad/attachments/{id}/view`;
  - header tambahan: `Content-Security-Policy: sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'` (gambar saja; PDF tanpa sandbox — Chromium memblokir penampil PDF di dokumen sandbox) dan `nosniff` (semua, termasuk PDF; PDF tetap MIME persis `application/pdf` dan `inline`);
  - hanya mime gambar (`image/png|jpeg|webp|gif`) dan `application/pdf` yang boleh `inline`, selebihnya `attachment`.
- **Di luar cakupan:** CSP untuk SPA (`/`, `/static/…`). Dikerjakan di PR terpisah.

## 7. Lain-lain kecil

- mind-elixir (`static/vendor/mind-elixir/index.html`): bila `TF.renderTopicMd` tidak ada, topik di-escape, bukan dipakai mentah.
- `renderWikilinksPreview` dan renderer topik mindmap sudah aman. Tes regresi ditambah.

## 8. Pengujian

**pytest (`tests/test_pub_xss.py`, `tests/test_notification_escape.py`)**
- Render publik dengan setiap payload §1:
  - tidak ada `<script`, `onerror=`, `onload=`, `javascript:` sebagai atribut;
  - `<br>`, `<details>`, `<summary>`, dan `<mark>` tetap jadi tag;
  - `<br>` di dalam kode tetap teks.
- Kolom halaman publik (judul, tag, nama lampiran, TOC, username dengan `"<>'`) ter-escape. Halaman password ter-escape.
- SVG drawing berisi `<script>` hanya muncul sebagai `<img src="data:image/svg+xml;base64,…">`.
- Atribut `::draw{width='x" onclick="…'}` diabaikan.
- Header: CSP `/pub`, `nosniff` di respons API, `sandbox` di `/pub/attachments` dan `/view`, non-gambar/PDF menjadi `attachment`.
- Notifikasi: judul task `<img onerror>` tersimpan ter-escape. Pesan Telegram (mock) memakai teks ter-escape.
- Renderer cadangan (mistune di-mock tidak ada) meng-escape.

**node (`tests/offline/safehtml.test.js`, `tests/offline/render_markdown_xss.test.js`)**
- Kasus yang sama untuk `safehtml.js` dan `renderMarkdown`: HTML mentah, allowlist, URL berbahaya termasuk varian entity/spasi, atribut gambar, callout, dan atribut `::draw`.
- `renderNotificationHtml`: pesan lama mentah, pesan baru ter-escape, tanpa escape ganda.
- `hydrateDrawingPreviews` membuat `<img>`, bukan markup SVG.

**E2E (Playwright, dua akun)**
- A membuat note berisi payload §1 lalu mempublish. Halaman publik dan mode baca B (note bersama) tidak menjalankan payload (dicek dengan `window.__xss` yang tetap undefined), dan format allowlist tampil.
- Drawing W dengan SVG ber-script tampil sebagai gambar di note B.
- Judul task ber-payload memicu notifikasi ke B, dan daftar notifikasi B tidak menjalankannya.

## 9. Rilis

- Satu PR: `webapp.py`, `repository.py`, `bot.py`, `static/index.html`, `static/offline/safehtml.js` (baru), `static/vendor/mind-elixir/index.html`, `static/sw.js` (versi naik dan precache `safehtml.js`), serta tes.
- Setelah deploy: `sudo systemctl restart taskflow-web taskflow`.
- Keputusan dicatat sebagai ADR baru di `.agents/DECISIONS.md`.

## 10. Di luar cakupan

- CSP untuk seluruh aplikasi (PR terpisah, berikutnya).
- SSRF di ekspor DOCX dan traceback di respons ekspor (temuan §3 butir 2).
- Lampiran di note bersama untuk anggota (masuk spec audio/video D9).
- 500 untuk `[[<20+ digit>]]` (temuan §3 butir 4).
- Membatasi karakter username saat registrasi. Escape di §5 sudah menutup risikonya; aturan karakter bisa jadi PR kecil terpisah.
