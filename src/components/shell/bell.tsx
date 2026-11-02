import { Bell } from "lucide-react";
import Link from "next/link";

/** The notification bell, with how many are unread. */
export function NotificationBell({ unread, href }: { unread: number; href: string }) {
  return (
    <Link
      href={href}
      className="relative inline-flex size-9 items-center justify-center rounded-md hover:bg-surface-muted"
      aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
    >
      <Bell className="size-5" aria-hidden="true" />
      {unread ? (
        <span className="absolute -top-0.5 -right-0.5 min-w-5 rounded-full bg-fail px-1 text-center text-[11px] leading-5 font-semibold text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
