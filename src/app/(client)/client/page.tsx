import { FileSignature } from "lucide-react";
import { eq } from "drizzle-orm";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/db/client";
import { clientCompanies } from "@/db/schema";
import { requireUser } from "@/lib/auth/dal";

export const metadata = { title: "Reports" };

export default async function ClientHomePage() {
  const user = await requireUser();
  const [company] = user.clientCompanyId
    ? await db
        .select({ name: clientCompanies.name })
        .from(clientCompanies)
        .where(eq(clientCompanies.id, user.clientCompanyId))
    : [];
  const firstName = user.name.split(/\s+/)[0] ?? user.name;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={`Hello, ${firstName}`}
        description={company ? `Reports from QA Tech for ${company.name}.` : undefined}
      />
      <EmptyState
        icon={FileSignature}
        title="No reports to review yet"
        description="When QA Tech releases a report to you, it appears here for review and signature."
      />
    </div>
  );
}
