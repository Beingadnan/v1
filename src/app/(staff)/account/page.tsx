import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/dal";

import { ChangePasswordForm } from "./change-password-form";

export const metadata = { title: "Change password" };

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <PageHeader
        title="Change password"
        description="You'll stay signed in on this device. Other devices are signed out."
      />
      <div className="rounded-lg border border-border bg-surface p-6">
        <ChangePasswordForm email={user.email} />
      </div>
    </div>
  );
}
