"use client";

import { CheckCircle2, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { FileDrop } from "@/components/ui/file-drop";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { InstrumentImportPreview } from "@/domain/instruments/instrument-import-service";
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

export function InstrumentImportFlow({ maxSizeMb }: { maxSizeMb: number }) {
  const [stage, setStage] = useState<Stage>({ name: "choose" });
  const [defaultType, setDefaultType] = useState("portable_logger");
  const [pending, startTransition] = useTransition();

  const check = (fileId: string, fileName: string, type: string) =>
    startTransition(async () => {
      setStage({ name: "checking", fileName });
      const result = await previewInstrumentImportAction(fileId, type);
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
      const result = await previewInstrumentImportAction(uploaded.id, defaultType);
      setStage(
        result.ok
          ? { name: "preview", preview: result.data }
          : { name: "choose", error: result.error },
      );
    });

  const apply = (preview: InstrumentImportPreview) =>
    startTransition(async () => {
      const result = await applyInstrumentImportAction(preview.fileId, defaultType);
      setStage(
        result.ok
          ? { name: "done", message: result.message ?? "Imported." }
          : { name: "preview", preview, error: result.error },
      );
    });

  const typeSelect = (onChange?: (v: string) => void) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">Type, when a row doesn&apos;t name the instrument</span>
      <select
        value={defaultType}
        onChange={(e) => {
          setDefaultType(e.target.value);
          onChange?.(e.target.value);
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
            Import another list
          </Button>
        </div>
      </section>
    );
  }

  if (stage.name === "preview") {
    const { preview } = stage;
    const s = preview.summary;
    return (
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <p className="text-sm text-muted-foreground">{preview.fileName}</p>
          <ul className="grid gap-2 text-sm sm:grid-cols-3">
            <li>
              <strong className="tabular text-lg">{s.instruments}</strong> new instruments
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
              <strong className="tabular text-lg">{s.unnumbered}</strong> without a number in the
              list
            </li>
            <li>
              <strong className="tabular text-lg">{s.skipped}</strong> rows skipped
            </li>
          </ul>
          <div className="max-w-sm">
            {typeSelect((v) => check(preview.fileId, preview.fileName, v))}
          </div>
        </section>

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
                <li key={p.row}>
                  <StatusBadge tone="neutral">Skipped</StatusBadge> {p.row}: {p.reason}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {preview.plan.certificates.length > 0 ? (
          <section aria-labelledby="certs" className="flex flex-col gap-2">
            <h2 id="certs" className="font-semibold">
              Certificates
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
          <Button
            onClick={() => apply(preview)}
            disabled={pending || s.instruments + s.certificateLinks === 0}
          >
            {pending ? "Importing…" : `Import ${s.instruments} instruments`}
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
          description="A logger list (.xlsx)"
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
        <p className="text-muted-foreground">
          Every sheet is read. A certificate number written only on a batch&apos;s first row applies
          to the rows below with the same date. Rows without a number are kept as “Number not
          recorded”, never given an invented one.
        </p>
      </div>
    </section>
  );
}
