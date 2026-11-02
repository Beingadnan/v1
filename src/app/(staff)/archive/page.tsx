import { Archive } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/db/client";
import { archiveTree } from "@/domain/dashboard/archive";
import { requirePermission } from "@/lib/auth/dal";

export const metadata = { title: "Archive" };

const dmy = (iso: string) => iso.split("-").reverse().join(".");

function Level({
  label,
  count,
  open,
  children,
}: {
  label: string;
  count: number;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={open} className="rounded-md">
      <summary className="cursor-pointer py-1 text-sm">
        <span className="font-medium">{label}</span>{" "}
        <span className="text-muted-foreground">({count})</span>
      </summary>
      <div className="ml-4 border-l border-border pl-3">{children}</div>
    </details>
  );
}

/** Company → Site → Year → Month → Department → Equipment → signed studies. */
export default async function ArchivePage() {
  const actor = await requirePermission("jobs.view");
  const { tree, total } = await archiveTree(db, actor);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Archive"
        description={`Every study whose report the client signed (${total}), by company, site, year, month, department and equipment.`}
      />
      {tree.length === 0 ? (
        <EmptyState
          icon={Archive}
          title="Nothing archived yet"
          description="A study moves here when the client signs its report."
        />
      ) : (
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3">
          {tree.map((co) => (
            <Level key={co.key} label={co.label} count={co.count} open={tree.length === 1}>
              {co.children.map((site) => (
                <Level key={site.key} label={site.label} count={site.count}>
                  {site.children.map((y) => (
                    <Level key={y.key} label={y.label} count={y.count}>
                      {y.children.map((m) => (
                        <Level key={m.key} label={m.label} count={m.count}>
                          {m.children.map((dep) => (
                            <Level key={dep.key} label={dep.label} count={dep.count}>
                              {dep.children.map((eq) => (
                                <Level key={eq.key} label={eq.label} count={eq.count}>
                                  <ul className="flex flex-col gap-1 py-1 text-sm">
                                    {eq.children.map((s) => (
                                      <li key={s.reportId}>
                                        <Link
                                          href={`/studies/${s.studyId}?tab=report`}
                                          className="text-primary underline"
                                        >
                                          {s.reportNumber} {s.rev}
                                        </Link>{" "}
                                        <span className="text-xs text-muted-foreground">
                                          signed {dmy(s.signedOn)}
                                          {s.signedVia === "paper" ? " on paper" : ""} ·{" "}
                                          {s.jobNumber} ·{" "}
                                          <a
                                            href={`/studies/${s.studyId}/report/${s.reportId}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="underline"
                                          >
                                            PDF
                                          </a>
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                </Level>
                              ))}
                            </Level>
                          ))}
                        </Level>
                      ))}
                    </Level>
                  ))}
                </Level>
              ))}
            </Level>
          ))}
        </div>
      )}
    </div>
  );
}
