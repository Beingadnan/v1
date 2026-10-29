import type { ReactNode } from "react";

import { gstLookupEnabled } from "@/lib/gst-lookup-enabled";

import { GstLookupProvider } from "./gst-context";

/** Tells the client forms whether "fill from GSTIN" is available (no keys are sent). */
export default function ClientsLayout({ children }: { children: ReactNode }) {
  return <GstLookupProvider enabled={gstLookupEnabled()}>{children}</GstLookupProvider>;
}
