"""Weekly Review AI layer. TASKS-ONLY: this module must never import or read
notes/scratchpad data. Only the WHITELIST fields below leave the server.
Provider: OpenRouter (OpenAI-compatible chat-completions), so the API key works
where Anthropic's own billing was unavailable. `requests` is imported lazily
inside generate_review() so this module imports (and build_payload/schema
unit-test) with no network deps."""
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
    """Reduce full task dicts to whitelisted fields + aggregate counts/signals."""
    out_tasks = []
    counts = {"inbox": 0, "next": 0, "waiting": 0, "someday": 0,
              "overdue": 0, "total": 0}
    p1_overdue = 0
    oldest_overdue_days = 0
    proj_has_next = {}      # project -> bool (any task with gtd_status == 'next')
    proj_seen = set()
    for t in tasks:
        gs = t.get("gtd_status")
        counts["total"] += 1
        if gs in counts:
            counts[gs] += 1
        age = _age_days(t)
        if t.get("is_overdue"):
            counts["overdue"] += 1
            if t.get("priority") == "P1":
                p1_overdue += 1
            if age > oldest_overdue_days:
                oldest_overdue_days = age
        proj = t.get("project")
        if proj:
            proj_seen.add(proj)
            if gs == "next":
                proj_has_next[proj] = True
        item = {k: t.get(k) for k in WHITELIST if k != "age_days"}
        item["age_days"] = age
        out_tasks.append(item)
    projects_without_next = sum(
        1 for p in proj_seen if not proj_has_next.get(p))
    signals = {"p1_overdue": p1_overdue,
               "oldest_overdue_days": oldest_overdue_days,
               "projects_without_next": projects_without_next}
    return {"counts": counts, "tasks": out_tasks, "signals": signals}


REVIEW_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "verdict": {"type": "string"},
        "annotations": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "properties": {"task_id": {"type": "string"},
                               "note": {"type": "string"}},
                "required": ["task_id", "note"],
            },
        },
    },
    "required": ["verdict", "annotations"],
}

REVIEW_SYSTEM_PROMPT = (
    "Kamu asisten GTD untuk aplikasi task. Berdasarkan ringkasan TUGAS user "
    "(judul, status GTD, quadrant Eisenhower, prioritas, deadline, project, umur) "
    "dan blok 'signals' (agregat: p1_overdue, oldest_overdue_days, "
    "projects_without_next), bantu user me-review minggunya dalam Bahasa Indonesia. "
    "Keluaranmu HANYA detailing; aplikasi sudah menyusun antrian aksinya sendiri.\n"
    "- verdict: TEPAT 1 kalimat kondisi minggu ini. Jika signals.p1_overdue > 0 "
    "  atau banyak task Q1 overdue, sebut tumpukan itu sebagai titik macet utama.\n"
    "- annotations: maksimal 5 item untuk task PALING layak ditindak. Tiap item "
    "  {task_id, note}; note = 1 baris singkat 'kenapa penting / lakukan apa' "
    "  (kata kerja di depan). task_id WAJIB dari daftar yang diberikan; jangan "
    "  mengarang id.\n"
    "Jangan menyertakan data selain yang diberikan. Ringkas dan actionable."
)


# OpenRouter (OpenAI-compatible). Pick the exact model slug from
# https://openrouter.ai/models and set AI_MODEL in .env (default below is a
# safe fallback; override it). On any failure we raise AIReviewError, which the
# route turns into HTTP 503 and the UI shows as "Gagal membuat ringkasan AI".
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "anthropic/claude-sonnet-4"


def parse_review_content(content, reasoning="") -> dict:
    """Turn raw model output into the review dict, defensively.

    Free models often ignore `response_format` and wrap the JSON in prose or
    code fences; reasoning models (e.g. R1) may leave `content` empty and put
    the answer in `reasoning`. We: prefer content, fall back to reasoning,
    strip code fences, try a direct parse, then recover the first {...} block.
    On total failure we echo a snippet so the real model output is diagnosable
    (a content-safety/moderation model, say, returns a verdict — never JSON)."""
    import json
    raw = (content or "").strip()
    if not raw:
        raw = (reasoning or "").strip()
    if not raw:
        raise AIReviewError("empty response (no content/reasoning)")
    txt = raw
    if txt.startswith("```"):  # some models wrap JSON in code fences
        txt = txt.strip("`")
        if txt[:4].lower() == "json":
            txt = txt[4:]
        txt = txt.strip()
    try:
        return json.loads(txt)
    except json.JSONDecodeError:
        pass
    start, end = txt.find("{"), txt.rfind("}")  # recover JSON embedded in prose
    if start != -1 and end > start:
        try:
            return json.loads(txt[start:end + 1])
        except json.JSONDecodeError:
            pass
    snippet = raw[:200].replace("\n", " ")
    raise AIReviewError(f"model did not return valid JSON; got: {snippet!r}")


def generate_review(payload: dict) -> dict:
    import json
    import requests  # lazy: already installed for the web service (webapp uses it)
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise AIReviewError("OPENROUTER_API_KEY not configured")
    model = os.getenv("AI_MODEL", DEFAULT_MODEL)
    user_msg = (
        json.dumps(payload, ensure_ascii=False)
        + "\n\nBalas HANYA dengan satu objek JSON valid sesuai skema: "
        '{"verdict": str, "annotations": [{"task_id": str, "note": str}]}. '
        "Tanpa teks atau markdown apa pun di luar JSON."
    )
    try:
        r = requests.post(
            OPENROUTER_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "X-Title": "TaskFlow Weekly Review",
            },
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": REVIEW_SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                "max_tokens": 4096,
                "response_format": {"type": "json_object"},
            },
            timeout=60,
        )
    except requests.RequestException as e:
        raise AIReviewError(f"OpenRouter request failed: {e}") from e
    if r.status_code != 200:
        raise AIReviewError(f"OpenRouter HTTP {r.status_code}: {r.text[:200]}")
    try:
        data = r.json()
        msg = data["choices"][0]["message"]
        content = msg.get("content")
        reasoning = msg.get("reasoning") or ""
    except (ValueError, KeyError, IndexError, TypeError) as e:
        raise AIReviewError(f"bad OpenRouter response: {e}") from e
    return parse_review_content(content, reasoning)
