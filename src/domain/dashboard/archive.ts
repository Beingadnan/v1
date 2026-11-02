import "server-only";

import { and, desc, eq } from "drizzle-orm";

import type { Database } from "@/db/client-factory";
import {
  clientCompanies,
  clientDepartments,
  clientSites,
  equipment,
  jobs,
  studies,
  studyReports,
} from "@/db/schema";
import { assertCan } from "@/domain/auth/permissions";
import type { SessionUser } from "@/domain/auth/session-service";
import { revLabel } from "@/domain/reports/types";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export type ArchiveStudy = {
  studyId: string;
  reportId: string;
  reportNumber: string;
  rev: string;
  code: string;
  name: string;
  jobNumber: string;
  signedOn: string;
  signedVia: string;
};
type Node<T> = { key: string; label: string; count: number; children: T };
export type ArchiveTree = Node<Node<Node<Node<Node<Node<ArchiveStudy[]>[]>[]>[]>[]>[]>[];

/** Groups items by a key, keeping first-seen order, with counts. */
function group<T, C>(
  items: T[],
  keyOf: (x: T) => string,
  labelOf: (x: T) => string,
  inner: (xs: T[]) => C,
): Node<C>[] {
  const map = new Map<string, T[]>();
  for (const x of items) {
    const k = keyOf(x);
    map.set(k, [...(map.get(k) ?? []), x]);
  }
  return [...map.entries()].map(([key, xs]) => ({
    key,
    label: labelOf(xs[0]!),
    count: xs.length,
    children: inner(xs),
  }));
}

/**
 * The company archive: every study whose report the client signed, as
 * Company → Site → Year → Month → Department → Equipment → studies, newest
 * first, by the date it was signed (IST).
 */
export async function archiveTree(db: Database, actor: SessionUser, companyId?: string) {
  assertCan(actor, "jobs.view");
  const rows = await db
    .select({
      studyId: studies.id,
      reportId: studyReports.id,
      reportNumber: studies.reportNumber,
      rev: studyReports.rev,
      signedAt: studyReports.signedAt,
      signedVia: studyReports.signedVia,
      code: equipment.code,
      name: equipment.name,
      department: clientDepartments.name,
      site: clientSites.name,
      companyId: clientCompanies.id,
      company: clientCompanies.name,
      jobNumber: jobs.number,
    })
    .from(studyReports)
    .innerJoin(studies, eq(studies.id, studyReports.studyId))
    .innerJoin(jobs, eq(jobs.id, studies.jobId))
    .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
    .innerJoin(clientCompanies, eq(clientCompanies.id, jobs.companyId))
    .innerJoin(clientSites, eq(clientSites.id, equipment.siteId))
    .leftJoin(clientDepartments, eq(clientDepartments.id, equipment.departmentId))
    .where(
      and(
        eq(studyReports.organisationId, actor.organisationId),
        eq(studyReports.status, "signed"),
        companyId ? eq(clientCompanies.id, companyId) : undefined,
      ),
    )
    .orderBy(clientCompanies.name, clientSites.name, desc(studyReports.signedAt))
    .limit(5000);
  const ist = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
  const flat = rows.map((r) => {
    const on = ist(r.signedAt!);
    return { ...r, on, year: on.slice(0, 4), month: on.slice(5, 7) };
  });
  const tree: ArchiveTree = group(
    flat,
    (r) => r.companyId,
    (r) => r.company,
    (byCo) =>
      group(
        byCo,
        (r) => r.site,
        (r) => r.site,
        (bySite) =>
          group(
            bySite,
            (r) => r.year,
            (r) => r.year,
            (byYear) =>
              group(
                byYear,
                (r) => r.month,
                (r) => MONTHS[Number(r.month) - 1]!,
                (byMonth) =>
                  group(
                    byMonth,
                    (r) => r.department ?? "",
                    (r) => r.department ?? "No department",
                    (byDept) =>
                      group(
                        byDept,
                        (r) => r.code,
                        (r) => `${r.code} · ${r.name}`,
                        (byEq) =>
                          byEq.map((r) => ({
                            studyId: r.studyId,
                            reportId: r.reportId,
                            reportNumber: r.reportNumber,
                            rev: revLabel(r.rev),
                            code: r.code,
                            name: r.name,
                            jobNumber: r.jobNumber,
                            signedOn: r.on,
                            signedVia: r.signedVia ?? "",
                          })),
                      ),
                  ),
              ),
          ),
      ),
  );
  return { tree, total: rows.length };
}
