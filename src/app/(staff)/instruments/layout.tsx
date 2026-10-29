import type { ReactNode } from "react";

import { can } from "@/domain/auth/permissions";
import { requirePermission } from "@/lib/auth/dal";

import { InstrumentTabs } from "./instrument-tabs";

export default async function InstrumentsLayout({ children }: { children: ReactNode }) {
  const actor = await requirePermission("instruments.view");
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <InstrumentTabs canManage={can(actor, "instruments.manage")} />
      {children}
    </div>
  );
}
