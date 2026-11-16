import { ChevronLeft, Download, FileText, FileUp, GitBranch } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
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
import { todayInIndia } from "@/domain/clients/requalification";
import { getInstrument, traceChain, type TraceNode } from "@/domain/instruments/queries";
import {
  INSTRUMENT_TYPE_INFO,
  STATUS_LABELS,
  type InstrumentStatus,
  type InstrumentType,
} from "@/domain/instruments/types";
import { requirePermission } from "@/lib/auth/dal";
import { formatDate } from "@/lib/format";

import { CERTIFICATE_STATUS, KIND_LABELS } from "../certificate-labels";
import { EditInstrumentButton, ExternalCertificateButton } from "../instrument-dialogs";
import { formOptions } from "../options";
import { ValidityBadge } from "../validity-badge";

export const metadata = { title: "Instrument" };

function TraceTree({ node, depth = 0 }: { node: TraceNode; depth?: number }) {
  const cert = node.certificate;
  return (
    <li className={depth > 0 ? "mt-2 border-l-2 border-border pl-4" : ""}>
      <div className="flex flex-col gap-0.5 rounded-md border border-border bg-surface p-3 text-sm">
        <p>
          <Link
            href={`/instruments/${node.instrument.id}`}
            className="font-medium text-primary hover:underline"
          >
            {node.instrument.code}
          </Link>{" "}
          <span className="text-muted-foreground">
            {node.instrument.make} {node.instrument.model}
            {node.instrument.serialNo ? ` · S/N ${node.instrument.serialNo}` : ""}
          </span>
        </p>
        {cert ? (
          <p className="flex flex-wrap items-center gap-2">
            <Link href={`/instruments/certificates/${cert.id}`} className="hover:underline">
              {cert.number}
            </Link>
            <span className="text-muted-foreground">
              {cert.labName}
              {cert.ulrNo ? ` · ULR ${cert.ulrNo}` : ""} · {formatDate(cert.calibratedOn)} to{" "}
              {cert.validUntil ? formatDate(cert.validUntil) : "no due date"}
            </span>
            {node.validOnDate ? (
              <StatusBadge tone="pass">Valid on {formatDate(node.date)}</StatusBadge>
            ) : (
              <StatusBadge tone="fail">Not valid on {formatDate(node.date)}</StatusBadge>
            )}
          </p>
        ) : (
          <p>
            <StatusBadge tone="fail">No certificate covering {formatDate(node.date)}</StatusBadge>
          </p>
        )}
        {cert && cert.kind === "external" && node.masters.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Calibrated by an outside laboratory: the chain continues in their certificate.
          </p>
        ) : null}
      </div>
      {node.masters.length > 0 ? (
        <ul aria-label={`Masters used for ${cert?.number ?? node.instrument.code}`}>
          {node.masters.map((m) => (
            <TraceTree key={`${m.instrument.id}-${m.certificate?.id}`} node={m} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export default async function InstrumentPage({
  params,
  searchParams,
}: PageProps<"/instruments/[instrumentId]">) {
  const actor = await requirePermission("instruments.view");
  const { instrumentId } = await params;
  const { on } = await searchParams;
  const date = typeof on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : todayInIndia();
  const canManage = can(actor, "instruments.manage");
  // The chain checks the organisation itself, so it is read alongside the instrument.
  const [instrument, chain, options] = await Promise.all([
    getInstrument(db, actor, instrumentId),
    traceChain(db, actor, instrumentId, date),
    canManage ? formOptions(actor) : Promise.resolve(null),
  ]);
  if (!instrument) notFound();

  const facts: [string, string][] = [
    ["Type", INSTRUMENT_TYPE_INFO[instrument.type as InstrumentType]?.label ?? instrument.type],
    ["Use", instrument.tier === "master" ? "Master standard" : "Working instrument"],
    ["Serial number", instrument.serialNo || "—"],
    ["Make & model", `${instrument.make} ${instrument.model}`.trim() || "—"],
    ["Range", instrument.rangeText || "—"],
    ["Resolution", instrument.resolutionText || "—"],
    ["Accuracy", instrument.accuracyText || "—"],
    ["Home site", instrument.siteName ?? "—"],
    ["Status", STATUS_LABELS[instrument.status as InstrumentStatus] ?? instrument.status],
  ];

  return (
    <>
      <Link
        href="/instruments"
        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        All instruments
      </Link>
      <PageHeader
        title={instrument.code}
        description={`${instrument.equipmentName || INSTRUMENT_TYPE_INFO[instrument.type as InstrumentType]?.label || ""}${instrument.notes ? ` — ${instrument.notes}` : ""}`}
        action={
          options ? (
            <div className="flex flex-wrap gap-2">
              <EditInstrumentButton
                instrument={instrument}
                models={options.models}
                sites={options.sites}
              />
              <ExternalCertificateButton
                instrumentId={instrument.id}
                instrumentCode={instrument.code}
              />
              <Button asChild>
                <Link href={`/instruments/certificates/upload?instrument=${instrument.id}`}>
                  <FileUp aria-hidden="true" />
                  Upload certificate
                </Link>
              </Button>
            </div>
          ) : undefined
        }
      />

      <section aria-labelledby="facts" className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <dl
          id="facts"
          className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-2"
        >
          {facts.map(([k, v]) => (
            <div key={k} className="flex flex-col">
              <dt className="text-muted-foreground">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-sm">
          <p className="text-muted-foreground">Calibration</p>
          <ValidityBadge state={instrument.validity} validUntil={instrument.latest?.validUntil} />
          {instrument.latest ? (
            <Link
              href={`/instruments/certificates/${instrument.latest.id}`}
              className="text-primary hover:underline"
            >
              {instrument.latest.number}
            </Link>
          ) : (
            <p>No certificate recorded yet.</p>
          )}
        </div>
      </section>

      <section aria-labelledby="history" className="flex flex-col gap-3">
        <h2 id="history" className="flex items-center gap-2 text-lg font-semibold">
          <FileText className="size-5" aria-hidden="true" />
          Certificates
        </h2>
        {instrument.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Certificate</TableHead>
                <TableHead>Calibrated</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Scan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {instrument.history.map(({ certificate: c, result }) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link
                      href={`/instruments/certificates/${c.id}`}
                      className="text-primary hover:underline"
                    >
                      {c.number}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {KIND_LABELS[c.kind] ?? c.kind}
                      {c.kind === "external" ? ` · ${c.labName}` : ""}
                    </p>
                  </TableCell>
                  <TableCell className="tabular">{formatDate(c.calibratedOn)}</TableCell>
                  <TableCell className="tabular">
                    {c.validUntil ? formatDate(c.validUntil) : "—"}
                  </TableCell>
                  <TableCell>
                    {result === "pass" ? (
                      <StatusBadge tone="pass">Pass</StatusBadge>
                    ) : result === "fail" ? (
                      <StatusBadge tone="fail">Outside accuracy</StatusBadge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={CERTIFICATE_STATUS[c.status]?.tone ?? "neutral"}>
                      {CERTIFICATE_STATUS[c.status]?.label ?? c.status}
                    </StatusBadge>
                  </TableCell>
                  <TableCell>
                    {c.fileId || c.kind === "internal" ? (
                      <a
                        href={`/instruments/certificates/${c.id}/pdf`}
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <Download className="size-3.5" aria-hidden="true" />
                        PDF
                      </a>
                    ) : c.status === "cancelled" ? (
                      "—"
                    ) : (
                      <StatusBadge tone="attention">Missing</StatusBadge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section aria-labelledby="trace" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="trace" className="flex items-center gap-2 text-lg font-semibold">
            <GitBranch className="size-5" aria-hidden="true" />
            Traceability
          </h2>
          <form className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span>On the date</span>
              <Input type="date" name="on" defaultValue={date} className="w-44" />
            </label>
            <Button type="submit" variant="secondary">
              Show
            </Button>
          </form>
        </div>
        <p className="text-sm text-muted-foreground">
          The certificate that covered this instrument on the date, the masters used to calibrate
          it, and the masters&apos; own certificates on that calibration day.
        </p>
        {chain ? (
          <ul>
            <TraceTree node={chain} />
          </ul>
        ) : null}
      </section>

      {instrument.usedAsMaster.length > 0 ? (
        <section aria-labelledby="used" className="flex flex-col gap-2">
          <h2 id="used" className="text-lg font-semibold">
            Used as master for
          </h2>
          <ul className="flex flex-wrap gap-2 text-sm">
            {instrument.usedAsMaster.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/instruments/certificates/${c.id}`}
                  className="rounded-full border border-border px-3 py-1 hover:border-primary"
                >
                  {c.number} · {formatDate(c.calibratedOn)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
