# Design Spec: Habit Modal Progressive Disclosure

- **Date:** 2026-10-02
- **Status:** Proposed
- **Target Components:** `TaskFormModal` (tab `mode === "habit"`) in `static/index.html`, `static/app.css`, `static/sw.js`
- **Tests:** `tests/offline/habit_modal_progressive_disclosure.test.js`

---

## 1. Problem Statement & Motivation

Saat ini, ketika pengguna ingin menambahkan kebiasaan baru melalui modal pembuatan (tab **Habit** pada `TaskFormModal`), seluruh form konfigurasi ditampilkan sekaligus secara vertikal:
1. Nama Habit
2. Fase Waktu (Pagi / Siang / Malam)
3. Micro Target (opsional)
4. Frekuensi (Pilih/Hapus Semua + 7 tombol hari: Sen, Sel, Rab, Kam, Jum, Sab, Min)
5. Identity Pillar (opsional)

Bagi pengguna baru atau pengguna yang ingin membangun kebiasaan secara cepat (*Frictionless Capture*), melihat begitu banyak opsi secara bersamaan menimbulkan beban kognitif (*cognitive overload*). Pengguna sering kali hanya ingin mencatat kebiasaan sederhana (misal: "Meditasi pagi" atau "Minum air 2L") yang secara alami dilakukan setiap hari, tanpa harus memikirkan target mikro dan identity pillar di langkah awal.

---

## 2. Goals & Non-Goals

### Goals
1. **Low-Friction Habit Capture:** Menampilkan tampilan awal yang bersih, ringkas, dan fokus hanya pada esensi kebiasaan: **Nama Habit** dan **Fase Waktu**.
2. **Sensible Defaults:** Frekuensi kebiasaan baru secara default aktif setiap hari (7 hari: Senin–Minggu), sehingga pengguna tidak perlu menekan 7 tombol hari secara manual.
3. **Collapsible Advanced Options:** Menyembunyikan pengaturan sekunder (Micro Target, pilihan hari khusus, dan Identity Pillar) di dalam accordion yang elegan dengan badge indikator jika ada opsi yang terisi.
4. **Preserve Full Edit Mode:** Modal edit kebiasaan eksisting (`HabitEditModal`) tetap terbuka penuh secara default agar detail kebiasaan dapat ditinjau dan disunting tanpa klik ekstra.
5. **100% Backward Compatibility:** Mempertahankan seluruh skema data payload `POST /api/habits`, handling sinkronisasi offline (`OfflineDB.queueAdd`), autocomplete `#tag`, dan submit instan via keyboard.

### Non-Goals
- Tidak mengubah skema tabel database SQLite (`habits`).
- Tidak mengubah endpoint API backend FastAPI (`/api/habits`).
- Tidak mengubah logika penghitungan check-in harian atau streak progress mingguan.

---

## 3. UI/UX Architecture & Progressive Disclosure Design

### 3.1. Primary View (Selalu Tampil)
1. **Nama Habit \***:
   - Input judul habit dengan auto-focus.
   - Autocomplete `#tag` tetap aktif.
2. **Baris Ringkas (Quick Attributes):**
   - **Fase Waktu**: Selector Fase (☀️ Pagi 04:00–09:00, 🌤️ Siang 09:00–17:00, 🌙 Malam 17:00–22:00).
   - Tampilan ringkas status frekuensi (default: *"Setiap Hari (Sen–Min)"*).

### 3.2. Accordion Toggle & Dynamic Badge
1. **Tombol Toggle (`.task-advanced-toggle`):**
   - Saat tertutup: `▸ Opsi Lanjutan (Micro Target, Hari Khusus, Identity Pillar)`.
   - Saat terbuka: `▾ Sembunyikan Opsi Lanjutan`.
2. **Badge Opsi Terisi (`habitAdvancedFilledCount`):**
   - Menghitung otomatis jika:
     - `micro_target.trim().length > 0` (+1)
     - `frequency.length !== 7` (pengguna memilih hari khusus, bukan setiap hari) (+1)
     - `identity_pillar.trim().length > 0` (+1)
   - Jika tertutup dan count > 0, tampil badge hijau halus: `(N diisi)`.

### 3.3. Collapsible Advanced Section
Hanya dirender / ditampilkan ketika `showHabitAdvanced` bernilai `true`:
1. **Micro Target (opsional):** Placeholder: *"5 menit, 2 halaman, 10 push-up..."*.
2. **Frekuensi Hari Khusus:**
   - Tombol toggle cepat *"Pilih Semua"* / *"Hapus Semua"*.
   - 7 tombol hari interaktif (Sen, Sel, Rab, Kam, Jum, Sab, Min).
3. **Identity Pillar (opsional):** Placeholder: *"Saya adalah orang yang..."*.

### 3.4. Edit Modal (`HabitEditModal`)
- Tetap menampilkan seluruh kolom input secara terbuka penuh (`isEdit` behavior), konsisten dengan prinsip yang diterapkan pada modal tugas.

---

## 4. Technical Specifications

### 4.1. State Management di `TaskFormModal`
```javascript
const [showHabitAdvanced, setShowHabitAdvanced] = useState(false);

const habitAdvancedFilledCount = useMemo(() => {
  let count = 0;
  if (habitForm.micro_target && habitForm.micro_target.trim()) count++;
  if (Array.isArray(habitForm.frequency) && habitForm.frequency.length > 0 && habitForm.frequency.length !== DAYS.length) count++;
  if (habitForm.identity_pillar && habitForm.identity_pillar.trim()) count++;
  return count;
}, [habitForm.micro_target, habitForm.frequency, habitForm.identity_pillar, DAYS.length]);
```

### 4.2. Reset State Saat Modal Ditutup
- Saat modal dibuka atau reset, `showHabitAdvanced` kembali ke `false`.

---

## 5. Verification Plan

1. **Unit Test Suite (`tests/offline/habit_modal_progressive_disclosure.test.js`):**
   - Test 1: Verifikasi state `showHabitAdvanced` dan komputasi `habitAdvancedFilledCount` pada `TaskFormModal`.
   - Test 2: Verifikasi tampilan utama hanya menampilkan Nama Habit dan Fase ketika `!showHabitAdvanced`.
   - Test 3: Verifikasi tombol toggle accordion merender label dan badge dinamis yang sesuai.
   - Test 4: Verifikasi Micro Target, Frekuensi hari, dan Identity Pillar berada di dalam kontainer lanjutan.
   - Test 5: Verifikasi `HabitEditModal` tetap mempertahankan seluruh field secara terbuka penuh.
2. **Syntax Verification:**
   - `node scratch/check_inline.js static/index.html` (5/5 scripts OK).
   - `node --check static/sw.js` (OK).
3. **Regression Tests:**
   - `node --test tests/offline/*.test.js` (seluruh suite JS lulus).
   - `python -m pytest tests/` (seluruh suite pytest lulus).
4. **Deployment & Live Verification:**
   - Push ke `main` dan monitor GitHub Actions hingga selesai.
   - Verifikasi cache Service Worker baru aktif di server produksi VPS.
