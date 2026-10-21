# Spec: Halaman Fokus Hari Ini — memilih task (tab waktu, cari, chip, filter tersembunyi, kelompok Workspace › Project)

- **Tanggal:** 2026-10-22
- **Basis kode:** `main` @ `c771b54` (mtyatno/taskflow-v4; SW v452, `app.css?v=356`)
- **Status:** desain disetujui dalam sesi brainstorming 2026-10-21/22 (pemilik + Claude). Tata letak dipilih lewat prototipe interaktif: opsi A ditambah filter tersembunyi seperti opsi C. Spec tertulis ini menunggu review pemilik sebelum rencana implementasi dibuat.
- **Salinan:** repo `docs/superpowers/specs/2026-10-22-fokus-filter-task-design.md` dan Project claude.ai "alurik" `claude/spec-fokus-filter-task-2026-10-22.md`. Isi keduanya sama.
- **Prototipe:** artifact "Filter Halaman Fokus" (versi 2), berisi 16 task contoh dengan kontrol yang benar-benar menyaring. Bila ada perbedaan, spec ini yang berlaku.
- **Istilah:**
  - *halaman Fokus* = `TodayFocusView` (`page === "today"`), judul "Fokus Hari Ini";
  - *cakupan* = himpunan task yang boleh tampil di halaman Fokus (§4.1);
  - *task aktif* = task yang sedang dipegang timer (`focusTask`, dari App `focusTaskId`);
  - *task ⭐* = task dengan `is_focused = true` (flag lama yang sudah tersinkron);
  - *Target* = seksi "Target hari ini" berisi task aktif dan task ⭐;
  - *daftar* = seksi "Task hari ini" di bawah Target, satu-satunya bagian yang tersaring;
  - *bucket waktu* = `late` (terlambat), `today` (deadline hari ini), atau `none` (tanpa deadline / deadline mendatang);
  - *filter tersembunyi* = Status, Prioritas lengkap, Kuadran lengkap, dan Workspace › Project di lembar filter;
  - *chip cepat* = P1, P2, P3, Q1, Q3 di baris chip;
  - *pil* = chip gelap di baris chip yang mewakili filter tersembunyi non-default dan bisa dihapus dengan ✕.

---

## 1. Tujuan

Pengguna kesulitan memilih task di halaman Fokus karena task dari banyak project bercampur dalam satu daftar tanpa urutan yang bisa diatur. Sekitar 8 task ber-deadline hari ini tenggelam di bawah 19 task terlambat. Halaman ini harus membuat pemilihan task cepat di HP (PWA Chrome terinstal) maupun di desktop.

**Kriteria berhasil**
1. **Target di atas.** Task aktif dan semua task ⭐ tampil di seksi Target di atas bar filter. Seksi ini tidak pernah tersaring, dan task di dalamnya tidak muncul lagi di daftar. Bintang bisa dipasang/dilepas langsung dari baris task di halaman Fokus.
2. **Tab waktu.** Segmen "Semua N | Hari ini N | Terlambat N" memisahkan task ber-deadline hari ini dari yang terlambat. Angkanya ikut memperhitungkan filter lain yang sedang aktif.
3. **Cari.** Mengetik di kotak cari langsung menyaring judul task (tanpa membedakan huruf besar/kecil).
4. **Chip cepat.** P1, P2, P3, Q1, Q3 bisa dikombinasikan: "atau" dalam satu jenis, "dan" antarjenis.
5. **Filter tersembunyi.** Tombol Filter di samping kotak cari membuka lembar berisi Status (default Next saja), Prioritas P1–P4, Kuadran Q1–Q4, dan satu Workspace › Project.
   - Tombol memberi badge jumlah filter non-default.
   - Filter non-default tampil sebagai pil di baris chip.
   - Di bawah daftar ada catatan "N task berstatus lain disembunyikan · Tampilkan".
6. **Kelompok.** Daftar dikelompokkan per Workspace › Project dengan judul yang bisa dilipat beserta jumlah task.
7. **Diingat per perangkat.** Tab, chip, filter tersembunyi, dan kelompok yang terlipat tetap sama setelah reload, logout/login, dan offline. Kata pencarian tidak disimpan.
8. **Cakupan konsisten.** Cakupan = Q1 + terlambat + deadline hari ini + ⭐ + task aktif. Angka di sidebar, halaman Fokus, dan kartu Prioritas dashboard dihitung dari fungsi yang sama.
9. **Aman di HP.** Tidak ada scroll horizontal pada lebar 375 px. Mode Zen tetap menyembunyikan semuanya kecuali task aktif. Storage yang diblokir atau isi storage yang rusak tidak membuat halaman crash.

## 2. Keputusan

| # | Keputusan | Alasan |
|---|---|---|
| K1 | Kebutuhan: kelompok per project, filter satu project, cari, tab waktu, filter status (default Next), chip Prioritas/Kuadran, dan pin kandidat di atas. | Permintaan pemilik 2026-10-21. |
| K2 | Dimensi kelompok: Workspace › Project. | Pilihan pemilik. Project pribadi dan project workspace dengan nama sama tidak boleh tercampur. |
| K3 | Pin memakai ⭐ `is_focused` yang sudah ada, tampil sebagai seksi Target. | Pilihan pemilik. Tidak perlu kolom/sinkronisasi baru, dan bintang sudah dipakai di halaman Tasks. |
| K4 | Cakupan = Q1 + terlambat + deadline hari ini + ⭐ (+ task aktif). | Pilihan pemilik. Task ber-deadline hari ini yang bukan Q1 sebelumnya tidak tampil. |
| K5 | Status default = Next saja. | Pilihan pemilik. Inbox/Waiting/Someday disembunyikan, tetapi jumlahnya terlihat. |
| K6 | Urutan = Prioritas, tanpa pilihan urutan lain. | Pilihan pemilik (YAGNI). |
| K7 | Tata letak = opsi A (tab waktu + cari + baris chip) ditambah filter tersembunyi di lembar, dibuka dari tombol di samping kotak cari (seperti opsi C). | Pilihan pemilik setelah mencoba mockup. |
| K8 | Seksi Target ditempatkan di atas bar filter. | Disetujui di prototipe v2. Menegaskan bahwa Target tidak ikut tersaring. |
| K9 | Bucket waktu dihitung di klien dari `deadline` dibanding tanggal lokal perangkat (`todayLocalISO`), bukan dari `is_overdue` server. | `is_overdue` dihitung dengan `date.today()` server dan disimpan apa adanya di IndexedDB. Nilainya basi saat offline dan setelah tengah malam, dan berbeda dari tanggal pengguna (WIB) antara 00.00–07.00. Lihat ADR-027. |
| K10 | Logika murni di modul baru `static/offline/focusfilter.js` (`TF.focusfilter`), komponen UI di `index.html`. | Mengikuti pola `focuspage.js` / `pomologic.js`: bisa diuji di Node tanpa React. |
| K11 | Hanya klien. Tidak ada perubahan server, skema, atau API. | Semua data sudah ada di task (`quadrant`, `priority`, `gtd_status`, `deadline`, `project`, `list_id`, `is_focused`). |

## 3. Kondisi sekarang

- `TodayFocusView` (`static/index.html`) menyaring `tasks` dengan `(quadrant === "Q1" || is_overdue || is_focused || id === focusTask.id) && gtd_status ∉ {done, archived}`, lalu mengurutkan: task aktif, terlambat, lalu P1→P4. Semua task tampil dalam satu `.ftask-list` di seksi "Task hari ini". Tidak ada kelompok, cari, maupun filter.
- Definisi cakupan yang sama tersalin di tempat lain dengan isi yang sudah berbeda:
  - `Sidebar` → `todayCount` (badge menu Fokus): sama dengan `TodayFocusView`;
  - `Dashboard` → `allToday` (cincin hero + kartu Prioritas): menambah `deadline === todayStr`, tetapi `todayStr` memakai tanggal **UTC** (`new Date().toISOString()`), dan done tidak dikecualikan (dipakai untuk progres);
  - `App.getFilteredTasks()` kasus `"today"`: sama dengan `Sidebar` tanpa task aktif.
- `FocusTaskItem` tidak punya tombol ⭐. Bintang hanya bisa diubah dari halaman Tasks / detail task, lewat `App.handleToggleFocus(taskId)` → `POST /api/tasks/:id/focus`. Rute ini dilayani lokal saat offline (`taskroutes.js`) dan disinkronkan (`syncpush.js`, K6).
- Mode Zen: `TF.focuspage.zenActive` + kelas `is-zen-hidden` / `is-zen-shown` di `FocusTaskItem` dan seksi "Berulang hari ini"; catatan `.focus-zen-note`.
- Kunci grup project yang sudah ada: `projectGroupKey(task)` = `(list_id ?? "p") + ":" + projectNameFold(project)`; `projectScopeOf(task)`; `groupTasksByProject` (halaman Tasks).
- `TodayFocusView` belum menerima `sharedLists`. App punya `sharedLists` (state) dan meneruskannya ke `Dashboard`.

## 4. Cakupan dan bucket waktu

### 4.1 `inTodayScope(task, opts)`

```
opts = { todayISO, focusTaskId = null, includeDone = false }
```

Mengembalikan `true` bila:
- `task.gtd_status !== "archived"`, dan `task.gtd_status !== "done"` kecuali `includeDone`; dan
- salah satu berlaku:
  - `task.quadrant === "Q1"`;
  - `timeBucket(task, todayISO) === "late"`;
  - `timeBucket(task, todayISO) === "today"`;
  - `task.is_focused` bernilai benar;
  - `focusTaskId != null && String(task.id) === String(focusTaskId)`.

Pemakai:
- `Sidebar.todayCount`: `inTodayScope(t, { todayISO, focusTaskId })`.
- `TodayFocusView`: cakupan halaman, dengan `focusTaskId = focusTask?.id`.
- `Dashboard.allToday`: `inTodayScope(t, { todayISO, includeDone: true })`. Tanggal pindah dari UTC ke `todayLocalISO()`. Pengurutan `pendingToday` mengganti `is_overdue` dengan `timeBucket(...) === "late"`.
- `App.getFilteredTasks()` kasus `"today"`: `inTodayScope(t, { todayISO })`.

`todayISO` di semua tempat = `window.TF.tasklogic.todayLocalISO()`.

### 4.2 `timeBucket(task, todayISO)`

- `deadline` kosong, `null`, atau tidak berbentuk `YYYY-MM-DD` → `"none"`.
- Hanya 10 karakter pertama `deadline` yang dipakai. Bila `< todayISO` (perbandingan string ISO) → `"late"`, bila `=== todayISO` → `"today"`, selain itu → `"none"`.
- Task done/archived tidak pernah `late` (konsisten dengan `is_overdue` server). Pada praktiknya pemanggil sudah mengecualikannya, kecuali Dashboard yang tidak memakai bucket untuk task done.

## 5. Model filter dan penyimpanan

### 5.1 Struktur

```
filter = {
  time:   "all" | "today" | "late",        // default "all"
  status: Array<"next"|"inbox"|"waiting"|"someday">,  // default ["next"]; [] = semua status
  pri:    Array<"P1"|"P2"|"P3"|"P4">,      // default []  ([] = tanpa filter)
  quad:   Array<"Q1"|"Q2"|"Q3"|"Q4">,      // default []
  proj:   null | { key: string, label: string }  // default null; key = groupKey (§6.3)
}
```

- `DEFAULT_FILTER` dibekukan (`Object.freeze`, termasuk array di dalamnya).
- Kata pencarian (`query`) adalah state React biasa dan tidak masuk `filter`.

### 5.2 `normalizeFilter(raw)`

Mengembalikan filter baru yang selalu valid:
- Bukan objek → salinan `DEFAULT_FILTER`.
- `time` yang tidak dikenal → `"all"`.
- `status` / `pri` / `quad`: hanya nilai yang dikenal, tanpa duplikat, dalam urutan kanonis (`next, inbox, waiting, someday` / `P1..P4` / `Q1..Q4`). `status` yang bukan array → `["next"]`. `pri` / `quad` yang bukan array → `[]`.
- `proj`: harus objek dengan `key` string tak kosong ≤ 300 karakter. `label` diambil bila string (dipotong 120 karakter), selain itu `""`. Bentuk lain → `null`.

### 5.3 `nonDefaultCount(filter)`

Jumlah item yang membuat filter tersembunyi berbeda dari default, dipakai untuk badge tombol Filter:
- +1 bila `status` ≠ `["next"]`;
- +1 bila `proj` ≠ `null`;
- +1 per nilai `pri` yang **bukan** chip cepat (`P4`);
- +1 per nilai `quad` yang bukan chip cepat (`Q2`, `Q4`).

Chip cepat (P1–P3, Q1, Q3) dan `time` tidak dihitung karena sudah terlihat langsung.

### 5.4 Penyimpanan per perangkat

- `tf_focus_filter`: JSON `filter` yang sudah dinormalisasi, ditulis setiap kali filter berubah.
- `tf_focus_collapsed`: JSON array `groupKey` yang terlipat, tanpa duplikat, maksimal 200 entri (yang tertua dibuang).
- `readFilter(storage)` / `writeFilter(storage, filter)` / `readCollapsed(storage)` / `writeCollapsed(storage, keys)`:
  - setiap akses dibungkus try/catch, sehingga `storage` null, `getItem` yang melempar, atau JSON rusak menghasilkan default;
  - `write*` yang gagal diabaikan diam-diam.
- Komponen memakai pola `zenStorage()` yang sudah ada (mengakses `window.localStorage` bisa melempar SecurityError).
- Kedua kunci tidak dihapus saat logout, sama seperti `tf_focus_zen`.

## 6. Penyaringan, hitungan, pengelompokan, urutan

### 6.1 Pembagian halaman

Dari `scope = tasks.filter(t => inTodayScope(t, { todayISO, focusTaskId }))`:
- `target` = task aktif (bila ada di `scope`) lalu task ⭐ lainnya. Diurutkan dengan `comparePriority` (§6.4), task aktif selalu pertama.
- `pool` = `scope` tanpa anggota `target`. Hanya `pool` yang disaring dan dikelompokkan.
- Header halaman (`headerSummary.count`, "N tugas") tetap memakai `scope.length`, dan estimasi tetap dijumlahkan dari `scope` seperti sekarang.

### 6.2 `matches(task, filter, opts)`

```
opts = { todayISO, query = "", except = null }   // except ∈ {null, "time", "status"}
```

Task lolos bila semua syarat berikut terpenuhi (syarat yang namanya sama dengan `except` dilewati):
- **time:** `filter.time === "all"` atau `timeBucket(task) === filter.time`.
- **query:** `query.trim()` kosong, atau `title` mengandung `query.trim()`. Keduanya dilipat dengan `toLocaleLowerCase("id")` dan spasi berulang dirapatkan.
- **status:** `filter.status` kosong atau memuat `task.gtd_status`.
- **pri:** `filter.pri` kosong atau memuat `task.priority`.
- **quad:** `filter.quad` kosong atau memuat `task.quadrant`.
- **proj:** `filter.proj` null atau `groupKey(task) === filter.proj.key`.

### 6.3 Hitungan

- `timeCounts(pool, filter, opts)` → `{ all, today, late }`, dihitung dari task yang lolos `matches(..., except: "time")`. `all` = jumlah total yang lolos, termasuk bucket `none`.
- `statusCounts(pool, filter, opts)` → `{ next, inbox, waiting, someday }`, dari `matches(..., except: "status")`.
- `hiddenByStatus` = jumlah task yang lolos `except: "status"` tetapi gagal `matches` penuh. Dipakai untuk catatan di bawah daftar.
- `projectOptions(pool, sharedLists)` → daftar `{ key, label, count }` untuk lembar filter, dari seluruh `pool` (tanpa filter lain), dalam urutan kelompok §6.4. Bila `filter.proj` tidak ada di daftar (project sudah tidak punya task), opsi itu ditambahkan di akhir dengan `count: 0` dan label tersimpan.

### 6.4 Kelompok dan urutan

- `groupKey(task)` = `(list_id == null || list_id === "" ? "p" : String(list_id)) + ":" + projectNameFold(project || "")`. Sama dengan `projectGroupKey` untuk task ber-project. Task tanpa project mendapat akhiran `":"` kosong per scope.
- `groupTasks(tasks, sharedLists)` → `[{ key, workspaceLabel, projectLabel, tasks }]`:
  - `workspaceLabel`: `"Pribadi"` untuk scope `p`; nama dari `sharedLists` (dicocokkan dengan `String(id)`) untuk scope workspace; `"Workspace"` bila tidak ditemukan.
  - `projectLabel`: nama project dari task pertama di kelompok (kapitalisasi asli); `"Tanpa project"` untuk task tanpa project.
  - Urutan kelompok:
    1. Pribadi lebih dulu, lalu workspace menurut `workspaceLabel` (`localeCompare` "id", sensitivity base), lalu `list_id`;
    2. di dalam satu scope, project menurut `projectCompare`, dengan "Tanpa project" paling akhir.
  - Urutan task di dalam kelompok: `comparePriority`.
- `comparePriority(a, b)`:
  1. prioritas `P1 < P2 < P3 < P4` (nilai tak dikenal setelah P4);
  2. deadline paling awal lebih dulu, task tanpa deadline paling akhir;
  3. judul (`localeCompare` "id");
  4. `id`.
- `filter.proj.label` = `workspaceLabel + " · " + projectLabel` saat dipilih.

## 7. UI

### 7.1 Susunan halaman

Dari atas ke bawah:
1. Header (tanggal, judul, ringkasan).
2. Kartu Pomodoro (+ bar ringkas).
3. "Berulang hari ini", tidak berubah dan tidak tersaring.
4. **Target hari ini** (`FocusTargetSection`). Disembunyikan bila kosong.
5. **Task hari ini**: `FocusSectionHead` (jumlah = task yang tampil setelah filter), `FocusFilterBar`, kelompok, catatan status tersembunyi, dan pesan kosong.

### 7.2 Baris task (`FocusTaskItem`)

- Prop baru:
  - `onToggleStar(task)` menampilkan tombol ⭐ di baris, sebelum tombol Fokus/Aktif:
    - `type="button"`, kelas `ftask-star`, ikon `star` dengan fill bila `task.is_focused`;
    - `aria-pressed={!!task.is_focused}`;
    - `aria-label` "Tandai sebagai target hari ini" / "Lepas dari target hari ini";
    - `stopPropagation` agar baris tidak ikut terbuka.
  - `hideProject` (true di dalam kelompok) menyembunyikan info project di meta, karena sudah tertulis di judul kelompok.
- `TodayFocusView` menerima prop baru `onToggleFocus` (App meneruskan `handleToggleFocus`) dan `sharedLists`.
- Toast yang sudah ada ("⭐ Ditambahkan ke Fokus" / "☆ Dihapus dari Fokus") tetap dipakai.
- Setelah bintang dilepas, task pindah ke daftar bila masih dalam cakupan, atau hilang dari halaman bila tidak.

### 7.3 `FocusTargetSection`

- `FocusSectionHead` dengan glyph bintang, judul "Target hari ini", dan jumlah.
- Berisi `FocusTaskItem` untuk task di `target`, dengan latar lembut aksen (`.focus-target`). Info project tetap tampil.
- Saat Mode Zen aktif, task ⭐ non-aktif mendapat `zenHidden` seperti sekarang, dan task aktif tetap tampil terbuka.

### 7.4 `FocusFilterBar`

Tiga baris, masing-masing setinggi satu kontrol, `flex-shrink: 0`:
1. **Tab waktu.** Grup tombol `role="group"` `aria-label="Waktu"`, tiga tombol `aria-pressed`: "Semua N", "Hari ini N", "Terlambat N" (angka dari `timeCounts`, `tabular-nums`). Tombol aktif berlatar gelap.
2. **Cari + Filter.**
   - `input type="search"` dengan placeholder "Cari judul task…", `aria-label="Cari task"`, `enterKeyHint="search"`, tombol ✕ bawaan atau tombol hapus sendiri bila tidak kosong.
   - Tombol ikon Filter (`aria-label` "Filter lainnya" + ", N aktif" bila ada; `aria-haspopup="dialog"`, `aria-expanded`), dengan badge `nonDefaultCount` bila > 0.
3. **Baris chip**, dapat digeser horizontal tanpa scrollbar, urutannya:
   - **pil** untuk filter tersembunyi non-default (gelap, label + ✕, `aria-label` "Hapus filter …"):
     - Status bila ≠ default: "Status: Next, Waiting" atau "Semua status". ✕ mengembalikan ke `["next"]`.
     - Project bila ada: label tersimpan. ✕ → `null`.
     - P4, Q2, Q4 bila dipilih, masing-masing satu pil.
   - **chip cepat** P1, P2, P3, Q1, Q3 (`aria-pressed`), yang mengubah `filter.pri` / `filter.quad`.
   - chip **Reset** (garis putus-putus), hanya bila ada filter apa pun yang berbeda dari default atau `query` tak kosong. Reset mengembalikan `DEFAULT_FILTER` dan mengosongkan `query`.

### 7.5 `FocusFilterSheet`

- **HP (`max-width: 768px`):** lembar dari bawah (`position: fixed`, maks 86vh, bisa digulir) dengan latar redup.
- **Desktop:** panel lepas (`position: absolute`) di bawah tombol Filter, rata kanan, lebar 340 px.
- Elemen `role="dialog"` `aria-modal="true"` `aria-labelledby` judul "Filter lainnya".
- Isi:
  - **Status:** chip Next, Inbox, Waiting, Someday dengan angka `statusCounts`, bisa multi-pilih. Catatan kecil: "Default: Next saja. Kosongkan semua untuk menampilkan semua status."
  - **Prioritas:** P1–P4, multi-pilih (state yang sama dengan chip cepat).
  - **Kuadran:** "Q1 Lakukan", "Q2 Rencanakan", "Q3 Delegasikan", "Q4 Singkirkan", multi-pilih.
  - **Workspace › Project:** "Semua" + `projectOptions` (label + angka), satu pilihan.
  - **Aksi (menempel di bawah):** "Reset" (mengembalikan status/pri/quad/proj ke default, tanpa menyentuh `time` dan `query`) dan "Tampilkan N task" (N = hasil `matches` penuh, menutup lembar).
- Perubahan berlaku seketika; tidak ada tombol "Terapkan" terpisah.
- Menutup: Esc, ketuk latar/di luar panel, atau tombol Tampilkan. Fokus kembali ke tombol Filter.
- Saat dibuka, fokus pindah ke chip pertama. Tab berputar di dalam dialog selama terbuka.
- Di HP, scroll halaman dikunci selama lembar terbuka.

### 7.6 Kelompok

- Judul kelompok berupa tombol `aria-expanded`: chevron, `workspaceLabel ·` (warna redup), `projectLabel`, dan jumlah di kanan.
- Klik melipat/membuka kelompok dan memperbarui `tf_focus_collapsed`.
- Kelompok terlipat hanya menampilkan judulnya. Hitungan tetap terlihat.
- Isi kelompok adalah `FocusTaskItem` dengan `hideProject`.
- Task aktif tidak pernah ada di kelompok karena selalu di Target.

### 7.7 Pesan dan catatan

- **Cakupan kosong** (`scope.length === 0`): pesan lama diperbarui menjadi "Tidak ada task urgent!" / "Semua Q1, terlambat, dan deadline hari ini sudah selesai." Bar filter tidak ditampilkan.
- **`pool` kosong tetapi Target ada:** bar filter tidak ditampilkan. Tampil teks kecil "Semua task hari ini sudah ada di Target."
- **Filter tidak menyisakan task:** kotak garis putus-putus "Tidak ada task yang cocok dengan filter ini." + tombol tautan "Reset filter".
- **`hiddenByStatus > 0`:** "N task berstatus lain disembunyikan · Tampilkan". Tombol "Tampilkan" mengubah `filter.status` menjadi `[]` (semua status).

### 7.8 Mode Zen

- Saat `zenOn`, `FocusFilterBar`, semua kelompok, catatan, dan pesan kosong mendapat `is-zen-hidden` dan `aria-hidden`. Saat `zenReveal`, mereka mendapat `is-zen-shown`, memakai kelas yang sudah ada.
- `zenHiddenCount` = jumlah seluruh `scope` selain task aktif + `recurringToday.length` (tidak terpengaruh filter).
- Lembar filter yang terbuka ditutup saat Zen menjadi aktif.

### 7.9 CSS (`static/app.css`)

- Kelas baru diberi awalan `focus-filter-*`, `focus-target`, `focus-group-*`, `ftask-star`.
- Memakai token yang ada (`--bg-card`, `--border`, `--text-*`, `--accent`). Tema gelap mengikuti `[data-theme="dark"]` seperti seksi Fokus lain.
- Lebar 375 px tanpa scroll horizontal. Target sentuh ≥ 36 px.
- `prefers-reduced-motion` mematikan transisi chevron dan animasi lembar.

## 8. Error dan kasus tepi

- **Task aktif di luar cakupan** (misalnya P3 tanpa deadline yang dimulai dari halaman Tasks) tetap tampil di Target karena `focusTaskId`.
- **Task aktif berstatus non-Next** tetap tampil di Target; filter tidak menyentuh Target.
- **Filter project yang basi** (semua task project itu selesai atau dipindah) tetap tersimpan:
  - pil tetap tampil;
  - opsi tetap ada di lembar dengan angka 0;
  - daftar menampilkan pesan "tidak ada yang cocok" + Reset.
- **Workspace yang ditinggalkan / tidak ada di `sharedLists`** → label "Workspace". Task tetap dikelompokkan per `list_id`.
- **Prioritas/kuadran kosong atau tak dikenal:** lolos bila filter jenis itu kosong, gagal bila filter jenis itu terisi. Urutannya setelah P4.
- **`deadline` rusak** → bucket `none`.
- **Lewat tengah malam saat halaman terbuka:** `todayISO` dihitung ulang setiap render. Tidak ada timer khusus. Render berikutnya (tick Pomodoro, sinkronisasi, interaksi) memindahkan task ke bucket yang benar.
- **localStorage diblokir:** filter berjalan di memori dengan default, dan tidak ada error.
- **JSON rusak / nilai asing** → `normalizeFilter` membuang yang tidak valid.
- **Toggle ⭐ gagal (offline tanpa router lokal / error server):** toast error dari `handleToggleFocus`, dan tampilan tidak berubah.
- **Task yang tidak di-render tetap bisa ditandai selesai di tempat lain;** daftar dibentuk ulang dari `tasks` setiap render.
- **Jumlah besar (ratusan task dalam cakupan):** semua fungsi O(n) per render, dengan `useMemo` atas `[tasks, filter, query, todayISO, focusTaskId, sharedLists]`. Tidak ada virtualisasi (di luar cakupan).

## 9. Pengujian

### 9.1 Unit — `tests/offline/focusfilter.test.js` (Node, memuat modul UMD)

- **`timeBucket`:** late / today / none, deadline dengan jam (`2026-10-22T10:00`), deadline rusak, deadline mendatang, dan pergantian `todayISO` (tengah malam).
- **`inTodayScope`:**
  - tiap pemicu (Q1, late, today, ⭐, `focusTaskId` angka vs string);
  - done/archived dikecualikan;
  - `includeDone` hanya membuka done, tidak archived;
  - task Q2 ber-deadline mendatang tidak masuk.
- **`normalizeFilter`:** non-objek, nilai asing, duplikat, urutan kanonis, `status` bukan array, dan `proj` rusak / key terlalu panjang.
- **`matches`:** OR dalam jenis, AND antarjenis, `status: []` = semua, query (huruf besar/kecil, spasi), `except: "time"` / `"status"`, dan `proj` key.
- **`timeCounts`, `statusCounts`, `hiddenByStatus`:** contoh 16 task dari prototipe; angka harus sama dengan prototipe v2 (Semua 10 / Hari ini 4 / Terlambat 5; 4 tersembunyi).
- **`groupTasks`:**
  - Pribadi lebih dulu, workspace urut nama, "Tanpa project" paling akhir;
  - nama project sama di scope berbeda tidak tercampur;
  - kapitalisasi beda dalam satu scope = satu kelompok;
  - workspace tak dikenal → "Workspace".
- **`comparePriority`:** prioritas → deadline (null terakhir) → judul → id.
- **`nonDefaultCount`:** default = 0; status, proj, P4, Q2/Q4 menambah; chip cepat tidak menambah.
- **`projectOptions`:** urutan, angka, dan opsi basi ditambahkan dengan angka 0.
- **Storage:** `readFilter` / `readCollapsed` dengan storage null, `getItem` yang melempar, JSON rusak, dan batas 200 kunci; `write*` yang melempar tidak bocor.

### 9.2 Sumber — `tests/offline/focus_filter_ui.test.js` (gaya `focus_*_ui`)

- `Sidebar`, `TodayFocusView`, `Dashboard`, dan `getFilteredTasks` memanggil `focusfilter.inTodayScope`. Pola lama `t.quadrant === "Q1" || t.is_overdue` tidak ada lagi di keempat tempat itu.
- `TodayFocusView` merender `FocusTargetSection`, `FocusFilterBar`, dan `FocusFilterSheet`, serta menerima `sharedLists` dan `onToggleFocus`. App meneruskan keduanya.
- Label berikut ada: "Target hari ini", "Semua", "Hari ini", "Terlambat", "Cari judul task…", "Filter lainnya", "Tampilkan", "Reset filter", "berstatus lain disembunyikan".
- Atribut aksesibilitas ada: `aria-pressed` (tab, chip, ⭐), `aria-expanded` (kelompok, tombol Filter), `role: "dialog"`, `aria-modal`.
- `FocusTaskItem` punya `ftask-star` dan `hideProject`.
- `index.html` memuat `<script src="/static/offline/focusfilter.js">` sebelum skrip aplikasi, dan `sw.js` STATIC memuat `/static/offline/focusfilter.js`.
- CSS berisi kelas `focus-filter-*` dan media query 768 px.

### 9.3 E2E — `temporary_files/e2e_focus_filter.py` (Playwright, pola `e2e_focus_page.py`)

- Data uji: task di ≥ 2 project pribadi, 1 workspace dengan 2 project, task tanpa project, dan status campuran.
- Skenario:
  - Pixel 7 (412 px), 375 px, dan desktop 1280 px;
  - angka tab;
  - tiap chip cepat;
  - cari;
  - lembar filter (status, project, Reset, Tampilkan);
  - pil ✕;
  - catatan status tersembunyi → Tampilkan;
  - lipat kelompok;
  - semua pilihan (kecuali query) bertahan setelah reload;
  - ⭐ dari baris memindahkan task ke Target dan tidak muncul dua kali;
  - Zen + Work berjalan menyembunyikan bar filter dan kelompok;
  - badge sidebar menghitung task ber-deadline hari ini non-Q1;
  - `scrollWidth === innerWidth` pada 375 px;
  - Esc menutup lembar dan fokus kembali ke tombol;
  - tidak ada error konsol / pageerror.

### 9.4 Regresi

- `python -m pytest tests/ -q`, `npm test` (hanya `draw_local_reactive` yang diketahui boleh gagal), dan `node temporary_files/check_inline_scripts.js`.
- E2E lama `e2e_focus_page.py`, `e2e_focus_overtime.py`, dan `e2e_android_notification.py`.
- Tes lama yang mengunci teks/struktur `TodayFocusView` (`focus_zen.test.js`, `focuspage.test.js`, `focus_target_ui.test.js`) diperbarui seperlunya, tanpa melemahkan apa yang diuji.

## 10. Rilis

- Versi SW (`static/sw.js` `CACHE`, `index.html` `__SW_VERSION` + fallback Settings, `webapp.py` `sw_cache`) dan `app.css?v=` naik ke nomor kosong berikutnya di atas `main` dan PR terbuka. Nama cache `taskflow-v<N>-focus-filter`. Tes yang mengunci versi ikut diperbarui.
- `static/offline/focusfilter.js` ditambahkan ke `STATIC` di `sw.js` dan dimuat lewat `<script>` di `index.html` (setelah `tasklogic.js`).
- Deploy: file statis saja, lalu restart `taskflow-web` (`sw_cache`). Tidak ada migrasi.
- Satu PR draft: `claude/fokus-filter`.

## 11. Di luar cakupan

- Pilihan urutan lain (deadline, judul, manual/drag).
- Filter tag, context, atau penanggung jawab (`assigned_to`).
- Menyaring seksi "Berulang hari ini".
- Menyimpan kata pencarian, preset filter bernama, atau sinkronisasi filter antarperangkat (server).
- Membuat tab "Hari ini" mencakup Q1 tanpa deadline.
- Virtualisasi daftar.
- Mengubah perhitungan `is_overdue` di server atau di halaman lain selain empat pemakai cakupan di §4.1.

## 12. ADR

**ADR-027: Cakupan dan bucket waktu halaman Fokus dihitung di klien dengan tanggal lokal.**
- **Konteks:**
  - `is_overdue` dihitung server dengan `date.today()` saat task dikirim, lalu disimpan apa adanya di IndexedDB. Saat offline atau setelah tengah malam nilainya basi.
  - Tanggal server bisa berbeda dari tanggal pengguna (WIB, UTC+7).
  - Dashboard memakai tanggal UTC untuk "deadline hari ini".
  - Ada empat salinan definisi cakupan yang sudah berbeda isinya.
- **Keputusan:**
  - Satu fungsi `TF.focusfilter.inTodayScope` + `timeBucket` memakai `deadline` vs `TF.tasklogic.todayLocalISO()`.
  - Dipakai Sidebar, halaman Fokus, Dashboard, dan `getFilteredTasks("today")`.
  - `is_overdue` server tetap ada untuk pemakai lain.
- **Konsekuensi:**
  - Angka Fokus konsisten di semua tempat dan benar saat offline.
  - Halaman lain yang masih memakai `is_overdue` (badge terlambat di kartu task, halaman Overdue, Review) bisa berbeda beberapa jam di sekitar tengah malam sampai dipindahkan ke fungsi yang sama (di luar cakupan PR ini).
- Dicatat di `.agents/DECISIONS.md` bersama PR implementasi. ADR-026 sudah dipakai PR #77 (email fase 0b); bila nomor 027 terpakai lebih dulu, gunakan nomor kosong berikutnya.
