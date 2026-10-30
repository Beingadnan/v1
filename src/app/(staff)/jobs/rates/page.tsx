import { ChevronLeft, IndianRupee } from "lucide-react";
import Link from "next/link";

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
import { can } from "@/domain/auth/permissions";
import { EQUIPMENT_TYPE_INFO, isEquipmentType } from "@/domain/clients/equipment-types";
import { formatInr } from "@/domain/jobs/pricing";
import { listRateCard } from "@/domain/jobs/queries";
import {
  RATE_BASIS_LABELS,
  WORK_TYPE_LABELS,
  type RateBasis,
  type WorkType,
} from "@/domain/jobs/types";
import { requirePermission } from "@/lib/auth/dal";

import { RateButton, RetireRateButton } from "./rate-dialogs";

export const metadata = { title: "Rate card" };

export default async function RatesPage() {
  const actor = await requirePermission("jobs.money");
  const rows = await listRateCard(db, actor);
  const canEdit = can(actor, "ratecard.manage");
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/jobs"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-primary"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Jobs
        </Link>
        <PageHeader
          title="Rate card"
          description="Standard prices, used to work out what each new job should be worth and to flag a PO that doesn't match."
          action={canEdit ? <RateButton /> : undefined}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={IndianRupee}
          title="No rates yet"
          description={
            canEdit
              ? "Add QA Tech's standard prices: for example walk-in freezer mapping per 24 h study, autoclave validation per cycle, warehouse per logger."
              : "A manager adds the standard prices here."
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Work</TableHead>
              <TableHead>Equipment</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead className="text-right">Price</TableHead>
              {canEdit ? (
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  {WORK_TYPE_LABELS[r.workType as WorkType] ?? r.workType}
                  {r.notes ? <p className="text-xs text-muted-foreground">{r.notes}</p> : null}
                </TableCell>
                <TableCell>
                  {isEquipmentType(r.equipmentType)
                    ? EQUIPMENT_TYPE_INFO[r.equipmentType].label
                    : "Any"}
                </TableCell>
                <TableCell>{r.durationHours ? `${r.durationHours} h` : "Any"}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {formatInr(Number(r.price))}{" "}
                  <span className="text-muted-foreground">
                    {RATE_BASIS_LABELS[r.basis as RateBasis]}
                  </span>
                </TableCell>
                {canEdit ? (
                  <TableCell className="text-right whitespace-nowrap">
                    <RateButton
                      rate={{
                        id: r.id,
                        workType: r.workType,
                        equipmentType: r.equipmentType,
                        durationHours: r.durationHours?.toString() ?? "",
                        basis: r.basis,
                        price: String(Number(r.price)),
                        notes: r.notes,
                      }}
                    />
                    <RetireRateButton id={r.id} />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
