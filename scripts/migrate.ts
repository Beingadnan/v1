/**
 * Applies pending SQL migrations from ./drizzle in order.
 * Usage: DATABASE_URL=... npm run db:migrate
 *
 * Migrations only move forward; a mistake is fixed by a new migration.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  // The app's role has a 60 s statement timeout (migration 0032); a migration that
  // rebuilds an index on a large table may need longer. This only holds on a direct
  // connection: through Neon's pooler, run long migrations with the direct URL.
  pool.on("connect", (client) => {
    client.query("set statement_timeout = 0").catch((error: unknown) => {
      console.error("Could not lift the statement timeout:", error);
    });
  });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    console.log("Migrations applied.");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
