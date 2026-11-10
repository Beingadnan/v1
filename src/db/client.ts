import "server-only";

import type { Pool } from "pg";

import { env } from "@/lib/env";

import { createDatabase, createPool } from "./client-factory";

export type { Database, DbExecutor, Transaction } from "./client-factory";

// One pool per server process: reused across hot reloads in development, and shared with
// src/instrumentation.ts, which opens its connections when the server starts.
const globalForDb = globalThis as unknown as { qtechPool?: Pool };
const pool = (globalForDb.qtechPool ??= createPool(env.DATABASE_URL, env.DATABASE_POOL_MAX));

/** The app's shared database handle. Server code only. */
export const db = createDatabase(pool);

/**
 * Opens a few connections ahead of the first visitor (ADR 0018). A new
 * connection to the distant database costs several round trips (TCP, TLS,
 * the password exchange): over a second from India to a US region. A page
 * sends its reads together, often on 10 or more connections at once.
 */
export async function warmPool(connections = Math.min(10, env.DATABASE_POOL_MAX)): Promise<void> {
  const clients = await Promise.all(Array.from({ length: connections }, () => pool.connect()));
  for (const c of clients) c.release();
}
