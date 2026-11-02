import "server-only";

import { env } from "@/lib/env";

import { NoEmail, ResendSender, type EmailSender } from "./mailer";

/** The app's email sender: Resend when RESEND_API_KEY and MAIL_FROM are set, otherwise none. */
export const emailSender: EmailSender =
  env.RESEND_API_KEY && env.MAIL_FROM
    ? new ResendSender(env.RESEND_API_KEY, env.MAIL_FROM)
    : new NoEmail();
