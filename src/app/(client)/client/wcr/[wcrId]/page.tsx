import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/db/client";
import { clientWcrs } from "@/domain/billing/queries";
import { requireUser } from "@/lib/auth/dal";

import { AcceptWcr } from "./accept-wcr";

export const metadata = { title: "Work completion report" };

/** A work completion report for the client QA head to read and accept. */
export default async function ClientWcrPage({ params }: PageProps<"/client/wcr/[wcrId]">) {
  const user = await requireUser();
  const { wcrId } = await params;
  const w = (await clientWcrs(db, user)).find((x) => x.id === wcrId);
  if (!w) notFound();
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <Link
        href="/client"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back
      </Link>
      <PageHeader
        title={w.number}
        description="QA Tech's work completion report: the equipment covered and the reports sent."
      />
      <AcceptWcr w={w} />
    </div>
  );
}
