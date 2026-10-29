"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form-controls";
import { FormMessage, SelectField, TextField, useFormAction } from "@/components/ui/form-kit";
import {
  EQUIPMENT_TYPE_INFO,
  EQUIPMENT_TYPES,
  type EquipmentType,
} from "@/domain/clients/equipment-types";

import { saveEquipmentAction, setEquipmentActiveAction } from "../../actions";

export type EquipmentFormValues = {
  id: string;
  siteId: string;
  departmentId: string;
  code: string;
  name: string;
  type: EquipmentType;
  location: string;
  make: string;
  model: string;
  serialNo: string;
  lengthM: string;
  widthM: string;
  heightM: string;
  setPointC: string;
  tempMinC: string;
  tempMaxC: string;
  rhMinPct: string;
  rhMaxPct: string;
  defaultChannels: string;
  readingIntervalMinutes: string;
  studyDurationHours: string;
  requalificationMonths: string;
  lastStudyOn: string;
  notes: string;
};

function Group({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="grid gap-6 border-t border-border pt-6 first-of-type:border-t-0 first-of-type:pt-0 md:grid-cols-[14rem_1fr]">
      <legend className="sr-only">{title}</legend>
      <div aria-hidden="true">
        <p className="text-sm font-semibold">{title}</p>
        {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </fieldset>
  );
}

export function EquipmentForm({
  companyId,
  companyRequalificationMonths,
  sites,
  departments,
  values,
  readOnly,
}: {
  companyId: string;
  companyRequalificationMonths: number;
  sites: { id: string; name: string }[];
  departments: { id: string; name: string; siteId: string }[];
  values?: EquipmentFormValues;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const { result, pending, onSubmit } = useFormAction(saveEquipmentAction);
  const [siteId, setSiteId] = useState(values?.siteId ?? sites[0]?.id ?? "");
  const [type, setType] = useState<EquipmentType | "">(values?.type ?? "");
  const siteDepartments = departments.filter((d) => d.siteId === siteId);
  const showRh =
    (type !== "" && EQUIPMENT_TYPE_INFO[type].hasRh) ||
    Boolean(values?.rhMinPct || values?.rhMaxPct);

  useEffect(() => {
    if (result?.ok && !values) router.push(`/clients/${companyId}/equipment/${result.data.id}`);
  }, [result, values, router, companyId]);

  const v = values;
  const common = { result, disabled: readOnly };

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-6 rounded-lg border border-border bg-surface p-6"
    >
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="equipmentId" value={v?.id ?? ""} />

      <Group title="Where" description="The client's site and department.">
        <SelectField
          name="siteId"
          label="Site"
          required
          value={siteId}
          onChange={(e) => setSiteId(e.currentTarget.value)}
          {...common}
        >
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          key={siteId}
          name="departmentId"
          label="Department"
          defaultValue={v?.siteId === siteId ? v.departmentId : ""}
          hint={siteDepartments.length === 0 ? "Add departments on the client's page." : undefined}
          {...common}
        >
          <option value="">No department</option>
          {siteDepartments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </SelectField>
        <TextField
          name="location"
          label="Location / room"
          placeholder="Walk In Freezer"
          defaultValue={v?.location}
          {...common}
        />
      </Group>

      <Group title="Equipment" description="As written on the client's equipment label.">
        <TextField
          name="code"
          label="Equipment ID"
          placeholder="BE-WF-02"
          required
          defaultValue={v?.code}
          {...common}
        />
        <TextField
          className="sm:col-span-2"
          name="name"
          label="Equipment name"
          placeholder="Cold Storage (Walk In Freezer)"
          required
          defaultValue={v?.name}
          {...common}
        />
        <SelectField
          name="type"
          label="Type"
          required
          value={type}
          onChange={(e) => setType(e.currentTarget.value as EquipmentType)}
          hint={
            type === ""
              ? undefined
              : EQUIPMENT_TYPE_INFO[type].study === "thermal_validation"
                ? "Thermal validation: post-calibration always required."
                : "Temperature mapping."
          }
          {...common}
        >
          <option value="" disabled>
            Choose a type
          </option>
          {EQUIPMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {EQUIPMENT_TYPE_INFO[t].label}
            </option>
          ))}
        </SelectField>
        <TextField
          name="make"
          label="Make"
          placeholder="Blue Star"
          defaultValue={v?.make}
          {...common}
        />
        <TextField name="model" label="Model" defaultValue={v?.model} {...common} />
        <TextField name="serialNo" label="Serial number" defaultValue={v?.serialNo} {...common} />
      </Group>

      <Group title="Size" description="Inside dimensions, for the sensor layout.">
        <TextField
          name="lengthM"
          label="Length"
          inputMode="decimal"
          suffix="m"
          defaultValue={v?.lengthM}
          {...common}
        />
        <TextField
          name="widthM"
          label="Width"
          inputMode="decimal"
          suffix="m"
          defaultValue={v?.widthM}
          {...common}
        />
        <TextField
          name="heightM"
          label="Height"
          inputMode="decimal"
          suffix="m"
          defaultValue={v?.heightM}
          {...common}
        />
      </Group>

      <Group
        title="Acceptance limits"
        description="Leave one side empty for a one-sided limit, e.g. not more than 25 °C."
      >
        <TextField
          name="setPointC"
          label="Set point"
          inputMode="decimal"
          suffix="°C"
          placeholder="-24"
          defaultValue={v?.setPointC}
          {...common}
        />
        <TextField
          name="tempMinC"
          label="Lowest allowed"
          inputMode="decimal"
          suffix="°C"
          placeholder="-30"
          defaultValue={v?.tempMinC}
          {...common}
        />
        <TextField
          name="tempMaxC"
          label="Highest allowed"
          inputMode="decimal"
          suffix="°C"
          placeholder="-15"
          defaultValue={v?.tempMaxC}
          {...common}
        />
        {showRh ? (
          <>
            <TextField
              name="rhMinPct"
              label="Lowest RH"
              inputMode="decimal"
              suffix="%RH"
              defaultValue={v?.rhMinPct}
              {...common}
            />
            <TextField
              name="rhMaxPct"
              label="Highest RH"
              inputMode="decimal"
              suffix="%RH"
              defaultValue={v?.rhMaxPct}
              {...common}
            />
          </>
        ) : null}
      </Group>

      <Group title="Study defaults" description="Copied into each new study; can be changed there.">
        <TextField
          name="defaultChannels"
          label="Number of loggers"
          inputMode="numeric"
          placeholder="9"
          defaultValue={v?.defaultChannels}
          {...common}
        />
        <TextField
          name="readingIntervalMinutes"
          label="Reading every"
          inputMode="numeric"
          suffix="min"
          placeholder="10"
          defaultValue={v?.readingIntervalMinutes}
          {...common}
        />
        <TextField
          name="studyDurationHours"
          label="Study duration"
          inputMode="numeric"
          suffix="hours"
          placeholder="24"
          defaultValue={v?.studyDurationHours}
          {...common}
        />
        <TextField
          name="requalificationMonths"
          label="Requalification every"
          inputMode="numeric"
          suffix="months"
          placeholder={String(companyRequalificationMonths)}
          hint={`Empty uses the client's ${companyRequalificationMonths} months.`}
          defaultValue={v?.requalificationMonths}
          {...common}
        />
        <TextField
          name="lastStudyOn"
          label="Last study ended on"
          type="date"
          hint="From the last report made before QTech."
          defaultValue={v?.lastStudyOn}
          {...common}
        />
      </Group>

      <Group title="Notes">
        <div className="sm:col-span-2 lg:col-span-3">
          <Field id="notes" label="Notes for the team">
            <Textarea id="notes" name="notes" defaultValue={v?.notes} disabled={readOnly} />
          </Field>
        </div>
      </Group>

      {readOnly ? null : (
        <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center">
          <Button type="submit" disabled={pending || (result?.ok && !values)}>
            {pending ? "Saving…" : values ? "Save changes" : "Add equipment"}
          </Button>
          <div className="flex-1">
            <FormMessage result={result} />
          </div>
        </div>
      )}
    </form>
  );
}

export function RetireEquipmentButton({
  companyId,
  equipmentId,
  code,
  active,
}: {
  companyId: string;
  equipmentId: string;
  code: string;
  active: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setRound((r) => r + 1);
      }}
    >
      <Button variant={active ? "secondary" : "primary"} onClick={() => setOpen(true)}>
        {active ? "Retire equipment" : "Bring back into use"}
      </Button>
      <DialogContent>
        <RetireForm
          key={round}
          companyId={companyId}
          equipmentId={equipmentId}
          code={code}
          active={active}
          close={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function RetireForm({
  companyId,
  equipmentId,
  code,
  active,
  close,
}: {
  companyId: string;
  equipmentId: string;
  code: string;
  active: boolean;
  close: () => void;
}) {
  const { result, pending, onSubmit } = useFormAction(setEquipmentActiveAction);
  if (result?.ok) {
    return (
      <div className="flex flex-col gap-4">
        <FormMessage result={result} />
        <DialogFooter>
          <Button onClick={close}>Done</Button>
        </DialogFooter>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{active ? `Retire ${code}?` : `Bring ${code} back into use?`}</DialogTitle>
        <DialogDescription>
          {active
            ? "Retired equipment can't be picked for new jobs. Its studies and reports stay."
            : "It can be picked for new jobs again."}
        </DialogDescription>
      </DialogHeader>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="equipmentId" value={equipmentId} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      <TextField
        name="reason"
        label="Reason"
        hint="Saved in the audit trail."
        multiline
        required
        result={result}
      />
      <FormMessage result={result} />
      <DialogFooter>
        <Button type="submit" variant={active ? "danger" : "primary"} disabled={pending}>
          {active ? "Retire" : "Bring back"}
        </Button>
      </DialogFooter>
    </form>
  );
}
