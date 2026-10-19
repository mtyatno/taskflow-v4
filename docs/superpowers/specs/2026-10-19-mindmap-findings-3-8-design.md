# Temuan Mindmap #3–#8 — Desain

**Tanggal:** 2026-10-19 · **Status:** keputusan Bapak sudah final (lihat ringkasan temuan di `.agents/CURRENT_STATE.md`, bagian Petakan) · **Rencana:** `docs/superpowers/plans/2026-10-19-mindmap-findings-3-8.md`

Prinsip yang tetap berlaku: offline-first ADR-006 (outbox, `rev`/CAS, `base_rev` → 409, `client_id` idempoten, tidak ada kehilangan diam-diam), Sampah catatan ADR-004 (snapshot + restore id sama), Petakan ADR-008 (peta tertaut = catatan satu-satunya sumber data; tidak ikut merge #4). Server satu proses uvicorn (`uvicorn.run(...)` tanpa `workers`) → bus SSE dalam proses cukup (sama dengan chat/DM).

Dua PR:
- **PR A** `claude/mindmap-findings-a`: #5 Sampah, #6 ekspor, #7 pencarian, #8 pin pribadi/penanda/filter, #3 kartu link hidup.
- **PR B** `claude/mindmap-findings-b` (setelah PR A di-merge): #4 pembaruan langsung + merge per node.

---

## #3 Kartu link node menampilkan data hidup

### Perilaku
- Setiap kali kartu link ditampilkan (panel 🔗 Links kanvas, popover badge node, tooltip badge, popover link Outline), judul dan metadata diambil dari **data lokal** (router lokal → IndexedDB): task = judul, prioritas, deadline, status; catatan = judul + cuplikan 80 karakter; mindmap = judul.
- Id link boleh id server, cid, atau `client_id` (resolver router lokal sudah fallback ke `client_id` sejak PR #38).
- Item tidak tersedia lokal (belum ter-pull, tanpa akses, terhapus) → snapshot yang tersimpan di `node.links[i]` dipakai, tampil redup dengan tooltip **"Data terbaru tidak tersedia di perangkat ini"**.
- Task selesai/arsip → judul dicoret.
- **Snapshot di `data_json` TIDAK ditulis ulang** saat data hidup berbeda: menulis ulang akan memicu simpan/konflik pada peta bersama hanya karena melihat. Snapshot tetap berguna sebagai cadangan offline/akses hilang.
- Peta tertaut (Petakan) tidak punya link node → tidak berlaku.

### Desain
- Modul baru `static/offline/mindmaplinks.js` (UMD `TF.mindmaplinks`, dipakai induk dan iframe):
  - `linkKey(link) → "task:<id>"`.
  - `collectLinkRefs(nodeData) → [{type,id}]` (DFS, unik per key).
  - `resolveLinkInfo(refs, get) → Promise<{[key]: Info|null}>`; `get` = `api.get` induk (lokal-first). Task `GET /api/tasks/:id`, catatan `GET /api/scratchpad/:id`, mindmap `GET /api/mindmaps/:id`; gagal/404 → `null`. `Info = {type, title, priority?, deadline?, status?, done?, preview?}`.
  - `linkDisplay(link, info) → {title, meta, live, done}`; label status: inbox "Inbox", next "Next", waiting "Waiting", someday "Someday", done "Selesai", archived "Arsip" (nilai lain apa adanya). Meta task = `[priority, "Due YYYY-MM-DD", status]` digabung " · " (kosong → "—"); catatan = cuplikan; mindmap = "".
- Induk (`MindmapTabInstance`, peta biasa) menghitung peta info (jeda 300 ms) saat: tab dimuat, `refs` berubah (link ditambah/dihapus), event `taskSaved`, `taskUpdated`, `noteSaved`, `mindmapSaved`, `mindmapSynced`, dan iframe mengirim `ready`. Hasil → state `linkInfo` (untuk Outline) + `postMessage({type:"linkInfo", info})` ke iframe.
- Iframe menyimpan `liveLinkInfo`; `renderPanel`, `showNodeLinksPopover`, `updateBadges` (tooltip) memakai `linkDisplay`. Pesan `linkInfo` me-render ulang panel/popover yang terbuka.
- Outline: prop baru `linkInfo` → popover link memakai `linkDisplay`.

### Offline / error
Murni lokal; tidak ada request jaringan. Error resolver per item → snapshot. Iframe `?v` naik; modul masuk precache SW.

### Tes
Unit `mindmaplinks.js` (resolve dengan `get` palsu: id server/cid/client_id, gagal → null, display live vs snapshot, status selesai). Tes teks sumber: iframe menangani `linkInfo` dan memanggil `linkDisplay`; tab mengirim `linkInfo` dan mendengar event.

---

## #4 Kolaborasi langsung + merge per node (PR B)

### Perilaku
- Peta biasa yang dibagikan ke workspace dan sedang terbuka di tab: ketika anggota lain menyimpan, tab ini menampilkan perubahan dalam ±3–5 detik (autosave 1 s + push 1,5 s + SSE + pull satu peta) tanpa reload dan tanpa memindah viewport.
- Edit bersamaan di **node berbeda** digabung otomatis; tidak ada salinan konflik.
- Edit bersamaan pada **field yang sama di node yang sama** (mis. dua orang mengganti teks node yang sama) → peta hasil gabungan memakai versi server untuk field itu, dan versi lokal lengkap disimpan sebagai salinan pribadi "(konflik) <judul>" (mekanisme ADR-006) + notice yang menyebut node bentrok.
- Peta tertaut (Petakan) dikecualikan: tidak berlangganan SSE, tidak di-merge (aturan ADR-008 tetap).
- Sinkron penuh 30 detik tetap ada sebagai cadangan.

### Keputusan aturan konflik node yang sama (dan alasannya)
Dipilih **"server menang di peta bersama + salinan konflik versi lokal"**, bukan "node duplikat di dalam peta": (a) peta bersama tetap bersih — tidak ada node "(konflik)" yang menyebar ke semua anggota; (b) tidak ada nilai yang hilang — versi lokal utuh ada di salinan pribadi; (c) memakai ulang UI conflict bar/notice yang sudah dikenal; (d) dengan pembaruan langsung, bentrok field yang sama hanya terjadi bila dua orang mengubah node yang sama dalam beberapa detik atau offline, jadi jarang. Bentrok yang bukan isi (posisi/urutan, lipatan, arah/justify/tema, panah, ringkasan, judul peta) diselesaikan otomatis (server menang) tanpa salinan karena tidak ada isi yang hilang.

### Server: sinyal perubahan (SSE)
- `mindmap_subscribers: dict[int, set[tuple[int, asyncio.Queue]]]` (pola `dm_subscribers`).
- `GET /api/mindmaps/{mid}/stream` (`get_current_user_sse`, token query untuk APK/Tauri seperti chat): 404 bila tidak bisa diakses; ping `{"type":"ping"}` tiap 20 s.
- `_mindmap_broadcast(mid, event)` dipanggil **setelah commit**:
  - `PUT /api/mindmaps/{mid}` (hanya peta biasa) dan `PATCH /share` → `{"type":"mindmap_changed","id","updated_at","editor_id","editor_name"}`.
  - `DELETE /api/mindmaps/{mid}` (ke Sampah) → `{"type":"mindmap_deleted","id"}`.
  - Sebelum mengirim `mindmap_changed`, akses tiap pelanggan dicek ulang; yang kehilangan akses menerima `{"type":"mindmap_access_lost","id"}` dan stream-nya ditutup.
- Event hanya sinyal (tanpa isi); klien mengambil isi lewat `GET /api/mindmaps/{id}` dengan header `X-TF-Sync`.
- Server tetap otoritatif: `base_rev` + 409 `REV_MISMATCH` tidak berubah. **Merge dilakukan di klien saat 409/pull** (modul murni, mudah dites; server tidak perlu tahu basis).

### Klien: basis merge
- Record mindmap menyimpan **`base_data_json` + `base_title`** = isi server pada `base_rev` (diisi oleh `recordFromServer` untuk baris lengkap, respons PUT/POST sukses saat `base_rev` maju ke `updated_at` respons, dan dari isi record sendiri saat edit pertama pada record bersih yang belum punya basis — record bersih = isi server).
- Record tanpa basis (data lama) → perilaku lama (salinan konflik seluruh peta).

### Algoritma `merge3(B, L, S)` — `static/offline/mindmapmerge.js`
Input: objek data mind-elixir hasil `JSON.parse` (basis, lokal, server). Keluaran `{doc, conflicts:[{nodeId, field, topic}], changed}` atau `{fallback:true}` bila salah satu tidak punya `nodeData` objek, ada id node ganda dalam satu dokumen, atau root id berbeda. Semua perbandingan nilai memakai `eq` = JSON stabil (urutan key diabaikan).

1. **Indeks** tiap dokumen: `id → {fields, parent, childIds}`; `fields` = semua key node kecuali `children`. Root = `nodeData.id`.
2. **Bertahan/hapus** untuk setiap id di gabungan B∪L∪S:
   - ada di L dan S → tetap.
   - tidak ada di B (baru) → tetap (bila baru di kedua sisi dengan id sama: diperlakukan sebagai node dengan basis `{}`).
   - ada di B, hilang di S, ada di L (dihapus di server): tetap **hanya bila "disentuh" di L** — field berubah, induk berubah, atau ada keturunan di L yang baru/disentuh. Node yang tetap karena disentuh membawa **seluruh subtree-nya di L** (keturunan yang hanya ikut terhapus bersama induknya di S dihidupkan kembali, field dari L). Selain itu terhapus.
   - simetris untuk dihapus di L dan ada di S (disentuh di S → tetap beserta subtree-nya di S).
   - hilang di L dan S → terhapus. Root tidak pernah terhapus.
   - Prinsip: **edit menang atas hapus** (tidak ada isi yang hilang). Menghapus subtree tetap menghapus node yang tidak disentuh sisi lain.
3. **Induk**: pL/pS/pB. Sama → itu; `pL == pB` → pS; `pS == pB` → pL; berbeda semua → pS (pindah vs pindah: server menang, tidak dicatat sebagai konflik). Hanya ada di satu sisi → induk sisi itu. Induk hasil yang terhapus → dihidupkan kembali (rantai ke atas, field dari sisi yang masih memilikinya, prioritas S lalu L lalu B). Bila menghasilkan siklus → pakai pS, lalu pB, lalu root.
4. **Field** tiap node yang tetap (key gabungan, kecuali `children`):
   - node hanya ada di satu sisi selain B (dihidupkan dari L atau S) → field sisi itu apa adanya.
   - `links`: gabung himpunan dengan key `type:id`: hasil = link S + link yang ditambah L (ada di L, tidak di B), dikurangi link yang dihapus L (ada di B, tidak di L); bila link sama ada di kedua sisi, objek S dipakai. Tidak pernah konflik.
   - `expanded`: 3-way; beda di kedua sisi → S; tidak dicatat konflik.
   - key lain (`topic`, `style`, `align`, `tags`, `icons`, `hyperLink`, `image`, …): `eq(vL,vS)` → vL; `eq(vL,vB)` → vS; `eq(vS,vB)` → vL; selain itu → vS **+ catat konflik** `{nodeId, field, topic: teks polos topic lokal}`. Nilai `undefined` = key tidak ada.
5. **Urutan anak** per induk P: `kids` = node tetap ber-induk-hasil P. Urutan relatif node yang ada di S dan B: bila sama (S tidak mengubah urutan) → urutan dasar = urutan di L; selain itu urutan dasar = urutan di S. Urutan dasar disaring ke `kids`; node `kids` lain disisipkan setelah saudara sebelumnya pada sisi asal penempatannya (sisi yang menentukan induknya; urutan sisi itu diproses berurutan), lalu melompati node berikutnya yang tidak ada di daftar anak P pada sisi asal. Node yang paling awal di antara saudaranya pada sisi asal (tidak punya saudara sebelumnya) → ditaruh di depan (diperlukan agar `merge3(B,B,S)` = S); node yang semua saudara sebelumnya terhapus → ditaruh di akhir.
6. **`arrows`** (array objek ber-`id`) dan **`summaries`** (ber-`id`): gabung per id dengan 3-way objek utuh (tambah di salah satu sisi → ada; hapus di satu sisi dan tidak berubah di sisi lain → hilang; hapus vs ubah → yang diubah tetap; ubah vs ubah → S). Urutan: urutan S lalu tambahan L. Panah yang `from`/`to`-nya tidak ada di hasil → dibuang. Ringkasan: `parent` harus ada; `end` dipotong ke `jumlahAnak-1`; dibuang bila `start > end` atau `start ≥ jumlahAnak`. Tidak pernah konflik.
7. **Key tingkat atas lain** (`direction`, `justify`, `theme`, `compact`, `meta`, key tak dikenal): 3-way skalar; beda di kedua sisi → S, tanpa konflik.
8. **Judul peta** (field record, bukan `data_json`): `merge3Scalar(bTitle, lTitle, sTitle)`; beda di kedua sisi → S, tanpa salinan (judul lokal disebut di notice bila ada salinan).
9. Hasil dibangun ulang dari root; setiap node mendapat array `children` (boleh kosong). `changed = !eq(doc, S)`.
Sifat yang dites: `merge3(B,L,L)` = L tanpa konflik (gema PUT sendiri); `merge3(B,B,S)` = S; `merge3(B,L,B)` = L; deterministik; edit vs hapus mempertahankan isi.

### Integrasi offline
- `mindmaprepo.mergeServerIntoLocal(cid, serverRow, {expectRev, now})` — satu transaksi `mindmaps` + `_outbox`:
  - record bersih/tidak ada edit → adopsi server (seperti pull).
  - tertaut, tanpa basis, JSON rusak, atau `merge3` fallback → `adoptServerWithConflictCopy` (perilaku lama).
  - selain itu: `data_json = merge.doc`, `title = merge3Scalar`, `base_rev/base_data_json/base_title = server`, `dirty = merge.changed || judul berbeda ? 1 : 0`, `rev+1`; op `create/update` lama dibuang; bila `dirty` → satu op `update` baru. `conflicts.length > 0` → salinan konflik versi lokal utuh + `notice {kind:"merge_conflict", title, copyTitle, editor, nodes:[topic…≤3], count}`.
- Push 409 `REV_MISMATCH` (peta biasa) → `mergeServerIntoLocal` (ganti `adoptServerWithConflictCopy`); bila op update baru diantre → `result.requeued++` dan `index.html` menjadwalkan push lagi.
- Pull: record dirty + op tertunda + server berubah → `mergeServerIntoLocal`.
- Router lokal `PUT /api/mindmaps/:id` dari tab: body baru `base_data_json` (isi yang menjadi dasar tab). `if_updated_at` basi → `merge3(base tab, isi tab, record sekarang)` → record = hasil (dirty, op update); konflik → salinan konflik versi tab. Respons membawa `merged:true`, `merge_conflicts`, `conflict_copy?`. Tanpa `base_data_json` (klien lama) → salinan konflik seperti sekarang.
- `syncpull.pullMindmapOne(rawFetch, sid)` → GET satu peta, lalu `pullMindmaps([row], …, {partial:true})` (tanpa pass hapus/duplikat untuk record lain); 404/403 → hapus lokal hanya bila record tidak dirty.

### UI
- `MindmapTabInstance` (peta biasa, `list_id != null`, id numerik, online): `EventSource` ke `/stream`. `mindmap_changed` dengan `updated_at ≠ base_rev` record → `window.__mindmapLive(sid)` (pull satu peta dalam `runSyncExclusive`, event `mindmapSynced {source:"live"}`, lalu `__pushNow()` bila record dirty). `onopen` setelah sambung ulang → `__mindmapLive` (event yang terlewat). `mindmap_deleted` / `mindmap_access_lost` → `__mindmapLive`; bila GET lokal tidak menemukan peta → tab ditutup + toast.
- Tab menyimpan `baseDocRef` (string `data_json` yang menjadi dasar kanvas/outline). Pembaruan jarak jauh diterapkan lewat pesan iframe baru `remoteUpdate {data, title, seq}`: iframe menolak (`remoteSkipped`) bila kotak edit node (`#input-box`) sedang aktif; selain itu `refresh` tanpa memindah viewport, keluar Focus Mode, pilih ulang node terpilih bila masih ada, balas `remoteApplied`. Diterapkan → `setOutlineTree` + `baseDocRef`; dilewati → `remoteStaleRef = true`, setelah autosave berikutnya tab membaca record dan menerapkannya.
- Autosave mengirim `base_data_json: baseDocRef.current`; respons `merged` tanpa edit baru → diterapkan lewat `remoteUpdate`.
- Penanda "🟢 Langsung" (title "Perubahan anggota lain tampil otomatis") di header tab saat stream terbuka.

### Teks UI (PR B)
- Toast konflik merge: `✂ Sebagian perubahanmu bentrok dengan {editor} — versimu disimpan sebagai '{copyTitle}'`
- Notice `merge_conflict`: `✂ «{title}»: {count} node diubah bersamaan oleh {editor} ({nodes}) — versimu disimpan sebagai '{copyTitle}'`
- `Peta ini dihapus oleh pemiliknya` · `Akses ke peta ini dicabut` · `🟢 Langsung`

### Error / tepi
- SW tidak boleh meng-cache stream: aturan network-only untuk `^/api/mindmaps/[^/]+/stream$`.
- Offline/stream putus → tidak ada efek; sinkron 30 s + `onopen` menutup celah.
- 409 berulang (dua klien merge bersamaan) → setiap 409 merge lagi terhadap server terbaru; konvergen.
- Edit Outline yang sedang diketik saat pembaruan masuk: node yang hilang membatalkan edit itu (diterima; Outline jarang dipakai bersamaan).
- Peta dengan `base_data_json` hingga 5 MB → ukuran record ±2× (diterima).

### Tes
Unit `mindmapmerge.js` (tabel skenario); repo/push/pull dengan `fake-indexeddb` (409 → merge tanpa salinan, konflik node sama → salinan + notice, basis maju setelah PUT sukses, `pullMindmapOne` parsial tidak menghapus record lain, router `base_data_json`); pytest broadcast (monkeypatch perekam + fungsi broadcast dengan antrean nyata, akses dicabut, stream 404 untuk non-anggota); tes teks sumber UI.

---

## #5 Sampah mindmap

### Perilaku
- "Hapus" peta (hanya pemilik; untuk peta tertaut = pemilik catatan) memindahkan peta ke Sampah. Dipulihkan dengan **id yang sama** (dan `client_id` yang sama → link node `type:'mindmap'` hidup lagi). Dihapus permanen setelah 30 hari, lewat "Hapus permanen", atau "Kosongkan Sampah".
- Sampah tampil di modal Sampah yang sudah ada (tab baru **"Mindmap"** di samping **"Catatan"**); dibuka dari halaman Notes (tab Catatan) dan dari tombol **"🗑 Sampah"** di sidebar Mindmap (tab Mindmap).
- Peta tertaut ikut Sampah yang sama. Memulihkan peta tertaut butuh catatannya masih ada; bila catatan sudah punya peta tertaut lain, item Sampah dibuang dan peta yang ada dikembalikan (isi peta tertaut hanya view-state). Catatan dihapus permanen → peta tertautnya (aktif maupun di Sampah) ikut dihapus permanen.
- Anggota workspace tidak bisa menghapus peta milik orang lain (tombol Hapus disembunyikan; server 403).

### Data model (server) — keputusan: tabel snapshot (pola ADR-004), bukan kolom `deleted_at`
Alasan: semua query `mindmaps` (daftar, get, put, pin, share, search, ekspor, `_sync_linked_mindmap`, index unik `source_note_id`) tetap benar tanpa filter tambahan; index unik `ux_mindmaps_source_note` tidak terhalang peta tertaut di Sampah.

```sql
CREATE TABLE IF NOT EXISTS trashed_mindmaps (
  mindmap_id     INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT NOT NULL DEFAULT '',
  list_id        INTEGER,
  source_note_id INTEGER,
  client_id      TEXT,
  snapshot_json  TEXT NOT NULL,      -- {"mindmap": <SELECT * row>, "pins": [user_id…]}
  deleted_at     TEXT NOT NULL,
  deleted_by     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_trashed_mm_user ON trashed_mindmaps(user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_trashed_mm_note ON trashed_mindmaps(source_note_id) WHERE source_note_id IS NOT NULL;
```
`MINDMAP_TRASH_RETENTION_DAYS = 30`; tabel juga dibuat malas (`_ensure_trashed_mindmaps_table`), purge malas saat daftar/restore.

### API
| Method | Path | Perilaku |
|---|---|---|
| DELETE | `/api/mindmaps/{mid}` | Ada & pemilik → snapshot + hapus pin + hapus baris, `{"ok":true,"trashed":true}`. Tidak ada tetapi ada di Sampah milik user → `{"ok":true,"trashed":true}` (idempoten untuk perangkat kedua). Tidak ada sama sekali → 404. Bukan pemilik → 403 (pesan lama). |
| GET | `/api/mindmaps/trash` | `[{id, title, preview, list_id, source_note_id, linked, client_id, deleted_at, days_left}]` milik user, terbaru dulu. `preview` = ≤ 3 topic pertama setelah root, polos, " · ". |
| POST | `/api/mindmaps/trash/{mid}/restore` | 404 "Mindmap tidak ada di Sampah"; 409 "Mindmap dengan id ini sudah ada"; tertaut tanpa catatan → 409 `{"detail":{"code":"SOURCE_NOTE_MISSING"}}`; tertaut dan catatan sudah punya peta lain → item dibuang, 200 dengan peta yang ada. Selain itu insert dengan id asli; `list_id` dinolkan bila list hilang/user bukan anggota; `client_id` dinolkan bila bentrok `(user_id, client_id)`; `last_edited_by` hilang → NULL; `search_text` dihitung ulang; pin dipulihkan untuk user yang masih ada; tertaut → `_sync_linked_mindmap`. `updated_at` asli dipertahankan. Respons = baris lengkap (enrich + `is_pinned` per user). |
| DELETE | `/api/mindmaps/trash/{mid}` | Hapus permanen satu (milik user), `{"ok":true}` (idempoten). |
| DELETE | `/api/mindmaps/trash` | Kosongkan, `{"ok":true,"deleted":n}`. |
Rute statis `/api/mindmaps/trash…` dideklarasikan **di atas** rute `{mid}` (int) agar tidak 422.

### Offline / IndexedDB
- Hapus lokal: record `deleted:true, dirty:1, trashed_at:<now>` + op `delete` (seperti sekarang + `trashed_at`). Push sukses/404 → record lokal dihapus (seperti sekarang).
- **Cermin Sampah** di `_meta` key `"mindmapTrash:v1"` = `{items:[baris GET /trash], restoring:[sid…], errors:{sid:code}}`, diperbarui `syncpull.pullMindmapTrash(rawFetch)` di akhir `pullMindmapsAndReconcile` (gagal → cermin lama dipertahankan).
- Rute lokal (modul baru `static/offline/mindmaptrash.js`):
  - `GET /api/mindmaps/trash` = item cermin (tanpa yang sedang `restoring`) + record lokal `deleted && trashed_at` yang op delete-nya belum terkirim (`pending:true`), terbaru dulu, unik per id server.
  - `POST /api/mindmaps/trash/:id/restore`: record lokal tertunda → `mindmaprepo.restoreLocal(cid)` (buang op delete, `deleted:false`, op update diantre ulang bila dirty) → `{restored:"local"}`; item cermin → sid masuk `restoring` + op outbox `{op:"restore", entity_type:"mindmap", cid:"trash:<sid>", payload:{server_id}}` → `{restored:"queued"}`; selain itu 404.
  - Hapus permanen & kosongkan **hanya online** (destruktif, sama dengan catatan): `shouldRouteLocally` mengecualikan `DELETE /api/mindmaps/trash…`; SW network-only untuk `/api/mindmaps/trash…`.
- Push `opMindmapRestore`: POST restore → ok: record dari `recordFromServer` dengan cid = `client_id` (atau cid baru), idmap, keluar dari cermin, `mindmapSynced`; 404 → keluar dari cermin; 409 `SOURCE_NOTE_MISSING` → `errors[sid]="source_note_missing"`; 4xx lain → `errors[sid]="failed"`; jaringan/5xx/401 → op tetap.
- Pull: peta yang dipulihkan muncul lagi di daftar → dibuat lokal dengan cid = `client_id` (perilaku pull sekarang).

### UI & teks
- Tab: "Hapus" → konfirmasi "Pindahkan ke Sampah?" (Ya/Batal) → toast "🗑 Dipindahkan ke Sampah". Tombol Hapus disembunyikan untuk non-pemilik peta biasa.
- Modal Sampah: tab "Catatan" | "Mindmap"; subjudul Mindmap "Peta terhapus disimpan 30 hari, lalu dihapus permanen."; item menampilkan 📄 untuk peta tertaut, 👥 nama workspace bila ada, "menunggu sinkron" untuk item `pending`.
- Konstanta `TF.mindmaptrash`: `CONFIRM_MOVE = "Pindahkan peta ini ke Sampah? Bisa dipulihkan dalam 30 hari."`, `TOAST_MOVED = "🗑 Dipindahkan ke Sampah"`, `TOAST_RESTORED = "♻️ Peta dipulihkan"`, `TOAST_RESTORE_QUEUED = "♻️ Peta dipulihkan — disinkronkan saat online"`, `CONFIRM_PURGE = "Hapus peta ini secara permanen? Tindakan ini tidak bisa dibatalkan."`, `CONFIRM_EMPTY = "Kosongkan Sampah mindmap? Semua peta di Sampah akan dihapus permanen."`, `SOURCE_MISSING_MSG = "Catatan sumbernya sudah tidak ada — pulihkan catatannya dulu"`, `PURGE_OFFLINE_MSG = "Perlu koneksi internet untuk menghapus permanen"`, `PENDING_LABEL = "menunggu sinkron"`.

### Tes
pytest: hapus → di Sampah & hilang dari daftar; restore id/`client_id`/pin sama; anggota 403; hapus kedua idempoten; 404 bila tidak ada; purge > 30 hari; kosongkan; tertaut tanpa catatan 409; tertaut dengan peta lain → peta yang ada; purge catatan menghapus peta tertaut di Sampah; `list_id` hilang → NULL. Node: route lokal (daftar gabungan, restore lokal vs antre), push restore (ok/404/409), pull cermin.

---

## #6 Mindmap di `/api/export/download`

- ZIP mendapat folder `mindmaps/` berisi peta **milik pengekspor** (`user_id = uid`, sama dengan catatan/task); peta bersama milik orang lain dan Sampah tidak ikut.
- Peta biasa → `mindmaps/<judul>.json`: `{"title","created_at","updated_at","workspace_id","data":<objek data_json>}` (JSON rusak → `"data_json":"<teks mentah>"`) dan `mindmaps/<judul>.md`: `# <topic root polos>` lalu daftar bertingkat `- topic` (2 spasi per tingkat) agar terbaca tanpa aplikasi.
- Peta tertaut → hanya `mindmaps/<judul>.json`: `{"title","created_at","updated_at","linked":true,"source_note_id","source_note_title","view_state":<objek>}` (isi sudah ada di `notes/`).
- Nama file: sanitasi sama dengan catatan; judul ganda → ` (1)`, ` (2)` (penghitung terpisah dari catatan).
- Tes: ZIP memuat json+md peta biasa, json tertaut tanpa md, tidak memuat peta orang lain / Sampah, judul ganda.

---

## #7 Pencarian global mindmap

- Kolom turunan **`mindmaps.search_text TEXT`** = teks polos semua topic node (satu baris per node, pre-order, root dulu), diisi saat POST/PUT/restore; peta tertaut `''`; backfill idempoten di `migrate_db()` untuk `search_text IS NULL` (per 200 baris). Dipilih dibanding fungsi JSON SQLite: `json_tree` pada `data_json` ≤ 5 MB untuk setiap query pencarian berarti memparse semua peta yang bisa diakses; kolom turunan juga memudahkan cuplikan.
- Teks polos topic (`_mindmap_plain`): buang tag HTML, `![alt](u)` → alt, `[t](u)` → t, penanda `**`, `__`, `~~`, `==`, backtick, `#` di awal, rapatkan spasi.
- `/api/search`: mindmap cocok bila `title LIKE` atau `search_text LIKE` (bukan `data_json`). Baris hasil `{id, title, updated_at, client_id, snippet}`; `snippet` = baris node pertama yang memuat kata kunci (tanpa beda huruf besar/kecil), jendela ≤ 80 karakter di sekitar kecocokan dengan "…" di sisi terpotong; `""` bila hanya judul yang cocok.
- Task dan catatan di `/api/search` juga membawa `client_id` (sisa temuan #1).
- `LinkPickerModal`: `existingSet` mencocokkan `type-id` **atau** `type-client_id` lewat helper murni `mindmapoutline.filterExistingTargets(results, existingLinks)`; `localLinkSearch` meneruskan `client_id`; meta router lokal mindmap menyertakan `client_id`.
- Halaman pencarian global menampilkan `snippet` di bawah judul mindmap (gaya sama dengan cuplikan catatan).
- Tes: kata "topic"/"children" tidak cocok; teks node cocok dengan snippet; peta orang lain tidak muncul; backfill; `client_id` ada di tiga jenis hasil; `filterExistingTargets`.

---

## #8 Kecil

### (a) Pin pribadi per user
- Tabel `mindmap_pins (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, mindmap_id INTEGER NOT NULL, created_at TEXT, PRIMARY KEY(user_id, mindmap_id))` + index `idx_mindmap_pins_mm(mindmap_id)`.
- Migrasi **sekali**: bila tabel belum ada sebelum `CREATE`, salin `is_pinned = 1` → pin milik `user_id` pemilik. Kolom `is_pinned` dibiarkan (aman untuk rollback) tetapi tidak dibaca/ditulis lagi.
- Semua respons mindmap: `is_pinned` = pin milik user yang meminta (0/1). Daftar diurutkan pin user lalu `updated_at`.
- `PATCH /api/mindmaps/{mid}/pin`: siapa pun yang punya akses (pemilik/anggota); body opsional `{"pinned": bool}` → set eksplisit (idempoten); tanpa body → toggle (klien lama). Tidak mengubah `updated_at`. Tanpa akses → 404.
- Pin ikut snapshot Sampah dan dihapus saat purge / `_delete_linked_mindmaps`.
- Offline: `pinned` lokal sudah per perangkat-user; push op pin mengirim body `{pinned}` (cek GET dipertahankan); pull mengadopsi `is_pinned` per user (tidak berubah).

### (b) Penanda peta bersama di sidebar
`MindmapListItem` menampilkan 👥 (title `Dibagikan ke {nama workspace}`; nama dari `sharedLists`, fallback "workspace") bila `list_id != null`, termasuk peta tertaut dari catatan bersama. Tanpa `border-left`.

### (c) `filterListId` → filter workspace kecil
Ditambahkan (sepele): `<select>` di bawah kotak cari, hanya bila `sharedLists.length > 0`: "Semua peta" · "Pribadi" · "👥 {nama}" per workspace. Nilai `null | "personal" | <list_id>`, disimpan di `localStorage.tf_mindmap_filter` (try/catch), di-reset bila workspace tidak ada lagi. Logika filter + cari judul di helper murni `mindmaptabs.filterSidebar(list, {q, filter})`.

### Tes
pytest pin (anggota bisa pin, tidak memengaruhi pemilik, eksplisit idempoten, toggle lama, migrasi sekali, `updated_at` tetap, non-anggota 404). Node: `filterSidebar`, push pin membawa body. Teks sumber: badge 👥 + select filter.

---

## Strategi tes & verifikasi umum
- `npm test` (gagal pra-ada yang diketahui: `tests/offline/draw_local_reactive.test.js`), `python -m pytest tests/ -q`, `node temporary_files/check_inline_scripts.js static/index.html` dan `… static/vendor/mind-elixir/index.html`, `git diff main -U0 | grep -iE "border-?left"` kosong.
- E2E Playwright di task rilis (server lokal, dua user/dua context browser): Sampah (hapus/pulihkan/offline), pin anggota, filter, pencarian + snippet, kartu link hidup setelah task diubah; PR B: dua context mengedit node berbeda → keduanya melihat gabungan ≤ 5 s tanpa salinan; node sama → salinan + notice.
- Deploy kedua PR butuh `sudo systemctl restart taskflow-web` (migrasi + endpoint baru).
