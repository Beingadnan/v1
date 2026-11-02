import { eq } from "drizzle-orm";

import { NotificationList } from "@/components/notifications/notification-list";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { myNotifications } from "@/domain/notifications/notify";
import { requireUser } from "@/lib/auth/dal";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requireUser();
  const { rows, unread } = await myNotifications(db, user, 100);
  const [me] = await db
    .select({ email: users.emailAlerts })
    .from(users)
    .where(eq(users.id, user.id));
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Notifications" description="Work handed to you, newest first." />
      <NotificationList rows={rows} unread={unread} emailAlerts={me?.email ?? true} />
    </div>
  );
}
