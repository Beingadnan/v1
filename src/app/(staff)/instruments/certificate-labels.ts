import type { StatusTone } from "@/components/ui/status-badge";

export const CERTIFICATE_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  checking: { label: "Waiting for check", tone: "attention" },
  approving: { label: "Waiting for approval", tone: "attention" },
  issued: { label: "Issued", tone: "pass" },
  cancelled: { label: "Cancelled", tone: "fail" },
};

export const KIND_LABELS: Record<string, string> = {
  internal: "QA Tech calibration",
  external: "Outside laboratory",
  imported: "Imported record",
};
