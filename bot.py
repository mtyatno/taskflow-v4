"""
TaskFlow V4 - Telegram Bot

Commands:
  /start          - Welcome & help
  /help           - Command reference
  /add            - Add new task (interactive)
  /quick          - Quick add: /quick <title>
  /view <id>      - View task detail
  /edit <id>      - Edit a task
  /delete <id>    - Delete a task

  GTD Workflow:
  /inbox          - Show inbox items
  /next           - Show next actions
  /waiting        - Show waiting-for items
  /someday        - Show someday/maybe
  /projects       - Show all projects
  /done           - Mark task(s) done
  /process        - Process inbox → assign GTD status

  Filtering & Views:
  /list           - Multi-filter list
  /overdue        - Show overdue tasks
  /today          - Today's focus (Q1 + overdue)
  /q1 /q2 /q3 /q4 - Show by Eisenhower quadrant

  Review:
  /summary        - Dashboard summary
  /review         - Weekly review helper
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, date, time as dtime
from pathlib import Path

import pytz

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, BotCommand
from telegram.constants import ParseMode
from telegram.ext import (
    Application,
    CommandHandler,
    CallbackQueryHandler,
    ConversationHandler,
    MessageHandler,
    filters,
    ContextTypes,
)

from config import (
    TELEGRAM_BOT_TOKEN, ALLOWED_USER_IDS, EISENHOWER_INTERVAL_MINUTES,
    TIMEZONE, DAILY_SUMMARY_HOUR, DAILY_SUMMARY_MINUTE,
    WEEKLY_REVIEW_DAY, WEEKLY_REVIEW_HOUR, WEEKLY_REVIEW_MINUTE,
    UPLOAD_DIR, MAX_FILE_SIZE, WEBAPP_URL,
)
from models import Task, GTDStatus, Priority, Quadrant
from repository import TaskRepository
from eisenhower import calculate_quadrant, recalculate_all
from datehelper import parse_date, format_date
from nlp import parse_task, format_confirmation, parse_query

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger("taskflow")

# ── Repository singleton ──────────────────────────────────────────────────────
repo = TaskRepository()

# ── Ensure upload dir exists ─────────────────────────────────────────────────
os.makedirs(UPLOAD_DIR, exist_ok=True)

# ── Conversation states ───────────────────────────────────────────────────────
(
    ADD_TITLE,
    ADD_PRIORITY,
    ADD_PROJECT,
    ADD_CONTEXT,
    ADD_DEADLINE,
    ADD_DESCRIPTION,
    EDIT_CHOOSE,
    EDIT_VALUE,
    PROCESS_CHOOSE,
) = range(9)


# ── Auth decorator (with auto user resolution) ────────────────────────────────
def _resolve_user_id(tg_user) -> int:
    """Resolve Telegram user → database user_id. Auto-registers if new."""
    user = repo.get_user_by_telegram_id(tg_user.id)
    if user:
        return user["id"]
    display_name = tg_user.full_name or tg_user.username or str(tg_user.id)
    return repo.auto_register_telegram_user(tg_user.id, display_name)


def uid(context: ContextTypes.DEFAULT_TYPE) -> int:
    """Get the database user_id from context."""
    return context.user_data.get("db_user_id")


def authorized(func):
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE):
        tg_id = update.effective_user.id
        if ALLOWED_USER_IDS and tg_id not in ALLOWED_USER_IDS:
            await update.message.reply_text("⛔ Unauthorized.")
            return
        context.user_data["db_user_id"] = _resolve_user_id(update.effective_user)
        return await func(update, context)
    return wrapper


def authorized_callback(func):
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE):
        tg_id = update.effective_user.id
        if ALLOWED_USER_IDS and tg_id not in ALLOWED_USER_IDS:
            await update.callback_query.answer("⛔ Unauthorized.")
            return
        context.user_data["db_user_id"] = _resolve_user_id(update.effective_user)
        return await func(update, context)
    return wrapper


# ── Helpers ────────────────────────────────────────────────────────────────────

def paginate(tasks: list[Task], page: int = 0, per_page: int = 10) -> tuple[list[Task], int]:
    total_pages = max(1, (len(tasks) + per_page - 1) // per_page)
    page = max(0, min(page, total_pages - 1))
    start = page * per_page
    return tasks[start : start + per_page], total_pages


def format_task_list(tasks: list[Task], title: str, page: int = 0) -> str:
    if not tasks:
        return f"{title}\n\n📭  Tidak ada task."
    
    page_tasks, total_pages = paginate(tasks, page)
    lines = [title, ""]
    for i, t in enumerate(page_tasks):
        lines.append(t.format_short())
        lines.append("")  # blank line between tasks
    lines.append(f"── {len(tasks)} task(s)")
    if total_pages > 1:
        lines.append(f"📄  Hal {page + 1}/{total_pages}")
    return "\n".join(lines)


async def send_long(update: Update, text: str, **kwargs):
    """Send messages, splitting if too long for Telegram."""
    max_len = 4000
    if len(text) <= max_len:
        await update.message.reply_text(text, parse_mode=ParseMode.HTML, **kwargs)
    else:
        parts = []
        while text:
            if len(text) <= max_len:
                parts.append(text)
                break
            cut = text.rfind("\n", 0, max_len)
            if cut == -1:
                cut = max_len
            parts.append(text[:cut])
            text = text[cut:].lstrip("\n")
        for part in parts:
            await update.message.reply_text(part, parse_mode=ParseMode.HTML, **kwargs)


# ══════════════════════════════════════════════════════════════════════════════
#  COMMANDS
# ══════════════════════════════════════════════════════════════════════════════

# ── /start, /help ──────────────────────────────────────────────────────────────

@authorized
async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = """⚡ <b>TaskFlow V4</b>
<i>GTD + Eisenhower + Priority + Pomodoro</i>

Selamat datang! TaskFlow membantu mengelola task dengan:

🔄 <b>GTD</b> — inbox → next/waiting/someday → done
🎯 <b>Priority</b> — P1 (critical) → P4 (low)
📊 <b>Eisenhower</b> — Q1-Q4 (auto-calculated)
🍅 <b>Pomodoro</b> — Timer fokus di web app

<b>Fitur Lengkap:</b>
📝 Subtask &amp; checklist per task
📓 Catatan / log kerja
📎 Lampiran file &amp; gambar
📁 Project &amp; context grouping
🌐 Web app: <b>todo.yatno.web.id</b>

Ketik /help untuk daftar command lengkap."""
    await update.message.reply_text(text, parse_mode=ParseMode.HTML)


@authorized
async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = """━━━━━━━━━━━━━━━━━━━━
  ⚡ <b>TASKFLOW V4 — HELP</b>
━━━━━━━━━━━━━━━━━━━━

<b>➕ Tambah Task</b>
💬 <b>Ketik bebas</b> — Bot akan mendeteksi otomatis!
  <i>contoh:</i> <code>Meeting klien besok p2 #freelance</code>
  <i>contoh:</i> <code>Kirim laporan minggu depan, penting</code>
/add — Interactive step-by-step
/quick &lt;judul&gt; — Satu baris langsung jadi
  <i>contoh:</i> <code>/quick Kirim invoice p1 #freelance dl:besok</code>
  <i>flags:</i> <code>p1-p4</code>  <code>#project</code>  <code>@context</code>  <code>dl:tanggal</code>

<b>📋 Lihat &amp; Kelola</b>
/view &lt;id&gt; — Detail task + subtask + catatan + lampiran
/edit &lt;id&gt; — Ubah field task
/delete &lt;id&gt; — Hapus task
/done &lt;id&gt; — Tandai selesai (multi: <code>/done 1 2 3</code>)

<b>📝 Subtask &amp; Catatan</b>
/sub &lt;id&gt; &lt;judul&gt; — Tambah subtask
/note &lt;id&gt; &lt;teks&gt; — Tambah catatan
📎 Lampiran — via tombol di /view

<b>🔄 GTD Workflow</b>
/inbox · /next · /waiting · /someday
/projects — Daftar project aktif
/process — Proses inbox satu per satu

<b>📊 Eisenhower Matrix</b>
/q1 🔥 Do · /q2 📅 Plan · /q3 👋 Dele · /q4 🗑 Drop

<b>🔍 Filter /list</b>
/list — Semua task aktif
/list p1 — Filter priority
/list q1 — Filter quadrant
/list next — Filter GTD status
/list #project — Filter per project
/list @context — Filter per context
/list p1 next #work — Kombinasi filter
/list done — Lihat yang sudah selesai

<b>📈 Review &amp; Dashboard</b>
/summary — Dashboard visual + statistik
/review — Weekly review + health check
/overdue — Task melewati deadline
/today — 🍅 Fokus hari ini + Pomodoro (web)

<b>🔗 Sync &amp; Web App</b>
/link &lt;user&gt; &lt;pass&gt; — Hubungkan ke akun web
/link — Cek status koneksi
🌐 Web: <b>todo.yatno.web.id</b>
<i>Task, subtask, catatan, lampiran sync otomatis!</i>

<b>⏰ Notifikasi Otomatis</b>
📬 Daily summary — setiap pagi jam 7
📝 Weekly review — setiap Jumat jam 17"""
    await update.message.reply_text(text, parse_mode=ParseMode.HTML)


# ── /link (connect Telegram to web account) ────────────────────────────────────

@authorized
async def cmd_link(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if len(context.args) < 2:
        # Check current status
        tg_id = update.effective_user.id
        user = repo.get_user_by_telegram_id(tg_id)
        if user:
            uname = user["username"]
            dname = user["display_name"]
            is_auto = uname.startswith("tg_")
            if is_auto:
                await update.message.reply_text(
                    f"🔗 Telegram kamu terhubung ke akun otomatis: <b>{dname}</b>\n\n"
                    "Untuk sync dengan akun web, jalankan:\n"
                    "<code>/link username_web password_web</code>",
                    parse_mode=ParseMode.HTML,
                )
            else:
                await update.message.reply_text(
                    f"✅ Telegram kamu sudah terhubung ke akun web: <b>{uname}</b> ({dname})\n"
                    "Task dari Telegram dan Web sudah sync!",
                    parse_mode=ParseMode.HTML,
                )
        return

    username = context.args[0]
    password = context.args[1]
    tg_id = update.effective_user.id

    try:
        linked_user_id = repo.link_telegram_to_web_user(tg_id, username, password)
        if linked_user_id:
            context.user_data["db_user_id"] = linked_user_id
            await update.message.reply_text(
                f"✅ Berhasil! Telegram terhubung ke akun web <b>{username}</b>.\n"
                "Task dari Telegram dan Web sekarang sync! 🎉",
                parse_mode=ParseMode.HTML,
            )
        else:
            await update.message.reply_text("❌ Username atau password salah.")
    except ValueError as e:
        await update.message.reply_text(f"❌ {e}")


# ── /webapp (one-time magic login link) ───────────────────────────────────────

@authorized
async def cmd_webapp(update: Update, context: ContextTypes.DEFAULT_TYPE):
    token = repo.create_magic_token(uid(context), expire_minutes=5)
    link = f"{WEBAPP_URL}/auth/magic?token={token}"
    await update.message.reply_text(
        f"🌐 <b>Login ke TaskFlow WebApp</b>\n\n"
        f'<a href="{link}">👉 Klik di sini untuk masuk</a>\n\n'
        f"⚠️ Link hanya bisa digunakan <b>sekali</b> dan expired dalam <b>5 menit</b>.\n"
        f"Kirim /webapp lagi jika butuh link baru.",
        parse_mode=ParseMode.HTML,
        disable_web_page_preview=True,
    )


# ── /claim (assign orphan tasks) ──────────────────────────────────────────────

@authorized
async def cmd_claim(update: Update, context: ContextTypes.DEFAULT_TYPE):
    count = repo.assign_orphan_tasks(uid(context))
    if count > 0:
        await update.message.reply_text(
            f"✅ {count} task tanpa owner berhasil diassign ke akun kamu.",
            parse_mode=ParseMode.HTML,
        )
    else:
        await update.message.reply_text("📭 Tidak ada task tanpa owner.")


# ── /quick ─────────────────────────────────────────────────────────────────────

@authorized
async def cmd_quick(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text(
            "💡 Usage: <code>/quick Beli groceries</code>\n"
            "Optional flags: <code>p1-p4</code> <code>@context</code> <code>#project</code> <code>dl:tanggal</code>\n\n"
            "Contoh:\n<code>/quick Kirim invoice p1 @computer #freelance dl:besok</code>",
            parse_mode=ParseMode.HTML,
        )
        return

    raw = " ".join(context.args)
    priority = Priority.P3
    project = ""
    ctx = ""
    deadline = None

    # Extract flags
    tokens = raw.split()
    title_tokens = []
    for tok in tokens:
        tok_lower = tok.lower()
        if tok_lower in ("p1", "p2", "p3", "p4"):
            priority = Priority.from_str(tok_lower)
        elif tok.startswith("#"):
            project = tok[1:]
        elif tok.startswith("@"):
            ctx = tok
        elif tok_lower.startswith("dl:"):
            dl_str = tok[3:]
            deadline = parse_date(dl_str)
        else:
            title_tokens.append(tok)

    title = " ".join(title_tokens).strip()
    if not title:
        await update.message.reply_text("❌ Judul task tidak boleh kosong.")
        return

    task = Task(
        title=title,
        priority=priority,
        project=project,
        context=ctx,
        deadline=deadline,
        gtd_status=GTDStatus.INBOX,
    )
    task.quadrant = calculate_quadrant(task)
    task = repo.add(task, uid(context))

    text = f"✅ Task ditambahkan!\n\n{task.format_detail()}"
    await update.message.reply_text(text, parse_mode=ParseMode.HTML)


# ── /add (conversational) ─────────────────────────────────────────────────────

@authorized
async def cmd_add_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "📝 <b>Tambah Task Baru</b>\n\nKetik judul task:",
        parse_mode=ParseMode.HTML,
    )
    return ADD_TITLE


async def add_title(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data["new_title"] = update.message.text.strip()
    keyboard = [
        [
            InlineKeyboardButton("🔴 P1 Critical", callback_data="addp_P1"),
            InlineKeyboardButton("🟠 P2 High", callback_data="addp_P2"),
        ],
        [
            InlineKeyboardButton("🟡 P3 Medium", callback_data="addp_P3"),
            InlineKeyboardButton("🟢 P4 Low", callback_data="addp_P4"),
        ],
    ]
    await update.message.reply_text(
        "🎯 Pilih priority:", reply_markup=InlineKeyboardMarkup(keyboard)
    )
    return ADD_PRIORITY


async def add_priority_cb(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    pri = query.data.replace("addp_", "")
    context.user_data["new_priority"] = pri

    # Show active projects as buttons
    projects = repo.list_projects(uid(context))
    keyboard = []
    row = []
    for p in projects:
        row.append(InlineKeyboardButton(f"📁 {p}", callback_data=f"addproj_{p}"))
        if len(row) == 2:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)
    keyboard.append([InlineKeyboardButton("＋ Buat baru", callback_data="addproj___new__")])
    keyboard.append([InlineKeyboardButton("⏭️ Skip", callback_data="addproj___skip__")])

    await query.edit_message_text(
        f"🎯 Priority: <b>{pri}</b>\n\n"
        "📁 Pilih project:",
        parse_mode=ParseMode.HTML,
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    return ADD_PROJECT


async def add_project_cb(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    val = query.data.replace("addproj_", "")

    if val == "__new__":
        await query.edit_message_text(
            "📁 Ketik nama project baru:",
            parse_mode=ParseMode.HTML,
        )
        return ADD_PROJECT  # Wait for text input

    context.user_data["new_project"] = "" if val == "__skip__" else val
    return await _show_context_picker(query, context)


async def add_project_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text.strip()
    context.user_data["new_project"] = "" if text == "-" else text

    # Show context picker
    contexts_list = repo.list_contexts(uid(context))
    keyboard = []
    row = []
    for c in contexts_list:
        row.append(InlineKeyboardButton(c, callback_data=f"addctx_{c}"))
        if len(row) == 2:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)
    keyboard.append([InlineKeyboardButton("＋ Buat baru", callback_data="addctx___new__")])
    keyboard.append([InlineKeyboardButton("⏭️ Skip", callback_data="addctx___skip__")])

    await update.message.reply_text(
        "🏷️ Pilih context:",
        parse_mode=ParseMode.HTML,
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    return ADD_CONTEXT


async def _show_context_picker(query, context):
    """Helper to show context picker after project is selected."""
    contexts_list = repo.list_contexts(context.user_data.get("db_user_id"))
    keyboard = []
    row = []
    for c in contexts_list:
        row.append(InlineKeyboardButton(c, callback_data=f"addctx_{c}"))
        if len(row) == 2:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)
    keyboard.append([InlineKeyboardButton("＋ Buat baru", callback_data="addctx___new__")])
    keyboard.append([InlineKeyboardButton("⏭️ Skip", callback_data="addctx___skip__")])

    proj = context.user_data.get("new_project", "")
    proj_text = f"📁 Project: <b>{proj}</b>\n\n" if proj else ""

    await query.edit_message_text(
        f"{proj_text}🏷️ Pilih context:",
        parse_mode=ParseMode.HTML,
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    return ADD_CONTEXT


async def add_context_cb(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    val = query.data.replace("addctx_", "")

    if val == "__new__":
        await query.edit_message_text(
            "🏷️ Ketik context baru (misal <code>@phone</code>):",
            parse_mode=ParseMode.HTML,
        )
        return ADD_CONTEXT  # Wait for text input

    context.user_data["new_context"] = "" if val == "__skip__" else val

    await query.edit_message_text(
        "📅 Ketik deadline (contoh: <code>25-12-2026</code>, <code>besok</code>, <code>+3d</code>)\n"
        "Atau ketik <code>-</code> untuk tanpa deadline:",
        parse_mode=ParseMode.HTML,
    )
    return ADD_DEADLINE


async def add_context_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text.strip()
    context.user_data["new_context"] = "" if text == "-" else text
    await update.message.reply_text(
        "📅 Ketik deadline (contoh: <code>25-12-2026</code>, <code>besok</code>, <code>+3d</code>)\n"
        "Atau ketik <code>-</code> untuk tanpa deadline:",
        parse_mode=ParseMode.HTML,
    )
    return ADD_DEADLINE


async def add_deadline(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text.strip()
    if text == "-":
        context.user_data["new_deadline"] = None
    else:
        d = parse_date(text)
        if d is None:
            await update.message.reply_text("❌ Format tanggal tidak dikenali. Coba lagi:")
            return ADD_DEADLINE
        context.user_data["new_deadline"] = d

    await update.message.reply_text(
        "📝 Ketik deskripsi/catatan (atau <code>-</code> untuk skip):",
        parse_mode=ParseMode.HTML,
    )
    return ADD_DESCRIPTION


async def add_description(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text.strip()
    desc = "" if text == "-" else text

    ud = context.user_data
    task = Task(
        title=ud["new_title"],
        description=desc,
        priority=Priority.from_str(ud["new_priority"]),
        project=ud.get("new_project", ""),
        context=ud.get("new_context", ""),
        deadline=ud.get("new_deadline"),
        gtd_status=GTDStatus.INBOX,
    )
    task.quadrant = calculate_quadrant(task)
    task = repo.add(task, uid(context))

    await update.message.reply_text(
        f"✅ Task berhasil ditambahkan!\n\n{task.format_detail()}",
        parse_mode=ParseMode.HTML,
    )
    return ConversationHandler.END


async def add_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("❌ Dibatalkan.")
    return ConversationHandler.END


# ── /view ──────────────────────────────────────────────────────────────────────

def _build_view_message(task, subtasks, is_focused=False, notes=None, attachments=None):
    """Build task detail text with subtasks, notes, and attachments."""
    text = task.format_detail()
    if is_focused:
        text = "⭐ <b>FOKUS HARI INI</b>\n\n" + text

    if subtasks:
        done_count = sum(1 for s in subtasks if s["is_done"])
        total = len(subtasks)
        bar_len = 10
        filled = round(done_count / total * bar_len) if total > 0 else 0
        bar = "█" * filled + "░" * (bar_len - filled)

        text += f"\n\n📝 <b>Subtasks</b>  {done_count}/{total}\n"
        text += f"<code>{bar}</code>\n"
        for s in subtasks:
            icon = "☑️" if s["is_done"] else "☐"
            strike = f"<s>{s['title']}</s>" if s["is_done"] else s["title"]
            text += f"\n  {icon} {strike}"

    if notes:
        text += f"\n\n📓 <b>Catatan</b> ({len(notes)})\n"
        for n in notes:
            time_str = n["created_at"].split("T")[1][:5] if "T" in n["created_at"] else ""
            date_str = n["created_at"].split("T")[0] if "T" in n["created_at"] else ""
            # Show date only if not today
            from datetime import date as dt_date
            today = dt_date.today().isoformat()
            prefix = time_str if date_str == today else f"{date_str[5:]} {time_str}"
            text += f"\n  <i>{prefix}</i> — {n['content']}"

    if attachments:
        def _fmt_size(b):
            if b < 1024: return f"{b}B"
            if b < 1024*1024: return f"{b//1024}KB"
            return f"{b//(1024*1024)}MB"
        text += f"\n\n📎 <b>Lampiran</b> ({len(attachments)})\n"
        for a in attachments:
            text += f"\n  📄 {a['original_name']}  <i>({_fmt_size(a['file_size'])})</i>"

    return text


def _build_view_buttons(task, subtasks, is_focused=False, notes=None, attachments=None):
    """Build inline keyboard for task view with subtask, note, and attachment controls."""
    buttons = []

    # Focus toggle (top of buttons)
    if task.is_active:
        focus_label = "☆ Hapus dari Fokus" if is_focused else "⭐ Fokus Hari Ini"
        buttons.append([InlineKeyboardButton(focus_label, callback_data=f"togfocus_{task.id}")])

    # Subtask toggle buttons (2 per row)
    if subtasks:
        row = []
        for s in subtasks:
            icon = "☑️" if s["is_done"] else "☐"
            label = f"{icon} {s['title'][:20]}"
            row.append(InlineKeyboardButton(label, callback_data=f"togsub_{s['id']}_{task.id}"))
            if len(row) == 2:
                buttons.append(row)
                row = []
        if row:
            buttons.append(row)

    # Add subtask + Delete subtask row
    sub_actions = [InlineKeyboardButton("＋ Subtask", callback_data=f"addsub_{task.id}")]
    if subtasks:
        sub_actions.append(InlineKeyboardButton("🗑 Hapus subtask", callback_data=f"delsub_mode_{task.id}"))
    buttons.append(sub_actions)

    # Notes + Attach row
    note_count = len(notes) if notes else 0
    attach_count = len(attachments) if attachments else 0
    note_label = f"📓 Catatan ({note_count})" if note_count > 0 else "📓 + Catatan"
    attach_label = f"📎 + File"
    buttons.append([
        InlineKeyboardButton(note_label, callback_data=f"addnote_{task.id}"),
        InlineKeyboardButton(attach_label, callback_data=f"attach_{task.id}"),
    ])

    # Individual attachment download buttons
    if attachments:
        for a in attachments:
            name = a["original_name"][:25] + ("..." if len(a["original_name"]) > 25 else "")
            buttons.append([InlineKeyboardButton(f"📄 {name}", callback_data=f"dlatt_{a['id']}_{task.id}")])

    # Task action buttons
    if task.is_active:
        buttons.append([
            InlineKeyboardButton("✅ Done", callback_data=f"done_{task.id}"),
            InlineKeyboardButton("✏️ Edit", callback_data=f"editstart_{task.id}"),
        ])
        if task.gtd_status == GTDStatus.INBOX:
            buttons.append([
                InlineKeyboardButton("▶️ Next", callback_data=f"gtd_{task.id}_next"),
                InlineKeyboardButton("⏳ Waiting", callback_data=f"gtd_{task.id}_waiting"),
                InlineKeyboardButton("💭 Someday", callback_data=f"gtd_{task.id}_someday"),
            ])
    buttons.append([InlineKeyboardButton("🗑️ Delete task", callback_data=f"del_{task.id}")])

    return InlineKeyboardMarkup(buttons)


def _refresh_view_data(task_id):
    """Get all data needed to render task view."""
    subtasks = repo.get_subtasks(task_id)
    focused = repo.is_focused(task_id)
    notes = repo.get_notes(task_id)
    attachments = repo.get_attachments(task_id)
    return subtasks, focused, notes, attachments


@authorized
async def cmd_view(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args or not context.args[0].isdigit():
        await update.message.reply_text("💡 Usage: <code>/view 42</code>", parse_mode=ParseMode.HTML)
        return
    task = repo.get(int(context.args[0]), uid(context))
    if not task:
        await update.message.reply_text("❌ Task tidak ditemukan.")
        return

    subtasks, focused, notes, attachments = _refresh_view_data(task.id)
    text = _build_view_message(task, subtasks, focused, notes, attachments)
    markup = _build_view_buttons(task, subtasks, focused, notes, attachments)

    await update.message.reply_text(text, parse_mode=ParseMode.HTML, reply_markup=markup)


# ── /delete ────────────────────────────────────────────────────────────────────

@authorized
async def cmd_delete(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args or not context.args[0].isdigit():
        await update.message.reply_text("💡 Usage: <code>/delete 42</code>", parse_mode=ParseMode.HTML)
        return
    task_id = int(context.args[0])
    task = repo.get(task_id, uid(context))
    if not task:
        await update.message.reply_text("❌ Task tidak ditemukan.")
        return
    keyboard = [
        [
            InlineKeyboardButton("✅ Ya, hapus", callback_data=f"confirmdel_{task_id}"),
            InlineKeyboardButton("❌ Batal", callback_data="canceldel"),
        ]
    ]
    await update.message.reply_text(
        f"⚠️ Hapus task #{task_id}: <b>{task.title}</b>?",
        parse_mode=ParseMode.HTML,
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


# ── /done ──────────────────────────────────────────────────────────────────────

@authorized
async def cmd_done(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text(
            "💡 Usage: <code>/done 42</code> atau <code>/done 42 43 44</code>",
            parse_mode=ParseMode.HTML,
        )
        return

    results = []
    for arg in context.args:
        if not arg.isdigit():
            continue
        task = repo.get(int(arg), uid(context))
        if task and task.is_active:
            task.gtd_status = GTDStatus.DONE
            task.completed_at = datetime.now()
            repo.update(task)
            results.append(f"✅ #{task.id} {task.title}")
        else:
            results.append(f"❌ #{arg} tidak ditemukan / sudah selesai")

    await update.message.reply_text("\n".join(results), parse_mode=ParseMode.HTML)


# ── GTD status commands ────────────────────────────────────────────────────────

@authorized
async def cmd_inbox(update: Update, context: ContextTypes.DEFAULT_TYPE):
    tasks = repo.list_by_status(GTDStatus.INBOX, uid(context))
    text = format_task_list(tasks, "📥  <b>INBOX</b>")
    await send_long(update, text)

@authorized
async def cmd_next(update: Update, context: ContextTypes.DEFAULT_TYPE):
    tasks = repo.list_by_status(GTDStatus.NEXT, uid(context))
    text = format_task_list(tasks, "▶️  <b>NEXT ACTIONS</b>")
    await send_long(update, text)

@authorized
async def cmd_waiting(update: Update, context: ContextTypes.DEFAULT_TYPE):
    tasks = repo.list_by_status(GTDStatus.WAITING, uid(context))
    text = format_task_list(tasks, "⏳  <b>WAITING FOR</b>")
    await send_long(update, text)

@authorized
async def cmd_someday(update: Update, context: ContextTypes.DEFAULT_TYPE):
    tasks = repo.list_by_status(GTDStatus.SOMEDAY, uid(context))
    text = format_task_list(tasks, "💭  <b>SOMEDAY / MAYBE</b>")
    await send_long(update, text)


# ── /projects ──────────────────────────────────────────────────────────────────

@authorized
async def cmd_projects(update: Update, context: ContextTypes.DEFAULT_TYPE):
    projects = repo.list_projects(uid(context))
    if not projects:
        await update.message.reply_text("📁  Belum ada project aktif.")
        return

    lines = [
        "━━━━━━━━━━━━━━━━━━━━",
        "  📁  <b>ACTIVE PROJECTS</b>",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
    ]
    for i, proj in enumerate(projects):
        tasks = repo.list_by_project(proj, uid(context))
        pri_icon = {"P1": "🔴", "P2": "🟠", "P3": "🟡", "P4": "🟢"}

        lines.append(f"📂  <b>{proj}</b>  —  {len(tasks)} task(s)")
        lines.append("")
        for t in tasks[:5]:
            icon = pri_icon.get(t.priority.value, "⚪")
            overdue_tag = "  ⚠️" if t.is_overdue else ""
            lines.append(f"    {icon}  {t.title}{overdue_tag}")
            lines.append(f"        #{t.id}  ·  {t.priority.value}  ·  {t.quadrant.value}")
            lines.append("")
        if len(tasks) > 5:
            lines.append(f"    <i>+{len(tasks)-5} lagi → /list #{proj}</i>")
            lines.append("")
        if i < len(projects) - 1:
            lines.append("──────────────────")
            lines.append("")

    lines.append(f"── {len(projects)} project(s)")
    await send_long(update, "\n".join(lines))


# ── /process (inbox processing) ───────────────────────────────────────────────

@authorized
async def cmd_process(update: Update, context: ContextTypes.DEFAULT_TYPE):
    tasks = repo.list_by_status(GTDStatus.INBOX, uid(context))
    if not tasks:
        await update.message.reply_text("📥 Inbox kosong! 🎉")
        return

    task = tasks[0]
    context.user_data["process_task_id"] = task.id
    context.user_data["process_remaining"] = len(tasks) - 1

    keyboard = [
        [
            InlineKeyboardButton("▶️ Next Action", callback_data=f"proc_{task.id}_next"),
            InlineKeyboardButton("⏳ Waiting", callback_data=f"proc_{task.id}_waiting"),
        ],
        [
            InlineKeyboardButton("💭 Someday", callback_data=f"proc_{task.id}_someday"),
            InlineKeyboardButton("✅ Done", callback_data=f"proc_{task.id}_done"),
        ],
        [
            InlineKeyboardButton("🗑️ Delete", callback_data=f"proc_{task.id}_delete"),
            InlineKeyboardButton("⏭️ Skip", callback_data=f"proc_{task.id}_skip"),
        ],
    ]

    text = (
        f"📥 <b>Process Inbox</b> ({len(tasks)} remaining)\n\n"
        f"{task.format_detail()}\n\n"
        "Apa yang harus dilakukan dengan task ini?"
    )
    await update.message.reply_text(
        text, parse_mode=ParseMode.HTML, reply_markup=InlineKeyboardMarkup(keyboard)
    )


# ── Eisenhower quadrant commands ───────────────────────────────────────────────

@authorized
async def cmd_q1(update: Update, context: ContextTypes.DEFAULT_TYPE):
    tasks = repo.list_by_quadrant(Quadrant.Q1, uid(context))
    text = format_task_list(tasks, "🔥  <b>Q1 — DO</b>  Urgent + Important")
    await send_long(update, text)

@authorized
async def cmd_q2(update: Update, context: ContextTypes.DEFAULT_TYPE):
    tasks = repo.list_by_quadrant(Quadrant.Q2, uid(context))
    text = format_task_list(tasks, "📅  <b>Q2 — SCHEDULE</b>  Important")
    await send_long(update, text)

@authorized
async def cmd_q3(update: Update, context: ContextTypes.DEFAULT_TYPE):
    tasks = repo.list_by_quadrant(Quadrant.Q3, uid(context))
    text = format_task_list(tasks, "👋  <b>Q3 — DELEGATE</b>  Urgent")
    await send_long(update, text)

@authorized
async def cmd_q4(update: Update, context: ContextTypes.DEFAULT_TYPE):
    tasks = repo.list_by_quadrant(Quadrant.Q4, uid(context))
    text = format_task_list(tasks, "🗑  <b>Q4 — ELIMINATE</b>")
    await send_long(update, text)


# ── /overdue ───────────────────────────────────────────────────────────────────

@authorized
async def cmd_overdue(update: Update, context: ContextTypes.DEFAULT_TYPE):
    tasks = repo.list_overdue(uid(context))
    text = format_task_list(tasks, "⚠️  <b>OVERDUE</b>")
    await send_long(update, text)


# ── /today ─────────────────────────────────────────────────────────────────────

@authorized
async def cmd_today(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q1 = repo.list_by_quadrant(Quadrant.Q1, uid(context))
    overdue = repo.list_overdue(uid(context))

    # Merge and deduplicate
    seen_ids = set()
    focus = []
    for t in overdue + q1:
        if t.id not in seen_ids:
            focus.append(t)
            seen_ids.add(t.id)

    lines = [
        f"☀️  <b>FOKUS HARI INI</b>",
        f"     {date.today().strftime('%A, %d %B %Y')}",
        "",
    ]
    if not focus:
        lines.append("🎉  Tidak ada yang mendesak hari ini!")
    else:
        pri_icon = {"P1": "🔴", "P2": "🟠", "P3": "🟡", "P4": "🟢"}
        for t in focus:
            lines.append(t.format_short())
            lines.append("")
        lines.append(f"── {len(focus)} task(s) butuh perhatian")

    await send_long(update, "\n".join(lines))


# ── /list (multi-filter) ──────────────────────────────────────────────────────

@authorized
async def cmd_list(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """
    /list                   → all active
    /list p1                → filter by priority
    /list q2                → filter by quadrant
    /list next              → filter by GTD status
    /list #project          → filter by project
    /list @context          → filter by context
    /list p1 next #work     → combine filters
    /list done              → include done tasks
    """
    status = None
    priority = None
    quadrant = None
    project = None
    ctx = None
    include_done = False

    for arg in (context.args or []):
        a = arg.lower()
        if a in ("p1", "p2", "p3", "p4"):
            priority = Priority.from_str(a)
        elif a in ("q1", "q2", "q3", "q4"):
            quadrant = Quadrant(a.upper())
        elif a in ("inbox", "next", "waiting", "someday"):
            status = GTDStatus.from_str(a)
        elif a == "done":
            status = GTDStatus.DONE
            include_done = True
        elif arg.startswith("#"):
            project = arg[1:]
        elif arg.startswith("@"):
            ctx = arg
        else:
            # Try as status
            try:
                status = GTDStatus.from_str(a)
            except ValueError:
                pass

    tasks = repo.list_filtered(
        status=status,
        priority=priority,
        quadrant=quadrant,
        project=project,
        context=ctx,
        include_done=include_done,
        user_id=uid(context),
    )

    filter_desc = []
    if status:
        filter_desc.append(f"status={status.value}")
    if priority:
        filter_desc.append(f"priority={priority.value}")
    if quadrant:
        filter_desc.append(f"quadrant={quadrant.value}")
    if project:
        filter_desc.append(f"project={project}")
    if ctx:
        filter_desc.append(f"context={ctx}")
    title = "📋  <b>TASK LIST</b>"
    if filter_desc:
        title += f" ({', '.join(filter_desc)})"

    text = format_task_list(tasks, title)
    await send_long(update, text)


# ── /summary ───────────────────────────────────────────────────────────────────

@authorized
async def cmd_summary(update: Update, context: ContextTypes.DEFAULT_TYPE):
    u = uid(context)
    by_status = repo.count_by_status(u)
    by_quad = repo.count_by_quadrant(u)
    overdue = repo.list_overdue(u)
    q1_tasks = repo.list_by_quadrant(Quadrant.Q1, u)
    inbox = repo.list_by_status(GTDStatus.INBOX, u)

    total_active = sum(v for k, v in by_status.items() if k not in ("done", "archived"))
    total_done = by_status.get("done", 0)
    total_all = total_active + total_done if (total_active + total_done) > 0 else 1

    # ── Progress bar helper ──
    def bar(count, total, length=10):
        filled = round(count / total * length) if total > 0 else 0
        return "█" * filled + "░" * (length - filled)

    # ── Focus tasks (Q1 + overdue) ──
    seen = set()
    focus = []
    for t in overdue + q1_tasks:
        if t.id not in seen:
            focus.append(t)
            seen.add(t.id)

    # ── Build message ──
    n_inbox = by_status.get("inbox", 0)
    n_next = by_status.get("next", 0)
    n_wait = by_status.get("waiting", 0)
    n_some = by_status.get("someday", 0)
    n_q1 = by_quad.get("Q1", 0)
    n_q2 = by_quad.get("Q2", 0)
    n_q3 = by_quad.get("Q3", 0)
    n_q4 = by_quad.get("Q4", 0)

    lines = [
        f"━━━━━━━━━━━━━━━━━━━━",
        f"  ⚡ <b>TASKFLOW DASHBOARD</b>",
        f"  {date.today().strftime('%A, %d %B %Y')}",
        f"━━━━━━━━━━━━━━━━━━━━",
        "",
        f"📈 <b>Progress</b>  {total_done}/{total_all}",
        f"<code>{bar(total_done, total_all, 16)}</code>  {round(total_done/total_all*100)}%",
        "",
    ]

    # ── Alerts ──
    alerts = []
    if len(overdue) > 0:
        alerts.append(f"🔴 {len(overdue)} task overdue!")
    if n_inbox > 0:
        alerts.append(f"📥 {n_inbox} item di inbox")
    if alerts:
        lines.append("⚠️ " + "  ·  ".join(alerts))
        lines.append("")

    # ── Focus tasks ──
    if focus:
        lines.append(f"🎯 <b>Fokus Sekarang</b>")
        pri_icon = {"P1": "🔴", "P2": "🟠", "P3": "🟡", "P4": "🟢"}
        for t in focus[:4]:
            icon = pri_icon.get(t.priority.value, "⚪")
            tag = " ⚠️" if t.is_overdue else ""
            lines.append(f"  {icon} {t.title}{tag}")
        if len(focus) > 4:
            lines.append(f"  <i>+{len(focus)-4} lagi...</i>")
        lines.append("")

    # ── Eisenhower Matrix ──
    lines.append(f"📊 <b>Eisenhower</b>")
    lines.append(f"  🔥 Do  <b>{n_q1}</b>    📅 Plan  <b>{n_q2}</b>")
    lines.append(f"  👋 Dele <b>{n_q3}</b>    🗑 Drop  <b>{n_q4}</b>")
    lines.append("")

    # ── GTD Status bars ──
    lines.append(f"📋 <b>GTD Status</b>")
    gtd_max = max(n_next, n_wait, n_some, n_inbox, 1)
    lines.append(f"  Next    <code>{bar(n_next, gtd_max, 8)}</code>  {n_next}")
    lines.append(f"  Wait    <code>{bar(n_wait, gtd_max, 8)}</code>  {n_wait}")
    lines.append(f"  Inbox   <code>{bar(n_inbox, gtd_max, 8)}</code>  {n_inbox}")
    lines.append(f"  Later   <code>{bar(n_some, gtd_max, 8)}</code>  {n_some}")
    lines.append("")

    # ── Footer ──
    lines.append(f"━━━━━━━━━━━━━━━━━━━━")
    lines.append(f"  ✅ {total_done} done  ·  📌 {total_active} active  ·  ⚠️ {len(overdue)} overdue")

    await update.message.reply_text("\n".join(lines), parse_mode=ParseMode.HTML)


# ── /review ────────────────────────────────────────────────────────────────────

@authorized
async def cmd_review(update: Update, context: ContextTypes.DEFAULT_TYPE):
    u = uid(context)
    inbox = repo.list_by_status(GTDStatus.INBOX, u)
    next_tasks = repo.list_by_status(GTDStatus.NEXT, u)
    waiting = repo.list_by_status(GTDStatus.WAITING, u)
    someday = repo.list_by_status(GTDStatus.SOMEDAY, u)
    overdue = repo.list_overdue(u)
    projects = repo.list_projects(u)
    by_status = repo.count_by_status(u)
    total_done = by_status.get("done", 0)
    total_active = sum(v for k, v in by_status.items() if k not in ("done", "archived"))

    lines = [
        f"━━━━━━━━━━━━━━━━━━━━",
        f"  📝 <b>WEEKLY REVIEW</b>",
        f"  {date.today().strftime('%A, %d %B %Y')}",
        f"━━━━━━━━━━━━━━━━━━━━",
        "",
    ]

    # ── Health check ──
    checks = []
    checks.append(("✅" if len(inbox) == 0 else "❌", f"Inbox kosong ({len(inbox)} item)"))
    checks.append(("✅" if len(overdue) == 0 else "❌", f"Tidak ada overdue ({len(overdue)} task)"))
    checks.append(("✅" if len(next_tasks) > 0 else "❌", f"Ada next actions ({len(next_tasks)} task)"))
    all_proj_have_next = True
    for proj in projects:
        proj_tasks = repo.list_by_project(proj, u)
        has_next = any(t.gtd_status == GTDStatus.NEXT for t in proj_tasks)
        if not has_next:
            all_proj_have_next = False
            break
    checks.append(("✅" if all_proj_have_next or not projects else "⚠️", "Semua project punya next action"))

    score = sum(1 for c, _ in checks if c == "✅")
    health = "🟢 Sehat!" if score == 4 else ("🟡 Perlu perhatian" if score >= 2 else "🔴 Perlu review serius")

    lines.append(f"🏥 <b>System Health: {health}</b>")
    for icon, text in checks:
        lines.append(f"  {icon} {text}")
    lines.append("")

    # ── Quick stats ──
    lines.append(f"📊 <b>Angka Minggu Ini</b>")
    lines.append(f"  ▶️ Next: {len(next_tasks)}  ·  ⏳ Wait: {len(waiting)}  ·  💭 Later: {len(someday)}")
    lines.append(f"  📁 Projects: {len(projects)}  ·  ✅ Done: {total_done}")
    lines.append("")

    # ── Overdue detail ──
    if overdue:
        lines.append(f"🔴 <b>Overdue — Perlu Tindakan!</b>")
        pri_icon = {"P1": "🔴", "P2": "🟠", "P3": "🟡", "P4": "🟢"}
        for t in overdue[:5]:
            icon = pri_icon.get(t.priority.value, "⚪")
            days = abs(t.days_until_deadline) if t.days_until_deadline else 0
            lines.append(f"  {icon} #{t.id} {t.title} <i>({days}h lalu)</i>")
        if len(overdue) > 5:
            lines.append(f"  <i>+{len(overdue)-5} lagi → /overdue</i>")
        lines.append("")

    # ── Waiting review ──
    if waiting:
        lines.append(f"⏳ <b>Cek Waiting For</b>")
        for t in waiting[:5]:
            wf = f" → <i>{t.waiting_for}</i>" if t.waiting_for else ""
            lines.append(f"  #{t.id} {t.title}{wf}")
        lines.append("")

    # ── Someday review ──
    if someday:
        lines.append(f"💭 <b>Cek Someday/Maybe</b>")
        lines.append(f"  <i>Ada yang siap dipromosikan ke Next?</i>")
        for t in someday[:4]:
            lines.append(f"  #{t.id} {t.title}")
        if len(someday) > 4:
            lines.append(f"  <i>+{len(someday)-4} lagi → /someday</i>")
        lines.append("")

    # ── Action items ──
    actions = []
    if inbox:
        actions.append("→ /process untuk proses inbox")
    if overdue:
        actions.append("→ /overdue untuk handle overdue")
    if not next_tasks:
        actions.append("→ Proses inbox untuk isi next actions")

    if actions:
        lines.append(f"🎯 <b>Action Items</b>")
        for a in actions:
            lines.append(f"  {a}")
        lines.append("")

    # ── Footer ──
    lines.append(f"━━━━━━━━━━━━━━━━━━━━")
    lines.append(f"  <i>Review rutin = sistem terpercaya</i> 💪")

    await send_long(update, "\n".join(lines))


# ── /edit <id> (conversational) ────────────────────────────────────────────────

@authorized
async def cmd_edit_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args or not context.args[0].isdigit():
        await update.message.reply_text("💡 Usage: <code>/edit 42</code>", parse_mode=ParseMode.HTML)
        return ConversationHandler.END

    task = repo.get(int(context.args[0]), uid(context))
    if not task:
        await update.message.reply_text("❌ Task tidak ditemukan.")
        return ConversationHandler.END

    context.user_data["edit_task_id"] = task.id

    keyboard = [
        [
            InlineKeyboardButton("📝 Title", callback_data="editf_title"),
            InlineKeyboardButton("📄 Desc", callback_data="editf_description"),
        ],
        [
            InlineKeyboardButton("🎯 Priority", callback_data="editf_priority"),
            InlineKeyboardButton("🔄 GTD Status", callback_data="editf_gtd"),
        ],
        [
            InlineKeyboardButton("📁 Project", callback_data="editf_project"),
            InlineKeyboardButton("🏷️ Context", callback_data="editf_context"),
        ],
        [
            InlineKeyboardButton("📅 Deadline", callback_data="editf_deadline"),
            InlineKeyboardButton("⏳ Waiting For", callback_data="editf_waiting"),
        ],
        [InlineKeyboardButton("❌ Batal", callback_data="editf_cancel")],
    ]

    await update.message.reply_text(
        f"✏️ <b>Edit Task #{task.id}</b>\n\n{task.format_detail()}\n\nPilih field yang mau diedit:",
        parse_mode=ParseMode.HTML,
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    return EDIT_CHOOSE


async def edit_choose_cb(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    field = query.data.replace("editf_", "")

    if field == "cancel":
        await query.edit_message_text("❌ Edit dibatalkan.")
        return ConversationHandler.END

    context.user_data["edit_field"] = field

    if field == "priority":
        keyboard = [
            [
                InlineKeyboardButton("🔴 P1", callback_data="editv_P1"),
                InlineKeyboardButton("🟠 P2", callback_data="editv_P2"),
            ],
            [
                InlineKeyboardButton("🟡 P3", callback_data="editv_P3"),
                InlineKeyboardButton("🟢 P4", callback_data="editv_P4"),
            ],
        ]
        await query.edit_message_text("🎯 Pilih priority baru:", reply_markup=InlineKeyboardMarkup(keyboard))
        return EDIT_VALUE

    if field == "gtd":
        keyboard = [
            [
                InlineKeyboardButton("📥 Inbox", callback_data="editv_inbox"),
                InlineKeyboardButton("▶️ Next", callback_data="editv_next"),
            ],
            [
                InlineKeyboardButton("⏳ Waiting", callback_data="editv_waiting"),
                InlineKeyboardButton("💭 Someday", callback_data="editv_someday"),
            ],
        ]
        await query.edit_message_text("🔄 Pilih GTD status:", reply_markup=InlineKeyboardMarkup(keyboard))
        return EDIT_VALUE

    prompts = {
        "title": "📝 Ketik judul baru:",
        "description": "📄 Ketik deskripsi baru (atau <code>-</code> untuk kosongkan):",
        "project": "📁 Ketik nama project baru (atau <code>-</code> untuk hapus):",
        "context": "🏷️ Ketik context baru (atau <code>-</code> untuk hapus):",
        "deadline": "📅 Ketik deadline baru (atau <code>-</code> untuk hapus):",
        "waiting": "⏳ Ketik waiting for (atau <code>-</code> untuk hapus):",
    }
    await query.edit_message_text(prompts.get(field, "Ketik nilai baru:"), parse_mode=ParseMode.HTML)
    return EDIT_VALUE


async def edit_value_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    task_id = context.user_data["edit_task_id"]
    field = context.user_data["edit_field"]
    text = update.message.text.strip()
    task = repo.get(task_id, uid(context))

    if not task:
        await update.message.reply_text("❌ Task tidak ditemukan.")
        return ConversationHandler.END

    if field == "title":
        task.title = text
    elif field == "description":
        task.description = "" if text == "-" else text
    elif field == "project":
        task.project = "" if text == "-" else text
    elif field == "context":
        task.context = "" if text == "-" else text
    elif field == "deadline":
        if text == "-":
            task.deadline = None
        else:
            d = parse_date(text)
            if d is None:
                await update.message.reply_text("❌ Format tanggal tidak dikenali. Coba lagi:")
                return EDIT_VALUE
            task.deadline = d
    elif field == "waiting":
        task.waiting_for = "" if text == "-" else text

    task.quadrant = calculate_quadrant(task)
    repo.update(task)
    await update.message.reply_text(
        f"✅ Task diupdate!\n\n{task.format_detail()}",
        parse_mode=ParseMode.HTML,
    )
    return ConversationHandler.END


async def edit_value_cb(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    value = query.data.replace("editv_", "")

    task_id = context.user_data["edit_task_id"]
    field = context.user_data["edit_field"]
    task = repo.get(task_id, uid(context))

    if not task:
        await query.edit_message_text("❌ Task tidak ditemukan.")
        return ConversationHandler.END

    if field == "priority":
        task.priority = Priority.from_str(value)
    elif field == "gtd":
        if value == "project_status":
            task.gtd_status = GTDStatus.PROJECT
        else:
            task.gtd_status = GTDStatus.from_str(value)

    task.quadrant = calculate_quadrant(task)
    repo.update(task)
    await query.edit_message_text(
        f"✅ Task diupdate!\n\n{task.format_detail()}",
        parse_mode=ParseMode.HTML,
    )
    return ConversationHandler.END


# ══════════════════════════════════════════════════════════════════════════════
#  CALLBACK QUERY HANDLER (inline buttons from /view, /process, /delete)
# ══════════════════════════════════════════════════════════════════════════════

@authorized_callback
async def handle_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    data = query.data

    # ── Done button ──
    if data.startswith("done_"):
        task_id = int(data.replace("done_", ""))
        task = repo.get(task_id, uid(context))
        if task and task.is_active:
            task.gtd_status = GTDStatus.DONE
            task.completed_at = datetime.now()
            repo.update(task)
            await query.answer("✅ Done!")
            await query.edit_message_text(
                f"✅ <b>Task #{task.id} selesai!</b>\n\n{task.format_detail()}",
                parse_mode=ParseMode.HTML,
            )
        else:
            await query.answer("Task not found")

    # ── GTD status change from /view ──
    elif data.startswith("gtd_"):
        parts = data.split("_")
        task_id = int(parts[1])
        new_status = GTDStatus.from_str(parts[2])
        task = repo.get(task_id, uid(context))
        if task:
            task.gtd_status = new_status
            task.quadrant = calculate_quadrant(task)
            repo.update(task)
            await query.answer(f"Moved to {new_status.value}")
            await query.edit_message_text(
                f"🔄 Task #{task.id} → <b>{new_status.value}</b>\n\n{task.format_detail()}",
                parse_mode=ParseMode.HTML,
            )

    # ── Process inbox ──
    elif data.startswith("proc_"):
        parts = data.split("_")
        task_id = int(parts[1])
        action = parts[2]
        task = repo.get(task_id, uid(context))

        if not task:
            await query.answer("Task not found")
            return

        if action == "skip":
            await query.answer("Skipped")
        elif action == "done":
            task.gtd_status = GTDStatus.DONE
            task.completed_at = datetime.now()
            repo.update(task)
            await query.answer("✅ Done!")
        elif action == "delete":
            repo.delete(task_id, uid(context))
            await query.answer("🗑️ Deleted")
        else:
            new_status = GTDStatus.from_str(action)
            task.gtd_status = new_status
            task.quadrant = calculate_quadrant(task)
            repo.update(task)
            await query.answer(f"→ {new_status.value}")

        # Show next inbox item
        inbox = repo.list_by_status(GTDStatus.INBOX, uid(context))
        if inbox:
            next_task = inbox[0]
            keyboard = [
                [
                    InlineKeyboardButton("▶️ Next Action", callback_data=f"proc_{next_task.id}_next"),
                    InlineKeyboardButton("⏳ Waiting", callback_data=f"proc_{next_task.id}_waiting"),
                ],
                [
                    InlineKeyboardButton("💭 Someday", callback_data=f"proc_{next_task.id}_someday"),
                    InlineKeyboardButton("✅ Done", callback_data=f"proc_{next_task.id}_done"),
                ],
                [
                    InlineKeyboardButton("🗑️ Delete", callback_data=f"proc_{next_task.id}_delete"),
                    InlineKeyboardButton("⏭️ Skip", callback_data=f"proc_{next_task.id}_skip"),
                ],
            ]
            await query.edit_message_text(
                f"📥 <b>Process Inbox</b> ({len(inbox)} remaining)\n\n"
                f"{next_task.format_detail()}\n\n"
                "Apa yang harus dilakukan dengan task ini?",
                parse_mode=ParseMode.HTML,
                reply_markup=InlineKeyboardMarkup(keyboard),
            )
        else:
            await query.edit_message_text("📥 Inbox kosong! 🎉 Semua sudah diproses.")

    # ── Delete confirmation ──
    elif data.startswith("confirmdel_"):
        task_id = int(data.replace("confirmdel_", ""))
        task = repo.get(task_id, uid(context))
        if task:
            repo.delete(task_id, uid(context))
            await query.answer("🗑️ Deleted")
            await query.edit_message_text(f"🗑️ Task #{task_id} <b>{task.title}</b> dihapus.")
        else:
            await query.answer("Not found")

    elif data == "canceldel":
        await query.answer("Cancelled")
        await query.edit_message_text("❌ Batal.")

    # ── Edit start from /view ──
    elif data.startswith("editstart_"):
        task_id = int(data.replace("editstart_", ""))
        await query.answer()
        await query.edit_message_text(
            f"✏️ Gunakan command: <code>/edit {task_id}</code>",
            parse_mode=ParseMode.HTML,
        )

    # ── Delete from /view ──
    elif data.startswith("del_"):
        task_id = int(data.replace("del_", ""))
        keyboard = [
            [
                InlineKeyboardButton("✅ Ya, hapus", callback_data=f"confirmdel_{task_id}"),
                InlineKeyboardButton("❌ Batal", callback_data="canceldel"),
            ]
        ]
        task = repo.get(task_id, uid(context))
        await query.answer()
        await query.edit_message_text(
            f"⚠️ Hapus task #{task_id}: <b>{task.title if task else '?'}</b>?",
            parse_mode=ParseMode.HTML,
            reply_markup=InlineKeyboardMarkup(keyboard),
        )

    # ── Focus toggle ──
    elif data.startswith("togfocus_"):
        task_id = int(data.replace("togfocus_", ""))
        new_val = repo.toggle_focus(task_id, uid(context))
        await query.answer("⭐ Ditambahkan ke Fokus" if new_val else "☆ Dihapus dari Fokus")
        task = repo.get(task_id, uid(context))
        if task:
            subtasks, focused, notes, attachments = _refresh_view_data(task_id)
            text = _build_view_message(task, subtasks, focused, notes, attachments)
            markup = _build_view_buttons(task, subtasks, focused, notes, attachments)
            await query.edit_message_text(text, parse_mode=ParseMode.HTML, reply_markup=markup)

    # ── Subtask: toggle ──
    elif data.startswith("togsub_"):
        parts = data.split("_")
        sub_id = int(parts[1])
        task_id = int(parts[2])
        result = repo.toggle_subtask(sub_id)
        if result:
            status = "☑️" if result["is_done"] else "☐"
            await query.answer(f"{status} {result['title'][:30]}")
        else:
            await query.answer("Subtask not found")
        # Refresh view
        task = repo.get(task_id, uid(context))
        if task:
            subtasks, focused, notes, attachments = _refresh_view_data(task_id)
            text = _build_view_message(task, subtasks, focused, notes, attachments)
            markup = _build_view_buttons(task, subtasks, focused, notes, attachments)
            await query.edit_message_text(text, parse_mode=ParseMode.HTML, reply_markup=markup)

    # ── Subtask: add (prompt for text) ──
    elif data.startswith("addsub_"):
        task_id = int(data.replace("addsub_", ""))
        context.user_data["waiting_subtask_for"] = task_id
        context.user_data["subtask_msg_id"] = query.message.message_id
        await query.answer()
        await query.edit_message_text(
            f"📝 Ketik judul subtask untuk task <b>#{task_id}</b>:\n\n"
            f"<i>Atau ketik /cancel untuk batal</i>",
            parse_mode=ParseMode.HTML,
        )

    # ── Subtask: delete mode (show delete buttons) ──
    elif data.startswith("delsub_mode_"):
        task_id = int(data.replace("delsub_mode_", ""))
        task = repo.get(task_id, uid(context))
        subtasks = repo.get_subtasks(task_id)
        if not subtasks:
            await query.answer("Tidak ada subtask")
            return
        buttons = []
        for s in subtasks:
            buttons.append([InlineKeyboardButton(
                f"🗑 {s['title'][:30]}",
                callback_data=f"delsub_{s['id']}_{task_id}",
            )])
        buttons.append([InlineKeyboardButton("⬅️ Kembali", callback_data=f"viewrefresh_{task_id}")])
        await query.answer()
        await query.edit_message_text(
            f"🗑 <b>Hapus subtask mana?</b>\n\nTask: #{task_id} {task.title if task else ''}",
            parse_mode=ParseMode.HTML,
            reply_markup=InlineKeyboardMarkup(buttons),
        )

    # ── Subtask: delete confirmed ──
    elif data.startswith("delsub_") and not data.startswith("delsub_mode_"):
        parts = data.split("_")
        sub_id = int(parts[1])
        task_id = int(parts[2])
        repo.delete_subtask(sub_id)
        await query.answer("🗑 Subtask dihapus")
        # Refresh view
        task = repo.get(task_id, uid(context))
        if task:
            subtasks, focused, notes, attachments = _refresh_view_data(task_id)
            text = _build_view_message(task, subtasks, focused, notes, attachments)
            markup = _build_view_buttons(task, subtasks, focused, notes, attachments)
            await query.edit_message_text(text, parse_mode=ParseMode.HTML, reply_markup=markup)

    # ── View refresh (after subtask operations) ──
    elif data.startswith("viewrefresh_"):
        task_id = int(data.replace("viewrefresh_", ""))
        task = repo.get(task_id, uid(context))
        if task:
            subtasks, focused, notes, attachments = _refresh_view_data(task_id)
            text = _build_view_message(task, subtasks, focused, notes, attachments)
            markup = _build_view_buttons(task, subtasks, focused, notes, attachments)
            await query.answer()
            await query.edit_message_text(text, parse_mode=ParseMode.HTML, reply_markup=markup)

    # ── Notes: add (prompt for text) ──
    elif data.startswith("addnote_"):
        task_id = int(data.replace("addnote_", ""))
        context.user_data["waiting_note_for"] = task_id
        context.user_data.pop("waiting_subtask_for", None)
        context.user_data.pop("waiting_attach_for", None)
        await query.answer()
        await query.edit_message_text(
            f"📓 Ketik catatan untuk task <b>#{task_id}</b>:\n\n"
            f"<i>Atau ketik /cancel untuk batal</i>",
            parse_mode=ParseMode.HTML,
        )

    # ── Attachment: download/send file ──
    elif data.startswith("dlatt_"):
        parts = data.split("_")
        att_id = int(parts[1])
        task_id = int(parts[2])
        # Get attachment info
        with repo._connect() as conn:
            row = conn.execute("SELECT * FROM task_attachments WHERE id = ?", (att_id,)).fetchone()
        if not row:
            await query.answer("File tidak ditemukan")
            return
        filepath = os.path.join(UPLOAD_DIR, row["filename"])
        if not os.path.exists(filepath):
            await query.answer("File tidak ada di server")
            return
        await query.answer("📤 Mengirim file...")
        try:
            with open(filepath, "rb") as f:
                await context.bot.send_document(
                    chat_id=update.effective_chat.id,
                    document=f,
                    filename=row["original_name"],
                )
        except Exception as e:
            logger.error(f"Failed to send attachment: {e}")
            await context.bot.send_message(
                chat_id=update.effective_chat.id,
                text=f"❌ Gagal mengirim file: {row['original_name']}",
            )

    # ── Attachment: prompt to send file ──
    elif data.startswith("attach_"):
        task_id = int(data.replace("attach_", ""))
        context.user_data["waiting_attach_for"] = task_id
        context.user_data.pop("waiting_subtask_for", None)
        context.user_data.pop("waiting_note_for", None)
        await query.answer()
        await query.edit_message_text(
            f"📎 Kirim file untuk task <b>#{task_id}</b>\n\n"
            f"Kirim gambar, dokumen, atau file apa saja (maks 10MB).\n"
            f"<i>Atau ketik /cancel untuk batal</i>",
            parse_mode=ParseMode.HTML,
        )

    # ── NLP: confirm save ──────────────────────────────────────────────────────
    elif data == "nlp_yes":
        parsed = context.user_data.pop("nlp_pending", None)
        if not parsed:
            await query.answer("Session expired, coba kirim ulang.")
            await query.edit_message_text("⏱️ Session habis, silakan ketik ulang task-nya.")
            return
        task = Task(
            title=parsed["title"],
            priority=Priority.from_str(parsed["priority"]),
            gtd_status=GTDStatus.from_str(parsed["gtd_status"]),
            project=parsed.get("project", ""),
            context=parsed.get("context", ""),
            deadline=parsed.get("deadline"),
        )
        task.quadrant = calculate_quadrant(task)
        task = repo.add(task, uid(context))
        await query.answer("✅ Task disimpan!")
        await query.edit_message_text(
            f"✅ <b>Task ditambahkan!</b>\n\n{task.format_detail()}",
            parse_mode=ParseMode.HTML,
        )

    elif data == "nlp_no":
        context.user_data.pop("nlp_pending", None)
        await query.answer("Dibatalkan.")
        await query.edit_message_text(
            "❌ Dibatalkan.\n\n"
            "Ketik ulang dengan lebih spesifik, atau gunakan:\n"
            "<code>/quick Judul task p1 #project dl:besok</code>",
            parse_mode=ParseMode.HTML,
        )


# ── File upload handler ────────────────────────────────────────────────────

@authorized
async def handle_file_upload(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle file/photo/document upload for task attachment."""
    task_id = context.user_data.get("waiting_attach_for")
    if not task_id:
        return

    context.user_data.pop("waiting_attach_for", None)

    # Get file object from message
    file_obj = None
    original_name = "file"

    if update.message.document:
        file_obj = update.message.document
        original_name = file_obj.file_name or "document"
    elif update.message.photo:
        file_obj = update.message.photo[-1]  # Highest resolution
        original_name = f"photo_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg"
    elif update.message.video:
        file_obj = update.message.video
        original_name = file_obj.file_name or f"video_{datetime.now().strftime('%Y%m%d_%H%M%S')}.mp4"
    elif update.message.audio:
        file_obj = update.message.audio
        original_name = file_obj.file_name or f"audio_{datetime.now().strftime('%Y%m%d_%H%M%S')}.mp3"
    elif update.message.voice:
        file_obj = update.message.voice
        original_name = f"voice_{datetime.now().strftime('%Y%m%d_%H%M%S')}.ogg"

    if not file_obj:
        await update.message.reply_text("❌ Tidak ada file yang terdeteksi. Kirim ulang file atau /cancel.")
        context.user_data["waiting_attach_for"] = task_id
        return

    # Check size
    file_size = getattr(file_obj, 'file_size', 0) or 0
    if file_size > MAX_FILE_SIZE:
        await update.message.reply_text(f"❌ File terlalu besar ({file_size // (1024*1024)}MB). Maks 10MB.")
        return

    # Download file
    tg_file = await file_obj.get_file()
    ext = Path(original_name).suffix or ""
    stored_name = f"{uuid.uuid4().hex}{ext}"
    stored_path = os.path.join(UPLOAD_DIR, stored_name)
    await tg_file.download_to_drive(stored_path)

    # Get actual file size
    actual_size = os.path.getsize(stored_path)

    # Detect mime type
    import mimetypes
    mime_type = mimetypes.guess_type(original_name)[0] or "application/octet-stream"

    # Save to DB
    task = repo.get(task_id, uid(context))
    if not task:
        os.unlink(stored_path)
        await update.message.reply_text("❌ Task tidak ditemukan.")
        return

    repo.add_attachment(task_id, stored_name, original_name, actual_size, mime_type)

    # Show updated view
    subtasks, focused, notes, attachments = _refresh_view_data(task_id)
    text = _build_view_message(task, subtasks, focused, notes, attachments)
    markup = _build_view_buttons(task, subtasks, focused, notes, attachments)
    await update.message.reply_text(
        f"📎 File <b>{original_name}</b> berhasil dilampirkan!\n\n{text}",
        parse_mode=ParseMode.HTML,
        reply_markup=markup,
    )


# ── NLP Query handler ─────────────────────────────────────────────────────

async def _handle_nlp_query(update: Update, context: ContextTypes.DEFAULT_TYPE, query: dict):
    """Proses view query dari NLP dan kirim daftar task."""
    u = uid(context)
    view = query["view"]
    value = query.get("value", "")

    if view == "today":
        overdue = repo.list_overdue(u)
        q1 = repo.list_by_quadrant(Quadrant.Q1, u)
        seen = set()
        tasks = []
        for t in overdue + q1:
            if t.id not in seen:
                tasks.append(t)
                seen.add(t.id)
        title = "🎯 <b>FOKUS HARI INI</b>"

    elif view == "overdue":
        tasks = repo.list_overdue(u)
        title = "⚠️ <b>TASK OVERDUE</b>"

    elif view == "gtd":
        status_map = {
            "inbox": GTDStatus.INBOX, "next": GTDStatus.NEXT,
            "waiting": GTDStatus.WAITING, "someday": GTDStatus.SOMEDAY,
            "done": GTDStatus.DONE,
        }
        gtd_icons = {
            "inbox": "📥", "next": "▶️", "waiting": "⏳",
            "someday": "💭", "done": "✅",
        }
        status = status_map.get(value, GTDStatus.INBOX)
        tasks = repo.list_by_status(status, u)
        title = f"{gtd_icons.get(value, '📋')} <b>{value.upper()}</b>"

    elif view == "quadrant":
        quad_map = {"Q1": Quadrant.Q1, "Q2": Quadrant.Q2, "Q3": Quadrant.Q3, "Q4": Quadrant.Q4}
        quad_labels = {
            "Q1": "🔥 Q1 — Do First",
            "Q2": "📅 Q2 — Schedule",
            "Q3": "👋 Q3 — Delegate",
            "Q4": "🗑 Q4 — Drop",
        }
        tasks = repo.list_by_quadrant(quad_map.get(value, Quadrant.Q1), u)
        title = f"<b>{quad_labels.get(value, value)}</b>"

    elif view == "priority":
        tasks = repo.list_filtered(priority=value, user_id=u)
        pri_icons = {"P1": "🔴", "P2": "🟠", "P3": "🟡", "P4": "🟢"}
        title = f"{pri_icons.get(value, '')} <b>Priority {value}</b>"

    elif view == "project":
        tasks = repo.list_by_project(value, u)
        title = f"📁 <b>Project: {value}</b>"

    elif view == "context":
        tasks = repo.list_filtered(context=f"@{value}", user_id=u)
        title = f"🏷️ <b>Context: @{value}</b>"

    else:  # all
        tasks = repo.list_active(u)
        title = "📋 <b>SEMUA TASK AKTIF</b>"

    text = format_task_list(tasks, title)
    await send_long(update, text)


# ── Text input handler (subtask + notes) ──────────────────────────────────

@authorized
async def handle_text_input(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle text input for subtask or note addition."""
    text = update.message.text.strip()
    if not text or text.startswith("/"):
        context.user_data.pop("waiting_subtask_for", None)
        context.user_data.pop("waiting_note_for", None)
        return

    # Check if waiting for note input
    note_task_id = context.user_data.get("waiting_note_for")
    if note_task_id:
        context.user_data.pop("waiting_note_for", None)
        repo.add_note(note_task_id, text)
        task = repo.get(note_task_id, uid(context))
        if task:
            subtasks, focused, notes, attachments = _refresh_view_data(note_task_id)
            msg = _build_view_message(task, subtasks, focused, notes, attachments)
            markup = _build_view_buttons(task, subtasks, focused, notes, attachments)
            await update.message.reply_text(msg, parse_mode=ParseMode.HTML, reply_markup=markup)
        else:
            await update.message.reply_text("📓 Catatan ditambahkan.")
        return

    # Check if waiting for subtask input
    sub_task_id = context.user_data.get("waiting_subtask_for")
    if sub_task_id:
        context.user_data.pop("waiting_subtask_for", None)
        repo.add_subtask(sub_task_id, text)
        task = repo.get(sub_task_id, uid(context))
        if task:
            subtasks, focused, notes, attachments = _refresh_view_data(sub_task_id)
            msg = _build_view_message(task, subtasks, focused, notes, attachments)
            markup = _build_view_buttons(task, subtasks, focused, notes, attachments)
            await update.message.reply_text(msg, parse_mode=ParseMode.HTML, reply_markup=markup)
        else:
            await update.message.reply_text("✅ Subtask ditambahkan.")
        return

    # ── NLP: query intent (lihat task) ────────────────────────────────────────
    query = parse_query(text)
    if query:
        await _handle_nlp_query(update, context, query)
        return

    # ── NLP: free-form task input ──────────────────────────────────────────────
    parsed = parse_task(text)
    if parsed["confidence"] > 0:
        context.user_data["nlp_pending"] = parsed
        msg = format_confirmation(parsed)
        keyboard = InlineKeyboardMarkup([
            [
                InlineKeyboardButton("✅ Simpan", callback_data="nlp_yes"),
                InlineKeyboardButton("❌ Batal", callback_data="nlp_no"),
            ]
        ])
        await update.message.reply_text(msg, parse_mode=ParseMode.HTML, reply_markup=keyboard)
    else:
        await update.message.reply_text(
            "❓ Tidak bisa mendeteksi judul task.\n\n"
            "Coba ketik kalimat yang lebih jelas, atau gunakan:\n"
            "<code>/quick Judul task p1 #project dl:besok</code>",
            parse_mode=ParseMode.HTML,
        )


# ── /note shortcut ─────────────────────────────────────────────────────────

@authorized
async def cmd_note(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """/note <task_id> <text> - Quick add note."""
    if not context.args or len(context.args) < 2 or not context.args[0].isdigit():
        await update.message.reply_text(
            "💡 Usage: <code>/note 42 Sudah koordinasi dengan tim</code>",
            parse_mode=ParseMode.HTML,
        )
        return

    task_id = int(context.args[0])
    content = " ".join(context.args[1:])
    task = repo.get(task_id, uid(context))
    if not task:
        await update.message.reply_text("❌ Task tidak ditemukan.")
        return

    repo.add_note(task_id, content)
    notes = repo.get_notes(task_id)
    await update.message.reply_text(
        f"📓 Catatan ditambahkan ke <b>#{task_id}</b>\n"
        f"   {content}\n\n"
        f"📓 Total catatan: {len(notes)}",
        parse_mode=ParseMode.HTML,
    )


# ── /sub shortcut ──────────────────────────────────────────────────────────

@authorized
async def cmd_sub(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """/sub <task_id> <title> - Quick add subtask."""
    if not context.args or len(context.args) < 2 or not context.args[0].isdigit():
        await update.message.reply_text(
            "💡 Usage: <code>/sub 42 Siapkan dokumen</code>",
            parse_mode=ParseMode.HTML,
        )
        return

    task_id = int(context.args[0])
    title = " ".join(context.args[1:])
    task = repo.get(task_id, uid(context))
    if not task:
        await update.message.reply_text("❌ Task tidak ditemukan.")
        return

    repo.add_subtask(task_id, title)
    subtasks = repo.get_subtasks(task_id)
    done_count = sum(1 for s in subtasks if s["is_done"])
    await update.message.reply_text(
        f"✅ Subtask ditambahkan ke <b>#{task_id}</b>\n"
        f"   ☐ {title}\n\n"
        f"📝 Subtasks: {done_count}/{len(subtasks)}",
        parse_mode=ParseMode.HTML,
    )


# ══════════════════════════════════════════════════════════════════════════════
#  EISENHOWER SCHEDULER
# ══════════════════════════════════════════════════════════════════════════════

async def eisenhower_job(context: ContextTypes.DEFAULT_TYPE):
    """Periodic job to recalculate Eisenhower quadrants."""
    try:
        changed = recalculate_all(repo)
        if changed:
            logger.info(f"Eisenhower recalc: {changed} tasks updated")
    except Exception as e:
        logger.error(f"Eisenhower recalc error: {e}")


# ══════════════════════════════════════════════════════════════════════════════
#  SCHEDULED NOTIFICATIONS
# ══════════════════════════════════════════════════════════════════════════════

def _get_telegram_users() -> list[dict]:
    """Get all users that have a linked telegram_id."""
    with repo._connect() as conn:
        rows = conn.execute(
            "SELECT id, telegram_id, display_name FROM users WHERE telegram_id IS NOT NULL"
        ).fetchall()
        return [dict(r) for r in rows]


def _build_daily_summary(user_id: int) -> str:
    """Build daily summary text for a user."""
    by_status = repo.count_by_status(user_id)
    by_quad = repo.count_by_quadrant(user_id)
    overdue = repo.list_overdue(user_id)
    q1_tasks = repo.list_by_quadrant(Quadrant.Q1, user_id)
    inbox = repo.list_by_status(GTDStatus.INBOX, user_id)

    # Merge focus tasks (overdue + Q1)
    seen = set()
    focus = []
    for t in overdue + q1_tasks:
        if t.id not in seen:
            focus.append(t)
            seen.add(t.id)

    total_active = sum(v for k, v in by_status.items() if k not in ("done", "archived"))

    lines = [
        f"☀️ <b>Selamat Pagi!</b>",
        f"📅 {date.today().strftime('%A, %d %B %Y')}\n",
    ]

    if focus:
        lines.append(f"🔥 <b>Fokus Hari Ini ({len(focus)}):</b>")
        for t in focus[:7]:
            pri_icon = {"P1": "🔴", "P2": "🟠", "P3": "🟡", "P4": "🟢"}.get(t.priority.value, "⚪")
            overdue_tag = " ⚠️" if t.is_overdue else ""
            lines.append(f"  {pri_icon} {t.title}{overdue_tag}")
        if len(focus) > 7:
            lines.append(f"  ... +{len(focus) - 7} lagi")
        lines.append("")

    if inbox:
        lines.append(f"📥 <b>{len(inbox)} item di Inbox</b> belum diproses")

    lines.append(f"\n📊 Active: {total_active} | Overdue: {len(overdue)}")
    lines.append(f"   Q1: {by_quad.get('Q1', 0)} | Q2: {by_quad.get('Q2', 0)} | Q3: {by_quad.get('Q3', 0)} | Q4: {by_quad.get('Q4', 0)}")

    if not focus and not inbox:
        lines.append("\n🎉 Tidak ada yang mendesak. Hari yang tenang!")

    return "\n".join(lines)


def _build_weekly_review(user_id: int) -> str:
    """Build weekly review text for a user."""
    inbox = repo.list_by_status(GTDStatus.INBOX, user_id)
    next_tasks = repo.list_by_status(GTDStatus.NEXT, user_id)
    waiting = repo.list_by_status(GTDStatus.WAITING, user_id)
    someday = repo.list_by_status(GTDStatus.SOMEDAY, user_id)
    overdue = repo.list_overdue(user_id)
    projects = repo.list_projects(user_id)
    by_status = repo.count_by_status(user_id)
    total_done = by_status.get("done", 0)

    lines = [
        f"📝 <b>Weekly Review</b>",
        f"📅 {date.today().strftime('%A, %d %B %Y')}\n",
    ]

    # Alerts
    issues = []
    if inbox:
        issues.append(f"📥 {len(inbox)} item di Inbox → /process")
    if overdue:
        issues.append(f"⚠️ {len(overdue)} task overdue → /overdue")
    if not next_tasks:
        issues.append("▶️ Tidak ada Next Actions → perlu /process")

    if issues:
        lines.append("<b>⚠️ Perlu Perhatian:</b>")
        for issue in issues:
            lines.append(f"  {issue}")
        lines.append("")

    lines.append("<b>📊 Ringkasan Minggu Ini:</b>")
    lines.append(f"  ▶️ Next Actions: {len(next_tasks)}")
    lines.append(f"  ⏳ Waiting For: {len(waiting)}")
    lines.append(f"  💭 Someday: {len(someday)}")
    lines.append(f"  📁 Projects: {len(projects)}")
    lines.append(f"  ✅ Total Done: {total_done}")

    if waiting:
        lines.append(f"\n<b>⏳ Cek Waiting For:</b>")
        for t in waiting[:5]:
            wf = f" → {t.waiting_for}" if t.waiting_for else ""
            lines.append(f"  #{t.id} {t.title}{wf}")

    if someday:
        lines.append(f"\n<b>💭 Cek Someday/Maybe:</b>")
        for t in someday[:5]:
            lines.append(f"  #{t.id} {t.title}")

    lines.append("\n💡 <i>Luangkan 15 menit untuk review dan bersihkan sistem.</i>")

    return "\n".join(lines)


async def daily_summary_job(context: ContextTypes.DEFAULT_TYPE):
    """Send daily summary to all Telegram users."""
    logger.info("Running daily summary job...")
    users = _get_telegram_users()
    for user in users:
        try:
            text = _build_daily_summary(user["id"])
            await context.bot.send_message(
                chat_id=user["telegram_id"],
                text=text,
                parse_mode=ParseMode.HTML,
            )
            logger.info(f"Daily summary sent to {user['display_name']} (tg:{user['telegram_id']})")
        except Exception as e:
            logger.error(f"Failed to send daily summary to {user['telegram_id']}: {e}")


async def weekly_review_job(context: ContextTypes.DEFAULT_TYPE):
    """Send weekly review to all Telegram users."""
    logger.info("Running weekly review job...")
    users = _get_telegram_users()
    for user in users:
        try:
            text = _build_weekly_review(user["id"])
            await context.bot.send_message(
                chat_id=user["telegram_id"],
                text=text,
                parse_mode=ParseMode.HTML,
            )
            logger.info(f"Weekly review sent to {user['display_name']} (tg:{user['telegram_id']})")
        except Exception as e:
            logger.error(f"Failed to send weekly review to {user['telegram_id']}: {e}")


# ══════════════════════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════════════════════

def main():
    if not TELEGRAM_BOT_TOKEN:
        print("❌ TELEGRAM_BOT_TOKEN not set! Check your .env file.")
        return

    app = Application.builder().token(TELEGRAM_BOT_TOKEN).build()

    # ── Conversation: /add ──
    add_conv = ConversationHandler(
        entry_points=[CommandHandler("add", cmd_add_start)],
        states={
            ADD_TITLE: [MessageHandler(filters.TEXT & ~filters.COMMAND, add_title)],
            ADD_PRIORITY: [CallbackQueryHandler(add_priority_cb, pattern=r"^addp_")],
            ADD_PROJECT: [
                CallbackQueryHandler(add_project_cb, pattern=r"^addproj_"),
                MessageHandler(filters.TEXT & ~filters.COMMAND, add_project_text),
            ],
            ADD_CONTEXT: [
                CallbackQueryHandler(add_context_cb, pattern=r"^addctx_"),
                MessageHandler(filters.TEXT & ~filters.COMMAND, add_context_text),
            ],
            ADD_DEADLINE: [MessageHandler(filters.TEXT & ~filters.COMMAND, add_deadline)],
            ADD_DESCRIPTION: [MessageHandler(filters.TEXT & ~filters.COMMAND, add_description)],
        },
        fallbacks=[CommandHandler("cancel", add_cancel)],
    )

    # ── Conversation: /edit ──
    edit_conv = ConversationHandler(
        entry_points=[CommandHandler("edit", cmd_edit_start)],
        states={
            EDIT_CHOOSE: [CallbackQueryHandler(edit_choose_cb, pattern=r"^editf_")],
            EDIT_VALUE: [
                CallbackQueryHandler(edit_value_cb, pattern=r"^editv_"),
                MessageHandler(filters.TEXT & ~filters.COMMAND, edit_value_text),
            ],
        },
        fallbacks=[CommandHandler("cancel", add_cancel)],
    )

    # ── Register handlers ──
    app.add_handler(add_conv)
    app.add_handler(edit_conv)

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("quick", cmd_quick))
    app.add_handler(CommandHandler("view", cmd_view))
    app.add_handler(CommandHandler("delete", cmd_delete))
    app.add_handler(CommandHandler("done", cmd_done))

    app.add_handler(CommandHandler("inbox", cmd_inbox))
    app.add_handler(CommandHandler("next", cmd_next))
    app.add_handler(CommandHandler("waiting", cmd_waiting))
    app.add_handler(CommandHandler("someday", cmd_someday))
    app.add_handler(CommandHandler("projects", cmd_projects))
    app.add_handler(CommandHandler("process", cmd_process))

    app.add_handler(CommandHandler("q1", cmd_q1))
    app.add_handler(CommandHandler("q2", cmd_q2))
    app.add_handler(CommandHandler("q3", cmd_q3))
    app.add_handler(CommandHandler("q4", cmd_q4))

    app.add_handler(CommandHandler("overdue", cmd_overdue))
    app.add_handler(CommandHandler("today", cmd_today))
    app.add_handler(CommandHandler("list", cmd_list))

    app.add_handler(CommandHandler("summary", cmd_summary))
    app.add_handler(CommandHandler("review", cmd_review))

    app.add_handler(CommandHandler("link", cmd_link))
    app.add_handler(CommandHandler("webapp", cmd_webapp))
    app.add_handler(CommandHandler("claim", cmd_claim))
    app.add_handler(CommandHandler("sub", cmd_sub))
    app.add_handler(CommandHandler("note", cmd_note))

    # General callback handler (for inline buttons)
    app.add_handler(CallbackQueryHandler(handle_callback))

    # Text input handler for subtask/note (low priority, after conversations)
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text_input), group=1)

    # File upload handler for attachments
    app.add_handler(MessageHandler(
        filters.Document.ALL | filters.PHOTO | filters.VIDEO | filters.AUDIO | filters.VOICE,
        handle_file_upload,
    ), group=1)

    # ── Schedule Eisenhower recalculation ──
    job_queue = app.job_queue
    job_queue.run_repeating(
        eisenhower_job,
        interval=EISENHOWER_INTERVAL_MINUTES * 60,
        first=10,  # Start 10 seconds after boot
    )

    # ── Schedule daily summary ──
    tz = pytz.timezone(TIMEZONE)
    job_queue.run_daily(
        daily_summary_job,
        time=dtime(hour=DAILY_SUMMARY_HOUR, minute=DAILY_SUMMARY_MINUTE, tzinfo=tz),
        name="daily_summary",
    )

    # ── Schedule weekly review ──
    job_queue.run_daily(
        weekly_review_job,
        time=dtime(hour=WEEKLY_REVIEW_HOUR, minute=WEEKLY_REVIEW_MINUTE, tzinfo=tz),
        days=(WEEKLY_REVIEW_DAY,),
        name="weekly_review",
    )

    # ── Set bot commands ──
    async def post_init(application):
        commands = [
            BotCommand("start", "Welcome & info"),
            BotCommand("help", "Daftar semua command"),
            BotCommand("add", "Tambah task (guided)"),
            BotCommand("quick", "Quick add satu baris"),
            BotCommand("view", "Detail task + subtask + file"),
            BotCommand("edit", "Edit task"),
            BotCommand("done", "Tandai selesai"),
            BotCommand("delete", "Hapus task"),
            BotCommand("inbox", "Lihat inbox"),
            BotCommand("next", "Next actions"),
            BotCommand("waiting", "Waiting for"),
            BotCommand("someday", "Someday/maybe"),
            BotCommand("projects", "Daftar project aktif"),
            BotCommand("process", "Proses inbox"),
            BotCommand("q1", "🔥 Q1 Do"),
            BotCommand("q2", "📅 Q2 Schedule"),
            BotCommand("q3", "👋 Q3 Delegate"),
            BotCommand("q4", "🗑 Q4 Eliminate"),
            BotCommand("list", "Filter & list tasks"),
            BotCommand("overdue", "Task overdue"),
            BotCommand("today", "Fokus hari ini + Pomodoro"),
            BotCommand("summary", "Dashboard visual"),
            BotCommand("review", "Weekly review"),
            BotCommand("sub", "Tambah subtask"),
            BotCommand("note", "Tambah catatan"),
            BotCommand("link", "Sync dengan akun web"),
            BotCommand("webapp", "Login ke webapp (link sekali pakai)"),
        ]
        await application.bot.set_my_commands(commands)

    app.post_init = post_init

    logger.info("🚀 TaskFlow V4 starting...")
    logger.info(f"   Eisenhower recalc interval: {EISENHOWER_INTERVAL_MINUTES}m")
    logger.info(f"   Daily summary: {DAILY_SUMMARY_HOUR:02d}:{DAILY_SUMMARY_MINUTE:02d} ({TIMEZONE})")
    days_name = ["Senin","Selasa","Rabu","Kamis","Jumat","Sabtu","Minggu"]
    logger.info(f"   Weekly review: {days_name[WEEKLY_REVIEW_DAY]} {WEEKLY_REVIEW_HOUR:02d}:{WEEKLY_REVIEW_MINUTE:02d} ({TIMEZONE})")
    logger.info(f"   Allowed users: {ALLOWED_USER_IDS or 'ALL'}")

    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
