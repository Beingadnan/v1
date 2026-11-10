"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db/client";
import { setPasswordWithToken } from "@/domain/auth/account-service";
import { login } from "@/domain/auth/login-service";
import { setSessionCookie } from "@/lib/auth/session-cookie";
import { forgetSessions } from "@/lib/auth/session-cache";
import { getRequestInfo } from "@/lib/request-info";
import { safeNextPath } from "@/lib/safe-redirect";

export type FormState = { error?: string; email?: string } | undefined;

const loginSchema = z.object({
  email: z.string().trim().min(1, "Enter your email address.").max(254),
  password: z.string().min(1, "Enter your password.").max(256),
  next: z.string().optional(),
});

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  const email = typeof formData.get("email") === "string" ? String(formData.get("email")) : "";
  if (!parsed.success) return { error: parsed.error.issues[0]?.message, email };

  const result = await login(db, {
    email: parsed.data.email,
    password: parsed.data.password,
    request: await getRequestInfo(),
  });
  if (!result.ok) return { error: result.message, email };

  await setSessionCookie(result.token, result.expiresAt);
  redirect(safeNextPath(parsed.data.next));
}

const setPasswordSchema = z
  .object({
    token: z.string().min(1),
    password: z.string().max(256),
    confirm: z.string().max(256),
  })
  .refine((v) => v.password === v.confirm, {
    message: "The two passwords don't match.",
    path: ["confirm"],
  });

export async function setPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = setPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const result = await setPasswordWithToken(
    db,
    { token: parsed.data.token, password: parsed.data.password },
    await getRequestInfo(),
  );
  if (!result.ok) return { error: result.message };
  forgetSessions();
  redirect("/login?password=set");
}
