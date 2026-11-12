/**
 * Phase 12: registers QA Tech's reference masters and their outside-lab (NABL)
 * certificates from a JSON file written from the certificate PDFs, with each
 * PDF attached. Run before `import:instruments`, so the FT-05 workbooks link
 * their masters.
 *
 *   npm run import:masters -- --file fixtures/masters/masters.json
 *
 * The file: { instruments: [{ code, type, make, model, serialNo, … }],
 *             certificates: [{ number, ulrNo, labName, labAccreditation, calibratedOn,
 *                              calibratedUntil?, validUntil, issuedOn, codes: [...], pdf }] }
 * where `pdf` is relative to the JSON file. Re-running skips what is already there.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { eq } from "drizzle-orm";

import { createDatabase, createPool } from "@/db/client-factory";
import { certificates, instruments } from "@/db/schema";
import { createExternalCertificate } from "@/domain/instruments/certificate-service";
import { createInstrument } from "@/domain/instruments/instrument-service";
import { LocalBlobStore, type BlobStore } from "@/lib/storage/blob-store";
import { storeFile } from "@/lib/storage/store-file";
import { VercelBlobStore } from "@/lib/storage/vercel-blob-store";

import { importActor } from "./import-actor";

type MastersFile = {
  instruments: (Record<string, string> & { code: string })[];
  certificates: (Record<string, string | string[]> & {
    number: string;
    codes: string[];
    pdf?: string;
  })[];
};

const request = { ipAddress: "127.0.0.1", userAgent: "import-masters script" };

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { file: { type: "string" }, email: { type: "string" } },
  });
  if (!values.file) {
    throw new Error(
      "Usage: npm run import:masters -- --file <masters.json> [--email <admin email>]",
    );
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  const blobs: BlobStore = token
    ? new VercelBlobStore(token)
    : new LocalBlobStore(process.env.STORAGE_LOCAL_DIR || "./.data/storage");
  const data = JSON.parse(await readFile(values.file, "utf8")) as MastersFile;
  const base = path.dirname(values.file);

  const pool = createPool(url, 2);
  try {
    const db = createDatabase(pool);
    const actor = await importActor(db, values.email);
    const org = actor.organisationId;

    const idByCode = new Map(
      (
        await db
          .select({ id: instruments.id, code: instruments.code })
          .from(instruments)
          .where(eq(instruments.organisationId, org))
      ).map((i) => [i.code.toLowerCase(), i.id]),
    );
    let added = 0;
    for (const i of data.instruments) {
      if (idByCode.has(i.code.toLowerCase())) continue;
      const created = await createInstrument(db, actor, { ...i, tier: "master" }, request);
      idByCode.set(created.code.toLowerCase(), created.id);
      added += 1;
    }

    const have = new Set(
      (
        await db
          .select({ number: certificates.number })
          .from(certificates)
          .where(eq(certificates.organisationId, org))
      ).map((c) => c.number.toLowerCase()),
    );
    let certs = 0;
    for (const c of data.certificates) {
      if (have.has(c.number.toLowerCase())) continue;
      const ids = c.codes.map((code) => {
        const id = idByCode.get(code.toLowerCase());
        if (!id) throw new Error(`${c.number}: ${code} is not in the instruments list.`);
        return id;
      });
      let fileId: string | null = null;
      if (c.pdf) {
        const stored = await storeFile(db, blobs, {
          organisationId: org,
          actor: { type: "user", userId: actor.id },
          fileName: path.basename(c.pdf),
          bytes: new Uint8Array(await readFile(path.join(base, c.pdf))),
          maxBytes: 50 * 1024 * 1024,
        });
        if (!stored.ok) throw new Error(`${c.number}: ${stored.message}`);
        fileId = stored.file.id;
      }
      const fields = Object.fromEntries(
        Object.entries(c).filter(([k]) => k !== "codes" && k !== "pdf"),
      );
      await createExternalCertificate(
        db,
        actor,
        { ...fields, instrumentIds: ids, fileId },
        request,
      );
      certs += 1;
    }
    console.log(
      `Masters: ${added} added (${data.instruments.length - added} already there). Certificates: ${certs} added (${data.certificates.length - certs} already there).`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  const cause = e instanceof Error && e.cause instanceof Error ? ` (${e.cause.message})` : "";
  console.error((e instanceof Error ? e.message : String(e)) + cause);
  process.exit(1);
});
