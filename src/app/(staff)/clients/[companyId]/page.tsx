import {
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  Download,
  MapPin,
  Network,
  Plus,
  Refrigerator,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
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
import { dueStatus, todayInIndia } from "@/domain/clients/requalification";
import { STUDY_STATUS_LABELS } from "@/domain/field/types";
import { listContracts } from "@/domain/jobs/contract-service";
import { formatInr } from "@/domain/jobs/pricing";
import { ORDER_TYPE_SHORT } from "@/domain/jobs/types";
import { requirePermission } from "@/lib/auth/dal";
import { formatDate, formatDateTime, formatLimits } from "@/lib/format";
import { cn } from "@/lib/utils";

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
import { finderHref, MONTH_NAMES, Trail, type FinderPlace } from "./finder";
import { FinderSelect, type FinderOption } from "./finder-select";

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
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children}</dd>
    </div>
  );
}

type EquipmentRow =
  Awaited<ReturnType<typeof getCompany>> extends infer T
    ? T extends { equipment: (infer E)[] }
      ? E
      : never
    : never;

const dmy = (iso: string) => iso.split("-").reverse().join(".");
const monthYear = (d: Date) =>
  new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "Asia/Kolkata" })
    .format(d)
    .replace(/^(\w+) /, "$1 ");

/** A study's state on its card: the client's signature counts most. */
function studyBadge(s: { reportStatus: string | null; studyStatus: string }): {
  tone: StatusTone;
  label: string;
} {
  if (s.reportStatus === "signed") return { tone: "pass", label: "Signed" };
  if (s.reportStatus && s.reportStatus !== "replaced")
    return { tone: "attention", label: "Report in progress" };
  if (s.studyStatus === "completed") return { tone: "info", label: "Field work done" };
  if (s.studyStatus === "in_progress") return { tone: "info", label: "In progress" };
  return {
    tone: "neutral",
    label: STUDY_STATUS_LABELS[s.studyStatus as keyof typeof STUDY_STATUS_LABELS] ?? s.studyStatus,
  };
}

/** One step of the finder: the number (a tick once picked), the name, the choice. */
function Step({
  n,
  done,
  last,
  title,
  control,
  aside,
}: {
  n: number;
  done: boolean;
  last?: boolean;
  title: string;
  control: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <li className="relative grid grid-cols-[1.75rem_1fr] items-center gap-x-3 gap-y-1.5 py-2 sm:grid-cols-[1.75rem_7.5rem_1fr_9.5rem]">
      {!last ? (
        <span
          className="absolute top-[calc(50%+0.875rem)] left-[0.84rem] h-[calc(100%-1.75rem)] w-px bg-border max-sm:top-9"
          aria-hidden="true"
        />
      ) : null}
      <span
        className={cn(
          "relative z-10 flex size-7 items-center justify-center rounded-full text-xs font-semibold",
          done ? "bg-primary text-primary-foreground" : "bg-surface-muted text-muted-foreground",
        )}
        aria-hidden="true"
      >
        {done ? <Check className="size-4" strokeWidth={3} /> : n}
      </span>
      <span className="text-sm font-medium">{title}</span>
      <div className="col-start-2 min-w-0 sm:col-start-auto">{control}</div>
      {aside ? (
        <div className="col-start-2 flex min-h-8 items-center sm:col-start-auto">{aside}</div>
      ) : (
        <span className="hidden sm:block" aria-hidden="true" />
      )}
    </li>
  );
}

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
  const today = todayInIndia();
  const isOverdue = (e: EquipmentRow) => e.active && dueStatus(e.nextDue, today) === "overdue";
  const activeEquipment = equipment.filter((e) => e.active);
  const overdue = activeEquipment.filter(isOverdue).length;
  const nextDue = activeEquipment
    .map((e) => e.nextDue)
    .filter((d): d is string => Boolean(d))
    .sort()[0];
  const siteOptions = sites.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name }));
  const liveStudies = studyRows.filter((s) => s.jobStatus !== "cancelled");

  // The finder (each step checked against this client, each optional).
  const regionOf = (s: { state: string }) => s.state.trim() || "none";
  const regionLabel = (r: string) => (r === "none" ? "No state recorded" : r);
  const regions = [...new Set(sites.map(regionOf))].sort();
  const region = regions.find((r) => r === pick("region"));
  const inRegion = sites.filter((s) => !region || regionOf(s) === region);
  const site = inRegion.find((s) => s.id === pick("site"));
  const siteIds = new Set((site ? [site] : inRegion).map((s) => s.id));
  const deptChoices = departments.filter((d) => siteIds.has(d.siteId));
  const dept = deptChoices.find((d) => d.id === pick("dept"));
  const eqChoices = equipment.filter(
    (e) => siteIds.has(e.siteId) && (!dept || e.departmentId === dept.id),
  );
  const eq = eqChoices.find((e) => e.id === pick("eq"));
  const eqIds = new Set((eq ? [eq] : eqChoices).map((e) => e.id));
  const placeStudies = liveStudies.filter((s) => eqIds.has(s.equipmentId));
  // Months with studies, for the place picked so far.
  const periods = [...new Set(placeStudies.map((s) => s.start.slice(0, 7)))].sort().reverse();
  const years = [...new Set(periods.map((p) => p.slice(0, 4)))];
  const ymPick = pick("ym");
  const ym = ymPick && (years.includes(ymPick) || periods.includes(ymPick)) ? ymPick : undefined;
  const shownStudies = placeStudies.filter((s) => !ym || s.start.startsWith(ym));
  const view = pick("view") === "equipment" ? "equipment" : undefined;
  const all = pick("all") === "1";
  const place: FinderPlace = {
    region,
    site: site?.id,
    ym,
    dept: dept?.id,
    eq: eq?.id,
    view,
  };
  const at = (change: Partial<FinderPlace>) => finderHref(company.id, { ...place, ...change });
  const eqById = new Map(equipment.map((e) => [e.id, e]));
  const deptName = new Map(departments.map((d) => [d.id, d.name]));

  const regionOptions: FinderOption[] = [
    {
      label: "All regions",
      href: at({ region: undefined, site: undefined, dept: undefined, eq: undefined }),
    },
    ...regions.map((r) => ({
      label: regionLabel(r),
      href: at({ region: r, site: undefined, dept: undefined, eq: undefined }),
    })),
  ];
  const siteOptionsList: FinderOption[] = [
    {
      label: region ? `All sites in ${regionLabel(region)}` : "All sites",
      href: at({ site: undefined, dept: undefined, eq: undefined }),
    },
    ...inRegion.map((s) => ({
      label: s.active ? s.name : `${s.name} (inactive)`,
      href: at({ region: regionOf(s), site: s.id, dept: undefined, eq: undefined }),
    })),
  ];
  const periodOptions: FinderOption[] = [
    { label: "Any time", href: at({ ym: undefined }) },
    ...years.flatMap((y) => [
      { label: `All of ${y}`, href: at({ ym: y }), group: y },
      ...periods
        .filter((p) => p.startsWith(y))
        .map((p) => ({
          label: `${y} · ${MONTH_NAMES[Number(p.slice(5, 7)) - 1]}`,
          href: at({ ym: p }),
          group: y,
        })),
    ]),
  ];
  const deptOptions: FinderOption[] = [
    { label: "All departments", href: at({ dept: undefined, eq: undefined }) },
    ...deptChoices.map((d) => ({
      label: site ? d.name : `${d.name} · ${siteName.get(d.siteId)}`,
      href: at({ dept: d.id, eq: undefined }),
    })),
  ];
  const eqOptions: FinderOption[] = [
    { label: "All equipment", href: at({ eq: undefined }) },
    ...eqChoices.map((e) => ({
      label: `${e.code} · ${e.name}${e.active ? "" : " (retired)"}${isOverdue(e) ? " · overdue" : ""}`,
      href: at({ eq: e.id }),
    })),
  ];
  const valueOf = (options: FinderOption[], href: string) =>
    options.find((o) => o.href === href)?.href ?? options[0]!.href;
  const here = finderHref(company.id, place);
  const sinceYear = company.createdAt ? monthYear(new Date(company.createdAt)) : "—";
  const initials = (company.code || company.name)
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 3)
    .toUpperCase();
  const addEquipmentHref = `/clients/${company.id}/equipment/new${
    site ? `?site=${site.id}${dept ? `&dept=${dept.id}` : ""}` : ""
  }`;
  const shownEquipment = (eq ? [eq] : eqChoices).filter((e) => e.active || eq);
  const STUDY_LIMIT = 24;
  const cards = all ? shownStudies : shownStudies.slice(0, STUDY_LIMIT);

  const details: ReactNode = (
    <>
      <dl className="grid gap-4 rounded-xl border border-border bg-surface p-4 sm:grid-cols-3">
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
      </dl>
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

  const results =
    view === "equipment" ? (
      shownEquipment.length ? (
        <ul
          aria-label="Equipment list"
          className="divide-y divide-border overflow-hidden rounded-lg border border-border"
        >
          {shownEquipment.map((e) => (
            <li key={e.id}>
              <Link
                href={`/clients/${company.id}/equipment/${e.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm hover:bg-surface-muted/60"
              >
                <span className="min-w-0 flex-1 basis-48">
                  <span className="font-medium">{e.code}</span>{" "}
                  <span className="text-muted-foreground">{e.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[
                      isEquipmentType(e.type) ? EQUIPMENT_TYPE_INFO[e.type].label : e.type,
                      e.departmentId ? deptName.get(e.departmentId) : "",
                      site ? "" : siteName.get(e.siteId),
                      formatLimits(e.tempMinC, e.tempMaxC, "°C"),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {e.active ? (
                  <DueBadge nextDue={e.nextDue} />
                ) : (
                  <StatusBadge tone="neutral">Retired</StatusBadge>
                )}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">No equipment here yet.</p>
      )
    ) : cards.length ? (
      <ul aria-label="Studies" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((s) => {
          const e = eqById.get(s.equipmentId);
          const badge = studyBadge(s);
          return (
            <li key={s.id}>
              <Link
                href={`/studies/${s.id}${s.reportStatus === "signed" ? "?tab=report" : ""}`}
                className="flex h-full flex-col gap-1 rounded-lg border border-border p-3 transition-colors hover:border-primary hover:bg-primary/5"
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium">
                    {e?.name ?? "Equipment"}
                  </span>
                  <StatusBadge tone={badge.tone} className="shrink-0">
                    {badge.label}
                  </StatusBadge>
                </span>
                <span className="tabular truncate text-xs text-muted-foreground">
                  {e?.code} · {dmy(s.start)}
                  {s.end !== s.start ? ` – ${dmy(s.end)}` : ""}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    ) : (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {liveStudies.length
          ? "No studies for what's selected. Change a step above."
          : "No studies yet: they appear here once a job for this client is booked."}
      </p>
    );

  const finder = (
    <section
      aria-label="Find studies"
      className="flex flex-col rounded-xl border border-border bg-surface shadow-sm"
    >
      <ol className="flex flex-col px-4 py-2 sm:px-5">
        <Step
          n={1}
          done={!!region}
          title="Region"
          control={
            <FinderSelect
              label="Region"
              icon={<MapPin className="size-4" aria-hidden="true" />}
              value={valueOf(
                regionOptions,
                at({ region, site: undefined, dept: undefined, eq: undefined }),
              )}
              options={regionOptions}
            />
          }
        />
        <Step
          n={2}
          done={!!site}
          title="Site"
          control={
            <FinderSelect
              label="Site"
              icon={<Building2 className="size-4" aria-hidden="true" />}
              value={
                site
                  ? at({ region: regionOf(site), site: site.id, dept: undefined, eq: undefined })
                  : siteOptionsList[0]!.href
              }
              options={siteOptionsList}
            />
          }
          aside={
            canManage && site ? (
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
            ) : null
          }
        />
        <Step
          n={3}
          done={!!ym}
          title="Year / Month"
          control={
            <FinderSelect
              label="Year or month"
              icon={<CalendarDays className="size-4" aria-hidden="true" />}
              value={ym ? at({ ym }) : periodOptions[0]!.href}
              options={periodOptions}
              disabled={periods.length === 0}
            />
          }
        />
        <Step
          n={4}
          done={!!dept}
          title="Department"
          control={
            <FinderSelect
              label="Department"
              icon={<Network className="size-4" aria-hidden="true" />}
              value={dept ? at({ dept: dept.id, eq: undefined }) : deptOptions[0]!.href}
              options={deptOptions}
              disabled={deptChoices.length === 0}
            />
          }
          aside={
            canManage && site && dept ? (
              <DepartmentDialog
                companyId={company.id}
                siteId={site.id}
                siteName={site.name}
                department={{ id: dept.id, name: dept.name, active: dept.active }}
              />
            ) : null
          }
        />
        <Step
          n={5}
          done={!!eq}
          last
          title="Equipment"
          control={
            <FinderSelect
              label="Equipment"
              icon={<Refrigerator className="size-4" aria-hidden="true" />}
              value={eq ? at({ eq: eq.id }) : eqOptions[0]!.href}
              options={eqOptions}
              disabled={eqChoices.length === 0}
            />
          }
          aside={
            eq ? (
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/clients/${company.id}/equipment/${eq.id}`}>
                  Open
                  <ChevronRight aria-hidden="true" />
                </Link>
              </Button>
            ) : null
          }
        />
      </ol>
      <div className="flex flex-col gap-3 border-t border-border px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <nav aria-label="Show" className="flex gap-4 text-sm">
            {[
              [undefined, "Studies", shownStudies.length],
              ["equipment", "Equipment", shownEquipment.length],
            ].map(([v, l, n]) => (
              <Link
                key={l as string}
                href={at({ view: v as "equipment" | undefined })}
                aria-current={view === v ? "page" : undefined}
                scroll={false}
                className={cn(
                  "-mb-px border-b-2 pb-1",
                  view === v
                    ? "border-primary font-semibold text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {l as string} ({n as number})
              </Link>
            ))}
          </nav>
          {view !== "equipment" && shownStudies.length > cards.length ? (
            <Link
              href={finderHref(company.id, { ...place, all: true })}
              scroll={false}
              className="text-sm text-primary hover:underline"
            >
              Show all {shownStudies.length}
            </Link>
          ) : null}
        </div>
        {results}
      </div>
    </section>
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <Trail parts={[{ label: "Clients", href: "/clients" }, { label: company.name }]} />
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span
            className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-bold tracking-wide text-primary-foreground"
            aria-hidden="true"
          >
            {initials}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold">{company.name}</h1>
            <div className="flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
              <span>
                {[company.code, company.active ? "" : "Inactive client"]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {equipment.length > 0 ? (
                <Button variant="ghost" size="sm" asChild>
                  <a href={`/clients/${company.id}/export`} download>
                    <Download aria-hidden="true" />
                    Excel
                  </a>
                </Button>
              ) : null}
              {canManage ? (
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
              ) : null}
            </div>
          </div>
        </div>
        <dl className="flex divide-x divide-border rounded-xl border border-border bg-surface py-2.5">
          {[
            ["Client since", sinceYear],
            ["Sites", String(sites.length)],
            ["Studies", String(liveStudies.length)],
          ].map(([label, value]) => (
            <div key={label} className="px-5">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="tabular font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      </header>
      {canManage ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <SiteDialog companyId={company.id} toolbar />
          {siteOptions.length ? (
            <DepartmentDialog
              companyId={company.id}
              siteId={site && site.active ? site.id : siteOptions[0]!.id}
              siteName={site && site.active ? site.name : siteOptions[0]!.name}
              sites={siteOptions}
              toolbar
            />
          ) : null}
          {siteOptions.length ? (
            <Button size="sm" asChild>
              <Link href={addEquipmentHref}>
                <Plus aria-hidden="true" />
                Add equipment
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
      {finder}
      <div key={here} className="flex flex-col gap-8">
        {details}
      </div>
    </div>
  );
}
