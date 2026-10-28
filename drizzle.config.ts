import { defineConfig } from "drizzle-kit";

// Used only by drizzle-kit (generate / studio). The app reads DATABASE_URL via src/lib/env.ts.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
