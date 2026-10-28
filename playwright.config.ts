import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3400);

/**
 * End-to-end tests run against a production build (`next start`), because
 * production behaviour (CSP nonces, headers) is what we need to verify.
 * Build first: `npm run build && npm run test:e2e`.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "node scripts/start-standalone.mjs",
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      // The shell pages do not touch the database; the value only satisfies env validation.
      DATABASE_URL:
        process.env.DATABASE_URL ?? "postgresql://qtech:unused@127.0.0.1:5432/qtech_e2e_unused",
    },
  },
});
