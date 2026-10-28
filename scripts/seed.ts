/**
 * Seeds what the app needs to run: the QA Tech organisation, its settings and
 * its sites. Idempotent: running it again changes nothing an admin has edited.
 * Usage: npm run db:seed
 */
import { createDatabase, createPool } from "@/db/client-factory";
import { ensureOrganisation } from "@/db/seed/ensure-organisation";
import { ensureQatechDefaults } from "@/db/seed/qatech-defaults";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const pool = createPool(url, 1);
  try {
    const db = createDatabase(pool);
    const { organisation, created } = await ensureOrganisation(db, {
      slug: "qatech",
      name: "QA Tech (A Division of GMP Technical Solutions Pvt. Ltd.)",
    });
    await ensureQatechDefaults(db, organisation.id);
    console.log(
      `${created ? "Created" : "Already present"}: ${organisation.name} (${organisation.id})`,
    );
    console.log('Next: npm run user:create-admin -- --name "Your Name" --email you@example.com');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
