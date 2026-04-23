#!/usr/bin/env python3
"""
Fix list_id pada tasks yang sudah di-merge tapi list_id-nya NULL.
Usage:
  python3 fix_list_tasks.py <backup.db> <current.db>          # dry-run
  python3 fix_list_tasks.py <backup.db> <current.db> --apply
"""

import sqlite3
import sys

DRY_RUN = "--apply" not in sys.argv

if len(sys.argv) < 3:
    print("Usage: python3 fix_list_tasks.py <backup.db> <current.db> [--apply]")
    sys.exit(1)

BACKUP_DB  = sys.argv[1]
CURRENT_DB = sys.argv[2]

print(f"\n{'[DRY-RUN] ' if DRY_RUN else ''}Fix list_id: {BACKUP_DB} → {CURRENT_DB}\n")

src = sqlite3.connect(BACKUP_DB)
src.row_factory = sqlite3.Row
dst = sqlite3.connect(CURRENT_DB)
dst.row_factory = sqlite3.Row

src_cur = src.cursor()
dst_cur = dst.cursor()

# ── Build user_id_map (backup id → current id, by username) ─────────────────
user_id_map = {}
for u in src_cur.execute("SELECT * FROM users").fetchall():
    existing = dst_cur.execute("SELECT id FROM users WHERE username=?", (u["username"],)).fetchone()
    if existing:
        user_id_map[u["id"]] = existing["id"]

# ── Build list_id_map (backup id → current id, by name + owner) ─────────────
list_id_map = {}
for sl in src_cur.execute("SELECT * FROM shared_lists").fetchall():
    new_owner_id = user_id_map.get(sl["owner_id"])
    if not new_owner_id:
        continue
    existing = dst_cur.execute(
        "SELECT id FROM shared_lists WHERE name=? AND owner_id=?", (sl["name"], new_owner_id)
    ).fetchone()
    if existing:
        list_id_map[sl["id"]] = existing["id"]
        print(f"  List '{sl['name']}': backup_id={sl['id']} → current_id={existing['id']}")

if not list_id_map:
    print("Tidak ada shared list yang bisa di-map. Pastikan merge_db.py sudah dijalankan.")
    sys.exit(0)

# ── Fix tasks yang punya list_id di backup tapi NULL di current ──────────────
print("\n=== TASKS WITH LIST ===")
tasks_with_list = src_cur.execute(
    "SELECT * FROM tasks WHERE list_id IS NOT NULL"
).fetchall()

updated = skipped = 0
for t in tasks_with_list:
    new_list_id = list_id_map.get(t["list_id"])
    new_user_id = user_id_map.get(t["user_id"])
    if not new_list_id or not new_user_id:
        skipped += 1
        continue

    # Cari task di current DB by title + created_at + user_id
    dst_task = dst_cur.execute(
        "SELECT id, list_id FROM tasks WHERE title=? AND created_at=? AND user_id=?",
        (t["title"], t["created_at"], new_user_id)
    ).fetchone()

    if not dst_task:
        print(f"  NOT FOUND: '{t['title'][:50]}'")
        skipped += 1
        continue

    if dst_task["list_id"] == new_list_id:
        skipped += 1
        continue

    print(f"  {'WOULD UPDATE' if DRY_RUN else 'UPDATE'}: '{t['title'][:50]}' → list_id={new_list_id}")
    if not DRY_RUN:
        dst_cur.execute("UPDATE tasks SET list_id=? WHERE id=?", (new_list_id, dst_task["id"]))
    updated += 1

if not DRY_RUN:
    dst.commit()

print(f"\n  {'Akan diupdate' if DRY_RUN else 'Diupdate'}: {updated} tasks, skip: {skipped}")

src.close()
dst.close()

print("\n" + ("=" * 50))
if DRY_RUN:
    print("DRY-RUN selesai. Jalankan dengan --apply untuk eksekusi.")
else:
    print("FIX SELESAI.")
print("=" * 50 + "\n")
