# Dashboard Full-Width Fluid (Layar Lebar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menjadikan tata letak Dashboard Alurik 100% responsif/fluid di layar monitor/laptop lebar tanpa ruang kosong 540px di sisi kanan, serta memperbarui versi cache Service Worker & stylesheet agar langsung aktif di sisi klien.

**Architecture:**
1. Mengubah deklarasi CSS `.dash` di `static/app.css` dari `max-width: 1320px;` menjadi `width: 100%; max-width: 100%;`.
2. Memperbarui versi stylesheet di `static/index.html` ke `app.css?v=320` dan versi SW di script inisialisasi ke `taskflow-v384-dashboard-full-width-fluid`.
3. Memperbarui `webapp.py` pada endpoint `/api/version` agar mengembalikan `sw_cache = "taskflow-v384-dashboard-full-width-fluid"`.
4. Memperbarui cache version di `static/sw.js` ke `const CACHE = "taskflow-v384-dashboard-full-width-fluid";`.
5. Sinkronisasi asersi versi cache di suite test offline (`tests/offline/`) dan test backend `tests/test_version.py`, serta menambahkan asersi bahwa `.dash` tidak dibatasi `1320px`.

**Tech Stack:** CSS3, Vanilla JS / Service Worker, Node.js test runner (`node:test`), Python / FastAPI (`pytest`).

## Global Constraints
- **No Cowboy Coding:** Kode implementasi dan review WAJIB didelegasikan ke subagent via `invoke_subagent`.
- **Evidence Before Completion:** Wajib menjalankan `node --check static/sw.js`, `node --test tests/offline/*.test.js`, dan `venv/bin/python -m pytest tests/test_version.py` serta `pytest tests/`.
- **Preserve Documentation & Comments:** Jaga integritas file dan komentar yang sudah ada.

---

### Task 1: Update CSS, Versioning, Service Worker, and Tests for Full-Width Fluid Dashboard

**Files:**
- Modify: `static/app.css`
- Modify: `static/index.html`
- Modify: `webapp.py`
- Modify: `static/sw.js`
- Modify: `tests/test_version.py`
- Modify: `tests/offline/note_search_filters.test.js`
- Modify: `tests/offline/direct_messages_ui.test.js`
- Modify: `tests/offline/interactive_note_viewer.test.js`
- Modify: `tests/offline/drawing_sync_ui.test.js`
- Modify: `tests/offline/app_update_notifier.test.js`
- Modify: `tests/offline/note_saved_searches_view_mode.test.js`
- Modify: `tests/offline/workspace_files_chat.test.js`
- Modify: `tests/offline/focus_workstation.test.js`
- Modify: `tests/offline/note_toc.test.js`

- [ ] **Step 1: Write / Update the failing tests**
  - Update `tests/test_version.py` dengan versi `taskflow-v384-dashboard-full-width-fluid`.
  - Update `tests/offline/note_toc.test.js` untuk memverifikasi `app.css?v=320`.
  - Tambahkan unit test baru di `tests/offline/app_update_notifier.test.js` atau file terkait untuk memeriksa aturan `.dash` di `static/app.css` (`width: 100%`, `max-width: 100%`, tidak mengandung `max-width: 1320px`).
  - Update 8 file test offline yang memeriksa cache version `taskflow-v384-dashboard-full-width-fluid`.

- [ ] **Step 2: Implement the CSS & versioning changes**
  - Di `static/app.css`: ganti `max-width: 1320px;` pada `.dash` menjadi `width: 100%; max-width: 100%;`.
  - Di `static/index.html`: ubah link stylesheet ke `app.css?v=320`, dan perbarui string fallback `window.__SW_VERSION` ke `taskflow-v384-dashboard-full-width-fluid`.
  - Di `webapp.py`: ubah `sw_cache = "taskflow-v384-dashboard-full-width-fluid"`.
  - Di `static/sw.js`: ubah `const CACHE = "taskflow-v384-dashboard-full-width-fluid";`.

- [ ] **Step 3: Run verification tests**
  - Jalankan `node --check static/sw.js`.
  - Jalankan `node scratch/check_inline.js static/index.html` atau skrip pemeriksa inline jika ada.
  - Jalankan `node --test tests/offline/*.test.js`.
  - Jalankan `venv/bin/python -m pytest tests/test_version.py`.
  - Jalankan `venv/bin/python -m pytest tests/`.
