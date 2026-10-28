import "server-only";

import { eq } from "drizzle-orm";

import type { Database } from "@/db/client-factory";
import { organisations, type Organisation } from "@/db/schema";
import { recordAudit } from "@/lib/audit";

/**
 * Create the organisation if it does not exist yet; safe to run repeatedly.
 * The audit row is written only when a row is actually created, in the same
 * transaction, so a re-run never adds duplicate history.
 */
export async function ensureOrganisation(
  db: Database,
  input: { slug: string; name: string },
): Promise<{ organisation: Organisation; created: boolean }> {
  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(organisations)
      .values(input)
      .onConflictDoNothing({ target: organisations.slug })
      .returning();

    if (inserted) {
      await recordAudit(tx, {
        organisationId: inserted.id,
        actor: { type: "system" },
        action: "organisation.created",
        entityType: "organisation",
        entityId: inserted.id,
        summary: `Organisation ${inserted.name} created`,
        after: { slug: inserted.slug, name: inserted.name },
      });
      return { organisation: inserted, created: true };
    }

    const [existing] = await tx
      .select()
      .from(organisations)
      .where(eq(organisations.slug, input.slug));
    if (!existing) throw new Error(`Organisation ${input.slug} conflicted but could not be read`);
    return { organisation: existing, created: false };
  });
}
