// Hero Dashboard baru (spec docs/superpowers/specs/2026-10-27-hero-dashboard-design.md §3) + latar pilihan
// (spec docs/superpowers/specs/2026-10-27-latar-hero-design.md §4–§5): sumber index.html + app.css.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "../..");
const html = fs.readFileSync(path.join(root, "static/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "static/app.css"), "utf8");

function fnSource(name) {
  const s = html.indexOf(`function ${name}(`);
  assert.ok(s >= 0, `${name} harus ada`);
  const e = html.indexOf("\n}\n", s);
  assert.ok(e > s, `${name} akhir`);
  return html.slice(s, e);
}
const dash = fnSource("Dashboard");
const backdrop = fnSource("HeroBackdrop");
const backdropLayer = fnSource("HeroBackdropLayer");
const backdropHook = fnSource("useHeroBackdrop");
const heroStart = dash.indexOf("/* ── Hero ── */");
const heroEnd = dash.indexOf("/* ── KPI ── */");
assert.ok(heroStart > 0 && heroEnd > heroStart, "blok hero ditemukan");
const hero = dash.slice(heroStart, heroEnd);
const cssRule = sel => {
  const re = new RegExp(`(^|\\n)\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  assert.ok(m, "aturan CSS " + sel);
  return m[2];
};

test("memakai window.TF.hero dengan cadangan bila modul belum termuat", () => {
  assert.match(dash, /window\.TF && window\.TF\.hero/);
  assert.match(dash, /\.bestStreak\(habits\)/);
  assert.match(dash, /\.habitChips\(habits, currentPhase, 3\)/);
  assert.match(dash, /\.focusChip\(focusTask, timer\)/);
});

test("teks UI persis", () => {
  for (const s of ["hari beruntun", "terlambat", '"Fokus"', '"Mulai"', '"Jeda"', '"Pilih task untuk difokuskan"']) {
    assert.ok(hero.includes(s), "teks hero: " + s);
  }
  assert.match(hero, /`\$\{heroStreak\.days\} hari beruntun`/);
  assert.match(hero, /title: `Streak terpanjang: \$\{heroStreak\.title\}`/);
  assert.match(hero, /`\$\{overdueCount\} terlambat`/);
});

test("ringkasan: cabang prioritas tidak lagi menyebut terlambat; chip terlambat bersyarat", () => {
  assert.ok(dash.includes("`Ada ${pendingToday.length} prioritas hari ini.`"));
  assert.ok(!/prioritas hari ini\$\{overdueCount/.test(dash));
  assert.match(dash, /const showOverdueChip = pendingToday\.length > 0 && overdueCount > 0;/);
  assert.match(hero, /showOverdueChip && /);
  // warna bahaya = aturan .dash-date.is-overdue yang sudah ada (terang + gelap), bukan literal baru
  assert.match(hero, /className: "dash-date is-overdue dash-hero-overdue"/);
  assert.ok(dash.includes('"Menyinkronkan datamu…"'));
});

test("latar: hero = satu useHeroBackdrop(\"hero\") → section (base) + HeroBackdropLayer (hasil yang sama); topografi/ilustrasi lama pindah ke registri", () => {
  // Spec latar-hero §5: Kontur (bawaan) = topografi + ilustrasi palet lama, kini cabang "kontur" TF.herobg.
  assert.match(dash, /const heroBg = useHeroBackdrop\("hero"\);/);
  assert.equal(dash.split("useHeroBackdrop(").length - 1, 1, "latar hero dihitung sekali (satu hook, satu MutationObserver, satu uid)");
  assert.match(hero, /React\.createElement\("section", \{\s*className: "dash-hero",\s*style: heroBg \? \{\s*background: heroBg\.base\s*\} : undefined\s*\}, \/\*#__PURE__\*\/React\.createElement\(HeroBackdropLayer, \{\s*bd: heroBg,\s*cardBase: true\s*\}\), \/\*#__PURE__\*\/React\.createElement\("div", \{\s*className: "dash-hero-top"/);
  assert.equal(hero.split("React.createElement(HeroBackdropLayer,").length - 1, 1, "satu latar di hero");
  assert.equal(hero.split("React.createElement(HeroBackdrop,").length - 1, 0, "hero tidak memakai HeroBackdrop (hook kedua)");
  // Kelopak tema tetap (item flex di .dash-hero-top).
  assert.match(hero, /React\.createElement\(Decor, \{\s*slot: "page-corner"\s*\}\)/);
  for (const old of ["DASH_HERO_TOPO", "DashHeroIllus", "dash-hero-topo", "dash-hero-illus", "dhi-", "heroPalette"]) {
    assert.ok(!html.includes(old), "sisa lama di index.html: " + old);
    assert.ok(!css.includes(old), "sisa lama di app.css: " + old);
  }
});

test("HeroBackdropLayer: div.hb aria-hidden + ambient/fitur dari hasil hook; HeroBackdrop = hook + layer; useHeroBackdrop memo per kombinasi, uid per instance", () => {
  assert.match(backdropLayer, /^function HeroBackdropLayer\(\{\s*bd,\s*cardBase\s*\}\)/);
  assert.match(backdropLayer, /^function HeroBackdropLayer\([^)]*\) \{\s*if \(!bd\) return null;/);
  assert.match(backdropLayer, /className: `hb hb-\$\{bd\.place\} hb-k-\$\{bd\.kind\}`,\s*"aria-hidden": "true",\s*style: cardBase \? undefined : \{\s*background: bd\.base\s*\}/);
  assert.match(backdropLayer, /className: "hb-ambient",\s*dangerouslySetInnerHTML: \{\s*__html: bd\.ambient\s*\}/);
  assert.match(backdropLayer, /className: "hb-feature",\s*dangerouslySetInnerHTML: \{\s*__html: bd\.feature\s*\}/);
  assert.doesNotMatch(backdropLayer, /use[A-Z]\w*\(/, "layer presentasional: tanpa hook");
  assert.match(backdrop, /^function HeroBackdrop\(\{\s*place,\s*kind\s*\}\) \{\s*return React\.createElement\(HeroBackdropLayer, \{\s*bd: useHeroBackdrop\(place, kind\)\s*\}\);$/);
  assert.match(backdropHook, /\} = useThemeAttrs\(\);/);
  assert.match(backdropHook, /const uid = useRef\(null\);\s*if \(uid\.current === null\) uid\.current = "hb" \+ \+\+heroBackdropSeq;/);
  assert.match(backdropHook, /const reg = window\.TF && window\.TF\.herobg;/);
  assert.match(backdropHook, /const want = kind \|\| herobg;/);
  assert.match(backdropHook, /reg\.KINDS\.some\(k => k\.id === want\) \? want : "kontur"/);
  assert.match(backdropHook, /\{\s*place,\s*kind: id,\s*\.\.\.reg\.render\(\{\s*kind: id,\s*palette,\s*mode: theme,\s*place,\s*uid: uid\.current\s*\}\)/);
  assert.match(backdropHook, /\[reg, id, palette, theme, place\]\);/);
  // Tanpa literal warna di komponen (warna ada di registri/token).
  assert.doesNotMatch(backdrop + backdropLayer + backdropHook, /#[0-9a-f]{3,8}\b|rgba?\(/i);
});

// Render HeroBackdrop di sandbox vm: React tiruan (createElement → objek), hook tiruan, registri TF.herobg asli.
// HB(props) = render HeroBackdrop lalu jalankan elemen HeroBackdropLayer yang dikembalikannya (satu tingkat).
function renderBackdrop(props, { attrs = { theme: "light", palette: "sakura", decor: "on", herobg: "lanskap" }, registry = true, refs } = {}) {
  const hb = require("../../static/offline/herobg.js");
  const sandbox = {
    React: { createElement: (type, p, ...children) => ({ type, props: { ...(p || {}), children } }) },
    useThemeAttrs: () => attrs,
    useRef: init => { const r = { current: init }; if (refs) refs.push(r); return r; },
    useMemo: fn => fn(),
    window: { TF: registry ? { herobg: hb } : {} },
  };
  vm.runInNewContext("let heroBackdropSeq = 0;\n" + backdropHook + "\n}\n" + backdropLayer + "\n}\n" + backdrop + "\n}\n" +
    "this.useHB = useHeroBackdrop; this.Layer = HeroBackdropLayer;\n" +
    "this.HB = (props) => { const el = HeroBackdrop(props); if (el.type !== HeroBackdropLayer) throw new Error('bukan HeroBackdropLayer'); return el.type(el.props); };", sandbox);
  return { sandbox, hb };
}

test("render HeroBackdrop: struktur div.hb > hb-ambient + hb-feature, latar terpilih/kind, id unik per instance, cadangan", () => {
  const { sandbox, hb } = renderBackdrop();
  const a = sandbox.HB({ place: "hero" });
  assert.equal(a.type, "div");
  assert.equal(a.props.className, "hb hb-hero hb-k-lanskap");
  assert.equal(a.props["aria-hidden"], "true");
  const want = hb.render({ kind: "lanskap", palette: "sakura", mode: "light", place: "hero", uid: "hb1" });
  assert.equal(a.props.style.background, want.base);
  assert.deepEqual(a.props.children.map(c => c.props.className), ["hb-ambient", "hb-feature"]);
  assert.equal(a.props.children[0].props.dangerouslySetInnerHTML.__html, want.ambient);
  assert.equal(a.props.children[1].props.dangerouslySetInnerHTML.__html, want.feature);
  // Instance kedua (kartu lain di layar yang sama) → uid berbeda → tidak ada id SVG yang sama.
  const ids = n => [...(n.props.children[0].props.dangerouslySetInnerHTML.__html + n.props.children[1].props.dangerouslySetInnerHTML.__html).matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const b = sandbox.HB({ place: "hero" });
  assert.ok(ids(a).length > 0);
  for (const id of ids(b)) assert.ok(!ids(a).includes(id), "id ganda antar instance: " + id);
  // kind eksplisit (kartu pilihan Pengaturan) menimpa pilihan aktif; kind asing → kontur.
  const t = sandbox.HB({ place: "thumb", kind: "objek" });
  assert.equal(t.props.className, "hb hb-thumb hb-k-objek");
  assert.equal(sandbox.HB({ place: "thumb", kind: "foto" }).props.className, "hb hb-thumb hb-k-kontur");
  // Atribut <html data-herobg> asing (versi lebih baru) → kontur.
  const odd = renderBackdrop({}, { attrs: { theme: "dark", palette: "zzz", decor: "on", herobg: "foto" } });
  const k = odd.sandbox.HB({ place: "hero" });
  assert.equal(k.props.className, "hb hb-hero hb-k-kontur");
  assert.equal(k.props.style.background, odd.hb.render({ kind: "kontur", palette: "zzz", mode: "dark", place: "hero" }).base);
  // Registri belum termuat → hook null → layer null (tampilan lama, tanpa error).
  const none = renderBackdrop({}, { registry: false }).sandbox;
  assert.equal(none.useHB("hero"), null);
  assert.equal(none.HB({ place: "hero" }), null);
});

test("HeroBackdropLayer: merender hasil hook yang diberikan (tanpa menghitung ulang); cardBase → tanpa base inline", () => {
  const { sandbox } = renderBackdrop();
  const bd = sandbox.useHB("pomo", "galaksi");
  assert.deepEqual(Object.keys(bd).sort(), ["ambient", "base", "feature", "kind", "place"]);
  assert.equal(bd.place, "pomo");
  const el = sandbox.Layer({ bd });
  assert.equal(el.props.className, "hb hb-pomo hb-k-galaksi");
  assert.equal(el.props.style.background, bd.base);
  assert.equal(el.props.children[0].props.dangerouslySetInnerHTML.__html, bd.ambient);
  assert.equal(el.props.children[1].props.dangerouslySetInnerHTML.__html, bd.feature);
  // Kartu yang melukis base sendiri (hero Dashboard, kartu Pomodoro): div.hb tanpa style inline.
  assert.equal(sandbox.Layer({ bd, cardBase: true }).props.style, undefined);
  assert.equal(sandbox.Layer({ bd: null, cardBase: true }), null);
});

test("render HeroBackdrop: uid dibuat sekali per instance (useRef), tetap sama saat render ulang", () => {
  const { sandbox } = renderBackdrop();
  // React mengembalikan objek ref yang sama untuk instance yang sama di setiap render.
  const ref = { current: null };
  sandbox.useRef = () => ref;
  const first = sandbox.HB({ place: "pomo", kind: "galaksi" });
  assert.equal(ref.current, "hb1");
  const again = sandbox.HB({ place: "pomo", kind: "galaksi" });
  assert.equal(ref.current, "hb1", "uid tidak bertambah");
  assert.equal(again.props.children[1].props.dangerouslySetInnerHTML.__html, first.props.children[1].props.dangerouslySetInnerHTML.__html);
  assert.match(first.props.children[0].props.dangerouslySetInnerHTML.__html, /id="hb1-/);
});


test("chip Fokus: aktif (judul → today, Mulai/Jeda → timer) atau ajakan; hanya saat intro dashboard + ada task", () => {
  assert.match(dash, /const showFocusChip = intro === "dashboard" && hasTasks;/);
  assert.match(hero, /showFocusChip && \(heroFocus\.kind === "active"/);
  assert.match(hero, /timer\.pause\(\)/);
  assert.match(hero, /timer\.start\(\)/);
  assert.match(hero, /heroFocus\.action === "pause" \? "Jeda" : "Mulai"/);
  // fase menunggu/istirahat: action null → tanpa tombol aksi, judul tetap membuka Fokus Hari Ini
  assert.match(hero, /heroFocus\.action && \/\*#__PURE__\*\/React\.createElement\("button", \{\s*type: "button",\s*className: "dash-hero-focus-act"/);
  assert.match(hero, /onClick: \(\) => onNav\("today"\)[\s\S]{0,200}"Pilih task untuk difokuskan"/);
  assert.match(hero, /name: "pTarget"/);
});

test("chip habit: belum selesai = tombol check-in, selesai = non-interaktif bercoret, +N → halaman Habit", () => {
  assert.match(hero, /totalHabits > 0 && /);
  assert.match(hero, /heroHabits\.shown\.map/);
  assert.match(hero, /onClick: \(\) => handleCheckinHabit\(h\)/);
  assert.match(hero, /"aria-label": `Selesaikan habit \$\{hTitle\}`/);
  assert.match(hero, /"aria-label": `\$\{hTitle\} sudah selesai`/);
  assert.match(hero, /className: "dash-hero-chip dash-hero-habit is-done"/);
  assert.match(hero, /heroHabits\.more > 0 && /);
  assert.match(hero, /onClick: \(\) => onNav\("habit"\)/);
  assert.match(hero, /"aria-label": `Lihat \$\{heroHabits\.more\} habit lainnya`/);
  assert.match(css, /\.dash-hero-habit\.is-done \.dash-hero-habit-name\s*\{[^}]*line-through/);
});

test("chip habit dilewati: non-interaktif redup; hanya yang belum dicentang bisa diklik", () => {
  assert.match(hero, /h\.skipped \? \/\*#__PURE__\*\/React\.createElement\("span", \{/);
  assert.match(hero, /className: "dash-hero-chip dash-hero-habit is-skipped"/);
  assert.match(hero, /"aria-label": `\$\{hTitle\} dilewati hari ini`/);
  assert.match(hero, /: h\.today_status \? null : \/\*#__PURE__\*\/React\.createElement\("button"/);
  assert.match(cssRule(".dash-hero-habit.is-skipped"), /opacity:/);
});

test("semua habit selesai/dilewati dan tanpa +N → chip tautan Lihat habit", () => {
  assert.match(hero, /heroHabitsAllSettled && heroHabits\.more === 0 && /);
  assert.match(dash, /const heroHabitsAllSettled = heroHabits\.shown\.length > 0 && heroHabits\.shown\.every\(h => h\.done \|\| h\.skipped\);/);
  assert.match(hero, /className: "dash-hero-chip dash-hero-more dash-hero-habits-link"[\s\S]{0,120}onClick: \(\) => onNav\("habit"\),\s*"aria-label": "Buka halaman Habit"\s*\}, "Lihat habit"\)/);
});

test("streak memakai ViewGlyph pFlame dan disembunyikan bila null", () => {
  assert.match(hero, /heroStreak && /);
  assert.match(hero, /name: "pFlame"/);
});

test("tanpa emoji di hero; pil habit lama dihapus", () => {
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(hero), "emoji di blok hero");
  assert.ok(!/\\u(D83|2[67])/i.test(hero), "escape emoji di blok hero");
  assert.ok(!/Kerja bagus! 🎉/.test(dash), "ringkasan hero tanpa emoji");
  for (const old of ["dash-hero-habit-strip", "dash-hero-habit-pill", "dash-hero-habit-tag", "dash-hero-habit-cta", "dash-hero-habit-count", "nextHabit"]) {
    assert.ok(!html.includes(old), "sisa lama di index.html: " + old);
    assert.ok(!css.includes(old), "sisa lama di app.css: " + old);
  }
});

test("CSS: gradien token (cadangan = base Kontur), lapisan .hb, fitur disembunyikan ≤1100px dan decor off, tanpa border-left", () => {
  const h = cssRule(".dash-hero");
  // lapisan dasar padat: --accent-soft di tema gelap berupa rgba → tanpa ini sisi kanan tembus pandang. Sama persis dengan
  // base Kontur registri (dipakai bila TF.herobg belum termuat).
  assert.match(h, /background: linear-gradient\(105deg, var\(--bg-card\) 30%, var\(--accent-soft\) 100%\), var\(--bg-card\);/);
  const kontur = require("../../static/offline/herobg.js").render({ kind: "kontur", palette: "default", mode: "light", place: "hero", uid: "t" });
  assert.ok(h.includes("background: " + kontur.base + ";"), "cadangan CSS = base Kontur");
  assert.match(h, /border: 1px solid rgba\(var\(--accent-rgb\), 0\.25\)/);
  assert.match(h, /overflow: hidden/);
  assert.ok(!/\.dash-hero::after/.test(css), "glow ::after lama dihapus");
  const hb = cssRule(".hb");
  for (const re of [/position: absolute/, /inset: 0/, /z-index: 0/, /pointer-events: none/, /border-radius: inherit/, /overflow: hidden/]) assert.match(hb, re);
  assert.match(cssRule(".hb-ambient"), /position: absolute; inset: 0;/);
  assert.match(cssRule(".hb-feature"), /position: absolute;/);
  // Kotak fitur spec latar §4 (= viewBox fitur registri).
  assert.match(cssRule(".hb-hero .hb-feature"), /right: 226px; top: 4px; width: 290px; height: 140px;/);
  assert.match(cssRule(".hb-pomo .hb-feature"), /right: 28px; top: 68px; width: 340px; height: 62px;/);
  assert.match(cssRule(".hb-thumb .hb-feature"), /right: 6px; top: 4px; bottom: 4px; width: 86px;/);
  // Hero memotong isi sendiri di radius dalam garisnya; .hb tanpa radius agar sudut sama dengan svg topografi lama.
  assert.match(cssRule(".dash-hero > .hb"), /border-radius: 0;/);
  assert.match(css, /\[data-decor="off"\] \.hb-hero \.hb-feature, \[data-decor="off"\] \.hb-pomo \.hb-feature\s*\{\s*display: none;/);
  assert.match(css, /@media \(max-width: 1100px\)\s*\{[^@]*\.hb-hero \.hb-feature, \.hb-pomo \.hb-feature\s*\{\s*display: none;/);
  // Isi hero di atas latar.
  for (const sel of [".dash-hero-top", ".dash-hero-chips", ".dash-hero .scratchpad-bar.dash-capture"]) {
    assert.match(cssRule(sel), /position: relative; z-index: 1;/, sel);
  }
  assert.match(cssRule(".dash-hero-focus-act"), /color: var\(--accent-on, #1a2a00\)/);
  const block = css.slice(css.indexOf("\n.dash-hero {"), css.indexOf(".dash-ring {"));
  assert.doesNotMatch(block, /border-left/);
});

test("CSS HP (≤640px): chip Fokus penuh ≥44px, habit satu baris geser, chip ≥44px", () => {
  const m = css.match(/@media \(max-width: 640px\) \{\n  \.dash-hero \{[\s\S]*?\n\}/);
  assert.ok(m, "blok mobile dashboard");
  const b = m[0];
  assert.match(b, /\.dash-hero-focus\s*\{[^}]*width: 100%;[^}]*min-height: 44px;/);
  assert.match(b, /\.dash-hero-focus-act\s*\{[^}]*min-height: 44px;/);
  assert.match(b, /\.dash-hero-habits\s*\{[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto;/);
  assert.match(b, /\.dash-hero-chip\s*\{[^}]*min-height: 44px;/);
});

// 2026-10-27: "+N" dan "Lihat habit" sempat memanggil onNav("habits"), padahal id halaman Habit = "habit"
// (App: page === "habit") — klik jatuh ke halaman daftar task.
test("hero: tautan ke halaman Habit memakai id halaman \"habit\"", () => {
  const fs = require("node:fs"), path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "static", "index.html"), "utf8");
  assert.match(src, /if \(page === "habit"\)/);
  assert.doesNotMatch(src, /onNav\("habits"\)/);
  const hero = src.slice(src.indexOf('className: "dash-hero"'), src.indexOf('className: "scratchpad-bar dash-capture"'));
  assert.ok((hero.match(/onNav\("habit"\)/g) || []).length >= 2, "+N dan Lihat habit harus ke halaman habit");
});
