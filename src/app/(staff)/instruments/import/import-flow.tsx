"use client";

import { CheckCircle2, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { FileDrop } from "@/components/ui/file-drop";
import { Input } from "@/components/ui/form-controls";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  ImportChoices,
  InstrumentImportPreview,
} from "@/domain/instruments/instrument-import-service";
import { INSTRUMENT_TYPE_INFO, INSTRUMENT_TYPES } from "@/domain/instruments/types";
import { formatDate } from "@/lib/format";

import { applyInstrumentImportAction, previewInstrumentImportAction } from "../actions";

type Stage =
  | { name: "choose"; error?: string }
  | { name: "checking"; fileName: string }
  | { name: "preview"; preview: InstrumentImportPreview; error?: string }
  | { name: "done"; message: string };

async function upload(file: File): Promise<{ id: string } | { error: string }> {
  const body = new FormData();
  body.set("file", file);
  try {
    const response = await fetch("/api/files", { method: "POST", body });
    const json = (await response.json()) as { id?: string; error?: string };
    if (!response.ok || !json.id) return { error: json.error ?? "The upload failed. Try again." };
    return { id: json.id };
  } catch {
    return { error: "The upload failed. Check your connection and try again." };
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function InstrumentImportFlow({
  maxSizeMb,
  models,
}: {
  maxSizeMb: number;
  models: { id: string; label: string }[];
}) {
  const [stage, setStage] = useState<Stage>({ name: "choose" });
  const [choices, setChoices] = useState<ImportChoices>({
    defaultType: "portable_logger",
    assignPrefix: "",
    assignModelId: models[0]?.id ?? "",
  });
  const [pending, startTransition] = useTransition();

  const check = (fileId: string, fileName: string, next: ImportChoices) =>
    startTransition(async () => {
      setStage({ name: "checking", fileName });
      const result = await previewInstrumentImportAction(fileId, next);
      setStage(
        result.ok
          ? { name: "preview", preview: result.data }
          : { name: "choose", error: result.error },
      );
    });

  const onFile = (file: File) =>
    startTransition(async () => {
      setStage({ name: "checking", fileName: file.name });
      const uploaded = await upload(file);
      if ("error" in uploaded) {
        setStage({ name: "choose", error: uploaded.error });
        return;
      }
      const result = await previewInstrumentImportAction(uploaded.id, choices);
      setStage(
        result.ok
          ? { name: "preview", preview: result.data }
          : { name: "choose", error: result.error },
      );
    });

  const apply = (preview: InstrumentImportPreview) =>
    startTransition(async () => {
      const result = await applyInstrumentImportAction(preview.fileId, choices);
      setStage(
        result.ok
          ? { name: "done", message: result.message ?? "Imported." }
          : { name: "preview", preview, error: result.error },
      );
    });

  const typeSelect = (onChange?: (next: ImportChoices) => void) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">Type, when the file doesn&apos;t name the instrument</span>
      <select
        value={choices.defaultType}
        onChange={(e) => {
          const next = { ...choices, defaultType: e.target.value };
          setChoices(next);
          onChange?.(next);
        }}
        className="h-9 rounded-md border border-input bg-surface px-3 text-sm"
      >
        {INSTRUMENT_TYPES.map((t) => (
          <option key={t} value={t}>
            {INSTRUMENT_TYPE_INFO[t].label}
          </option>
        ))}
      </select>
    </label>
  );

  if (stage.name === "done") {
    return (
      <section
        role="status"
        className="flex flex-col items-start gap-3 rounded-lg border border-pass/30 bg-pass-soft p-6 text-pass"
      >
        <p className="flex items-center gap-2 font-medium">
          <CheckCircle2 className="size-5" aria-hidden="true" />
          {stage.message}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/instruments">Open the register</Link>
          </Button>
          <Button variant="secondary" onClick={() => setStage({ name: "choose" })}>
            Import another file
          </Button>
        </div>
      </section>
    );
  }

  if (stage.name === "preview") {
    const { preview } = stage;
    const s = preview.summary;
    const recheck = (next: ImportChoices) => check(preview.fileId, preview.fileName, next);
    const nothing = s.instruments + s.certificateLinks === 0;
    return (
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <p className="text-sm text-muted-foreground">{preview.fileName}</p>
          <ul className="grid gap-2 text-sm sm:grid-cols-3">
            <li>
              <strong className="tabular text-lg">{s.instruments}</strong> new instruments
              {s.idsGiven ? ` (${s.idsGiven} given IDs)` : ""}
            </li>
            <li>
              <strong className="tabular text-lg">{s.alreadyRegistered}</strong> already registered
            </li>
            <li>
              <strong className="tabular text-lg">{s.models}</strong> new models
            </li>
            <li>
              <strong className="tabular text-lg">{s.certificates}</strong> certificates to record
            </li>
            <li>
              <strong className="tabular text-lg">{s.readings}</strong> readings with them
            </li>
            <li>
              <strong className="tabular text-lg">{s.skipped + s.unassigned}</strong> rows need
              attention
            </li>
          </ul>
          <div className="max-w-sm">{typeSelect(recheck)}</div>
        </section>

        {s.unassigned > 0 || choices.assignPrefix ? (
          <section
            aria-labelledby="ids"
            className="flex flex-col gap-3 rounded-lg border border-attention/30 bg-attention-soft p-4"
          >
            <h2 id="ids" className="font-semibold">
              {s.unassigned > 0
                ? `${plural(s.unassigned, "serial number")} without a QA Tech ID`
                : "IDs given to serial numbers"}
            </h2>
            <p className="text-sm">
              Give them the next IDs of a prefix, for example E-TRH (ebro) or T-TRH (Testo). The
              numbering continues after the highest ID already used.
            </p>
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                recheck(choices);
              }}
            >
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">ID prefix</span>
                <Input
                  className="w-32"
                  value={choices.assignPrefix}
                  placeholder="E-TRH"
                  onChange={(e) => setChoices({ ...choices, assignPrefix: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Model, when the file doesn&apos;t say</span>
                <select
                  value={choices.assignModelId}
                  onChange={(e) => setChoices({ ...choices, assignModelId: e.target.value })}
                  className="h-9 rounded-md border border-input bg-surface px-3 text-sm"
                >
                  <option value="">No model</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" variant="secondary" disabled={pending}>
                Check again
              </Button>
            </form>
            {preview.plan.instruments.some((i) => i.generated) ? (
              <p className="text-sm">
                First new IDs:{" "}
                {preview.plan.instruments
                  .filter((i) => i.generated)
                  .slice(0, 3)
                  .map((i) => `${i.code} = ${i.serialNo}`)
                  .join(", ")}
                …
              </p>
            ) : null}
          </section>
        ) : null}

        {preview.plan.fullCertificates.length > 0 ? (
          <section aria-labelledby="full" className="flex flex-col gap-2">
            <h2 id="full" className="font-semibold">
              Certificates with readings
            </h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Calibrated</TableHead>
                  <TableHead className="text-right">Instruments</TableHead>
                  <TableHead className="text-right">Points</TableHead>
                  <TableHead>Masters</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.plan.fullCertificates.map((c) => (
                  <TableRow key={c.number}>
                    <TableCell>
                      {c.number}
                      <p className="text-xs text-muted-foreground">
                        {c.make} {c.model} · {c.sheets.join(", ")}
                        {c.missing ? ` · ${c.missing} without an ID left out` : ""}
                      </p>
                    </TableCell>
                    <TableCell className="tabular">{formatDate(c.calibratedOn)}</TableCell>
                    <TableCell className="tabular text-right">{c.codes.length}</TableCell>
                    <TableCell className="tabular text-right">{c.points.length}</TableCell>
                    <TableCell className="text-sm">
                      {c.masters.map((m) => (
                        <span key={m.certificateNo} className="block">
                          {m.certificateId ? (
                            <StatusBadge tone="pass">Linked</StatusBadge>
                          ) : (
                            <StatusBadge tone="attention">Not registered</StatusBadge>
                          )}{" "}
                          {m.certificateNo}
                        </span>
                      ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {s.unlinkedMasters > 0 ? (
              <p className="text-sm text-muted-foreground">
                A master that is not registered is kept in the certificate&apos;s remarks. For full
                traceability, add the master and its certificate (Register → Add instrument → Record
                outside-lab certificate) before importing.
              </p>
            ) : null}
          </section>
        ) : null}

        {preview.plan.alreadyRecorded.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            Already recorded, not imported again: {preview.plan.alreadyRecorded.join(", ")}.
          </p>
        ) : null}

        {preview.plan.skipped.length + preview.plan.problems.length > 0 ? (
          <section aria-labelledby="skipped" className="flex flex-col gap-2">
            <h2 id="skipped" className="font-semibold">
              Needs your attention
            </h2>
            <ul className="flex flex-col gap-1 text-sm">
              {preview.plan.problems.map((p) => (
                <li key={p}>
                  <StatusBadge tone="attention">Note</StatusBadge> {p}
                </li>
              ))}
              {preview.plan.skipped.map((p) => (
                <li key={`${p.row}-${p.reason}`}>
                  <StatusBadge tone="neutral">Skipped</StatusBadge> {p.row}: {p.reason}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {preview.plan.certificates.length > 0 ? (
          <section aria-labelledby="certs" className="flex flex-col gap-2">
            <h2 id="certs" className="font-semibold">
              Certificates from the list (no readings)
            </h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Calibrated</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Instruments</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.plan.certificates.map((c) => (
                  <TableRow key={c.number}>
                    <TableCell>
                      {c.number}
                      {c.existingId ? (
                        <StatusBadge tone="info" className="ml-2">
                          Already recorded: adds instruments
                        </StatusBadge>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular">{formatDate(c.calibratedOn)}</TableCell>
                    <TableCell className="tabular">{formatDate(c.validUntil)}</TableCell>
                    <TableCell className="tabular text-right">{c.codes.length}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        ) : null}

        {preview.plan.instruments.length > 0 ? (
          <details className="rounded-lg border border-border bg-surface p-4">
            <summary className="cursor-pointer font-medium">
              New instruments ({preview.plan.instruments.length})
            </summary>
            <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {preview.plan.instruments.map((i) => (
                <li key={i.code}>
                  {i.code}{" "}
                  <span className="text-muted-foreground">
                    {i.serialNo} · {i.make} {i.model}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {stage.error ? (
          <p role="alert" className="rounded-md bg-fail-soft px-3 py-2 text-sm text-fail">
            {stage.error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => apply(preview)} disabled={pending || nothing}>
            {pending
              ? "Importing…"
              : nothing
                ? "Nothing new to import"
                : `Import ${plural(s.instruments, "instrument")} and ${plural(s.certificates, "certificate")}`}
          </Button>
          <Button
            variant="secondary"
            onClick={() => setStage({ name: "choose" })}
            disabled={pending}
          >
            <RotateCcw aria-hidden="true" />
            Choose another file
          </Button>
        </div>
      </div>
    );
  }

  return (
    <section className="grid gap-6 rounded-lg border border-border bg-surface p-6 md:grid-cols-[1fr_18rem]">
      <div className="flex flex-col gap-3">
        <FileDrop
          accept=".xlsx"
          description="A logger list or FT-05 certificate workbook (.xlsx)"
          maxSizeMb={maxSizeMb}
          onFile={onFile}
          disabled={pending}
        />
        {stage.name === "checking" ? (
          <p role="status" className="text-sm text-muted-foreground">
            Checking {stage.fileName}…
          </p>
        ) : null}
        {stage.name === "choose" && stage.error ? (
          <p role="alert" className="rounded-md bg-fail-soft px-3 py-2 text-sm text-fail">
            {stage.error}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-3 text-sm">
        {typeSelect()}
        <ul className="flex list-disc flex-col gap-1 pl-4 text-muted-foreground">
          <li>Logger lists: columns are found by their headings, in any order.</li>
          <li>
            FT-05 certificate workbooks: every sheet&apos;s header, masters and readings are read; a
            certificate over several sheets is joined.
          </li>
          <li>Plain serial lists: give them IDs from a prefix on the next screen.</li>
          <li>Nothing changes until you press Import.</li>
        </ul>
      </div>
    </section>
  );
}
