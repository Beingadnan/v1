import { describe, expect, it } from "vitest";

import { DATA_FLOW } from "@/domain/data/data-service";
import { STUDY_FLOW, OVERRIDE_FLOW } from "@/domain/field/types";
import { CERTIFICATE_FLOW } from "@/domain/instruments/types";
import { JOB_FLOW, FINISHED } from "@/domain/jobs/types";
import { CAPA_FLOW } from "@/domain/notifications/types";
import { INVOICE_FLOW, WCR_FLOW } from "@/domain/billing/types";
import { REPORT_FLOW } from "@/domain/reports/types";
import { USER_FLOW } from "@/domain/auth/account-service";

import {
  canMove,
  IllegalMove,
  isFinal,
  machine,
  move,
  reachable,
  type Machine,
} from "./state-machine";

/** Each status field, the state a record starts in, and its states nothing may leave. */
const FLOWS: [Machine<string>, string, string[]][] = [
  [JOB_FLOW, "created", ["cancelled"]],
  [STUDY_FLOW, "planned", []],
  [DATA_FLOW, "none", []],
  [REPORT_FLOW, "draft", ["superseded"]],
  [CERTIFICATE_FLOW, "draft", ["cancelled"]],
  [WCR_FLOW, "issued", ["signed", "void"]],
  [INVOICE_FLOW, "open", ["cancelled"]],
  [CAPA_FLOW, "open", ["verified"]],
  [USER_FLOW, "invited", []],
  [OVERRIDE_FLOW, "requested", ["approved", "rejected"]],
];

describe("declared status flows (ADR 0022)", () => {
  it("refuses moves nobody declared, and checks the table itself", () => {
    const m = machine("door", ["open", "shut", "locked"] as const, {
      open: ["shut"],
      shut: ["open", "locked"],
      locked: ["shut"],
    });
    expect(move(m, "open", "shut")).toBe("shut");
    expect(() => move(m, "open", "locked")).toThrow(IllegalMove);
    expect(() => move(m, "open", "open")).toThrow("can't go from open to open");
    expect(() => machine("x", ["a"] as const, { a: ["b" as "a"] })).toThrow("unknown state");
  });

  it.each(FLOWS.map(([m, start, finals]) => [m.name, m, start, finals] as const))(
    "%s: every state can be reached, and only the final ones are final",
    (_, m, start, finals) => {
      const legacy = m === REPORT_FLOW ? ["reviewed"] : [];
      expect([...reachable(m, start)].sort()).toEqual(
        m.states.filter((s) => !legacy.includes(s)).sort(),
      );
      expect(m.states.filter((s) => isFinal(m, s)).sort()).toEqual([...finals].sort());
    },
  );

  it("a job: hold and cancel from any live status, close only when paid", () => {
    for (const s of JOB_FLOW.states.filter((s) => !FINISHED.includes(s))) {
      expect(canMove(JOB_FLOW, s, "cancelled")).toBe(true);
      if (s !== "on_hold") expect(canMove(JOB_FLOW, s, "on_hold")).toBe(true);
    }
    expect(JOB_FLOW.states.filter((s) => canMove(JOB_FLOW, s, "closed"))).toEqual(["paid"]);
    expect(canMove(JOB_FLOW, "created", "field_work")).toBe(false);
    expect(canMove(JOB_FLOW, "invoiced", "rework")).toBe(false);
  });

  it("a report is only received by the client once checked, and signed ones are only superseded", () => {
    expect(REPORT_FLOW.states.filter((s) => canMove(REPORT_FLOW, s, "released"))).toEqual([
      "checked",
    ]);
    expect(REPORT_FLOW.moves.signed).toEqual(["superseded"]);
    expect(canMove(DATA_FLOW, "issues", "received")).toBe(false);
  });
});
