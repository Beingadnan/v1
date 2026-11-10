"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-controls";
import { FormMessage, SelectField, TextField, useFormAction } from "@/components/ui/form-kit";
import { EQUIPMENT_TYPE_INFO, isEquipmentType } from "@/domain/clients/equipment-types";
import type { SiteEquipment, WizardClient } from "@/domain/jobs/queries";

import { OrderFields } from "../order-fields";
import { TEAM_ROLE_LABELS, TEAM_ROLES } from "@/domain/jobs/types";

import { createJobAction, siteEquipmentAction } from "../actions";

type Staff = { id: string; name: string; role: string };

const DUE_LABEL: Record<SiteEquipment["due"], string> = {
  overdue: "Overdue",
  due_soon: "Due within 30 days",
  ok: "Not due yet",
  none: "No study recorded",
};

const dmy = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "");

function plusDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function defaultRole(role: string): string {
  return (TEAM_ROLES as readonly string[]).includes(role) ? role : "field_engineer";
}

function initialTicks(list: SiteEquipment[], preselected: string[]) {
  if (preselected.length > 0)
    return new Set(list.filter((e) => preselected.includes(e.id)).map((e) => e.id));
  return new Set(
    list.filter((e) => (e.due === "overdue" || e.due === "due_soon") && !e.onJob).map((e) => e.id),
  );
}

export function NewJobForm({
  clients,
  staff,
  qaSites,
  me,
  canSeeMoney,
  initial,
}: {
  clients: WizardClient[];
  staff: Staff[];
  qaSites: { id: string; code: string; name: string }[];
  me: { id: string; role: string };
  canSeeMoney: boolean;
  initial: {
    companyId: string;
    siteId: string;
    equipment: SiteEquipment[];
    preselected: string[];
    plannedStart: string;
  };
}) {
  const router = useRouter();
  const { result, pending, onSubmit } = useFormAction(createJobAction);
  const [companyId, setCompanyId] = useState(initial.companyId);
  const [siteId, setSiteId] = useState(initial.siteId);
  const [equipment, setEquipment] = useState(initial.equipment);
  const [ticked, setTicked] = useState(() => initialTicks(initial.equipment, initial.preselected));
  const [loading, startLoading] = useTransition();
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState("");
  const [start, setStart] = useState(initial.plannedStart);
  const [end, setEnd] = useState(plusDays(initial.plannedStart, 3));
  const [team, setTeam] = useState<Set<string>>(
    () => new Set(me.role === "team_leader" ? [me.id] : []),
  );

  const company = clients.find((c) => c.id === companyId);

  useEffect(() => {
    if (result?.ok) router.push(`/jobs/${result.data.id}`);
  }, [result, router]);

  function pickSite(id: string) {
    setSiteId(id);
    setEquipment([]);
    setTicked(new Set());
    setLoadError("");
    if (!id) return;
    startLoading(async () => {
      const r = await siteEquipmentAction(id);
      if (!r.ok) {
        setLoadError(r.error);
        return;
      }
      setEquipment(r.data);
      setTicked(initialTicks(r.data, []));
    });
  }

  function pickCompany(id: string) {
    setCompanyId(id);
    const c = clients.find((x) => x.id === id);
    pickSite(c?.sites.length === 1 ? c.sites[0]!.id : "");
  }

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f
      ? equipment.filter((e) =>
          [e.code, e.name, e.department ?? "", e.type].some((v) => v.toLowerCase().includes(f)),
        )
      : equipment;
  }, [equipment, filter]);
  const dueCount = equipment.filter((e) => e.due === "overdue" || e.due === "due_soon").length;

  const toggle = (id: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <section
        aria-labelledby="where"
        className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
      >
        <h2 id="where" className="font-semibold">
          1. Client and site
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            name="companyId"
            label="Client"
            required
            result={result}
            value={companyId}
            onChange={(e) => pickCompany(e.target.value)}
          >
            <option value="">Pick a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code})
              </option>
            ))}
          </SelectField>
          <SelectField
            name="clientSiteId"
            label="Client's site"
            required
            result={result}
            value={siteId}
            disabled={!company}
            onChange={(e) => pickSite(e.target.value)}
            hint={
              company && company.sites.length === 0
                ? "This client has no sites yet: add one on the client's page."
                : undefined
            }
          >
            <option value="">{company ? "Pick a site…" : "Pick a client first"}</option>
            {company?.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.code})
              </option>
            ))}
          </SelectField>
        </div>
      </section>

      <section
        aria-labelledby="what"
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="what" className="font-semibold">
            2. Equipment
          </h2>
          {equipment.length > 0 ? (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {ticked.size} of {equipment.length} ticked
              {dueCount > 0 ? ` · ${dueCount} due` : ""}
            </p>
          ) : null}
        </div>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading the site&apos;s
            equipment…
          </p>
        ) : loadError ? (
          <p role="alert" className="text-sm text-fail">
            {loadError}
          </p>
        ) : !siteId ? (
          <p className="text-sm text-muted-foreground">
            Pick the client&apos;s site to see its equipment.
          </p>
        ) : equipment.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No equipment is recorded at this site.{" "}
            <Link href={`/clients/${companyId}`} className="text-primary underline">
              Add it on the client&apos;s page
            </Link>{" "}
            or import their list, then come back.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {equipment.length > 8 ? (
                <Input
                  type="search"
                  aria-label="Filter equipment"
                  placeholder="Filter by ID, name, department"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="max-w-xs"
                />
              ) : null}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setTicked(new Set(shown.map((e) => e.id)))}
              >
                Tick all{filter ? " shown" : ""}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setTicked(new Set())}>
                Clear
              </Button>
            </div>
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {shown.map((e) => (
                <li key={e.id}>
                  <label className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-surface-muted">
                    <input
                      type="checkbox"
                      name="equipment"
                      value={e.id}
                      checked={ticked.has(e.id)}
                      onChange={() => toggle(e.id)}
                      className="mt-1 size-4 accent-primary"
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-sm">
                        <strong>{e.code}</strong> {e.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {[
                          isEquipmentType(e.type) ? EQUIPMENT_TYPE_INFO[e.type].label : e.type,
                          e.department,
                          e.lastStudyOn ? `last study ${dmy(e.lastStudyOn)}` : null,
                          e.nextDue ? `due ${dmy(e.nextDue)}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {e.onJob ? (
                        <span className="text-xs text-attention">
                          Already on open job {e.onJob.number}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={
                        e.due === "overdue"
                          ? "text-xs font-medium text-fail"
                          : e.due === "due_soon"
                            ? "text-xs font-medium text-attention"
                            : "text-xs text-muted-foreground"
                      }
                    >
                      {DUE_LABEL[e.due]}
                    </span>
                  </label>
                  {ticked.has(e.id) ? <CalibrationChoice e={e} /> : null}
                </li>
              ))}
            </ul>
            {/* Ticked items hidden by the filter are still sent. */}
            {[...ticked]
              .filter((id) => !shown.some((e) => e.id === id))
              .map((id) => (
                <input key={id} type="hidden" name="equipment" value={id} />
              ))}
          </>
        )}
      </section>

      <section
        aria-labelledby="when"
        className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
      >
        <h2 id="when" className="font-semibold">
          3. Dates and team
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            name="plannedStart"
            label="First day on site"
            type="date"
            required
            result={result}
            value={start}
            onChange={(e) => {
              const v = e.target.value;
              // Keep the length of the visit when the start moves.
              if (v && start && end) {
                const days = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000);
                setEnd(plusDays(v, Math.max(0, days)));
              }
              setStart(v);
            }}
          />
          <TextField
            name="plannedEnd"
            label="Last day (loggers back)"
            type="date"
            required
            result={result}
            value={end}
            min={start}
            onChange={(e) => setEnd(e.target.value)}
            hint="Loggers must stay calibrated until this day."
          />
          <SelectField
            name="siteId"
            label="QA Tech site"
            result={result}
            defaultValue={qaSites.length === 1 ? qaSites[0]!.id : ""}
            hint="Its loggers are booked first."
          >
            {qaSites.length !== 1 ? <option value="">Any site</option> : null}
            {qaSites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.code})
              </option>
            ))}
          </SelectField>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Team</legend>
          <ul className="grid gap-2 sm:grid-cols-2">
            {staff.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
              >
                <input
                  id={`team-${s.id}`}
                  type="checkbox"
                  name="team"
                  value={s.id}
                  checked={team.has(s.id)}
                  onChange={() =>
                    setTeam((prev) => {
                      const next = new Set(prev);
                      if (next.has(s.id)) next.delete(s.id);
                      else next.add(s.id);
                      return next;
                    })
                  }
                  className="size-4 accent-primary"
                />
                <label htmlFor={`team-${s.id}`} className="min-w-0 flex-1 truncate text-sm">
                  {s.name}
                </label>
                <select
                  name={`role-${s.id}`}
                  aria-label={`${s.name}'s role on this job`}
                  defaultValue={defaultRole(s.role)}
                  disabled={!team.has(s.id)}
                  className="h-8 rounded-md border border-input bg-surface px-2 text-xs disabled:opacity-50"
                >
                  {TEAM_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {TEAM_ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </fieldset>
      </section>

      <section
        aria-labelledby="po"
        className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
      >
        <h2 id="po" className="font-semibold">
          4. Client&apos;s order
        </h2>
        <p className="text-sm text-muted-foreground">
          A PO or SRF for this job, or the client&apos;s ARC or AMC. If it hasn&apos;t come yet,
          leave it: field work can go ahead, and you&apos;ll be reminded until it is recorded.
        </p>
        <OrderFields
          key={companyId}
          contracts={company?.contracts ?? []}
          result={result}
          canSeeMoney={canSeeMoney}
          start={start}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            name="title"
            label="Short title"
            result={result}
            className="sm:col-span-2"
            placeholder="e.g. Annual mapping, freezers"
          />
        </div>
        <TextField name="notes" label="Notes for the team" multiline result={result} />
      </section>

      <FormMessage result={result} />
      <div className="flex flex-wrap gap-2">
        {/* After a save the page moves to the job: keep the button locked so it isn't made twice. */}
        <Button type="submit" disabled={pending || result?.ok || ticked.size === 0}>
          {result?.ok
            ? "Opening the job…"
            : pending
              ? "Creating…"
              : `Create job${ticked.size > 0 ? ` with ${ticked.size} item${ticked.size === 1 ? "" : "s"}` : ""}`}
        </Button>
        <Button variant="ghost" asChild>
          <Link href="/jobs">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}

/**
 * Pre- and post-calibration for one study, yes or no (QA Tech, Nov 2026).
 * Ticked by default when the client's SOP asks; always on for thermal validation.
 */
function CalibrationChoice({ e }: { e: SiteEquipment }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 pb-2 pl-10 text-xs">
      <input type="hidden" name={`cal-${e.id}`} value="1" />
      {(["precal", "postcal"] as const).map((k) => (
        <label key={k} className="inline-flex min-h-8 items-center gap-1.5">
          <input
            type="checkbox"
            name={`${k}-${e.id}`}
            defaultChecked={e.calibration}
            disabled={e.thermal}
            className="size-4 accent-primary"
          />
          {k === "precal" ? "Pre-calibration" : "Post-calibration"}
        </label>
      ))}
      {e.thermal ? (
        <span className="text-muted-foreground">Always on for thermal validation</span>
      ) : null}
    </div>
  );
}
