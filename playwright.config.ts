import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3400);

/**
 * End-to-end tests run against the production build (standalone server),
 * because production behaviour (CSP nonces, headers, cookies) is what we need
 * to verify. Build first: `npm run build && npm run test:e2e`.
 *
 * They use TEST_DATABASE_URL (a database named *_test). Global setup wipes and
 * prepares it, so never point it at real data.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
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
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      APP_URL: `http://127.0.0.1:${PORT}`,
      STORAGE_LOCAL_DIR: "./.data/e2e-storage",
    },
  },
});
