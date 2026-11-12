/**
 * Phase 12: imports a folder of QA Tech's Excel files (instrument lists and FT-05
 * certificate workbooks) through the same import as Instruments → Import, one
 * file at a time, as the given admin. Every file is stored and audited as if
 * uploaded on that screen.
 *
 *   npm run import:instruments -- --dir fixtures/real-xlsx
 *
 * Lists are imported before certificate workbooks, so certificates that only
 * give a serial number find the ID the list gave it. Re-running is safe: a file
 * already imported reports "Nothing new to import". `--not-ours "E ENG GEN TE-"` leaves
 * out a client's own equipment (IDs starting so) and certificates naming only those. A summary and every
 * problem the import noticed are written to <dir>/import-log.txt.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import ExcelJS from "exceljs";

import { createDatabase, createPool } from "@/db/client-factory";
import { readInstrumentList } from "@/domain/instruments/instrument-import";
import {
  applyInstrumentImport,
  previewInstrumentImport,
} from "@/domain/instruments/instrument-import-service";
import { LocalBlobStore, type BlobStore } from "@/lib/storage/blob-store";
import { storeFile } from "@/lib/storage/store-file";
import { VercelBlobStore } from "@/lib/storage/vercel-blob-store";

import { importActor } from "./import-actor";

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (
      /\.xlsx$/i.test(e.name) &&
      !e.name.startsWith("~$") &&
      e.name !== "serials-without-id.xlsx"
    )
      out.push(p);
  }
  return out.sort();
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      dir: { type: "string" },
      email: { type: "string" },
      // A client's own equipment IDs, left out: --not-ours "E ENG GEN TE-" (repeatable).
      "not-ours": { type: "string", multiple: true },
    },
  });
  if (!values.dir) {
    throw new Error(
      "Usage: npm run import:instruments -- --dir <folder of .xlsx> [--email <admin email>]",
    );
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  const blobs: BlobStore = token
    ? new VercelBlobStore(token)
    : new LocalBlobStore(process.env.STORAGE_LOCAL_DIR || "./.data/storage");
  const maxBytes = Number(process.env.UPLOAD_MAX_MB || 50) * 1024 * 1024;

  const pool = createPool(url, 2);
  const log: string[] = [];
  try {
    const db = createDatabase(pool);
    const actor = await importActor(db, values.email);

    // Lists first, then certificate workbooks oldest first (dates lead most names).
    const files = await walk(values.dir);
    const kinds = await Promise.all(
      files.map(async (f) => {
        const read = await readInstrumentList(new Uint8Array(await readFile(f)));
        return {
          f,
          list: read.workbookCertificates.length === 0 && read.rows.length > 0,
          empty: read.workbookCertificates.length === 0 && read.rows.length === 0,
          when: read.workbookCertificates.map((c) => c.calibratedOn).sort()[0] ?? "",
        };
      }),
    );
    const order = kinds
      .filter((k) => !k.empty)
      .sort((a, b) => Number(b.list) - Number(a.list) || a.when.localeCompare(b.when));
    const skippedFiles = kinds.filter((k) => k.empty).map((k) => k.f);

    const totals = {
      files: 0,
      instruments: 0,
      certificates: 0,
      readings: 0,
      nothing: 0,
      needIds: 0,
      failed: 0,
    };
    // Serials with no QA Tech ID: left out until QA Tech gives them one (a list with ID and
    // serial, imported like any other, then this run again).
    const noId = new Map<string, { make: string; model: string; files: Set<string> }>();
    for (const [i, k] of order.entries()) {
      const name = path.relative(values.dir, k.f);
      const stored = await storeFile(db, blobs, {
        organisationId: actor.organisationId,
        actor: { type: "user", userId: actor.id },
        fileName: path.basename(k.f),
        bytes: new Uint8Array(await readFile(k.f)),
        maxBytes,
      });
      if (!stored.ok) {
        totals.failed += 1;
        log.push(`FAILED  ${name}: ${stored.message}`);
        continue;
      }
      const choices = { defaultType: "portable_logger", notOurs: values["not-ours"] ?? [] };
      let preview: Awaited<ReturnType<typeof previewInstrumentImport>> | null = null;
      try {
        preview = await previewInstrumentImport(db, blobs, actor, stored.file.id, choices);
        for (const u of preview.plan.unassigned) {
          const e = noId.get(u.serialNo) ?? { make: u.make, model: u.model, files: new Set() };
          e.files.add(path.basename(k.f));
          noId.set(u.serialNo, e);
        }
        const s = await applyInstrumentImport(db, blobs, actor, stored.file.id, choices, {
          ipAddress: "127.0.0.1",
          userAgent: "import-instruments script",
        });
        totals.files += 1;
        totals.instruments += s.instruments;
        totals.certificates += s.certificates;
        totals.readings += s.readings;
        log.push(
          `OK      ${name}: ${s.instruments} instruments, ${s.certificates} certificates, ${s.readings} readings`,
          ...preview.plan.problems.map((p) => `          ! ${p}`),
          ...(preview.plan.unassigned.length
            ? [`          ! ${preview.plan.unassigned.length} serials with no QA Tech ID left out`]
            : []),
        );
      } catch (error) {
        // A database error's own reason is in its cause; the query text is not useful here.
        const cause =
          error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
        const message = cause || (error instanceof Error ? error.message : String(error));
        const tag = /Nothing new to import/.test(message)
          ? "SAME    "
          : /no QA Tech ID/.test(message)
            ? "NO IDS  "
            : "FAILED  ";
        if (tag === "SAME    ") totals.nothing += 1;
        else if (tag === "NO IDS  ") totals.needIds += 1;
        else totals.failed += 1;
        log.push(`${tag}${name}: ${message}`);
      }
      if ((i + 1) % 20 === 0) console.log(`${i + 1} of ${order.length} files...`);
    }
    for (const f of skippedFiles) log.push(`NOT READ ${path.relative(values.dir, f)}`);
    const summary = `Imported ${totals.files} files: ${totals.instruments} instruments, ${totals.certificates} certificates, ${totals.readings} readings. ${totals.nothing} had nothing new, ${totals.needIds} only name loggers with no QA Tech ID, ${totals.failed} failed, ${skippedFiles.length} were not instrument files. ${noId.size} serials have no QA Tech ID.`;
    // An Excel list the import screen reads back: fill in "QA Tech ID", import it, run again.
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Serials without ID");
    sheet.columns = [
      { header: "Serial No.", width: 14 },
      { header: "QA Tech ID", width: 14 },
      { header: "Make", width: 12 },
      { header: "Model", width: 16 },
      { header: "Seen in", width: 80 },
    ];
    for (const [serial, e] of [...noId].sort(([a], [b]) => a.localeCompare(b))) {
      sheet.addRow([serial, "", e.make, e.model, [...e.files].join("; ")]);
    }
    sheet.getRow(1).font = { bold: true };
    await book.xlsx.writeFile(path.join(values.dir, "serials-without-id.xlsx"));
    log.unshift(summary, "");
    await writeFile(path.join(values.dir, "import-log.txt"), log.join("\n"));
    console.log(summary);
    console.log(`Details: ${path.join(values.dir, "import-log.txt")}`);
    if (noId.size) {
      console.log(
        `Fill in the QA Tech ID column of ${path.join(values.dir, "serials-without-id.xlsx")}, import it on Instruments → Import, then run this again.`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
