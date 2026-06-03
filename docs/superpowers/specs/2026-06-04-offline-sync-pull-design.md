# Offline Sync — Pull Engine (#2b) Design

**Status:** Disetujui 2026-06-04
**Parent:** Inisiatif offline native (Model B). Sub-proyek #1 SELESAI; #2a Push SELESAI & deployed (`c334dde`, SW v120). Ini slice kedua sub-proyek #2 (sync engine). Lihat [[project_offline_native]].
**Predecessor state:** `static/offline/` 15 modul (Node-tested, 138 test). `hydrate.js` sudah full-pull saat boot (`ensureTasks`). `syncpush.js` push outbox→server. Lokal = sumber kebenaran; record punya `server_id`, `dirty`, `base_rev`.

## Tujuan

Bangun **pull engine**: tarik perubahan sisi-server (dari bot Telegram / web / device lain) MASUK ke store lokal, dengan **client-only full-list reconcile** (tanpa perubahan backend). Mendeteksi remote create / update / **delete** (server hard-delete tanpa tombstone) dengan membandingkan daftar server penuh terhadap lokal. Node-tested untuk reconcile; browser-verified untuk wiring.

## Keputusan terkunci (brainstorming 2026-06-04)

1. **Client-only full-list reconcile.** Tiap sync: `GET /api/tasks?include_done=true` (semua task user) → rekonsiliasi vs lokal. Hard-delete terdeteksi: record lokal ber-`server_id` yang `server_id`-nya hilang dari respons = dihapus remote. Tanpa endpoint/tabel baru. Cukup utk skala kecil (ratusan task).
2. **Skip record `dirty`.** Pull HANYA menyentuh record lokal bersih (`dirty=0`). Record dirty (ada perubahan lokal belum ter-push) dibiarkan — akan di-push; resolusi konflik sejati ditunda ke #2c. Tak ada kehilangan edit lokal.
3. **Trigger = boot + online + manual.** Pola sync = **push dulu lalu pull** (konvergen). Boot menggantikan panggilan `ensureTasks` lama dengan sync.

## Non-goals (eksplisit — slice berikutnya)

- ❌ **Resolusi konflik sejati** (dirty lokal vs server berubah) → #2c. #2b cuma skip.
- ❌ **Pull `recurring_exceptions`** (occurrence di-mark device lain) → defer; catat limitasi.
- ❌ **Pull tag ke `entity_tags` lokal** — konsisten dgn hydration (#1e-b): task remote-created tak ber-tag lokal sampai diedit lokal (filter tag tak memuatnya). Catat.
- ❌ Perubahan backend (tombstone/endpoint delta); polling periodik; kolaboratif (#2d).
- ❌ Domain non-task (habits/notes/mindmaps) — belum offline.

## Kontrak server (dari `webapp.py`, tak diubah)

- `GET /api/tasks?include_done=true` → array `task_row_to_dict` (= `dict(row)` + extra). **Menyertakan semua kolom**: `id, title, …, recurrence_*, created_at, updated_at, parent_id`. `updated_at` = TEXT ISO (basis deteksi update).
- (Pull tak menulis ke server — itu tugas push.)

## Reuse & coupling

- `hydrate.taskFromServer(dict, getCid)` (sudah ada) memetakan dict server → record lokal (`server_id`, `parent_cid` via `getCid`, `dirty=0`, `base_rev=updated_at`). Dipakai pull untuk create & update.
- **Touch-up `syncpush.js`:** saat push create/update SUKSES, set `base_rev = response.updated_at` (selain `dirty=0`). Supaya cek `updated_at !== base_rev` di pull akurat (record yang baru di-push tak ditarik ulang). Tanpa ini pull tetap self-heal setelah satu overwrite redundan, tapi ini lebih bersih. (Mengubah `opCreate`/`opUpdate` di syncpush + extend test-nya.)

## Arsitektur

| Unit | Status | Tanggung jawab | Uji |
|---|---|---|---|
| `static/offline/syncpull.js` | **BARU** | `pullTasks(serverList)` reconcile + `pullAndReconcile(rawFetch)` | Node |
| `static/offline/syncpush.js` | **UBAH** | set `base_rev` pada push sukses | Node |
| `static/index.html` | **UBAH** | `sync()` = push→pull; trigger boot/online/manual | Browser |

### `syncpull.js` API
- `pullTasks(serverList) → {created, updated, deleted, skipped}` — reconcile array dict server vs store lokal. Dua-pass:
  - **Pass 1:** untuk tiap `s.id`, pastikan `cid` via `idmap.cidOf('task', s.id)`; bila tak ada, buat `newCid()` + `idmap.mapPut('task', s.id, cid)`. Kumpulkan map `serverId→cid` (untuk parent resolve).
  - **Pass 2 (per `s`):** `cid = map[s.id]`; `local = getRaw(cid)`.
    - `!local` → **CREATE**: `put(taskFromServer(s, getCid))`; `created++`.
    - `local.dirty` → **SKIP**; `skipped++`.
    - `s.updated_at !== local.base_rev` → **UPDATE**: `put(taskFromServer(s, getCid))` (cid sama); `updated++`.
    - else → skip (tak dihitung / unchanged).
  - **Pass 3 (delete):** untuk tiap record lokal `r` dgn `r.server_id != null` yang `r.server_id` **tak ada** di `serverList`:
    - `r.dirty` → SKIP; `skipped++`.
    - else → hapus record lokal dari store `tasks`; `deleted++`. (record `server_id==null` diabaikan total — pending create.)
  - `getCid(serverId)` = dari map pass-1 (fallback `idmap.cidOf` / null).
- `pullAndReconcile(rawFetch) → Promise<result>` — `rawFetch('/api/tasks?include_done=true')` (raw, token; BUKAN `api`) → `.json()` → `pullTasks`.

### Wiring `index.html` (browser-verified)
- `sync()` = `TF.syncpush.pushOutbox(__syncTransport)` **lalu** `TF.syncpull.pullAndReconcile(__syncRawFetch)`. `__syncRawFetch(u) = window.fetch(u, {headers:{Authorization:'Bearer '+__token}})` (sama spt hydration; raw, bypass intercept).
- Trigger:
  - **boot** di `fetchAll`: ganti blok `hydrate.ensureTasks(...)` dgn `await sync()` (push dulu lalu pull = first-sync = semua create bila lokal kosong). Tetap dibungkus try/catch.
  - **event `online`**: `window.addEventListener('online', …)` jadi panggil `sync()` (bukan cuma `schedulePush`).
  - **manual**: `window.__syncNow = () => sync()`.
- `schedulePush` (after-write, debounced) tetap apa adanya (push lokal cepat). `__pushNow` tetap.
- Guard serial di `pushOutbox` + (opsional) guard di pull mencegah tumpang-tindih.

## Data flow

```
sync()  [boot / online / manual]
  ├─ pushOutbox(transport)              // local → server (set base_rev on success)
  └─ pullAndReconcile(rawFetch)
       GET /api/tasks?include_done=true (raw)
       pullTasks(serverList):
         create: server task tak dikenal lokal  → taskFromServer → put (dirty=0)
         update: clean & updated_at≠base_rev     → overwrite (dirty=0)
         skip:   dirty                            → biarkan (push/#2c)
         delete: local server_id hilang dari list & clean → hapus lokal
  → {created, updated, deleted, skipped}
```

## Testing

- **Node** `tests/offline/syncpull.test.js` (`fake-indexeddb` + seed `tasks`/`_idmap` + array server):
  - remote CREATE (server id baru → record lokal, dirty=0, base_rev=updated_at);
  - remote UPDATE (clean lokal, `updated_at` server beda → tertimpa, cid sama);
  - unchanged (updated_at sama → tak berubah, tak dihitung);
  - SKIP dirty (lokal dirty + server beda → tak tertimpa);
  - remote DELETE (lokal clean ber-server_id hilang dari list → terhapus);
  - SKIP delete saat dirty (lokal dirty hilang dari server → dibiarkan);
  - abaikan local-only (`server_id=null` tak pernah di-"delete");
  - parent ter-resolve lintas-batch (child server → parent_cid benar);
  - counts `{created, updated, deleted, skipped}` benar.
- **Node** extend `tests/offline/syncpush.test.js`: create/update sukses set `base_rev = response.updated_at`.
- **Browser**: ubah task via jalur server (raw fetch / web lain / bot) → `__syncNow()` → muncul/terupdate di lokal & UI; hapus di server → hilang di lokal; edit lokal (dirty, belum push) → pull TIDAK menimpa.

## Done criteria

1. `syncpull.js` ekspor `pullTasks`, `pullAndReconcile`; Node-tested. `syncpush` set `base_rev` pada sukses.
2. Pull mendeteksi remote create/update/delete via full-list reconcile; skip record dirty; abaikan local-only.
3. Wiring: `sync()` = push→pull; boot (ganti ensureTasks) + online + `__syncNow` manual; raw fetch (bukan `api`).
4. Suite Node hijau (138 + syncpull + syncpush base_rev); browser-verified end-to-end.

## Next (slice berikutnya)

- **#2c Konflik** — dirty lokal vs server berubah: kebijakan resolusi (mis. field-merge, last-write-wins by `updated_at`, atau prompt). `base_rev` jadi titik referensi 3-way.
- **#2d Kolaboratif** — shared lists/chat offline.
- Pull `recurring_exceptions`; realtime/periodik.
