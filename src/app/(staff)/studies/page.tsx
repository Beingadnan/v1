import { ThermometerSnowflake } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { db } from "@/db/client";
import { can } from "@/domain/auth/permissions";
import { myStudies, type MyStudy } from "@/domain/field/queries";
import { STUDY_STATUS_LABELS } from "@/domain/field/types";
import { requirePermission } from "@/lib/auth/dal";
import { cn } from "@/lib/utils";

export const metadata = { title: "My studies" };

const dmy = (iso: string) => iso.split("-").reverse().join(".");

export default async function StudiesPage({ searchParams }: PageProps<"/studies">) {
  const actor = await requirePermission("field.perform");
  const everyone = (await searchParams).all === "1" && can(actor, "jobs.manage");
  const rows = await myStudies(db, actor, { everyone });
  const today = rows.filter((r) => r.today && r.status !== "completed");
  const later = rows.filter((r) => !r.today && r.status !== "completed");
  const done = rows.filter((r) => r.status === "completed");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={everyone ? "All studies on site" : "My studies"}
        description="Studies of jobs that are ready or in field work. Open one to place loggers, record times and take photos."
      />
      {can(actor, "jobs.manage") ? (
        <nav aria-label="Show" className="flex gap-1 text-sm">
          {[
            ["", "Mine"],
            ["1", "Everyone's"],
          ].map(([v, l]) => (
            <Link
              key={v}
              href={v ? "/studies?all=1" : "/studies"}
              aria-current={(v === "1") === everyone ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1",
                (v === "1") === everyone
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border",
              )}
            >
              {l}
            </Link>
          ))}
        </nav>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          icon={ThermometerSnowflake}
          title="Nothing on site for you"
          description="Studies appear here when you are on the team of a job that is Ready or in Field Work."
        />
      ) : (
        <>
          <Group title="Today" rows={today} />
          <Group title="Coming up" rows={later} />
          <Group title="Done" rows={done} />
        </>
      )}
    </div>
  );
}

function Group({ title, rows }: { title: string; rows: MyStudy[] }) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby={`g-${title}`} className="flex flex-col gap-2">
      <h2 id={`g-${title}`} className="text-sm font-semibold text-muted-foreground">
        {title} ({rows.length})
      </h2>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.id}>
            <Link
              href={`/studies/${r.id}`}
              className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4 hover:border-primary"
            >
              <span className="flex items-center justify-between gap-2">
                <strong className="text-lg">{r.equipmentCode}</strong>
                <StatusBadge
                  tone={
                    r.status === "completed"
                      ? "pass"
                      : r.status === "in_progress"
                        ? "info"
                        : "neutral"
                  }
                >
                  {STUDY_STATUS_LABELS[r.status]}
                </StatusBadge>
              </span>
              <span className="text-sm">{r.equipmentName}</span>
              <span className="text-sm text-muted-foreground">
                {r.companyName} · {r.siteName}
                {r.department ? ` · ${r.department}` : ""}
              </span>
              <span className="text-xs text-muted-foreground">
                {r.jobNumber} · {dmy(r.plannedStart)}
                {r.plannedEnd !== r.plannedStart ? `–${dmy(r.plannedEnd)}` : ""} ·{" "}
                {r.positions === 0
                  ? "no layout yet"
                  : `${r.placed} of ${r.positions} loggers placed`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
