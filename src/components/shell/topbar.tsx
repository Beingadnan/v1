"use client";

import { Menu } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useState } from "react";

import type { Action } from "@/domain/auth/permissions";
import type { UserSummary } from "@/lib/auth/dal";

import { NotificationBell } from "./bell";
import { SearchPalette } from "./search-palette";
import { SidebarContent } from "./sidebar";
import { UserMenu } from "./user-menu";

export function Topbar({
  user,
  allowed,
  unread,
}: {
  user: UserSummary;
  allowed: readonly Action[];
  unread: number;
}) {
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

      <SearchPalette />
      <div className="ml-auto flex items-center gap-1">
        <NotificationBell unread={unread} href="/notifications" />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
