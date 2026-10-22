# Precache SW — shell lengkap, atomik, hemat kuota — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Setelah rilis baru aktif (mis. HP restart), Alurik tetap tampil bergaya dan berjalan tanpa jaringan.
- `app.css` dan `milkdown.bundle.js` di-precache dengan URL persis yang dimuat `index.html`.
- Install SW gagal total bila satu file shell gagal, sehingga SW lama dengan cache lengkap tetap aktif.
- File yang tidak berubah cukup direvalidasi (304).

**Architecture:** Hanya `static/sw.js` (daftar `STATIC` = shell, daftar baru `OPTIONAL_STATIC`, handler `install`), ditambah tes. Tanpa perubahan server, skema, `index.html` (selain pin versi), atau logika banner update.

**Tech Stack:** service worker `static/sw.js`; `node --test` dengan harness `vm` (pola `tests/offline/sw_media.test.js`, `sw_child_counts.test.js`); pytest + `TestClient`; Playwright Python (Chromium di `/opt/pw-browsers`).

**Spec:** `docs/superpowers/specs/2026-10-22-sw-precache-shell-design.md` (seluruhnya; ADR-029 di §8).

## Global Constraints

- **Format `STATIC`:** baris pembuka tetap `const STATIC = [` dan penutup `\n];`, satu URL per baris dengan tanda kutip ganda dan koma. Regex di `tests/offline/sw_ambient_cache.test.js` bergantung pada bentuk ini. `OPTIONAL_STATIC` memakai bentuk yang sama: `const OPTIONAL_STATIC = [` … `\n];`.
- **Isi `STATIC`:** semua entri lama kecuali yang dipindah ke `OPTIONAL_STATIC`, dengan dua perubahan:
  - `/static/vendor/milkdown.bundle.js` → `/static/vendor/milkdown.bundle.js?v=289`;
  - tambah `/static/app.css?v=362` (dekat `/`, dengan komentar singkat bahwa query harus sama dengan `<link>` di index.html).
- **Isi `OPTIONAL_STATIC`:** `/manifest.json?v=2`, `/static/icon-192.png?v=2`, `/static/icon-512.png?v=2`, `/static/icon-maskable-192.png?v=2`, `/static/icon-maskable-512.png?v=2`, `/static/icon-new-task.svg`, ke-19 font `/static/vendor/katex/fonts/*.woff2`, `/static/vendor/tldraw/index.html`, `/static/vendor/tldraw/assets/index.js`, `/static/vendor/tldraw/assets/index.css`. `TLDRAW_ASSETS` di-`push` ke `OPTIONAL_STATIC`, bukan ke `STATIC`.
- **Request precache:** `new Request(url, { cache: "no-cache" })` lewat satu helper `freshRequest(url)`. String `cache: "reload"` tidak boleh tersisa di `sw.js`.
- **Install:**
  - `cache.addAll(STATIC.map(freshRequest))`, lalu `Promise.allSettled` untuk `OPTIONAL_STATIC`;
  - `skipWaiting()` hanya bila `!self.registration.active` dan hanya setelah shell tersimpan;
  - **tidak ada** `.catch` yang menelan kegagalan shell.
- **Tidak diubah:** `activate`, semua cabang `fetch`, `AMBIENT_CACHE`, `index.html` (selain pin versi di Task 5), server.
- **Komentar kode** berbahasa Indonesia, gaya yang sama dengan `sw.js`.
- **Tes:** setiap task menjalankan `npm test` dan membandingkan jumlah gagal dengan baseline `main` (1 gagal pra-ada: `draw_local_reactive`). Task yang menyentuh Python juga menjalankan `python -m pytest tests/ -q`.
- **Versi (Task 5 saja):** SW `taskflow-v464-sw-precache-shell`. Ganti semua kemunculan `taskflow-v462-fokus-checklist-hitungan` di `static/`, `webapp.py`, `tests/`. `tests/test_version.py` juga memeriksa `"v464"`. `app.css?v=362` tidak berubah.
- **Commit** per task dengan trailer:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CJUKGDGwEJepWu92on5dPW
  ```

## Review Focus

1. **Rilis baru + jaringan gagal untuk app.css setelah aktivasi** → app.css dari cache (200), bukan 503. Tes: Task 2 siklus lengkap; E2E Task 4 skenario 1.
2. **Install dengan satu file shell gagal** → `waitUntil` menolak, cache lama tidak tersentuh, `skipWaiting` tidak dipanggil. Tes: Task 2; E2E Task 4 skenario 2.
3. **File tldraw tidak ada (build gagal)** → install tetap sukses. Tes: Task 2 "opsional gagal".
4. **`index.html` menambah `<script>`/`<link>` lokal baru tanpa memperbarui `STATIC`, atau query versi berubah di satu sisi saja** → tes penjaga gagal. Tes: Task 1.
5. **File unchanged** → 304 dari server. Tes: Task 3.

---

### Task 1: Tes penjaga + perbaikan isi `STATIC` / `OPTIONAL_STATIC`

**Files:**
- Create: `tests/offline/sw_precache_shell.test.js`
- Modify: `static/sw.js` (daftar `STATIC`, `OPTIONAL_STATIC` baru, `TLDRAW_ASSETS` push; install belum diubah kecuali agar tetap memasang kedua daftar dengan perilaku lama — lihat Step 3)

**Interfaces:**
- Produces di `sw.js`: `const STATIC = [...]`, `const OPTIONAL_STATIC = [...]` (global skrip SW, bisa dibaca harness `vm` lewat `vm.runInContext("STATIC", sandbox)`).

- [ ] **Step 1: Tulis tes yang gagal** di `tests/offline/sw_precache_shell.test.js`:
  - helper `listOf(name)` mengambil array dari blok `const <name> = [ … \n];` (regex seperti `sw_ambient_cache.test.js`) **dan** helper `swGlobals()` yang menjalankan `sw.js` di `vm` (sandbox `self.addEventListener` palsu) lalu membaca `STATIC` dan `OPTIONAL_STATIC` (termasuk `TLDRAW_ASSETS` yang di-push);
  - `test("sw precache: setiap script/stylesheet lokal di index.html ada di STATIC dengan URL persis")`: parse semua `<script … src="/…">` dan `<link … rel="stylesheet" … href="/…">` di `static/index.html`. Pesan gagal menyebut URL yang hilang;
  - `test("sw precache: entri STATIC menunjuk file yang ada")`: selain `/` dan `/config.js`, path tanpa query relatif ke repo (`/static/x` → `static/x`) harus ada;
  - `test("sw precache: STATIC dan OPTIONAL_STATIC tidak beririsan; tldraw/ikon/katex hanya opsional")`: irisan kosong; tidak ada entri `STATIC` yang diawali `/static/vendor/tldraw/`, `/static/vendor/katex/fonts/`, `/static/icon-`, atau `/manifest.json`; `OPTIONAL_STATIC` memuat `TLD + "/watermarks/watermark-desktop.svg"`;
  - `test("sw precache: /static/sounds/ tidak di-precache")` untuk kedua daftar.
- [ ] **Step 2: Jalankan → FAIL** (`node --test tests/offline/sw_precache_shell.test.js`): app.css, `milkdown.bundle.js?v=289` hilang; `OPTIONAL_STATIC` tidak ada.
- [ ] **Step 3: Implementasi** sesuai Global Constraints "Isi `STATIC`" dan "Isi `OPTIONAL_STATIC`". Install sementara memasang `STATIC.concat(OPTIONAL_STATIC)` dengan logika lama, supaya task ini tidak mengubah perilaku (Task 2 yang mengubahnya).
- [ ] **Step 4: Jalankan → PASS**; `npm test` (termasuk `sw_ambient_cache.test.js` dan `table_resizing.test.js`) tidak menambah kegagalan.
- [ ] **Step 5: Commit** `fix(sw): app.css dan milkdown di-precache dengan URL persis; aset opsional dipisah`

### Task 2: Install atomik + revalidasi `no-cache`

**Files:**
- Modify: `static/sw.js` (helper `freshRequest`, handler `install`)
- Modify: `tests/offline/sw_precache_shell.test.js`

**Interfaces:**
- Consumes `STATIC`, `OPTIONAL_STATIC` dari Task 1.
- Produces `freshRequest(url) -> Request` (global SW).

- [ ] **Step 1: Tulis tes yang gagal.** Harness lifecycle (salin pola `repro_css.js` dari analisis, lihat spec §6):
  - `CacheStorage` palsu bersama (Map nama → Map URL → Response), dengan `addAll` **atomik**: semua fetch dulu, tolak tanpa menyimpan apa pun bila ada yang reject atau `!res.ok`. `add` menolak bila `!res.ok`. `match` mendukung `ignoreSearch`.
  - `loadSw(src, {active})` mengembalikan `install()`, `activate()`, `get(path)`. `install()` me-resolve/me-reject sesuai promise `waitUntil`. `self.skipWaiting` dihitung.
  - `fetch` palsu mencatat `request.cache` dan bisa diatur: online, gagal untuk pola URL tertentu, atau offline.
  - Tes:
    1. `install memakai cache: "no-cache" untuk semua request precache` (dan tidak ada `"reload"` di sumber `sw.js`);
    2. `shell gagal satu (tailwind) → install menolak, tak ada entri shell tersimpan, skipWaiting tidak dipanggil (active ada)`;
    3. `opsional gagal (semua /static/vendor/tldraw/…) → install sukses, semua STATIC tersimpan`;
    4. `install pertama sukses (active null) → skipWaiting dipanggil sekali`; `install pertama gagal → skipWaiting tidak dipanggil, install menolak`;
    5. `siklus: SW lama aktif + app.css ter-cache → SW baru install gagal (app.css reject) → cache lama utuh, GET app.css offline 200`;
    6. `siklus: SW baru install sukses → activate → cache lama terhapus → GET /static/app.css?v=362 dan /static/vendor/milkdown.bundle.js?v=289 offline 200`.
- [ ] **Step 2: Jalankan → FAIL** (tes 1, 2, 4, 5 gagal dengan kode lama; tes 6 lulus sejak Task 1).
- [ ] **Step 3: Implementasi** sesuai spec §3.2 dan §3.3. Perbarui komentar di atas `STATIC` / handler `install` agar menjelaskan aturan shell vs opsional dan alasannya (singkat, rujuk spec).
- [ ] **Step 4: Jalankan → PASS**; `npm test` tanpa kegagalan baru.
- [ ] **Step 5: Commit** `fix(sw): install atomik untuk shell, revalidasi no-cache`

### Task 3: Bukti revalidasi 304 di server

**Files:**
- Create: `tests/test_static_revalidate.py`

- [ ] **Step 1: Tulis tes** (fixture `client` dari `tests/conftest.py`):
  - `GET /static/app.css` → 200 dengan `ETag`; ulang dengan `If-None-Match: <etag>` → 304 tanpa body;
  - sama untuk `/static/vendor/milkdown.bundle.js?v=289` (query tidak mengganggu);
  - `GET /` tetap `no-store` (memastikan index.html tidak pernah 304 dari cache basi).
- [ ] **Step 2: Jalankan.** Bila langsung PASS (Starlette sudah mendukung), itu bukti dasar §3.3. Bila FAIL, berhenti dan laporkan ke koordinator; jangan mengubah server.
- [ ] **Step 3:** `python -m pytest tests/ -q` hijau.
- [ ] **Step 4: Commit** `test(static): revalidasi ETag 304 untuk aset precache`

### Task 4: E2E Playwright siklus update

**Files:**
- Create: `temporary_files/e2e_sw_precache_shell.py` (tidak dijalankan CI; screenshot ke `temporary_files/e2e_sw_precache_shell/`, pastikan folder itu di-`.gitignore` seperti E2E lain)

- [ ] **Step 1: Tulis skrip.**
  - Salin `static/`, `webapp.py`, dan berkas Python yang dibutuhkan ke direktori sementara. Cara termudah: salin seluruh repo tanpa `.git`/`node_modules`/`venv`. Jalankan uvicorn dari salinan itu (pola `start_server` di `e2e_focus_page.py`, `DB_PATH` sementara), supaya `sw.js` salinan bisa diubah antar fase.
  - `launch_persistent_context(user_data_dir=tmp_profile)`, **service worker diizinkan**, env `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1` agar `context.route` juga menangkap fetch dari SW.
  - Login lewat API register + `localStorage` (pola `open_app`, tanpa `service_workers="block"`).
  - **Fase 1:** buka `/`, tunggu `navigator.serviceWorker.controller` (reload sekali setelah `controllerchange` pertama), lalu buka lagi sehingga app.css dimuat lewat SW. Catat nilai `getComputedStyle(document.documentElement).getPropertyValue("<variabel CSS yang didefinisikan app.css :root>")` — pilih variabel yang memang ada di `static/app.css` dan tidak ada di tailwind.
  - **Skenario 1 (rilis + restart + app.css gagal):**
    - ganti `CACHE` di `sw.js` salinan menjadi `taskflow-v999-e2e`;
    - buka `/` lalu panggil `reg.update()` sampai `reg.waiting` ada (jaringan normal);
    - tutup konteks dan buka lagi dengan profil yang sama (restart);
    - pasang `context.route("**/static/app.css*", abort)` **sebelum** navigasi;
    - buka `/`. Harapan: SW baru mengendalikan (cek `caches.keys()` berisi `taskflow-v999-e2e` dan tidak berisi versi lama) dan variabel CSS dari app.css tetap terbaca.
  - **Skenario 2 (install gagal):**
    - naikkan lagi ke `taskflow-v998-e2e`;
    - abort `**/static/vendor/tailwind.min.css*` selama `reg.update()`;
    - tunggu `updatefound` → state `redundant`;
    - restart dengan semua request ke server diblokir;
    - harapan: `caches.keys()` masih berisi cache yang aktif sebelumnya dan tampilan tetap bergaya.
  - Cetak ringkasan `PASS`/`FAIL` per langkah, exit code ≠ 0 bila ada FAIL. Screenshot tiap skenario.
- [ ] **Step 2: Jalankan di branch → semua PASS.** Jalankan juga terhadap `main` (salinan repo dari `git worktree add /tmp/... origin/main` atau `git stash`): skenario 1 harus FAIL di `main`. Catat kedua hasil untuk koordinator.
- [ ] **Step 3: Commit** `test(e2e): siklus update SW — app.css tetap ada setelah restart`

### Task 5: Versi v464 + ADR-029

**Files:**
- Modify: `static/sw.js`, `static/index.html` (`window.__SW_VERSION` dan fallback teks versi), `webapp.py` (`sw_cache`), `tests/test_version.py`, semua tes yang memin versi (`grep -rln "taskflow-v462-fokus-checklist-hitungan" static webapp.py tests`)
- Modify: `.agents/DECISIONS.md` (ADR-029, format ADR-028: Date, Agent, Context, Decision, Consequences, isi dari spec §8)

- [ ] **Step 1:** Ganti semua kemunculan versi. `tests/test_version.py`: `"v464"`.
- [ ] **Step 2:** Tambah ADR-029.
- [ ] **Step 3: Verifikasi penuh:**
  - `npm test` (catat total/pass/gagal; hanya `draw_local_reactive` yang boleh gagal);
  - `python -m pytest tests/ -q`;
  - `node temporary_files/check_inline_scripts.js static/index.html`;
  - `grep -rn "taskflow-v462" static webapp.py tests` kosong.
- [ ] **Step 4: Commit** `chore(release): SW v464 sw-precache-shell + ADR-029`
