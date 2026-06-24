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
    assert set(out.keys()) == {"counts", "tasks"}
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

def test_schema_is_strict_object():
    s = ai_review.REVIEW_SCHEMA
    assert s["type"] == "object"
    assert s["additionalProperties"] is False
    assert set(["summary", "focus_suggestions", "stalled_projects",
                "reflective_questions"]).issubset(s["properties"].keys())
