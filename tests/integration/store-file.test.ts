import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditLog, storedFiles } from "@/db/schema";
import { ensureOrganisation } from "@/db/seed/ensure-organisation";
import { LocalBlobStore } from "@/lib/storage/blob-store";
import { storeFile } from "@/lib/storage/store-file";

import { openTestDatabase } from "../support/test-db";

const { db, close } = openTestDatabase();
let blobRoot: string;
let blobs: LocalBlobStore;
let orgA: string;
let orgB: string;

const MB = 1024 * 1024;
const csv = new TextEncoder().encode("Date,Time,62281257\n22.05.2026,22:30:00,-22.2\n");

beforeAll(async () => {
  blobRoot = await mkdtemp(path.join(tmpdir(), "qtech-store-"));
  blobs = new LocalBlobStore(blobRoot);
  orgA = (await ensureOrganisation(db, { slug: "files-a", name: "Files A" })).organisation.id;
  orgB = (await ensureOrganisation(db, { slug: "files-b", name: "Files B" })).organisation.id;
});

afterAll(async () => {
  await close();
  await rm(blobRoot, { recursive: true, force: true });
});

describe("storeFile", () => {
  it("stores a file, registers it and writes its hash to the audit log", async () => {
    const result = await storeFile(db, blobs, {
      organisationId: orgA,
      actor: { type: "system" },
      fileName: "BE-WF-02 raw.csv",
      bytes: csv,
      maxBytes: 50 * MB,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.reused).toBe(false);
    expect(result.file.fileType).toBe("csv");
    expect(new Uint8Array(await blobs.get(result.file.storageKey))).toEqual(csv);

    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, result.file.id), eq(auditLog.action, "file.stored")));
    expect(audit?.after).toMatchObject({
      sha256: result.file.sha256,
      fileName: "BE-WF-02 raw.csv",
    });
  });

  it("re-uploading identical content reuses the record but still audits the upload", async () => {
    const result = await storeFile(db, blobs, {
      organisationId: orgA,
      actor: { type: "system" },
      fileName: "copy of raw.csv",
      bytes: csv,
      maxBytes: 50 * MB,
    });
    expect(result.ok && result.reused).toBe(true);
    const rows = await db.select().from(storedFiles).where(eq(storedFiles.organisationId, orgA));
    expect(rows).toHaveLength(1);
    const reuseAudits = await db.select().from(auditLog).where(eq(auditLog.action, "file.reused"));
    expect(reuseAudits.length).toBeGreaterThanOrEqual(1);
  });

  it("keeps organisations separate even for identical content", async () => {
    const result = await storeFile(db, blobs, {
      organisationId: orgB,
      actor: { type: "system" },
      fileName: "raw.csv",
      bytes: csv,
      maxBytes: 50 * MB,
    });
    expect(result.ok && !result.reused).toBe(true);
  });

  it("refuses empty, oversized and mislabelled files without storing anything", async () => {
    const before = await db.$count(storedFiles);
    const base = { organisationId: orgA, actor: { type: "system" as const }, maxBytes: 1024 };

    const empty = await storeFile(db, blobs, {
      ...base,
      fileName: "a.csv",
      bytes: new Uint8Array(),
    });
    const big = await storeFile(db, blobs, {
      ...base,
      fileName: "a.csv",
      bytes: new Uint8Array(2048).fill(65),
    });
    const fake = await storeFile(db, blobs, {
      ...base,
      fileName: "invoice.pdf",
      bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0x00]),
    });

    expect(empty).toMatchObject({ ok: false, reason: "empty" });
    expect(big).toMatchObject({ ok: false, reason: "too_large" });
    expect(fake).toMatchObject({ ok: false, reason: "bad_type" });
    expect(await db.$count(storedFiles)).toBe(before);
  });

  it("strips folder paths and control characters from file names", async () => {
    const result = await storeFile(db, blobs, {
      organisationId: orgB,
      actor: { type: "system" },
      fileName: "C:\\Users\\x\\..\\..\\evil\u0007name.csv",
      bytes: new TextEncoder().encode("a,b\n1,2\n"),
      maxBytes: 50 * MB,
    });
    expect(result.ok && result.file.firstFileName).toBe("evilname.csv");
  });
});

const realXlsx = path.resolve(__dirname, "../../fixtures/client/Dispensing-2 WH013.xlsx");

describe.skipIf(!existsSync(realXlsx))("with a real QA Tech logger export", () => {
  it("stores Dispensing-2 WH013.xlsx and audits its SHA-256", async () => {
    const bytes = readFileSync(realXlsx);
    const result = await storeFile(db, blobs, {
      organisationId: orgA,
      actor: { type: "system" },
      fileName: "Dispensing-2 WH013.xlsx",
      bytes,
      maxBytes: 50 * MB,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.file.fileType).toBe("xlsx");
      expect(result.file.sizeBytes).toBe(bytes.byteLength);
    }
  });
});
