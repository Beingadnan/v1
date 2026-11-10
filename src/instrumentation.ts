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
