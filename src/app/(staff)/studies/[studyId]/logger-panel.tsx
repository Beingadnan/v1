"use client";

import { Camera, CameraOff, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-controls";
import { cn } from "@/lib/utils";

import { removeLoggerAction } from "../actions";
import { useOutbox, type Outcome } from "../outbox";

type Position = {
  id: string;
  label: string;
  note: string;
  ambient: boolean;
  instrumentId: string | null;
  code: string | null;
  serialNo: string | null;
  due: string | null;
};

// The Barcode Detection API (Chrome on Android) isn't in TypeScript's DOM types yet.
type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };
type DetectorCtor = new (o?: { formats?: string[] }) => Detector;
const detectorCtor = (): DetectorCtor | null =>
  typeof window !== "undefined" && "BarcodeDetector" in window
    ? ((window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector ?? null)
    : null;

const dmy = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "");

/**
 * Places loggers: scan with the phone camera (Chrome on Android), type the ID
 * or serial, or use a scanner gun (it types and presses Enter). Each logger
 * goes to the chosen position, or the next empty one.
 */
export function LoggerPanel({
  studyId,
  positions,
  spare,
  readOnly,
}: {
  studyId: string;
  positions: Position[];
  spare: { id: string; code: string; serialNo: string }[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const canScan = useSyncExternalStore(
    () => () => {},
    () => detectorCtor() !== null,
    () => false,
  );
  const [busy, start] = useTransition();
  const video = useRef<HTMLVideoElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const lastScan = useRef<{ value: string; at: number }>({ value: "", at: 0 });

  const onDone = useCallback(
    ({ entry, result }: Outcome) => {
      if (entry.kind !== "place") return;
      setFeedback(
        result.ok
          ? { ok: true, text: `Sent: ${entry.label}.` }
          : { ok: false, text: `${entry.label} was not placed: ${result.error}` },
      );
      router.refresh();
    },
    [router],
  );
  const { pending, signedOut, run } = useOutbox(studyId, onDone);
  const queued = pending.filter((p) => p.kind === "place");

  const empty = positions.filter((p) => !p.instrumentId);
  const next = positions.find((p) => p.id === target && !p.instrumentId) ?? empty[0] ?? null;

  const place = useCallback(
    (value: string) => {
      const c = value.trim();
      if (!c || readOnly) return;
      setFeedback(null);
      start(async () => {
        const where = next?.label ?? "the next position";
        const r = await run({
          studyId,
          kind: "place",
          label: `${c} → ${where}`,
          payload: { code: c, positionId: target ?? undefined },
        });
        if (r === "signed_out")
          setFeedback({
            ok: false,
            text: `You were signed out. ${c} is kept on this phone: sign in again (in a new tab) and it will be sent.`,
          });
        else if (r === "queued") {
          setFeedback({
            ok: true,
            text: `No connection: ${c} will be placed at ${where} when the phone is back online.`,
          });
        } else if (r.ok) {
          const d = r.data as { label: string; code: string; booked: boolean; left: number };
          setFeedback({
            ok: true,
            text: `${d.code} placed at ${d.label}.${d.booked ? " It wasn't booked: now booked for this job." : ""} ${d.left === 0 ? "All positions done." : `${d.left} to go.`}`,
          });
          if ("vibrate" in navigator) navigator.vibrate?.(60);
          setTarget(null);
          router.refresh();
        } else {
          setFeedback({ ok: false, text: r.error });
          if ("vibrate" in navigator) navigator.vibrate?.([80, 60, 80]);
        }
        setCode("");
        input.current?.focus();
      });
    },
    [next, readOnly, router, run, studyId, target],
  );

  // The camera loop calls the latest place() without restarting the camera.
  const placeRef = useRef(place);
  useEffect(() => {
    placeRef.current = place;
  }, [place]);

  // Camera scanning loop.
  useEffect(() => {
    if (!scanning) return;
    const Ctor = detectorCtor();
    if (!Ctor) return;
    let stream: MediaStream | null = null;
    let stop = false;
    const detector = new Ctor({
      formats: ["code_128", "code_39", "qr_code", "ean_13", "data_matrix"],
    });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        while (!stop) {
          const found = await detector.detect(video.current).catch(() => []);
          const value = found[0]?.rawValue?.trim();
          const now = Date.now();
          // The same label stays in view: read it once every few seconds at most.
          if (value && (value !== lastScan.current.value || now - lastScan.current.at > 4000)) {
            lastScan.current = { value, at: now };
            placeRef.current(value);
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch {
        setFeedback({
          ok: false,
          text: "The camera could not start. Allow camera access, or type the ID.",
        });
        setScanning(false);
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [scanning]);

  async function remove(p: Position) {
    start(async () => {
      const r = await removeLoggerAction(studyId, p.id);
      setFeedback(
        r.ok
          ? { ok: true, text: `${p.code} removed from ${p.label}.` }
          : { ok: false, text: r.error },
      );
      if (r.ok) router.refresh();
    });
  }

  const placed = positions.length - empty.length;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        <strong>
          {placed} of {positions.length}
        </strong>{" "}
        positions have a logger.
      </p>

      {!readOnly && positions.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
          <p className="text-sm">
            {next ? (
              <>
                Next: <strong className="font-mono">{next.label}</strong>{" "}
                <span className="text-muted-foreground">{next.note}</span>
              </>
            ) : (
              "Every position has a logger."
            )}
          </p>
          {scanning ? (
            <video
              ref={video}
              className="aspect-video w-full rounded-md bg-black object-cover"
              muted
              playsInline
            />
          ) : null}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              place(code);
            }}
            className="flex gap-2"
          >
            <label htmlFor="logger-code" className="sr-only">
              Logger ID or serial number
            </label>
            <Input
              ref={input}
              id="logger-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Scan or type ID / serial"
              autoComplete="off"
              autoCapitalize="characters"
              enterKeyHint="go"
              className="h-12 text-base"
              disabled={!next}
            />
            <Button type="submit" size="lg" disabled={busy || !code.trim() || !next}>
              Place
            </Button>
          </form>
          {canScan ? (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={() => setScanning((s) => !s)}
              disabled={!next && !scanning}
            >
              {scanning ? <CameraOff aria-hidden="true" /> : <Camera aria-hidden="true" />}
              {scanning ? "Stop camera" : "Scan with camera"}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              Camera scanning works in Chrome on Android. Here, type the ID or serial, or use a
              scanner gun.
            </p>
          )}
          {spare.length > 0 && next ? (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">
                Booked for this job, not placed yet: tap one to place it at {next.label}.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {spare.slice(0, 30).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => place(s.code)}
                    disabled={busy}
                    className="rounded-full border border-border px-3 py-1.5 font-mono text-xs hover:border-primary"
                  >
                    {s.code}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
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
        <p role="status" className="rounded-md bg-attention-soft px-3 py-2 text-sm text-attention">
          {queued.length} waiting to send
          {signedOut ? ": sign in again to send them" : " (no connection)"}:{" "}
          {queued.map((q) => q.label).join(", ")}
        </p>
      ) : null}

      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {positions.map((p) => (
          <li
            key={p.id}
            className={cn(
              "flex items-center gap-3 px-3 py-2",
              next?.id === p.id && !readOnly && "bg-attention-soft/40",
            )}
          >
            <button
              type="button"
              className="w-14 shrink-0 text-left font-mono text-sm font-bold"
              onClick={() => !p.instrumentId && setTarget(p.id)}
              disabled={!!p.instrumentId || readOnly}
              aria-label={p.instrumentId ? p.label : `Place the next logger at ${p.label}`}
            >
              {p.label}
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-muted-foreground">{p.note}</p>
              {p.instrumentId ? (
                <p className="text-sm">
                  <span className="font-mono font-medium">{p.code}</span>{" "}
                  <span className="text-xs text-muted-foreground">
                    {p.serialNo} · due {dmy(p.due) || "—"}
                  </span>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">Empty</p>
              )}
            </div>
            {p.instrumentId && !readOnly ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => remove(p)}
                aria-label={`Remove ${p.code} from ${p.label}`}
              >
                <X aria-hidden="true" />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
