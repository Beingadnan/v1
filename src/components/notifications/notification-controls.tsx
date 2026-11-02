"use client";

import { CheckCheck } from "lucide-react";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { markAllReadAction, setEmailAlertsAction } from "@/app/notification-actions";

export function NotificationControls({
  unread,
  emailAlerts,
}: {
  unread: number;
  emailAlerts: boolean;
}) {
  const [busy, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="secondary"
        size="sm"
        disabled={busy || unread === 0}
        onClick={() => start(() => markAllReadAction())}
      >
        <CheckCheck aria-hidden="true" />
        Mark all read
      </Button>
      <label className="flex min-h-10 items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={emailAlerts}
          disabled={busy}
          onChange={(e) => {
            const on = e.target.checked;
            start(() => setEmailAlertsAction(on));
          }}
        />
        Email me alerts and a daily digest
      </label>
    </div>
  );
}
