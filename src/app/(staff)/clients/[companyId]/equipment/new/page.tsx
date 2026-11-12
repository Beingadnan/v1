import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/db/client";
import { isEquipmentType } from "@/domain/clients/equipment-types";
import { getCompany, getEquipment } from "@/domain/clients/queries";
import { getEffectiveTypeDefaults } from "@/domain/clients/type-defaults-service";
import { requirePermission } from "@/lib/auth/dal";

import { EquipmentForm } from "../equipment-form";

export const metadata = { title: "Add equipment" };

const plain = (value: string | number | null) => (value === null ? "" : String(Number(value)));

export default async function NewEquipmentPage({
  params,
  searchParams,
}: PageProps<"/clients/[companyId]/equipment/new">) {
  const actor = await requirePermission("clients.manage");
  const { companyId } = await params;
  const { from, site, dept } = await searchParams;
  // "Add similar": start from another item of this client, without its ID, serial and history.
  const source = typeof from === "string" ? await getEquipment(db, actor, from) : null;
  const copy = source && source.company.id === companyId ? source.equipment : null;
  const data = await getCompany(db, actor, companyId);
  if (!data) notFound();
  const sites = data.sites.filter((s) => s.active);
  // Equipment always sits at a site: send people to add one first.
  if (sites.length === 0) redirect(`/clients/${companyId}`);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href={`/clients/${companyId}`}
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-primary"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          {data.company.name}
        </Link>
        <PageHeader
          title={copy ? `Add equipment like ${copy.code}` : "Add equipment or a room"}
          description={
            copy
              ? `Everything is copied from ${copy.code} except the equipment ID, serial number and last study date. Change what differs.`
              : "Choose the type first: its usual limits, logger count and cycles are filled in for you. Only the ID, name, type and site are required."
          }
        />
      </div>
      <EquipmentForm
        companyId={companyId}
        companyRequalificationMonths={data.company.requalificationMonths}
        sites={sites.map((s) => ({ id: s.id, name: s.name }))}
        departments={data.departments
          .filter((d) => d.active)
          .map((d) => ({ id: d.id, name: d.name, siteId: d.siteId }))}
        startAt={
          typeof site === "string" && sites.some((s) => s.id === site)
            ? {
                siteId: site,
                departmentId:
                  typeof dept === "string" &&
                  data.departments.some((d) => d.id === dept && d.siteId === site && d.active)
                    ? dept
                    : "",
              }
            : undefined
        }
        typeDefaults={await getEffectiveTypeDefaults(db, actor.organisationId)}
        values={
          copy && isEquipmentType(copy.type)
            ? {
                id: "",
                siteId: copy.siteId,
                departmentId: copy.departmentId ?? "",
                code: "",
                name: copy.name,
                type: copy.type,
                location: copy.location,
                make: copy.make,
                model: copy.model,
                serialNo: "",
                lengthM: plain(copy.lengthM),
                widthM: plain(copy.widthM),
                heightM: plain(copy.heightM),
                setPointC: plain(copy.setPointC),
                tempMinC: plain(copy.tempMinC),
                tempMaxC: plain(copy.tempMaxC),
                rhMinPct: plain(copy.rhMinPct),
                rhMaxPct: plain(copy.rhMaxPct),
                defaultChannels: plain(copy.defaultChannels),
                readingIntervalMinutes: plain(copy.readingIntervalMinutes),
                studyDurationHours: plain(copy.studyDurationHours),
                requalificationMonths: plain(copy.requalificationMonths),
                lastStudyOn: "",
                cycles: copy.cycles,
                seasonalMapping: copy.seasonalMapping,
                notes: "",
              }
            : undefined
        }
      />
    </div>
  );
}
