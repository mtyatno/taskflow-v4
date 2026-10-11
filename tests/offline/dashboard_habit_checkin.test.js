const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.join(__dirname, "../../static/index.html");
const cssPath = path.join(__dirname, "../../static/app.css");
const swPath = path.join(__dirname, "../../static/sw.js");

function fnSource(name, src) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = src.indexOf("\n}\n", start);
  assert.ok(end > start, `${name} end must be found`);
  return src.slice(start, end);
}

test("1. static/app.css defines quick habit pill and center hud habit classes", () => {
  const css = fs.readFileSync(cssPath, "utf8");

  assert.match(css, /\.dash-hero-habit-strip\s*\{/);
  assert.match(css, /\.dash-hero-habit-pill\s*\{/);
  assert.match(css, /\.dash-hero-habit-pill:hover\s*\{/);
  assert.match(css, /\.dash-hero-habit-pill\.is-completed\s*\{/);
  assert.match(css, /\.dash-hero-habit-check\s*\{/);
  assert.match(css, /\.dash-hero-habit-check\.is-done\s*\{/);
  assert.match(css, /\.dash-hero-habit-tag\s*\{/);
  assert.match(css, /\.dash-hero-habit-name\s*\{/);
  assert.match(css, /\.dash-hero-habit-count\s*\{/);
  assert.match(css, /\.dash-hero-habit-cta\s*\{/);
  assert.match(css, /\.center-hud-icon-habit\s*\{/);
  assert.match(css, /\[data-theme="dark"\]\s+\.center-hud-icon-habit\s*\{/);
});

test("2. NO border-left or borderLeft in habit styles and components", () => {
  const css = fs.readFileSync(cssPath, "utf8");
  const html = fs.readFileSync(htmlPath, "utf8");

  // Check the CSS block for habit pill
  const habitCssBlock = css.match(/\.dash-hero-habit-strip[\s\S]*?\.dash-hero-habit-pill:hover \.dash-hero-habit-cta\s*\{[^}]+\}/);
  assert.ok(habitCssBlock, "Habit CSS block must be found");
  assert.doesNotMatch(habitCssBlock[0], /border-left/i, "Habit CSS must not have border-left");

  // Check HUD habit css block
  const hudHabitBlock = css.match(/\.center-hud-icon-habit\s*\{[^}]+\}/);
  assert.ok(hudHabitBlock, "Center HUD habit block must be found");
  assert.doesNotMatch(hudHabitBlock[0], /border-left/i, "HUD habit CSS must not have border-left");

  // Check Dashboard source for borderLeft
  const dashSrc = fnSource("Dashboard", html);
  assert.doesNotMatch(dashSrc, /borderLeft/i, "Dashboard component must not introduce borderLeft");
});

test("3. Dashboard component in static/index.html implements habit checkin and Center HUD toast", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const dashSrc = fnSource("Dashboard", html);

  // State and fetching logic
  assert.match(dashSrc, /const\s+\[habits,\s*setHabits\]\s*=\s*useState\(\[\]\);/);
  assert.match(dashSrc, /api\.get\(["']\/api\/habits\/today["']\)/);
  assert.match(dashSrc, /OfflineDB\.cacheSet\(["']habits_today["']/);
  assert.match(dashSrc, /OfflineDB\.cacheGet\(["']habits_today["']/);
  assert.match(dashSrc, /window\.addEventListener\(["']habitSaved["'],\s*fetchHabits\)/);

  // Status calculation
  assert.match(dashSrc, /const\s+pendingHabits\s*=\s*\(habits\s*\|\|\s*\[\]\)\.filter\(h\s*=>\s*!h\.today_status\);/);
  assert.match(dashSrc, /const\s+doneHabits\s*=\s*\(habits\s*\|\|\s*\[\]\)\.filter\(h\s*=>\s*h\.today_status\s*===\s*["']done["']\);/);
  assert.match(dashSrc, /const\s+totalHabits\s*=\s*\(habits\s*\|\|\s*\[\]\)\.length;/);
  assert.match(dashSrc, /const\s+currentPhase\s*=\s*hour\s*<\s*11\s*\?\s*["']pagi["']\s*:\s*hour\s*<\s*17\s*\?\s*["']siang["']\s*:\s*["']malam["'];/);
  assert.match(dashSrc, /const\s+nextHabit\s*=\s*pendingHabits\.find\(h\s*=>\s*h\.phase\s*===\s*currentPhase\)\s*\|\|\s*pendingHabits\[0\];/);

  // Handler handleCheckinHabit
  assert.match(dashSrc, /const\s+handleCheckinHabit\s*=\s*async\s+habit\s*=>/);
  assert.match(dashSrc, /api\.post\(`\/api\/habits\/\$\{habit\.id\}\/checkin`/);
  assert.match(dashSrc, /setCenterToast\(\{\s*id:\s*Date\.now\(\),\s*type:\s*["']habit["'],\s*title:\s*`Great, one activity done! 🎉 \(\$\{habit\.title\s*\|\|\s*habit\.name\s*\|\|\s*["']Habit["']\}\)`\s*\}\)/);
  assert.match(dashSrc, /window\.dispatchEvent\(new CustomEvent\(["']habitSaved["']\)\)/);

  // Hero strip rendering
  assert.match(dashSrc, /totalHabits\s*>\s*0\s*&&/);
  assert.match(dashSrc, /dash-hero-habit-strip/);
  assert.match(dashSrc, /dash-hero-habit-pill/);
  assert.match(dashSrc, /title:\s*`Klik untuk selesaikan habit: \$\{nextHabit\.title\s*\|\|\s*nextHabit\.name\s*\|\|\s*["']Habit["']\}`/);
  assert.match(dashSrc, /["']aria-label["']:\s*`Selesaikan habit \$\{nextHabit\.title\s*\|\|\s*nextHabit\.name\s*\|\|\s*["']Habit["']\}`/);
  assert.match(dashSrc, /className:\s*["']dash-hero-habit-name["']/);
  assert.match(dashSrc, /nextHabit\.title\s*\|\|\s*nextHabit\.name\s*\|\|\s*["']Habit["']/);
  assert.match(dashSrc, /Semua habit hari ini selesai/);

  // Center HUD toast rendering
  assert.match(dashSrc, /centerToast\.type\s*===\s*["']habit["']\s*\?\s*["']activity["']/);
});

test("4. Service Worker and index.html cache version is taskflow-v391-gtd-inbox-triage-wizard", () => {
  const sw = fs.readFileSync(swPath, "utf8");
  const html = fs.readFileSync(htmlPath, "utf8");

  assert.match(sw, /^const CACHE = "taskflow-v391-gtd-inbox-triage-wizard";/m);
  assert.match(html, /window\.__SW_VERSION\s*=\s*"taskflow-v391-gtd-inbox-triage-wizard";/);
});
