import { and, asc, desc, eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/db/client";
import { certificateItems, certificates, clientCompanies, instruments, sites } from "@/db/schema";
import { todayInIndia } from "@/domain/clients/requalification";
import { isUuid } from "@/domain/clients/shared";
import { usableInstruments } from "@/domain/instruments/queries";
import { requirePermission } from "@/lib/auth/dal";

import { NewCalibrationForm } from "./new-calibration-form";

export const metadata = { title: "New calibration" };

export default async function NewCalibrationPage({
  searchParams,
}: PageProps<"/instruments/certificates/new">) {
  const actor = await requirePermission("calibration.perform");
  const { from } = await searchParams;
  const today = todayInIndia();
  const org = actor.organisationId;

  const siteRows = await db
    .select({ id: sites.id, code: sites.code, name: sites.name })
    .from(sites)
    .where(and(eq(sites.organisationId, org), eq(sites.active, true)))
    .orderBy(asc(sites.name));
  const companies = await db
    .select({ id: clientCompanies.id, name: clientCompanies.name })
    .from(clientCompanies)
    .where(and(eq(clientCompanies.organisationId, org), eq(clientCompanies.active, true)))
    .orderBy(asc(clientCompanies.name));
  const masters = (await usableInstruments(db, actor, "master", today)).map((m) => ({
    id: m.id,
    code: m.code,
    label: `${m.equipmentName || m.type} · ${m.make} ${m.model}`.trim(),
    serialNo: m.serialNo,
    certificate: m.coveringCertificate?.number ?? null,
    validUntil: m.coveringCertificate?.validUntil ?? m.latest?.validUntil ?? null,
    usable: m.coveringCertificate !== null,
  }));

  // "Calibrate again": same instruments, masters, site and texts as an earlier certificate.
  let template: {
    id: string;
    number: string;
    siteId: string | null;
    customerCompanyId: string | null;
    instruments: string;
    masterIds: string[];
  } | null = null;
  if (typeof from === "string" && isUuid(from)) {
    const [cert] = await db
      .select()
      .from(certificates)
      .where(and(eq(certificates.id, from), eq(certificates.organisationId, org)));
    if (cert && cert.kind === "internal") {
      const items = await db
        .select({ code: instruments.code })
        .from(certificateItems)
        .innerJoin(instruments, eq(instruments.id, certificateItems.instrumentId))
        .where(eq(certificateItems.certificateId, cert.id))
        .orderBy(asc(certificateItems.position));
      template = {
        id: cert.id,
        number: cert.number,
        siteId: cert.siteId,
        customerCompanyId: cert.customerCompanyId,
        instruments: items.map((i) => i.code).join("\n"),
        masterIds: [],
      };
    }
  }
  // Default site: where this organisation's last calibration was done.
  const lastSiteId = (
    await db
      .select({ siteId: certificates.siteId })
      .from(certificates)
      .where(and(eq(certificates.organisationId, org), eq(certificates.kind, "internal")))
      .orderBy(desc(certificates.createdAt))
      .limit(1)
  )[0]?.siteId;
  const recent = await db
    .select({ id: certificates.id, number: certificates.number, title: certificates.title })
    .from(certificates)
    .where(and(eq(certificates.organisationId, org), eq(certificates.kind, "internal")))
    .orderBy(desc(certificates.createdAt))
    .limit(15);

  return (
    <>
      <Link
        href="/instruments/certificates"
        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Certificates
      </Link>
      <PageHeader
        title={template ? `Calibrate again: ${template.number}` : "New calibration"}
        description="The certificate number is taken from the site's series for the month, and the model's details and test points are filled in."
      />
      <NewCalibrationForm
        today={today}
        sites={siteRows.map((s) => ({ id: s.id, label: `${s.name} (${s.code})` }))}
        companies={companies.map((c) => ({ id: c.id, label: c.name }))}
        masters={masters}
        template={template}
        defaultSiteId={
          template?.siteId ??
          lastSiteId ??
          siteRows.find((s) => s.code === "BHW")?.id ??
          siteRows[0]?.id
        }
        recent={recent}
      />
    </>
  );
}
