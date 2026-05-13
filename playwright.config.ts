/**
 * E2E tests hit the **deployed HTTP API** (LocalStack or real AWS). No SPA / Vite server.
 * Set **`PLAYWRIGHT_API_BASE_URL`** to **`HttpApiUrl`** (no trailing slash). See [README-test.md](./README-test.md).
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
