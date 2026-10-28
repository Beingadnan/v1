"use client";

import { ChevronDown, KeyRound, LogOut } from "lucide-react";
import Link from "next/link";
import { DropdownMenu } from "radix-ui";
import { useRef } from "react";

import { ROLE_LABELS } from "@/domain/auth/roles";
import type { UserSummary } from "@/lib/auth/dal";

import { signOutAction } from "./sign-out-action";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function UserMenu({ user }: { user: UserSummary }) {
  const signOutForm = useRef<HTMLFormElement>(null);
  return (
    <>
      <form ref={signOutForm} action={signOutAction} className="hidden" />
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-muted"
          aria-label={`Account menu for ${user.name}`}
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">
            {initials(user.name)}
          </span>
          <span className="hidden min-w-0 sm:block">
            <span className="block truncate text-sm font-medium">{user.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {ROLE_LABELS[user.role]}
            </span>
          </span>
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="z-50 min-w-56 rounded-md border border-border bg-surface p-1 shadow-lg"
          >
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </div>
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item asChild>
              <Link
                href="/account"
                className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-muted"
              >
                <KeyRound className="size-4" aria-hidden="true" />
                Change password
              </Link>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              // The menu unmounts on select, so the form lives outside it and is submitted here.
              onSelect={() => signOutForm.current?.requestSubmit()}
              className="flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none data-[highlighted]:bg-surface-muted"
            >
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>
  );
}
