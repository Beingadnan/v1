import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form-controls";
import { PageHeader } from "@/components/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/db/client";
import { auditFilterSchema, listAuditActors, listAuditEvents } from "@/domain/admin/queries";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Audit trail" };

/** "user.role_changed" → "User role changed" */
function actionLabel(action: string): string {
  const text = action.replace(/[._]/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const selectClass =
  "h-9 w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground";

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const actor = await requirePermission("audit.view");
  const raw = await searchParams;
  const filters = auditFilterSchema.parse({
    action: typeof raw.action === "string" && raw.action ? raw.action : undefined,
    userId: typeof raw.userId === "string" && raw.userId ? raw.userId : undefined,
    from: typeof raw.from === "string" && raw.from ? raw.from : undefined,
    to: typeof raw.to === "string" && raw.to ? raw.to : undefined,
    before: typeof raw.before === "string" ? raw.before : undefined,
  });
  const [{ events, nextBefore }, actors] = await Promise.all([
    listAuditEvents(db, actor, filters),
    listAuditActors(db, actor),
  ]);

  const olderParams = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, before: nextBefore })) {
    if (value) olderParams.set(key, String(value));
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Audit trail"
        description="Every important action, who did it and when. Entries can't be edited or deleted."
      />

      {/* A plain GET form: filters live in the URL, so a filtered view can be bookmarked or shared. */}
      <form className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="action">Action</Label>
          <select
            id="action"
            name="action"
            defaultValue={filters.action ?? ""}
            className={selectClass}
          >
            <option value="">All actions</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {actionLabel(a)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="userId">Person</Label>
          <select
            id="userId"
            name="userId"
            defaultValue={filters.userId ?? ""}
            className={selectClass}
          >
            <option value="">Everyone</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="from">From</Label>
          <Input id="from" name="from" type="date" defaultValue={filters.from} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="to">To</Label>
          <Input id="to" name="to" type="date" defaultValue={filters.to} />
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit">Filter</Button>
          <Button variant="ghost" asChild>
            <Link href="/audit">Clear</Link>
          </Button>
        </div>
      </form>

      {events.length === 0 ? (
        <p className="rounded-lg border border-dashed border-input bg-surface p-8 text-sm text-muted-foreground">
          No entries match these filters.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">When (IST)</TableHead>
              <TableHead className="w-40">Who</TableHead>
              <TableHead>What happened</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((e) => (
              <TableRow key={e.id} className="align-top">
                <TableCell className="tabular text-muted-foreground">
                  {formatDateTime(e.occurredAt)}
                </TableCell>
                <TableCell>{e.actorName ?? (e.actorType === "system" ? "System" : "—")}</TableCell>
                <TableCell>
                  <p className="text-xs font-medium text-muted-foreground">
                    {actionLabel(e.action)}
                  </p>
                  <p>{e.summary}</p>
                  {e.reason ? (
                    <p className="mt-1 text-sm">
                      <span className="text-muted-foreground">Reason:</span> {e.reason}
                    </p>
                  ) : null}
                  {e.before || e.after || e.ipAddress ? (
                    <details className="mt-1.5 text-xs">
                      <summary className="cursor-pointer text-primary">Details</summary>
                      <dl className="mt-2 grid gap-1 text-muted-foreground">
                        {e.before ? (
                          <div>
                            <dt className="font-medium">Before</dt>
                            <dd className="font-mono break-all">{JSON.stringify(e.before)}</dd>
                          </div>
                        ) : null}
                        {e.after ? (
                          <div>
                            <dt className="font-medium">After</dt>
                            <dd className="font-mono break-all">{JSON.stringify(e.after)}</dd>
                          </div>
                        ) : null}
                        <div>
                          <dt className="font-medium">Record</dt>
                          <dd className="font-mono">
                            {e.entityType} {e.entityId}
                            {e.ipAddress ? ` · from ${e.ipAddress}` : ""}
                          </dd>
                        </div>
                      </dl>
                    </details>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {nextBefore ? (
        <div>
          <Button variant="secondary" asChild>
            <Link href={`/audit?${olderParams.toString()}`}>Show older entries</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
