import type { Role } from "./roles";

/**
 * What each role may do. Every server action, route handler and domain service
 * calls `can()` (or `assertCan()`); the UI only hides what a role cannot do.
 *
 * New modules add their actions here in the phase that builds them.
 */
export const ACTIONS = [
  "users.view",
  "users.manage",
  "settings.view",
  "settings.manage",
  "audit.view",
  "files.upload",
  "files.view",
  "clients.view",
  "clients.manage",
  "instruments.view",
  "instruments.manage",
  "calibration.perform",
  "calibration.check",
  "calibration.approve",
  "jobs.view",
  "jobs.manage",
  "jobs.money",
  "ratecard.manage",
  "field.perform",
  "data.import",
  "data.accept",
] as const;

export type Action = (typeof ACTIONS)[number];

const FIELD_AND_OFFICE: Action[] = [
  "files.upload",
  "files.view",
  "clients.view",
  "instruments.view",
  "jobs.view",
];

const MATRIX: Record<Role, ReadonlySet<Action>> = {
  admin: new Set(ACTIONS),
  manager: new Set<Action>([
    "users.view",
    "settings.view",
    "audit.view",
    "clients.manage",
    "instruments.manage",
    "calibration.perform",
    "calibration.check",
    "calibration.approve",
    "jobs.manage",
    "jobs.money",
    "ratecard.manage",
    "field.perform",
    "data.import",
    "data.accept",
    ...FIELD_AND_OFFICE,
  ]),
  team_leader: new Set<Action>([
    "clients.manage",
    "instruments.manage",
    "calibration.perform",
    "calibration.check",
    "jobs.manage",
    "jobs.money",
    "field.perform",
    "data.import",
    "data.accept",
    ...FIELD_AND_OFFICE,
  ]),
  // Preparers in the office often receive the Excel by email and upload it.
  report_preparer: new Set<Action>(["calibration.perform", "data.import", ...FIELD_AND_OFFICE]),
  // Engineers place loggers, record times and take photos on site.
  field_engineer: new Set<Action>(["field.perform", "data.import", ...FIELD_AND_OFFICE]),
  // The lab calibrates the fleet and keeps master certificates current.
  lab: new Set<Action>(["instruments.manage", "calibration.perform", ...FIELD_AND_OFFICE]),
  // Accounts follow jobs to raise invoices; they see the money, not the work tools.
  accounts: new Set<Action>(["files.view", "clients.view", "jobs.view", "jobs.money"]),
  // Client access is scoped to their own company's released records (phases 2, 9 and 13).
  client_qa: new Set<Action>(),
  client_qa_head: new Set<Action>(),
};

export type Actor = { role: Role; status: string };

export function can(actor: Actor, action: Action): boolean {
  if (actor.status !== "active") return false;
  return MATRIX[actor.role].has(action);
}

export class ForbiddenError extends Error {
  constructor(public readonly action: Action) {
    super(`Not allowed: ${action}`);
    this.name = "ForbiddenError";
  }
}

export function assertCan(actor: Actor, action: Action): void {
  if (!can(actor, action)) throw new ForbiddenError(action);
}

/** For the settings screen and tests: the full matrix as plain data. */
export function permissionMatrix(): Record<Role, Action[]> {
  return Object.fromEntries(
    Object.entries(MATRIX).map(([role, actions]) => [role, [...actions].sort()]),
  ) as Record<Role, Action[]>;
}
