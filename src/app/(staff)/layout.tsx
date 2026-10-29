import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { SidebarContent } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { ACTIONS, can } from "@/domain/auth/permissions";
import { isClientRole } from "@/domain/auth/roles";
import { requireUser, toUserSummary } from "@/lib/auth/dal";

/**
 * Shell for every QA Tech staff screen. Signs out anyone without a valid
 * session. Each page and action still checks its own permission through the
 * data access layer; this layout only decides what the shell shows.
 */
export default async function StaffLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  // Client QA users have their own, much smaller area.
  if (isClientRole(user.role)) redirect("/client");
  const allowed = ACTIONS.filter((action) => can(user, action));

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 md:block">
        <SidebarContent allowed={allowed} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={toUserSummary(user)} allowed={allowed} />
        <main id="main" className="flex-1 px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
