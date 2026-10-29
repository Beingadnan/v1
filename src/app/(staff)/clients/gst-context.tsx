"use client";

import { createContext, useContext, type ReactNode } from "react";

/** Whether the GST lookup service is set up on the server (keys present). */
const GstLookupContext = createContext(false);

export function GstLookupProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return <GstLookupContext.Provider value={enabled}>{children}</GstLookupContext.Provider>;
}

export function useGstLookupEnabled(): boolean {
  return useContext(GstLookupContext);
}
