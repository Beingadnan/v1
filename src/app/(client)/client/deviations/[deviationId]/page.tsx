import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/db/client";
import { getClientDeviation } from "@/domain/analysis/client-deviations";
import { requireUser } from "@/lib/auth/dal";

import { DecideForm } from "./decide-form";

export const metadata = { title: "Deviation" };

const dmy = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "");

/** A deviation QA Tech assessed, for the client QA head's signed decision. */
export default async function ClientDeviationPage({
  params,
}: PageProps<"/client/deviations/[deviationId]">) {
  const user = await requireUser();
  const { deviationId } = await params;
  const d = await getClientDeviation(db, user, deviationId);
  if (!d) notFound();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link
        href="/client"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back
      </Link>
      <PageHeader title={`${d.number} · ${d.code}`} description={d.title} />
      <dl className="grid gap-x-4 gap-y-2 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="font-medium">Equipment</dt>
        <dd>
          {d.name} ({d.code})
        </dd>
        <dt className="font-medium">Report</dt>
        <dd className="font-mono text-xs break-all">{d.reportNumber}</dd>
        {d.position ? (
          <>
            <dt className="font-medium">Position</dt>
            <dd>{d.position}</dd>
          </>
        ) : null}
        {d.description ? (
          <>
            <dt className="font-medium">What happened</dt>
            <dd className="whitespace-pre-wrap">{d.description}</dd>
          </>
        ) : null}
        <dt className="font-medium">QA Tech&apos;s assessment</dt>
        <dd className="whitespace-pre-wrap">{d.assessment}</dd>
      </dl>
      {d.closed ? (
        <p className="rounded-md bg-pass-soft px-3 py-2 text-sm text-pass">
          Closed: {d.closed.decision}, decided by {d.closed.by} on {dmy(d.closed.on)}
          {d.closed.inApp ? " (signed in the app)" : " (on paper)"}.
          {d.closed.note ? ` ${d.closed.note}` : ""}
        </p>
      ) : d.canDecide ? (
        <DecideForm id={d.id} number={d.number} canExclude={d.canExclude} />
      ) : (
        <p className="rounded-md bg-surface-muted px-3 py-2 text-sm">
          Your QA head decides this deviation.
        </p>
      )}
    </div>
  );
}
