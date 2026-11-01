"use client";

import { ImageUp, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { setLetterheadAction } from "./actions";

/** Upload, see and remove the letterhead image printed on reports and certificates. */
export function LetterheadForm({ hasImage, canEdit }: { hasImage: boolean; canEdit: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, start] = useTransition();
  const [version, setVersion] = useState(0);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const done = (r: { ok: true; message?: string } | { ok: false; error: string }) => {
    setFeedback(r.ok ? { ok: true, text: r.message ?? "Saved." } : { ok: false, text: r.error });
    if (r.ok) {
      setVersion((v) => v + 1);
      router.refresh();
    }
  };

  async function upload(file: File) {
    setFeedback(null);
    const body = new FormData();
    body.append("file", file, file.name);
    let res: Response;
    try {
      res = await fetch("/api/files", { method: "POST", body });
    } catch {
      setFeedback({ ok: false, text: "No connection. Try again when you're online." });
      return;
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok || !json.id) {
      setFeedback({
        ok: false,
        text:
          res.status === 401
            ? "You were signed out. Sign in again (in a new tab), then choose the image again."
            : (json.error ?? "The image couldn't be uploaded."),
      });
      return;
    }
    start(async () => done(await setLetterheadAction(json.id!)));
  }

  return (
    <section className="grid gap-4 rounded-xl border border-border bg-surface p-6 sm:grid-cols-[1fr_2fr]">
      <div>
        <h2 className="font-semibold">Letterhead</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The strip printed across the top of every report, certificate and sheet: your logo and
          address, as on the paper letterhead. A PNG or JPEG, wide and short (about 6:1). Without
          it, documents print the organisation&apos;s name and address as text.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- a private, signed-in image
          <img
            key={version}
            src={`/settings/letterhead?v=${version}`}
            alt="Current letterhead"
            className="max-h-28 w-full rounded-md border border-border bg-white object-contain p-2"
          />
        ) : (
          <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
            No letterhead image yet.
          </p>
        )}
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg"
              aria-label="Letterhead image"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = "";
              }}
            />
            <Button disabled={busy} onClick={() => input.current?.click()}>
              <ImageUp aria-hidden="true" />
              {hasImage ? "Replace the letterhead" : "Upload the letterhead"}
            </Button>
            {hasImage ? (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => start(async () => done(await setLetterheadAction(null)))}
              >
                <Trash2 aria-hidden="true" />
                Remove
              </Button>
            ) : null}
          </div>
        ) : null}
        {feedback ? (
          <p
            role={feedback.ok ? "status" : "alert"}
            className={cn("text-sm", feedback.ok ? "text-pass" : "text-fail")}
          >
            {feedback.text}
          </p>
        ) : null}
      </div>
    </section>
  );
}
