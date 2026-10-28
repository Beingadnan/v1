/**
 * Create the first admin, or print a fresh password link for an existing admin
 * who is locked out. Prints a one-time link; open it to set the password.
 *
 * Usage: npm run user:create-admin -- --name "Ashraf Khan" --email ashraf.khan@qatech.co.in
 */
import { parseArgs } from "node:util";

import { eq } from "drizzle-orm";

import { createDatabase, createPool } from "@/db/client-factory";
import { organisations } from "@/db/schema";
import { AccountError, bootstrapAdmin } from "@/domain/auth/account-service";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      email: { type: "string" },
      org: { type: "string", default: "qatech" },
    },
  });
  if (!values.name || !values.email) {
    throw new Error(
      'Usage: npm run user:create-admin -- --name "Full Name" --email you@example.com',
    );
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

  const pool = createPool(url, 1);
  try {
    const db = createDatabase(pool);
    const [org] = await db.select().from(organisations).where(eq(organisations.slug, values.org));
    if (!org) throw new Error(`Organisation "${values.org}" not found. Run npm run db:seed first.`);

    const result = await bootstrapAdmin(db, {
      organisationId: org.id,
      name: values.name,
      email: values.email,
    });
    console.log(result.created ? "Admin created." : "New password link for the existing admin.");
    console.log(`Open this link within 72 hours to set the password (it works once):`);
    console.log(`${appUrl}/set-password?token=${result.token}`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof AccountError || error instanceof Error ? error.message : error);
  process.exit(1);
});
