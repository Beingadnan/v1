import { ChevronLeft } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/db/client";
import { can } from "@/domain/auth/permissions";
import { clientOptions, qaSiteOptions, siteEquipment, staffOptions } from "@/domain/jobs/queries";
import { todayInIndia } from "@/domain/clients/requalification";
import { requirePermission } from "@/lib/auth/dal";

import { NewJobForm } from "./new-job-form";

export const metadata = { title: "New job" };

/** The next working day after a week, a sensible first guess for a visit. */
function defaultStart(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default async function NewJobPage({ searchParams }: PageProps<"/jobs/new">) {
  const actor = await requirePermission("jobs.manage");
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
  // The site named in the link: its equipment is read alongside (it checks the organisation
  // itself) and used only if the site turns out to belong to the client.
  const askedSite = one(params.site);
  const [clients, staff, qaSites, askedEquipment] = await Promise.all([
    clientOptions(db, actor),
    staffOptions(db, actor),
    qaSiteOptions(db, actor),
    askedSite ? siteEquipment(db, actor, askedSite) : Promise.resolve(null),
  ]);
  // Arriving from the due list or a client page: client, site and equipment filled in.
  let companyId = one(params.company);
  let siteId = one(params.site);
  const company = clients.find((c) => c.id === companyId);
  if (!company) companyId = "";
  if (!company?.sites.some((s) => s.id === siteId))
    siteId = company?.sites.length === 1 ? company.sites[0]!.id : "";
  const equipment = !siteId
    ? []
    : siteId === askedSite && askedEquipment
      ? askedEquipment
      : await siteEquipment(db, actor, siteId);
  const preselected = one(params.equipment).split(",").filter(Boolean);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/jobs"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-primary"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Jobs
        </Link>
        <PageHeader
          title="New job"
          description="Pick the client's site and the equipment; items due for requalification are ticked for you. Study details, loggers and report numbers are filled in from each item and can be changed on the job."
        />
      </div>
      <NewJobForm
        clients={clients}
        staff={staff}
        qaSites={qaSites}
        me={{ id: actor.id, role: actor.role }}
        canSeeMoney={can(actor, "jobs.money")}
        canManageClients={can(actor, "clients.manage")}
        initial={{
          companyId,
          siteId,
          equipment,
          preselected,
          plannedStart: defaultStart(todayInIndia()),
        }}
      />
    </div>
  );
}
