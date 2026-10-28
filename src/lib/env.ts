import "server-only";
import { z } from "zod";

/**
 * Server-side environment variables, validated once at startup.
 * The app refuses to start with a missing or malformed value instead of
 * failing later in the middle of a request.
 *
 * Never import this from a client component ("server-only" enforces that).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z
    .string()
    .url()
    .refine((v) => v.startsWith("postgres://") || v.startsWith("postgresql://"), {
      message: "DATABASE_URL must be a postgres:// connection string",
    }),
  /** Max open connections per app instance. Keep low for Neon's pooled endpoint. */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  /** Local file storage root (development / single-server). Cloud storage driver comes later. */
  STORAGE_LOCAL_DIR: z.string().min(1).default("./.data/storage"),
  /** Hard upload limit in megabytes; logger exports are small, certificate scans can be larger. */
  UPLOAD_MAX_MB: z.coerce.number().int().min(1).max(200).default(50),
  /**
   * The address people use to open the app. Used for links (invites, resets)
   * and to decide cookie security: https → Secure, __Host- prefixed cookie.
   */
  APP_URL: z
    .string()
    .url()
    .default("http://localhost:3000")
    .transform((v) => v.replace(/\/$/, "")),
  /**
   * Set to "true" only when the app runs behind a reverse proxy that sets
   * X-Forwarded-For (Railway, Render, nginx). Otherwise that header is ignored,
   * because a client could forge it to dodge sign-in throttling.
   */
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return parsed.data;
}

export const env = loadEnv();
