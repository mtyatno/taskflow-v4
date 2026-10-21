# Fokus Hari Ini — PR D: Suara Latar (Ambient Sound) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kartu Pomodoro mendapat kontrol suara latar (Off / Hujan / Brown Noise / Detak Jam + volume). Suara berbunyi dengan fade-in saat Work atau Overtime berjalan, memudar lalu berhenti saat Jeda, Stop, atau istirahat, dan selalu hening saat istirahat. File suara baru diambil ketika dibutuhkan, lalu tersedia offline.

**Architecture:**
- Tiga loop suara disintesis sendiri oleh skrip Python (numpy + ffmpeg) dan di-commit ke `static/sounds/`.
- Modul UMD baru `static/offline/ambient.js` memuat dua bagian:
  - fungsi murni yang memetakan status timer ke aksi suara;
  - pemutar berisi satu `HTMLAudioElement` (`loop`) + `GainNode`. Pemutar mengambil file lewat `fetch` → Blob URL secara malas, dan menjadwalkan fade.
- App membuat satu pemutar dan mengirim status timer di setiap render, sehingga suara tetap jalan saat berpindah halaman.
- Kontrol UI ada di kartu Pomodoro.
- Service worker melayani `/static/sounds/` cache-first dari cache `alurik-ambient-v1` yang tidak dihapus saat aktivasi.

**Tech Stack:** Python (numpy, ffmpeg dengan libvorbis + libmp3lame) untuk aset; UMD JS + `node --test`; React tanpa JSX di `static/index.html`; service worker `static/sw.js`; Playwright Python.

**Spec:** `docs/superpowers/specs/2026-10-20-fokus-hari-ini-enhancement-design.md` (§7.4, D11–D13, §8 Audio, §10 PR D).

## Global Constraints

- **Pilihan** dropdown, sesuai urutan: `off` "Off", `hujan` "Hujan", `brown-noise` "Brown Noise", `detak-jam` "Detak Jam". Slider volume 0–100, default 50.
- **Preferensi** di `localStorage`: `tf_ambient_sound` (default `"off"`) dan `tf_ambient_volume` (default `50`). Keduanya tidak dihapus saat logout. Setiap akses dibungkus try/catch.
- **File:** `static/sounds/{hujan,brown-noise,detak-jam}-v1.{ogg,mp3}`, ukuran ≤ 250 KB per file.
  - Hujan dan Brown Noise: loop 30 detik tanpa sambungan terdengar.
  - Detak Jam: loop 10 detik (tik-tok 1 Hz).
  - Kenyaringan antar suara setara (target RMS sama ±3 dB).
  - Format dipilih lewat `audio.canPlayType('audio/ogg; codecs="vorbis"')`, dengan cadangan `.mp3`.
- **Lazy load:** tidak ada request ke `/static/sounds/` saat halaman dibuka. File diambil hanya saat suara dipilih di dropdown, atau saat Work mulai dengan pilihan yang tersimpan. Pengambilan memakai `fetch(url)` biasa (respons 200 penuh), lalu diputar dari `URL.createObjectURL(blob)`.
- **Pemetaan status timer → aksi** (`ambientTarget`):
  - `play` bila `mode === "work"` dan `isRunning`, untuk countdown maupun Overtime;
  - `stop` bila `mode === "work"`, `phase === "countdown"`, tidak berjalan, dan `timeLeft === 1500` (hasil Stop/awal);
  - `pause` untuk semua status lainnya: Work dijeda, awaiting, istirahat berjalan atau diam, Overtime dijeda.
- **Fade:**
  - `play`: gain 0 → volume slider dalam 1000 ms;
  - `pause`: gain → 0 dalam 1000 ms, lalu `pause()` dengan posisi tetap;
  - `stop`: gain → 0 dalam 1000 ms, lalu `pause()` dan `currentTime = 0`;
  - ganti suara saat berbunyi: fade-out, ganti sumber, lalu fade-in 1000 ms;
  - `off`: `pause()`;
  - volume 0 atau `off` → `play()` tidak dipanggil;
  - perubahan slider saat berbunyi langsung berlaku (ramp ≤ 100 ms);
  - fade baru membatalkan fade yang sedang berjalan.
- **Volume** lewat Web Audio `GainNode` (`AudioContext.createMediaElementSource`). Bila Web Audio tidak tersedia, pakai `audio.volume`.
- **Autoplay:** bila `play()` ditolak, status menjadi `"waiting-tap"` dan satu listener `pointerdown` (sekali, capture, di `document`) mencoba lagi. `AudioContext.resume()` dipanggil pada gesture yang sama.
- **Status kontrol** (atribut `data-state` pada `.pomo-ambient`): `idle`, `loading`, `playing`, `waiting-tap`, `error`.
  - Tooltip `error`: "Suara belum tersedia offline".
  - Tooltip `waiting-tap`: "Ketuk di mana saja untuk menyalakan suara".
  - Timer tidak pernah terpengaruh oleh error audio.
- **SW:**
  - `/static/sounds/` dilayani cache-first dari cache bernama persis `alurik-ambient-v1`; respons ok disimpan ke cache itu;
  - `activate` menghapus cache selain `CACHE` aktif **dan** selain yang namanya diawali `alurik-ambient-`;
  - file suara tidak masuk precache `STATIC`;
  - `ambient.js` masuk `STATIC` dan diberi tag `<script>`.
- **Kontrol UI** ada di pojok kanan bawah kolom kanan kartu Pomodoro, sebaris dengan statistik, dan turun ke baris sendiri di ≤ 768 px. Isinya:
  - ikon headphone (glyph baru `headphones` di `VIEW_GLYPHS`);
  - `<select aria-label="Suara latar">`;
  - `<input type="range" aria-label="Volume suara latar">` dengan `aria-valuetext` "NN%".
- **Kode:** React.createElement tanpa JSX. Tanpa animasi di `prefers-reduced-motion`; fade audio bukan animasi visual, jadi tetap berjalan.
- **Rilis:**
  - SW + `app.css?v=` naik ke nomor kosong berikutnya di atas `main` **dan** draft terbuka. Sekarang `main` v438 / 346 dan draft #66 v439 / 347, jadi pakai **v440 `taskflow-v440-focus-ambient`, `?v=348`**.
  - Ubah di `sw.js`, `index.html` ×3, `webapp.py` `sw_cache`, dan tes yang mengunci versi.
  - Deploy: file statis + aset; restart `taskflow-web`.

## Review Focus

1. **Restore setelah reload saat Work berjalan, dengan pilihan tersimpan.** Tidak ada gesture, sehingga `play()` ditolak. Status menjadi `waiting-tap`, ketukan pertama menyalakan suara, dan timer tetap jalan. Ditest di Task 2 dan E2E di Task 5.
2. **Status berubah cepat berturut-turut** (Mulai lalu Jeda dalam 300 ms, atau ganti suara di tengah fade). Hasil akhirnya harus sesuai status terakhir, tanpa dua elemen audio berbunyi dan tanpa `play()` setelah status akhir `pause`. Ditest di Task 2.
3. **Offline sebelum file pernah diunduh.** `fetch` gagal, status menjadi `error` dengan tooltip, dan memilih suara lain atau online lagi bisa memulihkan. Ditest di Task 2 dan E2E di Task 5.
4. **Fade-out ke istirahat lewat tombol "Ambil Istirahat".** Suara wajib berhenti walaupun istirahat langsung berjalan, karena `mode` berubah ke istirahat dan `isRunning` tetap true. Ditest di Task 2.
5. **Perpindahan halaman.** Suara tetap berbunyi karena pemutar hidup di App, kontrol tetap sinkron setelah kembali ke halaman Fokus, dan tidak ada pemutar kedua. Ditest di Task 4 dan E2E di Task 5.

---

### Task 1: Aset suara

**Files:**
- Create: `scripts/gen_ambient_sounds.py` — menulis enam file ke `static/sounds/`. Seed tetap (`numpy.random.default_rng(20261021)`), 44.1 kHz mono. Encode dengan `ffmpeg`: ogg vorbis `-q:a 2`, mp3 `-b:a 64k`. Bitrate boleh disesuaikan bila ukuran > 250 KB.
- Create: `static/sounds/*.ogg`, `static/sounds/*.mp3` (di-commit).
- Test: `tests/test_ambient_assets.py`

Desain sinyal (bebas diubah selama test dan batas Global Constraints lulus):
- **Brown Noise:** integrasi white noise yang di-high-pass sekitar 20 Hz untuk menghapus drift, lalu dinormalisasi. Loop mulus dengan crossfade 2 detik antara ekor dan awal.
- **Hujan:** pink/brown noise yang di-band-pass sekitar 400 Hz–8 kHz, ditambah butir tetesan acak (impuls pendek yang meluruh, 30–80 per detik). Loop mulus dengan cara yang sama.
- **Detak Jam:** "tik" 2,5 kHz dan "tok" 2,0 kHz bergantian setiap 1 detik, ledakan 15 ms yang meluruh, 10 detik (10 ketukan) tepat.
- **Normalisasi:** RMS ketiganya disamakan (misalnya −24 dBFS untuk noise; untuk detak jam pakai RMS jendela ketukan ±3 dB), dengan puncak ≤ −1 dBFS.

- [ ] **Step 1: Tulis test yang gagal** — `tests/test_ambient_assets.py`:
  - keenam file ada;
  - setiap file ≤ 250 × 1024 byte;
  - `ffprobe` (lewati test dengan `pytest.skip` bila ffprobe tidak ada) melaporkan durasi 30 ± 0,1 detik untuk hujan/brown-noise dan 10 ± 0,1 detik untuk detak-jam, mono;
  - skrip bisa diimpor (`import scripts.gen_ambient_sounds` atau `runpy`) tanpa langsung menulis file (pakai guard `if __name__ == "__main__"`);
  - fungsi `make_brown_noise(rng, seconds)`, `make_rain(rng, seconds)`, `make_clock(seconds)` mengembalikan array float dengan panjang benar, puncak ≤ 0,9, dan untuk dua noise, selisih sampel terakhir → pertama ≤ 0,05 (loop mulus).
- [ ] **Step 2: Jalankan → FAIL** — `python -m pytest tests/test_ambient_assets.py -q`
- [ ] **Step 3: Tulis skrip, jalankan `python scripts/gen_ambient_sounds.py`, dan commit aset.**
- [ ] **Step 4: Jalankan → PASS**, lalu `python -m pytest tests/ -q`.
- [ ] **Step 5: Commit** — `feat(ambient): aset suara latar (hujan, brown noise, detak jam)`

---

### Task 2: Modul `ambient.js` (pemetaan + pemutar)

**Files:**
- Create: `static/offline/ambient.js` (UMD; `root.TF.ambient`)
- Modify: `static/index.html` (tag script setelah `pomolog.js`), `static/sw.js` (`STATIC`)
- Test: `tests/offline/ambient.test.js`

**Interfaces:**
- Produces (`TF.ambient`):
  - `SOUNDS = [{key:"off",label:"Off"},{key:"hujan",label:"Hujan"},{key:"brown-noise",label:"Brown Noise"},{key:"detak-jam",label:"Detak Jam"}]`, `FADE_MS = 1000`, `SOUND_KEY = "tf_ambient_sound"`, `VOLUME_KEY = "tf_ambient_volume"`.
  - `ambientTarget({mode, phase, isRunning, timeLeft}) -> "play"|"pause"|"stop"` — aturan Global Constraints.
  - `readPrefs(storage) -> {sound, volume}` — kunci tidak dikenal → `"off"`; volume dijepit 0–100, non-angka → 50; storage melempar → default.
  - `writePrefs(storage, {sound, volume})` — tidak pernah melempar.
  - `soundUrl(key, canPlayOgg: boolean) -> "/static/sounds/<key>-v1.ogg"|".mp3"`.
  - `createPlayer(env) -> player`, dengan `env = {createAudio, createAudioContext|null, fetch, createObjectURL, revokeObjectURL, setTimeout, clearTimeout, now, document, onState}`. Semua bisa disuntik di test; default memakai global browser.
  - `player.setSound(key)`: `off` → berhenti; selain itu muat file bila belum dimuat, lalu lanjutkan aksi target terakhir.
  - `player.setVolume(0..100)`.
  - `player.update(timerSnapshot)`: hitung `ambientTarget`, lalu jalankan transisi hanya bila berbeda dari target sebelumnya.
  - `player.state() -> {state: "idle"|"loading"|"playing"|"waiting-tap"|"error", sound, volume, target, paused, gain}`. Dipakai UI dan E2E.
  - `player.dispose()`.
  - `onState(stateObj)` dipanggil setiap status berubah.
- **Aturan internal:**
  - satu elemen audio per pemutar; mengganti sumber me-`revokeObjectURL` Blob lama;
  - jangan `play()` bila sound `off` atau volume 0;
  - fade memakai `setTimeout` bertahap (mis. 20 langkah dalam 1000 ms) atau `gain.linearRampToValueAtTime` bila Web Audio tersedia, dengan pembatalan fade sebelumnya;
  - `play()` ditolak (`NotAllowedError`) → `waiting-tap` + satu listener `pointerdown` di `document` yang mencoba lagi bila target masih `play`;
  - `fetch` gagal atau respons tidak ok → `error`;
  - `setSound` ke key lain dari status `error` mencoba lagi.

- [ ] **Step 1: Tulis test yang gagal** — fake `Audio` (properti `paused`, `currentTime`, `volume`, `play()` → Promise yang bisa diatur ditolak, `pause()`), fake `AudioContext` (`createMediaElementSource`, `createGain` dengan `gain.value`), fake `fetch` dengan penghitung, fake timer yang bisa dimajukan, dan fake `document` dengan `addEventListener`.
  - **`ambientTarget`:** semua baris Global Constraints, termasuk istirahat berjalan → `pause`, awaiting → `pause`, Overtime berjalan → `play`, Overtime dijeda → `pause`, Work 1500 diam → `stop`, Work 900 diam → `pause`.
  - **`readPrefs`/`writePrefs`:** default, jepit volume, storage melempar.
  - **`soundUrl`:** ogg/mp3.
  - **Lazy load:** `createPlayer` tanpa `setSound` → 0 fetch; `setSound("hujan")` → tepat 1 fetch ke `/static/sounds/hujan-v1.ogg`; `setSound` ulang ke key sama → tidak ada fetch tambahan.
  - **play → pause:** `update(work running)` lalu majukan 1000 ms → `paused === false`, gain = volume/100; `update(work paused 900)` lalu majukan 1000 ms → gain 0, `paused === true`, `currentTime` tidak direset.
  - **Stop:** `update(work 1500 diam)` → setelah fade `currentTime === 0`.
  - **Ambil Istirahat (Review Focus 4):** `update({mode:"shortBreak", isRunning:true})` → berhenti.
  - **Cepat berturut-turut (Review Focus 2):** `play` lalu `pause` setelah 300 ms, majukan 2000 ms → `paused === true`, `play()` tidak dipanggil setelah status akhir; ganti sound di tengah fade → satu elemen audio, Blob lama di-revoke.
  - **Autoplay ditolak (Review Focus 1):** status `waiting-tap`; `pointerdown` di fake document → `play()` dipanggil lagi, status `playing`; listener hanya sekali.
  - **Fetch gagal (Review Focus 3):** status `error`; `setSound("brown-noise")` dengan fetch berhasil → pulih.
  - **Volume:** 0 → tidak ada `play()`; `setVolume` saat berbunyi → gain berubah ≤ 100 ms.
  - **Tanpa Web Audio** (`createAudioContext: null`) → fade memakai `audio.volume`.
  - **Source:** tag script di index.html dan entri `STATIC` di sw.js.
- [ ] **Step 2: Jalankan → FAIL** — `node --test tests/offline/ambient.test.js`
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**; `npm test`.
- [ ] **Step 5: Commit** — `feat(ambient): modul pemutar suara latar + pemetaan status timer`

---

### Task 3: Service worker — cache suara

**Files:**
- Modify: `static/sw.js` — konstanta `AMBIENT_CACHE = "alurik-ambient-v1"`; handler `fetch` untuk `url.pathname.startsWith("/static/sounds/")` dan `GET`, ditaruh sebelum cabang statis default:
  - cache-first dari `AMBIENT_CACHE`;
  - cache kosong → `fetch`, lalu respons `ok && status === 200` disimpan ke `AMBIENT_CACHE`;
  - jaringan gagal tanpa cache → `Response` 503.
  - `activate`: filter `k !== CACHE && !k.startsWith("alurik-ambient-")`.
- Test: `tests/offline/sw_ambient_cache.test.js` — jalankan `static/sw.js` di sandbox `vm` dengan fake `self` (`addEventListener` mencatat handler), fake `caches` (`open`, `match`, `keys`, `delete`, `put`), dan fake `fetch`.

- [ ] **Step 1: Tulis test yang gagal:**
  - fetch `/static/sounds/hujan-v1.ogg` saat cache kosong → `fetch` jaringan dipanggil sekali dan respons di-`put` ke cache `alurik-ambient-v1`;
  - fetch kedua → dari cache, tanpa jaringan;
  - offline + cache kosong → status 503;
  - respons 206 tidak disimpan;
  - `activate` dengan keys `[CACHE, "taskflow-v1-lama", "alurik-ambient-v1"]` → hanya `"taskflow-v1-lama"` yang dihapus;
  - `STATIC` tidak memuat `/static/sounds/`.
  - Bila menjalankan sw.js di `vm` terlalu rapuh, boleh mengekstrak fungsi handler ke fungsi bernama di sw.js dan menguji sumbernya + logika lewat `vm` per fungsi; sebutkan pilihannya di report.
- [ ] **Step 2: Jalankan → FAIL.**
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**; `npm test`.
- [ ] **Step 5: Commit** — `feat(ambient): cache suara di SW yang bertahan lintas versi`

---

### Task 4: Wiring App + kontrol UI

**Files:**
- Modify: `static/index.html`:
  - `VIEW_GLYPHS.headphones` (path SVG headphone gaya garis seperti glyph lain).
  - App (dekat `const timer = usePomodoro(` ~36694):
    - satu pemutar lewat `useRef` (`TF.ambient.createPlayer()` saat mount), `dispose` saat unmount;
    - prefs dibaca dari `TF.ambient.readPrefs(localStorage)` lalu diterapkan (`setSound` **tidak** mengambil file bila target bukan `play`; pemutar harus menunda fetch sampai `setSound` dipanggil dari dropdown atau target pertama `play`);
    - `useEffect` setiap render dengan deps `[timer.mode, timer.phase, timer.isRunning, timer.timeLeft === 1500]` → `player.update({mode, phase, isRunning, timeLeft})`;
    - status pemutar disimpan di state App lewat `onState`;
    - handler `onAmbientSound(key)` / `onAmbientVolume(v)` → `player.setSound/ setVolume` + `writePrefs`.
  - Teruskan `ambient = {state, sound, volume, onSound, onVolume}` ke `TodayFocusView` → `PomodoroTimer`.
  - `PomodoroTimer`: komponen baru `PomoAmbient({ambient})` yang dirender di akhir baris `.focus-pomo-stats` (kanan). Isinya `div.pomo-ambient[data-state]`, `ViewGlyph headphones` (berkelas status; tooltip sesuai Global Constraints untuk `error`/`waiting-tap`), `select.pomo-ambient-select` (opsi dari `TF.ambient.SOUNDS`), dan `input.pomo-ambient-volume` (range 0–100, `disabled` saat sound `off`, `aria-valuetext`).
- Modify: `static/app.css`:
  - `.pomo-ambient` (`margin-left:auto`, flex, gap 8px; warna mengikuti kartu gelap);
  - select dan range menyatu dengan kartu;
  - ≤ 768 px: `flex-basis:100%`, pindah baris;
  - `[data-state="loading"]` ikon berdenyut pelan, tanpa animasi di `prefers-reduced-motion`;
  - `[data-state="error"]` ikon merah `#f87171`, `[data-state="waiting-tap"]` ikon kuning `#facc15`.
- Test: `tests/offline/focus_ambient_ui.test.js` (gaya `fnSource`)

**Interfaces:**
- Consumes: `TF.ambient.*` (Task 2).
- Produces: kelas DOM `.pomo-ambient[data-state]`, `.pomo-ambient-select`, `.pomo-ambient-volume`; `window.__ambientState()` (fungsi debug yang mengembalikan `player.state()`, untuk E2E).

- [ ] **Step 1: Tulis test yang gagal** — sumber:
  - App memuat `TF.ambient.createPlayer`, `readPrefs(`, `writePrefs(`, `.update({`, `__ambientState`, dan deps efek yang memuat `timer.phase` dan `timer.isRunning`;
  - `PomoAmbient` memuat `"Suara latar"`, `"Volume suara latar"`, `aria-valuetext`, `data-state`, kedua tooltip persis, `TF.ambient.SOUNDS`;
  - `PomodoroTimer` merender `PomoAmbient` di dalam `focus-pomo-stats`;
  - `VIEW_GLYPHS` memuat `headphones`;
  - CSS memuat `.pomo-ambient`, `#f87171`, `#facc15`, dan aturan reduced-motion untuk denyut;
  - PR A/B/C tetap lulus (`focus_zen`, `focus_park_input`, `focus_target_ui`, `focus_overtime_ui`).
- [ ] **Step 2: Jalankan → FAIL** — `node --test tests/offline/focus_ambient_ui.test.js`
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**; `node temporary_files/check_inline_scripts.js`; `npm test`.
- [ ] **Step 5: Commit** — `feat(ambient): kontrol suara latar di kartu Pomodoro`

---

### Task 5: Versi, E2E, handover

**Files:**
- Modify: versi (Global Constraints). Lebih dulu `git fetch origin` dan cek draft terbuka; bila `main` sudah bergerak, `git merge origin/main` dulu (merge commit).
- Create: `temporary_files/e2e_focus_ambient.py` (harness dari `temporary_files/e2e_focus_overtime.py`, jam dipaku siang lokal). Screenshot ke `temporary_files/e2e_focus_ambient/`, folder di-.gitignore. Chromium headless: luncurkan dengan `--autoplay-policy=no-user-gesture-required` untuk skenario normal, dan tanpa flag itu untuk skenario autoplay ditolak.
- Modify: `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md`.

- [ ] **Step 1: Naikkan versi.**
- [ ] **Step 2: Tulis E2E** (gunakan `window.__ambientState()` dan penghitung request `/static/sounds/` lewat `page.on("request")`):
  - a. Halaman Fokus dibuka dengan preferensi default → 0 request suara; kontrol tampil, `select` = Off, slider disabled.
  - b. Pilih "Hujan" → tepat 1 request `hujan-v1.ogg` (atau `.mp3`). Status `idle` karena timer belum jalan, sehingga tidak berbunyi.
  - c. Fokus task lalu Mulai → setelah 1,2 detik `paused === false`, gain ≈ 0,5. Jeda → setelah 1,2 detik `paused === true`, gain 0. Mulai lagi lalu Stop → `currentTime === 0`.
  - d. Majukan jam sampai 00:00 (awaiting) → suara berhenti. Lanjut Fokus → berbunyi lagi. Ambil Istirahat → berhenti, dan selama istirahat tetap `paused`.
  - e. Volume 20 saat berbunyi → gain ≈ 0,2. Pilih Off → `paused`.
  - f. Pindah ke halaman Tasks saat berbunyi → tetap berbunyi; kembali → kontrol tetap menampilkan Hujan.
  - g. Reload saat Work berjalan dengan pilihan tersimpan (context **tanpa** flag autoplay) → status `waiting-tap`; klik di halaman → `playing`.
  - h. SW aktif (context tanpa `service_workers="block"`): pilih Brown Noise online → reload offline → pilih Brown Noise lagi → status bukan `error` (dilayani dari `alurik-ambient-v1`). Suara yang belum pernah diunduh (Detak Jam) saat offline → `error` dengan tooltip persis.
  - i. Reload halaman (tanpa memilih apa pun) → tetap 0 request suara sebelum timer Work mulai.
  - Screenshot terang + gelap, desktop + 375 px (kontrol di kartu, status error).
- [ ] **Step 3: Jalankan:**
  - E2E baru exit 0;
  - `e2e_focus_page.py`, `e2e_focus_target.py`, `e2e_focus_overtime.py` tetap lulus;
  - `python -m pytest tests/ -q`;
  - `npm test` (hanya `draw_local_reactive` boleh gagal);
  - `check_inline_scripts`.
- [ ] **Step 4: Handover.**
  - Entri baru di `CURRENT_STATE`: branch `claude/focus-ambient`, versi, isi, verifikasi, deploy = restart `taskflow-web`, cache `alurik-ambient-v1` sengaja bertahan lintas versi.
  - Status "🟡 Halaman Fokus Hari Ini": semua PR A–D selesai saat PR D di-merge.
  - Entri baru di `SESSION_LOG`.
- [ ] **Step 5: Commit** — `chore(ambient): SW v440 + E2E suara latar`
