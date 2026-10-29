/**
 * Jobs: the vocabulary shared by the database checks, the services and the
 * screens. Statuses follow QA Tech's flow (plan document, confirmed 28 Oct 2026).
 */

export const JOB_STATUSES = [
  "created",
  "ready",
  "field_work",
  "data_issue",
  "data_received",
  "analysis",
  "report_draft",
  "rework",
  "checked",
  "sent_to_client",
  "client_signed",
  "wcr_signed",
  "invoiced",
  "paid",
  "closed",
  "on_hold",
  "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  created: "Created",
  ready: "Ready",
  field_work: "Field work",
  data_issue: "Data issue",
  data_received: "Data received",
  analysis: "Analysis",
  report_draft: "Report draft",
  rework: "Rework",
  checked: "Checked",
  sent_to_client: "Sent to client",
  client_signed: "Client signed",
  wcr_signed: "WCR signed",
  invoiced: "Invoiced",
  paid: "Paid",
  closed: "Closed",
  on_hold: "On hold",
  cancelled: "Cancelled",
};

/** Columns of the job board, in flow order (data issue and rework share a column with their step). */
export const BOARD_COLUMNS: { key: string; label: string; statuses: JobStatus[] }[] = [
  { key: "created", label: "Created", statuses: ["created"] },
  { key: "ready", label: "Ready", statuses: ["ready"] },
  { key: "field_work", label: "Field work", statuses: ["field_work"] },
  { key: "data", label: "Data", statuses: ["data_issue", "data_received"] },
  {
    key: "report",
    label: "Analysis & report",
    statuses: ["analysis", "report_draft", "rework", "checked"],
  },
  {
    key: "client",
    label: "With client",
    statuses: ["sent_to_client", "client_signed", "wcr_signed"],
  },
  { key: "money", label: "Invoice & payment", statuses: ["invoiced", "paid"] },
  { key: "on_hold", label: "On hold", statuses: ["on_hold"] },
];

/** Statuses after which a job no longer holds loggers or people. */
export const FINISHED: readonly JobStatus[] = ["closed", "cancelled"];
/** Before field work starts, the job can still be edited freely. */
export const PLANNING: readonly JobStatus[] = ["created", "ready"];

export const WORK_TYPES = [
  "temperature_mapping",
  "temperature_rh_mapping",
  "thermal_validation",
  "onsite_calibration",
] as const;
export type WorkType = (typeof WORK_TYPES)[number];

export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  temperature_mapping: "Temperature mapping",
  temperature_rh_mapping: "Temperature + RH mapping",
  thermal_validation: "Thermal validation (autoclave, oven, SIP)",
  onsite_calibration: "Pre/post calibration on site",
};

export const SEASONS = ["", "summer", "winter", "monsoon"] as const;
export type Season = (typeof SEASONS)[number];

/** How a rate-card price is multiplied. */
export const RATE_BASES = ["per_study", "per_cycle", "per_logger", "per_m3"] as const;
export type RateBasis = (typeof RATE_BASES)[number];
export const RATE_BASIS_LABELS: Record<RateBasis, string> = {
  per_study: "per study",
  per_cycle: "per cycle",
  per_logger: "per logger / probe",
  per_m3: "per m³",
};

/** Readiness items QA Tech checks before field work. */
export const READINESS_ITEMS = [
  "purchase_order",
  "protocol",
  "site_access",
  "loggers_booked",
  "loggers_valid",
  "masters_valid",
  "previous_report",
] as const;
export type ReadinessKey = (typeof READINESS_ITEMS)[number];
export type ReadinessState = "ready" | "pending" | "na";

export const READINESS_INFO: Record<
  ReadinessKey,
  { label: string; calculated: boolean; hint: string }
> = {
  purchase_order: {
    label: "Purchase order",
    calculated: true,
    hint: "Ready when the PO number is on the job.",
  },
  protocol: {
    label: "Approved protocol",
    calculated: false,
    hint: "The client's or QA Tech's mapping protocol, approved before the study (WHO TRS 961 Suppl. 8 §2.2).",
  },
  site_access: {
    label: "Site access / gate pass",
    calculated: false,
    hint: "Gate pass, permits or safety induction arranged with the client.",
  },
  loggers_booked: {
    label: "Logger set booked",
    calculated: true,
    hint: "Enough loggers booked for every study.",
  },
  loggers_valid: {
    label: "Loggers calibrated through the study",
    calculated: true,
    hint: "Each booked logger's certificate is dated on or before the start and due on or after the end.",
  },
  masters_valid: {
    label: "Masters valid (pre/post-cal)",
    calculated: true,
    hint: "Needed for thermal validation, or when the client's SOP asks for post-calibration.",
  },
  previous_report: {
    label: "Previous report on hand",
    calculated: false,
    hint: "For a requalification: the last report, to compare against.",
  },
};

export type Transition = "start_field_work" | "hold" | "resume" | "cancel";

/**
 * Which status a manual action may leave from. Readiness moves a job between
 * Created and Ready by itself; later phases move it on from Field Work.
 */
export const TRANSITIONS: Record<Transition, { from: readonly JobStatus[]; label: string }> = {
  start_field_work: { from: ["ready"], label: "Start field work" },
  hold: {
    from: JOB_STATUSES.filter((s) => s !== "on_hold" && !FINISHED.includes(s)),
    label: "Put on hold",
  },
  resume: { from: ["on_hold"], label: "Resume" },
  cancel: {
    from: JOB_STATUSES.filter((s) => !FINISHED.includes(s)),
    label: "Cancel job",
  },
};

export function canTransition(status: JobStatus, transition: Transition): boolean {
  return TRANSITIONS[transition].from.includes(status);
}

export function isJobStatus(v: unknown): v is JobStatus {
  return typeof v === "string" && (JOB_STATUSES as readonly string[]).includes(v);
}
export function isWorkType(v: unknown): v is WorkType {
  return typeof v === "string" && (WORK_TYPES as readonly string[]).includes(v);
}
