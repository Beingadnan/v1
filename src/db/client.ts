import "server-only";

import type { Pool } from "pg";

import { env } from "@/lib/env";

import { createDatabase, createPool } from "./client-factory";

export type { Database, DbExecutor, Transaction } from "./client-factory";

// Reuse one pool across hot reloads in development instead of leaking connections.
const globalForDb = globalThis as unknown as { qtechPool?: Pool };
const pool = globalForDb.qtechPool ?? createPool(env.DATABASE_URL, env.DATABASE_POOL_MAX);
if (env.NODE_ENV !== "production") globalForDb.qtechPool = pool;

/** The app's shared database handle. Server code only. */
export const db = createDatabase(pool);
