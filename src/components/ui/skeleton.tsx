import { cn } from "@/lib/utils";

/** A grey placeholder block while a page's data loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-surface-muted", className)} />;
}

/**
 * Shown the moment a link is clicked, while the server reads the page's data.
 * Without it the old page stayed on screen and the click seemed to do nothing.
 */
export function PageSkeleton({ rows = 6, tabs = 0 }: { rows?: number; tabs?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
      {tabs > 0 ? (
        <div className="flex gap-2 overflow-hidden">
          {Array.from({ length: tabs }, (_, i) => (
            <Skeleton key={i} className="h-9 w-24 shrink-0" />
          ))}
        </div>
      ) : null}
      <div className="flex flex-col gap-2 pt-2">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
