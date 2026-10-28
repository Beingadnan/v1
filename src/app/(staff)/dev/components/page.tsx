import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";

import { ComponentGallery } from "./gallery";

export const metadata = { title: "Component gallery" };

/** Development-only page for reviewing the design system. Hidden in production. */
export default function ComponentGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <PageHeader
        title="Component gallery"
        description="Every building block of the QTech interface, with real QA Tech content. Development only."
      />
      <ComponentGallery />
    </div>
  );
}
