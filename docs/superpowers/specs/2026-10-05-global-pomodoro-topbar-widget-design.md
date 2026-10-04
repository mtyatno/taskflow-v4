# Rancangan Desain: Global Pomodoro Persistence & Top Bar Mini Pomodoro Widget

**Tanggal:** 2026-10-05  
**Status:** Disetujui (Approved)  
**Lingkup:** Frontend / UI (`static/index.html`, `static/app.css`, `static/sw.js`, `tests/offline/focus_workstation.test.js`)

---

## 1. Latar Belakang & Masalah
Sebelumnya, hook `usePomodoro` dan state `focusTask` dideklarasikan di dalam komponen `TodayFocusView`. Akibatnya, saat pengguna berpindah ke halaman lain (seperti *Dashboard*, *Notes*, *Kalender*, *Inbox*, dll.), komponen `TodayFocusView` ter-unmount, menyebabkan timer Pomodoro otomatis berhenti, interval dibersihkan, dan pengguna harus memulai dari awal ketika kembali ke halaman Fokus Hari Ini.

Tujuan dari peningkatan ini:
1. Memastikan Pomodoro **tetap berjalan terus di latar belakang** ketika pengguna berpindah ke halaman mana pun di dalam aplikasi.
2. Menampilkan **widget mini Pomodoro di top bar** (*desktop* dan *mobile*) saat pengguna berada di halaman selain Fokus Hari Ini, sehingga sisa waktu dan task aktif selalu terlihat dan dapat dijeda/dilanjutkan secara instan.
3. Menyimpan snapshot waktu berbasis timestamp ke `localStorage` sehingga jika halaman di-refresh atau tab browser ditutup sesaat, timer tetap akurat.

---

## 2. Kebutuhan & Keputusan Desain

### 2.1 Pengangkatan State ke Tingkat `App`
- Di dalam komponen `App` pada `static/index.html`:
  - Deklarasikan state `focusTaskId` dan `taskPomodoros`.
  - Turunkan `focusTask = tasks.find(t => t.id === focusTaskId) || null`.
  - Instansiasi hook `timer = usePomodoro({ focusTask, setTaskPomodoros })` di level `App`.
  - Teruskan `timer`, `focusTask`, `setFocusTask: (t) => setFocusTaskId(t ? t.id : null)`, dan `taskPomodoros` sebagai props ke `TodayFocusView`.
- Di `TodayFocusView`:
  - Gunakan `props.timer`, `props.focusTask`, dan `props.setFocusTask` daripada mendeklarasikan state internal sendiri.
  - Alur pengurutan `sortedTasks` dan penghentian otomatis saat task selesai (`handleTaskDone`) tetap berjalan selaras dengan state global tersebut.

### 2.2 Akurasi Waktu & Persistensi `localStorage`
- Pada hook `usePomodoro`:
  - Kunci penyimpanan: `tf_pomo_state`.
  - Simpan snapshot: `{ mode, timeLeft, isRunning, targetEndTime, focusTaskId, sessionCount, totalFocusTime, date }`.
  - Saat `start()` dipanggil:
    - `targetEndTime = Date.now() + timeLeft * 1000`.
  - Pada efek interval timer:
    - Selaraskan `timeLeft` dengan `Math.max(0, Math.round((targetEndTime - Date.now()) / 1000))` untuk menghindari drift akibat background throttling browser.
  - Pada inisialisasi awal hook:
    - Muat data dari `localStorage`. Jika sesi tersimpan berasal dari tanggal hari ini (`date === todayStr`) dan `isRunning === true`:
      - Hitung sisa waktu berdasarkan `targetEndTime - Date.now()`.
      - Jika sisa waktu > 0, lanjutkan timer. Jika <= 0, selesaikan sesi Pomodoro.

### 2.3 Komponen Mini Widget Top Bar (`TopBarPomodoroChip`)
- **Render Kondisional:**
  - Dirender pada `desktop-topbar` dan `mobile-topbar` hanya ketika:
    `page !== "today" && focusTask != null`
- **Tampilan & Komponen:**
  - Container `.topbar-pomo-chip`:
    - Menggunakan badge/chip berlatar `var(--bg-card)`, border `1px solid var(--border)`, radius pill (20px), padding kompak (4px 10px).
    - Elemen waktu: teks format `mm:ss` yang berdetik secara real-time.
    - Elemen task: judul task dengan `text-overflow: ellipsis` agar tidak merusak layout top bar di layar sempit.
    - Tombol Play/Pause: ikon 14px untuk kontrol instan (`timer.start()` / `timer.pause()`).
    - Event klik pada area teks/chip (selain tombol): memanggil `setPage("today")` untuk langsung membawa pengguna kembali ke halaman *Fokus Hari Ini*.

---

## 3. Komponen & Aliran Data
1. `App`:
   - Mengelola `focusTaskId` dan `usePomodoro`.
   - Merender `TopBarPomodoroChip` di topbar jika `page !== "today"` dan ada task fokus.
   - Mengoper props timer dan task ke `TodayFocusView`.
2. `TopBarPomodoroChip`:
   - Menampilkan sisa waktu `timer.timeDisplay`, status `timer.isRunning`, dan `focusTask.title`.
   - Menyediakan tombol cepat Play/Pause dan navigasi `onNavigateToday`.
3. `TodayFocusView`:
   - Menerima `timer` dan `focusTask` dari `App`.
   - Mengatur tampilan workstation kartu penuh dan bar ringkas sticky seperti biasa.

---

## 4. Pengujian & Verifikasi
1. **Unit Test di `tests/offline/focus_workstation.test.js`:**
   - Memastikan `App` menginstansiasi `usePomodoro` dan meneruskannya ke `TodayFocusView`.
   - Memastikan `TopBarPomodoroChip` dirender di `desktop-topbar` dan `mobile-topbar` saat `page !== "today"`.
   - Memastikan fungsi klik pada chip memicu navigasi ke halaman `today`.
2. **Regression Check:**
   - Semua tes offline lama (`node --test tests/offline/*.test.js`) tetap lulus.
   - Syntax inline script (`node scratch/check_inline.js static/index.html`) tetap 5/5 OK.
   - Service worker syntax check (`node --check static/sw.js`) OK.
   - Python backend suite (`python -m pytest tests/`) tetap 122/122 lulus.
