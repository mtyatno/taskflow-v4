"""
TaskFlow V4 - Date Parser Utility

Supports Indonesian date format DD-MM-YYYY and various natural language dates.
Uses dateparser with DATE_ORDER: DMY setting.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Optional

import dateparser


def parse_date(text: str) -> Optional[date]:
    """
    Parse a date string in various formats.

    Supports:
      - DD-MM-YYYY, DD/MM/YYYY
      - "besok" / "tomorrow"
      - "lusa" (day after tomorrow)
      - "+3d" (3 days from now)
      - Natural language via dateparser
    """
    text = text.strip().lower()

    # Shortcuts
    if text in ("hari ini", "today"):
        return date.today()
    if text in ("besok", "tomorrow"):
        return date.today() + timedelta(days=1)
    if text in ("lusa",):
        return date.today() + timedelta(days=2)

    # Relative: +Nd
    m = re.match(r"^\+(\d+)d$", text)
    if m:
        return date.today() + timedelta(days=int(m.group(1)))

    # Relative: +Nw (weeks)
    m = re.match(r"^\+(\d+)w$", text)
    if m:
        return date.today() + timedelta(weeks=int(m.group(1)))

    # ISO format YYYY-MM-DD (from HTML date input — must handle before dateparser)
    iso_m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})$", text)
    if iso_m:
        try:
            return date(int(iso_m.group(1)), int(iso_m.group(2)), int(iso_m.group(3)))
        except ValueError:
            pass

    # Try dateparser with DMY order (Indonesian style)
    result = dateparser.parse(
        text,
        settings={
            "DATE_ORDER": "DMY",
            "PREFER_DATES_FROM": "future",
            "RETURN_AS_TIMEZONE_AWARE": False,
        },
    )
    if result:
        return result.date()

    return None


def format_date(d: date) -> str:
    """Format date as DD-MM-YYYY."""
    return d.strftime("%d-%m-%Y")
