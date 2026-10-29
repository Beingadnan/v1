import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/db/client";
import { getCompany } from "@/domain/clients/queries";
import { requirePermission } from "@/lib/auth/dal";

import { EquipmentForm } from "../equipment-form";

export const metadata = { title: "Add equipment" };

export default async function NewEquipmentPage({
  params,
}: PageProps<"/clients/[companyId]/equipment/new">) {
  const actor = await requirePermission("clients.manage");
  const { companyId } = await params;
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
          title="Add equipment"
          description="Only the ID, name, type and site are needed now; fill in the rest when you have it."
        />
      </div>
      <EquipmentForm
        companyId={companyId}
        companyRequalificationMonths={data.company.requalificationMonths}
        sites={sites.map((s) => ({ id: s.id, name: s.name }))}
        departments={data.departments
          .filter((d) => d.active)
          .map((d) => ({ id: d.id, name: d.name, siteId: d.siteId }))}
      />
    </div>
  );
}
