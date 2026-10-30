"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-controls";
import { newId } from "@/lib/uuid";
import { cn } from "@/lib/utils";

import { useOutbox, type Outcome } from "../outbox";

type Row = {
  id: string;
  code: string;
  reference: string;
  reading: string;
  deviation: string;
  tolerance: string;
  result: string;
  quantity: string;
};

const trim = (v: string) => v.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");

/**
 * Pre-calibration on site (FT-01): each logger beside the master at one
 * point. Pass/fail is worked out on the logger's accuracy; a logger that
 * fails can't be placed in this study.
 */
export function PrecalPanel({
  studyId,
  masters,
  rows,
  needed,
  readOnly,
}: {
  studyId: string;
  masters: { id: string; code: string }[];
  rows: Row[];
  needed: boolean;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [masterId, setMasterId] = useState(masters[0]?.id ?? "");
  const [code, setCode] = useState("");
  const [reference, setReference] = useState("");
  const [reading, setReading] = useState("");
  const [quantity, setQuantity] = useState("temperature");
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();

  const onDone = useCallback(
    ({ entry, result }: Outcome) => {
      if (entry.kind !== "precal") return;
      setFeedback(
        result.ok
          ? { ok: true, text: `Sent: ${entry.label}.` }
          : { ok: false, text: `${entry.label}: ${result.error}` },
      );
      router.refresh();
    },
    [router],
  );
  const { pending, run } = useOutbox(studyId, onDone);
  const queued = pending.filter((p) => p.kind === "precal");

  function submit() {
    start(async () => {
      const r = await run({
        studyId,
        kind: "precal",
        label: `${code} pre-cal`,
        payload: { id: newId(), code, masterId, quantity, reference, reading },
      });
      if (r === "queued")
        setFeedback({
          ok: true,
          text: `No connection: ${code} is kept on this phone and will be sent.`,
        });
      else if (r.ok) {
        const d = r.data as { code: string; result: string; deviation: string; tolerance: number };
        setFeedback({
          ok: d.result === "pass",
          text: `${d.code}: ${d.result === "pass" ? "PASS" : "FAIL"}, deviation ${d.deviation} (allowed ±${d.tolerance}).${d.result === "fail" ? " Use another logger." : ""}`,
        });
        setCode("");
        setReading("");
        router.refresh();
      } else setFeedback({ ok: false, text: r.error });
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {needed
          ? "This study needs each logger checked against a master before use (thermal validation, or the client asks for post-calibration)."
          : "Optional for this study. A logger that fails here can't be placed."}
      </p>
      {!readOnly ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="grid gap-3 rounded-lg border border-border bg-surface p-3 sm:grid-cols-2"
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Master</span>
            <select
              value={masterId}
              onChange={(e) => setMasterId(e.target.value)}
              className="h-12 rounded-md border border-input bg-surface px-3 text-base"
            >
              <option value="">Not recorded</option>
              {masters.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.code}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Quantity</span>
            <select
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="h-12 rounded-md border border-input bg-surface px-3 text-base"
            >
              <option value="temperature">Temperature (°C)</option>
              <option value="humidity">Humidity (%RH)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Logger ID or serial</span>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              className="h-12 text-base"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Master reads</span>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              inputMode="decimal"
              className="h-12 text-base"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Logger reads</span>
            <Input
              value={reading}
              onChange={(e) => setReading(e.target.value)}
              inputMode="decimal"
              className="h-12 text-base"
              required
            />
          </label>
          <div className="flex items-end">
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={busy || !code.trim() || !reference.trim() || !reading.trim()}
            >
              Check
            </Button>
          </div>
        </form>
      ) : null}
      {feedback ? (
        <p
          role={feedback.ok ? "status" : "alert"}
          className={cn(
            "rounded-md px-3 py-2 text-sm",
            feedback.ok ? "bg-pass-soft text-pass" : "bg-fail-soft text-fail",
          )}
        >
          {feedback.text}
        </p>
      ) : null}
      {queued.length > 0 ? (
        <p className="text-xs text-attention">{queued.length} waiting to send.</p>
      ) : null}
      {rows.length > 0 ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1">Logger</th>
              <th>Master</th>
              <th>Logger</th>
              <th>Dev.</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="py-1.5 font-mono text-xs">{r.code}</td>
                <td>{trim(r.reference)}</td>
                <td>{trim(r.reading)}</td>
                <td>
                  {trim(r.deviation)}{" "}
                  <span className="text-xs text-muted-foreground">±{trim(r.tolerance)}</span>
                </td>
                <td
                  className={
                    r.result === "pass" ? "font-medium text-pass" : "font-medium text-fail"
                  }
                >
                  {r.result === "pass" ? "Pass" : "Fail"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
