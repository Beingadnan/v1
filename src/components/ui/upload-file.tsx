"use client";

import { Paperclip } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { uploadFailure } from "@/lib/upload-message";
import { postFile } from "@/lib/upload-client";

/**
 * Uploads one file (PDF or photo) as soon as it is picked and puts its id in
 * a hidden field, so the form around it only sends the id.
 */
export function UploadFile({
  name,
  label,
  current,
}: {
  /** The hidden field that carries the stored file's id. */
  name: string;
  /** What the button says before anything is picked, e.g. "Upload the PO". */
  label: string;
  /** A copy already on the record. */
  current?: { name: string; href: string } | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ id: string; name: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(f: File) {
    setErr(null);
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", f, f.name);
      const res = await postFile(body);
      const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (res.status === 401) setErr("You were signed out. Sign in again, then retry.");
      else if (!res.ok || !json.id) setErr(uploadFailure(res.status, json.error, f.name));
      else setFile({ id: json.id, name: f.name });
    } catch {
      setErr("No connection. Try again when you're online.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <input type="hidden" name={name} value={file?.id ?? ""} />
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        aria-label={label}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={uploading}
          onClick={() => input.current?.click()}
        >
          <Paperclip aria-hidden="true" />
          {uploading ? "Uploading…" : file || current ? "Choose another copy" : label}
        </Button>
        {file ? (
          <span className="text-sm">{file.name}</span>
        ) : current ? (
          <a href={current.href} target="_blank" rel="noreferrer" className="text-sm underline">
            {current.name}
          </a>
        ) : null}
      </div>
      {err ? (
        <p role="alert" className="text-sm text-fail">
          {err}
        </p>
      ) : null}
    </div>
  );
}
