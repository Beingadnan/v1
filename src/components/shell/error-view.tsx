"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * What a person sees when a page fails on the server or in the browser. The
 * reference is the error's digest, which is also in the server log
 * (src/instrumentation.ts), so a support request can be matched to it.
 */
export function ErrorView({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section
      aria-labelledby="error-title"
      className="flex min-h-[60dvh] items-center justify-center bg-background px-4"
    >
      <div className="max-w-md" role="alert">
        <p className="text-sm font-medium text-muted-foreground">Something went wrong</p>
        <h1 id="error-title" className="mt-1 text-2xl font-semibold">
          This page couldn&apos;t be shown
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Nothing you saved before this is lost. Try again; if it keeps happening, send the
          reference below to your admin.
        </p>
        {error.digest ? <p className="mt-3 font-mono text-sm">Reference: {error.digest}</p> : null}
        <div className="mt-6 flex gap-2">
          <Button onClick={reset}>Try again</Button>
          <Button variant="secondary" asChild>
            <Link href="/">Go to home</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
