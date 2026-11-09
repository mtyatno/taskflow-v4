"""Bot Telegram: checklist bertingkat di /view, tombol centang, dan hapus (spec §8; rencana PR A T8, R9).

Helper murni dipanggil langsung; handler dipanggil dengan update/query palsu (pola `test_bot_escape.py`)
memakai `bot.repo` yang menunjuk DB tes (conftest men-set DB_PATH sebelum impor)."""
import asyncio
from types import SimpleNamespace

import pytest

import bot
import repository
from models import GTDStatus, Priority, Task
from test_contexts_tasks import U, _mk

X = "<x>&"
XE = "&lt;x&gt;&amp;"


def _s(id, title, done=False, depth=None):
    s = {"id": id, "task_id": 7, "title": title, "is_done": done, "sort_order": 0}
    if depth is not None:
        s["depth"] = depth
        s["parent_id"] = None if depth == 0 else id - 1
    return s


def _tiga_tingkat():
    """A (selesai) ─ A1 (selesai, <x>&) ─ A11 (selesai); B; C ─ C1."""
    return [_s(1, "A", True, 0), _s(2, X, True, 1), _s(3, "A11", True, 2),
            _s(4, "B", False, 0), _s(5, "C", False, 0), _s(6, "C1", False, 1)]


def _lama(subtasks):
    """Format pesan checklist SEBELUM PR A (daftar datar) — acuan regresi tingkat 0."""
    done_count = sum(1 for s in subtasks if s["is_done"])
    total = len(subtasks)
    filled = round(done_count / total * 10)
    text = f"\n\n📝 <b>Subtasks</b>  {done_count}/{total}\n<code>{'█' * filled + '░' * (10 - filled)}</code>\n"
    for s in subtasks:
        icon = "☑️" if s["is_done"] else "☐"
        strike = f"<s>{bot.h(s['title'])}</s>" if s["is_done"] else bot.h(s["title"])
        text += f"\n  {icon} {strike}"
    return text


def _labels(rows):
    return [[(b.text, b.callback_data) for b in row] for row in rows]


# ── Pesan /view ─────────────────────────────────────────────────────────────

def test_pesan_judul_hitungan_level_atas_dan_indentasi_sub_butir():
    text = bot._checklist_lines(_tiga_tingkat())
    assert "📝 <b>Subtasks</b>  1/3\n" in text
    assert "<code>███░░░░░░░</code>" in text   # bar 1/3 dari level atas
    assert text.split("</code>\n", 1)[1] == (
        "\n  ☑️ <s>A</s>"
        f"\n    ↳ ☑️ <s>{XE}</s>"
        "\n      ↳ ☑️ <s>A11</s>"
        "\n  ☐ B"
        "\n  ☐ C"
        "\n    ↳ ☐ C1"
    )
    assert "<x>" not in text


def test_pesan_2_level_atas_1_selesai_2_sub_selesai_judul_1_per_2():
    subs = [_s(1, "A", True, 0), _s(2, "A1", True, 1), _s(3, "A11", True, 2), _s(4, "B", False, 0)]
    text = bot._checklist_lines(subs)
    assert "1/2" in text and "3/4" not in text
    assert "\n    ↳ ☑️ <s>A1</s>" in text and "\n      ↳ ☑️ <s>A11</s>" in text


def test_pesan_dict_tanpa_depth_sama_persis_dengan_format_lama():
    flat = [_s(1, X, True), _s(2, "b", False), _s(3, "c", True)]
    assert bot._checklist_lines(flat) == _lama(flat)
    lvl0 = [_s(1, X, True, 0), _s(2, "b", False, 0)]
    assert bot._checklist_lines(lvl0) == _lama(lvl0)


def test_pesan_kosong_tanpa_bagian_checklist():
    assert bot._checklist_lines([]) == ""


def test_build_view_message_memakai_checklist_lines():
    t = Task(id=7, title="t", priority=Priority.P2, gtd_status=GTDStatus.INBOX)
    subs = _tiga_tingkat()
    assert bot._checklist_lines(subs) in bot._build_view_message(t, subs)


# ── Tombol ──────────────────────────────────────────────────────────────────

def test_tombol_centang_sub_butir_diawali_panah_callback_tetap_2_per_baris():
    rows = bot._checklist_toggle_rows(_tiga_tingkat(), 7)
    assert _labels(rows) == [
        [("☑️ A", "togsub_1_7"), ("↳ ☑️ <x>&", "togsub_2_7")],
        [("↳ ☑️ A11", "togsub_3_7"), ("☐ B", "togsub_4_7")],
        [("☐ C", "togsub_5_7"), ("↳ ☐ C1", "togsub_6_7")],
    ]


def test_tombol_centang_dict_tanpa_depth_seperti_dulu():
    rows = bot._checklist_toggle_rows([_s(1, "x" * 30, False), _s(2, "b", True), _s(3, "c")], 9)
    assert _labels(rows) == [[("☐ " + "x" * 20, "togsub_1_9"), ("☑️ b", "togsub_2_9")],
                             [("☐ c", "togsub_3_9")]]


def test_build_view_buttons_memakai_baris_centang():
    t = Task(id=7, title="t", priority=Priority.P2, gtd_status=GTDStatus.INBOX)
    subs = _tiga_tingkat()
    markup = bot._build_view_buttons(t, subs)
    expected = _labels(bot._checklist_toggle_rows(subs, 7))
    got = _labels(markup.inline_keyboard)
    assert all(row in got for row in expected)


def test_tombol_hapus_butir_berturunan_berakhiran_jumlah_sub():
    rows = bot._delsub_buttons(_tiga_tingkat(), 7)
    assert _labels(rows) == [
        [("🗑 A (+2 sub)", "delsub_1_7")],
        [("🗑 <x>& (+1 sub)", "delsub_2_7")],
        [("🗑 A11", "delsub_3_7")],
        [("🗑 B", "delsub_4_7")],
        [("🗑 C (+1 sub)", "delsub_5_7")],
        [("🗑 C1", "delsub_6_7")],
    ]


def test_tombol_hapus_tiga_turunan():
    subs = [_s(1, "induk", False, 0), _s(2, "a", False, 1), _s(3, "b", False, 2), _s(4, "c", False, 1),
            _s(5, "lain", False, 0)]
    assert _labels(bot._delsub_buttons(subs, 3))[0] == [("🗑 induk (+3 sub)", "delsub_1_3")]


# ── Handler (DB tes nyata) ──────────────────────────────────────────────────

class _Msg:
    def __init__(self, text=""):
        self.text = text
        self.sent = []

    async def reply_text(self, text, **kw):
        self.sent.append((text, kw))


class _Query:
    def __init__(self, data):
        self.data = data
        self.answers = []
        self.edits = []

    async def answer(self, text=None, **kw):
        self.answers.append(text)

    async def edit_message_text(self, text, **kw):
        self.edits.append((text, kw))


@pytest.fixture
def pengguna(client, monkeypatch):
    u = U(client, "bt")
    monkeypatch.setattr(bot, "ALLOWED_USER_IDS", [])
    monkeypatch.setattr(bot, "_resolve_user_id", lambda tg: u.id)
    return u


def _update(**kw):
    return SimpleNamespace(effective_user=SimpleNamespace(id=1, full_name="A", username="u"), **kw)


def _cmd_sub(args):
    msg = _Msg()
    asyncio.run(bot.cmd_sub(_update(message=msg), SimpleNamespace(args=args, user_data={})))
    return msg.sent


def _callback(data):
    q = _Query(data)
    asyncio.run(bot.handle_callback(_update(callback_query=q), SimpleNamespace(user_data={})))
    return q


def test_sub_menampilkan_hitungan_level_atas(pengguna):
    tid = _mk(pengguna, title="bot")["id"]
    a = bot.repo.add_subtask(tid, "a")["id"]
    bot.repo.add_subtask(tid, "a1", parent_id=a)
    bot.repo.toggle_subtask(a)
    sent = _cmd_sub([str(tid), "baru", "<b>"])
    assert len(sent) == 1
    text = sent[0][0]
    assert "📝 Subtasks: 1/2" in text and "☐ baru &lt;b&gt;" in text


def test_sub_checklisterror_dibalas_tanpa_crash(pengguna, monkeypatch):
    tid = _mk(pengguna, title="bot")["id"]

    def gagal(*a, **kw):
        raise repository.ChecklistError("EMPTY_TITLE")

    monkeypatch.setattr(bot.repo, "add_subtask", gagal)
    assert [t for t, _ in _cmd_sub([str(tid), "x"])] == ["❌ Judul subtask tidak boleh kosong."]


def test_input_teks_subtask_checklisterror_dibalas_tanpa_crash(pengguna, monkeypatch):
    tid = _mk(pengguna, title="bot")["id"]

    def gagal(*a, **kw):
        raise repository.ChecklistError("EMPTY_TITLE")

    monkeypatch.setattr(bot.repo, "add_subtask", gagal)
    msg = _Msg("judul")
    ctx = SimpleNamespace(user_data={"waiting_subtask_for": tid})
    asyncio.run(bot.handle_text_input(_update(message=msg), ctx))
    assert [t for t, _ in msg.sent] == ["❌ Judul subtask tidak boleh kosong."]
    assert "waiting_subtask_for" not in ctx.user_data


def test_input_teks_subtask_menambah_level_atas(pengguna):
    tid = _mk(pengguna, title="bot")["id"]
    msg = _Msg("dari teks")
    asyncio.run(bot.handle_text_input(_update(message=msg), SimpleNamespace(user_data={"waiting_subtask_for": tid})))
    assert [(s["title"], s["depth"]) for s in bot.repo.get_subtasks(tid)] == [("dari teks", 0)]
    assert "📝 <b>Subtasks</b>  0/1" in msg.sent[0][0]


def test_callback_centang_induk_berantai_dan_pesan_berindentasi(pengguna):
    tid = _mk(pengguna, title="bot")["id"]
    a = bot.repo.add_subtask(tid, "A")["id"]
    a1 = bot.repo.add_subtask(tid, "A1", parent_id=a)["id"]
    bot.repo.add_subtask(tid, "A11", parent_id=a1)
    bot.repo.add_subtask(tid, "B")
    q = _callback(f"togsub_{a}_{tid}")
    assert all(s["is_done"] for s in bot.repo.get_subtasks(tid) if s["title"] != "B")
    text, kw = q.edits[-1]
    assert "📝 <b>Subtasks</b>  1/2" in text
    assert "\n    ↳ ☑️ <s>A1</s>" in text and "\n      ↳ ☑️ <s>A11</s>" in text
    labels = [b.text for row in kw["reply_markup"].inline_keyboard for b in row]
    assert "↳ ☑️ A1" in labels and "↳ ☑️ A11" in labels


def test_callback_mode_hapus_memakai_tombol_hapus_dan_hapus_berantai(pengguna):
    tid = _mk(pengguna, title="bot")["id"]
    a = bot.repo.add_subtask(tid, "A")["id"]
    a1 = bot.repo.add_subtask(tid, "A1", parent_id=a)["id"]
    bot.repo.add_subtask(tid, "A11", parent_id=a1)
    b = bot.repo.add_subtask(tid, "B")["id"]
    q = _callback(f"delsub_mode_{tid}")
    rows = _labels(q.edits[-1][1]["reply_markup"].inline_keyboard)
    assert rows[:-1] == _labels(bot._delsub_buttons(bot.repo.get_subtasks(tid), tid))
    assert rows[0] == [("🗑 A (+2 sub)", f"delsub_{a}_{tid}")]
    assert rows[-1] == [("⬅️ Kembali", f"viewrefresh_{tid}")]
    _callback(f"delsub_{a}_{tid}")
    assert [s["id"] for s in bot.repo.get_subtasks(tid)] == [b]
