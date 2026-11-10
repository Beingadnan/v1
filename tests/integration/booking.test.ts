/**
 * Booking by hand (QA Tech, Nov 2026): the client's gate pass first, then the
 * model, then the loggers typed or scanned from the free ones. No random
 * pick of loggers; the gate pass list prints what goes in.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sites, users } from "@/db/schema";
import { ensureOrganisation } from "@/db/seed/ensure-organisation";
import { ForbiddenError } from "@/domain/auth/permissions";
import { toSessionUser, type SessionUser } from "@/domain/auth/session-service";
import { createCompany } from "@/domain/clients/company-service";
import { createEquipment } from "@/domain/clients/equipment-service";
import { getCompany } from "@/domain/clients/queries";
import { createExternalCertificate } from "@/domain/instruments/certificate-service";
import { bulkAddInstruments, saveModel } from "@/domain/instruments/instrument-service";
import {
  autoBook,
  bookByCodes,
  bookingChoices,
  createJob,
  recordGatePass,
} from "@/domain/jobs/job-service";
import { gatePassList, getJob } from "@/domain/jobs/queries";

import { openTestDatabase } from "../support/test-db";

const { db, close } = openTestDatabase();
afterAll(close);
const req = { ipAddress: "203.0.113.82" };
let manager: SessionUser;
let engineer: SessionUser;
let companyId: string;
let siteId: string;
let freezer: string;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const inDays = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

beforeAll(async () => {
  const org = (await ensureOrganisation(db, { slug: "booking-org", name: "QA Tech Booking" }))
    .organisation;
  const make = async (email: string, role: string, name: string) => {
    const [row] = await db
      .insert(users)
      .values({ organisationId: org.id, email, name, role, status: "active", passwordHash: "x" })
      .returning();
    return toSessionUser(row!)!;
  };
  manager = await make("mgr@booking.test", "manager", "Manager");
  engineer = await make("fe@booking.test", "field_engineer", "Engineer");
  const [bhw] = await db
    .insert(sites)
    .values({ organisationId: org.id, code: "BHW", name: "Bhiwandi" })
    .returning();
  companyId = (
    await createCompany(
      db,
      manager,
      {
        name: "Glenmark",
        code: "Glenmark",
        gstin: "",
        address: "",
        notes: "",
        postCalRequired: false,
        requalificationMonths: 12,
        reportNumberFormat: "{CLIENT}/{SITE}/{MM}/{YY}/{EQUIPMENT_ID}",
        firstSite: { name: "Indore", code: "IND", address: "", city: "", state: "", gstin: "" },
      },
      req,
    )
  ).id;
  siteId = (await getCompany(db, manager, companyId))!.sites[0]!.id;
  freezer = (
    await createEquipment(
      db,
      manager,
      companyId,
      {
        siteId,
        code: "WH013",
        name: "Dispensing-2",
        type: "warehouse",
        departmentId: null,
        location: "",
        make: "",
        model: "",
        serialNo: "",
        lengthM: "",
        widthM: "",
        heightM: "",
        setPointC: "",
        tempMinC: "",
        tempMaxC: "25",
        rhMinPct: "",
        rhMaxPct: "",
        defaultChannels: "3",
        readingIntervalMinutes: "10",
        studyDurationHours: "24",
        requalificationMonths: "",
        lastStudyOn: "",
        notes: "",
      } as never,
      req,
    )
  ).id;
  const model = async (make: string, name: string) =>
    (
      await saveModel(
        db,
        manager,
        null,
        {
          type: "portable_logger",
          make,
          model: name,
          equipmentName: "Temperature Datalogger",
          quantities: ["temperature", "humidity"],
          accuracy: { temperature: "0.5", humidity: "3" },
          defaultPoints: [{ quantity: "temperature", reference: "25", condition: "" }],
          intervalMonths: 12,
        },
        req,
      )
    ).id;
  const testo = await model("Testo", "174H");
  const ebro = await model("ebro", "EBI 20-TH1");
  const add = (modelId: string, prefix: string, serials: string[]) =>
    bulkAddInstruments(
      db,
      manager,
      { modelId, homeSiteId: bhw!.id, codePrefix: prefix, serials: serials.join("\n") },
      req,
    );
  const testoIn = await add(testo, "T-TRH", ["7001", "7002", "7003", "7004", "7005"]);
  const ebroIn = await add(ebro, "E-TRH", ["9001", "9002"]);
  // Four Testo and both ebro are calibrated; T-TRH005 (serial 7005) isn't.
  await createExternalCertificate(
    db,
    manager,
    {
      number: "QATECH/BHIWANDI/10/26/PDL-30",
      ulrNo: "",
      labName: "QA Tech Lab",
      calibratedOn: inDays(-20),
      validUntil: inDays(300),
      instrumentIds: [...testoIn.slice(0, 4), ...ebroIn].map((a) => a.id),
    },
    req,
  );
});

const newJob = async (start: number) =>
  (
    await createJob(
      db,
      manager,
      {
        companyId,
        clientSiteId: siteId,
        plannedStart: inDays(start),
        plannedEnd: inDays(start + 2),
        items: [{ equipmentId: freezer }],
      },
      req,
    )
  ).id;
const item = async (id: string, key: string) =>
  (await getJob(db, manager, id))!.readiness.items.find((i) => i.key === key)!;

describe("booking by hand", () => {
  let jobId: string;

  it("asks for the client's gate pass first", async () => {
    jobId = await newJob(10);
    expect(await item(jobId, "site_access")).toMatchObject({ state: "pending", calculated: true });
    await expect(recordGatePass(db, manager, jobId, { number: " " }, req)).rejects.toThrow(
      "Enter the gate pass number, or mark it not needed.",
    );
    await expect(
      recordGatePass(db, engineer, jobId, { number: "GP-1" }, req),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await recordGatePass(db, manager, jobId, { number: "GP/IND/0881" }, req);
    expect(await item(jobId, "site_access")).toMatchObject({
      state: "ready",
      detail: "Gate pass GP/IND/0881",
    });
  });

  it("shows each model's free loggers and why the rest aren't free", async () => {
    const choices = await bookingChoices(db, manager, jobId);
    expect(choices.needs).toEqual([{ type: "portable_logger", needed: 3, booked: 0 }]);
    const testo = choices.models.find((m) => m.label === "Testo 174H")!;
    expect(testo).toMatchObject({ total: 5, booked: 0, busy: 0, outOfDate: 1, notInUse: 0 });
    expect(testo.free.map((f) => f.code)).toEqual([
      "T-TRH0001",
      "T-TRH0002",
      "T-TRH0003",
      "T-TRH0004",
    ]);
    expect(testo.free[0]).toMatchObject({ serialNo: "7001", validUntil: inDays(300) });
    expect(choices.models[0]!.label).toBe("Testo 174H");
  });

  it("books only the model picked, by ID or serial", async () => {
    const r = await bookByCodes(
      db,
      manager,
      jobId,
      "T-TRH0001\n7002\nE-TRH0001",
      req,
      "Testo 174H",
    );
    expect(r.booked).toEqual(["T-TRH0001", "T-TRH0002"]);
    expect(r.refused).toEqual([
      { code: "E-TRH0001", reason: "is a ebro EBI 20-TH1, not a Testo 174H" },
    ]);
    const after = await bookingChoices(db, manager, jobId);
    expect(after.needs[0]!.booked).toBe(2);
    expect(after.models.find((m) => m.label === "Testo 174H")).toMatchObject({ booked: 2 });
  });

  it("counts loggers held by another job on the same dates as busy", async () => {
    const other = await newJob(11);
    await recordGatePass(db, manager, other, { notNeeded: true }, req);
    expect(await item(other, "site_access")).toMatchObject({ state: "na" });
    const testo = (await bookingChoices(db, manager, other)).models.find(
      (m) => m.label === "Testo 174H",
    )!;
    expect(testo).toMatchObject({ busy: 2, booked: 0 });
    expect(testo.free.map((f) => f.code)).toEqual(["T-TRH0003", "T-TRH0004"]);
    // Every logger is listed, with where it stands and where it is.
    const first = (await getJob(db, manager, jobId))!.job.number;
    const by = new Map(testo.loggers.map((l) => [l.code, l]));
    expect(by.get("T-TRH0001")).toMatchObject({ state: "busy", serialNo: "7001" });
    const where = by.get("T-TRH0001")!.where;
    expect(where.startsWith(`On ${first} · Glenmark, Indore · `)).toBe(true);
    expect(where).toMatch(/\d{2}\.\d{2}–\d{2}\.\d{2}$/);
    expect(by.get("T-TRH0003")).toMatchObject({ state: "free", where: "Free · at Bhiwandi" });
    expect(by.get("T-TRH0005")).toMatchObject({
      state: "out_of_date",
      where: "No calibration certificate",
    });
    const own = (await bookingChoices(db, manager, jobId)).models.find(
      (m) => m.label === "Testo 174H",
    )!;
    expect(own.loggers.find((l) => l.code === "T-TRH0001")).toMatchObject({
      state: "booked",
      where: "Booked on this job",
    });
  });

  it("no longer picks loggers by itself", async () => {
    const r = await autoBook(db, manager, jobId, req);
    expect(r.booked).toEqual([]);
    expect((await bookingChoices(db, manager, jobId)).needs[0]!.booked).toBe(2);
  });

  it("prints the gate pass list of what goes in", async () => {
    const out = (await gatePassList(db, manager, jobId))!;
    expect(out.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(out.fileName).toMatch(/^Gate pass list QT-\d{2}-\d{4}-\d{4}\.pdf$/);
  });
});
