import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/db/client";
import { listModels } from "@/domain/instruments/queries";
import { requirePermission } from "@/lib/auth/dal";
import { env } from "@/lib/env";

import { InstrumentImportFlow } from "./import-flow";

export const metadata = { title: "Import instruments" };

export default async function InstrumentImportPage() {
  const actor = await requirePermission("instruments.manage");
  const models = (await listModels(db, actor)).map((m) => ({
    id: m.id,
    label: `${m.make} ${m.model}`,
  }));
  return (
    <>
      <PageHeader
        title="Import instrument lists"
        description="Upload logger lists, serial lists or FT-05 certificate workbooks as they are. Nothing changes until you press Import."
      />
      <InstrumentImportFlow maxSizeMb={env.UPLOAD_MAX_MB} models={models} />
    </>
  );
}
