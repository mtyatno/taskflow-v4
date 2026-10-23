"""E2E halaman Fokus Hari Ini PR A: Parkir Distraksi + Mode Zen. Tidak dijalankan CI.

Skenario: a parkir sukses (is-ok, input kosong, ringkasan "N tugas" tetap, task inbox di server)
b Enter ganda -> satu task  c spasi saja -> tanpa POST  d offline -> online -> sampai ke server
e Zen: sembunyi saat Work berjalan, note, task aktif terbuka + centang subtask, Jeda -> tampil,
  Mulai -> sembunyi, mode Short -> tampil  f reload -> Zen tetap menyala  g huruf di input tidak memicu shortcut
Screenshot terang + gelap, desktop + 375 px: temporary_files/e2e_focus_page/.

    E2E_PYTHON=/path/python-dengan-dependensi-webapp python3 temporary_files/e2e_focus_page.py
"""
import os
import re
import socket
import subprocess
import sys
import shutil
import tempfile
import time

import requests
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT, "static", "sw.js"), encoding="utf-8") as _f:
    # Versi SW saat ini: ditulis ke tf_whatsnew_seen agar modal "Apa yang baru" tidak menutupi UI.
    SW_VERSION = re.search(r'^const CACHE = "([^"]+)";', _f.read(), re.M).group(1)
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_focus_page")
PW = "rahasia123"
SECRET = "e2e-focus-page-secret"
TOURS = ['dashboard', 'tasks', 'today', 'calendar', 'kanban', 'notes', 'mindmap', 'chat', 'habits', 'habit',
         'settings', 'draw', 'goals', 'review', 'focus', 'workspace', 'slist', 'all', 'inbox',
         'done', 'overdue', 'next', 'waiting', 'someday']

results = []


def check(step, ok, note=""):
    results.append((step, bool(ok), note))
    print(("PASS " if ok else "FAIL ") + step + (" — " + note if note else ""), flush=True)
    return ok


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def server_python():
    """Python untuk uvicorn: E2E_PYTHON bila diset, lalu venv repo, lalu interpreter ini."""
    if os.environ.get("E2E_PYTHON"):
        return os.environ["E2E_PYTHON"]
    venv_py = os.path.join(ROOT, "venv", "bin", "python")
    return venv_py if os.path.exists(venv_py) else sys.executable


def start_server(tmp):
    port = free_port()
    env = dict(os.environ, DB_PATH=os.path.join(tmp, "e2e.db"), UPLOAD_DIR=os.path.join(tmp, "uploads"),
               WEB_SECRET_KEY=SECRET, TELEGRAM_BOT_TOKEN="")
    os.makedirs(env["UPLOAD_DIR"], exist_ok=True)
    log = open(os.path.join(tmp, "server.log"), "w")
    proc = subprocess.Popen([server_python(), "-m", "uvicorn", "webapp:app", "--host", "127.0.0.1",
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


def api(base, user, method, path, ok_codes=(200,), **kw):
    r = requests.request(method, base + path, headers={"Authorization": "Bearer " + user["token"]}, timeout=10, **kw)
    if r.status_code not in ok_codes:
        raise RuntimeError("%s %s → %d %s" % (method, path, r.status_code, r.text[:200]))
    return r.status_code, r.json()


def shot(page, name):
    page.mouse.move(5, 5)
    page.wait_for_timeout(300)
    path = os.path.join(SHOTS, name)
    page.screenshot(path=path, full_page=False, scale="css")
    print("  screenshot", os.path.relpath(path, ROOT), flush=True)


def open_app(browser, base, user, theme="light"):
    ctx = browser.new_context(service_workers="block", viewport={"width": 1280, "height": 860})
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    p = ctx.new_page()
    p.goto(base + "/manifest.json")
    p.evaluate("""([t, u, tours, theme, sw]) => {
        localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u));
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_dismiss_onboarding', '1');
        localStorage.setItem('tf_whatsnew_seen', sw);
        localStorage.setItem('tf_theme', theme);
        localStorage.setItem('tf_groupby', 'none');
        localStorage.setItem('tf_viewmode', 'normal');
    }""", [user["token"], user["id"], TOURS, theme, SW_VERSION])
    p.goto(base + "/")
    p.locator(".sidebar-link, .sidebar-rail-btn").first.wait_for(state="attached", timeout=20000)
    return ctx, p


def nav(page, label):
    """Buka halaman lewat link sidebar penuh (label teks); sidebar mode ikon dibuka dulu."""
    link = page.locator(".sidebar-link").filter(has_text=label).first
    if not link.is_visible():
        page.locator("button[aria-label='Tampilkan semua menu']").first.click()
    link.click()
    page.wait_for_timeout(500)



REC_TITLE = "Minum obat harian"


def today_iso():
    return time.strftime("%Y-%m-%d")


def tasks_by_title(base, user, title):
    data = api(base, user, "GET", "/api/tasks?limit=500")[1]
    items = data if isinstance(data, list) else data.get("tasks", data.get("items", []))
    return [t for t in items if t.get("title") == title]


def wait_server(base, user, title, n=1, timeout=25):
    end = time.time() + timeout
    got = []
    while time.time() < end:
        got = tasks_by_title(base, user, title)
        if len(got) >= n:
            return got
        time.sleep(0.5)
    return got


def summary(p):
    return p.locator(".focus-page-summary").inner_text().strip()


def n_tugas(p):
    m = re.match(r"(\d+) tugas", summary(p))
    return int(m.group(1)) if m else None


def visible_titles(p):
    return p.locator(".ftask:not(.is-zen-hidden):not(.ftask--recurring) .ftask-title").all_inner_texts()


def local_count(p, title):
    """Jumlah task hidup berjudul `title` di IndexedDB lokal (store tasks)."""
    return p.evaluate("""(title) => new Promise((res, rej) => {
        const r = indexedDB.open('taskflow-offline');
        r.onerror = () => rej(r.error);
        r.onsuccess = () => {
            const q = r.result.transaction('tasks').objectStore('tasks').getAll();
            q.onsuccess = () => { r.result.close(); res(q.result.filter(t => t.title === title && !t.deleted).length); };
            q.onerror = () => rej(q.error);
        };
    })""", title)


def park(p, text, enter=1):
    inp = p.locator(".pomo-park-input")
    inp.click()
    inp.fill(text)
    for _ in range(enter):
        inp.press("Enter")


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    tmp = tempfile.mkdtemp(prefix="e2e_focus_page_")
    proc, base = start_server(tmp)
    print("server", base, flush=True)
    try:
        user = register(base, "zena")
        titles = ["Laporan bulanan", "Review kode", "Balas email klien"]
        ids = []
        for t in titles:
            _, r = api(base, user, "POST", "/api/tasks",
                       json={"title": t, "priority": "P1", "gtd_status": "next", "deadline": today_iso()})
            ids.append(r["id"])
        for s in ("Subtask satu", "Subtask dua"):
            api(base, user, "POST", "/api/tasks/%d/subtasks" % ids[0], json={"title": s}, ok_codes=(200, 201))
        end = time.strftime("%Y-%m-%d", time.localtime(time.time() + 30 * 86400))
        _, rec = api(base, user, "POST", "/api/tasks",
                     json={"title": REC_TITLE, "priority": "P3", "gtd_status": "next", "recurrence_type": "daily",
                           "recurrence_end_date": end, "deadline": today_iso()})
        check("0 seed: 3 task Q1 hari ini + 2 subtask + 1 task harian",
              len(ids) == 3 and rec.get("recurrence_type") == "daily", repr(rec.get("recurrence_type")))
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx, p = open_app(browser, base, user, "light")
            try:
                run_flow(browser, ctx, p, base, user, titles)
            finally:
                ctx.close()
            browser.close()
    except Exception as e:
        import traceback
        traceback.print_exc()
        check("exception", False, "%s: %s" % (type(e).__name__, e))
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(tmp, ignore_errors=True)
    failed = [r for r in results if not r[1]]
    print("\n%d langkah, %d gagal" % (len(results), len(failed)))
    sys.exit(1 if failed else 0)


def run_flow(browser, ctx, p, base, user, titles):
    nav(p, "Fokus Hari Ini")
    p.locator(".ftask").first.wait_for(state="visible", timeout=20000)
    p.locator(".pomo-park-input").wait_for(state="visible", timeout=10000)
    n0 = n_tugas(p)
    # Ringkasan menghitung seluruh cakupan (spec 6.1): 3 task Q1 + task harian ber-deadline hari ini = 4.
    check("a0 halaman Fokus: 4 tugas (3 Q1 + task harian ber-deadline hari ini)", n0 == 4, summary(p))
    # Task harian hanya tampil di "Berulang hari ini": tidak ikut kelompok, dan jumlah "Task hari ini" = 3.
    pool_count = p.locator(".focus-section[data-tour=today-list] .focus-section-count").inner_text().strip()
    check("a0c task harian tidak masuk kelompok 'Task hari ini' (hanya 'Berulang hari ini')",
          p.locator(".focus-group .ftask").filter(has_text=REC_TITLE).count() == 0
          and p.locator(".focus-group .ftask").count() == 3 and pool_count == "3"
          and p.locator(".ftask--recurring").filter(has_text=REC_TITLE).count() == 1,
          "kelompok=%d, jumlah=%s" % (p.locator(".focus-group .ftask").count(), pool_count))
    check("a0b placeholder Parkir Distraksi",
          p.locator(".pomo-park-input").get_attribute("placeholder") == "Ada pikiran lewat? Ketik & tekan Enter untuk simpan ke Inbox...")

    park(p, "ide baru")
    p.wait_for_selector(".pomo-park.is-ok", timeout=3000)
    check("a1 .pomo-park.is-ok tampil setelah Enter", True)
    check("a2 input kosong", p.locator(".pomo-park-input").input_value() == "")
    shot(p, "park_ok_light_desktop.png")
    p.wait_for_selector(".pomo-park:not(.is-ok)", timeout=2500, state="attached")
    check("a3 is-ok hilang <= 2 dtk", p.locator(".pomo-park.is-ok").count() == 0)
    check("a4 ringkasan 'N tugas' sama", n_tugas(p) == n0, summary(p))
    got = wait_server(base, user, "ide baru")
    check("a5 server memuat 'ide baru' gtd_status=inbox", len(got) == 1 and got[0].get("gtd_status") == "inbox",
          repr([(t.get("gtd_status")) for t in got]))

    # b: dua keydown Enter dalam satu tick JS (sebelum request pertama selesai) -> busy guard
    inp = p.locator(".pomo-park-input")
    inp.click()
    inp.fill("dobel")
    p.evaluate("""() => { const el = document.querySelector('.pomo-park-input');
        for (let i = 0; i < 2; i++) el.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', keyCode: 13, bubbles: true, cancelable: true})); }""")
    p.wait_for_timeout(1500)
    check("b1 dua Enter serentak -> tepat satu task lokal", local_count(p, "dobel") == 1, "n=%d" % local_count(p, "dobel"))
    wait_server(base, user, "dobel")
    time.sleep(3)
    got = tasks_by_title(base, user, "dobel")
    check("b2 tepat satu task di server", len(got) == 1, "n=%d" % len(got))

    # c: penghitung = jumlah task lokal (IndexedDB) + server; park valid menaikkannya, spasi tidak
    all_local = lambda: p.evaluate("""() => new Promise((res) => { const r = indexedDB.open('taskflow-offline');
        r.onsuccess = () => { const q = r.result.transaction('tasks').objectStore('tasks').getAll();
            q.onsuccess = () => { r.result.close(); res(q.result.filter(t => !t.deleted).length); }; }; })""")
    before_local, before_srv = all_local(), len(api(base, user, "GET", "/api/tasks?limit=500")[1])
    park(p, "   ")
    p.wait_for_timeout(1500)
    time.sleep(2)
    check("c1 spasi saja + Enter -> tak ada task baru (lokal maupun server)",
          all_local() == before_local and len(api(base, user, "GET", "/api/tasks?limit=500")[1]) == before_srv,
          "lokal %d -> %d" % (before_local, all_local()))
    park(p, "kontrol-c")
    p.wait_for_selector(".pomo-park.is-ok", timeout=3000)
    check("c2 kontrol: park valid menaikkan penghitung lokal +1", all_local() == before_local + 1,
          "lokal %d -> %d" % (before_local, all_local()))
    wait_server(base, user, "kontrol-c")
    check("c3 kontrol: park valid menaikkan penghitung server +1",
          len(api(base, user, "GET", "/api/tasks?limit=500")[1]) == before_srv + 1)

    url0 = p.url
    sel = "[role='dialog'], .modal-overlay, .modal-backdrop"
    modals0 = p.locator(sel).count()
    inp = p.locator(".pomo-park-input")
    inp.click()
    inp.fill("")
    inp.type("ngqwcd/?1", delay=30)
    p.wait_for_timeout(300)
    check("g1 teks terketik utuh di input", inp.input_value() == "ngqwcd/?1", inp.input_value())
    check("g2 tak ada navigasi/modal dari shortcut global",
          p.url == url0 and p.locator(sel).count() == modals0 and p.locator(".pomo-park-input").count() == 1)
    inp.fill("")

    ctx.set_offline(True)
    p.wait_for_timeout(500)
    park(p, "offline-1")
    p.wait_for_selector(".pomo-park.is-ok", timeout=3000)
    check("d1 parkir offline sukses (is-ok)", True)
    ctx.set_offline(False)
    p.evaluate("window.dispatchEvent(new Event('online'))")
    got = wait_server(base, user, "offline-1", timeout=40)
    check("d2 online lagi -> task sampai ke server sebagai inbox", len(got) == 1 and got[0].get("gtd_status") == "inbox",
          repr(got[:1]))

    rec_sec = p.locator(".focus-section").filter(has_text="Berulang hari ini")
    rec_sec.first.wait_for(state="visible", timeout=10000)
    check("e00 'Berulang hari ini' tampil dengan task harian (Zen mati)",
          rec_sec.first.is_visible() and REC_TITLE in rec_sec.first.inner_text())
    p.locator(".focus-zen-btn").click()
    check("e0 Zen aria-pressed=true", p.locator(".focus-zen-btn").get_attribute("aria-pressed") == "true")
    check("e0b Zen aktif tapi timer belum jalan -> semua task terlihat",
          len(visible_titles(p)) == 3 and p.locator(".focus-page.is-zen").count() == 0)
    first_title = titles[0]  # task ber-subtask
    first = p.locator(".ftask").filter(has_text=first_title).first
    first.locator(".ftask-focus-btn").click()
    p.locator(".focus-pomo .pomo-btn-main").first.click()
    p.wait_for_selector(".focus-page.is-zen", timeout=3000)
    p.wait_for_timeout(500)
    vis = visible_titles(p)
    check("e1 task lain tersembunyi, hanya task aktif terlihat", vis == [first_title], repr(vis))
    p.wait_for_timeout(400)
    check("e1b 'Berulang hari ini' ada, tidak terlihat, aria-hidden",
          rec_sec.count() == 1 and not rec_sec.first.is_visible() and rec_sec.first.get_attribute("aria-hidden") == "true")
    p.wait_for_timeout(500)
    list_h = p.evaluate("""() => { const el = document.querySelector('.focus-target'); const cs = getComputedStyle(el);
        return el.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom); }""")
    groups_h = p.evaluate("[...document.querySelectorAll('.focus-group')].reduce((a, g) => a + g.getBoundingClientRect().height, 0)")
    act_h = p.locator(".ftask.is-focusing").bounding_box()["height"]
    check("e1a Zen: hanya task aktif yang terlihat dan tinggi daftar ~ tinggi item aktif",
          visible_titles(p) == [first_title] and abs(list_h - act_h) <= 4 and groups_h <= 4,
          "daftar %.1f vs item %.1f, kelompok tersembunyi %.1f" % (list_h, act_h, groups_h))
    check("e1c task tersembunyi aria-hidden", p.locator(".ftask.is-zen-hidden[aria-hidden='true']").count() == 2)
    check("e2 .focus-zen-note tampil", p.locator(".focus-zen-note").is_visible(), p.locator(".focus-zen-note").inner_text())
    check("e3 panel task aktif terbuka", p.locator(".ftask.is-focusing.is-open .ftask-panel").is_visible())
    shot(p, "zen_light_desktop.png")
    sub = p.locator(".ftask.is-focusing .ftask-sub").first
    sub.wait_for(state="visible", timeout=8000)
    sub.click()
    p.wait_for_timeout(800)
    check("e4 centang subtask berfungsi", p.locator(".ftask.is-focusing .ftask-sub.is-done").count() == 1)
    p.locator(".focus-pomo .pomo-btn-main.is-pause").first.click()
    p.wait_for_timeout(500)
    check("e5a task aktif tidak memutar ulang fade-in saat Jeda",
          "zen-fade-in" not in p.evaluate("getComputedStyle(document.querySelector('.ftask.is-focusing')).animationName"))
    check("e5b Jeda -> 'Berulang hari ini' terlihat lagi", rec_sec.first.is_visible())
    check("e5 Jeda -> semua task terlihat lagi",
          len(visible_titles(p)) == 3 and p.locator(".focus-page.is-zen").count() == 0, repr(visible_titles(p)))
    p.locator(".focus-pomo .pomo-btn-main").first.click()
    p.wait_for_timeout(500)
    check("e6 Mulai lagi -> tersembunyi", visible_titles(p) == [first_title], repr(visible_titles(p)))
    p.get_by_role("button", name=re.compile("Short", re.I)).first.click()
    p.wait_for_timeout(500)
    check("e7 mode Short -> semua task terlihat",
          len(visible_titles(p)) == 3 and p.locator(".focus-page.is-zen").count() == 0)

    p.reload()
    p.locator(".sidebar-link, .sidebar-rail-btn").first.wait_for(state="attached", timeout=20000)
    if p.locator(".focus-zen-btn").count() == 0:
        nav(p, "Fokus Hari Ini")
    p.locator(".focus-zen-btn").wait_for(state="visible", timeout=20000)
    check("f reload -> Zen aria-pressed=true", p.locator(".focus-zen-btn").get_attribute("aria-pressed") == "true")

    for theme, w, h, tag in (("dark", 1280, 860, "desktop"), ("dark", 375, 812, "375"), ("light", 375, 812, "375")):
        c2, p2 = open_app(browser, base, user, theme)
        try:
            p2.set_viewport_size({"width": w, "height": h})
            p2.goto(base + "/")
            p2.locator(".sidebar-link, .sidebar-rail-btn, .mobile-topbar").first.wait_for(state="attached", timeout=20000)
            if w >= 600:
                nav(p2, "Fokus Hari Ini")
            else:
                p2.evaluate("""() => { const a = [...document.querySelectorAll('a,button,[role=button],.sidebar-link,.bottom-nav *')]
                    .find(x => /Fokus Hari Ini/.test(x.textContent||'') || /^today$/.test(x.getAttribute('data-page')||'')); if (a) a.click(); }""")
            p2.locator(".pomo-park-input").wait_for(state="visible", timeout=20000)
            shot(p2, "park_%s_%s.png" % (theme, tag))
            if p2.locator(".focus-zen-btn").get_attribute("aria-pressed") != "true":
                p2.locator(".focus-zen-btn").click()
            p2.locator(".ftask").filter(has_text=titles[0]).first.locator(".ftask-focus-btn").click()
            p2.locator(".focus-pomo .pomo-btn-main").first.click()
            p2.wait_for_selector(".focus-page.is-zen", timeout=3000)
            p2.wait_for_timeout(500)
            shot(p2, "zen_%s_%s.png" % (theme, tag))
            if tag == "375":
                check("h 375px %s tanpa scroll horizontal" % theme,
                      p2.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
        finally:
            c2.close()


if __name__ == "__main__":
    main()
