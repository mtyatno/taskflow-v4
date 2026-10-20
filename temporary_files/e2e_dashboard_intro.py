"""E2E gerbang intro Dashboard: welcome card hanya untuk akun yang benar-benar kosong. Tidak dijalankan CI.

Skenario (spec 2026-10-20-dashboard-welcome-sync-gate §5, brief Task 4):
  a  akun lama (3 task + 2 note), perangkat baru (context baru, IndexedDB kosong), login lewat form; pull task
     (GET /api/tasks?include_done=true ber-header X-TF-Sync) ditahan 3 dtk → kartu "Menyinkronkan data kamu dari
     server…"; "Selamat datang di Alurik" TIDAK PERNAH muncul (polling DOM tiap 100 ms + MutationObserver);
     dilepas → kartu Prioritas + KPI; tepat satu pull task sync selama login pertama. Screenshot terang + gelap.
  a2 akun lama hanya task (tanpa note) — probe urutan baca penanda vs data lokal saat tf:initial-sync.
  b  akun baru (kosong) → welcome card "Mulai Langkah Pertama" + kalimat "Selamat datang di Alurik!" setelah sync.
  c  akun lama, perangkat baru, token sudah ada; app shell dimuat online dengan pull task ditahan, context dibuat
     offline SEBELUM pull dilepas (pull di-abort) → "Belum terhubung ke server"; online lagi → dashboard penuh
     TANPA reload (Review Focus 3). Screenshot terang + gelap.
  d  pull task + pull note 500 → "Gagal mengambil data dari server" + "Coba lagi"; route dilepas → klik
     "Coba lagi" → dashboard penuh. Screenshot terang + gelap.
  d2 hanya /api/scratchpad 500 (akun lama): task sudah ter-pull → dashboard (bukan welcome), penanda TIDAK ditulis.
  e  akun hanya punya note → bukan welcome, bukan kartu status; tidak ada pull task tambahan dari dashboard.
  f  akun 1 task + 1 note: hapus keduanya → welcome muncul tanpa reload; reload offline (app shell dari SW) → welcome.
  g  B anggota workspace milik A (workspace berisi 1 task), B tanpa item pribadi → bukan welcome.
  h  logout akun lama → login akun baru di tab yang sama → welcome (bukan kartu status macet).
  h2 lanjut: logout akun baru → login akun lama lain di tab yang sama → tidak pernah welcome (Review Focus 1).

Context memakai service_workers="block" (route Playwright tidak melihat fetch dari SW) kecuali (f) yang butuh SW
untuk memuat app shell offline. Server lokal: uvicorn webapp:app, DB sementara (Python = $E2E_PYTHON atau
interpreter ini). Screenshot: temporary_files/e2e_dashboard_intro/. Keluar non-zero bila ada langkah gagal.

    python3 temporary_files/e2e_dashboard_intro.py
"""
import os
import socket
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlparse

import requests
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "temporary_files", "e2e_dashboard_intro")
PW = "rahasia123"
SECRET = "e2e-dashboard-intro-secret"
TOURS = ['dashboard', 'tasks', 'today', 'calendar', 'kanban', 'notes', 'mindmap', 'chat', 'habits', 'habit',
         'settings', 'draw', 'goals', 'review', 'focus', 'workspace', 'slist', 'all', 'inbox',
         'done', 'overdue', 'next', 'waiting', 'someday']
WELCOME_TXT = "Selamat datang di Alurik"
T_SYNCING = "Menyinkronkan data kamu dari server…"
T_OFFLINE = "Belum terhubung ke server"
T_ERROR = "Gagal mengambil data dari server"

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
    """Python untuk uvicorn: $E2E_PYTHON bila diset, selain itu interpreter yang menjalankan skrip ini."""
    return os.environ.get("E2E_PYTHON") or sys.executable


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


_seq = [0]


def register(base, name):
    _seq[0] += 1
    u = "%s%d%d" % (name, int(time.time() * 1000) % 1_000_000, _seq[0])
    r = requests.post(base + "/api/auth/register",
                      json={"username": u, "password": PW, "email": u + "@ex.com", "display_name": name})
    r.raise_for_status()
    j = r.json()
    return {"username": u, "id": j["user_id"], "token": j["token"]}


def api(base, user, method, path, ok_codes=(200, 201), **kw):
    r = requests.request(method, base + path, headers={"Authorization": "Bearer " + user["token"]}, timeout=10, **kw)
    if r.status_code not in ok_codes:
        raise RuntimeError("%s %s → %d %s" % (method, path, r.status_code, r.text[:200]))
    return r.json()


def add_task(base, user, title, **extra):
    body = {"title": title, "priority": "P2", "gtd_status": "next"}
    body.update(extra)
    return api(base, user, "POST", "/api/tasks", json=body)


def add_note(base, user, title):
    return api(base, user, "POST", "/api/scratchpad", json={"title": title, "content": "isi " + title})


def seed_old(base, name="lama"):
    u = register(base, name)
    for i in range(3):
        add_task(base, u, "Task lama %d" % (i + 1), priority="P1" if i == 0 else "P2")
    for i in range(2):
        add_note(base, u, "Catatan lama %d" % (i + 1))
    return u


def shot(page, name):
    page.mouse.move(5, 5)
    page.wait_for_timeout(300)
    path = os.path.join(SHOTS, name)
    page.screenshot(path=path, full_page=False, scale="css")
    print("  screenshot", os.path.relpath(path, ROOT), flush=True)


# ── Perekam: MutationObserver mencatat setiap kemunculan welcome & judul kartu status ─────────────────
RECORDER = """
(() => {
  window.__e2e = { welcome: 0, sync: [], flashes: [], shownAt: null };
  const scan = () => {
    try {
      const b = document.getElementById('root');  // bukan body: teks skrip inline ikut di body.textContent
      if (!b) return;
      const t = b.textContent;
      const on = !!document.querySelector('.dash-onboarding-card') || t.indexOf('%s') >= 0 || t.indexOf('Mulai Langkah Pertama') >= 0;
      const r = window.__e2e, now = Math.round(performance.now());
      if (on) { r.welcome++; if (r.shownAt == null) r.shownAt = now; }
      else if (r.shownAt != null) { r.flashes.push(now - r.shownAt); r.shownAt = null; }
      const c = document.querySelector('.dash-sync-card-title');
      if (c && window.__e2e.sync.indexOf(c.textContent) < 0) window.__e2e.sync.push(c.textContent);
    } catch (e) {}
  };
  new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true });
})();
""" % WELCOME_TXT

PROBE = """() => {
  const q = (s) => document.querySelector(s);
  const vis = (s) => { const e = q(s); return !!e && e.getClientRects().length > 0; };
  const st = q('.dash-sync-card-title');
  return {
    welcomeText: ((document.getElementById('root') || {}).textContent || '').indexOf('%s') >= 0,
    onboarding: vis('.dash-onboarding-card'),
    sync: st ? st.textContent : null,
    retry: vis('.dash-sync-card-btn'),
    kpis: vis('.dash-kpis'),
    prio: vis('.dash-prio-card'),
    login: !!document.querySelector('input[type=password]') && !q('.dash-main'),
    dash: !!q('.dash-main'),
    rec: window.__e2e || null,
  };
}""" % WELCOME_TXT


def probe(p):
    return p.evaluate(PROBE)


def is_full(s):
    return s["kpis"] and s["prio"] and not s["sync"] and not s["onboarding"]


class Gate:
    """Tahan / gagalkan pull sync (GET ber-header X-TF-Sync) untuk task dan note."""

    def __init__(self):
        self.mode = {"tasks": "pass", "notes": "pass"}
        self.held = []
        self.hits = {"tasks": 0, "notes": 0}

    @staticmethod
    def kind(url):
        u = urlparse(url)
        if u.path == "/api/tasks" and "include_done=true" in u.query:
            return "tasks"
        if u.path == "/api/scratchpad":
            return "notes"
        return None

    def install(self, ctx):
        ctx.route(lambda url: self.kind(url) is not None, self._handle)

    def _handle(self, route, request):
        k = self.kind(request.url)
        if request.method != "GET" or "x-tf-sync" not in request.headers or k is None:
            route.fallback()
            return
        self.hits[k] += 1
        m = self.mode[k]
        if m == "hold":
            self.held.append(route)
        elif m == "500":
            route.fulfill(status=500, content_type="application/json", body='{"detail":"e2e gagal"}')
        elif m == "abort":
            route.abort("internetdisconnected")
        else:
            route.fallback()

    def release(self, how="continue"):
        held, self.held = self.held, []
        for r in held:
            try:
                r.abort("internetdisconnected") if how == "abort" else r.fallback()
            except Exception as e:  # noqa: BLE001
                print("  release err", e)
        return len(held)


def new_ctx(browser, base, sw="block", theme="light"):
    ctx = browser.new_context(service_workers=sw, viewport={"width": 1280, "height": 860})
    ctx.add_init_script(RECORDER)
    p = ctx.new_page()
    p.on("dialog", lambda d: d.accept())
    p.goto(base + "/manifest.json")
    p.evaluate("""([tours, theme]) => {
        for (const pg of tours) localStorage.setItem('tf_tour_' + pg, '1');
        localStorage.setItem('tf_theme', theme);
        localStorage.setItem('tf_shortcut_hint', '1');
    }""", [TOURS, theme])
    return ctx, p


def ui_login(p, base, user, goto=True):
    if goto:
        p.goto(base + "/")
    p.locator("input[type=password]").first.wait_for(state="visible", timeout=20000)
    p.locator("form input.input").first.fill(user["username"])
    p.locator("form input[type=password]").first.fill(PW)
    p.locator("form button[type=submit]").first.click()


def inject_login(ctx, p, base, user):
    ctx.add_cookies([{"name": "token", "value": user["token"], "url": base, "httpOnly": True, "sameSite": "Lax"}])
    p.evaluate("([t, u]) => { localStorage.setItem('tf_token', t); localStorage.setItem('tf_user_id', String(u)); }",
               [user["token"], user["id"]])
    p.goto(base + "/")


def wait_dash(p, timeout=20000):
    p.locator(".dash-main").first.wait_for(state="attached", timeout=timeout)


def poll(p, pred, timeout_ms, every=100):
    """Polling DOM tiap `every` ms; kembalikan (state_terakhir, ok, jumlah_sampel_welcome)."""
    welcome_hits = 0
    end = time.time() + timeout_ms / 1000.0
    s = None
    while True:
        try:
            s = probe(p)
        except Exception:  # noqa: BLE001 — navigasi di tengah evaluate
            s = None
        if s and (s["welcomeText"] or s["onboarding"]):
            welcome_hits += 1
        if s and pred(s):
            return s, True, welcome_hits
        if time.time() > end:
            return s, False, welcome_hits
        p.wait_for_timeout(every)


def sync_idle_with_marker(p):
    return p.evaluate("""() => Promise.resolve(window.TF && TF.introgate
        ? TF.introgate.readInitialSync(TF.introgate.currentUserId()) : false)
        .then(m => ({ marker: !!m, state: window.__syncState || null }))""")


def wait_marker(p, timeout_ms=20000):
    end = time.time() + timeout_ms / 1000.0
    r = None
    while time.time() < end:
        r = sync_idle_with_marker(p)
        if r["marker"] and r["state"] and not r["state"]["running"]:
            return r
        p.wait_for_timeout(200)
    return r


def toggle_theme(p):
    p.locator("[title='Switch to Dark'], [title='Switch to Light']").locator("visible=true").first.click()
    p.wait_for_timeout(400)


def shots_both(p, tag):
    shot(p, "%s_terang.png" % tag)
    toggle_theme(p)
    dark = p.evaluate("() => document.documentElement.getAttribute('data-theme')")
    check("%s screenshot gelap: tema gelap aktif" % tag, dark == "dark", repr(dark))
    shot(p, "%s_gelap.png" % tag)
    toggle_theme(p)


def open_full_menu_link(p, label):
    link = p.locator(".sidebar-link").filter(has_text=label).first
    if not link.is_visible():
        btn = p.locator("button[aria-label='Tampilkan semua menu']")
        if btn.count():
            btn.first.click()
            p.wait_for_timeout(300)
    return link


# ── Skenario ─────────────────────────────────────────────────────────────────────────────────────────
def scen_a(browser, base, old):
    ctx, p = new_ctx(browser, base)
    gate = Gate()
    gate.install(ctx)
    try:
        gate.mode["tasks"] = "hold"
        ui_login(p, base, old)
        wait_dash(p)
        s, ok, w = poll(p, lambda s: s["sync"] == T_SYNCING and gate.hits["tasks"] >= 1, 10000)
        check("a1 kartu '%s' tampil saat pull task ditahan" % T_SYNCING, ok, repr(s and s["sync"]))
        check("a2 route pull task (X-TF-Sync) benar-benar tertahan", gate.hits["tasks"] >= 1 and len(gate.held) >= 1,
              "hits=%r held=%d" % (gate.hits, len(gate.held)))
        summ = p.locator("text=Menyinkronkan datamu…").count()
        check("a3 kalimat ringkasan 'Menyinkronkan datamu…'", summ >= 1)
        check("a4 kartu Prioritas TIDAK dirender selama sync", not s["prio"])
        # tahan 3 dtk, polling tiap 100 ms
        samples, bad = 0, 0
        t_end = time.time() + 3.0
        while time.time() < t_end:
            st = probe(p)
            samples += 1
            if st["welcomeText"] or st["onboarding"]:
                bad += 1
            p.wait_for_timeout(100)
        check("a5 selama 3 dtk ditahan: '%s' tidak pernah muncul (%d sampel 100 ms)" % (WELCOME_TXT, samples),
              bad == 0 and w == 0, "sampel welcome=%d" % (bad + w))
        shots_both(p, "a_syncing")
        gate.mode["tasks"] = "pass"
        n = gate.release()
        s, ok, w2 = poll(p, is_full, 20000)
        check("a6 dilepas (%d request) → kartu Prioritas + KPI tampil" % n, ok, repr(s))
        check("a7 tidak ada sampel polling welcome setelah dilepas", w2 == 0, "sampel=%d" % w2)
        rec = p.evaluate("() => window.__e2e")
        check("a8 MutationObserver: welcome tidak pernah dirender sepanjang skenario", rec["welcome"] == 0, repr(rec))
        check("a9 judul kartu status yang sempat tampil hanya 'Menyinkronkan…'", rec["sync"] == [T_SYNCING], repr(rec["sync"]))
        shot(p, "a_dashboard_penuh.png")
        # Login pertama perangkat baru: tepat SATU pull task sync (dulu tf:initial-sync → __refreshTasks → fetchAll
        # kedua → sync penuh kedua).
        p.wait_for_timeout(2000)
        check("a10 login pertama: tepat 1 pull task sync (X-TF-Sync), tanpa sync penuh kedua",
              gate.hits["tasks"] == 1, repr(gate.hits))
    finally:
        ctx.close()


def scen_a2(browser, base):
    u = register(base, "tanpanote")
    for i in range(2):
        add_task(base, u, "Task tanpa note %d" % (i + 1))
    ctx, p = new_ctx(browser, base)
    try:
        ui_login(p, base, u)
        wait_dash(p)
        s, ok, w = poll(p, is_full, 20000)
        check("a2-1 akun hanya task: dashboard penuh setelah sync", ok, repr(s))
        rec = p.evaluate("() => window.__e2e")
        check("a2-2 akun hanya task: welcome tidak pernah dirender (MutationObserver)", rec["welcome"] == 0 and w == 0,
              "observer=%d polling=%d" % (rec["welcome"], w))
    finally:
        ctx.close()


def scen_b(browser, base):
    u = register(base, "baru")
    ctx, p = new_ctx(browser, base)
    try:
        ui_login(p, base, u)
        wait_dash(p)
        s, ok, _ = poll(p, lambda s: s["onboarding"], 20000)
        check("b1 akun baru: welcome card tampil setelah sync", ok, repr(s))
        check("b2 judul 'Mulai Langkah Pertama'", p.locator(".dash-onboarding-card").filter(has_text="Mulai Langkah Pertama").count() == 1)
        check("b3 kalimat '%s!' tampil" % WELCOME_TXT, s and s["welcomeText"])
        check("b4 tanpa kartu status sync", s and not s["sync"])
        r = sync_idle_with_marker(p)
        check("b5 penanda initial_sync:v1 tertulis", r["marker"], repr(r))
        shot(p, "b_welcome.png")
    finally:
        ctx.close()


def scen_c(browser, base, old):
    ctx, p = new_ctx(browser, base)
    gate = Gate()
    gate.install(ctx)
    try:
        gate.mode["tasks"] = "hold"
        inject_login(ctx, p, base, old)
        wait_dash(p)
        s, ok, _ = poll(p, lambda s: gate.hits["tasks"] >= 1, 10000)
        check("c1 app shell termuat, pull task ditahan (IndexedDB kosong)", ok, "hits=%r" % gate.hits)
        p.evaluate("() => { window.__e2eNoReload = 'c'; }")
        ctx.set_offline(True)
        n = gate.release("abort")
        s, ok, w = poll(p, lambda s: s["sync"] == T_OFFLINE, 10000)
        check("c2 offline tanpa data lokal → '%s' (pull di-abort: %d)" % (T_OFFLINE, n), ok, repr(s and s["sync"]))
        check("c3 kalimat 'Menunggu koneksi untuk memuat datamu.'", p.locator("text=Menunggu koneksi untuk memuat datamu.").count() >= 1)
        p.wait_for_timeout(1500)
        s = probe(p)
        check("c4 tetap '%s' setelah sync gagal selesai (bukan welcome)" % T_OFFLINE,
              s["sync"] == T_OFFLINE and not s["welcomeText"] and not s["onboarding"] and w == 0, repr(s))
        shots_both(p, "c_offline")
        gate.mode["tasks"] = "pass"
        ctx.set_offline(False)
        s, ok, w = poll(p, is_full, 25000)
        check("c5 online lagi → dashboard penuh (Prioritas + KPI)", ok, repr(s))
        check("c6 tanpa reload (penanda window tetap)", p.evaluate("() => window.__e2eNoReload") == "c")
        rec = p.evaluate("() => window.__e2e")
        check("c7 welcome tidak pernah dirender", rec["welcome"] == 0 and w == 0, repr(rec))
        r = sync_idle_with_marker(p)
        check("c8 penanda ditulis setelah sync online", r["marker"], repr(r))
    finally:
        ctx.close()


def scen_d(browser, base, old):
    ctx, p = new_ctx(browser, base)
    gate = Gate()
    gate.install(ctx)
    try:
        gate.mode["tasks"] = "500"
        gate.mode["notes"] = "500"
        ui_login(p, base, old)
        wait_dash(p)
        s, ok, w = poll(p, lambda s: s["sync"] == T_ERROR, 20000)
        check("d1 pull task + note 500 → '%s'" % T_ERROR, ok, repr(s and s["sync"]))
        check("d2 tombol 'Coba lagi' tampil", s and s["retry"] and p.locator(".dash-sync-card-btn").inner_text().strip() == "Coba lagi")
        check("d3 kalimat 'Datamu belum termuat.'", p.locator("text=Datamu belum termuat.").count() >= 1)
        check("d4 route 500 benar-benar dipakai", gate.hits["tasks"] >= 1 and gate.hits["notes"] >= 1, repr(gate.hits))
        r = sync_idle_with_marker(p)
        check("d5 penanda TIDAK ditulis", not r["marker"], repr(r))
        shots_both(p, "d_error")
        gate.mode["tasks"] = "pass"
        gate.mode["notes"] = "pass"
        p.evaluate("() => { window.__e2eNoReload = 'd'; }")
        p.locator(".dash-sync-card-btn").click()
        s, ok, w2 = poll(p, is_full, 20000)
        check("d6 'Coba lagi' (route dilepas) → dashboard penuh", ok, repr(s))
        check("d7 tanpa reload", p.evaluate("() => window.__e2eNoReload") == "d")
        rec = p.evaluate("() => window.__e2e")
        check("d8 welcome tidak pernah dirender", rec["welcome"] == 0 and w == 0 and w2 == 0, repr(rec))
    finally:
        ctx.close()


def scen_d2(browser, base, old):
    ctx, p = new_ctx(browser, base)
    gate = Gate()
    gate.install(ctx)
    try:
        gate.mode["notes"] = "500"
        ui_login(p, base, old)
        wait_dash(p)
        s, ok, w = poll(p, lambda s: gate.hits["notes"] >= 1 and is_full(s)
                        and not (p.evaluate("() => window.__syncState") or {}).get("running", True), 20000)
        check("d2-1 hanya pull note 500: task ter-pull → dashboard penuh", ok, repr(s))
        r = sync_idle_with_marker(p)
        check("d2-2 pull note gagal → penanda TIDAK ditulis (Review Focus 2)", not r["marker"] and r["state"]["lastFailed"], repr(r))
        rec = p.evaluate("() => window.__e2e")
        check("d2-3 welcome tidak pernah dirender", rec["welcome"] == 0 and w == 0, repr(rec))
    finally:
        ctx.close()


def scen_e(browser, base):
    u = register(base, "notesaja")
    add_note(base, u, "Catatan saja 1")
    add_note(base, u, "Catatan saja 2")
    ctx, p = new_ctx(browser, base)
    gate = Gate()
    gate.install(ctx)
    try:
        ui_login(p, base, u)
        wait_dash(p)
        r = wait_marker(p)
        check("e1 sync awal selesai (penanda ada)", r and r["marker"], repr(r))
        hits_after_first = dict(gate.hits)
        p.wait_for_timeout(1500)
        s = probe(p)
        check("e2 akun hanya note: bukan welcome", not s["onboarding"] and not s["welcomeText"], repr(s))
        check("e3 akun hanya note: bukan kartu status", not s["sync"], repr(s["sync"]))
        check("e4 kartu Prioritas biasa tampil", s["prio"], repr(s))
        check("e5 welcome tidak pernah dirender", s["rec"]["welcome"] == 0, repr(s["rec"]))
        p.wait_for_timeout(500)
        check("e6 akun hanya note: dashboard tidak memicu pull task tambahan setelah sync pertama",
              gate.hits["tasks"] == 1 and hits_after_first["tasks"] == 1, "awal=%r akhir=%r" % (hits_after_first, gate.hits))
    finally:
        ctx.close()


def scen_f(browser, base):
    u = register(base, "hapus")
    add_task(base, u, "Satu-satunya task")
    add_note(base, u, "Satu-satunya catatan")
    ctx, p = new_ctx(browser, base, sw="allow")
    try:
        ui_login(p, base, u)
        wait_dash(p)
        s, ok, _ = poll(p, is_full, 20000)
        check("f1 akun 1 task + 1 note: dashboard penuh", ok, repr(s))
        sw_ok = p.evaluate("""async () => { const r = await navigator.serviceWorker.ready;
            const keys = await caches.keys(); let shell = false;
            for (const k of keys) { if (await (await caches.open(k)).match('/')) shell = true; }
            return { active: !!r.active, keys, shell }; }""")
        check("f2 SW aktif dan app shell '/' ter-cache", sw_ok["active"] and sw_ok["shell"], repr(sw_ok))
        # SW baru mengambil alih halaman (clients.claim) → app dapat memuat ulang sekali; tunggu sampai stabil
        p.wait_for_function("() => !!navigator.serviceWorker.controller", timeout=20000)
        p.wait_for_timeout(3000)
        wait_dash(p)
        s, ok, _ = poll(p, is_full, 20000)
        check("f2b halaman stabil di bawah kendali SW, dashboard penuh", ok, repr(s))
        p.evaluate("() => { window.__e2eNoReload = 'f'; }")
        res = p.evaluate("""async () => {
            const notesRes = await api.get('/api/scratchpad');
            const notes = Array.isArray(notesRes) ? notesRes : (notesRes && (notesRes.notes || notesRes.items)) || [];
            for (const n of notes) await api.del('/api/scratchpad/' + n.id);
            if (notes.length) window.dispatchEvent(new CustomEvent('noteSaved', { detail: { source: 'e2e' } }));
            const tasks = await api.get('/api/tasks?include_done=true');
            for (const t of tasks) await api.del('/api/tasks/' + t.id);
            if (window.__refreshTasks) await window.__refreshTasks();
            return { notes: notes.length, tasks: tasks.length };
        }""")
        check("f3 hapus lewat route lokal app: 1 note + 1 task", res == {"notes": 1, "tasks": 1}, repr(res))
        s, ok, _ = poll(p, lambda s: s["onboarding"], 15000)
        check("f4 welcome muncul lagi tanpa reload", ok and p.evaluate("() => window.__e2eNoReload") == "f", repr(s))
        check("f5 kalimat '%s' tampil" % WELCOME_TXT, s and s["welcomeText"])
        # tunggu outbox terkirim agar reload offline tidak bergantung pada op tertunda
        for _ in range(50):
            n = p.evaluate("() => window.TF && TF.outbox ? TF.outbox.outboxAll().then(a => a.length) : 0")
            if n == 0:
                break
            p.wait_for_timeout(200)
        check("f6 outbox kosong (hapus terkirim)", n == 0, "sisa=%r" % n)
        left = api(base, u, "GET", "/api/tasks?include_done=true")
        check("f7 server: task terhapus", isinstance(left, list) and len(left) == 0, repr(left)[:120])
        ctx.set_offline(True)
        p.reload()
        p.locator(".sidebar-link, .sidebar-rail-btn").first.wait_for(state="attached", timeout=20000)
        wait_dash(p)
        s, ok, _ = poll(p, lambda s: s["onboarding"], 15000)
        check("f8 reload offline (shell dari SW) → welcome tetap", ok and p.evaluate("() => navigator.onLine") is False, repr(s))
        check("f9 bukan kartu 'Belum terhubung' (penanda + data lokal kosong = akun kosong)", s and not s["sync"], repr(s and s["sync"]))
        shot(p, "f_welcome_offline.png")
        ctx.set_offline(False)
    finally:
        ctx.close()


def scen_g(browser, base):
    a = register(base, "pemilik")
    b = register(base, "anggota")
    ws = api(base, a, "POST", "/api/lists", json={"name": "Tim Intro"})
    add_task(base, a, "Task workspace", list_id=ws["id"])
    api(base, a, "POST", "/api/lists/%d/invite" % ws["id"], json={"username": b["username"]})
    ctx, p = new_ctx(browser, base)
    try:
        ui_login(p, base, b)
        wait_dash(p)
        r = wait_marker(p)
        check("g1 B: sync awal selesai", r and r["marker"], repr(r))
        p.wait_for_timeout(1500)
        s = probe(p)
        check("g2 B anggota workspace (1 task) tanpa item pribadi: bukan welcome",
              not s["onboarding"] and not s["welcomeText"] and s["rec"]["welcome"] == 0, repr(s))
        check("g3 B: bukan kartu status", not s["sync"], repr(s["sync"]))
        check("g4 B: kartu Prioritas tampil", s["prio"], repr(s))
    finally:
        ctx.close()


def logout(p):
    link = open_full_menu_link(p, "Logout")
    link.click()
    p.locator("input[type=password]").first.wait_for(state="visible", timeout=20000)


def scen_h(browser, base, old, old2):
    newu = register(base, "baruh")
    ctx, p = new_ctx(browser, base)
    try:
        ui_login(p, base, old)
        wait_dash(p)
        s, ok, _ = poll(p, is_full, 20000)
        check("h1 akun lama login → dashboard penuh", ok, repr(s))
        logout(p)
        check("h2 logout → form login", True)
        ui_login(p, base, newu, goto=False)
        wait_dash(p)
        s, ok, _ = poll(p, lambda s: s["onboarding"], 20000)
        check("h3 login akun baru di tab yang sama → welcome", ok, repr(s))
        p.wait_for_timeout(1000)
        s = probe(p)
        check("h4 tanpa kartu status macet", not s["sync"] and s["onboarding"], repr(s))
        # h2: akun baru → logout → akun lama lain: welcome tidak boleh muncul (penanda milik akun baru)
        logout(p)
        p.evaluate("() => { if (window.__e2e) Object.assign(window.__e2e, { welcome: 0, flashes: [], shownAt: null }); }")
        ui_login(p, base, old2, goto=False)
        wait_dash(p)
        s, ok, w = poll(p, is_full, 20000)
        rec = p.evaluate("() => window.__e2e")
        check("h5 lalu akun lama lain → dashboard penuh, welcome tidak pernah dirender",
              ok and w == 0 and rec["welcome"] == 0, "full=%s polling=%d rec=%r" % (ok, w, rec))
    finally:
        ctx.close()


def main():
    os.makedirs(SHOTS, exist_ok=True)
    for f in os.listdir(SHOTS):
        if f.endswith(".png"):
            os.remove(os.path.join(SHOTS, f))
    only = set(a.lower() for a in sys.argv[1:])
    tmp = tempfile.mkdtemp(prefix="e2e_dashboard_intro_")
    proc, base = start_server(tmp)
    print("server", base, flush=True)
    try:
        old = seed_old(base, "lama")
        old2 = seed_old(base, "lamadua")
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            scen = [("a", lambda: scen_a(browser, base, old)), ("a2", lambda: scen_a2(browser, base)),
                    ("b", lambda: scen_b(browser, base)), ("c", lambda: scen_c(browser, base, old)),
                    ("d", lambda: scen_d(browser, base, old)), ("d2", lambda: scen_d2(browser, base, old)),
                    ("e", lambda: scen_e(browser, base)), ("f", lambda: scen_f(browser, base)),
                    ("g", lambda: scen_g(browser, base)), ("h", lambda: scen_h(browser, base, old, old2))]
            for name, fn in scen:
                if only and name not in only:
                    continue
                print("\n── skenario %s ──" % name, flush=True)
                try:
                    fn()
                except Exception as e:  # noqa: BLE001
                    import traceback
                    traceback.print_exc()
                    check("%s exception" % name, False, "%s: %s" % (type(e).__name__, e))
            browser.close()
    except Exception as e:  # noqa: BLE001
        import traceback
        traceback.print_exc()
        check("exception", False, "%s: %s" % (type(e).__name__, e))
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        print("server log:", os.path.join(tmp, "server.log"))

    failed = [r for r in results if not r[1]]
    print("\n%d langkah, %d gagal" % (len(results), len(failed)))
    for r in failed:
        print("  FAIL", r[0], "—", r[2])
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
