"use client";

import { FileCheck2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FormDialog, useCloseOnSuccess } from "@/components/ui/form-dialog";
import { FormMessage, useFormAction } from "@/components/ui/form-kit";
import { UploadFile } from "@/components/ui/upload-file";

import { recordOrderAction } from "../actions";
import { OrderFields, type ContractOption } from "../order-fields";

type Values = {
  orderType: string;
  contractId: string;
  poNumber: string;
  poDate: string;
  poValue: string;
};

/** Records the client's order when it comes, at any stage: number, value, copy or contract. */
export function RecordOrderButton({
  jobId,
  values,
  contracts,
  canSeeMoney,
  start,
  file,
  pending,
}: {
  jobId: string;
  values: Values;
  contracts: ContractOption[];
  canSeeMoney: boolean;
  start: string;
  file: { name: string } | null;
  /** Still to come: the button says so. */
  pending: boolean;
}) {
  return (
    <FormDialog
      wide
      trigger={(open) => (
        <Button variant={pending ? "primary" : "secondary"} size="sm" onClick={open}>
          <FileCheck2 aria-hidden="true" />
          {pending ? "Record the order" : "Change the order"}
        </Button>
      )}
    >
      {(close) => (
        <OrderForm
          jobId={jobId}
          values={values}
          contracts={contracts}
          canSeeMoney={canSeeMoney}
          start={start}
          file={file}
          close={close}
        />
      )}
    </FormDialog>
  );
}

function OrderForm({
  jobId,
  values,
  contracts,
  canSeeMoney,
  start,
  file,
  close,
}: {
  jobId: string;
  values: Values;
  contracts: ContractOption[];
  canSeeMoney: boolean;
  start: string;
  file: { name: string } | null;
  close: () => void;
}) {
  const { result, pending, onSubmit } = useFormAction(recordOrderAction);
  useCloseOnSuccess(result?.ok, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <DialogTitle>Client&apos;s order</DialogTitle>
      <DialogDescription>
        The PO or SRF with its copy, or the ARC/AMC the job is done under. It can be recorded at any
        stage until the job is closed.
      </DialogDescription>
      <input type="hidden" name="jobId" value={jobId} />
      <OrderFields
        contracts={contracts}
        result={result}
        canSeeMoney={canSeeMoney}
        values={values}
        start={start}
      />
      <UploadFile
        name="fileId"
        label="Upload the copy (PDF or photo)"
        current={file ? { name: file.name, href: `/jobs/${jobId}/order` } : null}
      />
      <FormMessage result={result} />
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Saving…" : "Save the order"}
      </Button>
    </form>
  );
}
