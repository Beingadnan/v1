import Link from "next/link";

import { Button } from "@/components/ui/button";
import { db } from "@/db/client";
import { lookupAccountToken } from "@/domain/auth/account-service";

import { SetPasswordForm } from "./set-password-form";

export const metadata = { title: "Set your password" };

export default async function SetPasswordPage({ searchParams }: PageProps<"/set-password">) {
  const { token } = await searchParams;
  const lookup = await lookupAccountToken(db, typeof token === "string" ? token : undefined);

  if (!lookup.ok) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Link not valid</h1>
        <p className="text-sm text-muted-foreground">{lookup.message}</p>
        <Button variant="secondary" asChild>
          <Link href="/login">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {lookup.purpose === "setup" ? `Welcome, ${lookup.name}` : "Choose a new password"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {lookup.purpose === "setup"
            ? `Set a password for ${lookup.email} to finish setting up your account.`
            : `Set a new password for ${lookup.email}. Other signed-in devices will be signed out.`}
        </p>
      </div>
      <SetPasswordForm token={token as string} email={lookup.email} />
    </div>
  );
}
