import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/db/client";
import { getClientReport } from "@/domain/reports/client-queries";
import { requireUser } from "@/lib/auth/dal";

import { ClientReportView } from "./client-report-view";

export const metadata = { title: "Report" };

/** One released report: read it, then sign Reviewed By / Approved By, or send it back. */
export default async function ClientReportPage({
  params,
}: PageProps<"/client/reports/[reportId]">) {
  const user = await requireUser();
  const { reportId } = await params;
  const report = await getClientReport(db, user, reportId);
  if (!report) notFound();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <Link
        href="/client"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All reports
      </Link>
      <PageHeader
        title={`${report.code} · ${report.label}`}
        description={`${report.name} · ${report.reportNumber}`}
      />
      <ClientReportView r={report} />
    </div>
  );
}
