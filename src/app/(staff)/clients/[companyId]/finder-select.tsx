"use client";

import { ChevronDown, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export type FinderOption = { label: string; href: string; group?: string };

/**
 * One step of the study finder: a select that opens the page for the
 * option picked. The URL holds the choice, so a step can be shared or
 * bookmarked, and Back undoes it.
 */
export function FinderSelect({
  label,
  icon,
  value,
  options,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  /** The href of the option shown as picked. */
  value: string;
  options: FinderOption[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const groups = [...new Set(options.map((o) => o.group ?? ""))];
  return (
    <div className="relative w-full">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : icon}
      </span>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => start(() => router.push(e.target.value, { scroll: false }))}
        className="h-11 w-full appearance-none rounded-lg border border-border bg-surface pr-10 pl-10 text-sm font-medium shadow-sm transition-colors hover:border-primary/60 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      >
        {groups.map((g) =>
          g ? (
            <optgroup key={g} label={g}>
              {options
                .filter((o) => o.group === g)
                .map((o) => (
                  <option key={o.href} value={o.href}>
                    {o.label}
                  </option>
                ))}
            </optgroup>
          ) : (
            options
              .filter((o) => !o.group)
              .map((o) => (
                <option key={o.href} value={o.href}>
                  {o.label}
                </option>
              ))
          ),
        )}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
    </div>
  );
}
