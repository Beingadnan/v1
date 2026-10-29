"use client";

import { FileUp, Layers, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
import { Input } from "@/components/ui/form-controls";
import {
  INSTRUMENT_STATUSES,
  INSTRUMENT_TYPE_INFO,
  INSTRUMENT_TYPES,
  QUANTITIES,
  QUANTITY_UNITS,
  STATUS_LABELS,
} from "@/domain/instruments/types";

import {
  bulkAddAction,
  recordExternalCertificateAction,
  saveInstrumentAction,
  saveModelAction,
} from "./actions";

export type Option = { id: string; label: string };
export type ModelOption = {
  id: string;
  type: string;
  make: string;
  model: string;
  equipmentName: string;
  rangeText: string;
  resolutionText: string;
  accuracyText: string;
  calibrationSop: string;
  intervalMonths: number;
  quantities: string[];
  accuracy: {
    temperature?: { tolerance: number; bands?: { from: number; to: number; tolerance: number }[] };
    humidity?: { tolerance: number };
    pressure?: { tolerance: number };
  };
  defaultPoints: { quantity: string; reference: string; condition: string }[];
};

const typeOptions = INSTRUMENT_TYPES.map((t) => (
  <option key={t} value={t}>
    {INSTRUMENT_TYPE_INFO[t].label}
  </option>
));

// ---------------------------------------------------------------- instrument

export type InstrumentValues = {
  id: string;
  modelId: string | null;
  type: string;
  tier: string;
  code: string;
  serialNo: string;
  make: string;
  model: string;
  equipmentName: string;
  rangeText: string;
  resolutionText: string;
  accuracyText: string;
  homeSiteId: string | null;
  status: string;
  intervalMonths: number | null;
  notes: string;
};

function InstrumentForm({
  instrument,
  models,
  sites,
  close,
}: {
  instrument?: InstrumentValues;
  models: ModelOption[];
  sites: Option[];
  close: () => void;
}) {
  const router = useRouter();
  const { result, pending, onSubmit } = useFormAction(saveInstrumentAction);
  const [modelId, setModelId] = useState(instrument?.modelId ?? "");
  const [status, setStatus] = useState(instrument?.status ?? "active");
  const model = models.find((m) => m.id === modelId);
  useCloseOnSuccess(result?.ok, close);
  useEffect(() => {
    if (result?.ok && !instrument) router.push(`/instruments/${result.data.id}`);
  }, [result, instrument, router]);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{instrument ? `Edit ${instrument.code}` : "Add an instrument"}</DialogTitle>
        <DialogDescription>
          Choose the model and the make, range and accuracy are filled in from it.
        </DialogDescription>
      </DialogHeader>
      {instrument ? <input type="hidden" name="instrumentId" value={instrument.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          name="modelId"
          label="Model"
          result={result}
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          hint="Leave as “No model” for a one-off instrument."
        >
          <option value="">No model</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.make} {m.model} — {m.equipmentName}
            </option>
          ))}
        </SelectField>
        <SelectField
          key={`type-${modelId}`}
          name="type"
          label="Type"
          result={result}
          defaultValue={model?.type ?? instrument?.type ?? "portable_logger"}
          required
        >
          {typeOptions}
        </SelectField>
        <TextField
          name="code"
          label="QA Tech ID"
          result={result}
          required
          defaultValue={instrument?.code}
          placeholder="E-TRH0534"
        />
        <TextField
          name="serialNo"
          label="Serial number"
          result={result}
          defaultValue={instrument?.serialNo}
        />
        <SelectField
          name="tier"
          label="Use"
          result={result}
          defaultValue={instrument?.tier ?? "working"}
        >
          <option value="working">Working instrument (logger, sensor)</option>
          <option value="master">Master standard (reference)</option>
        </SelectField>
        <SelectField
          name="homeSiteId"
          label="Home site"
          result={result}
          defaultValue={instrument?.homeSiteId ?? ""}
        >
          <option value="">Not set</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </SelectField>
      </div>
      <details className="rounded-md border border-border p-3" open={!model}>
        <summary className="cursor-pointer text-sm font-medium">
          Make, range and accuracy {model ? "(from the model; change only if different)" : ""}
        </summary>
        <div key={modelId} className="mt-3 grid gap-3 sm:grid-cols-2">
          <TextField
            name="make"
            label="Make"
            result={result}
            defaultValue={instrument?.make || model?.make}
          />
          <TextField
            name="model"
            label="Model"
            result={result}
            defaultValue={instrument?.model || model?.model}
          />
          <TextField
            name="equipmentName"
            label="Name on certificates"
            result={result}
            defaultValue={instrument?.equipmentName || model?.equipmentName}
          />
          <TextField
            name="rangeText"
            label="Range"
            result={result}
            defaultValue={instrument?.rangeText || model?.rangeText}
          />
          <TextField
            name="resolutionText"
            label="Resolution"
            result={result}
            defaultValue={instrument?.resolutionText || model?.resolutionText}
          />
          <TextField
            name="intervalMonths"
            label="Calibration interval"
            suffix="months"
            inputMode="numeric"
            result={result}
            defaultValue={instrument?.intervalMonths ?? ""}
            placeholder={String(model?.intervalMonths ?? 12)}
          />
          <TextField
            name="accuracyText"
            label="Accuracy (as printed)"
            result={result}
            className="sm:col-span-2"
            defaultValue={instrument?.accuracyText || model?.accuracyText}
          />
        </div>
      </details>
      {instrument ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            name="status"
            label="Status"
            result={result}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {INSTRUMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </SelectField>
          {status !== instrument.status && status !== "active" ? (
            <TextField
              name="reason"
              label="Reason"
              required
              result={result}
              placeholder="Sensor damaged at Seawoods"
            />
          ) : null}
        </div>
      ) : null}
      <TextField
        name="notes"
        label="Notes"
        multiline
        result={result}
        defaultValue={instrument?.notes}
      />
      <FormMessage result={result} />
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : instrument ? "Save" : "Add instrument"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function AddInstrumentButton(props: { models: ModelOption[]; sites: Option[] }) {
  return (
    <FormDialog
      wide
      trigger={(open) => (
        <Button variant="secondary" onClick={open}>
          <Plus aria-hidden="true" />
          Add instrument
        </Button>
      )}
    >
      {(close) => <InstrumentForm {...props} close={close} />}
    </FormDialog>
  );
}

export function EditInstrumentButton(props: {
  instrument: InstrumentValues;
  models: ModelOption[];
  sites: Option[];
}) {
  return (
    <FormDialog
      wide
      trigger={(open) => (
        <Button variant="secondary" onClick={open}>
          <Pencil aria-hidden="true" />
          Edit
        </Button>
      )}
    >
      {(close) => <InstrumentForm {...props} close={close} />}
    </FormDialog>
  );
}

// ---------------------------------------------------------------- batch

function BulkForm({
  models,
  sites,
  close,
}: {
  models: ModelOption[];
  sites: Option[];
  close: () => void;
}) {
  const { result, pending, onSubmit } = useFormAction(bulkAddAction);
  const [serials, setSerials] = useState("");
  const count = serials.split(/[\s,;]+/).filter(Boolean).length;
  useCloseOnSuccess(result?.ok, () => {});
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Add a batch of new instruments</DialogTitle>
        <DialogDescription>
          Paste the serial numbers from the delivery note or Excel. IDs continue from the highest
          one with the prefix (E-TRH0533 → E-TRH0534, E-TRH0535…).
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          name="modelId"
          label="Model"
          required
          result={result}
          defaultValue={models[0]?.id}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.make} {m.model} — {m.equipmentName}
            </option>
          ))}
        </SelectField>
        <TextField
          name="codePrefix"
          label="ID prefix"
          required
          result={result}
          placeholder="E-TRH"
        />
        <SelectField name="homeSiteId" label="Home site" result={result} defaultValue="">
          <option value="">Not set</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </SelectField>
        <SelectField name="tier" label="Use" result={result} defaultValue="working">
          <option value="working">Working instruments</option>
          <option value="master">Master standards</option>
        </SelectField>
      </div>
      <TextField
        name="serials"
        label="Serial numbers"
        multiline
        required
        result={result}
        hint={
          count
            ? `${count} serial number${count === 1 ? "" : "s"}`
            : "One per line, or separated by commas or spaces."
        }
        onInput={(e: React.FormEvent<HTMLInputElement>) =>
          setSerials((e.target as HTMLInputElement).value)
        }
      />
      <FormMessage result={result} />
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={close}>
          {result?.ok ? "Done" : "Cancel"}
        </Button>
        <Button type="submit" disabled={pending || result?.ok}>
          {pending ? "Adding…" : `Add ${count || ""} instruments`.replace("  ", " ")}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function BulkAddButton(props: { models: ModelOption[]; sites: Option[] }) {
  if (props.models.length === 0) return null;
  return (
    <FormDialog
      wide
      trigger={(open) => (
        <Button onClick={open}>
          <Layers aria-hidden="true" />
          Add a batch
        </Button>
      )}
    >
      {(close) => <BulkForm {...props} close={close} />}
    </FormDialog>
  );
}

// ---------------------------------------------------------------- models

type Point = { quantity: string; reference: string; condition: string };

export function PointsEditor({
  points,
  onChange,
}: {
  points: Point[];
  onChange: (next: Point[]) => void;
}) {
  const set = (i: number, patch: Partial<Point>) =>
    onChange(points.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">Usual test points</legend>
      <p className="text-xs text-muted-foreground">
        Pre-filled on every new certificate for this model; the actual master readings are typed
        there.
      </p>
      {points.map((p, i) => (
        <div key={i} className="grid grid-cols-[7rem_1fr_1fr_auto] items-center gap-2">
          <select
            aria-label={`Point ${i + 1} quantity`}
            value={p.quantity}
            onChange={(e) => set(i, { quantity: e.target.value })}
            className="h-9 rounded-md border border-input bg-surface px-2 text-sm"
          >
            {QUANTITIES.map((q) => (
              <option key={q} value={q}>
                {QUANTITY_UNITS[q]}
              </option>
            ))}
          </select>
          <Input
            aria-label={`Point ${i + 1} value`}
            inputMode="decimal"
            value={p.reference}
            onChange={(e) => set(i, { reference: e.target.value })}
            placeholder="-25"
          />
          <Input
            aria-label={`Point ${i + 1} condition`}
            value={p.condition}
            onChange={(e) => set(i, { condition: e.target.value })}
            placeholder={p.quantity === "humidity" ? "25 °C" : "e.g. 50 %RH"}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove point ${i + 1}`}
            onClick={() => onChange(points.filter((_, j) => j !== i))}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="self-start"
        onClick={() =>
          onChange([
            ...points,
            { quantity: points.at(-1)?.quantity ?? "temperature", reference: "", condition: "" },
          ])
        }
      >
        <Plus aria-hidden="true" />
        Add point
      </Button>
    </fieldset>
  );
}

function ModelForm({ model, close }: { model?: ModelOption; close: () => void }) {
  const { result, pending, onSubmit } = useFormAction(saveModelAction);
  const [points, setPoints] = useState<Point[]>(model?.defaultPoints ?? []);
  useCloseOnSuccess(result?.ok, close);
  const band = model?.accuracy.temperature?.bands?.[0];
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>
          {model ? `${model.make} ${model.model}` : "Add an instrument model"}
        </DialogTitle>
        <DialogDescription>
          Everything here fills new instruments and certificates of this model automatically.
        </DialogDescription>
      </DialogHeader>
      {model ? <input type="hidden" name="modelId" value={model.id} /> : null}
      <input type="hidden" name="defaultPoints" value={JSON.stringify(points)} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          name="make"
          label="Make"
          required
          result={result}
          defaultValue={model?.make}
          placeholder="ebro"
        />
        <TextField
          name="model"
          label="Model"
          required
          result={result}
          defaultValue={model?.model}
          placeholder="EBI 20-TH1"
        />
        <SelectField
          name="type"
          label="Type"
          required
          result={result}
          defaultValue={model?.type ?? "portable_logger"}
        >
          {typeOptions}
        </SelectField>
        <TextField
          name="equipmentName"
          label="Name on certificates"
          required
          result={result}
          defaultValue={model?.equipmentName}
          placeholder="Temp. & RH Datalogger"
        />
        <TextField
          name="rangeText"
          label="Range"
          result={result}
          defaultValue={model?.rangeText}
          placeholder="-30 to 70 °C, 0 to 100 %RH"
        />
        <TextField
          name="resolutionText"
          label="Resolution"
          result={result}
          defaultValue={model?.resolutionText}
          placeholder="0.1"
        />
        <TextField
          name="calibrationSop"
          label="Calibration SOP No."
          result={result}
          defaultValue={model?.calibrationSop}
          placeholder="QATECH/CAL-026"
        />
        <TextField
          name="intervalMonths"
          label="Calibration interval"
          suffix="months"
          inputMode="numeric"
          result={result}
          defaultValue={model?.intervalMonths ?? 12}
        />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Measures</legend>
        <div className="flex flex-wrap gap-2">
          {QUANTITIES.map((q) => (
            <CheckboxField
              key={q}
              name="quantities"
              label={
                q === "temperature"
                  ? "Temperature (°C)"
                  : q === "humidity"
                    ? "Humidity (%RH)"
                    : "Pressure (bar)"
              }
              defaultChecked={model ? model.quantities.includes(q) : q === "temperature"}
              value={q}
            />
          ))}
        </div>
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-1 text-sm font-medium">Accuracy used for pass/fail (±)</legend>
        <TextField
          name="accuracy.temperature"
          label="Temperature"
          suffix="°C"
          inputMode="decimal"
          result={result}
          defaultValue={model?.accuracy.temperature?.tolerance ?? ""}
        />
        <TextField
          name="accuracy.humidity"
          label="Humidity"
          suffix="%RH"
          inputMode="decimal"
          result={result}
          defaultValue={model?.accuracy.humidity?.tolerance ?? ""}
        />
        <TextField
          name="accuracy.pressure"
          label="Pressure"
          suffix="bar"
          inputMode="decimal"
          result={result}
          defaultValue={model?.accuracy.pressure?.tolerance ?? ""}
        />
        <TextField
          name="accuracy.temperatureBandFrom"
          label="Tighter band from"
          suffix="°C"
          inputMode="decimal"
          result={result}
          defaultValue={band?.from ?? ""}
        />
        <TextField
          name="accuracy.temperatureBandTo"
          label="to"
          suffix="°C"
          inputMode="decimal"
          result={result}
          defaultValue={band?.to ?? ""}
        />
        <TextField
          name="accuracy.temperatureBandTolerance"
          label="Accuracy in the band"
          suffix="°C"
          inputMode="decimal"
          result={result}
          defaultValue={band?.tolerance ?? ""}
        />
      </fieldset>
      <TextField
        name="accuracyText"
        label="Accuracy as printed on the certificate"
        result={result}
        defaultValue={model?.accuracyText}
        placeholder="± 0.5 °C (-20 to 40 °C), ± 0.8 °C for the remaining range & ± 3 % at 10 to 90 % RH"
      />
      <PointsEditor points={points} onChange={setPoints} />
      <FormMessage result={result} />
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : model ? "Save model" : "Add model"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ModelButton({ model }: { model?: ModelOption }) {
  return (
    <FormDialog
      wide
      trigger={(open) =>
        model ? (
          <Button variant="ghost" size="sm" onClick={open}>
            <Pencil aria-hidden="true" />
            Edit
          </Button>
        ) : (
          <Button onClick={open}>
            <Plus aria-hidden="true" />
            Add model
          </Button>
        )
      }
    >
      {(close) => <ModelForm model={model} close={close} />}
    </FormDialog>
  );
}

// ---------------------------------------------------------------- outside-lab certificate

async function uploadPdf(file: File): Promise<{ id: string } | { error: string }> {
  const body = new FormData();
  body.set("file", file);
  try {
    const response = await fetch("/api/files", { method: "POST", body });
    const json = (await response.json()) as { id?: string; error?: string };
    if (!response.ok || !json.id) return { error: json.error ?? "The upload failed. Try again." };
    return { id: json.id };
  } catch {
    return { error: "The upload failed. Check your connection and try again." };
  }
}

function ExternalForm({
  instrumentId,
  instrumentCode,
  close,
}: {
  instrumentId: string;
  instrumentCode: string;
  close: () => void;
}) {
  const { result, pending, onSubmit } = useFormAction(recordExternalCertificateAction);
  const [file, setFile] = useState<{ id: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  useCloseOnSuccess(result?.ok, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Record a certificate for {instrumentCode}</DialogTitle>
        <DialogDescription>
          From an outside lab (ARAI, Sansel…). Attach the PDF so it travels with the traceability
          chain.
        </DialogDescription>
      </DialogHeader>
      <input type="hidden" name="instrumentIds" value={instrumentId} />
      <input type="hidden" name="fileId" value={file?.id ?? ""} />
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="certificate-pdf">
          Certificate PDF
        </label>
        <input
          id="certificate-pdf"
          type="file"
          accept="application/pdf,.pdf"
          className="text-sm"
          onChange={async (e) => {
            const chosen = e.target.files?.[0];
            if (!chosen) return;
            setUploading(true);
            setUploadError("");
            const uploaded = await uploadPdf(chosen);
            setUploading(false);
            if ("error" in uploaded) setUploadError(uploaded.error);
            else setFile({ id: uploaded.id, name: chosen.name });
          }}
        />
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {uploading
            ? "Uploading…"
            : file
              ? `Attached: ${file.name}`
              : uploadError || "Optional, but recommended."}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField name="labName" label="Laboratory" required result={result} placeholder="ARAI" />
        <TextField
          name="number"
          label="Certificate No."
          required
          result={result}
          placeholder="ARAI/CAL/2508/2925"
        />
        <TextField name="ulrNo" label="ULR No." result={result} placeholder="CC287926000000394F" />
        <TextField
          name="labAccreditation"
          label="Lab accreditation No."
          result={result}
          placeholder="CC-2879"
        />
        <TextField name="calibratedOn" label="Calibrated on" type="date" required result={result} />
        <TextField
          name="validUntil"
          label="Due date"
          type="date"
          result={result}
          hint="Leave empty if the certificate gives none."
        />
        <TextField name="issuedOn" label="Issued on" type="date" result={result} />
        <TextField
          name="calibratedUntil"
          label="Calibration finished (if several days)"
          type="date"
          result={result}
        />
      </div>
      <TextField name="remarks" label="Remarks" multiline result={result} />
      <FormMessage result={result} />
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || uploading}>
          {pending ? "Saving…" : "Record certificate"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ExternalCertificateButton(props: { instrumentId: string; instrumentCode: string }) {
  return (
    <FormDialog
      wide
      trigger={(open) => (
        <Button onClick={open}>
          <FileUp aria-hidden="true" />
          Record outside-lab certificate
        </Button>
      )}
    >
      {(close) => <ExternalForm {...props} close={close} />}
    </FormDialog>
  );
}
