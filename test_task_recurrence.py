import requests, json

BASE = "http://localhost:8000"
s = requests.Session()

r = s.post(f"{BASE}/api/auth/login", json={"username": "admin", "password": "admin123"})
assert r.status_code == 200, f"Login failed: {r.text}"
token = r.json()["access_token"]
s.headers["Authorization"] = f"Bearer {token}"

# Create recurring task
r = s.post(f"{BASE}/api/tasks", json={
    "title": "Test Recurring Weekly",
    "priority": "P3",
    "recurrence_type": "weekly",
    "recurrence_days": [0, 2, 4]
})
assert r.status_code == 200, r.text
t = r.json()
assert t["recurrence_type"] == "weekly", t
assert t["recurrence_end_date"] is not None, t
print("Create recurring: OK", t["id"], t["recurrence_end_date"])

task_id = t["id"]

# Update with renew
r = s.put(f"{BASE}/api/tasks/{task_id}", json={"recurrence_renew": True})
assert r.status_code == 200, r.text
t2 = r.json()
assert t2["recurrence_notif_level"] is None, t2
print("Renew: OK", t2["recurrence_end_date"])

print("ALL PASSED")
