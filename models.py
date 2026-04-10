"""
TaskFlow V4 - Models

GTD Status : inbox → next | waiting | someday | project → done | archived
Priority   : P1 (critical) → P2 (high) → P3 (medium) → P4 (low)
Eisenhower : Q1 (urgent+important) Q2 (important) Q3 (urgent) Q4 (neither)
             Auto-calculated every 15 minutes based on priority + deadline proximity.
"""
from __future__ import annotations

import enum
from dataclasses import dataclass, field
from datetime import datetime, date
from typing import Optional


# ── Enums ──────────────────────────────────────────────────────────────────────

class GTDStatus(str, enum.Enum):
    INBOX = "inbox"
    NEXT = "next"
    WAITING = "waiting"
    SOMEDAY = "someday"
    PROJECT = "project"
    DONE = "done"
    ARCHIVED = "archived"

    @classmethod
    def active_statuses(cls) -> list[GTDStatus]:
        return [cls.INBOX, cls.NEXT, cls.WAITING, cls.SOMEDAY]

    @classmethod
    def from_str(cls, value: str) -> GTDStatus:
        value = value.strip().lower()
        for member in cls:
            if member.value == value:
                return member
        raise ValueError(f"Unknown GTD status: {value}")


class Priority(str, enum.Enum):
    P1 = "P1"  # Critical
    P2 = "P2"  # High
    P3 = "P3"  # Medium
    P4 = "P4"  # Low

    @classmethod
    def from_str(cls, value: str) -> Priority:
        value = value.strip().upper()
        for member in cls:
            if member.value == value:
                return member
        raise ValueError(f"Unknown priority: {value}")

    @property
    def label(self) -> str:
        labels = {"P1": "🔴 Critical", "P2": "🟠 High", "P3": "🟡 Medium", "P4": "🟢 Low"}
        return labels[self.value]


class Quadrant(str, enum.Enum):
    Q1 = "Q1"  # Urgent & Important   → DO
    Q2 = "Q2"  # Important, not urgent → SCHEDULE
    Q3 = "Q3"  # Urgent, not important → DELEGATE
    Q4 = "Q4"  # Neither              → ELIMINATE

    @property
    def label(self) -> str:
        labels = {
            "Q1": "🔥 Q1 Do",
            "Q2": "📅 Q2 Schedule",
            "Q3": "👋 Q3 Delegate",
            "Q4": "🗑️ Q4 Eliminate",
        }
        return labels[self.value]


# ── Task Dataclass ─────────────────────────────────────────────────────────────

@dataclass
class Task:
    id: int = 0
    title: str = ""
    description: str = ""
    gtd_status: GTDStatus = GTDStatus.INBOX
    priority: Priority = Priority.P3
    quadrant: Quadrant = Quadrant.Q4
    project: str = ""
    context: str = ""           # GTD context e.g. @phone, @computer
    deadline: Optional[date] = None
    waiting_for: str = ""       # Who/what are we waiting for
    is_focused: bool = False
    list_id: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    @property
    def is_active(self) -> bool:
        return self.gtd_status in GTDStatus.active_statuses()

    @property
    def is_overdue(self) -> bool:
        if self.deadline and self.is_active:
            return self.deadline < date.today()
        return False

    @property
    def days_until_deadline(self) -> Optional[int]:
        if self.deadline:
            return (self.deadline - date.today()).days
        return None

    def format_short(self) -> str:
        """Card-style display for lists."""
        pri_icon = {"P1": "🔴", "P2": "🟠", "P3": "🟡", "P4": "🟢"}
        icon = pri_icon.get(self.priority.value, "⚪")

        line1 = f"{icon}  <b>{self.title}</b>"
        
        tags = []
        tags.append(f"#{self.id}")
        tags.append(self.priority.value)
        tags.append(self.quadrant.value)
        if self.project:
            tags.append(f"📁 {self.project}")
        if self.context:
            tags.append(self.context)
        
        line2 = "      " + "  ·  ".join(tags)

        if self.deadline:
            dl = self.deadline.strftime("%d-%m-%Y")
            days = self.days_until_deadline
            if self.is_overdue:
                line2 += f"\n      ⚠️ {dl}  (terlambat {abs(days)} hari)"
            elif days is not None and days <= 3:
                line2 += f"\n      ⏰ {dl}  ({days} hari lagi)"
            else:
                line2 += f"\n      📅 {dl}"

        return f"{line1}\n{line2}"

    def format_detail(self) -> str:
        """Full detail card."""
        lines = [
            f"📋 <b>Task #{self.id}</b>",
            f"<b>{self.title}</b>",
            "",
            f"🔄 GTD: <code>{self.gtd_status.value}</code>",
            f"🎯 Priority: {self.priority.label}",
            f"📊 Eisenhower: {self.quadrant.label}",
        ]
        if self.project:
            lines.append(f"📁 Project: {self.project}")
        if self.context:
            lines.append(f"🏷️ Context: {self.context}")
        if self.deadline:
            dl = self.deadline.strftime("%d-%m-%Y")
            days = self.days_until_deadline
            if self.is_overdue:
                lines.append(f"📅 Deadline: {dl} ⚠️ <b>OVERDUE ({abs(days)}d ago)</b>")
            elif days is not None and days <= 3:
                lines.append(f"📅 Deadline: {dl} ⏰ <b>{days}d left</b>")
            else:
                lines.append(f"📅 Deadline: {dl}")
        if self.waiting_for:
            lines.append(f"⏳ Waiting for: {self.waiting_for}")
        if self.description:
            lines.append(f"\n📝 {self.description}")
        if self.created_at:
            lines.append(f"\n🕐 Created: {self.created_at.strftime('%d-%m-%Y %H:%M')}")
        if self.completed_at:
            lines.append(f"✅ Completed: {self.completed_at.strftime('%d-%m-%Y %H:%M')}")
        return "\n".join(lines)
