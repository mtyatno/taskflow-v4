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

test("1. static/app.css defines all GTD inline triage and wizard classes", () => {
  const css = fs.readFileSync(cssPath, "utf8");

  // Inline triage classes
  assert.match(css, /\.gtd-inline-triage\s*\{/);
  assert.match(css, /\.gtd-triage-chip\s*\{/);
  assert.match(css, /\.gtd-chip-done\s*\{/);
  assert.match(css, /\.gtd-chip-next\s*\{/);
  assert.match(css, /\.gtd-chip-waiting\s*\{/);
  assert.match(css, /\.gtd-chip-someday\s*\{/);
  assert.match(css, /\.gtd-launch-wizard-btn\s*\{/);

  // Wizard modal classes
  assert.match(css, /\.gtd-wizard-card\s*\{/);
  assert.match(css, /\.gtd-wizard-title\s*\{/);
  assert.match(css, /\.gtd-wizard-meta\s*\{/);
  assert.match(css, /\.gtd-wizard-desc\s*\{/);
  assert.match(css, /\.gtd-wizard-nudge\s*\{/);
  assert.match(css, /\.gtd-wizard-actions\s*\{/);
  assert.match(css, /\.gtd-wizard-btn\s*\{/);
  assert.match(css, /\.gtd-wizard-btn-done\s*\{/);
  assert.match(css, /\.gtd-wizard-btn-next\s*\{/);
  assert.match(css, /\.gtd-wizard-btn-waiting\s*\{/);
  assert.match(css, /\.gtd-wizard-btn-someday\s*\{/);
  assert.match(css, /\.gtd-wizard-footer\s*\{/);
  assert.match(css, /\.gtd-wizard-zero\s*\{/);
});

test("2. STRICT CONSTRAINT: NO border-left or borderLeft in GTD triage styles or components", () => {
  const css = fs.readFileSync(cssPath, "utf8");
  const html = fs.readFileSync(htmlPath, "utf8");

  // Verify GTD section in CSS has no border-left
  const gtdCssBlock = css.match(/\/\* ── GTD Inbox Quick Triage[\s\S]*?\.gtd-wizard-zero\s*\{[^}]+\}/);
  assert.ok(gtdCssBlock, "GTD CSS block must be found");
  assert.doesNotMatch(gtdCssBlock[0], /border-left/i, "GTD CSS must not have border-left");

  // Verify GtdInboxWizardModal component in HTML
  const wizardSrc = fnSource("GtdInboxWizardModal", html);
  assert.doesNotMatch(wizardSrc, /borderLeft/i, "GtdInboxWizardModal must not have borderLeft");

  // Verify TaskRow triage block
  const taskRowSrc = fnSource("TaskRow", html);
  assert.doesNotMatch(taskRowSrc, /borderLeft/i, "TaskRow must not have borderLeft");
});

test("3. TaskListView renders 'Proses Inbox' button and GtdInboxWizardModal when isInbox", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const tlvSrc = fnSource("TaskListView", html);

  assert.match(tlvSrc, /isInbox\s*=\s*page\s*===\s*["']inbox["']\s*\|\|\s*title\s*===\s*["']Inbox["']/);
  assert.match(tlvSrc, /const\s+\[wizardOpen,\s*setWizardOpen\]\s*=\s*useState\(false\)/);
  assert.match(tlvSrc, /gtd-launch-wizard-btn/);
  assert.match(tlvSrc, /Proses Inbox/);
  assert.match(tlvSrc, /setWizardOpen\(true\)/);
  assert.match(tlvSrc, /GtdInboxWizardModal/);
  assert.match(tlvSrc, /wizardOpen\s*&&\s*isInbox\s*&&\s*\/\*#__PURE__\*\/React\.createElement\(GtdInboxWizardModal/);
});

test("4. TaskRow and CompactRow render .gtd-inline-triage chips when isInbox", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const taskRowSrc = fnSource("TaskRow", html);
  const compactRowSrc = fnSource("CompactRow", html);

  // TaskRow inline triage
  assert.match(taskRowSrc, /isInbox\s*&&\s*onUpdateGtdStatus\s*&&\s*task\.gtd_status\s*===\s*["']inbox["']/);
  assert.match(taskRowSrc, /gtd-inline-triage/);
  assert.match(taskRowSrc, /gtd-chip-done/);
  assert.match(taskRowSrc, /gtd-chip-next/);
  assert.match(taskRowSrc, /gtd-chip-waiting/);
  assert.match(taskRowSrc, /gtd-chip-someday/);
  assert.match(taskRowSrc, /onUpdateGtdStatus\(task\.id,\s*["']done["']\)/);
  assert.match(taskRowSrc, /onUpdateGtdStatus\(task\.id,\s*["']next["']\)/);
  assert.match(taskRowSrc, /onUpdateGtdStatus\(task\.id,\s*["']waiting["']\)/);
  assert.match(taskRowSrc, /onUpdateGtdStatus\(task\.id,\s*["']someday["']\)/);

  // CompactRow inline triage
  assert.match(compactRowSrc, /isInbox\s*&&\s*onUpdateGtdStatus\s*&&\s*task\.gtd_status\s*===\s*["']inbox["']/);
  assert.match(compactRowSrc, /gtd-inline-triage/);
  assert.match(compactRowSrc, /gtd-chip-done/);
  assert.match(compactRowSrc, /gtd-chip-next/);
  assert.match(compactRowSrc, /gtd-chip-waiting/);
  assert.match(compactRowSrc, /gtd-chip-someday/);
});

test("5. GtdInboxWizardModal provides step-by-step triage workflow and zero state", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const wizardSrc = fnSource("GtdInboxWizardModal", html);

  // Current task navigation
  assert.match(wizardSrc, /const\s+\[currentIndex,\s*setCurrentIndex\]\s*=\s*useState\(0\)/);
  assert.match(wizardSrc, /const\s+currentTask\s*=\s*tasks\[(safeIndex|currentIndex)\]/);

  // Zero state
  assert.match(wizardSrc, /gtd-wizard-zero/);
  assert.match(wizardSrc, /Inbox Zero!/);
  assert.match(wizardSrc, /Semua tugas telah ditelaah/);

  // GTD Action buttons
  assert.match(wizardSrc, /gtd-wizard-btn-done/);
  assert.match(wizardSrc, /gtd-wizard-btn-next/);
  assert.match(wizardSrc, /gtd-wizard-btn-waiting/);
  assert.match(wizardSrc, /gtd-wizard-btn-someday/);
  assert.match(wizardSrc, /setCurrentIndex\(prev\s*=>/);

  // Escape key handler
  assert.match(wizardSrc, /e\.key\s*===\s*["']Escape["']/);
});

test("6. App provides handleUpdateTaskGtd with optimistic update and offline queue fallback", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const appSrc = fnSource("App", html);

  assert.match(appSrc, /const\s+handleUpdateTaskGtd\s*=\s*async\s*\(/);
  assert.match(appSrc, /targetStatus\s*===\s*["']done["']/);
  assert.match(appSrc, /setTasks\(prev\s*=>\s*prev\.map/);
  assert.match(appSrc, /api\.put\([`"']\/api\/tasks\/\$\{taskId\}[`"']/);
  assert.match(appSrc, /OfflineDB\.queueAdd/);
  assert.match(appSrc, /onUpdateGtdStatus:\s*handleUpdateTaskGtd/);
});

test("7. Service Worker and stylesheet versions are bumped to v411 and app.css?v=380", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const sw = fs.readFileSync(swPath, "utf8");

  assert.match(html, /<link rel="stylesheet" href="\/static\/app\.css\?v=380">/);
  assert.match(html, /window\.__SW_VERSION\s*=\s*"taskflow-v484-hero-habit-hp";/);
  assert.match(sw, /^const CACHE = "taskflow-v484-hero-habit-hp";/m);
});

test("8. Dashboard KPI Inbox integrates GtdInboxWizardModal and navigations", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const dashSrc = fnSource("Dashboard", html);
  const appSrc = fnSource("App", html);
  const wizardSrc = fnSource("GtdInboxWizardModal", html);

  // Dashboard receives onUpdateGtdStatus
  assert.match(dashSrc, /onUpdateGtdStatus/);

  // Dashboard defines inboxTasks and state inboxWizardOpen
  assert.match(dashSrc, /const\s+inboxTasks\s*=\s*tasks\.filter\(t\s*=>\s*t\.gtd_status\s*===\s*["']inbox["']/);
  assert.match(dashSrc, /const\s+\[inboxWizardOpen,\s*setInboxWizardOpen\]\s*=\s*useState\(false\)/);

  // KPI Inbox onClick opens wizard when inboxCount > 0 and falls back to onNav("inbox") when 0
  assert.match(dashSrc, /key:\s*["']inbox["']/);
  assert.match(dashSrc, /onClick:\s*\(\)\s*=>\s*\{\s*if\s*\(\s*inboxCount\s*>\s*0\s*\)\s*\{\s*setInboxWizardOpen\(true\);\s*\}\s*else\s*\{\s*onNav\(["']inbox["']\);\s*\}\s*\}/);

  // Dashboard renders inboxWizardOpen && React.createElement(GtdInboxWizardModal, ...)
  assert.match(dashSrc, /inboxWizardOpen\s*&&\s*\/\*#__PURE__\*\/React\.createElement\(GtdInboxWizardModal,\s*\{/);

  // App passes onUpdateGtdStatus: handleUpdateTaskGtd to Dashboard
  assert.match(appSrc, /React\.createElement\(Dashboard,\s*\{[\s\S]*?onUpdateGtdStatus:\s*handleUpdateTaskGtd/);

  // GtdInboxWizardModal accepts onNav and renders "Buka Inbox ↗" button
  assert.match(wizardSrc, /onNav/);
  assert.match(wizardSrc, /onNav\(["']inbox["']\)/);
  assert.match(wizardSrc, /Buka Inbox ↗/);
});


test("9. Proses Inbox wizard lets the user edit priority, project and date inline", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const css = fs.readFileSync(cssPath, "utf8");
  const wizardSrc = fnSource("GtdInboxWizardModal", html);
  const editSrc = fnSource("GtdWizardEditFields", html);
  const appSrc = fnSource("App", html);
  const dashSrc = fnSource("Dashboard", html);
  const tlvSrc = fnSource("TaskListView", html);

  // Wizard renders the edit fields for the current task, keyed by task id
  assert.match(wizardSrc, /React\.createElement\(GtdWizardEditFields,\s*\{\s*key:\s*currentTask\.id/);
  // The card stays on the edited task when the list re-sorts
  assert.match(wizardSrc, /pinnedIdRef/);
  assert.match(wizardSrc, /tasks\.findIndex\(t\s*=>\s*t\.id\s*===\s*pinnedIdRef\.current\)/);

  // One row of dropdowns: priority P1-P4, project (+ new), date (quick picks + calendar + clear)
  assert.match(editSrc, /\["P1",\s*"[^"]*P1 Critical"\]/);
  assert.match(editSrc, /"aria-label":\s*"Prioritas"/);
  assert.match(editSrc, /save\(\{\s*priority:\s*e\.target\.value\s*\}\)/);
  assert.match(editSrc, /__new__/);
  assert.match(editSrc, /save\(\{\s*project:\s*v\s*\}\)/);
  assert.match(editSrc, /__pick__/);
  assert.match(editSrc, /type:\s*"date"/);
  assert.match(editSrc, /save\(\{\s*deadline:\s*v\s*\}\)/);
  assert.match(editSrc, /Tanpa tanggal/);
  assert.match(editSrc, /Hari ini/);
  assert.match(editSrc, /Besok/);
  assert.doesNotMatch(editSrc, /input-label/, "no field labels in the one-row editor");
  assert.doesNotMatch(editSrc, /borderLeft/i);

  // App saves a partial PUT, optimistic, with offline queue; wired to both wizards
  assert.match(appSrc, /const\s+handleUpdateTaskFields\s*=\s*async\s*\(taskId,\s*patch\)/);
  assert.match(appSrc, /api\.put\(`\/api\/tasks\/\$\{taskId\}`,\s*patch\)/);
  assert.match(appSrc, /React\.createElement\(Dashboard,\s*\{[\s\S]*?onUpdateTask:\s*handleUpdateTaskFields,\s*projects:\s*projects/);
  assert.match(appSrc, /React\.createElement\(TaskListView,\s*\{[\s\S]*?onUpdateTask:\s*handleUpdateTaskFields/);
  assert.match(dashSrc, /onUpdateTask:\s*onUpdateTask,\s*projects:\s*projects/);
  assert.match(tlvSrc, /onUpdateTask:\s*onUpdateTask/);

  // Styles, without coloured side stripes
  const editCss = css.match(/\/\* Proses Inbox wizard: editable[\s\S]*?@media \(max-width: 520px\)[\s\S]*?\}\s*\}/);
  assert.ok(editCss, "wizard edit CSS block must exist");
  assert.match(editCss[0], /\.gtd-wizard-edit\s*\{[^}]*grid-template-columns:[^;]*,[^;]*,/);
  assert.match(editCss[0], /\.gtd-wizard-pri-select\.pri-p1\s*\{/);
  assert.doesNotMatch(editCss[0], /border-left/i);
});
