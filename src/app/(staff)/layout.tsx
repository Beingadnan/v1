import type { ReactNode } from "react";

import { SidebarContent } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";

/**
 * Shell for every QA Tech staff screen.
 * Phase 1 adds the server-side session check here (redirect to /login).
 */
export default function StaffLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 md:block">
        <SidebarContent />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="main" className="flex-1 px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
