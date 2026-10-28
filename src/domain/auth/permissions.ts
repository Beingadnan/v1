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
] as const;

export type Action = (typeof ACTIONS)[number];

const FIELD_AND_OFFICE: Action[] = ["files.upload", "files.view"];

const MATRIX: Record<Role, ReadonlySet<Action>> = {
  admin: new Set(ACTIONS),
  manager: new Set<Action>(["users.view", "settings.view", "audit.view", ...FIELD_AND_OFFICE]),
  team_leader: new Set<Action>(FIELD_AND_OFFICE),
  report_preparer: new Set<Action>(FIELD_AND_OFFICE),
  field_engineer: new Set<Action>(FIELD_AND_OFFICE),
  lab: new Set<Action>(FIELD_AND_OFFICE),
  accounts: new Set<Action>(["files.view"]),
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
