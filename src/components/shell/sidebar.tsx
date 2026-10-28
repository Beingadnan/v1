"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import type { Action } from "@/domain/auth/permissions";
import { cn } from "@/lib/utils";

import { isNavItemAvailable, navigationFor } from "./navigation";

type SidebarProps = {
  /** Permissions of the signed-in person; decided on the server. */
  allowed: readonly Action[];
  onNavigate?: () => void;
};

/** Sidebar contents; used both in the desktop rail and the mobile drawer. */
export function SidebarContent({ allowed, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const groups = navigationFor(allowed);

  return (
    <div className="flex h-full flex-col bg-brand scale-ticks text-white">
      <div className="flex h-16 items-center px-4">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex items-center rounded-md bg-white px-3 py-1.5"
        >
          <Image
            src="/brand/qatech-logo.png"
            alt="QA Tech"
            width={245}
            height={119}
            className="h-10 w-auto"
            priority
          />
        </Link>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-6">
        {groups.map((group) => (
          <div key={group.label} className="mt-5 first:mt-2">
            <p className="px-2 pb-1.5 text-xs font-medium text-white/60">{group.label}</p>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const available = isNavItemAvailable(item);
                const active =
                  item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

                if (!available) {
                  return (
                    <li key={item.href}>
                      <span
                        className="flex cursor-not-allowed items-center gap-3 rounded-md px-2 py-2 text-sm text-white/40"
                        title={`Arrives in build phase ${item.availableFromPhase}`}
                      >
                        <Icon className="size-4" aria-hidden="true" />
                        {item.label}
                        <span className="sr-only">(not available yet)</span>
                      </span>
                    </li>
                  );
                }

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-2 py-2 text-sm text-white/85 transition-colors hover:bg-white/10 hover:text-white",
                        active && "bg-white text-brand hover:bg-white hover:text-brand",
                      )}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}
