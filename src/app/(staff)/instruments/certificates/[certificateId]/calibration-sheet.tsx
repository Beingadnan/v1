"use client";

import { Plus, Save, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type ClipboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-controls";
import { FormMessage } from "@/components/ui/form-kit";
import {
  cleanDecimal,
  deviation,
  judge,
  toleranceAt,
  type AccuracySpec,
} from "@/domain/instruments/calibration-math";
import { QUANTITIES, QUANTITY_UNITS, type Quantity } from "@/domain/instruments/types";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";

import { saveCalibrationAction } from "../../actions";

type Header = {
  calibratedOn: string;
  validUntil: string;
  title: string;
  location: string;
  department: string;
  equipmentName: string;
  make: string;
  model: string;
  rangeText: string;
  resolutionText: string;
  accuracyText: string;
  sopNo: string;
  conditionOnReceipt: string;
  environmentTemperature: string;
  environmentHumidity: string;
  remarks: string;
};
type Point = { quantity: Quantity; reference: string; condition: string };
type Ref = { id: string; code: string; serialNo: string };

export type SheetData = {
  certificateId: string;
  header: Header;
  points: Point[];
  instruments: Ref[];
  masters: Ref[];
  availableMasters: (Ref & { label: string })[];
  readings: string[][];
  accuracy: AccuracySpec;
};

const HEADER_FIELDS: [keyof Header, string, string?][] = [
  ["calibratedOn", "Date of calibration", "date"],
  ["validUntil", "Due date", "date"],
  ["location", "Location"],
  ["department", "Department"],
  ["equipmentName", "Equipment name"],
  ["make", "Make"],
  ["model", "Model"],
  ["rangeText", "Range"],
  ["resolutionText", "Resolution"],
  ["sopNo", "Calibration SOP No."],
  ["conditionOnReceipt", "Condition on receipt"],
  ["accuracyText", "Accuracy (as printed)"],
];

/** Splits text copied from Excel into rows of cells. */
function parseClipboard(text: string): string[][] {
  return text
    .replace(/\r/g, "")
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => line.split("\t").map((c) => c.trim()));
}

export function CalibrationSheet({ data }: { data: SheetData }) {
  const router = useRouter();
  const [header, setHeader] = useState(data.header);
  const [points, setPoints] = useState<Point[]>(data.points);
  const [masters, setMasters] = useState<Ref[]>(data.masters);
  const [instruments, setInstruments] = useState<Ref[]>(data.instruments);
  const [grid, setGrid] = useState<string[][]>(data.readings);
  const [dirty, setDirty] = useState(false);
  const [result, setResult] = useState<ActionResult<{ missing: number; failed: number }>>();
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const touch = () => {
    setDirty(true);
    setResult(undefined);
  };
  const cell = (pi: number, ii: number) => grid[pi]?.[ii] ?? "";
  const setCell = (pi: number, ii: number, value: string) => {
    touch();
    setGrid((g) => {
      const next = points.map((_, p) => instruments.map((_, i) => g[p]?.[i] ?? ""));
      next[pi]![ii] = value;
      return next;
    });
  };
  const paste = (pi: number, ii: number) => (e: ClipboardEvent<HTMLInputElement>) => {
    const rows = parseClipboard(e.clipboardData.getData("text"));
    if (rows.length <= 1 && (rows[0]?.length ?? 0) <= 1) return; // a single value: normal paste
    e.preventDefault();
    touch();
    setGrid((g) => {
      const next = points.map((_, p) => instruments.map((_, i) => g[p]?.[i] ?? ""));
      rows.forEach((row, r) =>
        row.forEach((value, c) => {
          if (next[pi + r] && ii + c < instruments.length) next[pi + r]![ii + c] = value;
        }),
      );
      return next;
    });
  };

  const preview = useMemo(
    () =>
      points.map((p, pi) => {
        const ref = cleanDecimal(p.reference);
        const tolerance = ref === null ? null : toleranceAt(data.accuracy, p.quantity, Number(ref));
        return instruments.map((_, ii) => {
          const reading = cleanDecimal(grid[pi]?.[ii] ?? "");
          if (ref === null || reading === null) return null;
          const dev = deviation(reading, ref);
          return { dev, judgement: judge(dev, tolerance) };
        });
      }),
    [points, instruments, grid, data.accuracy],
  );
  const failed = preview.flat().filter((p) => p?.judgement === "fail").length;
  const entered = preview.flat().filter(Boolean).length;
  const total = points.length * instruments.length;

  const save = () =>
    startSaving(async () => {
      const r = await saveCalibrationAction(data.certificateId, {
        header,
        points,
        masterIds: masters.map((m) => m.id),
        instrumentIds: instruments.map((i) => i.id),
        readings: points.map((_, pi) => instruments.map((_, ii) => cell(pi, ii))),
      });
      setResult(
        r.ok
          ? {
              ...r,
              message: `Saved. ${r.data.missing ? `${r.data.missing} readings still empty.` : "All readings entered."}${r.data.failed ? ` ${r.data.failed} outside accuracy.` : ""}`,
            }
          : r,
      );
      if (r.ok) {
        setDirty(false);
        router.refresh();
      }
    });

  const removePoint = (pi: number) => {
    touch();
    setPoints((p) => p.filter((_, i) => i !== pi));
    setGrid((g) => g.filter((_, i) => i !== pi));
  };
  const removeInstrument = (ii: number) => {
    touch();
    setInstruments((list) => list.filter((_, i) => i !== ii));
    setGrid((g) => g.map((row) => row.filter((_, i) => i !== ii)));
  };
  const unusedMasters = data.availableMasters.filter((m) => !masters.some((x) => x.id === m.id));

  return (
    <div className="flex flex-col gap-6">
      <details className="rounded-lg border border-border bg-surface p-4">
        <summary className="cursor-pointer font-medium">
          Certificate details{" "}
          <span className="font-normal text-muted-foreground">
            (filled from the model; change only what differs)
          </span>
        </summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {HEADER_FIELDS.map(([key, label, type]) => (
            <label key={key} className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{label}</span>
              <Input
                type={type ?? "text"}
                value={header[key]}
                onChange={(e) => {
                  touch();
                  setHeader({ ...header, [key]: e.target.value });
                }}
              />
            </label>
          ))}
          <label className="flex flex-col gap-1 text-sm sm:col-span-2 lg:col-span-3">
            <span className="font-medium">Additional remarks</span>
            <Input
              value={header.remarks}
              onChange={(e) => {
                touch();
                setHeader({ ...header, remarks: e.target.value });
              }}
              placeholder="Printed after the standard remarks"
            />
          </label>
        </div>
      </details>

      <section aria-labelledby="env-h" className="flex flex-col gap-2">
        <h2 id="env-h" className="font-semibold">
          Lab conditions during calibration
        </h2>
        <div className="flex flex-wrap gap-3">
          {(
            [
              ["environmentTemperature", "Temperature", "23 °C"],
              ["environmentHumidity", "Humidity", "57 %RH"],
            ] as const
          ).map(([key, label, example]) => (
            <label key={key} className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{label}</span>
              <Input
                className="w-36"
                value={header[key]}
                placeholder={example}
                onChange={(e) => {
                  touch();
                  setHeader({ ...header, [key]: e.target.value });
                }}
              />
            </label>
          ))}
        </div>
      </section>

      <section aria-labelledby="masters-h" className="flex flex-col gap-2">
        <h2 id="masters-h" className="font-semibold">
          Master standards
        </h2>
        <ul className="flex flex-wrap gap-2">
          {masters.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-1 rounded-full border border-border py-1 pr-1 pl-3 text-sm"
            >
              {m.code}
              <button
                type="button"
                aria-label={`Remove master ${m.code}`}
                className="rounded-full p-1 hover:bg-surface-muted"
                onClick={() => {
                  touch();
                  setMasters(masters.filter((x) => x.id !== m.id));
                }}
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
          {unusedMasters.length > 0 ? (
            <li>
              <select
                aria-label="Add a master standard"
                className="h-8 rounded-full border border-dashed border-border bg-surface px-3 text-sm"
                value=""
                onChange={(e) => {
                  const m = data.availableMasters.find((x) => x.id === e.target.value);
                  if (!m) return;
                  touch();
                  setMasters([...masters, m]);
                }}
              >
                <option value="">+ Add master</option>
                {unusedMasters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.code} — {m.label}
                  </option>
                ))}
              </select>
            </li>
          ) : null}
        </ul>
      </section>

      <section aria-labelledby="readings-h" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="readings-h" className="font-semibold">
            Readings
          </h2>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {entered} of {total} entered
            {failed ? <strong className="ml-2 text-fail">{failed} outside accuracy</strong> : null}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          Type the master reading for each point, then each instrument&apos;s reading. You can paste
          a block copied from Excel into any cell; it fills right and down. Deviations are worked
          out as you type and checked again on the server when you save.
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-max min-w-full border-collapse text-sm">
            <thead>
              <tr className="bg-surface-muted">
                <th scope="col" className="sticky left-0 z-10 bg-surface-muted p-2 text-left">
                  Point
                </th>
                <th scope="col" className="p-2 text-left">
                  Master
                </th>
                {instruments.map((inst, ii) => (
                  <th
                    key={inst.id}
                    scope="col"
                    className="min-w-[5.5rem] p-2 text-left align-bottom"
                  >
                    <span className="block text-xs font-normal text-muted-foreground">
                      {inst.serialNo}
                    </span>
                    <span className="flex items-center gap-1">
                      {inst.code}
                      {instruments.length > 1 ? (
                        <button
                          type="button"
                          aria-label={`Remove ${inst.code} from this certificate`}
                          className="rounded p-0.5 text-muted-foreground hover:text-fail"
                          onClick={() => removeInstrument(ii)}
                        >
                          <X className="size-3" aria-hidden="true" />
                        </button>
                      ) : null}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((p, pi) => (
                <tr key={pi} className="border-t border-border align-top">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-surface p-2 text-left font-normal"
                  >
                    <div className="flex items-center gap-1">
                      <span className="w-4 text-muted-foreground">{pi + 1}</span>
                      <select
                        aria-label={`Point ${pi + 1} quantity`}
                        value={p.quantity}
                        onChange={(e) => {
                          touch();
                          setPoints(
                            points.map((x, i) =>
                              i === pi ? { ...x, quantity: e.target.value as Quantity } : x,
                            ),
                          );
                        }}
                        className="h-8 rounded border border-input bg-surface px-1 text-sm"
                      >
                        {QUANTITIES.map((q) => (
                          <option key={q} value={q}>
                            {QUANTITY_UNITS[q]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        aria-label={`Remove point ${pi + 1}`}
                        className="rounded p-1 text-muted-foreground hover:text-fail"
                        onClick={() => removePoint(pi)}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </button>
                    </div>
                    <Input
                      aria-label={`Point ${pi + 1} condition`}
                      className="mt-1 h-7 w-28 text-xs"
                      value={p.condition}
                      placeholder="@ condition"
                      onChange={(e) => {
                        touch();
                        setPoints(
                          points.map((x, i) =>
                            i === pi ? { ...x, condition: e.target.value } : x,
                          ),
                        );
                      }}
                    />
                  </th>
                  <td className="p-2">
                    <Input
                      aria-label={`Point ${pi + 1} master reading`}
                      inputMode="decimal"
                      className="tabular h-8 w-24 font-medium"
                      value={p.reference}
                      onChange={(e) => {
                        touch();
                        setPoints(
                          points.map((x, i) =>
                            i === pi ? { ...x, reference: e.target.value } : x,
                          ),
                        );
                      }}
                    />
                  </td>
                  {instruments.map((inst, ii) => {
                    const pv = preview[pi]?.[ii];
                    const bad = cell(pi, ii).trim() !== "" && cleanDecimal(cell(pi, ii)) === null;
                    return (
                      <td key={inst.id} className="p-2">
                        <Input
                          aria-label={`${inst.code}, point ${pi + 1} reading`}
                          aria-invalid={bad || pv?.judgement === "fail" ? true : undefined}
                          inputMode="decimal"
                          className="tabular h-8 w-20"
                          value={cell(pi, ii)}
                          onChange={(e) => setCell(pi, ii, e.target.value)}
                          onPaste={paste(pi, ii)}
                        />
                        <span
                          className={cn(
                            "tabular mt-0.5 block text-xs",
                            pv?.judgement === "fail"
                              ? "font-semibold text-fail"
                              : "text-muted-foreground",
                          )}
                        >
                          {bad
                            ? "not a number"
                            : pv
                              ? `Δ ${pv.dev}${pv.judgement === "fail" ? " ✕" : ""}`
                              : " "}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() => {
            touch();
            setPoints([
              ...points,
              { quantity: points.at(-1)?.quantity ?? "temperature", reference: "", condition: "" },
            ]);
          }}
        >
          <Plus aria-hidden="true" />
          Add point
        </Button>
      </section>

      <FormMessage result={result} />
      <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <Button type="button" onClick={save} disabled={saving}>
          <Save aria-hidden="true" />
          {saving ? "Saving…" : "Save"}
        </Button>
        <span className="text-sm text-muted-foreground">
          {dirty ? "Unsaved changes" : "All changes saved"}
        </span>
      </div>
    </div>
  );
}
