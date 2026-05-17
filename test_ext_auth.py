import requests, json

BASE = "http://localhost:8080"
s = requests.Session()

# Login dulu
r = s.post(f"{BASE}/api/auth/login", json={"username": "admin", "password": "admin123"})
assert r.status_code == 200, f"Login failed: {r.text}"
token = r.json()["access_token"]
s.headers["Authorization"] = f"Bearer {token}"

# 1. Begin — dapat state
r = requests.post(f"{BASE}/api/ext-auth/begin")
assert r.status_code == 200, f"begin failed: {r.text}"
state = r.json()["state"]
assert len(state) == 36, f"state bukan UUID: {state}"
print("begin: OK", state[:8])

# 2. Poll sebelum confirm — harus pending
r = requests.get(f"{BASE}/api/ext-auth/poll", params={"state": state})
assert r.status_code == 200, f"poll failed: {r.text}"
assert r.json().get("pending") is True, f"expected pending: {r.json()}"
print("poll pending: OK")

# 3. Confirm — pakai session yang sudah login
r = s.post(f"{BASE}/api/ext-auth/confirm", json={"state": state})
assert r.status_code == 200, f"confirm failed: {r.text}"
print("confirm: OK")

# 4. Poll setelah confirm — harus dapat token
r = requests.get(f"{BASE}/api/ext-auth/poll", params={"state": state})
assert r.status_code == 200, f"poll after confirm failed: {r.text}"
ext_token = r.json().get("token")
assert ext_token, f"token tidak ada: {r.json()}"
print("poll with token: OK", ext_token[:20], "...")

# 5. Pakai ext token untuk clip note
clip_headers = {"Authorization": f"Bearer {ext_token}"}
r = requests.post(f"{BASE}/api/scratchpad", json={
    "title": "Test Clip — GitHub",
    "content": "**Source:** https://github.com\n\n> Social coding platform",
    "tags": ["bookmark"]
}, headers=clip_headers)
assert r.status_code == 200, f"clip failed: {r.text}"
note_id = r.json()["id"]
assert note_id, f"note id tidak ada: {r.json()}"
print("clip note: OK", note_id)

# 6. Poll dengan state yang sudah NULL — harus 404
r = requests.get(f"{BASE}/api/ext-auth/poll", params={"state": state})
assert r.status_code == 404, f"expected 404 after claim: {r.status_code}"
print("poll after claim: OK (404)")

# 7. Revoke
r = requests.delete(f"{BASE}/api/ext-auth/revoke", headers=clip_headers)
assert r.status_code == 200, f"revoke failed: {r.text}"
print("revoke: OK")

# 8. Clip setelah revoke — harus 401
r = requests.post(f"{BASE}/api/scratchpad", json={
    "title": "Should fail",
    "content": "test",
    "tags": ["bookmark"]
}, headers=clip_headers)
assert r.status_code == 401, f"expected 401 after revoke: {r.status_code}"
print("clip after revoke: OK (401)")

# Cleanup: hapus note test
s.delete(f"{BASE}/api/scratchpad/{note_id}")
print("\nALL PASSED ✓")
