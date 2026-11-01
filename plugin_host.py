"""
Alurik — fasad server untuk modul plugin (`plugins/<id>.py`), spec Fase 0b K8; ADR-039.

Plugin HANYA meng-import modul ini (+ fastapi/pydantic/stdlib) — tidak pernah `webapp`,
`repository`, `bot`, atau `sqlite3.connect`. Isinya di-bind saat start oleh proses yang
memuat plugin: `webapp.py` (`current_user` + `DB_PATH`) dan `bot.py` (`db_path` saja).

- `current_user`  — dependency FastAPI (fungsi tingkat-modul yang stabil → di-cache sekali per request
                    walau dipakai router dan endpoint). `async` karena `webapp.get_current_user` async.
- `get_conn()`    — `dbconn.get_conn(<path ter-bind>)`: commit bila sukses, rollback bila error, close.
- `write_tx`      — `dbconn.write_tx`: wajib untuk baca-lalu-tulis (BEGIN IMMEDIATE sebelum SELECT).
- `list_access` / `accessible_list_ids` — keanggotaan workspace (`shared_lists.owner_id` ∪ `list_members`).
- `now_utc()`     — `datetime` aware UTC.
- `allow_async`   — dekorator: izinkan endpoint `async def` (default loader menolaknya; endpoint wajib `def`).
"""
from __future__ import annotations

import inspect
from datetime import datetime, timezone

from fastapi import Request

import dbconn

HOST_API = 1

_bound_current_user = None
_db_path = None

write_tx = dbconn.write_tx


def bind(*, current_user=None, db_path) -> None:
    """Dipanggil web/bot saat start. `db_path` = callable tanpa argumen (dibaca saat dipakai,
    agar monkeypatch `webapp.DB_PATH` di tes ikut)."""
    global _bound_current_user, _db_path
    if not callable(db_path):
        raise TypeError("plugin_host.bind: db_path harus callable tanpa argumen")
    _bound_current_user = current_user
    _db_path = db_path


async def current_user(request: Request) -> dict:
    fn = _bound_current_user
    if fn is None:
        raise RuntimeError("plugin_host belum di-bind (current_user)")
    res = fn(request)
    if inspect.isawaitable(res):
        res = await res
    return res


def db_path() -> str | None:
    return _db_path() if _db_path is not None else None


def get_conn():
    """Context manager koneksi standar (pragma ADR-038) ke DB host."""
    return dbconn.get_conn(db_path())


def list_access(conn, uid: int, list_id: int) -> bool:
    """Apakah `uid` pemilik atau anggota workspace `list_id` (pemakai pertama: plugin_records)."""
    row = conn.execute(
        "SELECT 1 FROM shared_lists WHERE id = ? AND owner_id = ? "
        "UNION ALL SELECT 1 FROM list_members WHERE list_id = ? AND user_id = ? LIMIT 1",
        (list_id, uid, list_id, uid),
    ).fetchone()
    return row is not None


def accessible_list_ids(conn, uid: int) -> list[int]:
    """Id workspace yang bisa diakses `uid` (pemilik ∪ anggota), urut naik, tanpa duplikat."""
    rows = conn.execute(
        "SELECT id FROM shared_lists WHERE owner_id = ? "
        "UNION SELECT list_id FROM list_members WHERE user_id = ? ORDER BY 1",
        (uid, uid),
    ).fetchall()
    return [int(r[0]) for r in rows]


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def allow_async(fn):
    """Tandai endpoint `async def` yang sengaja (mis. uji koneksi jaringan, Lampiran A #1)."""
    fn.__plugin_allow_async__ = True
    return fn


def _reset_for_tests() -> None:
    global _bound_current_user, _db_path
    _bound_current_user = None
    _db_path = None
