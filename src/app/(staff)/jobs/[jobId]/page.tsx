import {
  AlertTriangle,
  ChevronLeft,
  Printer,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/db/client";
import { STUDY_CYCLE_LABELS, type StudyCycle } from "@/domain/clients/study-defaults";
import { STUDY_STATUS_LABELS, type StudyStatus } from "@/domain/field/types";
import { jobMoney } from "@/domain/billing/queries";
import { formatInr } from "@/domain/jobs/pricing";
import { calibrationOf } from "@/domain/jobs/studies";
import { bookingChoices } from "@/domain/jobs/job-service";
import {
  findJob,
  jobDetail,
  qaSiteOptions,
  siteEquipment,
  staffOptions,
} from "@/domain/jobs/queries";
import { can } from "@/domain/auth/permissions";
import { TEAM_ROLE_LABELS, type TeamRole } from "@/domain/jobs/schemas";
import {
  HOLDS_INSTRUMENTS,
  JOB_STATUS_LABELS,
  ORDER_TYPE_SHORT,
  PLANNING,
  TRANSITIONS,
  WORK_TYPE_LABELS,
  canTransition,
  type JobStatus,
  type Transition,
  type WorkType,
} from "@/domain/jobs/types";
import { requirePermission } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { dateRange, rupees, statusTone } from "../display";
import {
  AddStudiesButton,
  AutoBookButton,
  EditJobButton,
  EditStudyButton,
  ReleaseButton,
  RemoveStudyButton,
  StatusButtons,
  TeamButton,
} from "./job-controls";
import { MoneyPanel } from "./money-panel";
import { BookingPicker, GatePassForm } from "./booking-controls";
import { RecordOrderButton } from "./order-controls";

/** Job statuses at which the WCR, invoices and closing are shown (phase 10). */
const LATE: JobStatus[] = [
  "rework",
  "checked",
  "sent_to_client",
  "client_signed",
  "wcr_signed",
  "invoiced",
  "paid",
  "closed",
];

export async function generateMetadata({ params }: PageProps<"/jobs/[jobId]">) {
  void params;
  return { title: "Job" };
}

const dmy = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "");

const DATA_LABEL: Record<string, string> = {
  none: "Data: not in",
  issues: "Data: problems",
  checked: "Data: checked",
  received: "Data: received ✓",
};

export default async function JobPage({ params }: PageProps<"/jobs/[jobId]">) {
  const actor = await requirePermission("jobs.view");
  const { jobId } = await params;
  // The pickers don't depend on the job: read them while the job loads.
  const pickers = can(actor, "jobs.manage")
    ? Promise.all([staffOptions(db, actor), qaSiteOptions(db, actor)])
    : null;
  const row = await findJob(db, actor, jobId);
  if (!row) notFound();
  // Everything else in one round, decided from the job itself (ADR 0018): the details,
  // the equipment to add while planning, the money once the work is done, and the
  // loggers to book once the client's gate pass is in.
  const was = row.job.status as JobStatus;
  const manage = can(actor, "jobs.manage");
  const stillPlanning =
    PLANNING.includes(was) ||
    (was === "on_hold" && PLANNING.includes(row.job.heldFrom as JobStatus));
  const gateOnJob = row.job.gatePassNumber.trim() !== "" || row.job.gatePassNotNeeded;
  const [detail, picked, equipment, money, early] = await Promise.all([
    jobDetail(db, actor, row),
    pickers ?? Promise.resolve(null),
    manage && stillPlanning
      ? siteEquipment(db, actor, row.job.clientSiteId)
      : Promise.resolve([] as Awaited<ReturnType<typeof siteEquipment>>),
    LATE.includes(was)
      ? jobMoney(db, actor, row.job.id, { job: row.job, terms: row.terms })
      : Promise.resolve(null),
    manage && HOLDS_INSTRUMENTS.includes(was) && gateOnJob
      ? bookingChoices(db, actor, row.job.id, { job: row.job })
      : Promise.resolve(null),
  ]);
  const { job, status, readiness, canManage } = detail;
  const planning =
    PLANNING.includes(status) ||
    (status === "on_hold" && PLANNING.includes(job.heldFrom as JobStatus));
  const finished = status === "closed" || status === "cancelled";
  // The client's order: a PO/SRF number, or the ARC/AMC it is done under (QA Tech, Nov 2026).
  const orderItem = readiness.items.find((i) => i.key === "purchase_order");
  const orderPending = orderItem?.state === "pending";
  const short = ORDER_TYPE_SHORT[detail.order.type];
  const orderText = detail.order.contract
    ? `${short} ${detail.order.contract.number}${job.poNumber ? ` · release order ${job.poNumber}` : ""}`
    : job.poNumber
      ? `${short} ${job.poNumber}${job.poDate ? ` of ${dmy(job.poDate)}` : ""}`
      : `${short} pending`;
  const canRecordOrder = !finished && (canManage || can(actor, "billing.record"));
  const canBook = canManage && HOLDS_INSTRUMENTS.includes(status);
  // The booking follows the client's gate pass (QA Tech, Nov 2026).
  const gateItem = readiness.items.find((i) => i.key === "site_access");
  const gateDone = gateItem?.state !== "pending";
  const mastersNeeded = readiness.items.find((i) => i.key === "masters_valid")?.state !== "na";
  // A gate pass ticked by hand before the gate pass step only shows in the readiness:
  // then the booking choices come one round later.
  const choices =
    canBook && gateDone
      ? (early ??
        (await bookingChoices(db, actor, job.id, {
          job: detail.loaded.job,
          input: detail.loaded.input,
        })))
      : null;
  const [staff, qaSites] = canManage && picked ? picked : [[], []];
  const onJob = new Set(detail.studies.map((s) => s.equipmentId));
  const addable = equipment.filter((e) => !onJob.has(e.id));
  const allowed = (Object.keys(TRANSITIONS) as Transition[]).filter((t) =>
    canTransition(status, t),
  );
  const loggers = detail.booked.filter((b) => b.tier !== "master");
  const masters = detail.booked.filter((b) => b.tier === "master");
  const needed = detail.studies.reduce(
    (n, s) => n + (s.workType === "onsite_calibration" ? 0 : s.loggerCount),
    0,
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/jobs"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-primary"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Jobs
        </Link>
        <PageHeader
          title={job.number}
          description={
            <>
              <Link href={`/clients/${detail.company.id}`} className="text-primary hover:underline">
                {detail.company.name}
              </Link>{" "}
              · {detail.site.name} · {dateRange(job.plannedStart, job.plannedEnd)}
              {job.title ? ` · ${job.title}` : ""}
            </>
          }
          action={
            canManage && status !== "closed" && status !== "cancelled" ? (
              <EditJobButton
                jobId={job.id}
                qaSites={qaSites}
                canSeeMoney={detail.canSeeMoney}
                contracts={detail.contracts}
                values={{
                  siteId: job.siteId ?? "",
                  title: job.title,
                  orderType: job.orderType,
                  contractId: job.contractId ?? "",
                  poNumber: job.poNumber,
                  poDate: job.poDate ?? "",
                  poValue: job.poValue ?? "",
                  plannedStart: job.plannedStart,
                  plannedEnd: job.plannedEnd,
                  notes: job.notes,
                }}
              />
            ) : undefined
          }
        />
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge tone={statusTone(status)}>{JOB_STATUS_LABELS[status]}</StatusBadge>
          {status === "on_hold" && job.holdReason ? (
            <span className="text-sm text-attention">On hold: {job.holdReason}</span>
          ) : null}
          {status === "cancelled" && job.cancelledReason ? (
            <span className="text-sm text-fail">Cancelled: {job.cancelledReason}</span>
          ) : null}
          <span
            className={cn("text-sm", orderPending ? "text-attention" : "text-muted-foreground")}
          >
            {orderText}
            {detail.order.file ? (
              <>
                {" · "}
                <a
                  href={`/jobs/${job.id}/order`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  copy
                </a>
              </>
            ) : null}
          </span>
          {canRecordOrder ? (
            <RecordOrderButton
              jobId={job.id}
              contracts={detail.contracts}
              canSeeMoney={detail.canSeeMoney}
              start={job.plannedStart}
              file={detail.order.file}
              pending={orderPending}
              values={{
                orderType: job.orderType,
                contractId: job.contractId ?? "",
                poNumber: job.poNumber,
                poDate: job.poDate ?? "",
                poValue: job.poValue ?? "",
              }}
            />
          ) : null}
          {detail.qaSite ? (
            <span className="text-sm text-muted-foreground">From {detail.qaSite.name}</span>
          ) : null}
        </div>
        {planning && detail.datesWarning ? (
          <p className="flex gap-1.5 text-sm text-attention">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {detail.datesWarning}
          </p>
        ) : null}
      </div>

      {canManage && allowed.length > 0 ? <StatusButtons jobId={job.id} allowed={allowed} /> : null}

      {/* Team and the job's facts side by side; each step shows what it still needs. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="contents">
          <section
            aria-labelledby="team"
            className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 id="team" className="font-semibold">
                Team
              </h2>
              {canManage && status !== "closed" && status !== "cancelled" ? (
                <TeamButton
                  jobId={job.id}
                  staff={staff}
                  current={detail.team.map((t) => ({ userId: t.userId, role: t.role }))}
                />
              ) : null}
            </div>
            {detail.team.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nobody yet.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {detail.team.map((t) => (
                  <li key={`${t.userId}-${t.role}`}>
                    {t.name}{" "}
                    <span className="text-muted-foreground">
                      · {TEAM_ROLE_LABELS[t.role as TeamRole] ?? t.role}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {detail.teamClashes.map((c) => (
              <p key={c.userId} className="flex gap-1.5 text-xs text-attention">
                <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {c.name} is also on{" "}
                  {c.jobs.map((j, i) => (
                    <span key={j.id}>
                      {i > 0 ? ", " : ""}
                      <Link href={`/jobs/${j.id}`} className="underline">
                        {j.number}
                      </Link>
                    </span>
                  ))}{" "}
                  on these dates.
                </span>
              </p>
            ))}
          </section>

          {detail.value ? (
            <section
              aria-labelledby="value"
              className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-sm"
            >
              <h2 id="value" className="font-semibold">
                Value
              </h2>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">{short} value</dt>
                <dd className="text-right">
                  {job.poValue ? (
                    rupees(job.poValue)
                  ) : (
                    <span className="text-attention">Pending</span>
                  )}
                </dd>
                {detail.value.source === "quote" ? (
                  <>
                    <dt className="text-muted-foreground">Quoted earlier</dt>
                    <dd className="text-right">{formatInr(detail.value.expected!)}</dd>
                  </>
                ) : null}
              </dl>
            </section>
          ) : null}
        </div>
      </div>

      {money ? <MoneyPanel jobId={job.id} m={money} /> : null}

      <section aria-labelledby="studies" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="studies" className="font-semibold">
            Studies ({detail.studies.length})
            {detail.studies.some((st) => st.status !== "planned") ? (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {detail.studies.filter((st) => st.status === "completed").length} of{" "}
                {detail.studies.length} done
              </span>
            ) : null}
          </h2>
          {canManage && planning ? <AddStudiesButton jobId={job.id} equipment={addable} /> : null}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Equipment</TableHead>
              <TableHead>Work</TableHead>
              <TableHead className="hidden md:table-cell">Report number</TableHead>
              <TableHead className="text-right">Loggers</TableHead>
              {canManage && planning ? (
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.studies.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <Link
                    href={`/clients/${detail.company.id}/equipment/${s.equipment.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {s.equipment.code}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {s.equipment.name}
                    {s.equipment.department ? ` · ${s.equipment.department}` : ""}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                    <StatusBadge
                      tone={
                        s.status === "completed"
                          ? "pass"
                          : s.status === "in_progress"
                            ? "info"
                            : "neutral"
                      }
                    >
                      {STUDY_STATUS_LABELS[s.status as StudyStatus] ?? s.status}
                    </StatusBadge>
                    <Link href={`/studies/${s.id}`} className="text-primary hover:underline">
                      Field work
                    </Link>
                    {s.status !== "planned" ? (
                      <Link
                        href={`/studies/${s.id}?tab=data`}
                        className={cn(
                          "hover:underline",
                          s.dataStatus === "issues" ? "text-fail" : "text-primary",
                        )}
                      >
                        {DATA_LABEL[s.dataStatus] ?? "Data"}
                      </Link>
                    ) : null}
                    <a
                      href={`/studies/${s.id}/ft12`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      FT-12
                    </a>
                  </p>
                  <p className="font-mono text-[11px] break-all text-muted-foreground md:hidden">
                    {s.reportNumber}
                  </p>
                </TableCell>
                <TableCell>
                  {WORK_TYPE_LABELS[s.workType as WorkType] ?? s.workType}
                  <p className="text-xs text-muted-foreground">
                    {[
                      s.cycles.map((c) => STUDY_CYCLE_LABELS[c as StudyCycle] ?? c).join(", "),
                      s.durationHours ? `${s.durationHours} h` : null,
                      s.intervalMinutes ? `every ${s.intervalMinutes} min` : null,
                      s.season ? s.season : null,
                      calibrationOf(s).pre ? "pre-cal" : null,
                      calibrationOf(s).post ? "post-cal" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </TableCell>
                <TableCell className="hidden max-w-72 font-mono text-xs break-all md:table-cell">
                  {s.reportNumber}
                </TableCell>
                <TableCell className="text-right">{s.loggerCount}</TableCell>
                {canManage && planning ? (
                  <TableCell className="text-right whitespace-nowrap">
                    <EditStudyButton
                      jobId={job.id}
                      study={{
                        id: s.id,
                        code: s.equipment.code,
                        workType: s.workType,
                        loggerCount: s.loggerCount,
                        cycles: s.cycles,
                        season: s.season,
                        durationHours: s.durationHours,
                        intervalMinutes: s.intervalMinutes,
                        preCalRequired: s.preCalRequired,
                        postCalRequired: s.postCalRequired,
                      }}
                    />
                    <RemoveStudyButton jobId={job.id} studyId={s.id} code={s.equipment.code} />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section aria-labelledby="kit" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id="kit" className="font-semibold">
              Loggers and masters
            </h2>
            <p className="text-sm text-muted-foreground">
              {loggers.length > needed
                ? `${loggers.length} loggers booked for ${needed} (${loggers.length - needed} spare)`
                : `${loggers.length} of ${needed} logger${needed === 1 ? "" : "s"} booked`}
              {masters.length > 0
                ? ` · ${masters.length} master${masters.length === 1 ? "" : "s"}`
                : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            {gateDone && (job.gatePassNumber || detail.booked.length > 0) ? (
              <Button variant="secondary" size="sm" asChild>
                <a href={`/jobs/${job.id}/gate-pass`} target="_blank" rel="noreferrer">
                  <Printer aria-hidden="true" />
                  Gate pass list
                </a>
              </Button>
            ) : null}
            {canBook && gateDone && mastersNeeded ? (
              <AutoBookButton
                jobId={job.id}
                label={masters.length ? "Book masters again" : "Book masters"}
              />
            ) : null}
          </div>
        </div>
        {canBook ? (
          gateDone ? (
            <>
              <div className="text-sm text-muted-foreground">
                Gate pass: {gateItem?.detail}{" "}
                <details className="inline">
                  <summary className="inline cursor-pointer text-primary underline">change</summary>
                  <GatePassForm
                    jobId={job.id}
                    number={job.gatePassNumber}
                    hasScan={!!job.gatePassFileId}
                  />
                </details>
              </div>
              {choices ? <BookingPicker jobId={job.id} choices={choices} /> : null}
            </>
          ) : (
            <GatePassForm
              jobId={job.id}
              number={job.gatePassNumber}
              hasScan={!!job.gatePassFileId}
            />
          )
        ) : null}
        {detail.booked.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            None booked yet. {canBook && !gateDone ? "Enter the client's gate pass first." : ""}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead className="hidden sm:table-cell">Model</TableHead>
                <TableHead className="hidden sm:table-cell">Certificate</TableHead>
                <TableHead>Valid until</TableHead>
                {canBook ? (
                  <TableHead>
                    <span className="sr-only">Release</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.booked.map((b) => (
                <TableRow
                  key={b.id}
                  className={b.problem || b.alsoOn.length ? "bg-fail-soft/40" : undefined}
                >
                  <TableCell>
                    <Link
                      href={`/instruments/${b.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {b.code}
                    </Link>
                    {b.tier === "master" ? (
                      <span className="ml-1 text-xs text-muted-foreground">master</span>
                    ) : null}
                    <p className="text-xs text-muted-foreground">{b.serialNo}</p>
                  </TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">{b.model}</TableCell>
                  <TableCell className="hidden font-mono text-xs sm:table-cell">
                    {b.certificate?.number ?? "—"}
                  </TableCell>
                  <TableCell>
                    {b.problem ? (
                      <span className="flex gap-1 text-xs text-fail">
                        <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                        {b.problem.replace(`${b.code} `, "")}
                      </span>
                    ) : b.certificate ? (
                      b.certificate.validUntil ? (
                        dmy(b.certificate.validUntil)
                      ) : (
                        "No due date"
                      )
                    ) : null}
                    {b.alsoOn.length ? (
                      <p className="text-xs text-fail">Also booked on {b.alsoOn.join(", ")}</p>
                    ) : null}
                  </TableCell>
                  {canBook ? (
                    <TableCell className="text-right">
                      <ReleaseButton jobId={job.id} instrumentId={b.id} code={b.code} />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      {job.notes ? (
        <section aria-labelledby="notes" className="flex flex-col gap-1">
          <h2 id="notes" className="font-semibold">
            Notes
          </h2>
          <p className="text-sm whitespace-pre-wrap">{job.notes}</p>
        </section>
      ) : null}

      <section aria-labelledby="timeline" className="flex flex-col gap-2">
        <h2 id="timeline" className="font-semibold">
          Timeline
        </h2>
        <ol className="flex flex-col gap-2 border-l border-border pl-4 text-sm">
          {detail.history.map((h) => (
            <li key={h.id}>
              <p>
                <strong>{JOB_STATUS_LABELS[h.toStatus as JobStatus] ?? h.toStatus}</strong>
                <span className="text-muted-foreground">
                  {" "}
                  · {formatDateTime(h.at)}
                  {h.by ? ` · ${h.by}` : ""}
                </span>
              </p>
              {h.reason ? <p className="text-xs text-muted-foreground">{h.reason}</p> : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
