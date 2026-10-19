# Rencana: pengamanan XSS (PR 1b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Tanggal: 2026-10-19 · Agent: Claude · Branch: `claude/xss-hardening` · Backend + frontend, **naik versi SW**

**Goal:** Isi buatan pengguna tidak bisa menjalankan script atau menyuntik atribut di halaman publik, mode baca/cetak, pratinjau drawing, dan notifikasi. `<br>`/`<details>`/`<summary>`/`<mark>` tetap jalan.

**Architecture:** Aturan escape-lalu-allowlist dibuat dua kali dengan perilaku sama:
- `safehtml.py` (server);
- `static/offline/safehtml.js` (klien, `window.TF.safehtml`).

Keduanya dites dengan kasus yang sama. Lapisan render memakai modul itu:
- server: `_render_published_content`, `view_published_note`, `_PASSWORD_GATE_HTML`, notifikasi, `bot.py`;
- klien: `renderMarkdown`/`marked.use`, `hydrateDrawingPreviews`, cetak, daftar notifikasi, mind-elixir.

SVG selalu tampil lewat `<img>`. Header pengaman (`nosniff`, CSP `/pub`, `sandbox` untuk file inline) dipasang di `webapp.py`.

**Tech Stack:** Python 3 + FastAPI + mistune 3, pytest; JS tanpa bundler (`window.TF.*`), marked 15 (vendored), `node --test`; Playwright Python untuk E2E.

**Spec:** `docs/superpowers/specs/2026-10-19-xss-hardening-design.md` (§1–§10).

## Global Constraints

- **Allowlist tag isi note (persis, tanpa atribut, tidak peka huruf):** `<br>`, `<br/>`, `<br />`, `<details>`, `</details>`, `<summary>`, `</summary>`, `<mark>`, `</mark>`.
  - Dikembalikan dari bentuk ter-escape pada keluaran HTML.
  - **Tidak** dikembalikan di dalam `<code>`/`<pre>`.
- **URL yang diizinkan:** `http:`, `https:`, `mailto:`, `tel:`, path relatif (`/…`, `./…`, `../…`, nama tanpa skema), dan `#…`.
  - Khusus gambar juga `data:image/(png|jpeg|gif|webp);base64,…`.
  - Skema diperiksa setelah decode entity HTML dan setelah karakter kontrol/spasi dibuang.
  - Link ditolak → teks biasa. Gambar ditolak → teks alt.
- **Escape atribut** meng-escape `& < > " '`.
- **Atribut `::draw`:**
  - `size` ∈ `S|M|L`;
  - `width`/`height` cocok `^\d{1,4}(px|%)$` atau `small|medium|large`;
  - selain itu diabaikan.
- **Allowlist notifikasi:** `<b>`, `</b>`, `<i>`, `</i>`, `<br>`, tanpa atribut. Entity dasar (`&amp; &lt; &gt; &quot; &#x27; &#39;`) didecode dulu, supaya pesan baru (ter-escape) tidak tampil dobel.
- **SVG:**
  - Tidak pernah masuk DOM sebagai markup.
  - Server memakai `<img src="data:image/svg+xml;base64,…" alt="{judul ter-escape}">`; klien memakai `img.src = URL.createObjectURL(new Blob([svg],{type:"image/svg+xml"}))`.
  - Syarat isi: `svg.trim().startsWith("<svg")`.
- **CSP `/pub/…` (persis):** `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; media-src 'self' blob:; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'`
- **File inline** (`/pub/attachments/{id}` cabang Nextcloud, `/api/scratchpad/attachments/{id}/view`):
  - header `Content-Security-Policy: sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'` + `X-Content-Type-Options: nosniff`;
  - `inline` hanya untuk `image/png|jpeg|webp|gif` dan `application/pdf`, selain itu `attachment`.
- **Semua respons:** `X-Content-Type-Options: nosniff`.
- **Tidak termasuk:** CSP untuk SPA, SSRF ekspor, dan aturan karakter username.
- **Versi SW:** naik ke string berikutnya setelah main saat eksekusi (sekarang `taskflow-v421-drawing-workspace` → `taskflow-v422-xss-hardening`). Precache `static/offline/safehtml.js`. `app.css` tetap `?v=334`.
- **Deploy:** restart `taskflow-web` **dan** `taskflow` (`bot.py` + `repository.py` berubah).
- **Tes:** `python3 -m pytest tests -q`; `npm test` (baseline: 1 kegagalan pra-ada `draw_local_reactive`); `node temporary_files/check_inline_scripts.js`.
- **Commit:** diakhiri trailer atribusi harness pelaksana. Jangan push.

## Review Focus

1. **Payload yang disamarkan:** `java&#x73;cript:`, `JaVaScRiPt:`, `\tjavascript:`, `<SCRIPT>`, `<scr<script>ipt>`, `<br onclick=x>`, `<mark style=…>`. Semuanya tidak menjadi tag atau atribut aktif.
   Tes: Task 1 dan Task 4 memakai tabel kasus `OBFUSCATED_CASES` yang sama.
2. **`<br>` di dalam blok kode/inline code** tetap tampil sebagai teks `<br>`, bukan baris baru.
   Tes: Task 1 (`test_allowlist_not_restored_inside_code`) dan Task 4.
3. **Notifikasi lama** di DB berisi HTML mentah (`<b>…</b><img onerror>`). `<b>` tetap tebal, `<img>` menjadi teks. Pesan baru yang judulnya mengandung `&` tampil `&`, bukan `&amp;`.
   Tes: Task 5 `renderNotificationHtml legacy and new messages`.
4. **Judul note publik berisi `{` `}` atau `%`.** Halaman tetap ter-render (tidak ada `KeyError`/`IndexError` dari `.format`), dan tidak ada `{{` yang tampil.
   Tes: Task 2 `test_public_title_with_braces_renders`.
5. **SVG berisi `<script>` dan `onload`** di drawing workspace. Di note anggota lain dan di halaman publik, isi itu hanya muncul sebagai `<img>`, dan `onload` tidak berjalan.
   Tes: Task 2 (server) dan Task 5 (klien) plus E2E Task 6.

---

### Task 1 — `safehtml.py` dan render markdown publik

**Files:**
- Create: `safehtml.py`, `tests/test_safehtml.py`
- Modify: `webapp.py` `_render_published_content` (±4370-4692): mistune, highlight, wikilink, kartu `::draw`, renderer cadangan
- Test: `tests/test_pub_xss.py` (bagian render isi)

**Interfaces:**
- Produces (`safehtml.py`, tanpa impor webapp):
  - `escape_html(s) -> str` (escape `& < >`)
  - `escape_attr(s) -> str` (escape `& < > " '`)
  - `restore_allowed_tags(html: str) -> str`: allowlist §Global; melewati isi `<code>…</code>` dan `<pre>…</pre>`
  - `safe_url(url: str, image: bool = False) -> str | None`: None = ditolak
  - `safe_draw_attrs(attrs: dict) -> dict`: hanya `size`/`width`/`height` yang valid; kunci lain (mis. `title`) diteruskan tanpa diubah, di-escape saat dipakai
  - `OBFUSCATED_CASES: list[str]`: payload Review Focus #1 + kriteria §1 spec, dipakai ulang tes Task 2/4
- Render publik:
  - mistune `create_markdown(escape=True, renderer=<subclass HTMLRenderer>, plugins=[...sama seperti sekarang])`;
  - subclass meng-override `link(text, url, title=None)` dan `image(text, url, title=None)` memakai `safe_url`;
  - `restore_allowed_tags` dijalankan pada keluaran mistune **sebelum** placeholder kartu diganti.

- [ ] **Step 1: Tulis tes yang gagal**

```python
# tests/test_safehtml.py
def test_escape_attr_quotes(): assert escape_attr('a"b\'c<') == 'a&quot;b&#x27;c&lt;'
def test_restore_allowed_tags_exact_forms_only():
    # &lt;br&gt; &lt;br/&gt; &lt;br /&gt; &lt;details&gt;… → tag; &lt;br onclick=x&gt; dan &lt;mark style=x&gt; tetap ter-escape
def test_allowlist_not_restored_inside_code():  # '<code>&lt;br&gt;</code>' tidak berubah
def test_safe_url_cases():
    # diizinkan: https://a.b, mailto:a@b, tel:1, /x, ./x, ../x, x.png, #h
    # ditolak (None): javascript:alert(1), JaVaScRiPt:x, java&#x73;cript:x, '\tjavascript:x', 'jav\x00ascript:x', data:text/html,x, vbscript:x
    # image=True: data:image/png;base64,AAAA diizinkan; data:image/svg+xml;base64,AAAA ditolak
def test_safe_draw_attrs():
    # {'size':'M','width':'50%','height':'300px'} lolos; {'width':'x" onclick="y','size':'Q'} → {} (keduanya dibuang)

# tests/test_pub_xss.py (render isi; helper publish dari tests/test_pub_access.py)
def test_public_body_escapes_raw_html_and_keeps_allowlist(client):
    # content: '<script>window.__x=1</script> <img src=x onerror=alert(1)> a<br>b <details><summary>S</summary>D</details> <mark>m</mark>'
    # halaman: tidak memuat '<script>window.__x', 'onerror=', memuat '&lt;script&gt;', '<br>', '<details>', '<summary>', '<mark>'
def test_public_links_and_images_filtered(client):
    # '[a](javascript:alert(1))', '![i](x"onerror="alert(1))', '[b](https://ok.example)'
    # tidak ada 'href="javascript:', tidak ada 'onerror=', ada 'href="https://ok.example"'
def test_public_obfuscated_cases(client):  # tiap OBFUSCATED_CASES: tidak ada '<script', ' on[a-z]+=' pada tag, 'javascript:' di atribut
def test_public_wikilink_and_highlight_escape(client):  # '[[<img src=x onerror=1>]]', '==<b>x</b>==' → ter-escape
def test_public_draw_attr_injection_ignored(client):  # "::draw[1]{width='x\" onclick=\"y'}" → tidak ada 'onclick='
def test_fallback_renderer_escapes(client, monkeypatch):  # paksa jalur tanpa mistune → '<script' tidak ada
```

- [ ] **Step 2:** `python3 -m pytest tests/test_safehtml.py tests/test_pub_xss.py -q` → FAIL
- [ ] **Step 3: Implementasi** sesuai Interfaces. Untuk memaksa jalur cadangan, ekstrak fungsi render cadangan supaya bisa dipanggil langsung atau di-monkeypatch. Jangan mengandalkan uninstall mistune.
- [ ] **Step 4:** `python3 -m pytest tests -q` → PASS. Tes PR 1 (`tests/test_pub_access.py`, `tests/test_drawing_workspace_public.py`) tetap lulus.
- [ ] **Step 5: Commit** — `fix(pub-xss): escape HTML mentah isi note publik, allowlist tag, filter URL`

---

### Task 2 — Halaman publik: kolom, SVG, script halaman, header

**Files:**
- Modify: `webapp.py`:
  - `view_published_note` (±6974-7197): judul, author, `og:url`, tag, lampiran, TOC, `cover_html`; ganti `.format()`/`_esc`
  - `_PASSWORD_GATE_HTML` dan pemakainya (±6883-6895, ±6995, ±7222)
  - kartu drawing di `_render_published_content` (±4597-4605): SVG → `<img data:>`
  - script halaman publik (±6838-6857): `/pub/drawings` dan listener `message`
  - `/pub/attachments/{id}` (±6897-6944) dan `/api/scratchpad/attachments/{id}/view` (±5409-5425): disposition + header
  - middleware `nosniff`
- Test: `tests/test_pub_xss.py` (lanjutan), `tests/test_security_headers.py`

**Interfaces:**
- Consumes: Task 1 `escape_html`, `escape_attr`, `OBFUSCATED_CASES`.
- Produces:
  - `safehtml.svg_img_tag(svg: str, alt: str, style: str = "") -> str | None`. None bila `not svg.strip().startswith("<svg")`.
  - Script klien halaman publik:
    - membuat `<img>` dari Blob untuk SVG yang dimuat `/pub/drawings/{id}`;
    - listener `message` memeriksa `e.source === iframe.contentWindow` dan memakai `CSS.escape` di selector.

- [ ] **Step 1: Tulis tes yang gagal**

```python
def test_public_fields_escaped(client):
    # judul '</title><script>window.__x=1</script>', tag '<img src=x onerror=1>', nama lampiran 'a"><img src=x onerror=1>.png', heading '# <img src=x onerror=1>'
    # halaman tidak memuat '<script>window.__x', 'onerror=1>' sebagai tag; '&lt;/title&gt;' ada
def test_public_title_with_braces_renders(client):   # judul 'a {b} {{c}} %d' → 200, tampil persis, tidak ada '{{'
def test_password_page_escapes_username_and_slug(client):  # username berisi '"' (buat via DB) → action ter-encode, tidak ada '" onfocus'
def test_public_svg_rendered_as_img(client):
    # drawing svg '<svg onload="window.__x=1"><script>window.__x=1</script></svg>' di note publish tepercaya
    # halaman: ada '<img src="data:image/svg+xml;base64,', tidak ada '<svg onload', tidak ada '<script>window.__x'
def test_public_page_script_uses_img_for_svg_and_checks_source(client):
    # sumber HTML halaman: tidak ada 'innerHTML = d.svg_preview' / 'innerHTML = e.data.svg'; ada 'createObjectURL' dan 'e.source'
# tests/test_security_headers.py
def test_nosniff_on_api_and_pub(client)
def test_pub_csp_exact(client)          # header CSP == string Global Constraints persis
def test_inline_attachment_headers(client, monkeypatch)
    # mock Nextcloud fetch; png → inline + sandbox CSP + nosniff; application/msword → attachment
def test_view_attachment_headers(client, monkeypatch)
```

- [ ] **Step 2:** → FAIL
- [ ] **Step 3: Implementasi.** Judul di `<title>`/`og:*` memakai `escape_attr`. Template disusun dengan f-string atau `string.Template`, tidak memakai `.format()` atas nilai pengguna. `nosniff` dipasang sebagai middleware HTTP. CSP `/pub` dipasang pada respons HTML halaman publik dan halaman password.
- [ ] **Step 4:** `python3 -m pytest tests -q` → PASS
- [ ] **Step 5: Commit** — `fix(pub-xss): escape kolom halaman publik, SVG via img, header nosniff/CSP/sandbox`

---

### Task 3 — Notifikasi server dan bot Telegram

**Files:**
- Modify:
  - `webapp.py`: semua penyusun pesan notifikasi. Grep `notify_list_members(`, `_notify_members_bg(` dan string `<b>{`. Contoh lokasi: ±1349, ±1358, ±1915, ±2079, ±2085, ±2107, ±2550, ±2604, ±2668, ±2810, ±2949.
  - `repository.py` `notify_list_members` (±1526-1549), bila menyusun teks.
  - `bot.py`: semua `ParseMode.HTML` dengan nilai pengguna. Contoh: ±812, ±1473, ±1497, ±1563, ±1592, ±2093, ±2135, ±2168, ±2195, ±2212, ±2320.
- Test: `tests/test_notification_escape.py`, `tests/test_bot_escape.py`

**Interfaces:**
- `bot.py`: helper `h(s) -> str` = `html.escape(str(s or ""), quote=False)`, dipakai pada setiap nilai pengguna di pesan HTML.
- `webapp.py`: nilai pengguna di pesan notifikasi lewat `html.escape(..., quote=False)` (atau `safehtml.escape_html`). Tag `<b>` dari template tetap ada.

- [ ] **Step 1: Tulis tes yang gagal**

```python
def test_task_title_in_notification_is_escaped(client):
    # A dan B di W; A membuat task W berjudul '<img src=x onerror=1> & co' → baris notifications untuk B memuat '&lt;img' dan '&amp; co', tidak memuat '<img'
def test_list_name_and_filename_escaped_in_notifications(client)  # join/invite/upload file berjudul payload
def test_bot_h_escapes(): assert bot.h('<b>&') == '&lt;b&gt;&amp;'
def test_bot_message_builders_escape_titles(monkeypatch)  # panggil 2 fungsi pembentuk pesan bot dengan judul '<x>' → teks terkirim memuat '&lt;x&gt;'
```

- [ ] **Step 2:** → FAIL
- [ ] **Step 3: Implementasi**
- [ ] **Step 4:** `python3 -m pytest tests -q` → PASS
- [ ] **Step 5: Commit** — `fix(notif-xss): escape nilai pengguna di notifikasi dan pesan Telegram`

---

### Task 4 — Klien: `safehtml.js` dan render markdown

**Files:**
- Create: `static/offline/safehtml.js` (dimuat di `index.html` sebelum skrip yang memakai `renderMarkdown`), `tests/offline/safehtml.test.js`, `tests/offline/render_markdown_xss.test.js`
- Modify: `static/index.html`:
  - `marked.use` (±20512-20564): renderer `html`, `link`, `image`, `listitem`
  - `renderMarkdown` (±20904-20956): callout title/body, atribut `::draw` (±20833-20851)
  - template cetak (±27253-27256): `note.title`

**Interfaces:**
- Produces (`window.TF.safehtml`, juga `module.exports` untuk node):
  - `escapeHtml`, `escapeAttr`, `restoreAllowedTags`, `safeUrl(url, {image})`, `safeDrawAttrs(attrs)`, `OBFUSCATED_CASES`. Perilakunya identik dengan Task 1; salin daftar kasus dari `safehtml.py`.
  - `renderNotificationHtml(msg)` dan `svgToImg(svg, alt)` didefinisikan di Task 5, di modul yang sama.
- **Urutan muat:** fungsi di index.html mengambil `window.TF.safehtml` saat dipanggil, bukan saat skrip dimuat (pelajaran PR 3: `drawingshare.js` membaca `TF.drawdirective` terlalu awal).

- [ ] **Step 1: Tulis tes yang gagal**

```js
// safehtml.test.js — kasus sama dengan tests/test_safehtml.py (escapeAttr, restoreAllowedTags, safeUrl, safeDrawAttrs, OBFUSCATED_CASES)
test("safehtml cases mirror server table")
// render_markdown_xss.test.js — muat marked.min.js + blok renderMarkdown dari index.html (pola tests/offline yang mengekstrak fungsi)
test("raw HTML escaped, allowlist kept, <br> in code stays text")
test("javascript: links become text; image src attribute breakout blocked")
test("obfuscated cases produce no active tag/attribute")
test("callout title/body escaped; draw attrs injection ignored")
test("print template escapes note title")
test("renderMarkdown resolves TF.safehtml lazily (module loaded after index script)")
```

- [ ] **Step 2:** → FAIL
- [ ] **Step 3: Implementasi**; `node temporary_files/check_inline_scripts.js` OK
- [ ] **Step 4:** `npm test` → hanya kegagalan pra-ada
- [ ] **Step 5: Commit** — `fix(app-xss): render markdown klien meng-escape HTML mentah, allowlist, filter URL`

---

### Task 5 — Klien: SVG via `<img>`, notifikasi, mind-elixir

**Files:**
- Modify:
  - `static/offline/safehtml.js`: tambah `renderNotificationHtml`, `svgToImg`
  - `static/index.html`: `hydrateDrawingPreviews` (±21495-21512), cetak drawing (±27267-27268, ±27418), daftar notifikasi (±34410)
  - `static/vendor/mind-elixir/index.html` (±915): fallback topik mentah → escape
- Test: `tests/offline/safehtml.test.js` (lanjutan), `tests/offline/svg_preview_img.test.js`

**Interfaces:**
- `renderNotificationHtml(msg: string) -> string`: decode entity dasar → escape semua → kembalikan allowlist notifikasi.
- `svgToImg(svg: string, alt: string) -> HTMLImageElement | null`: null bila tidak `startsWith("<svg")`. Pemanggil yang mengganti gambar wajib melepas URL lama (`URL.revokeObjectURL`).

- [ ] **Step 1: Tulis tes yang gagal**

```js
test("renderNotificationHtml legacy and new messages")
  // '<b>A</b> <img src=x onerror=1>' → '<b>A</b> &lt;img src=x onerror=1&gt;'
  // '<b>A &amp; B</b>' → '<b>A &amp; B</b>' (tampil "A & B", tidak dobel)
  // '<b onclick=x>A</b>' → teks
test("svgToImg returns img with blob url; non-svg returns null")
test("hydrateDrawingPreviews inserts <img>, never svg markup (svg with onload/script)")
test("print path uses img for drawing svg")
test("notification list renders via TF.safehtml.renderNotificationHtml")
test("mind-elixir fallback escapes topic when TF.renderTopicMd missing")
```

- [ ] **Step 2:** → FAIL
- [ ] **Step 3: Implementasi**; `check_inline_scripts` OK
- [ ] **Step 4:** `npm test`
- [ ] **Step 5: Commit** — `fix(app-xss): pratinjau SVG lewat img, notifikasi allowlist, fallback mind-elixir`

---

### Task 6 — Versi SW + E2E dua akun

**Files:**
- Modify: versi SW di `static/sw.js`, `static/index.html` (dua tempat), `webapp.py` `sw_cache`, `tests/test_version.py`, dan semua `tests/offline/*` yang mem-pin versi; precache `/static/offline/safehtml.js`
- Create: `temporary_files/e2e_xss.py` (pola `temporary_files/e2e_drawing_workspace.py`), screenshot di `temporary_files/e2e_xss/`

- [ ] **Step 1:** Bump versi; `npm test` + `python3 -m pytest tests -q` hijau (kecuali pra-ada).
- [ ] **Step 2: E2E.** Setiap halaman memasang `window.__xss = undefined`. Payload menulis `window.__xss = 1` (lewat `onerror`, `onload`, `<script>`, `javascript:` yang diklik). Langkah:
  1. A membuat note pribadi berisi semua payload §1 spec + `<br>`, `<details>`, `<mark>`, lalu publish. Pengunjung anonim membuka halaman publik: `__xss` tetap undefined, `<details>` bisa dibuka, `<mark>` tampil.
  2. A men-share note itu ke W (dialog PR 3). B membuka note dalam mode baca dan mencetak (print preview): `__xss` undefined.
  3. Drawing W dengan `svg_preview` berisi `<svg onload=…><script>…</script>` (lewat API). Di note B tampil sebagai `<img>`, dan `__xss` undefined. Di halaman publik note W yang dipublish juga `<img>`.
  4. A membuat task W berjudul `<img src=x onerror="window.__xss=1"> & co`. B membuka panel notifikasi: `__xss` undefined dan teks tampil `& co`.
  5. Header CSP `/pub` sesuai Global Constraints. Halaman publik tetap memuat KaTeX dan font tanpa error CSP di console.
- [ ] **Step 3: Commit** — `chore(sw): v422 xss-hardening; test(e2e): payload XSS dua akun`

## Penyelesaian (koordinator)

- ADR-014 di `.agents/DECISIONS.md`.
- `.agents/CURRENT_STATE.md`: perbarui juga status PR #45 (di-merge).
- `.agents/SESSION_LOG.md`.
- Merge `origin/main`, jalankan ulang semua tes.
- Draft PR dengan checklist manual.
- Pesan deploy: restart `taskflow-web` dan `taskflow`.
