import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  /** What the person can do next. */
  description: string;
  /** Usually the one primary button that fills this screen. */
  action?: ReactNode;
  className?: string;
  /** "h1" when the empty state is the whole page (no other heading). */
  headingLevel?: "h1" | "h2";
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  headingLevel: Heading = "h2",
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-3 rounded-lg border border-dashed border-input bg-surface p-8",
        className,
      )}
    >
      <Icon className="size-6 text-primary" aria-hidden="true" />
      <div className="max-w-prose">
        <Heading className="text-base font-semibold">{title}</Heading>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
