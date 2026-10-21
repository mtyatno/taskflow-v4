"""Bot Telegram: /invite membuat undangan pending; tombol inv_acc_/inv_dec_ (Fase 2a §1.2)."""
import asyncio
import random
from types import SimpleNamespace

import bot
from conftest import db

X = "<x>&"
XE = "&lt;x&gt;&amp;"


class FakeBot:
    def __init__(self):
        self.sent = []

    async def send_message(self, chat_id, text, **kw):
        self.sent.append({"chat_id": chat_id, "text": text, **kw})


class Msg:
    def __init__(self):
        self.sent = []

    async def reply_text(self, text, **kw):
        self.sent.append(text)


class Query:
    def __init__(self, data):
        self.data = data
        self.edits = []
        self.answers = []

    async def answer(self, text=None, show_alert=False, **kw):
        self.answers.append((text, show_alert))

    async def edit_message_text(self, text, **kw):
        self.edits.append(text)


def _tg():
    return random.randint(10**9, 10**10)


def _user(name="U"):
    tg = _tg()
    return tg, bot.repo.auto_register_telegram_user(tg, name)


def _ws(owner_id, name="WS"):
    return bot.repo.create_shared_list(name, owner_id)["id"]


def _invite_cmd(owner_tg, list_id, target_tg, fake):
    msg = Msg()
    update = SimpleNamespace(message=msg, effective_user=SimpleNamespace(id=owner_tg, full_name="Owner", username="o"))
    ctx = SimpleNamespace(args=[str(list_id), f"@{target_tg}"], user_data={}, bot=fake)
    asyncio.run(bot.cmd_invite(update, ctx))
    return msg


def _press(tg, data, fake=None):
    q = Query(data)
    update = SimpleNamespace(callback_query=q, effective_user=SimpleNamespace(id=tg, full_name="X", username="x"))
    ctx = SimpleNamespace(user_data={}, bot=fake or FakeBot())
    asyncio.run(bot.handle_callback(update, ctx))
    return q


def _setup(name="WS"):
    otg, owner = _user("Owner")
    itg, invitee = _user("Invitee")
    lid = _ws(owner, name)
    fake = FakeBot()
    return otg, owner, itg, invitee, lid, fake


def _pending(lid, invitee):
    return bot.repo.list_pending_invitations_for_user(invitee)


def test_cmd_invite_creates_pending(monkeypatch):
    monkeypatch.setattr(bot, "ALLOWED_USER_IDS", [])
    otg, owner, itg, invitee, lid, fake = _setup(X)
    msg = _invite_cmd(otg, lid, itg, fake)
    assert msg.sent == [f"📨 Undangan dikirim ke @{itg}. Menunggu persetujuan."]
    assert not bot.repo.is_list_member_or_owner(lid, invitee)
    inv = _pending(lid, invitee)
    assert len(inv) == 1
    assert len(fake.sent) == 1
    s = fake.sent[0]
    assert s["chat_id"] == itg and "<x>" not in s["text"] and XE in s["text"]
    cbs = [b.callback_data for row in s["reply_markup"].inline_keyboard for b in row]
    assert cbs == [f"inv_acc_{inv[0]['id']}", f"inv_dec_{inv[0]['id']}"]


def test_cmd_invite_duplicate_message(monkeypatch):
    monkeypatch.setattr(bot, "ALLOWED_USER_IDS", [])
    otg, owner, itg, invitee, lid, fake = _setup()
    _invite_cmd(otg, lid, itg, fake)
    msg = _invite_cmd(otg, lid, itg, fake)
    assert msg.sent == [f"Undangan untuk @{itg} sudah dikirim."]
    assert len(_pending(lid, invitee)) == 1
    assert len(fake.sent) == 1


def _make_inv(monkeypatch, name="WS"):
    monkeypatch.setattr(bot, "ALLOWED_USER_IDS", [])
    otg, owner, itg, invitee, lid, fake = _setup(name)
    _invite_cmd(otg, lid, itg, fake)
    inv_id = _pending(lid, invitee)[0]["id"]
    return otg, owner, itg, invitee, lid, inv_id


def test_callback_accept_by_invitee(monkeypatch):
    otg, owner, itg, invitee, lid, inv_id = _make_inv(monkeypatch, X)
    q = _press(itg, f"inv_acc_{inv_id}")
    assert q.edits == [f"✅ Bergabung ke <b>{XE}</b>"]
    assert bot.repo.is_list_member_or_owner(lid, invitee)


def test_callback_decline(monkeypatch):
    otg, owner, itg, invitee, lid, inv_id = _make_inv(monkeypatch)
    q = _press(itg, f"inv_dec_{inv_id}")
    assert q.edits == ["Undangan ditolak"]
    assert not bot.repo.is_list_member_or_owner(lid, invitee)


def test_callback_wrong_user(monkeypatch):
    otg, owner, itg, invitee, lid, inv_id = _make_inv(monkeypatch)
    xtg, _ = _user("Other")
    q = _press(xtg, f"inv_acc_{inv_id}")
    assert q.edits == []
    assert q.answers == [("Undangan ini bukan untukmu", True)]
    assert not bot.repo.is_list_member_or_owner(lid, invitee)
    assert len(_pending(lid, invitee)) == 1


def test_callback_after_app_accept(monkeypatch):
    otg, owner, itg, invitee, lid, inv_id = _make_inv(monkeypatch)
    bot.repo.respond_workspace_invitation(inv_id, invitee, True)
    q = _press(itg, f"inv_acc_{inv_id}")
    assert q.edits == ["Undangan ini sudah tidak berlaku"]


def test_callback_expired(monkeypatch):
    otg, owner, itg, invitee, lid, inv_id = _make_inv(monkeypatch)
    conn = db()
    conn.execute("UPDATE workspace_invitations SET created_at = '2000-01-01T00:00:00' WHERE id = ?", (inv_id,))
    conn.commit()
    conn.close()
    q = _press(itg, f"inv_acc_{inv_id}")
    assert q.edits == ["Undangan ini sudah tidak berlaku"]


def test_callback_missing_invitation(monkeypatch):
    monkeypatch.setattr(bot, "ALLOWED_USER_IDS", [])
    tg, _ = _user()
    q = _press(tg, "inv_acc_99999999")
    assert q.edits == ["Undangan ini sudah tidak berlaku"]
