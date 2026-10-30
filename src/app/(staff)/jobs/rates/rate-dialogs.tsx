"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FormDialog, useCloseOnSuccess } from "@/components/ui/form-dialog";
import { FormMessage, SelectField, TextField, useFormAction } from "@/components/ui/form-kit";
import { EQUIPMENT_TYPE_INFO, EQUIPMENT_TYPES } from "@/domain/clients/equipment-types";
import { RATE_BASES, RATE_BASIS_LABELS, WORK_TYPE_LABELS, WORK_TYPES } from "@/domain/jobs/types";

import { retireRateAction, saveRateAction } from "../actions";

export type RateValues = {
  id: string;
  workType: string;
  equipmentType: string;
  durationHours: string;
  basis: string;
  price: string;
  notes: string;
};

export function RateButton({ rate }: { rate?: RateValues }) {
  return (
    <FormDialog
      trigger={(open) =>
        rate ? (
          <Button variant="ghost" size="sm" onClick={open} aria-label="Edit this rate">
            <Pencil aria-hidden="true" />
          </Button>
        ) : (
          <Button onClick={open}>
            <Plus aria-hidden="true" />
            Add a rate
          </Button>
        )
      }
    >
      {(close) => <RateForm rate={rate} close={close} />}
    </FormDialog>
  );
}

function RateForm({ rate, close }: { rate?: RateValues; close: () => void }) {
  const { result, pending, onSubmit } = useFormAction(saveRateAction);
  useCloseOnSuccess(result?.ok, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <DialogTitle>{rate ? "Change rate" : "Add a rate"}</DialogTitle>
      <DialogDescription>
        New jobs are priced from the most specific line that matches: equipment type and duration
        beat &ldquo;any&rdquo;. Jobs already created keep their price.
      </DialogDescription>
      <input type="hidden" name="rateId" value={rate?.id ?? ""} />
      <SelectField
        name="workType"
        label="Work"
        required
        defaultValue={rate?.workType ?? "temperature_mapping"}
        result={result}
      >
        {WORK_TYPES.map((w) => (
          <option key={w} value={w}>
            {WORK_TYPE_LABELS[w]}
          </option>
        ))}
      </SelectField>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="equipmentType"
          label="Equipment type"
          defaultValue={rate?.equipmentType ?? ""}
          result={result}
        >
          <option value="">Any equipment</option>
          {EQUIPMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {EQUIPMENT_TYPE_INFO[t].label}
            </option>
          ))}
        </SelectField>
        <TextField
          name="durationHours"
          label="Study duration"
          suffix="h"
          inputMode="numeric"
          defaultValue={rate?.durationHours ?? ""}
          hint="Blank for any duration."
          result={result}
        />
        <TextField
          name="price"
          label="Price (before GST)"
          suffix="₹"
          inputMode="decimal"
          required
          defaultValue={rate?.price ?? ""}
          result={result}
        />
        <SelectField
          name="basis"
          label="Charged"
          required
          defaultValue={rate?.basis ?? "per_study"}
          result={result}
        >
          {RATE_BASES.map((b) => (
            <option key={b} value={b}>
              {RATE_BASIS_LABELS[b]}
            </option>
          ))}
        </SelectField>
      </div>
      <TextField name="notes" label="Note" defaultValue={rate?.notes ?? ""} result={result} />
      <FormMessage result={result} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

export function RetireRateButton({ id }: { id: string }) {
  const { result, pending, onSubmit } = useFormAction(retireRateAction);
  return (
    <form onSubmit={onSubmit} className="inline">
      <input type="hidden" name="rateId" value={id} />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={pending}
        aria-label="Remove this rate"
        title={result && !result.ok ? result.error : "Remove this rate"}
      >
        <Trash2 aria-hidden="true" />
      </Button>
    </form>
  );
}
