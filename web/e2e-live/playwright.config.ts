import { defineConfig, devices } from "@playwright/test";

// The live two-device sync run (README.md here): the real web app on Vite's
// dev server, whose /api proxy reaches the real API on 127.0.0.1:8000 —
// which the spec starts and stops itself, on clintra_test. Local only: CI
// never runs it (it needs PHP, Postgres and the provisioning roles).
const PORT = 5173;

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.live\.spec\.ts/,
  // One organization, one API process: the tests run in order, one at a time.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 800 },
    baseURL: `http://localhost:${PORT}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
