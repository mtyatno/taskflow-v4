"""Bot Telegram: `/link <KODE>` (token dari Pengaturan web) — regresi dua bug pra-ada (K5, R5).

1. `bot.py` membaca `repo._db_path` (tidak ada; atribut TaskRepository = `db_path`) → AttributeError.
2. Setelah (1), `datetime.fromisoformat(expires_at) < datetime.now()` → TypeError karena endpoint
   `POST /api/auth/telegram-link-token` menulis `expires_at` ber-zona Asia/Jakarta.

Token dibuat lewat endpoint asli (format produksi), lalu `cmd_link` dipanggil seperti
`tests/test_bot_invitations.py` (SimpleNamespace update/context, asyncio.run).
"""
import asyncio
import random
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytz

import bot
from conftest import db, register_user

_TZ_JKT = pytz.timezone("Asia/Jakarta")


class Msg:
    def __init__(self):
        self.sent = []

    async def reply_text(self, text, **kw):
        self.sent.append(text)


def _tg():
    return random.randint(10**9, 10**10)


def _web_user(client, name):
    r = register_user(client, name, f"{name}@example.com")
    return {"user_id": r["user_id"], "token": r["token"]}


def _link_token(client, jwt):
    r = client.post("/api/auth/telegram-link-token", headers={"Authorization": f"Bearer {jwt}"})
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    assert len(token) == 6 and all(ch in "0123456789ABCDEF" for ch in token)
    return token


def _link(tg, code):
    msg = Msg()
    update = SimpleNamespace(message=msg, effective_user=SimpleNamespace(id=tg, full_name="T", username="t"))
    ctx = SimpleNamespace(args=[code], user_data={})
    asyncio.run(bot.cmd_link(update, ctx))
    return msg, ctx


def _row(sql, *params):
    conn = db()
    try:
        return conn.execute(sql, params).fetchone()
    finally:
        conn.close()


def _exec(sql, *params):
    conn = db()
    try:
        conn.execute(sql, params)
        conn.commit()
    finally:
        conn.close()


def test_link_token_links_web_account(client):
    u = _web_user(client, f"lt_ok_{_tg()}")
    token = _link_token(client, u["token"])
    tg = _tg()
    msg, ctx = _link(tg, token.lower())  # huruf kecil → .upper() di bot
    assert msg.sent and msg.sent[0].startswith("✅ Berhasil!"), msg.sent
    assert _row("SELECT telegram_id FROM users WHERE id = ?", u["user_id"])["telegram_id"] == tg
    assert _row("SELECT 1 FROM telegram_link_tokens WHERE token = ?", token) is None
    assert ctx.user_data["db_user_id"] == u["user_id"]


def test_link_token_expired(client):
    u = _web_user(client, f"lt_exp_{_tg()}")
    token = "ABC" + format(random.randint(0, 0xFFF), "03X")
    expires_at = (datetime.now(_TZ_JKT) - timedelta(minutes=1)).isoformat()  # format sama dengan webapp
    _exec("INSERT INTO telegram_link_tokens (token, user_id, expires_at) VALUES (?, ?, ?)",
          token, u["user_id"], expires_at)
    msg, _ = _link(_tg(), token)
    assert msg.sent and msg.sent[0].startswith("❌ Kode sudah expired"), msg.sent
    assert _row("SELECT 1 FROM telegram_link_tokens WHERE token = ?", token) is None  # commit walau return awal
    assert _row("SELECT telegram_id FROM users WHERE id = ?", u["user_id"])["telegram_id"] is None


def test_link_token_invalid(client):
    _exec("DELETE FROM telegram_link_tokens WHERE token = ?", "0F0F0F")  # kode heksa valid, tidak terdaftar
    tg = _tg()
    msg, ctx = _link(tg, "0F0F0F")
    assert msg.sent and msg.sent[0].startswith("❌ Kode tidak valid"), msg.sent
    # @authorized mengisi db_user_id = pengguna otomatis tg_<id>; jalur token tidak menimpanya
    assert ctx.user_data["db_user_id"] == bot.repo.get_user_by_telegram_id(tg)["id"]


def test_link_token_taken_by_other_telegram(client):
    u = _web_user(client, f"lt_taken_{_tg()}")
    token = _link_token(client, u["token"])
    other = _tg()
    _exec("UPDATE users SET telegram_id = ? WHERE id = ?", other, u["user_id"])
    msg, _ = _link(_tg(), token)
    assert msg.sent == ["❌ Akun ini sudah terhubung ke Telegram lain."]
    assert _row("SELECT telegram_id FROM users WHERE id = ?", u["user_id"])["telegram_id"] == other
