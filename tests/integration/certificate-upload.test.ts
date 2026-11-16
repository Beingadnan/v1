import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { auditLog, certificateItems, certificates, users } from "@/db/schema";
import { ensureOrganisation } from "@/db/seed/ensure-organisation";
import { hashPassword } from "@/domain/auth/password";
import { toSessionUser, type SessionUser } from "@/domain/auth/session-service";
import { createExternalCertificate } from "@/domain/instruments/certificate-service";
import {
  checkCertificateUpload,
  readCertificateUpload,
  saveCertificateUploads,
} from "@/domain/instruments/certificate-upload-service";
import { createInstrument } from "@/domain/instruments/instrument-service";
import type { SketchReader } from "@/lib/ai/sketch-reader";
import { LocalBlobStore } from "@/lib/storage/blob-store";
import { storeFile } from "@/lib/storage/store-file";

import { openTestDatabase } from "../support/test-db";

const { db } = openTestDatabase();
const req = { ipAddress: "203.0.113.61" };
let manager: SessionUser;
let blobs: LocalBlobStore;
const ids: Record<string, string> = {};
let importedId: string;

/** A one-page "PDF": enough for the store, which checks the header. */
async function upload(fileName: string, salt: string) {
  const bytes = new TextEncoder().encode(`%PDF-1.4\n% ${salt}\n%%EOF\n`);
  const stored = await storeFile(db, blobs, {
    organisationId: manager.organisationId,
    actor: { type: "user", userId: manager.id },
    fileName,
    bytes,
    maxBytes: 1_000_000,
  });
  if (!stored.ok) throw new Error(stored.message);
  return stored.file.id;
}

/** A stand-in for the vision model, counting its calls. */
function fakeReader(answer: unknown) {
  const reader = (async () => {
    reader.calls += 1;
    return answer;
  }) as unknown as SketchReader & { calls: number };
  reader.calls = 0;
  reader.model = "test-reader";
  return reader;
}

beforeAll(async () => {
  const org = (await ensureOrganisation(db, { slug: "upload-org", name: "QA Tech" })).organisation;
  const [row] = await db
    .insert(users)
    .values({
      organisationId: org.id,
      email: "mgr@upload.test",
      name: "Quality Manager",
      role: "manager",
      status: "active",
      passwordHash: await hashPassword("scan the certificates", { N: 1024, r: 8, p: 1 }),
    })
    .returning();
  manager = toSessionUser(row!)!;
  blobs = new LocalBlobStore(await mkdtemp(path.join(tmpdir(), "qtech-upload-")));
  for (const [code, serial, tier, type] of [
    ["QATM/CAL/TL-38", "61442336", "master", "humidity_indicator"],
    ["TRHS-031", "20482915", "working", "humidity_indicator"],
    ["TRHS-032", "20482916", "working", "humidity_indicator"],
  ] as const) {
    ids[code] = (
      await createInstrument(
        db,
        manager,
        { type, tier, code, serialNo: serial, make: "Rotronic", model: "HC2-S3" },
        req,
      )
    ).id;
  }
  // An FT-05 imported from the Excel lists, its signed scan never attached.
  importedId = (
    await createExternalCertificate(
      db,
      manager,
      {
        number: "QATECH/BHIWANDI/05/26/TRHS-02",
        labName: "QA Tech",
        calibratedOn: "2026-05-04",
        validUntil: "2027-05-03",
        instrumentIds: [ids["TRHS-031"]!, ids["TRHS-032"]!],
        kind: "imported",
      },
      req,
    )
  ).id;
});

describe("uploading certificate scans", () => {
  it("attaches a scan to its certificate on record, found by number", async () => {
    const fileId = await upload("20260424165534.pdf", "rotronic batch");
    const reader = fakeReader({
      certificates: [
        {
          page: 1,
          number: "QATECH / BHIWANDI/05/26/TRHS-02",
          ulrNo: "",
          labName: "QA Tech",
          calibratedOn: "2026-05-04",
          validUntil: "2027-05-03",
          instruments: [
            { id: "TRHS-031", serial: "20482915" },
            { id: "TRHS-032", serial: "20482916" },
          ],
          notes: "",
        },
      ],
    });
    const [row] = await readCertificateUpload(db, blobs, reader, manager, fileId, req);
    expect(row).toMatchObject({
      source: "reader",
      action: "attach",
      target: { id: importedId, hasFile: false },
    });
    expect(row!.instruments.map((i) => i.id)).toEqual([ids["TRHS-031"], ids["TRHS-032"]]);

    // Read once: the same file again comes from the kept reading.
    await readCertificateUpload(db, blobs, reader, manager, fileId, req);
    expect(reader.calls).toBe(1);

    const [saved] = await saveCertificateUploads(db, manager, [{ ...row!, key: row!.key }], req);
    expect(saved).toMatchObject({ ok: true, certificateId: importedId });
    const [cert] = await db.select().from(certificates).where(eq(certificates.id, importedId));
    expect(cert!.fileId).toBe(fileId);
    const audits = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.organisationId, manager.organisationId)));
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(["certificate.scan_read", "certificate.file_attached"]),
    );
  });

  it("records an outside lab's certificate for a master as new", async () => {
    const fileId = await upload("TL-38 27.01.2027.pdf", "sansel");
    const reader = fakeReader({
      certificates: [
        {
          page: 1,
          number: "SAN/26/128/TH/1",
          ulrNo: "CC287926000000394F",
          labName: "Sansel Calibration Laboratories LLP",
          calibratedOn: "2026-01-28",
          validUntil: "2027-01-27",
          instruments: [{ id: "QATM/CAL/TL-38", serial: "61442336/61474281" }],
          notes: "",
        },
      ],
    });
    const [row] = await readCertificateUpload(db, blobs, reader, manager, fileId, req);
    expect(row).toMatchObject({ action: "create", target: null, problems: [] });
    const [saved] = await saveCertificateUploads(db, manager, [{ ...row!, key: "k" }], req);
    expect(saved!.ok).toBe(true);
    const [cert] = await db
      .select()
      .from(certificates)
      .where(eq(certificates.id, saved!.certificateId!));
    expect(cert).toMatchObject({
      kind: "external",
      number: "SAN/26/128/TH/1",
      fileId,
      validUntil: "2027-01-27",
    });
    const items = await db
      .select()
      .from(certificateItems)
      .where(eq(certificateItems.certificateId, cert!.id));
    expect(items.map((i) => i.instrumentId)).toEqual([ids["QATM/CAL/TL-38"]]);
  });

  it("without a reader, reads the file name and finds the certificate on file", async () => {
    const fileId = await upload("TL-38 27.01.2027_1.pdf", "second copy");
    const [row] = await readCertificateUpload(db, blobs, null, manager, fileId, req);
    expect(row).toMatchObject({
      source: "file_name",
      codes: ["TL-38"],
      validUntil: "2027-01-27",
      action: "on_file",
      target: { number: "SAN/26/128/TH/1", hasFile: true },
    });
  });

  it("says what is missing before it can be saved", async () => {
    const fileId = await upload("4222_001.pdf", "scanner");
    const [row] = await readCertificateUpload(db, blobs, null, manager, fileId, req);
    expect(row).toMatchObject({ source: "none", action: "incomplete" });

    const edited = await checkCertificateUpload(db, manager, {
      ...row!,
      number: "TL/026/9.1.1",
      labName: "Tempsens Calibration Centre",
      calibratedOn: "2026-08-01",
      codes: ["TL-38", "TL-99"],
    });
    expect(edited.action).toBe("incomplete");
    expect(edited.problems).toEqual([
      "Not in the register: TL-99. Add it first, or remove it here.",
    ]);
    const [saved] = await saveCertificateUploads(db, manager, [{ ...edited, key: "x" }], req);
    expect(saved).toMatchObject({ ok: false });
  });
});
