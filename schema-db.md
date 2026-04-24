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
                , user_id INTEGER DEFAULT NULL, is_focused INTEGER DEFAULT 0, list_id INTEGER DEFAULT NULL, assigned_to INTEGER DEFAULT NULL, progress INTEGER DEFAULT 0, parent_id INTEGER DEFAULT NULL REFERENCES tasks(id) ON DELETE SET NULL);
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
                );
CREATE INDEX idx_habits_user ON habits(user_id);
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