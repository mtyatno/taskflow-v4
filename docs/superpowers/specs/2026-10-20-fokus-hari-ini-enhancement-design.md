# Spec: Halaman Fokus Hari Ini — Parkir Distraksi, Target 🍅, Mode Zen, Suara Latar, Overtime

- **Tanggal:** 2026-10-20
- **Basis kode:** `main` @ `43d2f33` (mtyatno/taskflow-v4)
- **Status:** desain disetujui dalam sesi brainstorming 2026-10-20 (pemilik + Claude), termasuk pendekatan A untuk realisasi 🍅 (log append-only). Spec tertulis ini menunggu review pemilik sebelum rencana implementasi dibuat.
- **Salinan:** repo `docs/superpowers/specs/2026-10-20-fokus-hari-ini-enhancement-design.md` dan Project claude.ai "alurik" `claude/spec-fokus-hari-ini-2026-10-20.md`. Isi keduanya sama.
- **Istilah:**
  - *halaman Fokus* = `TodayFocusView` (`page === "today"`), judul "Fokus Hari Ini";
  - *kartu Pomodoro* = kartu gelap `PomodoroTimer` di atas halaman Fokus;
  - *sesi Work* = satu hitung mundur Work 25 menit;
  - *Overtime* = fase hitung maju yang dipilih pengguna setelah sesi Work mencapai 00:00;
  - *estimasi* = `tasks.estimated_pomodoros`;
  - *realisasi* = jumlah 🍅 yang tercatat untuk satu task (kumulatif: semua hari, semua perangkat, semua anggota workspace);
  - *baris log* = satu baris tabel `pomodoro_log`;
  - *statistik harian* = angka Pomodoro / Waktu fokus / Set lengkap di kartu Pomodoro.

---

## 1. Tujuan

Halaman Fokus membantu pengguna bertahan pada satu task. Untuk itu halaman ini perlu menampung pikiran yang lewat tanpa keluar dari sesi, memberi tolok ukur beban hari ini, dan menyembunyikan gangguan visual. Selain itu, halaman ini memberi suara latar yang mengikuti ritme timer dan tidak memutus konsentrasi saat 25 menit habis.

**Kriteria berhasil**
1. **Parkir Distraksi.**
   - Pengguna mengetik satu baris di kartu Pomodoro lalu menekan Enter. Task baru masuk Inbox, input kosong lagi, dan centang hijau tampil 1,5 detik.
   - Tidak ada modal dan tidak ada reload. Jumlah "N tugas" tidak berubah.
   - Fitur ini juga berjalan saat offline.
2. **Target 🍅.**
   - Setiap task punya estimasi 1–20 🍅 (default 1). Estimasi diubah dengan klik ikon tomat di panel task yang terbuka.
   - Bar Task Aktif menampilkan `🍅 realisasi / estimasi`. Angka realisasi berwarna oranye bila melebihi estimasi, dan timer tetap berjalan.
   - Realisasi tersimpan di server, tidak hilang saat reload, dan sama di semua perangkat. Realisasi tidak terhitung dobel saat sinkronisasi diulang.
   - Header halaman: `N tugas • X / Y 🍅 hari ini (~Z jam)`.
3. **Mode Zen.**
   - Toggle (ikon mata) ada di kiri tab Work | Short | Long.
   - Saat toggle aktif dan Work berjalan, semua task selain task Aktif memudar lalu tersembunyi. Task Aktif tetap terbuka penuh, jadi Subtask/Catatan/Lampiran tetap bisa dipakai.
   - Daftar kembali saat istirahat, Jeda, atau Stop. Pilihan tersimpan per perangkat.
4. **Suara latar.**
   - Pilihan Off / Hujan / Brown Noise / Detak Jam dan slider volume ada di kanan bawah kartu.
   - Suara fade-in 1 detik saat Work berjalan, dan fade-out lalu berhenti saat Jeda, Stop, atau istirahat. Istirahat selalu hening.
   - Tidak ada file suara yang diunduh saat halaman dibuka.
5. **Overtime.**
   - Saat Work mencapai 00:00, chime berbunyi satu kali, timer berhenti, dan muncul tombol "Ambil Istirahat" dan "Lanjut Fokus (Overtime)".
   - Overtime menghitung maju `+mm:ss` dengan cincin ungu. Setiap kelipatan penuh 25 menit langsung menambah 🍅 di statistik Pomodoro dan di Task Aktif.
   - Saat Stop atau Ambil Istirahat, durasi Overtime masuk Waktu fokus.
   - Overtime yang berhenti sebelum kelipatan 25 menit berikutnya tidak menambah 🍅. Yang tercatat hanya +1 dari sesi utama.

## 2. Keputusan

| # | Keputusan |
|---|---|
| D1 | Parkir Distraksi membuat task `gtd_status = "inbox"`, `priority = "P2"`, tanpa deadline, lewat `POST /api/tasks` biasa (route lokal offline-first). Teks dikirim apa adanya sebagai judul, tanpa parsing tanggal/prioritas. Task tanpa deadline tidak pernah masuk Q1 atau overdue, jadi tidak masuk "Task hari ini". |
| D2 | Realisasi 🍅 disimpan sebagai **log append-only `pomodoro_log`**: satu baris per sesi Work selesai dan satu baris per Overtime. **Kolom turunan `tasks.pomodoros_done`** dinaikkan dalam transaksi yang sama. Kolom ini tidak mengubah `tasks.updated_at`, sehingga tidak memicu `REV_MISMATCH`. |
| D3 | Pencatatan idempoten lewat `client_id` yang **deterministik per sesi** (`UNIQUE(user_id, client_id)`). Dua tab atau perangkat yang mencatat sesi yang sama, atau push yang diulang, tidak menambah 🍅 dua kali. |
| D4 | Realisasi task workspace adalah jumlah dari semua anggota, karena estimasi dan realisasi sama-sama milik task. Untuk mencatat cukup hak baca task (`_can_access_task`). |
| D5 | Estimasi bernilai 1–20 (default 1) dan diubah hanya dengan klik ikon tomat. Ikon 1–4 langsung menyetel nilai itu. Ikon "5+" menyetel 5; bila nilai sudah ≥ 5, setiap klik menambah 1 dan berhenti di 20. Nilai disimpan lewat PUT task biasa, sehingga ikut sync dan aturan konflik yang sudah ada. |
| D6 | Statistik harian dan angka X di header tetap **per perangkat** (`tf_pomo_state`), seperti sekarang. Log server belum dipakai untuk statistik harian. |
| D7 | Saat Work 00:00, timer **selalu bertanya** (tanpa toggle Auto-Overtime). Sesi utama langsung dicatat (+1 🍅) saat 00:00, sebelum pengguna memilih. |
| D8 | 🍅 tambahan dari Overtime hanya dihitung untuk tiap kelipatan **penuh** 25 menit. Sisa detik hanya menambah Waktu fokus. Sesuai permintaan, Waktu fokus bertambah saat Overtime berakhir (Stop/Ambil Istirahat), sedangkan 🍅 kelipatan langsung tampil saat tercapai. |
| D9 | Overtime dibatasi **120 menit**. Di batas itu Overtime berakhir otomatis dan dicatat, lalu timer masuk mode istirahat **tanpa** berjalan, disertai chime dan notifikasi. Batas ini mencegah 🍅 palsu bila perangkat tidur atau tab ditinggal. |
| D10 | "Ambil Istirahat" langsung menjalankan timer istirahat, karena pengguna memilihnya secara eksplisit. Istirahat panjang dipilih bila sesi itu (sesi utama + 🍅 Overtime) melewati kelipatan 4 🍅 hari ini. Perilaku Lewati di hitung mundur tidak berubah. |
| D11 | Suara dibuat sendiri lewat sintesis sehingga bebas lisensi: Hujan, Brown Noise, Detak Jam. Formatnya `.ogg` dengan cadangan `.mp3` (dipilih lewat `canPlayType`). File diambil dengan `fetch()` saat pertama dibutuhkan, diputar dari Blob URL, dan disimpan di cache SW khusus yang bertahan lintas versi SW. |
| D12 | Volume dan fade diatur lewat Web Audio `GainNode` yang dihubungkan ke `HTMLAudioElement` (`loop = true`), karena iOS Safari mengabaikan `audio.volume`. Bila Web Audio tidak tersedia, dipakai `audio.volume`. |
| D13 | Zen Mode default **mati**. Preferensi Zen dan suara (pilihan + volume) disimpan di `localStorage` per perangkat dan tidak dihapus saat logout, karena ini preferensi tampilan, bukan data. |
| D14 | Tomat di UI baru memakai glyph `pomoTomato` (gaya ikon Alurik), bukan emoji 🍅. Chip "🍅 n" di kartu task (`ftask-count is-pomo`, sisa catatan #61) ikut diganti. |
| D15 | Tanggal "hari ini" untuk Pomodoro memakai **tanggal lokal perangkat** (`TF.tasklogic.todayLocalISO`), bukan UTC. Sekarang reset harian terjadi pukul 07:00 WIB, padahal `log_date` di log harus tanggal lokal. |
| D16 | Pekerjaan dibagi menjadi 4 PR berurutan (§10). |

## 3. Kondisi sekarang

Semua nomor baris merujuk ke `static/index.html`, kecuali disebut lain.

- **Hook `usePomodoro`** (8381–8572) dipanggil sekali di App (36058) dan dibagikan ke `TodayFocusView`, `PomodoroMiniBar`, dan `TopBarPomodoroChip`.
  - State `mode`, `timeLeft`, `isRunning`, `targetEndTime` (koreksi drift), `sessionCount`, dan `totalFocusTime` disimpan di `localStorage["tf_pomo_state"]` dengan `date` berupa tanggal **UTC** (8385). State dari hari lain dibuang saat muat.
  - `totalFocusTime` bertambah +1 per tick selama Work. Browser memperlambat tick di tab latar belakang, jadi Waktu fokus bisa kurang.
  - `handleTimerComplete` (8471) saat Work selesai: `sessionCount + 1`, `taskPomodoros[focusTask.id] + 1`, bunyi `playNotificationSound("work")` (1538, tiga nada 0,5 detik), notifikasi, lalu pindah ke Short/Long **tanpa** berjalan. Saat istirahat selesai, timer kembali ke Work.
- **`taskPomodoros`** (36056) hanya berupa `useState({})` dan tidak pernah disimpan. Akibatnya hitungan 🍅 per task dan total "🍅 hari ini" di header (9332, 9358) hilang saat reload.
- **`PomodoroTimer`** (8674–8753) berupa grid: cincin di kiri, kolom kanan di sebelahnya. Kolom kanan berisi:
  - judul + `PomoModeSwitch`;
  - `PomoControls` (Mulai/Jeda, Stop, Lewati);
  - bar Task Aktif (`🍅 n`, 8730), atau petunjuk bila belum ada task aktif;
  - statistik (Pomodoro, Waktu fokus, Set lengkap).
  Di layar ≤ 768 px, kolom kanan memakai `display: contents` + `order` (app.css 3622–3631).
- **`TodayFocusView`** (9204–9456) berisi, dari atas: header `N tugas • X 🍅 hari ini`, kartu Pomodoro, seksi "Berulang hari ini", seksi "Task hari ini" (`FocusTaskItem`; hanya satu task terbuka sekaligus lewat `openId`), dan tip di bawah.
- **`FocusTaskItem`** (8144–8316): panel yang terbuka berisi baris tab Subtask / Catatan / Lampiran dan tautan Detail.
- **`TopBarPomodoroChip`** (8800) tampil di halaman lain saat ada task fokus. **`PomodoroMiniBar`** (8757) menempel saat kartu tergulir keluar.
- **Offline:**
  - Task lokal dibangun dari dict server lewat `hydrate.js` (`COPY`).
  - Pull memakai daftar penuh `/api/tasks?include_done=true`. Field turunan (`TASK_DERIVED`, syncpull.js 158) diadopsi walaupun `updated_at` sama, untuk record yang tidak dirty.
  - Push mengirim record penuh lewat PUT dengan `base_rev` (`taskToUpdatePayload`, syncpush.js 111).
  - Op berpayload yang bergantung pada task (`opMark`, syncpush.js 644) menunggu sampai create task induknya terkirim.
  - `processOp` membuang op yang tidak dikenalnya (syncpush.js 1859).
- **Server:**
  - `task_row_to_dict` (webapp.py 1390) membaca hasil `SELECT * FROM tasks`, jadi kolom baru otomatis ikut ke semua dict task.
  - Kolom ditambahkan secara idempoten di `TaskRepository` (repository.py, pola `ALTER TABLE ... ADD COLUMN` di baris 556), yang dijalankan oleh `migrate_db()` (webapp.py 304).
- **SW:**
  - File `/static/...` yang tidak di-precache dilayani cache-first (sw.js 383–395).
  - `activate` menghapus semua cache selain versi aktif (sw.js 148).

## 4. Server

### 4.1 Skema

Ditambahkan idempoten di `TaskRepository`, yang dipakai oleh `migrate_db()`, bot, dan tes:

```sql
ALTER TABLE tasks ADD COLUMN estimated_pomodoros INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tasks ADD COLUMN pomodoros_done     INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS pomodoro_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id        INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  kind           TEXT    NOT NULL CHECK (kind IN ('session','overtime')),
  pomodoros      INTEGER NOT NULL,
  focus_seconds  INTEGER NOT NULL,
  log_date       TEXT    NOT NULL,   -- YYYY-MM-DD, tanggal lokal perangkat saat sesi/Overtime berakhir
  ended_at       TEXT    NOT NULL,   -- ISO 8601 dari klien
  client_id      TEXT    NOT NULL,
  created_at     TEXT    NOT NULL,
  UNIQUE (user_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_pomodoro_log_task      ON pomodoro_log(task_id);
CREATE INDEX IF NOT EXISTS idx_pomodoro_log_user_date ON pomodoro_log(user_id, log_date);
```

- Bila task dihapus, baris lognya tetap ada sebagai riwayat waktu fokus, dengan `task_id` menjadi NULL.
- `pomodoros_done` hanya diubah oleh endpoint di §4.2. Nilainya selalu sama dengan `SUM(pomodoros)` baris log task itu.

### 4.2 API

| Endpoint | Perilaku |
|---|---|
| `POST /api/tasks/{task_id}/pomodoros` | Lihat rincian di bawah tabel. |
| `POST /api/tasks` | Menerima `estimated_pomodoros: int = 1` (1–20) opsional. |
| `PUT /api/tasks/{id}` | Menerima `estimated_pomodoros: Optional[int]` (1–20); `None` berarti tidak diubah. `pomodoros_done` tidak bisa diubah lewat PUT (field yang tidak dikenal diabaikan). |
| Dict task (semua endpoint) | Ikut membawa `estimated_pomodoros` dan `pomodoros_done`. |

**`POST /api/tasks/{task_id}/pomodoros`**
- **Body:** `{client_id, kind, pomodoros, focus_seconds, log_date, ended_at}`.
- **Akses:** cukup hak baca task (`_can_access_task(conn, task_id, uid)`). Task yang tidak ada atau tidak bisa diakses dijawab 404/403, sama seperti endpoint task lain.
- **Status task** (done/archived) tidak diperiksa: sesi yang sudah terjadi tetap dicatat.
- **Penyimpanan:** `INSERT OR IGNORE` ke `pomodoro_log`. Bila baris baru masuk, dalam transaksi yang sama dijalankan `UPDATE tasks SET pomodoros_done = pomodoros_done + :pomodoros WHERE id = :task_id`, tanpa menyentuh `updated_at`.
- **Respons:** 200 `{id, task_id, pomodoros_done, duplicate}`. `client_id` yang sudah ada juga dijawab 200, dengan `duplicate: true` dan tanpa perubahan data.
- **Validasi** (422 bila gagal):
  - `client_id` 1–64 karakter;
  - `kind = session` → `pomodoros` = 1 dan `focus_seconds` 1–1500;
  - `kind = overtime` → `pomodoros` 0–4, `focus_seconds` 60–7200, dan `pomodoros` = ⌊`focus_seconds` / 1500⌋;
  - `log_date` berformat `YYYY-MM-DD`, dan `ended_at` berupa ISO yang bisa di-parse.

## 5. Klien offline & sinkronisasi

### 5.1 Field task
- **`pomodoros_done`** masuk `COPY` di `hydrate.js` dan `TASK_DERIVED` di `syncpull.js` (default 0). Dengan begitu, nilai dari perangkat atau anggota lain terbawa di setiap pull tanpa menaikkan `updated_at`.
- **`estimated_pomodoros`** juga masuk `COPY` (default 1).
  - `taskrepo.createTask` memberi default 1.
  - `taskrepo.updateTask` menerima `estimated_pomodoros` (dibulatkan dan dibatasi 1–20) seperti field lain, yaitu dirty + `rev`.
  - `taskToCreatePayload` / `taskToUpdatePayload` mengirim `estimated_pomodoros` **hanya bila record punya nilainya**, supaya record lama tanpa field ini tidak menimpa nilai server dengan 1.

### 5.2 Mencatat 🍅
- **Panggilan dari klien:** `POST /api/tasks/:id/pomodoros` lewat `api` seperti biasa. Panggilan ini dilayani route lokal baru di `taskroutes.js`, dengan logika di modul baru `static/offline/pomolog.js`. Route lokal:
  - mengubah id menjadi cid (`resolveCid`);
  - menambah op outbox `{entity_type: "pomodoro_log", op: "create", cid: <client_id>, payload: {task_cid, client_id, kind, pomodoros, focus_seconds, log_date, ended_at}}`, kecuali op dengan `cid` sama sudah ada;
  - menjawab `{pomodoros_done}` berisi nilai lokal (lihat poin berikut).
- **Nilai lokal:** semua route lokal yang mengembalikan task (daftar maupun satu task) melaporkan `pomodoros_done` = nilai server terakhir + 🍅 dari op `pomodoro_log` yang belum terkirim untuk task itu. Setiap op dihitung sekali per `cid`.
- **Push `opPomodoroCreate`** (di `processOp`):
  - id server task belum ada → op ditahan bila create task induknya masih tertunda; selain itu op dibuang (task sudah dihapus lokal);
  - 2xx → dalam **satu transaksi IndexedDB**, `pomodoros_done` dari respons ditulis ke record task (tanpa dirty/`rev`), lalu op dihapus;
  - 404/403 → op dibuang, karena task atau aksesnya sudah hilang sehingga sesi tidak bisa dicatat;
  - 4xx lain → op dibuang dan dihitung gagal;
  - 401/429/5xx/jaringan → op tetap di outbox.
- **Risiko diketahui** (sama dengan ADR-019): tab lama yang masih terbuka setelah deploy akan membuang op `pomodoro_log` karena belum mengenalnya.

### 5.3 `client_id`
- Formatnya `pomo-<user_id>-<workStartedAt>-s` untuk sesi utama dan `pomo-<user_id>-<workStartedAt>-o` untuk Overtime.
- `workStartedAt` adalah epoch ms saat sesi Work dimulai dari durasi penuh (bukan saat melanjutkan dari jeda) dan disimpan di `tf_pomo_state`. Tab lain yang memuat state yang sama memakai id yang sama, jadi sesi yang selesai bersamaan di dua tab tetap menjadi satu baris.

## 6. Mesin timer (`usePomodoro`)

### 6.1 State baru (disimpan di `tf_pomo_state`)
| Field | Isi |
|---|---|
| `phase` | `countdown` (hitung mundur biasa), `awaiting` (Work 00:00, menunggu pilihan), atau `overtime`. |
| `workStartedAt` | Lihat §5.3. |
| `sessionTaskId` | Task yang terakhir aktif saat timer Work berjalan. Baris log dikreditkan ke task fokus saat baris ditulis; bila tidak ada task fokus, ke `sessionTaskId`. |
| `otAccumSec`, `otRunStartedAt` | Akumulasi detik Overtime dan waktu mulai jalan terakhir (null saat jeda). Detik berjalan = `otAccumSec + (now − otRunStartedAt)`, dibatasi 7200. |
| `countBeforeSession` | `sessionCount` sebelum sesi ini, untuk aturan istirahat panjang (D10). |

`date` memakai tanggal lokal (D15). Saat muat, state dari hari sebelumnya tetap dibuang, dengan satu pengecualian: sesi yang belum tercatat lebih dulu dicatat ke log. Yang dimaksud adalah countdown yang sudah habis (`log_date` dari `targetEndTime`) atau Overtime (`log_date` saat diselesaikan). Pencatatan ini tidak mengubah statistik hari ini.

### 6.2 Transisi
| Dari | Aksi / kejadian | Hasil |
|---|---|---|
| countdown Work berjalan | sisa waktu 0 | Catat baris `session` (1 🍅, 1500 detik); `sessionCount + 1`; satu chime; notifikasi "Pomodoro selesai — lanjut fokus atau istirahat?"; `phase = awaiting`, berhenti di 00:00. |
| awaiting | Lanjut Fokus (Overtime) | `phase = overtime`, berjalan mulai `+00:00`. |
| awaiting | Ambil Istirahat | Masuk mode Short/Long (D10) dan langsung berjalan. |
| awaiting | Stop | Kembali ke Work 25:00, diam. |
| overtime berjalan | Jeda / Lanjutkan | Hitung maju berhenti / jalan lagi. |
| overtime | Stop | Catat baris `overtime`; `sessionCount += ⌊detik/1500⌋`; `totalFocusTime += detik`; kembali ke Work 25:00, diam. |
| overtime | Ambil Istirahat | Seperti Stop, lalu masuk mode Short/Long dan langsung berjalan. |
| overtime | detik mencapai 7200 | Seperti Ambil Istirahat, tetapi istirahat **diam**; chime + notifikasi "Overtime dihentikan otomatis setelah 2 jam". |
| awaiting / overtime | klik tab mode | Overtime dicatat dulu (bila ada), lalu pindah mode tanpa berjalan. |

- Baris `overtime` hanya ditulis bila durasinya ≥ 60 detik.
- Perilaku hitung mundur di luar tabel ini tidak berubah: Jeda, Stop (reset tanpa catatan), Lewati (tanpa 🍅), dan istirahat selesai → Work.
- Selama countdown Work, `totalFocusTime` bertambah sebesar **penurunan sisa waktu** antar tick, bukan +1 per tick. Dengan begitu Waktu fokus tidak kurang saat tab berada di latar belakang.

### 6.3 Nilai yang diekspos hook
Selain nilai yang sudah ada, hook mengekspos:
- `phase` dan `overtimeSeconds`;
- `overtimePomodoros`: ⌊`overtimeSeconds` / 1500⌋ selama Overtime, selain itu 0;
- `pomodorosToday`: `sessionCount + overtimePomodoros`;
- aksi `continueOvertime()` dan `takeBreak()`.

Perubahan nilai yang sudah ada:
- `timeDisplay` saat Overtime: `+mm:ss`, atau `+h:mm:ss` bila ≥ 1 jam.
- `progress` saat Overtime: (detik mod 1500) / 1500.
- `labelText`: "Selesai" saat awaiting, "Overtime" saat Overtime.

Perhitungan murni dipisah ke modul UMD baru `static/offline/pomologic.js` supaya bisa diuji dengan node: format waktu, 🍅 Overtime, batas 120 menit, aturan istirahat panjang, ringkasan header, dan `client_id`.

## 7. UI

### 7.1 Parkir Distraksi
- **Posisi:** input satu baris di kolom kanan kartu Pomodoro, **di atas** bar Task Aktif (atau di atas petunjuk bila belum ada task aktif). Input selalu tampil.
- **Teks dan gaya:**
  - placeholder "Ada pikiran lewat? Ketik & tekan Enter untuk simpan ke Inbox...";
  - menyatu dengan kartu gelap: latar transparan, garis bawah tipis, teks putih;
  - `maxLength` 200 dan `aria-label` "Parkir distraksi ke Inbox".
- **Enter** (bukan saat komposisi IME) dengan teks yang tidak kosong setelah trim → `api.post("/api/tasks", {title, gtd_status: "inbox", priority: "P2", deadline: null})` → `window.__refreshTasks()`.
- **Sukses:** input dikosongkan, centang hijau tampil di ujung kanan input selama 1,5 detik, dan `aria-live` mengumumkan "Tersimpan ke Inbox".
- **Gagal:** teks tetap di input, garis bawah berubah merah, dan muncul toast "Gagal menyimpan ke Inbox".
- **Lainnya:** Esc mengosongkan input dan melepas fokus. Selama pengiriman berlangsung, Enter berikutnya diabaikan.

### 7.2 Target 🍅
- **Bar Task Aktif:** `[glyph tomat] realisasi / estimasi`.
  - Realisasi = `pomodoros_done` task + `overtimePomodoros` bila Overtime sedang berjalan.
  - Bila realisasi > estimasi, angka realisasi berwarna oranye (`#fb923c` di kartu gelap). Timer tidak diblokir.
- **Pemilih estimasi** ada di baris tab panel task yang terbuka, setelah Subtask/Catatan/Lampiran dan sebelum Detail.
  - Lima tombol tomat dalam `role="radiogroup"`; setiap tombol punya `aria-label` "Estimasi n pomodoro".
  - Ikon nomor 1 sampai min(nilai, 5) tampil terisi. Ikon kelima berlabel "5+" dan menampilkan "×n" bila nilai ≥ 5.
  - Klik → `api.put("/api/tasks/:id", {estimated_pomodoros: n})` → `__refreshTasks()`, dengan aturan klik D5. Tidak ada input angka.
- **Chip di baris task:** chip `ftask-count is-pomo` diganti `[glyph tomat] realisasi/estimasi`. Chip tampil bila realisasi > 0 atau estimasi ≠ 1, dan berwarna oranye (`--p2`) bila realisasi melewati estimasi.
- **Header:** `N tugas • X / Y 🍅 hari ini (~Z jam)`, dengan 🍅 berupa glyph.
  - N = jumlah "Task hari ini" (seperti sekarang).
  - X = `pomodorosToday`.
  - Y = jumlah estimasi semua task di daftar itu.
  - Z = Y × 25 menit dalam jam, dibulatkan ke kelipatan 0,5 terdekat (tepat di tengah → ke atas), ditulis dengan titik, tanpa ".0" (32 → `~13.5 jam`; 24 → `~10 jam`; 3 → `~1.5 jam`).
  - Bila daftar kosong: `0 tugas • X 🍅 hari ini`.

### 7.3 Mode Zen
- **Tombol:** ikon mata (`fEye`) di kiri `PomoModeSwitch` pada kartu penuh (bukan bar ringkas), dengan `aria-pressed` dan tooltip "Mode Zen: sembunyikan task lain saat Work berjalan". Status tombol disimpan di `localStorage["tf_focus_zen"]`.
- **Kapan aktif:** Zen dianggap aktif bila toggle menyala **dan** mode Work **dan** timer berjalan (countdown atau Overtime). Saat aktif:
  - seksi "Berulang hari ini", tip di bawah, dan semua `FocusTaskItem` selain task Aktif mendapat kelas yang memudarkannya (≈ 250 ms). Setelah memudar, elemen itu tidak terlihat dan tidak bisa difokus;
  - task Aktif dipaksa terbuka;
  - satu baris kecil menggantikan daftar: "Mode Zen · n task lain disembunyikan sampai istirahat".
- **Saat tidak aktif** (istirahat, Jeda, Stop, awaiting, atau toggle mati), semua elemen muncul kembali dengan fade-in.
- **Implementasi:** hanya lewat kelas CSS. Komponen tetap ter-mount; state dan data tidak disentuh. Dengan `prefers-reduced-motion`, tidak ada animasi.

### 7.4 Suara latar
- **Kontrol** ada di pojok kanan bawah kolom kanan kartu, sebaris dengan statistik; di layar sempit kontrol turun ke baris sendiri.
  - Isinya: ikon headphone, `<select>` (Off, Hujan, Brown Noise, Detak Jam), dan slider volume 0–100 (default 50).
  - Pilihan dan volume disimpan di `localStorage` (`tf_ambient_sound`, `tf_ambient_volume`).
- **Mesin** ada di modul baru `static/offline/ambient.js` dan dijalankan di tingkat App, sehingga suara tetap berbunyi saat pindah halaman selama Work berjalan. Mesin ini memakai satu `HTMLAudioElement` dengan `loop = true` dan satu `GainNode`.

| Status timer | Suara |
|---|---|
| Work berjalan (countdown atau Overtime) | `play()`, gain naik dari 0 ke volume slider dalam 1 detik. |
| Work dijeda | Gain turun ke 0 dalam 1 detik, lalu `pause()` (posisi tetap). |
| Stop | Gain turun ke 0 dalam 1 detik, lalu `pause()` dan `currentTime = 0`. |
| Istirahat (Short/Long, berjalan atau diam) dan awaiting | Dipastikan `paused`; fade-out 1 detik bila sedang berbunyi. |
| Pilihan suara diganti saat berbunyi | Fade-out, ganti sumber, lalu fade-in 1 detik. |
| Off | `pause()`. |

- **File:**
  - `static/sounds/{hujan,brown-noise,detak-jam}-v1.{ogg,mp3}`, dibuat oleh `scripts/gen_ambient_sounds.py` (numpy + ffmpeg, seed tetap) dan di-commit ke repo.
  - Hujan dan Brown Noise berupa loop 30 detik yang tersambung mulus; Detak Jam berupa loop 10 detik. Target ukuran ≤ 250 KB per file, dengan kenyaringan yang setara antar suara.
  - File diambil **hanya** saat suara dipilih di dropdown, atau saat Work mulai dengan pilihan yang tersimpan. Tidak ada `<audio src>` atau prefetch saat halaman dibuka.
  - SW melayani `/static/sounds/` secara cache-first dari cache `alurik-ambient-v1`. Cache ini tidak dihapus oleh `activate`; versi file dikodekan di nama file.
- **Autoplay:** Work dimulai dari klik, jadi `play()` diizinkan browser. Bila `play()` ditolak (misalnya timer yang berjalan dipulihkan setelah reload), suara menunggu `pointerdown` berikutnya di dokumen lalu mencoba sekali lagi. Selama menunggu, ikon kontrol menampilkan status "menunggu ketukan".

### 7.5 Overtime
- **Kartu:**
  - kelas `is-overtime` mengganti tinta menjadi ungu (`#8b5cf6`, teks `#c4b5fd`);
  - cincin menunjukkan putaran 25 menit yang sedang berjalan;
  - waktu tampil sebagai `+mm:ss` dengan label "Overtime".
- **Kontrol per fase** (`PomoControls`):
  - countdown: Mulai/Jeda · Stop · Lewati (tidak berubah);
  - awaiting: **Ambil Istirahat** (hijau) · **Lanjut Fokus** dengan subteks "Overtime" (ungu) · Stop;
  - overtime: Jeda/Lanjutkan · Stop · Ambil Istirahat.
- **Bar ringkas:** memakai tombol yang sama dalam versi ringkas.
- **Chip top bar:**
  - awaiting → `00:00` berdenyut tanpa tombol play/pause, dengan tooltip "Pomodoro selesai — klik untuk memilih istirahat atau lanjut";
  - overtime → `+mm:ss` berwarna ungu, dengan tombol jeda/lanjut.
- **Statistik:** Pomodoro = `pomodorosToday`, Set lengkap = ⌊`pomodorosToday` / 4⌋, Waktu fokus = `totalFocusTime` (D8).
- **Tip bawah** diperbarui menjadi: "25 menit fokus, lalu pilih istirahat atau lanjut overtime. Setelah 4 pomodoro, istirahat panjang 15 menit."

## 8. Error & kasus tepi
- **Offline:** semua fitur tetap berjalan. Parkir Distraksi dan estimasi lewat route lokal. 🍅 diantre di outbox dan langsung terlihat di realisasi.
- **Task fokus dilepas atau dihapus selama sesi:**
  - bila fokus dilepas, pencatatan memakai `sessionTaskId`;
  - bila task sudah dihapus lokal, op dibuang.
- **Reload:**
  - fase awaiting dipulihkan bersama tombol pilihannya;
  - countdown yang habis selama halaman tertutup diselesaikan saat muat (seperti sekarang), lalu masuk awaiting;
  - Overtime yang berjalan dihitung dari jam dinding dan dibatasi 120 menit (D9).
- **Dua tab:**
  - `client_id` deterministik mencegah 🍅 dobel di server;
  - op dengan `cid` sama tidak diantre dua kali;
  - statistik per perangkat mengikuti `tf_pomo_state` yang terakhir ditulis.
- **Konflik estimasi antar perangkat:** mengikuti aturan LWW/`base_rev` task yang sudah ada.
- **Input Parkir Distraksi:** menahan propagasi tombol, supaya shortcut keyboard global (bila ada) tidak terpicu saat mengetik.
- **Audio:**
  - gagal dimuat (offline sebelum file pernah diunduh) → ikon kontrol menunjukkan error dengan tooltip "Suara belum tersedia offline"; timer tidak terpengaruh;
  - Off atau volume 0 → `play()` tidak dipanggil.

## 9. Pengujian

**pytest**
- Migrasi idempoten (kolom + tabel) di DB lama dan baru.
- `POST .../pomodoros`:
  - sukses;
  - `client_id` duplikat tidak menambah realisasi;
  - validasi `kind` dan batas nilai;
  - 403 bila tanpa akses, 404 bila task tidak ada;
  - task done tetap diterima;
  - `updated_at` task tidak berubah;
  - anggota workspace menambah realisasi task bersama;
  - task dihapus → `task_id` di log menjadi NULL.
- `estimated_pomodoros` di create/update: nilai default, batas 1–20, dan field yang tidak dikirim tidak mengubah nilai.

**Tes node** (`tests/offline/`)
- `pomologic`: format waktu, kelipatan 25 menit, batas 7200, aturan istirahat panjang, ringkasan header, `client_id`.
- Mesin timer: semua transisi §6.2 dengan jam palsu.
- `pomolog` + route lokal: dedupe op dan jumlah pending.
- `opPomodoroCreate`: transaksi saat 2xx, menahan op saat create induk tertunda, serta 404/403/4xx/5xx.
- hydrate/pull: `pomodoros_done` sebagai field turunan.
- Payload create/update: `estimated_pomodoros`.
- `ambient`: pemetaan status ke aksi, jadwal fade dengan timer palsu, lazy load.
- Visibilitas Zen.

**E2E Playwright** (terang + gelap, desktop + 375 px; jam dimajukan dengan Clock API)
- Parkir Distraksi online dan offline: jumlah "N tugas" tetap, dan task ada di Inbox.
- Estimasi lewat klik; header `X / Y (~Z jam)`; oranye saat realisasi lewat estimasi.
- 🍅 bertahan setelah reload dan terkirim sekali walaupun dua tab terbuka.
- Zen menyembunyikan dan menampilkan daftar sesuai status timer; subtask task Aktif tetap bisa dicentang.
- Suara:
  - tidak ada request `/static/sounds/` saat halaman dibuka, dan ada request setelah suara dipilih;
  - `paused` dan gain mengikuti setiap status timer;
  - hening saat istirahat.
- Overtime:
  - 00:00 → chime + tombol pilihan;
  - `+25:00` → +1 🍅 di statistik dan di Task Aktif;
  - berhenti di `+12:00` → hanya +1 dari sesi utama, dan Waktu fokus bertambah;
  - batas 120 menit.

**Per PR:** seluruh `pytest` dan `npm test` dijalankan. Kegagalan pra-ada `draw_local_reactive` dicatat terpisah.

## 10. Pembagian PR

Setiap PR berupa draft. Nomor SW dan `app.css?v=` dinaikkan ke nomor kosong berikutnya, modul JS baru dimasukkan ke daftar precache `STATIC` di `sw.js`, dan handover ditulis di `.agents/`. Merge hanya dilakukan setelah pemilik bilang "merge dan deploy".

1. **PR A — Parkir Distraksi + Mode Zen** (frontend): §7.1 dan §7.3.
2. **PR B — Target 🍅** (backend + offline + UI): §4, §5, §7.2, D15, dan pencatatan sesi utama di `handleTimerComplete`. `taskPomodoros` dihapus. Sampai PR C, X di header dan statistik Pomodoro memakai `sessionCount` (belum ada `pomodorosToday`). Menulis ADR-021. Deploy: restart `taskflow-web` dan `taskflow` (ada migrasi).
3. **PR C — Overtime** (frontend): seluruh §6 dan §7.5. Zen ikut memperlakukan Overtime sebagai Work berjalan.
4. **PR D — Suara latar** (frontend + aset + SW): §7.4. Status "Work berjalan" mencakup Overtime dari PR C.

## 11. Di luar cakupan
- Statistik dan riwayat lintas perangkat beserta grafiknya. Log sudah menyimpan datanya, tetapi belum ditampilkan.
- Pengaturan durasi Pomodoro.
- Toggle Auto-Overtime.
- Estimasi di modal detail task, tampilan Compact, Kanban, dan dashboard.
- Ekspor `pomodoro_log` di Ekspor Data, dan bot Telegram.
- Celah lain halaman Fokus yang dicatat saat brainstorming: tombol Fokus di halaman ini tidak memulai timer, dan task dengan deadline hari ini tidak ikut tampil.
- Sinkronisasi langsung state timer antar tab.

## 12. ADR
**ADR-021** (ditulis di PR B): realisasi Pomodoro disimpan sebagai log append-only `pomodoro_log` ditambah kolom turunan `tasks.pomodoros_done` yang tidak menyentuh `updated_at`. Pencatatan idempoten lewat `client_id` yang deterministik per sesi. Di klien, pencatatan memakai op outbox payload-only `pomodoro_log/create`, tanpa store IndexedDB baru.
