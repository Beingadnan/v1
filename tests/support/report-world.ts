/**
 * BE-WF-02 seeded, analysed and approved, the logger certificate's PDF
 * attached and Rev 00 drafted, with a preparer, the client's QA and QA head,
 * and a QA head of another company (phases 9 and 10).
 */
import { and, eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";

import type { Database } from "@/db/client-factory";
import { certificates, users } from "@/db/schema";
import { approveAnalysis, runAnalysis } from "@/domain/analysis/analysis-service";
import { hashPassword } from "@/domain/auth/password";
import { toSessionUser, type SessionUser } from "@/domain/auth/session-service";
import { createCompany } from "@/domain/clients/company-service";
import { attachCertificateFile } from "@/domain/instruments/certificate-service";
import { createReport } from "@/domain/reports/report-service";
import type { BlobStore } from "@/lib/storage/blob-store";
import { storeFile } from "@/lib/storage/store-file";

import { BE_WF_02_PASSWORD, seedBeWf02 } from "./be-wf-02";

const req = { ipAddress: "203.0.113.99" };

export type World = {
  lead: SessionUser;
  manager: SessionUser;
  preparer: SessionUser;
  qa: SessionUser;
  head: SessionUser;
  stranger: SessionUser;
  studyId: string;
  jobId: string;
  blobs: BlobStore;
};

/** BE-WF-02 seeded, analysed and approved, the logger certificate's PDF attached, Rev 00 drafted. */
export async function reportWorld(
  db: Database,
  slug: string,
): Promise<World & { reportId: string }> {
  const seeded = await seedBeWf02(db, slug);
  const { lead, manager, studyId, jobId, companyId, blobs } = seeded;
  const passwordHash = await hashPassword(BE_WF_02_PASSWORD, { N: 1024, r: 8, p: 1 });
  const make = async (email: string, role: string, name: string, clientCompanyId?: string) => {
    const [row] = await db
      .insert(users)
      .values({
        organisationId: lead.organisationId,
        email,
        name,
        role,
        status: "active",
        passwordHash,
        clientCompanyId: clientCompanyId ?? null,
      })
      .returning();
    return toSessionUser(row!)!;
  };
  const preparer = await make(`rp@${slug}.test`, "report_preparer", "Mangesh Phalskar");
  const qa = await make(`qa@${slug}.test`, "client_qa", "Priya Nair", companyId);
  const head = await make(`head@${slug}.test`, "client_qa_head", "Sunil Deshmukh", companyId);
  const other = await createCompany(
    db,
    manager,
    {
      name: `Other Pharma ${slug}`,
      code: "Other",
      gstin: "",
      address: "",
      notes: "",
      postCalRequired: false,
      requalificationMonths: 12,
      reportNumberFormat: "{CLIENT}/{EQUIPMENT_ID}",
    },
    req,
  );
  const stranger = await make(`qa@other-${slug}.test`, "client_qa_head", "Other QA", other.id);

  const run = await runAnalysis(db, preparer, studyId, req);
  await approveAnalysis(db, lead, studyId, run.runId, req);
  const cert = await PDFDocument.create();
  cert.addPage([595.28, 841.89]).drawText("PDL-77 certificate (test)");
  const stored = await storeFile(db, blobs, {
    organisationId: lead.organisationId,
    actor: { type: "user", userId: lead.id },
    fileName: "PDL-77.pdf",
    bytes: await cert.save(),
    maxBytes: 10 * 1024 * 1024,
  });
  if (!stored.ok) throw new Error(stored.message);
  const [pdl77] = await db
    .select({ id: certificates.id })
    .from(certificates)
    .where(
      and(
        eq(certificates.number, "QATECH/BHIWANDI/04/26/PDL-77"),
        eq(certificates.organisationId, lead.organisationId),
      ),
    );
  await attachCertificateFile(db, lead, { certificateId: pdl77!.id, fileId: stored.file.id }, req);
  const reportId = (await createReport(db, preparer, studyId, req)).id;
  return {
    lead,
    manager,
    preparer,
    qa,
    head,
    stranger,
    studyId,
    jobId,
    blobs,
    reportId,
  };
}
