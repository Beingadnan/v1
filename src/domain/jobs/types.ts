import { machine } from "@/lib/state-machine";

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

/** Columns of the job board, in flow order (data issue and rework share a column with their step; a held job keeps its place). */
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
];

/** Where a job sits on the board: a job on hold stays in the column where it stopped. */
export function boardStatus(status: JobStatus, heldFrom: string | null): JobStatus {
  if (status !== "on_hold") return status;
  return isJobStatus(heldFrom) && heldFrom !== "on_hold" ? heldFrom : "created";
}

/** Statuses after which a job no longer holds loggers or people. */
export const FINISHED: readonly JobStatus[] = ["closed", "cancelled"];
/**
 * While a job is in one of these, its booked instruments are out with it (or
 * about to be): other jobs on overlapping dates can't book them. From Data
 * Received on the loggers are back; the bookings stay as the record of what
 * was used.
 */
export const HOLDS_INSTRUMENTS: readonly JobStatus[] = [
  "created",
  "ready",
  "field_work",
  "data_issue",
  "on_hold",
];
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

/**
 * What the client's order for a job is (QA Tech, Nov 2026): a purchase order or
 * the client's service request form for this job, or an annual contract that
 * covers it: an ARC (annual rate contract) or AMC (annual maintenance contract).
 */
export const ORDER_TYPES = ["po", "srf", "arc", "amc"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];
export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  po: "Purchase order (PO)",
  srf: "Service request form (SRF)",
  arc: "Annual rate contract (ARC)",
  amc: "Annual maintenance contract (AMC)",
};
/** Short names: "PO 4500012345", "ARC QA/ARC/26". */
export const ORDER_TYPE_SHORT: Record<OrderType, string> = {
  po: "PO",
  srf: "SRF",
  arc: "ARC",
  amc: "AMC",
};
/** Order types held on the client as a contract for the year, not per job. */
export const CONTRACT_TYPES = ["arc", "amc"] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];
export const isContractType = (t: string): t is ContractType =>
  (CONTRACT_TYPES as readonly string[]).includes(t);

/**
 * Every readiness key the database accepts. "dates_fit" and "protocol" were
 * dropped from the checklist after the November 2026 demo; rows already stored
 * for them stay, and are no longer shown.
 */
export const READINESS_KEYS = [
  "purchase_order",
  "dates_fit",
  "protocol",
  "site_access",
  "loggers_booked",
  "loggers_valid",
  "masters_valid",
  "previous_report",
] as const;

/** Readiness items QA Tech checks before field work. */
export const READINESS_ITEMS = [
  "purchase_order",
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
    label: "Client's order (PO, SRF, ARC or AMC)",
    calculated: true,
    hint: "Ready when the order number, or the contract covering the job, is on it. It can come later: field work doesn't wait for it.",
  },
  site_access: {
    label: "Client's gate pass",
    calculated: true,
    hint: "The client's entry gate pass number for QA Tech's instruments, or marked not needed. Booking follows it.",
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
    hint: "Needed for thermal validation, or when a study has pre- or post-calibration.",
  },
  previous_report: {
    label: "Previous report on hand",
    calculated: false,
    hint: "For a requalification: the last report, to compare against. Found by itself when it is in QTech.",
  },
};

const live = (except: JobStatus[] = []) =>
  JOB_STATUSES.filter((s) => !FINISHED.includes(s) && !except.includes(s));
const REPORTING: JobStatus[] = [
  "report_draft",
  "rework",
  "checked",
  "sent_to_client",
  "client_signed",
];
const MONEY: JobStatus[] = ["wcr_signed", "invoiced", "paid"];
const others = (list: JobStatus[], s: JobStatus) => list.filter((x) => x !== s);

/**
 * Every move a job's status may make (ADR 0022): what readiness, the data,
 * the analysis, the reports, the WCR and the money move it to by themselves,
 * and hold, resume, cancel, close and reopen. Any live job can be held or
 * cancelled; a held job resumes where it was.
 */
export const JOB_FLOW = machine<JobStatus>("job", JOB_STATUSES, {
  created: ["ready", "on_hold", "cancelled"],
  ready: ["created", "field_work", "on_hold", "cancelled"],
  field_work: ["data_issue", "data_received", "on_hold", "cancelled"],
  data_issue: ["field_work", "data_received", "on_hold", "cancelled"],
  data_received: ["field_work", "data_issue", "analysis", "on_hold", "cancelled"],
  analysis: ["field_work", "data_issue", "report_draft", "on_hold", "cancelled"],
  report_draft: [...others(REPORTING, "report_draft"), ...MONEY, "on_hold", "cancelled"],
  rework: [...others(REPORTING, "rework"), ...MONEY, "on_hold", "cancelled"],
  checked: [...others(REPORTING, "checked"), ...MONEY, "on_hold", "cancelled"],
  sent_to_client: [...others(REPORTING, "sent_to_client"), ...MONEY, "on_hold", "cancelled"],
  client_signed: [...others(REPORTING, "client_signed"), ...MONEY, "on_hold", "cancelled"],
  wcr_signed: ["invoiced", "paid", "on_hold", "cancelled"],
  invoiced: ["wcr_signed", "paid", "on_hold", "cancelled"],
  paid: ["wcr_signed", "invoiced", "closed", "on_hold", "cancelled"],
  closed: ["paid"],
  on_hold: [...live(["on_hold"]), "cancelled"],
  cancelled: [],
});

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

/** People on a job and what they do on it. */
export const TEAM_ROLES = [
  "team_leader",
  "field_engineer",
  "data_provider",
  "report_preparer",
] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];
export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  team_leader: "Team leader",
  field_engineer: "Field engineer",
  data_provider: "Data provider",
  report_preparer: "Report preparer",
};
