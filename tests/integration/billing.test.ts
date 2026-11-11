/**
 * Phase 10 exit test on BE-WF-02: once the signed report is with the client,
 * QA Tech issues the WCR, the client's QA head accepts it, accounts record
 * the Tally invoice and the payments (with TDS); the job can't close while
 * anything is unpaid, and closes once it is all paid. A second job's WCR is
 * signed on paper. Runs on QA Tech's own export (fixtures/client).
 */
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { and, eq, sql } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditLog, invoices, jobs, users } from "@/db/schema";
import { hashPassword } from "@/domain/auth/password";
import { ForbiddenError } from "@/domain/auth/permissions";
import { toSessionUser, type SessionUser } from "@/domain/auth/session-service";
import {
  cancelInvoice,
  closeJob,
  recordInvoice,
  recordPayment,
  reopenJob,
  reversePayment,
} from "@/domain/billing/billing-service";
import { billingOverview, jobMoney } from "@/domain/billing/queries";
import { financialYear, nextInvoiceNumber } from "@/domain/billing/types";
import {
  acceptWcr,
  issueWcr,
  recordWcrPaper,
  voidWcr,
  wcrDownload,
} from "@/domain/billing/wcr-service";
import { freezeReport } from "@/domain/reports/report-service";
import { checkReport, clientApprove, releaseReport } from "@/domain/reports/review-service";
import { storeFile } from "@/lib/storage/store-file";

import { BE_WF_02_FILE, BE_WF_02_PASSWORD } from "../support/be-wf-02";
import { reportWorld, type World } from "../support/report-world";
import { openTestDatabase } from "../support/test-db";

const { db, close } = openTestDatabase();
afterAll(close);
const req = { ipAddress: "203.0.113.110" };
const pw = { password: BE_WF_02_PASSWORD };
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const jobStatus = async (id: string) =>
  (await db.select({ s: jobs.status }).from(jobs).where(eq(jobs.id, id)))[0]!.s;

/** The report frozen, checked and released (not yet signed). */
async function released(slug: string) {
  const w = await reportWorld(db, slug);
  const f = await freezeReport(db, w.blobs, w.preparer, w.reportId, req);
  if (!f.ok) throw new Error(f.message);
  if (!(await checkReport(db, w.lead, w.reportId, pw, req)).ok) throw new Error("check");
  await releaseReport(db, w.lead, w.reportId, { to: [w.qa.id, w.head.id] }, "https://x.test", req);
  const passwordHash = await hashPassword(BE_WF_02_PASSWORD, { N: 1024, r: 8, p: 1 });
  const [acc] = await db
    .insert(users)
    .values({
      organisationId: w.lead.organisationId,
      email: `acc@${slug}.test`,
      name: "Kavita Accounts",
      role: "accounts",
      status: "active",
      passwordHash,
    })
    .returning();
  return { ...w, accounts: toSessionUser(acc!)! };
}

describe.skipIf(!existsSync(BE_WF_02_FILE))("phase 10: WCR, invoice, payments and closing", () => {
  let w: World & { reportId: string; accounts: SessionUser };
  let wcrId: string;
  let invoiceId: string;

  beforeAll(async () => {
    w = await released("money-org");
  });

  it("issues the WCR once every report is with the client; it lists the equipment", async () => {
    await expect(issueWcr(db, w.blobs, w.accounts, w.jobId, req)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const r = await issueWcr(db, w.blobs, w.lead, w.jobId, req);
    wcrId = r.id;
    expect(r.number).toMatch(/^WCR\/QT\/\d{2}\/\d{4}\/\d{4}$/);
    await expect(issueWcr(db, w.blobs, w.lead, w.jobId, req)).rejects.toThrow("already has a WCR");
    const pdf = (await wcrDownload(db, w.blobs, w.lead, wcrId))!;
    const doc = await PDFDocument.load(pdf.bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(pdf.fileName).toMatch(/^WCR QT-\d{2}-\d{4}-\d{4}\.pdf$/);
  });

  it("can't be invoiced before the client signs the WCR", async () => {
    await expect(
      recordInvoice(
        db,
        w.accounts,
        w.jobId,
        { number: "QT/26-27/101", invoiceDate: today, taxable: 25000, gst: 4500 },
        req,
      ),
    ).rejects.toThrow("WCR isn't signed yet");
  });

  it("the client QA head accepts it in the app; another company can't", async () => {
    await expect(acceptWcr(db, w.stranger, wcrId, BE_WF_02_PASSWORD, req)).rejects.toThrow(
      "That WCR does not exist.",
    );
    await expect(acceptWcr(db, w.qa, wcrId, BE_WF_02_PASSWORD, req)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect((await acceptWcr(db, w.head, wcrId, "wrong", req)).ok).toBe(false);
    expect((await acceptWcr(db, w.head, wcrId, BE_WF_02_PASSWORD, req)).ok).toBe(true);
    // The report is still with the client; the WCR is what the invoice waits for.
    expect(await jobStatus(w.jobId)).toBe("wcr_signed");
    const signed = (await wcrDownload(db, w.blobs, w.head, wcrId))!;
    expect(signed.fileName).toMatch(/signed\.pdf$/);
    // REPORT_OUT=/some/dir keeps the signed WCR for a look.
    if (process.env.REPORT_OUT)
      writeFileSync(path.join(process.env.REPORT_OUT, "wcr.pdf"), signed.bytes);
    await expect(voidWcr(db, w.lead, wcrId, "Wrong PO", req)).rejects.toThrow(
      "A signed WCR can't be voided.",
    );
  });

  it("lists the job under Invoice due and suggests the invoice from the job's value", async () => {
    const o = await billingOverview(db, w.accounts);
    expect(o.invoiceDue.map((x) => x.jobId)).toContain(w.jobId);
    const m = (await jobMoney(db, w.accounts, w.jobId))!;
    expect(m.suggest.gstPct).toBe(18);
    expect(m.daysSinceWcr).toBe(0);
  });

  it("records the Tally invoice: number shape, unique in its financial year, sums to the rupee", async () => {
    const base = { number: "QT/26-27/101", invoiceDate: today, taxable: 25000, gst: 4500 };
    await expect(
      recordInvoice(db, w.accounts, w.jobId, { ...base, number: "QT 26-27 #101" }, req),
    ).rejects.toThrow("Invoice numbers are up to 16 letters");
    await expect(
      recordInvoice(db, w.accounts, w.jobId, { ...base, invoiceDate: "2099-04-01" }, req),
    ).rejects.toThrow("The invoice date is in the future.");
    invoiceId = (await recordInvoice(db, w.accounts, w.jobId, base, req)).id;
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    expect(inv).toMatchObject({ total: "29500.00", financialYear: financialYear(today) });
    expect(await jobStatus(w.jobId)).toBe("invoiced");
    await expect(recordInvoice(db, w.lead, w.jobId, base, req)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(recordInvoice(db, w.accounts, w.jobId, base, req)).rejects.toThrow(
      "is already recorded for",
    );
  });

  it("can't close with an unpaid invoice, and says what is missing", async () => {
    await expect(closeJob(db, w.manager, w.jobId, req)).rejects.toThrow(
      /can't close yet: .*isn't signed by the client\. Invoice QT\/26-27\/101 isn't fully paid\./,
    );
    await expect(closeJob(db, w.accounts, w.jobId, req)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("takes part payments with TDS; refuses overpaying; a wrong entry is reversed", async () => {
    await expect(
      recordPayment(
        db,
        w.accounts,
        invoiceId,
        { paidOn: today, received: 15000, mode: "neft", reference: "" },
        req,
      ),
    ).rejects.toThrow("Enter the UTR or cheque number.");
    const first = await recordPayment(
      db,
      w.accounts,
      invoiceId,
      { paidOn: today, received: 15000, tds: 0, mode: "neft", reference: "UTR123456789" },
      req,
    );
    expect(first.left).toBe(14500);
    await expect(
      recordPayment(
        db,
        w.accounts,
        invoiceId,
        { paidOn: today, received: 15000, mode: "neft", reference: "UTR99999" },
        req,
      ),
    ).rejects.toThrow("only ₹14,500.00 is left");
    // A typo: reverse it and enter again.
    await reversePayment(db, w.accounts, first.id, "Typed 15000 instead of 14000", req);
    expect(await jobStatus(w.jobId)).toBe("invoiced");
    const again = await recordPayment(
      db,
      w.accounts,
      invoiceId,
      { paidOn: today, received: 14000, mode: "neft", reference: "UTR123456789" },
      req,
    );
    expect(again.left).toBe(15500);
    // The rest, less 2% TDS on the taxable value (₹500), and ₹3 the bank kept.
    await expect(
      recordPayment(
        db,
        w.accounts,
        invoiceId,
        {
          paidOn: today,
          received: 14997,
          tds: 500,
          writtenOff: 3,
          mode: "cheque",
          reference: "004512",
        },
        req,
      ),
    ).rejects.toThrow("Say why the rest is written off.");
    const last = await recordPayment(
      db,
      w.accounts,
      invoiceId,
      {
        paidOn: today,
        received: 14997,
        tds: 500,
        writtenOff: 3,
        mode: "cheque",
        reference: "004512",
        note: "Bank charges",
      },
      req,
    );
    expect(last.left).toBe(0);
    expect(await jobStatus(w.jobId)).toBe("paid");
    await expect(cancelInvoice(db, w.accounts, invoiceId, "Wrong amount", req)).rejects.toThrow(
      "Payments are recorded against invoice",
    );
  });

  it("still can't close until the client signs the report; then closes and reopens with a reason", async () => {
    await expect(closeJob(db, w.manager, w.jobId, req)).rejects.toThrow(
      "isn't signed by the client.",
    );
    expect((await clientApprove(db, w.blobs, w.head, w.reportId, pw, req)).ok).toBe(true);
    // Signing the report doesn't move a paid job back.
    expect(await jobStatus(w.jobId)).toBe("paid");
    await closeJob(db, w.manager, w.jobId, req);
    expect(await jobStatus(w.jobId)).toBe("closed");
    expect((await billingOverview(db, w.accounts)).open.map((v) => v.id)).not.toContain(invoiceId);
    await expect(reopenJob(db, w.manager, w.jobId, "no", req)).rejects.toThrow(
      "Say why it is reopened.",
    );
    await reopenJob(
      db,
      w.manager,
      w.jobId,
      "Client asked for a copy of the WCR on letterhead",
      req,
    );
    expect(await jobStatus(w.jobId)).toBe("paid");
    await closeJob(db, w.manager, w.jobId, req);
    const actions = (
      await db
        .select({ a: auditLog.action })
        .from(auditLog)
        .where(
          sql`${auditLog.organisationId} = ${w.lead.organisationId} and (${auditLog.action} like 'wcr.%' or ${auditLog.action} like 'invoice.%' or ${auditLog.action} like 'payment.%' or ${auditLog.action} like 'job.%')`,
        )
    ).map((x) => x.a);
    expect(actions).toEqual(
      expect.arrayContaining([
        "wcr.issued",
        "wcr.accepted",
        "invoice.recorded",
        "payment.recorded",
        "payment.reversed",
        "invoice.cleared",
        "job.closed",
        "job.reopened",
      ]),
    );
  });
});

describe.skipIf(!existsSync(BE_WF_02_FILE))("phase 10: WCR on paper; overdue invoices", () => {
  let w: World & { reportId: string; accounts: SessionUser };
  let wcrId: string;

  beforeAll(async () => {
    w = await released("money-paper-org");
    wcrId = (await issueWcr(db, w.blobs, w.lead, w.jobId, req)).id;
  });

  it("voids a wrong WCR and issues it again; the new one is signed on paper", async () => {
    await voidWcr(db, w.lead, wcrId, "PO number missing on the WCR", req);
    wcrId = (await issueWcr(db, w.blobs, w.lead, w.jobId, req)).id;
    const scanDoc = await PDFDocument.create();
    scanDoc.addPage([595.28, 841.89]).drawText("Signed WCR (test)");
    const scan = await storeFile(db, w.blobs, {
      organisationId: w.lead.organisationId,
      actor: { type: "user", userId: w.lead.id },
      fileName: "wcr signed.pdf",
      bytes: await scanDoc.save(),
      maxBytes: 10 * 1024 * 1024,
    });
    if (!scan.ok) throw new Error(scan.message);
    await expect(
      recordWcrPaper(
        db,
        w.lead,
        wcrId,
        { fileId: scan.file.id, signedByName: "R. Kulkarni", signedOn: "2020-01-01" },
        req,
      ),
    ).rejects.toThrow("before the WCR was issued");
    await recordWcrPaper(
      db,
      w.lead,
      wcrId,
      { fileId: scan.file.id, signedByName: "R. Kulkarni", signedOn: today },
      req,
    );
    expect(await jobStatus(w.jobId)).toBe("wcr_signed");
    expect((await wcrDownload(db, w.blobs, w.lead, wcrId, "scan"))!.sha256).toBe(scan.file.sha256);
  });

  it("an invoice past the client's terms shows as overdue, oldest first", async () => {
    // Watson's terms are 45 days; an invoice of 60 days ago is 15 days overdue.
    const old = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    await recordInvoice(
      db,
      w.accounts,
      w.jobId,
      { number: "QT/OLD/7", invoiceDate: old, taxable: 10000, gst: 1800 },
      req,
    );
    const o = await billingOverview(db, w.accounts);
    const v = o.open.find((x) => x.number === "QT/OLD/7")!;
    expect(v.overdueDays).toBeGreaterThanOrEqual(14);
    expect(v.overdueDays).toBeLessThanOrEqual(16);
    expect(o.totals.overdue).toBeGreaterThanOrEqual(11800);
    const [inv] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(eq(invoices.number, "QT/OLD/7"), eq(invoices.organisationId, w.lead.organisationId)),
      );
    await cancelInvoice(db, w.accounts, inv!.id, "Entered against the wrong job", req);
    expect(await jobStatus(w.jobId)).toBe("wcr_signed");
  });
});

describe("billing arithmetic", () => {
  it("financial years run April to March", () => {
    expect(financialYear("2026-03-31")).toBe("2025-26");
    expect(financialYear("2026-04-01")).toBe("2026-27");
  });
  it("suggests the next invoice number from the last", () => {
    expect(nextInvoiceNumber("QT/26-27/099")).toBe("QT/26-27/100");
    expect(nextInvoiceNumber("INV-9")).toBe("INV-10");
    expect(nextInvoiceNumber(null)).toBe("");
  });
});
