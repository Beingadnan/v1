"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

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
import {
  CheckboxField,
  FormMessage,
  SelectField,
  TextField,
  useFormAction,
} from "@/components/ui/form-kit";
import {
  EQUIPMENT_TYPE_INFO,
  EQUIPMENT_TYPES,
  isArea,
  type EquipmentType,
} from "@/domain/clients/equipment-types";
import {
  STUDY_CYCLE_LABELS,
  STUDY_CYCLES,
  suggestLoggerCount,
  type TypeDefaults,
} from "@/domain/clients/study-defaults";

import { saveEquipmentAction, setEquipmentActiveAction } from "../../actions";

export type EquipmentFormValues = {
  /** Empty when the form starts a new item from an existing one ("Add similar"). */
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
  cycles: string[];
  seasonalMapping: boolean;
  notes: string;
};

/** Fields a type's defaults can fill, in the order they appear. */
const DEFAULT_FIELDS = [
  "setPointC",
  "tempMinC",
  "tempMaxC",
  "rhMinPct",
  "rhMaxPct",
  "defaultChannels",
  "readingIntervalMinutes",
  "studyDurationHours",
  "requalificationMonths",
] as const;

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
  startAt,
  typeDefaults,
  readOnly,
  onSaved,
}: {
  companyId: string;
  companyRequalificationMonths: number;
  sites: { id: string; name: string }[];
  departments: { id: string; name: string; siteId: string }[];
  values?: EquipmentFormValues;
  /** A new item's site and department, when added from that folder of the client page. */
  startAt?: { siteId: string; departmentId: string };
  /** QA Tech's defaults per type (Settings); fill empty fields when a type is chosen. */
  typeDefaults: Record<EquipmentType, TypeDefaults>;
  readOnly?: boolean;
  /** In a dialog (a new job): called with the saved item instead of opening its page. */
  onSaved?: (id: string) => void;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const { result, pending, onSubmit } = useFormAction(saveEquipmentAction);
  const isNew = !values?.id;
  const [siteId, setSiteId] = useState(values?.siteId ?? startAt?.siteId ?? sites[0]?.id ?? "");
  const [type, setType] = useState<EquipmentType | "">(values?.type ?? "");
  // Equipment (a box with a door) or a room or store mapped as an area.
  const [kind, setKind] = useState<"equipment" | "area">(
    isArea(values?.type) ? "area" : "equipment",
  );
  const area = kind === "area";
  const types = EQUIPMENT_TYPES.filter((t) => isArea(t) === area);
  const [filledFrom, setFilledFrom] = useState<{ type: EquipmentType; count: number } | null>(null);
  const [size, setSize] = useState({
    lengthM: values?.lengthM ?? "",
    widthM: values?.widthM ?? "",
    heightM: values?.heightM ?? "",
  });
  const siteDepartments = departments.filter((d) => d.siteId === siteId);
  const showRh =
    (type !== "" && EQUIPMENT_TYPE_INFO[type].hasRh) ||
    Boolean(values?.rhMinPct || values?.rhMaxPct);
  const suggestion = suggestLoggerCount(
    {
      lengthM: Number(size.lengthM) || null,
      widthM: Number(size.widthM) || null,
      heightM: Number(size.heightM) || null,
    },
    type === "room" ? "room" : "box",
  );

  useEffect(() => {
    if (!result?.ok) return;
    if (onSaved) onSaved(result.data.id);
    else if (isNew) router.push(`/clients/${companyId}/equipment/${result.data.id}`);
  }, [result, isNew, router, companyId, onSaved]);

  /**
   * Choosing a type on a new item fills the empty fields from that type's
   * defaults (never overwriting what was typed), ticks its usual cycles if none
   * are ticked yet, and says how many fields it filled.
   */
  function applyDefaults(next: EquipmentType) {
    const form = formRef.current;
    if (!form || !isNew) return;
    const defaults = typeDefaults[next];
    let count = 0;
    const tempTyped = ["setPointC", "tempMinC", "tempMaxC"].some((n) => inputValue(form, n) !== "");
    const rhTyped = ["rhMinPct", "rhMaxPct"].some((n) => inputValue(form, n) !== "");
    for (const name of DEFAULT_FIELDS) {
      const value = defaults[name];
      if (value === null) continue;
      if (tempTyped && ["setPointC", "tempMinC", "tempMaxC"].includes(name)) continue;
      if (rhTyped && ["rhMinPct", "rhMaxPct"].includes(name)) continue;
      const input = form.elements.namedItem(name);
      if (input instanceof HTMLInputElement && input.value === "") {
        input.value = String(value);
        count += 1;
      }
    }
    const boxes = [...form.querySelectorAll<HTMLInputElement>('input[name="cycles"]')];
    if (!boxes.some((b) => b.checked)) {
      for (const box of boxes) box.checked = defaults.cycles.includes(box.value as never);
      if (defaults.cycles.length) count += 1;
    }
    const seasonal = form.elements.namedItem("seasonalMapping");
    if (seasonal instanceof HTMLInputElement) seasonal.checked = defaults.seasonalMapping;
    setFilledFrom(count > 0 ? { type: next, count } : null);
  }

  const v = values;
  const common = { result, disabled: readOnly };

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      onInput={(e) => {
        const target = e.target as HTMLInputElement;
        if (target.name === "lengthM" || target.name === "widthM" || target.name === "heightM") {
          setSize((current) => ({ ...current, [target.name]: target.value }));
        }
      }}
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
          defaultValue={
            v?.siteId === siteId
              ? v.departmentId
              : startAt?.siteId === siteId
                ? startAt.departmentId
                : ""
          }
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

      <Group
        title={area ? "Room or area" : "Equipment"}
        description={
          area
            ? "As the client names the room, e.g. on its door or in their SOP."
            : "As written on the client's equipment label."
        }
      >
        <fieldset className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-3">
          <legend className="mb-1.5 text-sm font-medium">What is mapped</legend>
          {(
            [
              ["equipment", "Equipment", "Fridge, freezer, chamber, autoclave…"],
              ["area", "Room or area", "Dispensing, sampling, store, warehouse"],
            ] as const
          ).map(([value, title, hint]) => (
            <label
              key={value}
              className={`flex min-w-48 flex-1 cursor-pointer flex-col rounded-md border px-3 py-2 text-sm ${
                kind === value ? "border-primary bg-brand-soft" : "border-input"
              }`}
            >
              <span className="flex items-center gap-2 font-medium">
                <input
                  type="radio"
                  name="mappedKind"
                  value={value}
                  checked={kind === value}
                  disabled={readOnly}
                  onChange={() => {
                    setKind(value);
                    if (type !== "" && isArea(type) !== (value === "area")) setType("");
                  }}
                  className="size-4 accent-primary"
                />
                {title}
              </span>
              <span className="text-xs text-muted-foreground">{hint}</span>
            </label>
          ))}
        </fieldset>
        <TextField
          name="code"
          label={area ? "Room ID" : "Equipment ID"}
          placeholder={area ? "WH013" : "BE-WF-02"}
          required
          defaultValue={v?.code}
          {...common}
        />
        <TextField
          className="sm:col-span-2"
          name="name"
          label={area ? "Room name" : "Equipment name"}
          placeholder={area ? "Dispensing-2" : "Cold Storage (Walk In Freezer)"}
          required
          defaultValue={v?.name}
          {...common}
        />
        <SelectField
          name="type"
          label="Type"
          required
          value={type}
          onChange={(e) => {
            const next = e.currentTarget.value as EquipmentType;
            // Render the RH fields for the new type first, then fill them.
            flushSync(() => setType(next));
            applyDefaults(next);
          }}
          hint={
            type === ""
              ? undefined
              : EQUIPMENT_TYPE_INFO[type].study === "thermal_validation"
                ? "Thermal validation: post-calibration always required."
                : type === "room"
                  ? "Mapped at working height along the walls, drawn as a floor plan."
                  : "Temperature mapping."
          }
          {...common}
        >
          <option value="" disabled>
            Choose a type
          </option>
          {types.map((t) => (
            <option key={t} value={t}>
              {EQUIPMENT_TYPE_INFO[t].label}
            </option>
          ))}
        </SelectField>
        {area ? (
          // A room has no make or model; keep whatever an older record holds.
          <>
            <input type="hidden" name="make" value={v?.make ?? ""} />
            <input type="hidden" name="model" value={v?.model ?? ""} />
            <input type="hidden" name="serialNo" value={v?.serialNo ?? ""} />
          </>
        ) : (
          <>
            <TextField
              name="make"
              label="Make"
              placeholder="Blue Star"
              defaultValue={v?.make}
              {...common}
            />
            <TextField name="model" label="Model" defaultValue={v?.model} {...common} />
            <TextField
              name="serialNo"
              label="Serial number"
              defaultValue={v?.serialNo}
              {...common}
            />
          </>
        )}
      </Group>

      {filledFrom ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-md bg-brand-soft px-3 py-2 text-sm text-primary"
        >
          <Sparkles className="size-4 shrink-0" aria-hidden="true" />
          Filled {filledFrom.count} empty field{filledFrom.count === 1 ? "" : "s"} from the{" "}
          {EQUIPMENT_TYPE_INFO[filledFrom.type].label.toLowerCase()} defaults. Check them and change
          anything that differs for this unit.
        </p>
      ) : null}

      <Group
        title="Size"
        description={
          area
            ? "The room's length, width and ceiling height, for the floor plan."
            : "Inside dimensions, for the sensor layout."
        }
      >
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
          defaultValue={v?.setPointC}
          {...common}
        />
        <TextField
          name="tempMinC"
          label="Lowest allowed"
          inputMode="decimal"
          suffix="°C"
          defaultValue={v?.tempMinC}
          {...common}
        />
        <TextField
          name="tempMaxC"
          label="Highest allowed"
          inputMode="decimal"
          suffix="°C"
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
        <div className="flex flex-col gap-1.5">
          <TextField
            name="defaultChannels"
            label="Number of loggers"
            inputMode="numeric"
            defaultValue={v?.defaultChannels}
            {...common}
          />
          {suggestion && !readOnly ? (
            <p className="text-xs text-muted-foreground">
              Suggested {suggestion.count}: {suggestion.reason}.{" "}
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() => {
                  const input = formRef.current?.elements.namedItem("defaultChannels");
                  if (input instanceof HTMLInputElement) input.value = String(suggestion.count);
                }}
              >
                Use {suggestion.count}
              </button>
            </p>
          ) : null}
        </div>
        <TextField
          name="readingIntervalMinutes"
          label="Reading every"
          inputMode="numeric"
          suffix="min"
          defaultValue={v?.readingIntervalMinutes}
          {...common}
        />
        <TextField
          name="studyDurationHours"
          label="Study duration"
          inputMode="numeric"
          suffix="hours"
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
        <fieldset className="flex flex-col gap-2 sm:col-span-2 lg:col-span-3">
          <legend className="mb-1.5 text-sm font-medium">Cycles each study runs</legend>
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
                  defaultChecked={v?.cycles.includes(cycle)}
                  disabled={readOnly}
                  className="size-4 accent-primary"
                />
                {STUDY_CYCLE_LABELS[cycle]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="sm:col-span-2 lg:col-span-3">
          <CheckboxField
            name="seasonalMapping"
            label="Map in summer and in winter"
            hint="WHO: warehouses and stores affected by outside weather need a study in the hottest and the coldest season. Not usually needed for cold rooms and freezers."
            defaultChecked={v?.seasonalMapping}
            disabled={readOnly}
          />
        </div>
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
          <Button type="submit" disabled={pending || (result?.ok && isNew)}>
            {pending ? "Saving…" : isNew ? (area ? "Add room" : "Add equipment") : "Save changes"}
          </Button>
          <div className="flex-1">
            <FormMessage result={result} />
          </div>
        </div>
      )}
    </form>
  );
}

function inputValue(form: HTMLFormElement, name: string): string {
  const input = form.elements.namedItem(name);
  return input instanceof HTMLInputElement ? input.value : "";
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
