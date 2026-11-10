/**
 * scripts/seed-demo.ts, run against the test database with QA Tech's real
 * PDL-12 workbook and masters: one TEST job at every stage.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { jobs, sites, users } from "@/db/schema";
import { DEMO_STAGES, seedDemoJobs, type DemoStaff } from "@/db/seed/demo-jobs";
import { ensureOrganisation } from "@/db/seed/ensure-organisation";
import { hashPassword } from "@/domain/auth/password";
import { toSessionUser } from "@/domain/auth/session-service";
import { createExternalCertificate } from "@/domain/instruments/certificate-service";
import { applyInstrumentImport } from "@/domain/instruments/instrument-import-service";
import { createInstrument } from "@/domain/instruments/instrument-service";
import { LocalBlobStore } from "@/lib/storage/blob-store";
import { storeFile } from "@/lib/storage/store-file";

import { openTestDatabase } from "../support/test-db";

const { db, close } = openTestDatabase();
afterAll(close);
const PDL12 = path.resolve(__dirname, "../../fixtures/client/instruments/23.07.2026 PDL-12.xlsx");
const req = { ipAddress: "127.0.0.1" };

describe.skipIf(!existsSync(PDL12))("seeding the TEST jobs at every stage", () => {
  it("leaves one job at each stage, created to closed", { timeout: 180_000 }, async () => {
    const blobs = new LocalBlobStore(await mkdtemp(path.join(tmpdir(), "qtech-seed-demo-")));
    const org = (await ensureOrganisation(db, { slug: "seed-demo-org", name: "QA Tech" }))
      .organisation;
    await db.insert(sites).values({ organisationId: org.id, code: "BHW", name: "Bhiwandi" });
    const password = "seed demo password 2026";
    const hash = await hashPassword(password, { N: 1024, r: 8, p: 1 });
    const make = async (role: string, name: string) => {
      const [row] = await db
        .insert(users)
        .values({
          organisationId: org.id,
          email: `${role}@seed-demo.test`,
          name,
          role,
          status: "active",
          passwordHash: hash,
        })
        .returning();
      return { user: toSessionUser(row!)!, password };
    };
    const people = {
      manager: await make("manager", "TEST Meera Manager"),
      lead: await make("team_leader", "TEST Tarun Lead"),
      engineer: await make("field_engineer", "TEST Ravi Engineer"),
      lab: await make("lab", "TEST Lata Lab"),
      preparer: await make("report_preparer", "TEST Mangesh Preparer"),
      accounts: await make("accounts", "TEST Kavita Accounts"),
    } satisfies DemoStaff;
    const m = people.manager.user;
    for (const [code, type, number, from, to] of [
      ["QATM/CAL/TL-65", "reference_thermometer", "TL/026/444.1.1", "2026-04-06", "2027-04-05"],
      ["QATM/CAL/TL-38", "humidity_indicator", "SAN/26/128/TH/1", "2026-01-28", "2027-01-27"],
    ] as const) {
      const i = await createInstrument(db, m, { type, tier: "master", code, serialNo: code }, req);
      await createExternalCertificate(
        db,
        m,
        {
          number,
          labName: "Outside lab",
          calibratedOn: from,
          validUntil: to,
          instrumentIds: [i.id],
        },
        req,
      );
    }
    const s = await storeFile(db, blobs, {
      organisationId: org.id,
      actor: { type: "user", userId: m.id },
      fileName: "23.07.2026 PDL-12.xlsx",
      bytes: new Uint8Array(readFileSync(PDL12)),
      maxBytes: 20 * 1024 * 1024,
    });
    if (!s.ok) throw new Error(s.message);
    await applyInstrumentImport(
      db,
      blobs,
      people.lab.user,
      s.file.id,
      { defaultType: "portable_logger" },
      req,
    );

    const lines: string[] = [];
    await seedDemoJobs(db, blobs, people, "client seed password 2026", (l) => lines.push(l));
    // A second run (or one after a stop half-way) carries on and changes nothing done.
    const again: string[] = [];
    await seedDemoJobs(db, blobs, people, "client seed password 2026", (l) => again.push(l));
    expect(again.filter((l) => l.endsWith("(already there)"))).toHaveLength(DEMO_STAGES.length);
    const statuses = await db
      .select({ number: jobs.number, status: jobs.status, title: jobs.title })
      .from(jobs)
      .where(eq(jobs.organisationId, org.id))
      .orderBy(jobs.number);
    expect(statuses.map((j) => j.status)).toEqual([
      "created",
      "ready",
      "field_work",
      "data_received",
      "analysis",
      "report_draft",
      "sent_to_client",
      "invoiced",
      "closed",
    ]);
    expect(lines).toHaveLength(DEMO_STAGES.length + 1);
  });
});
