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
  /**
   * Max open connections per app instance. A page sends its reads together, up to about
   * 30 at once (a study tab with its study); fewer connections make the rest wait a round
   * trip (ADR 0018). Neon's pooled endpoint (-pooler) accepts thousands of clients.
   */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(30),
  /** Local file storage root, used when no Vercel Blob token is set. */
  STORAGE_LOCAL_DIR: z.string().min(1).default("./.data/storage"),
  /**
   * Vercel Blob read-write token (Vercel → Storage → your Blob store → .env.local tab).
   * When set, files are kept in that store (private) instead of on local disk (ADR 0019).
   */
  BLOB_READ_WRITE_TOKEN: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined),
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
  /**
   * Cashfree Verification Suite, for filling client details from a GSTIN.
   * Optional: without both keys the lookup is switched off and nothing else changes.
   * Keys come from merchant.cashfree.com → Verification Suite → Developers → API keys.
   */
  CASHFREE_CLIENT_ID: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined),
  CASHFREE_CLIENT_SECRET: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined),
  /** "sandbox" (test data only) or "production" (real lookups, charged). */
  CASHFREE_ENV: z.preprocess(
    (v) => v || undefined,
    z.enum(["sandbox", "production"]).default("sandbox"),
  ),
  /**
   * Only if your Cashfree account uses "Public Key" two-factor authentication
   * instead of IP whitelisting: the public key (PEM) from the dashboard.
   * Line breaks may be written as \n.
   */
  CASHFREE_PUBLIC_KEY: z
    .string()
    .optional()
    .transform((v) => (v ? v.replace(/\\n/g, "\n") : undefined)),
  /**
   * Email for alerts and the daily digest (phase 11), sent through Resend
   * (resend.com). Optional: without a key nothing is emailed, the in-app bell
   * still works, and each alert says email isn't set up.
   */
  RESEND_API_KEY: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined),
  /** The sender, on a domain verified with Resend, e.g. "QA Tech <alerts@qatech.co.in>". */
  MAIL_FROM: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined),
  /**
   * Reads the field engineer's layout sketch (photo) into positions (ADR 0021).
   * Optional: without a key the Layout tab has no "Read a sketch" button.
   */
  OPENAI_API_KEY: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined),
  /** The OpenAI model for sketches: a small, cheap one with vision. */
  OPENAI_SKETCH_MODEL: z.string().trim().min(1).default("gpt-5-mini"),
  /** The scheduler sends this as a bearer token to /api/cron/digest; unset turns the route off. */
  CRON_SECRET: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length >= 24 ? v : undefined)),
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
