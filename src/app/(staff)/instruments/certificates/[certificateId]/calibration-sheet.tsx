"use client";

import { Plus, Save, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ClipboardEvent,
} from "react";

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
import { applyPaste } from "@/domain/instruments/paste";
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

/** Saved by itself this long after the last change. */
const AUTOSAVE_MS = 30_000;
const backupKey = (id: string) => `qtech:calibration:${id}`;
type Backup = {
  at: number;
  header: Header;
  points: Point[];
  masters: Ref[];
  instruments: Ref[];
  grid: string[][];
};

function readBackup(id: string): Backup | null {
  try {
    const raw = window.localStorage.getItem(backupKey(id));
    return raw ? (JSON.parse(raw) as Backup) : null;
  } catch {
    return null;
  }
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
  const [notice, setNotice] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [backup, setBackup] = useState<Backup | null>(null);
  const changes = useRef(0);

  // Readings left on this computer by a save that never happened (signed out, browser closed…).
  useEffect(() => {
    const kept = readBackup(data.certificateId);
    const same =
      kept &&
      JSON.stringify([kept.header, kept.points, kept.instruments, kept.grid]) ===
        JSON.stringify([data.header, data.points, data.instruments, data.readings]);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from browser storage after mount
    if (kept && !same) setBackup(kept);
  }, [data]);

  // Every change is copied to this computer at once, so nothing typed can be lost.
  useEffect(() => {
    if (!dirty) return;
    try {
      const copy: Backup = { at: Date.now(), header, points, masters, instruments, grid };
      window.localStorage.setItem(backupKey(data.certificateId), JSON.stringify(copy));
    } catch {
      // Storage unavailable (private window): autosave still protects the work.
    }
  }, [dirty, header, points, masters, instruments, grid, data.certificateId]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const touch = () => {
    changes.current += 1;
    setDirty(true);
    setResult(undefined);
    setNotice("");
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
  /** Paste from Excel into a reading (column ≥ 0) or the master column (-1). */
  const paste = (pi: number, column: number) => (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!/[\t\n]/.test(text.trim())) return; // a single value: normal paste
    e.preventDefault();
    touch();
    const r = applyPaste({
      text,
      at: { point: pi, column },
      instruments,
      grid: points.map((_, p) => instruments.map((_, i) => grid[p]?.[i] ?? "")),
      references: points.map((p) => p.reference),
    });
    setGrid(r.grid);
    setPoints(points.map((p, i) => ({ ...p, reference: r.references[i] ?? p.reference })));
    setNotice(
      [
        `Pasted ${r.placed} value${r.placed === 1 ? "" : "s"}`,
        r.byHeader ? "matched to the loggers by their serial numbers" : "",
        r.skippedRows
          ? `skipped ${r.skippedRows} deviation row${r.skippedRows === 1 ? "" : "s"}`
          : "",
        r.overflow
          ? `${r.overflow} value${r.overflow === 1 ? " didn't" : "s didn't"} fit and ${r.overflow === 1 ? "was" : "were"} left out`
          : "",
      ]
        .filter(Boolean)
        .join(", ") + ".",
    );
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

  const invalid =
    points.some((p) => cleanDecimal(p.reference) === null) ||
    grid.some((row) => row.some((v) => v.trim() !== "" && cleanDecimal(v) === null));

  const save = useCallback(
    (auto: boolean) =>
      startSaving(async () => {
        const before = changes.current;
        const r = await saveCalibrationAction(data.certificateId, {
          header,
          points,
          masterIds: masters.map((m) => m.id),
          instrumentIds: instruments.map((i) => i.id),
          readings: points.map((_, pi) => instruments.map((_, ii) => grid[pi]?.[ii] ?? "")),
        });
        if (!r.ok) {
          setResult(r);
          return;
        }
        setSavedAt(
          new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit" }).format(
            new Date(),
          ),
        );
        if (!auto) {
          setResult({
            ...r,
            message: `Saved. ${r.data.missing ? `${r.data.missing} readings still empty.` : "All readings entered."}${r.data.failed ? ` ${r.data.failed} outside accuracy.` : ""}`,
          });
        }
        // Typing during the save keeps the sheet unsaved.
        if (changes.current === before) {
          setDirty(false);
          try {
            window.localStorage.removeItem(backupKey(data.certificateId));
          } catch {
            // ignore
          }
        }
        router.refresh();
      }),
    [data.certificateId, header, points, masters, instruments, grid, router],
  );

  // Autosave a while after the last change, when every value is a number.
  useEffect(() => {
    if (!dirty || invalid || saving) return;
    const timer = setTimeout(() => save(true), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [dirty, invalid, saving, save, header, points, masters, instruments, grid]);

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
      {backup ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-attention/30 bg-attention-soft px-4 py-3 text-sm text-attention"
        >
          <span>
            Readings typed on this computer at{" "}
            {new Intl.DateTimeFormat("en-IN", {
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            }).format(backup.at)}{" "}
            were not saved.
          </span>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setHeader(backup.header);
              setPoints(backup.points);
              setMasters(backup.masters);
              setInstruments(backup.instruments);
              setGrid(backup.grid);
              setBackup(null);
              touch();
            }}
          >
            Restore them
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              try {
                window.localStorage.removeItem(backupKey(data.certificateId));
              } catch {
                // ignore
              }
              setBackup(null);
            }}
          >
            Discard
          </Button>
        </div>
      ) : null}
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
          out as you type and checked again on the server when you save. A header row of serial
          numbers copied with the readings puts each column under the right logger.
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
                      onPaste={paste(pi, -1)}
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

      {notice ? (
        <p role="status" className="rounded-md bg-info-soft px-3 py-2 text-sm text-info">
          {notice}
        </p>
      ) : null}
      <FormMessage result={result} />
      <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <Button type="button" onClick={() => save(false)} disabled={saving}>
          <Save aria-hidden="true" />
          {saving ? "Saving…" : "Save"}
        </Button>
        <span className="text-sm text-muted-foreground">
          {saving
            ? "Saving…"
            : dirty
              ? invalid
                ? "Unsaved: fix the values marked “not a number” first"
                : `Unsaved changes; saves by itself after ${AUTOSAVE_MS / 1000} seconds`
              : savedAt
                ? `All changes saved at ${savedAt}`
                : "All changes saved"}
        </span>
      </div>
    </div>
  );
}
