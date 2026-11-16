import { FileCheck2, FileUp, Plus, Search } from "lucide-react";
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
import {
  CERTIFICATE_PAGE,
  countMissingScans,
  listCertificates,
} from "@/domain/instruments/queries";
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
  { key: "noscan", label: "No scan" },
] as const;

export default async function CertificatesPage({
  searchParams,
}: PageProps<"/instruments/certificates">) {
  const actor = await requirePermission("instruments.view");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const view = typeof params.view === "string" ? params.view : "";
  const page = Math.max(1, Math.min(1000, Number(params.page) || 1));
  const [found, missing] = await Promise.all([
    listCertificates(db, actor, {
      q,
      kind: ["internal", "external", "imported"].includes(view) ? view : undefined,
      missingScan: view === "noscan",
      page: view === "todo" ? 1 : page,
    }),
    countMissingScans(db, actor),
  ]);
  const more = found.length > CERTIFICATE_PAGE;
  const rows = found.slice(0, CERTIFICATE_PAGE);
  const shown =
    view === "todo"
      ? rows.filter((r) => ["draft", "checking", "approving"].includes(r.status))
      : rows;
  const canCalibrate = can(actor, "calibration.perform");
  const canUpload = can(actor, "instruments.manage");
  const pageHref = (n: number) => {
    const sp = new URLSearchParams();
    if (view) sp.set("view", view);
    if (q) sp.set("q", q);
    if (n > 1) sp.set("page", String(n));
    const str = sp.toString();
    return `/instruments/certificates${str ? `?${str}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Calibration certificates"
        description="QA Tech's FT-05 certificates, outside-lab certificates of the masters, and imported records."
        action={
          canCalibrate || canUpload ? (
            <div className="flex flex-wrap gap-2">
              {canCalibrate ? (
                <Button variant="secondary" asChild>
                  <Link href="/instruments/certificates/new">
                    <Plus aria-hidden="true" />
                    New calibration
                  </Link>
                </Button>
              ) : null}
              {canUpload ? (
                <Button asChild>
                  <Link href="/instruments/certificates/upload">
                    <FileUp aria-hidden="true" />
                    Upload certificates
                  </Link>
                </Button>
              ) : null}
            </div>
          ) : undefined
        }
      />
      {missing > 0 && view !== "noscan" ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-attention/40 bg-attention-soft px-4 py-2 text-sm text-attention">
          <span>
            <span className="font-semibold">{missing}</span> certificate
            {missing === 1 ? " has" : "s have"} no scan on file; reports that use those instruments
            can&apos;t be frozen.
          </span>
          <Link href="/instruments/certificates?view=noscan" className="font-medium underline">
            See them
          </Link>
          {canUpload ? (
            <Link href="/instruments/certificates/upload" className="font-medium underline">
              Upload the scans
            </Link>
          ) : null}
        </p>
      ) : null}
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
              {v.key === "noscan" && missing > 0 ? ` (${missing})` : ""}
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
                : view === "noscan"
                  ? "All scans are on file"
                  : "No certificates yet"
          }
          description={
            view === "todo"
              ? "No certificate is in draft, waiting for a check or for approval."
              : view === "noscan"
                ? "Every outside-lab and imported certificate has its scan."
                : "Start a calibration, upload certificate scans, or import the logger lists."
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
                    {c.kind !== "internal" && !c.hasFile && c.status !== "cancelled" ? (
                      <span className="ml-1.5 font-medium text-attention">· no scan</span>
                    ) : null}
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
      {page > 1 || more ? (
        <nav aria-label="Pages" className="flex items-center gap-3 text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="text-primary hover:underline">
              Previous
            </Link>
          ) : null}
          <span className="text-muted-foreground">
            {(page - 1) * CERTIFICATE_PAGE + 1}–{(page - 1) * CERTIFICATE_PAGE + rows.length}
          </span>
          {more ? (
            <Link href={pageHref(page + 1)} className="text-primary hover:underline">
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
