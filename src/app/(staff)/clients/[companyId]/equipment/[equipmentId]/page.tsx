import { Copy } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { db } from "@/db/client";
import { can } from "@/domain/auth/permissions";
import { EQUIPMENT_TYPE_INFO, isEquipmentType } from "@/domain/clients/equipment-types";
import { getCompany, getEquipment, getEquipmentHistory } from "@/domain/clients/queries";
import { getEffectiveTypeDefaults } from "@/domain/clients/type-defaults-service";
import { requirePermission } from "@/lib/auth/dal";
import { formatDate, formatDateTime } from "@/lib/format";

import { DueBadge } from "../../../due-badge";
import { EquipmentForm, RetireEquipmentButton } from "../equipment-form";
import { finderHref, Trail } from "../../finder";

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
  const history = await getEquipmentHistory(db, actor, item.id);
  const canManage = can(actor, "clients.manage");
  if (!isEquipmentType(item.type)) throw new Error(`Unknown equipment type ${item.type}`);

  // The current site/department stay selectable even if switched off since.
  const sites = data.sites
    .filter((s) => s.active || s.id === item.siteId)
    .map((s) => ({ id: s.id, name: s.name }));
  const departments = data.departments
    .filter((d) => d.active || d.id === item.departmentId)
    .map((d) => ({ id: d.id, name: d.name, siteId: d.siteId }));

  // Where it is filed on the client page: site → department.
  const site = data.sites.find((x) => x.id === item.siteId);
  const dept = data.departments.find((x) => x.id === item.departmentId);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Trail
          parts={[
            { label: "Clients", href: "/clients" },
            { label: company.code || company.name, href: finderHref(company.id, {}) },
            ...(site
              ? [
                  {
                    label: site.name,
                    href: finderHref(company.id, { region: site.state || "none", site: site.id }),
                  },
                ]
              : []),
            ...(site && dept
              ? [
                  {
                    label: dept.name,
                    href: finderHref(company.id, {
                      region: site.state || "none",
                      site: site.id,
                      dept: dept.id,
                    }),
                  },
                ]
              : []),
            { label: item.code },
          ]}
        />
        <PageHeader
          title={`${item.code} · ${item.name}`}
          description={`${EQUIPMENT_TYPE_INFO[item.type].label} · ${
            EQUIPMENT_TYPE_INFO[item.type].study === "thermal_validation"
              ? "Thermal validation"
              : "Temperature mapping"
          }`}
          action={
            canManage ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" asChild>
                  <Link href={`/clients/${company.id}/equipment/new?from=${item.id}`}>
                    <Copy aria-hidden="true" />
                    Add similar
                  </Link>
                </Button>
                <RetireEquipmentButton
                  companyId={company.id}
                  equipmentId={item.id}
                  code={item.code}
                  active={item.active}
                />
              </div>
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
        typeDefaults={await getEffectiveTypeDefaults(db, actor.organisationId)}
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
          cycles: item.cycles,
          seasonalMapping: item.seasonalMapping,
          notes: item.notes,
        }}
      />
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">History</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
        ) : (
          <ol className="flex flex-col gap-3 border-l-2 border-border pl-4">
            {history.map((event) => (
              <li key={event.id.toString()} className="text-sm">
                <p>{event.summary}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(event.occurredAt)}
                  {event.reason ? ` · Reason: ${event.reason}` : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
