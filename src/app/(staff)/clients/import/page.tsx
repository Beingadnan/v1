import { ChevronLeft } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/dal";
import { env } from "@/lib/env";

import { ImportFlow } from "./import-flow";

export const metadata = { title: "Import clients" };

export default async function ImportPage() {
  await requirePermission("clients.manage");
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/clients"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-primary"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Clients
        </Link>
        <PageHeader
          title="Import clients and equipment"
          description="Fill the template in Excel, upload it, check what will change, then import. Nothing changes until you press Import."
        />
      </div>
      <ImportFlow maxSizeMb={env.UPLOAD_MAX_MB} />
    </div>
  );
}
