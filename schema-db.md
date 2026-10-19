CREATE TABLE tasks (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    title           TEXT NOT NULL,
                    description     TEXT DEFAULT '',
                    gtd_status      TEXT NOT NULL DEFAULT 'inbox',
                    priority        TEXT NOT NULL DEFAULT 'P3',
                    quadrant        TEXT NOT NULL DEFAULT 'Q4',
                    project         TEXT DEFAULT '',
                    context         TEXT DEFAULT '',
                    deadline        TEXT DEFAULT NULL,
                    waiting_for     TEXT DEFAULT '',
                    created_at      TEXT NOT NULL,
                    updated_at      TEXT NOT NULL,
                    completed_at    TEXT DEFAULT NULL
                , user_id INTEGER DEFAULT NULL, is_focused INTEGER DEFAULT 0, list_id INTEGER DEFAULT NULL, assigned_to INTEGER DEFAULT NULL, progress INTEGER DEFAULT 0, parent_id INTEGER DEFAULT NULL REFERENCES tasks(id) ON DELETE SET NULL, client_id TEXT);
CREATE UNIQUE INDEX idx_tasks_user_client ON tasks(user_id, client_id) WHERE client_id IS NOT NULL;
CREATE TABLE sqlite_sequence(name,seq);
CREATE INDEX idx_tasks_gtd_status ON tasks(gtd_status)
            ;
CREATE INDEX idx_tasks_priority ON tasks(priority)
            ;
CREATE INDEX idx_tasks_quadrant ON tasks(quadrant)
            ;
CREATE INDEX idx_tasks_project ON tasks(project)
            ;
CREATE TABLE users (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                username        TEXT NOT NULL UNIQUE,
                password_hash   TEXT NOT NULL,
                display_name    TEXT DEFAULT '',
                telegram_id     INTEGER DEFAULT NULL,
                created_at      TEXT NOT NULL
            );
CREATE INDEX idx_tasks_user_id ON tasks(user_id);
CREATE INDEX idx_users_telegram_id ON users(telegram_id);
CREATE TABLE subtasks (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id     INTEGER NOT NULL,
                    title       TEXT NOT NULL,
                    is_done     INTEGER DEFAULT 0,
                    sort_order  INTEGER DEFAULT 0,
                    created_at  TEXT NOT NULL, client_id TEXT DEFAULT NULL,
                    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
                );
CREATE INDEX idx_subtasks_task_id ON subtasks(task_id);
CREATE TABLE task_notes (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id     INTEGER NOT NULL,
                    content     TEXT NOT NULL,
                    created_at  TEXT NOT NULL, author_id INTEGER DEFAULT NULL, client_id TEXT DEFAULT NULL,
                    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
                );
CREATE INDEX idx_task_notes_task_id ON task_notes(task_id);
CREATE TABLE task_attachments (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id         INTEGER NOT NULL,
                    filename        TEXT NOT NULL,
                    original_name   TEXT NOT NULL,
                    file_size       INTEGER DEFAULT 0,
                    mime_type       TEXT DEFAULT '',
                    created_at      TEXT NOT NULL,
                    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
                );
CREATE INDEX idx_task_attachments_task_id ON task_attachments(task_id);
CREATE TABLE magic_tokens (
                    token       TEXT PRIMARY KEY,
                    user_id     INTEGER NOT NULL,
                    expires_at  TEXT NOT NULL,
                    used        INTEGER DEFAULT 0
                );
CREATE TABLE shared_lists (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    name        TEXT NOT NULL,
                    owner_id    INTEGER NOT NULL,
                    created_at  TEXT NOT NULL,
                    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
                );
CREATE INDEX idx_shared_lists_owner ON shared_lists(owner_id);
CREATE TABLE list_members (
                    list_id     INTEGER NOT NULL,
                    user_id     INTEGER NOT NULL,
                    joined_at   TEXT NOT NULL,
                    PRIMARY KEY (list_id, user_id),
                    FOREIGN KEY (list_id) REFERENCES shared_lists(id) ON DELETE CASCADE,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );
CREATE INDEX idx_list_members_user ON list_members(user_id);
CREATE TABLE list_invites (
                    code        TEXT PRIMARY KEY,
                    list_id     INTEGER NOT NULL,
                    created_by  INTEGER NOT NULL,
                    expires_at  TEXT NOT NULL,
                    used        INTEGER DEFAULT 0,
                    FOREIGN KEY (list_id) REFERENCES shared_lists(id) ON DELETE CASCADE
                );
CREATE TABLE notifications (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id     INTEGER NOT NULL,
                    message     TEXT NOT NULL,
                    is_read     INTEGER DEFAULT 0,
                    list_id     INTEGER DEFAULT NULL,
                    task_id     INTEGER DEFAULT NULL,
                    created_at  TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );
CREATE INDEX idx_notif_user ON notifications(user_id, is_read, created_at);
CREATE TABLE messages (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    list_id     INTEGER NOT NULL,
                    user_id     INTEGER NOT NULL,
                    content     TEXT NOT NULL,
                    task_id     INTEGER DEFAULT NULL,
                    msg_type    TEXT NOT NULL DEFAULT 'text',
                    created_at  TEXT NOT NULL, reply_to_id INTEGER DEFAULT NULL REFERENCES messages(id) ON DELETE SET NULL,
                    FOREIGN KEY (list_id) REFERENCES shared_lists(id) ON DELETE CASCADE,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
                );
CREATE INDEX idx_messages_list ON messages(list_id, created_at);
CREATE TABLE habits (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    title           TEXT NOT NULL,
                    phase           TEXT NOT NULL DEFAULT 'pagi' CHECK(phase IN ('pagi','siang','malam')),
                    micro_target    TEXT DEFAULT '',
                    frequency       TEXT DEFAULT '["mon","tue","wed","thu","fri","sat","sun"]',
                    identity_pillar TEXT DEFAULT '',
                    created_at      TEXT DEFAULT (datetime('now'))
                , client_id TEXT);
CREATE INDEX idx_habits_user ON habits(user_id);
CREATE UNIQUE INDEX idx_habits_user_client ON habits(user_id, client_id) WHERE client_id IS NOT NULL;
CREATE TABLE habit_logs (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    habit_id    INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
                    date        TEXT NOT NULL,
                    status      TEXT NOT NULL CHECK(status IN ('done','skipped','missed')),
                    skip_reason TEXT DEFAULT '',
                    created_at  TEXT DEFAULT (datetime('now')),
                    UNIQUE(habit_id, date)
                );
CREATE INDEX idx_habit_logs_habit ON habit_logs(habit_id, date);
CREATE UNIQUE INDEX idx_subtasks_client_id ON subtasks(client_id) WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX idx_notes_client_id ON task_notes(client_id) WHERE client_id IS NOT NULL;
CREATE TABLE scratchpad_notes (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    title       TEXT    NOT NULL DEFAULT '',
                    content     TEXT    NOT NULL DEFAULT '',
                    tags        TEXT    NOT NULL DEFAULT '[]',
                    linked_task_id INTEGER DEFAULT NULL REFERENCES tasks(id) ON DELETE SET NULL,
                    created_at  TEXT    DEFAULT (datetime('now')),
                    updated_at  TEXT    DEFAULT (datetime('now'))
                , linked_to TEXT NOT NULL DEFAULT '[]', linked_task_ids TEXT NOT NULL DEFAULT '[]');
CREATE INDEX idx_scratchpad_user ON scratchpad_notes(user_id, updated_at);
CREATE UNIQUE INDEX idx_scratchpad_notes_user_client ON scratchpad_notes(user_id, client_id) WHERE client_id IS NOT NULL;
CREATE TABLE mindmaps (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL,
                title      TEXT NOT NULL DEFAULT 'Untitled',
                data_json  TEXT NOT NULL DEFAULT '{"nodeData":{"id":"root","topic":"Untitled","root":true,"children":[]}}',
                is_pinned  INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            , list_id INTEGER DEFAULT NULL, last_edited_by INTEGER, client_id TEXT, source_note_id INTEGER DEFAULT NULL);
CREATE UNIQUE INDEX idx_mindmaps_user_client ON mindmaps(user_id, client_id) WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX ux_mindmaps_source_note ON mindmaps(source_note_id) WHERE source_note_id IS NOT NULL;

## Pin mindmap pribadi: `mindmap_pins`

```sql
CREATE TABLE mindmap_pins (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mindmap_id INTEGER NOT NULL,
    created_at TEXT,
    PRIMARY KEY (user_id, mindmap_id)
);
CREATE INDEX idx_mindmap_pins_mm ON mindmap_pins(mindmap_id);
```

Pin per user (anggota list bersama boleh pin tanpa memengaruhi pemilik). `mindmap_id` tanpa FK; baris dibersihkan
di handler saat peta dihapus. `mindmaps.is_pinned` USANG: tidak lagi dibaca/ditulis, kolom dipertahankan agar rollback
aman. Migrasi menyalin `is_pinned = 1` ke `mindmap_pins` (atas nama pemilik) sekali, hanya saat tabel baru dibuat.

## Sampah mindmap: `trashed_mindmaps`

```sql
CREATE TABLE trashed_mindmaps (
    mindmap_id     INTEGER PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title          TEXT NOT NULL DEFAULT '',
    list_id        INTEGER,
    source_note_id INTEGER,
    client_id      TEXT,
    snapshot_json  TEXT NOT NULL,      -- {"mindmap": <SELECT * baris mindmaps>, "pins": [user_id…]}
    deleted_at     TEXT NOT NULL,      -- ISO, Asia/Jakarta
    deleted_by     INTEGER
);
CREATE INDEX idx_trashed_mm_user ON trashed_mindmaps(user_id, deleted_at);
CREATE INDEX idx_trashed_mm_note ON trashed_mindmaps(source_note_id) WHERE source_note_id IS NOT NULL;
```

Pola snapshot seperti `trashed_notes` (ADR-004), bukan kolom `deleted_at` di `mindmaps`: `DELETE /api/mindmaps/{id}`
(hanya pemilik) menyalin baris + pin ke sini lalu menghapus baris `mindmaps` dan `mindmap_pins`-nya, sehingga semua
query `mindmaps` dan index unik `ux_mindmaps_source_note` tidak perlu filter tambahan. Pulihkan memakai **id yang sama**
(dan `client_id` bila tidak bentrok); `list_id` dinolkan bila workspace hilang/user bukan anggota; pin dipulihkan untuk
user yang masih ada. Retensi `MINDMAP_TRASH_RETENTION_DAYS = 30`, purge malas saat daftar/pulihkan. Catatan sumber
dihapus permanen → baris peta tertautnya di sini ikut dihapus (`_delete_linked_mindmaps`). Tabel juga dibuat malas
(`_ensure_trashed_mindmaps_table`, tanpa FK).

## Petakan: `mindmaps.source_note_id` (peta tertaut ke catatan)

Kolom `source_note_id INTEGER DEFAULT NULL` (tanpa FK, migrasi idempoten di `webapp.migrate_db`) menandai
peta tertaut: peta yang strukturnya dicerminkan dari heading sebuah catatan (`scratchpad_notes.id`). `NULL`
= peta biasa. Index `ux_mindmaps_source_note` unik parsial (`WHERE source_note_id IS NOT NULL`) menjamin
satu peta per catatan; peta biasa tidak dibatasi. Index dibuat `IF NOT EXISTS` sehingga tetap terpasang
walau kolom sudah ada. Tanpa FK karena catatan bisa masuk Sampah/dipulihkan; konsistensi dijaga di handler.

## Idempotensi sinkron: `client_id` (user_id, client_id)

Kolom `client_id TEXT` + unique partial index `(user_id, client_id) WHERE client_id IS NOT NULL` ada di
`tasks`, `habits`, `mindmaps`, `scratchpad_notes`, `drawings` (migrasi idempoten di `webapp.migrate_db`,
audit sinkron 2026-10-15 T11). Klien offline mengirim `client_id` (cid lokal) saat POST; bila baris
`(user_id, client_id)` sudah ada, server mengembalikan baris itu (HTTP 200) alih-alih menyisipkan duplikat.
`messages.client_id` dan `dm_messages.client_id` tidak berindeks unik (data lama bisa duplikat); dedup
dilakukan di handler lewat `(list_id, user_id, client_id)` / `(conversation_id, user_id, client_id)`.

Catatan `updated_at`: kolom `tasks.updated_at` hanya di-bump oleh edit pengguna (PUT, /done, /focus, bot).
Perhitungan ulang kuadran Eisenhower (`repository.update_quadrant`, `POST /api/recalculate`) **tidak**
menyentuh `updated_at` karena kuadran adalah field turunan dan klien memakai `updated_at` sebagai revisi
(`base_rev`) untuk deteksi konflik (409 `REV_MISMATCH` pada PUT task/note/mindmap/drawing).

## Tag System (Universal)

### tags
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTOINCREMENT | |
| user_id | INTEGER NOT NULL | FK → users(id) ON DELETE CASCADE |
| name | TEXT NOT NULL | Normalized: lowercase + trim |
| color | TEXT | Optional hex color |
| created_at | TEXT | datetime('now') |
| | | UNIQUE(user_id, name) |

### entity_tags
| Column | Type | Notes |
|--------|------|-------|
| tag_id | INTEGER NOT NULL | FK → tags(id) ON DELETE CASCADE |
| user_id | INTEGER NOT NULL | Denormalized for query efficiency |
| entity_type | TEXT NOT NULL | CHECK IN ('note','task','habit','goal','message') |
| entity_id | INTEGER NOT NULL | |
| created_at | TEXT | datetime('now') |
| | | PRIMARY KEY (tag_id, entity_type, entity_id) |

**Indexes:** idx_entity_tags_lookup (entity_type, entity_id), idx_entity_tags_tag (tag_id), idx_entity_tags_user (user_id), idx_entity_tags_tag_user (tag_id, user_id)

**Triggers:** trg_delete_task_tags, trg_delete_note_tags, trg_delete_habit_tags — auto-delete entity_tags when parent entity is deleted