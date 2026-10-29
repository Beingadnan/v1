import { CalendarClock, ChevronLeft, Download } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/db/client";
import { EQUIPMENT_TYPE_INFO, isEquipmentType } from "@/domain/clients/equipment-types";
import { listDueEquipment, type DueItem } from "@/domain/clients/export-service";
import { requirePermission } from "@/lib/auth/dal";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

import { DueBadge } from "../due-badge";
import { DUE_WINDOWS, readDueWindow } from "./window";

export const metadata = { title: "Requalification due" };

export default async function DuePage({ searchParams }: PageProps<"/clients/due">) {
  const actor = await requirePermission("clients.view");
  const window = readDueWindow(await searchParams);
  const items = await listDueEquipment(db, actor, window);
  const overdue = items.filter((i) => i.status === "overdue").length;
  const soon = items.filter((i) => i.status === "due_soon").length;
  const unknown = items.filter((i) => i.status === "none").length;

  // Grouped by client: one call or quotation per client covers all its due items.
  const groups = new Map<string, DueItem[]>();
  for (const item of items)
    groups.set(item.companyId, [...(groups.get(item.companyId) ?? []), item]);

  const query = (days: number, includeUnknown: boolean) =>
    `?days=${days}${includeUnknown ? "&unknown=1" : ""}`;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/clients"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-primary"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Clients
        </Link>
        <PageHeader
          title="Requalification due"
          description="Equipment whose next study is overdue or coming up, worked out from each item's last study and its requalification interval. Use it to plan visits and send quotations early."
          action={
            <Button variant="secondary" asChild>
              <a href={`/clients/due/export${query(window.days, window.includeUnknown)}`} download>
                <Download aria-hidden="true" />
                Download Excel
              </a>
            </Button>
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Due within</span>
        {DUE_WINDOWS.map((days) => (
          <Link
            key={days}
            href={`/clients/due${query(days, window.includeUnknown)}`}
            aria-current={days === window.days ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1",
              days === window.days
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-surface hover:border-primary",
            )}
          >
            {days} days
          </Link>
        ))}
        <Link
          href={`/clients/due${query(window.days, !window.includeUnknown)}`}
          className="ml-2 text-primary hover:underline"
        >
          {window.includeUnknown
            ? "Hide items with no study date"
            : "Also show items with no study date"}
        </Link>
      </div>

      <p className="text-sm">
        <strong className="text-fail">{overdue} overdue</strong> ·{" "}
        <strong className="text-attention">{soon} due within 30 days</strong> ·{" "}
        {items.length - overdue - soon - unknown} later
        {window.includeUnknown ? ` · ${unknown} with no study date` : ""}
      </p>

      {items.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={`Nothing due in the next ${window.days} days`}
          description="Equipment appears here once its last study date is recorded and the next one comes within the window."
        />
      ) : (
        [...groups.values()].map((group) => {
          const first = group[0]!;
          return (
            <section key={first.companyId} className="flex flex-col gap-2">
              <h2 className="flex items-baseline gap-2 text-base font-semibold">
                <Link href={`/clients/${first.companyId}`} className="text-primary hover:underline">
                  {first.companyName}
                </Link>
                <span className="text-sm font-normal text-muted-foreground">
                  {group.length} item{group.length === 1 ? "" : "s"}
                </span>
              </h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Equipment</TableHead>
                    <TableHead>Where</TableHead>
                    <TableHead>Last study</TableHead>
                    <TableHead>Next due</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Link
                          href={`/clients/${item.companyId}/equipment/${item.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {item.code}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {item.name}
                          {isEquipmentType(item.type)
                            ? ` · ${EQUIPMENT_TYPE_INFO[item.type].label}`
                            : ""}
                          {item.seasonalMapping ? " · summer and winter" : ""}
                        </p>
                      </TableCell>
                      <TableCell>
                        {item.siteName}
                        {item.department ? (
                          <p className="text-xs text-muted-foreground">{item.department}</p>
                        ) : null}
                      </TableCell>
                      <TableCell className="tabular">{formatDate(item.lastStudyOn)}</TableCell>
                      <TableCell>
                        <DueBadge nextDue={item.nextDue} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          );
        })
      )}
    </div>
  );
}
