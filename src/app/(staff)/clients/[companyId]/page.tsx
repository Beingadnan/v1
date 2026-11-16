import { Download, Plus, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/db/client";
import { can } from "@/domain/auth/permissions";
import { isRole, ROLE_LABELS } from "@/domain/auth/roles";
import { EQUIPMENT_TYPE_INFO, isEquipmentType } from "@/domain/clients/equipment-types";
import { companyArchive, companyStudies, getCompany } from "@/domain/clients/queries";
import { listContracts } from "@/domain/jobs/contract-service";
import { formatInr } from "@/domain/jobs/pricing";
import { ORDER_TYPE_SHORT } from "@/domain/jobs/types";
import { dueStatus, todayInIndia } from "@/domain/clients/requalification";
import { requirePermission } from "@/lib/auth/dal";
import { formatDate, formatDateTime, formatLimits } from "@/lib/format";

import {
  ContactDialog,
  DepartmentDialog,
  EditCompanyButton,
  InviteClientUserButton,
  SIGNATORY_LABELS,
  SiteDialog,
} from "../client-dialogs";
import { DueBadge } from "../due-badge";

import {
  ClientTree,
  DetailsList,
  ExplorerWindow,
  FolderGrid,
  FolderTile,
  MONTH_NAMES,
  placeHref,
  ReportFiles,
  StudyFiles,
  type Place,
  type TreeSite,
} from "./client-explorer";
import { ContractButton } from "./contract-dialog";

export const metadata: Metadata = { title: "Client" };

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm font-semibold">{children}</div>
    </div>
  );
}

type EquipmentRow =
  Awaited<ReturnType<typeof getCompany>> extends infer T
    ? T extends { equipment: (infer E)[] }
      ? E
      : never
    : never;

/** Equipment as files in a folder: code and name, type, limits, last study, next due. */
function equipmentFiles(rows: EquipmentRow[], companyId: string) {
  return rows.map((item) => ({
    key: item.id,
    icon: "equipment" as const,
    muted: !item.active,
    name: (
      <span>
        <Link
          href={`/clients/${companyId}/equipment/${item.id}`}
          className="font-medium text-primary hover:underline"
        >
          {item.code}
        </Link>
        <span className="block text-xs text-muted-foreground">{item.name}</span>
      </span>
    ),
    cells: [
      isEquipmentType(item.type) ? EQUIPMENT_TYPE_INFO[item.type].label : item.type,
      <span key="l" className="tabular whitespace-nowrap">
        {formatLimits(item.tempMinC, item.tempMaxC, "°C")}
        {item.rhMinPct || item.rhMaxPct ? (
          <span className="block text-xs text-muted-foreground">
            {formatLimits(item.rhMinPct, item.rhMaxPct, "%RH")}
          </span>
        ) : null}
      </span>,
      <span key="s" className="tabular whitespace-nowrap">
        {formatDate(item.lastStudyOn)}
      </span>,
      item.active ? (
        <DueBadge key="d" nextDue={item.nextDue} />
      ) : (
        <StatusBadge key="d" tone="neutral">
          Retired
        </StatusBadge>
      ),
    ],
  }));
}
const EQUIPMENT_COLUMNS = ["Equipment", "Type", "Limits", "Last study", "Next due"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default async function ClientPage({
  params,
  searchParams,
}: PageProps<"/clients/[companyId]">) {
  const actor = await requirePermission("clients.view");
  const { companyId } = await params;
  const sp = await searchParams;
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  // The contracts check the organisation themselves: read them alongside the client.
  const [data, contracts, studyRows, signed] = await Promise.all([
    getCompany(db, actor, companyId),
    can(actor, "jobs.view") ? listContracts(db, actor, companyId) : Promise.resolve(null),
    companyStudies(db, actor, companyId),
    companyArchive(db, actor, companyId),
  ]);
  if (!data) notFound();
  const { company, sites, departments, contacts, equipment, clientUsers } = data;
  const canManage = can(actor, "clients.manage");
  const canSeeUsers = can(actor, "users.view");
  const canInvite = can(actor, "users.manage");
  // ARCs and AMCs: anyone who sees jobs sees them; managers and accounts keep them.
  const canKeepContracts = can(actor, "jobs.manage") || can(actor, "billing.record");
  const canSeeMoney = can(actor, "jobs.money");

  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  const equipmentCode = new Map(equipment.map((e) => [e.id, e.code]));
  const today = todayInIndia();
  const isOverdue = (e: EquipmentRow) => e.active && dueStatus(e.nextDue, today) === "overdue";
  const activeEquipment = equipment.filter((e) => e.active);
  const overdue = activeEquipment.filter(isOverdue).length;
  const nextDue = activeEquipment
    .map((e) => e.nextDue)
    .filter((d): d is string => Boolean(d))
    .sort()[0];
  const siteOptions = sites.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name }));

  // Where we are (ADR 0023), each part checked against this client.
  const site = sites.find((s) => s.id === pick("site"));
  const dept = site
    ? departments.find((d) => d.id === pick("dept") && d.siteId === site.id)
    : undefined;
  // Studies not signed yet (a cancelled job's studies are left out).
  const signedIds = new Set(signed.map((r) => r.studyId));
  const inProgress = studyRows.filter((s) => !signedIds.has(s.id) && s.jobStatus !== "cancelled");
  const siteOf = new Map(equipment.map((e) => [e.id, e.siteId]));
  const siteSigned = site ? signed.filter((r) => r.siteId === site.id) : [];
  const siteYears = [...new Set(siteSigned.map((r) => r.year))];
  const year = site && siteYears.includes(pick("year") ?? "") ? pick("year") : undefined;
  const yearSigned = siteSigned.filter((r) => r.year === year);
  const month =
    year && yearSigned.some((r) => r.month === pick("month")) ? pick("month") : undefined;
  const monthSigned = yearSigned.filter((r) => r.month === month);
  const deptKey = (r: { departmentId: string | null }) => r.departmentId ?? "none";
  const adept =
    month && monthSigned.some((r) => deptKey(r) === pick("adept")) ? pick("adept") : undefined;
  const adeptSigned = monthSigned.filter((r) => deptKey(r) === adept);
  const eqId =
    adept && adeptSigned.some((r) => r.equipmentId === pick("eq")) ? pick("eq") : undefined;
  const open = !!site && !year && !dept && pick("open") === "1";
  // The equipment list: view=equipment, or any department picked.
  const register = !!site && !year && !open && (!!dept || pick("view") === "equipment");
  const place: Place = {
    site: site?.id,
    dept: dept?.id,
    year,
    month,
    adept,
    eq: eqId,
    open,
    equipment: register,
  };
  const deptName = (id: string) =>
    id === "none" ? "No department" : (departments.find((d) => d.id === id)?.name ?? "—");
  const equipmentById = new Map(equipment.map((e) => [e.id, e]));

  const tree: TreeSite[] = sites.map((s) => {
    const here = equipment.filter((e) => e.siteId === s.id && e.active);
    const mine = signed.filter((r) => r.siteId === s.id);
    return {
      id: s.id,
      name: s.name,
      active: s.active,
      equipment: here.length,
      overdue: here.filter(isOverdue).length,
      departments: departments
        .filter((d) => d.siteId === s.id)
        .map((d) => {
          const inDept = here.filter((e) => e.departmentId === d.id);
          return {
            id: d.id,
            name: d.name,
            active: d.active,
            equipment: inDept.length,
            overdue: inDept.filter(isOverdue).length,
          };
        }),
      years: [...new Set(mine.map((r) => r.year))].map((y) => ({
        year: y,
        months: [...new Set(mine.filter((r) => r.year === y).map((r) => r.month))],
      })),
      open: inProgress.filter((x) => siteOf.get(x.equipmentId) === s.id).length,
    };
  });

  const at = (p: Place, last: boolean) => (last ? undefined : placeHref(company.id, p));
  const trail = [
    { label: "Clients", href: "/clients" },
    { label: company.code || company.name, href: at({}, !site) },
    ...(site
      ? [{ label: site.name, href: at({ site: site.id }, !register && !year && !open) }]
      : []),
    ...(register
      ? [{ label: "Equipment", href: at({ site: site!.id, equipment: true }, !dept) }]
      : []),
    ...(register && dept ? [{ label: dept.name }] : []),
    ...(site && open ? [{ label: "In progress" }] : []),
    ...(site && year ? [{ label: year, href: at({ site: site.id, year }, !month) }] : []),
    ...(year && month
      ? [
          {
            label: MONTH_NAMES[Number(month) - 1]!,
            href: at({ site: site!.id, year, month }, !adept),
          },
        ]
      : []),
    ...(month && adept
      ? [{ label: deptName(adept), href: at({ site: site!.id, year, month, adept }, !eqId) }]
      : []),
    ...(eqId ? [{ label: equipmentById.get(eqId)?.code ?? "—" }] : []),
  ];
  const addEquipment =
    canManage && siteOptions.length > 0 ? (
      <Button asChild>
        <Link
          href={`/clients/${company.id}/equipment/new${
            site ? `?site=${site.id}${dept ? `&dept=${dept.id}` : ""}` : ""
          }`}
        >
          <Plus aria-hidden="true" />
          Add equipment
        </Link>
      </Button>
    ) : null;

  const header = dept ? (
    <PageHeader
      title={dept.name}
      description={`Department at ${site!.name}, ${company.name}`}
      action={
        canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <DepartmentDialog
              companyId={company.id}
              siteId={site!.id}
              siteName={site!.name}
              department={{ id: dept.id, name: dept.name, active: dept.active }}
            />
            {addEquipment}
          </div>
        ) : undefined
      }
    />
  ) : site ? (
    <PageHeader
      title={site.name}
      description={[`${company.name} site`, site.code !== site.name ? `code ${site.code}` : ""]
        .filter(Boolean)
        .join(" · ")}
      action={
        canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <SiteDialog
              companyId={company.id}
              site={{
                id: site.id,
                name: site.name,
                code: site.code,
                address: site.address,
                city: site.city,
                state: site.state,
                gstin: site.gstin,
                active: site.active,
              }}
            />
            {site.active ? (
              <DepartmentDialog companyId={company.id} siteId={site.id} siteName={site.name} />
            ) : null}
            {addEquipment}
          </div>
        ) : undefined
      }
    />
  ) : (
    <PageHeader
      title={company.name}
      description={[company.code, company.gstin && `GSTIN ${company.gstin}`, company.address]
        .filter(Boolean)
        .join(" · ")}
      action={
        <div className="flex flex-wrap gap-2">
          {equipment.length > 0 ? (
            <Button variant="secondary" asChild>
              <a href={`/clients/${company.id}/export`} download>
                <Download aria-hidden="true" />
                Download Excel
              </a>
            </Button>
          ) : null}
          {canManage ? (
            <>
              <SiteDialog companyId={company.id} />
              <EditCompanyButton
                values={{
                  id: company.id,
                  name: company.name,
                  code: company.code,
                  gstin: company.gstin,
                  address: company.address,
                  notes: company.notes,
                  postCalRequired: company.postCalRequired,
                  requalificationMonths: company.requalificationMonths,
                  paymentTermsDays: company.paymentTermsDays,
                  reportNumberFormat: company.reportNumberFormat,
                  active: company.active,
                }}
              />
              {addEquipment}
            </>
          ) : null}
        </div>
      }
    />
  );

  const siteTree = site ? tree.find((t) => t.id === site.id)! : null;
  const empty = (text: string) => (
    <p className="py-10 text-center text-sm text-muted-foreground">{text}</p>
  );
  let pane: ReactNode;
  let status: string;
  let up: string | undefined;
  if (site && eqId) {
    const files = adeptSigned.filter((r) => r.equipmentId === eqId);
    up = placeHref(company.id, { site: site.id, year, month, adept });
    status = plural(files.length, "signed report");
    pane = <ReportFiles rows={files} />;
  } else if (site && adept) {
    const items = [...new Set(adeptSigned.map((r) => r.equipmentId))];
    up = placeHref(company.id, { site: site.id, year, month });
    status = plural(items.length, "equipment folder");
    pane = (
      <FolderGrid>
        {items.map((id) => (
          <FolderTile
            key={id}
            href={placeHref(company.id, { site: site.id, year, month, adept, eq: id })}
            title={equipmentById.get(id)?.code ?? "—"}
            facts={[
              equipmentById.get(id)?.name ?? "",
              plural(adeptSigned.filter((r) => r.equipmentId === id).length, "report"),
            ]}
          />
        ))}
      </FolderGrid>
    );
  } else if (site && month) {
    const keys = [...new Set(monthSigned.map(deptKey))];
    up = placeHref(company.id, { site: site.id, year });
    status = plural(keys.length, "department folder");
    pane = (
      <FolderGrid>
        {keys.map((k) => (
          <FolderTile
            key={k}
            href={placeHref(company.id, { site: site.id, year, month, adept: k })}
            title={deptName(k)}
            facts={[plural(monthSigned.filter((r) => deptKey(r) === k).length, "report")]}
          />
        ))}
      </FolderGrid>
    );
  } else if (site && year) {
    const months = [...new Set(yearSigned.map((r) => r.month))];
    up = placeHref(company.id, { site: site.id });
    status = plural(months.length, "month folder");
    pane = (
      <FolderGrid>
        {months.map((m) => (
          <FolderTile
            key={m}
            href={placeHref(company.id, { site: site.id, year, month: m })}
            title={MONTH_NAMES[Number(m) - 1]!}
            facts={[plural(yearSigned.filter((r) => r.month === m).length, "report")]}
          />
        ))}
      </FolderGrid>
    );
  } else if (site && open) {
    const rows = inProgress.filter((x) => siteOf.get(x.equipmentId) === site.id);
    up = placeHref(company.id, { site: site.id });
    status = `${plural(rows.length, "study", "studies")} not signed yet`;
    pane = rows.length ? (
      <StudyFiles rows={rows} equipmentCode={equipmentCode} />
    ) : (
      empty("Nothing in progress.")
    );
  } else if (site && dept) {
    const deptEquipment = equipment.filter((e) => e.departmentId === dept.id);
    up = placeHref(company.id, { site: site.id, equipment: true });
    status = plural(deptEquipment.length, "equipment", "equipment");
    pane = deptEquipment.length ? (
      <DetailsList columns={EQUIPMENT_COLUMNS} rows={equipmentFiles(deptEquipment, company.id)} />
    ) : (
      empty("This department is empty. Add its equipment with Add equipment.")
    );
  } else if (site && siteTree && register) {
    const loose = equipment.filter((e) => e.siteId === site.id && !e.departmentId);
    up = placeHref(company.id, { site: site.id });
    status = `${plural(siteTree.equipment, "equipment", "equipment")} in ${plural(siteTree.departments.length, "department")}`;
    pane =
      siteTree.departments.length || loose.length ? (
        <div className="flex flex-col gap-4">
          {siteTree.departments.length ? (
            <FolderGrid>
              {siteTree.departments.map((d) => (
                <FolderTile
                  key={d.id}
                  kind="equipment"
                  href={placeHref(company.id, { site: site.id, dept: d.id })}
                  title={d.name}
                  facts={[plural(d.equipment, "equipment", "equipment")]}
                  overdue={d.overdue}
                  inactive={!d.active}
                />
              ))}
            </FolderGrid>
          ) : null}
          {loose.length ? (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">
                Not in a department (edit each to put it in one):
              </p>
              <DetailsList columns={EQUIPMENT_COLUMNS} rows={equipmentFiles(loose, company.id)} />
            </div>
          ) : null}
        </div>
      ) : (
        empty("No departments yet. Add Stores, QC, Production… with Add department.")
      );
  } else if (site && siteTree) {
    up = placeHref(company.id, {});
    status = `${plural(siteYears.length, "year")} of signed reports`;
    pane = (
      <FolderGrid>
        {siteYears.map((y) => (
          <FolderTile
            key={y}
            href={placeHref(company.id, { site: site.id, year: y })}
            title={y}
            facts={[plural(siteSigned.filter((r) => r.year === y).length, "signed report")]}
          />
        ))}
        <FolderTile
          kind="equipment"
          href={placeHref(company.id, { site: site.id, equipment: true })}
          title="Equipment"
          facts={[
            plural(siteTree.equipment, "equipment", "equipment"),
            plural(siteTree.departments.length, "department"),
          ]}
          overdue={siteTree.overdue}
        />
        {siteTree.open ? (
          <FolderTile
            kind="progress"
            href={placeHref(company.id, { site: site.id, open: true })}
            title="In progress"
            facts={[`${plural(siteTree.open, "study", "studies")} not signed yet`]}
          />
        ) : null}
      </FolderGrid>
    );
    if (!siteYears.length) {
      pane = (
        <div className="flex flex-col gap-3">
          {pane}
          <p className="text-sm text-muted-foreground">
            No signed reports yet: a study&apos;s report lands in a year folder here when the client
            signs it.
          </p>
        </div>
      );
    }
  } else {
    status = plural(sites.length, "site");
    pane = sites.length ? (
      <FolderGrid>
        {tree.map((t) => (
          <FolderTile
            key={t.id}
            href={placeHref(company.id, { site: t.id })}
            title={t.name}
            facts={[
              plural(t.equipment, "equipment", "equipment"),
              plural(signed.filter((r) => r.siteId === t.id).length, "signed report"),
            ]}
            overdue={t.overdue}
            inactive={!t.active}
          />
        ))}
      </FolderGrid>
    ) : (
      empty("No sites yet. Add the client's locations, e.g. Seawoods or Ambernath, with Add site.")
    );
  }

  const about: ReactNode = site ? (
    !dept ? (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Address">
          <span className="font-normal">
            {[site.address, site.city, site.state].filter(Boolean).join(", ") || "Not recorded"}
          </span>
        </Fact>
        <Fact label="Report code">{site.code}</Fact>
        <Fact label="Equipment in use">
          <span className="tabular">
            {equipment.filter((e) => e.siteId === site.id && e.active).length}
          </span>
        </Fact>
        <Fact label="GSTIN">{site.gstin || company.gstin || "—"}</Fact>
      </div>
    ) : null
  ) : (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Equipment in use">
          <span className="tabular">{activeEquipment.length}</span>
          {overdue > 0 ? (
            <StatusBadge tone="fail" className="ml-2">
              {overdue} overdue
            </StatusBadge>
          ) : null}
        </Fact>
        <Fact label="Next study due">
          <DueBadge nextDue={nextDue ?? null} />
        </Fact>
        <Fact label="Studies done">
          <span className="tabular">{studyRows.length}</span>
        </Fact>
        <Fact label="Requalification">Every {company.requalificationMonths} months</Fact>
        <Fact label="Payment terms">{company.paymentTermsDays} days</Fact>
        <Fact label="Post-calibration (mapping)">
          {company.postCalRequired ? "Required by client SOP" : "Not required by SOP"}
        </Fact>
      </div>
      {contracts ? (
        <Section
          title="Contracts (ARC and AMC)"
          description="Annual contracts jobs are done under, instead of a PO per job."
          action={
            canKeepContracts ? (
              <ContractButton companyId={company.id} canSeeMoney={canSeeMoney} />
            ) : undefined
          }
        >
          {contracts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No ARC or AMC. Jobs for this client need a PO or SRF each.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contract</TableHead>
                  <TableHead>Valid</TableHead>
                  {canSeeMoney ? <TableHead className="text-right">Value</TableHead> : null}
                  <TableHead className="text-right">Jobs</TableHead>
                  <TableHead>Copy</TableHead>
                  {canKeepContracts ? <TableHead className="sr-only">Edit</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.map((c) => {
                  const current = c.validFrom <= today && c.validTo >= today;
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <span className="font-medium">
                          {ORDER_TYPE_SHORT[c.kind]} {c.number}
                        </span>
                        {c.notes ? (
                          <span className="block text-xs text-muted-foreground">{c.notes}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(c.validFrom)} – {formatDate(c.validTo)}{" "}
                        <StatusBadge
                          tone={current ? "pass" : c.validTo < today ? "neutral" : "info"}
                        >
                          {current ? "Current" : c.validTo < today ? "Ended" : "Not started"}
                        </StatusBadge>
                      </TableCell>
                      {canSeeMoney ? (
                        <TableCell className="text-right">
                          {c.value ? formatInr(Number(c.value)) : "—"}
                        </TableCell>
                      ) : null}
                      <TableCell className="text-right">{c.jobs}</TableCell>
                      <TableCell>
                        {c.fileId ? (
                          <a
                            href={`/clients/${company.id}/contracts/${c.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary underline"
                          >
                            Open
                          </a>
                        ) : (
                          <span className="text-muted-foreground">None</span>
                        )}
                      </TableCell>
                      {canKeepContracts ? (
                        <TableCell className="text-right">
                          <ContractButton
                            companyId={company.id}
                            canSeeMoney={canSeeMoney}
                            contract={{
                              id: c.id,
                              kind: c.kind,
                              number: c.number,
                              validFrom: c.validFrom,
                              validTo: c.validTo,
                              value: c.value ?? "",
                              notes: c.notes,
                              hasFile: !!c.fileId,
                            }}
                          />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Section>
      ) : null}

      <Section
        title="Contacts and report signatories"
        description="Signatories' names print in the report's signature block."
        action={
          canManage ? <ContactDialog companyId={company.id} sites={siteOptions} /> : undefined
        }
      >
        {contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No contacts yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Signs reports</TableHead>
                {canManage ? <TableHead className="w-20" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((c) => (
                <TableRow key={c.id} className={c.active ? undefined : "text-muted-foreground"}>
                  <TableCell>
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.designation}
                      {c.active ? "" : " · inactive"}
                    </p>
                  </TableCell>
                  <TableCell className="text-sm">
                    {[c.email, c.phone].filter(Boolean).join(" · ") || "—"}
                  </TableCell>
                  <TableCell>{c.siteId ? siteName.get(c.siteId) : "All sites"}</TableCell>
                  <TableCell>
                    {c.signatory ? (
                      <StatusBadge tone="info">{SIGNATORY_LABELS[c.signatory]}</StatusBadge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <ContactDialog
                        companyId={company.id}
                        sites={siteOptions}
                        contact={{
                          id: c.id,
                          siteId: c.siteId,
                          name: c.name,
                          designation: c.designation,
                          email: c.email,
                          phone: c.phone,
                          signatory: c.signatory,
                          active: c.active,
                        }}
                      />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      {canSeeUsers ? (
        <Section
          title="Client users"
          description={`People at ${company.code} who sign in to QTech. They only see this client's reports.`}
          action={
            canInvite && company.active ? (
              <InviteClientUserButton companyId={company.id} companyName={company.code} />
            ) : undefined
          }
        >
          {clientUsers.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No client users yet"
              description="Invite the client's QA people so they can review and sign reports in the app."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last sign-in</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clientUsers.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <p className="font-medium">{u.name}</p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </TableCell>
                    <TableCell>{isRole(u.role) ? ROLE_LABELS[u.role] : u.role}</TableCell>
                    <TableCell>
                      {u.status === "active" ? (
                        <StatusBadge tone="pass">Active</StatusBadge>
                      ) : u.status === "invited" ? (
                        <StatusBadge tone="info">Invited</StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">Deactivated</StatusBadge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(u.lastLoginAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {canInvite ? (
            <p className="text-xs text-muted-foreground">
              Deactivate client users or send them a new password link from{" "}
              <Link href="/users" className="text-primary hover:underline">
                Users
              </Link>
              .
            </p>
          ) : null}
        </Section>
      ) : null}
    </>
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      {header}
      {company.active ? null : (
        <StatusBadge tone="neutral" className="w-fit">
          Inactive client
        </StatusBadge>
      )}
      <ExplorerWindow
        up={up}
        trail={trail}
        status={status}
        tree={
          <ClientTree
            companyId={company.id}
            companyName={company.name}
            sites={tree}
            place={place}
          />
        }
      >
        {pane}
      </ExplorerWindow>
      {about ? <div className="flex flex-col gap-8">{about}</div> : null}
    </div>
  );
}
