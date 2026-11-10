"use client";

import { Pencil, Plus } from "lucide-react";
import { useActionState, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form-controls";
import { checkNumberFormat, formatNumber } from "@/domain/numbering/format";
import type { ActionResult } from "@/lib/action-result";

import {
  createSiteAction,
  saveCalculationsAction,
  saveDetailsAction,
  saveNumbersAction,
  updateSiteAction,
} from "./actions";

function Feedback({ result }: { result: ActionResult | undefined }) {
  if (!result) return null;
  return result.ok ? (
    <p role="status" className="text-sm text-pass">
      {result.message}
    </p>
  ) : (
    <p role="alert" className="text-sm text-fail">
      {result.error}
    </p>
  );
}

function fieldError(result: ActionResult | undefined, name: string): string | undefined {
  return result && !result.ok ? result.fieldErrors?.[name] : undefined;
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-6 rounded-lg border border-border bg-surface p-6 md:grid-cols-[16rem_1fr]">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div>{children}</div>
    </section>
  );
}

type Details = {
  legalName: string;
  shortName: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  gstin: string;
  udyamNumber: string;
};

export function DetailsForm({ values, canEdit }: { values: Details; canEdit: boolean }) {
  const [result, action, pending] = useActionState(saveDetailsAction, undefined);
  const input = (name: keyof Details, label: string, extra?: { hint?: string; type?: string }) => (
    <Field id={name} label={label} hint={extra?.hint} error={fieldError(result, name)}>
      <Input
        id={name}
        name={name}
        type={extra?.type ?? "text"}
        defaultValue={values[name]}
        disabled={!canEdit}
        aria-invalid={fieldError(result, name) ? true : undefined}
        aria-describedby={`${name}-desc`}
      />
    </Field>
  );
  return (
    <Section
      title="Organisation"
      description="Printed on report and certificate letterheads, and on invoices tracked here."
    >
      <form action={action} className="grid gap-4 sm:grid-cols-2">
        {input("legalName", "Legal name")}
        {input("shortName", "Short name", { hint: "Used in the app and in emails." })}
        <div className="sm:col-span-2">
          <Field id="address" label="Address" error={fieldError(result, "address")}>
            <Textarea
              id="address"
              name="address"
              defaultValue={values.address}
              disabled={!canEdit}
            />
          </Field>
        </div>
        {input("phone", "Phone")}
        {input("email", "Email", { type: "email" })}
        {input("website", "Website")}
        {input("gstin", "GSTIN")}
        {input("udyamNumber", "Udyam registration (MSME)")}
        {canEdit ? (
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={pending}>
              Save organisation
            </Button>
            <Feedback result={result} />
          </div>
        ) : null}
      </form>
    </Section>
  );
}

function Preview({ format, needsSite }: { format: string; needsSite: boolean }) {
  const check = checkNumberFormat(format, { needsSite, needsKind: needsSite });
  if (!check.ok) return <p className="text-xs text-fail">{check.message}</p>;
  const year = new Date().getFullYear();
  return (
    <p className="text-xs text-muted-foreground">
      Example:{" "}
      <span className="tabular font-medium text-foreground">
        {formatNumber(format, {
          year,
          month: 3,
          sequence: 17,
          siteCode: "BHW",
          siteName: "Bhiwandi",
          kind: "PDL",
        })}
      </span>
    </p>
  );
}

export function NumberFormatsForm({
  values,
  canEdit,
}: {
  values: { jobNumberFormat: string; certificateNumberFormat: string };
  canEdit: boolean;
}) {
  const [result, action, pending] = useActionState(saveNumbersAction, undefined);
  const [job, setJob] = useState(values.jobNumberFormat);
  const [cert, setCert] = useState(values.certificateNumberFormat);
  return (
    <Section
      title="Number formats"
      description="Job and certificate numbers are generated from these. Tokens: {YYYY} {YY} {MM} {SITE} {SITE_NAME} {KIND} {SEQ:n}. Numbers restart each year. Job numbers count through the year even when they show the month; certificate numbers restart each month when the format has {MM}, and each kind (PDL, RTD, TC) counts separately when it has {KIND}."
    >
      <form action={action} className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Field
            id="jobNumberFormat"
            label="Job number"
            error={fieldError(result, "jobNumberFormat")}
          >
            <Input
              id="jobNumberFormat"
              name="jobNumberFormat"
              value={job}
              onChange={(e) => setJob(e.target.value)}
              disabled={!canEdit}
              className="font-mono"
            />
          </Field>
          <Preview format={job} needsSite={false} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Field
            id="certificateNumberFormat"
            label="Certificate number (one series per site)"
            error={fieldError(result, "certificateNumberFormat")}
          >
            <Input
              id="certificateNumberFormat"
              name="certificateNumberFormat"
              value={cert}
              onChange={(e) => setCert(e.target.value)}
              disabled={!canEdit}
              className="font-mono"
            />
          </Field>
          <Preview format={cert} needsSite />
        </div>
        {canEdit ? (
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={pending}>
              Save formats
            </Button>
            <Feedback result={result} />
          </div>
        ) : null}
      </form>
    </Section>
  );
}

type Calculations = {
  mktActivationEnergyKjMol: string;
  f0ReferenceTempC: string;
  f0ZValueC: string;
  sessionIdleMinutes: number;
};

export function CalculationsForm({ values, canEdit }: { values: Calculations; canEdit: boolean }) {
  const [result, action, pending] = useActionState(saveCalculationsAction, undefined);
  const numberInput = (name: keyof Calculations, label: string, hint: string, step: string) => (
    <Field id={name} label={label} hint={hint} error={fieldError(result, name)}>
      <Input
        id={name}
        name={name}
        type="number"
        step={step}
        inputMode="decimal"
        defaultValue={String(values[name])}
        disabled={!canEdit}
        aria-describedby={`${name}-desc`}
        className="tabular"
      />
    </Field>
  );
  return (
    <Section
      title="Calculation defaults"
      description="New studies copy these values. Changing them never changes a study already calculated."
    >
      <form action={action} className="grid gap-4 sm:grid-cols-2">
        {numberInput(
          "mktActivationEnergyKjMol",
          "MKT activation energy (kJ/mol)",
          "Standard value 83.144 (ΔH/R = 10 000 K).",
          "0.001",
        )}
        {numberInput(
          "f0ReferenceTempC",
          "F0 reference temperature (°C)",
          "Standard value 121.1 °C.",
          "0.01",
        )}
        {numberInput("f0ZValueC", "F0 z-value (°C)", "Standard value 10 °C.", "0.01")}
        {numberInput(
          "sessionIdleMinutes",
          "Sign out after inactivity (minutes)",
          "Between 5 and 240. Applies to everyone.",
          "1",
        )}
        {canEdit ? (
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={pending}>
              Save defaults
            </Button>
            <Feedback result={result} />
          </div>
        ) : null}
      </form>
    </Section>
  );
}

type SiteRow = { id: string; code: string; name: string; address: string; active: boolean };

function SiteForm({ site, onDone }: { site?: SiteRow; onDone: () => void }) {
  const [result, action, pending] = useActionState(
    site ? updateSiteAction : createSiteAction,
    undefined,
  );
  if (result?.ok) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="rounded-md bg-pass-soft px-3 py-2 text-sm text-pass">
          {result.message}
        </p>
        <DialogFooter>
          <Button onClick={onDone}>Done</Button>
        </DialogFooter>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{site ? `Edit site ${site.code}` : "Add a site"}</DialogTitle>
        <DialogDescription>
          {site
            ? "The code can't change: it is part of every certificate number issued for this site."
            : "The code appears in certificate numbers, e.g. CERT-IND-2026-0031."}
        </DialogDescription>
      </DialogHeader>
      {site ? <input type="hidden" name="siteId" value={site.id} /> : null}
      {site ? null : (
        <Field
          id="code"
          label="Code"
          hint="2–5 capital letters."
          error={fieldError(result, "code")}
          required
        >
          <Input
            id="code"
            name="code"
            maxLength={5}
            className="uppercase"
            aria-describedby="code-desc"
          />
        </Field>
      )}
      <Field id="name" label="Name" error={fieldError(result, "name")} required>
        <Input id="name" name="name" defaultValue={site?.name} />
      </Field>
      <Field id="address" label="Address">
        <Textarea id="address" name="address" defaultValue={site?.address} />
      </Field>
      {site ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={site.active} className="size-4" />
          Site is in use
        </label>
      ) : null}
      {result && !result.ok ? (
        <p role="alert" className="rounded-md bg-fail-soft px-3 py-2 text-sm text-fail">
          {result.error}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {site ? "Save site" : "Add site"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function SitesSection({ sites, canEdit }: { sites: SiteRow[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<SiteRow | "new" | null>(null);
  const [formKey, setFormKey] = useState(0);
  const close = () => {
    setEditing(null);
    setFormKey((k) => k + 1);
  };
  return (
    <Section
      title="Sites"
      description="QA Tech branches. Each site has its own certificate number series and logger fleet."
    >
      <div className="flex flex-col gap-3">
        <ul className="divide-y divide-border rounded-md border border-border">
          {sites.map((site) => (
            <li key={site.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="w-12 font-mono text-sm font-semibold">{site.code}</span>
              <span className="flex-1 text-sm">
                {site.name}
                {site.active ? null : (
                  <span className="ml-2 text-xs text-muted-foreground">(not in use)</span>
                )}
              </span>
              {canEdit ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(site)}
                  aria-label={`Edit site ${site.code}`}
                >
                  <Pencil aria-hidden="true" />
                  Edit
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {canEdit ? (
          <div>
            <Button variant="secondary" onClick={() => setEditing("new")}>
              <Plus aria-hidden="true" />
              Add site
            </Button>
          </div>
        ) : null}
      </div>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          {editing ? (
            <SiteForm key={formKey} site={editing === "new" ? undefined : editing} onDone={close} />
          ) : null}
        </DialogContent>
      </Dialog>
    </Section>
  );
}
