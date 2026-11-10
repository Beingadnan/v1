/** Notifications (phase 11): the vocabulary shared by the database checks, the services and the screens. */

export const NOTIFICATION_KINDS = [
  "report_to_check",
  "report_returned",
  "report_checked",
  "report_released",
  "report_client_returned",
  "report_client_signed",
  "wcr_to_accept",
  "wcr_accepted",
  "deviation_to_decide",
  "deviation_decided",
  "capa_assigned",
  "order_pending",
  "invoice_pending",
  "contract_expiring",
  "override_to_approve",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Sent by email at once; everything else waits for the daily digest. */
export const IMMEDIATE: readonly NotificationKind[] = [
  "report_returned",
  "report_released",
  "wcr_to_accept",
  "deviation_to_decide",
  "capa_assigned",
  "override_to_approve",
];

export const EMAIL_STATUSES = ["none", "pending", "sent", "skipped", "failed"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const CAPA_KINDS = ["corrective", "preventive"] as const;
export type CapaKind = (typeof CAPA_KINDS)[number];
export const CAPA_STATUSES = ["open", "done", "verified"] as const;
export type CapaStatus = (typeof CAPA_STATUSES)[number];
