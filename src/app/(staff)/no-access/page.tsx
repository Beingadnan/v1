import { ShieldAlert } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth/dal";

export const metadata = { title: "No access" };

export default async function NoAccessPage() {
  await requireUser();
  return (
    <div className="mx-auto max-w-2xl">
      <EmptyState
        icon={ShieldAlert}
        headingLevel="h1"
        title="Your role doesn't include this page"
        description="If you need it for your work, ask an admin to change your role."
        action={
          <Button variant="secondary" asChild>
            <Link href="/">Go to home</Link>
          </Button>
        }
      />
    </div>
  );
}
