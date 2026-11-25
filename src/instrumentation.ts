import type { Instrumentation } from "next";

/**
 * Runs once when a server process starts. In production it opens database
 * connections in the background, so the first person to open a page after a
 * deploy or restart doesn't wait for them (ADR 0018).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  const { warmPool } = await import("@/db/client");
  // Not awaited: the server starts answering at once; a page that comes first just
  // waits for the connections already on their way.
  warmPool().catch((error: unknown) =>
    console.error(
      JSON.stringify({
        level: "warn",
        msg: "could not open database connections at start",
        error: error instanceof Error ? error.message : String(error),
      }),
    ),
  );
}

/**
 * Every error thrown while rendering a page, running a server action or a route
 * handler, written as one JSON line to the host's log (Vercel → Logs). The digest
 * is the reference the error page shows the person. No headers or cookies are
 * logged.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const err = error as Error & { digest?: string };
  console.error(
    JSON.stringify({
      level: "error",
      msg: "request failed",
      digest: err.digest,
      name: err.name,
      // Database errors append the query's values ("params: …"), which can be personal data.
      error: err.message.split(/\bparams:/)[0]?.slice(0, 500),
      stack: err.stack?.split("\n").slice(0, 8).join("\n"),
      method: request.method,
      path: request.path.split("?")[0],
      routePath: context.routePath,
      routeType: context.routeType,
    }),
  );
};
