/**
 * Runs once before the integration test files.
 * Rebuilds the test database from the migrations so every run starts clean.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { requireTestDatabaseUrl } from "./test-db";

export default async function setup(): Promise<void> {
  try {
    await rebuildTestDatabase();
  } catch (error) {
    // Vitest 5 crashes while printing errors thrown from global setup
    // ("code.charCodeAt is not a function"), which hides the real reason
    // (bad TEST_DATABASE_URL, database unreachable…). Print it plainly and stop.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n✗ Integration tests not run: ${message}\n`);
    process.exit(1);
  }
}

async function rebuildTestDatabase(): Promise<void> {
  const url = requireTestDatabaseUrl();
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
  try {
    // Wipes only the dedicated *_test database (guarded in requireTestDatabaseUrl).
    await pool.query(
      "drop schema if exists public cascade; drop schema if exists drizzle cascade;",
    );
    await pool.query("create schema public;");
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  } finally {
    await pool.end();
  }
}
