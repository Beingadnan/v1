"use client";

import { CheckCircle2, Download, FileSpreadsheet, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { FileDrop } from "@/components/ui/file-drop";
import { StatusBadge } from "@/components/ui/status-badge";
import { Stepper, type StepState } from "@/components/ui/stepper";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ImportPreview } from "@/domain/clients/import/import-service";

import { applyImportAction, previewImportAction } from "./actions";

type Stage =
  | { name: "choose"; error?: string }
  | { name: "checking"; fileName: string }
  | { name: "preview"; preview: ImportPreview; error?: string }
  | { name: "done"; message: string };

const KIND_LABEL = {
  client: "Client",
  site: "Site",
  department: "Department",
  equipment: "Equipment",
};

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

export function ImportFlow({ maxSizeMb }: { maxSizeMb: number }) {
  const [stage, setStage] = useState<Stage>({ name: "choose" });
  const [pending, startTransition] = useTransition();

  const state = (step: "upload" | "check" | "import"): StepState => {
    const order = { choose: 0, checking: 1, preview: 1, done: 2 }[stage.name];
    const index = { upload: 0, check: 1, import: 2 }[step];
    if (stage.name === "done") return "done";
    if (stage.name === "preview" && step === "check" && stage.preview.errors.length > 0) {
      return "attention";
    }
    return index < order ? "done" : index === order ? "current" : "upcoming";
  };

  function onFile(file: File) {
    setStage({ name: "checking", fileName: file.name });
    startTransition(async () => {
      const uploaded = await upload(file);
      if ("error" in uploaded) {
        setStage({ name: "choose", error: uploaded.error });
        return;
      }
      const result = await previewImportAction(uploaded.id);
      setStage(
        result.ok
          ? { name: "preview", preview: result.data }
          : { name: "choose", error: result.error },
      );
    });
  }

  function onImport(preview: ImportPreview) {
    startTransition(async () => {
      const result = await applyImportAction(preview.fileId);
      setStage(
        result.ok
          ? { name: "done", message: result.message ?? "Imported." }
          : { name: "preview", preview, error: result.error },
      );
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Stepper
        steps={[
          { id: "upload", label: "Upload the sheet", state: state("upload") },
          {
            id: "check",
            label: "Check the changes",
            state: state("check"),
            note:
              stage.name === "preview" && stage.preview.errors.length > 0
                ? "Some rows need fixing"
                : undefined,
          },
          { id: "import", label: "Import", state: state("import") },
        ]}
      />

      {stage.name === "choose" || stage.name === "checking" ? (
        <section className="grid gap-6 rounded-lg border border-border bg-surface p-6 md:grid-cols-[1fr_16rem]">
          <div className="flex flex-col gap-3">
            <FileDrop
              accept=".xlsx"
              description="The filled-in template (.xlsx)"
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
            <FileSpreadsheet className="size-6 text-primary" aria-hidden="true" />
            <p>
              Start from the template. It has a <strong>Clients</strong> sheet (one row per site)
              and an <strong>Equipment</strong> sheet, with instructions.
            </p>
            <Button variant="secondary" asChild>
              {/* A plain link: the browser downloads the file. */}
              <a href="/clients/import/template" download>
                <Download aria-hidden="true" />
                Download template
              </a>
            </Button>
          </div>
        </section>
      ) : null}

      {stage.name === "preview" ? (
        <Preview
          preview={stage.preview}
          error={stage.error}
          pending={pending}
          onImport={() => onImport(stage.preview)}
          onRestart={() => setStage({ name: "choose" })}
        />
      ) : null}

      {stage.name === "done" ? (
        <section className="flex flex-col items-start gap-4 rounded-lg border border-border bg-surface p-6">
          <CheckCircle2 className="size-7 text-pass" aria-hidden="true" />
          <p role="status" className="font-medium">
            {stage.message}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/clients">Go to clients</Link>
            </Button>
            <Button variant="secondary" onClick={() => setStage({ name: "choose" })}>
              Import another file
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Count({ label, created, updated }: { label: string; created: number; updated?: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm">
        <span className="tabular text-lg font-semibold">{created}</span> new
        {updated !== undefined ? (
          <>
            {" · "}
            <span className="tabular text-lg font-semibold">{updated}</span> changed
          </>
        ) : null}
      </p>
    </div>
  );
}

function Preview({
  preview,
  error,
  pending,
  onImport,
  onRestart,
}: {
  preview: ImportPreview;
  error?: string;
  pending: boolean;
  onImport: () => void;
  onRestart: () => void;
}) {
  const { counts, errors, changes } = preview;
  const blocked = errors.length > 0;
  return (
    <section className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{preview.fileName}</span> · {preview.rows}{" "}
        rows · SHA-256 <span className="font-mono text-xs">{preview.sha256.slice(0, 12)}…</span>
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Count
          label="Clients"
          created={counts.companies.create}
          updated={counts.companies.update}
        />
        <Count label="Sites" created={counts.sites.create} updated={counts.sites.update} />
        <Count label="Departments" created={counts.departments.create} />
        <Count
          label="Equipment"
          created={counts.equipment.create}
          updated={counts.equipment.update}
        />
      </div>

      {blocked ? (
        <div className="flex flex-col gap-3">
          <div role="alert" className="rounded-md bg-fail-soft px-4 py-3 text-sm text-fail">
            <p className="font-semibold">
              {errors.length} row{errors.length === 1 ? " needs" : "s need"} fixing before anything
              can be imported.
            </p>
            <p>Fix them in Excel, save, and upload the file again.</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Sheet</TableHead>
                <TableHead className="w-20 text-right">Row</TableHead>
                <TableHead>What to fix</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {errors.map((e, i) => (
                <TableRow key={`${e.sheet}-${e.row}-${i}`}>
                  <TableCell>{e.sheet}</TableCell>
                  <TableCell className="tabular text-right">{e.row}</TableCell>
                  <TableCell>{e.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : changes.length === 0 ? (
        <p role="status" className="rounded-md bg-info-soft px-4 py-3 text-sm text-info">
          Everything in this file is already in QTech. Nothing to import.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">What</TableHead>
              <TableHead>Record</TableHead>
              <TableHead>Change</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {changes.map((c, i) => (
              <TableRow key={`${c.kind}-${i}`}>
                <TableCell>
                  <StatusBadge tone={c.action === "create" ? "pass" : "info"}>
                    {c.action === "create" ? "New" : "Change"} {KIND_LABEL[c.kind].toLowerCase()}
                  </StatusBadge>
                </TableCell>
                <TableCell className="font-medium">{c.label}</TableCell>
                <TableCell className="text-muted-foreground">{c.detail}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {error ? (
        <p role="alert" className="rounded-md bg-fail-soft px-3 py-2 text-sm text-fail">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {!blocked && changes.length > 0 ? (
          <Button onClick={onImport} disabled={pending}>
            {pending
              ? "Importing…"
              : `Import ${changes.length} change${changes.length === 1 ? "" : "s"}`}
          </Button>
        ) : null}
        <Button variant="secondary" onClick={onRestart} disabled={pending}>
          <RotateCcw aria-hidden="true" />
          Choose another file
        </Button>
      </div>
    </section>
  );
}
