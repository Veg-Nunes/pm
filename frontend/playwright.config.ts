import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  // All spec files share one backend DB (no per-test/per-file reset beyond
  // the one webServer does at startup - see frontend/CLAUDE.md), so tests
  // across files that touch the same column (e.g. Backlog) would otherwise
  // race each other under the default multi-worker parallelism.
  workers: 1,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: "http://127.0.0.1:8000",
    trace: "retain-on-failure",
  },
  webServer: {
    // Auth requires the real backend, so e2e tests run against the built
    // static export served by FastAPI (same as production), not `next dev`.
    command:
      "npm run build && node scripts/copy-static.mjs && node scripts/reset-db.mjs && uv run --project ../backend uvicorn backend.main:app --host 127.0.0.1 --port 8000",
    url: "http://127.0.0.1:8000/api/health",
    reuseExistingServer: true,
    timeout: 180_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
