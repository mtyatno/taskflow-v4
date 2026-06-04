# Offline Shared-List Tasks (#2d-1) Design

**Status:** Disetujui 2026-06-04
**Parent:** Inisiatif offline native (Model B), sub-proyek #2. Slice pertama Kelompok 2 (kolaboratif). #1 + #2a/b/c SELESAI & deployed (SW v122). Lihat [[project_offline_native]].
**Predecessor state:** `static/offline/` 17 modul (156 test). Task sync (push/pull/konflik) jalan. **Penting: `GET /api/tasks` server SUDAH menyertakan task shared-list** (owner/member) → task shared-list sudah ikut ter-pull/push/konflik; yang hilang hanya asosiasi list + navigasi per-list offline.

## Tujuan

Membuat **shared-list + task-nya berfungsi offline**: lihat daftar shared-list (+ task-nya) saat offline, buat/edit/hapus task di shared-list offline lalu sync. Reuse maksimal mesin task #2a-c. Multi-user conflict pakai LWW #2c (timestamp, user-agnostik).

## Keputusan terkunci (brainstorming 2026-06-04)

1. **Lists + task-nya offline; admin sharing tetap online.** Offline: `GET /api/lists`, `GET /api/lists/{id}/tasks`, buat/edit/hapus task di list. Online-only: create/join/invite/leave/remove member, generate-link, **chat** (#2d-2), **view anggota** (`/members`).
2. **Akses dicabut = hilang akses, tanpa opsi jadi personal.** Push task dapat **403** → hapus task lokal + idmap + buang op. Task shared yang dihapus teammate (404/edit-vs-delete) → banner konflik **discard-only** (sembunyikan "Simpan sebagai task baru" bila record ber-`list_id`).
3. **List = mirror server→lokal murni** (list tak pernah dirty lokal; admin online) → tanpa konflik list.
4. **Task mereferensi list via server `list_id`** (list selalu punya server_id, tak pernah dibuat offline) — bukan list-cid. Sederhana.

## Non-goals (eksplisit)

- ❌ Admin sharing offline (create/join/invite/leave/remove/link) — online.
- ❌ Chat (#2d-2), view anggota offline, list-notes/mindmap (domain belum offline).
- ❌ Membuat shared-list baru offline (list dibuat online).

## Kontrak server (dari `webapp.py`, tak diubah)

- `GET /api/lists` → `[{id, name, owner_id, created_at, role:'owner'|'member', member_count}]` (`shared_lists` tak punya `updated_at`).
- `GET /api/lists/{id}/tasks` → `task_row_to_dict[]` `WHERE list_id=? AND gtd_status NOT IN ('done','archived') ORDER BY priority, deadline`. Non-member → **403**.
- `GET /api/tasks` → sudah termasuk task shared-list (access_clause owner/member).
- `POST /api/tasks` (`TaskCreate`) menerima `list_id`. `PUT`/`DELETE` task di list yang user bukan member → **403**.

## Arsitektur — perubahan

| Unit | Status | Tanggung jawab | Uji |
|---|---|---|---|
| `static/offline/db.js` | **UBAH** | DB v2→**v3**, tambah store `lists` | Node |
| `static/offline/listsync.js` | **BARU** | `pullLists`, `getLocalLists`, `pullAndReconcileLists` | Node |
| `static/offline/hydrate.js` | **UBAH** | `taskFromServer` salin `list_id` | Node |
| `static/offline/taskrepo.js` | **UBAH** | `createTask` simpan `list_id` | Node |
| `static/offline/syncpush.js` | **UBAH** | `taskToCreatePayload` kirim `list_id`; **403→lost-access** (hapus lokal) | Node |
| `static/offline/taskroutes.js` | **UBAH** | register `GET /api/lists`, `GET /api/lists/:id/tasks` | Node |
| `static/offline/syncconflict.js` | **UBAH** | `listConflicts` sertakan `list_id` (utk banner discard-only) | Node |
| `static/index.html` | **UBAH** | load `listsync.js`; `sync()` pull lists; banner discard-only bila `list_id` | Browser |
| `static/sw.js` | **UBAH** | bump v123 + precache `listsync.js` | Browser |

### `db.js`
- `DB_VERSION = 3`. Tambah ke `ENTITY_STORES`: `lists: [["server_id","server_id"], ["dirty","dirty"]]` (keyed `cid`). `createSchema` idempoten → hanya menambah store, data v2 aman. `tests/offline/db.test.js:66` `DB_VERSION is 2` → ubah jadi 3. (Test "creates all entity stores" data-driven via `ENTITY_STORE_NAMES` → otomatis mencakup `lists`.)

### `listsync.js` (API)
- `pullLists(serverLists) → {created, updated, deleted}` — mirror: pass-1 pastikan `cid` per `server_id` via `idmap` (type `"list"`); pass-2 upsert tiap list (`listFromServer`); pass-3 hapus list lokal yang `server_id`-nya hilang dari respons. (List tak pernah dirty → tak ada skip/konflik.)
- `listFromServer(s, cid)` → `{cid, server_id:s.id, name:s.name, owner_id:s.owner_id, role:s.role, member_count:s.member_count, dirty:0}`.
- `getLocalLists() → [{id:(server_id||cid), name, owner_id, role, member_count}]` (bentuk = respons `GET /api/lists`).
- `pullAndReconcileLists(rawFetch)` → `rawFetch("/api/lists")` → `.json()` → `pullLists`.

### `hydrate.taskFromServer` (UBAH)
Tambah `rec.list_id = dict.list_id != null ? dict.list_id : null;` (server list id; `list_cid` lama tetap `null`, tak dipakai).

### `taskrepo.createTask` (UBAH)
Tambah ke record: `list_id: input.list_id != null ? input.list_id : null` (buat-task-ke-list offline).

### `syncpush.js` (UBAH)
- `taskToCreatePayload`: `list_id: record.list_id != null ? record.list_id : null` (ganti `null` lama).
- **403 (lost access)** di `opCreate`/`opUpdate`: bila `res.status === 403` → `lostAccess(rec, op)` = (server_id? `idmap.mapDelete('task', server_id)`) + hapus task lokal dari store + `outboxRemove(op.qid)`. (Beda dari 404 yang men-flag konflik.)

### `taskroutes.buildTaskRouter` (UBAH — fold 2 route, reuse `withId`)
```
router.register("GET", "/api/lists", () => TFlistsync.getLocalLists());
router.register("GET", "/api/lists/:id/tasks", ({ params }) =>
  TFquery.listTasks({}, opts()).then((rows) =>
    rows.filter((r) => String(r.list_id) === String(params.id)).map(withId)));
```
`listTasks` default sudah exclude done/archived + order priority,deadline → paritas endpoint. Tambah require `TFlistsync`. Route admin/chat/members tak diregistrasi → network.

### `syncconflict.listConflicts` (UBAH)
Sertakan `list_id`: `.map((r) => ({ cid:r.cid, title:r.title, conflict:r.conflict, list_id:(r.list_id != null ? r.list_id : null) }))`.

### `index.html` (browser-verified)
- Load `<script src="/static/offline/listsync.js">` (setelah `syncconflict.js`).
- `sync()` tambah pull lists: `pullAndReconcile(tasks)` → `pullAndReconcileLists` → `pushOutbox` → `renderConflicts`.
- `renderConflicts`: bila `c.list_id != null` (task shared) → render **hanya** tombol "Buang perubahan" (sembunyikan "Simpan sebagai task baru").

### `sw.js`
`CACHE` → `taskflow-v123-shared-lists`; precache `"/static/offline/listsync.js"`.

## Data flow

```
sync()  → pull tasks (incl shared) → pull lists (mirror) → push → renderConflicts
GET /api/lists            → intercept → listsync.getLocalLists()         (lokal)
GET /api/lists/{id}/tasks → intercept → listTasks(local).filter(list_id) (lokal)
buat task ke list offline → createTask({list_id}) → outbox → push POST {list_id}
push 403 (di-keluarkan)   → hapus task lokal + idmap + buang op
push 404 / teammate hapus → flag conflict → banner DISCARD-ONLY (shared)
admin/chat/members        → tak diintercept → network
```

## Testing

- **Node**: `db.test.js` (versi 3); `listsync.test.js` BARU (pullLists create/update/delete, getLocalLists shape, idmap list-type); `hydrate.test.js` (+list_id mapped); `taskrepo.test.js` (+createTask list_id); `syncpush.test.js` (+taskToCreatePayload list_id; +403 hapus task lokal+idmap+op); `taskroutes.test.js` (+GET /api/lists, +GET /api/lists/:id/tasks filter list_id); `syncconflict.test.js` (+listConflicts sertakan list_id).
- **Browser**: offline → sidebar shared-list tampil; buka list → task-nya tampil; buat/edit/hapus task di list offline → online → muncul/terupdate di server; di device/web lain keluarkan diri dari satu list → sync → list + task-nya hilang lokal (403 path / mirror delete); teammate hapus satu task shared → banner **hanya** "Buang perubahan".

## Done criteria

1. `db` v3 + store `lists`; `listsync` mirror; `taskFromServer`/`createTask`/`taskToCreatePayload` bawa `list_id`; `syncpush` 403→lost-access; `taskroutes` 2 route list; `syncconflict` sertakan `list_id`. Node suite hijau.
2. `sync()` pull lists; banner konflik discard-only utk task shared.
3. Browser-verified: list+task offline, create/edit/delete sync, lost-access removal, discard-only banner.

## Next (slice berikutnya)

- **#2e Habits offline**, **#2f Notes**, **#2g Mindmap**, **#2h Chat** → lalu **#3 Tauri**.
- Opsional: view anggota offline, list-notes/mindmap saat domainnya offline.
