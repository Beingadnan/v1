"use client";

import "./globals.css";

import { ErrorView } from "@/components/shell/error-view";

/** Replaces the root layout when it fails itself, so it brings its own <html>. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <ErrorView error={error} reset={reset} />
      </body>
    </html>
  );
}
