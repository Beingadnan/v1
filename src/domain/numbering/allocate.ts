import "server-only";

import { sql } from "drizzle-orm";

import type { Transaction } from "@/db/client-factory";
import { numberSeries } from "@/db/schema";

import { formatNumber, seriesScope } from "./format";

/**
 * Take the next number in a series and format it.
 *
 * Call it inside the transaction that creates the record using the number.
 * The single INSERT … ON CONFLICT DO UPDATE takes a row lock that is held until
 * that transaction ends, so concurrent callers queue and each receives a
 * distinct value, and a rolled-back record gives its number back: no
 * duplicates and no gaps.
 *
 * Counters are kept per organisation, kind, site, year — and per month and
 * certificate kind when the format contains {MM} / {KIND}.
 */
export async function allocateNumber(
  tx: Transaction,
  input: {
    organisationId: string;
    kind: "job" | "certificate";
    format: string;
    date: Date;
    siteCode?: string;
    siteName?: string;
    /** Certificate series such as PDL, RTD, TC. */
    certificateKind?: string;
  },
): Promise<{ number: string; sequence: number; year: number; month: number }> {
  // Dates are counted in Indian time.
  const parts = new Intl.DateTimeFormat("en-IN", {
    year: "numeric",
    month: "numeric",
    timeZone: "Asia/Kolkata",
  }).formatToParts(input.date);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const siteCode = input.siteCode ?? "";
  const { period, series } = seriesScope(input.format, { month, kind: input.certificateKind });

  const [row] = await tx
    .insert(numberSeries)
    .values({
      organisationId: input.organisationId,
      kind: input.kind,
      siteCode,
      year,
      period,
      series,
      lastValue: 1,
    })
    .onConflictDoUpdate({
      target: [
        numberSeries.organisationId,
        numberSeries.kind,
        numberSeries.siteCode,
        numberSeries.year,
        numberSeries.period,
        numberSeries.series,
      ],
      set: { lastValue: sql`${numberSeries.lastValue} + 1` },
    })
    .returning({ lastValue: numberSeries.lastValue });
  if (!row) throw new Error("Number allocation returned no row");

  return {
    number: formatNumber(input.format, {
      year,
      month,
      sequence: row.lastValue,
      siteCode: input.siteCode,
      siteName: input.siteName,
      kind: input.certificateKind,
    }),
    sequence: row.lastValue,
    year,
    month,
  };
}
