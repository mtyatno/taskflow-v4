"""
Alurik — pohon checklist bertingkat, bagian murni (spec checklist bertingkat §3.3, §5; rencana PR A R1).

Satu butir = satu baris tabel `subtasks` (`id`, `task_id`, `parent_id`, `sort_order`, …). Modul ini hanya
stdlib dan tidak meng-import `webapp`/`repository`/`config`, sehingga bisa dipakai `repository.py` dan
`merge_db.py`.

- `percent(done, total)` — persen level atas, bulat setengah ke atas dengan rumus bilangan bulat yang sama
  di JS (D10); `total = 0` → `None`. Vektor bersama: `tests/fixtures/checklist_percent_vectors.json`.
- `preorder(rows)` — salinan baris + `depth`, induk lalu turunannya; saudara urut `(sort_order, id)`.
  Butir yang induknya tidak ada atau berada di task lain diperlakukan level atas. Dalam setiap siklus,
  anggota dengan `(sort_order, id)` terkecil diperlakukan level atas (hasilnya sama dengan bila
  `parent_id`-nya dikosongkan). Traversal iteratif — tanpa rekursi, aman untuk kedalaman berapa pun.
- `descendant_ids(rows, root_id)` — id semua turunan `root_id` dalam urutan pre-order (tanpa akar),
  menurut pohon efektif yang sama dengan `preorder` (tahan siklus).
- `recompute_all(conn)` — satu-satunya fungsi SQL: hitung ulang `tasks.progress`/`checklist_total` semua task
  dari butir level atas (`parent_id IS NULL`) memakai koneksi pemanggil (tanpa commit); dipakai
  `TaskRepository.heal_checklists` (setiap start) dan `merge_db.py`.
"""
from __future__ import annotations

from typing import Iterable, Mapping, Optional


def percent(done: int, total: int) -> Optional[int]:
    """Persen selesai/total dibulatkan setengah ke atas; `None` bila tidak ada butir level atas."""
    if not total:
        return None
    return (done * 200 + total) // (2 * total)


def _key(row: Mapping) -> tuple:
    """Urutan tampil di antara saudara: `sort_order` (NULL = 0), lalu `id`."""
    return (row.get("sort_order") or 0, row["id"])


def preorder(rows: Iterable[Mapping]) -> list[dict]:
    """Daftar datar pre-order; setiap butir = salinan baris + `depth` (0 = level atas)."""
    items = [dict(r) for r in rows]
    by_id = {r["id"]: r for r in items}

    # Induk efektif: induk yang tidak ada atau di task lain → level atas.
    parent: dict = {}
    for r in items:
        p = r.get("parent_id")
        pr = by_id.get(p) if p is not None else None
        parent[r["id"]] = p if pr is not None and pr.get("task_id") == r.get("task_id") else None

    # Putus siklus: tiap komponen yang tidak sampai ke level atas punya tepat satu siklus
    # (setiap butir punya paling banyak satu induk); anggota terkecil menurut _key jadi level atas.
    resolved: set = set()
    for start in by_id:
        path: list = []
        pos: dict = {}
        n = start
        while n is not None and n not in resolved:
            if n in pos:
                breaker = min(path[pos[n]:], key=lambda i: _key(by_id[i]))
                parent[breaker] = None
                break
            pos[n] = len(path)
            path.append(n)
            n = parent[n]
        resolved.update(path)

    roots: list = []
    children: dict = {}
    for r in items:
        p = parent[r["id"]]
        if p is None:
            roots.append(r)
        else:
            children.setdefault(p, []).append(r)
    roots.sort(key=_key)
    for kids in children.values():
        kids.sort(key=_key)

    out: list = []
    stack = [(r, 0) for r in reversed(roots)]
    while stack:
        r, depth = stack.pop()
        r["depth"] = depth
        out.append(r)
        for c in reversed(children.get(r["id"], ())):
            stack.append((c, depth + 1))
    return out


def descendant_ids(rows: Iterable[Mapping], root_id: int) -> list[int]:
    """Id semua turunan `root_id` (pre-order, tanpa akar); `[]` bila tidak ada / tanpa turunan."""
    flat = preorder(rows)
    for i, r in enumerate(flat):
        if r["id"] == root_id:
            out = []
            for s in flat[i + 1:]:
                if s["depth"] <= r["depth"]:
                    break
                out.append(s["id"])
            return out
    return []


def recompute_all(conn) -> int:
    """Hitung ulang field turunan checklist semua task (spec §3.4, K15) di koneksi pemanggil, tanpa commit.
    Task dengan butir level atas → `progress = percent(done, total)`, `checklist_total = total`; task tanpa
    butir level atas tetapi `checklist_total` ≠ 0 (atau NULL) → `checklist_total = 0`, `progress` tetap (K11).
    Hanya baris yang nilainya berbeda yang ditulis; `updated_at` tidak disentuh (D2). Bekerja dengan
    `row_factory` apa pun. Mengembalikan jumlah baris `tasks` yang ditulis."""
    rows = conn.execute(
        "SELECT t.id, t.progress, t.checklist_total, a.total, a.done FROM tasks t "
        "LEFT JOIN (SELECT task_id, COUNT(*) AS total, "
        "                  COALESCE(SUM(CASE WHEN is_done THEN 1 ELSE 0 END), 0) AS done "
        "           FROM subtasks WHERE parent_id IS NULL GROUP BY task_id) a ON a.task_id = t.id "
        "WHERE a.total IS NOT NULL OR t.checklist_total IS NOT 0"
    ).fetchall()
    written = 0
    for task_id, progress, checklist_total, total, done in rows:
        if total:
            p = percent(done, total)
            if progress != p or checklist_total != total:
                conn.execute("UPDATE tasks SET progress = ?, checklist_total = ? WHERE id = ?",
                             (p, total, task_id))
                written += 1
        elif checklist_total != 0:
            conn.execute("UPDATE tasks SET checklist_total = 0 WHERE id = ?", (task_id,))
            written += 1
    return written
