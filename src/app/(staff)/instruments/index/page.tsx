import { Download, ListOrdered } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/db/client";
import { todayInIndia } from "@/domain/clients/requalification";
import { dmy } from "@/domain/instruments/display";
import { MONTH_NAMES } from "@/domain/instruments/index-export";
import { calibrationIndex } from "@/domain/instruments/queries";
import { requirePermission } from "@/lib/auth/dal";

import { readIndexMonth } from "./month";

export const metadata = { title: "Calibration Index" };

export default async function IndexPage({ searchParams }: PageProps<"/instruments/index">) {
  const actor = await requirePermission("instruments.view");
  const { year, month } = readIndexMonth(await searchParams, todayInIndia());
  const sections = await calibrationIndex(db, actor, year, month);
  const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  const total = sections.reduce((n, s) => n + s.rows.length, 0);

  return (
    <>
      <PageHeader
        title="Calibration Index"
        description="Built from the issued certificates, so it is never typed by hand. Download it in the same layout as the Excel index."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" asChild>
              <a href={`/instruments/index/export?year=${year}&month=${month}`} download>
                <Download aria-hidden="true" />
                {MONTH_NAMES[month - 1]} (.xlsx)
              </a>
            </Button>
            <Button variant="secondary" asChild>
              <a href={`/instruments/index/export?year=${year}`} download>
                <Download aria-hidden="true" />
                Whole {year}
              </a>
            </Button>
          </div>
        }
      />
      <nav aria-label="Month" className="flex items-center gap-3">
        <Link
          className="text-primary hover:underline"
          href={`/instruments/index?year=${prev.year}&month=${prev.month}`}
        >
          ← {MONTH_NAMES[prev.month - 1]}
        </Link>
        <h2 className="text-lg font-semibold">
          {MONTH_NAMES[month - 1]} {year}
        </h2>
        <Link
          className="text-primary hover:underline"
          href={`/instruments/index?year=${next.year}&month=${next.month}`}
        >
          {MONTH_NAMES[next.month - 1]} →
        </Link>
        <span className="text-sm text-muted-foreground">{total} certificates</span>
      </nav>
      {sections.length === 0 ? (
        <EmptyState
          icon={ListOrdered}
          title="No certificates issued this month"
          description="Certificates appear here once they are approved and issued (or imported)."
        />
      ) : (
        sections.map((s) => (
          <section key={s.kind} aria-labelledby={`sec-${s.kind}`} className="flex flex-col gap-2">
            <h3 id={`sec-${s.kind}`} className="font-semibold">
              {s.section}
            </h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">Sr. No.</TableHead>
                  <TableHead>Name of Customer</TableHead>
                  <TableHead>Certificate No</TableHead>
                  <TableHead>Cal. Date</TableHead>
                  <TableHead>Cal. Due date</TableHead>
                  <TableHead className="hidden md:table-cell">Activity Done by</TableHead>
                  <TableHead className="hidden md:table-cell">Certificate Done by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.rows.map((r, i) => (
                  <TableRow key={r.id}>
                    <TableCell className="tabular">{i + 1}</TableCell>
                    <TableCell>{r.customerName}</TableCell>
                    <TableCell>
                      <Link
                        href={`/instruments/certificates/${r.id}`}
                        className="text-primary hover:underline"
                      >
                        {r.number}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular">{dmy(r.calibratedOn)}</TableCell>
                    <TableCell className="tabular">{dmy(r.validUntil)}</TableCell>
                    <TableCell className="hidden md:table-cell">{r.doneBy || "—"}</TableCell>
                    <TableCell className="hidden md:table-cell">{r.certificateBy || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        ))
      )}
    </>
  );
}
