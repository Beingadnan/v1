"use client";

import { MapPin, Pencil, Plus, Search, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { FormDialog, useCloseOnSuccess } from "@/components/ui/form-dialog";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  CheckboxField,
  FormMessage,
  SelectField,
  TextField,
  useFormAction,
} from "@/components/ui/form-kit";
import type { GstFill } from "@/domain/clients/gst-lookup-service";
import { checkGstin } from "@/domain/clients/gstin";
import { cn } from "@/lib/utils";
import { DEFAULT_REPORT_NUMBER_FORMAT, formatReportNumber } from "@/domain/clients/report-number";

import { LinkReady } from "../users/user-dialogs";
import {
  createCompanyAction,
  inviteClientUserAction,
  lookupGstinAction,
  saveContactAction,
  saveDepartmentAction,
  saveSiteAction,
  updateCompanyAction,
} from "./actions";
import { useGstLookupEnabled } from "./gst-context";

// ---------------------------------------------------------------- GSTIN

/** Sets a form field the way typing would, so React sees the change. */
function setFieldValue(
  form: HTMLFormElement,
  name: string,
  value: string,
  onlyIfEmpty = true,
): boolean {
  const field = form.elements.namedItem(name);
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return false;
  if (!value || (onlyIfEmpty && field.value.trim() !== "")) return false;
  const proto =
    field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

/** Which form field gets which GST detail. */
type FillMap = Partial<Record<string, keyof GstFill>>;

/**
 * GSTIN with a live check: shows the state and PAN it contains, or what looks
 * wrong. When the GST lookup is set up, a valid GSTIN fetches the registered
 * details and fills the empty fields named in `fill` (never overwriting typing).
 */
function GstinField({
  label = "GSTIN",
  defaultValue,
  result,
  fill,
}: {
  label?: string;
  defaultValue?: string;
  result: Parameters<typeof TextField>[0]["result"];
  fill: FillMap;
}) {
  const lookupEnabled = useGstLookupEnabled();
  const [value, setValue] = useState(defaultValue ?? "");
  const [lookup, setLookup] = useState<
    | { state: "idle" }
    | { state: "loading"; gstin: string }
    | { state: "done"; fill: GstFill; filled: number }
    | { state: "error"; message: string }
  >({ state: "idle" });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const triedRef = useRef<string | null>(defaultValue?.toUpperCase() ?? null);

  const gstin = value.trim().toUpperCase();
  const check = gstin.length >= 15 ? checkGstin(gstin) : null;
  const hint = !gstin
    ? lookupEnabled
      ? "Type the GSTIN first: the company's registered name and address are filled in for you."
      : "Optional. The state is read from it."
    : !check
      ? `${gstin.length} of 15 characters`
      : check.ok
        ? `${check.state} · PAN ${check.pan}`
        : check.message;

  async function runLookup(target: string) {
    triedRef.current = target;
    setLookup({ state: "loading", gstin: target });
    const response = await lookupGstinAction(target);
    if (!response.ok) {
      setLookup({ state: "error", message: response.error });
      return;
    }
    const form = inputRef.current?.form;
    let filled = 0;
    if (form) {
      for (const [field, key] of Object.entries(fill)) {
        if (key && setFieldValue(form, field, String(response.data[key] ?? ""))) filled += 1;
      }
    }
    setLookup({ state: "done", fill: response.data, filled });
  }

  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <TextField
            ref={inputRef}
            name="gstin"
            label={label}
            defaultValue={defaultValue}
            result={result}
            hint={hint}
            autoComplete="off"
            onChange={(e) => {
              const next = e.currentTarget.value.trim().toUpperCase();
              setValue(next);
              const found = next.length === 15 ? checkGstin(next) : null;
              if (found?.ok && fill.state === "state") {
                // Even without the lookup service, the state comes from the GSTIN itself.
                const form = e.currentTarget.form;
                if (form) setFieldValue(form, "state", found.state);
              }
              // A real-looking GSTIN is looked up once, straight away.
              if (lookupEnabled && found?.ok && triedRef.current !== next) void runLookup(next);
            }}
          />
        </div>
        {lookupEnabled && gstin.length === 15 ? (
          <Button
            type="button"
            variant="secondary"
            className="mb-[1.375rem]"
            disabled={lookup.state === "loading"}
            onClick={() => void runLookup(gstin)}
          >
            <Search aria-hidden="true" />
            {lookup.state === "loading" ? "Looking up…" : "Fill from GST"}
          </Button>
        ) : null}
      </div>
      {lookup.state === "done" ? (
        <div
          role="status"
          className={cn(
            "rounded-md px-3 py-2 text-sm",
            lookup.fill.status && lookup.fill.status.toLowerCase() !== "active"
              ? "bg-attention-soft text-attention"
              : "bg-brand-soft text-primary",
          )}
        >
          <p className="font-medium">
            {lookup.fill.legalName}
            {lookup.fill.tradeName && lookup.fill.tradeName !== lookup.fill.legalName
              ? ` (trading as ${lookup.fill.tradeName})`
              : ""}
          </p>
          <p className="text-xs">
            GST status: {lookup.fill.status || "unknown"}
            {lookup.fill.constitution ? ` · ${lookup.fill.constitution}` : ""}
            {lookup.fill.registeredOn ? ` · registered ${lookup.fill.registeredOn}` : ""}
            {" · "}
            {lookup.filled > 0
              ? `filled ${lookup.filled} empty field${lookup.filled === 1 ? "" : "s"} — check them`
              : "nothing to fill (fields already typed)"}
            {lookup.fill.status && lookup.fill.status.toLowerCase() !== "active"
              ? ". This GSTIN is not active: check with the client before adding."
              : ""}
          </p>
        </div>
      ) : lookup.state === "error" ? (
        <p role="alert" className="text-xs text-attention">
          {lookup.message}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- company

export type CompanyValues = {
  id: string;
  name: string;
  code: string;
  gstin: string;
  address: string;
  notes: string;
  postCalRequired: boolean;
  requalificationMonths: number;
  reportNumberFormat: string;
  active: boolean;
};

function ReportNumberPreview({ format, code }: { format: string; code: string }) {
  let example: string;
  try {
    example = formatReportNumber(format, {
      clientCode: code || "Client",
      siteCode: "Seawoods",
      department: "BA",
      equipmentName: "Cold Storage (Walk In Freezer)",
      equipmentCode: "BE-WF-02",
      month: 5,
      year: 2026,
    });
  } catch {
    example = "—";
  }
  return (
    <p className="text-xs text-muted-foreground">
      Example: <span className="font-medium text-foreground">{example}</span>
    </p>
  );
}

function CompanyFields({
  values,
  result,
}: {
  values?: CompanyValues;
  result: Parameters<typeof TextField>[0]["result"];
}) {
  const [format, setFormat] = useState(values?.reportNumberFormat ?? DEFAULT_REPORT_NUMBER_FORMAT);
  const [code, setCode] = useState(values?.code ?? "");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <GstinField
        defaultValue={values?.gstin}
        result={result}
        fill={{
          name: "legalName",
          code: "shortName",
          address: "address",
          siteName: "city",
          siteAddress: "address",
          siteCity: "city",
          siteState: "state",
        }}
      />
      <TextField
        className="sm:col-span-2"
        name="name"
        label="Company name"
        placeholder="Watson Pharma Pvt Limited"
        defaultValue={values?.name}
        result={result}
        required
      />
      <TextField
        name="code"
        label="Short name"
        hint="Used in report numbers, e.g. Watson."
        defaultValue={values?.code}
        onChange={(e) => setCode(e.currentTarget.value)}
        result={result}
        required
      />
      <TextField
        className="sm:col-span-2"
        name="address"
        label="Registered address"
        multiline
        defaultValue={values?.address}
        result={result}
      />
      <TextField
        name="requalificationMonths"
        label="Requalification every"
        type="number"
        min={1}
        max={60}
        suffix="months"
        defaultValue={values?.requalificationMonths ?? 12}
        result={result}
        required
      />
      <div className="sm:col-span-2">
        <CheckboxField
          name="postCalRequired"
          label="Client SOP requires post-calibration for temperature mapping"
          hint="Thermal validation (autoclave, oven) always needs post-calibration."
          defaultChecked={values?.postCalRequired}
        />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <TextField
          name="reportNumberFormat"
          label="Report number format"
          hint="Parts: {CLIENT} {SITE} {DEPT} {MM} {YY} {YYYY} {EQUIPMENT} {EQUIPMENT_ID}"
          defaultValue={format}
          onChange={(e) => setFormat(e.currentTarget.value)}
          result={result}
          required
        />
        <ReportNumberPreview format={format} code={code} />
      </div>
      <TextField
        className="sm:col-span-2"
        name="notes"
        label="Notes"
        multiline
        defaultValue={values?.notes}
        result={result}
      />
    </div>
  );
}

export function AddClientButton() {
  return (
    <FormDialog
      wide
      trigger={(open) => (
        <Button onClick={open}>
          <Plus aria-hidden="true" />
          Add client
        </Button>
      )}
    >
      {() => <AddClientForm />}
    </FormDialog>
  );
}

function AddClientForm() {
  const router = useRouter();
  const { result, pending, onSubmit } = useFormAction(createCompanyAction);
  useEffect(() => {
    if (result?.ok) router.push(`/clients/${result.data.id}`);
  }, [result, router]);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <DialogHeader>
        <DialogTitle>Add a client</DialogTitle>
        <DialogDescription>
          The company QA Tech works for. Add its first site now; more sites, departments and
          equipment come next on the client&apos;s page.
        </DialogDescription>
      </DialogHeader>
      <CompanyFields result={result} />
      <fieldset className="grid gap-4 rounded-md border border-border p-4 sm:grid-cols-2">
        <legend className="flex items-center gap-1.5 px-1 text-sm font-semibold">
          <MapPin className="size-4 text-primary" aria-hidden="true" /> First site
        </legend>
        <TextField name="siteName" label="Site name" placeholder="Seawoods" result={result} />
        <TextField
          name="siteCode"
          label="Site code"
          hint="For report numbers. Leave empty to use the name."
          result={result}
        />
        <TextField
          className="sm:col-span-2"
          name="siteAddress"
          label="Site address"
          multiline
          result={result}
        />
        <TextField name="siteCity" label="City" result={result} />
        <TextField name="siteState" label="State" result={result} />
      </fieldset>
      <FormMessage result={result && !result.ok ? result : undefined} />
      {result && !result.ok && result.error.includes("looks like the same company") ? (
        <CheckboxField name="allowSimilar" label="This is a different company" />
      ) : null}
      <DialogFooter>
        <Button type="submit" disabled={pending || result?.ok}>
          {pending || result?.ok ? "Saving…" : "Add client"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function EditCompanyButton({ values }: { values: CompanyValues }) {
  return (
    <FormDialog
      wide
      trigger={(open) => (
        <Button variant="secondary" onClick={open}>
          <Pencil aria-hidden="true" />
          Edit details
        </Button>
      )}
    >
      {(close) => <EditCompanyForm values={values} close={close} />}
    </FormDialog>
  );
}

function EditCompanyForm({ values, close }: { values: CompanyValues; close: () => void }) {
  const { result, pending, onSubmit } = useFormAction(updateCompanyAction);
  useCloseOnSuccess(result?.ok, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <DialogHeader>
        <DialogTitle>Edit {values.name}</DialogTitle>
        <DialogDescription>
          Changes apply to new jobs and reports. Reports already issued keep their numbers.
        </DialogDescription>
      </DialogHeader>
      <input type="hidden" name="companyId" value={values.id} />
      <CompanyFields values={values} result={result} />
      <ActiveSelect defaultActive={values.active} noun="client" />
      <FormMessage result={result} />
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

function ActiveSelect({ defaultActive, noun }: { defaultActive: boolean; noun: string }) {
  return (
    <SelectField
      name="active"
      label="Status"
      hint={`An inactive ${noun} stays in history but can't be picked for new work.`}
      defaultValue={defaultActive ? "true" : "false"}
    >
      <option value="true">Active</option>
      <option value="false">Inactive</option>
    </SelectField>
  );
}

// ---------------------------------------------------------------- sites

export type SiteValues = {
  id: string;
  name: string;
  code: string;
  address: string;
  city: string;
  state: string;
  gstin: string;
  active: boolean;
};

export function SiteDialog({ companyId, site }: { companyId: string; site?: SiteValues }) {
  return (
    <FormDialog
      trigger={(open) =>
        site ? (
          <Button variant="ghost" size="sm" onClick={open} aria-label={`Edit site ${site.name}`}>
            <Pencil aria-hidden="true" />
            Edit
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={open}>
            <Plus aria-hidden="true" />
            Add site
          </Button>
        )
      }
    >
      {(close) => <SiteForm companyId={companyId} site={site} close={close} />}
    </FormDialog>
  );
}

function SiteForm({
  companyId,
  site,
  close,
}: {
  companyId: string;
  site?: SiteValues;
  close: () => void;
}) {
  const { result, pending, onSubmit } = useFormAction(saveSiteAction);
  useCloseOnSuccess(result?.ok, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{site ? `Edit site ${site.name}` : "Add a site"}</DialogTitle>
        <DialogDescription>A client location or region, e.g. Seawoods.</DialogDescription>
      </DialogHeader>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="siteId" value={site?.id ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2">
        <GstinField
          label="GSTIN for this site"
          defaultValue={site?.gstin}
          result={result}
          fill={{ address: "address", city: "city", state: "state" }}
        />
        <TextField
          name="name"
          label="Site name"
          defaultValue={site?.name}
          result={result}
          required
        />
        <TextField
          name="code"
          label="Site code"
          hint="Used in report numbers."
          defaultValue={site?.code}
          result={result}
          required
        />
        <TextField
          className="sm:col-span-2"
          name="address"
          label="Address"
          multiline
          defaultValue={site?.address}
          result={result}
        />
        <TextField name="city" label="City" defaultValue={site?.city} result={result} />
        <TextField name="state" label="State" defaultValue={site?.state} result={result} />
      </div>
      {site ? <ActiveSelect defaultActive={site.active} noun="site" /> : null}
      <FormMessage result={result} />
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {site ? "Save site" : "Add site"}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------- departments

export function DepartmentDialog({
  companyId,
  siteId,
  siteName,
  department,
}: {
  companyId: string;
  siteId: string;
  siteName: string;
  department?: { id: string; name: string; active: boolean };
}) {
  return (
    <FormDialog
      trigger={(open) =>
        department ? (
          <button
            type="button"
            onClick={open}
            className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs hover:border-primary hover:text-primary data-[inactive=true]:text-muted-foreground data-[inactive=true]:line-through"
            data-inactive={!department.active}
            aria-label={`Edit department ${department.name}`}
          >
            {department.name}
          </button>
        ) : (
          <button
            type="button"
            onClick={open}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-input px-2.5 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
          >
            <Plus className="size-3" aria-hidden="true" />
            Department
            <span className="sr-only"> at {siteName}</span>
          </button>
        )
      }
    >
      {(close) => (
        <DepartmentForm
          companyId={companyId}
          siteId={siteId}
          siteName={siteName}
          department={department}
          close={close}
        />
      )}
    </FormDialog>
  );
}

function DepartmentForm({
  companyId,
  siteId,
  siteName,
  department,
  close,
}: {
  companyId: string;
  siteId: string;
  siteName: string;
  department?: { id: string; name: string; active: boolean };
  close: () => void;
}) {
  const { result, pending, onSubmit } = useFormAction(saveDepartmentAction);
  useCloseOnSuccess(result?.ok, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>
          {department ? `Edit department ${department.name}` : `Add a department at ${siteName}`}
        </DialogTitle>
        <DialogDescription>For example BA, QC, Warehouse or Stores.</DialogDescription>
      </DialogHeader>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="departmentId" value={department?.id ?? ""} />
      <TextField
        name="name"
        label="Department name"
        defaultValue={department?.name}
        result={result}
        required
      />
      {department ? <ActiveSelect defaultActive={department.active} noun="department" /> : null}
      <FormMessage result={result} />
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {department ? "Save" : "Add department"}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------- contacts

export type ContactValues = {
  id: string;
  siteId: string | null;
  name: string;
  designation: string;
  email: string;
  phone: string;
  signatory: string | null;
  active: boolean;
};

export const SIGNATORY_LABELS: Record<string, string> = {
  reviewed_by: "Signs Reviewed By",
  approved_by: "Signs Approved By",
};

export function ContactDialog({
  companyId,
  sites,
  contact,
}: {
  companyId: string;
  sites: { id: string; name: string }[];
  contact?: ContactValues;
}) {
  return (
    <FormDialog
      trigger={(open) =>
        contact ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={open}
            aria-label={`Edit contact ${contact.name}`}
          >
            <Pencil aria-hidden="true" />
            Edit
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={open}>
            <Plus aria-hidden="true" />
            Add contact
          </Button>
        )
      }
    >
      {(close) => (
        <ContactForm companyId={companyId} sites={sites} contact={contact} close={close} />
      )}
    </FormDialog>
  );
}

function ContactForm({
  companyId,
  sites,
  contact,
  close,
}: {
  companyId: string;
  sites: { id: string; name: string }[];
  contact?: ContactValues;
  close: () => void;
}) {
  const { result, pending, onSubmit } = useFormAction(saveContactAction);
  useCloseOnSuccess(result?.ok, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{contact ? `Edit ${contact.name}` : "Add a contact"}</DialogTitle>
        <DialogDescription>
          Client QA people. Mark report signatories so their names print on reports.
        </DialogDescription>
      </DialogHeader>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="contactId" value={contact?.id ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="name" label="Name" defaultValue={contact?.name} result={result} required />
        <TextField
          name="designation"
          label="Designation"
          placeholder="Manager QA"
          defaultValue={contact?.designation}
          result={result}
        />
        <TextField
          name="email"
          label="Email"
          type="email"
          defaultValue={contact?.email}
          result={result}
        />
        <TextField
          name="phone"
          label="Phone"
          type="tel"
          defaultValue={contact?.phone}
          result={result}
        />
        <SelectField
          name="siteId"
          label="Site"
          defaultValue={contact?.siteId ?? ""}
          result={result}
        >
          <option value="">All sites</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          name="signatory"
          label="Report signatory"
          defaultValue={contact?.signatory ?? ""}
          result={result}
        >
          <option value="">Not a signatory</option>
          <option value="reviewed_by">Reviewed By</option>
          <option value="approved_by">Approved By</option>
        </SelectField>
      </div>
      {contact ? <ActiveSelect defaultActive={contact.active} noun="contact" /> : null}
      <FormMessage result={result} />
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {contact ? "Save contact" : "Add contact"}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------- client users

export function InviteClientUserButton({
  companyId,
  companyName,
}: {
  companyId: string;
  companyName: string;
}) {
  return (
    <FormDialog
      trigger={(open) => (
        <Button variant="secondary" size="sm" onClick={open}>
          <UserPlus aria-hidden="true" />
          Invite client user
        </Button>
      )}
    >
      {(close) => (
        <InviteClientUserForm companyId={companyId} companyName={companyName} close={close} />
      )}
    </FormDialog>
  );
}

function InviteClientUserForm({
  companyId,
  companyName,
  close,
}: {
  companyId: string;
  companyName: string;
  close: () => void;
}) {
  const { result, pending, onSubmit } = useFormAction(inviteClientUserAction);
  if (result?.ok) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Invitation ready</DialogTitle>
        </DialogHeader>
        <LinkReady data={result.data} purpose="invite" />
        <DialogFooter>
          <Button onClick={close}>Done</Button>
        </DialogFooter>
      </>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Invite a {companyName} user</DialogTitle>
        <DialogDescription>
          Client users only ever see {companyName}&apos;s reports. They review and sign reports once
          reports are released to clients.
        </DialogDescription>
      </DialogHeader>
      <input type="hidden" name="companyId" value={companyId} />
      <TextField name="name" label="Full name" result={result} required autoComplete="off" />
      <TextField
        name="email"
        label="Email"
        type="email"
        result={result}
        required
        autoComplete="off"
      />
      <SelectField name="role" label="Role" defaultValue="client_qa" result={result} required>
        <option value="client_qa">Client QA (signs Reviewed By)</option>
        <option value="client_qa_head">
          Client QA head (signs Approved By, decides deviations)
        </option>
      </SelectField>
      <FormMessage result={result} />
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create invitation"}
        </Button>
      </DialogFooter>
    </form>
  );
}
