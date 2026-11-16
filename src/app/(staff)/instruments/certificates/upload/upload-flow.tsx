"use client";

import { CheckCircle2, ExternalLink, FileText, Loader2, Pencil, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { FileDrop } from "@/components/ui/file-drop";
import { Input } from "@/components/ui/form-controls";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import type { UploadDraft, UploadRow } from "@/domain/instruments/certificate-upload-service";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  checkCertificateUploadAction,
  readCertificateUploadAction,
  saveCertificateUploadsAction,
} from "../../actions";

type Item =
  | { key: string; state: "reading"; fileName: string }
  | { key: string; state: "failed"; fileName: string; error: string }
  | {
      key: string;
      state: "ready";
      row: UploadRow;
      editing: boolean;
      checking?: boolean;
      saved?: { ok: boolean; message: string; certificateId?: string };
    };

async function upload(file: File): Promise<{ id: string } | { error: string }> {
  const body = new FormData();
  body.set("file", file, file.name);
  try {
    const response = await fetch("/api/files", { method: "POST", body });
    const json = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
    if (response.status === 401) return { error: "You were signed out. Sign in again." };
    if (!response.ok || !json.id) return { error: json.error ?? "The upload failed. Try again." };
    return { id: json.id };
  } catch {
    return { error: "No connection. Try again when you're online." };
  }
}

const BADGE: Record<UploadRow["action"], { tone: StatusTone; label: (r: UploadRow) => string }> = {
  attach: { tone: "info", label: (r) => `Attach to ${r.target?.number}` },
  create: { tone: "pass", label: () => "New certificate" },
  on_file: { tone: "neutral", label: () => "Already on file" },
  incomplete: { tone: "attention", label: () => "Needs you" },
};

const draftOf = (row: UploadRow): UploadDraft => ({
  fileId: row.fileId,
  fileName: row.fileName,
  page: row.page,
  number: row.number,
  ulrNo: row.ulrNo,
  labName: row.labName,
  calibratedOn: row.calibratedOn,
  validUntil: row.validUntil,
  codes: row.codes,
});

/**
 * Drop every certificate scan at once (ADR 0024): each is uploaded, read and
 * matched; the person checks the list, fixes what's flagged, and saves all.
 */
export function CertificateUploadFlow({
  maxSizeMb,
  canRead,
  defaultCode,
}: {
  maxSizeMb: number;
  canRead: boolean;
  /** The instrument the person came from, for scans whose IDs can't be read. */
  defaultCode?: string;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queue = useRef<File[]>([]);
  const running = useRef(0);
  const seq = useRef(0);

  const put = (key: string, next: (item: Item) => Item | Item[]) =>
    setItems((list) => list.flatMap((i) => (i.key === key ? next(i) : [i])));

  async function work() {
    while (queue.current.length) {
      const file = queue.current.shift()!;
      const key = `f${seq.current++}`;
      setItems((list) => [...list, { key, state: "reading", fileName: file.name }]);
      const stored = await upload(file);
      if ("error" in stored) {
        put(key, () => ({ key, state: "failed", fileName: file.name, error: stored.error }));
        continue;
      }
      const read = await readCertificateUploadAction(stored.id);
      if (!read.ok) {
        put(key, () => ({ key, state: "failed", fileName: file.name, error: read.error }));
        continue;
      }
      const rows = await Promise.all(
        read.data.map(async (row) => {
          if (row.codes.length || !defaultCode) return row;
          const checked = await checkCertificateUploadAction({
            ...draftOf(row),
            codes: [defaultCode],
          });
          return checked.ok ? { ...row, ...checked.data } : row;
        }),
      );
      put(key, () =>
        rows.map((row) => ({
          key: row.key,
          state: "ready" as const,
          row,
          editing: row.action === "incomplete",
        })),
      );
    }
  }

  function add(file: File) {
    queue.current.push(file);
    // Two at a time: quick enough, and kind to the reader's limits.
    while (running.current < 2 && queue.current.length) {
      running.current += 1;
      void work().finally(() => {
        running.current -= 1;
      });
    }
  }

  async function edit(key: string, change: Partial<UploadDraft>) {
    const item = items.find((i) => i.key === key);
    if (!item || item.state !== "ready") return;
    const draft = { ...draftOf(item.row), ...change };
    put(key, (i) =>
      i.state === "ready" ? { ...i, row: { ...i.row, ...change }, checking: true } : i,
    );
    const checked = await checkCertificateUploadAction(draft);
    put(key, (i) =>
      i.state === "ready"
        ? {
            ...i,
            checking: false,
            saved: undefined,
            row: checked.ok ? { ...i.row, ...checked.data } : i.row,
          }
        : i,
    );
  }

  const ready = items.flatMap((i) =>
    i.state === "ready" && !i.saved?.ok && (i.row.action === "attach" || i.row.action === "create")
      ? [i]
      : [],
  );
  const count = (pred: (i: Item) => boolean) => items.filter(pred).length;
  const busy = items.some((i) => i.state === "reading" || (i.state === "ready" && i.checking));

  async function saveAll() {
    setSaving(true);
    setError(null);
    const result = await saveCertificateUploadsAction(
      ready.map((i) => ({ ...draftOf((i as Extract<Item, { state: "ready" }>).row), key: i.key })),
    );
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    for (const r of result.data) {
      put(r.key, (i) => (i.state === "ready" ? { ...i, saved: r, editing: !r.ok } : i));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!canRead ? (
        <p className="rounded-md bg-attention-soft px-3 py-2 text-sm text-attention">
          Reading scans isn&apos;t switched on, so only file names are read (like{" "}
          <span className="font-medium">TL-38 27.01.2027.pdf</span>); type the rest. To read the
          certificates themselves, add <code>ANTHROPIC_API_KEY</code> or <code>OPENAI_API_KEY</code>{" "}
          to <code>.env.local</code> and restart the app.
        </p>
      ) : null}
      <FileDrop
        multiple
        accept=".pdf,.png,.jpg,.jpeg"
        description="Scanned certificates, PDF or photo, as many as you have"
        maxSizeMb={maxSizeMb}
        onFile={add}
      />

      {items.length ? (
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-sm">
          <p className="text-sm">
            <span className="font-semibold">{items.length}</span> read
            {busy ? " (still reading…)" : ""} ·{" "}
            <span className="text-pass">{ready.length} ready to save</span>
            {count((i) => i.state === "ready" && i.row.action === "incomplete" && !i.saved?.ok) ? (
              <>
                {" "}
                ·{" "}
                <span className="text-attention">
                  {count(
                    (i) => i.state === "ready" && i.row.action === "incomplete" && !i.saved?.ok,
                  )}{" "}
                  need you
                </span>
              </>
            ) : null}
            {count((i) => i.state === "ready" && !!i.saved?.ok) ? (
              <> · {count((i) => i.state === "ready" && !!i.saved?.ok)} saved</>
            ) : null}
          </p>
          <Button type="button" disabled={!ready.length || saving || busy} onClick={saveAll}>
            <CheckCircle2 aria-hidden="true" />
            {saving
              ? "Saving…"
              : `Save ${ready.length} certificate${ready.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      ) : (
        <ol className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
          {[
            ["Drop the scans", "All at once: masters from outside labs, QA Tech FT-05 batches."],
            [
              "Check the list",
              "Each is matched to its instrument and to its certificate on record.",
            ],
            ["Save", "A scan goes onto its certificate, or a new one is recorded."],
          ].map(([title, text], n) => (
            <li key={title} className="flex gap-3 rounded-lg border border-border bg-surface p-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {n + 1}
              </span>
              <span>
                <span className="block font-medium text-foreground">{title}</span>
                {text}
              </span>
            </li>
          ))}
        </ol>
      )}
      {error ? (
        <p role="alert" className="rounded-md bg-fail-soft px-3 py-2 text-sm text-fail">
          {error}
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.key} className="rounded-lg border border-border bg-surface p-3">
            {item.state === "reading" ? (
              <p className="flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
                <span className="font-medium">{item.fileName}</span>
                <span className="text-muted-foreground">reading…</span>
              </p>
            ) : item.state === "failed" ? (
              <div className="flex items-start justify-between gap-2 text-sm">
                <p>
                  <span className="font-medium">{item.fileName}</span>{" "}
                  <span className="text-fail">{item.error}</span>
                </p>
                <RemoveButton onClick={() => put(item.key, () => [])} />
              </div>
            ) : (
              <RowCard
                item={item}
                onEdit={(change) => void edit(item.key, change)}
                onToggle={() =>
                  put(item.key, (i) => ({ ...i, editing: !("editing" in i && i.editing) }) as Item)
                }
                onRemove={() => put(item.key, () => [])}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
      aria-label="Remove from the list"
      title="Remove from the list"
    >
      <X className="size-4" aria-hidden="true" />
    </button>
  );
}

function RowCard({
  item,
  onEdit,
  onToggle,
  onRemove,
}: {
  item: Extract<Item, { state: "ready" }>;
  onEdit: (change: Partial<UploadDraft>) => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const { row, saved } = item;
  const badge = BADGE[row.action];
  const locked = !!saved?.ok;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 truncate text-sm font-medium" title={row.fileName}>
          {row.fileName}
          {row.page > 1 ? (
            <span className="font-normal text-muted-foreground"> · page {row.page}</span>
          ) : null}
        </span>
        {saved ? (
          <StatusBadge tone={saved.ok ? "pass" : "fail"}>
            {saved.ok ? "Saved" : "Not saved"}
          </StatusBadge>
        ) : (
          <StatusBadge tone={badge.tone}>{badge.label(row)}</StatusBadge>
        )}
        {item.checking ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Checking" />
        ) : null}
        <span className="ml-auto flex items-center gap-1">
          {saved?.certificateId ? (
            <Link
              href={`/instruments/certificates/${saved.certificateId}`}
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              Open
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </Link>
          ) : null}
          {!locked ? (
            <button
              type="button"
              onClick={onToggle}
              className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground"
              aria-expanded={item.editing}
            >
              <Pencil className="size-3.5" aria-hidden="true" />
              {item.editing ? "Done" : "Edit"}
            </button>
          ) : null}
          {!locked ? <RemoveButton onClick={onRemove} /> : null}
        </span>
      </div>

      <p className="flex flex-wrap items-center gap-1.5 text-sm">
        {row.instruments.length ? (
          row.instruments.map((i) => (
            <span
              key={i.code}
              className={cn(
                "rounded-full border px-2 py-0.5 text-xs",
                i.id
                  ? "border-border bg-surface-muted"
                  : "border-attention bg-attention-soft text-attention",
              )}
              title={i.id ? undefined : "Not in the register"}
            >
              {i.label}
            </span>
          ))
        ) : (
          <span className="text-xs text-attention">No instrument read</span>
        )}
        <span className="text-muted-foreground">
          {[
            row.number || row.target?.number || "no number",
            row.labName,
            row.calibratedOn ? `calibrated ${formatDate(row.calibratedOn)}` : "",
            row.validUntil ? `due ${formatDate(row.validUntil)}` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </p>

      {saved ? (
        <p className={cn("text-sm", saved.ok ? "text-pass" : "text-fail")}>{saved.message}</p>
      ) : row.problems.length ? (
        <ul className="list-disc pl-5 text-sm text-attention">
          {row.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      {row.notes && !saved ? <p className="text-xs text-muted-foreground">{row.notes}</p> : null}

      {item.editing && !locked ? (
        <div className="grid gap-2 border-t border-border pt-2 sm:grid-cols-2 lg:grid-cols-5">
          <Field
            label="Instrument IDs"
            hint="Comma between IDs"
            value={row.codes.join(", ")}
            onCommit={(v) =>
              onEdit({
                codes: v
                  .split(/[,\n;]/)
                  .map((c) => c.trim())
                  .filter(Boolean),
              })
            }
          />
          <Field
            label="Certificate no."
            value={row.number}
            onCommit={(v) => onEdit({ number: v })}
          />
          <Field label="Lab" value={row.labName} onCommit={(v) => onEdit({ labName: v })} />
          <Field
            label="Calibrated on"
            type="date"
            value={row.calibratedOn}
            onCommit={(v) => onEdit({ calibratedOn: v })}
          />
          <Field
            label="Due"
            type="date"
            value={row.validUntil}
            onCommit={(v) => onEdit({ validUntil: v })}
          />
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  type = "text",
  onCommit,
}: {
  label: string;
  hint?: string;
  value: string;
  type?: "text" | "date";
  onCommit: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(value);
  }
  return (
    <label className="flex flex-col gap-1 text-xs font-medium">
      {label}
      <Input
        type={type}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text.trim() !== value) onCommit(text.trim());
        }}
        className="h-8 text-sm"
      />
      {hint ? <span className="font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  );
}
