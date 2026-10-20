# Fokus Hari Ini — PR C: Overtime / Flow State — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Saat Work mencapai 00:00, timer tidak langsung pindah ke istirahat. Chime berbunyi satu kali, lalu pengguna memilih "Ambil Istirahat" atau "Lanjut Fokus (Overtime)". Overtime menghitung maju dengan cincin ungu, menambah 🍅 setiap kelipatan penuh 25 menit, mencatat durasinya ke log dan ke Waktu fokus, dan berhenti otomatis di 120 menit.

**Architecture:** Hook `usePomodoro` di `static/index.html` mendapat state `phase` (`countdown` | `awaiting` | `overtime`) beserta akumulasi Overtime yang disimpan di `tf_pomo_state`. Perhitungan murni (detik Overtime yang dibatasi, 🍅 kelipatan, format `+mm:ss`, aturan istirahat panjang, `client_id` Overtime, pemulihan sesi hari sebelumnya) ditambahkan ke `static/offline/pomologic.js`. Pencatatan memakai route lokal PR B (`POST /api/tasks/:id/pomodoros`, kind `overtime`). UI (`PomoControls`, `PomoRing`, `PomodoroTimer`, `PomodoroMiniBar`, `TopBarPomodoroChip`, `TodayFocusView`) membaca nilai baru dari hook.

**Tech Stack:** React tanpa JSX di `static/index.html`, modul UMD `static/offline/pomologic.js`, `node --test` (harness `usePomodoro` yang sudah ada di `tests/offline/focus_pomo_log.test.js`), Playwright Python dengan Clock API.

**Spec:** `docs/superpowers/specs/2026-10-20-fokus-hari-ini-enhancement-design.md` — §6 seluruhnya, §7.5, D7–D10, §8 (reload, dua tab), §10 PR C. Suara latar (§7.4) adalah PR D, jadi jangan dikerjakan di sini.

## Global Constraints

- **Fase:** `countdown` (hitung mundur biasa), `awaiting` (Work 00:00, menunggu pilihan), `overtime`. Mode tetap `"work"` selama `awaiting` dan `overtime`. `isRunning` bernilai `true` selama Overtime berjalan, sehingga `TF.focuspage.zenActive` otomatis menganggap Overtime sebagai Work berjalan.
- **Transisi (spec §6.2):**

  | Dari | Kejadian | Hasil |
  |---|---|---|
  | countdown Work | sisa 0 | log `session`, `sessionCount + 1`, satu chime, notifikasi, lalu `awaiting` di 00:00 |
  | awaiting | Lanjut Fokus | `overtime` berjalan dari `+00:00` |
  | awaiting | Ambil Istirahat | Short/Long, langsung berjalan |
  | awaiting | Stop | Work 25:00, diam |
  | overtime | Jeda / Lanjutkan | hitung maju berhenti / jalan lagi |
  | overtime | Stop | log `overtime`, `sessionCount += ⌊detik/1500⌋`, `totalFocusTime += detik`, Work 25:00 diam |
  | overtime | Ambil Istirahat | seperti Stop, lalu Short/Long langsung berjalan |
  | overtime | detik mencapai 7200 | seperti Ambil Istirahat tetapi istirahat **diam**; chime + notifikasi |
  | awaiting / overtime | klik tab mode | catat Overtime dulu (bila ada), lalu pindah mode tanpa berjalan |

- **Teks notifikasi:**
  - saat 00:00: judul "🍅 Pomodoro Selesai!", isi "Pomodoro selesai — lanjut fokus atau istirahat?";
  - saat batas: judul "⏱️ Overtime selesai", isi "Overtime dihentikan otomatis setelah 2 jam".
- **Baris log Overtime:** hanya ditulis bila detik ≥ 60. Isinya `kind: "overtime"`, `pomodoros: ⌊detik/1500⌋`, `focus_seconds: detik` (maks 7200), `client_id` `pomo-<uid>-<workStartedAt>-o`. Dikreditkan ke task fokus saat baris ditulis; bila tidak ada, ke `sessionTaskId`.
- **Istirahat panjang** bila ⌊sesudah/4⌋ > ⌊`countBeforeSession`/4⌋. "Sesudah" berarti `sessionCount` setelah sesi utama + 🍅 Overtime. "Lewati" di countdown tidak berubah.
- **Waktu fokus (D8):**
  - selama countdown, bertambah sebesar penurunan sisa waktu antar tick (bukan +1 per tick);
  - detik Overtime ditambahkan saat Overtime berakhir;
  - 🍅 kelipatan langsung tampil lewat `pomodorosToday = sessionCount + overtimePomodoros`.
- **Tampilan:**
  - `timeDisplay` saat Overtime: `+mm:ss`, atau `+h:mm:ss` bila ≥ 1 jam;
  - `progress` saat Overtime: (detik mod 1500) / 1500;
  - `labelText`: "Selesai" saat awaiting, "Overtime" saat Overtime;
  - tinta ungu `#8b5cf6`, teks `#c4b5fd`, lewat kelas `is-overtime`.
- **Kontrol per fase:**
  - countdown: Mulai/Jeda · Stop · Lewati (tidak berubah);
  - awaiting: **Ambil Istirahat** (hijau) · **Lanjut Fokus** + subteks "Overtime" (ungu) · Stop;
  - overtime: Jeda/Lanjutkan · Stop · Ambil Istirahat.
- **Chip top bar:**
  - awaiting: `00:00` berdenyut, tanpa tombol play/pause, tooltip "Pomodoro selesai — klik untuk memilih istirahat atau lanjut";
  - overtime: `+mm:ss` ungu, dengan tombol jeda/lanjut.
- **Statistik kartu:** Pomodoro = `pomodorosToday`, Set lengkap = ⌊`pomodorosToday`/4⌋. Header X = `pomodorosToday`. Realisasi di bar Task Aktif = `pomodoros_done` + `overtimePomodoros`.
- **Tip bawah persis:** "💡 25 menit fokus, lalu pilih istirahat atau lanjut overtime. Setelah 4 pomodoro, istirahat panjang 15 menit."
- **Pemulihan (spec §6.1, §8):**
  - countdown Work yang `targetEndTime`-nya sudah lewat diselesaikan saat muat, lalu masuk awaiting;
  - awaiting dipulihkan dengan tombolnya, tanpa log kedua;
  - Overtime yang berjalan dihitung dari jam dinding dan dibatasi 7200;
  - state dari hari sebelumnya: sesi yang belum tercatat dicatat ke log (countdown habis → `log_date` dari `targetEndTime`; Overtime → `log_date` saat diselesaikan) tanpa mengubah statistik hari ini.
- **Kode:** React.createElement tanpa JSX; setiap akses `localStorage` dalam try/catch; kegagalan pencatatan tidak pernah memblokir timer.
- **Rilis:**
  - SW + `app.css?v=` naik ke nomor kosong berikutnya di atas `main` **dan** di atas draft PR lain yang terbuka. Sekarang `main` v436 / 344, dan draft #63 v435 / 343, jadi pakai **v437 `taskflow-v437-focus-overtime`, `?v=345`**.
  - Ubah di `sw.js`, `index.html` (`__SW_VERSION` + fallback Settings + link css), `webapp.py` `sw_cache`, dan tes yang mengunci versi.
  - Deploy: file statis saja, lalu restart `taskflow-web`.

## Review Focus

1. **Laptop tidur atau tab ditutup selama Overtime, lalu dibuka berjam-jam kemudian.** Detik dibatasi 7200, Overtime diselesaikan saat muat (log 4 🍅, 7200 detik), dan timer masuk istirahat diam. Ditest di Task 2.
2. **`handleTimerComplete` terpicu dua kali di 00:00** (pola PR B). Harus tetap satu chime, satu log, satu `sessionCount + 1`, dan transisi ke awaiting hanya sekali. Ditest di Task 2.
3. **Reload saat awaiting.** Tombol pilihan kembali, tidak ada log sesi kedua, dan Lanjut Fokus tetap berfungsi. Ditest di Task 2.
4. **Task fokus dilepas atau diselesaikan di tengah Overtime, lalu Stop.** Baris Overtime dikreditkan ke `sessionTaskId` dan tetap tercatat. Ditest di Task 2.
5. **Klik tab Short/Long/Work atau Lewati selama Overtime.** Overtime dicatat dulu dan tidak hilang. Ditest di Task 2.

---

### Task 1: Helper Overtime di `pomologic.js`

**Files:**
- Modify: `static/offline/pomologic.js`
- Test: `tests/offline/pomologic.test.js` (tambah)

**Interfaces:**
- Produces (`TF.pomologic`):
  - `OVERTIME_CAP = 7200`, `OVERTIME_MIN_LOG = 60`
  - `overtimeSeconds({accumSec: number, runStartedAt: number|null, now: number}) -> int` — `accumSec + (runStartedAt != null ? ⌊(now − runStartedAt)/1000⌋ : 0)`, dijepit ke 0…7200.
  - `overtimePomodoros(sec) -> int` — ⌊sec/1500⌋.
  - `formatOvertime(sec) -> string` — `"+00:00"`, `"+12:05"`, `"+1:05:09"`.
  - `overtimeProgress(sec) -> number` — (sec mod 1500)/1500.
  - `overtimeClientId(userId, workStartedAt) -> "pomo-<uid>-<ms>-o"`.
  - `breakAfter(countBefore: int, countAfter: int) -> "longBreak"|"shortBreak"` — long bila ⌊after/4⌋ > ⌊before/4⌋.
  - `overtimeLogEntry({sec, workStartedAt, userId, logDate, endedAt}) -> entry|null` — null bila sec < 60; else `{client_id, kind:"overtime", pomodoros, focus_seconds: sec, log_date, ended_at}`.
  - `staleSessionLogs(saved, {todayISO, now, userId, toLocalISO}) -> Array<{taskId, entry}>` — untuk `tf_pomo_state` dengan `date !== todayISO`:
    - countdown Work yang berjalan dengan `targetEndTime <= now` → entry `session` (1 🍅, 1500 detik, `log_date = toLocalISO(targetEndTime)`, `client_id` dari `workStartedAt ?? targetEndTime − 1500000`);
    - `phase === "overtime"` → entry dari `overtimeLogEntry` dengan detik `overtimeSeconds(...)` (dibatasi);
    - selain itu → `[]`.
    - `taskId` = `saved.sessionTaskId ?? saved.focusTaskId`; tanpa task → `[]`.

- [ ] **Step 1: Tulis test yang gagal**, dengan nilai persis:
  - `overtimeSeconds({accumSec:30, runStartedAt:1000, now:61000}) === 90`; dengan `runStartedAt: null` → 30; dengan `now` jauh (10 jam) → 7200.
  - `overtimePomodoros(1499) === 0`, `(1500) === 1`, `(7200) === 4`.
  - `formatOvertime(0) === "+00:00"`, `(725) === "+12:05"`, `(3909) === "+1:05:09"`.
  - `overtimeProgress(1800) === 0.2`.
  - `overtimeClientId(7, 1760000000000) === "pomo-7-1760000000000-o"`.
  - `breakAfter(3, 4) === "longBreak"`, `(3, 5) === "longBreak"`, `(1, 2) === "shortBreak"`, `(4, 5) === "shortBreak"`.
  - `overtimeLogEntry({sec:59,…}) === null`; `({sec:3100, workStartedAt:5, userId:7, logDate:"2026-10-20", endedAt:"x"})` → `{client_id:"pomo-7-5-o", kind:"overtime", pomodoros:2, focus_seconds:3100, log_date:"2026-10-20", ended_at:"x"}`.
  - `staleSessionLogs`:
    - countdown kemarin yang sudah habis → satu entry `session` dengan `log_date` kemarin;
    - Overtime kemarin dengan `otRunStartedAt` 3 jam lalu → entry `overtime` 4 🍅, 7200 detik;
    - awaiting kemarin → `[]`;
    - state hari ini → `[]`.
- [ ] **Step 2: Jalankan → FAIL** — `node --test tests/offline/pomologic.test.js`
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS.**
- [ ] **Step 5: Commit** — `feat(pomodoro): helper overtime di pomologic`

---

### Task 2: Mesin Overtime di `usePomodoro`

**Files:**
- Modify: `static/index.html` — `usePomodoro` (~8414–8646)
- Test: `tests/offline/focus_overtime_engine.test.js` (harness: salin dan perluas harness `usePomodoro` dari `tests/offline/focus_pomo_log.test.js`, termasuk jam palsu yang bisa dimajukan, stub `api.post`, `playNotificationSound`, `sendBrowserNotification`, dan `localStorage`)

**Interfaces:**
- Consumes: helper Task 1; route lokal `POST /api/tasks/:id/pomodoros` (PR B); `TF.pomologic.sessionClientId`.
- Produces — nilai baru yang dikembalikan hook (dipakai Task 3):
  - `phase`, `overtimeSeconds`, `overtimePomodoros`, `pomodorosToday`;
  - `continueOvertime()`, `takeBreak()`;
  - `timeDisplay`, `progress`, `labelText` sesuai Global Constraints;
  - `canStop` bernilai true selama awaiting/overtime;
  - `isOvertime` (= `phase === "overtime"`) dan `isAwaiting`.
  - `tf_pomo_state` juga menyimpan `phase`, `otAccumSec`, `otRunStartedAt`, `countBeforeSession`.

Rincian perilaku:
- **`handleTimerComplete`, cabang Work:**
  - pertahankan guard `completedSessionRef` dan pencatatan `session` PR B;
  - `countBeforeSession` = `sessionCount` sebelum +1;
  - **jangan** pindah ke istirahat: set `phase = "awaiting"`, `timeLeft = 0`, `isRunning = false`;
  - simpan `workStartedAt = startedAt` (jangan null; dipakai `client_id` Overtime);
  - notifikasi dengan teks baru.
- **`continueOvertime()`** (hanya dari awaiting): `phase = "overtime"`, `otAccumSec = 0`, `otRunStartedAt = now`, `isRunning = true`.
- **Tick Overtime:** interval 1 dtk yang hanya memicu render ulang, misalnya lewat state `now`. Detik selalu dihitung lewat `TF.pomologic.overtimeSeconds`. Bila detik ≥ 7200, jalankan penyelesaian batas.
- **`pause()` saat Overtime:** `otAccumSec = overtimeSeconds(...)`, `otRunStartedAt = null`, `isRunning = false`.
- **`start()` saat Overtime dijeda:** `otRunStartedAt = now`, `isRunning = true`. Tidak butuh task baru.
- **`finishOvertime({startBreak: boolean, auto: boolean})`** (internal):
  - hitung detik;
  - bila ≥ 60, `api.post` entry `overtimeLogEntry` dalam try/catch, ke `focusTask?.id ?? sessionTaskId`, lalu `__refreshTasks`;
  - `sessionCount += ⌊detik/1500⌋`, `totalFocusTime += detik`;
  - mode istirahat = `breakAfter(countBeforeSession, sessionCount baru)`;
  - reset `phase = "countdown"`, `otAccumSec = 0`, `otRunStartedAt = null`, `workStartedAt = null`.
  - Guard sekali jalan per `workStartedAt` (ref) supaya pemanggilan ganda tidak mencatat atau menambah dua kali.
- **`takeBreak()`:**
  - dari awaiting: mode `breakAfter(countBeforeSession, sessionCount)`, lalu jalankan istirahat langsung (set `targetEndTime`, `isRunning = true`, tanpa syarat task), dan `workStartedAt = null`;
  - dari overtime: `finishOvertime({startBreak: true})`.
- **`stop()`:**
  - dari awaiting: Work 25:00 diam, `phase = "countdown"`, `workStartedAt = null`;
  - dari overtime: `finishOvertime` lalu Work 25:00 diam.
- **`skip()` dan `switchMode(m)` saat awaiting/overtime:** catat Overtime dulu (bila overtime), lalu pindah mode tanpa berjalan.
- **Batas 7200:** `finishOvertime` dengan istirahat **diam**, chime `playNotificationSound("work")`, dan notifikasi batas.
- **Waktu fokus countdown:** di tick, tambah `max(0, sisaSebelumnya − sisaBaru)` (bukan +1). Pakai ref nilai sisa terakhir.
- **Muat:**
  - countdown Work berjalan dengan `targetEndTime ≤ now` → jalankan penyelesaian sekali (log + awaiting). Tidak perlu `isRunning` bernilai true dulu;
  - awaiting → pulihkan apa adanya;
  - Overtime berjalan → bila detik ≥ 7200, selesaikan batas saat mount;
  - state hari lain → panggil `TF.pomologic.staleSessionLogs` dan `api.post` setiap entry (try/catch), tanpa mengubah statistik; state baru seperti sekarang.
- **Turunan:**
  - `overtimePomodoros` = `overtimePomodoros(detik)` saat `phase === "overtime"`, selain itu 0;
  - `pomodorosToday` = `sessionCount + overtimePomodoros`.

- [ ] **Step 1: Tulis test yang gagal** (harness dengan jam palsu):
  - 00:00 → tepat satu post `session`, satu chime, notifikasi dengan teks baru; `phase` "awaiting", mode tetap "work", `timeDisplay` "00:00", `labelText` "Selesai"; pemicu ganda di 00:00 tidak menambah apa pun (Review Focus 2).
  - Lanjut Fokus, majukan 1500 dtk → `timeDisplay` "+25:00", `overtimePomodoros` 1, `pomodorosToday` = `sessionCount` + 1, `labelText` "Overtime"; majukan ke +12 menit berikutnya (total 2220 dtk) lalu Stop → satu post `overtime` dengan `pomodoros:1, focus_seconds:2220`, `client_id` berakhiran `-o`, `totalFocusTime` naik 2220, mode Work 25:00 diam.
  - Overtime +12:00 (720 dtk) lalu Ambil Istirahat → post `overtime` (0 🍅, 720 dtk), `sessionCount` hanya +1 dari sesi utama, mode Short **berjalan**.
  - Overtime < 60 dtk lalu Stop → tidak ada post overtime.
  - Jeda di +05:00, majukan 10 menit, Lanjutkan, majukan 1 menit → detik 360.
  - Batas: majukan 3 jam → satu post overtime (4 🍅, 7200), notifikasi batas, mode istirahat **diam**, chime (Review Focus 1).
  - Istirahat panjang: `sessionCount` awal 3 → sesi selesai → Ambil Istirahat → longBreak; awal 2 dengan Overtime 1500 → longBreak; awal 1 tanpa Overtime → shortBreak.
  - Awaiting → Stop → Work 25:00 diam, tanpa post baru.
  - Overtime lalu klik tab Short, dan secara terpisah Overtime lalu `skip()` → Overtime tercatat dulu, mode tidak berjalan (Review Focus 5).
  - Fokus dilepas (`focusTask` null) di tengah Overtime lalu Stop → post ke `sessionTaskId` (Review Focus 4).
  - Muat ulang dengan state awaiting → `phase` awaiting, tidak ada post (Review Focus 3); muat dengan countdown berjalan yang `targetEndTime`-nya sudah lewat → satu post `session` dan awaiting; muat dengan Overtime berjalan 3 jam lalu → selesai di batas.
  - State kemarin berisi Overtime → post overtime dengan `log_date` hari ini; `sessionCount` hari ini 0.
  - Waktu fokus countdown: tick yang meloncat 60 dtk (tab latar belakang) menambah 60, bukan 1.
- [ ] **Step 2: Jalankan → FAIL** — `node --test tests/offline/focus_overtime_engine.test.js`
- [ ] **Step 3: Implementasi** sesuai rincian. Tes lama di `tests/offline/focus_pomo_log.test.js` dan `focus_workstation.test.js` yang mengharapkan pindah langsung ke istirahat **diperbarui** ke perilaku awaiting (sebutkan di report), bukan dihapus.
- [ ] **Step 4: Jalankan → PASS**; `node temporary_files/check_inline_scripts.js`; `npm test`.
- [ ] **Step 5: Commit** — `feat(pomodoro): Overtime — pilih istirahat/lanjut di 00:00, hitung maju, batas 2 jam`

---

### Task 3: UI Overtime

**Files:**
- Modify: `static/index.html`:
  - `PomoControls` — tiga varian per fase (Global Constraints). Tombol awaiting:
    - `button.pomo-btn.pomo-btn-break` "Ambil Istirahat" → `timer.takeBreak`;
    - `button.pomo-btn.pomo-btn-overtime` dengan `span` "Lanjut Fokus" + `small` "Overtime" → `timer.continueOvertime`;
    - Stop.
    Varian Overtime: Jeda/Lanjutkan (`timer.isRunning ? pause : start`) · Stop · "Ambil Istirahat". Mode `compact` memakai label pendek ("Istirahat" / "Lanjut") dengan ikon.
  - `PomodoroTimer`:
    - kelas section ` is-overtime` / ` is-awaiting`;
    - statistik Pomodoro `t.pomodorosToday`, Set lengkap ⌊`pomodorosToday`/4⌋;
    - realisasi bar Task Aktif = `pomodoros_done + t.overtimePomodoros` (kelas `is-over` dihitung dari nilai itu);
    - sub judul: "Lanjut fokus atau istirahat?" saat awaiting, "Overtime — tetap di flow" saat Overtime.
  - `PomodoroMiniBar` — kelas yang sama; kicker memakai `labelText`.
  - `TopBarPomodoroChip`:
    - kelas ` is-overtime` / ` is-awaiting`;
    - awaiting → tanpa tombol play/pause, dengan tooltip persis dari Global Constraints;
    - Overtime → tombol jeda/lanjut tetap ada.
  - `TodayFocusView` — header `done: timer.pomodorosToday`; tip bawah persis dari Global Constraints; fallback `timer` tanpa props diberi `phase:"countdown"`, `pomodorosToday:0`, `overtimeSeconds:0`, `overtimePomodoros:0`, `continueOvertime(){}`, `takeBreak(){}`.
- Modify: `static/app.css`:
  - `.focus-pomo.is-overtime, .focus-mini.is-overtime { --pomo-ink: #8b5cf6; --pomo-ink-soft: rgba(139,92,246,0.18); --pomo-ink-text: #c4b5fd; }`;
  - `.pomo-btn-break` (hijau `var(--break)`) dan `.pomo-btn-overtime` (ungu `#8b5cf6`);
  - `.topbar-pomo-chip.is-overtime` ungu dan `.topbar-pomo-chip.is-awaiting` berdenyut (`@keyframes`); tanpa animasi di `prefers-reduced-motion`;
  - tombol di layar ≤ 768 px tetap muat satu baris atau turun rapi.
- Test: `tests/offline/focus_overtime_ui.test.js` (gaya `fnSource`)

**Interfaces:**
- Consumes: nilai hook dari Task 2.
- Produces: kelas DOM `.pomo-btn-break`, `.pomo-btn-overtime`, `.focus-pomo.is-overtime`, `.is-awaiting`, `.topbar-pomo-chip.is-awaiting` (dipakai E2E Task 4).

- [ ] **Step 1: Tulis test yang gagal**:
  - `PomoControls` memuat `timer.takeBreak`, `timer.continueOvertime`, teks "Ambil Istirahat", "Lanjut Fokus", "Overtime", dan percabangan `phase === "awaiting"` / `"overtime"`;
  - `PomodoroTimer` memuat `is-overtime`, `pomodorosToday`, `overtimePomodoros`;
  - `TopBarPomodoroChip` memuat tooltip persis dan `is-awaiting`;
  - `TodayFocusView` memuat `done: timer.pomodorosToday` dan tip persis;
  - CSS memuat `#8b5cf6`, `#c4b5fd`, `.pomo-btn-overtime`, `.pomo-btn-break`, dan aturan reduced-motion untuk denyut chip.
- [ ] **Step 2: Jalankan → FAIL** — `node --test tests/offline/focus_overtime_ui.test.js`
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan → PASS**; `check_inline_scripts`; `npm test`.
- [ ] **Step 5: Commit** — `feat(pomodoro): UI Overtime (tombol pilihan, cincin ungu, chip)`

---

### Task 4: Versi, E2E, handover

**Files:**
- Modify: versi (Global Constraints) di `static/sw.js`, `static/index.html`, `webapp.py`, dan tes yang mengunci versi. Cek `git fetch origin` dan PR draft terbuka lebih dulu.
- Create: `temporary_files/e2e_focus_overtime.py` (harness dari `temporary_files/e2e_focus_target.py`; jam dipaku ke siang lokal; screenshot ke `temporary_files/e2e_focus_overtime/`, folder ini di-.gitignore).
- Modify: `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md`.

- [ ] **Step 1: Naikkan versi.**
- [ ] **Step 2: Tulis E2E:**
  - a. Fokus task lalu Mulai, majukan 25 menit. Muncul "Ambil Istirahat" dan "Lanjut Fokus"; waktu 00:00; server punya satu log session.
  - b. Lanjut Fokus, majukan 25 menit. Waktu `+25:00`, kartu `is-overtime`, statistik Pomodoro +1, realisasi bar Task Aktif +1. Majukan 12 menit lalu Stop: server punya log overtime (1 🍅, 2220 detik), dan Waktu fokus bertambah.
  - c. Sesi berikutnya → Lanjut Fokus +12:00 → Ambil Istirahat. Istirahat berjalan, Pomodoro hanya +1 dari sesi utama.
  - d. Reload saat awaiting → tombol pilihan tetap ada, tidak ada log baru.
  - e. Batas: Overtime lalu majukan 3 jam → istirahat diam, log 4 🍅 / 7200 detik.
  - f. Chip top bar di halaman lain: awaiting tanpa tombol play, Overtime menampilkan `+mm:ss` dengan kelas `is-overtime`.
  - g. Zen menyala selama Overtime berjalan, dan daftar kembali saat awaiting.
  - Screenshot terang + gelap, desktop + 375 px (awaiting, Overtime).
- [ ] **Step 3: Jalankan:**
  - E2E baru exit 0;
  - E2E PR A dan PR B (`e2e_focus_page.py`, `e2e_focus_target.py`) masih lulus, setelah disesuaikan bila mereka mengasumsikan pindah langsung ke istirahat;
  - `python -m pytest tests/ -q`;
  - `npm test` (hanya `draw_local_reactive` boleh gagal);
  - `check_inline_scripts`.
- [ ] **Step 4: Handover.**
  - Entri baru di `CURRENT_STATE`: branch `claude/focus-overtime`, versi, isi, verifikasi, deploy (restart `taskflow-web` saja).
  - Perbarui baris status "🟡 Halaman Fokus Hari Ini".
  - Entri baru di `SESSION_LOG`.
- [ ] **Step 5: Commit** — `chore(pomodoro): SW v437 + E2E Overtime`
