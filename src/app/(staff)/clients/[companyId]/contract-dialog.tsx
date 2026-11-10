"use client";

import { Pencil, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FormDialog, useCloseOnSuccess } from "@/components/ui/form-dialog";
import { FormMessage, SelectField, TextField, useFormAction } from "@/components/ui/form-kit";
import { UploadFile } from "@/components/ui/upload-file";
import { CONTRACT_TYPES, ORDER_TYPE_LABELS } from "@/domain/jobs/types";

import { saveContractAction } from "../../jobs/actions";

export type ContractValues = {
  id: string;
  kind: string;
  number: string;
  validFrom: string;
  validTo: string;
  value: string;
  notes: string;
  hasFile: boolean;
};

/** Adds or changes a client's ARC or AMC (QA Tech, Nov 2026). */
export function ContractButton({
  companyId,
  contract,
  canSeeMoney,
}: {
  companyId: string;
  contract?: ContractValues;
  canSeeMoney: boolean;
}) {
  return (
    <FormDialog
      trigger={(open) =>
        contract ? (
          <Button variant="ghost" size="sm" onClick={open} aria-label={`Edit ${contract.number}`}>
            <Pencil aria-hidden="true" />
          </Button>
        ) : (
          <Button variant="secondary" onClick={open}>
            <Plus aria-hidden="true" />
            Add ARC or AMC
          </Button>
        )
      }
    >
      {(close) => (
        <ContractForm
          companyId={companyId}
          contract={contract}
          canSeeMoney={canSeeMoney}
          close={close}
        />
      )}
    </FormDialog>
  );
}

function ContractForm({
  companyId,
  contract,
  canSeeMoney,
  close,
}: {
  companyId: string;
  contract?: ContractValues;
  canSeeMoney: boolean;
  close: () => void;
}) {
  const { result, pending, onSubmit } = useFormAction(saveContractAction);
  useCloseOnSuccess(result?.ok, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <DialogTitle>{contract ? `Contract ${contract.number}` : "New contract"}</DialogTitle>
      <DialogDescription>
        Kept once on the client, then picked on every job it covers.
      </DialogDescription>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="contractId" value={contract?.id ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="kind"
          label="Kind"
          defaultValue={contract?.kind ?? "arc"}
          result={result}
        >
          {CONTRACT_TYPES.map((k) => (
            <option key={k} value={k}>
              {ORDER_TYPE_LABELS[k]}
            </option>
          ))}
        </SelectField>
        <TextField
          name="number"
          label="Contract number"
          required
          defaultValue={contract?.number}
          result={result}
          autoComplete="off"
        />
        <TextField
          name="validFrom"
          label="Valid from"
          type="date"
          required
          defaultValue={contract?.validFrom}
          result={result}
        />
        <TextField
          name="validTo"
          label="Valid until"
          type="date"
          required
          defaultValue={contract?.validTo}
          result={result}
        />
        {canSeeMoney ? (
          <TextField
            name="value"
            label="Contract value (before GST)"
            suffix="₹"
            inputMode="decimal"
            defaultValue={contract?.value}
            result={result}
          />
        ) : null}
        <TextField
          name="notes"
          label="Notes"
          defaultValue={contract?.notes}
          result={result}
          className="sm:col-span-2"
          placeholder="e.g. covers all cold rooms at Ghotawade, 2 visits a year"
        />
      </div>
      <UploadFile
        name="fileId"
        label="Upload the copy (PDF or photo)"
        current={
          contract?.hasFile
            ? { name: "Current copy", href: `/clients/${companyId}/contracts/${contract.id}` }
            : null
        }
      />
      <FormMessage result={result} />
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Saving…" : "Save contract"}
      </Button>
    </form>
  );
}
