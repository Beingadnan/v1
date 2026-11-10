"use client";

import { useState } from "react";

import { SelectField, TextField } from "@/components/ui/form-kit";
import {
  isContractType,
  ORDER_TYPE_LABELS,
  ORDER_TYPE_SHORT,
  ORDER_TYPES,
  type OrderType,
} from "@/domain/jobs/types";
import type { ActionResult } from "@/lib/action-result";

export type ContractOption = {
  id: string;
  kind: string;
  number: string;
  validFrom: string;
  validTo: string;
};

const dmy = (iso: string) => iso.split("-").reverse().join(".");

/**
 * The client's order on a job: PO or SRF with its number, date and value, or
 * the client's ARC/AMC picked from their contracts (QA Tech, Nov 2026). All of
 * it may be left for later.
 */
export function OrderFields({
  contracts,
  result,
  canSeeMoney,
  values,
  start,
}: {
  contracts: ContractOption[];
  result: ActionResult<unknown> | undefined;
  canSeeMoney: boolean;
  values?: {
    orderType: string;
    poNumber: string;
    poDate: string;
    poValue: string;
    contractId: string;
  };
  /** The job's first day: contracts covering it are listed first. */
  start?: string;
}) {
  const [type, setType] = useState<OrderType>(
    (ORDER_TYPES as readonly string[]).includes(values?.orderType ?? "")
      ? (values!.orderType as OrderType)
      : "po",
  );
  const contract = isContractType(type);
  const ofKind = contracts
    .filter((c) => c.kind === type)
    .sort(
      (a, b) =>
        Number(covers(b, start)) - Number(covers(a, start)) || b.validTo.localeCompare(a.validTo),
    );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField
        name="orderType"
        label="Client's order"
        value={type}
        onChange={(e) => setType(e.target.value as OrderType)}
        result={result}
        className="sm:col-span-2"
      >
        {ORDER_TYPES.map((t) => (
          <option key={t} value={t}>
            {ORDER_TYPE_LABELS[t]}
          </option>
        ))}
      </SelectField>
      {contract ? (
        <SelectField
          name="contractId"
          label={`The client's ${ORDER_TYPE_SHORT[type]}`}
          defaultValue={values?.contractId ?? ofKind.find((c) => covers(c, start))?.id ?? ""}
          result={result}
          hint={
            ofKind.length === 0
              ? `This client has no ${ORDER_TYPE_SHORT[type]} yet: add it on the client's page, or leave it for later.`
              : "Leave it for later if it hasn't come yet."
          }
          className="sm:col-span-2"
        >
          <option value="">Not yet</option>
          {ofKind.map((c) => (
            <option key={c.id} value={c.id}>
              {c.number} ({dmy(c.validFrom)}–{dmy(c.validTo)})
            </option>
          ))}
        </SelectField>
      ) : null}
      <TextField
        name="poNumber"
        label={contract ? "Release order number (if any)" : `${ORDER_TYPE_SHORT[type]} number`}
        defaultValue={values?.poNumber}
        result={result}
        autoComplete="off"
        hint={contract ? undefined : "Leave empty if it hasn't come: you'll be reminded."}
      />
      <TextField
        name="poDate"
        label={`${contract ? "Release order" : ORDER_TYPE_SHORT[type]} date`}
        type="date"
        defaultValue={values?.poDate}
        result={result}
      />
      {canSeeMoney ? (
        <TextField
          name="poValue"
          label="Order value (before GST)"
          suffix="₹"
          inputMode="decimal"
          defaultValue={values?.poValue}
          result={result}
        />
      ) : null}
    </div>
  );
}

function covers(c: ContractOption, start?: string) {
  return !!start && c.validFrom <= start && c.validTo >= start;
}
