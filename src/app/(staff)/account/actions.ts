"use server";

import { z } from "zod";

import { db } from "@/db/client";
import { changeOwnPassword } from "@/domain/auth/account-service";
import { requireUser } from "@/lib/auth/dal";
import { getRequestInfo } from "@/lib/request-info";

export type ChangePasswordState = { error?: string; done?: boolean } | undefined;

const schema = z
  .object({
    current: z.string().min(1, "Enter your current password.").max(256),
    password: z.string().max(256),
    confirm: z.string().max(256),
  })
  .refine((v) => v.password === v.confirm, { message: "The two new passwords don't match." });

export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const user = await requireUser();
  const parsed = schema.safeParse({
    current: formData.get("current"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const result = await changeOwnPassword(
    db,
    user,
    { currentPassword: parsed.data.current, newPassword: parsed.data.password },
    await getRequestInfo(),
  );
  return result.ok ? { done: true } : { error: result.message };
}
