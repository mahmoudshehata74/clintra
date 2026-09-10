import { defineConfig, devices } from "@playwright/test";

// The preview server (vite preview) serves the built app from dist/. It runs
// on a dedicated, fixed port so the baseURL and webServer agree, and so a
// developer can leave one running between runs (reuseExistingServer locally).
const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * End-to-end layer for the day screen and its sheets. Every spec drives the
 * real app in a real browser — the gap unit tests and code traces cannot
 * close, which is where this project's browser-only bugs have hidden before.
 *
 * Two projects run every interaction spec on both the desktop width and an
 * iPhone-14-class width (the closest stock profile to the clinic tablet
 * target); both use Chromium, since the app ships a single engine and these
 * are layout/interaction checks, not cross-browser-engine checks.
 *
 * The opt-in screenshot capture (screenshots.spec.ts, tagged @screenshot) is
 * excluded from the default run via --grep-invert in the test:e2e script, so
 * CI never runs it — see web/package.json and .github/workflows/ci.yml.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // A few flows (the overbook path fills the whole day booking-by-booking) are
  // deliberately heavy; capping workers keeps many parallel Chromium instances
  // from starving each other's CPU and turning that work into spurious
  // timeouts, and the raised ceilings give those flows room on a loaded runner.
  workers: process.env.CI ? 2 : 3,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    // Interaction tests keep a screenshot and a trace only when something
    // actually fails, so a green run leaves no artefacts behind.
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      // iPhone 14 is 390×844 at dpr 3 — matched explicitly rather than via a
      // named device so the viewport stays the documented layout target even
      // if Playwright's bundled descriptor changes.
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: false },
    },
  ],
  webServer: {
    // Serves the already-built dist/. The test:e2e script runs `pnpm build`
    // before invoking Playwright, so dist/ is always fresh for a local run;
    // CI builds in its own step before this server starts.
    command: `pnpm run preview -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
