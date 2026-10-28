import { ClipboardList } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ROLE_DESCRIPTIONS } from "@/domain/auth/roles";
import { requireUser } from "@/lib/auth/dal";

export default async function HomePage() {
  const user = await requireUser();
  const firstName = user.name.split(/\s+/)[0] ?? user.name;
  const showDevLinks = process.env.NODE_ENV !== "production";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <PageHeader title={`Hello, ${firstName}`} description={ROLE_DESCRIPTIONS[user.role]} />
      <EmptyState
        icon={ClipboardList}
        title="Nothing assigned to you yet"
        description="Jobs, studies and reports waiting on you will show here once job management is switched on."
        action={
          showDevLinks ? (
            <Button variant="secondary" asChild>
              <Link href="/dev/components">Open the component gallery</Link>
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}
