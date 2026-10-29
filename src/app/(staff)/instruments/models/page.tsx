import { Boxes } from "lucide-react";

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
import { can } from "@/domain/auth/permissions";
import {
  INSTRUMENT_TYPE_INFO,
  QUANTITY_UNITS,
  type InstrumentType,
  type Quantity,
} from "@/domain/instruments/types";
import { requirePermission } from "@/lib/auth/dal";

import { ModelButton } from "../instrument-dialogs";
import { formOptions } from "../options";

export const metadata = { title: "Instrument models" };

export default async function ModelsPage() {
  const actor = await requirePermission("instruments.view");
  const canManage = can(actor, "instruments.manage");
  const { models } = await formOptions(actor);
  return (
    <>
      <PageHeader
        title="Instrument models"
        description="Make, range, accuracy, SOP and usual test points for each model. New instruments and certificates take these automatically."
        action={canManage ? <ModelButton /> : undefined}
      />
      {models.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No models yet"
          description="Add the logger and sensor models QA Tech uses, such as ebro EBI 20-TH1 or Testo 174H."
          action={canManage ? <ModelButton /> : undefined}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead className="hidden md:table-cell">Range</TableHead>
              <TableHead>Accuracy</TableHead>
              <TableHead className="hidden md:table-cell">Test points</TableHead>
              <TableHead className="hidden sm:table-cell">Interval</TableHead>
              {canManage ? (
                <TableHead className="w-16">
                  <span className="sr-only">Edit</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <p className="font-medium">
                    {m.make} {m.model}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {m.equipmentName} · {INSTRUMENT_TYPE_INFO[m.type as InstrumentType]?.label}
                  </p>
                </TableCell>
                <TableCell className="hidden md:table-cell">{m.rangeText || "—"}</TableCell>
                <TableCell className="text-sm">
                  {m.accuracyText ||
                    (Object.entries(m.accuracy) as [Quantity, { tolerance: number }][])
                      .map(([q, a]) => `± ${a.tolerance} ${QUANTITY_UNITS[q]}`)
                      .join(", ") ||
                    "—"}
                </TableCell>
                <TableCell className="hidden text-sm md:table-cell">
                  {m.defaultPoints.length
                    ? m.defaultPoints
                        .map(
                          (p) => `${p.reference} ${QUANTITY_UNITS[p.quantity as Quantity] ?? ""}`,
                        )
                        .join(", ")
                    : "—"}
                </TableCell>
                <TableCell className="hidden sm:table-cell">{m.intervalMonths} months</TableCell>
                {canManage ? (
                  <TableCell>
                    <ModelButton model={m} />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
