import json
import ai_review

SAMPLE = [
    {"id": "t1", "title": "Submit FIN report", "description": "weekly",
     "gtd_status": "next", "quadrant": "Q1", "priority": "P1",
     "deadline": "2026-06-26", "project": "Monetisasi", "is_overdue": False,
     "updated_at": "2026-06-10T00:00:00", "secret_note": "DO NOT SEND"},
]

def test_build_payload_only_whitelisted_keys():
    out = ai_review.build_payload(SAMPLE)
    assert set(out.keys()) == {"counts", "tasks", "signals"}
    t = out["tasks"][0]
    assert set(t.keys()) <= set(ai_review.WHITELIST)
    assert "secret_note" not in t
    assert t["title"] == "Submit FIN report"
    assert isinstance(t.get("age_days"), int)

def test_build_payload_never_leaks_notes_field():
    tasks = [dict(SAMPLE[0], note_content="PRIVATE", linked_note="x")]
    out = ai_review.build_payload(tasks)
    blob = json.dumps(out)
    assert "PRIVATE" not in blob and "note_content" not in blob

def test_no_notes_module_imported():
    import re
    src = open("ai_review.py", encoding="utf-8").read()
    import_lines = [l for l in src.splitlines() if re.match(r"\s*(import|from)\s", l)]
    joined = "\n".join(import_lines).lower()
    for banned in ("scratchpad", "noterepo", "notequery", "note"):
        assert banned not in joined, f"ai_review must not import {banned}"

def test_schema_is_verdict_annotations():
    s = ai_review.REVIEW_SCHEMA
    assert s["type"] == "object"
    assert s["additionalProperties"] is False
    assert set(s["properties"].keys()) == {"verdict", "annotations"}
    assert set(s["required"]) == {"verdict", "annotations"}
    ann = s["properties"]["annotations"]["items"]
    assert set(ann["properties"].keys()) == {"task_id", "note"}


VALID = '{"summary": "ok", "focus_suggestions": [], "stalled_projects": [], "reflective_questions": []}'


def test_parse_plain_json():
    out = ai_review.parse_review_content(VALID)
    assert out["summary"] == "ok"


def test_parse_code_fenced_json():
    fenced = "```json\n" + VALID + "\n```"
    assert ai_review.parse_review_content(fenced)["summary"] == "ok"


def test_parse_prose_wrapped_json():
    prose = "Tentu, ini reviewnya:\n" + VALID + "\nSemoga membantu!"
    assert ai_review.parse_review_content(prose)["summary"] == "ok"


def test_parse_reasoning_fallback_when_content_empty():
    # reasoning-style models (e.g. R1) may leave content empty
    out = ai_review.parse_review_content("", reasoning=VALID)
    assert out["summary"] == "ok"


def test_parse_empty_raises():
    try:
        ai_review.parse_review_content("   ", reasoning="")
        assert False, "expected AIReviewError"
    except ai_review.AIReviewError:
        pass


def test_parse_non_json_raises_with_snippet():
    # a content-safety/moderation model returns a verdict, not JSON
    try:
        ai_review.parse_review_content("UNSAFE: category=violence")
        assert False, "expected AIReviewError"
    except ai_review.AIReviewError as e:
        assert "UNSAFE" in str(e)  # snippet echoed for diagnosis


def test_build_payload_has_signals():
    tasks = [
        {"id": "a", "gtd_status": "next", "priority": "P1", "is_overdue": True,
         "project": "Alpha", "updated_at": "2026-06-01T00:00:00"},
        {"id": "b", "gtd_status": "inbox", "priority": "P2", "is_overdue": True,
         "project": "Beta", "updated_at": "2026-06-20T00:00:00"},
        {"id": "c", "gtd_status": "inbox", "priority": "P3", "project": "Beta"},
    ]
    sig = ai_review.build_payload(tasks)["signals"]
    assert sig["p1_overdue"] == 1
    # Alpha has only an overdue 'next' (counts as having a next); Beta has no 'next'
    assert sig["projects_without_next"] == 1
    # task "a" is the oldest overdue; its age must lead and be a non-negative int
    assert isinstance(sig["oldest_overdue_days"], int)
    assert sig["oldest_overdue_days"] == ai_review._age_days(tasks[0])


def test_signals_empty_task_list():
    sig = ai_review.build_payload([])["signals"]
    assert sig == {"p1_overdue": 0, "oldest_overdue_days": 0,
                   "projects_without_next": 0}


def test_signals_never_leak_non_whitelisted():
    tasks = [dict(SAMPLE[0], note_content="PRIVATE")]
    blob = json.dumps(ai_review.build_payload(tasks))
    assert "PRIVATE" not in blob and "note_content" not in blob


def test_prompt_mentions_quadrant_and_overdue_priority():
    p = ai_review.REVIEW_SYSTEM_PROMPT.lower()
    assert "quadrant" in p
    assert "p1" in p and "overdue" in p
    assert "signals" in p
    assert "verdict" in p and "annotations" in p
