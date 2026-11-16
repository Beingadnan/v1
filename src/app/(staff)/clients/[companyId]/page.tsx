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
  DetailsList,
  ExplorerWindow,
  FolderGrid,
  FolderTile,
  placeHref,
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

  const siteDepartments = site ? tree.find((t) => t.id === site.id)!.departments : [];
  const empty = (text: string) => (
    <p className="py-10 text-center text-sm text-muted-foreground">{text}</p>
  );
  let pane: ReactNode;
  let status: string;
  let up: string | undefined;
  if (site && dept && year) {
    const shown = deptStudies.filter((s) => yearOf(s.start) === year);
    up = placeHref(company.id, { site: site.id, dept: dept.id });
    status = plural(shown.length, "report");
    pane = shown.length ? (
      <StudyFiles rows={shown} equipmentCode={equipmentCode} />
    ) : (
      empty("No studies this year.")
    );
  } else if (site && dept) {
    const deptEquipment = equipment.filter((e) => e.departmentId === dept.id);
    up = placeHref(company.id, { site: site.id });
    status = `${plural(years.length, "year folder")}, ${plural(deptEquipment.length, "equipment", "equipment")}`;
    pane =
      years.length || deptEquipment.length ? (
        <div className="flex flex-col gap-4">
          {years.length ? (
            <FolderGrid>
              {years.map((y) => (
                <FolderTile
                  key={y}
                  href={placeHref(company.id, { site: site.id, dept: dept.id, year: y })}
                  title={y}
                  facts={[
                    plural(deptStudies.filter((s) => yearOf(s.start) === y).length, "report"),
                  ]}
                />
              ))}
            </FolderGrid>
          ) : null}
          {deptEquipment.length ? (
            <DetailsList
              columns={EQUIPMENT_COLUMNS}
              rows={equipmentFiles(deptEquipment, company.id)}
            />
          ) : null}
        </div>
      ) : (
        empty("This department is empty. Add its equipment with Add equipment.")
      );
  } else if (site) {
    const loose = equipment.filter((e) => e.siteId === site.id && !e.departmentId);
    up = placeHref(company.id, {});
    status = `${plural(siteDepartments.length, "department")}${loose.length ? `, ${plural(loose.length, "equipment", "equipment")} not in a department` : ""}`;
    pane =
      siteDepartments.length || loose.length ? (
        <div className="flex flex-col gap-4">
          <FolderGrid>
            {siteDepartments.map((d) => (
              <FolderTile
                key={d.id}
                href={placeHref(company.id, { site: site.id, dept: d.id })}
                title={d.name}
                facts={[
                  plural(d.equipment, "equipment", "equipment"),
                  plural(d.years.length, "year"),
                ]}
                overdue={d.overdue}
                inactive={!d.active}
              />
            ))}
          </FolderGrid>
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
              plural(t.departments.length, "dept"),
              plural(t.equipment, "equipment", "equipment"),
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
