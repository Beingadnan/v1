import "server-only";

import { ZodError } from "zod";

import { AccountError } from "@/domain/auth/account-service";
import { ForbiddenError } from "@/domain/auth/permissions";
import { SettingsError } from "@/domain/admin/settings-service";

/** What a form's server action returns: a message for the person, or success data. */
export type ActionResult<T = void> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Turn expected failures (validation, business rules, permissions) into a
 * message for the form. Anything else is a bug: it is logged and re-thrown so
 * it shows as an error page, never silently swallowed.
 */
export async function runAction<T>(
  work: () => Promise<T>,
  message?: string,
): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await work(), message };
  } catch (error) {
    if (error instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of error.issues) {
        const key = issue.path.join(".");
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return { ok: false, error: error.issues[0]?.message ?? "Check the form.", fieldErrors };
    }
    if (error instanceof AccountError || error instanceof SettingsError) {
      return { ok: false, error: error.message };
    }
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "Your role doesn't allow this." };
    }
    console.error(
      JSON.stringify({
        level: "error",
        msg: "server action failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw error;
  }
}
