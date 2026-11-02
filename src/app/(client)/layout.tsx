import Image from "next/image";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { NotificationBell } from "@/components/shell/bell";
import { UserMenu } from "@/components/shell/user-menu";
import { db } from "@/db/client";
import { isClientRole } from "@/domain/auth/roles";
import { unreadCount } from "@/domain/notifications/notify";
import { requireUser, toUserSummary } from "@/lib/auth/dal";

/**
 * Shell for client QA users. Staff are sent to the staff screens; client users
 * never see the staff shell (see the staff layout).
 */
export default async function ClientLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  if (!isClientRole(user.role)) redirect("/");
  const unread = await unreadCount(db, user);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 items-center gap-3 border-b border-border bg-surface px-4 md:px-8">
        <Image
          src="/brand/qatech-logo.png"
          alt="QA Tech"
          width={245}
          height={119}
          className="h-9 w-auto"
          priority
        />
        <div className="ml-auto flex items-center gap-1">
          <NotificationBell unread={unread} href="/client/notifications" />
          <UserMenu user={toUserSummary(user)} />
        </div>
      </header>
      <main id="main" className="flex-1 px-4 py-6 md:px-8 md:py-8">
        {children}
      </main>
    </div>
  );
}
