import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
/** A transaction handle; pass it to helpers that must join the caller's transaction. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything that can run queries: the database itself or an open transaction. */
export type DbExecutor = Database | Transaction;

/** Builds a connection pool. Kept free of app env so tests can point it anywhere. */
export function createPool(connectionString: string, max: number): Pool {
  const pool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // Without this handler an idle-client error (e.g. the DB restarts) crashes the process.
  pool.on("error", (error) => {
    console.error(
      JSON.stringify({ level: "error", msg: "postgres pool error", error: error.message }),
    );
  });
  return pool;
}

export function createDatabase(pool: Pool): Database {
  return drizzle(pool, { schema });
}
