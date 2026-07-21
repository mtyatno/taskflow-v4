"""Weekly Review AI layer. TASKS-ONLY: this module must never import or read
notes/scratchpad data. Only the WHITELIST fields below leave the server.
Multi-provider: OpenRouter (default) or DeepSeek direct API, both via
OpenAI-compatible chat-completions. Set AI_PROVIDER in .env to switch."""
import os
import config as appconfig
from datetime import date, datetime

WHITELIST = ["id", "title", "description", "gtd_status", "quadrant",
             "priority", "deadline", "project", "age_days", "is_overdue",
             "blocks_count", "waiting_for"]


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


def build_payload(tasks: list, queue=None) -> dict:
    """Reduce full task dicts to whitelisted fields + aggregate counts/signals.

    blocks_count = number of active (non-done/archived) child tasks (parent_id
    pointing at this task) — the only honest basis for "menahan N task lain".
    Optional `queue` (ordered task_ids the frontend wants annotated) is echoed
    back, clamped to ids that exist and capped at 15."""
    # pre-pass: active child count per parent id
    child_count = {}
    for t in tasks:
        pid = t.get("parent_id")
        if pid and t.get("gtd_status") not in ("done", "archived"):
            child_count[pid] = child_count.get(pid, 0) + 1

    out_tasks = []
    counts = {"inbox": 0, "next": 0, "waiting": 0, "someday": 0,
              "overdue": 0, "total": 0}
    p1_overdue = 0
    oldest_overdue_days = 0
    proj_has_next = {}      # project -> bool (any task with gtd_status == 'next')
    proj_seen = set()
    computed = {"age_days", "blocks_count"}
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
        item = {k: t.get(k) for k in WHITELIST if k not in computed}
        item["age_days"] = age
        item["blocks_count"] = child_count.get(t.get("id"), 0)
        out_tasks.append(item)
    projects_without_next = sum(
        1 for p in proj_seen if not proj_has_next.get(p))
    signals = {"p1_overdue": p1_overdue,
               "oldest_overdue_days": oldest_overdue_days,
               "projects_without_next": projects_without_next}
    result = {"counts": counts, "tasks": out_tasks, "signals": signals}
    if queue:
        valid = {str(t.get("id")) for t in tasks}
        q = [str(i) for i in queue if str(i) in valid][:15]
        if q:
            result["queue"] = q
    return result


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
                               "directive": {"type": "string"},
                               "why": {"type": "string"}},
                "required": ["task_id", "directive", "why"],
            },
        },
    },
    "required": ["verdict", "annotations"],
}

REVIEW_SYSTEM_PROMPT = (
    "Kamu seorang manajer yang memberi user briefing 5 menit untuk minggu ini, "
    "berdasarkan ringkasan TUGAS-nya (judul, status GTD, quadrant Eisenhower, "
    "prioritas, deadline, project, umur, blocks_count = jumlah task lain yang "
    "tertahan oleh task ini, waiting_for) dan blok 'signals' (agregat: "
    "p1_overdue, oldest_overdue_days, projects_without_next). Bahasa Indonesia, "
    "tegas dan to the point seperti atasan yang paham prioritas.\n"
    "- verdict: TEPAT 1 kalimat kondisi minggu ini. Jika signals.p1_overdue > 0 "
    "  atau banyak task Q1 overdue, sebut tumpukan itu sebagai titik macet utama.\n"
    "- annotations: untuk SETIAP task, beri {task_id, directive, why}.\n"
    "  - directive: perintah singkat MAKS 4 kata soal KAPAN/aksi, kata kerja di "
    "    depan. Contoh: 'Kerjakan hari ini', 'Jadwalkan minggu ini', "
    "    'Tindak lanjut', 'Tunggu kabar', 'Pecah jadi langkah'.\n"
    "  - why: TEPAT 1 kalimat singkat (maks ~18 kata) yang menjawab 'kenapa ini "
    "    sekarang?'. WAJIB pakai angka/sinyal NYATA dari data: hari overdue / "
    "    menuju deadline, blocks_count (sebut 'menahan N task lain' HANYA jika "
    "    blocks_count > 0), status P1/Q1, project mandek, atau waiting_for. "
    "    DILARANG mengarang angka atau relasi. Jika tak ada sinyal kuat, beri "
    "    alasan jujur yang ringan (mis. 'biar inbox bersih').\n"
    "  - Jika diberikan daftar 'queue' berisi task_id, WAJIB beri tepat satu "
    "    anotasi untuk SETIAP id di queue, urut sesuai queue, dan JANGAN "
    "    menganotasi id di luar queue. Jika tidak ada 'queue', anotasi maksimal "
    "    5 task paling layak ditindak.\n"
    "  - task_id WAJIB dari data yang diberikan; jangan mengarang id.\n"
    "Jangan menyertakan data selain yang diberikan."
)


# Provider registry. Add new providers here. All use OpenAI-compatible
# chat-completions, so the only differences are URL, key env var, default model,
# and optional extra headers. Set AI_PROVIDER in .env to switch.
PROVIDERS = {
    "openrouter": {
        "url": "https://openrouter.ai/api/v1/chat/completions",
        "key_env": "OPENROUTER_API_KEY",
        "default_model": "anthropic/claude-sonnet-5",
        "extra_headers": {"X-Title": "TaskFlow"},
    },
    "deepseek": {
        "url": "https://api.deepseek.com/v1/chat/completions",
        "key_env": "DEEPSEEK_API_KEY",
        "default_model": "deepseek-chat",
        "extra_headers": {},
    },
}


def _call_llm(*, messages, max_tokens=2000, timeout=45, response_format=None,
              extra_headers=None, provider=None) -> str:
    """Call the configured AI provider with auto-fallback. Returns model text content.

    AI_PROVIDER can be a single name or comma-separated list for fallback:
    "openrouter,deepseek" = try openrouter first, fall back to deepseek.
    On total failure raises AIReviewError (→ HTTP 503 in the route)."""
    import requests  # lazy import so unit tests don't need network
    raw = provider or getattr(appconfig, "AI_PROVIDER", "openrouter")
    provider_names = [n.strip() for n in raw.split(",") if n.strip()]
    if not provider_names:
        provider_names = ["openrouter"]
    last_error = None
    for provider_name in provider_names:
        p = PROVIDERS.get(provider_name)
        if not p:
            last_error = AIReviewError(f"unknown AI provider: {provider_name!r}")
            continue
        api_key = os.getenv(p["key_env"])
        if not api_key:
            last_error = AIReviewError(f"{p['key_env']} not configured")
            continue
        model = os.getenv("AI_MODEL", p["default_model"])
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        if p["extra_headers"]:
            headers.update(p["extra_headers"])
        if extra_headers:
            headers.update(extra_headers)
        body = {"model": model, "messages": messages, "max_tokens": max_tokens}
        if response_format:
            body["response_format"] = response_format
        try:
            r = requests.post(p["url"], headers=headers, json=body, timeout=timeout)
            if r.status_code == 200:
                try:
                    return r.json()["choices"][0]["message"]["content"].strip()
                except (ValueError, KeyError, IndexError, TypeError) as e:
                    last_error = AIReviewError(f"bad {provider_name} response: {e}")
                    continue
            else:
                last_error = AIReviewError(f"{provider_name} HTTP {r.status_code}: {r.text[:200]}")
        except requests.RequestException as e:
            last_error = AIReviewError(f"{provider_name} request failed: {e}")
    raise last_error or AIReviewError("no AI provider configured")


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
    user_msg = (
        json.dumps(payload, ensure_ascii=False)
        + "\n\nBalas HANYA dengan satu objek JSON valid sesuai skema: "
        '{"verdict": str, "annotations": [{"task_id": str, "directive": str, '
        '"why": str}]}. Tanpa teks atau markdown apa pun di luar JSON.'
    )
    content = _call_llm(
        messages=[
            {"role": "system", "content": REVIEW_SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        max_tokens=6000,
        timeout=60,
        response_format={"type": "json_object"},
        extra_headers={"X-Title": "TaskFlow Weekly Review"},
    )
    # DeepSeek doesn't have a reasoning field, so reasoning is always empty
    return parse_review_content(content, reasoning="")
