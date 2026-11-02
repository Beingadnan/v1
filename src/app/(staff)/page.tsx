import { Bell } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/db/client";
import { ROLE_DESCRIPTIONS } from "@/domain/auth/roles";
import { homeFor, type Tile } from "@/domain/dashboard/home";
import { requireUser } from "@/lib/auth/dal";
import { cn } from "@/lib/utils";

export const metadata = { title: "Home" };

const TONE: Record<Tile["tone"], string> = {
  neutral: "border-border",
  attention: "border-attention",
  fail: "border-fail",
  pass: "border-pass",
};
const COUNT: Record<Tile["tone"], string> = {
  neutral: "text-muted-foreground",
  attention: "text-attention",
  fail: "text-fail",
  pass: "text-pass",
};

/**
 * Home: what waits on this person, as counts with links. A manager sees every
 * tile and the job board's columns: the Monday review.
 */
export default async function HomePage() {
  const user = await requireUser();
  const firstName = user.name.split(/\s+/)[0] ?? user.name;
  const home = await homeFor(db, user);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader title={`Hello, ${firstName}`} description={ROLE_DESCRIPTIONS[user.role]} />
      {home.unread ? (
        <Link
          href="/notifications"
          className="flex w-fit items-center gap-2 rounded-md bg-info-soft px-3 py-2 text-sm text-info"
        >
          <Bell className="size-4" aria-hidden="true" />
          {home.unread} new notification{home.unread === 1 ? "" : "s"}
        </Link>
      ) : null}

      {home.tiles.length ? (
        <section aria-labelledby="waiting" className="flex flex-col gap-3">
          <h2 id="waiting" className="text-sm font-semibold text-muted-foreground">
            Waiting on you
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {home.tiles.map((t) => (
              <li key={t.key}>
                <Link
                  href={t.href}
                  className={cn(
                    "flex h-full flex-col gap-1 rounded-lg border bg-surface p-4 hover:border-primary",
                    TONE[t.tone],
                  )}
                >
                  <span className="text-sm">{t.label}</span>
                  <span className={cn("text-3xl font-semibold tabular-nums", COUNT[t.tone])}>
                    {t.count}
                  </span>
                  {t.hint ? <span className="text-xs text-muted-foreground">{t.hint}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {home.board.length ? (
        <section aria-labelledby="board" className="flex flex-col gap-3">
          <h2 id="board" className="text-sm font-semibold text-muted-foreground">
            Jobs by stage
          </h2>
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {home.board.map((c) => (
              <li key={c.key}>
                <Link
                  href="/jobs"
                  className="flex flex-col rounded-lg border border-border bg-surface p-3 hover:border-primary"
                >
                  <span className="text-xs text-muted-foreground">{c.label}</span>
                  <span className="text-2xl font-semibold tabular-nums">{c.count}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
