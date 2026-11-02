"use client";

import { Plus, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/form-controls";
import { REPORT_SECTIONS, REPORT_SECTION_LABELS, type ReportSection } from "@/domain/reports/types";

export type DraftComment = { section: ReportSection; page: number | null; body: string };

const selectClass =
  "h-11 w-full rounded-md border border-input bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";

/**
 * Comments pinned to sections of a frozen report, written when sending it
 * back. Picking a section fills in the page it starts on in the PDF.
 */
export function CommentComposer({
  sections,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  sections: Partial<Record<ReportSection, number>>;
  submitLabel: string;
  busy: boolean;
  onSubmit: (comments: DraftComment[]) => void;
  onCancel: () => void;
}) {
  const available = REPORT_SECTIONS.filter((s) => s === "general" || sections[s] !== undefined);
  const [rows, setRows] = useState<DraftComment[]>([{ section: "general", page: null, body: "" }]);
  const set = (i: number, patch: Partial<DraftComment>) =>
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(rows.filter((r) => r.body.trim()));
      }}
    >
      {rows.map((r, i) => (
        <fieldset key={i} className="flex flex-col gap-2 border-b border-border pb-3 last:border-0">
          <legend className="sr-only">Comment {i + 1}</legend>
          <div className="grid gap-2 sm:grid-cols-[1fr_6rem]">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`section-${i}`}>Section</Label>
              <select
                id={`section-${i}`}
                className={selectClass}
                value={r.section}
                onChange={(e) => {
                  const section = e.target.value as ReportSection;
                  set(i, {
                    section,
                    page: section === "general" ? null : (sections[section] ?? null),
                  });
                }}
              >
                {available.map((s) => (
                  <option key={s} value={s}>
                    {REPORT_SECTION_LABELS[s]}
                    {s !== "general" && sections[s] ? ` (page ${sections[s]})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`page-${i}`}>Page</Label>
              <Input
                id={`page-${i}`}
                inputMode="numeric"
                value={r.page ?? ""}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value, 10);
                  set(i, { page: Number.isFinite(n) && n > 0 ? n : null });
                }}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`body-${i}`}>What needs changing</Label>
            <Textarea
              id={`body-${i}`}
              rows={3}
              value={r.body}
              onChange={(e) => set(i, { body: e.target.value })}
            />
          </div>
          {rows.length > 1 ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="w-fit"
              onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}
            >
              <Trash2 aria-hidden="true" />
              Remove this comment
            </Button>
          ) : null}
        </fieldset>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setRows((rs) => [...rs, { section: "general", page: null, body: "" }])}
        >
          <Plus aria-hidden="true" />
          Add another comment
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !rows.some((r) => r.body.trim())}>
          <Undo2 aria-hidden="true" />
          {busy ? "Sending…" : submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
