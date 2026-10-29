import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/dal";
import { env } from "@/lib/env";

import { InstrumentImportFlow } from "./import-flow";

export const metadata = { title: "Import instruments" };

export default async function InstrumentImportPage() {
  await requirePermission("instruments.manage");
  return (
    <>
      <PageHeader
        title="Import instrument lists"
        description="Upload a site logger list as it is (ID No., Serial No., Certificate No., Calibration Date, Due Date…). Columns are found by their headings, in any order. Nothing changes until you press Import."
      />
      <InstrumentImportFlow maxSizeMb={env.UPLOAD_MAX_MB} />
    </>
  );
}
