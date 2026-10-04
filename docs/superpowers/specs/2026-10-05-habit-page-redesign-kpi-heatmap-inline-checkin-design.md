# Design Spec: Redesain Halaman Habits (KPI Cards, 1-Row Heatmap, 2-Row Mini Heatmap, Inline Checkin)

- **Tanggal:** 2026-10-05
- **Author:** Antigravity (Gemini)
- **Status:** Approved by User

---

## 1. Latar Belakang & Masalah
Halaman Habits saat ini memiliki sejumlah kelemahan visual dan interaksi:
1. **Heatmap Kalender terisolasi di baris tersendiri:** Menempati satu lebar penuh kartu dengan grid 35 sel yang kecil di tengah, menyisakan ruang kosong besar yang janggal di sisi kiri dan kanan.
2. **Kartu KPI belum selaras dengan Dashboard:** Masih berupa kartu sederhana dengan emoji teks (`⚡`, `✓`, `🔥`, `📊`), belum memiliki tile icon gradien, delta trend vs minggu lalu, maupun slot visual mini-chart (sparkline/bars/meter).
3. **Check-in memunculkan modal popup:** Mengklik tombol `+` di kartu habit membuka `HabitCheckinModal` yang menginterupsi alur pengguna, padahal seharusnya cukup 1-klik inline.
4. **Mini heatmap per habit hanya 1 baris panjang & kontras rendah:** Menampilkan 30 kotak dalam satu deret horizontal panjang tipis. Kotak yang belum tercatat (unchecked) atau dilewati (skipped) hampir tidak terlihat baik di light mode maupun dark mode.
5. **Identity pillar quote banner mengganggu:** Elemen `💫 "Saya adalah orang yang peduli dengan kesehatan"` di bagian atas terasa tidak diperlukan dan membuat tampilan berantakan.

---

## 2. Tujuan Redesain
1. **1-Row Hero Layout:** Menyatukan 4 Kartu KPI dan 1 Kartu Heatmap Kalender ke dalam 1 baris grid yang proporsional.
2. **Dashboard-Style KPI Cards:** Menerapkan bahasa desain Dashboard pada kartu KPI Habits (tile icon gradien 40px, angka 30px, pill delta vs minggu lalu, dan visual slot mini 32px).
3. **Direct Inline Check-in:** Check-in hari ini langsung terjadi saat tombol diklik tanpa modal popup, dengan siklus: `[+]` ➔ `[✓ Selesai]` ➔ `[− Di-skip]` ➔ `[+ Kosong/Batal]`.
4. **2-Row Mini Heatmap dengan Kontras Tinggi:** Mini heatmap tiap habit diubah menjadi 2 baris × 15 kolom, dengan warna dan border tegas untuk kotak unchecked, warna amber/kuning untuk skipped, dan hijau untuk done.
5. **Hapus Banner Identity Quote:** Menghilangkan banner identity quote dari header halaman Habits.

---

## 3. Komponen & Detail Arsitektur

### A. Layout Hero (KPI + Heatmap 1 Baris)
- **Container (`.habit-kpi-row`):**
  - Desktop (≥1024px): `display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)) minmax(210px, 1.2fr); gap: 12px; margin-bottom: 20px; align-items: stretch;`
  - Tablet (768px – 1023px): `grid-template-columns: repeat(2, 1fr);` dengan kartu Heatmap merentang 2 kolom.
  - Mobile (≤767px): `grid-template-columns: repeat(2, 1fr);` dengan Heatmap merentang 2 kolom.

### B. 4 Kartu KPI Bergaya Dashboard
1. **Kebiasaan Aktif:**
   - Ikon: `activity` / `zap` (Gradien `#C5DD34` ➔ `#8FAA00`, shadow lime)
   - Value: `stats.totalActive`
   - Delta & Sub: `DashDelta` (Stabil / delta vs 7 hari lalu) + `"kebiasaan aktif"`
   - Viz: `DashSparkline` 14 hari tren konsistensi
2. **Penyelesaian Minggu Ini:**
   - Ikon: `check` (Gradien `#4ade80` ➔ `#16a34a`, shadow green)
   - Value: `${stats.completionRate}%`
   - Delta & Sub: `DashDelta` (delta completion vs minggu lalu) + `"vs minggu lalu"`
   - Viz: `DashMiniBars` 7 hari penyelesaian minggu ini
3. **Rekor Beruntun (Best Streak):**
   - Ikon: `flame` (Gradien `#fb923c` ➔ `#ef4444`, shadow red/orange)
   - Value: `${stats.bestStreak}`
   - Delta & Sub: `"hari beruntun"` / `"tertinggi"`
   - Viz: `DashMeter` capaian target streak
4. **Check-in Minggu Ini:**
   - Ikon: `calendar` (Gradien `#60a5fa` ➔ `#2563eb`, shadow blue)
   - Value: `${stats.weekDone}/${stats.weekTotal}`
   - Delta & Sub: `${Math.round(weekDone/weekTotal * 100)}% tercapai`
   - Viz: `DashMeter` porsi log selesai dari total target mingguan

### C. Kartu Heatmap Kalender (Kartu ke-5 di Baris Hero)
- Kartu memiliki padding dan border radius yang identik dengan kartu KPI (`.dash-kpi`).
- Header: Mini flex header dengan icon `calendar`, label `"Aktivitas 35 Hari"`, dan sub-info rata-rata per hari.
- Grid: 35 sel (5 baris × 7 kolom, Senin–Minggu) dengan label hari `S M T W T F S` di atasnya.
- Sel hari ini ditandai dengan outline border aksen tebal.
- Tooltip hover menampilkan: `"Hari, Tanggal Bulan: X/Y habits"`.

### D. Mini Heatmap Per Habit (2 Baris)
- Komponen `MiniHeatmap`:
  - Mengubah wadah menjadi grid 2 baris × 15 kolom:
    `display: grid; grid-template-rows: repeat(2, 10px); grid-template-columns: repeat(15, 10px); gap: 3px;`
  - Baris 1: 15 hari pertama (hari ke -29 s/d -15).
  - Baris 2: 15 hari terakhir (hari ke -14 s/d hari ini, sel terakhir adalah hari ini).
- Styling Sel:
  - **Unchecked / Missed (`.habit-mini-cell.is-empty`):**
    - Light mode: `background: rgba(0, 0, 0, 0.04); border: 1px solid rgba(0, 0, 0, 0.12);`
    - Dark mode: `background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.18);`
  - **Skipped (`.habit-mini-cell.is-skipped`):**
    - `background: #f59e0b; border: 1px solid #d97706;` (warna amber tegas terlihat di light & dark).
  - **Done (`.habit-mini-cell.level-4`):**
    - `background: var(--accent); border: 1px solid var(--accent);`
  - **Today Cell:**
    - Tambahan ring border aksen `box-shadow: 0 0 0 1px #818cf8;` agar hari ini langsung terlacak.

### E. Inline Direct Check-in (Tanpa Popup Modal)
- Tombol `.habit-check-btn` di kartu habit di klik langsung menjalankan aksi rotasi status:
  - Jika saat ini `null` / belum check-in: Panggil `handleCheckin(h.id, "done")` ➔ tombol berubah hijau `✓`, toast `"✅ Habit selesai!"`.
  - Jika saat ini `"done"`: Panggil `handleCheckin(h.id, "skipped", "")` ➔ tombol berubah kuning `−`, toast `"⏭️ Habit di-skip"`.
  - Jika saat ini `"skipped"`: Panggil `handleCheckin(h.id, "uncheck", "")` ➔ hapus check-in hari ini, tombol kembali `+`, toast `"↩️ Check-in dibatalkan"`.
- Backend & Local Offline Support untuk Uncheck:
  - Pada `webapp.py` (`POST /api/habits/{id}/checkin`): Jika `req.status` bernilai `"uncheck"` (atau string selain done/skipped seperti `"uncheck"`), lakukan `DELETE FROM habit_logs WHERE habit_id = ? AND date = ?`.
  - Pada `static/offline/habitrepo.js`: Menambahkan dukungan `status === "uncheck"` untuk menghapus log dari store `habit_logs` IndexedDB dan mencatat op sync jika offline.
  - Update optimistik pada state `habits` di `HabitPage`: Mengembalikan `today_status = null` dan membersihkan entri di `week_log` dan `month_log`.

### F. Pembersihan Identity Quote Banner
- Hapus blok elemen HTML quote banner dan kalkulasi `quoteHabit` / `quote` dari `HabitPage`.

---

## 4. Backward Compatibility & Non-Breaking Guarantee
- Modal edit (`HabitEditModal`) tetap ada dan dapat diakses melalui menu titik tiga (⋮).
- Modal tag (`habitTagModal`) tetap berfungsi seperti biasa.
- Tidak ada perubahan skema tabel SQLite (tetap memanfaatkan tabel `habits` dan `habit_logs`).
- Offline-first tetap terjamin melalui penanganan IndexedDB di `habitrepo.js` dan sinkronisasi `syncpush.js`.

---

## 5. Rencana Verifikasi
1. **Uji Sintaks Inline & SW:**
   - `node scratch/check_inline.js static/index.html` (5/5 scripts OK)
   - `node --check static/sw.js` (OK)
2. **Uji Otomatis Offline & Backend:**
   - `python -m pytest tests/`
   - `node --test tests/offline/habitlogic.test.js`
   - Tambahkan unit test baru di `tests/offline/` untuk rotasi inline checkin (done ➔ skipped ➔ uncheck) dan format 2-baris mini heatmap.
3. **Verifikasi Visual:**
   - Baris Hero sejajar (4 KPI + 1 Heatmap) di desktop.
   - Mini heatmap 2 baris 15 kolom dengan kotak unchecked berbingkai tegas dan kotak skipped kuning kontras di light & dark mode.
   - Klik inline checkin langsung berganti status tanpa popup.
