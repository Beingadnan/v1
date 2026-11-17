"use client";

import { Check } from "lucide-react";
import { useState } from "react";

import { TEAM_ROLE_LABELS, TEAM_ROLES, type TeamRole } from "@/domain/jobs/types";
import { cn } from "@/lib/utils";

/** The role a person usually has on a job, from their account's role. */
export function usualTeamRole(accountRole: string): TeamRole {
  return (TEAM_ROLES as readonly string[]).includes(accountRole)
    ? (accountRole as TeamRole)
    : "field_engineer";
}

/**
 * Who is on a job and what each does there. One person can do several things
 * (QA Tech's small teams: the team leader also maps and sends the data), so
 * each person has a tick for every role. Sends `team` = userId once per person
 * and `role-<userId>` once per role.
 */
export function TeamPicker({
  staff,
  initial,
}: {
  staff: { id: string; name: string; role: string }[];
  initial: { userId: string; role: string }[];
}) {
  const [team, setTeam] = useState<Map<string, Set<TeamRole>>>(() => {
    const m = new Map<string, Set<TeamRole>>();
    for (const t of initial) {
      if (!(TEAM_ROLES as readonly string[]).includes(t.role)) continue;
      m.set(t.userId, new Set([...(m.get(t.userId) ?? []), t.role as TeamRole]));
    }
    return m;
  });

  const togglePerson = (s: { id: string; role: string }) =>
    setTeam((prev) => {
      const next = new Map(prev);
      if (next.has(s.id)) next.delete(s.id);
      else next.set(s.id, new Set([usualTeamRole(s.role)]));
      return next;
    });
  const toggleRole = (id: string, r: TeamRole) =>
    setTeam((prev) => {
      const roles = new Set(prev.get(id));
      if (roles.has(r)) {
        // Someone on the team does at least one thing.
        if (roles.size === 1) return prev;
        roles.delete(r);
      } else roles.add(r);
      return new Map(prev).set(id, roles);
    });

  return (
    <ul className="flex flex-col gap-2">
      {staff.map((s) => {
        const roles = team.get(s.id);
        return (
          <li
            key={s.id}
            className={cn(
              "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2",
              roles ? "border-primary/40 bg-primary/5" : "border-border",
            )}
          >
            <label className="flex min-w-0 flex-1 basis-40 items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="team"
                value={s.id}
                checked={!!roles}
                onChange={() => togglePerson(s)}
                className="size-4 accent-primary"
              />
              <span className={cn("truncate", roles && "font-medium")}>{s.name}</span>
            </label>
            {roles ? (
              <fieldset className="flex flex-wrap gap-1.5">
                <legend className="sr-only">{s.name}&apos;s roles on this job</legend>
                {TEAM_ROLES.map((r) => {
                  const on = roles.has(r);
                  return (
                    <label
                      key={r}
                      className={cn(
                        "inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs select-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/40",
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-surface text-muted-foreground hover:border-primary",
                      )}
                    >
                      <input
                        type="checkbox"
                        name={`role-${s.id}`}
                        value={r}
                        checked={on}
                        onChange={() => toggleRole(s.id, r)}
                        className="sr-only"
                        aria-label={`${s.name}: ${TEAM_ROLE_LABELS[r]}`}
                      />
                      {on ? <Check className="size-3" aria-hidden="true" /> : null}
                      {TEAM_ROLE_LABELS[r]}
                    </label>
                  );
                })}
              </fieldset>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
