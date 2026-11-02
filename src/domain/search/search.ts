import "server-only";

import { and, eq, ilike, or } from "drizzle-orm";

import type { Database } from "@/db/client-factory";
import { certificates, clientCompanies, equipment, instruments, jobs, studies } from "@/db/schema";
import { can } from "@/domain/auth/permissions";
import type { SessionUser } from "@/domain/auth/session-service";

export type SearchHit = { kind: string; label: string; detail: string; href: string };

const PER_KIND = 5;

/** Escapes % and _ so a search for "50%" matches literally. */
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Ctrl+K search across what QA Tech looks things up by: job number and PO,
 * report number, equipment ID, logger code and serial, certificate number,
 * client name. At most five of each, only what the person's role can open.
 */
export async function searchAll(
  db: Database,
  actor: SessionUser,
  query: string,
): Promise<SearchHit[]> {
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return [];
  const p = like(q);
  const org = actor.organisationId;
  const hits: SearchHit[] = [];

  if (can(actor, "jobs.view")) {
    const js = await db
      .select({
        id: jobs.id,
        number: jobs.number,
        po: jobs.poNumber,
        company: clientCompanies.name,
      })
      .from(jobs)
      .innerJoin(clientCompanies, eq(clientCompanies.id, jobs.companyId))
      .where(and(eq(jobs.organisationId, org), or(ilike(jobs.number, p), ilike(jobs.poNumber, p))))
      .limit(PER_KIND);
    for (const j of js) {
      hits.push({
        kind: "Job",
        label: j.number,
        detail: `${j.company}${j.po ? ` · PO ${j.po}` : ""}`,
        href: `/jobs/${j.id}`,
      });
    }
    const ss = await db
      .select({ id: studies.id, number: studies.reportNumber, code: equipment.code })
      .from(studies)
      .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
      .where(and(eq(studies.organisationId, org), ilike(studies.reportNumber, p)))
      .limit(PER_KIND);
    for (const s of ss) {
      hits.push({
        kind: "Report",
        label: s.number,
        detail: s.code,
        href: `/studies/${s.id}?tab=report`,
      });
    }
  }
  if (can(actor, "clients.view")) {
    const es = await db
      .select({
        id: equipment.id,
        code: equipment.code,
        name: equipment.name,
        companyId: equipment.companyId,
        company: clientCompanies.name,
      })
      .from(equipment)
      .innerJoin(clientCompanies, eq(clientCompanies.id, equipment.companyId))
      .where(
        and(
          eq(equipment.organisationId, org),
          or(ilike(equipment.code, p), ilike(equipment.name, p)),
        ),
      )
      .limit(PER_KIND);
    for (const e of es) {
      hits.push({
        kind: "Equipment",
        label: e.code,
        detail: `${e.name} · ${e.company}`,
        href: `/clients/${e.companyId}/equipment/${e.id}`,
      });
    }
    const cs = await db
      .select({ id: clientCompanies.id, name: clientCompanies.name, code: clientCompanies.code })
      .from(clientCompanies)
      .where(
        and(
          eq(clientCompanies.organisationId, org),
          or(ilike(clientCompanies.name, p), ilike(clientCompanies.code, p)),
        ),
      )
      .limit(PER_KIND);
    for (const c of cs)
      hits.push({ kind: "Client", label: c.name, detail: c.code, href: `/clients/${c.id}` });
  }
  if (can(actor, "instruments.view")) {
    const is = await db
      .select({
        id: instruments.id,
        code: instruments.code,
        serial: instruments.serialNo,
        make: instruments.make,
      })
      .from(instruments)
      .where(
        and(
          eq(instruments.organisationId, org),
          or(ilike(instruments.code, p), ilike(instruments.serialNo, p)),
        ),
      )
      .limit(PER_KIND);
    for (const i of is) {
      hits.push({
        kind: "Instrument",
        label: i.code,
        detail: [i.make, i.serial && `S/N ${i.serial}`].filter(Boolean).join(" · "),
        href: `/instruments/${i.id}`,
      });
    }
    const ct = await db
      .select({ id: certificates.id, number: certificates.number })
      .from(certificates)
      .where(and(eq(certificates.organisationId, org), ilike(certificates.number, p)))
      .limit(PER_KIND);
    for (const c of ct) {
      hits.push({
        kind: "Certificate",
        label: c.number,
        detail: "",
        href: `/instruments/certificates/${c.id}`,
      });
    }
  }
  return hits;
}
