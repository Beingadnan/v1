"use client";

import { Pencil, Plus, Trash2, Wand2, X } from "lucide-react";
import Link from "next/link";
import { startTransition, useActionState, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FormDialog, useCloseOnSuccess } from "@/components/ui/form-dialog";
import {
  CheckboxField,
  FormMessage,
  SelectField,
  TextField,
  useFormAction,
} from "@/components/ui/form-kit";
import { STUDY_CYCLE_LABELS, STUDY_CYCLES } from "@/domain/clients/study-defaults";
import type { SiteEquipment } from "@/domain/jobs/queries";

import { OrderFields, type ContractOption } from "../order-fields";
import { TEAM_ROLE_LABELS, TEAM_ROLES } from "@/domain/jobs/types";
import {
  SEASONS,
  TRANSITIONS,
  WORK_TYPE_LABELS,
  WORK_TYPES,
  type Transition,
} from "@/domain/jobs/types";
import type { ActionResult } from "@/lib/action-result";
import { shortList } from "@/lib/text";
import { cn } from "@/lib/utils";

import {
  addStudiesAction,
  autoBookAction,
  changeStatusAction,
  releaseAction,
  removeStudyAction,
  setReadinessAction,
  setTeamAction,
  updateJobAction,
  updateStudyAction,
} from "../actions";

type FormAction<T> = (prev: unknown, formData: FormData) => Promise<ActionResult<T>>;

/** A form whose submit buttons carry their own name/value (FormData with the submitter). */
function useSubmitterAction<T>(action: FormAction<T>) {
  const [result, dispatch, pending] = useActionState<ActionResult<T> | undefined, FormData>(
    action,
    undefined,
  );
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const native = event.nativeEvent as SubmitEvent;
    const formData = new FormData(event.currentTarget, native.submitter);
    startTransition(() => dispatch(formData));
  };
  return { result, pending, onSubmit };
}

const Hidden = ({ fields }: { fields: Record<string, string> }) => (
  <>
    {Object.entries(fields).map(([k, v]) => (
      <input key={k} type="hidden" name={k} value={v} />
    ))}
  </>
);

// ---------------------------------------------------------------- status

export function StatusButtons({ jobId, allowed }: { jobId: string; allowed: Transition[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {allowed.includes("start_field_work") ? <StartFieldWork jobId={jobId} /> : null}
      {allowed.includes("resume") ? <ReasonDialog jobId={jobId} transition="resume" /> : null}
      {allowed.includes("hold") ? <ReasonDialog jobId={jobId} transition="hold" /> : null}
      {allowed.includes("cancel") ? <ReasonDialog jobId={jobId} transition="cancel" /> : null}
    </div>
  );
}

function StartFieldWork({ jobId }: { jobId: string }) {
  const { result, pending, onSubmit } = useFormAction(changeStatusAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col items-start gap-2">
      <Hidden fields={{ jobId, transition: "start_field_work" }} />
      <Button type="submit" disabled={pending}>
        {pending ? "Checking…" : "Start field work"}
      </Button>
      {result && !result.ok ? <FormMessage result={result} /> : null}
    </form>
  );
}

const REASON_COPY: Record<
  Exclude<Transition, "start_field_work">,
  { title: string; hint: string; required: boolean; variant: "secondary" | "ghost" }
> = {
  hold: {
    title: "Put the job on hold",
    hint: "For example: client shutdown, PO awaited, equipment under repair. Loggers stay booked.",
    required: true,
    variant: "secondary",
  },
  resume: {
    title: "Resume the job",
    hint: "It goes back to where it was put on hold.",
    required: false,
    variant: "secondary",
  },
  cancel: {
    title: "Cancel the job",
    hint: "The job number and report numbers are not reused. Booked loggers become free.",
    required: true,
    variant: "ghost",
  },
};

function ReasonDialog({
  jobId,
  transition,
}: {
  jobId: string;
  transition: Exclude<Transition, "start_field_work">;
}) {
  const copy = REASON_COPY[transition];
  return (
    <FormDialog
      trigger={(open) => (
        <Button variant={copy.variant} onClick={open}>
          {TRANSITIONS[transition].label}
        </Button>
      )}
    >
      {(close) => <ReasonForm jobId={jobId} transition={transition} close={close} />}
    </FormDialog>
  );
}

function ReasonForm({
  jobId,
  transition,
  close,
}: {
  jobId: string;
  transition: Exclude<Transition, "start_field_work">;
  close: () => void;
}) {
  const copy = REASON_COPY[transition];
  const { result, pending, onSubmit } = useFormAction(changeStatusAction);
  useCloseOnSuccess(result?.ok, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <DialogTitle>{copy.title}</DialogTitle>
      <DialogDescription>{copy.hint}</DialogDescription>
      <Hidden fields={{ jobId, transition }} />
      <TextField
        name="reason"
        label={copy.required ? "Reason" : "Note (optional)"}
        required={copy.required}
        multiline
        result={result}
      />
      <FormMessage result={result} />
      <Button
        type="submit"
        disabled={pending}
        variant={transition === "cancel" ? "danger" : "primary"}
      >
        {pending ? "Saving…" : TRANSITIONS[transition].label}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------- details

export type JobFormValues = {
  siteId: string;
  title: string;
  orderType: string;
  contractId: string;
  poNumber: string;
  poDate: string;
  poValue: string;
  plannedStart: string;
  plannedEnd: string;
  notes: string;
};

export function EditJobButton({
  jobId,
  values,
  qaSites,
  canSeeMoney,
  contracts,
}: {
  jobId: string;
  values: JobFormValues;
  qaSites: { id: string; code: string; name: string }[];
  canSeeMoney: boolean;
  contracts: ContractOption[];
}) {
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
      {(close) => (
        <EditJobForm
          jobId={jobId}
          values={values}
          qaSites={qaSites}
          canSeeMoney={canSeeMoney}
          contracts={contracts}
          close={close}
        />
      )}
    </FormDialog>
  );
}

function EditJobForm({
  jobId,
  values,
  qaSites,
  canSeeMoney,
  contracts,
  close,
}: {
  jobId: string;
  values: JobFormValues;
  qaSites: { id: string; code: string; name: string }[];
  canSeeMoney: boolean;
  contracts: ContractOption[];
  close: () => void;
}) {
  const { result, pending, onSubmit } = useFormAction(updateJobAction);
  useCloseOnSuccess(result?.ok, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <DialogTitle>Job details</DialogTitle>
      <DialogDescription>
        Moving the dates rechecks every booked logger against the new dates.
      </DialogDescription>
      <Hidden fields={{ jobId }} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          name="plannedStart"
          label="First day on site"
          type="date"
          required
          defaultValue={values.plannedStart}
          result={result}
        />
        <TextField
          name="plannedEnd"
          label="Last day (loggers back)"
          type="date"
          required
          defaultValue={values.plannedEnd}
          result={result}
        />
        <div className="sm:col-span-2">
          <OrderFields
            contracts={contracts}
            result={result}
            canSeeMoney={canSeeMoney}
            values={values}
            start={values.plannedStart}
          />
        </div>
        <SelectField
          name="siteId"
          label="QA Tech site"
          defaultValue={values.siteId}
          result={result}
        >
          <option value="">Any site</option>
          {qaSites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.code})
            </option>
          ))}
        </SelectField>
        <TextField name="title" label="Short title" defaultValue={values.title} result={result} />
      </div>
      <TextField
        name="notes"
        label="Notes for the team"
        multiline
        defaultValue={values.notes}
        result={result}
      />
      <FormMessage result={result} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------- readiness

export function ReadinessSwitch({
  jobId,
  itemKey,
  label,
  state,
  note,
}: {
  jobId: string;
  itemKey: string;
  label: string;
  state: string;
  note: string;
}) {
  const { result, pending, onSubmit } = useSubmitterAction(setReadinessAction);
  const options = [
    { value: "ready", label: "Ready" },
    { value: "pending", label: "Pending" },
    { value: "na", label: "N/A" },
  ];
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-1">
      <Hidden fields={{ jobId, key: itemKey, note }} />
      <div
        role="group"
        aria-label={label}
        className="inline-flex w-fit overflow-hidden rounded-md border border-border"
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="submit"
            name="state"
            value={o.value}
            disabled={pending}
            aria-pressed={state === o.value}
            className={cn(
              "px-2.5 py-1 text-xs",
              state === o.value
                ? "bg-primary text-primary-foreground"
                : "bg-surface hover:bg-surface-muted",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {result && !result.ok ? (
        <p role="alert" className="text-xs text-fail">
          {result.error}
        </p>
      ) : null}
    </form>
  );
}

// ---------------------------------------------------------------- studies

export type StudyValues = {
  id: string;
  code: string;
  workType: string;
  loggerCount: number;
  cycles: string[];
  season: string;
  durationHours: number | null;
  intervalMinutes: number | null;
  preCalRequired: boolean;
  postCalRequired: boolean;
};

export function EditStudyButton({ jobId, study }: { jobId: string; study: StudyValues }) {
  return (
    <FormDialog
      trigger={(open) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={open}
          aria-label={`Edit the ${study.code} study`}
        >
          <Pencil aria-hidden="true" />
        </Button>
      )}
    >
      {(close) => <EditStudyForm jobId={jobId} study={study} close={close} />}
    </FormDialog>
  );
}

function EditStudyForm({
  jobId,
  study,
  close,
}: {
  jobId: string;
  study: StudyValues;
  close: () => void;
}) {
  const { result, pending, onSubmit } = useFormAction(updateStudyAction);
  useCloseOnSuccess(result?.ok, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <DialogTitle>{study.code} study</DialogTitle>
      <DialogDescription>The report number stays as reserved.</DialogDescription>
      <Hidden fields={{ jobId, studyId: study.id }} />
      <SelectField name="workType" label="Work" defaultValue={study.workType} result={result}>
        {WORK_TYPES.map((w) => (
          <option key={w} value={w}>
            {WORK_TYPE_LABELS[w]}
          </option>
        ))}
      </SelectField>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          name="loggerCount"
          label="Loggers / probes"
          inputMode="numeric"
          defaultValue={String(study.loggerCount)}
          result={result}
        />
        <TextField
          name="durationHours"
          label="Duration"
          suffix="h"
          inputMode="numeric"
          defaultValue={study.durationHours?.toString() ?? ""}
          result={result}
        />
        <TextField
          name="intervalMinutes"
          label="Interval"
          suffix="min"
          inputMode="numeric"
          defaultValue={study.intervalMinutes?.toString() ?? ""}
          result={result}
        />
      </div>
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-medium">Cycles</legend>
        {STUDY_CYCLES.map((c) => (
          <CheckboxField
            key={c}
            name="cycles"
            value={c}
            label={STUDY_CYCLE_LABELS[c]}
            defaultChecked={study.cycles.includes(c)}
          />
        ))}
      </fieldset>
      <SelectField name="season" label="Season" defaultValue={study.season} result={result}>
        {SEASONS.map((s) => (
          <option key={s} value={s}>
            {s ? s[0]!.toUpperCase() + s.slice(1) : "Not seasonal"}
          </option>
        ))}
      </SelectField>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Calibration of the loggers</legend>
        <CheckboxField
          name="preCalRequired"
          label="Pre-calibration (before the study)"
          defaultChecked={study.preCalRequired || study.workType === "thermal_validation"}
        />
        <CheckboxField
          name="postCalRequired"
          label="Post-calibration (after the study)"
          defaultChecked={study.postCalRequired || study.workType === "thermal_validation"}
        />
        <p className="text-xs text-muted-foreground">
          Thermal validation always has both, whatever is ticked here.
        </p>
      </fieldset>
      <FormMessage result={result} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

export function RemoveStudyButton({
  jobId,
  studyId,
  code,
}: {
  jobId: string;
  studyId: string;
  code: string;
}) {
  return (
    <FormDialog
      trigger={(open) => (
        <Button variant="ghost" size="sm" onClick={open} aria-label={`Remove ${code} from the job`}>
          <Trash2 aria-hidden="true" />
        </Button>
      )}
    >
      {(close) => <RemoveStudyForm jobId={jobId} studyId={studyId} code={code} close={close} />}
    </FormDialog>
  );
}

function RemoveStudyForm({
  jobId,
  studyId,
  code,
  close,
}: {
  jobId: string;
  studyId: string;
  code: string;
  close: () => void;
}) {
  const { result, pending, onSubmit } = useFormAction(removeStudyAction);
  useCloseOnSuccess(result?.ok, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <DialogTitle>Remove {code}?</DialogTitle>
      <DialogDescription>
        Its reserved report number is released and not reused for another item.
      </DialogDescription>
      <Hidden fields={{ jobId, studyId }} />
      <FormMessage result={result} />
      <Button type="submit" variant="danger" disabled={pending}>
        {pending ? "Removing…" : "Remove"}
      </Button>
    </form>
  );
}

export function AddStudiesButton({
  jobId,
  equipment,
}: {
  jobId: string;
  equipment: SiteEquipment[];
}) {
  return (
    <FormDialog
      wide
      trigger={(open) => (
        <Button variant="secondary" size="sm" onClick={open} disabled={equipment.length === 0}>
          <Plus aria-hidden="true" />
          Add equipment
        </Button>
      )}
    >
      {(close) => <AddStudiesForm jobId={jobId} equipment={equipment} close={close} />}
    </FormDialog>
  );
}

function AddStudiesForm({
  jobId,
  equipment,
  close,
}: {
  jobId: string;
  equipment: SiteEquipment[];
  close: () => void;
}) {
  const { result, pending, onSubmit } = useFormAction(addStudiesAction);
  useCloseOnSuccess(result?.ok, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <DialogTitle>Add equipment</DialogTitle>
      <DialogDescription>Other equipment at this site. Due items are ticked.</DialogDescription>
      <Hidden fields={{ jobId }} />
      <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
        {equipment.map((e) => (
          <CheckboxField
            key={e.id}
            name="equipment"
            value={e.id}
            label={`${e.code} ${e.name}`}
            hint={[
              e.department,
              e.nextDue ? `due ${e.nextDue.split("-").reverse().join(".")}` : null,
              e.onJob ? `on ${e.onJob.number}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            defaultChecked={(e.due === "overdue" || e.due === "due_soon") && !e.onJob}
          />
        ))}
      </div>
      <FormMessage result={result} />
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add"}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------- team

export function TeamButton({
  jobId,
  staff,
  current,
}: {
  jobId: string;
  staff: { id: string; name: string; role: string }[];
  current: { userId: string; role: string }[];
}) {
  return (
    <FormDialog
      wide
      trigger={(open) => (
        <Button variant="secondary" size="sm" onClick={open}>
          <Pencil aria-hidden="true" />
          Change team
        </Button>
      )}
    >
      {(close) => <TeamForm jobId={jobId} staff={staff} current={current} close={close} />}
    </FormDialog>
  );
}

function TeamForm({
  jobId,
  staff,
  current,
  close,
}: {
  jobId: string;
  staff: { id: string; name: string; role: string }[];
  current: { userId: string; role: string }[];
  close: () => void;
}) {
  const { result, pending, onSubmit } = useFormAction(setTeamAction);
  useCloseOnSuccess(result?.ok, close);
  const [on, setOn] = useState(() => new Set(current.map((c) => c.userId)));
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <DialogTitle>Team</DialogTitle>
      <Hidden fields={{ jobId }} />
      <ul className="grid gap-2 sm:grid-cols-2">
        {staff.map((s) => {
          const role =
            current.find((c) => c.userId === s.id)?.role ??
            ((TEAM_ROLES as readonly string[]).includes(s.role) ? s.role : "field_engineer");
          return (
            <li
              key={s.id}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
            >
              <input
                id={`t-${s.id}`}
                type="checkbox"
                name="team"
                value={s.id}
                checked={on.has(s.id)}
                onChange={() =>
                  setOn((prev) => {
                    const next = new Set(prev);
                    if (next.has(s.id)) next.delete(s.id);
                    else next.add(s.id);
                    return next;
                  })
                }
                className="size-4 accent-primary"
              />
              <label htmlFor={`t-${s.id}`} className="min-w-0 flex-1 truncate text-sm">
                {s.name}
              </label>
              <select
                name={`role-${s.id}`}
                aria-label={`${s.name}'s role`}
                defaultValue={role}
                disabled={!on.has(s.id)}
                className="h-8 rounded-md border border-input bg-surface px-2 text-xs disabled:opacity-50"
              >
                {TEAM_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {TEAM_ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>
      <FormMessage result={result} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save team"}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------- bookings

export function AutoBookButton({ jobId, label }: { jobId: string; label: string }) {
  const { result, pending, onSubmit } = useFormAction(autoBookAction);
  let message: ReactNode = null;
  if (result?.ok) {
    const r = result.data;
    const all = [...r.booked, ...r.masters];
    const short = r.short.reduce((n, s) => n + s.count, 0);
    const outOfDate = r.skipped.some((s) => s.reason.startsWith("not calibrated"));
    message = (
      <div
        role="status"
        className={cn(
          "flex flex-col gap-0.5 rounded-md px-3 py-2 text-sm",
          short ? "bg-attention-soft text-attention" : "bg-pass-soft text-pass",
        )}
      >
        <p>
          {all.length > 0
            ? `Booked ${all.length}: ${shortList(all)}.`
            : short
              ? "No logger could be booked."
              : "Everything needed is already booked."}
        </p>
        {r.short.map((s) => (
          <p key={s.type}>
            Still short of {s.count} {s.type.replace(/_/g, " ")}
            {s.count === 1 ? "" : "s"}.
          </p>
        ))}
        {r.skipped.length > 0 ? (
          <p className="text-xs">
            Left out: {r.skipped.map((s) => `${s.count} ${s.reason}`).join("; ")}.
          </p>
        ) : null}
        {short && outOfDate ? (
          <Link href="/instruments?view=attention" className="text-xs font-medium underline">
            Plan their calibration →
          </Link>
        ) : null}
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col items-start gap-2">
      <Hidden fields={{ jobId }} />
      <Button type="submit" size="sm" disabled={pending}>
        <Wand2 aria-hidden="true" />
        {pending ? "Booking…" : label}
      </Button>
      {result && !result.ok ? <FormMessage result={result} /> : message}
    </form>
  );
}

export function ReleaseButton({
  jobId,
  instrumentId,
  code,
}: {
  jobId: string;
  instrumentId: string;
  code: string;
}) {
  const { result, pending, onSubmit } = useFormAction(releaseAction);
  return (
    <form onSubmit={onSubmit}>
      <Hidden fields={{ jobId, instrumentId }} />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={pending}
        aria-label={`Release ${code}`}
        title={result && !result.ok ? result.error : `Release ${code}`}
      >
        <X aria-hidden="true" />
      </Button>
    </form>
  );
}
