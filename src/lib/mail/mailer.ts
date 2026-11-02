import "server-only";

/** One email. Plain text: alerts are short and must read the same in every mail app. */
export type Email = { to: string; subject: string; text: string };
export type SendOutcome = "sent" | "skipped" | "failed";

/** How the app sends email; Resend now, a different provider later without touching callers. */
export interface EmailSender {
  readonly configured: boolean;
  send(email: Email): Promise<SendOutcome>;
}

/** Resend's HTTP API (resend.com). */
export class ResendSender implements EmailSender {
  readonly configured = true;
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(email: Email): Promise<SendOutcome> {
    try {
      const res = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: this.from,
          to: [email.to],
          subject: email.subject,
          text: email.text,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok ? "sent" : "failed";
    } catch {
      return "failed";
    }
  }
}

/** No provider set up: nothing leaves the server, and the alert says so. */
export class NoEmail implements EmailSender {
  readonly configured = false;
  async send(): Promise<SendOutcome> {
    return "skipped";
  }
}

/** Collects emails instead of sending them (tests). */
export class MemorySender implements EmailSender {
  readonly configured = true;
  readonly sent: Email[] = [];
  async send(email: Email): Promise<SendOutcome> {
    this.sent.push(email);
    return "sent";
  }
}
