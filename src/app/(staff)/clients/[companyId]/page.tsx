import { ChevronLeft, Download, MapPin, Plus, Refrigerator, Users } from "lucide-react";
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
import { getCompany } from "@/domain/clients/queries";
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

export default async function ClientPage({ params }: PageProps<"/clients/[companyId]">) {
  const actor = await requirePermission("clients.view");
  const { companyId } = await params;
  // The contracts check the organisation themselves: read them alongside the client.
  const [data, contracts] = await Promise.all([
    getCompany(db, actor, companyId),
    can(actor, "jobs.view") ? listContracts(db, actor, companyId) : Promise.resolve(null),
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
  const activeEquipment = equipment.filter((e) => e.active);
  const today = todayInIndia();
  const overdue = activeEquipment.filter((e) => dueStatus(e.nextDue, today) === "overdue").length;
  const nextDue = activeEquipment
    .map((e) => e.nextDue)
    .filter((d): d is string => Boolean(d))
    .sort()[0];
  const siteOptions = sites.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name }));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link
          href="/clients"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-primary"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Clients
        </Link>
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
                {siteOptions.length > 0 ? (
                  <Button asChild>
                    <Link href={`/clients/${company.id}/equipment/new`}>
                      <Plus aria-hidden="true" />
                      Add equipment
                    </Link>
                  </Button>
                ) : null}
              </div>
            ) : undefined
          }
        />
        {company.active ? null : (
          <StatusBadge tone="neutral" className="w-fit">
            Inactive client
          </StatusBadge>
        )}
      </div>

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
      </div>

      <Section
        title="Equipment"
        description="What QA Tech maps or validates here. Studies copy their defaults from these records."
        action={
          equipment.length > 0 ? (
            <Button variant="secondary" size="sm" asChild>
              <a href={`/clients/${company.id}/export`} download>
                <Download aria-hidden="true" />
                Download Excel
              </a>
            </Button>
          ) : undefined
        }
      >
        {equipment.length === 0 ? (
          <EmptyState
            icon={Refrigerator}
            title="No equipment yet"
            description={
              siteOptions.length === 0
                ? "Add a site first, then the equipment at that site."
                : "Add the freezers, cold rooms, warehouses or autoclaves this client has."
            }
            action={
              canManage && siteOptions.length > 0 ? (
                <Button asChild>
                  <Link href={`/clients/${company.id}/equipment/new`}>
                    <Plus aria-hidden="true" />
                    Add equipment
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
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
              {equipment.map((item) => (
                <TableRow
                  key={item.id}
                  className={item.active ? undefined : "text-muted-foreground"}
                >
                  <TableCell>
                    <Link
                      href={`/clients/${company.id}/equipment/${item.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {item.code}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {item.name}
                      {isEquipmentType(item.type)
                        ? ` · ${EQUIPMENT_TYPE_INFO[item.type].label}`
                        : ""}
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
                  <TableCell className="tabular text-right">
                    {item.defaultChannels ?? "—"}
                  </TableCell>
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
        )}
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
        title="Sites and departments"
        description="Report numbers use the site code. Click a department to rename or switch it off."
        action={canManage ? <SiteDialog companyId={company.id} /> : undefined}
      >
        {sites.length === 0 ? (
          <EmptyState
            icon={MapPin}
            title="No sites yet"
            description="Add the client's locations, e.g. Seawoods or Ambernath."
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {sites.map((site) => (
              <li
                key={site.id}
                className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {site.name}
                      {site.code !== site.name ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          code {site.code}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {[site.address, site.city, site.state].filter(Boolean).join(", ") ||
                        "No address yet"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {site.active ? null : <StatusBadge tone="neutral">Inactive</StatusBadge>}
                    {canManage ? (
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
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {departments
                    .filter((d) => d.siteId === site.id)
                    .map((d) =>
                      canManage ? (
                        <DepartmentDialog
                          key={d.id}
                          companyId={company.id}
                          siteId={site.id}
                          siteName={site.name}
                          department={{ id: d.id, name: d.name, active: d.active }}
                        />
                      ) : (
                        <span
                          key={d.id}
                          className="rounded-full border border-border px-2.5 py-0.5 text-xs"
                        >
                          {d.name}
                        </span>
                      ),
                    )}
                  {canManage && site.active ? (
                    <DepartmentDialog
                      companyId={company.id}
                      siteId={site.id}
                      siteName={site.name}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

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
    </div>
  );
}
