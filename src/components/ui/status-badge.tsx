import { AlertTriangle, CheckCircle2, Circle, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type StatusTone = "pass" | "attention" | "fail" | "info" | "neutral";

const toneStyles: Record<StatusTone, string> = {
  pass: "bg-pass-soft text-pass",
  attention: "bg-attention-soft text-attention",
  fail: "bg-fail-soft text-fail",
  info: "bg-info-soft text-info",
  neutral: "bg-surface-muted text-muted-foreground",
};

// Every tone also has its own icon, so status never depends on colour alone.
const toneIcons: Record<StatusTone, typeof Circle> = {
  pass: CheckCircle2,
  attention: AlertTriangle,
  fail: XCircle,
  info: Info,
  neutral: Circle,
};

type StatusBadgeProps = {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
};

export function StatusBadge({ tone, children, className }: StatusBadgeProps) {
  const Icon = toneIcons[tone];
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        toneStyles[tone],
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {children}
    </span>
  );
}
