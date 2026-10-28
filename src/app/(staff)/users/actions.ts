"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db/client";
import {
  changeRole,
  inviteUser,
  issuePasswordLink,
  setUserActive,
} from "@/domain/auth/account-service";
import { runAction, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/dal";
import { env } from "@/lib/env";
import { getRequestInfo } from "@/lib/request-info";

type LinkResult = ActionResult<{ link: string; name: string; expiresAt: string }>;

function linkFor(token: string): string {
  return `${env.APP_URL}/set-password?token=${token}`;
}

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

export async function inviteUserAction(_prev: unknown, formData: FormData): Promise<LinkResult> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    const { user, token, expiresAt } = await inviteUser(
      db,
      actor,
      {
        name: field(formData, "name"),
        email: field(formData, "email"),
        role: field(formData, "role"),
      },
      await getRequestInfo(),
    );
    return { link: linkFor(token), name: user.name, expiresAt: expiresAt.toISOString() };
  });
  if (result.ok) revalidatePath("/users");
  return result;
}

export async function passwordLinkAction(_prev: unknown, formData: FormData): Promise<LinkResult> {
  const actor = await requireUser();
  return runAction(async () => {
    const { token, expiresAt } = await issuePasswordLink(
      db,
      actor,
      field(formData, "userId"),
      await getRequestInfo(),
    );
    return {
      link: linkFor(token),
      name: field(formData, "name"),
      expiresAt: expiresAt.toISOString(),
    };
  });
}

export async function changeRoleAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await requireUser();
  const result = await runAction(
    async () =>
      changeRole(
        db,
        actor,
        {
          userId: field(formData, "userId"),
          role: field(formData, "role"),
          reason: field(formData, "reason"),
        },
        await getRequestInfo(),
      ),
    "Role changed. They have been signed out and will see the new role next time.",
  );
  if (result.ok) revalidatePath("/users");
  return result;
}

export async function setActiveAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await requireUser();
  const active = field(formData, "active") === "true";
  const result = await runAction(
    async () =>
      setUserActive(
        db,
        actor,
        { userId: field(formData, "userId"), active, reason: field(formData, "reason") },
        await getRequestInfo(),
      ),
    active ? "User reactivated." : "User deactivated and signed out everywhere.",
  );
  if (result.ok) revalidatePath("/users");
  return result;
}
