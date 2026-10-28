import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  // "server-only" throws outside React Server Components; tests run server code directly.
  "server-only": fileURLToPath(new URL("./tests/support/empty-module.ts", import.meta.url)),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          // Integration tests share one real database; run files one at a time.
          fileParallelism: false,
          globalSetup: ["tests/support/integration-setup.ts"],
          testTimeout: 20_000,
        },
      },
    ],
  },
});
