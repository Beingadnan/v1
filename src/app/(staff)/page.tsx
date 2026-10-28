import { ClipboardList } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export default function HomePage() {
  const showDevLinks = process.env.NODE_ENV !== "production";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <PageHeader
        title="Home"
        description="Your jobs, studies and reports waiting on you will show here."
      />
      <EmptyState
        icon={ClipboardList}
        title="Nothing assigned to you yet"
        description="Jobs arrive here once job management is switched on. Until then, this is the empty shell of the app."
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
