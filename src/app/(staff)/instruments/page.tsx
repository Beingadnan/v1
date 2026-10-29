import { AlertTriangle, Download, Gauge, Search } from "lucide-react";
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
  dueBatches,
  expirySummary,
  listInstruments,
  type InstrumentFilter,
} from "@/domain/instruments/queries";
import {
  INSTRUMENT_TYPE_INFO,
  STATUS_LABELS,
  type InstrumentStatus,
  type InstrumentType,
} from "@/domain/instruments/types";
import { requirePermission } from "@/lib/auth/dal";
import { cn } from "@/lib/utils";

import { AddInstrumentButton, BulkAddButton } from "./instrument-dialogs";
import { formOptions } from "./options";
import { ValidityBadge } from "./validity-badge";

export const metadata = { title: "Instruments" };

const VIEWS = [
  { key: "", label: "All" },
  { key: "master", label: "Master standards" },
  { key: "working", label: "Loggers & sensors" },
  { key: "attention", label: "Needs calibration" },
] as const;

export default async function InstrumentsPage({ searchParams }: PageProps<"/instruments">) {
  const actor = await requirePermission("instruments.view");
  const canManage = can(actor, "instruments.manage");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const view = typeof params.view === "string" ? params.view : "";
  const filter: InstrumentFilter = { q };
  if (view === "master" || view === "working") filter.tier = view;
  if (view === "attention") filter.validity = "attention";

  const canCalibrate = can(actor, "calibration.perform");
  const [rows, summary, options, batches] = await Promise.all([
    listInstruments(db, actor, filter),
    expirySummary(db, actor),
    canManage ? formOptions(actor) : Promise.resolve(null),
    view === "attention" && canCalibrate ? dueBatches(db, actor) : Promise.resolve([]),
  ]);
  const { counts } = summary;
  const urgent = counts.expired + counts.due_7;
  const soon = counts.due_15 + counts.due_30;

  return (
    <>
      <PageHeader
        title="Instruments"
        description="QA Tech's loggers, sensors and master standards, with their current calibration."
        action={
          options ? (
            <div className="flex flex-wrap gap-2">
              <AddInstrumentButton models={options.models} sites={options.sites} />
              <BulkAddButton models={options.models} sites={options.sites} />
            </div>
          ) : undefined
        }
      />

      {summary.masters.length > 0 ? (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-lg border border-fail/30 bg-fail-soft px-4 py-3 text-sm text-fail"
        >
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4" aria-hidden="true" />
            {summary.masters.length === 1
              ? "A master standard needs"
              : `${summary.masters.length} master standards need`}{" "}
            calibration
          </p>
          <p>
            {summary.masters.map((m, i) => (
              <span key={m.id}>
                {i > 0 ? ", " : ""}
                <Link href={`/instruments/${m.id}`} className="underline">
                  {m.code}
                </Link>{" "}
                (
                {m.validity === "expired"
                  ? "expired"
                  : m.validity === "never"
                    ? "no certificate"
                    : `due ${m.latest?.validUntil}`}
                )
              </span>
            ))}
            . Calibrations using an expired master are refused.
          </p>
        </div>
      ) : null}

      {urgent + soon + counts.never > 0 ? (
        <Link
          href="/instruments?view=attention"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-attention/30 bg-attention-soft px-4 py-3 text-sm text-attention hover:border-attention"
        >
          {urgent > 0 ? <strong>{urgent} expired or due within 7 days</strong> : null}
          {soon > 0 ? <span>{soon} due within 30 days</span> : null}
          {counts.never > 0 ? <span>{counts.never} never calibrated</span> : null}
          <span>See the list →</span>
        </Link>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Show" className="flex flex-wrap gap-1">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={`/instruments${v.key ? `?view=${v.key}` : ""}${q ? `${v.key ? "&" : "?"}q=${encodeURIComponent(q)}` : ""}`}
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
        <a
          href={`/instruments/export?${new URLSearchParams({ ...(view ? { view } : {}), ...(q ? { q } : {}) }).toString()}`}
          download
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <Download className="size-4" aria-hidden="true" />
          Download as Excel
        </a>
        <form role="search" className="flex max-w-sm flex-1 gap-2">
          {view ? <input type="hidden" name="view" value={view} /> : null}
          <label htmlFor="q" className="sr-only">
            Search instruments
          </label>
          <Input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="ID, serial, make or model"
          />
          <Button type="submit" variant="secondary">
            <Search aria-hidden="true" />
            Search
          </Button>
        </form>
      </div>

      {batches.length > 0 ? (
        <section
          aria-labelledby="plan"
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <h2 id="plan" className="font-semibold">
            Plan the calibration
          </h2>
          <p className="text-sm text-muted-foreground">
            One certificate covers one model. Batches take the most urgent first (never calibrated,
            expired, then the earliest due), 20 at a time: two observation blocks on one FT-05 page.
          </p>
          <ul className="flex flex-col gap-2">
            {batches.map((b) => {
              const batch = b.instruments.slice(0, 20);
              return (
                <li
                  key={`${b.make}|${b.model}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                >
                  <span className="text-sm">
                    <strong>{`${b.make} ${b.model}`.trim() || "No model recorded"}</strong> ·{" "}
                    {b.instruments.length} to calibrate
                    <span className="block text-xs text-muted-foreground">
                      Next:{" "}
                      {batch
                        .map((i) => i.code)
                        .slice(0, 4)
                        .join(", ")}
                      {batch.length > 4 ? `… (${batch.length})` : ""}
                    </span>
                  </span>
                  <Button size="sm" asChild>
                    <Link
                      href={`/instruments/certificates/new?ids=${batch.map((i) => i.id).join(",")}`}
                    >
                      Start a batch of {batch.length}
                    </Link>
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={q ? Search : Gauge}
          title={
            q
              ? `No instrument matches “${q}”`
              : view === "attention"
                ? "Everything is calibrated"
                : "No instruments yet"
          }
          description={
            q
              ? "Try part of the ID (E-TRH05), a serial number or the make."
              : view === "attention"
                ? "No instrument is expired or due within 30 days."
                : canManage
                  ? "Import your logger lists, or add a model and then a batch of instruments."
                  : "Instruments appear here once the lab adds them."
          }
          action={
            canManage && !q && view !== "attention" ? (
              <Button variant="secondary" asChild>
                <Link href="/instruments/import">Import logger lists</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead className="hidden sm:table-cell">Serial</TableHead>
              <TableHead>Make & model</TableHead>
              <TableHead className="hidden md:table-cell">Site</TableHead>
              <TableHead className="hidden lg:table-cell">Certificate</TableHead>
              <TableHead>Due</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link
                    href={`/instruments/${r.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {r.code}
                  </Link>
                  {r.serialNo ? (
                    <p className="tabular text-xs sm:hidden">S/N {r.serialNo}</p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {INSTRUMENT_TYPE_INFO[r.type as InstrumentType]?.label ?? r.type}
                    {r.tier === "master" ? (
                      <StatusBadge tone="info" className="ml-2">
                        Master
                      </StatusBadge>
                    ) : null}
                    {r.status !== "active" ? (
                      <StatusBadge tone="neutral" className="ml-2">
                        {STATUS_LABELS[r.status as InstrumentStatus]}
                      </StatusBadge>
                    ) : null}
                  </p>
                </TableCell>
                <TableCell className="tabular hidden sm:table-cell">{r.serialNo || "—"}</TableCell>
                <TableCell>
                  {r.make} {r.model}
                </TableCell>
                <TableCell className="hidden md:table-cell">{r.siteName ?? "—"}</TableCell>
                <TableCell className="hidden text-xs lg:table-cell">
                  {r.latest?.number ?? "—"}
                </TableCell>
                <TableCell>
                  <ValidityBadge state={r.validity} validUntil={r.latest?.validUntil} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {rows.length >= 2000 ? (
        <p className="text-sm text-muted-foreground">
          Showing the first 2,000. Search to narrow the list.
        </p>
      ) : null}
    </>
  );
}
