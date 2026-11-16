import { AlertTriangle, Check, ChevronLeft, ChevronRight, Printer } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type React from "react";

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

  // Where the job is, as one of the steps QA Tech works through (a held job keeps its place).
  const at = status === "on_hold" ? ((job.heldFrom as JobStatus) ?? "created") : status;
  const step: StepKey =
    at === "created" || at === "ready"
      ? !gateDone
        ? "gate"
        : at === "ready"
          ? "start"
          : "book"
      : at === "field_work"
        ? "field"
        : at === "data_issue" || at === "data_received" || at === "analysis"
          ? "data"
          : REPORT_STEP.includes(at)
            ? "report"
            : at === "closed"
              ? "closed"
              : at === "cancelled"
                ? "closed"
                : "billing";
  const missing = readiness.items.filter(
    (i) =>
      i.blocking && i.state === "pending" && i.key !== "site_access" && i.key !== "loggers_booked",
  );
  const problemStudies = detail.studies.filter((s) => s.dataStatus === "issues");
  const studyLinks = (tab: string | null, list = detail.studies) => (
    <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
      {list.map((s) => (
        <li key={s.id}>
          <Link
            href={`/studies/${s.id}${tab ? `?tab=${tab}` : ""}`}
            className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-primary/5"
          >
            <span>
              <span className="font-medium text-primary">{s.equipment.code}</span>{" "}
              <span className="text-muted-foreground">{s.equipment.name}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
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
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );

  let next: { title: string; text: string; body?: React.ReactNode } | null;
  if (status === "cancelled") {
    next = { title: "Job cancelled", text: job.cancelledReason || "Nothing more to do." };
  } else if (status === "on_hold") {
    next = {
      title: "Job on hold",
      text: `${job.holdReason || "On hold."} Resume it to carry on from ${STEPS.find((x) => x.key === step)!.label.toLowerCase()}.`,
      body: canManage ? <StatusButtons jobId={job.id} allowed={["resume"]} /> : undefined,
    };
  } else if (step === "gate") {
    next = {
      title: "Enter the client's gate pass",
      text: "The number on the client's gate pass for QA Tech's instruments. Logger booking opens once it is in.",
      body: canBook ? (
        <GatePassForm jobId={job.id} number={job.gatePassNumber} hasScan={!!job.gatePassFileId} />
      ) : (
        <p className="text-sm text-muted-foreground">The team leader enters it.</p>
      ),
    };
  } else if (step === "book") {
    next = {
      title: `Book ${needed} logger${needed === 1 ? "" : "s"}${mastersNeeded ? " and the masters" : ""}`,
      text: mastersNeeded
        ? `Loggers for the studies, and a master for pre/post-calibration: ${masters.length} booked.`
        : "One logger per position in the studies.",
      body: (
        <div className="flex flex-col gap-3">
          {/* Problems with what is booked (out of date, no master); none before any booking. */}
          {missing.length && detail.booked.length ? (
            <ul className="flex flex-col gap-1 text-sm text-attention">
              {missing.map((m) => (
                <li key={m.key} className="flex gap-1.5">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {m.detail || m.label}
                </li>
              ))}
            </ul>
          ) : null}
          {canBook && mastersNeeded ? (
            <div>
              <AutoBookButton
                jobId={job.id}
                label={masters.length ? "Book masters again" : "Book masters"}
              />
            </div>
          ) : null}
          {choices ? (
            <BookingPicker jobId={job.id} choices={choices} />
          ) : !canBook ? (
            <p className="text-sm text-muted-foreground">The team leader books them.</p>
          ) : null}
        </div>
      ),
    };
  } else if (step === "start") {
    next = {
      title: "Ready: start field work",
      text: "Everything is booked and valid for the visit. Start field work when the team leaves for site.",
      body: canManage ? <StatusButtons jobId={job.id} allowed={["start_field_work"]} /> : undefined,
    };
  } else if (step === "field") {
    next = {
      title: "The team is on site",
      text: "On each equipment's page the engineer lays out the positions, places the loggers and records start and end.",
      body: studyLinks(null),
    };
  } else if (step === "data") {
    next =
      problemStudies.length > 0
        ? {
            title: "Fix the data problems",
            text: "The uploaded data has gaps or errors. Open the Data tab, accept with a reason or upload again.",
            body: studyLinks("data", problemStudies),
          }
        : status === "data_received" || status === "analysis"
          ? {
              title: "Data is in: run the analysis",
              text: "Open each equipment's Analysis tab, then draft its report.",
              body: studyLinks("analysis"),
            }
          : {
              title: "Upload the logger data",
              text: "Open each equipment's Data tab and upload the logger export.",
              body: studyLinks("data"),
            };
  } else if (step === "report") {
    next = {
      title: "Finish the reports",
      text: "Each report is checked by QA Tech, then sent to the client to sign.",
      body: studyLinks("report"),
    };
  } else if (step === "billing") {
    next = {
      title: "WCR, invoice and payment",
      text: "Get the WCR signed, record the invoice and the payment, then close the job (below).",
    };
  } else {
    next = { title: "Job closed", text: "All done. The reports are in the archive." };
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-2">
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
            canManage && !finished ? (
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
      </div>

      <JobSteps current={step} status={status} />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <section
            aria-labelledby="next"
            className="flex flex-col gap-3 rounded-lg border-2 border-primary/40 bg-surface p-4"
          >
            <div>
              <p className="text-xs font-semibold tracking-wide text-primary uppercase">
                What to do now
              </p>
              <h2 id="next" className="text-lg font-semibold">
                {next.title}
              </h2>
              <p className="text-sm text-muted-foreground">{next.text}</p>
            </div>
            {planning && detail.datesWarning ? (
              <p className="flex gap-1.5 text-sm text-attention">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {detail.datesWarning}
              </p>
            ) : null}
            {next.body}
          </section>

          {money ? <MoneyPanel jobId={job.id} m={money} /> : null}

          <section aria-labelledby="studies" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="studies" className="font-semibold">
                Equipment ({detail.studies.length})
              </h2>
              {canManage && planning ? (
                <AddStudiesButton jobId={job.id} equipment={addable} />
              ) : null}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Equipment</TableHead>
                  <TableHead>Work</TableHead>
                  <TableHead className="text-right">Loggers</TableHead>
                  <TableHead>Progress</TableHead>
                  {canManage && planning ? (
                    <TableHead>
                      <span className="sr-only">Change</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.studies.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link
                        href={`/studies/${s.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {s.equipment.code}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {s.equipment.name}
                        {s.equipment.department ? ` · ${s.equipment.department}` : ""}
                      </p>
                    </TableCell>
                    <TableCell>
                      {WORK_TYPE_LABELS[s.workType as WorkType] ?? s.workType}
                      <p className="text-xs text-muted-foreground">
                        {[
                          s.durationHours ? `${s.durationHours} h` : null,
                          s.intervalMinutes ? `every ${s.intervalMinutes} min` : null,
                          calibrationOf(s).pre ? "pre-cal" : null,
                          calibrationOf(s).post ? "post-cal" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </TableCell>
                    <TableCell className="tabular text-right">{s.loggerCount}</TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
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
                        {s.status !== "planned" ? (
                          <Link
                            href={`/studies/${s.id}?tab=data`}
                            className={cn(
                              "text-xs hover:underline",
                              s.dataStatus === "issues" ? "text-fail" : "text-muted-foreground",
                            )}
                          >
                            {DATA_LABEL[s.dataStatus] ?? "Data"}
                          </Link>
                        ) : null}
                      </div>
                    </TableCell>
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

          {detail.booked.length > 0 ? (
            <section aria-labelledby="kit" className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="kit" className="font-semibold">
                  Booked: {loggers.length} logger{loggers.length === 1 ? "" : "s"}
                  {masters.length
                    ? `, ${masters.length} master${masters.length === 1 ? "" : "s"}`
                    : ""}
                </h2>
                <Button variant="secondary" size="sm" asChild>
                  <a href={`/jobs/${job.id}/gate-pass`} target="_blank" rel="noreferrer">
                    <Printer aria-hidden="true" />
                    Gate pass list
                  </a>
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead className="hidden sm:table-cell">Model</TableHead>
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
                      <TableCell>
                        {b.problem ? (
                          <span className="flex gap-1 text-xs text-fail">
                            <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                            {b.problem.replace(`${b.code} `, "")}
                          </span>
                        ) : b.certificate?.validUntil ? (
                          dmy(b.certificate.validUntil)
                        ) : b.certificate ? (
                          "No due date"
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
            </section>
          ) : null}
        </div>

        <aside className="flex flex-col gap-4">
          <section
            aria-labelledby="facts"
            className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 text-sm"
          >
            <h2 id="facts" className="sr-only">
              Job details
            </h2>
            <Fact label="Status">
              <StatusBadge tone={statusTone(status)}>{JOB_STATUS_LABELS[status]}</StatusBadge>
            </Fact>
            <Fact label="Client's order">
              <span className={orderPending ? "text-attention" : undefined}>{orderText}</span>
              {detail.order.file ? (
                <a
                  href={`/jobs/${job.id}/order`}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 text-primary underline"
                >
                  copy
                </a>
              ) : null}
              {canRecordOrder ? (
                <div className="mt-1">
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
                </div>
              ) : null}
            </Fact>
            {detail.value ? (
              <Fact label="Value">
                {job.poValue ? (
                  rupees(job.poValue)
                ) : (
                  <span className="text-attention">Pending</span>
                )}
                {detail.value.source === "quote" ? (
                  <span className="block text-xs text-muted-foreground">
                    Quoted earlier {formatInr(detail.value.expected!)}
                  </span>
                ) : null}
              </Fact>
            ) : null}
            {gateDone ? (
              <Fact label="Gate pass">
                {gateItem?.detail}
                {canBook ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-primary underline">
                      Change
                    </summary>
                    <GatePassForm
                      jobId={job.id}
                      number={job.gatePassNumber}
                      hasScan={!!job.gatePassFileId}
                    />
                  </details>
                ) : null}
              </Fact>
            ) : null}
            {detail.qaSite ? <Fact label="From">{detail.qaSite.name}</Fact> : null}
            <Fact label="Team">
              {detail.team.length === 0 ? (
                <span className="text-muted-foreground">Nobody yet</span>
              ) : (
                <ul>
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
                <p key={c.userId} className="mt-1 flex gap-1.5 text-xs text-attention">
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
              {canManage && !finished ? (
                <div className="mt-1">
                  <TeamButton
                    jobId={job.id}
                    staff={staff}
                    current={detail.team.map((t) => ({ userId: t.userId, role: t.role }))}
                  />
                </div>
              ) : null}
            </Fact>
            {job.notes ? (
              <Fact label="Notes">
                <span className="whitespace-pre-wrap">{job.notes}</span>
              </Fact>
            ) : null}
          </section>

          {canManage && (allowed.includes("hold") || allowed.includes("cancel")) ? (
            <StatusButtons
              jobId={job.id}
              allowed={allowed.filter((t) => t === "hold" || t === "cancel")}
            />
          ) : null}

          <details className="rounded-lg border border-border bg-surface p-4 text-sm">
            <summary className="cursor-pointer font-semibold">History</summary>
            <ol className="mt-3 flex flex-col gap-2 border-l border-border pl-4">
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
          </details>
        </aside>
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div>{children}</div>
    </div>
  );
}

type StepKey = "gate" | "book" | "start" | "field" | "data" | "report" | "billing" | "closed";
const STEPS: { key: StepKey; label: string }[] = [
  { key: "gate", label: "Gate pass" },
  { key: "book", label: "Book loggers" },
  { key: "start", label: "Start" },
  { key: "field", label: "Field work" },
  { key: "data", label: "Data" },
  { key: "report", label: "Report" },
  { key: "billing", label: "Billing" },
  { key: "closed", label: "Closed" },
];
const REPORT_STEP: JobStatus[] = [
  "report_draft",
  "rework",
  "checked",
  "sent_to_client",
  "client_signed",
];

/** The job's steps in order: done ones ticked, the current one marked. */
function JobSteps({ current, status }: { current: StepKey; status: JobStatus }) {
  const at = STEPS.findIndex((s) => s.key === current);
  const done = status === "closed";
  return (
    <nav aria-label="Job progress">
      <p className="text-sm text-muted-foreground sm:hidden">
        Step {at + 1} of {STEPS.length}:{" "}
        <span className="font-medium text-foreground">{STEPS[at]!.label}</span>
      </p>
      <ol className="hidden items-center gap-1 sm:flex">
        {STEPS.map((s, i) => {
          const past = i < at || done;
          const here = i === at && !done;
          return (
            <li key={s.key} className="flex min-w-0 flex-1 items-center gap-1">
              <span
                aria-current={here ? "step" : undefined}
                className={cn(
                  "flex min-w-0 items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium whitespace-nowrap",
                  here
                    ? status === "on_hold" || status === "cancelled"
                      ? "bg-attention-soft text-attention"
                      : "bg-primary text-primary-foreground"
                    : past
                      ? "text-pass"
                      : "text-muted-foreground",
                )}
              >
                {past ? (
                  <Check className="size-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px]",
                      here ? "border-primary-foreground" : "border-border",
                    )}
                  >
                    {i + 1}
                  </span>
                )}
                <span className="truncate">{s.label}</span>
              </span>
              {i < STEPS.length - 1 ? (
                <span
                  className={cn("h-px flex-1", past ? "bg-pass" : "bg-border")}
                  aria-hidden="true"
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
