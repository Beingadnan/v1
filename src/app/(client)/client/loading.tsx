import { PageSkeleton } from "@/components/ui/skeleton";

/** The client's pages: shown while a page's data loads. */
export default function Loading() {
  return <PageSkeleton rows={4} />;
}
