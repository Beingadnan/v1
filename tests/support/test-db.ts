import { createDatabase, createPool, type Database } from "@/db/client-factory";

/**
 * Integration tests run against a real Postgres named *_test.
 * The name check stops a mis-set variable from wiping a real database.
 */
export function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Example: postgresql://qtech:qtech_dev_password@localhost:5432/qtech_test",
    );
  }
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `Refusing to run integration tests against "${dbName}": name must end in _test`,
    );
  }
  return url;
}

export function openTestDatabase(): { db: Database; close: () => Promise<void> } {
  const pool = createPool(requireTestDatabaseUrl(), 5);
  return { db: createDatabase(pool), close: () => pool.end() };
}
