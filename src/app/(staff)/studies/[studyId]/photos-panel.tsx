"use client";

import { Camera } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { newId } from "@/lib/uuid";
import { cn } from "@/lib/utils";

import { attachPhotoAction } from "../actions";

const MAX_SIDE = 1600;

/**
 * Shrinks a phone photo (often 4–8 MB) to about 1600 px JPEG before upload,
 * so it goes up quickly on site and the report annexures stay small.
 */
async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    return blob ?? file;
  } catch {
    return file;
  }
}

export function PhotosPanel({
  studyId,
  photos,
  positions,
  readOnly,
}: {
  studyId: string;
  photos: { id: string; positionLabel: string; caption: string; by: string | null }[];
  positions: string[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [positionLabel, setPositionLabel] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();

  function upload(files: FileList | null) {
    if (!files?.length) return;
    start(async () => {
      let added = 0;
      for (const file of Array.from(files)) {
        const blob = await shrink(file);
        const body = new FormData();
        body.append("file", blob, (file.name || "photo").replace(/\.\w+$/, "") + ".jpg");
        let res: Response;
        try {
          res = await fetch("/api/files", { method: "POST", body });
        } catch {
          setFeedback({
            ok: false,
            text: "No connection. Take the photo again when the phone is back online (it is still in the phone's gallery).",
          });
          return;
        }
        const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
        if (!res.ok || !json.id) {
          setFeedback({ ok: false, text: json.error ?? "The photo could not be uploaded." });
          return;
        }
        const r = await attachPhotoAction(studyId, { id: newId(), fileId: json.id, positionLabel });
        if (!r.ok) {
          setFeedback({ ok: false, text: r.error });
          return;
        }
        added++;
      }
      setFeedback({ ok: true, text: `${added} photo${added === 1 ? "" : "s"} added.` });
      if (input.current) input.current.value = "";
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {!readOnly ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Shows</span>
            <select
              value={positionLabel}
              onChange={(e) => setPositionLabel(e.target.value)}
              className="h-12 rounded-md border border-input bg-surface px-3 text-base"
            >
              <option value="">The whole equipment</option>
              {positions.map((p) => (
                <option key={p} value={p}>
                  Position {p}
                </option>
              ))}
            </select>
          </label>
          <label
            className={cn(
              "inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-5 text-base font-medium text-primary-foreground",
              busy && "pointer-events-none opacity-50",
            )}
          >
            <Camera className="size-5" aria-hidden="true" />
            {busy ? "Uploading…" : "Take or choose photos"}
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png"
              capture="environment"
              multiple
              className="sr-only"
              onChange={(e) => upload(e.target.files)}
            />
          </label>
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
      {photos.length === 0 ? (
        <p className="text-sm text-muted-foreground">No photos yet.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {photos.map((p) => (
            <li key={p.id} className="overflow-hidden rounded-md border border-border">
              <a href={`/studies/${studyId}/photos/${p.id}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- private, session-checked file */}
                <img
                  src={`/studies/${studyId}/photos/${p.id}`}
                  alt={p.positionLabel ? `Position ${p.positionLabel}` : "The equipment"}
                  className="aspect-square w-full object-cover"
                  loading="lazy"
                />
              </a>
              <p className="px-2 py-1 text-xs text-muted-foreground">
                {p.positionLabel ? `${p.positionLabel} · ` : ""}
                {p.by}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
