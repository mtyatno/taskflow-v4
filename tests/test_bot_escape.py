"""Bot Telegram (ParseMode.HTML): nilai pengguna di-escape lewat helper h(); markup template tetap.

Spec: docs/superpowers/specs/2026-10-19-xss-hardening-design.md §4. Pembentuk pesan dipanggil langsung
(tanpa Telegram); handler dipanggil dengan update/bot palsu yang menangkap teks terkirim.
"""
import asyncio
from types import SimpleNamespace

import bot
from models import Task, Priority, GTDStatus
from nlp import format_confirmation

X = "<x>&"
XE = "&lt;x&gt;&amp;"


def test_bot_h_escapes():
    assert bot.h("<b>&") == "&lt;b&gt;&amp;"
    assert bot.h(None) == ""
    assert bot.h(5) == "5"
    assert bot.h('"q"') == '"q"'  # quote=False


def _task():
    return Task(id=7, title=X, project=X, context=X, description=X, waiting_for=X,
                priority=Priority.P2, gtd_status=GTDStatus.INBOX)


def test_task_cards_escape_user_fields():
    t = _task()
    for text in (t.format_detail(), t.format_short()):
        assert "<x>" not in text
        assert XE in text
        assert "<b>" in text  # template markup tetap


def test_view_message_escapes_subtasks_notes_attachments():
    t = _task()
    text = bot._build_view_message(
        t,
        [{"id": 1, "title": X, "is_done": 1}, {"id": 2, "title": X, "is_done": 0}],
        notes=[{"created_at": "2026-10-19T10:00:00", "content": X}],
        attachments=[{"id": 1, "original_name": X, "file_size": 10}],
    )
    assert "<x>" not in text
    assert text.count(XE) >= 7
    assert "<s>" in text and "<i>" in text


def test_nlp_confirmation_escapes_title_and_project():
    parsed = {"title": X, "project": X, "context": X, "deadline": None, "quadrant_label": "Q1",
              "urgent": True, "important": True, "gtd_status": "inbox"}
    text = format_confirmation(parsed)
    assert "<x>" not in text and XE in text
    assert "<i>Simpan task ini?</i>" in text


class _Msg:
    def __init__(self):
        self.sent = []

    async def reply_text(self, text, **kw):
        self.sent.append((text, kw.get("parse_mode")))


def test_send_long_and_list_titles_escape(monkeypatch):
    t = _task()
    text = bot.format_task_list([t], "📋 <b>LIST</b>")
    assert "<x>" not in text and XE in text
    msg = _Msg()
    asyncio.run(bot.send_long(SimpleNamespace(message=msg), text))
    assert msg.sent and "<x>" not in msg.sent[0][0]


def test_shared_list_and_invite_handlers_escape(monkeypatch):
    sent = []

    class FakeBot:
        async def send_message(self, chat_id, text, **kw):
            sent.append(text)

    lst = {"id": 3, "name": X, "owner_id": 1}
    monkeypatch.setattr(bot, "ALLOWED_USER_IDS", [])
    monkeypatch.setattr(bot, "_resolve_user_id", lambda tg: 1)
    monkeypatch.setattr(bot.repo, "get_shared_list", lambda i: lst)
    monkeypatch.setattr(bot.repo, "get_user_by_username",
                        lambda u: {"id": 2, "display_name": X, "telegram_id": 55})
    monkeypatch.setattr(bot.repo, "is_list_member_or_owner", lambda l, u: False)
    monkeypatch.setattr(bot.repo, "create_workspace_invitation",
                        lambda l, i, t: {"id": 9, "list_id": l})
    msg = _Msg()
    update = SimpleNamespace(
        message=msg,
        effective_user=SimpleNamespace(id=1, full_name=X, username="u"),
    )
    context = SimpleNamespace(args=["3", "@b"], user_data={}, bot=FakeBot())
    asyncio.run(bot.cmd_invite(update, context))
    assert msg.sent and sent
    for text in [t for t, _ in msg.sent] + sent:
        assert "<x>" not in text, text
    assert all(XE in t for t in sent)  # DM ke penerima memuat nama workspace ter-escape


def test_deletelist_confirmation_says_tasks_return_to_creator(monkeypatch):
    lst = {"id": 3, "name": X, "owner_id": 1}
    monkeypatch.setattr(bot, "ALLOWED_USER_IDS", [])
    monkeypatch.setattr(bot, "_resolve_user_id", lambda tg: 1)
    monkeypatch.setattr(bot.repo, "get_shared_list", lambda i: lst)
    msg = _Msg()
    update = SimpleNamespace(
        message=msg,
        effective_user=SimpleNamespace(id=1, full_name="A", username="u"),
    )
    context = SimpleNamespace(args=["3"], user_data={})
    asyncio.run(bot.cmd_deletelist(update, context))
    assert msg.sent
    text = msg.sent[0][0]
    assert "Hapus workspace <b>" + XE + "</b>?" in text
    assert "Task akan kembali menjadi task pribadi pembuatnya" in text
    assert "berkas dan chat workspace dihapus permanen" in text
    assert "ikut terhapus" not in text and "shared list" not in text.lower()
