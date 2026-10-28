import { redirect } from "next/navigation";

import { getCurrentSession } from "@/lib/auth/dal";
import { safeNextPath } from "@/lib/safe-redirect";

import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? safeNextPath(params.next, "") : "";
  if (await getCurrentSession()) redirect(next || "/");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">Use the email your admin invited.</p>
      </div>
      {params.password === "set" ? (
        <p role="status" className="rounded-md bg-pass-soft px-3 py-2 text-sm text-pass">
          Password saved. Sign in with your new password.
        </p>
      ) : null}
      <LoginForm next={next || undefined} />
      <p className="text-xs text-muted-foreground">
        Forgot your password? Ask your admin for a reset link.
      </p>
    </div>
  );
}
