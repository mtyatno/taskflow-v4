"""
TaskFlow V4 — Natural Language Parser

Extracts task fields from free-form Indonesian/English text.
No external API — pure regex + dateparser.
"""
from __future__ import annotations

import re
from typing import Optional


# ── Priority keywords ──────────────────────────────────────────────────────────
_PRI_PATTERNS = [
    (r'\bp1\b', "P1"),
    (r'\b(kritis|critical|urgent|mendesak|darurat|gawat)\b', "P1"),
    (r'\bp2\b', "P2"),
    (r'\b(penting|segera|high priority|harus segera)\b', "P2"),
    (r'\bp3\b', "P3"),
    (r'\b(medium|biasa)\b', "P3"),
    (r'\bp4\b', "P4"),
    (r'\b(low|santai|tidak mendesak|kapan.kapan saja)\b', "P4"),
]

# ── GTD status keywords ────────────────────────────────────────────────────────
_GTD_PATTERNS = [
    (r'\b(someday|suatu saat|kapan.kapan|kalau sempat|mungkin nanti|ntar aja)\b', "someday"),
    (r'\b(tunggu|waiting|menunggu|nunggu|wait for|masih nunggu)\b', "waiting"),
    (r'\b(next action|selanjutnya|next|kerjakan selanjutnya)\b', "next"),
]

# ── Date phrase patterns (ordered longest → shortest to avoid partial match) ──
_DATE_PHRASES = [
    # multi-word first
    r'minggu\s+depan',
    r'pekan\s+depan',
    r'bulan\s+depan',
    r'tahun\s+depan',
    r'hari\s+ini',
    r'besok\s+lusa',
    # day+month+year
    r'\d{1,2}\s+(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)(?:\s+\d{4})?',
    r'\d{1,2}\s+(?:jan|feb|mar|apr|jun|jul|agu|sep|okt|nov|des)(?:\s+\d{4})?',
    # numeric date
    r'\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?',
    # relative
    r'\+\d+[dw]',
    # weekday (with optional "depan")
    r'(?:senin|selasa|rabu|kamis|jumat|jum.at|sabtu|ahad|minggu)(?:\s+depan)?',
    # single words
    r'lusa',
    r'besok',
    r'overdue',  # treat "overdue" as today — filtered out later
]


def parse_task(text: str) -> dict:
    """
    Parse free-form text into task fields.

    Returns dict:
      title, priority, gtd_status, project, context, deadline,
      confidence (0.0–1.0), original
    """
    original = text
    working = text.strip()

    priority = "P3"
    gtd_status = "inbox"
    project = ""
    context_tag = ""
    deadline = None
    removed_spans: list[tuple[int, int]] = []

    # ── #project ──────────────────────────────────────────────────────────────
    m = re.search(r'#(\w+)', working)
    if m:
        project = m.group(1)
        removed_spans.append(m.span())

    # ── @context ──────────────────────────────────────────────────────────────
    m = re.search(r'@(\w+)', working)
    if m:
        context_tag = "@" + m.group(1)
        removed_spans.append(m.span())

    # ── Priority ──────────────────────────────────────────────────────────────
    for pattern, pri_val in _PRI_PATTERNS:
        m = re.search(pattern, working, re.IGNORECASE)
        if m:
            priority = pri_val
            removed_spans.append(m.span())
            break

    # ── GTD hints ─────────────────────────────────────────────────────────────
    for pattern, gtd_val in _GTD_PATTERNS:
        m = re.search(pattern, working, re.IGNORECASE)
        if m:
            gtd_status = gtd_val
            removed_spans.append(m.span())
            break

    # ── Deadline ──────────────────────────────────────────────────────────────
    for date_pattern in _DATE_PHRASES:
        m = re.search(date_pattern, working, re.IGNORECASE)
        if m:
            candidate = m.group(0).strip()
            parsed_date = _try_parse_date(candidate)
            if parsed_date:
                deadline = parsed_date
                removed_spans.append(m.span())
                break

    # ── Build title by removing extracted tokens ───────────────────────────────
    removed_spans.sort(key=lambda x: x[0])
    title_chars = []
    prev_end = 0
    for start, end in removed_spans:
        if start > prev_end:
            title_chars.append(working[prev_end:start])
        prev_end = max(prev_end, end)
    title_chars.append(working[prev_end:])
    title = "".join(title_chars)

    # Clean up
    title = re.sub(r'\s+', ' ', title).strip()
    title = re.sub(r'^[\s,.\-:;]+|[\s,.\-:;]+$', '', title).strip()

    confidence = 1.0 if title else 0.0

    return {
        "title": title,
        "priority": priority,
        "gtd_status": gtd_status,
        "project": project,
        "context": context_tag,
        "deadline": deadline,
        "confidence": confidence,
        "original": original,
    }


def _try_parse_date(text: str):
    """Delegate to datehelper.parse_date."""
    from datehelper import parse_date
    return parse_date(text)


def format_confirmation(parsed: dict) -> str:
    """Build the confirmation message shown to user."""
    from datehelper import format_date

    title = parsed["title"] or "?"
    pri_icons = {"P1": "🔴 P1 Critical", "P2": "🟠 P2 High", "P3": "🟡 P3 Medium", "P4": "🟢 P4 Low"}
    gtd_icons = {
        "inbox": "📥 Inbox",
        "next": "▶️ Next",
        "waiting": "⏳ Waiting",
        "someday": "💭 Someday",
    }

    lines = [
        "📋 <b>Task terdeteksi:</b>",
        "",
        f"📝 <b>{title}</b>",
        f"🎯 {pri_icons.get(parsed['priority'], parsed['priority'])}",
        f"🔄 {gtd_icons.get(parsed['gtd_status'], parsed['gtd_status'])}",
    ]
    if parsed["deadline"]:
        lines.append(f"📅 Deadline: {format_date(parsed['deadline'])}")
    if parsed["project"]:
        lines.append(f"📁 Project: {parsed['project']}")
    if parsed["context"]:
        lines.append(f"🏷️ Context: {parsed['context']}")

    lines += ["", "<i>Simpan task ini?</i>"]
    return "\n".join(lines)
