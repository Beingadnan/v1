/**
 * Prepares the end-to-end test database: wipe, migrate, seed, and create
 * known users. Refuses any database whose name does not end in _test.
 * Run by Playwright's global setup; not for real databases.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDatabase, createPool } from "@/db/client-factory";
import { ensureOrganisation } from "@/db/seed/ensure-organisation";
import { ensureQatechDefaults } from "@/db/seed/qatech-defaults";
import { bootstrapAdmin, inviteUser, setPasswordWithToken } from "@/domain/auth/account-service";
import { toSessionUser } from "@/domain/auth/session-service";

export const E2E_USERS = {
  admin: { email: "admin@e2e.test", name: "Asha Admin", password: "calibrated sensor chain 1" },
  engineer: {
    email: "engineer@e2e.test",
    name: "Ravi Engineer",
    password: "logger placement walk 2",
  },
  lab: { email: "lab@e2e.test", name: "Lata Lab", password: "dry block at minus twenty 3" },
  lead: { email: "lead@e2e.test", name: "Tarun Lead", password: "checked twice at fifteen 4" },
  manager: {
    email: "manager@e2e.test",
    name: "Meera Manager",
    password: "approved and issued now 5",
  },
} as const;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith("_test")) {
    throw new Error(`Refusing to prepare "${dbName}" for e2e: name must end in _test.`);
  }

  const pool = createPool(url, 2);
  try {
    await pool.query(
      "drop schema if exists public cascade; drop schema if exists drizzle cascade;",
    );
    await pool.query("create schema public;");
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });

    const db = createDatabase(pool);
    const { organisation } = await ensureOrganisation(db, { slug: "qatech", name: "QA Tech" });
    await ensureQatechDefaults(db, organisation.id);

    const req = { userAgent: "e2e-prepare" };
    const boot = await bootstrapAdmin(db, {
      organisationId: organisation.id,
      name: E2E_USERS.admin.name,
      email: E2E_USERS.admin.email,
    });
    const set = await setPasswordWithToken(
      db,
      { token: boot.token, password: E2E_USERS.admin.password },
      req,
    );
    if (!set.ok) throw new Error(set.message);

    const { rows } = await pool.query("select * from users where email = $1", [
      E2E_USERS.admin.email,
    ]);
    const admin = toSessionUser({
      id: rows[0].id,
      organisationId: rows[0].organisation_id,
      email: rows[0].email,
      name: rows[0].name,
      role: rows[0].role,
      status: rows[0].status,
      clientCompanyId: rows[0].client_company_id,
    });
    if (!admin) throw new Error("Admin row invalid");

    const invite = await inviteUser(
      db,
      admin,
      { name: E2E_USERS.engineer.name, email: E2E_USERS.engineer.email, role: "field_engineer" },
      req,
    );
    const engineerSet = await setPasswordWithToken(
      db,
      { token: invite.token, password: E2E_USERS.engineer.password },
      req,
    );
    if (!engineerSet.ok) throw new Error(engineerSet.message);

    // Three different people for the calibration sign-off (done by → checked by → approved by).
    for (const [key, role] of [
      ["lab", "lab"],
      ["lead", "team_leader"],
      ["manager", "manager"],
    ] as const) {
      const u = E2E_USERS[key];
      const inv = await inviteUser(db, admin, { name: u.name, email: u.email, role }, req);
      const done = await setPasswordWithToken(db, { token: inv.token, password: u.password }, req);
      if (!done.ok) throw new Error(done.message);
    }
    console.log("e2e database ready");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
