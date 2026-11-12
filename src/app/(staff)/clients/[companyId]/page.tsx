import { Download, Folder, MapPin, Plus, Refrigerator, Users } from "lucide-react";
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
import { companyStudies, getCompany } from "@/domain/clients/queries";
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
  FolderCard,
  placeHref,
  StudyTable,
  Trail,
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

function EquipmentTable({
  rows,
  companyId,
  siteName,
  departmentName,
}: {
  rows: EquipmentRow[];
  companyId: string;
  siteName: Map<string, string>;
  departmentName: Map<string, string>;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Equipment</TableHead>
          <TableHead>Where</TableHead>
          <TableHead>Limits</TableHead>
          <TableHead className="text-right">Loggers</TableHead>
          <TableHead>Last study</TableHead>
          <TableHead>Next due</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((item) => (
          <TableRow key={item.id} className={item.active ? undefined : "text-muted-foreground"}>
            <TableCell>
              <Link
                href={`/clients/${companyId}/equipment/${item.id}`}
                className="font-medium text-primary hover:underline"
              >
                {item.code}
              </Link>
              <p className="text-xs text-muted-foreground">
                {item.name}
                {isEquipmentType(item.type) ? ` · ${EQUIPMENT_TYPE_INFO[item.type].label}` : ""}
              </p>
            </TableCell>
            <TableCell>
              {siteName.get(item.siteId) ?? "—"}
              {item.departmentId ? (
                <p className="text-xs text-muted-foreground">
                  {departmentName.get(item.departmentId)}
                </p>
              ) : null}
            </TableCell>
            <TableCell className="tabular whitespace-nowrap">
              {formatLimits(item.tempMinC, item.tempMaxC, "°C")}
              {item.rhMinPct || item.rhMaxPct ? (
                <p className="text-xs text-muted-foreground">
                  {formatLimits(item.rhMinPct, item.rhMaxPct, "%RH")}
                </p>
              ) : null}
            </TableCell>
            <TableCell className="tabular text-right">{item.defaultChannels ?? "—"}</TableCell>
            <TableCell className="tabular whitespace-nowrap">
              {formatDate(item.lastStudyOn)}
            </TableCell>
            <TableCell>
              {item.active ? (
                <DueBadge nextDue={item.nextDue} />
              ) : (
                <StatusBadge tone="neutral">Retired</StatusBadge>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const yearOf = (iso: string) => iso.slice(0, 4);

export default async function ClientPage({
  params,
  searchParams,
}: PageProps<"/clients/[companyId]">) {
  const actor = await requirePermission("clients.view");
  const { companyId } = await params;
  const sp = await searchParams;
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  // The contracts check the organisation themselves: read them alongside the client.
  const [data, contracts, studyRows] = await Promise.all([
    getCompany(db, actor, companyId),
    can(actor, "jobs.view") ? listContracts(db, actor, companyId) : Promise.resolve(null),
    companyStudies(db, actor, companyId),
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
  const departmentName = new Map(departments.map((d) => [d.id, d.name]));
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

  // Where we are: ?site=…&dept=…&year=…, each checked against this client.
  const site = sites.find((s) => s.id === pick("site"));
  const dept = site
    ? departments.find((d) => d.id === pick("dept") && d.siteId === site.id)
    : undefined;
  const departmentOf = new Map(equipment.map((e) => [e.id, e.departmentId]));
  const deptStudies = dept
    ? studyRows.filter((s) => departmentOf.get(s.equipmentId) === dept.id)
    : [];
  const years = [...new Set(deptStudies.map((s) => yearOf(s.start)))];
  const year = dept && years.includes(pick("year") ?? "") ? pick("year") : undefined;
  const place: Place = { site: site?.id, dept: dept?.id, year };

  const tree: TreeSite[] = sites.map((s) => {
    const here = equipment.filter((e) => e.siteId === s.id && e.active);
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
          const ids = new Set(equipment.filter((e) => e.departmentId === d.id).map((e) => e.id));
          return {
            id: d.id,
            name: d.name,
            active: d.active,
            equipment: inDept.length,
            overdue: inDept.filter(isOverdue).length,
            years: [
              ...new Set(
                studyRows.filter((x) => ids.has(x.equipmentId)).map((x) => yearOf(x.start)),
              ),
            ],
          };
        }),
    };
  });

  const trail = [
    { label: "Clients", href: "/clients" },
    { label: company.code || company.name, href: site ? placeHref(company.id, {}) : undefined },
    ...(site
      ? [{ label: site.name, href: dept ? placeHref(company.id, { site: site.id }) : undefined }]
      : []),
    ...(site && dept
      ? [
          {
            label: dept.name,
            href: year ? placeHref(company.id, { site: site.id, dept: dept.id }) : undefined,
          },
        ]
      : []),
    ...(year ? [{ label: year }] : []),
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
      title={year ? `${dept.name} · ${year}` : dept.name}
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
        canManage ? (
          <div className="flex flex-wrap gap-2">
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
          </div>
        ) : undefined
      }
    />
  );

  const byYear = (rows: typeof studyRows) => {
    const groups = new Map<string, typeof studyRows>();
    for (const r of rows) groups.set(yearOf(r.start), [...(groups.get(yearOf(r.start)) ?? []), r]);
    return [...groups];
  };

  let content: ReactNode;
  if (site && dept) {
    const deptEquipment = equipment.filter((e) => e.departmentId === dept.id);
    const shown = year ? deptStudies.filter((s) => yearOf(s.start) === year) : deptStudies;
    content = (
      <>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Year">
          <span className="text-sm text-muted-foreground">Year:</span>
          {[undefined, ...years].map((y) => (
            <Link
              key={y ?? "all"}
              href={placeHref(company.id, { site: site.id, dept: dept.id, year: y })}
              aria-current={year === y ? "page" : undefined}
              className={
                year === y
                  ? "rounded-full bg-primary px-3 py-1 text-sm font-medium text-primary-foreground"
                  : "rounded-full border border-border px-3 py-1 text-sm hover:border-primary"
              }
            >
              {y ?? "All years"}
            </Link>
          ))}
        </div>
        <Section
          title={year ? `Studies in ${year}` : "Studies"}
          description="Every mapping and validation done here, newest first, with its report."
        >
          {shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No studies yet for this department&apos;s equipment.
            </p>
          ) : year ? (
            <StudyTable rows={shown} equipmentCode={equipmentCode} />
          ) : (
            byYear(shown).map(([y, rows]) => (
              <div key={y} className="flex flex-col gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Link
                    href={placeHref(company.id, { site: site.id, dept: dept.id, year: y })}
                    className="hover:text-primary"
                  >
                    {y}
                  </Link>
                  <span className="font-normal text-muted-foreground">
                    {rows.length} {rows.length === 1 ? "study" : "studies"}
                  </span>
                </h3>
                <StudyTable rows={rows} equipmentCode={equipmentCode} />
              </div>
            ))
          )}
        </Section>
        <Section title="Equipment" description="What QA Tech maps or validates in this department.">
          {deptEquipment.length === 0 ? (
            <p className="text-sm text-muted-foreground">No equipment in this department yet.</p>
          ) : (
            <EquipmentTable
              rows={deptEquipment}
              companyId={company.id}
              siteName={siteName}
              departmentName={departmentName}
            />
          )}
        </Section>
      </>
    );
  } else if (site) {
    const siteDepartments = tree.find((t) => t.id === site.id)!.departments;
    const loose = equipment.filter((e) => e.siteId === site.id && !e.departmentId);
    content = (
      <>
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
        <Section
          title="Departments"
          description="Open a department to see its equipment and its studies year by year."
          action={
            canManage && site.active ? (
              <DepartmentDialog companyId={company.id} siteId={site.id} siteName={site.name} />
            ) : undefined
          }
        >
          {siteDepartments.length === 0 ? (
            <EmptyState
              icon={Folder}
              title="No departments yet"
              description="Add the client's departments here, e.g. Stores, QC or Production."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {siteDepartments.map((d) => (
                <FolderCard
                  key={d.id}
                  href={placeHref(company.id, { site: site.id, dept: d.id })}
                  icon={Folder}
                  title={d.name}
                  facts={[
                    `${d.equipment} equipment`,
                    d.years.length ? `studies ${d.years.at(-1)}–${d.years[0]}` : "no studies yet",
                  ]}
                  overdue={d.overdue}
                  inactive={!d.active}
                />
              ))}
            </div>
          )}
        </Section>
        {loose.length > 0 ? (
          <Section
            title="Equipment not in a department"
            description="Edit each one to put it in a department."
          >
            <EquipmentTable
              rows={loose}
              companyId={company.id}
              siteName={siteName}
              departmentName={departmentName}
            />
          </Section>
        ) : null}
      </>
    );
  } else {
    content = (
      <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          <Fact label="Requalification">Every {company.requalificationMonths} months</Fact>
          <Fact label="Payment terms">{company.paymentTermsDays} days</Fact>
          <Fact label="Post-calibration (mapping)">
            {company.postCalRequired ? "Required by client SOP" : "Not required by SOP"}
          </Fact>
          <Fact label="Studies done">
            <span className="tabular">{studyRows.length}</span>
          </Fact>
        </div>
        <Section
          title="Sites"
          description="Each site (region) holds its departments; report numbers use the site code."
          action={
            <div className="flex flex-wrap gap-2">
              {equipment.length > 0 ? (
                <Button variant="secondary" size="sm" asChild>
                  <a href={`/clients/${company.id}/export`} download>
                    <Download aria-hidden="true" />
                    Download Excel
                  </a>
                </Button>
              ) : null}
              {canManage ? <SiteDialog companyId={company.id} /> : null}
            </div>
          }
        >
          {sites.length === 0 ? (
            <EmptyState
              icon={MapPin}
              title="No sites yet"
              description="Add the client's locations, e.g. Seawoods or Ambernath."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {tree.map((t) => {
                const s = sites.find((x) => x.id === t.id)!;
                return (
                  <FolderCard
                    key={t.id}
                    href={placeHref(company.id, { site: t.id })}
                    icon={MapPin}
                    title={t.name}
                    subtitle={[s.city, s.state].filter(Boolean).join(", ") || undefined}
                    facts={[
                      `${t.departments.length} ${t.departments.length === 1 ? "department" : "departments"}`,
                      `${t.equipment} equipment`,
                    ]}
                    overdue={t.overdue}
                    inactive={!t.active}
                  />
                );
              })}
            </div>
          )}
          {equipment.length === 0 && siteOptions.length > 0 ? (
            <EmptyState
              icon={Refrigerator}
              title="No equipment yet"
              description="Add the freezers, cold rooms, warehouses or autoclaves this client has."
              action={addEquipment ?? undefined}
            />
          ) : null}
        </Section>

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
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <Trail parts={trail} />
      {header}
      {company.active ? null : (
        <StatusBadge tone="neutral" className="w-fit">
          Inactive client
        </StatusBadge>
      )}
      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="rounded-lg border border-border bg-surface p-2 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
          <ClientTree
            companyId={company.id}
            companyName={company.name}
            sites={tree}
            place={place}
          />
        </aside>
        <div className="flex min-w-0 flex-col gap-8">{content}</div>
      </div>
    </div>
  );
}
