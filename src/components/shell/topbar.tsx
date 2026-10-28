"use client";

import { Menu, Search } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useState } from "react";

import type { Action } from "@/domain/auth/permissions";
import type { UserSummary } from "@/lib/auth/dal";

import { SidebarContent } from "./sidebar";
import { UserMenu } from "./user-menu";

export function Topbar({ user, allowed }: { user: UserSummary; allowed: readonly Action[] }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur md:px-8">
      <DialogPrimitive.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogPrimitive.Trigger
          className="inline-flex size-9 items-center justify-center rounded-md text-foreground hover:bg-surface-muted md:hidden"
          aria-label="Open menu"
        >
          <Menu className="size-5" aria-hidden="true" />
        </DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-foreground/40 md:hidden" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-72 md:hidden">
            <DialogPrimitive.Title className="sr-only">Menu</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Main navigation
            </DialogPrimitive.Description>
            <SidebarContent allowed={allowed} onNavigate={() => setMenuOpen(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {/* Search arrives with the records it searches (phase 11). Shown now so the layout is final. */}
      <div className="flex h-9 max-w-md flex-1 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground">
        <Search className="size-4" aria-hidden="true" />
        <span className="truncate">Search jobs, reports, serials…</span>
        <kbd className="ml-auto hidden rounded border border-border bg-surface px-1.5 text-xs sm:inline">
          Ctrl K
        </kbd>
      </div>
      <div className="ml-auto">
        <UserMenu user={user} />
      </div>
    </header>
  );
}
