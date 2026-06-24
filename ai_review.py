"""Weekly Review AI layer. TASKS-ONLY: this module must never import or read
notes/scratchpad data. Only the WHITELIST fields below leave the server.
NOTE: `anthropic` is imported lazily inside generate_review() so this module
imports (and build_payload/schema unit-test) without the SDK installed."""
import os
from datetime import date, datetime

WHITELIST = ["id", "title", "description", "gtd_status", "quadrant",
             "priority", "deadline", "project", "age_days", "is_overdue"]


class AIReviewError(Exception):
    pass


def _age_days(t: dict) -> int:
    raw = t.get("updated_at") or t.get("created_at")
    if not raw:
        return 0
    try:
        d = datetime.fromisoformat(str(raw).replace("Z", "")).date()
        return max(0, (date.today() - d).days)
    except Exception:
        return 0


def build_payload(tasks: list) -> dict:
    """Reduce full task dicts to whitelisted fields + aggregate counts."""
    out_tasks = []
    counts = {"inbox": 0, "next": 0, "waiting": 0, "someday": 0,
              "overdue": 0, "total": 0}
    for t in tasks:
        gs = t.get("gtd_status")
        counts["total"] += 1
        if gs in counts:
            counts[gs] += 1
        if t.get("is_overdue"):
            counts["overdue"] += 1
        item = {k: t.get(k) for k in WHITELIST if k != "age_days"}
        item["age_days"] = _age_days(t)
        out_tasks.append(item)
    return {"counts": counts, "tasks": out_tasks}


REVIEW_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "summary": {"type": "string"},
        "focus_suggestions": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "properties": {"task_id": {"type": "string"},
                               "reason": {"type": "string"}},
                "required": ["task_id", "reason"],
            },
        },
        "stalled_projects": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "properties": {
                    "project": {"type": "string"},
                    "next_actions": {
                        "type": "array",
                        "items": {
                            "type": "object", "additionalProperties": False,
                            "properties": {"title": {"type": "string"},
                                           "rationale": {"type": "string"}},
                            "required": ["title", "rationale"],
                        },
                    },
                },
                "required": ["project", "next_actions"],
            },
        },
        "reflective_questions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["summary", "focus_suggestions", "stalled_projects",
                 "reflective_questions"],
}

REVIEW_SYSTEM_PROMPT = (
    "Kamu asisten GTD untuk aplikasi task. Berdasarkan ringkasan TUGAS user "
    "(judul, status GTD, quadrant Eisenhower, prioritas, deadline, project, umur), "
    "buat review mingguan singkat dalam Bahasa Indonesia.\n"
    "- summary: 1-3 kalimat insight, soroti titik macet (mis. P1 overdue menumpuk).\n"
    "- focus_suggestions: 3-5 task PALING layak difokuskan minggu depan. task_id WAJIB "
    "  berasal dari daftar yang diberikan; jangan mengarang id.\n"
    "- stalled_projects: untuk project yang punya task tapi tidak punya next-action, "
    "  usulkan 1-2 next-action KONKRET (kata kerja di depan: 'Email...', 'Finalisasi...'), "
    "  bukan tujuan kabur.\n"
    "- reflective_questions: 1-2 pertanyaan reflektif terarah.\n"
    "Jangan menyertakan data selain yang diberikan. Ringkas dan actionable."
)


def generate_review(payload: dict) -> dict:
    import json
    import anthropic  # lazy: keeps the module importable without the SDK
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise AIReviewError("ANTHROPIC_API_KEY not configured")
    client = anthropic.Anthropic(api_key=api_key)
    try:
        resp = client.messages.create(
            model="claude-opus-4-8",
            max_tokens=4096,
            thinking={"type": "adaptive"},
            system=[{"type": "text", "text": REVIEW_SYSTEM_PROMPT,
                     "cache_control": {"type": "ephemeral"}}],
            output_config={"format": {"type": "json_schema",
                                      "schema": REVIEW_SCHEMA}},
            messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
        )
    except anthropic.APIError as e:
        raise AIReviewError(f"Claude API error: {e}") from e
    if resp.stop_reason == "refusal":
        raise AIReviewError("model refused")
    text = next((b.text for b in resp.content if b.type == "text"), None)
    if not text:
        raise AIReviewError("empty response")
    return json.loads(text)
