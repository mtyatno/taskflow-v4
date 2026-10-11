const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.join(__dirname, "../../static/index.html");
const cssPath = path.join(__dirname, "../../static/app.css");
const swPath = path.join(__dirname, "../../static/sw.js");

test("Service Worker and stylesheet versions are synchronized for v386", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const sw = fs.readFileSync(swPath, "utf8");

  assert.match(sw, /taskflow-v386-dashboard-progressive-onboarding/);
  assert.match(html, /taskflow-v386-dashboard-progressive-onboarding/);
  assert.match(html, /app\.css\?v=322/);
});

test("Dashboard contains conditional rendering logic for new users (hasTasks)", () => {
  const html = fs.readFileSync(htmlPath, "utf8");

  // State checks
  assert.match(html, /hasTasks\s*=\s*tasks\.length\s*>\s*0/);
  assert.match(html, /dismissedOnboarding/);
  assert.match(html, /tf_dismiss_onboarding/);

  // DashOnboardingCard component exists
  assert.match(html, /DashOnboardingCard/);
  assert.match(html, /Mulai Langkah Pertama/);

  // Guards on KPI and Matrix sections
  assert.match(html, /hasTasks\s*&&[\s\S]*?dash-kpis/);
  assert.match(html, /hasTasks\s*&&[\s\S]*?eisenhower/);
  assert.match(html, /hasTasks\s*&&[\s\S]*?gtd/);
  assert.match(html, /hasCompletedTasks\s*&&[\s\S]*?Analitik/);
});

test("app.css contains styling for DashOnboardingCard without border-left", () => {
  const css = fs.readFileSync(cssPath, "utf8");

  assert.match(css, /\.dash-onboarding-card/);
  assert.match(css, /\.onboarding-step-item/);
  assert.match(css, /\.onboarding-step-btn/);

  // Strict check: no border-left or borderLeft inside onboarding rules
  const onboardingSection = css.slice(css.indexOf(".dash-onboarding-card"));
  const relevantChunk = onboardingSection.slice(0, 2500);
  assert.strictEqual(/border-left\s*:/i.test(relevantChunk), false, "Must not use border-left styling");
});
