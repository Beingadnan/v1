/**
 * reads(): independent reads go out at once on the pool, and one after another
 * inside a transaction (one connection, which pg 9 won't share).
 */
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { reads } from "@/db/reads";

import { openTestDatabase } from "../support/test-db";

const { db, close } = openTestDatabase();
afterAll(close);

const sleep = (executor: typeof db) =>
  executor.execute(sql`select pg_sleep(0.3), clock_timestamp() as at`);

describe("reads", () => {
  it("runs reads on the pool at the same time", async () => {
    const started = Date.now();
    const [a, b, c] = await reads(db, [() => sleep(db), () => sleep(db), () => Promise.resolve(7)]);
    expect(Date.now() - started).toBeLessThan(550);
    expect(a.rows).toHaveLength(1);
    expect(b.rows).toHaveLength(1);
    expect(c).toBe(7);
  });

  it("runs them one after another inside a transaction, in order", async () => {
    const started = Date.now();
    const order: number[] = [];
    await db.transaction(async (tx) => {
      const [first, second] = await reads(tx, [
        async () => {
          const r = await sleep(tx as unknown as typeof db);
          order.push(1);
          return r;
        },
        async () => {
          const r = await sleep(tx as unknown as typeof db);
          order.push(2);
          return r;
        },
      ]);
      expect(new Date(String(first.rows[0]!.at)) < new Date(String(second.rows[0]!.at))).toBe(true);
    });
    expect(order).toEqual([1, 2]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(600);
  });
});
