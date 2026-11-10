/**
 * The client's order on a job (QA Tech, Nov 2026): a PO or SRF of its own,
 * or an ARC/AMC kept on the client. It can come after the job is made, and
 * never holds up field work.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditLog, jobWcrs, jobs, notifications, users } from "@/db/schema";
import { ensureOrganisation } from "@/db/seed/ensure-organisation";
import { ForbiddenError } from "@/domain/auth/permissions";
import { toSessionUser, type SessionUser } from "@/domain/auth/session-service";
import { createCompany } from "@/domain/clients/company-service";
import { createEquipment } from "@/domain/clients/equipment-service";
import { getCompany } from "@/domain/clients/queries";
import { listContracts, saveContract } from "@/domain/jobs/contract-service";
import { createJob, recordOrder, setReadiness } from "@/domain/jobs/job-service";
import { getJob, listJobs } from "@/domain/jobs/queries";
import { sendReminders } from "@/domain/notifications/reminders";
import { LocalBlobStore } from "@/lib/storage/blob-store";
import { storeFile } from "@/lib/storage/store-file";

import { openTestDatabase } from "../support/test-db";

const { db, close } = openTestDatabase();
afterAll(close);
const req = { ipAddress: "203.0.113.81" };
let manager: SessionUser;
let accounts: SessionUser;
let engineer: SessionUser;
let lupinId: string;
let otherClientId: string;
let siteId: string;
let autoclave: string;

async function makeUser(organisationId: string, email: string, role: string, name: string) {
  const [row] = await db
    .insert(users)
    .values({ organisationId, email, name, role, status: "active", passwordHash: "x" })
    .returning();
  return toSessionUser(row!)!;
}
const company = (name: string, code: string) => ({
  name,
  code,
  gstin: "",
  address: "",
  notes: "",
  postCalRequired: false,
  requalificationMonths: 12,
  reportNumberFormat: "{CLIENT}/{SITE}/{MM}/{YY}/{EQUIPMENT_ID}",
  firstSite: { name: "Ghotawade", code: "GTW", address: "", city: "", state: "", gstin: "" },
});

beforeAll(async () => {
  const org = (await ensureOrganisation(db, { slug: "orders-org", name: "QA Tech Orders" }))
    .organisation;
  manager = await makeUser(org.id, "mgr@orders.test", "manager", "Quality Manager");
  accounts = await makeUser(org.id, "acc@orders.test", "accounts", "Accounts");
  engineer = await makeUser(org.id, "fe@orders.test", "field_engineer", "Field Engineer");
  lupinId = (await createCompany(db, manager, company("Lupin Ltd", "Lupin"), req)).id;
  otherClientId = (await createCompany(db, manager, company("Gennova", "Gennova"), req)).id;
  siteId = (await getCompany(db, manager, lupinId))!.sites[0]!.id;
  autoclave = (
    await createEquipment(
      db,
      manager,
      lupinId,
      {
        siteId,
        departmentId: null,
        code: "EQP-DPD-002",
        name: "Steam Sterilizer",
        type: "dry_heat_oven",
        location: "",
        make: "",
        model: "",
        serialNo: "",
        lengthM: "",
        widthM: "",
        heightM: "",
        setPointC: "",
        tempMinC: "",
        tempMaxC: "",
        rhMinPct: "",
        rhMaxPct: "",
        defaultChannels: "10",
        readingIntervalMinutes: "1",
        studyDurationHours: "1",
        requalificationMonths: "",
        lastStudyOn: "",
        notes: "",
      },
      req,
    )
  ).id;
});

const job = async (extra: Record<string, unknown>, start = "2026-12-01") =>
  (
    await createJob(
      db,
      manager,
      {
        companyId: lupinId,
        clientSiteId: siteId,
        plannedStart: start,
        plannedEnd: start.replace(/-01$/, "-03"),
        items: [{ equipmentId: autoclave }],
        ...extra,
      },
      req,
    )
  ).id;
const orderItem = async (id: string) =>
  (await getJob(db, manager, id))!.readiness.items.find((i) => i.key === "purchase_order")!;

describe("the client's order", () => {
  let arc: string;

  it("keeps an ARC on the client; field engineers can't add one", async () => {
    arc = (
      await saveContract(
        db,
        accounts,
        lupinId,
        {
          kind: "arc",
          number: "LUP/ARC/2026-27",
          validFrom: "2026-04-01",
          validTo: "2027-03-31",
          value: "4.5 lakh",
        },
        null,
        req,
      )
    ).id;
    await expect(
      saveContract(
        db,
        engineer,
        lupinId,
        { kind: "amc", number: "X", validFrom: "2026-04-01", validTo: "2027-03-31" },
        null,
        req,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      saveContract(
        db,
        manager,
        lupinId,
        { kind: "arc", number: "lup/arc/2026-27", validFrom: "2026-04-01", validTo: "2027-03-31" },
        null,
        req,
      ),
    ).rejects.toThrow("already has a contract with that number");
    await expect(
      saveContract(
        db,
        manager,
        lupinId,
        { kind: "amc", number: "AMC-1", validFrom: "2027-04-01", validTo: "2026-04-01" },
        null,
        req,
      ),
    ).rejects.toThrow("can't end before it starts");
    const list = await listContracts(db, accounts, lupinId);
    expect(list).toMatchObject([
      { kind: "arc", number: "LUP/ARC/2026-27", value: "450000.00", jobs: 0 },
    ]);
    // Without money rights the value is hidden.
    expect((await listContracts(db, engineer, lupinId))[0]!.value).toBeNull();
  });

  it("is ready when the job is done under a current ARC", async () => {
    const id = await job({ orderType: "arc", contractId: arc });
    expect(await orderItem(id)).toMatchObject({
      state: "ready",
      detail: "ARC LUP/ARC/2026-27, valid until 31.03.2027",
    });
    expect((await listContracts(db, manager, lupinId))[0]!.jobs).toBe(1);
  });

  it("names an ARC that doesn't cover the job's dates", async () => {
    const id = await job({ orderType: "arc", contractId: arc }, "2027-05-01");
    expect(await orderItem(id)).toMatchObject({
      state: "pending",
      detail:
        "ARC LUP/ARC/2026-27 runs 01.04.2026–31.03.2027, not on 01.05.2027: pick the current one.",
    });
  });

  it("refuses another client's contract or the wrong kind", async () => {
    const theirs = (
      await saveContract(
        db,
        manager,
        otherClientId,
        { kind: "amc", number: "GEN/AMC/26", validFrom: "2026-04-01", validTo: "2027-03-31" },
        null,
        req,
      )
    ).id;
    await expect(job({ orderType: "amc", contractId: theirs })).rejects.toThrow(
      "That contract isn't this client's.",
    );
    await expect(job({ orderType: "amc", contractId: arc })).rejects.toThrow(
      "That contract is an ARC, not an AMC.",
    );
  });

  it("lets field work start while the PO is pending, then records it with its copy", async () => {
    const id = await job({});
    expect(await orderItem(id)).toMatchObject({
      state: "pending",
      blocking: false,
      detail: "PO pending: field work can go ahead; enter it when it comes.",
    });
    // Everything else in place: the job is Ready without the PO.
    for (const key of ["site_access", "previous_report"]) {
      await setReadiness(db, manager, id, { key, state: "na", note: "" }, req);
    }
    const before = (await getJob(db, manager, id))!;
    expect(before.readiness).toMatchObject({ waiting: 1 });
    // Only the other items hold the job back, not the PO.
    expect(before.readiness.pending).toBe(
      before.readiness.items.filter((i) => i.state === "pending" && i.key !== "purchase_order")
        .length,
    );

    const blobs = new LocalBlobStore(`/tmp/qtech-orders-${process.pid}`);
    const stored = await storeFile(db, blobs, {
      organisationId: manager.organisationId,
      actor: { type: "user", userId: accounts.id },
      fileName: "PO 4500098765.pdf",
      bytes: new TextEncoder().encode("%PDF-1.4\n% QTech test PO\n%%EOF\n"),
      maxBytes: 1_000_000,
    });
    expect(stored.ok).toBe(true);
    await expect(
      recordOrder(db, engineer, id, { orderType: "po", poNumber: "1" }, req),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await recordOrder(
      db,
      accounts,
      id,
      {
        orderType: "po",
        poNumber: "4500098765",
        poDate: "2026-11-20",
        poValue: "₹85,000",
        fileId: stored.ok ? stored.file.id : "",
      },
      req,
    );
    const after = (await getJob(db, manager, id))!;
    expect(await orderItem(id)).toMatchObject({ state: "ready", detail: "PO 4500098765" });
    expect(after.readiness.waiting).toBe(0);
    expect(after.job).toMatchObject({ poNumber: "4500098765", poValue: "85000.00" });
    expect(after.job.orderFileId).toBe(stored.ok ? stored.file.id : null);
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, id), eq(auditLog.action, "job.order_recorded")));
    expect(audit?.summary).toBe(
      "Accounts recorded the client's order on job " +
        after.job.number +
        ": PO 4500098765, copy attached",
    );
  });

  it("takes an SRF the same way", async () => {
    const id = await job({ orderType: "srf", poNumber: "SRF-2211" });
    expect(await orderItem(id)).toMatchObject({ state: "ready", detail: "SRF SRF-2211" });
  });

  it("lists the jobs whose order is pending", async () => {
    // An AMC job with the contract not picked yet.
    const id = await job({ orderType: "amc" }, "2026-12-15");
    expect(await orderItem(id)).toMatchObject({
      state: "pending",
      detail: "AMC pending: pick the client's AMC.",
    });
    const pending = await listJobs(db, manager, { orderPending: true });
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((j) => j.orderPending)).toBe(true);
    expect(pending.map((j) => j.id)).toEqual([id]);
  });
});

describe("the daily reminders", () => {
  const kinds = async (kind: string) =>
    db
      .select({ title: notifications.title, userId: notifications.userId })
      .from(notifications)
      .where(
        and(eq(notifications.organisationId, manager.organisationId), eq(notifications.kind, kind)),
      );

  it("reminds managers and accounts of a pending order after 3 days, then weekly", async () => {
    const id = await job({}, "2027-01-01");
    const [j] = await db.select().from(jobs).where(eq(jobs.id, id));
    const soon = new Date(j!.createdAt.getTime() + 2 * 86_400_000);
    await sendReminders(db, soon);
    expect((await kinds("order_pending")).filter((n) => n.title.endsWith(j!.number))).toEqual([]);

    const later = new Date(j!.createdAt.getTime() + 4 * 86_400_000);
    await sendReminders(db, later);
    const sent = (await kinds("order_pending")).filter(
      (n) => n.title === `PO pending: ${j!.number}`,
    );
    expect(sent.map((n) => n.userId).sort()).toEqual([manager.id, accounts.id].sort());
    // Not again the next day; again a week on.
    await sendReminders(db, new Date(later.getTime() + 86_400_000));
    expect(
      (await kinds("order_pending")).filter((n) => n.title === `PO pending: ${j!.number}`),
    ).toHaveLength(2);
  });

  it("reminds of a signed WCR with no invoice after 7 days", async () => {
    const id = await job({ poNumber: "PO-77" }, "2027-02-01");
    const [j] = await db.select().from(jobs).where(eq(jobs.id, id));
    const blobs = new LocalBlobStore(`/tmp/qtech-orders-${process.pid}`);
    const stored = await storeFile(db, blobs, {
      organisationId: manager.organisationId,
      actor: { type: "user", userId: manager.id },
      fileName: "WCR.pdf",
      bytes: new TextEncoder().encode("%PDF-1.4\n% WCR test\n%%EOF\n"),
      maxBytes: 1_000_000,
    });
    if (!stored.ok) throw new Error("stored");
    const signedAt = new Date("2027-02-05T10:00:00+05:30");
    await db.insert(jobWcrs).values({
      organisationId: manager.organisationId,
      jobId: id,
      status: "signed",
      fileId: stored.file.id,
      sha256: stored.file.sha256,
      issuedByUserId: manager.id,
      signedVia: "paper",
      signedAt,
      paperFileId: stored.file.id,
      paperSignedByName: "QA Head",
      paperSignedOn: "2027-02-05",
    });
    await sendReminders(db, new Date(signedAt.getTime() + 8 * 86_400_000));
    expect(
      (await kinds("invoice_pending")).filter((n) => n.title === `Invoice pending: ${j!.number}`),
    ).toHaveLength(2);
  });

  it("warns once of an ARC ending within 30 days", async () => {
    const at = new Date("2027-03-10T09:00:00+05:30");
    await sendReminders(db, at);
    await sendReminders(db, new Date(at.getTime() + 86_400_000));
    expect(
      (await kinds("contract_expiring")).filter((n) => n.title === "ARC ending: Lupin Ltd"),
    ).toHaveLength(2);
  });
});
