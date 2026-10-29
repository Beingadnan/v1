import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/db/client";
import { listUsers } from "@/domain/admin/queries";
import { can } from "@/domain/auth/permissions";
import { isRole, ROLE_LABELS } from "@/domain/auth/roles";
import { requirePermission } from "@/lib/auth/dal";
import { formatDateTime, formatTime } from "@/lib/format";

import { InviteUserButton, UserRowActions } from "./user-dialogs";

export const metadata = { title: "Users" };

function UserStatus({ status, lockedUntil }: { status: string; lockedUntil: Date | null }) {
  if (status === "active" && lockedUntil && lockedUntil > new Date()) {
    return <StatusBadge tone="attention">Locked until {formatTime(lockedUntil)}</StatusBadge>;
  }
  if (status === "active") return <StatusBadge tone="pass">Active</StatusBadge>;
  if (status === "invited") return <StatusBadge tone="info">Invited</StatusBadge>;
  return <StatusBadge tone="neutral">Deactivated</StatusBadge>;
}

export default async function UsersPage() {
  const actor = await requirePermission("users.view");
  const canManage = can(actor, "users.manage");
  const users = await listUsers(db, actor);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Users"
        description="Everyone who can sign in to QTech. People are deactivated, never deleted, so their history stays."
        action={canManage ? <InviteUserButton /> : undefined}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last sign-in</TableHead>
            {canManage ? <TableHead className="w-16 text-right">Actions</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => {
            const role = isRole(user.role) ? user.role : null;
            return (
              <TableRow key={user.id}>
                <TableCell>
                  <p className="font-medium">{user.name}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </TableCell>
                <TableCell>
                  {role ? ROLE_LABELS[role] : user.role}
                  {user.clientCompanyName ? (
                    <p className="text-xs text-muted-foreground">{user.clientCompanyName}</p>
                  ) : null}
                </TableCell>
                <TableCell>
                  <UserStatus status={user.status} lockedUntil={user.lockedUntil} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDateTime(user.lastLoginAt)}
                </TableCell>
                {canManage && role ? (
                  <TableCell className="text-right">
                    <UserRowActions
                      user={{ id: user.id, name: user.name, role, status: user.status }}
                      isSelf={user.id === actor.id}
                    />
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
