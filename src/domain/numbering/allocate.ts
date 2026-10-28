import "server-only";

import { sql } from "drizzle-orm";

import type { Transaction } from "@/db/client-factory";
import { numberSeries } from "@/db/schema";

import { formatNumber } from "./format";

/**
 * Take the next number in a series and format it.
 *
 * Call it inside the transaction that creates the record using the number.
 * The single INSERT … ON CONFLICT DO UPDATE takes a row lock that is held until
 * that transaction ends, so concurrent callers queue and each receives a
 * distinct value, and a rolled-back record gives its number back: no
 * duplicates and no gaps.
 */
export async function allocateNumber(
  tx: Transaction,
  input: {
    organisationId: string;
    kind: "job" | "certificate";
    format: string;
    date: Date;
    siteCode?: string;
  },
): Promise<{ number: string; sequence: number; year: number }> {
  // Sequences restart each calendar year, counted in Indian time.
  const year = Number(
    new Intl.DateTimeFormat("en-IN", { year: "numeric", timeZone: "Asia/Kolkata" }).format(
      input.date,
    ),
  );
  const siteCode = input.siteCode ?? "";

  const [row] = await tx
    .insert(numberSeries)
    .values({
      organisationId: input.organisationId,
      kind: input.kind,
      siteCode,
      year,
      lastValue: 1,
    })
    .onConflictDoUpdate({
      target: [
        numberSeries.organisationId,
        numberSeries.kind,
        numberSeries.siteCode,
        numberSeries.year,
      ],
      set: { lastValue: sql`${numberSeries.lastValue} + 1` },
    })
    .returning({ lastValue: numberSeries.lastValue });
  if (!row) throw new Error("Number allocation returned no row");

  return {
    number: formatNumber(input.format, { year, sequence: row.lastValue, siteCode: input.siteCode }),
    sequence: row.lastValue,
    year,
  };
}
