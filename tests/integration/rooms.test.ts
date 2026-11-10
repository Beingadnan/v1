/**
 * Rooms mapped as areas (QA Tech, Nov 2026): a dispensing room like QA Tech's
 * WH013 gets a logger on each wall at working height and one in the centre,
 * and the FT-12 sheet calls it a room.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { and, desc, eq } from "drizzle-orm";

import { auditLog, users } from "@/db/schema";
import { ensureOrganisation } from "@/db/seed/ensure-organisation";
import { toSessionUser, type SessionUser } from "@/domain/auth/session-service";
import { createCompany } from "@/domain/clients/company-service";
import { createEquipment } from "@/domain/clients/equipment-service";
import { getCompany } from "@/domain/clients/queries";
import { layoutTemplate, saveLayout } from "@/domain/field/field-service";
import { ft12Pdf, getFieldStudy } from "@/domain/field/queries";
import { createJob } from "@/domain/jobs/job-service";
import { getJob } from "@/domain/jobs/queries";
import { LocalBlobStore } from "@/lib/storage/blob-store";

import { openTestDatabase } from "../support/test-db";

const { db, close } = openTestDatabase();
afterAll(close);
const req = { ipAddress: "203.0.113.83" };
let manager: SessionUser;
let roomId: string;
let companyId: string;
let siteId: string;

const hasPdftotext = (() => {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const blank = {
  departmentId: null,
  location: "",
  make: "",
  model: "",
  serialNo: "",
  setPointC: "",
  tempMinC: "",
  rhMinPct: "",
  defaultChannels: "",
  requalificationMonths: "",
  lastStudyOn: "",
  notes: "",
};

beforeAll(async () => {
  const org = (await ensureOrganisation(db, { slug: "rooms-org", name: "QA Tech Rooms" }))
    .organisation;
  const [row] = await db
    .insert(users)
    .values({
      organisationId: org.id,
      email: "mgr@rooms.test",
      name: "Manager",
      role: "manager",
      status: "active",
      passwordHash: "x",
    })
    .returning();
  manager = toSessionUser(row!)!;
  companyId = (
    await createCompany(
      db,
      manager,
      {
        name: "Glenmark Pharmaceuticals Limited",
        code: "Glenmark",
        gstin: "",
        address: "",
        notes: "",
        postCalRequired: false,
        requalificationMonths: 12,
        reportNumberFormat: "{CLIENT}/{SITE}/{MM}/{YY}/{EQUIPMENT}/{EQUIPMENT_ID}",
        firstSite: { name: "Indore", code: "Indore", address: "", city: "", state: "", gstin: "" },
      },
      req,
    )
  ).id;
  siteId = (await getCompany(db, manager, companyId))!.sites[0]!.id;
  roomId = (
    await createEquipment(
      db,
      manager,
      companyId,
      {
        ...blank,
        siteId,
        code: "WH013",
        name: "Dispensing -2",
        type: "room",
        lengthM: "6",
        widthM: "4",
        heightM: "2.5",
        tempMaxC: "25",
        rhMaxPct: "40",
        readingIntervalMinutes: "10",
        studyDurationHours: "24",
      } as never,
      req,
    )
  ).id;
});

describe("a room mapped as an area", () => {
  let studyId: string;

  it("plans five loggers for a 6 × 4 m room: one per wall and the centre", async () => {
    const job = await createJob(
      db,
      manager,
      {
        companyId,
        clientSiteId: siteId,
        plannedStart: "2026-12-01",
        plannedEnd: "2026-12-02",
        items: [{ equipmentId: roomId }],
      },
      req,
    );
    const study = (await getJob(db, manager, job.id))!.studies[0]!;
    expect(study).toMatchObject({ loggerCount: 5, workType: "temperature_rh_mapping" });
    expect(study.equipment.type).toBe("room");
    studyId = study.id;
  });

  it("fills the layout along the walls at working height", async () => {
    const points = await layoutTemplate(db, manager, studyId);
    expect(points.map((p) => [p.label, p.note])).toEqual([
      ["L-01", "Working height on wall-1"],
      ["L-02", "Working height on wall-2"],
      ["L-03", "Working height on wall-3"],
      ["L-04", "Working height on wall-4"],
      ["L-05", "Working height, centre of the room"],
    ]);
    // 1 m up a 2.5 m room.
    expect(points.every((p) => p.z === 0.4)).toBe(true);
    await saveLayout(
      db,
      manager,
      studyId,
      [
        ...points,
        {
          label: "AMB",
          x: 0,
          y: 0,
          z: 0.5,
          note: "At security gate",
          ambient: true,
        },
      ],
      req,
    );
  });

  it("marks the door, pass box and LAF on the plan, saved with the positions", async () => {
    const before = (await getFieldStudy(db, manager, studyId))!;
    const points = before.positions.map(({ label, x, y, z, note, ambient }) => ({
      label,
      x,
      y,
      z,
      note,
      ambient,
    }));
    await expect(
      saveLayout(
        db,
        manager,
        studyId,
        { points, features: [{ kind: "lift", label: "", x: 0.5, y: 0.5 }] },
        req,
      ),
    ).rejects.toThrow();
    const features = [
      { kind: "door", label: "Door", x: 0.2, y: 0 },
      { kind: "pass_box", label: "Pass box", x: 0.35, y: 0 },
      { kind: "laf", label: "RLAF", x: 0.5, y: 0.85 },
    ];
    await saveLayout(db, manager, studyId, { points, features }, req);
    const after = (await getFieldStudy(db, manager, studyId))!;
    expect(after.study.planFeatures).toEqual(features);
    expect(after.positions).toHaveLength(6);
    const [audit] = await db
      .select({ summary: auditLog.summary })
      .from(auditLog)
      .where(and(eq(auditLog.entityId, studyId), eq(auditLog.action, "study.layout_saved")))
      .orderBy(desc(auditLog.occurredAt))
      .limit(1);
    expect(audit!.summary).toMatch(/6 positions, 3 marks on the plan$/);
    // Saving the positions alone keeps the marks.
    await saveLayout(db, manager, studyId, points, req);
    expect((await getFieldStudy(db, manager, studyId))!.study.planFeatures).toHaveLength(3);
  });

  it("offers the positions and the marks to the room's next study", async () => {
    const next = await createJob(
      db,
      manager,
      {
        companyId,
        clientSiteId: siteId,
        plannedStart: "2027-12-01",
        plannedEnd: "2027-12-02",
        items: [{ equipmentId: roomId }],
      },
      req,
    );
    const nextStudy = (await getJob(db, manager, next.id))!.studies[0]!;
    const s = (await getFieldStudy(db, manager, nextStudy.id))!;
    expect(s.previousLayout!.points).toHaveLength(6);
    expect(s.previousLayout!.features.map((f) => f.kind)).toEqual(["door", "pass_box", "laf"]);
  });

  it.skipIf(!hasPdftotext)("prints the FT-12 sheet for a room", async () => {
    const blobs = new LocalBlobStore(await mkdtemp(path.join(tmpdir(), "qtech-room-blobs-")));
    const out = (await ft12Pdf(db, blobs, manager, studyId))!;
    const dir = await mkdtemp(path.join(tmpdir(), "qtech-room-"));
    await writeFile(path.join(dir, "ft12.pdf"), out.bytes);
    execFileSync("pdftotext", ["-layout", path.join(dir, "ft12.pdf"), path.join(dir, "ft12.txt")]);
    const text = await readFile(path.join(dir, "ft12.txt"), "utf8");
    expect(text).toContain("Room ID");
    expect(text).toContain("Room size");
    expect(text).not.toContain("Equipment ID");
    // The floor plan: walls and marks, not the box.
    expect(text).toContain("Wall-1");
    expect(text).toContain("Wall-3");
    expect(text).toMatch(/\bPB\b/);
    expect(text).toContain("RLAF");
  });
});
