"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { FormMessage, SelectField, TextField, useFormAction } from "@/components/ui/form-kit";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/format";

import { createCalibrationAction } from "../../actions";

type Option = { id: string; label: string };
type Master = {
  id: string;
  code: string;
  label: string;
  serialNo: string;
  certificate: string | null;
  validUntil: string | null;
  usable: boolean;
};

export function NewCalibrationForm({
  today,
  sites,
  companies,
  masters,
  template,
  recent,
  defaultSiteId,
}: {
  defaultSiteId?: string;
  today: string;
  sites: Option[];
  companies: Option[];
  masters: Master[];
  template: {
    id: string;
    siteId: string | null;
    customerCompanyId: string | null;
    instruments: string;
  } | null;
  recent: { id: string; number: string; title: string }[];
}) {
  const { result, pending, onSubmit } = useFormAction(createCalibrationAction);
  const [list, setList] = useState(template?.instruments ?? "");
  const count = list.split(/[\n\r,;\t]+/).filter((t) => t.trim()).length;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      {template ? <input type="hidden" name="fromCertificateId" value={template.id} /> : null}
      <section className="grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField
          name="siteId"
          label="QA Tech site"
          required
          result={result}
          defaultValue={defaultSiteId}
        >
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </SelectField>
        <TextField
          name="calibratedOn"
          label="Date of calibration"
          type="date"
          required
          result={result}
          defaultValue={today}
          max={today}
        />
        <TextField
          name="validUntil"
          label="Due date"
          type="date"
          result={result}
          hint="Leave empty: one interval later, less a day."
        />
        <SelectField
          name="customerCompanyId"
          label="Customer"
          result={result}
          defaultValue={template?.customerCompanyId ?? ""}
          hint="QA Tech for its own loggers; a client for pre/post calibration."
        >
          <option value="">QA Tech (own instruments)</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </SelectField>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <TextField
            name="instruments"
            label="Instruments to calibrate"
            multiline
            required
            result={result}
            defaultValue={template?.instruments}
            hint={`${count ? `${count} entered. ` : ""}Paste QA Tech IDs or serial numbers from Excel, one per line. One make and model per certificate, up to 40.`}
            onInput={(e: React.FormEvent<HTMLInputElement>) =>
              setList((e.target as HTMLInputElement).value)
            }
          />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Master standards used</legend>
          {masters.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No master standards registered. Add them in the register with “Use: Master standard”
              and record their certificates.
            </p>
          ) : (
            masters.map((m) => (
              <label
                key={m.id}
                htmlFor={`master-${m.id}`}
                className="flex items-start gap-3 rounded-md border border-border p-3 text-sm"
              >
                <input
                  id={`master-${m.id}`}
                  type="checkbox"
                  name="masterIds"
                  value={m.id}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="font-medium">
                    {m.code} <span className="font-normal text-muted-foreground">{m.label}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {m.certificate ?? "No valid certificate"}
                    {m.usable ? (
                      <StatusBadge tone="pass">Valid to {formatDate(m.validUntil)}</StatusBadge>
                    ) : (
                      <StatusBadge tone="fail">
                        {m.validUntil ? `Expired ${formatDate(m.validUntil)}` : "Not calibrated"}
                      </StatusBadge>
                    )}
                  </span>
                </span>
              </label>
            ))
          )}
          <p className="text-xs text-muted-foreground">
            {template
              ? "Leave all unticked to use the same masters as the certificate copied. "
              : ""}
            A master is refused unless its certificate covers the calibration date.
          </p>
        </fieldset>
      </section>

      <FormMessage result={result} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Starting…" : "Start certificate"}
        </Button>
        {!template && recent.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-primary">
              Or calibrate again from an earlier certificate
            </summary>
            <ul className="mt-2 flex flex-col gap-1">
              {recent.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/instruments/certificates/new?from=${r.id}`}
                    className="text-primary hover:underline"
                  >
                    {r.number}
                  </Link>{" "}
                  <span className="text-muted-foreground">{r.title}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </form>
  );
}
