import "server-only";

import { and, eq } from "drizzle-orm";

import type { Database } from "@/db/client-factory";
import { organisationSettings, storedFiles } from "@/db/schema";
import type { SessionUser } from "@/domain/auth/session-service";
import type { BlobStore } from "@/lib/storage/blob-store";
import { storeFile } from "@/lib/storage/store-file";

import { attachIssuedPdf, certificateSignatures } from "./calibration-service";
import { renderFt05 } from "./ft05-pdf";
import { getCertificate } from "./queries";

async function storedBytes(db: Database, blobs: BlobStore, organisationId: string, fileId: string) {
  const [file] = await db
    .select()
    .from(storedFiles)
    .where(and(eq(storedFiles.id, fileId), eq(storedFiles.organisationId, organisationId)));
  return file ? { file, bytes: await blobs.get(file.storageKey) } : null;
}

/**
 * The PDF for a certificate.
 * - Outside-lab certificates: the PDF that was uploaded.
 * - QA Tech certificates being prepared: rendered fresh, marked DRAFT.
 * - Issued QA Tech certificates: rendered once at first download, stored, and
 *   that same file returned ever after, so a reprint is byte-for-byte the
 *   certificate that was issued.
 */
export async function certificatePdf(
  db: Database,
  blobs: BlobStore,
  actor: SessionUser,
  certificateId: string,
): Promise<{ bytes: Uint8Array; fileName: string } | null> {
  const cert = await getCertificate(db, actor, certificateId);
  if (!cert) return null;
  const fileName = `${cert.number.replace(/[\\/:*?"<>|]+/g, "-")}.pdf`;
  // A cancelled QA Tech certificate is re-rendered so it carries the CANCELLED mark.
  if (cert.fileId && !(cert.kind === "internal" && cert.status === "cancelled")) {
    const stored = await storedBytes(db, blobs, actor.organisationId, cert.fileId);
    if (stored) return { bytes: stored.bytes, fileName };
  }
  if (cert.kind !== "internal") return null;

  const [settings] = await db
    .select()
    .from(organisationSettings)
    .where(eq(organisationSettings.organisationId, actor.organisationId));
  if (!settings) return null;
  const letterhead = settings.letterheadFileId
    ? ((await storedBytes(db, blobs, actor.organisationId, settings.letterheadFileId))?.bytes ??
      null)
    : null;
  const signatures = await certificateSignatures(db, actor.organisationId, cert.id);
  const bytes = await renderFt05(cert, {
    organisation: settings,
    letterhead,
    signatures,
    watermark:
      cert.status === "issued" ? null : cert.status === "cancelled" ? "CANCELLED" : "DRAFT",
  });
  if (cert.status !== "issued")
    return { bytes, fileName: fileName.replace(/\.pdf$/, " (draft).pdf") };

  const stored = await storeFile(db, blobs, {
    organisationId: actor.organisationId,
    actor: { type: "user", userId: actor.id },
    fileName,
    bytes,
    maxBytes: 20 * 1024 * 1024,
  });
  if (!stored.ok) throw new Error(`Could not store the issued certificate: ${stored.message}`);
  const attached = await attachIssuedPdf(db, actor, cert.id, stored.file.id);
  if (attached !== stored.file.id) {
    const first = await storedBytes(db, blobs, actor.organisationId, attached);
    if (first) return { bytes: first.bytes, fileName };
  }
  return { bytes, fileName };
}
