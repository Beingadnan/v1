import { ChevronRight } from "lucide-react";
import Link from "next/link";

/**
 * Where the client page's study finder is (QA Tech's design, Nov 2026):
 * Region → Site → Year / month → Department → Equipment, each optional.
 */
export type FinderPlace = {
  /** The site's state; "none" for sites without one. */
  region?: string;
  site?: string;
  /** "2026" or "2026-04". */
  ym?: string;
  dept?: string;
  eq?: string;
  /** What the last step shows: the studies (default) or the equipment. */
  view?: "equipment";
  all?: boolean;
};

export function finderHref(companyId: string, p: FinderPlace): string {
  const q = new URLSearchParams();
  for (const k of ["region", "site", "ym", "dept", "eq", "view"] as const) {
    if (p[k]) q.set(k, p[k]!);
  }
  if (p.all) q.set("all", "1");
  const s = q.toString();
  return `/clients/${companyId}${s ? `?${s}` : ""}`;
}

export function Trail({ parts }: { parts: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-muted-foreground">
        {parts.map((p, i) => (
          <li key={i} className="flex min-w-0 items-center gap-1">
            {i > 0 ? <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" /> : null}
            {p.href ? (
              <Link
                href={p.href}
                className="truncate rounded px-1 hover:bg-primary/10 hover:text-primary"
              >
                {p.label}
              </Link>
            ) : (
              <span className="truncate px-1 font-medium text-foreground" aria-current="page">
                {p.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
