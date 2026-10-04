# Rancangan Desain: Syarat Task Aktif Pomodoro & Task Terfokus di Puncak Tasklist

**Tanggal:** 2026-10-04  
**Status:** Disetujui (Approved)  
**Lingkup:** Frontend / UI (`static/index.html`, `static/app.css` jika perlu, `tests/offline/focus_workstation.test.js`)

---

## 1. Latar Belakang & Masalah
Di halaman **Fokus Hari Ini** (`TodayFocusView`), timer Pomodoro saat ini dapat dijalankan secara bebas tanpa mengharuskan pengguna memilih satu task untuk difokuskan. Selain itu, ketika pengguna memilih sebuah task untuk difokuskan (mengklik tombol "Fokus"), task tersebut tetap berada di posisi aslinya di daftar task (berdasarkan status overdue dan prioritas P1..P4), sehingga tidak langsung terlihat di posisi paling atas task list.

Tujuan dari perubahan ini:
1. Memastikan pengguna benar-benar fokus pada satu task saat timer berjalan: Pomodoro **tidak bisa dimulai** kecuali ada satu task yang sedang dalam keadaan aktif/fokus. Jika user mencoba memulai tanpa task, tampilkan notifikasi toast informatif.
2. Ketika sebuah task difokuskan, posisinya otomatis dipindahkan ke sisi **paling atas (#1)** di task list hari ini.
3. Menjaga alur kerja yang intuitif: jika task yang sedang difokuskan diselesaikan (`onDone`) atau dibatalkan fokusnya, timer Pomodoro otomatis dijeda (`pause`) dan pengguna diberi notifikasi.

---

## 2. Kebutuhan & Keputusan Desain

### 2.1 Validasi Pomodoro Timer (`usePomodoro`)
- **Fungsi `start()` pada hook `usePomodoro`:**
  - Menerima konteks `focusTask`.
  - Jika `focusTask` tidak ada / bernilai `null`/`undefined`:
    - Timer **tidak dimulai** (`isRunning` tetap `false`).
    - Menampilkan toast peringatan:
      ```javascript
      window.__showToast?.("Pilih satu task terlebih dahulu untuk memulai Pomodoro!", "warning");
      ```
    - Mengembalikan `false` sebagai sinyal bahwa timer gagal dimulai.
  - Jika `focusTask` ada:
    - Timer berjalan seperti biasa (`setIsRunning(true)`).
    - Mengembalikan `true`.
- **Cakupan Mode:**
  - Aturan ini berlaku untuk semua mode Pomodoro (`work`, `shortBreak`, `longBreak`). Pengguna wajib memiliki task aktif yang sedang dikerjakan/diistirahatkan.

### 2.2 Penanganan Saat Task Dibatalkan atau Ditandai Selesai
- **Batal Fokus (`handleStartFocus`):**
  - Ketika user mengklik tombol task yang sedang aktif untuk membatalkan fokus (`focusTask?.id === task.id`):
    - Set state `focusTask` menjadi `null`.
    - Jika timer sedang berjalan (`timer.isRunning`), panggil `timer.pause()` dan tampilkan toast:
      ```javascript
      window.__showToast?.("Fokus dilepas. Pomodoro dijeda.", "info");
      ```
- **Task Ditandai Selesai (`onDone`):**
  - Ketika fungsi `handleDone` / `onDone` dipanggil untuk task yang id-nya sama dengan `focusTask?.id`:
    - Jalankan aksi `onDone(taskId)` seperti biasa.
    - Set `focusTask` menjadi `null`.
    - Jika timer sedang berjalan (`timer.isRunning`), panggil `timer.pause()` dan tampilkan toast:
      ```javascript
      window.__showToast?.("Task selesai! Pomodoro dijeda.", "info");
      ```

### 2.3 Pengurutan Task List (Pin ke Atas)
- Pada komponen `TodayFocusView`, fungsi sorting untuk `sortedTasks` diperbarui:
  ```javascript
  const sortedTasks = [...todayTasks].sort((a, b) => {
    // 1. Task yang sedang fokus diposisikan di paling atas
    if (focusTask) {
      if (a.id === focusTask.id) return -1;
      if (b.id === focusTask.id) return 1;
    }
    // 2. Task overdue
    if (a.is_overdue && !b.is_overdue) return -1;
    if (!a.is_overdue && b.is_overdue) return 1;
    // 3. Urutan prioritas P1 -> P4
    const priOrder = { P1: 1, P2: 2, P3: 3, P4: 4 };
    return priOrder[a.priority] - priOrder[b.priority];
  });
  ```
- Efek langsung:
  - Begitu user mengklik **Fokus**, task tersebut meloncat ke indeks 0 di task list.
  - Begitu fokus dilepas atau task selesai, task tersebut kembali ke posisi alami sesuai prioritas / overdue.

---

## 3. Komponen & Aliran Data
1. `TodayFocusView`:
   - Mengelola state `focusTask`.
   - Mengoper `focusTask` ke `usePomodoro({ focusTask, setTaskPomodoros })`.
   - Melewatkan `handleDoneWithFocus` (atau membungkus `onDone`) ke `FocusTaskItem`.
   - Mengurutkan `sortedTasks` dengan memprioritaskan `focusTask.id`.
2. `usePomodoro`:
   - Memvalidasi keberadaan `focusTask` di dalam fungsi `start()`.
   - Menghubungkan notifikasi peringatan jika timer dicoba mulai tanpa `focusTask`.
3. `PomodoroTimer` & `PomodoroMiniBar`:
   - Tetap memanggil `timer.start()`. Karena validasi berada di dalam `usePomodoro`, kedua kontrol secara konsisten terlindungi tanpa duplikasi kode.

---

## 4. Error Handling & Edge Cases
1. **Toast Notification Fallback:**
   - Gunakan optional chaining `window.__showToast?.(...)` untuk memastikan tidak terjadi error jika helper toast belum siap di lingkungan pengujian.
2. **Task dihapus / selesai dari luar (misal sinkronisasi atau shortcut):**
   - Jika list `tasks` diperbarui dan `focusTask` tidak lagi ditemukan di dalam list task aktif, `focusTask` otomatis dinetralkan dan timer di-pause jika berjalan.
3. **Kondisi Offline:**
   - Semua operasi ini adalah state UI lokal dan offline-first (tidak membutuhkan round-trip jaringan).

---

## 5. Rencana Pengujian
1. **Unit Test di `tests/offline/focus_workstation.test.js`:**
   - Uji guard `timer.start()`:
     - Ketika `focusTask` bernilai `null`, `timer.start()` mengembalikan false, `isRunning` tetap false, dan memicu toast.
     - Ketika `focusTask` terdefinisi, `timer.start()` berhasil menyalakan timer (`isRunning` true).
   - Uji pengurutan `sortedTasks`:
     - Ketika ada `focusTask`, task tersebut berada di index 0 meskipun ada task lain yang `is_overdue` atau memiliki prioritas lebih tinggi (`P1`).
     - Ketika `focusTask` bernilai `null`, urutan kembali ke overdue dan urutan prioritas standar.
   - Uji jeda otomatis:
     - Batal fokus atau menyelesaikan task yang sedang fokus memicu `timer.pause()`.
2. **Suite Regression Test:**
   - Jalankan `node --test tests/offline/focus_workstation.test.js`.
   - Jalankan seluruh suite `node --test tests/offline/*.test.js`.
   - Jalankan `node scratch/check_inline.js static/index.html`.
   - Jalankan `python -m pytest tests/`.
