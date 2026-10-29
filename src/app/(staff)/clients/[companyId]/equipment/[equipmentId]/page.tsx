import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { db } from "@/db/client";
import { can } from "@/domain/auth/permissions";
import { EQUIPMENT_TYPE_INFO, isEquipmentType } from "@/domain/clients/equipment-types";
import { getCompany, getEquipment } from "@/domain/clients/queries";
import { requirePermission } from "@/lib/auth/dal";
import { formatDate } from "@/lib/format";

import { DueBadge } from "../../../due-badge";
import { EquipmentForm, RetireEquipmentButton } from "../equipment-form";

export const metadata = { title: "Equipment" };

/** numeric "-30.00" → "-30" for an editable input; null → "". */
const plain = (value: string | number | null) => (value === null ? "" : String(Number(value)));

export default async function EquipmentPage({
  params,
}: PageProps<"/clients/[companyId]/equipment/[equipmentId]">) {
  const actor = await requirePermission("clients.view");
  const { companyId, equipmentId } = await params;
  const found = await getEquipment(db, actor, equipmentId);
  if (!found || found.company.id !== companyId) notFound();
  const data = await getCompany(db, actor, companyId);
  if (!data) notFound();
  const { equipment: item, company, nextDue } = found;
  const canManage = can(actor, "clients.manage");
  if (!isEquipmentType(item.type)) throw new Error(`Unknown equipment type ${item.type}`);

  // The current site/department stay selectable even if switched off since.
  const sites = data.sites
    .filter((s) => s.active || s.id === item.siteId)
    .map((s) => ({ id: s.id, name: s.name }));
  const departments = data.departments
    .filter((d) => d.active || d.id === item.departmentId)
    .map((d) => ({ id: d.id, name: d.name, siteId: d.siteId }));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href={`/clients/${company.id}`}
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-primary"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          {company.name}
        </Link>
        <PageHeader
          title={`${item.code} · ${item.name}`}
          description={`${EQUIPMENT_TYPE_INFO[item.type].label} · ${
            EQUIPMENT_TYPE_INFO[item.type].study === "thermal_validation"
              ? "Thermal validation"
              : "Temperature mapping"
          }`}
          action={
            canManage ? (
              <RetireEquipmentButton
                companyId={company.id}
                equipmentId={item.id}
                code={item.code}
                active={item.active}
              />
            ) : undefined
          }
        />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          {item.active ? null : <StatusBadge tone="neutral">Retired</StatusBadge>}
          <span>
            <span className="text-muted-foreground">Last study: </span>
            {formatDate(item.lastStudyOn)}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Next due: </span>
            {item.active ? <DueBadge nextDue={nextDue} /> : "—"}
          </span>
        </div>
      </div>
      <EquipmentForm
        companyId={company.id}
        companyRequalificationMonths={company.requalificationMonths}
        sites={sites}
        departments={departments}
        readOnly={!canManage}
        values={{
          id: item.id,
          siteId: item.siteId,
          departmentId: item.departmentId ?? "",
          code: item.code,
          name: item.name,
          type: item.type,
          location: item.location,
          make: item.make,
          model: item.model,
          serialNo: item.serialNo,
          lengthM: plain(item.lengthM),
          widthM: plain(item.widthM),
          heightM: plain(item.heightM),
          setPointC: plain(item.setPointC),
          tempMinC: plain(item.tempMinC),
          tempMaxC: plain(item.tempMaxC),
          rhMinPct: plain(item.rhMinPct),
          rhMaxPct: plain(item.rhMaxPct),
          defaultChannels: plain(item.defaultChannels),
          readingIntervalMinutes: plain(item.readingIntervalMinutes),
          studyDurationHours: plain(item.studyDurationHours),
          requalificationMonths: plain(item.requalificationMonths),
          lastStudyOn: item.lastStudyOn ?? "",
          notes: item.notes,
        }}
      />
    </div>
  );
}
