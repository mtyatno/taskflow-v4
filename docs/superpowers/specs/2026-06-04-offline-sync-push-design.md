# Offline Sync — Push Engine (#2a) Design

**Status:** Disetujui 2026-06-04
**Parent:** Inisiatif offline native (Model B). Sub-proyek #1 (data layer) SELESAI & deployed (`a0c4c94`). Ini slice pertama sub-proyek #2 (sync engine). Lihat [[project_offline_native]].
**Predecessor state:** `static/offline/` punya 14 modul (Node-tested, 126 test). Lokal = sumber kebenaran; tulis direkam ke `_outbox` tapi BELUM di-push (Opsi B). `_idmap` jembatani `server_id↔cid`.

## Tujuan

Bangun **push engine**: kuras `_outbox` dan replay tiap operasi ke REST server yang ada, sehingga perubahan lokal (yang selama ini "pulau") akhirnya **merambat ke server** (dan ikut terlihat di web/bot Telegram). Saat create sukses, tetapkan `server_id` ke record lokal + `_idmap`. Node-tested untuk logika; browser-verified untuk wiring trigger.

## Keputusan terkunci (brainstorming 2026-06-04)

1. **Tag saat push = rekonstruksi judul.** Karena judul lokal disimpan tanpa tag (#1e-a) dan server menurunkan tag dari judul, push mengirim `title = judul_bersih + " #tag1 #tag2"` (tag dari `entity_tags` lokal). Server re-derive tag & simpan judul bersih lagi → round-trip konsisten, tanpa endpoint baru.
2. **Trigger = auto + manual.** `pushOutbox` dipanggil otomatis saat event `online` & setelah tiap mutasi lokal (debounced) bila online; plus fungsi manual.
3. **Push-only = last-write-wins.** Push menimpa server; konflik (device lain ubah record sama) diterima sampai slice konflik (#2c). Single primary device = risiko minim.
4. **Tanpa perubahan backend.** Pakai REST yang ada.

## Non-goals (eksplisit — slice berikutnya)

- ❌ **Pull** (server→lokal, rekonsiliasi perubahan bot/device lain, hard-delete server) → #2b.
- ❌ **Resolusi konflik** selain last-write-wins → #2c.
- ❌ **Kolaboratif offline** (shared lists/chat) → #2d.
- ❌ Perubahan backend (tombstone, endpoint delta `?since=`).
- ❌ Sub-entitas (subtasks/notes/attachments) & domain non-task (habits/notes/mindmaps) — belum punya outbox/repo offline.
- ❌ UI status sync kaya (badge/last-synced) — cukup hasil `{pushed, failed, remaining}` + log; UI menyusul bila perlu.

## Kontrak server (dari `webapp.py`, tak diubah)

- `POST /api/tasks` (`TaskCreate`): `title, description, priority, project, context, deadline, gtd_status, waiting_for, list_id, assigned_to, parent_id, recurrence_type, recurrence_days(list)`. Strip+derive tag dari `title`. Balas task dict (incl. `id`).
- `PUT /api/tasks/{id}` (`TaskUpdate`): `title, description, priority, project, context, deadline, gtd_status, waiting_for, assigned_to, progress, recurrence_type, recurrence_days(list), recurrence_renew`. **Tak ada `parent_id`/`list_id`.** Re-derive tag dari `title` bila `title` dikirim. Butuh ≥1 field else 400.
- `DELETE /api/tasks/{id}`: hard delete.
- `POST /api/tasks/{id}/occurrences/{date}/mark` (`{status}`): upsert recurring_exception.

**Catatan paritas:** `TaskUpdate` tak menerima `recurrence_end_date`; server kelola sendiri (today+90 bila belum ada). Jadi `recurrence_end_date` lokal vs server bisa beda setelah push — diterima (field renewal dikelola server; rekonsiliasi di #2b).

## Bentuk `_outbox` (dari #1c–#1e-a)

Tiap record: `{ qid (autoincrement), ts, retries, op, entity_type, cid, payload }`.
- `op:'create'|'update'|'delete'`, `entity_type:'task'`, `payload:` full record (create/update) atau `{cid}` (delete).
- `op:'mark_occurrence'`, `entity_type:'recurring_exception'`, `payload:` exception record `{cid, task_cid, occurrence_date, status}`.

## Arsitektur

| Unit | Status | Tanggung jawab | Uji |
|---|---|---|---|
| `static/offline/syncpush.js` | **BARU** | `pushOutbox(transport, opts)` + mapper pure `taskToCreatePayload`/`taskToUpdatePayload` + `markPayload` | Node |
| `static/index.html` | **UBAH** | bangun `transport` (raw fetch + token), panggil `pushOutbox` saat `online`/after-mutation(debounced)/manual | Browser |

### `transport` (injectable — kunci testabilitas + benar)
Objek `{ request(method, path, body) → Promise<{status, data}> }`. **Di browser = raw `window.fetch` + header `Authorization` — BUKAN `api`** (kalau pakai `api` kena intercept lokal → loop). Di Node test = fake server in-memory. `request` mengembalikan `{status, data}`; non-2xx tidak throw (push memutuskan kebijakan dari `status`).

### `syncpush.js` API
- `taskToCreatePayload(record, tagNames, parentServerId)` → body `TaskCreate`. `title = stripTrailingSpace(record.title) + tagNames.map(t=>' #'+t).join('')`; `recurrence_days = record.recurrence_days ? JSON.parse(record.recurrence_days) : null`; `parent_id = parentServerId ?? null`; `list_id = null` (lists belum offline); salin description/priority/project/context/deadline/gtd_status/waiting_for/assigned_to/recurrence_type.
- `taskToUpdatePayload(record, tagNames)` → body `TaskUpdate` (judul+tag rekonstruksi; recurrence_days array; progress; **tanpa** parent_id/list_id).
- `markPayload(record)` → `{status: record.status}`.
- `pushOutbox(transport, opts)` → `{pushed, failed, remaining}`: ambil `outboxAll()` urut `qid`; untuk tiap op proses (lihat di bawah); guard agar **serial** (satu drain; panggilan kedua saat berjalan → no-op/queued). `opts.tagsFor(cid)` default `tagrepo.getEntityTags('task', cid)`; `opts.idmap`/`opts.db` injectable untuk test.

### Pemrosesan tiap op (urut `qid`)
1. **create** (`task`): jika `record.server_id` sudah ada → op stale, hapus & lanjut (idempoten). Else `transport.request('POST','/api/tasks', taskToCreatePayload(rec, tags, parentSid))`. `2xx`→ `idmap.mapPut('task', data.id, cid)`, set `record.server_id=data.id`+`dirty=0` (putRaw), `outboxRemove(qid)`. `4xx`→ drop op+log. error jaringan→ **stop**.
2. **update** (`task`): `sid = idmap.serverIdOf(cid)`; bila null → drop+log (belum pernah ter-create). Else `PUT /api/tasks/{sid}` body `taskToUpdatePayload`. `2xx`→ `dirty=0`+remove. `4xx`(404 task hilang)→ drop+log. jaringan→ stop.
3. **delete** (`task`): `sid = serverIdOf(cid)`; null → drop (tak pernah ter-create; tombstone lokal cukup). Else `DELETE /api/tasks/{sid}`. `2xx`/`404`→ remove (sudah hilang = tujuan tercapai). jaringan→ stop.
4. **mark_occurrence** (`recurring_exception`): `sid = serverIdOf(payload.task_cid)`; null → drop. Else `POST /api/tasks/{sid}/occurrences/{payload.occurrence_date}/mark` body `{status}`. `2xx`→ remove. `4xx`→ drop+log. jaringan→ stop.

**Ordering jamin** parent/task ter-create sebelum child/occurrence (qid lebih kecil), jadi `serverIdOf` tersedia saat dibutuhkan.

### Wiring `index.html` (browser-verified)
- `transport` = `{ request: (m,p,b) => window.fetch(p,{method:m, headers:{'Content-Type':'application/json','Authorization':'Bearer '+__token}, body:b?JSON.stringify(b):undefined}).then(r=>r.text().then(t=>({status:r.status, data:t?JSON.parse(t):null}))) }`.
- Panggil `TF.syncpush.pushOutbox(transport)` :
  - (a) `window.addEventListener('online', schedulePush)`.
  - (b) **Hook di intercept `api.fetch`**: setelah dispatch lokal SUKSES untuk method write (`POST`/`PUT`/`DELETE` pada route task yang ter-intercept), panggil `schedulePush()`. Inilah titik tunggal yang dilewati semua mutasi → tak perlu membungkus tiap pemanggil. `schedulePush` = debounce (mis. 1.5s) + hanya bila `navigator.onLine`.
  - (c) manual: ekspos `window.__pushNow = () => TF.syncpush.pushOutbox(transport)`.
- Guard serial di dalam `pushOutbox` mencegah tumpang-tindih trigger.

## Data flow

```
[online / after-mutation / manual] → pushOutbox(transport)
  outboxAll() urut qid →
   create → POST /api/tasks (judul+tag) → server_id → idmap + record.server_id, dirty=0 → remove op
   update → PUT  /api/tasks/{sid} (judul+tag) → dirty=0 → remove
   delete → DELETE /api/tasks/{sid} → remove
   mark   → POST /api/tasks/{sid}/occurrences/{date}/mark → remove
  network error → STOP (sisa op tetap, retry saat online berikut)
  → {pushed, failed, remaining}
```

## Testing

- **Node** `tests/offline/syncpush.test.js` (`fake-indexeddb` + seed tasks/outbox + fake transport):
  - mapper: `taskToCreatePayload` (judul+tag rekonstruksi, recurrence_days array, parent_id via sid, list_id null); `taskToUpdatePayload` (tanpa parent/list, ada progress); `markPayload`.
  - `pushOutbox`: FIFO order; create menetapkan `server_id`+idmap+hapus op+`dirty=0`; update/delete/mark pakai `serverIdOf`; **stop** saat transport melempar/`status=0` (network) menyisakan op; **drop** saat `4xx`; **idempotent** create di-skip bila `server_id` sudah ada; child create memakai parent `server_id` dari create sebelumnya; hasil `{pushed, failed, remaining}` benar.
- **Browser**: buat task ber-`#tag` offline → online → push → task + tag muncul di server (cek via raw fetch / web lain / bot); edit→PUT; hapus→DELETE; recurring mark→occurrence; `_outbox` kosong setelah sukses; tak ada loop (transport pakai raw fetch, bukan intercept).

## Done criteria

1. `syncpush.js` ekspor `pushOutbox`, `taskToCreatePayload`, `taskToUpdatePayload`, `markPayload`; Node-tested.
2. Push menguras outbox FIFO, replay benar, set `server_id`+`_idmap` saat create, hapus op sukses; stop-on-network, drop-on-4xx, idempoten, serial.
3. Tag ikut ke server via rekonstruksi judul.
4. Wiring: auto (online + after-mutation debounced) + manual; transport = raw fetch (bukan `api`).
5. Suite Node hijau (126 + syncpush); browser-verified end-to-end.

## Next (slice berikutnya)

- **#2b Pull engine** — server→lokal rekonsiliasi (hard-delete server → full-list reconcile atau tambah tombstone/endpoint delta), tarik perubahan bot/device lain.
- **#2c Konflik** — `base_rev`/`updated_at` deteksi, kebijakan resolusi.
- **#2d Kolaboratif** — shared lists/chat offline.
