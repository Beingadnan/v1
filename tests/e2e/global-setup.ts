import { execFileSync } from "node:child_process";

import { e2eDatabaseUrl } from "./support";

/** Wipes and prepares the *_test database before the browser tests start. */
export default function globalSetup(): void {
  execFileSync("npx", ["tsx", "--conditions=react-server", "scripts/e2e-prepare.ts"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: e2eDatabaseUrl() },
  });
}
