"use client";

import { Paperclip } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { attachCertificateFileAction } from "../../actions";
import { postFile } from "@/lib/upload-client";

/** Upload the scan of an outside-lab or imported certificate that has none yet. */
export function AttachCertificateFile({ certificateId }: { certificateId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, start] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  async function upload(file: File) {
    setFeedback(null);
    const body = new FormData();
    body.append("file", file, file.name);
    let res: Response;
    try {
      res = await postFile(body);
    } catch {
      setFeedback({ ok: false, text: "No connection. Try again when you're online." });
      return;
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (res.status === 401) {
      setFeedback({
        ok: false,
        text: `You were signed out, so ${file.name} wasn't uploaded. Sign in again (in a new tab), then choose it again.`,
      });
      return;
    }
    if (!res.ok || !json.id) {
      setFeedback({ ok: false, text: json.error ?? "The file couldn't be uploaded." });
      return;
    }
    start(async () => {
      const r = await attachCertificateFileAction(certificateId, json.id!);
      setFeedback(
        r.ok ? { ok: true, text: `${file.name} attached.` } : { ok: false, text: r.error },
      );
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-attention bg-attention-soft p-3">
      <p className="text-sm text-attention">
        No PDF of this certificate is on file. Reports that use these instruments can&apos;t be
        frozen until it is.
      </p>
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        aria-label="Certificate PDF"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />
      <Button
        variant="secondary"
        className="w-fit"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        <Paperclip aria-hidden="true" />
        {busy ? "Attaching…" : "Attach the certificate PDF"}
      </Button>
      {feedback ? (
        <p
          role={feedback.ok ? "status" : "alert"}
          className={cn("text-sm", feedback.ok ? "text-pass" : "text-fail")}
        >
          {feedback.text}
        </p>
      ) : null}
    </div>
  );
}
