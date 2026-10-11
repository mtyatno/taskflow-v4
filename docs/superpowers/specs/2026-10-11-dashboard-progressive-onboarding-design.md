# Spesifikasi Desain: Progressive Disclosure Dashboard & Onboarding Pengguna Baru

- **Tanggal Dokumen:** 2026-10-11
- **Topik:** Pengalaman Pengguna Baru di Dashboard Alurik (Reduksi Intimidasi & Progressive Onboarding)
- **Status:** Approved by User, Ready for Implementation Planning
- **SW Cache Target:** `taskflow-v386-dashboard-progressive-onboarding`
- **Stylesheet Target:** `/static/app.css?v=322`

---

## 1. Konteks & Masalah

### 1.1. Masalah Pengalaman Pengguna Baru (Cold Start Overload)
Pada kondisi pengguna baru yang belum memiliki tugas atau riwayat aktivitas (`tasks.length === 0`), Dashboard Alurik saat ini merender seluruh modul dalam keadaan kosong melompong:
1. **5 Kartu KPI di Bagian Atas:** Menampilkan angka 0 ("0 Aktif", "0 Selesai", "0 Q1", "0 Terlambat", "0 Inbox"), grafik sparkline datar, dan perbandingan "vs 7 hari lalu" yang tidak relevan bagi akun baru.
2. **Kartu Prioritas Kosong:** Menampilkan pesan hampa *"Tidak ada prioritas untuk hari ini"*.
3. **Seksi Analitik:** Menampilkan 3 kartu grafik kosong (Tren Produktivitas berupa garis lurus di angka 0, Penyelesaian Donut 0%, dan Distribusi Status GTD kosong).
4. **Seksi Eisenhower Matrix:** Menampilkan 4 kartu kuadran bertuliskan *"Belum ada task"*.
5. **Seksi Status GTD:** Menampilkan 4 kartu status bertuliskan *"Belum ada task"*.

Total terdapat sekitar **17 kontainer kosong** yang mendominasi layar. Tampilan ini menciptakan beban kognitif tinggi (*cognitive overload*) dan terkesan sangat mengintimidasi bagi pengguna baru yang baru pertama kali login.

### 1.2. Tujuan & Sasaran Desain
1. **Zero-Intimidation Onboarding:** Menghilangkan dinding angka 0 dan kontainer kosong saat pengguna belum memiliki tugas.
2. **Progressive Disclosure:** Menampilkan komponen aplikasi secara bertahap dan relevan seiring bertambahnya interaksi dan data pengguna.
3. **Action-Oriented First Experience:** Menggantikan kekosongan dengan panduan ramah 3 langkah interaktif yang membimbing pengguna mencatat tugas dan catatan pertama mereka.
4. **Fluid Continuity:** Begitu pengguna membuat tugas pertama, dashboard langsung beralih secara reaktif ke tampilan kerja normal yang memuaskan (*instant feedback / dopamine loop*).

---

## 2. Arsitektur & Logika Kondisional Tampilan

### 2.1. Variabel State
Pada komponen `Dashboard` di `static/index.html`:
- `hasTasks = tasks.length > 0`: Menandakan apakah pengguna memiliki minimal 1 tugas aktif/tercatat.
- `hasCompletedTasks = (summary.done_last_7_days ?? 0) > 0 || tasks.some(t => t.gtd_status === "done")`: Menandakan apakah pengguna telah menyelesaikan minimal 1 tugas.
- `dismissedOnboarding`: Boolean yang dibaca dari `localStorage.getItem("tf_dismiss_onboarding") === "true"` dengan perlindungan `try...catch`.

### 2.2. Matriks Visibilitas Modul Dashboard

| Komponen | `tasks.length === 0` (User Baru) | `tasks.length > 0` (User Aktif) | Catatan Khusus |
| :--- | :--- | :--- | :--- |
| **Hero Greeting Text** | *"Selamat datang di Alurik! Mari mulai dengan mencatat tugas atau ide pertamamu."* | Sesuai jam dan ringkasan tugas harian | Ramah dan menyambut |
| **Quick Capture Input** | Tampil normal | Tampil normal | Kolom input utama di atas |
| **5 Kartu KPI (Top)** | **Disembunyikan total** | **Tampil normal** | Mencegah tampilan 5 angka nol dingin |
| **Kolom Kiri `dash-main`** | **`DashOnboardingCard`** (jika belum di-dismiss). Jika di-dismiss: Kartu prioritas kosong minimalis | **Kartu "Prioritas Hari Ini"** | Berisi tugas yang baru dibuat |
| **Kolom Kanan `dash-main`** | **Kartu "Disematkan"** | **Kartu "Disematkan"** | Menjaga keseimbangan 2 kolom |
| **Eisenhower Matrix** | **Disembunyikan total** | **Tampil normal** | Hanya relevan jika ada tugas |
| **Status GTD** | **Disembunyikan total** | **Tampil normal** | Hanya relevan jika ada tugas |
| **Seksi Analitik** | **Disembunyikan total** | **Tampil jika `hasCompletedTasks`** | Mencegah chart garis lurus 0% |
| **Notes Terbaru** | **Tampil jika `recentNotes.length > 0`** | **Tampil jika `recentNotes.length > 0`** | Catatan tidak disembunyikan |

---

## 3. Desain Komponen `DashOnboardingCard`

### 3.1. Struktur & Letak
- Menggantikan posisi kartu "Prioritas Hari Ini" di sisi kiri grid `dash-main`.
- Menggunakan styling kartu Alurik standar: `background: var(--bg-card)`, `border: 1px solid var(--border)`, `border-radius: var(--radius-lg, 16px)`.
- **Dilarang keras menggunakan border berwarna di sisi kiri (`borderLeft: none`).**

### 3.2. Header
- **Ikon:** Roket / Bintang (`🚀` atau `sparkles`).
- **Judul:** *"Mulai Langkah Pertama"*.
- **Subjudul:** *"3 langkah mudah menyiapkan alur produktivitasmu"*.
- **Badge Progres:** Pill badge di header yang menampilkan `${completedSteps} dari 3 langkah selesai`.
- **Tombol Tutup (Dismiss):** Tombol `✕` di pojok kanan atas dengan title *"Sembunyikan panduan"*. Saat diklik:
  - Menyimpan status `localStorage.setItem("tf_dismiss_onboarding", "true")`.
  - Mengubah state lokal `dismissedOnboarding` menjadi `true`.

### 3.3. Tiga Langkah Checklist Interaktif
1. **Langkah 1: Tulis tugas pertamamu**
   - **Indikator:** Lingkaran ikon (centang hijau jika selesai, lingkaran nomor jika belum).
   - **Deskripsi:** *"Ketik rencana atau tugas di kolom atas lalu tekan Enter, atau klik tombol di samping."*
   - **Tombol Aksi (CTA):** Tombol `✍️ Buat Tugas` yang memfokuskan input quick capture atas atau memicu dialog tambah tugas.
   - **Otomatis Selesai:** Tercentang saat `tasks.length > 0`.
2. **Langkah 2: Buat atau buka catatan pertamamu**
   - **Indikator:** Tercentang otomatis jika `notes.length > 0`.
   - **Deskripsi:** *"Tulis ide, referensi penting, atau catatan harian di tab Notes."*
   - **Tombol Aksi (CTA):** Tombol `📝 Buka Notes` yang menavigasi ke halaman catatan (`onNav("notes")`).
   - **Otomatis Selesai:** Tercentang saat `notes.length > 0`.
3. **Langkah 3: Selesaikan tugas pertamamu**
   - **Indikator:** Tercentang saat `hasCompletedTasks`.
   - **Deskripsi:** *"Centang tugas yang sudah selesai untuk mulai mengisi grafik performa harianmu."*
   - **Status:** Menunggu tugas dibuat dan ditandai selesai.

---

## 4. Perubahan Berkas & Rencana Implementasi

### 4.1. Berkas Frontend
1. **`static/index.html`**:
   - Logika greeting dinamis saat `tasks.length === 0`.
   - Guard rendering `dash-kpis` (`hasTasks && ...`).
   - Penambahan komponen `DashOnboardingCard` pada kolom kiri `dash-main` saat `!hasTasks && !dismissedOnboarding`.
   - Guard rendering `eisenhower-grid` & header seksi (`hasTasks && ...`).
   - Guard rendering `gtd-grid` & header seksi (`hasTasks && ...`).
   - Guard rendering `charts-grid` Analitik & header seksi (`hasCompletedTasks && ...`).
   - Bump versi stylesheet: `/static/app.css?v=322`.
   - Bump versi SW fallback: `taskflow-v386-dashboard-progressive-onboarding`.
2. **`static/app.css`**:
   - Class styling baru:
     - `.dash-onboarding-card`
     - `.onboarding-head`, `.onboarding-title`, `.onboarding-sub`
     - `.onboarding-steps`
     - `.onboarding-step-item`
     - `.onboarding-step-icon` (lingkaran nomor / centang hijau)
     - `.onboarding-step-content`
     - `.onboarding-step-btn` (CTA button secondary bersih)
     - `.onboarding-dismiss-btn`
   - Memastikan tidak ada properti `border-left` berwarna pada kartu onboarding.
3. **`static/sw.js` & `webapp.py`**:
   - Bump cache Service Worker ke `taskflow-v386-dashboard-progressive-onboarding`.

### 4.2. Pengujian & Verifikasi
1. **Unit Test Backend:**
   - `tests/test_version.py`: Memperbarui asersi versi cache ke `v386`.
2. **Unit Test Frontend Offline:**
   - `tests/offline/note_toc.test.js`: Memperbarui asersi stylesheet ke `app.css?v=322`.
   - Unit test offline baru: `tests/offline/dashboard_onboarding.test.js`:
     - Memverifikasi saat `tasks.length === 0`: KPI disembunyikan, Analitik disembunyikan, Eisenhower & GTD disembunyikan, Onboarding card ditampilkan.
     - Memverifikasi saat `tasks.length > 0`: KPI ditampilkan, Eisenhower & GTD ditampilkan, kartu Onboarding beralih ke Prioritas Hari Ini.
     - Memverifikasi saat `hasCompletedTasks`: Analitik ditampilkan.
     - Memverifikasi `localStorage` flag `tf_dismiss_onboarding`.
3. **Sinkronisasi SW:**
   - Menyinkronkan seluruh 8 file test offline ke versi cache `v386`.
4. **Verifikasi Sintaks:**
   - `node --check static/sw.js`
   - `node temporary_files/check_inline_scripts.js static/index.html`
   - `node --test tests/offline/*.test.js`
   - `venv/bin/python -m pytest tests/test_version.py`
