/**
 * Runs once before the integration test files.
 * Rebuilds the test database from the migrations so every run starts clean.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { requireTestDatabaseUrl } from "./test-db";

export default async function setup(): Promise<void> {
  const url = requireTestDatabaseUrl();
  const pool = new Pool({ connectionString: url, max: 1 });
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
