/**
 * Roles in the QTech platform. Kept in plain TypeScript (no framework) so the
 * database CHECK constraint, the permission matrix and the UI all use one list.
 */
export const STAFF_ROLES = [
  "admin",
  "manager",
  "team_leader",
  "report_preparer",
  "field_engineer",
  "lab",
  "accounts",
] as const;

export const CLIENT_ROLES = ["client_qa", "client_qa_head"] as const;

export const ROLES = [...STAFF_ROLES, ...CLIENT_ROLES] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];
export type ClientRole = (typeof CLIENT_ROLES)[number];
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  team_leader: "Team leader (checker)",
  report_preparer: "Report preparer",
  field_engineer: "Field engineer",
  lab: "Lab calibration",
  accounts: "Accounts",
  client_qa: "Client QA",
  client_qa_head: "Client QA head",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Manages users and settings. Sees everything.",
  manager: "Creates jobs, assigns teams, follows every job and invoice.",
  team_leader: "Owns jobs and checks reports (signs Checked By).",
  report_preparer: "Builds reports and certificates (signs Done By).",
  field_engineer: "Places loggers, runs pre/post-calibration, uploads raw data.",
  lab: "Calibrates the logger fleet and keeps master certificates current.",
  accounts: "Records Tally invoice numbers and payments.",
  client_qa: "Client user who reviews released reports.",
  client_qa_head: "Client QA head who approves reports and decides on deviations.",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function isClientRole(role: Role): role is ClientRole {
  return (CLIENT_ROLES as readonly string[]).includes(role);
}
