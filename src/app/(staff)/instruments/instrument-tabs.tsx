"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { href: "/instruments", label: "Register", exact: true },
  { href: "/instruments/certificates", label: "Certificates" },
  { href: "/instruments/index", label: "Calibration Index" },
  { href: "/instruments/models", label: "Models" },
  { href: "/instruments/import", label: "Import" },
];

/** Section tabs for Instruments; a plain link list, so it works without JavaScript. */
export function InstrumentTabs({ canManage }: { canManage: boolean }) {
  const path = usePathname();
  const current = (t: (typeof TABS)[number]) =>
    t.exact
      ? path === t.href || /^\/instruments\/[0-9a-f-]{36}/.test(path)
      : path.startsWith(t.href);
  return (
    <nav aria-label="Instruments" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-border px-1">
        {TABS.filter((t) => canManage || t.href !== "/instruments/import").map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              aria-current={current(t) ? "page" : undefined}
              className={cn(
                "inline-block border-b-2 px-3 py-2 text-sm",
                current(t)
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
