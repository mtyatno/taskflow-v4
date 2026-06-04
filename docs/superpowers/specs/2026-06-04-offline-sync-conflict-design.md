# Offline Sync — Conflict Resolution (#2c) Design

**Status:** Disetujui 2026-06-04
**Parent:** Inisiatif offline native (Model B), sub-proyek #2 (sync engine). #2a Push & #2b Pull SELESAI & deployed. Ini slice ketiga. Lihat [[project_offline_native]].
**Predecessor state:** `static/offline/` 16 modul (146 test). `sync()` = push→pull. Pull (`syncpull.js`) full-list reconcile yang **skip record `dirty`**. `base_rev` = server `updated_at` saat sync terakhir (push set, pull set). Record punya `dirty`, `server_id`, `updated_at` (lokal, di-set tiap edit).

## Tujuan

Menangani konflik saat sebuah record berubah di **kedua sisi** sejak sync terakhir, menggantikan perilaku implisit "local-wins membabi-buta". Dua kelas konflik:
1. **edit-vs-edit** (lokal `dirty` + server juga berubah) → **Last-write-wins by `updated_at`**, otomatis.
2. **edit-vs-delete** (lokal `dirty` + record dihapus di server) → **prompt user**: buang perubahan, atau simpan sebagai task baru. Tidak ada kehilangan data tak sengaja.

Client-only (tanpa backend). Node-tested untuk logika; browser-verified untuk UI.

## Keputusan terkunci (brainstorming 2026-06-04)

1. **Reorder sync → pull dulu, baru push.** Push→pull lama menimpa server sebelum konflik terdeteksi; pull-first menjadikan pull titik deteksi.
2. **edit-vs-edit = LWW by `updated_at`** (record-level, otomatis, silent + di-log). Caveat clock-skew client/server diterima (1 user + 1 VPS).
3. **edit-vs-delete = prompt user** (tahan op, banner UI: Buang / Simpan-sebagai-baru).
4. **Record-level**, bukan field-merge (kita hanya simpan `base_rev` timestamp, bukan snapshot isi base).

## Non-goals (eksplisit)

- ❌ Field-level 3-way merge (butuh shadow-copy base) — record-level saja.
- ❌ Prompt untuk edit-vs-edit (otomatis LWW).
- ❌ Konflik `recurring_exceptions` / kolaboratif → #2d.
- ❌ Perubahan backend.

## Arsitektur

| Unit | Status | Tanggung jawab | Uji |
|---|---|---|---|
| `static/offline/syncpull.js` | **UBAH** | deteksi konflik di reconcile: edit-vs-edit LWW; edit-vs-delete set flag | Node |
| `static/offline/syncpush.js` | **UBAH** | skip op record ber-flag konflik; update-404 → set flag (jaring pengaman) | Node |
| `static/offline/syncconflict.js` | **BARU** | `listConflicts()`, `resolveConflict(cid, choice)` | Node |
| `static/offline/idmap.js` | **UBAH** | tambah `mapDelete(type, serverId)` | Node |
| `static/index.html` | **UBAH** | reorder `sync()` → pull→push; banner UI konflik | Browser |
| `static/sw.js` | **UBAH** | bump cache + precache `syncconflict.js` | Browser |

### Flag konflik
Record konflik edit-vs-delete diberi field `conflict = 'remote_deleted'` (di store `tasks`). Record ini: tetap `dirty`, TIDAK dihapus, op outbox-nya DITAHAN (push skip), muncul di UI sampai user putuskan.

### `syncpull.js` — deteksi (di `pullTasks`)
Pass 2 (per server task `s`, `local = byCid[cid]`):
- `!local` → CREATE (seperti #2b).
- `local.conflict` → **skip** (sedang menunggu resolusi user; jangan utak-atik). `skipped++`.
- `local.dirty`:
  - `s.updated_at !== local.base_rev` → **konflik edit-vs-edit (LWW)**: bila `tsEpoch(s.updated_at) > tsEpoch(local.updated_at)` → **server menang**: `putTask(taskFromServer(s))` (dirty=0, base_rev=s.updated_at) + **buang semua op outbox** cid itu (`outboxByEntity('task',cid)`→`outboxRemove`); `lwwResolved++`. Else **lokal menang**: biarkan (tetap dirty → push kirim); `lwwResolved++`.

> **Komparabilitas timestamp (penting):** lokal `updated_at` = `new Date().toISOString()` (UTC, akhiran `Z`); server `updated_at` = `datetime.now().isoformat()` (waktu lokal VPS, **tanpa** timezone). Perbandingan string mentah salah bila VPS ≠ UTC. Helper `tsEpoch(ts)` menormalkan: bila `ts` tak punya tz (`Z`/offset), perlakukan sebagai UTC (`Date.parse(ts + 'Z')`), else `Date.parse(ts)`. **Asumsi: jam VPS = UTC** (umum untuk server). Bila VPS ber-tz lain, LWW bias ke salah satu sisi secara sistematis — tetap deterministik, tapi bukan "benar-benar terbaru". Verifikasi browser akan mengonfirmasi sisi mana yang menang; bila keliru, perbaikan = backend kirim UTC (di luar scope client-only ini).
  - else (`s.updated_at === base_rev`) → bukan konflik (server tak berubah), skip; push kirim.
- clean & `s.updated_at !== base_rev` → UPDATE (seperti #2b). else unchanged.

Pass 3 (delete — record lokal `server_id != null` yang `server_id`-nya hilang dari list):
- `r.conflict` → skip (sudah ditandai).
- `r.dirty` → **konflik edit-vs-delete**: set `r.conflict='remote_deleted'` (`putTask`), JANGAN hapus; `conflicts++`.
- else (clean) → hapus lokal (seperti #2b); `deleted++`.

Hasil `pullTasks` jadi `{created, updated, deleted, skipped, lwwResolved, conflicts}`.

### `syncpush.js` — tahan record konflik
- Di tiap op task, setelah `getTaskRaw`: bila `rec.conflict` → **skip** (jangan proses, jangan hapus op, jangan hitung pushed/failed; lanjut op berikut). Op ditahan sampai resolusi.
- `opUpdate` saat respons **404**: alih-alih drop diam-diam, set `rec.conflict='remote_deleted'` (`putTaskRaw`) + biarkan op (jaring pengaman bila pull belum sempat mendeteksi). (`opDelete` 404 tetap = sukses; `opCreate` 4xx tetap drop.)

### `syncconflict.js` (API)
- `listConflicts() → [{cid, title, ...}]` — record dgn `conflict` ter-set (untuk UI).
- `resolveConflict(cid, choice) → Promise`:
  - `'discard'` → hapus record lokal (`tasks.delete`) + hapus semua op outbox cid + `idmap.mapDelete('task', rec.server_id)`.
  - `'keep_as_new'` → `idmap.mapDelete('task', rec.server_id)`; set `rec.server_id=null`, hapus `rec.conflict`, `dirty=1` (`putTask`); **ubah op outbox** cid: hapus op lama + tambah `{op:'create', entity_type:'task', cid, payload:{}}` (push akan POST task baru). 

### `idmap.js` — tambah
`mapDelete(type, serverId)` → hapus key `\`${type}:${serverId}\`` dari `_idmap`.

### `index.html` (browser-verified)
- **Reorder `sync()`**: dari `pushOutbox().then(pull)` → **`pullAndReconcile().then(pushOutbox)`** (pull dulu, lalu push). Setelah sync, panggil `renderConflicts()`.
- **Banner konflik (plain-DOM, bukan komponen React)**: fungsi `renderConflicts()` query `TF.syncconflict.listConflicts()`; bila ada, render/perbarui div fixed (mis. bawah layar) berisi per-konflik: "🔔 '<judul>' dihapus di perangkat lain — [Buang perubahan] [Simpan sebagai task baru]". Tombol → `resolveConflict(cid, choice)` → `sync()` → `renderConflicts()` + refresh daftar task (panggil `fetchAll`/event). Banner hilang saat tak ada konflik. Plain DOM dipilih agar terisolasi (index.html ter-precompile; hindari nambah komponen React).
- Trigger `renderConflicts()` setelah tiap `sync()` (boot/online/manual).

## Data flow

```
sync()  [boot / online / manual]   (REORDERED: pull → push)
  ├─ pullAndReconcile(rawFetch)
  │    reconcile + DETEKSI KONFLIK:
  │      edit-vs-edit (dirty & server berubah) → LWW (server menang: timpa+buang op; lokal menang: biarkan)
  │      edit-vs-delete (dirty & server hilang) → flag conflict='remote_deleted' (tahan)
  ├─ pushOutbox(transport)         // skip record ber-flag conflict
  └─ renderConflicts()             // banner utk edit-vs-delete → user pilih

resolveConflict(cid,'discard')    → hapus lokal + op + idmap
resolveConflict(cid,'keep_as_new')→ jadikan create baru (clear server_id+idmap, op→create) → sync() → push buat task baru
```

## Testing

- **Node** `syncpull.test.js` (extend): edit-vs-edit server-wins (timpa lokal + op outbox terbuang, `lwwResolved`); local-wins (lokal tetap, masih dirty); edit-vs-delete (dirty hilang dari server → `conflict='remote_deleted'`, tak terhapus, `conflicts=1`); record ber-conflict di-skip pada pull berikutnya.
- **Node** `syncpush.test.js` (extend): op record ber-`conflict` di-skip (op tetap, tak pushed); `opUpdate` 404 → set `conflict='remote_deleted'`.
- **Node** `syncconflict.test.js` (BARU): `listConflicts` mengembalikan record ber-flag; `resolveConflict 'discard'` (record+op+idmap hilang); `resolveConflict 'keep_as_new'` (server_id null, flag hilang, op jadi create, idmap lama hilang).
- **Node** `idmap.test.js` (extend): `mapDelete` menghapus mapping (`cidOf`/`serverIdOf` jadi undefined).
- **Browser**: (a) edit task lokal + edit task sama di server (raw) → `__syncNow` → LWW (yang terbaru menang). (b) edit task lokal (offline) + hapus task itu di server → `__syncNow` → banner muncul → "Buang" (task hilang) / "Simpan sebagai baru" (task jadi baru di server). App tetap load; habit/note utuh (verifikasi sekaligus cleanup dead-code yang ikut deploy).

## Done criteria

1. `syncpull` deteksi edit-vs-edit (LWW) & edit-vs-delete (flag); `syncpush` skip record konflik + 404→flag; `syncconflict` list/resolve; `idmap.mapDelete`. Node-tested.
2. `sync()` reorder pull→push; banner UI edit-vs-delete dgn Buang / Simpan-sebagai-baru.
3. Suite Node hijau (146 + tambahan); browser-verified (LWW + prompt + cleanup app load).

## Next (slice berikutnya)

- **#2d Kolaboratif** (shared lists/chat offline); pull `recurring_exceptions`; realtime/periodik.
- Sub-proyek #3 (Tauri shell → .exe/AppImage), #4 (Android).
