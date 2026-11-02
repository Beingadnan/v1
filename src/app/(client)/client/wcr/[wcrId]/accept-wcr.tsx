"use client";

import { Download } from "lucide-react";
import { useState } from "react";

import { SignDialog } from "@/components/reports/sign-dialog";
import { StatusBadge } from "@/components/ui/status-badge";

import { clientAcceptWcrAction } from "../../actions";

type W = { id: string; number: string; status: "issued" | "signed"; canAccept: boolean };

export function AcceptWcr({ w }: { w: W }) {
  const [done, setDone] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const pdf = `/client/wcr/${w.id}/pdf`;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={w.status === "signed" ? "pass" : "attention"}>
          {w.status === "signed" ? "Accepted" : "To accept"}
        </StatusBadge>
        <a
          className="inline-flex items-center gap-1 text-sm text-primary underline"
          href={`${pdf}?download=1`}
        >
          <Download className="size-4" aria-hidden="true" />
          Download
        </a>
      </div>
      {done ? (
        <p role="status" className="rounded-md bg-pass-soft px-3 py-2 text-sm text-pass">
          {done}
        </p>
      ) : null}
      {w.canAccept ? (
        <SignDialog
          label="Accept the work (sign)"
          title="Accept the work completion report"
          body={`You confirm the work in ${w.number} was completed.`}
          action={clientAcceptWcrAction}
          fields={{ wcrId: w.id }}
          onSigned={(text) => {
            setDone(text);
            setFrame((f) => f + 1);
          }}
        />
      ) : null}
      <a
        href={pdf}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-4 text-sm font-medium md:hidden"
      >
        Open the WCR to read it
      </a>
      <iframe
        key={frame}
        title={w.number}
        src={pdf}
        className="hidden h-[75vh] w-full rounded-lg border border-border bg-surface-muted md:block"
      />
    </div>
  );
}
