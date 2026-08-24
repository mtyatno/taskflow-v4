#!/usr/bin/env python3
"""
Dedup baris drawings di server (sekali pakai — jalankan di VPS).

Root cause: retry sync POST /api/drawings tidak idempoten di masa lalu
(sebelum kolom client_id) → ratusan baris duplikat (judul + isi sama).
Baris kosong (data_json '{}' + svg kosong) juga dihapus bila tidak
direferensikan note & tidak di-pin.

KEAMANAN:
- Default = dry-run (hanya laporan, tidak menghapus).
- Tidak pernah menghapus baris yang DIREFERENSIKAN konten note (`::draw[id]`)
  atau yang di-pin (is_pinned=1).
- Duplikat grup (user, title, data_json) → disisakan 1 yang TERBARU.
- WAJIB backup dulu: cp taskflow.db taskflow.db.bak-$(date +%F)

Pakai:
  venv/bin/python scripts/dedup_drawings.py            # dry-run
  venv/bin/python scripts/dedup_drawings.py --run      # eksekusi
"""
import argparse
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config import DB_PATH  # noqa: E402

DRAW_REF_RE = re.compile(r"::draw\\?\[([0-9]+)\\]", re.IGNORECASE)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", action="store_true", help="eksekusi penghapusan (tanpa ini = dry-run)")
    args = ap.parse_args()

    print(f"DB: {DB_PATH}")
    print("MODE:", "EKSEKUSI" if args.run else "DRY-RUN (tidak menghapus apa pun)")
    print("PENTING: pastikan sudah backup: cp taskflow.db taskflow.db.bak-$(date +%F)\n")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        drawings = conn.execute(
            "SELECT id, user_id, title, data_json, svg_preview, is_pinned, updated_at FROM drawings"
        ).fetchall()
        notes = conn.execute("SELECT user_id, content FROM scratchpad").fetchall()

        # id yang direferensikan ::draw[id] di konten note, per user
        referenced: dict[int, set[int]] = defaultdict(set)
        for n in notes:
            for m in DRAW_REF_RE.finditer(n["content"] or ""):
                referenced[n["user_id"]].add(int(m.group(1)))

        by_group: dict[tuple, list[sqlite3.Row]] = defaultdict(list)
        for d in drawings:
            by_group[(d["user_id"], d["title"], d["data_json"])].append(d)

        to_delete: list[tuple[int, str]] = []  # (id, alasan)
        kept = 0
        for (uid, title, data), rows in by_group.items():
            rows.sort(key=lambda r: (r["updated_at"] or "", r["id"]), reverse=True)
            refs = referenced.get(uid, set())
            kept_rows = [r for r in rows if r["id"] in refs or r["is_pinned"]]
            candidates = [r for r in rows if r["id"] not in refs and not r["is_pinned"]]
            keep_one = candidates[:1] if candidates else []
            if len(rows) > 1:
                for r in rows:
                    if r in kept_rows or r in keep_one:
                        kept += 1
                        continue
                    # prioritas alasan: baris kosong (sampah retry) vs duplikat umum
                    is_empty = (r["data_json"] in ("{}", "", None)) and not (r["svg_preview"] or "").strip()
                    to_delete.append((r["id"], "kosong" if is_empty else "duplikat"))
            else:
                # baris unik TIDAK pernah dihapus (bisa jadi canvas blank baru user)
                kept += 1

        # dedup id (baris bisa kena dua kriteria)
        seen: set[int] = set()
        uniq = []
        for did, reason in to_delete:
            if did not in seen:
                seen.add(did)
                uniq.append((did, reason))

        print(f"Total baris drawings : {len(drawings)}")
        print(f"Dipertahankan        : {kept}")
        print(f"AKAN DIHAPUS         : {len(uniq)}")
        by_reason: dict[str, int] = defaultdict(int)
        for _, reason in uniq:
            by_reason[reason] += 1
        for k, v in sorted(by_reason.items()):
            print(f"  - {k}: {v}")

        if not args.run:
            print("\nDry-run selesai. Jalankan dengan --run untuk menghapus.")
            return

        conn.execute("PRAGMA foreign_keys = ON")
        cur = conn.cursor()
        for did, _reason in uniq:
            cur.execute("DELETE FROM drawings WHERE id = ?", (did,))
        conn.commit()
        print(f"\nSelesai — {len(uniq)} baris dihapus.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
