"use client";

import { Copy, Mail, Paperclip, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { FormMessage, TextField, useFormAction } from "@/components/ui/form-kit";
import { ROLE_LABELS, type Role } from "@/domain/auth/roles";

import { paperSignoffAction, releaseReportAction } from "../report-actions";
import { postFile } from "@/lib/upload-client";

type Person = { id: string; name: string; email: string; role: string };
export type Mail = { to: string[]; subject: string; body: string; link: string };

/** The ready-written email: the app has no mail service yet, so the person sends it. */
export function MailBox({ mail }: { mail: Mail }) {
  const [copied, setCopied] = useState(false);
  const href = `mailto:${mail.to.join(",")}?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}`;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-info bg-info-soft p-3 text-sm">
      <p>
        Send the client this email. The link opens the report in their QTech area after they sign
        in.
      </p>
      <pre className="max-h-48 overflow-auto rounded bg-surface p-2 text-xs whitespace-pre-wrap">
        {`To: ${mail.to.join(", ")}\nSubject: ${mail.subject}\n\n${mail.body}`}
      </pre>
      <div className="flex flex-wrap gap-2">
        <a
          href={href}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
        >
          <Mail className="size-4" aria-hidden="true" />
          Open in my email
        </a>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(`${mail.subject}\n\n${mail.body}`)
              .then(() => setCopied(true));
          }}
        >
          <Copy aria-hidden="true" />
          {copied ? "Copied" : "Copy the text"}
        </Button>
      </div>
    </div>
  );
}

/** Release a checked revision to chosen client users. */
export function ReleaseForm({
  studyId,
  reportId,
  label,
  people,
  onReleased,
}: {
  studyId: string;
  reportId: string;
  label: string;
  people: Person[];
  onReleased: (mail: Mail) => void;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [to, setTo] = useState<Set<string>>(new Set(people.map((p) => p.id)));
  const [error, setError] = useState<string | null>(null);
  if (people.length === 0) {
    return (
      <p className="rounded-md bg-attention-soft px-3 py-2 text-sm text-attention">
        The client has no QTech users yet. Add their QA and QA head under Users (role Client QA or
        Client QA head), or record their paper sign-off below.
      </p>
    );
  }
  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await releaseReportAction(studyId, reportId, [...to]);
          if (r.ok) {
            onReleased(r.data);
            router.refresh();
          } else setError(r.error);
        });
      }}
    >
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-semibold">Release {label} to</legend>
        {people.map((p) => (
          <label key={p.id} className="flex min-h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={to.has(p.id)}
              onChange={() =>
                setTo((s) => {
                  const n = new Set(s);
                  if (n.has(p.id)) n.delete(p.id);
                  else n.add(p.id);
                  return n;
                })
              }
            />
            <span>
              {p.name}{" "}
              <span className="text-muted-foreground">
                · {ROLE_LABELS[p.role as Role] ?? p.role} · {p.email}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {error ? (
        <p role="alert" className="rounded-md bg-fail-soft px-3 py-2 text-sm text-fail">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full sm:w-fit" disabled={busy || to.size === 0}>
        <Send aria-hidden="true" />
        {busy ? "Releasing…" : "Release to the client"}
      </Button>
    </form>
  );
}

const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

/** The paper route: the scan of the signed report, and who signed it and when. */
export function PaperSignoffForm({
  studyId,
  reportId,
  label,
}: {
  studyId: string;
  reportId: string;
  label: string;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const { result, pending, onSubmit } = useFormAction(paperSignoffAction);
  const [file, setFile] = useState<{ id: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  useEffect(() => {
    if (result?.ok) router.refresh();
  }, [result, router]);

  async function upload(f: File) {
    setUploadError(null);
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", f, f.name);
      const res = await postFile(body);
      const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (res.status === 401) setUploadError("You were signed out. Sign in again, then retry.");
      else if (!res.ok || !json.id) setUploadError(json.error ?? "The scan couldn't be uploaded.");
      else setFile({ id: json.id, name: f.name });
    } catch {
      setUploadError("No connection. Try again when you're online.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3"
      noValidate
    >
      <p className="text-sm">
        The client signed {label} in ink? Upload the scan of the signed pages and enter who signed
        and when. The scan is kept with its SHA-256 next to the frozen PDF&apos;s.
      </p>
      <input type="hidden" name="studyId" value={studyId} />
      <input type="hidden" name="reportId" value={reportId} />
      <input type="hidden" name="fileId" value={file?.id ?? ""} />
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        aria-label="Scan of the signed report"
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
          disabled={uploading}
          onClick={() => input.current?.click()}
        >
          <Paperclip aria-hidden="true" />
          {uploading ? "Uploading…" : file ? "Choose another scan" : "Upload the signed scan"}
        </Button>
        {file ? <span className="text-sm">{file.name}</span> : null}
      </div>
      {uploadError ? (
        <p role="alert" className="text-sm text-fail">
          {uploadError}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <TextField
          name="approvedByName"
          label="Signed for the client by (name)"
          required
          result={result}
        />
        <TextField
          name="approvedOn"
          label="Signed on"
          type="date"
          max={today()}
          required
          result={result}
        />
        <TextField
          name="approvedByTitle"
          label="Their title"
          placeholder="e.g. Head QA"
          result={result}
        />
      </div>
      <FormMessage result={result} />
      <Button type="submit" className="w-full sm:w-fit" disabled={pending || !file}>
        {pending ? "Saving…" : "Record the paper sign-off"}
      </Button>
    </form>
  );
}
