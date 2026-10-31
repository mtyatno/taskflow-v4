"""Plugin contoh KHUSUS TES (spec Fase 0b K18): membuktikan loader, router, ensure_schema.

Bukan plugin pengguna — hanya dimuat tes lewat `plugin_loader.init_web(app, plugins_dir=tests/fixtures/plugins, ...)`.
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel

import plugin_host as host

MIN_HOST_API = 1
router = APIRouter()


def ensure_schema(conn):  # dipanggil dalam write_tx; jangan commit
    conn.execute(
        "CREATE TABLE IF NOT EXISTS plg_demo_server_items ("
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
            "SELECT id, title FROM plg_demo_server_items WHERE user_id = ? ORDER BY id",
            (user["sub"],),
        ).fetchall()
    return {"items": [dict(r) for r in rows]}


@router.post("/items")
def create_item(body: ItemIn, user=Depends(host.current_user)):
    with host.get_conn() as conn:
        with host.write_tx(conn):
            cur = conn.execute(
                "INSERT INTO plg_demo_server_items (user_id, title) VALUES (?, ?)",
                (user["sub"], body.title),
            )
            new_id = cur.lastrowid
    return {"id": new_id}
