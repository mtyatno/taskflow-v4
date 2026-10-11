# Dashboard Full-Width Fluid (Layar Lebar) Design Spec

## 1. Problem & Context
Pada layar laptop/monitor lebar (misal 1920x1080 atau lebih besar dari 1320px), halaman Dashboard Alurik menampilkan area kosong yang luas di sisi kanan (~540px).
Penyebabnya adalah aturan CSS pada kelas `.dash` di `static/app.css`:
```css
.dash { ... max-width: 1320px; }
```
Kontainer induk `.main-content` mengisi seluruh lebar viewport, sedangkan `.dash` tertahan di `1320px` tanpa pemusatan horizontal, sehingga elemen dashboard terhenti di 1320px dan menyisakan ruang kosong besar di sebelah kanan.

## 2. Solution: Full-Width Fluid (100% Responsif)
Sesuai kesepakatan brainstorming dengan pengguna:
- `.dash` diatur menjadi `width: 100%; max-width: 100%;` (atau `max-width: none; width: 100%;`).
- Grid anak di dalam dashboard sudah menggunakan unit fraksional responsif:
  - Hero banner: meregang horizontal secara alami dengan background radial-gradient.
  - KPI Cards (`.dash-kpis`): `grid-template-columns: repeat(5, minmax(0, 1fr));` meregang secara seimbang.
  - Prioritas & Disematkan (`.dash-main`): `grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);` proporsional.
  - Charts (`.dash-charts`): `grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr);` proporsional.
  - Projects (`.dash-projects`): `grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));` otomatis mengisi kolom ekstra di layar lebar jika ruang mencukupi.
  - Catatan Terbaru (`.dash-notes`): `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));` otomatis mengisi kolom ekstra.
  - Eisenhower 4-Kuadran (`.dash-grid-2`): `repeat(2, minmax(0, 1fr))` meregang proporsional.

## 3. Cache Invalidation & Synchronizations
Untuk memastikan browser dan PWA pengguna langsung mendapatkan stylesheet terbaru tanpa stale cache:
1. `static/app.css`:
   - Ubah `max-width: 1320px;` pada `.dash` menjadi `width: 100%; max-width: 100%;`.
2. `static/index.html`:
   - Bump query string stylesheet: `<link rel="stylesheet" href="/static/app.css?v=320">`.
   - Update `window.__SW_VERSION = "taskflow-v384-dashboard-full-width-fluid"`.
   - Update fallback di kartu versi Pengaturan: `"taskflow-v384-dashboard-full-width-fluid"`.
3. `webapp.py`:
   - Update endpoint `GET /api/version` dengan `sw_cache = "taskflow-v384-dashboard-full-width-fluid"`.
4. `static/sw.js`:
   - Bump cache version ke `const CACHE = "taskflow-v384-dashboard-full-width-fluid";`.
5. Tests:
   - Update unit test backend `tests/test_version.py`.
   - Update 8 file test offline (`tests/offline/`) yang menguji asersi Service Worker cache version dan stylesheet query `v=320`.
   - Tambahkan unit test offline yang memvalidasi bahwa `.dash` memiliki aturan fluid (`width: 100%` dan `max-width: 100%` atau tanpa batas kaku 1320px).

## 4. Verification Criteria
- `node scratch/check_inline.js static/index.html` (atau skrip inline validator): OK.
- `node --check static/sw.js`: OK.
- `node --test tests/offline/*.test.js`: Seluruh tes offline lulus 100%.
- `venv/bin/python -m pytest tests/test_version.py`: Lulus 100%.
- `venv/bin/python -m pytest tests/`: Backend test suite lulus.
