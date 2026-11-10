import { PageSkeleton } from "@/components/ui/skeleton";

/** A study and its tabs: shown on opening a study and on switching tabs. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageSkeleton tabs={6} rows={5} />
    </div>
  );
}
