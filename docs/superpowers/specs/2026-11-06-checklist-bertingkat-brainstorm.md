# Brainstorming: Checklist bertingkat (urutan + sub checklist tanpa batas)

- **Tanggal:** 2026-11-06 (sesi Claude, akun lain melanjutkan)
- **Basis kode:** `main` @ `0951826` (SW `taskflow-v499-baseline-aktual`)
- **Status:** **BRAINSTORMING, BELUM SPEC.** Ini catatan serah-terima, bukan spec yang disetujui. Belum ada kode, belum ada branch fitur.
- **Skill:** `superpowers:brainstorming`, jalur **Arsitektural** (skema `subtasks` berubah, endpoint baru, hitungan checklist dipakai di banyak tempat). Gerbang: desain disetujui per bagian → spec ditulis + disetujui → `superpowers:writing-plans` → implementasi. **Jangan menulis kode produk sebelum itu.**

## Cara melanjutkan (untuk sesi berikutnya)

1. Baca dokumen ini sampai habis, lalu `.agents/CURRENT_STATE.md` entri "Checklist bertingkat".
2. Panggil skill `superpowers:brainstorming`, lanjutkan dari **langkah "Propose 2-3 approaches"** (sudah dipresentasikan, menunggu jawaban pemilik). Jangan ulang pertanyaan K1–K5 di bawah.
3. Minta pemilik mengonfirmasi **pendekatan 1** dan **asumsi A1–A4**. Lalu presentasikan desain per bagian (setiap bagian minta persetujuan):
   1. Data & API (skema, migrasi, endpoint move, aturan centang, aturan hapus, perhitungan progress server/klien),
   2. Tampilan & interaksi (baris bertingkat, pegangan seret, Tab/Shift+Tab, menu ⋯, lipat, slider terkunci, halaman Fokus),
   3. Pengujian & rilis (pytest, `node --test`, E2E Playwright, SW bump + `static/whatsnew.json` sesuai PROTOCOL).
4. Setelah semua bagian disetujui: tulis spec `docs/superpowers/specs/2026-11-06-checklist-bertingkat-design.md` (+ salinan ke Project claude.ai "alurik" `claude/spec-checklist-bertingkat-2026-11-06.md`), self-review, minta pemilik review, baru `writing-plans`.
5. Ikuti `CLAUDE.md` + `.agents/PROTOCOL.md` (update CURRENT_STATE + SESSION_LOG, merge hanya atas "merge dan deploy").

## Permintaan pemilik (kata-kata asli, 2026-11-06)

> feature baru, aku ingin checklist di setiap task, perlu bisa untuk di rearrange urutannya, dan diharapkan bisa juga untuk unlimited sub checklist, maksudnya satu checklist bisa punya sub checklist, sub checklist tidak mempengaruhi progress task.

## Keputusan pemilik (dijawab lewat pilihan, 2026-11-06)

| # | Pertanyaan | Jawaban pemilik |
|---|---|---|
| K1 | "Progress" yang tidak dipengaruhi sub checklist itu yang mana? | **Dua-duanya**: hitungan selesai/total (bar tab Checklist, badge `2/5` halaman Fokus) **dan** persen Progress task, keduanya hanya dari butir **level atas**. |
| K2 | Kalau task punya checklist, slider Progress manual bagaimana? | **Terkunci, otomatis**: ada ≥1 butir level atas → persen = selesai/total level atas, slider baca-saja dengan keterangan "dari checklist". Tanpa checklist → manual seperti sekarang. |
| K3 | Cara mengubah urutan dan tingkat? | **Seret + tombol indent**: pegangan ⠿ untuk seret naik/turun (mouse & sentuh, anak ikut pindah). Masuk/keluar tingkat lewat Tab / Shift+Tab dan menu ⋯ per butir ("Jadikan sub" / "Naikkan level"). |
| K4 | Offline sekalian atau online dulu? | **Dua fase**: Fase 1 = checklist bertingkat + seret + progress otomatis, online (seperti checklist sekarang). Fase 2 = checklist pindah ke local-first (outbox + sinkron). |
| K5 | Centang induk/anak? | **Induk → anak ikut**: centang induk = semua turunannya ikut selesai. Anak bisa dicentang sendiri tanpa mengubah induk. Buka lagi induk tidak membuka anak. |

## Asumsi Claude (BELUM dikonfirmasi pemilik — konfirmasi dulu)

- **A1** Berlaku di dua tempat checklist yang ada: tab Checklist di detail task (modal + panel Live Edit, satu komponen `TaskDetailBody`) dan checklist halaman Fokus.
- **A2** Hapus butir induk ikut menghapus semua turunannya, dengan konfirmasi bila butir punya anak.
- **A3** Butir yang punya anak bisa dilipat/dibuka (▸/▾); status lipat diingat per perangkat (localStorage, dibungkus try/catch).
- **A4** Istilah UI tetap "Checklist" / "Sub checklist"; tabel database tetap `subtasks` (nama lama, tidak diganti). Catatan: di UI "Subtask" = task anak (`tasks.parent_id`), BUKAN tabel `subtasks`.

## Pendekatan (dipresentasikan, menunggu jawaban pemilik)

1. **(Rekomendasi) Kolom `parent_id` di `subtasks`.** Setiap butir menyimpan induk (`NULL` = level atas) dan `sort_order` di antara saudara. Endpoint baru `POST /api/subtasks/{id}/move {parent_id, index}` memindah + menomori ulang saudara dalam satu transaksi (tolak bila `parent_id` adalah dirinya/turunannya, atau butir task lain). Progress = butir `parent_id IS NULL`. Data lama otomatis level atas, migrasi = satu `ALTER TABLE ... ADD COLUMN parent_id INTEGER DEFAULT NULL` di `repository.py` (pola migrasi kolom `client_id`, baris ±945). Fase 2: satu butir = satu baris = satu op sinkron, cocok dengan outbox.
2. **Jalur berurut (`path` mis. `0003.0001`).** Satu `ORDER BY path`, tetapi pindah butir menulis ulang path semua turunan; rawan bentrok di workspace dan berat untuk sinkron.
3. **Seluruh checklist sebagai JSON di task.** Sederhana dibaca, tetapi edit bersamaan saling menimpa dan semua pemakai tabel `subtasks` harus diganti.

## Temuan repo (titik sentuh)

**Server**
- Skema: `repository.py` ±676 (`CREATE TABLE subtasks`: id, task_id, title, is_done, sort_order, created_at; + `client_id` lewat migrasi ±945–949).
- Repo: `repository.py` ±1521 `add_subtask` (sort_order = MAX+1 per task), ±1542 `get_subtasks` (ORDER BY sort_order), ±1551 `toggle_subtask`, ±1561 `delete_subtask`, ±1575 `get_subtask_progress` (hitung semua butir → perlu disaring level atas).
- API: `webapp.py` ±3482–3525 (`GET/POST /api/tasks/{id}/subtasks`, `POST /api/subtasks/{id}/toggle`, `DELETE /api/subtasks/{id}`; notifikasi workspace "menambah item checklist").
- Hitungan halaman Fokus: `webapp.py` ±2325–2370 `GET /api/tasks/child-counts` (`COUNT ... FROM subtasks GROUP BY task_id` → perlu level atas saja).
- Ekspor: `webapp.py` ±7526–7533 (judul + done, datar).
- Progress task: kolom `tasks.progress` (0–100), `webapp.py` ±1264 / ±2653 (`PUT` clamp). Sekarang **tidak** tersentuh checklist sama sekali.
- Bot Telegram: `bot.py` ±785, ±1668, ±1698, ±2026, ±2112 (`/sub`, toggle, tampil) — tetap jalan; butir dari bot masuk level atas; tampilan bot datar (putuskan di desain apakah diberi indentasi).
- `merge_db.py` ±111 menyalin `subtasks` (perlu ikut kolom baru bila relevan).

**Klien** (`static/index.html` sudah terkompilasi: tulis `React.createElement`, bukan JSX)
- `ChecklistRow` ±9642 (baris datar: centang, judul, × "Hapus butir").
- Detail task: ±9896–9981 (muat, toggle, tambah, hapus); tab Checklist + bar `.td-check-bar` (spec redesain detail §4.6).
- Pill + popover "Ubah Progress": ±9106–9145 (tempat slider dikunci, K2).
- Halaman Fokus: ±11035 badge `subDone/subTotal`, ±11262–11284 muat hitungan, ±12490–12530 checklist Fokus.
- Offline: `static/offline/taskroutes.js` ±133–160 (K6: GET checklist id numerik diteruskan ke jaringan) dan ±252 (rute lokal GET untuk task cid); `static/offline/db.js` ±25 store `subtasks` (indeks task_cid, server_id, dirty) ada tapi **tidak pernah diisi dan tidak ikut sinkron** → checklist sekarang hanya online (alasan Fase 2).

**Tes yang menyentuh checklist:** `tests/test_task_child_counts.py`, `tests/test_notification_escape.py`, `tests/test_bot_escape.py`, `tests/offline/{focus_child_counts,focus_filter_ui,taskroutes}.test.js`, E2E `temporary_files/e2e_detail_redesign.py` (kelompok `tabs` B-3), `temporary_files/e2e_live_edit.py`.

## Pertanyaan terbuka untuk bagian desain

- Persen otomatis: disimpan ke `tasks.progress` (server menghitung ulang di setiap tambah/toggle/hapus/move level atas) atau dihitung klien saja? Disarankan **server menyimpan** supaya daftar task, Timeline, dan bot melihat angka yang sama.
- Pembulatan persen (mis. 1/3 → 33).
- Menghapus butir level atas terakhir → slider kembali manual dengan nilai terakhir.
- Tampilan bot Telegram untuk butir bertingkat.
