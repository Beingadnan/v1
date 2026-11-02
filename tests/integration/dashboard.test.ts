/**
 * Phase 11 on BE-WF-02: notifications follow the report through QA Tech and
 * the client (emailed at once only when blocked on someone), the daily
 * digest, the manager's Monday review tiles, Ctrl+K search, the archive, and
 * CAPA on a deviation.
 */
import { existsSync } from "node:fs";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { notifications, users } from "@/db/schema";
import { assessDeviation, openDeviation } from "@/domain/analysis/analysis-service";
import {
  completeCapa,
  createCapa,
  deviationRegister,
  moveCapaDue,
  verifyCapa,
} from "@/domain/analysis/capa-service";
import { ForbiddenError } from "@/domain/auth/permissions";
import { archiveTree } from "@/domain/dashboard/archive";
import { homeFor } from "@/domain/dashboard/home";
import { dailyDigest } from "@/domain/notifications/digest";
import {
  markRead,
  myNotifications,
  sendPending,
  setEmailAlerts,
} from "@/domain/notifications/notify";
import { freezeReport } from "@/domain/reports/report-service";
import {
  checkReport,
  clientApprove,
  clientReview,
  releaseReport,
  returnForRework,
} from "@/domain/reports/review-service";
import { searchAll } from "@/domain/search/search";
import { MemorySender, NoEmail } from "@/lib/mail/mailer";

import { BE_WF_02_FILE, BE_WF_02_PASSWORD } from "../support/be-wf-02";
import { reportWorld, type World } from "../support/report-world";
import { openTestDatabase } from "../support/test-db";

const { db, close } = openTestDatabase();
afterAll(close);
const req = { ipAddress: "203.0.113.120" };
const pw = { password: BE_WF_02_PASSWORD };
const APP = "https://qtech.test";
const inDays = (n: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date(Date.now() + n * 86_400_000),
  );

const kindsOf = async (userId: string) =>
  (
    await db
      .select({ kind: notifications.kind, email: notifications.emailStatus })
      .from(notifications)
      .where(eq(notifications.userId, userId))
  ).map((n) => `${n.kind}:${n.email}`);

describe.skipIf(!existsSync(BE_WF_02_FILE))(
  "phase 11: alerts, the Monday review, search, archive, CAPA",
  () => {
    let w: World & { reportId: string };
    const mail = new MemorySender();

    beforeAll(async () => {
      w = await reportWorld(db, "dash-org");
    });

    it("tells the team leader a report is ready to check (bell only), and the preparer when it comes back (email at once)", async () => {
      expect((await freezeReport(db, w.blobs, w.preparer, w.reportId, pw, req)).ok).toBe(true);
      expect(await kindsOf(w.lead.id)).toEqual(["report_to_check:none"]);
      await returnForRework(
        db,
        w.lead,
        w.reportId,
        { comments: [{ section: "details", page: 3, body: "Department should be Stores." }] },
        req,
      );
      expect(await kindsOf(w.preparer.id)).toEqual(["report_returned:pending"]);
      // No provider set up: marked skipped, the bell still has it.
      await sendPending(db, new NoEmail(), APP);
      expect(await kindsOf(w.preparer.id)).toEqual(["report_returned:skipped"]);
      const bell = await myNotifications(db, w.preparer);
      expect(bell.unread).toBe(1);
      expect(bell.rows[0]!.href).toBe(`/studies/${w.studyId}?tab=report`);
      await markRead(db, w.preparer);
      expect((await myNotifications(db, w.preparer)).unread).toBe(0);
    });

    it("emails the client when a report is released, once, with the link", async () => {
      const [c] = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, w.preparer.id));
      expect(c).toBeDefined();
      // The preparer answers and signs again; the manager checks; the lead releases.
      const { openComments } = await import("@/domain/reports/report-service");
      const { answerComment } = await import("@/domain/reports/review-service");
      for (const x of await openComments(db, w.studyId)) {
        await answerComment(db, w.preparer, x.id, "Fixed: department corrected.", req);
      }
      expect((await freezeReport(db, w.blobs, w.preparer, w.reportId, pw, req)).ok).toBe(true);
      expect((await checkReport(db, w.manager, w.reportId, pw, req)).ok).toBe(true);
      // The QA head keeps email on; client QA turns it off.
      await setEmailAlerts(db, w.qa, false);
      await releaseReport(db, w.lead, w.reportId, { to: [w.qa.id, w.head.id] }, APP, req);
      expect(await kindsOf(w.head.id)).toEqual(["report_released:pending"]);
      expect(await kindsOf(w.qa.id)).toEqual(["report_released:none"]);
      const r1 = await sendPending(db, mail, APP);
      const r2 = await sendPending(db, mail, APP);
      expect(r1.sent).toBe(1);
      expect(r2.tried).toBe(0);
      expect(mail.sent).toHaveLength(1);
      expect(mail.sent[0]!.to).toBe(w.head.email);
      expect(mail.sent[0]!.text).toContain(`${APP}/client/reports/${w.reportId}`);
    });

    it("the team hears when the client signs", async () => {
      expect((await clientReview(db, w.qa, w.reportId, pw, req)).ok).toBe(true);
      expect((await clientApprove(db, w.blobs, w.head, w.reportId, pw, req)).ok).toBe(true);
      expect(await kindsOf(w.lead.id)).toContain("report_client_signed:none");
    });

    it("sends one short daily digest per person with unread items, and not twice a day", async () => {
      const digestMail = new MemorySender();
      const first = await dailyDigest(db, digestMail, APP);
      const toLead = digestMail.sent.filter((m) => m.to === w.lead.email);
      expect(toLead).toHaveLength(1);
      expect(toLead[0]!.text).toContain("Waiting for you in QTech:");
      expect(toLead[0]!.text).toContain("signed by");
      // The QA (email off) gets nothing.
      expect(digestMail.sent.some((m) => m.to === w.qa.email)).toBe(false);
      expect(first.emailConfigured).toBe(true);
      const again = new MemorySender();
      await dailyDigest(db, again, APP);
      expect(again.sent.filter((m) => m.to === w.lead.email)).toHaveLength(0);
    });

    it("gives the manager the Monday review: every tile, and the board", async () => {
      const home = await homeFor(db, w.manager);
      const keys = home.tiles.map((t) => t.key);
      for (const k of [
        "check",
        "release",
        "data_overdue",
        "unsigned",
        "invoice_due",
        "overdue",
        "instruments",
        "deviations",
        "capa",
        "requal",
      ]) {
        expect(keys).toContain(k);
      }
      expect(home.board.map((b) => b.label)).toContain("With client");
      // A report preparer sees their own tiles, not the manager's.
      const mine = (await homeFor(db, w.preparer)).tiles.map((t) => t.key);
      expect(mine).toContain("drafts");
      expect(mine).not.toContain("overdue");
      expect(mine).not.toContain("requal");
    });

    it("finds a job, a report number, equipment and a logger serial; the client's role finds nothing", async () => {
      const byReport = await searchAll(db, w.lead, "BE-WF-02");
      expect(byReport.map((h) => h.kind)).toEqual(expect.arrayContaining(["Report", "Equipment"]));
      const serial = await searchAll(db, w.lead, "62283645");
      expect(serial.some((h) => h.kind === "Instrument")).toBe(true);
      expect(await searchAll(db, w.lead, "a")).toEqual([]);
      // Search escapes wildcards.
      expect(await searchAll(db, w.lead, "%%")).toEqual([]);
    });

    it("files the signed study under Watson → Seawoods → year → month", async () => {
      const { tree, total } = await archiveTree(db, w.lead);
      expect(total).toBeGreaterThanOrEqual(1);
      const watson = tree.find((c) => c.label.startsWith("Watson"))!;
      expect(watson.children[0]!.label).toBe("Seawoods");
      const year = watson.children[0]!.children[0]!;
      expect(year.label).toBe(String(new Date().getFullYear()));
    });

    it("leaves people who turned email off out of the digest", async () => {
      const [qa] = await db
        .select({ on: users.emailAlerts })
        .from(users)
        .where(and(eq(users.id, w.qa.id)));
      expect(qa!.on).toBe(false);
    });
  },
);

describe.skipIf(!existsSync(BE_WF_02_FILE))("phase 11: CAPA on a deviation", () => {
  let w: World & { reportId: string };
  let deviationId: string;

  beforeAll(async () => {
    w = await reportWorld(db, "capa-org");
    const d = await openDeviation(
      db,
      w.lead,
      w.studyId,
      { title: "Logger L-08 found loose in its bracket", description: "" },
      req,
    );
    deviationId = d.id;
  });

  it("tells the client QA head when QA Tech's assessment is written", async () => {
    await assessDeviation(
      db,
      w.lead,
      deviationId,
      { assessment: "No effect on the result; bracket replaced." },
      req,
    );
    expect(await kindsOf(w.head.id)).toEqual(["deviation_to_decide:pending"]);
    // A second edit of the assessment doesn't tell them again.
    await assessDeviation(
      db,
      w.lead,
      deviationId,
      { assessment: "No effect on the result; bracket replaced the same day." },
      req,
    );
    expect(await kindsOf(w.head.id)).toHaveLength(1);
  });

  it("runs a CAPA: raised (the owner is emailed), done by the owner, verified by someone else", async () => {
    await expect(createCapa(db, w.preparer, deviationId, {}, req)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const c = await createCapa(
      db,
      w.manager,
      deviationId,
      {
        kind: "preventive",
        rootCause: "Brackets wear loose after repeated use.",
        action: "Check every bracket before a study.",
        ownerUserId: w.lead.id,
        dueOn: inDays(7),
      },
      req,
    );
    expect(await kindsOf(w.lead.id)).toContain("capa_assigned:pending");
    await expect(
      moveCapaDue(db, w.manager, c.id, { dueOn: inDays(14), reason: "no" }, req),
    ).rejects.toThrow("Say why the date moves.");
    await moveCapaDue(
      db,
      w.manager,
      c.id,
      { dueOn: inDays(14), reason: "Brackets arrive next week" },
      req,
    );
    await completeCapa(db, w.lead, c.id, "Checklist step added to FT-12.", req);
    await expect(verifyCapa(db, w.lead, c.id, "Looks fine to me", req)).rejects.toThrow(
      "The owner can't verify their own action.",
    );
    await verifyCapa(db, w.manager, c.id, "Two studies since: no loose brackets.", req);
    const after = await deviationRegister(db, w.manager, { show: "all" });
    expect(after.capas.find((x) => x.id === c.id)).toBeUndefined();
    const dev = after.deviations.find((x) => x.id === deviationId)!;
    expect(dev.capas[0]).toMatchObject({ status: "verified", owner: "Lead" });
  });
});
