"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db/client";
import { markRead, setEmailAlerts } from "@/domain/notifications/notify";
import { userForAction } from "@/lib/auth/dal";

/** Marks every notification of the signed-in person read. */
export async function markAllReadAction() {
  const actor = await userForAction();
  if (!actor) return;
  await markRead(db, actor);
  revalidatePath("/", "layout");
}

/** Turns the person's own alert emails and daily digest on or off. */
export async function setEmailAlertsAction(on: boolean) {
  const actor = await userForAction();
  if (!actor) return;
  await setEmailAlerts(db, actor, on);
  revalidatePath("/", "layout");
}
