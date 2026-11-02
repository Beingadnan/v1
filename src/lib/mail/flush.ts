import "server-only";

import { after } from "next/server";

import { db } from "@/db/client";
import { sendPending } from "@/domain/notifications/notify";
import { env } from "@/lib/env";

import { emailSender } from "./index";

/**
 * After a change that may have queued alert emails, sends them once the
 * response has gone, so nobody waits on the mail provider. Anything left
 * (provider down) is retried by the daily run.
 */
export function flushEmails() {
  after(async () => {
    try {
      await sendPending(db, emailSender, env.APP_URL, 20);
    } catch (error) {
      console.error(
        JSON.stringify({ level: "error", msg: "alert email failed", error: String(error) }),
      );
    }
  });
}
