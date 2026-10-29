import { FileCheck2, Plus, Search } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/form-controls";
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
import { can } from "@/domain/auth/permissions";
import { listCertificates } from "@/domain/instruments/queries";
import { requirePermission } from "@/lib/auth/dal";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

import { CERTIFICATE_STATUS, KIND_LABELS } from "../certificate-labels";

export const metadata = { title: "Calibration certificates" };

const VIEWS = [
  { key: "", label: "All" },
  { key: "todo", label: "To sign" },
  { key: "internal", label: "QA Tech" },
  { key: "external", label: "Outside labs" },
  { key: "imported", label: "Imported" },
] as const;

export default async function CertificatesPage({
  searchParams,
}: PageProps<"/instruments/certificates">) {
  const actor = await requirePermission("instruments.view");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const view = typeof params.view === "string" ? params.view : "";
  const rows = await listCertificates(db, actor, {
    q,
    kind: ["internal", "external", "imported"].includes(view) ? view : undefined,
  });
  const shown =
    view === "todo"
      ? rows.filter((r) => ["draft", "checking", "approving"].includes(r.status))
      : rows;
  const canCalibrate = can(actor, "calibration.perform");

  return (
    <>
      <PageHeader
        title="Calibration certificates"
        description="QA Tech's FT-05 certificates, outside-lab certificates of the masters, and imported records."
        action={
          canCalibrate ? (
            <Button asChild>
              <Link href="/instruments/certificates/new">
                <Plus aria-hidden="true" />
                New calibration
              </Link>
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Show" className="flex flex-wrap gap-1">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={`/instruments/certificates${v.key ? `?view=${v.key}` : ""}`}
              aria-current={view === v.key ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                view === v.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:border-primary",
              )}
            >
              {v.label}
            </Link>
          ))}
        </nav>
        <form role="search" className="flex max-w-sm flex-1 gap-2">
          {view ? <input type="hidden" name="view" value={view} /> : null}
          <label htmlFor="q" className="sr-only">
            Search certificates
          </label>
          <Input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Number, ULR or customer"
          />
          <Button type="submit" variant="secondary">
            <Search aria-hidden="true" />
            Search
          </Button>
        </form>
      </div>
      {shown.length === 0 ? (
        <EmptyState
          icon={FileCheck2}
          title={
            q
              ? `No certificate matches “${q}”`
              : view === "todo"
                ? "Nothing waiting"
                : "No certificates yet"
          }
          description={
            view === "todo"
              ? "No certificate is in draft, waiting for a check or for approval."
              : "Start a calibration, record a master's outside-lab certificate from its instrument page, or import the logger lists."
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Certificate</TableHead>
              <TableHead className="hidden md:table-cell">For</TableHead>
              <TableHead className="text-right">Instr.</TableHead>
              <TableHead>Calibrated</TableHead>
              <TableHead className="hidden sm:table-cell">Due</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <Link
                    href={`/instruments/certificates/${c.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {c.number}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {KIND_LABELS[c.kind] ?? c.kind}
                    {c.kind === "external" ? ` · ${c.labName}` : ""}
                  </p>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {c.title}
                  {c.customerName && c.kind === "internal" ? (
                    <p className="text-xs text-muted-foreground">{c.customerName}</p>
                  ) : null}
                </TableCell>
                <TableCell className="tabular text-right">{c.count}</TableCell>
                <TableCell className="tabular">{formatDate(c.calibratedOn)}</TableCell>
                <TableCell className="tabular hidden sm:table-cell">
                  {c.validUntil ? formatDate(c.validUntil) : "—"}
                </TableCell>
                <TableCell>
                  <StatusBadge tone={CERTIFICATE_STATUS[c.status]?.tone ?? "neutral"}>
                    {CERTIFICATE_STATUS[c.status]?.label ?? c.status}
                  </StatusBadge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
