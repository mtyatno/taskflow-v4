#!/usr/bin/env python3
"""
Merge DB backup ke DB eksisting.
Usage:
  python3 merge_db.py <backup.db> <current.db>          # dry-run
  python3 merge_db.py <backup.db> <current.db> --apply  # eksekusi
"""

import sqlite3
import sys

DRY_RUN = "--apply" not in sys.argv

if len(sys.argv) < 3:
    print("Usage: python3 merge_db.py <backup.db> <current.db> [--apply]")
    sys.exit(1)

BACKUP_DB  = sys.argv[1]
CURRENT_DB = sys.argv[2]

print(f"\n{'[DRY-RUN] ' if DRY_RUN else ''}Merge: {BACKUP_DB} → {CURRENT_DB}\n")

src = sqlite3.connect(BACKUP_DB)
src.row_factory = sqlite3.Row
dst = sqlite3.connect(CURRENT_DB)
dst.row_factory = sqlite3.Row

src_cur = src.cursor()
dst_cur = dst.cursor()

# ── 1. Merge Users ──────────────────────────────────────────────────────────
print("=== USERS ===")
src_users = src_cur.execute("SELECT * FROM users").fetchall()
dst_usernames = {r["username"] for r in dst_cur.execute("SELECT username FROM users")}

user_id_map = {}  # old_id → new_id

for u in src_users:
    # Cari existing user di current DB by username
    existing = dst_cur.execute("SELECT id FROM users WHERE username = ?", (u["username"],)).fetchone()
    if existing:
        user_id_map[u["id"]] = existing["id"]
        print(f"  SKIP  user '{u['username']}' (sudah ada, id={existing['id']})")
    else:
        print(f"  ADD   user '{u['username']}' (telegram_id={u['telegram_id']})")
        if not DRY_RUN:
            dst_cur.execute("""
                INSERT INTO users (username, password_hash, display_name, telegram_id, created_at)
                VALUES (?, ?, ?, ?, ?)
            """, (u["username"], u["password_hash"], u["display_name"], u["telegram_id"], u["created_at"]))
            dst.commit()
            new_id = dst_cur.lastrowid
            user_id_map[u["id"]] = new_id
        else:
            user_id_map[u["id"]] = f"NEW({u['username']})"

# ── 2. Merge Tasks ──────────────────────────────────────────────────────────
print("\n=== TASKS ===")
src_tasks = src_cur.execute("SELECT * FROM tasks").fetchall()

task_id_map = {}  # old_id → new_id
added = skipped = 0

for t in src_tasks:
    old_user_id = t["user_id"]
    new_user_id = user_id_map.get(old_user_id)
    if new_user_id is None:
        print(f"  SKIP  task '{t['title'][:40]}' (user_id={old_user_id} tidak dikenal)")
        skipped += 1
        continue

    # Cek duplikat by title + created_at + user
    if not DRY_RUN:
        dup = dst_cur.execute(
            "SELECT id FROM tasks WHERE title=? AND created_at=? AND user_id=?",
            (t["title"], t["created_at"], new_user_id)
        ).fetchone()
        if dup:
            task_id_map[t["id"]] = dup["id"]
            skipped += 1
            continue

        dst_cur.execute("""
            INSERT INTO tasks (title, description, gtd_status, priority, quadrant,
                project, context, deadline, waiting_for, created_at, updated_at,
                completed_at, user_id, is_focused, list_id, assigned_to, progress, parent_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            t["title"], t["description"], t["gtd_status"], t["priority"], t["quadrant"],
            t["project"], t["context"], t["deadline"], t["waiting_for"],
            t["created_at"], t["updated_at"], t["completed_at"],
            new_user_id, t["is_focused"], None, None, t["progress"], None
        ))
        dst.commit()
        task_id_map[t["id"]] = dst_cur.lastrowid
        added += 1
    else:
        print(f"  ADD   task '{t['title'][:50]}' → user {new_user_id}")
        task_id_map[t["id"]] = f"NEW"
        added += 1

if DRY_RUN:
    print(f"\n  Total akan ditambahkan: {added} tasks, skip: {skipped}")
else:
    print(f"  Ditambahkan: {added} tasks, skip duplikat: {skipped}")

# ── 3. Merge Subtasks ───────────────────────────────────────────────────────
if not DRY_RUN:
    print("\n=== SUBTASKS ===")
    count = 0
    for s in src_cur.execute("SELECT * FROM subtasks").fetchall():
        new_task_id = task_id_map.get(s["task_id"])
        if not new_task_id or isinstance(new_task_id, str):
            continue
        dst_cur.execute("""
            INSERT OR IGNORE INTO subtasks (task_id, title, is_done, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?)
        """, (new_task_id, s["title"], s["is_done"], s["sort_order"], s["created_at"]))
        count += 1
    dst.commit()
    print(f"  Ditambahkan: {count} subtasks")

# ── 4. Merge Task Notes ─────────────────────────────────────────────────────
if not DRY_RUN:
    print("\n=== TASK NOTES ===")
    count = 0
    for n in src_cur.execute("SELECT * FROM task_notes").fetchall():
        new_task_id = task_id_map.get(n["task_id"])
        if not new_task_id or isinstance(new_task_id, str):
            continue
        dst_cur.execute("""
            INSERT INTO task_notes (task_id, content, created_at)
            VALUES (?, ?, ?)
        """, (new_task_id, n["content"], n["created_at"]))
        count += 1
    dst.commit()
    print(f"  Ditambahkan: {count} notes")

# ── 5. Merge Scratchpad Notes ───────────────────────────────────────────────
has_scratchpad = src_cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='scratchpad_notes'").fetchone()
if not DRY_RUN and has_scratchpad:
    print("\n=== SCRATCHPAD NOTES ===")
    count = 0
    for n in src_cur.execute("SELECT * FROM scratchpad_notes").fetchall():
        new_user_id = user_id_map.get(n["user_id"])
        if not new_user_id or isinstance(new_user_id, str):
            continue
        dst_cur.execute("""
            INSERT INTO scratchpad_notes (user_id, title, content, tags, created_at, updated_at, linked_to, linked_task_ids)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (new_user_id, n["title"], n["content"], n["tags"],
              n["created_at"], n["updated_at"],
              n["linked_to"] if "linked_to" in n.keys() else "[]",
              n["linked_task_ids"] if "linked_task_ids" in n.keys() else "[]"))
        count += 1
    dst.commit()
    print(f"  Ditambahkan: {count} scratchpad notes")

# ── 6. Merge Habits ─────────────────────────────────────────────────────────
has_habits = src_cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='habits'").fetchone()
if not DRY_RUN and has_habits:
    print("\n=== HABITS ===")
    habit_id_map = {}
    count = 0
    for h in src_cur.execute("SELECT * FROM habits").fetchall():
        new_user_id = user_id_map.get(h["user_id"])
        if not new_user_id or isinstance(new_user_id, str):
            continue
        dup = dst_cur.execute(
            "SELECT id FROM habits WHERE user_id=? AND title=?", (new_user_id, h["title"])
        ).fetchone()
        if dup:
            habit_id_map[h["id"]] = dup["id"]
            continue
        dst_cur.execute("""
            INSERT INTO habits (user_id, title, phase, micro_target, frequency, identity_pillar, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (new_user_id, h["title"], h["phase"], h["micro_target"],
              h["frequency"], h["identity_pillar"], h["created_at"]))
        habit_id_map[h["id"]] = dst_cur.lastrowid
        count += 1
    dst.commit()
    print(f"  Ditambahkan: {count} habits")

    # Habit logs
    count = 0
    for log in src_cur.execute("SELECT * FROM habit_logs").fetchall():
        new_habit_id = habit_id_map.get(log["habit_id"])
        if not new_habit_id:
            continue
        try:
            dst_cur.execute("""
                INSERT OR IGNORE INTO habit_logs (habit_id, date, status, skip_reason, created_at)
                VALUES (?, ?, ?, ?, ?)
            """, (new_habit_id, log["date"], log["status"], log["skip_reason"], log["created_at"]))
            count += 1
        except Exception:
            pass
    dst.commit()
    print(f"  Ditambahkan: {count} habit logs")

src.close()
dst.close()

print("\n" + ("=" * 50))
if DRY_RUN:
    print("DRY-RUN selesai. Jalankan dengan --apply untuk eksekusi.")
else:
    print("MERGE SELESAI.")
print("=" * 50 + "\n")
