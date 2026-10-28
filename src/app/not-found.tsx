import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md">
        <p className="text-sm font-medium text-muted-foreground">Error 404</p>
        <h1 className="mt-1 text-2xl font-semibold">This page doesn&apos;t exist</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The link may be old, or the record may have moved. Go back to your home screen and search
          for it there.
        </p>
        <Button asChild className="mt-6">
          <Link href="/">Go to home</Link>
        </Button>
      </div>
    </main>
  );
}
