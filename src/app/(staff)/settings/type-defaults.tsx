"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckboxField, FormMessage, TextField, useFormAction } from "@/components/ui/form-kit";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EQUIPMENT_TYPE_INFO,
  EQUIPMENT_TYPES,
  type EquipmentType,
} from "@/domain/clients/equipment-types";
import {
  STUDY_CYCLE_LABELS,
  STUDY_CYCLES,
  type TypeDefaults,
} from "@/domain/clients/study-defaults";
import { formatLimits } from "@/lib/format";

import { saveTypeDefaultsAction } from "./actions";

type Defaults = Record<EquipmentType, TypeDefaults & { customised: boolean }>;

const text = (n: number | null) => (n === null ? "" : String(n));

/**
 * What new equipment of each type starts with. Choosing a type on the
 * equipment form (or importing a row with blank cells) fills these in.
 */
export function TypeDefaultsSection({
  defaults,
  canEdit,
}: {
  defaults: Defaults;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<EquipmentType | null>(null);
  const [round, setRound] = useState(0);
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6">
      <div>
        <h2 className="text-base font-semibold">Equipment defaults</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          When someone picks a type for new equipment, these values fill the empty fields. Start
          values follow WHO TRS 961 Supplement 8 and QA Tech&apos;s reports; change them to match
          your SOPs.
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Limits</TableHead>
            <TableHead className="text-right">Loggers</TableHead>
            <TableHead>Interval · duration</TableHead>
            <TableHead>Cycles</TableHead>
            <TableHead>Requalify</TableHead>
            {canEdit ? <TableHead className="w-16" /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {EQUIPMENT_TYPES.map((type) => {
            const d = defaults[type];
            return (
              <TableRow key={type}>
                <TableCell>
                  <p className="font-medium">{EQUIPMENT_TYPE_INFO[type].label}</p>
                  {d.customised ? (
                    <p className="text-xs text-muted-foreground">Changed for QA Tech</p>
                  ) : null}
                </TableCell>
                <TableCell className="tabular whitespace-nowrap">
                  {formatLimits(d.tempMinC, d.tempMaxC, "°C")}
                  {d.rhMinPct !== null || d.rhMaxPct !== null ? (
                    <p className="text-xs text-muted-foreground">
                      {formatLimits(d.rhMinPct, d.rhMaxPct, "%RH")}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className="tabular text-right">
                  {d.defaultChannels ?? "by size"}
                </TableCell>
                <TableCell className="tabular whitespace-nowrap">
                  {d.readingIntervalMinutes ? `${d.readingIntervalMinutes} min` : "—"} ·{" "}
                  {d.studyDurationHours ? `${d.studyDurationHours} h` : "—"}
                </TableCell>
                <TableCell className="text-xs">
                  {d.cycles.map((c) => STUDY_CYCLE_LABELS[c]).join(", ") || "—"}
                  {d.seasonalMapping ? (
                    <p className="text-muted-foreground">Summer and winter</p>
                  ) : null}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {d.requalificationMonths ? `${d.requalificationMonths} months` : "client's"}
                </TableCell>
                {canEdit ? (
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(type)}
                      aria-label={`Edit ${EQUIPMENT_TYPE_INFO[type].label} defaults`}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setRound((r) => r + 1);
          }
        }}
      >
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
          {editing ? <DefaultsForm key={round} type={editing} values={defaults[editing]} /> : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function DefaultsForm({ type, values }: { type: EquipmentType; values: TypeDefaults }) {
  const { result, pending, onSubmit } = useFormAction(saveTypeDefaultsAction);
  const field = (name: keyof TypeDefaults, label: string, suffix?: string) => (
    <TextField
      name={name}
      label={label}
      inputMode="decimal"
      suffix={suffix}
      defaultValue={text(values[name] as number | null)}
      result={result}
    />
  );
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <DialogHeader>
        <DialogTitle>{EQUIPMENT_TYPE_INFO[type].label} defaults</DialogTitle>
        <DialogDescription>
          Used for new equipment only. Equipment already saved keeps its own values.
        </DialogDescription>
      </DialogHeader>
      <input type="hidden" name="type" value={type} />
      <div className="grid gap-4 sm:grid-cols-3">
        {field("setPointC", "Set point", "°C")}
        {field("tempMinC", "Lowest allowed", "°C")}
        {field("tempMaxC", "Highest allowed", "°C")}
        {field("rhMinPct", "Lowest RH", "%RH")}
        {field("rhMaxPct", "Highest RH", "%RH")}
        {field("defaultChannels", "Number of loggers")}
        {field("readingIntervalMinutes", "Reading every", "min")}
        {field("studyDurationHours", "Study duration", "hours")}
        {field("requalificationMonths", "Requalify every", "months")}
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">Cycles</legend>
        <div className="flex flex-wrap gap-2">
          {STUDY_CYCLES.map((cycle) => (
            <label
              key={cycle}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm has-checked:border-primary has-checked:bg-brand-soft"
            >
              <input
                type="checkbox"
                name="cycles"
                value={cycle}
                defaultChecked={values.cycles.includes(cycle)}
                className="size-4 accent-primary"
              />
              {STUDY_CYCLE_LABELS[cycle]}
            </label>
          ))}
        </div>
      </fieldset>
      <CheckboxField
        name="seasonalMapping"
        label="Map in summer and in winter"
        defaultChecked={values.seasonalMapping}
      />
      <FormMessage result={result} />
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          Save defaults
        </Button>
      </DialogFooter>
    </form>
  );
}
