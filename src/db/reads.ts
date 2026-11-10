import "server-only";

import { PgTransaction } from "drizzle-orm/pg-core";

import type { DbExecutor } from "./client-factory";

type Reads = readonly (() => PromiseLike<unknown>)[];
type Results<T extends Reads> = { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };

/**
 * Runs independent reads. On the pool they go out at once, each on its own
 * connection: on a distant database every round trip costs ~250 ms, so this
 * saves seconds on a page. Inside a transaction there is one connection, and
 * pg (from version 9) refuses a query while another is running on it, so
 * there they run one after another.
 */
export async function reads<const T extends Reads>(
  executor: DbExecutor,
  list: T,
): Promise<Results<T>> {
  if (executor instanceof PgTransaction) {
    const out: unknown[] = [];
    for (const read of list) out.push(await read());
    return out as Results<T>;
  }
  return (await Promise.all(list.map((read) => read()))) as Results<T>;
}
