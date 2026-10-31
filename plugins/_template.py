"""
Templat modul server plugin Alurik (spec Fase 0b §4.4; docs/plugins/README.md §Server).

File berawalan `_` DILEWATI loader — salin menjadi `plugins/<id>.py`, dengan `<id>` sama persis
dengan folder klien `plugins/<id>/` dan terdaftar di `static/plugins/index.json`.

Aturan:
- Hanya import `plugin_host` (+ fastapi/pydantic/stdlib). Dilarang `webapp`, `repository`, `bot`,
  `sqlite3.connect`.
- Router TANPA prefix; host memasangnya di `/api/plugins/<id>` dengan login + cek plugin aktif.
- Endpoint wajib `def` (bukan `async def`) kecuali ditandai `@host.allow_async`.
- Baca-lalu-tulis wajib `with host.write_tx(conn):`; `fetchall()` sebelum menulis; transaksi pendek,
  tanpa panggilan jaringan di dalamnya.
- Objek DB wajib bernama `plg_<id dengan - → _>_…` (mis. `plg_contoh_plugin_items`); `ensure_schema`
  dijalankan `migrate_db` dalam satu transaksi — jangan commit; objek lain → rollback + plugin 503.
- Belum didukung (plugin ditolak utuh): `on_task_written`, `jobs`, `register_bot`, `intake`.
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel

import plugin_host as host

MIN_HOST_API = 1
router = APIRouter()


def ensure_schema(conn):  # dipanggil dalam write_tx; jangan commit
    conn.execute(
        "CREATE TABLE IF NOT EXISTS plg_contoh_plugin_items ("
        " id INTEGER PRIMARY KEY,"
        " user_id INTEGER NOT NULL,"
        " title TEXT NOT NULL)"
    )


class ItemIn(BaseModel):
    title: str


@router.get("/items")
def list_items(user=Depends(host.current_user)):
    with host.get_conn() as conn:
        rows = conn.execute(
            "SELECT id, title FROM plg_contoh_plugin_items WHERE user_id = ? ORDER BY id",
            (user["sub"],),
        ).fetchall()
    return {"items": [dict(r) for r in rows]}


@router.post("/items")
def create_item(body: ItemIn, user=Depends(host.current_user)):
    with host.get_conn() as conn:
        with host.write_tx(conn):
            cur = conn.execute(
                "INSERT INTO plg_contoh_plugin_items (user_id, title) VALUES (?, ?)",
                (user["sub"], body.title),
            )
            new_id = cur.lastrowid
    return {"id": new_id}
