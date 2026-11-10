/**
 * Seeds one TEST job at every stage (created … closed) for the TEST client
 * "TEST Seed Pharma Pvt Ltd", so the app can be looked around. It signs as
 * the TEST staff listed in .data/TEST-ACCOUNTS.txt (git-ignored), and adds
 * the client's two TEST signatories to that file with a new password.
 *
 * Needs: those TEST users, and loggers and masters in the register with
 * certificates covering August–September 2026 (PDL-12/13/14, TL-65, TL-38).
 * Runs once; a second run stops without changing anything.
 *
 * Usage: npm run db:seed-demo
 */
import { randomBytes } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";

import { and, eq } from "drizzle-orm";

import { createDatabase, createPool } from "@/db/client-factory";
import { organisations, users } from "@/db/schema";
import { seedDemoJobs, type DemoStaff } from "@/db/seed/demo-jobs";
import { toSessionUser } from "@/domain/auth/session-service";
import { LocalBlobStore } from "@/lib/storage/blob-store";

const ACCOUNTS = ".data/TEST-ACCOUNTS.txt";
const STAFF: Record<keyof DemoStaff, string> = {
  manager: "test.manager@qtech-demo.example.com",
  lead: "test.lead@qtech-demo.example.com",
  engineer: "test.engineer@qtech-demo.example.com",
  lab: "test.lab@qtech-demo.example.com",
  preparer: "test.preparer@qtech-demo.example.com",
  accounts: "test.accounts@qtech-demo.example.com",
};

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const text = readFileSync(ACCOUNTS, "utf8");
  const passwordOf = (email: string) => {
    const line = text.split("\n").find((l) => l.includes(email));
    const pw = line?.slice(line.indexOf(email) + email.length).trim();
    if (!pw) throw new Error(`${email} isn't in ${ACCOUNTS}.`);
    return pw;
  };
  const pool = createPool(url, 2);
  try {
    const db = createDatabase(pool);
    const [org] = await db
      .select({ id: organisations.id })
      .from(organisations)
      .where(eq(organisations.slug, "qatech"));
    if (!org) throw new Error("The QA Tech organisation isn't seeded (npm run db:seed).");
    const staff = {} as DemoStaff;
    for (const [key, email] of Object.entries(STAFF) as [keyof DemoStaff, string][]) {
      const [row] = await db
        .select()
        .from(users)
        .where(and(eq(users.organisationId, org.id), eq(users.email, email)));
      if (!row) throw new Error(`TEST user ${email} doesn't exist.`);
      staff[key] = { user: toSessionUser(row)!, password: passwordOf(email) };
    }
    const clientPassword = `seed ${randomBytes(4).toString("hex")} client signs`;
    const blobs = new LocalBlobStore(process.env.STORAGE_LOCAL_DIR ?? "./.data/storage");
    await seedDemoJobs(db, blobs, staff, clientPassword, (line) => console.log(line));
    appendFileSync(
      ACCOUNTS,
      `\nAdded by npm run db:seed-demo (client TEST Seed Pharma Pvt Ltd):\n` +
        `TEST Seed Priya (client QA)       client QA        test.seed.clientqa@qtech-demo.example.com     ${clientPassword}\n` +
        `TEST Seed Sunil (client QA head)  client QA head   test.seed.clienthead@qtech-demo.example.com   ${clientPassword}\n`,
    );
    console.log(`Done. The client's two sign-ins were added to ${ACCOUNTS}.`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
