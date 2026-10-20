"""E2E: note list ikut ter-update setelah tag ditambahkan lewat editor (bug 2026-10-21). Tidak dijalankan CI.

Alur:
  a  note tanpa tag → Edit → ketik " #alpha #beta" → tunggu autosave (>2,5 dtk) → Simpan
     → kartu di note list langsung menampilkan #alpha #beta, tanpa "tanpa tag" (sebelumnya basi)
  b  Edit → ketik " #gamma" → Simpan cepat (sebelum autosave) → #gamma tampil (jalur lama, regresi)
  c  Edit → ketik " #delta" → tunggu autosave → tutup dengan ✕/Batal → #delta tampil

    python temporary_files/e2e_note_list_tags.py      (python sistem, bukan venv)
"""
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import uuid

import requests
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_note_list_tags")
PW = "rahasia123"
SECRET = "e2e-note-list-tags-secret-0123456789abcdef"
TOURS = ['dashboard', 'tasks', 'today', 'calendar', 'kanban', 'notes', 'mindmap', 'chat', 'habits', 'habit',
         'settings', 'draw', 'goals', 'review', 'focus', 'workspace', 'slist']
results = []


def check(step, ok, note=""):
    results.append((step, bool(ok)))
    print(("PASS " if ok else "FAIL ") + step + (" — " + str(note) if note else ""), flush=True)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def start_server(tmp):
    port = free_port()
    os.makedirs(os.path.join(tmp, "uploads"))
    env = dict(os.environ, DB_PATH=os.path.join(tmp, "e2e.db"), UPLOAD_DIR=os.path.join(tmp, "uploads"),
               MEDIA_ROOT=os.path.join(tmp, "media"), MEDIA_ACCEL="0", WEB_SECRET_KEY=SECRET,
               WEB_PORT=str(port), TELEGRAM_BOT_TOKEN="")
    log = open(os.path.join(tmp, "server.log"), "w")
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "webapp:app", "--host", "127.0.0.1",
                             "--port", str(port)], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
    base = "http://127.0.0.1:%d" % port
    for _ in range(120):
        try:
            if requests.get(base + "/manifest.json", timeout=1).status_code < 500:
                return proc, base
        except requests.RequestException:
            pass
        if proc.poll() is not None:
            break
        time.sleep(0.5)
    proc.kill()
    raise RuntimeError("server gagal start, lihat " + log.name)


def register(base, name):
    u = "%s%d" % (name, int(time.time() * 1000) % 10_000_000)
    r = requests.post(base + "/api/auth/register",
                      json={"username": u, "password": PW, "email": u + "@ex.com", "display_name": name})
    r.raise_for_status()
    j = r.json()
    return {"username": u, "id": j["user_id"], "token": j["token"]}


def make_note(base, user, title, content):
    r = requests.post(base + "/api/scratchpad", headers={"Authorization": "Bearer " + user["token"]},
                      json={"title": title, "content": content, "tags": [], "client_id": str(uuid.uuid4())})
    r.raise_for_status()
    return r.json()


def open_app(browser, base, user):
    ctx = browser.new_context(service_workers="block", viewport={"width": 1366, "height": 900})
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    p = ctx.new_page()
    p.errors = []
    p.on("pageerror", lambda e: p.errors.append(str(e)))
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1');
    }""", [user["token"], user["id"], TOURS])
    p.goto(base + "/")
    p.locator(".sidebar-link").first.wait_for(state="attached", timeout=30000)
    return ctx, p


def go_notes(p):
    link = p.locator(".sidebar-link").filter(has=p.locator("span", has_text=re.compile("^Notes$")))
    if link.count() == 0 or not link.first.is_visible():
        ex = p.locator("button[aria-label='Tampilkan semua menu']")
        if ex.count() and ex.first.is_visible():
            ex.first.click()
    link.first.click()


def card(p, title):
    return p.locator(".note-card").filter(has=p.locator(".note-card-title", has_text=title)).first


def edit_and_type(p, title, text):
    card(p, title).click()
    p.locator(".notes-panel-actions").first.wait_for(timeout=15000)
    p.locator(".notes-panel-actions").first.get_by_text("Edit", exact=True).click()
    pm = p.locator(".ProseMirror").first
    pm.wait_for(timeout=15000)
    # Milkdown butuh waktu inisialisasi setelah .ProseMirror muncul (mengetik terlalu dini → "editorView not found")
    p.wait_for_function("() => window.MilkdownBundle && document.querySelector('.ProseMirror[contenteditable=true]')",
                        timeout=15000)
    p.wait_for_timeout(2500)
    pm.click()
    p.keyboard.press("Control+End")
    p.keyboard.type(text, delay=30)
    p.keyboard.press("Escape")  # tutup dropdown autocomplete tag bila muncul
    word = text.strip().split()[-1]
    p.wait_for_function("w => (document.querySelector('.ProseMirror')||{}).innerText.includes(w)", arg=word, timeout=5000)
    # listener markdownUpdated Milkdown di-debounce ±200 ms: beri jeda sewajarnya sebelum menekan tombol
    p.wait_for_timeout(600)


def click_btn(p, name):
    btns = p.get_by_role("button", name=name, exact=True)
    for i in range(btns.count()):
        if btns.nth(i).is_visible():
            btns.nth(i).click()
            return
    raise RuntimeError("tombol %s tidak terlihat" % name)


def card_tags(p, title, want, timeout=6):
    end = time.time() + timeout
    txt = ""
    while time.time() < end:
        txt = card(p, title).inner_text()
        if all(("#" + w) in txt for w in want) and "tanpa tag" not in txt:
            return True, txt
        p.wait_for_timeout(200)
    return False, txt


def main():
    os.makedirs(SHOTS, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="e2e_note_list_tags_")
    proc, base = start_server(tmp)
    try:
        A = register(base, "Penulis")
        make_note(base, A, "Note Tag E2E", "Isi awal catatan")
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx, p = open_app(browser, base, A)
            go_notes(p)
            card(p, "Note Tag E2E").wait_for(timeout=20000)
            check("0 kartu awal 'tanpa tag'", "tanpa tag" in card(p, "Note Tag E2E").inner_text())

            # a: autosave lalu Simpan
            edit_and_type(p, "Note Tag E2E", " #alpha #beta ")
            p.wait_for_timeout(4500)  # autosave 2,5 dtk + PUT lokal
            click_btn(p, "Simpan")
            ok, txt = card_tags(p, "Note Tag E2E", ["alpha", "beta"])
            check("a autosave → Simpan → list menampilkan #alpha #beta", ok, txt.replace("\n", " | "))
            p.screenshot(path=os.path.join(SHOTS, "a_after_save.png"))

            # b: Simpan sebelum autosave
            edit_and_type(p, "Note Tag E2E", " #gamma ")
            click_btn(p, "Simpan")
            ok, txt = card_tags(p, "Note Tag E2E", ["alpha", "beta", "gamma"])
            check("b Simpan cepat → list menampilkan #gamma", ok, txt.replace("\n", " | "))

            # c: autosave lalu tutup tanpa Simpan (Esc / tombol tutup)
            edit_and_type(p, "Note Tag E2E", " #delta ")
            p.wait_for_timeout(4500)
            click_btn(p, "Batal")
            ok, txt = card_tags(p, "Note Tag E2E", ["delta"])
            check("c autosave → tutup → list menampilkan #delta", ok, txt.replace("\n", " | "))
            check("z tanpa pageerror", not p.errors, p.errors[:3])
            browser.close()
    finally:
        proc.kill()
    failed = [s for s, ok in results if not ok]
    print("\n%d/%d lulus" % (len(results) - len(failed), len(results)))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
