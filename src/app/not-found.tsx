import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found" };

/**
 * Shown inside the staff or client shell (which already has the page's
 * <main>) or on its own, so it is a plain section, not a second <main>.
 */
export default function NotFound() {
  return (
    <section
      aria-labelledby="not-found-title"
      className="flex min-h-[60dvh] items-center justify-center bg-background px-4"
    >
      <div className="max-w-md">
        <p className="text-sm font-medium text-muted-foreground">Error 404</p>
        <h1 id="not-found-title" className="mt-1 text-2xl font-semibold">
          This page doesn&apos;t exist
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The link may be old, or the record may have moved. Go back to your home screen and search
          for it there.
        </p>
        <Button asChild className="mt-6">
          <Link href="/">Go to home</Link>
        </Button>
      </div>
    </section>
  );
}
