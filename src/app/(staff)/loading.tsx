import { PageSkeleton } from "@/components/ui/skeleton";

/** Every staff page: the sidebar stays, the page shows this until its data is in. */
export default function Loading() {
  return <PageSkeleton />;
}
