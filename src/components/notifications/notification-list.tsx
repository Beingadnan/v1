import { Bell } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import type { Notification } from "@/db/schema";
import { cn } from "@/lib/utils";

import { NotificationControls } from "./notification-controls";

const when = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);

const EMAIL_NOTE: Record<string, string> = {
  sent: "emailed",
  skipped: "not emailed: email isn't set up yet",
  failed: "email failed, will retry",
  pending: "emailing…",
};

/** The person's notifications, newest first, unread marked; opening one marks it read. */
export function NotificationList({
  rows,
  unread,
  emailAlerts,
}: {
  rows: Notification[];
  unread: number;
  emailAlerts: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <NotificationControls unread={unread} emailAlerts={emailAlerts} />
      {rows.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="Nothing yet"
          description="When work is handed to you (a report to check, a WCR to accept, a deviation to decide), it shows here."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((n) => (
            <li key={n.id}>
              <a
                href={`/api/notifications/${n.id}`}
                className={cn(
                  "flex flex-col gap-0.5 rounded-lg border bg-surface p-3 hover:border-primary",
                  n.readAt ? "border-border" : "border-primary",
                )}
              >
                <span className="flex flex-wrap items-baseline gap-2">
                  {!n.readAt ? (
                    <span className="size-2 rounded-full bg-primary" aria-label="Unread" />
                  ) : null}
                  <strong className={cn(n.readAt && "font-normal")}>{n.title}</strong>
                  <span className="text-xs text-muted-foreground">{when(n.createdAt)}</span>
                </span>
                {n.body ? <span className="text-sm">{n.body}</span> : null}
                {EMAIL_NOTE[n.emailStatus] ? (
                  <span className="text-xs text-muted-foreground">{EMAIL_NOTE[n.emailStatus]}</span>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
