"use client";

import { Check, Copy, MoreHorizontal, UserPlus } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useActionState, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form-controls";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  isClientRole,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  STAFF_ROLES,
  type Role,
} from "@/domain/auth/roles";
import type { ActionResult } from "@/lib/action-result";

import { changeRoleAction, inviteUserAction, passwordLinkAction, setActiveAction } from "./actions";

type LinkData = { link: string; name: string; expiresAt: string };

function FormError({ result }: { result: ActionResult<unknown> | undefined }) {
  if (!result || result.ok) return null;
  return (
    <p role="alert" className="rounded-md bg-fail-soft px-3 py-2 text-sm text-fail">
      {result.error}
    </p>
  );
}

/** Shows a one-time link with a copy button. The link is never shown again. */
export function LinkReady({ data, purpose }: { data: LinkData; purpose: "invite" | "password" }) {
  const [copied, setCopied] = useState(false);
  const expires = new Date(data.expiresAt).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        {purpose === "invite" ? "Invitation created for " : "New password link for "}
        <strong>{data.name}</strong>. Send them this link by WhatsApp or email. It works once and
        expires {expires}.
      </p>
      <div className="flex gap-2">
        <Input
          readOnly
          value={data.link}
          aria-label="One-time link"
          className="font-mono text-xs"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(data.link);
            setCopied(true);
          }}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        This link is shown only now. If it gets lost, create a new one; the old link stops working.
      </p>
    </div>
  );
}

function RoleSelect({ name, defaultValue }: { name: string; defaultValue?: Role }) {
  const [role, setRole] = useState<Role | undefined>(defaultValue);
  return (
    <>
      <input type="hidden" name={name} value={role ?? ""} />
      <Select value={role} onValueChange={(v) => setRole(v as Role)}>
        <SelectTrigger id={name} aria-describedby={`${name}-desc`}>
          <SelectValue placeholder="Choose a role" />
        </SelectTrigger>
        <SelectContent>
          {STAFF_ROLES.map((r) => (
            <SelectItem key={r} value={r}>
              {ROLE_LABELS[r]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {role ? (
        <p id={`${name}-desc`} className="text-xs text-muted-foreground">
          {ROLE_DESCRIPTIONS[role]}
        </p>
      ) : null}
    </>
  );
}

export function InviteUserButton() {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setFormKey((k) => k + 1);
      }}
    >
      <Button onClick={() => setOpen(true)}>
        <UserPlus aria-hidden="true" />
        Invite user
      </Button>
      <DialogContent>
        <InviteForm key={formKey} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const [result, action, pending] = useActionState(inviteUserAction, undefined);
  if (result?.ok) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Invitation ready</DialogTitle>
        </DialogHeader>
        <LinkReady data={result.data} purpose="invite" />
        <DialogFooter>
          <Button onClick={onDone}>Done</Button>
        </DialogFooter>
      </>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Invite a team member</DialogTitle>
        <DialogDescription>
          They get a one-time link to set their own password. Client users are added from the
          client&apos;s page under Clients.
        </DialogDescription>
      </DialogHeader>
      <Field id="name" label="Full name" required>
        <Input id="name" name="name" autoComplete="off" required />
      </Field>
      <Field id="email" label="Email" required>
        <Input id="email" name="email" type="email" autoComplete="off" required />
      </Field>
      <Field id="role" label="Role" required>
        <RoleSelect name="role" />
      </Field>
      <FormError result={result} />
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create invitation"}
        </Button>
      </DialogFooter>
    </form>
  );
}

type UserRow = { id: string; name: string; role: Role; status: string };

function ReasonField() {
  return (
    <Field id="reason" label="Reason" hint="Saved in the audit trail." required>
      <Textarea id="reason" name="reason" required aria-describedby="reason-desc" />
    </Field>
  );
}

function ChangeRoleForm({ user, onDone }: { user: UserRow; onDone: () => void }) {
  const [result, action, pending] = useActionState(changeRoleAction, undefined);
  if (result?.ok) return <Success message={result.message} onDone={onDone} />;
  return (
    <form action={action} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Change {user.name}&apos;s role</DialogTitle>
        <DialogDescription>
          They will be signed out and see the new role when they sign in again.
        </DialogDescription>
      </DialogHeader>
      <input type="hidden" name="userId" value={user.id} />
      <Field id="role" label="New role" required>
        <RoleSelect name="role" defaultValue={user.role} />
      </Field>
      <ReasonField />
      <FormError result={result} />
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          Change role
        </Button>
      </DialogFooter>
    </form>
  );
}

function SetActiveForm({ user, onDone }: { user: UserRow; onDone: () => void }) {
  const [result, action, pending] = useActionState(setActiveAction, undefined);
  const deactivating = user.status !== "deactivated";
  if (result?.ok) return <Success message={result.message} onDone={onDone} />;
  return (
    <form action={action} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>
          {deactivating ? `Deactivate ${user.name}?` : `Reactivate ${user.name}?`}
        </DialogTitle>
        <DialogDescription>
          {deactivating
            ? "They are signed out everywhere and can't sign in. Their history and signatures stay."
            : "They can sign in again with their existing password."}
        </DialogDescription>
      </DialogHeader>
      <input type="hidden" name="userId" value={user.id} />
      <input type="hidden" name="active" value={deactivating ? "false" : "true"} />
      <ReasonField />
      <FormError result={result} />
      <DialogFooter>
        <Button type="submit" variant={deactivating ? "danger" : "primary"} disabled={pending}>
          {deactivating ? "Deactivate" : "Reactivate"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function PasswordLinkForm({ user, onDone }: { user: UserRow; onDone: () => void }) {
  const [result, action, pending] = useActionState(passwordLinkAction, undefined);
  if (result?.ok) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Password link ready</DialogTitle>
        </DialogHeader>
        <LinkReady data={result.data} purpose="password" />
        <DialogFooter>
          <Button onClick={onDone}>Done</Button>
        </DialogFooter>
      </>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>New password link for {user.name}</DialogTitle>
        <DialogDescription>
          Use this when they forgot their password or are locked out. Any earlier link stops
          working.
        </DialogDescription>
      </DialogHeader>
      <input type="hidden" name="userId" value={user.id} />
      <input type="hidden" name="name" value={user.name} />
      <FormError result={result} />
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          Create link
        </Button>
      </DialogFooter>
    </form>
  );
}

function Success({ message, onDone }: { message?: string; onDone: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="rounded-md bg-pass-soft px-3 py-2 text-sm text-pass">
        {message ?? "Saved."}
      </p>
      <DialogFooter>
        <Button onClick={onDone}>Done</Button>
      </DialogFooter>
    </div>
  );
}

type DialogKind = "role" | "active" | "link";

export function UserRowActions({ user, isSelf }: { user: UserRow; isSelf: boolean }) {
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const close = () => setDialog(null);
  const forms: Record<DialogKind, ReactNode> = {
    role: <ChangeRoleForm user={user} onDone={close} />,
    active: <SetActiveForm user={user} onDone={close} />,
    link: <PasswordLinkForm user={user} onDone={close} />,
  };

  if (isSelf) return <span className="text-xs text-muted-foreground">You</span>;

  const itemClass =
    "flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-muted";
  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${user.name}`}>
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            className="z-50 min-w-48 rounded-md border border-border bg-surface p-1 shadow-lg"
          >
            {user.status !== "deactivated" ? (
              <>
                {isClientRole(user.role) ? null : (
                  <DropdownMenu.Item className={itemClass} onSelect={() => setDialog("role")}>
                    Change role
                  </DropdownMenu.Item>
                )}
                <DropdownMenu.Item className={itemClass} onSelect={() => setDialog("link")}>
                  {user.status === "invited" ? "New set-up link" : "New password link"}
                </DropdownMenu.Item>
              </>
            ) : null}
            <DropdownMenu.Item className={itemClass} onSelect={() => setDialog("active")}>
              {user.status === "deactivated" ? "Reactivate" : "Deactivate"}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <Dialog open={dialog !== null} onOpenChange={(open) => !open && close()}>
        <DialogContent>{dialog ? forms[dialog] : null}</DialogContent>
      </Dialog>
    </>
  );
}
