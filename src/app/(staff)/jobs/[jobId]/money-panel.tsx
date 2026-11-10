"use client";

import { Ban, Download, FileCheck2, Lock, Paperclip, Undo2, Unlock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form-controls";
import { FormMessage, TextField, useFormAction } from "@/components/ui/form-kit";
import { StatusBadge } from "@/components/ui/status-badge";
import type { InvoiceView, JobMoney } from "@/domain/billing/queries";
import { PAYMENT_MODE_LABELS, PAYMENT_MODES } from "@/domain/billing/types";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";

import {
  cancelInvoiceAction,
  closeJobAction,
  issueWcrAction,
  recordInvoiceAction,
  recordPaymentAction,
  reopenJobAction,
  reversePaymentAction,
  voidWcrAction,
  wcrPaperAction,
} from "../billing-actions";

const inr = (v: number) =>
  `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "");
const when = (d: Date | string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(d));
const selectClass =
  "h-11 w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground";

type Result = { ok: true } | { ok: false; error: string };

/**
 * A form action that tells the panel when it worked. The action's reply also
 * re-draws the page, which may replace the form (a new invoice, a cleared
 * one), so its own message would be lost.
 */
function useTelling<T>(
  action: (prev: unknown, formData: FormData) => Promise<ActionResult<T>>,
  onOk: (data: T) => void,
) {
  const told = useRef(onOk);
  useEffect(() => {
    told.current = onOk;
  }, [onOk]);
  const [wrapped] = useState(() => async (prev: unknown, formData: FormData) => {
    const r = await action(prev, formData);
    if (r.ok) told.current(r.data);
    return r;
  });
  return useFormAction(wrapped);
}
type Feedback = { ok: boolean; text: string } | null;

function Message({ f }: { f: Feedback }) {
  if (!f) return null;
  return (
    <p
      role={f.ok ? "status" : "alert"}
      className={cn(
        "rounded-md px-3 py-2 text-sm",
        f.ok ? "bg-pass-soft text-pass" : "bg-fail-soft text-fail",
      )}
    >
      {f.text}
    </p>
  );
}

/** A one-line reason, asked inline before a void, cancel, reversal or reopen. */
function ReasonButton({
  label,
  placeholder,
  icon: Icon,
  busy,
  onReason,
}: {
  label: string;
  placeholder: string;
  icon: typeof Ban;
  busy: boolean;
  onReason: (reason: string) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  if (text === null) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setText("")}>
        <Icon aria-hidden="true" />
        {label}
      </Button>
    );
  }
  return (
    <form
      className="flex w-full flex-col gap-1.5 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        onReason(text);
      }}
    >
      <Input
        aria-label={`${label}: reason`}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" disabled={busy || text.trim().length < 5}>
          {label}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setText(null)}>
          Back
        </Button>
      </div>
    </form>
  );
}

function WcrPaperForm({
  jobId,
  wcrId,
  onDone,
}: {
  jobId: string;
  wcrId: string;
  onDone: (text: string) => void;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const { result, pending, onSubmit } = useTelling(wcrPaperAction, () =>
    onDone("WCR recorded as signed on paper."),
  );
  const [file, setFile] = useState<{ id: string; name: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    if (result?.ok) router.refresh();
  }, [result, router]);
  async function upload(f: File) {
    setErr(null);
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", f, f.name);
      const res = await fetch("/api/files", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (res.status === 401) setErr("You were signed out. Sign in again, then retry.");
      else if (!res.ok || !json.id) setErr(json.error ?? "The scan couldn't be uploaded.");
      else setFile({ id: json.id, name: f.name });
    } catch {
      setErr("No connection. Try again when you're online.");
    } finally {
      setUploading(false);
    }
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2" noValidate>
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="wcrId" value={wcrId} />
      <input type="hidden" name="fileId" value={file?.id ?? ""} />
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        aria-label="Scan of the signed WCR"
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
          {uploading ? "Uploading…" : file ? "Choose another scan" : "Upload the signed scan"}
        </Button>
        {file ? <span className="text-sm">{file.name}</span> : null}
      </div>
      {err ? (
        <p role="alert" className="text-sm text-fail">
          {err}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <TextField name="signedByName" label="Signed by (name)" required result={result} />
        <TextField name="signedOn" label="Signed on" type="date" required result={result} />
      </div>
      <FormMessage result={result} />
      <Button type="submit" size="sm" className="w-fit" disabled={pending || !file}>
        {pending ? "Saving…" : "Record the paper WCR"}
      </Button>
    </form>
  );
}

function InvoiceForm({
  jobId,
  m,
  onDone,
}: {
  jobId: string;
  m: JobMoney;
  onDone: (text: string) => void;
}) {
  const router = useRouter();
  const { result, pending, onSubmit } = useTelling(recordInvoiceAction, () =>
    onDone("Invoice recorded."),
  );
  const [taxable, setTaxable] = useState(
    m.suggest.taxable === null ? "" : String(m.suggest.taxable),
  );
  const [gst, setGst] = useState(
    m.suggest.taxable === null
      ? ""
      : String(Math.round(m.suggest.taxable * m.suggest.gstPct) / 100),
  );
  useEffect(() => {
    if (result?.ok) router.refresh();
  }, [result, router]);
  const total = (Number(taxable) || 0) + (Number(gst) || 0);
  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3"
      noValidate
    >
      <h4 className="text-sm font-semibold">Record the Tally invoice</h4>
      <input type="hidden" name="jobId" value={jobId} />
      <div className="grid gap-2 sm:grid-cols-2">
        <TextField
          name="number"
          label="Invoice No."
          defaultValue={m.suggest.number}
          hint={
            m.suggest.number
              ? "Suggested from the last invoice. Check it against Tally."
              : undefined
          }
          required
          result={result}
        />
        <TextField
          name="invoiceDate"
          label="Invoice date"
          type="date"
          defaultValue={m.suggest.today}
          max={m.suggest.today}
          required
          result={result}
        />
        <TextField
          name="taxable"
          label="Taxable value (₹)"
          inputMode="decimal"
          value={taxable}
          onChange={(e) => {
            setTaxable(e.target.value);
            const t = Number(e.target.value);
            if (Number.isFinite(t)) setGst(String(Math.round(t * m.suggest.gstPct) / 100));
          }}
          required
          result={result}
        />
        <TextField
          name="gst"
          label={`GST (₹, ${m.suggest.gstPct}% suggested)`}
          inputMode="decimal"
          value={gst}
          onChange={(e) => setGst(e.target.value)}
          required
          result={result}
        />
      </div>
      <p className="text-sm">
        Total <strong>{inr(total)}</strong>
      </p>
      <TextField name="note" label="Note (optional)" result={result} />
      <FormMessage result={result} />
      <Button type="submit" className="w-full sm:w-fit" disabled={pending}>
        {pending ? "Saving…" : "Record invoice"}
      </Button>
    </form>
  );
}

function PaymentForm({
  jobId,
  inv,
  onDone,
}: {
  jobId: string;
  inv: InvoiceView;
  onDone: (text: string) => void;
}) {
  const router = useRouter();
  const { result, pending, onSubmit } = useTelling(recordPaymentAction, (d) =>
    onDone(
      d.left === 0
        ? `Payment recorded. Invoice ${inv.number} cleared.`
        : `Payment recorded. ${inr(d.left)} left on ${inv.number}.`,
    ),
  );
  const tds = inv.tds === 0 ? Math.min(inv.tdsHint, inv.balance) : 0;
  useEffect(() => {
    if (result?.ok) router.refresh();
  }, [result, router]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 pt-2" noValidate>
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="invoiceId" value={inv.id} />
      <div className="grid gap-2 sm:grid-cols-3">
        <TextField
          name="paidOn"
          label="Received on"
          type="date"
          defaultValue={today}
          max={today}
          required
          result={result}
        />
        <TextField
          name="received"
          label="Received (₹)"
          inputMode="decimal"
          defaultValue={String(Math.round((inv.balance - tds) * 100) / 100)}
          result={result}
        />
        <TextField
          name="tds"
          label="TDS deducted (₹)"
          inputMode="decimal"
          defaultValue={String(tds)}
          hint="2% on the taxable value (s.194J), if the client deducted it."
          result={result}
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor={`mode-${inv.id}`}>Mode</Label>
          <select id={`mode-${inv.id}`} name="mode" defaultValue="neft" className={selectClass}>
            {PAYMENT_MODES.map((p) => (
              <option key={p} value={p}>
                {PAYMENT_MODE_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <TextField name="reference" label="UTR or cheque No." result={result} />
        <TextField
          name="writtenOff"
          label="Write off (₹)"
          inputMode="decimal"
          hint="Only the last few rupees, e.g. bank charges."
          result={result}
        />
      </div>
      <TextField name="note" label="Note" result={result} />
      <FormMessage result={result} />
      {result?.ok ? (
        <p className="text-sm">
          {result.data.left === 0 ? "Invoice cleared." : `${inr(result.data.left)} left.`}
        </p>
      ) : null}
      <Button type="submit" size="sm" className="w-fit" disabled={pending}>
        {pending ? "Saving…" : "Record payment"}
      </Button>
    </form>
  );
}

/** The job's last steps: WCR, invoices and payments, closing (phase 10). */
export function MoneyPanel({ jobId, m }: { jobId: string; m: JobMoney }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const go = (fn: () => Promise<Result>, ok: string) =>
    start(async () => {
      setFeedback(null);
      const r = await fn();
      if (r.ok) {
        setFeedback({ ok: true, text: ok });
        router.refresh();
      } else setFeedback({ ok: false, text: r.error });
    });
  const told = (text: string) => setFeedback({ ok: true, text });
  const w = m.wcr;
  const live = m.invoices.filter((i) => i.status !== "cancelled");
  const closed = m.status === "closed";

  return (
    <section
      aria-labelledby="money"
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="money" className="font-semibold">
        Close and money
      </h2>
      <Message f={feedback} />

      {/* ---- WCR */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Work completion report</h3>
        {!w ? (
          m.wcrBlockers.length ? (
            <div className="text-sm text-muted-foreground">
              <p>Issued once every report is with the client:</p>
              <ul className="list-disc pl-5">
                {m.wcrBlockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ) : m.can.issueWcr && !closed ? (
            <Button
              className="w-full sm:w-fit"
              disabled={busy}
              onClick={() => go(() => issueWcrAction(jobId), "WCR issued. Send it to the client.")}
            >
              <FileCheck2 aria-hidden="true" />
              {busy ? "Drawing…" : "Issue the WCR"}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">Not issued yet.</p>
          )
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={w.status === "signed" ? "pass" : "attention"}>
                {w.number} · {w.status === "signed" ? "Signed" : "With the client"}
              </StatusBadge>
              <a
                className="inline-flex items-center gap-1 text-primary underline"
                href={`/jobs/${jobId}/wcr/${w.id}`}
                target="_blank"
                rel="noreferrer"
              >
                <Download className="size-4" aria-hidden="true" />
                Open the WCR
              </a>
              {w.paper ? (
                <a
                  className="text-primary underline"
                  href={`/jobs/${jobId}/wcr/${w.id}?copy=scan`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Signed scan
                </a>
              ) : null}
            </div>
            <p className="text-muted-foreground">
              Issued by {w.issuedBy} on {when(w.issuedAt)}.
              {w.acceptedBy
                ? ` Accepted in the app by ${w.acceptedBy.name} (${w.acceptedBy.role}) on ${when(w.acceptedBy.at)}.`
                : ""}
              {w.paper ? ` Signed on paper by ${w.paper.by} on ${dmy(w.paper.on)}.` : ""}
            </p>
            {w.status === "issued" && m.can.issueWcr ? (
              <>
                <p>
                  The client&apos;s QA head can accept it in their QTech area, or record their
                  signed paper here.
                </p>
                <details className="rounded-md border border-border p-2">
                  <summary className="cursor-pointer text-sm font-medium">Signed on paper?</summary>
                  <div className="mt-2">
                    <WcrPaperForm jobId={jobId} wcrId={w.id} onDone={told} />
                  </div>
                </details>
                <ReasonButton
                  label="Void the WCR"
                  placeholder="Why? e.g. PO number missing"
                  icon={Ban}
                  busy={busy}
                  onReason={(reason) =>
                    go(() => voidWcrAction(jobId, w.id, reason), "WCR voided. Issue it again.")
                  }
                />
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* ---- Invoices */}
      {m.can.money && w?.status === "signed" ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Invoices and payments</h3>
          {live.length === 0 && m.daysSinceWcr !== null ? (
            <p
              className={cn(
                "text-sm",
                m.daysSinceWcr > m.invoiceWithin - 5 ? "text-attention" : "text-muted-foreground",
              )}
            >
              Invoice due: the WCR was signed {m.daysSinceWcr} day
              {m.daysSinceWcr === 1 ? "" : "s"} ago (GST Rule 47: within {m.invoiceWithin} days).
            </p>
          ) : null}
          <ul className="flex flex-col gap-2">
            {m.invoices.map((i) => (
              <li
                key={i.id}
                className={cn(
                  "flex flex-col gap-1 rounded-md border p-3 text-sm",
                  i.overdueDays > 0 ? "border-fail" : "border-border",
                  i.status === "cancelled" && "text-muted-foreground",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{i.number}</strong>
                  <span>{dmy(i.invoiceDate)}</span>
                  <span>
                    {inr(i.total)} ({inr(i.taxable)} + GST {inr(i.gst)})
                  </span>
                  <StatusBadge
                    tone={
                      i.status === "cleared"
                        ? "pass"
                        : i.status === "cancelled"
                          ? "neutral"
                          : i.overdueDays > 0
                            ? "fail"
                            : "info"
                    }
                  >
                    {i.status === "cleared"
                      ? "Cleared"
                      : i.status === "cancelled"
                        ? "Cancelled"
                        : i.overdueDays > 0
                          ? `${inr(i.balance)} due, ${i.overdueDays} days overdue`
                          : `${inr(i.balance)} due by ${dmy(i.due)}`}
                  </StatusBadge>
                </div>
                {i.cancelReason ? <span>Cancelled: {i.cancelReason}</span> : null}
                {i.payments.length ? (
                  <ul className="flex flex-col gap-0.5 text-xs">
                    {i.payments.map((p) => (
                      <li
                        key={p.id}
                        className={cn(
                          "flex flex-wrap items-center gap-x-2",
                          (p.reversal || p.reversed) && "text-muted-foreground line-through",
                        )}
                      >
                        <span>
                          {dmy(p.paidOn)} · {inr(p.received)} {PAYMENT_MODE_LABELS[p.mode]}
                          {p.reference ? ` ${p.reference}` : ""}
                          {p.tds ? ` · TDS ${inr(p.tds)}` : ""}
                          {p.writtenOff ? ` · written off ${inr(p.writtenOff)}` : ""}
                          {p.reversal ? ` · reversal: ${p.note}` : p.note ? ` · ${p.note}` : ""}
                        </span>
                        {m.can.record && !p.reversal && !p.reversed && !closed ? (
                          <ReasonButton
                            label="Reverse"
                            placeholder="Why? e.g. typed the wrong amount"
                            icon={Undo2}
                            busy={busy}
                            onReason={(reason) =>
                              go(
                                () => reversePaymentAction(jobId, p.id, reason),
                                "Payment reversed.",
                              )
                            }
                          />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {i.status === "open" && m.can.record && !closed ? (
                  <details>
                    <summary className="cursor-pointer text-sm font-medium text-primary">
                      Record a payment
                    </summary>
                    <PaymentForm jobId={jobId} inv={i} onDone={told} />
                  </details>
                ) : null}
                {i.status === "open" && i.payments.length === 0 && m.can.record && !closed ? (
                  <ReasonButton
                    label="Cancel invoice"
                    placeholder="Why? e.g. entered against the wrong job"
                    icon={Ban}
                    busy={busy}
                    onReason={(reason) =>
                      go(() => cancelInvoiceAction(jobId, i.id, reason), "Invoice cancelled.")
                    }
                  />
                ) : null}
              </li>
            ))}
          </ul>
          {m.can.record && !closed && m.orderMissing ? (
            <p className="text-sm text-attention">{m.orderMissing}</p>
          ) : null}
          {m.can.record && !closed ? (
            <InvoiceForm key={live.length} jobId={jobId} m={m} onDone={told} />
          ) : null}
        </div>
      ) : null}

      {/* ---- Close */}
      {m.can.close ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Close the job</h3>
          {closed ? (
            <ReasonButton
              label="Reopen the job"
              placeholder="Why? e.g. client asked for a corrected WCR"
              icon={Unlock}
              busy={busy}
              onReason={(reason) => go(() => reopenJobAction(jobId, reason), "Job reopened.")}
            />
          ) : m.closeBlockers.length ? (
            <div className="text-sm text-muted-foreground">
              <p>It closes when:</p>
              <ul className="list-disc pl-5">
                {m.closeBlockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ) : (
            <Button
              className="w-full sm:w-fit"
              disabled={busy}
              onClick={() =>
                go(() => closeJobAction(jobId), "Job closed. It is in the History now.")
              }
            >
              <Lock aria-hidden="true" />
              Close the job
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}
