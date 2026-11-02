import { ShieldAlert } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { db } from "@/db/client";
import { deviationRegister } from "@/domain/analysis/capa-service";
import { requirePermission } from "@/lib/auth/dal";
import { cn } from "@/lib/utils";

import { CapaControls, RaiseCapa } from "./capa-forms";

export const metadata = { title: "Deviations" };

const dmy = (iso: string) => iso.split("-").reverse().join(".");
const when = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);

/** Deviations (open first, oldest first) and their CAPAs (overdue first). */
export default async function DeviationsPage({ searchParams }: PageProps<"/deviations">) {
  const actor = await requirePermission("jobs.view");
  const show = (await searchParams).show === "all" ? "all" : "open";
  const r = await deviationRegister(db, actor, { show });
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Deviations and CAPA"
        description="Every deviation, who decides it, and the corrective and preventive actions raised from it."
      />
      <nav aria-label="Show" className="flex gap-1 text-sm">
        {(["open", "all"] as const).map((v) => (
          <Link
            key={v}
            href={v === "all" ? "/deviations?show=all" : "/deviations"}
            aria-current={v === show ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1",
              v === show ? "border-primary bg-primary text-primary-foreground" : "border-border",
            )}
          >
            {v === "open" ? "Open" : "All"}
          </Link>
        ))}
      </nav>

      {r.capas.length ? (
        <section aria-labelledby="capas" className="flex flex-col gap-2">
          <h2 id="capas" className="text-sm font-semibold">
            CAPAs not yet verified ({r.capas.length})
          </h2>
          <ul className="flex flex-col gap-2">
            {r.capas.map((c) => (
              <li
                key={c.id}
                className={cn(
                  "flex flex-col gap-1 rounded-lg border bg-surface p-3 text-sm",
                  c.overdue ? "border-fail" : "border-border",
                )}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <strong>{c.number}</strong>
                  <StatusBadge
                    tone={c.overdue ? "fail" : c.status === "done" ? "info" : "attention"}
                  >
                    {c.status === "done"
                      ? "Done, to verify"
                      : c.overdue
                        ? `Overdue since ${dmy(c.dueOn)}`
                        : `Due ${dmy(c.dueOn)}`}
                  </StatusBadge>
                  <span className="text-xs text-muted-foreground">
                    {c.kind} · {c.owner}
                  </span>
                </span>
                <span>{c.action}</span>
                <CapaControls
                  capa={{ id: c.id, status: c.status, ownerUserId: c.ownerUserId }}
                  me={r.me}
                  canManage={r.can.manage}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {r.deviations.length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          title={show === "open" ? "No open deviations" : "No deviations"}
          description="Deviations are opened from a study's Analysis tab, or by a failed post-calibration."
        />
      ) : (
        <section aria-labelledby="devs" className="flex flex-col gap-2">
          <h2 id="devs" className="text-sm font-semibold">
            {show === "open" ? "Open deviations" : "Deviations"} ({r.deviations.length})
          </h2>
          <ul className="flex flex-col gap-3">
            {r.deviations.map((d) => (
              <li
                key={d.id}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/studies/${d.studyId}?tab=analysis`}
                    className="font-semibold text-primary underline"
                  >
                    {d.number}
                  </Link>
                  <StatusBadge tone={d.closedAt ? "pass" : d.assessed ? "info" : "attention"}>
                    {d.closedAt
                      ? `Closed: ${d.decision}${d.decidedBy ? `, ${d.decidedBy}` : ""}`
                      : d.assessed
                        ? "Waiting for the client's decision"
                        : "To assess"}
                  </StatusBadge>
                  <span className="text-xs text-muted-foreground">
                    {d.code} · {d.company} · {d.jobNumber} · opened {when(d.openedAt)}
                  </span>
                </span>
                <span>{d.title}</span>
                {d.capas.length ? (
                  <ul className="flex flex-col gap-1 border-l-2 border-border pl-3 text-xs">
                    {d.capas.map((c) => (
                      <li key={c.id}>
                        <strong className="capitalize">{c.kind}</strong> ({c.owner}, due{" "}
                        {dmy(c.dueOn)}, {c.status}
                        {c.overdue ? ", overdue" : ""}): {c.action}
                        <span className="block text-muted-foreground">
                          Root cause: {c.rootCause}
                        </span>
                        {c.doneNote ? <span className="block">Done: {c.doneNote}</span> : null}
                        {c.effectivenessNote ? (
                          <span className="block text-pass">Verified: {c.effectivenessNote}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {r.can.manage ? (
                  <RaiseCapa deviationId={d.id} staff={r.staff} today={r.today} />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
