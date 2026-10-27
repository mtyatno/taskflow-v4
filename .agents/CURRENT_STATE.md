## 🟢 Catatan: kotak tulis di atas — `claude/catatan-input-atas` — 2026-10-27 (Claude) — susulan #102 (commit 16d26ca ter-push sesudah #102 di-merge); di-merge + deploy atas "merge dan deploy" Bapak 08:22 WIB. SW `taskflow-v476-catatan-input-atas`, `app.css?v=373`.

## 🟢 Panel Live Edit tanpa scrollbar + Catatan seperti chat (DI-MERGE #102 bb9cae8, deploy sukses) — `claude/panel-tanpa-scrollbar` — 2026-10-27 (Claude) — PR draft, menunggu "merge dan deploy"
- Permintaan Bapak: scrollbar panel detail disembunyikan, sudut kanan tetap membulat, tetap bisa digulir. `.tl-live-panel` `scrollbar-width: none` + `::-webkit-scrollbar { display: none }`; `scrollbar-gutter: stable` dibuang (tanpa scrollbar, kunci gulir overlay tag tidak menggeser isi). SW `taskflow-v475-panel-tanpa-scrollbar`. Tab Catatan (ModalNotes `bare`) jadi tampilan chat: lama→baru, milik sendiri (author_id = tf_user_id / null) di kanan, kotak tulis di atas (textarea tumbuh + tombol kirim), catatan terbaru tepat di bawahnya, Enter kirim / Shift+Enter baris baru, × hapus saat hover; mode non-bare tidak berubah, `app.css?v=372`. Verifikasi: npm 3292/3293 (hanya draw_local_reactive), pytest 1230, E2E live edit 122/0, overlay 20/0.

## 🟢 Detail task padat — `claude/detail-padat` — 2026-10-27 (Claude) — DI-MERGE (#101, 093bad8) oleh Bapak 2026-10-27 08:03 WIB; Deploy sukses (file statis, tanpa restart). SW `taskflow-v474-detail-padat`, `app.css?v=371`.
- **Permintaan Bapak (laptop 14"):** deskripsi + tab tertutup di panel; disetujui: properti satu baris (label kiri, nilai kanan; dua kolom hanya bila wadah ≥ 560 px lewat container query), jarak dirapatkan, Assign/Menunggu/Tag kosong diringkas jadi tombol "+ …" (spec redesain §13).
- **Rilis:** SW `taskflow-v474-detail-padat`, `app.css?v=371`, entri whatsnew "Detail task lebih ringkas". File statis saja.
- **Verifikasi:** `npm test` 3291/3292 (hanya `draw_local_reactive`), pytest 1230 lulus; E2E `e2e_detail_redesign.py` 316/0, `e2e_live_edit.py` 122/0, `e2e_task_detail_body.py` 104/0 (helper E2E kini juga menemukan tombol ringkas).

## 🟢 Redesain detail task (modal + panel Live Edit) — `claude/redesain-detail-task` — 2026-10-27 (Claude) — DI-MERGE (#100, d31a1a9) atas "merge dan deploy" Bapak 2026-10-27 04:34 WIB; Deploy sukses (file statis, tanpa restart). SW `taskflow-v473-detail-baru`, `app.css?v=370`, ADR-034.
- **Permintaan Bapak (2026-10-26):** detail task mengikuti dua mockup Bapak; pilihan **A** (modal = panel: klik nilai untuk mengubah, simpan otomatis, tanpa Edit/Simpan) + **pendekatan 1** (logika `TaskDetailBody` dipertahankan, tampilan diganti komponen kecil).
- **Spec / plan:** `docs/superpowers/specs/2026-10-26-redesain-detail-task-design.md` (status + "Keputusan pelaksanaan" + tindak lanjut), `docs/superpowers/plans/2026-10-26-redesain-detail-task.md` (catatan penomoran ulang). Ledger `.superpowers/sdd/2026-10-26-redesain-detail-task/progress.md`.
- **Isi:** `static/offline/taskdetail.js` (`TF.taskdetail`, murni) + `STATIC`/`<script>`; modal memakai pengendali simpan otomatis Live Edit (mode Edit/Simpan dihapus); bar atas `#id • Dibuat …` (Fokus, Selesai/Buka lagi, ⋯), chip kuadran/Terlambat/progress (popover "Ubah Progress"), kisi properti klik-untuk-ubah ber-popover (deadline/menunggu dikomit saat popover ditutup), baris Tag (tambah lewat judul `#tag`), deskripsi tanpa bingkai, tab Subtask/Checklist/Catatan/Lampiran; CSS di blok `/* ── Detail task: awal ── */ … akhir` (token saja; latar lembut = `--accent-soft`).
- **Merge `main`:** `origin/main` b365263 (tema PR A #99) di-merge (bdafd66; konflik `.gitignore`, `app.css`, `index.html`, `CURRENT_STATE.md`, `SESSION_LOG.md`), lalu `color-mix(var(--accent) 14%)` → `var(--accent-soft)` (a920c5e).
- **Versi:** SW **v473** `taskflow-v473-detail-baru` (`sw.js`, `index.html` + fallback, tes), **`app.css?v=370`** (`index.html` + `STATIC` + tes), entri `whatsnew.json` "Tampilan detail task baru" di atas entri silent v472. **ADR-034** di `DECISIONS.md`.
- **Verifikasi (setelah merge main + rilis v473):** PROTOCOL §4 33 passed; npm 3288 tes, 3287 lulus (pra-ada `draw_local_reactive`); pytest 1230 passed 1 skipped; inline OK (6); E2E `e2e_detail_redesign.py` 310/0, `e2e_task_detail_body.py` 104/0, `e2e_live_edit.py` 122/0.
- **Tindak lanjut (di luar branch):** "Lepas" (unassign) belum sampai ke server (`syncpush` mengirim `assigned_to: null`, PUT server mengabaikannya; pra-ada sejak #97); subtask antre dari `TaskFormModal` yatim di toko lokal (hanya `parent_id`).
- **Deploy:** file statis saja, tanpa migrasi, **tanpa restart** `taskflow-web`.
- **Berikutnya:** review akhir branch → push + PR draft (oleh kontroler). Merge hanya setelah Bapak bilang "merge dan deploy".

## 🟡 Tema PR A — fondasi token (mode × palet × dekorasi) — `claude/tema-fondasi-token` — 2026-10-27 (Claude) — DI-MERGE (#99, 7364f7c) atas "merge dan deploy" Bapak 2026-10-27 01:19 WIB; Deploy Taskflow V4 sukses (file statis, tanpa restart) (Task 1–7 selesai; merge hanya setelah "merge dan deploy")
- **Permintaan Bapak:** tema Sakura (pink, magenta-rose) + Lavender (ungu orchid) dengan dekorasi (kelopak, maskot layar kosong, penghitung sesi kelopak), dibangun di atas fondasi mode + palet; spec `docs/superpowers/specs/2026-10-26-tema-palet-dekorasi-design.md`, plan PR A `docs/superpowers/plans/2026-10-26-tema-fondasi-token.md` (+ serah-terima `…-tema-fondasi-token-handover.md`), eksekusi subagent-driven. ADR-033 di `.agents/DECISIONS.md` (spec §8 menyebut ADR-032, tetapi nomor itu sudah dipakai ADR tag task #98).
- **Isi PR A (tanpa perubahan piksel Default di luar toleransi 3/kanal):** `static/offline/themes.js` (`TF.themes`), token semantik di `app.css` `:root`/gelap (`--accent-rgb`, `--accent-text(-strong)`, `--accent-2(-hover)`, `--accent-soft/-duo/-ring/-ink`, `--bg-sidebar`, `--border-strong`, `--radius-*`, `--font-heading`), `static/themes.css?v=1` (kosong, blok palet PR B), migrasi literal lime → token (158 di `app.css`, 38 + 9 baris manual di `index.html`; `temporary_files/migrate_theme_tokens.js`, laporan `tema_migrasi_aksen.txt`), aturan gelap `app.css` → token (35 aturan bebas literal; allowlist `tests/offline/theme_dark_allowlist.json` 144 entri, ratchet total = 144 / non-bermakna = 61, hanya boleh turun), boot script `<script id="tf-theme-boot">` di `<head>` tepat setelah meta `theme-color`, sebelum stylesheet aplikasi/vendor (`data-theme`/`data-palette`/`data-decor` + `theme-color` sebelum render), App memakai `TF.themes.readPrefs/resolve/apply` + `useSystemDark`; guard `tests/offline/{themes,theme_guard,theme_boot}.test.js` ikut CI lewat `tests/test_theme_node.py`; harness piksel `temporary_files/e2e_tema_fondasi.py` (`baseline --ref`, `compare`, `verify`; teks versi SW di Pengaturan diganti teks tetap saat screenshot).
- **Catatan piksel:** Default tidak identik piksel-0 di mode gelap: 9 alpha netral bergeser ≤ 2/kanal + `#6B7F00`→`#6B8000` di terang (dalam toleransi 3). Review akhir (2026-10-27): skrip boot dipindah ke tepat setelah meta `theme-color`, `setThemePrefs` hanya menulis kunci patch, ratchet allowlist kini `===`, spec §3.2/§3.3/§5/§8 diselaraskan dengan token yang diimplementasi.
- **Versi:** SW **v472** `taskflow-v472-tema-fondasi` (`static/sw.js`, `static/index.html` + fallback, 26 tes `tests/offline/`), **`app.css?v=369`** (`index.html` + `STATIC`, 12 tes `tests/offline/` + `tests/test_static_revalidate.py`), `themes.css?v=1`. Entri teratas `static/whatsnew.json` `{"version": "taskflow-v472-tema-fondasi", "date": "2026-10-27", "silent": true}`. `main` ff0d317 = v471/368 (sudah di-merge ke branch, tanpa literal baru). Bila `main` memakai v472/369 lebih dulu, naikkan ke nomor kosong berikutnya kecuali entri lama `whatsnew.json` (PROTOCOL §4 butir 4). **Deploy:** file statis saja, tanpa migrasi, tanpa restart.
- **Verifikasi (setelah merge main ff0d317 + rilis v472):** npm 3256 tes, 3255 lulus (pra-ada `draw_local_reactive`); pytest 1228 passed 1 skipped; tes PROTOCOL §4 + `test_theme_node` + `test_version` 40 passed; `check_inline_scripts` OK (6); E2E `compare` 16/16 PASS (baseline `--ref origin/main` = ff0d317; 13 gambar 0 px, 3 gelap max delta 2 di bawah toleransi 3) dua kali berturut-turut; `verify` 9/9.
- **Sisa untuk PR B:** (1) literal yang belum bertoken: `docs/superpowers/plans/2026-10-26-tema-fondasi-sisa-hex.md`; (2) `useThemeName` harus melacak palet agar grafik dihitung ulang saat ganti palet (menambah `data-palette` ke `attributeFilter`-nya kini tidak berefek karena state hanya "light"/"dark"); (3) `useSystemDark` satu render basi saat beralih ke "Ikuti sistem" (kilat sekali); (4) matriks paritas boot (`theme_boot.test.js`) harus mengiterasi `TF.themes.PALETTES` begitu palet ditambah; (5) daftar palet `["default"]` dan tabel `theme-color` di boot script wajib diperbarui untuk tiap palet; (6) literal `LIME_KEEP` (`.badge-q2` `#6B8000`, `.cmt-mention` `#5D6E00`) dan literal lime-adjacent (`#4d5c00`, `#D9EE6A`, `#4E5C00`, `#d4e85c`, `rgba(182,212,0,…)`) tetap olive di palet lain; (7) 5 border hover `#525252` butuh token `--border-hover`; (8) `theme-color` terang Default `#FCFCFB` sesuai spec ditunda ke PR B (R4; PR A tetap `#0f172a`); (9) setiap blok palet harus menetapkan `--accent-rgb`, `--accent-text(-strong)`, `--accent-2(-hover)`, `--border-strong` (+ tes kelengkapan blok palet).
- **Berikutnya:** review akhir branch → PR draft "Tema PR A — fondasi token & palet (tanpa perubahan tampilan)" (push + PR oleh kontroler). Merge hanya setelah Bapak bilang "merge dan deploy"; lalu PR B (palet Sakura/Lavender + dekorasi).

## 🟡 Bug lama: simpan task menghapus semua tag + overlay "Task dengan tag" tidak menutupi area terlihat saat digulir — `claude/modal-simpan-tag` — 2026-10-26 (Claude) — DI-MERGE (#98, 42aa600) atas "merge dan deploy" + "selesaikan juga bug lama" Bapak 2026-10-26 20:19 WIB; Deploy sukses (file statis, tanpa restart)
- **Permintaan Bapak:** "selesaikan juga bug lama" (spec live edit §12). Brief `.superpowers/sdd/2026-10-26-bug-tag/brief.md` (di-.gitignore); laporan lengkap ada di balasan sesi ke kontroler. Basis `main` 64f3782 (sudah berisi Live Edit #96/#97).
- **Bug 1 (tag hilang):** judul task tersimpan tanpa `#tag`, jadi form yang mengirim `title` (💾 Simpan modal, form edit lengkap `TaskFormModal`, ubah status GTD dari daftar `App.handleUpdateTaskGtd`, wizard Inbox) membuat `TFrepo.updateTask` MENGGANTI tag lokal dengan `[]`, lalu push menghapusnya di server. Perbaikan klien saja: `tagrepo.addEntityTags` (baru, satu transaksi, hanya menambah tautan yang belum ada) dan `updateTask` memakainya — `#tag` di judul menambah, judul tanpa `#tag` tidak menyentuh tag. Hapus tag tetap lewat chip ×; push tetap mengirim himpunan lengkap. `webapp.py` TIDAK diubah (ADR-032). Habit (`habitrepo.updateTask`) masih semantik ganti — tidak disentuh (di luar brief). **Perbaikan ini per perangkat:** tag task tidak di-pull dari server (baris `/api/tasks` tanpa tag; `hydrate.js`/`pullTasks` tidak menangani tag), jadi perangkat kedua / login baru punya tag lokal kosong dan edit di sana mem-push judul tanpa tag → server membuang tag task itu sampai perangkat pemiliknya mengedit lagi. **Tindak lanjut:** (a) sertakan tag task di respons daftar task + isi tag lokal saat pull untuk rekaman yang tidak dirty; (b) antrekan op outbox `update` setelah hapus tag lewat chip × supaya penghapusan sampai ke server tanpa menunggu edit lain.
- **Bug 2 (overlay):** `pinOverlayToScrollBox(overlay, onPlace)` (sebelum `TaskDetailBody` di `static/index.html`): wadah = `parentElement` overlay (`.modal-content` / `aside.tl-live-panel`); overlay `left/right 0`, `top = scrollTop`, `height = clientHeight`; gulir wadah dikunci (`overflow: hidden`) selama overlay terbuka, overflow inline semula dikembalikan saat tutup/unmount/pindah task; ukur ulang lewat `ResizeObserver` + `resize` + `scroll`, state hanya diset bila top/height berubah. `.tl-live-panel` mendapat `scrollbar-gutter: stable` supaya kunci gulir tidak menggeser isi panel. Warna tetap, tanpa `border-left`; isi overlay tetap menggulir sendiri.
- **Versi:** SW **v471** `taskflow-v471-simpan-tag` (`static/sw.js`, `static/index.html` + fallback, 26 tes `tests/offline/`; `whatsnew.json` tidak disentuh `sed`). `app.css` berubah (`scrollbar-gutter` panel) → **`?v=368`** di `index.html` dan `STATIC` (+ 13 file tes yang mengunci `?v=367`). Entri teratas `whatsnew.json` v471 (2026-10-26, "Tag task tidak hilang lagi", 2 poin `fixed`). `main` 64f3782 = v470; PR terbuka #84 (v458) / #25 (v412) memakai nomor lebih lama. Bila `main` memakai v471 lebih dulu, naikkan ke nomor kosong berikutnya kecuali `whatsnew.json` (PROTOCOL §4 butir 4).
- **Deploy:** file statis saja, tanpa migrasi, **tanpa restart** `taskflow-web`.
- **Verifikasi (sesudah commit rapikan):** npm 3218 tes, 3217 lulus (pra-ada `draw_local_reactive`); pytest 1225 passed 1 skipped (+2 jembatan CI `tests/test_tag_node.py` untuk `taskrepo`/`tagrepo`/`tag_tasks_overlay`); PROTOCOL §4 33 passed; `check_inline_scripts` OK (5). E2E `temporary_files/e2e_task_detail_body.py` 98/98 (dulu 61; +c5, skenario g tag 14 langkah, skenario h overlay 19 langkah; di kode lama g 10/15 gagal, c5 4/4 gagal, h 9/20 gagal). `temporary_files/e2e_live_edit.py` **118/118 tiga kali berturut-turut** sesudah race F6e diperbaiki (tunggu GET notes/attachments/subtasks panel sebelum DELETE server); sebelum perbaikan itu 1 dari 6 run gagal Z[3] (404 GET anak task yang baru dihapus, tidak terkait tag/overlay).
- **Catatan untuk agent berikutnya:** komentar R9/R21 di `useTaskAutosave`/`TaskDetailBody` (`index.html`) dan `liveedit.js` sudah disesuaikan dengan ADR-032; kode panel sengaja tidak diubah (`titleWithTags` tetap aman, R21 tetap perlu). Tidak ada tombol yang membuka `TaskFormModal` mode edit di `main` (prop `onEdit` `TaskDetailModal` tidak dipakai `TaskDetailBody`); E2E g2 mengirim body form edit yang sama lewat `api.put`.
- **Berikutnya:** push + buka PR hanya bila Bapak minta; merge hanya setelah "merge dan deploy".

## 🟡 Live Edit — PR B: tombol Live Edit + panel detail task di samping daftar (autosave) — `claude/live-edit` — 2026-10-26 (Claude) — DI-MERGE (#97, 64f3782) atas "merge dan deploy" Bapak 2026-10-26 20:19 WIB (commit notifikasi R20 ikut); Deploy sukses; TUNGGU RESTART `taskflow-web` (webapp.py: notifikasi)
- **Permintaan Bapak:** edit satu task cukup lama lalu pindah ke task berikutnya tanpa menutup modal tiap kali. Spec `docs/superpowers/specs/2026-10-26-live-edit-design.md` (sudah memuat keputusan pelaksanaan R9–R16 dan perbaikan tinjauan akhir R19/R21), plan `docs/superpowers/plans/2026-10-26-live-edit.md` (bagian "Rulings saat eksekusi"), ADR-031 di `.agents/DECISIONS.md`; salinan spec/plan di Project claude.ai "alurik" (`claude/spec-live-edit-2026-10-26.md`, `claude/plan-live-edit-2026-10-26.md`) belum disinkronkan dengan R9–R16.
- **Isi:** (1) tombol `button.tl-view-btn.tl-live-btn` "Live Edit" (aria-pressed, simpan di `localStorage` `tf_liveedit`) di samping tiga tombol view pada `TaskListView`; hanya tampil bila area konten ≥ 760 px (diukur `useLiveEdit`: `clientWidth` + lebar scrollbar halaman agar tidak berkedip di dekat ambang), kalau tidak, klik task tetap membuka modal. (2) Saat nyala: `div.tl-live` dua kolom, kiri view aktif (Normal/Compact/Kanban) apa adanya, kanan `aside.tl-live-panel` (lebar `clamp(round(w × 0.5), 420, 680)`, sticky, `max-height` diukur langsung (R15) supaya bar aksi Hapus … Done terlihat sebelum halaman digulir); `TaskDetailPanel` memasang `TaskDetailBody variant "panel"` (field selalu input, tanpa tombol Edit/Simpan). (3) Pilihan task lewat reducer murni; baris/kartu terpilih ber-`is-selected` + `aria-current` (token `--bg-selected`); task yang di-Done/keluar dari daftar tetap tampil di panel; Hapus → "Pilih task di daftar". (4) Autosave: `TF.liveedit.createAutosaver` (`static/offline/liveedit.js`) mengirim hanya field yang berubah; judul saat blur/Enter, deskripsi/waiting for setelah diam 1,5 dtk atau blur, pilihan langsung; project/context: opsi yang sudah ada langsung, nama yang diketik hanya saat keluar field/Enter/flush (R19); membuka task tidak menyimpan apa pun; edit offline lewat router lokal seperti modal. (5) `App.handleDelete` mengembalikan boolean dan `taskDetailProps` diteruskan ke kedua `TaskListView`. Klien saja kecuali satu commit server terpisah (R20, lihat Deploy): tanpa skema, API, router lokal, `syncpush.js`/`outbox.js`. Modal dan alurnya tidak berubah.
- **Versi:** SW **v470** `taskflow-v470-live-edit` (`static/sw.js`, `static/index.html` + fallback, tes di `tests/offline/` yang memeriksa versi; `static/whatsnew.json` tidak disentuh `sed`); `app.css` berubah → **`?v=367`** di `index.html` dan `STATIC` (+ tes yang mengunci `?v=366`). Entri teratas `static/whatsnew.json` v470 (judul "Edit task langsung di samping daftar", 2 poin baru); entri v469 `silent` tetap di bawahnya. Modul baru `static/offline/liveedit.js` ada di `STATIC` dan dimuat `<script>` di `index.html` (setelah `kanbanboard.js`, sebelum `taskroutes.js`). `main` (0ab062d) masih v468, PR #96 = v469; PR terbuka lain memakai nomor lebih lama. Bila `main`/PR lain memakai v470 atau `app.css?v=367` lebih dulu, naikkan ke nomor kosong berikutnya di semua tempat kecuali `whatsnew.json` (PROTOCOL §4 butir 4).
- **Deploy:** tanpa migrasi. **`webapp.py` berubah (commit R20) → setelah deploy WAJIB `sudo systemctl restart taskflow-web`** (`/api/version` membaca `static/sw.js`). R20 = notifikasi "✏️ … memperbarui task …" (in-app + Telegram) untuk anggota workspace digabung: satu per aktor per task per 10 menit (`TASK_UPDATE_NOTIFY_WINDOW_MIN`), karena autosave panel membuat banyak `PUT` per sesi edit; notifikasi penugasan tidak terpengaruh. Commit R20 berdiri sendiri (`feat(notif): satukan notifikasi …`) dan **boleh di-drop** bila Bapak lebih suka notifikasi per simpan — tanpa commit itu PR B kembali file statis saja tanpa restart. **Ditumpuk di atas PR A (draft #96): merge #96 dulu**, lalu PR B (GitHub memindahkan basis ke `main` otomatis bila branch #96 dihapus setelah merge; kalau tidak, arahkan ulang basis PR B ke `main`). Merge hanya setelah Bapak bilang "merge dan deploy".
- **Perbaikan tinjauan akhir (commit klien sesudah ea50068):** (R19) nama project/context yang diketik tidak lagi tersimpan karena diam 1,5 dtk — sebelumnya "Mark" → jeda → "Marketing" membuat project/tahap Kanban "Mark" di server; `saveTrigger("project"|"context")` selalu `"blur"`, panel `commit` langsung bila nilai ada di `scopeProjects`/`scopeContexts`, `Enter` di field ikut menyimpan. (R21) setiap simpan judul memuat ulang tag task (GET lokal) tepat sebelum judul disusun, gagal → sekali lagi → ditolak; chip panel juga dimuat ulang saat `task.updated_at` berubah — sebelumnya daftar tag basi bisa memulihkan tag yang dihapus di tempat lain.
- **Verifikasi (sesudah perbaikan tinjauan akhir R19–R21):** npm 3202 tes, 3201 lulus (pra-ada `draw_local_reactive`); pytest 1223 passed 1 skipped (+8 tes R20 `tests/test_task_update_notify_coalesce.py`); `check_inline_scripts` OK; E2E 118/118 (12 langkah baru R19/R21; 8 di antaranya gagal pada kode klien sebelum perbaikan). **Sebelumnya (ea50068):** npm 3197 tes, 3196 lulus (1 gagal pra-ada `draw_local_reactive`); pytest 1215 passed 1 skipped; tes PROTOCOL §4 33 passed; `check_inline_scripts` OK (5 skrip). E2E baru `temporary_files/e2e_live_edit.py` (tidak di CI; screenshot ke `temporary_files/e2e_live_edit/`, di-`.gitignore`): 106/106 lulus dua kali berturut-turut. Mencakup muat segar dengan Live Edit nyala (task pertama terbuka, juga bila daftar tiba sesudah panel), sidebar ikon dan lebar × Normal/Compact/Kanban, Priority langsung / deskripsi setelah diam / judul saat blur → reload bertahan, judul mempertahankan tag dan `#tagbaru` menjadi tag, "+ Baru" project lalu diam 2 dtk → project lama tetap, 3 task dibuka tanpa edit (halaman OFFLINE, agar op tidak terkuras push 1,5 dtk) → `_outbox` dan `updated_at`/`rev`/`dirty` rekaman lokal tetap, offline (CDP) → edit → online tersinkron, Done/Hapus/task dihapus di tempat lain/drag Kanban, 375 px dan 900 px + sidebar lebar → modal, mode gelap, bar aksi di viewport (task tinggi, scrollTop 0 dan digulir), tanpa kedip di sekitar 760 px dengan scrollbar klasik sungguhan (diuji kena bila kompensasi scrollbar dicabut). Pengecualian cek konsol: 404 pra-ada `GET /api/tasks/:id` dari `syncpull` (konfirmasi task hilang setelah hapus + sync; juga dengan Live Edit mati) dan `net::ERR_INTERNET_DISCONNECTED` untuk URL `/api/...` selama emulasi offline (akhir run menegaskan tiap respons >= 400 pada `/api/tasks/<id>` adalah `GET` 404).
- **Temuan lama (ada di `main`, TIDAK diperbaiki di sini; tindak lanjut terpisah):** (1) **menyimpan lewat modal (💾 Simpan) menghapus semua tag task**: form modal selalu mengirim `title`, dan server serta store lokal mengganti tag dengan `#tag` di judul itu (judul tersimpan tanpa `#tag`). Panel menghindarinya (`titleWithTags`, R9/R14). Perbaikan yang disarankan: modal hanya mengirim field yang berubah, atau memakai `titleWithTags` yang sama. (2) Overlay "Task dengan tag" ikut tergulir bersama isi modal/panel. (3) `syncpull` mencatat 404 di konsol setelah hapus + sync. (4) Memilih menu di sidebar selalu melipat sidebar ke bilah ikon; di 900 px bilah ikon masih memberi area konten ≈ 780 px (Live Edit tersedia), baru sidebar lebar membuatnya < 760 px.
- **Catatan kecil yang ditunda (lihat `.superpowers/sdd/2026-10-26-live-edit/progress.md`):** deadline memicu simpan di tiap perubahan nilai saat mengetik tahun di `type=date` (beberapa op outbox, nilai akhir benar); indikator "Tersimpan" hilang tiba-tiba (spec: memudar); flush saat unmount dibuang diam-diam bila daftar tag tak bisa dimuat; menyalakan/mematikan Live Edit atau melewati ambang me-mount ulang daftar (gulir Kanban dan menu tertutup kembali); pilihan yang tidak ada di `allTasks` (mis. task anak) terlepas bila daftar menjadi kosong; warna error memakai `var(--danger, #dc2626)` karena token `--danger` belum ada.
- **Berikutnya:** tunggu "merge dan deploy" Bapak: merge #96 lalu #97 (atau drop commit `31a1a41` bila notifikasi per simpan lebih disukai). Lalu perbaikan bug tag di modal (temuan 1) di PR terpisah. Spec/plan di Project claude.ai sudah disamakan dengan versi repo.

## 🟡 Live Edit — PR A: isi modal detail task dipisah ke `TaskDetailBody` (tanpa perubahan perilaku) — `claude/task-detail-body` — 2026-10-26 (Claude) — DI-MERGE (#96, 7bbc3c4) 2026-10-26; Deploy sukses
- **Permintaan Bapak:** edit satu task cukup lama lalu pindah ke task berikutnya tanpa menutup modal tiap kali → "Live Edit" (panel detail task di samping daftar, bisa dipakai bersama Normal/Compact/Kanban). Dikerjakan dua PR (spec K12): **PR A (ini)** = pemisahan isi modal tanpa perubahan perilaku; PR B `claude/live-edit` (tombol Live Edit, panel, autosave, `static/offline/liveedit.js`) menyusul setelah PR A di-merge, atau bertumpuk di atas branch ini. Spec `docs/superpowers/specs/2026-10-26-live-edit-design.md`, plan `docs/superpowers/plans/2026-10-26-live-edit.md` (salinan di Project claude.ai "alurik": `claude/spec-live-edit-2026-10-26.md`, `claude/plan-live-edit-2026-10-26.md`).
- **Isi:** `TaskDetailModal` (`static/index.html`) kini hanya pembungkus `.modal-overlay` + `.modal-content scale-in` + tombol ✕ (`headerAction`); seluruh isi (header, mode lihat/edit, checklist, sub-task, tag, catatan, lampiran, pindah workspace, tombol aksi, overlay "Task dengan tag") pindah ke komponen baru `TaskDetailBody({... variant = "modal", headerAction = null})` yang mengembalikan `React.Fragment` (ruling R4: overlay tag `position: absolute; inset: 0` tetap berjangkar ke `.modal-content`). `variant` belum dipakai (disiapkan untuk panel di PR B). Jalur App tidak berubah. Tes baru `tests/offline/task_detail_body.test.js` (struktur), jembatan CI `tests/test_liveedit_node.py` (`NODE_TESTS` + `EXPECTED_NODE_TESTS`, ruling P1); tiga tes lama yang membaca sumber modal disesuaikan (`context_scope_form`, `project_scope_form`, `task_move_workspace`).
- **Versi:** SW **v469** `taskflow-v469-task-detail-body` (`static/sw.js`, `static/index.html` + fallback; 28 file `static/` + `tests/`); `app.css` tidak berubah → tetap `?v=366`. Entri teratas `static/whatsnew.json` `{"version": "taskflow-v469-task-detail-body", "date": "2026-10-26", "silent": true}` (tak terasa pengguna). `main` (0ab062d) masih v468; PR terbuka #84/#25 memakai nomor lebih lama. **Deploy:** file statis saja (tanpa perubahan `webapp.py`, tanpa migrasi), **tanpa restart** `taskflow-web` (`/api/version` membaca `static/sw.js`). Bila `main` memakai v469 lebih dulu, naikkan ke nomor kosong berikutnya (checklist `.agents/PROTOCOL.md` §4).
- **Verifikasi:** npm 3122 tes, 3121 lulus (1 gagal pra-ada `draw_local_reactive`); pytest 1215 passed 1 skipped; tes PROTOCOL §4 (`test_whatsnew` + `test_sw_precache_node` + `test_app_update_node`) 33 passed; `check_inline_scripts` OK (5 skrip). E2E baru `temporary_files/e2e_task_detail_body.py` (1280 px dan 375 px × terang/gelap: buka dari "Semua Task", ✕ di kanan judul, ✕ dan klik overlay menutup, overlay "Task dengan tag" = bounding box `.modal-content`, klik task anak membuka anak, ✏️ Edit → Priority P1 → 💾 Simpan → server P1 dan badge P1 setelah reload, konsol bersih): branch **61/61**, `main` 0ab062d **61/61**; 16 screenshot dibanding piksel branch vs `main`: 15 identik, 1 beda 8 piksel (sudut membulat, selisih 1/255 satu kanal) = identik secara visual. Screenshot di `temporary_files/e2e_task_detail_body/` (di-`.gitignore`).
- **Temuan lama (ada di `main`, tidak diubah, relevan untuk PR B):** (1) menyimpan form modal (`PUT /api/tasks/:id` berisi `title`) lewat router lokal memanggil `TFtagrepo.extractTags(title)` lalu menimpa tag task dengan hasilnya → semua tag task hilang bila judul tak memuat `#tag` (dicek di `main`: tag terpasang → ✏️ Edit → Simpan → tag kosong). Autosave panel yang mengirim `title` akan memicu hal sama; patch judul harus mempertahankan tag atau tag tidak boleh ditimpa saat `title` dikirim. (2) Overlay "Task dengan tag" ikut tergulir bersama isi `.modal-content`: saat modal tergulir (HP 375 px) overlay tidak menutupi seluruh area terlihat (identik di `main`; bounding box sama hanya pada scrollTop 0). (3) Tag task hidup di IndexedDB (`GET /api/tasks/:id/tags` dilayani router lokal); tag yang dibuat langsung di server tidak turun ke klien. (4) Modal task anak tidak menampilkan banner "Subtask dari" (identik di `main`).
- **Berikutnya:** draft PR #96 (`claude/task-detail-body` → `main`) sudah dibuka; merge hanya setelah Bapak bilang "merge dan deploy". PR B (`claude/live-edit`, entri di atasnya) ditumpuk di atas branch ini, jadi **merge #96 dulu**.

## 🟡 Halaman Fokus: HUD "Task Created" di input Parkir, header ringkas HP/tablet, tombol baris task vertikal di HP — `claude/fokus-parkir-toast` — 2026-10-23 (Claude) — DI-MERGE (#95, 45822d2) atas \"merge dan deploy\" Bapak 2026-10-23 08:50 WIB; Deploy sukses; TUNGGU RESTART `taskflow-web`
- **Permintaan Bapak:** (1) input "Ada pikiran lewat?" → notifikasi "task dibuat" persis seperti hero Dashboard (semua teks langsung task, tanpa kata kunci); (2) area di atas hero lebih ringkas di HP/tablet (dipilih: strip tanpa judul); (3) baris task HP: ⭐, Fokus, chevron satu kolom vertikal agar judul lebih lebar.
- **Isi:** komponen bersama `CenterHudToast` + `useCenterHudToast` (2800 ms) dipakai Dashboard (tanpa perubahan) dan `PomoParkInput` (portal ke body, di atas Zen); live region sr-only "Tersimpan ke Inbox" dihapus (HUD mengumumkan). Header ≤ 1024 px: strip satu baris `Jum, 23 Okt · 27 task · 🍅 0/27 · ~11,5 j` (`pomologic.headerSummaryShort`), jam hilang dulu bila sempit, tinggi 1.5em, h1/kalimat lengkap tetap untuk pembaca layar; desktop tetap. Baris task ≤ 640 px: grid, kolom tombol vertikal (⭐ → Fokus → chevron), judul 47% → 72% lebar di 375 px; 641–768 tetap horizontal.
- **Versi:** SW **v468** `taskflow-v468-fokus-parkir-toast`, `app.css?v=366` (index.html + `STATIC` sw.js). (v467/365 dipakai `main` #94); entri teratas `static/whatsnew.json` v468 ("Halaman Fokus lebih ringkas"). **Deploy:** file statis saja (tanpa perubahan `webapp.py`); `/api/version` membaca sw.js.
- **Merge main 4e8b623 (#93 + #94) + rilis v468 (2026-10-23):** konflik versi diselesaikan, literal `sw_cache` webapp.py dibuang; app.css & .gitignore digabung; harness E2E (`e2e_focus_page.open_app`, `e2e_focus_header_strip.open_focus`) menulis `tf_whatsnew_seen` = versi SW. Verifikasi: npm 3118/3117 (pra-ada `draw_local_reactive`); pytest 1211 passed 3 skipped; tes PROTOCOL §4 33 passed; inline OK; E2E park_hud 68/0, header_strip 101/0, row_stack 31/0, focus_page 36/0.
- **Verifikasi (setelah merge main eff037b):** npm 3011/3010 (pra-ada `draw_local_reactive`); pytest 1177 passed 3 skipped; inline OK; E2E park_hud 68/0, header_strip 101/0, row_stack 31/0, focus_page 36/0 (sebelum merge juga hero_mobile 148/0, filter 115/0). Review + re-review: 0 kritis/penting.
- **Sisa:** HUD jalur offline tidak di-E2E; baris task HP lebih tinggi (±100–120 px) karena tumpukan tombol.

## 🟠 Istilah "Sketsa" + Media/📎 File di toolbar & menu blok + toolbar note fluid — `claude/istilah-sketsa-media` — 2026-10-23 (Claude) — DI-MERGE (#94, 4e8b623) atas \"merge dan deploy\" Bapak 2026-10-23 08:50 WIB; Deploy sukses; TUNGGU RESTART `taskflow-web`
- **Permintaan Bapak:** pil toolbar/menu blok "Gambar" membuka sketsa tldraw sehingga ambigu dengan unggah gambar; menu blok tidak punya unggah media; toolbar note keluar layar di HP/tablet (harus fluid: satu baris, dua baris bila tidak muat); tombol "+" dihapus, isinya tampil langsung.
- **Isi:** (1) fitur drawing disebut "Sketsa" di seluruh UI (nav, halaman, modal sisip, kartu note, pencarian, toast, drawingshare.js, halaman publik, ekspor DOCX); "Gambar" kini hanya berarti foto. Identifier/route `draw`/event/`::draw`/default DB & sync `Untitled Drawing` tidak berubah. Alias ketik `/gambar` dihapus (`/draw`, `/canvas`, `/sketsa` tetap). (2) Toolbar [Sketsa] [Media] [📎 File]: Media = gambar (lewat handler tempel host, `{source:'picker'}`) + audio/video (alur media lama); 📎 = dokumen saja (unggah #89 tetap). Menu blok "Sisipkan": Tabel, Divider, Sketsa, Task, Media, File (File hanya NoteModal) lewat `pickerRef`. Aturan picker: offline → base64 maks 1 MB; server non-ok → toast `detail`; quick-note TaskFormModal: satu note (PUT ke note server yang dibuat untuk gambar, id task lokal dipetakan ke id server, note yatim dihapus saat batal); NoteModal note cid → `ensureServerNoteId`. (3) Toolbar fluid: wrap ≤ 2 baris (≥ 360 px), container query `notetb` ≤ 519 px menyembunyikan label (aria-label tetap), tanpa scroll horizontal; dropdown "+" dihapus (Numbered, Strikethrough, Tabel, Wiki inline). Slash menu `max-height` 480 px (17 item tanpa scroll).
- **Versi:** SW **v467** `taskflow-v467-istilah-sketsa-media`, `app.css?v=365` (v466/364 dipakai `main` #93); entri teratas `static/whatsnew.json` v467 (index.html + `STATIC` sw.js URL persis). **Deploy:** file statis + webapp.py (teks halaman publik/ekspor) → restart `taskflow-web`.
- **Merge main 3031fe0 (#93) + rilis v467 (2026-10-23):** konflik versi diselesaikan, literal `sw_cache` webapp.py dibuang (kini `/api/version` membaca sw.js); entri `whatsnew.json` v467 ("Sketsa dan Media di catatan"); harness E2E (`e2e_slash_menu_grid.open_app`, `e2e_istilah_sketsa_media`) menulis `tf_whatsnew_seen` = versi SW agar modal "Apa yang baru" tidak menutupi UI. Verifikasi: npm 3104/3103 (pra-ada `draw_local_reactive`); pytest 1211 passed 3 skipped; tes PROTOCOL §4 33 passed; inline OK; E2E `e2e_istilah_sketsa_media` 92/92, `e2e_note_toolbar_fluid` 93/93, `e2e_slash_menu_grid` 40/40.
- **Verifikasi (setelah merge main eff037b):** npm 3052/3051 (pra-ada `draw_local_reactive`); pytest 1177 passed 3 skipped; inline OK; E2E `e2e_istilah_sketsa_media` 92/0, `e2e_note_toolbar_fluid` 93/0, `e2e_slash_menu_grid` 40/0, `e2e_note_media` 56/0, `e2e_note_image_attach` 12/0. Review per task + review akhir + 2 re-review: 0 kritis/penting terbuka.
- **Sisa diketahui:** 320 px toolbar 3 baris; headroom 1 baris di 1280 hanya 24 px; pemisah bisa di awal baris 2; simpan < 200 ms setelah edit bisa kehilangan edit terakhir (pra-ada); PUT gagal jaringan → fallback lokal meninggalkan note server; nama file dengan `]` tidak di-escape di markdown gambar; Chrome 105–110/Safari 16.0–16.3 dropdown toolbar bisa di bawah block handle; commit WIP 05f9216 tetap di riwayat.

## 🟠 Banner pembaruan selalu berhasil + modal "Apa yang baru" — `claude/apa-yang-baru` — 2026-10-23 (Claude) — DI-MERGE (#93, 0e4965c) atas "merge dan deploy" Bapak 2026-10-23 08:27 WIB; Deploy Taskflow V4 sukses; TUNGGU RESTART `taskflow-web`
- **Laporan Bapak:** banner "Pembaruan Alurik tersedia" diklik tetapi SW seperti tidak berubah; minta modal fitur baru setelah memuat ulang, isinya ditulis agent di sebuah file. Spec `docs/superpowers/specs/2026-10-23-apa-yang-baru-design.md`, plan `docs/superpowers/plans/2026-10-23-apa-yang-baru.md`, ADR-030.
- **Akar masalah:** (A) `/api/version` = literal `sw_cache` di `webapp.py`, basi sampai `taskflow-web` di-restart → banner kembali terus setelah perangkat sudah di versi baru; (B) banner dari selisih `/api/version` saat SW baru masih `installing` → klik mengirim `SKIP_WAITING` ke SW aktif, reload ke versi lama; (C) worker yang sudah `installing` saat halaman dibuka tidak didengar.
- **Fix:** `/api/version` membaca `CACHE` dari `static/sw.js` (literal `sw_cache` dihapus). `static/offline/appupdate.js` (`TF.appupdate`): di halaman terkendali banner hanya dari SW menunggu, selisih versi hanya memicu `reg.update()`, `apply()` ke worker menunggu + pengaman 5 dtk, toast cek manual. `static/whatsnew.json` + `static/offline/whatsnew.js` (`TF.whatsnew`, penanda per perangkat `tf_whatsnew_seen`); modal `.whatsnew-modal` sekali setelah login, tombol "Apa yang baru" (riwayat) di kartu Pengaturan "Pembaruan Aplikasi"; banner tanpa emoji, "Memperbarui…".
- **Penjaga:** `tests/test_whatsnew.py`, `tests/test_version.py`, `tests/offline/{whatsnew,app_update_flow}.test.js` (ikut CI lewat `tests/test_app_update_node.py`), `tests/offline/whatsnew_ui.test.js` (juga ikut CI lewat `tests/test_app_update_node.py`). pytest 1194 passed 1 skipped; npm 3049/3048 (pra-ada `draw_local_reactive`); inline OK; build-tauri 3/3. E2E `temporary_files/e2e_apa_yang_baru.py`: branch 17/17 (2×), `main` eff037b 4/17: d0/d3 = bug A (server tetap v465, banner kembali setelah klik); w1–w3 = bug B (fase w dimulai dari halaman yang dimuat ulang tanpa banner; banner baru muncul ±50 ms setelah dipicu saat SW v999 `installing`, tanpa SW menunggu; klik → tetap v998); m/t/s/n = fitur belum ada.
- **Versi:** SW **v466** `taskflow-v466-apa-yang-baru`, `app.css?v=364` — kini dipakai `main`. PR terbuka yang masih memakai v466 (#94 `claude/istilah-sketsa-media`) wajib naik ke nomor kosong berikutnya; #94 dan #95 (v467) juga wajib menambah entri teratas `static/whatsnew.json` sesuai checklist `.agents/PROTOCOL.md` §4 (CI menolak bila lupa).
- **Deploy:** file statis + `webapp.py` → restart `taskflow-web` **sekali**; tanpa migrasi. Sesudahnya `/api/version` tidak butuh restart lagi.
- **Aturan baru untuk agent lain:** setiap kenaikan versi SW ikuti checklist `.agents/PROTOCOL.md` §4, termasuk entri teratas `static/whatsnew.json` (kalimat untuk pengguna, tanpa istilah teknis; `silent` bila tak terasa). `sw_cache` di `webapp.py` sudah tidak ada — PR paralel yang masih menaikkannya: buang barisnya saat merge.
- **Catatan:** perpindahan v465 → v466 masih memakai kode banner lama di perangkat sekali (bug B bisa terjadi sekali); modal v466 tetap tampil. `main` (eff037b, #91/#92, backend saja; SW tetap v465) sudah di-merge ke branch ini, SW tetap v466.
- **Berikutnya (di server, oleh Bapak):** `sudo systemctl restart taskflow-web` sekali (sebelum restart `/api/version` masih melaporkan v465 dari proses lama; `/sw.js` sudah v466). Lalu buka Alurik → klik "Perbarui Sekarang" bila banner muncul → modal "Apa yang baru" tampil setelah reload.
- **Review akhir (2026-10-23):** perbaikan sudah diterapkan — checklist PROTOCOL §4 (rujukan §3.3, jebakan `sed` massal ke `whatsnew.json`, tes yang tepat), regex versi `test_whatsnew.py` ketat (fullmatch, `[0-9]`), `whatsnew_ui` ikut CI; `main` sudah di-merge.

## 🟠 Lampiran note baru (📎) disimpan di disk VPS, Nextcloud keluar dari jalur unggah — `claude/note-lampiran-disk` — 2026-10-23 (Claude) — DI-MERGE (#92, 850a930) atas "merge" Bapak 2026-10-23 05:49 WIB; TUNGGU RESTART `taskflow-web`
- **Status:** backend saja (webapp.py), tanpa migrasi (kolom `storage`/`storage_key` sudah ada), tanpa perubahan frontend/SW. **Deploy: restart `taskflow-web` saja.**
- **Permintaan Bapak:** lampiran note baru disimpan seperti file workspace (disk VPS), Nextcloud keluar dari jalur unggah; nanti bisa dipindah ke S3.
- **Isi:** unggah → `UPLOAD_DIR/<uuid hex + ekstensi tersanitasi>` (`storage='upload'`, `storage_key`, `nextcloud_path=''`), tulis atomik `.part` + `os.replace` (di thread), file dihapus bila INSERT gagal / `.part` dihapus bila tulis gagal. Tampil (`/view`), publik (`/pub/attachments`) → `FileResponse` dengan header sama (`_served_file_mime` + `_inline_file_headers`); hapus → baris dulu lalu file; Sampah: file tetap ada sampai dikosongkan (`_purge_trashed_media` kini juga `storage='upload'`), pulihkan tetap bisa dibuka; ekspor DOCX membaca file lokal. Baris lama `storage='nextcloud'` tetap lewat Nextcloud (di thread, #91). `_nc_ensure_folder`/`_nc_put_file` dihapus (tak terpakai). Dipilih `UPLOAD_DIR` (bukan `MEDIA_ROOT`) karena `backup.sh` hanya mencadangkan `uploads/`.
- **Verifikasi:** tes baru `tests/test_note_attachment_disk.py` (12: tanpa Nextcloud, NEXTCLOUD_URL kosong, header, 404 file hilang, sanitasi ekstensi, hapus, baris lama via Nextcloud, pub, DOCX, Sampah purge/restore, `.part`); `tests/test_nextcloud_offloop.py` kini memakai baris lama (tetap gagal di `main`); pytest 1179 passed, 1 skipped; JS 2996/2997 (pra-ada `draw_local_reactive`); E2E `temporary_files/e2e_note_image_attach.py` **12/12** (+ cek WebDAV palsu tidak menerima PUT). Review subagen: tidak memblokir; 2 minor diperbaiki.
- **Temuan (tidak diubah):** `backup.sh` TIDAK mencadangkan `MEDIA_ROOT` (`/var/lib/alurik/media`, audio/video note); purge Sampah menghapus file sebelum commit (sama dengan media — paritas); file lampiran lama tetap di Nextcloud (belum ada migrasi data; bisa skrip terpisah bila Bapak mau).

## 🟠 Panggilan Nextcloud lampiran note di thread terpisah (fast track) — `claude/nextcloud-thread` — 2026-10-23 (Claude) — DI-MERGE (#91, 34c804f) atas "merge" Bapak 2026-10-23 05:49 WIB; TUNGGU RESTART `taskflow-web`
- **Status:** backend saja (webapp.py), tanpa migrasi, tanpa perubahan frontend/SW. **Deploy: restart `taskflow-web` saja.**
- **Akar masalah:** `upload_note_attachment`, `view_note_attachment`, `delete_note_attachment`, `view_published_attachment` (`/pub/attachments`) dan ekspor DOCX (`export_scratchpad_docx`, `export_scratchpad_docx_live`, resolver gambar mengambil dari Nextcloud) memanggil `requests` sinkron di endpoint `async` → selama Nextcloud memproses, event loop tertahan dan SEMUA request lain (pengguna lain juga) menunggu.
- **Perbaikan:** `_nc_put_file` (MKCOL + PUT) dan semua panggilan Nextcloud di atas lewat `asyncio.to_thread`; `markdown_to_docx` dijalankan di thread (resolver membuka koneksi DB sendiri lewat `get_db()`); view: koneksi + header di thread, badan tetap di-stream Starlette (iterator sinkron → threadpool), respons non-200 ditutup.
- **Verifikasi:** tes baru `tests/test_nextcloud_offloop.py` (5: upload/view/delete/ekspor DOCX/pub — Nextcloud palsu 1,2 dtk, `/api/version` harus selesai < 0,8 dtk sejak request lambat dimulai; kelimanya GAGAL di kode lama); pytest 1167 passed, 1 skipped.
- **Temuan lain (tidak diubah):** `bookmark_extract` (`POST` bookmark) juga memakai `requests.get` sinkron ke URL eksternal di endpoint async; `export_scratchpad_docx_live` mengembalikan traceback sebagai teks dengan status 200 saat galat (pra-ada).
- **Berikutnya:** PR B (permintaan Bapak) — lampiran note baru disimpan di disk VPS, Nextcloud keluar dari jalur upload.

## 🟠 Bug: lampiran gambar 📎 di editor note tampil sebagai teks + tanpa indikator unggah — `claude/note-attach-image` — 2026-10-23 (Claude) — DI-MERGE (#89, f61c3c8) atas pilihan Bapak "Merge #89 saja dulu" 2026-10-23; TUNGGU RESTART `taskflow-web`
- **Status:** frontend saja (tanpa migrasi/endpoint). SW **v465** `taskflow-v465-note-lampiran-gambar`, `app.css?v=363` (v463 dipakai #88, v464 dipakai #90). **Deploy: file statis, lalu restart `taskflow-web` saja.** Bila `main` memakai v465 lebih dulu, naikkan ke nomor kosong berikutnya.
- **Gejala (laporan Bapak):** Edit note → 📎 pilih gambar → tidak ada tanda unggah selama beberapa lama → muncul teks `![nama](/api/scratchpad/attachments/44/view)`, bukan gambar; setelah disimpan tetap teks.
- **Akar masalah:** `NoteToolbar.handleAttachFile` menyisipkan sintaks markdown lewat `tr.insertText` (teks mentah) → serializer Milkdown menyimpannya ter-escape `!\[nama]\(url)`; selama unggah hanya tombol yang dinonaktifkan.
- **Perbaikan:** helper `static/offline/noteattach.js` (`attachmentMarkdown` + escape label, `repairEscapedAttachmentLinks`, `statusText`, `percent`); unggah lewat XHR dengan progres → `.note-upload-status` (spinner, "Mengunggah nama…", %, bar; "Menyimpan nama…" setelah byte terkirim, karena server masih meneruskan ke Nextcloud); sisip lewat `insertParsedMarkdown` (parserCtx + replaceSelection, sama seperti tempel gambar); galat lewat toast (bukan `alert`); `onAttachUploaded` dipanggil sebelum sisip. Note lama yang sudah rusak dipulihkan saat dibuka (`repairNoteMarkdown` = pemulih lampiran + `repairQuoteMarkdown`, dipakai editor + `renderMarkdown`): hanya URL `/api/scratchpad/attachments/N/view`, `[` ber-escape ganjil, label tanpa kurung siku, di luar blok/inline code; tersimpan ulang saat edit nyata berikutnya.
- **Verifikasi:** pytest 1156 (+1 skip); JS 2973/2974 (pra-ada `draw_local_reactive`); inline OK; E2E baru `temporary_files/e2e_note_image_attach.py` **11/11** (WebDAV Nextcloud tiruan + throttle CDP; `main` lama 3/11): indikator + %, `<img>` di editor, isi tersimpan benar, viewer, PDF → tautan, gagal → toast, note rusak lama pulih, 375 px gelap. E2E note list tag 5/5. Review subagen: tidak memblokir; 3 minor diperbaiki (regex tidak merusak tautan benar/kode, `onAttachUploaded` sebelum sisip) + % `aria-hidden`.
- **Berikutnya (keputusan Bapak 2026-10-23: merge #89 dulu, 401 dibahas nanti):** di web tanpa cookie `token` (Firefox Bapak), `<img src=/api/scratchpad/attachments/N/view>` di editor + viewer → 401; viewer menampilkan "📎 nama — tidak tersedia offline" (sudah direproduksi: `ctx.clear_cookies()`). Opsi yang ditawarkan: (a) SW menambah header Authorization untuk permintaan lampiran (disarankan; juga menutup tautan 📄 + file workspace), (b) gambar note dimuat via fetch+Bearer → blob, (c) server memasang ulang cookie (menyentuh aturan logout multi-tab di `/api/auth/refresh`).
- **Temuan lain (tidak diubah):** `upload_note_attachment` / `view_note_attachment` (webapp.py) memakai `requests` sinkron di endpoint `async` → selama meneruskan ke Nextcloud, event loop server tertahan (request pengguna lain ikut menunggu) — kemungkinan penyebab "kekosongan beberapa lama"; kandidat perbaikan backend (`asyncio.to_thread`). Viewer lokal sudah merender isi ter-escape sebagai gambar (berbeda dari laporan Bapak; tidak tereproduksi). Emoji 📄 pada tautan file tampil sebagai gambar rusak di sandbox (plugin emoji memuat CDN). Gambar/tautan disisipkan sebagai blok (memecah paragraf di posisi kursor), sama seperti tempel gambar.
## 🟠 Tampilan tanpa CSS setelah HP restart (internet lambat) → precache shell SW atomik + revalidasi — `claude/sw-precache-shell` — 2026-10-23 (Claude) — DI-MERGE (#90, 059aa81c) atas "merge" Bapak 2026-10-23 04:48 WIB; Deploy Taskflow V4 sukses; TUNGGU RESTART `taskflow-web`
- **Laporan Bapak:** HP restart → buka Alurik (masih login) saat internet lambat → UI tanpa styling. Pertanyaan: apakah Alurik mengunduh ulang filenya tiap pembukaan pertama setelah restart?
- **Akar masalah (dibuktikan kode + simulasi Node + E2E Playwright di main):** `/static/app.css?v=362` tidak ada di `STATIC` sw.js dan `milkdown.bundle.js` tercatat tanpa `?v=289`. Catch-all mencocokkan URL persis, `activate` menghapus cache versi lain → tiap rilis keduanya wajib dari jaringan, gagal → 503 → stylesheet dibuang. Install `Promise.allSettled` + `cache: "reload"`: install bolong tetap aktif dan menghapus cache lama yang lengkap; tiap rilis mengunduh ulang semua precache. Restart memicu karena SW `waiting` aktif saat semua klien tertutup. Login tidak terkait.
- **Fix (sw.js saja + tes):** `STATIC` = shell (semua script/stylesheet lokal index.html dengan URL persis, modul offline, `/`, `/config.js`) dipasang dengan `cache.addAll` atomik (gagal satu → install gagal, SW lama + cache lengkap tetap aktif; `console.warn` lalu dilempar ulang). `OPTIONAL_STATIC` baru (manifest, ikon termasuk favicon `icon-32`, font KaTeX, build tldraw + `TLDRAW_ASSETS`) lewat `allSettled`. Semua request precache `cache: "no-cache"` (revalidasi ETag → 304 untuk file tak berubah). `activate`/`fetch`/banner/server tidak berubah. ADR-029.
- **Penjaga:** `tests/offline/sw_precache_shell.test.js` (aset lokal index.html ⊆ `STATIC` persis; entri `STATIC` ter-track git; tanpa duplikat — `addAll` menolak URL ganda dan akan memblokir SEMUA update; harness install/siklus) ikut CI lewat `tests/test_sw_precache_node.py`. `tests/test_static_revalidate.py` (304 ETag). E2E `temporary_files/e2e_sw_precache_shell.py`: branch 13/13, main 8/13 (gagal persis bug ini).
- **Versi:** SW **v464** `taskflow-v464-sw-precache-shell`; `app.css` tetap v=362. **Deploy:** file statis + `sw_cache` → restart `taskflow-web`. Perlindungan sudah berlaku untuk rilis v464 sendiri.
- **Verifikasi:** npm 2989/2988 (1 pra-ada `draw_local_reactive`); pytest 1162 passed 1 skipped; inline OK; review independen: 0 kritis, 3 penting (duplikat, CI, biaya retry) — dua pertama diperbaiki, ketiga didokumentasikan.
- **Aturan baru untuk agent lain:** file lokal baru yang dimuat `index.html` WAJIB masuk `STATIC` dengan URL persis (query versi ikut); entri `STATIC` harus file ter-track git dan unik. Thread "apa yang baru": bila `static/whatsnew.json` di-precache, patuhi aturan ini. Bila install gagal, banner bisa muncul tanpa SW `waiting` (spec §4) — cakupan thread banner.
- **Bentrok versi:** v464 kini dipakai main. PR #89 (`claude/note-attach-image`, masih `taskflow-v464-note-lampiran-gambar`) dan PR #84 (masih v458) wajib naik ke nomor kosong berikutnya (v465 dst.) sebelum di-merge.
- **Berikutnya:** Bapak `sudo systemctl restart taskflow-web` (agar `/api/version` melaporkan v464), lalu tutup-buka app di HP sekali dengan internet normal supaya SW v464 terpasang lengkap.
- **Tindak lanjut (spec §7):** D self-host font Nunito Sans; E iframe mindmap (`mind-elixir/index.html` + aset ber-query) belum di-precache persis; F `/` dengan ETag + `no-cache` (sekarang tiap pembukaan app & tiap retry install mengunduh ±400 KB gzip; cek bfcache/logout); G build tldraw via rsync `--checksum` agar ETag stabil; H cek `STATIC` di deploy.yml.

## 🟠 Lampiran task/note di web 401 "Not authenticated" tanpa cookie → viewer in-app dengan header auth — `claude/lampiran-tanpa-cookie` — 2026-10-22 (Claude) — DI-MERGE (#88, 890740b0) atas "merge" Bapak 2026-10-22 23:38 WIB; Deploy sukses; TUNGGU RESTART `taskflow-web`
- **Laporan Bapak:** klik lampiran task (tab "Lampiran" halaman Fokus / detail task) di web → tab baru berisi `{"detail":"Not authenticated"}`.
- **Akar masalah:** `openAttachment` di web (API_BASE kosong) memakai `window.open(path)` → navigasi biasa yang hanya terautentikasi lewat cookie httpOnly `token`. Firefox Bapak tidak punya cookie sama sekali untuk situs, sedangkan SPA tetap login lewat `localStorage.tf_token`/`__token` (header Authorization); `/api/auth/refresh` sengaja hanya memasang ulang cookie bila request sudah membawanya, jadi cookie yang hilang tidak pernah kembali. Link lampiran note (`/api/scratchpad/attachments/{id}/view`) kena hal yang sama.
- **Fix (frontend saja, tanpa ubah auth/cookie server):** web → `openAttachment` mengirim event `tf-open-attachment` dengan path RELATIF (tanpa `?token=`) ke `AttachmentViewer` (sudah dipasang global, dulu hanya native). Helper top-level baru `fetchAttachmentResponse(url)`: `Authorization: Bearer <__token>` (dibaca saat fetch), `apiUrl()` hanya untuk path relatif bila API_BASE ada (URL absolut Tauri tidak di-prefix ganda), 401 → "Sesi berakhir — masuk lagi", lainnya "HTTP n". Cabang Tauri dan API_BASE-tanpa-Tauri (`window.open` + `?token=`) tidak berubah. `<a href>` tetap (klik tengah/tab baru = perilaku cookie). Pratinjau tetap lewat `TF.safehtml.attachmentPreview` (gambar png/jpeg/webp/gif, PDF; lainnya "Simpan").
- **Versi:** SW **v463** `taskflow-v463-lampiran-tanpa-cookie`; `app.css` tetap v=362. **Deploy:** file statis → restart `taskflow-web`.
- **Verifikasi:** tes baru `tests/offline/attachment_viewer_web.test.js` (7 tes; 5 gagal sebelum fix, 2 penjaga perilaku Tauri/API_BASE); `npm test` 2973 tes, 2972 pass, 1 gagal pra-ada `draw_local_reactive`; pytest 1156 passed, 1 skipped; inline OK (5 skrip). E2E baru `temporary_files/e2e_attachment_open_web.py` 13/0 (cookie dihapus, prasyarat 401, Fokus → Lampiran → viewer `<img>` blob:, tanpa tab baru, tanpa `token=`, header Bearer, ✕ Tutup); dengan index.html main: gagal (viewer tidak muncul). `e2e_focus_page` 36/0. Lampiran note tidak di-E2E (unggah lewat Nextcloud), dicakup tes node.
- **Sisa (tidak diubah, masih bergantung cookie di web):** File workspace (Pratinjau/Unduh `<a href>` `/api/lists/{id}/files/{fid}/download`), kartu file di chat workspace (sama), link `[📄 nama](/api/scratchpad/attachments/{id}/view)` di isi note (dirender `<a href>` polos), `<img>` note inline (sengaja tidak disentuh). Bila cookie hilang, semuanya 401 di web.
- **Berikutnya:** review → push/PR atas izin Bapak. PR #84 perlu SW v464.

## 🟠 Halaman Fokus: tambah checklist/catatan timeout ("Request timeout — coba lagi") + "Subtask" → "Checklist" — `claude/fokus-checklist-hitungan` — 2026-10-22 (Claude) — DI-MERGE (#87, e012e83b) atas "merge" Bapak 2026-10-22 21:46 WIB; Deploy Taskflow V4 sukses; TUNGGU RESTART `taskflow-web` (route baru)
- **Akar masalah (sudah dibuktikan sebelumnya):** `useFocusTaskCounts` memanggil 3 GET per task dalam cakupan (`/subtasks`, `/notes`, `/attachments`) serentak saat halaman Fokus dibuka (id numerik sengaja ke jaringan, K6 `isTaskChildListCall`). Antrean koneksi browser menahan POST tambah checklist/catatan → AbortController 15 dtk `api.fetch`. Produksi: 345 GET hitungan/jam, nol POST pengguna sampai server.
- **Fix server:** `GET /api/tasks/child-counts?ids=…` (webapp.py, didaftarkan SEBELUM `/api/tasks/{task_id}`) → `{"counts": {"<id>": {sub_total, sub_done, notes, atts}}}`; akses = aturan `_can_access_task` (pemilik task / pemilik atau anggota shared list) dalam SQL berbasis set, tanpa `TaskRepository(...)`; id tak terbaca/tidak ada dilewati; `ids` mentah > 12000 karakter → 400 sebelum dipecah; token non-numerik / 0 / > 18 digit diabaikan, dedupe, > 500 id → 400 (berhenti mengumpulkan di id ke-501). Notifikasi anggota saat checklist ditambah: "menambah item checklist di task …".
- **Fix klien:** id numerik lewat batch, diurutkan numerik lalu dipotong 200 id per request, **tanpa `network: true`** (Alurik target 100% offline). Supaya tidak ditelan rute lokal `GET /api/tasks/:id`: `taskroutes.js` `isTaskChildCountsCall` (diekspor) → `shouldRouteLocally` false; `api.fetch` di index.html juga mengecek `/api/tasks/child-counts` di depan kedua cabang (taskroutes.js lama dari cache SW tetap tidak merutekannya ke lokal). Gagal → tanpa hitungan, tanda `fetchedRef` dilepas (dicoba lagi saat daftar id berubah); cid lokal tetap 3 GET lokal. Aturan merge (angka panel terbuka menang) tidak berubah.
- **SW (sw.js):** cabang khusus `GET /api/tasks/child-counts` sebelum cabang umum `GET /api/*`: network-first; respons ok → hitungan disimpan **per task** di `CACHE` dengan kunci `/api/tasks/child-counts/<id>` (id yang diminta tapi tidak dikembalikan → entrinya dihapus), URL batch TIDAK disimpan (tidak ada pertumbuhan cache per himpunan id); respons non-ok diteruskan tanpa tulis/fallback; jaringan gagal → `{"counts": …}` dirakit dari kunci per task (≥ 1 ditemukan) atau 503 OFFLINE. Jadi badge tetap tampil offline walau himpunan task berubah (task selesai/baru, deadline, tengah malam, potongan bergeser). Kunci sengaja di bawah `/api/` → ikut dihapus pembersihan cache saat logout (index.html).
- **Rename:** checklist (tabel `subtasks`) di halaman Fokus (tab `FOCUS_TABS` "Checklist", aria progres "… item checklist selesai", "Belum ada checklist.", placeholder "Tambah item checklist, tekan Enter", aria "Item checklist baru"), seksi "✅ Checklist" detail task ("Hapus item checklist", "Item checklist baru..."), dan notifikasi anggota workspace. Task anak (`parent_id`, "📌 Subtask", "Judul subtask baru...", form `pendingSubtasks`, dialog "semua subtask selesai") TIDAK diubah; bot.py tidak disentuh.
- **Versi:** SW **v462** `taskflow-v462-fokus-checklist-hitungan` (juga menyegarkan `static/offline/taskroutes.js` di STATIC sw.js); `app.css` tetap v=362. **Deploy:** route baru di webapp.py + file statis → restart `taskflow-web`.
- **Verifikasi:** `tests/test_task_child_counts.py` 12 tes (termasuk paritas dengan endpoint per task untuk tiap pengguna × task saat anggota keluar, dikeluarkan, workspace dihapus; batas 12000 karakter; teks notifikasi); `tests/offline/focus_child_counts.test.js` 12 tes; `tests/offline/sw_child_counts.test.js` 8 tes (harness fetch-event + cache Map); `taskroutes.test.js` +1; `note_trash_routing.test.js` regex bentuk `_local` disesuaikan. Angka suite lengkap: lihat entri SESSION_LOG terbaru. Cek ad-hoc Playwright: 150 task → request /api saat halaman Fokus dibuka 450 (main) → 1; tambah item checklist sampai server ±0,1 dtk; SW aktif, server dimatikan: badge tetap tampil untuk himpunan sama DAN setelah satu task diselesaikan offline (main: tampil; 6c994d91 dengan cache URL persis: hilang; versi ini: tampil).
- **Catatan:** tidak ada loop lain di index.html yang memanggil `/subtasks|/notes|/attachments` per task untuk banyak task — sisanya satu panel/modal terbuka (TaskDetailModal, ModalNotes, ModalAttachments, FocusSubtasks/FocusNotes/FocusAttachments dengan polling 15 dtk selama panel terbuka). Offline, id yang tidak ada di cache per task (mis. belum pernah dimuat online) tidak mendapat badge dan tidak dicoba ulang sampai halaman dibuka lagi (respons 200 parsial bukan kegagalan).
- **Verifikasi koordinator:** repro Playwright 300 task + latensi 150 ms: main 923 request /api, POST checklist 14,5 dtk (hampir kena 15 dtk); branch 20 request, POST 0,16 dtk. Suite ulang: npm 2966/2965 (1 pra-ada `draw_local_reactive`), pytest 1156 passed 1 skipped, inline OK. Review independen: 0 kritis; 1 penting (cache offline per URL batch) + minor sudah diperbaiki.
- **Berikutnya:** Bapak restart `taskflow-web` (route baru; sebelum restart backend lama menjawab child-counts 422 → badge kosong, tambah checklist/catatan tetap lancar) lalu tutup-buka app. PR #84 perlu SW v464 (v463 dipakai `claude/lampiran-tanpa-cookie`).
- **Tindak lanjut opsional (dibahas dengan Bapak 2026-10-22):** gambar/PDF note masih ke Nextcloud (audio/video & lampiran task sudah di VPS); bot Telegram: lampiran task workspace tidak masuk daftar File workspace, tanpa notifikasi anggota, hanya pemilik task yang bisa lampirkan; tombol bot "＋ Subtask" sebenarnya checklist; `backup.sh` tidak menyalin `/var/lib/alurik/media`; 3 PDF uji ter-commit di `uploads/` (belum di `.gitignore`).

## 🟠 Tandai selesai instan (baris task langsung hilang) — `claude/task-selesai-instan` — 2026-10-22 (Claude) — DI-MERGE (#85) atas "merge" Bapak 2026-10-22 16:33 WIB; TUNGGU RESTART `taskflow-web`
- **Laporan Bapak:** centang "Tandai selesai" → toast "Task selesai! ✅" langsung muncul, tetapi baris task bertahan 10–15 dtk di produksi.
- **Akar masalah (dibuktikan Playwright):** `handleDone` / `handleDoneAll` / `handleDoneParentOnly` di `App` memanggil `POST /api/tasks/:id/done` (router lokal, IndexedDB ±0,1 dtk) lalu `fetchAll()` tanpa memperbarui state `tasks`; `fetchAll()` menunggu `sync()` penuh (pull semua domain + push outbox) sebelum `GET /api/tasks`, jadi `setTasks` baru terjadi setelah sync. Jalur offline sudah optimistik, jalur online belum.
- **Fix (frontend saja):** helper top-level `markTasksDoneLocal(prev, ids, now)` (id dibanding via `String`, set `gtd_status: "done"`, `completed_at`, `is_overdue: false` seperti router lokal/server). Ketiga handler memanggil `setTasks(prev => markTasksDoneLocal(prev, ids))` setelah panggilan done sukses dan sebelum `fetchAll()` (tetap tidak di-await, rekonsiliasi di latar). "Done semua" menandai induk + semua subtask. Toast tidak berubah. SW **v461** `taskflow-v461-task-selesai-instan` (awalnya v459; dinaikkan saat memuat main v460 dari #86; v458 dipakai #84 yang masih terbuka); `app.css` tidak berubah (ikut main, v=362). Deploy: file statis → restart `taskflow-web`.
- **Verifikasi:** tes baru `tests/offline/task_done_instant.test.js` (4 tes, 4 gagal sebelum fix); `npm test` 2928 tes, 2927 pass, 1 gagal pra-ada `draw_local_reactive`; `python -m pytest tests/ -q` 1142 passed, 3 skipped; `check_inline_scripts.js` OK (5 skrip). E2E baru `temporary_files/e2e_task_done_instant.py` 28 langkah (Fokus Hari Ini pribadi + workspace, Next pribadi + workspace, "Done semua", "Parent saja"; semua request `/api/**` ditahan Playwright saat centang): kode lama 7 gagal (baris masih ada > 1 dtk), dengan fix 0 gagal 2× berturut-turut (baris hilang ±25–70 ms).
- **Catatan lingkungan:** `npm test` butuh `npm ci` (fake-indexeddb) dan `tests/offline/safehtml_parity.test.js` memanggil `python3` dari PATH → jalankan dengan venv berisi dependensi webapp di depan PATH, kalau tidak gagal palsu (`No module named 'pytz'`). Di E2E, Playwright sync hanya memproses handler `route` saat dipompa → tunggu dengan `page.wait_for_timeout`, bukan `time.sleep`.
- **Berikutnya:** Bapak: `sudo systemctl restart taskflow-web`, lalu tutup-buka aplikasi. PR #84 masih memakai v458 (< main) → perlu dinaikkan ke nomor kosong berikutnya (v464; v462 dipakai `claude/fokus-checklist-hitungan`, v463 dipakai `claude/lampiran-tanpa-cookie`) sebelum di-merge.
## 🟡 Halaman Fokus: kartu Pomodoro ringkas di HP — `claude/fokus-hero-mobile` — 2026-10-22 (Claude) — DI-MERGE (#86, e3468ec) 16:30 WIB, DEPLOY WORKFLOW SUKSES; TUNGGU RESTART `taskflow-web`
- **Status:** frontend saja. SW **v460** `taskflow-v460-fokus-hero-mobile`, `app.css?v=362` (main v458/361; v459 dipakai draft #85 `claude/task-selesai-instan`). **Deploy:** file statis → restart `taskflow-web`.
- **Isi (desain Bapak 2026-10-22, HP ≤ 768 px; desktop & bar ringkas tidak berubah):** grid 4 kolom — baris atas tab mode + durasi (25m/5m/15m) | Zen | pil 🎧 (label kata pertama; popover radio suara + volume, panah/Esc/ketuk luar, aria-live); tengah lingkaran 72 px | tombol + baris task aktif (titik, judul, "✓ Selesai" = `handleTaskDone`); statistik "Pomo • Fokus • Set" + project; parkir ✨ + placeholder pendek (13 px) + tombol kirim (tidak menutup keyboard). Disembunyikan di HP: judul/subjudul, hitungan 🍅 (keputusan Bapak), kontrol suara inline. < 370 px: Stop/Lewati ikon, tab & pil rapat. Waktu > 6 karakter (overtime ≥ 1 jam) mengecil.
- **Verifikasi:** `npm test` 2940/2941 (pra-ada `draw_local_reactive`); pytest 1144 passed; `check_inline_scripts` OK; E2E baru `temporary_files/e2e_focus_hero_mobile.py` 148/0 (393/375/340 px × terang/gelap × diam/aktif/berjalan/waktu habis/istirahat, Brown Noise/Detak Jam, mode Long, Selesai, kirim, desktop tetap); `e2e_focus_ambient` 99/0 (HP lewat popover), `e2e_focus_page` 36/0, `e2e_focus_target` 41/0, `e2e_focus_overtime` 98/0, `e2e_focus_filter` 115/0, `e2e_android_notification` 40/40. Review subagen: 3 temuan penting (Zen menumpuk tab di 370–407 px saat label suara panjang; placeholder terpotong; label "Istirahat panjang" melenceng) + beberapa minor sudah diperbaiki.
- **Sisa minor:** placeholder dipilih saat render (rotasi layar tanpa render ulang bisa tetap versi lama); urutan Tab baris atas (Zen, pil, tab) beda dari tampilan; tombol Selesai 28 px.

## 🟡 Halaman Fokus: redesign bar filter + kelompok sebagai kartu, ⭐ duotone — `claude/fokus-filter-redesign` — 2026-10-22 (Claude) — DI-MERGE (#83, fdfb4ef) 15:02 WIB, DEPLOY WORKFLOW SUKSES; TUNGGU RESTART `taskflow-web`
- **Status:** frontend saja (CSS + urutan elemen `FocusFilterBar`/`FocusTaskGroups`; logika filter tidak berubah). SW **v458** `taskflow-v458-fokus-filter-redesign`, `app.css?v=361` (main v457/360). **Deploy:** file statis → restart `taskflow-web`.
- **Isi (desain Bapak 2026-10-22):** bar filter = satu kartu `.focus-filter-card` (container query `focusfilter`): ≥ 1000 px satu baris (tab · cari · chip · pembatas · tombol Filter, badge di pojok), 600–999 px dua baris, HP tiga baris (badge di dalam tombol); ≥ 2 pil / pil panjang → `.is-dense` tetap dua baris supaya Reset tidak terpotong; angka tab = badge bulat, Terlambat merah muda. Lembar filter dirender di luar kartu (container query = containing block untuk `position: fixed`). Kelompok = kartu, judul berlatar lembut + pil "N task" (HP: angka saja), baris dipisah bayangan inset (border-top/left dilarang `task_date_prompt.test.js`); desktop ≥ 1024 px baris satu garis (chip `flex: 0 0 auto`, rata kanan). ⭐ duotone (garis + isian .22; aktif garis zaitun + isian lime). Tombol Fokus & pil status tidak berubah (keputusan Bapak).
- **Verifikasi:** `npm test` 2929/2930 (pra-ada `draw_local_reactive`); `focus_filter_ui.test.js` 53/53; pytest 1144 passed; `check_inline_scripts` OK; E2E `e2e_focus_filter.py` 115/0 (2×; langkah l4b kini menunggu cleanup efek pemulih overflow — race pra-ada), `e2e_focus_page` 36/0, `e2e_focus_target` 41/0; screenshot 1440/1000/375 terang + gelap. Review subagen: 2 temuan penting (Reset terpotong dengan ≥ 2 pil; chip baris desktop membungkus) sudah diperbaiki + kontras badge tab, aturan ⭐ gelap ganda, hover baris.
- **Sisa minor:** urutan Tab di HP (tombol Filter setelah chip secara DOM); di viewport > 768 px dengan konten sempit (< 600 px kartu) panel filter muncul di tepi kanan bar, ±100 px di bawah tombol; breakpoint baris task pakai viewport, bar pakai lebar kartu.

## 🟠 Pindah task pribadi ke workspace — `claude/project-thread-we0hl7` — 2026-10-22 (Claude) — DI-MERGE (#82) atas "merge dan deploy" Bapak; TUNGGU RESTART `taskflow-web`
- **Permintaan Bapak:** task eksisting bisa dipindahkan dari task pribadi ke task workspace.
- **Backend:** `PATCH /api/tasks/{id}/workspace` `{list_id}` (ADR-028). Pemilik saja, task pribadi tingkat atas (sub-task → 400 "ikut induknya"), bukan anggota → 403. Task + seluruh child pribadi milik pengguna ikut pindah; `project`/`context` di-resolve ulang per nama di scope workspace (NOCASE, dibuat bila belum ada); `assigned_to` NULL; `updated_at` di-bump (pull klien mengadopsi); lampiran dicatat di `workspace_files` (source `task`); notifikasi anggota. Respons = baris task + `moved_ids`. Tanpa migrasi.
- **Frontend:** helper top-level `moveTaskToWorkspace` (dorong outbox → id server via `TF.idmap.serverIdOf` bila id masih cid → PATCH → `__syncNow`). `TaskDetailModal`: tombol "Pindah ke Workspace" (ikon users) bila task pribadi & bukan sub-task; panel border netral 1px berisi select workspace + keterangan + Batal/Pindahkan; online saja. Tanpa garis warna.
- **Versi:** SW **v457** `taskflow-v457-task-pindah-workspace` (v456 dipakai #81, sudah di-merge ke branch); `app.css` tidak berubah (v=360).
- **Verifikasi:** `tests/test_task_move_workspace.py` 5 tes; `tests/offline/task_move_workspace.test.js` 6 tes; pytest penuh dan `npm test` (1 gagal pra-ada `draw_local_reactive`); E2E `temporary_files/e2e_task_move_workspace.py` 5/5 (screenshot di project files `pindah-task-workspace/`).
- **Deploy:** route baru di webapp.py → **restart `taskflow-web`** setelah merge.
- **Belum:** pindah balik workspace → pribadi / antar workspace tidak disediakan (sengaja).

## 🟠 Halaman Fokus: pemilihan task (Target ⭐, tab waktu, cari, chip, filter tersembunyi, kelompok Workspace › Project) — `claude/fokus-filter` — 2026-10-22 (Claude) — DI-MERGE (#81, 7072a1a) 09:42 WIB, DEPLOY WORKFLOW SUKSES (percobaan ke-2); TUNGGU RESTART `taskflow-web`
- **Status:** frontend saja (tanpa migrasi/endpoint/skema). SW **v456** `taskflow-v456-focus-filter`, `app.css?v=360` (main v455/359 = #80; satu-satunya PR terbuka lain #25 basi di v412). Branch memuat `origin/main` b84f357 lewat merge commit (konflik hanya `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md`, ekor `static/app.css`; kedua sisi dipertahankan). ADR-027 di `DECISIONS.md`. Spec `docs/superpowers/specs/2026-10-22-fokus-filter-task-design.md` dan rencana `docs/superpowers/plans/2026-10-22-fokus-filter-task.md` sudah disinkronkan dengan keputusan implementasi. **Deploy: file statis saja → restart `taskflow-web`** (`sw_cache`); bot tidak perlu restart.
- **Isi:** modul murni `static/offline/focusfilter.js` (`TF.focusfilter`: `inTodayScope`/`timeBucket` dengan tanggal lokal, `normalizeFilter`, `matches`, `timeCounts`/`statusCounts`/`hiddenByStatus`, `projectOptions`, `groupTasks`, `comparePriority`, `splitTarget`, baca/tulis storage) dipakai Sidebar, Dashboard, `getFilteredTasks("today")`, dan halaman Fokus. Halaman Fokus: seksi **Target hari ini** (task aktif + ⭐, tidak tersaring), bar filter (tab Semua/Hari ini/Terlambat, cari "Cari judul task…", chip P1 P2 P3 Q1 Q3, pil filter tersembunyi, Reset), lembar **Filter lainnya** (Status default Next, Prioritas, Kuadran, satu Workspace › Project; HP = lembar bawah ≤ 768 px, desktop = panel di bawah tombol), kelompok Workspace › Project yang bisa dilipat, catatan "N task berstatus lain disembunyikan · Tampilkan", tombol ⭐ di baris task. Filter dan kelompok terlipat diingat per perangkat (`tf_focus_filter`, `tf_focus_collapsed`, tidak dihapus saat logout); kata cari tidak disimpan.
- **Keputusan saat implementasi (dicatat di spec):** (1) ⭐: `aria-label` konstan "Target hari ini" + `aria-pressed`, teks aksi di `title`. (2) Task berulang yang punya kejadian hari ini keluar dari pool "Task hari ini" (tampil di "Berulang hari ini"); Target tidak terpengaruh. (3) Hitungan Zen = Target ∪ pool ∪ "Berulang hari ini" tampil, minus task aktif, tak terpengaruh filter. (4) Lembar filter ditutup bila bar tidak dirender (memuat, kosong, Zen). (5) `FocusFilterBar` menerima `children` (lembar), `zenClass`, `zenHidden`. Seksi Target tanpa task aktif disembunyikan seluruhnya di Zen.
- **Verifikasi (head 8ac3430):** `npm test` 2918 tes, 2917 pass, 1 gagal pra-ada (`draw_local_reactive`; fokus: `focusfilter.test.js` 75 + `focus_filter_ui.test.js` 47, semua hijau); `python -m pytest tests/ -q` 1139 passed + 1 skip; `check_inline_scripts.js` OK (5 skrip). E2E baru `temporary_files/e2e_focus_filter.py` **115 langkah** (skenario a–n + Zen tanpa task aktif di Target; angka harapan dihitung di Python dari `GET /api/tasks`, bukan dari JS app), 3× hijau berturut-turut; run dengan 4 perilaku sengaja dirusak gagal di 11 langkah. Regresi: `e2e_focus_page.py` 36/36, `e2e_focus_target.py` 41/41 (3×), `e2e_android_notification.py` 40/40, `e2e_focus_overtime.py` 98/98 (run ke-2; run ke-1 gagal di b5–b7 `+25:05`, flake pra-ada yang diketahui). Screenshot terang + gelap, desktop + 375 px (daftar default, lembar terbuka, pil aktif, pesan kosong) di `temporary_files/e2e_focus_filter/` (di-.gitignore).
- **Catatan E2E:** latar lembar menutupi halaman, jadi Work dimulai lewat klik programatik saat lembar terbuka. App menolak Mulai tanpa task aktif ("Pilih satu task terlebih dahulu…"), jadi "Zen tanpa task aktif di Target" diuji dengan menyelesaikan task aktif lewat API saat Work berjalan (kelas `is-zen-hidden` ada di `section.focus-section` pembungkus `.focus-target`). Dua E2E lama diperbaiki, bukan kode produk: `e2e_android_notification.py` mengunci nama cache SW v450 (basi sejak v451) → kini dibaca dari `static/sw.js`; `e2e_focus_target.py` langkah e0 membaca `tf_pomo_state` tepat saat DOM berubah (efek React menulisnya ±11 ms kemudian; pra-ada, ±40% pada `main` juga) → menunggu `workStartedAt` tersimpan.
- **Sisa diketahui (minor):** di layar sempit nama workspace panjang memakan baris judul kelompok dan opsi project di lembar (project terpotong elipsis, mis. "Tim Marketing Kampanye Akhir Tahun 2026 · K…"); chip Q2/Q4 praktis selalu menghasilkan daftar kosong (pool = Q1 ∪ terlambat ∪ hari ini; P1/P2 urgent = Q1, P3/P4 urgent = Q3, jadi Q2/Q4 hanya muncul bila `quadrant` tersimpan basi; task Q2/Q4 yang ⭐/aktif ada di Target yang tidak tersaring); halaman lain yang masih memakai `is_overdue` bisa berbeda beberapa jam di sekitar tengah malam (ADR-027).
- **Review akhir (model terkuat) + gelombang perbaikan 8ac3430:** siap merge. Diperbaiki: `:hover` hanya di `@media (hover: hover)` + border aksen `.is-on` gelap (hover lengket di Android), `focus({preventScroll:true})` di helper fokus, `aria-controls` hanya saat kelompok terbuka, pin cache v444 basi di `e2e_focus_ambient.py` (kini dibaca dari `sw.js`, 87/0), status header spec + catatan §8 (⭐ `is_focused` dipakai bersama anggota workspace).
- **Tindak lanjut (di luar PR):** kunci `tf_focus_filter`/`tf_focus_collapsed` per user (kini bertahan lintas logout, sesuai spec §5.4); ⭐ optimistik (kini menunggu sync 1–3 dtk); `useFocusTaskCounts` hanya untuk task yang tampil; pindahkan pembaca `is_overdue` lain ke `timeBucket`; trap Tab lembar vs SearchModal (desktop); pin cache basi lain mis. `e2e_note_media.py` v429.
- **Deploy:** workflow Deploy Taskflow V4 percobaan 1 gagal karena batas waktu 10 menit `appleboy/ssh-action` (biasanya ±50 dtk; PR ini tidak mengubah package/requirements/draw-app/compile.js — lambat di VPS), dijalankan ulang sekali → sukses (±6 menit). Bila deploy berikutnya juga lambat, cek jaringan/npm/pip di VPS atau naikkan `command_timeout`.
- **Berikutnya:** Bapak: `sudo systemctl restart taskflow-web`, lalu tutup-buka aplikasi di HP. Tindak lanjut di atas bila diminta.

## 🟠 Komentar Note: tooltip format & "Komentari" saling menindih di editor — `claude/komentar-bubble-overlap` — 2026-10-22 (Claude) — DI-MERGE (#80, dab39a3) 06:10 WIB, DEPLOY WORKFLOW SUKSES; TUNGGU RESTART `taskflow-web`
- **Laporan Bapak:** memilih kata/kalimat di editor note memunculkan tooltip format (B, I, S, <>) dan gelembung "Komentari" yang saling menindih.
- **Akar masalah (dibuktikan Playwright):** tooltip Milkdown (`TooltipProvider`, z-index 11000) dan `CommentSelectionBubble` (fixed, `r.top - 44`) sama-sama memosisikan diri di atas seleksi tanpa koordinasi; gelembung tertutup tooltip (rect bertumpuk).
- **Fix (frontend saja):** `MilkdownEditor` prop baru `onCommentSelection` (ref) → tombol "Komentari" + pemisah di dalam tooltip format, tampil hanya bila host memberi handler dan bukan UI sentuh. `NoteModal` meneruskan handler bila `cmtNote` (note workspace); gelembung di NoteModal kini `touchOnly` (HP tetap bar bawah). Pembaca (NotePanel) tidak berubah. CSS `.milkdown-tooltip-sep`, `.milkdown-tooltip-cmt`. SW **v455** `taskflow-v455-komentar-tooltip`, `app.css?v=359`. Deploy: file statis → restart `taskflow-web`.
- **Verifikasi:** tes baru `tests/offline/comment_editor_tooltip.test.js` (5 gagal sebelum fix); `npm test` 2795 pass, 1 gagal pra-ada `draw_local_reactive`; pytest 1139 passed; inline OK; E2E komentar 89/89 (langkah baru 6c4).
## 🟠 Komentar Note PR 3: UI — `claude/komentar-note-ui` — 2026-10-21 (Claude) — DI-MERGE KE MAIN; TUNGGU RESTART `taskflow-web`
- **Status:** frontend saja (tanpa backend/migrasi). Basis `main` b4d6495 (#74, #76 sudah digabung), commit cf220ab..7ef4c8f + dokumentasi. **Deploy: file statis saja → restart `taskflow-web`** (`sw_cache`). SW **v454** `taskflow-v454-komentar-ui`, `app.css?v=358` (v452/v453 dan app.css 357 dipakai #77/#78), `app.css?v=357` (rencana menyebut v449/354; dipakai nomor kosong berikutnya setelah main). Spec `docs/superpowers/specs/2026-10-21-komentar-note-design.md` (§7 diperbarui, §9 PR 3 selesai), rencana `docs/superpowers/plans/2026-10-21-komentar-note-ui.md`. Belum push.
- **Isi:** helper murni `commentui.js` (viewModel, hak aksi, relTime, kandidat mention, kutipan, `requestOpen`/`consumeOpen`) dan `commenthighlight.js` (sorotan lewat CSS Custom Highlight API, tanpa Decoration ProseMirror dan tanpa rebuild Milkdown; di browser tanpa dukungan sorotan mati, panel tetap jalan). Panel `NoteCommentsPanel` + hook `useNoteComments` (SSE, baca-tandai, offline "Menunggu sinkron"), gelembung "Komentari" + chip kutipan, komentar di pembaca (NotePanel; klik sorotan → aktif hanya di pembaca) dan editor (NoteModal). Panel samping bila lebar host ≥ 760px di pembaca / ≥ 900px di editor, selain itu lembar bawah. Header editor ≤768px: pil ikon + angka, baris aksi wrap. Badge komentar di daftar catatan. Klik notifikasi → event `tf:comments-open` + permintaan buka kedaluwarsa 30 dtk. Note lokal "Note not found" dianggap akses hilang (panel kosong, stream ditutup, tanpa toast).
- **Verifikasi:** `npm test` 2732 tes, 2731 pass, 1 gagal pra-ada (`draw_local_reactive`); `python -m pytest tests/ -q` 1072 passed; `node temporary_files/check_inline_scripts.js` OK (5 skrip); E2E `temporary_files/e2e_komentar_note.py` 77/77 (10 skenario, dua akun, 1360 px + 375 px terang/gelap, 3× hijau). E2E menemukan 1 bug (panel anggota tetap menampilkan komentar setelah note dipindah ke pribadi) → diperbaiki a478c02. SDD 7 task, review per task. **Perbaikan review akhir** (`.superpowers/sdd/2026-10-21-komentar-note-ui/final-fix-report.md`): kutipan lintas paragraf (pemisah `\n` virtual antar blok di `collectSegments`), badge daftar ikut diperbarui (`tf:comments-changed` `source:"local"` setelah baca/mutasi/pull SSE; NotesPage refetch debounce 500 ms), pembaca di bawah editor tanpa SSE sendiri (`live`), ToC melayang bergeser saat panel samping terbuka (`--cmt-side-w`), komposer nonaktif setelah akses hilang ("Kamu sudah tidak punya akses ke catatan ini."), spec §7 diperbarui. Setelahnya: npm test 2740/2741 (pra-ada `draw_local_reactive`), pytest 1072, inline OK, E2E 88/88.
- **Sisa diketahui:** backend tidak memancarkan `comments_access_lost` saat note di-unshare/dipindah (anggota baru tahu setelah sync, komentar lama sempat tampil dari cache lokal); `gone` tidak reset bila note sama dibagikan ulang; reload komentar di setiap event sync tanpa filter `note_ids` (M-2); "hari lalu" memakai waktu berlalu; klik pembaca belum melewati `[data-wiki-title]`/`[data-drawing-preview]`/`[data-media-card]`; panel samping jadi lembar terbuka saat host menyempit; lembar tanpa fokus trap; POST baca gagal tidak diulang; `consumeOpen` saat mount hanya cocok `note.id` (bukan `server_id`); tes `noteGone` hanya sumber; filter console error E2E sempit.
- **Berikutnya:** push + PR; permission per halaman (spec terpisah); backend `comments_access_lost` saat note di-unshare/pindah (PR backend kecil).
## 🟠 Slash menu note: tutup dengan Esc / klik di luar (+ "/" sisipan "+" ikut hilang) — `claude/slash-menu-dismiss` — 2026-10-21 (Claude) — DRAFT PR #78; TUNGGU REVIEW
## 🟠 Email Fase 0b: mailer andal (outbox + retry, email HTML, kartu Admin) — `claude/email-fase0b` — 2026-10-21 (Claude) — DI-MERGE (#77, 67d578c) 05:40 WIB, DEPLOY WORKFLOW SUKSES; TUNGGU RESTART `taskflow-web`
- **Status:** backend + frontend. SW **v453** `taskflow-v453-email-mailer`, `app.css?v=357` (v448–v452 / 354–356 dipakai #74–#78; branch sudah memuat main sampai #78). **Deploy: tabel baru `email_outbox` dibuat saat start → restart `taskflow-web` saja** (bot tidak perlu restart). ADR-026. Spec `docs/superpowers/specs/2026-10-21-email-fase0b-mailer-design.md`, rencana `docs/superpowers/plans/2026-10-21-email-fase0b-mailer.md`. Bila `main` memakai v453 lebih dulu, naikkan ke nomor kosong berikutnya.
- **Isi:** `mailer.py` (transport SMTP `starttls|ssl|none`, multipart teks+HTML, klasifikasi error sementara/permanen, password disaring dari pesan error); `email_templates.py` (reset password + email tes, HTML ter-escape, tautan non-http ditolak); `email_outbox.py` (tabel `email_outbox`, `enqueue`, `EmailWorker` thread polling 30 dtk maks 20 baris, retry +1/+5/+30/+120 menit lalu `failed` pada percobaan ke-5, error permanen langsung `failed`, email reset kedaluwarsa 50 menit, `recover_stale` mengembalikan `sending` → `queued` saat start, pembersihan > 30 hari); worker di-start di `startup()` webapp; `/api/auth/forgot` antre di transaksi yang sama dengan token (respons tetap generik, batas 3/jam tetap); endpoint admin `GET /api/admin/email/status`, `POST /api/admin/email/test` (maks 5/jam global, 429), `POST /api/admin/email/{id}/retry`; subjek/isi tidak pernah keluar dari API, penerima tersamar (`hi***@jatahku.com`). UI: kartu "Email" di halaman Admin (badge mode: dev / SMTP / worker mati, ringkasan 7 hari, kirim email tes + polling + toast, tabel 20 email terbaru → daftar kartu di layar sempit, "Coba lagi" untuk `failed`); logika murni `static/offline/emailadmin.js`. Dev mode (tanpa `SMTP_HOST`) tetap mencetak `[MAILER DEV MODE]` dan menandai baris `sent`.
- **Verifikasi:** pytest `tests/` **1086 passed**; JS `npm test` **2649/2650** (1 kegagalan pra-ada `draw_local_reactive`); `check_inline_scripts` OK (5 skrip); E2E `temporary_files/e2e_admin_email.py` **10/10** (badge dev mode; email tes → toast + baris "Terkirim" ≤ 30 dtk; non-admin tanpa menu/kartu + API 403; "Lupa password" → baris "Reset password" tersamar; baris `failed` dibuat lewat sqlite → "Coba lagi" → Terkirim setelah reload; tema gelap; 375 px terang + gelap `scrollWidth` 375). Screenshot `temporary_files/e2e_admin_email/` (di-.gitignore). SDD 7 task + review per task.
- **Review akhir (opus) → perbaikan:** email tes langsung `failed` pada error pertama (kartu menampilkan error, bukan "masih dalam antrean"); isi email dikosongkan saat `sent`/`expired` (link reset tidak tersimpan 30 hari); `SMTP_TIMEOUT`/`SMTP_PORT` kosong tidak membuat crash; contoh Exim `.env.example` memakai hostname publik; `/api/auth/forgot` merender email sebelum menyimpan token (gagal render → respons generik, tanpa token/baris).
- **Sisa diketahui (minor, ditunda):** (1) transport: `QUIT` gagal setelah kirim sukses dianggap sementara → kemungkinan email ganda; `raise from e` menyimpan `__cause__` tak disaring (worker hanya mencatat `str(e)`); `to_addrs` memakai string header To (display name merusak RCPT); `ValueError` build_message deterministik tetap di-retry 5×; (2) worker: crash saat percobaan ke-5 lalu recover → bisa percobaan ke-6; `wake()` setelah `stop()` menyalakan thread lagi; error DB setelah klaim membuat baris `sending` sampai restart (diterima spec); `log.exception` jalur exception tak dikenal mencatat traceback tanpa penyaringan; (3) template: URL berisi spasi/newline lolos `_check_http_url`; CTA hilang diam-diam bila hanya label atau url terisi; (4) admin: hitung+sisip batas email tes tidak atomik (admin saja); (5) frontend: `startPoll` tanpa penghitung generasi (tak terjangkau saat ini); warna hex terang + override gelap alih-alih variabel CSS; `/*#__PURE__*/` tidak ada pada createElement baru; (6) celah tes: konteks TLS, SSLCertVerificationError / SMTPDataError 4xx / SMTPConnectError / `SMTP_FROM` tak valid / `SMTP_SECURITY` tak dikenal, atomisitas enqueue+token, escape host di `smtp_test`; probe port roundtrip rawan flake; DECISIONS.md ada baris kosong ganda sebelum ADR-026.
- **Checklist setelah merge (oleh Bapak, saat memilih layanan SMTP):** (1) pilih layanan, verifikasi domain pengirim (yatno.web.id sekarang atau alurik.com setelah pindah); (2) DNS di Cloudflare: **SPF** (`v=spf1 include:<layanan> ~all`, gabungkan dengan SPF yang ada, hanya satu record SPF), **DKIM** (record dari layanan), **DMARC** (`_dmarc` → `v=DMARC1; p=none; rua=mailto:<alamat>` dulu, naikkan ke `quarantine` setelah aman); (3) isi `.env` di `/home/yatno/todo-system/taskflow-v4/.env`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM="Alurik <noreply@domain>"`; (4) `sudo systemctl restart taskflow-web` → Admin → kartu Email → badge hijau → "Kirim email tes" → cek inbox (dan spam); (5) saat pindah ke alurik.com: perbarui `SMTP_FROM` dan `WEBAPP_URL`, ulangi langkah 2 untuk domain baru.
## 🟠 Slash menu note: grid 2 kolom + label grup + item Wikilink + ikon gaya Alurik — `claude/slash-menu-grid-wikilink` — 2026-10-21 (Claude) — DRAFT PR #73; IKON DITAMBAHKAN (perlu review ulang), TUNGGU "merge dan deploy"
## 🟠 Slash menu note: tutup dengan Esc / klik di luar (+ "/" sisipan "+" ikut hilang) — `claude/slash-menu-dismiss` — 2026-10-21 (Claude) — DI-MERGE (#78, 8724d3f) 05:25 WIB, DEPLOY WORKFLOW SUKSES; TUNGGU RESTART `taskflow-web`
- **Status:** frontend saja (tanpa migrasi/endpoint). Branch di-push, PR belum dibuat. SW **v452** `taskflow-v452-slash-menu-dismiss` (awalnya v449; `origin/main` cb9ed2b — #74, #75, #76, v451 / `app.css?v=356` — di-merge ke branch, lalu dinaikkan ke v452); `app.css` tidak berubah oleh branch ini (tetap `?v=356` dari `main`). Deploy: file statis, lalu restart `taskflow-web` saja. Bila `main` sudah memakai v452 saat merge, naikkan ke nomor kosong berikutnya.
- **Laporan Bapak:** menu slash yang dibuka tombol "+" block handle tidak bisa ditutup selain dengan memilih item; harusnya Esc / klik di luar menutup menu dan "/" hilang.
- **Akar masalah (dibuktikan Playwright sebelum fix):** `SlashProvider` (@milkdown/plugin-slash) hanya menilai ulang di view update (debounce 200 ms; `shouldShow` bawaan = karakter terakhir sebelum kursor "/" + editor fokus). Klik di luar editor (blur) tidak membuat transaksi → menu tetap `data-show=true`; Esc tidak ditangani siapa pun (diteruskan ke window). Klik teks lain di editor memang menyembunyikan menu (selection berubah) tetapi "/" sisipan "+" tertinggal. Repro di kode lama: E2E baru 27 FAIL (Esc → menu tetap, "/" tetap; klik luar → menu tetap; Escape sampai ke listener window).
- **Fix (`MilkdownEditor`, static/index.html):** helper murni top-level `isPlusSlashIntact(doc,pos)` (paragraf berisi tepat "/"), `nextSlashDismissState` (reducer state plugin: `plusPos` dipetakan lewat `mapResult(pos,1)`, terhapus → null; `dismissed` bertahan sampai doc berubah / selection diset), `shouldShowSlashMenu(content, st)`, `isSlashOutsideTarget(target, menu, keepEls)`. Plugin `$prose` `note-slash-dismiss` (di-`.use` tepat sebelum `slashPair`): state + `handleKeyDown` Esc hanya bila menu tampil → `stopPropagation` + `dismissSlashMenu` + return true. `dismissSlashMenu`: `provider.hide()`, hapus "/" di `plusPos` bila masih utuh, meta `{plusPos:null, dismissed:true}`. `SlashProvider` diberi `shouldShow` yang menghormati `dismissed` (menu tak muncul lagi lewat debounce / transaksi berikut; "/" ketikan pengguna tetap). Listener `pointerdown` capture di `document` dipasang di view slash, dilepas di destroy; target di dalam menu (item, scroll) atau block handle bukan "di luar". `onBlockAdd` mencatat `plusPos` (meta) dan membuang "/" sisipan "+" sebelumnya yang masih utuh bila "+" ditekan lagi saat menu terbuka.
- **Review fix (commit ke-2, review independen eccbb5d):** (1) batal "+" (Esc / klik luar / "+" dua kali) kini menghapus paragraf buatan "+" utuh lewat `plusSlashRemovalRange` ($p.before()..$p.after(); bila satu-satunya anak induknya → hanya "/") — sebelumnya paragraf kosong tersimpan sebagai `<br />` ("Satu\n\nDua" → "Satu\n\n<br />\n\nDua"); kursor ke akhir blok di atas (`TextSelection.near(…, -1)`), Esc `view.focus()`, klik luar tidak merebut fokus. (2) Esc dalam debounce 200 ms ditangani (`isSlashMenuPending` = `shouldShowSlashMenu(getContent, state)`) → ditandai dismissed. (3) autocomplete NoteModal (listener capture pmDom: AI/tag/task/wiki) memanggil `e.preventDefault()` saat memakai Esc; plugin slash melewati `e.defaultPrevented`. TaskFormModal: Esc dropdown-nya ditangani di `<input>` sendiri (bukan pmDom) → tidak bentrok, tidak diubah. (4) pengecualian klik luar hanya `addBtn` (⋮⋮ menutup menu).
- **Verifikasi (setelah review fix):** `node --test tests/offline/note_slash_menu_dismiss.test.js` 21/21; `npm test` (venv di PATH) 2552/2553 — gagal pra-ada `draw_local_reactive`; `python -m pytest tests/ -q` 1016 passed + 2 skip; `check_inline_scripts.js` OK; E2E `e2e_slash_menu_dismiss.py` 56/56 (baru: dokumen = semula + kursor di akhir blok asal, Ctrl+Z wajar, Esc < 200 ms, klik ⋮⋮, konten tersimpan "Satu\n\nDua" utuh setelah "+"→Esc / "+"→klik luar di tengah & akhir dokumen; terhadap index.html eccbb5d 12 FAIL termasuk `<br />`); regresi `e2e_slash_menu_grid.py` 39/39.
- **Review fix ke-2 (re-review 9db3981):** batal "+" kini **memulihkan persis dokumen sebelum "+"**: state plugin menyimpan `orig` (doc sebelum "+", meta dari `onBlockAdd`); dibuang bila ada suntingan selain `appendTransaction` (paragraf trailing kosong dsb.) atau "/" hilang. `removePlusSlash` → `docRestoreRange(orig, doc)` (diff `findDiffStart/End` + koreksi overlap) → `tr.replace(start, endB, orig.slice(start, endA))`, jaminan `replaceWith` penuh bila belum `eq`. Memperbaiki (1a) "+" di paragraf trailing kosong → paragraf kosong tambahan `<br />` per batal, dan (1b) "+" di item list pertama memecah list (bullet/ordered/task) → tersimpan `* a\n\n- b`, `1) n2`, dll. Cadangan bila `orig` tak ada: hapus paragraf "/" seperti sebelumnya. Kursor: `near(map(pos - 1, -1), -1)` = akhir blok asal. `MB.canJoin` tidak ada di bundle → tidak dipakai (pemulihan diff lebih umum).
- **Verifikasi (setelah review fix ke-2):** `node --test tests/offline/note_slash_menu_dismiss.test.js` 28/28; `npm test` (venv di PATH) 2559/2560 — gagal pra-ada `draw_local_reactive`; `python -m pytest tests/ -q` 1016 passed + 2 skip; `check_inline_scripts.js` OK; E2E `e2e_slash_menu_dismiss.py` 74/74 (baru: seksi `l` — paragraf trailing kosong, item pertama bullet/ordered/task × Esc / klik luar / "+" dua kali → innerHTML editor persis semula, "+" kedua memulihkan list dulu; konten tersimpan = acuan); terhadap index.html 9db3981 10 FAIL (list terpecah, `<br />` bertambah); regresi `e2e_slash_menu_grid.py` 39/39.
- **Catatan serializer (pra-ada, di luar scope):** suntingan apa pun pada note berlist membuat serializer Milkdown menormalkan markdown (`- a\n- b` → `* a\n\n* b`, task `- [ ]` → `* [ ]`), jadi E2E membandingkan konten tersimpan dengan hasil simpan suntingan netral (ketik "x" lalu hapus), bukan teks mentah. Di E2E, "+" kedua dilakukan di blok lain yang tidak tertutup menu: plugin-block tidak menampilkan ulang handle untuk blok aktif yang sama setelah dokumen berubah, dan menu bisa menutupi blok di atasnya.
- **Merge `origin/main` cb9ed2b (2026-10-21, merge commit):** konflik hanya versi SW + `.agents` (kedua sisi dipertahankan); `__SW_VERSION` kini di skrip awal `<body>` (dari `main`). SW → **v452** `taskflow-v452-slash-menu-dismiss` (sw.js, webapp.py, index.html skrip awal + fallback About, tests/test_version.py + tes pin versi); `app.css?v=356` dari `main`. Verifikasi setelah merge: `npm test` 2710/2711 (pra-ada `draw_local_reactive`); pytest 1070 passed + 2 skip; inline OK; E2E dismiss 74/74; grid 40/40 (langkah `d3` baru: Esc menutup menu yang muncul lagi setelah "and/" — sebelumnya klik berikut kadang tertahan menu, flaky 1 dari 4 run).
- **Known minor (dibiarkan):** di layar sentuh, menggeser (scroll) halaman di luar menu dimulai dengan pointerdown → menu ikut tertutup (seperti Notion); pindah fokus dengan Tab tidak menutup menu. Ctrl+Z setelah Esc mengembalikan dokumen sebelum "+" (satu grup riwayat) atau paragraf "/".

## 🟠 Kelola Workspace Fase 2a: undangan & akses gabung — `claude/kelola-workspace-fase2a` — 2026-10-21 (Claude) — DI-MERGE (#76, cb9ed2b) 22:00 WIB, DEPLOY WORKFLOW SUKSES; TUNGGU RESTART `taskflow-web` LALU `taskflow` (MIGRASI)
- **Status:** backend + bot + frontend. SW **v451** `taskflow-v451-kelola-workspace-fase2a`, `app.css?v=356` (`main` v450 / 355 dari #74 sudah di-merge ke branch). Setelah deploy: restart **`taskflow-web` lalu `taskflow`** (migrasi tabel `workspace_invitations`, kolom `list_invites`, `notifications.kind`; bot berubah). Spec `docs/superpowers/specs/2026-10-21-kelola-workspace-fase2a-design.md`, rencana `docs/superpowers/plans/2026-10-21-kelola-workspace-fase2a.md` (salinan di Project claude.ai "alurik"). ADR-025.
- **Isi:** undang via username (aplikasi + bot `/invite`) = undangan menunggu (14 hari), penerima: seksi "Undangan untukmu", badge di menu Kelola Workspace (sidebar + rail), notifikasi (klik → seksi), DM Telegram Terima/Tolak; owner: "Undangan menunggu" + Batalkan; link undangan: berlaku 1 jam/1 hari/7 hari, dipakai 1/maks 10/tanpa batas, daftar link aktif + Salin/Batalkan, "Matikan semua link"; pratinjau `?join=` + owner & jumlah anggota, pesan galat dibedakan; timestamp ber-offset di endpoint fitur ini.
- **Verifikasi:** pytest 1072; JS 2657/2658 (pra-ada `draw_local_reactive`); inline OK; E2E `temporary_files/e2e_kelola_workspace_fase2a.py` 78/78 (tiga akun, terang + gelap, offline, 375 px) + Fase 1 98/98 + Fase 0 66/66 + `e2e_tasklist_view_icons.py` 168/168. SDD 7 task + review per task + review akhir opus → 1 gelombang perbaikan (tanggal ber-offset, race batal vs terima, undangan tertutup saat gabung lewat link, gabung link satu transaksi, aksesibilitas, bot) + re-review bersih.
- **Sisa diketahui:** menerima undangan setelah sudah gabung lewat link kini 409 (kartu/tombol Telegram basi) — spec §1.2 menyebut 200; state benar, pesan "Undangan sudah dijawab atau dibatalkan" (perbaikan 1 baris berikutnya); tombol modal `?join=` masih "Gabung ke List Ini"; DM owner "bergabung" masih "shared list"; belum ada jeda undang ulang setelah ditolak (Fase 5); endpoint lain masih timestamp naive.
## 🔴 Bug produksi: layar putih di Chrome Android saat Pomodoro selesai / tombol Fokus — `claude/fix-android-notification-blank` — 2026-10-21 (Claude) — DI-MERGE (#74, 1cf0447) 21:46 WIB; SW v450 / app.css 355; TUNGGU RESTART `taskflow-web`
- **Status:** frontend saja (tanpa migrasi/endpoint). Basis `main` c7758d1, lalu merge `origin/main` a9fb110 (#73 slash menu, v447 / `app.css?v=353`) dan 6b9579c (#75 komentar offline, v448 `taskflow-v448-komentar-offline` / `app.css?v=353`). SW **v450** `taskflow-v450-android-notif-fix`, `app.css?v=355` (CSS cabang ini tidak berubah, hanya cache bust; v449 dipegang draft #76 `claude/kelola-workspace-fase2a`, draft #25 v412). PR #74. **Deploy: file statis, lalu restart `taskflow-web` saja** (`sw_cache`). Bila `main` memakai v450 lebih dulu, naikkan ke nomor kosong berikutnya.
- **Akar masalah:** `sendBrowserNotification` memanggil `new Notification(...)`; di Chrome Android konstruktor itu selalu melempar `TypeError: Illegal constructor` saat izin granted. Dipanggil dari `handleTimerComplete` / batas Overtime di dalam efek React → error lolos → `ReactDOM.render` legacy tanpa error boundary meng-unmount seluruh pohon → layar putih. Crash terjadi sebelum fase awaiting ter-commit → `tf_pomo_state` macet `{phase: countdown, timeLeft: 0}`; setiap tombol Fokus (`timer.start()`) dan reload memicu penyelesaian lagi → putih lagi.
- **Isi:** `sendBrowserNotification` tidak pernah melempar: `navigator.serviceWorker.getRegistration()` → `reg.showNotification(title, {body, icon "/static/icon-192.png", tag "alurik-pomodoro"})` (tanpa `badge` — ikon tidak transparan jadi kotak putih di Android; tanpa `renotify`), konstruktor hanya cadangan dalam try/catch (juga bila `showNotification` menolak karena worker belum aktif), `requestPermission` lewat `.catch`; `playNotificationSound` dibungkus try/catch dan menutup AudioContext (700 ms / saat gagal); `usePomodoro`: helper `pomoAlert` (try/catch terpisah untuk bunyi dan notifikasi) dipanggil SETELAH semua setState di Work 00:00, istirahat selesai, batas Overtime; permintaan izin saat mount dibungkus. `AppErrorBoundary` membungkus `App`: layar "Terjadi kesalahan pada tampilan" (pesan, ringkasan stack ≤ 6 baris, "Muat ulang", "Salin detail"), detail ke `localStorage.tf_last_crash` `{at, message, stack, componentStack, version, ua}` + `console.error`; `window.__SW_VERSION` kini di-set di skrip awal `<body>` (sebelum render) agar crash render pertama tetap mencatat versi; token warna app (terang/gelap).
- **Pemulihan pengguna yang macet:** otomatis setelah update — tap Fokus pada state macet kini menyelesaikan sesi → awaiting (Ambil Istirahat / Lanjut Fokus); reload dengan countdown habis → awaiting (client_id sama, idempoten).
- **Verifikasi:** tes baru `tests/offline/pomo_android_notification.test.js` 25/25 (RED dulu: 20/21 gagal, 1–6 dengan TypeError Android; tambahan review: state macet realistis dengan client_id W lama, istirahat macet, fallback showNotification menolak, versi sebelum render); pytest 1018 passed; JS 2529/2530 (pra-ada `draw_local_reactive`); `check_inline_scripts` OK; E2E baru `temporary_files/e2e_android_notification.py` **40/40** (a sesi alami 00:00 + reload + istirahat selesai, b state macet + Fokus dashboard, c error render dipaksa dari tes → boundary terang/gelap, 412/320 px, clipboard, Muat ulang; d SW aktif → `showNotification`, konstruktor 0×); `e2e_focus_page.py` 35/35, `e2e_focus_overtime.py` 98/98. Reproduksi Playwright (Pixel 7) sebelum: root 0 di A (00:00 + reload) dan B; sesudah: root ±61 rb, tanpa pageerror.
- **Sisa / temuan (di luar cakupan):** `sw.js` belum punya handler `notificationclick` → tap notifikasi tidak membuka/memfokuskan app (notifikasi SW di desktop kini juga persisten); penyelesaian istirahat bisa terpicu dua kali di 0 (efek + interval basi) → chime/notifikasi istirahat ganda — sudah begitu di `main` (dicek di harness), tidak diubah; belum dites di HP Android asli.

## 🟠 Komentar Note PR 2: offline — `claude/komentar-note-offline` — 2026-10-21 (Claude) — DI-MERGE KE MAIN; TUNGGU RESTART `taskflow-web`
- **Status:** frontend offline saja (tanpa backend/UI baru). Basis 244b990, commit 1b1fb340..644f4dda + dokumentasi. **Deploy: file statis saja (tanpa migrasi), restart `taskflow-web` saja** (`sw_cache`). SW **v448** `taskflow-v448-komentar-offline` (v446/v447 dipakai #73), `app.css` tidak berubah; IndexedDB naik ke versi 6 (store `note_comments`, index `note_cid`). Spec `docs/superpowers/specs/2026-10-21-komentar-note-design.md` (§4 baris delta, §6 + §6.5), rencana `docs/superpowers/plans/2026-10-21-komentar-note-offline.md`.
- **Isi:** `commentanchor.js` (`findQuote`), `commentrepo.js` (record lokal, thread, leburan op, penanda baca), `commentroutes.js` (rute lokal komentar + badge `comment_open_count`/`comment_unread` di rute note), push op `comment` di `syncpush.js`, delta pull di `fullSync` (`syncpull.js`, kursor `comments_cursor`, `reset`, tombstone). Keputusan: penanda baca lokal (`_meta` `comment_reads`, seed dari `comment_unread` pull note); `server_copy` untuk rollback + `sync_error` saat ditolak (pending dan `server_copy` dikosongkan saat revert); create ditahan selama ada op note untuk note itu di antrean; body di-trim seperti server; perubahan lokal setelah `sync_error` = coba lagi; adopsi via `client_id` mempertahankan body/resolve lokal yang berbeda; perbandingan waktu pakai `Date.parse`; rute GET tidak menghapus cache pada respons bukan array; dekorasi note best-effort.
- **Verifikasi:** `npm test` 2601/2602 (pra-ada `draw_local_reactive`); tes komentar 97 (8 file); `python -m pytest tests/ -q` 1018 passed; `node temporary_files/check_inline_scripts.js` OK. Per task: implementasi + review; review akhir -> perbaikan.
- **Perbaikan review akhir (I1–I4, M1):** `commentrepo` membaca `chatrepo` saat `user()` dipanggil (urutan script browser; tes vm `comment_browser_order.test.js`); record `sync_error`-saja tetap menerima pull/tombstone/reset/replace; penanda baca maju saat server melapor `comment_unread` false; `replaceForNoteId` melindungi record ≥ awal request − 5 menit; validasi lokal 422 (body kosong/>4000, quote >500).
- **Sisa diketahui (minor, ditunda):** `parent_cid` basi setelah `clearSynced` (fallback `parent_id`); `upsert` menimpa `note_cid` dikenal jadi null; tombstone adopsi meninggalkan balasan unsent; user tak dikenal (sebelum login) -> semua unread; op/record tidak atomik (celah antar langkah DB di `commentSettle`, PATCH body+resolved tidak atomik); array berisi item rusak (`[{}]`) masih memicu `replaceForNoteId`; fetcher throw sinkron menggagalkan GET; `commentRejected` tanpa `server_copy`; kode access untuk balasan yang induknya gagal menyesatkan; `more:true` dengan kursor sama berputar 50 halaman; adopsi pull membandingkan body lokal lama yang belum di-trim; celah tes (findQuote sebelum spasi ganda/NBSP di tepi, retry kasus (a) tanpa gerbang, negatif resolve). Review akhir minor M2–M6 (decorateNotes O(n×m), `onversionchange`, balasan yatim di `listForNote`, `markRead` jam perangkat, `create` tidak cek note induk) ditunda.
- **Berikutnya:** review akhir -> push + PR; lalu PR 3 UI (panel komentar, sorotan via `commentanchor`, EventSource `/comments/stream` -> `pullComments`, kartu "Gagal terkirim" memakai `discard`).
## 🟠 Slash menu note: grid 2 kolom + label grup + item Wikilink + ikon gaya Alurik — `claude/slash-menu-grid-wikilink` — 2026-10-21 (Claude) — DI-MERGE (#73, 131e5c8) 20:40 WIB, DEPLOY WORKFLOW SUKSES; TUNGGU RESTART `taskflow-web`
- **Status:** frontend saja (tanpa migrasi/endpoint). SW **v447** `taskflow-v447-slash-menu-icons`, `app.css?v=353` (v446 / 352 dipakai commit grid sebelumnya di branch yang sama; `main` masih v445 saat dicek). Deploy: file statis, lalu restart `taskflow-web` saja. Bila `main` memakai v447 lebih dulu, naikkan ke nomor kosong berikutnya.
- **Ikon (commit ke-3, permintaan Bapak):** emoji/simbol slash menu diganti glyph `VIEW_GLYPHS` duotone. Baru: `sQuote`, `sLightbulb`, `sToggle`, `sCode`, `sListBullet`, `sListOrdered`, `sChecklist`, `sTable`, `sDivider` (path Lucide + isian lembut `.22`); dipakai ulang: `pPalette` (Gambar), `nPin` (Task), `mLink` (Wikilink). Heading tetap teks H1–H3. Item memakai kunci `glyph` di `SLASH_MENU_GROUPS`; `makeSlashItem` membuat `<svg>` lewat `createElementNS` dengan atribut sama seperti `ViewGlyph` (16 px, stroke 1.9) dan `innerHTML` hanya dari konstanta statis `VIEW_GLYPHS`. CSS `.milkdown-slash-icon` inline-flex terpusat, warna `--text-light`, hover/aria-selected `--text-primary`. Verifikasi: JS 2531/2532 (pra-ada `draw_local_reactive`), pytest 1016 + 2 skip, inline OK, E2E 39/39.
- **Isi:** `MilkdownEditor` — data `SLASH_MENU_GROUPS` (Teks / Daftar / Sisipkan / Tautan, 15 item, label pendek + `title` deskripsi panjang), `makeSlashItem(icon, label, type, payload, { wide, hint, title })` via `createElement`/`textContent` (tanpa innerHTML), grid `role="group"` per grup. Item baru **Wikilink** (lebar penuh, hint `[[ ]]`): `case 'wikilink'` → `/` pemicu dihapus jalur generik (`isSlashTriggerBefore`; "and/" aman), lalu `tr.insertText('[[')` dari state segar → `markdownUpdated` → `onChange` host (NoteModal `handleEditorChange` / TaskFormModal `handleNoteContentChange`) mencocokkan `/\[\[([^\]]*)$/` dan membuka dropdown (jalur sama dengan tombol toolbar Wiki). Middleware floating-ui `slashClampToViewport` di `SlashProvider` menjepit menu ke viewport (menu 340 px keluar layar di HP; di 375×740 tidak muat di atas/bawah kursor → digeser, boleh menutupi baris "/"). CSS sesuai pratinjau yang disetujui (`max-height: min(440px, 70vh)`, lebar `min(340px, 100vw - 24px)`), dark hover `box-shadow: none`.
- **Perbaikan review (commit ke-2):** `slashClampToViewport` memakai `visualViewport` (`pageLeft`/`pageTop`/`width`/`height`) untuk kedua sumbu (fallback `scrollX/scrollY` + `clientWidth/innerHeight`); saat area terlihat < max-height CSS (keyboard HP terbuka) `style.maxHeight` di-set ke `tinggi terlihat − 16` px (min 120) + `reset: { rects: true }` sehingga menu di-scroll di dalam, dikosongkan lagi bila ruang cukup. `case 'wikilink'` membuang mark ber-`spec.code` (inline code) dari stored marks sebelum `insertText('[[')`. Listbox `aria-label="Sisipkan blok"`.
- **Verifikasi:** JS 2527/2528 (pra-ada `draw_local_reactive`); pytest `tests/` 1016 passed, 2 skipped (venv repo asli + `PYTHONPATH` paket tes di luar repo); inline OK; E2E `temporary_files/e2e_slash_menu_grid.py` **36/36** (termasuk emulasi keyboard: `visualViewport` 330 px → max-height 314 px, Wikilink di-scroll & diklik; Wikilink di dalam `kode` → "[[" teks biasa; kontrol negatif tanpa perbaikan mark gagal di f1). Sebelumnya **26/26** (1280×800 + 375×740, terang + gelap, Wikilink → dropdown + Enter menyisipkan wikilink, "and/" dipertahankan, Task dropdown, Gambar modal). Screenshot `temporary_files/e2e_slash_menu_*.png` (di-.gitignore).
- **Catatan agen berikutnya:** `venv/` ter-track di git — jangan `pip install` ke venv repo (mengubah file ter-track); `tests/test_safehtml_parity_node.py` / `safehtml_parity.test.js` butuh `python3` dengan dependensi webapp di PATH. Temuan di luar cakupan: regex wikilink host memakai teks seluruh dokumen (`[^\]]` melintasi baris), jadi `[[` yang belum ditutup di paragraf atas membuat dropdown tetap aktif dan menangkap Enter di paragraf berikutnya (pra-ada, sama untuk tombol toolbar Wiki).

## 🟠 Ikon gaya Alurik di Mindmap, Diskusi, Gambar, Habit, Kalender, hero Dashboard — `claude/pages-icons-batch` — 2026-10-21 (Claude) — DI-MERGE (#72, 8d9dfe0) 15:45 WIB, DEPLOY WORKFLOW SUKSES; TUNGGU RESTART `taskflow-web`
- **Status:** frontend saja. SW **v445** `taskflow-v445-pages-icons` (`app.css` tidak berubah, `?v=351`). Setelah deploy: restart `taskflow-web`.
- **Isi:** emoji UI diganti glyph `VIEW_GLYPHS` (baru: `pPalette`, `pChat`, `pCalendar`, `pRepeat`, `pDot`, `pTarget`, `pFlame`, `pHourglass`, `pSprout`, `pZap`, `pCheckCircle`, `pPencil`) di `MindmapPage`/`MindmapListItem`/`MindmapTabInstance`/`MindmapTrashList`, `DrawPage`/`DrawingListItem`, `ChatListPanel`/`ChatPage`, `CalendarView`, komponen Habit, dan kartu hero + daftar proyek `Dashboard`. Toast, kalimat 🎉, panah →, ✓ Done, tooltip, tour tidak diubah.
- **Verifikasi:** pytest 1016 (+2 skip), JS 2504/2505 (pra-ada `draw_local_reactive`), E2E `temporary_files/e2e_tasklist_view_icons.py` 148/148 terang + gelap (`E2E_SKIP_MANAGE=1`). SDD 3 task, review akhir opus: siap merge.
- **Sisa minor:** "⏭️ Di-skip hari ini" (habit), tombol "◀/▶" panel Diskusi, "⇤⇥ Justify" mindmap; `temporary_files/e2e_focus_ambient.py` masih mengharapkan v444.

## 🟠 Fokus Hari Ini PR D: Suara latar — `claude/focus-ambient` — 2026-10-21 (Claude) — DI-MERGE (#67, a899d8a) 10:50 WIB; SW v444 / app.css 351; TUNGGU RESTART `taskflow-web`
- **Status:** frontend + aset (tanpa migrasi/endpoint baru). `main` cbcd8c7 (#66 Email Fase 0a, v439 / 347) sudah di-merge ke branch (merge commit; konflik hanya baris `CACHE` di `sw.js`, kedua sisi dipertahankan: `accountbanner.js` + `ambient.js` di `STATIC`, `AMBIENT_CACHE`). **Merge `origin/main` #68 (note list tags, v441 / 349) ke branch 2026-10-21:** konflik hanya baris versi + `.gitignore` + `.agents`; kode kedua sisi dipertahankan. **Merge `origin/main` b5f46ed (#69 ikon daftar Catatan, #70 Kelola Workspace Fase 1, #71 Komentar Note backend; v443 / 350):** konflik versi, glyph `VIEW_GLYPHS` (`n*` + `headphones` keduanya), `.gitignore`, `.agents`. SW **v444** `taskflow-v444-focus-ambient`, `app.css?v=351` (draft terbuka lain hanya #25 v412). **Deploy: file statis + `static/sounds/`, lalu restart `taskflow-web` saja.** Bila `main` memakai v440 lebih dulu, naikkan ke nomor kosong berikutnya. Rencana `docs/superpowers/plans/2026-10-21-fokus-d-suara-latar.md`, spec §7.4 / D11–D13 / §8 / §10.
- **Isi:** kontrol di kartu Pomodoro (ikon headphones, `<select aria-label="Suara latar">` Off / Hujan / Brown Noise / Detak Jam, slider volume 0–100 default 50, `aria-valuetext` "NN%", teks `sr-only aria-live="polite"` mengumumkan tooltip waiting-tap / error); preferensi `tf_ambient_sound` / `tf_ambient_volume` (tidak dihapus saat logout). Satu pemutar di App (`static/offline/ambient.js`, `window.TF.ambient`): `<audio loop>` + `GainNode`, fade 1000 ms, file diambil malas lewat `fetch` → Blob URL (0 request sampai suara dipilih atau Work mulai), play hanya saat Work/Overtime berjalan, pause saat Jeda / awaiting / istirahat, stop (posisi 0) saat Stop. Autoplay ditolak → `waiting-tap`, gesture pertama menyalakan. Offline tanpa file → `error` "Suara belum tersedia offline"; timer tidak terpengaruh. Aset disintesis `scripts/gen_ambient_sounds.py` (**numpy + ffmpeg hanya untuk meregenerasi aset**, tidak dibutuhkan di server). SW: `/static/sounds/` cache-first dari **`alurik-ambient-v1`, yang sengaja bertahan lintas versi SW** (`activate` tidak menghapus cache berawalan `alurik-ambient-`).
- **Task 5:** merge main; versi v440 / 348; minor review Task 4: status diumumkan lewat `aria-live` (+ tes sumber); tata letak 375 px dan 320 px dicek E2E (tanpa scroll horizontal, statistik + kontrol di dalam kartu) → tidak perlu ubah CSS. Review akhir: logout / sesi berakhir memudarkan suara (`isRunning: !!user && timer.isRunning`); rute suara SW lanjut ke jaringan bila Cache Storage gagal (503 hanya bila jaringan juga gagal), `cache.put` lewat `e.waitUntil` + catch; `<option>` select suara diberi latar `#fff`.
- **Verifikasi:** pytest 911; JS 2392/2393 (pra-ada `draw_local_reactive`); `check_inline_scripts` OK; E2E baru `temporary_files/e2e_focus_ambient.py` **87/87** (a 0 request + Off + slider disabled; b Hujan → 1 request `.ogg`, idle; c Mulai gain 0,5 / Jeda paused posisi tetap / Stop currentTime 0; d awaiting berhenti, Lanjut Fokus berbunyi, Ambil Istirahat berhenti dan tetap diam; e volume 20 → gain 0,2, Off paused; f Semua Task tetap berbunyi, satu elemen audio; g browser tanpa flag autoplay: reload saat Work → waiting-tap + aria-live, klik → playing; h SW + server dimatikan + cache HTTP dikosongkan: Brown Noise 200 `from_service_worker` dari `alurik-ambient-v1`, Detak Jam → error + tooltip, kontrol negatif (entri cache dihapus → error); i reload → 0 request sebelum Work; j logout saat berbunyi → suara paused di layar login; screenshot terang + gelap desktop + 375 px, cek 320 px). E2E lama `e2e_focus_page.py` 35/35, `e2e_focus_target.py` 41/41, `e2e_focus_overtime.py` 98/98.
- **Catatan untuk agen berikutnya:** emulasi offline Playwright (`set_offline`) tidak mengenai fetch milik SW di Chromium; skenario h E2E mematikan server. `page.evaluate` Playwright memberi user activation (5 dtk), jadi navigasi tanpa gesture di skenario g dijadwalkan lewat `setTimeout` 8 dtk.
## 🟠 Komentar Note PR 1: backend — `claude/komentar-note` — 2026-10-21 (Claude) — DI-MERGE KE MAIN; TUNGGU RESTART `taskflow-web` LALU `taskflow` (MIGRASI)
- **Status:** backend saja (tanpa frontend/offline/UI). Basis `main` 9f3cbfa; commit 93647bf..b3de0f9 + dokumentasi. **Deploy: ada migrasi** (tabel `note_comments`, `note_comment_reads`, kolom `notifications.note_id`); `repository.py` berubah -> restart **`taskflow-web`, lalu `taskflow`** (satu per satu). Tanpa perubahan frontend, versi SW tidak naik (tetap **v442** dari #70). Spec `docs/superpowers/specs/2026-10-21-komentar-note-design.md`, rencana `docs/superpowers/plans/2026-10-21-komentar-note-backend.md`. ADR-024.
- **Isi:** modul `note_comments.py` (helper kursor, mention, visibilitas) + endpoint di `webapp.py`: `GET /api/note-comments?since=&limit=` (delta pull, tombstone, `reset` bila kursor > 30 hari), `GET /api/scratchpad/{id}/comments`, `POST /api/scratchpad/{id}/comments` (`client_id` idempoten, balasan diratakan ke thread induk, `quote` diabaikan pada balasan), `PATCH /api/note-comments/{cid}` (edit **atau** selesaikan/buka lagi), `DELETE /api/note-comments/{cid}` (soft delete, idempoten, thread ikut balasannya), `POST /api/scratchpad/{id}/comments/read`, `GET /api/scratchpad/{id}/comments/stream` (SSE sinyal `comments_changed`). Field turunan `comment_open_count` / `comment_unread` di daftar dan detail note (tanpa mengubah `updated_at` note). Notifikasi in-app + Telegram: komentar ke pemilik, balasan ke peserta thread, mention, selesai ke penulis thread. Siklus hidup: Sampah/unshare/pindah workspace menyembunyikan, restore memunculkan lagi, purge/kosongkan Sampah/hapus workspace menghapus permanen; tombstone > 30 hari dibersihkan di `migrate_db()` saat start/deploy (bisa bertahan lebih lama sampai restart berikutnya; klien tetap benar lewat `reset`).
- **Verifikasi:** setelah merge `main` (#68, #70): pytest **1004 passed**; JS 2421/2422 (sebelum merge: pytest 956, JS 2331/2332 pra-ada `draw_local_reactive`, satu-satunya kegagalan). ADR komentar dinomori ulang jadi ADR-024 (ADR-023 dipakai #70). Per task: implementasi + review; tes baru `tests/test_note_comments_{schema,api,sync,summary,notify,live}.py`.
- **Cek produksi (sesudah restart):** `SELECT COUNT(*) FROM note_comments;` -> harus 0 (tabel ada, belum ada komentar).
- **Perbaikan review akhir:** kursor delta maju tanpa item (`max(updated_at terakhir, now-5 menit)`, tak ada `reset` palsu), `add_list_member` mem-bump `updated_at` komentar workspace, tombstone mengosongkan `quote`, resolve/reopen idempoten (no-op tanpa notifikasi/SSE), `since` rusak tak di-echo; spec §2.3/§4 diperbarui; tes komentar 59 passed.
- **Sisa diketahui (minor, ditunda):** POST dengan `client_id` yang sama bersamaan bisa `IntegrityError` 500 (perlu tangkap + re-select), dedupe `client_id` tidak dibatasi `note_id`; mention tanpa batas jumlah parameter SQL (batasi ~50); `_notify_users_bg` sinkron di async (pola lama), kegagalan notifikasi tanpa logging, judul tidak dipotong untuk Telegram 4096; `touch_for_note` juga bump tombstone; celah tes (clamp limit 1000, note pindah workspace di ringkasan/sync, unread komentar terhapus, purge oleh pengirim lain, HTML di display name, jalur `QueueFull` SSE, `test_stream_404` asersi longgar, cleanup subscriber tanpa `finally`).
- **Berikutnya:** restart layanan + cek produksi; PR 2 offline (`commentrepo.js`, `commentanchor.js`, `commentroutes.js`, `DB_VERSION` 6, push/pull), PR 3 UI.
## 🟠 Kelola Workspace Fase 1: halaman Kelola per workspace — `claude/kelola-workspace-fase1` — 2026-10-21 (Claude) — DI-MERGE (#70, a03aa76) 10:10 WIB, DEPLOY WORKFLOW SUKSES; TUNGGU RESTART `taskflow-web` LALU `taskflow` (MIGRASI)
- **Status:** backend + frontend. SW **v442** `taskflow-v442-kelola-workspace-fase1`, `app.css?v=350` (`main` v441 / 349 dari #68 sudah di-merge ke branch; #67 / #69 memakai v440). Setelah deploy: restart **`taskflow-web` lalu `taskflow`** (migrasi kolom `shared_lists`). Spec `docs/superpowers/specs/2026-10-21-kelola-workspace-fase1-design.md`, rencana `docs/superpowers/plans/2026-10-21-kelola-workspace-fase1.md` (salinan di Project claude.ai "alurik"). ADR-023.
- **Isi:** identitas workspace (deskripsi, warna 8 palet/otomatis, avatar inisial/emoji) + `PATCH /api/lists/{id}` (owner), `PUT /api/lists/pins/order`, pratinjau kode gabung + owner & jumlah anggota; `WorkspaceAvatar` di kartu, header detail, rail, sidebar terbuka, judul halaman workspace (+ deskripsi); halaman baru `ws_manage_<id>` (Umum / Anggota `WorkspaceMembersSection` / Danger Zone) + tombol "Kelola" di halaman workspace; daftar Kelola Workspace: seksi "Di sidebar" (drag + ↑/↓, optimistis + rollback, "Sidebar penuh (5/5)") dan "Semua workspace" (Pin/Di-pin, Buka, Kelola; cari ≥ 6; tanpa Hapus/Keluar di kartu). Penjaga `fetchAll` basi; helper baru dipanggil dengan guard `typeof` (index.html baru + modul offline lama tidak blank).
- **Verifikasi:** pytest 945; JS 2421/2422 (pra-ada `draw_local_reactive`); inline OK; E2E `temporary_files/e2e_kelola_workspace_fase1.py` 98/98 (dua akun, terang + gelap, offline, 375 px, balapan GET vs PUT urutan pin) + Fase 0 E2E 66/66; uji modul lama 14/14. SDD 7 task (1+2 digabung) + review per task + review akhir opus → 1 gelombang perbaikan + re-review bersih.
- **Sisa diketahui (minor):** halaman workspace `slist_` sudah melebar horizontal di 375 px sebelum branch ini (judul panjang + baris tombol; tombol Kelola menambah lebar) → task terpisah; balapan kecil urutan pin vs unpin dari perangkat lain (pulih saat pull); aksesibilitas: tanpa live region saat urutan pindah, radiogroup tanpa Home/End; `JoinListModal` (`?join=`) belum menampilkan owner + jumlah anggota.
## 🟠 Bug: note list tidak ter-update setelah tag ditambah lewat editor — `claude/note-list-tag-refresh` — 2026-10-21 (Claude) — DI-MERGE (#68, 19a87cc) 07:55 WIB; TUNGGU RESTART `taskflow-web`
- **Status:** frontend saja (tanpa migrasi/endpoint). SW **v441** `taskflow-v441-note-list-tags`, `app.css?v=349` (CSS tidak berubah, hanya cache bust; v440 / 348 dipakai draft #67 Suara latar). **Deploy: file statis, lalu restart `taskflow-web` saja** (`sw_cache`). Bila `main` memakai v441 lebih dulu, naikkan ke nomor kosong berikutnya.
- **Gejala (laporan Bapak):** edit note → tambah `#tag` → Simpan → kartu di note list tetap "tanpa tag" sampai pindah halaman lalu kembali.
- **Akar masalah:** autosave `NoteModal` (debounce 2,5 dtk, `autosaveNow` → `persistEditor`) menulis judul/isi/tag ke record lokal tanpa memancarkan `noteSaved`; tombol Simpan lalu melihat snapshot sama dengan `lastSavedSnapRef` → `saveOnly` dilewati → `NotesPage.handleSave` (yang memuat ulang daftar) tidak jalan; flush saat unmount juga tidak punya apa-apa untuk ditulis → tidak ada `noteSaved`.
- **Perbaikan:** `unannouncedWriteRef` (diisi cid note setelah PUT autosave sukses, dikosongkan setelah flush memancarkan `noteSaved` dan setelah `onSave`); unmount menunggu flush, dan bila tidak ada flush tetapi ada tulisan autosave yang belum diumumkan → `noteSaved` sekali (`source: "editor-autosave"`, `cids: [cid]`; tanpa `cids` bila cid tak diketahui). Mencakup semua jalur tutup (Simpan, Batal, ✕, Esc, navigasi).
- **Verifikasi:** pytest 897; JS 2331/2332 (pra-ada `draw_local_reactive`); inline OK; E2E baru `temporary_files/e2e_note_list_tags.py` **5/5** dua kali (a autosave → Simpan, b Simpan cepat, c autosave → Batal); kode lama gagal tepat di a dan c. Review subagen: tidak ada yang memblokir.
- **Temuan lain (belum diperbaiki, di luar cakupan):** (1) listener `markdownUpdated` Milkdown di-debounce ±200 ms → menekan Simpan < 200 ms setelah ketukan terakhir kehilangan ketukan itu (dan memicu `MilkdownError: Context "editorView" not found` setelah editor di-destroy); (2) host `NoteModal` di Mindmap (`onSave` sekitar baris 12441) dan App (sekitar 38840) tidak memancarkan `noteSaved` setelah Simpan → panel sidebar terbaru/ter-pin bisa basi; host App tidak menunggu PUT sebelum `onClose` (kemungkinan modal terbuka lagi, belum dikonfirmasi); (3) isi note tersimpan memuat `\#tag` (escape serializer Milkdown) dan tampil di pratinjau daftar.

## 🟠 Ikon gaya Alurik di daftar Catatan, pin, Petakan, badge Bersama — `claude/notes-list-icons` — 2026-10-21 (Claude) — DI-MERGE (#69, 8153da0) 10:20 WIB, DEPLOY WORKFLOW SUKSES; TUNGGU RESTART `taskflow-web`
- **Status:** frontend saja. SW **v443** `taskflow-v443-notes-list-icons` (`app.css` tidak berubah, `?v=350`). Setelah deploy: restart `taskflow-web`.
- **Isi:** `NotesPage`: 📝 🔍 ⭐ 🏷️ ⬜ 📌 👥 🔗 ← ☰/▤ ▴/▾ ✕ diganti glyph `VIEW_GLYPHS` (baru: `nNote`, `nTag`, `nTagOff`, `nStar`, `nChevronDown/Up`, `nBacklink`, `nPin`, `nBrain`); tombol sampah memakai `fTrash`. Toolbar catatan: pin `nPin` (+ `aria-pressed`), badge "Bersama" `mUsers`. `PetakanButton`: 🧠 → `nBrain`.
- **Verifikasi:** pytest 897, JS 2338/2339 (pra-ada `draw_local_reactive`), E2E `temporary_files/e2e_tasklist_view_icons.py` 126/126 terang + gelap. Review: siap merge.
- **Sisa emoji di luar cakupan:** 🧠 lain (halaman mindmap, hasil cari, tour, tooltip link), menu Export (📄 📘 📝), ✏️ judul, teks toast.

## 🟠 Email Fase 0a: perbaikan akun (ganti password/username, lengkapi akun Telegram, banner email) — `claude/email-fase0a` — 2026-10-21 (Claude) — DI-MERGE (#66, 50d0e24) 05:37 WIB, DEPLOY WORKFLOW SUKSES; TUNGGU RESTART `taskflow-web` LALU `taskflow` (MIGRASI)
- **Status:** backend + frontend. SW **v439** `taskflow-v439-account-fase0a`, `app.css?v=347` (v438 / 346 dipakai #65 Overtime). **Deploy: ada migrasi** (`users.password_set`) → restart **`taskflow-web`, lalu `taskflow`** (satu per satu). ADR-022. Analisis email lengkap (fase 0–3) di Project claude.ai "alurik" `claude/analisis-email-alurik-2026-10-20.md`.
- **Isi:** endpoint yang hilang sejak `af35639` dibuat ulang: `PATCH /api/auth/profile/password` (cabut token Clipper, kembalikan token baru) dan `/profile/username` (`[A-Za-z0-9_]{3,50}`, tanpa prefix `tg_`, display name tidak disentuh); `pwv` diperiksa di setiap request (`_validate_token`) → ganti/reset password langsung mengeluarkan perangkat lain, stream SSE chat/DM/mindmap ditutup di keepalive (`_session_still_valid`); klaim `username` token selalu diganti nilai DB; `users.password_set` (0 = akun Telegram otomatis) + `POST /api/auth/complete-account` (tanpa password lama, hanya saat 0); register menolak prefix `tg_`; magic link `/auth/magic` → `/?magic=1`, SPA menukar cookie jadi token lewat `POST /api/auth/refresh` (sebelumnya link `/webapp` dari bot berakhir di form login). UI: `adoptSessionToken`, kartu "Lengkapi akun" di Pengaturan saat `password_set === false`, `AccountBanner` (tanpa email / belum lengkap, tutup 7 hari `tf_email_banner_dismissed_until`), helper `static/offline/accountbanner.js`; `Field` di Pengaturan jadi pemanggilan fungsi (input tidak lagi kehilangan fokus).
- **Verifikasi:** pytest 897 (baseline 850); JS 2293/2294 (pra-ada `draw_local_reactive`); inline OK; review opus + E2E Playwright 25/25 (skrip di luar repo) → 1 gelombang perbaikan (username basi, SSE, migrasi, register tg_, auth_time token lama).
- **Sisa diketahui (minor):** Tauri: stream SSE/URL `?token=` memakai token lama setelah ganti password di jendela itu (perlu remount); magic link saat browser sudah login akun lain diabaikan diam-diam; balapan milidetik di tab yang mengganti password (request bersamaan bisa 401 → form login); label `Field` tanpa `htmlFor`; migrasi kolom bisa dijalankan bersamaan oleh bot + web saat start.
- **Berikutnya:** Fase 0b (upgrade mailer: SSL 465, HTML, outbox + retry) → spec + plan; checklist DNS SPF/DKIM/DMARC saat pindah alurik.com.
## 🟠 Fokus Hari Ini PR C: Overtime / Flow State — `claude/focus-overtime` — 2026-10-21 (Claude) — DI-MERGE (#65, b20b0d8) 01:57 WIB; TUNGGU RESTART `taskflow-web`
- **Status:** frontend saja (tanpa migrasi/endpoint baru; memakai route lokal PR B `POST /api/tasks/:id/pomodoros`, kind `overtime`). `main` 57560c2 (#63, v437 / 345, ADR-020 + ADR-021) sudah di-merge ke branch (merge commit, tanpa konflik). SW **v438** `taskflow-v438-focus-overtime`, `app.css?v=346`. **Deploy: file statis saja, lalu restart `taskflow-web` saja** (`sw_cache`). Bila `main` memakai v438 lebih dulu, naikkan ke nomor kosong berikutnya. Rencana `docs/superpowers/plans/2026-10-20-fokus-c-overtime.md`, spec §6 / §7.5 / D7–D10.
- **Isi:** Work 00:00 → log `session`, satu chime + notifikasi "🍅 Pomodoro Selesai!", lalu fase **awaiting** (00:00, label "Selesai"): **Ambil Istirahat** (hijau, Short/Long langsung berjalan) · **Lanjut Fokus** + "Overtime" (ungu) · Stop. **Overtime** menghitung maju `+mm:ss` / `+h:mm:ss` (cincin + teks ungu `#8b5cf6` / `#c4b5fd`, kelas `is-overtime`), 🍅 tambahan tiap kelipatan penuh 25 menit langsung tampil (statistik, header X, realisasi bar Task Aktif), Stop / Ambil Istirahat / klik tab mode → log `overtime` (≥ 60 dtk, `pomo-<uid>-<workStartedAt>-o`, 🍅 = ⌊dtk/1500⌋) + Waktu fokus; batas 7200 dtk → istirahat **diam** + notifikasi "⏱️ Overtime selesai". Istirahat panjang menurut ⌊sesudah/4⌋ > ⌊sebelum/4⌋. Pemulihan: countdown habis saat tertutup → awaiting; awaiting dipulihkan tanpa log kedua; Overtime dari jam dinding (dibatasi); state hari sebelumnya dicatat tanpa mengubah statistik hari ini. Chip top bar: awaiting `00:00` berdenyut tanpa tombol play (tooltip "Pomodoro selesai — klik untuk memilih istirahat atau lanjut"), Overtime `+mm:ss` ungu dengan tombol jeda. Zen aktif selama Overtime berjalan, daftar kembali saat awaiting. Waktu fokus countdown bertambah sebesar penurunan sisa antar tick. Helper murni di `static/offline/pomologic.js`.
- **Task 4:** merge main; versi v438 / 346; minor review Task 3: kicker bar ringkas tanpa " · dijeda" saat awaiting; **E2E menemukan** judul/kicker bar ringkas terjepit ("T…", "OVERT") di 375 px saat Overtime → `.focus-mini-task { min-width: 96px }` di layar sempit sehingga kontrol pindah baris (commit fix sendiri + tes CSS). E2E PR B `e2e_focus_target.py` disesuaikan (00:00 kini awaiting → Stop, dua tab: `phase` awaiting).
- **Verifikasi:** pytest 850; JS 2295/2296 (pra-ada `draw_local_reactive`); `check_inline_scripts` OK; E2E `temporary_files/e2e_focus_overtime.py` **79/79** (a awaiting + 1 log session; b Overtime +25:0x → is-overtime, Pomodoro +1, realisasi +1, +37 menit Stop → log overtime 1 🍅 / ~2220 dtk, Waktu fokus 1j 2m; c Overtime +12 → Ambil Istirahat: Short berjalan, Pomodoro hanya +1, log 0 🍅; d reload saat awaiting → tombol tetap, tanpa log baru; e +3 jam → Long diam, log 4 🍅 / 7200; f chip di Kalender; g Zen; terang + gelap, desktop + 375 px: tanpa scroll horizontal, tombol di dalam kartu dan bar ringkas), `e2e_focus_target.py` 41/41, `e2e_focus_page.py` 35/35. Screenshot di `temporary_files/e2e_focus_overtime/` (di-.gitignore).
- **Review akhir (gelombang perbaikan):** (1) tombol Mulai/Lanjutkan + chip meneruskan event klik ke `timer.start` → `sessionTaskId` `undefined` (baris Overtime hilang bila fokus dilepas di tengah) — kini `() => timer.start()` dan `start` mengabaikan argumen tanpa `id`; (2) `pause()` Overtime tanpa batch menghitung dua kali (bisa memicu batas 2 jam) — urutan setState kini aman (putaran dihentikan dulu); transisi Overtime lain diurutkan ulang sehingga Work 00:00 berjalan tidak pernah tampak di fase countdown; (3) `App.handleStartFocus` toast mengikuti fase (awaiting: "Pomodoro selesai — pilih istirahat atau lanjut", Overtime dijeda: "Overtime dilanjutkan"); (4) `completedSessionRef` diisi `workStartedAt` saat pulih ke awaiting/Overtime; (5) E2E bar ringkas countdown 375 px. Engine 26/26, JS 2303/2304 (pra-ada `draw_local_reactive`), pytest 850, E2E overtime **98/98**, target 41/41, page 35/35.
- **Sisa minor:** detik Overtime di E2E bergeser beberapa detik (jam Playwright tetap berjalan nyata di sela `fast_forward`; asersi diberi toleransi 15 dtk); `scrollWidth` kartu `.focus-pomo` > lebarnya di semua fase (dekorasi terpotong `overflow: hidden`, sudah ada sebelum PR ini, tidak terlihat); minor PR B (header X lokal per perangkat, tab idle menimpa `workStartedAt`) tetap.
- **Berikutnya:** review akhir → draft PR; lalu PR D (suara latar).

## 🟠 Kelola Workspace Fase 0: perbaikan aman — `claude/kelola-workspace-fase0` — 2026-10-20 (Claude) — DI-MERGE (#63, b3d100b) 23:58 WIB, DEPLOY WORKFLOW SUKSES; TUNGGU RESTART `taskflow-web` + `taskflow`
- **Status:** backend + frontend. SW **v437** `taskflow-v437-kelola-workspace-fase0`, `app.css?v=345` (`main` v436 / 344 dari #64 sudah di-merge ke branch). Setelah deploy: restart **`taskflow-web` DAN `taskflow` (bot)** — `repository.py` dan `bot.py` berubah. Bila `main` memakai v437 lebih dulu, naikkan ke nomor kosong berikutnya. Spec `docs/superpowers/specs/2026-10-20-kelola-workspace-fase0-design.md`, rencana `docs/superpowers/plans/2026-10-20-kelola-workspace-fase0.md` (salinan di Project claude.ai "alurik"). ADR-020.
- **Isi:** hapus workspace → task dan mindmap kembali milik pembuatnya (task: `list_id`/`assigned_to`/`project_id`/`context_id` NULL, `project`/`context` ''; `updated_at` naik), berkas workspace dihapus dari disk setelah commit kecuali yang dirujuk `task_attachments`; startup `heal_orphan_workspace_items()` membereskan task/mindmap yatim yang sudah ada (idempoten); keluar/dikeluarkan → `assigned_to` dilepas di task belum selesai workspace itu; `member_count` termasuk owner (juga di bot); `GET /api/lists/{id}/delete-impact` (owner). UI `SharedListsManager`: dialog Hapus dengan ringkasan dampak + ketik nama (offline/gagal ditangani, Esc, fokus kembali), owner di daftar anggota + "Belum ada anggota lain." + muat ulang/“Gagal memuat anggota.” + Coba lagi, dialog Alurik untuk keluarkan/keluar (tanpa `confirm()`), istilah "workspace", kelas `.btn-danger-soft`/`.btn-warn-soft`/`.ws-invite-link` (gelap), aria. Helper murni `static/offline/wsmanage.js`. Teks bot hapus workspace diperbarui.
- **Verifikasi:** pytest 831 (baseline 816); JS 2209/2210 (pra-ada `draw_local_reactive`); inline OK; E2E `temporary_files/e2e_kelola_workspace_fase0.py` 63/63 (dua akun, terang + gelap, offline, sinkron dua perangkat). SDD 5 task + review per task + review akhir opus → 1 gelombang perbaikan (teks bot, mindmap yatim, minor UI) + re-review bersih.
- **Cek produksi (sebelum & sesudah restart):** `SELECT COUNT(*) FROM tasks WHERE list_id IS NOT NULL AND list_id NOT IN (SELECT id FROM shared_lists);` dan sama untuk `mindmaps` → sesudah restart harus 0.
- **Sisa diketahui (minor, ditunda):** `trashed_mindmaps.list_id` bisa menunjuk workspace terhapus; teks bot lain (`/leavelist`, pesan galat) masih "list"; pesan galat server ("List not found…") masih bahasa lama; balapan muat anggota/ringkasan (paling buruk data sesaat basi); dialog bersama `DrawingScopeDialog` tanpa focus trap/Esc. Fase 1–5 (halaman detail, undangan, template, peran, statistik) belum dimulai.
## 🟠 Fokus Hari Ini PR B: Target 🍅 (estimasi vs realisasi) — `claude/focus-target-pomodoro` — 2026-10-20 (Claude) — DI-MERGE (#64, 571ff1a) 23:27 WIB; TUNGGU RESTART `taskflow-web` LALU `taskflow` (MIGRASI)
- **Status:** backend + offline + UI. SW **v436** `taskflow-v436-focus-target` (`main` v434; v435 / `app.css?v=343` + ADR-020 dipakai draft PR #63 Kelola Workspace), `app.css?v=344`. **Deploy: ada migrasi** (`repository.ensure_pomodoro_schema`: tabel `pomodoro_log`, kolom `tasks.estimated_pomodoros` + `tasks.pomodoros_done`) → **restart `taskflow-web`, lalu `taskflow` (satu per satu)**. ADR-021 di `.agents/DECISIONS.md`. Rencana `docs/superpowers/plans/2026-10-20-fokus-b-target-pomodoro.md`.
- **Isi:** server: `estimated_pomodoros` (1–20) di create/update task, `POST /api/tasks/{id}/pomodoros` (idempoten per `client_id` `pomo-<uid>-<workStartedAt>-s`, `INSERT OR IGNORE` + `pomodoros_done` naik hanya bila baris baru); offline: `static/offline/pomologic.js` (clamp, `nextEstimate`, `headerSummary`, `~N jam`), `pomolog.js` (antre op outbox `pomodoro_log/create`, `withPending`, `ackPushed`), rute lokal task melaporkan `pomodoros_done` + pending, push idempoten di `syncpush.js`; timer: sesi Work 25 menit selesai → log lewat rute lokal (`workStartedAt`/`sessionTaskId` di `tf_pomo_state`, tanggal lokal); UI: bar Task Aktif `done / est` (`.focus-pomo-task-done.is-over` oranye bila lewat estimasi), chip `.ftask-count.is-pomo`, pemilih 5 tomat (`.ftask-estimate`, "5+" lalu +1, badge `×n`) di `div.ftask-tabbar` di luar tablist, header `N tugas • X / Y 🍅 hari ini (~Z jam)`.
- **E2E menemukan bug → 92dc3f18:** `window.TF.tasklogic.todayLocalISO` dipakai `index.html` sejak e8def5ce tetapi tidak diekspor (tes unit memakai mock) → seluruh aplikasi crash saat dimuat. Diekspor + tes di `tests/offline/tasklogic.test.js`.
- **Review akhir (gelombang perbaikan):** client_id sesi deterministik bila `workStartedAt` kosong (`targetEndTime` − 25 menit, ditangkap sebelum dikosongkan; lalu ref stabil) + ref sesi selesai mencegah `handleTimerComplete` ganda (post, `sessionCount`, suara, notifikasi); `pomolog.ackPushed` menolak saat `tx.onabort`; tes migrasi DB lama dengan baris task; E2E jam palsu dipatok tengah hari lokal, screenshot header terang desktop, skenario e membuktikan kedua tab mencatat sesi (dedupe nyata).
- **Verifikasi:** pytest 835; JS 2251/2252 (pra-ada `draw_local_reactive`); `check_inline_scripts` OK; E2E `temporary_files/e2e_focus_target.py` **41/41** (a pemilih 3 → reload → server, 5+ ×3 → 5/6/7 + `×7`; b header `0 / 9 … (~4 jam)`; c sesi 25 menit lewat `page.clock` → `1 / 7`, header X=1, server + 1 baris log, reload; d estimasi 1 + 2 sesi → `is-over`, timer bisa mulai lagi; e dua tab sesi sama → keduanya enqueue `client_id` yang sama, server 1 baris log, +1; f offline → lokal +1, online → tepat 1 baris; 375 px tanpa scroll horizontal). Screenshot terang + gelap, desktop + 375 px di `temporary_files/e2e_focus_target/` (di-.gitignore).
- **Sisa minor:** header X = `sessionCount` timer (lokal per perangkat, bukan dari server); tab kedua yang sudah terbuka dan idle bisa menimpa `workStartedAt` di `tf_pomo_state`; hitungan ganda singkat mungkin terjadi antara respons push yang hilang dan push berikutnya; "Waktu fokus" tidak bertambah saat jam dimajukan di E2E (artefak tes `fast_forward`).
- **Berikutnya:** review akhir → draft PR; setelah itu PR C (Overtime), D (suara latar).

## 🟠 Fokus Hari Ini PR A: Parkir Distraksi + Mode Zen — `claude/focus-page-enhancement` — 2026-10-20 (Claude) — DI-MERGE (#62, f78790d) 22:08 WIB; TUNGGU RESTART `taskflow-web`
- **Status:** frontend saja. SW **v434** `taskflow-v434-focus-park-zen` (`main` masih v433), `app.css?v=342`. Setelah merge + deploy: restart `taskflow-web` (`sw_cache`).
- **Isi:** `static/offline/focuspage.js` (`window.TF.focuspage`: payload parkir, status Zen, preferensi `tf_focus_zen`); Parkir Distraksi di kartu Pomodoro (`.pomo-park`, Enter -> task inbox P2 lewat router lokal offline-first, lalu `__refreshTasks()`); Mode Zen (`.focus-zen-btn`, root `.focus-page.is-zen` saat toggle on + mode Work + timer berjalan; task lain + "Berulang hari ini" memudar/tersembunyi, task fokus tetap terbuka, `.focus-zen-note`).
- **Verifikasi:** pytest 816; JS 2195/2196 (pra-ada `draw_local_reactive`); `check_inline_scripts` OK; E2E `temporary_files/e2e_focus_page.py` **35/35** (parkir sukses/ganda/spasi/offline->online, Zen sembunyi/Jeda/Mulai/Short, reload, shortcut, 375 px tanpa scroll horizontal); screenshot terang + gelap di `temporary_files/e2e_focus_page/` (di-.gitignore).
- **Sisa minor:** catatan Zen juga tampil saat loading/daftar kosong; dengan Work berjalan tanpa task fokus semua task tersembunyi; Parkir mengosongkan teks yang diketik selama request berjalan; placeholder Parkir terpotong di 375 px.
- **Berikutnya:** PR B (Target 🍅, backend), C (Overtime), D (suara latar).

## 🟡 Halaman Fokus Hari Ini: Parkir Distraksi, Target 🍅, Mode Zen, Suara Latar, Overtime — `claude/focus-page-enhancement` — 2026-10-20 (Claude) — SELESAI: PR A (#62), B (#64), C (#65), D (#67) DI-MERGE. Sisa: E2E skenario g (autoplay ditolak) di `temporary_files/e2e_focus_ambient.py` flaky ±50% di Chromium headless (kebijakan autoplay browser, bukan bug app); belum dites di iPhone/Safari.
- **Status:** brainstorming selesai; desain dan pendekatan A (log append-only `pomodoro_log` + kolom turunan `tasks.pomodoros_done`, idempoten lewat `client_id` deterministik per sesi) disetujui Bapak. Spec `docs/superpowers/specs/2026-10-20-fokus-hari-ini-enhancement-design.md` (salinan Project claude.ai "alurik" `claude/spec-fokus-hari-ini-2026-10-20.md`). **PR A (Parkir Distraksi + Zen) di-merge (#62); PR B (Target 🍅) di-merge (#64); PR C (Overtime) di-merge (#65); PR D (Suara latar) diimplementasi di branch `claude/focus-ambient` (lihat entri teratas, belum di-push). Setelah PR D di-merge, keempat PR (A–D) selesai.**
- **Keputusan Bapak:** Work 00:00 selalu tanya (tanpa toggle Auto-Overtime); Overtime yang berhenti di tengah hanya +1 🍅 dari sesi utama (🍅 tambahan per kelipatan penuh 25 menit); realisasi 🍅 kumulatif per task di server; suara latar disintesis sendiri.
- **Berikutnya:** setelah spec disetujui → writing-plans, lalu 4 PR berurutan: A Parkir Distraksi + Zen (frontend), B Target 🍅 (backend + offline + UI, ADR-021, migrasi → restart `taskflow-web` + `taskflow`), C Overtime (frontend), D Suara latar (frontend + aset + cache SW `alurik-ambient-v1`).

## 🔵 Dashboard: welcome card hanya untuk akun kosong — `claude/dashboard-intro-gate` — 2026-10-20 (Claude) — DI-MERGE (#59, e953906) 17:21 WIB, DEPLOY WORKFLOW SUKSES; TUNGGU RESTART `taskflow-web`
- **Status:** frontend saja. SW **v431** `taskflow-v431-dashboard-intro`, `app.css?v=339` (`main` sudah v430 / 338 dari #58). Setelah deploy: restart `taskflow-web` (`sw_cache`). Bila `main` memakai v431 lebih dulu, naikkan ke nomor kosong berikutnya. Spec `docs/superpowers/specs/2026-10-20-dashboard-welcome-sync-gate-design.md`, rencana `docs/superpowers/plans/2026-10-20-dashboard-welcome-sync-gate.md` (salinan di Project claude.ai "alurik").
- **Isi:** `static/offline/introgate.js` (`decideIntro`, `hasLocalData` = task/note `!deleted` → input keputusan intro, `hasLocalTasks` = task `!deleted` → keputusan refresh, penanda `_meta` `initial_sync:v1 {user_id, at}`); `sync()` mengisi `window.__syncState` + event `tf:sync-state`, menulis penanda + `tf:initial-sync` hanya bila pull task **dan** pull note sukses, penanda belum ada, **dan** sesi masih sama dengan saat run dimulai (uid `tf_user_id` + `window.__userEpoch`, yang dinaikkan `clearLocalUserData` paling awal; `clearLocalUserData` juga me-reset `__syncState` + memancarkan `tf:sync-state`); `Dashboard` → `useIntroState(tasks)` + `DashSyncCard` ("Menyinkronkan data kamu dari server…" / "Belum terhubung ke server" / "Gagal mengambil data dari server" + "Coba lagi"); welcome card + "Selamat datang di Alurik!" hanya untuk `welcome`. `window.__refreshTasks()` dipanggil dari hook (saat mount dan saat `tf:initial-sync`) hanya bila `tasks` App kosong, store `tasks` punya task hidup, dan `window.__fetchAllInFlight` false (fetchAll menyetelnya selama berjalan, try/finally) → login pertama perangkat baru = tepat satu sync penuh; akun hanya note tidak pernah memicu refresh.
- **Verifikasi (Task 4):** pytest 816; JS 2153/2154 (pra-ada `draw_local_reactive`); E2E `temporary_files/e2e_dashboard_intro.py` **62/62** (2 run berturut) — a perangkat baru + pull ditahan 3 dtk tanpa welcome; a2 akun hanya task; b akun baru → welcome; c offline → online tanpa reload; d task+note 500 → "Coba lagi"; d2 hanya pull note 500 → penanda tidak ditulis; e akun hanya note; f hapus semua → welcome, juga reload offline lewat SW; g anggota workspace; h logout → akun baru → akun lama lain. "Welcome tidak pernah muncul" dicek polling 100 ms **dan** MutationObserver (a, a2, c, d, d2, e, g, h). Screenshot terang + gelap di `temporary_files/e2e_dashboard_intro/` (di-.gitignore). Context Playwright memakai `service_workers="block"` (route tidak melihat fetch dari SW) kecuali (f) yang butuh SW untuk app shell offline.
- **E2E menemukan bug → 5158955:** akun bertask tanpa note (a2, g) sempat merender welcome ±1–2 ms saat `tf:initial-sync` (penanda terbaca sebelum `hasLocalData`, `ReactDOM.render` legacy tidak mem-batch). Diperbaiki di 5158955: `useIntroState` membaca keduanya lewat `Promise.all` dan meng-commit dalam satu update state.
- **Review akhir (perbaikan, commit "fix(dashboard): perbaikan review akhir …"):** penanda per sesi (uid+epoch saat run dimulai), tanpa sync ganda di login pertama (`__fetchAllInFlight` + `hasLocalTasks`), pembacaan mount refresh=true tidak lagi tergantikan efek `[tasksLen]` (run pertama dilewati), `__syncState` di-reset saat logout. E2E kini 64/64 (a10: tepat 1 pull task sync saat login pertama; e6: akun hanya note tanpa pull task tambahan). JS 2164/2165 (pra-ada `draw_local_reactive`), pytest 816.
- **Sisa diketahui:** hook tidak punya pemicu refresh sendiri saat online lagi — event `online` menjalankan `sync()` global (di luar fetchAll); bila penanda baru ditulis → `tf:initial-sync` → satu `__refreshTasks` (disengaja, Ruling 5; skenario c); bila penanda sudah ada, task baru muncul pada `fetchAll` berikutnya; `__fetchAllInFlight` boolean sederhana (fetchAll tumpang-tindih bisa membersihkannya lebih awal — paling buruk satu refresh ekstra); halaman lain (Today/Tasks/Notes) masih menampilkan kondisi kosong selama sync pertama (di luar cakupan); tanpa penghitung progres per item; placeholder input cepat memakai teks akun kosong ("Awali 'tugas: …'") selama kartu status tampil.

## 🚨 CRITICAL WARNING FROM PAST SESSION 🚨
**ATTENTION ALL AGENTS:** In a previous session, an agent was severely reprimanded by the user for ignoring the Superpowers plugin rules, writing code inline (cowboy coding), breaking the database with untested migrations, and falsely claiming a task was complete without running tests.
**YOU MUST NOT REPEAT THIS.**
1. Read the Superpowers skills (`subagent-driven-development`, `requesting-code-review`, etc.).
2. Delegate implementation and review tasks to SUBAGENTS.

## 🟠 Ikon gaya Alurik di Kelola Workspace + chip Pomodoro mini — `claude/manage-workspace-icons` — 2026-10-20 (Claude) — DI-MERGE (#61, 5bd9b69) 20:29 WIB, DEPLOY WORKFLOW SUKSES; TUNGGU RESTART `taskflow-web`
- **Status:** frontend saja. SW **v433** `taskflow-v433-manage-workspace-icons`, `app.css?v=341`. Setelah deploy: restart `taskflow-web`.
- **Isi:** `SharedListsManager`: ⚙️ 🔗 ❌ 📋 👥 👤 diganti glyph `VIEW_GLYPHS` (`mSettings`, `mLink`, `mXCircle`, `wsTasks`, `mUsers`, `mUser`); ikon baris workspace dalam ubin 40×40 (owner lime, member biru). `TopBarPomodoroChip`: 🍅/☕ diganti `pomoTomato` (merah `--pomodoro`) / `pomoBreak` (hijau `--break`, kelas `is-break`). Toast tidak diubah.
- **Verifikasi:** pytest 816, JS 2179/2180 (pra-ada `draw_local_reactive`), E2E `temporary_files/e2e_tasklist_view_icons.py` 106/106 terang + gelap. Review: siap merge.
- **Sisa:** kartu task masih menampilkan "🍅" di samping jumlah pomodoro (`ftask-count is-pomo`) — di luar cakupan PR ini.

## 🟠 Ikon gaya Alurik di tampilan Berkas Workspace — `claude/workspace-files-icons` — 2026-10-20 (Claude) — DI-MERGE (#60, ff0822d) 19:53 WIB, DEPLOY WORKFLOW SUKSES; TUNGGU RESTART `taskflow-web`
- **Status:** frontend saja. SW **v432** `taskflow-v432-workspace-files-icons` (v431 = PR #59, sudah di-merge), `app.css?v=340`. Setelah deploy: restart `taskflow-web`.
- **Isi:** semua emoji UI di `WorkspaceFilesView` (judul, cari, chip filter, kartu berkas, kosong/tanpa hasil, asal berkas, tombol aksi) diganti glyph inline `VIEW_GLYPHS` (`fFolder`, `fPdf`, `fSheet`, `fImage`, `fFile`, `fSearch`, `fUpload`, `fDownload`, `fEye`, `fChat`, `fPin`, `fTrash`, `fX`). Ikon kartu dalam ubin 40×40 berwarna per kategori. Teks toast dan isi pesan chat `📎` tidak diubah.
- **Verifikasi:** pytest 816, JS 2128/2129 (pra-ada `draw_local_reactive`), E2E `temporary_files/e2e_tasklist_view_icons.py` 80/80 terang + gelap. Review: siap merge.

## 🟠 Tombol Fokus 🎯 (Pomodoro) di tasklist GTD + workspace — `claude/tasklist-focus-pomodoro` — 2026-10-20 (Claude) — DI-MERGE (#58, 5841f5d) 15:34 WIB, DEPLOY WORKFLOW SUKSES; TUNGGU RESTART `taskflow-web`
- **Status:** frontend saja. SW **v430** `taskflow-v430-tasklist-focus`, `app.css?v=338` (main: v429 / 337 setelah #57). Setelah deploy: restart `taskflow-web` (`sw_cache`). Bila `main` memakai v430 lebih dulu, naikkan ke nomor kosong berikutnya.
- **Isi:** App meneruskan `focusTask` + `handleStartFocus` (handler yang sama dengan kartu "Prioritas Hari Ini" dashboard) ke kedua `TaskListView` (GTD default + workspace `slist_*`) → `TaskRow` (tampilan Normal saja; Compact/Kanban tidak) menampilkan `.dash-focus-btn` 🎯 sebelum ⭐ untuk task belum selesai. Klik → task aktif, Pomodoro mulai, chip `TopBarPomodoroChip` di top bar; klik lagi → lepas + jeda; pindah task → timer tidak di-reset. `TodayFocusView` dan badge Hari Ini di sidebar (`todayCount`, prop `focusTaskId`) selalu menyertakan task fokus aktif (tampilan saja). Tooltip ⭐ diubah "… daftar Fokus Hari Ini". Mobile ≤768px: label disembunyikan, tinggi 22px. Pilihan Bapak: hanya tampilan Normal; task aktif selalu tampil di Fokus Hari Ini.
- **Verifikasi:** `tests/offline/tasklist_focus_btn.test.js` 9/9; JS 2120/2121 (pra-ada `draw_local_reactive`); pytest 816; E2E `temporary_files/e2e_tasklist_focus.py` 39/39 (terang + gelap + mobile 375px; screenshot lokal di-.gitignore). Review opus: siap merge.
- **Sisa diketahui (minor):** task offline (`_pending`, id sementara) kehilangan fokus setelah sync mengganti id — sama dengan kartu dashboard yang sudah ada.

## 🟠 Audio & video di note — PR frontend `claude/note-media-ui` — 2026-10-20 (Claude) — DRAFT PR, TUNGGU "MERGE DAN DEPLOY"
- **Status:** SW **v429** `taskflow-v429-note-media`, `app.css?v=337` (v427 dipakai #55 ikon Tasks, v428 dipakai #56 jeda tab workspace). Backend #51 sudah aktif di produksi. Deploy = file statis saja (tanpa migrasi/endpoint baru); **restart `taskflow-web` disarankan** hanya agar `/api/version` melaporkan v429 (`sw_cache` di `webapp.py`). Bila `main` maju (SW v429 terpakai) sebelum merge, naikkan ke nomor kosong berikutnya.
- **Merge main (#56 jeda tab workspace) → SW v429** (`taskflow-v429-note-media`, `app.css?v=337`), 2026-10-20 WIB; konflik hanya string versi/log.
- Sebelumnya: merge main (#55 ikon tampilan Tasks) → SW v428 (`taskflow-v428-note-media`, `app.css?v=337`), 2026-10-20 12:13 WIB; verifikasi: JS 2110/2111 (pra-ada `draw_local_reactive`), pytest 816, E2E 54/54.
- **Isi:** `static/offline/mediadirective.js` (regex/format `::media[cid]{name="…"}`, ekstensi, `client_id`), `mediaupload.js` (manajer unggah potongan 5 MiB + `Upload-Offset`, jeda ulang 1→30 dtk, lanjut setelah reload dengan file yang sama — nama+ukuran+`lastModified`), `mediacard.js` (model kartu `viewFor`/`cardHtml`, escape lewat `TF.safehtml`); kartu mode baca + `window.hydrateMediaCards` (meta saat masuk viewport, `processing` dicek tiap 5 dtk, token kedaluwarsa → meta ulang + posisi/putar dipulihkan); node editor Milkdown + tombol `🎬 Audio/Video` (nonaktif offline, note lokal di-push dulu maks 5 dtk) + `window.__mediaUploads` di App (peringatan `beforeunload`); media di daftar lampiran note; SW: `/media/` tidak di-intercept, `/api/media/…` & `/api/scratchpad/<id>/media…` network-only (offline → 503 `OFFLINE`, tanpa cache); CSP Tauri `media-src 'self' blob: https://todo.yatno.web.id`.
- **Gelombang perbaikan review akhir (2026-10-20 12:08 WIB):** hak hapus baris daftar lampiran dari `user_id`; 🎬 menyisipkan node `media` langsung lewat schema + `remarkMediaPlugin` merakit ulang `{name="…"}` yang dipecah remark (`_x_`, `*x*`, `~x~`, backtick, `www.`); bridge pytest menjalankan ketujuh file tes media node (file hilang = gagal); logout → `__mediaUploads.abortAll()` (tanpa DELETE/toast) + `tf_media_uploads` dihapus `clearLocalUserData`; unduhan di Tauri lewat `tf-open-attachment` (AttachmentViewer); refresh URL juga saat `stalled`, kedaluwarsa dihitung dengan jam lokal (header `Date`), maks sekali/30 dtk; kartu: "Gagal" bila error kosong, `safeHref` menolak `/\`, ukuran file di caption; manajer: file tak terbaca → gagal retryable "File tidak bisa dibaca — pilih ulang file", `attempt` direset tiap langkah sukses, exception tak dikenal maks 3x. Laporan `.superpowers/sdd/2026-10-20-note-media-ui/final-fix-report.md` (lokal).
- **Verifikasi (setelah perbaikan):** inline OK; JS 2089/2090 (1 gagal pra-ada `draw_local_reactive`); pytest 816; E2E `temporary_files/e2e_note_media.py` **54/54** dengan SW aktif (9 alur; alur 9 = nama ber-karakter markdown + daftar lampiran Hapus). Sebelumnya: JS 2066/2067, pytest 815, E2E **45/45** (8 alur: unggah mp4+mp3 dari editor, seek → Range 206 bukan dari SW, putus jaringan di tengah 12 MB tanpa ulang dari 0, reload → stalled → file berbeda ditolak → file sama lanjut dari 5 MiB, anggota workspace memutar tanpa Hapus, offline, direktif berbahaya/cid asing → missing, token TTL 5 dtk dipulihkan). Screenshot lokal `temporary_files/e2e_note_media/` (di-.gitignore). SDD 7 task + review per task.
- **Sisa diketahui (minor, ditunda):** direktif mentah (bukan dari editor) dengan `"`, `[x](y)` atau `http://` di nama masih terpecah di editor (nama dari meta tetap benar; dari editor round-trip bersih); unduhan di Tauri memuat seluruh file ke blob (AttachmentViewer) — berat untuk video besar; header `Date` tidak terbaca lintas-origin (Tauri) tanpa `Access-Control-Expose-Headers` → memakai `expires_at` apa adanya; unggahan tetap jalan bila node dihapus/undo/note dibuang (lampiran ready tanpa direktif); `::media` di indented code / fence dalam list-quote / teks link jadi kartu; 401/5xx tampil "offline"; pemutaran berhenti bila NotePanel di-render ulang (tasks/allNotes berubah); subscription/IO kartu terlepas bisa bocor; baris lampiran uploading/processing tanpa tombol batal/hapus; pratinjau daftar note menampilkan direktif mentah (sama dengan `::draw`). Belum dites di HP asli/Safari/Tauri (Chromium Playwright tanpa H.264 → pemutaran diuji dengan WebM).
- **Berikutnya:** saat pindah ke `alurik.com`, tambahkan domain ke `static/config.js` dan CSP Tauri `connect-src`/`media-src`.

## 🟠 Jeda tab workspace di bawah header — `claude/workspace-tabs-gap` — 2026-10-20 (Claude) — DI-MERGE (#56, 7de8276) 12:14 WIB, DEPLOY WORKFLOW SUKSES; TUNGGU RESTART `taskflow-web`
- **Status:** frontend saja. SW **v428** `taskflow-v428-workspace-tabs-gap` (`app.css` tidak berubah, `?v=336`). Setelah deploy: restart `taskflow-web`.
- **Isi:** baris tab Tasks / Files halaman workspace menempel ke garis bawah `.desktop-topbar`; ditambah `marginTop: 16` pada `.workspace-nav-tabs` (setara margin judul `h1` di halaman lain).
- **Verifikasi:** pytest 814, JS 1990/1991 (pra-ada `draw_local_reactive`), E2E `temporary_files/e2e_tasklist_view_icons.py` lulus termasuk ukur jeda 16px terang + gelap.

## 🟠 Ikon tampilan halaman Tasks + tab workspace — `claude/tasklist-view-icons` — 2026-10-20 (Claude) — DI-MERGE (#55, 0c4ed23) 11:18 WIB, DEPLOY WORKFLOW SUKSES; TUNGGU RESTART `taskflow-web`
- **Status:** frontend saja. SW **v427** `taskflow-v427-tasklist-view-icons` (v426 dipakai Kanban #54), `app.css?v=336`. Setelah deploy: restart `taskflow-web` (`sw_cache` berubah). Bila thread lain memakai v427 lebih dulu, naikkan ke nomor kosong berikutnya saat merge.
- **Isi:** toggle Normal / Compact / Kanban di halaman Tasks: karakter Unicode (▦ ▤ ⊞) diganti ikon SVG duotone inline (`VIEW_GLYPHS` + `ViewGlyph` di `static/index.html`, pola `FOCUS_GLYPHS`, tidak bergantung `ui-components.js` yang bisa ter-cache) dan dijadikan grup segmented (`.tl-view-seg`/`.tl-view-btn` di `app.css`, `aria-pressed`, Kanban nonaktif = `aria-disabled` tetap fokus + tooltip). Tab Tasks / Files halaman workspace: emoji 📋/📁 diganti glyph duotone `wsTasks`/`wsFiles`. Perilaku tidak berubah. Pilihan Bapak: set "B · Duotone" + tombol tergabung.
- **Verifikasi:** pytest 814, JS 1866/1867 (pra-ada `draw_local_reactive`), `tests/offline/tasklist_view_icons.test.js` 21/21, E2E `temporary_files/e2e_tasklist_view_icons.py` 52/52 terang + gelap (screenshot lokal di `temporary_files/e2e_tasklist_view_icons/`, di-.gitignore). SDD 2 task, review akhir opus: siap merge.
- **Sisa diketahui (minor):** tab workspace aktif tetap teks putih di atas lime (gaya `btn-primary` lama, kontras lebih rendah dari toggle); tombol toggle 28px (< 44px target sentuh, sama seperti sebelumnya); tes node menambatkan toolbar pada potongan sumber yang peka format.

## 🟢 Audio & video di note — PR backend — 2026-10-20 (Claude) — DI-MERGE (#51), DEPLOY & AKTIF 2026-10-20 — diverifikasi di produksi (HestiaCP: file custom `/home/files/conf/web/todo.yatno.web.id/nginx.ssl.conf_alurik_media`, proxy 127.0.0.1:3002; uji `/tmp/uji_media.py`/curl → Range 206)
- **Status:** branch `claude/note-media-backend` di-merge (#51), aktif di produksi. Backend saja, **tanpa** kenaikan SW. ADR-017 (ADR-016 dipakai Kanban #50). Rencana: `claude/plan-note-media-backend-2026-10-20.md` di Project claude.ai.
- **Isi:** kolom media di `note_attachments` (`migrate_db`); unggah bertahap `POST /api/scratchpad/{id}/media` + `PATCH /api/media/{id}/upload` + `POST …/complete`; `media_storage.py`, `media_probe.py`, `media_worker.py` (ffprobe/faststart/poster), `media_serve.py` (token HMAC + `/media/{token}` dengan `X-Accel-Redirect`/Range); akses lampiran bersama workspace; hapus media + bersihkan unggahan macet; halaman publik `/pub` memutar `::media[...]` (lampiran note itu saja), `/pub/attachments/{id}` media → 302 ke unduhan; DOCX satu baris teks; pratinjau Sampah membuang direktif; blok nginx di `nginx-taskflow.conf`.
- **Verifikasi:** pytest **794** setelah merge `main` (#50 Kanban); di branch sendiri 735 (sebelum perbaikan review akhir 696, baseline main 679), JS tidak disentuh (tak ada file JS berubah); smoke uvicorn lokal `MEDIA_ACCEL=0` (init → PATCH → complete mp4 ffmpeg → worker ready → `Range` → 206), kini juga tes ujung-ke-ujung `test_end_to_end_upload_process_and_range` (ffmpeg sungguhan).
- **Perbaikan review akhir (2026-10-20):** restore dari Sampah langsung mengantrekan media `processing`; worker menolak format ffprobe di luar keluarga sniff (mis. ID3 + AVI) dan menandai `failed` bila exception; trash/hapus saat PATCH/complete → 404 tanpa file yatim; `.part` hilang → `received_bytes` 0 + 409; init: nama dibersihkan dari karakter kontrol/non-XML, `.part` dibuat sebelum commit (507/503), client_id bersamaan idempoten; scan atom faststart maks 10.000; peringatan start bila `ffmpeg`/`ffprobe` tidak ada; tanpa `datetime.utcnow()` baru. Laporan: `.superpowers/sdd/2026-10-20-note-media-backend/final-fix-report.md` (lokal, di-.gitignore).
- **DEPLOY (setelah merge, urut) — (sudah dijalankan 2026-10-20):**
  1. `sudo apt install ffmpeg` (tanpa `ffmpeg`/`ffprobe` start mencatat peringatan; media tetap `ready` tanpa metadata, faststart, poster, dan cek format).
  2. `sudo mkdir -p /var/lib/alurik/media && sudo chown <user service>:<grup service> /var/lib/alurik/media`. File dibuat proses `taskflow-web`, jadi **umask service** menentukan apakah nginx bisa membacanya: (a) `UMask=0022` di `[Service]`, atau (b) `UMask=0027` + `chmod 750` folder + `sudo usermod -aG <grup service> www-data` (lalu restart nginx).
  3. Unit systemd: `sudo systemctl cat taskflow-web` → bila ada `ProtectSystem=strict|full`/`ReadOnlyPaths`, tambahkan `ReadWritePaths=/var/lib/alurik/media` (template `taskflow-web.service` di repo tidak memakai `ProtectSystem`; `PrivateTmp=true` aman karena `.tmp` ada di dalam `MEDIA_ROOT`). Tambah `UMask` dari langkah 2, lalu `sudo systemctl daemon-reload`.
  4. Di `.env` (EnvironmentFile service): `MEDIA_URL_SECRET=` hasil `openssl rand -hex 32`; `MEDIA_ROOT=` hanya bila bukan `/var/lib/alurik/media`.
  5. Tambahkan blok nginx dari `nginx-taskflow.conf` (`/_alurik_media/` internal + lokasi `PATCH …/upload`). **`alias` di `/_alurik_media/` harus sama persis dengan `MEDIA_ROOT` (diakhiri `/`)**. Lalu `sudo nginx -t && sudo systemctl reload nginx`.
  6. `sudo systemctl restart taskflow-web`; cek log tidak ada peringatan `ffprobe/ffmpeg tidak ditemukan` atau `MEDIA_URL_SECRET kosong`.
  7. Verifikasi: token login dari `POST /api/auth/login` (`{"username","password"}` → `token`); unggah satu media lewat API/aplikasi; `curl -s -H "Authorization: Bearer <token>" https://<host>/api/media/<id>` → status `ready` → ambil `play_url`; `curl -sI -H 'Range: bytes=0-99' "https://<host><play_url>"` → **206** dengan `Content-Type` sesuai media (404 = token/akses; 200 tanpa isi = blok nginx belum aktif).
  - **Dev lokal tanpa nginx:** set `MEDIA_ACCEL=0` (Range dilayani Alurik); dengan nilai bawaan `1` `/media/<token>` hanya mengembalikan header `X-Accel-Redirect` tanpa isi.
- **Berikutnya:** PR frontend (pemutar + unggah di editor, naik SW); PR XSS (1b, #49) sudah di-merge, jadi tidak ada yang menahan.

## 🟠 Workspace di-pin di sidebar mode ikon — Bagian B frontend + offline `claude/workspace-pins-ui` — 2026-10-20 (Claude) — DI-MERGE (#53, b336ed2) 10:19 WIB, DEPLOY WORKFLOW SUKSES; TUNGGU RESTART `taskflow-web`
- **Status:** SW **v425** `taskflow-v425-workspace-pins`, `app.css?v=335`. Merge **#52 dulu**, lalu PR ini (retarget ke `main`). Setelah deploy: restart `taskflow-web` (`sw_cache` berubah). Bila thread lain (mis. `claude/kanban-stages-frontend`) memakai v425 lebih dulu, naikkan ke nomor kosong berikutnya saat merge.
- **Isi:** `static/offline/workspacepins.js` (helper murni); `listsync.js` menyimpan `pinned`/`pin_position` + `setLocalPin`; rail: avatar workspace di-pin (maks 5) + "Semua workspace" (ke `manage_lists`) + menu klik kanan/Shift+F10 ("Buka"/"Lepas pin", fokus dipulihkan); tombol "Pin"/"Di-pin" di baris tab halaman workspace; `handleWorkspacePin` (online saja, `network:true`, pull list di `runSyncExclusive`, 409 → toast + segarkan ke kondisi server).
- **Verifikasi:** pytest 814, JS 1845 (pra-ada `draw_local_reactive`), E2E `temporary_files/e2e_workspace_pins.py` 42/42 (screenshot lokal di `temporary_files/e2e_workspace_pins/`, di-.gitignore). SDD 3 task + review per task, review akhir opus → 1 gelombang perbaikan + re-review.
- **Sisa diketahui:** (1) menu klik kanan rail menutup saat `blur` dengan `relatedTarget` null — di WebKit (Safari, Tauri macOS) klik mouse pada item menu mungkin hilang; belum diverifikasi (hanya Chromium di sesi ini). Perbaikan satu baris: `onMouseDown: e => e.preventDefault()` pada kontainer menu. (2) jalur "Gagal menyimpan pin" (5xx/jaringan) belum diuji di E2E. (3) menu rail belum punya navigasi panah.

## 🟠 Workspace di-pin di sidebar mode ikon — Bagian A backend `claude/workspace-pins-backend` — 2026-10-20 (Claude) — DI-MERGE (#52, ad543f6) 10:19 WIB, DEPLOY WORKFLOW SUKSES; TUNGGU RESTART `taskflow-web` + `taskflow`
- **Status:** backend saja (tanpa frontend/SW). Setelah deploy: **restart `taskflow-web` DAN `taskflow` (bot)** — `repository.py` berubah. `migrate_db()` membuat tabel `workspace_pins` + kolom `users.workspace_pins_seeded` (idempoten).
- **Isi:** `workspace_pins (user_id, list_id, position)` maks 5 per user (ADR-018); seed sekali 3 workspace dengan aktivitas task terbaru di `get_lists_for_user` (dilewati tanpa error bila DB terkunci, dicoba lagi pada panggilan berikutnya); `GET /api/lists` menambah `pinned`/`pin_position`; `PUT`/`DELETE /api/lists/{id}/pin` (409 `PIN_LIMIT`, non-anggota 404, DELETE tanpa cek akses); pin dihapus saat keluar/dikeluarkan dari workspace, CASCADE saat workspace dihapus.
- **Verifikasi:** pytest 814 (baseline 794). SDD 2 task + review per task, review akhir opus (simulasi upgrade DB 300 workspace/60k task, 8 thread seed bersamaan) → 1 perbaikan (seed saat DB terkunci) + re-review bersih.
- **Dokumen:** spec `docs/superpowers/specs/2026-10-20-sidebar-workspace-pins-design.md`, rencana `docs/superpowers/plans/2026-10-20-sidebar-workspace-pins.md` (ikut di PR ini; salinan di Project claude.ai "alurik").
- **Berikutnya:** Bagian B (frontend + offline, naik SW) di branch `claude/workspace-pins-ui` yang ditumpuk di atas branch ini; rebase ke `main` setelah PR ini di-merge.

## 🟠 Kanban tahap kustom — PR frontend + offline `claude/kanban-stages-frontend` — 2026-10-20 (Claude) — DRAFT PR, TUNGGU "MERGE DAN DEPLOY"
- **Status:** SW **v426** `taskflow-v426-kanban-stages` (v425 dipakai workspace pins), ADR-019. Setelah deploy: **restart `taskflow-web`** (hanya `sw_cache` di `webapp.py` berubah, agar `/api/version` melaporkan v426). Backend PR #50 sudah aktif (restart dikonfirmasi Bapak 2026-10-20 08:45 WIB).
- **Isi:** `static/offline/contextcache.js` (cache server + tahap pending offline di `_meta contexts:pending:v1`), `context_id`/`context_ref_name` di record task (hydrate/taskrepo/pull, tautan cid pending dijaga saat pull), push tahap offline (`{entity_type:"context", op:"create"}`, op task ditahan sampai tahap punya id server, heal entri tanpa op, 2xx tanpa id = retry), `static/offline/kanbanboard.js` (model papan murni), papan di `TaskListView` (pemilih "Papan:", kolom kosong, "Belum ada tahap"/"Selesai", menu "Pindah ke…", inisial, tanggal WIB), drag Pointer Events (tekan-tahan 250 ms di sentuh, `touch-action: manipulation` + listener `touchmove` non-pasif), kelola tahap ("+ Tahap", menu ⋯ kolom, modal "Kelola tahap" ↑/↓), field Context per scope di form/detail, E2E `temporary_files/e2e_kanban_stages.py`.
- **Keputusan Bapak:** task berulang ke Selesai = tandai hari ini saja (online); keluar dari Selesai = `gtd_status` next.
- **Verifikasi:** npm 1969 (1968 lulus + 1 pra-ada `draw_local_reactive`), pytest 814, inline OK, E2E 51 langkah 0 gagal (headless Chromium, termasuk sentuh CDP dan offline→online). SDD 9 task + review per task (fix round di F1, F2, F4–F7), review akhir opus → 1 gelombang perbaikan + re-review bersih.
- **Sisa diterima:** sentuh belum dicoba di HP asli (terutama iOS Safari); kegagalan permanen buat tahap tidak tampil di conflict bar (hanya toast); halaman "Selesai" di Kanban hanya 7 hari terakhir; Selesai di halaman status (inbox/next/…) memuat semua task selesai 7 hari di scope papan.

## 🟠 Kanban tahap kustom — PR backend `claude/kanban-stages-backend` — 2026-10-20 (Claude) — DRAFT PR, TUNGGU "MERGE DAN DEPLOY"
- **Status:** backend saja (tanpa frontend/SW). Setelah deploy: **restart `taskflow-web` DAN `taskflow` (bot)** — `repository.py` dan `bot.py` berubah; bot lama yang masih jalan menulis teks context tanpa `context_id`. `migrate_db()` membuat tabel `contexts` + `tasks.context_id` dan backfill (idempoten).
- **Isi:** tabel `contexts` (pribadi/W, `position`, `color`, `archived`, ADR-016); backfill dari `tasks.context` (urut alfabetis, ejaan task terbaru, tanpa task aktif → diarsip, sinkron ulang beda kapital); `resolve_task_context` di semua jalur tulis task (web + bot); `GET /api/contexts` tetap `string[]` (kini dari tabel, urut posisi, termasuk tahap kosong) + `?list_id`, `?format=full&scope=all&include_archived=1`; `POST`, `PATCH /{id}` (rename menyebar ke task + bump `updated_at`), `PUT /order`, `DELETE /{id}`; penolakan = 404; 409 `CONTEXT_NAME_TAKEN` / `CONTEXT_ORDER_STALE`; nama ≤ 50 char; filter context (`/list @x` bot dan `GET /api/tasks?context=`) kini NOCASE; picker bot melewati nama yang callback-nya > 64 byte.
- **Verifikasi:** pytest 615 (baseline 556). SDD 4 task + review per task (fix round di Task 1, 3, 4), review akhir opus (termasuk simulasi upgrade DB lama kotor, dua kali, bersih) → 1 gelombang perbaikan + re-review bersih.
- **Untuk PR frontend (spec §7–§8):** route offline `/api/contexts` di `taskroutes.js` masih dari task lokal (tanpa `list_id`/`format`/urutan) — wajib diganti cache `contextcache.js`; push wajib kirim `context_id` + `context_ref_name` sebelum UI rename/hapus diaktifkan; PUT task yang hanya mengirim context tak berubah → 400 "No fields to update" (sama dengan project).
- **Sisa diterima:** context dari teks bebas bot/klien lama tidak dibatasi 50 char (disembunyikan dari picker bot); workspace dihapus → task-nya di-link ulang ke context pribadi pemilik task pada backfill berikutnya (sama dengan project).

## 🔵 Kanban: tahap kustom berbasis Context — spec — 2026-10-19 (Claude) — SPEC DI-MERGE (#48) 2026-10-20, BELUM ADA KODE
- **Status:** spec di-merge atas perintah Bapak ("merge", 2026-10-20 08:05 WIB). Spec `docs/superpowers/specs/2026-10-19-kanban-context-stages-design.md` (salinan di Project claude.ai "alurik" `claude/spec-kanban-context-stages-2026-10-19.md`). Berikutnya: rencana di `docs/superpowers/plans/` lalu implementasi (SDD).
- **Keputusan Bapak (brainstorming 2026-10-19):** tahap kustom memakai Context; context jadi entitas pribadi + per workspace (tabel `contexts` + `tasks.context_id`, pola `projects`, hak kelola opsi C); kolom bawaan "Belum ada tahap" (kiri) dan "Selesai" (kanan, drop = done, isi 7 hari); semua kolom tampil walau kosong (juga P1–P4); urutan kartu otomatis; satu papan = satu scope (pemilih "Papan: Pribadi / W" di halaman campuran); buat tahap boleh offline, kelola lain online; pointer drag (mouse + sentuh), id cid bisa diseret, tanggal Jakarta.
- **Urutan:** PR backend (restart `taskflow-web` + `taskflow`) → PR frontend + offline (naik SW).

## 🟠 Temuan mindmap #4 — PR B `claude/mindmap-findings-b` — 2026-10-19 (Claude) — DI-MERGE (#46, 5cc231e) 2026-10-19; TUNGGU RESTART `taskflow-web` DI SERVER
- **Status:** B1–B6 selesai di branch (dibangun di atas PR A, ruling R3). **PR #44 (PR A) harus di-merge lebih dulu**. Sudah merge PR A terbaru (yang sudah memuat `origin/main` ee5b8d3 / #45) → SW naik ke **v423** `taskflow-v423-mindmap-live`, ADR jadi 015; iframe mind-elixir `?v=145` (`mindmapops.js?v=7` di iframe); `app.css` tidak berubah (`?v=334`). **Deploy wajib `sudo systemctl restart taskflow-web`** (endpoint `GET /api/mindmaps/{mid}/stream` + broadcast di `webapp.py`). ADR-015. PR **#46** di-merge ke `main` (5cc231e) setelah #44.
- **Isi:** merge tiga arah per node di klien `static/offline/mindmapmerge.js` (push 409, pull, router lokal `base_data_json`; konflik field sama di node sama → versi server + salinan "(konflik)" + notice `merge_conflict`); SSE sinyal saja (`mindmap_changed`/`mindmap_deleted`/`mindmap_access_lost`) + `pullMindmapOne`; `static/offline/mindmaplive.js` + `remoteUpdate` iframe (dilewati saat mengetik), "🟢 Langsung"; stream hanya untuk tab mindmap aktif; undo dikosongkan setelah pembaruan jarak jauh; salinan konflik dipakai ulang per `session_id` tab; peta tertaut tidak di-merge/tidak berlangganan.
- **Verifikasi (setelah fix round 1):** pytest 388, JS 1712/1713 (pra-ada `draw_local_reactive`), inline OK, E2E `temporary_files/e2e_mindmap_live.py` 41/41 (screenshot lokal di `temporary_files/e2e_mindmap_live/`, di-.gitignore).
- **Fix round 1:** salinan "(konflik)" dari push 409 / pull → event `mindmapConflictCopy` → toast (kata-kata sama dengan konflik simpan tab; nama editor dari baris server, pemilik yang mengedit → "anggota lain"); toast lama "Peta diubah di perangkat lain…" pada setiap sinkron push dihapus (muncul juga saat merge bersih). Kanvas tidak lagi menerima `load` kedua ±100 ms setelah tab dibuka (timer efek muat hanya bila iframe sudah "ready") dan record yang isinya sama dengan basis tidak memuat ulang kanvas (`offerRemote` → null, `if_updated_at` maju).
- **Perbaikan review akhir:** riwayat undo/redo Outline dikosongkan tiap pembaruan jarak jauh / kanvas dikembalikan (`historyEpoch`); stream SSE ditutup bila pelanggannya dilepas karena antrean penuh (klien menyambung ulang); hasil merge = server memakai `data_json` server apa adanya; toast salinan seluruh peta memakai kata-kata notice `conflict_copy`, bukan "Sebagian perubahanmu bentrok…". Verifikasi: pytest 389, JS 1717/1718 (pra-ada `draw_local_reactive`), inline OK, E2E 41/41.
- **Sisa diketahui:** tab latar belakang tidak live sampai diaktifkan (mengejar saat aktif); setelah 8 kegagalan sambung stream berhenti sampai online/aktivasi tab; notice `merge_conflict` menyebut "Pengguna lain" bila pemenang adalah pemilik peta (server hanya mengisi `last_editor_*` untuk editor ≠ pemilik).

## 🟠 Temuan mindmap #3 #5–#8 — PR A `claude/mindmap-findings-a` — 2026-10-19 (Claude) — DI-MERGE (#44, 770dacd) 2026-10-19 (SW v422, ADR-014)
- **Status:** A1–A9 selesai di branch (sudah merge `origin/main` termasuk PR #43 dan #45; versi SW naik ke v422 dan ADR jadi 014 karena #45 memakai v421/ADR-013). SW **v422** `taskflow-v422-mindmap-trash`; iframe mind-elixir `?v=144`; `app.css` tidak berubah (`?v=334`). **Deploy wajib `sudo systemctl restart taskflow-web`** (migrasi `trashed_mindmaps`, `mindmap_pins`, kolom `mindmaps.search_text` + backfill). ADR-014.
- **Isi:** #5 Sampah mindmap (snapshot, pulihkan id sama, purge 30 hari, tab "Mindmap" di modal Sampah + tombol "🗑 Sampah" di sidebar, offline: cermin `_meta` + op `restore`, `static/offline/mindmaptrash.js`, SW network-only `/api/mindmaps/trash…`); #6 ekspor `mindmaps/*.json|.md`; #7 `search_text` + snippet + `client_id` di `/api/search`; #8 pin pribadi `mindmap_pins`, badge 👥, filter "Semua peta / Pribadi / 👥 W"; #3 kartu link hidup `static/offline/mindmaplinks.js` (kanvas + Outline).
- **Verifikasi:** pytest 378, JS 1683/1684 (pra-ada `draw_local_reactive`) setelah merge #45, inline OK; E2E `temporary_files/e2e_mindmap_findings_a.py` 29/29 (sebelum merge #45).
- **Sisa diketahui:** Outline: klik pertama badge 🔗 pada baris yang belum aktif hanya mengaktifkan baris (tombol aksi muncul, badge bergeser) — perilaku lama, bukan dari PR A. Kartu hidup ikut berubah pada event lokal dan setiap sinkron task (`tf:projects-changed`, review akhir).
- **Berikutnya:** #44 dan #46 sudah di-merge; tinggal `git pull` + `sudo systemctl restart taskflow-web` di server, lalu cek kolaborasi langsung (badge 🟢 Langsung) dan Sampah mindmap.

## 🟠 Pengamanan XSS (PR 1b) — 2026-10-19 (Claude) — DRAFT PR, TUNGGU "MERGE DAN DEPLOY"
- **Status:** branch `claude/xss-hardening` (draft PR). SW **v424** `taskflow-v424-xss-hardening`. Setelah deploy: **restart `taskflow-web` dan `taskflow`** (`bot.py`, `models.py`, `nlp.py` berubah). Cek setelah deploy: file vendor tldraw tersaji dengan Content-Type benar (header `nosniff`), PDF lampiran masih terbuka di browser.
- **Isi:** `safehtml.py` + `static/offline/safehtml.js` (ADR-014); halaman publik (isi, kolom, password, SVG, KaTeX per text node, CSP/nosniff/sandbox); notifikasi + Telegram; mode baca/cetak/ekspor; pratinjau SVG `data:`; mindmap bersama; penampil lampiran; CI menjalankan tes paritas node.
- **Verifikasi:** pytest 556, JS 1833/1834 (pra-ada `draw_local_reactive`), E2E XSS dua akun `temporary_files/e2e_xss.py` 41/41.
- **Berikutnya:** PR CSP untuk seluruh aplikasi (juga pindahkan token dari query `?token=`).

## 🟠 Drawing milik workspace — PR 3 frontend + offline — 2026-10-19 (Claude) — DI-MERGE (#45) & DEPLOY
- **Status:** branch `claude/drawing-workspace-ui` (draft PR). SW **v421** `taskflow-v421-drawing-workspace`, `app.css?v=334`. Tidak ada perubahan backend selain string versi → setelah deploy cukup **restart `taskflow-web`**.
- **Isi:** `static/offline/drawingshare.js` (baru, ADR-013); scope di `drawingrepo`/`drawingroutes`/`syncpull`/`syncpush`/`syncconflict`; halaman Draw (👥 Share, badge, filter Semua/Pribadi/W, aksi khusus pemilik, dialog "Drawing masih dipakai"); note (sisip per scope, buat baru di W, banner editor, badge + salin di embed, placeholder); dialog share/unshare note dan keluar workspace.
- **Verifikasi:** pytest 358, JS 1633/1634 (pra-ada `draw_local_reactive`), E2E dua akun `temporary_files/e2e_drawing_workspace.py` 28/28 (screenshot `temporary_files/e2e_drawing_workspace/`). E2E menemukan bug urutan muat skrip (diperbaiki). Review akhir opus → perbaikan `base_rev` saat share (edit anggota bisa hilang), scope rekaman lama, gerbang push share note.
- **Sisa:** canvas tldraw tidak ikut E2E (vendor tidak ada di checkout); daftar drawing di halaman workspace belum ada (pakai filter di Draw).
- **Berikutnya:** PR XSS (1b).

## 🟠 Drawing milik workspace — PR 2 backend — 2026-10-19 (Claude) — DI-MERGE (#43), backfill jalan 16:16 WIB (1 drawing)
- **Status:** branch `claude/drawing-workspace-backend` (draft PR). Backend saja, **tanpa** kenaikan SW. Setelah deploy: **restart `taskflow-web` dan `taskflow`** (`repository.py` berubah). `migrate_db` menambah kolom + backfill sekali jalan.
- **Isi:** `drawing_scope.py` (ADR-012); akses anggota W ke drawing (GET/PUT), hapus/pin/share hanya pemilik; `GET /api/drawings?shared=1`; `PATCH /api/drawings/{id}/share` (409 `DRAWING_IN_USE`), `POST /api/drawings/{id}/copy`, `GET /api/lists/{id}/drawings`, `GET /api/lists/{id}/leave-impact`; respons note membawa `moved_drawings`/`unresolved_drawings`; halaman publik & ekspor DOCX ikut akses baru.
- **Aturan penting:** server memindah drawing ke W hanya saat note di-share/dibuat di W (bukan saat autosave) — sisip ke note W yang ada akan di-share eksplisit oleh klien PR 3.
- **Verifikasi:** pytest 358, JS 1568/1569 (pra-ada `draw_local_reactive`). SDD 5 task, review per task, review akhir opus → perbaikan (bypass varian `::DRAW`, regex case-insensitive, scope query publik) + re-review bersih.
- **Berikutnya:** PR 3 (frontend + offline drawing workspace), lalu PR XSS (1b).

## 🟠 Project per scope di aplikasi — PR 5 (frontend + offline) — 2026-10-19 (Claude) — DI-MERGE (#41)
- **Status:** PR #41 di-merge 2026-10-19. SW **v419** `taskflow-v419-project-scope`, `app.css?v=334`. Backend kecil (`scope=all`, `project_id` terhapus diabaikan, `task_count`) → **restart `taskflow-web`** setelah deploy.
- **Isi:** `static/offline/projectcache.js` (ADR-011), route lokal `GET /api/projects` per scope, `project_id` + `project_ref_name` di record/push/adopt, form task: pilihan scope + "Assign ke" di baris atribut cepat dan dropdown per scope (juga detail & wizard GTD), sidebar/pengelompokan per scope + badge 👥, modal "Kelola project" (online, `{network:true}`), E2E `temporary_files/e2e_project_scope.py` (20/20, screenshot di `temporary_files/e2e_project_scope/`).
- **Verifikasi:** pytest 307, JS 1520/1521 (pra-ada `draw_local_reactive`), inline OK, E2E 20/20. SDD 6 task + review per task (fix round di Task 4 & 5), review akhir opus → perbaikan (perangkat basi setelah rename/hapus, "Assign ke", bypass cache SW, kanban) + re-review.
- **Sisa diterima:** pindah project offline ke project yang dihapus sebelum push → tetap di project lama; form edit yang dibuka sebelum pull rename lalu disimpan dengan nama lama → membuat ulang nama lama; chip "👥 shared" di kartu task workspace belum menyebut nama workspace.
- **Berikutnya (urutan Bapak):** PR 2–3 (drawing workspace), lalu PR XSS (1b).

## 🟠 Project sebagai entitas pribadi/workspace — PR 4 backend — 2026-10-19 (Claude) — DI-MERGE, DEPLOY & AKTIF (restart + cek data 13:19 WIB: 14 pribadi, 1 workspace, 7 arsip, 0 belum tertaut)
## 🔵 Audio & video di note — spec — 2026-10-19 (Claude) — SPEC DISETUJUI; BACKEND = PR `claude/note-media-backend` (lihat entri di atas), frontend belum
- **Status:** spec `docs/superpowers/specs/2026-10-19-note-media-audio-video-design.md` (salinan di Project claude.ai "alurik" `claude/spec-note-media-audio-video-2026-10-19.md`), draft PR dari `claude/note-media-spec`. Setelah Bapak menyetujui: rencana di `docs/superpowers/plans/` lalu implementasi (SDD).
- **Keputusan Bapak (brainstorming 2026-10-19):** semua jenis media (suara pendek s.d. video ratusan MB); kuota per paket di sesi terpisah (v1 hanya `MEDIA_MAX_FILE_MB`); penyimpanan `local`/`r2` mulai dari disk VPS, disajikan endpoint Alurik + nginx `X-Accel-Redirect` (Range oleh nginx) dengan URL bertanda tangan HMAC; pemrosesan ringan (ffprobe, faststart, poster, tanpa konversi); unggah hanya online, bertahap & bisa dilanjutkan; belum ada rekam langsung; halaman publik bisa putar + unduh mengikuti password note; media = lampiran milik satu note (`note_attachments` + kolom baru); **semua lampiran note bersama dibuka untuk siapa pun yang bisa membuka note** (hapus: pengunggah/pemilik note); player dari direktif `::media[<client_id>]`, HTML mentah tetap di-escape (PR 1b XSS sesi lain); pemutaran butuh koneksi.
- **Urutan:** PR backend (butuh `apt install ffmpeg`, `MEDIA_ROOT`, `MEDIA_URL_SECRET`, blok nginx, restart `taskflow-web`) → PR frontend (naik SW) setelah PR 1b XSS di-merge.

## 🟠 Project sebagai entitas pribadi/workspace — PR 4 backend — 2026-10-19 (Claude) — DI-MERGE & DEPLOY (BELUM RESTART)
- **Status:** PR #36 di-merge Bapak (`3d87d22`, 2026-10-19 13:09 WIB), Deploy run #906 sukses (migrasi `projects` + backfill sudah jalan via `migrate_db()`). Branch `claude/project-entities-backend`. Backend saja (`webapp.py`, `repository.py`, 3 file tes); tanpa frontend/SW. Migrasi otomatis di `migrate_db()` (tabel `projects`, `tasks.project_id`, backfill). **Deploy wajib restart `taskflow-web` DAN `taskflow` (bot)** karena `repository.py` berubah.
- **Urutan kerja yang disepakati Bapak (2026-10-19):** PR 4–5 (project) → PR 2–3 (drawing workspace) → PR XSS (1b). PR audio/video di note dikerjakan Bapak di sesi lain.
- **Isi:** tabel `projects` (ADR-010), resolver `resolve_task_project` di semua jalur tulis task (web + bot), API `GET/POST/PATCH/DELETE /api/projects` (opsi C), bot `/projects` membaca tabel.
- **Verifikasi:** pytest 299/299, JS 1366/1367 (pra-ada `draw_local_reactive`), simulasi upgrade DB lama (backfill dua kali, data yatim tidak menggagalkan migrasi). Proses SDD: 3 task + review per task, review akhir (opus) + 1 gelombang perbaikan (backfill tahan FK rusak, resolusi hanya saat project berubah, perbaikan link basi, validasi warna) + re-review.
- **Untuk PR 5 (frontend):** dropdown per scope (`GET /api/projects?list_id=`), kirim `project_id` dan `base_rev` task (tutup batasan rename offline), adopsi `project`/`project_id` dari respons (`taskAdopt`), cache per scope, UI kelola project (`format=full`, `can_manage`), validasi warna `#rrggbb`.

## 🟢 Keamanan halaman publik & ekspor DOCX (PR 1 spec drawing/project workspace) — 2026-10-18 (Claude) — DI-MERGE, DEPLOY & AKTIF
- **Status:** PR #35 di-merge oleh Bapak (`67861fb`, 2026-10-19 11:06 WIB, setelah main di-merge ke branch di `8ef11dd`; CI hijau), Deploy Taskflow V4 run #905 sukses. Backend saja (`webapp.py` + 3 file tes baru); tanpa migrasi, tanpa frontend, tanpa kenaikan SW. `taskflow-web` sudah di-restart Bapak (2026-10-19 11:17 WIB) dan terverifikasi aktif: `curl -s -o /dev/null -w "%{http_code}" https://todo.yatno.web.id/pub/attachments/123456789012345678901234` → `404` (kode lama: `500`). Catatan umum: workflow deploy tidak me-restart service (`ExecStart` = `python webapp.py`, tanpa reload).
- **Konteks:** Bapak menyetujui spec `docs/superpowers/specs/2026-10-18-workspace-drawing-project-design.md` (drawing & project sebagai entitas workspace; hak kelola project opsi C). Urutan PR di §6: PR 1 keamanan (ini) → PR 2 drawing workspace backend → PR 3 frontend/offline → PR 4 project backend → PR 5 project frontend/offline. Salinan spec juga di Project claude.ai "alurik" (`claude/spec-workspace-drawing-project-2026-10-18.md`); keduanya harus tetap sama.
- **Yang ditutup:** `/pub/drawings` terbuka untuk drawing siapa pun; render publik mencari drawing tanpa filter pemilik (id/judul) + fallback `id = note_id`; seksi kanvas legacy per-note (dihapus); lampiran note berpassword; "Related" & wikilink membuka note berpassword; metadata user lain mentah (XSS lintas user); ekspor DOCX drawing & lampiran lintas user.
- **Aturan inti (ADR-009):** note publish **tepercaya** = `list_id` kosong + pemilik = penerbit + `last_edited_by` kosong/pemilik. Hanya note tepercaya yang menampilkan drawing penerbit dan me-resolve wikilink ke note berpassword penerbit. Note publish bersama belum menampilkan drawing (PR 2: drawing dengan `list_id = W`).
- **Verifikasi:** pytest 223/223 (baseline 178), JS 1311/1312 (pra-ada `draw_local_reactive`), smoke uvicorn. Proses SDD: 4 task + 1 gelombang perbaikan, review per task, review akhir (opus) + re-review — semua Critical/Important ditutup.
- **Belum ditangani (sudah dilaporkan ke Bapak):** (1) **XSS tersimpan** di halaman publish (`mistune escape=False`, tanpa sanitasi/CSP, satu origin dengan app yang menyimpan token di localStorage) — PR 1b, butuh keputusan HTML yang diizinkan; (2) **SSRF** `docx_exporter._resolve_image_bytes` + traceback di respons ekspor; (3) lampiran note bersama di app masih hanya untuk pengunggah (bertentangan dengan prinsip 1); (4) `POST/PUT /api/scratchpad` 500 untuk `[[<20+ digit>]]` (`_resolve_linked_to`); (5) minor: `Cache-Control` respons unlock, helper tes duplikat.
- **Catatan untuk agent berikutnya:** PR 2 harus memakai aturan aktor yang sudah dikoreksi di spec §4.4 (hanya drawing milik aktor yang pindah ke W) dan aturan publik §4.3 (note tepercaya → drawing yang bisa diakses penerbit; note bersama → `list_id = W`). Helper yang tersedia: `_DRAW_DIRECTIVE_RE`, `_draw_tokens`, `_draw_token_id` (batas id SQLite), `_resolve_owned_drawing`, `_pub_note_unlocked`, `_published_drawing_for_request`, `_wikilink_target_ok`, `_pub_href`.

## 🟡 Petakan — catatan ↔ mindmap tertaut (cermin murni) — 2026-10-19 (Claude) — SELESAI: PR #33, #34, #37 DI-MERGE & DEPLOY (restart dikonfirmasi Bapak)
- **Status:** PR #33 (`notemap.js`) dan PR #34 (backend, butuh `sudo systemctl restart taskflow-web`) sudah di-merge. **PR 3/3 di-merge** (#37, `5df467c`; restart `taskflow-web` dikonfirmasi Bapak 2026-10-19 13:29 WIB) `claude/petakan-3-ui`: repo/route lokal peta tertaut (idempoten per catatan, serial per catatan), `noterepo.applyMapEdit` (CAS di transaksi IndexedDB), push (tahan sampai catatan punya id server, gabung duplikat dua perangkat, 404/400 tertaut ditangani, tanpa salinan konflik), pull (`?linked=1`, `source_note_cid` dari idmap, tanpa salinan konflik/remote_deleted untuk tertaut), mode tertaut iframe (ringkasan, Ctrl/Cmd+Click, menu konteks, sembunyikan panah/summary/link/format blok, undo diteruskan ke induk), `notemapsession.js` + sesi di `MindmapTabInstance` (jeda 800 ms, planWrite noop/write/overflow/unsafe[unclosed|structure]/reload, konfirmasi hapus, undo/redo 20 dengan blokir, view-state saja ke server dengan `touched`, gen sesi + `nm.ns` agar sid basi/asing tidak pernah ditulis, keluar Focus Mode saat muat ulang), outline tertaut, buka catatan tepat di heading (modal + halaman Notes), tombol 🧠 Petakan/Buka peta, "+ Dari Catatan", badge. SW **v416** `taskflow-v416-petakan`, iframe `?v=142`. Verifikasi: JS 1458/1459 (pra-ada `draw_local_reactive`), pytest 299/299, inline OK, Playwright 54 alur + 13 alur perbaikan akhir. Hanya file statis → deploy tanpa restart (kecuali agar /api/version melaporkan v416). Review per task + review akhir (1 Critical Focus Mode + 3 Important diperbaiki, re-review bersih).
- **Sisa (tidak memblokir):** judul tab/sidebar baru ikut setelah pull bila root diganti nama; salinan dari clipboard sebelum sebuah tulis menjadi heading kosong; tab peta tertaut mengabaikan `mindmapSynced` (view-state perangkat lain tampil setelah dibuka ulang); pemeriksaan Sampah hanya bila catatan sudah punya id server; bug pra-ada: listener ganda `init()` pada peta biasa, Milkdown memformat ulang catatan saat modal ditutup.
- **Inti keputusan:** dua arah; cermin murni dengan catatan sebagai satu-satunya sumber data; peta tertaut = baris `mindmaps` + `source_note_id`, `data_json` hanya pengaturan tampilan; ringkasan per node berbasis aturan (kalimat pertama + 3 butir daftar + baris hitungan); Ctrl/Cmd+Click, klik kanan, atau tombol Ops → `NoteModal` di atas peta tepat di heading (tetap di halaman Mindmap); pemilik dan `list_id` peta = catatan; edit yang bentrok dibatalkan; tanpa LLM.
- **Temuan review fitur mindmap (2026-10-18) — belum dikerjakan, Bapak minta diselesaikan satu per satu nanti:**
  1. **[DIPERBAIKI — PR #38, di-merge]** Link quick-create di Outline (`LinkPickerModal` → `api.post` lokal) menyimpan cid; pull task/mindmap membuat cid baru (`syncpull.js` `ensureCid` / `ensureMindmapCid`) → link mati di perangkat lain. Note aman (pull memakai `client_id` sebagai cid). Dibuktikan probe node.
  2. **[DIPERBAIKI — PR #39, di-merge]** Picker link di iframe kanvas memakai `fetch` mentah (`/api/search`, POST scratchpad/tasks/mindmaps) → tidak jalan offline, item baru belum ada di IndexedDB sampai sync berikutnya, APK tanpa `API_BASE`.
  3. **[SELESAI — #44]** Kartu link node = snapshot (judul/prioritas/deadline/status saat ditautkan), tidak ikut berubah.
  4. **[SELESAI — #46]** Kolaborasi mindmap bersama tidak real-time (sync 30 detik; edit bersamaan → salinan konflik seluruh peta).
  5. **[SELESAI — #44]** Hapus mindmap = hard delete (tanpa Sampah/riwayat).
  6. **[SELESAI — #44]** Mindmap tidak ikut `/api/export/download`.
  7. **[SELESAI — #44]** Global search `data_json LIKE` cocok ke kunci JSON ("topic", "children"); hasil hanya judul.
  8. **[SELESAI — #44]** Kecil: pin oleh anggota gagal diam-diam (pin hanya pemilik); sidebar tanpa penanda peta bersama; state `filterListId` tanpa UI.
  9. **[DIPERBAIKI — PR fix #9, branch `claude/mindmap-fix-9-toc`]** Daftar isi mode baca (`extractHeadings`) ikut menghitung baris `#` di dalam blok kode → item palsu dan indeks `note-h-*` bisa bergeser.
  Detail dan lokasi kode: doc project claude.ai `claude/fitur-mindmap-2026-10-18.md`.
  - **#3–#8: spec + rencana 2026-10-19; #3 #5 #6 #7 #8 selesai di PR A (draft, lihat bagian atas; deploy butuh `sudo systemctl restart taskflow-web`), #4 menunggu PR B:** spec `docs/superpowers/specs/2026-10-19-mindmap-findings-3-8-design.md`, rencana `docs/superpowers/plans/2026-10-19-mindmap-findings-3-8.md` (15 task). PR A `claude/mindmap-findings-a` (#5 Sampah snapshot `trashed_mindmaps` + cermin offline `_meta` + op `restore`; #6 ekspor `mindmaps/*.json|.md`; #7 kolom `search_text` + snippet + `client_id` di `/api/search`; #8 `mindmap_pins` per user, badge 👥, filter workspace; #3 `mindmaplinks.js` kartu hidup dari router lokal). PR B `claude/mindmap-findings-b` setelah PR A: #4 SSE `/api/mindmaps/{id}/stream` + `mindmapmerge.js` (merge tiga arah per node di klien saat 409/pull, basis `base_data_json`; field sama di node sama → server menang + salinan "(konflik)"). Kedua PR butuh restart `taskflow-web`.

## 🔵 Workflow tim + jadwal 62 sesi migrasi mobile + papan pemantauan — 2026-10-18 (Claude) — NEEDS REVIEW
- **Status:** PR #32 dari `claude/mobile-plan`, base `main` (PR #29 sudah di-merge 19 Okt, `f5d6417`). Hanya `scripts/mobile_schedule.py`, `docs/mobile/{plan.json,README.md}`, `.agents/*`; tidak ada kode app/SW, tidak perlu restart. Tunggu "merge dan deploy" (sesi S01).
- **Isi:** penjadwal (Bapak Sen/Sel/Kam/Sab, Dev A & Dev B Sen–Kam, 1 sesi/orang/hari, dependensi, jeda closed testing 14 hari dan review produksi Play ≤ 7 hari) → `plan.json` 62 sesi, 153 jam, 19 Okt–15 Des 2026. Tonggak: App Store 26 Nov (S57), Google Play 3 Des (S43), lepas Tauri mobile 10 Des (S61, setelah rilis Play disetujui), retrospektif 15 Des (S62).
- **Di proyek Claude "alurik":** Playbook Pengembangan Alurik Mobile (sesi = issue = branch = PR; jendela merge Sen–Kam 20.00, `perlu-restart` hanya Sel/Kam; branch bertumpuk; CI `npm test` mulai S03; env cloud bersama dibuat Owner; kontrak data papan) dan Papan Sesi Alurik (artifact privat dengan db `sessions/Sxx` + `plan/meta`; status belum/jalan/review/selesai/hambat, jam aktual, riwayat 8 entri). Developer perlu akses Contributor (satu organisasi) atau undangan Editor.
- **Temuan yang memengaruhi rencana:** ADR kandidat mobile diberi label sementara ADR-M1..M6; nomor final diambil saat S07 (ADR-007 dipakai PR #30, ADR-008 dipakai Petakan/PR #31). ADR-007 sudah memasang perpanjangan token geser + `/api/auth/refresh` → S07/S19 menyelaraskan prinsip token native dengannya. `gen-keystore.yml` mencetak keystore + sandi ke log Actions; sertifikat APK yang beredar (CN=TaskFlow, dibuat 13 Jun 2026) cocok dengan workflow itu dan run-nya sudah dihapus (API: 0 run) → S06 memastikan apakah repo sudah publik saat itu; bila ya atau ragu, kunci upload baru + Play App Signing. Verifikasi developer Android aktif di Indonesia sejak 30 Sep 2026 untuk instalasi dari toko yang ikut serta; APK dari browser belum dibatasi, diperluas ke semua app 2027 → nama paket didaftarkan di S06. `test.yml` baru menjalankan pytest; `npm test` masuk di S03.
- **Menunggu Bapak:** setujui playbook & jadwal; susunan tim nyata; akun Play/Apple pribadi vs organisasi; repo publik/privat; OTA ya/tidak; bagikan papan ke developer.

## 🟢 Sesi login koheren antar-tab + perpanjangan token otomatis — 2026-10-17 (Claude) — DI-MERGE & DEPLOY (BELUM RESTART)
- **Status:** PR #30 di-merge (`fcd64e3`) atas persetujuan Bapak (2026-10-17 23:53 WIB, setelah dipastikan tidak memunculkan lagi bug data akun A tampil di akun B), Deploy Taskflow V4 run #898 sukses. SW **v415** `taskflow-v415-multi-tab-session` (app.css tidak berubah, v=333). **`taskflow-web` belum di-restart dari sesi ini** — kode server (refresh token, urutan header→cookie) baru aktif setelah restart; sebelum itu klien v415 tetap jalan (panggilan `/api/auth/refresh` gagal diam-diam, perpanjangan belum terjadi). **Deploy wajib `sudo systemctl restart taskflow-web`** (endpoint baru `/api/auth/refresh`, klaim token baru, urutan header→cookie); tanpa migrasi DB, token lama tetap valid.
- **Laporan Bapak:** "sudah login, pindah tab, kadang perlu login kembali".
- **Penyebab (direproduksi Playwright, `temporary_files/repro_multi_tab_session.py`):** `__token` per tab dibaca sekali saat dimuat, tanpa sinkronisasi dengan `localStorage.tf_token` bersama. S1: login di tab A tidak memulihkan tab B yang sudah di form login. S2: 401 telat di tab basi menghapus token baru A dari localStorage. S3: logout di A tidak mengeluarkan B (IndexedDB sudah dihapus). Ditambah JWT 72 jam tanpa perpanjangan dan, sejak PR #26, tiap 401 langsung memunculkan form login saat tab kembali aktif. Server: cookie selalu menang atas header walau tidak valid/beda akun.
- **Perbaikan:** klien — `onSharedTokenChanged` (storage/visibility/focus/pageshow), `handleAuthExpired(failedToken)` (adopsi token akun sama + retry sekali; token akun lain → App; hapus token hanya bila masih token yang gagal), `sharedTokenAction` (reload / expire / restore / none), `beginTabReload` (blokir request sampai reload), `maybeRenewToken` (umur ≥ 1/3 masa berlaku, throttle `tf_token_renew_at`, guard logout `tf_logout_at`), `__tokenWriteFailed`. Listener `tf:auth-expired` dihapus (syncpush masih dispatch, tidak ada pendengar). Server — klaim `iat/auth_time/pwv`, `POST /api/auth/refresh` (batas `SESSION_MAX_DAYS`=30, tolak setelah ganti password, ext 403, cookie hanya bila request membawa cookie), `_resolve_user` header→cookie→query dengan fallback hanya untuk `sub` sama. ADR-007.
- **Verifikasi:** JS 1311/1312 (1 gagal pra-ada `draw_local_reactive`), pytest 178/178, inline 5/5, sw OK, 0 border-left. Playwright main vs branch: S1 login→app, S2 token hilang→tetap, S3 tetap masuk→keluar, S4 perpanjangan + cookie + tab lain OK, S5 akun lain → reload sebagai akun baru. Review independen 2 putaran (C1/C2/I1/I3 diperbaiki).
- **Sisa / tindak lanjut:** token curian bisa diperpanjang ≤ 30 hari; logout & ganti password belum mencabut token (saran: kolom `token_epoch`); respons refresh tab lain yang dikirim tepat sebelum logout bisa menyetel ulang cookie (jendela sangat sempit); URL SSE Tauri masih membawa token lama sampai komponen di-mount ulang; magic link Telegram (`/auth/magic`) hanya menyetel cookie sehingga SPA tanpa `tf_token` tetap menampilkan form login (bisa diperbaiki dengan bootstrap `/api/auth/refresh` via cookie).

## 🔵 KEPUTUSAN ARAH MOBILE: Tauri → Capacitor (Android + iOS, widget, Play Store, App Store) — 2026-10-16 (Claude) — RENCANA, BELUM DIKERJAKAN
- **Keputusan Bapak (2026-10-16):** target mobile = widget layar utama + Google Play + App Store; shell mobile pindah ke Capacitor, Tauri dilepas untuk mobile (tetap untuk desktop).
- **Dokumen acuan:** "Roadmap & WBS Migrasi Mobile Alurik: Tauri → Capacitor" (Claude Docs, proyek alurik) — 9 fase F0–F8, WBS per paket kerja (ID, file, kriteria selesai, hk), prinsip ADR-M1..M6 (nomor final diambil saat S07; TF.native satu antarmuka; offline-first tetap satu-satunya jalur tulis; applicationId `id.web.yatno.taskflow` + keystore lama dipertahankan; versi dari SW `4.NNN.0`; token di Keystore/Keychain + refresh token; SW hanya web; proyek native di-commit), desain widget (snapshot JSON turunan + antrean aksi → outbox), kesiapan toko, risiko, urutan 16 PR. Estimasi ±57–74 hk (12–15 minggu); Android di Play ≈ minggu 6–7.
- **Belum ada kode.** Langkah pertama bila disetujui: ADR-M1..M6 di `DECISIONS.md` (nomor final = nomor kosong berikutnya saat S07), akun Play/Apple, cadangan keystore, halaman privasi + hapus akun, rilis Tauri Android terakhir dengan banner sinkronisasi. Catatan teknis penting: origin Capacitor Android `http://localhost` → `static/config.js` saat ini akan mengosongkan `API_BASE` (harus deteksi platform, bukan hostname); data IndexedDB APK Tauri (`tauri.localhost`) tidak terbawa ke APK Capacitor.

## 🟠 CI APK Android hidup lagi + review standar/paritas APK vs PWA — 2026-10-15 (Claude) — NEEDS REVIEW
- **Status:** Draft PR #29 dari `claude/fix-android-ci-setup-android-v4`. Hanya CI (`.github/workflows/{android,appimage,tauri}.yml`) + `src-tauri/Cargo.lock`; tidak ada perubahan kode app/SW/CSS. Tunggu "merge dan deploy" (merge saja; deploy.yml tidak terpengaruh).
- **Masalah:** workflow Build Android APK gagal sejak Google menghapus paket SDK `tools` (`android-actions/setup-android@v3` memasangnya default) dan `cargo update -p brotli --precise 8.0.2` ditolak (tauri-utils 2.10.2 butuh brotli ^9). Build sukses terakhir sebelum fix: 2026-08-29 (`a84ad30`) → APK lama **belum memuat PR #26 (hardening sync)**.
- **Fix:** setup-android **v4**; step pin brotli dihapus di 3 workflow; `Cargo.lock` di-commit (tauri 2.12.4). Opsi baru `workflow_dispatch` input `release=true` → APK diunggah ke GitHub **pre-release** `apk-<tanggal>-<sha>` + sha256 (unduh langsung dari HP tanpa login; artifact Actions butuh login & kedaluwarsa 90 hari). Push tag `v*` → release bernama tag. `permissions: contents: write` di job.
- **Verifikasi:** run 38744455078 sukses (artifact); run 38744839864 sukses + release `apk-20261015-1354-cfce2b2` (APK 49,9 MB, 4 ABI, ditandatangani TASKFLOW.RSA, sha256 cocok). Belum dites di HP fisik.
- **Temuan review (belum dikerjakan, lihat PR #29 / SESSION_LOG):** versi beku `4.0.0` → `versionCode` selalu 4000000; `gen/android` di-regenerate + di-patch string tiap build; keystore hanya di Secrets (cadangkan!); tidak ada AAB; token plaintext `token.json` & token di query string (APK saja); bug APK: `fetch` relatif `/api/version`, `drawingrepo.listDrawings` `/api/drawings`, iframe mind-elixir `/api/search|scratchpad|tasks|mindmaps`; ekspor `<a download>` blob tidak jalan di WebView; `tf_user_id` tidak dicadangkan native; flag AI dipaksa on saat build; `Notification` API tidak ada di WebView Android (Pomodoro diam); SW belum terverifikasi di Tauri. Widget Android butuh kode native (AppWidgetProvider) + snapshot offline-first dari JS; evaluasi Capacitor vs Tauri sebelum mulai widget.

## 🟠 Note viewer: tombol Kertas tidak bisa dimatikan + kertas fit ke layar laptop — 2026-10-15 (Claude) — DI-MERGE & DEPLOY
- **Status:** PR #27 di-merge atas persetujuan Bapak (2026-10-15), SW **v414** `taskflow-v414-paper-fit-viewer` (v413 dibiarkan untuk PR #25 yang masih memakai v412, sama dengan main). app.css tidak berubah (v=333). Hanya file statis, tidak perlu restart server (kecuali agar /api/version melaporkan v414).
- **Bug:** `notequery.shape()` (static/offline/notequery.js) tidak menyertakan `meta_json`, jadi semua note dari router local-first tanpa pengaturan kertas. Klik "Kertas" tersimpan benar, tetapi `noteSaved` memuat ulang note tanpa `meta_json` → efek `initViewerPaperConfig` kembali ke default (kertas aktif). Editor (NoteModal `paperConfigFromMeta`) juga terdampak. Fix: `meta_json` ikut di shape (default `"{}"`).
- **Fitur:** penampil (NotePanel) mengukur lebar area kertas (`usePaperFitScale`, ResizeObserver) dan memasang `--paper-fit`; CSS desktop `.paper-fit-area .paper-inner-wrap { zoom: var(--paper-fit) }`. Skala 1 bila kertas + gutter 24px muat, mengecil bila tidak (min 0.4), kembali normal saat daftar catatan ditutup. HP tidak terpengaruh. `PaperPageGuides` membagi rect dengan zoom sehingga garis halaman tetap tepat. Editor (NoteModal) sengaja belum memakai zoom (risiko posisi kursor ProseMirror).
- **Verifikasi:** JS 1257/1258 (1 gagal pra-ada `draw_local_reactive`), pytest 159/159, inline 5/5, Playwright: 1280px daftar terbuka skala 0.904 tanpa scroll horizontal, 1366/1440 tetap 1, garis halaman sama. Screenshot `/mnt/project-files/kertas-fit-layar/`.

## 🟢 HOTFIX: DELETE note/task/habit gagal 500 (trigger merujuk entity_tags_old) — 2026-10-15 (Claude) — DI-MERGE & DEPLOY
- **Status:** PR #28 di-merge (`cebee10`) atas "merge dan deploy" Bapak, Deploy Taskflow V4 run #896 sukses (migrate_db sudah menyembuhkan trigger di DB produksi). Sebelumnya: deploy menjalankan `migrate_db()` yang langsung menyembuhkan trigger, lalu `sudo systemctl restart taskflow-web`.
- **Gejala (log produksi 2026-10-15 20:0x WIB):** `DELETE /api/scratchpad/246` → 500 `sqlite3.OperationalError: no such table: main.entity_tags_old`. Bug lama (sejak migrasi widen CHECK entity_tags 2026-10-11), bukan dari PR #26. Hapus task & habit juga kena (trigger yang sama).
- **Penyebab:** `ALTER TABLE entity_tags RENAME TO entity_tags_old` (legacy_alter_table OFF) menulis ulang `trg_delete_note_tags/task_tags/habit_tags` ke `entity_tags_old`; setelah `DROP TABLE entity_tags_old` trigger itu selalu gagal.
- **Fix:** `_heal_broken_triggers()` di akhir `migrate_db` (trigger yang merujuk `<x>_old` yang hilang dibuat ulang ke `<x>`, idempoten) + `PRAGMA legacy_alter_table=ON` sebelum 3 RENAME rebuild. Tes `tests/test_trigger_heal.py`; pytest 160/160.
- **Dampak data:** DELETE gagal di-rollback penuh → tidak ada data hilang; op hapus di perangkat tetap antre dan terkirim setelah fix aktif.

## 🟢 Hardening offline-first & sinkronisasi antar-perangkat (audit 2026-10-15) — 2026-10-15 (Claude) — DI-MERGE & DEPLOY (BELUM RESTART)
- **Status:** PR #26 di-merge (`544316c`) oleh Bapak 2026-10-15 14:19 WIB, Deploy Taskflow V4 run #893 sukses (lalu PR #27/v414, run #894 sukses). **Per 18:2x WIB `/api/version` live masih `taskflow-v411-inbox-wizard-edit` → `taskflow-web` & `taskflow` BELUM di-restart; kode server PR #26 (client_id, base_rev/409, share, kuadran) belum aktif.** Sebelumnya: draft PR #26 dari branch `claude/sync-audit-fixes`, SW **v412** `taskflow-v412-sync-audit-fixes` (app.css tidak berubah, tetap v=333). Menunggu Bapak bilang "merge dan deploy". **Deploy wajib `sudo systemctl restart taskflow-web`** (migrasi `client_id` + index unik tasks/habits/mindmaps, model `base_rev`, `/share` bump `updated_at`, kuadran tanpa bump) — `migrate_db()` dijalankan workflow deploy, tapi kode server baru aktif setelah restart. Bot (`bot.py`) tidak diubah tetapi `repository.update_quadrant` berubah → restart `taskflow` juga.
- **Sumber:** audit `docs/superpowers/specs/2026-10-15-offline-sync-audit.md` (K1–K6, T1–T13, S1–S17) + rencana `docs/superpowers/plans/2026-10-15-sync-audit-fixes.md` (8 prinsip desain, workstream A1/B/A2/C/D/E — semua selesai) + review independen (12 temuan, semua diperbaiki di commit `b6dbae6`). ADR-006 di `DECISIONS.md`.
- **Yang berubah (inti):**
  1. **Sesi 401 ≠ ganti pengguna** (K1): token kedaluwarsa → `handleAuthExpired` (form login, toast), IndexedDB + outbox dipertahankan, login akun sama → `__syncNow()`; logout manual menolak/konfirmasi bila masih ada op tertahan.
  2. **Klasifikasi respons push** (K3/T13): 401 hentikan drain (op tetap), 429/5xx op tetap, 403 → `conflict:"access_lost"` (Simpan sebagai pribadi / Buang), 404 → `remote_deleted`, 4xx permanen → op dibuang + `sync_error` (conflict bar: Coba lagi / Buang perubahan lokal). Tidak ada lagi penghapusan/penimpaan lokal diam-diam. Record `dirty` tanpa op diantre ulang oleh pull.
  3. **CAS/rev semua entitas** (K5 + prinsip 4): `TFdb.mutate`, `rev` di record, `markPushed` — edit selama request in-flight tidak pernah ditimpa objek pra-request.
  4. **Pull defensif** (T1): cek `res.ok`, tiap langkah `sync()` terisolasi dan push selalu jalan, hapus lokal hanya setelah GET per item 404; `writeNote/putTask/putHabit` lewat CAS.
  5. **Server**: `client_id` idempoten untuk task/habit/mindmap/pesan (T11), `base_rev` opsional pada PUT → 409 `{detail:{code:"REV_MISMATCH",current}}`, `/share` bump `updated_at` + `list_id` absen = tidak berubah (K4), `is_focused` di PUT (K6), kuadran cron tidak mem-bump `updated_at` (K2; klien mengadopsi field turunan terpisah), tag note berskop note (T7), `MindmapCreate.list_id` (S7), blok rute trash duplikat dihapus.
  6. **Note & mindmap: salinan konflik, bukan LWW** (prinsip 7): edit-vs-edit → versi lokal jadi "(konflik) <judul>" (pribadi, client_id baru), record asli mengadopsi server + notice `conflict_copy`; tidak dibuat bila isi sama (gema PUT sendiri). NoteModal: autosave tidak jalan di render pertama, cek revisi sebelum simpan, bekerja offline, flush saat tutup, `noteSaved {cids}`; tab mindmap reload saat `mindmapSynced` bila tidak dirty, `if_updated_at`.
  7. **Subtask/catatan/lampiran task tampil lagi** (K6, regresi v393): id numerik diteruskan ke jaringan.
  8. **Recurring & habit**: pull `recurring_exceptions` (±60 hari), rekonsiliasi log habit (uncheck menyebar, log yatim dihapus), `recurrence_renew` dikirim (T12), op anak ditahan selama create induk antre (T10), tanggal check-in hari Jakarta (S8).
  9. **Drawing**: three-way merge dengan `base_blob_ref` (hapus tidak hidup lagi, T2/S3), 404 → `remote_deleted` (S2), `data_missing` dibersihkan (S4), path legacy note-drawing dikonversi standalone (S6), iframe menerapkan snapshot sebagai diff (S5, `draw-app/src/App.jsx`).
  10. **SW** (S11): `/` hasil revalidasi hanya di-cache bila `__SW_VERSION` sama dengan SW (tidak ada campuran index.html baru + modul lama).
- **Verifikasi:** `node --test tests/offline/*.test.js` 1252/1253 (1 fail pra-ada: `draw_local_reactive` butuh bundle tldraw yang dibuild saat deploy), `pytest` 159/159, inline 5/5, `node --check` semua modul, border-left 0. Belum ada uji browser manual (Playwright) untuk NoteModal/mindmap tab — **disarankan cek manual** setelah deploy: buka note tanpa edit (tidak boleh ada PUT), edit di 2 perangkat (muncul "(konflik)"), token kedaluwarsa (data offline tetap ada setelah login ulang).
- **Catatan library open source (pertanyaan Bapak):** perubahan tidak menyentuh library yang di-vendor. Titik yang perlu dicek bila upgrade: `draw-app/src/App.jsx` `applySnapshotDiff` (API tldraw 2.4.6 `store.mergeRemoteChanges`/`loadSnapshot`; fallback `loadSnapshot`), handler `tf:note-tasklinks-rewritten` di NoteModal (atribut node Milkdown). `mergeDrawingSnapshots` memakai format `{store, schema}` generik dan meneruskan `schema`.
- **Belum / di luar cakupan:** server masih memakai `datetime.now()` naive (S9 sisi server — bila zona VPS ≠ UTC, LWW task bisa condong ke server; disarankan `datetime.now(timezone.utc)` di PR terpisah karena menyentuh tampilan waktu); `tasklink` lama berisi cid di note yang sudah tersinkron sebelum PR ini tidak ditulis ulang (hanya yang di-push setelah ini); pesan/DM dedupe `client_id` tanpa index unik (SELECT-then-INSERT).

## 🟢 Proses Inbox: prioritas, project, tanggal bisa diedit — 2026-10-13 (Claude) — DI-MERGE & DEPLOY
- **Status:** PR #24 di-merge (`62ee970`) atas persetujuan Bapak, Deploy Taskflow V4 run #891 sukses. `webapp.py` (/api/version) baru aktif setelah `sudo systemctl restart taskflow-web`. Dari `claude/project-thread-yxh0y6`, SW v411 `taskflow-v411-inbox-wizard-edit`, app.css?v=333 (v408 dipakai PR #22, v410 PR #23), app.css?v=330. Tunggu "merge dan deploy". Item 6 dari daftar Eisenhower/task Bapak; item 1-5 dikerjakan thread lain (bisa bentrok versi SW, cek main sebelum merge).
- **Fitur:** `GtdWizardEditFields` di `GtdInboxWizardModal`: atas permintaan Bapak satu baris dropdown tanpa label di layar besar (prioritas berwarna, project + "Project baru...", tanggal: Tanpa tanggal/Hari ini/Besok/+7 hari/Pilih tanggal... yang membuka kalender). Di HP prioritas+project sebaris, tanggal di baris kedua. Tiap perubahan langsung disimpan lewat `handleUpdateTaskFields` (App, PUT parsial, optimistik, antre offline). Kuadran tampil sebagai badge dan ikut berubah. Kartu "dikunci" ke task yang sedang diedit (`pinnedIdRef`) karena daftar inbox diurutkan ulang saat prioritas berubah. Overlay wizard z-index 60 agar FAB mobile tidak menutupi tombol.
- **Bug ikut diperbaiki:** `taskToUpdatePayload` (static/offline/syncpush.js) mengirim `deadline: null` saat tanggal dihapus, padahal server mengabaikan null → hapus tanggal tidak pernah tersinkron. Sekarang mengirim `""`.
## 🟢 Pilih tanggal saat tambah task + task hero tanpa tanggal — 2026-10-13 (Claude) — DI-MERGE & DEPLOY
- **Status:** PR #23 di-merge atas "merge dan deploy" Bapak setelah main (PR #22, v408) di-merge ke branch. SW v410 `taskflow-v410-task-date-prompt`, app.css?v=332 (v409 dibiarkan untuk thread inbox wizard). Hero quick capture kini P2 (dari PR #22) + tanpa tanggal. Setelah Lewati/Tambahkan, task langsung tersimpan dan modal tertutup (dicek Playwright).
- **Item 4:** `TaskFormModal` → task BARU tanpa deadline dan tidak berulang memunculkan `TaskDatePromptModal` (kalender 1 bulan, prev/next, pilihan cepat Hari ini/Besok/Senin depan, badge jumlah task per tanggal). "Tidak perlu (Lewati)" simpan tanpa tanggal, "Tambahkan" simpan dengan tanggal. ✕/Esc/klik luar kembali ke form. Helper murni `taskNeedsDatePrompt`, `taskDatePromptCells`, `taskDatePromptQuickPicks`.
- **Item 5:** `parseQuickCapture` tidak lagi mengurai "besok/hari ini/lusa/today/tomorrow"; task dari input hero selalu `deadline: null`, kata tanggal tetap di judul.
- Tes: `tests/offline/task_date_prompt.test.js` (baru), `quick_capture_detect.test.js` diperbarui.
## 🟢 Keterangan kartu Eisenhower + prioritas default P2 — 2026-10-13 (Claude) — DI-MERGE & DEPLOY
- **Status:** PR #22 di-merge (`a57c623`) atas "merge dan deploy" Bapak; Deploy Taskflow V4 run #888 sukses. SW v408 (kemudian digantikan v410 dari PR #23). Default P2 di `TaskCreate` (webapp.py) dan bot `/quick` baru aktif setelah restart `taskflow-web` (dan bot).
- **Perubahan:** sub kartu Q1 "Penting, mendesak ≤ 7 hari", Q2 "Penting, tidak mendesak > 7 hari" (logika kuadran tidak berubah; Q2 tetap P1/P2 deadline jauh atau tanpa deadline). Default prioritas task baru P2: TaskModal, quick capture hero, task inline dari catatan (2 tempat), review mingguan, `TaskCreate` API, `createTask` offline (`taskrepo.js`), bot `/quick`.
- **Catatan:** item 4-6 permintaan Bapak (modal tanggal, hero tanpa tanggal, inbox wizard editable) dikerjakan thread lain.

## 🟢 Callout "> [!NOTE]" tampil mentah di penampil catatan — 2026-10-13 (Claude) — DI-MERGE & DEPLOY
- **Status:** PR #21 di-merge (`8f166c4`) atas "merge dan deploy" Bapak; Deploy Taskflow V4 run #886 sukses. SW v407 `taskflow-v407-note-callout-render`, app.css?v=329. `webapp.py` (/api/version) baru aktif setelah `sudo systemctl restart taskflow-web`.
- **Penyebab:** menu `/callout` menyisipkan teks `> [!NOTE]\n> ` ke paragraf (insertText) → Milkdown menyimpan `\> \[!NOTE] > isi` (ter-escape), jadi penampil menampilkan teks mentah. `>` yang diketik setelah Shift+Enter juga tersimpan `\>`.
- **Fix:** `/callout` membuat blockquote sungguhan (`[!NOTE]` + paragraf isi); `repairQuoteMarkdown()` (sebelum `renderMarkdown`) mengubah baris `\>` di luar blok kode jadi kutipan dan memecah callout satu baris lama; editor memuat markdown lewat fungsi yang sama dan memberi kelas `note-callout-editing` + ikon lewat node view `createCalloutBlockquotePlugin`. Callout dan blockquote kini tanpa garis kiri (latar lembut + ikon); teks callout/toggle terbaca di Mode Kertas saat tema gelap. `NOTE_CALLOUT_TYPES` dipakai bersama.
- **Belum:** halaman catatan publik (`/p/...`, mistune di webapp.py) belum merender callout dan masih bergaris kiri.

## 🟠 Ikon PWA tidak ter-update setelah pasang ulang — 2026-10-13 (Claude) — NEEDS REVIEW
- **Status:** Draft PR dari `claude/android-icon-margin-8g31kx`, SW v406 `taskflow-v406-pwa-icon-refresh`. Tunggu "merge dan deploy".
- **Masalah:** setelah PR #18 (v405) Bapak uninstall + install ulang PWA, ikon tetap lama. SW lama menyajikan `/manifest.json` dan `icon-*.png` cache-first dari precache (SW baru menunggu tombol update), dan uninstall PWA tidak menghapus cache/SW situs.
- **Fix:** URL manifest dan ikon diberi `?v=2` (index.html, manifest.json, precache sw.js) supaya cache lama tidak cocok; SW: manifest + `/static/icon-*.png` network-first; precache pakai `cache: "reload"`; `/manifest.json` dikirim dengan `Cache-Control: no-cache`.

## 🟡 Margin Ikon Aplikasi Android (PWA maskable + Tauri) — 2026-10-13 (Claude) — DI-MERGE
- **Status:** 🟡 PR #18 di-merge atas "merge dan deploy" Bapak (2026-10-13), SW v405 `taskflow-v405-android-icon-margin`.
- **Masalah:** `icon-192/512.png` (logo memenuhi seluruh kanvas) juga dipakai sebagai `purpose: maskable`, jadi launcher Android memotong logo dan tanpa margin.
- **Solusi:** `scripts/gen_app_icons.py` mengangkat logo dari `src-tauri/icons/icon-source.png` (tidak diubah) ke latar putih solid: `icon-192/512.png` (any, logo 72%), `icon-maskable-192/512.png` baru (logo 56%, di dalam safe zone 80%), dan ikon Tauri Android `mipmap-*/ic_launcher*.png` (sebelumnya masih logo TaskFlow lama). `manifest.json` menunjuk ikon maskable baru; `sw.js` meng-cache keduanya.
- **Catatan:** v403 dinaikkan ke v405 karena PR #17 (v401) dan PR #19 (v404) masuk main lebih dulu. Di Android, ikon baru bisa jadi baru muncul setelah uninstall + pasang ulang. `draw_local_reactive.test.js` 1 gagal sudah ada di main.

## 🟠 Tombol + blok di editor catatan (mobile) — 2026-10-13 (Claude) — NEEDS REVIEW
- **Status:** Draft PR dari branch `claude/fix-mobile-block-plus-menu-yssn7h`, SW v404 `taskflow-v404-mobile-block-plus-menu` (v402/v403 dilewati: v403 dipakai branch android-icon-margin). Menunggu Bapak bilang "merge dan deploy".
- **Bug:** di HP, ketuk "+" di depan blok → "/" muncul di paragraf baru tapi slash menu tidak terbuka, kursor pindah ke blok bawah.
- **Penyebab:** `preventDefault` di `pointerdown` tidak membatalkan `click` kompatibilitas dari ketukan. Saat click tiba, handle sudah tersembunyi (dokumen berubah) → click jatuh ke `.milkdown-editor`, handler "klik area kosong" memindahkan kursor ke baris terakhir, slash menu batal.
- **Fix:** `addBtn` listener `touchend` non-passive dengan `preventDefault()` (MilkdownEditor, static/index.html). Tes baru di `tests/offline/block_handle.test.js`.

## 🟠 Mode Kertas di HP lebar penuh — 2026-10-13 (Claude) — NEEDS REVIEW
- **Status:** Draft PR dari branch `claude/mobile-paper-mode-loyv6u`, SW v401 `taskflow-v401-mobile-paper-mode`. Menunggu Bapak bilang "merge dan deploy".
- Gaya lembar kertas kini di dalam `@media (min-width: 769px)`; di <= 768px catatan tampil normal (lebar penuh, ikut tema), garis halaman dan kontrol kertas (`.paper-controls`) disembunyikan. Pilihan kertas per catatan (meta_json) tidak berubah. Detail di SESSION_LOG.

## ✅ (dieksekusi, lihat di atas) RENCANA KERJA: Adaptasi Responsif Layar Kecil (Mobile) untuk Mode Kertas Note Viewer & Note Editor
- **Status:** Dieksekusi 2026-10-13 oleh Claude (lihat bagian di atas).
- **Rencana Kerja Tertulis:** `docs/superpowers/plans/2026-10-13-mobile-responsive-paper-mode.md`.
- **Konteks & Kebutuhan:**
  - Pengguna mencatat bahwa pada perangkat mobile berlayar kecil, tampilan kertas dengan lebar fisik 210mm dan padding 20mm memaksa pengguna menggeser-geser layar secara horizontal (*horizontal scroll*) sehingga tulisan sulit dibaca.
  - Solusi yang disepakati:
    - **Layar Lebar & Besar (Desktop / Laptop / Tablet >= 769px):** Tampilan kertas tetap aktif dan memberikan sensasi membaca & menulis lembaran fisik A4 yang memuaskan.
    - **Layar Kecil / Mobile (<= 768px):** Tampilan **BUKAN tampilan kertas**, melainkan otomatis mengalir *fluid full-width* 100% tanpa *box-shadow*, tanpa batas fisik 210mm, padding natural, mengikuti tema aktif HP (gelap/terang), serta menyembunyikan garis panduan halaman (`PaperPageGuides`) dan dropdown select kertas di toolbar.
- **Rencana Langkah Eksekusi (Malam Hari):**
  1. Tambahkan CSS responsif `@media (max-width: 768px)` untuk `.paper-mode-active`, `.paper-inner-wrap`, `.milkdown-editor`, `.note-rendered`, `.paper-page-guides`, dan `select.paper-select` di `static/index.html`.
  2. Tambahkan unit test di `tests/offline/note_paper_mode.test.js` untuk memverifikasi aturan responsif mobile.
  3. Verifikasi menyeluruh: inline scripts OK, tests passed 100%, ZERO `border-left`.

## 🟢 Mode Kertas (Paper Mode) di Note Viewer (NotePanel) — 2026-10-13 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI. Branch `feat/note-viewer-paper-mode`. SW v400 `taskflow-v400-note-viewer-paper-mode`.
- **Konteks & Masalah:**
  - Sebelumnya, tampilan lembaran kertas (Paper Mode) hanya tersedia saat mode edit di Note Editor (`NoteModal`). Pengguna menginginkan opsi tampilan kertas yang sama juga tersedia saat membaca catatan di Note Viewer (`NotePanel`) baik pada dark theme maupun light theme.
  - Sesi ini dijalankan secara terisolasi dengan standar industri (branch terisolasi dan zero-touch ke NoteToolbar/NoteModal) untuk menjamin tidak ada konflik dengan sesi paralel sebelah.
- **Solusi & Implementasi:**
  1. **`static/index.html`:**
     - Menambahkan styling desk gelap untuk dark theme: `[data-theme="dark"] .paper-mode-active { background-color: #18181b !important; }`.
     - Memperluas selector CSS `.paper-mode-active .paper-inner-wrap .milkdown-editor` agar mencakup `.note-rendered` (background putih solid, box shadow, min-height, padding 20mm, box-sizing, tipografi `#1e293b` untuk blockquote, code, pre, table, link, wikilink, tasklink).
     - Menambahkan styling `.notes-panel-actions button.paper-btn-active` dan `.notes-panel-actions select.paper-select` (lengkap dengan mode gelap).
     - Memperbarui `PaperPageGuides`: `const pm = root.querySelector('.ProseMirror') || root.querySelector('.note-rendered');` sehingga garis pembatas halaman otomatis menghitung tinggi dokumen di Note Viewer.
     - Pada `NotePanel`:
       - Menambahkan state `viewerPaperConfig` dengan inisialisasi cerdas `initViewerPaperConfig` yang membaca `meta_json.paper_mode` (default `enabled: true, size: 'A4', orientation: 'portrait'`, serta menjaga `user_toggled: true`).
       - Menambahkan handler `saveViewerPaperConfig` dengan update instan ke state dan `note.meta_json` via `PUT /api/scratchpad/:id` serta antrean outbox offline `OfflineDB.queueAdd`.
       - Menambahkan tombol toggle "Kertas" (`React.createElement(Icon, { name: "fileText", size: 14 })`) serta dropdown ukuran kertas (`A4`, `Letter`, `A3`, `Legal`) dan orientasi (`portrait`, `landscape`) di `.notes-panel-actions`.
       - Membungkus `.note-rendered` ke dalam `.paper-mode-active` dan `.paper-inner-wrap` dengan CSS variables `--paper-width` & `--paper-height` serta `PaperPageGuides` ketika paper mode aktif.
     - Bump fallback SW version ke `taskflow-v400-note-viewer-paper-mode`.
     - Strict isolation: Baris NoteToolbar (18990-19570), NoteModal, MilkdownEditor, Dashboard, GTD Wizard, auth isolation terlindungi 100% tanpa modifikasi. ZERO `border-left` atau `borderLeft`.
  2. **Backend & Service Worker:**
     - `webapp.py`: bump `sw_cache` ke `taskflow-v400-note-viewer-paper-mode`.
     - `static/sw.js`: bump `CACHE` ke `taskflow-v400-note-viewer-paper-mode`.
     - `tests/test_version.py`: bump asersi ke `taskflow-v400-note-viewer-paper-mode` dan `v400`.
  3. **Pengujian:**
     - Menambahkan suite pengujian komprehensif baru di `tests/offline/note_paper_mode.test.js` (7 tests) memvalidasi Note Viewer Paper Mode, inisialisasi state, default & user_toggled, toggle & select buttons di NotePanel, pembungkus paper-mode-active & PaperPageGuides, serta CSS rules untuk note-rendered dan dark desk.
     - Sinkronisasi SW cache `taskflow-v400-note-viewer-paper-mode` di seluruh 8 test suite offline.
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `git diff -U0 | grep -iE "border-?left"` ➡️ **0 matches (OK)**.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
  - `node --test tests/offline/*.test.js` ➡️ **1085/1085 passed (0 failed)** across 8 suites.

## 🟢 Modernisasi Ikon Note Editor Toolbar (NoteToolbar) ke Lucide SVG Icons — 2026-10-13 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI.
- **Konteks & Masalah:**
  - Toolbar editor catatan (`NoteToolbar`) sebelumnya menggunakan campuran emoji lawas dan karakter teks unicode (seperti `\uD83D\uDCCB`, `H \u25BE`, `B`, `I`, `</>`, `\u2261`, `\u2611`, `\u275D`, `\u2014`, `\uD83D\uDCCE`, `📄 Kertas`, dll.) yang inkonsisten dan kurang modern.
  - Pengguna membutuhkan standarisasi ikon Lucide SVG seragam dengan standar industri (`viewBox="0 0 24 24"`, `stroke="currentColor"`, `strokeWidth=1.9`, `fill="none"`) dan penataan layout tombol yang rapi serta presisi.
- **Solusi & Implementasi:**
  1. **`static/ui-components.js`:**
     - Mendaftarkan seluruh ikon SVG Lucide yang dibutuhkan ke kamus `ICONS`: `bold`, `italic`, `code`, `heading`, `checkSquare`, `quote`, `listOrdered`, `strikethrough`, `table`, `minus`, `mic`, `fileText`.
  2. **`static/index.html`:**
     - Memodernisasi seluruh tombol pada `NoteToolbar` dengan `React.createElement(Icon, ...)`:
       - Template: `[Icon('clipboardCheck'), span('Template'), Icon('chevronDown')]`
       - Heading: `[Icon('heading'), Icon('chevronDown')]`
       - Bold: `Icon('bold')`
       - Italic: `Icon('italic')`
       - Inline Code: `Icon('code')`
       - Bullet List: `Icon('list')`
       - Checklist: `Icon('checkSquare')`
       - Blockquote: `Icon('quote')`
       - + Task: `[Icon('checkSquare'), span('Task')]`
       - + Gambar: `[Icon('draw'), span('Gambar')]`
       - Format Lainnya (+): `Icon('plus')`
         - Numbered List: `Icon('listOrdered')`
         - Strikethrough: `Icon('strikethrough')`
         - Table: `Icon('table')`
         - Wikilink: `[Icon('link'), span('Wiki')]`
       - Horizontal Rule: `Icon('minus')`
       - Lampirkan File: `Icon('paperclip')`
       - Dikte Suara: `Icon('mic')` + indikator status dot (merah untuk listening, kuning untuk paused)
       - Mode Kertas: `[Icon('fileText'), span('Kertas')]` dengan seluruh prop, title, dan select size/orientation tetap utuh.
     - Strict isolation: Baris-baris note editor di luar `NoteToolbar` dan file-file di `static/offline/` terlindungi utuh tanpa modifikasi.
  3. **`static/app.css`:**
     - Memperbarui styling `.note-toolbar button` dan `.note-mic-btn`: height 28px, border-radius 7px, gap 3px, padding 0 8px, align-items center, justify-content center, dan zero border (left).
  4. **Pengujian:**
     - Membuat unit test suite baru `tests/offline/note_toolbar_icons.test.js` (6 unit tests):
       - Validasi kamus `ICONS` di `ui-components.js`.
       - Validasi pemanggilan `React.createElement(Icon, ...)` untuk setiap tombol di `NoteToolbar`.
       - Validasi ketiadaan emoji/unicode lawas di tombol `NoteToolbar`.
       - Validasi kelengkapan atribut dan kontrol Mode Kertas.
       - Validasi styling modern `.note-toolbar button` di `static/app.css`.
     - Seluruh 93 tes note editor offline passed (`note_toolbar_icons.test.js`, `note_paper_mode.test.js`, `note_toc.test.js`, `interactive_note_viewer.test.js`, `note_editor_trailing_block.test.js`).
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/ui-components.js` ➡️ **OK**.
  - `git diff -U0 | grep -iE "border-?left"` ➡️ **0 matches (OK)**.
  - `node --test tests/offline/note_toolbar_icons.test.js tests/offline/note_paper_mode.test.js tests/offline/note_toc.test.js tests/offline/interactive_note_viewer.test.js tests/offline/note_editor_trailing_block.test.js` ➡️ **93/93 passed (0 failed)**.

## 🟢 Multi-Account Local DB & Session Isolation pada Logout & Account Switch — 2026-10-13 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI. SW v399 `taskflow-v399-user-switch-localdb-isolation`.
- **Konteks & Masalah:**
  - Pengguna melaporkan bahwa dalam satu laptop yang sama di mana beberapa anggota keluarga bergantian menggunakan Alurik via Google Chrome PWA dengan akun masing-masing, ketika ada akun yang logout dan akun lain login, akun yang baru masuk masih membaca data local database (IndexedDB `taskflow-offline` & `taskflow-legacy-cache`, serta CacheStorage API cache) milik akun sebelumnya.
  - Akar masalah:
    1. Fungsi `logout()` sebelumnya hanya mereset state in-memory React dan menghapus token, tanpa membersihkan object store di IndexedDB `taskflow-offline` (`tasks`, `habits`, `scratchpad_notes`, `_outbox`, dll.) maupun `taskflow-legacy-cache` (`cache` dan `queue`).
    2. Singleton `api._localRouter` tetap aktif merutekan request `/api/tasks` dsb. ke IndexedDB lokal yang masih berisi rekaman pengguna sebelumnya.
    3. `handleLogin()` dan `tryAuth()` tidak membandingkan ID akun yang masuk (`user_id`) dengan akun sebelumnya yang tercatat di local storage.
    4. Service Worker CacheStorage menyimpan cache respons GET `/api/*` sehingga saat offline atau cache hit, data API lama dapat terambil.
- **Solusi & Implementasi:**
  1. **`static/offline/db.js`:**
     - Menambahkan fungsi `clearAll()` yang membuka database `taskflow-offline` dan mengosongkan seluruh object store dalam satu transaksi `readwrite`, serta mengeksposnya pada `publicApi` dan module exports.
  2. **`static/index.html`:**
     - Pada `OfflineDB`: menambahkan `cacheClear()` dan `clearAll()` untuk mengosongkan store `cache` dan `queue` pada `taskflow-legacy-cache`.
     - Menambahkan fungsi komprehensif `clearLocalUserData()` yang:
       - Memanggil `TF.db.clearAll()` untuk mengosongkan IndexedDB `taskflow-offline`.
       - Memanggil `OfflineDB.clearAll()` untuk mengosongkan IndexedDB `taskflow-legacy-cache`.
       - Menghapus entri endpoint `/api/` dari semua cache di `window.caches` (CacheStorage).
       - Menghapus key `localStorage` terikat user: `tf_user_id`, `tf_pomo_state`, `tf_last_review`, `tf_review_snooze`, `tf_last_backup`, `tf_backup_snooze`, `tf_dismiss_onboarding`, `tf_ai_review_optin`.
       - Mereset singleton lokal `api._localRouter = null`, `TF.db._reset()`, dan mengosongkan user closures pada `chatrepo`, `noterepo`, dan `mindmaprepo`.
     - Integrasi pada `logout()`: jika online, mencoba flush outbox via `window.__pushNow()` sebelum logout agar data offline pengguna lama terunggah ke akunnya, memanggil endpoint logout server, mengeksekusi `await clearLocalUserData()`, mereset `initialLoad.current = true`, dan mengosongkan seluruh state in-memory React.
     - Integrasi pada `handleLogin(data)`: mendeteksi pergantian user ID (`prevUserId !== data.user_id`), memanggil `await clearLocalUserData()` jika berganti akun, dan mencatat `tf_user_id` baru.
     - Integrasi pada `tryAuth()`: mendeteksi pergantian user ID pada `/api/auth/me` berhasil maupun token decode fallback offline, memanggil `clearLocalUserData()` jika akun berbeda; serta memanggil `clearLocalUserData()` saat error 401 Unauthorized.
     - Bump fallback `window.__SW_VERSION` dan info About modal ke `taskflow-v399-user-switch-localdb-isolation`.
     - Strict isolation: Baris note editor (Milkdown, dll.) 100% terjaga. ZERO border (left).
  3. **Backend & Service Worker:**
     - `webapp.py`: bump `sw_cache` ke `taskflow-v399-user-switch-localdb-isolation`.
     - `static/sw.js`: bump `CACHE` ke `taskflow-v399-user-switch-localdb-isolation`.
     - `tests/test_version.py`: bump asersi ke `taskflow-v399-user-switch-localdb-isolation` dan `v399`.
  4. **Pengujian Komprehensif:**
     - Menambahkan unit test di `tests/offline/db.test.js`: verifikasi `clearAll` mengosongkan seluruh entity dan system stores.
     - Membuat unit test suite baru `tests/offline/user_session_isolation.test.js` (7 tests):
       - `TF.db.clearAll()` mengosongkan seluruh store `taskflow-offline`.
       - `OfflineDB.clearAll()` mengosongkan `cache` dan `queue`.
       - Logika cache purge menghapus request `/api/` dan mempertahankan aset statis.
       - `clearLocalUserData()` menghapus key user localStorage dan mereset router sambil mempertahankan setting umum (`theme`).
       - Account switch detection di `handleLogin` mendeteksi pergantian user ID dan memicu pembersihan.
       - Validasi keberadaan deklarasi fungsi pembersihan dan wiring di `index.html`.
       - Sinkronisasi konsistensi versi SW cache.
     - Sinkronisasi string cache SW di seluruh 12 test suite offline.
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `git diff -U0 | grep -iE "border-?left"` ➡️ **0 matches (OK)**.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
  - `node --test tests/offline/*.test.js` ➡️ **1071/1071 passed (0 failed)** across 8 suites.

## 🟢 Smart Direct GTD Inbox Wizard dari KPI Inbox Dashboard — 2026-10-13 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI. Branch `feat/dashboard-inbox-kpi-wizard`.
- **Konteks & Masalah:**
  - Sebelumnya, mengklik kartu KPI Inbox di Dashboard langsung melakukan navigasi ke halaman GTD Inbox (`onNav("inbox")`). Dari sana pengguna baru mengklik tombol "⚡ Proses Inbox".
  - Alur ini memiliki *friction* 2 langkah dan mengalihkan konteks halaman. Pengguna menginginkan proses telaah inbox dipercepat langsung dari Dashboard.
- **Solusi & Implementasi:**
  1. **`static/index.html`:**
     - Pada `GtdInboxWizardModal`:
       - Menambahkan prop `onNav`.
       - Di header modal di samping tombol tutup, menambahkan tombol aksi `"Buka Inbox ↗"` (`className="btn btn-ghost btn-xs"`) saat `onNav` tersedia, sehingga pengguna sewaktu-waktu dapat beralih ke tampilan daftar list konvensional dengan 1 klik.
     - Pada `Dashboard`:
       - Menerima prop `onUpdateGtdStatus`.
       - Menambahkan state `[inboxWizardOpen, setInboxWizardOpen] = useState(false)`.
       - Menghitung `inboxTasks` (`tasks.filter(t => t.gtd_status === "inbox" && t.gtd_status !== "done" && t.gtd_status !== "archived").sort(SORT_PRI)`).
       - Pada kartu KPI `"inbox"`: jika `inboxCount > 0`, klik membuka modal wizard secara instan (`setInboxWizardOpen(true)`); jika `inboxCount === 0`, jatuh ke `onNav("inbox")`.
       - Merender `inboxWizardOpen && React.createElement(GtdInboxWizardModal, { tasks: inboxTasks, onClose: () => setInboxWizardOpen(false), onUpdateGtdStatus, onDone, onNav })`.
     - Pada `App`:
       - Mengoper `onUpdateGtdStatus: handleUpdateTaskGtd` ke komponen `<Dashboard>`.
     - Strict isolation: Baris-baris Note Editor (MilkdownEditor, NoteModal, scratchpad, dll.) terlindungi 100% tanpa modifikasi dari pekerjaan sesi ini. ZERO `border-left` atau `borderLeft`.
  2. **Pengujian:**
     - Menambahkan Unit Test 8 di `tests/offline/gtd_inbox_triage.test.js`: memvalidasi `Dashboard` menerima `onUpdateGtdStatus`, state `inboxWizardOpen`, filter `inboxTasks`, KPI click logic (`inboxCount > 0` vs `0`), rendering `GtdInboxWizardModal`, passing prop dari `App`, dan tombol `"Buka Inbox ↗"`.
     - Sinkronisasi seluruh pengujian offline (`node --test tests/offline/*.test.js`).
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `git diff -U0 | grep -iE "border-?left"` ➡️ **0 matches (OK)**.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
  - `node --test tests/offline/*.test.js` ➡️ **1064/1064 passed (0 failed)** across 8 suites.

## 🟢 Default Paper View (Mode Kertas) Note Editor & User Toggled Preservation — 2026-10-13 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI. SW v398 `taskflow-v398-note-editor-default-paper-mode`.
- **Konteks & Masalah:**
  - Sebelumnya, tampilan Note Editor (Mode Kertas / Paper View) secara default tidak aktif (`enabled: false`). Pengguna menginginkan Mode Kertas aktif secara default saat membuat catatan baru atau membuka catatan lama tanpa modifikasi eksplisit, namun tetap mempertahankan preferensi pengguna jika pengguna secara sengaja mematikan Mode Kertas (`user_toggled: true`).
- **Solusi & Implementasi:**
  1. **`static/index.html`:**
     - `TaskFormModal` (line 2965): Inisialisasi state `notePaperConfig` diubah ke default `{ enabled: true, size: 'A4', orientation: 'portrait' }`.
     - `NoteToolbar` (line 19494): Pada saat pengguna mengklik tombol toggle mode kertas, dicatat flag `user_toggled: true`: `onPointerDown: (e) => { e.preventDefault(); onPaperConfigChange(p => ({ ...p, enabled: !p.enabled, user_toggled: true })); }`.
     - `NoteModal` (line 21718): Pembaruan fungsi `initPaperConfig`:
       - Catatan baru (tanpa `meta_json` atau `paper_mode` kosong) -> default `{ enabled: true, size: 'A4', orientation: 'portrait' }`.
       - Catatan lama/legacy (`meta.paper_mode.enabled === false` tanpa `user_toggled`) -> default `{ enabled: true, size: meta.paper_mode.size || 'A4', orientation: meta.paper_mode.orientation || 'portrait' }`.
       - Catatan dengan toggle eksplisit (`user_toggled === true`) -> mempertahankan preferensi pengguna (`enabled: meta.paper_mode.enabled`, `user_toggled: true`).
     - Versi Service Worker fallback dan About modal di-bump ke `taskflow-v398-note-editor-default-paper-mode`.
     - Strict isolation: baris Dashboard dan GtdInboxWizardModal milik sesi paralel pengguna tidak disentuh dan terlindungi seutuhnya. ZERO `border-left` atau `borderLeft`.
  2. **Backend & Service Worker:**
     - `webapp.py`: bump `sw_cache` ke `taskflow-v398-note-editor-default-paper-mode`.
     - `static/sw.js`: bump `CACHE` ke `taskflow-v398-note-editor-default-paper-mode`.
     - `tests/test_version.py`: bump asersi ke `taskflow-v398-note-editor-default-paper-mode` dan `v398`.
  3. **Pengujian:**
     - `tests/offline/note_paper_mode.test.js`:
       - Update asersi `TaskFormModal` state `notePaperConfig` ke `enabled: true`.
       - Tambah unit test komprehensif menguji `NoteModal` `initPaperConfig` untuk new note, legacy note, user-toggled off note, user-toggled on note, dan `NoteToolbar` `user_toggled: true`.
     - Sinkronisasi SW cache `taskflow-v398-note-editor-default-paper-mode` di seluruh test suite offline (`tests/offline/`).
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `git diff -U0 | grep -iE "border-?left"` ➡️ **0 matches (OK)**.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
  - `node --test tests/offline/*.test.js` ➡️ **1064/1064 passed (0 failed)** across 8 suites.

## 🟢 Task Insertion (/task, /tasks) di Popup Block Slash Menu Note Editor — 2026-10-12 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI. SW v397 `taskflow-v397-note-block-slash-task`.
- **Konteks & Masalah:**
  - Pengguna melaporkan bahwa pada popup menu block slash (`slashMenu` saat ketik `/` atau klik `+` block handle), belum ada opsi untuk memasukkan task (`/tasks` / `/task`). Hanya tersedia `/code`, `/callout`, `/toggle`, `/draw`.
  - Padahal task link (`[tasklink:...]`) adalah salah satu fitur inti catatan Alurik untuk menyematkan tugas langsung di dalam dokumen catatan.
- **Solusi & Implementasi:**
  1. **`static/index.html`:**
     - Di `MilkdownEditor`:
       - Menambahkan prop `onInsertTask` dan ref `onInsertTaskRef`.
       - Di `doSlashAction`: menangani `case 'task':` dengan menghapus pemicu query slash (`/` atau `/task`) dan memanggil `onInsertTaskRef.current?.()`. Menyesuaikan pengecualian pre-deletion `if (type !== 'draw' && type !== 'task')`.
       - Menambahkan item menu slash `slashMenu.appendChild(makeSlashItem('📌', 'Tugas / Task (/task, /tasks)', 'task'))` di baris item block bersama `/draw`, `/code`, `/callout`, `/toggle`.
     - Di `NoteDetailModal` (`NoteModal`):
       - Mengoper `onInsertTask: openTaskDropdown` ke `MilkdownEditor`.
       - Menambahkan `_taskJustOpened.current = true` di dalam `openTaskDropdown` agar dropdown tidak langsung tertutup saat ProseMirror menghapus slash command.
       - Memperluas regex inline slash command `/(?:^|\n)\/(todo|todos|task|tasks|tugas)$/i` dengan penghitungan panjang dinamis `cmdLen = todoMatch2[1].length + 1` agar `/tasks` (6 karakter) dan varian lainnya terhapus sempurna.
     - Di `TaskDetailModal` (`TaskFormModal`):
       - Mengoper `onInsertTask: openNoteTaskDropdown` ke `MilkdownEditor`.
       - Menambahkan pelindung `_noteTaskJustOpened.current` dan memperluas regex slash command `/(?:^|\n)\/(todo|todos|task|tasks|tugas)$/i`.
     - Memperbarui fallback `window.__SW_VERSION` ke `taskflow-v397-note-block-slash-task`.
  2. **Backend & Service Worker:**
     - `webapp.py`: bump `sw_cache` ke `taskflow-v397-note-block-slash-task`.
     - `static/sw.js`: bump `CACHE` ke `taskflow-v397-note-block-slash-task`.
     - `tests/test_version.py`: bump asersi ke `taskflow-v397-note-block-slash-task` dan `v397`.
  3. **Pengujian:**
     - Membuat unit test suite baru `tests/offline/note_slash_task.test.js` (8 tests) memvalidasi `makeSlashItem` untuk task, `doSlashAction` case 'task', integrasi prop `onInsertTask` di kedua modal, regex slash commands, dan cache SW.
     - Memperbarui regex `tests/offline/block_handle.test.js` untuk mengakomodasi `type !== 'task'`.
     - Sinkronisasi string cache SW di seluruh 8 test suite offline.
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `git diff -U0 | grep -iE "border-?left"` ➡️ **0 matches (OK)**.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
  - `node --test tests/offline/*.test.js` ➡️ **1056/1056 passed (0 failed)** across 8 suites.

## 🟢 Focus Button Text Label di Prioritas Hari Ini Dashboard — 2026-10-12 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI. SW v396 `taskflow-v396-dash-priority-focus-btn-label` & `app.css?v=328`.
- **Konteks & Masalah:**
  - Di Dashboard kartu "Prioritas Hari Ini" (`dash-prio-card`, dirender oleh `TodayRow`), tombol fokus sebelumnya hanya menampilkan ikon target 13px dalam kotak 22x22px tanpa label teks (`dash-focus-btn`).
  - Pengguna meminta menambahkan label teks fokus sehingga tampilannya sama persis seperti tombol fokus di halaman Fokus Hari Ini (`ftask-focus-btn` di `TodayFocusView`), menampilkan teks "Fokus" atau "Aktif".
- **Solusi & Implementasi:**
  1. **`static/app.css`:**
     - Update styling `.dash-focus-btn`: pill button dengan height 26px, padding 0 10px, border-radius 999px, gap 5px, font-size 11.5px, font-weight 700, warna `#dc2626` dan background tint `rgba(239, 68, 68, 0.06)`, berubah solid `#ef4444` dengan teks putih saat `.is-active` dan hover.
     - Dukungan penuh untuk dark mode (`[data-theme="dark"] .dash-focus-btn`).
     - Strict rule: ZERO `border-left` atau `borderLeft`.
  2. **`static/index.html`:**
     - Pada `TodayRow`, update tombol fokus `.dash-focus-btn` dengan menambahkan attribute `"aria-pressed": isFocusing` dan elemen `<span className="dash-focus-label">{isFocusing ? "Aktif" : "Fokus"}</span>`.
     - Update link stylesheet ke `/static/app.css?v=328`.
     - Update fallback `window.__SW_VERSION` ke `taskflow-v396-dash-priority-focus-btn-label`.
     - Strict isolation: note editor lines terlindungi tanpa modifikasi.
  3. **Backend & Service Worker:**
     - `webapp.py`: bump `sw_cache` ke `taskflow-v396-dash-priority-focus-btn-label`.
     - `static/sw.js`: bump `CACHE` ke `taskflow-v396-dash-priority-focus-btn-label`.
     - `tests/test_version.py`: bump asersi ke `taskflow-v396-dash-priority-focus-btn-label` dan `v396`.
  4. **Pengujian:**
     - `tests/offline/focus_workstation.test.js`: update asersi height 26px, border-radius 999px, serta teks `dash-focus-label` dan `isFocusing ? "Aktif" : "Fokus"`.
     - `tests/offline/note_toc.test.js`, `tests/offline/gtd_inbox_triage.test.js`, `tests/offline/dashboard_onboarding.test.js`: update asersi `app.css?v=328`.
     - Sinkronisasi SW cache `taskflow-v396-dash-priority-focus-btn-label` di seluruh 8 test suite offline.
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `git diff -U0 | grep -iE "border-?left"` ➡️ **0 matches (OK)**.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
  - `node --test tests/offline/*.test.js` ➡️ **1048/1048 passed (0 failed)** across 8 suites.

## 🟢 Fluid 100% Width Layout pada Page Focus & Page Habit — 2026-10-12 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI. SW v395 `taskflow-v395-fluid-focus-habit-pages` & `app.css?v=327`.
- **Konteks & Masalah:**
  - Halaman Focus (`TodayFocusView`) dan Halaman Habit (`HabitPage`) sebelumnya memiliki margin/sisi kosong di sisi kiri dan kanan pada monitor/layar lebar karena dibatasi oleh `max-width: 900px; margin: 0 auto;`.
  - Dashboard sudah menggunakan layout fluid 100% (`.dash { width: 100%; max-width: 100%; }`), dan kontainer `.main-content` sudah memiliki gutter padding standar (16px 28px di desktop, 16px di mobile).
- **Solusi & Implementasi:**
  1. **`static/app.css`:**
     - Update `.focus-page`: `width: 100%; max-width: 100%; padding: 0 0 32px;` (menggantikan `max-width: 900px; margin: 0 auto; padding: 24px 16px 32px;`).
     - Update `.focus-page` di `@media (max-width: 768px)`: `padding: 0 0 24px;`.
     - Tambahkan `.habit-page`: `width: 100%; max-width: 100%; padding-bottom: 32px;`.
     - Strict rule: TIDAK ADA styling `border-left` atau `borderLeft`.
  2. **`static/index.html`:**
     - Pada `HabitPage`, ganti root element div dari inline style `{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }` menjadi `className: "habit-page fade-in"`.
     - Update stylesheet link ke `/static/app.css?v=327`.
     - Update fallback `window.__SW_VERSION` ke `taskflow-v395-fluid-focus-habit-pages`.
     - Note editor di `static/index.html` terlindungi tanpa modifikasi.
  3. **Backend & Service Worker:**
     - `webapp.py`: bump `sw_cache` ke `taskflow-v395-fluid-focus-habit-pages`.
     - `static/sw.js`: bump `CACHE` ke `taskflow-v395-fluid-focus-habit-pages`.
     - `tests/test_version.py`: bump asersi ke `taskflow-v395-fluid-focus-habit-pages` dan `v395`.
  4. **Pengujian:**
     - `tests/offline/focus_workstation.test.js`: unit test untuk memvalidasi fluid layout `.focus-page` (width: 100%, max-width: 100%), `.habit-page` (width: 100%, max-width: 100%), dan rendering `HabitPage` tanpa inline `maxWidth: 900`.
     - `tests/offline/note_toc.test.js` & `tests/offline/gtd_inbox_triage.test.js` & `tests/offline/dashboard_onboarding.test.js`: perbarui asersi `app.css?v=327`.
     - Sinkronisasi SW cache `taskflow-v395-fluid-focus-habit-pages` di seluruh test suite offline.
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `git diff | grep -iE "border-?left"` ➡️ **0 matches (OK)**.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
  - `node --test tests/offline/*.test.js` ➡️ **1048/1048 passed (0 failed)** across 8 suites.

## 🟢 Fix Layout Hero Order & Habit Pill Mobile Overflow — 2026-10-11 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI. SW v394 `taskflow-v394-mobile-hero-habit-pill-layout` & `app.css?v=326`.
- **Konteks & Masalah:**
  - Pengguna melaporkan tampilan Hero di HP kecil:
    1. Urutan di hero amburadul dan habit pill tumpang tindih dengan persentase task hari ini karena `.dash-hero-habit-strip` sebelumnya berada di dalam `.dash-hero-text` yang berada sejajar flex row dengan `.dash-hero-progress`.
    2. Pada judul habit panjang, habit pill melebihi lebar layar dan terpotong (clipping/over display) di sisi kanan layar karena flex child tidak memiliki `min-width: 0`, tidak ada `box-sizing: border-box`, teks tidak memiliki `flex: 1 1 auto` yang dapat mengecil, dan icon/cta/count tertekan mengecil.
- **Solusi & Implementasi:**
  1. **`static/index.html`:**
     - Memindahkan `.dash-hero-habit-strip` keluar dari `.dash-hero-text` dan `.dash-hero-top`, menjadikannya direct child dari `.dash-hero` tepat di antara penutup `.dash-hero-top` dan pembuka `.scratchpad-bar.dash-capture`. Baris atas menampilkan greeting & task progress ring tanpa terganggu, dan baris bawahnya habit pill strip full-width.
     - Menambahkan `className: "dash-hero-habit-name"` pada span completed habit text `Semua habit hari ini selesai...` agar ter-truncate jika di layar HP sempit.
     - Bump stylesheet query ke `/static/app.css?v=326`.
     - Bump fallback `window.__SW_VERSION` ke `taskflow-v394-mobile-hero-habit-pill-layout`.
  2. **`static/app.css`:**
     - Update `.dash-hero-habit-strip`: `display: flex; align-items: center; gap: 8px; margin-top: 12px; margin-bottom: 2px; flex-wrap: wrap; width: 100%; max-width: 100%; box-sizing: border-box;`.
     - Update `.dash-hero-habit-pill`: `min-width: 0; box-sizing: border-box; max-width: 100%;`.
     - Update `.dash-hero-habit-name`: `min-width: 0; flex: 1 1 auto; max-width: 280px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`.
     - Update `.dash-hero-habit-check`, `.dash-hero-habit-tag`, `.dash-hero-habit-cta`, `.dash-hero-habit-count`: tambahkan `flex-shrink: 0;`.
     - Di `@media (max-width: 640px)`: margin, padding, gap kompak dan `max-width: 180px` untuk `.dash-hero-habit-name`.
     - Di `@media (max-width: 420px)`: `max-width: 120px` untuk `.dash-hero-habit-name`, ukuran font cta 10.5px, count 11px.
     - STRICTLY NO `border-left` atau `borderLeft`.
  3. **Backend & Service Worker:**
     - `webapp.py`: bump `sw_cache` ke `taskflow-v394-mobile-hero-habit-pill-layout`.
     - `static/sw.js`: bump `CACHE` ke `taskflow-v394-mobile-hero-habit-pill-layout`.
     - `tests/test_version.py`: bump asersi ke `taskflow-v394-mobile-hero-habit-pill-layout` dan `v394`.
  4. **Pengujian:**
     - `tests/offline/dashboard_habit_checkin.test.js`:
       - Asersi layout order (dash-hero-top sebelum habit strip, habit strip sebelum dash-capture).
       - Asersi completed state class `.dash-hero-habit-name`.
       - Asersi CSS flex, min-width: 0, box-sizing, flex-shrink, dan responsive media queries (640px & 420px).
       - Asersi SW v394.
     - `tests/offline/note_toc.test.js` & `tests/offline/gtd_inbox_triage.test.js` & `tests/offline/dashboard_onboarding.test.js`: perbarui asersi `app.css?v=326`.
     - Sinkronisasi SW cache `taskflow-v394-mobile-hero-habit-pill-layout` di seluruh test suite offline.
  5. **Isolasi Ketat:**
     - Note editor di `static/index.html` dan `note_editor_trailing_block.test.js` terlindungi tanpa modifikasi.
     - Nol styling `border-left` atau `borderLeft`.
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
  - `node --test tests/offline/*.test.js` ➡️ **1047/1047 passed (0 failed)** across 8 suites.

## 🟢 Resolusi Discrepancy Local Router vs Backend untuk Task Focus, Subtasks, Notes, & Attachments — 2026-10-11 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI. SW v393 `taskflow-v393-offline-task-discrepancies-fix`.
- **Konteks & Masalah:**
  - Pengguna meminta pengecekan dan penyelesaian menyeluruh terhadap potensi perbedaan (discrepancy) lainnya antara local router offline (`static/offline/taskroutes.js`) dengan network backend FastAPI (`webapp.py`).
  - Hasil audit menemukan beberapa rute penting yang dipanggil oleh frontend tetapi belum didaftarkan di router lokal atau belum lengkap penanganan CID-nya:
    1. `POST /api/tasks/:id/focus`:
       - Dipanggil oleh `handleToggleFocus(taskId)` dan `handleReviewFocus(taskId)`.
       - Saat task berupa string CID (belum tersinkronisasi), ketiadaan rute ini meneruskan request ke backend `/api/tasks/{task_id: int}/focus` yang gagal dengan HTTP 422 (integer parsing error).
       - Di `taskrepo.js`: `updateTask` belum menyimpan field `patch.is_focused`.
    2. `GET /api/tasks/:id/subtasks`, `GET /api/tasks/:id/notes`, `GET /api/tasks/:id/attachments`:
       - Dipanggil secara masif di `TaskListView` (baris 6581) saat prefetch counts untuk semua task di tampilan list, dan di `TaskDetailModal` saat membuka detail task.
       - Ketiadaan rute-rute ini di `taskroutes.js` menyebabkan task baru/offline melempar 422 di server dan gagal memuat relasi lokal.
    3. `handleDoneAll` & `handleDoneParentOnly` di `static/index.html`:
       - Ditambahkan safety fallback untuk string CIDs jika request POST done melempar error.
- **Solusi & Implementasi:**
  1. **`static/offline/taskrepo.js`:**
     - Menambahkan penanganan `if (patch.is_focused != null) next.is_focused = patch.is_focused ? 1 : 0;` pada `updateTask`.
     - Mengekspor fungsi `getRaw` di `taskrepo.js` agar dapat digunakan router lokal.
  2. **`static/offline/taskroutes.js`:**
     - Mendaftarkan `POST /api/tasks/:id/focus`: menyelesaikan CID via `resolveCid`, membaca raw task record, melakukan toggle `0` <-> `1`, dan memanggil `TFrepo.updateTask(cid, { is_focused: nextVal }, opts())`.
     - Mendaftarkan `GET /api/tasks/:id/subtasks`: membaca store `subtasks` via index `task_cid` dan memfilter `!s.deleted`.
     - Mendaftarkan `GET /api/tasks/:id/notes`: membaca store `task_notes` via index `task_cid` dan memfilter `!n.deleted`.
     - Mendaftarkan `GET /api/tasks/:id/attachments`: membaca store `task_attachments` via index `task_cid`.
  3. **`static/index.html`:**
     - Pada `handleDoneAll` dan `handleDoneParentOnly`: menambahkan safety fallback `try { await api.post(...); } catch (postErr) { if (!isIntegerId) await api.put(..., { gtd_status: "done" }); else throw postErr; }`.
     - Bump fallback SW version ke `taskflow-v393-offline-task-discrepancies-fix`.
  4. **Backend & Service Worker:**
     - `webapp.py`: bump `sw_cache` ke `taskflow-v393-offline-task-discrepancies-fix`.
     - `static/sw.js`: bump `CACHE` ke `taskflow-v393-offline-task-discrepancies-fix`.
     - `tests/test_version.py`: bump asersi ke `taskflow-v393-offline-task-discrepancies-fix` dan `v393`.
  5. **Pengujian:**
     - `tests/offline/taskroutes.test.js`:
       - Asersi `hasRoute` untuk focus, subtasks, notes, attachments.
       - Unit test `POST /api/tasks/:id/focus` toggle `is_focused` antara 0 dan 1 untuk `server_id` dan `cid`.
       - Unit test `GET /api/tasks/:id/subtasks`, `notes`, `attachments` untuk `server_id` dan `cid` serta empty/unknown handling.
     - Sinkronisasi SW cache string di seluruh test suite offline (`tests/offline/`).
  6. **Isolasi Ketat:**
     - Tidak ada styling `borderLeft` atau `border-left`.
     - Kode note editor tetap utuh tanpa modifikasi yang tidak diinginkan.
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
  - `node --test tests/offline/*.test.js` ➡️ **1046/1046 passed (0 failed)** across 8 suites.

## 🟢 Fix GTD Wizard '<2m' (Done) String CID Task ID Support — 2026-10-11 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI. SW v392 `taskflow-v392-gtd-inbox-done-cid-fix`. Commit: `56e50bf`.
- **Konteks & Masalah:**
  - Ketika menelaah task di GTD Wizard dan memilih '<2m' (Done), muncul error:
    `Input should be a valid integer, unable to parse string as an integer`.
  - Root cause:
    1. Task baru/offline di IndexedDB memiliki format ID berupa string Client ID (`cid`, e.g. `c_172866...`).
    2. `static/offline/taskroutes.js` belum mendaftarkan rute `POST /api/tasks/:id/done` dan `GET /api/tasks/:id/child-tasks`.
    3. Akibatnya, request tidak diarahkan ke lokal IndexedDB melainkan dikirim ke server FastAPI (`webapp.py`), di mana path parameter `task_id` bertipe `int` (`task_id: int`). Pydantic menolak string CID dengan HTTP 422 error.
- **Solusi & Implementasi:**
  1. **`static/offline/taskroutes.js`:**
     - Mendaftarkan rute `POST /api/tasks/:id/done` dengan `resolveCid(params.id)` -> `TFrepo.updateTask(cid, { gtd_status: "done" }, opts())` (yang otomatis mengisi `completed_at: now`).
     - Mendaftarkan rute `GET /api/tasks/:id/child-tasks` dengan `resolveCid(params.id)` -> memfilter tugas anak dengan `parent_cid === cid` dan `!r.deleted`.
  2. **`static/index.html`:**
     - Memperbarui `handleDone(taskId)` dengan validasi `isIntegerId = /^\d+$/.test(String(taskId))`.
     - Melindungi pemanggilan `(children || []).filter(...)` agar tidak error saat children undefined/null.
     - Menambahkan fallback jika `api.post(/api/tasks/${taskId}/done)` gagal dan `!isIntegerId`, maka memanggil `api.put(/api/tasks/${taskId}, { gtd_status: "done" })`.
     - Bump fallback SW version ke `taskflow-v392-gtd-inbox-done-cid-fix`.
  3. **Backend & Service Worker:**
     - `webapp.py`: bump `sw_cache` ke `taskflow-v392-gtd-inbox-done-cid-fix`.
     - `static/sw.js`: bump `CACHE` ke `taskflow-v392-gtd-inbox-done-cid-fix`.
     - `tests/test_version.py`: bump asersi ke `taskflow-v392-gtd-inbox-done-cid-fix` dan `v392`.
  4. **Pengujian:**
     - Menambahkan unit test di `tests/offline/taskroutes.test.js` untuk resolusi CID & server_id pada `POST /api/tasks/:id/done` dan `GET /api/tasks/:id/child-tasks`.
     - Sinkronisasi SW cache string di seluruh test suite offline (`tests/offline/`).
  5. **Isolasi Ketat:**
     - Perubahan note editor (MilkdownEditor trailing block) tidak disentuh dan tidak di-stage.
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ OK (5/5 inline scripts).
  - `node --check static/sw.js` ➡️ OK.
  - `node --test tests/offline/taskroutes.test.js tests/offline/gtd_inbox_triage.test.js` ➡️ 26/26 passed (0 failed).
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ 2 passed (0 failed).
  - `node --test tests/offline/*.test.js` ➡️ 1044/1044 passed across 8 suites.

## 🟢 Trailing Empty Block di Note Editor (MilkdownEditor) — 2026-10-11 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI.
- **Konteks & Masalah:**
  - Sebelumnya, jika baris/blok terakhir catatan berisi teks atau elemen (tabel, heading, list, quote), tidak ada baris kosong di bawahnya.
  - Pengguna harus mengklik baris terakhir yang ada isinya, menempatkan kursor di akhir isi blok, lalu menekan Enter untuk mendapatkan baris baru.
  - Hal ini memakan waktu dan mengganggu alur penulisan catatan.
- **Solusi & Implementasi (Opsi A — Clean UX):**
  1. **ProseMirror Plugin `createTrailingEmptyBlockPlugin(MB)` di `static/index.html`:**
     - Menggunakan hook `appendTransaction` untuk mendeteksi perubahan dokumen (`docChanged`).
     - Jika node terakhir (`doc.lastChild`) bukan paragraph kosong (`lastNode.type === schema.nodes.paragraph && lastNode.content.size === 0`), secara otomatis menyisipkan `<p></p>` kosong di posisi akhir dokumen (`doc.content.size`).
     - Mengembalikan `null` jika dokumen sudah berakhir dengan paragraph kosong (mencegah duplikasi).
     - Menyediakan fallback aman `return [];` jika `MilkdownBundle` atau prerequisite tidak tersedia, dan chaining `.use(createTrailingEmptyBlockPlugin(MB) || [])`.
  2. **Verifikasi Initial Document:**
     - Pada inisialisasi editor (`.create().then(editor => { ... })`), dokumen awal langsung diperiksa dan disisipkan trailing empty paragraph jika belum ada.
  3. **Navigasi Klik Area Bawah:**
     - Pada `handleContainerClick` di `MilkdownEditor`: jika pengguna mengklik area kosong kontainer di bawah dokumen atau di bawah elemen anak terakhir (`e.clientY > lastRect.bottom`), kursor langsung diarahkan ke baris kosong terakhir (`TextSelection.near(doc.resolve(Math.max(0, doc.content.size - 1)))`) dan editor difokuskan (`view.focus()`).
  4. **Normalisasi Markdown Saat Simpan:**
     - Di listener `markdownUpdated`: membersihkan trailing newlines ekstra (mendukung LF `\n` dan Windows CRLF `\r\n`) menggunakan regex `replace(/[\r\n]+$/, '')` sebelum memanggil `onChange`.
  5. **Isolasi Penuh:**
     - Tidak ada intervensi ke Inbox, GTD status, tasklist, maupun task modals.
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --test tests/offline/note_editor_trailing_block.test.js` ➡️ **14/14 passed (0 failed)**.
  - `node --test tests/offline/*.test.js` ➡️ **1042/1042 passed (0 failed)** across 8 suites.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.

## 🟢 Dual-Mode GTD Inbox Triage System (Inline Quick Triage + Guided '⚡ Proses Inbox' Wizard) — 2026-10-11 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI. SW v391 `taskflow-v391-gtd-inbox-triage-wizard` & `app.css?v=325`. Commits: `ed389d1`, `41e6229`.
- **Konteks & Masalah:**
  - Sebelumnya di GTD Inbox (`page === "inbox"`), pengguna harus klik tiap task, buka modal, klik edit, ganti status GTD, dan simpan. Friksinya terlalu tinggi untuk alur GTD David Allen (aturan 2 menit: <2m kerjakan sekarang -> done, actionable -> next/waiting/someday).
- **Solusi & Implementasi:**
  1. **Inline Quick Triage Bar:**
     - Pada setiap baris tugas di tampilan Inbox (`TaskRow` dan `CompactRow`), ketika `isInbox && task.gtd_status === "inbox"`, dirender kontainer `.gtd-inline-triage` berisi 4 chip aksi cepat:
       - `✓ <2m`: Aturan 2 menit (langsung diselesaikan).
       - `⚡ Next`: Pindahkan ke Next Actions.
       - `⏳ Wait`: Pindahkan ke Waiting For.
       - `☁️ Someday`: Pindahkan ke Someday / Maybe.
     - Mengklik chip triage memicu `onUpdateGtdStatus` optimistik dan tidak membuka detail modal (`e.stopPropagation()`).
  2. **Guided '⚡ Proses Inbox' Wizard Modal (`GtdInboxWizardModal`):**
     - Tombol peluncur wizard `.gtd-launch-wizard-btn` di header Inbox (`TaskListView`): `⚡ Proses Inbox (N)`.
     - Modal telaah fokus 1-per-1 menampilkan detail tugas (judul, prioritas, project, konteks, deadline, deskripsi) dan pengingat prinsip 2 menit GTD.
     - 4 tombol keputusan GTD besar dan tombol `Lewati ⏩` dengan indeks looping/cycling yang aman.
     - Tampilan Inbox Zero ("🎉 Inbox Zero! Semua tugas telah ditelaah.") saat seluruh tugas selesai diproses.
     - Dukungan keyboard `Escape` untuk menutup modal.
  3. **Backend & Optimistic Updates (`App`):**
     - Handler `handleUpdateTaskGtd`: update state lokal secara optimistik, toast feedback visual, persist via `PUT /api/tasks/:id`, fallback offline ke `OfflineDB.queueAdd`, dan memancarkan event `taskUpdated`.
  4. **Strict Styling Constraint:**
     - Seluruh styling triage chip dan wizard modal TIDAK menggunakan `borderLeft` maupun `border-left`.
  5. **Bumps & Verifikasi:**
     - Stylesheet di-bump ke `app.css?v=325`.
     - Service Worker cache di-bump ke `taskflow-v391-gtd-inbox-triage-wizard`.
     - Backend API version di `webapp.py` & `tests/test_version.py` di-bump ke `v391`.
     - Unit test komprehensif baru di `tests/offline/gtd_inbox_triage.test.js` (7/7 passed) dan `tests/offline/note_editor_trailing_block.test.js` (13/13 passed).
     - Sinkronisasi versi cache SW di seluruh 8 test suites offline (1041/1041 passed).
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `node --test tests/offline/*.test.js` ➡️ **1041/1041 passed (0 failed)** across 8 suites.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
- **Review:**
  - Code Review: Approved with minor findings (trailing block plugin & wizard skip index).
  - Code Re-Review: Approved (commit `41e6229`, 0 findings).

## 🟢 Fix Judul Habit di Quick Habit Pill Dashboard & Center HUD Toast — 2026-10-11 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI. SW v390 `taskflow-v390-dashboard-habit-title-fix`.
- **Konteks & Masalah:**
  - Teks subjek / nama habit tidak muncul pada Quick Habit Pill di Hero Dashboard (hanya muncul `◯ HABIT • Selesai? ⚡`).
  - Root cause: Objek habit dari endpoint `/api/habits/today` dan database menggunakan properti `title` (`nextHabit.title`), bukan `nextHabit.name`.
- **Solusi & Perubahan:**
  - `static/index.html`:
    - Memperbarui title, aria-label, dan label teks `.dash-hero-habit-name` menjadi `nextHabit.title || nextHabit.name || "Habit"`.
    - Memperbarui Center HUD Toast pada `handleCheckinHabit` menjadi: `title: \`Great, one activity done! 🎉 (${habit.title || habit.name || "Habit"})\``.
    - Bump fallback SW version ke `taskflow-v390-dashboard-habit-title-fix`.
  - `webapp.py` & `static/sw.js`:
    - Bump SW cache ke `taskflow-v390-dashboard-habit-title-fix`.
  - `tests/test_version.py`:
    - Update asersi ke `taskflow-v390-dashboard-habit-title-fix` dan `v390`.
  - `tests/offline/dashboard_habit_checkin.test.js`:
    - Menambahkan asersi habit title fallback pada `.dash-hero-habit-name`, title, aria-label, dan Center HUD Toast.
    - Menambahkan unit test SW cache `taskflow-v390-dashboard-habit-title-fix`.
  - Sinkronisasi SW cache `taskflow-v390-dashboard-habit-title-fix` di seluruh file test offline (`tests/offline/`).
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `node --test tests/offline/*.test.js` ➡️ **1021/1021 passed (0 failed)** across 8 suites.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.

## 🟢 Quick Habit Check-in Pill di Hero Dashboard & Center HUD Toast — 2026-10-11 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI & DEPLOYED (Pushed ke `origin/main`). SW v389 `taskflow-v389-dashboard-habit-checkin` & `app.css?v=324`. Commits: `c5428d3`, `a463b09`. Deploy pipeline VPS aktif otomatis.
- **Konteks & Solusi:**
  - Pengguna ingin dapat melakukan check-in habit langsung dari Dashboard. Dalam sesi brainstorming (Bounded task), pengguna memilih Opsi A: Quick Habit Pill di Hero section.
  - Menambahkan pill badge interaktif `.dash-hero-habit-strip` di bawah ringkasan hero (`.dash-hero-text`).
  - Menampilkan habit aktif berikutnya yang belum selesai hari ini yang disesuaikan secara cerdas dengan fase waktu lokal saat ini (`pagi`, `siang`, `malam`).
  - Mengklik habit pill langsung memicu check-in optimistik, mengirim `POST /api/habits/:id/checkin` (dengan fallback antrean offline `OfflineDB.queueAdd`), memancarkan event `habitSaved`, dan memunculkan **Center HUD Toast** bergaya pill badge di tengah layar (`"Great, one activity done! 🎉"`) dengan ikon aktivitas (`activity`) dan fade halus selama 2.8 detik.
  - Ketika seluruh habit hari ini rampung, pill berubah menjadi status sukses `"Semua habit hari ini selesai (N/N) 🎉"` yang dapat diklik untuk menuju ke halaman Habits. Jika pengguna belum memiliki habit sama sekali (0 habit), pill tidak dirender (bersih tanpa elemen kosong).
  - Sesuai aturan wajib: TIDAK ADA garis tepi berwarna di sisi kiri (`borderLeft` dilarang keras).
- **Perubahan yang Selesai:**
  - `static/app.css`:
    - Menambahkan styling `.dash-hero-habit-strip`, `.dash-hero-habit-pill` (dengan hover & completed state), `.dash-hero-habit-check` (dengan status done), tag, nama, count, dan cta.
    - Menambahkan styling `.center-hud-icon-habit` untuk tema terang dan gelap dengan aksen amber/warm activity.
  - `static/index.html`:
    - Menambahkan state `habits` dan data fetching `/api/habits/today` dengan offline caching di `Dashboard`.
    - Menambahkan event listener `habitSaved` untuk sinkronisasi reaktif multi-komponen.
    - Menambahkan handler `handleCheckinHabit` dengan update optimistik dan Center HUD Toast `type: "habit"`.
    - Merender `.dash-hero-habit-strip` di Hero section di bawah `dash-hero-summary`.
    - Memperbarui Center HUD Toast dengan ikon `activity` saat `type === "habit"`.
    - Memperbarui link stylesheet ke `/static/app.css?v=324`.
    - Memperbarui versi Service Worker fallback ke `taskflow-v389-dashboard-habit-checkin`.
  - `webapp.py` & `static/sw.js`: Bump cache SW ke `taskflow-v389-dashboard-habit-checkin`.
  - Tests:
    - Unit test baru di `tests/offline/dashboard_habit_checkin.test.js`: memvalidasi selector CSS, ketiadaan `border-left`, integrasi fetching, dan Center HUD Toast habit di Dashboard.
    - Asersi stylesheet `app.css?v=324` di `tests/offline/note_toc.test.js`.
    - Asersi backend `tests/test_version.py` di-bump ke `v389`.
    - Sinkronisasi versi cache SW ke `v389` di seluruh 8 suite test offline.
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `node --test tests/offline/*.test.js` ➡️ **1020/1020 passed (0 failed)** across 8 suites.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.

## 🟢 Fokus Task & Pomodoro dari Dashboard — 2026-10-11 (Antigravity/Gemini) — SELESAI
- **Status:** 🟢 SELESAI. SW v388 `taskflow-v388-dashboard-pomodoro-focus` & `app.css?v=323`. Commit: `c175900`, `70cffd1`.
- **Konteks & Solusi:**
  - Pengguna ingin dapat memfokuskan task langsung dari kartu "Prioritas Hari Ini" di Dashboard dan langsung memicu Pomodoro di widget topbar (`TopBarPomodoroChip`).
  - Menambahkan tombol fokus `.dash-focus-btn` dengan ikon target (`<Icon name="target" size={13} />`) tepat di samping checklist `TodayRow`.
  - Callback `handleStartFocus` di level `App` memulai Pomodoro jika belum berjalan dan menandai task sebagai `focusTask`. Jika task yang sama diklik kembali, fokus dilepas dan timer dijeda.
  - Saat task selesai (`handleDone`), jika task tersebut sedang fokus maka fokus dilepas dan timer dijeda.
  - Sesuai aturan wajib: TIDAK ADA garis tepi berwarna di sisi kiri (`borderLeft` dilarang).
- **Perubahan yang Selesai:**
  - `static/app.css`: Menambahkan `.dash-focus-btn`, `.dash-focus-btn:hover`, dan `.dash-focus-btn.is-active` dengan dukungan dark mode tanpa `border-left`.
  - `static/index.html`:
    - Hook `usePomodoro`: fungsi `start(explicitTask = null)` menerima task eksplisit agar timer langsung dapat dimulai saat fokus berpindah sebelum render cycle React selesai.
    - Callback `handleStartFocus` di `App` dengan `timer.start(task)` dan notifikasi toast informatif.
    - Penanganan `handleDone`, `handleDoneParentOnly`, dan `handleDoneAll` yang melepas fokus dan menjeda timer bila task/subtask yang sedang fokus diselesaikan.
    - Oper props `focusTask`, `timer`, `onStartFocus` ke `Dashboard`.
    - `TodayRow` di `Dashboard` merender tombol fokus `.dash-focus-btn` sebelum `dash-check` saat `!isDone && onStartFocus`.
    - Update stylesheet link ke `app.css?v=323`.
    - Update versi Service Worker ke `taskflow-v388-dashboard-pomodoro-focus`.
  - `webapp.py` & `static/sw.js`: Bump cache SW ke `taskflow-v388-dashboard-pomodoro-focus`.
  - Tests:
    - Unit test baru di `tests/offline/focus_workstation.test.js`:
      - Memvalidasi keberadaan CSS `.dash-focus-btn` dan rendering di `Dashboard` `TodayRow`.
      - Memvalidasi `usePomodoro` `start(explicitTask)` menerima task eksplisit dan menyalakan timer saat closure `focusTask` awalnya null.
      - Memvalidasi `handleDoneParentOnly` dan `handleDoneAll` membersihkan fokus.
    - Asersi stylesheet `app.css?v=323` di `tests/offline/note_toc.test.js`.
    - Asersi backend `tests/test_version.py` di-bump ke `v388`.
    - Sinkronisasi versi cache SW ke `v388` di seluruh 8 suite test offline.
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `node --test tests/offline/*.test.js` ➡️ **1017/1017 passed (0 failed)** across 8 suites.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.

## 🟢 Progressive Disclosure Dashboard & Onboarding Task Prefill — 2026-10-11 (Antigravity/Gemini) — SELESAI & DEPLOYED (Merged ke `main`)
- **Status:** 🟢 SELESAI, MERGED ke `main` & PUSHED ke GitHub (`origin/main`). SW v387 `taskflow-v387-quick-capture-onboarding-prefill` & `app.css?v=322`. Deploy pipeline VPS aktif otomatis.
- **Spec & Plan:**
  - `docs/superpowers/specs/2026-10-11-dashboard-progressive-onboarding-design.md` (commit `6acd880`)
  - `docs/superpowers/plans/2026-10-11-dashboard-progressive-onboarding.md` (commit `e950ef6`)
- **Konteks & Masalah:**
  - Pengguna baru tanpa tugas/data dihadapkan pada ~17 kontainer kosong yang mengintimidasi (5 KPI angka 0, grafik analitik kosong, 4 kuadran Eisenhower kosong, 4 kuadran GTD kosong).
  - Masalah UX: `parseQuickCapture` memerlukan awalan `tugas/task/todo` agar teks menjadi Task dan bukan Note. Pengguna baru yang mengetik biasa tanpa awalan akan menghasilkan Note, sehingga `tasks.length` tetap 0 dan langkah 1 onboarding tidak tercentang.
  - Solusi yang diimplementasikan:
    1. Progressive disclosure menyembunyikan 17 kontainer kosong saat `tasks.length === 0`.
    2. Kartu "Mulai Langkah Pertama" (`DashOnboardingCard`) dengan tombol *"✍️ Buat Tugas"* yang secara otomatis mengisikan teks awalan `"Tugas: "` ke input capture bar, memposisikan kursor di akhir teks, dan scroll halus ke tengah layar.
    3. Teks instruksi Langkah 1 diperjelas: *"Awali dengan kata tugas (contoh: Tugas: beli buku besok) lalu tekan Enter, atau klik tombol di samping."*
    4. Placeholder baris input capture adaptif: saat `!hasTasks` menampilkan *"Awali 'tugas: ...' untuk tugas, atau tulis apa saja untuk catatan..."*.
    5. Saat ada tugas (`tasks.length > 0`), KPI dan matriks otomatis muncul dan kartu onboarding berganti ke kartu Prioritas Hari Ini. Seksi Analitik baru muncul jika ada tugas selesai (`hasCompletedTasks`).
    6. Sesuai aturan wajib: TIDAK ADA garis tepi berwarna di sisi kiri (`borderLeft` dilarang).
- **Perubahan yang Selesai:**
  - `static/app.css`:
    - Menambahkan CSS `.dash-onboarding-card`, `.onboarding-head`, `.onboarding-step-item`, badge, dan tombol CTA.
    - Menambahkan fallback CSS variables untuk dark mode (`[data-theme="dark"]`).
    - Tanpa `border-left` berwarna.
  - `static/index.html`:
    - Greeting teks hangat: *"Selamat datang di Alurik! Mari mulai dengan mencatat tugas atau ide pertamamu."* saat `tasks.length === 0`.
    - Komponen modular `DashOnboardingCard` dengan instruksi eksplisit dan tombol prefill `"Tugas: "`.
    - Placeholder adaptif pada `.dash-capture input`.
    - Conditional rendering untuk `dash-kpis`, `dash-main` (kartu onboarding vs prioritas), `eisenhower-grid`, `gtd-grid`, dan `charts-grid` (Analitik).
    - Memperbarui stylesheet link ke `/static/app.css?v=322` dan SW fallback ke `taskflow-v387-quick-capture-onboarding-prefill`.
  - `webapp.py` & `static/sw.js`:
    - Bump cache SW ke `taskflow-v387-quick-capture-onboarding-prefill`.
  - Tests:
    - Unit test baru `tests/offline/dashboard_onboarding.test.js` dengan pengujian prefill, placeholder adaptif, dan instruksi baru.
    - `tests/test_version.py` di-bump ke `v387`.
    - Sinkronisasi versi cache SW ke `v387` di seluruh 8 suite test offline.
- **Verifikasi Pengujian:**
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `node --test tests/offline/*.test.js` ➡️ **1014/1014 passed (0 failed)** across 8 suites.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
- **Review:** Task 1, 2, 3 Review (Approved), Bounded Task Review (Approved), Whole-Branch Review (Ready to merge: Yes).

## 🟢 Redesain Split-View Kalender (Layar Lebar >= 1200px) & Sidebar Agenda — 2026-10-11 (Antigravity/Gemini) — SELESAI & DEPLOYED (Merged ke `main`)
- **Status:** 🟢 SELESAI, MERGED ke `main` & PUSHED ke GitHub (`origin/main`). SW v385 `taskflow-v385-calendar-split-view-redesign` & `app.css?v=321`. Deploy pipeline VPS aktif otomatis.
- **Spec & Plan:**
  - `docs/superpowers/specs/2026-10-11-calendar-split-view-redesign.md`
  - `docs/superpowers/plans/2026-10-11-calendar-split-view-redesign.md`
- **Konteks & Masalah:**
  - Pada layar lebar (>= 1200px), tampilan kalender bulanan terasa terlalu lapang/terentang dan cell bulanan terbatas tingginya sehingga task chip terpotong cepat (`+N lagi`).
  - Pengguna menginginkan redesain split-view: grid kalender bulanan di sebelah kiri (dengan tinggi cell desktop ditingkatkan ke 105px dan chip ditampilkan hingga 3 task sebelum `+N lagi`), serta sidebar agenda interaktif yang sticky di sebelah kanan (lebar ~340px) pada layar >= 1200px.
  - Sidebar agenda menampilkan tanggal aktif (default ke hari ini atau tgl 1), tombol "+ Tugas", daftar tugas pada hari tersebut lengkap dengan checkbox penyelesaian, detail hari libur nasional, serta rangkuman hari libur bulan berjalan.
  - Pada layar lebar, klik tanggal langsung memperbarui agenda sidebar tanpa modal overlay yang menghalangi. Di layar < 1200px, modal popup dan daftar tanggal tetap berfungsi seperti semula.
  - Sesuai aturan wajib pengguna: TIDAK ADA garis tepi berwarna di sisi kiri task (`borderLeft` styling dilarang keras).
- **Perubahan yang Selesai:**
  - `static/app.css`:
    - Menambahkan `.cal-split-layout` (2-kolom grid `minmax(0, 1fr) 340px` dengan `gap: 20px; align-items: start;` pada `@media (min-width: 1200px)`).
    - Menambahkan `.cal-split-sidebar` (`position: sticky; top: 80px;`, tersembunyi `display: none` di bawah 1200px).
    - Menambahkan styling lengkap agenda header, badge, filter, list item dengan checkbox custom (`.cal-agenda-checkbox`), empty state, dan kartu hari libur nasional.
  - `static/index.html`:
    - Mengintegrasikan split layout di `CalendarView`.
    - Meningkatkan tinggi desktop cell kalender menjadi `minHeight: 105, height: 105` dan menampilkan hingga 3 chip sebelum `+N lagi`.
    - Menambahkan parameter `onDone` pada `TaskListItems` dan menambahkan checkbox toggle tugas.
    - Pada klik tanggal di layar lebar (`window.innerWidth >= 1200`), state `selectedDay` diperbarui dan modal overlay disembunyikan agar navigasi sidebar mulus.
    - Menambahkan default `selectedDay` saat pertama kali render (hari ini jika di bulan aktif, atau tanggal 1 bulan tersebut).
    - Memperbarui link stylesheet ke `/static/app.css?v=321`.
    - Memperbarui fallback dan `window.__SW_VERSION` ke `taskflow-v385-calendar-split-view-redesign`.
  - `webapp.py`:
    - Memperbarui `sw_cache = "taskflow-v385-calendar-split-view-redesign"`.
  - `static/sw.js`:
    - Bump cache Service Worker ke `taskflow-v385-calendar-split-view-redesign`.
  - `tests/test_version.py`:
    - Memperbarui asersi versi backend ke `v385`.
  - `tests/offline/note_toc.test.js`:
    - Memperbarui asersi stylesheet ke `app.css?v=321`.
  - Sinkronisasi versi cache SW ke `taskflow-v385-calendar-split-view-redesign` di 8 test suites offline.
  - `tests/offline/calendar_week_view.test.js`:
    - Menambahkan test suite offline untuk memvalidasi `cal-split-layout`, sticky sidebar, desktop cell 105px, dan rendering 3 chips.
- **Verifikasi Pengujian:**
  - `node --check static/sw.js` ➡️ **OK**.
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --test tests/offline/*.test.js` ➡️ **1010/1010 passed (0 failed)** across 8 suites.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
- **Commit:** `466d7db feat(calendar): split-view layout on wide screens with agenda sidebar and bump SW v385`.

## 🟢 Implementasi Dashboard Full-Width Fluid (Layar Lebar) — 2026-10-11 (Antigravity/Gemini) — SELESAI & DEPLOYED (Merged ke `main`)
- **Status Integrasi:** Merged ke `main` (commit `459db81`), dipush ke GitHub (`origin/main`). Feature branch `feat/dashboard-full-width-fluid` telah dihapus.
- **Spec & Plan:**
  - `docs/superpowers/specs/2026-10-11-dashboard-full-width-fluid-design.md`
  - `docs/superpowers/plans/2026-10-11-dashboard-full-width-fluid.md`
- **Konteks & Masalah Selesai:** Di layar laptop/monitor lebar, `.dash` yang sebelumnya dibatasi `max-width: 1320px;` kini telah diubah menjadi `width: 100%; max-width: 100%;` di `static/app.css:2301`.
- **Perubahan yang Selesai:**
  - `static/app.css`: `.dash` diubah ke `width: 100%; max-width: 100%;`.
  - `static/index.html`: stylesheet di-bump ke `/static/app.css?v=320`, fallback dan `window.__SW_VERSION` diperbarui ke `taskflow-v384-dashboard-full-width-fluid`.
  - `webapp.py`: `sw_cache = "taskflow-v384-dashboard-full-width-fluid"`.
  - `static/sw.js`: `const CACHE = "taskflow-v384-dashboard-full-width-fluid";`.
  - `tests/test_version.py`: asersi versi backend diperbarui ke `v384`.
  - `tests/offline/app_update_notifier.test.js`: ditambahkan unit test 10 untuk asersi tata letak `.dash` (width: 100%, max-width: 100%, tanpa 1320px).
  - Sinkronisasi versi cache SW ke `taskflow-v384-dashboard-full-width-fluid` di semua test offline terkait (8 file).
  - Tracking docs: spec dan implement plan dicatat di commit `b20cecf`.
- **Verifikasi Pengujian:**
  - `node --check static/sw.js` ➡️ **OK**.
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --test tests/offline/*.test.js` ➡️ **1008/1008 passed (0 failed)** across 8 suites.
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
  - `venv/bin/python -m pytest tests/` ➡️ **134 passed, 1 failed** (1 failure adalah kegagalan pre-existing upstream pada commit `413f9c0`).
- **Review:** Task 1 Review Approved (Spec ✅, Quality Approved); Whole-Branch Review Approved (Ready to merge: Yes).
- **Status:** 🟢 SELESAI, MERGED ke `main` & PUSHED ke GitHub (`origin/main`). SW v384 `taskflow-v384-dashboard-full-width-fluid` & `app.css?v=320`. Deploy pipeline VPS aktif otomatis.


## 🟢 Fitur Notifikasi & Deteksi Pembaruan Aplikasi (PWA & Web) — 2026-10-11 (Antigravity/Gemini) — SELESAI
- **Task:** Implementasi notifikasi dan deteksi pembaruan aplikasi Alurik (PWA & Web).
- **Komponen & Perubahan:**
  1. `webapp.py`:
     - Menambahkan header `Cache-Control` (`no-cache, no-store, must-revalidate, max-age=0`), `Pragma: no-cache`, `Expires: 0` pada endpoint `GET /sw.js`.
     - Menambahkan endpoint publik `GET /api/version` yang mengembalikan info versi JSON (`app_version: "4.0.0"`, `sw_version: "taskflow-v383-app-update-notifier"`, `cache_name`, `timestamp`) dengan header `Cache-Control: no-cache, no-store, must-revalidate`.
  2. `static/sw.js`:
     - Bump cache Service Worker ke `taskflow-v383-app-update-notifier`.
     - Update lifecycle: pada event `install`, jika `!self.registration.active` panggil `self.skipWaiting()`; jika sudah ada SW aktif biarkan masuk state `waiting` sampai pengguna memilih perbarui.
     - Event listener `message`: menangani string `"SKIP_WAITING"` dan objek `{ type: "SKIP_WAITING" }`.
     - Route `GET /api/version` diatur sebagai `NETWORK-ONLY` agar bebas dari stale cache.
  3. `static/index.html` & `static/app.css`:
     - Komponen melayang `UpdateNotificationBanner` (ikon 🚀, pesan update, tombol "🔄 Perbarui Sekarang", dan tombol tutup "✕") dengan styling `var(--bg-card)` dan animasi `slideUpFade`.
     - Handler `applyAppUpdate`: mengirim pesan `SKIP_WAITING` ke waiting worker dan reload halaman via event `controllerchange`.
     - Registrasi Service Worker & deteksi: melacak event `updatefound` dan worker state `installed` saat ada worker waiting.
     - Global function `window.checkForAppUpdate(options)`: memanggil `reg.update()`, cek `/api/version`, dan menampilkan toast responsif saat dipanggil manual.
     - Event listener `visibilitychange` (cek update otomatis saat tab dibuka) & auto-check periodik via `setInterval` tiap 30 menit.
     - Halaman Pengaturan (`SettingsPage`): kartu info versi aplikasi dan tombol "🔍 Cek Pembaruan" (`window.checkForAppUpdate({ manual: true })`).
  4. Pengujian & Sinkronisasi:
     - 7 file test offline disinkronkan ke cache `taskflow-v383-app-update-notifier`.
     - Unit test backend baru `tests/test_version.py` untuk endpoint `/api/version` dan header `/sw.js`.
     - Unit test offline baru `tests/offline/app_update_notifier.test.js` (9/9 pass).
- **Verifikasi:**
  - `venv/bin/python -m pytest tests/test_version.py` ➡️ **2 passed (0 failed)**.
  - `node temporary_files/check_inline_scripts.js static/index.html` ➡️ **5/5 inline scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `node --test tests/offline/app_update_notifier.test.js` ➡️ **9/9 passed**.
  - `node --test tests/offline/*.test.js` ➡️ **1007/1007 passed (0 failed)** across 8 suites.
- **Status:** 🟢 SELESAI (SW v383 `taskflow-v383-app-update-notifier`).

## 🟢 Sinkronisasi Repo Lokal dari GitHub — 2026-10-11 (Antigravity/Gemini) — SELESAI
- **Task:** Sinkronisasi repo lokal yang tertinggal dari GitHub (`origin/main`).
- **Status Sinkronisasi:**
  - Branch lokal `main` telah di-fast-forward dari `d57a1a8` ke `2303019` (`origin/main` / `origin/HEAD`), menarik 106 file terubah (+28503, -4615).
  - Production vendor bundle `draw-app` berhasil di-rebuild via `npm --prefix draw-app run build` (`static/vendor/tldraw/assets/index.js`).
- **Verifikasi:**
  - JS offline test suite (`node --test tests/offline/*.test.js`): **998/998 PASS (0 FAIL)** across all 8 suites.
  - Backend test suite (`venv/bin/python -m pytest tests/`): 132 passed, 1 failed (`test_delete_is_atomic_when_snapshot_fails` di `tests/test_note_trash.py` bawaan dari commit upstream `413f9c0`).

## 🟢 Perbaikan Pengiriman Chat & Self-Healing Migration Skema Chat — 2026-10-08 (Claude) — SELESAI
- **Masalah:** Pengguna melaporkan pesan chat tidak bisa terkirim (stuck di status "🕐 mengirim…" pada obrolan grup / shared list atau gagal kirim).
- **Root Cause:**
  1. **Missing Table & Columns di Database:** Pada endpoint `POST /api/lists/{id}/messages` dan `GET /api/lists/{id}/messages`, query melakukan `LEFT JOIN workspace_files wf ON wf.id = m.file_id` dan `INSERT INTO messages` menyertakan kolom `file_id`, `note_id`, `client_id`. Namun tabel `workspace_files` dan kolom `file_id` sebelumnya hanya dibuat via `migrate_db()` saat startup. Saat kode di-deploy via CI/CD tanpa restart proses webapp di VPS, tabel `workspace_files` belum terbuat di SQLite (`sqlite3.OperationalError: no such table: workspace_files`). Akibatnya, backend melempar error 500, background sync `syncpush.js` gagal push (`server_error_500`), dan pesan tetap berstatus `pending: 1` ("🕐 mengirim…") tanpa terkirim ke server.
  2. **CI/CD Deploy Script:** `.github/workflows/deploy.yml` sebelumnya tidak menjalankan `migrate_db()` setelah pull kode baru.
  3. **Repository Init DB:** `TaskRepository._init_db()` di `repository.py` belum menyertakan pembuatan tabel `workspace_files`, `dm_conversations`, `dm_messages`, `dm_reads`, `dm_blocks` serta migrasi kolom `file_id`, `note_id`, `client_id` pada tabel `messages`.
  4. **Payload Validation:** Pada `ChatInputBar`, `task_id`, `note_id`, `file_id`, dan `reply_to_id` berpotensi dikirim sebagai string client ID (cid) bukannya integer server ID, yang dapat memicu error 422 Unprocessable Entity dari Pydantic.
- **Solusi & Implementasi:**
  1. `webapp.py`:
     - Menambahkan fungsi self-healing `_ensure_workspace_files_table(conn)`, `_ensure_chat_schema(conn)`, dan `_ensure_dm_schema(conn)`.
     - Memanggil `_ensure_chat_schema(conn)` di `get_messages` dan `post_message`.
     - Memanggil `_ensure_workspace_files_table(conn)` di `list_workspace_files`, `upload_workspace_file`, `download_workspace_file`, `delete_workspace_file`, serta attachment task.
     - Memanggil `_ensure_dm_schema(conn)` di semua endpoint DM (`_dm_get_conv_or_404`, `dm_contacts`, `dm_list_conversations`, `dm_create_conversation`).
  2. `repository.py`:
     - Memperbarui skema `messages` di `_init_db()` agar mencakup `note_id`, `file_id`, `client_id`, `reply_to_id`.
     - Menambahkan pembuatan tabel `workspace_files` dan seluruh tabel DM di `_init_db()`.
     - Menambahkan migrasi kolom `file_id`, `note_id`, `client_id`, `reply_to_id` jika belum ada di tabel `messages`.
  3. `static/index.html` & `static/offline/syncpush.js`:
     - Memastikan `task_id`, `note_id`, `file_id`, dan `reply_to_id` hanya dikirim sebagai integer murni (atau `null`), mencegah error 422 Pydantic.
     - Mendaftarkan `setCurrentUser` untuk chat, note, dan mindmap saat `handleLogin`.
  4. `.github/workflows/deploy.yml`:
     - Menambahkan eksekusi `venv/bin/python -c "import webapp; webapp.migrate_db()"` pada pipeline deploy VPS.
  5. `static/sw.js` & Tests:
     - Bump cache Service Worker ke `taskflow-v382-chat-send-self-healing`.
     - Menambahkan unit test self-healing di `tests/test_chat_self_healing.py`.
     - Sinkronisasi versi cache di 7 file test offline.
- **Status:** 🟢 SELESAI (SW v382 `taskflow-v382-chat-send-self-healing`).

## 🟢 Pengerasan Ketahanan Hapus Catatan & Bulletproof Trash Snapshot — 2026-10-08 (Claude) — SELESAI
- **Masalah:** `DELETE /api/scratchpad/:id` sebelumnya mengembalikan HTTP 500 saat menghapus catatan (misal note id 228), sehingga catatan gagal dihapus dan tidak masuk ke Sampah.
- **Root Cause:**
  1. Pada `delete_scratchpad` di `webapp.py`, jika `row["user_id"]` adalah `None` atau tidak sesuai tipe, `row["user_id"] != uid` menolak atau saat `_snapshot_note_to_trash` mencoba `INSERT INTO trashed_notes`, jika `note.get("user_id")` `None` atau FK constraint memicu IntegrityError, query melempar 500 dan transaksi SQLite rollback.
  2. Pada `delete_scratchpad`, trigger FTS5 `trg_scratchpad_notes_ad` pada `scratchpad_notes` dapat memicu `IntegrityError` / `OperationalError` jika FTS external-content out-of-sync.
  3. Pada `list_trashed_notes`, `WHERE user_id = ? OR user_id = ? OR user_id IS NULL OR user_id = ''` memastikan seluruh catatan sampah terbaca tanpa terlewat.
- **Solusi & Implementasi:**
  1. `webapp.py`:
     - Di `_snapshot_note_to_trash`, penentuan `note_uid` dengan fallback user ID aktif/admin serta perlindungan `PRAGMA foreign_keys=OFF` fallback jika tabel lama memiliki FK constraint ketat.
     - Di `delete_scratchpad`, guard `if row["user_id"] is not None and str(row["user_id"]) != str(uid)` serta safe try-except pada snapshot dan penghapusan relasi.
     - Penanganan `sqlite3.IntegrityError` pada trigger FTS5: jika trigger delete FTS5 gagal karena sync mismatch, trigger di-drop sementara lalu dibuat ulang secara otomatis.
     - Di `list_trashed_notes`, query membaca `WHERE user_id = ? OR user_id = ? OR user_id IS NULL OR user_id = ''` untuk menjamin catatan sampah selalu muncul.
  2. `static/index.html`:
     - Guard query attachments `api.get(/api/scratchpad/${note.id}/attachments)` dengan regex integer `!note?.id || !/^\d+$/.test(String(note.id))` untuk mencegah error 422 saat note berstatus cid lokal.
  3. `static/sw.js` & Tests:
     - Bump cache Service Worker ke `taskflow-v381-notes-trash-bulletproof`.
     - Sinkronisasi asersi versi cache di 7 file test offline.
- **Verifikasi:**
  - `node --check static/sw.js` ➡️ **OK**.
  - `node --test tests/offline/note_trash_sync.test.js tests/offline/notetrash.test.js tests/offline/note_trash_routing.test.js` ➡️ **31/31 pass (0 fail)**.
  - Synchronized offline tests ➡️ **100/100 pass (0 fail)** across test suites.
- **Status:** 🟢 SELESAI (SW v381 `taskflow-v381-notes-trash-bulletproof`).

## 🟢 Perbaikan Note Trash & Self-Healing Migration Tabel Sampah — 2026-10-07 (Claude) — SELESAI
- **Masalah:** Tombol Sampah (Trash) di halaman catatan tidak berfungsi dan daftar sampah selalu kosong meskipun pengguna telah menghapus catatan.
- **Root Cause:**
  1. **Backend / Database Migration:** Tabel `trashed_notes` sebelumnya hanya dibuat via `migrate_db()` saat startup uvicorn. Ketika kode di-deploy via CI/CD tanpa restart proses VPS, tabel `trashed_notes` belum ada di database SQLite. Akibatnya, `DELETE /api/scratchpad/{id}` melempar error 500 (`no such table: trashed_notes`) saat mencoba snapshot, sehingga catatan tidak tersimpan ke Sampah dan `GET /api/scratchpad/trash` mengembalikan error / kosong.
  2. **Offline Syncpush:** Pada `opNoteDelete` di `syncpush.js`, jika pemetaan di IndexedDB `_idmap` hilang/kosong, `TFidmap.serverIdOf(op.cid)` bernilai `undefined`, menyebabkan penghapusan hanya diproses di lokal tanpa mengirim `DELETE /api/scratchpad/{sid}` ke backend.
  3. **UI NoteModal:** Tombol hapus di `NoteModal` tidak memanggil `onClose()`, membiarkan modal tetap terbuka setelah dihapus.
- **Solusi & Implementasi:**
  1. `webapp.py`:
     - Menambahkan fungsi self-healing `_ensure_trashed_notes_table(conn)` yang dipanggil otomatis saat snapshot note, purge expired, list trash, restore, dan delete scratchpad. Tabel `trashed_notes` otomatis terbuat seketika pada request pertama tanpa perlu restart service manual di VPS.
     - Menambahkan pengujian `test_trashed_notes_lazy_self_healing_when_table_dropped` di `tests/test_note_trash.py`.
  2. `static/offline/syncpush.js`:
     - Memperbarui `opNoteDelete` agar melakukan fallback ke `rec.server_id` jika `_idmap` tidak memiliki record, memastikan request `DELETE` tetap terkirim ke server.
     - Menambahkan unit test di `tests/offline/note_trash_sync.test.js`.
  3. `static/index.html`:
     - Menambahkan pemanggilan `onClose()` saat konfirmasi hapus di `NoteModal`.
  4. `static/sw.js` & Tests:
     - Bump cache Service Worker ke `taskflow-v379-notes-trash-self-heal`.
     - Sinkronisasi asersi versi cache di 7 file test offline.
- **Verifikasi:**
  - `node --check static/sw.js` ➡️ **OK**.
  - `node --test tests/offline/note_trash_sync.test.js tests/offline/notetrash.test.js tests/offline/note_trash_routing.test.js` ➡️ **31/31 pass (0 fail)**.
  - Full synchronized offline test suite ➡️ **100/100 pass (0 fail)**.
- **Status:** 🟢 SELESAI (SW v379 `taskflow-v379-notes-trash-self-heal`).

## 🟢 Dukungan Multiline & Preservasi Newline pada Bubble Chat — 2026-10-07 (Claude) — SELESAI
- **Kebutuhan Pengguna:**
  1. Input chat yang memiliki baris baru (*newline* via `Shift + Enter`) sebelumnya hanya terlihat 1 baris di textarea dan menutupi teks saat ada lampiran.
  2. Ketika pesan chat dengan baris baru terkirim, gelembung pesan (`.chat-bubble`) sebelumnya tidak merender baris baru (semua teks menyatu dalam 1 paragraf mengalir).
- **Solusi & Implementasi:**
  1. `static/app.css`:
     - Menambahkan `white-space: pre-wrap; word-break: break-word;` pada `.chat-bubble` sehingga karakter baris baru (`\n`) ter-render sebagai baris baru sejati tanpa merusak wrapping kata-kata panjang.
     - Menambahkan class `.chat-attach-preview-banner` di atas input bar.
     - Bump stylesheet query ke `app.css?v=319`.
  2. `static/index.html`:
     - Menambahkan handler `autoResizeTextarea` pada `ChatInputBar` dan `DmInputBar`: saat ada baris baru, tinggi textarea otomatis membesar minimal 5 baris (~115px) hingga maks 125px (scrollable).
     - Memindahkan banner lampiran berkas/task/note (`.chat-attach-preview-banner`) berada bersih di atas textarea (bukan absolute overlay yang menutupi area ketik).
  3. `static/sw.js` & Tests:
     - Bump cache Service Worker ke `taskflow-v378-chat-bubble-newline-pre-wrap`.
     - Menambahkan uji `ChatInputBar renders attachment preview banner above input text and supports multiline auto-resize` di `tests/offline/workspace_files_chat.test.js`.
     - Menambahkan uji `.chat-bubble should have white-space: pre-wrap and word-break: break-word` di `tests/offline/chat_page_layout.test.js`.
     - Sinkronisasi asersi versi cache dan stylesheet di 9 test offline.
- **Verifikasi:**
  - `node scratch/check_inline.js static/index.html` ➡️ **5/5 scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - Offline tests ➡️ **Pass across all suites**.
  - Backend pytest ➡️ **130/130 pass (0 fail)**.
- **Status:** 🟢 SELESAI (SW v378 `taskflow-v378-chat-bubble-newline-pre-wrap`).

## 🟢 Auto-Detect Quick Task & Center Screen Fade Notification di Dashboard — 2026-10-07 (Claude) — SELESAI
- **Kebutuhan Pengguna:**
  1. Pada kolom input capture Dashboard ("Tulis apa saja... tekan Enter untuk simpan"), pengguna ingin tulisan otomatis dideteksi menjadi Task jika diawali kata kunci task (seperti `tugas`, `task`, `tasks`, `todo`, `todos`), bukan selalu menjadi Note.
  2. Contoh masukan: `"Tugas, beli mobil fortuner besok"` otomatis menjadi Task dengan judul `"beli mobil fortuner"` dan deadline besok.
  3. Saat pengguna menekan Enter, muncul notifikasi di tengah layar yang mengindikasikan apakah `Task Created` atau `Note Created` dengan animasi pop-in lalu memudar otomatis (auto fade-out) tanpa perlu diklik.
  4. **Enhancement HUD Badge:** Tampilan didesain lebih mewah dan modern berupa pill badge (`border-radius: 9999px`) dengan badge ikon melingkar (`.center-hud-icon-wrap`), tanpa garis tepi kiri yang kasar, durasi tampil lebih lama (~2.8 detik) agar nyaman dibaca sebelum memudar halus.
- **Solusi & Implementasi:**
  1. `static/index.html`:
     - Fungsi `parseQuickCapture(text, baseDate)`: mendeteksi awalan `tugas`, `task`, `tasks`, `todo`, `todos` (case-insensitive) diikuti pemisah (`,`, `:`, `-`, `.`) atau spasi.
     - Mengekstrak kata waktu relatif (`hari ini`/`today`, `besok`/`tomorrow`, `lusa`) menjadi deadline ISO `YYYY-MM-DD` dan membersihkan judul task.
     - Handler `handleScratch`: jika `parsed.isTask`, memanggil `api.post("/api/tasks", { title, deadline, priority: "P3", gtd_status: "inbox" })`, mendukung offline queue fallback, memicu `taskSaved` event, dan memanggil `window.__refreshTasks()` sehingga ring KPI dan daftar prioritas Dashboard ter-update seketika.
     - Notifikasi HUD tengah layar (`.center-hud-toast`): dirender di Dashboard saat enter ditekan dengan pesan `Task Created` (ikon checklist melingkar hijau) atau `Note Created` (ikon note melingkar indigo), auto-dismiss setelah 2.8 detik.
     - Listener `taskSaved` di `App` untuk sinkronisasi `fetchAll()`.
     - Bump stylesheet query ke `app.css?v=318`.
  2. `static/app.css`:
     - Menambahkan styling `.center-hud-toast`, `.center-hud-icon-wrap`, `.center-hud-icon-task`, `.center-hud-icon-note`, `.center-hud-title` dengan backdrop blur 16px, pill border radius, subtle multi-layer shadow, penempatan tengah layar (`top: 50%; left: 50%; transform: translate(-50%, -50%)`), `pointer-events: none`, serta keyframes animasi `centerHudFade` 2.8s.
  3. `static/sw.js` & Tests:
     - Bump cache Service Worker ke `taskflow-v377-hud-toast-redesign-longer-fade`.
     - Menambahkan test suite baru `tests/offline/quick_capture_detect.test.js`.
     - Sinkronisasi versi cache dan stylesheet di 8 file test offline.
- **Status:** 🟢 SELESAI (SW v377 `taskflow-v377-hud-toast-redesign-longer-fade`).

## 🟢 Perbaikan Share Workspace File ke Chat (Offline Repo & Syncpush) — 2026-10-07 (Claude) — SELESAI
- **Masalah:** Saat pengguna membagikan berkas workspace yang sudah ada ke obrolan (`handleShareToChat` di tab Files), kartu di ruang chat sempat menampilkan status "*🗑️ BERKAS TELAH DIHAPUS*" meskipun berkas masih ada di workspace.
- **Root Cause:**
  1. `POST /api/lists/:id/messages` dicegat oleh router lokal (`TF.taskroutes` ➔ `TF.chatrepo.sendMessage`), namun `chatrepo.js` tidak menyimpan `file_id`, `file_original_name`, `file_size`, `file_mime_type`, dan `file_is_deleted` ke IndexedDB `chat_messages` maupun pada fungsi `shape()` & `upsertOne()`.
  2. Saat sinkronisasi outbox berjalan (`opChatSend` di `syncpush.js`), `chatSendPayload()` tidak menyertakan `file_id`, sehingga pesan dikirim ke backend tanpa `file_id`.
  3. UI `FileMiniCard` memvalidasi `msg.file_is_deleted || !msg.file_original_name`. Karena metadata berkas hilang/kosong, kartu otomatis menganggap berkas dihapus.
- **Solusi:**
  1. `static/offline/chatrepo.js`: Mempertahankan dan memetakan `file_id`, `file_original_name`, `file_size`, `file_mime_type`, serta `file_is_deleted` pada `shape()`, `upsertOne()`, dan `sendMessage()`.
  2. `static/offline/syncpush.js`: Menambahkan `file_id: rec.file_id` pada `chatSendPayload()` dan memperbarui record lokal saat respons server diterima pada `opChatSend()`.
  3. `static/index.html`: Menyertakan `file_original_name`, `file_size`, `file_mime_type`, dan `client_id` saat `handleShareToChat` dan `ChatInputBar` mengirim pesan agar kartu optimistik langsung lengkap dan reaktif.
  4. Pengujian & SW: Menambahkan pengujian di `tests/offline/chatrepo.test.js`, `tests/offline/chatsync_push.test.js`, dan `tests/offline/workspace_files_chat.test.js`.
- **Verifikasi:**
  - `node scratch/check_inline.js static/index.html` ➡️ **5/5 scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - Full offline tests ➡️ **987/987 pass (0 fail)** across all suites.
  - Backend pytest ➡️ **130/130 pass (0 fail)**.
- **Status:** 🟢 SELESAI.

## 🟢 Tata Letak 2-Baris Mini Pomodoro di Mobile Topbar — 2026-10-07 (Claude) — SELESAI
- **Masalah:** Pada tampilan mobile, widget mini Pomodoro (`TopBarPomodoroChip`) sebelumnya berdesakan di baris pertama sejajar dengan tombol hamburger `☰` dan seluruh tombol aksi (`🔍`, `🔔`, `?`, `☀️/🌙`), menyebabkan judul task terpotong sempit (`max-width: 85px`) dan header sangat sesak.
- **Solusi:**
  1. `static/index.html`: Merestrukturisasi `.mobile-topbar` menjadi 2 baris terpisah saat Pomodoro aktif:
     - Baris 1 (`.mobile-topbar-main`): Tombol hamburger, spacer, dan tombol aksi pencarian, notifikasi, tour, serta toggle tema.
     - Baris 2 (`.mobile-topbar-pomo-row`): Dirender kondisional saat `page !== "today" && focusTask`, memuat `TopBarPomodoroChip`.
  2. `static/app.css`:
     - Menyesuaikan `.mobile-topbar` dengan `flex-direction: column; gap: 8px;`.
     - Memberikan styling `.mobile-topbar-main` (flex 100%) dan `.mobile-topbar-pomo-row` (flex 100%).
     - Memperluas `.mobile-topbar-pomo-row .topbar-pomo-task` di mobile menjadi `max-width: calc(100vw - 150px)` agar nama task terbaca jelas dan tidak terpotong sempit.
     - Bump stylesheet query ke `app.css?v=316`.
  3. SW & Tests: Bump cache version SW ke `taskflow-v374-mobile-pomodoro-second-row`. Menambahkan pengujian di `tests/offline/focus_workstation.test.js` dan menyesuaikan asersi stylesheet di `tests/offline/note_toc.test.js` serta sinkronisasi versi cache di 7 test offline.
- **Verifikasi:**
  - `node --check static/sw.js` ➡️ **OK**.
  - `node --test tests/offline/focus_workstation.test.js` ➡️ **14/14 pass (0 fail)**.
  - `node --test tests/offline/note_toc.test.js` ➡️ **50/50 pass (0 fail)**.
  - Synchronized offline tests ➡️ **99/99 pass (0 fail)** across test suites.
- **Status:** 🟢 SELESAI (SW v374 `taskflow-v374-mobile-pomodoro-second-row`).

## 🟢 CI / CD Deployment Git Lock & Ref Mismatch Resilience — 2026-10-06 (Antigravity/Gemini) — SELESAI (`main`, Commit `4352293`)
- **Masalah:** Deploy workflow gagal akibat stale lock dan ref mismatch saat push beruntun (`cannot lock ref 'refs/remotes/origin/main'`).
- **Solusi:** Di `.github/workflows/deploy.yml`, menambahkan `rm -f .git/refs/remotes/origin/main.lock .git/index.lock` sebelum checkout dan mengganti `git pull` dengan `git fetch --prune origin main` + `git reset --hard origin/main`.
- **Verifikasi CI:**
  - Commit `4352293` pushed ke `origin/main`.
  - GitHub Actions Workflow Run `37470817511` (Deploy Taskflow V4) ➡️ **completed (success)**.
  - GitHub Actions Workflow Run `37470817463` (Tests) ➡️ **completed (success)**.
- **Status:** 🟢 SELESAI & DEPLOYED ke VPS.

## 🟢 Workspace Files Repository & Chat File Attachments — 2026-10-06 (Antigravity/Gemini) — SELESAI (branch `feat/workspace-files-chat-attachments` merged ke `main`, SW v370 `taskflow-v370-workspace-files`)
- **Plan & Spec:** `docs/superpowers/specs/2026-10-05-workspace-files-and-chat-attachments-design.md`, `docs/superpowers/plans/2026-10-05-workspace-files-and-chat-attachments.md`.
- **Fitur Utama:**
  1. **Kemampuan Attach File di Chat (`ChatRoom`):** Tab `[ 📁 File ]` di `AttachPopup`, upload berkas baru atau memilih berkas yang sudah ada di workspace, preview chip di input bar, dan render kartu berkas interaktif `FileMiniCard` dengan pratinjau & unduh.
  2. **Tab Files di Workspace (`slist_<id>`):** Tab navigasi `[ 📋 Tasks ] [ 📁 Files (N) ]` pada halaman workspace, pencarian berkas instan, filter kategori (PDF, Dokumen/Sheet, Gambar), tracking asal-usul (chat, task, langsung), tombol aksi pratinjau, unduh, bagikan ke chat, dan hapus.
  3. **Katalog Terpusat & Agregasi Otomatis:** Lampiran task (`task_attachments`) di dalam workspace otomatis tercatat di `workspace_files`.
  4. **Kebijakan Hapus (Opsi A):** Hanya uploader berkas dan owner workspace yang berhak menghapus file (soft delete + physical delete).
- **Hasil Eksekusi 7 Task TDD:**
  - Task 1: Database migration & schema setup (`workspace_files`, `messages.file_id`).
  - Task 2: Backend API untuk workspace files CRUD & download.
  - Task 3: Task attachment auto-sync & chat message file attachment.
  - Task 4: Frontend chat input bar attach popup file tab & preview chip.
  - Task 5: Frontend chat bubble file card (`FileMiniCard`).
  - Task 6: Frontend workspace tabs & `WorkspaceFilesView`.
  - Task 7: Service Worker bump (`taskflow-v370-workspace-files`) & full test suite verification.
- **Verifikasi:**
  - `node scratch/check_inline.js static/index.html` ➡️ **5/5 scripts OK**.
  - `node --check static/sw.js` ➡️ **OK**.
  - `node --test tests/offline/workspace_files_chat.test.js` ➡️ **pass**.
  - Synchronized offline tests ➡️ **pass** across all suites.
  - `python -m pytest tests/test_workspace_files.py` ➡️ **pass**.
  - `python -m pytest tests/` ➡️ **pass**.
- **Status:** 🟢 SELESAI di `main`, SW v370 `taskflow-v370-workspace-files` (Commit `715caeb` pushed ke `origin/main`, CI GitHub Actions deployment triggered).
- **PENDING DEPLOY:** Di VPS WAJIB restart service `sudo systemctl restart taskflow-web` agar `migrate_db()` membuat tabel `workspace_files` dan kolom `messages.file_id`. Klien memerlukan hard refresh browser (Ctrl+Shift+R) atau tutup-buka PWA agar Service Worker v370 aktif.


## 🟢 Global Pomodoro State Persistence & Top Bar Mini Widget — 2026-10-05 (Antigravity/Gemini) — SELESAI (branch `feat/global-pomodoro-topbar-widget`, SW v367 `taskflow-v367-global-pomodoro`)
- **Plan & Spec:** `docs/superpowers/specs/2026-10-05-global-pomodoro-topbar-widget-design.md`, `docs/superpowers/plans/2026-10-05-global-pomodoro-topbar-widget.md`.
- **Fitur:**
  1. **Lifting State ke `App` (`static/index.html`):** State Pomodoro (`timer = usePomodoro(...)`, `focusTask`, `focusTaskId`, `taskPomodoros`) diangkat ke level `App` agar timer terus berjalan saat user berpindah ke halaman lain (Tasks, Habits, Notes, Mindmap, Draw, dll.).
  2. **Persistensi `localStorage` & Drift Correction (`usePomodoro`):** Menyimpan snapshot state Pomodoro ke `tf_pomo_state` (`mode`, `timeLeft`, `isRunning`, `targetEndTime`, `focusTaskId`, dll.). Waktu tersisa dikoreksi terhadap `targetEndTime` untuk mencegah perlambatan/throttling tab di background dan mendukung pemulihan setelah reload tab.
  3. **Mini Widget `TopBarPomodoroChip` (`static/index.html` & `static/app.css`):** Ditampilkan di top bar (`desktop-topbar` dan `mobile-topbar`) saat `page !== "today" && focusTask`. Menampilkan ikon mode (🍅/☕), display waktu tabular (`mm:ss`), judul task fokus (dengan pemotongan ellipsis), dan tombol kontrol mini Play/Pause (`e.stopPropagation()`). Mengklik chip mengarahkan user kembali ke halaman "Fokus Hari Ini" (`setPage("today")`).
  4. **SW Cache Version Bump:** Bump ke `taskflow-v367-global-pomodoro` di `static/sw.js` beserta sinkronisasi seluruh 6 file test offline (`tests/offline/`).
- **Verifikasi:**
  - `node scratch/check_inline.js static/index.html` ➡️ 5/5 scripts OK.
  - `node --check static/sw.js` ➡️ OK.
  - `node --test tests/offline/focus_workstation.test.js` ➡️ 13/13 pass (0 fail).
  - Synchronized offline tests ➡️ 89/89 pass across 6 suites.
  - `python -m pytest tests/` ➡️ 122/122 pass (0 fail).
  - Subagent reviews: Task 1 (review clean), Task 2 (review clean), Task 3 (review clean), Final whole-branch review (Spec ✅, Code Quality: Approved, zero findings).
- **PENDING:** Klien perlu hard refresh browser (Ctrl+Shift+R) atau tutup-buka PWA agar SW v367 aktif.


## 🟢 Note Trash & Restore (backend + klien + perbaikan review) — 2026-10-03 (Gemini/Claude) — SELESAI & MERGED ke `main` (commit `74b8114`, test fix `d5d0b77`, SW v348 `taskflow-v348-notes-trash-and-restore`)
- **Commit:** spec `5a42ff8`, backend `8be74b4`, klien `011d6de`, review `60748b8`, merge `74b8114`, test fix `d5d0b77`. ADR-004 di DECISIONS.md.
- **PENDING saat deploy:** `sudo systemctl restart taskflow-web` WAJIB (tabel `trashed_notes` dibuat oleh `migrate_db()` saat startup; deploy.yml tidak me-restart) → tanpa restart, hapus note gagal 500 karena tabel belum ada; hard refresh browser (SW v348); rebuild APK/.exe.
- **Konteks:** backend sudah di commit `8be74b4` (tabel `trashed_notes`, `/api/scratchpad/trash*`). Spec: `docs/superpowers/specs/2026-10-02-note-trash-design.md`.
- **Jebakan router (diperbaiki + dites):** rute lokal `GET/DELETE /api/scratchpad/:id` menelan `/api/scratchpad/trash`. `taskroutes.js` kini mengekspor `isNoteTrashCall` + `shouldRouteLocally(router, method, path)` (menggabung preseden `isNoteTagsCall`); api wrapper `index.html` memakai `shouldRouteLocally` (fallback inline untuk taskroutes.js lama dari cache SW). `sw.js`: `/api/scratchpad/trash*` NETWORK-ONLY semua method (tanpa cache GET basi; offline → 503 `OFFLINE`). Tidak pernah lewat `OfflineDB.queueAdd`/outbox.
- **UI:** `NoteTrashModal` (index.html, sebelum NotesPage) + tombol ikon `trash` (title "Sampah") di header sidebar Notes. Daftar/Pulihkan/Hapus permanen/Kosongkan (confirm), loading/kosong/error, offline → "Perlu koneksi internet untuk melihat Sampah" tanpa API. Saat dibuka: `__pushNow()` (maks 5 dtk) dulu karena hapus online lewat router lokal + outbox. Pulihkan → `__syncNow()` + `fetchNotes` + titles, toast "♻️ Catatan dipulihkan". Logika murni di modul baru `static/offline/notetrash.js` (`TF.notetrash`, di-precache SW).
- **Konfirmasi hapus:** semua jalur pakai `TF.notetrash.CONFIRM_MOVE` + toast "🗑 Dipindahkan ke Sampah" (panel viewer, NoteModal — sebelumnya TANPA konfirmasi —, mindmap NoteModal, App-level NoteModal). Bug lama diperbaiki: App-level NoteModal memanggil `api.delete` (tidak ada → TypeError) → `api.del`. Perilaku hapus offline (outbox) tidak diubah.
- **Verifikasi:** JS 825/826 (+20 tes: `note_trash_routing.test.js`, `notetrash.test.js`; 1 fail pra-ada `draw_local_reactive`), pytest 90/90, inline 5/5. E2E Playwright 49/49 (desktop 1280 + mobile 390, uvicorn lokal): hapus UI → Sampah → Pulihkan (id asli + tag, server & IndexedDB) → Hapus permanen → Kosongkan → offline. Skrip & screenshot: scratchpad sesi `trash-e2e/`.
- **Review independen + perbaikan (2026-10-02):**
  - BUG 1 restore dibatalkan DELETE tertunda (respons DELETE hilang → op `note/delete` tetap antre → push ulang memindahkan note ke Sampah lagi): `noterepo.discardPendingDelete(serverId)` membuang semua op outbox note itu bila ada op `delete`; rekaman lokal `deleted:true` + idmap DIPERTAHANKAN supaya pull membuatnya ulang dengan cid yang sama. Dipanggil `handleTrashRestored(note)` sebelum `__syncNow`.
  - BUG 2 backlink/outlink lokal hilang setelah restore (note dibuat ulang dengan cid baru, note lain bersih tidak ditulis ulang): `pullNotes` kini, untuk rekaman NON-dirty dengan updated_at sama, memperbarui `linked_to_cids` bila `linked_to` server menunjuk note yang dikenal lokal tapi cid-nya tidak ada di `linked_to_cids` (hasil `relinked`; index.html memicu `noteSaved` bila `relinked > 0`). Id server linked_to tidak perlu disimpan lokal — daftar server di tiap pull membawanya.
  - BUG 3 `_trash_preview` (webapp.py) kuadratik → content dipotong `[:2000]` sebelum regex ('a['*50000: 18 dtk → instan).
  - S-a: semua `window.TF.notetrash.*` di index.html di-guard `?.` + teks bawaan; `NoteTrashModal` menampilkan "Sampah belum termuat. Muat ulang halaman…" bila modul tidak ada. S-b: `notetrash.canTrash(note, uid)` — toast "Dipindahkan ke Sampah" tidak muncul untuk note shared milik orang lain (user_id null/tak diketahui → dianggap pemilik, karena hydrate note pribadi tidak menyimpan user_id).
  - Tes: `tests/offline/note_trash_sync.test.js` (baru, S1/S2 reviewer), tambahan di `notetrash.test.js` & `tests/test_note_trash.py`. JS 835/836 (fail pra-ada tldraw), pytest 91/91, inline 5/5. Koordinator: repro reviewer S1 (dengan handler baru) & S2 lulus; E2E Playwright diulang setelah perbaikan 49/49 (wajib env `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1`, tanpa itu 2 uji SW-offline gagal palsu). Fallback modal S-a belum pernah dirender.
  - **Keterbatasan diketahui:** perangkat kedua yang punya edit dirty pada note saat note itu dihapus di perangkat lain → push PUT 404 → POST membuat note baru; setelah restore ada 2 note (yang dipulihkan + salinan dengan edit) — edit tidak hilang, user merapikan manual.
- **Catatan agen berikut:** Playwright `context.setOffline` TIDAK berlaku untuk fetch dari service worker — uji jalur SW offline pakai `context.route(...abort)` + `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1`. E2E harus menunggu reload `controllerchange` SW pertama sebelum navigasi. Belum dites HP fisik/APK/Tauri.

