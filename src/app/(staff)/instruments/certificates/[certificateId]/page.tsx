import { ChevronLeft, Copy, Download } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { Stepper, type Step } from "@/components/ui/stepper";
import { db } from "@/db/client";
import { can } from "@/domain/auth/permissions";
import { certificateSignatures } from "@/domain/instruments/calibration-service";
import { decimalPlaces } from "@/domain/instruments/calibration-math";
import { toPlaces } from "@/domain/instruments/display";
import { getCertificate, usableInstruments } from "@/domain/instruments/queries";
import { QUANTITY_UNITS, type Quantity } from "@/domain/instruments/types";
import { requirePermission } from "@/lib/auth/dal";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { CERTIFICATE_STATUS, KIND_LABELS } from "../../certificate-labels";
import { CalibrationSheet } from "./calibration-sheet";
import { SignPanel } from "./sign-panel";

export const metadata = { title: "Certificate" };

const ORDER = ["draft", "checking", "approving", "issued"];

export default async function CertificatePage({
  params,
}: PageProps<"/instruments/certificates/[certificateId]">) {
  const actor = await requirePermission("instruments.view");
  const { certificateId } = await params;
  const cert = await getCertificate(db, actor, certificateId);
  if (!cert) notFound();
  const signatures = await certificateSignatures(db, actor.organisationId, cert.id);
  const internal = cert.kind === "internal";
  const editable = internal && cert.status === "draft" && can(actor, "calibration.perform");
  const doneBy = signatures.filter((s) => s.meaning === "done_by").at(-1);

  let step: "submit" | "check" | "approve" | null = null;
  if (internal && cert.status === "draft" && can(actor, "calibration.perform")) step = "submit";
  if (cert.status === "checking" && can(actor, "calibration.check")) step = "check";
  if (cert.status === "approving" && can(actor, "calibration.approve")) step = "approve";
  const blockedReason =
    (step === "check" || step === "approve") && doneBy?.userId === actor.id
      ? "You did this calibration, so someone else must check and approve it."
      : undefined;
  const canReturn =
    (cert.status === "checking" && can(actor, "calibration.check")) ||
    (cert.status === "approving" && can(actor, "calibration.approve"));
  const canCancel = cert.status !== "cancelled" && can(actor, "instruments.manage");

  const at = ORDER.indexOf(cert.status);
  const latest = (m: string) => signatures.filter((s) => s.meaning === m).at(-1);
  const stepState = (i: number): Step["state"] =>
    cert.status === "cancelled"
      ? "locked"
      : i < at || cert.status === "issued"
        ? "done"
        : i === at
          ? "current"
          : "upcoming";
  const steps: Step[] = [
    {
      id: "draft",
      label: "Readings entered",
      state: stepState(0),
      note: latest("done_by") ? `Done by ${latest("done_by")!.signerName}` : undefined,
    },
    {
      id: "checking",
      label: "Checked",
      state: stepState(1),
      note: latest("checked_by")?.signerName,
    },
    {
      id: "approving",
      label: "Approved",
      state: stepState(2),
      note: latest("approved_by")?.signerName,
    },
    {
      id: "issued",
      label: "Issued",
      state: stepState(3),
      note: cert.issuedOn ? formatDate(cert.issuedOn) : undefined,
    },
  ];

  const availableMasters = editable
    ? (await usableInstruments(db, actor, "master", cert.calibratedOn)).map((m) => ({
        id: m.id,
        code: m.code,
        serialNo: m.serialNo,
        label: `${m.make} ${m.model}${m.coveringCertificate ? "" : " (not valid on this date)"}`,
      }))
    : [];
  const readingAt = new Map(cert.readings.map((r) => [`${r.seq}|${r.instrumentId}`, r]));
  const status = CERTIFICATE_STATUS[cert.status] ?? {
    label: cert.status,
    tone: "neutral" as const,
  };
  const hasPdf = internal || cert.fileId !== null;

  return (
    <>
      <Link
        href="/instruments/certificates"
        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Certificates
      </Link>
      <PageHeader
        title={cert.number}
        description={`${KIND_LABELS[cert.kind] ?? cert.kind}${cert.kind === "external" ? ` · ${cert.labName}${cert.ulrNo ? ` · ULR ${cert.ulrNo}` : ""}` : ""} · ${cert.title}`}
        action={
          <div className="flex flex-wrap gap-2">
            {hasPdf ? (
              <Button variant="secondary" asChild>
                <a href={`/instruments/certificates/${cert.id}/pdf`} target="_blank" rel="noopener">
                  <Download aria-hidden="true" />
                  {internal && cert.status !== "issued" ? "Preview PDF" : "PDF"}
                </a>
              </Button>
            ) : null}
            {internal && can(actor, "calibration.perform") ? (
              <Button variant="secondary" asChild>
                <Link href={`/instruments/certificates/new?from=${cert.id}`}>
                  <Copy aria-hidden="true" />
                  Calibrate again
                </Link>
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        <span className="text-sm text-muted-foreground">
          Calibrated {formatDate(cert.calibratedOn)} · due{" "}
          {cert.validUntil ? formatDate(cert.validUntil) : "not set"}
          {internal ? ` · ${cert.customerName}` : ""}
        </span>
      </div>
      {cert.status === "cancelled" ? (
        <p role="alert" className="rounded-md bg-fail-soft px-3 py-2 text-sm text-fail">
          Cancelled: {cert.cancelledReason}
        </p>
      ) : null}

      {internal ? <Stepper steps={steps} /> : null}

      {internal || canCancel ? (
        <SignPanel
          certificateId={cert.id}
          number={cert.number}
          step={step}
          canReturn={canReturn}
          canCancel={canCancel}
          blockedReason={blockedReason}
        />
      ) : null}

      {editable ? (
        <CalibrationSheet
          key={cert.id}
          data={{
            certificateId: cert.id,
            header: {
              calibratedOn: cert.calibratedOn,
              validUntil: cert.validUntil ?? "",
              title: cert.title,
              location: cert.location,
              department: cert.department,
              equipmentName: cert.equipmentName,
              make: cert.make,
              model: cert.model,
              rangeText: cert.rangeText,
              resolutionText: cert.resolutionText,
              accuracyText: cert.accuracyText,
              sopNo: cert.sopNo,
              conditionOnReceipt: cert.conditionOnReceipt,
              environmentTemperature: cert.environmentTemperature,
              environmentHumidity: cert.environmentHumidity,
              remarks: cert.remarks,
            },
            points: cert.points.map((p) => ({
              quantity: p.quantity as Quantity,
              reference: p.reference,
              condition: p.condition,
            })),
            instruments: cert.items.map((i) => ({
              id: i.instrument.id,
              code: i.instrument.code,
              serialNo: i.instrument.serialNo,
            })),
            masters: cert.masters.map((m) => ({
              id: m.instrument.id,
              code: m.instrument.code,
              serialNo: m.instrument.serialNo,
            })),
            availableMasters,
            readings: cert.points.map((p) =>
              cert.items.map((i) => readingAt.get(`${p.seq}|${i.instrument.id}`)?.reading ?? ""),
            ),
            accuracy: cert.accuracy,
          }}
        />
      ) : (
        <>
          {cert.masters.length > 0 ? (
            <section aria-labelledby="masters" className="flex flex-col gap-2">
              <h2 id="masters" className="font-semibold">
                Master standards
              </h2>
              <ul className="flex flex-col gap-1 text-sm">
                {cert.masters.map((m) => (
                  <li key={m.instrument.id}>
                    <Link
                      href={`/instruments/${m.instrument.id}`}
                      className="text-primary hover:underline"
                    >
                      {m.instrument.code}
                    </Link>{" "}
                    {m.instrument.make} {m.instrument.model} — certificate{" "}
                    {m.certificate ? (
                      <Link
                        href={`/instruments/certificates/${m.certificate.id}`}
                        className="hover:underline"
                      >
                        {m.certificate.number}
                      </Link>
                    ) : (
                      "—"
                    )}
                    {m.certificate?.validUntil
                      ? `, valid to ${formatDate(m.certificate.validUntil)}`
                      : ""}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {cert.points.length > 0 ? (
            <section aria-labelledby="results" className="flex flex-col gap-2">
              <h2 id="results" className="font-semibold">
                Results
              </h2>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-max min-w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-surface-muted">
                      <th scope="col" className="p-2 text-left">
                        Point
                      </th>
                      <th scope="col" className="p-2 text-left">
                        Master
                      </th>
                      {cert.items.map((i) => (
                        <th key={i.instrument.id} scope="col" className="p-2 text-left">
                          <Link
                            href={`/instruments/${i.instrument.id}`}
                            className="text-primary hover:underline"
                          >
                            {i.instrument.code}
                          </Link>
                          <span className="block text-xs font-normal text-muted-foreground">
                            {i.instrument.serialNo}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cert.points.map((p) => (
                      <tr key={p.seq} className="border-t border-border">
                        <th scope="row" className="p-2 text-left font-normal">
                          {p.seq} · {QUANTITY_UNITS[p.quantity as Quantity]}
                          {p.condition ? (
                            <span className="block text-xs text-muted-foreground">
                              @ {p.condition}
                            </span>
                          ) : null}
                        </th>
                        <td className="tabular p-2 font-medium">{p.reference}</td>
                        {cert.items.map((i) => {
                          const r = readingAt.get(`${p.seq}|${i.instrument.id}`);
                          return (
                            <td key={i.instrument.id} className="tabular p-2">
                              {r ? (
                                <>
                                  {r.reading}
                                  <span
                                    className={cn(
                                      "block text-xs",
                                      r.judgement === "fail"
                                        ? "font-semibold text-fail"
                                        : "text-muted-foreground",
                                    )}
                                  >
                                    Δ {toPlaces(r.deviation, decimalPlaces(p.reference))}
                                    {r.uncertainty ? ` ± ${r.uncertainty}` : ""}
                                    {r.judgement === "fail" ? " ✕" : ""}
                                  </span>
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <section aria-labelledby="items" className="flex flex-col gap-2">
              <h2 id="items" className="font-semibold">
                Instruments on this certificate
              </h2>
              <ul className="flex flex-wrap gap-2 text-sm">
                {cert.items.map((i) => (
                  <li key={i.instrument.id}>
                    <Link
                      href={`/instruments/${i.instrument.id}`}
                      className="rounded-full border border-border px-3 py-1 hover:border-primary"
                    >
                      {i.instrument.code}
                      {i.instrument.serialNo ? ` · ${i.instrument.serialNo}` : ""}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {cert.remarks ? (
            <p className="text-sm whitespace-pre-line text-muted-foreground">{cert.remarks}</p>
          ) : null}
        </>
      )}

      {signatures.length > 0 ? (
        <section aria-labelledby="sigs" className="flex flex-col gap-2">
          <h2 id="sigs" className="font-semibold">
            Signatures
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {signatures.map((s) => (
              <li key={s.id}>
                <span className="font-medium">{s.signerName}</span> —{" "}
                {s.meaning === "done_by"
                  ? "calibration done by"
                  : s.meaning === "checked_by"
                    ? "checked by"
                    : "approved by"}
                , {formatDateTime(s.signedAt)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
