/**
 * Seeds the minimum data the app needs to run: the QA Tech organisation.
 * Idempotent: running it again changes nothing.
 * Usage: DATABASE_URL=... npm run db:seed
 */
import { createDatabase, createPool } from "@/db/client-factory";
import { ensureOrganisation } from "@/db/seed/ensure-organisation";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const pool = createPool(url, 1);
  try {
    const { organisation, created } = await ensureOrganisation(createDatabase(pool), {
      slug: "qatech",
      name: "QA Tech (A Division of GMP Technical Solutions Pvt. Ltd.)",
    });
    console.log(
      `${created ? "Created" : "Already present"}: ${organisation.name} (${organisation.id})`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
