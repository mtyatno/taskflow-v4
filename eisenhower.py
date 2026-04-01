"""
TaskFlow V4 - Eisenhower Quadrant Calculator

Calculates Eisenhower quadrants dynamically based on:
  - Priority (P1-P4) → importance score
  - Deadline proximity → urgency score

Matrix:
  Q1 = urgent + important     → DO NOW
  Q2 = important + not urgent  → SCHEDULE
  Q3 = urgent + not important  → DELEGATE
  Q4 = not urgent + not important → ELIMINATE

Runs automatically every N minutes (configurable).
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Optional

from models import Task, Priority, Quadrant

logger = logging.getLogger(__name__)

# ── Scoring thresholds ─────────────────────────────────────────────────────────

# Importance: derived from user-set priority (static)
IMPORTANCE_MAP = {
    Priority.P1: 10,   # Critical  → always important
    Priority.P2: 7,    # High      → important
    Priority.P3: 4,    # Medium    → borderline
    Priority.P4: 1,    # Low       → not important
}
IMPORTANCE_THRESHOLD = 5  # >= 5 is "important"

# Urgency: derived from deadline proximity (dynamic)
URGENCY_NO_DEADLINE = 2         # No deadline = low urgency
URGENCY_OVERDUE_BONUS = 10      # Overdue tasks are very urgent
URGENCY_THRESHOLD = 5           # >= 5 is "urgent"

# Days → urgency mapping
URGENCY_BRACKETS = [
    (0, 10),    # Due today       → very urgent
    (1, 9),     # Due tomorrow
    (3, 7),     # Due within 3 days
    (7, 5),     # Due within a week → threshold
    (14, 3),    # Due within 2 weeks
    (30, 2),    # Due within a month
]


def _urgency_score(task: Task) -> int:
    """Calculate urgency score from deadline proximity."""
    if task.deadline is None:
        return URGENCY_NO_DEADLINE

    days_left = (task.deadline - date.today()).days

    if days_left < 0:
        return URGENCY_OVERDUE_BONUS

    for max_days, score in URGENCY_BRACKETS:
        if days_left <= max_days:
            return score

    return 1  # Far away deadline


def _importance_score(task: Task) -> int:
    """Calculate importance score from priority."""
    return IMPORTANCE_MAP.get(task.priority, 4)


def calculate_quadrant(task: Task) -> Quadrant:
    """Determine Eisenhower quadrant for a single task."""
    urgent = _urgency_score(task) >= URGENCY_THRESHOLD
    important = _importance_score(task) >= IMPORTANCE_THRESHOLD

    if urgent and important:
        return Quadrant.Q1
    elif important and not urgent:
        return Quadrant.Q2
    elif urgent and not important:
        return Quadrant.Q3
    else:
        return Quadrant.Q4


def recalculate_all(repo) -> int:
    """
    Recalculate Eisenhower quadrants for all active tasks.
    Returns the number of tasks that changed quadrant.
    """
    tasks = repo.list_for_eisenhower_calc()
    changed = 0

    for task in tasks:
        new_q = calculate_quadrant(task)
        if new_q != task.quadrant:
            repo.update_quadrant(task.id, new_q)
            logger.info(f"Task #{task.id} '{task.title}': {task.quadrant.value} → {new_q.value}")
            changed += 1

    if changed:
        logger.info(f"Eisenhower recalc: {changed}/{len(tasks)} tasks updated")
    return changed
