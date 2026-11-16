import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/db/client";
import { getInstrument } from "@/domain/instruments/queries";
import { isUuid } from "@/domain/clients/shared";
import { certificateReader } from "@/lib/ai";
import { requirePermission } from "@/lib/auth/dal";
import { env } from "@/lib/env";

import { CertificateUploadFlow } from "./upload-flow";

export const metadata = { title: "Upload certificates" };

export default async function UploadCertificatesPage({
  searchParams,
}: PageProps<"/instruments/certificates/upload">) {
  const actor = await requirePermission("instruments.manage");
  const params = await searchParams;
  const from =
    typeof params.instrument === "string" && isUuid(params.instrument)
      ? await getInstrument(db, actor, params.instrument)
      : null;
  return (
    <>
      <PageHeader
        title="Upload certificates"
        description={
          from
            ? `Drop the scanned certificate of ${from.code}. It is read, matched to its certificate on record, and saved when you press Save.`
            : "Drop the scanned certificates, as many as you have. Each is read and matched to its instruments and its certificate on record; nothing changes until you press Save."
        }
      />
      <CertificateUploadFlow
        maxSizeMb={env.UPLOAD_MAX_MB}
        canRead={certificateReader !== null}
        defaultCode={from?.code}
      />
    </>
  );
}
